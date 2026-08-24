import { describe, expect, it } from "vitest";
import { distanceBasedFare, resolveFareMethod, suggestedInterSectorFare, suggestedLocalFare, summarizeFare } from "./fare-engine.js";

const pricing = {
  version: 1,
  urban_day_cents_per_passenger: 50,
  night_cents_per_passenger: 100,
  extended_cents_per_passenger: 100,
  group_promotion_enabled: true,
  group_promotion_passengers: 3,
  group_promotion_total_cents: 100,
  stop_surcharge_cents: 25,
  platform_commission_cents_per_leg: 5,
  distance_fare_cents_per_km: 50,
  local_fare_max_distance_meters: 2000,
  distance_fare_minimum_cents: 0
};

describe("motor tarifario territorial", () => {
  it("usa el valor local sugerido para sectores todavía no configurados", () => {
    expect(suggestedLocalFare(pricing, 1, new Date("2026-08-14T12:00:00-05:00"))).toBe(50);
    expect(suggestedLocalFare(pricing, 3, new Date("2026-08-14T23:00:00-05:00"))).toBe(200);
  });

  it("usa la tarifa extendida cuando el trayecto cruza sectores sin una regla exacta", () => {
    expect(suggestedInterSectorFare(pricing, 1, new Date("2026-08-23T14:52:07-05:00"))).toBe(100);
    expect(suggestedInterSectorFare(pricing, 2, new Date("2026-08-23T14:52:07-05:00"))).toBe(200);
    expect(suggestedInterSectorFare(pricing, 1, new Date("2026-08-23T23:00:00-05:00"))).toBe(100);
  });

  it("calcula $1,10 como respaldo sugerido para dos sectores sin regla oficial", () => {
    const result = summarizeFare([
      {
        order: 1,
        originSector: "SECTOR_ORIGEN",
        destinationSector: "SECTOR_DESTINO",
        fareCents: suggestedInterSectorFare(pricing, 1, new Date("2026-08-23T14:52:07-05:00")),
        commissionCents: 10,
        suggested: true,
        method: "SUGGESTED",
        distanceMeters: 1800
      }
    ], 0);

    expect(result.totalCents).toBe(110);
    expect(result.suggested).toBe(true);
  });

  it("suma comisión por tramo y recargo por una parada sin desglosar la comisión", () => {
    const result = summarizeFare([
      { order: 1, originSector: null, destinationSector: null, fareCents: 50, commissionCents: 5, suggested: true, method: "SUGGESTED", distanceMeters: 900 },
      { order: 2, originSector: "ATACAMES_CENTRO", destinationSector: "TONSUPA", fareCents: 100, commissionCents: 5, suggested: false, method: "CONFIGURED", distanceMeters: 4500 }
    ], 25);
    expect(result).toEqual({
      baseCents: 150,
      platformCommissionCents: 10,
      stopSurchargeCents: 25,
      totalCents: 185,
      suggested: true
    });
  });

  it("calcula proporcionalmente por kilómetros de ruta y respeta la tarifa mínima", () => {
    expect(distanceBasedFare(6400, 50, 0)).toBe(320);
    expect(distanceBasedFare(2300, 40, 125)).toBe(125);
    expect(distanceBasedFare(2000, 50, 0)).toBe(100);
  });

  it("respeta la prioridad regla exacta, distancia y valor sugerido local", () => {
    expect(resolveFareMethod({ configuredFareCents: 200, distanceMeters: 9000, localMaximumMeters: 2000, distanceCentsPerKm: 50, distanceMinimumCents: 0, suggestedFareCents: 50 }))
      .toEqual({ fareCents: 200, method: "CONFIGURED" });
    expect(resolveFareMethod({ distanceMeters: 6400, localMaximumMeters: 2000, distanceCentsPerKm: 50, distanceMinimumCents: 0, suggestedFareCents: 50 }))
      .toEqual({ fareCents: 320, method: "DISTANCE" });
    expect(resolveFareMethod({ distanceMeters: 2000, localMaximumMeters: 2000, distanceCentsPerKm: 50, distanceMinimumCents: 0, suggestedFareCents: 100 }))
      .toEqual({ fareCents: 100, method: "SUGGESTED" });
  });
});
