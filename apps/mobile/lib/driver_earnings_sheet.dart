import 'dart:async';

import 'package:flutter/material.dart';

import 'costa_go_design.dart';

typedef EarningsSummaryLoader = Future<Map<String, dynamic>> Function(
    DateTime from, DateTime to);
typedef EarningsPageLoader = Future<Map<String, dynamic>> Function(
    DateTime from, DateTime to, int page, int pageSize);

enum EarningsPeriod { today, week, month, custom }

@visibleForTesting
DateTimeRange earningsRangeFor(EarningsPeriod period, DateTime now,
    [DateTimeRange? customRange]) {
  DateTime day(DateTime value) => DateTime(value.year, value.month, value.day);
  final today = day(now);
  return switch (period) {
    EarningsPeriod.today =>
      DateTimeRange(start: today, end: today.add(const Duration(days: 1))),
    EarningsPeriod.week => DateTimeRange(
        start: today.subtract(Duration(days: today.weekday - 1)),
        end: today.add(const Duration(days: 1))),
    EarningsPeriod.month => DateTimeRange(
        start: DateTime(now.year, now.month),
        end: today.add(const Duration(days: 1))),
    EarningsPeriod.custom => customRange == null
        ? DateTimeRange(start: today, end: today.add(const Duration(days: 1)))
        : DateTimeRange(
            start: day(customRange.start),
            end: day(customRange.end).add(const Duration(days: 1))),
  };
}

class DriverEarningsSheet extends StatefulWidget {
  const DriverEarningsSheet({
    super.key,
    required this.loadSummary,
    required this.loadPage,
  });

  final EarningsSummaryLoader loadSummary;
  final EarningsPageLoader loadPage;

  @override
  State<DriverEarningsSheet> createState() => _DriverEarningsSheetState();
}

class _DriverEarningsSheetState extends State<DriverEarningsSheet> {
  EarningsPeriod period = EarningsPeriod.today;
  DateTimeRange? customRange;
  Map<String, dynamic>? summary;
  Object? error;
  bool loading = true;
  int requestGeneration = 0;

  DateTime _day(DateTime value) => DateTime(value.year, value.month, value.day);

