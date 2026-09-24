import 'dart:ui' as ui;
import 'package:flutter/material.dart';

enum CostaGoDecorationIntensity { none, subtle, medium }

Future<T?> showCostaGoModalBottomSheet<T>({
  required BuildContext context,
  required WidgetBuilder builder,
  bool isScrollControlled = false,
  bool useSafeArea = false,
  bool? showDragHandle,
  bool isDismissible = true,
  bool enableDrag = true,
  bool useRootNavigator = false,
  Color? backgroundColor,
  Color? barrierColor,
  BoxConstraints? constraints,
  ShapeBorder? shape,
  Clip? clipBehavior,
  RouteSettings? routeSettings,
  double? elevation,
  AnimationController? transitionAnimationController,
}) =>
    showModalBottomSheet<T>(
        context: context,
        isScrollControlled: isScrollControlled,
        useSafeArea: useSafeArea,
        showDragHandle: showDragHandle,
        isDismissible: isDismissible,
        enableDrag: enableDrag,
        useRootNavigator: useRootNavigator,
        backgroundColor: backgroundColor ?? Colors.transparent,
        barrierColor: barrierColor,
        constraints: constraints,
        shape: shape,
        clipBehavior: clipBehavior,
        routeSettings: routeSettings,
        elevation: elevation,
        transitionAnimationController: transitionAnimationController,
        builder: (c) => CostaGoGlassSheet(child: builder(c)));

class CostaGoAccountTile extends StatelessWidget {
  const CostaGoAccountTile(
      {super.key,
      required this.icon,
      required this.title,
      required this.subtitle,
      this.onTap,
      this.trailing,
      this.accent});
  final IconData icon;
  final String title, subtitle;
  final VoidCallback? onTap;
  final Widget? trailing;
  final Color? accent;
  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    return Material(
        color: c.surface.withValues(alpha: .72),
        child: Column(children: [
          ListTile(
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              leading: CircleAvatar(
                  backgroundColor: (accent ?? c.primary).withValues(alpha: .1),
                  child: Icon(icon, color: accent ?? c.primary)),
              title: Text(title,
                  style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text(subtitle),
              trailing: trailing ?? const Icon(Icons.chevron_right),
              onTap: onTap),
          Padding(
              padding: const EdgeInsets.only(left: 68),
              child: Divider(
                  height: 1, color: c.outlineVariant.withValues(alpha: .4))),
        ]));
  }
}

class CostaGoFormSection extends StatelessWidget {
  const CostaGoFormSection(
      {super.key,
      required this.title,
      required this.icon,
      required this.child});
  final String title;
  final IconData icon;
  final Widget child;
  @override
  Widget build(BuildContext context) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: CostaGoCard(
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Icon(icon, color: Theme.of(context).colorScheme.primary),
          const SizedBox(width: 10),
          Expanded(
              child:
                  Text(title, style: Theme.of(context).textTheme.titleMedium))
        ]),
        const SizedBox(height: 14),
        child,
      ])));
}

/// Static, non-interactive scenery. No seasonal state or campaign inference.
class CostaGoCoastalDecoration extends StatelessWidget {
  const CostaGoCoastalDecoration(
      {super.key,
      required this.child,
      this.intensity = CostaGoDecorationIntensity.subtle});
  final Widget child;
  final CostaGoDecorationIntensity intensity;
  @override
  Widget build(BuildContext context) {
    if (intensity == CostaGoDecorationIntensity.none) return child;
    return Stack(children: [
      Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: IgnorePointer(
              child: ExcludeSemantics(
                  child: Opacity(
            opacity: intensity == CostaGoDecorationIntensity.medium ? .38 : .17,
            child: ShaderMask(
              blendMode: BlendMode.dstIn,
              shaderCallback: (bounds) => const LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Colors.transparent,
                  Color(0x18FFFFFF),
                  Color(0x99FFFFFF),
                  Colors.white,
                ],
                stops: [0, .36, .66, 1],
              ).createShader(bounds),
              // Filter only the decorative layer: text and controls stay sharp.
              child: ImageFiltered(
                imageFilter: ui.ImageFilter.blur(sigmaX: .5, sigmaY: .5),
                child: ColorFiltered(
                  // 45% saturation, 85% contrast: midway between earlier treatments.
                  colorFilter: const ColorFilter.matrix([
                    .4819,
                    .3344,
                    .0337,
                    0,
                    24,
                    .0994,
                    .7169,
                    .0337,
                    0,
                    30,
                    .0994,
                    .3344,
                    .4162,
                    0,
                    36,
                    0,
                    0,
                    0,
                    1,
                    0,
                  ]),
                  child: Image.asset('assets/images/coastal-landscape.png',
                      fit: BoxFit.fitWidth),
                ),
              ),
            ),
          )))),
      child,
    ]);
  }
}

