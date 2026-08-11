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

  Future<void> _initialize() async {
    if (!navigationSdkEnabled || widget.stops.isEmpty) {
      _setFailure('La navegaciÃ³n avanzada no estÃ¡ disponible.');
      return;
    }
    try {
      final preferences = await SharedPreferences.getInstance();
      _voiceEnabled = preferences.getBool('driver_navigation_voice') ?? true;
      if (!await nav.GoogleMapsNavigator.areTermsAccepted()) {
        final accepted =
            await nav.GoogleMapsNavigator.showTermsAndConditionsDialog(
          'AtacamesGo',
          'DFAR System',
        );
        if (!accepted) {
          _setFailure('Debes aceptar los tÃ©rminos de navegaciÃ³n de Google.');
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
        _setFailure('No se pudo preparar la navegaciÃ³n ($status).');
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
        'Navigation SDK necesita permiso de ubicaciÃ³n precisa.',
      nav.SessionInitializationError.notAuthorized =>
        'La clave de Google no estÃ¡ autorizada para Navigation SDK.',
      nav.SessionInitializationError.termsNotAccepted =>
        'Debes aceptar los tÃ©rminos de navegaciÃ³n de Google.',
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
      // La navegaciÃ³n continÃºa aunque la vista todavÃ­a no estÃ© lista.
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
      await controller.setPadding(EdgeInsets.only(
        top: 118 * pixelRatio,
        bottom: 112 * pixelRatio,
      ));
      await _restoreFollowingState();
    } catch (_) {
      // La sesiÃ³n puede estar terminando mientras se crea la vista.
    }
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
        appBar: AppBar(title: const Text('NavegaciÃ³n')),
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
            child: Padding(
              padding: const EdgeInsets.all(12),
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
                Material(
                  elevation: 5,
                  borderRadius: BorderRadius.circular(20),
                  color: Theme.of(context).colorScheme.surface,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 18, vertical: 14),
                    child: Row(children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '${_duration(_navInfo?.timeToFinalDestinationSeconds)} Â· ${_distance(_navInfo?.distanceToFinalDestinationMeters)}',
                              style: Theme.of(context)
                                  .textTheme
                                  .titleLarge
                                  ?.copyWith(fontWeight: FontWeight.w800),
                            ),
                            Text('Destino: ${widget.stops.last.label}',
                                maxLines: 1, overflow: TextOverflow.ellipsis),
                          ],
                        ),
                      ),
                      FilledButton.tonalIcon(
                        onPressed: () => Navigator.pop(context, true),
                        icon: const Icon(Icons.close),
                        label: const Text('Salir'),
                      ),
                    ]),
                  ),
                ),
              ]),
            ),
          ),
        ]),
      ),
    );
  }
}
