# Costa-Go: privacidad y preparación para Google Play

## Decisiones confirmadas

- Tipo de cuenta de Google Play: personal.
- Identificador Android conservado: `ec.atacames.mototaxi.mototaxi_atacames`.
- Marca visible: Costa-Go.

## URLs públicas

- Política de privacidad: `https://costa-go.com/privacy.html`
- Eliminación de cuenta: `https://costa-go.com/account-deletion.html`

Estas páginas se publican con el servicio estático administrativo y no requieren iniciar sesión.

## Configuración de Render necesaria

API:

- `RESEND_API_KEY`: credencial de Resend autorizada para enviar correos.
- `NOTIFICATION_FROM_EMAIL`: remitente verificado, por ejemplo `Costa-Go <cuentas@dominio-verificado>`.
- `PUBLIC_WEB_BASE_URL`: `https://costa-go.com`.
- `ADMIN_SESSION_SECRET`: ya debe existir; también protege el hash de códigos y enlaces.

## Declaraciones de Google Play

En **Política y programas → Contenido de la aplicación** completar:

1. Política de privacidad: usar la URL pública indicada arriba.
2. Seguridad de los datos: declarar cuenta, contacto, ubicación precisa, fotos/documentos, mensajes, actividad de la app, identificadores del dispositivo, diagnósticos y datos de viajes según el comportamiento real.
3. Eliminación de datos: indicar que se permite solicitar eliminación dentro de la app y usar la URL pública de eliminación.
4. Permisos sensibles → Ubicación: declarar la función principal de seguimiento/navegación del conductor en segundo plano.
5. Proporcionar un video corto que muestre: divulgación previa, permiso del sistema, conductor disponible o en viaje, app en segundo plano y notificación persistente.
6. Acceso a la app: entregar cuentas de revisión válidas para pasajero y conductor aprobado.

## Texto de divulgación implementado

Antes de solicitar por primera vez el permiso de ubicación, la app informa que Costa-Go recopila ubicación para seleccionar recogida, encontrar viajes o conductores, seguimiento y navegación, incluso cuando la app está cerrada o no está en uso. También informa que no se usa para publicidad.

## Recuperación de contraseña

1. El usuario indica su correo.
2. La API siempre responde de forma genérica para no revelar si existe la cuenta.
3. Si existe, envía por correo un código de seis dígitos.
4. El código caduca en 15 minutos, tiene límite de intentos y no se almacena en texto plano.
5. Al cambiar la contraseña se revocan sesión y tokens push anteriores.

## Eliminación de cuenta

- Dentro de la app exige contraseña y doble confirmación.
- Fuera de la app exige verificar el correo mediante un enlace de 24 horas.
- Se eliminan tokens, fotos, documentos, favoritos, mensajes, soporte adjunto y ubicaciones precisas.
- Los registros mínimos operativos o de seguridad se anonimizan.
- No se permite completar la eliminación durante un viaje pendiente o activo.

## Antes de enviar a revisión

- Revisar la redacción legal y consignar en la política el mismo nombre personal que figure como desarrollador en Google Play si Google lo exige durante el alta.
- Probar que ambas URLs cargan sin autenticación después del despliegue.
- Probar entrega real de correo desde Resend.
- Crear un Android App Bundle (`.aab`) firmado; el APK universal sirve para pruebas manuales, no como artefacto principal de Play.
- Verificar formularios de clasificación de contenido, público objetivo, anuncios y acceso de revisores.
