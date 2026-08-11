---
title: "AtacamesGo - Casos de Uso y Casos de Prueba"
date: "2026-08-05"
---

# AtacamesGo - Casos de Uso y Casos de Prueba

## 1. Alcance general

Documento de control funcional para la app de movilidad mototaxi (pasajero y conductor), panel administrativo y servicios backend asociados.

Cobertura:
- Autenticación y sesiones de usuario.
- Registro/login de pasajero y conductor.
- Flujo completo de solicitud de viaje.
- Asignación y seguimiento de viaje en tiempo real.
- Notificaciones push (administradas por FCM).
- Chat en el tiempo real y estados de viaje.
- Pagos (efectivo y Deuna).
- Mapas (Google Maps + geocodificación/reverse geocoding).
- Administración de cuentas, aprobaciones y documentos.
- Campañas publicitarias.
- Biometría y seguridad.
- Perfil y calificaciones.
- Despliegue y operación (Render/API/Móvil).

## 2. Actores

1. **Pasajero**
   - Inicia sesión en app móvil.
   - Solicita viajes, ve estado del conductor y califica al final.
2. **Conductor**
   - Acepta carreras, inicia y finaliza viajes, actualiza estado.
   - Gestiona perfil y documentos.
3. **Administrador**
   - Aprueba o rechaza conductores.
   - Supervisa solicitudes activas y parámetros operativos.
4. **Sistema / Plataforma**
   - Calcula rutas (Google Maps/Routes).
   - Publica notificaciones y eventos.
   - Administra sesiones, estados y persistencia.

## 3. Supuestos y prerequisitos

- App compilada instalada en celular/emulador con ubicación y permisos de notificaciones habilitados.
- API de AtacamesGo en línea.
- Variables críticas configuradas: ORS/Google Maps según fase de operación, Firebase y almacenamiento.
- Base de datos migrada al último estado.
- Cuentas de prueba disponibles (pasajero y conductor), con al menos 2 conductores para pruebas de concurrencia.

---

## 4. Casos de uso principales

### CU01 - Registro y autenticación de usuario

**Actor:** Pasajero / Conductor / Admin  
**Objetivo:** Crear y acceder a la cuenta con credenciales o biometría (si aplica).  
**Entradas:** nombre, correo, teléfono, cédula de usuario/driver, contraseña, rol.  
**Condiciones:** Debe existir rol válido.

**Flujo principal**
1. Usuario abre la app.
2. Selecciona tipo de rol.
3. Completa campos requeridos y acepta T&C.
4. El sistema valida datos y crea sesión.
5. Usuario ingresa al panel inicial correspondiente.

**Flujos alternos**
- 1a) Usuario existe: solicitar contraseña o recuperación.
- 2a) Datos incompletos: indicar campo faltante.
- 3a) Error de red/servicio: mensaje claro y opción reintento.

**Reglas de negocio**
- Campos obligatorios en registro de conductor: foto de perfil obligatoria (siempre con vista previa).
- Validar formato y peso de archivos.
- Bloquear múltiples sesiones en un mismo dispositivo si aplica por política de sesión única.

### CU02 - Login con biometría

**Actor:** Conductor o Pasajero  
**Objetivo:** Acceder rápido con huella o FaceID sin perder opción de fallback.

**Flujo principal**
1. Usuario habilita biometría en su perfil.
2. Al abrir app, puede autenticar con biometría.
3. Si pasa, acceso directo sin contraseña.

**Reglas de negocio**
- Si falla biometría o el sensor no captura, ofrecer ingreso por credencial sin desactivar opción.
- La opción de biometría debe persistir hasta logout manual.

### CU03 - Recuperar contraseña

**Actor:** Pasajero / Conductor  
**Objetivo:** Obtener acceso cuando olvida credencial.

**Flujo principal**
1. Usuario presiona “Recuperar contraseña”.
2. Ingresa correo/teléfono validado.
3. Sistema envía token/temporal.
4. Usuario crea nueva contraseña.

