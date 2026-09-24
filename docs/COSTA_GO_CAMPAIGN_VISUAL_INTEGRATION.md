# Integración visual de Campañas Costa-Go

## Entrega

Las Campañas Costa-Go se muestran dinámicamente mediante card en Home y, cuando `decorateHeader=true`, pueden decorar sutilmente la isla superior de pasajero y conductor sin afectar su funcionalidad.

La elegibilidad, audiencia, zonas, vigencia y orden proceden del motor existente. No se agregaron endpoints, DTOs, tablas ni migraciones. Flutter conserva la protección de vencimiento basada en hora del servidor del store existente; no infiere temporadas por fecha, ciudad o título.

## Archivos de esta tarea

- `apps/mobile/lib/costa_go_campaigns.dart`: card compartida, prioridad de imágenes, decoración, actualización compartida y fallbacks.
- `apps/mobile/lib/passenger_experience.dart`: `RoleAwareHeaderIsland`, compartida por pasajero y conductor; decoración anclada exclusivamente al avatar.
- `apps/mobile/lib/main.dart`: eliminado el `actionCard` permanente «Campañas Costa-Go» de Mi cuenta (pantalla de cuenta compartida).
- `apps/mobile/pubspec.yaml`: declaración de recursos estacionales.
- `apps/mobile/assets/campaigns/header/{christmas_hat,carnival_mask,summer_detail}.{svg,png}`: vectores fuente y PNG transparentes de 96×64; juntos los PNG pesan menos de 8 KB.
- `apps/mobile/test/costa_go_home_test.dart`: expectativas adaptadas a los nuevos recursos.
- `apps/mobile/test/costa_go_campaign_visual_test.dart`: nuevos casos de decoración, estados, temas, vigencia y selección de imágenes.
- `apps/mobile/test/costa_go_campaign_images_test.dart`: carga HTTP simulada exitosa de miniatura y recurso decorativo independiente.

Los otros cambios visuales del árbol de trabajo pertenecen a las tareas anteriores y se conservaron.

## Home y card

Se reutilizan `CostaGoHomeCampaigns` y `CostaGoCampaignCard`. Pasajero: entre `CostaGoHomeHeader` y los cuatro accesos. Conductor: antes del contenido operativo del sheet, conservando sus controles; solo cuando no hay viaje activo ni ofertas. La isla también recibe `enabled: false` durante operación.

Sin campaña HOME, carga inicial o error: `SizedBox.shrink`, sin espacio reservado ni mensaje. Con campaña: primera HOME en el orden del servidor, entrada con fade de 180 ms. Sin imagen, o si falla: solo contenido textual, sin rectángulo ni icono genérico.

Imagen: THUMBNAIL primero; luego DARK en tema oscuro, MAIN en claro; una sola imagen se reutiliza en ambos. DECORATION nunca se usa como imagen de card. Se utiliza Image.network con autenticación, caché de Flutter, versión en URL y tamaño de decodificación reducido para Home.

CTA: texto configurado y rutas reales existentes. Se revalida el detalle antes de actuar; detalle genérico, membresía, soporte, rutas internas permitidas y URL externa con confirmación existente. NONE no añade botón. REFERRAL sigue deshabilitado por el backend porque no tiene destino móvil; no se creó ruta ficticia.

## Isla estacional

Se reutiliza `CostaGoCampaignHeaderDecoration` para ambos roles. Selecciona la primera campaña aplicable con `decorateHeader=true`, conservando el orden recibido, independientemente de HOME. No combina decoraciones ni busca otra campaña para reemplazar DEFAULT: DEFAULT deja isla normal.

Overlay de 25×19, anclado en la esquina superior del avatar de 46×46. `IgnorePointer` y `ExcludeSemantics` preservan interacción y lectura del contenido. Avatar, nombre, saludo, subtítulo, campana y badge no cambian.

Prioridad: recurso autenticado `DECORATION` de la campaña. Sin recurso o con error: gorro local para CHRISTMAS, antifaz para CARNIVAL, sol costero para SUMMER. CUSTOM sin recurso válido: isla normal. MAIN, DARK y THUMBNAIL no se utilizan como decoración. El contrato actual dispone de un único DECORATION, compartido por ambos temas; no se inventaron campos de variantes remotas que el panel no administra. Los recursos locales se revisaron en Light/Dark.

## Actualización

El mismo `CostaGoCampaignStore` mantiene un único observador/refresco periódico mientras card o isla estén montadas. Refresca al volver al primer plano, conserva la caducidad automática y limpia resultados ante error. Cambios de prioridad, pausas o activaciones llegan en el refresco (TTL existente: 5 minutos), sin cerrar sesión. La decoración continúa refrescándose aunque no exista card HOME.

## Validación

- 9 pruebas de backend existentes: audiencia pasajero/conductor/ambos, zona, prioridad, estados, autorización, cambios y recursos.
- 194 pruebas de la suite móvil completas correctas antes del último ajuste de fallback para imagen única.
- La selección final de imagen única y las pruebas focalizadas se registran en `apps/mobile/build/campaign-final-tests.log`.
- `flutter analyze`: resultado en `apps/mobile/build/campaign-integration-analyze.log`.
- Vista aislada de los componentes en Light/Dark, con fixtures: `apps/mobile/build/campaign-components-review.png`. No son campañas de producción ni se incorporan sus textos a la app.
- Pruebas cubren recursos remotos cargados y rotos, CUSTOM, DEFAULT, opt-in, expiración en sesión, pausa, error API, prioridad desacoplada, avatar táctil, texto grande y ancho de 320 px.

No se activaron campañas ni se modificaron usuarios, viajes, pagos, publicidad o datos de producción. Esta entrega contiene cambios locales; no se hizo commit ni despliegue.

Resultado final: flutter analyze sin incidencias (37,8 s). Suite focalizada final: 33 pruebas correctas, incluyendo el fallback de imagen única. git diff --check sin errores.
