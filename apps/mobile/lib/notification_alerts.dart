import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

const notificationAlerts = MethodChannel('ec.atacames.mototaxi/alerts');
final nativeNotificationOpened =
    StreamController<Map<String, dynamic>>.broadcast();
bool get nativeAlertsSupported =>
    !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

StreamSubscription<Map<String, dynamic>>? listenToNativeNotificationOpens(
    void Function(Map<String, dynamic>) onOpen) {
  if (!nativeAlertsSupported) return null;
  final subscription = nativeNotificationOpened.stream.listen((data) {
    unawaited(notificationAlerts
        .invokeMethod<void>('consumeOpen')
        .catchError((_) {}));
    onOpen(data);
  });
  unawaited(notificationAlerts
      .invokeMapMethod<String, dynamic>('consumeOpen')
      .then((data) {
    if (data != null) onOpen(data);
  }).catchError((_) {}));
  return subscription;
}

Future<void> stopOfferAlert(String tripId) async {
  if (!nativeAlertsSupported) return;
  try {
    await notificationAlerts.invokeMethod<void>('stop', {'tripId': tripId});
  } catch (_) {}
}

Future<void> receiveBackgroundAlert(Map<String, dynamic> data) async {
  if (!nativeAlertsSupported) return;
  final type = data['type'];
  if (type == 'TRIP_OFFER') {
    try {
      await notificationAlerts.invokeMethod<bool>('showOffer', data);
    } catch (_) {}
  } else if ({'TRIP_OFFER_CANCELLED', 'TRIP_CANCELLED', 'OFFER_CLOSED'}
      .contains(type)) {
    await stopOfferAlert(data['tripId']?.toString() ?? '');
    if (type == 'TRIP_CANCELLED') {
      try {
        await notificationAlerts.invokeMethod<bool>('showOffer', data);
      } catch (_) {}
    }
  }
}

void initializeNativeNotificationOpens() {
  if (!nativeAlertsSupported) return;
  notificationAlerts.setMethodCallHandler((call) async {
    if (call.method == 'opened' && call.arguments is Map) {
      nativeNotificationOpened
          .add(Map<String, dynamic>.from(call.arguments as Map));
    }
  });
}
