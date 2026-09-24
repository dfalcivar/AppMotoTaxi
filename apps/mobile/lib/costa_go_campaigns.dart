import 'costa_go_coastal.dart';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

typedef CampaignData = Map<String, dynamic>;

String? campaignImageKind(List assets, Brightness brightness,
    {bool thumbnail = false}) {
  if (thumbnail && assets.contains('THUMBNAIL')) return 'THUMBNAIL';
  if (brightness == Brightness.dark && assets.contains('DARK')) return 'DARK';
  if (assets.contains('MAIN')) return 'MAIN';
  if (assets.contains('DARK')) return 'DARK';
  return null;
}

/// HOME exists only when the authenticated backend supplies an eligible item.
class CostaGoHomeCampaigns extends StatefulWidget {
  const CostaGoHomeCampaigns(
      {super.key, required this.store, required this.onAction});
  final CostaGoCampaignStore store;
  final Future<void> Function(BuildContext, String) onAction;
  @override
  State<CostaGoHomeCampaigns> createState() => _CostaGoHomeCampaignsState();
}

class _CostaGoHomeCampaignsState extends State<CostaGoHomeCampaigns> {
  @override
  void initState() {
    super.initState();
    widget.store.watch();
  }

  @override
  void didUpdateWidget(CostaGoHomeCampaigns oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.store != widget.store) {
      oldWidget.store.unwatch();
      widget.store.watch();
    }
  }

  @override
  void dispose() {
    widget.store.unwatch();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
      listenable: widget.store,
      builder: (context, _) {
        final items = widget.store.forPlacement('HOME');
        if (items.isEmpty) return const SizedBox.shrink();
        return Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: TweenAnimationBuilder<double>(
                key: ValueKey(items.first['id']),
                tween: Tween(begin: 0, end: 1),
                duration: const Duration(milliseconds: 180),
                builder: (_, value, child) =>
                    Opacity(opacity: value, child: child),
                child: CostaGoCampaignCard(
                    campaign: items.first,
                    store: widget.store,
                    onAction: widget.onAction)));
      });
}

class CostaGoCampaignCard extends StatelessWidget {
  const CostaGoCampaignCard(
      {super.key,
      required this.campaign,
      required this.store,
      required this.onAction});
  final CampaignData campaign;
  final CostaGoCampaignStore store;
  final Future<void> Function(BuildContext, String) onAction;
  Future<void> open(BuildContext context, {bool action = false}) async {
    try {
      final item = await store.freshDetail(campaign['id'].toString());
      if (!context.mounted) return;
      if (action &&
          item['ctaType'] != 'NONE' &&
          item['ctaType'] != 'CAMPAIGN_DETAIL') {
        final type = item['ctaType'],
            destination = item['ctaDestination']?.toString() ?? '';
        if (type == 'EXTERNAL_URL') {
          if (!safeCampaignExternalUri(destination)) return;
          final yes = await showDialog<bool>(
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
          if (yes != true) return;
          final latest = await store.freshDetail(item['id'].toString());
          if (latest['ctaType'] != type ||
              latest['ctaDestination'] != destination) {
            return;
          }
          await launchUrl(Uri.parse(destination),
              mode: LaunchMode.externalApplication);
        } else {
          final route = type == 'MEMBERSHIP'
              ? 'membership'
              : type == 'SUPPORT'
                  ? 'support'
                  : type == 'INTERNAL_ROUTE'
                      ? destination
                      : '';
          if (route.isNotEmpty && context.mounted) {
            await onAction(context, route);
          }
        }
      } else {
        await Navigator.push(
            context,
            MaterialPageRoute(
                builder: (_) => CostaGoCampaignDetail(
                    store: store,
                    id: item['id'].toString(),
                    onAction: onAction)));
      }
    } catch (_) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Esta campaña ya no está disponible.')));
      }
      await store.refresh(force: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    final assets = campaign['assets'] as List? ?? [];
    final kind = campaignImageKind(assets, Theme.of(context).brightness,
        thumbnail: true);
    final variant = campaign['variant'];
    final accent = switch (variant) {
      'CHRISTMAS' => c.tertiary,
      'CARNIVAL' => c.secondary,
      'SUMMER' => c.primary,
      _ => c.primary
    };
    return Material(
        color: c.surface.withValues(alpha: .94),
        clipBehavior: Clip.antiAlias,
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(24),
            side: BorderSide(color: accent.withValues(alpha: .25))),
        child: InkWell(
            onTap: () => open(context),
            child: Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (kind != null)
                        Image.network(store.imageUrl(campaign, kind),
                            headers: store.headers,
                            fit: BoxFit.cover,
                            cacheWidth: 228,
                            frameBuilder: (context, child, frame,
                                    synchronous) =>
                                frame == null && !synchronous
                                    ? const SizedBox.shrink()
                                    : Padding(
                                        padding:
                                            const EdgeInsets.only(right: 12),
                                        child: ClipRRect(
                                            borderRadius:
                                                BorderRadius.circular(16),
                                            child: SizedBox(
                                                width: 76,
                                                height: 80,
                                                child: child))),
                            errorBuilder: (_, __, ___) =>
                                const SizedBox.shrink()),
                      Expanded(
                          child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                            Text(campaign['title']?.toString() ?? '',
                                style: Theme.of(context).textTheme.titleMedium),
                            if ((campaign['subtitle']?.toString() ?? '')
                                .isNotEmpty)
                              Text(campaign['subtitle'].toString(),
                                  style: TextStyle(color: c.onSurfaceVariant)),
                            if (campaign['ctaType'] != 'NONE' &&
                                (campaign['ctaText']?.toString() ?? '')
                                    .isNotEmpty)
                              TextButton(
                                  onPressed: () => open(context, action: true),
                                  child: Text(campaign['ctaText'].toString())),
                          ])),
                    ]))));
  }
}

