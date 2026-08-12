import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { database } from "./database.js";
import {
  adminRoles,
  allPermissions,
  hasPermission,
  isAdminRole,
  permissionsForRole,
  rolePermissions,
  type AdminRole,
  type Permission,
  type PermissionOverride
} from "./permissions.js";
import { sendPush } from "./push.js";
import { dashboardFilters } from "./dashboard-filters.js";
import { dashboardAnalytics, driverDashboardProfile } from "./dashboard-analytics.js";
import { serviceAreaPublishSchema, serviceAreaRoleSchema } from "./service-areas.js";

export type { AdminRole, Permission } from "./permissions.js";
export type SessionRole = "PASSENGER" | "DRIVER" | AdminRole;
type DriverStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "REJECTED";
type IncidentStatus = "NUEVO" | "ASIGNADO" | "EN_REVISION" | "ESPERANDO_USUARIO" | "RESUELTO" | "CERRADO";

export interface SessionUser {
  id?: string;
  email: string;
  name: string;
  role: SessionRole;
  sessionId?: string;
  mustChangePassword?: boolean;
  driverApprovalStatus?: string;
  permissions?: Permission[];
  cooperativeId?: string;
  expiresAt?: number;
}
interface Driver { id: string; name: string; email?: string; phone: string; vehicle: string; status: DriverStatus; documents: string; rating: number }
interface Passenger { id: string; name: string; email?: string; phone: string; status: "ACTIVE" | "SUSPENDED"; trips: number; lastTrip: string }
interface PricingVersion { id: string; version: number; urbanDayCents: number; nightCents: number; extendedCents: number; stopSurchargeCents: number; promotionPassengers: number; promotionTotalCents: number; activeFrom: string; activeUntil?: string; status: "ACTIVE" | "SCHEDULED" | "FINALIZED" }
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
  { id: "PRICE-1", version: 1, urbanDayCents: 50, nightCents: 100, extendedCents: 100, stopSurchargeCents: 0, promotionPassengers: 3, promotionTotalCents: 100, activeFrom: "2026-07-27T00:00:00-05:00", status: "ACTIVE" }
];
const incidents: Incident[] = [
  { id: "INC-001", trip: "TRIP-1042", category: "Objeto olvidado", description: "Pasajera reporta una mochila azul.", status: "NUEVO", assignedTo: "Soporte", createdAt: "2026-07-29T08:10:00-05:00" },
  { id: "INC-002", trip: "TRIP-1031", category: "Tarifa", description: "Consulta por regla nocturna.", status: "EN_REVISION", assignedTo: "Administrador", createdAt: "2026-07-28T21:24:00-05:00" }
];
const audits: AuditEntry[] = [];

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
const driverSchema = z.object({ status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "REJECTED"]), reason: z.string().min(3), deunaEnabled: z.boolean().optional(), deunaQrImageUrl: z.string().url().optional().or(z.literal("")), cooperativeId: z.string().uuid().nullable().optional() });
const approvalDecisionSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT", "OBSERVE", "REQUEST_CORRECTIONS", "SUSPEND"]),
  observation: z.string().trim().max(1000).optional().default("")
}).superRefine((value, context) => {
  if (value.decision !== "APPROVE" && value.observation.length < 5) {
    context.addIssue({ code: "custom", path: ["observation"], message: "OBSERVATION_REQUIRED" });
  }
});
const approvalSettingsSchema = z.object({
  adminEmails: z.array(z.string().email()).max(20),
  emailEnabled: z.boolean(), internalEnabled: z.boolean(), pushEnabled: z.boolean()
});
const passengerSchema = z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]), reason: z.string().min(3) });
const passwordResetSchema = z.object({ password: z.string().min(8).max(100) });
const documentReviewSchema = z.object({
  status: z.enum(["ACTIVE", "REJECTED"]),
  note: z.string().trim().min(3).max(300)
});
const adminDocumentSchema = z.object({
  documentType: z.enum(["PROFILE_PHOTO", "IDENTIFICATION", "LICENSE", "REGISTRATION", "OPERATING_PERMIT"]),
  fileBase64: z.string().min(100).max(3_500_000),
  fileMime: z.enum(["image/jpeg", "image/png", "image/webp"]),
  expiresAt: z.string().date().optional().or(z.literal(""))
});

