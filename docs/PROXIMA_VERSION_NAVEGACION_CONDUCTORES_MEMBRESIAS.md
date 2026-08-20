# Próxima versión: navegación, carga masiva, membresías y recaudación

Estado: **implementado para validación controlada en prueba cerrada; activación productiva pendiente de migración, despliegue y pruebas operativas**.

Este documento conserva el alcance acordado para agrupar la implementación, las mejoras visuales, las pruebas y el empaquetado en una sola versión.

## 1. Navegación parametrizable por tramo y proveedor

La navegación del conductor debe controlarse desde backend/panel y no quedar fijada en la APK. La alternativa inicial recomendada será abrir la aplicación de mapas del teléfono para reducir costos, conservando Navigation SDK como opción futura o selectiva.

Separar proveedor y forma de inicio:

- `navigation_pickup_provider`: tramo conductor → pasajero.
- `navigation_destination_provider`: tramo pasajero → destino(s).
- `navigation_pickup_start_mode`: forma de inicio del tramo de recogida.
- `navigation_destination_start_mode`: forma de inicio del tramo hacia destino.

Proveedores:

- `MAP_ONLY`: mapa, polyline y Routes API dentro de Costa-Go, sin giro a giro.
- `EXTERNAL_MAPS`: abrir Google Maps o una aplicación de mapas compatible mediante un enlace universal.
- `NAVIGATION_SDK`: navegación giro a giro integrada dentro de Costa-Go.

Modos de inicio:

- `MANUAL`: el conductor pulsa **Iniciar navegación**.
- `AUTO`: abrir/iniciar la navegación al entrar al tramo, únicamente cuando la experiencia y las políticas del sistema lo permitan.

Combinaciones admitidas:

| Proveedor de recogida | Proveedor de destino | Resultado |
| --- | --- | --- |
| MAP_ONLY | MAP_ONLY | Maps/Routes dentro de Costa-Go en ambos tramos |
| EXTERNAL_MAPS | EXTERNAL_MAPS | Aplicación de mapas externa en ambos tramos |
| EXTERNAL_MAPS | NAVIGATION_SDK | Navegación externa para recoger e integrada hacia destino |
| NAVIGATION_SDK | EXTERNAL_MAPS | Navegación integrada para recoger y externa hacia destino |
| NAVIGATION_SDK | NAVIGATION_SDK | Navigation SDK en ambos tramos |

Configuración inicial recomendada:

- Recogida: proveedor `EXTERNAL_MAPS`, inicio `MANUAL`.
- Destino: proveedor `EXTERNAL_MAPS`, inicio `MANUAL`.

Esta configuración no debe generar solicitudes de Navigation SDK. Costa-Go seguirá utilizando sus servicios actuales para mapa, vista previa, distancia, ETA y tarifa cuando corresponda.

### Navegación mediante aplicación externa

- utilizar URLs universales de Google Maps sin clave API para abrir direcciones/navegación;
- enviar coordenadas exactas y no depender únicamente del texto de la dirección;
- permitir que Android muestre una aplicación compatible cuando corresponda;
- si Google Maps no está instalado, usar el navegador o el fallback interno;
- abrir una parada a la vez en viajes con múltiples destinos para conservar el flujo y el orden de Costa-Go;
- al completar una parada, ofrecer navegación hacia la siguiente;
- mantener en Costa-Go las acciones **Llegué**, **Iniciar viaje**, **Completar parada** y **Finalizar viaje**;
- mostrar una notificación persistente durante un viaje activo con la acción **Volver a Costa-Go**;
- mantener el envío de ubicación en segundo plano para que el pasajero continúe viendo al conductor;
- restaurar y sincronizar el estado actual del viaje al volver desde la aplicación de mapas;
- no asumir que la ruta externa será idéntica a la utilizada para estimar distancia o tarifa;
- registrar apertura, aplicación elegida, tramo y retorno, sin contabilizarlo como Navigation Request.

La navegación externa no proporcionará a Costa-Go una confirmación directa y confiable de llegada. La proximidad podrá apoyar la interfaz, pero el conductor continuará confirmando manualmente los cambios de estado.

Requisitos técnicos:

- Fuente de configuración: backend y panel administrativo.
- Preparar alcance futuro global, por zona y por cooperativa.
- permitir cambiar de proveedor sin publicar una nueva APK, siempre que el proveedor ya esté soportado por esa versión;
- Reutilizar la sesión del mismo tramo cuando sea técnicamente válido.
- No volver a ejecutar `setDestinations` por cerrar y abrir la vista si la sesión sigue vigente.
- Detener las consultas duplicadas de Routes mientras Navigation SDK esté activo.
- Mantener Maps/Routes como fallback tanto para navegación externa como para Navigation SDK.
- Contabilizar por separado destinos facturables de recogida y de viaje.
- Registrar proveedor, apertura, reapertura, fallback, error, duración y tramo.
- Revisar la continuación entre múltiples destinos sin recrear innecesariamente la sesión.

### Control de consumo y costos

Agregar seguimiento operativo de Navigation SDK sin depender únicamente de la factura de Google Cloud:

- contador mensual estimado de destinos solicitados;
- reinicio lógico del contador al comenzar cada período mensual de facturación;
- desglose por tramo: conductor → pasajero y pasajero → destino(s);
- desglose por zona, cooperativa y aplicación/plataforma cuando exista información suficiente;
- identificación del viaje, tramo y sesión para impedir contabilizar reaperturas como navegaciones nuevas;
- alertas configurables antes de alcanzar el límite gratuito mensual, inicialmente al 80 % y al 95 %;
- indicador en el panel con consumo estimado, destinos gratuitos restantes y proyección del mes;
- presupuesto y alertas complementarias configuradas en Google Cloud;
- cuota diaria preventiva configurable, evitando interrumpir viajes activos;
- registro separado del consumo de Routes API, Places, Geocoding y Navigation SDK;
- no presentar la métrica interna como factura definitiva: Google Cloud continúa siendo la fuente oficial de cobro.

Si ambos tramos están configurados como `MAP_ONLY` o `EXTERNAL_MAPS`, la aplicación no debe invocar `setDestination`/`setDestinations` ni generar solicitudes facturables de Navigation SDK. Maps/Routes, Places y Geocoding conservarán su consumo independiente.

La configuración debe permitir ajustar los umbrales y el límite gratuito de referencia sin publicar una nueva APK, porque Google puede modificar precios, niveles gratuitos o condiciones comerciales.

### Optimización de cargas de mapa móvil

Dejar de proporcionar Map ID a los mapas normales de las aplicaciones Android/iOS y utilizar los estilos JSON locales existentes para evitar que las cargas móviles se clasifiquen como `Dynamic Maps` según la estructura de precios vigente.

Configuración inicial:

- pasajero Android/iOS: Maps SDK sin Map ID;
- conductor Android/iOS fuera de navegación integrada: Maps SDK sin Map ID;
- estilo claro: JSON local de Costa-Go;
- estilo oscuro: JSON local de Costa-Go;
- selección de estilo: automática según el tema claro/oscuro del sistema;
- panel administrativo web: conservar API Key y Map ID web para el editor de zonas;
- navegación externa: no genera una carga de mapa atribuida al proyecto de Costa-Go;
- Navigation SDK integrado futuro: mantener soporte opcional y revisar su configuración/costo al habilitarlo.

Requisitos visuales:

- conservar la apariencia actual de Costa-Go con calles principales visibles, fondo limpio, agua diferenciada y puntos de interés reducidos;
- mantener hospitales, terminales, estaciones y elementos relevantes para movilidad;
- validar contraste de etiquetas en ambos temas;
- no volver al estilo predeterminado de Google si falla la lectura del tema;
- cambiar de tema cuando cambie la configuración del sistema, sin perder ruta, cámara ni estado del viaje;
- no recrear el mapa por cambios ordinarios del viaje, formulario, marcadores o bottom sheet;
- conservar marcadores, clustering, polylines, padding dinámico y selección mediante pin.

Implementación/configuración prevista:

```text
MOBILE_CLOUD_MAP_STYLE_ENABLED = false
```

Cuando esté deshabilitado, no pasar `mapId` al widget móvil y aplicar el JSON local correspondiente. Los Map ID pueden mantenerse fuera del código como configuración disponible, pero no deben enviarse al mapa móvil en la compilación operativa predeterminada.

Si en el futuro se necesita Cloud-based Maps Styling, podrá habilitarse en una nueva versión después de revisar costos. Dado que el Map ID se utiliza al construir el mapa, no debe alternarse en mitad de un viaje.

Control de costos:

- registrar por separado cargas móviles `Maps SDK` y cargas web `Dynamic Maps` cuando Google Cloud las reporte;
- conservar el panel con Map ID porque su volumen esperado es administrativo y reducido;
- revisar las tarifas antes de cada lanzamiento, ya que Google puede cambiar la gratuidad o clasificación de las SKU;
- no presentar el ahorro estimado como garantía contractual: Google Cloud Billing continúa siendo la fuente definitiva.

### Optimización de búsqueda de direcciones y lugares

Reducir el uso de `Places Text Search Pro` sin eliminar la posibilidad de buscar escribiendo nombres de calles, comercios o lugares como **Coral**, **La Jaula** o **Mutualista**.

Arquitectura de búsqueda:

1. Usar `Autocomplete (New)` como mecanismo principal mientras el usuario escribe.
2. Crear un token nuevo y único por cada sesión de búsqueda.
3. Cerrar la sesión mediante `Place Details Essentials` al seleccionar una sugerencia, solicitando únicamente identificador, dirección y coordenadas necesarias.
4. Si Autocomplete no devuelve resultados útiles, permitir una única consulta controlada de `Text Search Pro` como fallback, no una consulta por cada carácter.
5. Mantener los proveedores de respaldo actuales cuando Google no esté disponible, respetando sus límites y términos.

La interfaz debe conservar:

- escritura libre de direcciones, calles, barrios, establecimientos y nombres conocidos;
- sugerencias aproximadas y coincidencias relevantes;
- búsqueda de intersecciones;
- resultados dentro de la zona operativa autorizada;
- dirección legible y coordenadas exactas al seleccionar;
- opción independiente para seleccionar el punto en el mapa;
- mensajes claros cuando no existan coincidencias o falle temporalmente el proveedor.

Controles de consumo y rendimiento:

- no consultar antes de alcanzar el mínimo configurable de caracteres, inicialmente 3;
- aplicar debounce configurable, inicialmente entre 350 y 500 ms;
- cancelar o ignorar respuestas anteriores cuando cambie el texto;
- no iniciar otra sesión al reconstruir el widget;
- reutilizar la sesión mientras el usuario siga editando el mismo campo;
- terminar o abandonar correctamente la sesión al seleccionar, borrar o salir;
- no reutilizar el mismo token para origen, destinos diferentes o búsquedas futuras;
- solicitar exclusivamente los campos necesarios para evitar elevar el SKU;
- no ejecutar Place Details para sugerencias que el usuario no seleccionó;
- aplicar bounds/bias de la Service Area actual y después validar la coordenada contra el polígono real;
- conservar el filtro del polígono como validación definitiva, sin depender únicamente de Google Places;
- mantener una caché corta únicamente donde lo permitan las condiciones de Google y sin almacenar datos de Places más tiempo del autorizado;
- registrar por separado sesiones, solicitudes Autocomplete, Place Details y fallbacks Text Search Pro.

El fallback de Text Search debe activarse únicamente ante una acción o condición definida, por ejemplo: ausencia de sugerencias útiles después del debounce, confirmación de búsqueda o consulta completa. Nunca debe dispararse simultáneamente con cada solicitud de Autocomplete.

La optimización se considerará válida solamente si mantiene o mejora los resultados funcionales actuales dentro de `ATACAMES_PROD`, `CUENCA_TEST` y futuras zonas. Reducir costos no justifica impedir encontrar comercios o direcciones válidas.

### Presupuesto y límite mensual de Text Search Pro

Incorporar un control interno de consumo para utilizar Text Search Pro como respaldo sin dejar abierta una facturación ilimitada.

Valores iniciales de referencia según la tarifa vigente al preparar esta versión:

- límite gratuito de referencia: 5.000 consultas mensuales;
- precio de referencia posterior: USD 32 por cada 1.000 consultas;
- presupuesto adicional inicial: USD 20 mensuales;
- reserva pagada estimada: 625 consultas;
- límite operativo estimado: 5.625 consultas mensuales.

Estos valores no deben quedar compilados en la APK. Deben ser configurables desde backend/panel porque Google puede modificar precios, niveles gratuitos, períodos o categorías de SKU.

Parámetros iniciales:

```text
text_search_free_cap_reference = 5000
text_search_price_per_thousand_usd = 32
text_search_monthly_budget_usd = 20
text_search_warning_percent = 80
text_search_critical_percent = 95
text_search_hard_limit_enabled = true
```

Comportamiento progresivo recomendado:

```text
0–80 %              uso normal como fallback
80–90 %             alerta administrativa
90–100 % gratuito   modo conservador: solo búsqueda explícita sin resultados útiles
reserva pagada       permitir hasta el presupuesto mensual configurado
límite operativo     suspender únicamente Text Search Pro hasta el siguiente período
```

Al alcanzar el límite:

- Autocomplete debe continuar disponible;
- Place Details debe continuar disponible según su presupuesto independiente;
- intentar proveedores alternativos autorizados;
- conservar búsqueda de intersecciones y selección manual en el mapa;
- mostrar un mensaje útil si no existen resultados, sin mencionar límites financieros;
- no bloquear la solicitud de un viaje cuando el usuario pueda seleccionar coordenadas válidas por otro mecanismo;
- reactivar Text Search Pro al iniciar el siguiente período de control.

El contador debe:

