import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:mototaxi_atacames/main.dart';

void main() {
  group('OriginSelectionGuard', () {
    test('GPS inicial se usa cuando todavÃ­a no existe origen', () {
      final guard = OriginSelectionGuard();
      final request = guard.startGpsRequest();

      expect(guard.canApplyAutomaticGps(request, hasOrigin: false), isTrue);
    });

    test('selecciÃ³n manual invalida una respuesta GPS pendiente', () {
      final guard = OriginSelectionGuard();
      final request = guard.startGpsRequest();
      guard.markManualOrigin();

      expect(guard.canApplyAutomaticGps(request, hasOrigin: false), isFalse);
      expect(guard.hasManualOrigin, isTrue);
    });

    test('GPS automÃ¡tico no reemplaza un origen ya definido', () {
      final guard = OriginSelectionGuard();
      final request = guard.startGpsRequest();

      expect(guard.canApplyAutomaticGps(request, hasOrigin: true), isFalse);
    });

    test('usar mi ubicaciÃ³n permite reemplazar el origen manual', () {
      final guard = OriginSelectionGuard()..markManualOrigin();
      final request = guard.startGpsRequest();

      expect(guard.canApplyExplicitGps(request), isTrue);
      guard.commitExplicitGps();
      expect(guard.hasManualOrigin, isFalse);
    });
  });

  test('la solicitud serializa el origen manual y no el GPS anterior', () {
    const gpsOriginal = LatLng(-2.9000, -79.0000);
    const origenManual = LatLng(-2.9055, -79.0066);
    const destino = LatLng(-2.9100, -79.0120);

    final payload = buildTripRequestPayload(
      passengers: 1,
      originReference: 'Origen manual',
      destinationReference: 'Destino',
      selectedOrigin: origenManual,
      selectedDestination: destino,
      paymentMethod: 'CASH',
    );
    final origin = payload['origin'] as Map<String, dynamic>;

    expect(origin['latitude'], origenManual.latitude);
    expect(origin['longitude'], origenManual.longitude);
    expect(origin['latitude'], isNot(gpsOriginal.latitude));
    expect(origin['longitude'], isNot(gpsOriginal.longitude));
  });

  test('traduce todos los estados operativos visibles', () {
    expect(estadoViaje('SEARCHING'), 'Buscando conductor');
    expect(estadoViaje('DRIVER_EN_ROUTE'), 'Conductor en camino');
    expect(estadoViaje('DRIVER_ARRIVED'), 'Conductor llegó');
    expect(estadoViaje('IN_PROGRESS'), 'Viaje en curso');
    expect(estadoViaje('COMPLETED'), 'Finalizado');
    expect(estadoViaje('CANCELLED'), 'Cancelado');
  });

  test('presenta errores de sesión en español', () {
    expect(
        mensajeApi('INVALID_CREDENTIALS'), 'Correo o contraseña incorrectos.');
    expect(mensajeApi('DRIVER_PENDING_APPROVAL'),
        'Tu perfil de conductor está pendiente de aprobación.');
    expect(mensajeApi('SESSION_REPLACED'), contains('otro dispositivo'));
    expect(mensajeApi('INVALID_REGISTRATION'), contains('campos obligatorios'));
    expect(mensajeApi('VEHICLE_REQUIRED'), contains('placa'));
  });

  test('oculta Plus Codes en las direcciones visibles', () {
    expect(cleanAddressLabel('4X2X+H56, Hermano Miguel 9-21'),
        'Hermano Miguel 9-21');
    expect(cleanAddressLabel('Simón Bolívar 596, Cuenca'),
        'Simón Bolívar 596, Cuenca');
  });

  test('usa tripId del historial al crear una solicitud de soporte', () {
    expect(
      supportTripIdentifier({
        'tripId': '11111111-1111-4111-8111-111111111111',
        'originReference': 'Origen',
      }),
      '11111111-1111-4111-8111-111111111111',
    );
    expect(supportTripIdentifier({'id': null}), isEmpty);
  });
}
