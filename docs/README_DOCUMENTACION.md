# Documentación Costa-Go

Generada el 21 de agosto de 2026 desde la rama `main` del repositorio.

## Contenido

- `docs/manuales_usuario/`: índice general y 15 manuales funcionales del ecosistema web.
- `docs/tecnica/`: arquitectura, datos, API, reglas, seguridad, despliegue y trazabilidad.
- `docs/fuentes/html/`: fuentes HTML editables utilizadas para los PDF.
- `docs/fuentes/diagramas/`: diagramas Mermaid editables.
- `docs/fuentes/inventarios/`: catálogos JSON generados desde rutas y migraciones.
- `docs/fuentes/capturas/`: capturas públicas sin credenciales ni datos privados.

## Regeneración

1. Instalar dependencias del monorepo.
2. Ejecutar desde la raíz: `node docs/fuentes/generar-documentacion.mjs`.
3. Ejecutar: `powershell -ExecutionPolicy Bypass -File docs/fuentes/generar-pdfs.ps1`.

El script de PDF busca Google Chrome o Microsoft Edge instalados. Los PDF se generan sin cabeceras del navegador y con pie/versionado propio.

## Criterio documental

La documentación describe funciones verificadas en código. Los códigos internos permanecen intactos; las etiquetas visibles se presentan en español. Funciones no verificadas se identifican como pendientes. Los manuales funcionales cubren únicamente superficies web; la aplicación móvil se incluye solo como dependencia del sistema en documentación técnica.
