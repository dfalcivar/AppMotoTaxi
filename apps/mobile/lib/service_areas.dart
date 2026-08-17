import 'package:latlong2/latlong.dart';

class ServiceArea {
  const ServiceArea(
      {required this.id,
      required this.code,
      required this.name,
      required this.versionId,
      required this.polygons,
      this.reviewLocation,
      this.reviewLabel});
  final String id, code, name, versionId;
  final List<List<List<LatLng>>> polygons;
  final LatLng? reviewLocation;
  final String? reviewLabel;
  factory ServiceArea.fromJson(Map<String, dynamic> json) {
    final geometry = Map<String, dynamic>.from(json['geometry'] as Map);
    List<List<List<LatLng>>> parse(dynamic coordinates) =>
        List<dynamic>.from(coordinates)
            .map((polygon) => List<dynamic>.from(polygon)
                .map((ring) => List<dynamic>.from(ring).map((point) {
                      final pair = List<dynamic>.from(point);
                      return LatLng((pair[1] as num).toDouble(),
                          (pair[0] as num).toDouble());
                    }).toList())
                .toList())
            .toList();
    final review = json['reviewLocation'] is Map
        ? Map<String, dynamic>.from(json['reviewLocation'] as Map)
        : null;
    return ServiceArea(
        id: json['id'].toString(),
        code: json['code'].toString(),
        name: json['name'].toString(),
        versionId: json['versionId'].toString(),
        polygons: geometry['type'] == 'Polygon'
            ? parse([geometry['coordinates']])
            : parse(geometry['coordinates']),
        reviewLocation: review == null
            ? null
            : LatLng((review['latitude'] as num).toDouble(),
                (review['longitude'] as num).toDouble()),
        reviewLabel: review?['label']?.toString());
  }
  bool contains(LatLng point) => polygons.any((polygon) =>
      polygon.isNotEmpty &&
      _insideRing(point, polygon.first) &&
      !polygon.skip(1).any((hole) => _insideRing(point, hole)));
  static bool _insideRing(LatLng point, List<LatLng> ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      final a = ring[i], b = ring[j];
      final delta = b.latitude - a.latitude;
      final intersects =
          ((a.latitude > point.latitude) != (b.latitude > point.latitude)) &&
              point.longitude <
                  (b.longitude - a.longitude) *
                          (point.latitude - a.latitude) /
                          (delta.abs() < 1e-12 ? 1e-12 : delta) +
                      a.longitude;
      if (intersects) inside = !inside;
    }
    return inside;
  }
}

class ServiceAreaCatalog {
  ServiceAreaCatalog(this.version, this.areas);
  final int version;
  final List<ServiceArea> areas;
  ServiceArea? find(LatLng point) {
    for (final area in areas) {
      if (area.contains(point)) return area;
    }
    return null;
  }

  ServiceArea? get reviewArea {
    for (final area in areas) {
      if (area.reviewLocation != null) return area;
    }
    return null;
  }

  factory ServiceAreaCatalog.fromJson(Map<String, dynamic> json) =>
      ServiceAreaCatalog(
          (json['version'] as num?)?.toInt() ?? 1,
          List<dynamic>.from(json['areas'] ?? const [])
              .map((item) =>
                  ServiceArea.fromJson(Map<String, dynamic>.from(item as Map)))
              .toList());
}
