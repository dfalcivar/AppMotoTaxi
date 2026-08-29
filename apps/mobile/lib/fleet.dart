import 'dart:async';
import 'dart:convert';
import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter/services.dart';
import 'fleet_report.dart';
import 'mototaxi_icon.dart';

typedef FleetRequest = Future<dynamic> Function(
    String method, String path, Object? body);

class FleetGateway {
  FleetGateway(this.request, this.photo);
  final FleetRequest request;
  final Future<Uint8List> Function(String id) photo;
  Future<dynamic> get(String path) => request('GET', '/v1/fleet$path', null);
  Future<dynamic> post(String path, Object body) =>
      request('POST', '/v1/fleet$path', body);
  Future<dynamic> put(String path, Object body) =>
      request('PUT', '/v1/fleet$path', body);
}

String fleetLabel(dynamic value) =>
    const {
      'PENDING': 'En revisión',
      'VERIFIED': 'Verificada',
      'SUSPENDED': 'Suspendida',
      'APPROVED': 'Autorizado',
      'REVOKED': 'Revocado',
      'REJECTED': 'Rechazado',
      'AUTHORIZED_DRIVER': 'Conductor autorizado',
      'OWNER_MANAGER': 'Propietario / responsable',
      'ACTIVE': 'Activa',
      'ENDED': 'Finalizada',
      'COMPLETED': 'Finalizado',
      'DRIVER_CANCELLED': 'Cancelado por conductor',
      'PASSENGER_CANCELLED': 'Cancelado por pasajero',
      'MANUAL_RELEASE': 'Fin de jornada',
      'LOGOUT': 'Cierre de sesión',
      'AUTO_RELEASE': 'Desconexión prolongada',
      'TAKEOVER': 'Relevo',
      'VEHICLE_CHANGE': 'Cambio de unidad',
      'ADMIN_RELEASE': 'Liberación administrativa',
      'PHOTO': 'Fotografía',
      'REGISTRATION': 'Matrícula',
      'OPERATING_PERMIT': 'Anexos',
      'OWNERSHIP_EVIDENCE': 'Evidencia de propiedad',
      'CANCELLED': 'Cancelado',
      'REASSIGNED': 'Reasignado',
      'INCIDENT': 'Incidente',
    }[value] ??
    (value?.toString().replaceAll('_', ' ') ?? '—');
String fleetDate(dynamic value) {
  final d = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
  if (d == null) return '—';
  return '${d.day}/${d.month}/${d.year} · ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
}

String fleetToken(Uri uri) {
  final candidate = uri.scheme == 'costa-go' && uri.host == 'vehicle'
      ? uri.pathSegments.lastOrNull
      : uri.scheme == 'https' &&
              uri.host == 'costa-go.com' &&
              uri.path == '/vehicle.html'
          ? uri.queryParameters['token']
          : null;
  return candidate != null && RegExp(r'^[A-Za-z0-9_-]{43}$').hasMatch(candidate)
      ? candidate
      : '';
}

class FleetLinks {
  static final pending = ValueNotifier<String>('');
  static StreamSubscription<Uri>? subscription;
  static Future<void> initialize() async {
    final prefs = await SharedPreferences.getInstance();
    pending.value = prefs.getString('fleet.pendingQr') ?? '';
    final links = AppLinks();
    Future<void> receive(Uri uri) async {
      final token = fleetToken(uri);
      if (token.isEmpty) return;
      await prefs.setString('fleet.pendingQr', token);
      pending.value = token;
    }

    final initial = await links.getInitialLink();
    if (initial != null) await receive(initial);
    subscription ??=
        links.uriLinkStream.listen((uri) => unawaited(receive(uri)));
  }

  static Future<void> clear() async {
    pending.value = '';
    await (await SharedPreferences.getInstance()).remove('fleet.pendingQr');
  }
}

class FleetPhoto extends StatefulWidget {
  const FleetPhoto(
      {super.key, required this.gateway, this.id, this.size = 68, this.height});
  final FleetGateway gateway;
  final String? id;
  final double size;
  final double? height;
  @override
  State<FleetPhoto> createState() => _FleetPhotoState();
}

class _FleetPhotoState extends State<FleetPhoto> {
  Future<Uint8List>? photo;
  @override
  void initState() {
    super.initState();
    photo = widget.id == null ? null : widget.gateway.photo(widget.id!);
  }

  @override
  void didUpdateWidget(FleetPhoto old) {
    super.didUpdateWidget(old);
    if (old.id != widget.id) {
      photo = widget.id == null ? null : widget.gateway.photo(widget.id!);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    Widget fallback() => Semantics(
        label: 'Mototaxi sin fotografía disponible',
        child: Center(
            child:
                MototaxiIcon(size: widget.size * .48, color: colors.primary)));
    return Container(
        width: widget.size,
        height: widget.height ?? widget.size * .75,
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
            color: colors.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
                color: colors.outlineVariant.withValues(alpha: .55))),
        child: FutureBuilder<Uint8List>(
            future: photo,
            builder: (context, s) {
              if (s.hasData) {
                return Image.memory(s.data!,
                    fit: BoxFit.cover,
                    alignment: Alignment.center,
                    semanticLabel: 'Fotografía real de la mototaxi',
                    errorBuilder: (_, __, ___) => fallback());
              }
              if (s.connectionState == ConnectionState.waiting) {
                return Center(
                    child: SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: colors.primary)));
              }
              return fallback();
            }));
  }
}

class FleetUnitSummary extends StatelessWidget {
  const FleetUnitSummary(
      {super.key,
      required this.gateway,
      required this.vehicle,
      this.active = false});
  final FleetGateway gateway;
  final dynamic vehicle;
  final bool active;
  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final model = [vehicle['brand'], vehicle['model']]
        .where((value) => value != null && value.toString().trim().isNotEmpty)
        .join(' ');
    final info = [
      vehicle['color'],
      if ('${vehicle['unitNumber'] ?? ''}'.trim().isNotEmpty)
        'Unidad ${vehicle['unitNumber']}'
    ].whereType<String>().where((s) => s.trim().isNotEmpty).join(' · ');
    return Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
            color: colors.surfaceContainerLow,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: colors.outlineVariant)),
        child: Row(children: [
          FleetPhoto(
              gateway: gateway,
              id: vehicle['photoId']?.toString(),
              size: 96,
              height: 76),
          const SizedBox(width: 12),
          Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                Text('${vehicle['identifier'] ?? 'Mototaxi'}',
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w800)),
                if (model.isNotEmpty)
                  Text(model,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall),
                if (info.isNotEmpty)
                  Text(info,
                      style: Theme.of(context)
                          .textTheme
                          .bodySmall
                          ?.copyWith(color: colors.onSurfaceVariant)),
                if (active)
                  Padding(
                      padding: const EdgeInsets.only(top: 5),
                      child: Text('Activa',
                          style: Theme.of(context)
                              .textTheme
                              .labelSmall
                              ?.copyWith(color: colors.primary))),
                if (!active && vehicle['status'] == 'VERIFIED')
                  Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text('Verificada',
                          style: Theme.of(context)
                              .textTheme
                              .labelSmall
                              ?.copyWith(
                                  color: colors.primary,
                                  fontWeight: FontWeight.w700))),
              ]))
        ]));
  }
}

