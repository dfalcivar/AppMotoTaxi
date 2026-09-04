import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:mototaxi_atacames/live_map.dart';

void main() {
  test('cada estado usa el color visual solicitado', () {
    expect(
      mototaxiStatusColor(MototaxiMarkerStatus.available),
      const Color(0xff94a3b8),
    );
    expect(
      mototaxiStatusColor(MototaxiMarkerStatus.assigned),
      const Color(0xff0a84ff),
    );
    expect(
      mototaxiStatusColor(MototaxiMarkerStatus.activeTrip),
      const Color(0xff22c55e),
    );
  });

  test('la mototaxi lateral permanece derecha con cualquier rumbo GPS', () {
    for (final bearing in [-90.0, 0.0, 45.0, 90.0, 180.0, 270.0, 450.0]) {
      expect(mototaxiVisualRotation(bearing), 0);
    }
  });

  group('ajuste de la mototaxi a la ruta', () {
    const route = [
      LatLng(-0.86880, -79.84200),
      LatLng(-0.86880, -79.84000),
    ];

    test('ajusta una lectura GPS cercana al segmento', () {
      const gps = LatLng(-0.86870, -79.84100);
      final snapped = snapMototaxiPositionToRoute(gps, route);

      expect(snapped.latitude, closeTo(-0.86880, .000001));
      expect(snapped.longitude, closeTo(-79.84100, .000001));
    });

    test('conserva una lectura que confirma un desvío real', () {
      const gps = LatLng(-0.86780, -79.84100);
      expect(snapMototaxiPositionToRoute(gps, route), gps);
      expect(distanceFromMototaxiRouteMeters(gps, route), greaterThan(45));
    });
  });

  testWidgets('el marcador admite los cuatro tamaños y tres estados',
      (tester) async {
    const sizes = [24.0, 32.0, 40.0, 48.0];
    await tester.pumpWidget(
      MaterialApp(
        home: Row(
          children: [
            for (final size in sizes)
              MototaxiMarker(
                status: MototaxiMarkerStatus.available,
                size: size,
              ),
            const MototaxiMarker(
              status: MototaxiMarkerStatus.assigned,
              size: 40,
              pulse: .5,
              bearing: 90,
            ),
            const MototaxiMarker(
              status: MototaxiMarkerStatus.activeTrip,
              size: 40,
            ),
          ],
        ),
      ),
    );

    expect(find.byType(MototaxiMarker), findsNWidgets(6));
    expect(tester.takeException(), isNull);
  });
}
