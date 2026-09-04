import 'package:flutter/material.dart';

import 'costa_go_design.dart';

Future<bool> showFiscalProfileModal(BuildContext context,
    {required Future<dynamic> Function() load,
    required Future<dynamic> Function(Map<String, dynamic>) save}) async {
  return await showModalBottomSheet<bool>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        isDismissible: false,
        enableDrag: false,
        builder: (_) => FiscalProfileModal(load: load, save: save),
      ) ??
      false;
}

class FiscalProfileModal extends StatefulWidget {
  const FiscalProfileModal({super.key, required this.load, required this.save});
  final Future<dynamic> Function() load;
  final Future<dynamic> Function(Map<String, dynamic>) save;
  @override
  State<FiscalProfileModal> createState() => _FiscalProfileModalState();
}

class _FiscalProfileModalState extends State<FiscalProfileModal> {
  final form = GlobalKey<FormState>();
  final fields = <String, TextEditingController>{
    for (final name in [
      'identification',
      'legalName',
      'address',
      'billingEmail'
    ])
      name: TextEditingController()
  };
  Map<String, dynamic>? profile;
  String type = 'CEDULA';
  bool loading = true, saving = false, editing = false;
  String? error;
  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final c in fields.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final data = await widget.load();
      if (!mounted) return;
      final value = data['profile'];
      profile = value is Map ? Map<String, dynamic>.from(value) : null;
      final prefill =
          profile ?? (data['prefill'] is Map ? data['prefill'] as Map : {});
      type = profile?['identificationType']?.toString() ?? 'CEDULA';
      for (final entry in fields.entries) {
        entry.value.text = prefill[entry.key]?.toString() ?? '';
      }
      editing = profile == null;
    } catch (_) {
      if (mounted) {
        error = 'No pudimos consultar tus datos. Intenta nuevamente.';
      }
    } finally {
      if (mounted) {
        setState(() => loading = false);
      }
    }
  }

  Future<void> _save() async {
    if (saving || !form.currentState!.validate()) return;
    setState(() {
      saving = true;
      error = null;
    });
    try {
      final result = await widget.save({
        'identificationType': type,
        for (final e in fields.entries) e.key: e.value.text.trim(),
        'expectedRevision': profile?['revision'] ?? 0,
      });
      if (!mounted) return;
      setState(() {
        profile = Map<String, dynamic>.from(result['profile'] as Map);
        editing = false;
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Datos guardados correctamente.')),
        );
      }
    } catch (_) {
      if (mounted) {
        setState(() => error =
            'No se guardaron los datos. Revisa los campos o pulsa Actualizar si fueron modificados en otra sesión.');
      }
    } finally {
      if (mounted) {
        setState(() => saving = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return PopScope(
      canPop: !saving,
      child: Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: SizedBox(
          height: (MediaQuery.sizeOf(context).height -
                  MediaQuery.viewInsetsOf(context).bottom) *
              .94,
          child: SingleChildScrollView(
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            padding: const EdgeInsets.fromLTRB(
              CostaGoSpace.lg,
              0,
              CostaGoSpace.lg,
              CostaGoSpace.xl,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const CostaGoSheetHandle(),
                CostaGoSheetHeader(
                  icon: Icons.receipt_long_outlined,
                  title: 'Datos de facturación',
                  subtitle: editing
                      ? 'Registra estos datos una sola vez. Los utilizaremos para tus futuros comprobantes.'
                      : 'Usaremos estos datos para tus comprobantes.',
                  onClose: saving ? null : () => Navigator.pop(context, false),
                ),
                const SizedBox(height: CostaGoSpace.lg),
                if (loading)
                  const Padding(
                    padding: EdgeInsets.all(CostaGoSpace.xxl),
                    child: Center(child: CircularProgressIndicator()),
                  ),
                if (error != null) ...[
                  CostaGoInfoBanner(
                    title: 'No pudimos cargar la información',
                    message: error!,
                    icon: Icons.error_outline_rounded,
                    tone: CostaGoStatusTone.danger,
                  ),
                  const SizedBox(height: CostaGoSpace.sm),
                  OutlinedButton.icon(
                    onPressed: saving ? null : _load,
                    icon: const Icon(Icons.refresh_rounded),
                    label: const Text('Actualizar'),
                  ),
                ],
                if (!loading && editing) ...[
                  Form(
                    key: form,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        DropdownButtonFormField<String>(
                          initialValue: type,
                          decoration: const InputDecoration(
                            labelText: 'Tipo de identificación',
                            prefixIcon: Icon(Icons.badge_outlined),
                          ),
                          items: const [
                            DropdownMenuItem(
                              value: 'CEDULA',
                              child: Text('Cédula'),
                            ),
                            DropdownMenuItem(value: 'RUC', child: Text('RUC')),
                          ],
                          onChanged:
                              saving ? null : (v) => setState(() => type = v!),
                        ),
                        const SizedBox(height: CostaGoSpace.sm),
                        ...fields.entries.map(
                          (entry) => Padding(
                            padding:
                                const EdgeInsets.only(bottom: CostaGoSpace.sm),
                            child: TextFormField(
                              controller: entry.value,
                              enabled: !saving,
                              textInputAction: entry.key == 'billingEmail'
                                  ? TextInputAction.done
                                  : TextInputAction.next,
                              keyboardType: entry.key == 'identification'
                                  ? TextInputType.number
                                  : entry.key == 'billingEmail'
                                      ? TextInputType.emailAddress
                                      : TextInputType.text,
                              decoration: InputDecoration(
                                labelText: {
                                  'identification': 'Número de identificación',
                                  'legalName': 'Nombres / Razón social',
                                  'address': 'Dirección',
                                  'billingEmail': 'Correo para facturación',
                                }[entry.key],
                                prefixIcon: Icon({
                                  'identification': Icons.badge_outlined,
                                  'legalName': Icons.person_outline_rounded,
                                  'address': Icons.location_on_outlined,
                                  'billingEmail': Icons.mail_outline_rounded,
                                }[entry.key]),
                              ),
                              validator: (raw) {
                                final value = raw?.trim() ?? '';
                                if (value.isEmpty) {
                                  return 'Completa este campo.';
                                }
                                if (entry.key == 'identification' &&
                                    !RegExp(type == 'RUC'
                                            ? r'^\d{13}$'
                                            : r'^\d{10}$')
                                        .hasMatch(value)) {
                                  return type == 'RUC'
                                      ? 'Ingresa 13 dígitos.'
                                      : 'Ingresa 10 dígitos.';
                                }
                                if (entry.key == 'billingEmail' &&
                                    !RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
                                        .hasMatch(value)) {
                                  return 'Ingresa un correo válido.';
                                }
                                if (entry.key == 'legalName' &&
                                        value.length < 3 ||
                                    entry.key == 'address' &&
                                        value.length < 5) {
                                  return 'Completa la información.';
                                }
                                return null;
                              },
                            ),
                          ),
                        ),
                        const CostaGoInfoBanner(
                          title: 'Tu información está segura',
                          message:
                              'Usaremos estos datos únicamente para facturación.',
                          icon: Icons.verified_user_outlined,
                        ),
                        const SizedBox(height: CostaGoSpace.md),
                        FilledButton.icon(
                          onPressed: saving ? null : _save,
                          icon: saving
                              ? const SizedBox.square(
                                  dimension: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Icon(Icons.lock_outline_rounded),
                          label: Text(
                            saving ? 'Guardando…' : 'Guardar y continuar',
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
                if (!loading && !editing && profile != null) ...[
                  CostaGoSurface(
                    padding: const EdgeInsets.all(CostaGoSpace.md),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(children: [
                          const CostaGoIconBadge(
                            icon: Icons.person_outline_rounded,
                            size: 52,
                          ),
                          const SizedBox(width: CostaGoSpace.sm),
                          Expanded(
                            child: Text(
                              '${profile!['legalName']}',
                              style: theme.textTheme.titleLarge,
                            ),
                          ),
                        ]),
                        const Divider(),
                        CostaGoDetailRow(
                          icon: Icons.badge_outlined,
                          label: profile!['identificationType'] == 'RUC'
                              ? 'RUC'
                              : 'Cédula',
                          value: '${profile!['identification']}',
                        ),
                        CostaGoDetailRow(
                          icon: Icons.mail_outline_rounded,
                          label: 'Correo electrónico',
                          value: '${profile!['billingEmail']}',
                        ),
                        CostaGoDetailRow(
                          icon: Icons.location_on_outlined,
                          label: 'Dirección',
                          value: '${profile!['address']}',
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: CostaGoSpace.md),
                  const CostaGoInfoBanner(
                    title: 'Información protegida',
                    message:
                        'Se utilizará únicamente para la emisión de comprobantes.',
                    icon: Icons.shield_outlined,
                  ),
                  const SizedBox(height: CostaGoSpace.md),
                  LayoutBuilder(
                    builder: (context, constraints) {
                      final scale = MediaQuery.textScalerOf(context).scale(1);
                      final stacked =
                          constraints.maxWidth < 350 || scale > 1.15;
                      final edit = OutlinedButton.icon(
                        onPressed: () => setState(() => editing = true),
                        icon: const Icon(Icons.edit_outlined),
                        label: const Text('Editar datos'),
                      );
                      final next = FilledButton.icon(
                        onPressed: () => Navigator.pop(context, true),
                        icon: const Icon(Icons.arrow_forward_rounded),
                        iconAlignment: IconAlignment.end,
                        label: const Text('Continuar'),
                      );
                      if (stacked) {
                        return Column(children: [
                          SizedBox(width: double.infinity, child: next),
                          const SizedBox(height: CostaGoSpace.xs),
                          SizedBox(width: double.infinity, child: edit),
                        ]);
                      }
                      return Row(children: [
                        Expanded(child: edit),
                        const SizedBox(width: CostaGoSpace.sm),
                        Expanded(child: next),
                      ]);
                    },
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
