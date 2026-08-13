part of 'main.dart';

class TripRepeatDraft {
  const TripRepeatDraft({
    required this.origin,
    required this.destination,
    required this.originLabel,
    required this.destinationLabel,
  });
  final LatLng origin;
  final LatLng destination;
  final String originLabel;
  final String destinationLabel;

  factory TripRepeatDraft.fromTrip(Map<String, dynamic> trip) =>
      TripRepeatDraft(
        origin: LatLng((trip['originLatitude'] as num).toDouble(),
            (trip['originLongitude'] as num).toDouble()),
        destination: LatLng((trip['destinationLatitude'] as num).toDouble(),
            (trip['destinationLongitude'] as num).toDouble()),
        originLabel:
            cleanAddressLabel(trip['originReference'], fallback: 'Origen'),
        destinationLabel: cleanAddressLabel(trip['destinationReference'],
            fallback: 'Destino'),
      );
}

class PassengerNotificationStore {
  PassengerNotificationStore._();
  static final instance = PassengerNotificationStore._();
  final unread = ValueNotifier<int>(0);
  bool _loading = false;

  Future<void> refresh(Session session) async {
    if (_loading || session.role != 'PASSENGER') return;
    _loading = true;
    try {
      final page = await Api().notificationsPage(session.token, limit: 1);
      unread.value = (page['unreadCount'] as num?)?.toInt() ?? 0;
    } catch (_) {
      // El contador conserva su último valor válido mientras se recupera la red.
    } finally {
      _loading = false;
    }
  }
}

String _money(dynamic cents) =>
    '\$${(((cents as num?)?.toInt() ?? 0) / 100).toStringAsFixed(2).replaceAll('.', ',')}';

String _shortDate(dynamic value) {
  final date = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
  if (date == null) return 'Fecha no disponible';
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
  final minute = date.minute.toString().padLeft(2, '0');
  final hour = date.hour == 0
      ? 12
      : date.hour > 12
          ? date.hour - 12
          : date.hour;
  return '${date.day} ${months[date.month - 1]} · $hour:$minute ${date.hour >= 12 ? 'p. m.' : 'a. m.'}';
}

String _dayGroup(dynamic value) {
  final date = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
  if (date == null) return 'Anteriores';
  final now = DateTime.now();
  final day = DateTime(date.year, date.month, date.day);
  final today = DateTime(now.year, now.month, now.day);
  final difference = today.difference(day).inDays;
  if (difference == 0) return 'Hoy';
  if (difference == 1) return 'Ayer';
  if (difference < 7) return 'Esta semana';
  return 'Anteriores';
}

class PassengerHeaderIsland extends StatelessWidget {
  const PassengerHeaderIsland({
    super.key,
    required this.session,
    required this.onAccount,
  });
  final Session session;
  final Future<void> Function() onAccount;

  String get firstName {
    final value =
        session.name.trim().split(RegExp(r'\s+')).firstOrNull ?? 'Pasajero';
    return value.length > 18 ? '${value.substring(0, 17)}…' : value;
  }

  @override
  Widget build(BuildContext context) => Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 330),
          child: Material(
            color: Theme.of(context).colorScheme.surface.withValues(alpha: .96),
            elevation: 5,
            shadowColor: Colors.black26,
            borderRadius: BorderRadius.circular(999),
            clipBehavior: Clip.antiAlias,
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              IconButton(
                tooltip: 'Mi cuenta',
                onPressed: onAccount,
                icon: ClipOval(
                  child: Image.network(
                    '$base/v1/users/${session.id}/profile-photo',
                    headers: {'Authorization': 'Bearer ${session.token}'},
                    width: 34,
                    height: 34,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => const Icon(
                      Icons.account_circle_outlined,
                      size: 34,
                    ),
                  ),
                ),
              ),
              Flexible(
                child: Text('Hola, $firstName',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w800)),
              ),
              const SizedBox(width: 8),
              ValueListenableBuilder<int>(
                valueListenable: PassengerNotificationStore.instance.unread,
                builder: (context, unread, _) => Badge(
                  isLabelVisible: unread > 0,
                  label: Text(unread > 99 ? '99+' : '$unread'),
                  child: IconButton(
                    tooltip: 'Notificaciones',
                    onPressed: () async {
                      await Navigator.push(
                          context,
                          MaterialPageRoute(
                              builder: (_) =>
                                  PassengerNotificationsView(session)));
                      await PassengerNotificationStore.instance
                          .refresh(session);
                    },
                    icon: const Icon(Icons.notifications_none_rounded),
                  ),
                ),
              ),
            ]),
          ),
        ),
      );
}

