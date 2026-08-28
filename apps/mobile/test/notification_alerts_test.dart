import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mototaxi_atacames/notification_alerts.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final calls = <MethodCall>[];
  setUp(() {
    calls.clear();
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(notificationAlerts, (call) async {
      calls.add(call);
      return call.method == 'showOffer' ? true : null;
    });
  });
  tearDown(() {
    debugDefaultTargetPlatformOverride = null;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(notificationAlerts, null);
  });
  test(
      'oferta en segundo plano conserva los datos y el vencimiento del servidor',
      () async {
    final data = {
      'type': 'TRIP_OFFER',
      'tripId': 'trip-1',
      'expiresAt': '2026-08-27T23:00:00Z'
    };
    await receiveBackgroundAlert(data);
    expect(calls.single.method, 'showOffer');
    expect(calls.single.arguments, data);
  });
  test(
      'rechazo o asignación a otro conductor retiran alerta sin sonar otra vez',
      () async {
    for (final type in ['TRIP_OFFER_CANCELLED', 'OFFER_CLOSED']) {
      await receiveBackgroundAlert({'type': type, 'tripId': 'trip-1'});
    }
    expect(calls.map((c) => c.method), ['stop', 'stop']);
  });
  test('cancelación retira la oferta antes de mostrar el aviso de cancelación',
      () async {
    await receiveBackgroundAlert(
        {'type': 'TRIP_CANCELLED', 'tripId': 'trip-1'});
    expect(calls.map((c) => c.method), ['stop', 'showOffer']);
  });
  test('no duplica mensajes y estados que Firebase ya muestra en segundo plano',
      () async {
    for (final type in [
      'CHAT_MESSAGE',
      'DRIVER_ARRIVED',
      'IN_PROGRESS',
      'NO_DRIVER'
    ]) {
      await receiveBackgroundAlert({'type': type, 'tripId': 'trip-1'});
    }
    expect(calls, isEmpty);
  });
  test('un error nativo no aborta el procesamiento de mensajes', () async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(notificationAlerts,
            (_) async => throw PlatformException(code: 'DISABLED'));
    await receiveBackgroundAlert(
        {'type': 'TRIP_CANCELLED', 'tripId': 'trip-1'});
  });
}
