# Beneficios y recompensas Costa-Go

## Alcance operativo

El motor está separado de Campañas: una campaña referencia `benefitCode`; el servidor identifica al usuario autenticado, valida las condiciones y otorga cobertura en una transacción.

**Operativo:** `COURTESY_DAYS`, activación manual para conductores aprobados y activos, sin documentos ni membresía suspendidos. Preset del panel: `DRIVER_FOUNDER_COURTESY`, 15 días, una sola vez. No se insertan campañas ni beneficios activos mediante la migración.

**Ampliación implementada:** referidos y activación automática de cortesías, viajes gratis para conductores y saldo promocional acumulable. Véase [Referidos Costa-Go](costa-go-referrals.md). El saldo promocional todavía no puede gastarse en viajes. Descuentos, membresía y personalizado siguen bloqueados para activación.

## Estructuras y migración

`101_costa_go_benefits.sql` crea definiciones, áreas, redenciones e índices. No actualiza filas de producción existentes. Debe ejecutarse con el migrador habitual antes de arrancar esta versión de la API.

`105_benefit_free_trips.sql` agrega créditos y consumos de viajes sin comisión, con saldo y vencimiento propios. Tampoco modifica paquetes comprados ni saldo real.

- `benefit_definitions`: código único/inmutable, tipo, valor, audiencia, ventana de activación, límites, estado, configuración y versión optimista.
- `benefit_areas`: áreas operativas actuales; sin selección significa alcance global.
- `benefit_redemptions`: usuario real, campaña, código, valor/versionado, origen, cobertura, estado, zona y auditoría.
- `benefit_free_trip_credits` y `benefit_free_trip_usages`: unidades concedidas, disponibles, consumidas y restituidas por cancelación del pasajero.
- Infraestructura reservada: `benefit_promotional_credits`, `benefit_promotional_movements`, `benefit_reward_programs`, `benefit_referrals`, `benefit_reward_events`, `benefit_reward_progress`.
- Contratos extensibles en `benefit-contracts.ts`: expiración, descuentos, eventos verificados, recompensas, referidos y progreso.

No hay endpoint de borrado ni botón de entrega arbitraria. Pausar/archivar detiene nuevas activaciones; no revoca lo ya otorgado.

## Idempotencia y concurrencia

- Índice único parcial `(user_id, benefit_code)` para `one_time`.
- Trigger obtiene código/tipo/oneTime desde la definición: un insert no puede desactivar la protección enviando `one_time=false`.
- Índice único `(user_id, benefit_code, campaign_id)` también para beneficios repetibles: una activación por campaña; las repeticiones permitidas se distribuyen entre campañas diferentes y respetan `maxPerUser`.
- Bloqueo de definición `FOR UPDATE` serializa el límite global. El bloqueo comercial `membership-order:<userId>` coordina compras, aceptación de viajes y claims.
- Código, tipo y condición oneTime inmutables después de crear la definición.
- Restricción + usuario autenticado: no depende de instalación, dispositivo ni memoria de Flutter.

Los beneficios de una sola vez no pueden volver a otorgarse al mismo usuario aunque se duplique una campaña, se reinstale la aplicación o se produzcan requests concurrentes. La suite prueba peticiones simultáneas contra PostgreSQL embebido PGlite, así como el rechazo de duplicados insertados directamente. No es una prueba de carga con varias conexiones de un servidor PostgreSQL externo.

## Cortesía y membresías

La redención es una cobertura independiente, identificada `BENEFIT / COURTESY`. No crea un pago ficticio, factura ni plan de $0.

- Sin membresía vigente: ahora + días configurados.
- Con membresía vigente y vencimiento: empieza al vencer; se respeta también la cobertura de gracia vigente que permite viajes. Las cortesías pendientes se encadenan.
- Compras posteriores: un trigger desplaza la cobertura pendiente o el tiempo aún no consumido después de la nueva cobertura pagada. Conserva duración restante y audita el cambio. No cambia la compra.
- Durante cobertura: admisión y aceptación de viajes reconocen el beneficio; snapshot comercial `BENEFIT_COURTESY`, comisión aplicada cero. No se consumen unidades de paquetes ni saldo real.
- Al vencer, vuelve a aplicarse la elegibilidad habitual. Una suspensión manual o de cuenta/documentos prevalece sobre la cortesía.
- El total del pasajero no cambia. Los viajes ya aceptados conservan su snapshot para completar/cancelar/reintentar.
- Los estados programado/activo/vencido se derivan de fechas del servidor; no necesitan un cron para dejar de otorgar acceso.

## Viajes gratis para conductor

`FREE_TRIPS` requiere audiencia `DRIVER`, una cantidad entera de viajes y días de vigencia. Puede activarse desde una campaña o concederse automáticamente como premio de referidos. El claim acredita unidades al conductor, en un ledger independiente; no crea pagos ni facturas. La campaña define cuándo se puede activar y el campo de vigencia define hasta cuándo pueden usarse las unidades.

