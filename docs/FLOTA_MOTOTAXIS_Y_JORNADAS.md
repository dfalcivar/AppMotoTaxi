# Mototaxis, propietarios, jornadas y QR

Implementación del pedido de 65 apartados del 28 de agosto de 2026. Esta entrega se conserva en Git local: no implica migración de producción, publicación en Render ni distribución de una app.

## 1. Modelo y reglas

```text
Usuario ──< Relación usuario/unidad >── Mototaxi ── Cooperativa
   │           OWNER_MANAGER              │
   │           AUTHORIZED_DRIVER          ├── Fotografías y documentos originales
   │                                      ├── QR opaco, revocable
Conductor ─────────< Jornada >─────────────┤
   │                    │                 └── Propietario declarado (sin cuenta posible)
   │                    └── Asignaciones de viajes + foto/identidad histórica
   └── Membresía, viajes incluidos, excedentes y cancelaciones: siguen por conductor
```

- Una unidad admite varios conductores autorizados y varios responsables validados.
- Un conductor tiene como máximo una jornada activa; una unidad, como máximo un conductor en jornada.
- Ser propietario no concede automáticamente permiso para conducir. Si también conduce, se le aprueban ambas relaciones y debe estar aprobado como conductor.
- Crear una unidad o escanear su QR no autoriza al solicitante. La relación comienza pendiente.
- Una unidad nueva debe tener fotografía real antes de verificarse. Las unidades históricas verificadas se conservan para no bloquearlas por una fotografía que el esquema anterior no exigía.
- No se eliminan unidades para corregir duplicados históricos: se conserva el alias, sus referencias y la unidad canónica.
- Cambiar de unidad no cambia ni reinicia membresías, contadores o penalizaciones del conductor.
- La disponibilidad efectiva exige una jornada vigente, heartbeat reciente, unidad verificada, conductor aprobado y relación autorizada. Los filtros ya existentes de membresía, disponibilidad, método de pago, zona, radio y carrera activa continúan aplicándose.
- ASSIGNED, DRIVER_EN_ROUTE, DRIVER_ARRIVED, IN_PROGRESS e INCIDENT impiden liberar, cambiar o tomar la unidad. El backend y los triggers son la fuente de verdad.

## 2. Migraciones

### 073_vehicle_fleet.sql

Modifica `vehicles`: el `driver_id` histórico deja de ser obligatorio y de representar propiedad; agrega cooperativa, color, número de unidad, propietario declarado, estado de flota, creador, foto actual y `merged_into`.

Normaliza placa/registro quitando separadores y diferencias de mayúsculas. Entre identificadores equivalentes conserva como canónico el registro más antiguo, seguido por ID. Los registros anteriores no se borran. Las relaciones migradas son `AUTHORIZED_DRIVER / APPROVED / LEGACY_MIGRATION`, nunca `OWNER_MANAGER`. El estado histórico ACTIVE pasa a VERIFIED, SUSPENDED se conserva y el resto queda PENDING.

| Tabla nueva | Finalidad |
| --- | --- |
| `user_vehicle_relations` | Relación de uso o gestión, estado, origen y revisión. |
| `vehicle_files` | Original inmutable, versión de presentación, tipo, SHA-256 y autor. |
| `vehicle_ownership_claims` | Evidencia, motivo original, revisión y resolución de reclamaciones. |
| `fleet_settings` | Intervalos de conexión y autorización global de avisos a propietarios. |
| `driver_vehicle_sessions` | Conductor, unidad, inicio, heartbeat, cierre y motivo. |
| `vehicle_qr_tokens` | Identificador aleatorio de QR y revocación. |
| `vehicle_audit` | Evidencia inmutable de cambios, actor, motivo, IP, estado anterior y nuevo. |
| `fleet_entitlements` | Capacidades BASIC/PRO de flota, independientes de membresías de conducción. |
| `fleet_notification_outbox` | Avisos persistentes e idempotentes por evento y destinatario. |
| `vehicle_session_assignments` | Unidad y jornada reales de cada aceptación, resultado y métricas. |

Modifica `trips`: incorpora `vehicle_session_id` y `vehicle_snapshot`. Solo completa snapshots históricos cuando ya existe un `vehicle_id` conocido. No adivina la mototaxi del pasado usando el perfil actual del conductor.

