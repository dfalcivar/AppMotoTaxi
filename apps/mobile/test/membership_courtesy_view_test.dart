import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mototaxi_atacames/membership_courtesy_view.dart';

void main() {
  final start = DateTime.utc(2026, 9, 24, 21);
  final end = start.add(const Duration(days: 15));
  Map<String, dynamic> response({
    String status = 'ACTIVE',
    bool eligible = true,
    String selectedId = 'grant-1',
    int? durationDays = 15,
  }) =>
      {
        'eligibility': {
          'eligible': eligible,
          'benefit': {'id': selectedId}
        },
        'benefitCoverage': [
          {
            'id': 'grant-1',
            'status': status,
            'effectiveFrom': start.toIso8601String(),
            'effectiveUntil': end.toIso8601String(),
            if (durationDays != null) 'durationDays': durationDays,
          }
        ]
      };

  test('shows only the active, eligible benefit selected by membership API',
      () {
    final now = start.add(const Duration(days: 2));
    final courtesy = activeMembershipCourtesy(response(), now: now);
    expect(courtesy?.description, '15 días gratis de membresía');
    expect(courtesy?.expiresAt, end);
    expect(activeMembershipCourtesy(response(status: 'PENDING'), now: now),
        isNull);
    expect(
        activeMembershipCourtesy(response(eligible: false), now: now), isNull);
    expect(activeMembershipCourtesy(response(selectedId: 'other'), now: now),
        isNull);
    expect(activeMembershipCourtesy(response(), now: end), isNull);
    expect(
        activeMembershipCourtesy(response(),
            now: start.subtract(const Duration(seconds: 1))),
        isNull);
  });

  test('older API responses can still display their actual coverage length',
      () {
    final courtesy = activeMembershipCourtesy(response(durationDays: null),
        now: start.add(const Duration(days: 1)));
    expect(courtesy?.description, '15 días gratis de membresía');
  });

  test('free trips show pending balance and become active after the paid plan', () {
    final pending = freeTripBenefitCoverages({
      'benefitCoverage': [
        {'id':'gift-1','benefitType':'FREE_TRIPS','status':'PENDING',
          'remainingTrips':80,'originalTrips':80,'validityDays':30,
          'waitingFor':'TRIP_PACK','effectiveFrom':null,'effectiveUntil':null}
      ]
    }, now: start);
    expect(pending, hasLength(1));
    expect(pending.first.pending, isTrue);
    expect(pending.first.availabilityDescription, contains('agotar'));
    expect(pending.first.remainingTrips, 80);
    expect(pending.first.expiresAt, isNull);
    final active = freeTripBenefitCoverages({
      'benefitCoverage': [
        {'id':'gift-1','benefitType':'FREE_TRIPS','status':'ACTIVE',
          'remainingTrips':79,'originalTrips':80,'validityDays':30,
          'effectiveUntil':end.toIso8601String()}
      ]
    }, now: start);
    expect(active.single.pending, isFalse);
    expect(active.single.remainingTrips, 79);
    expect(active.single.expiresAt, end);
  });

  for (final brightness in [Brightness.light, Brightness.dark]) {
    testWidgets('courtesy heading is readable in $brightness with large text',
        (tester) async {
      await tester.binding.setSurfaceSize(const Size(320, 600));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(MaterialApp(
        theme: ThemeData(brightness: brightness),
        home: const MediaQuery(
          data: MediaQueryData(textScaler: TextScaler.linear(2)),
          child: Scaffold(
            body: Padding(
              padding: EdgeInsets.all(16),
              child: MembershipCourtesyHeading(
                  description: '15 días gratis de membresía'),
            ),
          ),
        ),
      ));
      expect(find.text('Cortesía activa'), findsOneWidget);
      expect(find.text('15 días gratis de membresía'), findsOneWidget);
      expect(find.text('Sin plan activo'), findsNothing);
      expect(tester.takeException(), isNull);
    });
  }
}
