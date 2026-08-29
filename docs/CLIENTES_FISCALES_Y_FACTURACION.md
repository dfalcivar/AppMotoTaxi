# Clientes fiscales y preparación de facturación — Costa-Go

Estado funcional revisado al 29 de agosto de 2026. La arquitectura está implementada y versionada; la emisión fiscal productiva continúa deshabilitada hasta configurar y autorizar expresamente el proveedor correspondiente.

## Qué funciona ahora

- Cliente separado de usuario/conductor/comercio y perfil fiscal reutilizable, con control de versiones al editar.
- Captura únicamente al pagar: transferencia de membresía, recaudación presencial, enlace comercial seguro y cobro del asesor.
- Mismo QR y mismo enlace de comprobante; no se agregan datos personales al token.
- Panel **Finanzas / Facturación**: Dashboard, Facturas, Clientes fiscales, Pagos y Configuración.
- Auditoría, trazabilidad del pago y copia histórica de datos fiscales independiente del perfil actual.
- Eliminación del perfil reutilizable al eliminar una cuenta; conservación del histórico financiero.
- Cola durable local y adaptadores desactivados para Dátil, Azur y SRI.

No funciona todavía la emisión electrónica real, autorización SRI, descarga de XML/RIDE reales, webhooks ni envío fiscal por correo. Sus acciones están deshabilitadas, no simuladas.

## Arquitectura y archivos

```text
Usuario conductor / Comercio
        │ vínculo por entidad, nunca por coincidencia de correo
        ▼
fiscal_clients ── fiscal_client_links
        │
        ▼
fiscal_profiles (actual, editable y reutilizable)
        │ copia al confirmar un pago
        ▼
Pago aprobado + activación actual + fiscal_billing_outbox
        │ COMMIT del flujo de negocio
        ▼
FacturaService (trabajo independiente, durable)
        ▼
fiscal_invoices (snapshot, referencia única)
        ▼
ProveedorFacturacion → DatilProvider / AzurProvider / SriProvider
                       actualmente sin llamadas externas
```

| Componente | Implementación |
|---|---|
| Esquema y captura transaccional | `apps/api/migrations/072_fiscal_clients_and_invoicing.sql` |
| Identidades, validación y revisiones | `apps/api/src/fiscal/clients.ts` |
| API, permisos y métricas | `apps/api/src/fiscal/routes.ts` |
| Trabajo posterior al pago | `apps/api/src/fiscal/invoices.ts` |
| Contrato de proveedores y configuración | `apps/api/src/fiscal/providers.ts` |
| Panel y formulario compartido | `apps/admin/src/fiscal-admin.tsx`, `fiscal-profile.tsx`, `fiscal.css` |
| Modal móvil | `apps/mobile/lib/fiscal_profile_modal.dart` |
| Enlace comercial existente | `apps/site/src/anunciarme/comprobante/` |

No se duplican datos fiscales en conductores, planes o campañas. Las relaciones nuevas en los pagos son anulables para mantener compatibilidad histórica.

### Reglas de identidad

- Un cliente puede existir sin perfil. Consultar el perfil no crea registros.
- El primer guardado crea cliente, vínculo y perfil dentro de una transacción.
- Cédula: 10 dígitos; RUC: 13; se rechazan identificaciones compuestas solo de ceros. Esta es validación de formato, no consulta ni certificación del SRI.
- Nombre/razón social, dirección y correo fiscal son obligatorios. El contacto comercial no se modifica.
- `expectedRevision` evita sobrescribir cambios realizados desde otra sesión. Un reintento idéntico devuelve el mismo registro sin duplicar auditoría.
- No se fusionan automáticamente personas/comercios por correo o identificación. Las vinculaciones futuras de cooperativas/empresas requieren una operación autorizada específica.

## Flujos de uso

### Conductor: transferencia

Seleccionar plan y confirmar orden → elegir transferencia → registrar/confirmar/modificar datos fiscales → continuar a los datos bancarios → adjuntar comprobante → revisión actual → activación/renovación actual.

El modal usa el tema de Flutter, scroll, área segura y desplazamiento por teclado. No se solicita durante registro ni al abrir Membresías. Una segunda renovación reutiliza el mismo perfil.

### Punto de pago

Generar/consultar QR como antes → recaudador autenticado consulta la orden → formulario fiscal dentro de la orden → guardar si falta → confirmar cobro. Se conservan validaciones de expiración, monto del servidor, asignación del recaudador e idempotencia del pago.

El conductor no completa datos fiscales desde la app para usar el punto de pago. El recaudador no accede al listado fiscal global: únicamente al contexto de cobro autorizado.

### Publicidad

- **Transferencia automática:** Costi finaliza como antes y envía el enlace existente. Ese enlace registra o confirma los datos fiscales antes del formulario de comprobante. Un token vencido/revocado/utilizado no permite editar el perfil.
- **Asesor:** el formulario aparece dentro de Registrar cobro, antes de confirmar la recepción. Continúa el cierre/conciliación actual. El asesor solo puede gestionar órdenes asignadas y no apropiarse del flujo de transferencia automática.
- Finanzas puede consultar Datos fiscales desde las órdenes/pagos comerciales y desde transferencias de membresías.

