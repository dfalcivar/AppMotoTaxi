import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:mototaxi_atacames/main.dart';

void main() {
  group('NotificationRouter', () {
    test('el tipo tiene prioridad sobre un tripId presente', () {
      expect(notificationTargetFor('CHAT_MESSAGE'), NotificationTarget.chat);
      expect(
          notificationTargetFor('SUPPORT_UPDATE'), NotificationTarget.support);
      expect(notificationTargetFor('TEST_PUSH'), NotificationTarget.inbox);
    });

    test('distingue viaje activo, detalle y ofertas del conductor', () {
      expect(notificationTargetFor('DRIVER_ARRIVED'),
          NotificationTarget.activeTrip);
      expect(notificationTargetFor('COMPLETED'), NotificationTarget.tripDetail);
      expect(notificationTargetFor('TRIP_OFFER'), NotificationTarget.offers);
    });
  });

  test('normaliza la cancelación realtime para no mostrar una acción vacía',
      () {
    expect(normalizePassengerTripUpdateType('CANCELLED'), 'TRIP_CANCELLED');
    expect(
        normalizePassengerTripUpdateType('DRIVER_ARRIVED'), 'DRIVER_ARRIVED');
  });

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

  test('serializa paradas ordenadas y fecha programada sin perder coordenadas',
      () {
    final scheduledFor = DateTime.parse('2026-08-08T18:30:00-05:00');
    final payload = buildTripRequestPayload(
      passengers: 3,
      originReference: 'Parque central',
      destinationReference: 'Destino final',
      selectedOrigin: const LatLng(-0.866, -79.847),
      selectedDestination: const LatLng(-0.874, -79.861),
      paymentMethod: 'DEUNA',
      scheduledFor: scheduledFor,
      destinations: [
        {
          'location': {'latitude': -0.870, 'longitude': -79.852},
          'reference': 'Parada 1'
        },
        {
          'location': {'latitude': -0.874, 'longitude': -79.861},
          'reference': 'Destino final'
        },
      ],
    );

    final destinations = payload['destinations'] as List<dynamic>;
    expect(payload.containsKey('destination'), isFalse);
    expect(destinations, hasLength(2));
    expect(destinations.first['reference'], 'Parada 1');
    expect(destinations.last['location']['longitude'], -79.861);
    expect(payload['scheduledFor'], scheduledFor.toUtc().toIso8601String());
  });

  test('valida la ventana inclusiva de viajes programados', () {
    final now = DateTime(2026, 8, 12, 8, 0, 37);
    final currentMinute = DateTime(2026, 8, 12, 8);
    String? validate(Duration duration) => scheduledSelectionError(
          selected: currentMinute.add(duration),
          now: now,
          minimumNoticeMinutes: 30,
          maximumAdvanceMinutes: 1440,
        );

    expect(validate(const Duration(minutes: 29)), 'SCHEDULE_TOO_SOON');
    expect(validate(const Duration(minutes: 30)), isNull);
    expect(validate(const Duration(hours: 2)), isNull);
    expect(validate(const Duration(hours: 24)), isNull);
    expect(validate(const Duration(hours: 24, minutes: 1)), 'SCHEDULE_TOO_FAR');
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
