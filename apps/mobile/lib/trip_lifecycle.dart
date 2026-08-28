/// Shared defensive rules for rendering server trip snapshots.
const assignedTripStatuses = {
  'ASSIGNED',
  'DRIVER_EN_ROUTE',
  'DRIVER_ARRIVED',
  'IN_PROGRESS'
};
const terminalTripStatuses = {'COMPLETED', 'CANCELLED', 'NO_DRIVER'};

bool hasAssignedDriver(dynamic trip) =>
    trip is Map && (trip['driverId']?.toString().trim().isNotEmpty ?? false);

bool canPassengerCancel(dynamic trip) =>
    trip is Map &&
    trip['startedAt'] == null &&
    {'SEARCHING', 'ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED'}
        .contains(trip['status']);

bool isAssignedTrip(dynamic trip) =>
    trip is Map &&
    assignedTripStatuses.contains(trip['status']) &&
    hasAssignedDriver(trip);
