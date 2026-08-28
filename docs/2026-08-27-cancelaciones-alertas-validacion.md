# Cancelaciones, alertas y coherencia del viaje

Implementación local del pedido del 27 de agosto de 2026 sobre `main`, base `a4eb811` (coincidente con `origin/main` al iniciar). Sin despliegue, cambios en datos de producción, commit ni APK/AAB nuevos en esta entrega.

## Cambios

1. **Ofertas del conductor:** cierre de alerta al aceptar/rechazar/descartar, cancelación del pasajero, asignación a otro conductor y vencimiento. La app valida la oferta vigente antes de anunciar eventos atrasados; el plazo viene del servidor. Se eliminaron los métodos nativos anteriores que mantenían otro identificador de notificación.
2. **Conteo cercano:** se eliminó el tope de 20 resultados que truncaba el contador. Los snapshots mantienen radio configurado, disponibilidad, cuenta activa, aprobación, documentos, membresía, ausencia de otro viaje y GPS reciente. El conductor no se cuenta a sí mismo. Al fallar la consulta se muestra actualización pendiente en vez de conservar un número obsoleto. Los updates de pasajeros también retiran conductores que dejan de ser elegibles o no aceptan el método de pago.
3. **Alertas:** puente Android local `costa_go_alerts`, registrado en el motor principal y en el motor de Firebase en segundo plano. Deduplicación persistente entre motores; cierre por viaje; timeout nativo; eventos de cierre silenciosos; acceso al viaje al pulsar la notificación, tanto para pasajero como para conductor. Se conservan los canales existentes y las preferencias de sonido/vibración del sistema. Los eventos recibidos en segundo plano no crean además un banner sonoro de Flutter.
4. **Cancelación del pasajero:** botón y confirmación antes de iniciar el viaje, incluidos conductor en camino y conductor llegado. La transacción cambia el viaje a cancelado, cierra ofertas, libera al conductor cuando no tiene otro viaje activo y registra auditoría. La navegación integrada se detiene; una ruta que termine de calcularse después de cancelar ya no se abre.
5. **Sanciones:** solo cuentan cancelaciones posteriores a una aceptación real. Se conserva el consecutivo de por vida; reactivar no lo reinicia. Reintentar el mismo viaje devuelve el resultado guardado, incluso si esa cancelación suspendió la cuenta. No vuelve a contar ni notificar.
6. **Asignaciones fantasma:** `NO_DRIVER` deja de caer en el diseño de conductor en camino; muestra “Ninguna mototaxi disponible en este momento.” y libera la pantalla de solicitud. Los estados asignados requieren un conductor válido para mostrarse. La base impide nuevas transiciones a asignado/en camino/llegado/en curso sin conductor, fecha de asignación y prueba de aceptación en ofertas o reservas. Se respeta el orden de bloqueos en aceptación/cancelación y se vuelve a validar una reserva al activarla.
7. **Presentación:** `Transferencia` sustituye a DEUna en etiquetas de app y panel. Los valores `DEUNA`, campos, APIs y reglas de pago no cambian.
8. **Seguridad del viaje:** la placa se obtiene del vehículo asignado, con respaldo en el vehículo registrado del conductor cuando el viaje no guardó `vehicle_id`. El texto compartido por conductor identifica al pasajero. No se rediseñó el modal ni se cambiaron sus acciones.

La búsqueda progresiva conserva sus parámetros. Las ofertas incorporadas al conectarse un conductor respetan el anillo actual y su vencimiento, en lugar de volver a alcanzar radios anteriores o ampliar el plazo de esa ronda.

## Configuración y auditoría

Panel → **Configuración operativa → Cancelaciones después de aceptar → Configurar política**.

| Desde cancelación | Medida inicial |
| --- | --- |
| 1 | Registro/advertencia (incluye la 2) |
| 3 | 2 días |
| 4 | 5 días |
| 5 | 7 días |
| 6 | Indefinida |

Se pueden cambiar umbrales/días, agregar rangos y desactivar sanciones automáticas manteniendo el registro. Cambiar parámetros no modifica sanciones ya aplicadas. Las finitas se liberan por mantenimiento periódico y antes de autenticar; las indefinidas solo por administración.

Panel → **Pasajeros → número de cancelaciones** abre el historial paginado: viaje, conductor, fecha, consecutivo, estado previo y medida aplicada. **Reactivar** usa la acción administrativa existente, conserva el contador y registra el actor y momento de reactivación.

Permisos reutilizados y comprobados en backend: `settings:view`, `settings:manage`, `passengers:view`, `passengers:manage`.

## Contratos y migración

