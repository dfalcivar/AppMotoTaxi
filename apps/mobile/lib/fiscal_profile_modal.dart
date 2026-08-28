import 'package:flutter/material.dart';

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
  String? error, notice;
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
        notice = 'Datos guardados correctamente.';
      });
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
    final theme = Theme.of(context), colors = theme.colorScheme;
    return PopScope(
        canPop: !saving,
        child: Padding(
          padding:
              EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
          child: ConstrainedBox(
            constraints: BoxConstraints(
                maxHeight: MediaQuery.sizeOf(context).height * .9),
            child: SingleChildScrollView(
                padding: const EdgeInsets.all(22),
                child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(children: [
                        Container(
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(
                                color: colors.primaryContainer,
                                borderRadius: BorderRadius.circular(14)),
                            child: Icon(Icons.receipt_long_outlined,
                                color: colors.onPrimaryContainer)),
                        const SizedBox(width: 10),
                        Expanded(
                            child: Text('Datos de facturación',
                                style: theme.textTheme.titleLarge
                                    ?.copyWith(fontWeight: FontWeight.w800))),
                        IconButton(
                            tooltip: 'Volver',
                            onPressed: saving
                                ? null
                                : () => Navigator.pop(context, false),
                            icon: const Icon(Icons.close_rounded))
                      ]),
                      const SizedBox(height: 14),
                      Text(
                          'Registra estos datos una sola vez. Los utilizaremos para tus futuros comprobantes.',
                          style: theme.textTheme.bodyMedium
                              ?.copyWith(color: colors.onSurfaceVariant)),
                      const SizedBox(height: 16),
                      if (loading)
                        const Center(child: CircularProgressIndicator()),
                      if (error != null) ...[
                        Text(error!, style: TextStyle(color: colors.error)),
                        TextButton(
                            onPressed: saving ? null : _load,
                            child: const Text('Actualizar'))
                      ],
                      if (notice != null)
                        Text('✓ $notice',
                            style: TextStyle(color: colors.primary)),
                      if (!loading && editing)
                        Form(
                            key: form,
                            child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  DropdownButtonFormField<String>(
                                      initialValue: type,
                                      decoration: const InputDecoration(
                                          labelText: 'Tipo de identificación'),
                                      items: const [
                                        DropdownMenuItem(
                                            value: 'CEDULA',
                                            child: Text('Cédula')),
                                        DropdownMenuItem(
                                            value: 'RUC', child: Text('RUC'))
                                      ],
                                      onChanged: saving
                                          ? null
                                          : (v) => setState(() => type = v!)),
                                  const SizedBox(height: 12),
                                  ...fields.entries.map((e) => Padding(
                                      padding:
                                          const EdgeInsets.only(bottom: 12),
                                      child: TextFormField(
                                        controller: e.value,
                                        enabled: !saving,
                                        textInputAction: e.key == 'billingEmail'
                                            ? TextInputAction.done
                                            : TextInputAction.next,
                                        keyboardType: e.key == 'identification'
                                            ? TextInputType.number
                                            : e.key == 'billingEmail'
                                                ? TextInputType.emailAddress
                                                : TextInputType.text,
                                        decoration: InputDecoration(
                                            labelText: {
                                          'identification':
                                              'Número de identificación',
                                          'legalName': 'Nombres / Razón social',
                                          'address': 'Dirección',
                                          'billingEmail':
                                              'Correo para facturación'
                                        }[e.key]),
                                        validator: (raw) {
                                          final v = raw?.trim() ?? '';
                                          if (v.isEmpty) {
                                            return 'Completa este campo.';
                                          }
                                          if (e.key == 'identification' &&
                                              !RegExp(type == 'RUC'
                                                      ? r'^\d{13}$'
                                                      : r'^\d{10}$')
                                                  .hasMatch(v)) {
                                            return type == 'RUC'
                                                ? 'Ingresa 13 dígitos.'
                                                : 'Ingresa 10 dígitos.';
                                          }
                                          if (e.key == 'billingEmail' &&
                                              !RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
                                                  .hasMatch(v)) {
                                            return 'Ingresa un correo válido.';
                                          }
                                          if (e.key == 'legalName' &&
                                                  v.length < 3 ||
                                              e.key == 'address' &&
                                                  v.length < 5) {
                                            return 'Completa la información.';
                                          }
                                          return null;
                                        },
                                      ))),
                                  FilledButton(
                                      onPressed: saving ? null : _save,
                                      child: Text(saving
                                          ? 'Guardando…'
                                          : 'Guardar y continuar')),
                                ])),
                      if (!loading && !editing && profile != null) ...[
                        Container(
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                                color: colors.surfaceContainerHighest,
                                borderRadius: BorderRadius.circular(16)),
                            child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text('✓ Datos registrados',
                                      style: TextStyle(
                                          color: colors.primary,
                                          fontWeight: FontWeight.w700)),
                                  const SizedBox(height: 12),
                                  Text('${profile!['legalName']}',
                                      style: theme.textTheme.titleMedium),
                                  const SizedBox(height: 6),
                                  Text(
                                      '${profile!['identificationType'] == 'RUC' ? 'RUC' : 'C.I.'} ${profile!['identification']}'),
                                  Text('${profile!['billingEmail']}'),
                                  Text('${profile!['address']}')
                                ])),
                        const SizedBox(height: 16),
                        Row(children: [
                          Expanded(
                              child: OutlinedButton(
                                  onPressed: () => setState(() {
                                        editing = true;
                                        notice = null;
                                      }),
                                  child: const Text('Modificar'))),
                          const SizedBox(width: 10),
                          Expanded(
                              child: FilledButton(
                                  onPressed: () => Navigator.pop(context, true),
                                  child: const Text('Continuar')))
                        ]),
                      ],
                    ])),
          ),
        ));
  }
}
