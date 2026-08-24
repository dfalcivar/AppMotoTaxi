# Tarifario territorial de Atacames

## Modelo aplicado

`ATACAMES_PROD` continúa siendo una sola zona de operación. Las localidades del
tarifario se representan como polígonos internos en `fare_sectors`; las tarifas
entre ellos se almacenan en `fare_route_rules`.

La coordenada exacta elegida por el pasajero se evalúa con `ST_Covers`. Si hay
superposición, gana primero el sector con mayor prioridad y después el polígono
más pequeño. Club del Pacífico y Cabaplan prevalecen sobre el polígono general
de Tonsupa únicamente cuando la coordenada pertenece realmente a su geometría
específica.

## Matriz cargada

Los valores siguientes corresponden al tarifario entregado al proyecto. Son el
valor del trayecto antes de la comisión operativa configurable de Costa-Go.

| Origen / destino | Pasajeros | Día (06:00–21:59) | Noche (22:00–05:59) |
| --- | ---: | ---: | ---: |
| Dentro de Atacames | 1 | $0,50 | $1,00 |
| Dentro de Atacames | 2–3 | $1,00 | $2,00 |
| Dentro de Tonsupa | 1 | $0,50 | $1,00 |
| Dentro de Tonsupa | 2–3 | $1,00 | $2,00 |
| Dentro de Súa | 1 | $0,50 | $1,00 |
| Dentro de Súa | 2–3 | $1,00 | $2,00 |
| Atacames ↔ Tonsupa Cabaplan | 1 | $1,00 | $2,50 |
| Atacames ↔ Tonsupa Cabaplan | 2–3 | $2,00 | $2,50 |
| Atacames ↔ Club del Pacífico | 1–3 | $2,00 | $3,00 |
| Atacames ↔ Súa | 1 | $1,00 | $2,50 |
| Atacames ↔ Súa | 2–3 | $2,00 | $2,60 |
| Atacames ↔ La Unión | 1–3 | $2,00 | $2,50 |
| Atacames ↔ Las Vegas | 1–3 | $5,00 | $6,00 |
| Atacames ↔ La Lucha | 1–3 | $3,00 | $4,00 |
| Atacames ↔ Cumba | 1–3 | $4,00 | $6,00 |
| Atacames ↔ Las Brisas | 1–3 | $1,50 | $2,00 |
| Tonsupa ↔ Salima/Taseche/Estero del Medio | 1–3 | $3,00 | $4,00 |
| Súa ↔ Guachal/Muchín | 1–3 | $3,00 | $4,50 |

Ejemplo con una comisión vigente de $0,10 por tramo:

- Club del Pacífico → Atacames, horario diurno: $2,00 + $0,10 = **$2,10**.

## Fuentes geográficas iniciales

- GADM Atacames, tabla de atractivos georreferenciados y cartografía cantonal.
- GAD Tonsupa, PDOT 2023–2027 con cartografía base IGM 2020.
- OpenStreetMap/GeoNames para Cabaplan, Club del Pacífico y recintos rurales.
- Estudio PUCE de las cuencas de los ríos Atacames y Súa.

Los buffers generales cargados por la migración 050 son límites operativos
iniciales, no límites político-administrativos. La migración 054 reemplaza los
buffers circulares superpuestos de Cabaplan y Club del Pacífico por geometrías
específicas:

- Cabaplan usa el polígono residencial de OpenStreetMap `way/646844238`.
- Club del Pacífico usa una envolvente de referencias cartográficas públicas
  de la avenida y un margen operativo de 150 m para sus predios colindantes.
- El punto de control genérico de Tonsupa `0.89018, -79.81023` queda únicamente
  en `TONSUPA_CABECERA`; no puede ser absorbido por los sectores específicos.

Las tres geometrías se pueden ajustar visualmente desde
**Tarifas → Tarifa territorial → Sectores y trayectos** sin publicar otra APK.
Después de ajustar un polígono, las nuevas cotizaciones usan inmediatamente la
nueva geometría.

## Respaldo

Una regla oficial activa tiene prioridad 100. Si una coordenada no cae en un
sector o aún no existe una regla exacta, el motor no inventa que pertenece a
Atacames/Tonsupa/Súa: entrega un valor sugerido y lo marca como tal. El backend
sigue siendo la fuente definitiva del cálculo.
