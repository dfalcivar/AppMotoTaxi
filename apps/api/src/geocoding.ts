interface FocusPoint {
  latitude: number;
  longitude: number;
}

interface GooglePlace {
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
}

interface GoogleGeocodeResult {
  formatted_address?: string;
  geometry?: { location?: { lat?: number; lng?: number } };
}

type Coordinate = [number, number];

interface NominatimItem {
  display_name: string;
  lat: string;
  lon: string;
  geojson?: { type?: string; coordinates?: unknown };
}

interface NominatimReverseItem extends NominatimItem {
  address?: Record<string, string | undefined>;
}

export interface LocationResult {
  label: string;
  latitude: number;
  longitude: number;
}

const headers = {
  "User-Agent": "MototaxiAtacamesMVP/0.2 (development contact: admin@mototaxi.local)",
  Accept: "application/json"
};

function googleMapsKey(): string | undefined {
  return process.env.GOOGLE_MAPS_SERVER_API_KEY?.trim() || undefined;
}

async function searchGooglePlaces(
  query: string,
  focus?: FocusPoint
): Promise<LocationResult[]> {
  const key = googleMapsKey();
  if (!key) return [];
  const body: Record<string, unknown> = {
    textQuery: query,
    languageCode: "es",
    regionCode: "EC",
    pageSize: 8
  };
  if (focus) {
    body.locationBias = {
      circle: {
        center: { latitude: focus.latitude, longitude: focus.longitude },
        radius: 50_000
      }
    };
  }
  const response = await fetch(
    "https://places.googleapis.com/v1/places:searchText",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask":
          "places.displayName,places.formattedAddress,places.location"
      },
      body: JSON.stringify(body)
    }
  );
  if (!response.ok) throw new Error("GOOGLE_PLACES_UNAVAILABLE");
  const payload = (await response.json()) as { places?: GooglePlace[] };
  return (payload.places ?? []).flatMap(place => {
    const latitude = place.location?.latitude;
    const longitude = place.location?.longitude;
    if (latitude == null || longitude == null) return [];
    const name = place.displayName?.text?.trim();
    const address = place.formattedAddress?.trim();
    return [{
      label: [name, address].filter(Boolean).join(" · ").slice(0, 200),
      latitude,
      longitude
    }];
  });
}

async function reverseGoogleLocation(point: FocusPoint): Promise<LocationResult> {
  const key = googleMapsKey();
  if (!key) throw new Error("GOOGLE_GEOCODING_NOT_CONFIGURED");
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("latlng", `${point.latitude},${point.longitude}`);
  url.searchParams.set("language", "es");
  url.searchParams.set("region", "ec");
  url.searchParams.set("key", key);
  const response = await fetch(url);
  if (!response.ok) throw new Error("GOOGLE_GEOCODING_UNAVAILABLE");
  const payload = (await response.json()) as {
    status?: string;
    results?: GoogleGeocodeResult[];
  };
  const result = payload.results?.[0];
  if (payload.status !== "OK" || !result?.formatted_address) {
    throw new Error("LOCATION_NOT_FOUND");
  }
  return {
    label: result.formatted_address.slice(0, 200),
    latitude: result.geometry?.location?.lat ?? point.latitude,
    longitude: result.geometry?.location?.lng ?? point.longitude
  };
}

function addViewbox(url: URL, focus?: FocusPoint, bounded = false): void {
  if (!focus) return;
  const radius = 0.09;
  url.searchParams.set("viewbox", [
    focus.longitude - radius,
    focus.latitude + radius,
    focus.longitude + radius,
    focus.latitude - radius
  ].join(","));
  url.searchParams.set("bounded", bounded ? "1" : "0");
}

function baseUrl(): URL {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "ec");
  return url;
}

function intersectionParts(query: string): [string, string] | undefined {
  const parts = query
    .split(/\s+(?:y|e|and|con|&)\s+|\s*\/\s*/iu)
    .map(value => value.trim())
    .filter(Boolean);
  if (parts.length !== 2 || parts.some(value => value.length < 2)) return;
  return [parts[0]!, parts[1]!];
}