- residir en backend y actualizarse de forma atómica;
- separar ambiente de producción y pruebas;
- evitar contar reintentos técnicos o respuestas servidas desde caché como nuevas solicitudes a Google;
- registrar fecha, zona y resultado sin almacenar innecesariamente el texto personal buscado;
- mostrar consumo, porcentaje, presupuesto estimado y proyección mensual en el panel;
- emitir alertas internas y por correo a los administradores configurados;
- permitir desactivación manual de emergencia;
- reconciliar periódicamente la estimación interna con Google Cloud Billing.

El contador interno es una protección operativa, no una factura definitiva. Los datos de Google Cloud pueden tener retraso y la cuenta de facturación podría incluir otros proyectos o SKUs.

Proyección de referencia bajo el flujo optimizado, sujeta al comportamiento real de los usuarios:

| Viajes mensuales | Estimación total de Google Maps Platform |
| ---: | ---: |
| 1.000 | aproximadamente USD 0 |
| 5.000 | aproximadamente USD 28–48 |
| 10.000 | aproximadamente USD 205–225 |

La proyección asume origen GPS, un destino, aproximadamente cuatro solicitudes Autocomplete, un Place Details, dos rutas, dos cargas de mapa y Text Search como fallback minoritario. Debe recalcularse con telemetría real antes de utilizarla como presupuesto financiero.

### Limpieza del formulario después de programar un viaje

Al crear correctamente un viaje programado, la aplicación del pasajero debe cerrar el borrador utilizado y limpiar completamente el formulario principal:

- origen seleccionado;
- destinos y paradas;
- marcadores y polyline del viaje preparado;
- fecha y hora programadas;
- referencia;
- número de pasajeros;
- método de pago seleccionado para ese borrador, cuando corresponda;
- distancia, duración y tarifa calculadas;
- estado de confirmación y cualquier identificador temporal.

Después de guardar, el mapa debe volver a su estado inicial normal y la pantalla principal no debe conservar datos que permitan solicitar accidentalmente como viaje inmediato el mismo recorrido programado.

La reserva guardada continuará disponible en **Viajes programados**. Sus datos solamente volverán a cargarse en el formulario cuando el pasajero pulse expresamente **Modificar viaje** desde el detalle correspondiente.

Reglas de seguridad:

- no reutilizar automáticamente el último origen/destino después de crear la reserva;
- impedir doble envío mediante bloqueo del botón mientras se guarda e idempotencia en backend;
- confirmar que la creación fue aceptada por backend antes de limpiar el formulario;
- si la creación falla, conservar el borrador para que el usuario pueda corregirlo o reintentar;
- al modificar, cargar una copia controlada asociada al identificador del viaje programado y no crear una solicitud nueva accidentalmente;
- al guardar una modificación, regresar nuevamente al estado limpio;
- si ya existe conductor asignado, no modificar silenciosamente fecha, origen o destinos: aplicar las validaciones actuales, advertir al pasajero y notificar al conductor; si el cambio exige liberación o nueva aceptación, backend debe resolverlo explícitamente;
- cancelar la edición debe descartar la copia de trabajo y mantener intacta la reserva original.

La ubicación GPS actual puede continuar mostrándose en el mapa después de limpiar, pero no debe convertirse en un nuevo origen confirmado hasta que el pasajero inicie otra solicitud.

### Total final en el resumen previo del viaje

La tarjeta de resumen anterior a la confirmación de un viaje inmediato o programado debe cerrar el desglose con una fila visualmente destacada:

```text
Total a pagar                         $X,XX
```

El texto y el valor deben aparecer en negrita, con separación suficiente respecto de los conceptos anteriores y sin quedar ocultos por el botón de confirmación o el bottom sheet.

El total mostrado debe proceder del cálculo definitivo del backend e incluir todos los componentes aplicables:

- tarifa de cada tramo según origen y destinos;
- recargo total por paradas;
- cantidad de pasajeros, horario u otras reglas tarifarias configuradas;
- ajustes autorizados que formen parte del precio final;
- comisión interna de uso cuando esté configurada como parte del total, sin exponerla como línea independiente al pasajero según la regla comercial acordada.

Ejemplo conceptual:

```text
Tarifa de los recorridos              $1,60
Adicional por 1 parada                $0,25
──────────────────────────────────────────
Total a pagar                         $1,85
```

Reglas de consistencia:

- pasajero, conductor, solicitud enviada y backend deben utilizar exactamente el mismo total y la misma moneda;
- el cliente no debe volver a sumar ni redondear importes por su cuenta;
- el total debe recalcularse al agregar, quitar o reordenar destinos, cambiar pasajeros, horario u otro dato tarifario;
- bloquear la confirmación mientras el cálculo más reciente esté pendiente;
- asociar el cálculo a una versión o identificador de cotización para evitar confirmar una tarifa anterior;
- conservar en el viaje el desglose y total aceptados para auditoría;
- si la tarifa cambia antes de confirmar, mostrar el nuevo total y exigir confirmación explícita;
- utilizar dos decimales y reglas monetarias del backend, evitando errores de coma flotante.

El conductor debe visualizar el mismo **Total a pagar** en la tarjeta de solicitud y en el detalle del viaje, sin revelar componentes internos que no correspondan.

## 2. Importación masiva de conductores por CSV

Agregar en el panel de Conductores la acción **Importar CSV**.

La importación incluye únicamente información estructurada. No incluye:

- fotografía del conductor;
- identificación escaneada;
- licencia;
- matrícula;
- permiso de operación;
- demás documentos o archivos.

Cada conductor debe ingresar posteriormente y cargar personalmente sus fotografías y documentos.

Flujo previsto:

1. Descargar plantilla CSV desde el panel.
2. Seleccionar archivo.
3. Validar columnas, formato, duplicados y cooperativas.
4. Mostrar vista previa con filas válidas y errores.
5. Confirmar importación.
6. Crear cuentas en estado `PENDIENTE_DOCUMENTOS`.
7. Enviar invitación para verificar correo y establecer contraseña.
8. Conductor completa fotografía y documentación.
9. Continúa el flujo existente de revisión y aprobación.

Reglas de seguridad:

- No aceptar contraseñas en texto plano dentro del CSV.
- No aprobar ni habilitar automáticamente un conductor importado.
- Validar correo, teléfono e identificación contra pasajeros y conductores existentes.
- Resolver cooperativa mediante código; permitir valor `INDIVIDUAL`.
- No almacenar el CSV permanentemente después de procesarlo.
- Mostrar reporte descargable de filas importadas, omitidas y rechazadas.
- Registrar administrador, fecha, nombre del archivo, totales y resultado en auditoría.
- Aplicar límite de tamaño y cantidad de filas.

Campos iniciales sugeridos para la plantilla:

- nombres;
- apellidos;
- identificación;
- correo;
- teléfono;
- código de cooperativa o `INDIVIDUAL`;
- placa;
- marca del vehículo;
- modelo;
- año;
- información adicional no documental que ya admita el registro actual.

## 3. Membresías de conductores

La aprobación documental y la membresía son conceptos separados.

Un conductor puede estar documentalmente `APROBADO`, pero no debe recibir viajes si su membresía está vencida o suspendida.

Planes iniciales:

- `MONTHLY`: mensual;
- `QUARTERLY`: trimestral;
- `ANNUAL`: anual.

Estados de membresía:

- `PENDING`: todavía no inicia;
- `ACTIVE`: vigente;
- `EXPIRING`: dentro del umbral de aviso;
- `GRACE_PERIOD`: período de gracia posterior al vencimiento;
- `PAYMENT_DUE`: terminó el último día permitido, pero todavía no llega la hora efectiva de suspensión;
- `SUSPENSION_PENDING_ACTIVE_TRIP`: alcanzó la hora de suspensión durante un viaje activo;
- `SUSPENDED_NON_PAYMENT`: bloqueo operativo por falta de renovación;
- `SUSPENDED`: suspensión manual administrativa por una causa distinta.

El cierre/expiración del ciclo se conserva como dato histórico, pero no debe utilizarse por sí solo como sinónimo de suspensión operativa a medianoche.

Fechas mínimas:

- fecha de inicio;
- fecha de caducidad;
- fecha de última renovación;
- fecha final del período de gracia, cuando corresponda;
- fecha de suspensión, cuando corresponda.

Responsable de cobertura/pago:

- `INDIVIDUAL`: cubierta por el propio conductor;
- `COOPERATIVE`: cubierta por su cooperativa;
- preparar otros responsables futuros sin alterar las reglas de asignación de viajes.

Regla de habilitación:

```text
puede recibir viajes =
  cuenta activa
  + conductor APROBADO
  + documentos obligatorios vigentes
  + membresía ACTIVE, EXPIRING o PAYMENT_DUE
  + opcionalmente GRACE_PERIOD si la política configurada permite recibir viajes
  + no SUSPENDED_NON_PAYMENT ni suspensión administrativa/seguridad
```

El vencimiento no debe interrumpir un viaje que ya está activo. Al terminarlo, el conductor queda impedido de conectarse o recibir nuevas solicitudes hasta renovar.

### Tarjeta de membresía para el conductor

Agregar en la cuenta/perfil del conductor una tarjeta clara y compacta:

```text
Membresía Costa-Go

🟢 Activa

Vigente hasta
30 de septiembre de 2026

Plan actual
Mensual

Ver detalle
```

Estados visuales:

```text
🟢 Activa
🟠 Vence en 5 días
🟡 En período de gracia hasta [fecha]
🔴 Membresía vencida
⚫ Membresía suspendida
```

Cuando esté vencida mostrar:

> Tu cuenta y tus datos se mantienen disponibles. Renueva tu membresía para volver a recibir solicitudes.

El botón **Conectarme** debe quedar deshabilitado y mostrar el motivo. Incluir una acción visible **Renovar membresía** o **Ver opciones de renovación**, según el flujo de pago disponible.

Una membresía vencida, en gracia restringida o suspendida no debe bloquear:

- historial de viajes;
- ayuda y soporte;
- documentos;
- perfil;
- configuración;
- consulta del estado, plan e historial de membresía.

Backend debe impedir conexión y nuevas ofertas aunque un cliente antiguo o modificado intente omitir el bloqueo visual.

### Modelo prepago con viajes incluidos y uso adicional

Agregar al catálogo de membresías un modelo comercial parametrizable de **prepago + viajes incluidos + uso adicional diferido a la siguiente renovación**. Costa-Go no cobra el valor de las carreras ni recibe el pago del pasajero dentro de la aplicación; el pasajero paga directamente al conductor.

Valores iniciales propuestos, sujetos a aprobación y editables desde backend/panel:

```text
driver_base_membership_usd = 12.00
driver_included_trips = 120
driver_max_renewal_usd = 30.00
passenger_service_additional_usd = valor configurable ya existente
driver_extra_trip_share_percent = 40.00
driver_membership_cycle_duration_days = 30
```

No crear un segundo campo monetario para el costo por viaje adicional. El valor unitario utilizado para el excedente se deriva siempre del adicional/comisión por uso ya existente:

```text
extra_trip_fee = passenger_service_additional_usd × 40 %
```

Ejemplos:

| Adicional vigente por viaje | 40 % aplicado al excedente |
| ---: | ---: |
| USD 0,05 | USD 0,02 |
| USD 0,10 | USD 0,04 |
| USD 0,15 | USD 0,06 |
| USD 0,20 | USD 0,08 |

El porcentaje también debe ser configurable, con 40 % como valor inicial, pero no podrá cambiar ciclos activos. Tanto el adicional base como el porcentaje calculado se congelan al iniciar cada ciclo.

No compilar estos importes en la APK. Modelarlos dentro del plan y guardar una instantánea inmutable en cada ciclo. Una modificación administrativa afecta únicamente ciclos futuros y debe mostrar vista previa, fecha efectiva y auditoría.

Cada registro histórico de `driver_memberships` representará un ciclo comercial individual del conductor. Ampliarlo con instantáneas equivalentes a:

- importe base;
- moneda;
- duración;
- viajes incluidos;
- costo por viaje adicional;
- renovación máxima;
- adicional informativo recibido del pasajero por viaje;
- viajes completados;
- viajes adicionales;
- excedente bruto y excedente facturable limitado;
- ajustes;
- próxima renovación estimada/final;
- fecha de cierre y motivo;
- orden/pago que abrió el ciclo;
- ciclo anterior del cual procede el excedente cobrado.

Cada conductor inicia su período según la fecha efectiva de activación. No asumir mes calendario.

#### Contabilización idempotente de viajes

Contabilizar exclusivamente viajes reales que hayan alcanzado la transición definitiva `COMPLETED`/`FINALIZADO` en producción. Excluir rechazados, cancelados, expirados, fallidos, duplicados, simulaciones, ambientes de prueba y estados intermedios.

Crear un ledger equivalente a `membership_cycle_trip_usages`, relacionado con ciclo y viaje, con constraint único por viaje contabilizable. La transición del viaje y el evento contable deben utilizar transacción/outbox o un mecanismo idempotente compatible con la arquitectura real. Reintentos, WebSocket, notificaciones o reconstrucciones de interfaz nunca incrementan el contador.

El ledger conservará:

- ciclo, viaje y conductor;
- fecha de finalización;
- posición secuencial dentro del ciclo;
- si estaba incluido o era adicional;
- tarifa adicional aplicable según snapshot;
- monto generado antes/después del tope;
- evento/origen e idempotency key;
- auditoría de reversión o ajuste.

#### Cálculo del uso adicional

Backend será la única fuente de verdad:

```text
extra_trips = MAX(0, completed_trips - included_trips_snapshot)
extra_trip_fee_snapshot = ROUND_RATE_4_DECIMALS(
  passenger_service_additional_snapshot * extra_trip_share_percent_snapshot / 100
)
raw_extra_amount = ROUND_MONEY(extra_trips * extra_trip_fee_snapshot)
max_extra_amount = MAX(0, max_renewal_snapshot - base_amount_snapshot)
billable_extra_amount = MIN(raw_extra_amount, max_extra_amount)
estimated_next_renewal = CLAMP(
  base_amount_snapshot + billable_extra_amount + adjustments,
  0,
  max_renewal_snapshot
)
```

