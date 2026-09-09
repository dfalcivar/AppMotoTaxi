# Modelo económico Costa-Go — implementación local

Incluye el documento original, precios dinámicos/sugeridos de paquetes y
programados día/noche. No se ejecutaron migraciones ni se activó producción.
No se hizo commit, despliegue, APK o AAB en esta tarea.

## 1. Archivos

API: `commercial-economics.ts`, `arrival-commercial.ts`, `package-economics.ts`,
`commercial-economics-admin.ts`, `scheduled-arrival.ts`, `app.ts`, `memberships.ts`,
`membership-trip-usage.ts`, `realtime.ts`.

Panel: `commercial-economics-panel.tsx`, `scheduled-arrival-settings.tsx`,
`memberships-admin.tsx`.

Flutter: `driver_wallet_sheet.dart`, `main.dart`, `passenger_experience.dart`,
`driver_search_indicator.dart`.

Pruebas: `commercial-economics.test.ts`, `scheduled-arrival.test.ts`,
`arrival-commercial-database.test.ts`, `commercial-economics-admin.test.ts`,
`passenger-cancellations.test.ts`, `main_test.dart`, `driver_wallet_sheet_test.dart`.

## 2–3. Migraciones, tablas y campos

- `087_scheduled_arrival_configuration.sql`: configuración programada JSON y versión.
- `088_arrival_commercial_model.sql`: configuración comercial/versionado; indicador
  de ciclos nuevos; deuda/crédito `prior_cycle_due`; comisión teórica/aplicada en
  usos; propósito de órdenes y plan nullable solo para recargas; snapshot de ofertas
  y relación viaje/sesión.
- `driver_wallets`, `driver_wallet_movements`: total, reservado y ledger auditable.
- `trip_commercial_assignments`: economía por asignación y liquidación/liberación.
- `arrival_search_sessions`, `arrival_search_exclusions`: continuidad antiabuso.
- `package_commercial_rules`, `package_price_calculations`, `package_purchases`:
  reglas por código, cálculos y compras inmutables con uso asociado.

No se actualizan viajes/compras previos ni se cargan importes ilustrativos.
Las configuraciones nuevas son nulas/desactivadas.

## 4–5. Parámetros

Se reutilizan radios inicial/incremento/máximo y espera del despacho, incluida
última ronda parcial; `platform_commission_cents_per_leg` como base por ronda una
vez por viaje, sustituyendo el antiguo adicional por tramo; participación general
`membership_extra_trip_share_percent`; tarifa territorial/distancia/paradas;
IVA, vigencia de órdenes, permisos y canales actuales de aprobación.

El máximo heredado incluye base del plan: tope adicional = máximo de renovación
menos base. No se interpreta todo el máximo como otro cargo adicional.

Nuevos: habilitación, minutos/tolerancia de sesión, umbral de saldo bajo, recargas
mínima/máxima netas, ventana histórica, muestras mínima/confianza, frecuencia de
cálculo y distribución de referencia. Por paquete: factor, descuento, costo fijo,
mínimo y zona. Programados: habilitación, tarifas día/noche, inicios y zona horaria.

## 6–8. Endpoints y servicios

Modificados: vista previa/creación, reprogramación, ofertas/aceptación, detalle,
activo e historial, elegibilidad/disponibilidad, órdenes/aprobación y membresía.
El scheduler existente incorpora recálculo con frecuencia y bloqueo entre instancias.

Nuevos:

- GET/PUT `/v1/admin/scheduled-arrival-settings`.
- GET `/v1/admin/commercial-economics`.
- PUT `/v1/admin/commercial-economics/configuration`.
- PUT `/v1/admin/commercial-economics/packages/:planId/rules`.
- POST `/v1/admin/commercial-economics/packages/:planId/recalculate`.
- POST `/v1/admin/commercial-economics/packages/:planId/apply-suggested-price`.
- GET `/v1/admin/commercial-economics/dashboard`.
- GET `/v1/admin/commercial-economics/wallets`.
- POST `/v1/admin/commercial-economics/wallets/:driverId/adjust`.
- GET `/v1/driver/wallet`; PUT `/v1/driver/wallet/preference`.

Recargas usan POST existente `/v1/driver/membership/payment-orders` con
`topUpAmount`, sin `planId`, manteniendo QR/comprobante/finanzas/punto actuales.

## 9–11. Interfaces

