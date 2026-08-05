import { describe, expect, it } from "vitest";
import { cleanLocationLabel } from "./geocoding.js";

describe("cleanLocationLabel", () => {
  it("elimina Plus Codes al inicio de una dirección", () => {
    expect(cleanLocationLabel("4X2X+H56, Hermano Miguel 9-21, Cuenca"))
      .toBe("Hermano Miguel 9-21, Cuenca");
    expect(cleanLocationLabel("7QJQ4X2X+H56 Simón Bolívar 596, Cuenca"))
      .toBe("Simón Bolívar 596, Cuenca");
  });

  it("conserva códigos o números que forman parte de una dirección normal", () => {
    expect(cleanLocationLabel("Calle 4X, Casa 56"))
      .toBe("Calle 4X, Casa 56");
  });
});