/// Small avatar overlay; eligibility and ordering come from the existing store.
class CostaGoCampaignHeaderDecoration extends StatefulWidget {
  const CostaGoCampaignHeaderDecoration(
      {super.key,
      required this.store,
      required this.child,
      this.enabled = true});
  final CostaGoCampaignStore store;
  final Widget child;
  final bool enabled;
  @override
  State<CostaGoCampaignHeaderDecoration> createState() =>
      _CampaignHeaderState();
}

class _CampaignHeaderState extends State<CostaGoCampaignHeaderDecoration> {
  @override
  void initState() {
    super.initState();
    widget.store.watch();
  }

  @override
  void didUpdateWidget(CostaGoCampaignHeaderDecoration oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.store != widget.store) {
      oldWidget.store.unwatch();
      widget.store.watch();
    }
  }

  @override
  void dispose() {
    widget.store.unwatch();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
      listenable: widget.store,
      builder: (context, _) {
        final campaign = widget.enabled ? widget.store.headerCampaign : null;
        return Stack(clipBehavior: Clip.none, children: [
          widget.child,
          if (campaign != null)
            Positioned(
                top: -5,
                left: -2,
                width: 25,
                height: 19,
                child: IgnorePointer(
                    child: ExcludeSemantics(
                        child: _CampaignDecorationAsset(
                            campaign: campaign, store: widget.store)))),
        ]);
      });
}

class _CampaignDecorationAsset extends StatelessWidget {
  const _CampaignDecorationAsset({required this.campaign, required this.store});
  final CampaignData campaign;
  final CostaGoCampaignStore store;
  @override
  Widget build(BuildContext context) {
    final local = switch (campaign['variant']) {
      'CHRISTMAS' => 'christmas_hat',
      'CARNIVAL' => 'carnival_mask',
      'SUMMER' => 'summer_detail',
      _ => null,
    };
    Widget fallback() => local == null
        ? const SizedBox.shrink()
        : Image.asset('assets/campaigns/header/$local.png',
            key: ValueKey('campaign-decoration-$local'),
            fit: BoxFit.contain,
            errorBuilder: (_, __, ___) => const SizedBox.shrink());
    final assets = campaign['assets'] as List? ?? [];
    // DECORATION is a separate authenticated resource, never MAIN or THUMBNAIL.
    if (!assets.contains('DECORATION')) return fallback();
    return Image.network(store.imageUrl(campaign, 'DECORATION'),
        headers: store.headers,
        key: ValueKey('campaign-decoration-remote-${campaign['id']}'),
        fit: BoxFit.contain,
        cacheWidth: 100,
        frameBuilder: (_, child, frame, synchronous) =>
            frame == null && !synchronous ? fallback() : child,
        errorBuilder: (_, __, ___) => fallback());
  }
}

/// Session-scoped, memory-only cache. Financial rewards and advertising are unrelated.
class CostaGoCampaignStore extends ChangeNotifier with WidgetsBindingObserver {
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
  int _watchers = 0;
  Timer? _refreshTimer;
  void watch() {
    if (_disposed || ++_watchers != 1) return;
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_disposed && _watchers > 0) _startRefresh();
    });
  }

  void unwatch() {
    if (_watchers == 0 || --_watchers != 0) return;
    _refreshTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
  }

  void _startRefresh() {
    _refreshTimer?.cancel();
    unawaited(refresh(force: true));
    _refreshTimer = Timer.periodic(ttl, (_) => unawaited(refresh(force: true)));
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _watchers > 0) {
      _startRefresh();
    } else {
      _refreshTimer?.cancel();
    }
  }

  CampaignData? get headerCampaign {
    final first = _items
        .where((item) => current(item) && item['decorateHeader'] == true)
        .firstOrNull;
    return first != null &&
            ['CHRISTMAS', 'CARNIVAL', 'SUMMER', 'CUSTOM']
                .contains(first['variant'])
        ? first
        : null;
  }

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
    _refreshTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
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
  Widget build(BuildContext context) => CostaGoScaffold(
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
    final kind = campaignImageKind(assets, Theme.of(context).brightness,
        thumbnail: thumbnail);
    if (kind == null) return const SizedBox.shrink();
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
    return CostaGoScaffold(
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
