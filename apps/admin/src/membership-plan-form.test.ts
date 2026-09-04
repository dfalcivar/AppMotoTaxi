import { describe, expect, it } from "vitest";
import {
  buildMembershipPlanRequest,
  type MembershipPlanDraft,
} from "./membership-plan-form.js";

function tripPack(validity: number): MembershipPlanDraft {
  return {
    planType: "TRIP_PACK",
    name: "Paquete flexible",
    code: "PACK_FLEXIBLE",
    periodUnit: "DAY",
    periodCount: 1,
    baseAmount: 5,
    includedTrips: 25,
    maxRenewalAmount: 0,
    extraTripSharePercent: 0,
    packValidityDays: validity,
  };
}

describe("payload de planes por viajes", () => {
  it.each([25, 30, 45, 50, 3650])(
    "acepta una vigencia configurable de %i días",
    (validity) => {
      const result = buildMembershipPlanRequest(tripPack(validity));

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.values.packValidityDays).toBe(validity);
      expect(result.values.periodUnit).toBe("DAY");
      expect(result.values.periodCount).toBe(1);
      expect(result.values.durationDays).toBe(1);
    },
  );

  it("usa null para un paquete sin caducidad", () => {
    const result = buildMembershipPlanRequest(tripPack(0));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values.packValidityDays).toBeNull();
  });

  it.each([-1, 25.5, 3651])("rechaza la vigencia inválida %s", (validity) => {
    const result = buildMembershipPlanRequest(tripPack(validity));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("entre 0 y 3650 días");
  });
});

describe("compatibilidad con planes por período", () => {
  it("conserva el cálculo mensual existente", () => {
    const result = buildMembershipPlanRequest({
      ...tripPack(0),
      planType: "PERIODIC",
      name: "Plan mensual",
      code: "MONTHLY",
      periodUnit: "MONTH",
      periodCount: 1,
      includedTrips: 120,
      maxRenewalAmount: 8,
      extraTripSharePercent: 40,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values.durationDays).toBe(30);
    expect(result.values.periodCount).toBe(1);
    expect(result.values.packValidityDays).toBeNull();
  });

  it("alinea el mínimo de nombre con el backend", () => {
    const result = buildMembershipPlanRequest({
      ...tripPack(30),
      name: "AB",
      code: "ABC",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("entre 3 y 100 caracteres");
  });
});
