import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { database } from "./database.js";
import { sendPush } from "./push.js";

export type AdminRole = "ADMIN" | "SUPPORT";
export type SessionRole = "PASSENGER" | "DRIVER" | AdminRole;
type DriverStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "REJECTED";
type IncidentStatus = "OPEN" | "IN_REVIEW" | "RESOLVED";

export interface SessionUser { id?: string; email: string; name: string; role: SessionRole; sessionId?: string }
interface Driver { id: string; name: string; phone: string; vehicle: string; status: DriverStatus; documents: string; rating: number }
interface Passenger { id: string; name: string; phone: string; status: "ACTIVE" | "SUSPENDED"; trips: number; lastTrip: string }
interface PricingVersion { id: string; version: number; urbanDayCents: number; nightCents: number; extendedCents: number; promotionPassengers: number; promotionTotalCents: number; activeFrom: string; status: "ACTIVE" | "SCHEDULED" }
interface Zone { id: string; name: string; type: "URBAN" | "EXTENDED"; points: Array<{ x: number; y: number }>; active: boolean; version: number }
interface Incident { id: string; trip: string; category: string; description: string; status: IncidentStatus; assignedTo: string; createdAt: string }
interface AuditEntry { id: string; actor: string; action: string; entity: string; createdAt: string; detail: string }

const drivers: Driver[] = [
  { id: "DRV-001", name: "Carlos Mina", phone: "+593 99 410 2201", vehicle: "MT-014", status: "PENDING", documents: "4/4 vigentes", rating: 0 },
  { id: "DRV-002", name: "José Quiñónez", phone: "+593 98 224 1803", vehicle: "MT-008", status: "ACTIVE", documents: "4/4 vigentes", rating: 4.8 },
  { id: "DRV-003", name: "Luis Valencia", phone: "+593 96 885 7731", vehicle: "MT-021", status: "ACTIVE", documents: "3/4 · vence pronto", rating: 4.6 }
];
const passengers: Passenger[] = [
  { id: "PAS-001", name: "María Zambrano", phone: "+593 99 221 0901", status: "ACTIVE", trips: 12, lastTrip: "Hoy, 18:20" },
  { id: "PAS-002", name: "Ana Caicedo", phone: "+593 98 771 2034", status: "ACTIVE", trips: 7, lastTrip: "Ayer, 21:05" },
  { id: "PAS-003", name: "Pedro Angulo", phone: "+593 96 143 9082", status: "SUSPENDED", trips: 3, lastTrip: "24 jul, 10:40" }
];
const pricing: PricingVersion[] = [
  { id: "PRICE-1", version: 1, urbanDayCents: 50, nightCents: 100, extendedCents: 100, promotionPassengers: 3, promotionTotalCents: 100, activeFrom: "2026-07-27T00:00:00-05:00", status: "ACTIVE" }
];
const zones: Zone[] = [
  { id: "ZONE-URBAN-1", name: "Casco urbano Atacames", type: "URBAN", points: [{x:18,y:22},{x:76,y:16},{x:88,y:63},{x:48,y:84},{x:14,y:62}], active: true, version: 1 },
  { id: "ZONE-EXT-1", name: "Cobertura extendida", type: "EXTENDED", points: [{x:8,y:10},{x:92,y:8},{x:96,y:90},{x:10,y:92}], active: true, version: 1 }
];
const incidents: Incident[] = [
  { id: "INC-001", trip: "TRIP-1042", category: "Objeto olvidado", description: "Pasajera reporta una mochila azul.", status: "OPEN", assignedTo: "Soporte", createdAt: "2026-07-29T08:10:00-05:00" },
  { id: "INC-002", trip: "TRIP-1031", category: "Tarifa", description: "Consulta por regla nocturna.", status: "IN_REVIEW", assignedTo: "Administrador", createdAt: "2026-07-28T21:24:00-05:00" }
];
const audits: AuditEntry[] = [];

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
const driverSchema = z.object({ status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "REJECTED"]), reason: z.string().min(3), deunaEnabled: z.boolean().optional(), deunaQrImageUrl: z.string().url().optional().or(z.literal("")) });
const passengerSchema = z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]), reason: z.string().min(3) });
const pricingSchema = z.object({ urbanDayCents: z.number().int().nonnegative(), nightCents: z.number().int().nonnegative(), extendedCents: z.number().int().nonnegative(), promotionPassengers: z.number().int().positive(), promotionTotalCents: z.number().int().nonnegative(), activeFrom: z.string().min(10) });
const zoneSchema = z.object({ name: z.string().min(3), type: z.enum(["URBAN", "EXTENDED"]), points: z.array(z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) })).min(3) });
const incidentSchema = z.object({ status: z.enum(["OPEN", "IN_REVIEW", "RESOLVED"]), assignedTo: z.string().min(2) });
const adminTripActionSchema = z.object({ action: z.enum(["CANCEL"]), reason: z.string().trim().min(3).max(300) });
const operationalSettingsSchema = z.object({ searchRadiusMeters: z.number().int().min(500).max(20000) });
const bannerSchema = z.object({
  title: z.string().trim().min(3).max(120),
  placement: z.enum(["PASSENGER_HOME", "DRIVER_HOME"]),
  imageBase64: z.string().min(20),
  imageMime: z.enum(["image/jpeg", "image/png", "image/webp"]),
  targetUrl: z.string().url().optional().or(z.literal("")),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).optional().or(z.literal("")),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0)
}).refine(value => !value.endsAt || new Date(value.endsAt) > new Date(value.startsAt), {
  message: "INVALID_BANNER_DATES"
});
const bannerUpdateSchema = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  targetUrl: z.string().url().optional().or(z.literal("")),
  startsAt: z.string().datetime({ offset: true }).optional(),
  endsAt: z.string().datetime({ offset: true }).optional().or(z.literal("")),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional()
});

