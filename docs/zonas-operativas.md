# Zonas operativas de AtacamesGo

Las zonas operativas definen dónde puede comenzar y terminar un viaje. No son
las zonas tarifarias (`service_zones`) ni el radio de búsqueda de conductores.

## Versión inicial

- `ATACAMES_PROD`: público general. Parte de los límites parroquiales publicados
  por OpenStreetMap para Atacames, Súa, Tonchigüe y Tonsupa. La unión se recorta
  en el límite comercial Piedra Fina A: `0.8521276246290309,
  -79.76629351845928`. Same queda incluido en el corredor de Tonchigüe.
- `CUENCA_TEST`: área urbana publicada por ETAPA EP. Solo pueden utilizarla las
  cuentas autorizadas explícitamente desde **Zonas > Cuentas autorizadas**.

Fuentes:

- OSM: https://www.openstreetmap.org/copyright
- ETAPA EP: https://geo.etapa.net.ec/arcgis/rest/services/Publico/SRV_SGA_RefrenciasRadar/MapServer/6
- INEC, usado para contraste cartográfico: https://idgn.ecuadorencifras.gob.ec/server/rest/services/Hosted/Marco_Geoestadistico_2022/FeatureServer

## Reglas

1. Origen y todas las paradas deben pertenecer a una zona habilitada.
2. Las cuentas deben estar autorizadas para zonas con audiencia `TESTERS`.
3. Por defecto no se permiten viajes entre zonas.
4. La app valida para mejorar la experiencia; la API es la autoridad final.
5. Cada viaje guarda `service_area_id` y `service_area_version_id`.

## Modificar un límite

En el panel, abrir **Zonas**, elegir una zona y pulsar **Publicar modificación**.
Se importa un `Polygon` o `MultiPolygon` GeoJSON, se registra la fuente y el
motivo y se publica. Esto crea una versión nueva y no altera viajes históricos.

## Agregar Muisne

1. Obtener o dibujar el polígono con una fuente cartográfica verificable.
2. Exportarlo como GeoJSON WGS84 (`EPSG:4326`).
3. En **Zonas**, importar el archivo con código `MUISNE_PROD`.
4. Elegir `PRODUCTION`, audiencia `ALL`, prioridad y reglas interzona.
5. Publicar inicialmente deshabilitada, comprobar la vista previa y casos de
   borde, y luego activarla.

No requiere modificar el código móvil ni la lógica principal.