Aplicar aritmética decimal exacta y reglas explícitas de redondeo monetario. Conservar al menos cuatro decimales en la tarifa derivada y redondear el acumulado a la moneda; nunca usar `double/float` como fuente financiera.

Entre 0 y 120 viajes del ejemplo no existe excedente. Desde el viaje 121 se acumula por viaje el 40 % del adicional vigente congelado en el ciclo. Con un adicional de USD 0,10, el resultado es USD 0,04. Al llegar al tope de USD 30, continuar contabilizando la actividad y los viajes adicionales, pero mantener congelado el excedente facturable. El conductor no será bloqueado ni dejará de recibir solicitudes por alcanzar el máximo.

Ejemplo:

```text
245 viajes completados
120 incluidos
125 adicionales × USD 0.04 = USD 5.00
Base siguiente ciclo = USD 12.00
Próxima renovación estimada = USD 17.00
```

La interfaz debe separar siempre:

```text
Plan mensual               USD 12.00
Uso adicional del período USD  5.00
Total próxima renovación  USD 17.00
```

No comunicar que la tarifa base aumentó a USD 17.

#### Adicional recibido directamente del pasajero

El parámetro `passenger_service_additional_usd` es exactamente el campo de comisión/adicional por uso ya existente en tarifas, backend, panel, payload y base de datos. No crear, migrar ni sumar otro concepto equivalente. Puede valer USD 0,05, 0,10, 0,15, 0,20 u otro importe autorizado en el futuro.

Este valor forma parte del precio pagado directamente al conductor según las reglas tarifarias del viaje, pero no es dinero recibido, retenido ni cobrado automáticamente por Costa-Go. Para la membresía, únicamente se usa como base de referencia para calcular el 40 % aplicable a cada viaje adicional después del cupo incluido.

Cuando administración modifique el valor o el porcentaje, aplicar la nueva condición solamente a viajes/ciclos futuros según fecha efectiva. No alterar viajes históricos, ciclos activos ni cotizaciones ya emitidas.

Mostrar al conductor una métrica informativa:

```text
passenger_additional_received_estimate = completed_trips * passenger_service_additional_snapshot
```

Con 245 viajes y USD 0,10:

```text
Adicional recibido directamente de pasajeros: USD 24.50
```

Incluir el texto:

> Este valor lo recibes directamente de tus pasajeros. Costa-Go no lo cobra ni lo retiene automáticamente.

No registrar esta métrica como pago, ingreso, cuenta por cobrar, liquidación de punto ni comisión de Costa-Go. Mantenerla fuera de los KPIs financieros de membresías y recaudación.

La tarifa definitiva del viaje debe guardar su propio snapshot para auditoría. El indicador del ciclo utilizará la regla comercial congelada correspondiente y deberá poder reconciliarse con los viajes incluidos en el ledger.

#### Cierre del ciclo y orden de renovación

Durante el ciclo, mostrar **Próxima renovación estimada** porque el monto puede seguir creciendo. Al alcanzar la fecha final:

1. permitir terminar cualquier viaje activo sin interrupción;
2. finalizar de forma idempotente los viajes ya completados dentro del período;
3. congelar contador, excedente, ajustes y total del ciclo;
4. cerrar el ciclo;
5. generar o actualizar una única orden de renovación con snapshots;
6. iniciar la gracia configurada;
7. notificar importe final y fecha límite.

La orden deberá desglosar plan/base del nuevo ciclo, uso adicional congelado del ciclo anterior, ajustes/bonificaciones, total a pagar e identificador del ciclo origen.

Al confirmarse el pago mediante cualquiera de los canales definidos:

```text
parte base → activa el nuevo ciclo prepago
parte de uso adicional → liquida el excedente del ciclo anterior
```

Crear el ciclo siguiente con contadores en cero y las condiciones comerciales vigentes para ese nuevo ciclo. Nunca borrar ni recalcular retrospectivamente el ciclo anterior.

Debido a que el monto es variable hasta el cierre, en la primera implementación no permitir confirmar anticipadamente una orden financiera definitiva del siguiente ciclo. Antes del vencimiento se mostrará una estimación y se podrá preparar el método de pago; la orden cobrable se congela al cerrar el ciclo. Cualquier futura renovación anticipada requerirá una regla explícita de conciliación para viajes completados después del pago.

Si cambia la tarifa base para ciclos futuros, informar antes de crear la orden definitiva y mostrar por separado la nueva base y el excedente histórico. No aplicar silenciosamente condiciones nuevas al ciclo que termina.

#### Impago y relación con la gracia

Nunca interrumpir un viaje activo por vencimiento. Al cerrar el ciclo sin pago:

- mantener acceso a sesión, perfil, historial, documentos, soporte, detalle y pago;
- entrar en la política de gracia aplicable;
- permitir o no nuevas solicitudes según `grace_allows_trips_applied`;
- al terminar la gracia sin pago, backend impide ponerse online y recibir nuevas solicitudes;
- conservar cuenta, información y orden pendientes.

Agregar un parámetro compatible con las políticas existentes:

```text
driver_membership_grace_period_hours
```

No crear una segunda lógica de gracia: este valor se resolverá mediante las campañas globales, por cooperativa o conductor ya definidas. La gracia inicial de incorporación y la gracia de renovación son motivos distintos y no se acumulan automáticamente.

#### Experiencia del conductor

La tarjeta de membresía debe mostrar ciclo actual, viajes realizados, incluidos y adicionales, uso adicional, próxima renovación estimada y barra de progreso.

Después del umbral mostrar viajes adicionales e importe acumulado. Al alcanzar el máximo:

> Renovación máxima alcanzada: USD 30,00. Puedes continuar realizando viajes normalmente. No se generarán cargos adicionales durante este ciclo.

La opción **Ver detalle** incluirá viajes completados, incluidos, adicionales, costo unitario, excedente bruto, tope, ajustes, total, fecha de cierre/renovación y adicional informativo recibido del pasajero.

Permitir consultar ciclos anteriores con el cálculo histórico y el pago asociado, sin exponer datos financieros internos innecesarios.

#### Notificaciones del ciclo

Configurar umbrales sin notificar en cada viaje:

- porcentaje de viajes incluidos, inicialmente 80 % y 100 %;
- montos acumulados, por ejemplo USD 5, 10 y 15;
- máximo alcanzado;
- días/horas antes del cierre;
- inicio y final de gracia;
- pago y nuevo ciclo activado.

Las notificaciones deben usar el snapshot del ciclo, deduplicarse y mostrarse mediante burbuja in-app o push según el estado de la aplicación.

#### Panel, filtros y configuración

Dentro de **Conductores > Membresías**, agregar ciclo/estado, fechas, días restantes, viajes completados/incluidos/adicionales, excedente, renovación estimada/final, último pago, gracia, tope alcanzado, cooperativa y zona.

Parámetros administrables:

```text
base_membership_amount
included_trips
max_renewal_amount
passenger_service_additional
extra_trip_share_percent
cycle_duration_days
grace_period_hours
warning_trip_percentages
warning_extra_amounts
```

Validar combinaciones inválidas, por ejemplo máximo menor que la base, valores negativos, moneda inconsistente o duración cero. Toda modificación requiere permiso, fecha efectiva y auditoría; ciclos activos conservan su snapshot.

#### Ajustes, condonaciones y auditoría

Crear un ledger equivalente a `membership_cycle_adjustments` para bonificación, descuento, condonación de excedente, ajuste positivo/negativo y reversión de un viaje contabilizado.

Exigir importe, motivo, usuario, fecha, permiso y referencia relacionada. No editar directamente contadores o saldos. Aplicar límites y confirmación adicional a ajustes positivos. Las cortesías y condonaciones no deben registrarse como ingresos.

Registrar eventos como:

```text
MEMBERSHIP_CYCLE_CREATED
MEMBERSHIP_TRIP_COUNTED
MEMBERSHIP_TRIP_REVERSED
MEMBERSHIP_EXTRA_ACCRUED
MEMBERSHIP_EXTRA_CAP_REACHED
MEMBERSHIP_CYCLE_CLOSED
MEMBERSHIP_CYCLE_ADJUSTED
MEMBERSHIP_EXTRA_WAIVED
MEMBERSHIP_RENEWAL_ORDER_CREATED
MEMBERSHIP_PAYMENT_DUE
MEMBERSHIP_SUSPENSION_SCHEDULED
MEMBERSHIP_SUSPENSION_DEFERRED_ACTIVE_TRIP
MEMBERSHIP_SUSPENDED_NON_PAYMENT
MEMBERSHIP_SUSPENSION_CANCELLED_BY_PAYMENT
MEMBERSHIP_REACTIVATED_AFTER_PAYMENT
```

Debe poder reconstruirse exactamente por qué una renovación terminó en USD 12, 17, 22, 28 o 30 sin depender únicamente del saldo final.

#### Migración y activación progresiva

Inspeccionar primero membresías, tarifas de viaje, estados y datos existentes. Migrar de manera aditiva:

- definir fecha de inicio del nuevo modelo;
- respetar membresías vigentes;
- no inventar excedentes previos;
- crear el primer ciclo con procedencia `MIGRATION` y snapshots aprobados;
- decidir si el primer ciclo comienza al desplegar o al próximo pago;
- ejecutar simulación y vista previa por conductor/cooperativa;
- mantener enforcement desactivado durante validación.

Agregar un feature flag específico equivalente a:

```text
membership_usage_billing_enabled
```

Permitir activación gradual por zona o cooperativa. El rollback funcional desactiva el cómputo para nuevos eventos sin eliminar el ledger ya creado; cualquier corrección posterior debe ser auditada.

## 4. Avisos de caducidad

Parámetros iniciales:

- `membership_expiry_notice_days = 5`;
- `membership_grace_days = 2`;
- `membership_grace_allows_trips = true`;
- `membership_suspension_time = 07:00`;
- `membership_timezone = America/Guayaquil`.

Deben ser configurables desde el panel. La configuración inicial concede dos días completos de gracia y programa la suspensión por falta de pago a las 07:00 del día siguiente al último día permitido. La tarjeta mostrará claramente la fecha final de gracia, la hora de suspensión y si puede recibir solicitudes.

### Políticas y campañas de período de gracia

El período de gracia no debe limitarse a un único número global. Preparar políticas con tres alcances:

- `ALL`: todos los conductores elegibles;
- `COOPERATIVE`: únicamente conductores de una cooperativa seleccionada;
- `DRIVER`: concesión excepcional para un conductor específico.

Ejemplos admitidos:

```text
Campaña agosto
Alcance: ALL
Gracia: 3 días
Aplicable a membresías que vencen dentro del período definido

Campaña septiembre
Alcance: COOPERATIVE
Cooperativa: [identificador]
Gracia: 2 días
Aplicable únicamente a sus conductores
```

Prioridad cuando coincidan varias políticas:

```text
DRIVER > COOPERATIVE > ALL > configuración global predeterminada
```

Los días no se suman entre políticas. Se aplica una sola política, la más específica y vigente. Si existe más de una con el mismo alcance, resolver mediante prioridad explícita y luego por la política más reciente, rechazando configuraciones ambiguas desde el panel.

Cada política debe permitir:

- nombre y motivo;
- alcance;
- cooperativa o conductor objetivo cuando corresponda;
- cantidad de días de gracia;
- permitir o no conexión/recepción de viajes durante la gracia;
- fecha de inicio y fin de la campaña;
- ventana de fechas de vencimiento a la que se aplica;
- estado activa, pausada o finalizada;
- prioridad;
- creador, aprobador y auditoría.

Antes de activar una campaña, mostrar vista previa con:

- cantidad de conductores afectados;
- cooperativas incluidas;
- membresías por estado;
- fechas estimadas de finalización de gracia;
- conductores con otra política más específica;
- impacto operacional y, cuando aplique, económico.

La aplicación de la política debe producir una asignación histórica sobre la membresía:

- `grace_policy_id`;
- `grace_days_applied`;
- `grace_ends_at`;
- `grace_allows_trips_applied`;
- fecha y responsable de aplicación.

Una vez concedida la gracia, cambiar o finalizar la política no debe acortar retroactivamente el período ya otorgado. La revocación individual deberá ser una acción explícita, autorizada, confirmada y auditada.

Activar una política para `ALL` no debe reactivar automáticamente membresías suspendidas por seguridad, fraude, documentos vencidos o sanción. Tampoco debe revivir membresías vencidas antiguas salvo que el administrador seleccione expresamente una operación de regularización con vista previa.

La política de gracia es independiente de los días de aviso de vencimiento. Por ejemplo, puede notificarse cinco días antes y concederse posteriormente una gracia de tres días.

### Gracia inicial para conductores nuevos

Separar la aprobación documental de la habilitación comercial:

```text
Registro
→ Pendiente de documentos
→ Pendiente de revisión
→ Conductor aprobado
→ Membresía pendiente de activación
→ Pago o gracia inicial
→ Puede conectarse y recibir solicitudes
```

Al aprobar un conductor nuevo, backend debe evaluar una política configurable de incorporación. Si está habilitada, puede conceder un período inicial equivalente a:

```text
membership_status = GRACE_PERIOD
grace_reason = NEW_DRIVER_ONBOARDING
payment_id = null
```

Configuración prevista:

- activada o desactivada;
- duración expresada en horas o días;
- alcance `ALL`, `COOPERATIVE` o `DRIVER`;
- fecha de inicio y fin de la campaña de incorporación;
- permitir o no conexión y recepción de solicitudes;
- cantidad máxima de concesiones por identidad, inicialmente una;
- recordatorios y canales;
- prioridad respecto de otras políticas de gracia;
- creador, aprobador y auditoría.

