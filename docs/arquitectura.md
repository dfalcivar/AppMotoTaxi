# Arquitectura inicial

## Principios

1. Las reglas de negocio viven en un paquete independiente y se prueban sin mapas ni interfaz.
2. El servidor es la autoridad para tarifas, estados y asignación.
3. Las aplicaciones móviles nunca deciden el precio final por sí solas.
4. Toda tarifa confirmada se guarda como una copia histórica dentro del viaje.
5. Los cambios administrativos tienen versión, vigencia y auditoría.

## Componentes previstos

- Aplicación Flutter con modos de pasajero y conductor durante el MVP.
- API TypeScript para autenticación, conductores, zonas, tarifas y viajes.
- PostgreSQL/PostGIS para persistencia y operaciones geográficas.
- Panel React para administración.
- Notificaciones push y canal en tiempo real para ofertas y ubicaciones.

## Primer recorrido vertical

1. Administrador aprueba un conductor.
2. Conductor se marca disponible.
3. Pasajero obtiene una cotización.
4. Pasajero crea una solicitud.
5. Un conductor acepta.
6. El conductor registra llegada, inicio y finalización.
7. El servidor conserva la tarifa y el pago en efectivo.

## Decisiones pendientes

- Polígonos exactos de casco urbano y zona extendida.
- Capacidad máxima autorizada.
- Proveedor de mapas y SMS.
- Documentos exigidos y protocolo de emergencia.
