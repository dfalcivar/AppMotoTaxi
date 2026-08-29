import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mototaxi_atacames/fleet.dart';
import 'package:mototaxi_atacames/fleet_report.dart';
import 'package:mototaxi_atacames/mototaxi_icon.dart';

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
  late Uint8List testPhoto;
  setUpAll(() async {
    WidgetController.hitTestWarningShouldBeFatal = true;
    final icons = FontLoader('MaterialIcons')
      ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
    await icons.load();
    // Deliberately synthetic color fixture: never presented as a user's vehicle.
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);
    canvas.drawRect(
        const Rect.fromLTWH(0, 0, 120, 90), Paint()..color = Colors.blue);
    canvas.drawRect(
        const Rect.fromLTWH(60, 0, 60, 90), Paint()..color = Colors.amber);
    final picture = recorder.endRecording();
    final photo = await picture.toImage(120, 90);
    testPhoto = (await photo.toByteData(format: ui.ImageByteFormat.png))!
        .buffer
        .asUint8List();
    photo.dispose();
    picture.dispose();
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
    testWidgets(
        'mototaxi silhouette stays legible at small sizes in ${brightness.name}',
        (tester) async {
      await tester.pumpWidget(RepaintBoundary(
          child: MaterialApp(
              theme: theme(brightness),
              home: Scaffold(
                  body: Center(
                      child: Wrap(
                          spacing: 20,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                    for (final size in [12.0, 16.0, 20.0, 24.0, 48.0, 96.0])
                      Column(mainAxisSize: MainAxisSize.min, children: [
                        MototaxiIcon(
                            size: size,
                            color: theme(brightness).colorScheme.primary),
                        Text('$size px')
                      ])
                  ]))))));
      await tester.pumpAndSettle();
      expect(find.byType(MototaxiIcon), findsNWidgets(6));
      expect(tester.takeException(), isNull);
      await screenshot(tester, 'mototaxi-icon-${brightness.name}');
    });
    testWidgets(
        'real photo takes precedence and changes with photo ID in ${brightness.name}',
        (tester) async {
      final requested = <String>[];
      final gateway = FleetGateway((a, b, c) async => null, (id) async {
        requested.add(id);
        if (id == 'broken') return Uint8List(3);
        return testPhoto;
      });
      Future<void> show(String? id) async {
        await tester.pumpWidget(MaterialApp(
            theme: theme(brightness),
            home: Scaffold(body: FleetPhoto(gateway: gateway, id: id))));
        await tester.pumpAndSettle();
      }

      await show(null);
      expect(find.byType(MototaxiIcon), findsOneWidget);
      await show('real-photo');
      expect(find.byType(Image), findsOneWidget);
      expect(find.byType(MototaxiIcon), findsNothing);
      await show('replacement-photo');
      expect(requested, ['real-photo', 'replacement-photo']);
      await show('broken');
      expect(find.byType(MototaxiIcon), findsOneWidget);
      expect(tester.takeException(), isNull);
      await show(null);
      expect(find.byType(MototaxiIcon), findsOneWidget);
    });
    for (final largeText in [false, true]) {
      testWidgets(
          'unit confirmation and pause outcomes in ${brightness.name}, large=$largeText',
          (tester) async {
        tester.view.physicalSize =
            largeText ? const Size(320, 480) : const Size(390, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final gateway = FleetGateway(
            (a, b, c) async =>
                throw StateError('Visual dialog must not mutate the API'),
            (_) async => testPhoto);
        final vehicle = {
          ...vehicles.first,
          'identifier': 'MT-2',
          'photoId': 'real-photo',
          'unitNumber': '023'
        };
        bool? confirmed;
        String? outcome;
        await tester.pumpWidget(RepaintBoundary(
            child: MaterialApp(
                debugShowCheckedModeBanner: false,
                theme: theme(brightness),
                builder: (c, child) => MediaQuery(
                    data: MediaQuery.of(c).copyWith(
                        textScaler: TextScaler.linear(largeText ? 1.8 : 1)),
                    child: child!),
                home: Builder(
                    builder: (c) => Scaffold(
                            body: Column(children: [
                          TextButton(
                              onPressed: () async {
                                confirmed = await fleetConfirm(c,
                                    title: 'Hoy conducirás MT-2',
                                    text:
                                        'Confirma que esta es la mototaxi que conducirás.',
                                    action: 'Usar mototaxi',
                                    gateway: gateway,
                                    vehicle: vehicle);
                              },
                              child: const Text('Confirmar unidad')),
                          TextButton(
                              onPressed: () async {
                                outcome = await fleetPauseDialog(c,
                                    gateway: gateway, vehicle: vehicle);
                              },
                              child: const Text('Pausar unidad')),
                        ]))))));
        await tester.tap(find.text('Confirmar unidad'));
        await tester.pumpAndSettle();
        expect(find.byType(Image), findsOneWidget);
        expect(find.text('Azul · Unidad 023'), findsOneWidget);
        expect(tester.takeException(), isNull);
        if (!largeText) {
          await screenshot(tester, 'confirm-unit-${brightness.name}');
        }
        await tester.ensureVisible(find.text('Volver'));
        await tester.tap(find.text('Volver'));
        await tester.pumpAndSettle();
        expect(confirmed, false);
        await tester.tap(find.text('Confirmar unidad'));
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text('Usar mototaxi'));
        await tester.tap(find.text('Usar mototaxi'));
        await tester.pumpAndSettle();
        expect(confirmed, true);
        for (final action in ['Volver', 'Pausar', 'Finalizar jornada']) {
          await tester.tap(find.text('Pausar unidad'));
          await tester.pumpAndSettle();
          expect(find.byType(Image), findsOneWidget);
          expect(find.text('Activa'), findsOneWidget);
          expect(tester.takeException(), isNull);
          if (!largeText && action == 'Volver') {
            await screenshot(tester, 'pause-unit-${brightness.name}');
          }
          await tester.ensureVisible(find.text(action));
          await tester.tap(find.text(action));
          await tester.pumpAndSettle();
          expect(
              outcome,
              action == 'Volver'
                  ? null
                  : action == 'Pausar'
                      ? 'PAUSE'
                      : 'FINISH');
        }
      });
    }
    testWidgets('profile keeps capabilities independent in ${brightness.name}',
        (tester) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      for (final driver in [false, true]) {
        for (final owner in [false, true]) {
          final gateway = FleetGateway((method, path, body) async {
            expect(method, 'GET');
            expect(path, contains('managed=true'));
            return {
              'items': owner
                  ? [
                      {...vehicles.first, 'totalCount': '42'}
                    ]
                  : []
            };
          }, (_) async => Uint8List(0));
          await tester.pumpWidget(MaterialApp(
              theme: theme(brightness),
              home: Scaffold(
                  body: FleetProfileEntries(
                      key: ValueKey('$driver/$owner'),
                      gateway: gateway,
                      hasDriverCapability: driver))));
          await tester.pumpAndSettle();
          expect(find.text('Mis mototaxis'),
              driver ? findsOneWidget : findsNothing);
          expect(find.text('Mi flota'), owner ? findsOneWidget : findsNothing);
          expect(
              find.text('42 mototaxis'), owner ? findsOneWidget : findsNothing);
          expect(find.text('Registrar o reclamar una mototaxi'),
              owner ? findsNothing : findsOneWidget);
          expect(tester.takeException(), isNull);
          if (driver && owner) {
            await screenshot(tester, 'profile-capabilities-${brightness.name}');
          }
        }
      }
    });
    testWidgets(
        'passenger requests ownership without driver enrollment in ${brightness.name}',
        (tester) async {
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      var writes = 0;
      final pending = Completer<dynamic>();
      final gateway = FleetGateway((method, path, body) async {
        if (method == 'GET') {
          return {
            'items': writes == 0
                ? []
                : [
                    {
                      ...vehicles.first,
                      'totalCount': 1,
                      'relations': [
                        {'type': 'OWNER_MANAGER', 'status': 'PENDING'}
                      ]
                    }
                  ]
          };
        }
        expect(method, 'POST');
        expect(path, '/v1/fleet/vehicles/link');
        expect(body, {'identifier': 'MT-2', 'relationType': 'OWNER_MANAGER'});
        writes++;
        return pending.future;
      }, (_) async => Uint8List(0));
      await tester.pumpWidget(RepaintBoundary(
          child: MaterialApp(
              theme: theme(brightness),
              home: Scaffold(
                  body: FleetProfileEntries(
                      gateway: gateway, hasDriverCapability: false)))));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Registrar o reclamar una mototaxi'));
      await tester.pumpAndSettle();
      expect(find.text('Mi relación con la unidad'), findsNothing);
      expect(find.textContaining('No habilita la conducción'), findsOneWidget);
      await tester.tap(find.text('Vincular existente'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextFormField).first, 'MT-2');
      await tester.pumpAndSettle();
      await screenshot(tester, 'owner-request-${brightness.name}');
      await tester.tap(find.text('Guardar'));
      await tester.pump();
      await tester.tap(find.text('Guardando…'));
      await tester.pump();
      expect(writes, 1);
      pending.complete({'id': 'unit-0'});
      await tester.pumpAndSettle();
      expect(find.text('Mi flota'), findsOneWidget);
      expect(find.text('1 mototaxi'), findsOneWidget);
      expect(find.text('Mis mototaxis'), findsNothing);
      expect(tester.takeException(), isNull);
    });
    testWidgets(
        'old API mixed list is separated by relationship in ${brightness.name}',
        (tester) async {
      final requests = <String>[];
      final mixed = [
        {
          ...vehicles[0],
          'relations': [
            {'type': 'OWNER_MANAGER', 'status': 'APPROVED'}
          ]
        },
        vehicles[1],
        {
          ...vehicles[2],
          'relations': [
            {'type': 'AUTHORIZED_DRIVER', 'status': 'PENDING'}
          ]
        },
      ];
      final gateway = FleetGateway((method, path, body) async {
        requests.add(path);
        return {'items': mixed};
      }, (_) async => Uint8List(0));
      for (final mode in ['driver', 'owner', 'select']) {
        await tester.pumpWidget(MaterialApp(
            theme: theme(brightness),
            home: FleetScreen(
                key: ValueKey(mode),
                gateway: gateway,
                ownerOnly: mode == 'owner',
                select: mode == 'select')));
        await tester.pumpAndSettle();
        expect(
            find.text('MT-1'), mode == 'owner' ? findsOneWidget : findsNothing);
        expect(
            find.text('MT-2'), mode == 'owner' ? findsNothing : findsOneWidget);
        expect(find.text('MT-3'),
            mode == 'driver' ? findsOneWidget : findsNothing);
        expect(
            requests.last,
            contains(
                'relationType=${mode == 'owner' ? 'OWNER_MANAGER' : 'AUTHORIZED_DRIVER'}'));
        if (mode == 'select') {
          expect(requests.last, contains('authorizedOnly=true'));
        }
        expect(tester.takeException(), isNull);
      }
    });
    testWidgets(
        'fleet count can retry after an API error in ${brightness.name}',
        (tester) async {
      var fail = true;
      final gateway = FleetGateway((method, path, body) async {
        if (fail) throw Exception('offline');
        return {
          'items': [
            {...vehicles.first, 'totalCount': 3}
          ]
        };
      }, (_) async => Uint8List(0));
      await tester.pumpWidget(MaterialApp(
          theme: theme(brightness),
          home: Scaffold(
              body: FleetProfileEntries(
                  gateway: gateway, hasDriverCapability: false))));
      await tester.pumpAndSettle();
      expect(find.text('Registrar o reclamar una mototaxi'), findsNothing);
      fail = false;
      await tester.tap(find.text('Reintentar consulta de flota'));
      await tester.pumpAndSettle();
      expect(find.text('3 mototaxis'), findsOneWidget);
      expect(find.text('Reintentar consulta de flota'), findsNothing);
      expect(tester.takeException(), isNull);
    });
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
        'empty selection offers registration and authorization in ${brightness.name}',
        (tester) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final gateway = FleetGateway(
          (method, path, body) async => {'items': <dynamic>[]},
          (_) async => Uint8List(0));
      await tester.pumpWidget(MaterialApp(
          theme: theme(brightness),
          home: FleetScreen(gateway: gateway, select: true)));
      await tester.pumpAndSettle();
      expect(find.text('Aún no tienes mototaxis disponibles'), findsOneWidget);
      expect(find.text('Agregar mototaxi'), findsOneWidget);
      expect(find.text('Solicitar autorización'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await screenshot(tester, 'empty-selection-${brightness.name}');
    });
    testWidgets(
        'trip mototaxi opens a responsive identity preview in ${brightness.name}',
        (tester) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final gateway = FleetGateway(
          (method, path, body) async => null, (_) async => testPhoto);
      await tester.pumpWidget(MaterialApp(
          theme: theme(brightness),
          home: Scaffold(
              body: SafeArea(
                  child: TripVehicleBadge(
                      gateway: gateway,
                      vehicle: {...vehicles.first, 'photoId': 'photo'})))));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Mototaxi MT-1'));
      await tester.pumpAndSettle();
      expect(find.text('Bajaj RE Compact'), findsOneWidget);
      expect(find.text('Azul · Unidad 101'), findsNWidgets(2));
      expect(find.text('Verificada'), findsOneWidget);
      expect(find.text('Entendido'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await screenshot(tester, 'trip-vehicle-preview-${brightness.name}');
      await tester.tap(find.text('Entendido'));
      await tester.pumpAndSettle();
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
