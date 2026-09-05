import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart' as gmaps;
import 'package:latlong2/latlong.dart';

import 'costa_go_design.dart';

enum MapPointSelection { origin, destination }

/// Los únicos estados visuales permitidos para una mototaxi en el mapa.
enum MototaxiMarkerStatus { available, assigned, activeTrip }

const _mototaxiAsset = 'assets/images/mototaxi-map-marker.png';
const _mototaxiAvailable = Color(0xff94a3b8);
const _costaGoAssignedBlue = CostaGoPalette.primary;
const _costaGoTripGreen = Color(0xff22c55e);
const _mototaxiMarkerSurface = CostaGoPalette.cardLight;

@visibleForTesting
Color mototaxiStatusColor(MototaxiMarkerStatus status) => switch (status) {
      MototaxiMarkerStatus.available => _mototaxiAvailable,
      MototaxiMarkerStatus.assigned => _costaGoAssignedBlue,
      MototaxiMarkerStatus.activeTrip => _costaGoTripGreen,
    };

/// La ilustración oficial es una vista lateral, no un vehículo cenital.
/// Rotarla con el rumbo GPS puede dejarla de costado o cabeza abajo. El rumbo
/// se sigue interpolando para conservarlo disponible, pero el arte permanece
/// derecho mientras avanza sobre la ruta.
@visibleForTesting
double mototaxiVisualRotation(double bearing) => 0;

/// Ajusta una lectura GPS a la vía dibujada cuando está lo bastante cerca.
/// Si el GPS se alejó realmente, conserva su posición para que la capa superior
/// pueda decidir cuándo solicitar una nueva ruta.
@visibleForTesting
LatLng snapMototaxiPositionToRoute(
  LatLng position,
  List<LatLng> route, {
  double maximumDistanceMeters = 38,
}) {
  if (route.length < 2) return position;
  final latitudeRadians = position.latitude * math.pi / 180;
  final longitudeMeters = 111320 * math.cos(latitudeRadians);
  const latitudeMeters = 110540.0;
  LatLng? closest;
  var closestSquaredDistance = double.infinity;

  for (var index = 0; index < route.length - 1; index++) {
    final start = route[index];
    final end = route[index + 1];
    final startX = (start.longitude - position.longitude) * longitudeMeters;
    final startY = (start.latitude - position.latitude) * latitudeMeters;
    final endX = (end.longitude - position.longitude) * longitudeMeters;
    final endY = (end.latitude - position.latitude) * latitudeMeters;
    final dx = endX - startX;
    final dy = endY - startY;
    final segmentSquaredLength = dx * dx + dy * dy;
    final progress = segmentSquaredLength == 0
        ? 0.0
        : ((-startX * dx - startY * dy) / segmentSquaredLength).clamp(0.0, 1.0);
    final projectedX = startX + dx * progress;
    final projectedY = startY + dy * progress;
    final squaredDistance = projectedX * projectedX + projectedY * projectedY;
    if (squaredDistance < closestSquaredDistance) {
      closestSquaredDistance = squaredDistance;
      closest = LatLng(
        start.latitude + (end.latitude - start.latitude) * progress,
        start.longitude + (end.longitude - start.longitude) * progress,
      );
    }
  }

  return closest != null &&
          math.sqrt(closestSquaredDistance) <= maximumDistanceMeters
      ? closest
      : position;
}

double distanceFromMototaxiRouteMeters(LatLng position, List<LatLng> route) =>
    const Distance().as(
      LengthUnit.Meter,
      position,
      snapMototaxiPositionToRoute(position, route,
          maximumDistanceMeters: double.infinity),
    );

const configuredMapProvider =
    String.fromEnvironment('MAP_PROVIDER', defaultValue: 'google');

const _androidMapId = String.fromEnvironment('GOOGLE_MAPS_ANDROID_MAP_ID');
const _androidLightMapId =
    String.fromEnvironment('GOOGLE_MAPS_ANDROID_LIGHT_MAP_ID');
const _androidDarkMapId =
    String.fromEnvironment('GOOGLE_MAPS_ANDROID_DARK_MAP_ID');
const _iosMapId = String.fromEnvironment('GOOGLE_MAPS_IOS_MAP_ID');
const _webMapId = String.fromEnvironment('GOOGLE_MAPS_WEB_MAP_ID');

String? _nonEmptyMapId(String value) {
  final normalized = value.trim();
  return normalized.isEmpty ? null : normalized;
}

String? _configuredGoogleMapId(Brightness brightness) {
  final value = kIsWeb
      ? _webMapId
      : switch (defaultTargetPlatform) {
          TargetPlatform.android => brightness == Brightness.dark
              ? (_nonEmptyMapId(_androidDarkMapId) ?? _androidMapId)
              : (_nonEmptyMapId(_androidLightMapId) ?? _androidMapId),
          TargetPlatform.iOS => _iosMapId,
          _ => '',
        };
  return _nonEmptyMapId(value);
}

bool get _usesSeparateAndroidMapIds =>
    !kIsWeb &&
    defaultTargetPlatform == TargetPlatform.android &&
    _nonEmptyMapId(_androidLightMapId) != null &&
    _nonEmptyMapId(_androidDarkMapId) != null;

