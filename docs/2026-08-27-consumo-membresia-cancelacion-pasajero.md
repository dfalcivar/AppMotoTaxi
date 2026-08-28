# Consumo del ciclo y cancelación del pasajero

## Regla implementada

- Aceptación real inmediata o programada: una unidad por viaje y conductor.
- Cancelación del pasajero antes de iniciar: revierte únicamente la unidad registrada para el conductor asignado en ese momento.
- Cancelación del conductor o liberación de reserva: conserva su consumo.
- Si luego acepta otro conductor, tiene su propio registro; la cancelación posterior del pasajero no revierte al conductor anterior.
- Sin aceptación/consumo registrado no se descuenta nada. Iniciar/finalizar un viaje no agrega una segunda unidad.
- Se conserva `membershipUsageBillingEnabled`: desactivarlo impide nuevos consumos, pero no impide revertir uno previamente registrado.

## Cambio respecto del código anterior

En `e741a8b` el consumo se registraba al completar, no al aceptar. Ahora se registra dentro de la misma transacción que acepta la solicitud/reserva, siguiendo el nuevo requisito. `completed_trips`/`completedTrips` se conservan por compatibilidad y representan el consumo neto del ciclo.

No hay backfill ni cobros retroactivos: los consumos históricos se preservan; las aceptaciones anteriores al despliegue que nunca generaron un registro de consumo no se reconstruyen ni se descuentan. Al completar se actualiza únicamente la fecha del registro existente.

## Persistencia y concurrencia

Migración `070_membership_usage_passenger_reversal.sql`, sobre `membership_cycle_trip_usages` existente:

- Unicidad `(trip_id, driver_id)` para soportar reasignaciones sin duplicados.
- `accepted_at`, `reversed_by`; se reutilizan `reversed_at` y `reversal_reason`.
- `completed_at` admite nulo hasta que el viaje termine realmente.
- Registro conservado tras reversión; nunca se elimina.

La cancelación, sanción del pasajero, reversión, recálculo y auditoría forman una sola transacción. Bloqueos de filas y bloqueo de facturación compartido con generación/confirmación de órdenes serializan los cambios del conductor. Una reversión requiere prueba persistida de cancelación por el pasajero y un consumo no revertido. WebSocket/FCM y la app no pueden descontar unidades.

## Cálculos

Se recalculan viajes utilizados, restantes (`remainingTrips`), excedentes, importe bruto, importe facturable con tope y renovación estimada desde los snapshots del ciclo original. La comisión y el porcentaje de excedente permanecen en los snapshots; no se fija ningún precio nuevo.

Las órdenes pendientes vinculadas al ciclo actualizan su desglose/importe. Si hay comprobante, se conserva y permanece pendiente de verificación: Finanzas debe comparar el importe declarado/transferido con el importe esperado actualizado. No se aprueba ningún pago automáticamente.

Una reserva que se cancela después de renovar corrige el contador de su ciclo original, nunca el del nuevo ciclo. Si el recálculo reduce un importe ya liquidado, se registra un ajuste `TRIP_REVERSAL` a favor en el ciclo abierto. Las órdenes pagadas y el importe final histórico se conservan.

## Auditoría y aplicación

- `MEMBERSHIP_TRIP_ACCEPTED` y `MEMBERSHIP_TRIP_REVERSED` en `audit_log`, con actor, viaje, conductor, ciclo, uso y valores antes/después.
- Motivo: «Viaje descontado del ciclo por cancelación del pasajero».
- El evento `PASSENGER_CANCELLED` guarda `membershipReversal` en sus metadatos.
- La app solicita el estado actualizado al aceptar y al recibir la cancelación; no altera el contador localmente. Las consultas existentes del panel usan el mismo ciclo.

## Validación local

- API: 158 pruebas aprobadas en 26 archivos; 23 pruebas de cancelación/política/consumo sobre PostgreSQL aislado mediante PGlite.
- Casos: reintentos de aceptación/cancelación, búsqueda sin conductor, cancelación del conductor, reasignación A/B, reservas, excedentes/tope/cupos liberados, órdenes pendientes, renovación/ciclo cerrado, configuración desactivada, viajes iniciados/completados, históricos y rollback si falla auditoría.
- TypeScript API: sin errores.
- Flutter: 42 pruebas aprobadas y análisis sin errores.
- No se probaron teléfonos físicos en este ajuste. Las pruebas PGlite serializan las transacciones; no sustituyen una prueba de carga concurrente contra PostgreSQL de producción.

## Entrega

Cambios locales, sin commit, despliegue, modificaciones a datos de producción ni APK/AAB. En la siguiente entrega aplicar la migración junto al backend; empaquetar el pequeño ajuste móvil para refresco inmediato. No se agregaron endpoints ni un segundo sistema de membresías.
