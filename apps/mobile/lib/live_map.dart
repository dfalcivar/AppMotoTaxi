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
    String.fromEnvironment('MAP_PROVIDER', defaultValue: 'osm');

const _googleDarkMapStyle = '''[
  {"elementType":"geometry","stylers":[{"color":"#17242b"}]},
  {"elementType":"labels.icon","stylers":[{"visibility":"off"}]},
  {"elementType":"labels.text.fill","stylers":[{"color":"#d5e4e8"}]},
  {"elementType":"labels.text.stroke","stylers":[{"color":"#17242b"}]},
  {"featureType":"administrative","elementType":"geometry.stroke","stylers":[{"color":"#4c6770"}]},
  {"featureType":"poi","elementType":"geometry","stylers":[{"color":"#20343b"}]},
  {"featureType":"poi.park","elementType":"geometry","stylers":[{"color":"#1d4439"}]},
  {"featureType":"road","elementType":"geometry","stylers":[{"color":"#33474f"}]},
  {"featureType":"road","elementType":"geometry.stroke","stylers":[{"color":"#152126"}]},
  {"featureType":"road.highway","elementType":"geometry","stylers":[{"color":"#42606a"}]},
  {"featureType":"transit","elementType":"geometry","stylers":[{"color":"#294048"}]},
  {"featureType":"water","elementType":"geometry","stylers":[{"color":"#0b3647"}]},
  {"featureType":"water","elementType":"labels.text.fill","stylers":[{"color":"#78b8cc"}]}
]''';