class PassengerTripsView extends StatefulWidget {
  const PassengerTripsView(this.session, {super.key});
  final Session session;
  @override
  State<PassengerTripsView> createState() => _PassengerTripsViewState();
}

class _PassengerTripsViewState extends State<PassengerTripsView> {
  final items = <Map<String, dynamic>>[];
  String filter = 'ALL';
  String? cursor, error;
  bool loading = true, loadingMore = false;

  @override
  void initState() {
    super.initState();
    load(reset: true);
  }

  Future<void> load({required bool reset}) async {
    if (reset) {
      setState(() {
        loading = true;
        error = null;
        cursor = null;
        items.clear();
      });
    } else {
      setState(() => loadingMore = true);
    }
    try {
      final page = await Api().tripsPage(widget.session.token,
          status: filter, cursor: reset ? null : cursor);
      if (!mounted) return;
      setState(() {
        items.addAll(List<dynamic>.from(page['items'] ?? const [])
            .map((value) => Map<String, dynamic>.from(value as Map)));
        cursor = page['nextCursor']?.toString();
        loading = false;
        loadingMore = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          error = 'No pudimos cargar tus viajes.';
          loading = false;
          loadingMore = false;
        });
      }
    }
  }

  Future<void> chooseFilter() async {
    final value = await showModalBottomSheet<String>(
        context: context,
        builder: (context) => const SafeArea(
                child: Column(mainAxisSize: MainAxisSize.min, children: [
              ListTile(
                  title: Text('Filtrar viajes',
                      style: TextStyle(fontWeight: FontWeight.w800))),
              ListTile(
                  leading: Icon(Icons.list_alt),
                  title: Text('Todos'),
                  trailing: Icon(Icons.chevron_right)),
            ])));
    if (value != null) {
      filter = value;
      await load(reset: true);
    }
  }

  Future<void> setFilter(String value) async {
    Navigator.pop(context, value);
  }

  Widget filters() => Wrap(
      spacing: 8,
      runSpacing: 8,
      children: {
        'ALL': 'Todos',
        'COMPLETED': 'Completados',
        'CANCELLED': 'Cancelados',
        'SCHEDULED': 'Programados'
      }
          .entries
          .map((entry) => ChoiceChip(
              label: Text(entry.value),
              selected: filter == entry.key,
              onSelected: (_) async {
                setState(() => filter = entry.key);
                await load(reset: true);
              }))
          .toList());

  Future<void> openDetail(Map<String, dynamic> trip) async {
    await Navigator.push(
        context,
        MaterialPageRoute(
            builder: (_) => PassengerTripDetail(
                widget.session, trip['tripId'].toString())));
  }

  void repeat(Map<String, dynamic> trip) {
    try {
      Navigator.pop(context, TripRepeatDraft.fromTrip(trip));
    } catch (_) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text(
              'Este viaje no tiene coordenadas disponibles para repetirlo.')));
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Mis viajes'), actions: [
          IconButton(
              onPressed: () => showModalBottomSheet<void>(
                  context: context,
                  builder: (_) => SafeArea(
                      child: Padding(
                          padding: const EdgeInsets.all(20),
                          child: Column(
                              mainAxisSize: MainAxisSize.min,
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('Filtrar viajes',
                                    style: TextStyle(
                                        fontSize: 20,
                                        fontWeight: FontWeight.w800)),
                                const SizedBox(height: 14),
                                filters()
                              ])))),
              icon: const Icon(Icons.tune_rounded),
              tooltip: 'Filtros')
        ]),
        body: RefreshIndicator(
            onRefresh: () => load(reset: true),
            child: loading
                ? const _PassengerSkeleton()
                : error != null
                    ? _PassengerError(
                        message: error!, retry: () => load(reset: true))
                    : items.isEmpty
                        ? ListView(children: const [
                            SizedBox(height: 140),
                            _PassengerEmpty(
                                icon: Icons.route_outlined,
                                title: 'Todavía no tienes viajes',
                                message:
                                    'Cuando realices tu primer viaje con Costa-Go, aparecerá aquí.')
                          ])
                        : ListView(
                            padding: const EdgeInsets.fromLTRB(16, 10, 16, 30),
                            children: [
                                _FeaturedTripCard(
                                    trip: items.first,
                                    onTap: () => openDetail(items.first),
                                    onRepeat: () => repeat(items.first)),
                                if (items.length > 1) ...[
                                  const SizedBox(height: 24),
                                  Text('Anteriores',
                                      style: Theme.of(context)
                                          .textTheme
                                          .titleLarge
                                          ?.copyWith(
                                              fontWeight: FontWeight.w900)),
                                  const SizedBox(height: 8),
                                  ...items.skip(1).map((trip) =>
                                      _CompactTripTile(
                                          trip: trip,
                                          onTap: () => openDetail(trip),
                                          onRepeat: () => repeat(trip))),
                                ],
                                if (cursor != null)
                                  Center(
                                      child: TextButton.icon(
                                          onPressed: loadingMore
                                              ? null
                                              : () => load(reset: false),
                                          icon: loadingMore
                                              ? const SizedBox.square(
                                                  dimension: 16,
                                                  child:
                                                      CircularProgressIndicator(
                                                          strokeWidth: 2))
                                              : const Icon(Icons.expand_more),
                                          label: const Text('Cargar más'))),
                              ])),
      );
}

