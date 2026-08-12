import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:mototaxi_atacames/service_areas.dart';

void main() {
  final catalog = ServiceAreaCatalog.fromJson({
    'version': 1,
    'areas': [
      {
        'id': 'area-1', 'versionId': 'version-1', 'code': 'TEST', 'name': 'Prueba',
        'geometry': {
          'type': 'Polygon',
          'coordinates': [[[-79.1,-3.0],[-78.9,-3.0],[-78.9,-2.8],[-79.1,-2.8],[-79.1,-3.0]]]
        }
      }
    ]
  });

  test('encuentra un punto dentro del polígono', () {
    expect(catalog.find(const LatLng(-2.9,-79.0))?.code, 'TEST');
  });

  test('rechaza un punto fuera del polígono', () {
    expect(catalog.find(const LatLng(-2.7,-79.0)), isNull);
  });
}
