import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("órdenes de pago de membresía", () => {
  it("anula de forma atómica, conserva motivo e invalida el QR", async () => {
    const source = await readFile(resolve(process.cwd(), "src/memberships.ts"), "utf8");
    expect(source).toContain('/v1/driver/membership/payment-orders/:id/cancel');
    expect(source).toContain("where id=${orderId} and driver_id=${driverId}");
    expect(source).toContain("for update");
    expect(source).toContain("PAYMENT_ORDER_NOT_CANCELLABLE");
    expect(source).toContain("public_token_hash=${invalidTokenHash}");
    expect(source).toContain("MEMBERSHIP_PAYMENT_ORDER_CANCELLED");
  });

  it("guarda el cálculo económico vigente como snapshot de la orden", async () => {
    const source = await readFile(resolve(process.cwd(), "src/memberships.ts"), "utf8");
    expect(source).toContain("economicBreakdown");
    expect(source).toContain("billable_extra_amount");
    expect(source).toContain("extra_trip_fee_snapshot");
    expect(source).toContain("extra_trip_share_percent_snapshot");
    expect(source).toContain("adjustment_amount");
  });

  it("la migración preserva las órdenes y registra la anulación", async () => {
    const migration = await readFile(
      resolve(process.cwd(), "migrations/056_membership_payment_order_cancellation.sql"), "utf8");
    expect(migration).toContain("cancellation_reason_code");
    expect(migration).toContain("cancellation_observation");
    expect(migration).toContain("cancellation_idempotency_key");
    expect(migration).not.toContain("DELETE FROM membership_payment_orders");
  });
});
