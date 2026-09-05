import 'package:flutter/material.dart';

abstract final class CostaGoSpace {
  static const double xxs = 4;
  static const double xs = 8;
  static const double sm = 12;
  static const double md = 16;
  static const double lg = 20;
  static const double xl = 24;
  static const double xxl = 32;
}

abstract final class CostaGoRadius {
  static const double small = 12;
  static const double medium = 16;
  static const double large = 20;
  static const double sheet = 28;
  static const double pill = 999;
}

enum CostaGoStatusTone { info, success, warning, danger, neutral }

abstract final class CostaGoPalette {
  static const primary = Color(0xff527da8);
  static const primaryDark = Color(0xff3f6387);
  static const primaryLight = Color(0xff8fafcc);
  static const primaryContainer = Color(0xffe7eff7);
  static const surfaceAccent = Color(0xfff4f8fb);
  static const borderAccent = Color(0xffd8e3ec);
  static const textPrimary = Color(0xff20242a);
  static const textSecondary = Color(0xff667085);
  static const cardLight = Colors.white;

  // Alias de compatibilidad para componentes anteriores; todos apuntan a
  // tokens semánticos y evitan reintroducir azules saturados.
  static const softBlue = surfaceAccent;
  static const selectedBlue = primaryContainer;
  static const blueBorder = borderAccent;

  static const darkPrimary = Color(0xff8fafcc);
  static const darkPrimaryPressed = Color(0xff6f91b0);
  static const darkPrimaryLight = Color(0xffaec4d8);
  static const darkSoftBlue = Color(0xff202a33);
  static const darkSelectedBlue = Color(0xff2b3946);
  static const darkBlueBorder = Color(0xff3b4a58);
  static const cardDark = Color(0xff181d22);
  static const onDarkBackground = Color(0xffe6e9ed);
}

@immutable
class CostaGoBrandColors extends ThemeExtension<CostaGoBrandColors> {
  const CostaGoBrandColors({
    required this.primaryDark,
    required this.primaryLight,
    required this.softBackground,
    required this.selected,
    required this.border,
    required this.card,
    required this.iconPrimary,
  });

  final Color primaryDark;
  final Color primaryLight;
  final Color softBackground;
  final Color selected;
  final Color border;
  final Color card;
  final Color iconPrimary;

  factory CostaGoBrandColors.forBrightness(Brightness brightness) {
    final dark = brightness == Brightness.dark;
    return CostaGoBrandColors(
      primaryDark:
          dark ? CostaGoPalette.darkPrimaryPressed : CostaGoPalette.primaryDark,
      primaryLight:
          dark ? CostaGoPalette.darkPrimaryLight : CostaGoPalette.primaryLight,
      softBackground:
          dark ? CostaGoPalette.darkSoftBlue : CostaGoPalette.softBlue,
      selected:
          dark ? CostaGoPalette.darkSelectedBlue : CostaGoPalette.selectedBlue,
      border: dark ? CostaGoPalette.darkBlueBorder : CostaGoPalette.blueBorder,
      card: dark ? CostaGoPalette.cardDark : CostaGoPalette.cardLight,
      iconPrimary: dark ? CostaGoPalette.darkPrimary : CostaGoPalette.primary,
    );
  }

  @override
  CostaGoBrandColors copyWith({
    Color? primaryDark,
    Color? primaryLight,
    Color? softBackground,
    Color? selected,
    Color? border,
    Color? card,
    Color? iconPrimary,
  }) =>
      CostaGoBrandColors(
        primaryDark: primaryDark ?? this.primaryDark,
        primaryLight: primaryLight ?? this.primaryLight,
        softBackground: softBackground ?? this.softBackground,
        selected: selected ?? this.selected,
        border: border ?? this.border,
        card: card ?? this.card,
        iconPrimary: iconPrimary ?? this.iconPrimary,
      );

