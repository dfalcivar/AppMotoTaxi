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

class UserNotificationStore {
  UserNotificationStore._();
  static final instance = UserNotificationStore._();
  final unread = ValueNotifier<int>(0);
  bool _loading = false;

  Future<void> refresh(Session session) async {
    if (_loading) return;
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

String _distance(dynamic meters) {
  final value = (meters as num?)?.toDouble() ?? 0;
  return value >= 1000
      ? '${(value / 1000).toStringAsFixed(1).replaceAll('.', ',')} km'
      : '${value.round()} m';
}

String _duration(dynamic seconds) {
  final minutes = (((seconds as num?)?.toDouble() ?? 0) / 60).round();
  return minutes >= 60
      ? '${minutes ~/ 60} h ${minutes % 60} min'
      : '$minutes min';
}

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

enum NotificationTarget {
  chat,
  activeTrip,
  tripDetail,
  scheduledTrips,
  support,
  offers,
  membership,
  fleet,
  smartTrip,
  appStore,
  inbox
}

/// Puente mínimo entre el centro existente y el formulario del pasajero.
/// La sugerencia solo prepara el borrador; nunca solicita un viaje por sí sola.
class SmartTripSuggestion {
  SmartTripSuggestion._();
  static final pending = ValueNotifier<Map<String, dynamic>?>(null);
}

const _informationalTripNotificationTypes = {
  'TRIP_ASSIGNED',
  'ASSIGNED',
  'DRIVER_EN_ROUTE',
  'DRIVER_ARRIVED',
  'IN_PROGRESS',
  'DRIVER_CANCELLED_REASSIGNING',
  'TRIP_CANCELLED',
  'NO_DRIVER',
};

bool notificationOpensInformationalDetail(String? value) =>
    _informationalTripNotificationTypes.contains(value?.toUpperCase());

bool notificationNavigatesDirectly(String? value) {
  final type = value?.toUpperCase();
  if (type == 'COMPLETED') return true;
  if (notificationOpensInformationalDetail(type)) return false;
  return const {
    NotificationTarget.chat,
    NotificationTarget.support,
    NotificationTarget.fleet,
  }.contains(notificationTargetFor(type));
}

String formatSpanishLongDate(DateTime value) {
  const weekdays = [
    'lunes',
    'martes',
    'miércoles',
    'jueves',
    'viernes',
    'sábado',
    'domingo'
  ];
  const months = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre'
  ];
  final local = value.toLocal();
  return '${weekdays[local.weekday - 1]}, ${local.day} de ${months[local.month - 1]} de ${local.year}';
}

String formatEcuadorLongDateTime(DateTime value) {
  const weekdays = [
    'lunes',
    'martes',
    'miércoles',
    'jueves',
    'viernes',
    'sábado',
    'domingo'
  ];
  const months = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre'
  ];
  // America/Guayaquil permanece en UTC-5 y no aplica horario de verano.
  final operational = value.toUtc().subtract(const Duration(hours: 5));
  final hour = operational.hour.toString().padLeft(2, '0');
  final minute = operational.minute.toString().padLeft(2, '0');
  return '${weekdays[operational.weekday - 1]}, ${operational.day} de '
      '${months[operational.month - 1]} de ${operational.year} · $hour:$minute';
}

String formatEcuadorCompactDate(DateTime value, {bool includeTime = false}) {
  const months = [
    'ene.',
    'feb.',
    'mar.',
    'abr.',
    'may.',
    'jun.',
    'jul.',
    'ago.',
    'sep.',
    'oct.',
    'nov.',
    'dic.'
  ];
  // America/Guayaquil permanece en UTC-5 y no aplica horario de verano.
  final operational = value.toUtc().subtract(const Duration(hours: 5));
  final date =
      '${operational.day} ${months[operational.month - 1]} ${operational.year}';
  if (!includeTime) return date;
  final hour = operational.hour.toString().padLeft(2, '0');
  final minute = operational.minute.toString().padLeft(2, '0');
  return '$date · $hour:$minute';
}

Map<String, int> tripFareBreakdown(Map<String, dynamic> preview) {
  int cents(String key) => ((preview[key] as num?) ?? 0).round();
  final base = cents('baseFareCents');
  final service = cents('platformCommissionCents');
  final stops = cents('stopSurchargeCents');
  final quoted = cents('quotedTotalCents');
  final journeys = base + service;
  return {
    // La comisión forma parte del valor del trayecto y no se expone como un
    // concepto independiente al pasajero.
    'journeys': journeys,
    'stops': stops,
    'adjustments': quoted - journeys - stops,
    'total': quoted,
  };
}

