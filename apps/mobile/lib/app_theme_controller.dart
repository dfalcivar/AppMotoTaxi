import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The appearance belongs to this device, independent of the signed-in user.
/// An unrecognized saved value safely follows the operating system.
class AppThemeController extends ValueNotifier<ThemeMode> {
  AppThemeController() : super(ThemeMode.system);

  static const preferenceKey = 'themeMode';

  Future<void> load() async {
    final saved =
        (await SharedPreferences.getInstance()).getString(preferenceKey);
    value = switch (saved) {
      'light' => ThemeMode.light,
      'dark' => ThemeMode.dark,
      _ => ThemeMode.system,
    };
  }

  Future<void> change(ThemeMode mode) async {
    value = mode;
    await (await SharedPreferences.getInstance())
        .setString(preferenceKey, mode.name);
  }
}