### CU04 - Completar/editar perfil de usuario

**Actor:** Pasajero / Conductor  
**Objetivo:** Gestionar datos personales, foto y configuración.

**Flujo principal**
1. Usuario entra a “Mi cuenta”.
2. Edita datos, agrega/cambia foto.
3. Guarda cambios.

**Reglas**
- Avatar por defecto si no hay imagen.
- Validar tamaño y formato de imágenes.

### CU05 - Subir documento y foto de conductor (admin + app)

**Actor:** Conductor / Admin  
**Objetivo:** Adjuntar identidad y documento de habilitación.

**Flujo principal**
1. Conductor carga foto y documento desde su flujo.
2. Admin visualiza estado, descarga o revisa y aprueba/rechaza.

### CU06 - Gestión de campañas publicitarias

**Actor:** Admin  
**Objetivo:** Cargar, editar, habilitar/deshabilitar y programar anuncios.

**Flujo principal**
1. Admin registra campaña con imagen, nombre, fecha y enlace.
2. Define si es permanente o con vencimiento.
3. App consume anuncio según estado y ubicación del flujo.

### CU07 - Solicitud de viaje

**Actor:** Pasajero  
**Objetivo:** Crear y solicitar un viaje.

**Flujo principal**
1. El pasajero ingresa origen y destino desde mapa o texto.
2. Selecciona número de pasajeros (máximo 4), modalidad de pago.
3. Presiona solicitar viaje.
4. Backend publica solicitud a conductores disponibles que cumplan filtro de pago/config.
5. Se muestra estado “buscando conductor”.

### CU08 - Asignación y aceptación de carrera

**Actor:** Conductor / Pasajero  
**Objetivo:** Conectar con conductor y confirmar inicio.

**Conductor**
1. Ve solicitud entrante.
2. Acepta o rechaza.
3. Al aceptar, pasa a estado asignado y se habilita ruta.

**Pasajero**
1. Recibe notificación y estado en app.

### CU09 - Seguimiento de viaje

**Actor:** Pasajero / Conductor  
**Objetivo:** Ver ruta, estado y controles de la carrera.

**Flujo**
1. Se actualiza estado de “en camino”, “llegó”, “viaje en curso”.
2. Pasajero ve botón de estado y distancia/tiempo.
3. Conductor gestiona cambios de estado y finaliza.

### CU10 - Cancelación de solicitud o viaje

**Actor:** Pasajero / Conductor / Admin  
**Objetivo:** Cancelar oportunamente y notificar a la otra parte.

**Reglas**
- Cancelar en pantalla de búsqueda debe frenar emisión de notificación y liberar conductor.
- Cancelar desde conductor/panel debe registrar evento e informar estado al pasajero.

### CU11 - Calificación y comentarios

**Actor:** Pasajero / Conductor  
**Objetivo:** Evaluar experiencia y construir historial.

**Flujo principal**
1. Al finalizar viaje, app solicita calificación obligatoria antes de volver al home.
2. Se guarda puntaje + comentario.

### CU12 - Chat de viaje y comunicación

**Actor:** Pasajero / Conductor  
**Objetivo:** Comunicación contextual.

**Flujo**
1. Cuando existe viaje activo, se habilita chat.
2. Mensajes se muestran por conversación de viaje.
3. Notificaciones no deben bloquear interacción.

### CU13 - Estado de conectividad y reintentos

**Actor:** Usuario  
**Objetivo:** Mantener funcionalidad con señal débil.

**Reglas**
- Estado visual de “esperando reconexión”.
- Retraso de actualización sin duplicar carreras.
- Reintentos sin duplicar notificaciones.

### CU14 - Cierre de sesión y seguridad de sesión

**Actor:** Pasajero / Conductor  
**Objetivo:** Cerrar sesión explícitamente y limpiar estado de uso.

**Flujo**
1. Usuario presiona “Cerrar sesión”.
2. Limpieza de token, estado y caches sensibles.

---

## 5. Casos de prueba

