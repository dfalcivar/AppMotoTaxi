import { z } from "zod";
import { database } from "./database.js";

export interface CoordinatePoint {
  latitude: number;
  longitude: number;
}

export type ServiceAreaErrorCode =
  | "OUTSIDE_SERVICE_AREA"
  | "ORIGIN_OUTSIDE_SERVICE_AREA"
  | "DESTINATION_OUTSIDE_SERVICE_AREA"
  | "SERVICE_AREA_NOT_ALLOWED"
  | "SERVICE_AREA_DISABLED"
  | "DIFFERENT_SERVICE_AREAS";

export class ServiceAreaError extends Error {
  constructor(public readonly code: ServiceAreaErrorCode) {
    super(code);
  }
}

export interface ResolvedServiceArea {
  id: string;
  versionId: string;
  version: number;
  code: string;
  name: string;
  environment: "PRODUCTION" | "TEST";
  audience: "ALL" | "TESTERS" | "SPECIFIC_USERS" | "ROLES";
  allowInterZoneTrips: boolean;
}

export interface ValidatedTripArea extends ResolvedServiceArea {
  destinationAreas: ResolvedServiceArea[];
}

const coordinatePair = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90)
]);
const ring = z.array(coordinatePair).min(4).refine(value => {
  const first = value[0]!;
  const last = value.at(-1)!;
  return first[0] === last[0] && first[1] === last[1];
}, "GEOJSON_RING_MUST_BE_CLOSED");
const polygon = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(ring).min(1)
});
const multiPolygon = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z.array(z.array(ring).min(1)).min(1)
});

export const serviceAreaGeometrySchema = z.union([polygon, multiPolygon]);

export function appearsToHaveSwappedGeoJsonCoordinates(geometry: z.infer<typeof serviceAreaGeometrySchema>): boolean {
  const pairs = geometry.type === "Polygon" ? geometry.coordinates.flat() : geometry.coordinates.flat(2);
  if (!pairs.length) return false;
  // Detección defensiva para Ecuador: latitudes usadas como longitud y viceversa.
  return pairs.every(([longitude, latitude]) => longitude >= -6 && longitude <= 3 && latitude >= -82 && latitude <= -74);
}

export const serviceAreaPublishSchema = z.object({
  areaId: z.string().uuid().optional(),
  code: z.string().trim().regex(/^[A-Z0-9_]+$/).max(60),
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(500).optional().default(""),
  environment: z.enum(["PRODUCTION", "TEST"]),
  audience: z.enum(["ALL", "TESTERS", "SPECIFIC_USERS", "ROLES"]),
  enabled: z.boolean().default(false),
  allowInterZoneTrips: z.boolean().default(false),
  priority: z.number().int().min(-1000).max(1000).default(0),
  geometry: serviceAreaGeometrySchema.refine(value => !appearsToHaveSwappedGeoJsonCoordinates(value), "GEOJSON_COORDINATES_APPEAR_SWAPPED"),
  sourceName: z.string().trim().min(3).max(200),
  sourceUrl: z.string().url().max(1000).optional().or(z.literal("")),
  changeNote: z.string().trim().min(5).max(500)
  ,sourceType: z.enum(["MANUAL", "GEOJSON"]).default("MANUAL")
});

export const serviceAreaRoleSchema = z.object({
  roles: z.array(z.enum(["PASSENGER", "DRIVER"])).max(2)
});

export function serviceAreaRelationError(
  originAreaId: string,
  destinationAreaIds: string[],
  allowInterZoneTrips: boolean
): ServiceAreaErrorCode | undefined {
  return destinationAreaIds.some(id => id !== originAreaId) && !allowInterZoneTrips
    ? "DIFFERENT_SERVICE_AREAS"
    : undefined;
}

