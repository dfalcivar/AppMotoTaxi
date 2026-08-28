# Costa-Go 0.17.0 (52) — Flota y jornadas

APK universal de validación manual. Esta entrega no genera ni publica un AAB.

## Novedades

- Mis mototaxis: unidades, fotografías, documentos y conductores autorizados.
- Selección y confirmación de la mototaxi antes de iniciar disponibilidad.
- QR de unidad y jornadas con protección ante uso simultáneo y viajes activos.
- Identidad de la mototaxi utilizada en el viaje y su historial.
- Gestión de flotas, propietarios, reportes y auditoría en el panel.
- Incluye los commits previos de perfiles fiscales y seguimiento web del viaje.

## Publicación

API, panel, sitio y aplicación deben actualizarse coordinadamente. Las apps anteriores no confirman jornada y no podrán recibir nuevas ofertas con la nueva API. La emisión fiscal debe permanecer deshabilitada hasta su puesta en marcha expresamente autorizada.

Compilación: firma de producción existente, Maps Google, Sentry, sin proxy privado. El mapa requiere que la clave Android autorice el certificado de firma local además del certificado de Google Play; firmar no sustituye esa configuración.

## Validación previa

- 74 migraciones completadas en PostgreSQL 16/PostGIS 3.4 local aislado.
- Flujo integral local completado con ruta sintética, sin correos ni push reales.
- Suite anterior: API 284, móvil 87, dominio 12 y sitio 14 aprobadas; 2 casos omitidos explícitamente.
- Pendiente en teléfonos: cámara QR, permisos, sesiones y relevos, notificaciones reales y recuperación tras desconexión.

Artefacto esperado: `apps/mobile/release/Costa-Go-0.17.0-build52-universal.apk`.