Future<void> showFleetVehiclePreview(BuildContext context,
    {required FleetGateway gateway, required dynamic vehicle}) async {
  if (vehicle is! Map) return;
  final model = [vehicle['brand'], vehicle['model']]
      .where((value) => value != null && value.toString().trim().isNotEmpty)
      .join(' ');
  final details = [
    if ('${vehicle['color'] ?? ''}'.trim().isNotEmpty) vehicle['color'],
    if ('${vehicle['unitNumber'] ?? ''}'.trim().isNotEmpty)
      'Unidad ${vehicle['unitNumber']}'
  ].join(' · ');
  await showDialog<void>(
      context: context,
      builder: (dialogContext) {
        final colors = Theme.of(dialogContext).colorScheme;
        return Dialog(
            backgroundColor: colors.surface,
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)),
            insetPadding:
                const EdgeInsets.symmetric(horizontal: 22, vertical: 24),
            child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 390),
                child: SingleChildScrollView(
                    padding: const EdgeInsets.all(20),
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                      Align(
                          alignment: Alignment.centerRight,
                          child: IconButton(
                              tooltip: 'Cerrar',
                              onPressed: () => Navigator.pop(dialogContext),
                              icon: const Icon(Icons.close))),
                      LayoutBuilder(builder: (context, constraints) {
                        final width =
                            constraints.maxWidth.clamp(180.0, 300.0).toDouble();
                        return Center(
                            child: FleetPhoto(
                                gateway: gateway,
                                id: vehicle['photoId']?.toString(),
                                size: width,
                                height: width * .68));
                      }),
                      const SizedBox(height: 18),
                      Text('Mototaxi ${vehicle['identifier'] ?? ''}',
                          textAlign: TextAlign.center,
                          style: Theme.of(dialogContext)
                              .textTheme
                              .titleLarge
                              ?.copyWith(fontWeight: FontWeight.w800)),
                      if (model.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Text(model,
                            textAlign: TextAlign.center,
                            style:
                                Theme.of(dialogContext).textTheme.bodyMedium),
                      ],
                      if (details.isNotEmpty) ...[
                        const SizedBox(height: 3),
                        Text(details,
                            textAlign: TextAlign.center,
                            style: Theme.of(dialogContext)
                                .textTheme
                                .bodyMedium
                                ?.copyWith(color: colors.onSurfaceVariant)),
                      ],
                      if (vehicle['status'] == 'VERIFIED' ||
                          vehicle['verified'] == true) ...[
                        const SizedBox(height: 10),
                        Chip(
                            avatar: Icon(Icons.verified_outlined,
                                size: 18, color: colors.primary),
                            label: const Text('Verificada')),
                      ],
                      const SizedBox(height: 16),
                      SizedBox(
                          width: double.infinity,
                          child: FilledButton(
                              onPressed: () => Navigator.pop(dialogContext),
                              child: const Text('Entendido')))
                    ]))));
      });
}

class TripVehicleBadge extends StatelessWidget {
  const TripVehicleBadge(
      {super.key,
      required this.gateway,
      required this.vehicle,
      this.historical = false,
      this.showSafety = true});
  final FleetGateway gateway;
  final dynamic vehicle;
  final bool historical, showSafety;
  @override
  Widget build(BuildContext context) {
    if (vehicle is! Map) return const SizedBox.shrink();
    final s = Theme.of(context).colorScheme;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () {
          final preview = Map<String, dynamic>.from(vehicle as Map);
          preview['verified'] = true;
          showFleetVehiclePreview(context, gateway: gateway, vehicle: preview);
        },
        child: Container(
            padding: const EdgeInsets.all(9),
            decoration: BoxDecoration(
                color: s.surfaceContainerLow,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: s.outlineVariant)),
            child: Row(children: [
              FleetPhoto(
                  gateway: gateway,
                  id: vehicle['photoId']?.toString(),
                  size: 64),
              const SizedBox(width: 10),
              Expanded(
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                    Text(
                        '${historical ? 'Mototaxi usada:' : 'Mototaxi'} ${vehicle['identifier'] ?? ''}',
                        style: Theme.of(context).textTheme.titleSmall),
                    Text(
                        [
                          vehicle['color'],
                          if (vehicle['unitNumber'] != null)
                            'Unidad ${vehicle['unitNumber']}'
                        ].whereType<String>().join(' · '),
                        style: Theme.of(context).textTheme.bodySmall),
                    if (showSafety && !historical)
                      const Text(
                          'Verifica que la mototaxi coincida antes de subir.',
                          style: TextStyle(fontSize: 11)),
                  ])),
              Icon(Icons.chevron_right, size: 22, color: s.primary)
            ])),
      ),
    );
  }
}

Future<bool> fleetConfirm(BuildContext context,
        {required String title,
        required String text,
        String action = 'Confirmar',
        FleetGateway? gateway,
        String? photoId,
        dynamic vehicle}) async =>
    await showDialog<bool>(
        context: context,
        builder: (c) => _FleetDecisionDialog(
                title: title,
                text: text,
                unit: gateway == null
                    ? null
                    : vehicle != null
                        ? FleetUnitSummary(gateway: gateway, vehicle: vehicle)
                        : Center(
                            child: FleetPhoto(
                                gateway: gateway, id: photoId, size: 100)),
                actions: [
                  FilledButton(
                      onPressed: () => Navigator.pop(c, true),
                      child: Text(action, textAlign: TextAlign.center)),
                  TextButton(
                      onPressed: () => Navigator.pop(c, false),
                      child: const Text('Volver'))
                ])) ??
    false;

Future<String?> fleetPauseDialog(BuildContext context,
        {required FleetGateway gateway, dynamic vehicle}) =>
    showDialog<String>(
        context: context,
        builder: (c) => _FleetDecisionDialog(
                title: 'Dejar de recibir viajes',
                text:
                    'Puedes pausar tu disponibilidad y conservar la mototaxi activa, o finalizar tu jornada y liberarla para otro conductor.',
                pause: true,
                unit: vehicle == null
                    ? null
                    : FleetUnitSummary(
                        gateway: gateway, vehicle: vehicle, active: true),
                actions: [
                  OutlinedButton(
                      onPressed: () => Navigator.pop(c, 'PAUSE'),
                      child: const Text('Pausar')),
                  FilledButton(
                      onPressed: () => Navigator.pop(c, 'FINISH'),
                      child: const Text('Finalizar jornada')),
                  TextButton(
                      onPressed: () => Navigator.pop(c),
                      child: const Text('Volver'))
                ]));

class _FleetDecisionDialog extends StatelessWidget {
  const _FleetDecisionDialog(
      {required this.title,
      required this.text,
      required this.actions,
      this.unit,
      this.pause = false});
  final String title, text;
  final List<Widget> actions;
  final Widget? unit;
  final bool pause;
  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Dialog(
        backgroundColor: colors.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)),
        insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
        child: ConstrainedBox(
            constraints: BoxConstraints(
                maxWidth: 380,
                maxHeight: MediaQuery.sizeOf(context).height * .85),
            child: SingleChildScrollView(
                padding: const EdgeInsets.all(22),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                          color: colors.primary.withValues(alpha: .09),
                          shape: BoxShape.circle),
                      child: pause
                          ? Icon(Icons.pause_rounded,
                              size: 26, color: colors.primary)
                          : MototaxiIcon(size: 28, color: colors.primary)),
                  const SizedBox(height: 16),
                  Text(title,
                      textAlign: TextAlign.center,
                      style: Theme.of(context)
                          .textTheme
                          .titleLarge
                          ?.copyWith(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 10),
                  Text(text,
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: colors.onSurfaceVariant, height: 1.45)),
                  if (unit != null) ...[const SizedBox(height: 18), unit!],
                  const SizedBox(height: 18),
                  for (final action in actions)
                    Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: SizedBox(width: double.infinity, child: action)),
                ]))));
  }
}

