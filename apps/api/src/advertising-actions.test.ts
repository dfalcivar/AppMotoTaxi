import { describe, expect, it } from "vitest";
import { composeAdvertisingActionValue, normalizeAdvertisingActionMessage, normalizeAdvertisingActionValue } from "./advertising-actions.js";

describe("acciones de campañas publicitarias", () => {
  it("convierte un celular ecuatoriano local en enlace de WhatsApp", () => {
    expect(normalizeAdvertisingActionValue("WHATSAPP", "0996160389"))
      .toBe("https://wa.me/593996160389");
  });

  it("conserva y normaliza enlaces wa.me válidos", () => {
    expect(normalizeAdvertisingActionValue("WHATSAPP", "https://wa.me/593996160389"))
      .toBe("https://wa.me/593996160389");
  });

  it("rechaza texto que no representa un teléfono de WhatsApp", () => {
    expect(() => normalizeAdvertisingActionValue("WHATSAPP", "contacto"))
      .toThrow("INVALID_WHATSAPP_NUMBER");
  });

  it("agrega un mensaje inicial predeterminado al enlace público", () => {
    const result = composeAdvertisingActionValue("WHATSAPP", "0996160389");
    expect(new URL(result!).searchParams.get("text"))
      .toBe("Hola, vi su publicidad en Costa-Go y deseo más información.");
  });

  it("permite personalizar el mensaje inicial", () => {
    expect(normalizeAdvertisingActionMessage("WHATSAPP", "Hola, deseo reservar."))
      .toBe("Hola, deseo reservar.");
    const result = composeAdvertisingActionValue("WHATSAPP", "0996160389", "Hola, deseo reservar.");
    expect(new URL(result!).searchParams.get("text")).toBe("Hola, deseo reservar.");
  });
});
