import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("chat comercial en costa-go.com", () => {
  it("incrusta el asistente existente y conserva la misma API", async () => {
    const [home, homeScript, chat] = await Promise.all([
      readFile(resolve(process.cwd(), "../site/src/index.html"), "utf8"),
      readFile(resolve(process.cwd(), "../site/src/site.js"), "utf8"),
      readFile(resolve(process.cwd(), "../site/src/anunciarme/commercial.js"), "utf8")
    ]);
    expect(home).toContain('/anunciarme/?embed=1&amp;source=WEB');
    expect(homeScript).toContain("commercial-assistant-panel");
    expect(chat).toContain('/v1/public/advertising/leads');
    expect(chat).toContain('/v1/public/advertising/plans');
    expect(chat).toContain('/v1/public/advertising/payment-methods');
  });
});
