# Limpieza inicial de producción de Costa-Go

## Alcance acordado

Conservar todas las cuentas que continúan registradas, tanto pasajeros como conductores,
incluidas las cuentas administrativas y las dos cuentas de revisión de Google Play. No se
conservan las cuatro identidades que ya están anonimizadas y tienen `deleted_at`.

Se preserva la identidad y el estado actual necesario para operar:

- usuario, credenciales, rol y perfil vigente;
- perfil de conductor y documentos activos;
- mototaxis con una relación actual `APPROVED` o `PENDING` con una cuenta registrada;
- relación actual usuario–mototaxi y el archivo vigente más reciente por tipo;
- permisos, acceso territorial y configuración administrativa vigente.

Se elimina todo historial y toda métrica de prueba: viajes, ubicaciones, mensajes,
calificaciones, cancelaciones, sesiones, auditorías anteriores, notificaciones, campañas,
publicidad, pagos, facturas de prueba, membresías, paquetes, saldos, movimientos de billetera,
recargas, órdenes, comprobantes, incidencias y eventos de analítica.

La cooperativa de prueba también se elimina. Los usuarios conservados quedan sin
`cooperative_id`; las mototaxis restauradas quedan igualmente desvinculadas. Se eliminan las
políticas específicas de cooperativa, preservando las políticas globales y por conductor.

También se depuran las versiones históricas de configuración: precios y zonas cuya vigencia
ya terminó, y geometrías de áreas que ya fueron reemplazadas. Se conserva la versión activa
de cada área y cualquier precio o zona futura que ya esté programada. Los sectores, reglas de
trayecto, tarifas vigentes, áreas habilitadas y configuración de actualización de la app no se
eliminan.

## Cuentas y perfiles conservados

El inventario de solo lectura encontró 36 filas en `users`:

- 32 cuentas registradas sin `deleted_at`, que se conservan;
- 4 cuentas ya anonimizadas/eliminadas, que se retiran definitivamente;
- 8 perfiles vigentes en `drivers`, que se conservan;
- 3 perfiles de conductor ligados a cuentas ya eliminadas, que se retiran.

Las cuentas `play.driver@costa-go.com` y `play.passenger@costa-go.com` permanecen incluidas.
El ejecutor aborta si estos conteos cambian antes de la limpieza.

## Preview actualizado

| Entidad | Actual | Eliminar | Conservar/crear |
|---|---:|---:|---:|
| Usuarios | 36 | 4 anonimizados | 32 registrados |
| Conductores | 11 | 3 eliminados | 8 registrados |
| Documentos de conductor | 41 | 1 de cuenta eliminada | 40 activos |
| Mototaxis | 12 | 5 sin relación actual | 7 actuales |
| Archivos de mototaxi | 10 | 4 históricos/no vigentes | 6 vigentes |
| Relaciones usuario–vehículo | 15 | 5 revocadas o eliminadas | 10 actuales |
| Cooperativas | 1 | 1 | 0 |
| Membresías históricas | 25 | 25 | 1 habilitación estructural Play |
| Órdenes de membresía | 44 | 44 | 0 |
| Pagos de membresía | 17 | 17 | 0 |
| Viajes | 348 | 348 | 0 |
| Facturas fiscales de prueba | 16 | 16 | 0 |
| Comercios/anunciantes | 7 | 7 | 0 |
| Campañas publicitarias | 13 | 13 | 0 |
| Eventos publicitarios | 6176 | 6176 | 0 |
| Notificaciones de usuario | 1291 | 1291 | 0 |
| Eventos de entrega push | 1509 | 1509 | 0 |
| Auditoría de vehículos | 219 | 219 | 0 |
| Auditoría general previa | 675 | 675 | 1 registro nuevo de la limpieza |

Los conteos de flota se calculan nuevamente en cada preview. Solo se conserva una mototaxi
si tiene una relación actual con un usuario registrado. Las relaciones `REVOKED` o
`REJECTED`, sesiones, asignaciones y auditorías se consideran historia y se eliminan. Para
cada mototaxi se mantiene la fotografía actualmente referenciada y el archivo no fotográfico
más reciente de cada tipo.

Las 16 facturas detectadas son `TEST/PENDIENTE_INTEGRACION`; no existen facturas autorizadas
ni notas de crédito. El ejecutor vuelve a comprobarlo y aborta si aparece un documento
autorizado o ajeno al entorno de prueba.

## Excepción mínima para Google Play

La aplicación exige membresía cuando `membership_enforcement_enabled=true`. Se eliminan todos
los ciclos, órdenes y pagos de prueba. Después se crea únicamente para
`play.driver@costa-go.com` una habilitación `COURTESY` de valor cero basada en `PLAN_PILOTO`,
sin orden, pago, comprobante, ingreso ni documento fiscal. Es estado operativo nuevo, no
historial de pruebas.

## Seguridad del procedimiento

`production-cleanup-inventory.mjs` es exclusivamente de lectura. El ejecutor permanece en
preview salvo que reciba `--execute`, el token exacto del preview vigente, la confirmación de
un respaldo restaurado y las variables técnicas de autorización. Un cambio de conteos,
migraciones, configuración, cooperativas, documentos fiscales, referencias o esquema bloquea
la ejecución.

`vehicle_files`, `vehicle_audit`, `driver_vehicle_sessions` y
`vehicle_session_assignments` tienen reglas de inmutabilidad. El procedimiento no desactiva
triggers ni claves foráneas: usa un `TRUNCATE ... RESTRICT` transaccional sobre el conjunto
cerrado, restaura solamente el estado actual de flota con los mismos identificadores y deja
que PostgreSQL rechace cualquier dependencia desconocida.

El archivo `apps/api/.env` apunta a localhost y no debe usarse como destino de producción.
La base de Render se consultó únicamente mediante transacciones `READ ONLY`. Ninguna limpieza
ha sido ejecutada.

Desde `apps/api`, con `DATABASE_URL` de producción suministrada localmente y
`CLEANUP_EXPECTED_HOST` igual al host verificado:

```powershell
node scripts/production-cleanup-inventory.mjs
node scripts/production-cleanup.mjs
```

El primer comando genera el inventario extendido; el segundo imprime el preview ejecutable y
su `planToken`. No se deben copiar credenciales en documentación o mensajes.

## Ejecución pendiente

1. Esperar a que finalice el export lógico de Render y verificar que pueda restaurarse.
2. Ejecutar ambos inventarios de solo lectura y confirmar que siguen existiendo exactamente
   32 cuentas registradas, 8 perfiles de conductor y una sola cooperativa de prueba.
3. Probar el ejecutor sobre la copia restaurada y verificar acceso, documentos y flota de los
   usuarios conservados.
4. Confirmar que viajes, ingresos, pagos, saldos, membresías, facturación de prueba,
   notificaciones, publicidad, sesiones y métricas queden en cero.
5. Confirmar que las versiones vencidas de precios y zonas, y las geometrías reemplazadas,
   queden en cero sin alterar la configuración activa o programada.
6. Ejecutar en una ventana sin escrituras y validar nuevamente el estado final antes de abrir
   producción.

La limpieza de PostgreSQL no elimina métricas históricas del proveedor Google. Claves,
Firebase y configuración de Google Maps se conservan.
