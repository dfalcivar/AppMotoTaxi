# Plan coordinado de pruebas — Mototaxi Atacames

Versión del plan: 1.0  
Objetivo: validar el piloto antes de incorporar funciones comerciales adicionales.  
Ambiente: API y panel en Render, Redmi 8 y emuladores Android.
Versión móvil de esta ronda: `0.5.2+11`.

## Datos y dispositivos

| Rol | Dispositivo sugerido | Cuenta |
|---|---|---|
| Pasajero principal | Redmi 8 | Cuenta de pasajero de prueba |
| Conductor 1 | `usuario_2:5556` | Conductor activo |
| Conductor 2 | `usuario_3:5558` | Segundo conductor activo |
| Pasajero concurrente | `usuario1:5554` | Segundo pasajero |

Antes de cada ronda:

- [ ] Confirmar que Render responde en `/health`.
- [ ] Confirmar GPS y permisos de ubicación.
- [ ] Verificar que no existan viajes activos de una ronda anterior.
- [ ] Registrar versión de APK, fecha, dispositivo y red utilizada.
- [ ] Guardar capturas únicamente cuando exista un resultado inesperado.

## P0 — Flujo principal

| ID | Caso | Pasos resumidos | Resultado esperado | Estado |
|---|---|---|---|---|
| P0-01 | Solicitar viaje | Pasajero marca origen/destino, elige pasajeros y pago, solicita | Se crea una sola solicitud y aparece en conductores elegibles | ☐ |
| P0-02 | Aceptación | Un conductor acepta | Pasajero ve conductor en camino; las demás ofertas desaparecen | ☐ |
| P0-03 | Llegada | Conductor pulsa `Ya llegué` | Pasajero ve `Conductor llegó` | ☐ |
| P0-04 | Inicio | Conductor inicia viaje | Ambos ven el viaje en curso | ☐ |
| P0-05 | Finalización | Conductor finaliza | Ambos reciben pantalla de calificación y el conductor vuelve a disponible | ☐ |
| P0-06 | Calificación doble | Pasajero y conductor califican | Se guarda una calificación por actor y se actualizan promedios | ☐ |

## P0 — Concurrencia e idempotencia

| ID | Caso | Pasos resumidos | Resultado esperado | Estado |
|---|---|---|---|---|
| CON-01 | Dos conductores aceptan | Ambos pulsan aceptar casi simultáneamente | Solo uno obtiene el viaje; el otro recibe oferta no disponible | ☐ |
| CON-02 | Conductor ocupado | Crear otro viaje mientras el conductor está activo | No recibe ni visualiza nuevas ofertas | ☐ |
| CON-03 | Pulsación doble | Pulsar aceptar dos veces rápidamente | Se procesa una sola aceptación | ☐ |
| CON-04 | Tres pasajeros | Tres cuentas solicitan con dos conductores | Cada conductor mantiene como máximo un viaje activo | ☐ |
| CON-05 | Liberación | Finalizar un viaje con solicitudes pendientes | La solicitud pendiente más antigua se redistribuye | ☐ |

## P0 — Recuperación y conectividad

| ID | Caso | Pasos resumidos | Resultado esperado | Estado |
|---|---|---|---|---|
| REC-01 | Reinicio durante búsqueda | Cerrar y abrir app del pasajero | Recupera la solicitud y permite cancelarla | ☐ |
| REC-02 | Reinicio durante viaje | Cerrar y abrir ambas apps | Recuperan estado, ruta y participante correcto | ☐ |
| REC-03 | Cambio de red | Cambiar Wi‑Fi/datos durante el viaje | WebSocket reconecta y refresca el estado | ☐ |
| REC-04 | Render en arranque frío | Ingresar después de inactividad | Muestra espera controlada y permite reintentar | ☐ |
| REC-05 | Sesión reemplazada | Iniciar la misma cuenta en otro equipo | La sesión anterior informa que fue reemplazada | ☐ |

## P1 — GPS, mapas y direcciones

