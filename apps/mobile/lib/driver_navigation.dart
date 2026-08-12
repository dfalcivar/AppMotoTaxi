import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:google_navigation_flutter/google_navigation_flutter.dart'
    as nav;
import 'package:shared_preferences/shared_preferences.dart';

const bool navigationSdkEnabled =
    bool.fromEnvironment('ENABLE_GOOGLE_NAVIGATION', defaultValue: true);

class DriverNavigationStop {
  const DriverNavigationStop({
    required this.latitude,
    required this.longitude,
    required this.label,
  });

  final double latitude;
  final double longitude;
  final String label;
}

class DriverNavigationScreen extends StatefulWidget {
  const DriverNavigationScreen({
    super.key,
    required this.stops,
    required this.phaseLabel,
    this.routeToken,
  });

  final List<DriverNavigationStop> stops;
  final String phaseLabel;
  final String? routeToken;

  @override
  State<DriverNavigationScreen> createState() => _DriverNavigationScreenState();
}

class _DriverNavigationScreenState extends State<DriverNavigationScreen>
    with WidgetsBindingObserver {
  nav.GoogleNavigationViewController? _controller;
  StreamSubscription<nav.NavInfoEvent>? _navInfoSubscription;
  StreamSubscription<nav.OnArrivalEvent>? _arrivalSubscription;
  StreamSubscription<void>? _rerouteSubscription;
  nav.NavInfo? _navInfo;
  bool _initializing = true;
  bool _navigationStarted = false;
  bool _voiceEnabled = true;
  bool _cameraFollowing = true;
  bool _arrived = false;
  String? _error;

  String? get _mapId {
    const android = String.fromEnvironment('GOOGLE_MAPS_ANDROID_MAP_ID');
    const ios = String.fromEnvironment('GOOGLE_MAPS_IOS_MAP_ID');
    final value = Platform.isIOS ? ios : android;
    return value.trim().isEmpty ? null : value.trim();
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) => _initialize());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _navigationStarted) {
      unawaited(_restoreFollowingState());
    }
  }

  @override
  void didChangeMetrics() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_updateMapPadding());
    });
  }

  Future<void> _initialize() async {
    if (!navigationSdkEnabled || widget.stops.isEmpty) {
      _setFailure('La navegación avanzada no está disponible.');
      return;
    }
    try {
      final preferences = await SharedPreferences.getInstance();
      _voiceEnabled = preferences.getBool('driver_navigation_voice') ?? true;
      if (!await nav.GoogleMapsNavigator.areTermsAccepted()) {
        final accepted =
            await nav.GoogleMapsNavigator.showTermsAndConditionsDialog(
          'Costa-Go',
          'DFAR System',
        );
        if (!accepted) {
          _setFailure('Debes aceptar los términos de navegación de Google.');
          return;
        }
      }
      await nav.GoogleMapsNavigator.initializeNavigationSession();
      _registerListeners();
      await _applyAudioGuidance();

      final waypoints = widget.stops
          .map((stop) => nav.NavigationWaypoint.withLatLngTarget(
                title: stop.label,
                target: nav.LatLng(
                    latitude: stop.latitude, longitude: stop.longitude),
              ))
          .toList();
      final token = widget.routeToken?.trim();
      final destinations = nav.Destinations(
        waypoints: waypoints,
        displayOptions:
            nav.NavigationDisplayOptions(showDestinationMarkers: true),
        routeTokenOptions: token != null && token.isNotEmpty
            ? nav.RouteTokenOptions(
                routeToken: token,
                travelMode: nav.NavigationTravelMode.driving,
              )
            : null,
        routingOptions: token == null || token.isEmpty
            ? nav.RoutingOptions(
                travelMode: nav.NavigationTravelMode.driving,
              )
            : null,
      );
      final status =
          await nav.GoogleMapsNavigator.setDestinations(destinations);
      if (status != nav.NavigationRouteStatus.statusOk) {
        _setFailure('No se pudo preparar la navegación ($status).');
        return;
      }
      await nav.GoogleMapsNavigator.startGuidance();
      debugPrint('NAVIGATION_STARTED phase=${widget.phaseLabel}');
      if (!mounted) return;
      setState(() {
        _navigationStarted = true;
        _initializing = false;
      });
      await _restoreFollowingState();
    } on nav.SessionInitializationException catch (error) {
      debugPrint('NAVIGATION_ERROR session=${error.code}');
      _setFailure(_sessionError(error));
    } catch (error) {
      debugPrint('NAVIGATION_ERROR type=${error.runtimeType}');
      _setFailure('No se pudo iniciar Navigation SDK. Usa el mapa normal.');
    }
  }

  String _sessionError(nav.SessionInitializationException error) {
    return switch (error.code) {
      nav.SessionInitializationError.locationPermissionMissing =>
        'Navigation SDK necesita permiso de ubicación precisa.',
      nav.SessionInitializationError.notAuthorized =>
        'La clave de Google no está autorizada para Navigation SDK.',
      nav.SessionInitializationError.termsNotAccepted =>
        'Debes aceptar los términos de navegación de Google.',
    };
  }

  void _registerListeners() {
    _navInfoSubscription?.cancel();
    _arrivalSubscription?.cancel();
    _rerouteSubscription?.cancel();
    _navInfoSubscription = nav.GoogleMapsNavigator.setNavInfoListener(
      (event) {
        if (mounted) setState(() => _navInfo = event.navInfo);
      },
      numNextStepsToPreview: 2,
    );
    _arrivalSubscription = nav.GoogleMapsNavigator.setOnArrivalListener((_) {
      debugPrint('PICKUP_OR_DESTINATION_ARRIVED phase=${widget.phaseLabel}');
      if (mounted) setState(() => _arrived = true);
    });
    _rerouteSubscription = nav.GoogleMapsNavigator.setOnReroutingListener(() {
      debugPrint('REROUTE phase=${widget.phaseLabel}');
    });
  }

  Future<void> _applyAudioGuidance() async {
    await nav.GoogleMapsNavigator.setAudioGuidance(
      nav.NavigationAudioGuidanceSettings(
        guidanceType: _voiceEnabled
            ? nav.NavigationAudioGuidanceType.alertsAndGuidance
            : nav.NavigationAudioGuidanceType.silent,
        isVibrationEnabled: _voiceEnabled,
        isBluetoothAudioEnabled: _voiceEnabled,
      ),
    );
  }

  Future<void> _toggleVoice() async {
    setState(() => _voiceEnabled = !_voiceEnabled);
    await _applyAudioGuidance();
    final preferences = await SharedPreferences.getInstance();
    await preferences.setBool('driver_navigation_voice', _voiceEnabled);
  }

  Future<void> _restoreFollowingState() async {
    final controller = _controller;
    if (controller == null || !_navigationStarted) return;
    try {
      await controller.followMyLocation(nav.CameraPerspective.tilted);
      if (mounted) setState(() => _cameraFollowing = true);
    } catch (_) {
      // La navegación continúa aunque la vista todavía no esté lista.
    }
  }

  Future<void> _onViewCreated(
      nav.GoogleNavigationViewController controller) async {
    _controller = controller;
    final pixelRatio = MediaQuery.devicePixelRatioOf(context);
    try {
      await controller.setNavigationHeaderEnabled(false);
      await controller.setNavigationFooterEnabled(false);
      await controller.settings.setTrafficEnabled(true);
      await _updateMapPadding(pixelRatio: pixelRatio);
      await _restoreFollowingState();
    } catch (_) {
      // La sesión puede estar terminando mientras se crea la vista.
    }
  }

  Future<void> _updateMapPadding({double? pixelRatio}) async {
    final controller = _controller;
    if (controller == null || !mounted) return;
    final media = MediaQuery.of(context);
    final ratio = pixelRatio ?? media.devicePixelRatio;
    final textScale = media.textScaler.scale(1).clamp(1.0, 1.6);
    final top = media.padding.top + 112 + (textScale - 1) * 32;
    final bottom = media.padding.bottom + 92 + (textScale - 1) * 24;
    await controller.setPadding(EdgeInsets.only(
      top: top * ratio,
      bottom: bottom * ratio,
    ));
  }

  void _setFailure(String message) {
    if (!mounted) return;
    setState(() {
      _error = message;
      _initializing = false;
    });
  }

  String _distance(int? meters) {
    if (meters == null) return '--';
    return meters < 1000
        ? '$meters m'
        : '${(meters / 1000).toStringAsFixed(1)} km';
  }

  String _duration(int? seconds) {
    if (seconds == null) return '--';
    final minutes = (seconds / 60).ceil();
    return minutes < 60
        ? '$minutes min'
        : '${minutes ~/ 60} h ${minutes % 60} min';
  }

  Future<void> _stopNavigation() async {
    await _navInfoSubscription?.cancel();
    await _arrivalSubscription?.cancel();
    await _rerouteSubscription?.cancel();
    _navInfoSubscription = null;
    _arrivalSubscription = null;
    _rerouteSubscription = null;
    try {
      if (await nav.GoogleMapsNavigator.isInitialized()) {
        await nav.GoogleMapsNavigator.stopGuidance();
        await nav.GoogleMapsNavigator.cleanup();
      }
    } catch (_) {}
    debugPrint('NAVIGATION_STOPPED phase=${widget.phaseLabel}');
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    unawaited(_stopNavigation());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Navegación')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              const Icon(Icons.navigation_outlined, size: 52),
              const SizedBox(height: 16),
              Text(_error!, textAlign: TextAlign.center),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: () => Navigator.pop(context, false),
                icon: const Icon(Icons.map_outlined),
                label: const Text('Usar mapa normal'),
              ),
            ]),
          ),
        ),
      );
    }

    final step = _navInfo?.currentStep;
    return PopScope(
      canPop: true,
      onPopInvokedWithResult: (_, __) => unawaited(_stopNavigation()),
      child: Scaffold(
        body: Stack(children: [
          Positioned.fill(
            child: _initializing
                ? const Center(child: CircularProgressIndicator())
                : nav.GoogleMapsNavigationView(
                    onViewCreated: _onViewCreated,
                    mapId: _mapId,
                    initialMapColorScheme: nav.MapColorScheme.followSystem,
                    initialForceNightMode: nav.NavigationForceNightMode.auto,
                    initialNavigationUIEnabledPreference:
                        nav.NavigationUIEnabledPreference.automatic,
                    initialMapToolbarEnabled: false,
                    initialZoomControlsEnabled: false,
                    onCameraMoveStarted: (_, gesture) {
                      if (gesture && mounted) {
                        setState(() => _cameraFollowing = false);
                      }
                    },
                    onCameraStartedFollowingLocation: (_) {
                      if (mounted) setState(() => _cameraFollowing = true);
                    },
                  ),
          ),
          SafeArea(
            minimum: const EdgeInsets.fromLTRB(12, 8, 12, 10),
            child: Column(children: [
              Material(
                elevation: 5,
                borderRadius: BorderRadius.circular(20),
                color: Theme.of(context).colorScheme.surface,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(8, 8, 12, 10),
                  child: Row(children: [
                    IconButton(
                      onPressed: () => Navigator.pop(context, true),
                      icon: const Icon(Icons.arrow_back),
                    ),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(widget.phaseLabel,
                              style: Theme.of(context)
                                  .textTheme
                                  .labelLarge
                                  ?.copyWith(
                                      color: Theme.of(context)
                                          .colorScheme
                                          .primary)),
                          Text(
                            _arrived
                                ? 'Has llegado. Confirma el siguiente estado.'
                                : step?.fullInstructions ??
                                    'Sigue la ruta indicada',
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context)
                                .textTheme
                                .titleMedium
                                ?.copyWith(fontWeight: FontWeight.w700),
                          ),
                          if (!_arrived)
                            Text(_distance(
                                _navInfo?.distanceToCurrentStepMeters)),
                        ],
                      ),
                    ),
                    IconButton(
                      tooltip: _voiceEnabled
                          ? 'Silenciar indicaciones'
                          : 'Activar indicaciones',
                      onPressed: _navigationStarted ? _toggleVoice : null,
                      icon: Icon(_voiceEnabled
                          ? Icons.volume_up_outlined
                          : Icons.volume_off_outlined),
                    ),
                  ]),
                ),
              ),
              const Spacer(),
              if (!_cameraFollowing)
                Align(
                  alignment: Alignment.centerRight,
                  child: FloatingActionButton.extended(
                    heroTag: 'navigation-recenter',
                    onPressed: _restoreFollowingState,
                    icon: const Icon(Icons.my_location),
                    label: const Text('Centrar'),
                  ),
                ),
              const SizedBox(height: 10),
              NavigationTripFooter(
                duration: _duration(_navInfo?.timeToFinalDestinationSeconds),
                distance: _distance(_navInfo?.distanceToFinalDestinationMeters),
                destination: widget.stops.last.label,
                onExit: () => Navigator.pop(context, true),
              ),
            ]),
          ),
        ]),
      ),
    );
  }
}

class NavigationTripFooter extends StatelessWidget {
  const NavigationTripFooter({
    super.key,
    required this.duration,
    required this.distance,
    required this.destination,
    required this.onExit,
  });

  final String duration;
  final String distance;
  final String destination;
  final VoidCallback onExit;

  @override
  Widget build(BuildContext context) {
    return Material(
      elevation: 5,
      borderRadius: BorderRadius.circular(20),
      color: Theme.of(context).colorScheme.surface,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 10, 8, 10),
        child: Row(children: [
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '$duration · $distance',
                  maxLines: 1,
                  softWrap: false,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context)
                      .textTheme
                      .titleLarge
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 2),
                Text(
                  'Destino: $destination',
                  maxLines: 1,
                  softWrap: false,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          FilledButton.tonalIcon(
            style: FilledButton.styleFrom(
              minimumSize: const Size(0, 44),
              padding: const EdgeInsets.symmetric(horizontal: 12),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            onPressed: onExit,
            icon: const Icon(Icons.close, size: 20),
            label: const Text('Salir'),
          ),
        ]),
      ),
    );
  }
}
