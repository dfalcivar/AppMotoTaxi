# Manifiesto de fuentes documentales

Este paquete fue contrastado con el código vigente del monorepo. Las fuentes principales son:

| Área | Fuentes verificadas |
|---|---|
| Navegación y módulos del panel | `apps/admin/src/main.tsx` y componentes `*-admin.tsx` |
| Autorización | `apps/api/src/permissions.ts`, autenticación y validadores de cada ruta |
| Viajes y realtime | `apps/api/src/app.ts`, `driver.ts`, `passenger.ts`, `realtime.ts` |
| Soporte e incidentes | `apps/api/src/support.ts`, `support-admin.ts` |
| Zonas de cobertura | `apps/api/src/service-areas.ts` y editor web de zonas |
| Membresías y recaudación | `apps/api/src/memberships.ts`, `apps/admin/src/memberships-admin.tsx` |
| Publicidad y comercial | rutas/componentes de advertising/commercial en API, panel y sitio |
| Sitio público | `apps/site/src` y su generador de build |
| Datos | 48 migraciones bajo `apps/api/migrations` |
| Infraestructura | `render.yaml`, Dockerfiles y scripts de paquetes |

Inventarios reproducibles:

- `inventarios/endpoints.json`: 218 endpoints detectados, con archivo y línea.
- `inventarios/tablas.json`: 72 tablas detectadas, columnas y migración fuente.
- `inventarios/documentos.json`: relación entre cada fuente HTML y su PDF.

Las capturas se limitaron a superficies públicas accesibles sin credenciales. Las capturas autenticadas adicionales figuran como pendiente para evitar incorporar datos reales o secretos en el repositorio.
