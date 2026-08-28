# Centro de control Costa-Go

Entrega: 28/08/2026. Rediseño sobre el panel existente, sin cambios de APK/AAB ni migraciones de base de datos.

## Alcance y compatibilidad

Todas las vistas autenticadas usan una estructura común: navegación agrupada, encabezado global, breadcrumbs, título/propósito, contenido operativo y pie de estado. Se mantienen las rutas, las acciones existentes, los roles y las validaciones del servidor. No se cambian tarifas, membresías, cobros, conciliaciones, asignación de viajes ni permisos de conducción/flota.

La nueva ruta Inicio reúne indicadores autorizados de los servicios existentes. La bienvenida utiliza el icono de mototaxi del proyecto y una composición costera ligera en CSS/SVG; no introduce un logotipo alternativo. Respeta reducción de movimiento. El logotipo oficial se mantiene en la navegación y el pie.

## Sistema compartido y archivos

| Archivo en apps/admin/src | Responsabilidad |
| --- | --- |
| console-model.ts | Catálogo de módulos y grupos, enlaces con filtros, fechas Ecuador, USD, normalización de búsqueda y exportación segura. |
| console-layout.tsx | Sidebar colapsable, encabezado, búsqueda global, favoritos/recientes por usuario, breadcrumbs, permisos y comprobación de API. |
| console-home.tsx | Bienvenida, indicadores reales, tendencias, accesos por rol, actividad y estado de servicios. |
| console-map.tsx | Mapa operativo solicitado explícitamente, con posiciones reales, limpieza y reintento. |
| console-ui.tsx | Contexto, persistencia de filtros, modal accesible, indicadores, carga/error, tablas y acciones compactas. |
| console-system.css | Tokens, identidad, estilos de todas las vistas, estados, formularios, modales y responsive. |
| main.tsx | Integración de todas las rutas, módulos principales, filtros, detalles y carga diferida. |
| api.ts | Errores legibles, sin exponer SQL al usuario. |
| commercial-admin.tsx | Indicadores enlazados, filtros y paginación de servidor para prospectos, comercios, órdenes, pagos y campañas. |
| memberships-admin.tsx | Membresías, cobranza, transferencias, puntos, cierres y configuración con tablas y filtros comunes. |
| fiscal-admin.tsx | Finanzas, documentos, clientes, pagos y reportes con filtros, paginación y estados comunes. |
| fleet-admin.tsx / fleet-report.tsx | Flota, jornadas e informes, respetando el alcance de propietario/cooperativa. |
| support-admin.tsx | Casos, prioridades, FAQ, detalles y estados vacíos. |
| passenger-cancellations.tsx | Historial y fechas homogéneas, sin cambiar penalizaciones. |
| service-area-map.tsx | Reutilización del cargador de Maps y recuperación ante un fallo de carga. |

Se conservan los componentes propios de tarifas territoriales, polígonos y diálogos existentes. Reciben el layout y los estilos compartidos; no se duplican esos módulos.

## Módulos cubiertos

- Inicio y análisis/dashboard.
- Centro de operación y alertas.
- Viajes, conductores, pasajeros y cooperativas.
- Mototaxis, jornadas e informes de flota.
- Membresías, cobranza, pagos, comprobantes, puntos de pago y recaudadores.
- Finanzas, facturación, clientes fiscales, documentos y reportes.
- Comercial, prospectos, comercios, seguimientos, órdenes, campañas y publicidad institucional.
- Tarifas, sectores, reglas territoriales y zonas de cobertura.
- Configuración operativa y política de cancelaciones.
- Soporte, incidencias y FAQ.
- Usuarios/roles, credenciales corporativas, auditoría y estado del sistema.

## Consultas API

Nuevas consultas en `apps/api/src/admin-console.ts`, registradas desde `admin.ts`:

- `GET /v1/admin/console/search?q=...`: módulos se buscan localmente y las entidades se consultan en servidor. Viajes, conductores, pasajeros, cooperativas, membresías, incidencias, campañas y comercios. Consultas parametrizadas, límite por tipo, exclusión de cuentas eliminadas y permisos por entidad. Recaudadores y analistas de cooperativa no obtienen búsqueda global de datos.
- `GET /v1/admin/operations/details/:metric`: detalle paginado de ocho métricas operativas, con búsqueda y los mismos predicados del resumen. Requiere autorización operativa; no abre datos globales a cooperativas/recaudadores.

Consultas existentes extendidas de forma compatible:

- Viajes: filtro opcional `record` por UUID para abrir exactamente un registro.
- Membresías: filtro `insight` para estados y próximos siete días; el resumen excluye usuarios eliminados igual que el listado.
- Comercial: filtros `insight` y agregaciones ajustadas al alcance real del comercial. Las transferencias autónomas no se convierten en prospectos del asesor. Los banners institucionales no se cuentan como campañas comerciales.
- Fiscal: `collectedByDay` usa fecha de pago, zona America/Guayaquil y excluye reversiones; no confunde facturación con dinero recibido.

