# Mototaxi Atacames

MVP para solicitar mototaxis en Atacames, Ecuador. Incluye aplicación Flutter para pasajero/conductor, API Fastify, consola administrativa React y esquema PostgreSQL/PostGIS.

## Componentes

- `apps/mobile`: aplicación Flutter para Android/iOS.
- `apps/admin`: consola administrativa web con autenticación y permisos.
- `apps/api`: API, cotizaciones, módulos administrativos y migraciones.
- `packages/domain`: reglas tarifarias y máquina de estados compartidas.
- `compose.yaml`: PostgreSQL 16 + PostGIS 3.4 para desarrollo local.
- `docs`: arquitectura y decisiones de base de datos.

## Requisitos para una computadora nueva

1. Git.
2. Node.js 22 o superior.
3. pnpm 11 (`corepack enable` y `corepack prepare pnpm@11.9.0 --activate`).
4. Docker Desktop para PostgreSQL/PostGIS.
5. Flutter estable, Android Studio, Android SDK 30 o superior y JDK 17–25 para la aplicación móvil.

Verifica el entorno móvil con:

```bash
flutter doctor -v
```

## Instalación inicial

```bash
git clone <URL_DEL_REPOSITORIO>
cd mototaxi-atacames
pnpm install
copy apps\api\.env.example apps\api\.env
pnpm db:up
pnpm db:migrate
pnpm test
```

En macOS/Linux cambia `copy` por:

```bash
cp apps/api/.env.example apps/api/.env
```

Antes de un despliegue real, cambia todas las contraseñas y `ADMIN_SESSION_SECRET` en `apps/api/.env`.

## Ejecutar la plataforma

Terminal 1 — API:

```bash
pnpm dev:api
```

Terminal 2 — consola administrativa:

```bash
pnpm dev:admin
```

Abre `http://localhost:3000`. La API escucha en `http://localhost:3001`.

### Usuarios de desarrollo

- Administrador: `admin@mototaxi.local` / `Mototaxi2026!`
- Soporte: `soporte@mototaxi.local` / `Soporte2026!`
- Pasajera de prueba: `pasajera@mototaxi.local` / `Pasajera2026!`
- Conductor de prueba: `conductor@mototaxi.local` / `Conductor2026!`

Las dos últimas cuentas usan `POST /v1/auth/session` y representan el acceso de
la aplicación móvil. No tienen acceso a la consola administrativa.

El administrador puede aprobar/suspender conductores y pasajeros, publicar tarifas, dibujar zonas, consultar auditoría y comprobar PostGIS. Soporte tiene acceso de lectura y puede gestionar incidentes, pero no modificar tarifas, zonas ni aprobaciones.

## Módulos administrativos

- Inicio de sesión firmado con rol `ADMIN` o `SUPPORT`.
- Tablero con métricas y viajes activos.
- Aprobación, rechazo y suspensión de conductores.
- Consulta, suspensión y reactivación de pasajeros.
- Historial y publicación de versiones tarifarias.
- Editor poligonal de zonas urbanas y extendidas.
- Gestión de incidentes y asignación a soporte.
- Registro de auditoría para acciones sensibles.
- Diagnóstico de conexión PostgreSQL/PostGIS.
- Publicidad programable de comercios afiliados en el inicio del pasajero.

### Publicidad dinámica

El administrador puede publicar banners desde el módulo **Publicidad**. El formato del piloto es `1200 × 400 px`, JPG, PNG o WebP, con un máximo de 1 MB. Las imágenes aparecen al pasajero antes de seleccionar origen y destino; no se muestran al conductor para no distraer su operación. La aplicación consulta las campañas vigentes cada cinco minutos y alterna varias piezas cada ocho segundos. Cuando no existen campañas se utiliza el banner demostrativo `Tu publicidad aquí`. Activar, desactivar o cambiar una campaña no requiere recompilar la APK.