Restricciones e índices principales:

- Identificador normalizado único entre unidades canónicas.
- Relación única por usuario, unidad y tipo.
- Jornada ACTIVE única por conductor y por unidad.
- QR vigente único por unidad y token globalmente único.
- Una reclamación pendiente por unidad/solicitante.
- Asignación única por jornada/viaje.
- Aviso único por auditoría/destinatario.
- Índices para relaciones de unidad, documentos, jornadas por unidad/conductor, auditoría, asignaciones por viaje y avisos pendientes.
- Originales y auditoría no admiten UPDATE ni DELETE ordinarios.

### 074_vehicle_session_integrity.sql

- Antes de asignar conductor a un viaje exige una jornada autorizada y captura la unidad real; no confía en un vehículo enviado por el cliente.
- Conserva snapshots durante cambios de estado de la misma asignación.
- Una nueva búsqueda sin conductor limpia la asignación actual del viaje, conservando la asignación anterior en el histórico.
- Registra resultado, distancia y valor de viajes completados. Distingue cancelación de pasajero/conductor con `trip_events`, sin duplicar por reintentos.
- Una jornada terminada no puede reactivarse ni reescribirse. Una jornada con viaje activo no puede cerrarse ni eliminarse.
- Añade `driver_offers.vehicle_session_id`, capturado al crear la oferta, para contar solicitudes en la jornada correcta.
- Protege identidad y snapshot de las asignaciones históricas; permite completar su resultado y métricas.

## 3. Flujo móvil

### Registro y perfil

El registro inicial y la conversión a conductor ya no piden placa. La foto frontal, licencia y documentos personales permanecen en el flujo del conductor. Se explica que las mototaxis se agregan después.

`Mi perfil → Mis mototaxis` muestra fotografía, placa, marca/modelo, color, unidad y relación/estado. El formulario permite:

1. **Nueva unidad:** datos, propietario declarado, relación solicitada y fotografía real.
2. **Vincular existente:** placa/registro y relación, sin inventar datos ni crear otra unidad.

Si se interrumpe la carga de la foto, el creador puede completar su borrador pendiente. Otro solicitante no puede reemplazar la foto de esa unidad. En una unidad ya validada solo un gestor autorizado o administración puede modificarla.

### Jornada

Antes de conectar viajes se confirma la unidad. Con una unidad se muestra confirmación con su foto; con varias se abre el selector. También hay lector QR.

El interruptor de disponibilidad no inicia una jornada implícita. Pausar viajes conserva la unidad; **finalizar jornada** la libera. Cerrar sesión pide confirmación para liberar la unidad si está libre; con carrera activa se bloquea el cierre. Si no hay conexión no se presume una liberación exitosa: se explica la recuperación por inactividad.

Al volver a la app se consulta el servidor. Una jornada liberada no revive desde almacenamiento local. Si continúa asignada se confirma su recuperación. Un cierre por inactividad informa al conductor que debe elegir nuevamente su unidad.

### Pasajero e historial

Se mantiene la foto personal del conductor y se incorpora una fila compacta con la **foto real de la unidad**, placa, color y número. La información procede del snapshot de la aceptación, no de la unidad actual del perfil. La misma referencia aparece en el detalle histórico. Si el viaje antiguo no tiene información suficiente, no se inventa una unidad.

### Mi flota

La misma cuenta puede abrir Mi flota sin ser conductor. Solo muestra sus relaciones pendientes/aprobadas y unidades a cargo. Permite consultar unidad, responsable declarado, conductor actual, fechas, documentos, autorizaciones, reclamación con evidencia, jornadas, viajes operativos y resumen con filtros.

El resumen ofrece fechas, unidad, conductor, estado y motivo de cierre. Las opciones se buscan en el ámbito autorizado; no se expone un directorio global de personas. Las listas se paginan en bloques de 30.

## 4. Sesiones, heartbeat y concurrencia

| Parámetro inicial | Valor | Uso |
| --- | ---: | --- |
| `heartbeatSeconds` | 30 s | Intervalo móvil de confirmación de jornada. |
| `offlineSeconds` | 180 s | Sin heartbeat reciente no recibe nuevas ofertas. |
| `autoReleaseSeconds` | 900 s | Cierra jornadas inactivas, solo sin viaje activo. |
| `ownerNotifications` | false | Habilitación global de avisos de flota. |

