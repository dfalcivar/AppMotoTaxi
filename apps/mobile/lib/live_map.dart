import 'dart:math' as math;
import 'dart:ui' show lerpDouble;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart' as gmaps;
import 'package:latlong2/latlong.dart';

enum MapPointSelection { origin, destination }

const configuredMapProvider =
    String.fromEnvironment('MAP_PROVIDER', defaultValue: 'osm');

class LiveMap extends StatefulWidget {
  const LiveMap({
    required this.originLabel,
    required this.destinationLabel,
    this.pickup,
    this.dropoff,
    this.driverPosition,
    this.driverBearing = 0,
    this.routePoints = const [],
    this.nearbyDrivers = const {},
    this.editing,
    this.onPointSelected,
    this.onUseCurrentLocation,
    this.height = 320,
    super.key,
  });

  final String originLabel;
  final String destinationLabel;
  final LatLng? pickup;
  final LatLng? dropoff;
  final LatLng? driverPosition;
  final double driverBearing;
  final List<LatLng> routePoints;
  final Map<String, LatLng> nearbyDrivers;
  final MapPointSelection? editing;
  final ValueChanged<LatLng>? onPointSelected;
  final VoidCallback? onUseCurrentLocation;
  final double height;

  @override
  State<LiveMap> createState() => _LiveMapState();
}

