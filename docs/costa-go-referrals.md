# Referidos Costa-Go — implementación y operación

## Componentes entregados

| Requisito | Implementación |
| --- | --- |
| ReferralProgram | `benefit_reward_programs`: código, nombre, descripción, audiencia, inicio/fin, evento, viajes requeridos, beneficios de ambos participantes, límites, zonas, estado y versión. |
| Referral | `benefit_referrals`: referente/invitado, programa, código, origen, zona, estado, fechas de registro/calificación/entrega, referencia calificadora y motivo de bloqueo. |
| Código personal | `referral_codes`, persistido en backend por usuario, 64 bits aleatorios con `crypto.randomBytes`, índice único y reintento ante colisión. Estable al cerrar sesión, reinstalar o cambiar de equipo. |
| Enlace | `https://costa-go.com/r/CG-…?p=CODIGO_PROGRAMA`; mensaje configurable con `{url}` y `{code}`. |
| Landing | `/r/index.html`, valida el enlace con API pública, muestra/copia código, ofrece abrir la app y Google Play. `PUBLIC_APP_STORE_URL` habilita una URL HTTPS de apps.apple.com cuando exista. No expone identidad del referente. |
| Captura | Deep link `costa-go://referral/CG-…?p=…` guardado localmente hasta confirmar atribución, o código manual en Invita y gana. |
| Reglas | Cuenta activa y correo confirmado, dentro de primeros 7 días, creada durante la vigencia del programa, antes de iniciar viajes o recibir beneficios. El referente debe ser anterior al invitado. Aprobación sola exige atribuir antes de aprobar. |
| Eventos | Cuenta confirmada, primer viaje pasajero, aprobación conductor, primer viaje conductor, aprobación y primer viaje conductor, primer viaje genérico, X viajes, aprobación y X viajes. `mustBeApproved` y `mustBeActive` se configuran en el programa. |
| Viajes | Consulta estados reales `COMPLETED`, inicio y fin válidos, posterior a atribución, dentro de plazo, no futuro, distinto conductor/pasajero, sin flags de prueba ni cuentas de revisión. |
| Aprobación | Consulta `drivers.approval_status` y `approved_at`; exige activo/aprobado y valida fecha cuando la condición incluye aprobación. |
| Recompensas | Un único motor compartido en `benefits.ts`; origen REFERRAL. Cortesías reales y saldo promocional separado. Premio del invitado opcional. |
| Móvil | Card contextual fuera del espacio exclusivo HOME de campañas, pantalla reutilizable, compartir nativo, copiar, reglas reales, métricas propias y últimos 20 premios. |
| Administración | Campañas → Programas de referidos. Crear/editar/activar/pausar/finalizar, zonas, límites, condición, beneficios, auditoría y exclusiones de pruebas. |
| Métricas | Registros, códigos distintos, atribuciones por enlace/manuales, pendientes, calificados, premiados, número de beneficios y conversión a calificación. Son atribuciones confirmadas, no clics anónimos. |
| Seguridad | Sesión móvil y permisos `benefits:view/manage`, esquemas estrictos, no importe/beneficiario arbitrario desde Flutter, control por email/teléfono normalizado, sin heurística por IP. |
| Constraints | Invitado globalmente único, código personal único por cuenta, identidad de referencia inmutable, evento único y concesión única por `source/reference_id`. Bloqueos de cuenta/programa/beneficio y transacción para ambos premios. |
| Pruebas | Backend PGlite/Fastify, widgets Flutter y pruebas de la URL web. Incluyen repetición, llamadas simultáneas, límites independientes, prueba/no completado/cancelado, pasajero/conductor y persistencia de código. |
| Build/análisis | TypeScript API/panel, Vite, build web, Flutter analyze y tests. Ver resultado de entrega para compilación Android. iOS requiere validación posterior en macOS/Xcode. |

## Configurar un programa

1. En Beneficios y recompensas, crear la recompensa automática. Para conductores: días de cortesía, audiencia Conductores. Para pasajeros: saldo promocional acumulable con días de vigencia. Configurar valor, fechas y límites.
2. El beneficio del referente debe permitir repetición, para poder premiar distintos invitados. El del invitado puede ser de una sola vez. Las fechas del beneficio deben cubrir todo el programa; es recomendable dejar margen adicional para reintentos.
3. Crear Programas de referidos: código interno inmutable, descripción pública, fechas, audiencia y zonas. Elegir primer viaje válido para pasajeros o aprobación y primer viaje para conductores, salvo decisión comercial distinta.
4. Seleccionar beneficios y máximos. Un máximo global cuenta referidos premiados, no número de beneficios: un referido que premia a dos personas consume una plaza.
5. Configurar mensaje compartido, guardar Activo. No se crean programas, premios ni valores de demostración automáticamente.
6. Un usuario elegible abre Invita y gana, comparte. El invitado confirma su cuenta y registra el código antes de iniciar su primera actividad. Cumplida la condición, el backend procesa y acredita sin aprobación manual.
7. Revisar métricas, redenciones e historial en el panel.