Se editan en **Panel → Mototaxis → Conexión y jornadas**. Debe cumplirse heartbeat < offline < auto-release, con límites de validación del servidor. Los segundos son configurables; no están fijados en la interfaz.

El scheduler revisa vencimientos cada 30 segundos técnicos. Las lecturas, confirmaciones y heartbeats también revisan vencimiento: no dependen exclusivamente del tick. El heartbeat tardío de una jornada inactiva ya vencida no la resucita. Con viaje activo, la unidad permanece reservada aunque se pierda Internet; puede recuperar heartbeat.

Para relevar una unidad: conductor autorizado, unidad verificada, anterior sin conexión, ausencia de carrera activa y confirmación expresa de posesión física. Se cierra la jornada anterior y se crea otra, registrando el relevo. Si ya llegó al auto-release, se crea una jornada normal nueva; nunca se reutiliza la antigua.

Las mutaciones de flota usan transacciones y bloqueo asesor. Los índices únicos impiden dos jornadas simultáneas. El trigger de aceptación bloquea la jornada correspondiente y valida la asignación; protege también contra escrituras que no pasen por la pantalla móvil. Los conflictos devuelven mensajes controlados.

## 5. Panel y roles

El módulo **Mototaxis** reutiliza estilos y modales actuales. Incluye listado con búsqueda/estado, información de unidad, autorizaciones, reclamaciones, documentos originales, jornadas, viajes, QR y auditoría. Las acciones críticas exigen motivo. Los errores del servidor se traducen; no se exponen consultas SQL al usuario.

| Actor | Acceso |
| --- | --- |
| ADMIN / SUPER_ADMIN | Gestión global, estados, responsables, autorizaciones, QR, parámetros y liberación justificada sin carrera activa. |
| ANALISTA_COOPERATIVA | Gestión, QR, documentos, reportes y liberación de unidades de su cooperativa. No cambia parámetros globales ni cruza cooperativas. |
| Propietario/gestor aprobado | Gestiona conductores y datos de sus unidades, documentos y actividad; no genera ni revoca QR. |
| Conductor autorizado | Selecciona, escanea y utiliza unidades autorizadas; ve sus jornadas. No administra otros conductores ni QR. |
| Solicitante pendiente | Consulta su solicitud y aporta evidencia; no conduce hasta ser autorizado. |

Se agregan `fleet:view` y `fleet:manage` al sistema existente. Además de permisos se exige un rol administrativo permitido; un override no habilita a Comercial/Finanzas. Un analista sin cooperativa es rechazado. Las consultas y escrituras validan el ámbito en el backend.

La propiedad física puede existir solo como nombre declarado. Para reclamar gestión en una cuenta se presenta evidencia y motivo; administración verifica. El `vehicle_id`, QR, viajes, jornadas y documentos no se sustituyen. Aprobar una reclamación no elimina otros responsables automáticamente.

`fleet_entitlements` prepara capacidades independientes history/reports/notifications y BASIC/PRO; no cobra, no crea planes de conducción ni restringe por defecto las funciones actuales. Las capacidades se aplican en servidor. No hay un nuevo cobro comercial activado en esta entrega.

## 6. QR y archivos

El QR contiene una URL HTTPS oficial con un token aleatorio de 32 bytes (43 caracteres base64url), no una placa, nombre, correo o número telefónico. La placa/color impresos están fuera del QR. La etiqueta usa el logo oficial y permite descarga SVG e impresión.

Flujo:

```text
Lector dentro de Costa-Go → resolver token → validar relación → confirmar unidad
Cámara del teléfono → costa-go.com/vehicle.html → Abrir Costa-Go → login si hace falta → validar relación
Sin app → misma página segura → enlace de Play Store
```

El enlace pendiente se conserva a través del login. Un usuario no autorizado puede solicitar vinculación, pero no obtiene propiedad ni conducción. Revocar/regenerar invalida el token anterior; no cambia la identidad de la unidad. La página pública no consulta ni muestra datos privados y utiliza no-referrer/noindex.

