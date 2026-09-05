import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:mototaxi_atacames/main.dart';

void main() {
  group('planes de membresía', () {
    test('ordena los paquetes por cantidad de viajes', () {
      final plans = sortedMembershipPlans([
        {
          'name': 'Paquete 50',
          'planType': 'TRIP_PACK',
          'includedTrips': 50,
          'amount': 8
        },
        {
          'name': 'Paquete 10',
          'planType': 'TRIP_PACK',
          'includedTrips': 10,
          'amount': 2
        },
        {
          'name': 'Paquete 25',
          'planType': 'TRIP_PACK',
          'includedTrips': 25,
          'amount': 5
        },
      ]);

      expect(plans.map((plan) => plan['includedTrips']), [10, 25, 50]);
    });

    test('ordena los planes por período según su duración', () {
      final plans = sortedMembershipPlans([
        {
          'name': 'Anual',
          'planType': 'PERIODIC',
          'durationDays': 365,
          'amount': 120
        },
        {
          'name': 'Mensual',
          'planType': 'PERIODIC',
          'durationDays': 30,
          'amount': 12
        },
        {
          'name': 'Trimestral',
          'planType': 'PERIODIC',
          'durationDays': 90,
          'amount': 36
        },
      ]);

      expect(plans.map((plan) => plan['durationDays']), [30, 90, 365]);
    });

    test('calcula el saldo visible del paquete activo', () {
      final progress = membershipTripPackProgress({
        'includedTrips': 10,
        'completedTrips': 3,
        'remainingTrips': 7,
      });

      expect(progress.included, 10);
      expect(progress.used, 3);
      expect(progress.remaining, 7);
      expect(progress.progress, .7);
    });
  });

  group('layout de pasajeros y método de pago', () {
    test('mantiene las secciones a ancho completo en todos los teléfonos', () {
      for (final width in [280.0, 320.0, 360.0, 390.0, 430.0, 720.0]) {
        expect(passengerRequestSectionLayoutFor(width),
            PassengerRequestSectionLayout.stacked,
            reason: 'ancho lógico disponible $width');
      }
    });

    test('el zoom y el texto aumentado no cambian la secuencia final', () {
      for (final scale in [1.0, 1.3, 1.6, 2.0]) {
        expect(passengerRequestSectionLayoutFor(430, textScale: scale),
            PassengerRequestSectionLayout.stacked,
            reason: 'escala de texto $scale');
      }
    });

    test('oculta únicamente el mensaje duplicado de destino confirmado', () {
      expect(shouldShowPassengerRequestMessage('Destino confirmado.'), isFalse);
      expect(
          shouldShowPassengerRequestMessage(' destino confirmado '), isFalse);
      expect(
          shouldShowPassengerRequestMessage('Origen confirmado.',
              destinationConfirmed: true),
          isFalse);
      expect(
          shouldShowPassengerRequestMessage(
              'Destino identificado por su dirección.',
              destinationConfirmed: true),
          isFalse);
      expect(
          shouldShowPassengerRequestMessage('Origen confirmado.',
              destinationConfirmed: false),
          isFalse);
      expect(shouldShowPassengerRequestMessage(null), isFalse);
      expect(shouldShowPassengerRequestMessage('Calculando la ruta…'), isTrue);
      expect(
          shouldShowPassengerRequestMessage('Fuera del área de cobertura.',
              destinationConfirmed: true),
          isTrue);
    });

    test('usa una sola banda para confirmaciones y cierre del viaje', () {
      expect(passengerRequestStatusLabel('Origen confirmado.'),
          'Origen confirmado');
      expect(
          passengerRequestStatusLabel('Origen confirmado.',
              destinationConfirmed: true),
          'Destino confirmado');
      expect(passengerRequestStatusLabel('Solicitud cancelada correctamente.'),
          'Solicitud cancelada correctamente');
      expect(
          passengerRequestStatusLabel('Viaje finalizado.'), 'Viaje finalizado');
      expect(passengerRequestStatusLabel('Gracias por tu calificación.'),
          'Gracias por tu calificación');
      expect(
          passengerRequestStatusLabel('Fuera del área de cobertura.'), isNull);
    });

    test('reinicia el borrador únicamente al finalizar el viaje', () {
      expect(shouldResetPassengerRequestDraftAfterStatus('COMPLETED'), isTrue);
      expect(
          shouldResetPassengerRequestDraftAfterStatus(' completed '), isTrue);
      expect(
          shouldResetPassengerRequestDraftAfterStatus('IN_PROGRESS'), isFalse);
      expect(shouldResetPassengerRequestDraftAfterStatus('CANCELLED'), isFalse);
      expect(shouldResetPassengerRequestDraftAfterStatus(null), isFalse);
    });

    test('normaliza la referencia compartida por pasajero y conductor', () {
      expect(tripMeetReferenceText(' Cerca de la puerta principal '),
          'Cerca de la puerta principal');
      expect(tripMeetReferenceText('   '), isNull);
      expect(tripMeetReferenceText(null), isNull);
    });
  });

  group('estado GPS del conductor', () {
    test('no duplica el mensaje GPS dentro de una barra adicional', () {
      expect(shouldShowDriverStatusMessage(driverGpsActiveMessage), isFalse);
    });

    test('conserva otros mensajes operativos y de error', () {
      expect(shouldShowDriverStatusMessage('No recibirás nuevas solicitudes.'),
          isTrue);
      expect(shouldShowDriverStatusMessage('No se pudo obtener la ubicación.'),
          isTrue);
      expect(shouldShowDriverStatusMessage(null), isFalse);
    });
  });

  group('reincorporación de ofertas del conductor', () {
    test('mantiene elevada la tarjeta cuando reaparece una oferta pendiente',
        () {
      expect(
        driverSheetTargetForState(hasActiveTrip: false, hasOffers: true),
        .90,
      );
    });

    test('solo baja la tarjeta cuando no existen ofertas pendientes', () {
      expect(
        driverSheetTargetForState(hasActiveTrip: false, hasOffers: false),
        .30,
      );
      expect(
        driverSheetTargetForState(hasActiveTrip: true, hasOffers: false),
        .50,
      );
    });

    test('una reoferta del mismo viaje se reconoce como una aparición nueva',
        () {
      final first = driverOfferOccurrenceKey('trip-1', {
        'offeredAt': '2026-09-01T10:00:00Z',
        'expiresAt': '2026-09-01T10:00:15Z',
      });
      final returning = driverOfferOccurrenceKey('trip-1', {
        'offeredAt': '2026-09-01T10:08:00Z',
        'expiresAt': '2026-09-01T10:08:15Z',
      });
      expect(returning, isNot(first));
    });

    test('eventos duplicados de la misma oferta conservan una sola identidad',
        () {
      final offer = {
        'offeredAt': '2026-09-01T10:08:00Z',
        'expiresAt': '2026-09-01T10:08:15Z',
      };
      expect(driverOfferOccurrenceKey('trip-1', offer),
          driverOfferOccurrenceKey('trip-1', Map.of(offer)));
    });
  });

  group('enlaces de preguntas frecuentes', () {
    test('detecta un enlace web seguro dentro de la respuesta', () {
      final uri = firstWebUrl(
          'Consulta el tarifario en https://costa-go.com/fares.html.');
      expect(uri?.toString(), 'https://costa-go.com/fares.html');
    });

    test('separa la URL del texto que se presenta al usuario', () {
      expect(
          answerWithoutWebUrl(
              'Consulta aquí https://costa-go.com/fares.html. Antes de viajar.'),
          'Consulta aquí. Antes de viajar.');
    });
  });

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
      expect(notificationTargetFor('DRIVER_CANCELLED_REASSIGNING'),
          NotificationTarget.activeTrip);
      expect(notificationTargetFor('COMPLETED'), NotificationTarget.tripDetail);
      expect(notificationTargetFor('TRIP_OFFER'), NotificationTarget.offers);
      expect(notificationTargetFor('MEMBERSHIP_EXPIRING'),
          NotificationTarget.membership);
      expect(notificationTargetFor('SCHEDULED_TRIP_ASSIGNED'),
          NotificationTarget.scheduledTrips);
      expect(notificationTargetFor('SMART_FREQUENT_TRIP'),
          NotificationTarget.smartTrip);
      expect(notificationTargetFor('SMART_TRIP'), NotificationTarget.smartTrip);
      expect(notificationTargetFor('SMART_REACTIVATION'),
          NotificationTarget.inbox);
      expect(notificationTargetFor('APP_UPDATE'), NotificationTarget.appStore);
      expect(notificationTargetFor('APP_STORE'), NotificationTarget.appStore);
    });

    test('el banner general solo cubre SMART, campañas y pruebas', () {
      for (final type in [
        'TEST_PUSH',
        'SMART_FREQUENT_TRIP',
        'SMART_REACTIVATION',
        'CAMPAIGN',
        'EVENT',
        'PROMOTIONAL',
        'APP_UPDATE',
      ]) {
        expect(notificationUsesGeneralInAppBanner(type), isTrue, reason: type);
      }
      expect(notificationUsesGeneralInAppBanner('UNKNOWN', category: 'SMART'),
          isTrue);
      for (final type in [
        'CHAT_MESSAGE',
        'TRIP_ASSIGNED',
        'DRIVER_ARRIVED',
        'TRIP_OFFER',
        'SCHEDULED_TRIP_REMINDER',
      ]) {
        expect(notificationUsesGeneralInAppBanner(type), isFalse, reason: type);
      }
    });

    test('solo el viaje finalizado navega directamente al detalle', () {
      for (final type in [
        'TRIP_ASSIGNED',
        'DRIVER_EN_ROUTE',
        'DRIVER_ARRIVED',
        'IN_PROGRESS',
        'DRIVER_CANCELLED_REASSIGNING',
        'TRIP_CANCELLED',
        'NO_DRIVER',
      ]) {
        expect(notificationOpensInformationalDetail(type), isTrue,
            reason: type);
        expect(notificationNavigatesDirectly(type), isFalse, reason: type);
      }
      expect(notificationOpensInformationalDetail('COMPLETED'), isFalse);
      expect(notificationNavigatesDirectly('COMPLETED'), isTrue);
    });
  });

  test('muestra fechas de membresía completamente en español', () {
    expect(formatSpanishLongDate(DateTime(2026, 9, 30)),
        'miércoles, 30 de septiembre de 2026');
  });

  test('acepta snapshots de plan como objeto o texto JSON', () {
    expect(membershipPlanName({'name': 'Mensual'}), 'Mensual');
    expect(membershipPlanName('{"name":"Trimestral"}'), 'Trimestral');
    expect(membershipPlanName('dato histórico inválido'), 'Membresía');
    expect(membershipPlanName(null), 'Membresía');
  });

  group('ubicación provisional al iniciar', () {
    final now = DateTime(2026, 8, 23, 15);

    test('acepta una ubicación reciente y con precisión suficiente', () {
      expect(
          isUsableProvisionalLocation(
              timestamp: now.subtract(const Duration(minutes: 4)),
              accuracyMeters: 35,
              now: now),
          isTrue);
    });

    test('rechaza una ubicación antigua o imprecisa', () {
      expect(
          isUsableProvisionalLocation(
              timestamp: now.subtract(const Duration(minutes: 11)),
              accuracyMeters: 35,
              now: now),
          isFalse);
      expect(
          isUsableProvisionalLocation(
              timestamp: now.subtract(const Duration(minutes: 2)),
              accuracyMeters: 140,
              now: now),
          isFalse);
    });
  });

  test('un fallo técnico de GPS nunca expone la excepción al pasajero', () {
    expect(friendlyLocationFailure(Exception('stack interno')),
        'No pudimos confirmar tu ubicación. Reintenta o selecciona el origen en el mapa.');
    expect(
        friendlyLocationFailure(const ApiException(
            'Activa la ubicación GPS del teléfono para continuar.')),
        contains('Activa la ubicación'));
  });

  test('el total de tarifa coincide con todos los conceptos mostrados', () {
    final summary = tripFareBreakdown({
      'baseFareCents': 155,
      'platformCommissionCents': 10,
      'stopSurchargeCents': 25,
      'quotedTotalCents': 190,
    });
    expect(summary['journeys'], 165);
    expect(summary['stops'], 25);
    expect(summary['adjustments'], 0);
    expect(summary['total'], summary['journeys']! + summary['stops']!);
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

  test('formatea la vigencia de membresía en español y hora de Ecuador', () {
    final utc = DateTime.parse('2026-08-25T03:18:00Z');
    expect(
        formatEcuadorLongDateTime(utc), 'lunes, 24 de agosto de 2026 · 22:18');
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
