# Evolución del sistema de notificaciones Costa-Go

## Inventario previo

La implementación existente ya dispone de las siguientes fuentes de verdad y se conservan:

- `sendPush` en `apps/api/src/push.ts`: envío real por Firebase/FCM, selección de canales Android, sonido, vibración, icono Costa-Go, APNS, invalidación de tokens y diagnóstico de entrega.
- `user_notifications`: historial visible en la campana y el centro móvil, con leído/no leído, contador, paginación y datos de navegación.
- `push_delivery_events`: diagnóstico no sensible de intentos, envíos, fallos y duración de FCM.
- `device_tokens`: tokens Android/iOS asociados al usuario y su última actividad.
- `trip_events`, `trips` y `favorite_places`: fuentes de verdad para comportamiento y patrones. Los patrones SMART son derivados y no sustituyen estos datos.
- `audit_log`: auditoría administrativa existente.
- schedulers de API: ejecución periódica con cierre controlado junto al proceso Fastify.
- clientes Flutter: foreground, background, aplicación cerrada, canales nativos, deep-links, campana y centro de notificaciones.

## Decisiones de compatibilidad

1. Las llamadas transaccionales actuales a `sendPush` no se reemplazan ni quedan sujetas a límites SMART.
2. `NotificationService` es una fachada compatible para SMART, campañas y pruebas. Reutiliza `sendPush`, `user_notifications` y `push_delivery_events`.
3. `user_notifications` se amplía de forma incremental con categoría, prioridad, estado, idempotencia y métricas. Las filas existentes reciben valores seguros.
4. `device_tokens` se amplía con estado e invalidación; no se crea otra tabla de tokens.
5. La configuración SMART, testers, campañas y destinatarios requieren tablas nuevas porque no existe una entidad equivalente.
6. Los patrones almacenados son caché derivada para evitar recalcular todo el historial. `trips` continúa siendo la fuente principal.
7. El estado inicial es `OFF`: se permite analizar, simular y probar manualmente, pero no existen envíos SMART automáticos ni campañas automáticas activas.

## Categorías

- `TRANSACTIONAL`: viajes, cancelaciones, seguridad y otros eventos críticos existentes.
- `OPERATIONAL`: membresías, soporte, flota y operación.
- `SMART`: recomendaciones individuales derivadas de patrones.
- `CAMPAIGN`: comunicaciones administrativas segmentadas.
- `PROMOTIONAL`: promociones aprobadas por Costa-Go.

Los límites de frecuencia solo se consultan para `SMART`, `CAMPAIGN` y `PROMOTIONAL`.