class _FeaturedTripCard extends StatelessWidget {
  const _FeaturedTripCard(
      {required this.trip, required this.onTap, required this.onRepeat});
  final Map<String, dynamic> trip;
  final VoidCallback onTap, onRepeat;
  LatLng? point(String prefix) {
    final lat = (trip['${prefix}Latitude'] as num?)?.toDouble(),
        lng = (trip['${prefix}Longitude'] as num?)?.toDouble();
    return lat == null || lng == null ? null : LatLng(lat, lng);
  }

  @override
  Widget build(BuildContext context) {
    final origin = point('origin'), destination = point('destination');
    return Card(
        clipBehavior: Clip.antiAlias,
        child: InkWell(
            onTap: onTap,
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              SizedBox(
                  height: 190,
                  child: LiveMap(
                      originLabel: cleanAddressLabel(trip['originReference'],
                          fallback: 'Origen'),
                      destinationLabel: cleanAddressLabel(
                          trip['destinationReference'],
                          fallback: 'Destino'),
                      pickup: origin,
                      dropoff: destination,
                      routePoints: [
                        if (origin != null) origin,
                        if (destination != null) destination
                      ],
                      fillAvailable: true,
                      borderRadius: 0,
                      viewportPadding: const EdgeInsets.all(24))),
              Padding(
                  padding: const EdgeInsets.all(18),
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                            cleanAddressLabel(trip['destinationReference'],
                                fallback: 'Destino'),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context)
                                .textTheme
                                .titleLarge
                                ?.copyWith(fontWeight: FontWeight.w900)),
                        const SizedBox(height: 5),
                        Text(_shortDate(
                            trip['scheduledFor'] ?? trip['requestedAt'])),
                        const SizedBox(height: 3),
                        Row(children: [
                          Text(_money(trip['quotedTotalCents']),
                              style:
                                  const TextStyle(fontWeight: FontWeight.w800)),
                          const Spacer(),
                          _StatusPill(trip['status'])
                        ]),
                        const SizedBox(height: 14),
                        FilledButton.tonalIcon(
                            onPressed: onRepeat,
                            icon: const Icon(Icons.refresh_rounded),
                            label: const Text('Solicitar nuevamente')),
                      ])),
            ])));
  }
}

