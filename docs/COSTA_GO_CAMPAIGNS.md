# Campañas Costa-Go — fase 1

## Alcance y revisión previa

El sistema usa Fastify/PostgreSQL, el RBAC existente (`permissions.ts`), las áreas operativas de `service_areas`, `audit_log` y el patrón de imágenes bytea que ya utilizan los banners. La publicidad pagada conserva `affiliate_banners` y sus órdenes/pagos. Las nuevas campañas no modifican ese circuito, ni viajes, tarifas, membresías, facturación o autenticación.

La app continúa usando su navegación y tema actuales. Solo se añade **Mi cuenta → Campañas Costa-Go**, un listado y un detalle reutilizable. No se rediseñan los Home ni se colocan adornos/banners en el mapa.

## Modelo y migración

`apps/api/migrations/100_costa_go_campaigns.sql` añade:

- `costa_go_campaigns`: identificación, nombre interno, título, audiencia, fechas, prioridad, estado, activación, todas las zonas, contenido JSON tipado, versión de concurrencia, actores y fechas de creación/actualización/revisión.
- `costa_go_campaign_areas`: asociación a una o varias áreas operativas existentes, con claves foráneas.
- `costa_go_campaign_assets`: MAIN, DARK, THUMBNAIL y DECORATION opcionales; JPG/PNG/WebP de hasta 2 MB y 4096 px, autenticados. Se validan formato real, dimensiones y número de páginas. No se admiten SVG ni rutas arbitrarias.
- `notification_campaigns.costa_go_campaign_id`: asociación opcional para una futura integración con el motor de notificaciones actual. No programa ni envía mensajes.

El contenido JSON contiene subtítulo, descripción, términos, variante (DEFAULT/CHRISTMAS/CARNIVAL/SUMMER/CUSTOM), ubicaciones (HOME/CAMPAIGNS/NOTIFICATION) y CTA. No contiene reglas de recompensas, descuentos, saldos ni metas.

## Administración, permisos y estados

Módulo **Comunicación → Campañas Costa-Go**. Incluye búsqueda, filtro de estado, paginación, detalle, formulario, imágenes, duplicado y auditoría. Fechas del panel en Ecuador, UTC−5; almacenamiento y API con fechas ISO y zona horaria explícita.

Permisos independientes, asignables por los roles configurables existentes:

- `costa_campaigns:view`
- `costa_campaigns:create`
- `costa_campaigns:edit`
- `costa_campaigns:approve`
- `costa_campaigns:reject`
- `costa_campaigns:activate`
- `costa_campaigns:deactivate` (pausar/finalizar)

ADMIN y SUPER_ADMIN reciben el catálogo completo conforme al patrón actual. Los demás roles requieren asignación explícita; los permisos de publicidad y notificaciones no conceden acceso a este módulo. Tras incorporar nuevos permisos, una sesión administrativa anterior puede requerir volver a ingresar para obtenerlos en su token.

Flujo: DRAFT → PENDING_APPROVAL → APPROVED → ACTIVE. PENDING_APPROVAL también puede pasar a REJECTED, con motivo obligatorio. ACTIVE puede pausarse y PAUSED reactivarse. Se permite finalizar explícitamente. FINISHED solo puede duplicarse. Duplicar siempre crea un borrador inactivo, sin aprobación.

Editar contenido o cambiar/eliminar una imagen invalida la aprobación y vuelve a DRAFT, con `enabled=false`. Guardados y acciones comprueban `version` bajo bloqueo de fila. Un formulario antiguo obtiene conflicto; debe actualizarse antes de intentar nuevamente. Cada modificación y su auditoría se guardan en la misma transacción.

Activar con fecha futura programa la visibilidad sin un segundo scheduler. Al vencer, el backend deja de entregarla aunque su estado administrativo siga ACTIVE; el panel la marca «Vencida». «Finalizar» permite cerrar su estado administrativo explícitamente.

## Endpoints

Administrador, bajo `/v1/admin/costa-go-campaigns`:

- GET `/`: listado, `search`, `status`, `limit` (hasta 100), `offset`.
- GET `/options`: áreas existentes y destinos válidos.
- POST `/`: crear borrador.
- GET `/:id`: detalle e historial de las últimas 100 acciones.
- PUT `/:id`: editar contenido con `version`.
- POST `/:id/actions`: SUBMIT, APPROVE, REJECT, ACTIVATE, PAUSE, FINISH; `version` y motivo.
- POST `/:id/duplicate`: copia como borrador.
- PUT/GET/DELETE `/:id/assets/:kind`: asociar, consultar o retirar imagen. Las mutaciones requieren versión.

Móvil, bajo `/v1/costa-go-campaigns`:

- GET `/`: campañas aplicables ordenadas por prioridad descendente, inicio descendente e ID; hasta 100. Devuelve hora del servidor y un intervalo recomendado de 300 segundos.
- GET `/:id`: detalle, con la misma comprobación de elegibilidad que el listado.
- GET `/:id/assets/:kind`: imagen, también sujeta a elegibilidad y autenticación.

Las consultas móviles aceptan coordenadas opcionales `latitude`/`longitude`; el listado admite `placement`. El rol se obtiene de la sesión autenticada. Las coordenadas se resuelven en backend mediante `resolveServiceArea` y su control de acceso existente; no se acepta un ID arbitrario de zona como autorización. Sin posición reciente o zona autorizada se entregan únicamente campañas globales.

