import 'dart:async';

import 'package:flutter/material.dart';

class InAppNotificationBanner {
  static final Map<String, DateTime> _recent = <String, DateTime>{};
  static OverlayEntry? _current;

  static bool show(
    BuildContext context, {
    required String id,
    required String title,
    required String message,
    IconData icon = Icons.notifications_active_outlined,
    String actionLabel = 'Ver',
    VoidCallback? onTap,
    Duration duration = const Duration(seconds: 7),
  }) {
    final now = DateTime.now();
    _recent.removeWhere(
        (_, seenAt) => now.difference(seenAt) > const Duration(minutes: 2));
    final previous = _recent[id];
    if (previous != null &&
        now.difference(previous) < const Duration(seconds: 8)) {
      return false;
    }
    _recent[id] = now;
    _current?.remove();

    final overlay = Overlay.maybeOf(context, rootOverlay: true);
    if (overlay == null) return false;
    late final OverlayEntry entry;
    entry = OverlayEntry(
      builder: (_) => _AnimatedBanner(
        title: title,
        message: message,
        icon: icon,
        actionLabel: actionLabel,
        duration: duration,
        onTap: onTap,
        onDismiss: () {
          if (_current == entry) _current = null;
          entry.remove();
        },
      ),
    );
    _current = entry;
    overlay.insert(entry);
    return true;
  }
}

class _AnimatedBanner extends StatefulWidget {
  const _AnimatedBanner({
    required this.title,
    required this.message,
    required this.icon,
    required this.actionLabel,
    required this.duration,
    required this.onDismiss,
    this.onTap,
  });

  final String title;
  final String message;
  final IconData icon;
  final String actionLabel;
  final Duration duration;
  final VoidCallback onDismiss;
  final VoidCallback? onTap;

  @override
  State<_AnimatedBanner> createState() => _AnimatedBannerState();
}

class _AnimatedBannerState extends State<_AnimatedBanner>
    with SingleTickerProviderStateMixin {
  late final AnimationController controller;
  Timer? timer;

  @override
  void initState() {
    super.initState();
    controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 280),
      reverseDuration: const Duration(milliseconds: 200),
    )..forward();
    timer = Timer(widget.duration, dismiss);
  }

  Future<void> dismiss() async {
    timer?.cancel();
    if (!mounted) return;
    await controller.reverse();
    if (mounted) widget.onDismiss();
  }

  @override
  void dispose() {
    timer?.cancel();
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SafeArea(
      minimum: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      child: Align(
        alignment: Alignment.topCenter,
        child: SlideTransition(
          position: Tween(begin: const Offset(0, -1.2), end: Offset.zero)
              .animate(CurvedAnimation(
                  parent: controller, curve: Curves.easeOutCubic)),
          child: FadeTransition(
            opacity: controller,
            child: Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: () {
                  widget.onTap?.call();
                  dismiss();
                },
                borderRadius: BorderRadius.circular(22),
                child: Container(
                  constraints: const BoxConstraints(maxWidth: 520),
                  padding: const EdgeInsets.fromLTRB(16, 14, 12, 14),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surface,
                    borderRadius: BorderRadius.circular(22),
                    border: Border.all(
                        color:
                            theme.colorScheme.primary.withValues(alpha: .25)),
                    boxShadow: const [
                      BoxShadow(
                        color: Color(0x33000000),
                        blurRadius: 18,
                        offset: Offset(0, 7),
                      ),
                    ],
                  ),
                  child: Row(children: [
                    Stack(
                      clipBehavior: Clip.none,
                      children: [
                        Container(
                          width: 46,
                          height: 46,
                          padding: const EdgeInsets.all(7),
                          decoration: BoxDecoration(
                            color: const Color(0xFF003B64),
                            borderRadius: BorderRadius.circular(15),
                          ),
                          child: Image.asset(
                            'assets/images/costa-go-emblem.png',
                            fit: BoxFit.contain,
                          ),
                        ),
                        Positioned(
                          right: -4,
                          bottom: -4,
                          child: Container(
                            width: 22,
                            height: 22,
                            decoration: BoxDecoration(
                              color: theme.colorScheme.primary,
                              shape: BoxShape.circle,
                              border: Border.all(
                                  color: theme.colorScheme.surface, width: 2),
                            ),
                            child: Icon(widget.icon,
                                size: 12, color: theme.colorScheme.onPrimary),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(widget.title,
                              style: theme.textTheme.titleSmall
                                  ?.copyWith(fontWeight: FontWeight.w800)),
                          const SizedBox(height: 2),
                          Text(widget.message,
                              maxLines: 2, overflow: TextOverflow.ellipsis),
                        ],
                      ),
                    ),
                    if (widget.onTap != null)
                      TextButton(
                        onPressed: () {
                          widget.onTap?.call();
                          dismiss();
                        },
                        child: Text(widget.actionLabel),
                      )
                    else
                      IconButton(
                          onPressed: dismiss, icon: const Icon(Icons.close)),
                  ]),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