class _CompactTripTile extends StatelessWidget {
  const _CompactTripTile(
      {required this.trip, required this.onTap, required this.onRepeat});
  final Map<String, dynamic> trip;
  final VoidCallback onTap, onRepeat;
  @override
  Widget build(BuildContext context) => InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(18),
      child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Row(children: [
            Container(
                width: 54,
                height: 54,
                decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.primaryContainer,
                    borderRadius: BorderRadius.circular(16)),
                child: const Icon(Icons.electric_rickshaw_outlined)),
            const SizedBox(width: 12),
            Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                  Text(
                      cleanAddressLabel(trip['destinationReference'],
                          fallback: 'Destino'),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w800)),
                  Text(_shortDate(trip['scheduledFor'] ?? trip['requestedAt'])),
                  Text(_money(trip['quotedTotalCents']))
                ])),
            TextButton.icon(
                onPressed: onRepeat,
                icon: const Icon(Icons.refresh_rounded, size: 18),
                label: const Text('Repetir')),
          ])));
}

class _StatusPill extends StatelessWidget {
  const _StatusPill(this.status);
  final dynamic status;
  @override
  Widget build(BuildContext context) => Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.secondaryContainer,
          borderRadius: BorderRadius.circular(999)),
      child: Text(estadoViaje(status),
          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800)));
}

class PassengerActivityView extends StatefulWidget {
  const PassengerActivityView(this.session, {super.key});
  final Session session;
  @override
  State<PassengerActivityView> createState() => _PassengerActivityViewState();
}

class _PassengerActivityViewState extends State<PassengerActivityView> {
  final items = <Map<String, dynamic>>[];
  String? cursor, error;
  bool loading = true, more = false;
  @override
  void initState() {
    super.initState();
    load(true);
  }

  Future<void> load(bool reset) async {
    if (reset) {
      setState(() {
        loading = true;
        error = null;
        items.clear();
        cursor = null;
      });
    } else {
      setState(() => more = true);
    }
    try {
      final page = await Api()
          .activityPage(widget.session.token, cursor: reset ? null : cursor);
      if (!mounted) return;
      setState(() {
        items.addAll(List<dynamic>.from(page['items'] ?? const [])
            .map((e) => Map<String, dynamic>.from(e as Map)));
        cursor = page['nextCursor']?.toString();
        loading = false;
        more = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          error = 'No pudimos cargar tu actividad.';
          loading = false;
          more = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: const Text('Actividad')),
      body: RefreshIndicator(
          onRefresh: () => load(true),
          child: loading
              ? const _PassengerSkeleton()
              : error != null
                  ? _PassengerError(message: error!, retry: () => load(true))
                  : items.isEmpty
                      ? ListView(children: const [
                          SizedBox(height: 150),
                          _PassengerEmpty(
                              icon: Icons.history_rounded,
                              title: 'Tu actividad aparecerá aquí',
                              message:
                                  'Verás lo que ocurre en tus viajes y solicitudes de soporte.')
                        ])
                      : ListView(
                          padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
                          children: [
                              ..._groupWidgets(context),
                              if (cursor != null)
                                Center(
                                    child: TextButton(
                                        onPressed:
                                            more ? null : () => load(false),
                                        child: Text(
                                            more ? 'Cargando…' : 'Cargar más')))
                            ])));
  List<Widget> _groupWidgets(BuildContext context) {
    final widgets = <Widget>[];
    String? group;
    for (final item in items) {
      final next = _dayGroup(item['occurredAt']);
      if (next != group) {
        group = next;
        widgets.add(Padding(
            padding: const EdgeInsets.only(top: 18, bottom: 8),
            child: Text(next.toUpperCase(),
                style: Theme.of(context).textTheme.labelLarge?.copyWith(
                    fontWeight: FontWeight.w900,
                    color: Theme.of(context).colorScheme.primary))));
      }
      widgets.add(_ActivityTile(
          item: item,
          onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                  builder: (_) => PassengerTripDetail(
                      widget.session, item['tripId'].toString())))));
    }
    return widgets;
  }
}