  @override
  CostaGoBrandColors lerp(covariant CostaGoBrandColors? other, double t) {
    if (other == null) return this;
    return CostaGoBrandColors(
      primaryDark: Color.lerp(primaryDark, other.primaryDark, t)!,
      primaryLight: Color.lerp(primaryLight, other.primaryLight, t)!,
      softBackground: Color.lerp(softBackground, other.softBackground, t)!,
      selected: Color.lerp(selected, other.selected, t)!,
      border: Color.lerp(border, other.border, t)!,
      card: Color.lerp(card, other.card, t)!,
      iconPrimary: Color.lerp(iconPrimary, other.iconPrimary, t)!,
    );
  }
}

@immutable
class CostaGoSemanticColors extends ThemeExtension<CostaGoSemanticColors> {
  const CostaGoSemanticColors({
    required this.success,
    required this.onSuccess,
    required this.successContainer,
    required this.onSuccessContainer,
    required this.warning,
    required this.onWarning,
    required this.warningContainer,
    required this.onWarningContainer,
    required this.dangerContainer,
    required this.onDangerContainer,
    required this.infoContainer,
    required this.onInfoContainer,
  });

  final Color success;
  final Color onSuccess;
  final Color successContainer;
  final Color onSuccessContainer;
  final Color warning;
  final Color onWarning;
  final Color warningContainer;
  final Color onWarningContainer;
  final Color dangerContainer;
  final Color onDangerContainer;
  final Color infoContainer;
  final Color onInfoContainer;

  factory CostaGoSemanticColors.forBrightness(Brightness brightness) {
    final dark = brightness == Brightness.dark;
    return CostaGoSemanticColors(
      success: dark ? const Color(0xff51d47b) : const Color(0xff159447),
      onSuccess: dark ? const Color(0xff052d16) : Colors.white,
      successContainer:
          dark ? const Color(0xff123d25) : const Color(0xffe8f8ed),
      onSuccessContainer:
          dark ? const Color(0xff9cebb3) : const Color(0xff0d6531),
      warning: dark ? const Color(0xffffc45b) : const Color(0xffb86b00),
      onWarning: dark ? const Color(0xff392300) : Colors.white,
      warningContainer:
          dark ? const Color(0xff493209) : const Color(0xfffff1d6),
      onWarningContainer:
          dark ? const Color(0xffffd893) : const Color(0xff744300),
      dangerContainer: dark ? const Color(0xff4d2028) : const Color(0xffffe9ec),
      onDangerContainer:
          dark ? const Color(0xffffb2be) : const Color(0xff9f1f38),
      infoContainer:
          dark ? CostaGoPalette.darkSoftBlue : CostaGoPalette.softBlue,
      onInfoContainer:
          dark ? const Color(0xffc5d4e1) : CostaGoPalette.primaryDark,
    );
  }

  @override
  CostaGoSemanticColors copyWith({
    Color? success,
    Color? onSuccess,
    Color? successContainer,
    Color? onSuccessContainer,
    Color? warning,
    Color? onWarning,
    Color? warningContainer,
    Color? onWarningContainer,
    Color? dangerContainer,
    Color? onDangerContainer,
    Color? infoContainer,
    Color? onInfoContainer,
  }) =>
      CostaGoSemanticColors(
        success: success ?? this.success,
        onSuccess: onSuccess ?? this.onSuccess,
        successContainer: successContainer ?? this.successContainer,
        onSuccessContainer: onSuccessContainer ?? this.onSuccessContainer,
        warning: warning ?? this.warning,
        onWarning: onWarning ?? this.onWarning,
        warningContainer: warningContainer ?? this.warningContainer,
        onWarningContainer: onWarningContainer ?? this.onWarningContainer,
        dangerContainer: dangerContainer ?? this.dangerContainer,
        onDangerContainer: onDangerContainer ?? this.onDangerContainer,
        infoContainer: infoContainer ?? this.infoContainer,
        onInfoContainer: onInfoContainer ?? this.onInfoContainer,
      );

