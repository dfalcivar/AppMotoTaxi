export type ServiceZone = "URBAN" | "EXTENDED";

export interface PricingConfig {
  currency: "USD";
  timezone: "America/Guayaquil";
  dayStartsAtMinute: number;
  nightStartsAtMinute: number;
  urbanDayCentsPerPassenger: number;
  nightCentsPerPassenger: number;
  extendedCentsPerPassenger: number;
  urbanGroupPromotion: {
    enabled: boolean;
    passengers: number;
    totalCents: number;
  };
  maximumPassengers: number;
  version: number;
}

export interface QuoteRequest {
  zone: ServiceZone;
  passengers: number;
  localTime: string;
}

export interface Quote {
  currency: "USD";
  totalCents: number;
  total: string;
  period: "DAY" | "NIGHT";
  zone: ServiceZone;
  passengers: number;
  appliedRule:
    | "URBAN_DAY_PER_PASSENGER"
    | "URBAN_DAY_GROUP_PROMOTION"
    | "NIGHT_PER_PASSENGER"
    | "EXTENDED_PER_PASSENGER";
  pricingVersion: number;
  explanation: string;
}

export const initialPricingConfig: PricingConfig = {
  currency: "USD",
  timezone: "America/Guayaquil",
  dayStartsAtMinute: 6 * 60,
  nightStartsAtMinute: 20 * 60,
  urbanDayCentsPerPassenger: 50,
  nightCentsPerPassenger: 100,
  extendedCentsPerPassenger: 100,
  urbanGroupPromotion: {
    enabled: true,
    passengers: 3,
    totalCents: 100
  },
  maximumPassengers: 4,
  version: 1
};

function parseTime(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) {
    throw new Error("La hora debe tener formato HH:mm.");
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

export function isNight(localTime: string, config: PricingConfig): boolean {
  const minute = parseTime(localTime);
  return minute >= config.nightStartsAtMinute || minute < config.dayStartsAtMinute;
}

export function formatUsd(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function calculateQuote(
  request: QuoteRequest,
  config: PricingConfig = initialPricingConfig
): Quote {
  if (!Number.isInteger(request.passengers) || request.passengers < 1) {
    throw new Error("La cantidad de pasajeros debe ser un número entero mayor a cero.");
  }
  if (request.passengers > config.maximumPassengers) {
    throw new Error(`La capacidad máxima configurada es ${config.maximumPassengers}.`);
  }

  const period = isNight(request.localTime, config) ? "NIGHT" : "DAY";
  let totalCents: number;
  let appliedRule: Quote["appliedRule"];
  let explanation: string;

  if (period === "NIGHT") {
    totalCents = config.nightCentsPerPassenger * request.passengers;
    appliedRule = "NIGHT_PER_PASSENGER";
    explanation = `${request.passengers} × $${formatUsd(config.nightCentsPerPassenger)}; las promociones no aplican de noche.`;
  } else if (request.zone === "EXTENDED") {
    totalCents = config.extendedCentsPerPassenger * request.passengers;
    appliedRule = "EXTENDED_PER_PASSENGER";
    explanation = `${request.passengers} × $${formatUsd(config.extendedCentsPerPassenger)} en zona extendida.`;
  } else if (
    config.urbanGroupPromotion.enabled &&
    request.passengers === config.urbanGroupPromotion.passengers
  ) {
    totalCents = config.urbanGroupPromotion.totalCents;
    appliedRule = "URBAN_DAY_GROUP_PROMOTION";
    explanation = `Promoción urbana diurna: ${request.passengers} pasajeros por $${formatUsd(totalCents)}.`;
  } else {
    totalCents = config.urbanDayCentsPerPassenger * request.passengers;
    appliedRule = "URBAN_DAY_PER_PASSENGER";
    explanation = `${request.passengers} × $${formatUsd(config.urbanDayCentsPerPassenger)} en casco urbano.`;
  }

  return {
    currency: config.currency,
    totalCents,
    total: formatUsd(totalCents),
    period,
    zone: request.zone,
    passengers: request.passengers,
    appliedRule,
    pricingVersion: config.version,
    explanation
  };
}