Al aceptar un viaje, la API usa primero una cortesía por días vigente; si no existe, usa un crédito de viaje gratis antes de consumir paquete comprado o saldo. La asignación conserva el total del pasajero y registra `BENEFIT_FREE_TRIP` con comisión aplicada de $0. El uso ocurre una sola vez al aceptar, incluso ante reintentos. Una cancelación del pasajero antes de iniciar devuelve el crédito; una cancelación del conductor después de aceptar lo conserva consumido, igual que el paquete por viajes. Al agotarse o vencer el crédito, se aplica la modalidad de cobro habitual. Suspensiones de cuenta, documentos y membresía siguen bloqueando al conductor.

`GET /v1/benefits/mine` y el historial administrativo exponen `remainingTrips`. Pausar la definición impide nuevas activaciones sin quitar unidades ya acreditadas.

## API

Móvil, sesión autenticada:

- `GET /v1/benefits/available`: solo beneficios aplicables; coordenadas opcionales para resolver áreas.
- `GET /v1/benefits/mine`: historial del usuario.
- `GET /v1/benefits/:code?campaignId=...`: estado y cobertura para el detalle.
- `POST /v1/benefits/:code/claim`: solo `campaignId` y coordenadas opcionales. Rechaza campos extra (días, dinero, userId).

Errores funcionales: `ALREADY_REDEEMED`, `NOT_ELIGIBLE`, `BENEFIT_LIMIT_REACHED`, `BENEFIT_EXPIRED`, `BENEFIT_UNAVAILABLE`.

Admin, permisos `benefits:view` / `benefits:manage`:

- `GET/POST /v1/admin/benefits`
- `PUT /v1/admin/benefits/:id` con versión
- `GET /v1/admin/benefits/redemptions` con filtros y paginación
- `GET /v1/admin/benefits/:id/history`

Cada creación/edición/claim/reprogramación y rechazo funcional se registra en `audit_log`. Métricas actuales: activaciones y total otorgado por definición. Elegibles únicos, visualizaciones y tasa de conversión no se inventan: quedan para instrumentación posterior.

## Panel y Flutter

Campañas → **Beneficios y recompensas**: definiciones, formulario con explicación de vigencia/cobertura/límites, historial, filtros por fecha/código/audiencia/zona/estado y auditoría. El código no se edita. Las variantes no implementadas se identifican como preparación y no pueden activarse.

Para fundador:

1. Crear el beneficio con el preset, establecer fechas/límite global/zona y guardar Activo.
2. En una campaña para conductores, seleccionar el beneficio y usar acción Detalle de campaña. Configurar Home si se desea la tarjeta.
3. Aprobar y activar la campaña mediante el flujo existente.
4. Conductor aprobado abre el detalle → Tu beneficio → Activar cortesía.
5. Revisar redención y cobertura real; repetir no entrega otra cortesía.

Flutter: servicio reutilizable `CostaGoBenefitsService` y bloque `CostaGoBenefitPanel`; usa resultados/fechas reales, deshabilita doble clic y recupera el estado tras una respuesta perdida. No añade una sección permanente a Mi cuenta. Membresía muestra las coberturas y ganancias identifica la cortesía.

## Preparación y límites de la fase

El wallet actual reserva, libera y liquida dinero real mediante SQL y snapshots por viaje. Mezclar promociones ahí sin reservas y reversos por crédito podría cobrar fondos incorrectos. En la fase de referidos, el ledger separado ya recibe créditos automáticos reales y aplica vencimiento configurable. Su consumo en viajes, reservas y reversos aún no está habilitado. No se alteró `driver_wallets` para otorgar promociones.

Referidos: implementación funcional posterior en [costa-go-referrals.md](costa-go-referrals.md), con programas administrables, enlaces personales, atribución y procesamiento automático de evidencia real. Reutiliza el mismo motor de concesión.

Descuentos: solo tipos y contratos; aún falta su aplicación al tarifario. La expiración operativa de cortesía es su duración en días desde el inicio efectivo; los otros modos de expiración se reservan para handlers futuros.

Notificaciones: las redenciones auditadas sirven de referencia para el sistema existente. No se añadió otro motor push ni envío automático de correo. La activación se confirma en pantalla.

## Verificación

Suite backend de beneficios: aprobado/no aprobado/rechazado/inactivo/suspendido, campaña/beneficio vencidos, doble clic, concurrentes, duplicación, nueva sesión/dispositivo, membresía vigente intacta, sin membresía, programación y reprogramación, límites, campos maliciosos, áreas y permisos. Restricciones de infraestructura de referidos verificadas sin otorgar premios.

Suite comercial/cancelaciones con migración nueva: aceptación/completado de cortesía sin débito ni consumo de paquete, reintentos y regresiones del flujo pagado.

Flutter: claim único durante espera, fechas de servidor, redención recuperada al reabrir y no elegibilidad; regresiones de campañas. Compilación TypeScript API/panel, build Vite y análisis Flutter.

Cambios locales: no migración remota, despliegue, activaciones ni emisiones fiscales durante estas verificaciones.

Resultado local: 102 pruebas backend aprobadas entre las suites relevantes, 10 pruebas Flutter aprobadas, análisis Flutter sin incidencias y compilaciones API/TypeScript/panel Vite correctas. No se generó ni instaló APK en esta fase.
