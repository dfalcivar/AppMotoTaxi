import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mototaxi_atacames/main.dart';

void main() {
  testWidgets(
      'acerca de conserva la composición institucional sin controles extra',
      (tester) async {
    tester.view.physicalSize = const Size(320, 568);
    tester.view.devicePixelRatio = 1;
    tester.platformDispatcher.textScaleFactorTestValue = 1.8;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);

    await tester.pumpWidget(const MaterialApp(home: AboutCostaGo()));
    await tester.pump();

    expect(find.text('Movilidad que conecta'), findsOneWidget);
    expect(find.text('Viajes seguros'), findsOneWidget);
    expect(find.text('Conductores verificados'), findsOneWidget);
    expect(find.text('Cerca de ti'), findsOneWidget);
    expect(find.text('Cada viaje nos conecta.'), findsOneWidget);
    expect(find.text('Licencias'), findsNothing);
    expect(find.text('Acerca de'), findsNothing);
    expect(find.byIcon(Icons.arrow_back_rounded), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
