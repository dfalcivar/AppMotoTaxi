# Versión candidata a producción

Actualizado el 10 de septiembre de 2026.

- Aplicación: Costa-Go
- Versión de referencia: `0.18.3 (64)`
- Canal: prueba abierta
- Estado documental: políticas, ficha y declaraciones revisadas contra el código actual.
- Imágenes: set actualizado disponible en `docs/google-play/screenshots-0.18.1`.

## Cambios de esta versión

- Administración móvil integrada con los mismos parámetros y reglas del panel web.
- Configuración y simulación del modelo económico por rondas, tarifa de llegada y participación Costa-Go.
- Corrección de la continuidad de búsqueda y reinicio de rondas según la política de cancelación configurada.
- Activación automática de disponibilidad al seleccionar una mototaxi.
- Rediseño del historial y detalle de viajes para pasajero y conductor, con desglose económico más claro.
- Nueva experiencia de saldo Costa-Go con recargas, últimos movimientos e historial filtrable.
- Perfiles con resumen de calificaciones, tres comentarios recientes e historial completo.
- Distintivos diferenciados para membresía por período, paquetes por viajes y Pago por uso.
- Advertencia visible cuando el saldo prepago alcanza el umbral bajo configurado.
- Actualización inmediata de formularios administrativos al cambiar la tarifa de llegada.
- Mejoras generales de contraste, jerarquía visual y compatibilidad con temas claro y oscuro.
- Compilación y validación con Flutter `3.47.2` y Dart `3.13.2`.

## Artefactos esperados

- AAB: `Costa-Go-0.18.3-build64.aab`
- APK universal: no generado en esta entrega.
- Firma: clave de publicación Costa-Go existente.
- API: `https://mototaxi-atacames-api.onrender.com`, sin proxy.
- Mapas: proveedor Google con clave Android restringida suministrada al compilar.
- Seguridad de los datos y permisos: sin nuevas categorías ni permisos respecto de la versión anterior.

## Verificación final del AAB

- Estado: compilado y verificado localmente; pendiente de carga a Play Console.
- Tamaño: `113221542` bytes.
- SHA-256: `4E7BE88037B3CA75738824A7A7C40AB9487A735A5F48E5C20E634BB339773619`.
- Firma JAR: verificada. El verificador muestra advertencias de certificado autofirmado y orden del manifiesto ZIP/JAR.
- Certificado de firma: coincide con el utilizado en el build 63.
- Version name: `0.18.3`.
- Version code: `64`.
- Arquitecturas incluidas: `arm64-v8a`, `armeabi-v7a` y `x86_64`.
- API de producción: incluida.
- Proxy de laboratorio: no incluido.
- Clave de Google Maps: incluida y coincide con la configuración existente de Gradle.

## Nombre y notas para Play Console

Nombre: `Costa-Go 0.18.3 (64)`

```text
<es-419>
Mejoramos el historial de viajes, calificaciones y saldo Costa-Go.
Ahora las membresías y el Pago por uso muestran estados y avisos más claros.
También optimizamos la búsqueda de mototaxis y la disponibilidad del conductor.
</es-419>
```

Antes de cada AAB nuevo, actualizar este archivo con `versionName`, `versionCode`, notas, AAB validado, permisos y cambios que afecten Seguridad de los datos o acceso del revisor.
