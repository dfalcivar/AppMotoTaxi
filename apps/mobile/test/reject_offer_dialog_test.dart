import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mototaxi_atacames/reject_offer_dialog.dart';

void main() {
  for (final brightness in Brightness.values) {
    for (final size in [const Size(390, 844), const Size(320, 480)]) {
      for (final scale in [1.0, 1.8]) {
        testWidgets('rechazo ${brightness.name}, $size, texto $scale',
            (tester) async {
          tester.view.physicalSize = size;
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          final colors = ColorScheme.fromSeed(
              seedColor: const Color(0xff087ccb), brightness: brightness);
          await tester.pumpWidget(MaterialApp(
            theme: ThemeData(colorScheme: colors, useMaterial3: true),
            builder: (context, child) => MediaQuery(
                data: MediaQuery.of(context)
                    .copyWith(textScaler: TextScaler.linear(scale)),
                child: child!),
            home: const Scaffold(body: RejectOfferDialog()),
          ));
          expect(tester.takeException(), isNull);
          expect(find.text('Rechazar solicitud'), findsOneWidget);
          final title = tester.widget<Text>(find.text('Rechazar solicitud'));
          expect(title.textAlign, TextAlign.center);
          expect(title.style?.color, colors.onSurface);
          expect(tester.widget<Dialog>(find.byType(Dialog)).backgroundColor,
              colors.surface);
          expect(tester.widget<Icon>(find.byIcon(Icons.close_rounded)).color,
              colors.error);
          await tester.ensureVisible(find.text('Rechazar'));
          await tester.pumpAndSettle();
          final back = tester.getRect(find.byType(OutlinedButton));
          final reject = tester.getRect(find.byType(FilledButton));
          expect(back.width, closeTo(reject.width, .01));
          expect(back.bottom, closeTo(reject.bottom, .01));
          expect(back.height, greaterThanOrEqualTo(48));
          expect(reject.right, lessThanOrEqualTo(size.width));
          expect(tester.takeException(), isNull);
        });
      }
    }
  }

  for (final action in ['Volver', 'Rechazar', 'Fondo']) {
    testWidgets('$action conserva el resultado de confirmación',
        (tester) async {
      bool? result;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(body: Builder(builder: (context) {
          return TextButton(
              onPressed: () async {
                result = await showDialog<bool>(
                        context: context,
                        builder: (_) => const RejectOfferDialog()) ??
                    false;
              },
              child: const Text('Abrir'));
        })),
      ));
      await tester.tap(find.text('Abrir'));
      await tester.pumpAndSettle();
      if (action == 'Fondo') {
        await tester.tapAt(const Offset(5, 5));
      } else {
        await tester.tap(find.text(action));
      }
      await tester.pumpAndSettle();
      expect(find.byType(RejectOfferDialog), findsNothing);
      expect(result, action == 'Rechazar');
    });
  }
}
