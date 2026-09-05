import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { advertisingRenewalWindow, commercialCampaignReviewBlock } from "./commercial.js";

describe("aprobación financiera de campañas",()=>{
  it("bloquea campañas sin orden comercial",()=>{
    expect(commercialCampaignReviewBlock({order_status:"PAID",payment_verified:true})).toBe("COMMERCIAL_ORDER_REQUIRED");
  });

  it("bloquea campañas cuyo pago no fue conciliado",()=>{
    expect(commercialCampaignReviewBlock({order_id:"order-1",order_status:"PAYMENT_REVIEW",payment_verified:false})).toBe("PAYMENT_NOT_RECONCILED");
    expect(commercialCampaignReviewBlock({order_id:"order-1",order_status:"PAID",payment_verified:false})).toBe("PAYMENT_NOT_RECONCILED");
  });

  it("habilita revisión solo con orden pagada y conciliada",()=>{
    expect(commercialCampaignReviewBlock({order_id:"order-1",order_status:"PAID",payment_verified:true})).toBeNull();
  });

  it("protege y repara también en PostgreSQL",async()=>{
    const migration=await readFile(resolve(process.cwd(),"migrations/052_enforce_advertising_payment_before_review.sql"),"utf8");
    expect(migration).toContain("enforce_commercial_campaign_payment");
    expect(migration).toContain("payment.settlement_status = 'RECONCILED'");
    expect(migration).toContain("SET active = false");
  });

  it("conserva los días pagados al renovar anticipadamente",()=>{
    const now=new Date("2026-08-23T12:00:00.000Z"),currentEnd=new Date("2026-09-23T12:00:00.000Z");
    const window=advertisingRenewalWindow(currentEnd,30,now);
    expect(window.startsAt.toISOString()).toBe(currentEnd.toISOString());
    expect(window.endsAt.toISOString()).toBe("2026-10-23T12:00:00.000Z");
  });

  it("inicia inmediatamente si la campaña ya venció",()=>{
    const now=new Date("2026-10-01T12:00:00.000Z"),window=advertisingRenewalWindow("2026-09-01T12:00:00.000Z",15,now);
    expect(window.startsAt.toISOString()).toBe(now.toISOString());
    expect(window.endsAt.toISOString()).toBe("2026-10-16T12:00:00.000Z");
  });

  it("migra renovaciones y clasifica alianzas institucionales",async()=>{
    const migration=await readFile(resolve(process.cwd(),"migrations/053_advertising_renewals_and_institutional_alliances.sql"),"utf8");
    expect(migration).toContain("renewal_of_campaign_id");
    expect(migration).toContain("content_reused");
    expect(migration).toContain("PAYMENT_POINT");
    expect(migration).toContain("internal_authorized_by");
  });

  it("crea un pago pendiente para cada orden de renovación y repara las existentes",async()=>{
    const api=await readFile(resolve(process.cwd(),"src/commercial.ts"),"utf8");
    const renewalFlow=api.slice(api.indexOf('app.post("/v1/admin/commercial/campaigns/:id/renew"'),api.indexOf('app.post("/v1/admin/commercial/campaigns/:id/action"'));
    expect(renewalFlow).toContain("insert into advertising_payments");
    expect(renewalFlow).toContain("'PENDING','NOT_RECEIVED'");
    const migration=await readFile(resolve(process.cwd(),"migrations/085_repair_advertising_renewal_payments.sql"),"utf8");
    expect(migration).toContain("renewal_of_campaign_id IS NOT NULL");
    expect(migration).toContain("NOT EXISTS");
  });
});