class _ActivityTile extends StatelessWidget {
  const _ActivityTile({required this.item, required this.onTap});
  final Map<String, dynamic> item;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => InkWell(
      onTap: onTap,
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Column(children: [
          Container(
              width: 12,
              height: 12,
              decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.primary,
                  shape: BoxShape.circle)),
          Container(
              width: 2,
              height: 64,
              color: Theme.of(context).colorScheme.outlineVariant)
        ]),
        const SizedBox(width: 14),
        Expanded(
            child: Padding(
                padding: const EdgeInsets.only(bottom: 16),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(item['message']?.toString() ?? 'Actualización',
                          style: const TextStyle(fontWeight: FontWeight.w800)),
                      Text(
                          '${cleanAddressLabel(item['originReference'], fallback: 'Origen')} → ${cleanAddressLabel(item['destinationReference'], fallback: 'Destino')}',
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis),
                      Text(_shortDate(item['occurredAt']),
                          style: Theme.of(context).textTheme.bodySmall)
                    ]))),
        const Icon(Icons.chevron_right)
      ]));
}

class PassengerNotificationsView extends StatefulWidget {
  const PassengerNotificationsView(this.session, {super.key});
  final Session session;
  @override
  State<PassengerNotificationsView> createState() =>
      _PassengerNotificationsViewState();
}

class _PassengerNotificationsViewState
    extends State<PassengerNotificationsView> {
  final items = <Map<String, dynamic>>[];
  String? cursor, error;
  bool loading = true, more = false;
  @override
  void initState() {
    super.initState();
    load(true);
  }

  Future<void> load(bool reset) async {
    if (reset) {
      setState(() {
        loading = true;
        items.clear();
        cursor = null;
        error = null;
      });
    } else {
      setState(() => more = true);
    }
    try {
      final page = await Api().notificationsPage(widget.session.token,
          cursor: reset ? null : cursor);
      if (!mounted) return;
      setState(() {
        items.addAll(List<dynamic>.from(page['items'] ?? const [])
            .map((e) => Map<String, dynamic>.from(e as Map)));
        cursor = page['nextCursor']?.toString();
        loading = false;
        more = false;
        PassengerNotificationStore.instance.unread.value =
            (page['unreadCount'] as num?)?.toInt() ?? 0;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          error = 'No pudimos cargar tus notificaciones.';
          loading = false;
          more = false;
        });
      }
    }
  }

  Future<void> open(Map<String, dynamic> item) async {
    if (item['readAt'] == null) {
      await Api().markNotificationRead(widget.session.token, item['id']);
      item['readAt'] = DateTime.now().toIso8601String();
      PassengerNotificationStore.instance.unread.value =
          math.max(0, PassengerNotificationStore.instance.unread.value - 1);
      if (mounted) setState(() {});
    }
    final type = item['entityType']?.toString(),
        id = item['entityId']?.toString();
    if (!mounted || id == null) return;
    if (type == 'TRIP') {
      await Navigator.push(
          context,
          MaterialPageRoute(
              builder: (_) => PassengerTripDetail(widget.session, id)));
    } else if (type == 'INCIDENT') {
      await Navigator.push(
          context,
          MaterialPageRoute(
              builder: (_) => SupportIncidentDetail(widget.session, id)));
    }
  }

  Future<void> readAll() async {
    await Api().markAllNotificationsRead(widget.session.token);
    if (!mounted) return;
    setState(() {
      for (final item in items) {
        item['readAt'] ??= DateTime.now().toIso8601String();
      }
    });
    PassengerNotificationStore.instance.unread.value = 0;
  }

  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: const Text('Notificaciones'), actions: [
        if (items.any((e) => e['readAt'] == null))
          TextButton(onPressed: readAll, child: const Text('Leer todas'))
      ]),
      body: RefreshIndicator(
          onRefresh: () => load(true),
          child: loading
              ? const _PassengerSkeleton()
              : error != null
                  ? _PassengerError(message: error!, retry: () => load(true))
                  : items.isEmpty
                      ? ListView(children: const [
                          SizedBox(height: 150),
                          _PassengerEmpty(
                              icon: Icons.notifications_none_rounded,
                              title: 'Todo tranquilo por aquí',
                              message:
                                  'Cuando tengamos algo importante que contarte, lo verás aquí.')
                        ])
                      : ListView(
                          padding: const EdgeInsets.fromLTRB(14, 8, 14, 24),
                          children: [
                              ...items.map((item) => _NotificationTile(
                                  item: item, onTap: () => open(item))),
                              if (cursor != null)
                                TextButton(
                                    onPressed: more ? null : () => load(false),
                                    child:
                                        Text(more ? 'Cargando…' : 'Cargar más'))
                            ])));
}

