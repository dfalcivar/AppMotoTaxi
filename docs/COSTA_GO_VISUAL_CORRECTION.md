# Corrección de dirección visual Costa-Go

## Diferencias detectadas
La versión anterior ocultaba el lema en teléfonos, usaba un saludo de una línea, un sheet inicialmente bajo, tarjetas de diferente altura y una decoración geométrica que no reproducía el paisaje aprobado. El acceso conservaba la tarjeta genérica sobre fondo plano.

## Primer hito
- Login: fotografía costera existente, capa tonal adaptada al tema, emblema oficial sin caja azul, marca y lema, formulario con superficie común. Conserva controladores, credenciales, biometría, recuperación y registro.
- Home: saludo real de dos líneas y campana independiente; panel inicial al 60%, marca azul/navy, lema visible, cuatro accesos uniformes con chevron.
- Transparencia: gradiente alpha 0.72–0.62 sobre el mapa, borde superior y sombra suave; con un único BackdropFilter de sigma 8 recortado al panel. La primera captura oscura mostró etiquetas del mapa demasiado legibles detrás del título; el desenfoque corrige esa interferencia. Paneles financieros mantienen fondo opaco para evitar texto superpuesto.
- Paisaje: PNG transparente reutilizable con palmeras, mar, horizonte, colinas, velero, aves y ondas. Intensidad media en Home y acceso, tenue en formularios y páginas secundarias. No es una campaña ni contiene texto.
- Tarjetas: CostaGoCard comparte superficie, borde, radio y sombra. CostaGoQuickActionGrid usa IntrinsicHeight por fila de dos tarjetas; no fija alturas ni corta texto. Debajo de 340 puntos disponibles o con escala de texto superior a 1.3 usa una columna.
- Header: conserva el asset oficial. Con texto ampliado, el lema pasa a otra línea en lugar de desaparecer.
- Campañas: continúa exclusivamente el resultado del motor HOME. Sin resultado no hay tarjeta ni espacio reservado.

## Alcance funcional
No se modifican endpoints, autenticación, tarifas, pagos, GPS, campañas, anuncios ni notificaciones. Solo cambian composición, proporciones y superficies.

## Recurso generado
Archivo: apps/mobile/assets/images/coastal-landscape.png.
Herramienta integrada image_gen (sin CLI ni API key). Prompt utilizado:
“Create a production UI decorative footer asset, landscape 1536x1024, genuinely transparent background. Elegant coastal silhouette illustration in cyan and pale sky blue only, intended for Costa-Go mobile frosted glass interface. Detailed graceful palm clusters at both far edges leaning inward, layered flowing sea waves along bottom, distant coastal hills and small sun on horizon, small sailboat left of center, 3 tiny seabirds. Airy upper half mostly transparent negative space; artwork occupies lower 45%, palms rise on edges to 65%. Crisp professional vector-like illustration with soft tonal depth, fine individual palm leaflets. No text, no logo, no phone, no UI, no rectangular white background. The palette should be blue #52b9ef, #8dd6fa, #c4eafa with translucent areas. This is a decorative background layer, not a mockup. Save output image for use in project.”

## Propagación
El conductor reutiliza el encabezado, isla superior, sheet y decoración. Se mantienen disponibilidad, GPS, viajes programados, selección de mototaxi y espera de solicitudes.

CostaGoScaffold y el wrapper de sheets ya estaban conectados en la fase anterior; al sustituir su decoración se actualizan Mi cuenta, Perfil, Actividad, detalle de viaje, flota, soporte, notificaciones, campañas y comercios. CostaGoSurface y _PassengerSurface ahora derivan de CostaGoCard, propagando superficies a solicitud de viaje, wallet, membresías y ganancias. CostaGoFormSection usa la misma tarjeta. CardTheme y DialogTheme comparten radios de 24 y 36 puntos respectivamente.

## Verificación y límites
- flutter analyze: sin problemas.
- Suite Flutter completa después de unificar superficies: 182 pruebas correctas.
- Prueba añadida: igualdad real de alturas en una fila con textos de diferente longitud.
- Pruebas existentes: escalas 1 y 1.8, anchos 320/430, teclado, claro/oscuro, campañas ausentes/pausadas y destino real del CTA, flota y lógica operativa.
- Capturas reales del Home pasajero y acceso en ambos temas comparadas con referencia. Se conserva el mapa real y no se introducen los datos ficticios del mock.
- Diferencias deliberadas: iconos lineales consistentes en las cuatro tarjetas; lema tipográfico en lugar de imagen; el mapa y la foto corresponden al usuario real. Los textos se reacomodan según ancho disponible.
- Pendiente de verificación manual: estados con viaje activo real, compra/pago y carga de documentos. No se ejecutaron transacciones para validar una tarea visual. La decoración está conectada a sus contenedores; esto no equivale a una prueba operativa completa.
- No se ha medido rendimiento en teléfono físico de gama baja; el desenfoque está limitado al sheet sobre el mapa, desactivado en formularios financieros.
- La aprobación estética final corresponde a la revisión del APK. No se afirma coincidencia pixel a pixel con una maqueta de otro tamaño.

