import 'dart:async';

import 'package:flutter/material.dart';

typedef MobileAdminRequest = Future<dynamic>
    Function(String method, String path, {String? token, Object? body});

class MobileAdminPanel extends StatefulWidget {
  const MobileAdminPanel({
    required this.mobileToken,
    required this.request,
    super.key,
  });

  final String mobileToken;
  final MobileAdminRequest request;

  @override
  State<MobileAdminPanel> createState() => _MobileAdminPanelState();
}

class _MobileAdminPanelState extends State<MobileAdminPanel> {
  String? token;
  List<String> modules = const [];
  String? error;

  @override
  void initState() {
    super.initState();
    _openSession();
  }

  Future<void> _openSession() async {
    setState(() => error = null);
    try {
      final data = await widget.request('POST', '/v1/mobile-admin/session',
          token: widget.mobileToken);
      if (!mounted) return;
      setState(() {
        token = data['token']?.toString();
        modules = List<String>.from(data['modules'] ?? const []);
      });
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    if (token == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Administración Costa-Go')),
        body: Center(
          child: error == null
              ? const CircularProgressIndicator()
              : _AdminError(message: error!, retry: _openSession),
        ),
      );
    }
    return _AdminHome(token: token!, modules: modules, request: widget.request);
  }
}

class _Module {
  const _Module(this.id, this.title, this.subtitle, this.icon, this.color);
  final String id;
  final String title;
  final String subtitle;
  final IconData icon;
  final Color color;
}

const _allModules = <_Module>[
  _Module('overview', 'Resumen operativo', 'Estado actual del sistema',
      Icons.analytics_outlined, Color(0xff7457ef)),
  _Module(
      'fares',
      'Tarifario y reglas',
      'Sectores, reglas y trayectos sin regla',
      Icons.sell_outlined,
      Color(0xffff8b2c)),
  _Module('dispatch', 'Búsqueda de mototaxis', 'Radios, rondas y tiempos',
      Icons.search_rounded, Color(0xff00ad73)),
  _Module('arrival', 'Tarifa de llegada', 'Valor por ronda y participación',
      Icons.price_change_outlined, Color(0xffff982f)),
  _Module('trips', 'Viajes', 'Operación y viajes activos', Icons.route_outlined,
      Color(0xff3e7cf4)),
  _Module(
      'scheduled',
      'Viajes programados',
      'Día, noche, horarios y anticipación',
      Icons.calendar_month_outlined,
      Color(0xff6956ef)),
  _Module('cancellations', 'Cancelaciones', 'Reglas y sanciones',
      Icons.block_outlined, Color(0xffff5660)),
  _Module('wallet', 'Pago por Uso', 'Saldo, recargas y referencias',
      Icons.account_balance_wallet_outlined, Color(0xff168cff)),
  _Module(
      'memberships',
      'Membresías por período',
      'Planes y condiciones vigentes',
      Icons.card_membership_outlined,
      Color(0xff326bd7)),
  _Module('packages', 'Paquetes por viajes', 'Precio técnico y sugerido',
      Icons.local_shipping_outlined, Color(0xff00a46b)),
  _Module('advertising', 'Publicidad', 'Espacios y campañas activas',
      Icons.campaign_outlined, Color(0xffff8e23)),
  _Module('notifications', 'Notificaciones', 'Configuración operativa',
      Icons.notifications_active_outlined, Color(0xff13a779)),
  _Module('flags', 'Funciones', 'Activación dinámica real',
      Icons.toggle_on_outlined, Color(0xff7457ef)),
  _Module('simulator', 'Simulador operativo', 'Pruebas sin generar viajes',
      Icons.science_outlined, Color(0xff476fef)),
  _Module('audit', 'Auditoría', 'Historial común de cambios',
      Icons.history_outlined, Color(0xff566778)),
];

class _AdminHome extends StatefulWidget {
  const _AdminHome(
      {required this.token, required this.modules, required this.request});
  final String token;
  final List<String> modules;
  final MobileAdminRequest request;
  @override
  State<_AdminHome> createState() => _AdminHomeState();
}

class _AdminHomeState extends State<_AdminHome> {
  Map<String, dynamic>? operations;
  String? error;
  bool refreshing = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      refreshing = true;
      error = null;
    });
    try {
      final value = await widget.request('GET', '/v1/admin/operations',
          token: widget.token);
      if (mounted) {
        setState(() => operations = Map<String, dynamic>.from(value));
      }
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => refreshing = false);
    }
  }

  void _open(_Module module) {
    Navigator.push(
        context,
        MaterialPageRoute(
            builder: (_) => _AdminModuleScreen(
                  module: module,
                  token: widget.token,
                  request: widget.request,
                ))).then((_) => _load());
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final visible =
        _allModules.where((item) => widget.modules.contains(item.id)).toList();
    final metrics = operations?['metrics'] is Map
        ? Map<String, dynamic>.from(operations!['metrics'])
        : <String, dynamic>{};
    return Scaffold(
      appBar: AppBar(
        title: const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Administración Costa-Go'),
              Text('Panel operativo',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w500)),
            ]),
        actions: [
          IconButton(
              onPressed: refreshing ? null : _load,
              icon: const Icon(Icons.refresh),
              tooltip: 'Actualizar')
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 28),
            children: [
              if (error != null) _AdminError(message: error!, retry: _load),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                    color: const Color(0xffeaf8f1),
                    borderRadius: BorderRadius.circular(16)),
                child: Row(children: [
                  const CircleAvatar(
                      backgroundColor: Color(0xff22b573),
                      foregroundColor: Colors.white,
                      child: Icon(Icons.check)),
                  const SizedBox(width: 12),
                  Expanded(
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                        Text('Sistema operativo',
                            style: TextStyle(
                                color: Colors.green.shade900,
                                fontWeight: FontWeight.w800)),
                        Text(
                            error == null
                                ? 'Datos confirmados por el backend'
                                : 'Requiere revisión',
                            style: TextStyle(color: Colors.green.shade800)),
                      ])),
                ]),
              ),
              const SizedBox(height: 14),
              Row(children: [
                Expanded(
                    child: _Metric(
                        value: '${metrics['connectedDrivers'] ?? '—'}',
                        label: 'Conductores',
                        color: const Color(0xff23af73))),
                const SizedBox(width: 10),
                Expanded(
                    child: _Metric(
                        value: '${metrics['activeTrips'] ?? '—'}',
                        label: 'Viajes activos',
                        color: const Color(0xff7457ef))),
              ]),
              const SizedBox(height: 10),
              Row(children: [
                Expanded(
                    child: _Metric(
                        value: '${metrics['searchingTrips'] ?? '—'}',
                        label: 'Buscando',
                        color: const Color(0xffff982f))),
                const SizedBox(width: 10),
                Expanded(
                    child: _Metric(
                        value: '${metrics['upcomingScheduled'] ?? '—'}',
                        label: 'Programados',
                        color: const Color(0xff4f7df4))),
              ]),
              const Padding(
                  padding: EdgeInsets.fromLTRB(2, 20, 2, 8),
                  child: Text('Configuración operativa',
                      style: TextStyle(
                          fontSize: 18, fontWeight: FontWeight.w900))),
              ...visible
                  .where((item) => item.id != 'overview')
                  .map((item) => Card(
                        margin: const EdgeInsets.only(bottom: 9),
                        child: ListTile(
                          contentPadding: const EdgeInsets.symmetric(
                              horizontal: 14, vertical: 5),
                          leading: Container(
                              width: 42,
                              height: 42,
                              decoration: BoxDecoration(
                                  color: item.color.withValues(alpha: .12),
                                  borderRadius: BorderRadius.circular(12)),
                              child: Icon(item.icon, color: item.color)),
                          title: Text(item.title,
                              style:
                                  const TextStyle(fontWeight: FontWeight.w800)),
                          subtitle: Text(item.subtitle),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () => _open(item),
                        ),
                      )),
              Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: Text(
                      'Los cambios se validan, versionan y auditan en el mismo backend del panel web.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                          color: scheme.onSurfaceVariant, fontSize: 12))),
            ]),
      ),
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric(
      {required this.value, required this.label, required this.color});
  final String value, label;
  final Color color;
  @override
  Widget build(BuildContext context) => Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
          border:
              Border.all(color: Theme.of(context).colorScheme.outlineVariant),
          borderRadius: BorderRadius.circular(15)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(value,
            style: TextStyle(
                fontSize: 24, fontWeight: FontWeight.w900, color: color)),
        Text(label,
            style: TextStyle(
                color: Theme.of(context).colorScheme.onSurfaceVariant))
      ]));
}

class _AdminModuleScreen extends StatefulWidget {
  const _AdminModuleScreen(
      {required this.module, required this.token, required this.request});
  final _Module module;
  final String token;
  final MobileAdminRequest request;
  @override
  State<_AdminModuleScreen> createState() => _AdminModuleScreenState();
}