  @override
  CostaGoSemanticColors lerp(covariant CostaGoSemanticColors? other, double t) {
    if (other == null) return this;
    return CostaGoSemanticColors(
      success: Color.lerp(success, other.success, t)!,
      onSuccess: Color.lerp(onSuccess, other.onSuccess, t)!,
      successContainer:
          Color.lerp(successContainer, other.successContainer, t)!,
      onSuccessContainer:
          Color.lerp(onSuccessContainer, other.onSuccessContainer, t)!,
      warning: Color.lerp(warning, other.warning, t)!,
      onWarning: Color.lerp(onWarning, other.onWarning, t)!,
      warningContainer:
          Color.lerp(warningContainer, other.warningContainer, t)!,
      onWarningContainer:
          Color.lerp(onWarningContainer, other.onWarningContainer, t)!,
      dangerContainer: Color.lerp(dangerContainer, other.dangerContainer, t)!,
      onDangerContainer:
          Color.lerp(onDangerContainer, other.onDangerContainer, t)!,
      infoContainer: Color.lerp(infoContainer, other.infoContainer, t)!,
      onInfoContainer: Color.lerp(onInfoContainer, other.onInfoContainer, t)!,
    );
  }
}

extension CostaGoThemeContext on BuildContext {
  CostaGoSemanticColors get semantic =>
      Theme.of(this).extension<CostaGoSemanticColors>() ??
      CostaGoSemanticColors.forBrightness(Theme.of(this).brightness);

  CostaGoBrandColors get brand =>
      Theme.of(this).extension<CostaGoBrandColors>() ??
      CostaGoBrandColors.forBrightness(Theme.of(this).brightness);
}

abstract final class CostaGoTheme {
  static const Color brandBlue = CostaGoPalette.primary;
  static const Color deepBlue = CostaGoPalette.primaryDark;