/// Shared page shell; business widgets and navigation remain unchanged.
class CostaGoScaffold extends StatelessWidget {
  const CostaGoScaffold(
      {super.key,
      this.appBar,
      this.body,
      this.backgroundColor,
      this.floatingActionButton,
      this.bottomNavigationBar,
      this.bottomSheet,
      this.resizeToAvoidBottomInset,
      this.extendBodyBehindAppBar = false,
      this.extendBody = false,
      this.floatingActionButtonLocation,
      this.decoration = CostaGoDecorationIntensity.subtle});
  final PreferredSizeWidget? appBar;
  final Widget? body, floatingActionButton, bottomNavigationBar, bottomSheet;
  final Color? backgroundColor;
  final bool? resizeToAvoidBottomInset;
  final bool extendBodyBehindAppBar, extendBody;
  final FloatingActionButtonLocation? floatingActionButtonLocation;
  final CostaGoDecorationIntensity decoration;
  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: appBar,
      backgroundColor: backgroundColor,
      floatingActionButton: floatingActionButton,
      floatingActionButtonLocation: floatingActionButtonLocation,
      bottomNavigationBar: bottomNavigationBar,
      bottomSheet: bottomSheet,
      resizeToAvoidBottomInset: resizeToAvoidBottomInset,
      extendBodyBehindAppBar: extendBodyBehindAppBar,
      extendBody: extendBody,
      body: body == null
          ? null
          : CostaGoCoastalDecoration(
              intensity: decoration, child: SizedBox.expand(child: body)));
}

class CostaGoGlassSheet extends StatelessWidget {
  const CostaGoGlassSheet(
      {super.key,
      required this.child,
      this.overMap = false,
      this.decoration = CostaGoDecorationIntensity.subtle});
  final Widget child;
  final bool overMap;
  final CostaGoDecorationIntensity decoration;
  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    return Material(
        color: Colors.transparent,
        elevation: 10,
        shadowColor: c.shadow.withValues(alpha: .16),
        borderRadius: const BorderRadius.vertical(top: Radius.circular(36)),
        clipBehavior: Clip.antiAlias,
        child: BackdropFilter(
            enabled: overMap,
            filter: ui.ImageFilter.blur(sigmaX: 8, sigmaY: 8),
            child: DecoratedBox(
                decoration: BoxDecoration(
                    gradient: LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [
                          c.surface.withValues(alpha: overMap ? .72 : 1.0),
                          c.primaryContainer
                              .withValues(alpha: overMap ? .62 : 1.0)
                        ]),
                    border: Border(
                        top: BorderSide(
                            color: c.onPrimary.withValues(alpha: .4)))),
                child: CostaGoCoastalDecoration(
                    intensity: decoration, child: child))));
  }
}

class CostaGoHomeHeader extends StatelessWidget {
  const CostaGoHomeHeader({super.key, this.request = false});
  final bool request;
  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    final brand = Row(children: [
      Image.asset('assets/images/costa-go-emblem.png', width: 64, height: 76),
      const SizedBox(width: 7),
      Flexible(
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text.rich(
            TextSpan(children: [
              const TextSpan(text: 'Costa-'),
              TextSpan(text: 'Go', style: TextStyle(color: c.primary))
            ]),
            style: TextStyle(
                fontSize: 26,
                fontWeight: FontWeight.w900,
                color: c.onSurface,
                letterSpacing: -1)),
        Text(request ? 'Solicitar mototaxi' : 'Siempre contigo',
            style: TextStyle(
                fontSize: 13, color: c.primary, fontWeight: FontWeight.w700)),
      ])),
    ]);
    final slogan = Semantics(
        label: 'Juntos llegamos más lejos',
        image: true,
        child: ExcludeSemantics(
            child: Align(
                alignment: Alignment.centerRight,
                child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 170),
                    child: ColorFiltered(
                      // Display the supplied artwork itself. Knock out its pale backdrop
                      // using blue/red separation; no replacement font or redrawn strokes.
                      colorFilter: const ColorFilter.matrix([
                        0,
                        0,
                        0,
                        0,
                        0,
                        0,
                        0,
                        0,
                        0,
                        153,
                        0,
                        0,
                        0,
                        0,
                        255,
                        -3,
                        0,
                        3,
                        0,
                        -300,
                      ]),
                      child: Image.asset(
                          'assets/images/costa-go-slogan-reference.png',
                          fit: BoxFit.contain,
                          filterQuality: FilterQuality.high),
                    )))));
    return Padding(
        padding: const EdgeInsets.symmetric(vertical: 18),
        child: LayoutBuilder(builder: (context, box) {
          if (box.maxWidth < 320 ||
              MediaQuery.textScalerOf(context).scale(1) > 1.3) {
            return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [brand, const SizedBox(height: 8), slogan]);
          }
          return Row(children: [
            Expanded(flex: 2, child: brand),
            const SizedBox(width: 8),
            Expanded(child: slogan)
          ]);
        }));
  }
}

