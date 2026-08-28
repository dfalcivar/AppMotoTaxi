# Costa-Go 0.16.1 (51)

Nombre para Play Console: **Costa-Go 0.16.1 - Viajes y alertas**

## Notas para Play Console (es-419)

<es-419>
Mejoramos las alertas de viajes y su cierre al aceptar, rechazar o cancelar.
Corregimos el contador de mototaxis disponibles y los estados de búsqueda sin conductor.
Ahora puedes cancelar antes de iniciar el viaje, con advertencias según la política de cancelaciones.
Si el pasajero cancela, se devuelve al conductor el viaje descontado de su ciclo de membresía.
Mejoramos la confirmación de rechazo y la información para compartir viajes.
El método DEUna ahora se muestra como Transferencia.
</es-419>

## Alcance de la entrega

- Alertas Android centralizadas y cierre por viaje, deduplicación y vencimiento; se respetan los ajustes del teléfono.
- Conteo de conductores elegibles sin truncamiento y con actualización según disponibilidad/método de pago.
- Cancelación del pasajero antes del inicio, liberación del conductor y consistencia del estado de búsqueda/asignación.
- Política parametrizable de cancelaciones, ciclos iniciales de 30 días desde la primera cancelación penalizable, auditoría permanente y suspensiones independientes del vencimiento del ciclo.
- Reversión idempotente del consumo de membresía exclusivamente cuando cancela el pasajero después de aceptación y antes de iniciar; la cancelación del conductor no revierte ese consumo.
- Nuevo modal de rechazo, claro/oscuro, sin cambiar su lógica.
- Presentación Transferencia, sin renombrar DEUNA en contratos o base de datos.
- Panel: historial/ciclo de cancelaciones, corrección de datos de pasajeros/conductores y baja lógica auditable de conductores incompletos sin actividad.
- Verificación y recuperación de credenciales no levantan suspensiones; corregir identidad invalida accesos/códigos anteriores.

## Secuencia de publicación

1. Publicar API y panel desde el mismo commit; API ejecuta migraciones 069, 070 y 071.
2. Confirmar despliegue correcto antes de distribuir el AAB.
3. Play Console → Prueba interna → Crear versión → cargar `Costa-Go-0.16.1-build51.aab`.
4. Pegar nombre y notas; revisar y publicar para testers internos.
5. Validar en teléfonos antes de promover el mismo código 51 a prueba cerrada. No subir otra vez el mismo archivo como código nuevo: seleccionar la versión desde la biblioteca o promoverla.

Compilación oficial: firma existente, package `ec.atacames.mototaxi.mototaxi_atacames`, Google Maps, Sentry y entorno production, sin proxy de laboratorio.

No incluye una corrección nueva del timeout de 35 segundos de la versión 50: ese evento solo fue diagnosticado.

## Pruebas físicas pendientes

En dos teléfonos: solicitudes/rechazo/expiración/aceptación/cancelación, una sola alerta y cierre de sonido, segundo plano/bloqueado, apertura desde notificación, cero conductores, pago incompatible, contador de ciclo antes/después de cancelar, y advertencias/suspensiones con cuentas exclusivas de QA. La compilación y los tests automatizados no sustituyen estas pruebas con FCM real.