Cada caso incluye: ID, objetivo, datos, pasos y criterio de aceptación.

### PT-01 - Login de prueba usuario de prueba

- **Objetivo:** Ingresar con usuario válido.
- **Precondición:** usuario registrado y API activa.
- **Pasos:** abrir app, elegir rol, ingresar credenciales, entrar.
- **Esperado:** token emitido, carga de mapa y menú principal.

### PT-02 - Login con credenciales inválidas

- **Objetivo:** validar manejo de error.
- **Precondición:** usuario registrado.
- **Pasos:** ingresar contraseña incorrecta.
- **Esperado:** mensaje en español sin revelar estado de cuenta.

### PT-03 - Recuperación de contraseña

- **Objetivo:** validar flujo de reseteo.
- **Pasos:** tocar “¿Olvidaste tu contraseña?”, completar.
- **Esperado:** mensaje de confirmación y cambio efectivo tras restablecer.

### PT-04 - Crear conductor sin foto

- **Objetivo:** validar regla de obligatoriedad.
- **Pasos:** registrar conductor sin foto y enviar.
- **Esperado:** no permitir continuar hasta anexarla.

### PT-05 - Validación de foto y documentos

- **Objetivo:** validar tipo/size.
- **Pasos:** subir archivos JPG/PNG y pesados/inválidos.
- **Esperado:** aceptar formato válido y rechazar inválidos.

### PT-06 - Solicitar viaje con origen/destino manual (texto)

- **Objetivo:** eliminar códigos de dirección visibles (Plus Codes) en UI.
- **Pasos:** escribir “Hermano Miguel”, “Simón Bolívar y …”, seleccionar.
- **Esperado:** mostrar dirección limpia con calle/intersección.

### PT-07 - Solicitar viaje moviendo marcadores

- **Objetivo:** permitir ajuste por mapa.
- **Pasos:** establecer destino con cursor, mover marcador.
- **Esperado:** dirección principal del punto real; no solo ciudad.

### PT-08 - Ajuste de ubicaciones en la hoja de origen-destino

- **Objetivo:** bottom sheet arrastrable.
- **Pasos:** subir/abajo la hoja desde estado inicial.
- **Esperado:** drag funcional sin bloquear escritura.

### PT-09 - Solicitud y concurrencia

- **Objetivo:** validar que un conductor no reciba nueva solicitud hasta terminar su viaje.
- **Pasos:** 3 pasajeros solicitan sucesivamente, 1 conductor activo.
- **Esperado:** el conductor recibe según disponibilidad.

### PT-10 - Buscando conductor con notificaciones

- **Objetivo:** validar UX de búsqueda.
- **Pasos:** solicitar viaje.
- **Esperado:** mapa predominante, sheet arrastrable, publicidad visible completa, botón “Cancelar solicitud”.

### PT-11 - Cancelar búsqueda

- **Objetivo:** validar cancelación limpia.
- **Pasos:** solicitar, esperar 30 segundos, cancelar.
- **Esperado:** estado se detiene y notificaciones no continúan.

### PT-12 - Verificación de notificaciones push (Android con app en segundo plano)

- **Objetivo:** validar recepción.
- **Pasos:** dejar app en segundo plano, enviar solicitud o cambios.
- **Esperado:** notificación aparece y al tocar navega al contexto correcto.

### PT-13 - Conductor acepta y estado no duplica notificación

- **Objetivo:** flujo correcto de aceptación.
- **Pasos:** aceptar una solicitud.
- **Esperado:** pantalla no mezcla estados antiguos; publicidad dentro del mismo sheet.

### PT-14 - Viaje en camino y llegó

- **Objetivo:** comprobar mensajes y bloque de acciones.
- **Pasos:** pasar por estados por botones.
- **Esperado:** secuencia de estado en orden y mapa sin saltos.

### PT-15 - Finalizar viaje y refresco

- **Objetivo:** garantizar reset a “esperando viaje”.
- **Pasos:** finalizar, comprobar estado UI.
- **Esperado:** regresar al flujo base sin pantalla previa bloqueada.

