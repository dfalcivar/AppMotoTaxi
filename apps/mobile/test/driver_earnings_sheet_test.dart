import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mototaxi_atacames/driver_earnings_sheet.dart';

void main() {
  test('Hoy usa límites locales y fin exclusivo', () {
    final range =
        earningsRangeFor(EarningsPeriod.today, DateTime(2026, 9, 14, 23, 45));
    expect(range.start, DateTime(2026, 9, 14));
    expect(range.end, DateTime(2026, 9, 15));
  });

  test('Semana comienza el lunes y mes comienza el día uno', () {
    final now = DateTime(2026, 9, 16, 10);
    expect(earningsRangeFor(EarningsPeriod.week, now).start,
        DateTime(2026, 9, 14));
    expect(earningsRangeFor(EarningsPeriod.month, now).start,
        DateTime(2026, 9, 1));
  });

  test('Personalizado incluye completo el último día', () {
    final range = earningsRangeFor(
      EarningsPeriod.custom,
      DateTime(2026, 9, 14),
      DateTimeRange(start: DateTime(2026, 8, 30), end: DateTime(2026, 9, 2)),
    );
    expect(range.start, DateTime(2026, 8, 30));
    expect(range.end, DateTime(2026, 9, 3));
  });

  testWidgets('presenta resumen real y cambia el período sin desbordarse',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(393, 852));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    var loads = 0;
    Future<Map<String, dynamic>> summary(DateTime from, DateTime to) async {
      loads++;
      return {
        'completedTrips': 3,
        'grossTripIncome': '4.75',
        'costaGoCommission': '0.25',
        'netEarnings': '4.50',
        'generatedByTrips': '4.20',
        'generatedWithCostaGo': '0.30',
        'averagePerTrip': '1.58',
        'prepaidBalance': '0.00',
        'billingMode': 'PAY_PER_USE',
        'discountsApplied': 2,
        'recentMovements': [
          {
            'tripId': '00000000-0000-4000-8000-000000000001',
            'displayCode': 'CG-00000000',
            'completedAt': '2026-09-14T17:42:00-05:00',
            'grossTripIncome': '1.50',
            'costaGoCommission': '0.10',
            'netEarnings': '1.40'
          }
        ]
      };
    }

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: DriverEarningsSheet(
          loadSummary: summary,
          loadPage: (_, __, ___, ____) async =>
              {'items': <dynamic>[], 'hasMore': false},
        ),
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Ganancias y comisiones'), findsOneWidget);
    expect(find.text(r'$4.50'), findsOneWidget);
    expect(find.text('Ingresos por viajes'), findsOneWidget);
    expect(find.text(r'$4.20'), findsOneWidget);
    expect(find.text('Ingresos con Costa-Go'), findsOneWidget);
    expect(find.text(r'$0.30'), findsOneWidget);
    expect(find.text('Promedio por viaje'), findsNothing);
    expect(find.text('3 viajes completados'), findsOneWidget);
    expect(find.text('Tu ingreso'), findsOneWidget);
    expect(find.text('Tu ganancia'), findsNothing);
    expect(tester.takeException(), isNull);

    await tester.tap(find.text('Semana'));
    await tester.pumpAndSettle();
    expect(loads, 2);
    expect(find.text('Ganancia neta de la semana'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