  static ThemeData build(Brightness brightness) {
    final dark = brightness == Brightness.dark;
    final generatedScheme = ColorScheme.fromSeed(
      seedColor: brandBlue,
      brightness: brightness,
    );
    final scheme = generatedScheme.copyWith(
      primary: dark ? CostaGoPalette.darkPrimary : CostaGoPalette.primary,
      onPrimary: dark ? const Color(0xff17212a) : Colors.black,
      primaryContainer: dark
          ? CostaGoPalette.darkSelectedBlue
          : CostaGoPalette.primaryContainer,
      onPrimaryContainer:
          dark ? const Color(0xffd7e2ec) : CostaGoPalette.textPrimary,
      secondary: dark ? const Color(0xffaab8c4) : const Color(0xff718395),
      onSecondary: dark ? const Color(0xff20272d) : Colors.white,
      secondaryContainer:
          dark ? const Color(0xff2b333a) : const Color(0xffeef2f5),
      onSecondaryContainer:
          dark ? const Color(0xffd8dde2) : CostaGoPalette.textPrimary,
      surface: dark ? const Color(0xff12171b) : const Color(0xfffbfcfd),
      onSurface:
          dark ? CostaGoPalette.onDarkBackground : CostaGoPalette.textPrimary,
      onSurfaceVariant:
          dark ? const Color(0xffabb4bd) : CostaGoPalette.textSecondary,
      outline: dark ? const Color(0xff697681) : const Color(0xffb8c2cc),
      outlineVariant:
          dark ? const Color(0xff34435d) : CostaGoPalette.blueBorder,
      surfaceContainerLowest: dark ? const Color(0xff0c111a) : Colors.white,
      surfaceContainerLow:
          dark ? CostaGoPalette.cardDark : CostaGoPalette.cardLight,
      surfaceContainer:
          dark ? const Color(0xff20262c) : const Color(0xfff4f6f8),
      surfaceContainerHigh:
          dark ? const Color(0xff252c32) : CostaGoPalette.softBlue,
      surfaceContainerHighest:
          dark ? const Color(0xff2f3942) : CostaGoPalette.selectedBlue,
      inverseSurface: dark ? const Color(0xffe6e9ed) : const Color(0xff2a3036),
      inversePrimary:
          dark ? CostaGoPalette.primaryDark : CostaGoPalette.primaryLight,
    );
    final semantics = CostaGoSemanticColors.forBrightness(brightness);
    final brand = CostaGoBrandColors.forBrightness(brightness);
    final background = dark ? const Color(0xff101417) : const Color(0xfff6f7f8);
    final surfaceLow = brand.card;
    final outline = brand.border;
    final baseTextTheme = ThemeData(brightness: brightness).textTheme;
    final textTheme = baseTextTheme
        .copyWith(
          headlineLarge: baseTextTheme.headlineLarge
              ?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -.8),
          headlineMedium: baseTextTheme.headlineMedium
              ?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -.6),
          headlineSmall: baseTextTheme.headlineSmall
              ?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -.4),
          titleLarge: baseTextTheme.titleLarge
              ?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -.2),
          titleMedium:
              baseTextTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
          titleSmall:
              baseTextTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
          bodyLarge: baseTextTheme.bodyLarge?.copyWith(height: 1.35),
          bodyMedium: baseTextTheme.bodyMedium?.copyWith(height: 1.35),
          bodySmall: baseTextTheme.bodySmall?.copyWith(height: 1.35),
          labelLarge:
              baseTextTheme.labelLarge?.copyWith(fontWeight: FontWeight.w800),
        )
        .apply(
          displayColor: scheme.onSurface,
          bodyColor: scheme.onSurface,
        );

    final roundedButton = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(CostaGoRadius.medium),
    );
    final fieldBorder = OutlineInputBorder(
      borderRadius: BorderRadius.circular(CostaGoRadius.medium),
      borderSide: BorderSide(color: outline),
    );

    return ThemeData(
      colorScheme: scheme,
      brightness: brightness,
      useMaterial3: true,
      scaffoldBackgroundColor: background,
      canvasColor: background,
      textTheme: textTheme,
      extensions: [semantics, brand],
      splashFactory: InkSparkle.splashFactory,
      focusColor: scheme.primary.withValues(alpha: dark ? .20 : .14),
      hoverColor: scheme.primary.withValues(alpha: dark ? .12 : .08),
      splashColor: scheme.primary.withValues(alpha: dark ? .20 : .14),
      highlightColor: scheme.primary.withValues(alpha: dark ? .12 : .08),
      disabledColor: scheme.onSurface.withValues(alpha: .38),
      appBarTheme: AppBarTheme(
        centerTitle: false,
        elevation: 0,
        scrolledUnderElevation: 0,
        backgroundColor: background,
        surfaceTintColor: Colors.transparent,
        foregroundColor: scheme.onSurface,
        titleTextStyle: textTheme.titleLarge?.copyWith(
          color: scheme.onSurface,
          fontWeight: FontWeight.w800,
        ),
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        margin: const EdgeInsets.symmetric(vertical: CostaGoSpace.xs),
        color: surfaceLow,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          side: BorderSide(color: outline.withValues(alpha: .9)),
          borderRadius: BorderRadius.circular(CostaGoRadius.large),
        ),
      ),
      dialogTheme: DialogThemeData(
        elevation: 16,
        shadowColor: Colors.black.withValues(alpha: dark ? .45 : .16),
        backgroundColor: surfaceLow,
        surfaceTintColor: Colors.transparent,
        insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(CostaGoRadius.sheet),
        ),
        titleTextStyle: textTheme.titleLarge?.copyWith(
          color: scheme.onSurface,
          fontWeight: FontWeight.w900,
        ),
        contentTextStyle:
            textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        elevation: 18,
        modalElevation: 18,
        shadowColor: Colors.black.withValues(alpha: dark ? .55 : .18),
        backgroundColor: surfaceLow,
        modalBackgroundColor: surfaceLow,
        surfaceTintColor: Colors.transparent,
        showDragHandle: false,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(CostaGoRadius.sheet),
          ),
        ),
      ),
      listTileTheme: ListTileThemeData(
        contentPadding: const EdgeInsets.symmetric(
          horizontal: CostaGoSpace.md,
          vertical: CostaGoSpace.xxs,
        ),
        iconColor: scheme.onSurfaceVariant,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(CostaGoRadius.medium),
        ),
      ),
      dividerTheme: DividerThemeData(
        color: outline.withValues(alpha: .85),
        thickness: 1,
        space: CostaGoSpace.lg,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: dark ? const Color(0xff1b2228) : Colors.white,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        floatingLabelStyle:
            TextStyle(color: scheme.primary, fontWeight: FontWeight.w700),
        labelStyle: TextStyle(color: scheme.onSurfaceVariant),
        hintStyle: TextStyle(color: scheme.onSurfaceVariant),
        border: fieldBorder,
        enabledBorder: fieldBorder,
        disabledBorder: fieldBorder.copyWith(
          borderSide: BorderSide(color: outline.withValues(alpha: .55)),
        ),
        focusedBorder: fieldBorder.copyWith(
          borderSide: BorderSide(color: scheme.primary, width: 1.8),
        ),
        errorBorder: fieldBorder.copyWith(
          borderSide: BorderSide(color: scheme.error),
        ),
        focusedErrorBorder: fieldBorder.copyWith(
          borderSide: BorderSide(color: scheme.error, width: 1.8),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: ButtonStyle(
          minimumSize: const WidgetStatePropertyAll(Size.fromHeight(54)),
          padding: const WidgetStatePropertyAll(
              EdgeInsets.symmetric(horizontal: 20, vertical: 14)),
          textStyle: WidgetStatePropertyAll(textTheme.labelLarge),
          shape: WidgetStatePropertyAll(roundedButton),
          foregroundColor: WidgetStateProperty.resolveWith(
              (states) => states.contains(WidgetState.disabled)
                  ? scheme.onSurface.withValues(alpha: .42)
                  : dark
                      ? scheme.onPrimary
                      : Colors.white),
          backgroundColor: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.disabled)) {
              return scheme.onSurface.withValues(alpha: .10);
            }
            if (states.contains(WidgetState.pressed)) {
              return dark
                  ? brand.primaryDark
                  : Color.lerp(brand.primaryDark, Colors.black, .14);
            }
            if (states.contains(WidgetState.hovered)) {
              return Color.lerp(dark ? scheme.primary : brand.primaryDark,
                  dark ? brand.primaryLight : scheme.primary, .18);
            }
            return dark ? scheme.primary : brand.primaryDark;
          }),
          overlayColor: WidgetStatePropertyAll(
              scheme.onPrimary.withValues(alpha: dark ? .10 : .14)),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: ButtonStyle(
          minimumSize: const WidgetStatePropertyAll(Size.fromHeight(52)),
          padding: const WidgetStatePropertyAll(
              EdgeInsets.symmetric(horizontal: 18, vertical: 13)),
          foregroundColor: WidgetStateProperty.resolveWith(
              (states) => states.contains(WidgetState.disabled)
                  ? scheme.onSurface.withValues(alpha: .38)
                  : states.contains(WidgetState.pressed)
                      ? brand.primaryDark
                      : scheme.primary),
          side: WidgetStateProperty.resolveWith((states) => BorderSide(
              color: states.contains(WidgetState.disabled)
                  ? outline.withValues(alpha: .55)
                  : states.contains(WidgetState.focused)
                      ? scheme.primary
                      : brand.border,
              width: states.contains(WidgetState.focused) ? 1.8 : 1.2)),
          overlayColor: WidgetStatePropertyAll(
              scheme.primary.withValues(alpha: dark ? .14 : .08)),
          textStyle: WidgetStatePropertyAll(textTheme.labelLarge),
          shape: WidgetStatePropertyAll(roundedButton),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          minimumSize: const Size(44, 44),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          textStyle: textTheme.labelLarge,
          shape: roundedButton,
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          minimumSize: const Size.fromHeight(52),
          elevation: 1,
          shadowColor: Colors.black.withValues(alpha: .12),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 13),
          textStyle: textTheme.labelLarge,
          shape: roundedButton,
        ),
      ),
      iconButtonTheme: IconButtonThemeData(
        style: ButtonStyle(
          minimumSize: const WidgetStatePropertyAll(Size.square(44)),
          foregroundColor: WidgetStateProperty.resolveWith(
              (states) => states.contains(WidgetState.disabled)
                  ? scheme.onSurface.withValues(alpha: .38)
                  : states.contains(WidgetState.selected)
                      ? scheme.primary
                      : scheme.onSurfaceVariant),
          backgroundColor: WidgetStateProperty.resolveWith((states) =>
              states.contains(WidgetState.selected) ? brand.selected : null),
          overlayColor: WidgetStatePropertyAll(
              scheme.primary.withValues(alpha: dark ? .14 : .08)),
          shape: WidgetStatePropertyAll(RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(CostaGoRadius.medium),
          )),
        ),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: dark ? scheme.surfaceContainer : Colors.white,
        selectedColor: brand.selected,
        side: BorderSide(color: brand.border),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(CostaGoRadius.pill),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
        labelStyle: textTheme.labelMedium?.copyWith(color: scheme.onSurface),
        secondaryLabelStyle:
            textTheme.labelMedium?.copyWith(color: scheme.primary),
      ),
      segmentedButtonTheme: SegmentedButtonThemeData(
        style: ButtonStyle(
          minimumSize: const WidgetStatePropertyAll(Size(0, 48)),
          padding: const WidgetStatePropertyAll(
            EdgeInsets.symmetric(horizontal: 12, vertical: 11),
          ),
          shape: WidgetStatePropertyAll(
            RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(CostaGoRadius.medium),
            ),
          ),
          side: WidgetStatePropertyAll(BorderSide(color: brand.border)),
          backgroundColor: WidgetStateProperty.resolveWith((states) =>
              states.contains(WidgetState.selected) ? brand.selected : null),
          foregroundColor: WidgetStateProperty.resolveWith((states) =>
              states.contains(WidgetState.selected)
                  ? scheme.primary
                  : scheme.onSurfaceVariant),
          overlayColor: WidgetStatePropertyAll(
              scheme.primary.withValues(alpha: dark ? .14 : .08)),
        ),
      ),
      tabBarTheme: TabBarThemeData(
        labelColor: scheme.primary,
        unselectedLabelColor: scheme.onSurfaceVariant,
        indicatorColor: scheme.primary,
        overlayColor: WidgetStatePropertyAll(
            scheme.primary.withValues(alpha: dark ? .14 : .08)),
        dividerColor: brand.border,
      ),
      checkboxTheme: CheckboxThemeData(
        fillColor: WidgetStateProperty.resolveWith((states) =>
            states.contains(WidgetState.selected) ? scheme.primary : null),
        checkColor: const WidgetStatePropertyAll(Colors.white),
        side: BorderSide(color: scheme.outline),
      ),
      radioTheme: RadioThemeData(
        fillColor: WidgetStateProperty.resolveWith((states) =>
            states.contains(WidgetState.selected)
                ? scheme.primary
                : scheme.outline),
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith((states) =>
            states.contains(WidgetState.selected)
                ? scheme.onPrimary
                : scheme.onSurfaceVariant),
        trackColor: WidgetStateProperty.resolveWith((states) =>
            states.contains(WidgetState.selected)
                ? scheme.primary
                : scheme.surfaceContainerHighest),
        trackOutlineColor: WidgetStateProperty.resolveWith((states) =>
            states.contains(WidgetState.selected) ? scheme.primary : outline),
      ),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: scheme.primary,
        foregroundColor: scheme.onPrimary,
        focusColor: brand.primaryDark,
        hoverColor: Color.lerp(scheme.primary, brand.primaryLight, .22),
        splashColor: brand.primaryDark,
      ),
      navigationBarTheme: NavigationBarThemeData(
        elevation: 0,
        backgroundColor: surfaceLow,
        indicatorColor: brand.selected,
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => textTheme.labelSmall?.copyWith(
            color: states.contains(WidgetState.selected)
                ? scheme.primary
                : scheme.onSurfaceVariant,
            fontWeight: states.contains(WidgetState.selected)
                ? FontWeight.w800
                : FontWeight.w600,
          ),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: scheme.inverseSurface,
        contentTextStyle: textTheme.bodyMedium?.copyWith(
          color: dark ? const Color(0xff182640) : Colors.white,
          fontWeight: FontWeight.w600,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(CostaGoRadius.medium),
        ),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: scheme.primary,
        linearTrackColor: scheme.primaryContainer.withValues(alpha: .45),
        circularTrackColor: scheme.primaryContainer.withValues(alpha: .45),
      ),
    );
  }
}