const _googleLightMapStyle = '''[
  {"elementType":"geometry","stylers":[{"color":"#eef4f3"}]},
  {"elementType":"labels.icon","stylers":[{"visibility":"off"}]},
  {"elementType":"labels.text.fill","stylers":[{"color":"#40565c"}]},
  {"elementType":"labels.text.stroke","stylers":[{"color":"#f7fbfa"}]},
  {"featureType":"poi","stylers":[{"visibility":"off"}]},
  {"featureType":"poi.medical","stylers":[{"visibility":"on"}]},
  {"featureType":"poi.park","stylers":[{"visibility":"on"}]},
  {"featureType":"poi.park","elementType":"geometry","stylers":[{"color":"#dcebdc"}]},
  {"featureType":"road","elementType":"geometry","stylers":[{"color":"#ffffff"}]},
  {"featureType":"road","elementType":"geometry.stroke","stylers":[{"color":"#d5e1df"}]},
  {"featureType":"road.arterial","elementType":"geometry","stylers":[{"color":"#f7fbfa"}]},
  {"featureType":"road.highway","elementType":"geometry","stylers":[{"color":"#c8dedb"}]},
  {"featureType":"transit.station","stylers":[{"visibility":"on"}]},
  {"featureType":"water","elementType":"geometry","stylers":[{"color":"#b9dce3"}]}
]''';

const _googleDarkMapStyle = '''[
  {"elementType":"geometry","stylers":[{"color":"#15252c"}]},
  {"elementType":"labels.icon","stylers":[{"visibility":"off"}]},
  {"elementType":"labels.text.fill","stylers":[{"color":"#c8d8dc"}]},
  {"elementType":"labels.text.stroke","stylers":[{"color":"#15252c"}]},
  {"featureType":"administrative","elementType":"geometry.stroke","stylers":[{"color":"#425960"}]},
  {"featureType":"poi","stylers":[{"visibility":"off"}]},
  {"featureType":"poi.medical","stylers":[{"visibility":"on"}]},
  {"featureType":"poi.park","stylers":[{"visibility":"on"}]},
  {"featureType":"poi.park","elementType":"geometry","stylers":[{"color":"#1d3b35"}]},
  {"featureType":"road","elementType":"geometry","stylers":[{"color":"#31444b"}]},
  {"featureType":"road","elementType":"geometry.stroke","stylers":[{"color":"#101c21"}]},
  {"featureType":"road.arterial","elementType":"geometry","stylers":[{"color":"#3b535b"}]},
  {"featureType":"road.highway","elementType":"geometry","stylers":[{"color":"#54727a"}]},
  {"featureType":"transit.station","stylers":[{"visibility":"on"}]},
  {"featureType":"water","elementType":"geometry","stylers":[{"color":"#0a3545"}]},
  {"featureType":"water","elementType":"labels.text.fill","stylers":[{"color":"#81b6c5"}]}
]''';

class LiveMap extends StatefulWidget {
  const LiveMap({
    required this.originLabel,
    required this.destinationLabel,
    this.pickup,
    this.dropoff,
    this.stops = const [],
    this.driverPosition,
    this.selfDriverPosition,
    this.driverBearing = 0,
    this.driverMarkerStatus = MototaxiMarkerStatus.assigned,
    this.routePoints = const [],
    this.nearbyDrivers = const {},
    this.editing,
    this.onSelectionCenterChanged,
    this.onSelectionSettled,
    this.onSelectionMovementStarted,
    this.onUseCurrentLocation,
    this.onCenterCurrentLocation,
    this.mapAccessory,
    this.currentLocation,
    this.referenceLocation,
    this.height = 320,
    this.fillAvailable = false,
    this.viewportPadding = EdgeInsets.zero,
    this.borderRadius = 20,
    super.key,
  });

  final String originLabel;
  final String destinationLabel;
  final LatLng? pickup;
  final LatLng? dropoff;
  final List<LatLng> stops;
  final LatLng? driverPosition;
  final LatLng? selfDriverPosition;
  final double driverBearing;
  final MototaxiMarkerStatus driverMarkerStatus;
  final List<LatLng> routePoints;
  final Map<String, LatLng> nearbyDrivers;
  final MapPointSelection? editing;
  final ValueChanged<LatLng>? onSelectionCenterChanged;
  final ValueChanged<LatLng>? onSelectionSettled;
  final VoidCallback? onSelectionMovementStarted;
  final VoidCallback? onUseCurrentLocation;
  final Future<LatLng?> Function()? onCenterCurrentLocation;

  /// Control opcional del mapa, separado visual y táctilmente del botón de
  /// ubicación.
  final Widget? mapAccessory;
  final LatLng? currentLocation;

  /// Referencia visual para evitar una pantalla bloqueada mientras llega el
  /// GPS. No genera marcador ni se utiliza como ubicación real del usuario.
  final LatLng? referenceLocation;
  final double height;
  final bool fillAvailable;
  final EdgeInsets viewportPadding;
  final double borderRadius;

  @override
  State<LiveMap> createState() => _LiveMapState();
}

