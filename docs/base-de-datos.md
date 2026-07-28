# Base de datos

La primera migración se encuentra en `apps/api/migrations/001_initial.sql`.

## Requisitos

- PostgreSQL 16 o superior.
- Extensión PostGIS.
- Extensión `pgcrypto`.

## Aplicación manual de la migración

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/migrations/001_initial.sql
```

## Decisiones incorporadas

- Los teléfonos se almacenan normalizados en formato E.164.
- Los importes se guardan como centavos enteros para evitar errores decimales.
- Zonas y ubicaciones usan geometrías geográficas con SRID 4326.
- Cada viaje conserva un `pricing_snapshot` inmutable.
- Los estados del viaje se registran además en `trip_events`.
- Toda modificación sensible del panel se registra en `audit_log`.
- El método de pago inicial solo permite `CASH`.

## Siguiente migración

La segunda migración añadirá documentos de conductores, calificaciones,
incidentes y códigos de verificación telefónica.
