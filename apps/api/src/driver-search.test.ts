import { describe, expect, it } from "vitest";
import { firstSearchBounds, nextSearchBounds, type DriverSearchSettings } from "./driver-search.js";

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
