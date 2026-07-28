import 'package:flutter_test/flutter_test.dart';
import 'package:mototaxi_atacames/main.dart';

void main() {
  testWidgets('muestra las dos entradas principales', (tester) async {
    await tester.pumpWidget(const MototaxiApp());

    expect(find.text('Solicitar una mototaxi'), findsOneWidget);
    expect(find.text('Ingresar como conductor'), findsOneWidget);
  });
}
