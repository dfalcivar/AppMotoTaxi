import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mototaxi_atacames/costa_go_design.dart';

void main() {
  for (final brightness in Brightness.values) {
    for (final scenario in const [
      (size: Size(320, 640), scale: 1.0),
      (size: Size(430, 800), scale: 1.4),
    ]) {
      testWidgets(
        'sistema visual ${brightness.name} ${scenario.size.width}dp texto ${scenario.scale}',
        (tester) async {
          tester.view.physicalSize = scenario.size;
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);

          await tester.pumpWidget(
            MaterialApp(
              theme: CostaGoTheme.build(brightness),
              home: MediaQuery(
                data: MediaQueryData(
                  size: scenario.size,
                  textScaler: TextScaler.linear(scenario.scale),
                ),
                child: Scaffold(
                  body: ListView(
                    padding: const EdgeInsets.all(CostaGoSpace.md),
                    children: [
                      const CostaGoSheetHeader(
                        icon: Icons.receipt_long_outlined,
                        title: 'Membresía Costa-Go',
                        subtitle:
                            'Plan por viajes con información clara y accesible.',
                      ),
                      const SizedBox(height: CostaGoSpace.md),
                      const Wrap(
                        spacing: CostaGoSpace.xs,
                        runSpacing: CostaGoSpace.xs,
                        children: [
                          CostaGoStatusChip(
                            label: 'Pagada',
                            tone: CostaGoStatusTone.success,
                          ),
                          CostaGoStatusChip(
                            label: 'Pendiente de pago',
                            tone: CostaGoStatusTone.warning,
                          ),
                          CostaGoStatusChip(
                            label: 'Anulada',
                            tone: CostaGoStatusTone.danger,
                          ),
                        ],
                      ),
                      const SizedBox(height: CostaGoSpace.md),
                      const CostaGoInfoBanner(
                        title: 'Viajes disponibles: 50',
                        message:
                            'Tu paquete permanece activo hasta consumir todos los viajes.',
                        icon: Icons.route_outlined,
                      ),
                      const SizedBox(height: CostaGoSpace.md),
                      const CostaGoSurface(
                        child: CostaGoDetailRow(
                          icon: Icons.payments_outlined,
                          label: 'Total a pagar',
                          value: r'$13.80',
                        ),
                      ),
                      const SizedBox(height: CostaGoSpace.md),
                      FilledButton.icon(
                        onPressed: () {},
                        icon: const Icon(Icons.lock_outline_rounded),
                        label: const Text('Guardar y continuar'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
          await tester.pumpAndSettle();

          expect(find.text('Membresía Costa-Go'), findsOneWidget);
          expect(tester.takeException(), isNull);
        },
      );
    }
  }
}