- `GET/PATCH /v1/admin/settings/passenger-cancellations`: consultar/editar política.
- `GET /v1/admin/passengers/:id/cancellations?page=1`: historial (20 filas por página).
- `GET /v1/passenger/cancellation-policy`: advertencia para la próxima cancelación.
- `POST /v1/trips/:tripId/cancel`: misma operación existente, ampliada a antes de iniciar; devuelve `consequence` y reintentos idempotentes.
- Registro de dispositivo existente: campo opcional `notificationProtocol` (1 por defecto, 2 para la nueva app Android).
- Migración `069_passenger_cancellations_and_trip_integrity.sql`: política en `operational_settings`; contador y suspensión en `users`; tabla `passenger_cancellations`; protocolo en `device_tokens`; trigger de integridad en `trips`.

Los clientes anteriores conservan la presentación FCM anterior. La nueva app Android recibe ofertas y cierres como datos y los presenta mediante el puente nativo. Se debe desplegar primero la API con la migración, después el panel y finalmente distribuir la nueva app. Esta secuencia todavía **no se ha ejecutado**.

## Verificación automática

- API: **144 pruebas aprobadas**, incluidas 9 de cancelaciones/migración sobre PostgreSQL aislado (PGlite), permisos HTTP y mapeo de datos compartidos.
- Panel: **5 pruebas aprobadas**, TypeScript y build de producción correctos.
- Flutter: **42 pruebas aprobadas** y `flutter analyze` sin incidencias.
- Android: `:app:compileReleaseKotlin` y `:costa_go_alerts:compileDebugJavaWithJavac` correctos. Compilación de clases, sin empaquetar APK/AAB. Permanecen advertencias de APIs Android antiguas y del Kotlin de Gradle preexistentes.
- La variante debug no tiene cliente `.debug` en el `google-services.json` local; no se cambiaron credenciales ni identificadores para sortearlo. La comprobación de MainActivity se completó con la variante release existente.
- PGlite verifica SQL, transacciones y trigger, pero no sustituye una prueba concurrente con varias conexiones PostgreSQL/PostGIS ni con Firebase real. Las pruebas de compartir viaje usan datos simulados para verificar el contrato de cada perfil.

Comandos (desde las carpetas indicadas):

```powershell
# Raíz
pnpm --filter @mototaxi/api typecheck
pnpm --filter @mototaxi/admin test
pnpm --filter @mototaxi/admin build

# apps/api (los tests existentes dependen de este directorio de trabajo)
node node_modules/vitest/vitest.mjs run

# apps/mobile
flutter analyze
flutter test

# apps/mobile/android, con GRADLE_USER_HOME apuntando al caché instalado
.\gradlew.bat :app:compileReleaseKotlin :costa_go_alerts:compileDebugJavaWithJavac --offline --no-daemon
```

## Pendiente antes de publicar: dos teléfonos

No se ejecutaron pruebas físicas ni se enviaron notificaciones reales durante esta implementación. Repetir cada escenario con la app visible, minimizada, pantalla bloqueada y retirada de recientes:

1. Solicitar viaje, comprobar una sola alerta; rechazar, aceptar, dejar vencer, asignar a otro conductor y cancelar desde pasajero. Confirmar que sonido/vibración terminan y que no reaparecen por eventos atrasados.
2. Pulsar notificaciones de oferta, chat, llegada, cancelación, viaje terminado y reserva. Deben abrir el registro correcto, también al iniciar la app.
3. Comparar contador contra conductores disponibles dentro del radio. Repetir con conductor ocupado, suspendido, membresía vencida, pago incompatible, conexión perdida y GPS antiguo. Se conserva la ventana existente de GPS de 5 minutos: no se interpreta un cierre abrupto del socket como una desconexión instantánea del servicio.
4. Cancelar antes de asignación (sin sanción), en camino/llegado (cuenta) y después de iniciar (rechazo). Pulsar dos veces y simular pérdida de respuesta; verificar un solo registro. Probar una aceptación y una cancelación simultáneas con conexiones reales.
5. En usuarios exclusivos de QA, recorrer los seis niveles; comprobar imposibilidad de crear nuevas solicitudes suspendido, vencimiento temporal y reactivación manual sin borrar contador.
6. Finalizar búsqueda sin aceptación; debe poderse volver a solicitar, nunca mostrarse conductor en camino sin conductor.
7. Revisar placa y nombre compartido desde ambos perfiles; comprobar claro/oscuro sin cambios visuales del modal de seguridad.

**Límites del sistema:** Costa-Go puede detener su navegación integrada, no cerrar una navegación ya abierta en la aplicación externa Google Maps. Android/iOS controlan permisos, silencio, No molestar y restricciones de batería; no se fuerzan sonidos contra esas preferencias. Forzar detención desde Ajustes puede impedir FCM hasta abrir nuevamente la app. No se implementó una extensión iOS para retirar remotamente alertas ya entregadas: su comportamiento físico debe verificarse por separado.

Referencias técnicas: [Firebase: recepción Flutter](https://firebase.google.com/docs/cloud-messaging/flutter/receive-messages), [Android: Notification.Builder](https://developer.android.com/reference/android/app/Notification.Builder).
