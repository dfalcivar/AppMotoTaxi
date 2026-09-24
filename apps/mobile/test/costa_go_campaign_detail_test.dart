import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mototaxi_atacames/costa_go_benefits.dart';
import 'package:mototaxi_atacames/costa_go_campaigns.dart';

void main() {
  setUpAll(() async {
    if (const bool.fromEnvironment('CAPTURE_CAMPAIGN')) {
      for (final font in {
        'ReviewSans': const String.fromEnvironment('REVIEW_FONT'),
        'MaterialIcons': const String.fromEnvironment('REVIEW_ICONS'),
      }.entries) {
        final loader = FontLoader(font.key)
          ..addFont(Future.value(
              ByteData.sublistView(File(font.value).readAsBytesSync())));
        await loader.load();
      }
    }
  });
  final benefit = {
    'benefitType': 'COURTESY_DAYS',
    'valueLabel': '15 días gratis',
    'typeLabel': 'de membresía',
    'oneTime': true,
    'name': 'INTERNAL_NAME'
  };
  Widget card(Map<String, dynamic> data) => CostaGoBenefitCard(
      data: data,
      actionLabel: 'Activar cortesía',
      onClaim: () {},
      onRetry: () {});
  final campaign = <String, dynamic>{
    'title': 'Pioneros Costa-Go 🚀👑',
    'subtitle': 'Gracias por confiar en nosotros desde el inicio.',
    'description':
        'Eres parte de los primeros conductores que comienzan este camino con Costa-Go. Disfruta tu cortesía de bienvenida y empieza a moverte con nosotros.',
    'endsAt': '2026-10-30T09:59:00Z',
    'terms': 'Condiciones legales del programa.',
    'benefitCode': 'PRIVATE',
    'ctaType': 'CAMPAIGN_DETAIL',
    'ctaText': 'Activar cortesía'
  };

  for (final dark in [false, true]) {
    for (final scale in [1.0, 2.0]) {
      testWidgets('small phone dark=$dark scale=$scale has no overflow',
          (tester) async {
        tester.view.reset();
        await tester.binding.setSurfaceSize(const Size(320, 700));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        await tester.pumpWidget(MaterialApp(
            theme: ThemeData(
                brightness: dark ? Brightness.dark : Brightness.light),
            home: MediaQuery(
                data: MediaQueryData(
                    size: const Size(320, 700),
                    textScaler: TextScaler.linear(scale)),
                child: Scaffold(
                    body: CostaGoCampaignDetailContent(
                        campaign: campaign,
                        benefit: card(
                            {'benefit': benefit, 'state': 'AVAILABLE'}))))));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(find.text('INTERNAL_NAME'), findsNothing);
        await tester.scrollUntilVisible(
            find.text('Términos y condiciones'), 200);
        expect(find.text('Condiciones legales del programa.'), findsNothing);
        await tester.tap(find.text('Términos y condiciones'));
        await tester.pumpAndSettle();
        expect(find.text('Condiciones legales del programa.'), findsOneWidget);
        expect(tester.takeException(), isNull);
      });
    }
  }
  for (final state in ['CLAIMED', 'NOT_ELIGIBLE', 'EXPIRED', 'USED']) {
    testWidgets('$state cannot activate', (tester) async {
      await tester.pumpWidget(MaterialApp(
          home: Scaffold(
              body: SingleChildScrollView(
                  child: card({
        'benefit': benefit,
        'state': state,
        'message': 'No disponible'
      })))));
      expect(
          find.widgetWithText(FilledButton, 'Activar cortesía'), findsNothing);
    });
  }
  testWidgets('informational campaign has no benefit and keeps its action',
      (tester) async {
    var calls = 0;
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: CostaGoCampaignDetailContent(campaign: {
      ...campaign,
      'benefitCode': null,
      'ctaType': 'SUPPORT',
      'ctaText': 'Conocer más'
    }, onAction: () => calls++))));
    expect(find.byType(CostaGoBenefitCard), findsNothing);
    await tester.ensureVisible(find.text('Conocer más'));
    await tester.tap(find.text('Conocer más'));
    expect(calls, 1);
  });
  testWidgets('balance and reusable limits remain server owned',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: card({
      'state': 'AVAILABLE',
      'benefit': {
        'benefitType': 'PROMOTIONAL_BALANCE',
        'valueLabel': r'$3.00',
        'typeLabel': 'de saldo promocional',
        'oneTime': false,
        'maxPerUser': 5
      }
    }))));
    expect(find.text(r'$3.00'), findsOneWidget);
    expect(find.byIcon(Icons.account_balance_wallet_outlined), findsOneWidget);
    expect(find.text('Disponible una sola vez.'), findsNothing);
  });
  testWidgets('reference composition capture', (tester) async {
    await tester.binding.setSurfaceSize(const Size(430, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final key = GlobalKey();
    await tester.pumpWidget(MaterialApp(
        locale: const Locale('es'),
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        supportedLocales: const [Locale('es')],
        theme: ThemeData(
            fontFamily: 'ReviewSans',
            colorScheme:
                ColorScheme.fromSeed(seedColor: const Color(0xff0088ff))
                    .copyWith(primary: const Color(0xff0088ff))),
        home: RepaintBoundary(
            key: key,
            child: Scaffold(
                backgroundColor: const Color(0xfff2faff),
                appBar: AppBar(
                    backgroundColor: const Color(0xfff2faff),
                    leading: const Icon(Icons.arrow_back),
                    title: const Text('Campaña Costa-Go'),
                    actions: const [Icon(Icons.refresh), SizedBox(width: 16)]),
                body: CostaGoCampaignDetailContent(
                    campaign: campaign,
                    benefit:
                        card({'benefit': benefit, 'state': 'AVAILABLE'}))))));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    if (const bool.fromEnvironment('CAPTURE_CAMPAIGN')) {
      await tester.runAsync(() async {
        final image = await (key.currentContext!.findRenderObject()
                as RenderRepaintBoundary)
            .toImage();
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        Directory('build/review').createSync(recursive: true);
        File('build/review/campaign-detail.png')
            .writeAsBytesSync(bytes!.buffer.asUint8List());
        image.dispose();
      });
    }
  });
}