NotificationTarget notificationTargetFor(String? value) {
  final type = value?.toUpperCase();
  if (type == 'CHAT') return NotificationTarget.chat;
  if (type == 'ACTIVE_TRIP') return NotificationTarget.activeTrip;
  if (type == 'TRIP_DETAIL') return NotificationTarget.tripDetail;
  if (type == 'SCHEDULED_TRIPS') return NotificationTarget.scheduledTrips;
  if (type == 'SUPPORT') return NotificationTarget.support;
  if (type == 'TRIP_OFFERS') return NotificationTarget.offers;
  if (type == 'MEMBERSHIP') return NotificationTarget.membership;
  if (type == 'FLEET' || type == 'FLEET_SESSION') {
    return NotificationTarget.fleet;
  }
  if (type == 'NOTIFICATIONS') return NotificationTarget.inbox;
  if (type == 'APP_STORE' || type == 'APP_UPDATE') {
    return NotificationTarget.appStore;
  }
  if (const {
    'SMART_TRIP',
    'SMART_FREQUENT_TRIP',
    'SMART_RETURN_HOME',
    'SMART_FAVORITE_DESTINATION',
    'SMART_SCHEDULED_TRIP',
  }.contains(type)) {
    return NotificationTarget.smartTrip;
  }
  if (type == 'CHAT_MESSAGE') return NotificationTarget.chat;
  if (const {
    'TRIP_OFFER',
    'TRIP_OFFER_CANCELLED',
    'SCHEDULED_TRIP_AVAILABLE',
  }.contains(type)) {
    return NotificationTarget.offers;
  }
  if (type?.startsWith('SCHEDULED_TRIP_') == true ||
      type == 'SCHEDULED_DRIVER_REMINDER') {
    return NotificationTarget.scheduledTrips;
  }
  if (const {
    'TRIP_ASSIGNED',
    'DRIVER_EN_ROUTE',
    'DRIVER_ARRIVED',
    'IN_PROGRESS',
    'DRIVER_CANCELLED_REASSIGNING',
  }.contains(type)) {
    return NotificationTarget.activeTrip;
  }
  if (const {'COMPLETED', 'TRIP_CANCELLED', 'NO_DRIVER'}.contains(type)) {
    return NotificationTarget.tripDetail;
  }
  if (type?.startsWith('SUPPORT_') == true) {
    return NotificationTarget.support;
  }
  if (type?.startsWith('MEMBERSHIP_') == true) {
    return NotificationTarget.membership;
  }
  return NotificationTarget.inbox;
}

bool notificationUsesGeneralInAppBanner(
  String? type, {
  String? category,
}) {
  final normalizedType = type?.trim().toUpperCase();
  final normalizedCategory = category?.trim().toUpperCase();
  if (normalizedType == 'TEST_PUSH' ||
      normalizedType == 'CAMPAIGN' ||
      normalizedType == 'EVENT' ||
      normalizedType == 'PROMOTIONAL' ||
      normalizedType == 'APP_UPDATE' ||
      normalizedType?.startsWith('SMART_') == true) {
    return true;
  }
  return const {'SMART', 'CAMPAIGN', 'PROMOTIONAL'}
      .contains(normalizedCategory);
}

Future<void> openAppUpdateStore(
  BuildContext context,
  Session session, {
  required String? notificationId,
  required String? storeUrl,
}) async {
  final uri = Uri.tryParse(storeUrl ?? '');
  if (uri == null || !const {'https', 'http'}.contains(uri.scheme)) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text(
              'La tienda todavía no está configurada para esta plataforma.')));
    }
    return;
  }
  if (notificationId != null && notificationId.isNotEmpty) {
    try {
      await Api().markNotificationRead(session.token, notificationId);
      await Api().trackNotificationEvent(
          session.token, notificationId, 'STORE_OPENED',
          metadata: {'storeUrl': uri.toString()});
    } catch (_) {
      // Abrir la tienda tiene prioridad sobre la telemetría.
    }
  }
  final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
  if (!opened && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No pudimos abrir la tienda.')));
  }
}

