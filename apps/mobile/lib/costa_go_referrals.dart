import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

class ReferralLinks {
  static final code = ValueNotifier<String>('');
  static String program = '';
  static Future<void> initialize() async {
    final p = await SharedPreferences.getInstance();
    code.value = p.getString('referral.code') ?? '';
    program = p.getString('referral.program') ?? '';
  }

  static Future<bool> receive(Uri uri) async {
    final allowed = uri.scheme == 'costa-go' && uri.host == 'referral' ||
        uri.scheme == 'https' &&
            uri.host == 'costa-go.com' &&
            uri.pathSegments.isNotEmpty &&
            uri.pathSegments.first == 'r';
    if (!allowed || uri.pathSegments.isEmpty) return false;
    final candidate = uri.pathSegments.last.toUpperCase();
    if (!RegExp(r'^CG-[A-F0-9]{16}$').hasMatch(candidate)) return false;
    final p = await SharedPreferences.getInstance();
    program = uri.queryParameters['p'] ?? '';
    code.value = candidate;
    await p.setString('referral.code', candidate);
    await p.setString('referral.program', program);
    return true;
  }

  static Future<void> clear() async {
    code.value = '';
    program = '';
    final p = await SharedPreferences.getInstance();
    await p.remove('referral.code');
    await p.remove('referral.program');
  }
}

class ReferralGateway {
  const ReferralGateway(
      {required this.sessionKey,
      required this.load,
      required this.attribute,
      required this.share});
  final String sessionKey;
  final Future<Map<String, dynamic>> Function() load;
  final Future<Map<String, dynamic>> Function(
      String code, String programId, String source) attribute;
  final Future<void> Function(BuildContext context, String text) share;
}

class CostaGoReferralCard extends StatefulWidget {
  const CostaGoReferralCard({super.key, required this.gateway});
  final ReferralGateway gateway;
  @override
  State<CostaGoReferralCard> createState() => _ReferralCardState();
}

class _ReferralCardState extends State<CostaGoReferralCard>
    with WidgetsBindingObserver {
  Map<String, dynamic>? data;
  Timer? timer;
  bool loading = false;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    ReferralLinks.code.addListener(refresh);
    refresh();
    timer = Timer.periodic(const Duration(minutes: 1), (_) => refresh());
  }

  @override
  void didUpdateWidget(CostaGoReferralCard old) {
    super.didUpdateWidget(old);
    if (old.gateway.sessionKey != widget.gateway.sessionKey) {
      data = null;
      refresh();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) refresh();
  }

  Future<void> refresh() async {
    if (loading) return;
    loading = true;
    final sessionKey = widget.gateway.sessionKey;
    try {
      final result = await widget.gateway.load();
      if (mounted && sessionKey == widget.gateway.sessionKey) {
        setState(() => data = result);
      }
    } catch (_) {
      if (mounted && sessionKey == widget.gateway.sessionKey) {
        setState(() => data = null);
      }
    } finally {
      loading = false;
      if (mounted && sessionKey != widget.gateway.sessionKey) refresh();
    }
  }

  @override
  void dispose() {
    timer?.cancel();
    ReferralLinks.code.removeListener(refresh);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final programs = (data?['programs'] as List?) ?? [];
    if (programs.isEmpty) return const SizedBox.shrink();
    final invite = programs.any((p) => p['canInvite'] == true);
    if (!invite && data?['canAttribute'] != true) {
      return const SizedBox.shrink();
    }
    return Card(
        child: ListTile(
            leading: const Icon(Icons.redeem_outlined),
            title: Text(invite ? 'Invita y gana' : '¿Te invitaron a Costa-Go?'),
            subtitle: Text(programs.first['description']?.toString() ?? ''),
            trailing: const Icon(Icons.chevron_right),
            onTap: () async {
              await Navigator.of(context).push(MaterialPageRoute<void>(
                  builder: (_) =>
                      CostaGoReferralsScreen(gateway: widget.gateway)));
              refresh();
            }));
  }
}

