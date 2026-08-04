import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart' as gmaps;
import 'package:latlong2/latlong.dart';

enum MapPointSelection { origin, destination }

void _paintMotoTaxi(Canvas canvas, Size size, Color color) {
  final outline = Paint()
    ..color = const Color(0xff17333a)
    ..style = PaintingStyle.stroke
    ..strokeWidth = 1.6
    ..strokeJoin = StrokeJoin.round;
  final body = Paint()..color = color;
  final glass = Paint()..color = const Color(0xffc9f3fb);
  final dark = Paint()..color = const Color(0xff17252a);

  final vehicleBody = RRect.fromRectAndRadius(
    Rect.fromLTWH(size.width * .08, size.height * .43, size.width * .78,
        size.height * .34),
    const Radius.circular(4),
  );
  canvas.drawRRect(vehicleBody, body);
  canvas.drawRRect(vehicleBody, outline);

  final cabin = ui.Path()
    ..moveTo(size.width * .23, size.height * .44)
    ..lineTo(size.width * .34, size.height * .14)
    ..lineTo(size.width * .68, size.height * .14)
    ..lineTo(size.width * .79, size.height * .44)
    ..close();
  canvas.drawPath(cabin, body);
  canvas.drawPath(cabin, outline);

  final windshield = ui.Path()
    ..moveTo(size.width * .49, size.height * .2)
    ..lineTo(size.width * .65, size.height * .2)
    ..lineTo(size.width * .73, size.height * .42)
    ..lineTo(size.width * .49, size.height * .42)
    ..close();
  canvas.drawPath(windshield, glass);
  canvas.drawPath(windshield, outline);
  canvas.drawLine(Offset(size.width * .45, size.height * .17),
      Offset(size.width * .45, size.height * .7), outline);

  canvas.drawCircle(
      Offset(size.width * .23, size.height * .79), size.height * .14, dark);
  canvas.drawCircle(
      Offset(size.width * .23, size.height * .79), size.height * .06, glass);
  canvas.drawCircle(
      Offset(size.width * .76, size.height * .79), size.height * .14, dark);
  canvas.drawCircle(
      Offset(size.width * .76, size.height * .79), size.height * .06, glass);
  canvas.drawCircle(
      Offset(size.width * .9, size.height * .59), size.height * .055, glass);
}

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
    this.currentLocation,
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
  final LatLng? currentLocation;
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
  gmaps.BitmapDescriptor? _nearbyMotoIcon;
  gmaps.BitmapDescriptor? _activeMotoIcon;

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

  Future<gmaps.BitmapDescriptor> _createMotoIcon(Color color) async {
    const logicalWidth = 44.0;
    const logicalHeight = 30.0;
    const pixelRatio = 3.0;
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder)..scale(pixelRatio);
    _paintMotoTaxi(canvas, const Size(logicalWidth, logicalHeight), color);
    final image = await recorder.endRecording().toImage(
          (logicalWidth * pixelRatio).round(),
          (logicalHeight * pixelRatio).round(),
        );
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    return gmaps.BitmapDescriptor.bytes(
      data!.buffer.asUint8List(),
      imagePixelRatio: pixelRatio,
    );
  }

  Future<void> _prepareGoogleMarkerIcons() async {
    final nearby = await _createMotoIcon(const Color(0xff007f8b));
    final active = await _createMotoIcon(Colors.orange);
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
      padding: const EdgeInsets.all(48),
    ));
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
          width: 44,
          height: 30,
          child: const _MotoMarker(color: Color(0xff007f8b)),
        ),
      if (_displayedDriver != null)
        Marker(
          point: _displayedDriver!,
          width: 48,
          height: 34,
          child: Transform.rotate(
            angle: widget.driverBearing * math.pi / 180,
            child: const _MotoMarker(color: Colors.orange),
          ),
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
        ),
      if (_displayedDriver != null)
        gmaps.Marker(
          markerId: const gmaps.MarkerId('active-driver'),
          position: gmaps.LatLng(
              _displayedDriver!.latitude, _displayedDriver!.longitude),
          rotation: widget.driverBearing,
          flat: true,
          icon: _activeMotoIcon ??
              gmaps.BitmapDescriptor.defaultMarkerWithHue(
                  gmaps.BitmapDescriptor.hueOrange),
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
              bottom: 12,
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
              bottom: 64,
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
              bottom: 12,
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
                      : () =>
                          widget.onPointSelected!(_selectionCenter ?? center),
                  icon: const Icon(Icons.check, size: 18),
                  label: Text(widget.editing == MapPointSelection.origin
                      ? 'Confirmar origen'
                      : 'Confirmar destino'),
                ),
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
  Widget build(BuildContext context) => CustomPaint(
        size: const Size(44, 30),
        painter: _MotoTaxiPainter(color),
      );
}

class _MotoTaxiPainter extends CustomPainter {
  const _MotoTaxiPainter(this.color);
  final Color color;

  @override
  void paint(Canvas canvas, Size size) => _paintMotoTaxi(canvas, size, color);

  @override
  bool shouldRepaint(covariant _MotoTaxiPainter oldDelegate) =>
      oldDelegate.color != color;
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
