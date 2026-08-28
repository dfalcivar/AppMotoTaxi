# Ciclos parametrizables de cancelaciones del pasajero

## Regla operativa

- Solo cuenta una cancelación del pasajero después de una aceptación real, antes de iniciar el viaje. Se conserva la comprobación de conductor, fecha de asignación y aceptación de oferta/reserva.
- La primera cancelación penalizable abre un ciclo y se registra como n.º 1.
- Duración inicial: 30 días exactos de 24 horas desde ese instante, no meses calendario.
- `cycleDurationDays` se configura en **Configuración operativa → Cancelaciones después de aceptar → Configurar política** (entero entre 1 y 3650).
- La duración se congela al abrir cada ciclo. Cambiarla afecta a los siguientes ciclos, no desplaza fechas existentes.
- El intervalo vigente es `[inicio, vencimiento)`. Al vencer, el contador operativo es 0. La siguiente cancelación abre otro ciclo y vuelve a n.º 1.
- Las lecturas del panel y la advertencia previa a cancelar calculan el vencimiento inmediatamente. Una tarea de mantenimiento cada 60 segundos pone también en cero el campo almacenado; cancelar nunca depende de que esa tarea haya corrido.
- El vencimiento solo modifica el contador. Las suspensiones finitas conservan su fecha final y las indefinidas exigen reactivación administrativa.
- Se conservan los umbrales configurables: advertencias 1–2, 2 días desde 3, 5 días desde 4, 7 días desde 5, indefinida desde 6.
- Desactivar las sanciones automáticas sigue registrando cancelaciones y ciclos sin aplicar suspensión.

## Persistencia y auditoría

Migración `071_passenger_cancellation_cycles.sql`, posterior a las migraciones 069 y 070:

- `passenger_cancellation_cycles`: pasajero, UUID, inicio, fin, duración y origen del ciclo.
- `users.passenger_cancellation_count`: contador operativo del ciclo.
- `users.passenger_cancellation_total`: total histórico independiente, nunca reiniciado por vencimiento/reactivación.
- `users.passenger_cancellation_cycle_id`: referencia al último ciclo del pasajero.
- `passenger_cancellations`: mantiene viaje, conductor, fecha, estado previo, número, sanción, inicio/fin de suspensión, política aplicada y reactivación. Añade ciclo, motivo y originador.
- La clave única por viaje impide duplicados. La numeración es única dentro del ciclo; permite repetir n.º 1 en otro ciclo.
- Cancelación, incremento del ciclo, incremento histórico, suspensión y reversión del consumo de membresía del conductor se realizan dentro de la misma transacción.
- El bloqueo del pasajero serializa cancelaciones concurrentes; el bloqueo del viaje detecta reintentos. Reprocesar un viaje cancelado devuelve el resultado guardado y no abre ciclos ni altera contadores.
- No se incorpora ningún endpoint de eliminación de historia ni control de borrado en el panel.

### Historial anterior a los ciclos

Los registros anteriores se conservan íntegros, incluyendo números, fechas, sanciones y suspensiones. Se agrupan por pasajero en un ciclo identificado como `LEGACY`, visible como «Historial previo al sistema de ciclos».

Su inicio corresponde al primer registro; la duración es al menos 30 días y se amplía si hace falta para contener todos los registros anteriores. No se recalculan sanciones retroactivamente. Si ya venció, el contador operativo se pone en cero, pero las suspensiones se conservan. No se elimina ningún registro antiguo.

## API y panel

- `GET /v1/admin/passengers/:id/cancellation-summary`: nuevo resumen, requiere `passengers:view`.
- `GET /v1/admin/passengers/:id/cancellations?page=N`: conserva la respuesta de lista y añade datos de ciclo/originador y total de registros. 20 por página, orden cronológico descendente.
- `GET/PATCH /v1/admin/settings/passenger-cancellations`: reutilizados, añaden duración. Consulta con `settings:view`, modificación con `settings:manage` y auditoría existente. Los clientes anteriores que omiten duración conservan la configuración vigente.
- `GET /v1/passenger/cancellation-policy`: misma forma de respuesta; calcula la próxima penalización usando exclusivamente el contador vigente.
- **Pasajeros → Información del pasajero**: contador vigente, umbral inicial de suspensión y siguiente umbral, fechas, estado, fin de suspensión y total histórico.
- **Ver historial de cancelaciones**: todos los ciclos, responsables, motivo, viaje y sanciones, paginación y solo consulta.
- Detalle adaptable a pantallas pequeñas, cierre con Escape, carga, error, actualización manual y refresco cada 60 segundos.

## Validación local

- API: 169 pruebas aprobadas en 27 archivos, incluidas 33 de cancelaciones/consumo de membresía y una prueba específica de migración con historial previo.
- Casos: primer ciclo, vencimiento, reinicio n.º 1, total permanente, reintentos, concurrencia simulada en PGlite, duraciones 30/60/90, suspensiones finitas/indefinidas, reactivación, paginación y permisos.
- Panel: 8 pruebas aprobadas; comprobación de tipos y compilación de producción correctas.
- Navegador local con datos ficticios: detalle, página 2 del historial, suspensión indefinida con ciclo vencido, ancho de 390 px y cambio de duración a 60 días. No se consultaron ni modificaron cuentas reales.
- Las pruebas PostgreSQL usan PGlite aislado; no sustituyen una prueba de carga concurrente en el PostgreSQL de producción.
- No se desplegó ni ejecutó la migración en producción. No se generó APK/AAB por este cambio.

## Publicación posterior

Publicar API y panel juntos con la migración 071 mediante el mecanismo habitual del repositorio. No ejecutar SQL manual para reiniciar historial. Esta mejora de ciclos no requiere cambiar los contratos de la app; los cambios móviles pendientes de la entrega anterior siguen separados.
