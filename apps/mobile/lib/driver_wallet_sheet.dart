import 'package:flutter/material.dart';

import 'costa_go_design.dart';

class DriverWalletSheet extends StatefulWidget {
  const DriverWalletSheet(
      {super.key,
      required this.load,
      required this.createOrder,
      required this.setEnabled});
  final Future<Map<String, dynamic>> Function() load;
  final Future<Map<String, dynamic>> Function(
      String amount, String idempotencyKey) createOrder;
  final Future<void> Function(bool enabled) setEnabled;
  @override
  State<DriverWalletSheet> createState() => _DriverWalletSheetState();
}

class _DriverWalletSheetState extends State<DriverWalletSheet> {
  final amount = TextEditingController();
  late final String requestKey =
      'wallet-${DateTime.now().microsecondsSinceEpoch}';
  Map<String, dynamic>? data;
  String? error;
  String? amountError;
  bool busy = false;

  @override
  void initState() {
    super.initState();
    refresh();
  }

  @override
  void dispose() {
    amount.dispose();
    super.dispose();
  }

  Future<void> refresh() async {
    try {
      final result = await widget.load();
      if (mounted) setState(() => data = result);
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    }
  }

  Future<void> recharge() async {
    if (busy) return;
    final value = amount.text.trim().replaceAll(',', '.');
    if (!RegExp(r'^\d+(\.\d{1,2})?$').hasMatch(value)) {
      setState(() =>
          amountError = 'Ingresa un importe válido con hasta dos decimales.');
      return;
    }
    final config =
        Map<String, dynamic>.from(data?['configuration'] as Map? ?? {});
    final numeric = double.parse(value);
    final minimum = double.tryParse('${config['minimumTopUp']}');
    final maximum = double.tryParse('${config['maximumTopUp']}');
    if (minimum != null && numeric < minimum) {
      setState(() => amountError =
          'El valor mínimo de recarga es \$${minimum.toStringAsFixed(2)}.');
      return;
    }
    if (maximum != null && numeric > maximum) {
      setState(() => amountError =
          'El valor máximo de recarga es \$${maximum.toStringAsFixed(2)}.');
      return;
    }
    setState(() {
      busy = true;
      error = null;
      amountError = null;
    });
    try {
      final order = await widget.createOrder(value, requestKey);
      if (mounted) Navigator.pop(context, order);
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> setWalletEnabled(bool enabled) async {
    if (busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await widget.setEnabled(enabled);
      await refresh();
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final wallet = Map<String, dynamic>.from(data?['wallet'] as Map? ?? {});
    final config =
        Map<String, dynamic>.from(data?['configuration'] as Map? ?? {});
    final movements = List<dynamic>.from(data?['movements'] ?? const [])
        .whereType<Map>()
        .map((value) => Map<String, dynamic>.from(value))
        .toList();
    final available = double.tryParse('${wallet['available']}');
    final threshold = double.tryParse('${config['lowBalanceThreshold']}');
    final minimumRequired =
        double.tryParse('${config['minimumRequiredBalance']}');
    final insufficient = wallet['enabled'] == true &&
        available != null &&
        minimumRequired != null &&
        minimumRequired > 0 &&
        available < minimumRequired;
    return SafeArea(
        child: FractionallySizedBox(
            heightFactor: .94,
            child: Column(children: [
              const CostaGoSheetHandle(),
              Expanded(
                  child: RefreshIndicator(
                      onRefresh: refresh,
                      child: ListView(
                        padding: const EdgeInsets.fromLTRB(20, 4, 20, 30),
                        children: [
                          Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Expanded(
                                    child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                      Text('Saldo Costa-Go',
                                          style: Theme.of(context)
                                              .textTheme
                                              .headlineSmall
                                              ?.copyWith(
                                                  fontWeight: FontWeight.w900)),
                                      const SizedBox(height: 12),
                                      FittedBox(
                                          fit: BoxFit.scaleDown,
                                          alignment: Alignment.centerLeft,
                                          child: Text.rich(
                                              TextSpan(children: [
                                                TextSpan(
                                                    text:
                                                        '\$${wallet['available'] ?? '0.00'} ',
                                                    style: TextStyle(
                                                        color: insufficient
                                                            ? colors.error
                                                            : colors.primary)),
                                                const TextSpan(
                                                    text: 'disponibles')
                                              ]),
                                              style: Theme.of(context)
                                                  .textTheme
                                                  .displaySmall
                                                  ?.copyWith(
                                                      fontWeight:
                                                          FontWeight.w900,
                                                      height: 1))),
                                      const SizedBox(height: 5),
                                      Text(
                                          'Total: \$${wallet['total'] ?? '0.00'} · Reservado: \$${wallet['reserved'] ?? '0.00'}',
                                          style: Theme.of(context)
                                              .textTheme
                                              .titleMedium
                                              ?.copyWith(
                                                  color:
                                                      colors.onSurfaceVariant)),
                                    ])),
                                const SizedBox(width: 12),
                                CostaGoIconBadge(
                                    icon: insufficient
                                        ? Icons.money_off_csred_rounded
                                        : Icons.account_balance_wallet_rounded,
                                    tone: insufficient
                                        ? CostaGoStatusTone.danger
                                        : CostaGoStatusTone.info,
                                    size: 76),
                              ]),
                          const SizedBox(height: 18),
                          if (data == null && error == null)
                            const Padding(
                                padding: EdgeInsets.all(32),
                                child:
                                    Center(child: CircularProgressIndicator())),
                          if (data != null) ...[
                            CostaGoSurface(
                                tone: CostaGoStatusTone.info,
                                padding: const EdgeInsets.all(14),
                                child: Row(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Icon(Icons.info_outline_rounded,
                                          color: colors.primary, size: 25),
                                      const SizedBox(width: 12),
                                      const Expanded(
                                          child: Text(
                                              'Tu saldo se conserva al comprar un plan o paquete. No se cobra saldo y viajes del paquete a la vez.')),
                                    ])),
                            const SizedBox(height: 12),
                            CostaGoSurface(
                                padding: const EdgeInsets.all(14),
                                child: Row(children: [
                                  const CostaGoIconBadge(
                                      icon: Icons.credit_card_rounded,
                                      tone: CostaGoStatusTone.info),
                                  const SizedBox(width: 12),
                                  const Expanded(
                                      child: Column(
                                          crossAxisAlignment:
                                              CrossAxisAlignment.start,
                                          children: [
                                        Text('Pago por uso',
                                            style: TextStyle(
                                                fontWeight: FontWeight.w900,
                                                fontSize: 17)),
                                        SizedBox(height: 3),
                                        Text(
                                            'Usar saldo cuando no haya un plan o paquete vigente que cubra el viaje.'),
                                      ])),
                                  const SizedBox(width: 8),
                                  Switch(
                                      value: wallet['enabled'] == true,
                                      onChanged:
                                          busy ? null : setWalletEnabled),
                                ])),
                            if (!insufficient &&
                                available != null &&
                                threshold != null &&
                                available <= threshold) ...[
                              const SizedBox(height: 10),
                              CostaGoSurface(
                                  tone: CostaGoStatusTone.warning,
                                  child: Row(children: [
                                    Icon(Icons.warning_amber_rounded,
                                        color: colors.error),
                                    const SizedBox(width: 10),
                                    const Expanded(
                                        child: Text(
                                            'Tu saldo Costa-Go está por agotarse.')),
                                  ])),
                            ],
                            const SizedBox(height: 12),
                            if (config.isNotEmpty)
                              _rechargeCard(context, config)
                            else
                              const CostaGoSurface(
                                  child: Text(
                                      'Las recargas todavía no están habilitadas.')),
                            const SizedBox(height: 20),
                            Divider(color: colors.outlineVariant),
                            const SizedBox(height: 8),
                            Row(children: [
                              Icon(Icons.swap_horiz_rounded,
                                  color: colors.primary, size: 30),
                              const SizedBox(width: 8),
                              Expanded(
                                  child: Text('Movimientos',
                                      style: Theme.of(context)
                                          .textTheme
                                          .titleLarge
                                          ?.copyWith(
                                              fontWeight: FontWeight.w900))),
                              if (movements.isNotEmpty)
                                TextButton.icon(
                                    onPressed: () =>
                                        _showAllMovements(context, movements),
                                    label: const Text('Ver todos'),
                                    iconAlignment: IconAlignment.end,
                                    icon: const Icon(
                                        Icons.chevron_right_rounded)),
                            ]),
                            const SizedBox(height: 8),
                            if (movements.isEmpty)
                              const CostaGoSurface(
                                  child: Text(
                                      'Tus recargas y comisiones aparecerán aquí.'))
                            else
                              ...movements.take(3).map((movement) => Padding(
                                  padding: const EdgeInsets.only(bottom: 8),
                                  child:
                                      _WalletMovementTile(movement: movement))),
                          ],
                          if (error != null) ...[
                            const SizedBox(height: 12),
                            CostaGoSurface(
                                tone: CostaGoStatusTone.danger,
                                child: Text(error!,
                                    style: TextStyle(color: colors.error)))
                          ],
                        ],
                      )))
            ])));
  }

  Widget _rechargeCard(BuildContext context, Map<String, dynamic> config) {
    final colors = Theme.of(context).colorScheme;
    return CostaGoSurface(
        padding: const EdgeInsets.all(16),
        child:
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Row(children: [
            CostaGoIconBadge(
                icon: Icons.add_card_rounded, tone: CostaGoStatusTone.info),
            SizedBox(width: 12),
            Expanded(
                child: Text('Recargar saldo',
                    style:
                        TextStyle(fontWeight: FontWeight.w900, fontSize: 18)))
          ]),
          const SizedBox(height: 12),
          TextField(
              controller: amount,
              enabled: !busy,
              onChanged: (_) {
                if (amountError != null) setState(() => amountError = null);
              },
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                  labelText: 'Valor de recarga', prefixText: '\$  ')),
          if (amountError != null) ...[
            const SizedBox(height: 8),
            CostaGoSurface(
                tone: CostaGoStatusTone.danger,
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                child: Row(children: [
                  Icon(Icons.error_outline_rounded,
                      color: colors.error, size: 21),
                  const SizedBox(width: 9),
                  Expanded(
                      child: Text(amountError!,
                          style: TextStyle(
                              color: colors.error,
                              fontWeight: FontWeight.w700))),
                ])),
          ],
          const SizedBox(height: 8),
          CostaGoSurface(
              tone: CostaGoStatusTone.info,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              child: Row(children: [
                Icon(Icons.info_outline_rounded,
                    color: colors.primary, size: 21),
                const SizedBox(width: 9),
                Expanded(
                    child: Text(
                        'Puedes recargar desde \$${config['minimumTopUp']} hasta \$${config['maximumTopUp']}.',
                        style: const TextStyle(fontWeight: FontWeight.w700))),
              ])),
          const Divider(height: 28),
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Icon(Icons.info_outline_rounded, color: colors.primary, size: 22),
            const SizedBox(width: 10),
            const Expanded(
                child: Text(
                    'El IVA y el total se muestran en la orden. Solo el valor de recarga se acredita como saldo.'))
          ]),
          const SizedBox(height: 14),
          FilledButton(
              onPressed: busy ? null : recharge,
              child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Text(busy ? 'Procesando…' : 'Recargar saldo'))),
        ]));
  }

  Future<void> _showAllMovements(
      BuildContext context, List<Map<String, dynamic>> movements) async {
    var filter = _WalletMovementFilter.all;
    await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        showDragHandle: false,
        builder: (modalContext) => StatefulBuilder(
            builder: (modalContext, setModalState) => FractionallySizedBox(
                heightFactor: .94,
                child: Column(children: [
                  const CostaGoSheetHandle(),
                  Padding(
                      padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
                      child: Row(children: [
                        IconButton(
                            onPressed: () => Navigator.pop(modalContext),
                            icon: const Icon(Icons.arrow_back_rounded)),
                        const SizedBox(width: 4),
                        Text('Movimientos',
                            style: Theme.of(modalContext)
                                .textTheme
                                .headlineSmall
                                ?.copyWith(fontWeight: FontWeight.w900)),
                      ])),
                  SizedBox(
                      height: 48,
                      child: ListView(
                          padding: const EdgeInsets.symmetric(horizontal: 20),
                          scrollDirection: Axis.horizontal,
                          children: _WalletMovementFilter.values
                              .map((value) => Padding(
                                  padding: const EdgeInsets.only(right: 8),
                                  child: ChoiceChip(
                                      selected: filter == value,
                                      label: Text(value.label),
                                      onSelected: (_) =>
                                          setModalState(() => filter = value))))
                              .toList())),
                  Expanded(child: Builder(builder: (context) {
                    final filtered = movements
                        .where((movement) => filter.includes(movement))
                        .toList();
                    return ListView(
                        padding: const EdgeInsets.fromLTRB(20, 14, 20, 32),
                        children: [
                          _MovementTotals(movements: filtered),
                          const SizedBox(height: 18),
                          if (filtered.isEmpty)
                            const CostaGoEmptyState(
                                icon: Icons.receipt_long_outlined,
                                title: 'No hay movimientos',
                                message:
                                    'No existen registros para este filtro.')
                          else
                            ..._movementGroups(context, filtered),
                        ]);
                  }))
                ]))));
  }

  List<Widget> _movementGroups(
      BuildContext context, List<Map<String, dynamic>> movements) {
    final widgets = <Widget>[];
    String? previousGroup;
    for (final movement in movements) {
      final group = _movementDayLabel(movement['createdAt']);
      if (group != previousGroup) {
        previousGroup = group;
        final count = movements
            .where((candidate) =>
                _movementDayLabel(candidate['createdAt']) == group)
            .length;
        widgets.add(Padding(
            padding: const EdgeInsets.fromLTRB(2, 10, 2, 8),
            child: Row(children: [
              Expanded(
                  child: Text(group,
                      style: Theme.of(context)
                          .textTheme
                          .titleLarge
                          ?.copyWith(fontWeight: FontWeight.w900))),
              Text('$count ${count == 1 ? 'movimiento' : 'movimientos'}',
                  style: TextStyle(
                      color: Theme.of(context).colorScheme.onSurfaceVariant)),
            ])));
      }
      widgets.add(Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: _WalletMovementTile(movement: movement, detailed: true)));
    }
    return widgets;
  }
}