class _LiveMapState extends State<LiveMap> with TickerProviderStateMixin {
  static const _nearbyClusterId = gmaps.ClusterManagerId('nearby-mototaxis');
  late final AnimationController _movement;
  late final AnimationController _assignedPulse;
  final MapController _mapController = MapController();
  gmaps.GoogleMapController? _googleMapController;
  LatLng? _displayedDriver;
  LatLng? _movementStart;
  LatLng? _movementEnd;
  double _displayedBearing = 0;
  double _movementStartBearing = 0;
  double _movementEndBearing = 0;
  DateTime? _lastDriverTargetAt;
  double _lastMovementFrame = -1;
  double _lastPulseFrame = -1;
  LatLng? _selectionCenter;
  final Map<MototaxiMarkerStatus, gmaps.BitmapDescriptor> _motoIcons = {};
  Timer? _fitDebounce;
  bool _cameraAnimationRunning = false;
  gmaps.CameraUpdate? _pendingCameraUpdate;

  @override
  void initState() {
    super.initState();
    _displayedDriver = _snapDriverPosition(widget.driverPosition);
    _displayedBearing = _normalizedBearing(widget.driverBearing);
    if (_displayedDriver != null) _lastDriverTargetAt = DateTime.now();
    if (widget.editing != null) {
      _selectionCenter = widget.editing == MapPointSelection.origin
          ? widget.pickup ?? widget.currentLocation ?? _center
          : widget.dropoff ??
              widget.pickup ??
              widget.currentLocation ??
              _center;
    }
    _movement = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..addListener(() {
        final start = _movementStart;
        final end = _movementEnd;
        if (start == null || end == null || !mounted) return;
        final progress = _movement.value;
        if (progress < 1 && progress - _lastMovementFrame < 1 / 30) return;
        _lastMovementFrame = progress;
        setState(() {
          _displayedDriver = LatLng(
            ui.lerpDouble(start.latitude, end.latitude, progress)!,
            ui.lerpDouble(start.longitude, end.longitude, progress)!,
          );
          _displayedBearing = _interpolateBearing(
              _movementStartBearing, _movementEndBearing, progress);
        });
      });
    _assignedPulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1800),
    )..addListener(() {
        if (widget.driverMarkerStatus != MototaxiMarkerStatus.assigned ||
            _displayedDriver == null ||
            !mounted) {
          return;
        }
        final progress = _assignedPulse.value;
        if (progress < 1 && (progress - _lastPulseFrame).abs() < 1 / 15) {
          return;
        }
        _lastPulseFrame = progress;
        setState(() {});
      });
    _syncAssignedPulse();
    if (configuredMapProvider == 'google') {
      _prepareGoogleMarkerIcons();
    }
  }

  Future<void> _prepareGoogleMarkerIcons() async {
    final pixelRatio = View.of(context).devicePixelRatio.clamp(1.0, 3.0);
    final data = await rootBundle.load(_mototaxiAsset);
    final codec = await ui.instantiateImageCodec(
      data.buffer.asUint8List(),
      targetWidth: (42 * pixelRatio * 2).round(),
    );
    final frame = await codec.getNextFrame();
    final icons = <MototaxiMarkerStatus, gmaps.BitmapDescriptor>{};
    for (final status in MototaxiMarkerStatus.values) {
      icons[status] = await _mototaxiBitmap(
        frame.image,
        status,
        status == MototaxiMarkerStatus.available ? 34 : 42,
        pixelRatio,
      );
    }
    frame.image.dispose();
    codec.dispose();
    if (!mounted) return;
    setState(() {
      _motoIcons
        ..clear()
        ..addAll(icons);
    });
  }

  Future<gmaps.BitmapDescriptor> _mototaxiBitmap(
      ui.Image sourceImage,
      MototaxiMarkerStatus status,
      double logicalSize,
      double pixelRatio) async {
    final physicalSize = (logicalSize * pixelRatio).round();
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);
    final size = physicalSize.toDouble();
    final center = Offset(size / 2, size / 2);
    final color = mototaxiStatusColor(status);
    final radius = size * .44;
    canvas.drawCircle(center, radius, Paint()..color = _mototaxiMarkerSurface);
    if (status != MototaxiMarkerStatus.available) {
      canvas.drawCircle(
          center, radius, Paint()..color = color.withValues(alpha: .07));
    }
    canvas.drawCircle(
      center,
      radius,
      Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = math.max(2, size * .065),
    );
    final source = Rect.fromLTWH(
        0, 0, sourceImage.width.toDouble(), sourceImage.height.toDouble());
    final maxWidth = size * .80;
    final maxHeight = size * .68;
    final scale =
        math.min(maxWidth / sourceImage.width, maxHeight / sourceImage.height);
    final imageWidth = sourceImage.width * scale;
    final imageHeight = sourceImage.height * scale;
    final destination = Rect.fromCenter(
      center: center.translate(0, size * .015),
      width: imageWidth,
      height: imageHeight,
    );
    canvas.drawImageRect(
        sourceImage, source, destination, Paint()..isAntiAlias = true);
    final rendered =
        await recorder.endRecording().toImage(physicalSize, physicalSize);
    final bytes = await rendered.toByteData(format: ui.ImageByteFormat.png);
    rendered.dispose();
    return gmaps.BitmapDescriptor.bytes(
      Uint8List.view(bytes!.buffer),
      width: logicalSize,
      height: logicalSize,
    );
  }

  @override
  void didUpdateWidget(covariant LiveMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    final next = _snapDriverPosition(widget.driverPosition);
    if (next == null) {
      _movement.stop();
      _displayedDriver = null;
    } else if (_displayedDriver == null) {
      _displayedDriver = next;
      _displayedBearing = _normalizedBearing(widget.driverBearing);
      _lastDriverTargetAt = DateTime.now();
    } else if (_meaningfullyDifferent(_displayedDriver!, next)) {
      final now = DateTime.now();
      final updateInterval = _lastDriverTargetAt == null
          ? const Duration(milliseconds: 1600)
          : now.difference(_lastDriverTargetAt!);
      _lastDriverTargetAt = now;
      _movementStart = _displayedDriver;
      _movementEnd = next;
      _movementStartBearing = _displayedBearing;
      _movementEndBearing = _normalizedBearing(widget.driverBearing);
      _movement.duration = Duration(
        milliseconds: updateInterval.inMilliseconds.clamp(1200, 9500),
      );
      _lastMovementFrame = -1;
      _movement.forward(from: 0);
    } else if (oldWidget.driverBearing != widget.driverBearing) {
      _displayedBearing = _normalizedBearing(widget.driverBearing);
    }
    if (oldWidget.driverMarkerStatus != widget.driverMarkerStatus) {
      _lastPulseFrame = -1;
    }
    _syncAssignedPulse();
    if (oldWidget.editing != widget.editing && widget.editing != null) {
      _selectionCenter = widget.editing == MapPointSelection.origin
          ? widget.pickup ?? _center
          : widget.dropoff ?? _center;
      final selectionCenter = _selectionCenter;
      if (selectionCenter != null) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) _moveCamera(selectionCenter, 17);
        });
      }
    }
    final selectedPoint = widget.editing == MapPointSelection.origin
        ? widget.pickup
        : widget.dropoff;
    final oldSelectedPoint = widget.editing == MapPointSelection.origin
        ? oldWidget.pickup
        : oldWidget.dropoff;
    if (widget.editing != null &&
        selectedPoint != null &&
        selectedPoint != oldSelectedPoint) {
      _selectionCenter = selectedPoint;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        _moveCamera(selectedPoint, 17);
      });
    }
    if (widget.editing == null &&
        widget.routePoints.length > 1 &&
        oldWidget.routePoints != widget.routePoints) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _fitRoute();
      });
    } else if (widget.editing == null &&
        widget.routePoints.length > 1 &&
        oldWidget.viewportPadding != widget.viewportPadding) {
      _fitDebounce?.cancel();
      _fitDebounce = Timer(const Duration(milliseconds: 250), () {
        if (mounted) _fitRoute();
      });
    }
    final tripMapWasCleared = widget.editing == null &&
        widget.currentLocation != null &&
        ((oldWidget.routePoints.length > 1 && widget.routePoints.length <= 1) ||
            ((oldWidget.pickup != null || oldWidget.dropoff != null) &&
                widget.pickup == null &&
                widget.dropoff == null));
    if (tripMapWasCleared) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _moveCamera(widget.currentLocation!, 16);
      });
    }
    if (oldWidget.currentLocation == null &&
        widget.currentLocation != null &&
        widget.pickup == null &&
        _displayedDriver == null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _moveCamera(widget.currentLocation!, 17);
      });
    }
  }

  @override
  void dispose() {
    _fitDebounce?.cancel();
    _movement.dispose();
    _assignedPulse.dispose();
    _googleMapController?.dispose();
    super.dispose();
  }

  bool _meaningfullyDifferent(LatLng first, LatLng second,
      {double meters = 2}) {
    return const Distance().as(LengthUnit.Meter, first, second) >= meters;
  }

  LatLng? _snapDriverPosition(LatLng? position) {
    if (position == null || widget.routePoints.length < 2) return position;
    return snapMototaxiPositionToRoute(position, widget.routePoints);
  }

  double _normalizedBearing(double bearing) {
    if (!bearing.isFinite) return 0;
    return (bearing % 360 + 360) % 360;
  }

  double _interpolateBearing(double start, double end, double progress) {
    final difference = ((end - start + 540) % 360) - 180;
    return _normalizedBearing(start + difference * progress);
  }

  void _syncAssignedPulse() {
    final shouldPulse = _displayedDriver != null &&
        widget.driverMarkerStatus == MototaxiMarkerStatus.assigned;
    if (shouldPulse) {
      if (!_assignedPulse.isAnimating) {
        _assignedPulse.repeat(reverse: true);
      }
      return;
    }
    _assignedPulse.stop();
    if (_assignedPulse.value != 0) _assignedPulse.value = 0;
  }

  double get _pulseProgress => Curves.easeInOut.transform(_assignedPulse.value);

  Future<void> _animateGoogleCamera(gmaps.CameraUpdate update) async {
    final controller = _googleMapController;
    if (controller == null) return;
    if (_cameraAnimationRunning) {
      _pendingCameraUpdate = update;
      return;
    }
    _cameraAnimationRunning = true;
    try {
      await controller.animateCamera(update);
    } finally {
      _cameraAnimationRunning = false;
      final pending = _pendingCameraUpdate;
      _pendingCameraUpdate = null;
      if (pending != null && mounted) {
        unawaited(_animateGoogleCamera(pending));
      }
    }
  }

  void _moveCamera(LatLng point, double zoom) {
    if (configuredMapProvider == 'google') {
      unawaited(_animateGoogleCamera(gmaps.CameraUpdate.newLatLngZoom(
          gmaps.LatLng(point.latitude, point.longitude), zoom)));
      return;
    }
    _mapController.move(point, zoom);
  }

  void _selectGeographicPoint(LatLng point, {bool settled = true}) {
    if (widget.editing == null) return;
    _selectionCenter = point;
    widget.onSelectionCenterChanged?.call(point);
    if (!settled) return;
    setState(() {});
    widget.onSelectionSettled?.call(point);
  }

  void _fitRoute() {
    final points = widget.routePoints;
    if (points.length < 2) return;
    if (configuredMapProvider == 'google') {
      final minLatitude =
          points.map((point) => point.latitude).reduce(math.min);
      final maxLatitude =
          points.map((point) => point.latitude).reduce(math.max);
      final minLongitude =
          points.map((point) => point.longitude).reduce(math.min);
      final maxLongitude =
          points.map((point) => point.longitude).reduce(math.max);
      if ((maxLatitude - minLatitude).abs() < .00001 &&
          (maxLongitude - minLongitude).abs() < .00001) {
        _moveCamera(points.first, 17);
        return;
      }
      unawaited(_animateGoogleCamera(
        gmaps.CameraUpdate.newLatLngBounds(
          gmaps.LatLngBounds(
            southwest: gmaps.LatLng(minLatitude, minLongitude),
            northeast: gmaps.LatLng(maxLatitude, maxLongitude),
          ),
          48,
        ),
      ));
      return;
    }
    _mapController.fitCamera(CameraFit.coordinates(
      coordinates: points,
      padding: EdgeInsets.fromLTRB(
        widget.viewportPadding.left + 48,
        widget.viewportPadding.top + 48,
        widget.viewportPadding.right + 48,
        widget.viewportPadding.bottom + 48,
      ),
    ));
  }

  LatLng? get _center =>
      _displayedDriver ??
      widget.pickup ??
      widget.selfDriverPosition ??
      widget.currentLocation ??
      widget.dropoff ??
      (widget.nearbyDrivers.isEmpty
          ? null
          : widget.nearbyDrivers.values.first) ??
      widget.referenceLocation;

  @override
  Widget build(BuildContext context) {
    final center = _center;
    if (center == null) {
      final placeholder = Container(
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(widget.borderRadius),
        ),
        child: const Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Icon(Icons.map_outlined, size: 38),
            SizedBox(height: 12),
            Text('Preparando el mapa…'),
          ]),
        ),
      );
      return widget.fillAvailable
          ? SizedBox.expand(child: placeholder)
          : SizedBox(height: widget.height, child: placeholder);
    }

    final markers = <Marker>[
      if (widget.editing != null && _selectionCenter != null)
        Marker(
          point: _selectionCenter!,
          width: 34,
          height: 52,
          child: _SelectionPin(selection: widget.editing!),
        ),
      if (widget.pickup != null && widget.editing == null)
        Marker(
          point: widget.pickup!,
          width: 30,
          height: 38,
          child: const _SimpleMapPin(
              icon: Icons.person_pin_circle, color: Color(0xff008b9a)),
        ),
      if (widget.dropoff != null && widget.editing == null)
        Marker(
          point: widget.dropoff!,
          width: 30,
          height: 38,
          child: const _SimpleMapPin(
              icon: Icons.flag_rounded, color: Color(0xffef5b4d)),
        ),
      for (var index = 0; index < widget.stops.length; index++)
        Marker(
          point: widget.stops[index],
          width: 30,
          height: 38,
          child: _NumberedStopPin(number: index + 1),
        ),
      for (final entry in widget.nearbyDrivers.entries)
        Marker(
          key: ValueKey(entry.key),
          point: entry.value,
          width: 34,
          height: 34,
          child: const MototaxiMarker(
              status: MototaxiMarkerStatus.available, size: 34),
        ),
      if (widget.selfDriverPosition != null)
        Marker(
          point: widget.selfDriverPosition!,
          width: 36,
          height: 36,
          child: const MototaxiMarker(
              status: MototaxiMarkerStatus.available, size: 36),
        ),
      if (widget.currentLocation != null &&
          widget.editing == null &&
          (widget.pickup == null ||
              _meaningfullyDifferent(widget.currentLocation!, widget.pickup!)))
        Marker(
          point: widget.currentLocation!,
          width: 30,
          height: 30,
          child: const _CurrentLocationMarker(),
        ),
      if (_displayedDriver != null)
        Marker(
          point: _displayedDriver!,
          width: 46,
          height: 46,
          child: MototaxiMarker(
            status: widget.driverMarkerStatus,
            size: 46,
            bearing: _displayedBearing,
            pulse: _pulseProgress,
          ),
        ),
    ];
    final googleMarkers = <gmaps.Marker>{
      if (widget.editing != null && _selectionCenter != null)
        gmaps.Marker(
          markerId: const gmaps.MarkerId('selected-map-point'),
          position: gmaps.LatLng(
              _selectionCenter!.latitude, _selectionCenter!.longitude),
          icon: gmaps.BitmapDescriptor.defaultMarkerWithHue(
              widget.editing == MapPointSelection.origin
                  ? gmaps.BitmapDescriptor.hueCyan
                  : gmaps.BitmapDescriptor.hueRed),
          anchor: const Offset(.5, 1),
          draggable: true,
          zIndexInt: 100,
          onDragStart: (_) => widget.onSelectionMovementStarted?.call(),
          onDrag: (point) => _selectGeographicPoint(
              LatLng(point.latitude, point.longitude),
              settled: false),
          onDragEnd: (point) =>
              _selectGeographicPoint(LatLng(point.latitude, point.longitude)),
        ),
      if (widget.pickup != null && widget.editing == null)
        gmaps.Marker(
          markerId: const gmaps.MarkerId('pickup'),
          position:
              gmaps.LatLng(widget.pickup!.latitude, widget.pickup!.longitude),
          icon: gmaps.BitmapDescriptor.defaultMarkerWithHue(
              gmaps.BitmapDescriptor.hueGreen),
          anchor: const Offset(.5, 1),
        ),
      if (widget.dropoff != null && widget.editing == null)
        gmaps.Marker(
          markerId: const gmaps.MarkerId('dropoff'),
          position:
              gmaps.LatLng(widget.dropoff!.latitude, widget.dropoff!.longitude),
          icon: gmaps.BitmapDescriptor.defaultMarkerWithHue(
              gmaps.BitmapDescriptor.hueRed),
          anchor: const Offset(.5, 1),
        ),
      for (var index = 0; index < widget.stops.length; index++)
        gmaps.Marker(
          markerId: gmaps.MarkerId('stop-${index + 1}'),
          position: gmaps.LatLng(
              widget.stops[index].latitude, widget.stops[index].longitude),
          icon: gmaps.BitmapDescriptor.defaultMarkerWithHue(
              gmaps.BitmapDescriptor.hueOrange),
          infoWindow: gmaps.InfoWindow(title: 'Parada ${index + 1}'),
          anchor: const Offset(.5, 1),
        ),
      for (final entry in widget.nearbyDrivers.entries)
        gmaps.Marker(
          markerId: gmaps.MarkerId('nearby-${entry.key}'),
          position: gmaps.LatLng(entry.value.latitude, entry.value.longitude),
          icon: _motoIcons[MototaxiMarkerStatus.available] ??
              gmaps.BitmapDescriptor.defaultMarkerWithHue(
                  gmaps.BitmapDescriptor.hueCyan),
          flat: true,
          anchor: const Offset(.5, .5),
          clusterManagerId: _nearbyClusterId,
        ),
      if (widget.selfDriverPosition != null)
        gmaps.Marker(
          markerId: const gmaps.MarkerId('self-driver'),
          position: gmaps.LatLng(widget.selfDriverPosition!.latitude,
              widget.selfDriverPosition!.longitude),
          flat: true,
          anchor: const Offset(.5, .5),
          icon: _motoIcons[MototaxiMarkerStatus.available] ??
              gmaps.BitmapDescriptor.defaultMarkerWithHue(
                  gmaps.BitmapDescriptor.hueAzure),
          zIndexInt: 20,
        ),
      if (widget.currentLocation != null &&
          widget.editing == null &&
          (widget.pickup == null ||
              _meaningfullyDifferent(widget.currentLocation!, widget.pickup!)))
        gmaps.Marker(
          markerId: const gmaps.MarkerId('current-device-location'),
          position: gmaps.LatLng(widget.currentLocation!.latitude,
              widget.currentLocation!.longitude),
          icon: gmaps.BitmapDescriptor.defaultMarkerWithHue(
              gmaps.BitmapDescriptor.hueAzure),
          zIndexInt: 19,
        ),
      if (_displayedDriver != null)
        gmaps.Marker(
          markerId: const gmaps.MarkerId('active-driver'),
          position: gmaps.LatLng(
              _displayedDriver!.latitude, _displayedDriver!.longitude),
          flat: true,
          rotation: mototaxiVisualRotation(_displayedBearing),
          icon: _motoIcons[widget.driverMarkerStatus] ??
              gmaps.BitmapDescriptor.defaultMarkerWithHue(
                  gmaps.BitmapDescriptor.hueOrange),
          anchor: const Offset(.5, .5),
          zIndexInt: 40,
        ),
    };

    final brightness = Theme.of(context).brightness;
    final googleMapId = _configuredGoogleMapId(brightness);
    final mapSurface = configuredMapProvider == 'google'
        ? gmaps.GoogleMap(
            key: ValueKey(
                'google-map-${googleMapId ?? 'local'}-${brightness.name}'),
            mapId: googleMapId,
            colorScheme: googleMapId == null || _usesSeparateAndroidMapIds
                ? null
                : brightness == Brightness.dark
                    ? gmaps.MapColorScheme.dark
                    : gmaps.MapColorScheme.light,
            style: googleMapId == null
                ? (brightness == Brightness.dark
                    ? _googleDarkMapStyle
                    : _googleLightMapStyle)
                : null,
            initialCameraPosition: gmaps.CameraPosition(
              target: gmaps.LatLng(center.latitude, center.longitude),
              zoom: 16,
            ),
            onMapCreated: (controller) {
              _googleMapController = controller;
              if (widget.editing == null && widget.routePoints.length > 1) {
                _fitRoute();
              }
            },
            mapToolbarEnabled: false,
            compassEnabled: false,
            myLocationButtonEnabled: false,
            myLocationEnabled: false,
            zoomControlsEnabled: false,
            rotateGesturesEnabled: false,
            tiltGesturesEnabled: false,
            buildingsEnabled: false,
            padding: widget.viewportPadding,
            gestureRecognizers: <Factory<OneSequenceGestureRecognizer>>{
              Factory<EagerGestureRecognizer>(() => EagerGestureRecognizer()),
            },
            clusterManagers: {
              const gmaps.ClusterManager(clusterManagerId: _nearbyClusterId),
            },
            markers: googleMarkers,
            circles: _displayedDriver != null &&
                    widget.driverMarkerStatus == MototaxiMarkerStatus.assigned
                ? {
                    gmaps.Circle(
                      circleId: const gmaps.CircleId('assigned-driver-halo'),
                      center: gmaps.LatLng(_displayedDriver!.latitude,
                          _displayedDriver!.longitude),
                      radius: 4.5 + 3.5 * _pulseProgress,
                      fillColor: _costaGoAssignedBlue.withValues(
                          alpha: .16 * (1 - _pulseProgress * .45)),
                      strokeColor: _costaGoAssignedBlue.withValues(
                          alpha: .42 * (1 - _pulseProgress * .55)),
                      strokeWidth: 2,
                      zIndex: 3,
                    ),
                  }
                : const {},
            polylines: widget.routePoints.length > 1
                ? {
                    gmaps.Polyline(
                      polylineId: const gmaps.PolylineId('route-outline'),
                      points: widget.routePoints
                          .map((point) =>
                              gmaps.LatLng(point.latitude, point.longitude))
                          .toList(),
                      color: Theme.of(context)
                          .colorScheme
                          .surface
                          .withValues(alpha: .86),
                      width: 9,
                      startCap: gmaps.Cap.roundCap,
                      endCap: gmaps.Cap.roundCap,
                      jointType: gmaps.JointType.round,
                      zIndex: 1,
                    ),
                    gmaps.Polyline(
                      polylineId: const gmaps.PolylineId('route'),
                      points: widget.routePoints
                          .map((point) =>
                              gmaps.LatLng(point.latitude, point.longitude))
                          .toList(),
                      color: const Color(0xff008b9a),
                      width: 6,
                      startCap: gmaps.Cap.roundCap,
                      endCap: gmaps.Cap.roundCap,
                      jointType: gmaps.JointType.round,
                      zIndex: 2,
                    )
                  }
                : const {},
            onTap: widget.editing == null
                ? null
                : (point) => _selectGeographicPoint(
                    LatLng(point.latitude, point.longitude)),
          )
        : FlutterMap(
            mapController: _mapController,
            options: MapOptions(
              initialCenter: center,
              initialZoom: 16,
              onTap: widget.editing == null
                  ? null
                  : (_, point) => _selectGeographicPoint(point),
            ),
            children: [
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'ec.mototaxi.atacames',
              ),
              if (widget.routePoints.length > 1)
                PolylineLayer(polylines: [
                  Polyline(
                    points: widget.routePoints,
                    color: Theme.of(context).colorScheme.primary,
                    borderColor: Colors.white,
                    borderStrokeWidth: 2,
                    strokeWidth: 6,
                  ),
                ]),
              MarkerLayer(markers: markers),
              const RichAttributionWidget(attributions: [
                TextSourceAttribution('OpenStreetMap contributors'),
              ]),
            ],
          );

    final mapContent = Stack(children: [
      mapSurface,
      if (widget.editing == null && widget.mapAccessory != null)
        Positioned(
          right: 12,
          bottom: widget.viewportPadding.bottom + 68,
          child: widget.mapAccessory!,
        ),
      if (widget.editing == null &&
          (widget.currentLocation != null ||
              widget.onUseCurrentLocation != null ||
              widget.onCenterCurrentLocation != null))
        Positioned(
          right: 12,
          bottom: widget.viewportPadding.bottom + 12,
          child: _MapLocationButton(
            onPressed: () async {
              final refreshed = await widget.onCenterCurrentLocation?.call();
              if (!mounted) return;
              final currentPoint = refreshed ??
                  widget.currentLocation ??
                  widget.pickup ??
                  center;
              _moveCamera(currentPoint, 17);
              if (refreshed == null && widget.currentLocation == null) {
                widget.onUseCurrentLocation?.call();
              }
            },
          ),
        ),
      if (widget.editing != null) ...[
        Positioned(
          right: 12,
          bottom: widget.viewportPadding.bottom + 12,
          child: _MapLocationButton(
            onPressed: widget.onUseCurrentLocation == null
                ? null
                : () {
                    final currentPoint =
                        widget.currentLocation ?? widget.pickup ?? center;
                    _selectGeographicPoint(currentPoint);
                    _moveCamera(currentPoint, 17);
                    if (widget.currentLocation == null) {
                      widget.onUseCurrentLocation!();
                    }
                  },
          ),
        ),
      ],
    ]);
    return ClipRRect(
      borderRadius: BorderRadius.circular(widget.borderRadius),
      child: widget.fillAvailable
          ? SizedBox.expand(child: mapContent)
          : SizedBox(height: widget.height, child: mapContent),
    );
  }
}

