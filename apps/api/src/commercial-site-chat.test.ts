import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("chat comercial en costa-go.com", () => {
  it("incrusta el asistente existente y conserva la misma API", async () => {
    const [home, homeScript, chat, proof, proofPage] = await Promise.all([
      readFile(resolve(process.cwd(), "../site/src/index.html"), "utf8"),
      readFile(resolve(process.cwd(), "../site/src/site.js"), "utf8"),
      readFile(resolve(process.cwd(), "../site/src/anunciarme/commercial.js"), "utf8"),
      readFile(resolve(process.cwd(), "../site/src/anunciarme/comprobante/proof.js"), "utf8"),
      readFile(resolve(process.cwd(), "../site/src/anunciarme/comprobante/index.html"), "utf8")
    ]);
    expect(home).toContain('/anunciarme/?embed=1&amp;source=WEB');
    expect(homeScript).toContain("commercial-assistant-panel");
    expect(chat).toContain('/v1/public/advertising/chat/submit');
    expect(chat).toContain('/v1/public/advertising/plans');
    expect(chat).toContain('/v1/public/advertising/payment-methods');
    expect(chat).toContain('Registra tu correo electrónico');
    expect(chat).toContain('Hemos enviado a tu correo los datos para realizar la transferencia');
    expect(chat).toContain('Un asesor de Costa-Go se comunicará contigo');
    expect(chat).not.toContain('¿A qué correo enviamos el enlace seguro?');
    expect(chat).not.toContain('["proof", "Comprobante de pago"');
    expect(chat).toContain('if (shouldSubmit) await submitApplication()');
    expect(chat.indexOf('state.busy = false')).toBeLessThan(chat.indexOf('if (shouldSubmit) await submitApplication()'));
    expect(home).toContain('Chat Costa-Go');
    expect(home).toContain('Anuncia tu negocio');
    expect(home).toContain('/assets/costi-avatar.png');
    expect(chat).toContain('Costi');
    expect(chat).toContain('¡Hola! Soy ');
    expect(chat).toContain('Fue un gusto ayudarte. ¡Nos vemos en el camino!');
    expect(chat).toContain('state.phase === "finalized"');
    expect(chat).toContain('clearLeadProgress();renderFinalizedConversation()');
    expect(homeScript).toContain("commercialFrame.removeAttribute('src')");
    expect(proof).toContain('if(sending)return');
    expect(proof).toContain('buttonLabel.textContent="Enviando…"');
    expect(proofPage).toContain('aria-live="polite"');
  });
});