Future<String?> scanVehicle(BuildContext context) => Navigator.push<String>(
    context, MaterialPageRoute(builder: (_) => const _FleetScanner()));

class _FleetScanner extends StatefulWidget {
  const _FleetScanner();
  @override
  State<_FleetScanner> createState() => _FleetScannerState();
}

class _FleetScannerState extends State<_FleetScanner> {
  final controller = MobileScannerController(
      formats: const [BarcodeFormat.qrCode],
      detectionSpeed: DetectionSpeed.noDuplicates,
      autoZoom: true);
  bool done = false;
  String? error;
  @override
  void dispose() {
    unawaited(controller.dispose());
    super.dispose();
  }

  Future<void> finish(String token) async {
    if (done) return;
    done = true;
    try {
      await controller.stop();
    } catch (_) {
      // The page may be closing while the native camera is stopping.
    }
    if (mounted) Navigator.pop(context, token);
  }

  void detect(BarcodeCapture capture) {
    if (done) return;
    for (final code in capture.barcodes) {
      final uri = Uri.tryParse(code.rawValue?.trim() ?? '');
      final token = uri == null ? '' : fleetToken(uri);
      if (token.isNotEmpty) {
        unawaited(finish(token));
        return;
      }
    }
    if (mounted && error != 'Este no es un QR de mototaxi Costa-Go.') {
      setState(() => error = 'Este no es un QR de mototaxi Costa-Go.');
    }
  }

  Widget cameraError(BuildContext context, MobileScannerException failure) {
    final colors = Theme.of(context).colorScheme;
    final permission =
        failure.errorCode == MobileScannerErrorCode.permissionDenied;
    final unsupported = failure.errorCode == MobileScannerErrorCode.unsupported;
    return ColoredBox(
        color: colors.surface,
        child: Center(
            child: Padding(
                padding: const EdgeInsets.all(28),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Icon(
                      permission
                          ? Icons.no_photography_outlined
                          : unsupported
                              ? Icons.camera_alt_outlined
                              : Icons.error_outline,
                      size: 52,
                      color: colors.error),
                  const SizedBox(height: 14),
                  Text(
                      permission
                          ? 'Permiso de cámara necesario'
                          : unsupported
                              ? 'Cámara no disponible'
                              : 'No se pudo iniciar la cámara',
                      textAlign: TextAlign.center,
                      style: Theme.of(context)
                          .textTheme
                          .titleMedium
                          ?.copyWith(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 8),
                  Text(
                      permission
                          ? 'Autoriza la cámara para escanear el QR. Si la bloqueaste, habilítala desde los ajustes del teléfono.'
                          : unsupported
                              ? 'Este dispositivo no dispone de una cámara compatible con el lector QR.'
                              : 'Cierra el lector e inténtalo nuevamente.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: colors.onSurfaceVariant)),
                  if (!unsupported) ...[
                    const SizedBox(height: 16),
                    FilledButton.icon(
                        onPressed: () => controller.start(),
                        icon: const Icon(Icons.refresh),
                        label: const Text('Reintentar'))
                  ]
                ]))));
  }

  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(
          title: const Text('Escanear mototaxi'),
          leading: IconButton(
              tooltip: 'Cerrar lector',
              onPressed: () => Navigator.pop(context),
              icon: const Icon(Icons.close))),
      body: Column(children: [
        const Padding(
            padding: EdgeInsets.all(16),
            child: Text(
                'Escanea el QR de Costa-Go colocado en la unidad. Debes estar autorizado para usarla.')),
        if (error != null)
          Padding(padding: const EdgeInsets.all(12), child: Text(error!)),
        Expanded(
            child: ClipRRect(
                borderRadius:
                    const BorderRadius.vertical(top: Radius.circular(24)),
                child: MobileScanner(
                    controller: controller,
                    onDetect: detect,
                    errorBuilder: cameraError,
                    placeholderBuilder: (context) =>
                        const Center(child: CircularProgressIndicator()),
                    overlayBuilder: (context, constraints) => Center(
                        child: Container(
                            width: constraints.maxWidth * .68,
                            height: constraints.maxWidth * .68,
                            decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(26),
                                border: Border.all(
                                    color: Colors.white, width: 3))))))),
      ]));
}

/// Ownership is scoped to units, independently of the active passenger/driver mode.
/// Uses the existing managed list so this entry also works with the installed API.
class FleetProfileEntries extends StatefulWidget {
  const FleetProfileEntries(
      {super.key, required this.gateway, required this.hasDriverCapability});
  final FleetGateway gateway;
  final bool hasDriverCapability;
  @override
  State<FleetProfileEntries> createState() => _FleetProfileEntriesState();
}

class _FleetProfileEntriesState extends State<FleetProfileEntries>
    with WidgetsBindingObserver {
  int count = 0;
  bool loading = true, failed = false, opening = false;
  int revision = 0;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(load());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && !opening) unawaited(load());
  }

  Future<void> load() async {
    final request = ++revision;
    try {
      final result = await widget.gateway.get('/vehicles?managed=true&page=0');
      final items = result['items'] as List;
      final total = items.isEmpty
          ? 0
          : int.tryParse('${items.first['totalCount']}') ?? items.length;
      if (mounted && request == revision) {
        setState(() {
          count = total;
          failed = false;
          loading = false;
        });
      }
    } catch (_) {
      if (mounted && request == revision) {
        setState(() {
          failed = true;
          loading = false;
        });
      }
    }
  }

  Future<void> open({bool owner = false, bool firstUnit = false}) async {
    if (opening) return;
    setState(() => opening = true);
    try {
      if (firstUnit) {
        await showModalBottomSheet<bool>(
            context: context,
            isScrollControlled: true,
            useSafeArea: true,
            builder: (_) => _VehicleForm(gateway: widget.gateway, owner: true));
      } else {
        await Navigator.push(
            context,
            MaterialPageRoute(
                builder: (_) =>
                    FleetScreen(gateway: widget.gateway, ownerOnly: owner)));
      }
      if (mounted) await load();
    } finally {
      if (mounted) setState(() => opening = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    Widget leading() => Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
            color: scheme.primary.withValues(alpha: .10),
            borderRadius: BorderRadius.circular(12)),
        child: MototaxiIcon(color: scheme.primary, size: 22));
    return Column(mainAxisSize: MainAxisSize.min, children: [
      if (widget.hasDriverCapability) ...[
        const Divider(height: 1),
        ListTile(
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 14, vertical: 3),
            leading: leading(),
            title: const Text('Mis mototaxis'),
            subtitle: const Text('Unidades que puedes conducir'),
            trailing: const Icon(Icons.chevron_right),
            onTap: opening ? null : () => open()),
      ],
      if (!loading && count > 0) ...[
        const Divider(height: 1),
        ListTile(
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 14, vertical: 3),
            leading: leading(),
            title: const Text('Mi flota'),
            subtitle: Text('$count ${count == 1 ? 'mototaxi' : 'mototaxis'}'),
            trailing: const Icon(Icons.chevron_right),
            onTap: opening ? null : () => open(owner: true)),
      ] else if (!loading && !failed)
        Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
                onPressed:
                    opening ? null : () => open(owner: true, firstUnit: true),
                child: const Text('Registrar o reclamar una mototaxi'))),
      if (failed)
        TextButton.icon(
            onPressed: opening ? null : load,
            icon: const Icon(Icons.refresh, size: 18),
            label: const Text('Reintentar consulta de flota')),
    ]);
  }
}

