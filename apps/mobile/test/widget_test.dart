import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mototaxi_atacames/main.dart';

void main() {
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
}
