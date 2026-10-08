# Centro de Ayuda Costa-Go

La web pública sirve `/ayuda` y los artículos en `/ayuda/{slug}`. El contenido proviene de `help_articles`; solo aparecen registros `PUBLISHED`. Las categorías sin artículos publicados no se muestran. Las preguntas frecuentes se leen de `support_faqs`, ya administradas desde Soporte.

## Primer tutorial real

`/ayuda/vincular-mototaxi` usa el flujo documentado en la app: Inicio → foto o saludo → Mi perfil → Mis mototaxis → Agregar mototaxi. Explica Nueva unidad, Vincular existente, revisión de la mototaxi y autorización del conductor, selección de la unidad y disponibilidad. El número de unidad debe verse claro en la foto. El video es el MP4 narrado entregado por el usuario. El PDF público conserva las capturas del manual original y omite la página 4, dirigida al personal del panel. El manual de cinco páginas original permanece en `output/manual-flota` para uso interno; no se publica desde la web.

La aplicación no tiene hoy un enlace profundo general a «Mis mototaxis». El botón «Abrir Costa-Go» lleva a la ficha oficial de Google Play, que muestra «Abrir» cuando la app está instalada. El artículo explica la ruta manual dentro de la app. Este límite evita inventar una ruta móvil que no existe.

## Administrar

Panel → Contenido → Centro de ayuda. `help:view` permite consultar; `help:manage` permite crear, editar, subir archivos, publicar, ocultar y eliminar artículos que nunca se publicaron. El slug se fija al crear el artículo para conservar enlaces compartidos. Borrador y Oculto no son accesibles públicamente. Para retirar un artículo publicado, cambiarlo a Oculto; su enlace no se recicla.

1. Crear tutorial con título, resumen, pasos verificados, categoría y audiencia.
2. Guardarlo como Borrador; subir portada, MP4 o PDF si aplica. Máximo 5 MB por archivo. Los nuevos archivos se guardan en el mismo bucket R2 privado configurado para campañas, bajo claves `help/`.
3. Revisar la vista pública y cambiar el estado a Publicado. No se necesita una actualización de la APK para cambios de texto o archivos.
4. En Campañas Costa-Go, elegir «Enlace externo HTTPS» y seleccionar el tutorial publicado. Abrir el tutorial no activa beneficios.
5. En campañas de notificaciones, seleccionar el tutorial publicado. El panel configura una URL oficial; no envía ninguna notificación al guardar el borrador. La app actualizada reconoce la ruta al tocar una notificación, también al abrirse desde cero por FCM.

## Despliegue y verificación

- Aplicar `108_help_center.sql` con el mecanismo de migraciones habitual antes de utilizar los endpoints.
- Mantener las variables `CAMPAIGN_S3_ENDPOINT`, `CAMPAIGN_S3_BUCKET`, `CAMPAIGN_S3_ACCESS_KEY_ID` y `CAMPAIGN_S3_SECRET_ACCESS_KEY` existentes. No hay disco de Render ni variables nuevas.
- Desplegar API, panel y web juntos. Verificar `/v1/help/articles`, `/ayuda` y `/ayuda/vincular-mototaxi` en móvil y escritorio, incluyendo reproducción del MP4 y apertura/descarga del PDF.
- Probar la carga de un recurso desde el panel, confirmar la lectura pública y verificar que Borrador/Oculto no aparecen. Probar una campaña con enlace sin asociar beneficio.
- Para abrir tutoriales desde notificaciones push se requiere un APK/AAB nuevo con los cambios de Flutter. No enviar notificaciones reales hasta instalar esa versión y validar una prueba controlada.

No se ejecutó ninguna publicación ni envío de notificaciones durante esta implementación.
