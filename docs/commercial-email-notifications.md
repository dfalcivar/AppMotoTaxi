# Correos de campañas comerciales

Esta evolución agrega `EMAIL` al `NotificationService` existente. No crea otro proveedor ni otro programador: usa Resend mediante `email.ts` y se ejecuta dentro de `advertisingSchedulerTick`.

## Eventos

- `CAMPAIGN_EXPIRING_7D`
- `CAMPAIGN_EXPIRING_3D`
- `CAMPAIGN_EXPIRED`
- `CAMPAIGN_MONTHLY_REPORT`

La migración los deja desactivados. Se habilitan de manera individual en **Notificaciones → Correos comerciales**. Los días de anticipación y el día del reporte viven en `notification_event_definitions.schedule_config` y se actualizan por la API administrativa.

Los cuatro eventos se clasifican como `SERVICE_TRANSACTIONAL`: informan sobre un servicio publicitario contratado y no se mezclan con promociones masivas. La estructura admite `PROMOTIONAL` de forma explícita para futuras campañas con consentimiento propio.

## Entrega e idempotencia

Cada envío real tiene una clave única compuesta por campaña, evento y período. La cola `notification_email_deliveries` registra intentos, próxima ejecución, resultado de Resend, error y fecha de entrega. Los fallos transitorios se reintentan con espera incremental y terminan en `FAILED` al alcanzar el máximo configurado. Los envíos `TEST` no comparten la restricción de los envíos reales y no cambian campañas ni métricas.

## Métricas

Los correos consultan directamente `advertising_events`: impresiones y clics/acciones. El CTR es `clics / impresiones × 100`, o cero cuando no existen impresiones. No se presenta alcance porque `session_key_hash` no representa de forma fiable a una persona única.

## Prueba manual segura

1. Aplicar la migración 086.
2. Abrir **Notificaciones → Correos comerciales**.
3. Elegir un evento y dejar “Datos de demostración” o seleccionar una campaña real.
4. Generar la vista previa y comprobar escritorio/móvil.
5. Enviar una prueba a uno de los correos autorizados. La lista se forma con el correo del administrador autenticado y `advertising_commercial_emails`.
6. Verificar el registro `TEST` en el historial. No debe cambiar el estado ni la vigencia de la campaña.

Para producción deben existir `RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL` y `PUBLIC_WEB_BASE_URL`. La URL del CTA se toma de `operational_settings.advertising_renewal_contact_url`; si está vacía usa `/anunciarme` del sitio público.