  DateTimeRange get selectedRange =>
      earningsRangeFor(period, DateTime.now(), customRange);

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    final generation = ++requestGeneration;
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final range = selectedRange;
      final value = await widget.loadSummary(range.start, range.end);
      if (!mounted || generation != requestGeneration) return;
      setState(() => summary = value);
    } catch (value) {
      if (!mounted || generation != requestGeneration) return;
      setState(() => error = value);
    } finally {
      if (mounted && generation == requestGeneration) {
        setState(() => loading = false);
      }
    }
  }

  Future<void> _select(EarningsPeriod next) async {
    if (next == EarningsPeriod.custom) {
      final today = _day(DateTime.now());
      final picked = await showDateRangePicker(
        context: context,
        firstDate: DateTime(today.year - 1, today.month, today.day),
        lastDate: today,
        initialDateRange:
            customRange ?? DateTimeRange(start: today, end: today),
        helpText: 'Selecciona el período',
        saveText: 'Aplicar',
      );
      if (picked == null || !mounted) return;
      customRange = picked;
    }
    setState(() => period = next);
    await _load();
  }

  String get _periodLabel => switch (period) {
        EarningsPeriod.today => 'hoy',
        EarningsPeriod.week => 'la semana',
        EarningsPeriod.month => 'el mes',
        EarningsPeriod.custom => 'el período',
      };

  String _money(dynamic value) {
    final number = double.tryParse(value?.toString() ?? '') ?? 0;
    return '\$${number.toStringAsFixed(2)}';
  }

  String _billingMode(dynamic value) => switch (value?.toString()) {
        'TRIP_PACKAGE' => 'Por viajes',
        'PERIOD_PLAN' ||
        'PERIOD_PLAN_INCLUDED' ||
        'PERIOD_PLAN_OVERAGE' ||
        'PERIOD_PLAN_CAP_REACHED' =>
          'Por período',
        _ => 'Pago por uso',
      };

  Future<void> _showHistory() => showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        showDragHandle: false,
        builder: (_) => DriverEarningsHistorySheet(
          range: selectedRange,
          loadPage: widget.loadPage,
        ),
      );

  @override
  Widget build(BuildContext context) {
    final data = summary ?? const <String, dynamic>{};
    final movements = List<dynamic>.from(data['recentMovements'] ?? const []);
    return FractionallySizedBox(
      heightFactor: .94,
      child: Column(children: [
        const CostaGoSheetHandle(),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: CostaGoSpace.lg),
          child: _EarningsHeader(onBack: () => Navigator.pop(context)),
        ),
        const SizedBox(height: CostaGoSpace.sm),
        _PeriodSelector(selected: period, onSelected: _select),
        const SizedBox(height: CostaGoSpace.sm),
        Expanded(
          child: loading && summary == null
              ? const _EarningsLoading()
              : error != null && summary == null
                  ? CostaGoEmptyState(
                      icon: Icons.cloud_off_outlined,
                      title: 'No pudimos consultar tus ganancias',
                      message: 'Revisa tu conexión e inténtalo nuevamente.',
                      action: FilledButton.icon(
                        onPressed: _load,
                        icon: const Icon(Icons.refresh_rounded),
                        label: const Text('Reintentar'),
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(
                        physics: const AlwaysScrollableScrollPhysics(),
                        padding: EdgeInsets.fromLTRB(
                            CostaGoSpace.lg,
                            0,
                            CostaGoSpace.lg,
                            MediaQuery.paddingOf(context).bottom +
                                CostaGoSpace.lg),
                        children: [
                          if (loading)
                            const LinearProgressIndicator(minHeight: 2),
                          if (error != null) ...[
                            const SizedBox(height: CostaGoSpace.sm),
                            const CostaGoInfoBanner(
                              title: 'No se pudo actualizar',
                              message:
                                  'Se muestran los últimos datos disponibles.',
                              icon: Icons.sync_problem_rounded,
                              tone: CostaGoStatusTone.warning,
                            ),
                          ],
                          const SizedBox(height: CostaGoSpace.sm),
                          CostaGoSurface(
                            tone: CostaGoStatusTone.success,
                            padding: const EdgeInsets.all(CostaGoSpace.lg),
                            child: Row(children: [
                              const CostaGoIconBadge(
                                icon: Icons.bar_chart_rounded,
                                tone: CostaGoStatusTone.success,
                                size: 64,
                              ),
                              const SizedBox(width: CostaGoSpace.md),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text('Ganancia neta de $_periodLabel',
                                        style: Theme.of(context)
                                            .textTheme
                                            .titleMedium
                                            ?.copyWith(
                                                color: Theme.of(context)
                                                    .colorScheme
                                                    .onSurfaceVariant)),
                                    Text(_money(data['netEarnings']),
                                        style: Theme.of(context)
                                            .textTheme
                                            .displaySmall
                                            ?.copyWith(
                                                color: context.semantic
                                                    .onSuccessContainer,
                                                fontWeight: FontWeight.w900,
                                                height: 1.05)),
                                    Text(
                                        '${data['completedTrips'] ?? 0} viajes completados',
                                        style: Theme.of(context)
                                            .textTheme
                                            .bodyMedium
                                            ?.copyWith(
                                                color: Theme.of(context)
                                                    .colorScheme
                                                    .onSurfaceVariant)),
                                  ],
                                ),
                              ),
                            ]),
                          ),
                          const SizedBox(height: CostaGoSpace.sm),
                          LayoutBuilder(builder: (context, constraints) {
                            final width =
                                (constraints.maxWidth - CostaGoSpace.sm) / 2;
                            return Wrap(
                              spacing: CostaGoSpace.sm,
                              runSpacing: CostaGoSpace.sm,
                              children: [
                                _MetricCard(
                                    width: width,
                                    icon: Icons.moped_outlined,
                                    label: 'Ingresos por viajes',
                                    value: _money(data['grossTripIncome'])),
                                _MetricCard(
                                    width: width,
                                    icon: Icons.percent_rounded,
                                    label: 'Comisión Costa-Go',
                                    value:
                                        '-${_money(data['costaGoCommission'])}',
                                    tone: CostaGoStatusTone.warning),
                                _MetricCard(
                                    width: width,
                                    icon: Icons.bar_chart_rounded,
                                    label: 'Promedio por viaje',
                                    value: _money(data['averagePerTrip'])),
                                _MetricCard(
                                    width: width,
                                    icon: Icons.account_balance_wallet_outlined,
                                    label: 'Saldo prepago disponible',
                                    value: _money(data['prepaidBalance'])),
                              ],
                            );
                          }),
                          const SizedBox(height: CostaGoSpace.lg),
                          CostaGoSectionHeader(
                            title: 'Movimientos recientes',
                            trailing: TextButton(
                              onPressed:
                                  movements.isEmpty ? null : _showHistory,
                              child: const Text('Ver todos  ›'),
                            ),
                          ),
                          const SizedBox(height: CostaGoSpace.xs),
                          if (movements.isEmpty)
                            const CostaGoSurface(
                              child: CostaGoEmptyState(
                                icon: Icons.receipt_long_outlined,
                                title: 'Sin movimientos',
                                message:
                                    'Aún no tienes movimientos en este período.',
                              ),
                            )
                          else
                            CostaGoSurface(
                              padding: EdgeInsets.zero,
                              child: Column(children: [
                                for (var index = 0;
                                    index < movements.length;
                                    index++) ...[
                                  _MovementRow(
                                      item: Map<String, dynamic>.from(
                                          movements[index] as Map)),
                                  if (index + 1 < movements.length)
                                    const Divider(
                                        height: 1,
                                        indent: CostaGoSpace.md,
                                        endIndent: CostaGoSpace.md),
                                ],
                              ]),
                            ),
                          const SizedBox(height: CostaGoSpace.md),
                          CostaGoSurface(
                            child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(children: [
                                    const CostaGoIconBadge(
                                        icon: Icons.receipt_long_outlined,
                                        size: 48),
                                    const SizedBox(width: CostaGoSpace.md),
                                    Expanded(
                                      child: Text('Resumen de cobros',
                                          style: Theme.of(context)
                                              .textTheme
                                              .titleMedium),
                                    ),
                                  ]),
                                  const SizedBox(height: CostaGoSpace.sm),
                                  _SummaryLine(
                                      label: 'Modalidad actual',
                                      value: _billingMode(data['billingMode'])),
                                  _SummaryLine(
                                      label: 'Descuentos aplicados',
                                      value:
                                          '${data['discountsApplied'] ?? 0}'),
                                  _SummaryLine(
                                      label: 'Comisión Costa-Go',
                                      value: _money(data['costaGoCommission'])),
                                  if (data['billingMode'] == 'PAY_PER_USE')
                                    _SummaryLine(
                                        label: 'Saldo prepago actual',
                                        value: _money(data['prepaidBalance'])),
                                ]),
                          ),
                          const SizedBox(height: CostaGoSpace.md),
                          SizedBox(
                            width: double.infinity,
                            child: FilledButton.icon(
                              onPressed: _showHistory,
                              icon: const Icon(Icons.receipt_long_outlined),
                              label: const Text('Ver historial completo'),
                              style: FilledButton.styleFrom(
                                  minimumSize: const Size.fromHeight(56)),
                            ),
                          ),
                        ],
                      ),
                    ),
        ),
      ]),
    );
  }
}

