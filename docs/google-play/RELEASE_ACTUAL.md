# Versión para Play Console

Actualizado el 24 de septiembre de 2026.

- Aplicación: Costa-Go
- Versión: `0.18.9`
- Código de versión: `70`
- Versión anterior subida: `0.18.8 (69)`
- Application ID: `ec.atacames.mototaxi.mototaxi_atacames`
- Canal: elegir en Play Console
- Entorno de compilación: `production`
- API: `https://mototaxi-atacames-api.onrender.com`
- Mapas: Google
- Proxy de laboratorio: no incluido

## Cambios visibles desde 0.18.8

- Nueva experiencia visual costera en el acceso, Home y pantallas de membresía.
- Campañas Costa-Go vigentes y aplicables mostradas dinámicamente, con recursos visuales y detalles de beneficios.
- Programa de beneficios y referidos integrado en la aplicación.
- Las cortesías activas se muestran como plan vigente dentro de «Plan actual», con duración y fecha de vencimiento.
- El saludo del conductor y la decoración de la isla se adaptan a las campañas activas.
- Ajustes de estabilidad y presentación del flujo de membresía.

El manifiesto Android no agregó permisos desde la versión 69. Se añadió el enlace interno `costa-go://referral`.

## Artefacto firmado

- Archivo: `apps/mobile/release/Costa-Go-0.18.9-build70.aab`
- Tamaño: `115924736` bytes (110.6 MiB)
- SHA-256: `130D9966F0B840E618A2E833B5E3F7E83075375CC3144929A7BA309D39F567EA`
- Android mínimo: API 24
- Android objetivo: API 36
- Arquitecturas: `arm64-v8a`, `armeabi-v7a`, `x86_64`
- Firma JAR: verificada correctamente con `jarsigner`
- Certificado de subida: `CN=Costa-Go Upload, OU=Mobile, O=Costa-Go, L=Atacames, ST=Esmeraldas, C=EC`
- SHA-256 del certificado: `D0E9E2958DC8B0BE3934A12B3CF484A2E40DFD114FC834153FD534036F2D2292`
- Certificado coincidente con el de la versión 69.

El certificado de subida es autofirmado y no incorpora sello de tiempo; `jarsigner` verifica el AAB y muestra las advertencias habituales de esa configuración.

## Notas para Play Console

Nombre sugerido: `Costa-Go 0.18.9 (70)`

Copiar el contenido de `RELEASE_NOTES_0.18.9_BUILD70.txt` en «Novedades de esta versión». El AAB está preparado localmente; no se ha cargado ni publicado en Play Console.
