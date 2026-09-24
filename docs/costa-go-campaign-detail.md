# Detalle genérico de campaña

## Composición
`CostaGoCampaignDetail` conserva la consulta autenticada y las acciones existentes. `CostaGoCampaignDetailContent` organiza título, subtítulo, descripción, imagen opcional, beneficio/CTA, vigencia humanizada y términos inicialmente colapsados. Sin imagen ni beneficio no se reserva un bloque vacío. El contenido puede crecer y desplazarse con texto aumentado.

`CostaGoBenefitPanel` consulta y activa mediante el servicio existente. `CostaGoBenefitCard` representa datos, estado y una sola acción; no muestra el nombre interno. Acepta `benefitVisualAsset` opcional como Widget para una futura integración administrativa. Por defecto usa iconos Material según el tipo: regalo, billetera, etiqueta, porcentaje, ticket y personas.

La API agrega `valueLabel` y `typeLabel` en `definition`, calculados con el valor real. No se migran datos ni se cambia la elegibilidad o ejecución de recompensas. Los tipos reservados siguen reservados: sus textos/iconos no habilitan nuevos beneficios. Tipos sin unidad conocida muestran “Tu beneficio”, sin inventar unidades ni recompensas.

## Estados
- AVAILABLE: CTA de campaña, deshabilitado mientras se procesa.
- CLAIMED / ALREADY_REDEEMED / canje existente: beneficio activado, sin segunda activación.
- PENDING: activado con inicio programado, fechas reales del canje.
- USED / CONSUMED: utilizado.
- EXPIRED: vencido.
- No elegible: mensaje funcional del servidor, sin CTA.
- Fallo de consulta/activación: mensaje comprensible y reconsulta; no se expone la excepción técnica.

El límite de una sola vez se muestra solo si backend devuelve `oneTime=true` o `maxPerUser=1`. Fechas según localización del dispositivo, usando los timestamps del backend. Los CTA externos conservan la validación HTTPS y confirmación de dominio.

## Temas y validación
Misma estructura en claro/oscuro; fondo suave/navy, card diferenciada, icono y CTA primarios y decoración costera compartida. Sin altura fija del contenido ni truncado del valor. Pruebas a 320 px con escala 1 y 2, campañas informativas, cortesía y saldo, estados y reactivación, imágenes dinámicas y términos colapsados.

Validación: 44 pruebas Flutter (beneficios, detalle, campañas, imágenes y decoración), 22 pruebas API (beneficios y presentación), compilación API. La captura de widget puede regenerarse con `CAPTURE_CAMPAIGN=true`, `REVIEW_FONT` y `REVIEW_ICONS` apuntando a fuentes locales; no son requisitos de la app.

## Publicación
Cambios locales: publicar API antes del APK, porque Flutter consume los nuevos textos públicos. Hasta entonces el fallback es “Tu beneficio”. No se ha cambiado ninguna campaña ni activado recompensas reales para probar.