class _NotificationTile extends StatelessWidget {
  const _NotificationTile({required this.item, required this.onTap});
  final Map<String, dynamic> item;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final unread = item['readAt'] == null;
    return Card(
        elevation: unread ? 1 : 0,
        color: unread
            ? Theme.of(context)
                .colorScheme
                .primaryContainer
                .withValues(alpha: .38)
            : Theme.of(context).colorScheme.surfaceContainerLow,
        child: ListTile(
            onTap: onTap,
            leading: Stack(children: [
              const CircleAvatar(child: Icon(Icons.notifications_none_rounded)),
              if (unread)
                Positioned(
                    right: 0,
                    top: 0,
                    child: Container(
                        width: 10,
                        height: 10,
                        decoration: BoxDecoration(
                            color: Theme.of(context).colorScheme.primary,
                            shape: BoxShape.circle)))
            ]),
            title: Text(item['title']?.toString() ?? 'Costa-Go',
                style: TextStyle(
                    fontWeight: unread ? FontWeight.w900 : FontWeight.w600)),
            subtitle: Text(
                '${item['message'] ?? ''}\n${_shortDate(item['createdAt'])}'),
            isThreeLine: true,
            trailing: const Icon(Icons.chevron_right)));
  }
}

class PassengerTripDetail extends StatefulWidget {
  const PassengerTripDetail(this.session, this.tripId, {super.key});
  final Session session;
  final String tripId;
  @override
  State<PassengerTripDetail> createState() => _PassengerTripDetailState();
}

