import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mototaxi_atacames/app_theme_controller.dart';
import 'package:mototaxi_atacames/costa_go_design.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('la apariencia empieza en automático y conserva la elección', () async {
    SharedPreferences.setMockInitialValues({});
    final controller = AppThemeController();
    await controller.load();
    expect(controller.value, ThemeMode.system);

    await controller.change(ThemeMode.dark);
    expect(
        (await SharedPreferences.getInstance()).getString('themeMode'), 'dark');
    final restored = AppThemeController();
    await restored.load();
    expect(restored.value, ThemeMode.dark);
    controller.dispose();
    restored.dispose();
  });

  testWidgets('automático reacciona al tema del sistema con la app abierta',
      (tester) async {
    tester.platformDispatcher.platformBrightnessTestValue = Brightness.light;
    addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
    final controller = AppThemeController();
    addTearDown(controller.dispose);

    await tester.pumpWidget(ValueListenableBuilder<ThemeMode>(
      valueListenable: controller,
      builder: (context, mode, _) => MaterialApp(
        theme: CostaGoTheme.build(Brightness.light),
        darkTheme: CostaGoTheme.build(Brightness.dark),
        themeMode: mode,
        home: Builder(
            builder: (context) => Scaffold(
                  body: Text(Theme.of(context).brightness.name),
                )),
      ),
    ));
    expect(find.text('light'), findsOneWidget);

    tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
    tester.binding.handlePlatformBrightnessChanged();
    await tester.pumpAndSettle();
    expect(find.text('dark'), findsOneWidget);
  });
}
