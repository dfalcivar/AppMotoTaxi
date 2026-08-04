import 'dart:async';
import 'dart:convert';
import 'dart:io';
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
import 'package:shared_preferences/shared_preferences.dart';
import 'package:image_picker/image_picker.dart';
import 'package:local_auth/local_auth.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

import 'affiliate_banners.dart';
import 'chat_sheet.dart';
import 'live_map.dart';
import 'realtime_service.dart';

const base = String.fromEnvironment('API_BASE_URL',
    defaultValue: 'https://mototaxi-atacames-api.onrender.com');
const apiHttpProxy = String.fromEnvironment('API_HTTP_PROXY');
const sentryDsn = String.fromEnvironment('SENTRY_DSN');

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
const nativeActions = MethodChannel('ec.atacames.mototaxi/native');
const secureStorage = FlutterSecureStorage();

class BiometricSessionStore {
  static const _key = 'atacamesgo_biometric_session';
  static final _auth = LocalAuthentication();

  static Future<void> enable(Session session) => secureStorage.write(
      key: _key,
      value: jsonEncode({
        'token': session.token,
        'role': session.role,
        'name': session.name,
        'id': session.id,
      }));

  static Future<void> clear() => secureStorage.delete(key: _key);

  static Future<Session?> saved() async {
    final value = await secureStorage.read(key: _key);
    if (value == null) return null;
    try {
      final data = jsonDecode(value) as Map<String, dynamic>;
      return Session(data['token'], data['role'], data['name'], data['id']);
    } catch (_) {
      await clear();
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
        localizedReason: 'Confirma tu identidad para ingresar a AtacamesGo',
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

Future<void> dialPhone(BuildContext context, dynamic phoneValue) async {
  final phone = phoneValue?.toString().trim() ?? '';
  if (phone.isEmpty) {
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Este usuario no registrÃ³ un telÃ©fono.')));
    return;
  }
  try {
    await nativeActions.invokeMethod<void>('dial', {'phone': phone});
  } catch (_) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('No se pudo abrir la aplicaciÃ³n de llamadas.')));
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
                  'Estoy realizando un viaje en AtacamesGo con $counterpart.\nRuta: $origin → $destination\nViaje: $tripId$mapLink');
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

Future<Position> currentGpsPosition() async {
  if (!await Geolocator.isLocationServiceEnabled()) {
    throw const ApiException(
        'Activa la ubicación GPS del teléfono para continuar.');
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
  try {
    return await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 20)));
  } on TimeoutException {
    final lastPosition = await Geolocator.getLastKnownPosition();
    if (lastPosition != null) return lastPosition;
    throw const ApiException(
        'No se pudo obtener la ubicación. Verifica el GPS e inténtalo nuevamente.');
  }
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (apiHttpProxy.isNotEmpty) {
    HttpOverrides.global = AppHttpOverrides(Uri.parse(apiHttpProxy));
  }
  unawaited(warmApi());
  try {
    await Firebase.initializeApp();
    await FirebaseMessaging.instance.requestPermission();
    firebaseReady = true;
  } catch (_) {
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
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(estadoViaje(status),
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 4),
          Text(detail),
          const SizedBox(height: 14),
          ...List.generate(stages.length, (index) {
            final completed = index <= current;
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(children: [
                Icon(completed ? Icons.check_circle : Icons.circle_outlined,
                    size: 20,
                    color: completed
                        ? Theme.of(context).colorScheme.primary
                        : Theme.of(context).colorScheme.outline),
                const SizedBox(width: 9),
                Text(stages[index].$2,
                    style: TextStyle(
                        fontWeight: index == current ? FontWeight.w700 : null)),
              ]),
            );
          }),
        ]),
      ),
    );
  }
}

class Session {
  const Session(this.token, this.role, this.name, this.id,
      {this.mustChangePassword = false});
  final String token, role, name, id;
  final bool mustChangePassword;
}

class ApiException implements Exception {
  const ApiException(this.message);
  final String message;
  @override
  String toString() => message;
}

