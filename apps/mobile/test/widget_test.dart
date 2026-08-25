import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mototaxi_atacames/live_map.dart';
import 'package:mototaxi_atacames/main.dart';

void main() {
  test('Google Maps es el proveedor predeterminado de compilación', () {
    expect(configuredMapProvider, 'google');
  });
  test('restaura la pantalla correcta para una sesión persistente', () {
    expect(homeForSession(const Session('t', 'PASSENGER', 'Ana', '1')),
        isA<Passenger>());
    expect(homeForSession(const Session('t', 'DRIVER', 'Luis', '2')),
        isA<Driver>());
    expect(
        homeForSession(const Session('t', 'PASSENGER', 'Ana', '1',
            mustChangePassword: true)),
        isA<ChangeTemporaryPassword>());
  });

  testWidgets('muestra las dos entradas principales', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Welcome()));

    expect(find.text('Ingresar como pasajero'), findsOneWidget);
    expect(find.text('Ingresar como conductor'), findsOneWidget);
    expect(find.text('Powered by'), findsOneWidget);
    expect(find.text('DFAR SYSTEM'), findsOneWidget);
    expect(find.text('Crear una cuenta'), findsOneWidget);
  });

  testWidgets('registro de pasajero oculta los campos exclusivos del conductor',
      (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(const MaterialApp(
      home: Register(loadCooperativesOnStart: false),
    ));

    expect(find.text('Nombre completo *'), findsOneWidget);
    expect(find.text('Pasajero'), findsOneWidget);
    expect(find.text('Fotografía frontal *'), findsNothing);
    expect(find.text('Placa o identificador de mototaxi *'), findsNothing);
  });

  testWidgets('registro de conductor muestra foto, cooperativa y placa',
      (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(const MaterialApp(
      home: Register(loadCooperativesOnStart: false),
    ));
    await tester.tap(find.text('Pasajero'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Conductor').last);
    await tester.pumpAndSettle();

    expect(find.text('Conductor independiente'), findsOneWidget);
    expect(find.text('Fotografía frontal *'), findsOneWidget);
    expect(find.text('Seleccionar fotografía'), findsOneWidget);
    expect(find.text('Placa o identificador de mototaxi *'), findsOneWidget);
  });

  testWidgets('recuperación presenta validación inline en modo oscuro',
      (tester) async {
    tester.view.physicalSize = const Size(360, 720);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(MaterialApp(
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xff087ccb),
          brightness: Brightness.dark,
        ),
      ),
      home: const Recovery(),
    ));
    await tester.tap(find.text('Enviar código'));
    await tester.pump();

    expect(find.text('Ingresa un correo electrónico válido.'), findsOneWidget);
    expect(find.text('Recupera tu cuenta'), findsOneWidget);
  });
}
