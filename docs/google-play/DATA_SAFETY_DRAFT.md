# Borrador — Seguridad de los datos

Este inventario debe trasladarse al formulario de Play Console y revisarse contra el artefacto AAB final. Google considera “recopilado” un dato enviado fuera del dispositivo, aunque se conserve poco tiempo.

## Datos recopilados por Costa-Go

| Categoría de Play | Datos | Finalidad principal | Obligatorio |
|---|---|---|---|
| Información personal | Nombre, correo, teléfono, identificador de usuario | Crear y administrar la cuenta, seguridad, soporte y operación del viaje | Sí |
| Fotos y videos | Foto de perfil; para conductores, fotografía y documentos habilitantes; adjuntos de soporte | Verificación, seguridad, cuenta y soporte | Foto de pasajero opcional; documentos de conductor obligatorios |
| Ubicación | Ubicación aproximada y precisa, origen, destinos, ruta y seguimiento del conductor | Cobertura, búsqueda y asignación, rutas, navegación, seguridad y seguimiento | Necesaria para solicitar o prestar viajes |
| Actividad de la aplicación | Solicitudes, viajes, estados, favoritos, calificaciones, chat e incidentes | Funciones de la aplicación, seguridad, soporte y mejora operativa | Según la función usada |
| Información financiera | Importe del viaje y método de pago declarado | Resumen, historial y operación del viaje | Sí para un viaje |
| Identificadores del dispositivo | Token FCM e información de sesión/dispositivo | Notificaciones, seguridad de sesión y prevención de duplicados | Sí para notificaciones y sesión |
| Rendimiento y diagnóstico | Errores, versión y métricas técnicas mediante Sentry cuando está configurado | Estabilidad, diagnóstico y seguridad | Automático en versiones configuradas |

Costa-Go no procesa actualmente números de tarjeta ni credenciales bancarias. El método de pago registrado es información operativa del viaje.

## Uso y tratamiento

- Los datos se transmiten cifrados mediante HTTPS/TLS.
- Las contraseñas no se almacenan en texto legible.
- Pasajero y conductor reciben los datos necesarios de la contraparte para completar el viaje: nombre, fotografía, calificación, vehículo/placa, teléfono de contacto y ubicación de seguimiento cuando corresponda.
- Render/PostgreSQL, Google Maps Platform, Firebase, Sentry y Resend actúan como proveedores técnicos según la función habilitada.
- Los banners de comercios se sirven desde la infraestructura de Costa-Go. No se declara uso de ubicación para personalizar publicidad.
- No se vende información personal.

## Eliminación

- Solicitud dentro de la app: `Mi cuenta → Privacidad y datos → Eliminar mi cuenta`.
- Solicitud web: `https://costa-go.com/account-deletion.html`.
- La eliminación cubre datos personales, fotos, documentos, favoritos, mensajes, tokens y ubicaciones precisas.
- Registros mínimos necesarios por seguridad, prevención de fraude, reclamos o cumplimiento pueden conservarse anonimizados.

## Respuestas que deben confirmarse al llenar Play Console

1. Marcar que la aplicación recopila y comparte datos conforme a la definición de Google.
2. Marcar cifrado en tránsito: **Sí**.
3. Marcar mecanismo de eliminación de cuenta: **Sí**, dentro y fuera de la app.
4. Declarar ubicación aproximada y precisa; para el conductor, uso en segundo plano.
5. Declarar mensajes de chat como “Otros contenidos generados por el usuario” si así aparece en el formulario vigente.
6. Revisar la lista automática de SDK del AAB antes de enviar; sus prácticas deben coincidir con Firebase, Google Maps y Sentry realmente incluidos.
7. No marcar publicidad personalizada ni recopilación del identificador publicitario salvo que una versión futura incorpore un SDK que lo haga.