function geometryCoordinates(item: NominatimItem): Coordinate[] {
  const geometry = item.geojson;
  if (!geometry?.coordinates) return [];
  if (geometry.type === "LineString") return geometry.coordinates as Coordinate[];
  if (geometry.type === "MultiLineString") return (geometry.coordinates as Coordinate[][]).flat();
  return [];
}

function distanceMeters(a: Coordinate, b: Coordinate): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(b[1] - a[1]);
  const longitudeDelta = radians(b[0] - a[0]);
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

async function streetGeometry(street: string, focus: FocusPoint): Promise<NominatimItem[]> {
  const url = baseUrl();
  url.searchParams.set("street", street);
  url.searchParams.set("limit", "12");
  url.searchParams.set("polygon_geojson", "1");
  addViewbox(url, focus, true);
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error("GEOCODER_UNAVAILABLE");
  return response.json() as Promise<NominatimItem[]>;
}

async function findIntersection(query: string, focus?: FocusPoint): Promise<LocationResult | undefined> {
  const parts = intersectionParts(query);
  if (!parts || !focus) return;
  const [firstItems, secondItems] = await Promise.all([
    streetGeometry(parts[0], focus),
    streetGeometry(parts[1], focus)
  ]);
  const first = firstItems.flatMap(geometryCoordinates);
  const second = secondItems.flatMap(geometryCoordinates);
  let best: { first: Coordinate; second: Coordinate; distance: number } | undefined;
  for (const a of first) {
    for (const b of second) {
      const distance = distanceMeters(a, b);
      if (!best || distance < best.distance) best = { first: a, second: b, distance };
    }
  }
  if (!best || best.distance > 80) return;
  return {
    label: `${parts[0]} y ${parts[1]}`,
    latitude: (best.first[1] + best.second[1]) / 2,
    longitude: (best.first[0] + best.second[0]) / 2
  };
}

export async function searchLocations(query: string, focus?: FocusPoint): Promise<LocationResult[]> {
  if (googleMapsKey()) {
    try {
      const places = await searchGooglePlaces(query, focus);
      if (places.length) return places;
    } catch {
      // Mantiene Nominatim como respaldo durante la transición a Google.
    }
  }
  const matchedIntersection = await findIntersection(query, focus);
  if (matchedIntersection) return [matchedIntersection];
  const url = baseUrl();
  url.searchParams.set("q", `${query}, Ecuador`);
  url.searchParams.set("limit", "8");
  addViewbox(url, focus);
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error("GEOCODER_UNAVAILABLE");
  const items = await response.json() as NominatimItem[];
  return items.map(item => ({
    label: item.display_name,
    latitude: Number(item.lat),
    longitude: Number(item.lon)
  }));
}

function reverseLabel(item: NominatimReverseItem): string {
  const address = item.address ?? {};
  const street = address.road ?? address.pedestrian ?? address.footway ?? address.neighbourhood ?? address.suburb;
  const streetAndNumber = [street, address.house_number].filter(Boolean).join(" ");
  const locality = address.city ?? address.town ?? address.village ?? address.municipality ?? address.county;
  const parts = [streetAndNumber, address.neighbourhood, address.suburb, locality, address.state]
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
  return (parts.length ? parts.join(", ") : item.display_name).slice(0, 200);
}

export async function reverseLocation(point: FocusPoint): Promise<LocationResult> {
  if (googleMapsKey()) {
    try {
      return await reverseGoogleLocation(point);
    } catch {
      // Mantiene Nominatim como respaldo durante la transición a Google.
    }
  }
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("zoom", "18");
  url.searchParams.set("lat", String(point.latitude));
  url.searchParams.set("lon", String(point.longitude));
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error("GEOCODER_UNAVAILABLE");
  const item = await response.json() as NominatimReverseItem;
  if (!item.display_name) throw new Error("LOCATION_NOT_FOUND");
  return {
    label: reverseLabel(item),
    latitude: Number(item.lat ?? point.latitude),
    longitude: Number(item.lon ?? point.longitude)
  };
}