Future<void> openNotificationChat(
    BuildContext context, Session session, String tripId) async {
  final realtime = RealtimeService(baseUrl: base, token: session.token);
  realtime.connect();
  try {
    await showTripChat(
      context: context,
      tripId: tripId,
      userId: session.id,
      isDriver: session.role == 'DRIVER',
      realtime: realtime,
      loadHistory: () => Api().messages(session.token, tripId),
      sendFallback: (clientId, body) =>
          Api().sendMessage(session.token, tripId, clientId, body),
    );
  } finally {
    realtime.dispose();
  }
}

class RoleAwareHeaderIsland extends StatelessWidget {
  const RoleAwareHeaderIsland({
    super.key,
    required this.session,
    required this.onAccount,
    this.onOpenMembership,
  });
  final Session session;
  final Future<void> Function() onAccount;
  final Future<void> Function()? onOpenMembership;

  String get firstName {
    final value = session.name.trim().split(RegExp(r'\s+')).firstOrNull ??
        (session.role == 'DRIVER' ? 'Conductor' : 'Pasajero');
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
                valueListenable: UserNotificationStore.instance.unread,
                builder: (context, unread, _) => Badge(
                  isLabelVisible: unread > 0,
                  label: Text(unread > 99 ? '99+' : '$unread'),
                  child: IconButton(
                    tooltip: 'Notificaciones',
                    onPressed: () async {
                      await Navigator.push(
                          context,
                          MaterialPageRoute(
                              builder: (_) => NotificationCenterView(session,
                                  onOpenMembership: onOpenMembership)));
                      await UserNotificationStore.instance.refresh(session);
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
  bool get isDriver => widget.session.role == 'DRIVER';

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
                                    isDriver: isDriver,
                                    onTap: () => openDetail(items.first),
                                    onRepeat: isDriver
                                        ? null
                                        : () => repeat(items.first)),
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
                                          isDriver: isDriver,
                                          onTap: () => openDetail(trip),
                                          onRepeat: isDriver
                                              ? null
                                              : () => repeat(trip))),
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
      {required this.trip,
      required this.onTap,
      required this.onRepeat,
      required this.isDriver});
  final Map<String, dynamic> trip;
  final VoidCallback onTap;
  final VoidCallback? onRepeat;
  final bool isDriver;
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
                        if (isDriver && trip['passengerName'] != null) ...[
                          const SizedBox(height: 8),
                          Text('Pasajero: ${trip['passengerName']}',
                              style:
                                  const TextStyle(fontWeight: FontWeight.w700)),
                        ],
                        if (onRepeat != null) ...[
                          const SizedBox(height: 14),
                          FilledButton.tonalIcon(
                              onPressed: onRepeat,
                              icon: const Icon(Icons.refresh_rounded),
                              label: const Text('Solicitar nuevamente')),
                        ],
                      ])),
            ])));
  }
}

class _CompactTripTile extends StatelessWidget {
  const _CompactTripTile(
      {required this.trip,
      required this.onTap,
      required this.onRepeat,
      required this.isDriver});
  final Map<String, dynamic> trip;
  final VoidCallback onTap;
  final VoidCallback? onRepeat;
  final bool isDriver;
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
                child: const MototaxiIcon()),
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
            if (onRepeat != null)
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

class NotificationCenterView extends StatefulWidget {
  const NotificationCenterView(this.session,
      {super.key,
      this.initialNotificationId,
      this.initialNotification,
      this.onOpenMembership});
  final Session session;
  final String? initialNotificationId;
  final Map<String, dynamic>? initialNotification;
  final Future<void> Function()? onOpenMembership;
  @override
  State<NotificationCenterView> createState() => _NotificationCenterViewState();
}

