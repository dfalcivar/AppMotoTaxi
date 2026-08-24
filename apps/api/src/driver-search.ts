export interface DriverSearchSettings {
  initialRadiusMeters: number;
  radiusIncrementMeters: number;
  maximumRadiusMeters: number;
  roundWaitSeconds: number;
}

export interface DriverSearchBounds {
  round: number;
  lowerMeters: number;
  upperMeters: number;
  finalRound: boolean;
}

export function firstSearchBounds(settings: DriverSearchSettings): DriverSearchBounds {
  const upperMeters = Math.min(settings.initialRadiusMeters, settings.maximumRadiusMeters);
  return { round: 1, lowerMeters: 0, upperMeters, finalRound: upperMeters >= settings.maximumRadiusMeters };
}

export function nextSearchBounds(
  current: Pick<DriverSearchBounds, "round" | "upperMeters">,
  settings: DriverSearchSettings
): DriverSearchBounds | undefined {
  if (current.upperMeters >= settings.maximumRadiusMeters) return;
  const upperMeters = Math.min(
    current.upperMeters + settings.radiusIncrementMeters,
    settings.maximumRadiusMeters
  );
  return {
    round: current.round + 1,
    lowerMeters: current.upperMeters,
    upperMeters,
    finalRound: upperMeters >= settings.maximumRadiusMeters
  };
}