String mensajeApi(dynamic code) =>
    const {
      'INVALID_CREDENTIALS': 'Correo o contraseña incorrectos.',
      'DRIVER_PENDING_APPROVAL':
          'Tu perfil de conductor está pendiente de aprobación.',
      'ACCOUNT_NOT_ACTIVE': 'Tu cuenta no está activa. Contacta a soporte.',
      'INVALID_LOGIN': 'Completa el correo y la contraseña.',
      'ACCOUNT_ALREADY_EXISTS': 'Ya existe una cuenta con estos datos.',
      'INVALID_REGISTRATION':
          'Revisa los campos obligatorios e intenta nuevamente.',
      'VEHICLE_REQUIRED': 'Ingresa la placa o el identificador de la mototaxi.',
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
      'INVALID_TRIP_STATE':
          'Esta acción ya no está disponible para el estado actual del viaje.',
      'PASSWORD_CHANGE_REQUIRED':
          'Debes cambiar la contraseña temporal para continuar.',
      'PASSWORD_REUSED':
          'La nueva contraseña debe ser diferente a la temporal.',
      'INVALID_PASSWORD': 'La contraseña debe tener al menos 8 caracteres.',
      'INVALID_CURRENT_PASSWORD': 'La contraseña actual no es correcta.',
      'INVALID_DRIVER_DOCUMENT':
          'La imagen no es válida o supera el tamaño permitido.',
      'INVALID_FAVORITE_PLACE':
          'Revisa el nombre y la dirección del lugar favorito.',
    }[code] ??
    'No se pudo completar la operación.';

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
          throw ApiException(mensajeApi(data?['error']));
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

  Future<Session> login(String e, String p) async {
    final d = await call('POST', '/v1/auth/session',
        body: {'email': e, 'password': p});
    final s = Session(
        d['token'], d['user']['role'], d['user']['name'], d['user']['id'],
        mustChangePassword: d['user']['mustChangePassword'] == true);
    unawaited(registerFcm(s.token));
    return s;
  }

  Future<void> registerFcm(String token) async {
    if (!firebaseReady) return;
    try {
      final fcm = await FirebaseMessaging.instance.getToken();
      if (fcm != null) {
        await call('PUT', '/v1/devices/fcm-token',
            token: token, body: {'token': fcm, 'platform': 'ANDROID'});
      }
    } catch (_) {}
  }

  Future<void> logout(String token) =>
      call('POST', '/v1/auth/logout', token: token);

  Future<void> changePassword(String token, String password,
          {String? currentPassword}) =>
      call('POST', '/v1/auth/change-password', token: token, body: {
        'password': password,
        if (currentPassword != null) 'currentPassword': currentPassword
      });

  Future<dynamic> register(Map<String, dynamic> body) =>
      call('POST', '/v1/auth/register', body: body);
  Future<dynamic> active(String t) => call('GET', '/v1/trips/active', token: t);
  Future<List<dynamic>> trips(String t) async =>
      List<dynamic>.from(await call('GET', '/v1/trips/mine', token: t));
  Future<dynamic> pendingRating(String t) =>
      call('GET', '/v1/trips/pending-rating', token: t);
  Future<List<dynamic>> notifications(String t) async =>
      List<dynamic>.from(await call('GET', '/v1/notifications', token: t));
  Future<List<dynamic>> banners(String t, String placement) async =>
      List<dynamic>.from(await call(
          'GET', '/v1/banners?placement=${Uri.encodeQueryComponent(placement)}',
          token: t));
  Future<dynamic> trip(String t, String id) =>
      call('GET', '/v1/trips/$id', token: t);
  Future<Map<String, dynamic>> route(
      String t, LatLng origin, LatLng destination) async {
    final value = await call('POST', '/v1/routes', token: t, body: {
      'origin': {
        'latitude': origin.latitude,
        'longitude': origin.longitude,
      },
      'destination': {
        'latitude': destination.latitude,
        'longitude': destination.longitude,
      },
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
          {String paymentMethod = 'CASH', String notes = ''}) =>
      call('POST', '/v1/trips', token: t, body: {
        'origin': {'longitude': pickup.longitude, 'latitude': pickup.latitude},
        'destination': {
          'longitude': dropoff.longitude,
          'latitude': dropoff.latitude
        },
        'passengers': n,
        'paymentMethod': paymentMethod,
        'originReference': o,
        'destinationReference': d,
        if (notes.trim().isNotEmpty) 'notes': notes.trim()
      });
  Future<dynamic> cancelTrip(String t, String id) =>
      call('POST', '/v1/trips/$id/cancel', token: t);
  Future<dynamic> profile(String t) => call('GET', '/v1/profile', token: t);
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
  Future<List<dynamic>> search(String t, String query, [LatLng? focus]) async {
    final parameters = <String, String>{'q': query};
    if (focus != null) {
      parameters['latitude'] = focus.latitude.toString();
      parameters['longitude'] = focus.longitude.toString();
    }
    return List<dynamic>.from(await call(
        'GET',
        Uri(path: '/v1/locations/search', queryParameters: parameters)
            .toString(),
        token: t));
  }

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
  Future<void> respond(String t, String id) =>
      call('POST', '/v1/driver/offers/$id/respond',
          token: t, body: {'accept': true});
  Future<void> action(String t, String id, String a) =>
      call('POST', '/v1/trips/$id/action', token: t, body: {'action': a});
  Future<void> rate(
          String t, String id, int score, List<String> tags, String comment) =>
      call('POST', '/v1/trips/$id/ratings',
          token: t, body: {'score': score, 'tags': tags, 'comment': comment});
}

class MototaxiApp extends StatelessWidget {
  const MototaxiApp({super.key});
  @override
  Widget build(BuildContext c) => ValueListenableBuilder<ThemeMode>(
      valueListenable: appTheme,
      builder: (context, mode, child) => MaterialApp(
          title: 'AtacamesGo',
          debugShowCheckedModeBanner: false,
          themeMode: mode,
          theme: _theme(Brightness.light),
          darkTheme: _theme(Brightness.dark),
          navigatorObservers:
              sentryDsn.isEmpty ? const [] : [SentryNavigatorObserver()],
          builder: (context, child) => NetworkStatus(child: child!),
          home: const Welcome()));

  ThemeData _theme(Brightness brightness) {
    final scheme = ColorScheme.fromSeed(
        seedColor: const Color(0xff007f8b), brightness: brightness);
    return ThemeData(
        colorScheme: scheme,
        brightness: brightness,
        useMaterial3: true,
        scaffoldBackgroundColor:
            brightness == Brightness.light ? const Color(0xfff4fafb) : null,
        appBarTheme: AppBarTheme(
            centerTitle: false,
            elevation: 0,
            scrolledUnderElevation: 0,
            backgroundColor: brightness == Brightness.light
                ? const Color(0xfff4fafb)
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
                    colors: [Color(0x55003764), Color(0xAA003B5C)]))),
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
                        Image.asset('assets/images/mototaxi-atacames-logo.png',
                            width: 142, height: 142, fit: BoxFit.contain),
                        const SizedBox(height: 8),
                        const Text('Muévete por Atacames',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                                color: Colors.white,
                                fontSize: 28,
                                fontWeight: FontWeight.bold)),
                        const SizedBox(height: 6),
                        const Text('Tu moto taxi seguro, rápido y confiable',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                                color: Colors.white,
                                fontSize: 14,
                                fontWeight: FontWeight.w500)),
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
  Session? biometricSession;
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
      final s = await Api().login(email.text, password.text);
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
                        ? Driver(s)
                        : Passenger(s)));
      }
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
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
      if (!await BiometricSessionStore.authenticate()) return;
      await Api().profile(session.token);
      if (!mounted) return;
      Navigator.pushReplacement(
          context,
          MaterialPageRoute(
              builder: (_) => session.role == 'DRIVER'
                  ? Driver(session)
                  : Passenger(session)));
    } catch (reason) {
      await BiometricSessionStore.clear();
      if (mounted) {
        setState(() {
          biometricSession = null;
          error = reason is ApiException
              ? 'La sesión guardada venció. Ingresa con tu contraseña y activa nuevamente la biometría.'
              : 'No se pudo validar la huella o el reconocimiento facial.';
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
                                                                    0xff00899a),
                                                                Color(
                                                                    0xff00638a)
                                                              ])),
                                                      child: Image.asset(
                                                          'assets/images/mototaxi-atacames-logo.png')),
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

