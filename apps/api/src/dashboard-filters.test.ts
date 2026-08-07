import { describe, expect, it } from "vitest";
import { dashboardFilters } from "./dashboard-filters.js";

describe("dashboardFilters", () => {
  it("usa treinta días por defecto", () => {
    const filters = dashboardFilters({});
    expect(filters.tripType).toBe("ALL");
    expect(filters.to.getTime() - filters.from.getTime())
      .toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("impone el alcance de cooperativa de la sesión", () => {
    const forced = "11111111-1111-4111-8111-111111111111";
    const requested = "22222222-2222-4222-8222-222222222222";
    expect(dashboardFilters({ cooperativeId: requested }, forced).cooperativeId)
      .toBe(forced);
  });

  it("rechaza períodos mayores a un año", () => {
    expect(() => dashboardFilters({
      from: "2024-01-01T00:00:00.000Z",
      to: "2026-01-02T00:00:00.000Z"
    })).toThrow();
  });
});
