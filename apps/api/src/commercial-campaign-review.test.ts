import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { commercialCampaignReviewBlock } from "./commercial.js";

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
});
