import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mototaxi_atacames/cancellation_feedback_dialog.dart';

void main() {
  for (final brightness in Brightness.values) {
    for (final kind in CancellationFeedback.values) {
      for (final scale in [1.0, 1.8]) {
        testWidgets('${kind.name} ${brightness.name}, texto $scale',
            (tester) async {
          tester.view.physicalSize = const Size(320, 480);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          final colors = ColorScheme.fromSeed(
              seedColor: const Color(0xff087ccb), brightness: brightness);
          await tester.pumpWidget(MaterialApp(
              theme: ThemeData(colorScheme: colors),
              builder: (context, child) => MediaQuery(
                  data: MediaQuery.of(context)
                      .copyWith(textScaler: TextScaler.linear(scale)),
                  child: child!),
              home: Scaffold(
                  body: CancellationFeedbackDialog(
                      kind: kind,
                      suspensionEndLabel:
                          'domingo, 30 de agosto de 2026 · 07:00',
                      onSupport: kind == CancellationFeedback.suspended
                          ? () {}
                          : null))));
          expect(tester.takeException(), isNull);
          expect(tester.widget<Dialog>(find.byType(Dialog)).backgroundColor,
              colors.surface);
          expect(
              find.text(kind == CancellationFeedback.suspended
                  ? 'Cuenta suspendida'
                  : 'Carrera cancelada'),
              findsOneWidget);
          if (kind == CancellationFeedback.success) {
            expect(find.text('Solicitud cancelada correctamente.'),
                findsOneWidget);
          }
          if (kind == CancellationFeedback.warning) {
            expect(
                find.text(
                    'La cancelación quedó registrada. Evita cancelar después de que un conductor acepte.'),
                findsOneWidget);
          }
          if (kind == CancellationFeedback.suspended) {
            expect(find.textContaining('30 de agosto de 2026'), findsOneWidget);
          }
          await tester.ensureVisible(find.text('OK'));
          await tester.pumpAndSettle();
          expect(tester.getRect(find.byType(FilledButton)).right,
              lessThanOrEqualTo(320));
          expect(tester.takeException(), isNull);
        });
      }
    }
  }
  testWidgets('indefinida mantiene soporte y no inventa una fecha',
      (tester) async {
    bool contacted = false;
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: CancellationFeedbackDialog(
                kind: CancellationFeedback.suspended,
                indefinite: true,
                onSupport: () => contacted = true))));
    expect(find.text('Suspensión indefinida'), findsOneWidget);
    expect(find.text('Solo administración puede reactivar tu cuenta.'),
        findsOneWidget);
    await tester.ensureVisible(find.text('Contactar soporte'));
    await tester.tap(find.text('Contactar soporte'));
    expect(contacted, isTrue);
  });
  testWidgets('OK cierra sin ejecutar acciones de cancelación', (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: Builder(
                builder: (context) => TextButton(
                    onPressed: () => showDialog<void>(
                        context: context,
                        builder: (_) => const CancellationFeedbackDialog(
                            kind: CancellationFeedback.success)),
                    child: const Text('Abrir'))))));
    await tester.tap(find.text('Abrir'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    expect(find.byType(CancellationFeedbackDialog), findsNothing);
  });
}
