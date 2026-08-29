# Seguridad de los datos - inventario vigente

Actualizado el 29 de agosto de 2026. Debe contrastarse con el AAB final y con el formulario vigente de Play Console antes de enviar.

## Datos recopilados

| Categoría Play | Datos Costa-Go | Finalidad |
|---|---|---|
| Información personal | Nombre, correo, teléfono, ID interno, fotografía y capacidades de cuenta | Cuenta, autenticación, soporte, seguridad y operación |
| Fotos y documentos | Perfil; identidad/licencia del conductor; fotos original y normalizada, matrícula y anexos de mototaxi; comprobantes y soporte | Verificación, flota, pagos y soporte |
| Ubicación | Aproximada y precisa, origen, paradas, destino, ruta y tracking del conductor | Cobertura, tarifa, búsqueda, navegación, seguridad y seguimiento |
| Actividad de la aplicación | Solicitudes, viajes, estados, chat, favoritos, calificaciones, cancelaciones, jornadas, QR y soporte | Funcionalidad, seguridad, auditoría y mejora operativa |
| Información financiera | Importe, forma de pago, referencia, comprobante, orden y conciliación | Operación y comprobación de pagos |
| Información fiscal | Identificación, razón social, dirección y correo de facturación cuando se proporcionan | Preparación contable/fiscal; la emisión productiva continúa deshabilitada |
| Dispositivo y diagnóstico | Sesión, token FCM, versión, fallos y rendimiento | Notificaciones, seguridad y estabilidad |

No se almacenan números de tarjeta ni credenciales bancarias. Costa-Go muestra publicidad propia o de comercios afiliados, pero no usa ubicación ni ID publicitario para personalizarla.

## Tratamiento y proveedores

- HTTPS/TLS en tránsito; contraseñas mediante hash.
- Render/PostgreSQL, Google Maps Platform, Firebase, Sentry y Resend procesan lo necesario para su función.
- Durante el viaje se comparte con la contraparte nombre, foto, calificación, mototaxi, teléfono y ubicación necesarios.
- Un enlace temporal compartido muestra estado y ubicación a quien lo posea hasta su caducidad.
- No se venden datos personales.

## Eliminación y conservación

- En app: `Mi cuenta -> Privacidad y datos -> Eliminar mi cuenta`.
- Web: `https://costa-go.com/account-deletion.html`.
- Identidad, credenciales, fotos personales, documentos, mensajes, tokens y ubicación precisa se eliminan o anonimizan; sesiones, jornadas y relaciones se revocan.
- Historia operativa anonimizada puede conservarse hasta 7 años para seguridad, reclamos, fraude, contabilidad o cumplimiento.
- Soportes fiscales: plazo legal aplicable, actualmente al menos 7 años.

## Respuestas a confirmar

1. Recopila datos: **Sí**. Compartir debe declararse según la definición/exenciones vigentes para proveedores y contraparte.
2. Cifrado en tránsito: **Sí**.
3. Creación y eliminación de cuenta: **Sí**, dentro y fuera de la app.
4. Ubicación aproximada y precisa; segundo plano para conductor disponible o en viaje.
5. Otros mensajes; fotos; archivos/documentos; actividad; fallos/diagnósticos; IDs de dispositivo.
6. Anuncios: **Sí**, administrados por Costa-Go; no personalizados.
7. ID de publicidad: **No**, salvo que el inventario automático del AAB muestre un SDK que lo use.
8. Revisar siempre la lista automática de SDK del AAB publicado.