class CostaGoSheetHandle extends StatelessWidget {
  const CostaGoSheetHandle({super.key});

  @override
  Widget build(BuildContext context) => Center(
        child: Container(
          width: 48,
          height: 5,
          margin: const EdgeInsets.only(top: 10, bottom: 16),
          decoration: BoxDecoration(
            color: Theme.of(context)
                .colorScheme
                .onSurfaceVariant
                .withValues(alpha: .28),
            borderRadius: BorderRadius.circular(CostaGoRadius.pill),
          ),
        ),
      );
}

class CostaGoIconBadge extends StatelessWidget {
  const CostaGoIconBadge({
    super.key,
    required this.icon,
    this.tone = CostaGoStatusTone.info,
    this.size = 48,
  });

  final IconData icon;
  final CostaGoStatusTone tone;
  final double size;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final semantic = context.semantic;
    final (background, foreground) = switch (tone) {
      CostaGoStatusTone.success => (
          semantic.successContainer,
          semantic.onSuccessContainer
        ),
      CostaGoStatusTone.warning => (
          semantic.warningContainer,
          semantic.onWarningContainer
        ),
      CostaGoStatusTone.danger => (
          semantic.dangerContainer,
          semantic.onDangerContainer
        ),
      CostaGoStatusTone.neutral => (
          colors.surfaceContainerHighest,
          colors.onSurfaceVariant
        ),
      CostaGoStatusTone.info => (
          semantic.infoContainer,
          semantic.onInfoContainer
        ),
    };
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(size * .32),
      ),
      child: Icon(icon, color: foreground, size: size * .52),
    );
  }
}

