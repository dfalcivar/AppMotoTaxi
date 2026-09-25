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
        (raw['benefitType'] != null && raw['benefitType'] != 'COURTESY_DAYS') ||
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

class FreeTripBenefitCoverage {
  const FreeTripBenefitCoverage({required this.id,required this.remainingTrips,required this.originalTrips,
    required this.validityDays,required this.pending,required this.waitingFor,this.expiresAt});
  final String id;
  final int remainingTrips,originalTrips,validityDays;
  final bool pending;
  final String? waitingFor;
  final DateTime? expiresAt;

  String get availabilityDescription => switch(waitingFor) {
    'TRIP_PACK' => 'Comenzarán al agotar los viajes de tu paquete actual.',
    'PERIODIC' => 'Comenzarán cuando termine tu membresía actual.',
    'COURTESY' => 'Comenzarán cuando termine tu cortesía por días.',
    _ => 'Comenzarán al aceptar el próximo viaje elegible.',
  };
}

List<FreeTripBenefitCoverage> freeTripBenefitCoverages(Map<String,dynamic> data,{DateTime? now}) {
  final rows=data['benefitCoverage'];
  if(rows is! List)return const [];
  final instant=now??DateTime.now();
  return [for(final raw in rows) if(raw is Map && raw['benefitType']=='FREE_TRIPS')
    if(raw['status']=='PENDING' || raw['status']=='ACTIVE' &&
      (DateTime.tryParse(raw['effectiveUntil']?.toString()??'')?.isAfter(instant)??false))
      FreeTripBenefitCoverage(
        id:raw['id']?.toString()??'',
        remainingTrips:(raw['remainingTrips'] as num?)?.toInt()??0,
        originalTrips:(raw['originalTrips'] as num?)?.toInt()??0,
        validityDays:(raw['validityDays'] as num?)?.toInt()??0,
        pending:raw['status']=='PENDING',
        waitingFor:raw['waitingFor']?.toString(),
        expiresAt:DateTime.tryParse(raw['effectiveUntil']?.toString()??''),
      )];
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