### PT-16 - Calificación final de pasajero y conductor

- **Objetivo:** persistir retroalimentación.
- **Pasos:** finalizar viaje y calificar.
- **Esperado:** modal de calificación con etiquetas/valores correctos.

### PT-17 - Mensajes en chat y apertura desde notificación

- **Objetivo:** no queda en cola.
- **Pasos:** generar mensaje, tocar notificación, abrir chat.
- **Esperado:** chat abre y la notificación queda marcada.

### PT-18 - Modo oscuro / claro

- **Objetivo:** respetar tema del sistema.
- **Pasos:** cambiar tema del dispositivo en sistema y abrir app.
- **Esperado:** se adapta correctamente.

### PT-19 - Mapa: ruta y marcadores sin centrado agresivo

- **Objetivo:** comprobar seguimiento estable.
- **Pasos:** conducir estados múltiples.
- **Esperado:** ruta visible, marcador de “mi ubicación” y taxis cercanos diferenciados.

### PT-20 - Pantalla de perfil con datos completos

- **Objetivo:** validar campos y presentación.
- **Pasos:** abrir perfil.
- **Esperado:** correo, teléfono y foto (o default).

### PT-21 - Panel admin: conductor y pasajero visibles con correo

- **Objetivo:** trazabilidad de identidad.
- **Pasos:** listar usuarios en admin.
- **Esperado:** incluir correo y estado de verificación.

### PT-22 - Administración de documentos

- **Objetivo:** cargar/reemplazar/eliminar.
- **Pasos:** subir documento, reemplazar, descargar.
- **Esperado:** cambios reflejados inmediatamente.

### PT-23 - Configuración de radio de búsqueda

- **Objetivo:** ajustar alcance de búsqueda desde admin.
- **Pasos:** cambiar radio y publicar.
- **Esperado:** nuevos matching respetan valor.

### PT-24 - Prueba multi-dispositivo

- **Objetivo:** flujo end-to-end completo.
- **Pasos:** 1 emulador + 2 celulares:
  - pasajero solicita,
  - conductor acepta,
  - mensaje/chat,
  - finaliza,
  - califica.
- **Esperado:** transición correcta sin bloqueo entre dispositivos.

### PT-25 - Publicidad en estados de viaje

- **Objetivo:** controlar variantes.
- **Pasos:** buscar conductor y estar en viaje.
- **Esperado:** publicidad completa en estado de búsqueda y versión compacta en activo.

### PT-26 - Persistencia y login repetido

- **Objetivo:** evitar sesiones abiertas conflictivas.
- **Pasos:** intentar segunda conexión sin cerrar sesión previa.
- **Esperado:** comportamiento consistente con política definida (bloqueo o manejo controlado).

### PT-27 - Fallo de señal y reintentos

- **Objetivo:** robustez.
- **Pasos:** pasar entre Wi-Fi y datos, reiniciar app.
- **Esperado:** no perder datos críticos, reintento automático o manual visible.

### PT-28 - Cambios de método de pago

- **Objetivo:** validar selección y notificaciones dirigidas.
- **Pasos:** seleccionar Deuna y probar drivers con/without método habilitado.
- **Esperado:** solo reciben quienes aceptan ese pago.

### PT-29 - Búsqueda precisa de dirección por geocoding

- **Objetivo:** mejorar exactitud.
- **Pasos:** seleccionar ubicación con nombre popular.
- **Esperado:** al menos calle + avenida/intersección + barrio + ciudad.

### PT-30 - Despliegue y actualización

- **Objetivo:** validar disponibilidad y versión.
- **Pasos:** generar APK/instalar en nuevo teléfono manual.
- **Esperado:** versión actual y funcional.

---

## 6. Casos de prueba de regresión (sugeridos semanales)