class _MapLocationButton extends StatelessWidget {
  const _MapLocationButton({required this.onPressed});

  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return FloatingActionButton.small(
      heroTag: null,
      tooltip: 'Volver a mi ubicación',
      onPressed: onPressed,
      elevation: 2,
      focusElevation: 3,
      hoverElevation: 3,
      highlightElevation: 1,
      backgroundColor:
          dark ? CostaGoPalette.darkSoftBlue : CostaGoPalette.surfaceAccent,
      foregroundColor:
          dark ? CostaGoPalette.darkPrimaryLight : CostaGoPalette.primaryDark,
      disabledElevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(
          color: dark
              ? CostaGoPalette.darkBlueBorder
              : CostaGoPalette.borderAccent,
        ),
      ),
      child: const Icon(Icons.my_location),
    );
  }
}

class _SelectionPin extends StatelessWidget {
  const _SelectionPin({required this.selection});

  final MapPointSelection selection;

  @override
  Widget build(BuildContext context) {
    final isOrigin = selection == MapPointSelection.origin;
    final color = isOrigin ? const Color(0xff008b9a) : const Color(0xffef5b4d);
    return Column(mainAxisSize: MainAxisSize.min, children: [
      Container(
        width: 34,
        height: 34,
        decoration: BoxDecoration(
          color: color,
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white, width: 3),
          boxShadow: const [
            BoxShadow(
                color: Colors.black38, blurRadius: 8, offset: Offset(0, 3))
          ],
        ),
        child: Icon(isOrigin ? Icons.person_pin_circle : Icons.flag_rounded,
            color: Colors.white, size: 18),
      ),
      Container(width: 3, height: 13, color: color),
      Container(
        width: 9,
        height: 5,
        decoration: BoxDecoration(
          color: Colors.black.withValues(alpha: .24),
          borderRadius: BorderRadius.circular(50),
        ),
      ),
    ]);
  }
}