enum _WalletMovementFilter {
  all('Todos'),
  commissions('Comisiones'),
  topUps('Recargas'),
  adjustments('Ajustes');

  const _WalletMovementFilter(this.label);
  final String label;
  bool includes(Map<String, dynamic> movement) {
    final kind = movement['kind']?.toString();
    return switch (this) {
      _WalletMovementFilter.all => true,
      _WalletMovementFilter.commissions =>
        const {'TRIP_COMMISSION', 'RESERVE', 'RELEASE'}.contains(kind),
      _WalletMovementFilter.topUps => kind == 'TOPUP',
      _WalletMovementFilter.adjustments =>
        const {'REVERSAL', 'ADMIN_ADJUSTMENT'}.contains(kind),
    };
  }
}

class _MovementPresentation {
  const _MovementPresentation(
      {required this.title,
      required this.subtitle,
      required this.tone,
      required this.amountPrefix,
      required this.status,
      this.usesMototaxi = false,
      this.icon = Icons.receipt_long_outlined});
  final String title, subtitle, amountPrefix, status;
  final CostaGoStatusTone tone;
  final bool usesMototaxi;
  final IconData icon;
}

_MovementPresentation _movementPresentation(Map<String, dynamic> movement) {
  final reason = movement['reason']?.toString().trim();
  return switch (movement['kind']?.toString()) {
    'TOPUP' => _MovementPresentation(
        title: 'Recarga de saldo',
        subtitle: reason?.isNotEmpty == true ? reason! : 'Recarga aprobada',
        tone: CostaGoStatusTone.success,
        amountPrefix: '+',
        status: 'Completado',
        icon: Icons.account_balance_wallet_outlined),
    'TRIP_COMMISSION' => const _MovementPresentation(
        title: 'Comisión de viaje',
        subtitle: 'Viaje completado',
        tone: CostaGoStatusTone.danger,
        amountPrefix: '-',
        status: 'Cobrado',
        usesMototaxi: true),
    'RESERVE' => const _MovementPresentation(
        title: 'Comisión reservada',
        subtitle: 'Viaje en curso',
        tone: CostaGoStatusTone.warning,
        amountPrefix: '',
        status: 'Reservado',
        usesMototaxi: true),
    'RELEASE' => const _MovementPresentation(
        title: 'Reserva liberada',
        subtitle: 'El viaje no generó cobro',
        tone: CostaGoStatusTone.info,
        amountPrefix: '',
        status: 'Liberado',
        usesMototaxi: true),
    'REVERSAL' => _MovementPresentation(
        title: 'Reverso de saldo',
        subtitle: reason?.isNotEmpty == true ? reason! : 'Saldo restituido',
        tone: CostaGoStatusTone.success,
        amountPrefix: '+',
        status: 'Completado',
        icon: Icons.undo_rounded),
    'ADMIN_ADJUSTMENT' => _MovementPresentation(
        title: 'Ajuste de sistema',
        subtitle: reason?.isNotEmpty == true ? reason! : 'Corrección de saldo',
        tone: CostaGoStatusTone.info,
        amountPrefix: _numericAmount(movement) > 0 ? '+' : '',
        status: 'Completado',
        icon: Icons.settings_outlined),
    _ => _MovementPresentation(
        title: 'Movimiento de saldo',
        subtitle: reason?.isNotEmpty == true ? reason! : 'Actualización',
        tone: CostaGoStatusTone.info,
        amountPrefix: '',
        status: 'Completado'),
  };
}