No cambian la revisión de contenido ni los requisitos actuales para publicar campañas. Recibir un comprobante no equivale a aprobar el pago.

## Pagos, documentos y resiliencia

- Membresía: captura pagos `CONFIRMED`, excluyendo cortesías. Publicidad: captura únicamente `APPROVED` y `RECONCILED`.
- El trigger guarda solo la intención local dentro de la misma transacción. Si falla la activación del negocio, tampoco queda intención fiscal huérfana.
- El worker recoge intenciones confirmadas cada 30 segundos. Usa bloqueos `SKIP LOCKED` y restricciones únicas por origen/pago/tipo de documento.
- `external_reference = costago:ORIGEN:PAGO:TIPO` permanece estable en reintentos.
- Sin proveedor, el documento queda `PENDIENTE_INTEGRACION`; no es error ni factura autorizada.
- El snapshot se fija al aprobar el pago y se copia al documento preparado. Cambiar o eliminar el perfil después no altera esa evidencia financiera.
- Una factura autorizada no permite editar ni borrar sus datos fiscales/importes; solo admite actualizar el seguimiento del envío de correo. Las notas autorizadas también son inmutables.
- Los importes actuales no se alteran: subtotal/IVA quedan pendientes de configuración fiscal, no se inventa una tasa ni se descuenta IVA de los cobros.
- Un pago revertido deja de sumar en Total cobrado. No se borra ni se modifica automáticamente una factura autorizada; una futura nota de crédito tratará su corrección fiscal.
- Un proveedor caído deja `PENDIENTE_REINTENTO`, sin cambiar pago ni membresía/campaña. Un envío que quedó en curso puede recuperarse tras 10 minutos usando la misma referencia.

Antes de integrar un proveedor real deben completarse su idempotencia externa, timeouts, política de reintentos, consulta de estados y webhooks. La protección local por sí sola no sustituye la idempotencia del proveedor remoto.

## Administración y métricas

Acceso: menú **Finanzas / Facturación**.

| Permiso | Alcance |
|---|---|
| `FACTURACION_VER` | Documentos, pagos y configuración sin secretos |
| `FACTURACION_ADMINISTRAR` | Reserva para acciones fiscales reales futuras |
| `CLIENTES_FISCALES_VER` | Listado, perfil y detalle |
| `CLIENTES_FISCALES_EDITAR` | Editar perfil actual, nunca documentos históricos |
| `FACTURACION_DASHBOARD_VER` | Indicadores y filtros |

ADMIN/SUPER_ADMIN poseen los cinco permisos. FINANCE consulta Dashboard/documentos/pagos y edita perfiles, pero no recibe automáticamente administración fiscal. Comercial y recaudadores conservan acceso contextual con sus permisos existentes. Otros roles no reciben acceso global nuevo. Las sesiones antiguas del panel pueden requerir volver a ingresar para renovar permisos.

Total cobrado, Total facturado y Pendiente de facturar son métricas diferentes. Los importes facturados, IVA, gráficos y promedios usan únicamente documentos autorizados. Los filtros operativos se basan en fecha de pago, con días locales de Ecuador; gráficos diarios/mensuales agrupan esos documentos por fecha de autorización. Clientes activos es global y altas fiscales se filtra por fecha de registro; el panel explica este alcance.

Listados paginados de 25 registros. Detalle fiscal muestra las últimas 100 operaciones de auditoría y notas; todos los registros permanecen en la BD. El administrador no puede eliminar histórico desde este módulo.

## Eliminación y privacidad

La transición existente de `users.deleted_at` elimina el vínculo del conductor. Si ya no quedan vínculos para ese cliente, elimina físicamente el perfil reutilizable y desactiva la identidad fiscal. Conserva referencias, pagos, snapshots, documentos y auditoría financiera, sin copiar nuevamente esos datos a un perfil activo.

Una cuenta nueva tiene otra identidad de usuario y no recupera el perfil anterior, aunque repita correo o cédula. No se permite editar un cliente fiscal desactivado. El histórico financiero permanece disponible a los roles autorizados. Los logs no contienen copias del formulario ni respuestas de proveedor con datos personales; respuestas fiscales usan `Cache-Control: private, no-store`.

La política corporativa de conservación del histórico y su plazo debe mantenerse coherente con la política de privacidad. Esta implementación no declara por sí misma cumplimiento tributario ni sustituye revisión contable/legal.

## Configuración segura

```env
FACTURACION_ENABLED=false
FACTURACION_PROVIDER=DATIL
FACTURACION_ENVIRONMENT=TEST
FACTURACION_EMAIL_MODE=PROVIDER
FACTURACION_SMTP_ENABLED=false
FACTURACION_FROM_EMAIL=
```

