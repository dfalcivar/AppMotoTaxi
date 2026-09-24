# Campañas Costa-Go: recursos visuales dinámicos

## Entrega y activación

Extiende el motor existente, sin crear otro sistema. Requiere desplegar API/admin, aplicar migración 104 y distribuir una primera actualización Flutter que interprete los nuevos recursos y modos. Después, cambiar imágenes y decoraciones desde administración no requiere otro AAB ni cerrar sesión.

No se crean buckets, cuentas ni cargos automáticamente. El usuario eligió almacenamiento de objetos; falta configurar un bucket real y sus credenciales en Render. Las imágenes existentes conservan lectura desde su almacenamiento histórico. Las pruebas del proveedor usan mocks, no certifican aún el bucket real.

## 1. Campos y DB

| Uso | General | Claro opcional | Oscuro opcional |
|---|---|---|---|
| Miniatura Home | THUMBNAIL | THUMBNAIL_LIGHT | THUMBNAIL_DARK |
| Imagen principal/detalle | MAIN | MAIN_LIGHT | DARK (compatibilidad) |
| Decoración isla | HEADER | HEADER_LIGHT | HEADER_DARK |
| Decoración adicional | DECORATION | DECORATION_LIGHT | DECORATION_DARK |

Migración `104_campaign_visual_resources.sql`: amplía tipos, añade `storage_key` y `metadata` (dimensiones, bytes, transparencia), permite bytes históricos o referencia externa, nunca ambos. Preserva la configuración anterior como AVATAR_ACCENT. Nuevos recursos no almacenan bytes en BD; conserva lectura de los anteriores sin migración destructiva.

Contenido adicional: `headerDecorationMode` (NONE, EDGES, FULL_OVERLAY, AVATAR_ACCENT), `useDecorativeAssetForHeader`, `allowLightAssetsInDark`, `allowMainImageInHome`. `headerAnimationAsset` reservado como null; no admite animación por ahora.

## 2. API y almacenamiento

Mismos endpoints `/v1/admin/costa-go-campaigns` y `/v1/costa-go-campaigns`. Se extiende el catálogo de tipos; PUT de recurso recibe versión, filename, MIME y base64. El listado omite términos/descripción extensa; el detalle conserva contenido completo. Contrato coherente de assets/version entre ambos.

SDK oficial S3, bucket privado. API comprueba sesión, audiencia, vigencia y permisos antes de servir recursos. No expone claves a Flutter. Timeout 15 segundos y dos intentos máximos; errores controlados. Claves SHA-256 inmutables permiten duplicados y lecturas simultáneas.

Configurar en Render → API → Environment:

| Variable | Contenido |
|---|---|
| CAMPAIGN_S3_ENDPOINT | Endpoint HTTPS S3 del proveedor, sin nombre de bucket |
| CAMPAIGN_S3_BUCKET | Nombre del bucket privado |
| CAMPAIGN_S3_REGION | Región; auto para Cloudflare R2 |
| CAMPAIGN_S3_ACCESS_KEY_ID | ID de credencial |
| CAMPAIGN_S3_SECRET_ACCESS_KEY | Secreto de credencial |

Para Cloudflare R2: crear bucket privado, generar credenciales de lectura/escritura restringidas a ese bucket y copiar el endpoint S3. No habilitar acceso público ni dominio público. No requiere disco de Render. Guías oficiales: https://developers.cloudflare.com/r2/get-started/s3/ y https://developers.cloudflare.com/r2/api/tokens/ .

`assetStorageConfigured` en options solo indica configuración presente; la primera carga real comprueba credenciales/conectividad. Sin variables, el panel informa y bloquea nuevas cargas. Los recursos previos continúan disponibles.

## 3. Upload, reemplazo y validaciones

JPG/PNG/WebP estáticos, máximo 2 MB y 4096 px/lado, límite de 16 millones de píxeles. Backend verifica extensión, MIME, formato decodificado, dimensiones y animación; Sharp decodifica, orienta y elimina metadatos. No admite SVG/GIF. HEADER exige PNG/WebP con transparencia real; DECORATION usado expresamente como header debe ser compatible.