class _LiveMapState extends State<LiveMap> with SingleTickerProviderStateMixin {
  late final AnimationController _movement;
  final MapController _mapController = MapController();
  gmaps.GoogleMapController? _googleMapController;
  LatLng? _displayedDriver;
  LatLng? _movementStart;
  LatLng? _movementEnd;
  LatLng? _selectionCenter;

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
            lerpDouble(start.latitude, end.latitude, curve)!,
            lerpDouble(start.longitude, end.longitude, curve)!,
          );
        });
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
  }

  @override
  void dispose() {
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

  LatLng? get _center =>
      _displayedDriver ??
      widget.pickup ??
      widget.dropoff ??
      (widget.nearbyDrivers.isEmpty ? null : widget.nearbyDrivers.values.first);

  @override
  Widget build(BuildContext context) {
    final center = _center;
    if (center == null) {
      return Container(
        height: widget.height,
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(20),
        ),
        child: const Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            CircularProgressIndicator(),
            SizedBox(height: 12),
            Text('Obteniendo tu ubicación GPS…'),
          ]),
        ),
      );
    }

    final markers = <Marker>[
      if (widget.pickup != null)
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
      if (widget.dropoff != null)
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
          width: 30,
          height: 30,
          child: const _MotoMarker(color: Color(0xff007f8b)),
        ),
      if (_displayedDriver != null)
        Marker(
          point: _displayedDriver!,
          width: 36,
          height: 36,
          child: Transform.rotate(
            angle: widget.driverBearing * math.pi / 180,
            child: const _MotoMarker(color: Colors.orange),
          ),
        ),
    ];
    final googleMarkers = <gmaps.Marker>{
      if (widget.pickup != null)
        gmaps.Marker(
          markerId: const gmaps.MarkerId('pickup'),
          position:
              gmaps.LatLng(widget.pickup!.latitude, widget.pickup!.longitude),
          icon: gmaps.BitmapDescriptor.defaultMarkerWithHue(
              gmaps.BitmapDescriptor.hueGreen),
          infoWindow: gmaps.InfoWindow(title: widget.originLabel),
        ),
      if (widget.dropoff != null)
        gmaps.Marker(
          markerId: const gmaps.MarkerId('dropoff'),
          position:
              gmaps.LatLng(widget.dropoff!.latitude, widget.dropoff!.longitude),
          icon: gmaps.BitmapDescriptor.defaultMarkerWithHue(
              gmaps.BitmapDescriptor.hueRed),
          infoWindow: gmaps.InfoWindow(title: widget.destinationLabel),
        ),
      for (final entry in widget.nearbyDrivers.entries)
        gmaps.AdvancedMarker(
          markerId: gmaps.MarkerId('nearby-${entry.key}'),
          position: gmaps.LatLng(entry.value.latitude, entry.value.longitude),
          icon: gmaps.BitmapDescriptor.pinConfig(
            backgroundColor: const Color(0xff007f8b),
            borderColor: Colors.white,
            glyph: const gmaps.TextGlyph(text: '🛺', textColor: Colors.white),
          ),
          anchor: const Offset(.5, .5),
        ),
      if (_displayedDriver != null)
        gmaps.AdvancedMarker(
          markerId: const gmaps.MarkerId('active-driver'),
          position: gmaps.LatLng(
              _displayedDriver!.latitude, _displayedDriver!.longitude),
          rotation: widget.driverBearing,
          flat: true,
          icon: gmaps.BitmapDescriptor.pinConfig(
            backgroundColor: Colors.orange,
            borderColor: Colors.white,
            glyph: const gmaps.TextGlyph(text: '🛺', textColor: Colors.white),
          ),
          anchor: const Offset(.5, .5),
        ),
    };

    final mapSurface = configuredMapProvider == 'google'
        ? gmaps.GoogleMap(
            initialCameraPosition: gmaps.CameraPosition(
              target: gmaps.LatLng(center.latitude, center.longitude),
              zoom: 16,
            ),
            onMapCreated: (controller) => _googleMapController = controller,
            mapToolbarEnabled: false,
            compassEnabled: true,
            myLocationButtonEnabled: false,
            zoomControlsEnabled: false,
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
            onCameraMove: widget.editing == null
                ? null
                : (position) => _selectionCenter =
                    LatLng(position.target.latitude, position.target.longitude),
            onTap: widget.onPointSelected == null
                ? null
                : (point) {
                    final selected = LatLng(point.latitude, point.longitude);
                    _selectionCenter = selected;
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

    return ClipRRect(
      borderRadius: BorderRadius.circular(20),
      child: SizedBox(
        height: widget.height,
        child: Stack(children: [
          mapSurface,
          if (widget.editing != null)
            Positioned(
              left: 12,
              right: 12,
              top: 10,
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
                      widget.editing == MapPointSelection.origin
                          ? 'Mueve el mapa para ajustar el punto de encuentro'
                          : 'Mueve el mapa para ajustar el destino',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Colors.white),
                    ),
                  ),
                ),
              ),
            ),
          if (widget.editing != null) ...[
            const Center(
              child: IgnorePointer(
                child: Padding(
                  padding: EdgeInsets.only(bottom: 25),
                  child: Icon(Icons.location_pin,
                      size: 38,
                      color: Color(0xffef4338),
                      shadows: [Shadow(color: Colors.black38, blurRadius: 5)]),
                ),
              ),
            ),
            Positioned(
              right: 12,
              bottom: 72,
              child: FloatingActionButton.small(
                heroTag: null,
                tooltip: 'Volver a mi ubicaciÃ³n',
                onPressed: widget.onUseCurrentLocation == null
                    ? null
                    : () {
                        final currentPoint = widget.pickup ?? center;
                        _selectionCenter = currentPoint;
                        _moveCamera(currentPoint, 17);
                        widget.onUseCurrentLocation!();
                      },
                child: const Icon(Icons.my_location),
              ),
            ),
            Positioned(
              left: 12,
              right: 12,
              bottom: 12,
              child: FilledButton.icon(
                onPressed: widget.onPointSelected == null
                    ? null
                    : () => widget.onPointSelected!(_selectionCenter ?? center),
                icon: const Icon(Icons.check),
                label: Text(widget.editing == MapPointSelection.origin
                    ? 'Usar este punto como origen'
                    : 'Usar este punto como destino'),
              ),
            ),
          ],
        ]),
      ),
    );
  }
}

class _MotoMarker extends StatelessWidget {
  const _MotoMarker({required this.color});
  final Color color;

  @override
  Widget build(BuildContext context) => Stack(
        alignment: Alignment.center,
        children: [
          const Icon(Icons.electric_rickshaw,
              color: Colors.white,
              size: 29,
              shadows: [Shadow(color: Colors.black54, blurRadius: 6)]),
          Icon(Icons.electric_rickshaw, color: color, size: 25),
        ],
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
