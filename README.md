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
flutter build apk --debug
```

Para instalarlo en un teléfono o emulador:

```bash
adb install -r build/app/outputs/flutter-apk/app-debug.apk
```

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
pnpm typecheck
pnpm build
cd apps/mobile
flutter analyze
flutter test
```

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