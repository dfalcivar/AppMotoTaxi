# Versión actual para pruebas cerradas

Actualizado el 3 de septiembre de 2026.

- Aplicación: Costa-Go
- Versión de referencia: `0.17.7 (59)`
- Canal: prueba cerrada
- Estado documental: políticas, ficha y declaraciones revisadas contra el código actual.
- Imágenes: deben regenerarse desde esta compilación final; no usar el set histórico eliminado.

## Cambios de esta versión

- Nuevo marcador oficial de mototaxi con fondo transparente y mejor lectura sobre el mapa.
- Estados visuales diferenciados para mototaxis disponibles, asignadas y con viaje activo.
- Movimiento progresivo entre posiciones GPS y orientación mediante el rumbo del vehículo.
- Ajuste visual del marcador a la ruta para reducir desplazamientos causados por imprecisión del GPS.
- Recalculo de ruta limitado a cambios de etapa o desvíos reales, evitando saltos innecesarios del mapa.
- Misma experiencia de seguimiento mejorada para pasajero y conductor.
- Proyecto, compilación local y validación continua actualizados a Flutter `3.47.2` y Dart `3.13.2`.

## Artefactos esperados

- AAB: `Costa-Go-0.17.7-build59.aab`
- APK universal: no generado en esta entrega.
- Firma: clave de publicación Costa-Go existente.
- API: `https://mototaxi-atacames-api.onrender.com`, sin proxy.
- Mapas: proveedor Google con clave Android restringida suministrada al compilar.
- Seguridad de los datos y permisos: sin nuevas categorías ni permisos respecto de la versión anterior.

Antes de cada AAB nuevo, actualizar este archivo con `versionName`, `versionCode`, notas, AAB validado, permisos y cambios que afecten Seguridad de los datos o acceso del revisor.
