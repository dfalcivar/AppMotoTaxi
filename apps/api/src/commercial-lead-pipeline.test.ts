import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("bandeja comercial y conversión de prospectos", () => {
  it("separa la bandeja activa del histórico", async () => {
    const source = await readFile(resolve(process.cwd(), "src/commercial.ts"), "utf8");
    expect(source).toContain('scope: z.enum(["ACTIVE", "HISTORY", "ALL"])');
    expect(source).toContain("l.status not in ('CONVERTED','LOST')");
    expect(source).toContain("l.status in ('CONVERTED','LOST')");
  });

  it("impide tomar o invitar prospectos terminales y órdenes automáticas", async () => {
    const source = await readFile(resolve(process.cwd(), "src/commercial.ts"), "utf8");
    expect(source).toContain('throw new Error("LEAD_NOT_ACTIONABLE")');
    expect(source).toContain('throw new Error("LEAD_ALREADY_HAS_ORDER")');
    expect(source).toContain("exists(select 1 from advertising_orders where lead_id=advertising_leads.id) as has_order");
  });

  it("mantiene la conversión ligada a la conciliación del pago", async () => {
    const source = await readFile(resolve(process.cwd(), "src/commercial.ts"), "utf8");
    expect(source).toContain("markAdvertisingOrdersPaid");
    expect(source).toContain("update advertising_leads set status='CONVERTED'");
  });

  it("propaga el responsable al comercio y a las órdenes al tomar un prospecto", async () => {
    const source = await readFile(resolve(process.cwd(), "src/commercial.ts"), "utf8");
    expect(source).toContain("update advertisers set assigned_commercial_id=${actor.id}");
    expect(source).toContain("update advertising_orders set assigned_commercial_id=${actor.id}");
    expect(source).toContain("order_assigned_elsewhere");
    expect(source).toContain("advertiser_assigned_elsewhere");
  });

  it("distingue transferencia automática de cobro gestionado por asesor", async () => {
    const source = await readFile(resolve(process.cwd(), "src/commercial.ts"), "utf8");
    expect(source).toContain('latest_order.payment_method_code as "paymentMethodCode"');
    expect(source).toContain("advertising_payment_methods method");
  });

  it("envía las transferencias automáticas exclusivamente a Finanzas", async () => {
    const source = await readFile(resolve(process.cwd(), "src/commercial.ts"), "utf8");
    const migration = await readFile(resolve(process.cwd(), "migrations/059_route_automatic_transfers_to_finance.sql"), "utf8");
    expect(source).toContain("coalesce(latest_order.payment_method_code,'')<>'BANK_TRANSFER'");
    expect(source).toContain('throw new Error("AUTOMATIC_TRANSFER_FLOW")');
    expect(source).toContain('/v1/admin/commercial/payments/:id/remind');
    expect(migration).toContain("set assigned_commercial_id = null");
  });
});
