export const tripStates = [
  "SEARCHING",
  "ASSIGNED",
  "DRIVER_EN_ROUTE",
  "DRIVER_ARRIVED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "NO_DRIVER",
  "INCIDENT"
] as const;

export type TripState = (typeof tripStates)[number];

const allowedTransitions: Record<TripState, readonly TripState[]> = {
  SEARCHING: ["ASSIGNED", "CANCELLED", "NO_DRIVER"],
  ASSIGNED: ["DRIVER_EN_ROUTE", "CANCELLED"],
  DRIVER_EN_ROUTE: ["DRIVER_ARRIVED", "CANCELLED"],
  DRIVER_ARRIVED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "INCIDENT"],
  COMPLETED: [],
  CANCELLED: [],
  NO_DRIVER: [],
  INCIDENT: []
};

export function canTransitionTrip(from: TripState, to: TripState): boolean {
  return allowedTransitions[from].includes(to);
}

export function transitionTrip(from: TripState, to: TripState): TripState {
  if (!canTransitionTrip(from, to)) {
    throw new Error(`Transición de viaje no permitida: ${from} → ${to}.`);
  }
  return to;
}