class LiveMap extends StatefulWidget {
  const LiveMap({
    required this.originLabel,
    required this.destinationLabel,
    this.pickup,
    this.dropoff,
    this.driverPosition,
    this.selfDriverPosition,
    this.driverBearing = 0,
    this.routePoints = const [],
    this.nearbyDrivers = const {},
    this.editing,
    this.onPointSelected,
    this.onUseCurrentLocation,
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
  final LatLng? driverPosition;
  final LatLng? selfDriverPosition;
  final double driverBearing;
  final List<LatLng> routePoints;
  final Map<String, LatLng> nearbyDrivers;
  final MapPointSelection? editing;
  final ValueChanged<LatLng>? onPointSelected;
  final VoidCallback? onUseCurrentLocation;
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

  @override
  void initState() {
    super.initState();
    _displayedDriver = widget.driverPosition;
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
    } else if (oldWidget.driverPosition != next) {
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

  void _moveCamera(LatLng point, double zoom) {
    if (configuredMapProvider == 'google') {
      _googleMapController?.animateCamera(gmaps.CameraUpdate.newLatLngZoom(
          gmaps.LatLng(point.latitude, point.longitude), zoom));
      return;
    }
    _mapController.move(point, zoom);
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
      _googleMapController?.animateCamera(
        gmaps.CameraUpdate.newLatLngBounds(
          gmaps.LatLngBounds(
            southwest: gmaps.LatLng(minLatitude, minLongitude),
            northeast: gmaps.LatLng(maxLatitude, maxLongitude),
          ),
          48,
        ),
      );
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

    final selectionPoint = widget.editing == null
        ? null
        : _selectionCenter ??
            (widget.editing == MapPointSelection.origin
                ? widget.pickup
                : widget.dropoff) ??
            center;

    final markers = <Marker>[
      if (widget.pickup != null && widget.editing != MapPointSelection.origin)
        Marker(
          point: widget.pickup!,
          width: 130,
          height: 68,
          child: _MapLabel(
            icon: Icons.location_on,
            color: Colors.green,
            text: widget.originLabel,
          ),
        ),
      if (widget.dropoff != null &&
          widget.editing != MapPointSelection.destination)
        Marker(
          point: widget.dropoff!,
          width: 130,
          height: 68,
          child: _MapLabel(
            icon: Icons.flag,
            color: Colors.red,
            text: widget.destinationLabel,
          ),
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
      if (_displayedDriver != null)
        Marker(
          point: _displayedDriver!,
          width: 32,
          height: 32,
          child: const _MotoMarker(),
        ),
    ];
    final googleMarkers = <gmaps.Marker>{
      if (widget.pickup != null && widget.editing != MapPointSelection.origin)
        gmaps.Marker(
          markerId: const gmaps.MarkerId('pickup'),
          position:
              gmaps.LatLng(widget.pickup!.latitude, widget.pickup!.longitude),
          icon: gmaps.BitmapDescriptor.defaultMarkerWithHue(
              gmaps.BitmapDescriptor.hueGreen),
          infoWindow: gmaps.InfoWindow(title: widget.originLabel),
        ),
      if (widget.dropoff != null &&
          widget.editing != MapPointSelection.destination)
        gmaps.Marker(
          markerId: const gmaps.MarkerId('dropoff'),
          position:
              gmaps.LatLng(widget.dropoff!.latitude, widget.dropoff!.longitude),
          icon: gmaps.BitmapDescriptor.defaultMarkerWithHue(
              gmaps.BitmapDescriptor.hueRed),
          infoWindow: gmaps.InfoWindow(title: widget.destinationLabel),
        ),
      if (selectionPoint != null)
        gmaps.Marker(
          markerId: const gmaps.MarkerId('selection-point'),
          position:
              gmaps.LatLng(selectionPoint.latitude, selectionPoint.longitude),
          draggable: true,
          consumeTapEvents: true,
          icon: gmaps.BitmapDescriptor.defaultMarkerWithHue(
            widget.editing == MapPointSelection.origin
                ? gmaps.BitmapDescriptor.hueGreen
                : gmaps.BitmapDescriptor.hueRed,
          ),
          infoWindow: gmaps.InfoWindow(
            title: widget.editing == MapPointSelection.origin
                ? 'Arrastra para ajustar el origen'
                : 'Arrastra para ajustar el destino',
          ),
          onDragEnd: (point) => setState(
              () => _selectionCenter = LatLng(point.latitude, point.longitude)),
        ),
      for (final entry in widget.nearbyDrivers.entries)
        gmaps.Marker(
          markerId: gmaps.MarkerId('nearby-${entry.key}'),
          position: gmaps.LatLng(entry.value.latitude, entry.value.longitude),
          icon: _nearbyMotoIcon ??
              gmaps.BitmapDescriptor.defaultMarkerWithHue(
                  gmaps.BitmapDescriptor.hueCyan),
          flat: true,
          infoWindow: const gmaps.InfoWindow(title: 'Mototaxi disponible'),
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
          infoWindow: const gmaps.InfoWindow(title: 'Mi ubicacion'),
          zIndexInt: 20,
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

    final mapSurface = configuredMapProvider == 'google'
        ? gmaps.GoogleMap(
            style: Theme.of(context).brightness == Brightness.dark
                ? _googleDarkMapStyle
                : null,
            initialCameraPosition: gmaps.CameraPosition(
              target: gmaps.LatLng(center.latitude, center.longitude),
              zoom: 16,
            ),
            onMapCreated: (controller) => _googleMapController = controller,
            mapToolbarEnabled: false,
            compassEnabled: true,
            myLocationButtonEnabled: false,
            zoomControlsEnabled: false,
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
                      polylineId: const gmaps.PolylineId('route'),
                      points: widget.routePoints
                          .map((point) =>
                              gmaps.LatLng(point.latitude, point.longitude))
                          .toList(),
                      color: Theme.of(context).colorScheme.primary,
                      width: 6,
                    )
                  }
                : const {},
            onTap: widget.onPointSelected == null
                ? null
                : (point) {
                    final selected = LatLng(point.latitude, point.longitude);
                    setState(() => _selectionCenter = selected);
                    _moveCamera(selected, 17);
                  },
          )
        : FlutterMap(
            mapController: _mapController,
            options: MapOptions(
              initialCenter: center,
              initialZoom: 16,
              onPositionChanged: (camera, hasGesture) {
                if (widget.editing != null && hasGesture) {
                  _selectionCenter = camera.center;
                }
              },
              onTap: widget.onPointSelected == null
                  ? null
                  : (_, point) {
                      _selectionCenter = point;
                      _moveCamera(point, _mapController.camera.zoom);
                    },
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
      if (widget.editing != null)
        Positioned(
          left: 12,
          right: 12,
          top: widget.viewportPadding.top + 10,
          child: IgnorePointer(
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: .74),
                borderRadius: BorderRadius.circular(20),
              ),
              child: Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
                child: Text(
                  configuredMapProvider == 'google'
                      ? (widget.editing == MapPointSelection.origin
                          ? 'Arrastra el punto verde para ajustar el origen'
                          : 'Arrastra el punto rojo para ajustar el destino')
                      : (widget.editing == MapPointSelection.origin
                          ? 'Mueve el mapa para ajustar el punto de encuentro'
                          : 'Mueve el mapa para ajustar el destino'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white),
                ),
              ),
            ),
          ),
        ),
      if (widget.editing == null &&
          (widget.currentLocation != null ||
              widget.onUseCurrentLocation != null))
        Positioned(
          right: 12,
          bottom: widget.viewportPadding.bottom + 12,
          child: FloatingActionButton.small(
            heroTag: null,
            tooltip: 'Volver a mi ubicación',
            onPressed: () {
              final currentPoint =
                  widget.currentLocation ?? widget.pickup ?? center;
              _moveCamera(currentPoint, 17);
              if (widget.currentLocation == null) {
                widget.onUseCurrentLocation?.call();
              }
            },
            child: const Icon(Icons.my_location),
          ),
        ),
      if (widget.editing != null) ...[
        if (configuredMapProvider != 'google')
          Center(
            child: IgnorePointer(
              child: Padding(
                padding: const EdgeInsets.only(bottom: 20),
                child: Icon(Icons.location_pin,
                    size: 34,
                    color: widget.editing == MapPointSelection.origin
                        ? const Color(0xff20a55b)
                        : const Color(0xffef4338),
                    shadows: const [
                      Shadow(color: Colors.black38, blurRadius: 5)
                    ]),
              ),
            ),
          ),
        Positioned(
          right: 12,
          bottom: widget.viewportPadding.bottom + 64,
          child: FloatingActionButton.small(
            heroTag: null,
            tooltip: 'Volver a mi ubicaciÃ³n',
            onPressed: widget.onUseCurrentLocation == null
                ? null
                : () {
                    final currentPoint =
                        widget.currentLocation ?? widget.pickup ?? center;
                    _selectionCenter = currentPoint;
                    _moveCamera(currentPoint, 17);
                    widget.onUseCurrentLocation!();
                  },
            child: const Icon(Icons.my_location),
          ),
        ),
        Positioned(
          left: 0,
          right: 0,
          bottom: widget.viewportPadding.bottom + 12,
          child: Center(
            child: FilledButton.icon(
              style: FilledButton.styleFrom(
                backgroundColor: Theme.of(context)
                    .colorScheme
                    .primary
                    .withValues(alpha: .82),
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
                minimumSize: Size.zero,
                visualDensity: VisualDensity.compact,
              ),
              onPressed: widget.onPointSelected == null
                  ? null
                  : () => widget.onPointSelected!(_selectionCenter ?? center),
              icon: const Icon(Icons.check, size: 18),
              label: Text(widget.editing == MapPointSelection.origin
                  ? 'Confirmar origen'
                  : 'Confirmar destino'),
            ),
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

class _MotoMarker extends StatelessWidget {
  const _MotoMarker();

  @override
  Widget build(BuildContext context) => Image.asset(
        'assets/images/mototaxi-map-marker.png',
        fit: BoxFit.contain,
        filterQuality: FilterQuality.high,
      );
}

class _MapLabel extends StatelessWidget {
  const _MapLabel(
      {required this.icon, required this.color, required this.text});
  final IconData icon;
  final Color color;
  final String text;

  @override
  Widget build(BuildContext context) => Column(children: [
        Icon(icon, color: color, size: 25),
        DecoratedBox(
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surface.withValues(alpha: .9),
            borderRadius: BorderRadius.circular(7),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
            child: Text(text,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 11)),
          ),
        ),
      ]);
}