| ID | Caso | Pasos resumidos | Resultado esperado | Estado |
|---|---|---|---|---|
| MAP-01 | GPS real | Solicitar desde el Redmi | El origen corresponde a la posición real | ☐ |
| MAP-02 | Punto manual | Tocar origen y destino en el mapa | Se actualizan marcadores, ruta y campos con la dirección legible; las coordenadas quedan solo como respaldo si falla el geocodificador | ☐ |
| MAP-03 | Dirección escrita | Buscar una calle | Presenta resultados cercanos para seleccionar | ☐ |
| MAP-04 | Intersección | Buscar `Tarqui y Bolívar` en Cuenca | Marca la intersección correcta | ☐ |
| MAP-05 | Ubicación antigua | Detener actualizaciones del conductor | Deja de mostrarse como conductor cercano | ☐ |
| MAP-06 | Permiso rechazado | Denegar ubicación | Explica cómo habilitarla sin bloquear la app | ☐ |
| MAP-07 | Ajuste fino del origen | Seleccionar origen y arrastrar el mapa bajo el cursor central | El punto de encuentro queda donde se confirme y se obtiene su dirección legible | ☐ |
| MAP-08 | Limpiar campos | Pulsar `X` en origen y destino | Borra texto, marcador y ruta del punto correspondiente | ☐ |
| MAP-09 | Varios conductores | Activar al menos tres conductores próximos | Cada conductor aparece una sola vez con un ícono de mototaxi y se actualiza al moverse | ☐ |
| MAP-10 | Recentrar GPS | Mover el mapa y pulsar el botón de ubicación | La cámara regresa a la posición GPS y el cursor queda centrado allí | ☐ |
| MAP-11 | Proveedor Google | Compilar con `MAP_PROVIDER=google` y claves restringidas | Muestra Google Maps y busca comercios mediante Places sin alterar el flujo del viaje | ☐ |
| MAP-12 | Respaldo cartográfico | Retirar temporalmente la clave del servidor | La API conserva búsqueda y rutas con Nominatim/ORS | ☐ |
| MAP-13 | Selección expandida | Tocar origen o destino, desplazar el mapa y confirmar | El mapa se expande, el cursor permanece fijo, guarda la coordenada central y vuelve al tamaño normal | ☐ |
| MAP-14 | Respaldo de conductores | Activar un conductor cercano y reconectar el WebSocket del pasajero | El marcador personalizado aparece por tiempo real o por la consulta HTTP de respaldo, sin duplicarse | ☐ |
| MAP-15 | Punto arrastrable | Pulsar ajustar origen/destino y arrastrar directamente el marcador | El mapa puede desplazarse por separado y el punto conserva la ubicación donde se soltó | ☐ |
| MAP-16 | Contador tras finalizar | Finalizar un viaje con dos conductores libres dentro del radio | El pasajero actualiza inmediatamente el contador y muestra ambos conductores disponibles | ☐ |

## P1 — Registro y solicitud

| ID | Caso | Pasos resumidos | Resultado esperado | Estado |
|---|---|---|---|---|
| UX-01 | Registro incompleto | Omitir nombre, teléfono o contraseña | No envía el formulario, explica el dato y enfoca el primer campo faltante | ☐ |
| UX-02 | Conductor sin placa | Crear conductor sin identificador | Indica que la placa es obligatoria y posiciona el cursor en ese campo | ☐ |
| UX-03 | Referencia | Añadir `Casa azul, junto a la farmacia` | El conductor ve la referencia en la oferta y en el viaje aceptado | ☐ |
| UX-04 | Cuatro pasajeros | Seleccionar cuatro y solicitar | API acepta la solicitud y el conductor ve `4 pasajeros` | ☐ |
| UX-05 | Búsqueda real | Solicitar sin aceptación inmediata | Aparece modal de búsqueda; no se muestra conductor ni `va en camino` hasta que alguien acepte | ☐ |
| UX-06 | Datos aceptados | Conductor acepta | Ambos ven el nombre de la contraparte en tamaño destacado | ☐ |
| UX-07 | Llamada | Pulsar llamar después de aceptar | Android abre el marcador con el teléfono registrado, sin iniciar la llamada automáticamente | ☐ |

## P1 — Chat y notificaciones

| ID | Caso | Pasos resumidos | Resultado esperado | Estado |
|---|---|---|---|---|
| CHA-01 | Mensaje con app abierta | Enviar desde el otro rol | Aparece aviso `Abrir`; al tocarlo abre el chat | ☐ |
| CHA-02 | Chat abierto | Recibir otro mensaje dentro del chat | Se agrega a la conversación sin aviso superpuesto | ☐ |
| CHA-03 | Segundo plano | Enviar mensaje con app minimizada | Llega push y al tocarla abre el chat del viaje | ☐ |
| CHA-04 | Reconexión | Cortar red, escribir y recuperarla | No duplica mensajes y confirma el envío | ☐ |
| NOT-01 | Nueva solicitud | Conductor en segundo plano | Llega push del viaje cercano | ☐ |
| NOT-02 | Cancelación | Pasajero o administrador cancela | Ambos ven el motivo correcto | ☐ |
| NOT-03 | Alerta emergente | Minimizar la app y cambiar el estado del viaje | Android muestra una alerta de alta prioridad con sonido/vibración según la configuración del teléfono | ☐ |
| NOT-04 | Progreso del pasajero | Marcar `Ya llegué` e `Iniciar viaje` desde el conductor | El panel de progreso del pasajero cambia inmediatamente; también se sincroniza al volver a abrir la app | ☐ |

