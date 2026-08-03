import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

class RealtimeService {
  RealtimeService({required this.baseUrl, required this.token});

  final String baseUrl;
  final String token;
  final _events = StreamController<Map<String, dynamic>>.broadcast();
  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _subscription;
  Timer? _reconnectTimer;
  bool _disposed = false;
  int _attempt = 0;

  Stream<Map<String, dynamic>> get events => _events.stream;
  bool get connected => _channel != null;

  Uri get _uri {
    final source = Uri.parse(baseUrl);
    return source.replace(
      scheme: source.scheme == 'https' ? 'wss' : 'ws',
      path: '/v1/realtime',
      query: null,
      fragment: null,
    );
  }

  Future<void> connect() async {
    if (_disposed || _channel != null) return;
    try {
      final channel = IOWebSocketChannel.connect(
        _uri,
        headers: {'Authorization': 'Bearer $token'},
        connectTimeout: const Duration(seconds: 20),
        pingInterval: const Duration(seconds: 20),
      );
      await channel.ready;
      if (_disposed) {
        await channel.sink.close();
        return;
      }
      _channel = channel;
      _attempt = 0;
      _subscription = channel.stream.listen(
        (value) {
          try {
            final decoded = jsonDecode(value.toString());
            if (decoded is Map<String, dynamic>) _events.add(decoded);
          } catch (_) {}
        },
        onError: (_) => _disconnected(),
        onDone: _disconnected,
        cancelOnError: true,
      );
    } catch (_) {
      _disconnected();
    }
  }

  void _disconnected() {
    _subscription?.cancel();
    _subscription = null;
    _channel = null;
    if (_disposed || _reconnectTimer != null) return;
    final exponent = _attempt > 5 ? 5 : _attempt;
    final seconds = 1 << exponent;
    _attempt++;
    _reconnectTimer = Timer(Duration(seconds: seconds), () {
      _reconnectTimer = null;
      connect();
    });
  }

  bool send(Map<String, dynamic> event) {
    final channel = _channel;
    if (channel == null) return false;
    try {
      channel.sink.add(jsonEncode(event));
      return true;
    } catch (_) {
      _disconnected();
      return false;
    }
  }

  bool subscribeTrip(String tripId) =>
      send({'type': 'trip:subscribe', 'tripId': tripId});

  bool subscribeNearby(double latitude, double longitude) => send({
        'type': 'nearby:subscribe',
        'latitude': latitude,
        'longitude': longitude,
      });

  bool sendDriverLocation({
    String? tripId,
    required double latitude,
    required double longitude,
    required double bearing,
    required double speed,
    required double accuracy,
    required DateTime recordedAt,
    required int sequence,
  }) =>
      send({
        'type': 'driver:location',
        if (tripId != null) 'tripId': tripId,
        'latitude': latitude,
        'longitude': longitude,
        'bearing': bearing < 0 ? 0 : bearing,
        'speed': speed < 0 ? 0 : speed,
        'accuracy': accuracy,
        'recordedAt': recordedAt.toUtc().toIso8601String(),
        'sequence': sequence,
      });

  bool sendMessage(String tripId, String clientMessageId, String body) => send({
        'type': 'chat:send',
        'tripId': tripId,
        'clientMessageId': clientMessageId,
        'body': body,
      });

  bool markRead(String tripId) => send({'type': 'chat:read', 'tripId': tripId});

  Future<void> dispose() async {
    _disposed = true;
    _reconnectTimer?.cancel();
    await _subscription?.cancel();
    await _channel?.sink.close();
    await _events.close();
  }
}
