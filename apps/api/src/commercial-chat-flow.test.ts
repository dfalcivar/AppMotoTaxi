import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("flujo comercial finalizado", () => {
  it("limita los medios públicos y genera el comprobante fuera del chat", async () => {
    const [api, migration, proofPage] = await Promise.all([
      readFile(resolve(process.cwd(), "src/commercial.ts"), "utf8"),
      readFile(resolve(process.cwd(), "migrations/049_commercial_chat_finalization.sql"), "utf8"),
      readFile(resolve(process.cwd(), "../site/src/anunciarme/comprobante/index.html"), "utf8")
    ]);
    expect(api).toContain("code in ('BANK_TRANSFER','COMMERCIAL_MANAGED')");
    expect(api).toContain("/v1/public/advertising/chat/submit");
    expect(api).toContain("/v1/public/advertising/payment-proof/:token");
    expect(api).toContain("advertising_payment_upload_tokens");
    expect(migration).toContain("conversation_status IN ('IN_PROGRESS','FINALIZADO')");
    expect(proofPage).toContain("Carga tu comprobante");
  });
});