Pasajero: rango previo, confirmación validada en servidor, búsqueda sin precio
cambiante ni rondas, valor definitivo al asignar, desglose en historial sin saldo
ni modalidad privada del conductor.

Conductor: tarjeta preservada con “Valor a cobrar”, saldo total/reservado/disponible,
opt-in, aviso de saldo bajo, recarga e historial. Detalle explica modalidad,
comisión, acumulado/tope o paquete consumido.

Panel: configuración, reglas por paquete, cálculo/publicación confirmada, compras,
márgenes, ledger y ajustes con motivo. Comparación por modalidad, rondas/promedios,
fecha/zona/plan/modalidad. Cobros fiscales globales se identifican como tales y
solo usan fechas: no se atribuyen arbitrariamente a una zona. Margen de cada
compra es acumulado y provisional mientras queden viajes.

## 12–15. Reglas comerciales

Pago por uso: solo neto sin IVA tras aprobación. Opt-in y fondos suficientes por
oferta. Reserva al aceptar, débito al completar, liberación al cancelar/reasignar,
incluidos cambios automáticos mediante trigger. Saldo independiente de planes.

Períodos: prioridad al plan válido. Incluidos sin adicional; después comisión
de llegada hasta remanente del tope, último cargo parcial y cero al alcanzarlo.
Ciclos heredados conservan cuota fija. Nuevos suman comisiones reales. Órdenes
nuevas congeladas; diferencias posteriores se arrastran como deuda/crédito del
período anterior, fuera de créditos/topes nuevos. Reversos de ciclos cerrados no
cambian pagos liquidados. Modalidad del viaje se congela al aceptar.

Paquetes: consumo sin débito de saldo ni excedente; comisión teórica para análisis.
Compra FIFO tras agotar créditos heredados sin compra identificable. Agotamiento
permite saldo solo con opt-in/fondos. Estimación usa rondas completadas, ventana y
ámbito suficientes; mezcla progresiva de historia/referencia. Reglas propias por
paquete. Cron solo calcula. Publicación exige permiso, confirmación y versiones
vigentes; crea otra versión. Compra conserva cantidad, precio, neto/IVA/total,
precio unitario, costo/sugerencia, distribución/ronda, porcentaje y configuración.

Programados: franja por instante de recogida, no creación/aceptación/GPS. Precio
congelado al confirmar; reprogramar exige nuevo total aceptado y conserva snapshot
anterior en eventos. Reasignar no cambia precio. Misma participación/modalidades.

## 16. Consistencia

Aritmética racional BigInt/NUMERIC, HALF_UP a centavos. Conversiones numéricas en
contratos antiguos son para presentación. Locks de facturación compartidos,
viaje/ciclo/cuenta/sesión y transacciones; únicos por movimiento/uso/compra/asignación.
Reutilizar clave con otro propósito se rechaza. Reservado no supera total; no
saldos negativos. Sesiones preservan configuración/máximo; exclusión del conductor
rechazado persiste. Se revalida cotización y sesión bajo lock antes de crear.

## 17–19. Verificación, riesgos y activación

Pruebas con PGlite aislado, sin producción: cálculo/rondas parciales, horarios,
sugerencias/versionado, SQL de panel, reservas/débitos/liberaciones, insuficiencia,
NaN, duplicados, exclusiones/privacidad, cancelaciones, tope parcial, paquetes y
cambio de plan durante viaje. Se conservan aserciones de cancelaciones anteriores.
Flutter: análisis estático, pruebas existentes y teléfono pequeño con fuente 140%.

PGlite serializado no sustituye una prueba multiconexión PostgreSQL. Antes de
activar: probar migraciones, aceptación simultánea y matching espacial PostGIS en
staging; validar visualmente en emuladores y ejecutar pagos/push de prueba. No se
hicieron esas comprobaciones externas en esta tarea.

Configurar todos los paquetes/referencias antes de habilitar. Publicar primero
app compatible: clientes antiguos no envían la confirmación requerida por el
nuevo modelo. No activar automáticamente ni cambiar versión/build en esta tarea.

Resultados locales del 9 de septiembre de 2026:

- API: `vitest run --maxWorkers=4`, 55 archivos, 438 pruebas aprobadas y 2 omitidas.
- Flutter: `main_test.dart` y `driver_wallet_sheet_test.dart`, 42 aprobadas.
- Typecheck de API y panel: aprobado.
- `git diff --check`: sin errores de whitespace.