## Procesamiento y pausa

El scheduler consulta evidencia canónica cada 15 segundos, con lotes de hasta 100. Una referencia pendiente se vuelve a evaluar aproximadamente cada 60 segundos; bloqueos de cuenta/beneficio/límite cada 5 minutos. Es procesamiento eventual: no promete acreditación instantánea bajo carga.

Estados: PENDING → QUALIFIED → REWARDED; si el plazo vence sin prueba válida, REJECTED. Una condición ya calificada pero temporalmente no verificable conserva QUALIFIED con motivo. Una pausa o finalización impide nuevas atribuciones, pero las registradas pueden completar la condición hasta el fin original. Al registrar cada referencia, un trigger guarda `rules_snapshot` inmutable con evento, cantidad, aprobación/actividad, beneficios, límites, fechas y zonas. El programa puede editarse; solo cambian futuras referencias. Los referidos anteriores se procesan con su snapshot, incluso si se pausa o cambia la vigencia actual. Las definiciones de beneficio siguen requiriendo vigencia/estado/elegibilidad para otorgar el premio y los bloqueos quedan auditados.

Cada entrega se ejecuta en transacción. Un savepoint contiene ambos beneficios: si uno falla, ninguno se acredita y la referencia permanece calificada para reintentar. Bloqueos ordenados coordinan cortesías/compras y límites. Los índices impiden doble recompensa aunque se repita el procesamiento o el evento. Las pruebas simultáneas usan PGlite, no sustituyen una prueba de carga multiconexión en PostgreSQL remoto.

## Pruebas y cuentas de revisión

En el panel puede excluirse una cuenta por correo o un viaje por ID. Hacerlo antes de la actividad; no revierte premios entregados. Las cuentas con `user_service_area_access.review_mode` se excluyen automáticamente y los viajes se marcan al asignar conductor/pasajero. Marcar las demás cuentas de demostración manualmente antes de probar. No se altera su acceso normal a Costa-Go.

Para probar el flujo de recompensas utilice una base aislada o usuarios controlados elegibles: una cuenta explícitamente excluida no puede generar premios. No se modificó la cuenta Juan ni se concedió ningún beneficio remoto durante el desarrollo.

## Saldo promocional y límites del MVP

El saldo promocional se acredita de verdad en `benefit_promotional_credits` y registra un movimiento GRANT idempotente. Vence conforme a `expirationDays`, no suma dinero a `driver_wallets` y se muestra separado. **Todavía no se puede gastar en viajes ni retirar**; el panel y la app lo indican. Descuentos directos y viajes gratis continúan fuera del alcance de los tipos operativos.

Las cortesías sí tienen efecto en la cobertura del conductor mediante el motor existente, respetando membresías pagadas y suspensión. No crean cobros, facturas ni una membresía ficticia.

No hay deferred deep linking: una instalación desde la tienda no transfiere automáticamente el código. La landing lo deja visible/copiable para introducirlo después. HTTPS App Links/Universal Links quedan como evolución; hoy se abre desde el botón usando el esquema compartido Android/iOS. Compartir nativo en iOS queda implementado, pero requiere prueba real en Xcode/dispositivo.

No se añadieron correos/push de referidos; la confirmación y el historial se consultan en la app. No se muestran identidades de invitados en móvil: métricas agregadas únicamente. Auditoría administrativa conserva actor/fecha/cambio y referencia del evento.

## Despliegue

- Ejecutar migraciones 101, 102 y 103 mediante el migrador habitual antes de iniciar la nueva API. No insertar premios históricos.
- Desplegar API y panel, además del sitio estático.
- `render.yaml` incluye rewrite `/r/*` → `/r/index.html` para Costa-Go web. En un servicio Render existente que no sincronice reglas del Blueprint, añadir la regla en Redirects/Rewrites antes de divulgar enlaces.
- Publicar una versión móvil con esta pantalla y el intent filter; las versiones anteriores no conocen la ruta de referidos.
- Opcional futuro: `PUBLIC_APP_STORE_URL` del sitio; no contiene secretos.
- No se ejecutó ninguna migración remota, activación, despliegue o emisión fiscal en esta tarea.

**Un referido solamente genera recompensas cuando cumple la condición configurada, y dicho evento no puede otorgar premios dos veces.**