class _NotificationCenterViewState extends State<NotificationCenterView> {
  final items = <Map<String, dynamic>>[];
  String? cursor, error;
  bool loading = true, more = false, readingAll = false;
  bool initialNotificationOpened = false;
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
        UserNotificationStore.instance.unread.value =
            (page['unreadCount'] as num?)?.toInt() ?? 0;
      });
      _openInitialNotificationIfNeeded();
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

  void _openInitialNotificationIfNeeded() {
    if (initialNotificationOpened || !mounted) return;
    final requestedId = widget.initialNotificationId;
    Map<String, dynamic>? initial;
    if (requestedId != null) {
      initial = items
          .where((item) => item['id']?.toString() == requestedId)
          .firstOrNull;
    }
    initial ??= widget.initialNotification == null
        ? null
        : Map<String, dynamic>.from(widget.initialNotification!);
    if (initial == null ||
        !notificationOpensInformationalDetail(initial['type']?.toString())) {
      return;
    }
    final notificationToOpen = initial;
    initialNotificationOpened = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) open(notificationToOpen);
    });
  }

  Future<void> markRead(Map<String, dynamic> item) async {
    if (item['readAt'] != null) return;
    final id = item['id']?.toString();
    if (id != null && id.isNotEmpty) {
      try {
        await Api().markNotificationRead(widget.session.token, id);
      } catch (_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
              content: Text('No pudimos actualizar el estado de lectura.')));
        }
        return;
      }
    }
    item['readAt'] = DateTime.now().toIso8601String();
    if (id != null && id.isNotEmpty) {
      UserNotificationStore.instance.unread.value =
          math.max(0, UserNotificationStore.instance.unread.value - 1);
    }
    if (mounted) setState(() {});
  }

  Future<void> open(Map<String, dynamic> item) async {
    final target = notificationTargetFor(item['type']?.toString());
    final data = item['data'] is Map
        ? Map<String, dynamic>.from(item['data'] as Map)
        : <String, dynamic>{};
    final id = (data['tripId'] ?? item['entityId'])?.toString();
    if (!mounted) return;
    if (notificationOpensInformationalDetail(item['type']?.toString())) {
      final action = await _showNotificationDetailSheet(
          context: context,
          session: widget.session,
          notification: item,
          tripId: id);
      if (!mounted) return;
      if (action == null) return;
      await markRead(item);
      if (!mounted) return;
      if (action == _NotificationDetailAction.viewActiveTrip && id != null) {
        await Navigator.push(
            context,
            MaterialPageRoute(
                builder: (_) => PassengerTripDetail(widget.session, id)));
      }
      return;
    }
    await markRead(item);
    if (!mounted) return;
    if (target == NotificationTarget.smartTrip) {
      final notificationId = item['id']?.toString();
      if (notificationId != null && notificationId.isNotEmpty) {
        try {
          await Api().trackNotificationEvent(
              widget.session.token, notificationId, 'DEEP_LINK_OPENED');
        } catch (_) {
          // Preparar el viaje tiene prioridad sobre la telemetría.
        }
      }
      SmartTripSuggestion.pending.value = {
        ...data,
        if (notificationId != null) 'notificationId': notificationId,
        'deepLinkTracked': true,
      };
      if (mounted) Navigator.pop(context);
    } else if (target == NotificationTarget.appStore) {
      await openAppUpdateStore(context, widget.session,
          notificationId: item['id']?.toString(),
          storeUrl:
              item['deepLink']?.toString() ?? data['deepLink']?.toString());
    } else if (target == NotificationTarget.fleet &&
        data['vehicleId'] != null) {
      await Navigator.push(
          context,
          MaterialPageRoute(
              builder: (_) => VehicleDetail(
                  gateway: fleetFor(widget.session),
                  id: data['vehicleId'].toString())));
    } else if (target == NotificationTarget.chat && id != null) {
      await openNotificationChat(context, widget.session, id);
    } else if (target == NotificationTarget.support) {
      final incidentId = (data['incidentId'] ?? item['entityId'])?.toString();
      if (incidentId != null) {
        await Navigator.push(
            context,
            MaterialPageRoute(
                builder: (_) =>
                    SupportIncidentDetail(widget.session, incidentId)));
      }
    } else if (target == NotificationTarget.membership &&
        widget.session.role == 'DRIVER' &&
        widget.onOpenMembership != null) {
      Navigator.pop(context);
      await widget.onOpenMembership!();
    } else if (target == NotificationTarget.offers &&
        widget.session.role == 'DRIVER') {
      if (mounted) Navigator.pop(context);
    } else if (target == NotificationTarget.tripDetail &&
        item['type']?.toString().toUpperCase() == 'COMPLETED' &&
        id != null) {
      await Navigator.push(
          context,
          MaterialPageRoute(
              builder: (_) => PassengerTripDetail(widget.session, id)));
    }
  }

  Future<void> readAll() async {
    if (readingAll) return;
    setState(() => readingAll = true);
    try {
      await Api().markAllNotificationsRead(widget.session.token);
      if (!mounted) return;
      setState(() {
        for (final item in items) {
          item['readAt'] ??= DateTime.now().toIso8601String();
        }
      });
      UserNotificationStore.instance.unread.value = 0;
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('No pudimos marcar todas como leídas.')));
      }
    } finally {
      if (mounted) setState(() => readingAll = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: const Text('Notificaciones'), actions: [
        if (items.any((e) => e['readAt'] == null))
          TextButton(
              onPressed: readingAll ? null : readAll,
              child: Text(readingAll ? 'Actualizando…' : 'Leer todas'))
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
    final navigates = notificationNavigatesDirectly(item['type']?.toString());
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
            trailing: navigates ? const Icon(Icons.chevron_right) : null));
  }
}

