import { describe, expect, it } from "vitest";
import { firstSearchBounds, nearbyVisibilityRadius, nextSearchBounds, noDriverReason, driverSearchProgress, type DriverSearchSettings } from "./driver-search.js";

const settings: DriverSearchSettings = {
  initialRadiusMeters: 1000,
  radiusIncrementMeters: 1000,
  maximumRadiusMeters: 4500,
  roundWaitSeconds: 15
};

describe('server search progress presentation',()=>{
  const now=new Date('2026-08-28T12:00:00Z');
  const cycleStartedAt=new Date('2026-08-28T11:59:40Z');
  it('uses partial final range and configured wait, not a hardcoded duration',()=>{
    const progress=driverSearchProgress(settings,{round:2,upperMeters:2000,nextRoundAt:new Date(now.getTime()+10000),cycleStartedAt},now)!;
    expect(progress).toMatchObject({round:2,totalRounds:5,totalSeconds:75,elapsedSeconds:20,remainingSeconds:55});
    expect(progress.cycleStartedAt).toBe(cycleStartedAt.toISOString());
  });
  it('supports a single round and a different initial radius',()=>{
    expect(driverSearchProgress({...settings,initialRadiusMeters:5000,maximumRadiusMeters:3000,roundWaitSeconds:20},
      {round:1,upperMeters:3000,nextRoundAt:new Date(now.getTime()+20000),cycleStartedAt},now))
      .toMatchObject({totalRounds:1,totalSeconds:20,elapsedSeconds:0});
  });
  it('does not invent dispatch rounds when the scheduler is delayed',()=>{
    expect(driverSearchProgress(settings,{round:1,upperMeters:1000,nextRoundAt:new Date(now.getTime()-90000),cycleStartedAt},now))
      .toMatchObject({round:1,elapsedSeconds:15,remainingSeconds:60});
  });
  it('last round reaches 100%, without changing any trip status',()=>{
    const progress=driverSearchProgress(settings,{round:5,upperMeters:4500,nextRoundAt:now,cycleStartedAt},now)!;
    expect(progress.remainingSeconds).toBe(0);expect(progress.elapsedSeconds).toBe(progress.totalSeconds);
    expect(progress).not.toHaveProperty('status');
  });
  it('waits for the first real dispatch',()=>{
    expect(driverSearchProgress(settings,{round:0,upperMeters:0,nextRoundAt:now,cycleStartedAt},now)).toBeNull();
  });
});

describe("progressive driver search bounds", () => {
  it("limits the availability preview to the initial or active range", () => {
    expect(nearbyVisibilityRadius(settings)).toBe(1000);
    expect(nearbyVisibilityRadius(settings, 2000)).toBe(2000);
    expect(nearbyVisibilityRadius(settings, 9000)).toBe(4500);
    expect(nearbyVisibilityRadius({ ...settings, initialRadiusMeters: 6000 })).toBe(4500);
  });

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
