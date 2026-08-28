import 'dart:async';
import 'package:flutter/material.dart';
import 'fleet.dart';

class FleetReportScreen extends StatefulWidget {
  const FleetReportScreen({super.key, required this.gateway});
  final FleetGateway gateway;
  @override
  State<FleetReportScreen> createState() => _FleetReportState();
}

class _FleetReportState extends State<FleetReportScreen> {
  dynamic data;
  List<dynamic> vehicles = [], drivers = [];
  String vehicle = '', driver = '', state = '', reason = '';
  String? error;
  int page = 0, revision = 0, optionRevision = 0;
  bool busy = false;
  DateTimeRange range = DateTimeRange(
      start: DateTime.now().copyWith(
          hour: 0, minute: 0, second: 0, millisecond: 0, microsecond: 0),
      end: DateTime.now());
  @override
  void initState() {
    super.initState();
    unawaited(loadUnits());
    unawaited(load());
  }

  Future<void> loadUnits([String search = '']) async {
    final request = ++optionRevision;
    try {
      final r = await widget.gateway
          .get('/report/options?search=${Uri.encodeQueryComponent(search)}');
      if (mounted && request == optionRevision) {
        setState(() {
          vehicles = r['vehicles'];
          drivers = r['drivers'];
          vehicle = '';
          driver = '';
          page = 0;
        });
        await load();
      }
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    }
  }

  Future<void> load() async {
    final request = ++revision;
    setState(() => busy = true);
    try {
      final q = {
        'from': range.start.toUtc().toIso8601String(),
        'to':
            range.end.add(const Duration(seconds: 1)).toUtc().toIso8601String(),
        'page': '$page',
        if (vehicle.isNotEmpty) 'vehicleId': vehicle,
        if (driver.isNotEmpty) 'driverId': driver,
        if (state.isNotEmpty) 'state': state,
        if (reason.isNotEmpty) 'endReason': reason
      };
      final r =
          await widget.gateway.get('/report?${Uri(queryParameters: q).query}');
      if (mounted && request == revision) {
        setState(() {
          data = r;
          error = null;
        });
      }
    } catch (e) {
      if (mounted && request == revision) setState(() => error = e.toString());
    } finally {
      if (mounted && request == revision) setState(() => busy = false);
    }
  }