function decodeAdminImage(value: z.infer<typeof adminDocumentSchema>): Buffer {
  const data = Buffer.from(value.fileBase64, "base64");
  const jpeg = data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const png = data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP";
  if (data.length > 2_500_000 || !(value.fileMime === "image/jpeg" ? jpeg : value.fileMime === "image/png" ? png : webp)) {
    throw new Error("INVALID_IMAGE_FILE");
  }
  return data;
}
const pricingSchema = z.object({ urbanDayCents: z.number().int().nonnegative(), nightCents: z.number().int().nonnegative(), extendedCents: z.number().int().nonnegative(), stopSurchargeCents: z.number().int().nonnegative(), promotionPassengers: z.number().int().positive(), promotionTotalCents: z.number().int().nonnegative(), activeFrom: z.string().min(10) });
const serviceAreaStatusSchema = z.object({ enabled: z.boolean() });
const serviceAreaAccessSchema = z.object({ userId: z.string().uuid(), expiresAt: z.string().datetime({ offset: true }).nullable().optional() });
const serviceAreaValidationSchema = z.object({
  geometry: serviceAreaPublishSchema.shape.geometry,
  excludeAreaId: z.string().uuid().optional()
});
const incidentSchema = z.object({
  status: z.enum(["NUEVO", "ASIGNADO", "EN_REVISION", "ESPERANDO_USUARIO", "RESUELTO", "CERRADO"]),
  assignToSelf: z.boolean().default(false),
  response: z.string().trim().max(4000).optional().default(""),
  internalNote: z.string().trim().max(4000).optional().default(""),
  resolutionNote: z.string().trim().max(4000).optional().default("")
});
const faqSchema = z.object({
  category: z.string().trim().min(2).max(80),
  question: z.string().trim().min(5).max(300),
  answer: z.string().trim().min(10).max(4000),
  audiences: z.array(z.enum(["PASSENGER", "DRIVER"])).min(1).max(2),
  sortOrder: z.number().int().min(0).max(10000),
  active: z.boolean()
});
const adminTripActionSchema = z.object({ action: z.enum(["CANCEL"]), reason: z.string().trim().min(3).max(300) });
const operationalSettingsSchema = z.object({
  searchRadiusMeters: z.number().int().min(500).max(20000),
  scheduledTripLeadMinutes: z.number().int().min(5).max(60),
  scheduledTripMinimumNoticeMinutes: z.number().int().min(5).max(720),
  documentExpiryAlertDays: z.number().int().min(1).max(180)
}).refine(value => value.scheduledTripMinimumNoticeMinutes >= value.scheduledTripLeadMinutes + 5, {
  message: "MINIMUM_NOTICE_MUST_EXCEED_ACTIVATION_LEAD",
  path: ["scheduledTripMinimumNoticeMinutes"]
});
const cooperativeSchema = z.object({
  name: z.string().trim().min(3).max(120),
  legalName: z.string().trim().max(160).optional().or(z.literal("")),
  registrationNumber: z.string().trim().max(60).optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().trim().max(24).optional().or(z.literal("")),
  status: z.enum(["ACTIVE", "SUSPENDED", "INACTIVE"]).default("ACTIVE")
});
const cooperativeUpdateSchema = cooperativeSchema.partial();
const adminAccessSchema = z.object({
  role: z.enum(adminRoles),
  cooperativeId: z.string().uuid().nullable().optional(),
  overrides: z.array(z.object({
    permission: z.enum(allPermissions),
    allowed: z.boolean()
  })).max(allPermissions.length).default([])
}).refine(value => value.role !== "ANALISTA_COOPERATIVA" || Boolean(value.cooperativeId), {
  message: "COOPERATIVE_REQUIRED_FOR_ANALYST"
});
const adminUserCreateSchema = z.object({
  fullName: z.string().trim().min(3).max(120),
  email: z.string().email(),
  phone: z.string().trim().min(8).max(24),
  password: z.string().min(8).max(100),
  role: z.enum(["SUPER_ADMIN", "ADMIN_OPERACIONES", "SOPORTE", "ANALISTA_COOPERATIVA"]),
  cooperativeId: z.string().uuid().nullable().optional()
}).refine(value => value.role !== "ANALISTA_COOPERATIVA" || Boolean(value.cooperativeId), {
  message: "COOPERATIVE_REQUIRED_FOR_ANALYST"
});
const bannerSchema = z.object({
  title: z.string().trim().min(3).max(120),
  placement: z.enum(["PASSENGER_HOME", "DRIVER_HOME"]),
  imageBase64: z.string().min(20),
  imageMime: z.enum(["image/jpeg", "image/png", "image/webp"]),
  targetUrl: z.string().url().optional().or(z.literal("")),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0)
}).refine(value => !value.endsAt || new Date(value.endsAt) > new Date(value.startsAt), {
  message: "INVALID_BANNER_DATES"
});
const bannerUpdateSchema = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  imageBase64: z.string().min(20).optional(),
  imageMime: z.enum(["image/jpeg", "image/png", "image/webp"]).optional(),
  targetUrl: z.string().url().optional().or(z.literal("")),
  startsAt: z.string().datetime({ offset: true }).optional(),
  endsAt: z.string().datetime({ offset: true }).optional().or(z.literal("")),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional()
}).refine(value => Boolean(value.imageBase64) === Boolean(value.imageMime), {
  message: "INVALID_BANNER_IMAGE"
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
  try {
    const user = JSON.parse(Buffer.from(payload, "base64url").toString()) as SessionUser;
    if (user.expiresAt && user.expiresAt <= Date.now()) return;
    return user;
  } catch { return; }
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
function requireAdminSession(request: FastifyRequest): SessionUser & { role: AdminRole } {
  const user = requireUser(request);
  if (!isAdminRole(user.role)) throw new Error("FORBIDDEN");
  if (user.role === "ANALISTA_COOPERATIVA" && !user.cooperativeId) {
    throw new Error("COOPERATIVE_SCOPE_REQUIRED");
  }
  return user as SessionUser & { role: AdminRole };
}
function requirePermission(request: FastifyRequest, permission: Permission) {
  const user = requireAdminSession(request);
  if (!hasPermission(user.role, permission, user.permissions)) throw new Error("FORBIDDEN");
  return user;
}
function guardError(error: unknown, reply: any) { const message = error instanceof Error ? error.message : "ERROR"; if (message === "UNAUTHORIZED") return reply.code(401).send({ error: message }); if (message === "FORBIDDEN" || message === "COOPERATIVE_SCOPE_REQUIRED") return reply.code(403).send({ error: message }); throw error; }

export async function registerAdminRoutes(app: FastifyInstance, realtime?: {
  publishTripStatus(tripId: string, status: string): void;
}) {
  app.post("/v1/admin/session", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "INVALID_LOGIN" });
    if (process.env.DATABASE_URL) {
      const rows = await database()`
        select id, email, full_name, role, cooperative_id::text as "cooperativeId"
        from users
        where lower(email) = lower(${parsed.data.email})
          and password_hash = crypt(${parsed.data.password}, password_hash)
          and status = 'ACTIVE'
          and role in ('ADMIN', 'SUPPORT', 'SUPER_ADMIN', 'ADMIN_OPERACIONES', 'SOPORTE', 'ANALISTA_COOPERATIVA')
      `;
      const account = rows[0] as { id: string; email: string; full_name: string; role: AdminRole; cooperativeId?: string } | undefined;
      if (!account) return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
      const overrides = await database()`
        select permission, allowed
        from admin_permission_overrides
        where user_id=${account.id}
      ` as unknown as PermissionOverride[];
      const user: SessionUser = {
        id: account.id,
        email: account.email,
        name: account.full_name,
        role: account.role,
        cooperativeId: account.cooperativeId,
        permissions: permissionsForRole(account.role, overrides),
        expiresAt: Date.now() + 8 * 60 * 60 * 1000
      };
      audit(user, "LOGIN", "SESSION", "Inicio de sesión administrativo");
      return { token: tokenFor(user), user };
    }
    const adminEmail = process.env.ADMIN_EMAIL ?? "admin@mototaxi.local";
    const adminPassword = process.env.ADMIN_PASSWORD ?? "Mototaxi2026!";
    const supportEmail = process.env.SUPPORT_EMAIL ?? "soporte@mototaxi.local";
    const supportPassword = process.env.SUPPORT_PASSWORD ?? "Soporte2026!";
    let user: SessionUser | undefined;
    if (parsed.data.email === adminEmail && parsed.data.password === adminPassword) user = { email: adminEmail, name: "Administrador principal", role: "ADMIN", permissions: permissionsForRole("ADMIN"), expiresAt: Date.now() + 8 * 60 * 60 * 1000 };
    if (parsed.data.email === supportEmail && parsed.data.password === supportPassword) user = { email: supportEmail, name: "Equipo de soporte", role: "SUPPORT", permissions: permissionsForRole("SUPPORT"), expiresAt: Date.now() + 8 * 60 * 60 * 1000 };
    if (!user) return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
    audit(user, "LOGIN", "SESSION", "Inicio de sesión administrativo");
    return { token: tokenFor(user), user };
  });

  app.get("/v1/admin/me", async (request, reply) => { try { return requireAdminSession(request); } catch (e) { return guardError(e, reply); } });
  app.get("/v1/admin/access/roles", async (request, reply) => { try {
    requirePermission(request, "roles:manage");
    return adminRoles.map(role => ({ role, permissions: rolePermissions[role] }));
  } catch (e) { return guardError(e, reply); } });
  app.get("/v1/admin/access/users", async (request, reply) => { try {
    requirePermission(request, "roles:manage");
    if (!process.env.DATABASE_URL) return [];
    return await database()`
      select u.id::text, u.full_name as name, u.email, u.role,
        u.cooperative_id::text as "cooperativeId", c.name as "cooperativeName",
        coalesce(jsonb_agg(jsonb_build_object('permission', permission.permission, 'allowed', permission.allowed))
          filter (where permission.permission is not null), '[]'::jsonb) as overrides
      from users u
      left join cooperatives c on c.id=u.cooperative_id
      left join admin_permission_overrides permission on permission.user_id=u.id
      where u.role in ('ADMIN', 'SUPPORT', 'SUPER_ADMIN', 'ADMIN_OPERACIONES', 'SOPORTE', 'ANALISTA_COOPERATIVA')
      group by u.id, c.name
      order by u.created_at
    `;
  } catch (e) { return guardError(e, reply); } });
  app.post("/v1/admin/access/users", async (request, reply) => { try {
    const actor = requirePermission(request, "roles:manage");
    const body = adminUserCreateSchema.parse(request.body);
    if (!process.env.DATABASE_URL) return reply.code(503).send({ error: "DATABASE_UNAVAILABLE" });
    const normalizedPhone = body.phone.startsWith("+") ? body.phone : `+${body.phone}`;
    const [account] = await database()`
      insert into users
        (phone_e164, full_name, email, password_hash, role, status,
          cooperative_id, phone_verified_at, terms_accepted_at)
      values (${normalizedPhone}, ${body.fullName}, ${body.email.toLowerCase()},
        crypt(${body.password}, gen_salt('bf')), ${body.role}, 'ACTIVE',
        ${body.cooperativeId ?? null}, now(), now())
      returning id::text, full_name as name, email, role,
        cooperative_id::text as "cooperativeId"
    `;
    await persistAudit(actor, "ADMIN_USER_CREATED", "USER", String(account!.id),
      `Rol ${body.role}`);
    return reply.code(201).send(account);
  } catch (e) {
    if (e instanceof z.ZodError) return reply.code(400).send({ error: "INVALID_ADMIN_USER", details: e.issues });
    return guardError(e, reply);
  } });
  app.patch("/v1/admin/access/users/:id", async (request, reply) => { try {
    const actor = requirePermission(request, "roles:manage");
    const body = adminAccessSchema.parse(request.body);
    if (!process.env.DATABASE_URL) return reply.code(503).send({ error: "DATABASE_UNAVAILABLE" });
    const id = (request.params as { id: string }).id;
    const updated = await database().begin(async tx => {
      const [current] = await tx`select id::text, role from users where id=${id} for update`;
      if (!current || !isAdminRole(String(current.role))) return null;
      if ((current.role === "ADMIN" || current.role === "SUPER_ADMIN") &&
          body.role !== "ADMIN" && body.role !== "SUPER_ADMIN") {
        const [remaining] = await tx`
          select count(*)::int as total from users
          where id<>${id} and status='ACTIVE' and role in ('ADMIN', 'SUPER_ADMIN')
        `;
        if (Number(remaining?.total ?? 0) === 0) throw new Error("LAST_SUPER_ADMIN");
      }
      const [account] = await tx`
        update users set role=${body.role}, cooperative_id=${body.cooperativeId ?? null},
          active_session_id=null, updated_at=now()
        where id=${id}
        returning id::text, full_name as name, email, role, cooperative_id::text as "cooperativeId"
      `;
      await tx`delete from admin_permission_overrides where user_id=${id}`;
      for (const override of body.overrides) {
        await tx`
          insert into admin_permission_overrides (user_id, permission, allowed, granted_by)
          values (${id}, ${override.permission}, ${override.allowed}, ${actor.id ?? null})
        `;
      }
      return account;
    });
    if (!updated) return reply.code(404).send({ error: "NOT_FOUND" });
    await persistAudit(actor, "ADMIN_ACCESS_UPDATED", "USER", id,
      `Rol ${body.role}; cooperativa ${body.cooperativeId ?? "sin alcance"}`);
    return { ...updated, permissions: permissionsForRole(body.role, body.overrides) };
  } catch (e) {
    if (e instanceof z.ZodError) return reply.code(400).send({ error: "INVALID_ACCESS_CONFIGURATION", details: e.issues });
    if (e instanceof Error && e.message === "LAST_SUPER_ADMIN") return reply.code(409).send({ error: e.message });
    return guardError(e, reply);
  } });
  app.get("/v1/admin/cooperatives", async (request, reply) => { try {
    requirePermission(request, "cooperatives:view");
    if (!process.env.DATABASE_URL) return [];
    return await database()`
      select c.id::text, c.name, c.legal_name as "legalName",
        c.registration_number as "registrationNumber", c.email,
        c.phone_e164 as phone, c.status, c.created_at as "createdAt",
        count(distinct driver.id)::int as drivers
      from cooperatives c
      left join users driver on driver.cooperative_id=c.id and driver.role='DRIVER'
      group by c.id order by c.name
    `;
  } catch (e) { return guardError(e, reply); } });
  app.post("/v1/admin/cooperatives", async (request, reply) => { try {
    const actor = requirePermission(request, "cooperatives:manage");
    const body = cooperativeSchema.parse(request.body);
    if (!process.env.DATABASE_URL) return reply.code(503).send({ error: "DATABASE_UNAVAILABLE" });
    const [item] = await database()`
      insert into cooperatives
        (name, legal_name, registration_number, email, phone_e164, status, created_by)
      values (${body.name}, ${body.legalName || null}, ${body.registrationNumber || null},
        ${body.email || null}, ${body.phone || null}, ${body.status}, ${actor.id ?? null})
      returning id::text, name, legal_name as "legalName",
        registration_number as "registrationNumber", email, phone_e164 as phone, status
    `;
    await persistAudit(actor, "COOPERATIVE_CREATED", "COOPERATIVE", String(item!.id), body.name);
    return reply.code(201).send(item);
  } catch (e) { if (e instanceof z.ZodError) return reply.code(400).send({ error: "INVALID_COOPERATIVE" }); return guardError(e, reply); } });
  app.patch("/v1/admin/cooperatives/:id", async (request, reply) => { try {
    const actor = requirePermission(request, "cooperatives:manage");
    const body = cooperativeUpdateSchema.parse(request.body);
    const id = (request.params as { id: string }).id;
    if (!process.env.DATABASE_URL) return reply.code(503).send({ error: "DATABASE_UNAVAILABLE" });
    const [current] = await database()`select * from cooperatives where id=${id}`;
    if (!current) return reply.code(404).send({ error: "NOT_FOUND" });
    const [item] = await database()`
      update cooperatives set name=${body.name ?? current.name},
        legal_name=${body.legalName === "" ? null : (body.legalName ?? current.legal_name)},
        registration_number=${body.registrationNumber === "" ? null : (body.registrationNumber ?? current.registration_number)},
        email=${body.email === "" ? null : (body.email ?? current.email)},
        phone_e164=${body.phone === "" ? null : (body.phone ?? current.phone_e164)},
        status=${body.status ?? current.status}, updated_at=now()
      where id=${id}
      returning id::text, name, legal_name as "legalName",
        registration_number as "registrationNumber", email, phone_e164 as phone, status
    `;
    await persistAudit(actor, "COOPERATIVE_UPDATED", "COOPERATIVE", id, item!.name);
    return item;
  } catch (e) { if (e instanceof z.ZodError) return reply.code(400).send({ error: "INVALID_COOPERATIVE" }); return guardError(e, reply); } });
  app.get("/v1/admin/cooperative-dashboard/summary", async (request, reply) => { try {
    const user = requirePermission(request, "cooperative_dashboard:view");
    const cooperativeId = user.cooperativeId!;
    if (!process.env.DATABASE_URL) return reply.code(503).send({ error: "DATABASE_UNAVAILABLE" });
    const [summary] = await database()`
      select c.id::text as "cooperativeId", c.name as cooperative,
        count(t.id)::int as "totalTrips",
        count(t.id) filter (where t.status='COMPLETED')::int as "completedTrips",
        count(t.id) filter (where t.status='CANCELLED')::int as "cancelledTrips",
        count(distinct t.passenger_id)::int as "passengersServed",
        (select count(*)::int from users driver join drivers d on d.user_id=driver.id
          where driver.cooperative_id=c.id and driver.role='DRIVER' and driver.status='ACTIVE') as "activeDrivers"
      from cooperatives c
      left join trips t on t.cooperative_id=c.id
      where c.id=${cooperativeId}
      group by c.id
    `;
    if (!summary) return reply.code(404).send({ error: "COOPERATIVE_NOT_FOUND" });
    return summary;
  } catch (e) { return guardError(e, reply); } });
  app.post("/v1/admin/users/:id/reset-password", async (request, reply) => { try {
    const user = requirePermission(request, "users:manage");
    const body = passwordResetSchema.parse(request.body);
    const id = (request.params as { id: string }).id;
    if (!process.env.DATABASE_URL) {
      const account = drivers.find(item => item.id === id) ?? passengers.find(item => item.id === id);
      if (!account) return reply.code(404).send({ error: "NOT_FOUND" });
      await persistAudit(user, "USER_PASSWORD_RESET", "USER", id, "Contraseña restablecida y sesiones cerradas");
      return { ok: true, sessionsRevoked: true };
    }
    const account = await database().begin(async tx => {
      const [updated] = await tx`
        update users
        set password_hash=crypt(${body.password}, gen_salt('bf')),
            active_session_id=null,
            must_change_password=true,
            updated_at=now()
        where id=${id} and role in ('PASSENGER','DRIVER')
        returning id::text, role
      `;
      if (updated) await tx`delete from device_tokens where user_id=${id}`;
      return updated;
    });
    if (!account) return reply.code(404).send({ error: "NOT_FOUND" });
    await persistAudit(user, "USER_PASSWORD_RESET", "USER", id, "Contraseña restablecida y sesiones cerradas");
    return { ok: true, sessionsRevoked: true };
  } catch(e) {
    if (e instanceof z.ZodError) return reply.code(400).send({ error: "INVALID_PASSWORD", message: "La contraseña debe tener entre 8 y 100 caracteres." });
    return guardError(e, reply);
  } });
  app.get("/v1/admin/dashboard", async (request, reply) => { try {
    requirePermission(request, "dashboard:view");
    const filters = dashboardFilters(request.query);
    if (!process.env.DATABASE_URL) return reply.code(503).send({ error: "DATABASE_UNAVAILABLE" });
    return await dashboardAnalytics(filters);
  } catch(e) {
    if (e instanceof z.ZodError) return reply.code(400).send({ error: "INVALID_DASHBOARD_FILTERS", details: e.issues });
    return guardError(e, reply);
  } });
  app.get("/v1/admin/dashboard/drivers/:id", async (request, reply) => { try {
    requirePermission(request, "dashboard:view");
    const filters = dashboardFilters(request.query);
    if (!process.env.DATABASE_URL) return reply.code(503).send({ error: "DATABASE_UNAVAILABLE" });
    const profile = await driverDashboardProfile(filters, (request.params as { id: string }).id);
    if (!profile) return reply.code(404).send({ error: "DRIVER_NOT_FOUND" });
    return profile;
  } catch(e) {
    if (e instanceof z.ZodError) return reply.code(400).send({ error: "INVALID_DASHBOARD_FILTERS", details: e.issues });
    return guardError(e, reply);
  } });
  app.get("/v1/admin/operations", async (request, reply) => { try {
    requirePermission(request, "operations:view");
    if (!process.env.DATABASE_URL) return reply.code(503).send({ error: "DATABASE_UNAVAILABLE" });
    const sql = database();
    const [metricsRows, activeTrips, driverLocations, upcomingTrips, criticalIncidents] = await Promise.all([
      sql`select
        (select count(*)::int from trips where status in ('ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS')) as "activeTrips",
        (select count(*)::int from trips where status='SEARCHING') as "searchingTrips",
        (select count(*)::int from trips where status='SEARCHING' and requested_at < now() - interval '2 minutes') as "delayedRequests",
        (select count(*)::int from trips where scheduled_for between now() and now() + interval '2 hours' and status not in ('COMPLETED','CANCELLED')) as "upcomingScheduled",
        (select count(*)::int from drivers d join users u on u.id=d.user_id where u.status='ACTIVE' and d.last_location_at >= now() - interval '5 minutes') as "connectedDrivers",
        (select count(*)::int from drivers d join users u on u.id=d.user_id where u.status='ACTIVE' and d.is_available=true) as "availableDrivers",
        (select count(distinct driver_id)::int from trips where driver_id is not null and status in ('ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS')) as "busyDrivers",
        (select count(*)::int from incidents where priority='CRITICA' and status not in ('RESUELTO','CERRADO')) as "criticalIncidents"`,
      sql`select t.id::text, t.status, t.requested_at as "requestedAt", t.scheduled_for as "scheduledFor",
        passenger.full_name as passenger, coalesce(driver.full_name,'Sin conductor') as driver,
        t.origin_reference as origin, t.destination_reference as destination,
        st_y(t.origin::geometry)::double precision as "originLatitude",
        st_x(t.origin::geometry)::double precision as "originLongitude",
        case when d.last_location is null then null else st_y(d.last_location::geometry)::double precision end as "driverLatitude",
        case when d.last_location is null then null else st_x(d.last_location::geometry)::double precision end as "driverLongitude",
        extract(epoch from (now()-t.requested_at))::int as "ageSeconds"
        from trips t join users passenger on passenger.id=t.passenger_id
        left join users driver on driver.id=t.driver_id left join drivers d on d.user_id=t.driver_id
        where t.status in ('SEARCHING','ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS')
        order by case when t.status='SEARCHING' then 0 else 1 end, t.requested_at limit 60`,
      sql`select d.user_id::text as id, u.full_name as name, d.is_available as available,
        d.last_location_at as "lastLocationAt", d.approval_status as "approvalStatus",
        st_y(d.last_location::geometry)::double precision as latitude,
        st_x(d.last_location::geometry)::double precision as longitude,
        exists(select 1 from trips t where t.driver_id=d.user_id and t.status in ('ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS')) as busy
        from drivers d join users u on u.id=d.user_id
        where u.status='ACTIVE' and d.last_location is not null and d.last_location_at >= now() - interval '30 minutes'
        order by d.last_location_at desc limit 100`,
      sql`select t.id::text, t.scheduled_for as "scheduledFor", t.schedule_status as "scheduleStatus",
        passenger.full_name as passenger, coalesce(driver.full_name,'Sin conductor') as driver,
        t.origin_reference as origin, t.destination_reference as destination
        from trips t join users passenger on passenger.id=t.passenger_id left join users driver on driver.id=t.driver_id
        where t.scheduled_for between now() and now()+interval '2 hours' and t.status not in ('COMPLETED','CANCELLED')
        order by t.scheduled_for limit 30`,
      sql`select i.id::text, i.subject, i.category, i.status, i.priority, i.created_at as "createdAt",
        reporter.full_name as reporter
        from incidents i left join users reporter on reporter.id=i.reported_by
        where i.priority='CRITICA' and i.status not in ('RESUELTO','CERRADO')
        order by i.created_at limit 30`
    ]);
    return { metrics: metricsRows[0], activeTrips, driverLocations, upcomingTrips, criticalIncidents, updatedAt: new Date().toISOString() };
  } catch(e) { return guardError(e, reply); } });
  app.get("/v1/admin/alerts", async (request, reply) => { try {
    requirePermission(request, "alerts:view");
    if (!process.env.DATABASE_URL) return reply.code(503).send({ error: "DATABASE_UNAVAILABLE" });
    const sql = database();
    const [settings] = await sql`select document_expiry_alert_days as "documentExpiryAlertDays" from operational_settings where id=1`;
    const expiryDays = Number(settings?.documentExpiryAlertDays ?? 30);
    const [pendingDrivers, expiringDocuments, delayedTrips, unassignedScheduled, criticalIncidents, cancellationDrivers, suspendedDrivers, usersWithoutPush] = await Promise.all([
      sql`select d.user_id::text as id, u.full_name as name, d.approval_status as status, d.approval_updated_at as "createdAt"
        from drivers d join users u on u.id=d.user_id
        where d.approval_status in ('PENDIENTE_REVISION','OBSERVADO') order by d.approval_updated_at limit 30`,
      sql`select dd.id::text, dd.document_type as "documentType", dd.expires_at as "expiresAt", u.full_name as driver,
        dd.driver_id::text as "driverId", greatest(0,dd.expires_at-current_date)::int as "daysRemaining"
        from driver_documents dd join users u on u.id=dd.driver_id
        where dd.expires_at is not null and dd.status<>'SUSPENDED' and dd.expires_at <= current_date + (${expiryDays} * interval '1 day')
        order by dd.expires_at limit 50`,
      sql`select t.id::text, passenger.full_name as passenger, t.requested_at as "createdAt",
        extract(epoch from(now()-t.requested_at))::int as "ageSeconds"
        from trips t join users passenger on passenger.id=t.passenger_id
        where t.status='SEARCHING' and t.requested_at < now()-interval '2 minutes' order by t.requested_at limit 30`,
      sql`select t.id::text, passenger.full_name as passenger, t.scheduled_for as "scheduledFor"
        from trips t join users passenger on passenger.id=t.passenger_id
        where t.scheduled_for between now() and now()+interval '24 hours' and t.driver_id is null and t.status not in ('COMPLETED','CANCELLED')
        order by t.scheduled_for limit 30`,
      sql`select i.id::text, i.subject, i.category, i.created_at as "createdAt"
        from incidents i where i.priority='CRITICA' and i.status not in ('RESUELTO','CERRADO') order by i.created_at limit 30`,
      sql`select u.id::text, u.full_name as driver, count(*)::int as total,
        count(*) filter(where t.status='CANCELLED')::int as cancelled,
        round(100.0*count(*) filter(where t.status='CANCELLED')/nullif(count(*),0),1)::float as "cancellationRate"
        from trips t join users u on u.id=t.driver_id where t.requested_at >= now()-interval '30 days'
        group by u.id,u.full_name having count(*)>=5 and count(*) filter(where t.status='CANCELLED')::numeric/count(*) >= .3
        order by "cancellationRate" desc limit 20`,
      sql`select d.user_id::text as id,u.full_name as driver,d.approval_updated_at as "createdAt"
        from drivers d join users u on u.id=d.user_id where d.approval_status='SUSPENDIDO' order by d.approval_updated_at desc limit 20`,
      sql`select count(*)::int as count from users u where u.role in ('DRIVER','PASSENGER') and u.status='ACTIVE'
        and not exists(select 1 from device_tokens dt where dt.user_id=u.id and dt.last_seen_at >= now()-interval '30 days')`
    ]);
    const alerts = [
      ...pendingDrivers.map(item => ({ id:`DRIVER-${item.id}`, type:"DRIVER_PENDING", severity:"WARNING", title:"Conductor pendiente de revisión", detail:`${item.name} requiere una decisión administrativa.`, createdAt:item.createdAt, entityType:"DRIVER", entityId:item.id })),
      ...expiringDocuments.map(item => ({ id:`DOCUMENT-${item.id}`, type:"DOCUMENT_EXPIRY", severity:Number(item.daysRemaining)===0?"CRITICAL":"WARNING", title:Number(item.daysRemaining)===0?"Documento vencido":"Documento próximo a vencer", detail:`${item.documentType} de ${item.driver}: ${item.daysRemaining} días restantes.`, createdAt:item.expiresAt, entityType:"DRIVER", entityId:item.driverId })),
      ...delayedTrips.map(item => ({ id:`DELAY-${item.id}`, type:"TRIP_DELAYED", severity:"CRITICAL", title:"Solicitud sin aceptar", detail:`${item.passenger} espera hace ${Math.ceil(Number(item.ageSeconds)/60)} minutos.`, createdAt:item.createdAt, entityType:"TRIP", entityId:item.id })),
      ...unassignedScheduled.map(item => ({ id:`SCHEDULED-${item.id}`, type:"SCHEDULED_UNASSIGNED", severity:"WARNING", title:"Viaje programado sin conductor", detail:`${item.passenger} · ${new Date(item.scheduledFor).toLocaleString("es-EC",{timeZone:"America/Guayaquil"})}`, createdAt:item.scheduledFor, entityType:"TRIP", entityId:item.id })),
      ...criticalIncidents.map(item => ({ id:`INCIDENT-${item.id}`, type:"CRITICAL_INCIDENT", severity:"CRITICAL", title:"Incidente crítico", detail:`${item.subject ?? item.category}`, createdAt:item.createdAt, entityType:"INCIDENT", entityId:item.id })),
      ...cancellationDrivers.map(item => ({ id:`CANCELLATION-${item.id}`, type:"HIGH_CANCELLATION", severity:"WARNING", title:"Cancelación elevada", detail:`${item.driver}: ${item.cancellationRate}% en ${item.total} viajes.`, createdAt:new Date().toISOString(), entityType:"DRIVER", entityId:item.id })),
      ...suspendedDrivers.map(item => ({ id:`SUSPENDED-${item.id}`, type:"DRIVER_SUSPENDED", severity:"INFO", title:"Conductor suspendido", detail:item.driver, createdAt:item.createdAt, entityType:"DRIVER", entityId:item.id }))
    ];
    const withoutPush = Number(usersWithoutPush[0]?.count ?? 0);
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) alerts.unshift({ id:"PUSH-CONFIG", type:"PUSH_CONFIGURATION", severity:"CRITICAL", title:"Notificaciones push sin configurar", detail:"La API no tiene una cuenta de servicio de Firebase utilizable.", createdAt:new Date().toISOString(), entityType:"SYSTEM", entityId:"push" });
    else if (withoutPush > 0) alerts.push({ id:"PUSH-TOKENS", type:"PUSH_TOKENS", severity:"INFO", title:"Dispositivos sin registro push reciente", detail:`${withoutPush} usuarios activos no tienen un token actualizado en los últimos 30 días.`, createdAt:new Date().toISOString(), entityType:"SYSTEM", entityId:"push-tokens" });
    const severityOrder: Record<string,number> = { CRITICAL:0, WARNING:1, INFO:2 };
    alerts.sort((a,b) => (severityOrder[a.severity] ?? 3)-(severityOrder[b.severity] ?? 3) || new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());
    return { alerts: alerts.slice(0,100), documentExpiryAlertDays: expiryDays, updatedAt: new Date().toISOString() };
  } catch(e) { return guardError(e, reply); } });
  app.get("/v1/admin/drivers", async (request, reply) => { try {
    requirePermission(request, "drivers:view");
    if (!process.env.DATABASE_URL) return drivers;
    return await database()`
      select u.id, u.full_name as name, u.email, u.phone_e164 as phone, coalesce(v.identifier, 'Sin vehículo') as vehicle,
        u.status, d.deuna_enabled as "deunaEnabled", d.deuna_qr_image_url as "deunaQrImageUrl", coalesce((select count(*)::text || '/5 documentos' from driver_documents dd where dd.driver_id = d.user_id and dd.status<>'SUSPENDED'), '0/5 documentos') as documents,
        coalesce(d.rating, 0)::float8 as rating, (u.profile_photo_data is not null) as "hasPhoto",
        encode(u.profile_photo_data,'base64') as "profilePhotoBase64", u.profile_photo_mime as "profilePhotoMime",
        u.cooperative_id::text as "cooperativeId", c.name as "cooperativeName",
        d.approval_status as "approvalStatus", d.approval_observation as "approvalObservation",
        d.submitted_for_review_at as "submittedForReviewAt", u.created_at as "createdAt",
        (select count(*)::int from driver_documents dd where dd.driver_id=d.user_id and dd.status='ACTIVE') as "approvedDocuments",
        (select count(*)::int from driver_documents dd where dd.driver_id=d.user_id and dd.status<>'SUSPENDED') as "uploadedDocuments"
      from drivers d
      join users u on u.id = d.user_id
      left join cooperatives c on c.id=u.cooperative_id
      left join lateral (select identifier from vehicles where driver_id = d.user_id order by created_at desc limit 1) v on true
      order by u.created_at
    `;
  } catch(e) { return guardError(e, reply); } });
  app.get("/v1/admin/driver-approvals", async (request, reply) => { try {
    requirePermission(request, "drivers:approve");
    if (!process.env.DATABASE_URL) return [];
    return database()`
      select u.id::text, u.full_name name, u.email, u.phone_e164 phone,
        encode(u.profile_photo_data,'base64') as "profilePhotoBase64", u.profile_photo_mime as "profilePhotoMime",
        coalesce(c.name,'Sin cooperativa') cooperative, v.identifier vehicle,
        d.approval_status as "approvalStatus", d.approval_observation as "approvalObservation",
        d.submitted_for_review_at as "submittedForReviewAt", u.created_at as "createdAt",
        count(dd.id)::int as "uploadedDocuments",
        count(dd.id) filter (where dd.status='ACTIVE')::int as "approvedDocuments"
      from drivers d join users u on u.id=d.user_id
      left join cooperatives c on c.id=u.cooperative_id
      left join lateral (select identifier from vehicles where driver_id=u.id order by created_at desc limit 1) v on true
      left join driver_documents dd on dd.driver_id=u.id and dd.status<>'SUSPENDED'
      where d.approval_status in ('PENDIENTE_DOCUMENTOS','PENDIENTE_REVISION','OBSERVADO','RECHAZADO')
      group by u.id,c.name,v.identifier,d.approval_status,d.approval_observation,d.submitted_for_review_at,d.approval_updated_at
      order by case d.approval_status when 'PENDIENTE_REVISION' then 0 when 'OBSERVADO' then 1 else 2 end,
        d.approval_updated_at desc
    `;
  } catch(e) { return guardError(e, reply); } });
  app.post("/v1/admin/driver-approvals/:id/decision", async (request, reply) => { try {
    const actor=requirePermission(request,"drivers:approve"); const body=approvalDecisionSchema.parse(request.body);
    if (!process.env.DATABASE_URL) return { ok:true };
    const driverId=(request.params as {id:string}).id;
    const required=["PROFILE_PHOTO","IDENTIFICATION","LICENSE","REGISTRATION","OPERATING_PERMIT"];
    const result=await database().begin(async tx=>{
      const [current]=await tx`select d.approval_status,u.full_name from drivers d join users u on u.id=d.user_id where d.user_id=${driverId} for update`;
      if(!current)return undefined;
      if(body.decision==="APPROVE") {
        const [documents]=await tx`select count(distinct document_type)::int count from driver_documents where driver_id=${driverId} and document_type in ${tx(required)} and status='ACTIVE'`;
        if(Number(documents?.count)!==required.length)throw new Error("DRIVER_DOCUMENTS_NOT_APPROVED");
      }
      const next={APPROVE:"APROBADO",REJECT:"RECHAZADO",OBSERVE:"OBSERVADO",REQUEST_CORRECTIONS:"OBSERVADO",SUSPEND:"SUSPENDIDO"}[body.decision];
      const accountStatus={APPROVE:"ACTIVE",REJECT:"REJECTED",OBSERVE:"PENDING",REQUEST_CORRECTIONS:"PENDING",SUSPEND:"SUSPENDED"}[body.decision];
      await tx`update drivers set approval_status=${next},approval_observation=${body.observation||null},approval_updated_at=now(),
        approval_note=${body.observation||'Documentación completa'},approved_at=case when ${body.decision}='APPROVE' then now() else approved_at end,
        approved_by=case when ${body.decision}='APPROVE' then ${actor.id!} else approved_by end,is_available=false where user_id=${driverId}`;
      await tx`update users set status=${accountStatus},updated_at=now() where id=${driverId}`;
      await tx`update vehicles set status=${accountStatus} where driver_id=${driverId}`;
      await tx`insert into driver_approval_reviews(driver_id,reviewer_id,previous_status,next_status,decision,observation)
        values(${driverId},${actor.id!},${current.approval_status},${next},${body.decision},${body.observation||null})`;
      return {name:String(current.full_name),approvalStatus:next,accountStatus};
    });
    if(!result)return reply.code(404).send({error:"NOT_FOUND"});
    await persistAudit(actor,"DRIVER_APPROVAL_DECISION","DRIVER",driverId,`${body.decision}: ${body.observation||'Sin observación'}`);
    const [pushSettings]=await database()`select push_enabled from driver_approval_notification_settings where id=1`;
    if(pushSettings?.push_enabled!==false) {
      const messages:Record<string,[string,string]>={APPROVE:["Solicitud aprobada","Tu perfil de conductor fue aprobado. Ya puedes recibir viajes."],REJECT:["Solicitud rechazada",body.observation],OBSERVE:["Solicitud observada",body.observation],REQUEST_CORRECTIONS:["Correcciones requeridas",body.observation],SUSPEND:["Cuenta suspendida",body.observation]};
      const message=messages[body.decision]; if(message)void sendPush(driverId,message[0],message[1],{type:"DRIVER_APPROVAL",status:result.approvalStatus}).catch(()=>undefined);
    }
    return result;
  } catch(e) {
    if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_APPROVAL_DECISION",details:e.issues});
    if(e instanceof Error&&e.message==="DRIVER_DOCUMENTS_NOT_APPROVED")return reply.code(409).send({error:e.message});
    return guardError(e,reply);
  } });
  app.get("/v1/admin/driver-approvals/:id/history", async (request, reply) => { try {
    requirePermission(request,"drivers:approve"); if(!process.env.DATABASE_URL)return [];
    const id=(request.params as {id:string}).id;
    return database()`select r.id::text,r.previous_status as "previousStatus",r.next_status as "nextStatus",r.decision,r.observation,r.created_at as "createdAt",coalesce(u.full_name,u.email,'Sistema') reviewer from driver_approval_reviews r left join users u on u.id=r.reviewer_id where r.driver_id=${id} order by r.created_at desc`;
  } catch(e){return guardError(e,reply);} });
  app.get("/v1/admin/driver-approval-settings", async (request, reply) => { try {
    requirePermission(request,"settings:view");
    if(!process.env.DATABASE_URL)return {adminEmails:[],emailEnabled:false,internalEnabled:true,pushEnabled:true};
    const [settings]=await database()`select admin_emails as "adminEmails",email_enabled as "emailEnabled",internal_enabled as "internalEnabled",push_enabled as "pushEnabled" from driver_approval_notification_settings where id=1`;
    return settings;
  } catch(e){return guardError(e,reply);} });
  app.put("/v1/admin/driver-approval-settings", async (request, reply) => { try {
    const actor=requirePermission(request,"settings:manage"); const body=approvalSettingsSchema.parse(request.body);
    if(!process.env.DATABASE_URL)return body;
    const [settings]=await database()`update driver_approval_notification_settings set admin_emails=${body.adminEmails},email_enabled=${body.emailEnabled},internal_enabled=${body.internalEnabled},push_enabled=${body.pushEnabled},updated_by=${actor.id!},updated_at=now() where id=1 returning admin_emails as "adminEmails",email_enabled as "emailEnabled",internal_enabled as "internalEnabled",push_enabled as "pushEnabled"`;
    await persistAudit(actor,"DRIVER_APPROVAL_SETTINGS","SETTINGS","driver-approval","Configuración de avisos actualizada"); return settings;
  } catch(e){if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_SETTINGS"});return guardError(e,reply);} });
  app.get("/v1/admin/notifications", async (request, reply) => { try {
    const actor=requirePermission(request,"dashboard:view"); if(!process.env.DATABASE_URL)return [];
    return database()`select id::text,type,title,body,entity_type as "entityType",entity_id as "entityId",not (${actor.id!}=any(read_by)) as unread,created_at as "createdAt" from admin_notifications order by created_at desc limit 100`;
  } catch(e){return guardError(e,reply);} });
  app.get("/v1/admin/drivers/:id/documents", async (request, reply) => { try {
    requirePermission(request, "drivers:documents:view");
    if (!process.env.DATABASE_URL) return [];
    const id=(request.params as { id: string }).id;
    return database()`
      select dd.id::text, dd.document_type as "documentType", dd.file_mime as "fileMime",
        encode(dd.file_data, 'base64') as "fileBase64", dd.status,
        dd.expires_at as "expiresAt", dd.review_note as "reviewNote",
        dd.created_at as "createdAt"
      from driver_documents dd where dd.driver_id=${id} order by dd.document_type
    `;
  } catch(e) { return guardError(e, reply); } });
  app.post("/v1/admin/drivers/:id/documents", async (request, reply) => { try {
    const user=requirePermission(request, "drivers:documents:manage"); const body=adminDocumentSchema.parse(request.body);
    if (!process.env.DATABASE_URL) return reply.code(201).send({ ok: true });
    const id=(request.params as { id: string }).id;
    let data: Buffer;
    try { data=decodeAdminImage(body); } catch { return reply.code(400).send({error:"INVALID_DRIVER_DOCUMENT"}); }
    const [document]=await database()`
      insert into driver_documents (driver_id, document_type, file_url, file_data, file_mime, expires_at, status)
      values (${id}, ${body.documentType}, 'database', ${data}, ${body.fileMime}, ${body.expiresAt || null}, 'PENDING')
      on conflict (driver_id, document_type) do update set file_data=excluded.file_data,
        file_mime=excluded.file_mime, expires_at=excluded.expires_at, status='PENDING',
        reviewed_by=null, reviewed_at=null, review_note=null, created_at=now()
      returning id::text, document_type as "documentType", status
    `;
    if (body.documentType === "PROFILE_PHOTO") await database()`update users set profile_photo_data=${data}, profile_photo_mime=${body.fileMime}, profile_photo_updated_at=now(), updated_at=now() where id=${id} and role='DRIVER'`;
    await persistAudit(user,"DRIVER_DOCUMENT_UPLOAD","DRIVER_DOCUMENT",String(document?.id ?? id),`Carga o reemplazo: ${body.documentType}`);
    return reply.code(201).send(document);
  } catch(e) { if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_DATA"}); return guardError(e, reply); } });
  app.delete("/v1/admin/drivers/:driverId/documents/:documentId", async (request, reply) => { try {
    const user=requirePermission(request, "drivers:documents:manage");
    if (!process.env.DATABASE_URL) return { deactivated: true };
    const { driverId, documentId }=request.params as { driverId: string; documentId: string };
    const [existing]=await database()`select document_type from driver_documents where id=${documentId} and driver_id=${driverId}`;
    if (existing?.document_type === "PROFILE_PHOTO") return reply.code(409).send({error:"PROFILE_PHOTO_MUST_BE_REPLACED"});
    const [document]=await database()`update driver_documents set status='SUSPENDED', reviewed_by=${user.id!}, reviewed_at=now(), review_note='Desactivado desde administracion' where id=${documentId} and driver_id=${driverId} returning id::text, document_type as "documentType"`;
    if (!document) return reply.code(404).send({error:"NOT_FOUND"});
    await persistAudit(user,"DRIVER_DOCUMENT_DEACTIVATE","DRIVER_DOCUMENT",documentId,"Desactivado desde administracion");
    return { deactivated: true };
  } catch(e) { return guardError(e, reply); } });
  app.patch("/v1/admin/drivers/:driverId/documents/:documentId", async (request, reply) => { try {
    const user=requirePermission(request, "drivers:documents:manage"); const body=documentReviewSchema.parse(request.body);
    if (!process.env.DATABASE_URL) return { ok: true };
    const { driverId, documentId }=request.params as { driverId: string; documentId: string };
    const [document]=await database()`
      update driver_documents set status=${body.status}, review_note=${body.note},
        reviewed_by=${user.id!}, reviewed_at=now()
      where id=${documentId} and driver_id=${driverId}
      returning id::text, status
    `;
    if (!document) return reply.code(404).send({ error: "NOT_FOUND" });
    await persistAudit(user, "DRIVER_DOCUMENT_REVIEW", "DRIVER_DOCUMENT", documentId, body.note);
    return document;
  } catch(e) { if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_DATA"}); return guardError(e, reply); } });
  app.patch("/v1/admin/drivers/:id", async (request, reply) => { try {
    const user=requirePermission(request, "drivers:approve"); const body=driverSchema.parse(request.body);
    if (!process.env.DATABASE_URL) { const item=drivers.find(d=>d.id===(request.params as any).id); if(!item)return reply.code(404).send({error:"NOT_FOUND"}); item.status=body.status; audit(user,"DRIVER_STATUS",item.id,body.reason); return item; }
    const id=(request.params as { id: string }).id;
    const rows=await database().begin(async tx=>{
      const [existing]=await tx`select status from users where id=${id} and role='DRIVER' for update`;
      if(!existing)return [];
      if(String(existing.status)!==body.status)throw new Error("APPROVAL_WORKFLOW_REQUIRED");
      const updated=await tx`
        update users set status=${body.status},
          cooperative_id=case when ${body.cooperativeId !== undefined}
            then ${body.cooperativeId ?? null} else cooperative_id end,
          updated_at=now()
        where id=${id} and role='DRIVER'
        returning id, full_name as name, phone_e164 as phone, status,
          cooperative_id::text as "cooperativeId"
      `;
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
  } catch(e){ if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_DATA"}); if(e instanceof Error&&e.message==="APPROVAL_WORKFLOW_REQUIRED")return reply.code(409).send({error:e.message}); return guardError(e,reply);} });
  app.get("/v1/admin/passengers", async (request, reply) => { try {
    requirePermission(request, "passengers:view");
    if (!process.env.DATABASE_URL) return passengers;
    return await database()`
      select u.id, u.full_name as name, u.email, u.phone_e164 as phone, u.status,
        count(t.id)::int as trips, max(t.requested_at)::text as "lastTrip"
      from users u left join trips t on t.passenger_id = u.id
      where u.role='PASSENGER'
      group by u.id order by u.created_at
    `;
  } catch(e){return guardError(e,reply);} });
  app.patch("/v1/admin/passengers/:id", async (request, reply) => { try {
    const user=requirePermission(request, "passengers:manage"); const body=passengerSchema.parse(request.body);
    if (!process.env.DATABASE_URL) { const item=passengers.find(p=>p.id===(request.params as any).id); if(!item)return reply.code(404).send({error:"NOT_FOUND"}); item.status=body.status; audit(user,"PASSENGER_STATUS",item.id,body.reason); return item; }
    const id=(request.params as { id: string }).id;
    const rows=await database()`update users set status=${body.status}, updated_at=now() where id=${id} and role='PASSENGER' returning id, full_name as name, phone_e164 as phone, status`;
    const item=rows[0]; if(!item)return reply.code(404).send({error:"NOT_FOUND"});
    await persistAudit(user,"PASSENGER_STATUS","PASSENGER",id,body.reason);
    return item;
  } catch(e){if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_DATA"});return guardError(e,reply);} });
  app.get("/v1/admin/pricing", async (request, reply) => { try {
    requirePermission(request, "pricing:view");
    if (!process.env.DATABASE_URL) return pricing;
    return await database()`
      select id::text, version,
        urban_day_cents_per_passenger as "urbanDayCents",
        night_cents_per_passenger as "nightCents",
        extended_cents_per_passenger as "extendedCents",
        stop_surcharge_cents as "stopSurchargeCents",
        group_promotion_passengers as "promotionPassengers",
        group_promotion_total_cents as "promotionTotalCents",
        active_from as "activeFrom",
        active_until as "activeUntil",
        case
          when active_from > now() then 'SCHEDULED'
          when active_until is not null and active_until <= now() then 'FINALIZED'
          else 'ACTIVE'
        end as status
      from pricing_versions order by version desc
    `;
  } catch(e){return guardError(e,reply);} });
  app.post("/v1/admin/pricing", async (request, reply) => { try {
    const user=requirePermission(request, "pricing:manage"); const body=pricingSchema.parse(request.body);
    if (process.env.DATABASE_URL) {
      const next = await database().begin(async sql => {
        const [row] = await sql`select coalesce(max(version), 0) + 1 as version from pricing_versions`;
        const version = Number(row!.version);
        const startsAt = new Date(body.activeFrom);
        const [nextScheduled] = await sql`
          select active_from as "activeFrom" from pricing_versions
          where active_from > ${startsAt} order by active_from limit 1
        `;
        await sql`
          update pricing_versions set active_until=${startsAt}
          where active_from <= ${startsAt}
            and (active_until is null or active_until > ${startsAt})
        `;
        const [item] = await sql`
          insert into pricing_versions (
            version, day_starts_at, night_starts_at, urban_day_cents_per_passenger,
            night_cents_per_passenger, extended_cents_per_passenger, stop_surcharge_cents,
            group_promotion_enabled, group_promotion_passengers, group_promotion_total_cents,
            maximum_passengers, active_from, created_by
          ) values (
            ${version}, '06:00', '20:00', ${body.urbanDayCents}, ${body.nightCents},
            ${body.extendedCents}, ${body.stopSurchargeCents}, true,
            ${body.promotionPassengers}, ${body.promotionTotalCents}, 4, ${body.activeFrom}, ${user.id!}
          ) returning id::text, version, urban_day_cents_per_passenger as "urbanDayCents",
            night_cents_per_passenger as "nightCents", extended_cents_per_passenger as "extendedCents",
            stop_surcharge_cents as "stopSurchargeCents",
            group_promotion_passengers as "promotionPassengers",
            group_promotion_total_cents as "promotionTotalCents", active_from as "activeFrom"
        `;
        if (nextScheduled?.activeFrom) await sql`
          update pricing_versions set active_until=${nextScheduled.activeFrom}
          where id=${item!.id}
        `;
        return item!;
      });
      await persistAudit(user, "PRICING_PUBLISHED", "PRICING", next.id, `Version ${next.version}`);
      return reply.code(201).send({ ...next, status: new Date(next.activeFrom) > new Date() ? "SCHEDULED" : "ACTIVE" });
    }
    const next:PricingVersion={id:`PRICE-${pricing.length+1}`,version:Math.max(...pricing.map(p=>p.version))+1,...body,status:new Date(body.activeFrom)>new Date()?"SCHEDULED":"ACTIVE"};
    if(next.status==="ACTIVE")pricing.filter(p=>p.status==="ACTIVE").forEach(p=>p.status="FINALIZED"); pricing.unshift(next); audit(user,"PRICING_PUBLISHED",next.id,`Version ${next.version}`); return reply.code(201).send(next);
  }catch(e){if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_DATA"});return guardError(e,reply);} });
  app.get("/v1/admin/zones", async (request, reply) => { try {
    requirePermission(request, "service_areas:view");
    if (!process.env.DATABASE_URL) return [];
    return await database()`
      select a.id::text, a.code, a.name, a.description, a.environment, a.audience,
        a.enabled, a.allow_inter_zone_trips as "allowInterZoneTrips", a.priority,
        a.created_at as "createdAt", a.updated_at as "updatedAt",
        v.id::text as "versionId", v.version, v.source_name as "sourceName",
        v.source_url as "sourceUrl", v.change_note as "changeNote",
        v.created_at as "publishedAt", ST_AsGeoJSON(v.geometry, 6)::jsonb as geometry,
        ST_NPoints(v.geometry)::int as "pointCount",
        round(ST_Area(v.geometry::geography)::numeric / 1000000, 2)::float as "areaSquareKm",
        jsonb_build_object('west',ST_XMin(ST_Envelope(v.geometry)),
          'south',ST_YMin(ST_Envelope(v.geometry)),'east',ST_XMax(ST_Envelope(v.geometry)),
          'north',ST_YMax(ST_Envelope(v.geometry))) bounds
      from service_areas a join service_area_versions v on v.id=a.current_version_id
      where a.archived_at is null
      order by a.priority desc, a.name
    `;
  } catch(e){return guardError(e,reply);} });
  app.post("/v1/admin/zones/validate", async (request, reply) => { try {
    requirePermission(request, "service_areas:view");
    const body=serviceAreaValidationSchema.parse(request.body);const geometry=JSON.stringify(body.geometry);
    const [result]=await database()`with candidate as (
      select ST_SetSRID(ST_GeomFromGeoJSON(${geometry}),4326) geometry
    ) select ST_IsValid(geometry) valid, ST_IsValidReason(geometry) reason,
      ST_IsEmpty(geometry) empty, ST_NPoints(geometry)::int as "pointCount",
      round(ST_Area(geometry::geography)::numeric/1000000,2)::float as "areaSquareKm",
      jsonb_build_object('west',ST_XMin(ST_Envelope(geometry)),'south',ST_YMin(ST_Envelope(geometry)),
        'east',ST_XMax(ST_Envelope(geometry)),'north',ST_YMax(ST_Envelope(geometry))) bounds
      from candidate`;
    // Do not run ST_Intersection with an invalid candidate. Besides being
    // unsafe, that masks PostGIS' useful validation reason with a generic 500.
    if (!result?.valid || result?.empty) return {...result,overlaps:[]};
    const overlaps=await database()`with candidate as (select ST_SetSRID(ST_GeomFromGeoJSON(${geometry}),4326) geometry)
      select a.id::text,a.code,a.name,a.priority,
        round(ST_Area(ST_Intersection(v.geometry,candidate.geometry)::geography)::numeric/1000000,3)::float as "overlapSquareKm"
      from candidate,service_areas a join service_area_versions v on v.id=a.current_version_id
      where a.archived_at is null and (${body.excludeAreaId ?? null}::uuid is null or a.id<>${body.excludeAreaId ?? null}::uuid)
        and ST_Intersects(v.geometry,candidate.geometry)
        and ST_Area(ST_Intersection(v.geometry,candidate.geometry)::geography)>1
      order by a.priority desc,a.code`;
    return {...result,overlaps};
  }catch(e){if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_SERVICE_AREA",details:e.issues});return guardError(e,reply);}});
  app.get("/v1/admin/zones/:id/history",async(request,reply)=>{try{
    requirePermission(request,"service_areas:view");const id=(request.params as {id:string}).id;
    return database()`select v.id::text,v.version,v.source_name as "sourceName",v.source_url as "sourceUrl",
      v.change_note as "changeNote",v.created_at as "publishedAt",coalesce(u.email,'Sistema') author,
      ST_NPoints(v.geometry)::int as "pointCount",round(ST_Area(v.geometry::geography)::numeric/1000000,2)::float as "areaSquareKm"
      from service_area_versions v left join users u on u.id=v.created_by
      where v.service_area_id=${id}::uuid order by v.version desc`;
  }catch(e){return guardError(e,reply);}});
  app.get("/v1/admin/zones/:id/export",async(request,reply)=>{try{
    requirePermission(request,"service_areas:view");const id=(request.params as {id:string}).id;
    const [item]=await database()`select a.code,a.name,a.description,a.environment,a.audience,a.enabled,a.priority,
      ST_AsGeoJSON(v.geometry,7)::jsonb geometry from service_areas a join service_area_versions v on v.id=a.current_version_id
      where a.id=${id}::uuid and a.archived_at is null`;
    if(!item)return reply.code(404).send({error:"NOT_FOUND"});
    reply.header("content-type","application/geo+json; charset=utf-8");
    reply.header("content-disposition",`attachment; filename="${item.code}.geojson"`);
    return {type:"Feature",properties:{code:item.code,name:item.name,description:item.description,environment:item.environment,
      audience:item.audience,enabled:item.enabled,priority:item.priority},geometry:item.geometry};
  }catch(e){return guardError(e,reply);}});
  app.post("/v1/admin/zones", async (request, reply) => { try {
    const body=serviceAreaPublishSchema.parse(request.body);
    const user=requirePermission(request, body.areaId ? "service_areas:edit" : "service_areas:create");
    const geometry=JSON.stringify(body.geometry);
    const [validation]=await database()`select ST_IsValid(candidate) valid,ST_IsValidReason(candidate) reason,ST_IsEmpty(candidate) empty
      from (select ST_SetSRID(ST_GeomFromGeoJSON(${geometry}),4326) candidate) value`;
    if(!validation?.valid||validation?.empty)return reply.code(422).send({error:"INVALID_SERVICE_AREA_GEOMETRY",message:validation?.reason??"Geometría vacía"});
    const item=await database().begin(async tx=>{
      const [existing]=body.areaId ? await tx`select id::text,current_version_id::text as "currentVersionId" from service_areas where id=${body.areaId}::uuid and archived_at is null for update` : [];
      if(body.areaId&&!existing)throw new Error("SERVICE_AREA_NOT_FOUND");
      const [duplicate]=await tx`select id::text from service_areas where code=${body.code} and (${body.areaId ?? null}::uuid is null or id<>${body.areaId ?? null}::uuid)`;
      if(duplicate)throw new Error("SERVICE_AREA_CODE_EXISTS");
      const [area]=existing ? await tx`
        update service_areas set code=${body.code},name=${body.name},description=${body.description || null},
          environment=${body.environment},audience=${body.audience},enabled=${body.enabled},
          allow_inter_zone_trips=${body.allowInterZoneTrips},priority=${body.priority},
          updated_by=${user.id!},updated_at=now() where id=${existing.id}::uuid returning id::text
      ` : await tx`
        insert into service_areas(code,name,description,environment,audience,enabled,
          allow_inter_zone_trips,priority,created_by,updated_by)
        values(${body.code},${body.name},${body.description || null},${body.environment},${body.audience},
          false,${body.allowInterZoneTrips},${body.priority},${user.id!},${user.id!}) returning id::text
      `;
      const [versionRow]=await tx`select coalesce(max(version),0)+1 as version from service_area_versions where service_area_id=${area!.id}::uuid`;
      const [version]=await tx`
        insert into service_area_versions(service_area_id,version,geometry,source_name,source_url,change_note,created_by)
        values(${area!.id}::uuid,${Number(versionRow!.version)},
          ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${geometry}),4326)),3)),
          ${body.sourceName},${body.sourceUrl || null},${body.changeNote},${user.id!})
        returning id::text,version
      `;
      await tx`update service_areas set current_version_id=${version!.id}::uuid where id=${area!.id}::uuid`;
      await tx`update service_area_catalog set version=version+1,updated_at=now() where id=1`;
      return {id:area!.id,version:version!.version,code:body.code,name:body.name,enabled:existing ? body.enabled : false};
    });
    await persistAudit(user,body.sourceType==="GEOJSON"?"SERVICE_AREA_GEOJSON_IMPORTED":"SERVICE_AREA_PUBLISHED","SERVICE_AREA",item.id,`${item.code} v${item.version}: ${body.changeNote}`);
    return reply.code(body.areaId?200:201).send(item);
  }catch(e){if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_SERVICE_AREA",details:e.issues});if(e instanceof Error&&e.message==="SERVICE_AREA_CODE_EXISTS")return reply.code(409).send({error:e.message});if(e instanceof Error&&e.message==="SERVICE_AREA_NOT_FOUND")return reply.code(404).send({error:e.message});return guardError(e,reply);} });
  app.patch("/v1/admin/zones/:id/status",async(request,reply)=>{try{
    const user=requirePermission(request,"service_areas:activate");const body=serviceAreaStatusSchema.parse(request.body);
    const id=(request.params as {id:string}).id;
    const [item]=await database()`update service_areas set enabled=${body.enabled},updated_by=${user.id!},updated_at=now() where id=${id}::uuid returning id::text,code,enabled`;
    if(!item)return reply.code(404).send({error:"NOT_FOUND"});
    await database()`update service_area_catalog set version=version+1,updated_at=now() where id=1`;
    await persistAudit(user,"SERVICE_AREA_STATUS","SERVICE_AREA",id,`${item.code}: ${body.enabled ? "habilitada" : "deshabilitada"}`);
    return item;
  }catch(e){if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_SERVICE_AREA_STATUS"});return guardError(e,reply);}});
  app.get("/v1/admin/zones/:id/access",async(request,reply)=>{try{
    requirePermission(request,"service_areas:view");const id=(request.params as {id:string}).id;
    return database()`select u.id::text,u.full_name as name,u.email,u.role,
      access.expires_at as "expiresAt",access.created_at as "grantedAt"
      from user_service_area_access access join users u on u.id=access.user_id
      where access.service_area_id=${id}::uuid order by u.full_name`;
  }catch(e){return guardError(e,reply);}});
  app.post("/v1/admin/zones/:id/access",async(request,reply)=>{try{
    const user=requirePermission(request,"service_areas:edit");const body=serviceAreaAccessSchema.parse(request.body);
    const id=(request.params as {id:string}).id;
    const [item]=await database()`insert into user_service_area_access(user_id,service_area_id,granted_by,expires_at)
      select ${body.userId}::uuid,area.id,${user.id!},${body.expiresAt ? new Date(body.expiresAt) : null}
      from service_areas area join users account on account.id=${body.userId}::uuid
      where area.id=${id}::uuid and account.role in ('PASSENGER','DRIVER')
      on conflict(user_id,service_area_id) do update set granted_by=excluded.granted_by,expires_at=excluded.expires_at,created_at=now()
      returning user_id::text as "userId",service_area_id::text as "serviceAreaId",expires_at as "expiresAt"`;
    if(!item)return reply.code(404).send({error:"USER_OR_SERVICE_AREA_NOT_FOUND"});
    await database()`update service_area_catalog set version=version+1,updated_at=now() where id=1`;
    await persistAudit(user,"SERVICE_AREA_ACCESS_GRANTED","SERVICE_AREA",id,body.userId);return reply.code(201).send(item);
  }catch(e){if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_SERVICE_AREA_ACCESS"});return guardError(e,reply);}});
  app.delete("/v1/admin/zones/:id/access/:userId",async(request,reply)=>{try{
    const user=requirePermission(request,"service_areas:edit");const {id,userId}=request.params as {id:string;userId:string};
    const removed=await database()`delete from user_service_area_access where service_area_id=${id}::uuid and user_id=${userId}::uuid returning user_id`;
    if(!removed.length)return reply.code(404).send({error:"NOT_FOUND"});
    await database()`update service_area_catalog set version=version+1,updated_at=now() where id=1`;
    await persistAudit(user,"SERVICE_AREA_ACCESS_REVOKED","SERVICE_AREA",id,userId);return reply.code(204).send();
  }catch(e){return guardError(e,reply);}});
  app.get("/v1/admin/zones/:id/roles",async(request,reply)=>{try{
    requirePermission(request,"service_areas:view");const id=(request.params as {id:string}).id;
    return database()`select role,created_at as "grantedAt" from service_area_role_access where service_area_id=${id}::uuid order by role`;
  }catch(e){return guardError(e,reply);}});
  app.put("/v1/admin/zones/:id/roles",async(request,reply)=>{try{
    const user=requirePermission(request,"service_areas:edit");const id=(request.params as {id:string}).id;
    const body=serviceAreaRoleSchema.parse(request.body);
    await database().begin(async tx=>{await tx`delete from service_area_role_access where service_area_id=${id}::uuid`;
      for(const role of body.roles)await tx`insert into service_area_role_access(service_area_id,role,granted_by) values(${id}::uuid,${role},${user.id!})`;});
    await database()`update service_area_catalog set version=version+1,updated_at=now() where id=1`;
    await persistAudit(user,"SERVICE_AREA_ROLES_UPDATED","SERVICE_AREA",id,body.roles.join(", ")||"Sin roles");
    return {id,roles:body.roles};
  }catch(e){if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_SERVICE_AREA_ROLES"});return guardError(e,reply);}});
  app.delete("/v1/admin/zones/:id",async(request,reply)=>{try{
    const user=requirePermission(request,"service_areas:archive");const id=(request.params as {id:string}).id;
    const [item]=await database()`update service_areas set enabled=false,archived_at=now(),archived_by=${user.id!},updated_by=${user.id!},updated_at=now()
      where id=${id}::uuid and archived_at is null returning id::text,code`;
    if(!item)return reply.code(404).send({error:"NOT_FOUND"});
    await database()`update service_area_catalog set version=version+1,updated_at=now() where id=1`;
    await persistAudit(user,"SERVICE_AREA_ARCHIVED","SERVICE_AREA",id,item.code);
    return reply.code(204).send();
  }catch(e){return guardError(e,reply);}});
  app.get("/v1/admin/incidents", async (request, reply) => { try {
    requirePermission(request, "incidents:view");
    if (!process.env.DATABASE_URL) return incidents;
    return await database()`
      select i.id::text, coalesce(i.trip_id::text, 'Sin viaje') as trip,
        i.category, i.subject, i.description, i.priority, i.preferred_contact as "preferredContact", i.status,
        coalesce(u.full_name, 'Sin asignar') as "assignedTo",
        reporter.full_name as reporter, reporter.role as "reporterRole", reporter.email as "reporterEmail",
        reporter.phone_e164 as "reporterPhone", c.name as cooperative,
        i.created_at as "createdAt", i.updated_at as "updatedAt"
      from incidents i
      left join users u on u.id=i.assigned_to
      left join users reporter on reporter.id=i.reported_by
      left join cooperatives c on c.id=i.cooperative_id
      order by i.created_at desc
    `;
  } catch(e){return guardError(e,reply);} });
  app.get("/v1/admin/incidents/:id", async (request, reply) => { try {
    requirePermission(request, "incidents:view");
    const id=(request.params as {id:string}).id;
    const [item]=await database()`
      select i.id::text,i.trip_id::text as "tripId",i.category,i.subject,i.description,
        i.priority,i.preferred_contact as "preferredContact",i.status,
        i.resolution_note as "resolutionNote",i.created_at as "createdAt",i.updated_at as "updatedAt",
        reporter.full_name reporter,reporter.role as "reporterRole",reporter.email as "reporterEmail",
        reporter.phone_e164 as "reporterPhone",related.full_name as "relatedUser",
        assignee.full_name as "assignedTo",c.name cooperative,
        t.origin_reference as "originReference",t.destination_reference as "destinationReference",
        t.requested_at as "tripDate"
      from incidents i
      left join users reporter on reporter.id=i.reported_by
      left join users related on related.id=i.related_user_id
      left join users assignee on assignee.id=i.assigned_to
      left join cooperatives c on c.id=i.cooperative_id
      left join trips t on t.id=i.trip_id
      where i.id=${id}::uuid
    `;
    if(!item)return reply.code(404).send({error:"NOT_FOUND"});
    const [messages,attachments]=await Promise.all([
      database()`select m.id::text,m.body,m.visibility,m.author_role as "authorRole",m.created_at as "createdAt",coalesce(u.full_name,'Sistema') author from support_incident_messages m left join users u on u.id=m.author_id where m.incident_id=${id}::uuid order by m.created_at`,
      database()`select id::text,file_name as "fileName",file_mime as "fileMime",file_size as "fileSize",visibility,created_at as "createdAt" from support_incident_attachments where incident_id=${id}::uuid order by created_at`
    ]);
    return {...item,messages,attachments};
  }catch(e){return guardError(e,reply);} });
  app.get("/v1/admin/incidents/:incidentId/attachments/:attachmentId", async(request,reply)=>{try{
    requirePermission(request,"incidents:view");
    const {incidentId,attachmentId}=request.params as {incidentId:string;attachmentId:string};
    const [file]=await database()`select file_name,file_mime,file_data from support_incident_attachments where id=${attachmentId}::uuid and incident_id=${incidentId}::uuid`;
    if(!file)return reply.code(404).send({error:"NOT_FOUND"});
    const safeName=String(file.file_name).replace(/[^a-zA-Z0-9._-]/g,"_");
    return reply.header("content-type",file.file_mime).header("content-disposition",`inline; filename="${safeName}"`).send(file.file_data);
  }catch(e){return guardError(e,reply);} });
  app.patch("/v1/admin/incidents/:id", async (request, reply) => { try { const user=requirePermission(request, "incidents:manage"); const body=incidentSchema.parse(request.body); const item=incidents.find(i=>i.id===(request.params as any).id); if(!item)return reply.code(404).send({error:"NOT_FOUND"}); Object.assign(item,{status:body.status,assignedTo:body.assignToSelf?user.name:item.assignedTo}); audit(user,"INCIDENT_UPDATED",item.id,body.status); return item;}catch(e){if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_DATA"});return guardError(e,reply);} });
  app.post("/v1/admin/pricing/persist", async (request, reply) => { try {
    const user = requirePermission(request, "pricing:manage"); const body = pricingSchema.parse(request.body);
    const next = await database().begin(async sql => {
      const [row] = await sql`select coalesce(max(version), 0) + 1 as version from pricing_versions`;
      const version = Number(row!.version);
      const startsAt = new Date(body.activeFrom);
      const [nextScheduled] = await sql`
        select active_from as "activeFrom" from pricing_versions
        where active_from > ${startsAt} order by active_from limit 1
      `;
      await sql`
        update pricing_versions set active_until=${startsAt}
        where active_from <= ${startsAt}
          and (active_until is null or active_until > ${startsAt})
      `;
      const [item] = await sql`insert into pricing_versions (version, day_starts_at, night_starts_at, urban_day_cents_per_passenger, night_cents_per_passenger, extended_cents_per_passenger, stop_surcharge_cents, group_promotion_enabled, group_promotion_passengers, group_promotion_total_cents, maximum_passengers, active_from, created_by) values (${version}, '06:00', '20:00', ${body.urbanDayCents}, ${body.nightCents}, ${body.extendedCents}, ${body.stopSurchargeCents}, true, ${body.promotionPassengers}, ${body.promotionTotalCents}, 4, ${body.activeFrom}, ${user.id!}) returning id::text, version, urban_day_cents_per_passenger as "urbanDayCents", night_cents_per_passenger as "nightCents", extended_cents_per_passenger as "extendedCents", stop_surcharge_cents as "stopSurchargeCents", group_promotion_passengers as "promotionPassengers", group_promotion_total_cents as "promotionTotalCents", active_from as "activeFrom"`;
      if (nextScheduled?.activeFrom) await sql`
        update pricing_versions set active_until=${nextScheduled.activeFrom}
        where id=${item!.id}
      `;
      return item!;
    });
    await persistAudit(user, "PRICING_PUBLISHED", "PRICING", next.id, `Version ${next.version}`);
    return reply.code(201).send({ ...next, status: new Date(next.activeFrom) > new Date() ? "SCHEDULED" : "ACTIVE" });
  } catch(e) { if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_DATA"}); return guardError(e,reply); } });
  app.patch("/v1/admin/incidents/:id/persist", async (request, reply) => { try {
    const user = requirePermission(request, "incidents:manage"); const body = incidentSchema.parse(request.body); const id = (request.params as { id: string }).id;
    const [item] = await database()`update incidents set status=${body.status},
      assigned_to=case when ${body.assignToSelf} then ${user.id!} else assigned_to end,
      resolution_note=case when ${body.resolutionNote}<>'' then ${body.resolutionNote} else resolution_note end,
      updated_at=now(),resolved_at=case when ${body.status} in ('RESUELTO','CERRADO') then now() else null end
      where id=${id}::uuid returning id::text,status,reported_by::text as "reportedBy"`;
    if (!item) return reply.code(404).send({ error: "NOT_FOUND" });
    if(body.response)await database()`insert into support_incident_messages(incident_id,author_id,author_role,body,visibility) values(${id}::uuid,${user.id!},${user.role},${body.response},'USER')`;
    if(body.internalNote)await database()`insert into support_incident_messages(incident_id,author_id,author_role,body,visibility) values(${id}::uuid,${user.id!},${user.role},${body.internalNote},'INTERNAL')`;
    if(body.response)void sendPush(item.reportedBy,"Actualización de soporte",body.response,{type:"SUPPORT_UPDATE",incidentId:id,status:body.status}).catch(()=>undefined);
    await persistAudit(user, "INCIDENT_UPDATED", "INCIDENT", id, body.status);
    return item;
  } catch(e) { if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_DATA"}); return guardError(e,reply); } });
  app.get("/v1/admin/faqs",async(request,reply)=>{try{
    requirePermission(request,"faq:view");
    return database()`select id::text,category,question,answer,audiences,sort_order as "sortOrder",active,updated_at as "updatedAt" from support_faqs order by sort_order,category,question`;
  }catch(e){return guardError(e,reply);} });
  app.post("/v1/admin/faqs",async(request,reply)=>{try{
    const user=requirePermission(request,"faq:manage");const body=faqSchema.parse(request.body);
    const [item]=await database()`insert into support_faqs(category,question,answer,audiences,sort_order,active,created_by,updated_by) values(${body.category},${body.question},${body.answer},${body.audiences},${body.sortOrder},${body.active},${user.id!},${user.id!}) returning id::text,category,question,answer,audiences,sort_order as "sortOrder",active`;
    await persistAudit(user,"FAQ_CREATED","FAQ",item!.id,body.question);return reply.code(201).send(item);
  }catch(e){if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_DATA"});return guardError(e,reply);} });
  app.patch("/v1/admin/faqs/:id",async(request,reply)=>{try{
    const user=requirePermission(request,"faq:manage");const body=faqSchema.parse(request.body);const id=(request.params as {id:string}).id;
    const [item]=await database()`update support_faqs set category=${body.category},question=${body.question},answer=${body.answer},audiences=${body.audiences},sort_order=${body.sortOrder},active=${body.active},updated_by=${user.id!},updated_at=now() where id=${id}::uuid returning id::text,category,question,answer,audiences,sort_order as "sortOrder",active`;
    if(!item)return reply.code(404).send({error:"NOT_FOUND"});await persistAudit(user,"FAQ_UPDATED","FAQ",id,body.question);return item;
  }catch(e){if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_DATA"});return guardError(e,reply);} });
  app.get("/v1/admin/trips", async (request, reply) => { try {
    requirePermission(request, "trips:view");
    if (!process.env.DATABASE_URL) return [];
    const filters = z.object({
      scheduled: z.enum(["ALL", "SCHEDULED", "IMMEDIATE"]).default("ALL"),
      status: z.string().trim().max(40).optional(),
      passenger: z.string().trim().max(100).optional(),
      driver: z.string().trim().max(100).optional(),
      from: z.string().date().optional(),
      to: z.string().date().optional(),
      unassigned: z.coerce.boolean().optional()
    }).parse(request.query);
    return await database()`
      select t.id::text, t.status, t.passengers, t.service_zone as zone,
        t.quoted_total_cents as "quotedTotalCents", t.requested_at as "requestedAt",
        t.scheduled_for as "scheduledFor", t.schedule_status as "scheduleStatus",
        passenger.full_name as passenger, coalesce(driver.full_name, 'Sin asignar') as driver,
        t.origin_reference as "originReference", t.destination_reference as "destinationReference",
        coalesce((select json_agg(json_build_object('order', stop.stop_order, 'reference', stop.reference, 'completedAt', stop.completed_at) order by stop.stop_order) from trip_stops stop where stop.trip_id=t.id), '[]'::json) as stops,
        coalesce((select json_agg(json_build_object('reason', event.reason_code, 'occurredAt', event.occurred_at) order by event.occurred_at) from trip_events event where event.trip_id=t.id and event.reason_code in ('SCHEDULED_ACCEPTED','SCHEDULED_UPDATED','PASSENGER_CANCELLED','ADMIN_CANCELLED','SCHEDULED_RELEASED')), '[]'::json) as "scheduleHistory"
      from trips t
      join users passenger on passenger.id=t.passenger_id
      left join users driver on driver.id=t.driver_id
      where (${filters.scheduled}='ALL' or (${filters.scheduled}='SCHEDULED' and t.scheduled_for is not null) or (${filters.scheduled}='IMMEDIATE' and t.scheduled_for is null))
        and (${filters.status ?? null}::text is null or t.status=${filters.status ?? null})
        and (${filters.passenger ?? null}::text is null or passenger.full_name ilike ${filters.passenger ? `%${filters.passenger}%` : null})
        and (${filters.driver ?? null}::text is null or driver.full_name ilike ${filters.driver ? `%${filters.driver}%` : null})
        and (${filters.from ?? null}::date is null or coalesce(t.scheduled_for,t.requested_at) >= ${filters.from ?? null}::date)
        and (${filters.to ?? null}::date is null or coalesce(t.scheduled_for,t.requested_at) < (${filters.to ?? null}::date + interval '1 day'))
        and (${filters.unassigned ?? false}=false or t.driver_id is null)
      order by coalesce(t.scheduled_for,t.requested_at) desc limit 200
    `;
  } catch(e) { if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_TRIP_FILTERS"}); return guardError(e, reply); } });
  app.get("/v1/admin/settings", async (request, reply) => { try {
    requirePermission(request, "settings:view");
    const [settings] = await database()`select search_radius_meters as "searchRadiusMeters", scheduled_trip_lead_minutes as "scheduledTripLeadMinutes", scheduled_trip_minimum_notice_minutes as "scheduledTripMinimumNoticeMinutes", document_expiry_alert_days as "documentExpiryAlertDays", updated_at as "updatedAt" from operational_settings where id=1`;
    return settings ?? { searchRadiusMeters: 3000, scheduledTripLeadMinutes: 10, scheduledTripMinimumNoticeMinutes: 30, documentExpiryAlertDays: 30 };
  } catch(e) { return guardError(e, reply); } });
  app.patch("/v1/admin/settings", async (request, reply) => { try {
    const user = requirePermission(request, "settings:manage");
    const body = operationalSettingsSchema.parse(request.body);
    const [settings] = await database()`
      insert into operational_settings (id, search_radius_meters, scheduled_trip_lead_minutes, scheduled_trip_minimum_notice_minutes, document_expiry_alert_days, updated_at, updated_by)
      values (1, ${body.searchRadiusMeters}, ${body.scheduledTripLeadMinutes}, ${body.scheduledTripMinimumNoticeMinutes}, ${body.documentExpiryAlertDays}, now(), ${user.id!})
      on conflict (id) do update set search_radius_meters=excluded.search_radius_meters, scheduled_trip_lead_minutes=excluded.scheduled_trip_lead_minutes, scheduled_trip_minimum_notice_minutes=excluded.scheduled_trip_minimum_notice_minutes, document_expiry_alert_days=excluded.document_expiry_alert_days, updated_at=now(), updated_by=excluded.updated_by
      returning search_radius_meters as "searchRadiusMeters", scheduled_trip_lead_minutes as "scheduledTripLeadMinutes", scheduled_trip_minimum_notice_minutes as "scheduledTripMinimumNoticeMinutes", document_expiry_alert_days as "documentExpiryAlertDays", updated_at as "updatedAt"
    `;
    await persistAudit(user, "OPERATIONAL_SETTINGS_UPDATED", "SETTINGS", "1", `Radio de búsqueda: ${body.searchRadiusMeters} metros`);
    return settings;
  } catch(e) { if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_DATA"}); return guardError(e,reply); } });
  app.get("/v1/admin/banners", async (request, reply) => { try {
    requirePermission(request, "advertising:view");
    if (!process.env.DATABASE_URL) return [];
    return await database()`
      select id::text, title, placement, target_url as "targetUrl", starts_at as "startsAt",
        ends_at as "endsAt", active, sort_order as "sortOrder", image_mime as "imageMime",
        octet_length(image_data) as "imageBytes", created_at as "createdAt", updated_at as "updatedAt"
      from affiliate_banners order by active desc, sort_order, starts_at desc
    `;
  } catch(e) { return guardError(e, reply); } });
  app.post("/v1/admin/banners", async (request, reply) => { try {
    const user = requirePermission(request, "advertising:manage");
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
        ${body.startsAt}, ${body.endsAt}, ${body.active}, ${body.sortOrder}, ${user.id!})
      returning id::text, title, placement, target_url as "targetUrl", starts_at as "startsAt",
        ends_at as "endsAt", active, sort_order as "sortOrder", image_mime as "imageMime",
        octet_length(image_data) as "imageBytes", created_at as "createdAt", updated_at as "updatedAt"
    `;
    if (!item) return reply.code(500).send({ error: "BANNER_NOT_CREATED" });
    await persistAudit(user, "BANNER_CREATED", "AFFILIATE_BANNER", String(item.id), body.title);
    return reply.code(201).send(item);
  } catch(e) { if(e instanceof z.ZodError)return reply.code(400).send({error:"INVALID_DATA"}); return guardError(e,reply); } });
  app.patch("/v1/admin/banners/:id", async (request, reply) => { try {
    const user = requirePermission(request, "advertising:manage");
    const body = bannerUpdateSchema.parse(request.body);
    const id = (request.params as { id: string }).id;
    const [current] = await database()`select * from affiliate_banners where id=${id}`;
    if (!current) return reply.code(404).send({ error: "NOT_FOUND" });
    const image = body.imageBase64
      ? Buffer.from(body.imageBase64.replace(/^data:[^;]+;base64,/, ""), "base64")
      : current.image_data;
    const imageMime = body.imageMime ?? current.image_mime;
    if (!image.length || image.length > 1024 * 1024) return reply.code(400).send({ error: "INVALID_BANNER_IMAGE" });
    if (body.imageBase64) {
      const dimensions = imageDimensions(image, imageMime);
      if (!dimensions || dimensions.width !== 1200 || dimensions.height !== 400) {
        return reply.code(400).send({ error: "INVALID_BANNER_DIMENSIONS", message: "El banner debe medir exactamente 1200×400 px." });
      }
    }
    const startsAt = body.startsAt ?? current.starts_at;
    const endsAt = body.endsAt === "" ? null : (body.endsAt ?? current.ends_at);
    if (endsAt && new Date(endsAt) <= new Date(startsAt)) return reply.code(400).send({ error: "INVALID_BANNER_DATES" });
    const [item] = await database()`
      update affiliate_banners set
        title=${body.title ?? current.title}, target_url=${body.targetUrl === "" ? null : (body.targetUrl ?? current.target_url)},
        image_mime=${imageMime}, image_data=${image}, starts_at=${startsAt}, ends_at=${endsAt}, active=${body.active ?? current.active},
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
    const user = requirePermission(request, "trips:manage"); const body = adminTripActionSchema.parse(request.body);
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
    requirePermission(request, "audit:view");
    if (!process.env.DATABASE_URL) return audits;
    return await database()`
      select a.id::text, coalesce(u.email, 'Sistema') as actor, a.action,
        a.entity_type || ':' || a.entity_id as entity, a.created_at as "createdAt",
        coalesce(a.reason, a.next_value->>'detail', '') as detail
      from audit_log a left join users u on u.id = a.actor_id
      order by a.created_at desc limit 200
    `;
  } catch(e){return guardError(e,reply);} });
  app.get("/v1/admin/database", async (request, reply) => { try { requirePermission(request, "database:view"); const rows=await database()`select current_database() as database, version() as postgres_version, postgis_full_version() as postgis_version`; return { connected:true,...rows[0]}; } catch(error){ return guardError(error, reply); } });
}
