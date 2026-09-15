# Versión candidata a producción

Actualizado el 15 de septiembre de 2026.

- Aplicación: Costa-Go
- Versión: `0.18.8`
- Código de versión: `69`
- Canal previsto: prueba abierta / producción en Play Console
- API: `https://mototaxi-atacames-api.onrender.com`
- Mapas: Google
- Proxy de laboratorio: no incluido

## Cambios de esta versión

- El resumen de ganancia neta ahora separa el valor generado por la tarifa
  normal de los viajes del valor generado mediante la búsqueda de Costa-Go.
- En pago por uso, **Generado con Costa-Go** muestra la tarifa de búsqueda que
  queda para el conductor después de aplicar la comisión por viaje.
- En planes o paquetes que cubren por completo la comisión, el desglose muestra
  el valor completo generado por la búsqueda.
- Se conserva el resumen por hoy, semana, mes o período personalizado, junto con
  los movimientos recientes y el historial por viaje.

## Artefacto para Play Console

- Archivo: `Costa-Go-0.18.8-build69.aab`
- Tamaño: `113326370` bytes (`108.1 MB`)
- SHA-256: `E1F9A434A4C1599CF1A059B1AEABFA3A72F437055026ED2B1DBE13E3389B0D6E`
- Application ID: `ec.atacames.mototaxi.mototaxi_atacames`
- Android mínimo: API 24 (Android 7.0)
- Android objetivo: API 36
- Arquitecturas: `arm64-v8a`, `armeabi-v7a` y `x86_64`
- Firebase: configuración incluida
- Firma JAR: verificada correctamente
- Certificado: `CN=Costa-Go Upload, OU=Mobile, O=Costa-Go, L=Atacames, ST=Esmeraldas, C=EC`
- SHA-256 del certificado: `D0E9E2958DC8B0BE3934A12B3CF484A2E40DFD114FC834153FD534036F2D2292`
- Certificado coincidente con los AAB anteriores de producción

El certificado es autofirmado y el AAB no incluye sello de tiempo. `jarsigner`
lo verifica correctamente y presenta las advertencias habituales para una clave
de subida privada. Google Play realiza la firma final de distribución.

## Seguridad de los datos y permisos

Esta versión no agrega permisos Android ni nuevas categorías de datos respecto
de `0.18.7`. El ajuste usa los datos de viajes y cobros que ya pertenecen a la
cuenta autenticada del conductor; no incorpora un proveedor externo ni un nuevo
tipo de recopilación.

## Notas para Play Console

Nombre sugerido: `Costa-Go 0.18.8 (69)`

```text
<es-419>
Mejoramos el detalle de ganancias para conductores.
Ahora la ganancia neta separa lo generado por la tarifa normal de los viajes y lo obtenido mediante la búsqueda de Costa-Go.
También mostramos correctamente el valor según la modalidad de cobro, incluyendo planes, paquetes y pago por uso.
</es-419>
```

Antes de cargar una versión posterior, incrementar nuevamente `versionName` y
`versionCode`, generar un AAB sin proxy y actualizar este registro con su hash.
