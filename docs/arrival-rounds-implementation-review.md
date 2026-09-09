# Tarifa de llegada y precios sugeridos: revisión previa

Nota histórica: este documento registra la primera etapa. La implementación
integrada posterior está documentada en `arrival-commercial-model-implementation.md`.
El estado parcial descrito abajo corresponde a esa etapa anterior.

Estado: implementación parcial local. Bloque programados conectado a vista previa,
creación y reprogramación; motor económico puro con pruebas. Sin despliegue ni
activación en producción. La migración nueva se ha probado solo en PGlite.

## Reutilización identificada

- `apps/api/src/driver-search.ts`: radios inicial, incremento, máximo y tiempo por ronda. `nextSearchBounds` ya contempla la última ronda parcial mediante `Math.min`.
- `apps/api/src/app.ts`: despacho, ofertas y aceptación inmediata. `driver_offers.search_round` identifica la ronda de la oferta; no usar la ronda global mutable del viaje como sustituto.
- `apps/api/src/fare-engine.ts`: tarifa territorial, tarifa por distancia, paradas y `platform_commission_cents_per_leg`. Este último se aplica por tramo, mientras que la nueva llegada se define por asignación: no sumarlos automáticamente ni cambiar históricos.
- `apps/api/src/memberships.ts`: planes versionados, órdenes, IVA, aprobación y renovación. Las versiones nuevas reemplazan el catálogo vigente sin actualizar los snapshots de ciclos existentes.
- `apps/api/src/membership-trip-usage.ts`: consumo al aceptar, bloqueo de facturación, idempotencia por viaje/conductor y reversión por cancelación del pasajero. El paquete se agota al consumir créditos. La finalización actualmente solo registra metadatos.
- Tope actual: `max_renewal_amount_snapshot` incluye el precio base. El máximo adicional equivalente es `max(0, max_renewal_amount_snapshot - base_membership_amount_snapshot)`. No reinterpretar el total como un cargo adicional.
- Excedente actual: cantidad extra multiplicada por cuota fija snapshot. Los ciclos activos deben conservar esa política; la nueva política variable necesita distinguirse explícitamente para ciclos futuros.
- `apps/api/src/taxes.ts`: configuración fiscal compartida. Actualmente calcula con `number`; el nuevo cálculo financiero requiere precisión decimal y pruebas de redondeo, sin introducir una calculadora alternativa en Flutter.

## Regla de programados confirmada por el usuario

La ruta `/v1/driver/scheduled-offers/:tripId/respond` permite aceptar una reserva futura y registra el consumo de membresía antes de iniciar el despacho inmediato. No hay ronda de búsqueda en esa aceptación. El usuario definió tarifa programada día/noche determinada por `scheduledPickupDateTime`, nunca por creación, aceptación o GPS. Se congela al confirmar la reserva y se recalcula solo tras modificación voluntaria con confirmación de precio. Se reutiliza la participación general, no una participación distinta por horario.

## Bloque implementado localmente

- `commercial-economics.ts`: aritmética racional con BigInt y redondeo HALF_UP a centavos; llegada por rondas reutilizando límites de despacho; tarifa programada; resolución pura de modalidades y topes; costo/sugerencia por paquete con mezcla progresiva de muestra y referencia. Los cálculos de saldo/paquetes todavía no están conectados al cobro real.
- `scheduled-arrival.ts`: configuración validada, permiso `settings:manage`, actualización con bloqueo/versión y auditoría; huella de confirmación de vista previa.
- Migración `087_scheduled_arrival_configuration.sql`: dos campos en `operational_settings`, sin precios iniciales inventados. Configuración nula conserva el comportamiento previo.
- Rutas nuevas GET/PUT `/v1/admin/scheduled-arrival-settings`.
- Rutas de vista previa, creación y modificación de programados: sustituyen el adicional heredado por llegada programada cuando está habilitada; nunca suman ambos. Rechazan un precio no confirmado. Los reintentos de asignación no recalculan.
- Snapshot dentro de `trips.pricing_snapshot.economic`, con tarifa, horario, instante del servicio, porcentaje, comisión teórica y versión. `billingMode` queda nulo al reservar: el conductor aún no existe. Falta resolver/persistir su modalidad al aceptar como parte de la integración general.
- Reprogramación conserva el snapshot previo en `trip_events`.
- Panel: formulario independiente en parámetros de membresías, confirmación administrativa y control de versión.
- App: envía la huella de la vista previa, muestra llegada separada, mantiene la confirmación existente y el diseño actual.

## Condiciones del complemento incorporadas al alcance

- Recalcular costos técnicos y sugerencias, nunca publicar precios automáticamente.
- Factores, descuento, costo fijo y mínimo por paquete, no un multiplicador universal.
- Historial por zona con muestra suficiente; referencia global/configurada cuando no alcance.
- Ventana, muestra mínima y distribución de referencia parametrizadas.
- Aplicación administrativa explícita con confirmación y control de versión concurrente.
- Snapshot de compra con precio, IVA, cantidad, estimación técnica, distribución/ronda, participación, configuración y ámbito estadístico.
- No modificar órdenes ya generadas, compras, viajes ni créditos históricos.
- Saldo operativo independiente de los paquetes y planes; reservar al aceptar y liquidar o liberar una sola vez según resultado.

## Pendiente de implementar y verificar

No está terminada la implementación del modelo completo. Faltan saldo transaccional,
recargas, reservas/débitos/liberaciones, integración comercial al aceptar/finalizar,
tarifa inmediata por oferta, sesiones antiabuso, adaptación de ciclos futuros,
cron/publicación/versionado de precios sugeridos, snapshots de compras, métricas y
el resto de la interfaz. No activar la configuración programada en producción
hasta integrar la modalidad comercial del conductor: la lógica actual de cargos
de membresía permanece intacta y todavía no usa la nueva comisión por llegada.

Pruebas iniciales: 48 pruebas de backend seleccionadas y 41 pruebas de
`apps/mobile/test/main_test.dart` aprobadas; typecheck API/admin aprobado antes
de la revisión final. No equivalen a pruebas completas de cobro/concurrencia ni
a validación visual en emuladores.