class _WalletMovementTile extends StatelessWidget {
  const _WalletMovementTile({required this.movement, this.detailed = false});
  final Map<String, dynamic> movement;
  final bool detailed;
  @override
  Widget build(BuildContext context) {
    final presentation = _movementPresentation(movement);
    final colors = Theme.of(context).colorScheme;
    final semantic = context.semantic;
    final amountColor = switch (presentation.tone) {
      CostaGoStatusTone.success => semantic.success,
      CostaGoStatusTone.danger => colors.error,
      CostaGoStatusTone.warning => semantic.warning,
      _ => colors.onSurface
    };
    final amountValue = _numericAmount(movement).abs().toStringAsFixed(2);
    return CostaGoSurface(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
        child: Row(children: [
          Container(
              width: detailed ? 54 : 48,
              height: detailed ? 54 : 48,
              padding: EdgeInsets.all(presentation.usesMototaxi ? 6 : 0),
              decoration: BoxDecoration(
                  color: presentation.tone == CostaGoStatusTone.success
                      ? semantic.successContainer
                      : semantic.infoContainer,
                  borderRadius: BorderRadius.circular(15)),
              child: presentation.usesMototaxi
                  ? Image.asset('assets/images/trip-history-mototaxi.png',
                      fit: BoxFit.contain, semanticLabel: 'Mototaxi')
                  : Icon(presentation.icon,
                      color: presentation.tone == CostaGoStatusTone.success
                          ? semantic.onSuccessContainer
                          : semantic.onInfoContainer)),
          const SizedBox(width: 12),
          Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                Text(presentation.title,
                    style: const TextStyle(fontWeight: FontWeight.w900)),
                const SizedBox(height: 2),
                Text(presentation.subtitle,
                    maxLines: detailed ? 2 : 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: colors.onSurfaceVariant)),
                Text(
                    _movementTimeLabel(movement['createdAt'],
                        includeDay: !detailed),
                    style: Theme.of(context)
                        .textTheme
                        .bodySmall
                        ?.copyWith(color: colors.onSurfaceVariant)),
              ])),
          const SizedBox(width: 8),
          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Text('${presentation.amountPrefix}\$$amountValue',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    color: amountColor, fontWeight: FontWeight.w900)),
            if (detailed) ...[
              const SizedBox(height: 5),
              Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                  decoration: BoxDecoration(
                      color: amountColor.withValues(alpha: .10),
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(
                          color: amountColor.withValues(alpha: .28))),
                  child: Text(presentation.status,
                      style: Theme.of(context)
                          .textTheme
                          .labelMedium
                          ?.copyWith(color: amountColor)))
            ] else
              Icon(Icons.chevron_right_rounded, color: colors.primary),
          ])
        ]));
  }
}

