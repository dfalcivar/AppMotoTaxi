# Fase 2 — Dashboard administrativo

## Alcance implementado

El dashboard dejó de utilizar cifras de demostración. Todos los indicadores se calculan mediante consultas agregadas en PostgreSQL, respetando los filtros de período, cooperativa, conductor, sector, estado y tipo de viaje.

La pantalla se organiza en:

1. Resumen ejecutivo.
2. Demanda y zonas.
3. Rendimiento de conductores.
4. Señales operativas.
5. Incidentes y alertas.

## Endpoints

- `GET /v1/admin/dashboard`: resumen, series, distribución, concentración por coordenadas, rendimiento y señales operativas.
- `GET /v1/admin/dashboard/drivers/:id`: perfil estadístico filtrado de un conductor, incluyendo actividad, zonas, horarios, incidentes y documentos.

Ambos endpoints requieren el permiso `dashboard:view`. El intervalo máximo permitido es de 366 días.

## Filtros

- `from` y `to`: fechas ISO; `to` es exclusivo.
- `cooperativeId`: UUID de la cooperativa.
- `driverId`: UUID del conductor.
- `sector`: `URBAN` o `EXTENDED`.
- `status`: estado del viaje.
- `tripType`: `ALL`, `IMMEDIATE` o `SCHEDULED`.

## Definiciones principales

- Conductor conectado: activo, disponible y con una ubicación actualizada en los últimos cinco minutos.
- Solicitud sin conductor: viaje `SEARCHING` o `NO_DRIVER` sin conductor asignado.
- Asignación demorada: más de dos minutos entre solicitud y asignación.
- Baja cobertura: al menos dos solicitudes en una franja horaria y menos del 50 % asignadas.
- Alta cancelación: mínimo tres viajes y 30 % o más cancelados. Se muestra como señal, no como juicio único del conductor.

Los kilómetros se mantienen como `null` porque el sistema todavía no persiste una distancia recorrida confiable. No se inventa ese dato.

## Migración

`017_dashboard_analytics.sql` agrega `trips.scheduled_for` e índices específicos para las consultas del tablero. Los viajes existentes quedan clasificados como inmediatos porque su valor es nulo.

Orden de despliegue recomendado:

1. API con ejecución de migraciones.
2. Verificar `GET /v1/admin/dashboard` con credenciales administrativas.
3. Desplegar el panel administrativo.

## Validación manual

1. Comparar el total del tablero con el listado de viajes para el mismo período.
2. Aplicar cada filtro por separado y luego combinarlos.
3. Abrir el perfil de un conductor y confirmar que viajes, incidentes y documentos pertenecen a ese conductor.
4. Verificar estados vacíos con un período sin actividad.
5. Probar el diseño en escritorio, tableta y una ventana menor a 720 px.

## Pendientes de fases posteriores

- La programación completa de viajes pertenece a una fase funcional posterior; esta fase únicamente prepara su clasificación estadística.
- El dashboard exclusivo y exportaciones de cooperativa se implementan en la Fase 5.
- El mapa operacional en tiempo real, alertas configurables y vencimientos pertenecen a la Fase 6.
