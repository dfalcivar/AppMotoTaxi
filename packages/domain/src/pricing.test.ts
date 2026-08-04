import { describe, expect, it } from "vitest";
import { calculateQuote, initialPricingConfig } from "./pricing.js";

describe("motor tarifario inicial de Atacames", () => {
  it.each([
    ["10:00", "URBAN", 1, 50, "URBAN_DAY_PER_PASSENGER"],
    ["10:00", "URBAN", 2, 100, "URBAN_DAY_PER_PASSENGER"],
    ["10:00", "URBAN", 3, 100, "URBAN_DAY_GROUP_PROMOTION"],
    ["19:59", "URBAN", 3, 100, "URBAN_DAY_GROUP_PROMOTION"],
    ["20:00", "URBAN", 3, 300, "NIGHT_PER_PASSENGER"],
    ["05:59", "URBAN", 2, 200, "NIGHT_PER_PASSENGER"],
    ["06:00", "URBAN", 3, 100, "URBAN_DAY_GROUP_PROMOTION"],
    ["12:00", "URBAN", 4, 200, "URBAN_DAY_PER_PASSENGER"],
    ["12:00", "EXTENDED", 3, 300, "EXTENDED_PER_PASSENGER"]
  ] as const)(
    "%s, %s, %i pasajero(s)",
    (localTime, zone, passengers, totalCents, appliedRule) => {
      const quote = calculateQuote({ localTime, zone, passengers });
      expect(quote.totalCents).toBe(totalCents);
      expect(quote.appliedRule).toBe(appliedRule);
    }
  );

  it("permite cambiar valores sin modificar la lógica", () => {
    const config = {
      ...initialPricingConfig,
      urbanDayCentsPerPassenger: 75,
      version: 2
    };
    expect(
      calculateQuote({ localTime: "08:00", zone: "URBAN", passengers: 1 }, config)
    ).toMatchObject({ totalCents: 75, pricingVersion: 2 });
  });

  it("rechaza pasajeros por encima de la capacidad", () => {
    expect(() =>
      calculateQuote({ localTime: "08:00", zone: "URBAN", passengers: 5 })
    ).toThrow("capacidad máxima");
  });
});