class CostaGoReferralsScreen extends StatefulWidget {
  const CostaGoReferralsScreen({super.key, required this.gateway});
  final ReferralGateway gateway;
  @override
  State<CostaGoReferralsScreen> createState() => _ReferralsState();
}

class _ReferralsState extends State<CostaGoReferralsScreen> {
  Map<String, dynamic>? data;
  String? selected;
  String? error;
  bool busy = false;
  final input = TextEditingController(text: ReferralLinks.code.value);
  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  void dispose() {
    input.dispose();
    super.dispose();
  }

  Future<void> load() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final result = await widget.gateway.load();
      if (mounted) {
        setState(() {
          data = result;
          final items = (result['programs'] as List?) ?? [];
          if (!items.any((p) => p['id'] == selected)) {
            selected = null;
            for (final p in items) {
              if (p['programCode'] == ReferralLinks.program) {
                selected = p['id'].toString();
              }
            }
            selected ??= items.isEmpty ? null : items.first['id'].toString();
          }
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> attribute() async {
    if (busy || selected == null) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await widget.gateway.attribute(
          input.text.trim().toUpperCase(),
          selected!,
          input.text.trim().toUpperCase() == ReferralLinks.code.value
              ? 'LINK'
              : 'MANUAL');
      await ReferralLinks.clear();
      await load();
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final programs = (data?['programs'] as List?) ?? [];
    Map? program;
    for (final p in programs) {
      if (p['id'] == selected) program = p as Map;
    }
    final metrics = program?['metrics'] as Map?;
    final benefits = (program?['benefits'] as List?) ?? [];
    final rewardCards = [
      for (final recipient in ['referrerBenefitCode', 'referredBenefitCode'])
        for (final benefit in benefits)
          if (benefit['code'] == program?[recipient])
            {
              ...benefit as Map,
              'recipientTitle': recipient == 'referrerBenefitCode'
                  ? 'Tu recompensa'
                  : 'Recompensa del invitado'
            },
    ];
    return Scaffold(
        appBar: AppBar(title: const Text('Invita y gana'), actions: [
          IconButton(
              onPressed: busy ? null : load,
              icon: const Icon(Icons.refresh),
              tooltip: 'Actualizar')
        ]),
        body: ListView(padding: const EdgeInsets.all(20), children: [
          if (busy) const LinearProgressIndicator(),
          if (error != null)
            Text(error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error)),
          if (programs.isEmpty && !busy)
            const Text(
                'No hay programas disponibles para tu cuenta y ubicación en este momento.'),
          if (programs.length > 1)
            DropdownButtonFormField<String>(
                initialValue: selected,
                items: programs
                    .map((p) => DropdownMenuItem(
                        value: p['id'].toString(),
                        child: Text(p['name'].toString())))
                    .toList(),
                onChanged: busy ? null : (v) => setState(() => selected = v),
                decoration: const InputDecoration(labelText: 'Programa')),
          if (program != null) ...[
            Text(program['name'].toString(),
                style: Theme.of(context).textTheme.headlineSmall),
            Text(program['description'].toString()),
            const SizedBox(height: 16),
            Text('Condición: tu invitado debe ${program['condition']}.',
                style: Theme.of(context).textTheme.titleMedium),
            for (final reward in rewardCards)
              Card(
                  child: ListTile(
                      leading: const Icon(Icons.card_giftcard),
                      title: Text(reward['recipientTitle'].toString()),
                      subtitle: Text(
                          '${reward['name']}\n${reward['description']}\n${reward['value']} ${reward['type'] == 'COURTESY_DAYS' ? 'días de cortesía' : 'USD promocionales acumulables'}'))),
            if (benefits.any((b) => b['type'] == 'PROMOTIONAL_BALANCE'))
              const Text(
                  'El saldo promocional se acumula por separado. Todavía no puede usarse para pagar viajes ni retirarse.'),
            if (program['canInvite'] == true) ...[
              const SizedBox(height: 16),
              const Text('Tu código'),
              SelectableText(program['code'].toString(),
                  style: Theme.of(context).textTheme.headlineSmall),
              SelectableText(program['url'].toString()),
              Wrap(spacing: 12, children: [
                TextButton.icon(
                    onPressed: () async {
                      await Clipboard.setData(
                          ClipboardData(text: program!['code'].toString()));
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Código copiado')));
                      }
                    },
                    icon: const Icon(Icons.copy),
                    label: const Text('Copiar código')),
                FilledButton.icon(
                    onPressed: () => widget.gateway
                        .share(context, program!['message'].toString()),
                    icon: const Icon(Icons.share),
                    label: const Text('Compartir invitación'))
              ]),
              const SizedBox(height: 16),
              Text(
                  'Invitados registrados: ${metrics?['registered'] ?? 0}\nPendientes: ${metrics?['pending'] ?? 0}\nCumplieron la condición: ${metrics?['qualified'] ?? 0}\nRecompensas obtenidas: ${metrics?['rewarded'] ?? 0}'),
            ],
            if (data?['canAttribute'] == true) ...[
              const Divider(height: 32),
              Text('¿Recibiste una invitación?',
                  style: Theme.of(context).textTheme.titleMedium),
              const Text(
                  'Puedes ingresar un único código durante tus primeros 7 días, antes de iniciar un viaje o recibir beneficios. La relación no se puede cambiar.'),
              TextField(
                  controller: input,
                  textCapitalization: TextCapitalization.characters,
                  decoration: const InputDecoration(
                      labelText: 'Código de quien te invitó',
                      hintText: 'CG-…')),
              FilledButton(
                  onPressed: busy ? null : attribute,
                  child: const Text('Registrar invitación')),
            ],
          ],
          if (data?['attribution'] != null)
            Padding(
                padding: const EdgeInsets.only(top: 16),
                child: Text(
                    'Invitación registrada en ${data!['attribution']['name']}. ${data!['attribution']['status'] == 'REWARDED' ? 'Recompensa obtenida ✓' : 'Estado: ${data!['attribution']['status'] == 'PENDING' ? 'pendiente de completar la condición' : data!['attribution']['status'] == 'QUALIFIED' ? 'condición cumplida; entrega pendiente' : 'no calificó en plazo'}'}.')),
          if (data?['attribution']?['progress'] != null) ...[
            const SizedBox(height: 12),
            Text(
                'Tu condición original: ${data!['attribution']['progress']['condition']}.'),
            Text(
                'Viajes requeridos: ${data!['attribution']['progress']['requiredTrips']}\nCompletados válidos: ${data!['attribution']['progress']['completedTrips']}\nPendientes: ${data!['attribution']['progress']['remainingTrips']}'),
            if (data!['attribution']['progress']['mustBeApproved'] == true)
              Text(data!['attribution']['progress']['isApproved'] == true
                  ? 'Aprobación cumplida'
                  : 'Aprobación pendiente'),
            if (data!['attribution']['progress']['mustBeActive'] == true)
              Text(data!['attribution']['progress']['isActive'] == true
                  ? 'Cuenta activa'
                  : 'Activación pendiente'),
          ],
          if (((data?['rewards'] as List?) ?? []).isNotEmpty) ...[
            const Divider(height: 32),
            Text('Recompensas recibidas',
                style: Theme.of(context).textTheme.titleMedium),
            for (final reward in (data!['rewards'] as List))
              ListTile(
                leading: const Icon(Icons.check_circle_outline),
                title: Text(
                    '${reward['value']} ${reward['benefitType'] == 'COURTESY_DAYS' ? 'días de cortesía' : 'USD promocionales'}'),
                subtitle: Text(
                    '${reward['status'] == 'ACTIVE' ? 'Activa' : reward['status'] == 'PENDING' ? 'Programada' : 'Finalizada'} · ${reward['benefitCode']}'),
              ),
          ],
          if (double.tryParse(data?['promotionalBalance']?.toString() ?? '0') !=
              0)
            Text(
                'Saldo promocional acumulado: USD ${data?['promotionalBalance'] ?? '0.00'}\nUso en viajes todavía no habilitado.'),
        ]));
  }
}