export async function resolveServiceArea(
  userId: string,
  point: CoordinatePoint,
  options: { includeDisabled?: boolean; requireAuthorization?: boolean } = {}
): Promise<ResolvedServiceArea | undefined> {
  const requireAuthorization = options.requireAuthorization ?? true;
  const [area] = await database()`
    select a.id::text, v.id::text as "versionId", v.version, a.code, a.name,
      a.environment, a.audience,
      a.allow_inter_zone_trips as "allowInterZoneTrips"
    from service_areas a
    join service_area_versions v on v.id=a.current_version_id
    where (${options.includeDisabled ?? false} or a.enabled)
      and ST_Covers(v.geometry, ST_SetSRID(ST_MakePoint(${point.longitude}, ${point.latitude}),4326))
      and (
        not ${requireAuthorization}
        or a.audience='ALL'
        or exists (
          select 1 from user_service_area_access access
          where access.user_id=${userId} and access.service_area_id=a.id
            and (access.expires_at is null or access.expires_at>now())
        )
        or (a.audience='ROLES' and exists (
          select 1 from service_area_role_access role_access
          join users account on account.id=${userId}
          where role_access.service_area_id=a.id and role_access.role=account.role::text
        ))
      )
    order by a.priority desc, ST_Area(v.geometry::geography), a.code
    limit 1
  `;
  return area as unknown as ResolvedServiceArea | undefined;
}

async function pointStatus(userId: string, point: CoordinatePoint) {
  const [row] = await database()`
    select a.id::text, a.enabled, a.audience,
      (a.audience='ALL' or exists (
        select 1 from user_service_area_access access
        where access.user_id=${userId} and access.service_area_id=a.id
          and (access.expires_at is null or access.expires_at>now())
      ) or (a.audience='ROLES' and exists (
        select 1 from service_area_role_access role_access
        join users account on account.id=${userId}
        where role_access.service_area_id=a.id and role_access.role=account.role::text
      ))) as allowed
    from service_areas a join service_area_versions v on v.id=a.current_version_id
    where ST_Covers(v.geometry, ST_SetSRID(ST_MakePoint(${point.longitude}, ${point.latitude}),4326))
    order by a.priority desc limit 1
  `;
  return row as { id: string; enabled: boolean; audience: string; allowed: boolean } | undefined;
}

export async function serviceAreaAccessError(
  userId: string,
  point: CoordinatePoint
): Promise<ServiceAreaErrorCode | undefined> {
  const status = await pointStatus(userId, point);
  if (!status) return "OUTSIDE_SERVICE_AREA";
  if (!status.enabled) return "SERVICE_AREA_DISABLED";
  if (!status.allowed) return "SERVICE_AREA_NOT_ALLOWED";
  return undefined;
}

async function resolveRequiredPoint(
  userId: string,
  point: CoordinatePoint,
  outsideCode: "ORIGIN_OUTSIDE_SERVICE_AREA" | "DESTINATION_OUTSIDE_SERVICE_AREA"
): Promise<ResolvedServiceArea> {
  const resolved = await resolveServiceArea(userId, point);
  if (resolved) return resolved;
  const status = await pointStatus(userId, point);
  if (!status) throw new ServiceAreaError(outsideCode);
  if (!status.enabled) throw new ServiceAreaError("SERVICE_AREA_DISABLED");
  if (!status.allowed) throw new ServiceAreaError("SERVICE_AREA_NOT_ALLOWED");
  throw new ServiceAreaError(outsideCode);
}

export async function validateTripServiceArea(
  userId: string,
  origin: CoordinatePoint,
  destinations: CoordinatePoint[]
): Promise<ValidatedTripArea> {
  const originArea = await resolveRequiredPoint(userId, origin, "ORIGIN_OUTSIDE_SERVICE_AREA");
  const destinationAreas = await Promise.all(destinations.map(point =>
    resolveRequiredPoint(userId, point, "DESTINATION_OUTSIDE_SERVICE_AREA")));
  const relationError = serviceAreaRelationError(originArea.id,
    destinationAreas.map(area => area.id), originArea.allowInterZoneTrips);
  if (relationError) throw new ServiceAreaError(relationError);
  return { ...originArea, destinationAreas };
}