**Límite concreto:** están implementados el esquema `costa-go://vehicle/...`, lector interno y página HTTPS con botón explícito. No se han publicado asociaciones verificadas Android App Links/iOS Universal Links para apertura automática desde la cámara del sistema. Esa asociación requiere validar dominio y certificados de la futura versión. El botón de la página es la ruta prevista por esta entrega.

Fotografía: JPG/PNG, máximo 5 MB y límite de píxeles de entrada. Sharp valida formato, orienta y encuadra a 800×600 con fondo neutro, sin IA generativa ni reconstrucción de partes de la moto. No se aplica eliminación semántica de fondo no fiable. Si falla la conversión opcional se usa el original válido. Documentos de unidad: JPG/PNG/PDF; la licencia personal sigue perteneciendo al conductor.

Los bytes originales y su hash son inmutables. Reemplazar la foto actual crea otro archivo; no altera la foto del viaje pasado. Acceso privado autenticado, `no-store` y `nosniff`; el pasajero solo puede consultar la foto vinculada a su viaje, no documentos ni originales privados de la flota.

## 7. Métricas y avisos

Se calculan sobre jornadas y asignaciones reales: unidades con/sin actividad en el período, conductores con actividad, recibidos, aceptados, completados, cancelados por actor, incidencias, duración, km y total operativo de viajes completados.

“Con actividad” significa actividad en el intervalo consultado, no necesariamente conectada en este instante. La disponibilidad actual se muestra por separado en el listado. Los importes operativos **no representan dinero conciliado ni ganancias netas**. Propietarios no reciben nombres, teléfonos, direcciones ni conversaciones de pasajeros.

Avisos iniciales: inicio, fin, auto-release y relevo. El propietario configura qué eventos recibir; la habilitación global está apagada inicialmente. Outbox evita duplicados por evento/destinatario, valida nuevamente propiedad/preferencias al enviar y usa el canal de push existente con `FLEET_SESSION`, `vehicleId` y `eventId`. Al tocarlo se abre el detalle de esa unidad. No se enviaron notificaciones reales durante las pruebas locales.

En un relevo se conserva la auditoría de cierre/inicio, pero se envía un único aviso de cambio de conductor, no tres notificaciones redundantes.

## 8. API

Prefijos `F=/v1/fleet`, `A=/v1/admin/fleet`.

| Método/ruta | Función |
| --- | --- |
| GET F/A `/vehicles` | Listado, búsqueda, estado y paginación. |
| POST F/A `/vehicles` | Crear o reutilizar unidad y solicitar relación. |
| POST F `/vehicles/link` | Vinculación por identificador existente. |
| GET/PUT F/A `/vehicles/:id` | Detalle y edición autorizada. |
| PUT F/A `/vehicles/:id/relations` | Aprobar, rechazar o revocar relación con motivo. |
| POST F/A `/vehicles/:id/drivers` | Autorizar conductor por correo exacto. |
| POST F/A `/vehicles/:id/files` | Foto/documento original y normalización. |
| GET F/A `/files/:id` | Lectura privada; `original=true` sujeto a permiso. |
| GET/POST F `/session` | Recuperar o confirmar unidad/jornada. |
| POST F `/sessions/:id/heartbeat` | Heartbeat de la propia jornada. |
| POST F/A `/sessions/:id/release` | Finalizar/liberar con validación. |
| POST F `/qr/resolve`, `/qr/request` | Resolver token o solicitar vinculación. |
| POST/DELETE A `/vehicles/:id/qr` | Generar/reemplazar/invalidar etiqueta. |
| POST F `/vehicles/:id/ownership-claims` | Reclamación con evidencia. |
| POST A `/ownership-claims/:id/review` | Resolver reclamación. |
| GET F/A `/report`, `/report/options` | Resumen, jornadas y opciones filtradas por ámbito. |
| GET/PUT F `/notification-preferences` | Preferencias del gestor. |
| GET A `/options` | Buscar personas/cooperativas para administración. |
| PUT A `/vehicles/:id/status` | Revisión de estado. |
| GET/PUT A `/settings` | Parámetros; edición solo global. |

Integraciones modificadas: registro/conversión a conductor, logout, disponibilidad, ofertas, candidatos en rondas progresivas, activación de programados, cercanía en tiempo real, perfil, viajes activos/históricos y enlace compartido. La eliminación de cuenta conserva unidades/evidencia, revoca relaciones y cierra jornadas que puedan liberarse. La importación CSV conserva el dato opcional de unidad mediante relaciones pendientes.

