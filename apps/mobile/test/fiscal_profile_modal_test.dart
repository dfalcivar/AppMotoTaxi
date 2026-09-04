import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mototaxi_atacames/fiscal_profile_modal.dart';

final profile = <String, dynamic>{
  'identificationType': 'CEDULA',
  'identification': '0912345678',
  'legalName': 'Cliente de prueba',
  'address': 'Dirección de prueba 123',
  'billingEmail': 'fiscal@example.test',
  'revision': 1,
};

void main() {
  for (final brightness in Brightness.values) {
    for (final keyboard in [false, true]) {
      testWidgets('formulario fiscal ${brightness.name}, teclado $keyboard',
          (tester) async {
        tester.view.physicalSize = const Size(320, 600);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        if (keyboard) {
          tester.view.viewInsets = const FakeViewPadding(bottom: 220);
          addTearDown(tester.view.resetViewInsets);
        }
        var saves = 0;
        final pending = Completer<dynamic>();
        await tester.pumpWidget(MaterialApp(
          theme: ThemeData(
              colorScheme: ColorScheme.fromSeed(
                  seedColor: const Color(0xff087ccb), brightness: brightness)),
          home: Scaffold(
              body: FiscalProfileModal(
            load: () async => {
              'profile': null,
              'prefill': {
                'legalName': 'Cliente de prueba',
                'billingEmail': 'fiscal@example.test'
              }
            },
            save: (data) {
              saves++;
              expect(data['expectedRevision'], 0);
              return pending.future;
            },
          )),
        ));
        await tester.pumpAndSettle();
        expect(find.text('Datos de facturación'), findsOneWidget);
        await tester.ensureVisible(find.text('Guardar y continuar'));
        await tester.tap(find.text('Guardar y continuar'));
        await tester.pump();
        expect(saves, 0);
        final inputs = find.byType(TextFormField);
        await tester.enterText(inputs.at(0), '0912345678');
        await tester.enterText(inputs.at(2), 'Dirección de prueba 123');
        await tester.ensureVisible(find.text('Guardar y continuar'));
        await tester.tap(find.text('Guardar y continuar'));
        await tester.pump();
        expect(saves, 1);
        expect(find.text('Guardando…'), findsOneWidget);
        expect(
            tester
                .widget<FilledButton>(find.byType(FilledButton).first)
                .onPressed,
            isNull);
        pending.complete({'profile': profile});
        await tester.pumpAndSettle();
        expect(find.textContaining('Datos guardados correctamente.'),
            findsOneWidget);
        expect(find.text('Cliente de prueba'), findsOneWidget);
        expect(tester.takeException(), isNull);
      });
    }
  }
  testWidgets('perfil existente se reutiliza sin guardar y permite modificar',
      (tester) async {
    var saves = 0;
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: FiscalProfileModal(
      load: () async => {'profile': profile},
      save: (data) async {
        saves++;
        return {
          'profile': {...profile, ...data}
        };
      },
    ))));
    await tester.pumpAndSettle();
    expect(find.byType(TextFormField), findsNothing);
    expect(saves, 0);
    await tester.tap(find.text('Editar datos'));
    await tester.pumpAndSettle();
    expect(find.byType(TextFormField), findsNWidgets(4));
    await tester.enterText(
        find.byType(TextFormField).at(2), 'Nueva dirección de prueba');
    await tester.ensureVisible(find.text('Guardar y continuar'));
    await tester.tap(find.text('Guardar y continuar'));
    await tester.pumpAndSettle();
    expect(saves, 1);
    expect(tester.takeException(), isNull);
  });
  testWidgets('fallo de guardado conserva los datos y permite reintentar',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: FiscalProfileModal(
      load: () async => {'profile': profile},
      save: (data) async => throw Exception('offline'),
    ))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Editar datos'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Guardar y continuar'));
    await tester.tap(find.text('Guardar y continuar'));
    await tester.pumpAndSettle();
    expect(find.textContaining('No se guardaron'), findsOneWidget);
    expect(find.text('Cliente de prueba'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
