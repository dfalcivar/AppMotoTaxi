import { afterEach, describe, expect, it, vi } from "vitest";
import { clearRouteCacheForTests, computeRoute, decodeGooglePolyline } from "./routing.js";

afterEach(() => {
  clearRouteCacheForTests();
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_MAPS_SERVER_API_KEY;
});

describe("rutas de Google", () => {
  it("decodifica una polilínea codificada", () => {
    expect(decodeGooglePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@"))
      .toEqual([
        { latitude: 38.5, longitude: -120.2 },
        { latitude: 40.7, longitude: -120.95 },
        { latitude: 43.252, longitude: -126.453 }
      ]);
  });

  it("reutiliza temporalmente una ruta y evita llamadas duplicadas", async () => {
    process.env.GOOGLE_MAPS_SERVER_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      routes: [{
        distanceMeters: 1250,
        duration: "240s",
        polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" }
      }]
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const origin = { latitude: -2.9, longitude: -79.0 };
    const destination = { latitude: -2.91, longitude: -79.01 };
    const first = await computeRoute(origin, destination);
    const second = await computeRoute(origin, destination);

    expect(first).toMatchObject({ provider: "GOOGLE", cacheHit: false });
    expect(second).toMatchObject({ provider: "GOOGLE", cacheHit: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
