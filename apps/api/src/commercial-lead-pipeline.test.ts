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
});
