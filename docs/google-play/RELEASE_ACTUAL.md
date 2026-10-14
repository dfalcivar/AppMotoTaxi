# Versión para Play Console

Actualizado el 14 de octubre de 2026.

- Aplicación: Costa-Go
- Versión: `0.18.12`
- Código de versión: `73`
- Versión anterior preparada: `0.18.11 (72)`
- Application ID: `ec.atacames.mototaxi.mototaxi_atacames`
- Entorno de compilación: `production`
- API: `https://mototaxi-atacames-api.onrender.com`
- Mapas: Google
- Proxy de laboratorio: no incluido

## Cambios desde la versión 72

- Las mototaxis en revisión ahora aparecen en la pantalla de selección con una indicación clara de que aún no se pueden conducir.
- Se distingue el estado de verificación de la unidad de la autorización del conductor.
- Tras registrar la primera mototaxi desde el perfil, se abre la flota para consultar su estado.
- Se muestra una confirmación después de registrar o vincular una mototaxi desde la selección.

## Artefacto firmado

- Archivo: `apps/mobile/release/Costa-Go-0.18.12-build73.aab`
- Tamaño: `116004177` bytes (110.6 MiB)
- SHA-256: `7C8CCE9C03D380BF2CDF8DAD976A125A2C80055E3257B6327D0566A4C5E4C374`
- Firma JAR: verificada con `jarsigner`
- SHA-256 del certificado de subida: `D0E9E2958DC8B0BE3934A12B3CF484A2E40DFD114FC834153FD534036F2D2292`
- SHA-256 del certificado de subida: `D0E9E2958DC8B0BE3934A12B3CF484A2E40DFD114FC834153FD534036F2D2292`
- Certificado de subida coincidente con la versión 72.

El certificado de subida es autofirmado y no incorpora sello de tiempo; `jarsigner` verifica el AAB y muestra las advertencias habituales de esa configuración.

## Notas para Play Console

Nombre sugerido: `Costa-Go 0.18.12 (73)`

Copiar el contenido de `RELEASE_NOTES_0.18.12_BUILD73.txt` en «Novedades de esta versión». El AAB está preparado localmente; no se ha cargado ni publicado en Play Console.
