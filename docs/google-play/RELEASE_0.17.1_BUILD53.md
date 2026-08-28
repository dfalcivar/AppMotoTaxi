# Costa-Go 0.17.1 (53) — Flota y experiencia visual

## Datos para Play Console

- Nombre de versión: **Costa-Go 0.17.1 - Flota y mejoras visuales**.
- Código: **53**. Paquete: `ec.atacames.mototaxi.mototaxi_atacames` (sin cambios).
- Archivo: `apps/mobile/release/Costa-Go-0.17.1-build53.aab`.
- Firma de producción existente, Google Maps, Sentry, entorno production y sin proxy privado.

Notas para copiar (es-419):

```text
<es-419>
• Gestión de mototaxis, flotas y jornadas de conducción.
• Una cuenta puede viajar, conducir y administrar sus propias unidades.
• Fotos reales de las mototaxis en selección, viajes e historial.
• Nuevos iconos y mejoras visuales en modo claro y oscuro.
• Confirmación de unidad y opciones para pausar o finalizar jornada.
• Seguimiento del viaje compartido desde la web.
• Mejoras de estabilidad y seguridad.
</es-419>
```

## Alcance

Incluye el trabajo acumulado anterior: flota, relaciones de propietarios y conductores, jornadas, perfiles fiscales y seguimiento web. La versión 52 se distribuyó como APK de validación; este AAB incorpora además las capacidades simultáneas y la presentación de fotos/iconos. La emisión fiscal continúa deshabilitada; no se cambian parámetros productivos de facturación.

Las fotos originales y sus identificadores históricos permanecen intactos. Las miniaturas normalizan orientación, proporción y tamaño sin inventar vehículos ni eliminar su fondo. Se reutilizan las columnas y endpoints existentes. No hay migraciones nuevas respecto de la versión 52.

## Compatibilidad y publicación

- La API/panel nueva mantiene compatibilidad con la APK 52 ya instalada.
- Las apps anteriores a la introducción de jornadas (51 o anteriores) no confirman unidad y deben actualizarse para que el conductor reciba nuevas solicitudes.
- Publicar primero en prueba interna, verificar pasajero/conductor/propietario y luego promover el mismo artefacto a prueba cerrada.
- No requiere desinstalar si la instalación proviene de Google Play. Una APK local puede tener una firma distinta de Play App Signing.
- La clave Android debe autorizar el certificado de firma de Google Play; firmar el AAB no cambia las restricciones de Google Maps.

## Verificaciones

- API: 297 pruebas aprobadas, 2 fixtures manuales omitidos.
- Flutter: 103 pruebas aprobadas; 25 de flota repetidas tras los últimos ajustes.
- TypeScript API/panel y análisis Flutter sin errores.
- Panel compilado e inspeccionado localmente en claro/oscuro y ancho de teléfono. Advertencia no bloqueante de Vite por tamaño del bundle principal.
- No se realizaron pruebas físicas de cámara, GPS, notificaciones o fotos productivas en esta revisión. Validarlas desde la pista interna antes de promover a cerrada.

## Comprobación en teléfonos

1. Ingreso y mapa con la versión instalada desde Play.
2. Mis mototaxis/Mi flota según capacidades; propietario no conductor sin permiso de iniciar jornada.
3. Selección de unidad y foto, disponibilidad, pausa y finalización de jornada.
4. Solicitud/aceptación de viaje y visualización de la unidad correcta por el pasajero.
5. Histórico conserva la foto de la unidad utilizada aunque luego cambie la foto de perfil del vehículo.
6. Tema claro/oscuro, imágenes ausentes y recuperación de conectividad.