export function imageDimensions(image: Buffer, mime: string): { width: number; height: number } | undefined {
  if (mime === "image/png" && image.length >= 24 && image.subarray(1, 4).toString() === "PNG") {
    return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
  }
  if (mime === "image/jpeg" && image.length > 10 && image[0] === 0xff && image[1] === 0xd8) {
    let offset = 2;
    const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    while (offset + 8 < image.length) {
      if (image[offset] !== 0xff) return undefined;
      const marker = image[offset + 1]!;
      offset += 2;
      if (marker === 0xd8 || marker === 0xd9) continue;
      const length = image.readUInt16BE(offset);
      if (length < 2 || offset + length > image.length) return undefined;
      if (startOfFrame.has(marker)) return { width: image.readUInt16BE(offset + 5), height: image.readUInt16BE(offset + 3) };
      offset += length;
    }
  }
  if (mime === "image/webp" && image.length >= 30 && image.subarray(0, 4).toString() === "RIFF" && image.subarray(8, 12).toString() === "WEBP") {
    const chunk = image.subarray(12, 16).toString();
    if (chunk === "VP8X") return {
      width: image.readUIntLE(24, 3) + 1,
      height: image.readUIntLE(27, 3) + 1
    };
    if (chunk === "VP8 " && image.length >= 30) return {
      width: image.readUInt16LE(26) & 0x3fff,
      height: image.readUInt16LE(28) & 0x3fff
    };
    if (chunk === "VP8L" && image.length >= 25 && image[20] === 0x2f) {
      const bits = image.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
  }
  return undefined;
}

function zoneBoundaryWkt(points: Array<{ x: number; y: number }>): string {
  const coordinates = points.map(({ x, y }) => `${-79.858 + x * 0.0003} ${0.854 + y * 0.00024}`);
  coordinates.push(coordinates[0]!);
  return `POLYGON((${coordinates.join(",")}))`;
}

function secret() { return process.env.ADMIN_SESSION_SECRET ?? "local-development-secret-change-me"; }
function sign(value: string) { return createHmac("sha256", secret()).update(value).digest("base64url"); }
export function tokenFor(user: SessionUser) { const payload = Buffer.from(JSON.stringify(user)).toString("base64url"); return `${payload}.${sign(payload)}`; }
export function userFrom(request: FastifyRequest): SessionUser | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return;
  const [payload, signature] = header.slice(7).split(".");
  if (!payload || !signature) return;
  const expected = sign(payload);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return;
  try { return JSON.parse(Buffer.from(payload, "base64url").toString()) as SessionUser; } catch { return; }
}
function audit(user: SessionUser, action: string, entity: string, detail: string) {
  audits.unshift({ id: `AUD-${Date.now()}`, actor: user.email, action, entity, detail, createdAt: new Date().toISOString() });
}
async function persistAudit(user: SessionUser, action: string, entityType: string, entityId: string, detail: string) {
  audit(user, action, entityId, detail);
  if (!process.env.DATABASE_URL || !user.id) return;
  await database()`
    insert into audit_log (actor_id, action, entity_type, entity_id, next_value, reason)
    values (${user.id}, ${action}, ${entityType}, ${entityId}, ${JSON.stringify({ detail })}::jsonb, ${detail})
  `;
}
function requireUser(request: FastifyRequest) { const user = userFrom(request); if (!user) throw new Error("UNAUTHORIZED"); return user; }
function requireAdmin(request: FastifyRequest) { const user = requireUser(request); if (user.role !== "ADMIN") throw new Error("FORBIDDEN"); return user; }
function guardError(error: unknown, reply: any) { const message = error instanceof Error ? error.message : "ERROR"; if (message === "UNAUTHORIZED") return reply.code(401).send({ error: message }); if (message === "FORBIDDEN") return reply.code(403).send({ error: message }); throw error; }

