import 'package:flutter_test/flutter_test.dart';
import 'package:mototaxi_atacames/trip_lifecycle.dart';

void main() {
  test('no muestra un conductor en camino sin identificador asignado', () {
    for (final status in assignedTripStatuses) {
      expect(isAssignedTrip({'status': status}), isFalse);
      expect(isAssignedTrip({'status': status, 'driverId': ''}), isFalse);
      expect(
          isAssignedTrip({'status': status, 'driverId': 'driver-1'}), isTrue);
    }
    expect(isAssignedTrip(null), isFalse);
    expect(isAssignedTrip({'status': 'NO_DRIVER', 'driverId': 'driver-1'}),
        isFalse);
    expect(isAssignedTrip({'status': 'SEARCHING'}), isFalse);
  });
  test(
      'cancelar permanece disponible antes de iniciar, incluso ante estado incompleto',
      () {
    for (final status in [
      'SEARCHING',
      'ASSIGNED',
      'DRIVER_EN_ROUTE',
      'DRIVER_ARRIVED'
    ]) {
      expect(canPassengerCancel({'status': status}), isTrue);
      expect(canPassengerCancel({'status': status, 'startedAt': '2026-08-27'}),
          isFalse);
    }
    for (final status in [
      'IN_PROGRESS',
      'COMPLETED',
      'CANCELLED',
      'NO_DRIVER'
    ]) {
      expect(canPassengerCancel({'status': status}), isFalse);
    }
    expect(canPassengerCancel(null), isFalse);
  });
}
