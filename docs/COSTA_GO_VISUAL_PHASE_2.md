# Costa-Go — fase visual 2

## Inventario y tratamiento

La revisión visual se realizó sobre las rutas reales, sin repetir la auditoría de infraestructura de temas. Los cambios reutilizan controles, validadores, navegación y llamadas existentes.

| Área | Pantallas/componentes reales | Tratamiento |
| --- | --- | --- |
| Acceso | Welcome, Login, Register, Recovery, EmailVerificationScreen, ChangeTemporaryPassword | Se conserva el arte oficial de bienvenida; paleta, controles y base de página compartidos en los formularios. |
| Pasajero | Passenger, selección en mapa, origen, destinos/paradas, programación, referencia, pasajeros, pago | Home con cuatro accesos; formulario dentro del mismo sheet; dos secciones completas para pasajeros y pago; se conservan selectores y validaciones. |
| Viaje pasajero | búsqueda, asignación, recorrido, cancelación, evaluación y finalización | Superficies y controles comunes; el contenido operativo sustituye al Home y sus campañas. No se cambia el circuito de confirmación existente. |
| Historial | PassengerTripsView, PassengerActivityView, PassengerTripDetail, TripsPanel, ActivityPanel | Base costera de página, cards, estados, empty states, filtros y controles del sistema compartido. |
| Direcciones | favoritos, acciones, edición, selección de mapa | Acceso desde Home; modal de superficie legible; reutiliza íntegramente los favoritos existentes. |
| Conductor | Driver, disponibilidad, GPS, programados, ofertas, recogida y viaje | Sheet sobre mapa, marca oficial y campaña solo sin operación/oferta; switch y estados existentes preservados. |
| Flota | FleetScreen, VehicleDetail, formulario de unidad, selección, solicitudes, documentos, escáner y FleetReportScreen | Página y modales comunes; sección de identificación y cabecera del formulario; controles e imágenes reales. |
| Cuenta | AccountHub, Profile, cambio de rol, DriverEnrollmentScreen, DriverApprovalScreen, DriverDocumentsScreen | Opciones agrupadas mediante CostaGoAccountTile, divisores y avatar; formularios/base de página coherentes. |
| Finanzas conductor | DriverWalletSheet, recarga, movimientos, pedido/comprobante/QR, membresías y planes, DriverEarningsSheet | Superficies opacas en modales densos; nueva paleta y componentes existentes de métricas, planes, información y estados. Importes y cálculos intactos. |
| Notificaciones | NotificationCenterView, NotificationPreferencesScreen, aviso dentro de la app | Página, controles y estados compartidos; deep links y lectura preservados. |
| Soporte | SupportCenter, CreateSupportRequest, SupportIncidentDetail, chat | Formularios y páginas comunes; se conserva la ilustración propia ya existente y la lógica de tickets/respuestas. |
| Otros | RatingsScreen, ChangePassword, PrivacyAndData, DeleteAccount, AboutCostaGo, navegación conductor | Base común y tema; textos, acciones de seguridad y permisos originales. |
| Comercios | CostaGoAffiliatesScreen, AffiliateBanners | Nueva entrada que reutiliza la consulta comercial, ponderación, rotación, renderer y callbacks de impresión/clic existentes. |
| Campañas propias | listado, detalle, HOME, isla superior | Contenido exclusivamente del motor de campañas, con validación al actuar y actualización de sesión. |

El mapa y sus marcadores oficiales, el navegador Google y el launcher se mantienen. El panel de administración móvil conserva su estructura operativa y recibe el tema común. No se sustituyen logos ni se agregan pantallas estacionales independientes.

## Componentes, fondos y transparencias

`costa_go_coastal.dart` añade CostaGoCoastalDecoration (none/subtle/medium), CostaGoScaffold, CostaGoGlassSheet, showCostaGoModalBottomSheet, CostaGoHomeHeader, CostaGoQuickActionCard, CostaGoAccountTile y CostaGoFormSection. Reutiliza CostaGoSurface, CostaGoStatusChip, CostaGoInfoBanner, CostaGoEmptyState, CostaGoSkeleton y los botones/selectores existentes.

La decoración es un CustomPainter estático de ondas y siluetas de palmeras en las esquinas inferiores, sin eventos de toque ni semántica. No lleva textos turísticos. No usa blur, imágenes pesadas ni animaciones continuas; se aísla con RepaintBoundary.