enum _NotificationDetailAction { understood, viewActiveTrip }

const _activeTripStatuses = {
  'SEARCHING',
  'ASSIGNED',
  'DRIVER_EN_ROUTE',
  'DRIVER_ARRIVED',
  'IN_PROGRESS',
};

Future<_NotificationDetailAction?> _showNotificationDetailSheet({
  required BuildContext context,
  required Session session,
  required Map<String, dynamic> notification,
  String? tripId,
}) {
  final tripFuture = tripId == null
      ? Future<Map<String, dynamic>?>.value(null)
      : Api().trip(session.token, tripId).then<Map<String, dynamic>?>(
            (value) => Map<String, dynamic>.from(value as Map),
            onError: (_) => null,
          );
  return showModalBottomSheet<_NotificationDetailAction>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) => FutureBuilder<Map<String, dynamic>?>(
          future: tripFuture,
          builder: (context, snapshot) {
            final colors = Theme.of(context).colorScheme;
            final trip = snapshot.data;
            final type = notification['type']?.toString().toUpperCase();
            final status =
                trip == null ? null : trip['status']?.toString().toUpperCase();
            final active =
                status != null && _activeTripStatuses.contains(status);
            final reference = type == 'IN_PROGRESS'
                ? trip == null
                    ? null
                    : trip['destinationReference']
                : trip == null
                    ? null
                    : trip['originReference'];
            final referenceLabel =
                type == 'IN_PROGRESS' ? 'Destino' : 'Punto de recogida';
            final driver = trip == null ? null : trip['driverName']?.toString();
            return Align(
              alignment: Alignment.bottomCenter,
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 560),
                child: Container(
                  decoration: BoxDecoration(
                    color: colors.surface,
                    borderRadius:
                        const BorderRadius.vertical(top: Radius.circular(28)),
                    boxShadow: const [
                      BoxShadow(
                          color: Colors.black26,
                          blurRadius: 24,
                          offset: Offset(0, -4))
                    ],
                  ),
                  padding: const EdgeInsets.fromLTRB(22, 10, 22, 24),
                  child: SingleChildScrollView(
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                      Container(
                        width: 42,
                        height: 4,
                        margin: const EdgeInsets.only(bottom: 20),
                        decoration: BoxDecoration(
                            color: colors.outlineVariant,
                            borderRadius: BorderRadius.circular(999)),
                      ),
                      Container(
                        width: 72,
                        height: 72,
                        decoration: BoxDecoration(
                            color: colors.primaryContainer,
                            shape: BoxShape.circle),
                        child: Icon(Icons.notifications_active_rounded,
                            color: colors.primary, size: 34),
                      ),
                      const SizedBox(height: 16),
                      Text(notification['title']?.toString() ?? 'Costa-Go',
                          textAlign: TextAlign.center,
                          style: Theme.of(context)
                              .textTheme
                              .headlineSmall
                              ?.copyWith(fontWeight: FontWeight.w900)),
                      const SizedBox(height: 8),
                      Text(notification['message']?.toString() ?? '',
                          textAlign: TextAlign.center,
                          style: Theme.of(context)
                              .textTheme
                              .bodyLarge
                              ?.copyWith(
                                  color: colors.onSurfaceVariant,
                                  height: 1.35)),
                      const SizedBox(height: 18),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                            color: colors.surfaceContainerLow,
                            borderRadius: BorderRadius.circular(18),
                            border: Border.all(color: colors.outlineVariant)),
                        child: Column(children: [
                          if (reference != null &&
                              reference.toString().trim().isNotEmpty)
                            _NotificationContextRow(
                                icon: Icons.location_on_outlined,
                                label: referenceLabel,
                                value: cleanAddressLabel(reference,
                                    fallback: referenceLabel)),
                          if (driver != null && driver.trim().isNotEmpty)
                            _NotificationContextRow(
                                icon: Icons.person_outline_rounded,
                                label: 'Conductor',
                                value: driver),
                          _NotificationContextRow(
                              icon: Icons.schedule_rounded,
                              label: 'Fecha y hora',
                              value: _shortDate(notification['createdAt'])),
                        ]),
                      ),
                      const SizedBox(height: 20),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton(
                            onPressed: () => Navigator.pop(sheetContext,
                                _NotificationDetailAction.understood),
                            child: const Text('Entendido')),
                      ),
                      if (snapshot.connectionState == ConnectionState.waiting)
                        const Padding(
                            padding: EdgeInsets.only(top: 14),
                            child: LinearProgressIndicator())
                      else if (active && tripId != null) ...[
                        const SizedBox(height: 10),
                        TextButton.icon(
                            onPressed: () => Navigator.pop(sheetContext,
                                _NotificationDetailAction.viewActiveTrip),
                            icon: const Icon(Icons.visibility_outlined),
                            label: const Text('Ver viaje en curso')),
                      ]
                    ]),
                  ),
                ),
              ),
            );
          }));
}