## APK de revisión
Costa-Go 0.18.8+69, compilado con MAP_PROVIDER=google y API_HTTP_PROXY=http://10.2.2.5:3128.
Archivo: apps/mobile/release/Costa-Go-0.18.8-build69-coastal-correction-proxy.apk.
SHA256: 647131FC7383F0DEB44B3423E09820F3220A27CE87C19CDA3E9E8AD7827C9C6B.
Instalación con conservación de datos: emulator-5554, emulator-5556 y emulator-5558, las tres con Success. Se dejaron abiertos.
Capturas finales en apps/mobile/build: correction-home-light-final.png, correction-home-dark-final.png, correction-login-dark-final.png y correction-driver-final.png.
Revisión adicional después del desenfoque: analyze sin problemas y 21 pruebas de diseño/Home correctas.
El emulador del conductor demoró la captura; finalmente se obtuvo sin reiniciarlo. Su mapa aún estaba cargando en esa captura. No se cambió disponibilidad.
Cambios locales, sin publicación nueva en Play Console ni despliegue del backend (no hay cambios de API).

## Refinamiento: firma costera sutil
- Opacidad de intensidad media: 0.65 → 0.22; sutil: 0.22 → 0.09.
- Saturación al 25%, contraste al 75% y sombras levantadas hacia azul pálido mediante un filtro exclusivo de la decoración.
- Desenfoque de 0.7 puntos solo sobre la ilustración para atenuar hojas y espuma fina; los controles permanecen nítidos.
- Máscara vertical: transparente arriba, 4% al 40% de altura, 45% al 68%, completa en el borde inferior. La opacidad global se aplica además de la máscara.
- Aves conservadas en el original pero prácticamente imperceptibles por el desvanecido y la menor opacidad.
- Se preserva la composición de palmeras laterales, horizonte y olas. No se alteran datos, campañas ni acciones.

Validación del refinamiento: flutter analyze sin problemas; 21 pruebas de diseño/Home correctas. Captura real revisada: apps/mobile/build/coastal-subtle-home.png. El fondo queda tenue bajo las tarjetas y las ondas se concentran en el pie.
APK actualizado: apps/mobile/release/Costa-Go-0.18.8-build69-coastal-subtle-proxy.apk.
SHA256: 4B6BF3FF989434D4D029D39E795D8720C36D619094067EBC36AD1C9E9DA489E3.

## Acceso con fondo continuo
El layout Login compartido por pasajero y conductor extiende el body detrás del AppBar. AppBar y status bar transparentes, título y controles claros sobre el hero, sin elevación ni tinte al hacer scroll. SafeArea protege solo el contenido y se reserva el alto del toolbar dentro del scroll; la imagen cubre toda la pantalla desde el borde superior. La altura mínima del formulario se limita a cero con teclado para evitar restricciones negativas.
Validación del acceso continuo: flutter analyze sin problemas; APK access-fullscreen-proxy instalado correctamente en emulator-5554/5556/5558 preservando sesiones. Se encontró una sesión nueva de Juan en 5558 y no se cerró. Las vistas reales de Login para ambos roles se renderizaron en un harness aislado de Flutter (sin operaciones de autenticación), ambas sin excepciones y con la imagen hasta el borde superior. Capturas de widgets: build/access-fullscreen-passenger-preview.png y build/access-fullscreen-driver-preview.png. Estas no son capturas de la barra de estado nativa; su estilo transparente y sus iconos claros están configurados en AppBar.systemOverlayStyle.

## Equilibrio costero y lema original
Opacidad media 0.38 y sutil 0.17; saturación 45%, contraste 85%. Máscara vertical conservada, con presencia un poco mayor en extremos y pie; el centro superior continúa transparente. Desenfoque de detalle de 0.5 puntos solo en la decoración.

Lema: assets/images/costa-go-slogan-reference.png es una copia sin editar del recorte proporcionado por el usuario. El header muestra ese dibujo (caligrafía, inclinación y ondas), con un filtro de color/alpha de Flutter para separar azul y fondo pálido; no usa otra tipografía. Semantics conserva el texto «Juntos llegamos más lejos». La extracción generativa evaluada se descartó porque engrosaba las letras. Se conserva la resolución original de la referencia.

Validación del equilibrio final: flutter analyze sin incidencias, 21 pruebas de Home/diseño correctas y dos renderizados aislados del lema sin excepciones. Captura del APK final revisada en build/coastal-balanced-home.png; filtro alpha elimina residuos pálidos en las esquinas. APK con proxy instalado correctamente en emulator-5554, emulator-5556 y emulator-5558, preservando sus sesiones y dejándolos abiertos.
APK: apps/mobile/release/Costa-Go-0.18.8-build69-coastal-balanced-proxy.apk.
SHA256: 5BD3A1AF0647D55B725B526429F86DB23EB10D0E24A8158A56FCC19CB79DF1B2.