## 9. Archivos principales

- API: `src/fleet/service.ts`, `routes.ts`, `files.ts`, `reports.ts`, `notifications.ts`, `fleet.test.ts`.
- Integración API: `app.ts`, `realtime.ts`, `admin.ts`, `permissions.ts`, `memberships.ts`, `cooperative-analytics.ts`, `trip-sharing.ts`, `mobile-account-maintenance.ts`, `user-notifications.ts`.
- App: `lib/fleet.dart`, `fleet_report.dart`, `main.dart`, `passenger_experience.dart`, manifiestos Android/iOS y selector nativo de PDF.
- Panel: `fleet-admin.tsx`, `fleet-report.tsx`, `fleet.css`, navegación `main.tsx`.
- Web: `vehicle.html`, `vehicle-link.js`, `vehicle.css`.
- Pruebas: `apps/api/src/fleet/fleet.test.ts`, `apps/mobile/test/fleet_test.dart`, `apps/site/test/vehicle-link.test.mjs`, fixture local del panel en `apps/admin/test/`.

## 10. Validación y matriz de escenarios

Las pruebas SQL usan PGlite (motor PostgreSQL local) con ambas migraciones reales y tablas previas mínimas. El flujo HTTP utiliza las rutas reales sobre esa base. No equivale a haber aplicado todas las migraciones de producción ni a probar PostGIS, GPS y FCM en teléfonos.

Resultado local de cierre: API 284 pruebas aprobadas y 2 omitidas explícitamente (fixture interactivo del navegador y caso fiscal externo); Flutter 87 aprobadas y análisis sin observaciones; dominio 12 aprobadas; sitio 14 aprobadas. TypeScript de API/panel y build del panel/sitio correctos. El bundle principal del panel conserva una advertencia no bloqueante por superar 500 kB; no se oculta ni se modifica el límite para silenciarla.

| # | Escenario del pedido | Evidencia local / límite |
| ---: | --- | --- |
| 1 | Sin mototaxi | SQL rechaza jornada/asignación no autorizada; UI muestra estado vacío. |
| 2 | Una mototaxi | Widget confirma antes de crear jornada; SQL valida. |
| 3 | Tres mototaxis | Prueba SQL múltiples unidades. |
| 4 | Tres choferes | Prueba SQL relaciones múltiples y exclusión simultánea. |
| 5 | Propietario conductor | Capacidades independientes y validación de permiso de conducción. |
| 6 | Propietario no conductor | SQL permite gestión y bloquea conducción. |
| 7 | Propietario sin cuenta | Nombre declarado sin crear usuario/propiedad automática. |
| 8 | Registrar moto ajena | SQL deja relación pendiente y bloquea modificación de foto ajena. |
| 9 | Unidad duplicada | Identificador normalizado, misma unidad, datos originales conservados. |
| 10–12 | Solicitar/autorizar/revocar | SQL, aislamiento de roles y rutas HTTP. |
| 13 | Selección manual | SQL + confirmación widget + doble tap. |
| 14 | Selección QR | Token y método QR_SCAN en HTTP/SQL; cámara física pendiente. |
| 15–17 | QR válido/invalidado/regenerado | SQL y generación/revocación auditada en navegador local. |
| 18 | Foto del QR no autoriza | SQL niega uso y permite una solicitud idempotente. |
| 19–20 | Inicio/fin | SQL/HTTP, snapshot y auditoría. |
| 21 | Pausa | SQL conserva jornada cuando disponibilidad es falsa. |
| 22 | Logout | Servicio de cierre y guardas; comprobar interacción final en teléfono. |
| 23–24 | Cierre abrupto / sin Internet | Heartbeats vencidos simulados en SQL; sistema operativo físico pendiente. |
| 25 | Regreso antes de liberación | Recuperación de jornada comprobada en servicio. |
| 26–27 | Auto-release / heartbeat | SQL asegura vencimiento y rechaza resurrección tardía. |
| 28 | Viaje activo sin Internet | SQL con los cinco estados protegidos. |
| 29–31 | Relevo / online / viaje activo | SQL confirma o rechaza conforme al estado real. |
| 32 | Selección simultánea | Dos solicitudes concurrentes, un ganador e índices únicos. Repetir en PostgreSQL/PostGIS de preproducción. |
| 33 | Cambio de mototaxi | SQL cierra jornada anterior y conserva histórico. |
| 34 | Disponible sin unidad | Elegibilidad SQL y guardas del endpoint/interfaz. |
| 35–36 | Historial / fotos | Snapshot y acceso privado SQL; widgets de identidad en claro/oscuro. |
| 37–38 | Jornadas / métricas propietario | Conteos, filtros, duración, km/valor y capacidades en SQL. |
| 39–41 | Aislamiento propietario/cooperativa | SQL + HTTP; rol Comercial con override y analista sin cooperativa rechazados. |
| 42–43 | Migración legacy/MT-2 duplicada | Ambas migraciones ejecutadas en fixture; conserva ID histórico y no infiere propietario. |
| 44–45 | Claro/oscuro | Widgets 360×800, identidad larga a 320 px, teclado y capturas renderizadas. |