  Future<void> notifications() async {
    try {
      final p = await widget.gateway.get('/notification-preferences');
      if (!mounted) return;
      final selected = Set<String>.from(p['events']);
      final saved = await showDialog<bool>(
          context: context,
          builder: (c) => StatefulBuilder(
              builder: (c, set) => AlertDialog(
                      title: const Text('Avisos de mi flota'),
                      content:
                          Column(mainAxisSize: MainAxisSize.min, children: [
                        for (final entry in {
                          'session_started': 'Inicio de jornada',
                          'session_ended': 'Fin de jornada',
                          'session_auto_released': 'Cierre por inactividad',
                          'vehicle_takeover': 'Cambio de conductor'
                        }.entries)
                          CheckboxListTile(
                              contentPadding: EdgeInsets.zero,
                              title: Text(entry.value),
                              value: selected.contains(entry.key),
                              onChanged: (v) => set(() {
                                    if (v == true) {
                                      selected.add(entry.key);
                                    } else {
                                      selected.remove(entry.key);
                                    }
                                  }))
                      ]),
                      actions: [
                        TextButton(
                            onPressed: () => Navigator.pop(c, false),
                            child: const Text('Cancelar')),
                        FilledButton(
                            onPressed: () => Navigator.pop(c, true),
                            child: const Text('Guardar'))
                      ])));
      if (saved == true) {
        await widget.gateway
            .put('/notification-preferences', {'events': selected.toList()});
      }
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final summary = data?['summary'];
    return Scaffold(
        appBar: AppBar(title: const Text('Resumen de flota'), actions: [
          IconButton(
              onPressed: notifications,
              tooltip: 'Avisos',
              icon: const Icon(Icons.notifications_outlined))
        ]),
        body: SafeArea(
            child: ListView(padding: const EdgeInsets.all(16), children: [
          OutlinedButton.icon(
              icon: const Icon(Icons.date_range),
              label: Text(
                  '${fleetDate(range.start.toIso8601String()).split(' · ').first} — ${fleetDate(range.end.toIso8601String()).split(' · ').first}'),
              onPressed: () async {
                final r = await showDateRangePicker(
                    context: context,
                    firstDate: DateTime(2020),
                    lastDate: DateTime.now(),
                    initialDateRange: range);
                if (r != null && mounted) {
                  range = DateTimeRange(
                      start: r.start,
                      end: r.end.add(
                          const Duration(hours: 23, minutes: 59, seconds: 59)));
                  page = 0;
                  await load();
                }
              }),
          const SizedBox(height: 12),
          TextField(
            maxLength: 80,
            decoration: const InputDecoration(
                labelText: 'Buscar conductor o mototaxi',
                hintText: 'Nombre o placa',
                counterText: '',
                prefixIcon: Icon(Icons.search)),
            textInputAction: TextInputAction.search,
            onSubmitted: (value) => unawaited(loadUnits(value.trim())),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
              key: ValueKey('vehicle-$optionRevision'),
              initialValue: vehicle,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Mototaxi'),
              items: [
                const DropdownMenuItem(
                    value: '', child: Text('Todas mis unidades')),
                for (final v in vehicles)
                  DropdownMenuItem(value: v['id'], child: Text(v['identifier']))
              ],
              onChanged: (v) {
                vehicle = v ?? '';
                page = 0;
                unawaited(load());
              }),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
              key: ValueKey('driver-$optionRevision'),
              initialValue: driver,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Conductor'),
              items: [
                const DropdownMenuItem(
                    value: '', child: Text('Todos mis conductores')),
                for (final d in drivers)
                  DropdownMenuItem(value: d['id'], child: Text(d['name']))
              ],
              onChanged: (v) {
                driver = v ?? '';
                page = 0;
                unawaited(load());
              }),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
              initialValue: state,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Jornada'),
              items: [
                const DropdownMenuItem(
                    value: '', child: Text('Todos los estados')),
                for (final v in ['ACTIVE', 'ENDED'])
                  DropdownMenuItem(value: v, child: Text(fleetLabel(v)))
              ],
              onChanged: (v) {
                state = v ?? '';
                page = 0;
                unawaited(load());
              }),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
              initialValue: reason,
              isExpanded: true,
              decoration:
                  const InputDecoration(labelText: 'Motivo de finalización'),
              items: [
                const DropdownMenuItem(
                    value: '', child: Text('Todos los motivos')),
                for (final v in [
                  'MANUAL_RELEASE',
                  'LOGOUT',
                  'AUTO_RELEASE',
                  'TAKEOVER',
                  'VEHICLE_CHANGE',
                  'ADMIN_RELEASE'
                ])
                  DropdownMenuItem(value: v, child: Text(fleetLabel(v)))
              ],
              onChanged: (v) {
                reason = v ?? '';
                page = 0;
                unawaited(load());
              }),
          if (busy) const LinearProgressIndicator(),
          if (error != null)
            Text(error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error)),
          if (summary != null) ...[
            const SizedBox(height: 16),
            for (final entry in {
              'activeUnits': 'Unidades con actividad',
              'activeDrivers': 'Conductores activos',
              'completed': 'Viajes finalizados',
              'cancelled': 'Cancelaciones',
              'inactiveUnits': 'Unidades sin actividad',
              'incidents': 'Incidencias'
            }.entries)
              Card(
                  child: ListTile(
                      title: Text(entry.value),
                      trailing: Text('${summary[entry.key]}',
                          style: Theme.of(context).textTheme.titleMedium))),
            Card(
                child: ListTile(
                    title: const Text('Horas de operación'),
                    trailing: Text(
                        ((num.tryParse('${summary['operationSeconds']}') ?? 0) /
                                3600)
                            .toStringAsFixed(1)))),
            const Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: Text('Jornadas del período')),
            if ((data['items'] as List).isEmpty)
              const Text('No hay actividad en este período.'),
            for (final r in data['items'])
              Card(
                  child: ListTile(
                      title: Text('${r['identifier']} · ${r['driverName']}'),
                      subtitle: Text(
                          '${fleetDate(r['startedAt'])}\n${fleetLabel(r['status'])} · ${fleetLabel(r['endReason'])}\n${r['accepted']} viajes aceptados'),
                      onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                              builder: (_) => VehicleDetail(
                                  gateway: widget.gateway,
                                  id: r['vehicleId']))))),
            Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
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
                  onPressed: (data['items'] as List).length == 30 && !busy
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
}
