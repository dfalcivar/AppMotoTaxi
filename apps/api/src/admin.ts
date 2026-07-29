import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { database } from "./database.js";

export type AdminRole = "ADMIN" | "SUPPORT";
type DriverStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "REJECTED";
type IncidentStatus = "OPEN" | "IN_REVIEW" | "RESOLVED";

interface SessionUser { email: string; name: string; role: AdminRole }
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
const driverSchema = z.object({ status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "REJECTED"]), reason: z.string().min(3) });
const passengerSchema = z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]), reason: z.string().min(3) });
const pricingSchema = z.object({ urbanDayCents: z.number().int().nonnegative(), nightCents: z.number().int().nonnegative(), extendedCents: z.number().int().nonnegative(), promotionPassengers: z.number().int().positive(), promotionTotalCents: z.number().int().nonnegative(), activeFrom: z.string().min(10) });
const zoneSchema = z.object({ name: z.string().min(3), type: z.enum(["URBAN", "EXTENDED"]), points: z.array(z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) })).min(3) });
const incidentSchema = z.object({ status: z.enum(["OPEN", "IN_REVIEW", "RESOLVED"]), assignedTo: z.string().min(2) });

function secret() { return process.env.ADMIN_SESSION_SECRET ?? "local-development-secret-change-me"; }
function sign(value: string) { return createHmac("sha256", secret()).update(value).digest("base64url"); }
function tokenFor(user: SessionUser) { const payload = Buffer.from(JSON.stringify(user)).toString("base64url"); return `${payload}.${sign(payload)}`; }
function userFrom(request: FastifyRequest): SessionUser | undefined {
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
function requireUser(request: FastifyRequest) { const user = userFrom(request); if (!user) throw new Error("UNAUTHORIZED"); return user; }
function requireAdmin(request: FastifyRequest) { const user = requireUser(request); if (user.role !== "ADMIN") throw new Error("FORBIDDEN"); return user; }
function guardError(error: unknown, reply: any) { const message = error instanceof Error ? error.message : "ERROR"; if (message === "UNAUTHORIZED") return reply.code(401).send({ error: message }); if (message === "FORBIDDEN") return reply.code(403).send({ error: message }); throw error; }

export async function registerAdminRoutes(app: FastifyInstance) {
  app.post("/v1/admin/session", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "INVALID_LOGIN" });
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
  app.get("/v1/admin/drivers", async (request, reply) => { try { requireUser(request); return drivers; } catch(e) { return guardError(e, reply); } });
  app.patch("/v1/admin/drivers/:id", async (request, reply) => { try { const user=requireAdmin(request); const body=driverSchema.parse(request.body); const item=drivers.find(d=>d.id===(request.params as any).id); if(!item)return reply.code(404).send({error:"NOT_FOUND"}); item.status=body.status; audit(user,"DRIVER_STATUS",item.id,body.reason); return item; } catch(e){ if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_DATA"}); return guardError(e,reply);} });
  app.get("/v1/admin/passengers", async (request, reply) => { try { requireUser(request); return passengers; } catch(e){return guardError(e,reply);} });
  app.patch("/v1/admin/passengers/:id", async (request, reply) => { try { const user=requireAdmin(request); const body=passengerSchema.parse(request.body); const item=passengers.find(p=>p.id===(request.params as any).id); if(!item)return reply.code(404).send({error:"NOT_FOUND"}); item.status=body.status; audit(user,"PASSENGER_STATUS",item.id,body.reason); return item; } catch(e){if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_DATA"});return guardError(e,reply);} });
  app.get("/v1/admin/pricing", async (request, reply) => { try { requireUser(request); return pricing; } catch(e){return guardError(e,reply);} });
  app.post("/v1/admin/pricing", async (request, reply) => { try { const user=requireAdmin(request); const body=pricingSchema.parse(request.body); const next:PricingVersion={id:`PRICE-${pricing.length+1}`,version:Math.max(...pricing.map(p=>p.version))+1,...body,status:new Date(body.activeFrom)>new Date()?"SCHEDULED":"ACTIVE"}; if(next.status==="ACTIVE")pricing.forEach(p=>p.status="SCHEDULED"); pricing.unshift(next); audit(user,"PRICING_PUBLISHED",next.id,`Versión ${next.version}`); return reply.code(201).send(next);}catch(e){if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_DATA"});return guardError(e,reply);} });
  app.get("/v1/admin/zones", async (request, reply) => { try { requireUser(request); return zones; } catch(e){return guardError(e,reply);} });
  app.post("/v1/admin/zones", async (request, reply) => { try { const user=requireAdmin(request); const body=zoneSchema.parse(request.body); const item:Zone={id:`ZONE-${Date.now()}`,...body,active:true,version:1}; zones.push(item); audit(user,"ZONE_CREATED",item.id,item.name); return reply.code(201).send(item);}catch(e){if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_DATA"});return guardError(e,reply);} });
  app.get("/v1/admin/incidents", async (request, reply) => { try { requireUser(request); return incidents; } catch(e){return guardError(e,reply);} });
  app.patch("/v1/admin/incidents/:id", async (request, reply) => { try { const user=requireUser(request); const body=incidentSchema.parse(request.body); const item=incidents.find(i=>i.id===(request.params as any).id); if(!item)return reply.code(404).send({error:"NOT_FOUND"}); Object.assign(item,body); audit(user,"INCIDENT_UPDATED",item.id,body.status); return item;}catch(e){if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_DATA"});return guardError(e,reply);} });
  app.get("/v1/admin/audit", async (request, reply) => { try { requireAdmin(request); return audits; } catch(e){return guardError(e,reply);} });
  app.get("/v1/admin/database", async (request, reply) => { try { requireAdmin(request); const rows=await database()`select current_database() as database, version() as postgres_version, postgis_full_version() as postgis_version`; return { connected:true,...rows[0]}; } catch(error){ return reply.code(503).send({connected:false,message:error instanceof Error?error.message:"Base no disponible"}); } });
}