import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mototaxi_atacames/costa_go_design.dart';

void main() {
  test('la paleta corporativa usa los tokens Costa-Go definidos', () {
    final light = CostaGoTheme.build(Brightness.light);
    final dark = CostaGoTheme.build(Brightness.dark);
    final lightBrand = light.extension<CostaGoBrandColors>()!;
    final darkBrand = dark.extension<CostaGoBrandColors>()!;

    expect(light.colorScheme.primary, CostaGoPalette.primary);
    expect(light.colorScheme.primaryContainer, CostaGoPalette.primaryContainer);
    expect(light.colorScheme.surfaceContainerLow, CostaGoPalette.cardLight);
    expect(lightBrand.selected, CostaGoPalette.primaryContainer);
    expect(lightBrand.border, CostaGoPalette.borderAccent);
    expect(light.colorScheme.onSurface, CostaGoPalette.textPrimary);
    expect(light.colorScheme.onSurfaceVariant, CostaGoPalette.textSecondary);
    expect(dark.colorScheme.primary, CostaGoPalette.darkPrimary);
    expect(darkBrand.selected, CostaGoPalette.darkSelectedBlue);
    expect(darkBrand.border, CostaGoPalette.darkBlueBorder);
  });

  test('los controles neutros solo usan azul cuando están seleccionados', () {
    final theme = CostaGoTheme.build(Brightness.light);
    final chip = theme.chipTheme;
    final iconButton = theme.iconButtonTheme.style!;

    expect(chip.backgroundColor, Colors.white);
    expect(chip.side?.color, CostaGoPalette.borderAccent);
    expect(
        iconButton.foregroundColor!.resolve({}), CostaGoPalette.textSecondary);
    expect(iconButton.foregroundColor!.resolve({WidgetState.selected}),
        CostaGoPalette.primary);
  });

  test('los estados interactivos conservan contraste y cambian al presionar',
      () {
    final light = CostaGoTheme.build(Brightness.light);
    final dark = CostaGoTheme.build(Brightness.dark);
    final lightButton = light.filledButtonTheme.style!;
    final darkButton = dark.filledButtonTheme.style!;

    expect(
        lightButton.backgroundColor!.resolve({}), CostaGoPalette.primaryDark);
    expect(
      lightButton.backgroundColor!.resolve({WidgetState.pressed}),
      Color.lerp(CostaGoPalette.primaryDark, Colors.black, .14),
    );
    expect(darkButton.backgroundColor!.resolve({}), CostaGoPalette.darkPrimary);
    expect(
      darkButton.backgroundColor!.resolve({WidgetState.pressed}),
      CostaGoPalette.darkPrimaryPressed,
    );

    double contrast(Color foreground, Color background) {
      final lighter = math.max(
          foreground.computeLuminance(), background.computeLuminance());
      final darker = math.min(
          foreground.computeLuminance(), background.computeLuminance());
      return (lighter + .05) / (darker + .05);
    }

    expect(
      contrast(light.colorScheme.onPrimary, light.colorScheme.primary),
      greaterThanOrEqualTo(4.5),
    );
    expect(
      contrast(dark.colorScheme.onPrimary, dark.colorScheme.primary),
      greaterThanOrEqualTo(4.5),
    );
    expect(
      contrast(
        lightButton.foregroundColor!.resolve({})!,
        lightButton.backgroundColor!.resolve({})!,
      ),
      greaterThanOrEqualTo(4.5),
    );
  });

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
