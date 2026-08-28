import 'package:flutter/material.dart';

enum CancellationFeedback { success, warning, suspended }

/// Presentation only; callers keep the existing cancellation and support flows.
class CancellationFeedbackDialog extends StatelessWidget {
  const CancellationFeedbackDialog(
      {super.key,
      required this.kind,
      this.suspensionEndLabel,
      this.indefinite = false,
      this.onSupport});
  final CancellationFeedback kind;
  final String? suspensionEndLabel;
  final bool indefinite;
  final VoidCallback? onSupport;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context), colors = theme.colorScheme;
    final suspended = kind == CancellationFeedback.suspended;
    final success = kind == CancellationFeedback.success;
    // Semantic success/warning tones follow the active theme's brightness.
    final accent = success
        ? (theme.brightness == Brightness.dark
            ? Colors.green.shade300
            : Colors.green.shade700)
        : (theme.brightness == Brightness.dark
            ? Colors.orange.shade300
            : Colors.deepOrange.shade700);
    final until = suspensionEndLabel;
    return Dialog(
        backgroundColor: colors.surface,
        surfaceTintColor: colors.surface,
        insetPadding: const EdgeInsets.all(24),
        clipBehavior: Clip.antiAlias,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
        child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 390),
            child: SingleChildScrollView(
                child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Center(
                              child: Container(
                                  width: 64,
                                  height: 64,
                                  alignment: Alignment.center,
                                  decoration: BoxDecoration(
                                      shape: BoxShape.circle,
                                      color: accent.withValues(alpha: .1),
                                      border: Border.all(
                                          color:
                                              accent.withValues(alpha: .22))),
                                  child: Icon(
                                      success
                                          ? Icons.check_rounded
                                          : Icons.warning_amber_rounded,
                                      color: accent,
                                      size: 34))),
                          const SizedBox(height: 18),
                          Text(
                              suspended
                                  ? 'Cuenta suspendida'
                                  : 'Carrera cancelada',
                              textAlign: TextAlign.center,
                              style: theme.textTheme.titleLarge?.copyWith(
                                  color: colors.onSurface,
                                  fontWeight: FontWeight.w800)),
                          const SizedBox(height: 12),
                          Text(
                              success
                                  ? 'Solicitud cancelada correctamente.'
                                  : suspended
                                      ? 'Tu cuenta está suspendida por cancelaciones después de que un conductor aceptó la carrera.'
                                      : 'La cancelación quedó registrada. Evita cancelar después de que un conductor acepte.',
                              textAlign: TextAlign.center,
                              style: theme.textTheme.bodyMedium?.copyWith(
                                  color: colors.onSurfaceVariant, height: 1.5)),
                          if (suspended) ...[
                            const SizedBox(height: 16),
                            Container(
                                padding: const EdgeInsets.all(14),
                                decoration: BoxDecoration(
                                    color: colors.surfaceContainerHighest,
                                    borderRadius: BorderRadius.circular(16)),
                                child: Column(children: [
                                  Text(
                                      indefinite
                                          ? 'Suspensión indefinida'
                                          : until != null
                                              ? 'Podrás volver a solicitar viajes'
                                              : 'Suspensión vigente',
                                      textAlign: TextAlign.center,
                                      style: theme.textTheme.labelLarge
                                          ?.copyWith(color: colors.onSurface)),
                                  const SizedBox(height: 6),
                                  Text(
                                      indefinite
                                          ? 'Solo administración puede reactivar tu cuenta.'
                                          : until != null
                                              ? '$until (hora de Ecuador)'
                                              : 'Contacta a soporte para consultar la fecha de finalización.',
                                      textAlign: TextAlign.center,
                                      style: theme.textTheme.bodyMedium
                                          ?.copyWith(
                                              color: colors.onSurfaceVariant,
                                              height: 1.4)),
                                ])),
                            const SizedBox(height: 12),
                            Text(
                                'Tu cuenta y tu historial se conservan. Puedes contactar a soporte.',
                                textAlign: TextAlign.center,
                                style: theme.textTheme.bodySmall
                                    ?.copyWith(color: colors.onSurfaceVariant)),
                          ],
                          const SizedBox(height: 22),
                          FilledButton(
                              onPressed: () => Navigator.pop(context),
                              style: FilledButton.styleFrom(
                                  backgroundColor: colors.primary,
                                  foregroundColor: colors.onPrimary,
                                  minimumSize: const Size(0, 48),
                                  shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(16))),
                              child: const Text('OK')),
                          if (onSupport != null) ...[
                            const SizedBox(height: 8),
                            TextButton.icon(
                                onPressed: onSupport,
                                icon: const Icon(Icons.support_agent_rounded),
                                label: const Text('Contactar soporte'))
                          ],
                        ])))));
  }
}
