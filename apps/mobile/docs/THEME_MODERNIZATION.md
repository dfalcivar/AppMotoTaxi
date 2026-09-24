# Auditoría y modernización visual de Costa-Go

## Estado encontrado

- `lib/main.dart` contiene la navegación, las pantallas principales y la lógica de presentación. Otros widgets viven en archivos especializados como `live_map.dart`, `driver_earnings_sheet.dart` y `affiliate_banners.dart`.
- El estado de las pantallas usa `StatefulWidget`/`setState`; la apariencia usa `ValueNotifier`. No hay Provider, Bloc ni Riverpod.
- `MaterialApp` ya tenía `theme`, `darkTheme` y `themeMode`; `CostaGoTheme` ya usaba Material 3, `ColorScheme`, extensiones semánticas, tipografía y componentes compartidos.
- La preferencia `themeMode` ya se guardaba mediante `SharedPreferences`. Se separó el controlador a `app_theme_controller.dart` sin cambiar el formato guardado. El valor ausente o desconocido significa `ThemeMode.system`.
- La auditoría encontró aproximadamente 244 referencias directas a `Colors.*` o `Color(0x...)` en `lib/`. Algunas son tokens centrales, colores de fotografía o marcadores; otras aún pertenecen a pantallas antiguas.
- `LiveMap` ya seleccionaba mapas Google claros/oscuros o estilos JSON locales según `Theme.of(context).brightness`. Sus marcadores y rutas permanecen intactos.
- Se encontraron hojas y diálogos personalizados y componentes compartidos como `CostaGoSurface`, `CostaGoStatusChip`, `CostaGoEmptyState` y `CostaGoSheetHeader`.

## Cambios de esta etapa

- La opción Apariencia ahora presenta una hoja con Automático, Claro y Oscuro desde bienvenida, login y perfil. La elección se conserva localmente.
- Las superficies compartidas y las tarjetas del inicio de pasajero ganan una elevación suave y consistente con ambos temas.
- La bienvenida mantiene la fotografía costera y el logo; mejora el contraste mediante un overlay temático y un panel translúcido sin desenfoque.
- Las tarjetas de planes de membresía son responsivas y muestran juntos nombre, precio, IVA, viajes, vigencia y acción; se retiró la altura fija que dejaba espacio vacío.
- Perfil y Ganancias utilizan skeletons ligeros durante la carga principal.
- La barra de estado y la de navegación siguen el tema; la bienvenida mantiene iconos claros sobre la fotografía. El mapa conserva sus estilos de día y noche existentes.
- Se conserva `SafeArea` y la configuración Android actual; no se fuerza un modo edge-to-edge nuevo sobre los mapas y teclados.

## Diseño y evolución

La paleta sigue en `costa_go_design.dart`: claro con fondo frío, superficie blanca, azul Costa-Go y texto navy; oscuro con niveles navy y gris azulado, azul más luminoso y texto suave. Los tonos de éxito, aviso y error están en `CostaGoSemanticColors`. `CostaGoSpace`, `CostaGoRadius` y `CostaGoElevation` centralizan tamaño y profundidad.

Automático significa **seguir el sistema**. `MaterialApp` se recompone al cambiar la preferencia y Flutter reacciona a los cambios de brillo del teléfono mientras la aplicación permanece abierta. Un futuro modo por horario podría añadirse como una elección distinta en `AppThemeController`, con un temporizador para el siguiente límite horario; no se incluye para evitar complejidad innecesaria ni sustituir la opción del sistema.

La transición restante puede continuar por actividad, detalles de viaje, formularios secundarios y los colores directos aún justificados por cada pantalla. Los banners remotos actuales (`affiliate_banners.dart`) ya usan `ColorScheme`; una futura capa estacional debería configurar solo acentos y recursos visuales desde backend, sin codificar una festividad en las pantallas.

Esta etapa no cambia solicitudes, viajes, disponibilidad, tarifas, comisiones, membresías, pagos, publicidad, notificaciones ni autenticación. La tarjeta de planes recibe los mismos datos y ejecuta el mismo callback de selección anterior.