Configuración inicial propuesta, sujeta a aprobación operativa:

```text
new_driver_grace_enabled = true
new_driver_grace_duration = 2 days
new_driver_grace_allows_trips = true
new_driver_grace_max_grants = 1
```

El conductor aprobado conserva acceso a perfil, documentos, soporte, historial y pantalla de membresía. Sin pago ni una gracia que permita viajes, el botón **Conectarme** permanece deshabilitado.

Durante la gracia mostrar claramente:

> Tu cuenta fue aprobada. Tienes 2 días de acceso de cortesía para comenzar a recibir solicitudes. Activa tu membresía antes del [fecha y hora] para continuar conectado.

Enviar recordatorios configurables al concederla, cuando falte un día, cuando falten seis horas y al finalizar, evitando duplicados entre push, correo y notificación interna.

La gracia inicial:

- no constituye un pago;
- no genera ingresos ni comisión de recaudación;
- no crea una orden financiera automáticamente;
- no debe presentarse como membresía pagada;
- termina automáticamente y deshabilita nuevas solicitudes si no existe pago;
- nunca elimina ni bloquea la cuenta completa;
- no sustituye la aprobación ni ignora documentos, seguridad o sanciones.

Si el conductor paga antes de terminar la gracia, la vigencia pagada debe conservar el beneficio ya otorgado:

```text
base_date = MAX(now, current_valid_until, grace_until)
new_valid_until = add_duration(base_date, paid_plan_duration)
```

La renovación debe ejecutarse mediante la orden y el servicio financiero central. La gracia se registra como finalizada por activación pagada, conservando su historial y sin inventar un `payment_id`.

Prevenir abuso vinculando la concesión a la identidad real y al historial del conductor, no únicamente al correo o al dispositivo. Eliminar y recrear una cuenta, cambiar correo, teléfono o dispositivo no debe restablecer automáticamente la gracia. Cualquier segunda concesión exige permiso excepcional, motivo y auditoría.

### Horario efectivo de suspensión por falta de pago

Separar el vencimiento comercial del ciclo y el instante efectivo de bloqueo operativo. Nunca suspender automáticamente a las 00:00.

Parámetros administrables:

```text
driver_membership_grace_period_days = 2
driver_membership_suspension_time = 07:00
driver_membership_timezone = America/Guayaquil
```

Definir `expiration_local_date` como el último día de vigencia normal en la zona horaria configurada. Calcular:

```text
last_grace_local_date = expiration_local_date + grace_period_days
suspension_local_date = last_grace_local_date + 1 day
suspension_at = local_datetime(
  suspension_local_date,
  configured_suspension_time,
  configured_timezone
).to_utc()
```

Ejemplo con dos días:

```text
Vencimiento:             31/08/2026
Gracia completa:         01/09/2026 y 02/09/2026
Pago pendiente:          03/09/2026 00:00–06:59
Suspensión efectiva:     03/09/2026 07:00
```

Ejemplo sin gracia:

```text
Vencimiento:             31/08/2026
Pago pendiente:          01/09/2026 00:00–06:59
Suspensión efectiva:     01/09/2026 07:00
```

Almacenar el instante definitivo en UTC y conservar también zona horaria, hora y política/snapshot que lo originaron. Las interfaces presentan la fecha/hora local. No calcular la suspensión en la APK.

Estados operativos diferenciados:

```text
ACTIVE
EXPIRING
GRACE_PERIOD
PAYMENT_DUE
SUSPENSION_PENDING_ACTIVE_TRIP
SUSPENDED_NON_PAYMENT
```

`PAYMENT_DUE` corresponde al intervalo posterior al último día permitido y anterior a `suspension_at`. Durante ese intervalo el conductor continúa operativo, pero recibe una advertencia clara de que el bloqueo está programado.

`SUSPENDED_NON_PAYMENT` no desactiva ni elimina la cuenta. El conductor conserva inicio de sesión, perfil, historial, documentos, soporte, ciclos, deuda y opciones de pago; únicamente pierde la capacidad de ponerse online y recibir nuevas solicitudes.

#### Viaje activo al llegar la suspensión

Si al alcanzar `suspension_at` existe un viaje en `ACCEPTED`, `EN_ROUTE_TO_PICKUP`, `ARRIVED`, `IN_PROGRESS` u otro estado operativo equivalente:

- no cancelar ni interrumpirlo;
- marcar `SUSPENSION_PENDING_ACTIVE_TRIP`;
- impedir que se asigne una nueva solicitud adicional;
- permitir completar normalmente el viaje actual;
- volver a comprobar pago y elegibilidad al finalizar;
- si continúa impago, aplicar inmediatamente `SUSPENDED_NON_PAYMENT`.

El backend debe ser la fuente definitiva. La tarjeta, realtime o aplicación móvil no pueden mantener operativo al conductor omitiendo esta regla.

#### Pago antes o después de la suspensión

Si el pago se confirma antes de `suspension_at`, la misma transacción/servicio central debe cerrar el período anterior, activar el nuevo ciclo y cancelar de forma idempotente la suspensión pendiente. El scheduler vuelve a consultar el estado antes de actuar.

Si el pago se confirma después de estar `SUSPENDED_NON_PAYMENT`, reactivar inmediatamente la recepción de solicitudes siempre que conductor, documentos, seguridad y cuenta continúen elegibles. Registrar fecha/hora y causa de reactivación; no requerir intervención administrativa ordinaria.

Una evidencia o transferencia `PENDING_VERIFICATION` no cancela la suspensión. Únicamente un pago `CONFIRMED`, una cortesía autorizada o una política de gracia vigente puede mantener/reactivar la operación.

#### Scheduler y defensa en línea

Implementar un job durable en backend que:

1. seleccione membresías cuyo `suspension_at` ya fue alcanzado;
2. bloquee o reclame cada registro de forma segura;
3. vuelva a comprobar pago, gracia, elegibilidad y estado;
4. detecte viaje activo;
5. suspenda o marque suspensión pendiente;
6. registre auditoría/outbox;
7. evite duplicados y pueda reintentarse.

No depender de que la aplicación esté abierta ni de una instancia web siempre activa. Ejecutar mediante el scheduler/worker fiable disponible en producción y monitorear retrasos.

Además, cada operación crítica de conexión, puesta online, entrega y aceptación de ofertas debe evaluar la elegibilidad actual. Esta defensa evita que un retraso del job permita seguir recibiendo solicitudes después de `suspension_at`.

#### Cambios administrativos del horario

- días de gracia y permiso para recibir viajes se congelan mediante la política aplicada y nunca se acortan retroactivamente sin una revocación individual autorizada;
- cambios de hora o zona pueden recalcular suspensiones futuras aún no ejecutadas;
- un cambio que adelante el bloqueo exige fecha efectiva futura, vista previa y aviso, evitando suspender inesperadamente el mismo día;
- un cambio que lo retrase puede aplicarse a suspensiones futuras pendientes;
- estados ya suspendidos no se reactivan solo por cambiar el horario;
- toda recalculación guarda valores anteriores, nuevos, administrador, fecha y motivo.

Panel y app deben mostrar:

```text
Vencimiento             31/08/2026
Gracia hasta            02/09/2026
Suspensión programada   03/09/2026 07:00
```

Mensajes de la app deben ser informativos y no indicar eliminación de cuenta. El último día de gracia se advertirá que puede pagar durante todo el día y que dejará de recibir nuevas solicitudes a la hora programada del día siguiente.

Cinco días antes del vencimiento:

- cambiar estado calculado a `EXPIRING`;
- notificación in-app al conductor;
- notificación push;
- correo electrónico;
- alerta en el panel administrativo.

Al vencer, cambiar al estado de gracia o pago pendiente correspondiente sin bloquear a medianoche. Al alcanzar `suspension_at`, aplicar `SUSPENDED_NON_PAYMENT` conforme a las reglas anteriores, avisar cómo renovar y mantener historial, perfil, documentos y viajes anteriores accesibles.

Evitar avisos duplicados. Registrar qué recordatorios fueron enviados por canal y período de membresía. Preparar avisos configurables adicionales, por ejemplo 15, 7, 5, 3 y 1 día, sin enviar todos de forma predeterminada.

## 5. Acciones en el panel

Agregar debajo de **Conductores** el submenú **Membresías**, validado mediante permisos backend.

Dashboard inicial:

```text
Membresías activas
Vencen en los próximos 7 días
En período de gracia
Vencidas
Suspendidas
Cubiertas por cooperativas
Individuales
Ingresos confirmados del mes
```

Indicadores adicionales recomendados:

- renovaciones pendientes de confirmar;
- renovaciones realizadas este mes;
- tasa de renovación;
- membresías que vencen en 7, 15 y 30 días;
- distribución mensual, trimestral y anual;
- ingresos por plan y por cooperativa;
- pagos pendientes, anulados o reembolsados si existe módulo de cobro;
- conductores aprobados sin membresía activa;
- conductores bloqueados exclusivamente por vencimiento;
- proyección del próximo mes, claramente diferenciada de ingresos reales.

Los ingresos deben calcularse solamente con pagos confirmados. No sumar como ingreso una membresía creada, prometida o pendiente. Si inicialmente el pago se registra manualmente, exigir referencia, fecha, método, responsable y auditoría.

La pantalla debe incluir filtros por estado, plan, fecha de vencimiento, cooperativa y responsable de cobertura; tabla paginada; exportación autorizada; y acceso al historial completo del conductor.

En la ficha/listado del conductor incorporar:

- Asignar plan.
- Crear el estado inicial de membresía al aprobar al conductor y aplicar, si corresponde, gracia de incorporación; no inventar un pago.
- Renovar mensual, trimestral o anual.
- Suspender membresía.
- Reactivar membresía.
- Consultar historial de renovaciones.
- Filtrar por activa, próxima a vencer, vencida o suspendida.
- Definir si la cobertura es individual o de cooperativa.
- Registrar pago/renovación confirmado con referencia.
- Conceder o retirar período de gracia con permiso específico.
- Crear campañas de gracia para todos, una cooperativa o un conductor.
- Previsualizar afectados antes de activar una campaña de gracia.
- Renovar en lote a conductores cubiertos por una cooperativa, con vista previa y confirmación.

La acción existente de suspensión debe presentarse claramente, pero sin mezclar:

- suspensión de aprobación/conductor por seguridad o cumplimiento;
- suspensión de membresía por decisión administrativa;
- vencimiento automático de la membresía.

Toda acción debe exigir confirmación, permiso backend y registro de auditoría.

## 6. Persistencia propuesta

Evitar guardar solamente una fecha en `drivers`. Preparar una entidad de historial equivalente a `driver_memberships` con:

- id;
- driver_id;
- plan;
- status;
- starts_at;
- expires_at;
- expiration_local_date;
- grace_ends_at;
- last_grace_local_date;
- suspension_at;
- suspension_timezone_snapshot;
- suspension_local_time_snapshot;
- suspension_pending_active_trip;
- suspended_non_payment_at;
- reactivated_after_payment_at;
- grace_policy_id;
- grace_days_applied;
- grace_allows_trips_applied;
- previous_membership_cycle_id;
- plan_snapshot;
- cycle_duration_snapshot;
- base_membership_amount_snapshot;
- included_trips_snapshot;
- extra_trip_fee_snapshot;
- extra_trip_share_percent_snapshot;
- max_renewal_amount_snapshot;
- passenger_service_additional_snapshot;
- completed_trips;
- extra_trips;
- raw_extra_amount;
- billable_extra_amount;
- adjustment_amount;
- estimated_next_renewal_amount;
- final_renewal_amount;
- cycle_closed_at;
- cycle_close_reason;
- opening_payment_id;
- renewal_order_id;
- payer_type;
- cooperative_id, cuando la cobertura corresponda a una cooperativa;
- amount;
- currency;
- payment_status;
- payment_method;
- payment_reference;
- paid_at;
- renewed_at;
- suspended_at;
- suspension_reason;
- created_by;
- updated_by;
- created_at;
- updated_at.

Agregar `membership_cycle_trip_usages` como ledger idempotente de viajes contabilizados, con relación única al viaje y ciclo, clasificación incluido/adicional, importes según snapshot y trazabilidad de reversión.

Agregar `membership_cycle_adjustments` como ledger de bonificaciones, descuentos, condonaciones y ajustes autorizados. Los contadores e importes derivados de `driver_memberships` deben poder reconstruirse a partir de viajes, snapshots y ajustes.

Agregar una entidad histórica equivalente a `membership_grace_policies` para campañas globales, por cooperativa o por conductor, con alcance, objetivo, fechas, días, política de conexión, prioridad, estado y auditoría. No almacenar estas campañas como condiciones hardcodeadas en la aplicación móvil.

La fuente de verdad para habilitar viajes debe estar en backend. El frontend únicamente representa el resultado.

## 7. Órdenes de pago, recaudación y verificación humana

Este módulo manejará dinero y habilitará o deshabilitará la recepción de viajes. Debe implementarse como funcionalidad crítica, con trazabilidad completa y despliegue progresivo. No se integrará inicialmente una pasarela automática.

Principio rector:

> Mientras no exista integración bancaria, el dinero se verifica por una persona autorizada; después de esa confirmación legítima, Costa-Go procesa de forma atómica el pago, la renovación, la auditoría y la notificación.

Un QR, una captura o un comprobante cargado representan únicamente una solicitud u orden pendiente. Ninguno activa la membresía por sí solo.

### Modelo y reglas centrales

Mantener las responsabilidades separadas:

- `membership_plans`: catálogo parametrizable de planes;
- `driver_memberships`: historial y vigencia efectiva de cada conductor;
- `membership_payment_orders`: intención de pago inmutable y temporal;
- `membership_payments`: registro definitivo de un cobro aprobado;
- `membership_transfer_proofs`: evidencia privada de transferencias remotas;
- `collection_points`: puntos autorizados de recaudación;
- `collector_assignments`: relación entre recaudadores y puntos;
- `cash_closures`: cierres operativos, sin pretender reemplazar contabilidad formal;
- `cooperative_payment_batches`: pago agrupado futuro de cooperativas y sus renovaciones individuales.

