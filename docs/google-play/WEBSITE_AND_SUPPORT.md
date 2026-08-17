# Sitio público y correo de soporte

## Correo — configurado

La ficha de Google Play utilizará `soporte@costa-go.com`, cuya recepción fue verificada mediante Cloudflare Email Routing. El remitente transaccional de Resend (`notificaciones@costa-go.com`) permanece separado.

Configuración recomendada:

1. En Cloudflare, abrir **Email → Email Routing**.
2. Crear `soporte@costa-go.com`.
3. Enviar sus mensajes a un buzón que el equipo revise diariamente.
4. Confirmar la dirección de destino desde el correo recibido.
5. Probar desde una cuenta externa y responder el mensaje.
6. Solo después, registrar `soporte@costa-go.com` en Play Console y en las páginas públicas.

Resend puede seguir enviando correos automáticos desde `Costa-Go <notificaciones@costa-go.com>`; soporte y notificaciones cumplen funciones diferentes.

## Sitio web

`costa-go.com` debe mostrar una página pública, no el inicio de sesión del panel administrativo. Debe incluir como mínimo:

- identidad y descripción de Costa-Go;
- cómo funciona para pasajero y conductor;
- zonas de disponibilidad;
- contacto de soporte;
- enlaces a política de privacidad, términos, tarifas y eliminación de cuenta;
- enlace a Google Play cuando la ficha exista.

Arquitectura recomendada:

- `https://costa-go.com`: sitio público.
- `https://admin.costa-go.com`: panel administrativo.
- `https://api.costa-go.com`: API, si posteriormente se configura un dominio propio.

Mientras se realiza esa separación, las páginas legales de Render siguen siendo válidas si permanecen públicas, estables y disponibles por HTTPS.

## Validación antes de enviar a Google

- Abrir todas las URLs desde navegación privada y desde datos móviles.
- Comprobar que no soliciten inicio de sesión.
- Confirmar que no exista advertencia TLS.
- Verificar que el correo de soporte no rebote.
- Revisar que la marca sea Costa-Go y no conserve textos visibles de AtacamesGo/Mototaxi Atacames.
