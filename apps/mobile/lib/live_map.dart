import 'dart:math' as math;
import 'dart:ui' show lerpDouble;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

enum MapPointSelection { origin, destination }

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
  final double height;

  @override
  State<LiveMap> createState() => _LiveMapState();
}

class _LiveMapState extends State<LiveMap> with SingleTickerProviderStateMixin {
  late final AnimationController _movement;
  LatLng? _displayedDriver;
  LatLng? _movementStart;
  LatLng? _movementEnd;

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
      return;
    }
    if (_displayedDriver == null) {
      _displayedDriver = next;
      return;
    }
    if (oldWidget.driverPosition != next) {
      _movementStart = _displayedDriver;
      _movementEnd = next;
      _movement.forward(from: 0);
    }
  }

  @override
  void dispose() {
    _movement.dispose();
    super.dispose();
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
          width: 38,
          height: 38,
          child: const _MotoMarker(color: Color(0xff007f8b)),
        ),
      if (_displayedDriver != null)
        Marker(
          point: _displayedDriver!,
          width: 48,
          height: 48,
          child: Transform.rotate(
            angle: widget.driverBearing * math.pi / 180,
            child: const _MotoMarker(color: Colors.orange),
          ),
        ),
    ];

    return ClipRRect(
      borderRadius: BorderRadius.circular(20),
      child: SizedBox(
        height: widget.height,
        child: Stack(children: [
          FlutterMap(
            options: MapOptions(
              initialCenter: center,
              initialZoom: 16,
              onTap: widget.onPointSelected == null
                  ? null
                  : (_, point) => widget.onPointSelected!(point),
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
          ),
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
                          ? 'Toca el mapa para marcar el origen'
                          : 'Toca el mapa para marcar el destino',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Colors.white),
                    ),
                  ),
                ),
              ),
            ),
        ]),
      ),
    );
  }
}

class _MotoMarker extends StatelessWidget {
  const _MotoMarker({required this.color});
  final Color color;

  @override
  Widget build(BuildContext context) => DecoratedBox(
        decoration: BoxDecoration(
          color: color,
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white, width: 2),
          boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 5)],
        ),
        child:
            const Icon(Icons.electric_rickshaw, color: Colors.white, size: 24),
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
        Icon(icon, color: color, size: 31),
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