Además se valida envío idempotente del aviso de propietario con transporte push sustituido solo en pruebas, payload de navegación y revocación previa a entrega; no se confunde con una prueba FCM física.

Comandos repetibles, desde cada paquete:

```text
API:    node node_modules/vitest/vitest.mjs run --maxWorkers=2
Móvil:  flutter analyze --no-pub
        flutter test --no-pub
Panel:  node node_modules/vite/bin/vite.js build
Sitio:  node --test test/*.test.mjs
        node build.mjs
```

En la raíz: `node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --noEmit` y lo mismo con `apps/admin/tsconfig.app.json`.

Fixture de navegador, explícitamente local y fuera del bundle principal: `FLEET_UI_QA=true` al ejecutar el caso `local browser fixture`, API 127.0.0.1:3313; compilar panel con `test/vite.fleet.config.ts` y servir `fleet-preview.html` en 3315. Los datos sintéticos y credenciales de prueba existen solo en la base efímera. No son pantallas ni datos de producción.

El runner histórico `test:flow` se adapta a confirmar jornadas y conservar evidencia en vez de borrarla. Exige BD local desechable con test/e2e en el nombre y `E2E_DATABASE_CONFIRMED=true`. **No se ejecutó contra PostGIS en esta entrega**.

## 11. Publicación futura: coordinación obligatoria

**No desplegar solo la API y mantener conductores con la app anterior.** La versión anterior no confirma jornadas y por tanto no podrá recibir nuevas ofertas con la nueva regla. No se introduce un bypass silencioso que contradiga la regla de unidad obligatoria.

Antes de autorizar publicación:

1. Respaldar PostgreSQL y ensayar todas las migraciones sobre copia aislada PostGIS. Revisar identificadores normalizados, aliases y cooperativa canónica, especialmente duplicados que antes pertenecían a distintas cooperativas.
2. Completar/validar foto y autorizaciones de unidades nuevas. Las relaciones legacy no prueban propiedad: asignar responsables después de verificación.
3. Probar en al menos dos teléfonos: cámara QR, permisos, enlace desde cámara y tras login, cierre abrupto, modo avión, reconexión, relevo y notificaciones abierta/segundo plano/cerrada. Probar iOS en su entorno de compilación si se distribuirá allí.
4. Ensayar API/PostGIS + app completa: búsqueda progresiva, aceptación simultánea, cambio de conductor, cancelaciones, membresía y snapshots.
5. Preparar versión móvil firmada y publicación coordinada API/panel/sitio/app. Evitar iniciar nuevas jornadas en una ventana de migración sin coordinación de usuarios y viajes activos.
6. Publicar la página HTTPS del QR y comprobar el botón de apertura en dispositivos. Si se requiere apertura automática sin página intermedia, configurar asociaciones verificadas con los certificados reales.
7. Monitorear conflictos controlados, jornadas sin heartbeat, colas de avisos y consultas de flota. El aviso al propietario está apagado inicialmente; habilitarlo después de probar el canal.

No ejecutar un rollback destructivo de tablas/auditoría si aparecen incidencias. Conservar evidencia y corregir hacia adelante; restaurar una copia solo mediante procedimiento operativo explícito.
