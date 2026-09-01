# Versión actual para pruebas cerradas

Actualizado el 1 de septiembre de 2026.

- Aplicación: Costa-Go
- Versión de referencia: `0.17.5 (57)`
- Canal: prueba cerrada
- Estado documental: políticas, ficha y declaraciones revisadas contra el código actual.
- Imágenes: deben regenerarse desde esta compilación final; no usar el set histórico eliminado.

## Cambios de esta versión

- Flujo de solicitud del pasajero reorganizado y adaptable a distintos anchos y escalas de texto.
- Selector manual reutilizable para origen y destino, con confirmación clara de cada punto.
- Favoritos mejorados para elegir rápidamente un lugar como origen o destino.
- Resumen de confirmación con referencia, pasajeros, pago, distancia, tiempo y total del viaje.
- Tarifa y forma de pago visibles para pasajero y conductor durante las etapas activas del viaje.
- Referencia para encontrar al pasajero presentada de forma legible en solicitudes y viajes aceptados.
- Estado de confirmación unificado, sin mensajes duplicados.
- Limpieza completa del borrador y reposición del panel al cancelar o finalizar un viaje.
- Ajustes de estabilidad visual para evitar desplazamientos inesperados de las tarjetas durante el flujo.

## Artefactos esperados

- AAB: `Costa-Go-0.17.5-build57.aab`
- APK universal: no generado en esta entrega.
- Firma: clave de publicación Costa-Go existente.
- API: `https://mototaxi-atacames-api.onrender.com`, sin proxy.
- Mapas: proveedor Google con clave Android restringida suministrada al compilar.

Antes de cada AAB nuevo, actualizar este archivo con `versionName`, `versionCode`, notas, AAB validado, permisos y cambios que afecten Seguridad de los datos o acceso del revisor.
