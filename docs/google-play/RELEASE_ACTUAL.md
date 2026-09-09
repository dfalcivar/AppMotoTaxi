# Versión candidata a producción

Actualizado el 9 de septiembre de 2026.

- Aplicación: Costa-Go
- Versión de referencia: `0.18.2 (63)`
- Canal: producción
- Estado documental: políticas, ficha y declaraciones revisadas contra el código actual.
- Imágenes: set actualizado disponible en `docs/google-play/screenshots-0.18.1`.

## Cambios de esta versión

- Corrección del flujo de comprobantes de transferencia para evitar una pantalla negra después del envío.
- Cierre ordenado de las pantallas de pago y regreso seguro a la pantalla principal del conductor.
- Actualización inmediata del estado del comprobante para impedir acciones o envíos duplicados.
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
- Nuevo diseño institucional de Acerca de Costa-Go, adaptable y sin exponer datos personales.
- Mejoras visuales en la jornada del conductor y eliminación del selector duplicado de mototaxi.
- Sistema de notificaciones inteligentes más robusto, con campañas, enlaces y confirmaciones mejoradas.
- Compilación y validación con Flutter `3.47.2` y Dart `3.13.2`.

## Artefactos esperados

- AAB: `Costa-Go-0.18.2-build63.aab`
- APK universal: no generado en esta entrega.
- Firma: clave de publicación Costa-Go existente.
- API: `https://mototaxi-atacames-api.onrender.com`, sin proxy.
- Mapas: proveedor Google con clave Android restringida suministrada al compilar.
- Seguridad de los datos y permisos: sin nuevas categorías ni permisos respecto de la versión anterior.

## Verificación final del AAB

- Estado: compilado y verificado localmente; pendiente de carga a Play Console.
- Tamaño: `111084290` bytes.
- SHA-256: `F4FDDB9A2A97E9E15093D20E330AB78A9124F5E042659DF9E60F0555E097CD89`.
- Firma JAR: verificada. El verificador muestra advertencias de certificado autofirmado y orden del manifiesto ZIP/JAR.
- Certificado de firma: coincide con el utilizado en el build 62.
- Version name: `0.18.2`.
- Version code: `63`.
- Arquitecturas incluidas: `arm64-v8a`, `armeabi-v7a` y `x86_64`.
- API de producción: incluida.
- Proxy de laboratorio: no incluido.
- Clave de Google Maps: incluida y coincide con la configuración existente de Gradle.

## Nombre y notas para Play Console

Nombre: `Costa-Go 0.18.2 (63)`

```text
<es-419>
Corregimos un problema que podía dejar la pantalla negra al enviar un comprobante de transferencia.
Mejoramos el regreso al inicio después del envío y la actualización del estado del pago.
</es-419>
```

Antes de cada AAB nuevo, actualizar este archivo con `versionName`, `versionCode`, notas, AAB validado, permisos y cambios que afecten Seguridad de los datos o acceso del revisor.