class _MovementTotals extends StatelessWidget {
  const _MovementTotals({required this.movements});
  final List<Map<String, dynamic>> movements;
  @override
  Widget build(BuildContext context) {
    final semantic = context.semantic;
    final colors = Theme.of(context).colorScheme;
    final income = movements.fold<double>(0, (total, movement) {
      final kind = movement['kind']?.toString();
      final value = _numericAmount(movement);
      return total +
          (kind == 'TOPUP' ||
                  kind == 'REVERSAL' ||
                  (kind == 'ADMIN_ADJUSTMENT' && value > 0)
              ? value
              : 0);
    });
    final discounts = movements.fold<double>(0, (total, movement) {
      final kind = movement['kind']?.toString();
      final value = _numericAmount(movement);
      return total +
          (kind == 'TRIP_COMMISSION' ||
                  (kind == 'ADMIN_ADJUSTMENT' && value < 0)
              ? value.abs()
              : 0);
    });
    return CostaGoSurface(
        tone: CostaGoStatusTone.info,
        padding: const EdgeInsets.all(16),
        child: Column(children: [
          Row(children: [
            Expanded(
                child: _TotalItem(
                    icon: Icons.arrow_upward_rounded,
                    label: 'Ingresos',
                    value: '\$${income.toStringAsFixed(2)}',
                    color: semantic.success)),
            Container(width: 1, height: 62, color: colors.outlineVariant),
            Expanded(
                child: _TotalItem(
                    icon: Icons.arrow_downward_rounded,
                    label: 'Descuentos',
                    value: '-\$${discounts.toStringAsFixed(2)}',
                    color: colors.error))
          ]),
          const SizedBox(height: 8),
          Text('Totales del período mostrado',
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: colors.onSurfaceVariant)),
        ]));
  }
}

