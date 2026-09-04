import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanLocationLabel,
  googlePlacesSearchBody,
  openRouteServiceSearchUrl,
  placesSearchPageSize,
  preciseGoogleAddress,
  reverseLocation
} from "./geocoding.js";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_MAPS_SERVER_API_KEY;
});

describe("Google Places", () => {
  it("solicita más candidatos cuando luego se filtrarán con un polígono", () => {
    expect(placesSearchPageSize()).toBe(8);
    expect(placesSearchPageSize({ west: -80, south: 0.7, east: -79.7, north: 1 })).toBe(20);
  });

  it("prioriza la zona sin excluir comercios ni puntos de interÃ©s", () => {
    const body = googlePlacesSearchBody("CrossFit La Jaula", undefined, {
      west: -79.1, south: -3.0, east: -78.9, north: -2.8
    });
    expect(body).toMatchObject({
      textQuery: "CrossFit La Jaula",
      locationRestriction: { rectangle: expect.any(Object) }
    });
    expect(body).not.toHaveProperty("locationBias");
    expect(body).not.toHaveProperty("includedType");
  });
});

describe("OpenRouteService geocoding", () => {
  it("prioriza la ubicacion actual sin reemplazar el filtro por poligono", () => {
    const url = openRouteServiceSearchUrl("La Jaula", {
      latitude: -2.9,
      longitude: -79.0
    });
    expect(url.origin).toBe("https://api.openrouteservice.org");
    expect(url.searchParams.get("text")).toBe("La Jaula");
    expect(url.searchParams.get("boundary.country")).toBe("ECU");
    expect(url.searchParams.get("focus.point.lat")).toBe("-2.9");
    expect(url.searchParams.get("focus.point.lon")).toBe("-79");
  });
});

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

describe("Google Geocoding usage", () => {
  it("registra una sola solicitud real de geocodificación inversa", async () => {
    process.env.GOOGLE_MAPS_SERVER_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "OK",
      results: [{
        formatted_address: "Calle Larga 9-76, Cuenca",
        types: ["street_address"],
        address_components: [
          { long_name: "9-76", types: ["street_number"] },
          { long_name: "Calle Larga", types: ["route"] },
          { long_name: "Cuenca", types: ["locality"] }
        ]
      }]
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const usageRecorder = vi.fn();

    const result = await reverseLocation(
      { latitude: -2.9, longitude: -79.0 },
      usageRecorder
    );

    expect(result.label).toBe("Calle Larga 9-76, Cuenca");
    expect(usageRecorder).toHaveBeenCalledTimes(1);
    expect(usageRecorder).toHaveBeenCalledWith(expect.objectContaining({
      provider: "GEOCODING",
      result: "SUCCESS",
      metadata: expect.objectContaining({ operation: "REVERSE", httpStatus: 200 })
    }));
  });
});
