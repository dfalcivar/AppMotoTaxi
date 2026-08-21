import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const outManuals = path.join(root, "docs/manuales_usuario");
const outTech = path.join(root, "docs/tecnica");
const sourceDir = path.join(root, "docs/fuentes");
const htmlDir = path.join(sourceDir, "html");
const diagramDir = path.join(sourceDir, "diagramas");
const inventoryDir = path.join(sourceDir, "inventarios");
const assetsDir = path.join(sourceDir, "assets");
const captureDir = path.join(sourceDir, "capturas");
for (const dir of [outManuals, outTech, htmlDir, diagramDir, inventoryDir, assetsDir, captureDir]) fs.mkdirSync(dir, { recursive: true });

const now = new Date();
const dateText = new Intl.DateTimeFormat("es-EC", { dateStyle: "long", timeZone: "America/Guayaquil" }).format(now);
const version = "1.0";

const logoSource = path.join(root, "apps/admin/public/costa-go-emblem.png");
const logoTarget = path.join(assetsDir, "costa-go-emblem.png");
if (fs.existsSync(logoSource)) fs.copyFileSync(logoSource, logoTarget);

function walk(dir, filter = () => true) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full, filter) : (filter(full) ? [full] : []);
  });
}

function rel(file) { return path.relative(root, file).replaceAll("\\", "/"); }
function esc(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function slug(value) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase(); }

