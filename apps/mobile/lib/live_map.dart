import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart' as gmaps;
import 'package:latlong2/latlong.dart';

enum MapPointSelection { origin, destination }

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
  final double height;
  final bool fillAvailable;
  final EdgeInsets viewportPadding;
  final double borderRadius;

  @override
  State<LiveMap> createState() => _LiveMapState();
}

class _LiveMapState extends State<LiveMap> with SingleTickerProviderStateMixin {
  static const _nearbyClusterId = gmaps.ClusterManagerId('nearby-mototaxis');
  late final AnimationController _movement;
  final MapController _mapController = MapController();
  gmaps.GoogleMapController? _googleMapController;
  LatLng? _displayedDriver;
  LatLng? _movementStart;
  LatLng? _movementEnd;
  LatLng? _selectionCenter;
  gmaps.BitmapDescriptor? _nearbyMotoIcon;
  gmaps.BitmapDescriptor? _activeMotoIcon;
  Timer? _fitDebounce;
  bool _cameraAnimationRunning = false;
  gmaps.CameraUpdate? _pendingCameraUpdate;

  @override
  void initState() {
    super.initState();
    _displayedDriver = widget.driverPosition;
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
        final curve = Curves.easeInOut.transform(_movement.value);
        setState(() {
          _displayedDriver = LatLng(
            ui.lerpDouble(start.latitude, end.latitude, curve)!,
            ui.lerpDouble(start.longitude, end.longitude, curve)!,
          );
        });
      });
    if (configuredMapProvider == 'google') {
      _prepareGoogleMarkerIcons();
    }
  }

  Future<void> _prepareGoogleMarkerIcons() async {
    const nearbyConfiguration = ImageConfiguration(size: Size(24, 24));
    const activeConfiguration = ImageConfiguration(size: Size(30, 30));
    final nearby = await gmaps.BitmapDescriptor.asset(
        nearbyConfiguration, 'assets/images/mototaxi-map-marker.png');
    final active = await gmaps.BitmapDescriptor.asset(
        activeConfiguration, 'assets/images/mototaxi-map-marker.png');
    if (!mounted) return;
    setState(() {
      _nearbyMotoIcon = nearby;
      _activeMotoIcon = active;
    });
  }

  @override
  void didUpdateWidget(covariant LiveMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    final next = widget.driverPosition;
    if (next == null) {
      _displayedDriver = null;
    } else if (_displayedDriver == null) {
      _displayedDriver = next;
    } else if (_meaningfullyDifferent(_displayedDriver!, next)) {
      _movementStart = _displayedDriver;
      _movementEnd = next;
      _movement.forward(from: 0);
    }
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
    _googleMapController?.dispose();
    super.dispose();
  }

  bool _meaningfullyDifferent(LatLng first, LatLng second,
      {double meters = 2}) {
    return const Distance().as(LengthUnit.Meter, first, second) >= meters;
  }

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
      (widget.nearbyDrivers.isEmpty ? null : widget.nearbyDrivers.values.first);

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
            CircularProgressIndicator(),
            SizedBox(height: 12),
            Text('Obteniendo tu ubicación GPS…'),
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
          width: 26,
          height: 26,
          child: const _MotoMarker(),
        ),
      if (widget.selfDriverPosition != null)
        Marker(
          point: widget.selfDriverPosition!,
          width: 38,
          height: 38,
          child: const _SelfDriverMarker(),
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
          width: 32,
          height: 32,
          child: const _MotoMarker(),
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
          icon: _nearbyMotoIcon ??
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
          icon: gmaps.BitmapDescriptor.defaultMarkerWithHue(
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
          icon: _activeMotoIcon ??
              gmaps.BitmapDescriptor.defaultMarkerWithHue(
                  gmaps.BitmapDescriptor.hueOrange),
          anchor: const Offset(.5, .55),
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
          right: 64,
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
          child: FloatingActionButton.small(
            heroTag: null,
            tooltip: 'Volver a mi ubicación',
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
            child: const Icon(Icons.my_location),
          ),
        ),
      if (widget.editing != null) ...[
        Positioned(
          right: 12,
          bottom: widget.viewportPadding.bottom + 12,
          child: FloatingActionButton.small(
            heroTag: null,
            tooltip: 'Volver a mi ubicación',
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
            child: const Icon(Icons.my_location),
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

class _SelfDriverMarker extends StatelessWidget {
  const _SelfDriverMarker();

  @override
  Widget build(BuildContext context) => Container(
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.primary,
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white, width: 3),
          boxShadow: const [BoxShadow(color: Colors.black38, blurRadius: 6)],
        ),
        child: const Icon(Icons.my_location, color: Colors.white, size: 20),
      );
}

class _CurrentLocationMarker extends StatelessWidget {
  const _CurrentLocationMarker();

  @override
  Widget build(BuildContext context) => Container(
        decoration: BoxDecoration(
          color: const Color(0xff1689d8),
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white, width: 3),
          boxShadow: const [BoxShadow(color: Colors.black38, blurRadius: 6)],
        ),
        child:
            const Icon(Icons.person_pin_circle, color: Colors.white, size: 18),
      );
}

class _MotoMarker extends StatelessWidget {
  const _MotoMarker();

  @override
  Widget build(BuildContext context) => Image.asset(
        'assets/images/mototaxi-map-marker.png',
        fit: BoxFit.contain,
        filterQuality: FilterQuality.high,
      );
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