class CostaGoSurface extends StatelessWidget {
  const CostaGoSurface({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(CostaGoSpace.md),
    this.tone = CostaGoStatusTone.neutral,
    this.borderColor,
    this.onTap,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final CostaGoStatusTone tone;
  final Color? borderColor;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final semantic = context.semantic;
    final background = switch (tone) {
      CostaGoStatusTone.info => semantic.infoContainer.withValues(alpha: .55),
      CostaGoStatusTone.success =>
        semantic.successContainer.withValues(alpha: .65),
      CostaGoStatusTone.warning =>
        semantic.warningContainer.withValues(alpha: .68),
      CostaGoStatusTone.danger =>
        semantic.dangerContainer.withValues(alpha: .68),
      CostaGoStatusTone.neutral => scheme.surfaceContainerLow,
    };
    final border = borderColor ??
        switch (tone) {
          CostaGoStatusTone.info => scheme.primary.withValues(alpha: .18),
          CostaGoStatusTone.success => semantic.success.withValues(alpha: .20),
          CostaGoStatusTone.warning => semantic.warning.withValues(alpha: .22),
          CostaGoStatusTone.danger => scheme.error.withValues(alpha: .22),
          CostaGoStatusTone.neutral =>
            scheme.outlineVariant.withValues(alpha: .86),
        };
    final content = Padding(padding: padding, child: child);
    return Material(
      color: background,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(CostaGoRadius.large),
        side: BorderSide(color: border),
      ),
      child: onTap == null
          ? content
          : InkWell(
              onTap: onTap,
              borderRadius: BorderRadius.circular(CostaGoRadius.large),
              child: content,
            ),
    );
  }
}