No crear una tabla alternativa de suscripciones. El modelo conceptual `driver_subscription` del documento adjunto se integra en `driver_memberships`, ya definido en este borrador.

Los planes deben admitir como mínimo:

- código único;
- nombre;
- importe y moneda;
- unidad y duración, por ejemplo mensual, trimestral, anual o días configurables;
- estado activo/inactivo;
- vigencia comercial del precio;
- reglas de elegibilidad;
- creador, modificador y auditoría.

Al crear una orden se debe copiar una instantánea inmutable del plan: código, nombre, importe, moneda, duración y reglas económicas aplicadas. Cambiar posteriormente el catálogo no modifica órdenes ni pagos históricos.

La renovación anticipada debe conservar el tiempo pagado:

```text
base_date = MAX(now, current_valid_until)
new_valid_until = add_duration(base_date, order.plan_duration_snapshot)
```

Si la membresía está vencida, `base_date = now`. Todas las fechas se calculan en backend usando la zona horaria operativa configurada y se almacenan de manera consistente.

### Métodos y canales

Métodos iniciales:

- `CASH`;
- `DEUNA`;
- `BANK_TRANSFER`;
- `COOPERATIVE`;
- `COURTESY`.

Separar el **método** del **canal de verificación**. Una transferencia verificada presencialmente continúa siendo `BANK_TRANSFER`; su canal puede ser `COLLECTION_POINT`, mientras una transferencia remota puede usar `REMOTE_PROOF`. Esto evita introducir un método contradictorio como `BANK_TRANSFER_VERIFIED`.

Separar además quién recibió el dinero:

- `receiver_scope = COLLECTION_POINT`: el punto recibió el dinero y luego debe liquidarlo a Costa-Go;
- `receiver_scope = COSTA_GO_CENTRAL`: el dinero fue enviado directamente a una cuenta central;
- `receiver_scope = NOT_APPLICABLE`: cortesía u operación no monetaria.

Los nombres comerciales del anexo se normalizan así:

| Flujo visible | method | receiver_scope | verification_channel |
| --- | --- | --- | --- |
| `CASH_COLLECTION_POINT` | `CASH` | `COLLECTION_POINT` | `IN_PERSON` |
| `DEUNA_COLLECTION_POINT` | `DEUNA` | `COLLECTION_POINT` | `COLLECTION_POINT` |
| `TRANSFER_COLLECTION_POINT` | `BANK_TRANSFER` | `COLLECTION_POINT` | `COLLECTION_POINT` |
| `BANK_TRANSFER_CENTRAL` | `BANK_TRANSFER` | `COSTA_GO_CENTRAL` | `REMOTE_PROOF` |

Esta normalización mantiene clara la experiencia del usuario sin convertir cada combinación de canal y receptor en un método financiero diferente.

Dejar extensible el catálogo para proveedores futuros como `PAYPHONE`, `KUSHKI`, `GOOGLE_PLAY` u otros, sin alterar el servicio central de renovación. No integrar ninguno en esta entrega.

### Estados de órdenes y pagos

Estados de la orden:

```text
PENDING
PENDING_VERIFICATION
PAID
REJECTED
EXPIRED
CANCELLED
```

Estados del pago definitivo:

```text
CONFIRMED
REVERSED
```

El pago del conductor y la liquidación del punto son estados independientes. Agregar `settlement_status` al pago:

```text
NOT_APPLICABLE
PENDING_SETTLEMENT
PARTIALLY_SETTLED
SETTLED
DISPUTED
CANCELLED
```

Un pago recibido por un punto puede estar `CONFIRMED` y renovar inmediatamente la membresía, mientras su liquidación permanece `PENDING_SETTLEMENT`. Un pago recibido directamente por Costa-Go utiliza `NOT_APPLICABLE` porque no existe deuda posterior del punto.

Una reversión no elimina el registro original ni modifica fechas silenciosamente. Debe ser una operación administrativa excepcional, autorizada, auditada y con una política explícita sobre la vigencia ya concedida.

Toda renovación debe recorrer el mismo camino:

```text
payment_order → verified payment → driver_membership
```

No permitir editar libremente `valid_until` desde el panel. Pagos con QR, búsqueda manual, transferencia aprobada, cortesía, cooperativa y futuras pasarelas deben finalizar en un único servicio transaccional equivalente a `processMembershipPayment(...)`.

### Orden y QR seguros

La orden debe contener como mínimo:

- id interno;
- token público opaco;
- conductor;
- plan e instantánea del plan;
- importe y moneda;
- intención/canal;
- estado;
- fechas de creación, expiración, pago, rechazo o cancelación;
- creador;
- metadatos controlados;
- claves de idempotencia cuando correspondan.

El token debe ser criptográficamente aleatorio, no secuencial, suficientemente largo y de un solo uso para aprobación. Preferir almacenar su hash y comparar de manera segura, evitando conservar el token público en texto cuando la arquitectura lo permita.

El QR contendrá únicamente una URL HTTPS equivalente a:

```text
https://costa-go.com/collector/payment/<opaque_token>
```

No incluir cédula, nombre, `driver_id`, monto, días ni parámetros editables. El código corto visual será solamente una referencia para búsqueda controlada y nunca autorizará por sí mismo el pago.

La duración del QR será configurable; referencia inicial: 24 horas. Expirar una orden conserva su historial. Un QR pagado muestra estado, fecha y método permitido, pero nunca vuelve a presentar el botón de confirmación.

### Flujo del conductor

En **Membresía Costa-Go**, además del estado ya definido, mostrar:

- plan actual;
- fecha de inicio y vencimiento;
- días restantes;
- importe y período de renovación;
- último pago y su estado;
- acceso a **Mis pagos**;
- acción **Renovar membresía**.

Al renovar ofrecer inicialmente:

- **Pagar en punto autorizado**: backend crea orden `PENDING` y la app muestra QR, código corto, plan, importe y vencimiento del QR;
- **Transferencia bancaria**: backend muestra las cuentas activas configuradas y permite enviar evidencia, dejando la orden en `PENDING_VERIFICATION`.

Los datos bancarios deben proceder del backend, poder activarse/desactivarse y cambiar sin publicar otra APK. Mostrar exclusivamente los datos necesarios para efectuar el pago.

Para transferencia remota solicitar:

- banco de origen;
- referencia;
- fecha;
- valor declarado;
- comprobante;
- observación opcional.

La interfaz debe informar claramente **Pago pendiente de verificación**. Cargar o reemplazar el comprobante nunca habilita la membresía.

### Portal de recaudación

Crear un portal web `mobile-first`, separado visual y funcionalmente del panel completo, accesible desde Android, iPhone, tablet y escritorio.

Agregar rol o perfil operativo `COLLECTOR` con permisos granulares, sin conceder privilegios administrativos. Menú previsto:

- Inicio;
- Escanear QR;
- Buscar conductor;
- Pagos de hoy;
- Transferencias pendientes, únicamente con permiso;
- Cierre de caja;
- Mi perfil;
- Salir.

El recaudador podrá abrir el QR con la cámara normal o escanearlo desde el portal. Si no existe sesión, el login conservará un `returnUrl` interno firmado/validado y regresará al detalle de la orden. Rechazar URLs externas o no autorizadas para impedir redirecciones abiertas.

El detalle previo a confirmar debe mostrar información suficiente y enmascarada:

- conductor;
- identificación parcialmente oculta;
- placa;
- cooperativa;
- vigencia actual;
- plan;
- monto inmutable;
- nueva fecha estimada calculada por backend;
- estado y expiración de la orden.

Para confirmar, seleccionar método autorizado y mostrar un diálogo explícito indicando que la acción renovará la membresía. El recaudador confirma que recibió efectivo, que DeUna aparece realmente en la cuenta receptora o que verificó la transferencia en el canal bancario. Una captura mostrada por el conductor no es evidencia suficiente.

Cuando corresponda, registrar referencia, banco, fecha, últimos caracteres del movimiento y observación, evitando almacenar datos innecesarios.

### Pago sin QR y pago administrativo

El recaudador puede buscar conductores por cédula, nombre, placa, teléfono o código interno, limitado por sus permisos y punto. Al elegir **Registrar pago**, backend crea primero una orden interna y utiliza la misma confirmación transaccional.

Administración podrá registrar pagos manuales con conductor, plan, método, referencia y observación, pero no modificar directamente la fecha de membresía. Este canal también crea una orden y utiliza el servicio central.

`COURTESY` requiere permiso de alto nivel, motivo obligatorio, duración/plan, responsable y, cuando aplique, referencia a una incidencia. Debe registrarse como operación no monetaria y no contabilizarse como ingreso.

### Transferencias pendientes y verificación humana

Crear una bandeja para operadores autorizados con filtros y paginación. Mostrar monto esperado frente a declarado, banco, referencia enmascarada, fecha, antigüedad, conductor, placa, cooperativa y acceso temporal protegido al comprobante.

Antes de aprobar, backend vuelve a validar:

- orden existente, vigente y en estado permitido;
- conductor y plan válidos;
- importe coincidente;
- referencia bancaria no reutilizada dentro del alcance definido;
- ausencia de pago previo;
- permiso y alcance del operador;
- membresía actual para calcular la nueva vigencia.

La aprobación se ejecuta en una sola transacción:

1. bloquear la orden;
2. crear el pago confirmado;
3. marcar la orden `PAID`;
4. crear/actualizar el historial de membresía;
5. registrar auditoría/outbox;
6. confirmar la transacción;
7. emitir notificación de forma idempotente.

Si falla cualquier paso, realizar rollback completo. La notificación no debe decidir el éxito financiero.

Rechazar exige motivo y comentario cuando corresponda:

- `TRANSFER_NOT_FOUND`;
- `WRONG_AMOUNT`;
- `DUPLICATE_RECEIPT`;
- `INVALID_RECEIPT`;
- `OTHER`.

El conductor podrá presentar una nueva evidencia según la política definida o crear otra orden. No sobrescribir la evidencia histórica rechazada.

No usar OCR como aprobador automático. Puede incorporarse posteriormente como ayuda visual o detección de inconsistencias, manteniendo siempre la confirmación humana mientras no exista integración bancaria confiable.

### Comprobantes y privacidad

Los comprobantes deben almacenarse en repositorio privado con:

- MIME real y extensión permitida;
- límite de tamaño configurable;
- nombre sanitizado;
- análisis de contenido cuando exista infraestructura;
- URLs temporales firmadas;
- autorización backend por cada consulta;
- retención y eliminación conforme a política legal/contable;
- auditoría de acceso sensible.

No exponer cédulas completas, tokens, IDs secuenciales, cuentas bancarias personales ni información de otros conductores. Los datos bancarios receptores de Costa-Go se muestran solo donde sean necesarios.

### Idempotencia y concurrencia

Requisitos obligatorios:

- constraint que impida más de un pago confirmado por orden;
- referencias bancarias normalizadas y protegidas contra reutilización accidental;
- bloqueo transaccional de la orden;
- transición condicional desde estado pendiente;
- idempotency key para confirmaciones/reintentos;
- una sola renovación y notificación ante solicitudes repetidas.

Si dos recaudadores confirman simultáneamente, uno procesa y el otro recibe `ALREADY_PAID`, junto con fecha y método permitido. Nunca deben existir dos pagos o dos ampliaciones de vigencia.

No confiar únicamente en un índice único global sobre una referencia breve: definir su alcance con método, banco/cuenta receptora y referencia normalizada, conservando revisión humana ante colisiones legítimas.

### Cooperativas y campañas de gracia

Preparar pagos agrupados por cooperativa sin mezclar esta función con las campañas de gracia:

- una operación comercial de cooperativa;
- lista congelada de conductores cubiertos;
- plan/período;
- importe, referencia y estado;
- renovaciones individuales enlazadas al lote;
- resultado individual y resumen del lote.

La gracia es una política temporal y no constituye un pago ni ingreso. Una cooperativa puede pagar membresías o recibir una campaña de gracia; ambos hechos deben permanecer diferenciados en reportes y auditoría.

La primera entrega puede limitar la interfaz de pagos agrupados, pero el esquema y servicio central no deben impedirla. Toda ejecución masiva debe presentar vista previa, ser reintentable de forma idempotente y registrar resultados por conductor.

### Puntos, caja y conciliación operativa

`collection_points` debe incluir nombre, código, dirección, zona, estado y auditoría. Un recaudador puede pertenecer a uno o varios puntos mediante asignaciones vigentes.

Registrar siempre punto, cobrador, sesión, fecha, método, importe y orden. El dashboard del recaudador mostrará únicamente su alcance:

- cobros del día;
- totales por efectivo, DeUna y transferencia;
- total operativo;
- pendientes autorizados;
- listado de operaciones.

El cierre de caja resumirá por usuario, punto, fecha y método. Debe admitir diferencias y observaciones con autorización; no debe presentarse como contabilidad financiera oficial.

Para DeUna y transferencias, diseñar una conciliación operativa posterior que permita marcar movimientos revisados sin alterar ni borrar el pago original.

### Cuentas receptoras del punto y cuentas centrales

Extender cada punto con métodos habilitados (`cash_enabled`, `deuna_enabled`, `bank_transfer_enabled`) y crear una entidad separada equivalente a `collection_point_payment_accounts` con:

- punto de recaudación;
- tipo `BANK_ACCOUNT`, `DEUNA` u otro futuro;
- banco y tipo de cuenta;
- número/identificador protegido;
- titular e identificación cuando corresponda;
- referencia o QR de DeUna;
- estado y vigencia;
- auditoría.