export async function authorizedServiceAreas(userId: string, knownVersion?: number) {
  const [catalog] = await database()`select version::int, updated_at as "updatedAt" from service_area_catalog where id=1`;
  const version = Number(catalog?.version ?? 1);
  if (knownVersion === version) return { version, unchanged: true, areas: [] };
  const areas = await database()`
    select a.id::text, a.code, a.name, a.description, a.environment, a.audience,
      a.allow_inter_zone_trips as "allowInterZoneTrips", a.priority,
      v.id::text as "versionId", v.version,
      ST_AsGeoJSON(v.geometry, 6)::jsonb as geometry,
      jsonb_build_object(
        'west', ST_XMin(ST_Envelope(v.geometry)),
        'south', ST_YMin(ST_Envelope(v.geometry)),
        'east', ST_XMax(ST_Envelope(v.geometry)),
        'north', ST_YMax(ST_Envelope(v.geometry))
      ) as bounds
    from service_areas a join service_area_versions v on v.id=a.current_version_id
    where a.enabled and (
      a.audience='ALL' or exists (
        select 1 from user_service_area_access access
        where access.user_id=${userId} and access.service_area_id=a.id
          and (access.expires_at is null or access.expires_at>now())
      ) or (a.audience='ROLES' and exists (
        select 1 from service_area_role_access role_access
        join users account on account.id=${userId}
        where role_access.service_area_id=a.id and role_access.role=account.role::text
      ))
    ) order by a.priority desc, a.name
  `;
  return { version, unchanged: false, updatedAt: catalog?.updatedAt, areas };
}

export async function filterLocationsToArea(areaId: string, userId: string, locations: Array<CoordinatePoint>) {
  if (!locations.length) return [] as number[];
  const payload = JSON.stringify(locations.map((point, index) => ({ ...point, index })));
  const rows = await database()`
    select (point->>'index')::int as index
    from jsonb_array_elements(${payload}::jsonb) point
    join service_areas a on a.id=${areaId}::uuid and a.enabled
    join service_area_versions v on v.id=a.current_version_id
    where (a.audience='ALL' or exists (
      select 1 from user_service_area_access access
      where access.user_id=${userId} and access.service_area_id=a.id
        and (access.expires_at is null or access.expires_at>now())
    ) or (a.audience='ROLES' and exists (
      select 1 from service_area_role_access role_access
      join users account on account.id=${userId}
      where role_access.service_area_id=a.id and role_access.role=account.role::text
    ))) and ST_Covers(v.geometry, ST_SetSRID(ST_MakePoint(
      (point->>'longitude')::double precision,
      (point->>'latitude')::double precision
    ),4326))
  `;
  return rows.map(row => Number(row.index));
}

export async function serviceAreaBounds(areaId: string, userId: string) {
  const [row] = await database()`
    select ST_XMin(ST_Envelope(v.geometry)) west, ST_YMin(ST_Envelope(v.geometry)) south,
      ST_XMax(ST_Envelope(v.geometry)) east, ST_YMax(ST_Envelope(v.geometry)) north
    from service_areas a join service_area_versions v on v.id=a.current_version_id
    where a.id=${areaId}::uuid and a.enabled and (
      a.audience='ALL' or exists (
        select 1 from user_service_area_access access where access.user_id=${userId}
          and access.service_area_id=a.id and (access.expires_at is null or access.expires_at>now())
      ) or (a.audience='ROLES' and exists (
        select 1 from service_area_role_access role_access
        join users account on account.id=${userId}
        where role_access.service_area_id=a.id and role_access.role=account.role::text
      ))
    )
  `;
  return row as { west: number; south: number; east: number; north: number } | undefined;
}