class CostaGoStatusChip extends StatelessWidget {
  const CostaGoStatusChip({
    super.key,
    required this.label,
    this.icon,
    this.tone = CostaGoStatusTone.info,
  });

  final String label;
  final IconData? icon;
  final CostaGoStatusTone tone;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final semantic = context.semantic;
    final (background, foreground) = switch (tone) {
      CostaGoStatusTone.success => (
          semantic.successContainer,
          semantic.onSuccessContainer
        ),
      CostaGoStatusTone.warning => (
          semantic.warningContainer,
          semantic.onWarningContainer
        ),
      CostaGoStatusTone.danger => (
          semantic.dangerContainer,
          semantic.onDangerContainer
        ),
      CostaGoStatusTone.neutral => (
          scheme.surfaceContainerHighest,
          scheme.onSurfaceVariant
        ),
      CostaGoStatusTone.info => (
          semantic.infoContainer,
          semantic.onInfoContainer
        ),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(CostaGoRadius.pill),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        if (icon != null) ...[
          Icon(icon, size: 17, color: foreground),
          const SizedBox(width: 6),
        ],
        Flexible(
          child: Text(
            label,
            maxLines: 2,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: foreground,
                  fontWeight: FontWeight.w800,
                ),
          ),
        ),
      ]),
    );
  }
}