Se reutilizan dashboard, operación, cooperativas, membresías, pagos pendientes, punto del recaudador, fiscal, salud de API y diagnóstico de BD. Las escrituras siguen en los endpoints anteriores.

## Decisiones de UX y seguridad

- Máximo seis indicadores principales; información secundaria en un desplegable.
- Cada indicador disponible abre registros, detalle o módulo autorizado. Se identifica si es estado actual, período o listado limitado; no se presenta una muestra de 200 viajes como total histórico.
- Tablas: búsqueda, ordenamiento de fechas/moneda, columnas visibles, cantidad por página, exportación autorizada y desplazamiento interno. Los listados paginados por servidor no reciben una segunda paginación local. CSV neutraliza fórmulas y excluye columnas de acciones.
- Los menús de acciones compactan filas sin sustituir callbacks, confirmaciones ni verificaciones existentes.
- Filtros conservados por usuario/módulo; los enlaces explícitos desde indicadores tienen prioridad sobre filtros guardados.
- Modales nuevos: foco, Escape y retorno de foco. Controles con etiquetas, foco visible y navegación por teclado.
- Formato `dd/MM/yyyy`, 24 horas, USD con dos decimales, región es-EC y America/Guayaquil.
- El panel no tenía selector oscuro global: se preparan tokens oscuros sin duplicar componentes ni introducir un cambio de tema ajeno al alcance.
- La búsqueda y los agregados no amplían permisos. No se muestran contraseñas; se conservan restablecimiento y cambio obligatorio existentes.
- Los módulos grandes se cargan al abrirlos; Maps se solicita al pulsar el acceso correspondiente. No se agregan librerías gráficas pesadas.

## Información no inventada

Los mockups contienen ejemplos, no cifras para producción. No se simulan MFA, SLA, porcentaje territorial cubierto, salud de almacenamiento/notificaciones/colas/respaldos ni métricas de retención que el sistema todavía no registra. Se indica cuando no existe una sonda o información autorizada. La conexión del encabezado verifica la API, no garantiza que todos los servicios de Render estén saludables.

El mapa muestra posiciones y solicitudes reportadas, no un heatmap inventado. “Conductores con disponibilidad activada” mantiene el significado del endpoint operativo; no equivale a asegurar elegibilidad para cualquier viaje o método de pago. La aceptación de ofertas no se renombra como tasa de asignación de viajes.

## Validación

### Automatizada

- TypeScript del panel y API sin errores.
- Panel: 6 archivos, 30 pruebas aprobadas.
- API: 34 archivos, 327 pruebas aprobadas; 2 pruebas existentes omitidas por dependencias de entorno externo.
- Nuevas pruebas SQL con PGlite para búsqueda, aislamiento por rol, exclusión de eliminados, filtros, paginación, permisos y consistencia de agregados comerciales.
- Pruebas compartidas para fechas Ecuador, USD, ordenamiento, CSV, rutas, tablas e indicadores.
- Compilación Vite de producción sin errores ni advertencias; entrada JS aproximadamente 410 kB / 125 kB gzip, con módulos diferidos.
- `git diff --check` sin errores de espacios; Git puede informar normalización LF/CRLF en Windows.

### Navegador local

Se utilizó `scripts/admin-console-preview.mjs`, exclusivamente en loopback, con datos sintéticos claramente identificados y sin conexión a BD, Resend, FCM, pagos ni servicios de producción. El script no forma parte del bundle. Para reproducir: `node scripts/admin-console-preview.mjs`, abrir `http://localhost:3300` e ingresar con `qa@example.test` / `visual-test`; `support@example.test` permite comprobar la navegación reducida de soporte. No son cuentas de producción.

- Recorrido de Inicio, análisis, operación, Viajes, Conductores, Pasajeros, Usuarios y roles, Membresías, Fiscal, Comercial, Mototaxis, Tarifas, Cobertura, Configuración, Soporte, Auditoría y Estado del sistema.
- Búsqueda global → resultado → detalle, detalle de KPI operativo, paginación y apertura/cierre de modales.
- Sesión de soporte sin módulos globales de administración/finanzas.
- Resoluciones 1366×768, 1440×900, 1920×1080 y tablet 820×1180; sin desbordamiento horizontal de la página.
- Corrección visual de acciones partidas y solapamiento del icono del buscador. Sin errores de consola en el recorrido final.

No se ejecutaron cobros, conciliaciones, suspensiones ni cambios de cuentas reales durante QA. Las teselas de Google Maps no se verificaron con una clave de producción en el entorno sintético. Estas comprobaciones operativas deben hacerse con cuentas autorizadas tras publicar.

## Publicación

Commit/push a `main` dispara los despliegues automáticos definidos en `render.yaml`. Verificar la API y los assets del panel después del despliegue. No requiere migración, cambio de variables ni actualización de la aplicación móvil. Los cambios en servicios de consulta conservan los contratos anteriores y agregan filtros/campos opcionales.