Los adaptadores tienen `configured=false`: cambiar solamente la variable a `true` no producirá llamadas ni autorizaciones. SMTP no está implementado ni es un requisito actual. No almacenar credenciales reales en Git.

### Futuro proveedor

Completar el adaptador y contrato de emisión/consulta/XML/RIDE/reenvío/nota de crédito, registrar credenciales en entorno, configurar emisor e impuestos, mapear respuestas, validar webhooks autenticados y repetidos, aplicar idempotencia remota y probar con el proveedor. El envío al correo fiscal corresponderá por defecto al proveedor; el esquema ya contempla destinatario, enviado, fecha y estado.

No habilitar automáticamente documentos históricos antiguos sin snapshot fiscal ni enviarlos retrospectivamente al contratar un proveedor. Requieren decisión y revisión contable separadas.

## Publicación coordinada — importante

1. Respaldo de BD y prueba de la migración 072 en entorno de validación.
2. Preparar API, panel, sitio y nueva versión móvil conjuntamente.
3. Ejecutar el migrador normal una sola vez antes de servir el código nuevo. La migración es transaccional y el migrador lleva control de archivos aplicados.
4. Publicar API/panel/sitio y poner disponible la app con el modal fiscal. Mantener emisión desactivada.
5. Ingresar nuevamente al panel si la sesión todavía no trae los permisos nuevos.
6. Validar las rutas de cobro con cuentas de prueba antes de ampliar distribución.

Las órdenes existentes al migrar conservan `fiscal_required=false`, por lo que pueden terminar su revisión sin una captura obligatoria retroactiva. Las órdenes nuevas sí requieren perfil en el momento de pagar.

**Una APK antigua no contiene el formulario fiscal:** no desplegar este cambio como si fuera únicamente de API. Para una orden nueva, quien siga con la app antigua y no tenga perfil deberá actualizar o completar el pago desde un punto autorizado. No se omite silenciosamente la validación. No se ha desplegado ni generado APK/AAB en esta tarea.

La migración crea registros pendientes para cobros históricos confirmados sin inventar identidad. Los indicadores de facturas autorizadas seguirán en cero hasta una integración real. Mantener las tablas al revertir una versión de código; no hacer rollback destructivo de información financiera.

## Pruebas y reproducción

La suite fiscal usa PostgreSQL embebido PGlite y aplica el SQL real de la migración sobre tablas base mínimas. No usa ni modifica producción.

- Fiscal: 28 pruebas de identidad, renovación, revisión concurrente, idempotencia, snapshot, pagos, reversión, borrado, permisos, sesiones, token, métricas e inmutabilidad.
- API completa: 223 pruebas aprobadas, con regresiones de autenticación, búsquedas, tarifas, membresías, cancelaciones y publicidad, además del módulo fiscal; una prueba manual de vista local se omite por defecto.
- Panel: typecheck, build y 14 pruebas existentes.
- Dominio: 12 pruebas.
- Móvil: análisis sin incidencias y 78 pruebas, incluidas 6 del modal fiscal con ambos temas, pantalla pequeña, teclado, errores y doble envío.
- Navegador local: Dashboard/listados/detalles, creación mediante enlace comercial, confirmación para continuar al comprobante y disposición del panel en 390 × 844.

La validación local no equivale a una transferencia bancaria real, escaneo físico en teléfono ni aprobación en producción. Antes de publicar: probar conductor nuevo/existente → transferencia → aprobación → membresía activa; QR en punto → cobro → activación; Costi transferencia y asesor → conciliación → revisión de campaña; eliminación posterior y nueva cuenta. No se ejecutaron operaciones financieras reales durante estas pruebas.

Comandos desde cada directorio indicado:

```powershell
# apps/api
node node_modules/vitest/vitest.mjs run
# apps/admin
node node_modules/vitest/vitest.mjs run --passWithNoTests
node node_modules/vite/bin/vite.js build
# packages/domain
node node_modules/vitest/vitest.mjs run
# apps/mobile
C:\Proyectos\flutter\bin\flutter.bat analyze --no-pub
C:\Proyectos\flutter\bin\flutter.bat test --no-pub
# apps/site
node build.mjs
```

### Vista local reproducible (sin datos reales)

Terminal 1, en `apps/api`:

```powershell
$env:FISCAL_UI_QA='true'
node node_modules/vitest/vitest.mjs run src/fiscal/fiscal.test.ts -t 'manual UI preview'
```

Terminal 2, en la raíz:

```powershell
node scripts/fiscal-qa.mjs
```

Abrir `http://127.0.0.1:3310/fiscal-qa.html`. API local en 3311; solo datos ficticios y sesión de administrador de prueba. El test manual se omite por defecto en CI. No publicar estos servidores. Terminar con POST local `/qa/stop` y Ctrl+C en la vista; la BD en memoria se descarta. El entrypoint QA no se incluye en el build de producción.
