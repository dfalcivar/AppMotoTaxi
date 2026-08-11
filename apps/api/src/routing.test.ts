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

  it("envía las paradas intermedias en el orden indicado", async () => {
    process.env.GOOGLE_MAPS_SERVER_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      routes: [{ distanceMeters: 2500, duration: "480s", polyline: { encodedPolyline: "" } }]
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await computeRoute(
      { latitude: -2.9, longitude: -79.0 },
      { latitude: -2.93, longitude: -79.03 },
      [
        { latitude: -2.91, longitude: -79.01 },
        { latitude: -2.92, longitude: -79.02 }
      ]
    );

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.intermediates).toEqual([
      { location: { latLng: { latitude: -2.91, longitude: -79.01 } } },
      { location: { latLng: { latitude: -2.92, longitude: -79.02 } } }
    ]);
  });

  it("solicita un route token solo para una sesiÃ³n de navegaciÃ³n", async () => {
    process.env.GOOGLE_MAPS_SERVER_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      routes: [{
        distanceMeters: 900,
        duration: "180s",
        polyline: { encodedPolyline: "" },
        routeToken: "encrypted-navigation-token"
      }]
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const route = await computeRoute(
      { latitude: -2.9, longitude: -79.0 },
      { latitude: -2.91, longitude: -79.01 },
      [],
      { includeRouteToken: true }
    );

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    const headers = request.headers as Record<string, string>;
    expect(body.routingPreference).toBe("TRAFFIC_AWARE");
    expect(headers["X-Goog-FieldMask"]).toContain("routes.routeToken");
    expect(route.routeToken).toBe("encrypted-navigation-token");
  });
});
