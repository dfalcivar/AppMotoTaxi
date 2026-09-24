import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mototaxi_atacames/costa_go_benefits.dart';

void main() {
  final benefit = {
    'name': 'Conductor fundador',
    'description': 'Cortesía Costa-Go',
    'benefitType': 'COURTESY_DAYS',
    'value': 15,
    'oneTime': true,
    'valueLabel': '15 días gratis',
    'typeLabel': 'de membresía'
  };
  final grant = {
    'status': 'PENDING',
    'effectiveFrom': '2026-10-01T12:00:00Z',
    'effectiveUntil': '2026-10-16T12:00:00Z'
  };
  testWidgets('uses server coverage and prevents a double claim while waiting',
      (tester) async {
    var calls = 0;
    final result = Completer<Map<String, dynamic>>();
    final service = CostaGoBenefitsService(
        read: (c, id) async => {'benefit': benefit, 'state': 'AVAILABLE'},
        claim: (c, id) {
          calls++;
          expect(c, 'DRIVER_FOUNDER_COURTESY');
          expect(id, 'campaign');
          return result.future;
        });
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: CostaGoBenefitPanel(
                actionLabel: 'Activar cortesía',
                service: service,
                code: 'DRIVER_FOUNDER_COURTESY',
                campaignId: 'campaign'))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Activar cortesía'));
    await tester.pump();
    await tester.tap(find.text('Activar cortesía'));
    await tester.pump();
    expect(calls, 1);
    result.complete({'success': true, 'benefit': benefit, 'redemption': grant});
    await tester.pumpAndSettle();
    expect(find.text('Beneficio activado · inicio programado'), findsOneWidget);
    expect(find.textContaining('Válido hasta'), findsOneWidget);
    expect(find.text('Activar cortesía'), findsNothing);
  });
  testWidgets(
      'reopened detail uses backend redemption instead of device memory',
      (tester) async {
    final service = CostaGoBenefitsService(
        read: (c, id) async => {
              'benefit': benefit,
              'state': 'ALREADY_REDEEMED',
              'redemption': grant
            },
        claim: (c, id) async => throw StateError('must not claim'));
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: CostaGoBenefitPanel(
                actionLabel: 'Activar cortesía',
                service: service,
                code: 'DRIVER_FOUNDER_COURTESY',
                campaignId: 'duplicated-campaign'))));
    await tester.pumpAndSettle();
    expect(find.text('Beneficio activado · inicio programado'), findsOneWidget);
    expect(find.text('Activar cortesía'), findsNothing);
  });
  testWidgets('shows functional ineligibility with no activation',
      (tester) async {
    final service = CostaGoBenefitsService(
        read: (c, id) async => {
              'benefit': benefit,
              'state': 'NOT_ELIGIBLE',
              'message': 'Tu cuenta no cumple las condiciones.'
            },
        claim: (c, id) async => throw StateError('must not claim'));
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: CostaGoBenefitPanel(
                actionLabel: 'Activar cortesía',
                service: service,
                code: 'CODE',
                campaignId: 'campaign'))));
    await tester.pumpAndSettle();
    expect(find.text('Tu cuenta no cumple las condiciones.'), findsOneWidget);
    expect(find.text('Activar cortesía'), findsNothing);
  });
}