1. Login normal, login biométrico y bloqueo por credenciales.
2. Registro de pasajero/conductor y recuperación de contraseña.
3. Solicitud de viaje con dirección por texto y por mapa.
4. Notificación push en segundo plano.
5. Concurrencia de solicitudes con 1 conductor disponible.
6. Cancelación en búsqueda y durante viaje.
7. Finalizar viaje + calificación + retorno a estado inicial.
8. Modo oscuro/claro.
9. Cierre de sesión y nueva sesión.
10. Publicidad y su no-obstrucción de controles críticos.

## 7. Matriz de priorización

### Críticas
- PT-06, PT-07, PT-08, PT-10, PT-11, PT-13, PT-14, PT-15, PT-26, PT-30.

### Altas
- PT-09, PT-12, PT-17, PT-19, PT-24, PT-28, PT-29.

### Medias
- PT-01, PT-02, PT-03, PT-22, PT-25.

### Bajas
- PT-18, PT-23, PT-27.

## 8. Evidencia de pruebas

Para cada caso registrar:
- Fecha y hora.
- ID de caso.
- Dispositivo (marca, modelo, OS).
- Versión de app.
- Usuario usado (pasajero/conductor/admin).
- Resultado (PASS/FAIL), evidencia de captura de pantalla y logs.

Formato sugerido:
- `yyyy-mm-dd | PT-XX | Dispositivo | Resultado | Observaciones | Screenshot/Log`

## 9. Cierre

Este documento debe actualizarse en cada nuevo bloque funcional.  
Se recomienda:
- Marcar en cada ciclo: OK, Bloqueado, o Pendiente.
- Adjuntar evidencia corta y crítica por flujo.
- Mantener compatibilidad de casos con ambos flujos: **pasajero y conductor**.

## 10. Plan QA ejecutivo (severidad, prioridad y estimación)

Este bloque te sirve para control de ejecución semanal o de sprint.