## Resultado de verificación local

- Verificación de la fase inicial: 102 pruebas de backend aprobadas. La ampliación de reglas se documenta debajo.
- 14 pruebas Flutter aprobadas (4 nuevas de referidos); 3 pruebas del enlace web aprobadas.
- TypeScript API y panel sin errores; Vite y sitio estático compilados.
- Flutter analyze sin incidencias.
- La prueba PGlite ejecuta las migraciones 101, 102 y 103 sobre una base aislada; no usa datos de producción.
- APK de la fase anterior (no incluye la ampliación de reglas/snapshots): `apps/mobile/build/app/outputs/flutter-apk/app-release.apk` (138,7 MB), `APP_ENV=staging`, API habitual y `API_HTTP_PROXY=http://10.2.2.5:3128`. Es una variante de pruebas, no un AAB para Play Store. No se instaló en emuladores.
- La variante debug no tiene un cliente Firebase configurado para el sufijo `.debug`; se verificó la variante release de pruebas habitual. Para la dependencia nativa JNI se requirió acceso a la caché de Flutter.
- iOS no se compiló en Windows.


## Ampliación: condiciones parametrizables y conservación de reglas

- Eventos nuevos: FIRST_COMPLETED_TRIP (según rol atribuido) y DRIVER_APPROVED_AND_X_COMPLETED_TRIPS. Los eventos anteriores continúan compatibles. X utiliza la cantidad elegida; los eventos llamados primer viaje representan uno por definición. La cantidad solo se muestra para eventos X.
- mustBeApproved añade aprobación a la condición para conductores. Los eventos que incluyen aprobación explícitamente la exigen siempre; no se puede desactivar conservando ese evento. mustBeActive controla la condición de calificación. La entrega siempre mantiene los controles del motor de beneficios: una cuenta bloqueada no recibe créditos y la cortesía requiere conductor aprobado. Desactivar una condición comercial no desactiva esos controles.
- La API entrega requiredTrips, completedTrips, remainingTrips, isApproved, isActive, condition y qualifyingEvent desde evidencia real y el snapshot original. Móvil y panel lo representan sin calcular elegibilidad. Se excluyen viajes de prueba, cancelados, sin inicio/fin válidos, posteriores al plazo o anteriores a atribución.
- Snapshot automático e inmutable por trigger. Incluye la versión original del programa y su audiencia, fechas, zonas, códigos de beneficios, límites y requisitos. La migración 103 inicializa referencias existentes con las reglas vigentes al migrar; no inventa cambios históricos ni entrega premios.
- Las definiciones de beneficios ya prometidas conservan valor, duración, audiencia, límites, vigencia y zonas: un trigger rechaza cambiar su economía. Nombre, descripción y estado administrativo siguen editables. Para nuevos valores, crear otra definición y seleccionarla en el programa; los anteriores conservan el código prometido. La pausa administrativa de un beneficio puede detener la entrega y queda auditada como bloqueo.
- Los límites se conservan por snapshot y cuentan todas las entregas del programa. No reservan una plaza al registrar: sigue existiendo disponibilidad global compartida. Cambiar límites del programa no reescribe las condiciones de referencias existentes.
- Si se cumple dentro del plazo y el worker procesa después, se valida la ventana del beneficio con la fecha canónica de calificación. La duración del premio comienza al concederlo; no se pierde por un retraso del scheduler. Una extensión posterior no vuelve válidos viajes fuera del plazo original.
- Código aleatorio generado en backend, con UNIQUE global y clave primaria por userId. Nuevo trigger impide modificar, trasladar o borrar el código. No existe endpoint de regeneración/edición. Flutter envía únicamente code/programId y backend resuelve el referente.
- El enlace también funciona como /r/{code}, sin parámetro de programa; el parámetro p opcional conserva el programa elegido al compartir. La app verifica audiencia y zona al atribuir. Captura por esquema costa-go, persistencia local antes del registro y copia manual siguen disponibles. No hay deferred deep linking.

Pruebas nuevas: combinación aprobación/activo/3 viajes, progreso 5/3/2, regla original 1 frente a regla nueva 5, snapshot/código/beneficio inmutables, BOTH con primer viaje genérico, y procesamiento antes/después del plazo. No se generó otro APK ni se desplegaron estos ajustes.

Verificación de la ampliación: 108 pruebas backend aprobadas (23 referidos, 14 beneficios y 71 regresiones), 15 Flutter y 4 web. API/panel TypeScript, build Vite y build del sitio correctos; Flutter analyze sin incidencias. Los cambios permanecen locales, sin commit ni migración remota.
