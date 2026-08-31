export type TaxBreakdown = {
  subtotal: number;
  vatRatePercent: number;
  vatAmount: number;
  total: number;
};

export function roundMoney(value: unknown): number {
  return Math.round((Number(value ?? 0) + Number.EPSILON) * 100) / 100;
}

export function normalizeVatRate(value: unknown): number {
  const rate = Number(value ?? 0);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error("INVALID_VAT_RATE");
  return Math.round(rate * 1000) / 1000;
}

export function taxBreakdown(subtotalValue: unknown, vatRateValue: unknown): TaxBreakdown {
  const subtotal = roundMoney(Math.max(0, Number(subtotalValue ?? 0)));
  const vatRatePercent = normalizeVatRate(vatRateValue);
  const vatAmount = roundMoney(subtotal * vatRatePercent / 100);
  return { subtotal, vatRatePercent, vatAmount, total: roundMoney(subtotal + vatAmount) };
}
