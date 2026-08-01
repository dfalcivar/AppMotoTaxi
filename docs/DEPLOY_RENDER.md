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

Para desarrollo contra una API local en el emulador utiliza explícitamente:

```powershell
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3001
```

El APK queda en:

```text
apps/mobile/build/app/outputs/flutter-apk/app-release.apk
```

Para una distribución estable se debe crear una clave de firma propia antes de
publicar en Google Play. Firebase App Distribution admite esta compilación para
el piloto, pero todos los APK posteriores deben conservar la misma firma.