Sobre el mapa, el sheet usa gradiente tonal de opacidades 0.84/0.74 y cards legibles. Los modales densos usan superficies opacas para evitar que el texto de otra pantalla se vea detrás. Los controles siguen su tema; no se duplican pantallas para oscuro. El color primario claro usa texto blanco con contraste verificado; oscuro usa navy y superficies diferenciadas.

## Home y operación

Pasajero: mapa, isla real, panel arrastrable con marca oficial, campaña opcional y accesos Solicitar mototaxi/Mis viajes/Comercios afiliados/Mis direcciones. La cuadrícula pasa de dos columnas a una con ancho reducido o fuente grande; no fuerza altura de texto. Solicitar mototaxi expande el mismo sheet. Volver conserva el borrador. Seleccionar un favorito o repetir un viaje abre el formulario.

Conductor: conserva disponibilidad, GPS, programados, unidades y solicitudes. La campaña y decoración de cabecera se suprimen cuando hay un viaje o una oferta. Las superficies operativas mantienen la información y acciones existentes.

## Regla obligatoria de campañas HOME

CostaGoHomeCampaigns toma el primer elemento del orden del backend para HOME. Cuando no hay uno, devuelve SizedBox.shrink: no hay título de ejemplo, placeholder, margen ni altura reservada. Ninguna fecha local, ciudad o imagen del repositorio crea una campaña.

La card utiliza imagen disponible, título, subtítulo, CTA y variante del registro. Antes de actuar vuelve a consultar elegibilidad y destino. HTTPS externo exige confirmación de dominio. Detalle, membresía y soporte usan rutas existentes.

Se añade `decorateHeader` opcional al contenido JSON, predeterminado false, editable en el panel. No requiere otra tabla ni migración. El encabezado elige la primera campaña HOME aplicable, según el orden del backend, con decoración habilitada y variante compatible. Solo muestra un acento pequeño, sin sustituir avatar/campana ni capturar toques. Las variantes no se deducen de la temporada. El vencimiento usa el reloj de servidor y el refresco de cinco minutos de fase 1.

## Comercios afiliados

Campañas institucionales y publicidad siguen separadas. La pantalla comercial consulta el placement existente PASSENGER_HOME; se conserva su resolución actual en backend. No se crea un catálogo ni se alteran BASIC/PREMIUM o pesos.

Sin resultados se muestra el empty state solicitado y el enlace `https://costa-go.com/comercios`, mediante navegador externo. Una falla de consulta tiene mensaje y reintento separados. No se registran impresiones del empty state. Las impresiones reales siguen la demora, deduplicación y rotación del widget comercial existente.

## Validación automatizada

- Flutter: 181 pruebas aprobadas, incluidas 12 nuevas de HOME, decoración, CTA, comercios y responsive; suite existente de flota, recargas, ganancias, fiscal, viajes y acceso conservada.
- `flutter analyze --no-pub`: sin incidencias.
- API: 28 pruebas de campañas y compatibilidad comercial aprobadas; incluida persistencia de decorateHeader y valor predeterminado false.
- Builds TypeScript de API y TypeScript/Vite del panel correctos.
- Matriz visual automatizada: 320/430 px, escalas 1.0/1.8, claro/oscuro y teclado. Se mantienen pruebas anteriores de flota pequeña, controles, contraste y formularios.

## Archivos

Nuevos: `apps/mobile/lib/costa_go_coastal.dart`, `apps/mobile/lib/costa_go_affiliates.dart`, `apps/mobile/test/costa_go_home_test.dart` y este informe.

Modificados: `costa_go_campaigns.dart`, `costa_go_design.dart`, `main.dart`, `passenger_experience.dart`, `affiliate_banners.dart`, `fleet.dart`, `fleet_report.dart`, `driver_wallet_sheet.dart`, `driver_earnings_sheet.dart`, `fiscal_profile_modal.dart`, `driver_navigation.dart`; API `costa-go-campaigns.ts` y su test; panel `costa-go-campaigns.tsx`.

## Límites que deben distinguirse de la implementación

- Los cambios móviles requieren instalar una APK/AAB nueva; desplegar Render solo actualiza API/panel.
- No se han creado campañas ficticias en producción para decorar las capturas.
- No se han cambiado reglas de viajes, tarifas, saldos, facturación, membresías, GPS o autenticación.
- Las pruebas automatizadas de estados y controles no equivalen a completar transacciones o viajes reales en producción.
- El aviso de Gradle/AGP sobre soporte futuro es previo y no se cambia la cadena Android en esta tarea visual.