La referencia se cambia solo tras validación y almacenamiento correctos, dentro de una transacción con control de versión. Fallos mantienen el recurso anterior. Se registra actor, campaña, tipo, clave anterior/nueva, tamaño, versión y fecha en auditoría. Borrar elimina la referencia sin romper campañas duplicadas. Objetos huérfanos no se eliminan automáticamente: una limpieza futura deberá comprobar referencias.

Cargar o borrar devuelve la campaña a borrador: enviar a aprobación → aprobar → activar. Guardar no publica.

## 4. Administrador

Crear/Editar incluye cuatro grupos explicados con General/Claro/Oscuro. Archivos seleccionados y eliminaciones se aplican al guardar; también pueden administrarse desde el resumen. Campos opcionales, recomendaciones de tamaño, zona segura, transparencia y CTA reales. Miniaturas de recursos y preview aproximado de isla con selector de tema. EDGES suaviza la decoración hacia el centro; FULL_OVERLAY requiere diseño transparente adecuado; AVATAR_ACCENT conserva el detalle pequeño.

## 5. Flutter

- Claro: recurso claro → general → sin imagen.
- Oscuro: oscuro → general → claro solo si admin confirma contraste → sin imagen.
- Home: miniatura del tema; imagen principal solo si admin permite fallback; card textual sin espacio si no hay imagen. Nunca utiliza decoración de isla en la card.
- Detalle: mainImage del tema, cargada al abrir. Error elimina imagen y espacio. Vigencia humanizada en idioma/hora local con MaterialLocalizations.
- Isla: HEADER → DECORATION solo con permiso explícito → pequeño respaldo local de Navidad/Carnaval/Verano → normal. Error de red deja isla normal. No inferencia por fecha o ciudad.
- decorateHeader=false/NONE no carga ni muestra decoración. Una campaña de mayor prioridad decora la isla, independientemente de la card.
- EDGES aplica un desvanecido elíptico: contorno visible y opacidad del 12% en el centro; FULL_OVERLAY detrás del contenido; AVATAR_ACCENT junto al avatar. IgnorePointer y ExcludeSemantics mantienen interacción/accesibilidad.
- Pasajero y conductor comparten RoleAwareHeaderIsland y selección de recursos. Avatar, saludo, campana y badge se mantienen. Durante operación se conserva la supresión de decoración existente.
- CTA real procede del backend. Beneficios usan Benefit Engine, estado activado y vigencia reales; no se vuelve a ofrecer activación ya consumida. Campañas informativas no añaden botón vacío.

## 6. Cache y refresh

Store por sesión, ImageCache de Flutter, URLs autenticadas versionadas por campaña. Rebuilds reutilizan caché; cambios de versión renuevan URL. Home no descarga principal si hay miniatura. Refresh existente al volver al foreground/navegar y cada cinco minutos con vistas observadas; vencimiento mediante temporizador. Detalle también refresca y se oculta al expirar. Sin campaña: isla normal y sin card/espacio.

## 7. Verificación

Pruebas API: migración, permisos, todas las superficies, configuración, formato/transparencia, reemplazo fallido, duplicación, eliminación, vigencia, prioridades, almacenamiento y auditoría. S3 simulado para no usar credenciales reales.

Pruebas Flutter: sin imágenes, solo thumbnail, solo main, ambas, claro/oscuro, cuatro modos, error, reemplazo con nueva URL, refresh, pasajero/conductor, 320 px, texto grande, expiración y prioridades independientes. Pruebas de render de editor administrativo. Builds API/admin y flutter analyze requeridos antes de entrega.

Confirmación de alcance: una vez desplegada esta ampliación y configurado el bucket, las imágenes y decoraciones pueden cargarse/modificarse en administración y reflejarse dinámicamente en Home, detalle e isla superior sin requerir otra versión Flutter para cada campaña.

Resultado local de verificación (24/09/2026): 13 pruebas API/storage, 2 pruebas admin y 33 pruebas Flutter aprobadas. Builds API/admin correctos. Flutter analyze: sin observaciones. No se ha ejecutado la migración en producción ni se ha publicado esta ampliación; falta configurar y probar el bucket real.