class FleetScreen extends StatefulWidget {
  const FleetScreen(
      {super.key,
      required this.gateway,
      this.select = false,
      this.ownerOnly = false});
  final FleetGateway gateway;
  final bool select, ownerOnly;
  @override
  State<FleetScreen> createState() => _FleetScreenState();
}

class _FleetEmptyState extends StatelessWidget {
  const _FleetEmptyState(
      {required this.title,
      required this.message,
      required this.primaryLabel,
      required this.onPrimary,
      this.coastal = false,
      this.secondaryLabel,
      this.onSecondary});
  final String title, message, primaryLabel;
  final VoidCallback? onPrimary, onSecondary;
  final String? secondaryLabel;
  final bool coastal;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Padding(
        padding: const EdgeInsets.fromLTRB(18, 8, 18, 16),
        child: Center(
            child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  if (coastal)
                    Container(
                        key: const ValueKey('fleet-coastal-empty-art'),
                        width: double.infinity,
                        clipBehavior: Clip.antiAlias,
                        decoration: BoxDecoration(
                            color: colors.primaryContainer
                                .withValues(alpha: dark ? .18 : .28),
                            borderRadius: BorderRadius.circular(26),
                            border: Border.all(
                                color: colors.outlineVariant
                                    .withValues(alpha: .65))),
                        child: AspectRatio(
                            aspectRatio: 1.48,
                            child: Image.asset(
                                dark
                                    ? 'assets/images/fleet-empty-dark.png'
                                    : 'assets/images/fleet-empty-light.png',
                                key: ValueKey(dark
                                    ? 'fleet-empty-dark'
                                    : 'fleet-empty-light'),
                                fit: BoxFit.cover,
                                alignment: Alignment.center,
                                semanticLabel:
                                    'Mototaxi Costa-Go frente al malecón y el mar')))
                  else
                    Container(
                        width: 104,
                        height: 90,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                            color:
                                colors.primaryContainer.withValues(alpha: .42),
                            borderRadius: BorderRadius.circular(34)),
                        child: MototaxiIcon(size: 54, color: colors.primary)),
                  SizedBox(height: coastal ? 16 : 14),
                  if (coastal) ...[
                    Container(
                        width: 58,
                        height: 58,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                            color: colors.primary.withValues(alpha: .09),
                            shape: BoxShape.circle),
                        child: MototaxiIcon(size: 30, color: colors.primary)),
                    const SizedBox(height: 10),
                  ],
                  Text(title,
                      textAlign: TextAlign.center,
                      style: Theme.of(context)
                          .textTheme
                          .titleLarge
                          ?.copyWith(fontWeight: FontWeight.w800)),
                  const SizedBox(height: 8),
                  Text(message,
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: colors.onSurfaceVariant, height: 1.4)),
                  const SizedBox(height: 18),
                  SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                          onPressed: onPrimary,
                          icon: const Icon(Icons.add),
                          label: Text(primaryLabel))),
                  if (secondaryLabel != null) ...[
                    const SizedBox(height: 8),
                    SizedBox(
                        width: double.infinity,
                        child: OutlinedButton.icon(
                            onPressed: onSecondary,
                            icon: const Icon(Icons.verified_user_outlined),
                            label: Text(secondaryLabel!)))
                  ]
                ]))));
  }
}

class _FleetAlertBanner extends StatelessWidget {
  const _FleetAlertBanner({required this.message});
  final String message;
  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final warning = colors.tertiary;
    return Container(
        width: double.infinity,
        margin: const EdgeInsets.only(top: 10),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
            color: warning.withValues(alpha: .10),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: warning.withValues(alpha: .32))),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(Icons.warning_amber_rounded, size: 20, color: warning),
          const SizedBox(width: 9),
          Expanded(
              child: Text(message,
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(height: 1.35)))
        ]));
  }
}