Para devolver una campaña deben cumplirse simultáneamente: ACTIVE, enabled, inicio ≤ ahora < fin, audiencia PASSENGER/DRIVER/BOTH y zona aplicable. El móvil no decide ni reordena la segmentación. No se exponen nombres internos ni datos de revisión en la respuesta móvil. HTTP usa `private, no-store`; la caché de aplicación es separada por sesión.

## Cliente móvil y acciones

`costa_go_campaigns.dart` implementa caché en memoria de cinco minutos, listado y detalle genérico. Consulta al iniciar los Home, retornar desde background y volver desde otra pantalla; las consultas dentro del intervalo se deduplican. El listado y detalle abiertos actualizan cada cinco minutos solo en foreground, y admiten actualización manual. Logout/cambio de sesión descarta la caché. Los vencimientos usan la hora del servidor; los errores no dejan campañas antiguas indefinidamente visibles.

El cliente usa la última ubicación conocida con antigüedad máxima de quince minutos, sin solicitar un permiso adicional. Si no existe, solo recibe las campañas globales hasta una consulta posterior con ubicación disponible.

CTA disponibles:

- NONE: sin botón.
- CAMPAIGN_DETAIL: abre el detalle desde el listado, sin un botón recursivo dentro del detalle.
- MEMBERSHIP: solo para audiencia DRIVER; reutiliza el despachador de membresía existente.
- SUPPORT: soporte actual.
- INTERNAL_ROUTE: lista cerrada `support`, `membership`, `profile`, `activity`, `campaigns`.
- EXTERNAL_URL: HTTPS público, sin credenciales ni puertos alternativos; confirma el dominio y abre el navegador externo. Se vuelve a consultar la elegibilidad antes de ejecutar.
- REFERRAL: reservado, pero rechazado al configurar porque no existe todavía un destino funcional de referidos.

El detalle muestra imagen (DARK con respaldo en MAIN), título, subtítulo, descripción, vigencia en hora local, términos y CTA. Las imágenes usan encabezado de autenticación y versión en su URL. El dato `variant` y los recursos decorativos se conservan para la fase visual posterior, sin ejecutar código o rutas procedentes del contenido.

## Integración posterior y límites

- HOME puede consumirse con `store.forPlacement('HOME')` respetando el orden del backend. Esta fase no dibuja banners en Home.
- NOTIFICATION es una ubicación reservada y la FK permite asociar el envío existente. No se integra aún el compositor ni se genera push automáticamente. El futuro receptor deberá abrir el detalle por ID y volver a validar elegibilidad.
- No hay recompensas automáticas ni contador de viajes.
- Los cambios remotos se reflejan en el siguiente refresco (máximo cinco minutos mientras la sección está abierta); no se promete actualización instantánea por WebSocket.
- La primera entrega requiere desplegar la migración, API, panel y una versión móvil que incluya este cliente. Después, administrar campañas no requiere otra AAB ni cerrar sesión móvil.
- La migración se prueba en una base efímera; no se aplica a producción durante esta implementación.

## Validación

`costa-go-campaigns.test.ts` prueba API real con Fastify y una base PGlite temporal: audiencias, fechas, zonas, prioridad, permisos, revisión, concurrencia optimista, duplicado, assets y separación de publicidad. Los tests existentes de permisos, áreas y publicidad cubren compatibilidad.

`costa_go_campaigns_test.dart` prueba caché y errores, descarte al cambiar sesión, expiración, listado/detalle, CTA interno, confirmación/apertura HTTPS y actualización al retornar del background. La navegación administrativa prueba que permisos comerciales/notificaciones no habiliten Campañas Costa-Go.

Archivos centrales: API `costa-go-campaigns.ts`, migración 100, permisos y registro de rutas; administrador `costa-go-campaigns.tsx/.css`, navegación y etiquetas RBAC; móvil `costa_go_campaigns.dart`, integración puntual en `main.dart` y pruebas de cada capa.

Resultados de verificación local:

- API: 64 pruebas aprobadas en campañas, aplicación, permisos, áreas y publicidad comercial; compilación TypeScript correcta.
- Panel: 3 pruebas de navegación y permisos aprobadas; build TypeScript/Vite correcto.
- Flutter: suite completa de 169 pruebas aprobadas, incluidas 7 del nuevo motor móvil; `flutter analyze --no-pub` sin incidencias.
- Migración 100 ejecutada en la base temporal de integración. No se ha ejecutado en Render.
- No se ha realizado todavía una revisión manual del flujo completo contra un backend desplegado ni generado una nueva AAB de publicación.

Inventario de archivos de implementación y pruebas:

- `apps/api/migrations/100_costa_go_campaigns.sql`
- `apps/api/src/costa-go-campaigns.ts`
- `apps/api/src/costa-go-campaigns.test.ts`
- `apps/api/src/app.ts`
- `apps/api/src/permissions.ts`
- `apps/admin/src/costa-go-campaigns.tsx`
- `apps/admin/src/costa-go-campaigns.css`
- `apps/admin/src/admin-navigation.ts`
- `apps/admin/src/admin-navigation.test.ts`
- `apps/admin/src/console-model.ts`
- `apps/admin/src/main.tsx`
- `apps/admin/src/roles-permissions.tsx`
- `apps/mobile/lib/costa_go_campaigns.dart`
- `apps/mobile/lib/main.dart`
- `apps/mobile/test/costa_go_campaigns_test.dart`
