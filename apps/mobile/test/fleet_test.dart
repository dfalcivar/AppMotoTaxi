import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mototaxi_atacames/fleet.dart';
import 'package:mototaxi_atacames/fleet_report.dart';

final vehicles = List.generate(
    3,
    (i) => {
          'id': 'unit-$i',
          'identifier': 'MT-${i + 1}',
          'brand': 'Bajaj',
          'model': 'RE Compact',
          'color': ['Azul', 'Rojo', 'Blanco'][i],
          'unitNumber': '10${i + 1}',
          'status': 'VERIFIED',
          'photoId': null,
          'relations': [
            {'type': 'AUTHORIZED_DRIVER', 'status': 'APPROVED'}
          ]
        });
ThemeData theme(Brightness brightness) {
  final colors = ColorScheme.fromSeed(
      seedColor: const Color(0xff087ccb), brightness: brightness);
  return ThemeData(
      useMaterial3: true,
      colorScheme: colors,
      brightness: brightness,
      cardTheme: CardThemeData(
          elevation: 0,
          color: colors.surface,
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(20),
              side: BorderSide(color: colors.outlineVariant))),
      inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: colors.surfaceContainerHighest,
          border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(16),
              borderSide: BorderSide.none)));
}

Future<void> screenshot(WidgetTester tester, String name) async {
  if (Platform.environment['FLEET_SCREENSHOTS'] != 'true') return;
  await tester.runAsync(() async {
    final boundary = tester.firstRenderObject<RenderRepaintBoundary>(
        find.byType(RepaintBoundary).first);
    final image = await boundary.toImage(pixelRatio: 2);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    final file = File('build/fleet-qa/$name.png');
    await file.parent.create(recursive: true);
    await file.writeAsBytes(bytes!.buffer.asUint8List());
    image.dispose();
  });
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    WidgetController.hitTestWarningShouldBeFatal = true;
    final icons = FontLoader('MaterialIcons')
      ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
    await icons.load();
    final path = Platform.environment['FLEET_QA_FONT'];
    if (path != null) {
      final loader = FontLoader('Roboto')
        ..addFont(
            File(path).readAsBytes().then((b) => ByteData.sublistView(b)));
      await loader.load();
    }
  });
  test('QR accepts only official host / scheme and an opaque token', () {
    final token = 'a' * 43;
    expect(fleetToken(Uri.parse('costa-go://vehicle/$token')), token);
    expect(
        fleetToken(Uri.parse('https://costa-go.com/vehicle.html?token=$token')),
        token);
    for (final bad in [
      'https://evil.example/vehicle.html?token=$token',
      'costa-go://vehicle/MT-2',
      'http://costa-go.com/vehicle.html?token=$token'
    ]) {
      expect(fleetToken(Uri.parse(bad)), '');
    }
  });
  for (final brightness in Brightness.values) {
    testWidgets('owner report filters real driver IDs in ${brightness.name}',
        (tester) async {
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final requests = <String>[];
      final gateway = FleetGateway((method, path, body) async {
        requests.add(path);
        if (path.startsWith('/v1/fleet/report/options')) {
          return {
            'vehicles': vehicles,
            'drivers': [
              {'id': 'driver-1', 'name': 'Carlos Ruiz'}
            ]
          };
        }
        return {
          'summary': {
            'activeUnits': 0,
            'activeDrivers': 0,
            'completed': 0,
            'cancelled': 0,
            'inactiveUnits': 3,
            'incidents': 0,
            'operationSeconds': 0
          },
          'items': []
        };
      }, (_) async => Uint8List(0));
      await tester.pumpWidget(MaterialApp(
          theme: theme(brightness), home: FleetReportScreen(gateway: gateway)));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.ensureVisible(find.text('Todos mis conductores'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Todos mis conductores'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Carlos Ruiz').last);
      await tester.pumpAndSettle();
      expect(requests.any((p) => p.contains('driverId=driver-1')), isTrue);
      expect(tester.takeException(), isNull);
    });
    testWidgets(
        'fleet list and add modal fit small screens in ${brightness.name}',
        (tester) async {
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      var writes = 0;
      final gateway = FleetGateway((method, path, body) async {
        if (method != 'GET') writes++;
        return {'items': vehicles};
      }, (_) async => Uint8List(0));
      await tester.pumpWidget(RepaintBoundary(
          child: MaterialApp(
              theme: theme(brightness), home: FleetScreen(gateway: gateway))));
      await tester.pumpAndSettle();
      expect(find.text('MT-1'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await screenshot(tester, 'list-${brightness.name}');
      await tester.tap(find.text('Agregar mototaxi'));
      await tester.pumpAndSettle();
      expect(find.text('Mi relación con la unidad'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await screenshot(tester, 'add-${brightness.name}');
      tester.view.viewInsets = const FakeViewPadding(bottom: 290);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      tester.view.resetViewInsets();
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Cancelar'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancelar'));
      await tester.pumpAndSettle();
      expect(find.text('Mi relación con la unidad'), findsNothing);
      expect(writes, 0);
    });
    testWidgets(
        'selection confirms before creating session in ${brightness.name}',
        (tester) async {
      var writes = 0;
      final pending = Completer<dynamic>();
      final gateway = FleetGateway((method, path, body) async {
        if (method == 'GET') return {'items': vehicles};
        writes++;
        return pending.future;
      }, (_) async => Uint8List(0));
      await tester.pumpWidget(MaterialApp(
          theme: theme(brightness),
          home: Builder(
              builder: (c) => Scaffold(
                  body: TextButton(
                      onPressed: () => Navigator.push(
                          c,
                          MaterialPageRoute(
                              builder: (_) =>
                                  FleetScreen(gateway: gateway, select: true))),
                      child: const Text('Abrir'))))));
      await tester.tap(find.text('Abrir'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('MT-1'));
      await tester.pumpAndSettle();
      expect(writes, 0);
      await tester.tap(find.text('Volver'));
      await tester.pumpAndSettle();
      expect(writes, 0);
      await tester.tap(find.text('MT-1'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Usar mototaxi'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(writes, 1);
      await tester.tap(find.text('MT-1'));
      await tester.pump();
      expect(writes, 1);
      pending.complete({'sessionId': 's1'});
      await tester.pumpAndSettle();
      expect(find.text('Abrir'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
    testWidgets(
        'historical identity card fits long labels in ${brightness.name}',
        (tester) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final gateway =
          FleetGateway((a, b, c) async => null, (_) async => Uint8List(0));
      await tester.pumpWidget(MaterialApp(
          theme: theme(brightness),
          home: Scaffold(
              body: SafeArea(
                  child: RepaintBoundary(
                      child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: TripVehicleBadge(gateway: gateway, vehicle: {
                            ...vehicles.first,
                            'identifier': 'MT-REGISTRO-1234567890',
                            'unitNumber': '1234567'
                          })))))));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await screenshot(tester, 'trip-${brightness.name}');
    });
  }
}