class _FleetScreenState extends State<FleetScreen> {
  List<dynamic> rows = [];
  bool loading = true, busy = false, hasNextPage = false;
  String? error;
  int page = 0;
  final search = TextEditingController();
  bool get vehicleInUse =>
      (error ?? '').contains('VEHICLE_IN_USE') ||
      (error ?? '').contains('continúa conectado') ||
      (error ?? '').contains('utilizando esta mototaxi');
  @override
  void initState() {
    super.initState();
    unawaited(load());
  }

  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  Future<void> load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final data = await widget.gateway.get(
          '/vehicles?page=$page&search=${Uri.encodeQueryComponent(search.text.trim())}&managed=${widget.ownerOnly}'
          '&relationType=${widget.ownerOnly ? 'OWNER_MANAGER' : 'AUTHORIZED_DRIVER'}'
          '${widget.select ? '&authorizedOnly=true&status=VERIFIED' : ''}');
      final items = data['items'] as List;
      // Also separate lists when talking to the previous API, which ignores new filters.
      final filtered = items
          .where((v) =>
              (v['relations'] as List? ?? []).any((r) =>
                  r['type'] ==
                      (widget.ownerOnly
                          ? 'OWNER_MANAGER'
                          : 'AUTHORIZED_DRIVER') &&
                  (r['status'] == 'APPROVED' ||
                      (!widget.select && r['status'] == 'PENDING'))) &&
              (!widget.select || v['status'] == 'VERIFIED'))
          .toList();
      if (mounted) {
        setState(() {
          rows = filtered;
          hasNextPage = items.length == 30;
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> choose(dynamic v, {String method = 'MANUAL_SELECTION'}) async {
    if (busy) return;
    if (!await fleetConfirm(context,
            title: 'Hoy conducirás ${v['identifier']}',
            text: 'Confirma que esta es la mototaxi que conducirás.',
            action: 'Usar mototaxi',
            gateway: widget.gateway,
            vehicle: v) ||
        !mounted) {
      return;
    }
    setState(() => busy = true);
    try {
      final result = await widget.gateway
          .post('/session', {'vehicleId': v['id'], 'method': method});
      if (mounted) Navigator.pop(context, result);
    } catch (e) {
      if (!mounted) return;
      if (e.toString().contains('posesión física') ||
          e.toString().contains('TAKEOVER_CONFIRMATION')) {
        final yes = await fleetConfirm(context,
            title: '¿Tienes físicamente esta mototaxi?',
            text:
                'La jornada anterior está sin conexión. Solo puedes tomar la unidad si no tiene una carrera activa. El relevo quedará registrado.',
            action: 'Confirmar relevo',
            gateway: widget.gateway,
            vehicle: v);
        if (yes) {
          try {
            final result = await widget.gateway.post('/session',
                {'vehicleId': v['id'], 'method': method, 'takeover': true});
            if (mounted) Navigator.pop(context, result);
          } catch (e) {
            if (mounted) setState(() => error = e.toString());
          }
        }
      } else {
        setState(() => error = e.toString());
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> scan() async {
    final token = await scanVehicle(context);
    if (token == null || !mounted) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final v = await widget.gateway.post('/qr/resolve', {'token': token});
      if (!mounted) return;
      if (v['inUse'] == true) {
        setState(() => error =
            'Esta mototaxi tiene una jornada activa con otro conductor. Elige otra unidad o inténtalo cuando quede disponible.');
        return;
      }
      if (v['authorized'] != true) {
        if (await fleetConfirm(context,
            title: 'Solicitar autorización',
            text:
                'Esta mototaxi no está asociada a tu perfil. Solicita autorización para utilizarla.',
            action: 'Solicitar')) {
          await widget.gateway.post('/qr/request', {'token': token});
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                content: Text(
                    'Solicitud enviada. Podrás usar la mototaxi cuando sea autorizada.')));
            await load();
          }
        }
        return;
      }
      setState(() => busy = false);
      await choose(v, method: 'QR_SCAN');
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
        appBar: AppBar(
            title: Text(widget.ownerOnly
                ? 'Mi flota'
                : widget.select
                    ? 'Seleccionar mototaxi'
                    : 'Mis mototaxis'),
            actions: [
              if (widget.ownerOnly)
                IconButton(
                    onPressed: () => Navigator.push(
                        context,
                        MaterialPageRoute(
                            builder: (_) =>
                                FleetReportScreen(gateway: widget.gateway))),
                    tooltip: 'Resumen de flota',
                    icon: const Icon(Icons.insights_outlined)),
              if (widget.select)
                IconButton(
                    onPressed: busy ? null : scan,
                    tooltip: 'Escanear QR',
                    icon: const Icon(Icons.qr_code_scanner))
            ]),
        body: SafeArea(
            child: Column(children: [
          Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
              child: Column(children: [
                Text(
                    widget.select
                        ? 'Selecciona la unidad que conducirás hoy.'
                        : widget.ownerOnly
                            ? 'Unidades que administras como propietario o responsable.'
                            : 'Unidades que puedes conducir y solicitudes de autorización.',
                    style: Theme.of(context).textTheme.bodyMedium),
                const SizedBox(height: 12),
                TextField(
                    controller: search,
                    decoration: InputDecoration(
                        hintText: 'Buscar placa o unidad',
                        prefixIcon: const Icon(Icons.search),
                        suffixIcon: IconButton(
                            onPressed: () {
                              page = 0;
                              unawaited(load());
                            },
                            icon: const Icon(Icons.arrow_forward))),
                    onSubmitted: (_) {
                      page = 0;
                      unawaited(load());
                    }),
                if (error != null)
                  vehicleInUse
                      ? const _FleetAlertBanner(
                          message:
                              'Esta mototaxi tiene una jornada activa con otro conductor. Elige otra unidad o inténtalo cuando quede disponible.')
                      : Padding(
                          padding: const EdgeInsets.all(10),
                          child: Text(error!,
                              style: TextStyle(color: scheme.error))),
              ])),
          if (loading) const LinearProgressIndicator(),
          Expanded(
              child: RefreshIndicator(
                  onRefresh: load,
                  child: rows.isEmpty && !loading
                      ? ListView(children: [
                          _FleetEmptyState(
                              title: widget.ownerOnly
                                  ? 'Aún no tienes mototaxis en tu flota'
                                  : 'Aún no tienes mototaxis disponibles',
                              message: widget.ownerOnly
                                  ? 'Registra o reclama una unidad para comenzar a administrar tu flota.'
                                  : 'Agrega una unidad o solicita autorización para empezar tu jornada.',
                              primaryLabel: 'Agregar mototaxi',
                              onPrimary: busy ? null : add,
                              coastal: widget.select && !widget.ownerOnly,
                              secondaryLabel: widget.ownerOnly
                                  ? null
                                  : 'Solicitar autorización',
                              onSecondary: busy ? null : scan)
                        ])
                      : ListView.separated(
                          padding: const EdgeInsets.all(16),
                          itemCount: rows.length,
                          separatorBuilder: (_, __) =>
                              const SizedBox(height: 12),
                          itemBuilder: (c, i) {
                            final v = rows[i];
                            final model = [v['brand'], v['model']]
                                .where((x) =>
                                    x != null && x.toString().trim().isNotEmpty)
                                .join(' ');
                            final details = [
                              if ((v['color']?.toString().trim() ?? '')
                                  .isNotEmpty)
                                v['color'],
                              if ((v['unitNumber']?.toString().trim() ?? '')
                                  .isNotEmpty)
                                'Unidad ${v['unitNumber']}',
                            ].join(' · ');
                            return Card(
                                margin: EdgeInsets.zero,
                                child: InkWell(
                                    borderRadius: BorderRadius.circular(18),
                                    onTap: busy
                                        ? null
                                        : () => widget.select
                                            ? choose(v)
                                            : openDetail(v),
                                    child: Padding(
                                        padding: const EdgeInsets.all(12),
                                        child: Row(children: [
                                          FleetPhoto(
                                              gateway: widget.gateway,
                                              id: v['photoId']?.toString(),
                                              size: 92,
                                              height: 72),
                                          const SizedBox(width: 12),
                                          Expanded(
                                              child: Column(
                                                  crossAxisAlignment:
                                                      CrossAxisAlignment.start,
                                                  children: [
                                                Text(v['identifier'],
                                                    style: Theme.of(c)
                                                        .textTheme
                                                        .titleMedium
                                                        ?.copyWith(
                                                            fontWeight:
                                                                FontWeight
                                                                    .w700)),
                                                if (model.isNotEmpty)
                                                  Text(model,
                                                      style: Theme.of(c)
                                                          .textTheme
                                                          .bodySmall),
                                                if (details.isNotEmpty)
                                                  Text(details,
                                                      style: Theme.of(c)
                                                          .textTheme
                                                          .bodySmall),
                                                if (v['status'] == 'VERIFIED')
                                                  Padding(
                                                      padding:
                                                          const EdgeInsets.only(
                                                              top: 3),
                                                      child: Row(children: [
                                                        Icon(
                                                            Icons
                                                                .verified_outlined,
                                                            size: 15,
                                                            color:
                                                                scheme.primary),
                                                        const SizedBox(
                                                            width: 4),
                                                        Text('Verificada',
                                                            style: TextStyle(
                                                                color: scheme
                                                                    .primary,
                                                                fontSize: 12,
                                                                fontWeight:
                                                                    FontWeight
                                                                        .w700))
                                                      ]))
                                                else
                                                  Text(fleetLabel(v['status']),
                                                      style: TextStyle(
                                                          color: scheme.primary,
                                                          fontSize: 12)),
                                                if (widget.ownerOnly)
                                                  Text(
                                                      v['currentDriverName'] ??
                                                          'Sin conductor conectado',
                                                      style: Theme.of(c)
                                                          .textTheme
                                                          .bodySmall),
                                                if ((v['relations'] as List? ??
                                                        [])
                                                    .any((r) =>
                                                        r['type'] ==
                                                            (widget
                                                                    .ownerOnly
                                                                ? 'OWNER_MANAGER'
                                                                : 'AUTHORIZED_DRIVER') &&
                                                        r['status'] ==
                                                            'PENDING'))
                                                  Text(
                                                      'Relación pendiente de validación',
                                                      style: TextStyle(
                                                          color: scheme
                                                              .onSurfaceVariant,
                                                          fontSize: 12))
                                              ])),
                                          Container(
                                              width: 34,
                                              height: 34,
                                              alignment: Alignment.center,
                                              decoration: BoxDecoration(
                                                  shape: BoxShape.circle,
                                                  color: widget.select
                                                      ? scheme.primaryContainer
                                                          .withValues(alpha: .5)
                                                      : Colors.transparent),
                                              child: Icon(
                                                  widget.select
                                                      ? Icons
                                                          .radio_button_unchecked
                                                      : Icons.chevron_right,
                                                  color: scheme.primary))
                                        ]))));
                          }))),
          if (rows.isNotEmpty || loading)
            Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              IconButton(
                  onPressed: page > 0 && !loading
                      ? () {
                          page--;
                          unawaited(load());
                        }
                      : null,
                  icon: const Icon(Icons.chevron_left)),
              Text('Página ${page + 1}'),
              IconButton(
                  onPressed: hasNextPage && !loading
                      ? () {
                          page++;
                          unawaited(load());
                        }
                      : null,
                  icon: const Icon(Icons.chevron_right))
            ]),
          if (!widget.select && (rows.isNotEmpty || loading))
            Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                child: SizedBox(
                    width: double.infinity,
                    child: FilledButton.tonalIcon(
                        onPressed: busy ? null : add,
                        icon: const Icon(Icons.add_circle_outline),
                        label: const Text('Agregar mototaxi')))),
        ])));
  }

  Future<void> add() async {
    final saved = await showModalBottomSheet<bool>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        builder: (_) =>
            _VehicleForm(gateway: widget.gateway, owner: widget.ownerOnly));
    if (saved == true && mounted) await load();
  }

  Future<void> openDetail(dynamic v) async {
    await Navigator.push(
        context,
        MaterialPageRoute(
            builder: (_) =>
                VehicleDetail(gateway: widget.gateway, id: v['id'])));
    if (mounted) await load();
  }
}

