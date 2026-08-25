import { describe, expect, it } from "vitest";
import { normalizeAdvertisingActionValue } from "./advertising-actions.js";

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
});