class Recovery extends StatelessWidget {
  const Recovery({super.key});
  @override
  Widget build(BuildContext c) => Scaffold(
      appBar: AppBar(title: const Text('Recuperar contraseña')),
      body: const Padding(
          padding: EdgeInsets.all(24),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Recuperación de cuenta'),
            SizedBox(height: 12),
            Text(
                'En esta versión piloto la recuperación se gestiona por soporte. Indica tu correo registrado y el equipo administrativo podrá restablecer tu acceso.'),
            SizedBox(height: 20),
            Text('Próximo paso: envío de enlace seguro al correo registrado.')
          ])));
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
    if (password.text.length < 8) {
      setState(() =>
          error = 'La nueva contraseña debe tener al menos 8 caracteres.');
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
          widget.session.name, widget.session.id);
      Navigator.pushAndRemoveUntil(
          context,
          MaterialPageRoute(
              builder: (_) => session.role == 'DRIVER'
                  ? Driver(session)
                  : Passenger(session)),
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
                decoration: InputDecoration(
                    labelText: 'Nueva contraseña',
                    prefixIcon: const Icon(Icons.lock_outline),
                    suffixIcon: IconButton(
                        onPressed: () =>
                            setState(() => showPassword = !showPassword),
                        icon: Icon(showPassword
                            ? Icons.visibility_off_outlined
                            : Icons.visibility_outlined)))),
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
  bool busy = false, submitted = false;

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
    if (valid) return true;
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
        if (role == 'DRIVER') 'vehicleIdentifier': vehicle.text.trim()
      });
      if (!mounted) return;
      if (role == 'PASSENGER' && d['token'] != null) {
        final s = Session(
            d['token'], d['user']['role'], d['user']['name'], d['user']['id']);
        Navigator.pushReplacement(
            context, MaterialPageRoute(builder: (_) => Passenger(s)));
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
                validator: (value) => (value ?? '').length < 8
                    ? 'La contraseña debe tener al menos 8 caracteres.'
                    : null,
                decoration: const InputDecoration(
                    labelText: 'Contraseña (mín. 8 caracteres) *')),
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
  bool biometricEnabled = false;
  @override
  void initState() {
    super.initState();
    Api().profile(widget.s.token).then((v) {
      if (mounted) setState(() => p = v);
    });
    BiometricSessionStore.saved().then((value) {
      if (mounted) setState(() => biometricEnabled = value?.id == widget.s.id);
    });
  }

  Future<void> toggleBiometric(bool enabled) async {
    try {
      if (enabled) {
        final ok = await BiometricSessionStore.authenticate();
        if (!ok) return;
        await BiometricSessionStore.enable(widget.s);
      } else {
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

  @override
  Widget build(BuildContext c) {
    if (p == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final rs = p['reviews'] as List;
    final photo = p['photoBase64']?.toString();
    return Scaffold(
        appBar: AppBar(title: const Text('Mi perfil')),
        body: ListView(padding: const EdgeInsets.all(16), children: [
          Container(
            padding: const EdgeInsets.all(22),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                  colors: [Color(0xff006f7c), Color(0xff0498a7)]),
              borderRadius: BorderRadius.circular(26),
            ),
            child: Column(children: [
              CircleAvatar(
                radius: 46,
                foregroundImage: photo?.isNotEmpty == true
                    ? MemoryImage(base64Decode(photo!))
                    : null,
                child: photo?.isNotEmpty == true
                    ? null
                    : Text(p['name'].substring(0, 1),
                        style: const TextStyle(fontSize: 30)),
              ),
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
    if (password.text.length < 8) {
      setState(() =>
          message = 'La nueva contraseña debe tener al menos 8 caracteres.');
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
              decoration: const InputDecoration(
                  labelText: 'Nueva contraseña',
                  prefixIcon: Icon(Icons.password_outlined))),
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
    final source = await showModalBottomSheet<ImageSource>(
        context: context,
        showDragHandle: true,
        builder: (sheetContext) => SafeArea(
                child: Column(mainAxisSize: MainAxisSize.min, children: [
              ListTile(
                  leading: const Icon(Icons.camera_alt_outlined),
                  title: const Text('Tomar fotografía'),
                  onTap: () => Navigator.pop(sheetContext, ImageSource.camera)),
              ListTile(
                  leading: const Icon(Icons.photo_library_outlined),
                  title: const Text('Elegir de galería'),
                  onTap: () =>
                      Navigator.pop(sheetContext, ImageSource.gallery)),
            ])));
    if (source == null) return;
    final file = await picker.pickImage(
        source: source, imageQuality: 72, maxWidth: 1400, maxHeight: 1400);
    if (file == null) return;
    setState(() {
      busyType = type;
      message = null;
    });
    try {
      final bytes = await file.readAsBytes();
      final extension = file.name.toLowerCase();
      final mime = extension.endsWith('.png')
          ? 'image/png'
          : extension.endsWith('.webp')
              ? 'image/webp'
              : 'image/jpeg';
      await Api().uploadDriverDocument(
          widget.session.token, type, base64Encode(bytes), mime, '');
      await load();
      if (mounted) setState(() => message = 'Imagen enviada para revisión.');
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
                                  'Toma fotografías claras, completas y sin reflejos. Cada actualización vuelve a revisión administrativa.')),
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

class AccountHub extends StatefulWidget {
  const AccountHub(this.s, {super.key});
  final Session s;
  @override
  State<AccountHub> createState() => _AccountHubState();
}

class _AccountHubState extends State<AccountHub> {
  dynamic pending;
  @override
  void initState() {
    super.initState();
    Api().pendingRating(widget.s.token).then((v) {
      if (mounted) setState(() => pending = v);
    });
  }

  Future<void> logout(BuildContext c) async {
    try {
      await Api().logout(widget.s.token);
    } catch (_) {}
    await BiometricSessionStore.clear();
    if (sentryDsn.isNotEmpty) {
      await Sentry.configureScope((scope) => scope.setUser(null));
    }
    if (!c.mounted) return;
    Navigator.of(c).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const Welcome()), (_) => false);
  }

  @override
  Widget build(BuildContext c) => Scaffold(
      appBar: AppBar(title: const Text('Mi cuenta')),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
                colors: [Color(0xff006f7c), Color(0xff00a2b2)]),
            borderRadius: BorderRadius.circular(24),
          ),
          child: Row(children: [
            const CircleAvatar(
                radius: 28,
                backgroundColor: Colors.white24,
                child:
                    Icon(Icons.person_outline, color: Colors.white, size: 30)),
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
                          ? 'Conductor AtacamesGo'
                          : 'Pasajero AtacamesGo',
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
        ListTile(
            leading: const Icon(Icons.person_outline),
            title: const Text('Mi perfil'),
            onTap: () => Navigator.push(
                c, MaterialPageRoute(builder: (_) => Profile(widget.s)))),
        ListTile(
            leading: const Icon(Icons.directions_bike),
            title: const Text('Mis viajes'),
            subtitle: const Text('Viajes en curso e historial'),
            onTap: () => Navigator.push(
                c, MaterialPageRoute(builder: (_) => TripsPanel(widget.s)))),
        ListTile(
            leading: const Icon(Icons.notifications_outlined),
            title: const Text('Actividad'),
            subtitle: const Text('Actualizaciones de tus viajes'),
            onTap: () => Navigator.push(
                c, MaterialPageRoute(builder: (_) => ActivityPanel(widget.s)))),
        ListTile(
            leading: const Icon(Icons.info_outline),
            title: const Text('Acerca de'),
            onTap: () => Navigator.push(
                c, MaterialPageRoute(builder: (_) => const AboutAtacamesGo()))),
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
            onTap: () => logout(c))
      ]));
}

class AboutAtacamesGo extends StatelessWidget {
  const AboutAtacamesGo({super.key});

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
        body: SingleChildScrollView(
          child: Image.asset(
            'assets/images/atacamesgo-about-v3.png',
            width: double.infinity,
            fit: BoxFit.fitWidth,
            semanticLabel:
                'Presentación de AtacamesGo, movilidad segura, rápida y confiable',
          ),
        ),
      );
}

class TripsPanel extends StatefulWidget {
  const TripsPanel(this.s, {super.key});
  final Session s;
  @override
  State<TripsPanel> createState() => _TripsPanelState();
}

class _TripsPanelState extends State<TripsPanel> {
  List<dynamic>? data;
  @override
  void initState() {
    super.initState();
    Api().trips(widget.s.token).then((v) {
      if (mounted) setState(() => data = v);
    });
  }

  @override
  Widget build(BuildContext c) {
    final trips = data;
    if (trips == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    return Scaffold(
        appBar: AppBar(title: const Text('Mis viajes')),
        body: ListView(
            padding: const EdgeInsets.all(16),
            children: trips
                .map((t) => Card(
                    child: ListTile(
                        leading: Icon([
                          'SEARCHING',
                          'ASSIGNED',
                          'DRIVER_EN_ROUTE',
                          'DRIVER_ARRIVED',
                          'IN_PROGRESS'
                        ].contains(t['status'])
                            ? Icons.directions_bike
                            : Icons.history),
                        title: Text(
                            '${t['originReference'] ?? 'Origen'} → ${t['destinationReference'] ?? 'Destino'}'),
                        subtitle: Text(
                            '${estadoViaje(t['status'])} · ${t['passengerName'] ?? t['driverName'] ?? ''}'),
                        trailing: Text(
                            '\$${((t['quotedTotalCents'] as num) / 100).toStringAsFixed(2)}'))))
                .toList()));
  }
}

class ActivityPanel extends StatefulWidget {
  const ActivityPanel(this.s, {super.key});
  final Session s;
  @override
  State<ActivityPanel> createState() => _ActivityPanelState();
}

class _ActivityPanelState extends State<ActivityPanel> {
  List<dynamic>? data;
  @override
  void initState() {
    super.initState();
    Api().notifications(widget.s.token).then((v) {
      if (mounted) setState(() => data = v);
    });
  }

  @override
  Widget build(BuildContext c) {
    final items = data;
    if (items == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    return Scaffold(
        appBar: AppBar(title: const Text('Actividad')),
        body: ListView(
            padding: const EdgeInsets.all(16),
            children: items.isEmpty
                ? [
                    const Padding(
                        padding: EdgeInsets.all(24),
                        child: Text('Aún no tienes actualizaciones.'))
                  ]
                : items
                    .map((n) => Card(
                        child: ListTile(
                            leading: const Icon(Icons.notifications_outlined),
                            title: Text(n['message']),
                            subtitle: Text(DateTime.parse(n['occurredAt'])
                                .toLocal()
                                .toString()
                                .substring(0, 16)))))
                    .toList()));
  }
}

void profile(BuildContext c, Session s) =>
    Navigator.push(c, MaterialPageRoute(builder: (_) => AccountHub(s)));
Future<void> rating(
    BuildContext c, Session s, String tripId, VoidCallback done) async {
  int score = 5;
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
    builder: (sheet) => StatefulBuilder(builder: (c, set) {
      final options = optionsForScore();
      return Padding(
        padding: EdgeInsets.fromLTRB(
            20, 20, 20, 20 + MediaQuery.of(c).viewInsets.bottom),
        child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(driverRatesPassenger
                  ? 'Califica al pasajero'
                  : 'Califica al conductor'),
              const Text('Para continuar, registra tu calificación.'),
              Row(
                  children: List.generate(
                      5,
                      (i) => IconButton(
                          onPressed: () => set(() {
                                score = i + 1;
                                tags.clear();
                              }),
                          icon:
                              Icon(i < score ? Icons.star : Icons.star_border),
                          color: Colors.amber))),
              Text(score >= 4
                  ? '¿Qué salió bien?'
                  : score == 3
                      ? '¿Qué podría mejorar?'
                      : '¿Qué inconveniente ocurrió?'),
              Wrap(
                  spacing: 6,
                  children: options
                      .map((x) => FilterChip(
                          label: Text(x),
                          selected: tags.contains(x),
                          onSelected: (v) =>
                              set(() => v ? tags.add(x) : tags.remove(x))))
                      .toList()),
              TextField(
                  controller: note,
                  maxLines: 3,
                  decoration:
                      const InputDecoration(labelText: 'Comentario opcional')),
              FilledButton(
                  onPressed: () async {
                    await Api()
                        .rate(s.token, tripId, score, tags.toList(), note.text);
                    done();
                    if (c.mounted) Navigator.pop(c);
                  },
                  child: const Text('Guardar calificación')),
            ]),
      );
    }),
  );
}

class _PassengerState extends State<Passenger> with WidgetsBindingObserver {
  final api = Api();
  final origin = TextEditingController();
  final destination = TextEditingController();
  final notes = TextEditingController();
  final mapSectionKey = GlobalKey();
  late final RealtimeService realtime;
  StreamSubscription<Map<String, dynamic>>? realtimeSubscription;
  StreamSubscription<RemoteMessage>? messageSubscription;
  StreamSubscription<RemoteMessage>? openedMessageSubscription;
  LatLng? pickup;
  LatLng? dropoff;
  LatLng? currentLocation;
  LatLng? driverPosition;
  double driverBearing = 0;
  final Map<String, LatLng> nearbyDrivers = {};
  List<dynamic> favoritePlaces = [];
  List<LatLng> routePoints = [];
  MapPointSelection? mapSelection;
  dynamic active;
  int people = 1;
  String paymentMethod = 'CASH';
  String? message;
  Timer? timer;
  bool ratingPrompted = false;
  bool passengerChatOpen = false;
  BuildContext? searchingDialogContext;
  DateTime? lastRouteAt;
  double? routeDistanceMeters;
  double? routeDurationSeconds;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    realtime = RealtimeService(baseUrl: base, token: widget.s.token);
    realtimeSubscription = realtime.events.listen(handleRealtime);
    realtime.connect();
    if (firebaseReady) {
      messageSubscription = FirebaseMessaging.onMessage.listen((push) {
        final type = push.data['type'];
        if (const {
          'DRIVER_EN_ROUTE',
          'DRIVER_ARRIVED',
          'IN_PROGRESS',
          'COMPLETED',
          'TRIP_CANCELLED'
        }.contains(type)) {
          reflectTripStatus(type, push.data['tripId']);
          load();
        }
      });
      openedMessageSubscription =
          FirebaseMessaging.onMessageOpenedApp.listen((message) {
        if (message.data['type'] == 'CHAT_MESSAGE') {
          openPassengerChat(message.data['tripId']);
        } else {
          load();
        }
      });
    }
    load();
    loadFavoritePlaces();
    Future.microtask(useCurrentLocation);
    timer = Timer.periodic(const Duration(seconds: 15), (_) {
      unawaited(load());
      unawaited(refreshNearbyDrivers());
    });
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
    notes.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      realtime.connect();
      load();
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
      message = {
        'DRIVER_EN_ROUTE':
            '${active['driverName'] ?? 'Tu conductor'} va en camino.',
        'DRIVER_ARRIVED': 'El conductor ya llegó.',
        'IN_PROGRESS': 'Tu viaje está en curso.'
      }[status];
    });
  }

  Future<void> openPassengerChat([String? requestedTripId]) async {
    ScaffoldMessenger.of(context).hideCurrentSnackBar();
    if (passengerChatOpen) return;
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
    if (type == 'trip:status') {
      reflectTripStatus(event['status'], event['tripId']);
      load();
      return;
    }
    if (type == 'chat:message') {
      if (passengerChatOpen) return;
      final value = Map<String, dynamic>.from(event['message'] as Map);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: const Text('Tienes un nuevo mensaje sobre tu viaje.'),
          action: SnackBarAction(
              label: 'Abrir',
              onPressed: () =>
                  openPassengerChat(value['tripId']?.toString()))));
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
      final position = await currentGpsPosition();
      point = LatLng(position.latitude, position.longitude);
    } catch (_) {
      // Si el GPS falla, el destino del viaje es el mejor punto disponible.
    }
    if (!mounted || active != null || point == null) return;
    setState(() {
      currentLocation = point;
      pickup = point;
      dropoff = null;
      origin.text = 'Mi ubicación actual';
      destination.clear();
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
      setState(() =>
          origin.text = result['label']?.toString() ?? 'Mi ubicación actual');
    } catch (_) {}
  }

  Future<void> load() async {
    try {
      final t = active == null
          ? await api.active(widget.s.token)
          : await api.trip(widget.s.token, active['tripId']);
      if (!mounted) return;
      if (t == null) {
        closeSearchingDialog();
        if (active != null) {
          setState(() => active = null);
          if (pickup != null) {
            realtime.subscribeNearby(pickup!.latitude, pickup!.longitude);
            unawaited(refreshNearbyDrivers());
          }
        }
        return;
      }
      if (t['status'] == 'COMPLETED') {
        closeSearchingDialog();
        setState(() {
          active = null;
          driverPosition = null;
          routePoints = [];
          message = 'Viaje finalizado.';
        });
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
        closeSearchingDialog();
        final administrative = t['cancellationReason'] == 'ADMIN_CANCELLED';
        setState(() {
          active = null;
          driverPosition = null;
          routePoints = [];
          message = administrative
              ? 'El viaje fue cancelado por administración.'
              : 'La solicitud fue cancelada.';
        });
        if (pickup != null) {
          realtime.subscribeNearby(pickup!.latitude, pickup!.longitude);
          unawaited(refreshNearbyDrivers());
        }
        return;
      }
      setState(() {
        active = t;
        if (t['originLatitude'] != null) {
          pickup = LatLng((t['originLatitude'] as num).toDouble(),
              (t['originLongitude'] as num).toDouble());
          dropoff = LatLng((t['destinationLatitude'] as num).toDouble(),
              (t['destinationLongitude'] as num).toDouble());
        }
        if (t['driverLatitude'] != null) {
          driverPosition = LatLng((t['driverLatitude'] as num).toDouble(),
              (t['driverLongitude'] as num).toDouble());
          driverBearing = (t['driverBearing'] as num?)?.toDouble() ?? 0;
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
      if (t['status'] == 'SEARCHING') {
        showSearchingDialog();
      } else {
        closeSearchingDialog();
      }
      realtime.subscribeTrip(t['tripId'].toString());
      refreshRoute(force: routePoints.isEmpty);
    } catch (_) {}
  }

  void closeSearchingDialog() {
    final dialogContext = searchingDialogContext;
    if (dialogContext == null) return;
    searchingDialogContext = null;
    if (dialogContext.mounted) Navigator.of(dialogContext).pop();
  }

  void showSearchingDialog() {
    if (!mounted || searchingDialogContext != null) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted ||
          searchingDialogContext != null ||
          active?['status'] != 'SEARCHING') {
        return;
      }
      showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) {
          searchingDialogContext = dialogContext;
          return AlertDialog(
            icon: const Icon(Icons.manage_search, size: 54),
            title: const Text('Buscando un conductor cercano'),
            content: const Column(mainAxisSize: MainAxisSize.min, children: [
              CircularProgressIndicator(),
              SizedBox(height: 18),
              Text('Avisaremos cuando un conductor acepte tu solicitud.',
                  textAlign: TextAlign.center),
            ]),
            actionsAlignment: MainAxisAlignment.center,
            actions: [
              TextButton.icon(
                onPressed: () {
                  searchingDialogContext = null;
                  Navigator.pop(dialogContext);
                  cancel();
                },
                icon: const Icon(Icons.close),
                label: const Text('Cancelar solicitud'),
              ),
            ],
          );
        },
      ).whenComplete(() => searchingDialogContext = null);
    });
  }

  Future<void> useCurrentLocation() async {
    if (active != null) return;
    try {
      final position = await currentGpsPosition();
      if (!mounted || active != null) return;
      final point = LatLng(position.latitude, position.longitude);
      setState(() {
        mapSelection = MapPointSelection.origin;
        currentLocation = point;
        pickup = point;
        origin.text = 'Mi ubicación actual';
        message = 'Consultando la dirección de tu ubicación…';
      });
      realtime.subscribeNearby(position.latitude, position.longitude);
      unawaited(refreshNearbyDrivers(point));
      refreshRoute(force: true);
      try {
        final result = await api.reverse(widget.s.token, point);
        if (!mounted || pickup != point || active != null) return;
        setState(() {
          mapSelection = null;
          origin.text = result['label']?.toString() ?? 'Mi ubicación actual';
          message = 'Origen actualizado con tu ubicación GPS.';
        });
      } catch (_) {
        if (mounted && pickup == point) {
          setState(() => message =
              'Origen guardado por GPS; no se pudo obtener la dirección escrita.');
        }
      }
    } catch (e) {
      if (mounted) setState(() => message = e.toString());
    }
  }

  void clearPoint(bool isOrigin) {
    setState(() {
      mapSelection =
          isOrigin ? MapPointSelection.origin : MapPointSelection.destination;
      if (isOrigin) {
        origin.clear();
        pickup = null;
        nearbyDrivers.clear();
      } else {
        destination.clear();
        dropoff = null;
      }
      routePoints = [];
      routeDistanceMeters = null;
      routeDurationSeconds = null;
      message = isOrigin
          ? 'Mueve el mapa para elegir un nuevo origen.'
          : 'Mueve el mapa para elegir un nuevo destino.';
    });
    _showMapEditor();
  }

  void beginMapSelection(MapPointSelection selection) {
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      mapSelection = selection;
      message = selection == MapPointSelection.origin
          ? 'Arrastra el punto verde para ajustar el origen.'
          : 'Arrastra el punto rojo para ajustar el destino.';
    });
    _showMapEditor();
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
      if (isOrigin) {
        pickup = point;
        origin.text = place['address'].toString();
      } else {
        dropoff = point;
        destination.text = place['address'].toString();
      }
      message =
          '${place['label']} seleccionado como ${isOrigin ? 'origen' : 'destino'}.';
    });
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
                  subtitle: Text(place['address'].toString(),
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

  void _showMapEditor() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final mapContext = mapSectionKey.currentContext;
      if (!mounted || mapContext == null) return;
      Scrollable.ensureVisible(
        mapContext,
        duration: const Duration(milliseconds: 320),
        curve: Curves.easeInOut,
        alignment: .05,
      );
    });
  }

  Future<void> locate(bool isOrigin) async {
    final field = isOrigin ? origin : destination;
    if (field.text.trim().length < 3) {
      setState(() => message = 'Escribe al menos tres letras de la dirección.');
      return;
    }
    try {
      setState(() => message = 'Buscando direcciones cercanas...');
      final results = await api.search(widget.s.token, field.text, pickup);
      if (results.isEmpty) {
        setState(() => message = 'No se encontraron ubicaciones cercanas.');
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
                          title: Text(result['label'].toString()),
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
        field.text = r['label'];
        if (isOrigin) {
          pickup = LatLng((r['latitude'] as num).toDouble(),
              (r['longitude'] as num).toDouble());
        } else {
          dropoff = LatLng((r['latitude'] as num).toDouble(),
              (r['longitude'] as num).toDouble());
        }
        message = 'Ubicación actualizada en el mapa.';
      });
      if (isOrigin && pickup != null) {
        realtime.subscribeNearby(pickup!.latitude, pickup!.longitude);
        unawaited(refreshNearbyDrivers(pickup));
      }
      refreshRoute(force: true);
    } catch (_) {
      setState(() => message = 'No se pudo buscar la ubicación.');
    }
  }

  Future<void> selectMapPoint(LatLng point) async {
    final selection = mapSelection;
    if (selection == null) return;
    final coordinateLabel =
        'Punto (${point.latitude.toStringAsFixed(5)}, ${point.longitude.toStringAsFixed(5)})';
    setState(() {
      mapSelection = null;
      if (selection == MapPointSelection.origin) {
        pickup = point;
        origin.text = coordinateLabel;
        message = 'Consultando la dirección del origen...';
      } else {
        dropoff = point;
        destination.text = coordinateLabel;
        message = 'Consultando la dirección del destino...';
      }
    });
    if (selection == MapPointSelection.origin) {
      realtime.subscribeNearby(point.latitude, point.longitude);
      unawaited(refreshNearbyDrivers(point));
    }
    refreshRoute(force: true);
    try {
      final result = await api.reverse(widget.s.token, point);
      if (!mounted) return;
      final selectedPoint =
          selection == MapPointSelection.origin ? pickup : dropoff;
      if (selectedPoint?.latitude != point.latitude ||
          selectedPoint?.longitude != point.longitude) {
        return;
      }
      setState(() {
        if (selection == MapPointSelection.origin) {
          origin.text = result['label'].toString();
          message = 'Origen identificado por su dirección.';
        } else {
          destination.text = result['label'].toString();
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
    final status = active?['status']?.toString();
    if (driverPosition != null && status == 'DRIVER_EN_ROUTE') {
      from = driverPosition;
      to = pickup;
    } else if (driverPosition != null && status == 'IN_PROGRESS') {
      from = driverPosition;
      to = dropoff;
    } else {
      from = pickup;
      to = dropoff;
    }
    if (from == null || to == null) return;
    lastRouteAt = now;
    try {
      final route = await api.route(widget.s.token, from, to);
      final points = List<dynamic>.from(route['points'] ?? const [])
          .map((point) => LatLng((point['latitude'] as num).toDouble(),
              (point['longitude'] as num).toDouble()))
          .toList();
      if (!mounted) return;
      setState(() {
        routePoints = points;
        routeDistanceMeters = (route['distanceMeters'] as num?)?.toDouble();
        routeDurationSeconds = (route['durationSeconds'] as num?)?.toDouble();
      });
    } catch (_) {
      if (mounted && force) {
        setState(() {
          routePoints = [from!, to!];
          routeDistanceMeters = null;
          routeDurationSeconds = null;
        });
      }
    }
  }

  Future<void> create() async {
    if (pickup == null || dropoff == null) {
      setState(() => message =
          'Marca el origen y el destino en el mapa antes de solicitar.');
      return;
    }
    try {
      ratingPrompted = false;
      final t = await api.create(widget.s.token, people, origin.text,
          destination.text, pickup!, dropoff!,
          paymentMethod: paymentMethod, notes: notes.text);
      setState(() => active = {'tripId': t['tripId'], 'status': 'SEARCHING'});
      showSearchingDialog();
      await load();
    } catch (e) {
      setState(() => message = e.toString());
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
      closeSearchingDialog();
      setState(() {
        active = null;
        message = 'Solicitud cancelada correctamente.';
      });
    } catch (e) {
      if (mounted) setState(() => message = e.toString());
      await load();
    }
  }

  @override
  Widget build(BuildContext c) {
    final o = active?['originReference'] ?? origin.text;
    final d = active?['destinationReference'] ?? destination.text;
    return Scaffold(
        appBar: AppBar(title: Text('Hola, ${widget.s.name}'), actions: [
          IconButton(
              onPressed: () => profile(c, widget.s),
              icon: const Icon(Icons.person_outline))
        ]),
        body: ListView(padding: const EdgeInsets.all(20), children: [
          AffiliateBanners(
              load: () => api.banners(widget.s.token, 'PASSENGER_HOME'),
              imageUrl: (banner) =>
                  '$base/v1/banners/${banner['id']}/image?v=${Uri.encodeQueryComponent(banner['updatedAt']?.toString() ?? '')}'),
          const SizedBox(height: 10),
          AnimatedSize(
            key: mapSectionKey,
            duration: const Duration(milliseconds: 280),
            curve: Curves.easeInOut,
            child: LiveMap(
                originLabel: o,
                destinationLabel: d,
                pickup: pickup,
                dropoff: dropoff,
                currentLocation: currentLocation,
                driverPosition: driverPosition,
                driverBearing: driverBearing,
                routePoints: routePoints,
                nearbyDrivers:
                    active == null ? nearbyDrivers : const <String, LatLng>{},
                editing: active == null ? mapSelection : null,
                onPointSelected: active == null && mapSelection != null
                    ? selectMapPoint
                    : null,
                onUseCurrentLocation:
                    active == null ? useCurrentLocation : null,
                height: active != null
                    ? 370
                    : mapSelection == null
                        ? 360
                        : 520),
          ),
          if (active == null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.electric_rickshaw,
                      size: 18, color: Theme.of(c).colorScheme.primary),
                  const SizedBox(width: 6),
                  Flexible(
                    child: Text(
                      nearbyDrivers.isEmpty
                          ? 'No hay mototaxis disponibles cerca ahora'
                          : '${nearbyDrivers.length} mototaxi(s) disponible(s) cerca',
                      textAlign: TextAlign.center,
                    ),
                  ),
                ],
              ),
            ),
          if (active == null)
            Align(
              alignment: Alignment.center,
              child: TextButton.icon(
                onPressed: showFavoritePlaces,
                icon: const Icon(Icons.star_outline),
                label: Text(favoritePlaces.isEmpty
                    ? 'Guardar lugares favoritos'
                    : 'Lugares favoritos (${favoritePlaces.length})'),
              ),
            ),
          if (routeDistanceMeters != null && routeDurationSeconds != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(
                'Ruta estimada: ${(routeDistanceMeters! / 1000).toStringAsFixed(1)} km · '
                '${(routeDurationSeconds! / 60).ceil()} min',
                textAlign: TextAlign.center,
              ),
            ),
          if (active != null && active?['status'] != 'SEARCHING')
            TripStatusPanel(
                status: active['status'].toString(),
                driverName: active['driverName']?.toString()),
          if (active != null && active?['status'] != 'SEARCHING')
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(active?['driverName']?.toString() ?? 'Tu conductor',
                          style: Theme.of(c)
                              .textTheme
                              .titleLarge
                              ?.copyWith(fontWeight: FontWeight.w700)),
                      if (active?['vehicle'] != null)
                        Text('Mototaxi: ${active['vehicle']}'),
                      const SizedBox(height: 10),
                      OutlinedButton.icon(
                        onPressed: () => dialPhone(c, active?['driverPhone']),
                        icon: const Icon(Icons.call_outlined),
                        label: const Text('Llamar al conductor'),
                      ),
                    ]),
              ),
            ),
          if (active == null) ...[
            TextField(
                controller: origin,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                    labelText: 'Origen',
                    hintText: 'Escribe una dirección o mueve el mapa',
                    suffixIcon: Row(mainAxisSize: MainAxisSize.min, children: [
                      if (origin.text.isNotEmpty)
                        IconButton(
                            tooltip: 'Borrar origen',
                            icon: const Icon(Icons.close),
                            onPressed: () => clearPoint(true)),
                      IconButton(
                          tooltip: 'Ajustar origen en el mapa',
                          icon: const Icon(Icons.edit_location_alt_outlined),
                          onPressed: () =>
                              beginMapSelection(MapPointSelection.origin)),
                      IconButton(
                          tooltip: 'Buscar dirección',
                          icon: const Icon(Icons.search),
                          onPressed: () => locate(true))
                    ]))),
            const SizedBox(height: 12),
            TextField(
                controller: destination,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                    labelText: 'Destino',
                    hintText: 'Escribe una dirección o mueve el mapa',
                    suffixIcon: Row(mainAxisSize: MainAxisSize.min, children: [
                      if (destination.text.isNotEmpty)
                        IconButton(
                            tooltip: 'Borrar destino',
                            icon: const Icon(Icons.close),
                            onPressed: () => clearPoint(false)),
                      IconButton(
                          tooltip: 'Ajustar destino en el mapa',
                          icon: const Icon(Icons.edit_location_alt_outlined),
                          onPressed: () =>
                              beginMapSelection(MapPointSelection.destination)),
                      IconButton(
                          tooltip: 'Buscar dirección',
                          icon: const Icon(Icons.search),
                          onPressed: () => locate(false))
                    ]))),
            const SizedBox(height: 12),
            TextField(
              controller: notes,
              maxLength: 300,
              maxLines: 2,
              decoration: const InputDecoration(
                labelText: 'Referencia para encontrarte (opcional)',
                hintText: 'Ej.: casa azul, junto a la farmacia, puerta lateral',
                prefixIcon: Icon(Icons.info_outline),
              ),
            ),
            const SizedBox(height: 4),
            Text('Número de pasajeros (máximo 4)',
                style: Theme.of(c).textTheme.titleSmall),
            const SizedBox(height: 8),
            SegmentedButton<int>(segments: const [
              ButtonSegment(value: 1, label: Text('1')),
              ButtonSegment(value: 2, label: Text('2')),
              ButtonSegment(value: 3, label: Text('3')),
              ButtonSegment(value: 4, label: Text('4'))
            ], selected: {
              people
            }, onSelectionChanged: (v) => setState(() => people = v.first)),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
                initialValue: paymentMethod,
                decoration: const InputDecoration(labelText: 'Método de pago'),
                items: const [
                  DropdownMenuItem(
                      value: 'CASH', child: Text('Pago en efectivo')),
                  DropdownMenuItem(
                      value: 'DEUNA', child: Text('Pago con De Una'))
                ],
                onChanged: (v) => setState(() => paymentMethod = v!))
          ],
          if (message != null &&
              (active == null || active?['status'] == 'SEARCHING'))
            Padding(padding: const EdgeInsets.all(12), child: Text(message!)),
          if (active?['status'] == 'SEARCHING')
            OutlinedButton.icon(
                onPressed: cancel,
                icon: const Icon(Icons.cancel_outlined),
                label: const Text('Cancelar solicitud')),
          if (active != null && active?['status'] != 'SEARCHING')
            OutlinedButton.icon(
              onPressed: openPassengerChat,
              icon: const Icon(Icons.chat_bubble_outline),
              label: const Text('Chat con el conductor'),
            ),
          if (active != null && active?['status'] != 'SEARCHING')
            OutlinedButton.icon(
              onPressed: () => showTripSafety(
                context: c,
                trip: active,
                counterpart:
                    active?['driverName']?.toString() ?? 'mi conductor',
                location: currentLocation,
              ),
              icon: const Icon(Icons.shield_outlined),
              label: const Text('Seguridad y compartir viaje'),
            ),
          FilledButton(
              onPressed: active == null ? create : null,
              child: Text(active == null
                  ? 'Solicitar mototaxi'
                  : active?['status'] == 'SEARCHING'
                      ? 'Buscando conductor...'
                      : 'Viaje en curso'))
        ]));
  }
}

