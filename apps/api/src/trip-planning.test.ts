import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduledTimeError, tripTotalCents } from "./app.js";

describe("política de viajes programados", () => {
  afterEach(() => vi.useRealTimers());

  it("rechaza una reserva anterior al mínimo parametrizado", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T12:00:37-05:00"));
    const policy = { minimumNoticeMinutes: 30, activationLeadMinutes: 10, maximumAdvanceMinutes: 1440 };
    expect(scheduledTimeError(new Date("2026-08-11T12:29:00-05:00"), policy)).toBe("SCHEDULE_TOO_SOON");
    expect(scheduledTimeError(new Date("2026-08-11T12:31:00-05:00"), policy)).toBeUndefined();
  });

  it("acepta desde el mínimo inclusive hasta exactamente 24 horas", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T12:00:00-05:00"));
    const policy = { minimumNoticeMinutes: 30, activationLeadMinutes: 10, maximumAdvanceMinutes: 1440 };
    expect(scheduledTimeError(new Date("2026-08-11T12:30:00-05:00"), policy)).toBeUndefined();
    expect(scheduledTimeError(new Date("2026-08-12T12:00:00-05:00"), policy)).toBeUndefined();
    expect(scheduledTimeError(new Date("2026-08-12T12:00:01-05:00"), policy)).toBe("SCHEDULE_TOO_FAR");
  });
});

describe("tarifa de múltiples destinos", () => {
  it("suma el recargo solamente por destinos adicionales", () => {
    const price = {
      urban_day_cents_per_passenger: 50,
      night_cents_per_passenger: 100,
      extended_cents_per_passenger: 100,
      group_promotion_enabled: true,
      group_promotion_passengers: 3,
      group_promotion_total_cents: 100,
      stop_surcharge_cents: 25
    };
    expect(tripTotalCents(price, 1, 1, "URBAN", new Date("2026-08-11T12:00:00-05:00"))).toMatchObject({
      baseCents: 50, stopSurchargeCents: 0, totalCents: 50
    });
    expect(tripTotalCents(price, 1, 3, "URBAN", new Date("2026-08-11T12:00:00-05:00"))).toMatchObject({
      baseCents: 50, stopSurchargeCents: 50, totalCents: 100
    });
  });
});
