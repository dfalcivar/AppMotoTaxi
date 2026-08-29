# Fase 3 — Registro y aprobación de conductores

## Flujo implementado

1. El conductor crea su cuenta con foto frontal y vehículo.
2. La cuenta queda restringida y puede acceder únicamente a su perfil, documentos, notificaciones y cierre de sesión.
3. Debe cargar foto, identificación, licencia y matrícula. Los anexos del expediente del conductor son opcionales.
4. Al completar los cuatro documentos obligatorios pasa automáticamente a `PENDIENTE_REVISION`.
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

La aprobación final se rechaza con `DRIVER_DOCUMENTS_NOT_APPROVED` si alguno no está aprobado individualmente.

`OPERATING_PERMIT` permanece como identificador interno compatible, pero se presenta al usuario como **Anexos** y es opcional. Su ausencia o estado no impide aprobar los cuatro obligatorios y tampoco sustituye ninguno de ellos. No se elimina ni renombra ningún archivo existente.

Esta regla se refiere al expediente del conductor. Los documentos, revisión, autorización y jornada de la mototaxi mantienen su flujo independiente, documentado en [Flota y jornadas](FLOTA_MOTOTAXIS_Y_JORNADAS.md). Aprobar al conductor no aprueba automáticamente sus vehículos ni lo conecta para recibir viajes.

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

`075_optional_driver_operating_permit.sql` deja en revisión los expedientes no eliminados que estaban en `PENDIENTE_DOCUMENTOS` y ya tienen los cuatro documentos obligatorios cargados. No aprueba cuentas ni modifica decisiones previas, documentos, membresías o vehículos.

Los listados administrativos conservan `approvedDocuments` y `uploadedDocuments` como totales de archivos. Añaden `requiredDocumentCount`, `approvedRequiredDocuments` y `uploadedRequiredDocuments` para la aprobación y los indicadores de obligatorios. El panel no suma archivos opcionales al umbral de aprobación.

## Pendiente: catálogo de documentos configurable

Próxima mejora, **no implementada en esta entrega**:

- Administrar desde el panel el nombre visible y la obligatoriedad de los documentos, diferenciando conductor y vehículo.
- Incorporar un catálogo servido por la API y consumido por la app, conservando identificadores internos, archivos e historial.
- La interfaz muestra «Anexos» sin cambiar su identificador interno `OPERATING_PERMIT`.
- Versionar/auditar cambios, restringirlos a administradores autorizados y definir su aplicación a expedientes existentes.
- Ese soporte dinámico requerirá una primera actualización de la app; después los cambios de nombre/requisitos del catálogo no necesitarán nuevos AAB.

La obligatoriedad se controla en API y la etiqueta se presenta como «Anexos» en las interfaces nuevas. Las apps anteriores pueden conservar temporalmente la etiqueta previa, pero su ausencia no impide la aprobación en el servidor actualizado.

## Prueba manual

1. Crear un conductor y comprobar `PENDIENTE_DOCUMENTOS`.
2. Cerrar sesión e ingresar de nuevo: debe abrir la pantalla de habilitación, no el mapa de viajes.
3. Cargar los cuatro documentos obligatorios, sin permiso, y comprobar `PENDIENTE_REVISION`.
4. Desde el panel, abrir y aprobar cada documento.
5. Intentar aprobar antes de tener los cuatro obligatorios aprobados: debe bloquearse, incluso si el permiso opcional está aprobado.
6. Solicitar correcciones con observación y comprobarla en el teléfono.
7. Reemplazar el documento observado y reenviar a revisión.
8. Aprobar y volver a iniciar sesión: debe habilitarse el módulo normal de conductor.
9. Verificar que soporte no pueda tomar decisiones de aprobación.