class _CurrentLocationMarker extends StatelessWidget {
  const _CurrentLocationMarker();

  @override
  Widget build(BuildContext context) => Container(
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.primary,
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white, width: 3),
          boxShadow: const [BoxShadow(color: Colors.black38, blurRadius: 6)],
        ),
        child:
            const Icon(Icons.person_pin_circle, color: Colors.white, size: 18),
      );
}

/// Marcador reutilizable. La ilustración siempre es el PNG oficial; el estado
/// se comunica únicamente mediante el tratamiento exterior generado por la UI.
class MototaxiMarker extends StatelessWidget {
  const MototaxiMarker({
    required this.status,
    this.size = 32,
    this.bearing = 0,
    this.pulse = 0,
    super.key,
  }) : assert(size >= 24 && size <= 48);

  final MototaxiMarkerStatus status;
  final double size;
  final double bearing;
  final double pulse;

  @override
  Widget build(BuildContext context) {
    final color = mototaxiStatusColor(status);
    final isAssigned = status == MototaxiMarkerStatus.assigned;
    return SizedBox.square(
      dimension: size,
      child: CustomPaint(
        painter: _MototaxiHaloPainter(
          color: color,
          pulse: isAssigned ? pulse.clamp(0, 1) : 0,
          emphasized: status != MototaxiMarkerStatus.available,
        ),
        child: Padding(
          padding: EdgeInsets.all(size * .10),
          child: Transform.rotate(
            angle: mototaxiVisualRotation(bearing) * math.pi / 180,
            child: Image.asset(
              _mototaxiAsset,
              fit: BoxFit.contain,
              filterQuality: FilterQuality.high,
              gaplessPlayback: true,
            ),
          ),
        ),
      ),
    );
  }
}

