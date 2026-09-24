import 'dart:async';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

typedef CampaignData = Map<String, dynamic>;

/// Session-scoped, memory-only cache. Financial rewards and advertising are unrelated.
class CostaGoCampaignStore extends ChangeNotifier {
  CostaGoCampaignStore(
      {required this.load,
      required this.detail,
      required this.imageUrl,
      required this.headers,
      this.ttl = const Duration(minutes: 5)});
  final Future<CampaignData> Function() load;
  final Future<CampaignData> Function(String id) detail;
  final String Function(CampaignData campaign, String kind) imageUrl;
  final Map<String, String> headers;
  final Duration ttl;
  List<CampaignData> _items = [];
  DateTime? _loadedAt;
  Duration _clockOffset = Duration.zero;
  Future<void>? _pending;
  Timer? _expiration;
  Timer? _itemExpiration;
  bool _disposed = false;
  bool loading = false;
  String? error;
  DateTime get serverNow => DateTime.now().add(_clockOffset);
  bool current(CampaignData item) {
    final start = DateTime.tryParse(item['startsAt']?.toString() ?? '');
    final end = DateTime.tryParse(item['endsAt']?.toString() ?? '');
    return start != null &&
        end != null &&
        !serverNow.isBefore(start) &&
        serverNow.isBefore(end);
  }

  List<CampaignData> forPlacement(String placement) => _items
      .where((item) =>
          current(item) &&
          (item['placements'] as List? ?? []).contains(placement))
      .toList();
  Future<void> refresh({bool force = false}) {
    if (_disposed) return Future.value();
    if (_pending != null) return _pending!;
    if (!force &&
        _loadedAt != null &&
        DateTime.now().difference(_loadedAt!) < ttl) {
      return Future.value();
    }
    return _pending = _refresh().whenComplete(() => _pending = null);
  }

  Future<void> _refresh() async {
    loading = true;
    error = null;
    notifyListeners();
    try {
      final response = await load();
      if (_disposed) return;
      final now = DateTime.tryParse(response['serverNow']?.toString() ?? '');
      if (now != null) _clockOffset = now.difference(DateTime.now());
      _items = (response['items'] as List? ?? [])
          .map((v) => Map<String, dynamic>.from(v as Map))
          .toList();
      _loadedAt = DateTime.now();
      _expiration?.cancel();
      _scheduleItemExpiration();
      // A failed refresh must not keep campaigns cached indefinitely.
      _expiration = Timer(ttl, () {
        if (_disposed) return;
        _loadedAt = null;
        _items = [];
        notifyListeners();
      });
    } catch (_) {
      if (_disposed) return;
      _items = [];
      _loadedAt = null;
      error = 'No pudimos actualizar las campañas. Intenta nuevamente.';
    } finally {
      if (!_disposed) {
        loading = false;
        notifyListeners();
      }
    }
  }

  void _scheduleItemExpiration() {
    _itemExpiration?.cancel();
    final remaining = _items
        .map((item) => DateTime.tryParse(item['endsAt']?.toString() ?? '')
            ?.difference(serverNow))
        .whereType<Duration>()
        .where((d) => d > Duration.zero)
        .toList()
      ..sort();
    if (remaining.isEmpty) return;
    _itemExpiration = Timer(remaining.first, () {
      if (_disposed) return;
      _items.removeWhere((item) => !current(item));
      notifyListeners();
      _scheduleItemExpiration();
    });
  }

  Future<CampaignData> freshDetail(String id) async {
    final item = await detail(id);
    if (!current(item)) throw StateError('Campaña fuera de vigencia');
    return item;
  }

  @override
  void dispose() {
    _disposed = true;
    _expiration?.cancel();
    _itemExpiration?.cancel();
    super.dispose();
  }
}

bool safeCampaignExternalUri(String value) {
  final uri = Uri.tryParse(value);
  return uri != null &&
      uri.scheme == 'https' &&
      uri.userInfo.isEmpty &&
      (!uri.hasPort || uri.port == 443) &&
      RegExp(r'^[a-z0-9.-]+\.[a-z]{2,}$', caseSensitive: false)
          .hasMatch(uri.host) &&
      !RegExp(r'(^|\.)(localhost|local|internal)$', caseSensitive: false)
          .hasMatch(uri.host);
}

class CostaGoCampaignScreen extends StatefulWidget {
  const CostaGoCampaignScreen(
      {super.key, required this.store, required this.onAction});
  final CostaGoCampaignStore store;
  final Future<void> Function(BuildContext context, String route) onAction;
  @override
  State<CostaGoCampaignScreen> createState() => _CostaGoCampaignScreenState();
}