Mantener en otra entidad las cuentas centrales equivalentes a `costa_go_payment_accounts`, con tipo, banco, cuenta, titular, estado y habilitación para pagos remotos.

En el flujo presencial, mostrar únicamente el medio receptor del punto seleccionado. En el flujo remoto, mostrar únicamente una cuenta central activa de Costa-Go. No mezclar ni sustituir automáticamente una por otra.

Los datos completos se entregan solo al conductor dentro de la acción concreta de pago y a usuarios financieros autorizados. En listados administrativos usar enmascaramiento, por ejemplo `****4582`, y nunca escribir números completos en logs o Sentry.

Si un conductor llega a un punto con una transferencia previamente realizada a la cuenta central, `COLLECTOR` solo puede consultar/derivar la orden. No puede confirmarla porque no controla la cuenta receptora central. Debe permanecer `PENDING_VERIFICATION` hasta revisión de `FINANCE` o administración autorizada.

### Cierres y liquidaciones de puntos

Crear una entidad equivalente a `collection_point_closures` con:

- punto y recaudador responsable;
- inicio y fin del período;
- estado `OPEN`, `CLOSED`, `PENDING_SETTLEMENT`, `SETTLED` o `DISPUTED`;
- totales por efectivo, DeUna y transferencia;
- total bruto, comisión y neto;
- fechas de creación, cierre y liquidación;
- verificador, notas y auditoría.

Relacionar cada cierre con sus pagos mediante `collection_point_closure_payments`. Un constraint debe impedir que un pago forme parte de dos cierres. Después de cerrar, el recaudador no puede modificar libremente los pagos incluidos.

El cierre se genera a partir de pagos `CONFIRMED`, recibidos por ese punto, aún no incluidos en otro cierre y dentro del período autorizado. Los totales se calculan en backend; el cliente no los envía como fuente de verdad.

Crear `collection_point_settlements` para la entrega del dinero a Costa-Go:

- cierre y punto;
- bruto, comisión y neto como instantáneas;
- método de liquidación;
- referencia y comprobante privado;
- estado `PENDING`, `SUBMITTED`, `VERIFIED`, `REJECTED` o `DISPUTED`;
- fechas de presentación y verificación;
- verificador, notas y auditoría.

Al verificar una liquidación, una única transacción debe:

1. bloquear liquidación y cierre;
2. comprobar importes y estados;
3. marcar la liquidación `VERIFIED`;
4. marcar el cierre `SETTLED` cuando corresponda;
5. actualizar a `SETTLED` los pagos incluidos;
6. registrar auditoría/outbox.

Una liquidación o cierre no puede verificarse dos veces. Aplicar constraints, transiciones condicionales, bloqueos e idempotencia igual que en la confirmación del pago.

El flujo completo de un punto será:

```text
ORDEN → PAGO CONFIRMADO → MEMBRESÍA → CIERRE → LIQUIDACIÓN
```

El flujo de transferencia central será:

```text
ORDEN → VERIFICACIÓN CENTRAL → PAGO CONFIRMADO → MEMBRESÍA
```

### Comisiones del punto

Preparar comisiones sin activarlas inicialmente:

```text
commission_enabled = false
commission_type = NONE | FIXED_PER_PAYMENT | PERCENTAGE
commission_value = 0
```

La regla aplicable debe copiarse como instantánea en el cierre/liquidación para que un cambio futuro no altere operaciones históricas. Backend calcula:

```text
gross_amount - commission_amount = net_amount_to_costa_go
```

No permitir que el recaudador envíe o modifique el importe de la comisión. Las cortesías no generan comisión salvo una regla futura expresa.

### Deuda, alertas y límites por punto

La deuda del punto no afecta al conductor. Una vez que el pago presencial legítimo fue confirmado, la membresía permanece válida aunque el punto se retrase, entre en disputa o sea suspendido posteriormente.

Configurar:

- plazo máximo de liquidación, por ejemplo 24 o 48 horas;
- importe máximo pendiente;
- umbrales de alerta;
- destinatarios internos;
- acción al exceder el límite.

Por defecto, exceder un plazo o importe genera advertencias y marca el punto en riesgo, pero no bloquea automáticamente nuevos cobros. Una política futura podrá impedir nuevas recaudaciones con confirmación administrativa, fecha efectiva, notificación y auditoría. Suspender un punto impide nuevos cobros, pero no altera pagos ni membresías ya confirmados.

El dashboard debe mostrar por punto: recaudado, liquidado, pendiente, cierres abiertos/cerrados, antigüedad de deuda y alertas. La trazabilidad permitirá seguir:

```text
Pago → Cierre → Liquidación → Recepción Costa-Go
```

Admitir `PARTIALLY_SETTLED` en el modelo para evolución futura, pero no habilitar liquidaciones parciales en la primera interfaz si no existe una regla operativa aprobada.

### Panel administrativo, reportes e historial

Ampliar **Membresías** con:

- pagos del día e ingresos confirmados del mes;
- pendientes y rechazados;
- totales por método, punto, zona, cooperativa y recaudador;
- cortesías separadas de ingresos;
- filtros por fechas, estado, plan y alcance;
- exportación autorizada;
- historial de cada conductor;
- conciliación y cierres operativos.
- pagos directos recibidos por Costa-Go frente a pagos recibidos por puntos;
- dinero pendiente de liquidación;
- liquidaciones presentadas, verificadas, rechazadas o en disputa;
- efectivo, DeUna y transferencias retenidos en cada punto;
- deuda y antigüedad por punto;
- cuentas receptoras y métodos habilitados, protegidos por permisos.

El conductor podrá consultar **Mis pagos** con fecha, importe, plan, método y estado, sin exponer datos internos innecesarios del cobrador.

Los ingresos deben sumar únicamente pagos monetarios `CONFIRMED`; excluir órdenes pendientes, rechazadas, cortesías, proyecciones y operaciones revertidas.

### Permisos

Crear permisos backend equivalentes y adaptarlos a la matriz real existente:

- `MEMBERSHIP_VIEW`;
- `MEMBERSHIP_PLAN_MANAGE`;
- `PAYMENT_ORDER_CREATE`;
- `PAYMENT_COLLECT`;
- `PAYMENT_TRANSFER_REVIEW`;
- `PAYMENT_VIEW_OWN_POINT`;
- `PAYMENT_VIEW_ALL`;
- `PAYMENT_COURTESY_GRANT`;
- `PAYMENT_REVERSE`;
- `COLLECTION_POINT_MANAGE`;
- `CASH_CLOSURE_CREATE`;
- `CASH_CLOSURE_REVIEW`.
- `SETTLEMENT_CREATE`;
- `SETTLEMENT_REVIEW`;
- `SETTLEMENT_VIEW_OWN_POINT`;
- `SETTLEMENT_VIEW_ALL`;
- `FINANCIAL_ACCOUNT_MANAGE`;
- `COLLECTION_POINT_LIMIT_MANAGE`.

`COLLECTOR` no puede cambiar planes, precios, duración, configuración global, fechas de membresía, usuarios ni pagos históricos. `SUPPORT` no obtiene permisos financieros por defecto. La cooperativa o el analista de cooperativa no podrá confirmar pagos salvo asignación explícita de un rol financiero compatible.

Agregar, si la matriz actual lo justifica, un rol `FINANCE` compuesto por permisos para revisar transferencias centrales, verificar liquidaciones, revisar cierres y consultar reportes financieros. No debe obtener automáticamente administración de conductores, zonas, tarifas de viaje, configuración técnica, usuarios o auditoría sensible completa.

`COLLECTOR` solo puede ver métodos receptores, pagos, cierres y liquidaciones de sus puntos asignados. No puede ver saldos o movimientos de cuentas centrales ni confirmar fondos enviados a Costa-Go.

### Auditoría y observabilidad

Registrar eventos financieros inmutables, como mínimo:

```text
PAYMENT_ORDER_CREATED
PAYMENT_ORDER_EXPIRED
PAYMENT_SUBMITTED
PAYMENT_APPROVED
PAYMENT_REJECTED
PAYMENT_CANCELLED
PAYMENT_REVERSED
MEMBERSHIP_ACTIVATED
MEMBERSHIP_RENEWED
MEMBERSHIP_EXPIRED
MANUAL_PAYMENT_REGISTERED
COURTESY_GRANTED
CASH_CLOSURE_CREATED
COLLECTION_POINT_PAYMENT_CONFIRMED
COLLECTION_CLOSURE_CLOSED
SETTLEMENT_CREATED
SETTLEMENT_SUBMITTED
SETTLEMENT_VERIFIED
SETTLEMENT_REJECTED
SETTLEMENT_DISPUTED
COLLECTION_POINT_LIMIT_REACHED
COLLECTION_POINT_SUSPENDED
COLLECTION_POINT_REACTIVATED
```

Guardar usuario, rol, sesión/dispositivo disponible, IP cuando corresponda, fecha, entidad, acción, valores relevantes anteriores/nuevos, orden, pago y conductor. No permitir eliminación física desde el panel.

Agregar logs estructurados con identificadores internos, método, resultado, duración y código de error, sin registrar tokens completos, comprobantes, cuentas, cédulas ni referencias bancarias completas. Integrar con Sentry/logging existente únicamente con datos saneados.

### Notificaciones

Enviar notificaciones idempotentes al conductor cuando:

- se crea o expira una orden;
- se presenta una transferencia;
- el pago se aprueba o rechaza;
- la membresía se renueva;
- se aproxima el vencimiento según los umbrales configurados;
- inicia la gracia;
- vence la membresía.

La confirmación debe mostrar importe, plan y nueva vigencia. Reutilizar el banner tipo burbuja en foreground y push nativo en background, con una única clave de deduplicación por evento.

### Configuración y feature flags

Configurar desde backend/panel:

- planes, precios, moneda y duración;
- duración de QR;
- métodos y canales habilitados;
- cuentas bancarias receptoras activas;
- límites de comprobantes;
- avisos de vencimiento;
- puntos y asignaciones;
- políticas de gracia ya definidas;
- retención documental;
- tolerancias operativas expresamente autorizadas.
- cuentas receptoras del punto y cuentas centrales;
- plazo y límite de liquidación por punto;
- reglas de comisión del punto;
- política de suspensión de nuevas recaudaciones.

Feature flags iniciales:

```text
driver_memberships_enabled
membership_enforcement_enabled
membership_suspension_scheduler_enabled
collector_portal_enabled
bank_transfer_enabled
cash_collection_enabled
deuna_collection_enabled
cooperative_payments_enabled
collection_point_settlements_enabled
collection_point_commissions_enabled
collection_point_limits_enabled
finance_role_enabled
```

Desplegar inicialmente con `membership_enforcement_enabled=false`. Esto permite migrar, probar pagos y revisar vigencias sin bloquear a los conductores actuales. La activación posterior debe realizarse desde backend/panel con vista previa de afectados, fecha programada, confirmación y auditoría.

### API conceptual

Adaptar nombres y prefijo a la convención real del proyecto, sin duplicar controladores:

```text
GET    /v1/driver/membership
GET    /v1/driver/membership/payments
POST   /v1/driver/membership/payment-orders
GET    /v1/driver/membership/payment-orders/:id
POST   /v1/driver/membership/payment-orders/:id/transfer-proof

GET    /v1/collector/payment-orders/token/:token
POST   /v1/collector/payment-orders/token/:token/confirm
GET    /v1/collector/drivers/search
POST   /v1/collector/drivers/:driverId/payment-orders
GET    /v1/collector/payments/today
POST   /v1/collector/cash-closures
GET    /v1/collector/cash-closures
POST   /v1/collector/cash-closures/:id/settlements
GET    /v1/collector/settlements

GET    /v1/admin/membership-payments/pending
GET    /v1/admin/membership-payments/:id
POST   /v1/admin/membership-payments/:id/approve
POST   /v1/admin/membership-payments/:id/reject
GET    /v1/admin/memberships
GET    /v1/admin/memberships/:driverId/history
GET    /v1/admin/collection-points
GET    /v1/admin/collection-points/:id/financial-summary
GET    /v1/admin/settlements
POST   /v1/admin/settlements/:id/verify
POST   /v1/admin/settlements/:id/reject
POST   /v1/admin/settlements/:id/dispute
```

Errores de negocio estables y mensajes comprensibles:

- `PAYMENT_ORDER_NOT_FOUND`;
- `PAYMENT_ORDER_EXPIRED`;
- `PAYMENT_ORDER_ALREADY_PAID`;
- `PAYMENT_AMOUNT_MISMATCH`;
- `PAYMENT_REFERENCE_ALREADY_USED`;
- `PAYMENT_METHOD_DISABLED`;
- `MEMBERSHIP_PLAN_DISABLED`;
- `PAYMENT_PERMISSION_DENIED`.
- `COLLECTION_POINT_INACTIVE`;
- `COLLECTION_POINT_ACCOUNT_DISABLED`;
- `PAYMENT_ALREADY_IN_CLOSURE`;
- `CLOSURE_ALREADY_CLOSED`;
- `CLOSURE_ALREADY_SETTLED`;
- `SETTLEMENT_ALREADY_PROCESSED`;
- `SETTLEMENT_AMOUNT_MISMATCH`;
- `SETTLEMENT_PERMISSION_DENIED`.

No devolver trazas, SQL ni detalles técnicos al cliente.

### Migración, activación y rollback

Antes de implementar, inspeccionar esquema, usuarios, permisos, archivos y auditoría existentes. Las migraciones serán aditivas y compatibles; no borrar ni reescribir historiales actuales.

Definir explícitamente la vigencia inicial de los conductores existentes y mostrar una simulación antes de activar enforcement. Recomendada una migración controlada que cree registros iniciales identificados como `MIGRATION` o una campaña de cortesía autorizada, sin inventarlos como pagos recibidos.

Orden de despliegue:

