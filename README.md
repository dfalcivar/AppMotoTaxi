# Mototaxi Atacames

Base técnica del MVP para solicitar mototaxis en Atacames, Ecuador.

## Componentes

- `packages/domain`: reglas de tarifas y estados de viaje, independientes de la interfaz.
- `apps/api`: API inicial para cotizar viajes y consultar la configuración.
- `apps/admin`: panel administrativo web.
- `apps/mobile`: base Flutter prevista para pasajero y conductor.
- `docs`: decisiones técnicas y guía de puesta en marcha.

## Inicio rápido

Requiere Node.js 22 o superior y pnpm.

```bash
pnpm install
pnpm test
pnpm dev:api
```

La API se inicia en `http://localhost:3001`.

## Configuración tarifaria inicial

- Día: 06:00–19:59.
- Noche: 20:00–05:59.
- Casco urbano de día: $0,50 por persona.
- Promoción urbana diurna: exactamente 3 pasajeros por $1 total.
- Noche: $1 por persona, sin promociones.
- Zona extendida: $1 por persona.
- Pago: efectivo.

Todos estos valores se representan como parámetros versionables.
