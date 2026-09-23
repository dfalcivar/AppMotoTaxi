export type CommissionBasis = "BASE_PLUS_TAX" | "TOTAL_INCLUDING_TAX";

export function cents(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error("INVALID_COMMISSION_AMOUNT");
  const scaled = Math.round(value * 100);
  if (Math.abs(value * 100 - scaled) > 0.000001) throw new Error("INVALID_COMMISSION_AMOUNT");
  return scaled;
}

export function commissionForClosure(paymentCount: number, perPayment: number): number {
  if (!Number.isInteger(paymentCount) || paymentCount < 0) throw new Error("INVALID_COMMISSION_COUNT");
  return paymentCount * cents(perPayment) / 100;
}

export function validateCommissionInvoice(basis: CommissionBasis, contractedAmount: number, subtotal: number, vat: number, total: number): void {
  const subtotalCents = cents(subtotal);
  const vatCents = cents(vat);
  const totalCents = cents(total);
  if (totalCents !== subtotalCents + vatCents) throw new Error("COMMISSION_INVOICE_TOTAL_MISMATCH");
  if ((basis === "BASE_PLUS_TAX" ? subtotalCents : totalCents) !== cents(contractedAmount)) {
    throw new Error("COMMISSION_INVOICE_CONTRACT_MISMATCH");
  }
}