/// Shared tonal surface for forms and navigation cards.
class CostaGoCard extends StatelessWidget {
  const CostaGoCard(
      {super.key,
      required this.child,
      this.padding = const EdgeInsets.all(16),
      this.onTap,
      this.backgroundColor,
      this.borderColor});
  final Color? backgroundColor, borderColor;
  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    return Container(
        decoration:
            BoxDecoration(borderRadius: BorderRadius.circular(24), boxShadow: [
          BoxShadow(
              color: c.primary.withValues(alpha: .07),
              blurRadius: 20,
              offset: const Offset(0, 6))
        ]),
        child: Material(
            color: backgroundColor ?? c.surface.withValues(alpha: .94),
            shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(24),
                side: BorderSide(
                    color: borderColor ??
                        c.outlineVariant.withValues(alpha: .45))),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
                onTap: onTap, child: Padding(padding: padding, child: child))));
  }
}

class CostaGoQuickActionGrid extends StatelessWidget {
  const CostaGoQuickActionGrid({super.key, required this.children});
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, box) {
        final single = box.maxWidth < 340 ||
            MediaQuery.textScalerOf(context).scale(1) > 1.3;
        return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (var i = 0; i < children.length; i += single ? 1 : 2) ...[
                if (i > 0) const SizedBox(height: 10),
                if (single)
                  children[i]
                else
                  IntrinsicHeight(
                      child: Row(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                        Expanded(child: children[i]),
                        const SizedBox(width: 10),
                        Expanded(
                            child: i + 1 < children.length
                                ? children[i + 1]
                                : const SizedBox.shrink()),
                      ])),
              ],
            ]);
      });
}

class CostaGoQuickActionCard extends StatelessWidget {
  const CostaGoQuickActionCard(
      {super.key,
      required this.title,
      required this.subtitle,
      required this.icon,
      required this.onTap,
      this.officialVehicle = false});
  final String title, subtitle;
  final IconData icon;
  final VoidCallback onTap;
  final bool officialVehicle;
  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    return CostaGoCard(
        onTap: onTap,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 16),
        child: Row(children: [
          Container(
              width: 40,
              height: 48,
              decoration: BoxDecoration(
                  color: c.primaryContainer.withValues(alpha: .7),
                  shape: BoxShape.circle),
              child: Icon(icon, size: 29, color: c.primary)),
          const SizedBox(width: 8),
          Expanded(
              child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                Text(title,
                    style: TextStyle(
                        fontSize: 14,
                        height: 1.2,
                        fontWeight: FontWeight.w800,
                        color: c.onSurface)),
                const SizedBox(height: 5),
                Text(subtitle,
                    style: TextStyle(
                        fontSize: 12, height: 1.3, color: c.onSurfaceVariant)),
              ])),
          const SizedBox(width: 2),
          Icon(Icons.chevron_right_rounded,
              size: 18, color: c.onSurfaceVariant),
        ]));
  }
}

class CostaGoAuthBackground extends StatelessWidget {
  const CostaGoAuthBackground({super.key, required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    return Stack(fit: StackFit.expand, children: [
      Image.asset('assets/images/atacames-login-hero.png', fit: BoxFit.cover),
      DecoratedBox(
          decoration: BoxDecoration(
              gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
            const Color(0xff032d50).withValues(alpha: .4),
            c.surface.withValues(alpha: .72)
          ]))),
      CostaGoCoastalDecoration(
          intensity: CostaGoDecorationIntensity.medium, child: child),
    ]);
  }
}

/// Login uses a stronger glass treatment than dense financial forms.
class CostaGoAuthSurface extends StatelessWidget {
  const CostaGoAuthSurface({super.key, required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    return Container(
        decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(32),
            gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  c.surface.withValues(alpha: .88),
                  c.primaryContainer.withValues(alpha: .78)
                ]),
            border: Border.all(color: Colors.white.withValues(alpha: .45)),
            boxShadow: [
              BoxShadow(
                  color: Colors.black.withValues(alpha: .16),
                  blurRadius: 30,
                  offset: const Offset(0, 12))
            ]),
        child: child);
  }
}
