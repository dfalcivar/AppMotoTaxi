# Despliegue piloto en Render

Este Blueprint crea tres recursos:

- `mototaxi-atacames-db`: PostgreSQL.
- `mototaxi-atacames-api`: API pública y migraciones.
- `mototaxi-atacames-admin`: panel administrativo estático.

## Antes de desplegar

1. Sube los cambios a GitHub sin incluir archivos `.env` ni `apps/api/secrets`.
2. Crea una cuenta en Render y conecta el repositorio de GitHub.
3. En Render, selecciona **New > Blueprint**, el repositorio y el archivo `render.yaml`.
4. Completa las variables marcadas como secretas:

   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD`
   - `SUPPORT_EMAIL`
   - `SUPPORT_PASSWORD`
   - `ORS_API_KEY`
   - `GOOGLE_MAPS_SERVER_API_KEY` (Places, Geocoding y Routes; reemplaza ORS cuando se configure)
   - `FIREBASE_SERVICE_ACCOUNT_BASE64`

Para obtener el último valor en PowerShell:

```powershell
[Convert]::ToBase64String(
  [IO.File]::ReadAllBytes("apps/api/secrets/firebase-service-account.json")
)
```

El resultado completo se pega como valor secreto, sin comillas.

## Verificación

Cuando finalice el despliegue:

```text
https://mototaxi-atacames-api.onrender.com/health
https://mototaxi-atacames-admin.onrender.com
```

Si Render cambia el nombre de la API por estar ocupado, actualiza
`VITE_API_BASE_URL` en el servicio del panel y vuelve a desplegarlo.

## APK conectado a Internet

La aplicación usa la API pública de Render por defecto. Para generar una nueva
versión instalable ejecuta desde `apps/mobile`:

```powershell
flutter build apk --release
```

Para activar Google Maps en la APK, usa una clave Android restringida distinta
de la clave del servidor:

```powershell
$env:GOOGLE_MAPS_ANDROID_API_KEY='CLAVE_ANDROID_RESTRINGIDA'
flutter build apk --release --dart-define=MAP_PROVIDER=google
```

### Estilo de mapa administrado en Google Cloud

La aplicacion acepta Map ID por plataforma mediante variables de compilacion:

- `GOOGLE_MAPS_ANDROID_MAP_ID`
- `GOOGLE_MAPS_IOS_MAP_ID`
- `GOOGLE_MAPS_WEB_MAP_ID`

Si en Google Cloud se crearon dos Map ID Android independientes, la aplicacion
tambien acepta:

- `GOOGLE_MAPS_ANDROID_LIGHT_MAP_ID`
- `GOOGLE_MAPS_ANDROID_DARK_MAP_ID`

Ejemplo Android:

```powershell
flutter build apk --release `
  --dart-define=MAP_PROVIDER=google `
  --dart-define=GOOGLE_MAPS_ANDROID_MAP_ID=MAP_ID_ANDROID
```

Ejemplo con Map ID claro y oscuro separados:

```powershell
flutter build apk --release `
  --dart-define=MAP_PROVIDER=google `
  --dart-define=GOOGLE_MAPS_ANDROID_LIGHT_MAP_ID=MAP_ID_ANDROID_CLARO `
  --dart-define=GOOGLE_MAPS_ANDROID_DARK_MAP_ID=MAP_ID_ANDROID_OSCURO
```

Si no se proporciona un Map ID, AtacamesGo utiliza estilos JSON locales claro
y oscuro. Con Map ID, Google Cloud controla el estilo y la aplicacion solicita
automaticamente el esquema claro u oscuro del sistema.

Configuracion manual en Google Cloud Console:

1. En **Google Maps Platform > Administracion de mapas**, crear un solo Map ID
   de tipo Android. Crear IDs separados solamente al incorporar iOS o web.
2. En **Estilos de mapa**, crear `AtacamesGo Claro` y `AtacamesGo Oscuro`.
3. Reducir puntos de interes comerciales; conservar salud, transporte,
   terminales y parques. Destacar vias principales y mantener calles locales
   discretas.
4. Publicar ambos estilos.
5. Abrir el Map ID y asociar el estilo claro en **Light mode** y el oscuro en
   **Dark mode**.
6. Recompilar una sola vez con el Map ID. Los siguientes ajustes publicados en
   Cloud Styling no requieren una nueva APK.

Un Map ID no es un estilo y no cambia los colores por si solo. Mientras los
estilos Cloud no esten publicados y asociados, compila sin variables Map ID:
Google Maps seguira activo y la aplicacion utilizara sus estilos locales claro
y oscuro segun el tema del telefono.

Para habilitar el monitoreo de errores y rendimiento del piloto, crea un
proyecto Flutter en Sentry y agrega su DSN solamente durante la compilacion:

```powershell
flutter build apk --release `
  --dart-define=MAP_PROVIDER=google `
  --dart-define=SENTRY_DSN=https://DSN_DEL_PROYECTO@sentry.io/ID `
  --dart-define=APP_ENV=pilot
```

Sin `SENTRY_DSN` la aplicacion funciona normalmente y no envia telemetria. La
API registra solicitudes, tiempos de respuesta y operaciones lentas en los logs
estructurados de Render. No guardes el DSN ni configuraciones de proxy en Git.

Sin `MAP_PROVIDER=google`, la APK conserva OpenStreetMap como respaldo.

Para desarrollo contra una API local en el emulador utiliza explícitamente:

```powershell
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3001
```

El APK queda en:

```text
apps/mobile/build/app/outputs/flutter-apk/app-release.apk
```

Si `android/app/google-services.json` no está presente, la aplicación compila y
funciona sin notificaciones push. Al agregar el archivo real del proyecto
Firebase, Gradle activa automáticamente Google Services y la mensajería FCM.

Para una distribución estable se debe crear una clave de firma propia antes de
publicar en Google Play. Firebase App Distribution admite esta compilación para
el piloto, pero todos los APK posteriores deben conservar la misma firma.
