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
    final walletScroll = find
        .descendant(
            of: find.byType(ListView).first, matching: find.byType(Scrollable))
        .first;
    await tester.scrollUntilVisible(find.byType(TextField), 150,
        scrollable: walletScroll);
    expect(find.text('Valor de recarga'), findsOneWidget);
    expect(find.text(r'Puedes recargar desde $1.00 hasta $100.00.'),
        findsOneWidget);
    expect(find.text('Recarga sin IVA'), findsNothing);
    expect(tester.takeException(), isNull);
    final rechargeButton = find.widgetWithText(FilledButton, 'Recargar saldo');
    await tester.scrollUntilVisible(rechargeButton, 150,
        scrollable: walletScroll);
    expect(rechargeButton, findsOneWidget);
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
    final rechargeButton = find.widgetWithText(FilledButton, 'Recargar saldo');
    final walletScroll = find
        .descendant(
            of: find.byType(ListView).first, matching: find.byType(Scrollable))
        .first;
    await tester.scrollUntilVisible(rechargeButton, 180,
        scrollable: walletScroll);
    tester.widget<FilledButton>(rechargeButton).onPressed!();
    await tester.pump();
    expect(find.text(r'El valor mínimo de recarga es $5.00.'), findsOneWidget);
    expect(ordersCreated, 0);
  });

  testWidgets('wallet marks a balance below the trip minimum as insufficient',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: DriverWalletSheet(
      load: () async => {
        'wallet': {
          'total': '0.10',
          'reserved': '0.00',
          'available': '0.10',
          'enabled': true
        },
        'configuration': {
          'minimumTopUp': '3.00',
          'maximumTopUp': '100.00',
          'lowBalanceThreshold': '1.00',
          'minimumRequiredBalance': '0.16'
        },
        'movements': []
      },
      createOrder: (_, __) async => {},
      setEnabled: (_) async {},
    ))));
    await tester.pumpAndSettle();
    expect(find.textContaining('Saldo insuficiente para aceptar viajes.'),
        findsOneWidget);
    expect(find.textContaining(r'Necesitas al menos $0.16.'), findsOneWidget);
    expect(find.byIcon(Icons.money_off_csred_rounded), findsWidgets);
  });

  testWidgets('wallet previews three movements and opens the filtered history',
      (tester) async {
    final now = DateTime.now().toUtc().toIso8601String();
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: DriverWalletSheet(
      load: () async => {
        'wallet': {
          'total': '8.70',
          'reserved': '0.00',
          'available': '8.70',
          'enabled': true
        },
        'configuration': {
          'minimumTopUp': '3.00',
          'maximumTopUp': '100.00',
          'lowBalanceThreshold': '1.00'
        },
        'movements': [
          {
            'kind': 'TRIP_COMMISSION',
            'amount': '0.60',
            'reason': 'Comisión al completar viaje',
            'createdAt': now
          },
          {
            'kind': 'TOPUP',
            'amount': '5.00',
            'reason': 'Transferencia aprobada',
            'createdAt': now
          },
          {
            'kind': 'ADMIN_ADJUSTMENT',
            'amount': '1.00',
            'reason': 'Corrección de saldo',
            'createdAt': now
          },
          {
            'kind': 'TRIP_COMMISSION',
            'amount': '0.30',
            'reason': 'Comisión al completar viaje',
            'createdAt': now
          }
        ]
      },
      createOrder: (_, __) async => {},
      setEnabled: (_) async {},
    ))));
    await tester.pumpAndSettle();
    final walletScroll = find
        .descendant(
            of: find.byType(ListView).first, matching: find.byType(Scrollable))
        .first;
    await tester.scrollUntilVisible(find.text('Ver todos'), 200,
        scrollable: walletScroll);
    await tester.scrollUntilVisible(find.text('Comisión de viaje'), 100,
        scrollable: walletScroll);
    expect(find.text('Comisión de viaje'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Ver todos'), -100,
        scrollable: walletScroll);
    await tester.tap(find.text('Ver todos'));
    await tester.pumpAndSettle();
    expect(find.text('Todos'), findsOneWidget);
    expect(find.text('Comisiones'), findsOneWidget);
    expect(find.text('Recargas'), findsOneWidget);
    expect(find.text('Ajustes'), findsOneWidget);
    expect(find.text('Comisión de viaje'), findsNWidgets(2));
  });
}