| ID | Caso | Severidad | Prioridad | Responsable | Estimación (h) | Criterio de aceptación | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PT-01 | Login de usuario válido | Alta | Crítica | App / QA | 0.5 | Login exitoso y sesión activa | Pendiente |
| PT-02 | Login con credenciales inválidas en español | Media | Alta | App / QA | 0.5 | Mensaje claro y sin bloquear flujo | Pendiente |
| PT-03 | Recuperación de contraseña | Alta | Alta | App / QA | 1.0 | Restablece acceso correctamente | Pendiente |
| PT-04 | Registro de conductor sin foto obligatoria | Alta | Crítica | App / QA | 0.5 | Bloquea envío y muestra mensaje | Pendiente |
| PT-05 | Validación de foto y documentos | Alta | Crítica | App / QA | 1.0 | Solo formatos y peso permitidos | Pendiente |
| PT-06 | Dirección limpia (sin Plus Codes) | Alta | Crítica | App / Backend | 1.0 | No mostrar códigos como `4X2X+H56` | Pendiente |
| PT-07 | Origen/destino por mapa con texto preciso | Alta | Crítica | App / Backend | 1.0 | Calle/intersección visible | Pendiente |
| PT-08 | Bottom sheet arrastrable origen/destino | Alta | Alta | App | 0.5 | Expandir/contraer sin bloquear inputs | Pendiente |
| PT-09 | Concurrencia: conductor activo no acepta nueva carrera | Crítica | Crítica | App / Backend | 1.0 | Sin carreras dobles activas | Pendiente |
| PT-10 | Buscando conductor: mapa y sheet predominante | Alta | Crítica | App | 1.0 | Sheet draggable, publicidad completa, cancelar visible | Pendiente |
| PT-11 | Cancelar solicitud durante búsqueda | Alta | Alta | App | 0.5 | Cancela sin dejar estado fantasma | Pendiente |
| PT-12 | Push con app en segundo plano | Crítica | Crítica | Backend / App | 1.5 | Notificación llega y abre pantalla correcta | Pendiente |
| PT-13 | No duplicar notificación/estado en conductor | Alta | Alta | App / Backend | 1.0 | Estado único por solicitud | Pendiente |
| PT-14 | Flujo “en camino / llegó / viaje en curso” consistente | Alta | Crítica | App | 1.0 | Secuencia ordenada y orden visual correcto | Pendiente |
| PT-15 | Fin de viaje y refresh a estado inicial | Alta | Alta | App | 0.5 | Retorna pantalla limpia de home | Pendiente |
| PT-16 | Calificación final obligatoria | Alta | Crítica | App | 0.5 | Se exige antes de salir del flujo | Pendiente |
| PT-17 | Chat y abrir desde notificación | Media | Alta | App / API | 1.0 | Notificación abre chat y no queda bloqueada | Pendiente |
| PT-18 | Tema oscuro/claro del sistema | Media | Media | App | 0.5 | Respeta tema del SO | Pendiente |
| PT-19 | Marcadores diferenciados y centrado estable | Media | Alta | App / Mapas | 1.0 | Mi ubicación visible y rutas estables | Pendiente |
| PT-20 | Perfil con correo/teléfono / foto por defecto | Media | Media | App / Admin | 0.5 | Datos obligatorios visibles | Pendiente |
| PT-21 | Admin: listado con correo en pasajeros y conductores | Alta | Alta | Admin | 0.5 | Correo visible en ambas grillas | Pendiente |
| PT-22 | Gestión documental de conductor | Alta | Alta | Admin / Backend | 1.5 | Subir, reemplazar, descargar y eliminar | Pendiente |
| PT-23 | Ajuste de radio operativo desde admin | Media | Media | Admin / Backend | 0.5 | Nuevo radio afecta emparejamiento | Pendiente |
| PT-24 | Prueba end-to-end 3 dispositivos | Crítica | Crítica | QA | 2.5 | Sin bloquear sincronía entre dispositivos | Pendiente |
| PT-25 | Publicidad por estado (búsqueda/viaje) | Media | Media | App | 1.0 | Variante expandida y compacta según estado | Pendiente |
| PT-26 | Sesión única activa por cuenta | Alta | Alta | Backend | 1.0 | Sin sesión duplicada en otro dispositivo | Pendiente |
| PT-27 | Cobertura de mala señal y reintentos | Media | Media | App / Backend | 1.5 | Reintenta sin duplicar eventos | Pendiente |
| PT-28 | Filtro de pago por conductor | Media | Alta | App / Backend | 1.0 | Solo conductores habilitados reciben solicitud | Pendiente |
| PT-29 | Geocoding con fallback de ciudad | Media | Alta | Backend / App | 1.0 | Calle/intersección > ciudad como fallback | Pendiente |
| PT-30 | Despliegue y disponibilidad de versión | Crítica | Crítica | DevOps | 1.0 | APK/Web funcional en entorno externo | Pendiente |

## 11. Resumen para comité

- Riesgos inmediatos:
  - Notificaciones inestables en segundo plano.
  - Datos incompletos de dirección según proveedor de geocoding.
  - Estados ambiguos entre “esperando”, “asignado”, “llegó”, “en curso”.
- Dependencias críticas:
  - Google Maps / APIs de rutas.
  - FCM para push.
  - Render/API + BD migrada.
- Bloques de decisión antes de liberar:
  - Definir política final de sesión única.
  - Definir ventana de retención de anuncios (si sin fecha = indefinido).
  - Definir SLA de notificación en mala señal.
- Criterio de “go-live” recomendado:
  - PT-01, PT-04, PT-06, PT-07, PT-09, PT-10, PT-12, PT-14, PT-15, PT-16, PT-26 y PT-30 en estado OK.

## 12. Plan de pruebas por sprint (ejecución sugerida)

### Sprint 1 – Cierre de estabilidad del MVP

- Objetivo: confirmar que el flujo base esté sin bloqueos para demo interna.
- Casos obligatorios:
  - PT-01, PT-07, PT-08, PT-10, PT-11, PT-14, PT-15, PT-16, PT-20