class _VehicleForm extends StatefulWidget {
  const _VehicleForm({required this.gateway, this.vehicle, this.owner = false});
  final FleetGateway gateway;
  final bool owner;
  final Map<String, dynamic>? vehicle;
  @override
  State<_VehicleForm> createState() => _VehicleFormState();
}

class _VehicleFormState extends State<_VehicleForm> {
  final form = GlobalKey<FormState>();
  final fields = <String, TextEditingController>{};
  String relation = 'AUTHORIZED_DRIVER';
  Uint8List? photo;
  String? mime, error, createdId;
  bool busy = false, linkExisting = false;
  @override
  void initState() {
    super.initState();
    if (widget.owner) relation = 'OWNER_MANAGER';
    for (final k in [
      'identifier',
      'brand',
      'model',
      'color',
      'unitNumber',
      'declaredOwnerName'
    ]) {
      fields[k] =
          TextEditingController(text: widget.vehicle?[k]?.toString() ?? '');
    }
  }

  @override
  void dispose() {
    for (final c in fields.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> pick() async {
    final f = await ImagePicker().pickImage(source: ImageSource.gallery);
    if (f == null) return;
    final b = await f.readAsBytes();
    if (!mounted) return;
    final ext = f.name.toLowerCase();
    if (b.length > 5 * 1024 * 1024 ||
        !(ext.endsWith('.jpg') ||
            ext.endsWith('.jpeg') ||
            ext.endsWith('.png'))) {
      setState(() => error = 'Usa una fotografía JPG o PNG de máximo 5 MB.');
      return;
    }
    setState(() {
      photo = b;
      mime = ext.endsWith('.png') ? 'image/png' : 'image/jpeg';
    });
  }

  Future<void> save() async {
    if (busy || !form.currentState!.validate()) return;
    if (!linkExisting &&
        widget.vehicle == null &&
        createdId == null &&
        photo == null) {
      setState(() => error =
          'Selecciona la fotografía real de la mototaxi. Si ya está registrada, usa «Vincular existente».');
      return;
    }
    setState(() => busy = true);
    try {
      final body = {
        for (final e in fields.entries) e.key: e.value.text.trim(),
        'relationType': relation,
        'maximumPassengers': widget.vehicle?['maximumPassengers'] ?? 3
      };
      final dynamic result;
      if (linkExisting) {
        await widget.gateway.post('/vehicles/link', {
          'identifier': fields['identifier']!.text.trim(),
          'relationType': relation
        });
        if (mounted) Navigator.pop(context, true);
        return;
      } else if (widget.vehicle != null) {
        result = await widget.gateway
            .put('/vehicles/${widget.vehicle!['id']}', body);
        createdId = widget.vehicle!['id'];
      } else if (createdId == null) {
        result = await widget.gateway.post('/vehicles', body);
        createdId = result['id'];
        if (result['existing'] == true) photo = null;
      }
      if (photo != null) {
        await widget.gateway.post('/vehicles/$createdId/files',
            {'kind': 'PHOTO', 'mimeType': mime, 'data': base64Encode(photo!)});
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Padding(
      padding: EdgeInsets.fromLTRB(
          20, 12, 20, MediaQuery.viewInsetsOf(context).bottom + 20),
      child: SingleChildScrollView(
          child: Form(
              key: form,
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                Row(children: [
                  Expanded(
                      child: Text(
                          widget.vehicle == null
                              ? 'Agregar mototaxi'
                              : 'Editar mototaxi',
                          style: Theme.of(context).textTheme.titleLarge,
                          textAlign: TextAlign.center)),
                  IconButton(
                      onPressed: busy ? null : () => Navigator.pop(context),
                      icon: const Icon(Icons.close))
                ]),
                Text(
                    'La unidad y tu autorización serán revisadas antes de permitir viajes.',
                    style: Theme.of(context).textTheme.bodySmall,
                    textAlign: TextAlign.center),
                const SizedBox(height: 14),
                if (widget.vehicle == null && widget.owner)
                  const Text(
                      'Propietario / responsable · Requiere validación. No habilita la conducción.'),
                if (widget.vehicle == null)
                  Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Row(children: [
                        for (final option in [false, true]) ...[
                          if (option) const SizedBox(width: 8),
                          Expanded(
                              child: OutlinedButton(
                            style: OutlinedButton.styleFrom(
                                backgroundColor: linkExisting == option
                                    ? Theme.of(context)
                                        .colorScheme
                                        .primaryContainer
                                    : null,
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 8, vertical: 12)),
                            onPressed: busy || createdId != null
                                ? null
                                : () => setState(() {
                                      linkExisting = option;
                                      error = null;
                                    }),
                            child: Text(
                                option ? 'Vincular existente' : 'Nueva unidad',
                                textAlign: TextAlign.center,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis),
                          )),
                        ]
                      ])),
                field('identifier', 'Placa o registro', Icons.badge_outlined),
                if (!linkExisting) ...[
                  Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Expanded(child: field('brand', 'Marca', null)),
                    const SizedBox(width: 10),
                    Expanded(child: field('model', 'Modelo', null))
                  ]),
                  Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Expanded(
                        child: field('color', 'Color', Icons.palette_outlined)),
                    const SizedBox(width: 10),
                    Expanded(
                        child: field('unitNumber', 'Unidad', Icons.numbers))
                  ]),
                  field('declaredOwnerName', 'Propietario declarado',
                      Icons.person_outline),
                ],
                if (widget.vehicle == null && !widget.owner)
                  DropdownButtonFormField<String>(
                      initialValue: relation,
                      isExpanded: true,
                      decoration: const InputDecoration(
                          labelText: 'Mi relación con la unidad'),
                      items: ['AUTHORIZED_DRIVER', 'OWNER_MANAGER']
                          .map((r) => DropdownMenuItem(
                              value: r,
                              child: Text(fleetLabel(r),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis)))
                          .toList(),
                      onChanged:
                          busy ? null : (v) => setState(() => relation = v!)),
                const SizedBox(height: 10),
                if (!linkExisting)
                  OutlinedButton.icon(
                      onPressed: busy ? null : pick,
                      icon: const Icon(Icons.add_a_photo_outlined),
                      label: Text(photo == null
                          ? 'Subir foto real · JPG/PNG · Máx. 5 MB'
                          : 'Fotografía seleccionada')),
                if (photo != null)
                  Image.memory(photo!, height: 100, fit: BoxFit.contain),
                if (error != null)
                  Padding(
                      padding: const EdgeInsets.all(10),
                      child: Text(error!,
                          style: TextStyle(
                              color: Theme.of(context).colorScheme.error))),
                const SizedBox(height: 12),
                Row(children: [
                  Expanded(
                      child: OutlinedButton(
                          onPressed: busy ? null : () => Navigator.pop(context),
                          child: const Text('Cancelar'))),
                  const SizedBox(width: 12),
                  Expanded(
                      child: FilledButton(
                          onPressed: busy ? null : save,
                          child: Text(busy ? 'Guardando…' : 'Guardar')))
                ]),
              ]))));
  Widget field(String key, String title, IconData? icon) => Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: TextFormField(
          controller: fields[key],
          enabled: !busy && createdId == null,
          style: Theme.of(context).textTheme.bodyMedium,
          decoration: InputDecoration(
              isDense: true,
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 13),
              labelText: title,
              prefixIcon: icon == null
                  ? const Padding(
                      padding: EdgeInsets.all(12),
                      child: MototaxiIcon(size: 20))
                  : Icon(icon, size: 20)),
          validator: (v) => key != 'unitNumber' && (v?.trim().isEmpty ?? true)
              ? 'Completa este campo'
              : null));
}

