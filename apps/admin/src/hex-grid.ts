import type { Point, ServiceAreaGeometry } from "./service-area-map.js";

export type HexCell = {
  id: string;
  center: Point;
  ring: Point[];
};

export type HexGridStats = {
  total: number;
  selected: number;
  gaps: number;
  overlaps: number;
};

const EARTH_METERS_PER_DEGREE = 111_320;

function pointInRing(point: Point, ring: Point[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const intersects = yi > point[1] !== yj > point[1]
      && point[0] < ((xj - xi) * (point[1] - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point: Point, rings: Point[][]) {
  const outerRing = rings[0];
  if (!outerRing || !pointInRing(point, outerRing)) return false;
  return !rings.slice(1).some((hole) => pointInRing(point, hole));
}

export function pointInGeometry(point: Point, geometry?: ServiceAreaGeometry | null) {
  if (!geometry) return false;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some((polygon) => pointInPolygon(point, polygon));
}

function allPoints(geometry: ServiceAreaGeometry) {
  return (geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates).flat(2);
}

function closeRing(points: Point[]): Point[] {
  if (!points.length) return points;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return first[0] === last[0] && first[1] === last[1] ? points : [...points, first];
}

export function generateHexGrid(boundary: ServiceAreaGeometry, radiusMeters: number): HexCell[] {
  const points = allPoints(boundary);
  if (!points.length) return [];
  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const centerLat = (minLat + maxLat) / 2;
  const safeRadius = Math.min(5_000, Math.max(50, Number.isFinite(radiusMeters) ? radiusMeters : 250));
  const latRadius = safeRadius / EARTH_METERS_PER_DEGREE;
  const lngRadius = safeRadius / (EARTH_METERS_PER_DEGREE * Math.max(.2, Math.cos(centerLat * Math.PI / 180)));
  const rowStep = 1.5 * latRadius;
  const columnStep = Math.sqrt(3) * lngRadius;
  const cells: HexCell[] = [];
  let row = 0;
  for (let lat = minLat - latRadius; lat <= maxLat + latRadius; lat += rowStep, row++) {
    const offset = row % 2 ? columnStep / 2 : 0;
    let column = 0;
    for (let lng = minLng - lngRadius + offset; lng <= maxLng + lngRadius; lng += columnStep, column++) {
      const center: Point = [lng, lat];
      if (!pointInGeometry(center, boundary)) continue;
      const ring: Point[] = [];
      for (let side = 0; side < 6; side++) {
        const angle = (60 * side - 30) * Math.PI / 180;
        ring.push([lng + lngRadius * Math.cos(angle), lat + latRadius * Math.sin(angle)]);
      }
      cells.push({ id: `${row}:${column}`, center, ring: closeRing(ring) });
    }
  }
  return cells;
}

export function cellsToGeometry(cells: HexCell[]): ServiceAreaGeometry | null {
  if (!cells.length) return null;
  return { type: "MultiPolygon", coordinates: cells.map((cell) => [[...cell.ring]]) };
}
