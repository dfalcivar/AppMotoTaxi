import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mototaxi_atacames/costa_go_campaigns.dart';
import 'package:mototaxi_atacames/costa_go_design.dart';

CampaignData data(
        {String variant = 'CHRISTMAS',
        bool decorate = true,
        List<String> assets = const [],
        List<String> placements = const ['HOME']}) =>
    {
      'id': 'configured',
      'version': 1,
      'title': 'Beneficio configurado',
      'subtitle': 'Contenido real de prueba',
      'variant': variant,
      'decorateHeader': decorate,
      'assets': assets,
      'placements': placements,
      'startsAt':
          DateTime.now().subtract(const Duration(hours: 1)).toIso8601String(),
      'endsAt': DateTime.now().add(const Duration(hours: 1)).toIso8601String(),
      'ctaType': 'NONE',
      'ctaText': '',
    };
CostaGoCampaignStore storeFor(Future<CampaignData> Function() load) =>
    CostaGoCampaignStore(
        load: load,
        detail: (_) async => data(),
        headers: const {},
        imageUrl: (_, kind) => 'https://example.test/$kind.png',
        ttl: const Duration(seconds: 10));

void main() {
  test(
      'image selection keeps compact resources first and single images in both themes',
      () {
    for (final brightness in Brightness.values) {
      expect(
          campaignImageKind(['MAIN', 'DARK', 'THUMBNAIL'], brightness,
              thumbnail: true),
          'THUMBNAIL');
      expect(campaignImageKind(['MAIN'], brightness), 'MAIN');
      expect(campaignImageKind(['DARK'], brightness), 'DARK');
      expect(campaignImageKind(['DECORATION'], brightness), isNull);
    }
    expect(campaignImageKind(['MAIN', 'DARK'], Brightness.dark), 'DARK');
    expect(campaignImageKind(['MAIN', 'DARK'], Brightness.light), 'MAIN');
  });
  for (final entry in {
    'CHRISTMAS': 'christmas_hat',
    'CARNIVAL': 'carnival_mask',
    'SUMMER': 'summer_detail'
  }.entries) {
    for (final brightness in Brightness.values) {
      testWidgets(
          '${entry.key} overlay ${brightness.name}, avatar remains tappable at large text',
          (tester) async {
        final store = storeFor(() async => {
              'items': [data(variant: entry.key)]
            });
        var taps = 0;
        await tester.pumpWidget(MaterialApp(
            theme: CostaGoTheme.build(brightness),
            home: Scaffold(
                body: MediaQuery(
                    data:
                        const MediaQueryData(textScaler: TextScaler.linear(2)),
                    child: Center(
                        child: GestureDetector(
                            onTap: () => taps++,
                            child: CostaGoCampaignHeaderDecoration(
                                store: store,
                                child: const SizedBox(
                                    width: 46,
                                    height: 46,
                                    child:
                                        CircleAvatar(child: Text('J'))))))))));
        await tester.pumpAndSettle();
        final overlay =
            find.byKey(ValueKey('campaign-decoration-${entry.value}'));
        expect(overlay, findsOneWidget);
        expect(tester.getSize(overlay).width, 25);
        await tester.tap(find.byType(CircleAvatar));
        expect(taps, 1);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        store.dispose();
      });
    }
  }
  testWidgets(
      'header without HOME refreshes by itself, paused and failed API remove decoration',
      (tester) async {
    var items = [
      data(placements: ['CAMPAIGNS'])
    ];
    var fail = false;
    var calls = 0;
    final store = storeFor(() async {
      calls++;
      if (fail) throw StateError('offline');
      return {'items': items};
    });
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: CostaGoCampaignHeaderDecoration(
                store: store, child: const CircleAvatar()))));
    await tester.pumpAndSettle();
    expect(store.forPlacement('HOME'), isEmpty);
    expect(find.byKey(const ValueKey('campaign-decoration-christmas_hat')),
        findsOneWidget);
    items = [];
    await tester.pump(const Duration(seconds: 11));
    await tester.pumpAndSettle();
    expect(calls, greaterThan(1));
    expect(store.headerCampaign, isNull);
    items = [data()];
    await store.refresh(force: true);
    await tester.pumpAndSettle();
    fail = true;
    await store.refresh(force: true);
    await tester.pumpAndSettle();
    expect(store.headerCampaign, isNull);
    expect(find.textContaining('offline'), findsNothing);
    await tester.pumpWidget(const SizedBox());
    store.dispose();
  });
  testWidgets(
      'remote DECORATION has priority and broken asset falls back; CUSTOM stays normal',
      (tester) async {
    var item = data(assets: ['MAIN', 'DECORATION']);
    final store = storeFor(() async => {
          'items': [item]
        });
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: CostaGoCampaignHeaderDecoration(
                store: store, child: const CircleAvatar()))));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('campaign-decoration-remote-configured')),
        findsOneWidget);
    expect(find.byKey(const ValueKey('campaign-decoration-christmas_hat')),
        findsOneWidget);
    item = data(variant: 'CUSTOM', assets: ['DECORATION']);
    await store.refresh(force: true);
    await tester.pumpAndSettle();
    expect(find.byType(CircleAvatar), findsOneWidget);
    expect(find.byKey(const ValueKey('campaign-decoration-christmas_hat')),
        findsNothing);
    item = data(variant: 'CUSTOM');
    await store.refresh(force: true);
    await tester.pumpAndSettle();
    expect(find.byType(Image), findsNothing);
    item = data(variant: 'DEFAULT', assets: ['DECORATION']);
    await store.refresh(force: true);
    await tester.pumpAndSettle();
    expect(find.byType(Image), findsNothing);
    item = data(decorate: false);
    await store.refresh(force: true);
    await tester.pumpAndSettle();
    expect(find.byType(Image), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    store.dispose();
  });
  for (final brightness in Brightness.values) {
    testWidgets(
        'compact card ${brightness.name}: thumbnail first, failed image becomes text, no invented CTA',
        (tester) async {
      tester.view.physicalSize = const Size(320, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final item = data(assets: ['MAIN', 'DARK', 'THUMBNAIL']);
      final kinds = <String>[];
      final store = CostaGoCampaignStore(
          load: () async => {
                'items': [item]
              },
          detail: (_) async => item,
          headers: const {},
          imageUrl: (_, kind) {
            kinds.add(kind);
            return 'https://example.test/$kind.png';
          });
      await tester.pumpWidget(MaterialApp(
          theme: CostaGoTheme.build(brightness),
          home: Scaffold(
              body: MediaQuery(
                  data:
                      const MediaQueryData(textScaler: TextScaler.linear(1.8)),
                  child: CostaGoHomeCampaigns(
                      store: store, onAction: (_, __) async {})))));
      await tester.pumpAndSettle();
      expect(kinds, everyElement('THUMBNAIL'));
      expect(find.text('Beneficio configurado'), findsOneWidget);
      expect(find.byType(TextButton), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      store.dispose();
    });
  }
  testWidgets(
      'expired campaign vanishes in open session; server order independently selects card and header',
      (tester) async {
    final main = {...data(decorate: false), 'id': 'first'};
    final decoration = {
      ...data(placements: ['CAMPAIGNS']),
      'id': 'second',
      'endsAt': DateTime.now().add(const Duration(seconds: 2)).toIso8601String()
    };
    final store = storeFor(() async => {
          'items': [main, decoration]
        });
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: Column(children: [
      CostaGoCampaignHeaderDecoration(
          store: store, child: const CircleAvatar()),
      CostaGoHomeCampaigns(store: store, onAction: (_, __) async {}),
    ]))));
    await tester.pumpAndSettle();
    expect(store.headerCampaign?['id'], 'second');
    expect(
        tester
            .widget<CostaGoCampaignCard>(find.byType(CostaGoCampaignCard))
            .campaign['id'],
        'first');
    // The store uses server-adjusted wall time; advance wall time and widget timers.
    await tester
        .runAsync(() => Future<void>.delayed(const Duration(seconds: 3)));
    await tester.pump(const Duration(seconds: 3));
    await tester.pumpAndSettle();
    expect(store.headerCampaign, isNull);
    expect(find.byType(CostaGoCampaignCard), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    store.dispose();
  });
}
