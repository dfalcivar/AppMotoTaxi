# Editor de zonas de cobertura

El módulo **Zonas de cobertura** utiliza Google Maps JavaScript para dibujar y
editar el polígono, pero la geometría definitiva se valida y almacena en
PostGIS. Para Render se configuran en el servicio estático del panel:

- `VITE_GOOGLE_MAPS_WEB_API_KEY`: clave web restringida al dominio del panel y
  con Maps JavaScript API habilitada.
- `VITE_GOOGLE_MAPS_WEB_MAP_ID`: Map ID web de Costa-Go (opcional para cargar
  el mapa; recomendado para mantener el estilo).

Una zona nueva se crea inactiva. Cada edición publica una versión inmutable,
incrementa `service_area_catalog.version` y hace que la aplicación móvil
renueve su caché en la siguiente sincronización. El clic derecho elimina un
vértice; los manejadores intermedios nativos de Google Maps agregan vértices.

La importación acepta `.geojson` o `.json` de hasta 5 MB y muestra una vista
previa antes de adoptarla. El backend valida cierre, rangos, tipo, geometría
vacía, autointersecciones y posibles superposiciones. La exportación produce
WGS84/EPSG:4326 en orden `[longitud, latitud]`.

## Incorporar Muisne

1. Abrir **Zonas de cobertura** y seleccionar **Nueva zona**.
2. Escribir `MUISNE_PROD`, nombre, descripción, tipo Producción y audiencia.
3. Dibujar el límite comercial o importar el GeoJSON oficial.
4. Ajustar los vértices, validar y revisar las superposiciones.
5. Crear la zona; quedará inactiva.
6. Revisarla y activarla con un usuario que tenga `service_areas:activate`.

No se requiere modificar ni volver a compilar la aplicación móvil.
