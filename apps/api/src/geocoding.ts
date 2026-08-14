interface FocusPoint {
  latitude: number;
  longitude: number;
}

export interface SearchBounds {
  west: number;
  south: number;
  east: number;
  north: number;
  label?: string;
}

interface GooglePlace {
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
}

interface OrsGeocodingFeature {
  geometry?: { coordinates?: unknown };
  properties?: {
    label?: string;
    name?: string;
    street?: string;
    housenumber?: string;
    locality?: string;
    region?: string;
  };
}

interface GoogleGeocodeResult {
  formatted_address?: string;
  types?: string[];
  address_components?: Array<{
    long_name?: string;
    short_name?: string;
    types?: string[];
  }>;
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
  "User-Agent": "CostaGo/0.10 (development contact: admin@mototaxi.local)",
  Accept: "application/json"
};

const leadingPlusCode = /^\s*[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}(?:\s*[,·-]\s*|\s+)/iu;

/** Keeps provider metadata internal while returning a readable UI label. */
export function cleanLocationLabel(value: string): string {
  return value.replace(leadingPlusCode, "").replace(/\s{2,}/gu, " ").trim();
}

function component(result: GoogleGeocodeResult, ...types: string[]): string | undefined {
  return result.address_components?.find(item =>
    types.some(type => item.types?.includes(type)))?.long_name?.trim();
}

/** Selects a human street/place label while keeping provider codes out of the UI. */
export function preciseGoogleAddress(results: GoogleGeocodeResult[]): string | undefined {
  const usable = results.filter(result =>
    result.formatted_address && !result.types?.includes("plus_code"));
  const score = (result: GoogleGeocodeResult) => {
    const types = result.types ?? [];
    if (types.includes("street_address")) return 100;
    if (types.includes("intersection")) return 95;
    if (types.includes("premise") || types.includes("subpremise")) return 90;
    if (types.includes("establishment") || types.includes("point_of_interest")) return 85;
    if (types.includes("route")) return 75;
    if (types.includes("neighborhood") || types.includes("sublocality")) return 40;
    if (types.includes("locality")) return 20;
    return 10;
  };
  const ranked = [...usable].sort((a, b) => score(b) - score(a));
  const best = ranked[0];
  if (!best) return;
  const locality = component(best, "locality", "postal_town", "administrative_area_level_2");
  const route = component(best, "route");
  const number = component(best, "street_number");
  const premise = component(best, "establishment", "point_of_interest", "premise");
  const types = best.types ?? [];
  if (types.includes("intersection")) {
    return cleanLocationLabel(best.formatted_address!);
  }
  if (route) {
    const street = [route, number].filter(Boolean).join(" ");
    return cleanLocationLabel([premise && premise !== route ? premise : null, street, locality]
      .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
      .join(", "));
  }
  if (premise && score(best) >= 85) {
    return cleanLocationLabel([premise, locality].filter(Boolean).join(", "));
  }
  return cleanLocationLabel(best.formatted_address!);
}

function googleMapsKey(): string | undefined {
  return process.env.GOOGLE_MAPS_SERVER_API_KEY?.trim() || undefined;
}

function openRouteServiceKey(): string | undefined {
  return process.env.ORS_API_KEY?.trim() || undefined;
}

export function googlePlacesSearchBody(
  query: string,
  focus?: FocusPoint,
  bounds?: SearchBounds
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    textQuery: query,
    languageCode: "es",
    regionCode: "EC",
    pageSize: placesSearchPageSize(bounds)
  };
  if (bounds) {
    body.locationRestriction = {
      rectangle: {
        low: { latitude: bounds.south, longitude: bounds.west },
        high: { latitude: bounds.north, longitude: bounds.east }
      }
    };
  } else if (focus) {
    body.locationBias = {
      circle: {
        center: { latitude: focus.latitude, longitude: focus.longitude },
        radius: 50_000
      }
    };
  }
  return body;
}

async function searchGooglePlaces(
  query: string,
  focus?: FocusPoint,
  bounds?: SearchBounds
): Promise<LocationResult[]> {
  const key = googleMapsKey();
  if (!key) return [];
  const body = googlePlacesSearchBody(query, focus, bounds);
  const response = await fetch(
    "https://places.googleapis.com/v1/places:searchText",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location,places.primaryType"
      },
      body: JSON.stringify(body)
    }
  );
  if (!response.ok) throw new Error(`GOOGLE_PLACES_${response.status}`);
  const payload = (await response.json()) as { places?: GooglePlace[] };
  return (payload.places ?? []).flatMap(place => {
    const latitude = place.location?.latitude;
    const longitude = place.location?.longitude;
    if (latitude == null || longitude == null) return [];
    const name = place.displayName?.text?.trim();
    const address = place.formattedAddress
      ? cleanLocationLabel(place.formattedAddress)
      : undefined;
    return [{
      label: cleanLocationLabel([name, address].filter(Boolean).join(" · ")).slice(0, 200),
      latitude,
      longitude
    }];
  });
}

