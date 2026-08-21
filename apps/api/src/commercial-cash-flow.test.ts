import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("flujo comercial auditable", () => {
  it("separa recepción, cierre y conciliación financiera", async () => {
    const source = await readFile(resolve(process.cwd(), "src/commercial.ts"), "utf8");
    expect(source).toContain('/v1/admin/commercial/orders/:id/payments');
    expect(source).toContain("settlement_status=${settlementStatus}");
    expect(source).toContain('/v1/admin/commercial/cash-closures');
    expect(source).toContain('/v1/admin/commercial/cash-closures/:id/review');
    expect(source).toContain("markAdvertisingOrdersPaid");
    expect(source).toContain("PAYMENT_NOT_READY_FOR_RECONCILIATION");
  });

  it("migra estados y cierres sin convertir recibido en pagado", async () => {
    const migration = await readFile(resolve(process.cwd(), "migrations/048_commercial_cash_reconciliation.sql"), "utf8");
    expect(migration).toContain("'RECEIVED'");
    expect(migration).toContain("'PENDING_CLOSURE'");
    expect(migration).toContain("'PENDING_RECONCILIATION'");
    expect(migration).toContain("advertising_cash_closures");
    expect(migration).toContain("advertising_payments_idempotency_uidx");
  });
});