class VehicleDetail extends StatefulWidget {
  const VehicleDetail({super.key, required this.gateway, required this.id});
  final FleetGateway gateway;
  final String id;
  @override
  State<VehicleDetail> createState() => _VehicleDetailState();
}

class _VehicleDetailState extends State<VehicleDetail> {
  dynamic data;
  String? error, notice;
  bool busy = false;
  int page = 0;
  String tab = 'sessions';
  @override
  void initState() {
    super.initState();
    unawaited(load());
  }

  Future<void> load() async {
    setState(() => busy = true);
    try {
      final d = await widget.gateway.get('/vehicles/${widget.id}?page=$page');
      if (mounted) setState(() => data = d);
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final v = data?['vehicle'];
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
        appBar: AppBar(title: Text(v?['identifier'] ?? 'Detalle de mototaxi')),
        body: SafeArea(
            child: ListView(padding: const EdgeInsets.all(16), children: [
          if (busy) const LinearProgressIndicator(),
          if (error != null)
            Text(error!, style: TextStyle(color: scheme.error)),
          if (v != null) ...[
            TripVehicleBadge(
                gateway: widget.gateway, vehicle: v, showSafety: false),
            const SizedBox(height: 12),
            Text('Estado: ${fleetLabel(v['status'])}'),
            if (notice != null)
              Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child:
                      Text(notice!, style: TextStyle(color: scheme.primary))),
            if (data['canUpload'] == true && data['canManage'] != true)
              Card(
                  child: Column(children: [
                const ListTile(
                    leading: Icon(Icons.info_outline),
                    title: Text('Completa tu registro'),
                    subtitle: Text(
                        'Puedes adjuntar la fotografía y los documentos de esta unidad mientras se revisa tu solicitud.')),
                for (final kind in [
                  'PHOTO',
                  'REGISTRATION',
                  'OPERATING_PERMIT'
                ])
                  ListTile(
                      leading: const Icon(Icons.upload_file_outlined),
                      title: Text('Subir ${fleetLabel(kind).toLowerCase()}'),
                      onTap: busy ? null : () => upload(kind))
              ])),
            if (data['current'] != null)
              Card(
                  child: ListTile(
                      leading: const Icon(Icons.person_outline),
                      title: Text(data['current']['driverName']),
                      subtitle: Text(
                          'Inicio: ${fleetDate(data['current']['startedAt'])}\nÚltima conexión: ${fleetDate(data['current']['lastHeartbeat'])}\n${data['current']['available'] == true ? 'Disponible para viajes' : 'No disponible'}'))),
            if (data['canManage'] != true)
              OutlinedButton.icon(
                  onPressed: busy ? null : claim,
                  icon: const Icon(Icons.fact_check_outlined),
                  label: const Text('Reclamar propiedad / responsabilidad')),
            if (data['canManage'] == true) ...[
              Text(
                  'Propietario declarado: ${v['declaredOwnerName'] ?? 'Sin registrar'}'),
              OutlinedButton.icon(
                  icon: const Icon(Icons.edit_outlined),
                  label: const Text('Editar información'),
                  onPressed: busy
                      ? null
                      : () async {
                          final saved = await showModalBottomSheet<bool>(
                              context: context,
                              isScrollControlled: true,
                              useSafeArea: true,
                              builder: (_) => _VehicleForm(
                                  gateway: widget.gateway,
                                  vehicle: Map<String, dynamic>.from(v)));
                          if (saved == true && mounted) await load();
                        }),
              OutlinedButton.icon(
                  onPressed: busy ? null : invite,
                  icon: const Icon(Icons.person_add_alt),
                  label: const Text('Autorizar conductor')),
              for (final r in data['relations'])
                Card(
                    child: ListTile(
                        title: Text(r['name']),
                        subtitle: Text(
                            '${fleetLabel(r['type'])} · ${fleetLabel(r['status'])}'),
                        trailing: r['type'] == 'AUTHORIZED_DRIVER'
                            ? PopupMenuButton<String>(
                                onSelected: (status) =>
                                    unawaited(relation(r, status)),
                                itemBuilder: (_) => [
                                      'APPROVED',
                                      'REJECTED',
                                      'REVOKED'
                                    ]
                                        .where((s) => s != r['status'])
                                        .map((s) => PopupMenuItem(
                                            value: s,
                                            child: Text(fleetLabel(s))))
                                        .toList())
                            : null)),
              ExpansionTile(
                  title: const Text('Documentos de la unidad'),
                  children: [
                    for (final kind in ['REGISTRATION', 'OPERATING_PERMIT'])
                      ListTile(
                          leading: const Icon(Icons.upload_file_outlined),
                          title: Text(kind == 'REGISTRATION'
                              ? 'Subir matrícula'
                              : 'Subir anexos (opcional)'),
                          subtitle: const Text('Imagen o PDF · Máximo 5 MB'),
                          onTap: busy ? null : () => upload(kind)),
                    for (final f in data['files'])
                      ListTile(
                          leading: const Icon(Icons.description_outlined),
                          title: Text(fleetLabel(f['kind'])),
                          subtitle: Text(fleetDate(f['createdAt'])))
                  ]),
            ],
            const SizedBox(height: 12),
            SegmentedButton<String>(segments: const [
              ButtonSegment(value: 'sessions', label: Text('Jornadas')),
              ButtonSegment(value: 'trips', label: Text('Viajes'))
            ], selected: {
              tab
            }, onSelectionChanged: (v) => setState(() => tab = v.first)),
            if ((data[tab] as List).isEmpty)
              const Padding(
                  padding: EdgeInsets.all(24),
                  child: Text('Todavía no hay actividad registrada.',
                      textAlign: TextAlign.center)),
            for (final r in data[tab])
              Card(
                  child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(r['driverName'] ?? '',
                                style: Theme.of(context).textTheme.titleSmall),
                            Text(
                                '${fleetDate(r['startedAt'] ?? r['acceptedAt'])} → ${fleetDate(r['endedAt'])}'),
                            Text(fleetLabel(r['status'] ?? r['outcome'])),
                            if (tab == 'sessions') ...[
                              Text(
                                  '${r['accepted']} aceptados · ${r['completed']} finalizados'),
                              Text(
                                  '${r['driverCancelled']} cancelados por conductor · ${r['passengerCancelled']} por pasajero'),
                              Text(
                                  'Duración: ${((r['durationSeconds'] as num) / 60).round()} min · ${fleetLabel(r['endReason'])}'),
                            ],
                            Text(
                                '${((num.tryParse(r['distanceMeters'].toString()) ?? 0) / 1000).toStringAsFixed(2)} km · \$${((num.tryParse(r['totalCents'].toString()) ?? 0) / 100).toStringAsFixed(2)}')
                          ]))),
            Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              TextButton(
                  onPressed: page > 0 && !busy
                      ? () {
                          page--;
                          unawaited(load());
                        }
                      : null,
                  child: const Text('Anterior')),
              Text('${page + 1}'),
              TextButton(
                  onPressed: (data[tab] as List).length == 30 && !busy
                      ? () {
                          page++;
                          unawaited(load());
                        }
                      : null,
                  child: const Text('Siguiente'))
            ]),
          ]
        ])));
  }

  Future<void> relation(dynamic r, String status) async {
    if (!await fleetConfirm(context,
            title: '${fleetLabel(status)} conductor',
            text:
                'Esta acción afecta la autorización de ${r['name']} para utilizar la unidad. Quedará registrada en la auditoría.') ||
        !mounted) {
      return;
    }
    setState(() => busy = true);
    try {
      await widget.gateway.put('/vehicles/${widget.id}/relations', {
        'userId': r['userId'],
        'type': 'AUTHORIZED_DRIVER',
        'status': status,
        'reason': '${fleetLabel(status)} por el responsable de la unidad'
      });
      await load();
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<String?> ask(String title, String hint, {bool email = false}) async {
    final controller = TextEditingController();
    final result = await showDialog<String>(
        context: context,
        builder: (c) => AlertDialog(
                title: Text(title),
                content: TextField(
                    controller: controller,
                    autofocus: true,
                    keyboardType:
                        email ? TextInputType.emailAddress : TextInputType.text,
                    decoration: InputDecoration(hintText: hint)),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(c),
                      child: const Text('Cancelar')),
                  FilledButton(
                      onPressed: () => Navigator.pop(c, controller.text.trim()),
                      child: const Text('Continuar'))
                ]));
    await Future<void>.delayed(const Duration(milliseconds: 250));
    controller.dispose();
    return result;
  }

  Future<void> invite() async {
    final email = await ask(
        'Autorizar conductor', 'Correo de su cuenta Costa-Go',
        email: true);
    if (email == null || email.isEmpty || !mounted) return;
    if (!await fleetConfirm(context,
            title: 'Confirmar autorización',
            text:
                '$email podrá utilizar esta mototaxi si su cuenta de conductor está aprobada.',
            action: 'Autorizar') ||
        !mounted) {
      return;
    }
    setState(() => busy = true);
    try {
      await widget.gateway.post('/vehicles/${widget.id}/drivers',
          {'email': email, 'reason': 'Autorización del responsable operativo'});
      await load();
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<dynamic> pickDocument(String kind) async {
    final source = await showModalBottomSheet<String>(
        context: context,
        useSafeArea: true,
        builder: (c) => Column(mainAxisSize: MainAxisSize.min, children: [
              ListTile(
                  leading: const Icon(Icons.photo_library_outlined),
                  title: const Text('Seleccionar imagen'),
                  onTap: () => Navigator.pop(c, 'IMAGE')),
              if (kind != 'PHOTO')
                ListTile(
                    leading: const Icon(Icons.description_outlined),
                    title: const Text('Seleccionar PDF'),
                    onTap: () => Navigator.pop(c, 'PDF'))
            ]));
    if (source == null) return null;
    Uint8List bytes;
    String mime;
    if (source == 'IMAGE') {
      final f = await ImagePicker().pickImage(source: ImageSource.gallery);
      if (f == null) return null;
      bytes = await f.readAsBytes();
      mime = f.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    } else {
      final f = await const MethodChannel('ec.atacames.mototaxi/native')
          .invokeMapMethod<String, dynamic>('pickDocument', {
        'extensions': ['pdf']
      });
      if (f == null) return null;
      final raw = f['bytes'];
      if (raw is! Uint8List) throw Exception('No se pudo leer el documento.');
      bytes = raw;
      mime = 'application/pdf';
    }
    if (bytes.length > 5 * 1024 * 1024) {
      throw Exception('Selecciona un archivo de máximo 5 MB.');
    }
    return widget.gateway.post('/vehicles/${widget.id}/files',
        {'kind': kind, 'mimeType': mime, 'data': base64Encode(bytes)});
  }

  Future<void> upload(String kind) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      await pickDocument(kind);
      if (mounted) await load();
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> claim() async {
    final reason = await ask('Reclamar responsabilidad',
        'Describe tu relación con la unidad (mínimo 10 caracteres)');
    if (reason == null || !mounted) return;
    if (reason.length < 10) {
      setState(() => error = 'Explica tu relación con al menos 10 caracteres.');
      return;
    }
    setState(() => busy = true);
    try {
      final evidence = await pickDocument('OWNERSHIP_EVIDENCE');
      if (evidence == null) return;
      await widget.gateway.post('/vehicles/${widget.id}/ownership-claims',
          {'evidenceId': evidence['id'], 'reason': reason});
      if (mounted) {
        setState(() {
          error = null;
          notice = 'Solicitud registrada. Costa-Go revisará la evidencia.';
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }
}
