# Seguimiento de viajes en la web

## Comportamiento

El enlace existente `https://costa-go.com/viaje/<token>` conserva su encabezado,
conductor, mototaxi, origen, destino y estado. Debajo muestra Google Maps con
el marcador de mototaxi ya utilizado por la app. No redirige para realizar el
seguimiento; el enlace externo queda como alternativa secundaria a la última
coordenada conocida (no es seguimiento en vivo en Google Maps).

- Reutiliza `GET /v1/public/trips/:token` y `trip_live_locations`, alimentado por
  el GPS del conductor. No hay una segunda captura de ubicación.
- Actualiza cada 15 segundos, según `refreshSeconds` del endpoint. No es un
  stream continuo ni una predicción de dónde debería estar la moto.
- Carga una sola instancia del mapa y mueve el marcador. Permite explorar el
  mapa y volver a seguir la moto con **Centrar**.
- Mantiene claro/oscuro según el sistema, sin Map ID ni estilos cloud.
- Con más de 60 segundos sin una lectura reciente muestra **Sin señal reciente**.
  Usa `serverTime` y tiempo transcurrido local para no depender de un reloj de
  teléfono desajustado. APIs anteriores siguen funcionando con reloj local.
- Los fallos de red/5xx reintentan con espera progresiva de 5 a 30 segundos;
  cada petición tiene un máximo de 12 segundos. No borra la tarjeta por un corte.
- Pausa nuevas consultas mientras la pestaña no está visible y actualiza al
  regresar. No permite solicitudes simultáneas ni recrea el mapa al actualizar.
- Al terminar/cancelar/quedar sin conductor retira la ubicación y el enlace a
  coordenadas. Un enlace inválido, revocado o caducado no muestra el mapa.
- No muestra GPS de otro conductor: la consulta exige coincidencia entre el
  conductor asignado al viaje y el de la ubicación. Una búsqueda sin asignación
  o una incidencia no publica coordenadas.
- No publica datos privados adicionales. La política `strict-origin` evita
  enviar el token del enlace en el Referer al cargar servicios externos.

## Configuración antes de publicar

En Render → servicio **costa-go-web** → Environment:

```ini
PUBLIC_GOOGLE_MAPS_WEB_API_KEY=<clave web de Google Maps>
```

La clave debe tener **Maps JavaScript API** habilitada, facturación configurada
y restricciones de sitios web HTTP referrer para `https://costa-go.com/*`.
Agregar `https://www.costa-go.com/*` solo si ese dominio sirve realmente la web;
para revisar el dominio de Render, autorizar también su hostname específico.
Se puede reutilizar una clave web existente que permita estos dominios o crear
una exclusiva. No modificar las restricciones de Android para este cambio.
**Nunca usar `GOOGLE_MAPS_SERVER_API_KEY`, una clave Android ni secretos de backend.**

Es una variable de compilación: después de configurarla hay que reconstruir el
sitio. `build.mjs` escribe únicamente la clave pública para navegador en
`config.js`. Si falta la clave o Google rechaza la carga, la web mantiene el
estado del viaje y muestra un aviso amigable junto al acceso externo de respaldo.

Publicar API y sitio para disponer también de `serverTime`, el umbral de GPS y
la protección contra posiciones de asignaciones anteriores. Este cambio no
requiere migración de BD ni APK/AAB nuevo: los enlaces que comparte la app ya
utilizan esta página. El GPS depende de que la app del conductor tenga conexión
y permisos; una web no puede crear una posición nueva si la app no la envía.

Esta entrega permanece local; no configura credenciales ni realiza despliegues.
El commit fiscal local anterior sigue pendiente de la publicación coordinada
que se decidió para ese módulo: no confundir esa condición con este cambio web.

## Consumo

Solo se utiliza Maps JavaScript para dibujar el mapa. Las actualizaciones de
coordenadas van a la API Costa-Go, sin llamadas nuevas a Places, Routes o
Navigation. Abrir/recargar la página puede producir una nueva carga facturable
de mapa según las cuotas vigentes; no prometer coste cero. No se carga Google
antes de obtener un viaje válido con ubicación disponible.

Referencias: [carga de Maps JavaScript](https://developers.google.com/maps/documentation/javascript/load-maps-js-api),
[overlays propios](https://developers.google.com/maps/documentation/javascript/customoverlays),
[uso y facturación](https://developers.google.com/maps/documentation/javascript/usage-and-billing).

## Validación reproducible

Desde `apps/site`:

```powershell
node --test test/*.test.mjs
node build.mjs
node test/tracking-preview.mjs
```

Abrir `http://127.0.0.1:3312/qa`. Permite probar activo, GPS antiguo, espera,
finalizado, enlace vencido, error de red y error de mapa; `width=320/390/680` y
`theme=light/dark`. El iframe hereda el esquema de color para probar el CSS real.
**El mapa y el GPS de esta herramienta son simulados**, identificados como QA,
sin facturación Google ni escrituras en producción. No se copian al build.

En API: `node node_modules/vitest/vitest.mjs run src/trip-sharing.test.ts`.
Las pruebas cubren acceso público, expiración, privacidad, asignación, tiempos,
reconexión, no duplicación, una sola instancia, movimiento y retirada del marcador.
El workflow Quality ejecuta también los tests y build del sitio.

Antes de dar por validada la integración real, usar la clave web restringida en
el dominio publicado y abrir un enlace de prueba: mover el conductor, confirmar
actualizaciones, cortar/restaurar GPS o red, terminar/cancelar y comprobar que
deje de verse su ubicación. Esta comprobación requiere un viaje real de prueba
y no se sustituye por el simulador local.
