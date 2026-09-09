import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mototaxi_atacames/driver_wallet_sheet.dart';

void main() {
  testWidgets('wallet remains usable on small screens with enlarged text',
      (tester) async {
    tester.view.physicalSize = const Size(320, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(MaterialApp(
        home: MediaQuery(
            data: const MediaQueryData(textScaler: TextScaler.linear(1.4)),
            child: Scaffold(
                body: DriverWalletSheet(
              load: () async => {
                'wallet': {
                  'total': '5.00',
                  'reserved': '0.10',
                  'available': '4.90',
                  'enabled': false
                },
                'configuration': {
                  'minimumTopUp': '1.00',
                  'maximumTopUp': '100.00',
                  'lowBalanceThreshold': '1.00'
                },
                'movements': []
              },
              createOrder: (_, __) async => {},
              setEnabled: (_) async {},
            )))));
    await tester.pumpAndSettle();
    expect(find.text(r'$4.90 disponibles'), findsOneWidget);
    expect(find.text('Valor de recarga'), findsOneWidget);
    expect(find.text(r'Puedes recargar desde $1.00 hasta $100.00'),
        findsOneWidget);
    expect(find.text('Recarga sin IVA'), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.scrollUntilVisible(find.text('Recargar saldo'), 150,
        scrollable: find.byType(Scrollable).first);
    expect(tester.takeException(), isNull);
  });

  testWidgets('wallet applies the configured minimum before creating an order',
      (tester) async {
    var ordersCreated = 0;
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: DriverWalletSheet(
      load: () async => {
        'wallet': {
          'total': '0.00',
          'reserved': '0.00',
          'available': '0.00',
          'enabled': false
        },
        'configuration': {
          'minimumTopUp': '5.00',
          'maximumTopUp': '100.00',
          'lowBalanceThreshold': '1.00'
        },
        'movements': []
      },
      createOrder: (_, __) async {
        ordersCreated++;
        return {};
      },
      setEnabled: (_) async {},
    ))));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), '1');
    await tester.ensureVisible(find.text('Recargar saldo'));
    await tester.tap(find.text('Recargar saldo'));
    await tester.pump();
    expect(find.text(r'El valor mínimo de recarga es $5.00.'), findsOneWidget);
    expect(ordersCreated, 0);
  });
}
