import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mototaxi_atacames/costa_go_campaigns.dart';
import 'package:mototaxi_atacames/costa_go_coastal.dart';
import 'package:mototaxi_atacames/costa_go_affiliates.dart';
import 'package:mototaxi_atacames/costa_go_design.dart';

Map<String, dynamic> item(
        {String id = 'real',
        String variant = 'DEFAULT',
        bool decorate = false}) =>
    {
      'id': id,
      'title': 'Título recibido del servidor',
      'subtitle': 'Subtítulo recibido',
      'startsAt':
          DateTime.now().subtract(const Duration(hours: 1)).toIso8601String(),
      'endsAt': DateTime.now().add(const Duration(hours: 1)).toIso8601String(),
      'placements': ['HOME'],
      'assets': [],
      'ctaType': 'SUPPORT',
      'ctaText': 'Consultar soporte',
      'variant': variant,
      'decorateHeader': decorate,
    };
void main() {
  testWidgets(
      'HOME has zero campaign height until backend supplies HOME; removes it on pause in the same session',
      (tester) async {
    var items = <Map<String, dynamic>>[];
    final store = CostaGoCampaignStore(
        load: () async => {'items': items},
        detail: (_) async => item(),
        imageUrl: (_, __) => '',
        headers: const {});
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: Column(children: [
      CostaGoHomeCampaigns(store: store, onAction: (_, __) async {}),
      const Text('Solicitar mototaxi', key: ValueKey('access'))
    ]))));
    await tester.pump();
    await tester.pump();
    final before = tester.getTopLeft(find.byKey(const ValueKey('access'))).dy;
    expect(find.byType(CostaGoCampaignCard), findsNothing);
    expect(before, 0);
    items = [item()];
    await store.refresh(force: true);
    await tester.pump();
    expect(find.text('Título recibido del servidor'), findsOneWidget);
    expect(tester.getTopLeft(find.byKey(const ValueKey('access'))).dy,
        greaterThan(before));
    items = [];
    await store.refresh(force: true);
    await tester.pump();
    expect(tester.getTopLeft(find.byKey(const ValueKey('access'))).dy, before);
    items = [
      {
        ...item(),
        'placements': ['CAMPAIGNS']
      }
    ];
    await store.refresh(force: true);
    await tester.pump();
    expect(find.byType(CostaGoCampaignCard), findsNothing);
    await tester.pumpWidget(const SizedBox());
    store.dispose();
  });
  testWidgets(
      'decoration is opt-in, uses first eligible server order and vanishes during operations',
      (tester) async {
    var enabled = true;
    final store = CostaGoCampaignStore(
        load: () async => {
              'items': [
                item(id: 'first', variant: 'SUMMER'),
                item(id: 'second', variant: 'CARNIVAL', decorate: true),
                item(id: 'third', variant: 'CHRISTMAS', decorate: true)
              ]
            },
        detail: (_) async => item(),
        imageUrl: (_, __) => '',
        headers: const {});
    await store.refresh();
    Widget app() => MaterialApp(
        home: Scaffold(
            body: CostaGoCampaignHeaderDecoration(
                store: store,
                enabled: enabled,
                child: const Text('Usuario real'))));
    await tester.pumpWidget(app());
    expect(find.byIcon(Icons.celebration_outlined), findsOneWidget);
    expect(find.byIcon(Icons.wb_sunny_outlined), findsNothing);
    expect(find.byIcon(Icons.ac_unit), findsNothing);
    enabled = false;
    await tester.pumpWidget(app());
    expect(find.byIcon(Icons.celebration_outlined), findsNothing);
    await tester.pumpWidget(const SizedBox());
    store.dispose();
  });
  testWidgets('HOME CTA uses the revalidated backend destination',
      (tester) async {
    String? route;
    final store = CostaGoCampaignStore(
        load: () async => {
              'items': [item()]
            },
        detail: (_) async => item(),
        imageUrl: (_, __) => '',
        headers: const {});
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: CostaGoHomeCampaigns(
                store: store, onAction: (_, r) async => route = r))));
    await tester.pump();
    await tester.pump();
    await tester.tap(find.text('Consultar soporte'));
    await tester.pump();
    expect(route, 'support');
    await tester.pumpWidget(const SizedBox());
    store.dispose();
  });
  testWidgets(
      'affiliates empty state uses only existing commerce link, emits no impressions',
      (tester) async {
    var impressions = 0;
    await tester.pumpWidget(MaterialApp(
        home: CostaGoAffiliatesScreen(
            load: () async => [],
            imageUrl: (_) => '',
            onTap: (_) {},
            onImpression: (_) => impressions++)));
    await tester.pump();
    await tester.pump(const Duration(seconds: 2));
    expect(
        find.text('Aún no hay comercios afiliados en tu zona'), findsOneWidget);
    expect(find.text('Afiliar mi comercio'), findsOneWidget);
    expect(impressions, 0);
    await tester.pumpWidget(const SizedBox());
  });
  for (final brightness in Brightness.values) {
    for (final width in [320.0, 430.0]) {
      for (final scale in [1.0, 1.8]) {
        testWidgets(
            'coastal forms and home cards ${brightness.name} $width scale $scale',
            (tester) async {
          tester.view.physicalSize = Size(width, 850);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          await tester.pumpWidget(MaterialApp(
              theme: CostaGoTheme.build(brightness),
              home: MediaQuery(
                  data: MediaQueryData(
                      size: Size(width, 850),
                      textScaler: TextScaler.linear(scale),
                      viewInsets: const EdgeInsets.only(bottom: 180)),
                  child: CostaGoScaffold(
                      body: CostaGoGlassSheet(
                          overMap: true,
                          child: ListView(
                              padding: const EdgeInsets.all(16),
                              children: [
                                const CostaGoHomeHeader(),
                                CostaGoQuickActionCard(
                                    title: 'Comercios afiliados',
                                    subtitle:
                                        'Negocios y servicios cerca de ti',
                                    icon: Icons.storefront,
                                    onTap: () {}),
                                CostaGoFormSection(
                                    title: 'Identificación de la unidad',
                                    icon: Icons.badge,
                                    child: TextFormField(
                                        decoration: const InputDecoration(
                                            labelText: 'Placa o registro'))),
                                CostaGoAccountTile(
                                    icon: Icons.person,
                                    title: 'Mi perfil',
                                    subtitle:
                                        'Administra tu información personal',
                                    onTap: () {}),
                              ]))))));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
        });
      }
    }
  }
}