class _EarningsHeader extends StatelessWidget {
  const _EarningsHeader({required this.onBack});
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) => Row(children: [
        IconButton.filledTonal(
          tooltip: 'Volver',
          onPressed: onBack,
          icon: const Icon(Icons.arrow_back_rounded),
        ),
        Expanded(
          child: Text('Ganancias y comisiones',
              textAlign: TextAlign.center,
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.w900)),
        ),
        IconButton.filledTonal(
          tooltip: 'Cerrar',
          onPressed: onBack,
          icon: const Icon(Icons.close_rounded),
        ),
      ]);
}

class _PeriodSelector extends StatelessWidget {
  const _PeriodSelector({required this.selected, required this.onSelected});
  final EarningsPeriod selected;
  final Future<void> Function(EarningsPeriod) onSelected;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: CostaGoSpace.lg),
        child: SegmentedButton<EarningsPeriod>(
          showSelectedIcon: true,
          segments: const [
            ButtonSegment(value: EarningsPeriod.today, label: Text('Hoy')),
            ButtonSegment(value: EarningsPeriod.week, label: Text('Semana')),
            ButtonSegment(value: EarningsPeriod.month, label: Text('Mes')),
            ButtonSegment(
                value: EarningsPeriod.custom, label: Text('Personalizado')),
          ],
          selected: {selected},
          onSelectionChanged: (value) => unawaited(onSelected(value.first)),
          style: const ButtonStyle(
            visualDensity: VisualDensity.compact,
            textStyle: WidgetStatePropertyAll(
                TextStyle(fontWeight: FontWeight.w800, fontSize: 12)),
          ),
        ),
      );
}