class _PassengerTripDetailState extends State<PassengerTripDetail> {
  static final routeCache = <String, List<LatLng>>{};
  Map<String, dynamic>? trip;
  List<LatLng> route = [];
  String? error;
  bool loading = true;
  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final value = Map<String, dynamic>.from(
          await Api().trip(widget.session.token, widget.tripId) as Map);
      var points = routeCache[widget.tripId];
      final origin = LatLng((value['originLatitude'] as num).toDouble(),
              (value['originLongitude'] as num).toDouble()),
          destination = LatLng((value['destinationLatitude'] as num).toDouble(),
              (value['destinationLongitude'] as num).toDouble());
      if (points == null) {
        final stored = List<dynamic>.from(value['routePoints'] ?? const []);
        if (stored.isNotEmpty) {
          points = stored
              .map((p) => LatLng((p['latitude'] as num).toDouble(),
                  (p['longitude'] as num).toDouble()))
              .toList();
          routeCache[widget.tripId] = points;
        }
      }
      if (points == null) {
        try {
          final result = await Api().route(
              widget.session.token, origin, destination,
              tripId: widget.tripId, purpose: 'MAP');
          points = List<dynamic>.from(result['points'] ?? const [])
              .map((p) => LatLng((p['latitude'] as num).toDouble(),
                  (p['longitude'] as num).toDouble()))
              .toList();
          if (points.isNotEmpty) routeCache[widget.tripId] = points;
        } catch (_) {
          points = [origin, destination];
        }
      }
      if (mounted) {
        setState(() {
          trip = value;
          route = points!;
          loading = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          error = 'No pudimos cargar el detalle del viaje.';
          loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final item = trip;
    if (loading) return const Scaffold(body: _PassengerSkeleton());
    if (item == null) {
      return Scaffold(
          appBar: AppBar(title: const Text('Detalle del viaje')),
          body: _PassengerError(message: error!, retry: load));
    }
    final origin = LatLng((item['originLatitude'] as num).toDouble(),
            (item['originLongitude'] as num).toDouble()),
        destination = LatLng((item['destinationLatitude'] as num).toDouble(),
            (item['destinationLongitude'] as num).toDouble());
    return Scaffold(
        appBar: AppBar(title: const Text('Detalle del viaje')),
        body: ListView(padding: const EdgeInsets.only(bottom: 32), children: [
          SizedBox(
              height: 250,
              child: LiveMap(
                  originLabel: cleanAddressLabel(item['originReference'],
                      fallback: 'Origen'),
                  destinationLabel: cleanAddressLabel(
                      item['destinationReference'],
                      fallback: 'Destino'),
                  pickup: origin,
                  dropoff: destination,
                  routePoints: route,
                  fillAvailable: true,
                  borderRadius: 0,
                  viewportPadding: const EdgeInsets.all(30))),
          Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _driver(context, item),
                    const SizedBox(height: 22),
                    _routeInfo(context, item),
                    const Divider(height: 36),
                    Text('Resumen del viaje',
                        style: Theme.of(context)
                            .textTheme
                            .titleLarge
                            ?.copyWith(fontWeight: FontWeight.w900)),
                    const SizedBox(height: 12),
                    _summaryRow('Estado', estadoViaje(item['status'])),
                    _summaryRow(
                        'Método de pago',
                        item['paymentMethod'] == 'DEUNA'
                            ? 'De Una!'
                            : 'Efectivo'),
                    _summaryRow(
                        'Total del viaje',
                        _money(item['finalTotalCents'] ??
                            item['quotedTotalCents']),
                        strong: true),
                    if (item['myRating'] != null) ...[
                      const Divider(height: 30),
                      Row(children: [
                        const Icon(Icons.star, color: Colors.amber),
                        const SizedBox(width: 8),
                        Text('Tu calificación: ${item['myRating']} de 5',
                            style: const TextStyle(fontWeight: FontWeight.w800))
                      ])
                    ],
                    const Divider(height: 36),
                    Text('Ayuda y soporte',
                        style: Theme.of(context)
                            .textTheme
                            .titleLarge
                            ?.copyWith(fontWeight: FontWeight.w900)),
                    _support('Objeto perdido', 'LOST_ITEM', Icons.key_outlined),
                    _support(
                        'Problema con el viaje', 'TRIP', Icons.route_outlined),
                    _support('Problema con el cobro', 'PAYMENT',
                        Icons.payments_outlined),
                    _support('Problema de seguridad', 'SAFETY',
                        Icons.shield_outlined),
                  ]))
        ]));
  }

  Widget _driver(BuildContext context, Map<String, dynamic> item) {
    final hasDriver = item['driverId'] != null;
    final hasPhoto = item['driverHasPhoto'] == true;
    return Row(children: [
      Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Viaje Costa-Go con'),
          Text(
            item['driverName']?.toString() ?? 'Conductor no asignado',
            style: Theme.of(context)
                .textTheme
                .headlineSmall
                ?.copyWith(fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 5),
          Text(_shortDate(item['startedAt'] ??
              item['scheduledFor'] ??
              item['requestedAt'])),
          if (item['vehicle'] != null)
            Text(
                '${_money(item['finalTotalCents'] ?? item['quotedTotalCents'])} · '
                '${item['vehicle']}'),
        ]),
      ),
      if (hasDriver)
        ClipOval(
          child: hasPhoto
              ? Image.network(
                  '$base/v1/users/${item['driverId']}/profile-photo',
                  headers: {'Authorization': 'Bearer ${widget.session.token}'},
                  width: 72,
                  height: 72,
                  fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => _avatar(),
                )
              : _avatar(),
        ),
    ]);
  }

  Widget _avatar() => Container(
      width: 72,
      height: 72,
      color: Theme.of(context).colorScheme.primaryContainer,
      child: const Icon(Icons.person_outline, size: 38));
  Widget _routeInfo(BuildContext c, Map<String, dynamic> t) =>
      Column(children: [
        _place(Icons.radio_button_checked, 'Origen', t['originReference'],
            t['assignedAt'] ?? t['requestedAt']),
        Container(
            margin: const EdgeInsets.only(left: 11),
            height: 24,
            width: 2,
            color: Theme.of(c).colorScheme.outlineVariant),
        _place(Icons.stop_rounded, 'Destino', t['destinationReference'],
            t['completedAt'])
      ]);
  Widget _place(IconData icon, String label, dynamic address, dynamic time) =>
      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icon, size: 23),
        const SizedBox(width: 12),
        Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: const TextStyle(fontWeight: FontWeight.w800)),
          Text(cleanAddressLabel(address, fallback: label))
        ])),
        if (time != null)
          Text(_shortDate(time).split('·').last.trim(),
              style: Theme.of(context).textTheme.bodySmall)
      ]);
  Widget _summaryRow(String label, String value, {bool strong = false}) =>
      Padding(
          padding: const EdgeInsets.symmetric(vertical: 7),
          child: Row(children: [
            Expanded(child: Text(label)),
            Text(value,
                style: TextStyle(
                    fontWeight: strong ? FontWeight.w900 : FontWeight.w600))
          ]));
  Widget _support(String label, String category, IconData icon) => ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Icon(icon),
      title: Text(label),
      trailing: const Icon(Icons.chevron_right),
      onTap: () => Navigator.push(
          context,
          MaterialPageRoute(
              builder: (_) => CreateSupportRequest(widget.session,
                  initialTripId: widget.tripId, initialCategory: category))));
}