class _AdminModuleScreenState extends State<_AdminModuleScreen>
    with WidgetsBindingObserver {
  dynamic data;
  dynamic secondary;
  dynamic tertiary;
  String? error;
  bool busy = false;
  final fields = <String, TextEditingController>{};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    for (final value in fields.values) {
      value.dispose();
    }
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && !busy) unawaited(_load());
  }

  TextEditingController field(String key, Object? value) {
    return fields.putIfAbsent(
        key, () => TextEditingController(text: value?.toString() ?? ''));
  }

  Future<void> _load() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final paths = <String, String>{
        'fares': '/v1/admin/fare-rules',
        'dispatch': '/v1/admin/settings',
        'arrival': '/v1/admin/commercial-economics',
        'trips': '/v1/admin/operations',
        'scheduled': '/v1/admin/scheduled-arrival-settings',
        'cancellations': '/v1/admin/settings/passenger-cancellations',
        'wallet': '/v1/admin/commercial-economics',
        'memberships': '/v1/admin/membership-plans',
        'packages': '/v1/admin/commercial-economics',
        'advertising': '/v1/admin/banners',
        'notifications': '/v1/admin/notifications/smart/config',
        'flags': '/v1/admin/commercial-economics',
        'audit': '/v1/admin/audit'
      };
      if (widget.module.id == 'simulator') {
        data = {
          'tripType': 'IMMEDIATE',
          'billingMode': 'PAY_PER_USE',
          'round': 1,
          'journeyFare': '3.00'
        };
      } else {
        data = await widget.request('GET', paths[widget.module.id]!,
            token: widget.token);
      }
      if (widget.module.id == 'fares') {
        secondary = await widget.request('GET', '/v1/admin/fare-sectors',
            token: widget.token);
        tertiary = await widget.request(
            'GET', '/v1/mobile-admin/fare-suggestions',
            token: widget.token);
      }
      if (widget.module.id == 'arrival') {
        secondary = await widget.request('GET', '/v1/admin/pricing',
            token: widget.token);
      }
      if (widget.module.id == 'dispatch') {
        secondary = await widget.request(
            'GET', '/v1/admin/commercial-economics',
            token: widget.token);
      }
      if (widget.module.id == 'flags') {
        secondary = await widget.request(
            'GET', '/v1/admin/scheduled-arrival-settings',
            token: widget.token);
      }
      if (widget.module.id == 'wallet') {
        secondary = await widget.request(
            'GET', '/v1/admin/commercial-economics/wallets',
            token: widget.token);
        tertiary = await widget.request(
            'GET', '/v1/admin/commercial-economics/dashboard',
            token: widget.token);
      }
      if (widget.module.id == 'packages') {
        tertiary = await widget.request(
            'GET', '/v1/admin/commercial-economics/dashboard',
            token: widget.token);
      }
      if (widget.module.id == 'memberships') {
        secondary = await widget.request('GET', '/v1/admin/platform-settings',
            token: widget.token);
      }
      if (widget.module.id == 'cancellations') {
        secondary = await widget.request(
            'GET', '/v1/admin/commercial-economics',
            token: widget.token);
      }
      if (widget.module.id == 'trips' || widget.module.id == 'scheduled') {
        secondary = await widget.request('GET', '/v1/admin/settings',
            token: widget.token);
      }
      if (widget.module.id == 'advertising') {
        secondary = await widget.request('GET', '/v1/admin/platform-settings',
            token: widget.token);
      }
      if (mounted) {
        setState(() {
          fields.clear();
        });
      }
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<bool> _confirm(String impact) async =>
      await showDialog<bool>(
          context: context,
          builder: (dialog) => AlertDialog(
                  title: const Text('Confirmar cambio'),
                  content: Text(
                      '$impact\n\nSe aplicará únicamente a operaciones futuras. El backend volverá a validar la configuración.'),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(dialog, false),
                        child: const Text('Cancelar')),
                    FilledButton(
                        onPressed: () => Navigator.pop(dialog, true),
                        child: const Text('Confirmar cambio'))
                  ])) ??
      false;

  Future<void> _save(String path, Object body, String impact,
      {String method = 'PUT'}) async {
    if (!await _confirm(impact)) return;
    setState(() => busy = true);
    try {
      await widget.request(method, path, token: widget.token, body: body);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Configuración actualizada correctamente.')));
      fields.clear();
      await _load();
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
        appBar: AppBar(
            title:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(widget.module.title),
              Text(widget.module.subtitle,
                  style: const TextStyle(
                      fontSize: 12, fontWeight: FontWeight.w500))
            ]),
            actions: [
              IconButton(
                  tooltip: 'Actualizar datos vigentes',
                  onPressed: busy ? null : _load,
                  icon: const Icon(Icons.refresh_rounded))
            ]),
        body: busy && data == null
            ? const Center(child: CircularProgressIndicator())
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(padding: const EdgeInsets.all(16), children: [
                  if (error != null) _AdminError(message: error!, retry: _load),
                  if (data != null) _content()
                ])),
        floatingActionButton: busy
            ? const Padding(
                padding: EdgeInsets.all(12), child: CircularProgressIndicator())
            : null);
  }

  Widget _content() {
    return switch (widget.module.id) {
      'dispatch' => _dispatch(),
      'arrival' => _arrival(),
      'scheduled' => _scheduled(),
      'cancellations' => _cancellations(),
      'fares' => _fares(),
      'trips' => _trips(),
      'wallet' => _wallet(),
      'memberships' => _plans(false),
      'packages' => _plans(true),
      'advertising' => _advertising(),
      'notifications' => _notifications(),
      'flags' => _flags(),
      'simulator' => _simulator(),
      'audit' => _records(List<dynamic>.from(data), Icons.history),
      _ => const SizedBox.shrink()
    };
  }

  Widget _section(String title, String subtitle, List<Widget> children) => Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
          padding: const EdgeInsets.all(16),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title,
                style:
                    const TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
            Text(subtitle,
                style: TextStyle(
                    color: Theme.of(context).colorScheme.onSurfaceVariant)),
            const SizedBox(height: 14),
            ...children
          ])));
  Widget _number(String key, String label, Object? value,
          {String? suffix, bool refreshOnChange = false}) =>
      Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: TextField(
              controller: field(key, value),
              onChanged: refreshOnChange ? (_) => setState(() {}) : null,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(
                  labelText: label,
                  suffixText: suffix,
                  border: const OutlineInputBorder())));
  int _i(String key) => int.parse(fields[key]!.text.trim());
  double _d(String key) => double.parse(fields[key]!.text.trim());

  Widget _dispatch() {
    final d = Map<String, dynamic>.from(data);
    final initial = int.tryParse(
            field('initial', d['driverSearchInitialRadiusMeters']).text) ??
        0;
    final increment = int.tryParse(
            field('increment', d['driverSearchRadiusIncrementMeters']).text) ??
        1;
    final maximum =
        int.tryParse(field('maximum', d['searchRadiusMeters']).text) ?? 0;
    final rounds = <int>[];
    for (var radius = initial;
        radius <= maximum && rounds.length < 30;
        radius += increment) {
      rounds.add(radius);
      if (radius == maximum) break;
      if (radius + increment > maximum) rounds.add(maximum);
    }
    int countRounds(int start, int step, int end) {
      if (start <= 0 || step <= 0 || end < start) return 0;
      return 1 + ((end - start) / step).ceil();
    }

    final oldRounds = countRounds(
        (d['driverSearchInitialRadiusMeters'] as num).toInt(),
        (d['driverSearchRadiusIncrementMeters'] as num).toInt(),
        (d['searchRadiusMeters'] as num).toInt());
    final economics = secondary is Map
        ? Map<String, dynamic>.from(secondary['settings'] ?? {})
        : <String, dynamic>{};
    final fee = double.tryParse('${economics['feePerRound']}') ?? 0;
    final share = double.tryParse('${economics['costaGoPercent']}') ?? 0;
    return Column(children: [
      _section('Parámetros de búsqueda',
          'La vista previa usa la misma progresión oficial.', [
        _number(
            'initial', 'Radio inicial', d['driverSearchInitialRadiusMeters'],
            suffix: 'm'),
        _number('increment', 'Incremento por ronda',
            d['driverSearchRadiusIncrementMeters'],
            suffix: 'm'),
        _number('maximum', 'Radio máximo', d['searchRadiusMeters'],
            suffix: 'm'),
        _number('wait', 'Tiempo por ronda', d['driverSearchRoundWaitSeconds'],
            suffix: 's'),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (var n = 0; n < rounds.length; n++)
            Chip(label: Text('R${n + 1} · ${rounds[n]} m'))
        ]),
        const Divider(),
        Text(
            'Impacto: $oldRounds → ${rounds.length} rondas · tarifa máxima \$${(fee * oldRounds).toStringAsFixed(2)} → \$${(fee * rounds.length).toStringAsFixed(2)} · comisión máxima \$${(fee * oldRounds * share / 100).toStringAsFixed(2)} → \$${(fee * rounds.length * share / 100).toStringAsFixed(2)}')
      ]),
      FilledButton.icon(
          onPressed: busy
              ? null
              : () => _save(
                  '/v1/admin/settings',
                  {
                    ...d,
                    'expectedUpdatedAt': d['updatedAt'],
                    'driverSearchInitialRadiusMeters': _i('initial'),
                    'driverSearchRadiusIncrementMeters': _i('increment'),
                    'searchRadiusMeters': _i('maximum'),
                    'driverSearchRoundWaitSeconds': _i('wait')
                  },
                  'Cambiar radios y tiempos de despacho.\n\nRondas: $oldRounds → ${rounds.length}\nTarifa máxima: \$${(fee * oldRounds).toStringAsFixed(2)} → \$${(fee * rounds.length).toStringAsFixed(2)}\nComisión máxima: \$${(fee * oldRounds * share / 100).toStringAsFixed(2)} → \$${(fee * rounds.length * share / 100).toStringAsFixed(2)}',
                  method: 'PATCH'),
          icon: const Icon(Icons.save_outlined),
          label: const Text('Guardar cambios'))
    ]);
  }

  Widget _arrival() {
    final root = Map<String, dynamic>.from(data),
        settings = Map<String, dynamic>.from(root['settings']),
        pricing = List<dynamic>.from(secondary ?? const []);
    final current = pricing.isEmpty
        ? <String, dynamic>{}
        : Map<String, dynamic>.from(pricing.first);
    final rounds = (settings['rounds'] as num?)?.toInt() ??
        int.tryParse('${settings['rounds']}') ??
        1;
    final fee =
            double.tryParse(field('fee', settings['feePerRound']).text) ?? 0,
        share =
            double.tryParse(field('share', settings['costaGoPercent']).text) ??
                0;
    return Column(children: [
      _section('Tarifa de llegada',
          'Un valor por ronda; las siguientes se calculan automáticamente.', [
        _number('fee', 'Valor por ronda', settings['feePerRound'],
            suffix: 'USD', refreshOnChange: true),
        _number('share', 'Participación Costa-Go', settings['costaGoPercent'],
            suffix: '%', refreshOnChange: true),
        ...List.generate(
            rounds,
            (index) => ListTile(
                dense: true,
                title: Text('Ronda ${index + 1}'),
                trailing: Text(
                    '\$${(fee * (index + 1)).toStringAsFixed(2)} · Costa-Go \$${(fee * (index + 1) * share / 100).toStringAsFixed(2)}')))
      ]),
      FilledButton.icon(
          onPressed: busy || current.isEmpty
              ? null
              : () async {
                  final updatedFee = _d('fee');
                  final updatedShare = _d('share');
                  if (!await _confirm(
                      'Publicar una nueva versión de tarifa de llegada y actualizar el porcentaje Costa-Go.')) {
                    return;
                  }
                  setState(() => busy = true);
                  try {
                    await widget.request('POST', '/v1/admin/pricing',
                        token: widget.token,
                        body: {
                          ...current,
                          'platformCommissionCentsPerLeg':
                              (updatedFee * 100).round(),
                          'activeFrom': DateTime.now().toUtc().toIso8601String()
                        });
                    final config =
                        Map<String, dynamic>.from(settings['configuration']);
                    await widget.request(
                        'PUT', '/v1/admin/commercial-economics/configuration',
                        token: widget.token,
                        body: {
                          'version': settings['version'],
                          'configuration': config,
                          'costaGoPercent': updatedShare.toStringAsFixed(2)
                        });
                    if (!mounted) return;
                    setState(() {
                      fields['fee']?.text = updatedFee.toStringAsFixed(2);
                      fields['share']?.text = updatedShare.toStringAsFixed(2);
                    });
                    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                        content: Text(
                            'Tarifa vigente actualizada a \$${updatedFee.toStringAsFixed(2)} por ronda.')));
                    await _load();
                  } catch (value) {
                    if (mounted) setState(() => error = value.toString());
                  } finally {
                    if (mounted) setState(() => busy = false);
                  }
                },
          icon: const Icon(Icons.save_outlined),
          label: const Text('Confirmar nueva tarifa'))
    ]);
  }

  Widget _scheduled() {
    final root = Map<String, dynamic>.from(data),
        c = Map<String, dynamic>.from(root['configuration'] ?? {});
    final operations = secondary is Map
        ? Map<String, dynamic>.from(secondary)
        : <String, dynamic>{};
    return Column(children: [
      _section('Tarifa programada',
          'Se determina con la fecha y hora programada del pasajero.', [
        _number('dayFee', 'Tarifa de día', c['dayArrivalFee'], suffix: 'USD'),
        _number('nightFee', 'Tarifa de noche', c['nightArrivalFee'],
            suffix: 'USD'),
        TextField(
            controller: field('dayStart', c['dayStartTime']),
            decoration: const InputDecoration(
                labelText: 'Inicio del día', border: OutlineInputBorder())),
        const SizedBox(height: 12),
        TextField(
            controller: field('nightStart', c['nightStartTime']),
            decoration: const InputDecoration(
                labelText: 'Inicio de la noche', border: OutlineInputBorder()))
      ]),
      FilledButton.icon(
          onPressed: busy
              ? null
              : () => _save(
                  '/v1/admin/scheduled-arrival-settings',
                  {
                    'version': root['version'],
                    'configuration': {
                      ...c,
                      'enabled': c['enabled'] == true,
                      'dayArrivalFee': _d('dayFee').toStringAsFixed(2),
                      'nightArrivalFee': _d('nightFee').toStringAsFixed(2),
                      'dayStartTime': fields['dayStart']!.text,
                      'nightStartTime': fields['nightStart']!.text,
                      'timezone': c['timezone'] ?? 'America/Guayaquil'
                    }
                  },
                  'Cambiar tarifas y horarios de viajes programados.'),
          icon: const Icon(Icons.save_outlined),
          label: const Text('Guardar tarifas')),
      const SizedBox(height: 12),
      if (operations.isNotEmpty) ...[
        _section('Tiempos programados',
            'Parámetros operativos existentes del mismo panel web.', [
          _number('scheduledNotice', 'Anticipación mínima',
              operations['scheduledTripMinimumNoticeMinutes'],
              suffix: 'min'),
          _number('scheduledLead', 'Activación antes del viaje',
              operations['scheduledTripLeadMinutes'],
              suffix: 'min'),
          _number('scheduledReminder', 'Aviso al conductor',
              operations['scheduledTripDriverReminderMinutes'],
              suffix: 'min'),
          _number('scheduledGrace', 'Gracia de confirmación',
              operations['scheduledTripConfirmationGraceMinutes'],
              suffix: 'min')
        ]),
        OutlinedButton.icon(
            onPressed: busy
                ? null
                : () => _save(
                    '/v1/admin/settings',
                    {
                      ...operations,
                      'expectedUpdatedAt': operations['updatedAt'],
                      'scheduledTripMinimumNoticeMinutes':
                          _i('scheduledNotice'),
                      'scheduledTripLeadMinutes': _i('scheduledLead'),
                      'scheduledTripDriverReminderMinutes':
                          _i('scheduledReminder'),
                      'scheduledTripConfirmationGraceMinutes':
                          _i('scheduledGrace')
                    },
                    'Actualizar tiempos operativos de viajes programados.',
                    method: 'PATCH'),
            icon: const Icon(Icons.schedule),
            label: const Text('Guardar tiempos'))
      ]
    ]);
  }

  Widget _cancellations() {
    final d = Map<String, dynamic>.from(data),
        steps = List<dynamic>.from(d['steps'] ?? const []);
    final commercial = secondary is Map
        ? Map<String, dynamic>.from(secondary)
        : <String, dynamic>{};
    final commercialSettings = commercial['settings'] is Map
        ? Map<String, dynamic>.from(commercial['settings'])
        : <String, dynamic>{};
    final antiAbuse = commercialSettings['configuration'] is Map
        ? Map<String, dynamic>.from(commercialSettings['configuration'])
        : <String, dynamic>{};
    return Column(children: [
      _section('Reglas de pasajeros',
          'La sanción se evalúa en backend y queda auditada.', [
        SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Política activa'),
            value: d['enabled'] == true,
            onChanged: (v) => setState(() => data = {...d, 'enabled': v})),
        _number('cycle', 'Período de evaluación', d['cycleDurationDays'],
            suffix: 'días'),
        ...steps.map((s) => ListTile(
            title: Text('Desde ${s['fromCount']} cancelaciones'),
            trailing: Text(s['suspensionDays'] == null
                ? 'Aviso'
                : '${s['suspensionDays']} días')))
      ]),
      FilledButton(
          onPressed: busy
              ? null
              : () => _save(
                  '/v1/admin/settings/passenger-cancellations',
                  {...d, 'cycleDurationDays': _i('cycle')},
                  'Actualizar la política de cancelaciones de pasajeros.',
                  method: 'PATCH'),
          child: const Text('Guardar reglas')),
      const SizedBox(height: 12),
      if (antiAbuse.isNotEmpty) ...[
        _section(
            'Continuidad de búsqueda',
            'Controla si cancelar y buscar de nuevo conserva la ronda alcanzada.',
            [
              SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Conservar ronda al cancelar'),
                  subtitle: Text(
                      antiAbuse['preserveCancelledSearchRound'] == true
                          ? 'Activo: retoma desde la ronda alcanzada.'
                          : 'Inactivo: una nueva búsqueda empieza en R1.'),
                  value: antiAbuse['preserveCancelledSearchRound'] == true,
                  onChanged: (value) => setState(() => secondary = {
                        ...commercial,
                        'settings': {
                          ...commercialSettings,
                          'configuration': {
                            ...antiAbuse,
                            'preserveCancelledSearchRound': value
                          }
                        }
                      })),
              _number('searchSession', 'Duración de la búsqueda',
                  antiAbuse['searchSessionMinutes'],
                  suffix: 'min'),
              _number('sameRoute', 'Tolerancia del trayecto',
                  antiAbuse['sameRouteToleranceMeters'],
                  suffix: 'm')
            ]),
        OutlinedButton.icon(
            onPressed: busy
                ? null
                : () => _save(
                    '/v1/admin/commercial-economics/configuration',
                    {
                      'version': commercialSettings['version'],
                      'configuration': {
                        ...Map<String, dynamic>.from(
                            secondary['settings']['configuration']),
                        'searchSessionMinutes': _i('searchSession'),
                        'sameRouteToleranceMeters': _i('sameRoute')
                      },
                      'costaGoPercent':
                          commercialSettings['costaGoPercent'].toString()
                    },
                    'Actualizar la continuidad y ventana de búsqueda.'),
            icon: const Icon(Icons.shield_outlined),
            label: const Text('Guardar antiabuso'))
      ]
    ]);
  }

  Widget _fares() {
    final rules = List<dynamic>.from(data),
        sectors = List<dynamic>.from(secondary ?? const []),
        suggestions = List<dynamic>.from(tertiary ?? const []);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (suggestions.isNotEmpty)
        _section(
            'Trayectos recientes sin regla',
            'Se usó una tarifa sugerida. La regla nunca se crea automáticamente.',
            [
              for (final suggestion in suggestions)
                ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(
                        '${suggestion['originSector']} → ${suggestion['destinationSector']}',
                        style: const TextStyle(fontWeight: FontWeight.w800)),
                    subtitle: Text(
                        '${suggestion['uses']} usos · promedio ${_moneyCents(suggestion['averageFareCents'])}'),
                    trailing: TextButton(
                        onPressed: () => _editFare(suggestion),
                        child: const Text('Crear regla')))
            ]),
      _section('Sectores disponibles',
          '${sectors.length} sectores configurados en el panel web.', [
        Wrap(spacing: 7, children: [
          for (final s in sectors)
            Chip(label: Text(s['name']?.toString() ?? 'Sector'))
        ])
      ]),
      FilledButton.icon(
          onPressed: sectors.length < 2 ? null : () => _editFare(null),
          icon: const Icon(Icons.add),
          label: const Text('Nueva regla')),
      const SizedBox(height: 10),
      ...rules.map((r) => Card(
          child: ListTile(
              onTap: () => _editFare(Map<String, dynamic>.from(r)),
              title: Text('${r['originSector']} → ${r['destinationSector']}',
                  style: const TextStyle(fontWeight: FontWeight.w800)),
              subtitle: Text(
                  '${r['minimumPassengers']}–${r['maximumPassengers']} pasajeros · prioridad ${r['priority']}'),
              trailing: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(_moneyCents(r['dayTotalCents'])),
                    Text(r['enabled'] == true ? 'Activa' : 'Inactiva',
                        style: TextStyle(
                            color: r['enabled'] == true
                                ? Colors.green
                                : Colors.grey))
                  ]))))
    ]);
  }

  Future<void> _editFare(Map<String, dynamic>? existing) async {
    final sectors = List<dynamic>.from(secondary ?? const []);
    final validOrigins = sectors.where((candidate) {
      return sectors.any((other) =>
          other['serviceAreaId'] == candidate['serviceAreaId'] &&
          other['id'].toString() != candidate['id'].toString());
    }).toList();
    if (validOrigins.isEmpty) {
      setState(() => error =
          'Se necesitan al menos dos sectores en una misma zona para crear una regla.');
      return;
    }
    String origin = existing?['originSectorId']?.toString() ??
        validOrigins.first['id'].toString();
    if (!validOrigins.any((item) => item['id'].toString() == origin)) {
      origin = validOrigins.first['id'].toString();
    }
    final initialOrigin = sectors.firstWhere(
        (item) => item['id'].toString() == origin,
        orElse: () => validOrigins.first);
    final initialDestinations = sectors
        .where((item) =>
            item['serviceAreaId'] == initialOrigin['serviceAreaId'] &&
            item['id'].toString() != origin)
        .toList();
    String destination = existing?['destinationSectorId']?.toString() ??
        initialDestinations.first['id'].toString();
    final minimum =
        TextEditingController(text: '${existing?['minimumPassengers'] ?? 1}');
    final maximum =
        TextEditingController(text: '${existing?['maximumPassengers'] ?? 3}');
    final suggestedCents = existing?['averageFareCents'] is num
        ? (existing!['averageFareCents'] as num).toInt()
        : 0;
    final dayCents = existing?['dayTotalCents'] is num
        ? (existing!['dayTotalCents'] as num).toInt()
        : suggestedCents;
    final nightCents = existing?['nightTotalCents'] is num
        ? (existing!['nightTotalCents'] as num).toInt()
        : suggestedCents;
    final day =
        TextEditingController(text: (dayCents / 100).toStringAsFixed(2));
    final night =
        TextEditingController(text: (nightCents / 100).toStringAsFixed(2));
    final priority =
        TextEditingController(text: '${existing?['priority'] ?? 0}');
    var bidirectional = existing?['bidirectional'] != false;
    var enabled = existing?['enabled'] != false;
    final accepted = await showDialog<bool>(
        context: context,
        builder: (dialogContext) =>
            StatefulBuilder(builder: (context, setLocal) {
              final originSector = sectors.firstWhere(
                  (item) => item['id'].toString() == origin,
                  orElse: () => sectors.first);
              final destinations = sectors
                  .where((item) =>
                      item['serviceAreaId'] == originSector['serviceAreaId'] &&
                      item['id'].toString() != origin)
                  .toList();
              if (!destinations
                  .any((item) => item['id'].toString() == destination)) {
                destination = destinations.first['id'].toString();
              }
              return AlertDialog(
                  title: Text(existing?['id'] == null
                      ? 'Crear regla tarifaria'
                      : 'Editar regla tarifaria'),
                  content: SingleChildScrollView(
                      child: Column(mainAxisSize: MainAxisSize.min, children: [
                    DropdownButtonFormField<String>(
                        initialValue: origin,
                        decoration: const InputDecoration(
                            labelText: 'Origen', border: OutlineInputBorder()),
                        items: [
                          for (final sector in validOrigins)
                            DropdownMenuItem(
                                value: sector['id'].toString(),
                                child: Text(sector['name'].toString()))
                        ],
                        onChanged: (value) =>
                            setLocal(() => origin = value ?? origin)),
                    const SizedBox(height: 10),
                    DropdownButtonFormField<String>(
                        initialValue: destination,
                        decoration: const InputDecoration(
                            labelText: 'Destino', border: OutlineInputBorder()),
                        items: [
                          for (final sector in destinations)
                            DropdownMenuItem(
                                value: sector['id'].toString(),
                                child: Text(sector['name'].toString()))
                        ],
                        onChanged: (value) =>
                            destination = value ?? destination),
                    const SizedBox(height: 10),
                    TextField(
                        controller: minimum,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                            labelText: 'Pasajeros mínimos',
                            border: OutlineInputBorder())),
                    const SizedBox(height: 10),
                    TextField(
                        controller: maximum,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                            labelText: 'Pasajeros máximos',
                            border: OutlineInputBorder())),
                    const SizedBox(height: 10),
                    TextField(
                        controller: day,
                        keyboardType: const TextInputType.numberWithOptions(
                            decimal: true),
                        decoration: const InputDecoration(
                            labelText: 'Tarifa día (USD)',
                            border: OutlineInputBorder())),
                    const SizedBox(height: 10),
                    TextField(
                        controller: night,
                        keyboardType: const TextInputType.numberWithOptions(
                            decimal: true),
                        decoration: const InputDecoration(
                            labelText: 'Tarifa noche (USD)',
                            border: OutlineInputBorder())),
                    const SizedBox(height: 10),
                    TextField(
                        controller: priority,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                            labelText: 'Prioridad',
                            border: OutlineInputBorder())),
                    SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        title: const Text('Aplicar en ambos sentidos'),
                        subtitle: const Text(
                            'Origen y destino pueden intercambiarse.'),
                        value: bidirectional,
                        onChanged: (value) =>
                            setLocal(() => bidirectional = value)),
                    SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        title: const Text('Regla activa'),
                        value: enabled,
                        onChanged: (value) => setLocal(() => enabled = value))
                  ])),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(dialogContext, false),
                        child: const Text('Cancelar')),
                    FilledButton(
                        onPressed: () => Navigator.pop(dialogContext, true),
                        child: const Text('Continuar'))
                  ]);
            }));
    if (accepted != true || !mounted) return;
    if (!await _confirm(existing?['id'] == null
        ? 'Crear una regla para futuras cotizaciones.'
        : 'Actualizar esta regla para futuras cotizaciones.')) {
      return;
    }
    final originSector =
        sectors.firstWhere((item) => item['id'].toString() == origin);
    setState(() => busy = true);
    try {
      await widget
          .request('POST', '/v1/admin/fare-rules', token: widget.token, body: {
        if (existing?['id'] != null) 'id': existing!['id'],
        'serviceAreaId': originSector['serviceAreaId'],
        'originSectorId': origin,
        'destinationSectorId': destination,
        'minimumPassengers': int.parse(minimum.text),
        'maximumPassengers': int.parse(maximum.text),
        'dayTotalCents': (double.parse(day.text) * 100).round(),
        'nightTotalCents': (double.parse(night.text) * 100).round(),
        'bidirectional': bidirectional,
        'enabled': enabled,
        'priority': int.parse(priority.text)
      });
      fields.clear();
      await _load();
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      minimum.dispose();
      maximum.dispose();
      day.dispose();
      night.dispose();
      priority.dispose();
      if (mounted) setState(() => busy = false);
    }
  }

  Widget _trips() {
    final root = Map<String, dynamic>.from(data),
        metrics = Map<String, dynamic>.from(root['metrics'] ?? {}),
        active = List<dynamic>.from(root['activeTrips'] ?? const []);
    final operations = secondary is Map
        ? Map<String, dynamic>.from(secondary)
        : <String, dynamic>{};
    return Column(children: [
      Wrap(spacing: 9, runSpacing: 9, children: [
        _Metric(
            value: '${metrics['activeTrips'] ?? 0}',
            label: 'Activos',
            color: widget.module.color),
        _Metric(
            value: '${metrics['searchingTrips'] ?? 0}',
            label: 'Buscando',
            color: Colors.orange)
      ]),
      const SizedBox(height: 12),
      if (operations.isNotEmpty)
        _section('Parámetros del viaje',
            'Configuración operativa existente; no crea campos paralelos.', [
          _number('trackingGrace', 'Gracia de seguimiento',
              operations['tripTrackingGraceMinutes'],
              suffix: 'min'),
          _number('localDistance', 'Distancia de tarifa local',
              operations['localFareMaxDistanceMeters'],
              suffix: 'm'),
          _number('distanceFare', 'Tarifa por kilómetro',
              operations['distanceFareCentsPerKm'],
              suffix: 'ctvs'),
          _number('distanceMinimum', 'Tarifa mínima por distancia',
              operations['distanceFareMinimumCents'],
              suffix: 'ctvs'),
          OutlinedButton.icon(
              onPressed: busy
                  ? null
                  : () => _save(
                      '/v1/admin/settings',
                      {
                        ...operations,
                        'expectedUpdatedAt': operations['updatedAt'],
                        'tripTrackingGraceMinutes': _i('trackingGrace'),
                        'localFareMaxDistanceMeters': _i('localDistance'),
                        'distanceFareCentsPerKm': _i('distanceFare'),
                        'distanceFareMinimumCents': _i('distanceMinimum')
                      },
                      'Actualizar tiempos y tarifa por distancia para nuevos viajes.',
                      method: 'PATCH'),
              icon: const Icon(Icons.save_outlined),
              label: const Text('Guardar parámetros'))
        ]),
      ...active.map((t) => Card(
          child: ListTile(
              leading: const Icon(Icons.route),
              title: Text(
                  '${t['origin'] ?? 'Origen'} → ${t['destination'] ?? 'Destino'}'),
              subtitle: Text('${t['passenger']} · ${t['driver']}'),
              trailing: IconButton(
                  tooltip: 'Cancelar viaje',
                  onPressed: busy || t['id'] == null
                      ? null
                      : () => _cancelTrip(Map<String, dynamic>.from(t)),
                  icon: const Icon(Icons.cancel_outlined)))))
    ]);
  }

  Future<void> _cancelTrip(Map<String, dynamic> trip) async {
    final reason = TextEditingController();
    final accepted = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
                title: const Text('Cancelar viaje activo'),
                content: Column(mainAxisSize: MainAxisSize.min, children: [
                  Text(
                      '${trip['origin'] ?? 'Origen'} → ${trip['destination'] ?? 'Destino'}'),
                  const SizedBox(height: 12),
                  TextField(
                      controller: reason,
                      minLines: 2,
                      maxLines: 4,
                      decoration: const InputDecoration(
                          labelText: 'Motivo administrativo',
                          helperText: 'Quedará registrado en auditoría.',
                          border: OutlineInputBorder()))
                ]),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(dialogContext, false),
                      child: const Text('Volver')),
                  FilledButton(
                      onPressed: () => Navigator.pop(dialogContext, true),
                      child: const Text('Continuar'))
                ]));
    final value = reason.text.trim();
    reason.dispose();
    if (accepted != true || value.length < 5 || !mounted) {
      if (accepted == true && value.length < 5) {
        setState(() => error = 'Ingresa un motivo de al menos 5 caracteres.');
      }
      return;
    }
    if (!await _confirm(
        'Cancelar este viaje activo y liberar al conductor asignado.')) {
      return;
    }
    setState(() => busy = true);
    try {
      await widget.request('POST', '/v1/admin/trips/${trip['id']}/action',
          token: widget.token, body: {'action': 'CANCEL', 'reason': value});
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Viaje cancelado correctamente.')));
      }
      await _load();
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Widget _wallet() {
    final root = Map<String, dynamic>.from(data),
        s = Map<String, dynamic>.from(root['settings']),
        c = Map<String, dynamic>.from(s['configuration']);
    final walletRoot = secondary is Map
        ? Map<String, dynamic>.from(secondary)
        : <String, dynamic>{};
    final wallets = List<dynamic>.from(walletRoot['wallets'] ?? const []);
    final search = field('walletSearch', '');
    final needle = search.text.trim().toLowerCase();
    final visibleWallets = wallets
        .where((item) =>
            needle.isEmpty ||
            item['name'].toString().toLowerCase().contains(needle))
        .take(30)
        .toList();
    return Column(children: [
      _section('Pago por Uso', 'Recargas y protección de saldo.', [
        SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Pago por Uso activo'),
            value: c['enabled'] == true,
            onChanged: (v) => setState(() => data = {
                  ...root,
                  'settings': {
                    ...s,
                    'configuration': {...c, 'enabled': v}
                  }
                })),
        _number('minimum', 'Recarga mínima', c['minimumTopUp'], suffix: 'USD'),
        _number('maximum', 'Recarga máxima', c['maximumTopUp'], suffix: 'USD'),
        _number('low', 'Aviso de saldo bajo', c['lowBalanceThreshold'],
            suffix: 'USD'),
        const Divider(),
        ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.calculate_outlined),
            title: const Text('Referencias calculadas'),
            subtitle: Text(
                'Comisión mínima: \$${s['minimumArrival'] ?? '—'} · máxima: \$${s['maximumArrival'] ?? '—'}\nSaldo requerido en ronda máxima: \$${s['maximumArrival'] ?? '—'}'))
      ]),
      FilledButton(
          onPressed: busy
              ? null
              : () => _save(
                  '/v1/admin/commercial-economics/configuration',
                  {
                    'version': s['version'],
                    'configuration': {
                      ...Map<String, dynamic>.from(
                          (data['settings']['configuration'])),
                      'minimumTopUp': _d('minimum').toStringAsFixed(2),
                      'maximumTopUp': _d('maximum').toStringAsFixed(2),
                      'lowBalanceThreshold': _d('low').toStringAsFixed(2)
                    },
                    'costaGoPercent': s['costaGoPercent'].toString()
                  },
                  'Actualizar Pago por Uso y límites de recarga.'),
          child: const Text('Guardar cambios')),
      const SizedBox(height: 12),
      _section('Consulta de saldos',
          'Consulta financiera y ajustes mediante movimientos auditados.', [
        TextField(
            controller: search,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search),
                labelText: 'Buscar conductor',
                border: OutlineInputBorder())),
        const SizedBox(height: 10),
        if (visibleWallets.isEmpty)
          const Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: Text('No hay saldos que coincidan con la búsqueda.')),
        for (final item in visibleWallets)
          ListTile(
              contentPadding: EdgeInsets.zero,
              leading: CircleAvatar(
                  child: Icon(Icons.account_balance_wallet_outlined,
                      color: widget.module.color)),
              title: Text(item['name']?.toString() ?? 'Conductor'),
              subtitle: Text(
                  'Total \$${item['total']} · Reservado \$${item['reserved']}'),
              trailing: Text('\$${item['available']}',
                  style: const TextStyle(fontWeight: FontWeight.w900)),
              onTap: () => _openWallet(Map<String, dynamic>.from(item)))
      ])
    ]);
  }

  Future<void> _openWallet(Map<String, dynamic> wallet) async {
    setState(() => busy = true);
    try {
      final result = Map<String, dynamic>.from(await widget.request('GET',
          '/v1/admin/commercial-economics/wallets?driverId=${wallet['driverId']}',
          token: widget.token));
      final movements = List<dynamic>.from(result['movements'] ?? const []);
      if (!mounted) return;
      await showModalBottomSheet<void>(
          context: context,
          isScrollControlled: true,
          showDragHandle: true,
          builder: (sheetContext) => SafeArea(
              child: Padding(
                  padding: EdgeInsets.fromLTRB(20, 0, 20,
                      20 + MediaQuery.viewInsetsOf(sheetContext).bottom),
                  child: SizedBox(
                      height: MediaQuery.sizeOf(sheetContext).height * .72,
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(wallet['name']?.toString() ?? 'Conductor',
                                style: const TextStyle(
                                    fontSize: 22, fontWeight: FontWeight.w900)),
                            Text(
                                'Disponible \$${wallet['available']} · Reservado \$${wallet['reserved']}'),
                            const SizedBox(height: 12),
                            FilledButton.icon(
                                onPressed: () {
                                  Navigator.pop(sheetContext);
                                  _adjustWallet(wallet);
                                },
                                icon: const Icon(Icons.tune),
                                label: const Text('Registrar ajuste')),
                            const Divider(height: 24),
                            const Text('Movimientos recientes',
                                style: TextStyle(
                                    fontSize: 17, fontWeight: FontWeight.w800)),
                            Expanded(
                                child: movements.isEmpty
                                    ? const Center(
                                        child: Text('Sin movimientos.'))
                                    : ListView.builder(
                                        itemCount: movements.length,
                                        itemBuilder: (_, index) {
                                          final movement = movements[index];
                                          return ListTile(
                                              contentPadding: EdgeInsets.zero,
                                              title: Text(movement['kind']
                                                      ?.toString() ??
                                                  'Movimiento'),
                                              subtitle: Text(
                                                  movement['created_at']
                                                          ?.toString() ??
                                                      ''),
                                              trailing: Text(
                                                  '\$${movement['amount'] ?? '0.00'}',
                                                  style: const TextStyle(
                                                      fontWeight:
                                                          FontWeight.w800)));
                                        }))
                          ])))));
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _adjustWallet(Map<String, dynamic> wallet) async {
    final amount = TextEditingController();
    final reason = TextEditingController();
    final accepted = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
                title: const Text('Ajuste administrativo'),
                content: SingleChildScrollView(
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Text(
                      'Saldo disponible actual: \$${wallet['available'] ?? '0.00'}'),
                  const SizedBox(height: 12),
                  TextField(
                      controller: amount,
                      keyboardType: const TextInputType.numberWithOptions(
                          decimal: true, signed: true),
                      decoration: const InputDecoration(
                          labelText: 'Monto (+ o -)',
                          border: OutlineInputBorder())),
                  const SizedBox(height: 12),
                  TextField(
                      controller: reason,
                      minLines: 2,
                      maxLines: 4,
                      decoration: const InputDecoration(
                          labelText: 'Motivo',
                          helperText:
                              'Se registrará saldo anterior y posterior.',
                          border: OutlineInputBorder()))
                ])),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(dialogContext, false),
                      child: const Text('Cancelar')),
                  FilledButton(
                      onPressed: () => Navigator.pop(dialogContext, true),
                      child: const Text('Continuar'))
                ]));
    final amountValue = amount.text.trim();
    final reasonValue = reason.text.trim();
    amount.dispose();
    reason.dispose();
    if (accepted != true ||
        double.tryParse(amountValue) == null ||
        reasonValue.length < 5 ||
        !mounted) {
      if (accepted == true) {
        setState(() => error = 'Verifica el monto y escribe un motivo válido.');
      }
      return;
    }
    if (!await _confirm(
        'Registrar un movimiento administrativo de \$${double.parse(amountValue).toStringAsFixed(2)} para ${wallet['name']}.')) {
      return;
    }
    setState(() => busy = true);
    try {
      await widget.request('POST',
          '/v1/admin/commercial-economics/wallets/${wallet['driverId']}/adjust',
          token: widget.token,
          body: {
            'amount': double.parse(amountValue).toStringAsFixed(2),
            'reason': reasonValue,
            'idempotencyKey':
                'mobile-${wallet['driverId']}-${DateTime.now().microsecondsSinceEpoch}'
          });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Ajuste registrado como movimiento auditado.')));
      }
      await _load();
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Widget _plans(bool packages) {
    final list = packages
        ? List<dynamic>.from(data['plans'] ?? const [])
        : List<dynamic>.from(data);
    final selected = list
        .where((p) => packages
            ? p['quantity'] != null
            : p['planType'] == 'PERIODIC' && p['current'] == true)
        .toList();
    final graceDays = secondary is Map
        ? Map<String, dynamic>.from(secondary)['membershipGraceDays']
        : null;
    final vat = packages && data['settings'] is Map
        ? data['settings']['vatRatePercent']
        : selected.isEmpty
            ? null
            : selected.first['vatRatePercent'];
    final dashboard = tertiary is Map
        ? Map<String, dynamic>.from(tertiary)
        : <String, dynamic>{};
    final purchases = List<dynamic>.from(dashboard['packages'] ?? const []);
    double numeric(Object? value) =>
        value is num ? value.toDouble() : double.tryParse('$value') ?? 0;
    final theoretical = purchases.fold<double>(
        0, (sum, item) => sum + numeric(item['realTheoreticalCommission']));
    final margin = purchases.fold<double>(
        0, (sum, item) => sum + numeric(item['realMargin']));
    return Column(children: [
      if (packages)
        _section('Rentabilidad resumida',
            'Compras del período y consumo real acumulado.', [
          Row(children: [
            Expanded(
                child: _Metric(
                    value: '\$${theoretical.toStringAsFixed(2)}',
                    label: 'Comisión teórica',
                    color: widget.module.color)),
            const SizedBox(width: 8),
            Expanded(
                child: _Metric(
                    value: '\$${margin.toStringAsFixed(2)}',
                    label: 'Margen',
                    color: margin < 0 ? Colors.red : Colors.green))
          ]),
          Text('${purchases.length} compras consideradas')
        ]),
      for (final p in selected)
        Card(
            child: Padding(
                padding: const EdgeInsets.all(15),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(children: [
                        Expanded(
                            child: Text(
                                p['name']?.toString() ?? p['code'].toString(),
                                style: const TextStyle(
                                    fontSize: 17,
                                    fontWeight: FontWeight.w900))),
                        if (p['enabled'] != false)
                          const Chip(label: Text('Activo')),
                        IconButton(
                            tooltip: packages
                                ? 'Editar reglas comerciales'
                                : 'Crear nueva versión',
                            onPressed: busy
                                ? null
                                : () => packages
                                    ? _editPackageRule(
                                        Map<String, dynamic>.from(p))
                                    : _editPlan(Map<String, dynamic>.from(p)),
                            icon: const Icon(Icons.edit_outlined))
                      ]),
                      Text(packages
                          ? '${p['quantity']} viajes · precio actual \$${p['price']} · IVA ${vat ?? '—'}%'
                          : '${p['durationDays']} días · ${p['includedTrips']} viajes · \$${p['baseAmount']} + IVA ${p['vatRatePercent'] ?? '—'}%'),
                      if (!packages)
                        Text(
                            'Gracia: ${graceDays ?? '—'} días · Tope: \$${p['maxRenewalAmount']} · Excedente: ${p['extraTripSharePercent']}%'),
                      if (packages && p['calculation'] is Map) ...[
                        const Divider(),
                        Text(
                            'Técnico: \$${p['calculation']['technicalCost'] ?? '—'}'),
                        Text(
                            'Sugerido: \$${p['calculation']['suggestedPrice'] ?? '—'}'),
                        Text(
                            'Ronda promedio: ${p['calculation']['meanRound'] ?? '—'}'),
                        Text(
                            'Comisión promedio: \$${p['calculation']['expectedCommissionPerTrip'] ?? '—'} · Muestras: ${p['calculation']['sampleCount'] ?? '—'}'),
                        Text(
                            'Ámbito: ${p['calculation']['scope'] ?? '—'} · Diferencia: ${p['calculation']['percentageDifference'] ?? '—'}%'),
                        Text(
                            'Factor: ${p['rule']?['commercial_factor'] ?? '—'} · Descuento: ${p['rule']?['volume_discount_percent'] ?? '—'}%'),
                        const SizedBox(height: 10),
                        Row(children: [
                          Expanded(
                              child: OutlinedButton(
                                  onPressed: busy
                                      ? null
                                      : () async {
                                          setState(() => busy = true);
                                          try {
                                            await widget.request('POST',
                                                '/v1/admin/commercial-economics/packages/${p['id']}/recalculate',
                                                token: widget.token);
                                            await _load();
                                          } catch (value) {
                                            if (mounted) {
                                              setState(() =>
                                                  error = value.toString());
                                            }
                                          } finally {
                                            if (mounted) {
                                              setState(() => busy = false);
                                            }
                                          }
                                        },
                                  child: const Text('Recalcular'))),
                          const SizedBox(width: 8),
                          Expanded(
                              child: FilledButton(
                                  onPressed: busy || p['calculationId'] == null
                                      ? null
                                      : () async {
                                          if (!await _confirm(
                                              'Aplicar el precio sugerido solo a compras futuras.')) {
                                            return;
                                          }
                                          setState(() => busy = true);
                                          try {
                                            await widget.request('POST',
                                                '/v1/admin/commercial-economics/packages/${p['id']}/apply-suggested-price',
                                                token: widget.token,
                                                body: {
                                                  'calculationId':
                                                      p['calculationId'],
                                                  'confirm': true
                                                });
                                            await _load();
                                          } catch (value) {
                                            if (mounted) {
                                              setState(() =>
                                                  error = value.toString());
                                            }
                                          } finally {
                                            if (mounted) {
                                              setState(() => busy = false);
                                            }
                                          }
                                        },
                                  child: const Text('Aplicar sugerido')))
                        ])
                      ]
                    ])))
    ]);
  }

  Future<void> _editPlan(Map<String, dynamic> plan) async {
    final name = TextEditingController(text: plan['name']?.toString());
    final price = TextEditingController(text: plan['baseAmount']?.toString());
    final duration =
        TextEditingController(text: plan['durationDays']?.toString());
    final included =
        TextEditingController(text: plan['includedTrips']?.toString());
    final maximum =
        TextEditingController(text: plan['maxRenewalAmount']?.toString());
    final extra =
        TextEditingController(text: plan['extraTripSharePercent']?.toString());
    final accepted = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
                title: const Text('Nueva versión del plan'),
                content: SingleChildScrollView(
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                  _dialogField(name, 'Nombre', numeric: false),
                  _dialogField(price, 'Precio sin IVA', decimal: true),
                  _dialogField(duration, 'Duración (días)'),
                  _dialogField(included, 'Viajes incluidos'),
                  _dialogField(maximum, 'Tope del período', decimal: true),
                  _dialogField(extra, 'Participación en excedentes (%)',
                      decimal: true)
                ])),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(dialogContext, false),
                      child: const Text('Cancelar')),
                  FilledButton(
                      onPressed: () => Navigator.pop(dialogContext, true),
                      child: const Text('Continuar'))
                ]));
    final values = [
      name.text,
      price.text,
      duration.text,
      included.text,
      maximum.text,
      extra.text
    ];
    for (final controller in [
      name,
      price,
      duration,
      included,
      maximum,
      extra
    ]) {
      controller.dispose();
    }
    if (accepted != true || values.any((value) => value.trim().isEmpty)) return;
    if (!await _confirm(
        'Publicar una nueva versión de ${plan['name']}; los contratos existentes conservarán sus condiciones.')) {
      return;
    }
    setState(() => busy = true);
    try {
      await widget.request(
          'POST', '/v1/admin/membership-plans/${plan['id']}/versions',
          token: widget.token,
          body: {
            'name': values[0].trim(),
            'periodUnit': plan['periodUnit'],
            'periodCount': plan['periodCount'],
            'durationDays': int.parse(values[2]),
            'baseAmount': double.parse(values[1]),
            'currency': plan['currency'],
            'includedTrips': int.parse(values[3]),
            'maxRenewalAmount': double.parse(values[4]),
            'extraTripSharePercent': double.parse(values[5]),
            'packValidityDays': null
          });
      fields.clear();
      await _load();
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _editPackageRule(Map<String, dynamic> plan) async {
    final rule = plan['rule'] is Map
        ? Map<String, dynamic>.from(plan['rule'])
        : <String, dynamic>{};
    final factor = TextEditingController(
        text: rule['commercial_factor']?.toString() ?? '1.00');
    final discount = TextEditingController(
        text: rule['volume_discount_percent']?.toString() ?? '0.00');
    final fixed =
        TextEditingController(text: rule['fixed_cost']?.toString() ?? '0.00');
    final minimum = TextEditingController(
        text: rule['minimum_price']?.toString() ?? '0.00');
    final accepted = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
                title: Text('Reglas · ${plan['name']}'),
                content: SingleChildScrollView(
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                  _dialogField(factor, 'Factor comercial', decimal: true),
                  _dialogField(discount, 'Descuento por volumen (%)',
                      decimal: true),
                  _dialogField(fixed, 'Costo fijo', decimal: true),
                  _dialogField(minimum, 'Precio mínimo', decimal: true)
                ])),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(dialogContext, false),
                      child: const Text('Cancelar')),
                  FilledButton(
                      onPressed: () => Navigator.pop(dialogContext, true),
                      child: const Text('Continuar'))
                ]));
    final values = [factor.text, discount.text, fixed.text, minimum.text];
    for (final controller in [factor, discount, fixed, minimum]) {
      controller.dispose();
    }
    if (accepted != true ||
        values.any((value) => double.tryParse(value) == null)) {
      return;
    }
    await _save(
        '/v1/admin/commercial-economics/packages/${plan['id']}/rules',
        {
          'version': rule['version'] is num
              ? (rule['version'] as num).toInt()
              : int.tryParse('${rule['version']}') ?? 0,
          'commercialFactor': double.parse(values[0]).toString(),
          'volumeDiscountPercent': double.parse(values[1]).toString(),
          'fixedCost': double.parse(values[2]).toStringAsFixed(2),
          'minimumPrice': double.parse(values[3]).toStringAsFixed(2),
          'serviceAreaId': rule['service_area_id']
        },
        'Actualizar el cálculo técnico y sugerido de este paquete.');
  }

  Widget _dialogField(TextEditingController controller, String label,
          {bool decimal = false, bool numeric = true}) =>
      Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: TextField(
              controller: controller,
              keyboardType: numeric
                  ? TextInputType.numberWithOptions(decimal: decimal)
                  : TextInputType.text,
              decoration: InputDecoration(
                  labelText: label, border: const OutlineInputBorder())));

  Widget _flags() {
    final root = Map<String, dynamic>.from(data),
        s = Map<String, dynamic>.from(root['settings']),
        c = Map<String, dynamic>.from(s['configuration']);
    return _section('Funciones disponibles',
        'Solo aparecen funciones que el backend activa dinámicamente.', [
      SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('Pago por Uso y tarifa por rondas'),
          subtitle: const Text('Nuevas operaciones'),
          value: c['enabled'] == true,
          onChanged: busy
              ? null
              : (value) => _save(
                  '/v1/admin/commercial-economics/configuration',
                  {
                    'version': s['version'],
                    'configuration': {...c, 'enabled': value},
                    'costaGoPercent': s['costaGoPercent'].toString()
                  },
                  value
                      ? 'Activar Pago por Uso y tarifa por rondas.'
                      : 'Desactivar Pago por Uso y tarifa por rondas.')),
      ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.calendar_month_outlined),
          title: const Text('Viajes programados'),
          subtitle: const Text('Tarifa día/noche dinámica'),
          trailing: Switch(
              value: secondary?['configuration']?['enabled'] == true,
              onChanged: busy
                  ? null
                  : (value) {
                      final scheduled = Map<String, dynamic>.from(secondary);
                      final configuration =
                          Map<String, dynamic>.from(scheduled['configuration']);
                      _save(
                          '/v1/admin/scheduled-arrival-settings',
                          {
                            'version': scheduled['version'],
                            'configuration': {
                              ...configuration,
                              'enabled': value
                            }
                          },
                          value
                              ? 'Activar tarifa para viajes programados.'
                              : 'Desactivar tarifa para viajes programados.');
                    }))
    ]);
  }

  Widget _advertising() {
    final records = List<dynamic>.from(data);
    final settings = secondary is Map
        ? Map<String, dynamic>.from(secondary)
        : <String, dynamic>{};
    return Column(children: [
      if (settings.isNotEmpty) ...[
        _section('Rotación y límites',
            'La misma configuración operativa utilizada por el panel web.', [
          _number('adRotation', 'Tiempo de rotación',
              settings['advertisingRotationSeconds'],
              suffix: 's'),
          _number('adZoneLimit', 'Máximo activo por zona',
              settings['advertisingMaxActivePerZone'])
        ]),
        OutlinedButton.icon(
            onPressed: busy
                ? null
                : () => _save(
                    '/v1/admin/platform-settings',
                    {
                      ...settings,
                      'expectedUpdatedAt': settings['updatedAt'],
                      'advertisingRotationSeconds': _i('adRotation'),
                      'advertisingMaxActivePerZone': _i('adZoneLimit')
                    },
                    'Actualizar rotación y límite de publicidad por zona.',
                    method: 'PATCH'),
            icon: const Icon(Icons.save_outlined),
            label: const Text('Guardar parámetros')),
        const SizedBox(height: 12)
      ],
      if (records.isEmpty)
        const Padding(
            padding: EdgeInsets.all(32),
            child: Text('No hay espacios institucionales configurados.')),
      for (final item in records)
        Card(
            child: SwitchListTile(
                secondary:
                    Icon(Icons.campaign_outlined, color: widget.module.color),
                title: Text(item['title']?.toString() ?? 'Publicidad',
                    style: const TextStyle(fontWeight: FontWeight.w800)),
                subtitle: Text(
                    '${item['placement'] ?? ''} · ${item['displayStatus'] ?? ''}'),
                value: item['active'] == true,
                onChanged: busy
                    ? null
                    : (value) async {
                        if (!await _confirm(value
                            ? 'Activar este espacio publicitario.'
                            : 'Desactivar este espacio publicitario.')) {
                          return;
                        }
                        setState(() => busy = true);
                        try {
                          await widget.request(
                              'PATCH', '/v1/admin/banners/${item['id']}',
                              token: widget.token, body: {'active': value});
                          await _load();
                        } catch (failure) {
                          if (mounted) {
                            setState(() => error = failure.toString());
                          }
                        } finally {
                          if (mounted) setState(() => busy = false);
                        }
                      }))
    ]);
  }

  Widget _notifications() {
    final current = Map<String, dynamic>.from(data);
    return Column(children: [
      _section('Notificaciones inteligentes',
          'Configuración dinámica; nunca expone credenciales Firebase.', [
        DropdownButtonFormField<String>(
            initialValue: current['mode']?.toString(),
            decoration: const InputDecoration(
                labelText: 'Modo', border: OutlineInputBorder()),
            items: const [
              DropdownMenuItem(value: 'OFF', child: Text('Desactivado')),
              DropdownMenuItem(value: 'TEST', child: Text('Solo pruebas')),
              DropdownMenuItem(value: 'ON', child: Text('Activo'))
            ],
            onChanged: (value) =>
                setState(() => data = {...current, 'mode': value})),
        for (final entry in const [
          ('frequentTripEnabled', 'Viajes frecuentes'),
          ('returnTripEnabled', 'Regreso habitual'),
          ('favoriteDestinationEnabled', 'Destinos favoritos'),
          ('reactivationEnabled', 'Reactivación')
        ])
          SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(entry.$2),
              value: data[entry.$1] == true,
              onChanged: (value) => setState(() =>
                  data = {...Map<String, dynamic>.from(data), entry.$1: value}))
      ]),
      FilledButton.icon(
          onPressed: busy
              ? null
              : () {
                  final payload = Map<String, dynamic>.from(data)
                    ..remove('lastSchedulerRunAt')
                    ..remove('updatedAt');
                  _save('/v1/admin/notifications/smart/config', payload,
                      'Actualizar notificaciones inteligentes.');
                },
          icon: const Icon(Icons.save_outlined),
          label: const Text('Guardar configuración'))
    ]);
  }

  Widget _simulator() {
    final d = Map<String, dynamic>.from(data);
    return Column(children: [
      _section('Escenario', 'No crea viajes ni modifica saldos.', [
        DropdownButtonFormField<String>(
            initialValue: d['tripType'],
            decoration: const InputDecoration(
                labelText: 'Tipo de viaje', border: OutlineInputBorder()),
            items: const [
              DropdownMenuItem(value: 'IMMEDIATE', child: Text('Inmediato')),
              DropdownMenuItem(
                  value: 'SCHEDULED_DAY', child: Text('Programado día')),
              DropdownMenuItem(
                  value: 'SCHEDULED_NIGHT', child: Text('Programado noche'))
            ],
            onChanged: (v) => setState(() => data = {...d, 'tripType': v})),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
            initialValue: d['billingMode'],
            decoration: const InputDecoration(
                labelText: 'Modalidad', border: OutlineInputBorder()),
            items: const [
              DropdownMenuItem(
                  value: 'PAY_PER_USE', child: Text('Pago por Uso')),
              DropdownMenuItem(
                  value: 'PERIOD_PLAN_INCLUDED', child: Text('Plan incluido')),
              DropdownMenuItem(
                  value: 'PERIOD_PLAN_OVERAGE', child: Text('Plan excedido')),
              DropdownMenuItem(
                  value: 'PERIOD_PLAN_CAP_REACHED',
                  child: Text('Plan con tope alcanzado')),
              DropdownMenuItem(
                  value: 'TRIP_PACKAGE', child: Text('Paquete por viajes'))
            ],
            onChanged: (v) => setState(() => data = {...d, 'billingMode': v})),
        const SizedBox(height: 12),
        _number('round', 'Ronda', d['round']),
        _number('journey', 'Tarifa del trayecto', d['journeyFare'],
            suffix: 'USD')
      ]),
      FilledButton.icon(
          onPressed: busy
              ? null
              : () async {
                  setState(() => busy = true);
                  try {
                    final result = await widget.request(
                        'POST', '/v1/mobile-admin/simulate',
                        token: widget.token,
                        body: {
                          ...Map<String, dynamic>.from(data),
                          'round': _i('round'),
                          'journeyFare': _d('journey').toStringAsFixed(2)
                        });
                    if (mounted) {
                      await _showSimulationResult(
                          Map<String, dynamic>.from(result),
                          Map<String, dynamic>.from(data));
                    }
                  } catch (v) {
                    if (mounted) setState(() => error = v.toString());
                  } finally {
                    if (mounted) setState(() => busy = false);
                  }
                },
          icon: const Icon(Icons.play_arrow),
          label: const Text('Simular'))
    ]);
  }

  Future<void> _showSimulationResult(
      Map<String, dynamic> result, Map<String, dynamic> scenario) async {
    final tripType = scenario['tripType']?.toString() ?? 'IMMEDIATE';
    final billingMode = scenario['billingMode']?.toString() ?? 'PAY_PER_USE';
    final scheduled = tripType != 'IMMEDIATE';
    final tripLabel = switch (tripType) {
      'SCHEDULED_DAY' => 'Programado día',
      'SCHEDULED_NIGHT' => 'Programado noche',
      _ => 'Viaje inmediato'
    };
    final billingLabel = switch (billingMode) {
      'PERIOD_PLAN_INCLUDED' => 'Plan incluido',
      'PERIOD_PLAN_OVERAGE' => 'Excedente de plan',
      'PERIOD_PLAN_CAP_REACHED' => 'Tope alcanzado',
      'TRIP_PACKAGE' => 'Paquete de viajes',
      _ => 'Pago por uso'
    };
    final arrivalFee =
        result['arrivalFee'] ?? result['scheduledArrivalFee'] ?? '0.00';
    final coverage = result['coverageStatus']?.toString() ?? '';
    final canOperate = coverage != 'TOPE_ALCANZADO';
    final requirementTitle = switch (coverage) {
      'VIAJE_INCLUIDO' => 'Viaje cubierto por el plan',
      'EXCEDENTE_BAJO_TOPE' => 'Excedente permitido',
      'TOPE_ALCANZADO' => 'Tope del plan alcanzado',
      'COMISION_INCLUIDA_PREPAGADA' => 'Viaje cubierto por el paquete',
      _ => 'Puede operar'
    };
    final requirementDescription = switch (coverage) {
      'VIAJE_INCLUIDO' =>
        'El viaje está incluido y no descuenta saldo Costa-Go.',
      'EXCEDENTE_BAJO_TOPE' =>
        'La comisión indicada se aplica como viaje excedente.',
      'TOPE_ALCANZADO' =>
        'Este escenario requiere renovar o cambiar la modalidad.',
      'COMISION_INCLUIDA_PREPAGADA' =>
        'El viaje se descuenta del paquete y no del saldo.',
      _ =>
        'El conductor necesita al menos ${_moneyAmount(result['balanceRequired'])} de saldo disponible.'
    };

    await showDialog<void>(
        context: context,
        builder: (dialogContext) {
          final colors = Theme.of(dialogContext).colorScheme;
          return Dialog(
              insetPadding:
                  const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(28)),
              child: ConstrainedBox(
                  constraints:
                      const BoxConstraints(maxWidth: 520, maxHeight: 760),
                  child: SingleChildScrollView(
                      padding: const EdgeInsets.all(22),
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Expanded(
                                      child: Column(
                                          crossAxisAlignment:
                                              CrossAxisAlignment.start,
                                          children: [
                                        Text('Resultado del escenario',
                                            style: TextStyle(
                                                fontSize: 25,
                                                fontWeight: FontWeight.w900)),
                                        SizedBox(height: 4),
                                        Text(
                                            'Simulación sin generar cobros ni viajes reales.')
                                      ])),
                                  IconButton(
                                      tooltip: 'Cerrar',
                                      onPressed: () =>
                                          Navigator.pop(dialogContext),
                                      icon: const Icon(Icons.close, size: 30))
                                ]),
                            const SizedBox(height: 18),
                            Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 8, vertical: 14),
                                decoration: BoxDecoration(
                                    color: colors.primaryContainer
                                        .withValues(alpha: .38),
                                    borderRadius: BorderRadius.circular(18)),
                                child: Row(children: [
                                  Expanded(
                                      child: _simulationFact(
                                          scheduled
                                              ? Icons.calendar_month_outlined
                                              : Icons.local_taxi_outlined,
                                          tripLabel)),
                                  Expanded(
                                      child: _simulationFact(
                                          Icons.payment_outlined,
                                          billingLabel)),
                                  if (!scheduled)
                                    Expanded(
                                        child: _simulationFact(Icons.sync,
                                            'Ronda ${result['matchedRound'] ?? scenario['round']}'))
                                ])),
                            const SizedBox(height: 16),
                            _simulationCard(
                                icon: Icons.attach_money,
                                color: colors.primary,
                                title: 'Resumen económico',
                                subtitle: 'Lo que paga el pasajero',
                                children: [
                                  _simulationAmountRow('Tarifa del trayecto',
                                      result['journeyFare']),
                                  _simulationAmountRow(
                                      'Tarifa de llegada', arrivalFee),
                                  const Divider(height: 18),
                                  _simulationAmountRow('Total pasajero',
                                      result['passengerTotal'],
                                      emphasized: true)
                                ]),
                            const SizedBox(height: 14),
                            _simulationCard(
                                icon: Icons.person_outline,
                                color: const Color(0xff00a873),
                                title: 'Distribución del pago',
                                subtitle: 'Cómo se divide el ingreso',
                                children: [
                                  _simulationAmountRow('Comisión Costa-Go',
                                      result['appliedCommission']),
                                  const Divider(height: 18),
                                  _simulationAmountRow('Ganancia conductor',
                                      result['driverProfit'],
                                      emphasized: true)
                                ]),
                            const SizedBox(height: 14),
                            _simulationCard(
                                icon: Icons.verified_user_outlined,
                                color: canOperate
                                    ? const Color(0xff6657e8)
                                    : colors.error,
                                title: 'Requisito operativo',
                                subtitle: billingMode == 'PAY_PER_USE'
                                    ? 'Saldo en la cuenta del conductor'
                                    : 'Condición de la modalidad elegida',
                                children: [
                                  if (billingMode == 'PAY_PER_USE')
                                    _simulationAmountRow('Saldo requerido',
                                        result['balanceRequired']),
                                  Container(
                                      margin: const EdgeInsets.only(top: 8),
                                      padding: const EdgeInsets.all(14),
                                      decoration: BoxDecoration(
                                          color: (canOperate
                                                  ? const Color(0xff16a765)
                                                  : colors.error)
                                              .withValues(alpha: .13),
                                          borderRadius:
                                              BorderRadius.circular(14)),
                                      child: Row(children: [
                                        Icon(
                                            canOperate
                                                ? Icons.check_circle
                                                : Icons.error,
                                            color: canOperate
                                                ? const Color(0xff078647)
                                                : colors.error),
                                        const SizedBox(width: 10),
                                        Expanded(
                                            child: Text(requirementTitle,
                                                style: TextStyle(
                                                    color: canOperate
                                                        ? const Color(
                                                            0xff078647)
                                                        : colors.error,
                                                    fontSize: 17,
                                                    fontWeight:
                                                        FontWeight.w900)))
                                      ])),
                                  Padding(
                                      padding: const EdgeInsets.only(top: 8),
                                      child: Text(requirementDescription))
                                ]),
                            const SizedBox(height: 18),
                            Row(children: [
                              Expanded(
                                  child: OutlinedButton(
                                      onPressed: () =>
                                          Navigator.pop(dialogContext),
                                      child: const Text('Ajustar simulación'))),
                              const SizedBox(width: 10),
                              Expanded(
                                  child: FilledButton(
                                      onPressed: () =>
                                          Navigator.pop(dialogContext),
                                      child: const Text('Cerrar')))
                            ])
                          ]))));
        });
  }

  Widget _simulationFact(IconData icon, String label) => Padding(
      padding: const EdgeInsets.symmetric(horizontal: 5),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, color: const Color(0xff156ac7)),
        const SizedBox(height: 6),
        Text(label,
            textAlign: TextAlign.center,
            style: const TextStyle(fontWeight: FontWeight.w800))
      ]));

  Widget _simulationCard(
          {required IconData icon,
          required Color color,
          required String title,
          required String subtitle,
          required List<Widget> children}) =>
      Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
              border: Border.all(
                  color: Theme.of(context).colorScheme.outlineVariant),
              borderRadius: BorderRadius.circular(20)),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                      color: color.withValues(alpha: .13),
                      shape: BoxShape.circle),
                  child: Icon(icon, color: color, size: 28)),
              const SizedBox(width: 12),
              Expanded(
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                    Text(title,
                        style: const TextStyle(
                            fontSize: 19, fontWeight: FontWeight.w900)),
                    Text(subtitle,
                        style: TextStyle(
                            color:
                                Theme.of(context).colorScheme.onSurfaceVariant))
                  ]))
            ]),
            const SizedBox(height: 14),
            ...children
          ]));

  Widget _simulationAmountRow(String label, Object? amount,
          {bool emphasized = false}) =>
      Container(
          padding: EdgeInsets.symmetric(
              horizontal: emphasized ? 12 : 0, vertical: 9),
          decoration: emphasized
              ? BoxDecoration(
                  color: Theme.of(context)
                      .colorScheme
                      .primaryContainer
                      .withValues(alpha: .38),
                  borderRadius: BorderRadius.circular(12))
              : null,
          child: Row(children: [
            Expanded(
                child: Text(label,
                    style: TextStyle(
                        fontSize: emphasized ? 17 : 16,
                        fontWeight:
                            emphasized ? FontWeight.w900 : FontWeight.w500))),
            Text(_moneyAmount(amount),
                style: TextStyle(
                    fontSize: emphasized ? 23 : 18,
                    fontWeight: FontWeight.w900,
                    color: emphasized
                        ? Theme.of(context).colorScheme.primary
                        : null))
          ]));

  String _moneyAmount(Object? value) {
    final amount = value is num
        ? value.toDouble()
        : double.tryParse(value?.toString() ?? '') ?? 0;
    return '\$${amount.toStringAsFixed(2)}';
  }

  Widget _records(List<dynamic> records, IconData icon) => Column(children: [
        if (records.isEmpty)
          const Padding(
              padding: EdgeInsets.all(32),
              child: Text('No hay registros para mostrar.')),
        for (final item in records)
          Card(
              child: ListTile(
                  leading: Icon(icon, color: widget.module.color),
                  title: Text(item['title']?.toString() ??
                      item['action']?.toString() ??
                      item['name']?.toString() ??
                      'Registro'),
                  subtitle: Text(item['detail']?.toString() ??
                      item['advertiserName']?.toString() ??
                      item['entity']?.toString() ??
                      ''),
                  trailing: item['createdAt'] != null
                      ? Text(item['createdAt'].toString().substring(0, 10))
                      : null))
      ]);
  String _moneyCents(Object? value) {
    final cents = value is num ? value.toInt() : int.tryParse('$value') ?? 0;
    return '\$${(cents / 100).toStringAsFixed(2)}';
  }
}

class _AdminError extends StatelessWidget {
  const _AdminError({required this.message, required this.retry});
  final String message;
  final VoidCallback retry;
  @override
  Widget build(BuildContext context) => Padding(
      padding: const EdgeInsets.all(20),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.cloud_off_outlined,
            size: 42, color: Theme.of(context).colorScheme.error),
        const SizedBox(height: 8),
        Text(message, textAlign: TextAlign.center),
        const SizedBox(height: 10),
        OutlinedButton.icon(
            onPressed: retry,
            icon: const Icon(Icons.refresh),
            label: const Text('Reintentar'))
      ]));
}
