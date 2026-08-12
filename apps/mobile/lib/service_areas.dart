import 'package:latlong2/latlong.dart';

class ServiceArea {
  const ServiceArea({required this.id,required this.code,required this.name,required this.versionId,required this.polygons});
  final String id,code,name,versionId;
  final List<List<List<LatLng>>> polygons;
  factory ServiceArea.fromJson(Map<String,dynamic> json) {
    final geometry=Map<String,dynamic>.from(json['geometry'] as Map);
    List<List<List<LatLng>>> parse(dynamic coordinates)=>List<dynamic>.from(coordinates).map((polygon)=>List<dynamic>.from(polygon).map((ring)=>List<dynamic>.from(ring).map((point){final pair=List<dynamic>.from(point);return LatLng((pair[1] as num).toDouble(),(pair[0] as num).toDouble());}).toList()).toList()).toList();
    return ServiceArea(id:json['id'].toString(),code:json['code'].toString(),name:json['name'].toString(),versionId:json['versionId'].toString(),polygons:geometry['type']=='Polygon'?parse([geometry['coordinates']]):parse(geometry['coordinates']));
  }
  bool contains(LatLng point)=>polygons.any((polygon)=>polygon.isNotEmpty&&_insideRing(point,polygon.first)&&!polygon.skip(1).any((hole)=>_insideRing(point,hole)));
  static bool _insideRing(LatLng point,List<LatLng> ring){var inside=false;for(var i=0,j=ring.length-1;i<ring.length;j=i++){final a=ring[i],b=ring[j];final delta=b.latitude-a.latitude;final intersects=((a.latitude>point.latitude)!=(b.latitude>point.latitude))&&point.longitude<(b.longitude-a.longitude)*(point.latitude-a.latitude)/(delta.abs()<1e-12?1e-12:delta)+a.longitude;if(intersects)inside=!inside;}return inside;}
}

class ServiceAreaCatalog {
  ServiceAreaCatalog(this.version,this.areas);
  final int version;final List<ServiceArea> areas;
  ServiceArea? find(LatLng point){for(final area in areas){if(area.contains(point))return area;}return null;}
  factory ServiceAreaCatalog.fromJson(Map<String,dynamic> json)=>ServiceAreaCatalog((json['version'] as num?)?.toInt()??1,List<dynamic>.from(json['areas']??const []).map((item)=>ServiceArea.fromJson(Map<String,dynamic>.from(item as Map))).toList());
}
