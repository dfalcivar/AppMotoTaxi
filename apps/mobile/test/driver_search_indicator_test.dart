import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mototaxi_atacames/driver_search_indicator.dart';

void main() {
  SearchProgress sample(
          {double elapsed = 42, int round = 2, String cycle = 'a'}) =>
      SearchProgress(
          round: round,
          totalRounds: 4,
          totalSeconds: 60,
          elapsedSeconds: elapsed,
          cycleId: cycle,
          sampleId: '$elapsed-$cycle');
  test('progreso total y restantes, sin depender del reloj del teléfono', () {
    final p = sample();
    expect(p.remaining(0), 18);
    expect(p.fraction(0), .7);
    expect(p.remaining(10), 8);
    expect(p.fraction(18), 1);
    expect(p.remaining(200), 0);
    expect(sample(elapsed: 14, round: 1).roundEnded(1), isTrue);
  });
  test('no inventa parámetros con servidor antiguo o respuesta inválida', () {
    for (final value in [
      null,
      {},
      'invalid',
      {'totalSeconds': 0},
      {'totalSeconds': 'NaN'}
    ]) {
      expect(SearchProgress.fromJson(value), isNull);
    }
    expect(
        SearchProgress.fromJson({
          'totalSeconds': 60,
          'elapsedSeconds': 42,
          'round': 2,
          'totalRounds': 4
        })?.remaining(0),
        18);
  });
  for (final brightness in Brightness.values) {
    testWidgets('círculo y texto ${brightness.name}, sin barra adicional',
        (tester) async {
      tester.view.physicalSize = const Size(320, 600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final colors = ColorScheme.fromSeed(
          seedColor: const Color(0xff087ccb), brightness: brightness);
      await tester.pumpWidget(MaterialApp(
          theme: ThemeData(colorScheme: colors),
          home: Scaffold(
              body: DriverSearchIndicator(
                  progress: sample(), onDeadline: () async {}))));
      await tester.pump(const Duration(milliseconds: 30));
      expect(find.text('Rango 2 de 4 · 00:18 restantes'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.byType(LinearProgressIndicator), findsNothing);
      final circle = tester.widget<CircularProgressIndicator>(
          find.byType(CircularProgressIndicator));
      expect(circle.color, colors.primary);
      expect(circle.value, greaterThanOrEqualTo(.7));
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }
  testWidgets(
      'al terminar consulta servidor una vez mientras espera, no inventa NO_DRIVER',
      (tester) async {
    var calls = 0;
    final pending = Completer<void>();
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: DriverSearchIndicator(
                progress: sample(elapsed: 60, round: 4),
                onDeadline: () {
                  calls++;
                  return pending.future;
                }))));
    await tester.pump(const Duration(milliseconds: 50));
    await tester.pump(const Duration(seconds: 5));
    expect(calls, 1);
    expect(find.text('Verificando disponibilidad…'), findsOneWidget);
    expect(find.text('Ninguna mototaxi disponible en este momento.'),
        findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
    pending.complete();
    await tester.pump();
    expect(tester.takeException(), isNull);
  });
}