class _NotificationContextRow extends StatelessWidget {
  const _NotificationContextRow(
      {required this.icon, required this.label, required this.value});
  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icon, size: 22, color: colors.primary),
        const SizedBox(width: 12),
        Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label,
              style: Theme.of(context)
                  .textTheme
                  .labelMedium
                  ?.copyWith(color: colors.primary)),
          const SizedBox(height: 2),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w700)),
        ]))
      ]),
    );
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
                    _participant(context, item),
                    const SizedBox(height: 12),
                    TripVehicleBadge(
                        gateway: fleetFor(widget.session),
                        vehicle: item['vehicleDetails'],
                        historical: true),
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
                            ? 'Transferencia!'
                            : 'Efectivo'),
                    _summaryRow(
                        'Total del viaje',
                        _money(item['finalTotalCents'] ??
                            item['quotedTotalCents']),
                        strong: true),
                    if (item['distanceMeters'] != null)
                      _summaryRow(
                          'Distancia', _distance(item['distanceMeters'])),
                    if (item['durationSeconds'] != null)
                      _summaryRow(
                          'DuraciÃ³n', _duration(item['durationSeconds'])),
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

  Widget _participant(BuildContext context, Map<String, dynamic> item) {
    final driverView = widget.session.role == 'DRIVER';
    final participantId =
        item[driverView ? 'passengerId' : 'driverId']?.toString();
    final participantName =
        item[driverView ? 'passengerName' : 'driverName']?.toString() ??
            (driverView ? 'Pasajero' : 'Conductor no asignado');
    final hasPhoto =
        item[driverView ? 'passengerHasPhoto' : 'driverHasPhoto'] == true;
    final participantRating =
        item[driverView ? 'passengerRating' : 'driverRating'] as num?;
    return Row(children: [
      Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(driverView ? 'Viaje realizado para' : 'Viaje Costa-Go con'),
          Text(
            participantName,
            style: Theme.of(context)
                .textTheme
                .headlineSmall
                ?.copyWith(fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 5),
          Text(_shortDate(item['startedAt'] ??
              item['scheduledFor'] ??
              item['requestedAt'])),
          if (!driverView && item['vehicle'] != null)
            Text(
                '${_money(item['finalTotalCents'] ?? item['quotedTotalCents'])} · '
                '${item['vehicle']}'),
          if (participantRating != null)
            Row(children: [
              const Icon(Icons.star_rounded, size: 18, color: Colors.amber),
              const SizedBox(width: 4),
              Text(participantRating.toStringAsFixed(1))
            ]),
        ]),
      ),
      if (participantId != null)
        ClipOval(
          child: hasPhoto
              ? Image.network(
                  '$base/v1/users/$participantId/profile-photo',
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
        child: CostaGoEmptyState(
          icon: Icons.cloud_off_outlined,
          title: 'No pudimos cargar la información',
          message: message,
          action: FilledButton.icon(
            onPressed: retry,
            icon: const Icon(Icons.refresh_rounded),
            label: const Text('Reintentar'),
          ),
        ),
      );
}

class _PassengerEmpty extends StatelessWidget {
  const _PassengerEmpty(
      {required this.icon, required this.title, required this.message});
  final IconData icon;
  final String title, message;
  @override
  Widget build(BuildContext context) => CostaGoEmptyState(
        icon: icon,
        title: title,
        message: message,
      );
}