## P1 — Pagos y administración

| ID | Caso | Pasos resumidos | Resultado esperado | Estado |
|---|---|---|---|---|
| PAY-01 | Efectivo | Solicitar en efectivo | Se notifica a cualquier conductor elegible | ☐ |
| PAY-02 | De Una | Solicitar con De Una | Solo reciben conductores habilitados | ☐ |
| ADM-01 | Aprobar conductor | Cambiar pendiente a activo | Puede iniciar sesión y ofrecer disponibilidad | ☐ |
| ADM-02 | Cancelar viaje | Cancelar desde panel | Apps muestran cancelación administrativa | ☐ |
| ADM-03 | Radio | Modificar radio y repetir búsqueda | Se aplica a solicitudes nuevas | ☐ |

## P1 — Publicidad de comercios afiliados

Especificación inicial: banner horizontal `1200 × 400 px` (relación 3:1), JPG, PNG o WebP, máximo 1 MB.

| ID | Caso | Pasos resumidos | Resultado esperado | Estado |
|---|---|---|---|---|
| ADS-01 | Cargar banner | Administrador carga imagen, título y vigencia | Banner queda disponible sin recompilar la APK | ☐ |
| ADS-02 | Carrusel | Activar dos banners | La app alterna banners automáticamente | ☐ |
| ADS-03 | Programación | Configurar inicio y final | Solo aparece durante la vigencia y se retira automáticamente al finalizar | ☐ |
| ADS-04 | Desactivar | Desactivar desde panel | Desaparece al siguiente refresco | ☐ |
| ADS-05 | Imagen inválida | Cargar formato/tamaño no permitido | Panel explica el requisito y no guarda | ☐ |
| ADS-06 | Sin campañas | Desactivar todos los banners | Pasajero ve `Tu publicidad aquí`; conductor no muestra publicidad | ☐ |
| ADS-07 | Viaje activo | Solicitar, aceptar e iniciar un viaje | El banner continúa visible en la parte superior durante la búsqueda, asignación y viaje en curso | ☐ |
| ADS-08 | Editar campaña | Cambiar título, inicio, final, orden o imagen desde el panel | Los cambios se guardan sin crear otro banner y respetan la hora local del navegador | ☐ |
| ADS-09 | Respaldo permanente | Dejar todas las campañas fuera de vigencia o desactivadas | Se muestra `Tu publicidad aquí` sin fecha de vencimiento | ☐ |

## Evidencia por incidencia

Registrar para cada fallo:

1. ID del caso.
2. Fecha y hora.
3. Cuenta y dispositivo.
4. Red utilizada.
5. Pasos exactos.
6. Resultado observado y esperado.
7. Captura o video.
8. Identificador del viaje, si aparece en el panel.

## Pruebas automáticas disponibles

Ejecutar desde la raíz del proyecto:

```powershell
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd test:flow
cd apps/mobile
C:\Proyectos\flutter\bin\flutter.bat analyze
C:\Proyectos\flutter\bin\flutter.bat test
```

`test:flow` crea cuentas temporales propias y una carrera identificada como E2E. Valida autenticación, GPS del conductor, distribución, aceptación única, bloqueo de nuevas ofertas, chat, llegada, inicio, finalización y ambas calificaciones. Al finalizar elimina la carrera y las cuentas temporales, incluso si una aserción falla.

Resultado de referencia del 3 de agosto de 2026:

| Validación | Resultado |
|---|---|
| TypeScript API, dominio y panel | ✅ Sin errores |
| Pruebas unitarias y de rutas API | ✅ 27 aprobadas |
| Análisis estático Flutter | ✅ Sin observaciones |
| Pruebas móviles Flutter | ✅ 3 aprobadas |
| Flujo integral pasajero–conductor | ✅ Aprobado |

## Criterio de salida del piloto

- Todos los casos P0 aprobados.
- Ningún conductor con dos viajes activos.
- Ninguna solicitud aceptada por dos conductores.
- Recuperación correcta después de reiniciar la app.
- Notificaciones verificadas en Redmi con la app abierta, en segundo plano y cerrada.
- Casos P1 críticos aprobados o documentados con solución planificada.
