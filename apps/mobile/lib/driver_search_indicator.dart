import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

class SearchProgress {
  const SearchProgress(
      {required this.round,
      required this.totalRounds,
      required this.totalSeconds,
      required this.elapsedSeconds,
      required this.cycleId,
      required this.sampleId});
  final int round, totalRounds;
  final double totalSeconds, elapsedSeconds;
  final String cycleId, sampleId;
  static SearchProgress? fromJson(dynamic value) {
    if (value is! Map) return null;
    final total = double.tryParse('${value['totalSeconds']}');
    final elapsed = double.tryParse('${value['elapsedSeconds']}');
    final round = int.tryParse('${value['round']}'),
        rounds = int.tryParse('${value['totalRounds']}');
    if (total == null ||
        !total.isFinite ||
        total <= 0 ||
        elapsed == null ||
        !elapsed.isFinite ||
        round == null ||
        rounds == null ||
        round < 1 ||
        rounds < round) {
      return null;
    }
    return SearchProgress(
        round: round,
        totalRounds: rounds,
        totalSeconds: total,
        elapsedSeconds: elapsed.clamp(0, total),
        cycleId: '${value['cycleStartedAt']}',
        sampleId: '${value['serverNow']}');
  }

  double fraction(double secondsSinceSample) =>
      (elapsedSeconds + secondsSinceSample).clamp(0, totalSeconds) /
      totalSeconds;
  int remaining(double secondsSinceSample) =>
      math.max(0, (totalSeconds - elapsedSeconds - secondsSinceSample).ceil());
  bool roundEnded(double secondsSinceSample) =>
      elapsedSeconds + secondsSinceSample >= round * totalSeconds / totalRounds;
}

/// Server rounds remain authoritative. The clock refreshes at each boundary and at 100%.
class DriverSearchIndicator extends StatefulWidget {
  const DriverSearchIndicator(
      {super.key, required this.progress, required this.onDeadline});
  final SearchProgress? progress;
  final Future<void> Function() onDeadline;
  @override
  State<DriverSearchIndicator> createState() => _DriverSearchIndicatorState();
}

class _DriverSearchIndicatorState extends State<DriverSearchIndicator>
    with SingleTickerProviderStateMixin {
  late final Ticker _ticker;
  final Stopwatch _sampleClock = Stopwatch();
  Duration _lastCheck = Duration.zero;
  bool _checking = false;
  double _fraction = 0;
  @override
  void initState() {
    super.initState();
    _sampleClock.start();
    _ticker = createTicker(_tick)..start();
  }

  @override
  void didUpdateWidget(covariant DriverSearchIndicator old) {
    super.didUpdateWidget(old);
    if (old.progress?.sampleId != widget.progress?.sampleId) {
      if (old.progress?.cycleId != widget.progress?.cycleId) _fraction = 0;
      _sampleClock
        ..reset()
        ..start();
      if (old.progress?.round != widget.progress?.round ||
          old.progress?.cycleId != widget.progress?.cycleId) {
        _lastCheck = Duration.zero;
      }
    }
  }

  void _tick(Duration elapsed) {
    final progress = widget.progress;
    if (progress == null) return;
    setState(() => _fraction = math.max(
        _fraction, progress.fraction(_sampleClock.elapsedMilliseconds / 1000)));
    if (progress.roundEnded(_sampleClock.elapsedMilliseconds / 1000) &&
        !_checking &&
        (_lastCheck == Duration.zero ||
            elapsed - _lastCheck >= const Duration(seconds: 3))) {
      _lastCheck = elapsed;
      _checking = true;
      unawaited(_refresh());
    }
  }

  Future<void> _refresh() async {
    try {
      await widget.onDeadline();
    } catch (_) {/* Keep cancel accessible while offline. */} finally {
      _checking = false;
    }
  }

  @override
  void dispose() {
    _ticker.dispose();
    _sampleClock.stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context),
        colors = theme.colorScheme,
        progress = widget.progress;
    final remaining =
        progress?.remaining(_sampleClock.elapsedMilliseconds / 1000);
    final time = remaining == null
        ? ''
        : '${(remaining ~/ 60).toString().padLeft(2, '0')}:${(remaining % 60).toString().padLeft(2, '0')}';
    return Column(children: [
      SizedBox(
          width: 156,
          height: 156,
          child: Stack(alignment: Alignment.center, children: [
            Container(
                width: 156,
                height: 156,
                padding: const EdgeInsets.all(25),
                decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: colors.primaryContainer.withValues(alpha: .22)),
                child: Image.asset('assets/images/costa-go-emblem.png')),
            Positioned.fill(
                child: CircularProgressIndicator(
                    value: progress == null ? null : _fraction,
                    strokeWidth: 4,
                    strokeCap: StrokeCap.round,
                    color: colors.primary,
                    backgroundColor: colors.primary.withValues(alpha: .15),
                    semanticsLabel: 'Progreso de búsqueda')),
          ])),
      const SizedBox(height: 20),
      Text('Buscando un conductor cercano',
          textAlign: TextAlign.center,
          style: theme.textTheme.headlineSmall
              ?.copyWith(color: colors.primary, fontWeight: FontWeight.w900)),
      const SizedBox(height: 6),
      Text(
          progress == null
              ? 'Sincronizando búsqueda…'
              : 'Rango ${progress.round} de ${progress.totalRounds} · $time restantes',
          textAlign: TextAlign.center,
          style: theme.textTheme.bodyMedium
              ?.copyWith(color: colors.primary, fontWeight: FontWeight.w700)),
      if (remaining == 0)
        Text('Verificando disponibilidad…',
            textAlign: TextAlign.center,
            style: theme.textTheme.bodySmall
                ?.copyWith(color: colors.onSurfaceVariant)),
      const SizedBox(height: 6),
      Text('Estamos buscando el mototaxi más cercano para ti.',
          textAlign: TextAlign.center,
          style: theme.textTheme.bodyLarge
              ?.copyWith(color: colors.onSurfaceVariant)),
    ]);
  }
}