class _CostaGoCampaignScreenState extends State<CostaGoCampaignScreen>
    with WidgetsBindingObserver {
  Timer? timer;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(widget.store.refresh(force: true));
    schedule();
  }

  void schedule() {
    timer?.cancel();
    timer = Timer.periodic(
        widget.store.ttl, (_) => unawaited(widget.store.refresh(force: true)));
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(widget.store.refresh());
      schedule();
    } else {
      timer?.cancel();
    }
  }

  @override
  void dispose() {
    timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Campañas Costa-Go'), actions: [
          IconButton(
              tooltip: 'Actualizar',
              onPressed: () => widget.store.refresh(force: true),
              icon: const Icon(Icons.refresh))
        ]),
        body: AnimatedBuilder(
            animation: widget.store,
            builder: (context, _) {
              final items = widget.store.forPlacement('CAMPAIGNS');
              return RefreshIndicator(
                  onRefresh: () => widget.store.refresh(force: true),
                  child: ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.all(20),
                      children: [
                        if (widget.store.loading)
                          const LinearProgressIndicator(),
                        if (widget.store.error != null)
                          Padding(
                              padding: const EdgeInsets.all(16),
                              child: Text(widget.store.error!)),
                        if (items.isEmpty &&
                            !widget.store.loading &&
                            widget.store.error == null)
                          const Padding(
                              padding: EdgeInsets.symmetric(vertical: 60),
                              child: Column(children: [
                                Icon(Icons.campaign_outlined, size: 48),
                                SizedBox(height: 16),
                                Text('No hay campañas disponibles'),
                                SizedBox(height: 8),
                                Text(
                                    'Aquí encontrarás novedades y beneficios de Costa-Go.',
                                    textAlign: TextAlign.center)
                              ])),
                        for (final item in items)
                          Card(
                              clipBehavior: Clip.antiAlias,
                              child: InkWell(
                                  onTap: () async {
                                    await Navigator.push(
                                        context,
                                        MaterialPageRoute(
                                            builder: (_) =>
                                                CostaGoCampaignDetail(
                                                    store: widget.store,
                                                    id: item['id'].toString(),
                                                    onAction:
                                                        widget.onAction)));
                                    await widget.store.refresh();
                                  },
                                  child: Padding(
                                      padding: const EdgeInsets.all(16),
                                      child: Column(
                                          crossAxisAlignment:
                                              CrossAxisAlignment.start,
                                          children: [
                                            CampaignImage(
                                                store: widget.store,
                                                campaign: item,
                                                thumbnail: true),
                                            Text(
                                                item['title']?.toString() ?? '',
                                                style: Theme.of(context)
                                                    .textTheme
                                                    .titleLarge),
                                            if ((item['subtitle'] ?? '')
                                                .toString()
                                                .isNotEmpty)
                                              Padding(
                                                  padding:
                                                      const EdgeInsets.only(
                                                          top: 8),
                                                  child: Text(item['subtitle']
                                                      .toString())),
                                            const SizedBox(height: 12),
                                            const Row(children: [
                                              Text('Ver campaña'),
                                              Spacer(),
                                              Icon(Icons.chevron_right)
                                            ]),
                                          ])))),
                      ]));
            }),
      );
}

class CampaignImage extends StatelessWidget {
  const CampaignImage(
      {super.key,
      required this.store,
      required this.campaign,
      this.thumbnail = false});
  final CostaGoCampaignStore store;
  final CampaignData campaign;
  final bool thumbnail;
  @override
  Widget build(BuildContext context) {
    final assets = campaign['assets'] as List? ?? [];
    final kind = Theme.of(context).brightness == Brightness.dark &&
            assets.contains('DARK')
        ? 'DARK'
        : thumbnail && assets.contains('THUMBNAIL')
            ? 'THUMBNAIL'
            : 'MAIN';
    if (!assets.contains(kind)) return const SizedBox.shrink();
    return Padding(
        padding: const EdgeInsets.only(bottom: 16),
        child: ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: Image.network(store.imageUrl(campaign, kind),
                headers: store.headers,
                width: double.infinity,
                height: thumbnail ? 160 : 220,
                fit: BoxFit.contain,
                errorBuilder: (_, error, stack) => const SizedBox.shrink())));
  }
}

class CostaGoCampaignDetail extends StatefulWidget {
  const CostaGoCampaignDetail(
      {super.key,
      required this.store,
      required this.id,
      required this.onAction});
  final CostaGoCampaignStore store;
  final String id;
  final Future<void> Function(BuildContext context, String route) onAction;
  @override
  State<CostaGoCampaignDetail> createState() => _CostaGoCampaignDetailState();
}

