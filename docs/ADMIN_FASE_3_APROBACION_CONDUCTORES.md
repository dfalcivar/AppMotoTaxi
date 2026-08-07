# Fase 3 — Registro y aprobación de conductores

## Flujo implementado

1. El conductor crea su cuenta con foto frontal y vehículo.
2. La cuenta queda restringida y puede acceder únicamente a su perfil, documentos, notificaciones y cierre de sesión.
3. Debe cargar foto, identificación, licencia, matrícula y permiso de operación.
4. Al completar los cinco documentos pasa automáticamente a `PENDIENTE_REVISION`.
5. Se genera una notificación interna y, si está configurado, un correo administrativo.
6. Administración revisa cada documento y después aprueba, observa, solicita correcciones, rechaza o suspende.
7. La decisión registra revisor, fecha, estado anterior, estado nuevo y observación.
8. El conductor recibe una notificación push y visualiza su estado/observación al ingresar.

## Estados de aprobación

- `PENDIENTE_DOCUMENTOS`
- `PENDIENTE_REVISION`
- `OBSERVADO`
- `APROBADO`
- `RECHAZADO`
- `SUSPENDIDO`

Estos estados están separados de `users.status`. El estado de usuario continúa controlando el acceso efectivo, mientras `drivers.approval_status` describe el flujo documental.

## Documentos obligatorios

- `PROFILE_PHOTO`
- `IDENTIFICATION`
- `LICENSE`
- `REGISTRATION`
- `OPERATING_PERMIT`

La aprobación final se rechaza con `DRIVER_DOCUMENTS_NOT_APPROVED` si alguno no está aprobado individualmente.

## Endpoints administrativos

- `GET /v1/admin/driver-approvals`
- `POST /v1/admin/driver-approvals/:id/decision`
- `GET /v1/admin/driver-approvals/:id/history`
- `GET /v1/admin/driver-approval-settings`
- `PUT /v1/admin/driver-approval-settings`
- `GET /v1/admin/notifications`

La aprobación requiere `drivers:approve`. Soporte no obtiene ese permiso por defecto.

## Configuración de correo

Los destinatarios se administran desde el panel y se guardan en `driver_approval_notification_settings`; no están escritos en código.

Para activar correo se requieren en la API:

- `RESEND_API_KEY`
- `NOTIFICATION_FROM_EMAIL`

Si el proveedor no está configurado, la notificación interna continúa funcionando.

## Migración

`018_driver_approval_workflow.sql` agrega:

- columnas de aprobación en `drivers`;
- `driver_approval_reviews`;
- `admin_notifications`;
- `driver_approval_notification_settings`;
- índices para la bandeja e historial.

## Prueba manual

1. Crear un conductor y comprobar `PENDIENTE_DOCUMENTOS`.
2. Cerrar sesión e ingresar de nuevo: debe abrir la pantalla de habilitación, no el mapa de viajes.
3. Cargar cinco documentos y comprobar `PENDIENTE_REVISION`.
4. Desde el panel, abrir y aprobar cada documento.
5. Intentar aprobar antes de tener 5/5: debe bloquearse.
6. Solicitar correcciones con observación y comprobarla en el teléfono.
7. Reemplazar el documento observado y reenviar a revisión.
8. Aprobar y volver a iniciar sesión: debe habilitarse el módulo normal de conductor.
9. Verificar que soporte no pueda tomar decisiones de aprobación.