class Driver extends StatefulWidget {
  const Driver(this.s, {super.key});
  final Session s;
  @override
  State<Driver> createState() => _DriverState();
}

class _DriverState extends State<Driver> {
  final api = Api();
  late final RealtimeService realtime;
  dynamic active;
  List offers = [];
  bool available = false;
  String? driverMessage;
  Timer? timer;
  StreamSubscription<RemoteMessage>? messageSubscription;
  StreamSubscription<RemoteMessage>? openedMessageSubscription;
  StreamSubscription<Position>? positionSubscription;
  StreamSubscription<Map<String, dynamic>>? realtimeSubscription;
  LatLng? currentDriverPosition;
  double currentDriverBearing = 0;
  String? resolvedDriverOrigin;
  String? resolvedOriginTripId;
  List<LatLng> routePoints = [];
  DateTime? lastRouteAt;
  bool driverChatOpen = false;
  @override
  void initState() {
    super.initState();
    realtime = RealtimeService(baseUrl: base, token: widget.s.token);
    realtimeSubscription = realtime.events.listen(handleRealtime);
    realtime.connect();
    if (firebaseReady) {
      messageSubscription = FirebaseMessaging.onMessage.listen((message) {
        if (message.data['type'] == 'TRIP_CANCELLED' && mounted) {
          setState(() => driverMessage =
              message.data['reason'] == 'ADMIN_CANCELLED'
                  ? 'El viaje fue cancelado por administración.'
                  : 'El pasajero canceló la solicitud.');
        }
        if (message.data['type'] == 'TRIP_OFFER' ||
            message.data['type'] == 'TRIP_CANCELLED') {
          refresh();
        }
      });
      openedMessageSubscription =
          FirebaseMessaging.onMessageOpenedApp.listen((message) {
        if (message.data['type'] == 'CHAT_MESSAGE') {
          openDriverChat(message.data['tripId']);
        }
      });
    }
    restore();
    timer = Timer.periodic(const Duration(seconds: 5), (_) => refresh());
  }