class _MetricCard extends StatelessWidget {
  const _MetricCard(
      {required this.width,
      required this.icon,
      required this.label,
      required this.value,
      this.tone = CostaGoStatusTone.info});
  final double width;
  final IconData icon;
  final String label;
  final String value;
  final CostaGoStatusTone tone;

  @override
  Widget build(BuildContext context) => SizedBox(
        width: width,
        height: 104,
        child: CostaGoSurface(
          padding: const EdgeInsets.all(CostaGoSpace.sm),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              CostaGoIconBadge(icon: icon, tone: tone, size: 40),
              const SizedBox(width: CostaGoSpace.xs),
              Expanded(
                child: Text(label,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant)),
              ),
            ]),
            const SizedBox(height: 4),
            Text(value,
                style: Theme.of(context)
                    .textTheme
                    .titleLarge
                    ?.copyWith(fontWeight: FontWeight.w900)),
          ]),
        ),
      );
}

class _MovementRow extends StatelessWidget {
  const _MovementRow({required this.item});
  final Map<String, dynamic> item;

  String _money(dynamic value) =>
      '\$${(double.tryParse(value?.toString() ?? '') ?? 0).toStringAsFixed(2)}';

  @override
  Widget build(BuildContext context) {
    final completed =
        DateTime.tryParse(item['completedAt']?.toString() ?? '')?.toLocal();
    final now = DateTime.now();
    final today = completed != null &&
        completed.year == now.year &&
        completed.month == now.month &&
        completed.day == now.day;
    final date = completed == null
        ? ''
        : '${today ? 'Hoy' : MaterialLocalizations.of(context).formatShortDate(completed)} · ${TimeOfDay.fromDateTime(completed).format(context)}';
    return Padding(
      padding: const EdgeInsets.all(CostaGoSpace.sm),
      child: Column(children: [
        Row(children: [
          const CostaGoIconBadge(icon: Icons.moped_outlined, size: 44),
          const SizedBox(width: CostaGoSpace.sm),
          Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                Text('Viaje #${item['displayCode'] ?? item['tripId'] ?? ''}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w900)),
                Text(date,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant)),
              ])),
          const Icon(Icons.chevron_right_rounded),
        ]),
        const SizedBox(height: CostaGoSpace.sm),
        Row(children: [
          Expanded(
              child: _MovementAmount(
                  label: 'Valor del viaje',
                  value: _money(item['grossTripIncome']))),
          Expanded(
              child: _MovementAmount(
                  label: 'Comisión',
                  value: '-${_money(item['costaGoCommission'])}')),
          Expanded(
              child: _MovementAmount(
                  label: 'Tu ganancia',
                  value: _money(item['netEarnings']),
                  positive: true)),
        ]),
      ]),
    );
  }
}

class _MovementAmount extends StatelessWidget {
  const _MovementAmount(
      {required this.label, required this.value, this.positive = false});
  final String label;
  final String value;
  final bool positive;

  @override
  Widget build(BuildContext context) =>
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant)),
        Text(value,
            maxLines: 1,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.w900,
                color: positive ? context.semantic.onSuccessContainer : null)),
      ]);
}

class _SummaryLine extends StatelessWidget {
  const _SummaryLine({required this.label, required this.value});
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: CostaGoSpace.xs),
        child: Row(children: [
          Expanded(
              child: Text(label,
                  style: TextStyle(
                      color: Theme.of(context).colorScheme.onSurfaceVariant))),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w800)),
        ]),
      );
}

