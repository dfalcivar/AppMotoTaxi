# Aplicación móvil

La aplicación se desarrollará en Flutter para compartir código entre Android y iOS.

## Módulos iniciales

- `auth`: registro y verificación telefónica.
- `passenger`: mapa, cotización, solicitud y seguimiento.
- `driver`: aprobación, disponibilidad, ofertas y viaje.
- `shared`: API, ubicación, notificaciones, diseño y almacenamiento seguro.

## Estado actual

La primera interfaz ya está definida en `lib/main.dart`: bienvenida, acceso de
pasajero/conductor y formulario inicial de solicitud.

## Requisito de entorno

Instalar Flutter compatible con el sistema, Android Studio y Xcode. Después se
generarán las carpetas nativas Android/iOS y se conectará la interfaz con
`apps/api`.

El núcleo tarifario ya vive en el servidor; la app solo presenta la cotización recibida y nunca calcula el precio final de manera independiente.

El entorno de trabajo actual reporta macOS 12 y no dispone de Xcode ni Android
Studio. La ejecución del SDK Flutter descargado también falla al inicializar la
VM de Dart en este entorno, por lo que el código móvil requiere validación en
un Mac compatible antes de compilar.
