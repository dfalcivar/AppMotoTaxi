import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  advertisingCategoryFromPlacements,
  advertisingPlacementsForCategory,
  normalizeAdvertisingPlacement
} from "./commercial.js";

describe("ubicaciones de publicidad comercial", () => {
  it.each([
    ["PASSENGER_HOME", "PASSENGER_SEARCHING_DRIVER"],
    ["DRIVER_HOME", "PASSENGER_SEARCHING_DRIVER"],
    ["PASSENGER_SEARCHING_DRIVER", "PASSENGER_SEARCHING_DRIVER"],
    ["PASSENGER_WAITING_DRIVER", "PASSENGER_WAITING_DRIVER"],
    ["PASSENGER_TRIP_IN_PROGRESS", "PASSENGER_TRIP_IN_PROGRESS"]
  ])("normaliza %s como %s", (input, expected) => {
    expect(normalizeAdvertisingPlacement(input)).toBe(expected);
  });

  it("usa la ubicación segura predeterminada para valores desconocidos", () => {
    expect(normalizeAdvertisingPlacement("LEGACY_OR_INVALID")).toBe("PASSENGER_SEARCHING_DRIVER");
  });

  it("mantiene Básico únicamente durante la búsqueda", () => {
    expect(advertisingPlacementsForCategory("BASIC")).toEqual(["PASSENGER_SEARCHING_DRIVER"]);
    expect(advertisingCategoryFromPlacements(["PASSENGER_SEARCHING_DRIVER"])).toBe("BASIC");
  });

  it("mantiene Premium en búsqueda, espera y viaje en curso", () => {
    expect(advertisingPlacementsForCategory("PREMIUM")).toEqual([
      "PASSENGER_SEARCHING_DRIVER",
      "PASSENGER_WAITING_DRIVER",
      "PASSENGER_TRIP_IN_PROGRESS"
    ]);
    expect(advertisingCategoryFromPlacements(["PASSENGER_WAITING_DRIVER"])).toBe("PREMIUM");
  });

  it("elimina la restricción antigua antes de convertir los registros históricos", async () => {
    const migration = await readFile(resolve(process.cwd(), "migrations/046_repair_affiliate_banner_placements.sql"), "utf8");
    expect(migration.indexOf("DROP CONSTRAINT")).toBeGreaterThanOrEqual(0);
    expect(migration.indexOf("DROP CONSTRAINT")).toBeLessThan(migration.indexOf("UPDATE affiliate_banners"));
    expect(migration.indexOf("UPDATE affiliate_banners")).toBeLessThan(migration.lastIndexOf("ADD CONSTRAINT"));
  });

  it("repara planes y campañas Premium degradadas por el editor anterior", async () => {
    const migration = await readFile(resolve(process.cwd(), "migrations/063_repair_advertising_plan_coverage.sql"), "utf8");
    expect(migration).toContain("PASSENGER_WAITING_DRIVER");
    expect(migration).toContain("PASSENGER_TRIP_IN_PROGRESS");
    expect(migration).toContain("SET category = 'PREMIUM'");
  });
});
