import 'package:flutter/material.dart';

/// The membership API already resolves eligibility, including approval and
/// suspension. This selects only the active grant identified by that decision.
class ActiveMembershipCourtesy {
  const ActiveMembershipCourtesy({required this.expiresAt, required this.days});

  final DateTime expiresAt;
  final int? days;

  String get description => days == null
      ? 'Membresía gratis por cortesía'
      : '$days ${days == 1 ? 'día gratis' : 'días gratis'} de membresía';
}

ActiveMembershipCourtesy? activeMembershipCourtesy(Map<String, dynamic> data,
    {DateTime? now}) {
  final eligibility = data['eligibility'];
  if (eligibility is! Map || eligibility['eligible'] != true) {
    return null;
  }
  final eligibleBenefit = eligibility['benefit'];
  if (eligibleBenefit is! Map) {
    return null;
  }
  final rows = data['benefitCoverage'];
  if (rows is! List) {
    return null;
  }
  final instant = now ?? DateTime.now();
  for (final raw in rows) {
    if (raw is! Map ||
        raw['id']?.toString() != eligibleBenefit['id']?.toString() ||
        raw['status'] != 'ACTIVE') {
      continue;
    }
    final start = DateTime.tryParse(raw['effectiveFrom']?.toString() ?? '');
    final end = DateTime.tryParse(raw['effectiveUntil']?.toString() ?? '');
    if (start == null ||
        end == null ||
        instant.isBefore(start) ||
        !instant.isBefore(end)) {
      continue;
    }
    final suppliedDays = raw['durationDays'];
    final days = suppliedDays is num && suppliedDays > 0
        ? suppliedDays.toInt()
        : end.difference(start).inDays;
    return ActiveMembershipCourtesy(
        expiresAt: end, days: days > 0 ? days : null);
  }
  return null;
}

class MembershipCourtesyHeading extends StatelessWidget {
  const MembershipCourtesyHeading({super.key, required this.description});

  final String description;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Cortesía activa',
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.w900)),
          const SizedBox(height: 4),
          Text(description,
              style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant)),
        ],
      );
}