class _PassengerSkeleton extends StatelessWidget {
  const _PassengerSkeleton();
  @override
  Widget build(BuildContext context) => ListView(
      padding: const EdgeInsets.all(20),
      children: List.generate(
          5,
          (i) => Container(
              height: i == 0 ? 170 : 72,
              margin: const EdgeInsets.only(bottom: 14),
              decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(20)))));
}

class _PassengerError extends StatelessWidget {
  const _PassengerError({required this.message, required this.retry});
  final String message;
  final VoidCallback retry;
  @override
  Widget build(BuildContext context) => Center(
      child: Padding(
          padding: const EdgeInsets.all(30),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.cloud_off_outlined, size: 48),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 14),
            FilledButton.icon(
                onPressed: retry,
                icon: const Icon(Icons.refresh),
                label: const Text('Reintentar'))
          ])));
}

class _PassengerEmpty extends StatelessWidget {
  const _PassengerEmpty(
      {required this.icon, required this.title, required this.message});
  final IconData icon;
  final String title, message;
  @override
  Widget build(BuildContext context) => Padding(
      padding: const EdgeInsets.all(28),
      child: Column(children: [
        Icon(icon, size: 58, color: Theme.of(context).colorScheme.primary),
        const SizedBox(height: 15),
        Text(title,
            textAlign: TextAlign.center,
            style: Theme.of(context)
                .textTheme
                .titleLarge
                ?.copyWith(fontWeight: FontWeight.w900)),
        const SizedBox(height: 8),
        Text(message, textAlign: TextAlign.center)
      ]));
}
