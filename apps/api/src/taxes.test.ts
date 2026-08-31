import { describe, expect, it } from "vitest";
import { normalizeVatRate, taxBreakdown } from "./taxes.js";

describe("taxBreakdown", () => {
  it("calcula y redondea el IVA en centavos", () => {
    expect(taxBreakdown(12, 15)).toEqual({ subtotal: 12, vatRatePercent: 15, vatAmount: 1.8, total: 13.8 });
    expect(taxBreakdown(35, 8)).toEqual({ subtotal: 35, vatRatePercent: 8, vatAmount: 2.8, total: 37.8 });
  });

  it("permite una tarifa temporal de cero sin alterar el subtotal", () => {
    expect(taxBreakdown(55, 0)).toEqual({ subtotal: 55, vatRatePercent: 0, vatAmount: 0, total: 55 });
  });

  it("rechaza porcentajes fiscales inválidos", () => {
    expect(() => normalizeVatRate(-1)).toThrow("INVALID_VAT_RATE");
    expect(() => normalizeVatRate(101)).toThrow("INVALID_VAT_RATE");
  });
});