const apiFiles = walk(path.join(root, "apps/api/src"), file => /\.(ts|tsx)$/.test(file));
const endpoints = [];
for (const file of apiFiles) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/\bapp\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/i);
    if (!match) continue;
    const nearby = lines.slice(i, Math.min(lines.length, i + 18)).join("\n");
    const permission = nearby.match(/requirePermission\([^,]+,\s*["'`]([^"'`]+)["'`]/)?.[1]
      ?? (nearby.includes("requireAdmin") ? "admin" : nearby.includes("requireAppUser") || nearby.includes("requireAuth") ? "usuario autenticado" : "público/validación propia");
    endpoints.push({ method: match[1].toUpperCase(), route: match[2], permission, source: rel(file), line: i + 1 });
  }
}
endpoints.sort((a, b) => a.route.localeCompare(b.route) || a.method.localeCompare(b.method));
fs.writeFileSync(path.join(inventoryDir, "endpoints.json"), JSON.stringify({ generatedAt: now.toISOString(), total: endpoints.length, endpoints }, null, 2));

const migrations = walk(path.join(root, "apps/api/migrations"), file => file.endsWith(".sql")).sort();
const tables = new Map();
for (const file of migrations) {
  const sql = fs.readFileSync(file, "utf8");
  const createRx = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-zA-Z0-9_]+)"?\s*\(([\s\S]*?)\)\s*;/gi;
  let match;
  while ((match = createRx.exec(sql))) {
    const name = match[1];
    const body = match[2];
    const columns = [];
    let depth = 0, token = "";
    const chunks = [];
    for (const char of body) {
      if (char === "(") depth++;
      if (char === ")") depth--;
      if (char === "," && depth === 0) { chunks.push(token); token = ""; } else token += char;
    }
    chunks.push(token);
    for (const raw of chunks) {
      const clean = raw.trim().replace(/\s+/g, " ");
      if (!clean || /^(constraint|primary key|foreign key|unique|check)\b/i.test(clean)) continue;
      const cm = clean.match(/^"?([a-zA-Z0-9_]+)"?\s+(.+)$/);
      if (cm) columns.push({ name: cm[1], definition: cm[2].slice(0, 240) });
    }
    const current = tables.get(name) ?? { name, columns: [], sources: [] };
    for (const col of columns) if (!current.columns.some(item => item.name === col.name)) current.columns.push(col);
    current.sources.push(rel(file));
    tables.set(name, current);
  }
  const alterRx = /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-zA-Z0-9_]+)"?[\s\S]{0,80}?add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-zA-Z0-9_]+)"?\s+([^;]+)/gi;
  while ((match = alterRx.exec(sql))) {
    const [_, name, column, definition] = match;
    const current = tables.get(name) ?? { name, columns: [], sources: [] };
    if (!current.columns.some(item => item.name === column)) current.columns.push({ name: column, definition: definition.trim().replace(/\s+/g, " ").slice(0, 240) });
    if (!current.sources.includes(rel(file))) current.sources.push(rel(file));
    tables.set(name, current);
  }
}
const tableInventory = [...tables.values()].sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(path.join(inventoryDir, "tablas.json"), JSON.stringify({ generatedAt: now.toISOString(), total: tableInventory.length, tables: tableInventory }, null, 2));

const roles = [
  ["SUPER_ADMIN", "Control transversal del panel y configuración sensible."],
  ["ADMIN", "Administración general según permisos asignados."],
  ["ADMIN_OPERACIONES", "Operación de viajes, conductores, alertas y cobertura."],
  ["SUPPORT / SOPORTE", "Gestión de soporte e incidentes sin acceso implícito a auditoría o configuración."],
  ["ANALISTA_COOPERATIVA", "Consulta de información limitada a su cooperativa."],
  ["COLLECTOR", "Portal de recaudación y cierres de caja de puntos autorizados."],
  ["FINANCE", "Revisión, conciliación y liquidación de pagos/cierres."],
  ["COMMERCIAL", "Leads, anunciantes, órdenes y seguimiento comercial."],
  ["DRIVER / PASSENGER", "Roles de aplicación móvil; aparecen en documentos técnicos, no como manual móvil."]
];

const statusLabels = {
  SEARCHING: "Buscando conductor", ASSIGNED: "Asignado", DRIVER_EN_ROUTE: "Conductor en camino", DRIVER_ARRIVED: "Conductor llegó", IN_PROGRESS: "En curso", COMPLETED: "Completado", CANCELLED: "Cancelado",
  SCHEDULED: "Programado", SCHEDULED_ASSIGNED: "Programado con conductor", SCHEDULED_READY: "Próximo a iniciar", ACTIVATED: "Activado",
  PENDING: "Pendiente", ACTIVE: "Activo", EXPIRING: "Próximo a vencer", GRACE_PERIOD: "Período de gracia", PAYMENT_DUE: "Pago pendiente", SUSPENSION_PENDING_ACTIVE_TRIP: "Suspensión al finalizar viaje", SUSPENDED_NON_PAYMENT: "Suspendido por falta de pago", SUSPENDED: "Suspendido", CLOSED: "Cerrado",
  NEW: "Nuevo", IN_REVIEW: "En revisión", RESOLVED: "Resuelto", REJECTED: "Rechazado", APPROVED: "Aprobado", PAUSED: "Pausado", EXPIRED: "Expirado", DRAFT: "Borrador", PENDING_REVIEW: "Pendiente de revisión", PENDING_PAYMENT: "Pendiente de pago", PAYMENT_REVIEW: "Pago en revisión",
  QUALIFIED: "Calificado", REQUIRES_CONTACT: "Solicita asesor", CONVERTED: "Convertido", LOST: "No convertido"
};

const manuals = [
  {
    id: "01", file: "01_Sitio_Publico_Costa_Go", title: "Sitio público y páginas informativas", audience: "Visitantes, pasajeros, conductores y comercios", access: "https://costa-go.com",
    objective: "Orientar al visitante, publicar información legal y tarifaria y dirigir solicitudes comerciales al flujo oficial.",
    ui: ["Portada institucional Costa-Go", "Accesos para viajar y conducir", "Tarifario público", "Política de privacidad", "Términos de uso", "Eliminación de cuenta", "Acceso «Anúnciate con Costa-Go»"],
    actions: ["Consultar cobertura, funcionamiento y documentos legales.", "Abrir el tarifario vigente publicado.", "Iniciar una solicitud comercial desde el chat web.", "Enviar una solicitud de eliminación de cuenta mediante el flujo validado."],
    workflow: ["Abrir costa-go.com", "Elegir la información o acción", "Completar el formulario/chat si corresponde", "El backend registra la solicitud en el sistema común", "El panel administrativo recibe el caso"],
    notes: ["El sitio no reemplaza la aplicación móvil para solicitar un viaje.", "Las URLs públicas usan el dominio costa-go.com; Render es la infraestructura de origen."], screenshot: "sitio-publico.png"
  },
  {
    id: "02", file: "02_Acceso_Usuarios_Roles", title: "Acceso, usuarios, roles y permisos", audience: "Superadministración y administradores autorizados", access: "Panel administrativo → Usuarios y roles",
    objective: "Administrar el acceso al panel aplicando RBAC, alcance por cooperativa y sesiones seguras.",
    ui: ["Inicio de sesión del panel", "Listado de usuarios administrativos", "Rol y permisos efectivos", "Alcance de cooperativa", "Restablecimiento de contraseña", "Estado de sesión"],
    actions: ["Crear o revisar usuarios administrativos.", "Asignar roles/permisos sin ampliar el alcance innecesariamente.", "Restablecer una clave temporal; la acción cierra sesiones activas.", "Comprobar que soporte, finanzas, comercial y recaudación vean solo sus módulos."],
    workflow: ["Autenticación", "Validación de sesión", "Resolución de rol y permisos", "Aplicación de alcance", "Acceso al módulo permitido", "Registro de acciones sensibles"],
    notes: ["Ocultar una opción en el frontend no sustituye la validación del backend.", "Las claves temporales exigen 10+ caracteres, mayúscula, minúscula, número y símbolo."], screenshot: "acceso-panel.png"
  },
  {
    id: "03", file: "03_Tablero_Operaciones_Alertas", title: "Tablero, centro de operaciones y alertas", audience: "Administración y operaciones", access: "Panel → Tablero / Centro de operaciones / Centro de alertas",
    objective: "Supervisar demanda, cobertura, viajes, conductores, incidentes y alertas operativas con información real.",
    ui: ["Filtros de período, cooperativa, conductor, sector, estado y tipo", "Indicadores ejecutivos", "Demanda por día/hora", "Zonas y concentraciones", "Ranking de conductores", "Mapa operativo", "Alertas y documentos por vencer"],
    actions: ["Aplicar filtros globales.", "Identificar solicitudes sin conductor o con asignación demorada.", "Abrir el perfil estadístico de un conductor.", "Dar seguimiento a alertas operativas sin alterar viajes históricos."],
    workflow: ["Definir filtros", "Consultar métricas agregadas", "Detectar señal", "Abrir detalle", "Derivar a operación/soporte", "Registrar resolución cuando el módulo lo permita"],
    notes: ["Las fechas se interpretan en America/Guayaquil.", "El mapa de calor es analítico; no sustituye la zona de cobertura." ]
  },
  {
    id: "04", file: "04_Gestion_Viajes", title: "Gestión administrativa de viajes", audience: "Operaciones, administración y soporte autorizado", access: "Panel → Viajes",
    objective: "Consultar viajes inmediatos y programados, su itinerario, participantes, estados y eventos.",
    ui: ["Filtros por tipo, estado, pasajero, conductor y fecha", "Listado paginado", "Origen, paradas y destino final", "Total y estado", "Detalle/eventos del viaje"],
    actions: ["Filtrar y localizar un viaje.", "Revisar asignación, itinerario y estado real.", "Distinguir viaje inmediato de programado.", "Usar la trazabilidad para soporte, no editar un viaje activo sin validación."],
    workflow: ["Solicitud", "Búsqueda", "Asignación", "Conductor en camino", "Llegada", "Viaje en curso", "Paradas", "Completado o cancelado"],
    states: ["SEARCHING", "ASSIGNED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "SCHEDULED", "SCHEDULED_ASSIGNED", "SCHEDULED_READY", "ACTIVATED"]
  },
  {
    id: "05", file: "05_Conductores_Aprobacion_Documentos", title: "Conductores, aprobación y documentos", audience: "Administración y operaciones autorizadas", access: "Panel → Conductores",
    objective: "Revisar altas, afiliación, vehículo, habilitantes y aprobación de conductores.",
    ui: ["Contadores de aprobación", "Ficha del conductor", "Cooperativa o condición individual", "Vehículo", "Documentos y vencimientos", "Acciones aprobar, observar, rechazar o suspender", "Importación CSV de información básica"],
    actions: ["Revisar identidad y datos.", "Abrir cada documento mediante acceso protegido.", "Aprobar/rechazar documentos con observación.", "Aprobar al conductor cuando los requisitos estén completos.", "Importar datos masivos sin documentos ni foto."],
    workflow: ["Registro", "Carga de datos y documentos", "Pendiente de revisión", "Revisión documental", "Aprobación/observación", "Notificación al conductor", "Alta operativa sujeta a membresía"],
    states: ["PENDIENTE_DOCUMENTOS", "PENDIENTE_REVISION", "OBSERVADO", "APROBADO", "RECHAZADO", "SUSPENDIDO"],
    notes: ["Los documentos no se exponen mediante URL pública permanente.", "Aprobar una cuenta no omite la política de membresía si el enforcement está activo."]
  },
  {
    id: "06", file: "06_Pasajeros_Cooperativas", title: "Pasajeros y cooperativas", audience: "Administración y soporte según alcance", access: "Panel → Pasajeros / Cooperativas",
    objective: "Consultar cuentas vigentes, relaciones con cooperativas y datos necesarios para operación y soporte.",
    ui: ["Listado y buscador", "Datos mínimos de contacto", "Estado", "Historial relacionado", "Ficha de cooperativa", "Conductores asociados"],
    actions: ["Buscar una cuenta sin exponer información innecesaria.", "Consultar el contexto operativo.", "Crear/actualizar cooperativas con permisos.", "Aplicar alcance por cooperativa."],
    workflow: ["Buscar", "Abrir ficha", "Verificar alcance", "Consultar relación", "Actualizar solo cuando exista autorización", "Auditar el cambio"],
    notes: ["Las cuentas eliminadas se excluyen de listados operativos y se conservan únicamente donde corresponde por trazabilidad histórica."]
  },
  {
    id: "07", file: "07_Membresias_Planes_Gracia", title: "Membresías, planes y períodos de gracia", audience: "Administración, operaciones y finanzas", access: "Panel → Membresías",
    objective: "Administrar elegibilidad operativa del conductor, planes versionados, vencimientos, gracia, suspensiones e importaciones.",
    ui: ["Dashboard de membresías", "Membresías", "Planes", "Períodos de gracia", "Pagos", "Recaudación", "Parámetros", "Importar CSV"],
    actions: ["Consultar vigencia y estado.", "Crear una nueva versión de plan sin alterar ciclos vigentes.", "Crear planes de duración configurable.", "Otorgar gracia global, por cooperativa o conductor.", "Suspender/reactivar con motivo.", "Configurar hora local de suspensión y porcentaje de participación."],
    workflow: ["Conductor aprobado", "Gracia de incorporación o pendiente", "Orden de pago", "Confirmación/conciliación", "Membresía activa", "Aviso de vencimiento", "Gracia/pago pendiente", "Suspensión al concluir viaje activo"],
    states: ["PENDING", "ACTIVE", "EXPIRING", "GRACE_PERIOD", "PAYMENT_DUE", "SUSPENSION_PENDING_ACTIVE_TRIP", "SUSPENDED_NON_PAYMENT", "SUSPENDED", "CLOSED"],
    notes: ["El cambio de plan crea una versión; las membresías existentes conservan su snapshot.", "La suspensión no interrumpe un viaje activo: se difiere hasta finalizarlo."]
  },
  {
    id: "08", file: "08_Recaudacion_Membresias", title: "Recaudación de membresías y cierres de caja", audience: "Recaudadores, finanzas y administración", access: "Portal de recaudación / Panel → Membresías → Recaudación",
    objective: "Validar órdenes de membresía, registrar cobros, cerrar caja y conciliar valores con segregación de funciones.",
    ui: ["Búsqueda por QR, código, placa o correo", "Punto asignado", "Orden y conductor", "Método de pago", "Comprobante", "Recaudación abierta", "Cierres", "Conciliación financiera"],
    actions: ["Escanear o buscar una orden vigente.", "Confirmar efectivo, Deuna o transferencia.", "Adjuntar comprobante cuando corresponde.", "Cerrar únicamente pagos aún no incluidos.", "Conciliar o rechazar desde Finanzas con referencia."],
    workflow: ["Orden pendiente", "Cobro en punto", "Pago pendiente de liquidación", "Cierre de caja", "Conciliación financiera", "Pago verificado", "Membresía activada"],
    notes: ["No se crean cierres en cero.", "Un pago solo puede pertenecer a un cierre.", "Los pagos de días anteriores pendientes pueden incluirse en el siguiente cierre autorizado." ]
  },
  {
    id: "09", file: "09_Tarifas_Sectores_Radio", title: "Tarifas, sectores y radio de búsqueda", audience: "Administración y operaciones", access: "Panel → Tarifas / Radio de búsqueda",
    objective: "Versionar tarifas, definir reglas por sector/tramo y configurar la búsqueda escalonada de conductores.",
    ui: ["Versiones tarifarias", "Tarifa urbana, nocturna y extendida", "Recargo por parada", "Comisión interna por tramo", "Reglas por zonas tarifarias", "Etapas de radio y tiempos"],
    actions: ["Publicar una nueva versión tarifaria.", "Mantener valores históricos sin editar retroactivamente.", "Configurar recargo por parada y comisión.", "Configurar radios progresivos de asignación."],
    workflow: ["Origen/destinos", "Clasificación tarifaria de cada tramo", "Suma de tramos", "Adicionales por paradas", "Comisión interna por tramo", "Total estimado", "Snapshot en el viaje"],
    notes: ["Zona tarifaria, zona operativa y radio de búsqueda son conceptos diferentes.", "El valor sugerido debe ser la suma exacta de conceptos aplicables; la comisión interna se integra al total sin desglose al pasajero."]
  },
  {
    id: "10", file: "10_Zonas_Cobertura", title: "Zonas de cobertura", audience: "Superadministración y gestores territoriales autorizados", access: "Panel → Zonas de cobertura",
    objective: "Gestionar polígonos operativos como fuente única del backend, aplicación y panel.",
    ui: ["Listado y filtros", "Mapa general", "Editor Polygon/MultiPolygon", "Dibujo y edición de vértices", "Importar/exportar GeoJSON", "Audiencia", "Prioridad", "Versiones", "Activación"],
    actions: ["Crear una zona inicialmente inactiva.", "Dibujar o importar geometría WGS84.", "Validar cierre, coordenadas, topología y superposición.", "Previsualizar bounds, área y vértices.", "Activar/desactivar con permisos."],
    workflow: ["Crear metadatos", "Dibujar/importar", "Validar", "Revisar superposiciones", "Guardar versión", "Activar", "Incrementar versión global", "Clientes actualizan caché"],
    notes: ["GeoJSON usa longitud, latitud.", "ATACAMES_PROD y CUENCA_TEST son zonas independientes; la segunda se limita a usuarios autorizados.", "No existe borrado físico de una zona con historia operativa."]
  },
  {
    id: "11", file: "11_Publicidad_Banners", title: "Publicidad y banners", audience: "Administración de publicidad", access: "Panel → Publicidad",
    objective: "Administrar banners directos, vigencia, ubicación visual y estado de publicación.",
    ui: ["Listado de banners", "Vista previa", "Plan", "Momento de visualización", "Peso de rotación", "Fechas", "Estado", "Imagen"],
    actions: ["Crear/editar un banner.", "Elegir momento compatible.", "Definir vigencia y peso.", "Activar o pausar.", "Comprobar que la aplicación consume solo banners vigentes y permitidos."],
    workflow: ["Carga de pieza", "Validación", "Configuración", "Publicación", "Rotación", "Impresión/clic", "Pausa o expiración"],
    notes: ["Básico: búsqueda de conductor. Premium: búsqueda y etapas habilitadas por configuración.", "Esta pantalla es gestión directa; el módulo Comercial agrega lead, orden, pago y aprobación." ],
    details: [
      { title: "Configuración de la pieza", items: ["Seleccionar el plan y el momento mediante las opciones visibles; no escribir códigos internos.", "Cargar una imagen válida y revisar la vista previa.", "Definir inicio, fin y peso de rotación.", "Guardar inicialmente sin asumir que la campaña quedó aprobada."] },
      { title: "Reglas de publicación", items: ["La fecha actual debe estar dentro de la vigencia.", "El banner y su campaña deben estar activos.", "La ubicación visual debe pertenecer al catálogo permitido por backend y base.", "La audiencia/zona debe corresponder al pasajero.", "La rotación ponderada evita repetir inmediatamente el mismo comercio cuando existen alternativas."] },
      { title: "Diagnóstico", items: ["Si no aparece, revisar estado, vigencia, placement, zona, plan y existencia de pieza.", "INVALID_DATA indica validación de entrada; corregir el formulario.", "Un error de restricción SQL es una incidencia técnica: no se debe mostrar al usuario final."] }
    ]
  },
  {
    id: "12", file: "12_Comercial_Leads_Anunciantes", title: "Comercial: chat, leads y anunciantes", audience: "Comercios, asesores comerciales y administración", access: "costa-go.com/anunciarme/ y Panel → Comercial y publicidad",
    objective: "Captar solicitudes comerciales desde web o app y darles seguimiento en el mismo backend sin duplicar conversaciones.",
    ui: ["Chat comercial web", "Chat embebido en la aplicación", "Dashboard comercial", "Leads", "Anunciantes", "Planes y configuración"],
    actions: ["Iniciar/reanudar la conversación.", "Registrar datos del contacto y negocio.", "Seleccionar plan con resumen único.", "Elegir asesor o transferencia.", "Actualizar seguimiento y convertir el lead."],
    workflow: ["Nueva conversación", "Datos de contacto", "Datos del negocio", "Plan", "Confirmación", "Método de atención/pago", "Lead registrado", "Seguimiento", "Conversión o cierre"],
    states: ["NEW", "IN_PROGRESS", "QUALIFIED", "REQUIRES_CONTACT", "CONVERTED", "LOST"],
    notes: ["Web y app usan la misma API y persistencia.", "Cada paso es idempotente: una respuesta confirmada no debe repetirse al recargar o retomar."], screenshot: "chat-comercial.png",
    details: [
      { title: "Conversación", items: ["Cada pregunta se presenta una sola vez; el campo contiene únicamente un placeholder.", "Al confirmar una respuesta, el backend guarda el paso y devuelve el siguiente pendiente.", "Recargar o reabrir recupera la solicitud y continúa desde el último paso.", "Reintentos con la misma clave no crean dos mensajes, leads ni respuestas."] },
      { title: "Selección de plan", items: ["Mostrar una tarjeta única con nombre, precio, duración y beneficios.", "Solicitar confirmación explícita.", "Después de confirmar, preguntar únicamente el siguiente dato necesario.", "Los planes y precios se consultan del backend; web y app no mantienen catálogos paralelos."] },
      { title: "Seguimiento del lead", items: ["Nuevo: captación sin gestión iniciada.", "En gestión: asesor trabajando el caso.", "Calificado: necesidad y datos suficientes.", "Solicita asesor: requiere contacto humano.", "Convertido: originó anunciante/orden.", "No convertido: cierre con motivo, sin borrar historia."] }
    ]
  },
  {
    id: "13", file: "13_Comercial_Ordenes_Pagos_Campanas", title: "Comercial: órdenes, pagos, caja y campañas", audience: "Comercial, finanzas y administración de campañas", access: "Panel → Comercial y publicidad",
    objective: "Gestionar el ciclo auditable desde la propuesta hasta la campaña publicada y conciliada.",
    ui: ["Órdenes", "Registrar cobro", "Pagos", "Cierre de caja", "Conciliación", "Campañas", "Revisión de pieza", "Planes comerciales"],
    actions: ["Crear orden desde lead/anunciante.", "Registrar cobro en efectivo o transferencia.", "Adjuntar referencia/comprobante.", "Cerrar caja de efectivo.", "Conciliar desde Finanzas.", "Revisar y publicar campaña."],
    workflow: ["Lead convertido", "Anunciante", "Orden", "Pago recibido pendiente de conciliación", "Cierre si es efectivo", "Conciliación financiera", "Orden pagada", "Campaña pendiente de revisión", "Aprobada/programada/activa"],
    states: ["DRAFT", "PENDING_PAYMENT", "PAYMENT_REVIEW", "PENDING_REVIEW", "APPROVED", "SCHEDULED", "ACTIVE", "PAUSED", "REJECTED", "EXPIRED", "CANCELLED"],
    notes: ["Comercial registra; Finanzas concilia. La orden no pasa a pagada por una declaración sin validación.", "Errores SQL nunca se muestran al usuario; la UI traduce códigos de negocio." ],
    details: [
      { title: "Cobro en efectivo", items: ["Abrir la orden y seleccionar Registrar cobro.", "Elegir Efectivo e ingresar el monto recibido.", "Guardar: el pago queda recibido y pendiente de conciliación.", "El pago aparece en la caja abierta del comercial/recaudador.", "Cerrar caja una sola vez; pagos ya incluidos desaparecen del pendiente.", "Finanzas concilia el cierre con una referencia y recién entonces confirma el pago."] },
      { title: "Cobro por transferencia", items: ["Elegir Transferencia.", "Registrar monto y referencia.", "Adjuntar comprobante permitido cuando corresponda.", "Guardar como pendiente de revisión.", "Finanzas valida referencia, importe y duplicidad; aprueba o rechaza con motivo."] },
      { title: "Paso a campaña", items: ["La orden solo queda pagada luego de conciliación.", "La campaña pasa a pendiente de revisión, no directamente a activa.", "Revisión comprueba pieza, vigencia, plan, zona, placement y contenido.", "Aprobada/programada se activa al llegar la vigencia; pausa, rechazo o expiración conservan historial."] },
      { title: "Segregación y auditoría", items: ["COMMERCIAL registra lead, orden y cobro.", "FINANCE revisa y concilia.", "Un usuario con permisos de campaña aprueba/publica.", "Cada transición guarda actor, fecha, entidad y motivo; no se elimina un cobro para corregirlo."] }
    ]
  },
  {
    id: "14", file: "14_Soporte_Incidentes_FAQ", title: "Soporte, incidentes y preguntas frecuentes", audience: "Soporte, operaciones y administración", access: "Panel → Soporte e incidentes",
    objective: "Gestionar solicitudes de pasajeros/conductores, incidentes, adjuntos y base de preguntas frecuentes.",
    ui: ["Bandeja y filtros", "Detalle de solicitud", "Viaje relacionado", "Categoría/prioridad", "Asignación", "Conversación", "Adjuntos", "Incidentes", "Preguntas frecuentes"],
    actions: ["Clasificar y asignar.", "Responder sin exponer datos innecesarios.", "Cambiar estado con trazabilidad.", "Relacionar viaje cuando corresponda.", "Publicar/ordenar FAQs."],
    workflow: ["Nuevo", "Asignado", "En revisión", "Esperando usuario", "Resuelto", "Cerrado"],
    states: ["NUEVO", "ASIGNADO", "EN_REVISION", "ESPERANDO_USUARIO", "RESUELTO", "CERRADO"],
    notes: ["Los adjuntos validan tipo y tamaño.", "Soporte no obtiene por defecto acceso a auditoría, credenciales o configuración." ]
  },
  {
    id: "15", file: "15_Auditoria_Base_Datos_Configuracion", title: "Auditoría, base de datos y configuración", audience: "Superadministración y personal técnico autorizado", access: "Panel → Auditoría / PostgreSQL / parámetros específicos",
    objective: "Consultar trazabilidad y salud técnica sin convertir el panel en acceso irrestricto a datos sensibles.",
    ui: ["Eventos de auditoría", "Actor, acción, entidad y motivo", "Estado de PostgreSQL", "Parámetros operativos por módulo"],
    actions: ["Filtrar eventos críticos.", "Relacionar cambios de zonas, roles, membresías, pagos y campañas.", "Comprobar disponibilidad de base.", "Modificar parámetros mediante formularios validados."],
    workflow: ["Acción sensible", "Validación de permiso", "Transacción", "Registro de auditoría", "Consulta/seguimiento"],
    notes: ["No registrar claves, tokens ni documentos en texto de auditoría.", "No ejecutar SQL arbitrario desde la interfaz operativa." ]
  }
];

function section(title, body, id = slug(title)) { return `<section id="${id}"><h2>${esc(title)}</h2>${body}</section>`; }
function list(items) { return `<ul>${items.map(item => `<li>${esc(item)}</li>`).join("")}</ul>`; }
function steps(items) { return `<div class="flow">${items.map((item, i) => `<div class="flow-step"><b>${i + 1}</b><span>${esc(item)}</span></div>`).join("")}</div>`; }
function table(headers, rows) { return `<div class="table"><table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`; }

const css = `
@page { size: A4; margin: 18mm 15mm 18mm; }
*{box-sizing:border-box} body{font-family:Arial,"Segoe UI",sans-serif;color:#0a3344;margin:0;font-size:10.5pt;line-height:1.48;background:white} h1,h2,h3{color:#073a5d;page-break-after:avoid} h1{font-size:29pt;margin:10px 0} h2{font-size:18pt;border-bottom:2px solid #0aaee6;padding-bottom:5px;margin-top:28px} h3{font-size:13pt;margin-top:19px} p{margin:7px 0} a{color:#047cad} ul{padding-left:20px} li{margin:4px 0}.cover{min-height:245mm;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;background:linear-gradient(135deg,#032a4b 0%,#07598b 60%,#05b9ec 100%);color:white;margin:-18mm -15mm;padding:28mm;page-break-after:always}.cover h1,.cover h2{color:white;border:0}.cover .logo{width:110px;height:110px;object-fit:contain;margin-bottom:24px}.cover .kind{letter-spacing:2px;text-transform:uppercase;font-weight:700;color:#8de3ff}.cover .meta{margin-top:30px;border-left:4px solid #25cef5;padding-left:15px}.toc{page-break-after:always}.toc a{text-decoration:none}.notice{border-left:5px solid #0aaee6;background:#eaf8fc;padding:12px 14px;margin:12px 0;border-radius:6px}.warning{border-left-color:#efaa22;background:#fff7e7}.pending{border-left-color:#d94b4b;background:#fff0f0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.card{border:1px solid #cfe0e7;border-radius:10px;padding:13px;background:#fbfdfe;page-break-inside:avoid}.card strong{color:#006f95}.flow{display:flex;flex-wrap:wrap;gap:7px;margin:12px 0}.flow-step{display:flex;align-items:center;gap:7px;border:1px solid #b9d7e1;background:#f4fbfd;border-radius:22px;padding:7px 11px}.flow-step b{display:grid;place-items:center;background:#078fbd;color:white;border-radius:50%;min-width:22px;height:22px}.table{overflow:hidden;border:1px solid #cbdde4;border-radius:8px;margin:10px 0}table{width:100%;border-collapse:collapse;font-size:8.8pt}th{background:#073a5d;color:white;text-align:left}th,td{padding:7px 8px;border-bottom:1px solid #dbe7ec;vertical-align:top}tr:nth-child(even) td{background:#f5fafc}.screenshot{display:block;max-width:100%;max-height:170mm;margin:12px auto;border:1px solid #cbdde4;border-radius:10px;object-fit:contain}.caption{font-size:8.5pt;text-align:center;color:#55717c}.footer{position:fixed;bottom:-12mm;left:0;right:0;text-align:center;color:#67808a;font-size:8pt}.footer::after{content:" · Página " counter(page)}.badge{display:inline-block;border-radius:12px;padding:3px 8px;background:#e2f4f8;color:#07556f;font-size:8.5pt;margin:2px}.code{font-family:Consolas,monospace;background:#edf3f5;border-radius:4px;padding:2px 5px}.page-break{page-break-before:always}.diagram{border:1px solid #b9d7e1;border-radius:10px;padding:18px;text-align:center;background:#f7fcfe;page-break-inside:avoid}.diagram .row{display:flex;justify-content:center;align-items:stretch;gap:10px;flex-wrap:wrap}.diagram .node{border:2px solid #078fbd;border-radius:9px;padding:10px;background:white;min-width:120px}.diagram .arrow{align-self:center;color:#078fbd;font-weight:bold;font-size:18px}@media print{.no-print{display:none}}
`;

function pageShell(title, kind, content, toc = []) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body>
  <div class="footer">Costa-Go · ${esc(title)} · Documento controlado v${version}</div>
  <header class="cover"><img class="logo" src="../assets/costa-go-emblem.png"><div class="kind">${esc(kind)}</div><h1>${esc(title)}</h1><p>Documentación oficial del ecosistema web Costa-Go</p><div class="meta"><b>Versión:</b> ${version}<br><b>Actualizado:</b> ${esc(dateText)}<br><b>Fuente:</b> repositorio <span class="code">main</span></div></header>
  ${toc.length ? `<nav class="toc"><h2>Contenido</h2><ol>${toc.map(item => `<li><a href="#${esc(item.id)}">${esc(item.title)}</a></li>`).join("")}</ol><div class="notice">Este documento describe únicamente funciones verificadas en el código fuente actual. Toda limitación se identifica de forma expresa.</div></nav>` : ""}
  ${content}</body></html>`;
}

function writeHtml(fileName, title, kind, content, toc) {
  const file = path.join(htmlDir, `${fileName}.html`);
  fs.writeFileSync(file, pageShell(title, kind, content, toc));
  return file;
}

const manualOutputs = [];
for (const manual of manuals) {
  const toc = ["Ficha del módulo", "Objetivo y acceso", "Interfaz", "Acciones", "Flujo operativo", "Estados", ...(manual.details ? ["Procedimiento detallado"] : []), "Controles y recomendaciones", ...(manual.screenshot ? ["Referencia visual"] : [])].map(title => ({ title, id: slug(title) }));
  const states = manual.states ?? [];
  const content =
    section("Ficha del módulo", table(["Campo", "Descripción"], [["Módulo", `<b>${esc(manual.title)}</b>`], ["Usuarios", esc(manual.audience)], ["Acceso", esc(manual.access)], ["Fuente de verdad", "API y base PostgreSQL de Costa-Go"]])) +
    section("Objetivo y acceso", `<p>${esc(manual.objective)}</p><div class="notice"><b>Acceso:</b> ${esc(manual.access)}. El backend valida sesión, permiso y alcance; la visibilidad del menú por sí sola no autoriza una acción.</div>`) +
    section("Interfaz", `<div class="grid">${manual.ui.map(item => `<div class="card"><strong>${esc(item)}</strong><p>Elemento verificado en la interfaz o flujo actual.</p></div>`).join("")}</div>`) +
    section("Acciones", list(manual.actions)) +
    section("Flujo operativo", steps(manual.workflow)) +
    section("Estados", states.length ? table(["Código interno", "Presentación operativa"], states.map(state => [esc(state), esc(statusLabels[state] ?? state)])) : `<p>El módulo consulta estados propios de las entidades relacionadas; no introduce un catálogo adicional.</p>`) +
    (manual.details ? section("Procedimiento detallado", manual.details.map(detail => `<div class="card"><h3>${esc(detail.title)}</h3>${list(detail.items)}</div>`).join("")) : "") +
    section("Controles y recomendaciones", list(manual.notes ?? ["Confirmar el resultado antes de abandonar la pantalla.", "No compartir credenciales ni documentos descargados."])) +
    (manual.screenshot && fs.existsSync(path.join(captureDir, manual.screenshot)) ? section("Referencia visual", `<img class="screenshot" src="../capturas/${esc(manual.screenshot)}"><p class="caption">Captura real obtenida de la versión web publicada, sin datos privados.</p>`) : "");
  manualOutputs.push({ html: writeHtml(manual.file, manual.title, "Manual funcional web", content, toc), pdf: path.join(outManuals, `${manual.file}.pdf`) });
}

const indexToc = ["Propósito", "Mapa del ecosistema", "Catálogo de manuales", "Roles", "Convenciones", "Alcance y pendientes"].map(title => ({ title, id: slug(title) }));
const indexContent =
  section("Propósito", `<p>Este índice organiza los manuales funcionales del ecosistema web Costa-Go. No es un manual de uso de la aplicación móvil.</p>`) +
  section("Mapa del ecosistema", `<div class="diagram"><div class="row"><div class="node"><b>costa-go.com</b><br>Sitio y chat comercial</div><div class="arrow">→</div><div class="node"><b>API Costa-Go</b><br>Reglas y permisos</div><div class="arrow">↔</div><div class="node"><b>PostgreSQL/PostGIS</b><br>Fuente transaccional</div></div><br><div class="row"><div class="node"><b>Panel administrativo</b><br>Operación y gestión</div><div class="arrow">↗</div><div class="node"><b>Servicios externos</b><br>Google, FCM, Resend, Sentry</div></div></div>`) +
  section("Catálogo de manuales", table(["Documento", "Contenido", "Audiencia"], manuals.map(m => [`${m.id}. ${esc(m.title)}`, esc(m.objective), esc(m.audience)]))) +
  section("Roles", table(["Rol", "Responsabilidad"], roles.map(([role, desc]) => [esc(role), esc(desc)]))) +
  section("Convenciones", list(["Los códigos internos se muestran en tipografía monoespaciada y su etiqueta visual en español.", "Una acción administrativa requiere el permiso indicado por el backend.", "Los estados históricos no se reescriben para simular un estado actual.", "Las capturas evitan credenciales y datos personales."])) +
  section("Alcance y pendientes", `<div class="notice">Incluye sitio público, panel administrativo, portal de recaudación y chat comercial. La aplicación móvil solo se menciona como sistema relacionado en documentos técnicos.</div><div class="pending"><b>Pendiente operativo:</b> ampliar capturas autenticadas por módulo cuando se disponga de una sesión de documentación sin datos reales sensibles. Los procedimientos y controles sí se documentan a partir del código actual.</div>`);
const indexOutput = { html: writeHtml("00_Indice_General_Manuales_Web", "Índice general de manuales web", "Catálogo funcional", indexContent, indexToc), pdf: path.join(outManuals, "00_Indice_General_Manuales_Web.pdf") };

const architectureMermaid = `flowchart TB
  P[Pasajeros] --> M[Aplicación Flutter]
  D[Conductores] --> M
  V[Visitantes y comercios] --> S[Sitio costa-go.com]
  A[Administración y roles] --> W[Panel React/Vite]
  C[Recaudadores] --> W
  M -->|HTTPS / WebSocket| API[API Fastify]
  S -->|HTTPS| API
  W -->|HTTPS| API
  API --> DB[(PostgreSQL + PostGIS)]
  API --> FCM[Firebase Cloud Messaging]
  API --> MAIL[Resend]
  API --> GM[Google Maps Platform]
  API --> ORS[OpenRouteService fallback]
  API --> OBS[Sentry / OpenTelemetry]
  R[Render] -. despliega .-> API
  R -. despliega .-> W
  R -. despliega .-> S`;
fs.writeFileSync(path.join(diagramDir, "arquitectura-costa-go.mmd"), architectureMermaid);

const erMermaid = `erDiagram
  USERS ||--o| DRIVERS : "perfil conductor"
  USERS ||--o{ TRIPS : "solicita o conduce"
  COOPERATIVES ||--o{ USERS : agrupa
  TRIPS ||--o{ TRIP_STOPS : contiene
  TRIPS ||--o{ TRIP_EVENTS : registra
  USERS ||--o{ SUPPORT_TICKETS : crea
  SERVICE_AREAS ||--o{ SERVICE_AREA_VERSIONS : versiona
  DRIVERS ||--o{ DRIVER_MEMBERSHIPS : mantiene
  MEMBERSHIP_PLANS ||--o{ DRIVER_MEMBERSHIPS : define
  MEMBERSHIP_PAYMENT_ORDERS ||--o{ MEMBERSHIP_PAYMENTS : liquida
  COLLECTION_POINTS ||--o{ COLLECTION_POINT_CLOSURES : cierra
  ADVERTISING_LEADS ||--o| ADVERTISERS : convierte
  ADVERTISERS ||--o{ ADVERTISING_ORDERS : contrata
  ADVERTISING_ORDERS ||--o{ ADVERTISING_PAYMENTS : recibe
  ADVERTISING_ORDERS ||--o{ ADVERTISING_CAMPAIGNS : habilita
  ADVERTISING_CAMPAIGNS ||--o{ AFFILIATE_BANNERS : publica
  USERS ||--o{ AUDIT_LOG : ejecuta`;
fs.writeFileSync(path.join(diagramDir, "modelo-datos-costa-go.mmd"), erMermaid);

fs.writeFileSync(path.join(diagramDir, "estados-viaje.mmd"), `stateDiagram-v2
  [*] --> SEARCHING
  SEARCHING --> ASSIGNED
  ASSIGNED --> DRIVER_EN_ROUTE
  DRIVER_EN_ROUTE --> DRIVER_ARRIVED
  DRIVER_ARRIVED --> IN_PROGRESS
  IN_PROGRESS --> COMPLETED
  SEARCHING --> CANCELLED
  ASSIGNED --> CANCELLED
  DRIVER_EN_ROUTE --> CANCELLED`);
fs.writeFileSync(path.join(diagramDir, "flujo-comercial.mmd"), `flowchart LR
  CHAT[Chat web/app] --> LEAD[Lead]
  LEAD --> ADV[Anunciante]
  ADV --> ORDER[Orden]
  ORDER --> PAY[Pago recibido]
  PAY --> CLOSE[Cierre de caja si efectivo]
  CLOSE --> FIN[Conciliación Finanzas]
  FIN --> REVIEW[Campaña a revisión]
  REVIEW --> ACTIVE[Campaña activa]`);
fs.writeFileSync(path.join(diagramDir, "flujo-membresias.mmd"), `flowchart LR
  APPROVED[Conductor aprobado] --> GRACE[Gracia/Pendiente]
  GRACE --> ORDER[Orden QR]
  ORDER --> PAYMENT[Pago verificado]
  PAYMENT --> ACTIVE[Activa]
  ACTIVE --> EXPIRING[Próxima a vencer]
  EXPIRING --> DUE[Pago pendiente]
  DUE --> SUSPENDED[Suspendida]
  DUE --> PAYMENT`);

const techDocs = [];
function addTech(file, title, toc, content) { techDocs.push({ html: writeHtml(file, title, "Documentación técnica", content, toc.map(t => ({ title: t, id: slug(t) }))), pdf: path.join(outTech, `${file}.pdf`) }); }

addTech("01_Arquitectura_Costa_Go", "Arquitectura del ecosistema Costa-Go",
  ["Resumen ejecutivo", "Componentes", "Flujo de una solicitud", "Servicios externos", "Disponibilidad y observabilidad", "Diagrama editable"],
  section("Resumen ejecutivo", `<p>Costa-Go es un monorepo con aplicación móvil Flutter, panel React/Vite, API Fastify, sitio público estático y PostgreSQL/PostGIS. Las reglas de negocio residen en la API; los clientes no son fuente de verdad.</p>`) +
  section("Componentes", table(["Componente", "Tecnología", "Responsabilidad"], [["Aplicación", "Flutter/Dart", "Pasajero, conductor, mapas, realtime y notificaciones"], ["Panel", "React 19 + Vite + TypeScript", "Operación, administración, comercial, finanzas y soporte"], ["Sitio", "HTML/CSS/JS generado", "Información pública y chat comercial"], ["API", "Fastify 5 + TypeScript", "Autenticación, RBAC, reglas, WebSocket e integraciones"], ["Datos", "PostgreSQL + PostGIS", "Transacciones, geometrías y trazabilidad"], ["Infraestructura", "Render", "API, sitios estáticos y base administrada"]])) +
  section("Flujo de una solicitud", steps(["Cliente envía HTTPS", "Fastify valida esquema y sesión", "RBAC/alcance autoriza", "Servicio ejecuta transacción", "PostgreSQL confirma", "Se registra auditoría/evento", "Realtime/push/email comunica", "Cliente reconcilia estado actual"])) +
  section("Servicios externos", table(["Servicio", "Uso", "Control"], [["Google Maps Platform", "Mapas, Places, rutas/geocodificación según configuración", "Claves restringidas y presupuesto"], ["OpenRouteService", "Fallback de rutas configurado", "No sustituye Places"], ["Firebase FCM", "Push Android/iOS", "Tokens asociados y sin exponer credenciales"], ["Resend", "Correos transaccionales", "Dominio costa-go.com validado"], ["Sentry/OpenTelemetry", "Errores y diagnóstico", "Sin datos privados ni secretos"]])) +
  section("Disponibilidad y observabilidad", list(["API Starter y PostgreSQL Basic-1gb según render.yaml.", "Healthcheck /health; logs estructurados; Sentry condicionado por variables.", "Schedulers de viajes programados, membresías y notificaciones deben correr en instancia no suspendible.", "WebSocket complementa push; al reconectar se consulta estado actual."])) +
  section("Diagrama editable", `<pre>${esc(architectureMermaid)}</pre><p>Fuente editable: <span class="code">docs/fuentes/diagramas/arquitectura-costa-go.mmd</span></p>`));

const groupedTables = tableInventory.reduce((acc, item) => { const prefix = item.name.split("_")[0]; (acc[prefix] ??= []).push(item); return acc; }, {});
addTech("02_Modelo_Base_Datos", "Modelo de datos Costa-Go",
  ["Principios", "Dominios", "Relaciones principales", "Diagrama editable", "Migraciones"],
  section("Principios", list(["PostgreSQL es la fuente transaccional.", "PostGIS soporta zonas Polygon/MultiPolygon y validación espacial.", "Los cambios se aplican mediante migraciones idempotentes.", "Entidades históricas se archivan o desactivan cuando corresponde; no se destruyen para ocultarlas."])) +
  section("Dominios", table(["Dominio", "Tablas detectadas"], Object.entries(groupedTables).map(([prefix, items]) => [esc(prefix), esc(items.map(i => i.name).join(", "))]))) +
  section("Relaciones principales", `<p>Usuarios se relacionan con roles de aplicación, conductores, cooperativas y viajes. Los viajes conservan paradas y eventos. Membresías y publicidad separan órdenes, pagos, cierres/conciliaciones y vigencia. Zonas conservan versiones y autorizaciones.</p>`) +
  section("Diagrama editable", `<pre>${esc(erMermaid)}</pre><p>Fuente editable: <span class="code">docs/fuentes/diagramas/modelo-datos-costa-go.mmd</span></p>`) +
  section("Migraciones", `<p>Se detectaron ${migrations.length} archivos SQL bajo <span class="code">apps/api/migrations</span>. El inventario generado registra ${tableInventory.length} tablas. No debe alterarse producción fuera del mecanismo de migraciones.</p>`));

const dictionaryRows = tableInventory.flatMap(item => item.columns.length ? item.columns.map((col, index) => [index === 0 ? `<b>${esc(item.name)}</b>` : "", `<span class="code">${esc(col.name)}</span>`, esc(col.definition), esc(item.sources.at(-1) ?? "")]) : [[`<b>${esc(item.name)}</b>`, "—", "Tabla detectada; columnas creadas mediante SQL dinámico o migración no parseable automáticamente.", esc(item.sources.at(-1) ?? "")]]);
addTech("03_Diccionario_Datos", "Diccionario de datos Costa-Go",
  ["Alcance", "Catálogo de tablas", "Protección", "Limitaciones del inventario"],
  section("Alcance", `<p>Inventario generado directamente desde las migraciones versionadas. Total detectado: <b>${tableInventory.length} tablas</b>.</p>`) +
  section("Catálogo de tablas", table(["Tabla", "Columna", "Definición SQL", "Fuente"], dictionaryRows)) +
  section("Protección", list(["Identificadores y estados se usan para integridad, no como texto de interfaz.", "Contraseñas se almacenan como hash; tokens y claves no forman parte de este documento.", "Documentos y comprobantes requieren acceso autorizado.", "Datos eliminados se excluyen de vistas operativas y se retienen solo conforme a política/historia."])) +
  section("Limitaciones del inventario", `<div class="warning">El parser documental no sustituye el catálogo del motor. Definiciones añadidas mediante bloques SQL complejos pueden aparecer resumidas. La fuente normativa sigue siendo cada migración y el esquema desplegado.</div>`));

const endpointRows = endpoints.map(e => [`<b>${e.method}</b>`, `<span class="code">${esc(e.route)}</span>`, esc(e.permission), `<span class="code">${esc(e.source)}:${e.line}</span>`]);
addTech("04_API_Servicios", "API y servicios Costa-Go",
  ["Convenciones", "Catálogo de endpoints", "Realtime", "Errores", "Integraciones"],
  section("Convenciones", list(["Base productiva administrada por Render y consumida mediante HTTPS.", "Cuerpos y parámetros se validan con Zod o validación equivalente.", "La sesión/rol no se confía al cliente.", "Los códigos de negocio se traducen a mensajes claros en UI; no se exponen errores SQL."])) +
  section("Catálogo de endpoints", `<p>Se detectaron <b>${endpoints.length}</b> rutas Fastify.</p>${table(["Método", "Ruta", "Acceso detectado", "Fuente"], endpointRows)}`) +
  section("Realtime", `<p>El WebSocket se usa para actualizaciones inmediatas de viajes y mensajes. La reconexión debe reconciliar contra la API para evitar depender de un evento perdido o duplicado.</p>`) +
  section("Errores", table(["Clase", "Respuesta esperada"], [["Validación", "400 con código estable"], ["Sesión", "401"], ["Permiso", "403 FORBIDDEN"], ["No encontrado", "404"], ["Conflicto de negocio", "409"], ["Error interno", "500 genérico; detalle solo en observabilidad"]])) +
  section("Integraciones", list(["Firebase Admin para push.", "Resend para correo transaccional.", "Google Maps/Routes/Places y fallback ORS según configuración.", "Sentry/OpenTelemetry para diagnóstico."])));

addTech("05_Reglas_Negocio_Estados", "Reglas de negocio y estados Costa-Go",
  ["Viajes", "Membresías", "Comercial y publicidad", "Soporte", "Zonas"],
  section("Viajes", table(["Código", "Etiqueta"], ["SEARCHING","ASSIGNED","DRIVER_EN_ROUTE","DRIVER_ARRIVED","IN_PROGRESS","COMPLETED","CANCELLED","SCHEDULED","SCHEDULED_ASSIGNED","SCHEDULED_READY","ACTIVATED"].map(s => [s, statusLabels[s] ?? s]))) +
  section("Membresías", `<p>La elegibilidad depende de aprobación, documentos y estado del ciclo. Una suspensión por falta de pago nunca interrumpe un viaje activo.</p>${table(["Código", "Etiqueta"], ["PENDING","ACTIVE","EXPIRING","GRACE_PERIOD","PAYMENT_DUE","SUSPENSION_PENDING_ACTIVE_TRIP","SUSPENDED_NON_PAYMENT","SUSPENDED","CLOSED"].map(s => [s, statusLabels[s] ?? s]))}`) +
  section("Comercial y publicidad", `<p>Un cobro registrado queda pendiente de conciliación. Solo Finanzas confirma y permite que la orden quede pagada y la campaña pase a revisión.</p>${steps(["Lead", "Anunciante", "Orden", "Pago", "Conciliación", "Revisión", "Campaña activa"])}`) +
  section("Soporte", steps(["Nuevo", "Asignado", "En revisión", "Esperando usuario", "Resuelto", "Cerrado"])) +
  section("Zonas", list(["Origen y destinos deben estar dentro de la misma zona autorizada salvo regla explícita.", "CUENCA_TEST requiere autorización de tester/revisión.", "Cambiar geometría incrementa versión e invalida caché."])));

addTech("06_Seguridad_Privacidad", "Seguridad y privacidad Costa-Go",
  ["Modelo de amenazas", "Controles", "Datos personales", "Archivos", "Auditoría", "Respuesta a incidentes"],
  section("Modelo de amenazas", list(["Suplantación de sesión/rol.", "Acceso entre cooperativas.", "Aceptación concurrente de viajes.", "Exposición de documentos o comprobantes.", "Manipulación de pagos, zonas o campañas.", "Abuso de tokens push o secretos."])) +
  section("Controles", table(["Control", "Aplicación"], [["RBAC", "Permisos validados por endpoint"], ["Alcance", "Cooperativa y audiencias de zona"], ["Transacciones", "Aceptación, pagos y cierres con bloqueo/condiciones"], ["Sesiones", "Sesión activa y revocación al restablecer clave"], ["Transporte", "HTTPS/TLS"], ["Secretos", "Variables de entorno; nunca documentados"], ["Observabilidad", "Sentry/logs sin PII innecesaria"]])) +
  section("Datos personales", `<p>Aplicar minimización: soporte y comercial solo acceden a datos necesarios. La eliminación de cuenta se gestiona desde la URL pública y conserva únicamente información requerida por integridad, seguridad o retención publicada.</p>`) +
  section("Archivos", list(["Validar MIME, tamaño y extensión.", "No confiar en el nombre de archivo.", "Servir mediante endpoint autorizado o URL temporal.", "Permitir imagen/PDF donde el flujo lo admite."])) +
  section("Auditoría", `<p>Roles, zonas, documentos, membresías, pagos, conciliaciones y campañas generan eventos relevantes con actor, entidad, acción, fecha y motivo.</p>`) +
  section("Respuesta a incidentes", steps(["Detectar", "Contener", "Preservar evidencia", "Corregir", "Notificar si corresponde", "Revisar controles"])));

addTech("07_Despliegue_Operacion", "Despliegue y operación Costa-Go",
  ["Servicios Render", "Construcción", "Variables", "Migraciones", "Verificación", "Rollback"],
  section("Servicios Render", table(["Servicio", "Tipo", "Configuración versionada"], [["mototaxi-atacames-api", "Web service Docker", "Starter; health /health"], ["mototaxi-atacames-admin", "Static site", "apps/admin/dist"], ["costa-go-web", "Static site", "apps/site/dist"], ["mototaxi-atacames-db", "PostgreSQL", "Basic-1gb; 5 GB; Virginia"]])) +
  section("Construcción", list(["pnpm install --frozen-lockfile", "pnpm --filter @mototaxi/api build", "pnpm --filter @mototaxi/admin build", "pnpm --filter @mototaxi/site build", "Migraciones mediante el script versionado antes de iniciar API."])) +
  section("Variables", `<div class="warning">Configurar en Render/Firebase/Google/Resend/Sentry. Nunca copiar valores secretos a Git o manuales.</div>${list(["DATABASE_URL", "JWT/session secrets", "Firebase service account", "Resend API key y remitente", "Google Maps/Routes/Places keys", "Sentry DSN", "URLs públicas y CORS"])}`) +
  section("Migraciones", `<p>Las migraciones deben ser idempotentes y registrar su ejecución. Ante un error, corregir la migración con una nueva versión segura; no borrar historia ni ejecutar cambios destructivos improvisados.</p>`) +
  section("Verificación", steps(["Build limpio", "Migración", "Healthcheck", "Login panel", "Consulta API", "Realtime/push", "Flujo crítico", "Observabilidad sin errores"])) +
  section("Rollback", list(["Conservar artefacto anterior.", "Revertir aplicación antes que datos cuando el esquema es compatible.", "No hacer rollback destructivo de migraciones con datos.", "Documentar incidente y restauración."])));

const traceRows = manuals.map(m => [esc(m.title), esc(m.access), esc(m.audience), esc(m.workflow.at(-1)), esc(m.notes?.at(0) ?? "Control del módulo")]);
addTech("08_Matriz_Trazabilidad", "Matriz de trazabilidad Costa-Go",
  ["Matriz funcional", "Responsabilidades", "Pendientes documentales"],
  section("Matriz funcional", table(["Módulo", "Acceso", "Actor", "Resultado", "Control"], traceRows)) +
  section("Responsabilidades", table(["Actor", "Responsabilidad"], roles.map(([r,d]) => [esc(r), esc(d)]))) +
  section("Pendientes documentales", `<div class="pending"><b>Pendiente:</b> incorporar un set adicional de capturas autenticadas anonimizadas por cada módulo cuando exista una sesión específica de documentación. No bloquea el uso de los procedimientos actuales.</div>`));

const allOutputs = [indexOutput, ...manualOutputs, ...techDocs];
fs.writeFileSync(path.join(inventoryDir, "documentos.json"), JSON.stringify(allOutputs.map(item => ({ source: rel(item.html), pdf: rel(item.pdf) })), null, 2));

const readme = `# Documentación Costa-Go

Generada el ${dateText} desde la rama \`main\` del repositorio.

## Contenido

- \`docs/manuales_usuario/\`: índice general y ${manuals.length} manuales funcionales del ecosistema web.
- \`docs/tecnica/\`: arquitectura, datos, API, reglas, seguridad, despliegue y trazabilidad.
- \`docs/fuentes/html/\`: fuentes HTML editables utilizadas para los PDF.
- \`docs/fuentes/diagramas/\`: diagramas Mermaid editables.
- \`docs/fuentes/inventarios/\`: catálogos JSON generados desde rutas y migraciones.
- \`docs/fuentes/capturas/\`: capturas públicas sin credenciales ni datos privados.

## Regeneración

1. Instalar dependencias del monorepo.
2. Ejecutar desde la raíz: \`node docs/fuentes/generar-documentacion.mjs\`.
3. Ejecutar: \`powershell -ExecutionPolicy Bypass -File docs/fuentes/generar-pdfs.ps1\`.

El script de PDF busca Google Chrome o Microsoft Edge instalados. Los PDF se generan sin cabeceras del navegador y con pie/versionado propio.

## Criterio documental

La documentación describe funciones verificadas en código. Los códigos internos permanecen intactos; las etiquetas visibles se presentan en español. Funciones no verificadas se identifican como pendientes. Los manuales funcionales cubren únicamente superficies web; la aplicación móvil se incluye solo como dependencia del sistema en documentación técnica.
`;
fs.writeFileSync(path.join(root, "docs/README_DOCUMENTACION.md"), readme);

const sourceManifest = `# Manifiesto de fuentes documentales

Este paquete fue contrastado con el código vigente del monorepo. Las fuentes principales son:

| Área | Fuentes verificadas |
|---|---|
| Navegación y módulos del panel | \`apps/admin/src/main.tsx\` y componentes \`*-admin.tsx\` |
| Autorización | \`apps/api/src/permissions.ts\`, autenticación y validadores de cada ruta |
| Viajes y realtime | \`apps/api/src/app.ts\`, \`driver.ts\`, \`passenger.ts\`, \`realtime.ts\` |
| Soporte e incidentes | \`apps/api/src/support.ts\`, \`support-admin.ts\` |
| Zonas de cobertura | \`apps/api/src/service-areas.ts\` y editor web de zonas |
| Membresías y recaudación | \`apps/api/src/memberships.ts\`, \`apps/admin/src/memberships-admin.tsx\` |
| Publicidad y comercial | rutas/componentes de advertising/commercial en API, panel y sitio |
| Sitio público | \`apps/site/src\` y su generador de build |
| Datos | ${migrations.length} migraciones bajo \`apps/api/migrations\` |
| Infraestructura | \`render.yaml\`, Dockerfiles y scripts de paquetes |

Inventarios reproducibles:

- \`inventarios/endpoints.json\`: ${endpoints.length} endpoints detectados, con archivo y línea.
- \`inventarios/tablas.json\`: ${tableInventory.length} tablas detectadas, columnas y migración fuente.
- \`inventarios/documentos.json\`: relación entre cada fuente HTML y su PDF.

Las capturas se limitaron a superficies públicas accesibles sin credenciales. Las capturas autenticadas adicionales figuran como pendiente para evitar incorporar datos reales o secretos en el repositorio.
`;
fs.writeFileSync(path.join(sourceDir, "MANIFIESTO_FUENTES.md"), sourceManifest);

console.log(JSON.stringify({ manuals: manuals.length + 1, technical: techDocs.length, endpoints: endpoints.length, tables: tableInventory.length, outputs: allOutputs.length }, null, 2));
