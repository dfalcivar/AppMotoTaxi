import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mototaxi_atacames/costa_go_campaigns.dart';

CampaignData campaign({String action = 'NONE', String destination = ''}) => {
      'id': 'campaign-1',
      'title': 'Novedades Costa-Go',
      'subtitle': 'Para tu próxima visita',
      'description': 'Información de la campaña',
      'terms': 'Condiciones de prueba',
      'startsAt':
          DateTime.now().subtract(const Duration(hours: 1)).toIso8601String(),
      'endsAt': DateTime.now().add(const Duration(hours: 1)).toIso8601String(),
      'placements': ['HOME', 'CAMPAIGNS'],
      'assets': [],
      'ctaType': action,
      'ctaText': 'Conocer más',
      'ctaDestination': destination,
    };
CostaGoCampaignStore storeFor(
        {required Future<CampaignData> Function() load,
        Future<CampaignData> Function(String)? detail,
        Duration ttl = const Duration(minutes: 5)}) =>
    CostaGoCampaignStore(
      load: load,
      detail: detail ?? (_) => Future.value(campaign()),
      imageUrl: (_, __) => '',
      headers: const {},
      ttl: ttl,
    );
void main() {
  test(
      'cache refreshes within the same session, shares requests and never retains stale data on failure',
      () async {
    var calls = 0;
    var items = [campaign()];
    var fail = false;
    final store = storeFor(load: () async {
      calls++;
      if (fail) throw StateError('offline');
      return {'items': items};
    });
    addTearDown(store.dispose);
    await Future.wait([store.refresh(), store.refresh()]);
    expect(calls, 1);
    expect(store.forPlacement('HOME'), hasLength(1));
    await store.refresh();
    expect(calls, 1);
    items = [];
    await store.refresh(force: true);
    expect(store.forPlacement('CAMPAIGNS'), isEmpty);
    expect(calls, 2);
    fail = true;
    await store.refresh(force: true);
    expect(store.error, isNotNull);
    expect(store.forPlacement('HOME'), isEmpty);
  });
  test('does not notify a disposed session after an old request returns',
      () async {
    final completer = Completer<CampaignData>();
    final store = storeFor(load: () => completer.future);
    final request = store.refresh();
    store.dispose();
    completer.complete({
      'items': [campaign()]
    });
    await request;
  });
  test('filters expired campaigns and validates external links', () {
    final store = storeFor(load: () async => {'items': []});
    addTearDown(store.dispose);
    expect(
        store.current({
          ...campaign(),
          'endsAt': DateTime.now()
              .subtract(const Duration(seconds: 1))
              .toIso8601String()
        }),
        isFalse);
    for (final value in [
      'javascript:alert(1)',
      'http://costa-go.com',
      'https://user:pass@example.com',
      'https://localhost',
      'https://127.0.0.1'
    ]) {
      expect(safeCampaignExternalUri(value), isFalse);
    }
    expect(safeCampaignExternalUri('https://costa-go.com/novedades'), isTrue);
  });
  testWidgets('expires cached content without logout or a network request',
      (tester) async {
    final store = storeFor(
        load: () async => {
              'items': [campaign()]
            },
        ttl: const Duration(seconds: 5));

    await store.refresh();
    expect(store.forPlacement('CAMPAIGNS'), hasLength(1));
    await tester.pump(const Duration(seconds: 6));
    expect(store.forPlacement('CAMPAIGNS'), isEmpty);
    store.dispose();
  });
  testWidgets('lists, opens generic detail and dispatches a valid internal CTA',
      (tester) async {
    final data = campaign(action: 'INTERNAL_ROUTE', destination: 'support');
    var action = '';
    final store = storeFor(
        load: () async => {
              'items': [data]
            },
        detail: (_) async => data);

    await tester.pumpWidget(MaterialApp(
        home: CostaGoCampaignScreen(
            store: store,
            onAction: (_, route) async {
              action = route;
            })));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ver campaña'));
    await tester.pumpAndSettle();
    expect(find.text('Términos y condiciones'), findsOneWidget);
    await tester.ensureVisible(find.text('Conocer más'));
    await tester.tap(find.text('Conocer más'));
    await tester.pumpAndSettle();
    expect(action, 'support');
    await tester.pumpWidget(const SizedBox.shrink());
    store.dispose();
  });
  testWidgets('external CTA confirms the host and opens only validated HTTPS',
      (tester) async {
    String? launched;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        const MethodChannel('plugins.flutter.io/url_launcher'), (call) async {
      if (call.method == 'launch') {
        launched = (call.arguments as Map)['url'] as String;
        return true;
      }
      return true;
    });
    addTearDown(() => tester.binding.defaultBinaryMessenger
        .setMockMethodCallHandler(
            const MethodChannel('plugins.flutter.io/url_launcher'), null));
    final data = campaign(
        action: 'EXTERNAL_URL', destination: 'https://costa-go.com/novedades');
    final store = storeFor(
        load: () async => {
              'items': [data]
            },
        detail: (_) async => data);

    await tester.pumpWidget(MaterialApp(
        home: CostaGoCampaignDetail(
            store: store, id: 'campaign-1', onAction: (_, __) async {})));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Conocer más'));
    await tester.tap(find.text('Conocer más'));
    await tester.pumpAndSettle();
    expect(find.text('costa-go.com'), findsOneWidget);
    expect(launched, isNull);
    await tester.tap(find.text('Abrir'));
    await tester.pumpAndSettle();
    expect(launched, 'https://costa-go.com/novedades');
    await tester.pumpWidget(const SizedBox.shrink());
    store.dispose();
  });
  testWidgets('refreshes the list after resuming an existing session',
      (tester) async {
    var calls = 0;
    final store = storeFor(
        load: () async {
          calls++;
          return {
            'items': calls == 1 ? [campaign()] : []
          };
        },
        ttl: const Duration(seconds: 5));

    await tester.pumpWidget(MaterialApp(
        home: CostaGoCampaignScreen(store: store, onAction: (_, __) async {})));
    await tester.pumpAndSettle();
    expect(calls, 1);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump(const Duration(seconds: 6));
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(calls, 2);
    expect(find.text('No hay campañas disponibles'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    store.dispose();
  });
}