class CostaGoInfoBanner extends StatelessWidget {
  const CostaGoInfoBanner({
    super.key,
    required this.title,
    required this.message,
    this.icon = Icons.info_outline_rounded,
    this.tone = CostaGoStatusTone.info,
  });

  final String title;
  final String message;
  final IconData icon;
  final CostaGoStatusTone tone;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return CostaGoSurface(
      tone: tone,
      padding: const EdgeInsets.all(CostaGoSpace.sm),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        CostaGoIconBadge(icon: icon, tone: tone, size: 40),
        const SizedBox(width: CostaGoSpace.sm),
        Expanded(
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title,
                style: theme.textTheme.titleSmall
                    ?.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: 2),
            Text(message,
                style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant, height: 1.35)),
          ]),
        ),
      ]),
    );
  }
}

class CostaGoSheetHeader extends StatelessWidget {
  const CostaGoSheetHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.icon,
    this.onClose,
    this.centered = false,
  });

  final String title;
  final String? subtitle;
  final IconData? icon;
  final VoidCallback? onClose;
  final bool centered;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      if (icon != null) ...[
        CostaGoIconBadge(icon: icon!),
        const SizedBox(width: CostaGoSpace.sm),
      ],
      Expanded(
        child: Column(
          crossAxisAlignment:
              centered ? CrossAxisAlignment.center : CrossAxisAlignment.start,
          children: [
            Text(
              title,
              textAlign: centered ? TextAlign.center : TextAlign.start,
              style: theme.textTheme.titleLarge
                  ?.copyWith(fontWeight: FontWeight.w900),
            ),
            if (subtitle != null) ...[
              const SizedBox(height: 4),
              Text(
                subtitle!,
                textAlign: centered ? TextAlign.center : TextAlign.start,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ],
        ),
      ),
      if (onClose != null) ...[
        const SizedBox(width: CostaGoSpace.xs),
        IconButton.filledTonal(
          tooltip: 'Cerrar',
          onPressed: onClose,
          icon: const Icon(Icons.close_rounded),
        ),
      ],
    ]);
  }
}

class CostaGoSectionHeader extends StatelessWidget {
  const CostaGoSectionHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.trailing,
  });

  final String title;
  final String? subtitle;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
      Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: theme.textTheme.titleMedium),
          if (subtitle != null) ...[
            const SizedBox(height: 2),
            Text(subtitle!,
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          ],
        ]),
      ),
      if (trailing != null) trailing!,
    ]);
  }
}

class CostaGoDetailRow extends StatelessWidget {
  const CostaGoDetailRow({
    super.key,
    required this.icon,
    required this.label,
    required this.value,
    this.emphasized = false,
  });

  final IconData icon;
  final String label;
  final String value;
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: CostaGoSpace.xs),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        CostaGoIconBadge(icon: icon, size: 40),
        const SizedBox(width: CostaGoSpace.sm),
        Expanded(
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label,
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
            const SizedBox(height: 2),
            Text(
              value,
              softWrap: true,
              style: (emphasized
                      ? theme.textTheme.titleMedium
                      : theme.textTheme.bodyLarge)
                  ?.copyWith(fontWeight: FontWeight.w700),
            ),
          ]),
        ),
      ]),
    );
  }
}

class CostaGoEmptyState extends StatelessWidget {
  const CostaGoEmptyState({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
    this.action,
  });

  final IconData icon;
  final String title;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: CostaGoSpace.xl,
        vertical: CostaGoSpace.xxl,
      ),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        CostaGoIconBadge(icon: icon, size: 64),
        const SizedBox(height: CostaGoSpace.md),
        Text(title,
            textAlign: TextAlign.center, style: theme.textTheme.titleLarge),
        const SizedBox(height: CostaGoSpace.xs),
        Text(
          message,
          textAlign: TextAlign.center,
          style: theme.textTheme.bodyMedium
              ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
        if (action != null) ...[
          const SizedBox(height: CostaGoSpace.lg),
          action!,
        ],
      ]),
    );
  }
}