1. migraciones y backend con flags desactivados;
2. panel, permisos y portal;
3. app móvil;
4. pruebas internas de pago sin enforcement;
5. conciliación de resultados;
6. activación gradual por zona/cooperativa si se decide;
7. activación global con vista previa.

Rollback funcional: desactivar `membership_enforcement_enabled` y los canales de cobro sin eliminar pagos, órdenes o membresías. Las migraciones financieras aplicadas no deben revertirse destruyendo datos.

## 8. Planes y rotación de publicidad por comercios

Ampliar el módulo publicitario existente sin crear un carrusel paralelo. El pasajero continuará viendo un solo banner y la selección de campañas se resolverá desde backend.

Planes iniciales:

| Plan del comercio | Precio | Buscando conductor | Esperando conductor / viaje en curso | Peso en búsqueda |
| --- | --- | --- | --- | --- |
| `BASIC` | Configurable por mes | Sí | No | 1 |
| `PREMIUM` | Configurable por mes | Sí | Sí | 2 |

Los precios no deben quedar escritos en la aplicación. Deben administrarse desde el panel y permitir vigencia, moneda, impuestos y futuras modificaciones sin publicar una APK.

Separar dos entidades y responsabilidades:

- **Plan publicitario:** define precio, peso predeterminado y espacios predefinidos habilitados.
- **Campaña:** pertenece a un comercio, selecciona un plan y define recurso, zona, fechas, acción y estado.

Los espacios publicitarios no podrán ser inventados libremente desde el panel. Backend y aplicaciones mantendrán un catálogo controlado de ubicaciones compatibles con la interfaz, por ejemplo `PASSENGER_SEARCHING_DRIVER`, `PASSENGER_WAITING_DRIVER` y `PASSENGER_TRIP_IN_PROGRESS`. El administrador únicamente podrá habilitar espacios compatibles con el plan. Esto impide configuraciones contradictorias como una campaña Básica visible durante un viaje.

Reglas de presentación:

- conservar inicialmente una duración de cinco segundos por banner;
- permitir cambiar esa duración mediante configuración;
- en búsqueda, las campañas Premium participan con peso 2 y las Básicas con peso 1;
- aleatorizar la rotación ponderada;
- impedir que el mismo comercio aparezca dos veces consecutivas cuando existan otras campañas elegibles;
- mostrar únicamente una pieza publicitaria a la vez;
- usar una etiqueta discreta como **Comercio afiliado** o **Patrocinado**;
- no mostrar al pasajero el nombre comercial del plan contratado;
- no cubrir controles críticos, información del viaje, navegación ni Safe Area;
- detener u ocultar publicidad en estados donde pueda distraer o afectar la seguridad;
- respetar fecha de inicio, fecha de fin, estado y zona de cada campaña.
- mantener la rotación correctamente al cambiar entre búsqueda, conductor asignado, espera y viaje;
- retirar automáticamente una campaña Básica cuando termine la búsqueda;
- permitir que Premium siga siendo elegible durante los estados admitidos, sin mostrarla permanentemente;
- utilizar `advertiser_id` para impedir apariciones consecutivas de campañas distintas pertenecientes al mismo comercio o cadena;
- admitir un peso individual excepcional por campaña dentro de límites mínimos y máximos definidos por backend;
- aplicar un límite de frecuencia por usuario o sesión para evitar que un anunciante monopolice las impresiones;
- ocultar publicidad en pantallas críticas, navegación del conductor, emergencias, confirmaciones sensibles o cuando afecte la seguridad.

Ejemplo conceptual de ponderación con tres campañas Básicas y dos Premium:

```text
B1, B2, B3, P1, P1, P2, P2
```

La secuencia final debe barajarse y aplicar la regla de no repetición inmediata. La ponderación aumenta la probabilidad de aparición, pero no debe prometer una secuencia rígida ni una cantidad exacta de impresiones salvo que en el futuro se contrate por impresiones garantizadas.

Capacidad inicial:

- máximo sugerido de 10 campañas activas por zona y espacio publicitario;
- el límite debe ser configurable;
- advertir al administrador al alcanzar el límite;
- preparar segmentación futura por zona, temporada, categoría y franja horaria;
- una campaña solo participa si está activa, vigente, aprobada y asignada a la zona actual del viaje.

Estados de campaña:

- `SCHEDULED`: fecha de inicio futura;
- `ACTIVE`: vigente y habilitada;
- `PAUSED`: detenida manualmente;
- `FINISHED`: finalizada o vencida.

El backend debe calcular y actualizar automáticamente los estados según las fechas. Una campaña vencida deja de ser elegible sin intervención manual. Las campañas con historial no se eliminan físicamente; se finalizan para conservar métricas y auditoría.

Si no existen campañas elegibles, mostrar una pieza institucional controlada como **Tu publicidad aquí**, con enlace al canal comercial configurado. Si el archivo de una campaña falla, usar una imagen fallback segura sin contabilizar una impresión de la creatividad que no se mostró.

### Acciones de los anuncios

Cada campaña podrá configurar una acción validada:

- `NONE`: sin acción;
- `WEB`: abrir un sitio HTTPS permitido;
- `WHATSAPP`: iniciar conversación con el número configurado;
- `PHONE`: iniciar llamada con confirmación del usuario;
- `MAPS`: abrir la ubicación del comercio;
- `IN_APP`: reservado para una integración futura controlada.

El cliente no debe ejecutar esquemas o URLs arbitrarias. Backend validará tipo, formato, dominios, teléfonos y coordenadas. Toda salida de la aplicación debe requerir una interacción real del usuario.

### Métricas confiables

- registrar una impresión solamente cuando el banner haya estado visible al menos un segundo;
- permitir como máximo una impresión por exhibición de cinco segundos;
- no contar `setState`, rebuilds, movimiento del mapa, reconexiones o eventos WebSocket como impresiones nuevas;
- registrar un clic únicamente ante interacción real;
- deduplicar eventos mediante identificador de campaña, sesión, espacio y exhibición;
- reportar campaña, comercio, fecha, pantalla, estado del viaje y zona;
- calcular impresiones, clics, CTR y acciones por tipo;
- no recopilar ni entregar al anunciante información personal del pasajero;
- enviar métricas de forma agrupada y tolerante a reintentos para no realizar una llamada de red por cada segundo de visualización.

El backend será la fuente de verdad de las métricas comerciales. Los eventos enviados por el cliente deberán validarse, deduplicarse y someterse a límites de frecuencia para reducir manipulación.

### Rendimiento y continuidad

- almacenar temporalmente banners en caché local con expiración y versión;
- precargar el siguiente banner antes de la rotación;
- evitar descargar nuevamente la misma imagen cada cinco segundos;
- impedir espacios blancos y parpadeos durante la transición;
- invalidar caché cuando cambie la creatividad o termine la campaña;
- limitar tamaño, resolución y formatos de imágenes;
- continuar de forma estable ante red lenta o pérdida temporal de conectividad.

Gestión administrativa prevista:

- crear o editar planes y definir precio, peso y habilitación de ubicaciones predefinidas;
- asignar un plan a cada campaña/comercio;
- configurar zona, categoría, vigencia y estado;
- activar, pausar, renovar o finalizar una campaña;
- vista previa del banner antes de aprobarlo;
- validar formato, dimensiones, peso y tipo del recurso;
- registrar impresiones, clics y estado del viaje donde apareció;
- mostrar métricas por campaña sin recopilar datos personales innecesarios;
- auditoría de altas, cambios de plan, activaciones, pausas y renovaciones.
- seleccionar paquetes comerciales auxiliares como fin de semana, feriado, 7, 15 o 30 días y personalizado;
- calcular automáticamente la fecha final propuesta, manteniendo edición únicamente para roles autorizados;
- conservar historial de quién modificó precio, plan, fechas, peso, creatividad, acción o estado.

Preparar, sin activar inicialmente, exclusividad por categoría y período. Esto permitirá limitar campañas Premium competidoras dentro de una misma zona y espacio sin agregar más banners a la interfaz.

La selección definitiva debe ejecutarse en backend utilizando campañas elegibles de la zona. El cliente únicamente renderizará la campaña seleccionada y reportará los eventos permitidos, evitando que altere pesos o acceda a campañas de otra zona.

## 9. Presentación visual de notificaciones

Rediseñar las notificaciones visibles dentro de la aplicación para que no aparezcan como tarjetas rectangulares rígidas.

Aplicar un componente reutilizable con estilo de burbuja/banner compacto para:

- mensajes nuevos del chat;
- solicitudes de viaje;
- viaje aceptado;
- conductor en camino;
- conductor llegó;
- inicio, cambio o cancelación del viaje;
- recordatorios de viajes programados;
- avisos de membresía del conductor.

Características visuales:

- bordes ampliamente redondeados;
- tamaño compacto y adaptable al contenido;
- entrada y salida animadas sin bloquear la pantalla;
- título, descripción breve y acción contextual cuando corresponda;
- icono pequeño oficial de Costa-Go integrado en una esquina;
- diferenciación visual por tipo de evento sin perder la identidad de marca;
- respeto de Safe Area, notch, barra de estado y tamaños de pantalla;
- texto legible, truncamiento controlado y accesibilidad;
- evitar cubrir controles críticos del mapa, navegación o viaje.

La burbuja corresponde a la presentación **in-app** cuando la aplicación está abierta. En segundo plano o con la aplicación cerrada se conservará la notificación nativa de Android/iOS, configurando correctamente el icono pequeño de Costa-Go, el icono principal, el canal, la importancia, el sonido y la navegación al tocarla.

No se deben emitir dos avisos visibles por el mismo evento. Push y realtime deben compartir una clave de deduplicación para que un mensaje o cambio de viaje produzca una sola notificación.

## 10. Pruebas mínimas de la versión