  @override
  void dispose() {
    timer?.cancel();
    messageSubscription?.cancel();
    openedMessageSubscription?.cancel();
    positionSubscription?.cancel();
    realtimeSubscription?.cancel();
    realtime.dispose();
    super.dispose();
  }

  Future<void> openDriverChat([String? requestedTripId]) async {
    ScaffoldMessenger.of(context).hideCurrentSnackBar();
    if (driverChatOpen) return;
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
    } else if (event['type'] == 'trip:offer' ||
        event['type'] == 'trip:offer:cancelled') {
      refresh();
    } else if (event['type'] == 'trip:status') {
      refresh();
    } else if (event['type'] == 'chat:message') {
      if (driverChatOpen) return;
      final value = Map<String, dynamic>.from(event['message'] as Map);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: const Text('Tienes un nuevo mensaje del pasajero.'),
          action: SnackBarAction(
              label: 'Abrir',
              onPressed: () => openDriverChat(value['tripId']?.toString()))));
    }
  }

  LatLng pointFrom(Position position) =>
      LatLng(position.latitude, position.longitude);

  Future<void> startGpsTracking({required bool markAvailable}) async {
    final position = await currentGpsPosition();
    if (markAvailable) {
      await api.available(widget.s.token, true, pointFrom(position));
    }
    sendPosition(position);
    await positionSubscription?.cancel();
    positionSubscription = Geolocator.getPositionStream(
            locationSettings: AndroidSettings(
                accuracy: LocationAccuracy.high,
                distanceFilter: 10,
                intervalDuration: const Duration(seconds: 10),
                foregroundNotificationConfig: const ForegroundNotificationConfig(
                    notificationTitle: 'Mototaxi disponible',
                    notificationText:
                        'Actualizando ubicación para recibir viajes cercanos.',
                    enableWakeLock: true)))
        .listen(sendPosition);
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
    refreshDriverRoute();
  }

  Future<void> restore() async {
    await api.registerFcm(widget.s.token);
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
        offers = [];
      }
    });
    if (active != null) unawaited(resolveOriginAddress(active));
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
      if (active != null) {
        final latest = await api.trip(widget.s.token, active['tripId']);
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
        if (mounted) setState(() => offers = r);
      } else if (offers.isNotEmpty && mounted) {
        setState(() => offers = []);
      }
    } catch (e) {
      if (mounted) setState(() => driverMessage = e.toString());
    }
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
    final dropoff = active['destinationLatitude'] == null
        ? null
        : LatLng((active['destinationLatitude'] as num).toDouble(),
            (active['destinationLongitude'] as num).toDouble());
    final target = active['status'] == 'IN_PROGRESS' ? dropoff : pickup;
    if (target == null) return;
    lastRouteAt = now;
    try {
      final route = await api.route(widget.s.token, current, target);
      final points = List<dynamic>.from(route['points'] ?? const [])
          .map((point) => LatLng((point['latitude'] as num).toDouble(),
              (point['longitude'] as num).toDouble()))
          .toList();
      if (mounted) setState(() => routePoints = points);
    } catch (_) {
      if (mounted && force) setState(() => routePoints = [current, target]);
    }
  }

  Future<void> progress(BuildContext c, String action) async {
    final tripId = active['tripId'];
    await api.action(widget.s.token, tripId, action);
    if (action == 'COMPLETE') {
      if (!c.mounted) return;
      await rating(c, widget.s, tripId, () => {});
    }
    await restore();
    await refresh();
  }

  String? next() => {
        'ASSIGNED': 'EN_ROUTE',
        'DRIVER_EN_ROUTE': 'ARRIVED',
        'DRIVER_ARRIVED': 'START',
        'IN_PROGRESS': 'COMPLETE'
      }[active?['status']];
  String label(String a) => {
        'EN_ROUTE': 'Estoy en camino',
        'ARRIVED': 'Ya llegué',
        'START': 'Iniciar viaje',
        'COMPLETE': 'Finalizar viaje'
      }[a]!;
  @override
  Widget build(BuildContext c) {
    final a = next();
    final LatLng? pickup = active?['originLatitude'] != null
        ? LatLng((active['originLatitude'] as num).toDouble(),
            (active['originLongitude'] as num).toDouble())
        : null;
    final LatLng? dropoff = active?['destinationLatitude'] != null
        ? LatLng((active['destinationLatitude'] as num).toDouble(),
            (active['destinationLongitude'] as num).toDouble())
        : null;
    return Scaffold(
        appBar: AppBar(title: Text('Conductor · ${widget.s.name}'), actions: [
          IconButton(
              onPressed: () => profile(c, widget.s),
              icon: const Icon(Icons.person_outline))
        ]),
        body: ListView(padding: const EdgeInsets.all(20), children: [
          SwitchListTile(
              title: const Text('Disponible para viajes'),
              value: available,
              onChanged: active == null ? toggle : null),
          if (driverMessage != null)
            Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(driverMessage!)),
          if (active == null && available)
            const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: Text('Esperando viajes...'))),
          if (active != null) ...[
            LiveMap(
              originLabel:
                  resolvedDriverOrigin ?? active['originReference'] ?? 'Origen',
              destinationLabel: active['destinationReference'] ?? 'Destino',
              pickup: pickup,
              dropoff: dropoff,
              driverPosition: currentDriverPosition,
              driverBearing: currentDriverBearing,
              routePoints: routePoints,
              height: 330,
            ),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Text('Pasajero'),
                      Text(active['passengerName']?.toString() ?? 'Pasajero',
                          style: Theme.of(c)
                              .textTheme
                              .titleLarge
                              ?.copyWith(fontWeight: FontWeight.w700)),
                      const SizedBox(height: 12),
                      Text('Origen', style: Theme.of(c).textTheme.labelLarge),
                      Text(
                          resolvedDriverOrigin ??
                              active['originReference'] ??
                              'Origen seleccionado',
                          style: Theme.of(c).textTheme.titleMedium),
                      const SizedBox(height: 10),
                      Text('Destino', style: Theme.of(c).textTheme.labelLarge),
                      Text(
                          active['destinationReference'] ??
                              'Destino seleccionado',
                          style: Theme.of(c).textTheme.titleMedium),
                      if (active['notes']?.toString().isNotEmpty == true) ...[
                        const SizedBox(height: 10),
                        Text('Referencia: ${active['notes']}'),
                      ],
                      const SizedBox(height: 10),
                      Text(
                        'Pago: ${active['paymentMethod'] == 'DEUNA' ? 'De Una' : 'Efectivo'}',
                        style: Theme.of(c).textTheme.titleSmall,
                      ),
                      const SizedBox(height: 10),
                      OutlinedButton.icon(
                        onPressed: () => dialPhone(c, active['passengerPhone']),
                        icon: const Icon(Icons.call_outlined),
                        label: const Text('Llamar al pasajero'),
                      ),
                    ]),
              ),
            ),
            OutlinedButton.icon(
              onPressed: openDriverChat,
              icon: const Icon(Icons.chat_bubble_outline),
              label: const Text('Chat con el pasajero'),
            ),
            OutlinedButton.icon(
              onPressed: () => showTripSafety(
                context: c,
                trip: active,
                counterpart:
                    active?['passengerName']?.toString() ?? 'mi pasajero',
                location: currentDriverPosition,
              ),
              icon: const Icon(Icons.shield_outlined),
              label: const Text('Seguridad y compartir viaje'),
            ),
            if (a != null)
              FilledButton(
                  onPressed: () => progress(c, a), child: Text(label(a)))
          ],
          ...offers.map((o) => Card(
              child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(children: [
                          const Icon(Icons.notifications_active_outlined),
                          const SizedBox(width: 10),
                          Expanded(
                              child: Text(
                                  'Nuevo viaje · ${o['passengers']} pasajero(s)',
                                  style:
                                      Theme.of(context).textTheme.titleMedium))
                        ]),
                        const SizedBox(height: 12),
                        Text('Origen',
                            style: Theme.of(context).textTheme.labelLarge),
                        Text(o['originReference'] ?? 'Origen seleccionado',
                            style: Theme.of(context).textTheme.titleMedium),
                        const SizedBox(height: 10),
                        Text('Destino',
                            style: Theme.of(context).textTheme.labelLarge),
                        Text(
                            o['destinationReference'] ?? 'Destino seleccionado',
                            style: Theme.of(context).textTheme.titleMedium),
                        if (o['notes']?.toString().isNotEmpty == true) ...[
                          const SizedBox(height: 10),
                          Text('Referencia: ${o['notes']}'),
                        ],
                        const SizedBox(height: 8),
                        Text(
                            'Pago: ${o['paymentMethod'] == 'DEUNA' ? 'De Una' : 'Efectivo'}'),
                        const SizedBox(height: 14),
                        FilledButton.icon(
                            onPressed: () async {
                              setState(() => offers = []);
                              try {
                                await api.respond(widget.s.token, o['offerId']);
                              } catch (error) {
                                if (mounted) {
                                  setState(
                                      () => driverMessage = error.toString());
                                }
                              } finally {
                                await restore();
                                await refresh();
                              }
                            },
                            icon: const Icon(Icons.check),
                            label: const Text('Aceptar viaje'))
                      ]))))
        ]));
  }
}

class Passenger extends StatefulWidget {
  const Passenger(this.s, {super.key});
  final Session s;
  @override
  State<Passenger> createState() => _PassengerState();
}