class _EarningsLoading extends StatelessWidget {
  const _EarningsLoading();
  @override
  Widget build(BuildContext context) => ListView(
        padding: const EdgeInsets.all(CostaGoSpace.lg),
        children: const [
          CostaGoSurface(
              child: SizedBox(
                  height: 115,
                  child: Center(child: CircularProgressIndicator()))),
          SizedBox(height: CostaGoSpace.sm),
          CostaGoSurface(child: SizedBox(height: 210)),
          SizedBox(height: CostaGoSpace.sm),
          CostaGoSurface(child: SizedBox(height: 180)),
        ],
      );
}

class DriverEarningsHistorySheet extends StatefulWidget {
  const DriverEarningsHistorySheet(
      {super.key, required this.range, required this.loadPage});
  final DateTimeRange range;
  final EarningsPageLoader loadPage;
  @override
  State<DriverEarningsHistorySheet> createState() =>
      _DriverEarningsHistorySheetState();
}

class _DriverEarningsHistorySheetState
    extends State<DriverEarningsHistorySheet> {
  final controller = ScrollController();
  final items = <Map<String, dynamic>>[];
  bool loading = false;
  bool hasMore = true;
  Object? error;
  int page = 1;

  @override
  void initState() {
    super.initState();
    controller.addListener(_scroll);
    unawaited(_load());
  }

  void _scroll() {
    if (controller.position.extentAfter < 240) unawaited(_load());
  }

  Future<void> _load() async {
    if (loading || !hasMore) return;
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final result =
          await widget.loadPage(widget.range.start, widget.range.end, page, 20);
      if (!mounted) return;
      items.addAll(List<dynamic>.from(result['items'] ?? const [])
          .map((item) => Map<String, dynamic>.from(item as Map)));
      hasMore = result['hasMore'] == true;
      page++;
    } catch (value) {
      error = value;
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FractionallySizedBox(
        heightFactor: .92,
        child: Column(children: [
          const CostaGoSheetHandle(),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: CostaGoSpace.lg),
            child: CostaGoSheetHeader(
              icon: Icons.receipt_long_outlined,
              title: 'Historial de ganancias',
              subtitle: 'Viajes completados y comisiones aplicadas.',
              onClose: () => Navigator.pop(context),
            ),
          ),
          const SizedBox(height: CostaGoSpace.sm),
          Expanded(
            child: items.isEmpty && loading
                ? const Center(child: CircularProgressIndicator())
                : items.isEmpty && error != null
                    ? CostaGoEmptyState(
                        icon: Icons.cloud_off_outlined,
                        title: 'No se pudo cargar el historial',
                        message: 'Inténtalo nuevamente.',
                        action: FilledButton(
                            onPressed: _load, child: const Text('Reintentar')),
                      )
                    : items.isEmpty
                        ? const CostaGoEmptyState(
                            icon: Icons.receipt_long_outlined,
                            title: 'Sin movimientos',
                            message:
                                'Aún no tienes movimientos en este período.',
                          )
                        : ListView.separated(
                            controller: controller,
                            padding: EdgeInsets.fromLTRB(
                                CostaGoSpace.lg,
                                0,
                                CostaGoSpace.lg,
                                MediaQuery.paddingOf(context).bottom +
                                    CostaGoSpace.lg),
                            itemCount: items.length +
                                (loading || error != null ? 1 : 0),
                            separatorBuilder: (_, __) =>
                                const SizedBox(height: CostaGoSpace.sm),
                            itemBuilder: (context, index) {
                              if (index == items.length) {
                                return error != null
                                    ? Center(
                                        child: TextButton.icon(
                                            onPressed: _load,
                                            icon: const Icon(
                                                Icons.refresh_rounded),
                                            label: const Text('Reintentar')))
                                    : const Center(
                                        child: Padding(
                                            padding: EdgeInsets.all(12),
                                            child:
                                                CircularProgressIndicator()));
                              }
                              return CostaGoSurface(
                                  child: _MovementRow(item: items[index]));
                            },
                          ),
          ),
        ]),
      );
}