class _TotalItem extends StatelessWidget {
  const _TotalItem(
      {required this.icon,
      required this.label,
      required this.value,
      required this.color});
  final IconData icon;
  final String label, value;
  final Color color;
  @override
  Widget build(BuildContext context) => Row(children: [
        Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
                color: color.withValues(alpha: .10), shape: BoxShape.circle),
            child: Icon(icon, color: color)),
        const SizedBox(width: 8),
        Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label),
          FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(value,
                  style: Theme.of(context)
                      .textTheme
                      .titleLarge
                      ?.copyWith(color: color, fontWeight: FontWeight.w900)))
        ])),
      ]);
}

double _numericAmount(Map<String, dynamic> movement) =>
    double.tryParse('${movement['amount']}') ?? 0;
DateTime? _movementDate(dynamic value) =>
    value == null ? null : DateTime.tryParse(value.toString())?.toLocal();
String _movementDayLabel(dynamic value) {
  final date = _movementDate(value);
  if (date == null) return 'Sin fecha';
  final now = DateTime.now();
  final difference = DateTime(now.year, now.month, now.day)
      .difference(DateTime(date.year, date.month, date.day))
      .inDays;
  if (difference == 0) return 'Hoy';
  if (difference == 1) return 'Ayer';
  const months = [
    'ene',
    'feb',
    'mar',
    'abr',
    'may',
    'jun',
    'jul',
    'ago',
    'sep',
    'oct',
    'nov',
    'dic'
  ];
  return '${date.day} ${months[date.month - 1]}';
}

String _movementTimeLabel(dynamic value, {required bool includeDay}) {
  final date = _movementDate(value);
  if (date == null) return 'Fecha no disponible';
  final period = date.hour < 12 ? 'a. m.' : 'p. m.';
  final hour = date.hour % 12 == 0 ? 12 : date.hour % 12;
  final clock = '$hour:${date.minute.toString().padLeft(2, '0')} $period';
  return includeDay ? '${_movementDayLabel(value)} · $clock' : clock;
}