export async function registerAdminRoutes(app: FastifyInstance, realtime?: {
  publishTripStatus(tripId: string, status: string): void;
}) {
  app.post("/v1/admin/session", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "INVALID_LOGIN" });
    if (process.env.DATABASE_URL) {
      const rows = await database()`
        select id, email, full_name, role
        from users
        where lower(email) = lower(${parsed.data.email})
          and password_hash = crypt(${parsed.data.password}, password_hash)
          and status = 'ACTIVE'
          and role in ('ADMIN', 'SUPPORT')
      `;
      const account = rows[0] as { id: string; email: string; full_name: string; role: AdminRole } | undefined;
      if (!account) return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
      const user: SessionUser = { id: account.id, email: account.email, name: account.full_name, role: account.role };
      audit(user, "LOGIN", "SESSION", "Inicio de sesión administrativo");
      return { token: tokenFor(user), user };
    }
    const adminEmail = process.env.ADMIN_EMAIL ?? "admin@mototaxi.local";
    const adminPassword = process.env.ADMIN_PASSWORD ?? "Mototaxi2026!";
    const supportEmail = process.env.SUPPORT_EMAIL ?? "soporte@mototaxi.local";
    const supportPassword = process.env.SUPPORT_PASSWORD ?? "Soporte2026!";
    let user: SessionUser | undefined;
    if (parsed.data.email === adminEmail && parsed.data.password === adminPassword) user = { email: adminEmail, name: "Administrador principal", role: "ADMIN" };
    if (parsed.data.email === supportEmail && parsed.data.password === supportPassword) user = { email: supportEmail, name: "Equipo de soporte", role: "SUPPORT" };
    if (!user) return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
    audit(user, "LOGIN", "SESSION", "Inicio de sesión administrativo");
    return { token: tokenFor(user), user };
  });

  app.get("/v1/admin/me", async (request, reply) => { try { return requireUser(request); } catch (e) { return guardError(e, reply); } });
  app.get("/v1/admin/dashboard", async (request, reply) => { try { requireUser(request); return { metrics: { activeTrips: 6, availableDrivers: drivers.filter(d => d.status === "ACTIVE").length, pendingDrivers: drivers.filter(d => d.status === "PENDING").length, openIncidents: incidents.filter(i => i.status !== "RESOLVED").length }, activeTrips: [
    { id: "TRIP-1048", passenger: "María Z.", driver: "José Q.", status: "IN_PROGRESS", zone: "URBAN", total: "$1,00", requestedAt: "19:42" },
    { id: "TRIP-1047", passenger: "Ana C.", driver: "Luis V.", status: "DRIVER_EN_ROUTE", zone: "EXTENDED", total: "$2,00", requestedAt: "19:38" },
    { id: "TRIP-1046", passenger: "Pedro A.", driver: "Sin asignar", status: "SEARCHING", zone: "URBAN", total: "$0,50", requestedAt: "19:36" }
  ]}; } catch(e) { return guardError(e, reply); } });
  app.get("/v1/admin/drivers", async (request, reply) => { try {
    requireUser(request);
    if (!process.env.DATABASE_URL) return drivers;
    return await database()`
      select u.id, u.full_name as name, u.phone_e164 as phone, coalesce(v.identifier, 'Sin vehículo') as vehicle,
        u.status, d.deuna_enabled as "deunaEnabled", d.deuna_qr_image_url as "deunaQrImageUrl", coalesce((select count(*)::text || '/' || count(*)::text || ' documentos' from driver_documents dd where dd.driver_id = d.user_id), '0/0 documentos') as documents,
        coalesce(d.rating, 0)::float8 as rating
      from drivers d
      join users u on u.id = d.user_id
      left join lateral (select identifier from vehicles where driver_id = d.user_id order by created_at desc limit 1) v on true
      order by u.created_at
    `;
  } catch(e) { return guardError(e, reply); } });
  app.patch("/v1/admin/drivers/:id", async (request, reply) => { try {
    const user=requireAdmin(request); const body=driverSchema.parse(request.body);
    if (!process.env.DATABASE_URL) { const item=drivers.find(d=>d.id===(request.params as any).id); if(!item)return reply.code(404).send({error:"NOT_FOUND"}); item.status=body.status; audit(user,"DRIVER_STATUS",item.id,body.reason); return item; }
    const id=(request.params as { id: string }).id;
    const rows=await database().begin(async tx=>{
      const updated=await tx`update users set status=${body.status}, updated_at=now() where id=${id} and role='DRIVER' returning id, full_name as name, phone_e164 as phone, status`;
      if(updated[0]) {
        await tx`
          update drivers
          set deuna_enabled=${body.deunaEnabled ?? false},
              deuna_qr_image_url=${body.deunaQrImageUrl || null},
              approval_note=${body.reason},
              approved_at=case when ${body.status}='ACTIVE' then now() else approved_at end,
              approved_by=case when ${body.status}='ACTIVE' then ${user.id!} else approved_by end
          where user_id=${id}
        `;
        await tx`update vehicles set status=${body.status} where driver_id=${id}`;
      }
      return updated;
    });
    const item=rows[0]; if(!item)return reply.code(404).send({error:"NOT_FOUND"});
    await persistAudit(user,"DRIVER_STATUS","DRIVER",id,body.reason);
    return item;
  } catch(e){ if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_DATA"}); return guardError(e,reply);} });
  app.get("/v1/admin/passengers", async (request, reply) => { try {
    requireUser(request);
    if (!process.env.DATABASE_URL) return passengers;
    return await database()`
      select u.id, u.full_name as name, u.phone_e164 as phone, u.status,
        count(t.id)::int as trips, max(t.requested_at)::text as "lastTrip"
      from users u left join trips t on t.passenger_id = u.id
      where u.role='PASSENGER'
      group by u.id order by u.created_at
    `;
  } catch(e){return guardError(e,reply);} });
  app.patch("/v1/admin/passengers/:id", async (request, reply) => { try {
    const user=requireAdmin(request); const body=passengerSchema.parse(request.body);
    if (!process.env.DATABASE_URL) { const item=passengers.find(p=>p.id===(request.params as any).id); if(!item)return reply.code(404).send({error:"NOT_FOUND"}); item.status=body.status; audit(user,"PASSENGER_STATUS",item.id,body.reason); return item; }
    const id=(request.params as { id: string }).id;
    const rows=await database()`update users set status=${body.status}, updated_at=now() where id=${id} and role='PASSENGER' returning id, full_name as name, phone_e164 as phone, status`;
    const item=rows[0]; if(!item)return reply.code(404).send({error:"NOT_FOUND"});
    await persistAudit(user,"PASSENGER_STATUS","PASSENGER",id,body.reason);
    return item;
  } catch(e){if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_DATA"});return guardError(e,reply);} });
  app.get("/v1/admin/pricing", async (request, reply) => { try {
    requireUser(request);
    if (!process.env.DATABASE_URL) return pricing;
    return await database()`
      select id::text, version,
        urban_day_cents_per_passenger as "urbanDayCents",
        night_cents_per_passenger as "nightCents",
        extended_cents_per_passenger as "extendedCents",
        group_promotion_passengers as "promotionPassengers",
        group_promotion_total_cents as "promotionTotalCents",
        active_from as "activeFrom",
        case when active_from > now() then 'SCHEDULED' else 'ACTIVE' end as status
      from pricing_versions order by version desc
    `;
  } catch(e){return guardError(e,reply);} });
  app.post("/v1/admin/pricing", async (request, reply) => { try { const user=requireAdmin(request); const body=pricingSchema.parse(request.body); const next:PricingVersion={id:`PRICE-${pricing.length+1}`,version:Math.max(...pricing.map(p=>p.version))+1,...body,status:new Date(body.activeFrom)>new Date()?"SCHEDULED":"ACTIVE"}; if(next.status==="ACTIVE")pricing.forEach(p=>p.status="SCHEDULED"); pricing.unshift(next); audit(user,"PRICING_PUBLISHED",next.id,`Versión ${next.version}`); return reply.code(201).send(next);}catch(e){if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_DATA"});return guardError(e,reply);} });
  app.get("/v1/admin/zones", async (request, reply) => { try {
    requireUser(request);
    if (!process.env.DATABASE_URL) return zones;
    return await database()`
      select id::text, name, zone_type as type, editor_points as points,
        is_active as active, version
      from service_zones where active_until is null
      order by zone_type, version desc
    `;
  } catch(e){return guardError(e,reply);} });
  app.post("/v1/admin/zones", async (request, reply) => { try { const user=requireAdmin(request); const body=zoneSchema.parse(request.body); const item:Zone={id:`ZONE-${Date.now()}`,...body,active:true,version:1}; zones.push(item); audit(user,"ZONE_CREATED",item.id,item.name); return reply.code(201).send(item);}catch(e){if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_DATA"});return guardError(e,reply);} });
  app.get("/v1/admin/incidents", async (request, reply) => { try {
    requireUser(request);
    if (!process.env.DATABASE_URL) return incidents;
    return await database()`
      select i.id::text, coalesce(i.trip_id::text, 'Sin viaje') as trip,
        i.category, i.description, i.status,
        coalesce(u.full_name, 'Sin asignar') as "assignedTo",
        i.created_at as "createdAt"
      from incidents i left join users u on u.id=i.assigned_to
      order by i.created_at desc
    `;
  } catch(e){return guardError(e,reply);} });
  app.patch("/v1/admin/incidents/:id", async (request, reply) => { try { const user=requireUser(request); const body=incidentSchema.parse(request.body); const item=incidents.find(i=>i.id===(request.params as any).id); if(!item)return reply.code(404).send({error:"NOT_FOUND"}); Object.assign(item,body); audit(user,"INCIDENT_UPDATED",item.id,body.status); return item;}catch(e){if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_DATA"});return guardError(e,reply);} });
  app.post("/v1/admin/pricing/persist", async (request, reply) => { try {
    const user = requireAdmin(request); const body = pricingSchema.parse(request.body);
    const next = await database().begin(async sql => {
      const [row] = await sql`select coalesce(max(version), 0) + 1 as version from pricing_versions`;
      const version = Number(row!.version);
      if (new Date(body.activeFrom) <= new Date()) await sql`update pricing_versions set active_until=now() where active_until is null and active_from <= now()`;
      const [item] = await sql`insert into pricing_versions (version, day_starts_at, night_starts_at, urban_day_cents_per_passenger, night_cents_per_passenger, extended_cents_per_passenger, group_promotion_enabled, group_promotion_passengers, group_promotion_total_cents, maximum_passengers, active_from, created_by) values (${version}, '06:00', '20:00', ${body.urbanDayCents}, ${body.nightCents}, ${body.extendedCents}, true, ${body.promotionPassengers}, ${body.promotionTotalCents}, 3, ${body.activeFrom}, ${user.id!}) returning id::text, version, urban_day_cents_per_passenger as "urbanDayCents", night_cents_per_passenger as "nightCents", extended_cents_per_passenger as "extendedCents", group_promotion_passengers as "promotionPassengers", group_promotion_total_cents as "promotionTotalCents", active_from as "activeFrom"`;
      return item!;
    });
    await persistAudit(user, "PRICING_PUBLISHED", "PRICING", next.id, `Version ${next.version}`);
    return reply.code(201).send({ ...next, status: new Date(next.activeFrom) > new Date() ? "SCHEDULED" : "ACTIVE" });
  } catch(e) { if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_DATA"}); return guardError(e,reply); } });
  app.post("/v1/admin/zones/persist", async (request, reply) => { try {
    const user = requireAdmin(request); const body = zoneSchema.parse(request.body); const wkt = zoneBoundaryWkt(body.points);
    const [item] = await database()`insert into service_zones (name, zone_type, boundary, version, active_from, created_by, editor_points) values (${body.name}, ${body.type}, ST_GeogFromText(${wkt}), 1, now(), ${user.id!}, ${JSON.stringify(body.points)}::jsonb) returning id::text, name, zone_type as type, editor_points as points, is_active as active, version`;
    await persistAudit(user, "ZONE_CREATED", "ZONE", item!.id, item!.name);
    return reply.code(201).send(item);
  } catch(e) { if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_DATA"}); return guardError(e,reply); } });
  app.patch("/v1/admin/incidents/:id/persist", async (request, reply) => { try {
    const user = requireUser(request); const body = incidentSchema.parse(request.body); const id = (request.params as { id: string }).id;
    const [item] = await database()`update incidents set status=${body.status}, assigned_to=(select id from users where full_name=${body.assignedTo} limit 1), updated_at=now(), resolved_at=case when ${body.status}='RESOLVED' then now() else null end where id=${id} returning id::text, status`;
    if (!item) return reply.code(404).send({ error: "NOT_FOUND" });
    await persistAudit(user, "INCIDENT_UPDATED", "INCIDENT", id, body.status);
    return item;
  } catch(e) { if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_DATA"}); return guardError(e,reply); } });
  app.get("/v1/admin/trips", async (request, reply) => { try {
    requireUser(request);
    if (!process.env.DATABASE_URL) return [];
    return await database()`
      select t.id::text, t.status, t.passengers, t.service_zone as zone,
        t.quoted_total_cents as "quotedTotalCents", t.requested_at as "requestedAt",
        passenger.full_name as passenger, coalesce(driver.full_name, 'Sin asignar') as driver,
        t.origin_reference as "originReference", t.destination_reference as "destinationReference"
      from trips t
      join users passenger on passenger.id=t.passenger_id
      left join users driver on driver.id=t.driver_id
      order by t.requested_at desc limit 100
    `;
  } catch(e) { return guardError(e, reply); } });
  app.get("/v1/admin/settings", async (request, reply) => { try {
    requireUser(request);
    const [settings] = await database()`select search_radius_meters as "searchRadiusMeters", updated_at as "updatedAt" from operational_settings where id=1`;
    return settings ?? { searchRadiusMeters: 3000 };
  } catch(e) { return guardError(e, reply); } });
  app.patch("/v1/admin/settings", async (request, reply) => { try {
    const user = requireAdmin(request);
    const body = operationalSettingsSchema.parse(request.body);
    const [settings] = await database()`
      insert into operational_settings (id, search_radius_meters, updated_at, updated_by)
      values (1, ${body.searchRadiusMeters}, now(), ${user.id!})
      on conflict (id) do update set search_radius_meters=excluded.search_radius_meters, updated_at=now(), updated_by=excluded.updated_by
      returning search_radius_meters as "searchRadiusMeters", updated_at as "updatedAt"
    `;
    await persistAudit(user, "OPERATIONAL_SETTINGS_UPDATED", "SETTINGS", "1", `Radio de búsqueda: ${body.searchRadiusMeters} metros`);
    return settings;
  } catch(e) { if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_DATA"}); return guardError(e,reply); } });
  app.get("/v1/admin/banners", async (request, reply) => { try {
    requireUser(request);
    if (!process.env.DATABASE_URL) return [];
    return await database()`
      select id::text, title, placement, target_url as "targetUrl", starts_at as "startsAt",
        ends_at as "endsAt", active, sort_order as "sortOrder", image_mime as "imageMime",
        octet_length(image_data) as "imageBytes", created_at as "createdAt", updated_at as "updatedAt"
      from affiliate_banners order by active desc, sort_order, starts_at desc
    `;
  } catch(e) { return guardError(e, reply); } });
  app.post("/v1/admin/banners", async (request, reply) => { try {
    const user = requireAdmin(request);
    if (!process.env.DATABASE_URL) return reply.code(503).send({ error: "DATABASE_UNAVAILABLE" });
    const body = bannerSchema.parse(request.body);
    const image = Buffer.from(body.imageBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
    if (!image.length || image.length > 1024 * 1024) return reply.code(400).send({ error: "INVALID_BANNER_IMAGE" });
    const dimensions = imageDimensions(image, body.imageMime);
    if (!dimensions || dimensions.width !== 1200 || dimensions.height !== 400) {
      return reply.code(400).send({ error: "INVALID_BANNER_DIMENSIONS", message: "El banner debe medir exactamente 1200×400 px." });
    }
    const [item] = await database()`
      insert into affiliate_banners
        (title, placement, image_mime, image_data, target_url, starts_at, ends_at, active, sort_order, created_by)
      values (${body.title}, ${body.placement}, ${body.imageMime}, ${image}, ${body.targetUrl || null},
        ${body.startsAt}, ${body.endsAt || null}, ${body.active}, ${body.sortOrder}, ${user.id!})
      returning id::text, title, placement, target_url as "targetUrl", starts_at as "startsAt",
        ends_at as "endsAt", active, sort_order as "sortOrder", image_mime as "imageMime",
        octet_length(image_data) as "imageBytes", created_at as "createdAt", updated_at as "updatedAt"
    `;
    if (!item) return reply.code(500).send({ error: "BANNER_NOT_CREATED" });
    await persistAudit(user, "BANNER_CREATED", "AFFILIATE_BANNER", String(item.id), body.title);
    return reply.code(201).send(item);
  } catch(e) { if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_DATA"}); return guardError(e,reply); } });
  app.patch("/v1/admin/banners/:id", async (request, reply) => { try {
    const user = requireAdmin(request);
    const body = bannerUpdateSchema.parse(request.body);
    const id = (request.params as { id: string }).id;
    const [current] = await database()`select * from affiliate_banners where id=${id}`;
    if (!current) return reply.code(404).send({ error: "NOT_FOUND" });
    const startsAt = body.startsAt ?? current.starts_at;
    const endsAt = body.endsAt === "" ? null : (body.endsAt ?? current.ends_at);
    if (endsAt && new Date(endsAt) <= new Date(startsAt)) return reply.code(400).send({ error: "INVALID_BANNER_DATES" });
    const [item] = await database()`
      update affiliate_banners set
        title=${body.title ?? current.title}, target_url=${body.targetUrl === "" ? null : (body.targetUrl ?? current.target_url)},
        starts_at=${startsAt}, ends_at=${endsAt}, active=${body.active ?? current.active},
        sort_order=${body.sortOrder ?? current.sort_order}, updated_at=now()
      where id=${id}
      returning id::text, title, placement, target_url as "targetUrl", starts_at as "startsAt",
        ends_at as "endsAt", active, sort_order as "sortOrder", image_mime as "imageMime",
        octet_length(image_data) as "imageBytes", created_at as "createdAt", updated_at as "updatedAt"
    `;
    await persistAudit(user, "BANNER_UPDATED", "AFFILIATE_BANNER", id, body.active === false ? "Banner desactivado" : "Banner actualizado");
    return item;
  } catch(e) { if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_DATA"}); return guardError(e,reply); } });
  app.post("/v1/admin/trips/:id/action", async (request, reply) => { try {
    const user = requireAdmin(request); const body = adminTripActionSchema.parse(request.body);
    if (!process.env.DATABASE_URL) return reply.code(503).send({ error: "DATABASE_UNAVAILABLE" });
    const id = (request.params as { id: string }).id;
    const trip = await database().begin(async tx => {
      const [current] = await tx`
        select id::text, passenger_id, driver_id, status
        from trips where id=${id} and status in ('SEARCHING','ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS')
        for update
      `;
      if (!current) return null;
      await tx`update trips set status='CANCELLED', cancelled_at=now() where id=${id}`;
      await tx`update driver_offers set responded_at=coalesce(responded_at, now()), accepted=coalesce(accepted, false) where trip_id=${id}`;
      if (current.driver_id) await tx`update drivers set is_available=true where user_id=${current.driver_id}`;
      await tx`insert into trip_events (trip_id, from_status, to_status, actor_id, reason_code, metadata) values (${id}, ${current.status}, 'CANCELLED', ${user.id!}, 'ADMIN_CANCELLED', ${JSON.stringify({ reason: body.reason })}::jsonb)`;
      return current;
    });
    if (!trip) return reply.code(409).send({ error: "TRIP_NOT_CANCELLABLE" });
    await persistAudit(user, "TRIP_CANCELLED", "TRIP", id, body.reason);
    void sendPush(String(trip.passenger_id), "Viaje cancelado por administración", body.reason, { tripId: id, type: "TRIP_CANCELLED", reason: "ADMIN_CANCELLED" }).catch(() => undefined);
    if (trip.driver_id) void sendPush(String(trip.driver_id), "Viaje cancelado por administración", body.reason, { tripId: id, type: "TRIP_CANCELLED", reason: "ADMIN_CANCELLED" }).catch(() => undefined);
    realtime?.publishTripStatus(id, "CANCELLED");
    return { id, status: "CANCELLED", cancellationReason: "ADMIN_CANCELLED" };
  } catch(e) { if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_DATA"}); return guardError(e,reply); } });
  app.get("/v1/admin/audit", async (request, reply) => { try {
    requireAdmin(request);
    if (!process.env.DATABASE_URL) return audits;
    return await database()`
      select a.id::text, coalesce(u.email, 'Sistema') as actor, a.action,
        a.entity_type || ':' || a.entity_id as entity, a.created_at as "createdAt",
        coalesce(a.reason, a.next_value->>'detail', '') as detail
      from audit_log a left join users u on u.id = a.actor_id
      order by a.created_at desc limit 200
    `;
  } catch(e){return guardError(e,reply);} });
  app.get("/v1/admin/database", async (request, reply) => { try { requireAdmin(request); const rows=await database()`select current_database() as database, version() as postgres_version, postgis_full_version() as postgis_version`; return { connected:true,...rows[0]}; } catch(error){ return reply.code(503).send({connected:false,message:error instanceof Error?error.message:"Base no disponible"}); } });
}
