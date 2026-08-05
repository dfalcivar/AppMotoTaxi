import { describe, expect, it } from "vitest";
import { cleanLocationLabel, preciseGoogleAddress } from "./geocoding.js";

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

describe("preciseGoogleAddress", () => {
  it("prioriza calle y numeracion sobre el resultado general de ciudad", () => {
    expect(preciseGoogleAddress([
      { formatted_address: "Cuenca, Ecuador", types: ["locality"] },
      {
        formatted_address: "4X2X+H56, Hermano Miguel 9-21, Cuenca, Ecuador",
        types: ["street_address"],
        address_components: [
          { long_name: "9-21", types: ["street_number"] },
          { long_name: "Hermano Miguel", types: ["route"] },
          { long_name: "Cuenca", types: ["locality"] }
        ]
      }
    ])).toBe("Hermano Miguel 9-21, Cuenca");
  });

  it("conserva una interseccion legible y elimina el Plus Code", () => {
    expect(preciseGoogleAddress([{
      formatted_address: "4X2X+H56, Hermano Miguel y Gran Colombia, Cuenca",
      types: ["intersection"]
    }])).toBe("Hermano Miguel y Gran Colombia, Cuenca");
  });
});
