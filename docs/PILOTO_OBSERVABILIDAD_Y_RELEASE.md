# Piloto controlado: observabilidad y publicación

## Qué queda instrumentado

- La aplicación Flutter envía excepciones a Sentry cuando se compila con `SENTRY_DSN`.
- La API captura fallos de inicio, errores HTTP 5xx y errores de Firebase.
- El panel captura fallos de render y de conectividad.
- Cada intento push persiste únicamente metadatos operativos: tipo, resultado, conteos, códigos de error y duración. No se guardan tokens, cuerpos de mensajes ni credenciales.
- El Centro de alertas permite revisar las entregas de las últimas 24 horas.

## Configuración de Sentry

Crear tres proyectos separados en Sentry: Flutter, Node.js y React. En Render configurar `SENTRY_DSN` para la API y `VITE_SENTRY_DSN` para el panel. El prefijo `VITE_` hace que el DSN del navegador sea público por diseño; nunca usar allí un token de autenticación de Sentry.

Para compilar la app del piloto:

```powershell
.\tools\build_costa_go.ps1 -Target apk -Environment staging -SentryDsn "DSN_DEL_PROYECTO_FLUTTER"
```

## Firma Android de producción

Crear un keystore una sola vez, respaldarlo fuera del repositorio y configurar estas variables en la terminal o sistema seguro de CI:

- `COSTA_GO_KEYSTORE_PATH`
- `COSTA_GO_KEYSTORE_PASSWORD`
- `COSTA_GO_KEY_ALIAS`
- `COSTA_GO_KEY_PASSWORD`

La publicación productiva debe ejecutarse con:

```powershell
.\tools\build_costa_go.ps1 -Target appbundle -Environment production -Production -SentryDsn "DSN_DEL_PROYECTO_FLUTTER"
```

El modo `-Production` falla deliberadamente si falta una variable de firma. Los APK locales pueden seguir usando firma debug para pruebas manuales.

## Criterios del piloto

1. Ejecutar dos conductores contra una solicitud y confirmar una sola aceptación.
2. Probar push en foreground, background, pantalla bloqueada y aplicación cerrada.
3. Revisar en Centro de alertas si el resultado fue enviado, parcial, fallido u omitido.
4. Confirmar que Sentry recibe un error de prueba por cada plataforma antes de abrir el piloto.
5. No ampliar usuarios mientras existan entregas push fallidas recurrentes o aceptación doble.

## Limitación local conocida

Para generar AAB en esta máquina, Android SDK debe tener instaladas las Command-line Tools y licencias aceptadas. Flutter también debe poder ejecutar el proceso de eliminación de símbolos nativos. Esto es independiente del código y debe resolverse en Android Studio/SDK Manager.

