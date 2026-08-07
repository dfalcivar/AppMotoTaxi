# Panel administrativo — Fase 1

## Alcance implementado

- Matriz de permisos validada en la API.
- Roles nuevos: `SUPER_ADMIN`, `ADMIN_OPERACIONES`, `SOPORTE` y
  `ANALISTA_COOPERATIVA`.
- Compatibilidad con `ADMIN` y `SUPPORT`: conservan sus permisos actuales como
  roles legados y pueden migrarse desde el panel.
- Cooperativas persistidas en PostgreSQL.
- Asociación opcional de conductores y usuarios administrativos a una
  cooperativa.
- La cooperativa se copia al viaje al momento de la asignación para conservar
  estadísticas históricas aunque el conductor cambie posteriormente.
- Permisos particulares por usuario mediante `admin_permission_overrides`.
- Menú administrativo derivado de los permisos entregados por la API.
- Resumen agregado mínimo y restringido para validar el alcance del analista.
  El dashboard estadístico completo corresponde a la Fase 5.

## Migración

`016_rbac_cooperatives.sql` agrega:

- valores nuevos a `user_role`;
- tabla `cooperatives`;
- `users.cooperative_id`;
- `trips.cooperative_id`;
- tabla `admin_permission_overrides`;
- índices por cooperativa, rol y fecha del viaje.

La API ejecuta automáticamente las migraciones antes de iniciar mediante el
comando configurado en `Dockerfile.api`.

## Endpoints de la fase

- `GET /v1/admin/access/roles`
- `GET /v1/admin/access/users`
- `POST /v1/admin/access/users`
- `PATCH /v1/admin/access/users/:id`
- `GET /v1/admin/cooperatives`
- `POST /v1/admin/cooperatives`
- `PATCH /v1/admin/cooperatives/:id`
- `GET /v1/admin/cooperative-dashboard/summary`

Los endpoints administrativos existentes también quedaron protegidos por un
permiso concreto. Una sesión móvil de pasajero o conductor no puede consultar
el panel.

## Despliegue recomendado

1. Desplegar la API. Al iniciar aplicará la migración 016.
2. Confirmar que `/health` responde correctamente.
3. Desplegar el panel administrativo.
4. Cerrar la sesión administrativa anterior e ingresar nuevamente para recibir
   la lista de permisos en la sesión.
5. Crear las cooperativas antes de crear analistas o asignar conductores.

## Pendientes de fases siguientes

- Fase 2: consultas agregadas, filtros y dashboard operacional completo.
- Fase 3: estados documentales y bandeja formal de aprobación de conductores.
- Fase 4: solicitudes de soporte, historial, adjuntos y preguntas frecuentes.
- Fase 5: dashboard completo y exportaciones agregadas por cooperativa.
- Fase 6: centro de operaciones, alertas y vencimientos.
- Fase 7: pruebas de carga, revisión de seguridad y optimización.