Los datos visibles de la consola son datos piloto en memoria para desarrollo. Las migraciones crean el modelo persistente; el siguiente paso de producción es implementar el repositorio PostgreSQL para sustituir el almacén piloto sin cambiar las rutas HTTP.

## PostgreSQL/PostGIS

```bash
pnpm db:up
pnpm db:migrate
pnpm db:down
```

La configuración local predeterminada es:

```text
postgres://mototaxi:mototaxi_local@localhost:5432/mototaxi
```

Las migraciones están en `apps/api/migrations` y se registran en `schema_migrations`. Nunca uses la contraseña local predeterminada en producción.

## Aplicación móvil

```bash
cd apps/mobile
flutter pub get
flutter analyze
flutter test
flutter run
```

Para compilar un APK:

```bash
flutter build apk --release
```

El APK de lanzamiento se conecta de forma predeterminada a la API publicada en
Render. Para trabajar contra la API local desde un emulador, agrega
`--dart-define=API_BASE_URL=http://10.0.2.2:3001` al comando `flutter run`.

Para instalarlo en un teléfono o emulador:

```bash
adb install -r build/app/outputs/flutter-apk/app-debug.apk
```

### Mapas, GPS, tiempo real y chat

- La aplicación ya no inicia con coordenadas fijas de Atacames. El origen se
  obtiene del GPS real del teléfono y origen/destino también pueden marcarse
  tocando el mapa.
- Las rutas viales se consultan a OpenRouteService mediante `ORS_API_KEY`. Si
  el servicio no está disponible, se mantienen los puntos seleccionados y una
  línea directa como respaldo visual.
- La API expone `wss://<host>/v1/realtime` para motos cercanas, ubicación del
  conductor, estados del viaje y chat. La conexión requiere el mismo encabezado
  `Authorization: Bearer <token>` que la API HTTP.
- El chat se limita al pasajero y conductor asignados, conserva historial y usa
  Firebase Cloud Messaging como respaldo cuando la aplicación está en segundo
  plano.
- En un teléfono conectado por USB puede usarse la API local sin conocer la IP
  del computador:

```bash
adb reverse tcp:3001 tcp:3001
flutter build apk --release --dart-define=API_BASE_URL=http://127.0.0.1:3001
```

Para pruebas sin cable debe desplegarse la API actualizada en Render y compilar
sin `API_BASE_URL`; así se utiliza la URL pública configurada por defecto.

### Emulador recomendado para equipos modestos

Crea en Android Studio un `Small Phone`, Android 11/API 30, Google APIs x86_64, 1 GB de RAM y gráficos por software. Después:

```bash
flutter emulators
flutter emulators --launch <ID_DEL_EMULADOR>
flutter run
```

## Calidad

```bash
pnpm test
pnpm test:flow
pnpm typecheck
pnpm build
cd apps/mobile
flutter analyze
flutter test
```

`pnpm test:flow` usa cuentas E2E temporales, recorre una carrera completa con chat y calificaciones y limpia los datos creados al terminar. Requiere PostgreSQL local y haber ejecutado `pnpm db:migrate`.

## Reglas tarifarias iniciales

- Día: 06:00–19:59.
- Noche: 20:00–05:59.
- Casco urbano de día: $0,50 por persona.
- Promoción urbana diurna: exactamente 3 pasajeros por $1 total.
- Noche: $1 por persona, sin promociones.
- Zona extendida: $1 por persona.
- Pago: efectivo.

Las tarifas se versionan y cada viaje conserva una copia histórica de la regla aplicada.

## Seguridad antes de producción

- Sustituir las credenciales de demostración por usuarios persistidos y contraseñas con hash fuerte.
- Rotar `ADMIN_SESSION_SECRET` y usar un gestor de secretos.
- Restringir CORS a dominios autorizados.
- Aplicar HTTPS, límites de intentos, expiración/revocación de sesiones y MFA administrativo.
- Usar almacenamiento privado para documentos y evidencias.
- Definir retención de ubicaciones, auditorías e incidentes.
- Validar permisos, seguros, privacidad y operación de emergencias con asesoría local competente.
