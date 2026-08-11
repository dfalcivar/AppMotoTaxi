import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mototaxi_atacames/driver_navigation.dart';

Widget testApp({
  required Size size,
  required TextScaler textScaler,
  required String duration,
  required String distance,
  required String destination,
}) {
  return MaterialApp(
    theme: ThemeData(
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(54),
        ),
      ),
    ),
    home: MediaQuery(
      data: MediaQueryData(size: size, textScaler: textScaler),
      child: Scaffold(
        body: Align(
          alignment: Alignment.bottomCenter,
          child: NavigationTripFooter(
            duration: duration,
            distance: distance,
            destination: destination,
            onExit: () {},
          ),
        ),
      ),
    ),
  );
}

void main() {
  testWidgets('mantiene tiempo y distancia en una línea en teléfono pequeño',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(320, 640));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(testApp(
      size: const Size(320, 640),
      textScaler: TextScaler.noScaling,
      duration: '5 min',
      distance: '434 m',
      destination: 'Padre Pedro Touloup',
    ));

    expect(find.text('5 min · 434 m'), findsOneWidget);
    expect(find.text('Destino: Padre Pedro Touloup'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('no desborda con texto grande y una calle larga', (tester) async {
    await tester.binding.setSurfaceSize(const Size(360, 720));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(testApp(
      size: const Size(360, 720),
      textScaler: const TextScaler.linear(1.6),
      duration: '12 min',
      distance: '4,8 km',
      destination:
          'Avenida de las Américas y Padre Pedro Touloup, sector norte',
    ));

    expect(find.text('12 min · 4,8 km'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('conserva una barra compacta en teléfono grande', (tester) async {
    await tester.binding.setSurfaceSize(const Size(430, 932));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(testApp(
      size: const Size(430, 932),
      textScaler: TextScaler.noScaling,
      duration: '28 min',
      distance: '18,4 km',
      destination: 'Malecón de Atacames',
    ));

    expect(find.text('28 min · 18,4 km'), findsOneWidget);
    expect(find.text('Destino: Malecón de Atacames'), findsOneWidget);
    expect(tester.getSize(find.byType(NavigationTripFooter)).height,
        lessThan(100));
    expect(tester.takeException(), isNull);
  });
}
