# Lista de publicación en Google Play

## Pendiente acordado — actualizar ficha y documentación tras las mejoras (28/08/2026)

Estado documental: **actualizado el 29 de agosto de 2026**. Base móvil de referencia: Costa-Go **0.17.2 (54)**. Las políticas y textos fuente ya fueron revisados; las capturas quedan pendientes hasta validar el siguiente AAB final en pruebas cerradas.

- [x] Texto base actualizado al 29 de agosto de 2026 con pasajero, conductor, propietario/gestor, flota, jornadas, membresías y seguimiento. No anunciar emisión fiscal mientras permanezca deshabilitada.
- [ ] Renovar capturas reales de la app: solicitud y búsqueda, viaje activo/chat/seguridad, perfil, selección de mototaxi y jornadas, Mi flota y membresías. Elegir las más representativas; conservar logo oficial y coherencia claro/oscuro, ocultando datos personales, placas reales, ubicaciones privadas, credenciales y QR/tokens utilizables.
- [ ] Revisar icono de tienda e imagen destacada; actualizar solo si quedaron desalineados con la identidad o experiencia vigente. El nuevo icono funcional de mototaxi no sustituye automáticamente al logo oficial de Costa-Go.
- [ ] Auditar el AAB final frente al inventario actualizado: anuncios, datos, propietarios, fotos original/display, jornadas, fiscalidad preparada, cancelaciones, conservación y seguimiento público. No guardar credenciales en Git.
- [ ] Regenerar todas las capturas de Play Store después de validar la versión final; no reutilizar el set histórico.
- [ ] Revisar documentación pública de costa-go.com: descripción de servicios, ayuda/FAQ, privacidad, términos/políticas de uso, membresías, publicidad, tarifario y eliminación de cuenta. Contrastar permisos, datos visibles por cada rol, retención y vigencia/revocación de enlaces con la implementación; no inventar plazos ni condiciones.
- [ ] Actualizar manuales de pasajero/conductor, propietario/flota, administración y recaudación/comercial donde los cambios los afecten; sincronizar también documentación técnica y sus fuentes antes de regenerar PDF/HTML.
- [ ] Conciliar estados de estos checklists antiguos con Play Console y el sitio actuales: varias tareas iniciales ya se realizaron y no deben repetirse por figurar aún pendientes.
- [ ] Validar enlaces, recursos y textos finales, registrar versión/fecha y publicar coordinadamente cuando el usuario autorice esta actualización. Priorizar cualquier diferencia material detectada en privacidad o acceso del revisor, sin asumir que puede esperar al fin de las pruebas.

Entrega prevista: textos listos para copiar, carpeta de recursos finales, documentación revisada y lista de cambios indicando qué se actualiza en Play Console y qué requiere despliegue web. Registrar este pendiente no ejecuta ninguna publicación.

## Mientras Google verifica la identidad

- [x] Icono 512 × 512 preparado.
- [x] Imagen destacada 1024 × 500 preparada.
- [x] Descripción corta y completa redactadas.
- [x] Borrador de Seguridad de los datos.
- [x] Borrador de clasificación de contenido.
- [x] Declaración y guion de ubicación en segundo plano.
- [x] Política, términos y eliminación públicos en Render.
- [x] Buzón receptor `soporte@costa-go.com` confirmado.
- [ ] Publicar y verificar `https://costa-go.com`.
- [ ] Capturar pantallas reales.
- [ ] Grabar y publicar video de ubicación en segundo plano.
- [ ] Crear cuentas de acceso para revisión.

## Cuando se habilite Play Console

1. Crear la app como `Costa-Go`, aplicación, gratuita, idioma español (Latinoamérica o España según disponibilidad).
2. Completar “Contenido de la aplicación”: privacidad, anuncios, acceso, público objetivo, clasificación, Seguridad de los datos y ubicación en segundo plano.
3. Completar la ficha principal y cargar los recursos de este directorio.
4. Crear una versión interna con un **AAB de release firmado**, no con APK de depuración.
5. Activar Play App Signing y conservar de forma segura la clave de carga.
6. Instalar desde la pista interna y validar login, mapas, ubicación, push, biometría, viajes inmediatos/programados y eliminación.
7. Configurar la prueba cerrada. Para cuentas personales nuevas, mantener al menos 12 testers inscritos de manera continua durante 14 días antes de solicitar acceso a producción.
8. Resolver advertencias del informe previo al lanzamiento y enviar la solicitud de producción.

## Bloqueadores de envío

- No enviar si las URLs públicas requieren autenticación o fallan por suspensión del servicio.
- No enviar si el correo de soporte rebota.
- No enviar una declaración de datos diferente de lo que contiene el AAB.
- No enviar ubicación en segundo plano sin el video, divulgación visible y función demostrable.
- No utilizar usuarios o domicilios reales en capturas y video.

## Referencias oficiales

- Pruebas para cuentas personales nuevas: https://support.google.com/googleplay/android-developer/answer/14151465?hl=es
- Configurar pruebas: https://support.google.com/googleplay/android-developer/answer/9845334?hl=es
- Ubicación en segundo plano: https://support.google.com/googleplay/android-developer/answer/9799150?hl=es
- Play App Signing: https://support.google.com/googleplay/android-developer/answer/9842756?hl=es
