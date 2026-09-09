import 'package:flutter/material.dart';

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
      setState(
          () => error = 'Ingresa un importe válido con hasta dos decimales.');
      return;
    }
    final configuration =
        Map<String, dynamic>.from(data?['configuration'] as Map? ?? {});
    final numericValue = double.parse(value);
    final minimum = double.tryParse('${configuration['minimumTopUp']}');
    final maximum = double.tryParse('${configuration['maximumTopUp']}');
    if (minimum != null && numericValue < minimum) {
      setState(() => error =
          'El valor mínimo de recarga es \$${minimum.toStringAsFixed(2)}.');
      return;
    }
    if (maximum != null && numericValue > maximum) {
      setState(() => error =
          'El valor máximo de recarga es \$${maximum.toStringAsFixed(2)}.');
      return;
    }
    setState(() {
      busy = true;
      error = null;
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

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final wallet = Map<String, dynamic>.from(data?['wallet'] as Map? ?? {});
    final configuration =
        Map<String, dynamic>.from(data?['configuration'] as Map? ?? {});
    final movements = List<dynamic>.from(data?['movements'] ?? []);
    final available = double.tryParse('${wallet['available']}');
    final threshold =
        double.tryParse('${configuration['lowBalanceThreshold']}');
    const kinds = {
      'TOPUP': 'Recarga',
      'RESERVE': 'Reserva de comisión',
      'RELEASE': 'Reserva liberada',
      'TRIP_COMMISSION': 'Comisión de viaje',
      'REVERSAL': 'Reverso',
      'ADMIN_ADJUSTMENT': 'Ajuste administrativo'
    };
    return SafeArea(
        child: FractionallySizedBox(
            heightFactor: .85,
            child: SingleChildScrollView(
                padding: const EdgeInsets.all(20),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text('Saldo Costa-Go',
                          style: Theme.of(context).textTheme.headlineSmall),
                      const SizedBox(height: 12),
                      if (data == null && error == null)
                        const Center(child: CircularProgressIndicator()),
                      if (data != null) ...[
                        Text('\$${wallet['available'] ?? '0.00'} disponibles',
                            style: Theme.of(context).textTheme.headlineMedium),
                        Text(
                            'Total: \$${wallet['total'] ?? '0.00'} · Reservado: \$${wallet['reserved'] ?? '0.00'}'),
                        const SizedBox(height: 12),
                        const Text(
                            'Tu saldo se conserva al comprar un plan o paquete. No se cobra saldo y viajes del paquete a la vez.'),
                        if (configuration.isNotEmpty) ...[
                          SwitchListTile(
                              contentPadding: EdgeInsets.zero,
                              title: const Text('Pago por uso'),
                              subtitle: const Text(
                                  'Usar saldo cuando no haya un plan o paquete vigente que cubra el viaje.'),
                              value: wallet['enabled'] == true,
                              onChanged: busy
                                  ? null
                                  : (value) async {
                                      setState(() => busy = true);
                                      try {
                                        await widget.setEnabled(value);
                                        await refresh();
                                      } catch (e) {
                                        if (mounted) {
                                          setState(() => error = e.toString());
                                        }
                                      } finally {
                                        if (mounted) {
                                          setState(() => busy = false);
                                        }
                                      }
                                    }),
                          if (available != null &&
                              threshold != null &&
                              available <= threshold)
                            Padding(
                                padding:
                                    const EdgeInsets.symmetric(vertical: 12),
                                child: Text(
                                    'Tu saldo Costa-Go está por agotarse.',
                                    style: TextStyle(color: colors.error))),
                          TextField(
                              controller: amount,
                              enabled: !busy,
                              keyboardType:
                                  const TextInputType.numberWithOptions(
                                      decimal: true),
                              decoration: InputDecoration(
                                  labelText: 'Valor de recarga',
                                  prefixText: '\$ ',
                                  helperText:
                                      'Puedes recargar desde \$${configuration['minimumTopUp']} hasta \$${configuration['maximumTopUp']}')),
                          const SizedBox(height: 8),
                          const Text(
                              'El IVA y el total se muestran en la orden. Solo el valor de recarga se acredita como saldo.'),
                          const SizedBox(height: 12),
                          FilledButton(
                              onPressed: busy ? null : recharge,
                              child: const Text('Recargar saldo')),
                        ] else
                          const Padding(
                              padding: EdgeInsets.symmetric(vertical: 16),
                              child: Text(
                                  'Las recargas todavía no están habilitadas.')),
                        const SizedBox(height: 20),
                        Text('Movimientos',
                            style: Theme.of(context).textTheme.titleMedium),
                        for (final movement in movements)
                          ListTile(
                              contentPadding: EdgeInsets.zero,
                              title: Text(kinds[movement['kind']] ??
                                  'Movimiento de saldo'),
                              subtitle: Text('${movement['reason']}'),
                              trailing: Text('\$${movement['amount']}')),
                      ],
                      if (error != null)
                        Text(error!, style: TextStyle(color: colors.error)),
                    ]))));
  }
}
