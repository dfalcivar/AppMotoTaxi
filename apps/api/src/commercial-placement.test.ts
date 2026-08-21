import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { normalizeAdvertisingPlacement } from "./commercial.js";

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

  it("elimina la restricción antigua antes de convertir los registros históricos", async () => {
    const migration = await readFile(resolve(process.cwd(), "migrations/046_repair_affiliate_banner_placements.sql"), "utf8");
    expect(migration.indexOf("DROP CONSTRAINT")).toBeGreaterThanOrEqual(0);
    expect(migration.indexOf("DROP CONSTRAINT")).toBeLessThan(migration.indexOf("UPDATE affiliate_banners"));
    expect(migration.indexOf("UPDATE affiliate_banners")).toBeLessThan(migration.lastIndexOf("ADD CONSTRAINT"));
  });
});
