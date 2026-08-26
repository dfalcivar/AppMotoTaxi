import { describe, expect, it } from "vitest";
import { firstSearchBounds, nextSearchBounds, noDriverReason, type DriverSearchSettings } from "./driver-search.js";

const settings: DriverSearchSettings = {
  initialRadiusMeters: 1000,
  radiusIncrementMeters: 1000,
  maximumRadiusMeters: 4500,
  roundWaitSeconds: 15
};

describe("progressive driver search bounds", () => {
  it("starts at zero and uses the configured initial radius", () => {
    expect(firstSearchBounds(settings)).toEqual({
      round: 1, lowerMeters: 0, upperMeters: 1000, finalRound: false
    });
  });

  it("creates non-overlapping ranges and clamps the final round", () => {
    const first = firstSearchBounds(settings);
    const second = nextSearchBounds(first, settings)!;
    const third = nextSearchBounds(second, settings)!;
    const fourth = nextSearchBounds(third, settings)!;
    const fifth = nextSearchBounds(fourth, settings)!;
    expect(second).toMatchObject({ lowerMeters: 1000, upperMeters: 2000 });
    expect(third).toMatchObject({ lowerMeters: 2000, upperMeters: 3000 });
    expect(fourth).toMatchObject({ lowerMeters: 3000, upperMeters: 4000 });
    expect(fifth).toEqual({ round: 5, lowerMeters: 4000, upperMeters: 4500, finalRound: true });
    expect(nextSearchBounds(fifth, settings)).toBeUndefined();
  });

  it("supports a first round equal to the maximum radius", () => {
    expect(firstSearchBounds({ ...settings, initialRadiusMeters: 3000, maximumRadiusMeters: 3000 }))
      .toEqual({ round: 1, lowerMeters: 0, upperMeters: 3000, finalRound: true });
  });
});

describe("driver search terminal audit reason", () => {
  it("identifies De Una requests with nearby drivers but no compatible collector", () => {
    expect(noDriverReason({
      paymentMethod: "DEUNA", eligibleDrivers: 4, compatibleDrivers: 0, offersSent: 0
    })).toBe("NO_DEUNA_COMPATIBLE_DRIVER");
  });

  it("distinguishes offers that expired or were rejected", () => {
    expect(noDriverReason({
      paymentMethod: "DEUNA", eligibleDrivers: 4, compatibleDrivers: 2, offersSent: 2
    })).toBe("NO_DRIVER_ACCEPTED");
    expect(noDriverReason({
      paymentMethod: "CASH", eligibleDrivers: 3, compatibleDrivers: 3, offersSent: 3
    })).toBe("NO_DRIVER_ACCEPTED");
  });

  it("keeps lack of eligible drivers separate from payment incompatibility", () => {
    expect(noDriverReason({
      paymentMethod: "DEUNA", eligibleDrivers: 0, compatibleDrivers: 0, offersSent: 0
    })).toBe("NO_ELIGIBLE_DRIVER_IN_RADIUS");
  });
});
