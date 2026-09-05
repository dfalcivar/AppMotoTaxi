# Versión actual para pruebas cerradas

Actualizado el 5 de septiembre de 2026.

- Aplicación: Costa-Go
- Versión de referencia: `0.18.0 (60)`
- Canal: prueba cerrada
- Estado documental: políticas, ficha y declaraciones revisadas contra el código actual.
- Imágenes: deben regenerarse desde esta compilación final; no usar el set histórico eliminado.

## Cambios de esta versión

- Nueva modalidad de membresías por paquetes de viajes, configurable y separada de los planes por período.
- Consulta clara del tipo de membresía activa, viajes utilizados y saldo de viajes disponible.
- Planes por viajes ordenados por cantidad y vigencias flexibles definidas por el negocio.
- Flujos de pago, QR y transferencia adaptados a la modalidad contratada, con protección contra reenvíos duplicados.
- Confirmación de activación de membresía mediante notificación y correo transaccional Costa-Go.
- Renovación visual integral con una paleta azul grisácea más suave, mejor jerarquía y soporte claro/oscuro.
- Conteo de mototaxis disponibles limitado al radio de búsqueda actual para evitar expectativas incorrectas.
- Mejoras en la presentación y reintegración de solicitudes de viaje para conductores disponibles.
- Nuevo ícono oficial de Costa-Go compatible con adaptive icons, máscaras del launcher e íconos temáticos de Android 13 o superior.
- Ajustes visuales del botón de ubicación y de la tarjeta de disponibilidad del conductor.
- Compilación y validación con Flutter `3.47.2` y Dart `3.13.2`.

## Artefactos esperados

- AAB: `Costa-Go-0.18.0-build60.aab`
- APK universal: no generado en esta entrega.
- Firma: clave de publicación Costa-Go existente.
- API: `https://mototaxi-atacames-api.onrender.com`, sin proxy.
- Mapas: proveedor Google con clave Android restringida suministrada al compilar.
- Seguridad de los datos y permisos: sin nuevas categorías ni permisos respecto de la versión anterior.

Antes de cada AAB nuevo, actualizar este archivo con `versionName`, `versionCode`, notas, AAB validado, permisos y cambios que afecten Seguridad de los datos o acceso del revisor.
