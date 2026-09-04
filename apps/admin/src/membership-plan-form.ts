export type MembershipPlanDraft = {
  planType: "PERIODIC" | "TRIP_PACK";
  name: string;
  code: string;
  periodUnit: "DAY" | "MONTH" | "QUARTER" | "YEAR";
  periodCount: number;
  baseAmount: number;
  includedTrips: number;
  maxRenewalAmount: number;
  extraTripSharePercent: number;
  packValidityDays: number;
};

type PlanRequestValues = {
  name: string;
  planType: MembershipPlanDraft["planType"];
  periodUnit: MembershipPlanDraft["periodUnit"];
  periodCount: number;
  durationDays: number;
  baseAmount: number;
  currency: "USD";
  includedTrips: number;
  packValidityDays: number | null;
  maxRenewalAmount: number;
  extraTripSharePercent: number;
};

export type MembershipPlanRequestResult =
  | { ok: true; code: string; values: PlanRequestValues }
  | { ok: false; message: string };

function durationInDays(
  unit: MembershipPlanDraft["periodUnit"],
  count: number,
) {
  if (unit === "DAY") return count;
  if (unit === "MONTH") return count * 30;
  if (unit === "QUARTER") return count * 90;
  return count * 365;
}

function generatedCode(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function buildMembershipPlanRequest(
  draft: MembershipPlanDraft,
): MembershipPlanRequestResult {
  const name = draft.name.trim();
  const code = (draft.code.trim() || generatedCode(name)).toUpperCase();
  const isTripPack = draft.planType === "TRIP_PACK";

  if (name.length < 3 || name.length > 100) {
    return {
      ok: false,
      message: "El nombre debe tener entre 3 y 100 caracteres.",
    };
  }
  if (!/^[A-Z0-9_]{3,40}$/.test(code)) {
    return {
      ok: false,
      message:
        "El código interno debe tener entre 3 y 40 caracteres usando letras, números o guion bajo.",
    };
  }
  if (!Number.isFinite(draft.baseAmount) || draft.baseAmount < 0) {
    return { ok: false, message: "Ingresa un precio base válido." };
  }
  if (
    !Number.isInteger(draft.includedTrips) ||
    draft.includedTrips < (isTripPack ? 1 : 0) ||
    draft.includedTrips > 1_000_000
  ) {
    return {
      ok: false,
      message: isTripPack
        ? "La cantidad de viajes debe ser un número entero mayor que cero."
        : "Revisa la cantidad de viajes incluidos.",
    };
  }

  if (isTripPack) {
    if (
      !Number.isInteger(draft.packValidityDays) ||
      draft.packValidityDays < 0 ||
      draft.packValidityDays > 3650
    ) {
      return {
        ok: false,
        message:
          "La vigencia debe ser un número entero entre 0 y 3650 días. Usa 0 para indicar que no caduca.",
      };
    }

    return {
      ok: true,
      code,
      values: {
        name,
        planType: draft.planType,
        // Los paquetes no son ciclos periódicos. Estos valores técnicos
        // conservan compatibilidad con las columnas históricas del esquema.
        periodUnit: "DAY",
        periodCount: 1,
        durationDays: 1,
        baseAmount: draft.baseAmount,
        currency: "USD",
        includedTrips: draft.includedTrips,
        packValidityDays:
          draft.packValidityDays > 0 ? draft.packValidityDays : null,
        maxRenewalAmount: draft.baseAmount,
        extraTripSharePercent: 0,
      },
    };
  }

  const durationDays = durationInDays(draft.periodUnit, draft.periodCount);
  if (
    !Number.isInteger(draft.periodCount) ||
    draft.periodCount < 1 ||
    draft.periodCount > 24 ||
    durationDays > 730
  ) {
    return {
      ok: false,
      message: "La duración del plan por período debe estar entre 1 y 730 días.",
    };
  }
  if (
    !Number.isFinite(draft.maxRenewalAmount) ||
    draft.maxRenewalAmount < draft.baseAmount
  ) {
    return {
      ok: false,
      message: "El tope de renovación no puede ser menor al precio base.",
    };
  }
  if (
    !Number.isFinite(draft.extraTripSharePercent) ||
    draft.extraTripSharePercent < 0 ||
    draft.extraTripSharePercent > 100
  ) {
    return {
      ok: false,
      message: "La participación adicional debe estar entre 0% y 100%.",
    };
  }

  return {
    ok: true,
    code,
    values: {
      name,
      planType: draft.planType,
      periodUnit: draft.periodUnit,
      periodCount: draft.periodCount,
      durationDays,
      baseAmount: draft.baseAmount,
      currency: "USD",
      includedTrips: draft.includedTrips,
      packValidityDays: null,
      maxRenewalAmount: draft.maxRenewalAmount,
      extraTripSharePercent: draft.extraTripSharePercent,
    },
  };
}
