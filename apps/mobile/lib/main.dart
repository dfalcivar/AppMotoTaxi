import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';
import 'package:latlong2/latlong.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_maps_flutter_android/google_maps_flutter_android.dart';
import 'package:google_maps_flutter_platform_interface/google_maps_flutter_platform_interface.dart'
    as maps_platform;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:image_picker/image_picker.dart';
import 'package:local_auth/local_auth.dart';
import 'package:sentry_flutter/sentry_flutter.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:qr_flutter/qr_flutter.dart';

import 'affiliate_banners.dart';
import 'chat_sheet.dart';
import 'driver_navigation.dart';
import 'in_app_notification_banner.dart';
import 'live_map.dart';
import 'realtime_service.dart';
import 'service_areas.dart';

part 'passenger_experience.dart';

const base = String.fromEnvironment('API_BASE_URL',
    defaultValue: 'https://mototaxi-atacames-api.onrender.com');
const apiHttpProxy = String.fromEnvironment('API_HTTP_PROXY');
const sentryDsn = String.fromEnvironment('SENTRY_DSN');

String normalizePassengerTripUpdateType(String type) =>
    type == 'CANCELLED' ? 'TRIP_CANCELLED' : type;

String membershipPlanName(dynamic snapshot) {
  dynamic value = snapshot;
  if (value is String) {
    try {
      value = jsonDecode(value);
    } catch (_) {
      return 'Membresía';
    }
  }
  if (value is Map) {
    final name = value['name']?.toString().trim();
    if (name != null && name.isNotEmpty) return name;
  }
  return 'Membresía';
}

/// Keeps asynchronous GPS results from replacing an origin explicitly chosen
/// by the passenger.
class OriginSelectionGuard {
  int _revision = 0;
  bool _manualOrigin = false;

  bool get hasManualOrigin => _manualOrigin;

  int startGpsRequest() => ++_revision;

  bool canApplyAutomaticGps(int requestRevision, {required bool hasOrigin}) =>
      requestRevision == _revision && !_manualOrigin && !hasOrigin;

  bool canApplyExplicitGps(int requestRevision) => requestRevision == _revision;

  void markManualOrigin() {
    _manualOrigin = true;
    _revision++;
  }

  void commitExplicitGps() {
    _manualOrigin = false;
  }

  void resetToAutomatic() {
    _manualOrigin = false;
    _revision++;
  }
}

Map<String, dynamic> buildTripRequestPayload({
  required int passengers,
  required String originReference,
  required String destinationReference,
  required LatLng selectedOrigin,
  required LatLng selectedDestination,
  required String paymentMethod,
  String notes = '',
  List<Map<String, dynamic>>? destinations,
  DateTime? scheduledFor,
}) =>
    {
      'origin': {
        'longitude': selectedOrigin.longitude,
        'latitude': selectedOrigin.latitude,
      },
      if (destinations == null)
        'destination': {
          'longitude': selectedDestination.longitude,
          'latitude': selectedDestination.latitude,
        }
      else
        'destinations': destinations,
      'passengers': passengers,
      'paymentMethod': paymentMethod,
      'originReference': originReference,
      'destinationReference': destinationReference,
      if (notes.trim().isNotEmpty) 'notes': notes.trim(),
      if (scheduledFor != null)
        'scheduledFor': scheduledFor.toUtc().toIso8601String(),
    };

String? scheduledSelectionError({
  required DateTime selected,
  required DateTime now,
  required int minimumNoticeMinutes,
  required int maximumAdvanceMinutes,
}) {
  final currentMinute =
      DateTime(now.year, now.month, now.day, now.hour, now.minute);
  final earliest = currentMinute.add(Duration(minutes: minimumNoticeMinutes));
  final latest = currentMinute.add(Duration(minutes: maximumAdvanceMinutes));
  if (selected.isBefore(earliest)) return 'SCHEDULE_TOO_SOON';
  if (selected.isAfter(latest)) return 'SCHEDULE_TOO_FAR';
  return null;
}

class PassengerStopDraft {
  PassengerStopDraft({String text = '', this.point})
      : controller = TextEditingController(text: text);

  final TextEditingController controller;
  LatLng? point;

  void dispose() => controller.dispose();
}

class _ScheduledRouteRow extends StatelessWidget {
  const _ScheduledRouteRow({
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
  });

  final IconData icon;
  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            width: 30,
            height: 30,
            decoration: BoxDecoration(
              color: color.withValues(alpha: .12),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 17, color: color),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: Theme.of(context).colorScheme.outline,
                        fontWeight: FontWeight.w700)),
                const SizedBox(height: 2),
                Text(value,
                    style: Theme.of(context)
                        .textTheme
                        .bodyMedium
                        ?.copyWith(fontWeight: FontWeight.w700)),
              ],
            ),
          ),
        ]),
      );
}

class _ScheduledCounterpartCard extends StatelessWidget {
  const _ScheduledCounterpartCard({
    required this.token,
    required this.userId,
    required this.name,
    required this.hasPhoto,
    required this.rating,
    required this.roleLabel,
    this.vehicle,
    this.emptyLabel,
  });

  final String token;
  final String? userId;
  final String? name;
  final bool hasPhoto;
  final double rating;
  final String roleLabel;
  final String? vehicle;
  final String? emptyLabel;

  Widget _photo(BuildContext context, double size) {
    final fallback = Container(
      width: size,
      height: size,
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      alignment: Alignment.center,
      child: Icon(Icons.person_outline, size: size * .52),
    );
    return ClipOval(
      child: hasPhoto && userId != null
          ? Image.network(
              '$base/v1/users/$userId/profile-photo',
              headers: {'Authorization': 'Bearer $token'},
              width: size,
              height: size,
              fit: BoxFit.cover,
              errorBuilder: (_, __, ___) => fallback,
            )
          : fallback,
    );
  }

  Future<void> _showDetails(BuildContext context) => showDialog<void>(
        context: context,
        barrierDismissible: true,
        builder: (dialogContext) => Dialog(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              _photo(dialogContext, 210),
              const SizedBox(height: 16),
              Text(name ?? roleLabel,
                  textAlign: TextAlign.center,
                  style: Theme.of(dialogContext)
                      .textTheme
                      .titleLarge
                      ?.copyWith(fontWeight: FontWeight.w800)),
              if (vehicle?.trim().isNotEmpty == true)
                Text('Placa: ${vehicle!.trim()}'),
              const SizedBox(height: 6),
              Row(mainAxisSize: MainAxisSize.min, children: [
                const Icon(Icons.star, color: Colors.amber, size: 20),
                const SizedBox(width: 4),
                Text(rating.toStringAsFixed(1)),
              ]),
              const SizedBox(height: 14),
              FilledButton(
                  onPressed: () => Navigator.pop(dialogContext),
                  child: const Text('Cerrar')),
            ]),
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    if (userId == null || name == null) {
      return Row(children: [
        CircleAvatar(
          radius: 23,
          backgroundColor:
              Theme.of(context).colorScheme.surfaceContainerHighest,
          child: const Icon(Icons.person_search_outlined),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(emptyLabel ?? 'Aún sin asignar',
              style: const TextStyle(fontWeight: FontWeight.w700)),
        ),
      ]);
    }
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => _showDetails(context),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Row(children: [
            _photo(context, 52),
            const SizedBox(width: 11),
            Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(roleLabel,
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            color: Theme.of(context).colorScheme.outline,
                            fontWeight: FontWeight.w700)),
                    Text(name!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context)
                            .textTheme
                            .titleMedium
                            ?.copyWith(fontWeight: FontWeight.w800)),
                    if (vehicle?.trim().isNotEmpty == true)
                      Text('Placa: ${vehicle!.trim()}'),
                  ]),
            ),
            Column(children: [
              const Icon(Icons.star, color: Colors.amber, size: 19),
              Text(rating.toStringAsFixed(1),
                  style: const TextStyle(fontWeight: FontWeight.w800)),
            ]),
            const SizedBox(width: 4),
            const Icon(Icons.chevron_right),
          ]),
        ),
      ),
    );
  }
}

class AppHttpOverrides extends HttpOverrides {
  AppHttpOverrides(this.proxy);

  final Uri proxy;

  @override
  HttpClient createHttpClient(SecurityContext? context) {
    final client = super.createHttpClient(context);
    client.findProxy = (_) => 'PROXY ${proxy.host}:${proxy.port}';
    client.connectionTimeout = const Duration(seconds: 30);
    return client;
  }
}

http.Client buildHttpClient() {
  if (apiHttpProxy.isEmpty) return http.Client();
  final proxy = Uri.parse(apiHttpProxy);
  final ioClient = HttpClient();
  ioClient.findProxy = (_) => 'PROXY ${proxy.host}:${proxy.port}';
  ioClient.connectionTimeout = const Duration(seconds: 30);
  return IOClient(ioClient);
}

final apiHttpClient = buildHttpClient();
bool firebaseReady = false;
String? activeFcmAuthToken;
String? lastFcmRegistrationMessage;
StreamSubscription<String>? fcmTokenRefreshSubscription;
const nativeActions = MethodChannel('ec.atacames.mototaxi/native');
const secureStorage = FlutterSecureStorage();
final rootNavigatorKey = GlobalKey<NavigatorState>();
bool handlingRevokedSession = false;

@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
}

String? supportedImageMime(Uint8List bytes) {
  if (bytes.length >= 3 &&
      bytes[0] == 0xff &&
      bytes[1] == 0xd8 &&
      bytes[2] == 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 8 &&
      bytes[0] == 0x89 &&
      bytes[1] == 0x50 &&
      bytes[2] == 0x4e &&
      bytes[3] == 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 12 &&
      ascii.decode(bytes.sublist(0, 4), allowInvalid: true) == 'RIFF' &&
      ascii.decode(bytes.sublist(8, 12), allowInvalid: true) == 'WEBP') {
    return 'image/webp';
  }
  return null;
}

String supportTripIdentifier(dynamic trip) {
  if (trip is! Map) return '';
  final value = (trip['tripId'] ?? trip['id'])?.toString().trim() ?? '';
  return RegExp(
              r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
          .hasMatch(value)
      ? value
      : '';
}

Uri? firstWebUrl(String text) {
  final match = RegExp(r'https?://[^\s]+').firstMatch(text);
  if (match == null) return null;
  final raw = match.group(0)!.replaceFirst(RegExp(r'[.,;:!?]+$'), '');
  final uri = Uri.tryParse(raw);
  return uri != null && (uri.scheme == 'https' || uri.scheme == 'http')
      ? uri
      : null;
}

String answerWithoutWebUrl(String text) {
  final uri = firstWebUrl(text);
  if (uri == null) return text;
  return text
      .replaceFirst(uri.toString(), '')
      .replaceAllMapped(RegExp(r'\s+([.,;:])'), (match) => match.group(1)!)
      .replaceAll(RegExp(r'\s{2,}'), ' ')
      .trim();
}

class BiometricAccess {
  const BiometricAccess(this.credential, this.role, this.name, this.id,
      {this.approvalStatus, this.availableRoles = const ['PASSENGER']});
  final String credential, role, name, id;
  final String? approvalStatus;
  final List<String> availableRoles;
}

class BiometricSessionStore {
  static const _key = 'atacamesgo_biometric_session';
  static final _auth = LocalAuthentication();

  static Future<void> enable(Session session, String credential) =>
      secureStorage.write(
          key: _key,
          value: jsonEncode({
            'credential': credential,
            'role': session.role,
            'name': session.name,
            'id': session.id,
            'approvalStatus': session.approvalStatus,
            'availableRoles': session.availableRoles,
          }));

  static Future<void> clear() => secureStorage.delete(key: _key);

  static Future<BiometricAccess?> saved() async {
    try {
      final value = await secureStorage.read(key: _key);
      if (value == null) return null;
      final data = jsonDecode(value) as Map<String, dynamic>;
      final credential = data['credential']?.toString() ?? '';
      if (credential.isEmpty) {
        await clear();
        return null;
      }
      return BiometricAccess(credential, data['role'], data['name'], data['id'],
          approvalStatus: data['approvalStatus']?.toString(),
          availableRoles: List<String>.from(
              data['availableRoles'] ?? <String>[data['role']]));
    } catch (_) {
      try {
        await clear();
      } catch (_) {}
      return null;
    }
  }

  static Future<bool> authenticate() async {
    if (Platform.isAndroid) {
      try {
        final authenticated = await nativeActions
            .invokeMethod<bool>('authenticateFingerprintLegacy');
        if (authenticated != null) return authenticated;
      } on PlatformException catch (error) {
        if (error.code != 'USE_LOCAL_AUTH') rethrow;
      } on MissingPluginException {
        // Mantiene compatibilidad con compilaciones anteriores y otros entornos.
      }
    }
    return _auth.authenticate(
        localizedReason: 'Confirma tu identidad para ingresar a Costa-Go',
        biometricOnly: true,
        persistAcrossBackgrounding: true);
  }

  static String errorMessage(Object error) {
    if (error is PlatformException) {
      switch (error.code) {
        case 'NO_HARDWARE':
          return 'Este teléfono no dispone de lector de huellas.';
        case 'NOT_ENROLLED':
          return 'Primero registra una huella en los ajustes del teléfono.';
        case 'AUTH_ERROR':
          return error.message ?? 'No se pudo validar la huella.';
      }
    }
    return 'No se pudo habilitar el acceso biométrico. Inténtalo nuevamente.';
  }
}

class AppSessionStore {
  static const _key = 'atacamesgo_app_session';

  static Future<void> save(Session session) => secureStorage.write(
      key: _key,
      value: jsonEncode({
        'token': session.token,
        'role': session.role,
        'name': session.name,
        'id': session.id,
        'mustChangePassword': session.mustChangePassword,
        'approvalStatus': session.approvalStatus,
        'availableRoles': session.availableRoles,
      }));

  static Future<Session?> saved() async {
    try {
      final value = await secureStorage.read(key: _key);
      if (value == null) return null;
      final data = jsonDecode(value) as Map<String, dynamic>;
      return Session(
        data['token'],
        data['role'],
        data['name'],
        data['id'],
        mustChangePassword: data['mustChangePassword'] == true,
        approvalStatus: data['approvalStatus']?.toString(),
        availableRoles:
            List<String>.from(data['availableRoles'] ?? <String>[data['role']]),
      );
    } catch (_) {
      try {
        await clear();
      } catch (_) {}
      return null;
    }
  }

  static Future<void> clear() => secureStorage.delete(key: _key);
}

Future<void> refreshBiometricSessionIfEnabled(Session session) async {
  final biometric = await BiometricSessionStore.saved();
  if (biometric?.id == session.id) {
    await BiometricSessionStore.enable(session, biometric!.credential);
  }
}

Future<void> clearLocalSession({bool preserveBiometric = false}) async {
  activeFcmAuthToken = null;
  try {
    await AppSessionStore.clear();
  } catch (_) {}
  if (!preserveBiometric) {
    try {
      await BiometricSessionStore.clear();
    } catch (_) {}
  }
}

Future<void> handleRevokedSession() async {
  if (handlingRevokedSession) return;
  handlingRevokedSession = true;
  await clearLocalSession();
  final navigator = rootNavigatorKey.currentState;
  if (navigator != null) {
    navigator.pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const Welcome()), (_) => false);
  }
  handlingRevokedSession = false;
}

Future<void> dialPhone(BuildContext context, dynamic phoneValue) async {
  final phone = phoneValue?.toString().trim() ?? '';
  if (phone.isEmpty) {
    ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Este usuario no registró un teléfono.')));
    return;
  }
  try {
    await nativeActions.invokeMethod<void>('dial', {'phone': phone});
  } catch (_) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('No se pudo abrir la aplicación de llamadas.')));
    }
  }
}

Future<void> shareText(BuildContext context, String text) async {
  try {
    await nativeActions.invokeMethod<void>('share', {'text': text});
  } catch (_) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('No se pudo abrir el menú para compartir.')));
    }
  }
}

Future<void> showTripSafety({
  required BuildContext context,
  required dynamic trip,
  required String counterpart,
  LatLng? location,
}) async {
  final tripId = trip?['tripId']?.toString() ?? '';
  final origin = trip?['originReference']?.toString() ?? 'Origen';
  final destination = trip?['destinationReference']?.toString() ?? 'Destino';
  final mapLink = location == null
      ? ''
      : '\nUbicación actual: https://maps.google.com/?q=${location.latitude},${location.longitude}';
  await showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (sheetContext) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 18),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const ListTile(
            leading: Icon(Icons.shield_outlined),
            title: Text('Seguridad del viaje'),
            subtitle:
                Text('Comparte los datos del recorrido o solicita ayuda.'),
          ),
          ListTile(
            leading: const Icon(Icons.share_outlined),
            title: const Text('Compartir viaje'),
            subtitle: Text('$origin → $destination'),
            onTap: () {
              Navigator.pop(sheetContext);
              shareText(context,
                  'Estoy realizando un viaje en Costa-Go con $counterpart.\nRuta: $origin → $destination\nViaje: $tripId$mapLink');
            },
          ),
          ListTile(
            leading: const Icon(Icons.emergency_outlined, color: Colors.red),
            title: const Text('Llamar al ECU 911'),
            subtitle: const Text('Solo para una emergencia real'),
            onTap: () {
              Navigator.pop(sheetContext);
              dialPhone(context, '911');
            },
          ),
        ]),
      ),
    ),
  );
}

Future<void> warmApi() async {
  try {
    await apiHttpClient
        .get(Uri.parse('$base/health'))
        .timeout(const Duration(seconds: 50));
  } catch (_) {
    // El inicio no se bloquea: la petición solo despierta Render en segundo plano.
  }
}

const privacyPolicyUrl = 'https://costa-go.com/privacy.html';
const accountDeletionUrl = 'https://costa-go.com/account-deletion.html';
const locationDisclosureVersion = 1;

Future<void> openExternalPage(BuildContext context, String value) async {
  final uri = Uri.parse(value);
  if (!await launchUrl(uri, mode: LaunchMode.externalApplication) &&
      context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No se pudo abrir el enlace.')));
  }
}

Future<bool> ensureLocationDisclosure(BuildContext context) async {
  final preferences = await SharedPreferences.getInstance();
  if (preferences.getInt('location_disclosure_version') ==
      locationDisclosureVersion) {
    return true;
  }
  if (!context.mounted) return false;
  final accepted = await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) => AlertDialog(
          icon: const Icon(Icons.location_on_outlined),
          title: const Text('Cómo usamos tu ubicación'),
          content: const SingleChildScrollView(
            child: Text(
                'Costa-Go recopila datos de ubicación para seleccionar el punto de recogida, encontrar viajes o conductores cercanos, mantener el seguimiento y guiar al conductor durante un viaje, incluso cuando la aplicación está cerrada o no está en uso.\n\nDurante un viaje, la ubicación necesaria se comparte con la otra persona asignada y con los servicios de Costa-Go. No se utiliza para publicidad.'),
          ),
          actions: [
            TextButton(
                onPressed: () =>
                    openExternalPage(dialogContext, privacyPolicyUrl),
                child: const Text('Política de privacidad')),
            TextButton(
                onPressed: () => Navigator.pop(dialogContext, false),
                child: const Text('Ahora no')),
            FilledButton(
                onPressed: () => Navigator.pop(dialogContext, true),
                child: const Text('Continuar')),
          ],
        ),
      ) ??
      false;
  if (accepted) {
    await preferences.setInt(
        'location_disclosure_version', locationDisclosureVersion);
  }
  return accepted;
}

Future<void> ensureLocationPermission(BuildContext context) async {
  if (!await Geolocator.isLocationServiceEnabled()) {
    throw const ApiException(
        'Activa la ubicación GPS del teléfono para continuar.');
  }
  if (!context.mounted || !await ensureLocationDisclosure(context)) {
    throw const ApiException(
        'Necesitamos tu autorización para usar la ubicación.');
  }
  var permission = await Geolocator.checkPermission();
  if (permission == LocationPermission.denied) {
    permission = await Geolocator.requestPermission();
  }
  if (permission == LocationPermission.denied ||
      permission == LocationPermission.deniedForever) {
    throw const ApiException(
        'Permite el acceso a la ubicación en los ajustes del teléfono.');
  }
}

bool isUsableProvisionalLocation({
  required DateTime timestamp,
  required double accuracyMeters,
  DateTime? now,
  Duration maximumAge = const Duration(minutes: 10),
  double maximumAccuracyMeters = 100,
}) {
  final age = (now ?? DateTime.now()).difference(timestamp);
  return !age.isNegative &&
      age <= maximumAge &&
      accuracyMeters >= 0 &&
      accuracyMeters <= maximumAccuracyMeters;
}

Future<Position> currentGpsPosition(BuildContext context) async {
  await ensureLocationPermission(context);
  try {
    return await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 15)));
  } on TimeoutException {
    throw const ApiException(
        'El GPS está tardando. Inténtalo nuevamente o elige el punto en el mapa.');
  }
}

String friendlyLocationFailure(Object error) {
  if (error is ApiException) return error.message;
  if (error is LocationServiceDisabledException) {
    return 'El GPS está desactivado. Actívalo o selecciona el origen en el mapa.';
  }
  if (error is PermissionDeniedException) {
    return 'No tenemos permiso de ubicación. Puedes habilitarlo en ajustes o elegir el origen en el mapa.';
  }
  if (error is TimeoutException) {
    return 'El GPS está tardando. Puedes elegir el origen en el mapa o volver a intentarlo.';
  }
  return 'No pudimos confirmar tu ubicación. Reintenta o selecciona el origen en el mapa.';
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
    final mapsImplementation = maps_platform.GoogleMapsFlutterPlatform.instance;
    if (mapsImplementation is GoogleMapsFlutterAndroid) {
      try {
        await mapsImplementation
            .initializeWithRenderer(AndroidMapRenderer.latest);
      } catch (error) {
        debugPrint('No se pudo solicitar el renderizador moderno: $error');
      }
    }
  }
  if (apiHttpProxy.isNotEmpty) {
    HttpOverrides.global = AppHttpOverrides(Uri.parse(apiHttpProxy));
  }
  unawaited(warmApi());
  try {
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
    await Firebase.initializeApp();
    await FirebaseMessaging.instance.setAutoInitEnabled(true);
    await FirebaseMessaging.instance
        .setForegroundNotificationPresentationOptions(
      alert: false,
      badge: true,
      sound: true,
    );
    final permission = await FirebaseMessaging.instance.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );
    firebaseReady = true;
    fcmTokenRefreshSubscription =
        FirebaseMessaging.instance.onTokenRefresh.listen((fcmToken) {
      final authToken = activeFcmAuthToken;
      if (authToken != null) {
        unawaited(Api().registerFcm(authToken, fcmToken: fcmToken));
      }
    });
    if (permission.authorizationStatus == AuthorizationStatus.denied) {
      debugPrint('El usuario desactivó las notificaciones de Costa-Go.');
    }
  } catch (error, stack) {
    debugPrint('No se pudo inicializar Firebase Messaging: $error');
    if (sentryDsn.isNotEmpty) {
      unawaited(Sentry.captureException(error, stackTrace: stack));
    }
    // La mensajería push es opcional en instalaciones piloto sin credenciales.
  }
  await appTheme.load();
  if (sentryDsn.isNotEmpty) {
    await SentryFlutter.init(
      (options) {
        options.dsn = sentryDsn;
        options.tracesSampleRate = .2;
        options.environment =
            const String.fromEnvironment('APP_ENV', defaultValue: 'pilot');
      },
      appRunner: () => runApp(SentryWidget(child: const MototaxiApp())),
    );
  } else {
    runApp(const MototaxiApp());
  }
}

final appTheme = AppThemeController();

class AppThemeController extends ValueNotifier<ThemeMode> {
  AppThemeController() : super(ThemeMode.system);

  Future<void> load() async {
    final saved =
        (await SharedPreferences.getInstance()).getString('themeMode');
    value = switch (saved) {
      'light' => ThemeMode.light,
      'dark' => ThemeMode.dark,
      _ => ThemeMode.system,
    };
  }

  Future<void> change(ThemeMode mode) async {
    value = mode;
    await (await SharedPreferences.getInstance())
        .setString('themeMode', mode.name);
  }
}

String estadoViaje(dynamic estado) =>
    const {
      'SEARCHING': 'Buscando conductor',
      'ASSIGNED': 'Asignado',
      'DRIVER_EN_ROUTE': 'Conductor en camino',
      'DRIVER_ARRIVED': 'Conductor llegó',
      'IN_PROGRESS': 'Viaje en curso',
      'COMPLETED': 'Finalizado',
      'CANCELLED': 'Cancelado',
      'NO_DRIVER': 'Sin conductor',
      'INCIDENT': 'Incidente'
    }[estado] ??
    'Sin estado';

final _leadingPlusCode = RegExp(
  r'^\s*[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}(?:\s*[,·-]\s*|\s+)',
  caseSensitive: false,
);

String cleanAddressLabel(dynamic value, {String fallback = ''}) {
  final cleaned = (value?.toString() ?? '')
      .replaceFirst(_leadingPlusCode, '')
      .replaceAll(RegExp(r'\s{2,}'), ' ')
      .trim();
  return cleaned.isEmpty ? fallback : cleaned;
}

class TripStatusPanel extends StatelessWidget {
  const TripStatusPanel(
      {super.key, required this.status, required this.driverName});

  final String status;
  final String? driverName;

  @override
  Widget build(BuildContext context) {
    const stages = [
      ('DRIVER_EN_ROUTE', 'Conductor en camino'),
      ('DRIVER_ARRIVED', 'Conductor llegó'),
      ('IN_PROGRESS', 'Viaje en curso'),
    ];
    final current = switch (status) {
      'DRIVER_ARRIVED' => 1,
      'IN_PROGRESS' || 'COMPLETED' => 2,
      _ => 0,
    };
    final detail = switch (status) {
      'DRIVER_ARRIVED' => 'Tu conductor está en el punto de encuentro.',
      'IN_PROGRESS' => 'Ya estás avanzando hacia tu destino.',
      _ => '${driverName ?? 'Tu conductor'} se dirige hacia ti.',
    };
    final scheme = Theme.of(context).colorScheme;
    return _PassengerSurface(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        ...List.generate(stages.length, (index) {
          final reached = index <= current;
          final selected = index == current;
          return IntrinsicHeight(
            child:
                Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              SizedBox(
                width: 40,
                child: Column(children: [
                  Container(
                    width: 30,
                    height: 30,
                    decoration: BoxDecoration(
                      color: reached ? scheme.primary : scheme.surface,
                      shape: BoxShape.circle,
                      border: Border.all(
                          color:
                              reached ? scheme.primary : scheme.outlineVariant,
                          width: 2),
                    ),
                    child: reached
                        ? const Icon(Icons.check, color: Colors.white, size: 18)
                        : null,
                  ),
                  if (index < stages.length - 1)
                    Expanded(
                      child: Container(
                        width: 2,
                        color: index < current
                            ? scheme.primary
                            : scheme.outlineVariant,
                      ),
                    ),
                ]),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 18),
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(stages[index].$2,
                            style: Theme.of(context)
                                .textTheme
                                .titleMedium
                                ?.copyWith(
                                    color: selected
                                        ? scheme.primary
                                        : reached
                                            ? scheme.onSurface
                                            : scheme.onSurfaceVariant,
                                    fontWeight: selected
                                        ? FontWeight.w900
                                        : FontWeight.w600)),
                        if (selected) ...[
                          const SizedBox(height: 3),
                          Text(detail,
                              style: Theme.of(context)
                                  .textTheme
                                  .bodyMedium
                                  ?.copyWith(color: scheme.onSurfaceVariant)),
                        ],
                      ]),
                ),
              ),
            ]),
          );
        }),
      ]),
    );
  }
}

class Session {
  const Session(this.token, this.role, this.name, this.id,
      {this.mustChangePassword = false,
      this.approvalStatus,
      this.availableRoles = const ['PASSENGER']});
  final String token, role, name, id;
  final bool mustChangePassword;
  final String? approvalStatus;
  final List<String> availableRoles;
}

class ApiException implements Exception {
  const ApiException(this.message, {this.code, this.statusCode});
  final String message;
  final String? code;
  final int? statusCode;
  @override
  String toString() => message;
}

String mensajeApi(dynamic code) =>
    const {
      'INVALID_CREDENTIALS': 'Correo o contraseña incorrectos.',
      'INVALID_BIOMETRIC_CREDENTIAL':
          'El acceso biométrico fue revocado. Ingresa con tu contraseña y actívalo nuevamente.',
      'EMAIL_NOT_FOUND': 'No existe una cuenta registrada con ese correo.',
      'ROLE_NOT_AVAILABLE':
          'Este modo todavía no está habilitado en tu cuenta.',
      'ROLE_SWITCH_BLOCKED_ACTIVE_TRIP':
          'Finaliza o cancela el viaje activo antes de cambiar de modo.',
      'DRIVER_PROFILE_ALREADY_EXISTS':
          'Tu cuenta ya tiene un perfil de conductor.',
      'INVALID_DRIVER_ENROLLMENT':
          'Completa la fotografía y los datos de la mototaxi.',
      'DRIVER_PENDING_APPROVAL':
          'Tu perfil de conductor está pendiente de aprobación.',
      'DRIVER_NOT_APPROVED':
          'Completa la revisión de tu perfil antes de recibir viajes.',
      'DRIVER_REJECTED':
          'Tu solicitud fue rechazada. Contacta a soporte para conocer el motivo.',
      'DRIVER_SUSPENDED':
          'Tu cuenta de conductor está suspendida. Contacta a soporte.',
      'ACCOUNT_NOT_ACTIVE': 'Tu cuenta no está activa. Contacta a soporte.',
      'INVALID_LOGIN': 'Completa el correo y la contraseña.',
      'ACCOUNT_ALREADY_EXISTS': 'Ya existe una cuenta con estos datos.',
      'EMAIL_ALREADY_EXISTS': 'Este correo ya está registrado.',
      'PHONE_ALREADY_EXISTS': 'Este número de teléfono ya está registrado.',
      'VEHICLE_ALREADY_EXISTS':
          'Esta placa o identificador ya está registrado.',
      'INVALID_PHONE':
          'Ingresa un teléfono válido, por ejemplo 0991234567 o +593991234567.',
      'INVALID_REGISTRATION':
          'Revisa los campos obligatorios e intenta nuevamente.',
      'VEHICLE_REQUIRED': 'Ingresa la placa o el identificador de la mototaxi.',
      'INVALID_COOPERATIVE':
          'La cooperativa seleccionada ya no está disponible. Actualiza la lista.',
      'FORBIDDEN': 'No tienes permiso para realizar esta acción.',
      'UNAUTHORIZED': 'Tu sesión no es válida. Ingresa nuevamente.',
      'SESSION_REPLACED':
          'Tu cuenta inició sesión en otro dispositivo. Ingresa nuevamente.',
      'DRIVER_BUSY':
          'Ya tienes un viaje activo. Termínalo antes de aceptar otro.',
      'OFFER_UNAVAILABLE': 'Esta solicitud ya no está disponible.',
      'TRIP_ALREADY_ASSIGNED': 'Otro conductor ya aceptó este viaje.',
      'TRIP_NOT_CANCELLABLE':
          'La solicitud ya fue asignada y no puede cancelarse desde aquí.',
      'TRIP_NOT_ASSIGNED_TO_DRIVER':
          'Este viaje ya no está asignado a tu cuenta.',
      'TRIP_NOT_CANCELLABLE_BY_DRIVER':
          'La carrera ya avanzó y no puede cancelarse desde esta pantalla.',
      'INVALID_DRIVER_CANCELLATION':
          'Selecciona un motivo válido para cancelar la carrera.',
      'INVALID_TRIP_STATE':
          'Esta acción ya no está disponible para el estado actual del viaje.',
      'SCHEDULE_TOO_SOON': 'El viaje debe reservarse con mayor anticipación.',
      'SCHEDULE_TOO_FAR':
          'El viaje solo puede programarse dentro de las próximas 24 horas.',
      'PENDING_STOPS':
          'Completa las paradas anteriores antes de finalizar el viaje.',
      'PASSWORD_CHANGE_REQUIRED':
          'Debes cambiar la contraseña temporal para continuar.',
      'PASSWORD_REUSED':
          'La nueva contraseña debe ser diferente a la temporal.',
      'INVALID_PASSWORD':
          'Usa al menos 10 caracteres con mayúscula, minúscula, número y símbolo.',
      'WEAK_PASSWORD':
          'Usa al menos 10 caracteres con mayúscula, minúscula, número y símbolo.',
      'INVALID_CURRENT_PASSWORD': 'La contraseña actual no es correcta.',
      'INVALID_EMAIL': 'Ingresa un correo electrónico válido.',
      'EMAIL_VERIFICATION_REQUIRED':
          'Verifica tu correo electrónico para continuar.',
      'INVALID_EMAIL_VERIFICATION':
          'Revisa el correo y el código de verificación.',
      'INVALID_OR_EXPIRED_EMAIL_CODE':
          'El código es incorrecto o ya caducó. Solicita uno nuevo.',
      'INVALID_PASSWORD_RESET':
          'Revisa el correo, el código y la nueva contraseña.',
      'INVALID_OR_EXPIRED_RESET_CODE':
          'El código es incorrecto o ya caducó. Solicita uno nuevo.',
      'ACCOUNT_DELETION_BLOCKED_ACTIVE_TRIP':
          'Finaliza o cancela el viaje pendiente antes de eliminar tu cuenta.',
      'ACCOUNT_DELETION_FAILED':
          'No se pudo completar la eliminación en este momento. Inténtalo nuevamente o contacta a soporte.',
      'INVALID_DELETION_TOKEN':
          'El enlace de eliminación es inválido o ya caducó.',
      'INVALID_DRIVER_DOCUMENT':
          'La imagen no es válida o supera el tamaño permitido.',
      'INVALID_PROFILE_PHOTO':
          'La fotografía no es válida o supera el tamaño permitido.',
      'INVALID_FAVORITE_PLACE':
          'Revisa el nombre y la dirección del lugar favorito.',
      'FIREBASE_PROJECT_MISMATCH':
          'La APK y la API de Render pertenecen a proyectos Firebase diferentes.',
      'FIREBASE_SERVER_NOT_CONFIGURED':
          'La credencial Firebase de la API no está configurada o no es válida.',
      'INVALID_DEVICE_TOKEN':
          'Firebase no entregó un token válido para este teléfono.',
      'ORIGIN_OUTSIDE_SERVICE_AREA':
          'El origen está fuera de la zona de cobertura de Costa-Go.',
      'DESTINATION_OUTSIDE_SERVICE_AREA':
          'Uno de los destinos está fuera de la zona de cobertura.',
      'OUTSIDE_SERVICE_AREA':
          'Costa-Go todavía no está disponible en esta zona.',
      'SERVICE_AREA_NOT_ALLOWED':
          'Tu cuenta no está autorizada para usar esta zona de pruebas.',
      'SERVICE_AREA_DISABLED':
          'Esta zona de cobertura está temporalmente deshabilitada.',
      'DIFFERENT_SERVICE_AREAS':
          'El origen y el destino deben estar dentro de la misma zona de cobertura.',
      'GEOCODER_UNAVAILABLE':
          'No fue posible consultar las direcciones en este momento. Revisa tu conexión e inténtalo nuevamente.',
      'INVALID_LOCATION_QUERY':
          'Escribe al menos tres letras y vuelve a buscar la dirección.',
      'PAYMENT_ORDER_NOT_CANCELLABLE':
          'Esta orden ya no puede anularse porque cambió de estado o tiene un comprobante en revisión.',
      'PAYMENT_ORDER_NOT_FOUND':
          'La orden de pago no existe o ya no está disponible.',
      'PAYMENT_ORDER_NOT_PAYABLE':
          'Esta orden ya no está disponible para recibir pagos.',
    }[code] ??
    'No se pudo completar la operación.';

String? strongPasswordError(String? value) {
  final password = value ?? '';
  if (password.length < 10 || password.length > 100) {
    return 'Usa entre 10 y 100 caracteres.';
  }
  if (!RegExp(r'[a-z]').hasMatch(password) ||
      !RegExp(r'[A-Z]').hasMatch(password)) {
    return 'Incluye una letra mayúscula y una minúscula.';
  }
  if (!RegExp(r'\d').hasMatch(password)) {
    return 'Incluye al menos un número.';
  }
  if (!RegExp(r'[^A-Za-z0-9\s]').hasMatch(password)) {
    return 'Incluye al menos un símbolo, por ejemplo ! o @.';
  }
  if (RegExp(r'\s').hasMatch(password)) {
    return 'La contraseña no puede contener espacios.';
  }
  return null;
}

int passwordStrength(String value) {
  var score = 0;
  if (value.length >= 10) score++;
  if (value.length >= 14) score++;
  if (RegExp(r'[a-z]').hasMatch(value) && RegExp(r'[A-Z]').hasMatch(value)) {
    score++;
  }
  if (RegExp(r'\d').hasMatch(value)) score++;
  if (RegExp(r'[^A-Za-z0-9\s]').hasMatch(value)) score++;
  return score.clamp(0, 5);
}

class PasswordStrengthIndicator extends StatelessWidget {
  const PasswordStrengthIndicator({super.key, required this.password});
  final String password;

  @override
  Widget build(BuildContext context) {
    if (password.isEmpty) return const SizedBox.shrink();
    final score = passwordStrength(password);
    final valid = strongPasswordError(password) == null;
    final label = valid
        ? (score >= 5 ? 'Contraseña fuerte' : 'Contraseña segura')
        : 'Contraseña débil';
    final color =
        valid ? (score >= 5 ? Colors.green : Colors.blue) : Colors.orange;
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        LinearProgressIndicator(
          value: score / 5,
          minHeight: 5,
          borderRadius: BorderRadius.circular(8),
          color: color,
          backgroundColor: color.withValues(alpha: .15),
        ),
        const SizedBox(height: 5),
        Text('$label · 10+ caracteres, mayúscula, minúscula, número y símbolo',
            style:
                Theme.of(context).textTheme.bodySmall?.copyWith(color: color)),
      ]),
    );
  }
}

const coverageErrorCodes = <String>{
  'ORIGIN_OUTSIDE_SERVICE_AREA',
  'DESTINATION_OUTSIDE_SERVICE_AREA',
  'OUTSIDE_SERVICE_AREA',
  'SERVICE_AREA_NOT_ALLOWED',
  'SERVICE_AREA_DISABLED',
  'DIFFERENT_SERVICE_AREAS',
};

Future<void> showCoverageErrorDialog(
    BuildContext context, String code, String message) {
  final notAuthorized = code == 'SERVICE_AREA_NOT_ALLOWED';
  final title = switch (code) {
    'SERVICE_AREA_NOT_ALLOWED' => 'Cuenta no autorizada en esta zona',
    'ORIGIN_OUTSIDE_SERVICE_AREA' => 'Origen fuera de cobertura',
    'DESTINATION_OUTSIDE_SERVICE_AREA' => 'Destino fuera de cobertura',
    'DIFFERENT_SERVICE_AREAS' => 'Viaje fuera de la zona permitida',
    'SERVICE_AREA_DISABLED' => 'Zona temporalmente no disponible',
    _ => 'Ubicación fuera de cobertura',
  };
  return showDialog<void>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 28, vertical: 24),
      actionsAlignment: MainAxisAlignment.center,
      icon: Icon(notAuthorized
          ? Icons.admin_panel_settings_outlined
          : Icons.location_off_outlined),
      title: Text(title, textAlign: TextAlign.center),
      content: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 380),
        child: Text(message, textAlign: TextAlign.center),
      ),
      actions: [
        FilledButton(
          onPressed: () => Navigator.pop(dialogContext),
          child: const Padding(
            padding: EdgeInsets.symmetric(horizontal: 18),
            child: Text('Entendido'),
          ),
        ),
      ],
    ),
  );
}

class Api {
  Future<dynamic> call(String method, String path,
      {String? token, Object? body}) async {
    final safeToRetry = method == 'GET' || method == 'HEAD';
    final attempts = safeToRetry ? 3 : 1;
    Object? lastError;
    for (var attempt = 0; attempt < attempts; attempt++) {
      try {
        final request = http.Request(method, Uri.parse('$base$path'));
        request.headers.addAll({
          'content-type': 'application/json',
          if (token != null) 'authorization': 'Bearer $token'
        });
        request.body = jsonEncode(body ?? {});
        final streamed = await apiHttpClient
            .send(request)
            .timeout(const Duration(seconds: 35));
        final response = await http.Response.fromStream(streamed);
        final data = response.body == 'null' || response.body.isEmpty
            ? null
            : jsonDecode(response.body);
        if (response.statusCode >= 500 && attempt + 1 < attempts) {
          await Future<void>.delayed(
              Duration(milliseconds: 650 * (attempt + 1)));
          continue;
        }
        if (response.statusCode >= 400) {
          final code = data?['error']?.toString();
          if (token != null &&
              response.statusCode == 401 &&
              const {'UNAUTHORIZED', 'SESSION_REPLACED'}.contains(code)) {
            unawaited(handleRevokedSession());
          }
          throw ApiException(mensajeApi(code),
              code: code, statusCode: response.statusCode);
        }
        return data;
      } on ApiException {
        rethrow;
      } on TimeoutException catch (error, stack) {
        lastError = error;
        if (attempt + 1 == attempts && sentryDsn.isNotEmpty) {
          unawaited(Sentry.captureException(error, stackTrace: stack));
        }
      } on SocketException catch (error, stack) {
        lastError = error;
        if (attempt + 1 == attempts && sentryDsn.isNotEmpty) {
          unawaited(Sentry.captureException(error, stackTrace: stack));
        }
      } on http.ClientException catch (error, stack) {
        lastError = error;
        if (attempt + 1 == attempts && sentryDsn.isNotEmpty) {
          unawaited(Sentry.captureException(error, stackTrace: stack));
        }
      }
      if (attempt + 1 < attempts) {
        await Future<void>.delayed(Duration(milliseconds: 650 * (attempt + 1)));
      }
    }
    if (lastError is TimeoutException) {
      throw const ApiException(
          'La conexión está lenta. Reintentamos sin éxito; inténtalo nuevamente.');
    }
    throw const ApiException(
        'No se pudo conectar. Revisa Internet e intenta nuevamente.');
  }

  Future<Session> login(String e, String p, {String? role}) async {
    final d = await call('POST', '/v1/auth/session',
        body: {'email': e, 'password': p, if (role != null) 'role': role});
    final s = Session(
        d['token'], d['user']['role'], d['user']['name'], d['user']['id'],
        mustChangePassword: d['user']['mustChangePassword'] == true,
        approvalStatus: d['user']['driverApprovalStatus'],
        availableRoles: List<String>.from(
            d['user']['availableRoles'] ?? [d['user']['role']]));
    await BiometricSessionStore.clear();
    await AppSessionStore.save(s);
    await registerFcm(s.token);
    return s;
  }

  Session _sessionFromResponse(dynamic d) =>
      Session(d['token'], d['user']['role'], d['user']['name'], d['user']['id'],
          mustChangePassword: d['user']['mustChangePassword'] == true,
          approvalStatus: d['user']['driverApprovalStatus'],
          availableRoles: List<String>.from(
              d['user']['availableRoles'] ?? [d['user']['role']]));

  Future<String> enrollBiometric(String token) async {
    final d = await call('POST', '/v1/auth/biometric/enroll', token: token);
    final credential = d['credential']?.toString() ?? '';
    if (credential.isEmpty) {
      throw const ApiException('No se pudo habilitar el acceso biométrico.');
    }
    return credential;
  }

  Future<void> disableBiometric(String token) async {
    await call('DELETE', '/v1/auth/biometric', token: token);
  }

  Future<Session> biometricLogin(String credential, {String? role}) async {
    final d = await call('POST', '/v1/auth/biometric/session', body: {
      'credential': credential,
      if (role != null) 'role': role,
    });
    final s = _sessionFromResponse(d);
    await AppSessionStore.save(s);
    await BiometricSessionStore.enable(s, credential);
    await registerFcm(s.token);
    return s;
  }

  Future<bool> registerFcm(String token, {String? fcmToken}) async {
    if (!firebaseReady) {
      lastFcmRegistrationMessage =
          'Firebase no pudo inicializarse en esta instalación de Costa-Go.';
      return false;
    }
    activeFcmAuthToken = token;
    Object? lastError;
    StackTrace? lastStack;
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        final fcm = fcmToken ?? await FirebaseMessaging.instance.getToken();
        if (fcm == null || fcm.isEmpty) {
          throw StateError('Firebase no entregó un token FCM.');
        }
        final response =
            await call('PUT', '/v1/devices/fcm-token', token: token, body: {
          'token': fcm,
          'platform':
              defaultTargetPlatform == TargetPlatform.iOS ? 'IOS' : 'ANDROID',
          'firebaseProjectId': Firebase.app().options.projectId,
        });
        final push = response?['push'];
        if (push is Map && push['projectMatches'] == false) {
          throw StateError(
              'La API y la app usan proyectos Firebase diferentes.');
        }
        if (push is Map && push['configured'] == false) {
          throw StateError('La credencial Firebase de la API no es valida.');
        }
        lastFcmRegistrationMessage = null;
        return true;
      } catch (error, stack) {
        lastError = error;
        lastStack = stack;
        lastFcmRegistrationMessage = error is ApiException
            ? error.message
            : error.toString().replaceFirst('Bad state: ', '');
        if (error is ApiException &&
            const {
              'FIREBASE_PROJECT_MISMATCH',
              'FIREBASE_SERVER_NOT_CONFIGURED',
              'INVALID_DEVICE_TOKEN'
            }.contains(error.code)) {
          break;
        }
        if (attempt < 2) {
          await Future<void>.delayed(Duration(seconds: attempt + 1));
        }
      }
    }
    debugPrint('No se pudo registrar el token FCM: $lastError');
    if (sentryDsn.isNotEmpty && lastError != null) {
      unawaited(Sentry.captureException(lastError, stackTrace: lastStack));
    }
    return false;
  }

  Future<void> logout(String token) async {
    try {
      await call('POST', '/v1/auth/logout', token: token);
    } finally {
      if (activeFcmAuthToken == token) activeFcmAuthToken = null;
    }
  }

  Future<dynamic> testPush(String token, {int delaySeconds = 8}) =>
      call('POST', '/v1/devices/test-push',
          token: token, body: {'delaySeconds': delaySeconds});

  Future<void> lock(String token) async {
    try {
      await call('POST', '/v1/auth/lock', token: token);
    } finally {
      if (activeFcmAuthToken == token) activeFcmAuthToken = null;
    }
  }

  Future<void> changePassword(String token, String password,
          {String? currentPassword}) =>
      call('POST', '/v1/auth/change-password', token: token, body: {
        'password': password,
        if (currentPassword != null) 'currentPassword': currentPassword
      });

  Future<dynamic> register(Map<String, dynamic> body) =>
      call('POST', '/v1/auth/register', body: body);
  Future<void> requestEmailVerification(String email) =>
      call('POST', '/v1/auth/email-verification/request',
          body: {'email': email});
  Future<Session> confirmEmailVerification(String email, String code) async {
    final d = await call('POST', '/v1/auth/email-verification/confirm',
        body: {'email': email, 'code': code});
    final s = Session(
        d['token'], d['user']['role'], d['user']['name'], d['user']['id'],
        approvalStatus: d['user']['driverApprovalStatus'],
        availableRoles: List<String>.from(
            d['user']['availableRoles'] ?? [d['user']['role']]));
    await AppSessionStore.save(s);
    await registerFcm(s.token);
    return s;
  }

  Future<dynamic> requestPasswordReset(String email) =>
      call('POST', '/v1/auth/password-reset/request', body: {'email': email});
  Future<Session> switchRole(String token, String role) async {
    final d = await call('POST', '/v1/auth/switch-role',
        token: token, body: {'role': role});
    return Session(
        d['token'], d['user']['role'], d['user']['name'], d['user']['id'],
        mustChangePassword: d['user']['mustChangePassword'] == true,
        approvalStatus: d['user']['driverApprovalStatus'],
        availableRoles:
            List<String>.from(d['user']['availableRoles'] ?? [role]));
  }

  Future<Session> enrollDriver(String token, Map<String, dynamic> body) async {
    final d = await call('POST', '/v1/profile/driver-enrollment',
        token: token, body: body);
    return Session(
        d['token'], d['user']['role'], d['user']['name'], d['user']['id'],
        approvalStatus: d['user']['driverApprovalStatus'],
        availableRoles: List<String>.from(
            d['user']['availableRoles'] ?? ['PASSENGER', 'DRIVER']));
  }

  Future<dynamic> confirmPasswordReset(
          String email, String code, String password) =>
      call('POST', '/v1/auth/password-reset/confirm', body: {
        'email': email,
        'code': code,
        'password': password,
      });
  Future<dynamic> deleteAccount(String token, String password) =>
      call('DELETE', '/v1/profile/account',
          token: token, body: {'password': password});
  Future<List<dynamic>> cooperatives() async =>
      List<dynamic>.from(await call('GET', '/v1/cooperatives'));
  Future<dynamic> active(String t) => call('GET', '/v1/trips/active', token: t);
  Future<Map<String, dynamic>> schedulingSettings(String t) async =>
      Map<String, dynamic>.from(
          await call('GET', '/v1/trips/scheduling-settings', token: t));
  Future<Map<String, dynamic>> tripsPage(String t,
          {String status = 'ALL', String? cursor, int limit = 20}) async =>
      Map<String, dynamic>.from(await call('GET',
          '/v1/trips/mine?limit=$limit&status=${Uri.encodeQueryComponent(status)}${cursor == null ? '' : '&cursor=${Uri.encodeQueryComponent(cursor)}'}',
          token: t));
  Future<List<dynamic>> trips(String t) async =>
      List<dynamic>.from((await tripsPage(t))['items'] ?? const []);
  Future<dynamic> pendingRating(String t) =>
      call('GET', '/v1/trips/pending-rating', token: t);
  Future<Map<String, dynamic>> notificationsPage(String t,
          {String? cursor, int limit = 20}) async =>
      Map<String, dynamic>.from(await call('GET',
          '/v1/notifications?limit=$limit${cursor == null ? '' : '&cursor=${Uri.encodeQueryComponent(cursor)}'}',
          token: t));
  Future<Map<String, dynamic>> activityPage(String t,
          {String? cursor, int limit = 20}) async =>
      Map<String, dynamic>.from(await call('GET',
          '/v1/activity?limit=$limit${cursor == null ? '' : '&cursor=${Uri.encodeQueryComponent(cursor)}'}',
          token: t));
  Future<dynamic> markNotificationRead(String t, String id) =>
      call('PATCH', '/v1/notifications/$id/read', token: t);
  Future<dynamic> markAllNotificationsRead(String t) =>
      call('POST', '/v1/notifications/read-all', token: t);
  Future<Map<String, dynamic>> supportConfig(String t) async =>
      Map<String, dynamic>.from(
          await call('GET', '/v1/support/config', token: t));
  Future<List<dynamic>> supportFaqs(String t) async =>
      List<dynamic>.from(await call('GET', '/v1/support/faqs', token: t));
  Future<List<dynamic>> supportIncidents(String t) async =>
      List<dynamic>.from(await call('GET', '/v1/support/incidents', token: t));
  Future<dynamic> createSupportIncident(String t, Map<String, dynamic> body) =>
      call('POST', '/v1/support/incidents', token: t, body: body);
  Future<Map<String, dynamic>> supportIncident(String t, String id) async =>
      Map<String, dynamic>.from(
          await call('GET', '/v1/support/incidents/$id', token: t));
  Future<dynamic> sendSupportMessage(String t, String id, String body) =>
      call('POST', '/v1/support/incidents/$id/messages',
          token: t, body: {'body': body});
  Future<List<dynamic>> banners(String t, String placement,
          {String? serviceAreaId}) async =>
      List<dynamic>.from(await call('GET',
          '/v1/banners?placement=${Uri.encodeQueryComponent(placement)}${serviceAreaId == null ? '' : '&serviceAreaId=${Uri.encodeQueryComponent(serviceAreaId)}'}',
          token: t));
  Future<Map<String, dynamic>> mobileConfig(String t) async =>
      Map<String, dynamic>.from(
          await call('GET', '/v1/mobile/config', token: t));
  Future<Map<String, dynamic>> driverMembership(String t) async =>
      Map<String, dynamic>.from(
          await call('GET', '/v1/driver/membership', token: t));
  Future<dynamic> createMembershipPaymentOrder(
          String t, String planId, String method) =>
      call('POST', '/v1/driver/membership/payment-orders', token: t, body: {
        'planId': planId,
        'intendedMethod': method,
        'idempotencyKey':
            'mobile-${DateTime.now().microsecondsSinceEpoch}-${math.Random.secure().nextInt(1 << 32)}',
      });
  Future<dynamic> submitMembershipTransferProof(
          String t, String orderId, Map<String, dynamic> proof) =>
      call('POST',
          '/v1/driver/membership/payment-orders/$orderId/transfer-proof',
          token: t, body: proof);
  Future<List<dynamic>> membershipPaymentOrders(String t) async =>
      List<dynamic>.from(
          await call('GET', '/v1/driver/membership/payment-orders', token: t));
  Future<List<dynamic>> membershipCollectionPoints(String t,
      [LatLng? location]) async {
    final suffix = location == null
        ? ''
        : '?latitude=${location.latitude}&longitude=${location.longitude}';
    return List<dynamic>.from(await call(
        'GET', '/v1/driver/membership/collection-points$suffix',
        token: t));
  }

  Future<Map<String, dynamic>> membershipPaymentAccount(String t) async =>
      Map<String, dynamic>.from(
          await call('GET', '/v1/driver/membership/payment-account', token: t));
  Future<dynamic> cancelMembershipPaymentOrder(
          String t, String orderId, String reason, String? observation) =>
      call('POST', '/v1/driver/membership/payment-orders/$orderId/cancel',
          token: t,
          body: {
            'reason': reason,
            if (observation != null && observation.trim().isNotEmpty)
              'observation': observation.trim(),
            'idempotencyKey': 'mobile-cancel-$orderId',
          });
  Future<void> advertisingEvent(String t,
      {required String campaignId,
      required String eventType,
      required String exhibitionId,
      required String placement,
      String? serviceAreaId,
      String? tripStatus,
      String? actionType}) async {
    await call('POST', '/v1/advertising/events', token: t, body: {
      'campaignId': campaignId,
      'eventType': eventType,
      'exhibitionId': exhibitionId,
      'placement': placement,
      if (serviceAreaId != null) 'serviceAreaId': serviceAreaId,
      if (tripStatus != null) 'tripStatus': tripStatus,
      if (actionType != null) 'actionType': actionType,
    });
  }

  Future<dynamic> trip(String t, String id) =>
      call('GET', '/v1/trips/$id', token: t);
  Future<Map<String, dynamic>> route(
      String t, LatLng origin, LatLng destination,
      {List<LatLng> waypoints = const [],
      String? tripId,
      String purpose = 'MAP',
      bool includeRouteToken = false}) async {
    final value = await call('POST', '/v1/routes', token: t, body: {
      'origin': {
        'latitude': origin.latitude,
        'longitude': origin.longitude,
      },
      'destination': {
        'latitude': destination.latitude,
        'longitude': destination.longitude,
      },
      'waypoints': waypoints
          .map((point) => {
                'latitude': point.latitude,
                'longitude': point.longitude,
              })
          .toList(),
      if (tripId != null) 'tripId': tripId,
      'purpose': purpose,
      'includeRouteToken': includeRouteToken,
    });
    return Map<String, dynamic>.from(value);
  }

  Future<List<dynamic>> messages(String t, String tripId) async =>
      List<dynamic>.from(
          await call('GET', '/v1/trips/$tripId/messages', token: t));
  Future<dynamic> sendMessage(
          String t, String tripId, String clientMessageId, String body) =>
      call('POST', '/v1/trips/$tripId/messages', token: t, body: {
        'clientMessageId': clientMessageId,
        'body': body,
      });
  Future<dynamic> create(
          String t, int n, String o, String d, LatLng pickup, LatLng dropoff,
          {String paymentMethod = 'CASH',
          String notes = '',
          List<Map<String, dynamic>>? destinations,
          DateTime? scheduledFor}) =>
      call('POST', '/v1/trips',
          token: t,
          body: buildTripRequestPayload(
            passengers: n,
            originReference: o,
            destinationReference: d,
            selectedOrigin: pickup,
            selectedDestination: dropoff,
            paymentMethod: paymentMethod,
            notes: notes,
            destinations: destinations,
            scheduledFor: scheduledFor,
          ));
  Future<dynamic> createFromPayload(
          String token, Map<String, dynamic> payload) =>
      call('POST', '/v1/trips', token: token, body: payload);
  Future<Map<String, dynamic>> previewTrip(
          String t, Map<String, dynamic> payload) async =>
      Map<String, dynamic>.from(
          await call('POST', '/v1/trips/preview', token: t, body: payload));
  Future<List<dynamic>> scheduledTrips(String t) async =>
      List<dynamic>.from(await call('GET', '/v1/trips/scheduled', token: t));
  Future<dynamic> updateScheduled(
          String t, String tripId, Map<String, dynamic> payload) =>
      call('PUT', '/v1/trips/$tripId/scheduled', token: t, body: payload);
  Future<List<dynamic>> scheduledOffers(String t) async => List<dynamic>.from(
      await call('GET', '/v1/driver/scheduled-offers', token: t));
  Future<dynamic> respondScheduled(String t, String tripId, bool accept) =>
      call('POST', '/v1/driver/scheduled-offers/$tripId/respond',
          token: t, body: {'accept': accept});
  Future<dynamic> releaseScheduled(String t, String tripId) =>
      call('POST', '/v1/driver/scheduled-trips/$tripId/release', token: t);
  Future<dynamic> completeStop(String t, String tripId, String stopId) =>
      call('POST', '/v1/trips/$tripId/stops/$stopId/complete', token: t);
  Future<dynamic> cancelTrip(String t, String id) =>
      call('POST', '/v1/trips/$id/cancel', token: t);
  Future<dynamic> profile(String t) => call('GET', '/v1/profile', token: t);
  Future<dynamic> updateProfilePhoto(
          String t, String fileBase64, String fileMime) =>
      call('PUT', '/v1/profile/photo', token: t, body: {
        'fileBase64': fileBase64,
        'fileMime': fileMime,
      });
  Future<dynamic> deleteProfilePhoto(String t) =>
      call('DELETE', '/v1/profile/photo', token: t);
  Future<List<dynamic>> driverDocuments(String t) async =>
      List<dynamic>.from(await call('GET', '/v1/driver/documents', token: t));
  Future<dynamic> uploadDriverDocument(String t, String documentType,
          String fileBase64, String fileMime, String expiresAt) =>
      call('POST', '/v1/driver/documents', token: t, body: {
        'documentType': documentType,
        'fileBase64': fileBase64,
        'fileMime': fileMime,
        if (expiresAt.isNotEmpty) 'expiresAt': expiresAt,
      });
  Future<List<dynamic>> favoritePlaces(String t) async =>
      List<dynamic>.from(await call('GET', '/v1/favorite-places', token: t));
  Future<dynamic> saveFavoritePlace(
          String t, String label, String address, LatLng point) =>
      call('POST', '/v1/favorite-places', token: t, body: {
        'label': label,
        'address': address,
        'location': {
          'latitude': point.latitude,
          'longitude': point.longitude,
        }
      });
  Future<void> deleteFavoritePlace(String t, String id) =>
      call('DELETE', '/v1/favorite-places/$id', token: t);
  Future<List<dynamic>> search(String t, String query,
      [LatLng? focus, String? serviceAreaId]) async {
    final parameters = <String, String>{'q': query};
    if (focus != null) {
      parameters['latitude'] = focus.latitude.toString();
      parameters['longitude'] = focus.longitude.toString();
    }
    if (serviceAreaId != null) parameters['serviceAreaId'] = serviceAreaId;
    return List<dynamic>.from(await call(
        'GET',
        Uri(path: '/v1/locations/search', queryParameters: parameters)
            .toString(),
        token: t));
  }

  Future<dynamic> serviceAreas(String t, [int? version]) => call(
      'GET',
      Uri(path: '/v1/service-areas', queryParameters: {
        if (version != null) 'version': version.toString()
      }).toString(),
      token: t);

  Future<dynamic> resolveServiceArea(String t, LatLng point) =>
      call('POST', '/v1/service-areas/resolve', token: t, body: {
        'latitude': point.latitude,
        'longitude': point.longitude,
      });

  Future<dynamic> reverse(String t, LatLng point) => call(
      'GET',
      Uri(path: '/v1/locations/reverse', queryParameters: {
        'latitude': point.latitude.toString(),
        'longitude': point.longitude.toString()
      }).toString(),
      token: t);

  Future<List<dynamic>> nearbyDrivers(String t, LatLng point) async {
    final result = await call(
      'GET',
      Uri(path: '/v1/drivers/nearby', queryParameters: {
        'latitude': point.latitude.toString(),
        'longitude': point.longitude.toString(),
      }).toString(),
      token: t,
    );
    return List<dynamic>.from(result['drivers'] ?? const []);
  }

  Future<dynamic> offers(String t) =>
      call('GET', '/v1/driver/offers', token: t);
  Future<dynamic> driverState(String t) =>
      call('GET', '/v1/driver/state', token: t);
  Future<void> available(String t, bool v, [LatLng? location]) =>
      call('PUT', '/v1/driver/availability', token: t, body: {
        'available': v,
        if (location != null)
          'location': {
            'longitude': location.longitude,
            'latitude': location.latitude
          }
      });
  Future<void> respond(String t, String id, {required bool accept}) =>
      call('POST', '/v1/driver/offers/$id/respond',
          token: t, body: {'accept': accept});
  Future<void> action(String t, String id, String a) =>
      call('POST', '/v1/trips/$id/action', token: t, body: {'action': a});
  Future<void> cancelAssignedTrip(String token, String tripId,
          {required String reason,
          String? observation,
          required String idempotencyKey}) =>
      call('POST', '/v1/driver/trips/$tripId/cancel', token: token, body: {
        'reason': reason,
        if (observation?.trim().isNotEmpty == true)
          'observation': observation!.trim(),
        'idempotencyKey': idempotencyKey,
      });
  Future<void> rate(
          String t, String id, int score, List<String> tags, String comment) =>
      call('POST', '/v1/trips/$id/ratings',
          token: t, body: {'score': score, 'tags': tags, 'comment': comment});
}

Widget homeForSession(Session session) {
  if (session.mustChangePassword) return ChangeTemporaryPassword(session);
  if (session.role == 'DRIVER') {
    return session.approvalStatus == null ||
            session.approvalStatus == 'APROBADO'
        ? Driver(session)
        : DriverApprovalScreen(session);
  }
  return Passenger(session);
}

class SessionBootstrap extends StatefulWidget {
  const SessionBootstrap({super.key});

  @override
  State<SessionBootstrap> createState() => _SessionBootstrapState();
}

class _SessionBootstrapState extends State<SessionBootstrap> {
  Session? session;
  bool loading = true;

  @override
  void initState() {
    super.initState();
    restoreSession();
  }

  Future<void> restoreSession() async {
    final saved = await AppSessionStore.saved();
    if (saved != null) {
      activeFcmAuthToken = saved.token;
      unawaited(Api().registerFcm(saved.token));
    }
    if (!mounted) return;
    setState(() {
      session = saved;
      loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    return session == null ? const Welcome() : homeForSession(session!);
  }
}

class MototaxiApp extends StatelessWidget {
  const MototaxiApp({super.key});
  @override
  Widget build(BuildContext c) => ValueListenableBuilder<ThemeMode>(
      valueListenable: appTheme,
      builder: (context, mode, child) => MaterialApp(
          navigatorKey: rootNavigatorKey,
          title: 'Costa-Go',
          debugShowCheckedModeBanner: false,
          themeMode: mode,
          theme: _theme(Brightness.light),
          darkTheme: _theme(Brightness.dark),
          navigatorObservers:
              sentryDsn.isEmpty ? const [] : [SentryNavigatorObserver()],
          builder: (context, child) => NetworkStatus(child: child!),
          home: const SessionBootstrap()));

  ThemeData _theme(Brightness brightness) {
    final scheme = ColorScheme.fromSeed(
        seedColor: const Color(0xff087ccb), brightness: brightness);
    return ThemeData(
        colorScheme: scheme,
        brightness: brightness,
        useMaterial3: true,
        scaffoldBackgroundColor:
            brightness == Brightness.light ? const Color(0xfff3f8fc) : null,
        appBarTheme: AppBarTheme(
            centerTitle: false,
            elevation: 0,
            scrolledUnderElevation: 0,
            backgroundColor: brightness == Brightness.light
                ? const Color(0xfff3f8fc)
                : scheme.surface,
            titleTextStyle: TextStyle(
                color: scheme.onSurface,
                fontSize: 20,
                fontWeight: FontWeight.w800)),
        cardTheme: CardThemeData(
            elevation: 0,
            margin: const EdgeInsets.symmetric(vertical: 6),
            color: scheme.surface,
            shape: RoundedRectangleBorder(
                side: BorderSide(
                    color: scheme.outlineVariant.withValues(alpha: .65)),
                borderRadius: BorderRadius.circular(20))),
        listTileTheme: ListTileThemeData(
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16))),
        inputDecorationTheme: InputDecorationTheme(
            filled: true,
            fillColor: scheme.surfaceContainerHighest.withValues(alpha: .45),
            border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(16),
                borderSide: BorderSide.none),
            focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(16),
                borderSide: BorderSide(color: scheme.primary, width: 2))),
        filledButtonTheme: FilledButtonThemeData(
            style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(54),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(18)))));
  }
}

class NetworkStatus extends StatefulWidget {
  const NetworkStatus({required this.child, super.key});
  final Widget child;

  @override
  State<NetworkStatus> createState() => _NetworkStatusState();
}

class _NetworkStatusState extends State<NetworkStatus> {
  StreamSubscription<List<ConnectivityResult>>? subscription;
  bool offline = false;

  @override
  void initState() {
    super.initState();
    subscription = Connectivity().onConnectivityChanged.listen((results) {
      if (mounted) {
        setState(() => offline = results.isEmpty ||
            results.every((value) => value == ConnectivityResult.none));
      }
    });
    Connectivity().checkConnectivity().then((results) {
      if (mounted) {
        setState(() => offline = results.isEmpty ||
            results.every((value) => value == ConnectivityResult.none));
      }
    });
  }

  @override
  void dispose() {
    subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Stack(children: [
        widget.child,
        AnimatedPositioned(
          duration: const Duration(milliseconds: 250),
          left: 12,
          right: 12,
          top: offline ? MediaQuery.paddingOf(context).top + 6 : -80,
          child: Material(
            color: const Color(0xff8a3b22),
            borderRadius: BorderRadius.circular(14),
            elevation: 8,
            child: const Padding(
              padding: EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              child: Row(children: [
                Icon(Icons.cloud_off_outlined, color: Colors.white, size: 20),
                SizedBox(width: 10),
                Expanded(
                    child: Text(
                        'Sin conexión. Conservaremos la pantalla y reintentaremos al volver Internet.',
                        style: TextStyle(color: Colors.white, fontSize: 12))),
              ]),
            ),
          ),
        ),
      ]);
}

class ThemeSelector extends StatelessWidget {
  const ThemeSelector({super.key, this.onPhoto = false});
  final bool onPhoto;

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<ThemeMode>(
      valueListenable: appTheme,
      builder: (context, mode, child) => PopupMenuButton<ThemeMode>(
          tooltip: 'Cambiar apariencia',
          initialValue: mode,
          onSelected: appTheme.change,
          icon: Icon(
              mode == ThemeMode.dark
                  ? Icons.dark_mode_outlined
                  : mode == ThemeMode.light
                      ? Icons.light_mode_outlined
                      : Icons.brightness_auto_outlined,
              color: onPhoto ? Colors.white : null),
          itemBuilder: (_) => const [
                PopupMenuItem(
                    value: ThemeMode.system,
                    child: ListTile(
                        leading: Icon(Icons.brightness_auto_outlined),
                        title: Text('Usar tema del teléfono'))),
                PopupMenuItem(
                    value: ThemeMode.light,
                    child: ListTile(
                        leading: Icon(Icons.light_mode_outlined),
                        title: Text('Tema claro'))),
                PopupMenuItem(
                    value: ThemeMode.dark,
                    child: ListTile(
                        leading: Icon(Icons.dark_mode_outlined),
                        title: Text('Tema oscuro'))),
              ]));
}

class CostaGoBrand extends StatelessWidget {
  const CostaGoBrand({super.key, this.compact = false});
  final bool compact;

  @override
  Widget build(BuildContext context) => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Image.asset('assets/images/costa-go-emblem.png',
              width: compact ? 82 : 142,
              height: compact ? 82 : 142,
              fit: BoxFit.contain),
          SizedBox(height: compact ? 2 : 8),
          Text.rich(
            TextSpan(children: [
              const TextSpan(
                  text: 'COSTA-', style: TextStyle(color: Colors.white)),
              TextSpan(
                  text: 'GO',
                  style: TextStyle(
                      color: compact
                          ? const Color(0xff12bdf2)
                          : const Color(0xff2dccff))),
            ]),
            textAlign: TextAlign.center,
            style: TextStyle(
                fontSize: compact ? 26 : 36,
                fontWeight: FontWeight.w900,
                fontStyle: FontStyle.italic,
                letterSpacing: -.8,
                shadows: const [
                  Shadow(color: Color(0x66000000), blurRadius: 8)
                ]),
          ),
        ],
      );
}

class Welcome extends StatelessWidget {
  const Welcome({super.key});
  @override
  Widget build(BuildContext c) => Scaffold(
          body: Stack(fit: StackFit.expand, children: [
        Image.asset('assets/images/atacames-login-hero.png', fit: BoxFit.cover),
        Container(
            decoration: const BoxDecoration(
                gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [Color(0x66032B49), Color(0xDD032B49)]))),
        SafeArea(
            child: Stack(children: [
          const Positioned(
              top: 4, right: 8, child: ThemeSelector(onPhoto: true)),
          Center(
              child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(24, 16, 24, 72),
                  child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 340),
                      child: Column(mainAxisSize: MainAxisSize.min, children: [
                        const CostaGoBrand(),
                        const SizedBox(height: 28),
                        SizedBox(
                            width: 286,
                            child: FilledButton.icon(
                                onPressed: () => open(c, 'PASSENGER'),
                                icon: const Icon(Icons.person_outline),
                                label: const Text('Ingresar como pasajero'))),
                        const SizedBox(height: 10),
                        SizedBox(
                            width: 286,
                            child: OutlinedButton.icon(
                                onPressed: () => open(c, 'DRIVER'),
                                style: OutlinedButton.styleFrom(
                                    foregroundColor: Colors.white,
                                    minimumSize: const Size.fromHeight(54),
                                    side:
                                        const BorderSide(color: Colors.white70),
                                    shape: RoundedRectangleBorder(
                                        borderRadius:
                                            BorderRadius.circular(18))),
                                icon: const Icon(
                                    Icons.sports_motorsports_outlined),
                                label: const Text('Ingresar como conductor'))),
                        const SizedBox(height: 8),
                        TextButton.icon(
                            onPressed: () => Navigator.push(
                                c,
                                MaterialPageRoute(
                                    builder: (_) => const Register())),
                            icon: const Icon(Icons.person_add_alt_1_outlined,
                                color: Colors.white),
                            label: const Text('Crear una cuenta',
                                style: TextStyle(color: Colors.white))),
                        TextButton.icon(
                            onPressed: () => Navigator.push(
                                c,
                                MaterialPageRoute(
                                    builder: (_) => const Recovery())),
                            icon: const Icon(Icons.key_outlined,
                                color: Colors.white),
                            label: const Text('Recuperar contraseña',
                                style: TextStyle(color: Colors.white))),
                      ])))),
          const Positioned(
            left: 0,
            right: 0,
            bottom: 7,
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text('Powered by',
                  style: TextStyle(color: Colors.white70, fontSize: 9)),
              SizedBox(height: 1),
              Text('DFAR SYSTEM',
                  style: TextStyle(
                      color: Colors.white,
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 1.5)),
            ]),
          ),
        ]))
      ]));
  void open(BuildContext c, String r) =>
      Navigator.push(c, MaterialPageRoute(builder: (_) => Login(r)));
}

class Login extends StatefulWidget {
  const Login(this.role, {super.key});
  final String role;
  @override
  State<Login> createState() => _LoginState();
}

class _LoginState extends State<Login> {
  late final TextEditingController email, password;
  String? error;
  bool busy = false;
  bool showPassword = false;
  BiometricAccess? biometricSession;
  @override
  void initState() {
    super.initState();
    email = TextEditingController();
    password = TextEditingController();
    BiometricSessionStore.saved().then((session) {
      if (mounted && session?.role == widget.role) {
        setState(() => biometricSession = session);
      }
    });
  }

  @override
  void dispose() {
    email.dispose();
    password.dispose();
    super.dispose();
  }

  Future<void> go() async {
    FocusScope.of(context).unfocus();
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final s = await Api().login(email.text, password.text, role: widget.role);
      if (sentryDsn.isNotEmpty) {
        await Sentry.configureScope((scope) => scope.setUser(
            SentryUser(id: s.id, username: s.name, data: {'role': s.role})));
      }
      if (mounted) {
        Navigator.pushReplacement(
            context,
            MaterialPageRoute(
                builder: (_) => s.mustChangePassword
                    ? ChangeTemporaryPassword(s)
                    : s.role == 'DRIVER'
                        ? (s.approvalStatus == null ||
                                s.approvalStatus == 'APROBADO'
                            ? Driver(s)
                            : DriverApprovalScreen(s))
                        : Passenger(s)));
      }
    } catch (e) {
      if (mounted &&
          e is ApiException &&
          e.code == 'EMAIL_VERIFICATION_REQUIRED') {
        Navigator.push(
            context,
            MaterialPageRoute(
                builder: (_) =>
                    EmailVerificationScreen(email: email.text.trim())));
      } else if (mounted) {
        setState(() => error = e.toString());
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> biometricLogin() async {
    final session = biometricSession;
    if (session == null) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final authenticated = await BiometricSessionStore.authenticate();
      if (!authenticated) {
        if (mounted) {
          setState(() => error =
              'No se reconoció la biometría. Puedes intentarlo nuevamente.');
        }
        return;
      }
    } catch (reason) {
      if (mounted) {
        setState(() {
          error = BiometricSessionStore.errorMessage(reason);
        });
      }
      return;
    }

    try {
      final activeSession =
          await Api().biometricLogin(session.credential, role: widget.role);
      if (!mounted) return;
      Navigator.pushReplacement(
          context,
          MaterialPageRoute(
              builder: (_) => activeSession.role == 'DRIVER'
                  ? (activeSession.approvalStatus == null ||
                          activeSession.approvalStatus == 'APROBADO'
                      ? Driver(activeSession)
                      : DriverApprovalScreen(activeSession))
                  : Passenger(activeSession)));
    } catch (reason) {
      final revoked = reason is ApiException &&
          (reason.code == 'UNAUTHORIZED' ||
              reason.code == 'INVALID_BIOMETRIC_CREDENTIAL' ||
              reason.statusCode == 401);
      if (revoked) await BiometricSessionStore.clear();
      if (mounted) {
        setState(() {
          if (revoked) biometricSession = null;
          error = revoked
              ? 'La sesión biométrica fue revocada. Ingresa con tu contraseña y actívala nuevamente.'
              : reason.toString();
        });
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext c) {
    final isDriver = widget.role == 'DRIVER';
    final scheme = Theme.of(c).colorScheme;
    return Scaffold(
        appBar: AppBar(
            title:
                Text(isDriver ? 'Acceso de conductor' : 'Acceso de pasajero'),
            actions: const [ThemeSelector()]),
        body: Container(
            decoration: BoxDecoration(
                gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [
                  scheme.primaryContainer.withValues(alpha: .5),
                  scheme.surface,
                ])),
            child: SafeArea(
                top: false,
                child: LayoutBuilder(
                    builder: (context, constraints) => SingleChildScrollView(
                        padding: const EdgeInsets.all(24),
                        child: ConstrainedBox(
                            constraints: BoxConstraints(
                                minHeight: constraints.maxHeight - 48),
                            child: Center(
                                child: ConstrainedBox(
                                    constraints:
                                        const BoxConstraints(maxWidth: 460),
                                    child: Card(
                                        elevation: 4,
                                        shadowColor: scheme.shadow
                                            .withValues(alpha: .18),
                                        child: Padding(
                                            padding: const EdgeInsets.all(24),
                                            child: Column(
                                                mainAxisSize: MainAxisSize.min,
                                                children: [
                                                  Container(
                                                      width: 112,
                                                      height: 112,
                                                      padding:
                                                          const EdgeInsets.all(
                                                              14),
                                                      decoration: BoxDecoration(
                                                          borderRadius:
                                                              BorderRadius
                                                                  .circular(32),
                                                          gradient:
                                                              const LinearGradient(
                                                                  colors: [
                                                                Color(
                                                                    0xff087ccb),
                                                                Color(
                                                                    0xff032b49)
                                                              ])),
                                                      child: Image.asset(
                                                          'assets/images/costa-go-emblem.png')),
                                                  const SizedBox(height: 18),
                                                  Text(
                                                      isDriver
                                                          ? 'Bienvenido, conductor'
                                                          : '¡Hola! ¿A dónde vamos?',
                                                      textAlign:
                                                          TextAlign.center,
                                                      style: Theme.of(c)
                                                          .textTheme
                                                          .headlineSmall
                                                          ?.copyWith(
                                                              fontWeight:
                                                                  FontWeight
                                                                      .bold)),
                                                  const SizedBox(height: 6),
                                                  Text(
                                                      isDriver
                                                          ? 'Ingresa para recibir solicitudes cercanas.'
                                                          : 'Ingresa para solicitar tu próxima mototaxi.',
                                                      textAlign:
                                                          TextAlign.center,
                                                      style: Theme.of(c)
                                                          .textTheme
                                                          .bodyMedium
                                                          ?.copyWith(
                                                              color: scheme
                                                                  .onSurfaceVariant)),
                                                  const SizedBox(height: 24),
                                                  TextField(
                                                      controller: email,
                                                      keyboardType:
                                                          TextInputType
                                                              .emailAddress,
                                                      textInputAction:
                                                          TextInputAction.next,
                                                      decoration: const InputDecoration(
                                                          labelText:
                                                              'Correo electrónico',
                                                          prefixIcon: Icon(Icons
                                                              .alternate_email))),
                                                  const SizedBox(height: 14),
                                                  TextField(
                                                      controller: password,
                                                      obscureText:
                                                          !showPassword,
                                                      textInputAction:
                                                          TextInputAction.done,
                                                      onSubmitted: (_) =>
                                                          busy ? null : go(),
                                                      decoration: InputDecoration(
                                                          labelText:
                                                              'Contraseña',
                                                          prefixIcon:
                                                              const Icon(Icons
                                                                  .lock_outline),
                                                          suffixIcon: IconButton(
                                                              tooltip: showPassword
                                                                  ? 'Ocultar contraseña'
                                                                  : 'Mostrar contraseña',
                                                              onPressed: () =>
                                                                  setState(() =>
                                                                      showPassword =
                                                                          !showPassword),
                                                              icon: Icon(showPassword
                                                                  ? Icons
                                                                      .visibility_off_outlined
                                                                  : Icons
                                                                      .visibility_outlined)))),
                                                  if (error != null) ...[
                                                    const SizedBox(height: 14),
                                                    Container(
                                                        width: double.infinity,
                                                        padding:
                                                            const EdgeInsets
                                                                .all(12),
                                                        decoration: BoxDecoration(
                                                            color: scheme
                                                                .errorContainer,
                                                            borderRadius:
                                                                BorderRadius
                                                                    .circular(
                                                                        12)),
                                                        child: Row(children: [
                                                          Icon(
                                                              Icons
                                                                  .error_outline,
                                                              color: scheme
                                                                  .onErrorContainer),
                                                          const SizedBox(
                                                              width: 10),
                                                          Expanded(
                                                              child: Text(
                                                                  error!,
                                                                  style: TextStyle(
                                                                      color: scheme
                                                                          .onErrorContainer)))
                                                        ]))
                                                  ],
                                                  const SizedBox(height: 22),
                                                  FilledButton.icon(
                                                      onPressed:
                                                          busy ? null : go,
                                                      icon: busy
                                                          ? const SizedBox(
                                                              width: 20,
                                                              height: 20,
                                                              child:
                                                                  CircularProgressIndicator(
                                                                      strokeWidth:
                                                                          2))
                                                          : Icon(isDriver
                                                              ? Icons
                                                                  .sports_motorsports_outlined
                                                              : Icons
                                                                  .person_outline),
                                                      label: Text(busy
                                                          ? 'Ingresando…'
                                                          : 'Ingresar')),
                                                  if (biometricSession !=
                                                      null) ...[
                                                    const SizedBox(height: 10),
                                                    OutlinedButton.icon(
                                                      onPressed: busy
                                                          ? null
                                                          : biometricLogin,
                                                      icon: const Icon(
                                                          Icons.fingerprint),
                                                      label: const Text(
                                                          'Ingresar con biometría'),
                                                    ),
                                                  ],
                                                  const SizedBox(height: 10),
                                                  TextButton.icon(
                                                      onPressed: () =>
                                                          Navigator.push(
                                                              c,
                                                              MaterialPageRoute(
                                                                  builder: (_) =>
                                                                      const Recovery())),
                                                      icon: const Icon(
                                                          Icons.key_outlined),
                                                      label: const Text(
                                                          'Recuperar contraseña')),
                                                  TextButton.icon(
                                                      onPressed: () =>
                                                          Navigator.push(
                                                              c,
                                                              MaterialPageRoute(
                                                                  builder: (_) =>
                                                                      const Register())),
                                                      icon: const Icon(Icons
                                                          .person_add_alt_1_outlined),
                                                      label: const Text(
                                                          'Crear una cuenta'))
                                                ])))))))))));
  }
}

class Recovery extends StatefulWidget {
  const Recovery({super.key});
  @override
  State<Recovery> createState() => _RecoveryState();
}

class _RecoveryState extends State<Recovery> {
  final email = TextEditingController();
  final code = TextEditingController();
  final password = TextEditingController();
  final confirmation = TextEditingController();
  bool codeRequested = false, busy = false, hidePassword = true;
  String? message;

  @override
  void dispose() {
    email.dispose();
    code.dispose();
    password.dispose();
    confirmation.dispose();
    super.dispose();
  }

  Future<void> requestCode() async {
    if (!email.text.contains('@')) {
      setState(() => message = 'Ingresa el correo registrado.');
      return;
    }
    setState(() {
      busy = true;
      message = null;
    });
    try {
      await Api().requestPasswordReset(email.text.trim());
      if (mounted) {
        setState(() {
          codeRequested = true;
          message =
              'Si el correo está registrado, recibirás un código válido por 15 minutos.';
        });
      }
    } catch (error) {
      if (mounted) setState(() => message = error.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> confirm() async {
    if (code.text.trim().length != 6) {
      setState(() => message = 'Ingresa el código de seis dígitos.');
      return;
    }
    final validationError = strongPasswordError(password.text);
    if (validationError != null) {
      setState(() => message = validationError);
      return;
    }
    if (password.text != confirmation.text) {
      setState(() => message = 'Las contraseñas no coinciden.');
      return;
    }
    setState(() {
      busy = true;
      message = null;
    });
    try {
      await Api().confirmPasswordReset(
          email.text.trim(), code.text.trim(), password.text);
      await BiometricSessionStore.clear();
      if (!mounted) return;
      await showDialog<void>(
          context: context,
          builder: (dialogContext) => AlertDialog(
                icon: const Icon(Icons.check_circle_outline),
                title: const Text('Contraseña actualizada'),
                content:
                    const Text('Ya puedes ingresar con tu nueva contraseña.'),
                actions: [
                  FilledButton(
                      onPressed: () => Navigator.pop(dialogContext),
                      child: const Text('Continuar'))
                ],
              ));
      if (mounted) Navigator.pop(context);
    } catch (error) {
      if (mounted) setState(() => message = error.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Recuperar contraseña')),
        body: ListView(padding: const EdgeInsets.all(24), children: [
          const Icon(Icons.lock_reset_outlined, size: 68),
          const SizedBox(height: 12),
          Text('Recupera tu cuenta',
              textAlign: TextAlign.center,
              style: Theme.of(context)
                  .textTheme
                  .headlineSmall
                  ?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          const Text('Te enviaremos un código al correo registrado.',
              textAlign: TextAlign.center),
          const SizedBox(height: 24),
          TextField(
              controller: email,
              enabled: !codeRequested && !busy,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(
                  labelText: 'Correo electrónico',
                  prefixIcon: Icon(Icons.alternate_email))),
          if (codeRequested) ...[
            const SizedBox(height: 14),
            TextField(
                controller: code,
                keyboardType: TextInputType.number,
                maxLength: 6,
                decoration: const InputDecoration(
                    labelText: 'Código de seis dígitos',
                    prefixIcon: Icon(Icons.pin_outlined))),
            const SizedBox(height: 6),
            TextField(
                controller: password,
                obscureText: hidePassword,
                onChanged: (_) => setState(() {}),
                decoration: const InputDecoration(
                    labelText: 'Nueva contraseña',
                    prefixIcon: Icon(Icons.password_outlined))),
            PasswordStrengthIndicator(password: password.text),
            const SizedBox(height: 14),
            TextField(
                controller: confirmation,
                obscureText: hidePassword,
                decoration: InputDecoration(
                    labelText: 'Confirmar nueva contraseña',
                    prefixIcon: const Icon(Icons.password_outlined),
                    suffixIcon: IconButton(
                        onPressed: () =>
                            setState(() => hidePassword = !hidePassword),
                        icon: Icon(hidePassword
                            ? Icons.visibility_outlined
                            : Icons.visibility_off_outlined)))),
          ],
          if (message != null)
            Padding(
                padding: const EdgeInsets.symmetric(vertical: 14),
                child: Text(message!, textAlign: TextAlign.center)),
          FilledButton.icon(
              onPressed: busy ? null : (codeRequested ? confirm : requestCode),
              icon: Icon(codeRequested
                  ? Icons.check_circle_outline
                  : Icons.mail_outline),
              label: Text(busy
                  ? 'Procesando…'
                  : codeRequested
                      ? 'Cambiar contraseña'
                      : 'Enviar código')),
          if (codeRequested)
            TextButton(
                onPressed: busy ? null : requestCode,
                child: const Text('Enviar un código nuevo')),
        ]),
      );
}

class EmailVerificationScreen extends StatefulWidget {
  const EmailVerificationScreen(
      {super.key, required this.email, this.initialMessage});
  final String email;
  final String? initialMessage;

  @override
  State<EmailVerificationScreen> createState() =>
      _EmailVerificationScreenState();
}

class _EmailVerificationScreenState extends State<EmailVerificationScreen> {
  final code = TextEditingController();
  bool busy = false;
  String? message;

  @override
  void initState() {
    super.initState();
    message = widget.initialMessage;
  }

  @override
  void dispose() {
    code.dispose();
    super.dispose();
  }

  Future<void> resend() async {
    setState(() {
      busy = true;
      message = null;
    });
    try {
      await Api().requestEmailVerification(widget.email);
      if (mounted) {
        setState(() => message =
            'Si la cuenta está pendiente, enviamos un código nuevo. Revisa también spam.');
      }
    } catch (error) {
      if (mounted) setState(() => message = error.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> confirm() async {
    if (!RegExp(r'^\d{6}$').hasMatch(code.text.trim())) {
      setState(() => message = 'Ingresa el código de seis dígitos.');
      return;
    }
    setState(() {
      busy = true;
      message = null;
    });
    try {
      final session =
          await Api().confirmEmailVerification(widget.email, code.text.trim());
      if (!mounted) return;
      Navigator.pushAndRemoveUntil(
          context,
          MaterialPageRoute(
              builder: (_) => session.role == 'DRIVER'
                  ? DriverApprovalScreen(session)
                  : Passenger(session)),
          (_) => false);
    } catch (error) {
      if (mounted) setState(() => message = error.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Verifica tu correo')),
        body: ListView(padding: const EdgeInsets.all(24), children: [
          const Icon(Icons.mark_email_read_outlined, size: 72),
          const SizedBox(height: 16),
          Text('Confirma que el correo es tuyo',
              textAlign: TextAlign.center,
              style: Theme.of(context)
                  .textTheme
                  .headlineSmall
                  ?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          Text('Enviamos un código de seis dígitos a ${widget.email}.',
              textAlign: TextAlign.center),
          const SizedBox(height: 24),
          TextField(
              controller: code,
              enabled: !busy,
              keyboardType: TextInputType.number,
              textInputAction: TextInputAction.done,
              maxLength: 6,
              onSubmitted: (_) => confirm(),
              decoration: const InputDecoration(
                  labelText: 'Código de verificación',
                  prefixIcon: Icon(Icons.pin_outlined))),
          if (message != null)
            Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Text(message!, textAlign: TextAlign.center)),
          FilledButton.icon(
              onPressed: busy ? null : confirm,
              icon: const Icon(Icons.verified_outlined),
              label: Text(busy ? 'Verificando…' : 'Verificar correo')),
          TextButton(
              onPressed: busy ? null : resend,
              child: const Text('Enviar un código nuevo')),
          TextButton(
              onPressed: busy
                  ? null
                  : () => Navigator.pushAndRemoveUntil(
                      context,
                      MaterialPageRoute(builder: (_) => const Welcome()),
                      (_) => false),
              child: const Text('Volver al inicio de sesión')),
        ]),
      );
}

class ChangeTemporaryPassword extends StatefulWidget {
  const ChangeTemporaryPassword(this.session, {super.key});
  final Session session;

  @override
  State<ChangeTemporaryPassword> createState() =>
      _ChangeTemporaryPasswordState();
}

class _ChangeTemporaryPasswordState extends State<ChangeTemporaryPassword> {
  final password = TextEditingController();
  final confirmation = TextEditingController();
  bool busy = false;
  bool showPassword = false;
  String? error;

  @override
  void dispose() {
    password.dispose();
    confirmation.dispose();
    super.dispose();
  }

  Future<void> save() async {
    FocusScope.of(context).unfocus();
    final validationError = strongPasswordError(password.text);
    if (validationError != null) {
      setState(() => error = validationError);
      return;
    }
    if (password.text != confirmation.text) {
      setState(() => error = 'Las contraseñas no coinciden.');
      return;
    }
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await Api().changePassword(widget.session.token, password.text);
      if (!mounted) return;
      final session = Session(widget.session.token, widget.session.role,
          widget.session.name, widget.session.id,
          approvalStatus: widget.session.approvalStatus,
          availableRoles: widget.session.availableRoles);
      await AppSessionStore.save(session);
      if (!mounted) return;
      Navigator.pushAndRemoveUntil(
          context,
          MaterialPageRoute(builder: (_) => homeForSession(session)),
          (_) => false);
    } catch (reason) {
      if (mounted) setState(() => error = reason.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> logout() async {
    try {
      await Api().logout(widget.session.token);
    } catch (_) {}
    await clearLocalSession();
    if (!mounted) return;
    Navigator.pushAndRemoveUntil(context,
        MaterialPageRoute(builder: (_) => const Welcome()), (_) => false);
  }

  @override
  Widget build(BuildContext context) => PopScope(
      canPop: false,
      child: Scaffold(
          appBar: AppBar(title: const Text('Protege tu cuenta')),
          body: ListView(padding: const EdgeInsets.all(24), children: [
            const Icon(Icons.password_outlined, size: 64),
            const SizedBox(height: 16),
            Text('Cambia tu contraseña temporal',
                textAlign: TextAlign.center,
                style: Theme.of(context)
                    .textTheme
                    .headlineSmall
                    ?.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            const Text(
                'El administrador restableció tu acceso. Crea una contraseña personal antes de continuar.',
                textAlign: TextAlign.center),
            const SizedBox(height: 24),
            TextField(
                controller: password,
                obscureText: !showPassword,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                    labelText: 'Nueva contraseña',
                    prefixIcon: const Icon(Icons.lock_outline),
                    suffixIcon: IconButton(
                        onPressed: () =>
                            setState(() => showPassword = !showPassword),
                        icon: Icon(showPassword
                            ? Icons.visibility_off_outlined
                            : Icons.visibility_outlined)))),
            PasswordStrengthIndicator(password: password.text),
            const SizedBox(height: 14),
            TextField(
                controller: confirmation,
                obscureText: !showPassword,
                onSubmitted: (_) => busy ? null : save(),
                decoration: const InputDecoration(
                    labelText: 'Confirmar contraseña',
                    prefixIcon: Icon(Icons.lock_reset_outlined))),
            if (error != null)
              Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Text(error!,
                      style: TextStyle(
                          color: Theme.of(context).colorScheme.error))),
            const SizedBox(height: 16),
            FilledButton.icon(
                onPressed: busy ? null : save,
                icon: const Icon(Icons.check_circle_outline),
                label: Text(busy ? 'Guardando…' : 'Guardar y continuar')),
            TextButton(
                onPressed: busy ? null : logout,
                child: const Text('Cerrar sesión')),
          ])));
}

class Register extends StatefulWidget {
  const Register({super.key});
  @override
  State<Register> createState() => _RegisterState();
}

class _RegisterState extends State<Register> {
  final formKey = GlobalKey<FormState>();
  final name = TextEditingController(),
      email = TextEditingController(),
      phone = TextEditingController(),
      password = TextEditingController(),
      vehicle = TextEditingController();
  final nameFocus = FocusNode(),
      emailFocus = FocusNode(),
      phoneFocus = FocusNode(),
      passwordFocus = FocusNode(),
      vehicleFocus = FocusNode();
  String role = 'PASSENGER', message = '';
  String cooperativeSelection = 'INDIVIDUAL';
  List<dynamic> cooperatives = [];
  bool loadingCooperatives = false;
  bool busy = false, submitted = false, acceptedPolicies = false;
  XFile? profilePhoto;
  Uint8List? profilePhotoBytes;
  String? profilePhotoMime;

  @override
  void initState() {
    super.initState();
    loadCooperatives();
  }

  Future<void> loadCooperatives() async {
    setState(() => loadingCooperatives = true);
    try {
      final value = await Api().cooperatives();
      if (mounted) {
        setState(() => cooperatives = value);
      }
    } catch (_) {
      if (mounted) {
        setState(() => message =
            'No se pudieron cargar las cooperativas. Puedes registrarte como independiente.');
      }
    } finally {
      if (mounted) {
        setState(() => loadingCooperatives = false);
      }
    }
  }

  Future<void> chooseProfilePhoto() async {
    final file = await ImagePicker().pickImage(
        source: ImageSource.gallery,
        imageQuality: 68,
        maxWidth: 1024,
        maxHeight: 1024);
    if (file == null) return;
    final bytes = await file.readAsBytes();
    if (bytes.length > 1200000) {
      setState(() => message = 'La foto no puede superar 1,2 MB.');
      return;
    }
    final mime = supportedImageMime(bytes);
    if (mime == null) {
      setState(() => message = 'Usa una fotografía JPG, JPEG, PNG o WEBP.');
      return;
    }
    setState(() {
      profilePhoto = file;
      profilePhotoBytes = bytes;
      profilePhotoMime = mime;
      message = '';
    });
  }

  @override
  void dispose() {
    for (final controller in [name, email, phone, password, vehicle]) {
      controller.dispose();
    }
    for (final focus in [
      nameFocus,
      emailFocus,
      phoneFocus,
      passwordFocus,
      vehicleFocus
    ]) {
      focus.dispose();
    }
    super.dispose();
  }

  bool validateAndFocus() {
    final valid = formKey.currentState?.validate() ?? false;
    if (!acceptedPolicies) {
      setState(() =>
          message = 'Lee y acepta los Términos y la Política de privacidad.');
      return false;
    }
    if (valid && (role != 'DRIVER' || profilePhotoBytes != null)) return true;
    if (role == 'DRIVER' && profilePhotoBytes == null) {
      setState(() => message =
          'Carga una fotografía frontal y clara para completar el registro.');
      return false;
    }
    final fields = <(TextEditingController, FocusNode)>[
      (name, nameFocus),
      (email, emailFocus),
      (phone, phoneFocus),
      (password, passwordFocus),
      if (role == 'DRIVER') (vehicle, vehicleFocus),
    ];
    final missing = fields.where((item) => item.$1.text.trim().isEmpty);
    if (missing.isNotEmpty) missing.first.$2.requestFocus();
    setState(() => message = 'Completa todos los campos obligatorios.');
    return false;
  }

  Future<void> submit() async {
    if (!validateAndFocus()) return;
    setState(() => busy = true);
    try {
      final d = await Api().register({
        'fullName': name.text.trim(),
        'email': email.text.trim(),
        'phone': phone.text.trim(),
        'password': password.text,
        'role': role,
        if (role == 'DRIVER') 'vehicleIdentifier': vehicle.text.trim(),
        if (role == 'DRIVER')
          'cooperativeId': cooperativeSelection == 'INDIVIDUAL'
              ? null
              : cooperativeSelection,
        if (role == 'DRIVER' && profilePhotoBytes != null)
          'profilePhotoBase64': base64Encode(profilePhotoBytes!),
        if (role == 'DRIVER' && profilePhotoMime != null)
          'profilePhotoMime': profilePhotoMime
      });
      if (!mounted) return;
      if (d['verificationRequired'] == true) {
        Navigator.pushReplacement(
            context,
            MaterialPageRoute(
                builder: (_) => EmailVerificationScreen(
                    email: d['email']?.toString() ?? email.text.trim(),
                    initialMessage: d['message']?.toString())));
      } else if (role == 'PASSENGER' && d['token'] != null) {
        final s = Session(
            d['token'], d['user']['role'], d['user']['name'], d['user']['id']);
        await AppSessionStore.save(s);
        unawaited(Api().registerFcm(s.token));
        if (!mounted) return;
        Navigator.pushReplacement(
            context, MaterialPageRoute(builder: (_) => Passenger(s)));
      } else if (role == 'DRIVER' && d['token'] != null) {
        final s = Session(
            d['token'], d['user']['role'], d['user']['name'], d['user']['id'],
            approvalStatus: d['user']['driverApprovalStatus']);
        await AppSessionStore.save(s);
        unawaited(Api().registerFcm(s.token));
        if (!mounted) return;
        Navigator.pushReplacement(context,
            MaterialPageRoute(builder: (_) => DriverApprovalScreen(s)));
      } else {
        setState(() {
          message = d['message'] ??
              'Registro recibido. Un administrador debe aprobar tu perfil de conductor.';
          submitted = true;
        });
      }
    } catch (e) {
      setState(() => message = e.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext c) => Scaffold(
      appBar: AppBar(title: const Text('Crear cuenta')),
      body: Form(
          key: formKey,
          child: ListView(padding: const EdgeInsets.all(20), children: [
            Text('Todos los campos marcados con * son obligatorios.',
                style: Theme.of(c).textTheme.bodySmall),
            const SizedBox(height: 16),
            TextFormField(
                controller: name,
                focusNode: nameFocus,
                enabled: !submitted,
                textInputAction: TextInputAction.next,
                validator: (value) => value == null || value.trim().length < 3
                    ? 'Ingresa tu nombre completo.'
                    : null,
                decoration:
                    const InputDecoration(labelText: 'Nombre completo *')),
            const SizedBox(height: 14),
            TextFormField(
                controller: email,
                focusNode: emailFocus,
                enabled: !submitted,
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.next,
                validator: (value) {
                  final emailValue = value?.trim() ?? '';
                  return !emailValue.contains('@') || !emailValue.contains('.')
                      ? 'Ingresa un correo válido.'
                      : null;
                },
                decoration: const InputDecoration(labelText: 'Correo *')),
            const SizedBox(height: 14),
            TextFormField(
                controller: phone,
                focusNode: phoneFocus,
                enabled: !submitted,
                keyboardType: TextInputType.phone,
                textInputAction: TextInputAction.next,
                validator: (value) {
                  final digits = (value ?? '').replaceAll(RegExp(r'\D'), '');
                  return digits.length < 9
                      ? 'Ingresa un número de teléfono válido.'
                      : null;
                },
                decoration: const InputDecoration(
                    labelText: 'Teléfono, ej. +593... *')),
            const SizedBox(height: 14),
            TextFormField(
                controller: password,
                focusNode: passwordFocus,
                enabled: !submitted,
                obscureText: true,
                textInputAction: TextInputAction.next,
                onChanged: (_) => setState(() {}),
                validator: strongPasswordError,
                decoration:
                    const InputDecoration(labelText: 'Contraseña segura *')),
            PasswordStrengthIndicator(password: password.text),
            const SizedBox(height: 14),
            DropdownButtonFormField<String>(
                initialValue: role,
                items: const [
                  DropdownMenuItem(value: 'PASSENGER', child: Text('Pasajero')),
                  DropdownMenuItem(value: 'DRIVER', child: Text('Conductor'))
                ],
                onChanged: submitted ? null : (v) => setState(() => role = v!),
                decoration:
                    const InputDecoration(labelText: 'Tipo de cuenta *')),
            if (role == 'DRIVER') ...[
              const SizedBox(height: 14),
              DropdownButtonFormField<String>(
                  initialValue: cooperativeSelection,
                  items: [
                    const DropdownMenuItem<String>(
                        value: 'INDIVIDUAL',
                        child: Text('Conductor independiente')),
                    ...cooperatives.map((item) => DropdownMenuItem<String>(
                        value: item['id']?.toString(),
                        child:
                            Text(item['name']?.toString() ?? 'Cooperativa'))),
                  ],
                  onChanged: submitted || loadingCooperatives
                      ? null
                      : (value) {
                          if (value != null) {
                            setState(() => cooperativeSelection = value);
                          }
                        },
                  decoration: InputDecoration(
                      labelText: 'Cooperativa',
                      helperText: loadingCooperatives
                          ? 'Cargando cooperativas…'
                          : 'Selecciona una cooperativa o continúa como independiente')),
              const SizedBox(height: 14),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(children: [
                    if (profilePhotoBytes != null)
                      ClipOval(
                        child: Image.memory(profilePhotoBytes!,
                            width: 104, height: 104, fit: BoxFit.cover),
                      )
                    else
                      const CircleAvatar(
                          radius: 52,
                          child: Icon(Icons.person_outline, size: 48)),
                    const SizedBox(height: 10),
                    const Text(
                        'Fotografía frontal, clara y con el rostro visible *',
                        textAlign: TextAlign.center),
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      onPressed: submitted ? null : chooseProfilePhoto,
                      icon: const Icon(Icons.add_a_photo_outlined),
                      label: Text(profilePhotoBytes == null
                          ? 'Seleccionar fotografía'
                          : 'Cambiar fotografía'),
                    ),
                  ]),
                ),
              ),
              const SizedBox(height: 14),
              TextFormField(
                  controller: vehicle,
                  focusNode: vehicleFocus,
                  enabled: !submitted,
                  textCapitalization: TextCapitalization.characters,
                  validator: (value) => value == null || value.trim().isEmpty
                      ? 'Ingresa la placa o identificador de la mototaxi.'
                      : null,
                  decoration: const InputDecoration(
                      labelText: 'Placa o identificador de mototaxi *')),
            ],
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: acceptedPolicies,
              onChanged: submitted
                  ? null
                  : (value) => setState(() => acceptedPolicies = value == true),
              title: const Text(
                  'He leído la Política de privacidad y acepto crear mi cuenta'),
              subtitle: Wrap(children: [
                const Text('Consulta cómo Costa-Go usa y protege tus datos. '),
                InkWell(
                  onTap: () => openExternalPage(c, privacyPolicyUrl),
                  child: Text('Leer política',
                      style: TextStyle(
                          color: Theme.of(c).colorScheme.primary,
                          decoration: TextDecoration.underline)),
                ),
              ]),
              controlAffinity: ListTileControlAffinity.leading,
            ),
            if (message.isNotEmpty)
              Padding(padding: const EdgeInsets.all(12), child: Text(message)),
            if (submitted)
              OutlinedButton.icon(
                  onPressed: () =>
                      Navigator.of(c).popUntil((route) => route.isFirst),
                  icon: const Icon(Icons.home_outlined),
                  label: const Text('Volver al inicio'))
            else
              FilledButton(
                  onPressed: busy ? null : submit,
                  child: Text(busy ? 'Registrando…' : 'Crear cuenta'))
          ])));
}

class Profile extends StatefulWidget {
  const Profile(this.s, {super.key});
  final Session s;
  @override
  State<Profile> createState() => _ProfileState();
}

class _ProfileState extends State<Profile> {
  dynamic p;
  String? profileError;
  bool biometricEnabled = false;
  bool photoBusy = false;
  bool pushTestBusy = false;
  @override
  void initState() {
    super.initState();
    loadProfile();
    BiometricSessionStore.saved().then((value) {
      if (mounted) setState(() => biometricEnabled = value?.id == widget.s.id);
    });
  }

  Future<void> loadProfile() async {
    if (mounted) setState(() => profileError = null);
    try {
      final value = await Api().profile(widget.s.token);
      if (mounted) setState(() => p = value);
    } catch (error) {
      if (mounted) setState(() => profileError = error.toString());
    }
  }

  Future<void> toggleBiometric(bool enabled) async {
    try {
      if (enabled) {
        final ok = await BiometricSessionStore.authenticate();
        if (!ok) return;
        final credential = await Api().enrollBiometric(widget.s.token);
        await BiometricSessionStore.enable(widget.s, credential);
      } else {
        await Api().disableBiometric(widget.s.token);
        await BiometricSessionStore.clear();
      }
      if (mounted) setState(() => biometricEnabled = enabled);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(BiometricSessionStore.errorMessage(error))));
      }
    }
  }

  Future<void> changePhoto() async {
    final file = await ImagePicker().pickImage(
        source: ImageSource.gallery,
        imageQuality: 68,
        maxWidth: 1024,
        maxHeight: 1024);
    if (file == null) return;
    final bytes = await file.readAsBytes();
    final mime = supportedImageMime(bytes);
    if (bytes.length > 1200000 || mime == null) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Usa JPG, JPEG, PNG o WEBP de maximo 1,2 MB.')));
      }
      return;
    }
    setState(() => photoBusy = true);
    try {
      await Api().updateProfilePhoto(widget.s.token, base64Encode(bytes), mime);
      if (mounted) {
        setState(() {
          p = Map<String, dynamic>.from(p as Map)
            ..['hasPhoto'] = true
            ..['photoUpdatedAt'] = DateTime.now().toUtc().toIso8601String();
        });
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Fotografía actualizada.')));
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.toString())));
      }
    } finally {
      if (mounted) setState(() => photoBusy = false);
    }
  }

  Future<void> testBackgroundNotification() async {
    setState(() => pushTestBusy = true);
    try {
      final registered = await Api().registerFcm(widget.s.token);
      if (!registered) {
        throw ApiException(lastFcmRegistrationMessage ??
            'La app no pudo registrar este teléfono en Firebase.');
      }
      await Api().testPush(widget.s.token, delaySeconds: 8);
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Prueba programada'),
          content: const Text(
              'Pulsa Aceptar y deja Costa-Go en segundo plano. La notificación debe llegar en aproximadamente 8 segundos.'),
          actions: [
            FilledButton(
                onPressed: () => Navigator.pop(dialogContext),
                child: const Text('Aceptar'))
          ],
        ),
      );
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.toString())));
      }
    } finally {
      if (mounted) setState(() => pushTestBusy = false);
    }
  }

  @override
  Widget build(BuildContext c) {
    if (p == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Mi perfil')),
        body: Center(
          child: profileError == null
              ? const CircularProgressIndicator()
              : Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    const Icon(Icons.cloud_off_outlined, size: 52),
                    const SizedBox(height: 12),
                    Text(profileError!, textAlign: TextAlign.center),
                    const SizedBox(height: 16),
                    FilledButton.icon(
                      onPressed: loadProfile,
                      icon: const Icon(Icons.refresh),
                      label: const Text('Reintentar'),
                    ),
                  ]),
                ),
        ),
      );
    }
    final rs = p['reviews'] as List;
    final hasPhoto = p['hasPhoto'] == true;
    final photoVersion = p['photoUpdatedAt']?.toString() ?? 'profile';
    final photoUrl =
        '$base/v1/users/${widget.s.id}/profile-photo?v=${Uri.encodeQueryComponent(photoVersion)}';
    return Scaffold(
        appBar: AppBar(title: const Text('Mi perfil')),
        body: ListView(padding: const EdgeInsets.all(16), children: [
          Container(
            padding: const EdgeInsets.all(22),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                  colors: [Color(0xff032b49), Color(0xff087ccb)]),
              borderRadius: BorderRadius.circular(26),
            ),
            child: Column(children: [
              Stack(alignment: Alignment.bottomRight, children: [
                ClipOval(
                  child: SizedBox(
                    width: 92,
                    height: 92,
                    child: hasPhoto
                        ? Image.network(
                            photoUrl,
                            headers: {
                              'Authorization': 'Bearer ${widget.s.token}'
                            },
                            fit: BoxFit.cover,
                            errorBuilder: (_, __, ___) => Center(
                              child: Text(p['name'].substring(0, 1),
                                  style: const TextStyle(fontSize: 30)),
                            ),
                          )
                        : Center(
                            child: Text(p['name'].substring(0, 1),
                                style: const TextStyle(fontSize: 30)),
                          ),
                  ),
                ),
                Material(
                  color: Colors.white,
                  shape: const CircleBorder(),
                  child: IconButton(
                    tooltip: 'Cambiar fotografía',
                    onPressed: photoBusy ? null : changePhoto,
                    icon: photoBusy
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.camera_alt_outlined,
                            color: Color(0xff087ccb)),
                  ),
                ),
              ]),
              const SizedBox(height: 12),
              Text(p['name'],
                  textAlign: TextAlign.center,
                  style: Theme.of(c).textTheme.headlineSmall?.copyWith(
                      color: Colors.white, fontWeight: FontWeight.w800)),
              Text(p['role'] == 'DRIVER' ? 'Conductor verificado' : 'Pasajero',
                  style: const TextStyle(color: Colors.white70)),
            ]),
          ),
          const SizedBox(height: 14),
          Card(
            child: Column(children: [
              ListTile(
                  leading: const Icon(Icons.alternate_email),
                  title: const Text('Correo electrónico'),
                  subtitle: Text(p['email'] ?? 'Sin correo registrado')),
              const Divider(height: 1),
              ListTile(
                  leading: const Icon(Icons.phone_outlined),
                  title: const Text('Teléfono'),
                  subtitle: Text(p['phone'] ?? 'Sin teléfono registrado')),
              if (p['vehicle'] != null) ...[
                const Divider(height: 1),
                ListTile(
                    leading: const Icon(Icons.electric_rickshaw_outlined),
                    title: const Text('Mototaxi'),
                    subtitle: Text(p['vehicle'])),
              ],
            ]),
          ),
          Card(
              child: ListTile(
            leading: const Icon(Icons.directions_bike_outlined),
            title: const Text('Mis viajes'),
            subtitle: const Text('Viajes en curso e historial'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () async {
              final repeat = await Navigator.push<TripRepeatDraft>(
                  c, MaterialPageRoute(builder: (_) => TripsPanel(widget.s)));
              if (repeat != null && c.mounted) Navigator.pop(c, repeat);
            },
          )),
          Card(
              child: ListTile(
                  leading: const Icon(Icons.star, color: Colors.amber),
                  title:
                      Text('${(p['rating'] as num).toStringAsFixed(1)} de 5'),
                  subtitle: Text('${p['ratingCount']} calificaciones'))),
          Card(
            child: Column(children: [
              SwitchListTile(
                secondary: const Icon(Icons.fingerprint),
                title: const Text('Ingreso biométrico'),
                subtitle: const Text('Usar huella o reconocimiento facial'),
                value: biometricEnabled,
                onChanged: toggleBiometric,
              ),
              const Divider(height: 1),
              ListTile(
                leading: const Icon(Icons.password_outlined),
                title: const Text('Cambiar contraseña'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.push(
                    c,
                    MaterialPageRoute(
                        builder: (_) => ChangePassword(widget.s))),
              ),
              const Divider(height: 1),
              ListTile(
                leading: const Icon(Icons.notifications_active_outlined),
                title: const Text('Probar notificaciones'),
                subtitle: const Text('Comprueba la recepción en segundo plano'),
                trailing: pushTestBusy
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.chevron_right),
                onTap: pushTestBusy ? null : testBackgroundNotification,
              ),
              if (widget.s.role == 'DRIVER') ...[
                const Divider(height: 1),
                ListTile(
                  leading: const Icon(Icons.badge_outlined),
                  title: const Text('Documentos habilitantes'),
                  subtitle: const Text('Foto, licencia, matrícula y permiso'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () async {
                    await Navigator.push(
                        c,
                        MaterialPageRoute(
                            builder: (_) => DriverDocumentsScreen(widget.s)));
                    final value = await Api().profile(widget.s.token);
                    if (mounted) setState(() => p = value);
                  },
                ),
              ],
            ]),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 12, 4, 6),
            child: Text('Comentarios recibidos',
                style: Theme.of(c)
                    .textTheme
                    .titleMedium
                    ?.copyWith(fontWeight: FontWeight.w800)),
          ),
          ...rs.map((r) => Card(
              child: ListTile(
                  title: Text(r['comment']?.toString().isNotEmpty == true
                      ? r['comment']
                      : 'Sin comentario'),
                  subtitle: Text(
                      '${r['author']} · ${(r['tags'] as List).join(' · ')}'),
                  trailing: Text('★ ${r['score']}'))))
        ]));
  }
}

class ChangePassword extends StatefulWidget {
  const ChangePassword(this.session, {super.key});
  final Session session;
  @override
  State<ChangePassword> createState() => _ChangePasswordState();
}

class _ChangePasswordState extends State<ChangePassword> {
  final current = TextEditingController();
  final password = TextEditingController();
  final confirmation = TextEditingController();
  bool busy = false;
  bool hidden = true;
  String? message;

  @override
  void dispose() {
    current.dispose();
    password.dispose();
    confirmation.dispose();
    super.dispose();
  }

  Future<void> save() async {
    final validationError = strongPasswordError(password.text);
    if (validationError != null) {
      setState(() => message = validationError);
      return;
    }
    if (password.text != confirmation.text) {
      setState(() => message = 'Las contraseñas nuevas no coinciden.');
      return;
    }
    setState(() {
      busy = true;
      message = null;
    });
    try {
      await Api().changePassword(widget.session.token, password.text,
          currentPassword: current.text);
      await BiometricSessionStore.clear();
      if (!mounted) return;
      await showDialog<void>(
          context: context,
          builder: (dialogContext) => AlertDialog(
                icon: const Icon(Icons.check_circle_outline),
                title: const Text('Contraseña actualizada'),
                content: const Text(
                    'Por seguridad, vuelve a activar el ingreso biométrico desde tu perfil.'),
                actions: [
                  FilledButton(
                      onPressed: () => Navigator.pop(dialogContext),
                      child: const Text('Entendido'))
                ],
              ));
      if (mounted) Navigator.pop(context);
    } catch (error) {
      if (mounted) setState(() => message = error.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Cambiar contraseña')),
        body: ListView(padding: const EdgeInsets.all(20), children: [
          const Icon(Icons.lock_reset_outlined, size: 62),
          const SizedBox(height: 14),
          TextField(
              controller: current,
              obscureText: hidden,
              decoration: const InputDecoration(
                  labelText: 'Contraseña actual',
                  prefixIcon: Icon(Icons.lock_outline))),
          const SizedBox(height: 14),
          TextField(
              controller: password,
              obscureText: hidden,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(
                  labelText: 'Nueva contraseña',
                  prefixIcon: Icon(Icons.password_outlined))),
          PasswordStrengthIndicator(password: password.text),
          const SizedBox(height: 14),
          TextField(
              controller: confirmation,
              obscureText: hidden,
              decoration: InputDecoration(
                  labelText: 'Confirmar nueva contraseña',
                  prefixIcon: const Icon(Icons.password_outlined),
                  suffixIcon: IconButton(
                      onPressed: () => setState(() => hidden = !hidden),
                      icon: Icon(hidden
                          ? Icons.visibility_outlined
                          : Icons.visibility_off_outlined)))),
          if (message != null)
            Padding(
                padding: const EdgeInsets.all(12),
                child: Text(message!,
                    style:
                        TextStyle(color: Theme.of(context).colorScheme.error))),
          FilledButton.icon(
              onPressed: busy ? null : save,
              icon: const Icon(Icons.save_outlined),
              label: Text(busy ? 'Guardando…' : 'Actualizar contraseña')),
        ]),
      );
}

class DriverApprovalScreen extends StatefulWidget {
  const DriverApprovalScreen(this.session, {super.key});
  final Session session;
  @override
  State<DriverApprovalScreen> createState() => _DriverApprovalScreenState();
}

class _DriverApprovalScreenState extends State<DriverApprovalScreen> {
  dynamic profile;
  String? error;
  bool loading = true;
  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final value = await Api().profile(widget.session.token);
      if (mounted) setState(() => profile = value);
      if (mounted && value?['approvalStatus'] == 'APROBADO') {
        final approved = Session(widget.session.token, widget.session.role,
            widget.session.name, widget.session.id,
            approvalStatus: 'APROBADO',
            availableRoles: widget.session.availableRoles);
        await AppSessionStore.save(approved);
        if (!mounted) return;
        Navigator.pushReplacement(
            context, MaterialPageRoute(builder: (_) => Driver(approved)));
      }
    } catch (reason) {
      if (mounted) setState(() => error = reason.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> logout() async {
    try {
      await Api().logout(widget.session.token);
    } catch (_) {}
    await clearLocalSession(preserveBiometric: true);
    if (!mounted) return;
    Navigator.pushAndRemoveUntil(context,
        MaterialPageRoute(builder: (_) => const Welcome()), (_) => false);
  }

  Future<void> usePassengerMode() async {
    try {
      final session = await Api().switchRole(widget.session.token, 'PASSENGER');
      await AppSessionStore.save(session);
      await refreshBiometricSessionIfEnabled(session);
      unawaited(Api().registerFcm(session.token));
      if (!mounted) return;
      Navigator.pushAndRemoveUntil(context,
          MaterialPageRoute(builder: (_) => Passenger(session)), (_) => false);
    } catch (reason) {
      if (mounted) setState(() => error = reason.toString());
    }
  }

  String statusText(String? value) =>
      const {
        'PENDIENTE_DOCUMENTOS': 'Completa tus documentos',
        'PENDIENTE_REVISION': 'Documentos enviados para revisión',
        'OBSERVADO': 'Se requieren correcciones',
        'RECHAZADO': 'Solicitud rechazada',
        'SUSPENDIDO': 'Cuenta suspendida',
      }[value] ??
      'Solicitud en proceso';
  @override
  Widget build(BuildContext context) {
    final status =
        profile?['approvalStatus']?.toString() ?? widget.session.approvalStatus;
    return PopScope(
        canPop: false,
        child: Scaffold(
          appBar: AppBar(
              title: const Text('Habilitación de conductor'),
              automaticallyImplyLeading: false),
          body: loading
              ? const Center(child: CircularProgressIndicator())
              : ListView(padding: const EdgeInsets.all(20), children: [
                  Icon(
                      status == 'PENDIENTE_REVISION'
                          ? Icons.hourglass_top
                          : Icons.fact_check_outlined,
                      size: 72,
                      color: Theme.of(context).colorScheme.primary),
                  const SizedBox(height: 16),
                  Text(statusText(status),
                      textAlign: TextAlign.center,
                      style: Theme.of(context)
                          .textTheme
                          .headlineSmall
                          ?.copyWith(fontWeight: FontWeight.w800)),
                  const SizedBox(height: 10),
                  const Text(
                      'Para proteger a pasajeros y conductores, debes cargar y aprobar todos los documentos antes de recibir viajes.',
                      textAlign: TextAlign.center),
                  if (profile?['approvalObservation']?.toString().isNotEmpty ==
                      true)
                    Card(
                        color: Theme.of(context).colorScheme.errorContainer,
                        child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Text(profile['approvalObservation']))),
                  if (error != null)
                    Padding(
                        padding: const EdgeInsets.all(12),
                        child: Text(error!,
                            style: TextStyle(
                                color: Theme.of(context).colorScheme.error))),
                  const SizedBox(height: 20),
                  FilledButton.icon(
                      onPressed: () async {
                        await Navigator.push(
                            context,
                            MaterialPageRoute(
                                builder: (_) =>
                                    DriverDocumentsScreen(widget.session)));
                        await load();
                      },
                      icon: const Icon(Icons.upload_file_outlined),
                      label: const Text('Revisar documentos habilitantes')),
                  OutlinedButton.icon(
                      onPressed: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                              builder: (_) => SupportCenter(widget.session))),
                      icon: const Icon(Icons.support_agent_outlined),
                      label: const Text('Ayuda y soporte')),
                  OutlinedButton.icon(
                      onPressed: load,
                      icon: const Icon(Icons.refresh),
                      label: const Text('Actualizar estado')),
                  if (widget.session.availableRoles.contains('PASSENGER'))
                    OutlinedButton.icon(
                        onPressed: usePassengerMode,
                        icon: const Icon(Icons.person_pin_circle_outlined),
                        label: const Text('Continuar como pasajero')),
                  TextButton(
                      onPressed: logout, child: const Text('Cerrar sesión')),
                ]),
        ));
  }
}

class DriverDocumentsScreen extends StatefulWidget {
  const DriverDocumentsScreen(this.session, {super.key});
  final Session session;
  @override
  State<DriverDocumentsScreen> createState() => _DriverDocumentsScreenState();
}

class _DriverDocumentsScreenState extends State<DriverDocumentsScreen> {
  final picker = ImagePicker();
  List<dynamic>? documents;
  String? busyType;
  String? message;
  static const labels = {
    'PROFILE_PHOTO': ('Foto del conductor', Icons.account_circle_outlined),
    'IDENTIFICATION': (
      'Documento de identificación',
      Icons.contact_page_outlined
    ),
    'LICENSE': ('Licencia de conducir', Icons.badge_outlined),
    'REGISTRATION': ('Matrícula de la mototaxi', Icons.description_outlined),
    'OPERATING_PERMIT': ('Permiso de operación', Icons.verified_outlined),
  };

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final value = await Api().driverDocuments(widget.session.token);
      if (mounted) setState(() => documents = value);
    } catch (error) {
      if (mounted) setState(() => message = error.toString());
    }
  }

  Future<void> upload(String type) async {
    final action = await showModalBottomSheet<String>(
        context: context,
        showDragHandle: true,
        builder: (sheetContext) => SafeArea(
                child: Column(mainAxisSize: MainAxisSize.min, children: [
              ListTile(
                  leading: const Icon(Icons.camera_alt_outlined),
                  title: const Text('Tomar fotografía'),
                  onTap: () => Navigator.pop(sheetContext, 'CAMERA')),
              ListTile(
                  leading: const Icon(Icons.photo_library_outlined),
                  title: const Text('Elegir de galería'),
                  onTap: () => Navigator.pop(sheetContext, 'GALLERY')),
              if (type == 'OPERATING_PERMIT')
                ListTile(
                    leading: const Icon(Icons.attach_file_outlined),
                    title: const Text('Elegir PDF o documento Word'),
                    subtitle: const Text('PDF, DOC o DOCX · máximo 5 MB'),
                    onTap: () => Navigator.pop(sheetContext, 'DOCUMENT')),
            ])));
    if (action == null) return;
    Uint8List bytes;
    String mime;
    if (action == 'DOCUMENT') {
      final selected = await nativeActions
          .invokeMapMethod<String, dynamic>('pickDocument', const {
        'extensions': ['pdf', 'doc', 'docx']
      });
      if (selected == null) return;
      final rawBytes = selected['bytes'];
      if (rawBytes is! Uint8List) {
        setState(() => message = 'No se pudo leer el documento seleccionado.');
        return;
      }
      bytes = rawBytes;
      final name = (selected['name'] as String? ?? '').trim();
      final extension =
          name.contains('.') ? name.split('.').last.toLowerCase() : '';
      mime = (selected['mime'] as String?)?.trim().isNotEmpty == true
          ? (selected['mime'] as String).trim()
          : extension == 'pdf'
              ? 'application/pdf'
              : extension == 'doc'
                  ? 'application/msword'
                  : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      if (bytes.length > 5000000) {
        setState(() => message = 'El documento no puede superar 5 MB.');
        return;
      }
    } else {
      final file = await picker.pickImage(
          source: action == 'CAMERA' ? ImageSource.camera : ImageSource.gallery,
          imageQuality: 72,
          maxWidth: 1400,
          maxHeight: 1400);
      if (file == null) return;
      bytes = await file.readAsBytes();
      final extension = file.name.toLowerCase();
      mime = extension.endsWith('.png')
          ? 'image/png'
          : extension.endsWith('.webp')
              ? 'image/webp'
              : 'image/jpeg';
    }
    setState(() {
      busyType = type;
      message = null;
    });
    try {
      await Api().uploadDriverDocument(
          widget.session.token, type, base64Encode(bytes), mime, '');
      await load();
      if (mounted) setState(() => message = 'Documento enviado para revisión.');
    } catch (error) {
      if (mounted) setState(() => message = error.toString());
    } finally {
      if (mounted) setState(() => busyType = null);
    }
  }

  dynamic document(String type) => documents
      ?.cast<dynamic>()
      .where((item) => item['documentType'] == type)
      .firstOrNull;

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Documentos habilitantes')),
        body: documents == null
            ? const Center(child: CircularProgressIndicator())
            : ListView(padding: const EdgeInsets.all(16), children: [
                Card(
                    child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Row(children: [
                          Icon(Icons.privacy_tip_outlined,
                              color: Theme.of(context).colorScheme.primary),
                          const SizedBox(width: 12),
                          const Expanded(
                              child: Text(
                                  'Carga imágenes claras y completas. El permiso de operación también admite PDF, DOC o DOCX. Cada actualización vuelve a revisión administrativa.')),
                        ]))),
                ...labels.entries.map((entry) {
                  final item = document(entry.key);
                  final status = item?['status']?.toString();
                  return Card(
                      child: ListTile(
                    leading: CircleAvatar(child: Icon(entry.value.$2)),
                    title: Text(entry.value.$1),
                    subtitle: Text(status == null
                        ? 'Pendiente de cargar'
                        : status == 'ACTIVE'
                            ? 'Aprobado'
                            : status == 'REJECTED'
                                ? 'Rechazado: ${item['reviewNote'] ?? ''}'
                                : 'En revisión'),
                    trailing: busyType == entry.key
                        ? const SizedBox(
                            width: 24,
                            height: 24,
                            child: CircularProgressIndicator(strokeWidth: 2))
                        : IconButton(
                            onPressed: () => upload(entry.key),
                            icon: Icon(item == null
                                ? Icons.add_a_photo_outlined
                                : Icons.refresh)),
                  ));
                }),
                if (message != null)
                  Padding(
                      padding: const EdgeInsets.all(12),
                      child: Text(message!, textAlign: TextAlign.center)),
              ]),
      );
}

class DriverEnrollmentScreen extends StatefulWidget {
  const DriverEnrollmentScreen(this.session, {super.key});
  final Session session;
  @override
  State<DriverEnrollmentScreen> createState() => _DriverEnrollmentScreenState();
}

class _DriverEnrollmentScreenState extends State<DriverEnrollmentScreen> {
  final vehicle = TextEditingController();
  List<dynamic> cooperatives = [];
  String cooperative = 'INDIVIDUAL';
  Uint8List? photo;
  String? photoMime;
  bool busy = false;
  String? error;

  @override
  void initState() {
    super.initState();
    Api().cooperatives().then((value) {
      if (mounted) setState(() => cooperatives = value);
    }).catchError((_) {});
  }

  @override
  void dispose() {
    vehicle.dispose();
    super.dispose();
  }

  Future<void> pickPhoto() async {
    final file = await ImagePicker().pickImage(
        source: ImageSource.gallery,
        imageQuality: 68,
        maxWidth: 1024,
        maxHeight: 1024);
    if (file == null) return;
    final bytes = await file.readAsBytes();
    final mime = supportedImageMime(bytes);
    if (bytes.length > 1200000 || mime == null) {
      setState(
          () => error = 'Usa una fotografía JPG, PNG o WEBP de máximo 1,2 MB.');
      return;
    }
    setState(() {
      photo = bytes;
      photoMime = mime;
      error = null;
    });
  }

  Future<void> submit() async {
    if (vehicle.text.trim().length < 3 || photo == null || photoMime == null) {
      setState(() => error =
          'Ingresa la placa y selecciona una fotografía frontal clara.');
      return;
    }
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final session = await Api().enrollDriver(widget.session.token, {
        'vehicleIdentifier': vehicle.text.trim(),
        'cooperativeId': cooperative == 'INDIVIDUAL' ? null : cooperative,
        'profilePhotoBase64': base64Encode(photo!),
        'profilePhotoMime': photoMime,
      });
      await AppSessionStore.save(session);
      await refreshBiometricSessionIfEnabled(session);
      unawaited(Api().registerFcm(session.token));
      if (!mounted) return;
      Navigator.pushAndRemoveUntil(
          context,
          MaterialPageRoute(builder: (_) => DriverApprovalScreen(session)),
          (_) => false);
    } catch (reason) {
      if (mounted) setState(() => error = reason.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: const Text('Quiero conducir')),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        Text('Activa tu perfil de conductor',
            style: Theme.of(context)
                .textTheme
                .headlineSmall
                ?.copyWith(fontWeight: FontWeight.w800)),
        const SizedBox(height: 8),
        const Text(
            'Tu correo, teléfono y contraseña seguirán siendo los mismos. Solo debes completar la información habilitante.'),
        const SizedBox(height: 20),
        DropdownButtonFormField<String>(
            initialValue: cooperative,
            decoration: const InputDecoration(labelText: 'Cooperativa'),
            items: [
              const DropdownMenuItem(
                  value: 'INDIVIDUAL', child: Text('Conductor independiente')),
              ...cooperatives.map((item) => DropdownMenuItem<String>(
                  value: item['id']?.toString(),
                  child: Text(item['name']?.toString() ?? 'Cooperativa')))
            ],
            onChanged: busy
                ? null
                : (value) =>
                    setState(() => cooperative = value ?? 'INDIVIDUAL')),
        const SizedBox(height: 14),
        TextField(
            controller: vehicle,
            textCapitalization: TextCapitalization.characters,
            decoration: const InputDecoration(
                labelText: 'Placa o identificador *',
                prefixIcon: Icon(Icons.badge_outlined))),
        const SizedBox(height: 16),
        Card(
            child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(children: [
                  if (photo != null)
                    ClipOval(
                        child: Image.memory(photo!,
                            width: 112, height: 112, fit: BoxFit.cover))
                  else
                    const CircleAvatar(
                        radius: 56,
                        child: Icon(Icons.person_outline, size: 52)),
                  const SizedBox(height: 10),
                  const Text(
                      'Fotografía frontal, clara y con el rostro visible *',
                      textAlign: TextAlign.center),
                  OutlinedButton.icon(
                      onPressed: busy ? null : pickPhoto,
                      icon: const Icon(Icons.add_a_photo_outlined),
                      label: Text(photo == null
                          ? 'Seleccionar fotografía'
                          : 'Cambiar fotografía')),
                ]))),
        if (error != null)
          Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text(error!,
                  style:
                      TextStyle(color: Theme.of(context).colorScheme.error))),
        FilledButton.icon(
            onPressed: busy ? null : submit,
            icon: const Icon(Icons.send_outlined),
            label: Text(busy ? 'Enviando…' : 'Crear perfil de conductor')),
      ]));
}

class AccountHub extends StatefulWidget {
  const AccountHub(this.s, {super.key});
  final Session s;
  @override
  State<AccountHub> createState() => _AccountHubState();
}

class _AccountHubState extends State<AccountHub> {
  dynamic pending;
  dynamic accountProfile;
  bool biometricEnabled = false;
  bool switchingMode = false;

  @override
  void initState() {
    super.initState();
    Api().pendingRating(widget.s.token).then((v) {
      if (mounted) setState(() => pending = v);
    });
    loadAccountProfile();
    loadBiometricState();
  }

  Future<void> loadAccountProfile() async {
    try {
      final value = await Api().profile(widget.s.token);
      if (mounted) setState(() => accountProfile = value);
    } catch (_) {
      // El encabezado conserva el nombre de la sesión y el avatar predeterminado.
    }
  }

  Widget accountAvatar() {
    final data = accountProfile;
    final name = (data?['name'] ?? widget.s.name).toString();
    final fallback = Container(
      color: Colors.white24,
      alignment: Alignment.center,
      child: Text(name.isEmpty ? '?' : name.substring(0, 1).toUpperCase(),
          style: const TextStyle(
              color: Colors.white, fontSize: 24, fontWeight: FontWeight.w800)),
    );
    if (data?['hasPhoto'] != true) return ClipOval(child: fallback);
    final version = data?['photoUpdatedAt']?.toString() ?? 'profile';
    return ClipOval(
      child: Image.network(
        '$base/v1/users/${widget.s.id}/profile-photo?v=${Uri.encodeQueryComponent(version)}',
        headers: {'Authorization': 'Bearer ${widget.s.token}'},
        width: 58,
        height: 58,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) => fallback,
      ),
    );
  }

  Future<void> loadBiometricState() async {
    final saved = await BiometricSessionStore.saved();
    if (mounted) {
      setState(() => biometricEnabled = saved?.id == widget.s.id);
    }
  }

  Future<void> logout(BuildContext c) async {
    try {
      await Api().logout(widget.s.token);
    } catch (_) {}
    await clearLocalSession(preserveBiometric: true);
    if (sentryDsn.isNotEmpty) {
      await Sentry.configureScope((scope) => scope.setUser(null));
    }
    if (!c.mounted) return;
    Navigator.of(c).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const Welcome()), (_) => false);
  }

  Future<void> switchMode(String role) async {
    setState(() => switchingMode = true);
    try {
      final session = await Api().switchRole(widget.s.token, role);
      await AppSessionStore.save(session);
      await refreshBiometricSessionIfEnabled(session);
      unawaited(Api().registerFcm(session.token));
      if (!mounted) return;
      Navigator.pushAndRemoveUntil(
          context,
          MaterialPageRoute(builder: (_) => homeForSession(session)),
          (_) => false);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.toString())));
      }
    } finally {
      if (mounted) setState(() => switchingMode = false);
    }
  }

  @override
  Widget build(BuildContext c) => Scaffold(
      appBar: AppBar(title: const Text('Mi cuenta')),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
                colors: [Color(0xff032b49), Color(0xff087ccb)]),
            borderRadius: BorderRadius.circular(24),
          ),
          child: Row(children: [
            SizedBox(width: 58, height: 58, child: accountAvatar()),
            const SizedBox(width: 14),
            Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                  Text(widget.s.name,
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 19,
                          fontWeight: FontWeight.w800)),
                  Text(
                      widget.s.role == 'DRIVER'
                          ? 'Conductor Costa-Go'
                          : 'Pasajero Costa-Go',
                      style: const TextStyle(color: Colors.white70)),
                ])),
          ]),
        ),
        const SizedBox(height: 18),
        Text('Gestiona tu cuenta',
            style: Theme.of(c)
                .textTheme
                .titleMedium
                ?.copyWith(fontWeight: FontWeight.w800)),
        const SizedBox(height: 6),
        if (widget.s.availableRoles.contains('DRIVER'))
          ListTile(
              leading: Icon(widget.s.role == 'DRIVER'
                  ? Icons.person_pin_circle_outlined
                  : Icons.directions_bike_outlined),
              title: Text(widget.s.role == 'DRIVER'
                  ? 'Cambiar a modo pasajero'
                  : 'Cambiar a modo conductor'),
              subtitle: const Text('Usa la misma cuenta y conserva tus datos'),
              trailing: switchingMode
                  ? const SizedBox.square(
                      dimension: 22,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.swap_horiz_rounded),
              onTap: switchingMode
                  ? null
                  : () => switchMode(
                      widget.s.role == 'DRIVER' ? 'PASSENGER' : 'DRIVER'))
        else
          ListTile(
              leading: const Icon(Icons.directions_bike_outlined),
              title: const Text('Quiero conducir con Costa-Go'),
              subtitle: const Text('Completa tu perfil sin crear otra cuenta'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.push(
                  context,
                  MaterialPageRoute(
                      builder: (_) => DriverEnrollmentScreen(widget.s)))),
        ListTile(
            leading: const Icon(Icons.person_outline),
            title: const Text('Mi perfil'),
            onTap: () async {
              final repeat = await Navigator.push<TripRepeatDraft>(
                  c, MaterialPageRoute(builder: (_) => Profile(widget.s)));
              if (repeat != null && c.mounted) {
                Navigator.pop(c, repeat);
                return;
              }
              await loadAccountProfile();
              await loadBiometricState();
            }),
        ListTile(
            leading: const Icon(Icons.history_rounded),
            title: const Text('Actividad'),
            subtitle: const Text('Historial de tu actividad'),
            onTap: () => Navigator.push(
                c, MaterialPageRoute(builder: (_) => ActivityPanel(widget.s)))),
        ListTile(
            leading: const Icon(Icons.support_agent_outlined),
            title: const Text('Ayuda y soporte'),
            subtitle: const Text('Preguntas frecuentes y solicitudes de ayuda'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(
                c, MaterialPageRoute(builder: (_) => SupportCenter(widget.s)))),
        ListTile(
            leading: const Icon(Icons.privacy_tip_outlined),
            title: const Text('Privacidad y datos'),
            subtitle: const Text('Ubicación, política y eliminación de cuenta'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(c,
                MaterialPageRoute(builder: (_) => PrivacyAndData(widget.s)))),
        ListTile(
            leading: const Icon(Icons.info_outline),
            title: const Text('Acerca de'),
            onTap: () => Navigator.push(
                c, MaterialPageRoute(builder: (_) => const AboutCostaGo()))),
        if (pending != null)
          Card(
              child: ListTile(
                  leading: const Icon(Icons.star, color: Colors.amber),
                  title: const Text('Tienes una calificación pendiente'),
                  subtitle: Text(pending['driverName'] ??
                      pending['passengerName'] ??
                      'Viaje completado'),
                  onTap: () => rating(c, widget.s, pending['tripId'],
                      () => setState(() => pending = null)))),
        const Divider(),
        ListTile(
            leading: const Icon(Icons.logout, color: Colors.red),
            title: const Text('Cerrar sesión'),
            subtitle: biometricEnabled
                ? const Text('Podrás volver a ingresar con biometría')
                : null,
            onTap: () => logout(c))
      ]));
}

class PrivacyAndData extends StatelessWidget {
  const PrivacyAndData(this.session, {super.key});
  final Session session;

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Privacidad y datos')),
        body: ListView(padding: const EdgeInsets.all(20), children: [
          const Icon(Icons.shield_outlined, size: 68),
          const SizedBox(height: 12),
          Text('Tu información, bajo tu control',
              textAlign: TextAlign.center,
              style: Theme.of(context)
                  .textTheme
                  .headlineSmall
                  ?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 20),
          const Card(
            child: ListTile(
              leading: Icon(Icons.location_on_outlined),
              title: Text('Uso de ubicación'),
              subtitle: Text(
                  'La ubicación permite elegir el punto de recogida, encontrar unidades cercanas y mantener el seguimiento del viaje. Para el conductor puede continuar en segundo plano durante la disponibilidad o un viaje activo.'),
            ),
          ),
          Card(
            child: ListTile(
              leading: const Icon(Icons.policy_outlined),
              title: const Text('Política de privacidad'),
              subtitle: const Text(
                  'Consulta qué datos se recopilan, para qué se usan y cuánto tiempo se conservan.'),
              trailing: const Icon(Icons.open_in_new),
              onTap: () => openExternalPage(context, privacyPolicyUrl),
            ),
          ),
          Card(
            child: ListTile(
              leading: const Icon(Icons.public_outlined),
              title: const Text('Solicitud desde la web'),
              subtitle: const Text(
                  'La eliminación también puede solicitarse sin ingresar a la aplicación.'),
              trailing: const Icon(Icons.open_in_new),
              onTap: () => openExternalPage(context, accountDeletionUrl),
            ),
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(foregroundColor: Colors.red),
            onPressed: () => Navigator.push(context,
                MaterialPageRoute(builder: (_) => DeleteAccount(session))),
            icon: const Icon(Icons.delete_forever_outlined),
            label: const Text('Eliminar mi cuenta'),
          ),
        ]),
      );
}

class DeleteAccount extends StatefulWidget {
  const DeleteAccount(this.session, {super.key});
  final Session session;
  @override
  State<DeleteAccount> createState() => _DeleteAccountState();
}

class _DeleteAccountState extends State<DeleteAccount> {
  final password = TextEditingController();
  bool confirmed = false, busy = false, hidden = true;
  String? message;

  @override
  void dispose() {
    password.dispose();
    super.dispose();
  }

  Future<void> remove() async {
    if (!confirmed || password.text.length < 8) {
      setState(() => message = 'Confirma la decisión e ingresa tu contraseña.');
      return;
    }
    final proceed = await showDialog<bool>(
            context: context,
            builder: (dialogContext) => AlertDialog(
                  icon: const Icon(Icons.warning_amber_rounded,
                      color: Colors.red),
                  title: const Text('¿Eliminar definitivamente?'),
                  content: const Text(
                      'Perderás el acceso, tus datos personales y el historial visible en la app. Esta acción no se puede deshacer.'),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(dialogContext, false),
                        child: const Text('Cancelar')),
                    FilledButton(
                        onPressed: () => Navigator.pop(dialogContext, true),
                        child: const Text('Eliminar')),
                  ],
                )) ??
        false;
    if (!proceed) return;
    setState(() {
      busy = true;
      message = null;
    });
    try {
      await Api().deleteAccount(widget.session.token, password.text);
      await clearLocalSession();
      await BiometricSessionStore.clear();
      if (sentryDsn.isNotEmpty) {
        await Sentry.configureScope((scope) => scope.setUser(null));
      }
      if (!mounted) return;
      Navigator.of(context).pushAndRemoveUntil(
          MaterialPageRoute(builder: (_) => const Welcome()), (_) => false);
    } catch (error) {
      if (mounted) setState(() => message = error.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Eliminar mi cuenta')),
        body: ListView(padding: const EdgeInsets.all(20), children: [
          const Icon(Icons.delete_forever_outlined,
              color: Colors.red, size: 68),
          const SizedBox(height: 12),
          const Text(
              'Se eliminarán tus datos personales, fotos, documentos, favoritos, mensajes, tokens y ubicaciones precisas. Los registros mínimos que deban conservarse por seguridad, fraude o cumplimiento quedarán anonimizados.'),
          const SizedBox(height: 18),
          TextField(
              controller: password,
              obscureText: hidden,
              decoration: InputDecoration(
                  labelText: 'Contraseña actual',
                  prefixIcon: const Icon(Icons.lock_outline),
                  suffixIcon: IconButton(
                      onPressed: () => setState(() => hidden = !hidden),
                      icon: Icon(hidden
                          ? Icons.visibility_outlined
                          : Icons.visibility_off_outlined)))),
          const SizedBox(height: 12),
          CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: confirmed,
              onChanged: busy
                  ? null
                  : (value) => setState(() => confirmed = value == true),
              title: const Text('Entiendo que esta acción es permanente')),
          if (message != null)
            Padding(
                padding: const EdgeInsets.all(12),
                child: Text(message!,
                    textAlign: TextAlign.center,
                    style:
                        TextStyle(color: Theme.of(context).colorScheme.error))),
          FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: Colors.red),
              onPressed: busy ? null : remove,
              icon: const Icon(Icons.delete_forever_outlined),
              label: Text(busy ? 'Eliminando…' : 'Eliminar definitivamente')),
        ]),
      );
}

const supportCategoryLabels = <String, String>{
  'CONTACT': 'Contacto con conductor o pasajero',
  'TRIP': 'Problemas con un viaje',
  'LOST_ITEM': 'Objetos olvidados',
  'PAYMENT': 'Problemas con el pago',
  'SAFETY': 'Problemas de seguridad',
  'APP': 'Problemas con la aplicación',
  'OTHER': 'Otro motivo',
};

String supportStatusLabel(String value) =>
    const {
      'NUEVO': 'Nuevo',
      'ASIGNADO': 'Asignado',
      'EN_REVISION': 'En revisión',
      'ESPERANDO_USUARIO': 'Esperando tu respuesta',
      'RESUELTO': 'Resuelto',
      'CERRADO': 'Cerrado',
    }[value] ??
    value.replaceAll('_', ' ');

class SupportCenter extends StatefulWidget {
  const SupportCenter(this.session, {super.key});
  final Session session;
  @override
  State<SupportCenter> createState() => _SupportCenterState();
}

class _SupportCenterState extends State<SupportCenter> {
  final search = TextEditingController();
  List<dynamic>? faqs;
  List<dynamic>? incidents;
  String whatsapp = '';
  String? error;

  @override
  void initState() {
    super.initState();
    load();
    search.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  Future<void> load() async {
    setState(() => error = null);
    try {
      final values = await Future.wait([
        Api().supportFaqs(widget.session.token),
        Api().supportIncidents(widget.session.token),
        Api().supportConfig(widget.session.token),
      ]);
      if (!mounted) return;
      setState(() {
        faqs = values[0] as List<dynamic>;
        incidents = values[1] as List<dynamic>;
        whatsapp =
            (values[2] as Map<String, dynamic>)['whatsapp']?.toString() ?? '';
      });
    } catch (reason) {
      if (mounted) setState(() => error = reason.toString());
    }
  }

  Future<void> openWhatsapp() async {
    final digits = whatsapp.replaceAll(RegExp(r'[^0-9]'), '');
    if (digits.isEmpty) return;
    final uri = Uri.parse(
        'https://wa.me/$digits?text=${Uri.encodeQueryComponent('Hola, necesito ayuda con Costa-Go.')}');
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication) &&
        mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('No se pudo abrir WhatsApp.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final query = search.text.trim().toLowerCase();
    final visibleFaqs = (faqs ?? []).where((item) {
      if (query.isEmpty) return true;
      return '${item['question']} ${item['answer']} ${item['category']}'
          .toLowerCase()
          .contains(query);
    }).toList();
    return Scaffold(
      appBar: AppBar(title: const Text('Ayuda y soporte')),
      body: RefreshIndicator(
        onRefresh: load,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                  colors: [Color(0xff032b49), Color(0xff087ccb)]),
              borderRadius: BorderRadius.circular(24),
            ),
            child: const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.support_agent, color: Colors.white, size: 38),
                  SizedBox(height: 10),
                  Text('¿Cómo podemos ayudarte?',
                      style: TextStyle(
                          color: Colors.white,
                          fontSize: 22,
                          fontWeight: FontWeight.w800)),
                  SizedBox(height: 4),
                  Text(
                      'Consulta respuestas o crea una solicitud para nuestro equipo.',
                      style: TextStyle(color: Colors.white70)),
                ]),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: search,
            decoration: InputDecoration(
              hintText: 'Buscar en preguntas frecuentes',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: search.text.isEmpty
                  ? null
                  : IconButton(
                      onPressed: search.clear, icon: const Icon(Icons.close)),
            ),
          ),
          if (error != null)
            Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Text(error!,
                    style:
                        TextStyle(color: Theme.of(context).colorScheme.error))),
          const SizedBox(height: 12),
          Text('Preguntas frecuentes',
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.w800)),
          if (faqs == null)
            const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: CircularProgressIndicator()))
          else if (visibleFaqs.isEmpty)
            const Card(
                child: Padding(
                    padding: EdgeInsets.all(18),
                    child: Text(
                        'No encontramos una respuesta. Puedes crear una solicitud de soporte.')))
          else
            ...visibleFaqs.map((faq) {
              final answer = faq['answer']?.toString() ?? '';
              final link = firstWebUrl(answer);
              return Card(
                  child: ExpansionTile(
                leading: const Icon(Icons.help_outline),
                title: Text(faq['question']),
                subtitle: Text(faq['category']),
                children: [
                  Padding(
                      padding: const EdgeInsets.fromLTRB(18, 0, 18, 18),
                      child: Align(
                          alignment: Alignment.centerLeft,
                          child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(answerWithoutWebUrl(answer)),
                                if (link != null) ...[
                                  const SizedBox(height: 10),
                                  OutlinedButton.icon(
                                      onPressed: () async {
                                        if (!await launchUrl(link,
                                                mode: LaunchMode
                                                    .externalApplication) &&
                                            context.mounted) {
                                          ScaffoldMessenger.of(context)
                                              .showSnackBar(const SnackBar(
                                                  content: Text(
                                                      'No se pudo abrir el enlace.')));
                                        }
                                      },
                                      icon: const Icon(Icons.open_in_new),
                                      label: const Text('Consultar tarifario')),
                                ]
                              ])))
                ],
              ));
            }),
          const SizedBox(height: 18),
          FilledButton.icon(
            onPressed: () async {
              final created = await Navigator.push<bool>(
                  context,
                  MaterialPageRoute(
                      builder: (_) => CreateSupportRequest(widget.session)));
              if (created == true) await load();
            },
            icon: const Icon(Icons.add_comment_outlined),
            label: const Text('Crear solicitud de soporte'),
          ),
          if (whatsapp.isNotEmpty)
            OutlinedButton.icon(
                onPressed: openWhatsapp,
                icon: const Icon(Icons.chat_outlined),
                label: const Text('Contactar por WhatsApp')),
          const SizedBox(height: 22),
          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            Text('Mis solicitudes',
                style: Theme.of(context)
                    .textTheme
                    .titleLarge
                    ?.copyWith(fontWeight: FontWeight.w800)),
            IconButton(onPressed: load, icon: const Icon(Icons.refresh)),
          ]),
          if (incidents == null)
            const Padding(
                padding: EdgeInsets.all(20),
                child: Center(child: CircularProgressIndicator()))
          else if (incidents!.isEmpty)
            const Card(
                child: Padding(
                    padding: EdgeInsets.all(18),
                    child: Text('Aún no has creado solicitudes de soporte.')))
          else
            ...incidents!.map((item) => Card(
                    child: ListTile(
                  leading: CircleAvatar(
                      child: Icon(item['priority'] == 'CRITICA'
                          ? Icons.warning_amber
                          : Icons.support_agent_outlined)),
                  title: Text(item['subject']),
                  subtitle: Text(
                      '${supportStatusLabel(item['status'])} · ${supportCategoryLabels[item['category']] ?? item['category']}'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () async {
                    await Navigator.push(
                        context,
                        MaterialPageRoute(
                            builder: (_) => SupportIncidentDetail(
                                widget.session, item['id'])));
                    await load();
                  },
                ))),
        ]),
      ),
    );
  }
}

class CreateSupportRequest extends StatefulWidget {
  const CreateSupportRequest(this.session,
      {super.key, this.initialTripId, this.initialCategory});
  final Session session;
  final String? initialTripId;
  final String? initialCategory;
  @override
  State<CreateSupportRequest> createState() => _CreateSupportRequestState();
}

class _CreateSupportRequestState extends State<CreateSupportRequest> {
  final subject = TextEditingController();
  final description = TextEditingController();
  String category = 'TRIP', priority = 'MEDIA', contact = 'APP', tripId = '';
  List<dynamic>? trips;
  XFile? attachment;
  Uint8List? attachmentBytes;
  String? attachmentMime, message;
  bool busy = false;

  @override
  void initState() {
    super.initState();
    tripId = widget.initialTripId ?? '';
    category = widget.initialCategory ?? 'TRIP';
    Api().trips(widget.session.token).then((value) {
      if (mounted) setState(() => trips = value);
    }).catchError((_) {
      if (mounted) setState(() => trips = []);
    });
  }

  @override
  void dispose() {
    subject.dispose();
    description.dispose();
    super.dispose();
  }

  Future<void> chooseAttachment() async {
    final file = await ImagePicker().pickImage(
        source: ImageSource.gallery,
        imageQuality: 70,
        maxWidth: 1600,
        maxHeight: 1600);
    if (file == null) return;
    final bytes = await file.readAsBytes();
    final mime = supportedImageMime(bytes);
    if (mime == null || bytes.length > 2500000) {
      setState(() => message =
          'La imagen debe ser JPG, PNG o WEBP y pesar máximo 2,5 MB.');
      return;
    }
    setState(() {
      attachment = file;
      attachmentBytes = bytes;
      attachmentMime = mime;
      message = null;
    });
  }

  Future<void> submit() async {
    if (subject.text.trim().length < 5 || description.text.trim().length < 10) {
      setState(() => message =
          'Completa el asunto y describe lo ocurrido con suficiente detalle.');
      return;
    }
    setState(() {
      busy = true;
      message = null;
    });
    try {
      await Api().createSupportIncident(widget.session.token, {
        'category': category,
        'tripId': tripId.isEmpty ? null : tripId,
        'subject': subject.text.trim(),
        'description': description.text.trim(),
        'priority': priority,
        'preferredContact': contact,
        'attachments': attachmentBytes == null
            ? []
            : [
                {
                  'fileName': attachment!.name,
                  'fileMime': attachmentMime,
                  'fileBase64': base64Encode(attachmentBytes!),
                }
              ],
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Solicitud creada correctamente.')));
      Navigator.pop(context, true);
    } catch (reason) {
      if (mounted) setState(() => message = reason.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Nueva solicitud')),
        body: ListView(padding: const EdgeInsets.all(18), children: [
          DropdownButtonFormField<String>(
              initialValue: category,
              decoration: const InputDecoration(labelText: 'Categoría *'),
              items: supportCategoryLabels.entries
                  .map((entry) => DropdownMenuItem(
                      value: entry.key, child: Text(entry.value)))
                  .toList(),
              onChanged: (value) => setState(() => category = value!)),
          const SizedBox(height: 14),
          DropdownButtonFormField<String>(
              initialValue: tripId,
              decoration: const InputDecoration(
                  labelText: 'Viaje relacionado',
                  helperText: 'Opcional; facilita que soporte revise el caso'),
              items: [
                const DropdownMenuItem(
                    value: '', child: Text('Sin viaje relacionado')),
                ...(trips ?? [])
                    .take(30)
                    .where((trip) => supportTripIdentifier(trip).isNotEmpty)
                    .map((trip) => DropdownMenuItem(
                        value: supportTripIdentifier(trip),
                        child: Text(
                            '${trip['originReference'] ?? 'Origen'} → ${trip['destinationReference'] ?? 'Destino'}',
                            overflow: TextOverflow.ellipsis)))
              ],
              onChanged: (value) => setState(() => tripId = value!)),
          const SizedBox(height: 14),
          TextField(
              controller: subject,
              maxLength: 140,
              textInputAction: TextInputAction.next,
              decoration: const InputDecoration(labelText: 'Asunto *')),
          const SizedBox(height: 8),
          TextField(
              controller: description,
              minLines: 4,
              maxLines: 8,
              maxLength: 4000,
              decoration: const InputDecoration(
                  labelText: 'Descripción *',
                  alignLabelWithHint: true,
                  hintText:
                      'Indica qué ocurrió, cuándo y qué ayuda necesitas.')),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(
                child: DropdownButtonFormField<String>(
                    initialValue: priority,
                    decoration: const InputDecoration(labelText: 'Prioridad'),
                    items: const [
                      DropdownMenuItem(value: 'BAJA', child: Text('Baja')),
                      DropdownMenuItem(value: 'MEDIA', child: Text('Media')),
                      DropdownMenuItem(value: 'ALTA', child: Text('Alta')),
                      DropdownMenuItem(value: 'CRITICA', child: Text('Crítica'))
                    ],
                    onChanged: (value) => setState(() => priority = value!))),
            const SizedBox(width: 10),
            Expanded(
                child: DropdownButtonFormField<String>(
                    initialValue: contact,
                    decoration: const InputDecoration(labelText: 'Contacto'),
                    items: const [
                      DropdownMenuItem(value: 'APP', child: Text('Aplicación')),
                      DropdownMenuItem(
                          value: 'TELEFONO', child: Text('Teléfono')),
                      DropdownMenuItem(
                          value: 'WHATSAPP', child: Text('WhatsApp')),
                      DropdownMenuItem(value: 'CORREO', child: Text('Correo'))
                    ],
                    onChanged: (value) => setState(() => contact = value!)))
          ]),
          const SizedBox(height: 14),
          OutlinedButton.icon(
              onPressed: chooseAttachment,
              icon: const Icon(Icons.attach_file),
              label: Text(attachment == null
                  ? 'Adjuntar fotografía'
                  : attachment!.name)),
          if (attachmentBytes != null)
            Padding(
                padding: const EdgeInsets.only(top: 10),
                child: ClipRRect(
                    borderRadius: BorderRadius.circular(14),
                    child: Image.memory(attachmentBytes!,
                        height: 150, fit: BoxFit.cover))),
          if (message != null)
            Padding(
                padding: const EdgeInsets.all(12),
                child: Text(message!,
                    style:
                        TextStyle(color: Theme.of(context).colorScheme.error))),
          const SizedBox(height: 10),
          FilledButton.icon(
              onPressed: busy ? null : submit,
              icon: const Icon(Icons.send_outlined),
              label: Text(busy ? 'Enviando…' : 'Enviar solicitud')),
        ]),
      );
}

class SupportIncidentDetail extends StatefulWidget {
  const SupportIncidentDetail(this.session, this.id, {super.key});
  final Session session;
  final String id;
  @override
  State<SupportIncidentDetail> createState() => _SupportIncidentDetailState();
}

class _SupportIncidentDetailState extends State<SupportIncidentDetail> {
  final response = TextEditingController();
  Map<String, dynamic>? incident;
  String? error;
  bool sending = false;
  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  void dispose() {
    response.dispose();
    super.dispose();
  }

  Future<void> load() async {
    try {
      final value =
          await Api().supportIncident(widget.session.token, widget.id);
      if (mounted) {
        setState(() {
          incident = value;
          error = null;
        });
      }
    } catch (reason) {
      if (mounted) setState(() => error = reason.toString());
    }
  }

  Future<void> send() async {
    if (response.text.trim().isEmpty) return;
    setState(() => sending = true);
    try {
      await Api().sendSupportMessage(
          widget.session.token, widget.id, response.text.trim());
      response.clear();
      await load();
    } catch (reason) {
      if (mounted) setState(() => error = reason.toString());
    } finally {
      if (mounted) setState(() => sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final item = incident;
    final closed =
        item != null && ['RESUELTO', 'CERRADO'].contains(item['status']);
    return Scaffold(
      appBar: AppBar(title: const Text('Detalle de soporte')),
      body: item == null
          ? Center(
              child: error == null
                  ? const CircularProgressIndicator()
                  : Text(error!))
          : Column(children: [
              Expanded(
                  child: ListView(padding: const EdgeInsets.all(16), children: [
                Card(
                    child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(item['subject'],
                                  style: Theme.of(context)
                                      .textTheme
                                      .titleLarge
                                      ?.copyWith(fontWeight: FontWeight.w800)),
                              const SizedBox(height: 6),
                              Text(
                                  '${supportStatusLabel(item['status'])} · ${supportCategoryLabels[item['category']] ?? item['category']}'),
                              if (item['tripId'] != null)
                                Text('Viaje: ${item['tripId']}',
                                    style:
                                        Theme.of(context).textTheme.bodySmall),
                            ]))),
                const SizedBox(height: 10),
                ...(item['messages'] as List<dynamic>).map((message) {
                  final mine = message['authorRole'] == widget.session.role;
                  return Align(
                      alignment:
                          mine ? Alignment.centerRight : Alignment.centerLeft,
                      child: Container(
                          margin: const EdgeInsets.symmetric(vertical: 5),
                          padding: const EdgeInsets.all(12),
                          constraints: const BoxConstraints(maxWidth: 330),
                          decoration: BoxDecoration(
                              color: mine
                                  ? Theme.of(context)
                                      .colorScheme
                                      .primaryContainer
                                  : Theme.of(context)
                                      .colorScheme
                                      .surfaceContainerHighest,
                              borderRadius: BorderRadius.circular(16)),
                          child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(message['body']),
                                const SizedBox(height: 4),
                                Text(
                                    '${message['author']} · ${DateTime.parse(message['createdAt']).toLocal().toString().substring(0, 16)}',
                                    style:
                                        Theme.of(context).textTheme.bodySmall)
                              ])));
                }),
                if ((item['attachments'] as List).isNotEmpty)
                  Card(
                      child: ListTile(
                          leading: const Icon(Icons.attach_file),
                          title: Text(
                              '${(item['attachments'] as List).length} archivo(s) adjunto(s)'),
                          subtitle: const Text(
                              'Los archivos fueron enviados al equipo de soporte.'))),
              ])),
              if (!closed)
                SafeArea(
                    top: false,
                    child: Padding(
                        padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
                        child: Row(children: [
                          Expanded(
                              child: TextField(
                                  controller: response,
                                  minLines: 1,
                                  maxLines: 4,
                                  decoration: const InputDecoration(
                                      hintText: 'Escribe una respuesta'))),
                          const SizedBox(width: 8),
                          IconButton.filled(
                              onPressed: sending ? null : send,
                              icon: sending
                                  ? const SizedBox(
                                      width: 18,
                                      height: 18,
                                      child: CircularProgressIndicator(
                                          strokeWidth: 2))
                                  : const Icon(Icons.send))
                        ]))),
            ]),
    );
  }
}

class AboutCostaGo extends StatelessWidget {
  const AboutCostaGo({super.key});

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: const Color(0xff031a3a),
        extendBodyBehindAppBar: true,
        appBar: AppBar(
          toolbarHeight: 42,
          elevation: 0,
          scrolledUnderElevation: 0,
          backgroundColor: Colors.transparent,
          foregroundColor: Colors.white,
          titleSpacing: 0,
          title: const Text('Acerca de',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
        ),
        body: Container(
          width: double.infinity,
          constraints:
              BoxConstraints(minHeight: MediaQuery.sizeOf(context).height),
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Color(0xff032b49), Color(0xff064f83), Color(0xff03213d)],
            ),
          ),
          child: const SafeArea(
            child: SingleChildScrollView(
              padding: EdgeInsets.fromLTRB(28, 58, 28, 36),
              child: Column(children: [
                CostaGoBrand(),
                SizedBox(height: 28),
                Text('Movilidad que conecta la costa',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                        color: Colors.white,
                        fontSize: 24,
                        fontWeight: FontWeight.w800)),
                SizedBox(height: 12),
                Text(
                  'Costa-Go conecta pasajeros y conductores de mototaxi con una experiencia segura, rápida y cercana. La plataforma se adapta a cada zona de cobertura habilitada y acompaña a las comunidades en sus viajes cotidianos.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                      color: Color(0xffd9f4ff), fontSize: 16, height: 1.5),
                ),
                SizedBox(height: 30),
                Wrap(
                    alignment: WrapAlignment.center,
                    spacing: 12,
                    runSpacing: 12,
                    children: [
                      _AboutPill(
                          icon: Icons.verified_user_outlined,
                          text: 'Viajes seguros'),
                      _AboutPill(
                          icon: Icons.speed_outlined, text: 'Respuesta rápida'),
                      _AboutPill(
                          icon: Icons.people_alt_outlined,
                          text: 'Siempre contigo'),
                    ]),
                SizedBox(height: 42),
                Text('Desarrollado por',
                    style: TextStyle(color: Colors.white70, fontSize: 12)),
                SizedBox(height: 4),
                Text('DFAR SYSTEM',
                    style: TextStyle(
                        color: Colors.white,
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 2)),
              ]),
            ),
          ),
        ),
      );
}

class _AboutPill extends StatelessWidget {
  const _AboutPill({required this.icon, required this.text});
  final IconData icon;
  final String text;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: .1),
          border:
              Border.all(color: const Color(0xff12bdf2).withValues(alpha: .5)),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, color: const Color(0xff12bdf2), size: 19),
          const SizedBox(width: 7),
          Text(text,
              style: const TextStyle(
                  color: Colors.white, fontWeight: FontWeight.w700)),
        ]),
      );
}

class TripsPanel extends StatefulWidget {
  const TripsPanel(this.s, {super.key});
  final Session s;
  @override
  State<TripsPanel> createState() => _TripsPanelState();
}

class _TripsPanelState extends State<TripsPanel> {
  @override
  Widget build(BuildContext c) => PassengerTripsView(widget.s);
}

class ActivityPanel extends StatefulWidget {
  const ActivityPanel(this.s, {super.key});
  final Session s;
  @override
  State<ActivityPanel> createState() => _ActivityPanelState();
}

class _ActivityPanelState extends State<ActivityPanel> {
  @override
  Widget build(BuildContext c) => PassengerActivityView(widget.s);
}

class _CostaGoEmblem extends StatelessWidget {
  const _CostaGoEmblem({this.size = 54});

  final double size;

  @override
  Widget build(BuildContext context) => Container(
        width: size,
        height: size,
        padding: EdgeInsets.all(size * .12),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surface,
          shape: BoxShape.circle,
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: .09),
              blurRadius: 16,
              offset: const Offset(0, 6),
            ),
          ],
        ),
        child: Image.asset('assets/images/costa-go-emblem.png',
            fit: BoxFit.contain),
      );
}

class _PassengerSectionTitle extends StatelessWidget {
  const _PassengerSectionTitle(this.title,
      {this.icon, this.trailing, this.subtitle});

  final String title;
  final IconData? icon;
  final Widget? trailing;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(top: 4, bottom: 8),
      child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
        if (icon != null) ...[
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: scheme.primaryContainer.withValues(alpha: .55),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: scheme.primary, size: 21),
          ),
          const SizedBox(width: 10),
        ],
        Expanded(
          child: RichText(
            text: TextSpan(
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  color: scheme.primary, fontWeight: FontWeight.w800),
              children: [
                TextSpan(text: title),
                if (subtitle != null)
                  TextSpan(
                    text: ' $subtitle',
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: scheme.onSurfaceVariant,
                        fontWeight: FontWeight.w400),
                  ),
              ],
            ),
          ),
        ),
        if (trailing != null) trailing!,
      ]),
    );
  }
}

class _PassengerSurface extends StatelessWidget {
  const _PassengerSurface({required this.child, this.padding, this.color});

  final Widget child;
  final EdgeInsetsGeometry? padding;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: padding ?? const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: color ?? scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: .75)),
      ),
      child: child,
    );
  }
}

class _PassengerMetric extends StatelessWidget {
  const _PassengerMetric(
      {required this.icon, required this.label, required this.value});

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return _PassengerSurface(
      padding: const EdgeInsets.all(14),
      child: Row(children: [
        Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: scheme.primaryContainer.withValues(alpha: .55),
            shape: BoxShape.circle,
          ),
          child: Icon(icon, color: scheme.primary),
        ),
        const SizedBox(width: 12),
        Expanded(
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label,
                style: Theme.of(context).textTheme.labelLarge?.copyWith(
                    color: scheme.primary, fontWeight: FontWeight.w800)),
            const SizedBox(height: 2),
            Text(value, style: Theme.of(context).textTheme.titleMedium),
          ]),
        ),
      ]),
    );
  }
}

class _CostaGoPrimaryButton extends StatelessWidget {
  const _CostaGoPrimaryButton(
      {required this.label, required this.onPressed, this.loading = false});

  final String label;
  final VoidCallback? onPressed;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null && !loading;
    final scheme = Theme.of(context).colorScheme;
    return Opacity(
      opacity: enabled ? 1 : .5,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: enabled ? onPressed : null,
          borderRadius: BorderRadius.circular(20),
          child: Ink(
            height: 58,
            decoration: BoxDecoration(
              gradient: LinearGradient(colors: [
                scheme.primary,
                Color.lerp(scheme.primary, const Color(0xff073f91), .55)!,
              ]),
              borderRadius: BorderRadius.circular(20),
              boxShadow: enabled
                  ? [
                      BoxShadow(
                          color: scheme.primary.withValues(alpha: .22),
                          blurRadius: 14,
                          offset: const Offset(0, 7))
                    ]
                  : null,
            ),
            child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              if (loading)
                const SizedBox.square(
                  dimension: 20,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: Colors.white),
                )
              else
                const _CostaGoEmblem(size: 38),
              const SizedBox(width: 12),
              Text(label,
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      color: Colors.white, fontWeight: FontWeight.w900)),
            ]),
          ),
        ),
      ),
    );
  }
}

Future<TripRepeatDraft?> profile(BuildContext c, Session s) =>
    Navigator.push<TripRepeatDraft>(
        c, MaterialPageRoute(builder: (_) => AccountHub(s)));
Future<void> rating(
    BuildContext c, Session s, String tripId, VoidCallback done) async {
  int score = 0;
  bool submitting = false;
  final note = TextEditingController();
  final tags = <String>{};
  final driverRatesPassenger = s.role == 'DRIVER';

  List<String> optionsForScore() {
    if (driverRatesPassenger) {
      if (score >= 4) {
        return [
          'Puntual',
          'Respetuoso',
          'Buena comunicación',
          'Ubicación clara'
        ];
      }
      if (score == 3) {
        return [
          'Aceptable',
          'Demoró un poco',
          'Comunicación regular',
          'Ubicación confusa'
        ];
      }
      return [
        'No se presentó',
        'Trato inadecuado',
        'Ubicación incorrecta',
        'Conducta inapropiada'
      ];
    }
    if (score >= 4) {
      return ['Puntual', 'Amable', 'Conducción segura', 'Muy buen servicio'];
    }
    if (score == 3) {
      return ['Aceptable', 'Puede mejorar', 'Demoró un poco', 'Ruta regular'];
    }
    return [
      'Impuntual',
      'Trato inadecuado',
      'Conducción insegura',
      'Cobro incorrecto'
    ];
  }

  await showModalBottomSheet(
    context: c,
    isScrollControlled: true,
    isDismissible: false,
    enableDrag: false,
    backgroundColor: Theme.of(c).colorScheme.surface,
    shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(30))),
    builder: (sheet) => StatefulBuilder(builder: (c, set) {
      final options = optionsForScore();
      final scheme = Theme.of(c).colorScheme;
      return SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(
              22, 12, 22, 22 + MediaQuery.of(c).viewInsets.bottom),
          child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: Container(
                    width: 44,
                    height: 5,
                    decoration: BoxDecoration(
                      color: scheme.onSurfaceVariant.withValues(alpha: .3),
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                ),
                const SizedBox(height: 18),
                const Center(child: _CostaGoEmblem(size: 72)),
                const SizedBox(height: 18),
                Text(
                    driverRatesPassenger
                        ? 'Califica al pasajero'
                        : 'Califica al conductor',
                    textAlign: TextAlign.center,
                    style: Theme.of(c)
                        .textTheme
                        .headlineSmall
                        ?.copyWith(fontWeight: FontWeight.w900)),
                const SizedBox(height: 4),
                Text('Para continuar, registra tu calificación.',
                    textAlign: TextAlign.center,
                    style: Theme.of(c)
                        .textTheme
                        .bodyLarge
                        ?.copyWith(color: scheme.onSurfaceVariant)),
                const SizedBox(height: 18),
                Row(
                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                    children: List.generate(
                        5,
                        (i) => IconButton(
                            tooltip: '${i + 1} estrellas',
                            iconSize: 43,
                            onPressed: submitting
                                ? null
                                : () => set(() {
                                      score = i + 1;
                                      tags.clear();
                                    }),
                            icon: Icon(
                                i < score ? Icons.star : Icons.star_border),
                            color: const Color(0xffffa000)))),
                const SizedBox(height: 12),
                Text(
                    score == 0
                        ? 'Selecciona de 1 a 5 estrellas'
                        : score >= 4
                            ? '¿Qué salió bien?'
                            : score == 3
                                ? '¿Qué podría mejorar?'
                                : '¿Qué inconveniente ocurrió?',
                    style: Theme.of(c).textTheme.titleLarge?.copyWith(
                        color: scheme.primary, fontWeight: FontWeight.w900)),
                const SizedBox(height: 10),
                if (score > 0)
                  Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: options
                          .map((x) => FilterChip(
                              label: Text(x),
                              avatar: tags.contains(x)
                                  ? const Icon(Icons.check_circle, size: 18)
                                  : null,
                              selected: tags.contains(x),
                              onSelected: submitting
                                  ? null
                                  : (v) => set(
                                      () => v ? tags.add(x) : tags.remove(x))))
                          .toList()),
                const SizedBox(height: 16),
                TextField(
                    controller: note,
                    enabled: !submitting,
                    maxLines: 3,
                    decoration: const InputDecoration(
                        hintText: 'Comentario opcional',
                        alignLabelWithHint: true)),
                const SizedBox(height: 16),
                _CostaGoPrimaryButton(
                  label: 'Guardar calificación',
                  loading: submitting,
                  onPressed: score == 0 || submitting
                      ? null
                      : () async {
                          set(() => submitting = true);
                          try {
                            await Api().rate(s.token, tripId, score,
                                tags.toList(), note.text);
                            done();
                            if (c.mounted) Navigator.pop(c);
                          } catch (_) {
                            if (c.mounted) set(() => submitting = false);
                          }
                        },
                ),
              ]),
        ),
      );
    }),
  );
  note.dispose();
}

class _PassengerState extends State<Passenger> with WidgetsBindingObserver {
  final api = Api();
  final origin = TextEditingController();
  final destination = TextEditingController();
  final List<PassengerStopDraft> additionalStops = [];
  final notes = TextEditingController();
  final passengerSheetController = DraggableScrollableController();
  late final RealtimeService realtime;
  StreamSubscription<Map<String, dynamic>>? realtimeSubscription;
  StreamSubscription<RemoteMessage>? messageSubscription;
  StreamSubscription<RemoteMessage>? openedMessageSubscription;
  LatLng? pickup;
  LatLng? dropoff;
  int selectedDestinationIndex = 0;
  DateTime? scheduledFor;
  String? editingScheduledTripId;
  LatLng? currentLocation;
  LatLng? mapReferenceLocation;
  LatLng? driverPosition;
  double driverBearing = 0;
  final Map<String, LatLng> nearbyDrivers = {};
  List<dynamic> favoritePlaces = [];
  List<LatLng> routePoints = [];
  MapPointSelection? mapSelection;
  LatLng? pendingMapPoint;
  bool selectionResolving = false;
  bool selectionMoving = false;
  int selectionLookupGeneration = 0;
  final originSelectionGuard = OriginSelectionGuard();
  int routeRequestGeneration = 0;
  dynamic active;
  int people = 1;
  String paymentMethod = 'CASH';
  String? message;
  Timer? timer;
  bool ratingPrompted = false;
  bool passengerChatOpen = false;
  double sheetExtent = .35;
  DateTime? lastRouteAt;
  double? routeDistanceMeters;
  double? routeDurationSeconds;
  int scheduledMinimumNoticeMinutes = 30;
  int scheduledMaximumAdvanceMinutes = 24 * 60;
  ServiceAreaCatalog? serviceAreaCatalog;
  ServiceArea? selectedOriginArea;
  ServiceArea? pendingSelectionArea;
  bool reviewLocationActive = false;
  bool coverageDialogOpen = false;
  bool initialPushHandled = false;
  bool initialLocationLoading = false;
  bool usingProvisionalLocation = false;
  bool requestSubmitting = false;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    realtime = RealtimeService(baseUrl: base, token: widget.s.token);
    realtimeSubscription = realtime.events.listen(handleRealtime);
    realtime.connect();
    unawaited(api.registerFcm(widget.s.token));
    unawaited(UserNotificationStore.instance.refresh(widget.s));
    if (firebaseReady) {
      messageSubscription = FirebaseMessaging.onMessage.listen((push) {
        unawaited(UserNotificationStore.instance.refresh(widget.s));
        final type = push.data['type'];
        if (type == 'CHAT_MESSAGE' && !passengerChatOpen) {
          if (!mounted) return;
          InAppNotificationBanner.show(
            context,
            id: 'chat-${push.data['messageId'] ?? push.data['tripId']}',
            title: push.notification?.title ?? 'Nuevo mensaje del conductor',
            message: push.notification?.body ??
                'Tienes un nuevo mensaje sobre tu viaje.',
            actionLabel: 'Abrir',
            icon: Icons.chat_bubble_outline,
            onTap: () => openPassengerChat(push.data['tripId'],
                notificationId: push.data['internalNotificationId']),
          );
        }
        if (const {
          'TRIP_ASSIGNED',
          'DRIVER_EN_ROUTE',
          'DRIVER_ARRIVED',
          'IN_PROGRESS',
          'COMPLETED',
          'TRIP_CANCELLED'
        }.contains(type)) {
          final status = type == 'TRIP_ASSIGNED' ? 'DRIVER_EN_ROUTE' : type;
          reflectTripStatus(status, push.data['tripId']);
          showPassengerNotification(
            status?.toString() ?? 'TRIP_UPDATE',
            push.data['tripId']?.toString(),
            title: push.notification?.title,
            body: push.notification?.body,
            notificationId: push.data['internalNotificationId'],
          );
          load();
        }
        if (const {
          'SCHEDULED_TRIP_CREATED',
          'SCHEDULED_TRIP_ASSIGNED',
          'SCHEDULED_TRIP_REMINDER',
          'SCHEDULED_TRIP_RELEASED'
        }.contains(type)) {
          if (!mounted) return;
          InAppNotificationBanner.show(
            context,
            id: 'scheduled-${push.data['tripId']}-$type',
            title: push.notification?.title ?? 'Viaje programado',
            message: push.notification?.body ??
                'Hay una actualización en tu viaje programado.',
            actionLabel: 'Ver',
            icon: Icons.event_available_outlined,
            onTap: showScheduledTrips,
          );
          load();
        }
      });
      openedMessageSubscription =
          FirebaseMessaging.onMessageOpenedApp.listen((message) {
        handleOpenedPush(message);
      });
      Future.microtask(restoreInitialPush);
    }
    load();
    unawaited(checkPendingPassengerRating());
    loadSchedulingSettings();
    loadFavoritePlaces();
    loadServiceAreas();
    Future.microtask(initializePassengerLocation);
    timer = Timer.periodic(const Duration(seconds: 15), (_) {
      unawaited(load());
      unawaited(refreshNearbyDrivers());
    });
  }

  Future<void> loadServiceAreas() async {
    final preferences = await SharedPreferences.getInstance();
    final catalogKey = 'serviceAreasCatalog-${widget.s.id}';
    final versionKey = 'serviceAreasVersion-${widget.s.id}';
    final cached = preferences.getString(catalogKey);
    var cachedVersion = preferences.getInt(versionKey);
    try {
      if (cached != null) {
        final stored = Map<String, dynamic>.from(jsonDecode(cached) as Map);
        serviceAreaCatalog = ServiceAreaCatalog.fromJson(stored);
        cachedVersion = serviceAreaCatalog!.version;
      }
      final response = Map<String, dynamic>.from(
          await api.serviceAreas(widget.s.token, cachedVersion) as Map);
      if (!mounted) return;
      if (response['unchanged'] != true) {
        await preferences.setString(catalogKey, jsonEncode(response));
        await preferences.setInt(
            versionKey, (response['version'] as num).toInt());
        serviceAreaCatalog = ServiceAreaCatalog.fromJson(response);
      }
      setState(() {
        selectedOriginArea =
            pickup == null ? null : serviceAreaCatalog?.find(pickup!);
        mapReferenceLocation ??= serviceAreaCatalog?.referenceCenter;
      });
    } catch (error) {
      debugPrint('No se pudo actualizar el catálogo de zonas: $error');
      // El backend mantiene la validación definitiva si la caché no carga.
    }
  }

  Future<void> loadSchedulingSettings() async {
    try {
      final settings = await api.schedulingSettings(widget.s.token);
      if (!mounted) return;
      setState(() {
        scheduledMinimumNoticeMinutes =
            (settings['minimumNoticeMinutes'] as num?)?.toInt() ?? 30;
        scheduledMaximumAdvanceMinutes =
            (settings['maximumAdvanceMinutes'] as num?)?.toInt() ?? 24 * 60;
      });
    } catch (_) {
      // El backend vuelve a validar; se conservan valores seguros por defecto.
    }
  }

  Future<void> togglePassengerReviewLocation() async {
    final area = serviceAreaCatalog?.reviewArea;
    final point = area?.reviewLocation;
    if (area == null || point == null || active != null) return;
    if (reviewLocationActive) {
      setState(() => reviewLocationActive = false);
      await useCurrentLocation(explicit: true);
      return;
    }
    originSelectionGuard.markManualOrigin();
    setState(() {
      reviewLocationActive = true;
      currentLocation = point;
      pickup = point;
      selectedOriginArea = area;
      origin.text = area.reviewLabel ?? '${area.name} · ubicación de revisión';
      message = 'Modo de revisión de Google Play activo.';
      routePoints = [];
    });
    realtime.subscribeNearby(point.latitude, point.longitude);
    unawaited(refreshNearbyDrivers(point));
    try {
      final result = await api.reverse(widget.s.token, point);
      if (!mounted || !reviewLocationActive || pickup != point) return;
      setState(() => origin.text = cleanAddressLabel(result['label'],
          fallback: area.reviewLabel ?? area.name));
    } catch (_) {}
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    timer?.cancel();
    realtimeSubscription?.cancel();
    messageSubscription?.cancel();
    openedMessageSubscription?.cancel();
    realtime.dispose();
    origin.dispose();
    destination.dispose();
    for (final stop in additionalStops) {
      stop.dispose();
    }
    notes.dispose();
    passengerSheetController.dispose();
    super.dispose();
  }

  void _movePassengerSheet(double size) {
    sheetExtent = size;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !passengerSheetController.isAttached) return;
      passengerSheetController.animateTo(
        size.clamp(.18, .92),
        duration: const Duration(milliseconds: 320),
        curve: Curves.easeOutCubic,
      );
    });
  }

  Future<void> showPassengerCoverageError(String code, String message) async {
    if (!mounted || coverageDialogOpen) return;
    coverageDialogOpen = true;
    try {
      await showCoverageErrorDialog(context, code, message);
    } finally {
      coverageDialogOpen = false;
    }
  }

  Future<String> resolveCoverageErrorCode(LatLng point) async {
    try {
      await api.resolveServiceArea(widget.s.token, point);
      return 'OUTSIDE_SERVICE_AREA';
    } on ApiException catch (error) {
      final code = error.code;
      if (code != null && coverageErrorCodes.contains(code)) return code;
      return 'OUTSIDE_SERVICE_AREA';
    } catch (_) {
      return 'OUTSIDE_SERVICE_AREA';
    }
  }

  void clearInvalidDestinationsForCoverage() {
    final catalog = serviceAreaCatalog;
    final originArea =
        selectedOriginArea ?? (pickup == null ? null : catalog?.find(pickup!));
    if (catalog == null || originArea == null) return;

    final invalidIndexes = <int>[];
    for (var index = 0; index < _destinationPoints.length; index++) {
      final point = _destinationPoint(index);
      final area = point == null ? null : catalog.find(point);
      if (area == null || area.id != originArea.id) invalidIndexes.add(index);
    }
    if (invalidIndexes.isEmpty) return;

    setState(() {
      for (final index in invalidIndexes) {
        _destinationController(index).clear();
        _setDestinationPoint(index, null);
      }
      routePoints = [];
      routeDistanceMeters = null;
      routeDurationSeconds = null;
      message = invalidIndexes.length == 1
          ? 'El destino fuera de cobertura fue eliminado.'
          : 'Los destinos fuera de cobertura fueron eliminados.';
    });
    refreshRoute(force: true);
  }

  TextEditingController _destinationController(int index) =>
      index == 0 ? destination : additionalStops[index - 1].controller;

  LatLng? _destinationPoint(int index) =>
      index == 0 ? dropoff : additionalStops[index - 1].point;

  void _setDestinationPoint(int index, LatLng? point) {
    if (index == 0) {
      dropoff = point;
    } else {
      additionalStops[index - 1].point = point;
    }
  }

  List<LatLng> get _destinationPoints => [
        if (dropoff != null) dropoff!,
        ...additionalStops
            .where((stop) => stop.point != null)
            .map((stop) => stop.point!),
      ];

  LatLng? get _finalDestinationPoint =>
      _destinationPoints.isEmpty ? null : _destinationPoints.last;

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      realtime.connect();
      unawaited(api.registerFcm(widget.s.token));
      unawaited(load());
      unawaited(checkPendingPassengerRating());
      unawaited(UserNotificationStore.instance.refresh(widget.s));
    }
  }

  Future<void> checkPendingPassengerRating() async {
    if (ratingPrompted) return;
    try {
      final pending = await api.pendingRating(widget.s.token);
      final tripId = pending?['tripId']?.toString();
      if (!mounted || tripId == null || ratingPrompted) return;
      ratingPrompted = true;
      await rating(context, widget.s, tripId, () {
        if (mounted) setState(() => message = 'Gracias por tu calificación.');
      });
    } catch (_) {
      // Se vuelve a consultar cuando la aplicación regresa al primer plano.
    }
  }

  Future<void> openPassengerTripDetail(String? tripId,
      {String? notificationId}) async {
    if (tripId == null || !mounted) {
      await load();
      return;
    }
    if (notificationId != null) {
      try {
        await api.markNotificationRead(widget.s.token, notificationId);
        await UserNotificationStore.instance.refresh(widget.s);
      } catch (_) {
        // Abrir el viaje tiene prioridad si la confirmación de lectura falla.
      }
    }
    if (!mounted) return;
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => PassengerTripDetail(widget.s, tripId),
      ),
    );
    if (mounted) await load();
  }

  void handleOpenedPush(RemoteMessage push) {
    final target = notificationTargetFor(
        push.data['notificationRoute'] ?? push.data['type']);
    final tripId = push.data['tripId']?.toString();
    if (target == NotificationTarget.chat) {
      unawaited(openPassengerChat(tripId,
          notificationId: push.data['internalNotificationId']));
    } else if (target == NotificationTarget.scheduledTrips) {
      unawaited(showScheduledTrips());
    } else if (const {
      NotificationTarget.activeTrip,
      NotificationTarget.tripDetail,
      NotificationTarget.offers
    }.contains(target)) {
      unawaited(openPassengerTripDetail(tripId,
          notificationId: push.data['internalNotificationId']));
    } else if (target == NotificationTarget.support &&
        push.data['incidentId'] != null) {
      unawaited(Navigator.push(
          context,
          MaterialPageRoute(
              builder: (_) => SupportIncidentDetail(
                  widget.s, push.data['incidentId'].toString()))));
    } else {
      unawaited(Navigator.push(context,
          MaterialPageRoute(builder: (_) => NotificationCenterView(widget.s))));
    }
  }

  Future<void> restoreInitialPush() async {
    if (initialPushHandled) return;
    final push = await FirebaseMessaging.instance.getInitialMessage();
    if (!mounted || push == null) return;
    initialPushHandled = true;
    handleOpenedPush(push);
  }

  void showPassengerNotification(String type, String? tripId,
      {String? title, String? body, String? notificationId}) {
    if (!mounted) return;
    final normalizedType = normalizePassengerTripUpdateType(type);
    final defaults = <String, List<String>>{
      'DRIVER_CANCELLED_REASSIGNING': [
        'Buscando otro conductor',
        'El conductor canceló el traslado. Costa-Go ya está buscando otro conductor.'
      ],
      'DRIVER_EN_ROUTE': [
        'Conductor en camino',
        'Tu conductor se dirige hacia el origen.'
      ],
      'DRIVER_ARRIVED': [
        'Conductor llegó',
        'Tu conductor ya se encuentra en el punto de partida.'
      ],
      'IN_PROGRESS': ['Viaje iniciado', 'Tu viaje está en curso.'],
      'COMPLETED': ['Viaje finalizado', 'El recorrido terminó correctamente.'],
      'TRIP_CANCELLED': [
        'Viaje cancelado',
        'La solicitud ya no se encuentra activa.'
      ],
    };
    final fallback = defaults[normalizedType] ??
        ['Actualización del viaje', 'Hay novedades en tu solicitud.'];
    final cancelled = normalizedType == 'TRIP_CANCELLED';
    final shown = InAppNotificationBanner.show(
      context,
      id: '$normalizedType-${tripId ?? 'active'}',
      title: title ?? fallback[0],
      message: body ??
          (cancelled ? 'Solicitud cancelada correctamente.' : fallback[1]),
      actionLabel: cancelled ? 'Cerrar' : 'Ver',
      onTap: cancelled
          ? null
          : () =>
              openPassengerTripDetail(tripId, notificationId: notificationId),
    );
    if (shown && normalizedType == 'DRIVER_ARRIVED' && !kIsWeb) {
      if (defaultTargetPlatform == TargetPlatform.android) {
        unawaited(nativeActions
            .invokeMethod<void>('playDriverArrivalAlert')
            .catchError((_) {}));
      } else if (defaultTargetPlatform == TargetPlatform.iOS) {
        unawaited(SystemSound.play(SystemSoundType.alert).then((_) async {
          await Future<void>.delayed(const Duration(milliseconds: 280));
          await SystemSound.play(SystemSoundType.alert);
        }));
      }
    }
  }

  void reflectTripStatus(dynamic statusValue, dynamic tripIdValue) {
    final status = statusValue?.toString();
    final tripId = tripIdValue?.toString();
    if (status == null || active == null) return;
    if (tripId != null && active['tripId']?.toString() != tripId) return;
    if (status == 'COMPLETED' || status == 'TRIP_CANCELLED') return;
    setState(() {
      active = {...Map<String, dynamic>.from(active as Map), 'status': status};
      if (status == 'SEARCHING') {
        driverPosition = null;
        driverBearing = 0;
      }
      message = {
        'SEARCHING': 'Buscando otro conductor cercano.',
        'DRIVER_EN_ROUTE':
            '${active['driverName'] ?? 'Tu conductor'} va en camino.',
        'DRIVER_ARRIVED': 'El conductor ya llegó.',
        'IN_PROGRESS': 'Tu viaje está en curso.'
      }[status];
    });
  }

  Future<void> openPassengerChat(String? requestedTripId,
      {String? notificationId}) async {
    ScaffoldMessenger.of(context).hideCurrentSnackBar();
    if (passengerChatOpen) return;
    if (notificationId != null) {
      try {
        await api.markNotificationRead(widget.s.token, notificationId);
        await UserNotificationStore.instance.refresh(widget.s);
      } catch (_) {
        // El chat debe abrir aunque la confirmacion de lectura falle.
      }
    }
    if (active == null) await load();
    if (!mounted) return;
    final tripId = requestedTripId ?? active?['tripId']?.toString();
    if (tripId == null || active?['tripId']?.toString() != tripId) return;
    passengerChatOpen = true;
    try {
      await showTripChat(
        context: context,
        tripId: tripId,
        userId: widget.s.id,
        realtime: realtime,
        loadHistory: () => api.messages(widget.s.token, tripId),
        sendFallback: (clientId, body) =>
            api.sendMessage(widget.s.token, tripId, clientId, body),
      );
    } finally {
      passengerChatOpen = false;
      if (mounted) ScaffoldMessenger.of(context).hideCurrentSnackBar();
    }
  }

  void handleRealtime(Map<String, dynamic> event) {
    if (!mounted) return;
    final type = event['type'];
    if (type == 'connected') {
      final tripId = active?['tripId']?.toString();
      if (tripId != null) {
        realtime.subscribeTrip(tripId);
      } else if (pickup != null) {
        realtime.subscribeNearby(pickup!.latitude, pickup!.longitude);
        unawaited(refreshNearbyDrivers());
      }
      return;
    }
    if (type == 'nearby:snapshot') {
      final items = List<dynamic>.from(event['drivers'] ?? const []);
      setState(() {
        nearbyDrivers
          ..clear()
          ..addEntries(items.map((item) => MapEntry(
                item['driverId'].toString(),
                LatLng((item['latitude'] as num).toDouble(),
                    (item['longitude'] as num).toDouble()),
              )));
      });
      return;
    }
    if (type == 'nearby:update') {
      final item = Map<String, dynamic>.from(event['driver'] as Map);
      setState(() => nearbyDrivers[item['driverId'].toString()] = LatLng(
          (item['latitude'] as num).toDouble(),
          (item['longitude'] as num).toDouble()));
      return;
    }
    if (type == 'nearby:remove') {
      setState(() => nearbyDrivers.remove(event['driverId']?.toString()));
      return;
    }
    if (type == 'driver:location') {
      final item = Map<String, dynamic>.from(event['location'] as Map);
      if (item['tripId']?.toString() != active?['tripId']?.toString()) return;
      setState(() {
        driverPosition = LatLng((item['latitude'] as num).toDouble(),
            (item['longitude'] as num).toDouble());
        driverBearing = (item['bearing'] as num?)?.toDouble() ?? 0;
      });
      refreshRoute();
      return;
    }
    if (type == 'trip:subscribed' && event['liveLocation'] != null) {
      final item = Map<String, dynamic>.from(event['liveLocation'] as Map);
      setState(() {
        driverPosition = LatLng((item['latitude'] as num).toDouble(),
            (item['longitude'] as num).toDouble());
        driverBearing = (item['bearing'] as num?)?.toDouble() ?? 0;
      });
      refreshRoute(force: true);
      return;
    }
    if (type == 'trip:stop-completed') {
      final completed = event['completedStop'] is Map
          ? Map<String, dynamic>.from(event['completedStop'] as Map)
          : <String, dynamic>{};
      final order = (completed['order'] as num?)?.toInt();
      final stopLabel = order == null ? 'Parada' : 'Destino $order';
      setState(() =>
          message = '$stopLabel finalizado. Continuamos al siguiente destino.');
      showPassengerNotification('STOP_COMPLETED', event['tripId']?.toString(),
          title: '$stopLabel finalizado',
          body: 'El viaje continúa hacia el siguiente destino.');
      load();
      return;
    }
    if (type == 'trip:status') {
      unawaited(UserNotificationStore.instance.refresh(widget.s));
      reflectTripStatus(event['status'], event['tripId']);
      showPassengerNotification(event['status']?.toString() ?? 'TRIP_UPDATE',
          event['tripId']?.toString());
      load();
      return;
    }
    if (type == 'chat:message') {
      unawaited(UserNotificationStore.instance.refresh(widget.s));
      if (passengerChatOpen) return;
      final value = Map<String, dynamic>.from(event['message'] as Map);
      InAppNotificationBanner.show(
        context,
        id: 'chat-${value['id'] ?? value['messageId'] ?? value['clientMessageId'] ?? DateTime.now().millisecondsSinceEpoch}',
        title: 'Nuevo mensaje del conductor',
        message: value['body']?.toString() ??
            'Tienes un nuevo mensaje sobre tu viaje.',
        actionLabel: 'Abrir',
        icon: Icons.chat_bubble_outline,
        onTap: () => openPassengerChat(value['tripId']?.toString(),
            notificationId: value['notificationId']?.toString()),
      );
    }
  }

  Future<void> refreshNearbyDrivers([LatLng? focus]) async {
    final point = focus ?? pickup;
    if (point == null || active != null) return;
    try {
      final items = await api.nearbyDrivers(widget.s.token, point);
      if (!mounted || active != null || pickup != point) return;
      setState(() {
        nearbyDrivers
          ..clear()
          ..addEntries(items.map((item) => MapEntry(
                item['driverId'].toString(),
                LatLng((item['latitude'] as num).toDouble(),
                    (item['longitude'] as num).toDouble()),
              )));
      });
    } catch (_) {
      // El WebSocket sigue siendo la fuente principal si falla este respaldo.
    }
  }

  Future<void> resetAfterCompletedTrip() async {
    var point = currentLocation ?? dropoff ?? pickup;
    try {
      final position = await currentGpsPosition(context);
      point = LatLng(position.latitude, position.longitude);
    } catch (_) {
      // Si el GPS falla, el destino del viaje es el mejor punto disponible.
    }
    if (!mounted || active != null || point == null) return;
    setState(() {
      currentLocation = point;
      pickup = point;
      originSelectionGuard.resetToAutomatic();
      dropoff = null;
      origin.text = 'Mi ubicación actual';
      destination.clear();
      for (final stop in additionalStops) {
        stop.dispose();
      }
      additionalStops.clear();
      scheduledFor = null;
      routePoints = [];
      routeDistanceMeters = null;
      routeDurationSeconds = null;
      mapSelection = null;
    });
    realtime.subscribeNearby(point.latitude, point.longitude);
    unawaited(refreshNearbyDrivers(point));
    try {
      final result = await api.reverse(widget.s.token, point);
      if (!mounted || active != null || pickup != point) return;
      setState(() => origin.text =
          cleanAddressLabel(result['label'], fallback: 'Mi ubicación actual'));
    } catch (_) {}
  }

  void applyRepeatDraft(TripRepeatDraft draft) {
    setState(() {
      pickup = draft.origin;
      dropoff = draft.destination;
      origin.text = draft.originLabel;
      destination.text = draft.destinationLabel;
      for (final stop in additionalStops) {
        stop.dispose();
      }
      additionalStops.clear();
      routePoints = [];
      routeDistanceMeters = null;
      routeDurationSeconds = null;
      scheduledFor = null;
      editingScheduledTripId = null;
      message = 'Revisa el viaje anterior y confirma cuando estés listo.';
    });
    _movePassengerSheet(.78);
    unawaited(refreshRoute(force: true));
  }

  Future<void> load() async {
    try {
      final t = active == null
          ? await api.active(widget.s.token)
          : await api.trip(widget.s.token, active['tripId']);
      if (!mounted) return;
      if (t == null) {
        if (active != null) {
          setState(() {
            active = null;
            sheetExtent = .35;
          });
          _movePassengerSheet(.35);
          if (pickup != null) {
            realtime.subscribeNearby(pickup!.latitude, pickup!.longitude);
            unawaited(refreshNearbyDrivers());
          }
        }
        return;
      }
      if (t['status'] == 'COMPLETED') {
        setState(() {
          active = null;
          sheetExtent = .35;
          driverPosition = null;
          routePoints = [];
          message = 'Viaje finalizado.';
        });
        _movePassengerSheet(.35);
        unawaited(resetAfterCompletedTrip());
        if (!ratingPrompted) {
          ratingPrompted = true;
          if (!mounted) return;
          await rating(context, widget.s, t['tripId'],
              () => setState(() => message = 'Gracias por tu calificación.'));
        }
        return;
      }
      if (t['status'] == 'CANCELLED') {
        final administrative = t['cancellationReason'] == 'ADMIN_CANCELLED';
        setState(() {
          active = null;
          sheetExtent = .35;
          driverPosition = null;
          routePoints = [];
          message = administrative
              ? 'El viaje fue cancelado por administración.'
              : 'La solicitud fue cancelada.';
        });
        _movePassengerSheet(.35);
        if (pickup != null) {
          realtime.subscribeNearby(pickup!.latitude, pickup!.longitude);
          unawaited(refreshNearbyDrivers());
        }
        return;
      }
      final previousStatus = active?['status']?.toString();
      setState(() {
        active = t;
        if (previousStatus != t['status']?.toString()) {
          sheetExtent = t['status'] == 'SEARCHING' ? .46 : .35;
        }
        if (t['originLatitude'] != null) {
          pickup = LatLng((t['originLatitude'] as num).toDouble(),
              (t['originLongitude'] as num).toDouble());
          final serverStops = List<dynamic>.from(t['stops'] ?? const []);
          if (serverStops.isNotEmpty) {
            for (final stop in additionalStops) {
              stop.dispose();
            }
            additionalStops.clear();
            final points = serverStops
                .map((stop) => PassengerStopDraft(
                      text: stop['reference']?.toString() ?? 'Destino',
                      point: LatLng((stop['latitude'] as num).toDouble(),
                          (stop['longitude'] as num).toDouble()),
                    ))
                .toList();
            dropoff = points.first.point;
            destination.text = points.first.controller.text;
            for (final stop in points.skip(1)) {
              additionalStops.add(stop);
            }
            points.first.dispose();
          } else {
            dropoff = LatLng((t['destinationLatitude'] as num).toDouble(),
                (t['destinationLongitude'] as num).toDouble());
          }
        }
        if (t['driverLatitude'] != null && t['status'] != 'SEARCHING') {
          driverPosition = LatLng((t['driverLatitude'] as num).toDouble(),
              (t['driverLongitude'] as num).toDouble());
          driverBearing = (t['driverBearing'] as num?)?.toDouble() ?? 0;
        } else {
          driverPosition = null;
          driverBearing = 0;
        }
        nearbyDrivers.clear();
        message = {
          'SEARCHING': 'Buscando conductor cercano.',
          'ASSIGNED': '¡Viaje confirmado! ${t['driverName']} va en camino.',
          'DRIVER_EN_ROUTE': '${t['driverName']} va en camino.',
          'DRIVER_ARRIVED': 'El conductor ya llegó.',
          'IN_PROGRESS': 'Tu viaje está en curso.'
        }[t['status']];
      });
      if (previousStatus != t['status']?.toString()) {
        _movePassengerSheet(t['status'] == 'SEARCHING' ? .50 : .52);
      }
      realtime.subscribeTrip(t['tripId'].toString());
      refreshRoute(force: routePoints.isEmpty);
    } catch (_) {}
  }

  Future<void> useCurrentLocation({bool explicit = true}) async {
    if (active != null) return;
    final gpsRequestRevision = originSelectionGuard.startGpsRequest();
    try {
      final position = await currentGpsPosition(context);
      if (!mounted || active != null) return;
      final point = LatLng(position.latitude, position.longitude);
      final applyAsOrigin = explicit
          ? originSelectionGuard.canApplyExplicitGps(gpsRequestRevision)
          : originSelectionGuard.canApplyAutomaticGps(gpsRequestRevision,
              hasOrigin: pickup != null);
      setState(() {
        currentLocation = point;
        mapReferenceLocation = point;
        usingProvisionalLocation = false;
        if (!applyAsOrigin) return;
        if (explicit) originSelectionGuard.commitExplicitGps();
        pickup = point;
        selectedOriginArea = serviceAreaCatalog?.find(point);
        origin.text = 'Mi ubicación actual';
        message = 'Consultando la dirección de tu ubicación…';
      });
      if (!applyAsOrigin) return;
      if (serviceAreaCatalog != null && selectedOriginArea == null) {
        final code = await resolveCoverageErrorCode(point);
        if (!mounted || pickup != point || active != null) return;
        final coverageMessage = mensajeApi(code);
        setState(() => message = coverageMessage);
        unawaited(showPassengerCoverageError(code, coverageMessage));
        return;
      }
      realtime.subscribeNearby(position.latitude, position.longitude);
      unawaited(refreshNearbyDrivers(point));
      refreshRoute(force: true);
      try {
        final result = await api.reverse(widget.s.token, point);
        if (!mounted || pickup != point || active != null) return;
        setState(() {
          origin.text = cleanAddressLabel(result['label'],
              fallback: 'Mi ubicación actual');
          message = 'Origen actualizado con tu ubicación GPS.';
        });
      } catch (_) {
        if (mounted && pickup == point) {
          setState(() => message =
              'Origen guardado por GPS; no se pudo obtener la dirección escrita.');
        }
      }
    } catch (e) {
      if (mounted) setState(() => message = friendlyLocationFailure(e));
    }
  }

  Future<void> initializePassengerLocation() async {
    if (active != null || initialLocationLoading) return;
    final gpsRequestRevision = originSelectionGuard.startGpsRequest();
    if (mounted) {
      setState(() {
        initialLocationLoading = true;
        message = 'Obteniendo tu ubicación GPS…';
      });
    }
    try {
      await ensureLocationPermission(context);
      final freshPosition = Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
              accuracy: LocationAccuracy.high,
              timeLimit: Duration(seconds: 15)));
      final lastKnown = await Geolocator.getLastKnownPosition();
      if (mounted && active == null && lastKnown != null) {
        final provisional = LatLng(lastKnown.latitude, lastKnown.longitude);
        final usable = isUsableProvisionalLocation(
            timestamp: lastKnown.timestamp, accuracyMeters: lastKnown.accuracy);
        final provisionalArea = serviceAreaCatalog?.find(provisional);
        final applyAsOrigin = usable &&
            (serviceAreaCatalog == null || provisionalArea != null) &&
            originSelectionGuard.canApplyAutomaticGps(gpsRequestRevision,
                hasOrigin: pickup != null);
        setState(() {
          mapReferenceLocation =
              usable ? provisional : serviceAreaCatalog?.referenceCenter;
          if (usable) currentLocation = provisional;
          if (applyAsOrigin) {
            pickup = provisional;
            selectedOriginArea = provisionalArea;
            origin.text = 'Ubicación aproximada';
            usingProvisionalLocation = true;
            message =
                'Mostrando tu última ubicación mientras confirmamos el GPS…';
          }
        });
      }
      final position = await freshPosition;
      if (!mounted || active != null) return;
      final point = LatLng(position.latitude, position.longitude);
      final applyAsOrigin = originSelectionGuard.canApplyAutomaticGps(
          gpsRequestRevision,
          hasOrigin: pickup != null && !usingProvisionalLocation);
      setState(() {
        currentLocation = point;
        mapReferenceLocation = point;
        usingProvisionalLocation = false;
        if (applyAsOrigin) {
          pickup = point;
          selectedOriginArea = serviceAreaCatalog?.find(point);
          origin.text = 'Mi ubicación actual';
          message = 'Ubicación GPS confirmada.';
        }
      });
      if (!applyAsOrigin) return;
      if (serviceAreaCatalog != null && selectedOriginArea == null) {
        final code = await resolveCoverageErrorCode(point);
        if (!mounted || pickup != point || active != null) return;
        final coverageMessage = mensajeApi(code);
        setState(() => message = coverageMessage);
        unawaited(showPassengerCoverageError(code, coverageMessage));
        return;
      }
      realtime.subscribeNearby(point.latitude, point.longitude);
      unawaited(refreshNearbyDrivers(point));
      try {
        final result = await api.reverse(widget.s.token, point);
        if (!mounted || pickup != point || active != null) return;
        setState(() {
          origin.text = cleanAddressLabel(result['label'],
              fallback: 'Mi ubicación actual');
          message = 'Origen actualizado con tu ubicación GPS.';
        });
      } catch (_) {
        if (mounted && pickup == point) {
          setState(() => message =
              'Origen confirmado por GPS; la dirección escrita no está disponible.');
        }
      }
    } on TimeoutException {
      if (mounted) {
        setState(() => message = usingProvisionalLocation
            ? 'Usamos temporalmente tu última ubicación. Pulsa ubicación actual para actualizarla.'
            : 'El GPS está tardando. Puedes elegir el origen en el mapa o volver a intentarlo.');
      }
    } catch (error) {
      if (mounted) setState(() => message = friendlyLocationFailure(error));
    } finally {
      if (mounted) setState(() => initialLocationLoading = false);
    }
  }

  Future<LatLng?> centerPassengerCurrentLocation() async {
    final reviewPoint = reviewLocationActive
        ? serviceAreaCatalog?.reviewArea?.reviewLocation
        : null;
    if (reviewPoint != null) {
      if (mounted) setState(() => currentLocation = reviewPoint);
      return reviewPoint;
    }
    try {
      final position = await currentGpsPosition(context);
      if (!mounted) return null;
      final point = LatLng(position.latitude, position.longitude);
      setState(() => currentLocation = point);
      return point;
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(friendlyLocationFailure(error))));
      }
      return null;
    }
  }

  void clearPoint(bool isOrigin, {int destinationIndex = 0}) {
    if (isOrigin) originSelectionGuard.markManualOrigin();
    setState(() {
      selectedDestinationIndex = destinationIndex;
      mapSelection =
          isOrigin ? MapPointSelection.origin : MapPointSelection.destination;
      pendingMapPoint = currentLocation ?? pickup ?? dropoff;
      selectionResolving = false;
      selectionMoving = false;
      sheetExtent = .24;
      if (isOrigin) {
        origin.clear();
        pickup = null;
        selectedOriginArea = null;
        nearbyDrivers.clear();
      } else {
        _destinationController(destinationIndex).clear();
        _setDestinationPoint(destinationIndex, null);
      }
      routePoints = [];
      routeDistanceMeters = null;
      routeDurationSeconds = null;
      message = isOrigin
          ? 'Mueve el mapa para elegir un nuevo origen.'
          : 'Mueve el mapa para elegir un nuevo destino.';
    });
    _movePassengerSheet(.24);
  }

  void clearDestination(int destinationIndex) {
    setState(() {
      _destinationController(destinationIndex).clear();
      _setDestinationPoint(destinationIndex, null);
      if (mapSelection == MapPointSelection.destination &&
          selectedDestinationIndex == destinationIndex) {
        mapSelection = null;
        pendingMapPoint = null;
        selectionResolving = false;
        selectionMoving = false;
      }
      routePoints = [];
      routeDistanceMeters = null;
      routeDurationSeconds = null;
      message = null;
    });
    unawaited(refreshRoute(force: true));
  }

  void _resetRequestAfterScheduledTrip(String confirmation) {
    for (final stop in additionalStops) {
      stop.dispose();
    }
    additionalStops.clear();
    origin.clear();
    destination.clear();
    notes.clear();
    pickup = null;
    dropoff = null;
    selectedOriginArea = null;
    selectedDestinationIndex = 0;
    scheduledFor = null;
    editingScheduledTripId = null;
    people = 1;
    paymentMethod = 'CASH';
    mapSelection = null;
    pendingMapPoint = null;
    selectionResolving = false;
    selectionMoving = false;
    routePoints = [];
    routeDistanceMeters = null;
    routeDurationSeconds = null;
    nearbyDrivers.clear();
    originSelectionGuard.resetToAutomatic();
    message = confirmation;
    sheetExtent = .35;
  }

  void beginMapSelection(MapPointSelection selection,
      {int destinationIndex = 0}) {
    FocusManager.instance.primaryFocus?.unfocus();
    if (selection == MapPointSelection.origin) {
      // A GPS lookup started during initialization must not win after the
      // passenger enters manual origin selection.
      originSelectionGuard.markManualOrigin();
    }
    setState(() {
      selectedDestinationIndex = destinationIndex;
      mapSelection = selection;
      pendingMapPoint = selection == MapPointSelection.origin
          ? pickup ?? currentLocation
          : _destinationPoint(destinationIndex) ?? pickup ?? currentLocation;
      selectionResolving = false;
      selectionMoving = false;
      sheetExtent = .24;
      message = selection == MapPointSelection.origin
          ? 'Mueve el mapa para ajustar el origen.'
          : 'Mueve el mapa para ajustar el destino.';
    });
    _movePassengerSheet(.24);
  }

  void selectionMovementStarted() {
    if (selectionMoving || !mounted) return;
    selectionLookupGeneration++;
    // Do not rebuild the platform map while Android is dispatching camera
    // gesture events. The settled callback updates the UI with the final
    // coordinate and prevents the initial location from being reused.
    selectionMoving = true;
    pendingMapPoint = null;
    selectionResolving = false;
  }

  void selectionCenterChanged(LatLng point) {
    if (mapSelection == null ||
        !point.latitude.isFinite ||
        !point.longitude.isFinite) {
      return;
    }
    // This assignment intentionally avoids setState while Google Maps is
    // dispatching a gesture. It keeps confirmation tied to the fixed center
    // pin without rebuilding the Android platform view on every frame.
    pendingMapPoint = point;
  }

  void confirmVisibleMapPoint() {
    final point = pendingMapPoint;
    if (point == null) return;
    unawaited(selectMapPoint(point));
  }

  Future<void> previewMapSelection(LatLng point) async {
    final selection = mapSelection;
    if (selection == null ||
        !point.latitude.isFinite ||
        !point.longitude.isFinite) {
      return;
    }
    final generation = ++selectionLookupGeneration;
    final area = serviceAreaCatalog?.find(point);
    setState(() {
      pendingMapPoint = point;
      pendingSelectionArea = area;
      selectionMoving = false;
      selectionResolving = true;
      message = 'Obteniendo la dirección del punto seleccionado…';
    });
    if (serviceAreaCatalog != null && area == null) {
      final code = await resolveCoverageErrorCode(point);
      if (!mounted ||
          generation != selectionLookupGeneration ||
          mapSelection != selection) {
        return;
      }
      setState(() {
        selectionResolving = false;
        message = mensajeApi(code);
      });
      unawaited(showPassengerCoverageError(code, mensajeApi(code)));
      return;
    }
    try {
      final result = await api.reverse(widget.s.token, point);
      if (!mounted ||
          generation != selectionLookupGeneration ||
          mapSelection != selection) {
        return;
      }
      final label =
          cleanAddressLabel(result['label'], fallback: 'Punto seleccionado');
      setState(() {
        if (selection == MapPointSelection.origin) {
          origin.text = label;
        } else {
          _destinationController(selectedDestinationIndex).text = label;
        }
        selectionResolving = false;
        message = 'Dirección encontrada. Puedes confirmar el punto.';
      });
    } catch (_) {
      if (!mounted || generation != selectionLookupGeneration) return;
      setState(() {
        selectionResolving = false;
        message = 'Punto válido. No fue posible obtener la dirección escrita.';
      });
    }
  }

  Future<void> loadFavoritePlaces() async {
    try {
      final places = await api.favoritePlaces(widget.s.token);
      if (mounted) setState(() => favoritePlaces = places);
    } catch (_) {
      // Los favoritos no bloquean la solicitud de un viaje.
    }
  }

  Future<void> saveCurrentPlace(bool isOrigin) async {
    final point = isOrigin ? pickup : dropoff;
    final address = (isOrigin ? origin.text : destination.text).trim();
    if (point == null || address.isEmpty) {
      setState(() =>
          message = 'Primero selecciona la ubicación que deseas guardar.');
      return;
    }
    final controller = TextEditingController(
        text: isOrigin && favoritePlaces.isEmpty ? 'Casa' : '');
    final label = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Guardar lugar favorito'),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLength: 50,
          decoration: const InputDecoration(
              labelText: 'Nombre', hintText: 'Casa, Trabajo, Hotel…'),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Cancelar')),
          FilledButton(
              onPressed: () =>
                  Navigator.pop(dialogContext, controller.text.trim()),
              child: const Text('Guardar')),
        ],
      ),
    );
    controller.dispose();
    if (label == null || label.length < 2) return;
    try {
      await api.saveFavoritePlace(widget.s.token, label, address, point);
      await loadFavoritePlaces();
      if (mounted) setState(() => message = 'Lugar favorito guardado.');
    } catch (error) {
      if (mounted) setState(() => message = error.toString());
    }
  }

  Future<void> useFavorite(dynamic place, bool isOrigin) async {
    final point = LatLng((place['latitude'] as num).toDouble(),
        (place['longitude'] as num).toDouble());
    setState(() {
      mapSelection = null;
      sheetExtent = .35;
      if (isOrigin) {
        originSelectionGuard.markManualOrigin();
        pickup = point;
        selectedOriginArea = serviceAreaCatalog?.find(point);
        origin.text = cleanAddressLabel(place['address']);
      } else {
        dropoff = point;
        destination.text = cleanAddressLabel(place['address']);
      }
      message =
          '${place['label']} seleccionado como ${isOrigin ? 'origen' : 'destino'}.';
    });
    _movePassengerSheet(.35);
    if (isOrigin) {
      realtime.subscribeNearby(point.latitude, point.longitude);
      unawaited(refreshNearbyDrivers(point));
    }
    await refreshRoute(force: true);
  }

  Future<void> showFavoritePlaces() async {
    await loadFavoritePlaces();
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 0, 12, 18),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const ListTile(
              leading: Icon(Icons.star_outline),
              title: Text('Lugares favoritos'),
              subtitle: Text('Úsalos rápidamente como origen o destino.'),
            ),
            if (favoritePlaces.isEmpty)
              const Padding(
                padding: EdgeInsets.all(18),
                child: Text('Todavía no tienes lugares guardados.'),
              ),
            ...favoritePlaces.map((place) => ListTile(
                  leading: const Icon(Icons.place_outlined),
                  title: Text(place['label'].toString()),
                  subtitle: Text(cleanAddressLabel(place['address']),
                      maxLines: 2, overflow: TextOverflow.ellipsis),
                  trailing: PopupMenuButton<String>(
                    onSelected: (value) async {
                      if (value == 'delete') {
                        await api.deleteFavoritePlace(
                            widget.s.token, place['id'].toString());
                        await loadFavoritePlaces();
                        if (sheetContext.mounted) Navigator.pop(sheetContext);
                      } else {
                        Navigator.pop(sheetContext);
                        await useFavorite(place, value == 'origin');
                      }
                    },
                    itemBuilder: (_) => const [
                      PopupMenuItem(
                          value: 'origin', child: Text('Usar como origen')),
                      PopupMenuItem(
                          value: 'destination',
                          child: Text('Usar como destino')),
                      PopupMenuDivider(),
                      PopupMenuItem(value: 'delete', child: Text('Eliminar')),
                    ],
                  ),
                )),
            const Divider(),
            Row(children: [
              Expanded(
                child: TextButton.icon(
                  onPressed: pickup == null
                      ? null
                      : () {
                          Navigator.pop(sheetContext);
                          saveCurrentPlace(true);
                        },
                  icon: const Icon(Icons.home_outlined),
                  label: const Text('Guardar origen'),
                ),
              ),
              Expanded(
                child: TextButton.icon(
                  onPressed: dropoff == null
                      ? null
                      : () {
                          Navigator.pop(sheetContext);
                          saveCurrentPlace(false);
                        },
                  icon: const Icon(Icons.flag_outlined),
                  label: const Text('Guardar destino'),
                ),
              ),
            ]),
          ]),
        ),
      ),
    );
  }

  Future<void> locate(bool isOrigin, {int destinationIndex = 0}) async {
    final field = isOrigin ? origin : _destinationController(destinationIndex);
    if (field.text.trim().length < 3) {
      setState(() => message = 'Escribe al menos tres letras de la dirección.');
      return;
    }
    try {
      setState(() => message = 'Buscando direcciones cercanas...');
      final providerResults =
          await api.search(widget.s.token, field.text, pickup);
      final targetArea = selectedOriginArea ??
          (pickup == null ? null : serviceAreaCatalog?.find(pickup!));
      final results = targetArea == null || serviceAreaCatalog == null
          ? providerResults
          : providerResults.where((result) {
              final latitude = (result['latitude'] as num?)?.toDouble();
              final longitude = (result['longitude'] as num?)?.toDouble();
              if (latitude == null || longitude == null) return false;
              return serviceAreaCatalog!
                      .find(LatLng(latitude, longitude))
                      ?.id ==
                  targetArea.id;
            }).toList();
      if (results.isEmpty) {
        setState(() => message = targetArea == null
            ? 'No se encontraron ubicaciones cercanas.'
            : 'No se encontraron ubicaciones dentro de ${targetArea.name}.');
        return;
      }
      if (!mounted) return;
      final r = await showModalBottomSheet<dynamic>(
          context: context,
          showDragHandle: true,
          builder: (sheetContext) => SafeArea(
                child: ListView(
                  shrinkWrap: true,
                  padding: const EdgeInsets.only(bottom: 12),
                  children: [
                    const ListTile(
                        title: Text('Selecciona una ubicación'),
                        subtitle:
                            Text('Resultados cercanos a tu posición actual')),
                    ...results.map((result) => ListTile(
                          leading: const Icon(Icons.location_on_outlined),
                          title: Text(cleanAddressLabel(result['label'])),
                          onTap: () => Navigator.pop(sheetContext, result),
                        ))
                  ],
                ),
              ));
      if (r == null || !mounted) {
        setState(() => message = null);
        return;
      }
      setState(() {
        mapSelection = null;
        field.text = cleanAddressLabel(r['label']);
        if (isOrigin) {
          originSelectionGuard.markManualOrigin();
          pickup = LatLng((r['latitude'] as num).toDouble(),
              (r['longitude'] as num).toDouble());
          selectedOriginArea = serviceAreaCatalog?.find(pickup!);
        } else {
          _setDestinationPoint(
              destinationIndex,
              LatLng((r['latitude'] as num).toDouble(),
                  (r['longitude'] as num).toDouble()));
        }
        message = 'Ubicación actualizada en el mapa.';
      });
      if (isOrigin && pickup != null) {
        realtime.subscribeNearby(pickup!.latitude, pickup!.longitude);
        unawaited(refreshNearbyDrivers(pickup));
      }
      refreshRoute(force: true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => message = error.message);
      if (coverageErrorCodes.contains(error.code)) {
        unawaited(showPassengerCoverageError(
            error.code ?? 'OUTSIDE_SERVICE_AREA', error.message));
      }
    } catch (_) {
      if (mounted) {
        setState(() => message =
            'No se pudo consultar Google Places. Inténtalo nuevamente.');
      }
    }
  }

  Future<void> selectMapPoint(LatLng point) async {
    final selection = mapSelection;
    if (selection == null ||
        !point.latitude.isFinite ||
        !point.longitude.isFinite) {
      return;
    }
    final selectedArea = serviceAreaCatalog?.find(point);
    if (serviceAreaCatalog != null && selectedArea == null) {
      final code = await resolveCoverageErrorCode(point);
      if (!mounted || mapSelection != selection) return;
      final coverageMessage = mensajeApi(code);
      setState(() => message = coverageMessage);
      unawaited(showPassengerCoverageError(code, coverageMessage));
      return;
    }
    if (selection == MapPointSelection.destination &&
        selectedOriginArea != null &&
        selectedArea?.id != selectedOriginArea?.id) {
      const code = 'DIFFERENT_SERVICE_AREAS';
      final coverageMessage = mensajeApi(code);
      setState(() => message = coverageMessage);
      unawaited(showPassengerCoverageError(code, coverageMessage));
      return;
    }
    final coordinateLabel =
        'Punto (${point.latitude.toStringAsFixed(5)}, ${point.longitude.toStringAsFixed(5)})';
    final destinationIndex = selectedDestinationIndex;
    final field = selection == MapPointSelection.origin
        ? origin
        : _destinationController(destinationIndex);
    final previewIsCurrent = pendingMapPoint != null &&
        const Distance().as(LengthUnit.Meter, pendingMapPoint!, point) < 2 &&
        !selectionResolving &&
        field.text.trim().isNotEmpty;
    selectionLookupGeneration++;
    setState(() {
      mapSelection = null;
      pendingMapPoint = null;
      selectionResolving = false;
      selectionMoving = false;
      sheetExtent = .35;
      if (selection == MapPointSelection.origin) {
        originSelectionGuard.markManualOrigin();
        pickup = point;
        selectedOriginArea = selectedArea;
        if (!previewIsCurrent) origin.text = coordinateLabel;
        message = 'Consultando la dirección del origen...';
      } else {
        _setDestinationPoint(destinationIndex, point);
        if (!previewIsCurrent) field.text = coordinateLabel;
        message = 'Consultando la dirección del destino...';
      }
    });
    _movePassengerSheet(.35);
    if (selection == MapPointSelection.origin) {
      realtime.subscribeNearby(point.latitude, point.longitude);
      unawaited(refreshNearbyDrivers(point));
    }
    refreshRoute(force: true);
    if (previewIsCurrent) {
      if (mounted) {
        setState(() => message = selection == MapPointSelection.origin
            ? 'Origen confirmado.'
            : 'Destino confirmado.');
      }
      return;
    }
    try {
      final result = await api.reverse(widget.s.token, point);
      if (!mounted) return;
      final selectedPoint = selection == MapPointSelection.origin
          ? pickup
          : _destinationPoint(destinationIndex);
      if (selectedPoint?.latitude != point.latitude ||
          selectedPoint?.longitude != point.longitude) {
        return;
      }
      setState(() {
        if (selection == MapPointSelection.origin) {
          origin.text =
              cleanAddressLabel(result['label'], fallback: coordinateLabel);
          message = 'Origen identificado por su dirección.';
        } else {
          field.text =
              cleanAddressLabel(result['label'], fallback: coordinateLabel);
          message = 'Destino identificado por su dirección.';
        }
      });
    } catch (_) {
      if (mounted) {
        setState(() => message =
            'El punto quedó guardado, pero no se pudo obtener su dirección.');
      }
    }
  }

  Future<void> refreshRoute({bool force = false}) async {
    final now = DateTime.now();
    if (!force &&
        lastRouteAt != null &&
        now.difference(lastRouteAt!) < const Duration(seconds: 45)) {
      return;
    }
    LatLng? from;
    LatLng? to;
    List<LatLng> waypoints = [];
    final status = active?['status']?.toString();
    if (driverPosition != null && status == 'DRIVER_EN_ROUTE') {
      from = driverPosition;
      to = pickup;
    } else if (driverPosition != null && status == 'IN_PROGRESS') {
      from = driverPosition;
      final remainingStops = List<dynamic>.from(active?['stops'] ?? const [])
          .where((stop) => stop['completedAt'] == null)
          .map((stop) => LatLng((stop['latitude'] as num).toDouble(),
              (stop['longitude'] as num).toDouble()))
          .toList();
      if (remainingStops.isNotEmpty) {
        to = remainingStops.last;
        waypoints = remainingStops.take(remainingStops.length - 1).toList();
      } else {
        to = _finalDestinationPoint;
      }
    } else {
      from = pickup;
      final destinations = _destinationPoints;
      if (destinations.isNotEmpty) {
        to = destinations.last;
        waypoints = destinations.take(destinations.length - 1).toList();
      }
    }
    if (from == null || to == null) return;
    final requestGeneration = ++routeRequestGeneration;
    final requestedFrom = from;
    final requestedTo = to;
    lastRouteAt = now;
    try {
      final route = await api.route(widget.s.token, requestedFrom, requestedTo,
          waypoints: waypoints);
      final points = List<dynamic>.from(route['points'] ?? const [])
          .map((point) => LatLng((point['latitude'] as num).toDouble(),
              (point['longitude'] as num).toDouble()))
          .toList();
      if (!mounted || requestGeneration != routeRequestGeneration) return;
      setState(() {
        routePoints = points;
        routeDistanceMeters = (route['distanceMeters'] as num?)?.toDouble();
        routeDurationSeconds = (route['durationSeconds'] as num?)?.toDouble();
      });
    } catch (_) {
      if (mounted && force && requestGeneration == routeRequestGeneration) {
        setState(() {
          routePoints = [requestedFrom, requestedTo];
          routeDistanceMeters = null;
          routeDurationSeconds = null;
        });
      }
    }
  }

  List<Map<String, dynamic>>? _serializedDestinations() {
    final values = <Map<String, dynamic>>[];
    if (dropoff == null || destination.text.trim().isEmpty) return null;
    values.add({
      'location': {
        'latitude': dropoff!.latitude,
        'longitude': dropoff!.longitude,
      },
      'reference': destination.text.trim(),
    });
    for (final stop in additionalStops) {
      if (stop.point == null || stop.controller.text.trim().isEmpty) {
        return null;
      }
      values.add({
        'location': {
          'latitude': stop.point!.latitude,
          'longitude': stop.point!.longitude,
        },
        'reference': stop.controller.text.trim(),
      });
    }
    return values;
  }

  Map<String, dynamic>? _currentRequestPayload() {
    final destinations = _serializedDestinations();
    final selectedOrigin = pickup;
    if (selectedOrigin == null ||
        destinations == null ||
        destinations.isEmpty) {
      return null;
    }
    final lastLocation =
        Map<String, dynamic>.from(destinations.last['location'] as Map);
    final selectedDestination = LatLng(
        (lastLocation['latitude'] as num).toDouble(),
        (lastLocation['longitude'] as num).toDouble());
    if (serviceAreaCatalog != null) {
      final area = serviceAreaCatalog!.find(selectedOrigin);
      if (area == null ||
          destinations.any((destination) {
            final location =
                Map<String, dynamic>.from(destination['location'] as Map);
            return serviceAreaCatalog!
                    .find(LatLng((location['latitude'] as num).toDouble(),
                        (location['longitude'] as num).toDouble()))
                    ?.id !=
                area.id;
          })) {
        return null;
      }
    }
    return buildTripRequestPayload(
      passengers: people,
      originReference: origin.text,
      destinationReference: destination.text,
      selectedOrigin: selectedOrigin,
      selectedDestination: selectedDestination,
      paymentMethod: paymentMethod,
      notes: notes.text,
      destinations: destinations,
      scheduledFor: scheduledFor,
    );
  }

  Future<void> chooseSchedule() async {
    final now = DateTime.now();
    final currentMinute =
        DateTime(now.year, now.month, now.day, now.hour, now.minute);
    final minimum =
        currentMinute.add(Duration(minutes: scheduledMinimumNoticeMinutes));
    final maximum =
        currentMinute.add(Duration(minutes: scheduledMaximumAdvanceMinutes));
    final currentSelection = scheduledFor;
    final initial = currentSelection != null &&
            !currentSelection.isBefore(minimum) &&
            !currentSelection.isAfter(maximum)
        ? currentSelection
        : minimum;
    final date = await showDatePicker(
      context: context,
      firstDate: DateTime(now.year, now.month, now.day),
      lastDate: maximum,
      initialDate: DateTime(initial.year, initial.month, initial.day),
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(initial),
    );
    if (time == null) return;
    final selected =
        DateTime(date.year, date.month, date.day, time.hour, time.minute);
    final validation = scheduledSelectionError(
      selected: selected,
      now: DateTime.now(),
      minimumNoticeMinutes: scheduledMinimumNoticeMinutes,
      maximumAdvanceMinutes: scheduledMaximumAdvanceMinutes,
    );
    if (validation != null) {
      final explanation = validation == 'SCHEDULE_TOO_SOON'
          ? 'Selecciona una hora con al menos $scheduledMinimumNoticeMinutes minutos de anticipación.'
          : 'Puedes programar el viaje hasta un máximo de 24 horas desde este momento.';
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          icon: const Icon(Icons.event_busy_outlined),
          title: const Text('Horario no disponible'),
          content: Text(explanation),
          actions: [
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Elegir otra hora'),
            ),
          ],
        ),
      );
      return;
    }
    setState(() {
      scheduledFor = selected;
      message = null;
    });
  }

  Widget _tripPointSummary(BuildContext context,
      {required IconData icon,
      required String label,
      required String value,
      required bool last}) {
    final scheme = Theme.of(context).colorScheme;
    return IntrinsicHeight(
      child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SizedBox(
          width: 34,
          child: Column(children: [
            Icon(icon,
                size: icon == Icons.circle ? 15 : 26, color: scheme.primary),
            if (!last)
              Expanded(
                  child: Container(width: 2, color: scheme.outlineVariant)),
          ]),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Padding(
            padding: EdgeInsets.only(bottom: last ? 0 : 18),
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(label,
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      color: scheme.primary, fontWeight: FontWeight.w900)),
              const SizedBox(height: 3),
              Text(value,
                  style: Theme.of(context).textTheme.bodyLarge,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis),
            ]),
          ),
        ),
      ]),
    );
  }

  Widget _fareSummaryCard(BuildContext context,
      {required Map<String, dynamic> preview,
      required Map<String, int> fareBreakdown,
      required String fareLabel,
      required String total}) {
    final scheme = Theme.of(context).colorScheme;
    final showDetails = fareBreakdown['stops']! > 0 ||
        fareBreakdown['adjustments']! != 0 ||
        List<dynamic>.from(preview['fareLegs'] ?? const []).length > 1;
    return _PassengerSurface(
      color: scheme.primaryContainer.withValues(alpha: .22),
      child: Column(children: [
        Row(children: [
          Icon(Icons.local_offer_outlined, color: scheme.primary),
          const SizedBox(width: 10),
          Expanded(
              child: Text(fareLabel,
                  style: TextStyle(
                      color: scheme.primary, fontWeight: FontWeight.w800))),
          Text('\$${(fareBreakdown['journeys']! / 100).toStringAsFixed(2)}',
              style: Theme.of(context).textTheme.titleMedium),
        ]),
        if (showDetails) ...[
          const SizedBox(height: 10),
          if (fareBreakdown['stops']! > 0)
            _fareLine(
                context, 'Adicional por paradas', fareBreakdown['stops']!),
          if (fareBreakdown['adjustments']! != 0)
            _fareLine(context, 'Otros ajustes', fareBreakdown['adjustments']!),
        ],
        const Divider(height: 24),
        Row(children: [
          Expanded(
              child: Text('Total a pagar',
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      color: scheme.primary, fontWeight: FontWeight.w900))),
          Text('\$$total',
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  color: scheme.primary, fontWeight: FontWeight.w900)),
        ]),
      ]),
    );
  }

  Widget _fareLine(BuildContext context, String label, int cents) => Padding(
        padding: const EdgeInsets.only(top: 5),
        child: Row(children: [
          Expanded(child: Text(label)),
          Text('\$${(cents / 100).toStringAsFixed(2)}'),
        ]),
      );

  Future<bool> confirmTripSummary(Map<String, dynamic> payload) async {
    setState(() => message = 'Calculando el resumen del viaje…');
    try {
      final preview = await api.previewTrip(widget.s.token, payload);
      if (!mounted) return false;
      final previewPoints =
          List<dynamic>.from(preview['routePoints'] ?? const [])
              .map((point) => LatLng((point['latitude'] as num).toDouble(),
                  (point['longitude'] as num).toDouble()))
              .toList();
      setState(() {
        routePoints = previewPoints;
        routeDistanceMeters = (preview['distanceMeters'] as num?)?.toDouble();
        routeDurationSeconds = (preview['durationSeconds'] as num?)?.toDouble();
        message = null;
      });
      final fareBreakdown =
          tripFareBreakdown(Map<String, dynamic>.from(preview as Map));
      return await showDialog<bool>(
            context: context,
            builder: (dialogContext) {
              final scheme = Theme.of(dialogContext).colorScheme;
              final stops = List<dynamic>.from(preview['stops'] ?? const []);
              final distance =
                  (((preview['distanceMeters'] as num?) ?? 0) / 1000)
                      .toStringAsFixed(1);
              final minutes =
                  (((preview['durationSeconds'] as num?) ?? 0) / 60).ceil();
              final total = (fareBreakdown['total']! / 100).toStringAsFixed(2);
              final fareLabel = preview['fareIsSuggested'] == true
                  ? 'Tarifa sugerida'
                  : 'Tarifa del trayecto';
              return Dialog(
                insetPadding:
                    const EdgeInsets.symmetric(horizontal: 18, vertical: 24),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(30)),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 620),
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.fromLTRB(22, 18, 22, 22),
                    child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(children: [
                            const _CostaGoEmblem(size: 64),
                            const SizedBox(width: 14),
                            Expanded(
                              child: Text('Confirma tu viaje',
                                  style: Theme.of(dialogContext)
                                      .textTheme
                                      .headlineSmall
                                      ?.copyWith(fontWeight: FontWeight.w900)),
                            ),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 12, vertical: 8),
                              decoration: BoxDecoration(
                                color: scheme.primaryContainer
                                    .withValues(alpha: .5),
                                borderRadius: BorderRadius.circular(16),
                              ),
                              child: Text(
                                scheduledFor == null
                                    ? 'Salida: ahora'
                                    : TimeOfDay.fromDateTime(scheduledFor!)
                                        .format(context),
                                style: TextStyle(
                                    color: scheme.primary,
                                    fontWeight: FontWeight.w800),
                              ),
                            ),
                          ]),
                          const SizedBox(height: 18),
                          _PassengerSurface(
                            child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  _tripPointSummary(dialogContext,
                                      icon: Icons.location_on,
                                      label: 'Origen',
                                      value: origin.text.trim(),
                                      last: stops.isEmpty),
                                  ...stops.asMap().entries.map((entry) =>
                                      _tripPointSummary(dialogContext,
                                          icon: Icons.circle,
                                          label: 'Destino ${entry.key + 1}',
                                          value: cleanAddressLabel(
                                              entry.value['reference'],
                                              fallback: 'Destino'),
                                          last: entry.key == stops.length - 1)),
                                ]),
                          ),
                          const SizedBox(height: 12),
                          LayoutBuilder(builder: (context, constraints) {
                            final width = (constraints.maxWidth - 10) / 2;
                            return Wrap(spacing: 10, runSpacing: 10, children: [
                              SizedBox(
                                  width: width,
                                  child: _PassengerMetric(
                                      icon: Icons.person_outline,
                                      label: 'Pasajeros',
                                      value: '$people')),
                              SizedBox(
                                  width: width,
                                  child: _PassengerMetric(
                                      icon:
                                          Icons.account_balance_wallet_outlined,
                                      label: 'Pago',
                                      value: paymentMethod == 'DEUNA'
                                          ? 'De Una'
                                          : 'Efectivo')),
                              SizedBox(
                                  width: width,
                                  child: _PassengerMetric(
                                      icon: Icons.route_outlined,
                                      label: 'Distancia',
                                      value: '$distance km')),
                              SizedBox(
                                  width: width,
                                  child: _PassengerMetric(
                                      icon: Icons.schedule_outlined,
                                      label: 'Tiempo estimado',
                                      value: '$minutes min')),
                            ]);
                          }),
                          const SizedBox(height: 12),
                          _fareSummaryCard(dialogContext,
                              preview:
                                  Map<String, dynamic>.from(preview as Map),
                              fareBreakdown: fareBreakdown,
                              fareLabel: fareLabel,
                              total: total),
                          const SizedBox(height: 10),
                          TextButton(
                              onPressed: () =>
                                  Navigator.pop(dialogContext, false),
                              child: const Text('Modificar')),
                          _CostaGoPrimaryButton(
                            label: 'Confirmar solicitud',
                            onPressed: () => Navigator.pop(dialogContext, true),
                          ),
                        ]),
                  ),
                ),
              );
            },
          ) ??
          false;
    } catch (error) {
      if (mounted) setState(() => message = error.toString());
      return false;
    }
  }

  String _scheduledStatusLabel(String value) =>
      const {
        'SCHEDULED': 'Buscando conductor',
        'SCHEDULED_ASSIGNED': 'Conductor asignado',
        'SCHEDULED_READY': 'Próximo a iniciar',
        'ACTIVATED': 'Viaje activado',
      }[value] ??
      'Viaje programado';

  Future<void> showScheduledTrips() async {
    try {
      final trips = await api.scheduledTrips(widget.s.token);
      if (!mounted) return;
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        showDragHandle: true,
        useSafeArea: true,
        builder: (sheetContext) => FractionallySizedBox(
          heightFactor: .88,
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 2, 20, 16),
              child: Row(children: [
                Container(
                  width: 46,
                  height: 46,
                  decoration: BoxDecoration(
                    color: Theme.of(sheetContext).colorScheme.primaryContainer,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Icon(Icons.event_available_outlined,
                      color: Theme.of(sheetContext)
                          .colorScheme
                          .onPrimaryContainer),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Mis viajes programados',
                            style: Theme.of(sheetContext)
                                .textTheme
                                .titleLarge
                                ?.copyWith(fontWeight: FontWeight.w900)),
                        Text(
                            'Consulta, modifica o cancela tus próximas reservas',
                            style: Theme.of(sheetContext).textTheme.bodySmall),
                      ]),
                ),
                if (trips.isNotEmpty)
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: Theme.of(sheetContext)
                          .colorScheme
                          .surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text('${trips.length}',
                        style: const TextStyle(fontWeight: FontWeight.w900)),
                  ),
              ]),
            ),
            const Divider(height: 1),
            Expanded(
              child: trips.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(28),
                        child:
                            Column(mainAxisSize: MainAxisSize.min, children: [
                          Icon(Icons.event_busy_outlined,
                              size: 54,
                              color:
                                  Theme.of(sheetContext).colorScheme.outline),
                          const SizedBox(height: 14),
                          Text('Aún no tienes viajes programados',
                              textAlign: TextAlign.center,
                              style: Theme.of(sheetContext)
                                  .textTheme
                                  .titleMedium
                                  ?.copyWith(fontWeight: FontWeight.w800)),
                          const SizedBox(height: 6),
                          Text(
                            'Selecciona “Programar para más tarde” al solicitar tu próximo viaje.',
                            textAlign: TextAlign.center,
                            style: Theme.of(sheetContext).textTheme.bodyMedium,
                          ),
                        ]),
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
                      itemCount: trips.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 12),
                      itemBuilder: (context, index) {
                        final trip = Map<String, dynamic>.from(trips[index]);
                        final date = DateTime.tryParse(
                            trip['scheduledFor']?.toString() ?? '');
                        final stops =
                            List<dynamic>.from(trip['stops'] ?? const []);
                        final scheduleStatus =
                            trip['scheduleStatus']?.toString() ?? 'SCHEDULED';
                        final editable = scheduleStatus == 'SCHEDULED' &&
                            trip['driverName'] == null;
                        final scheme = Theme.of(context).colorScheme;
                        return Card(
                          margin: EdgeInsets.zero,
                          elevation: 0,
                          color: scheme.surfaceContainerLow,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(20),
                            side: BorderSide(color: scheme.outlineVariant),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Row(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Container(
                                        width: 44,
                                        padding: const EdgeInsets.symmetric(
                                            vertical: 7),
                                        decoration: BoxDecoration(
                                          color: scheme.primaryContainer,
                                          borderRadius:
                                              BorderRadius.circular(12),
                                        ),
                                        child: Column(children: [
                                          Text(
                                              date == null
                                                  ? '--'
                                                  : '${date.toLocal().day}',
                                              style: TextStyle(
                                                  color:
                                                      scheme.onPrimaryContainer,
                                                  fontSize: 18,
                                                  fontWeight: FontWeight.w900)),
                                          Text(
                                              date == null
                                                  ? '---'
                                                  : const [
                                                      'ENE',
                                                      'FEB',
                                                      'MAR',
                                                      'ABR',
                                                      'MAY',
                                                      'JUN',
                                                      'JUL',
                                                      'AGO',
                                                      'SEP',
                                                      'OCT',
                                                      'NOV',
                                                      'DIC'
                                                    ][date.toLocal().month - 1],
                                              style: TextStyle(
                                                  color:
                                                      scheme.onPrimaryContainer,
                                                  fontSize: 10,
                                                  fontWeight: FontWeight.w800)),
                                        ]),
                                      ),
                                      const SizedBox(width: 12),
                                      Expanded(
                                        child: Column(
                                            crossAxisAlignment:
                                                CrossAxisAlignment.start,
                                            children: [
                                              Text(
                                                date == null
                                                    ? 'Horario por confirmar'
                                                    : TimeOfDay.fromDateTime(
                                                            date.toLocal())
                                                        .format(context),
                                                style: Theme.of(context)
                                                    .textTheme
                                                    .titleLarge
                                                    ?.copyWith(
                                                        fontWeight:
                                                            FontWeight.w900),
                                              ),
                                              if (date != null)
                                                Text(
                                                    MaterialLocalizations.of(
                                                            context)
                                                        .formatFullDate(
                                                            date.toLocal()),
                                                    style: Theme.of(context)
                                                        .textTheme
                                                        .bodySmall),
                                            ]),
                                      ),
                                      Container(
                                        padding: const EdgeInsets.symmetric(
                                            horizontal: 9, vertical: 6),
                                        decoration: BoxDecoration(
                                          color: scheduleStatus ==
                                                  'SCHEDULED_ASSIGNED'
                                              ? scheme.tertiaryContainer
                                              : scheme.secondaryContainer,
                                          borderRadius:
                                              BorderRadius.circular(999),
                                        ),
                                        child: Text(
                                          _scheduledStatusLabel(scheduleStatus),
                                          style: TextStyle(
                                              color: scheduleStatus ==
                                                      'SCHEDULED_ASSIGNED'
                                                  ? scheme.onTertiaryContainer
                                                  : scheme.onSecondaryContainer,
                                              fontSize: 11,
                                              fontWeight: FontWeight.w800),
                                        ),
                                      ),
                                    ]),
                                const SizedBox(height: 16),
                                _ScheduledRouteRow(
                                  icon: Icons.my_location,
                                  label: 'Origen',
                                  value: cleanAddressLabel(
                                      trip['originReference'],
                                      fallback: 'Origen'),
                                  color: scheme.primary,
                                ),
                                ...stops
                                    .asMap()
                                    .entries
                                    .map((entry) => _ScheduledRouteRow(
                                          icon: entry.key == stops.length - 1
                                              ? Icons.flag_rounded
                                              : Icons.location_on_outlined,
                                          label: entry.key == stops.length - 1
                                              ? 'Destino final'
                                              : 'Parada ${entry.key + 1}',
                                          value: cleanAddressLabel(
                                              entry.value['reference'],
                                              fallback: 'Destino'),
                                          color: entry.key == stops.length - 1
                                              ? scheme.error
                                              : scheme.tertiary,
                                        )),
                                const Divider(height: 24),
                                _ScheduledCounterpartCard(
                                  token: widget.s.token,
                                  userId: trip['driverId']?.toString(),
                                  name: trip['driverName']?.toString(),
                                  hasPhoto: trip['driverHasPhoto'] == true,
                                  rating: ((trip['driverRating'] as num?) ?? 0)
                                      .toDouble(),
                                  roleLabel: 'Conductor asignado',
                                  vehicle: trip['vehicle']?.toString(),
                                  emptyLabel: 'Aún sin conductor asignado',
                                ),
                                const SizedBox(height: 10),
                                Row(children: [
                                  if (editable)
                                    Expanded(
                                      child: OutlinedButton.icon(
                                        onPressed: () {
                                          pickup = LatLng(
                                              (trip['originLatitude'] as num)
                                                  .toDouble(),
                                              (trip['originLongitude'] as num)
                                                  .toDouble());
                                          origin.text = trip['originReference']
                                                  ?.toString() ??
                                              '';
                                          people = (trip['passengers'] as num?)
                                                  ?.toInt() ??
                                              1;
                                          paymentMethod = trip['paymentMethod']
                                                  ?.toString() ??
                                              'CASH';
                                          scheduledFor = date?.toLocal();
                                          editingScheduledTripId =
                                              trip['tripId'].toString();
                                          for (final draft in additionalStops) {
                                            draft.dispose();
                                          }
                                          additionalStops.clear();
                                          if (stops.isNotEmpty) {
                                            final first = stops.first;
                                            destination.text =
                                                first['reference']
                                                        ?.toString() ??
                                                    '';
                                            dropoff = LatLng(
                                                (first['latitude'] as num)
                                                    .toDouble(),
                                                (first['longitude'] as num)
                                                    .toDouble());
                                            for (final value in stops.skip(1)) {
                                              final draft = PassengerStopDraft()
                                                ..controller.text =
                                                    value['reference']
                                                            ?.toString() ??
                                                        ''
                                                ..point = LatLng(
                                                    (value['latitude'] as num)
                                                        .toDouble(),
                                                    (value['longitude'] as num)
                                                        .toDouble());
                                              additionalStops.add(draft);
                                            }
                                          }
                                          Navigator.pop(sheetContext);
                                          setState(() => message =
                                              'Modifica los datos y confirma nuevamente el viaje programado.');
                                          _movePassengerSheet(.78);
                                        },
                                        icon: const Icon(Icons.edit_outlined),
                                        label: const Text('Modificar'),
                                      ),
                                    ),
                                  if (editable) const SizedBox(width: 10),
                                  Expanded(
                                    child: TextButton.icon(
                                      onPressed: () async {
                                        await api.cancelTrip(widget.s.token,
                                            trip['tripId'].toString());
                                        if (sheetContext.mounted) {
                                          Navigator.pop(sheetContext);
                                        }
                                        if (mounted) {
                                          setState(() => message =
                                              'Viaje programado cancelado.');
                                        }
                                      },
                                      icon: const Icon(Icons.close),
                                      label: const Text('Cancelar'),
                                    ),
                                  ),
                                ]),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
            ),
          ]),
        ),
      );
    } catch (error) {
      if (mounted) setState(() => message = error.toString());
    }
  }

  Future<void> create() async {
    if (requestSubmitting) return;
    final draft = _currentRequestPayload();
    if (draft == null) {
      setState(() => message =
          'Marca el origen y todos los destinos en el mapa antes de solicitar.');
      return;
    }
    final requestKey =
        'trip-${DateTime.now().microsecondsSinceEpoch}-${math.Random.secure().nextInt(1 << 32)}';
    final payload = Map<String, dynamic>.from(
        jsonDecode(jsonEncode({...draft, 'idempotencyKey': requestKey}))
            as Map);
    final editingId = editingScheduledTripId;
    if (!await confirmTripSummary(payload)) return;
    if (!mounted) return;
    setState(() {
      requestSubmitting = true;
      message = 'Creando tu solicitud…';
    });
    try {
      ratingPrompted = false;
      final t = editingId == null
          ? await api.createFromPayload(widget.s.token, payload)
          : await api.updateScheduled(widget.s.token, editingId, payload);
      final isScheduled = payload['scheduledFor'] != null;
      setState(() {
        if (!isScheduled) {
          active = {'tripId': t['tripId'], 'status': 'SEARCHING'};
          sheetExtent = .46;
        } else {
          _resetRequestAfterScheduledTrip(editingId == null
              ? 'Viaje programado guardado correctamente.'
              : 'Viaje programado actualizado correctamente.');
        }
      });
      _movePassengerSheet(active == null ? .35 : .50);
      await load();
    } catch (e) {
      if (!mounted) return;
      final text = e.toString();
      setState(() => message = text);
      debugPrint(
          'TRIP_REQUEST_FAILED code=${e is ApiException ? e.code : 'TRIP_REQUEST_STATE_INVALIDATED'}');
      if (e is ApiException && coverageErrorCodes.contains(e.code)) {
        await showPassengerCoverageError(
            e.code ?? 'OUTSIDE_SERVICE_AREA', text);
        if (e.code == 'DESTINATION_OUTSIDE_SERVICE_AREA' ||
            e.code == 'DIFFERENT_SERVICE_AREAS') {
          clearInvalidDestinationsForCoverage();
        }
      }
    } finally {
      if (mounted) setState(() => requestSubmitting = false);
    }
  }

  Future<void> cancel() async {
    final tripId = active?['tripId']?.toString();
    if (tripId == null) return;
    final confirmed = await showDialog<bool>(
            context: context,
            builder: (dialogContext) => AlertDialog(
                    title: const Text('Cancelar solicitud'),
                    content: const Text(
                        '¿Deseas cancelar antes de que un conductor acepte?'),
                    actions: [
                      TextButton(
                          onPressed: () => Navigator.pop(dialogContext, false),
                          child: const Text('Volver')),
                      FilledButton(
                          onPressed: () => Navigator.pop(dialogContext, true),
                          child: const Text('Cancelar solicitud'))
                    ])) ??
        false;
    if (!confirmed) return;
    try {
      await api.cancelTrip(widget.s.token, tripId);
      if (!mounted) return;
      setState(() {
        active = null;
        sheetExtent = .35;
        message = 'Solicitud cancelada correctamente.';
      });
      _movePassengerSheet(.35);
    } catch (e) {
      if (mounted) setState(() => message = e.toString());
      await load();
    }
  }

  String _bannerImageUrl(Map<String, dynamic> banner) =>
      '$base/v1/banners/${banner['id']}/image?v=${Uri.encodeQueryComponent(banner['updatedAt']?.toString() ?? '')}';

  Future<void> _openBanner(Map<String, dynamic> banner) async {
    unawaited(_reportBannerEvent(banner, 'CLICK'));
    final action = banner['actionType']?.toString() ?? 'WEB';
    final value =
        (banner['actionValue'] ?? banner['targetUrl'])?.toString().trim() ?? '';
    final uri = action == 'PHONE'
        ? Uri(scheme: 'tel', path: value.replaceAll(RegExp(r'[^+0-9]'), ''))
        : Uri.tryParse(value);
    final valid = uri != null &&
        switch (action) {
          'PHONE' => uri.scheme == 'tel' && uri.path.length >= 7,
          'WEB' ||
          'WHATSAPP' ||
          'MAPS' =>
            uri.scheme == 'https' && uri.host.isNotEmpty,
          _ => false,
        };
    if (!valid) return;
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('No se pudo abrir la promoción.')));
      }
    }
  }

  Future<void> _reportBannerEvent(
      Map<String, dynamic> banner, String eventType) async {
    final id = banner['id']?.toString();
    final placement = banner['placement']?.toString();
    if (id == null || placement == null) return;
    try {
      await api.advertisingEvent(widget.s.token,
          campaignId: id,
          eventType: eventType,
          exhibitionId:
              '$eventType-$id-${DateTime.now().millisecondsSinceEpoch ~/ 5000}',
          placement: placement,
          serviceAreaId: selectedOriginArea?.id,
          tripStatus: active?['status']?.toString(),
          actionType: banner['actionType']?.toString());
    } catch (_) {}
  }

  Widget _routeSummary(BuildContext context, {bool card = false}) {
    if (routeDistanceMeters == null || routeDurationSeconds == null) {
      return const SizedBox.shrink();
    }
    final label = '${(routeDistanceMeters! / 1000).toStringAsFixed(1)} km · '
        '${(routeDurationSeconds! / 60).ceil()} min';
    if (card) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: _PassengerSurface(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(children: [
            Icon(Icons.route_outlined,
                color: Theme.of(context).colorScheme.primary),
            const SizedBox(width: 10),
            Expanded(
                child: Text('Ruta estimada',
                    style: TextStyle(
                        color: Theme.of(context).colorScheme.primary,
                        fontWeight: FontWeight.w800))),
            Text(label,
                style: Theme.of(context)
                    .textTheme
                    .titleMedium
                    ?.copyWith(fontWeight: FontWeight.w800)),
          ]),
        ),
      );
    }
    return Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Text('Ruta estimada: $label',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.titleSmall));
  }

  List<Widget> _searchingContent(BuildContext context) => [
        const SizedBox(height: 8),
        Center(
          child: TweenAnimationBuilder<double>(
            tween: Tween(begin: .92, end: 1),
            duration: const Duration(milliseconds: 950),
            curve: Curves.easeOutBack,
            builder: (context, value, child) => Transform.scale(
              scale: value,
              child: Container(
                width: 156,
                height: 156,
                padding: const EdgeInsets.all(25),
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(
                      color: Theme.of(context)
                          .colorScheme
                          .primary
                          .withValues(alpha: .3),
                      width: 2),
                  color: Theme.of(context)
                      .colorScheme
                      .primaryContainer
                      .withValues(alpha: .22),
                ),
                child: Image.asset('assets/images/costa-go-emblem.png'),
              ),
            ),
          ),
        ),
        const SizedBox(height: 20),
        Text('Buscando un conductor cercano',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                color: Theme.of(context).colorScheme.primary,
                fontWeight: FontWeight.w900)),
        const SizedBox(height: 6),
        Text('Estamos buscando el mototaxi más cercano para ti.',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant)),
        if (message != null) ...[
          const SizedBox(height: 5),
          Text(message!, textAlign: TextAlign.center),
        ],
        const SizedBox(height: 14),
        _routeSummary(context, card: true),
        AffiliateBanners(
          key: const ValueKey('searching-ad'),
          variant: AffiliateBannerVariant.expanded,
          load: () => api.banners(widget.s.token, 'PASSENGER_SEARCHING_DRIVER',
              serviceAreaId: selectedOriginArea?.id),
          imageUrl: _bannerImageUrl,
          onTap: _openBanner,
          onImpression: (banner) =>
              unawaited(_reportBannerEvent(banner, 'IMPRESSION')),
        ),
        const SizedBox(height: 14),
        OutlinedButton.icon(
          onPressed: cancel,
          icon: const Icon(Icons.cancel_outlined),
          label: const Text('Cancelar búsqueda'),
          style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(54),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(18))),
        ),
      ];

  Widget _driverPhoto({double size = 54}) {
    final driverId = active?['driverId']?.toString();
    final hasPhoto = active?['driverHasPhoto'] == true && driverId != null;
    final fallback = Container(
      width: size,
      height: size,
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: Icon(Icons.person_outline, size: size * .55),
    );
    return ClipOval(
      child: hasPhoto
          ? Image.network(
              '$base/v1/users/$driverId/profile-photo',
              headers: {'Authorization': 'Bearer ${widget.s.token}'},
              width: size,
              height: size,
              fit: BoxFit.cover,
              errorBuilder: (_, __, ___) => fallback,
            )
          : fallback,
    );
  }

  Future<void> showDriverPhoto() => showDialog<void>(
        context: context,
        barrierDismissible: true,
        builder: (dialogContext) => Dialog(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              _driverPhoto(size: 210),
              const SizedBox(height: 16),
              Text(active?['driverName']?.toString() ?? 'Tu conductor',
                  textAlign: TextAlign.center,
                  style: Theme.of(context)
                      .textTheme
                      .titleLarge
                      ?.copyWith(fontWeight: FontWeight.w800)),
              if (active?['vehicle'] != null)
                Text('Placa: ${active['vehicle']}'),
              const SizedBox(height: 6),
              Row(mainAxisSize: MainAxisSize.min, children: [
                const Icon(Icons.star, color: Colors.amber, size: 20),
                const SizedBox(width: 4),
                Text(((active?['driverRating'] as num?) ?? 0)
                    .toStringAsFixed(1)),
              ]),
              const SizedBox(height: 14),
              FilledButton(
                  onPressed: () => Navigator.pop(dialogContext),
                  child: const Text('Cerrar')),
            ]),
          ),
        ),
      );

  List<Widget> _activeTripContent(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final etaValue = (active?['driverEtaMinutes'] as num?)?.ceil();
    return [
      _PassengerSurface(
        padding: const EdgeInsets.all(16),
        child: Row(children: [
          InkWell(
            borderRadius: BorderRadius.circular(48),
            onTap: showDriverPhoto,
            child: _driverPhoto(size: 78),
          ),
          const SizedBox(width: 14),
          Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(active?['driverName']?.toString() ?? 'Tu conductor',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      color: scheme.primary, fontWeight: FontWeight.w900)),
              if (active?['vehicle'] != null) ...[
                const SizedBox(height: 3),
                Text('Placa: ${active['vehicle']}',
                    style: Theme.of(context).textTheme.titleMedium),
              ],
              const SizedBox(height: 5),
              Row(children: [
                const Icon(Icons.star, color: Color(0xffffa000), size: 22),
                const SizedBox(width: 4),
                Text(
                    ((active?['driverRating'] as num?) ?? 0).toStringAsFixed(1),
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.w800)),
              ]),
            ]),
          ),
          const SizedBox(width: 10),
          Container(
            constraints: const BoxConstraints(minWidth: 82),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            decoration: BoxDecoration(
              color: scheme.primaryContainer.withValues(alpha: .45),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Icon(Icons.schedule_outlined, color: scheme.primary, size: 21),
              const SizedBox(height: 3),
              Text(
                  active?['status'] == 'DRIVER_EN_ROUTE'
                      ? (etaValue == null ? 'En camino' : '$etaValue min')
                      : estadoViaje(active?['status']?.toString() ?? ''),
                  textAlign: TextAlign.center,
                  style: TextStyle(
                      color: scheme.primary, fontWeight: FontWeight.w900)),
            ]),
          ),
        ]),
      ),
      const SizedBox(height: 12),
      TripStatusPanel(
          status: active['status'].toString(),
          driverName: active['driverName']?.toString()),
      AffiliateBanners(
        key: ValueKey('active-trip-ad-${active?['status']}'),
        variant: AffiliateBannerVariant.expanded,
        load: () => api.banners(
            widget.s.token,
            active?['status'] == 'IN_PROGRESS'
                ? 'PASSENGER_TRIP_IN_PROGRESS'
                : 'PASSENGER_WAITING_DRIVER',
            serviceAreaId: selectedOriginArea?.id),
        imageUrl: _bannerImageUrl,
        onTap: _openBanner,
        onImpression: (banner) =>
            unawaited(_reportBannerEvent(banner, 'IMPRESSION')),
      ),
      const SizedBox(height: 12),
      _routeSummary(context, card: true),
      Row(children: [
        Expanded(
          child: OutlinedButton.icon(
            onPressed: () => dialPhone(context, active?['driverPhone']),
            icon: const Icon(Icons.call_outlined),
            label: const Text('Llamar'),
            style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(54),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(18))),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: OutlinedButton.icon(
            onPressed: () => openPassengerChat(null),
            icon: const Icon(Icons.chat_bubble_outline),
            label: const Text('Mensaje'),
            style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(54),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(18))),
          ),
        ),
      ]),
      const SizedBox(height: 10),
      FilledButton.icon(
        onPressed: () => showTripSafety(
          context: context,
          trip: active,
          counterpart: active?['driverName']?.toString() ?? 'mi conductor',
          location: currentLocation,
        ),
        icon: const Icon(Icons.shield_outlined),
        label: const Text('Seguridad y compartir viaje'),
      ),
    ];
  }

  List<Widget> _mapSelectionContent(BuildContext context) {
    final isOrigin = mapSelection == MapPointSelection.origin;
    final address = (isOrigin
            ? origin.text
            : _destinationController(selectedDestinationIndex).text)
        .trim();
    return [
      Text(
          isOrigin
              ? 'Fija tu punto de partida'
              : 'Fija el destino ${selectedDestinationIndex + 1}',
          textAlign: TextAlign.center,
          style: Theme.of(context)
              .textTheme
              .titleLarge
              ?.copyWith(fontWeight: FontWeight.w800)),
      const SizedBox(height: 4),
      const Text('Arrastra el marcador o toca el punto exacto en el mapa.',
          textAlign: TextAlign.center),
      const SizedBox(height: 14),
      Card(
        margin: EdgeInsets.zero,
        child: ListTile(
          leading: Icon(
              isOrigin ? Icons.person_pin_circle : Icons.flag_outlined,
              color:
                  isOrigin ? const Color(0xff008b9a) : const Color(0xffef5b4d)),
          title: Text(address.isEmpty ? 'Ubicación seleccionada' : address,
              maxLines: 2, overflow: TextOverflow.ellipsis),
          subtitle: Text(selectionResolving
              ? 'Obteniendo dirección…'
              : 'La coordenada exacta se conservará al confirmar.'),
          trailing: selectionResolving
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2))
              : null,
        ),
      ),
      const SizedBox(height: 14),
      FilledButton.icon(
        onPressed: pendingMapPoint == null ||
                (serviceAreaCatalog != null && pendingSelectionArea == null)
            ? null
            : confirmVisibleMapPoint,
        icon: const Icon(Icons.check),
        label: Text(isOrigin ? 'Confirmar origen' : 'Confirmar destino'),
      ),
      TextButton(
        onPressed: () {
          selectionLookupGeneration++;
          setState(() {
            mapSelection = null;
            pendingMapPoint = null;
            selectionResolving = false;
            selectionMoving = false;
            message = null;
          });
          _movePassengerSheet(.35);
        },
        child: const Text('Cancelar ajuste'),
      ),
    ];
  }

  void addDestination() {
    if (additionalStops.length >= 2) return;
    setState(() => additionalStops.add(PassengerStopDraft()));
    _movePassengerSheet(.78);
  }

  void removeDestination(int index) {
    if (index == 0 || index > additionalStops.length) return;
    setState(() {
      additionalStops.removeAt(index - 1).dispose();
      routePoints = [];
      routeDistanceMeters = null;
      routeDurationSeconds = null;
    });
    unawaited(refreshRoute(force: true));
  }

  void reorderDestinations(int oldIndex, int newIndex) {
    if (newIndex > oldIndex) newIndex--;
    if (oldIndex == newIndex) return;
    final controllers = [
      destination,
      ...additionalStops.map((stop) => stop.controller)
    ];
    final points = [dropoff, ...additionalStops.map((stop) => stop.point)];
    final values = controllers.map((controller) => controller.text).toList();
    final movedText = values.removeAt(oldIndex);
    final movedPoint = points.removeAt(oldIndex);
    values.insert(newIndex, movedText);
    points.insert(newIndex, movedPoint);
    setState(() {
      for (var index = 0; index < controllers.length; index++) {
        controllers[index].text = values[index];
        _setDestinationPoint(index, points[index]);
      }
      routePoints = [];
    });
    unawaited(refreshRoute(force: true));
  }

  Widget destinationField(int index) {
    final controller = _destinationController(index);
    return Padding(
      key: ValueKey('destination-$index-${controller.hashCode}'),
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
        ReorderableDragStartListener(
          index: index,
          child: CircleAvatar(
            radius: 17,
            backgroundColor: Theme.of(context).colorScheme.primary,
            child: Text('${index + 1}',
                style: const TextStyle(
                    color: Colors.white, fontWeight: FontWeight.w800)),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _PassengerSurface(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
            child: TextField(
              controller: controller,
              onTap: () => _movePassengerSheet(.78),
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                labelText: 'Destino ${index + 1}',
                hintText: 'Dirección o punto en el mapa',
                fillColor: Colors.transparent,
                suffixIcon: Row(mainAxisSize: MainAxisSize.min, children: [
                  if (controller.text.isNotEmpty)
                    IconButton(
                        tooltip: 'Borrar destino',
                        icon: const Icon(Icons.close, size: 20),
                        onPressed: () => clearDestination(index)),
                  IconButton(
                      tooltip: 'Ajustar en el mapa',
                      icon: const Icon(Icons.edit_outlined),
                      onPressed: () => beginMapSelection(
                          MapPointSelection.destination,
                          destinationIndex: index)),
                  IconButton(
                      tooltip: 'Buscar dirección',
                      icon: const Icon(Icons.search),
                      onPressed: () => locate(false, destinationIndex: index)),
                ]),
              ),
            ),
          ),
        ),
        if (index > 0)
          IconButton(
              tooltip: 'Eliminar destino',
              onPressed: () => removeDestination(index),
              icon: const Icon(Icons.remove_circle_outline)),
      ]),
    );
  }

  List<Widget> _requestContent(BuildContext context) => [
        if (serviceAreaCatalog?.reviewArea != null)
          Card(
            color: Theme.of(context).colorScheme.secondaryContainer,
            child: SwitchListTile(
              secondary: const Icon(Icons.verified_user_outlined),
              title: const Text('Modo de revisión de Google Play'),
              subtitle: Text(reviewLocationActive
                  ? 'Usando la ubicación autorizada de pruebas.'
                  : 'Permite revisar el flujo aunque el dispositivo esté fuera de cobertura.'),
              value: reviewLocationActive,
              onChanged: active == null
                  ? (_) => unawaited(togglePassengerReviewLocation())
                  : null,
            ),
          ),
        _PassengerSurface(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(children: [
            const _CostaGoEmblem(size: 48),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                        nearbyDrivers.isEmpty
                            ? 'No hay mototaxis disponibles cerca ahora'
                            : '${nearbyDrivers.length} mototaxi(s) disponible(s) cerca',
                        style: Theme.of(context)
                            .textTheme
                            .titleSmall
                            ?.copyWith(fontWeight: FontWeight.w900)),
                    const SizedBox(height: 2),
                    Text(
                        nearbyDrivers.isEmpty
                            ? 'Te avisaremos cuando haya uno disponible.'
                            : 'Puedes solicitar tu viaje cuando estés listo.',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: Theme.of(context)
                                .colorScheme
                                .onSurfaceVariant)),
                  ]),
            ),
            IconButton(
              tooltip: 'Viajes programados',
              onPressed: showScheduledTrips,
              icon: const Icon(Icons.event_note_outlined),
            ),
          ]),
        ),
        const SizedBox(height: 14),
        const _PassengerSectionTitle('Origen',
            icon: Icons.location_on_outlined),
        Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
          Expanded(
            child: TextField(
              controller: origin,
              onTap: () => _movePassengerSheet(.72),
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                hintText: 'Escribe una dirección o mueve el mapa',
                suffixIcon: origin.text.isEmpty
                    ? null
                    : IconButton(
                        tooltip: 'Borrar origen',
                        icon: const Icon(Icons.close),
                        onPressed: () => clearPoint(true)),
              ),
            ),
          ),
          const SizedBox(width: 7),
          IconButton.filledTonal(
              tooltip: 'Lugares favoritos',
              onPressed: showFavoritePlaces,
              icon: const Icon(Icons.star_outline)),
          IconButton.filledTonal(
              tooltip: 'Usar ubicación actual',
              onPressed: () => unawaited(useCurrentLocation(explicit: true)),
              icon: const Icon(Icons.my_location_outlined)),
          IconButton.filledTonal(
              tooltip: 'Buscar dirección',
              onPressed: () => locate(true),
              icon: const Icon(Icons.search)),
        ]),
        const SizedBox(height: 12),
        _PassengerSectionTitle(
          'Destinos y paradas',
          icon: Icons.flag_outlined,
          trailing: IconButton.filled(
            tooltip: additionalStops.length >= 2
                ? 'Máximo tres destinos'
                : 'Agregar parada',
            onPressed: additionalStops.length >= 2 ? null : addDestination,
            icon: const Icon(Icons.add),
          ),
        ),
        ReorderableListView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          buildDefaultDragHandles: false,
          itemCount: 1 + additionalStops.length,
          onReorderItem: reorderDestinations,
          itemBuilder: (context, index) => destinationField(index),
        ),
        const _PassengerSectionTitle('Programación',
            icon: Icons.schedule_outlined),
        Row(children: [
          Expanded(
            child: SegmentedButton<bool>(
              segments: const [
                ButtonSegment(
                    value: false,
                    icon: Icon(Icons.bolt_outlined),
                    label: Text('Ahora')),
                ButtonSegment(
                    value: true,
                    icon: Icon(Icons.calendar_month_outlined),
                    label: Text('Programar para más tarde')),
              ],
              selected: {scheduledFor != null},
              onSelectionChanged: (value) async {
                if (value.first) {
                  await chooseSchedule();
                } else {
                  setState(() => scheduledFor = null);
                }
              },
            ),
          ),
        ]),
        if (scheduledFor == null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              'Las reservas requieren al menos $scheduledMinimumNoticeMinutes minutos de anticipación.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
        if (scheduledFor != null)
          ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.event_available_outlined),
            title: Text(MaterialLocalizations.of(context)
                .formatMediumDate(scheduledFor!)),
            subtitle:
                Text(TimeOfDay.fromDateTime(scheduledFor!).format(context)),
            trailing: TextButton(
                onPressed: chooseSchedule, child: const Text('Modificar')),
          ),
        const SizedBox(height: 12),
        const _PassengerSectionTitle('Referencia para encontrarte',
            icon: Icons.chat_bubble_outline, subtitle: '(opcional)'),
        TextField(
          controller: notes,
          onTap: () => _movePassengerSheet(.72),
          onChanged: (_) => setState(() {}),
          maxLength: 300,
          maxLines: 2,
          textInputAction: TextInputAction.done,
          onSubmitted: (_) => FocusScope.of(context).unfocus(),
          decoration: InputDecoration(
            hintText: 'Ej: Frente a la iglesia, puerta azul, etc.',
            suffixIcon: notes.text.isEmpty
                ? null
                : IconButton(
                    tooltip: 'Borrar referencia',
                    icon: const Icon(Icons.close),
                    onPressed: () {
                      notes.clear();
                      setState(() {});
                    },
                  ),
          ),
        ),
        LayoutBuilder(builder: (context, constraints) {
          final narrow = constraints.maxWidth < 460;
          final passengerSelector =
              Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const _PassengerSectionTitle('Número de pasajeros',
                icon: Icons.group_outlined, subtitle: '(máximo 3)'),
            SegmentedButton<int>(
              segments: const [
                ButtonSegment(value: 1, label: Text('1')),
                ButtonSegment(value: 2, label: Text('2')),
                ButtonSegment(value: 3, label: Text('3')),
              ],
              selected: {people},
              onSelectionChanged: (value) =>
                  setState(() => people = value.first),
            ),
          ]);
          final paymentSelector =
              Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const _PassengerSectionTitle('Método de pago',
                icon: Icons.account_balance_wallet_outlined),
            DropdownButtonFormField<String>(
              initialValue: paymentMethod,
              items: const [
                DropdownMenuItem(
                    value: 'CASH', child: Text('Pago en efectivo')),
                DropdownMenuItem(
                    value: 'DEUNA', child: Text('Pago con De Una')),
              ],
              onChanged: (value) => setState(() => paymentMethod = value!),
            ),
          ]);
          if (narrow) {
            return Column(children: [
              passengerSelector,
              const SizedBox(height: 8),
              paymentSelector,
            ]);
          }
          return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(child: passengerSelector),
            const SizedBox(width: 12),
            Expanded(child: paymentSelector),
          ]);
        }),
        if (message != null)
          Padding(
              padding: const EdgeInsets.symmetric(vertical: 10),
              child: Text(message!)),
        if (active == null && pickup == null)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: OutlinedButton.icon(
              onPressed: initialLocationLoading
                  ? null
                  : () => unawaited(initializePassengerLocation()),
              icon: initialLocationLoading
                  ? const SizedBox.square(
                      dimension: 16,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.my_location_outlined),
              label: Text(initialLocationLoading
                  ? 'Confirmando ubicación…'
                  : 'Volver a intentar GPS'),
            ),
          ),
        const SizedBox(height: 10),
        _CostaGoPrimaryButton(
          label:
              requestSubmitting ? 'Creando solicitud…' : 'Solicitar mototaxi',
          loading: requestSubmitting,
          onPressed: requestSubmitting || _currentRequestPayload() == null
              ? null
              : create,
        ),
      ];

  @override
  Widget build(BuildContext context) {
    final originLabel = cleanAddressLabel(
        active?['originReference'] ?? origin.text,
        fallback: 'Origen');
    final destinationLabel = cleanAddressLabel(
        active?['destinationReference'] ?? destination.text,
        fallback: 'Destino');
    final status = active?['status']?.toString();
    final searching = status == 'SEARCHING';
    final editing = active == null && mapSelection != null;

    return PopScope(
        canPop: false,
        onPopInvokedWithResult: (didPop, _) {
          if (!didPop) SystemNavigator.pop();
        },
        child: Scaffold(
          body: LayoutBuilder(builder: (context, constraints) {
            final safeTop = MediaQuery.paddingOf(context).top;
            return Stack(children: [
              Positioned.fill(
                child: AnimatedBuilder(
                  animation: passengerSheetController,
                  builder: (context, _) {
                    final extent = passengerSheetController.isAttached
                        ? passengerSheetController.size
                        : sheetExtent;
                    // While choosing a point, the selector must not move when the
                    // bottom sheet expands or collapses. The map and fixed pin use
                    // a stable viewport; after confirmation normal dynamic
                    // padding is restored for routes and trip markers.
                    final mapBottomPadding =
                        editing ? 16.0 : constraints.maxHeight * extent + 16;
                    return LiveMap(
                      originLabel: originLabel,
                      destinationLabel: destinationLabel,
                      pickup: pickup,
                      dropoff: editing &&
                              mapSelection == MapPointSelection.destination
                          ? _destinationPoint(selectedDestinationIndex)
                          : _finalDestinationPoint,
                      stops: editing
                          ? const []
                          : (_destinationPoints.length <= 1
                              ? const []
                              : _destinationPoints.sublist(
                                  0, _destinationPoints.length - 1)),
                      currentLocation: currentLocation,
                      referenceLocation: mapReferenceLocation ??
                          serviceAreaCatalog?.referenceCenter,
                      driverPosition: driverPosition,
                      driverBearing: driverBearing,
                      routePoints: routePoints,
                      nearbyDrivers: active == null
                          ? nearbyDrivers
                          : const <String, LatLng>{},
                      editing: active == null ? mapSelection : null,
                      onSelectionCenterChanged:
                          editing ? selectionCenterChanged : null,
                      onSelectionSettled: editing ? previewMapSelection : null,
                      onSelectionMovementStarted:
                          editing ? selectionMovementStarted : null,
                      onUseCurrentLocation:
                          active == null ? useCurrentLocation : null,
                      onCenterCurrentLocation: centerPassengerCurrentLocation,
                      fillAvailable: true,
                      borderRadius: 0,
                      viewportPadding: EdgeInsets.fromLTRB(
                          12, safeTop + 72, 12, mapBottomPadding),
                    );
                  },
                ),
              ),
              Positioned(
                top: safeTop + 8,
                left: 28,
                right: 28,
                child: RoleAwareHeaderIsland(
                  session: widget.s,
                  onAccount: () async {
                    final draft = await profile(context, widget.s);
                    if (draft != null && mounted) applyRepeatDraft(draft);
                  },
                ),
              ),
              DraggableScrollableSheet(
                controller: passengerSheetController,
                initialChildSize: .35,
                minChildSize: .18,
                maxChildSize: .92,
                snap: true,
                snapSizes: const [.28, .52, .9],
                builder: (context, scrollController) => Material(
                  color: Theme.of(context).colorScheme.surface,
                  elevation: 16,
                  shadowColor: Colors.black45,
                  borderRadius:
                      const BorderRadius.vertical(top: Radius.circular(28)),
                  clipBehavior: Clip.antiAlias,
                  child: ListView(
                    controller: scrollController,
                    padding: EdgeInsets.fromLTRB(
                        20, 10, 20, MediaQuery.paddingOf(context).bottom + 20),
                    children: [
                      Center(
                        child: Container(
                          width: 44,
                          height: 5,
                          decoration: BoxDecoration(
                            color: Theme.of(context)
                                .colorScheme
                                .onSurfaceVariant
                                .withValues(alpha: .35),
                            borderRadius: BorderRadius.circular(8),
                          ),
                        ),
                      ),
                      const SizedBox(height: 14),
                      if (editing)
                        ..._mapSelectionContent(context)
                      else if (searching)
                        ..._searchingContent(context)
                      else if (active != null)
                        ..._activeTripContent(context)
                      else
                        ..._requestContent(context),
                    ],
                  ),
                ),
              ),
            ]);
          }),
        ));
  }
}

class Driver extends StatefulWidget {
  const Driver(this.s, {super.key});
  final Session s;
  @override
  State<Driver> createState() => _DriverState();
}

class _DriverState extends State<Driver> with WidgetsBindingObserver {
  final api = Api();
  final driverSheetController = DraggableScrollableController();
  final offerPageController = PageController(viewportFraction: .94);
  late final RealtimeService realtime;
  dynamic active;
  List offers = [];
  List scheduledOffers = [];
  List scheduledTrips = [];
  DateTime? lastScheduledRefreshAt;
  DateTime? lastActiveProbeAt;
  bool available = false;
  String? driverMessage;
  Timer? timer;
  StreamSubscription<RemoteMessage>? messageSubscription;
  StreamSubscription<RemoteMessage>? openedMessageSubscription;
  StreamSubscription<Position>? positionSubscription;
  StreamSubscription<Map<String, dynamic>>? realtimeSubscription;
  LatLng? currentDriverPosition;
  final Map<String, LatLng> nearbyDriverPositions = {};
  DateTime? lastNearbyRefreshAt;
  double currentDriverBearing = 0;
  String? resolvedDriverOrigin;
  String? resolvedOriginTripId;
  List<LatLng> routePoints = [];
  DateTime? lastRouteAt;
  bool driverChatOpen = false;
  final Map<String, DateTime> announcedOfferIds = <String, DateTime>{};
  int offerIndex = 0;
  String? preloadedRouteTripId;
  List<LatLng>? preloadedTripRoute;
  bool routePreparing = false;
  String? promptedRatingTripId;
  final Set<String> processingOfferIds = <String>{};
  bool initialPushHandled = false;
  ServiceArea? driverReviewArea;
  bool driverReviewLocationActive = false;
  Map<String, dynamic> platformConfig = const {
    'navigation': {
      'pickupProvider': 'EXTERNAL_MAPS',
      'destinationProvider': 'EXTERNAL_MAPS',
      'pickupStartMode': 'MANUAL',
      'destinationStartMode': 'MANUAL',
    }
  };
  Map<String, dynamic>? membershipData;
  DateTime? lastMembershipRefreshAt;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    realtime = RealtimeService(baseUrl: base, token: widget.s.token);
    realtimeSubscription = realtime.events.listen(handleRealtime);
    realtime.connect();
    unawaited(UserNotificationStore.instance.refresh(widget.s));
    if (firebaseReady) {
      messageSubscription = FirebaseMessaging.onMessage.listen((message) {
        unawaited(UserNotificationStore.instance.refresh(widget.s));
        if (message.data['type'] == 'CHAT_MESSAGE' && !driverChatOpen) {
          if (!mounted) return;
          InAppNotificationBanner.show(
            context,
            id: 'chat-${message.data['messageId'] ?? message.data['tripId']}',
            title: message.notification?.title ?? 'Nuevo mensaje del pasajero',
            message: message.notification?.body ??
                'Tienes un nuevo mensaje sobre tu viaje.',
            actionLabel: 'Abrir',
            icon: Icons.chat_bubble_outline,
            onTap: () => openDriverChat(message.data['tripId'],
                notificationId: message.data['internalNotificationId']),
          );
        }
        if (message.data['type'] == 'TRIP_OFFER') {
          announceTripOffer(
            message.data['tripId']?.toString(),
            title: message.notification?.title,
            body: message.notification?.body,
            eventAt: message.data['eventAt']?.toString(),
          );
        }
        if (message.data['type'] == 'TRIP_CANCELLED' && mounted) {
          setState(() => driverMessage =
              message.data['reason'] == 'ADMIN_CANCELLED'
                  ? 'El viaje fue cancelado por administración.'
                  : 'El pasajero canceló la solicitud.');
        }
        if (message.data['type'] == 'TRIP_OFFER' ||
            message.data['type'] == 'TRIP_OFFER_CANCELLED' ||
            message.data['type'] == 'TRIP_CANCELLED') {
          refresh();
        }
        if (message.data['type']?.toString().startsWith('MEMBERSHIP_') ==
            true) {
          unawaited(refreshMembership(force: true));
        }
        if (const {
          'SCHEDULED_TRIP_AVAILABLE',
          'SCHEDULED_TRIP_ACCEPTED',
          'SCHEDULED_DRIVER_REMINDER',
          'SCHEDULED_TRIP_RELEASED'
        }.contains(message.data['type'])) {
          if (!mounted) return;
          InAppNotificationBanner.show(
            context,
            id: 'scheduled-${message.data['tripId']}-${message.data['type']}',
            title: message.notification?.title ?? 'Viaje programado',
            message: message.notification?.body ??
                'Hay una actualización en tus viajes programados.',
            actionLabel: 'Ver',
            icon: Icons.event_available_outlined,
            onTap: showDriverScheduledTrips,
          );
          if (message.data['type'] == 'SCHEDULED_DRIVER_REMINDER') {
            unawaited(syncActivatedScheduledTrip(force: true));
          } else {
            unawaited(refreshScheduled(force: true));
          }
        }
      });
      openedMessageSubscription =
          FirebaseMessaging.onMessageOpenedApp.listen((message) {
        handleOpenedPush(message);
      });
      Future.microtask(restoreInitialPush);
    }
    unawaited(initializeDriver());
    timer = Timer.periodic(const Duration(seconds: 5), (_) => refresh());
  }

  Future<void> initializeDriver() async {
    try {
      final values = await Future.wait([
        api.mobileConfig(widget.s.token),
        api.driverMembership(widget.s.token),
      ]);
      if (mounted) {
        setState(() {
          platformConfig = Map<String, dynamic>.from(values[0]);
          membershipData = Map<String, dynamic>.from(values[1]);
          lastMembershipRefreshAt = DateTime.now();
        });
      }
    } catch (_) {
      // El mapa y el estado del conductor siguen disponibles con valores seguros.
    }
    try {
      final response = Map<String, dynamic>.from(
          await api.serviceAreas(widget.s.token) as Map);
      final catalog = ServiceAreaCatalog.fromJson(response);
      if (mounted) setState(() => driverReviewArea = catalog.reviewArea);
    } catch (_) {
      // Una cuenta normal no necesita configuración de revisión.
    }
    await restore();
  }

  Future<void> refreshMembership({bool force = false}) async {
    final now = DateTime.now();
    if (!force &&
        lastMembershipRefreshAt != null &&
        now.difference(lastMembershipRefreshAt!) < const Duration(minutes: 1)) {
      return;
    }
    try {
      final value = await api.driverMembership(widget.s.token);
      if (!mounted) return;
      setState(() {
        membershipData = value;
        lastMembershipRefreshAt = now;
      });
      if (value['eligibility']?['eligible'] == false &&
          active == null &&
          available) {
        await api.available(widget.s.token, false);
        await positionSubscription?.cancel();
        positionSubscription = null;
        if (mounted) {
          setState(() {
            available = false;
            driverMessage =
                'Tu membresía venció. Renueva para volver a recibir solicitudes.';
          });
        }
      }
    } catch (_) {}
  }

  Map<String, dynamic> get _navigationConfig => Map<String, dynamic>.from(
      platformConfig['navigation'] as Map? ?? const {});

  String _navigationProvider(String status) => status == 'IN_PROGRESS'
      ? (_navigationConfig['destinationProvider']?.toString() ??
          'EXTERNAL_MAPS')
      : (_navigationConfig['pickupProvider']?.toString() ?? 'EXTERNAL_MAPS');

  String _navigationStartMode(String status) => status == 'IN_PROGRESS'
      ? (_navigationConfig['destinationStartMode']?.toString() ?? 'MANUAL')
      : (_navigationConfig['pickupStartMode']?.toString() ?? 'MANUAL');

  bool get _membershipEligible =>
      membershipData?['eligibility']?['eligible'] != false;

  LatLng? get driverReviewPoint => driverReviewArea?.reviewLocation;

  Future<void> toggleDriverReviewLocation(bool enabled) async {
    if (driverReviewPoint == null || active != null) return;
    final wasAvailable = available;
    if (wasAvailable) {
      await api.available(widget.s.token, false);
      await positionSubscription?.cancel();
      positionSubscription = null;
    }
    if (!mounted) return;
    setState(() {
      driverReviewLocationActive = enabled;
      currentDriverPosition = enabled ? driverReviewPoint : null;
      nearbyDriverPositions.clear();
      driverMessage = enabled
          ? 'Modo de revisión activo en ${driverReviewArea!.name}.'
          : 'Modo de revisión desactivado.';
    });
    if (wasAvailable) await startGpsTracking(markAvailable: true);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    timer?.cancel();
    messageSubscription?.cancel();
    openedMessageSubscription?.cancel();
    positionSubscription?.cancel();
    realtimeSubscription?.cancel();
    realtime.dispose();
    driverSheetController.dispose();
    offerPageController.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      realtime.connect();
      unawaited(api.registerFcm(widget.s.token));
      unawaited(refreshMembership(force: true));
      unawaited(refresh());
    }
  }

  void handleOpenedPush(RemoteMessage push) {
    final target = notificationTargetFor(
        push.data['notificationRoute'] ?? push.data['type']);
    if (target == NotificationTarget.chat) {
      unawaited(openDriverChat(push.data['tripId'],
          notificationId: push.data['internalNotificationId']));
    } else if (target == NotificationTarget.support &&
        push.data['incidentId'] != null) {
      unawaited(Navigator.push(
          context,
          MaterialPageRoute(
              builder: (_) => SupportIncidentDetail(
                  widget.s, push.data['incidentId'].toString()))));
    } else if (target == NotificationTarget.scheduledTrips) {
      if (push.data['type'] == 'SCHEDULED_DRIVER_REMINDER') {
        unawaited(syncActivatedScheduledTrip(force: true));
      } else {
        unawaited(showDriverScheduledTrips());
      }
    } else if (target == NotificationTarget.membership) {
      unawaited(refreshMembership(force: true).then((_) {
        if (mounted) return _showMembershipDetails();
      }));
    } else if (target == NotificationTarget.inbox) {
      unawaited(Navigator.push(context,
          MaterialPageRoute(builder: (_) => NotificationCenterView(widget.s))));
    } else {
      unawaited(refresh());
    }
  }

  Future<void> restoreInitialPush() async {
    if (initialPushHandled) return;
    final push = await FirebaseMessaging.instance.getInitialMessage();
    if (!mounted || push == null) return;
    initialPushHandled = true;
    handleOpenedPush(push);
  }

  Future<void> announceTripOffer(String? tripId,
      {String? title, String? body, String? eventAt}) async {
    if (!mounted || tripId == null || tripId.isEmpty) return;
    final now = DateTime.now();
    announcedOfferIds.removeWhere(
        (_, value) => now.difference(value) > const Duration(minutes: 3));
    final previous = announcedOfferIds[tripId];
    if (previous != null &&
        now.difference(previous) < const Duration(seconds: 8)) {
      debugPrint('Evento duplicado de solicitud ignorado: $tripId');
      return;
    }
    announcedOfferIds[tripId] = now;
    var nativeNotificationShown = false;
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      try {
        nativeNotificationShown =
            await nativeActions.invokeMethod<bool>('showForegroundTripOffer', {
                  'tripId': tripId,
                  'title': title ?? 'Nuevo viaje disponible',
                  'body': body ?? 'Un pasajero solicita un viaje cercano.',
                }) ??
                false;
      } on PlatformException catch (error) {
        debugPrint(
            'No se pudo mostrar la alerta sonora del viaje: ${error.code}');
      }
    }
    if (!mounted) return;
    // Android muestra una notificación nativa con sonido. El banner queda como
    // respaldo para otras plataformas o cuando el permiso fue rechazado, para
    // no presentar dos avisos distintos por la misma oferta.
    final shown = nativeNotificationShown ||
        InAppNotificationBanner.show(
          context,
          id: 'trip-offer-$tripId',
          title: title ?? 'Nuevo viaje disponible',
          message: body ?? 'Un pasajero solicita un viaje cercano.',
          actionLabel: 'Ver viaje',
          onTap: () {
            _moveDriverSheet(.58);
            unawaited(refresh());
          },
        );
    if (!shown) return;
    final generatedAt = eventAt == null ? null : DateTime.tryParse(eventAt);
    if (generatedAt != null) {
      debugPrint(
          'Solicitud visible ${DateTime.now().difference(generatedAt).inMilliseconds} ms después del evento.');
    }
  }

  void _moveDriverSheet(double size) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !driverSheetController.isAttached) return;
      driverSheetController.animateTo(
        size.clamp(.18, .92),
        duration: const Duration(milliseconds: 320),
        curve: Curves.easeOutCubic,
      );
    });
  }

  Future<void> openDriverChat(String? requestedTripId,
      {String? notificationId}) async {
    ScaffoldMessenger.of(context).hideCurrentSnackBar();
    if (driverChatOpen) return;
    if (notificationId != null) {
      try {
        await api.markNotificationRead(widget.s.token, notificationId);
        await UserNotificationStore.instance.refresh(widget.s);
      } catch (_) {
        // El chat debe abrir aunque la confirmacion de lectura falle.
      }
    }
    if (active == null) await refresh();
    if (!mounted) return;
    final tripId = requestedTripId ?? active?['tripId']?.toString();
    if (tripId == null || active?['tripId']?.toString() != tripId) return;
    driverChatOpen = true;
    try {
      await showTripChat(
        context: context,
        tripId: tripId,
        userId: widget.s.id,
        realtime: realtime,
        loadHistory: () => api.messages(widget.s.token, tripId),
        sendFallback: (clientId, body) =>
            api.sendMessage(widget.s.token, tripId, clientId, body),
      );
    } finally {
      driverChatOpen = false;
      if (mounted) ScaffoldMessenger.of(context).hideCurrentSnackBar();
    }
  }

  void handleRealtime(Map<String, dynamic> event) {
    if (!mounted) return;
    if (event['type'] == 'connected' && active?['tripId'] != null) {
      realtime.subscribeTrip(active['tripId'].toString());
    } else if (event['type'] == 'trip:offer') {
      final tripId = event['tripId']?.toString();
      announceTripOffer(tripId, eventAt: event['eventAt']?.toString());
      refresh();
    } else if (event['type'] == 'trip:offer:cancelled') {
      final tripId = event['tripId']?.toString();
      if (tripId != null && mounted) {
        setState(() => offers
            .removeWhere((offer) => offer['tripId']?.toString() == tripId));
      }
      refresh();
    } else if (event['type'] == 'trip:stop-completed') {
      final completed = event['completedStop'] is Map
          ? Map<String, dynamic>.from(event['completedStop'] as Map)
          : <String, dynamic>{};
      final order = (completed['order'] as num?)?.toInt();
      if (mounted) {
        setState(() => driverMessage = order == null
            ? 'Parada completada. Continúa al siguiente destino.'
            : 'Destino $order finalizado. Continúa al siguiente destino.');
      }
      refresh();
    } else if (event['type'] == 'trip:status') {
      if (active == null) {
        unawaited(syncActivatedScheduledTrip(force: true));
      } else {
        unawaited(refresh());
      }
    } else if (event['type'] == 'chat:message') {
      if (driverChatOpen) return;
      final value = Map<String, dynamic>.from(event['message'] as Map);
      InAppNotificationBanner.show(
        context,
        id: 'chat-${value['id'] ?? value['messageId'] ?? value['clientMessageId'] ?? DateTime.now().millisecondsSinceEpoch}',
        title: 'Nuevo mensaje del pasajero',
        message: value['body']?.toString() ??
            'Tienes un nuevo mensaje sobre tu viaje.',
        actionLabel: 'Abrir',
        icon: Icons.chat_bubble_outline,
        onTap: () => openDriverChat(value['tripId']?.toString(),
            notificationId: value['notificationId']?.toString()),
      );
    }
  }

  LatLng pointFrom(Position position) =>
      LatLng(position.latitude, position.longitude);

  Future<void> startGpsTracking({required bool markAvailable}) async {
    final reviewPoint = driverReviewLocationActive ? driverReviewPoint : null;
    if (reviewPoint != null) {
      await positionSubscription?.cancel();
      positionSubscription = null;
      if (markAvailable) {
        await api.available(widget.s.token, true, reviewPoint);
      }
      sendReviewPosition(reviewPoint);
      return;
    }
    final position = await currentGpsPosition(context);
    if (markAvailable) {
      await api.available(widget.s.token, true, pointFrom(position));
    }
    sendPosition(position);
    await positionSubscription?.cancel();
    final activeStatus = active?['status']?.toString();
    final foregroundTitle = activeStatus == null
        ? 'Costa-Go · Ubicación disponible'
        : 'Costa-Go · Ubicación del viaje';
    final foregroundText = switch (activeStatus) {
      'ASSIGNED' ||
      'DRIVER_EN_ROUTE' =>
        'Seguimiento GPS activo mientras vas al punto de recogida.',
      'DRIVER_ARRIVED' =>
        'Seguimiento GPS activo mientras esperas al pasajero.',
      'IN_PROGRESS' => 'Seguimiento GPS activo durante el recorrido.',
      _ => 'Ubicación activa para recibir viajes cercanos.'
    };
    positionSubscription = Geolocator.getPositionStream(
            locationSettings: AndroidSettings(
                accuracy: LocationAccuracy.high,
                distanceFilter: 10,
                intervalDuration: const Duration(seconds: 10),
                foregroundNotificationConfig: ForegroundNotificationConfig(
                    notificationTitle: foregroundTitle,
                    notificationText: foregroundText,
                    notificationChannelName: 'Ubicación y viajes Costa-Go',
                    notificationIcon: const AndroidResource(
                        name: 'ic_notification', defType: 'drawable'),
                    color: const Color(0xff00aeef),
                    setOngoing: true,
                    enableWakeLock: true)))
        .listen(sendPosition);
  }

  Future<LatLng?> centerDriverCurrentLocation() async {
    if (driverReviewLocationActive && driverReviewPoint != null) {
      final point = driverReviewPoint!;
      if (mounted) setState(() => currentDriverPosition = point);
      return point;
    }
    try {
      final position = await currentGpsPosition(context);
      final point = pointFrom(position);
      if (!mounted) return null;
      setState(() {
        currentDriverPosition = point;
        currentDriverBearing = position.heading < 0 ? 0 : position.heading;
      });
      return point;
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.toString())));
      }
      return null;
    }
  }

  void sendPosition(Position position) {
    if (mounted) {
      setState(() {
        currentDriverPosition = pointFrom(position);
        currentDriverBearing = position.heading < 0 ? 0 : position.heading;
      });
    }
    final sent = realtime.sendDriverLocation(
      tripId: active?['tripId']?.toString(),
      latitude: position.latitude,
      longitude: position.longitude,
      bearing: position.heading,
      speed: position.speed,
      accuracy: position.accuracy,
      recordedAt: position.timestamp,
      sequence: position.timestamp.millisecondsSinceEpoch,
    );
    if (!sent && available && active == null) {
      api
          .available(widget.s.token, true, pointFrom(position))
          .catchError((_) {});
    }
    if (available && active == null) {
      unawaited(refreshNearbyDriverPositions(pointFrom(position)));
    }
    refreshDriverRoute();
  }

  void sendReviewPosition(LatLng point) {
    if (mounted) {
      setState(() {
        currentDriverPosition = point;
        currentDriverBearing = 0;
      });
    }
    final now = DateTime.now();
    realtime.sendDriverLocation(
      tripId: active?['tripId']?.toString(),
      latitude: point.latitude,
      longitude: point.longitude,
      bearing: 0,
      speed: 0,
      accuracy: 5,
      recordedAt: now,
      sequence: now.millisecondsSinceEpoch,
    );
  }

  Future<void> refreshNearbyDriverPositions(LatLng point) async {
    final now = DateTime.now();
    if (lastNearbyRefreshAt != null &&
        now.difference(lastNearbyRefreshAt!) < const Duration(seconds: 15)) {
      return;
    }
    lastNearbyRefreshAt = now;
    try {
      final items = await api.nearbyDrivers(widget.s.token, point);
      if (!mounted || active != null || !available) return;
      setState(() {
        nearbyDriverPositions
          ..clear()
          ..addEntries(items.map((item) => MapEntry(
              item['driverId'].toString(),
              LatLng((item['latitude'] as num).toDouble(),
                  (item['longitude'] as num).toDouble()))));
      });
    } catch (_) {
      // Mantiene el último snapshot visible cuando la señal es inestable.
    }
  }

  Future<void> restore({bool adjustSheet = true}) async {
    unawaited(api.registerFcm(widget.s.token));
    final values = await Future.wait(
        [api.active(widget.s.token), api.driverState(widget.s.token)]);
    if (!mounted) return;
    final serverAvailable = values[1]['available'] == true;
    setState(() {
      active = values[0];
      available = serverAvailable;
      if (active == null) {
        routePoints = [];
      } else {
        nearbyDriverPositions.clear();
        offers = [];
      }
    });
    if (adjustSheet) _moveDriverSheet(active == null ? .30 : .50);
    if (active == null) unawaited(checkPendingDriverRating());
    if (active != null) {
      unawaited(resolveOriginAddress(active));
      unawaited(preloadActiveTripRoute(active));
    }
    if (serverAvailable || active != null) {
      try {
        await startGpsTracking(markAvailable: serverAvailable);
        if (active?['tripId'] != null) {
          realtime.subscribeTrip(active['tripId'].toString());
        }
        if (mounted) {
          setState(() => driverMessage =
              'Ubicación GPS activa. Esperando solicitudes cercanas.');
        }
      } catch (e) {
        await api.available(widget.s.token, false);
        if (mounted) {
          setState(() {
            available = false;
            driverMessage = e.toString();
          });
        }
      }
      await refresh();
    } else {
      await positionSubscription?.cancel();
      positionSubscription = null;
    }
  }

  Future<void> toggle(bool v) async {
    if (v && !_membershipEligible) {
      setState(() => driverMessage =
          'Tu membresía no permite recibir solicitudes. Revisa su estado y las opciones de renovación.');
      return;
    }
    try {
      if (v) {
        await startGpsTracking(markAvailable: true);
      } else {
        await api.available(widget.s.token, false);
        await positionSubscription?.cancel();
        positionSubscription = null;
      }
      if (!mounted) return;
      setState(() {
        available = v;
        if (!v) nearbyDriverPositions.clear();
        driverMessage = v
            ? 'Ubicación GPS activa. Esperando solicitudes cercanas.'
            : 'No recibirás nuevas solicitudes.';
      });
      await refresh();
    } catch (e) {
      if (mounted) setState(() => driverMessage = e.toString());
    }
  }

  Future<void> refresh() async {
    try {
      unawaited(refreshMembership());
      if (driverReviewLocationActive &&
          driverReviewPoint != null &&
          (available || active != null)) {
        sendReviewPosition(driverReviewPoint!);
      }
      await refreshScheduled();
      if (active == null) await syncActivatedScheduledTrip();
      if (active != null) {
        final latest = await api.trip(widget.s.token, active['tripId']);
        if (latest['status'] == 'COMPLETED') {
          final completedTripId = latest['tripId'].toString();
          if (mounted) {
            setState(() {
              active = null;
              routePoints = [];
              preloadedTripRoute = null;
              preloadedRouteTripId = null;
              driverMessage = 'Viaje finalizado. Registra la calificación.';
            });
          }
          await promptDriverRating(completedTripId);
          await restore();
          return;
        }
        if (latest['status'] == 'CANCELLED') {
          if (mounted) {
            setState(() => driverMessage =
                latest['cancellationReason'] == 'ADMIN_CANCELLED'
                    ? 'El viaje fue cancelado por administración.'
                    : 'El viaje fue cancelado.');
          }
          await restore();
          return;
        }
        if (mounted) {
          setState(() {
            active = latest;
            offers = [];
          });
        }
        unawaited(resolveOriginAddress(latest));
        realtime.subscribeTrip(latest['tripId'].toString());
        refreshDriverRoute();
      }
      if (active == null && available) {
        final r = await api.offers(widget.s.token);
        if (mounted) {
          final hadOffers = offers.isNotEmpty;
          final unique = <String, dynamic>{};
          for (final offer in r) {
            unique[offer['tripId'].toString()] = offer;
          }
          setState(() {
            offers = unique.values.toList();
            if (offerIndex >= offers.length) offerIndex = 0;
          });
          if (!hadOffers && r.isNotEmpty) _moveDriverSheet(.48);
        }
      } else if (offers.isNotEmpty && mounted) {
        setState(() => offers = []);
      }
    } catch (e) {
      if (mounted) setState(() => driverMessage = e.toString());
    }
  }

  Future<bool> syncActivatedScheduledTrip({bool force = false}) async {
    if (active != null) return true;
    final now = DateTime.now();
    if (!force &&
        lastActiveProbeAt != null &&
        now.difference(lastActiveProbeAt!) < const Duration(seconds: 10)) {
      return false;
    }
    lastActiveProbeAt = now;
    try {
      final latest = await api.active(widget.s.token);
      if (latest == null || !mounted) return false;
      setState(() {
        active = latest;
        available = false;
        offers = [];
        nearbyDriverPositions.clear();
        driverMessage = 'Tu viaje programado está listo para iniciar.';
      });
      _moveDriverSheet(.50);
      realtime.subscribeTrip(latest['tripId'].toString());
      unawaited(resolveOriginAddress(latest));
      unawaited(preloadActiveTripRoute(latest));
      try {
        await startGpsTracking(markAvailable: false);
      } catch (error) {
        debugPrint('No se pudo actualizar el GPS del viaje programado: $error');
      }
      return true;
    } catch (error) {
      debugPrint('No se pudo sincronizar el viaje programado activo: $error');
      return false;
    }
  }

  Future<void> refreshScheduled({bool force = false}) async {
    final now = DateTime.now();
    if (!force &&
        lastScheduledRefreshAt != null &&
        now.difference(lastScheduledRefreshAt!) < const Duration(seconds: 30)) {
      return;
    }
    lastScheduledRefreshAt = now;
    try {
      final values = await Future.wait([
        api.scheduledOffers(widget.s.token),
        api.scheduledTrips(widget.s.token),
      ]);
      if (!mounted) return;
      setState(() {
        scheduledOffers = values[0];
        scheduledTrips = values[1];
      });
    } catch (error) {
      debugPrint('No se pudieron actualizar los viajes programados: $error');
    }
  }

  Future<void> showDriverScheduledTrips() async {
    await refreshScheduled(force: true);
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: FractionallySizedBox(
          heightFactor: .84,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
            children: [
              Text('Viajes programados disponibles',
                  style: Theme.of(context).textTheme.titleLarge),
              if (scheduledOffers.isEmpty)
                const ListTile(
                    title: Text('No hay solicitudes programadas disponibles.')),
              ...scheduledOffers.map((value) {
                final offer = Map<String, dynamic>.from(value);
                final date =
                    DateTime.tryParse(offer['scheduledFor']?.toString() ?? '');
                final stops = List<dynamic>.from(offer['stops'] ?? const []);
                final scheme = Theme.of(sheetContext).colorScheme;
                return Card(
                  margin: const EdgeInsets.only(top: 10),
                  elevation: 0,
                  color: scheme.surfaceContainerLow,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(20),
                    side: BorderSide(color: scheme.outlineVariant),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(children: [
                          Container(
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              color: scheme.primaryContainer,
                              borderRadius: BorderRadius.circular(13),
                            ),
                            child: const Icon(Icons.event_available_outlined),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                      date == null
                                          ? 'Viaje programado'
                                          : TimeOfDay.fromDateTime(
                                                  date.toLocal())
                                              .format(context),
                                      style: Theme.of(context)
                                          .textTheme
                                          .titleLarge
                                          ?.copyWith(
                                              fontWeight: FontWeight.w900)),
                                  if (date != null)
                                    Text(MaterialLocalizations.of(context)
                                        .formatFullDate(date.toLocal())),
                                ]),
                          ),
                        ]),
                        const SizedBox(height: 14),
                        _ScheduledRouteRow(
                          icon: Icons.my_location,
                          label: 'Origen',
                          value: cleanAddressLabel(offer['originReference'],
                              fallback: 'Origen'),
                          color: scheme.primary,
                        ),
                        ...stops
                            .asMap()
                            .entries
                            .map((entry) => _ScheduledRouteRow(
                                  icon: entry.key == stops.length - 1
                                      ? Icons.flag_rounded
                                      : Icons.location_on_outlined,
                                  label: entry.key == stops.length - 1
                                      ? 'Destino final'
                                      : 'Parada ${entry.key + 1}',
                                  value: cleanAddressLabel(
                                      entry.value['reference'],
                                      fallback: 'Destino'),
                                  color: entry.key == stops.length - 1
                                      ? scheme.error
                                      : scheme.tertiary,
                                )),
                        Wrap(spacing: 12, runSpacing: 6, children: [
                          Chip(
                              avatar:
                                  const Icon(Icons.people_outline, size: 17),
                              label:
                                  Text('${offer['passengers']} pasajero(s)')),
                          if (offer['distanceMeters'] != null)
                            Chip(
                                label: Text(
                                    '${((offer['distanceMeters'] as num) / 1000).toStringAsFixed(1)} km')),
                          if (offer['durationSeconds'] != null)
                            Chip(
                                label: Text(
                                    '${((offer['durationSeconds'] as num) / 60).ceil()} min')),
                          if (offer['quotedTotalCents'] != null)
                            Chip(
                                label: Text(
                                    '\$${((offer['quotedTotalCents'] as num) / 100).toStringAsFixed(2)}')),
                        ]),
                        const Divider(height: 24),
                        _ScheduledCounterpartCard(
                          token: widget.s.token,
                          userId: offer['passengerId']?.toString(),
                          name: offer['passengerName']?.toString(),
                          hasPhoto: offer['passengerHasPhoto'] == true,
                          rating: ((offer['passengerRating'] as num?) ?? 0)
                              .toDouble(),
                          roleLabel: 'Pasajero',
                        ),
                        const SizedBox(height: 12),
                        Row(children: [
                          Expanded(
                            child: OutlinedButton(
                              onPressed: () async {
                                await api.respondScheduled(widget.s.token,
                                    offer['tripId'].toString(), false);
                                if (sheetContext.mounted) {
                                  Navigator.pop(sheetContext);
                                }
                                await refreshScheduled(force: true);
                              },
                              child: const Text('Rechazar'),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: FilledButton(
                              onPressed: () async {
                                await api.respondScheduled(widget.s.token,
                                    offer['tripId'].toString(), true);
                                if (sheetContext.mounted) {
                                  Navigator.pop(sheetContext);
                                }
                                await refreshScheduled(force: true);
                              },
                              child: const Text('Aceptar'),
                            ),
                          ),
                        ]),
                      ],
                    ),
                  ),
                );
              }),
              const Divider(height: 32),
              Text('Mis próximos viajes',
                  style: Theme.of(context).textTheme.titleLarge),
              if (scheduledTrips.isEmpty)
                const ListTile(title: Text('No tienes reservas aceptadas.')),
              ...scheduledTrips.map((value) {
                final trip = Map<String, dynamic>.from(value);
                final date =
                    DateTime.tryParse(trip['scheduledFor']?.toString() ?? '');
                final scheme = Theme.of(sheetContext).colorScheme;
                return Card(
                  elevation: 0,
                  color: scheme.surfaceContainerLow,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(18),
                    side: BorderSide(color: scheme.outlineVariant),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(15),
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                              date == null
                                  ? 'Próximo viaje'
                                  : '${MaterialLocalizations.of(context).formatMediumDate(date.toLocal())} · ${TimeOfDay.fromDateTime(date.toLocal()).format(context)}',
                              style: Theme.of(context)
                                  .textTheme
                                  .titleMedium
                                  ?.copyWith(fontWeight: FontWeight.w900)),
                          const SizedBox(height: 10),
                          _ScheduledRouteRow(
                            icon: Icons.my_location,
                            label: 'Origen',
                            value: cleanAddressLabel(trip['originReference'],
                                fallback: 'Origen'),
                            color: scheme.primary,
                          ),
                          _ScheduledRouteRow(
                            icon: Icons.flag_rounded,
                            label: 'Destino final',
                            value: cleanAddressLabel(
                                trip['destinationReference'],
                                fallback: 'Destino'),
                            color: scheme.error,
                          ),
                          const Divider(height: 20),
                          _ScheduledCounterpartCard(
                            token: widget.s.token,
                            userId: trip['passengerId']?.toString(),
                            name: trip['passengerName']?.toString(),
                            hasPhoto: trip['passengerHasPhoto'] == true,
                            rating: ((trip['passengerRating'] as num?) ?? 0)
                                .toDouble(),
                            roleLabel: 'Pasajero',
                          ),
                          if (trip['scheduleStatus'] == 'SCHEDULED_ASSIGNED')
                            Align(
                              alignment: Alignment.centerRight,
                              child: TextButton.icon(
                                icon: const Icon(Icons.event_busy_outlined),
                                label: const Text('Liberar reserva'),
                                onPressed: () async {
                                  await api.releaseScheduled(widget.s.token,
                                      trip['tripId'].toString());
                                  if (sheetContext.mounted) {
                                    Navigator.pop(sheetContext);
                                  }
                                  await refreshScheduled(force: true);
                                },
                              ),
                            ),
                        ]),
                  ),
                );
              }),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> resolveOriginAddress(dynamic trip) async {
    final tripId = trip?['tripId']?.toString();
    if (tripId == null || resolvedOriginTripId == tripId) return;
    resolvedOriginTripId = tripId;
    if (mounted) setState(() => resolvedDriverOrigin = null);
    final reference = trip['originReference']?.toString().trim() ?? '';
    if (reference.isNotEmpty &&
        reference.toLowerCase() != 'mi ubicación actual' &&
        reference.toLowerCase() != 'mi ubicacion actual') {
      if (mounted) setState(() => resolvedDriverOrigin = reference);
      return;
    }
    if (trip['originLatitude'] == null || trip['originLongitude'] == null) {
      return;
    }
    try {
      final result = await api.reverse(
          widget.s.token,
          LatLng((trip['originLatitude'] as num).toDouble(),
              (trip['originLongitude'] as num).toDouble()));
      if (mounted && active?['tripId']?.toString() == tripId) {
        setState(() => resolvedDriverOrigin = result['label']?.toString());
      }
    } catch (_) {
      // Conserva el texto original si el geocodificador no está disponible.
    }
  }

  Future<void> refreshDriverRoute({bool force = false}) async {
    final current = currentDriverPosition;
    if (active == null || current == null) return;
    final now = DateTime.now();
    if (!force &&
        lastRouteAt != null &&
        now.difference(lastRouteAt!) < const Duration(seconds: 45)) {
      return;
    }
    final pickup = active['originLatitude'] == null
        ? null
        : LatLng((active['originLatitude'] as num).toDouble(),
            (active['originLongitude'] as num).toDouble());
    var dropoff = active['destinationLatitude'] == null
        ? null
        : LatLng((active['destinationLatitude'] as num).toDouble(),
            (active['destinationLongitude'] as num).toDouble());
    if (active['status'] == 'IN_PROGRESS') {
      final remainingStops = List<dynamic>.from(active['stops'] ?? const [])
          .where((stop) => stop['completedAt'] == null)
          .toList();
      if (remainingStops.isNotEmpty) {
        dropoff = LatLng((remainingStops.first['latitude'] as num).toDouble(),
            (remainingStops.first['longitude'] as num).toDouble());
      }
    }
    final target = active['status'] == 'IN_PROGRESS' ? dropoff : pickup;
    if (target == null) return;
    lastRouteAt = now;
    try {
      final route = await api.route(widget.s.token, current, target,
          tripId: active['tripId']?.toString(), purpose: 'ACTIVE_TRIP');
      final points = List<dynamic>.from(route['points'] ?? const [])
          .map((point) => LatLng((point['latitude'] as num).toDouble(),
              (point['longitude'] as num).toDouble()))
          .toList();
      if (mounted) setState(() => routePoints = points);
    } catch (_) {
      if (mounted && force) setState(() => routePoints = [current, target]);
    }
  }

  Future<void> preloadActiveTripRoute(dynamic trip) async {
    final tripId = trip?['tripId']?.toString();
    if (tripId == null || preloadedRouteTripId == tripId) return;
    final pickup = trip['originLatitude'] == null
        ? null
        : LatLng((trip['originLatitude'] as num).toDouble(),
            (trip['originLongitude'] as num).toDouble());
    var dropoff = trip['destinationLatitude'] == null
        ? null
        : LatLng((trip['destinationLatitude'] as num).toDouble(),
            (trip['destinationLongitude'] as num).toDouble());
    final stopPoints = List<dynamic>.from(trip['stops'] ?? const [])
        .map((stop) => LatLng((stop['latitude'] as num).toDouble(),
            (stop['longitude'] as num).toDouble()))
        .toList();
    if (stopPoints.isNotEmpty) dropoff = stopPoints.last;
    if (pickup == null || dropoff == null) return;
    preloadedRouteTripId = tripId;
    final timer = Stopwatch()..start();
    try {
      final route = await api.route(widget.s.token, pickup, dropoff,
          waypoints: stopPoints.length <= 1
              ? const []
              : stopPoints.sublist(0, stopPoints.length - 1),
          tripId: tripId,
          purpose: 'PRELOAD');
      final points = List<dynamic>.from(route['points'] ?? const [])
          .map((point) => LatLng((point['latitude'] as num).toDouble(),
              (point['longitude'] as num).toDouble()))
          .toList();
      if (active?['tripId']?.toString() == tripId && points.isNotEmpty) {
        preloadedTripRoute = points;
        debugPrint(
            'Ruta anticipada lista en ${timer.elapsedMilliseconds} ms; cache=${route['cacheHit']}');
      }
    } catch (error) {
      if (preloadedRouteTripId == tripId) preloadedRouteTripId = null;
      debugPrint('No se pudo precargar la ruta del viaje: $error');
    }
  }

  List<DriverNavigationStop> _currentNavigationStops(String status) {
    final result = <DriverNavigationStop>[];
    if (status == 'DRIVER_EN_ROUTE') {
      if (active?['originLatitude'] == null ||
          active?['originLongitude'] == null) {
        return result;
      }
      result.add(DriverNavigationStop(
        latitude: (active['originLatitude'] as num).toDouble(),
        longitude: (active['originLongitude'] as num).toDouble(),
        label: cleanAddressLabel(active['originReference'],
            fallback: 'Punto de recogida'),
      ));
      return result;
    }
    final remaining = List<dynamic>.from(active?['stops'] ?? const [])
        .where((stop) => stop['completedAt'] == null);
    for (final stop in remaining) {
      result.add(DriverNavigationStop(
        latitude: (stop['latitude'] as num).toDouble(),
        longitude: (stop['longitude'] as num).toDouble(),
        label: cleanAddressLabel(stop['reference'], fallback: 'Destino'),
      ));
    }
    if (result.isEmpty &&
        active?['destinationLatitude'] != null &&
        active?['destinationLongitude'] != null) {
      result.add(DriverNavigationStop(
        latitude: (active['destinationLatitude'] as num).toDouble(),
        longitude: (active['destinationLongitude'] as num).toDouble(),
        label: cleanAddressLabel(active['destinationReference'],
            fallback: 'Destino'),
      ));
    }
    return result;
  }

  Future<void> _openExternalNavigation(
      String status, List<DriverNavigationStop> stops) async {
    final validStops = stops.where((stop) {
      return stop.latitude.isFinite &&
          stop.longitude.isFinite &&
          stop.latitude >= -90 &&
          stop.latitude <= 90 &&
          stop.longitude >= -180 &&
          stop.longitude <= 180;
    }).toList(growable: false);
    if (validStops.isEmpty) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text(
                'No se encontraron coordenadas válidas para iniciar la navegación.')));
      }
      return;
    }
    final destination = validStops.last;
    final parameters = <String, String>{
      'api': '1',
      'destination': '${destination.latitude},${destination.longitude}',
      'travelmode': 'driving',
      'dir_action': 'navigate',
      if (validStops.length > 1)
        'waypoints': validStops
            .sublist(0, validStops.length - 1)
            .map((stop) => '${stop.latitude},${stop.longitude}')
            .join('|'),
    };
    final googleUri = Uri.https('www.google.com', '/maps/dir/', parameters);
    final appleUri = Uri.https('maps.apple.com', '/', {
      'daddr': '${destination.latitude},${destination.longitude}',
      'dirflg': 'd',
    });
    var opened = false;
    try {
      if (defaultTargetPlatform == TargetPlatform.android &&
          validStops.length == 1) {
        // Abre directamente Google Maps y evita el navegador intermedio.
        final nativeGoogleUri = Uri(
          scheme: 'google.navigation',
          queryParameters: <String, String>{
            'q': '${destination.latitude},${destination.longitude}',
            'mode': 'd',
          },
        );
        opened = await launchUrl(nativeGoogleUri,
            mode: LaunchMode.externalNonBrowserApplication);
      }
      if (!opened) {
        final target =
            defaultTargetPlatform == TargetPlatform.iOS ? appleUri : googleUri;
        opened = await launchUrl(target, mode: LaunchMode.externalApplication);
      }
    } on PlatformException catch (error) {
      debugPrint('EXTERNAL_NAVIGATION_ERROR status=$status code=${error.code}');
    } catch (error) {
      debugPrint(
          'EXTERNAL_NAVIGATION_ERROR status=$status type=${error.runtimeType}');
    }
    if (!opened && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text(
              'No se pudo abrir Google Maps. Verifica que esté instalado y actualizado.')));
    }
  }

  Future<void> openDriverNavigation() async {
    if (active == null) return;
    final status = active['status']?.toString();
    if (status != 'DRIVER_EN_ROUTE' && status != 'IN_PROGRESS') return;
    final provider = _navigationProvider(status!);
    final navigationStops = _currentNavigationStops(status);
    if (navigationStops.isEmpty) return;
    if (provider == 'MAP_ONLY') {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('La ruta está visible en el mapa de Costa-Go.')));
      }
      return;
    }
    if (provider == 'EXTERNAL_MAPS' || !navigationSdkEnabled) {
      await _openExternalNavigation(status, navigationStops);
      return;
    }
    var current = currentDriverPosition;
    if (current == null) {
      try {
        current = pointFrom(await currentGpsPosition(context));
      } catch (_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
              content: Text('Activa la ubicación precisa para navegar.')));
        }
        return;
      }
    }

    if (!mounted) return;

    String? routeToken;
    final routeTimer = Stopwatch()..start();
    try {
      final destination = navigationStops.last;
      final route = await api.route(
        widget.s.token,
        current,
        LatLng(destination.latitude, destination.longitude),
        waypoints: navigationStops.length <= 1
            ? const []
            : navigationStops
                .sublist(0, navigationStops.length - 1)
                .map((stop) => LatLng(stop.latitude, stop.longitude))
                .toList(),
        tripId: active['tripId']?.toString(),
        purpose: 'NAVIGATION',
        includeRouteToken: true,
      );
      routeToken = route['routeToken']?.toString();
      debugPrint(
          'NAVIGATION_ROUTE_READY durationMs=${routeTimer.elapsedMilliseconds} token=${routeToken?.isNotEmpty == true} provider=${route['provider']}');
    } catch (error) {
      debugPrint(
          'NAVIGATION_ROUTE_TOKEN_UNAVAILABLE type=${error.runtimeType}');
      // Navigation SDK puede calcular la ruta; LiveMap sigue siendo el fallback.
    }
    if (!mounted) return;
    final result = await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (_) => DriverNavigationScreen(
          stops: navigationStops,
          routeToken: routeToken,
          phaseLabel:
              status == 'IN_PROGRESS' ? 'En viaje' : 'Recogiendo pasajero',
        ),
      ),
    );
    if (mounted && result == false) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text(
              'Navigation SDK no está disponible. Continúa con el mapa actual.')));
    }
  }

  Future<void> progress(BuildContext c, String action) async {
    final tripId = active['tripId'];
    if (action == 'COMPLETE_STOP') {
      await completeCurrentStop();
      return;
    }
    final timer = Stopwatch()..start();
    if (action == 'START' && mounted) setState(() => routePreparing = true);
    try {
      await api.action(widget.s.token, tripId, action);
      if (action == 'START' && mounted) {
        final cached =
            preloadedRouteTripId == tripId ? preloadedTripRoute : null;
        setState(() {
          active = {
            ...Map<String, dynamic>.from(active as Map),
            'status': 'IN_PROGRESS'
          };
          if (cached != null && cached.isNotEmpty) routePoints = cached;
          routePreparing = false;
        });
        debugPrint(
            'Inicio de viaje visible en ${timer.elapsedMilliseconds} ms; rutaAnticipada=${cached?.isNotEmpty == true}');
        unawaited(refreshDriverRoute(force: true));
        unawaited(restore(adjustSheet: false));
        if (_navigationStartMode('IN_PROGRESS') == 'AUTO') {
          unawaited(openDriverNavigation());
        }
        return;
      }
      if (action == 'COMPLETE') {
        if (mounted) {
          setState(() {
            active = null;
            routePoints = [];
            preloadedTripRoute = null;
            preloadedRouteTripId = null;
            driverMessage = 'Viaje finalizado. Registra la calificación.';
          });
        }
        if (!c.mounted) return;
        await promptDriverRating(tripId.toString());
        await restore();
        await refresh();
        return;
      }
      await restore(adjustSheet: false);
      await refresh();
    } finally {
      if (mounted && routePreparing) setState(() => routePreparing = false);
    }
  }

  Future<void> cancelAcceptedTrip() async {
    final tripId = active?['tripId']?.toString();
    final status = active?['status']?.toString();
    if (tripId == null ||
        !const {'ASSIGNED', 'DRIVER_EN_ROUTE'}.contains(status)) {
      return;
    }
    var reason = 'VEHICLE_PROBLEM';
    final observation = TextEditingController();
    final confirmed = await showDialog<bool>(
          context: context,
          builder: (dialogContext) => StatefulBuilder(
            builder: (context, setDialogState) => AlertDialog(
              icon: const Icon(Icons.cancel_outlined),
              title: const Text('Cancelar carrera'),
              content: SingleChildScrollView(
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  const Text(
                      'El pasajero será informado y Costa-Go buscará automáticamente otro conductor.'),
                  const SizedBox(height: 14),
                  DropdownButtonFormField<String>(
                    initialValue: reason,
                    decoration: const InputDecoration(labelText: 'Motivo'),
                    items: const [
                      DropdownMenuItem(
                          value: 'VEHICLE_PROBLEM',
                          child: Text('Problema con la mototaxi')),
                      DropdownMenuItem(
                          value: 'PERSONAL_EMERGENCY',
                          child: Text('Emergencia personal')),
                      DropdownMenuItem(
                          value: 'CANNOT_REACH_PICKUP',
                          child: Text('No puedo llegar al punto de recogida')),
                      DropdownMenuItem(
                          value: 'PASSENGER_CONTACT_ISSUE',
                          child: Text('No logro contactar al pasajero')),
                      DropdownMenuItem(value: 'OTHER', child: Text('Otro')),
                    ],
                    onChanged: (value) => setDialogState(() => reason = value!),
                  ),
                  if (reason == 'OTHER') ...[
                    const SizedBox(height: 12),
                    TextField(
                      controller: observation,
                      onChanged: (_) => setDialogState(() {}),
                      maxLength: 500,
                      maxLines: 3,
                      decoration: const InputDecoration(
                          labelText: 'Explica brevemente el motivo'),
                    ),
                  ],
                ]),
              ),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(dialogContext, false),
                    child: const Text('Volver')),
                FilledButton(
                  onPressed:
                      reason == 'OTHER' && observation.text.trim().length < 3
                          ? null
                          : () => Navigator.pop(dialogContext, true),
                  child: const Text('Confirmar cancelación'),
                ),
              ],
            ),
          ),
        ) ??
        false;
    if (!confirmed) {
      observation.dispose();
      return;
    }
    final idempotencyKey =
        'driver-cancel-$tripId-${DateTime.now().microsecondsSinceEpoch}';
    try {
      await api.cancelAssignedTrip(widget.s.token, tripId,
          reason: reason,
          observation: observation.text,
          idempotencyKey: idempotencyKey);
      if (!mounted) return;
      setState(() {
        active = null;
        routePoints = [];
        available = true;
        driverMessage =
            'Carrera cancelada. El pasajero está buscando otro conductor.';
      });
      await restore();
      await refresh();
    } catch (error) {
      if (mounted) setState(() => driverMessage = error.toString());
    } finally {
      observation.dispose();
    }
  }

  Future<void> promptDriverRating(String tripId) async {
    if (!mounted || promptedRatingTripId == tripId) return;
    promptedRatingTripId = tripId;
    await rating(context, widget.s, tripId, () => {});
  }

  Future<void> checkPendingDriverRating() async {
    try {
      final pending = await api.pendingRating(widget.s.token);
      final tripId = pending?['tripId']?.toString();
      if (!mounted || tripId == null) return;
      await promptDriverRating(tripId);
    } catch (_) {
      // Se vuelve a consultar al restaurar la sesión o abrir Mi cuenta.
    }
  }

  Future<void> completeCurrentStop() async {
    final tripId = active?['tripId']?.toString();
    final remaining = List<dynamic>.from(active?['stops'] ?? const [])
        .where((stop) => stop['completedAt'] == null)
        .toList();
    if (tripId == null || remaining.length <= 1) return;
    try {
      await api.completeStop(
          widget.s.token, tripId, remaining.first['id'].toString());
      lastRouteAt = null;
      if (mounted) {
        final completedOrder = (remaining.first['order'] as num?)?.toInt();
        setState(() {
          final stops = List<dynamic>.from(active?['stops'] ?? const []);
          active = {
            ...Map<String, dynamic>.from(active as Map),
            'status': 'IN_PROGRESS',
            'stops': stops
                .map((stop) =>
                    stop['id']?.toString() == remaining.first['id']?.toString()
                        ? {
                            ...Map<String, dynamic>.from(stop as Map),
                            'completedAt': DateTime.now().toIso8601String()
                          }
                        : stop)
                .toList(),
          };
          driverMessage = completedOrder == null
              ? 'Parada completada. Continúa al siguiente destino.'
              : 'Destino $completedOrder finalizado. Continúa al siguiente destino.';
          routePoints = [];
        });
      }
      await refresh();
      await refreshDriverRoute(force: true);
    } catch (error) {
      if (mounted) setState(() => driverMessage = error.toString());
    }
  }

  String? next() {
    if (active?['status'] == 'IN_PROGRESS') {
      final remaining = List<dynamic>.from(active?['stops'] ?? const [])
          .where((stop) => stop['completedAt'] == null)
          .length;
      return remaining > 1 ? 'COMPLETE_STOP' : 'COMPLETE';
    }
    return {
      'ASSIGNED': 'EN_ROUTE',
      'DRIVER_EN_ROUTE': 'ARRIVED',
      'DRIVER_ARRIVED': 'START',
    }[active?['status']];
  }

  String label(String a) => {
        'EN_ROUTE': 'Estoy en camino',
        'ARRIVED': 'Ya llegué',
        'START': 'Iniciar viaje',
        'COMPLETE_STOP': 'Finalizar destino actual',
        'COMPLETE': 'Finalizar viaje'
      }[a]!;

  Widget _passengerPhoto({double size = 54}) {
    final passengerId = active?['passengerId']?.toString();
    final hasPhoto =
        active?['passengerHasPhoto'] == true && passengerId != null;
    final fallback = Container(
      width: size,
      height: size,
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: Icon(Icons.person_outline, size: size * .55),
    );
    return ClipOval(
      child: hasPhoto
          ? Image.network(
              '$base/v1/users/$passengerId/profile-photo',
              headers: {'Authorization': 'Bearer ${widget.s.token}'},
              width: size,
              height: size,
              fit: BoxFit.cover,
              errorBuilder: (_, __, ___) => fallback,
            )
          : fallback,
    );
  }

  Widget _driverRoutePoint({
    required IconData icon,
    required String label,
    required String value,
    bool drawLine = false,
  }) {
    final colors = Theme.of(context).colorScheme;
    return IntrinsicHeight(
      child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SizedBox(
          width: 34,
          child: Column(children: [
            Icon(icon, color: colors.primary, size: 25),
            if (drawLine)
              Expanded(
                child: Container(
                  width: 2,
                  margin: const EdgeInsets.symmetric(vertical: 4),
                  color: colors.primary.withValues(alpha: .28),
                ),
              ),
          ]),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.only(bottom: 14),
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(label,
                  style: Theme.of(context).textTheme.labelLarge?.copyWith(
                      color: colors.primary, fontWeight: FontWeight.w800)),
              const SizedBox(height: 3),
              Text(value,
                  style: Theme.of(context)
                      .textTheme
                      .titleMedium
                      ?.copyWith(fontWeight: FontWeight.w600)),
            ]),
          ),
        ),
      ]),
    );
  }

  Widget _driverCompactAction({
    required IconData icon,
    required String label,
    required VoidCallback? onPressed,
  }) =>
      Expanded(
        child: OutlinedButton.icon(
          onPressed: onPressed,
          icon: Icon(icon),
          label: Text(label, textAlign: TextAlign.center),
          style: OutlinedButton.styleFrom(
            minimumSize: const Size(0, 54),
            padding: const EdgeInsets.symmetric(horizontal: 8),
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(17)),
          ),
        ),
      );

  Future<void> showPassengerPhoto() => showDialog<void>(
        context: context,
        barrierDismissible: true,
        builder: (dialogContext) => Dialog(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              _passengerPhoto(size: 210),
              const SizedBox(height: 16),
              Text(active?['passengerName']?.toString() ?? 'Pasajero',
                  textAlign: TextAlign.center,
                  style: Theme.of(context)
                      .textTheme
                      .titleLarge
                      ?.copyWith(fontWeight: FontWeight.w800)),
              const SizedBox(height: 4),
              const Text('Pasajero Costa-Go'),
              const SizedBox(height: 6),
              Row(mainAxisSize: MainAxisSize.min, children: [
                const Icon(Icons.star, color: Colors.amber, size: 20),
                const SizedBox(width: 4),
                Text(((active?['passengerRating'] as num?) ?? 0)
                    .toStringAsFixed(1)),
              ]),
              const SizedBox(height: 14),
              FilledButton(
                  onPressed: () => Navigator.pop(dialogContext),
                  child: const Text('Cerrar')),
            ]),
          ),
        ),
      );

  Future<bool> _respondToOffer(dynamic offer,
      {required bool accept, bool confirmReject = false}) async {
    final offerId = offer['offerId']?.toString();
    final tripId = offer['tripId']?.toString();
    if (offerId == null || processingOfferIds.contains(offerId)) return false;
    if (!accept && confirmReject) {
      final confirmed = await showDialog<bool>(
            context: context,
            builder: (dialogContext) => AlertDialog(
              title: const Text('Rechazar esta solicitud'),
              content: const Text(
                  'Solo se quitará de tu lista. Otro conductor todavía podrá aceptarla.'),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(dialogContext, false),
                    child: const Text('Volver')),
                FilledButton(
                    onPressed: () => Navigator.pop(dialogContext, true),
                    child: const Text('Rechazar')),
              ],
            ),
          ) ??
          false;
      if (!confirmed) return false;
    }
    setState(() => processingOfferIds.add(offerId));
    try {
      await api.respond(widget.s.token, offerId, accept: accept);
      if (!mounted) return true;
      if (accept) {
        if (!kIsWeb &&
            defaultTargetPlatform == TargetPlatform.android &&
            tripId != null) {
          unawaited(nativeActions.invokeMethod<void>(
              'stopTripOfferAlert', {'tripId': tripId}).catchError((_) {}));
        }
        await restore();
        await refresh();
      } else {
        setState(() {
          offers.removeWhere((item) => item['offerId']?.toString() == offerId);
          if (offerIndex >= offers.length) offerIndex = 0;
        });
      }
      return true;
    } catch (error) {
      if (mounted) {
        setState(() => driverMessage = error.toString());
        await refresh();
      }
      return false;
    } finally {
      if (mounted) setState(() => processingOfferIds.remove(offerId));
    }
  }

  Widget _offerCard(BuildContext context, dynamic offer, int index) {
    final offerId = offer['offerId']?.toString() ?? 'offer-$index';
    final busy = processingOfferIds.contains(offerId);
    final distance = (offer['distanceMeters'] as num?)?.toDouble();
    final duration = (offer['durationSeconds'] as num?)?.toDouble();
    final fare = (offer['quotedTotalCents'] as num?)?.toInt();
    return Dismissible(
      key: ValueKey(offerId),
      direction: DismissDirection.down,
      confirmDismiss: (_) =>
          _respondToOffer(offer, accept: false, confirmReject: true),
      background: Container(
        alignment: Alignment.topCenter,
        padding: const EdgeInsets.only(top: 22),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.errorContainer,
          borderRadius: BorderRadius.circular(20),
        ),
        child: const Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.close),
          SizedBox(width: 8),
          Text('Soltar para rechazar'),
        ]),
      ),
      child: _PassengerSurface(
        padding: const EdgeInsets.all(18),
        child: SingleChildScrollView(
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const _CostaGoEmblem(size: 52),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  'Nuevo viaje · ${offer['passengers']} pasajero(s)',
                  style: Theme.of(context)
                      .textTheme
                      .titleLarge
                      ?.copyWith(fontWeight: FontWeight.w900),
                ),
              ),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 11, vertical: 7),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.primaryContainer,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  'Solicitud ${index + 1} de ${offers.length}',
                  style: Theme.of(context).textTheme.labelMedium?.copyWith(
                        color: Theme.of(context).colorScheme.onPrimaryContainer,
                        fontWeight: FontWeight.w900,
                      ),
                ),
              ),
            ]),
            const SizedBox(height: 16),
            _driverRoutePoint(
              icon: Icons.radio_button_checked,
              label: 'Origen',
              value: cleanAddressLabel(offer['originReference'],
                  fallback: 'Origen seleccionado'),
              drawLine: true,
            ),
            _driverRoutePoint(
              icon: Icons.location_on,
              label: 'Destino',
              value: List<dynamic>.from(offer['stops'] ?? const []).isEmpty
                  ? cleanAddressLabel(offer['destinationReference'],
                      fallback: 'Destino seleccionado')
                  : List<dynamic>.from(offer['stops'] ?? const [])
                      .asMap()
                      .entries
                      .map((entry) =>
                          '${entry.key + 1}. ${cleanAddressLabel(entry.value['reference'], fallback: 'Destino')}')
                      .join('\n'),
            ),
            if (offer['notes']?.toString().trim().isNotEmpty == true)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text('Referencia: ${offer['notes']}',
                    style: Theme.of(context).textTheme.bodyMedium),
              ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 13),
              decoration: BoxDecoration(
                color: Theme.of(context)
                    .colorScheme
                    .surfaceContainerHighest
                    .withValues(alpha: .48),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Wrap(
                alignment: WrapAlignment.spaceAround,
                spacing: 12,
                runSpacing: 10,
                children: [
                  if (distance != null)
                    _driverOfferDatum(Icons.route_outlined,
                        '${(distance / 1000).toStringAsFixed(1)} km', 'aprox.'),
                  if (duration != null)
                    _driverOfferDatum(Icons.schedule_outlined,
                        '${(duration / 60).ceil()} min', 'aprox.'),
                  if (fare != null)
                    _driverOfferDatum(Icons.sell_outlined,
                        '\$${(fare / 100).toStringAsFixed(2)}', ''),
                  _driverOfferDatum(
                      Icons.payments_outlined,
                      offer['paymentMethod'] == 'DEUNA' ? 'De Una' : 'Efectivo',
                      ''),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Row(children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: busy
                      ? null
                      : () => _respondToOffer(offer,
                          accept: false, confirmReject: true),
                  icon: const Icon(Icons.close),
                  label: const Text('Rechazar'),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, 56),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(18)),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _CostaGoPrimaryButton(
                  label: 'Aceptar',
                  loading: busy,
                  onPressed:
                      busy ? null : () => _respondToOffer(offer, accept: true),
                ),
              ),
            ]),
            const SizedBox(height: 10),
            Text('También puedes deslizar hacia abajo para rechazarla.',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant)),
          ]),
        ),
      ),
    );
  }

  Widget _driverOfferDatum(IconData icon, String value, String suffix) =>
      Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, size: 21, color: Theme.of(context).colorScheme.primary),
        const SizedBox(width: 6),
        Text(value, style: const TextStyle(fontWeight: FontWeight.w800)),
        if (suffix.isNotEmpty) ...[
          const SizedBox(width: 3),
          Text(suffix, style: Theme.of(context).textTheme.bodySmall),
        ],
      ]);

  Widget _offerCarousel(BuildContext context) => Column(children: [
        SizedBox(
          height: 470,
          child: PageView.builder(
            controller: offerPageController,
            itemCount: offers.length,
            onPageChanged: (value) => setState(() => offerIndex = value),
            itemBuilder: (context, index) =>
                _offerCard(context, offers[index], index),
          ),
        ),
        if (offers.length > 1)
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 5, 12, 2),
            child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              Icon(Icons.swipe_rounded,
                  size: 20, color: Theme.of(context).colorScheme.primary),
              const SizedBox(width: 8),
              Flexible(
                child: Text(
                  'Desliza horizontalmente para ver más solicitudes',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.labelMedium?.copyWith(
                        color: Theme.of(context).colorScheme.primary,
                        fontWeight: FontWeight.w800,
                      ),
                ),
              ),
            ]),
          ),
      ]);

  String _membershipStatusLabel(String status) => switch (status) {
        'ACTIVE' => 'Activa',
        'EXPIRING' => 'Próxima a vencer',
        'GRACE_PERIOD' => 'Período de gracia',
        'PAYMENT_DUE' => 'Pago pendiente',
        'SUSPENSION_PENDING_ACTIVE_TRIP' => 'Suspensión al finalizar el viaje',
        'SUSPENDED_NON_PAYMENT' => 'Membresía vencida',
        'SUSPENDED' => 'Suspendida',
        _ => 'Pendiente de activación',
      };

  Widget _membershipMapAccess(BuildContext context) {
    final data = membershipData;
    if (data == null) return const SizedBox.shrink();
    final membership =
        Map<String, dynamic>.from(data['membership'] as Map? ?? const {});
    final status = membership['status']?.toString() ?? 'PENDING';
    final color = switch (status) {
      'ACTIVE' => const Color(0xff24964f),
      'EXPIRING' => const Color(0xffd58a00),
      'GRACE_PERIOD' => const Color(0xffe17313),
      'PAYMENT_DUE' ||
      'SUSPENSION_PENDING_ACTIVE_TRIP' =>
        const Color(0xffd85b22),
      'SUSPENDED_NON_PAYMENT' || 'SUSPENDED' => const Color(0xffc93f3f),
      _ => const Color(0xff607d8b),
    };
    final icon = switch (status) {
      'ACTIVE' => Icons.verified_rounded,
      'EXPIRING' => Icons.timer_outlined,
      'GRACE_PERIOD' => Icons.hourglass_bottom_rounded,
      'PAYMENT_DUE' => Icons.payments_outlined,
      'SUSPENSION_PENDING_ACTIVE_TRIP' => Icons.warning_amber_rounded,
      'SUSPENDED_NON_PAYMENT' || 'SUSPENDED' => Icons.lock_clock_rounded,
      _ => Icons.schedule_rounded,
    };
    return Semantics(
      button: true,
      label: 'Membresía Costa-Go, ${_membershipStatusLabel(status)}',
      child: Material(
        color: color.withValues(alpha: .18),
        elevation: 4,
        shadowColor: Colors.black38,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: BorderSide(color: color.withValues(alpha: .72), width: 1.4),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: _showMembershipDetails,
          child: SizedBox.square(
            dimension: 46,
            child: Icon(icon, color: color, size: 27),
          ),
        ),
      ),
    );
  }

  Future<bool> _submitMembershipTransferProof(
      BuildContext context, Map<String, dynamic> order) async {
    final action = await showModalBottomSheet<String>(
        context: context,
        showDragHandle: true,
        builder: (sheetContext) => SafeArea(
                child: Column(mainAxisSize: MainAxisSize.min, children: [
              ListTile(
                  leading: const Icon(Icons.camera_alt_outlined),
                  title: const Text('Tomar fotografía del comprobante'),
                  onTap: () => Navigator.pop(sheetContext, 'CAMERA')),
              ListTile(
                  leading: const Icon(Icons.photo_library_outlined),
                  title: const Text('Elegir imagen de la galería'),
                  subtitle: const Text('JPG, PNG o WEBP · máximo 5 MB'),
                  onTap: () => Navigator.pop(sheetContext, 'GALLERY')),
              ListTile(
                  leading: const Icon(Icons.picture_as_pdf_outlined),
                  title: const Text('Elegir PDF desde Archivos'),
                  subtitle: const Text('PDF · máximo 5 MB'),
                  onTap: () => Navigator.pop(sheetContext, 'DOCUMENT')),
            ])));
    if (action == null || !context.mounted) return false;
    late Uint8List bytes;
    late String filename;
    late String reportedMime;
    if (action == 'DOCUMENT') {
      final selected = await nativeActions
          .invokeMapMethod<String, dynamic>('pickDocument', const {
        'extensions': ['pdf']
      });
      if (selected == null || !context.mounted) return false;
      final rawBytes = selected['bytes'];
      if (rawBytes is! Uint8List) return false;
      bytes = rawBytes;
      filename = selected['name']?.toString().toLowerCase() ?? '';
      reportedMime = selected['mime']?.toString() ?? '';
    } else {
      final image = await ImagePicker().pickImage(
          source: action == 'CAMERA' ? ImageSource.camera : ImageSource.gallery,
          imageQuality: 78,
          maxWidth: 1800,
          maxHeight: 1800);
      if (image == null || !context.mounted) return false;
      bytes = await image.readAsBytes();
      filename = image.name.toLowerCase();
      reportedMime = filename.endsWith('.png')
          ? 'image/png'
          : filename.endsWith('.webp')
              ? 'image/webp'
              : 'image/jpeg';
    }
    if (bytes.length < 100 || bytes.length > 5242880) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Selecciona una imagen o PDF de hasta 5 MB.')));
      }
      return false;
    }
    final mime = reportedMime == 'application/pdf' || filename.endsWith('.pdf')
        ? 'application/pdf'
        : reportedMime == 'image/png' || filename.endsWith('.png')
            ? 'image/png'
            : reportedMime == 'image/webp' || filename.endsWith('.webp')
                ? 'image/webp'
                : 'image/jpeg';
    if (!context.mounted) return false;
    final bank = TextEditingController(text: 'Transferencia bancaria');
    final reference =
        TextEditingController(text: order['shortCode']?.toString() ?? '');
    final observation = TextEditingController();
    final amount = (order['totalAmount'] as num?)?.toDouble() ?? 0;
    var sending = false;
    final submitted = await showDialog<bool>(
          context: context,
          barrierDismissible: false,
          builder: (dialogContext) => StatefulBuilder(
            builder: (dialogContext, setDialogState) => AlertDialog(
              title: const Text('Adjuntar transferencia'),
              content: SingleChildScrollView(
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Text('Monto esperado: \$${amount.toStringAsFixed(2)}'),
                  const SizedBox(height: 12),
                  TextField(
                      controller: bank,
                      textCapitalization: TextCapitalization.words,
                      decoration: const InputDecoration(labelText: 'Banco')),
                  TextField(
                      controller: reference,
                      decoration: const InputDecoration(
                          labelText: 'Número o referencia de transferencia')),
                  TextField(
                      controller: observation,
                      maxLength: 500,
                      decoration: const InputDecoration(
                          labelText: 'Observación (opcional)')),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.attach_file_outlined),
                    title: Text(filename.isEmpty ? 'Comprobante' : filename),
                    subtitle: Text('${(bytes.length / 1024).ceil()} KB'),
                  ),
                ]),
              ),
              actions: [
                TextButton(
                    onPressed: sending
                        ? null
                        : () => Navigator.pop(dialogContext, false),
                    child: const Text('Cancelar')),
                FilledButton(
                  onPressed: sending
                      ? null
                      : () async {
                          if (bank.text.trim().length < 2 ||
                              reference.text.trim().length < 3) {
                            ScaffoldMessenger.of(dialogContext).showSnackBar(
                                const SnackBar(
                                    content: Text(
                                        'Ingresa el banco y la referencia.')));
                            return;
                          }
                          setDialogState(() => sending = true);
                          try {
                            await api.submitMembershipTransferProof(
                                widget.s.token, order['id'].toString(), {
                              'bankName': bank.text.trim(),
                              'reference': reference.text.trim(),
                              'transferDate': DateTime.now()
                                  .toLocal()
                                  .toIso8601String()
                                  .split('T')
                                  .first,
                              'declaredAmount': amount,
                              'fileMime': mime,
                              'fileBase64': base64Encode(bytes),
                              if (observation.text.trim().isNotEmpty)
                                'observation': observation.text.trim(),
                            });
                            if (dialogContext.mounted) {
                              Navigator.pop(dialogContext, true);
                            }
                          } catch (error) {
                            setDialogState(() => sending = false);
                            if (dialogContext.mounted) {
                              ScaffoldMessenger.of(dialogContext).showSnackBar(
                                  SnackBar(content: Text(error.toString())));
                            }
                          }
                        },
                  child: Text(sending ? 'Enviando...' : 'Enviar comprobante'),
                ),
              ],
            ),
          ),
        ) ??
        false;
    bank.dispose();
    reference.dispose();
    observation.dispose();
    if (submitted && context.mounted) {
      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (successContext) => AlertDialog(
          icon: Image.asset('assets/images/costa-go-emblem.png', width: 58),
          title:
              const Text('¡Gracias por tu pago!', textAlign: TextAlign.center),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            const Text('Hemos recibido tu comprobante correctamente.',
                textAlign: TextAlign.center),
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                  color: const Color(0xffe8f8ed),
                  borderRadius: BorderRadius.circular(14)),
              child: const Row(children: [
                Icon(Icons.check_circle, color: Color(0xff159447)),
                SizedBox(width: 10),
                Expanded(
                    child: Text(
                        'Tu pago será revisado y te notificaremos cuando se confirme.',
                        style: TextStyle(fontWeight: FontWeight.w700)))
              ]),
            ),
            const SizedBox(height: 12),
            Text(
                '${membershipPlanName(order['plan'])} · \$${((order['totalAmount'] as num?) ?? 0).toStringAsFixed(2)}'),
          ]),
          actions: [
            FilledButton(
                onPressed: () => Navigator.pop(successContext),
                child: const Text('Entendido'))
          ],
        ),
      );
    }
    return submitted;
  }

  String _membershipCancellationLabel(String? code) =>
      const {
        'ORDER_GENERATION_ERROR': 'Error al generar la orden',
        'WRONG_MEMBERSHIP': 'Seleccionó una membresía incorrecta',
        'CHANGED_MIND': 'Cambió de opinión',
        'DUPLICATE_ORDER': 'Orden duplicada',
        'OTHER': 'Otro motivo',
      }[code] ??
      'Sin detalle';

  Future<bool> _cancelMembershipOrder(
      BuildContext hostContext, Map<String, dynamic> order) async {
    var reason = 'ORDER_GENERATION_ERROR';
    var sending = false;
    final observation = TextEditingController();
    final confirmed = await showDialog<bool>(
          context: hostContext,
          builder: (context) => StatefulBuilder(builder: (context, setState) {
            return AlertDialog(
              title: const Text('Anular orden'),
              content: SingleChildScrollView(
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  const Text(
                      'La orden quedará en el histórico y su QR dejará de funcionar.'),
                  const SizedBox(height: 16),
                  DropdownButtonFormField<String>(
                    initialValue: reason,
                    decoration: const InputDecoration(labelText: 'Motivo'),
                    items: const [
                      DropdownMenuItem(
                          value: 'ORDER_GENERATION_ERROR',
                          child: Text('Error al generar la orden')),
                      DropdownMenuItem(
                          value: 'WRONG_MEMBERSHIP',
                          child: Text('Membresía incorrecta')),
                      DropdownMenuItem(
                          value: 'CHANGED_MIND',
                          child: Text('Cambié de opinión')),
                      DropdownMenuItem(
                          value: 'DUPLICATE_ORDER',
                          child: Text('Orden duplicada')),
                      DropdownMenuItem(value: 'OTHER', child: Text('Otro')),
                    ],
                    onChanged: sending
                        ? null
                        : (value) => setState(() => reason = value ?? reason),
                  ),
                  if (reason == 'OTHER') ...[
                    const SizedBox(height: 12),
                    TextField(
                      controller: observation,
                      minLines: 2,
                      maxLines: 4,
                      maxLength: 500,
                      decoration: const InputDecoration(
                          labelText: 'Observación',
                          hintText: 'Explica brevemente el motivo'),
                    ),
                  ],
                ]),
              ),
              actions: [
                TextButton(
                    onPressed:
                        sending ? null : () => Navigator.pop(context, false),
                    child: const Text('Volver')),
                FilledButton(
                  onPressed: sending
                      ? null
                      : () async {
                          if (reason == 'OTHER' &&
                              observation.text.trim().length < 3) {
                            ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                    content: Text(
                                        'Escribe una observación para continuar.')));
                            return;
                          }
                          setState(() => sending = true);
                          try {
                            await api.cancelMembershipPaymentOrder(
                                widget.s.token,
                                order['id'].toString(),
                                reason,
                                observation.text);
                            if (context.mounted) Navigator.pop(context, true);
                          } catch (error) {
                            setState(() => sending = false);
                            if (context.mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(content: Text(error.toString())));
                            }
                          }
                        },
                  child: Text(sending ? 'Anulando...' : 'Anular orden'),
                ),
              ],
            );
          }),
        ) ??
        false;
    observation.dispose();
    return confirmed;
  }

  Widget _membershipAmountRow(BuildContext context, String label, num value,
      {bool emphasized = false}) {
    final style = emphasized
        ? Theme.of(context).textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.w900,
            color: Theme.of(context).colorScheme.primary)
        : Theme.of(context).textTheme.bodyMedium;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(children: [
        Expanded(child: Text(label, style: style)),
        Text('\$${value.toDouble().toStringAsFixed(2)}', style: style),
      ]),
    );
  }

  Future<void> _openCollectionPointDirections(
      Map<String, dynamic> point) async {
    final latitude = (point['latitude'] as num?)?.toDouble();
    final longitude = (point['longitude'] as num?)?.toDouble();
    if (latitude == null || longitude == null) return;
    final uri = Uri.https('www.google.com', '/maps/dir/', {
      'api': '1',
      'destination': '$latitude,$longitude',
      'travelmode': 'driving',
    });
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  Future<void> _showCollectionPointDetail(
      BuildContext context, Map<String, dynamic> point) async {
    final phone = point['phone']?.toString();
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (sheetContext) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
        child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(point['name']?.toString() ?? 'Punto autorizado',
                  style: Theme.of(sheetContext)
                      .textTheme
                      .headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w900),
                  textAlign: TextAlign.center),
              const SizedBox(height: 6),
              Center(
                  child: Chip(
                      label: Text(point['isOpen'] == true
                          ? 'Abierto ahora'
                          : point['isOpen'] == false
                              ? 'Cerrado ahora'
                              : 'Horario por confirmar'),
                      avatar: Icon(Icons.circle,
                          size: 12,
                          color: point['isOpen'] == true
                              ? Colors.green
                              : Colors.orange))),
              if ((point['address']?.toString() ?? '').isNotEmpty)
                ListTile(
                    leading: const Icon(Icons.location_on_outlined),
                    title: const Text('Dirección'),
                    subtitle: Text(point['address'].toString())),
              if ((point['reference']?.toString() ?? '').isNotEmpty)
                ListTile(
                    leading: const Icon(Icons.map_outlined),
                    title: const Text('Referencia'),
                    subtitle: Text(point['reference'].toString())),
              ListTile(
                  leading: const Icon(Icons.schedule_outlined),
                  title: const Text('Horario de atención'),
                  subtitle: Text(point['todaySchedule']?.toString() ??
                      'Horario no configurado')),
              if (phone != null && phone.isNotEmpty)
                ListTile(
                    leading: const Icon(Icons.phone_outlined),
                    title: const Text('Teléfono'),
                    subtitle: Text(phone)),
              if (point['distanceKm'] != null)
                ListTile(
                    leading: const Icon(Icons.near_me_outlined),
                    title: const Text('Distancia aproximada'),
                    subtitle: Text(
                        '${(point['distanceKm'] as num).toStringAsFixed(1)} km desde tu ubicación')),
              const SizedBox(height: 10),
              Row(children: [
                Expanded(
                    child: OutlinedButton.icon(
                        onPressed: point['latitude'] == null
                            ? null
                            : () => _openCollectionPointDirections(point),
                        icon: const Icon(Icons.navigation_outlined),
                        label: const Text('Cómo llegar'))),
                const SizedBox(width: 10),
                Expanded(
                    child: FilledButton.icon(
                        onPressed: phone == null || phone.isEmpty
                            ? null
                            : () => launchUrl(Uri(scheme: 'tel', path: phone),
                                mode: LaunchMode.externalApplication),
                        icon: const Icon(Icons.phone_outlined),
                        label: const Text('Llamar'))),
              ]),
            ]),
      ),
    );
  }

  Future<void> _showCollectionPoints(BuildContext context) async {
    try {
      final raw = await api.membershipCollectionPoints(
          widget.s.token, currentDriverPosition);
      final points =
          raw.map((item) => Map<String, dynamic>.from(item as Map)).toList();
      if (!context.mounted) return;
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        showDragHandle: true,
        builder: (sheetContext) => FractionallySizedBox(
          heightFactor: .78,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(18, 0, 18, 20),
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Puntos de pago',
                  style: Theme.of(sheetContext)
                      .textTheme
                      .headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w900)),
              const Text(
                  'Selecciona un punto autorizado para presentar tu QR.'),
              const SizedBox(height: 12),
              Expanded(
                  child: points.isEmpty
                      ? const Center(
                          child: Text(
                              'No hay puntos de pago activos en este momento.'))
                      : ListView.separated(
                          itemCount: points.length,
                          separatorBuilder: (_, __) =>
                              const SizedBox(height: 8),
                          itemBuilder: (_, index) {
                            final point = points[index];
                            return Card(
                                child: ListTile(
                              leading: CircleAvatar(
                                  child: Icon(point['isOpen'] == true
                                      ? Icons.storefront
                                      : Icons.store_outlined)),
                              title: Text(
                                  point['name']?.toString() ??
                                      'Punto autorizado',
                                  style: const TextStyle(
                                      fontWeight: FontWeight.w800)),
                              subtitle: Text([
                                point['address'],
                                point['reference'],
                                if (point['distanceKm'] != null)
                                  '${(point['distanceKm'] as num).toStringAsFixed(1)} km',
                                point['isOpen'] == true
                                    ? 'Abierto'
                                    : point['isOpen'] == false
                                        ? 'Cerrado'
                                        : null
                              ].whereType<Object>().join('\n')),
                              trailing: const Icon(Icons.chevron_right),
                              onTap: () => _showCollectionPointDetail(
                                  sheetContext, point),
                            ));
                          })),
            ]),
          ),
        ),
      );
    } catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.toString())));
      }
    }
  }

  Future<void> _showBankTransfer(
      BuildContext context, Map<String, dynamic> order) async {
    Map<String, dynamic>? account;
    try {
      account = await api.membershipPaymentAccount(widget.s.token);
    } catch (_) {}
    if (!context.mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (sheetContext) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
        child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Transferencia bancaria',
                  style: Theme.of(sheetContext)
                      .textTheme
                      .headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w900),
                  textAlign: TextAlign.center),
              const SizedBox(height: 12),
              if (account == null)
                const Card(
                    child: Padding(
                        padding: EdgeInsets.all(14),
                        child: Text(
                            'Los datos bancarios aún no están disponibles. Intenta más tarde o paga en un punto autorizado.')))
              else
                Card(
                    child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(children: [
                          _membershipDetailLine('Banco',
                              account['bankName']?.toString() ?? 'Costa-Go'),
                          _membershipDetailLine(
                              'Tipo de cuenta',
                              account['accountType']?.toString() ??
                                  'Cuenta bancaria'),
                          _membershipDetailLine(
                              'Cuenta',
                              account['accountIdentifier']
                                          ?.toString()
                                          .isNotEmpty ==
                                      true
                                  ? account['accountIdentifier'].toString()
                                  : '•••• ${account['accountLastFour'] ?? ''}'),
                          _membershipDetailLine('Titular',
                              account['holderName']?.toString() ?? 'Costa-Go'),
                          if ((account['holderIdentification']?.toString() ??
                                  '')
                              .isNotEmpty)
                            _membershipDetailLine('RUC / identificación',
                                account['holderIdentification'].toString()),
                          if ((account['supportEmail']?.toString() ?? '')
                              .isNotEmpty)
                            _membershipDetailLine(
                                'Correo', account['supportEmail'].toString()),
                          const Divider(),
                          _membershipDetailLine('Motivo / referencia',
                              order['shortCode']?.toString() ?? ''),
                        ]))),
              const SizedBox(height: 12),
              FilledButton.icon(
                  onPressed: account == null
                      ? null
                      : () async {
                          Navigator.pop(sheetContext);
                          final submitted =
                              await _submitMembershipTransferProof(
                                  context, order);
                          if (submitted && context.mounted) {
                            Navigator.of(context)
                                .popUntil((route) => route.isFirst);
                          }
                        },
                  icon: const Icon(Icons.upload_file_outlined),
                  label: const Text('Subir comprobante')),
            ]),
      ),
    );
  }

  Widget _membershipDetailLine(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(children: [
          Expanded(child: Text(label)),
          Flexible(
              child: Text(value,
                  textAlign: TextAlign.end,
                  style: const TextStyle(fontWeight: FontWeight.w700)))
        ]),
      );

  Future<void> _showMembershipQr(
      BuildContext context, Map<String, dynamic> order) async {
    final qrUrl = order['qrUrl']?.toString();
    if (qrUrl == null || qrUrl.isEmpty) return;
    await showDialog<void>(
      context: context,
      builder: (qrContext) => AlertDialog(
        icon: Image.asset('assets/images/costa-go-emblem.png', width: 46),
        title: const Text('QR de membresía', textAlign: TextAlign.center),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                  color: Colors.white, borderRadius: BorderRadius.circular(18)),
              child: QrImageView(
                  data: qrUrl, size: 220, backgroundColor: Colors.white)),
          const SizedBox(height: 12),
          const Text(
              'Presenta este QR en cualquier punto de recaudación autorizado.',
              textAlign: TextAlign.center),
          const SizedBox(height: 8),
          Text('Código ${order['shortCode']}',
              style: const TextStyle(fontWeight: FontWeight.w900)),
        ]),
        actions: [
          FilledButton(
              onPressed: () => Navigator.pop(qrContext),
              child: const Text('Cerrar'))
        ],
      ),
    );
  }

  Future<bool> _showMembershipPaymentOrder(
      BuildContext hostContext, Map<String, dynamic> order) async {
    final status = order['status']?.toString() ?? 'PENDING';
    final amount = (order['totalAmount'] as num?)?.toDouble() ?? 0;
    final expiresAt = DateTime.tryParse(order['expiresAt']?.toString() ?? '');
    final breakdown = Map<String, dynamic>.from(
        order['breakdown'] as Map? ?? const <String, dynamic>{});
    final cancelled = await showDialog<bool>(
          context: hostContext,
          builder: (dialogContext) => AlertDialog(
            icon: Image.asset('assets/images/costa-go-emblem.png',
                width: 42, height: 42),
            title: Text(const {
                  'PENDING': 'QR de membresía',
                  'PENDING_VERIFICATION': 'Pago pendiente de verificación',
                  'PAID': 'Orden pagada',
                  'REJECTED': 'Orden rechazada',
                  'EXPIRED': 'Orden vencida',
                  'CANCELLED': 'Orden anulada',
                }[status] ??
                'Orden de membresía'),
            content: SingleChildScrollView(
              child: SizedBox(
                width: 300,
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Icon(
                      status == 'CANCELLED'
                          ? Icons.block_rounded
                          : status == 'PAID'
                              ? Icons.check_circle_outline_rounded
                              : Icons.hourglass_top_rounded,
                      size: 58),
                  const SizedBox(height: 12),
                  Text('Código ${order['shortCode']}',
                      style: Theme.of(dialogContext)
                          .textTheme
                          .titleMedium
                          ?.copyWith(fontWeight: FontWeight.w900)),
                  const SizedBox(height: 12),
                  _membershipAmountRow(
                      dialogContext,
                      'Membresía',
                      (breakdown['baseAmount'] as num?) ??
                          order['baseAmount'] ??
                          0),
                  if (breakdown['includedTrips'] != null)
                    Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                            'Viajes incluidos: ${breakdown['includedTrips']}')),
                  if (breakdown['extraTrips'] != null &&
                      (breakdown['extraTrips'] as num) > 0) ...[
                    Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                            'Viajes realizados que generan excedente: ${breakdown['extraTrips']}')),
                    if (breakdown['extraTripUnitAmount'] != null)
                      _membershipAmountRow(
                          dialogContext,
                          'Valor por viaje excedente',
                          breakdown['extraTripUnitAmount'] as num),
                    if (breakdown['extraTripSharePercent'] != null &&
                        breakdown['passengerServiceAdditional'] != null)
                      Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                          'Cada excedente corresponde al ${breakdown['extraTripSharePercent']}% del adicional de servicio al pasajero (\$${(breakdown['passengerServiceAdditional'] as num).toDouble().toStringAsFixed(2)}).',
                          style: Theme.of(dialogContext).textTheme.bodySmall,
                        ),
                      ),
                    if (breakdown['rawExtraAmount'] != null &&
                        breakdown['maximumExtraAmount'] != null &&
                        (breakdown['rawExtraAmount'] as num) >
                            (breakdown['maximumExtraAmount'] as num))
                      Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                          'Se aplicó el tope del plan de \$${(breakdown['maximumExtraAmount'] as num).toDouble().toStringAsFixed(2)} para excedentes.',
                          style: Theme.of(dialogContext).textTheme.bodySmall,
                        ),
                      ),
                  ],
                  _membershipAmountRow(
                      dialogContext,
                      'Excedente',
                      (breakdown['billableExtraAmount'] as num?) ??
                          order['priorUsageAmount'] ??
                          0),
                  if (((breakdown['adjustmentAmount'] as num?) ??
                          order['adjustmentAmount'] ??
                          0) !=
                      0)
                    _membershipAmountRow(
                        dialogContext,
                        'Ajustes',
                        (breakdown['adjustmentAmount'] as num?) ??
                            order['adjustmentAmount'] as num),
                  const Divider(height: 18),
                  _membershipAmountRow(dialogContext, 'Total a pagar', amount,
                      emphasized: true),
                  if (expiresAt != null)
                    Text('Válido hasta ${formatEcuadorLongDateTime(expiresAt)}',
                        textAlign: TextAlign.center),
                  if (status == 'PENDING_VERIFICATION')
                    const Padding(
                      padding: EdgeInsets.only(top: 10),
                      child: Text(
                          'Tu comprobante ya fue enviado. No generes otra orden mientras se realiza la revisión.',
                          textAlign: TextAlign.center),
                    ),
                  if (status == 'CANCELLED')
                    Padding(
                      padding: const EdgeInsets.only(top: 10),
                      child: Text(
                        '${_membershipCancellationLabel(order['cancellationReason']?.toString())}${order['cancellationObservation'] == null ? '' : '\n${order['cancellationObservation']}'}',
                        textAlign: TextAlign.center,
                      ),
                    ),
                  if (status == 'PENDING') ...[
                    const SizedBox(height: 14),
                    Align(
                        alignment: Alignment.centerLeft,
                        child: Text('¿Cómo deseas pagar?',
                            style: Theme.of(dialogContext)
                                .textTheme
                                .titleMedium
                                ?.copyWith(fontWeight: FontWeight.w900))),
                    const SizedBox(height: 8),
                    Card(
                        child: ListTile(
                            leading: const CircleAvatar(
                                child: Icon(Icons.storefront_outlined)),
                            title: const Text('En punto autorizado',
                                style: TextStyle(fontWeight: FontWeight.w800)),
                            subtitle: const Text('Paga mostrando tu QR'),
                            trailing: const Icon(Icons.chevron_right),
                            onTap: () => _showCollectionPoints(hostContext))),
                    Card(
                        child: ListTile(
                            leading: const CircleAvatar(
                                child: Icon(Icons.account_balance_outlined)),
                            title: const Text('Transferencia bancaria',
                                style: TextStyle(fontWeight: FontWeight.w800)),
                            subtitle: const Text(
                                'Realiza tu pago y sube el comprobante'),
                            trailing: const Icon(Icons.chevron_right),
                            onTap: () =>
                                _showBankTransfer(hostContext, order))),
                    Card(
                        color: Theme.of(dialogContext)
                            .colorScheme
                            .primaryContainer,
                        child: ListTile(
                            leading: const Icon(Icons.qr_code_2_rounded),
                            title: const Text('Ver QR de pago',
                                style: TextStyle(fontWeight: FontWeight.w800)),
                            subtitle: const Text('Escanea o muestra tu código'),
                            trailing: const Icon(Icons.chevron_right),
                            onTap: () =>
                                _showMembershipQr(hostContext, order))),
                  ],
                ]),
              ),
            ),
            actions: [
              if (status == 'PENDING')
                TextButton.icon(
                  onPressed: () async {
                    final cancelled =
                        await _cancelMembershipOrder(dialogContext, order);
                    if (cancelled && dialogContext.mounted) {
                      Navigator.pop(dialogContext, true);
                    }
                  },
                  icon: const Icon(Icons.cancel_outlined),
                  label: const Text('Anular orden'),
                ),
              FilledButton(
                onPressed: () => Navigator.pop(dialogContext),
                child: const Text('Cerrar'),
              ),
            ],
          ),
        ) ??
        false;
    if (cancelled) {
      await refreshMembership(force: true);
      if (hostContext.mounted) {
        ScaffoldMessenger.of(hostContext).showSnackBar(const SnackBar(
            content: Text('La orden fue anulada correctamente.')));
      }
    }
    return cancelled;
  }

  Future<void> _showMembershipPaymentHistory(BuildContext hostContext) async {
    try {
      final raw = await api.membershipPaymentOrders(widget.s.token);
      final orders =
          raw.map((item) => Map<String, dynamic>.from(item as Map)).toList();
      if (!hostContext.mounted) return;
      await showModalBottomSheet<void>(
        context: hostContext,
        isScrollControlled: true,
        useSafeArea: true,
        showDragHandle: true,
        builder: (context) => FractionallySizedBox(
          heightFactor: .72,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(18, 4, 18, 24),
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Mis pagos',
                  style: Theme.of(context)
                      .textTheme
                      .headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w900)),
              const SizedBox(height: 4),
              const Text('Órdenes vigentes, pagadas, vencidas y anuladas.'),
              const SizedBox(height: 12),
              Expanded(
                child: orders.isEmpty
                    ? const Center(
                        child: Text('Aún no tienes órdenes de pago.'))
                    : ListView.separated(
                        itemCount: orders.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (context, index) {
                          final order = orders[index];
                          final status =
                              order['status']?.toString() ?? 'PENDING';
                          final created = DateTime.tryParse(
                              order['createdAt']?.toString() ?? '');
                          final statusLabel = const {
                                'PENDING': 'Pendiente',
                                'PENDING_VERIFICATION': 'En revisión',
                                'PAID': 'Pagada',
                                'REJECTED': 'Rechazada',
                                'EXPIRED': 'Vencida',
                                'CANCELLED': 'Anulada',
                              }[status] ??
                              status;
                          final color = status == 'CANCELLED'
                              ? Theme.of(context).colorScheme.errorContainer
                              : Theme.of(context)
                                  .colorScheme
                                  .surfaceContainerHigh;
                          return Card(
                            color: color,
                            child: ListTile(
                              leading: Icon(status == 'CANCELLED'
                                  ? Icons.block_rounded
                                  : Icons.receipt_long_outlined),
                              title: Text(
                                  '${membershipPlanName(order['plan'])} · $statusLabel'),
                              subtitle: Text([
                                'Código ${order['shortCode']}',
                                if (created != null)
                                  formatEcuadorLongDateTime(created),
                                if (status == 'CANCELLED')
                                  _membershipCancellationLabel(
                                      order['cancellationReason']?.toString()),
                                if (status == 'CANCELLED' &&
                                    order['cancellationObservation'] != null)
                                  order['cancellationObservation'].toString(),
                              ].join('\n')),
                              trailing: Text(
                                  '\$${((order['totalAmount'] as num?) ?? 0).toDouble().toStringAsFixed(2)}'),
                              onTap: () =>
                                  _showMembershipPaymentOrder(context, order),
                            ),
                          );
                        },
                      ),
              ),
            ]),
          ),
        ),
      );
    } catch (error) {
      if (hostContext.mounted) {
        ScaffoldMessenger.of(hostContext)
            .showSnackBar(SnackBar(content: Text(error.toString())));
      }
    }
  }

  Future<void> _showMembershipDetails() async {
    final data = membershipData;
    if (data == null || !mounted) return;
    final membership =
        Map<String, dynamic>.from(data['membership'] as Map? ?? const {});
    final plans = List<dynamic>.from(data['plans'] ?? const []);
    var pendingOrder = data['pendingOrder'] is Map
        ? Map<String, dynamic>.from(data['pendingOrder'] as Map)
        : null;
    await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        showDragHandle: true,
        builder: (sheetContext) =>
            StatefulBuilder(builder: (sheetContext, setSheetState) {
              final status = membership['status']?.toString() ?? 'PENDING';
              final extraAmount =
                  (membership['billableExtraAmount'] as num?)?.toDouble() ?? 0;
              Future<void> selectPlan(Map<String, dynamic> plan) async {
                if (pendingOrder != null) return;
                try {
                  final response = await api.createMembershipPaymentOrder(
                      widget.s.token, plan['id'].toString(), 'CASH');
                  if (!sheetContext.mounted) return;
                  final created = Map<String, dynamic>.from(response as Map);
                  setSheetState(() => pendingOrder = created);
                  final cancelled =
                      await _showMembershipPaymentOrder(sheetContext, created);
                  if (cancelled && sheetContext.mounted) {
                    setSheetState(() => pendingOrder = null);
                  }
                  await refreshMembership(force: true);
                } catch (error) {
                  if (sheetContext.mounted) {
                    ScaffoldMessenger.of(sheetContext).showSnackBar(
                        SnackBar(content: Text(error.toString())));
                  }
                }
              }

              return FractionallySizedBox(
                  heightFactor: .82,
                  child: ListView(
                      padding: const EdgeInsets.fromLTRB(18, 0, 18, 28),
                      children: [
                        Text('Membresía Costa-Go',
                            style: Theme.of(sheetContext)
                                .textTheme
                                .headlineSmall
                                ?.copyWith(fontWeight: FontWeight.w900)),
                        const SizedBox(height: 6),
                        Align(
                            alignment: Alignment.centerLeft,
                            child: Chip(
                                label: Text(_membershipStatusLabel(status)),
                                avatar: const Icon(Icons.schedule_rounded,
                                    size: 18))),
                        Card(
                            child: Padding(
                                padding: const EdgeInsets.all(14),
                                child: Column(children: [
                                  _membershipDetailLine(
                                      'Plan actual',
                                      membership['planName']?.toString() ??
                                          'Sin plan activo'),
                                  _membershipDetailLine('Viajes del ciclo',
                                      '${membership['completedTrips'] ?? 0}'),
                                  _membershipDetailLine('Renovación estimada',
                                      '\$${((membership['estimatedNextRenewalAmount'] as num?) ?? 0).toStringAsFixed(2)}'),
                                  if (extraAmount > 0)
                                    _membershipDetailLine('Excedente acumulado',
                                        '\$${extraAmount.toStringAsFixed(2)}'),
                                  if (membership['expiresAt'] != null)
                                    _membershipDetailLine(
                                        'Vigente hasta',
                                        formatSpanishLongDate(DateTime.parse(
                                            membership['expiresAt']
                                                .toString()))),
                                ]))),
                        const SizedBox(height: 8),
                        OutlinedButton.icon(
                            onPressed: () =>
                                _showMembershipPaymentHistory(sheetContext),
                            icon: const Icon(Icons.receipt_long_outlined),
                            label: const Text('Mis pagos')),
                        if (pendingOrder != null) ...[
                          const SizedBox(height: 10),
                          Card(
                              color: Theme.of(sheetContext)
                                  .colorScheme
                                  .primaryContainer,
                              child: ListTile(
                                leading: Icon(pendingOrder!['status'] ==
                                        'PENDING_VERIFICATION'
                                    ? Icons.hourglass_top_rounded
                                    : Icons.qr_code_2_rounded),
                                title: Text(
                                    pendingOrder!['status'] ==
                                            'PENDING_VERIFICATION'
                                        ? 'Pago en revisión'
                                        : 'Orden de pago vigente',
                                    style: const TextStyle(
                                        fontWeight: FontWeight.w900)),
                                subtitle: Text(
                                    'Código ${pendingOrder!['shortCode']}\nToca para continuar con el pago'),
                                trailing: const Icon(Icons.chevron_right),
                                onTap: () async {
                                  final cancelled =
                                      await _showMembershipPaymentOrder(
                                          sheetContext, pendingOrder!);
                                  if (cancelled && sheetContext.mounted) {
                                    setSheetState(() => pendingOrder = null);
                                  }
                                },
                              )),
                        ],
                        const SizedBox(height: 14),
                        Text('Planes disponibles',
                            style: Theme.of(sheetContext)
                                .textTheme
                                .titleMedium
                                ?.copyWith(fontWeight: FontWeight.w900)),
                        const SizedBox(height: 8),
                        SizedBox(
                            height: 178,
                            child: ListView.separated(
                                scrollDirection: Axis.horizontal,
                                itemCount: plans.length,
                                separatorBuilder: (_, __) =>
                                    const SizedBox(width: 8),
                                itemBuilder: (_, index) {
                                  final plan = Map<String, dynamic>.from(
                                      plans[index] as Map);
                                  final current =
                                      membership['planCode']?.toString() ==
                                          plan['code']?.toString();
                                  return SizedBox(
                                      width: 150,
                                      child: Card(
                                          shape: RoundedRectangleBorder(
                                              borderRadius:
                                                  BorderRadius.circular(16),
                                              side: BorderSide(
                                                  color: current
                                                      ? Theme.of(sheetContext)
                                                          .colorScheme
                                                          .primary
                                                      : Theme.of(sheetContext)
                                                          .colorScheme
                                                          .outlineVariant)),
                                          child: InkWell(
                                              borderRadius:
                                                  BorderRadius.circular(16),
                                              onTap: pendingOrder == null
                                                  ? () => selectPlan(plan)
                                                  : null,
                                              child: Padding(
                                                  padding:
                                                      const EdgeInsets.all(12),
                                                  child: Column(
                                                      crossAxisAlignment:
                                                          CrossAxisAlignment
                                                              .start,
                                                      children: [
                                                        Icon(
                                                            current
                                                                ? Icons
                                                                    .event_available_outlined
                                                                : Icons
                                                                    .calendar_month_outlined,
                                                            color: Theme.of(
                                                                    sheetContext)
                                                                .colorScheme
                                                                .primary),
                                                        const SizedBox(
                                                            height: 8),
                                                        Text(
                                                            plan['name']
                                                                    ?.toString() ??
                                                                'Plan',
                                                            style: const TextStyle(
                                                                fontWeight:
                                                                    FontWeight
                                                                        .w900)),
                                                        Text(
                                                            '${plan['durationDays']} días · ${plan['includedTrips']} viajes',
                                                            style: Theme.of(
                                                                    sheetContext)
                                                                .textTheme
                                                                .bodySmall),
                                                        const Spacer(),
                                                        Text(
                                                            '\$${(plan['amount'] as num).toStringAsFixed(2)}',
                                                            style: Theme.of(
                                                                    sheetContext)
                                                                .textTheme
                                                                .titleMedium
                                                                ?.copyWith(
                                                                    fontWeight:
                                                                        FontWeight
                                                                            .w900)),
                                                        if (pendingOrder ==
                                                            null)
                                                          const Text(
                                                              'Toca para elegir',
                                                              style: TextStyle(
                                                                  fontSize:
                                                                      11)),
                                                      ])))));
                                })),
                        const SizedBox(height: 12),
                        const Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Icon(Icons.info_outline, size: 18),
                              SizedBox(width: 8),
                              Expanded(
                                  child: Text(
                                      'Si la membresía vence, tu cuenta y tu historial permanecen disponibles. Solo se pausa la recepción de nuevas solicitudes.'))
                            ]),
                      ]));
            }));
    unawaited(refreshMembership(force: true));
  }

  List<Widget> _driverSheetContent(BuildContext context, String? action) {
    final colors = Theme.of(context).colorScheme;
    final scheduledCount = scheduledOffers.length + scheduledTrips.length;
    final status = active?['status']?.toString();
    return [
      if (driverReviewArea?.reviewLocation != null) ...[
        _PassengerSurface(
          color: colors.secondaryContainer,
          child: SwitchListTile(
            contentPadding: EdgeInsets.zero,
            secondary: const Icon(Icons.verified_user_outlined),
            title: const Text('Modo de revisión de Google Play'),
            subtitle: Text(driverReviewLocationActive
                ? 'Ubicación de pruebas activa en ${driverReviewArea!.name}.'
                : 'Usa la ubicación autorizada para revisar viajes.'),
            value: driverReviewLocationActive,
            onChanged: active == null
                ? (value) => unawaited(toggleDriverReviewLocation(value))
                : null,
          ),
        ),
        const SizedBox(height: 12),
      ],
      Row(children: [
        Expanded(
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Disponible para viajes',
                style: Theme.of(context)
                    .textTheme
                    .headlineSmall
                    ?.copyWith(fontWeight: FontWeight.w900)),
            if (active != null)
              Text('Estás en un viaje',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: colors.primary, fontWeight: FontWeight.w700)),
          ]),
        ),
        Switch(
          value: available,
          onChanged: active == null && _membershipEligible ? toggle : null,
        ),
      ]),
      const SizedBox(height: 12),
      if (active == null) ...[
        _PassengerSurface(
          padding: EdgeInsets.zero,
          child: InkWell(
            onTap: showDriverScheduledTrips,
            borderRadius: BorderRadius.circular(20),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 17),
              child: Row(children: [
                CircleAvatar(
                  backgroundColor: colors.primaryContainer,
                  foregroundColor: colors.primary,
                  child: const Icon(Icons.calendar_month_outlined),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Text('Viajes programados ($scheduledCount)',
                      style: Theme.of(context)
                          .textTheme
                          .titleMedium
                          ?.copyWith(fontWeight: FontWeight.w800)),
                ),
                const Icon(Icons.chevron_right),
              ]),
            ),
          ),
        ),
        const SizedBox(height: 12),
        if (driverMessage != null)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
            margin: const EdgeInsets.only(bottom: 12),
            decoration: BoxDecoration(
              color: colors.primaryContainer.withValues(alpha: .45),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Text(driverMessage!, textAlign: TextAlign.center),
          ),
        if (available) ...[
          Row(children: [
            Container(
              width: 11,
              height: 11,
              decoration: const BoxDecoration(
                  color: Color(0xff47b52b), shape: BoxShape.circle),
            ),
            const SizedBox(width: 9),
            Expanded(
              child: Text(
                  'Ubicación GPS activa. Esperando solicitudes cercanas.',
                  style: Theme.of(context)
                      .textTheme
                      .bodyMedium
                      ?.copyWith(color: colors.onSurfaceVariant)),
            ),
          ]),
          const SizedBox(height: 14),
          _PassengerSurface(
            child: Row(children: [
              Expanded(
                child: InkWell(
                  onTap: centerDriverCurrentLocation,
                  child: Row(children: [
                    CircleAvatar(
                      backgroundColor: colors.primaryContainer,
                      foregroundColor: colors.primary,
                      child: const Icon(Icons.my_location_outlined),
                    ),
                    const SizedBox(width: 10),
                    const Expanded(
                        child: Text('Mi ubicación',
                            style: TextStyle(fontWeight: FontWeight.w800))),
                  ]),
                ),
              ),
              Container(width: 1, height: 42, color: colors.outlineVariant),
              const SizedBox(width: 14),
              Expanded(
                child: Row(children: [
                  Icon(Icons.electric_rickshaw_outlined,
                      color: colors.primary, size: 27),
                  const SizedBox(width: 9),
                  Expanded(
                    child: Text(
                        '${nearbyDriverPositions.length} mototaxis cercanas',
                        style: const TextStyle(fontWeight: FontWeight.w700)),
                  ),
                ]),
              ),
            ]),
          ),
          const SizedBox(height: 14),
        ],
        if (available && offers.isEmpty)
          _PassengerSurface(
            padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 26),
            child: Column(children: [
              const _CostaGoEmblem(size: 112),
              const SizedBox(height: 12),
              Text('Esperando viajes',
                  style: Theme.of(context)
                      .textTheme
                      .headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w900)),
              const SizedBox(height: 6),
              Text('Mantente en línea para recibir solicitudes cercanas.',
                  textAlign: TextAlign.center,
                  style: Theme.of(context)
                      .textTheme
                      .bodyLarge
                      ?.copyWith(color: colors.onSurfaceVariant)),
            ]),
          ),
        if (offers.isNotEmpty) _offerCarousel(context),
      ],
      if (active != null) ...[
        _PassengerSurface(
          padding: const EdgeInsets.all(18),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              InkWell(
                onTap: showPassengerPhoto,
                borderRadius: BorderRadius.circular(45),
                child: _passengerPhoto(size: 76),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Pasajero',
                          style: Theme.of(context)
                              .textTheme
                              .labelLarge
                              ?.copyWith(
                                  color: colors.primary,
                                  fontWeight: FontWeight.w800)),
                      Text(active['passengerName']?.toString() ?? 'Pasajero',
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context)
                              .textTheme
                              .titleLarge
                              ?.copyWith(fontWeight: FontWeight.w900)),
                      Row(children: [
                        const Icon(Icons.star, color: Colors.amber, size: 24),
                        const SizedBox(width: 5),
                        Text(((active?['passengerRating'] as num?) ?? 0)
                            .toStringAsFixed(1)),
                      ]),
                    ]),
              ),
            ]),
            const Divider(height: 28),
            _driverRoutePoint(
              icon: Icons.radio_button_checked,
              label: 'Origen',
              value: cleanAddressLabel(
                  resolvedDriverOrigin ?? active['originReference'],
                  fallback: 'Origen seleccionado'),
              drawLine: true,
            ),
            _driverRoutePoint(
              icon: Icons.location_on,
              label: 'Destino',
              value: cleanAddressLabel(active['destinationReference'],
                  fallback: 'Destino seleccionado'),
            ),
            if (List<dynamic>.from(active['stops'] ?? const []).length > 1) ...[
              Text('Itinerario',
                  style: Theme.of(context).textTheme.labelLarge?.copyWith(
                      color: colors.primary, fontWeight: FontWeight.w800)),
              ...List<dynamic>.from(active['stops'] ?? const [])
                  .asMap()
                  .entries
                  .map((entry) => ListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        leading: CircleAvatar(
                            radius: 13,
                            child: entry.value['completedAt'] == null
                                ? Text('${entry.key + 1}')
                                : const Icon(Icons.check, size: 16)),
                        title: Text(cleanAddressLabel(entry.value['reference'],
                            fallback: 'Parada ${entry.key + 1}')),
                      )),
            ],
            if (active['notes']?.toString().trim().isNotEmpty == true)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(Icons.chat_bubble_outline, color: colors.primary),
                title: const Text('Referencia'),
                subtitle: Text(active['notes'].toString()),
              ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(Icons.account_balance_wallet_outlined,
                  color: colors.primary),
              title: const Text('Pago'),
              subtitle: Text(
                  active['paymentMethod'] == 'DEUNA' ? 'De Una' : 'Efectivo'),
            ),
          ]),
        ),
        const SizedBox(height: 12),
        Row(children: [
          _driverCompactAction(
              icon: Icons.call_outlined,
              label: 'Llamar',
              onPressed: () => dialPhone(context, active['passengerPhone'])),
          const SizedBox(width: 8),
          _driverCompactAction(
              icon: Icons.chat_bubble_outline,
              label: 'Mensaje',
              onPressed: () => openDriverChat(null)),
          const SizedBox(width: 8),
          _driverCompactAction(
              icon: Icons.shield_outlined,
              label: 'Seguridad',
              onPressed: () => showTripSafety(
                    context: context,
                    trip: active,
                    counterpart:
                        active?['passengerName']?.toString() ?? 'mi pasajero',
                    location: currentDriverPosition,
                  )),
        ]),
        const SizedBox(height: 10),
        if (const {'DRIVER_EN_ROUTE', 'IN_PROGRESS'}.contains(status) &&
            _navigationProvider(status!) != 'MAP_ONLY')
          OutlinedButton.icon(
            onPressed: openDriverNavigation,
            icon: const Icon(Icons.map_outlined),
            label: Text(_navigationProvider(status) == 'EXTERNAL_MAPS'
                ? (status == 'IN_PROGRESS'
                    ? 'Abrir ruta al destino'
                    : 'Abrir ruta al pasajero')
                : (status == 'IN_PROGRESS'
                    ? 'Navegar al destino'
                    : 'Iniciar navegación')),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(56),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(18)),
            ),
          ),
        if (action != null) ...[
          const SizedBox(height: 10),
          _CostaGoPrimaryButton(
            label: routePreparing ? 'Preparando ruta…' : label(action),
            loading: routePreparing,
            onPressed: routePreparing ? null : () => progress(context, action),
          ),
        ],
        if (const {'ASSIGNED', 'DRIVER_EN_ROUTE'}.contains(status)) ...[
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: cancelAcceptedTrip,
            icon: const Icon(Icons.close),
            label: const Text('Cancelar carrera'),
            style: OutlinedButton.styleFrom(
              foregroundColor: colors.error,
              side: BorderSide(color: colors.error),
              minimumSize: const Size.fromHeight(56),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(18)),
            ),
          ),
        ],
      ],
    ];
  }

  @override
  Widget build(BuildContext context) {
    final action = next();
    final mapTrip = active ??
        (offers.isEmpty
            ? null
            : offers[offerIndex < offers.length ? offerIndex : 0]);
    final pickup = mapTrip?['originLatitude'] == null
        ? null
        : LatLng((mapTrip['originLatitude'] as num).toDouble(),
            (mapTrip['originLongitude'] as num).toDouble());
    final dropoff = mapTrip?['destinationLatitude'] == null
        ? null
        : LatLng((mapTrip['destinationLatitude'] as num).toDouble(),
            (mapTrip['destinationLongitude'] as num).toDouble());
    final mapStops = List<dynamic>.from(mapTrip?['stops'] ?? const [])
        .where((stop) => stop['completedAt'] == null)
        .map((stop) => LatLng((stop['latitude'] as num).toDouble(),
            (stop['longitude'] as num).toDouble()))
        .toList();

    return PopScope(
        canPop: false,
        onPopInvokedWithResult: (didPop, _) {
          if (!didPop) SystemNavigator.pop();
        },
        child: Scaffold(
          body: LayoutBuilder(builder: (context, constraints) {
            final safeTop = MediaQuery.paddingOf(context).top;
            return Stack(children: [
              Positioned.fill(
                child: AnimatedBuilder(
                  animation: driverSheetController,
                  builder: (context, _) {
                    final extent = driverSheetController.isAttached
                        ? driverSheetController.size
                        : (active == null ? .30 : .50);
                    return LiveMap(
                      originLabel: cleanAddressLabel(
                        resolvedDriverOrigin ?? mapTrip?['originReference'],
                        fallback: 'Origen',
                      ),
                      destinationLabel: cleanAddressLabel(
                        mapTrip?['destinationReference'],
                        fallback: 'Destino',
                      ),
                      pickup: pickup,
                      dropoff: dropoff,
                      stops: mapStops.length <= 1
                          ? const []
                          : mapStops.sublist(0, mapStops.length - 1),
                      currentLocation: null,
                      selfDriverPosition:
                          active == null ? currentDriverPosition : null,
                      onCenterCurrentLocation: centerDriverCurrentLocation,
                      mapAccessory: _membershipMapAccess(context),
                      driverPosition:
                          active == null ? null : currentDriverPosition,
                      driverBearing: currentDriverBearing,
                      routePoints: routePoints,
                      nearbyDrivers: active == null
                          ? nearbyDriverPositions
                          : const <String, LatLng>{},
                      fillAvailable: true,
                      borderRadius: 0,
                      viewportPadding: EdgeInsets.fromLTRB(
                        12,
                        safeTop + 72,
                        12,
                        constraints.maxHeight * extent + 16,
                      ),
                    );
                  },
                ),
              ),
              Positioned(
                top: safeTop + 8,
                left: 12,
                right: 12,
                child: RoleAwareHeaderIsland(
                  session: widget.s,
                  onAccount: () async {
                    await profile(context, widget.s);
                  },
                ), /* OLD
                  Expanded(
                    child: Material(
                      color: Theme.of(context).colorScheme.surface,
                      elevation: 3,
                      borderRadius: BorderRadius.circular(22),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 14, vertical: 11),
                        child: Text('Conductor · ${widget.s.name}',
                            maxLines: 1, overflow: TextOverflow.ellipsis),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Material(
                    color: Theme.of(context).colorScheme.surface,
                    elevation: 3,
                    shape: const CircleBorder(),
                    child: IconButton(
                      tooltip: 'Mi perfil',
                      onPressed: () => profile(context, widget.s),
                      icon: const Icon(Icons.person_outline),
                    ),
                  ),
                ] )*/
              ),
              DraggableScrollableSheet(
                controller: driverSheetController,
                initialChildSize: active == null ? .30 : .50,
                minChildSize: .18,
                maxChildSize: .92,
                snap: true,
                snapSizes: const [.28, .52, .9],
                builder: (context, scrollController) => Material(
                  color: Theme.of(context).colorScheme.surface,
                  elevation: 16,
                  shadowColor: Colors.black45,
                  borderRadius:
                      const BorderRadius.vertical(top: Radius.circular(28)),
                  clipBehavior: Clip.antiAlias,
                  child: ListView(
                    controller: scrollController,
                    padding: EdgeInsets.fromLTRB(
                        20, 10, 20, MediaQuery.paddingOf(context).bottom + 20),
                    children: [
                      Center(
                        child: Container(
                          width: 44,
                          height: 5,
                          decoration: BoxDecoration(
                            color: Theme.of(context)
                                .colorScheme
                                .onSurfaceVariant
                                .withValues(alpha: .35),
                            borderRadius: BorderRadius.circular(8),
                          ),
                        ),
                      ),
                      const SizedBox(height: 10),
                      ..._driverSheetContent(context, action),
                    ],
                  ),
                ),
              ),
            ]);
          }),
        ));
  }
}

class Passenger extends StatefulWidget {
  const Passenger(this.s, {super.key});
  final Session s;
  @override
  State<Passenger> createState() => _PassengerState();
}
