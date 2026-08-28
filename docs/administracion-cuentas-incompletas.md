# Corrección de identidad y registros incompletos

## Uso desde el panel

- Pasajeros o Conductores → **Editar datos**: nombre, correo y teléfono; motivo obligatorio.
- Confirmar la nueva dirección con el titular. Un dominio aparentemente incorrecto no demuestra cuál es el correo correcto.
- Cambiar correo o teléfono revoca sesiones, biometría, tokens push, códigos de verificación/recuperación y enlaces pendientes de eliminación anteriores.
- Cambiar el correo exige verificar la nueva dirección. No se envía un correo desde este formulario: el titular ingresa con el correo corregido y utiliza el flujo existente de verificación de la aplicación.
- No se cambia la contraseña, no se aprueba al conductor, no se levantan suspensiones ni se reinician cancelaciones.
- La identidad es compartida entre pasajero y conductor; editarla afecta ambos modos. Se comprueban duplicados entre roles.
- No se permite editar durante un viaje o reserva pendiente. El correo esperado evita guardar una edición sobre una identidad que otro administrador ya cambió.

## Baja de un registro incompleto

Conductores → **Eliminar registro incompleto**, con motivo y confirmación escrita `ELIMINAR`.

Solo se admite para conductores nunca aprobados, pendientes/observados/rechazados y sin viajes (en ninguno de los dos roles), membresías u órdenes de pago. Si existe actividad, corregir datos o utilizar la suspensión; no eliminar su registro por esta vía.

Se realiza una baja lógica: se conserva el UUID, documentos y revisiones; se anonimiza la identidad principal y se bloquea el acceso en ambos modos. Los listados operativos existentes filtran `deleted_at`. El correo y teléfono anteriores quedan libres para un nuevo registro. No es un borrado físico ni sustituye el flujo de eliminación solicitado por el titular.

La repetición de la misma baja no produce una segunda auditoría. Toda la operación es transaccional.

## Permisos y auditoría

Permisos `mobile_accounts:edit` y `mobile_accounts:delete_incomplete`: asignados por defecto únicamente a ADMIN/SUPER_ADMIN; pueden administrarse mediante el sistema de permisos existente. Volver a iniciar sesión en el panel para cargar los nuevos permisos.

Auditoría: `MOBILE_ACCOUNT_IDENTITY_UPDATED` y `INCOMPLETE_DRIVER_ACCOUNT_DELETED`, con actor, cuenta, fecha, motivo y valores anteriores/posteriores. La auditoría conserva la identidad anterior para trazabilidad; nunca contraseñas ni códigos. Su acceso continúa protegido por los permisos actuales.

## Implementación

- PATCH `/v1/admin/mobile-accounts/:id/identity`
- POST `/v1/admin/mobile-accounts/:id/delete-incomplete`
- GET de pasajeros/conductores: estado de verificación; conductores también fecha de aprobación.
- Reutiliza usuarios, `deleted_at`, tablas de credenciales y `audit_log`; no requiere migración.
- Anonimización compartida con la baja del titular, conservando la limpieza adicional propia de ese flujo.
- Verificación y recuperación revalidan correo/código dentro de la transacción y no reactivan cuentas suspendidas.

## Verificación

188 pruebas API, 11 de administración; typecheck API y compilación administrativa. Casos: permisos, duplicados entre roles, teléfonos normalizados, revocación, códigos obsoletos, suspensiones, cuentas eliminadas, bloqueo por historial y baja idempotente. PGlite aislado para transacciones; funciones criptográficas simuladas en esas pruebas, sin modificar pgcrypto de producción.

Modales revisados en navegador con cuenta y respuesta HTTP ficticias, escritorio y pantalla de 390 px: confirmación, cancelar sin cambios, campos bloqueados durante el envío y mensajes de éxito. No se modificaron cuentas reales ni se enviaron correos de Resend.

Publicación necesaria: API y panel. No necesita cambios de APK para estas acciones nuevas.
