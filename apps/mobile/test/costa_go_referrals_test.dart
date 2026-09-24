import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:mototaxi_atacames/costa_go_referrals.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    ReferralLinks.code.value = '';
    ReferralLinks.program = '';
  });
  const code = 'CG-0123456789ABCDEF';
  final program = <String, dynamic>{
    'id': 'program',
    'programCode': 'INVITE',
    'name': 'Invita conductores',
    'description': 'Comparte Costa-Go',
    'condition': 'complete su primer viaje',
    'canInvite': true,
    'code': code,
    'url': 'https://costa-go.com/r/$code?p=INVITE',
    'message': 'Invitación https://costa-go.com/r/$code?p=INVITE',
    'benefits': [],
    'metrics': {'registered': 2, 'pending': 1, 'qualified': 1, 'rewarded': 1}
  };
  ReferralGateway gateway(Map<String, dynamic> data,
          {Future<void> Function(BuildContext, String)? share,
          Future<Map<String, dynamic>> Function(String, String, String)?
              attribute}) =>
      ReferralGateway(
          sessionKey: 'user',
          load: () async => data,
          attribute: attribute ?? (c, p, s) async => {},
          share: share ?? (c, t) async {});
  test('captures a valid link through login and rejects foreign links',
      () async {
    expect(
        await ReferralLinks.receive(
            Uri.parse('https://evil.test/r/$code?p=INVITE')),
        false);
    expect(
        await ReferralLinks.receive(
            Uri.parse('costa-go://referral/$code?p=INVITE')),
        true);
    ReferralLinks.code.value = '';
    await ReferralLinks.initialize();
    expect(ReferralLinks.code.value, code);
    expect(ReferralLinks.program, 'INVITE');
    expect(
        await ReferralLinks.receive(Uri.parse('costa-go://referral/invalid')),
        false);
    await ReferralLinks.clear();
    await ReferralLinks.initialize();
    expect(ReferralLinks.code.value, '');
  });
  testWidgets('no applicable programme leaves no contextual card',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: CostaGoReferralCard(gateway: gateway({'programs': []})))));
    await tester.pumpAndSettle();
    expect(find.byType(Card), findsNothing);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets('shares exact backend message and shows actual progress',
      (tester) async {
    String? shared;
    await tester.pumpWidget(MaterialApp(
        home: CostaGoReferralsScreen(
            gateway: gateway({
      'programs': [program]
    }, share: (context, text) async {
      shared = text;
    }))));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Compartir invitación'));
    await tester.tap(find.text('Compartir invitación'));
    expect(shared, program['message']);
    expect(find.textContaining('Invitados registrados: 2'), findsOneWidget);
  });
  testWidgets(
      'attributes captured code to matching programme without reward amounts',
      (tester) async {
    await ReferralLinks.receive(
        Uri.parse('costa-go://referral/$code?p=INVITE'));
    final calls = <List<String>>[];
    final data = <String, dynamic>{
      'programs': [
        {...program, 'canInvite': false}
      ],
      'canAttribute': true
    };
    await tester.pumpWidget(MaterialApp(
        home: CostaGoReferralsScreen(
            gateway: gateway(data, attribute: (c, p, s) async {
      calls.add([c, p, s]);
      data['canAttribute'] = false;
      return {};
    }))));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Registrar invitación'));
    await tester.tap(find.text('Registrar invitación'));
    await tester.pumpAndSettle();
    expect(calls, [
      [code, 'program', 'LINK']
    ]);
    expect(ReferralLinks.code.value, '');
    expect(find.text('Registrar invitación'), findsNothing);
  });
  testWidgets(
      'renders the saved server progress even without a current active programme',
      (tester) async {
    final data = <String, dynamic>{
      'programs': [],
      'attribution': {
        'name': 'Programa original',
        'status': 'PENDING',
        'progress': {
          'condition': 'complete 5 viajes válidos',
          'requiredTrips': 5,
          'completedTrips': 3,
          'remainingTrips': 2,
          'mustBeApproved': true,
          'isApproved': false,
          'mustBeActive': true,
          'isActive': true
        }
      }
    };
    await tester.pumpWidget(
        MaterialApp(home: CostaGoReferralsScreen(gateway: gateway(data))));
    await tester.pumpAndSettle();
    expect(find.textContaining('Viajes requeridos: 5'), findsOneWidget);
    expect(find.textContaining('Completados válidos: 3'), findsOneWidget);
    expect(find.textContaining('Pendientes: 2'), findsOneWidget);
    expect(find.text('Aprobación pendiente'), findsOneWidget);
  });
}
