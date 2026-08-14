import { describe, expect, it } from "vitest";
import { isStrongPassword, legacyPhoneAliases, normalizeEmail, normalizePhone } from "./auth-security.js";

describe("seguridad de autenticación", () => {
  it("normaliza correos y teléfonos ecuatorianos", () => {
    expect(normalizeEmail("  Usuario@GMAIL.com ")).toBe("usuario@gmail.com");
    expect(normalizePhone("099 123 4567")).toBe("+593991234567");
    expect(normalizePhone("593991234567")).toBe("+593991234567");
    expect(normalizePhone("+593991234567")).toBe("+593991234567");
    expect(normalizePhone("991234567")).toBe("+593991234567");
  });

  it("conserva números internacionales E.164 y rechaza números ambiguos", () => {
    expect(normalizePhone("+14155552671")).toBe("+14155552671");
    expect(normalizePhone("12345")).toBeNull();
  });

  it("detecta representaciones antiguas del mismo teléfono", () => {
    expect(legacyPhoneAliases("+593991234567")).toEqual(
      expect.arrayContaining(["+593991234567", "0991234567", "+0991234567", "593991234567"]),
    );
  });

  it("rechaza claves débiles y acepta una clave robusta", () => {
    expect(isStrongPassword("12345678")).toBe(false);
    expect(isStrongPassword("solocontrasena")).toBe(false);
    expect(isStrongPassword("CostaGo2026!")).toBe(true);
  });
});
