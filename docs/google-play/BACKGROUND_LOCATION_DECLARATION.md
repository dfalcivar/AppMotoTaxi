# Declaración de ubicación en segundo plano

## Función principal

Costa-Go utiliza ubicación en segundo plano para que un conductor disponible o con un viaje asignado pueda seguir recibiendo solicitudes, mantener actualizada su posición y continuar el seguimiento y la navegación del servicio cuando minimiza la aplicación, bloquea la pantalla o atiende temporalmente otra actividad. Esto permite que el pasajero vea el avance real y que el viaje conserve continuidad.

La selección de origen del pasajero utiliza ubicación para elegir el punto de recogida. La justificación de segundo plano se centra en el rol conductor y en la prestación del servicio de transporte.

## Texto breve sugerido para el formulario de Google

`La ubicación en segundo plano es necesaria para el conductor cuando está disponible o tiene un viaje activo. Permite recibir solicitudes cercanas, enviar su posición al pasajero y mantener el seguimiento y la navegación aunque Costa-Go esté minimizada o la pantalla se bloquee. La función es visible para el usuario, utiliza una notificación persistente del sistema y no emplea la ubicación para publicidad.`

## Divulgación destacada existente en la app

Antes de solicitar el permiso, Costa-Go muestra:

> Costa-Go recopila datos de ubicación para seleccionar el punto de recogida, encontrar viajes o conductores cercanos, mantener el seguimiento y guiar al conductor durante un viaje, incluso cuando la aplicación está cerrada o no está en uso. Durante un viaje, la ubicación necesaria se comparte con la otra persona asignada y con los servicios de Costa-Go. No se utiliza para publicidad.

No cambiar este texto sin actualizar también la política de privacidad, el video y la declaración en Play Console.

## Guion de video demostrativo — 60 a 90 segundos

Grabar un dispositivo Android real y mostrar de forma continua:

1. Abrir Costa-Go e iniciar sesión con una cuenta de conductor aprobada.
2. Entrar a la pantalla que activa disponibilidad o requiere seguimiento.
3. Mostrar completa la divulgación destacada de Costa-Go **antes** del diálogo de permisos de Android.
4. Pulsar continuar y mostrar la selección de ubicación precisa y la autorización solicitada por el sistema.
5. Activar “Recibir viajes” o aceptar una solicitud de prueba.
6. Mostrar la notificación persistente que informa que la ubicación está activa.
7. Minimizar la app o bloquear brevemente la pantalla.
8. En un segundo teléfono con pasajero, mostrar que la ubicación del conductor continúa actualizándose; si no se puede grabar simultáneamente, volver al conductor y mostrar continuidad del viaje.
9. Regresar a Costa-Go, finalizar la disponibilidad o el viaje y mostrar que la sesión de seguimiento concluye.

Requisitos del video:

- Debe mostrar la versión real enviada a revisión y no una maqueta.
- No debe exponer correo, teléfono, domicilio, token ni credenciales reales.
- Subir a YouTube como **No listado**, sin restricción de acceso, e ingresar el enlace en Play Console.
- La función y el texto deben poder identificarse claramente; no usar cortes que oculten la secuencia del permiso.

## Control técnico antes de enviar

- Verificar que el servicio de ubicación se detenga al desactivar disponibilidad o finalizar el viaje.
- Verificar la notificación persistente en Android 9, 11, 13 y una versión reciente.
- Comprobar permiso rechazado, “solo mientras se usa” y permiso preciso.
- Confirmar que la política pública abre sin iniciar sesión.