class _MototaxiHaloPainter extends CustomPainter {
  const _MototaxiHaloPainter({
    required this.color,
    required this.pulse,
    required this.emphasized,
  });

  final Color color;
  final double pulse;
  final bool emphasized;

  @override
  void paint(Canvas canvas, Size size) {
    final center = size.center(Offset.zero);
    final outerRadius = size.shortestSide * (.40 + pulse * .075);
    if (pulse > 0) {
      canvas.drawCircle(
        center,
        outerRadius,
        Paint()
          ..color = color.withValues(alpha: .22 * (1 - pulse * .50))
          ..maskFilter = MaskFilter.blur(BlurStyle.normal, size.width * .055),
      );
    }
    final radius = size.shortestSide * .39;
    canvas.drawCircle(
      center,
      radius,
      Paint()..color = _mototaxiMarkerSurface,
    );
    canvas.drawCircle(
      center,
      radius,
      Paint()..color = color.withValues(alpha: emphasized ? .08 : .035),
    );
    canvas.drawCircle(
      center,
      radius,
      Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = math.max(1.5, size.shortestSide * .055),
    );
  }

  @override
  bool shouldRepaint(covariant _MototaxiHaloPainter oldDelegate) =>
      oldDelegate.color != color ||
      oldDelegate.pulse != pulse ||
      oldDelegate.emphasized != emphasized;
}

class _SimpleMapPin extends StatelessWidget {
  const _SimpleMapPin({required this.icon, required this.color});
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) => Icon(icon,
      color: color,
      size: 29,
      shadows: const [Shadow(color: Colors.black38, blurRadius: 5)]);
}

class _NumberedStopPin extends StatelessWidget {
  const _NumberedStopPin({required this.number});

  final int number;

  @override
  Widget build(BuildContext context) => Container(
        width: 28,
        height: 28,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: const Color(0xffffa62b),
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white, width: 2),
          boxShadow: const [BoxShadow(color: Colors.black38, blurRadius: 5)],
        ),
        child: Text('$number',
            style: const TextStyle(
                color: Colors.white, fontWeight: FontWeight.w800)),
      );
}
