import { describe, expect, it } from "vitest";
import { commissionForClosure, validateCommissionInvoice } from "./collection-commissions.js";

describe("collection point commissions", () => {
  it("uses only the confirmed payments in the closure", () => {
    expect(commissionForClosure(10, 0.25)).toBe(2.5);
    expect(commissionForClosure(0, 0.25)).toBe(0);
  });

  it("requires the supplier invoice subtotal when the fee excludes tax", () => {
    expect(() => validateCommissionInvoice("BASE_PLUS_TAX", 2.5, 2.5, 0.38, 2.88)).not.toThrow();
    expect(() => validateCommissionInvoice("BASE_PLUS_TAX", 2.5, 2.17, 0.33, 2.5)).toThrow("COMMISSION_INVOICE_CONTRACT_MISMATCH");
  });

  it("requires the supplier invoice total when the fee includes tax", () => {
    expect(() => validateCommissionInvoice("TOTAL_INCLUDING_TAX", 2.5, 2.17, 0.33, 2.5)).not.toThrow();
    expect(() => validateCommissionInvoice("TOTAL_INCLUDING_TAX", 2.5, 2.5, 0.38, 2.88)).toThrow("COMMISSION_INVOICE_CONTRACT_MISMATCH");
  });

  it("rejects inconsistent totals and fractions of a cent", () => {
    expect(() => validateCommissionInvoice("BASE_PLUS_TAX", 2.5, 2.5, 0.38, 2.87)).toThrow("COMMISSION_INVOICE_TOTAL_MISMATCH");
    expect(() => commissionForClosure(1, 0.255)).toThrow("INVALID_COMMISSION_AMOUNT");
  });
});
