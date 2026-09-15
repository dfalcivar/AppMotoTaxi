# Versión candidata a producción

Actualizado el 15 de septiembre de 2026.

- Aplicación: Costa-Go
- Versión: `0.18.7`
- Código de versión: `68`
- Canal previsto: prueba abierta / producción en Play Console
- API: `https://mototaxi-atacames-api.onrender.com`
- Mapas: Google
- Proxy de laboratorio: no incluido

## Cambios de esta versión

- Nueva sección **Ganancias y comisiones** para conductores.
- Resumen por hoy, semana, mes o período personalizado.
- Detalle de ingresos por viajes, comisión Costa-Go, ganancia neta, promedio por
  viaje, saldo prepago y modalidad de cobro.
- Movimientos recientes e historial paginado por viaje.
- Textos más claros al confirmar un viaje: tarifa por búsqueda, rango estimado y
  aviso de variación según la ronda.
- API de ganancias protegida por la sesión y el rol del conductor.
- Preparación documentada del procedimiento de limpieza inicial de producción;
  el procedimiento no forma parte del arranque de la aplicación y no se ejecuta
  durante el despliegue.

## Artefacto para Play Console

- Archivo: `Costa-Go-0.18.7-build68.aab`
- Tamaño: `113332512` bytes (`108.1 MB`)
- SHA-256: `42C8A560B2498BC6D4857582A1B1BCB9D7B567F3D4BDB640B554727AD701892E`
- Application ID: `ec.atacames.mototaxi.mototaxi_atacames`
- Android mínimo: API 24 (Android 7.0)
- Android objetivo: API 36
- Arquitecturas: `arm64-v8a`, `armeabi-v7a` y `x86_64`
- Firebase: configuración incluida
- Firma JAR: verificada correctamente
- Certificado: `CN=Costa-Go Upload, OU=Mobile, O=Costa-Go, L=Atacames, ST=Esmeraldas, C=EC`
- SHA-256 del certificado: `D0E9E2958DC8B0BE3934A12B3CF484A2E40DFD114FC834153FD534036F2D2292`
- Certificado coincidente con el AAB `0.18.6 (67)`

El certificado es autofirmado y el AAB no incluye sello de tiempo. `jarsigner`
lo verifica correctamente y presenta las advertencias habituales para una clave
de subida privada. Google Play realiza la firma final de distribución.

## Seguridad de los datos y permisos

Esta versión no agrega permisos Android ni nuevas categorías de datos respecto
de `0.18.6`. La sección de ganancias consulta información de viajes y cobros que
ya pertenece a la cuenta autenticada del conductor; no incorpora un proveedor
externo ni un nuevo tipo de recopilación.

## Notas para Play Console

Nombre sugerido: `Costa-Go 0.18.7 (68)`

```text
<es-419>
Ahora los conductores pueden consultar sus ganancias y comisiones por día, semana, mes o período personalizado, con el detalle de cada viaje.
Mejoramos la información de la tarifa al solicitar un viaje para explicar claramente que puede variar según la ronda de búsqueda.
Incluimos ajustes de estabilidad y preparación para producción.
</es-419>
```

Antes de cargar una versión posterior, incrementar nuevamente `versionName` y
`versionCode`, generar un AAB sin proxy y actualizar este registro con su hash.