- Cada combinación de proveedor y modo de inicio por tramo.
- Navegación externa hacia pasajero y hacia cada destino/parada.
- Retorno desde Google Maps conservando viaje, parada y estado actuales.
- Ubicación del conductor visible para el pasajero mientras la app de mapas está al frente.
- Fallback interno cuando no exista una aplicación externa compatible.
- Notificación persistente **Volver a Costa-Go** durante el viaje.
- Reapertura de navegación sin consumo duplicado.
- Reinicio mensual del contador estimado de Navigation SDK.
- Alertas de consumo al alcanzar los umbrales configurados.
- Cero solicitudes de Navigation SDK cuando ambos tramos usen `MAP_ONLY` o `EXTERNAL_MAPS`.
- Diferenciación entre consumo de Navigation SDK, Routes, Places y Geocoding.
- Mapa móvil se crea sin Map ID cuando `MOBILE_CLOUD_MAP_STYLE_ENABLED=false`.
- Tema claro y oscuro JSON conservan identidad, contraste y POI relevantes.
- Cambiar el tema del sistema actualiza el estilo sin perder ruta, cámara ni estado.
- Estados del viaje y bottom sheets no recrean el mapa ni generan cargas adicionales.
- Panel de zonas conserva su Map ID web y la edición de polígonos.
- Marcadores, clusters, polylines, padding y selección por pin funcionan sin Map ID.
- Autocomplete encuentra calles y comercios conocidos dentro de cada Service Area.
- Consultas como **Coral**, **La Jaula** y **Mutualista** devuelven coincidencias o activan el fallback controlado.
- Una sesión de búsqueda utiliza un token único y termina con el Place Details seleccionado.
- Escribir rápidamente no genera una solicitud por carácter ni muestra respuestas antiguas.
- Text Search Pro se ejecuta como fallback puntual y nunca en paralelo por cada pulsación.
- Resultados fuera del polígono se rechazan mediante la validación de Service Area sin eliminar coincidencias válidas internas.
- Alertas de Text Search Pro se generan al 80 % y 95 % configurados.
- La reserva pagada no supera el presupuesto mensual configurado salvo autorización expresa.
- Alcanzar el límite suspende únicamente Text Search Pro y mantiene Autocomplete, proveedores alternativos y selección por mapa.
- El contador mensual es atómico y no duplica caché, reintentos ni solicitudes no enviadas a Google.
- El reinicio del período reactiva el fallback sin requerir una nueva APK.
- El panel diferencia estimación interna, consumo por SKU y facturación oficial de Google Cloud.
- Viaje con uno y varios destinos.
- Fallback Maps/Routes.
- Creación exitosa de viaje programado limpia formulario, marcadores, ruta y estimaciones.
- Error al programar conserva el borrador y evita pérdida de información.
- Doble toque al confirmar produce una sola reserva.
- Volver a inicio después de programar no permite solicitar accidentalmente el mismo viaje como inmediato.
- **Modificar viaje** carga únicamente la reserva seleccionada y conserva su identificador.
- Cancelar edición no altera la reserva original.
- Modificación con conductor asignado respeta validaciones, notificaciones y reasignación definida por backend.
- Resumen previo muestra en negrita el **Total a pagar** después del recargo por paradas.
- Total del pasajero, tarjeta del conductor, payload y registro backend son idénticos.
- Reordenar o eliminar paradas invalida la cotización anterior y recalcula el total.
- La confirmación queda bloqueada mientras exista un cálculo tarifario pendiente.
- Valores monetarios mantienen dos decimales sin errores de suma o redondeo.
- CSV válido, inválido, duplicado y con cooperativa inexistente.
- Cuenta importada sin aprobación automática.
- Activación mensual, trimestral y anual.
- Ciclo prepago conserva snapshots de base, incluidos, tarifa adicional, máximo, adicional del pasajero y duración.
- 0, 60 y 120 viajes mantienen la próxima renovación en USD 12,00 con la configuración inicial.
- 121 viajes generan exactamente un viaje adicional y USD 0,04 de uso adicional.
- Con adicional vigente de USD 0,05, 0,10, 0,15 y 0,20, el excedente unitario derivado es respectivamente USD 0,02, 0,04, 0,06 y 0,08.
- Cambiar el adicional o el porcentaje conserva el valor congelado del ciclo activo y aplica el nuevo cálculo únicamente al siguiente ciclo elegible.
- Panel, backend, tarifa del viaje y membresía consumen el mismo campo `passenger_service_additional`; no existe una segunda comisión acumulable.
- 150 viajes producen USD 13,20; 200 producen USD 15,20; 245 producen USD 17,00.
- 300 viajes producen USD 19,20; 400 producen USD 23,20; 500 producen USD 27,20 y 520 producen USD 28,00.
- 570 y 700 viajes mantienen la renovación máxima en USD 30,00 sin bloquear al conductor.
- Viaje cancelado, rechazado, expirado, fallido o de prueba no modifica el ciclo.
- El mismo viaje completado, reenviado o procesado concurrentemente incrementa el ciclo una sola vez.
- Concurrencia entre finalización del viaje y cierre del ciclo asigna el viaje exactamente a un ciclo.
- Cambio de configuración durante el período no altera snapshots ni cálculo del ciclo activo.
- El adicional de USD 0,10 se presenta como métrica informativa y nunca aparece como ingreso, pago o liquidación de Costa-Go.
- Cierre del ciclo congela una sola orden con base, excedente, ajustes y total trazables.
- Nuevo pago abre el ciclo siguiente con contadores en cero y conserva el ciclo anterior completo.
- Ajustes, descuentos y condonaciones requieren ledger, motivo, permiso y auditoría; no editan saldos directamente.
- Una orden definitiva no puede pagarse anticipadamente mientras el uso variable del ciclo permanezca abierto.
- Un viaje activo continúa al vencer; el bloqueo de nuevas solicitudes se aplica después según la política de gracia.
- Desactivar `membership_usage_billing_enabled` detiene el cómputo futuro sin borrar ledger ni ciclos históricos.
- Aviso exactamente dentro del umbral configurado.
- Tarjeta muestra plan, estado y fecha de vigencia en zona horaria local.
- A cinco días cambia a `EXPIRING` y muestra **Vence en 5 días** sin bloquear conexión.
- Membresía vencida deshabilita **Conectarme** desde UI y backend.
- Vencimiento conserva acceso a historial, soporte, documentos, perfil y configuración.
- Configuración inicial de dos días de gracia respeta fecha, hora, zona y política de conexión aplicadas.
- Campaña `ALL` de tres días se aplica únicamente a las membresías elegibles que vencen dentro de su ventana.
- Campaña `COOPERATIVE` de dos días afecta exclusivamente a los conductores de la cooperativa seleccionada.
- Una política `DRIVER` prevalece sobre `COOPERATIVE` y `ALL`; una política `COOPERATIVE` prevalece sobre `ALL`.
- Los días de gracia de políticas coincidentes no se acumulan.
- La vista previa de una campaña coincide con el conjunto finalmente afectado al activarla.
- Modificar o finalizar una campaña no acorta una gracia ya asignada a una membresía.
- Una campaña global no reactiva conductores suspendidos por seguridad, sanción, fraude o documentos vencidos.
- La conexión y recepción de solicitudes durante la gracia respetan el valor histórico `grace_allows_trips_applied`.
- Conductor nuevo aprobado recibe la gracia inicial únicamente cuando la política de incorporación está activa y es elegible.
- Conductor aprobado sin pago ni gracia habilitante conserva acceso a su cuenta, pero backend rechaza conexión y nuevas solicitudes.
- Gracia inicial de dos días permite viajes hasta la fecha/hora exacta y deshabilita **Conectarme** al finalizar.
- Pago realizado durante la gracia comienza desde `MAX(now, valid_until, grace_until)` y no elimina días concedidos.
- La gracia de incorporación no crea pago, ingreso, comisión ni orden financiera automática.
- Recrear cuenta, cambiar correo, teléfono o dispositivo no concede una segunda gracia a la misma identidad.
- Segunda gracia excepcional requiere permiso, motivo y auditoría.
- Suspensión, documentos inválidos o sanción prevalecen sobre una gracia inicial vigente.
- Recordatorios de incorporación se deduplican entre notificación interna, push y correo.
- Con vencimiento 31/08/2026 y dos días de gracia, permanece operativo el 02/09 23:59, 03/09 00:00 y 03/09 06:59; se suspende a las 07:00 si continúa impago.
- Sin días de gracia, un vencimiento 31/08 permanece operativo hasta 01/09 06:59 y se suspende a las 07:00.
- Pago confirmado a las 06:59 cancela idempotentemente la suspensión de las 07:00.
- Transferencia únicamente presentada pero pendiente de verificación no cancela la suspensión.
- Viaje activo a las 07:00 continúa; no recibe una nueva asignación y se suspende al finalizar si sigue impago.
- Pago confirmado después de `SUSPENDED_NON_PAYMENT` reactiva inmediatamente solo si las demás condiciones de elegibilidad siguen vigentes.
- Scheduler retrasado no permite ponerse online ni aceptar nuevas ofertas porque backend vuelve a evaluar `suspension_at` en línea.
- Dos ejecuciones concurrentes del scheduler producen una sola transición y una sola notificación.
- Cambiar suspensión de 07:00 a 08:30 recalcula únicamente eventos futuros conforme a fecha efectiva y deja auditoría.
- Adelantar el horario no provoca una suspensión inesperada el mismo día ni acorta una gracia ya concedida.
- Zona horaria local y UTC producen el mismo instante efectivo y panel/app muestran la hora local correcta.
- Dashboard diferencia activas, próximas, gracia, vencidas, cooperativas e individuales.
- Ingresos mensuales incluyen únicamente pagos confirmados y no proyecciones.
- Renovación masiva por cooperativa presenta vista previa, es atómica y queda auditada.
- Vencimiento mientras está desconectado.
- Vencimiento durante un viaje activo.
- Renovación antes y después del vencimiento.
- Suspensión y reactivación con permisos y auditoría.
- QR válido, inexistente, manipulado, expirado, pagado y reutilizado.
- Login del recaudador conserva únicamente un `returnUrl` interno permitido y vuelve a la orden correcta.
- Efectivo, DeUna y transferencia verificada requieren confirmación humana antes de renovar.
- Una captura o comprobante cargado nunca activa la membresía automáticamente.
- Transferencia remota queda `PENDING_VERIFICATION` hasta aprobación autorizada.
- Comprobante inválido, demasiado grande o con MIME inconsistente es rechazado sin exposición pública.
- Monto distinto, plan deshabilitado, método deshabilitado y orden vencida no pueden procesarse.
- Referencia bancaria reutilizada se detecta dentro de su alcance normalizado y se deriva a revisión cuando exista colisión legítima.
- Dos recaudadores confirmando simultáneamente producen un pago, una renovación y una notificación.
- Reintentar con la misma idempotency key devuelve el resultado existente sin volver a renovar.
- Renovación anticipada conserva la vigencia ya pagada; renovación vencida comienza desde la fecha efectiva definida.
- Pago sin QR crea una orden y utiliza el mismo servicio central, sin editar `valid_until` directamente.
- Pago manual administrativo y cortesía aplican permisos, motivo, auditoría y tratamiento contable correcto.
- `COLLECTOR` solo accede a puntos y operaciones autorizados y no modifica planes, precios ni fechas.
- `SUPPORT` no obtiene acceso financiero implícito.
- Pago agrupado futuro enlaza cada renovación individual y no se confunde con una campaña de gracia.
- Cierre de caja coincide con pagos confirmados de su punto, usuario, fecha y método.
- Efectivo, DeUna y transferencia recibidos por un punto renuevan la membresía y quedan `PENDING_SETTLEMENT`.
- Transferencia central permanece pendiente y no renueva hasta aprobación de `FINANCE` o administración autorizada.
- El portal presencial muestra la cuenta/QR del punto y la app remota muestra únicamente la cuenta central activa.
- Un `COLLECTOR` no puede aprobar una transferencia central presentada en su punto; solamente puede derivarla.
- Punto inactivo, cuenta receptora deshabilitada o recaudador asignado a otro punto no pueden confirmar el cobro.
- Generar y cerrar un cierre incluye exactamente los pagos elegibles calculados por backend.
- Un pago no puede pertenecer a dos cierres y un cierre no puede cerrarse o liquidarse dos veces.
- Dos usuarios `FINANCE` verificando simultáneamente producen una sola liquidación efectiva.
- Liquidación verificada actualiza cierre y pagos de manera atómica; un fallo genera rollback completo.
- Comisión fija y porcentual se calculan en backend usando la regla histórica y no son editables por el recaudador.
- Comisiones desactivadas producen importe neto igual al bruto.
- Retraso, rechazo, disputa o suspensión posterior del punto no revierte la membresía legítimamente pagada por el conductor.
- Superar plazo o límite pendiente genera alerta sin bloquear cobros por defecto.
- El dashboard del punto no muestra valores globales ni información de otros puntos.
- La conciliación permite recorrer pago, cierre y liquidación hasta la recepción por Costa-Go.
- Reversiones y ajustes conservan el registro histórico, exigen motivo y permiso especial.
- Ingresos excluyen pendientes, rechazados, cortesías, proyecciones y reversiones.
- Desactivar enforcement permite operar sin bloquear conductores y conserva toda la trazabilidad.
- Activar enforcement presenta vista previa de afectados y backend impide conexión a membresías no elegibles.
- Logs y Sentry no contienen token QR completo, cédula, cuenta, referencia completa ni comprobante.
- Campaña Básica visible únicamente durante búsqueda de conductor.
- Campaña Premium visible durante búsqueda, espera y viaje según la configuración de seguridad.
- Rotación ponderada 1:2 sin repetición inmediata del mismo comercio.
- Filtrado estricto de campañas por zona, vigencia y estado.
- Respeto del límite configurable de campañas activas por zona.
- Registro de impresiones sin duplicarlas por reconstrucciones de pantalla.
- Impresión únicamente después de un segundo real de visibilidad.
- Transición automática entre campaña programada, activa, pausada y finalizada.
- Frequency cap por anunciante y sesión.
- Acciones WEB, WHATSAPP, PHONE y MAPS validadas y abiertas solamente por interacción.
- Caché, precarga, invalidación y fallback ante imagen o red fallida.
- Cambio de estado del viaje sin mantener campañas en espacios no autorizados.
- Rechazo de combinaciones contradictorias entre plan y espacio publicitario.
- Burbuja in-app para mensajes y eventos de viaje en teléfonos pequeños, medianos y grandes.
- Icono de Costa-Go visible sin deformación y sin cubrir el contenido.
- Una sola alerta cuando el mismo evento llega por push y realtime.
- Apertura del chat o viaje correcto al tocar la notificación.
- Notificación nativa correcta en foreground, background y aplicación cerrada.

## 11. Entrega agrupada

Implementar junto con las próximas mejoras visuales y entregar en un solo ciclo:

1. migraciones;
2. backend;
3. permisos, auditoría y servicio financiero central;
4. panel administrativo;
5. portal responsive de recaudación;
6. aplicación móvil;
7. pruebas funcionales, de seguridad, concurrencia y rollback;
8. despliegue inicial con enforcement y canales sensibles desactivados;
9. validación controlada con pagos de prueba y conciliación;
10. commit y despliegue Render;
11. nuevo App Bundle/APK con `versionCode` superior al publicado;
12. activación gradual únicamente después de aprobar los resultados operativos.

## 12. Estado de implementación para la prueba cerrada

Implementado en el código de esta entrega:

- migración única para membresías, ciclos, gracia, órdenes, comprobantes, pagos, puntos, cierres, liquidaciones, consumo de API, importación de conductores y planes publicitarios;
- elegibilidad de membresía validada por backend al conectarse, consultar ofertas y aceptar solicitudes;
- protección de viajes activos ante vencimientos y suspensión diferida hasta finalizar;
- parámetros operativos y `feature flags` con enforcement, scheduler y canales de cobro sensibles desactivados por defecto;
- panel de membresías, indicadores, planes, comprobantes, parámetros, consumo de API e importación CSV;
- puntos de recaudación configurables, asignación de recaudadores, portal limitado, cierre de caja y conciliación financiera auditada;
- tarjeta de membresía en conductor, planes, orden QR/código y carga de comprobante JPEG, PNG, WebP o PDF de máximo 5 MB;
- navegación por fase parametrizable entre mapa interno, mapas externos y Navigation SDK, con mapas externos como opción predeterminada de bajo costo;
- limpieza del formulario después de programar un viaje y total final visible en el resumen;
- publicidad Básica/Premium por contexto, zona, peso e impresión/clic;
- icono nativo de Costa-Go para notificaciones Android y burbuja superior reutilizable dentro de la aplicación;
- página pública segura para abrir una orden de membresía en el portal del recaudador;
- App Bundle de producción compilado con Google Maps, firma de producción y sin proxy privado.

Activación recomendada durante la prueba cerrada:

1. ejecutar la migración y comprobar planes/usuarios sin habilitar enforcement;
2. crear un punto inactivo, asignar un usuario `COLLECTOR` y habilitar únicamente los métodos que se probarán;
3. probar orden, comprobante, aprobación, cobro presencial, cierre y conciliación con importes controlados;
4. activar visualización de membresías y navegación externa;
5. habilitar contabilización y scheduler solamente después de validar fechas, zona horaria y notificaciones;
6. habilitar `membershipEnforcementEnabled` al final, con vista previa y monitoreo en Sentry/Render.

Pendientes deliberados que no bloquean la prueba cerrada inicial:

- credenciales/cuentas financieras productivas y convenios reales con puntos de recaudación;
- prueba física de concurrencia con dos recaudadores y dos administradores contra el ambiente desplegado;
- reglas comerciales definitivas de comisión por punto y límites de saldo pendiente;
- Navigation SDK nativo para iOS; el fallback de mapas externos mantiene el viaje operativo;
- actualización futura de Gradle 8.13 a 8.14 o superior, una vez validada la compatibilidad de plugins.
