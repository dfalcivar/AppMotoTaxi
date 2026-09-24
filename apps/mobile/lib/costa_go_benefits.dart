import 'package:flutter/material.dart';
import 'costa_go_coastal.dart';

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
      this.actionLabel = ''});
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
      if (mounted) {
        setState(() => error =
            'No pudimos confirmar la activación. Actualiza el beneficio para comprobar su estado.');
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => CostaGoBenefitCard(
      data: data,
      busy: busy,
      error: error,
      actionLabel: widget.actionLabel,
      onClaim: claimBenefit,
      onRetry: load);
}

String benefitDate(BuildContext context, dynamic value) {
  final d = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
  if (d == null) return '';
  final l = MaterialLocalizations.of(context);
  return '${l.formatFullDate(d)} · ${l.formatTimeOfDay(TimeOfDay.fromDateTime(d), alwaysUse24HourFormat: MediaQuery.alwaysUse24HourFormatOf(context))}';
}

/// Presentation only: the server owns public copy, limits, eligibility and dates.
class CostaGoBenefitCard extends StatelessWidget {
  const CostaGoBenefitCard(
      {super.key,
      required this.data,
      this.busy = false,
      this.error,
      required this.actionLabel,
      required this.onClaim,
      required this.onRetry,
      this.benefitVisualAsset});
  final Map<String, dynamic>? data;
  final bool busy;
  final String? error;
  final String actionLabel;
  final VoidCallback onClaim, onRetry;
  final Widget? benefitVisualAsset;

  static IconData iconFor(String? type) => switch (type) {
        'COURTESY_DAYS' => Icons.card_giftcard_rounded,
        'PROMOTIONAL_BALANCE' => Icons.account_balance_wallet_outlined,
        'FIXED_DISCOUNT' || 'TRIP_DISCOUNT' => Icons.local_offer_outlined,
        'PERCENTAGE_DISCOUNT' => Icons.percent_rounded,
        'FREE_TRIPS' => Icons.confirmation_number_outlined,
        'REFERRAL_REWARD' => Icons.people_outline_rounded,
        _ => Icons.card_giftcard_rounded,
      };

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final benefit = data?['benefit'] as Map?;
    final grant = data?['redemption'] as Map?;
    final state = data?['state']?.toString();
    final status = grant?['status']?.toString();
    final expired = status == 'EXPIRED' || state == 'EXPIRED';
    final used = ['USED', 'CONSUMED'].contains(status) || state == 'USED';
    final claimed =
        grant != null || ['CLAIMED', 'ALREADY_REDEEMED'].contains(state);
    final available = state == 'AVAILABLE' && !claimed && !expired && !used;
    final until = benefitDate(context, grant?['effectiveUntil']);
    final from = benefitDate(context, grant?['effectiveFrom']);
    final label = expired
        ? 'Beneficio vencido'
        : used
            ? 'Beneficio utilizado'
            : status == 'PENDING'
                ? 'Beneficio activado · inicio programado'
                : claimed
                    ? 'Beneficio activado'
                    : data?['message']?.toString() ?? '';
    return Container(
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(26),
            border: Border.all(color: c.primary.withValues(alpha: .10)),
            gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: dark
                    ? [const Color(0xff152f48), const Color(0xff112237)]
                    : [const Color(0xffe4f6ff), Colors.white]),
            boxShadow: [
              BoxShadow(
                  color: c.primary.withValues(alpha: .07),
                  blurRadius: 18,
                  offset: const Offset(0, 6))
            ]),
        child: CostaGoCoastalDecoration(
            child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 24, 20, 16),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (busy) const LinearProgressIndicator(),
                      if (benefit != null) ...[
                        Center(
                            child: benefitVisualAsset ??
                                Icon(
                                    iconFor(benefit['benefitType']?.toString()),
                                    size: 72,
                                    color: c.primary)),
                        const SizedBox(height: 12),
                        Text(
                            benefit['valueLabel']?.toString() ?? 'Tu beneficio',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                                fontSize: 38,
                                height: 1.1,
                                fontWeight: FontWeight.w800,
                                color: dark
                                    ? c.primary
                                    : const Color(0xff064784))),
                        if ((benefit['typeLabel'] ?? '')
                            .toString()
                            .isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Text(benefit['typeLabel'].toString(),
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                  fontSize: 22,
                                  height: 1.2,
                                  fontWeight: FontWeight.w700,
                                  color: c.onSurface)),
                        ],
                        if (available &&
                            (benefit['oneTime'] == true ||
                                benefit['maxPerUser'] == 1)) ...[
                          const SizedBox(height: 14),
                          Center(
                              child: Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 14, vertical: 7),
                                  decoration: BoxDecoration(
                                      color: c.primary.withValues(alpha: .10),
                                      borderRadius: BorderRadius.circular(24)),
                                  child: Text('Disponible una sola vez.',
                                      textAlign: TextAlign.center,
                                      style: TextStyle(
                                          color: c.primary,
                                          fontWeight: FontWeight.w600)))),
                        ],
                      ],
                      if (label.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              if (claimed && !expired) ...[
                                Icon(Icons.check_circle_outline,
                                    color: c.primary),
                                const SizedBox(width: 8)
                              ],
                              Flexible(
                                  child: Text(label,
                                      textAlign: TextAlign.center,
                                      style: const TextStyle(
                                          fontWeight: FontWeight.w600))),
                            ]),
                      ],
                      if (status == 'PENDING' && from.isNotEmpty)
                        Padding(
                            padding: const EdgeInsets.only(top: 8),
                            child: Text('Desde $from',
                                textAlign: TextAlign.center)),
                      if (until.isNotEmpty)
                        Padding(
                            padding: const EdgeInsets.only(top: 8),
                            child: Text('Válido hasta $until',
                                textAlign: TextAlign.center)),
                      if (available && actionLabel.isNotEmpty) ...[
                        const SizedBox(height: 22),
                        FilledButton(
                            onPressed: busy ? null : onClaim,
                            style: FilledButton.styleFrom(
                                minimumSize: const Size.fromHeight(54),
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 16, vertical: 16),
                                shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(18))),
                            child: Text(actionLabel,
                                textAlign: TextAlign.center,
                                style: const TextStyle(
                                    fontSize: 19,
                                    fontWeight: FontWeight.w700))),
                      ],
                      if (error != null) ...[
                        const SizedBox(height: 12),
                        Text(error!,
                            style: TextStyle(color: c.error),
                            textAlign: TextAlign.center),
                        TextButton(
                            onPressed: busy ? null : onRetry,
                            child: const Text('Actualizar beneficio')),
                      ],
                    ]))));
  }
}
