# Versión actual para pruebas cerradas

Actualizado el 30 de agosto de 2026.

- Aplicación: Costa-Go
- Versión de referencia: `0.17.3 (55)`
- Canal: prueba cerrada
- Estado documental: políticas, ficha y declaraciones revisadas contra el código actual.
- Imágenes: deben regenerarse desde esta compilación final; no usar el set histórico eliminado.

## Cambios de esta versión

- Centro de Notificaciones con lectura contextual para eventos del viaje.
- `Viaje confirmado`, `Conductor llegó` y `Viaje iniciado` abren un detalle informativo sin abandonar el listado.
- Acción `Ver viaje en curso` disponible únicamente cuando el viaje relacionado continúa activo.
- `Viaje finalizado` conserva el acceso directo al detalle para revisión y calificación.
- Estados leído/no leído, acción `Leer todas` y flechas de navegación corregidos.
- Navegación desde notificaciones push alineada con el mismo comportamiento del centro.

## Artefactos esperados

- AAB: `Costa-Go-0.17.3-build55.aab`
- APK universal: `Costa-Go-0.17.3-build55-universal.apk`
- Firma: clave de publicación Costa-Go existente.
- API: `https://mototaxi-atacames-api.onrender.com`, sin proxy.
- Mapas: proveedor Google con clave Android restringida suministrada al compilar.

Antes de cada AAB nuevo, actualizar este archivo con `versionName`, `versionCode`, notas, AAB validado, permisos y cambios que afecten Seguridad de los datos o acceso del revisor.