class _CostaGoCampaignDetailState extends State<CostaGoCampaignDetail>
    with WidgetsBindingObserver {
  CampaignData? campaign;
  bool busy = false;
  String? error;
  Timer? timer;
  Timer? expiry;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(reload());
    schedule();
  }

  void schedule() {
    timer?.cancel();
    timer = Timer.periodic(widget.store.ttl, (_) => unawaited(reload()));
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(reload());
      schedule();
    } else {
      timer?.cancel();
    }
  }

  @override
  void dispose() {
    timer?.cancel();
    expiry?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Future<void> reload() async {
    if (busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final item = await widget.store.freshDetail(widget.id);
      if (mounted) {
        setState(() => campaign = item);
        expiry?.cancel();
        expiry = Timer(
            DateTime.parse(item['endsAt'].toString())
                .difference(widget.store.serverNow), () {
          if (mounted) {
            setState(() {
              campaign = null;
              error = 'Esta campaña ha finalizado.';
            });
          }
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          campaign = null;
          error = 'Esta campaña ya no está disponible o no se pudo consultar.';
        });
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> act() async {
    if (busy) return;
    await reload();
    if (!mounted || campaign == null) return;
    final type = campaign!['ctaType']?.toString() ?? 'NONE',
        destination = campaign!['ctaDestination']?.toString() ?? '';
    try {
      if (type == 'EXTERNAL_URL') {
        if (!safeCampaignExternalUri(destination)) {
          throw StateError('Enlace inválido');
        }
        final accepted = await showDialog<bool>(
            context: context,
            builder: (c) => AlertDialog(
                    title: const Text('Abrir enlace externo'),
                    content: Text(Uri.parse(destination).host),
                    actions: [
                      TextButton(
                          onPressed: () => Navigator.pop(c, false),
                          child: const Text('Cancelar')),
                      FilledButton(
                          onPressed: () => Navigator.pop(c, true),
                          child: const Text('Abrir'))
                    ]));
        if (accepted == true) {
          final latest = await widget.store.freshDetail(widget.id);
          if (latest['ctaType'] != 'EXTERNAL_URL' ||
              latest['ctaDestination'] != destination) {
            throw StateError('La acción cambió');
          }
          if (!await launchUrl(Uri.parse(destination),
              mode: LaunchMode.externalApplication)) {
            throw StateError('No se pudo abrir');
          }
        }
      } else if (mounted) {
        final route = type == 'MEMBERSHIP'
            ? 'membership'
            : type == 'SUPPORT'
                ? 'support'
                : type == 'INTERNAL_ROUTE'
                    ? destination
                    : '';
        if (route.isNotEmpty) await widget.onAction(context, route);
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('No pudimos abrir esta acción.')));
      }
    }
  }

  String date(dynamic value) {
    final d = DateTime.parse(value.toString()).toLocal();
    return '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year} ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final c = campaign;
    return Scaffold(
        appBar: AppBar(title: const Text('Campaña Costa-Go'), actions: [
          IconButton(
              onPressed: busy ? null : reload,
              tooltip: 'Actualizar',
              icon: const Icon(Icons.refresh))
        ]),
        body: ListView(padding: const EdgeInsets.all(20), children: [
          if (busy) const LinearProgressIndicator(),
          if (error != null) Text(error!),
          if (c != null) ...[
            CampaignImage(store: widget.store, campaign: c),
            Text(c['title'].toString(),
                style: Theme.of(context).textTheme.headlineSmall),
            if ((c['subtitle'] ?? '').toString().isNotEmpty)
              Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Text(c['subtitle'].toString(),
                      style: Theme.of(context).textTheme.titleMedium)),
            Text('${date(c['startsAt'])} – ${date(c['endsAt'])} (hora local)',
                style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 20),
            Text(c['description']?.toString() ?? ''),
            if ((c['terms'] ?? '').toString().isNotEmpty) ...[
              const SizedBox(height: 24),
              Text('Términos y condiciones',
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              Text(c['terms'].toString())
            ],
            if (!['NONE', 'CAMPAIGN_DETAIL'].contains(c['ctaType']) &&
                widget.store.current(c)) ...[
              const SizedBox(height: 24),
              FilledButton(
                  onPressed: busy ? null : act,
                  child: Text(c['ctaText']?.toString() ?? 'Ver más'))
            ],
          ],
        ]));
  }
}