- Checklist:
  - Login normal y recuperación de contraseña.
  - Solicitud de viaje con origen/destino por texto y mapa.
  - Notificación y asignación en estado normal.
  - Cancelación funcional y retorno limpio a espera.
  - Calificación al finalizar.

### Sprint 2 – Concurrencia y operación real

- Objetivo: estabilidad con 2+ usuarios concurrentes y múltiples dispositivos.
- Casos obligatorios:
  - PT-09, PT-12, PT-17, PT-24, PT-26, PT-28
- Checklist:
  - Escenario: 3 pasajeros y 1 conductor en modo carga.
  - Verificación de push en segundo plano.
  - Validar que no entren carreras dobles.
  - Verificar sesión única y cierre de sesión en todos los perfiles.

### Sprint 3 – Producto y experiencia de marca

- Objetivo: robustecer UX/branding y funcionalidades de negocio.
- Casos obligatorios:
  - PT-18, PT-19, PT-21, PT-22, PT-25, PT-29
- Checklist:
  - Modo oscuro y layout en pantallas chicas.
  - Marcadores diferenciados y ruta visible.
  - Perfil con correo/telefono/cambio de foto.
  - Gestión documental real en admin.
  - Flujo de publicidad por estado sin bloquear controles.

### Sprint 4 – Lanzamiento controlado

- Objetivo: validar entorno externo y despliegue.
- Casos obligatorios:
  - PT-03, PT-23, PT-30
- Checklist:
  - Restauración de contraseña.
  - Ajuste de radio operativo y efecto real.
  - Instalación en equipos limpios (físicos y emuladores).
  - Validación de release en ambiente remoto.

## 13. Casos relevantes adicionales (recomendados, no críticos)

Estos casos no estaban en el flujo base, pero dan mucha señal de calidad para pruebas reales:

- PT-A01: App abierta tras cierre abrupto
  - Cerrar app mientras hay solicitud activa y reabrir.
  - Esperado: estado consistente y recuperación sin crash.

- PT-A02: Resistencia de memoria/recursos
  - Ejecutar 4 ciclos de viaje continuo con pantalla en mapa y chat activo.
  - Esperado: sin degradación extrema ni recálculo de memoria anormal.

- PT-A03: Recuperación de rutas fuera de cobertura
  - Simular ubicación inestable o con precisión baja.
  - Esperado: UI mantiene estado con aviso de precisión y no rompe navegación.

- PT-A04: Comportamiento con anuncios sin fecha de vencimiento
  - Crear campaña permanente y una con fecha corta.
  - Esperado: permanente siempre visible según estado y lógica de prioridad definida.

- PT-A05: Compatibilidad por región y geografía
- Probar en zonas urbanas y semiurbanas con nomenclatura local.
  - Esperado: direcciones más legibles (avenida/calle/intersección + barrio).

- PT-A06: Seguridad operativa
  - Forzar reenvío de token y revisar sesión activa.
  - Esperado: invalidar correctamente tokens expuestos y cerrar sesión.

- PT-A07: Trazabilidad de auditoría de admin
  - Ver cambios de estado de conductores, aprobaciones, cancelaciones y finalización.
  - Esperado: fecha/hora legible y usuario operador trazable.

## 14. Plantilla de seguimiento de ejecución

Puedes usar esta plantilla en cada corrida de pruebas:

- Fecha:
- Responsable:
- Versión de App:
- Ambiente (local / render / red):
- Estado general (PASS parcial / PASS / FAIL):
- Casos ejecutados:
  - OK:
  - FALLO (con prioridad):
  - BLOQUEADO:
- Incidencias:
- Acción correctiva y responsable:
- Observaciones para siguiente versión:

## 15. Entregables de cierre por bloque

Para cada bloque cerrado, preparar:
- Lista de casos OK.
- Lista de bloqueos con captura de evidencia.
- Lista de mejoras sugeridas.
- Riesgo residual aceptado.
- Fecha objetivo de cierre y despliegue.
- Verificación de despliegue (admin, api, app mobile).
