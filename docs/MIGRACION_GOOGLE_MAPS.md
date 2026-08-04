# Evaluación de migración a Google Maps Platform

Fecha de evaluación: 4 de agosto de 2026.

## Decisión recomendada

La migración es viable y conviene hacerla por etapas, conservando los contratos
actuales de la API para no modificar simultáneamente todo el flujo del viaje.

1. Sustituir `flutter_map` y las teselas de OpenStreetMap por
   `google_maps_flutter`.
2. Sustituir Nominatim por Places API (New): Autocomplete con token de sesión y
   Place Details Essentials limitado a dirección y coordenadas.
3. Sustituir OpenRouteService por Routes API `Compute Routes Essentials` desde
   el backend.
4. Mantener el GPS, WebSocket, marcadores de mototaxis, chat y estados actuales.

## Estado de implementación

La aplicación ya incluye los dos proveedores de mapa:

- `MAP_PROVIDER=osm`: respaldo actual, no necesita clave de Google.
- `MAP_PROVIDER=google`: usa el complemento oficial `google_maps_flutter`.

La API también está preparada para utilizar Google automáticamente cuando
exista `GOOGLE_MAPS_SERVER_API_KEY`. Si Google no está configurado o falla,
mantiene Nominatim y OpenRouteService como respaldo.

## Activación en Google Cloud

En un proyecto con facturación habilitada, activar:

1. Maps SDK for Android.
2. Places API (New).
3. Geocoding API.
4. Routes API.

Crear dos claves distintas:

- **Clave Android:** restringida a Maps SDK for Android, al paquete
  `ec.atacames.mototaxi.mototaxi_atacames` y a la huella SHA-1 de firma.
- **Clave servidor:** restringida a Places API (New), Geocoding API y Routes
  API. Guardarla en Render como `GOOGLE_MAPS_SERVER_API_KEY`.

Para compilar una APK con Google Maps en PowerShell:

```powershell
$env:GOOGLE_MAPS_ANDROID_API_KEY='CLAVE_ANDROID_RESTRINGIDA'
C:\Proyectos\flutter\bin\flutter.bat build apk --release `
  --dart-define=MAP_PROVIDER=google
```

La clave del servidor nunca debe incluirse en la APK. La versión actual aún usa
la firma de desarrollo para la compilación release; antes de publicar en Play
Store se debe crear la firma definitiva y agregar su SHA-1 a la clave Android.

## Cuotas y costos vigentes

No existe un cupo general gratuito de 50.000 solicitudes. Cada SKU tiene su
propio cupo mensual:

| Servicio | Cupo sin costo mensual | Precio después del cupo, por 1.000 eventos |
|---|---:|---:|
| Maps SDK móvil | Ilimitado | Sin cargo según la tabla vigente |
| Autocomplete Requests | 10.000 | USD 2,83 |
| Geocoding | 10.000 | USD 5,00 |
| Place Details Essentials | 10.000 | USD 5,00 |
| Compute Routes Essentials | 10.000 | USD 5,00 |

Google exige habilitar facturación aunque el consumo permanezca dentro de los
cupos gratuitos. El plan de suscripción Starter incluye 50.000 llamadas
combinadas, pero cuesta USD 100 mensuales; no es un cupo gratuito.

Fuente: [lista oficial de precios](https://developers.google.com/maps/billing-and-pricing/pricing).

## Controles necesarios

- Clave Android restringida por nombre de paquete y huella SHA-1.
- Clave de servicios web separada y almacenada únicamente en Render.
- Restricción de cada clave a las APIs estrictamente necesarias.
- Presupuesto, alertas y cuotas diarias en Google Cloud.
- Esperar al menos tres caracteres y aplicar `debounce` al autocompletado.
- Token UUID nuevo por cada sesión de búsqueda de dirección.
- Solicitar solo dirección, ubicación y viewport mediante field masks.
- Cachear rutas y recalcularlas por tiempo, cambio de estado o desplazamiento
  significativo, no en cada actualización de pantalla.

## Estimación para el piloto

El mapa no sería el factor de costo. Places consumiría normalmente dos sesiones
por solicitud (origen y destino). Routes será el consumo principal porque una
carrera puede recalcular la ruta varias veces mientras el conductor avanza.
Con un intervalo de 45 a 60 segundos, una carrera de 15 minutos puede consumir
aproximadamente entre 20 y 40 cálculos entre ambas aplicaciones. Por ello, el
cupo de 10.000 rutas podría representar aproximadamente 250 a 500 carreras al
mes. Esta es una estimación y debe confirmarse con métricas reales.