export function openRouteServiceSearchUrl(
  query: string,
  focus?: FocusPoint
): URL {
  const url = new URL("https://api.openrouteservice.org/geocode/search");
  url.searchParams.set("text", query);
  url.searchParams.set("size", "12");
  url.searchParams.set("boundary.country", "ECU");
  url.searchParams.set("lang", "es");
  if (focus) {
    url.searchParams.set("focus.point.lat", String(focus.latitude));
    url.searchParams.set("focus.point.lon", String(focus.longitude));
  }
  return url;
}

async function searchOpenRouteService(
  query: string,
  focus?: FocusPoint
): Promise<LocationResult[]> {
  const key = openRouteServiceKey();
  if (!key) return [];
  const response = await fetch(openRouteServiceSearchUrl(query, focus), {
    headers: { Authorization: key, Accept: "application/json" }
  });
  if (!response.ok) throw new Error(`ORS_GEOCODING_${response.status}`);
  const payload = (await response.json()) as {
    features?: OrsGeocodingFeature[];
  };
  return (payload.features ?? []).flatMap(feature => {
    const coordinates = feature.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return [];
    const longitude = Number(coordinates[0]);
    const latitude = Number(coordinates[1]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
    const properties = feature.properties ?? {};
    const street = [properties.street, properties.housenumber]
      .filter(Boolean)
      .join(" ");
    const label = cleanLocationLabel(
      properties.label ??
        [properties.name, street, properties.locality, properties.region]
          .filter(Boolean)
          .join(", ")
    );
    if (!label) return [];
    return [{ label: label.slice(0, 200), latitude, longitude }];
  });
}

export function placesSearchPageSize(bounds?: SearchBounds): number {
  return bounds ? 20 : 8;
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
  const label = preciseGoogleAddress(payload.results ?? []);
  if (payload.status !== "OK" || !label) {
    throw new Error("LOCATION_NOT_FOUND");
  }
  return {
    label: label.slice(0, 200),
    // The label may be snapped to a road, but the selected point must remain exact.
    latitude: point.latitude,
    longitude: point.longitude
  };
}

function addViewbox(url: URL, focus?: FocusPoint, bounded = false, bounds?: SearchBounds): void {
  if (bounds) {
    url.searchParams.set("viewbox", [bounds.west, bounds.north, bounds.east, bounds.south].join(","));
    url.searchParams.set("bounded", "1");
    return;
  }
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

export async function searchLocations(query: string, focus?: FocusPoint, bounds?: SearchBounds): Promise<LocationResult[]> {
  const providerErrors: string[] = [];
  if (googleMapsKey()) {
    try {
      const places = await searchGooglePlaces(query, focus, bounds);
      if (places.length) return places;
    } catch (error) {
      providerErrors.push(error instanceof Error ? error.message : "GOOGLE_PLACES_UNKNOWN");
    }
  }
  if (openRouteServiceKey()) {
    try {
      const locations = await searchOpenRouteService(query, focus);
      if (locations.length) return locations;
    } catch (error) {
      providerErrors.push(error instanceof Error ? error.message : "ORS_GEOCODING_UNKNOWN");
    }
  }
  try {
    const matchedIntersection = await findIntersection(query, focus);
    if (matchedIntersection) return [matchedIntersection];
  } catch (error) {
    providerErrors.push(error instanceof Error ? error.message : "NOMINATIM_INTERSECTION_UNKNOWN");
  }
  try {
    const url = baseUrl();
    url.searchParams.set("q", `${query}, Ecuador`);
    url.searchParams.set("limit", "8");
    addViewbox(url, focus, Boolean(bounds), bounds);
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`NOMINATIM_${response.status}`);
    const items = await response.json() as NominatimItem[];
    return items.map(item => ({
      label: cleanLocationLabel(item.display_name),
      latitude: Number(item.lat),
      longitude: Number(item.lon)
    }));
  } catch (error) {
    providerErrors.push(error instanceof Error ? error.message : "NOMINATIM_UNKNOWN");
    throw new Error(`GEOCODER_PROVIDERS_FAILED:${providerErrors.join("|")}`);
  }
}

export async function searchLocationsInArea(
  query: string,
  focus: FocusPoint | undefined,
  bounds: SearchBounds
): Promise<LocationResult[]> {
  const areaLabel = bounds.label?.split(" - ")[0]?.trim();
  const contextualQuery = areaLabel
    ? `${query}, ${areaLabel}`
    : query;
  return searchLocations(contextualQuery, focus);
}

function reverseLabel(item: NominatimReverseItem): string {
  const address = item.address ?? {};
  const street = address.road ?? address.pedestrian ?? address.footway ?? address.neighbourhood ?? address.suburb;
  const streetAndNumber = [street, address.house_number].filter(Boolean).join(" ");
  const locality = address.city ?? address.town ?? address.village ?? address.municipality ?? address.county;
  const parts = [streetAndNumber, address.neighbourhood, address.suburb, locality, address.state]
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
  return cleanLocationLabel(parts.length ? parts.join(", ") : item.display_name).slice(0, 200);
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
    latitude: point.latitude,
    longitude: point.longitude
  };
}
