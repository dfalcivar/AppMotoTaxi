import 'package:flutter/material.dart';

/// Authenticated transport supplied by the session. Amounts and dates are server-owned.
class CostaGoBenefitsService {
  const CostaGoBenefitsService({required this.read, required this.claim});
  final Future<Map<String, dynamic>> Function(String code, String campaignId)
      read;
  final Future<Map<String, dynamic>> Function(String code, String campaignId)
      claim;
}

class CostaGoBenefitPanel extends StatefulWidget {
  const CostaGoBenefitPanel(
      {super.key,
      required this.service,
      required this.code,
      required this.campaignId,
      this.actionLabel = 'Activar cortesía'});
  final CostaGoBenefitsService service;
  final String code;
  final String campaignId;
  final String actionLabel;
  @override
  State<CostaGoBenefitPanel> createState() => _CostaGoBenefitPanelState();
}

class _CostaGoBenefitPanelState extends State<CostaGoBenefitPanel> {
  Map<String, dynamic>? data;
  bool busy = false;
  String? error;
  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  void didUpdateWidget(CostaGoBenefitPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.code != widget.code ||
        oldWidget.campaignId != widget.campaignId ||
        oldWidget.service != widget.service) {
      data = null;
      load();
    }
  }

  Future<void> load() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final result = await widget.service.read(widget.code, widget.campaignId);
      if (mounted) setState(() => data = result);
    } catch (_) {
      if (mounted) {
        setState(() => error =
            'No pudimos consultar tu beneficio. Actualiza para intentarlo nuevamente.');
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> claimBenefit() async {
    if (busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final result = await widget.service.claim(widget.code, widget.campaignId);
      if (mounted) {
        setState(() => data = {...result, 'state': 'ALREADY_REDEEMED'});
      }
    } catch (e) {
      // Reload authoritative state after duplicate requests or a lost response.
      try {
        final result =
            await widget.service.read(widget.code, widget.campaignId);
        if (mounted) setState(() => data = result);
      } catch (_) {}
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  String date(dynamic value) {
    final d = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
    return d == null
        ? '—'
        : '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year} ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final benefit = data?['benefit'] as Map?;
    final grant = data?['redemption'] as Map?;
    final state = data?['state'];
    return Card(
        child: Padding(
            padding: const EdgeInsets.all(16),
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Tu beneficio',
                  style: Theme.of(context).textTheme.titleLarge),
              if (busy) const LinearProgressIndicator(),
              if (benefit != null) ...[
                const SizedBox(height: 8),
                Text(benefit['name'].toString(),
                    style: Theme.of(context).textTheme.titleMedium),
                Text(benefit['description']?.toString() ?? ''),
                if (benefit['benefitType'] == 'COURTESY_DAYS')
                  Text('${benefit['value']} días de membresía gratis'),
                if (benefit['oneTime'] == true)
                  const Text('Disponible una sola vez por usuario.'),
              ],
              if (grant != null) ...[
                const SizedBox(height: 12),
                Text(switch (grant['status']) {
                  'PENDING' => 'Cortesía programada',
                  'ACTIVE' => '¡Beneficio activado!',
                  'EXPIRED' => 'Beneficio vencido',
                  _ => 'Beneficio registrado'
                }),
                Text(
                    'Desde: ${date(grant['effectiveFrom'])}\nHasta: ${date(grant['effectiveUntil'])} (hora local)'),
              ],
              if (state == 'AVAILABLE' && widget.actionLabel.isNotEmpty)
                Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: FilledButton(
                        onPressed: busy ? null : claimBenefit,
                        child: Text(widget.actionLabel)))
              else if (grant == null && data != null)
                Text(data?['message']?.toString() ??
                    'Este beneficio no está disponible.'),
              if (error != null)
                Text(error!,
                    style:
                        TextStyle(color: Theme.of(context).colorScheme.error)),
              TextButton(
                  onPressed: busy ? null : load,
                  child: const Text('Actualizar beneficio')),
            ])));
  }
}
