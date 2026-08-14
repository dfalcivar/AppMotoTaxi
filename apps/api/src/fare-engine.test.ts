import { describe, expect, it } from "vitest";
import { suggestedLocalFare, summarizeFare } from "./fare-engine.js";

const pricing = {
  version: 1,
  urban_day_cents_per_passenger: 50,
  night_cents_per_passenger: 100,
  group_promotion_enabled: true,
  group_promotion_passengers: 3,
  group_promotion_total_cents: 100,
  stop_surcharge_cents: 25,
  platform_commission_cents_per_leg: 5
};

describe("motor tarifario territorial", () => {
  it("usa el valor local sugerido para sectores todavía no configurados", () => {
    expect(suggestedLocalFare(pricing, 1, new Date("2026-08-14T12:00:00-05:00"))).toBe(50);
    expect(suggestedLocalFare(pricing, 3, new Date("2026-08-14T23:00:00-05:00"))).toBe(200);
  });

  it("suma comisión por tramo y recargo por una parada sin desglosar la comisión", () => {
    const result = summarizeFare([
      { order: 1, originSector: null, destinationSector: null, fareCents: 50, commissionCents: 5, suggested: true },
      { order: 2, originSector: "ATACAMES_CENTRO", destinationSector: "TONSUPA", fareCents: 100, commissionCents: 5, suggested: false }
    ], 25);
    expect(result).toEqual({
      baseCents: 150,
      platformCommissionCents: 10,
      stopSurchargeCents: 25,
      totalCents: 185,
      suggested: true
    });
  });
});
