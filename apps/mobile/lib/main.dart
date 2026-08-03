import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';
import 'package:latlong2/latlong.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'chat_sheet.dart';
import 'live_map.dart';
import 'realtime_service.dart';

const base = String.fromEnvironment('API_BASE_URL',
    defaultValue: 'https://mototaxi-atacames-api.onrender.com');
const apiHttpProxy = String.fromEnvironment('API_HTTP_PROXY');

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
  try {
    await Firebase.initializeApp();
    await FirebaseMessaging.instance.requestPermission();
    firebaseReady = true;
  } catch (_) {
    // La mensajería push es opcional en instalaciones piloto sin credenciales.
  }
  await appTheme.load();
  runApp(const MototaxiApp());
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

class Session {
  const Session(this.token, this.role, this.name, this.id);
  final String token, role, name, id;
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
    }[code] ??
    'No se pudo completar la operación.';

class Api {
  Future<dynamic> call(String method, String path,
      {String? token, Object? body}) async {
    try {
      final request = http.Request(method, Uri.parse('$base$path'));
      request.headers.addAll({
        'content-type': 'application/json',
        if (token != null) 'authorization': 'Bearer $token'
      });
      request.body = jsonEncode(body ?? {});
      final streamed = await apiHttpClient
          .send(request)
          .timeout(const Duration(seconds: 40));
      final response = await http.Response.fromStream(streamed);
      final data = response.body == 'null' || response.body.isEmpty
          ? null
          : jsonDecode(response.body);
      if (response.statusCode >= 400) {
        throw ApiException(mensajeApi(data?['error']));
      }
      return data;
    } on ApiException {
      rethrow;
    } on TimeoutException {
      throw const ApiException(
          'La API de Render tardó demasiado. Intenta nuevamente.');
    } on SocketException {
      throw const ApiException(
          'No se pudo conectar con la API. Revisa tu conexión a Internet.');
    } on http.ClientException {
      throw const ApiException(
          'No se pudo conectar con la API. Revisa tu conexión a Internet.');
    }
  }

