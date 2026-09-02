# Versión actual para pruebas cerradas

Actualizado el 1 de septiembre de 2026.

- Aplicación: Costa-Go
- Versión de referencia: `0.17.6 (58)`
- Canal: prueba cerrada
- Estado documental: políticas, ficha y declaraciones revisadas contra el código actual.
- Imágenes: deben regenerarse desde esta compilación final; no usar el set histórico eliminado.

## Cambios de esta versión

- Centro de notificaciones inteligente integrado con la bandeja y los avisos existentes.
- Preferencias para recomendaciones, promociones y recordatorios, manteniendo siempre activos los avisos de viajes y seguridad.
- Registro de versión instalada preparado para campañas de actualización recomendada desde Play Store.
- Reincorporación segura de solicitudes pendientes cuando el conductor finaliza otro viaje, sin duplicar ofertas.
- Presentación automática de la tarjeta cuando una solicitud vuelve a estar disponible.
- Viajes programados actualizados inmediatamente al cancelar, incluso ante eventos de red perdidos.
- Fechas y calendarios visibles en español para pasajero y conductor.
- El panel del pasajero vuelve al inicio después de confirmar un viaje programado, sin conservar el desplazamiento anterior.
- Correcciones generales de estabilidad y sincronización del flujo de viajes.

## Artefactos esperados

- AAB: `Costa-Go-0.17.6-build58.aab`
- APK universal: no generado en esta entrega.
- Firma: clave de publicación Costa-Go existente.
- API: `https://mototaxi-atacames-api.onrender.com`, sin proxy.
- Mapas: proveedor Google con clave Android restringida suministrada al compilar.
- Seguridad de los datos y permisos: sin nuevas categorías ni permisos respecto de la versión anterior.

Antes de cada AAB nuevo, actualizar este archivo con `versionName`, `versionCode`, notas, AAB validado, permisos y cambios que afecten Seguridad de los datos o acceso del revisor.
