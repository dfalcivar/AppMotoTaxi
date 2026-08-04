export interface RoutePoint {
  latitude: number;
  longitude: number;
}

export interface RouteResult {
  points: RoutePoint[];
  distanceMeters: number | null;
  durationSeconds: number | null;
}

export function decodeGooglePolyline(encoded: string): RoutePoint[] {
  const points: RoutePoint[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  while (index < encoded.length) {
    const decodeValue = (): number => {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index <= encoded.length);
      return result & 1 ? ~(result >> 1) : result >> 1;
    };
    latitude += decodeValue();
    longitude += decodeValue();
    points.push({ latitude: latitude / 1e5, longitude: longitude / 1e5 });
  }
  return points;
}

async function googleRoute(
  origin: RoutePoint,
  destination: RoutePoint,
  key: string
): Promise<RouteResult> {
  const response = await fetch(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask":
          "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline"
      },
      body: JSON.stringify({
        origin: { location: { latLng: origin } },
        destination: { location: { latLng: destination } },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
        polylineQuality: "OVERVIEW",
        languageCode: "es",
        units: "METRIC"
      })
    }
  );
  if (!response.ok) throw new Error("GOOGLE_ROUTING_UNAVAILABLE");
  const payload = (await response.json()) as {
    routes?: Array<{
      distanceMeters?: number;
      duration?: string;
      polyline?: { encodedPolyline?: string };
    }>;
  };
  const route = payload.routes?.[0];
  if (!route) throw new Error("GOOGLE_ROUTE_NOT_FOUND");
  return {
    points: route.polyline?.encodedPolyline
      ? decodeGooglePolyline(route.polyline.encodedPolyline)
      : [],
    distanceMeters: route.distanceMeters ?? null,
    durationSeconds: route.duration
      ? Number(route.duration.replace(/s$/, ""))
      : null
  };
}

async function openRouteServiceRoute(
  origin: RoutePoint,
  destination: RoutePoint,
  key: string
): Promise<RouteResult> {
  const response = await fetch(
    "https://api.openrouteservice.org/v2/directions/driving-car/geojson",
    {
      method: "POST",
      headers: { Authorization: key, "Content-Type": "application/json" },
      body: JSON.stringify({
        coordinates: [
          [origin.longitude, origin.latitude],
          [destination.longitude, destination.latitude]
        ]
      })
    }
  );
  if (!response.ok) throw new Error("ORS_ROUTING_UNAVAILABLE");
  const payload = (await response.json()) as {
    features?: Array<{
      geometry?: { coordinates?: number[][] };
      properties?: { summary?: { distance?: number; duration?: number } };
    }>;
  };
  const feature = payload.features?.[0];
  return {
    points:
      feature?.geometry?.coordinates?.map(([longitude, latitude]) => ({
        latitude: latitude!,
        longitude: longitude!
      })) ?? [],
    distanceMeters: feature?.properties?.summary?.distance ?? null,
    durationSeconds: feature?.properties?.summary?.duration ?? null
  };
}

export async function computeRoute(
  origin: RoutePoint,
  destination: RoutePoint
): Promise<RouteResult> {
  const googleKey = process.env.GOOGLE_MAPS_SERVER_API_KEY?.trim();
  if (googleKey) {
    try {
      return await googleRoute(origin, destination, googleKey);
    } catch {
      // OpenRouteService queda como respaldo durante la migración.
    }
  }
  const orsKey = process.env.ORS_API_KEY?.trim();
  if (orsKey) return openRouteServiceRoute(origin, destination, orsKey);
  throw new Error("ROUTING_NOT_CONFIGURED");
}