  Future<Session> login(String e, String p) async {
    final d = await call('POST', '/v1/auth/session',
        body: {'email': e, 'password': p});
    final s = Session(
        d['token'], d['user']['role'], d['user']['name'], d['user']['id']);
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

  Future<dynamic> register(Map<String, dynamic> body) =>
      call('POST', '/v1/auth/register', body: body);
  Future<dynamic> active(String t) => call('GET', '/v1/trips/active', token: t);
  Future<List<dynamic>> trips(String t) async =>
      List<dynamic>.from(await call('GET', '/v1/trips/mine', token: t));
  Future<dynamic> pendingRating(String t) =>
      call('GET', '/v1/trips/pending-rating', token: t);
  Future<List<dynamic>> notifications(String t) async =>
      List<dynamic>.from(await call('GET', '/v1/notifications', token: t));
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
          {String paymentMethod = 'CASH'}) =>
      call('POST', '/v1/trips', token: t, body: {
        'origin': {'longitude': pickup.longitude, 'latitude': pickup.latitude},
        'destination': {
          'longitude': dropoff.longitude,
          'latitude': dropoff.latitude
        },
        'passengers': n,
        'paymentMethod': paymentMethod,
        'originReference': o,
        'destinationReference': d
      });
  Future<dynamic> cancelTrip(String t, String id) =>
      call('POST', '/v1/trips/$id/cancel', token: t);
  Future<dynamic> profile(String t) => call('GET', '/v1/profile', token: t);
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
          debugShowCheckedModeBanner: false,
          themeMode: mode,
          theme: _theme(Brightness.light),
          darkTheme: _theme(Brightness.dark),
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
                  padding:
                      const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
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
                                style: TextStyle(color: Colors.white)))
                      ]))))
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
  @override
  void initState() {
    super.initState();
    final d = widget.role == 'DRIVER';
    email = TextEditingController(
        text: d ? 'conductor@mototaxi.local' : 'pasajera@mototaxi.local');
    password =
        TextEditingController(text: d ? 'Conductor2026!' : 'Pasajera2026!');
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
      if (mounted) {
        Navigator.pushReplacement(
            context,
            MaterialPageRoute(
                builder: (_) => s.role == 'DRIVER' ? Driver(s) : Passenger(s)));
      }
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
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

class Register extends StatefulWidget {
  const Register({super.key});
  @override
  State<Register> createState() => _RegisterState();
}

class _RegisterState extends State<Register> {
  final name = TextEditingController(),
      email = TextEditingController(),
      phone = TextEditingController(),
      password = TextEditingController(),
      vehicle = TextEditingController();
  String role = 'PASSENGER', message = '';
  bool busy = false, submitted = false;
  Future<void> submit() async {
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
      body: ListView(padding: const EdgeInsets.all(20), children: [
        TextField(
            controller: name,
            enabled: !submitted,
            decoration: const InputDecoration(labelText: 'Nombre completo')),
        TextField(
            controller: email,
            enabled: !submitted,
            decoration: const InputDecoration(labelText: 'Correo')),
        TextField(
            controller: phone,
            enabled: !submitted,
            keyboardType: TextInputType.phone,
            decoration:
                const InputDecoration(labelText: 'Teléfono, ej. +593...')),
        TextField(
            controller: password,
            enabled: !submitted,
            obscureText: true,
            decoration: const InputDecoration(
                labelText: 'Contraseña (mín. 8 caracteres)')),
        DropdownButtonFormField<String>(
            initialValue: role,
            items: const [
              DropdownMenuItem(value: 'PASSENGER', child: Text('Pasajero')),
              DropdownMenuItem(value: 'DRIVER', child: Text('Conductor'))
            ],
            onChanged: submitted ? null : (v) => setState(() => role = v!),
            decoration: const InputDecoration(labelText: 'Tipo de cuenta')),
        if (role == 'DRIVER')
          TextField(
              controller: vehicle,
              enabled: !submitted,
              decoration: const InputDecoration(
                  labelText: 'Placa o identificador de moto')),
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
      ]));
}

class Profile extends StatefulWidget {
  const Profile(this.s, {super.key});
  final Session s;
  @override
  State<Profile> createState() => _ProfileState();
}

class _ProfileState extends State<Profile> {
  dynamic p;
  @override
  void initState() {
    super.initState();
    Api().profile(widget.s.token).then((v) {
      if (mounted) setState(() => p = v);
    });
  }

  @override
  Widget build(BuildContext c) {
    if (p == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final rs = p['reviews'] as List;
    return Scaffold(
        appBar: AppBar(title: const Text('Mi perfil')),
        body: ListView(padding: const EdgeInsets.all(20), children: [
          CircleAvatar(radius: 35, child: Text(p['name'].substring(0, 1))),
          Text(p['name'],
              textAlign: TextAlign.center,
              style: Theme.of(c).textTheme.headlineSmall),
          Text(p['role'] == 'DRIVER' ? 'Conductor' : 'Pasajero',
              textAlign: TextAlign.center),
          Card(
              child: ListTile(
                  leading: const Icon(Icons.star, color: Colors.amber),
                  title:
                      Text('${(p['rating'] as num).toStringAsFixed(1)} de 5'),
                  subtitle: Text('${p['ratingCount']} calificaciones'))),
          const Text('Comentarios recibidos'),
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
    if (!c.mounted) return;
    Navigator.of(c).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const Welcome()), (_) => false);
  }

  @override
  Widget build(BuildContext c) => Scaffold(
      appBar: AppBar(title: const Text('Mi cuenta')),
      body: ListView(padding: const EdgeInsets.all(20), children: [
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

class _PassengerState extends State<Passenger> {
  final api = Api();
  final origin = TextEditingController();
  final destination = TextEditingController();
  late final RealtimeService realtime;
  StreamSubscription<Map<String, dynamic>>? realtimeSubscription;
  StreamSubscription<RemoteMessage>? openedMessageSubscription;
  LatLng? pickup;
  LatLng? dropoff;
  LatLng? driverPosition;
  double driverBearing = 0;
  final Map<String, LatLng> nearbyDrivers = {};
  List<LatLng> routePoints = [];
  MapPointSelection mapSelection = MapPointSelection.destination;
  dynamic active;
  int people = 1;
  String paymentMethod = 'CASH';
  String? message;
  Timer? timer;
  bool ratingPrompted = false;
  DateTime? lastRouteAt;
  double? routeDistanceMeters;
  double? routeDurationSeconds;
  @override
  void initState() {
    super.initState();
    realtime = RealtimeService(baseUrl: base, token: widget.s.token);
    realtimeSubscription = realtime.events.listen(handleRealtime);
    realtime.connect();
    if (firebaseReady) {
      openedMessageSubscription =
          FirebaseMessaging.onMessageOpenedApp.listen((message) {
        if (message.data['type'] == 'CHAT_MESSAGE') {
          openPassengerChat(message.data['tripId']);
        }
      });
    }
    load();
    Future.microtask(useCurrentLocation);
    timer = Timer.periodic(const Duration(seconds: 15), (_) => load());
  }

  @override
  void dispose() {
    timer?.cancel();
    realtimeSubscription?.cancel();
    openedMessageSubscription?.cancel();
    realtime.dispose();
    origin.dispose();
    destination.dispose();
    super.dispose();
  }

  Future<void> openPassengerChat([String? requestedTripId]) async {
    if (active == null) await load();
    if (!mounted) return;
    final tripId = requestedTripId ?? active?['tripId']?.toString();
    if (tripId == null || active?['tripId']?.toString() != tripId) return;
    await showTripChat(
      context: context,
      tripId: tripId,
      userId: widget.s.id,
      realtime: realtime,
      loadHistory: () => api.messages(widget.s.token, tripId),
      sendFallback: (clientId, body) =>
          api.sendMessage(widget.s.token, tripId, clientId, body),
    );
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
      load();
      return;
    }
    if (type == 'chat:message') {
      final value = Map<String, dynamic>.from(event['message'] as Map);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: const Text('Tienes un nuevo mensaje sobre tu viaje.'),
          action: SnackBarAction(
              label: 'Abrir',
              onPressed: () =>
                  openPassengerChat(value['tripId']?.toString()))));
    }
  }

  Future<void> load() async {
    try {
      final t = active == null
          ? await api.active(widget.s.token)
          : await api.trip(widget.s.token, active['tripId']);
      if (!mounted) return;
      if (t == null) {
        if (active != null) setState(() => active = null);
        return;
      }
      if (t['status'] == 'COMPLETED') {
        setState(() {
          active = null;
          driverPosition = null;
          routePoints = [];
          message = 'Viaje finalizado.';
        });
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
          driverPosition = null;
          routePoints = [];
          message = administrative
              ? 'El viaje fue cancelado por administración.'
              : 'La solicitud fue cancelada.';
        });
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
      realtime.subscribeTrip(t['tripId'].toString());
      refreshRoute(force: routePoints.isEmpty);
    } catch (_) {}
  }

  Future<void> useCurrentLocation() async {
    if (active != null) return;
    try {
      final position = await currentGpsPosition();
      if (!mounted || active != null) return;
      setState(() {
        pickup = LatLng(position.latitude, position.longitude);
        origin.text = 'Mi ubicación actual';
        message = 'Origen actualizado con tu ubicación GPS.';
      });
      realtime.subscribeNearby(position.latitude, position.longitude);
      refreshRoute(force: true);
    } catch (e) {
      if (mounted) setState(() => message = e.toString());
    }
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
      }
      refreshRoute(force: true);
    } catch (_) {
      setState(() => message = 'No se pudo buscar la ubicación.');
    }
  }

  void selectMapPoint(LatLng point) {
    setState(() {
      final label =
          'Punto (${point.latitude.toStringAsFixed(5)}, ${point.longitude.toStringAsFixed(5)})';
      if (mapSelection == MapPointSelection.origin) {
        pickup = point;
        origin.text = label;
        message = 'Origen marcado en el mapa.';
      } else {
        dropoff = point;
        destination.text = label;
        message = 'Destino marcado en el mapa.';
      }
    });
    if (mapSelection == MapPointSelection.origin) {
      realtime.subscribeNearby(point.latitude, point.longitude);
    }
    refreshRoute(force: true);
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
          paymentMethod: paymentMethod);
      setState(() => active = {'tripId': t['tripId']});
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
          if (active == null)
            SegmentedButton<MapPointSelection>(
              segments: const [
                ButtonSegment(
                    value: MapPointSelection.origin,
                    icon: Icon(Icons.location_on_outlined),
                    label: Text('Marcar origen')),
                ButtonSegment(
                    value: MapPointSelection.destination,
                    icon: Icon(Icons.flag_outlined),
                    label: Text('Marcar destino')),
              ],
              selected: {mapSelection},
              onSelectionChanged: (value) =>
                  setState(() => mapSelection = value.first),
            ),
          const SizedBox(height: 10),
          LiveMap(
              originLabel: o,
              destinationLabel: d,
              pickup: pickup,
              dropoff: dropoff,
              driverPosition: driverPosition,
              driverBearing: driverBearing,
              routePoints: routePoints,
              nearbyDrivers:
                  active == null ? nearbyDrivers : const <String, LatLng>{},
              editing: active == null ? mapSelection : null,
              onPointSelected: active == null ? selectMapPoint : null),
          if (routeDistanceMeters != null && routeDurationSeconds != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(
                'Ruta estimada: ${(routeDistanceMeters! / 1000).toStringAsFixed(1)} km · '
                '${(routeDurationSeconds! / 60).ceil()} min',
                textAlign: TextAlign.center,
              ),
            ),
          if (active == null) ...[
            TextField(
                controller: origin,
                decoration: InputDecoration(
                    labelText: 'Origen',
                    suffixIcon: Row(mainAxisSize: MainAxisSize.min, children: [
                      IconButton(
                          tooltip: 'Usar mi ubicación GPS',
                          icon: const Icon(Icons.my_location),
                          onPressed: useCurrentLocation),
                      IconButton(
                          tooltip: 'Buscar dirección',
                          icon: const Icon(Icons.search),
                          onPressed: () => locate(true))
                    ]))),
            TextField(
                controller: destination,
                decoration: InputDecoration(
                    labelText: 'Destino',
                    suffixIcon: IconButton(
                        icon: const Icon(Icons.search),
                        onPressed: () => locate(false)))),
            SegmentedButton<int>(segments: const [
              ButtonSegment(value: 1, label: Text('1')),
              ButtonSegment(value: 2, label: Text('2')),
              ButtonSegment(value: 3, label: Text('3'))
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
          if (message != null)
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
  List<LatLng> routePoints = [];
  DateTime? lastRouteAt;
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
    if (active == null) await refresh();
    if (!mounted) return;
    final tripId = requestedTripId ?? active?['tripId']?.toString();
    if (tripId == null || active?['tripId']?.toString() != tripId) return;
    await showTripChat(
      context: context,
      tripId: tripId,
      userId: widget.s.id,
      realtime: realtime,
      loadHistory: () => api.messages(widget.s.token, tripId),
      sendFallback: (clientId, body) =>
          api.sendMessage(widget.s.token, tripId, clientId, body),
    );
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
      if (active == null) routePoints = [];
    });
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
        if (mounted) setState(() => active = latest);
        realtime.subscribeTrip(latest['tripId'].toString());
        refreshDriverRoute(force: true);
      }
      if (available) {
        final r = await api.offers(widget.s.token);
        if (mounted) setState(() => offers = r);
      }
    } catch (e) {
      if (mounted) setState(() => driverMessage = e.toString());
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
              originLabel: active['originReference'] ?? 'Origen',
              destinationLabel: active['destinationReference'] ?? 'Destino',
              pickup: pickup,
              dropoff: dropoff,
              driverPosition: currentDriverPosition,
              driverBearing: currentDriverBearing,
              routePoints: routePoints,
              height: 330,
            ),
            Text('Pasajero: ${active['passengerName']}'),
            Text(
                'Pago: ${active['paymentMethod'] == 'DEUNA' ? 'De Una' : 'Efectivo'}'),
            Text('Estado: ${estadoViaje(active['status'])}'),
            OutlinedButton.icon(
              onPressed: openDriverChat,
              icon: const Icon(Icons.chat_bubble_outline),
              label: const Text('Chat con el pasajero'),
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
                        Text('${o['originReference'] ?? 'Origen'} → '
                            '${o['destinationReference'] ?? 'Destino'}'),
                        const SizedBox(height: 6),
                        Text(
                            'Pago: ${o['paymentMethod'] == 'DEUNA' ? 'De Una' : 'Efectivo'}'),
                        const SizedBox(height: 14),
                        FilledButton.icon(
                            onPressed: () async {
                              await api.respond(widget.s.token, o['offerId']);
                              await restore();
                              await refresh();
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
