import { database } from "./database.js";

export interface FarePoint { latitude: number; longitude: number }

interface PricingRow {
  version: number;
  urban_day_cents_per_passenger: number;
  night_cents_per_passenger: number;
  extended_cents_per_passenger: number;
  group_promotion_enabled: boolean;
  group_promotion_passengers: number;
  group_promotion_total_cents: number;
  stop_surcharge_cents: number;
  platform_commission_cents_per_leg: number;
}

export interface TerritorialFare {
  pricingVersion: number;
  baseCents: number;
  stopSurchargeCents: number;
  platformCommissionCents: number;
  totalCents: number;
  suggested: boolean;
  legs: Array<{
    order: number;
    originSector: string | null;
    destinationSector: string | null;
    fareCents: number;
    commissionCents: number;
    suggested: boolean;
  }>;
}

export function summarizeFare(
  legs: TerritorialFare["legs"],
  stopSurchargeCentsPerStop: number
) {
  const baseCents = legs.reduce((sum, leg) => sum + leg.fareCents, 0);
  const platformCommissionCents = legs.reduce((sum, leg) => sum + leg.commissionCents, 0);
  const stopSurchargeCents = Math.max(0, legs.length - 1) * stopSurchargeCentsPerStop;
  return {
    baseCents, platformCommissionCents, stopSurchargeCents,
    totalCents: baseCents + platformCommissionCents + stopSurchargeCents,
    suggested: legs.some(leg => leg.suggested)
  };
}

function localPeriod(travelAt: Date): "DAY" | "NIGHT" {
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Guayaquil", hour: "2-digit", hour12: false
  }).format(travelAt));
  return hour >= 22 || hour < 6 ? "NIGHT" : "DAY";
}

export function suggestedLocalFare(price: PricingRow, passengers: number, travelAt: Date): number {
  if (localPeriod(travelAt) === "NIGHT") {
    return Number(price.night_cents_per_passenger) * Math.min(passengers, 2);
  }
  if (Boolean(price.group_promotion_enabled) && passengers === Number(price.group_promotion_passengers)) {
    return Number(price.group_promotion_total_cents);
  }
  return Number(price.urban_day_cents_per_passenger) * passengers;
}

export function suggestedInterSectorFare(price: PricingRow, passengers: number, travelAt: Date): number {
  if (localPeriod(travelAt) === "NIGHT") {
    return Number(price.night_cents_per_passenger) * Math.min(passengers, 2);
  }
  return Number(price.extended_cents_per_passenger) * passengers;
}

async function sectorAt(serviceAreaId: string, point: FarePoint) {
  const [sector] = await database()`
    select id::text, code, name
    from fare_sectors
    where service_area_id=${serviceAreaId}::uuid and enabled=true
      and ST_Covers(boundary, ST_SetSRID(ST_MakePoint(${point.longitude},${point.latitude}),4326)::geography)
    -- La prioridad administrativa prevalece. Ante polígonos superpuestos con
    -- igual prioridad, el sector de menor superficie es el más específico y
    -- evita que un polígono general (por ejemplo, cabecera cantonal) absorba
    -- sectores territoriales como Tonsupa.
    order by priority desc, ST_Area(boundary) asc, updated_at desc limit 1
  `;
  return sector as { id: string; code: string; name: string } | undefined;
}

async function configuredLegFare(
  serviceAreaId: string,
  originSectorId: string | undefined,
  destinationSectorId: string | undefined,
  passengers: number,
  travelAt: Date
) {
  if (!originSectorId || !destinationSectorId) return undefined;
  const [rule] = await database()`
    select day_total_cents as "dayCents", night_total_cents as "nightCents"
    from fare_route_rules
    where service_area_id=${serviceAreaId}::uuid and enabled=true
      and active_from<=${travelAt} and (active_until is null or active_until>${travelAt})
      and ${passengers} between minimum_passengers and maximum_passengers
      and ((origin_sector_id=${originSectorId}::uuid and destination_sector_id=${destinationSectorId}::uuid)
        or (bidirectional=true and origin_sector_id=${destinationSectorId}::uuid and destination_sector_id=${originSectorId}::uuid))
    order by priority desc, active_from desc, created_at desc limit 1
  `;
  if (!rule) return undefined;
  return localPeriod(travelAt) === "NIGHT" ? Number(rule.nightCents) : Number(rule.dayCents);
}

export async function calculateTerritorialFare(input: {
  serviceAreaId: string;
  origin: FarePoint;
  destinations: FarePoint[];
  passengers: number;
  travelAt: Date;
}): Promise<TerritorialFare> {
  const [price] = await database()`
    select version, urban_day_cents_per_passenger, night_cents_per_passenger,
      extended_cents_per_passenger,
      group_promotion_enabled, group_promotion_passengers, group_promotion_total_cents,
      stop_surcharge_cents, coalesce(platform_commission_cents_per_leg,5) as platform_commission_cents_per_leg
    from pricing_versions
    where active_from<=${input.travelAt} and (active_until is null or active_until>${input.travelAt})
    order by active_from desc,version desc limit 1
  ` as unknown as PricingRow[];
  if (!price) throw new Error("PRICING_UNAVAILABLE");

  const points = [input.origin, ...input.destinations];
  const sectors = await Promise.all(points.map(point => sectorAt(input.serviceAreaId, point)));
  const commissionPerLeg = Number(price.platform_commission_cents_per_leg ?? 5);
  const legs: TerritorialFare["legs"] = [];
  for (let index = 0; index < input.destinations.length; index++) {
    const originSector = sectors[index];
    const destinationSector = sectors[index + 1];
    const configured = await configuredLegFare(
      input.serviceAreaId, originSector?.id, destinationSector?.id, input.passengers, input.travelAt);
    const isConfiguredLocalSector = Boolean(originSector?.id && originSector.id === destinationSector?.id);
    legs.push({
      order: index + 1,
      originSector: originSector?.code ?? null,
      destinationSector: destinationSector?.code ?? null,
      fareCents: configured ?? (originSector?.id && destinationSector?.id && originSector.id !== destinationSector.id
        ? suggestedInterSectorFare(price, input.passengers, input.travelAt)
        : suggestedLocalFare(price, input.passengers, input.travelAt)),
      commissionCents: commissionPerLeg,
      suggested: configured == null && !isConfiguredLocalSector
    });
  }
  const summary = summarizeFare(legs, Number(price.stop_surcharge_cents ?? 0));
  return {
    pricingVersion: Number(price.version), ...summary, legs
  };
}
