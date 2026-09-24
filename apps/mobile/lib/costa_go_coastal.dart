import 'dart:math' as math;
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
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Icon(icon, color: Theme.of(context).colorScheme.primary),
          const SizedBox(width: 10),
          Expanded(
              child:
                  Text(title, style: Theme.of(context).textTheme.titleMedium))
        ]),
        const SizedBox(height: 14),
        child,
      ]));
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
    final colors = Theme.of(context).colorScheme;
    return Stack(children: [
      Positioned.fill(
          child: IgnorePointer(
              child: ExcludeSemantics(
                  child: RepaintBoundary(
                      child: CustomPaint(
                          painter: _CoastalPainter(
                              colors.primary,
                              intensity == CostaGoDecorationIntensity.medium
                                  ? .18
                                  : .075)))))),
      child,
    ]);
  }
}

class _CoastalPainter extends CustomPainter {
  const _CoastalPainter(this.color, this.opacity);
  final Color color;
  final double opacity;
  @override
  void paint(Canvas canvas, Size size) {
    final h = math.min(size.height * .24, 120.0), w = size.width;
    final paint = Paint()..color = color.withValues(alpha: opacity);
    for (var i = 0; i < 3; i++) {
      final y = size.height - h * (.35 + i * .22);
      final path = Path()
        ..moveTo(0, y)
        ..cubicTo(w * .3, y - h * .6, w * .5, y + h * .65, w, y - h * .1)
        ..lineTo(w, size.height)
        ..lineTo(0, size.height)
        ..close();
      canvas.drawPath(path, paint);
    }
    // Silhouettes stay at the lower corners, away from primary content.
    for (final side in [false, true]) {
      canvas.save();
      canvas.translate(side ? w : 0, size.height);
      if (side) canvas.scale(-1, 1);
      final trunk = Path()
        ..moveTo(22, 0)
        ..quadraticBezierTo(27, -h * .5, 40, -h * .82);
      canvas.drawPath(
          trunk,
          Paint()
            ..color = color.withValues(alpha: opacity)
            ..style = PaintingStyle.stroke
            ..strokeWidth = 4
            ..strokeCap = StrokeCap.round);
      for (var i = 0; i < 5; i++) {
        final angle = -math.pi + i * math.pi / 4;
        final end = Offset(
            40 + math.cos(angle) * 30, -h * .82 + math.sin(angle) * 14 + 12);
        canvas.drawPath(
            Path()
              ..moveTo(40, -h * .82)
              ..quadraticBezierTo(
                  (40 + end.dx) / 2, -h * .82 - 13, end.dx, end.dy),
            Paint()
              ..color = color.withValues(alpha: opacity)
              ..style = PaintingStyle.stroke
              ..strokeWidth = 5
              ..strokeCap = StrokeCap.round);
      }
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(_CoastalPainter old) =>
      color != old.color || opacity != old.opacity;
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
        borderRadius: const BorderRadius.vertical(top: Radius.circular(32)),
        clipBehavior: Clip.antiAlias,
        child: DecoratedBox(
            decoration: BoxDecoration(
                gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      c.surface.withValues(alpha: overMap ? .84 : 1.0),
                      c.primaryContainer.withValues(alpha: overMap ? .74 : 1.0)
                    ]),
                border: Border(
                    top: BorderSide(color: c.onPrimary.withValues(alpha: .4)))),
            child:
                CostaGoCoastalDecoration(intensity: decoration, child: child)));
  }
}

class CostaGoHomeHeader extends StatelessWidget {
  const CostaGoHomeHeader({super.key, this.request = false});
  final bool request;
  @override
  Widget build(BuildContext context) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 14),
      child: LayoutBuilder(
          builder: (context, box) => Row(children: [
                Image.asset('assets/images/costa-go-emblem.png',
                    width: 64, height: 64),
                const SizedBox(width: 12),
                Expanded(
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                      Text('Costa-Go',
                          style: Theme.of(context)
                              .textTheme
                              .headlineSmall
                              ?.copyWith(fontWeight: FontWeight.w900)),
                      Text(request ? 'Solicitar mototaxi' : 'Siempre contigo',
                          style: TextStyle(
                              color: Theme.of(context).colorScheme.primary,
                              fontWeight: FontWeight.w700)),
                    ])),
                if (box.maxWidth > 430 &&
                    MediaQuery.textScalerOf(context).scale(1) < 1.4)
                  SizedBox(
                      width: 130,
                      child: Text('Juntos llegamos más lejos',
                          textAlign: TextAlign.right,
                          style: TextStyle(
                              color: Theme.of(context).colorScheme.primary,
                              fontStyle: FontStyle.italic))),
              ])));
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
    return Material(
        color: c.surface.withValues(alpha: .96),
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(24),
            side: BorderSide(color: c.outlineVariant.withValues(alpha: .55))),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
            onTap: onTap,
            child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                              color: c.primaryContainer,
                              shape: BoxShape.circle),
                          child: officialVehicle
                              ? Image.asset('assets/images/costa-go-emblem.png',
                                  width: 28, height: 28)
                              : Icon(icon, color: c.primary, size: 28)),
                      const SizedBox(width: 10),
                      Expanded(
                          child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                            Text(title,
                                style: Theme.of(context)
                                    .textTheme
                                    .titleSmall
                                    ?.copyWith(fontWeight: FontWeight.w800)),
                            const SizedBox(height: 4),
                            Text(subtitle,
                                style: Theme.of(context)
                                    .textTheme
                                    .bodySmall
                                    ?.copyWith(color: c.onSurfaceVariant)),
                          ])),
                    ]))));
  }
}
