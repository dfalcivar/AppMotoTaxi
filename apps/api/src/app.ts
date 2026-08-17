import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { calculateQuote, initialPricingConfig } from "@mototaxi/domain";
import { calculateTerritorialFare } from "./fare-engine.js";
import { z } from "zod";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import { registerAdminRoutes, tokenFor, userFrom, type SessionUser } from "./admin.js";
import { database } from "./database.js";
import { pushConfigurationStatus, sendPush } from "./push.js";
import { registerRealtimeRoutes } from "./realtime.js";
import { registerSupportRoutes } from "./support.js";
import { reverseLocation, searchLocations, searchLocationsInArea } from "./geocoding.js";
import { computeRoute } from "./routing.js";
import { notifyAdministratorsDriverReady } from "./approval-notifications.js";
import { captureOperationalError } from "./observability.js";
import { sendTransactionalEmail } from "./email.js";
import {
  legacyPhoneAliases,
  normalizeEmail,
  normalizePhone,
  passwordPolicyMessage,
  strongPasswordSchema
} from "./auth-security.js";
import {
  authorizedServiceAreas,
  filterLocationsToArea,
  resolveServiceArea,
  serviceAreaAccessError,
  serviceAreaBounds,
  ServiceAreaError,
  validateTripServiceArea
} from "./service-areas.js";

// Solo se aplica en redes que definen un proxy; en producción no se configura.
const outboundProxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
if (outboundProxy) setGlobalDispatcher(new ProxyAgent(outboundProxy));

const quoteSchema = z.object({
  zone: z.enum(["URBAN", "EXTENDED"]),
  passengers: z.number().int().positive(),
  localTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
});

const mobileLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["PASSENGER", "DRIVER"]).optional()
});
const biometricSessionSchema = z.object({
  credential: z.string().min(32).max(256),
  role: z.enum(["PASSENGER", "DRIVER"]).optional()
});
const switchMobileRoleSchema = z.object({ role: z.enum(["PASSENGER", "DRIVER"]) });
const changePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(100).optional(),
  password: strongPasswordSchema
});
const passwordResetRequestSchema = z.object({ email: z.string().email() });
const emailVerificationRequestSchema = z.object({ email: z.string().email() });
const emailVerificationConfirmSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/)
});
const passwordResetConfirmSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
  password: strongPasswordSchema
});
const accountDeletionSchema = z.object({ password: z.string().min(8).max(100) });
const externalDeletionRequestSchema = z.object({ email: z.string().email() });
const externalDeletionConfirmSchema = z.object({ token: z.string().min(32).max(200) });
const registrationSchema = z.object({
  fullName: z.string().trim().min(3).max(120),
  email: z.string().email(),
  password: strongPasswordSchema,
  phone: z.string().trim().min(8).max(30),
  role: z.enum(["PASSENGER", "DRIVER"]),
  vehicleIdentifier: z.string().trim().min(3).max(30).optional(),
  cooperativeId: z.string().uuid().nullable().optional(),
  profilePhotoBase64: z.string().min(100).max(3_500_000).optional(),
  profilePhotoMime: z.enum(["image/jpeg", "image/png", "image/webp"]).optional()
}).superRefine((value, context) => {
  if (value.role === "DRIVER" && (!value.profilePhotoBase64 || !value.profilePhotoMime)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["profilePhotoBase64"], message: "DRIVER_PHOTO_REQUIRED" });
  }
  if (Boolean(value.profilePhotoBase64) !== Boolean(value.profilePhotoMime)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["profilePhotoBase64"], message: "INCOMPLETE_PROFILE_PHOTO" });
  }
});
const driverEnrollmentSchema = z.object({
  vehicleIdentifier: z.string().trim().min(3).max(30),
  cooperativeId: z.string().uuid().nullable().optional(),
  profilePhotoBase64: z.string().min(100).max(3_500_000),
  profilePhotoMime: z.enum(["image/jpeg", "image/png", "image/webp"])
});
const pointSchema = z.object({ longitude: z.number().min(-180).max(180), latitude: z.number().min(-90).max(90) });
const availabilitySchema = z.object({ available: z.boolean(), location: pointSchema.optional() });
const tripDestinationSchema = z.object({
  location: pointSchema,
  reference: z.string().trim().min(1).max(200)
});
const tripRequestSchema = z.object({
  origin: pointSchema,
  destination: pointSchema.optional(),
  destinations: z.array(tripDestinationSchema).min(1).max(3).optional(),
  passengers: z.number().int().min(1).max(3),
  paymentMethod: z.enum(['CASH','DEUNA']).default('CASH'),
  originReference: z.string().max(200).optional(),
  destinationReference: z.string().max(200).optional(),
  notes: z.string().trim().max(300).optional(),
  scheduledFor: z.string().datetime({ offset: true }).optional()
}).refine(value => Boolean(value.destination) !== Boolean(value.destinations), {
  message: "ONE_DESTINATION_FORMAT_REQUIRED",
  path: ["destinations"]
});
const tripActionSchema = z.object({ action: z.enum(["EN_ROUTE", "ARRIVED", "START", "COMPLETE"]) });
const ratingSchema = z.object({ score: z.number().int().min(1).max(5), comment: z.string().trim().max(500).optional(), tags: z.array(z.string().trim().min(1).max(50)).max(5).optional() });
const locationSearchSchema = z.object({
  q: z.string().trim().min(3).max(160),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  serviceAreaId: z.string().uuid().optional()
}).refine(value => (value.latitude == null) === (value.longitude == null));
const reverseLocationSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180)
});
const serviceAreasQuerySchema = z.object({ version: z.coerce.number().int().positive().optional() });
const serviceAreaResolveSchema = pointSchema;
const routeSchema = z.object({
  origin: pointSchema,
  destination: pointSchema,
  waypoints: z.array(pointSchema).max(2).default([]),
  tripId: z.string().uuid().optional(),
  purpose: z.enum(["PRELOAD", "ACTIVE_TRIP", "NAVIGATION", "QUOTE", "MAP"]).optional(),
  includeRouteToken: z.boolean().default(false)
});
const deviceTokenSchema = z.object({
  token: z.string().min(20).max(4096),
  platform: z.enum(["ANDROID", "IOS"]).default("ANDROID"),
  firebaseProjectId: z.string().trim().min(3).max(200).optional()
});
const testPushSchema = z.object({ delaySeconds: z.number().int().min(0).max(15).default(0) });
const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().datetime({ offset: true }).optional(),
  status: z.enum(["ALL", "COMPLETED", "CANCELLED", "SCHEDULED"]).default("ALL")
});
const inboxQuerySchema = pageQuerySchema.pick({ limit: true, cursor: true });
const bannerPlacementSchema = z.object({ placement: z.enum(["PASSENGER_HOME", "DRIVER_HOME"]).default("PASSENGER_HOME") });
const favoritePlaceSchema = z.object({
  label: z.string().trim().min(2).max(50),
  address: z.string().trim().min(3).max(200),
  location: pointSchema
});
const driverDocumentSchema = z.object({
  documentType: z.enum(["PROFILE_PHOTO", "IDENTIFICATION", "LICENSE", "REGISTRATION", "OPERATING_PERMIT"]),
  fileBase64: z.string().min(100).max(7_000_000),
  fileMime: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]),
  expiresAt: z.string().date().optional().or(z.literal(""))
});

const profilePhotoSchema = z.object({
  fileBase64: z.string().min(100).max(3_500_000),
  fileMime: z.enum(["image/jpeg", "image/png", "image/webp"])
});

function decodeImage(fileBase64: string, fileMime: "image/jpeg" | "image/png" | "image/webp"): Buffer {
  const data = Buffer.from(fileBase64, "base64");
  const jpeg = data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const png = data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP";
  const valid = fileMime === "image/jpeg" ? jpeg : fileMime === "image/png" ? png : webp;
  if (!valid || data.length < 100 || data.length > 2_500_000) throw new Error("INVALID_IMAGE_FILE");
  return data;
}

function decodeDriverDocument(value: z.infer<typeof driverDocumentSchema>): Buffer {
  if (value.fileMime.startsWith("image/")) return decodeImage(value.fileBase64, value.fileMime as "image/jpeg" | "image/png" | "image/webp");
  if (value.documentType !== "OPERATING_PERMIT") throw new Error("DOCUMENT_FORMAT_NOT_ALLOWED");
  const data = Buffer.from(value.fileBase64, "base64");
  const pdf = value.fileMime === "application/pdf" && data.subarray(0, 5).toString("ascii") === "%PDF-";
  const doc = value.fileMime === "application/msword" && data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]));
  const docx = value.fileMime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" && data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
  if (data.length < 100 || data.length > 5_000_000 || (!pdf && !doc && !docx)) throw new Error("INVALID_DOCUMENT_FILE");
  return data;
}

function privateTokenHash(value: string): string {
  const pepper = process.env.ADMIN_SESSION_SECRET ?? "costa-go-local-development";
  return createHash("sha256").update(`${pepper}:${value}`).digest("hex");
}

async function issueEmailVerificationCode(userId: string, email: string): Promise<boolean> {
  const [recent] = await database()`select 1 from email_verification_codes
    where user_id=${userId} and created_at > now()-interval '60 seconds' limit 1`;
  if (recent) return true;
  const code = randomInt(100000, 1000000).toString();
  await database().begin(async tx => {
    await tx`update email_verification_codes set used_at=coalesce(used_at,now())
      where user_id=${userId} and used_at is null`;
    await tx`insert into email_verification_codes(user_id,code_hash,expires_at)
      values (${userId},${privateTokenHash(`${email}:${code}`)},now()+interval '15 minutes')`;
  });
  return sendTransactionalEmail({
    to: email,
    subject: "Verifica tu correo en Costa-Go",
    text: `Tu código de verificación es ${code}. Caduca en 15 minutos.`,
    html: `<p>Tu código de verificación de Costa-Go es:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>Caduca en 15 minutos. Si no creaste esta cuenta, ignora este mensaje.</p>`
  });
}

async function eraseUserAccount(userId: string): Promise<"DELETED" | "ACTIVE_TRIP"> {
  const sql = database();
  const [activeTrip] = await sql`
    select id from trips
    where (passenger_id=${userId} or driver_id=${userId})
      and status not in ('COMPLETED','CANCELLED','NO_DRIVER')
    limit 1
  `;
  if (activeTrip) return "ACTIVE_TRIP";
  await sql.begin(async tx => {
    const trips = await tx`select id from trips where passenger_id=${userId} or driver_id=${userId}`;
    const tripIds = trips.map(row => row.id as string);
    if (tripIds.length) {
      await tx`delete from trip_messages where trip_id in ${tx(tripIds)}`;
      await tx`delete from trip_live_locations where trip_id in ${tx(tripIds)}`;
      await tx`delete from trip_location_history where trip_id in ${tx(tripIds)}`;
      await tx`update trip_stops set location=null, reference='Datos eliminados' where trip_id in ${tx(tripIds)}`;
      await tx`update trips set origin=null, destination=null, origin_reference=null,
        destination_reference=null, passenger_notes=null, route_snapshot=null
        where id in ${tx(tripIds)}`;
    }
    await tx`delete from device_tokens where user_id=${userId}`;
    await tx`delete from biometric_credentials where user_id=${userId}`;
    await tx`delete from favorite_places where user_id=${userId}`;
    await tx`delete from user_notifications where user_id=${userId}`;
    await tx`delete from password_reset_tokens where user_id=${userId}`;
    await tx`delete from admin_sessions where user_id=${userId}`;
    await tx`delete from user_service_area_access where user_id=${userId}`;
    await tx`delete from admin_permission_overrides where user_id=${userId}`;
    await tx`delete from email_verification_codes where user_id=${userId}`;
    await tx`delete from mobile_account_roles where user_id=${userId}`;
    await tx`delete from driver_documents where driver_id=${userId}`;
    await tx`delete from support_incident_attachments where uploaded_by=${userId}`;
    await tx`update support_incident_messages set author_id=null,
      body='Contenido eliminado por solicitud del usuario' where author_id=${userId}`;
    await tx`update incidents set reported_by=null, related_user_id=null,
      subject='Solicitud anonimizada', description='Contenido eliminado por solicitud del usuario',
      evidence='[]'::jsonb where reported_by=${userId} or related_user_id=${userId}`;
    await tx`update ratings set comment=null, tags='{}'::text[] where author_id=${userId} or recipient_id=${userId}`;
    await tx`update drivers set is_available=false, last_location=null,
      last_location_at=null where user_id=${userId}`;
    await tx`update vehicles set identifier='DELETED-' || id::text where driver_id=${userId}`;
    await tx`update users set
      full_name='Cuenta eliminada',
      email=${`deleted+${userId}@deleted.invalid`},
      phone_e164=${`deleted:${userId}`},
      password_hash=crypt(${randomBytes(32).toString("hex")}, gen_salt('bf')),
      profile_photo_data=null,
      profile_photo_mime=null,
      profile_photo_updated_at=null,
      cooperative_id=null,
      active_session_id=null,
      status='SUSPENDED',
      deleted_at=now(),
      updated_at=now()
      where id=${userId}`;
    await tx`insert into audit_log(action,entity_type,entity_id,next_value,reason)
      values ('ACCOUNT_DELETED','USER',${userId},'{"anonymized":true}'::jsonb,'Solicitud del titular')`;
  });
  return "DELETED";
}

async function configuredSearchRadius(): Promise<number> {
  const [settings] = await database()`select search_radius_meters from operational_settings where id=1`;
  return Number(settings?.search_radius_meters ?? 3000);
}

export interface ScheduledTripPolicy {
  minimumNoticeMinutes: number;
  activationLeadMinutes: number;
  maximumAdvanceMinutes: number;
}

async function configuredScheduledTripPolicy(): Promise<ScheduledTripPolicy> {
  const [settings] = await database()`
    select scheduled_trip_minimum_notice_minutes as "minimumNoticeMinutes",
      scheduled_trip_lead_minutes as "activationLeadMinutes"
    from operational_settings where id=1
  `;
  return {
    minimumNoticeMinutes: Number(settings?.minimumNoticeMinutes ?? 30),
    activationLeadMinutes: Number(settings?.activationLeadMinutes ?? 10),
    maximumAdvanceMinutes: 24 * 60
  };
}

export function scheduledTimeError(scheduledFor: Date, policy: ScheduledTripPolicy): string | undefined {
  const currentMinute = new Date();
  currentMinute.setSeconds(0, 0);
  const earliest = new Date(currentMinute.getTime() + policy.minimumNoticeMinutes * 60_000);
  const latest = new Date(currentMinute.getTime() + policy.maximumAdvanceMinutes * 60_000);
  if (scheduledFor < earliest) return "SCHEDULE_TOO_SOON";
  if (scheduledFor > latest) return "SCHEDULE_TOO_FAR";
}

export function tripTotalCents(
  price: Record<string, unknown>,
  passengers: number,
  destinationCount: number,
  zone: "URBAN" | "EXTENDED",
  travelAt: Date
): { baseCents: number; stopSurchargeCents: number; totalCents: number } {
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Guayaquil", hour: "2-digit", hour12: false
  }).format(travelAt));
  const baseCents = hour >= 22 || hour < 6
    ? Number(price.night_cents_per_passenger) * passengers
    : zone === "EXTENDED"
      ? Number(price.extended_cents_per_passenger) * passengers
      : Boolean(price.group_promotion_enabled) && passengers === Number(price.group_promotion_passengers)
        ? Number(price.group_promotion_total_cents)
        : Number(price.urban_day_cents_per_passenger) * passengers;
  const stopSurchargeCents = Math.max(0, destinationCount - 1) * Number(price.stop_surcharge_cents ?? 0);
  return { baseCents, stopSurchargeCents, totalCents: baseCents + stopSurchargeCents };
}

async function authenticatedUser(request: { headers: Record<string, string | string[] | undefined> }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }, options: { allowPasswordChange?: boolean; allowPendingDriver?: boolean } = {}) {
  const user = userFrom(request as never);
  if (!user?.id || !user.sessionId) { reply.code(401).send({ error: "UNAUTHORIZED" }); return; }
  const active = await database()`
    select u.must_change_password as "mustChangePassword",u.status,
      d.approval_status as "approvalStatus",
      exists(select 1 from mobile_account_roles mar where mar.user_id=u.id and mar.role=${user.role}) as "roleAllowed"
    from users u left join drivers d on d.user_id=u.id
    where u.id=${user.id} and u.active_session_id=${user.sessionId}::uuid and u.deleted_at is null
  `;
  if (!active.length) { reply.code(401).send({ error: "SESSION_REPLACED" }); return; }
  if (!active[0]?.roleAllowed) { reply.code(403).send({ error: "ROLE_NOT_AVAILABLE" }); return; }
  if (active[0]?.status !== "ACTIVE") { reply.code(403).send({ error: "ACCOUNT_NOT_ACTIVE" }); return; }
  if (user.role === "DRIVER" && active[0]?.approvalStatus !== "APROBADO" && !options.allowPendingDriver) {
    reply.code(403).send({ error: "DRIVER_NOT_APPROVED" });
    return;
  }
  if (active[0]?.mustChangePassword && !options.allowPasswordChange) {
    reply.code(428).send({ error: "PASSWORD_CHANGE_REQUIRED" });
    return;
  }
  return user;
}

const requiredDriverDocuments = ["PROFILE_PHOTO", "IDENTIFICATION", "LICENSE", "REGISTRATION", "OPERATING_PERMIT"] as const;
async function refreshDriverApprovalState(driverId: string, driverName: string) {
  const sql = database();
  const [current] = await sql`select approval_status from drivers where user_id=${driverId}`;
  const [documents] = await sql`
    select count(distinct document_type)::int count from driver_documents
    where driver_id=${driverId} and status<>'SUSPENDED'
      and document_type in ${sql(requiredDriverDocuments)}
  `;
  const complete = Number(documents?.count ?? 0) === requiredDriverDocuments.length;
  const next = complete ? "PENDIENTE_REVISION" : "PENDIENTE_DOCUMENTOS";
  if (["APROBADO", "SUSPENDIDO"].includes(String(current?.approval_status))) return String(current?.approval_status);
  await sql`update drivers set approval_status=${next}, approval_observation=null,
    submitted_for_review_at=case when ${complete} then coalesce(submitted_for_review_at,now()) else null end,
    approval_updated_at=now() where user_id=${driverId}`;
  if (complete && current?.approval_status !== "PENDIENTE_REVISION") {
    void notifyAdministratorsDriverReady(driverId, driverName).catch(() => undefined);
  }
  return next;
}

export async function buildApp() {
  const app = Fastify({ logger: true, bodyLimit: 8 * 1024 * 1024 });
  await app.register(cors, {
    origin: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  });
  await app.register(websocket);
  const realtime = registerRealtimeRoutes(app);
  await registerAdminRoutes(app, realtime);
  await registerSupportRoutes(app);

  app.addHook("onError", async (request, reply, error) => {
    if (reply.statusCode >= 500) {
      captureOperationalError(error, {
        method: request.method,
        route: request.routeOptions.url,
        statusCode: reply.statusCode,
        requestId: request.id
      });
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    if (reply.elapsedTime >= 1500) {
      request.log.warn({
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        elapsedMs: Math.round(reply.elapsedTime)
      }, "slow_request");
    }
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "costa-go-api",
    uptimeSeconds: Math.round(process.uptime()),
    providers: {
      googleMaps: Boolean(process.env.GOOGLE_MAPS_SERVER_API_KEY?.trim()),
      openRouteService: Boolean(process.env.ORS_API_KEY?.trim())
    }
  }));

  app.get("/v1/pricing/config", async () => initialPricingConfig);

  app.get("/v1/cooperatives", async () => {
    if (!process.env.DATABASE_URL) return [];
    return database()`select id::text,name from cooperatives where status='ACTIVE' order by name`;
  });

  app.get("/v1/banners", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    const parsed = bannerPlacementSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_BANNER_PLACEMENT" });
    return await database()`
      select id::text, title, placement, target_url as "targetUrl", starts_at as "startsAt",
        ends_at as "endsAt", sort_order as "sortOrder", updated_at as "updatedAt"
      from affiliate_banners
      where placement=${parsed.data.placement} and active=true and starts_at <= now()
        and (ends_at is null or ends_at > now())
      order by sort_order, starts_at desc
    `;
  });

  app.get("/v1/banners/:id/image", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const [banner] = await database()`
      select image_mime, image_data from affiliate_banners where id=${id}
    `;
    if (!banner) return reply.code(404).send({ error: "NOT_FOUND" });
    return reply.header("Content-Type", String(banner.image_mime))
      .header("Cache-Control", "public, max-age=300, stale-while-revalidate=3600")
      .send(banner.image_data);
  });

  // Cuando un conductor se libera, vuelve a publicar la solicitud más antigua
  // que ya no tenga una oferta vigente. Así una carrera no queda abandonada
  // por haber llegado mientras todos los conductores estaban ocupados.
  async function redispatchOldestTrip(): Promise<{ tripId: string; passengers: number; originReference: string | null; destinationReference: string | null; driverIds: string[] } | null> {
    const searchRadius = await configuredSearchRadius();
    const dispatched = await database().begin(async tx => {
      const [trip] = await tx`
        select t.id::text as "tripId", t.passengers, t.payment_method as "paymentMethod",
          t.origin_reference as "originReference", t.destination_reference as "destinationReference",
          ST_X(t.origin::geometry) as "originLongitude", ST_Y(t.origin::geometry) as "originLatitude"
        from trips t
        where t.status='SEARCHING'
          and (t.scheduled_for is null or t.schedule_status='SCHEDULED_READY')
          and not exists (select 1 from driver_offers o where o.trip_id=t.id and o.responded_at is null and o.expires_at > now())
        order by t.requested_at
        limit 1 for update skip locked
      `;
      if (!trip) return null;
      const candidates = await tx`
        select d.user_id from drivers d join users u on u.id=d.user_id
        where d.is_available=true and u.status='ACTIVE' and d.last_location is not null
          and (${trip.paymentMethod}='CASH' or d.deuna_enabled=true)
          and d.last_location_at > now() - interval '5 minutes'
          and not exists (select 1 from trips active_trip where active_trip.driver_id=d.user_id and active_trip.status in ('ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS'))
          and ST_DWithin(d.last_location, ST_SetSRID(ST_MakePoint(${trip.originLongitude}, ${trip.originLatitude}),4326)::geography, ${searchRadius})
        order by ST_Distance(d.last_location, ST_SetSRID(ST_MakePoint(${trip.originLongitude}, ${trip.originLatitude}),4326)::geography)
        limit 3
      `;
      for (const candidate of candidates) await tx`
        insert into driver_offers (trip_id, driver_id, expires_at) values (${trip.tripId}, ${candidate.user_id}, now() + interval '2 minutes')
        on conflict (trip_id, driver_id) do update set offered_at=now(), expires_at=excluded.expires_at, responded_at=null, accepted=null
      `;
      return { tripId: String(trip.tripId), passengers: Number(trip.passengers), originReference: trip.originReference as string | null, destinationReference: trip.destinationReference as string | null, driverIds: candidates.map(candidate => String(candidate.user_id)) };
    });
    if (dispatched) {
      const eventAt = new Date().toISOString();
      for (const driverId of dispatched.driverIds) realtime.publishToUser(driverId, { type: "trip:offer", tripId: dispatched.tripId, eventAt });
      const pushes = await Promise.all(dispatched.driverIds.map(driverId => sendPush(driverId, "Nuevo viaje cercano", `${dispatched.passengers} pasajero(s): ${dispatched.originReference ?? "Origen"} → ${dispatched.destinationReference ?? "Destino"}`, { tripId: dispatched.tripId, type: "TRIP_OFFER", eventAt })));
      const failed = pushes.filter(push => push.sent === 0);
      if (failed.length) app.log.warn({
        type: "TRIP_OFFER", tripId: dispatched.tripId,
        recipients: dispatched.driverIds.length, undelivered: failed.length,
        errorCodes: failed.map(push => push.errorCode ?? "firebase/no-delivery")
      }, "trip_offer_push_not_delivered");
    }
    return dispatched;
  }

  async function activateScheduledTrips(): Promise<void> {
    const { activationLeadMinutes: leadMinutes } = await configuredScheduledTripPolicy();
    const due = await database()`
      select id::text as "tripId", passenger_id::text as "passengerId",
        driver_id::text as "driverId", scheduled_for as "scheduledFor",
        schedule_status as "scheduleStatus"
      from trips
      where scheduled_for is not null
        and schedule_status in ('SCHEDULED','SCHEDULED_ASSIGNED')
        and status='SEARCHING'
        and scheduled_for <= now() + (${leadMinutes} * interval '1 minute')
      order by scheduled_for
      limit 20
    `;
    for (const item of due) {
      const activated = await database().begin(async tx => {
        if (item.driverId) {
          const [busy] = await tx`
            select 1 from trips where driver_id=${item.driverId} and id<>${item.tripId}
              and status in ('ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS')
            limit 1
          `;
          if (busy) {
            const [released] = await tx`
              update trips set driver_id=null, assigned_at=null, schedule_status='SCHEDULED_READY'
              where id=${item.tripId} and status='SEARCHING' and schedule_status='SCHEDULED_ASSIGNED'
              returning id
            `;
            if (!released) return "SKIPPED" as const;
            await tx`insert into trip_events (trip_id, from_status, to_status, reason_code, metadata) values (${item.tripId}, 'SEARCHING', 'SEARCHING', 'SCHEDULED_DRIVER_BUSY', ${JSON.stringify({ releasedDriverId: item.driverId })}::jsonb)`;
            return "RELEASED" as const;
          }
          const [ready] = await tx`
            update trips set status='ASSIGNED', schedule_status='SCHEDULED_READY',
              schedule_activated_at=now(), passenger_reminder_sent_at=now(), driver_reminder_sent_at=now()
            where id=${item.tripId} and status='SEARCHING' and schedule_status='SCHEDULED_ASSIGNED'
            returning id
          `;
          if (!ready) return "SKIPPED" as const;
          await tx`update drivers set is_available=false where user_id=${item.driverId}`;
          await tx`
            update driver_offers set responded_at=now(), accepted=false
            where driver_id=${item.driverId} and responded_at is null
          `;
          await tx`insert into trip_events (trip_id, from_status, to_status, reason_code, metadata) values (${item.tripId}, 'SEARCHING', 'ASSIGNED', 'SCHEDULED_READY', ${JSON.stringify({ leadMinutes })}::jsonb)`;
          return "ASSIGNED" as const;
        }
        const [ready] = await tx`
          update trips set schedule_status='SCHEDULED_READY', schedule_activated_at=now(), passenger_reminder_sent_at=now()
          where id=${item.tripId} and status='SEARCHING' and schedule_status='SCHEDULED'
          returning id
        `;
        return ready ? "UNASSIGNED" as const : "SKIPPED" as const;
      });
      if (activated === "ASSIGNED") {
        const activationEvent = {
          type: "trip:status",
          tripId: String(item.tripId),
          status: "ASSIGNED",
          scheduleStatus: "SCHEDULED_READY"
        };
        realtime.publishToUser(String(item.passengerId), activationEvent);
        realtime.publishToUser(String(item.driverId), activationEvent);
        await Promise.all([
          sendPush(String(item.passengerId), "Tu viaje programado está próximo", "El conductor asignado se preparará para dirigirse al origen.", { tripId: String(item.tripId), type: "SCHEDULED_TRIP_REMINDER" }),
          sendPush(String(item.driverId), `Viaje programado en ${leadMinutes} minutos`, "Abre Costa-Go para iniciar el desplazamiento al origen.", { tripId: String(item.tripId), type: "SCHEDULED_DRIVER_REMINDER" })
        ]);
        realtime.publishTripStatus(String(item.tripId), "ASSIGNED");
      } else if (activated === "RELEASED") {
        await Promise.all([
          sendPush(String(item.passengerId), "Buscando otro conductor", "La reserva fue liberada y se está ofreciendo nuevamente.", { tripId: String(item.tripId), type: "SCHEDULED_TRIP_RELEASED" }),
          sendPush(String(item.driverId), "Reserva liberada", "No fue posible iniciar el viaje programado mientras tenías otro viaje activo.", { tripId: String(item.tripId), type: "SCHEDULED_TRIP_RELEASED" })
        ]);
        await redispatchOldestTrip();
      } else if (activated === "UNASSIGNED") {
        await sendPush(String(item.passengerId), "Buscando conductor", "Tu viaje programado ya está próximo; iniciamos la búsqueda.", { tripId: String(item.tripId), type: "SCHEDULED_TRIP_REMINDER" });
        await redispatchOldestTrip();
      }
    }
  }

  app.get("/v1/locations/search", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    const parsed = locationSearchSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_LOCATION_QUERY" });
    try {
      const focus = parsed.data.latitude == null ? undefined : {
        latitude: parsed.data.latitude,
        longitude: parsed.data.longitude!
      };
      const bounds = parsed.data.serviceAreaId
        ? await serviceAreaBounds(parsed.data.serviceAreaId, user.id!)
        : undefined;
      if (parsed.data.serviceAreaId && !bounds) {
        return reply.code(403).send({ error: "SERVICE_AREA_NOT_ALLOWED" });
      }
      // Google Places busca por texto y cercania. La ServiceArea se aplica
      // despues como filtro espacial exacto; no se envian sus bounds al
      // proveedor porque los poligonos irregulares pueden excluir resultados
      // validos o provocar respuestas incompatibles.
      const locations = await searchLocations(parsed.data.q, focus);
      if (!parsed.data.serviceAreaId) return locations;
      let allowedIndexes = new Set(await filterLocationsToArea(
        parsed.data.serviceAreaId,
        user.id!,
        locations
      ));
      const allowedLocations = locations.filter((_, index) => allowedIndexes.has(index));
      if (allowedLocations.length) return allowedLocations;

      // Irregular polygons can occupy only part of their rectangular bounds.
      // If Google ranks only candidates in one of the excluded corners, retry
      // with a location bias and apply the exact same polygon validation.
      const retryLocations = bounds
        ? await searchLocationsInArea(parsed.data.q, focus, bounds)
        : await searchLocations(parsed.data.q, focus);
      allowedIndexes = new Set(await filterLocationsToArea(
        parsed.data.serviceAreaId,
        user.id!,
        retryLocations
      ));
      return retryLocations.filter((_, index) => allowedIndexes.has(index));
    } catch (error) {
      request.log.warn({
        queryLength: parsed.data.q.length,
        hasFocus: parsed.data.latitude != null,
        hasServiceArea: Boolean(parsed.data.serviceAreaId),
        reason: error instanceof Error ? error.message : "unknown"
      }, "location_search_failed");
      return reply.code(502).send({ error: "GEOCODER_UNAVAILABLE" });
    }
  });

  app.get("/v1/service-areas", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    const parsed = serviceAreasQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_SERVICE_AREA_QUERY" });
    return authorizedServiceAreas(user.id!, parsed.data.version);
  });

  app.post("/v1/service-areas/resolve", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    const parsed = serviceAreaResolveSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_LOCATION" });
    const area = await resolveServiceArea(user.id!, parsed.data);
    if (area) return { area };
    const error = await serviceAreaAccessError(user.id!, parsed.data);
    const status = error === "SERVICE_AREA_NOT_ALLOWED" ? 403 : 422;
    return reply.code(status).send({ error: error ?? "OUTSIDE_SERVICE_AREA" });
  });

  app.post("/v1/routes", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    const parsed = routeSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "INVALID_ROUTE" });
    try {
      const { origin, destination, waypoints } = parsed.data;
      const startedAt = performance.now();
      const route = await computeRoute(origin, destination, waypoints, {
        includeRouteToken: parsed.data.includeRouteToken
      });
      request.log.info({
        tripId: parsed.data.tripId,
        purpose: parsed.data.purpose ?? "MAP",
        provider: route.provider,
        cacheHit: route.cacheHit,
        durationMs: Math.round(performance.now() - startedAt),
        points: route.points.length,
        stops: waypoints.length,
        routeToken: Boolean(route.routeToken)
      }, "route_loaded");
      return route;
    } catch (error) {
      if ((error as Error).message === "ROUTING_NOT_CONFIGURED") {
        return reply.code(503).send({
          error: "ROUTING_NOT_CONFIGURED",
          message: "Configura GOOGLE_MAPS_SERVER_API_KEY u ORS_API_KEY."
        });
      }
      return reply.code(502).send({ error: "ROUTING_UNAVAILABLE" });
    }
  });

  app.post("/v1/auth/email-verification/request", async (request, reply) => {
    const parsed = emailVerificationRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_EMAIL" });
    const email = normalizeEmail(parsed.data.email);
    const [account] = await database()`select id::text,email,email_verified_at as "verifiedAt"
      from users where lower(email)=lower(${email}) and deleted_at is null
        and exists(select 1 from mobile_account_roles where user_id=users.id) limit 1`;
    if (account && !account.verifiedAt) {
      const delivered = await issueEmailVerificationCode(String(account.id), String(account.email));
      request.log.info({ delivered }, "email_verification_requested");
    }
    return reply.code(202).send({ accepted: true });
  });

  app.post("/v1/auth/email-verification/confirm", async (request, reply) => {
    const parsed = emailVerificationConfirmSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_EMAIL_VERIFICATION" });
    const email = normalizeEmail(parsed.data.email);
    const hash = privateTokenHash(`${email}:${parsed.data.code}`);
    const [verification] = await database()`select verification.id,verification.user_id as "userId",
        users.full_name as name,coalesce(users.last_mobile_role,users.role::text) role,drivers.approval_status as "approvalStatus",
        array(select mar.role from mobile_account_roles mar where mar.user_id=users.id order by mar.role) roles
      from email_verification_codes verification
      join users on users.id=verification.user_id
      left join drivers on drivers.user_id=users.id
      where lower(users.email)=lower(${email}) and verification.code_hash=${hash}
        and verification.used_at is null and verification.expires_at>now() and verification.attempts<5
      order by verification.created_at desc limit 1`;
    if (!verification) {
      await database()`update email_verification_codes set attempts=attempts+1
        where id=(select verification.id from email_verification_codes verification
          join users on users.id=verification.user_id
          where lower(users.email)=lower(${email}) and verification.used_at is null
          order by verification.created_at desc limit 1)`;
      return reply.code(400).send({ error: "INVALID_OR_EXPIRED_EMAIL_CODE" });
    }
    const sessionId = randomUUID();
    await database().begin(async tx => {
      await tx`update email_verification_codes set used_at=now() where id=${verification.id}`;
      await tx`update users set email_verified_at=now(),status='ACTIVE',
          active_session_id=${sessionId},updated_at=now() where id=${verification.userId}`;
    });
    const user: SessionUser = {
      id: String(verification.userId),
      email,
      name: String(verification.name),
      role: verification.role as "PASSENGER" | "DRIVER",
      sessionId,
      mustChangePassword: false,
      driverApprovalStatus: verification.approvalStatus ? String(verification.approvalStatus) : undefined
      ,availableRoles: (verification.roles as Array<"PASSENGER" | "DRIVER">) ?? [verification.role as "PASSENGER" | "DRIVER"]
    };
    return {
      verified: true,
      token: tokenFor(user),
      user,
      restricted: user.role === "DRIVER"
    };
  });

  app.post("/v1/auth/password-reset/request", async (request, reply) => {
    const parsed = passwordResetRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_EMAIL" });
    const normalizedEmail = parsed.data.email.trim().toLowerCase();
    const [account] = await database()`
      select id, email from users
      where lower(email)=lower(${normalizedEmail})
        and exists(select 1 from mobile_account_roles where user_id=users.id)
        and deleted_at is null
      limit 1
    `;
    if (!account) return reply.code(404).send({ error: "EMAIL_NOT_FOUND" });
    {
      const [recent] = await database()`
        select 1 from password_reset_tokens
        where user_id=${account.id} and created_at > now() - interval '60 seconds'
        limit 1
      `;
      if (!recent) {
        const code = randomInt(100000, 1000000).toString();
        await database().begin(async tx => {
          await tx`update password_reset_tokens set used_at=coalesce(used_at,now())
            where user_id=${account.id} and used_at is null`;
          await tx`insert into password_reset_tokens(user_id,code_hash,expires_at)
            values (${account.id},${privateTokenHash(`${normalizedEmail}:${code}`)},now()+interval '15 minutes')`;
        });
        const delivered = await sendTransactionalEmail({
          to: account.email as string,
          subject: "Código para recuperar tu cuenta Costa-Go",
          text: `Tu código de recuperación es ${code}. Caduca en 15 minutos. Si no solicitaste este cambio, ignora este mensaje.`,
          html: `<p>Tu código de recuperación de Costa-Go es:</p><p style="font-size:28px;font-weight:700;letter-spacing:5px">${code}</p><p>Caduca en 15 minutos. Si no solicitaste este cambio, ignora este mensaje.</p>`
        });
        request.log.info({ delivered }, "password_reset_requested");
      }
    }
    return reply.code(202).send({ accepted: true });
  });

  app.post("/v1/auth/password-reset/confirm", async (request, reply) => {
    const parsed = passwordResetConfirmSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_PASSWORD_RESET" });
    const email = parsed.data.email.trim().toLowerCase();
    const hash = privateTokenHash(`${email}:${parsed.data.code}`);
    const [token] = await database()`
      select reset.id, reset.user_id as "userId"
      from password_reset_tokens reset join users u on u.id=reset.user_id
      where lower(u.email)=lower(${email}) and reset.code_hash=${hash}
        and reset.used_at is null and reset.expires_at > now() and reset.attempts < 5
        and u.deleted_at is null
      order by reset.created_at desc limit 1
    `;
    if (!token) {
      await database()`update password_reset_tokens set attempts=attempts+1
        where id=(select reset.id from password_reset_tokens reset join users u on u.id=reset.user_id
          where lower(u.email)=lower(${email}) and reset.used_at is null
          order by reset.created_at desc limit 1)`;
      return reply.code(400).send({ error: "INVALID_OR_EXPIRED_RESET_CODE" });
    }
    const [samePassword] = await database()`select 1 from users
      where id=${token.userId} and password_hash=crypt(${parsed.data.password},password_hash)`;
    if (samePassword) return reply.code(409).send({ error: "PASSWORD_REUSED" });
    await database().begin(async tx => {
      await tx`update users set password_hash=crypt(${parsed.data.password},gen_salt('bf')),
        must_change_password=false, email_verified_at=coalesce(email_verified_at,now()),
        status='ACTIVE',
        active_session_id=null, updated_at=now()
        where id=${token.userId}`;
      await tx`update password_reset_tokens set used_at=now() where id=${token.id}`;
      await tx`delete from device_tokens where user_id=${token.userId}`;
      await tx`delete from biometric_credentials where user_id=${token.userId}`;
      await tx`update drivers set is_available=false where user_id=${token.userId}`;
    });
    return { changed: true };
  });

  app.post("/v1/account-deletion/request", async (request, reply) => {
    const parsed = externalDeletionRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_EMAIL" });
    const email = parsed.data.email.trim().toLowerCase();
    const [account] = await database()`select id,email from users
      where lower(email)=lower(${email}) and deleted_at is null
        and exists(select 1 from mobile_account_roles where user_id=users.id) limit 1`;
    if (account) {
      const token = randomBytes(32).toString("hex");
      await database()`insert into account_deletion_requests(user_id,requested_email,token_hash,expires_at)
        values (${account.id},${email},${privateTokenHash(token)},now()+interval '24 hours')`;
      const webBase = (process.env.PUBLIC_WEB_BASE_URL ?? "https://mototaxi-atacames-admin.onrender.com").replace(/\/$/, "");
      const url = `${webBase}/account-deletion.html?token=${encodeURIComponent(token)}`;
      const delivered = await sendTransactionalEmail({
        to: account.email as string,
        subject: "Confirma la eliminación de tu cuenta Costa-Go",
        text: `Confirma la eliminación de tu cuenta dentro de las próximas 24 horas: ${url}`,
        html: `<p>Solicitaste eliminar tu cuenta Costa-Go y sus datos asociados.</p><p><a href="${url}">Confirmar eliminación de cuenta</a></p><p>El enlace caduca en 24 horas. Si no fuiste tú, ignora este mensaje.</p>`
      });
      request.log.info({ delivered }, "external_account_deletion_requested");
    }
    return reply.code(202).send({ accepted: true });
  });

  app.post("/v1/account-deletion/confirm", async (request, reply) => {
    const parsed = externalDeletionConfirmSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_DELETION_TOKEN" });
    const [deletion] = await database()`select id,user_id as "userId"
      from account_deletion_requests where token_hash=${privateTokenHash(parsed.data.token)}
        and confirmed_at is null and completed_at is null and expires_at > now() limit 1`;
    if (!deletion?.userId) return reply.code(400).send({ error: "INVALID_DELETION_TOKEN" });
    let result: "DELETED" | "ACTIVE_TRIP";
    try {
      result = await eraseUserAccount(deletion.userId as string);
    } catch (error) {
      request.log.error({ err: error, userId: deletion.userId }, "external_account_deletion_failed");
      return reply.code(500).send({ error: "ACCOUNT_DELETION_FAILED" });
    }
    if (result === "ACTIVE_TRIP") return reply.code(409).send({ error: "ACCOUNT_DELETION_BLOCKED_ACTIVE_TRIP" });
    await database()`update account_deletion_requests set confirmed_at=now(),completed_at=now(),user_id=null
      where id=${deletion.id}`;
    return { deleted: true };
  });

  app.post("/v1/auth/session", async (request, reply) => {
    const parsed = mobileLoginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_LOGIN" });
    if (!process.env.DATABASE_URL) {
      return reply.code(503).send({ error: "AUTH_DATABASE_UNAVAILABLE" });
    }

    const rows = await database()`
      select u.id,u.email,u.full_name,u.role,u.last_mobile_role as "lastMobileRole",u.status,
        u.email_verified_at as "emailVerifiedAt",u.must_change_password as "mustChangePassword",
        d.approval_status as "approvalStatus",
        array(select mar.role from mobile_account_roles mar where mar.user_id=u.id order by mar.role) roles
      from users u left join drivers d on d.user_id=u.id
      where lower(email) = lower(${parsed.data.email})
        and password_hash = crypt(${parsed.data.password}, password_hash)
        and role in ('PASSENGER', 'DRIVER')
        and deleted_at is null
    `;
    const account = rows[0] as { id: string; email: string; full_name: string; role: "PASSENGER" | "DRIVER"; lastMobileRole?: "PASSENGER" | "DRIVER"; roles: Array<"PASSENGER" | "DRIVER">; status: string; emailVerifiedAt?: Date; mustChangePassword: boolean; approvalStatus?: string } | undefined;
    if (!account) return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
    if (!account.emailVerifiedAt) return reply.code(403).send({ error: "EMAIL_VERIFICATION_REQUIRED" });
    if (account.status !== "ACTIVE") return reply.code(403).send({ error: "ACCOUNT_NOT_ACTIVE" });
    const activeRole = parsed.data.role ?? account.lastMobileRole ?? account.role;
    if (!account.roles.includes(activeRole)) return reply.code(403).send({ error: "ROLE_NOT_AVAILABLE" });
    if (activeRole === "DRIVER" && account.approvalStatus === "RECHAZADO") return reply.code(403).send({ error: "DRIVER_REJECTED" });
    if (activeRole === "DRIVER" && account.approvalStatus === "SUSPENDIDO") return reply.code(403).send({ error: "DRIVER_SUSPENDED" });

    const sessionId = randomUUID();
    await database().begin(async tx => {
      await tx`delete from biometric_credentials where user_id=${account.id}`;
      await tx`update users set active_session_id=${sessionId},last_mobile_role=${activeRole} where id=${account.id}`;
    });
    const user: SessionUser = { id: account.id, email: account.email, name: account.full_name, role: activeRole, sessionId, mustChangePassword: account.mustChangePassword, driverApprovalStatus: account.approvalStatus, availableRoles: account.roles };
    return { token: tokenFor(user), user, restricted: activeRole === "DRIVER" && account.approvalStatus !== "APROBADO" };
  });

  app.post("/v1/auth/biometric/enroll", async (request, reply) => {
    const user = await authenticatedUser(request, reply, { allowPasswordChange: true, allowPendingDriver: true }); if (!user) return;
    const credential = randomBytes(32).toString("hex");
    const hash = privateTokenHash(`biometric:${credential}`);
    await database()`insert into biometric_credentials(user_id,secret_hash)
      values (${user.id!},${hash})
      on conflict (user_id) do update set secret_hash=excluded.secret_hash,
        created_at=now(),last_used_at=null,revoked_at=null`;
    return { credential };
  });

  app.delete("/v1/auth/biometric", async (request, reply) => {
    const user = await authenticatedUser(request, reply, { allowPasswordChange: true, allowPendingDriver: true }); if (!user) return;
    await database()`delete from biometric_credentials where user_id=${user.id!}`;
    return { disabled: true };
  });

  app.post("/v1/auth/biometric/session", async (request, reply) => {
    const parsed = biometricSessionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_BIOMETRIC_CREDENTIAL" });
    const hash = privateTokenHash(`biometric:${parsed.data.credential}`);
    const [account] = await database()`select u.id::text,u.email,u.full_name,u.role,
        u.last_mobile_role as "lastMobileRole",u.status,u.email_verified_at as "emailVerifiedAt",
        u.must_change_password as "mustChangePassword",d.approval_status as "approvalStatus",
        array(select mar.role from mobile_account_roles mar where mar.user_id=u.id order by mar.role) roles
      from biometric_credentials biometric
      join users u on u.id=biometric.user_id
      left join drivers d on d.user_id=u.id
      where biometric.secret_hash=${hash} and biometric.revoked_at is null and u.deleted_at is null
      limit 1`;
    if (!account) return reply.code(401).send({ error: "INVALID_BIOMETRIC_CREDENTIAL" });
    if (!account.emailVerifiedAt || account.status !== "ACTIVE") {
      return reply.code(403).send({ error: "ACCOUNT_NOT_ACTIVE" });
    }
    const roles = account.roles as Array<"PASSENGER" | "DRIVER">;
    const activeRole = parsed.data.role ?? account.lastMobileRole ?? account.role as "PASSENGER" | "DRIVER";
    if (!roles.includes(activeRole)) return reply.code(403).send({ error: "ROLE_NOT_AVAILABLE" });
    if (activeRole === "DRIVER" && account.approvalStatus === "RECHAZADO") return reply.code(403).send({ error: "DRIVER_REJECTED" });
    if (activeRole === "DRIVER" && account.approvalStatus === "SUSPENDIDO") return reply.code(403).send({ error: "DRIVER_SUSPENDED" });
    const sessionId = randomUUID();
    await database().begin(async tx => {
      await tx`update users set active_session_id=${sessionId},last_mobile_role=${activeRole} where id=${account.id}`;
      await tx`update biometric_credentials set last_used_at=now() where user_id=${account.id}`;
    });
    const sessionUser: SessionUser = {
      id: String(account.id), email: String(account.email), name: String(account.full_name), role: activeRole,
      sessionId, mustChangePassword: Boolean(account.mustChangePassword),
      driverApprovalStatus: account.approvalStatus ? String(account.approvalStatus) : undefined,
      availableRoles: roles
    };
    return { token: tokenFor(sessionUser), user: sessionUser,
      restricted: activeRole === "DRIVER" && account.approvalStatus !== "APROBADO" };
  });

  app.post("/v1/auth/change-password", async (request, reply) => {
    const user = await authenticatedUser(request, reply, { allowPasswordChange: true, allowPendingDriver: true }); if (!user) return;
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_PASSWORD" });
    const [updated] = await database().begin(async tx => {
      const rows = await tx`update users
        set password_hash=crypt(${parsed.data.password}, gen_salt('bf')),
            must_change_password=false,updated_at=now()
        where id=${user.id!}
          and (must_change_password=true or (${parsed.data.currentPassword ?? ""} <> ''
            and password_hash=crypt(${parsed.data.currentPassword ?? ""}, password_hash)))
          and password_hash <> crypt(${parsed.data.password}, password_hash)
        returning id::text`;
      if (rows.length) await tx`delete from biometric_credentials where user_id=${user.id!}`;
      return rows;
    });
    if (!updated) {
      const [samePassword] = await database()`select 1 from users where id=${user.id!} and password_hash=crypt(${parsed.data.password}, password_hash)`;
      return reply.code(samePassword ? 409 : 401).send({ error: samePassword ? "PASSWORD_REUSED" : "INVALID_CURRENT_PASSWORD" });
    }
    return { changed: true };
  });

  app.post("/v1/auth/register", async (request, reply) => {
    const parsed = registrationSchema.safeParse(request.body);
    if (!parsed.success) {
      const weakPassword = parsed.error.issues.some(issue => issue.path[0] === "password");
      return reply.code(400).send({
        error: weakPassword ? "WEAK_PASSWORD" : "INVALID_REGISTRATION",
        message: weakPassword ? passwordPolicyMessage : undefined,
        details: parsed.error.issues
      });
    }
    const input = parsed.data;
    const normalizedEmail = normalizeEmail(input.email);
    const normalizedPhone = normalizePhone(input.phone);
    if (!normalizedPhone) return reply.code(400).send({ error: "INVALID_PHONE" });
    if (input.role === "DRIVER" && !input.vehicleIdentifier) return reply.code(400).send({ error: "VEHICLE_REQUIRED" });
    let profilePhoto: Buffer | null = null;
    if (input.profilePhotoBase64 && input.profilePhotoMime) {
      try { profilePhoto = decodeImage(input.profilePhotoBase64, input.profilePhotoMime); }
      catch { return reply.code(400).send({ error: "INVALID_PROFILE_PHOTO" }); }
    }
    try {
      const phoneAliases = legacyPhoneAliases(normalizedPhone);
      const [duplicates] = await database()`
        select
          exists(select 1 from users where lower(email)=lower(${normalizedEmail}) and deleted_at is null) as "emailExists",
          exists(select 1 from users where phone_e164 in ${database()(phoneAliases)} and deleted_at is null) as "phoneExists",
          ${input.role === "DRIVER" && input.vehicleIdentifier
            ? database()`exists(select 1 from vehicles where lower(identifier)=lower(${input.vehicleIdentifier.trim()}))`
            : database()`false`} as "vehicleExists"
      ` as unknown as [{ emailExists: boolean; phoneExists: boolean; vehicleExists: boolean }];
      if (duplicates.emailExists) return reply.code(409).send({ error: "EMAIL_ALREADY_EXISTS" });
      if (duplicates.phoneExists) return reply.code(409).send({ error: "PHONE_ALREADY_EXISTS" });
      if (duplicates.vehicleExists) return reply.code(409).send({ error: "VEHICLE_ALREADY_EXISTS" });
      const account = await database().begin(async tx => {
        if (input.role === "DRIVER" && input.cooperativeId) {
          const cooperative = await tx`select id from cooperatives where id=${input.cooperativeId} and status='ACTIVE'`;
          if (!cooperative.length) throw new Error("INVALID_COOPERATIVE");
        }
        const status = "PENDING";
        const [user] = await tx`
          insert into users (phone_e164, full_name, email, password_hash, role, status, cooperative_id, phone_verified_at, terms_accepted_at,
            profile_photo_data, profile_photo_mime, profile_photo_updated_at)
          values (${normalizedPhone}, ${input.fullName}, ${normalizedEmail}, crypt(${input.password}, gen_salt('bf')), ${input.role}, ${status}, ${input.role === "DRIVER" ? input.cooperativeId ?? null : null}, null, now(),
            ${profilePhoto}, ${input.profilePhotoMime ?? null}, ${profilePhoto ? new Date() : null})
          returning id, email, full_name, role, status
        `;
        await tx`insert into mobile_account_roles(user_id,role) values (${user!.id},'PASSENGER') on conflict do nothing`;
        if (input.role === "DRIVER") {
          await tx`insert into mobile_account_roles(user_id,role) values (${user!.id},'DRIVER') on conflict do nothing`;
          await tx`insert into drivers (user_id, is_available, approval_status) values (${user!.id}, false, 'PENDIENTE_DOCUMENTOS')`;
          await tx`insert into vehicles (driver_id, identifier, maximum_passengers, status) values (${user!.id}, ${input.vehicleIdentifier!}, 3, 'PENDING')`;
          await tx`insert into driver_documents
            (driver_id, document_type, file_url, file_data, file_mime, status)
            values (${user!.id}, 'PROFILE_PHOTO', 'database', ${profilePhoto!}, ${input.profilePhotoMime!}, 'PENDING')`;
        }
        await tx`update users set last_mobile_role=${input.role} where id=${user!.id}`;
        return user!;
      });
      const delivered = await issueEmailVerificationCode(String(account.id), String(account.email));
      return reply.code(201).send({
        status: "PENDING_EMAIL_VERIFICATION",
        verificationRequired: true,
        delivered,
        email: account.email,
        role: account.role,
        message: delivered
          ? "Te enviamos un código para verificar tu correo."
          : "La cuenta fue creada, pero el correo no pudo enviarse. Solicita un código nuevo."
      });
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_COOPERATIVE") return reply.code(400).send({ error: error.message });
      const code = (error as { code?: string }).code;
      if (code === "23505") {
        const constraint = String((error as { constraint_name?: string }).constraint_name ?? "");
        if (constraint.includes("email")) return reply.code(409).send({ error: "EMAIL_ALREADY_EXISTS" });
        if (constraint.includes("phone")) return reply.code(409).send({ error: "PHONE_ALREADY_EXISTS" });
        if (constraint.includes("identifier")) return reply.code(409).send({ error: "VEHICLE_ALREADY_EXISTS" });
        return reply.code(409).send({ error: "ACCOUNT_ALREADY_EXISTS" });
      }
      throw error;
    }
  });

  app.post("/v1/auth/switch-role", async (request, reply) => {
    const user = await authenticatedUser(request, reply, { allowPasswordChange: true, allowPendingDriver: true }); if (!user) return;
    const parsed = switchMobileRoleSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_ROLE" });
    const targetRole = parsed.data.role;
    const [capability] = await database()`select 1 from mobile_account_roles where user_id=${user.id!} and role=${targetRole}`;
    if (!capability) return reply.code(403).send({ error: "ROLE_NOT_AVAILABLE" });
    const [activeTrip] = await database()`select id::text from trips where status in ('SEARCHING','ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS')
      and ((${targetRole}='DRIVER' and passenger_id=${user.id!}) or (${targetRole}='PASSENGER' and driver_id=${user.id!})) limit 1`;
    if (activeTrip) return reply.code(409).send({ error: "ROLE_SWITCH_BLOCKED_ACTIVE_TRIP" });
    const [account] = await database()`select u.email,u.full_name,d.approval_status as "approvalStatus",
      array(select mar.role from mobile_account_roles mar where mar.user_id=u.id order by mar.role) roles
      from users u left join drivers d on d.user_id=u.id where u.id=${user.id!}`;
    if (!account) return reply.code(404).send({ error: "NOT_FOUND" });
    if (user.role === "DRIVER") await database()`update drivers set is_available=false where user_id=${user.id!}`;
    const nextSessionId=randomUUID();
    await database()`update users set last_mobile_role=${targetRole},active_session_id=${nextSessionId} where id=${user.id!}`;
    const next: SessionUser = { id:user.id,email:String(account.email),name:String(account.full_name),role:targetRole,
      sessionId:nextSessionId,mustChangePassword:user.mustChangePassword,driverApprovalStatus:account.approvalStatus ? String(account.approvalStatus) : undefined,
      availableRoles:account.roles as Array<"PASSENGER" | "DRIVER"> };
    return { token:tokenFor(next),user:next,restricted:targetRole==="DRIVER" && account.approvalStatus!=="APROBADO" };
  });

  app.post("/v1/profile/driver-enrollment", async (request, reply) => {
    const user = await authenticatedUser(request, reply, { allowPendingDriver: true }); if (!user) return;
    const parsed = driverEnrollmentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error:"INVALID_DRIVER_ENROLLMENT",details:parsed.error.issues });
    let photo: Buffer;
    try { photo=decodeImage(parsed.data.profilePhotoBase64,parsed.data.profilePhotoMime); }
    catch { return reply.code(400).send({ error:"INVALID_PROFILE_PHOTO" }); }
    const nextSessionId=randomUUID();
    try {
      await database().begin(async tx=>{
        const existing=await tx`select 1 from drivers where user_id=${user.id!}`;
        if(existing.length)throw new Error("DRIVER_PROFILE_ALREADY_EXISTS");
        const vehicle=await tx`select 1 from vehicles where lower(identifier)=lower(${parsed.data.vehicleIdentifier})`;
        if(vehicle.length)throw new Error("VEHICLE_ALREADY_EXISTS");
        if(parsed.data.cooperativeId){const coop=await tx`select 1 from cooperatives where id=${parsed.data.cooperativeId} and status='ACTIVE'`;if(!coop.length)throw new Error("INVALID_COOPERATIVE");}
        await tx`update users set cooperative_id=${parsed.data.cooperativeId??null},profile_photo_data=${photo},profile_photo_mime=${parsed.data.profilePhotoMime},profile_photo_updated_at=now(),last_mobile_role='DRIVER',active_session_id=${nextSessionId},updated_at=now() where id=${user.id!}`;
        await tx`insert into mobile_account_roles(user_id,role) values (${user.id!},'DRIVER')`;
        await tx`insert into drivers(user_id,is_available,approval_status) values (${user.id!},false,'PENDIENTE_DOCUMENTOS')`;
        await tx`insert into vehicles(driver_id,identifier,maximum_passengers,status) values (${user.id!},${parsed.data.vehicleIdentifier},3,'PENDING')`;
        await tx`insert into driver_documents(driver_id,document_type,file_url,file_data,file_mime,status) values (${user.id!},'PROFILE_PHOTO','database',${photo},${parsed.data.profilePhotoMime},'PENDING')`;
      });
    } catch(error) {
      const code=error instanceof Error ? error.message : "INVALID_DRIVER_ENROLLMENT";
      if(["DRIVER_PROFILE_ALREADY_EXISTS","VEHICLE_ALREADY_EXISTS"].includes(code))return reply.code(409).send({error:code});
      if(code==="INVALID_COOPERATIVE")return reply.code(400).send({error:code});
      throw error;
    }
    const [account]=await database()`select email,full_name from users where id=${user.id!}`;
    if(!account)return reply.code(404).send({error:"NOT_FOUND"});
    const next:SessionUser={id:user.id,email:String(account.email),name:String(account.full_name),role:"DRIVER",sessionId:nextSessionId,
      mustChangePassword:user.mustChangePassword,driverApprovalStatus:"PENDIENTE_DOCUMENTOS",availableRoles:["PASSENGER","DRIVER"]};
    return reply.code(201).send({token:tokenFor(next),user:next,restricted:true});
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    const user = await authenticatedUser(request, reply, { allowPasswordChange: true, allowPendingDriver: true }); if (!user) return;
    await database().begin(async tx => {
      await tx`update users set active_session_id=null where id=${user.id!} and active_session_id=${user.sessionId!}::uuid`;
      await tx`delete from device_tokens where user_id=${user.id!}`;
      if (user.role === "DRIVER") await tx`update drivers set is_available=false where user_id=${user.id!}`;
    });
    return { closed: true };
  });

  app.post("/v1/auth/lock", async (request, reply) => {
    const user = await authenticatedUser(request, reply, { allowPasswordChange: true, allowPendingDriver: true }); if (!user) return;
    await database().begin(async tx => {
      if (user.role === "DRIVER") await tx`update drivers set is_available=false where user_id=${user.id!}`;
    });
    return { locked: true, biometricSessionPreserved: true };
  });

  app.put("/v1/devices/fcm-token", async (request, reply) => {
    const user = await authenticatedUser(request, reply, { allowPendingDriver: true }); if (!user) return;
    const parsed = deviceTokenSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "INVALID_DEVICE_TOKEN" });
    const push = pushConfigurationStatus(parsed.data.firebaseProjectId);
    if (!push.configured) {
      request.log.error({ errorCode: push.errorCode }, "firebase_server_not_configured");
      return reply.code(503).send({ error: "FIREBASE_SERVER_NOT_CONFIGURED" });
    }
    if (!push.projectMatches) {
      request.log.error({
        clientProjectId: parsed.data.firebaseProjectId,
        serverProjectId: push.serverProjectId,
        errorCode: push.errorCode
      }, "firebase_project_mismatch");
      return reply.code(409).send({
        error: "FIREBASE_PROJECT_MISMATCH",
        clientProjectId: parsed.data.firebaseProjectId,
        serverProjectId: push.serverProjectId
      });
    }
    await database().begin(async tx => {
      // La cuenta admite una sola sesión activa. Conservamos el token actual y
      // retiramos tokens antiguos sin crear una ventana en la que no haya push.
      await tx`delete from device_tokens where user_id=${user.id!} and token<>${parsed.data.token}`;
      await tx`
        insert into device_tokens (user_id, token, platform, last_seen_at)
        values (${user.id!}, ${parsed.data.token}, ${parsed.data.platform}, now())
        on conflict (token) do update set user_id=excluded.user_id, platform=excluded.platform, last_seen_at=now()
      `;
    });
    return { registered: true, push };
  });

  // Diagnóstico temporal del piloto: permite comprobar el envío al dispositivo
  // autenticado sin depender de que exista un viaje nuevo.
  app.post("/v1/devices/test-push", async (request, reply) => {
    const user = await authenticatedUser(request, reply, { allowPendingDriver: true }); if (!user) return;
    const parsed = testPushSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_PUSH_TEST" });
    if (parsed.data.delaySeconds > 0) {
      setTimeout(() => {
        void sendPush(user.id!, "Prueba de notificación", "Este aviso confirma la recepción en segundo plano.", { type: "TEST_PUSH" });
      }, parsed.data.delaySeconds * 1000);
      return { scheduled: true, delaySeconds: parsed.data.delaySeconds };
    }
    return sendPush(user.id!, "Prueba de notificación", "Este aviso confirma la recepción en segundo plano.", { type: "TEST_PUSH" });
  });

  app.get("/v1/profile", async (request, reply) => {
    const user = await authenticatedUser(request, reply, { allowPendingDriver: true }); if (!user) return;
    const [profile] = await database()`
      select u.id::text,u.full_name as name,u.email,${user.role}::text as role,u.phone_e164 as phone,
        array(select mar.role from mobile_account_roles mar where mar.user_id=u.id order by mar.role) roles,
        coalesce(d.rating, (select avg(score)::numeric(3,2) from ratings where recipient_id=u.id), 0)::float8 as rating,
        (select count(*)::int from ratings where recipient_id=u.id) as "ratingCount",
        v.identifier as vehicle,
        (coalesce(u.profile_photo_data, photo.file_data) is not null) as "hasPhoto",
        u.profile_photo_updated_at as "photoUpdatedAt", d.approval_status as "approvalStatus",
        d.approval_observation as "approvalObservation"
      from users u
      left join drivers d on d.user_id=u.id
      left join lateral (select identifier from vehicles where driver_id=u.id order by created_at desc limit 1) v on true
      left join lateral (select file_data, file_mime from driver_documents where driver_id=u.id and document_type='PROFILE_PHOTO' limit 1) photo on true
      where u.id=${user.id!}
    `;
    const reviews = await database()`
      select r.score, r.tags, r.comment, author.full_name as author, r.created_at as "createdAt"
      from ratings r join users author on author.id=r.author_id
      where r.recipient_id=${user.id!} order by r.created_at desc limit 10
    `;
    return { ...profile, reviews };
  });

  app.put("/v1/profile/photo", async (request, reply) => {
    const user = await authenticatedUser(request, reply, { allowPendingDriver: true }); if (!user) return;
    const parsed = profilePhotoSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_PROFILE_PHOTO" });
    let data: Buffer;
    try { data = decodeImage(parsed.data.fileBase64, parsed.data.fileMime); }
    catch { return reply.code(400).send({ error: "INVALID_PROFILE_PHOTO" }); }
    await database().begin(async tx => {
      await tx`update users set profile_photo_data=${data}, profile_photo_mime=${parsed.data.fileMime}, profile_photo_updated_at=now(), updated_at=now() where id=${user.id!}`;
      const driverProfile=await tx`select 1 from drivers where user_id=${user.id!}`;
      if (driverProfile.length) await tx`
        insert into driver_documents (driver_id, document_type, file_url, file_data, file_mime, status)
        values (${user.id!}, 'PROFILE_PHOTO', 'database', ${data}, ${parsed.data.fileMime}, 'PENDING')
        on conflict (driver_id, document_type) do update set file_data=excluded.file_data,
          file_mime=excluded.file_mime, status='PENDING', reviewed_by=null, reviewed_at=null,
          review_note=null, created_at=now()
      `;
    });
    const [driverProfile]=await database()`select 1 from drivers where user_id=${user.id!}`;
    const approvalStatus = driverProfile ? await refreshDriverApprovalState(user.id!, user.name) : undefined;
    return { updated: true, approvalStatus };
  });

  app.delete("/v1/profile/photo", async (request, reply) => {
    const user = await authenticatedUser(request, reply, { allowPendingDriver: true }); if (!user) return;
    const [driverProfile]=await database()`select 1 from drivers where user_id=${user.id!}`;
    if (driverProfile) return reply.code(409).send({ error: "DRIVER_PHOTO_REQUIRED" });
    await database()`update users set profile_photo_data=null, profile_photo_mime=null, profile_photo_updated_at=null, updated_at=now() where id=${user.id!}`;
    return { deleted: true };
  });

  app.delete("/v1/profile/account", async (request, reply) => {
    const user = await authenticatedUser(request, reply, { allowPendingDriver: true }); if (!user) return;
    const parsed = accountDeletionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_PASSWORD" });
    const [verified] = await database()`select 1 from users where id=${user.id!}
      and password_hash=crypt(${parsed.data.password},password_hash) and deleted_at is null`;
    if (!verified) return reply.code(401).send({ error: "INVALID_CURRENT_PASSWORD" });
    let result: "DELETED" | "ACTIVE_TRIP";
    try {
      result = await eraseUserAccount(user.id!);
    } catch (error) {
      request.log.error({ err: error, userId: user.id }, "authenticated_account_deletion_failed");
      return reply.code(500).send({ error: "ACCOUNT_DELETION_FAILED" });
    }
    if (result === "ACTIVE_TRIP") return reply.code(409).send({ error: "ACCOUNT_DELETION_BLOCKED_ACTIVE_TRIP" });
    return { deleted: true };
  });

  app.get("/v1/users/:id/profile-photo", async (request, reply) => {
    const user = await authenticatedUser(request, reply, { allowPendingDriver: true }); if (!user) return;
    const id = (request.params as { id: string }).id;
    const [photo] = await database()`
      select target.profile_photo_data as data, target.profile_photo_mime as mime
      from users target
      where target.id=${id} and (target.id=${user.id!} or exists (
        select 1 from trips t
        where (${user.id!}=t.passenger_id and target.id=t.driver_id)
           or (${user.id!}=t.driver_id and target.id=t.passenger_id)
           or (target.id=t.passenger_id and t.scheduled_for is not null
             and t.status='SEARCHING' and t.schedule_status='SCHEDULED'
             and t.driver_id is null and exists (
               select 1 from drivers viewer
               where viewer.user_id=${user.id!}
                 and (t.payment_method='CASH' or viewer.deuna_enabled=true)
                 and not exists (
                   select 1 from scheduled_trip_responses response
                   where response.trip_id=t.id and response.driver_id=${user.id!}
                     and response.accepted=false
                 )
             ))
      ))
    `;
    if (!photo?.data) return reply.code(404).send({ error: "PHOTO_NOT_FOUND" });
    return reply.header("Content-Type", String(photo.mime)).header("Cache-Control", "private, max-age=300").send(photo.data);
  });

  app.get("/v1/driver/documents", async (request, reply) => {
    const user = await authenticatedUser(request, reply, { allowPendingDriver: true }); if (!user) return;
    if (user.role !== "DRIVER") return reply.code(403).send({ error: "FORBIDDEN" });
    return database()`
      select id::text, document_type as "documentType", file_mime as "fileMime",
        status, expires_at as "expiresAt", review_note as "reviewNote",
        created_at as "createdAt"
      from driver_documents where driver_id=${user.id!} order by document_type
    `;
  });

  app.post("/v1/driver/documents", async (request, reply) => {
    const user = await authenticatedUser(request, reply, { allowPendingDriver: true }); if (!user) return;
    if (user.role !== "DRIVER") return reply.code(403).send({ error: "FORBIDDEN" });
    const parsed = driverDocumentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_DRIVER_DOCUMENT" });
    const input = parsed.data;
    let data: Buffer;
    try { data = decodeDriverDocument(input); }
    catch { return reply.code(400).send({ error: "INVALID_DRIVER_DOCUMENT" }); }
    const [document] = await database()`
      insert into driver_documents
        (driver_id, document_type, file_url, file_data, file_mime, expires_at, status)
      values (${user.id!}, ${input.documentType}, 'database', ${data}, ${input.fileMime},
        ${input.expiresAt || null}, 'PENDING')
      on conflict (driver_id, document_type) do update set
        file_data=excluded.file_data, file_mime=excluded.file_mime,
        expires_at=excluded.expires_at, status='PENDING', reviewed_by=null,
        reviewed_at=null, review_note=null, created_at=now()
      returning id::text, document_type as "documentType", status
    `;
    if (input.documentType === "PROFILE_PHOTO") await database()`update users set profile_photo_data=${data}, profile_photo_mime=${input.fileMime}, profile_photo_updated_at=now(), updated_at=now() where id=${user.id!}`;
    const approvalStatus = await refreshDriverApprovalState(user.id!, user.name);
    return reply.code(201).send({ ...document, approvalStatus });
  });

  app.get("/v1/favorite-places", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    if (user.role !== "PASSENGER") return reply.code(403).send({ error: "FORBIDDEN" });
    return database()`
      select id::text, label, address,
        ST_Y(location::geometry) as latitude,
        ST_X(location::geometry) as longitude,
        created_at as "createdAt"
      from favorite_places
      where user_id=${user.id!}
      order by label
    `;
  });

  app.post("/v1/favorite-places", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    if (user.role !== "PASSENGER") return reply.code(403).send({ error: "FORBIDDEN" });
    const parsed = favoritePlaceSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_FAVORITE_PLACE" });
    const input = parsed.data;
    const [place] = await database()`
      insert into favorite_places (user_id, label, address, location)
      values (${user.id!}, ${input.label}, ${input.address},
        ST_SetSRID(ST_MakePoint(${input.location.longitude}, ${input.location.latitude}),4326)::geography)
      on conflict (user_id, label) do update set
        address=excluded.address, location=excluded.location, updated_at=now()
      returning id::text, label, address,
        ST_Y(location::geometry) as latitude,
        ST_X(location::geometry) as longitude,
        created_at as "createdAt"
    `;
    return reply.code(201).send(place);
  });

  app.delete("/v1/favorite-places/:id", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    if (user.role !== "PASSENGER") return reply.code(403).send({ error: "FORBIDDEN" });
    const id = (request.params as { id: string }).id;
    const deleted = await database()`delete from favorite_places where id=${id} and user_id=${user.id!} returning id`;
    if (!deleted.length) return reply.code(404).send({ error: "NOT_FOUND" });
    return reply.code(204).send();
  });

  app.put("/v1/driver/availability", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    if (user.role !== "DRIVER") return reply.code(403).send({ error: "FORBIDDEN" });
    const parsed = availabilitySchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "INVALID_AVAILABILITY" });
    if (parsed.data.available && !parsed.data.location) return reply.code(400).send({ error: "LOCATION_REQUIRED" });
    if (parsed.data.available && parsed.data.location) {
      const area = await resolveServiceArea(user.id!, parsed.data.location);
      if (!area) return reply.code(422).send({ error: "OUTSIDE_SERVICE_AREA" });
    }
    await database()`update drivers set is_available=${parsed.data.available}, last_location=case when ${parsed.data.location ? true : false} then ST_SetSRID(ST_MakePoint(${parsed.data.location?.longitude ?? 0}, ${parsed.data.location?.latitude ?? 0}),4326)::geography else last_location end, last_location_at=case when ${parsed.data.location ? true : false} then now() else last_location_at end where user_id=${user.id!}`;
    if (parsed.data.available) void redispatchOldestTrip().catch(() => undefined);
    else realtime.publishDriverUnavailable(user.id!);
    return { available: parsed.data.available };
  });

  app.get("/v1/trips/scheduling-settings", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    return configuredScheduledTripPolicy();
  });

  app.post("/v1/trips/preview", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    if (user.role !== "PASSENGER") return reply.code(403).send({ error: "FORBIDDEN" });
    const parsed = tripRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_TRIP_REQUEST", details: parsed.error.issues });
    const input = parsed.data;
    const destinations = input.destinations ?? [{
      location: input.destination!, reference: input.destinationReference?.trim() || "Destino"
    }];
    const finalDestination = destinations.at(-1)!;
    let operationalArea;
    try {
      operationalArea = await validateTripServiceArea(
        user.id!, input.origin, destinations.map(stop => stop.location));
    } catch (error) {
      if (error instanceof ServiceAreaError) return reply.code(422).send({ error: error.code });
      throw error;
    }
    const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : undefined;
    if (scheduledFor) {
      const policy = await configuredScheduledTripPolicy();
      const error = scheduledTimeError(scheduledFor, policy);
      if (error) return reply.code(400).send({ error, minimumNoticeMinutes: policy.minimumNoticeMinutes, maximumAdvanceMinutes: policy.maximumAdvanceMinutes });
    }
    const sql = database();
    const zones = await sql`select zone_type from service_zones where active_until is null and ST_Covers(boundary, ST_SetSRID(ST_MakePoint(${input.origin.longitude}, ${input.origin.latitude}),4326)::geography) and ST_Covers(boundary, ST_SetSRID(ST_MakePoint(${finalDestination.location.longitude}, ${finalDestination.location.latitude}),4326)::geography) order by case when zone_type='EXTENDED' then 0 else 1 end limit 1`;
    const zone = (zones[0]?.zone_type ?? "EXTENDED") as "URBAN" | "EXTENDED";
    const fare = await calculateTerritorialFare({
      serviceAreaId: operationalArea.id, origin: input.origin,
      destinations: destinations.map(stop => stop.location), passengers: input.passengers,
      travelAt: scheduledFor ?? new Date()
    }).catch(error => error instanceof Error && error.message === "PRICING_UNAVAILABLE" ? undefined : Promise.reject(error));
    if (!fare) return reply.code(503).send({ error: "PRICING_UNAVAILABLE" });
    const route = await computeRoute(input.origin, finalDestination.location, destinations.slice(0, -1).map(stop => stop.location));
    return {
      scheduledFor: scheduledFor?.toISOString() ?? null,
      serviceArea: { id: operationalArea.id, code: operationalArea.code, name: operationalArea.name },
      zone,
      stops: destinations,
      passengers: input.passengers,
      paymentMethod: input.paymentMethod,
      quotedTotalCents: fare.totalCents,
      baseFareCents: fare.baseCents,
      stopSurchargeCents: fare.stopSurchargeCents,
      fareIsSuggested: fare.suggested,
      fareLegs: fare.legs.map(leg => ({ order: leg.order, totalCents: leg.fareCents + leg.commissionCents, suggested: leg.suggested })),
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      routePoints: route.points
    };
  });

  app.post("/v1/trips", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    if (user.role !== "PASSENGER") return reply.code(403).send({ error: "FORBIDDEN" });
    const parsed = tripRequestSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "INVALID_TRIP_REQUEST", details: parsed.error.issues });
    const input = parsed.data;
    const destinations = input.destinations ?? [{
      location: input.destination!,
      reference: input.destinationReference?.trim() || "Destino"
    }];
    const finalDestination = destinations.at(-1)!;
    let operationalArea;
    try {
      operationalArea = await validateTripServiceArea(
        user.id!, input.origin, destinations.map(stop => stop.location));
    } catch (error) {
      if (error instanceof ServiceAreaError) return reply.code(422).send({ error: error.code });
      throw error;
    }
    const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : undefined;
    if (scheduledFor) {
      const policy = await configuredScheduledTripPolicy();
      const error = scheduledTimeError(scheduledFor, policy);
      if (error) return reply.code(400).send({ error, minimumNoticeMinutes: policy.minimumNoticeMinutes, maximumAdvanceMinutes: policy.maximumAdvanceMinutes });
    }
    const sql = database();
    const searchRadius = await configuredSearchRadius();
    const zones = await sql`select zone_type from service_zones where active_until is null and ST_Covers(boundary, ST_SetSRID(ST_MakePoint(${input.origin.longitude}, ${input.origin.latitude}),4326)::geography) and ST_Covers(boundary, ST_SetSRID(ST_MakePoint(${finalDestination.location.longitude}, ${finalDestination.location.latitude}),4326)::geography) order by case when zone_type='EXTENDED' then 0 else 1 end limit 1`;
    const zone = (zones[0]?.zone_type ?? "EXTENDED") as "URBAN" | "EXTENDED";
    const fare = await calculateTerritorialFare({
      serviceAreaId: operationalArea.id, origin: input.origin,
      destinations: destinations.map(stop => stop.location), passengers: input.passengers,
      travelAt: scheduledFor ?? new Date()
    }).catch(error => error instanceof Error && error.message === "PRICING_UNAVAILABLE" ? undefined : Promise.reject(error));
    if (!fare) return reply.code(503).send({ error: "PRICING_UNAVAILABLE" });
    const total = fare.totalCents;
    const route = await computeRoute(
      input.origin,
      finalDestination.location,
      destinations.slice(0, -1).map(stop => stop.location)
    ).catch(() => undefined);
    const trip = await sql.begin(async tx => {
      const [created] = await tx`
        insert into trips (
          passenger_id, passengers, payment_method, origin, destination,
          origin_reference, destination_reference, passenger_notes, service_zone,
          pricing_version, pricing_snapshot, quoted_total_cents, scheduled_for,
          schedule_status, estimated_distance_meters, estimated_duration_seconds,
          service_area_id, service_area_version_id, route_snapshot
        ) values (
          ${user.id!}, ${input.passengers}, ${input.paymentMethod},
          ST_SetSRID(ST_MakePoint(${input.origin.longitude}, ${input.origin.latitude}),4326)::geography,
          ST_SetSRID(ST_MakePoint(${finalDestination.location.longitude}, ${finalDestination.location.latitude}),4326)::geography,
          ${input.originReference ?? null}, ${finalDestination.reference}, ${input.notes || null}, ${zone},
           ${fare.pricingVersion}, ${JSON.stringify({ version: fare.pricingVersion, zone, baseCents: fare.baseCents, totalCents: total, stops: destinations.length, stopSurchargeCents: fare.stopSurchargeCents, platformCommissionCents: fare.platformCommissionCents, suggested: fare.suggested, legs: fare.legs })}::jsonb,
          ${total}, ${scheduledFor ?? null}, ${scheduledFor ? "SCHEDULED" : null},
          ${route?.distanceMeters == null ? null : Math.round(route.distanceMeters)},
          ${route?.durationSeconds == null ? null : Math.round(route.durationSeconds)},
          ${operationalArea.id}::uuid, ${operationalArea.versionId}::uuid,
          ${route ? JSON.stringify({ points: route.points, provider: route.provider }) : null}::jsonb
        ) returning id
      `;
      for (let index = 0; index < destinations.length; index++) {
        const stop = destinations[index]!;
        await tx`
          insert into trip_stops (trip_id, stop_order, location, reference)
          values (
            ${created!.id}, ${index + 1},
            ST_SetSRID(ST_MakePoint(${stop.location.longitude}, ${stop.location.latitude}),4326)::geography,
            ${stop.reference}
          )
        `;
      }
      await tx`insert into trip_events (trip_id, to_status, actor_id, metadata) values (${created!.id}, 'SEARCHING', ${user.id!}, ${JSON.stringify({ scheduledFor: scheduledFor?.toISOString() ?? null, scheduleStatus: scheduledFor ? "SCHEDULED" : null, stops: destinations.length })}::jsonb)`;
      const candidates = await tx`select d.user_id from drivers d join users u on u.id=d.user_id where d.is_available=true and u.status='ACTIVE' and (${input.paymentMethod}='CASH' or d.deuna_enabled=true) and d.last_location is not null and d.last_location_at > now() - interval '5 minutes' and not exists (select 1 from trips active_trip where active_trip.driver_id=d.user_id and active_trip.status in ('ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS')) and ST_DWithin(d.last_location, ST_SetSRID(ST_MakePoint(${input.origin.longitude}, ${input.origin.latitude}),4326)::geography, ${searchRadius}) order by ST_Distance(d.last_location, ST_SetSRID(ST_MakePoint(${input.origin.longitude}, ${input.origin.latitude}),4326)::geography) limit 3`;
      if (!scheduledFor) for (const candidate of candidates) await tx`insert into driver_offers (trip_id, driver_id, expires_at) values (${created!.id}, ${candidate.user_id}, now() + interval '2 minutes')`;
      return { id: created!.id, offers: candidates.length, driverIds: candidates.map(candidate => String(candidate.user_id)) };
    });
    const eventAt = new Date().toISOString();
    const offerPushes = await Promise.all(trip.driverIds.map(driverId => sendPush(
      driverId,
      scheduledFor ? "Nuevo viaje programado" : "Nuevo viaje cercano",
      `${input.passengers} pasajero(s): ${input.originReference ?? "Origen"} → ${finalDestination.reference}`,
      { tripId: String(trip.id), type: scheduledFor ? "SCHEDULED_TRIP_AVAILABLE" : "TRIP_OFFER", eventAt }
    )));
    const undelivered = offerPushes.filter(push => push.sent === 0);
    if (undelivered.length) request.log.warn({
      type: scheduledFor ? "SCHEDULED_TRIP_AVAILABLE" : "TRIP_OFFER", tripId: String(trip.id),
      recipients: trip.driverIds.length, undelivered: undelivered.length,
      errorCodes: undelivered.map(push => push.errorCode ?? "firebase/no-delivery")
    }, "trip_offer_push_not_delivered");
    if (!scheduledFor) for (const driverId of trip.driverIds) realtime.publishToUser(driverId, { type: "trip:offer", tripId: String(trip.id), eventAt });
    if (scheduledFor) await sendPush(user.id!, "Viaje programado", `Tu solicitud quedó guardada para ${scheduledFor.toLocaleString("es-EC", { timeZone: "America/Guayaquil" })}.`, { tripId: String(trip.id), type: "SCHEDULED_TRIP_CREATED" });
    return reply.code(201).send({
      tripId: trip.id,
      status: "SEARCHING",
      scheduleStatus: scheduledFor ? "SCHEDULED" : null,
      scheduledFor: scheduledFor?.toISOString() ?? null,
      offers: scheduledFor ? 0 : trip.offers,
      quotedTotalCents: total,
      fareIsSuggested: fare.suggested,
      distanceMeters: route?.distanceMeters ?? null,
      durationSeconds: route?.durationSeconds ?? null,
      stops: destinations,
      zone,
      serviceArea: { id: operationalArea.id, code: operationalArea.code, name: operationalArea.name }
    });
  });

  app.post("/v1/trips/:tripId/cancel", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    if (user.role !== "PASSENGER") return reply.code(403).send({ error: "FORBIDDEN" });
    const tripId = (request.params as { tripId: string }).tripId;
    const result = await database().begin(async tx => {
      const [existing] = await tx`
        select driver_id::text as "driverId", schedule_status as "scheduleStatus"
        from trips where id=${tripId} and passenger_id=${user.id!} and status='SEARCHING'
        for update
      `;
      if (!existing) return null;
      const [trip] = await tx`
        update trips set status='CANCELLED', cancelled_at=now(), schedule_status=null
        where id=${tripId} and passenger_id=${user.id!} and status='SEARCHING'
        returning id::text
      `;
      if (!trip) return null;
      const drivers = await tx`select driver_id from driver_offers where trip_id=${tripId} and responded_at is null`;
      await tx`update driver_offers set responded_at=coalesce(responded_at, now()), accepted=coalesce(accepted, false) where trip_id=${tripId}`;
      await tx`insert into trip_events (trip_id, from_status, to_status, actor_id, reason_code) values (${tripId}, 'SEARCHING', 'CANCELLED', ${user.id!}, 'PASSENGER_CANCELLED')`;
      return {
        driverIds: [...new Set([
          ...drivers.map(driver => String(driver.driver_id)),
          ...(existing.driverId ? [String(existing.driverId)] : [])
        ])],
        scheduled: Boolean(existing.scheduleStatus)
      };
    });
    if (!result) return reply.code(409).send({ error: "TRIP_NOT_CANCELLABLE" });
    for (const driverId of result.driverIds) realtime.publishToUser(driverId, { type: "trip:offer:cancelled", tripId });
    await Promise.all(result.driverIds.map(driverId => sendPush(
      driverId,
      result.scheduled ? "Viaje programado cancelado" : "Solicitud cancelada",
      result.scheduled ? "El pasajero canceló la reserva programada." : "El pasajero canceló la solicitud antes de ser asignada.",
      { tripId, type: "TRIP_CANCELLED" }
    )));
    realtime.publishTripStatus(tripId, "CANCELLED");
    return { tripId, status: "CANCELLED", cancellationReason: "PASSENGER_CANCELLED" };
  });

  app.get("/v1/trips/:tripId", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    const tripId = (request.params as { tripId: string }).tripId;
    const rows = await database()`
      select t.id::text as "tripId", t.status, t.payment_method as "paymentMethod", t.quoted_total_cents as "quotedTotalCents",
        t.final_total_cents as "finalTotalCents", t.requested_at as "requestedAt", t.assigned_at as "assignedAt",
        t.started_at as "startedAt", t.completed_at as "completedAt", t.cancelled_at as "cancelledAt",
        t.driver_id::text as "driverId", d_user.full_name as "driverName", d_user.phone_e164 as "driverPhone",
        coalesce(d.rating, 0)::float8 as "driverRating", (d_user.profile_photo_data is not null) as "driverHasPhoto",
        t.passenger_id::text as "passengerId", p_user.full_name as "passengerName", p_user.phone_e164 as "passengerPhone",
        coalesce((select avg(r.score) from ratings r where r.recipient_id=t.passenger_id), 0)::float8 as "passengerRating",
        (p_user.profile_photo_data is not null) as "passengerHasPhoto", v.identifier as vehicle,
        t.origin_reference as "originReference", t.destination_reference as "destinationReference", t.passenger_notes as notes,
        ST_X(t.origin::geometry) as "originLongitude", ST_Y(t.origin::geometry) as "originLatitude",
        ST_X(t.destination::geometry) as "destinationLongitude", ST_Y(t.destination::geometry) as "destinationLatitude",
        ST_X(live.position::geometry) as "driverLongitude", ST_Y(live.position::geometry) as "driverLatitude",
        live.bearing as "driverBearing", live.speed_mps as "driverSpeed", live.recorded_at as "driverLocationAt",
        cancellation.reason_code as "cancellationReason", t.scheduled_for as "scheduledFor",
        t.schedule_status as "scheduleStatus", t.estimated_distance_meters as "distanceMeters",
        t.estimated_duration_seconds as "durationSeconds",
        coalesce(t.route_snapshot->'points', '[]'::jsonb) as "routePoints",
        (select score from ratings where trip_id=t.id and author_id=${user.id!} limit 1) as "myRating",
        coalesce((select json_agg(json_build_object(
          'id', stop.id::text, 'order', stop.stop_order, 'reference', stop.reference,
          'latitude', ST_Y(stop.location::geometry), 'longitude', ST_X(stop.location::geometry),
          'completedAt', stop.completed_at
        ) order by stop.stop_order) from trip_stops stop where stop.trip_id=t.id), '[]'::json) as stops
      from trips t
      left join users d_user on d_user.id=t.driver_id
      left join drivers d on d.user_id=t.driver_id
      join users p_user on p_user.id=t.passenger_id
      left join lateral (select identifier from vehicles where driver_id=t.driver_id order by created_at desc limit 1) v on true
      left join trip_live_locations live on live.trip_id=t.id
      left join lateral (select reason_code from trip_events where trip_id=t.id and to_status='CANCELLED' order by occurred_at desc limit 1) cancellation on true
      where t.id=${tripId} and (${user.id!}=t.passenger_id or ${user.id!}=t.driver_id)
    `;
    const trip = rows[0];
    if (!trip) return reply.code(404).send({ error: "TRIP_NOT_FOUND" });
    return trip;
  });

  app.get("/v1/trips/active", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    const rows = await database()`
      select t.id::text as "tripId", t.status, t.payment_method as "paymentMethod", t.quoted_total_cents as "quotedTotalCents",
        t.driver_id::text as "driverId", d_user.full_name as "driverName", d_user.phone_e164 as "driverPhone",
        coalesce(d.rating, 0)::float8 as "driverRating", (d_user.profile_photo_data is not null) as "driverHasPhoto",
        t.passenger_id::text as "passengerId", p_user.full_name as "passengerName", p_user.phone_e164 as "passengerPhone",
        coalesce((select avg(r.score) from ratings r where r.recipient_id=t.passenger_id), 0)::float8 as "passengerRating",
        (p_user.profile_photo_data is not null) as "passengerHasPhoto", v.identifier as vehicle,
        t.origin_reference as "originReference", t.destination_reference as "destinationReference", t.passenger_notes as notes,
        ST_X(t.origin::geometry) as "originLongitude", ST_Y(t.origin::geometry) as "originLatitude",
        ST_X(t.destination::geometry) as "destinationLongitude", ST_Y(t.destination::geometry) as "destinationLatitude",
        ST_X(live.position::geometry) as "driverLongitude", ST_Y(live.position::geometry) as "driverLatitude",
        live.bearing as "driverBearing", live.speed_mps as "driverSpeed", live.recorded_at as "driverLocationAt",
        t.scheduled_for as "scheduledFor", t.schedule_status as "scheduleStatus",
        t.estimated_distance_meters as "distanceMeters", t.estimated_duration_seconds as "durationSeconds",
        coalesce((select json_agg(json_build_object(
          'id', stop.id::text, 'order', stop.stop_order, 'reference', stop.reference,
          'latitude', ST_Y(stop.location::geometry), 'longitude', ST_X(stop.location::geometry),
          'completedAt', stop.completed_at
        ) order by stop.stop_order) from trip_stops stop where stop.trip_id=t.id), '[]'::json) as stops
      from trips t
      join users p_user on p_user.id=t.passenger_id
      left join users d_user on d_user.id=t.driver_id
      left join drivers d on d.user_id=t.driver_id
      left join lateral (select identifier from vehicles where driver_id=t.driver_id order by created_at desc limit 1) v on true
      left join trip_live_locations live on live.trip_id=t.id
      where (${user.id!}=t.passenger_id or ${user.id!}=t.driver_id)
        and t.status in ('SEARCHING','ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS')
        and (t.scheduled_for is null or t.schedule_status in ('SCHEDULED_READY','ACTIVATED'))
      order by t.requested_at desc limit 1
    `;
    return rows[0] ?? null;
  });

  app.get("/v1/trips/mine", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    const parsed = pageQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_PAGINATION" });
    const { limit, cursor, status } = parsed.data;
    const rows = await database()`
      select t.id::text as "tripId", t.status, t.requested_at as "requestedAt",
        t.scheduled_for as "scheduledFor", t.schedule_status as "scheduleStatus",
        t.assigned_at as "assignedAt", t.started_at as "startedAt",
        t.completed_at as "completedAt", t.cancelled_at as "cancelledAt",
        t.origin_reference as "originReference", t.destination_reference as "destinationReference",
        t.quoted_total_cents as "quotedTotalCents", t.final_total_cents as "finalTotalCents",
        passenger.full_name as "passengerName", driver.full_name as "driverName",
        ST_Y(t.origin::geometry) as "originLatitude", ST_X(t.origin::geometry) as "originLongitude",
        ST_Y(t.destination::geometry) as "destinationLatitude", ST_X(t.destination::geometry) as "destinationLongitude",
        t.estimated_distance_meters as "distanceMeters", t.estimated_duration_seconds as "durationSeconds",
        (driver.profile_photo_data is not null) as "driverHasPhoto",
        (passenger.profile_photo_data is not null) as "passengerHasPhoto",
        coalesce((select avg(r.score) from ratings r where r.recipient_id=t.passenger_id), 0)::float8 as "passengerRating",
        vehicle.identifier as vehicle
      from trips t join users passenger on passenger.id=t.passenger_id
      left join users driver on driver.id=t.driver_id
      left join lateral (select identifier from vehicles where driver_id=t.driver_id order by created_at desc limit 1) vehicle on true
      where ((${user.role}='DRIVER' and ${user.id!}=t.driver_id)
        or (${user.role}<>'DRIVER' and ${user.id!}=t.passenger_id))
        and (${cursor ?? null}::timestamptz is null or t.requested_at < ${cursor ?? null}::timestamptz)
        and (${status}='ALL'
          or (${status}='SCHEDULED' and t.scheduled_for is not null)
          or (${status}<>'SCHEDULED' and t.status::text=${status}))
      order by t.requested_at desc, t.id desc limit ${limit + 1}
    `;
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return { items, nextCursor: hasMore ? items.at(-1)?.requestedAt ?? null : null };
  });

  app.get("/v1/trips/scheduled", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    await activateScheduledTrips();
    return database()`
      select t.id::text as "tripId", t.status, t.schedule_status as "scheduleStatus",
        t.scheduled_for as "scheduledFor", t.requested_at as "requestedAt",
        t.origin_reference as "originReference", t.destination_reference as "destinationReference",
        ST_Y(t.origin::geometry) as "originLatitude", ST_X(t.origin::geometry) as "originLongitude",
        t.passengers, t.payment_method as "paymentMethod", t.quoted_total_cents as "quotedTotalCents",
        t.estimated_distance_meters as "distanceMeters", t.estimated_duration_seconds as "durationSeconds",
        t.passenger_id::text as "passengerId", passenger.full_name as "passengerName",
        (passenger.profile_photo_data is not null) as "passengerHasPhoto",
        coalesce((select avg(r.score) from ratings r where r.recipient_id=t.passenger_id), 0)::float8 as "passengerRating",
        t.driver_id::text as "driverId", driver.full_name as "driverName",
        (driver.profile_photo_data is not null) as "driverHasPhoto",
        coalesce(driver_profile.rating, 0)::float8 as "driverRating", vehicle.identifier as vehicle,
        coalesce((select json_agg(json_build_object(
          'id', stop.id::text, 'order', stop.stop_order, 'reference', stop.reference,
          'latitude', ST_Y(stop.location::geometry), 'longitude', ST_X(stop.location::geometry),
          'completedAt', stop.completed_at
        ) order by stop.stop_order) from trip_stops stop where stop.trip_id=t.id), '[]'::json) as stops
      from trips t
      join users passenger on passenger.id=t.passenger_id
      left join users driver on driver.id=t.driver_id
      left join drivers driver_profile on driver_profile.user_id=t.driver_id
      left join lateral (
        select identifier from vehicles where driver_id=t.driver_id order by created_at desc limit 1
      ) vehicle on true
      where t.scheduled_for is not null
        and (${user.id!}=t.passenger_id or ${user.id!}=t.driver_id)
        and t.status not in ('COMPLETED','CANCELLED')
      order by t.scheduled_for
    `;
  });

  app.put("/v1/trips/:tripId/scheduled", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    if (user.role !== "PASSENGER") return reply.code(403).send({ error: "FORBIDDEN" });
    const parsed = tripRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_SCHEDULED_TRIP", details: parsed.error.issues });
    if (!parsed.data.scheduledFor) return reply.code(400).send({ error: "INVALID_SCHEDULED_TRIP" });
    const input = parsed.data;
    const scheduledFor = new Date(parsed.data.scheduledFor);
    const policy = await configuredScheduledTripPolicy();
    const scheduleError = scheduledTimeError(scheduledFor, policy);
    if (scheduleError) return reply.code(400).send({ error: scheduleError, minimumNoticeMinutes: policy.minimumNoticeMinutes, maximumAdvanceMinutes: policy.maximumAdvanceMinutes });
    const destinations = input.destinations ?? [{
      location: input.destination!, reference: input.destinationReference?.trim() || "Destino"
    }];
    const finalDestination = destinations.at(-1)!;
    let operationalArea;
    try {
      operationalArea = await validateTripServiceArea(
        user.id!, input.origin, destinations.map(stop => stop.location));
    } catch (error) {
      if (error instanceof ServiceAreaError) return reply.code(422).send({ error: error.code });
      throw error;
    }
    const sql = database();
    const zones = await sql`select zone_type from service_zones where active_until is null and ST_Covers(boundary, ST_SetSRID(ST_MakePoint(${input.origin.longitude}, ${input.origin.latitude}),4326)::geography) and ST_Covers(boundary, ST_SetSRID(ST_MakePoint(${finalDestination.location.longitude}, ${finalDestination.location.latitude}),4326)::geography) order by case when zone_type='EXTENDED' then 0 else 1 end limit 1`;
    const zone = (zones[0]?.zone_type ?? "EXTENDED") as "URBAN" | "EXTENDED";
    const fare = await calculateTerritorialFare({
      serviceAreaId: operationalArea.id, origin: input.origin,
      destinations: destinations.map(stop => stop.location), passengers: input.passengers,
      travelAt: scheduledFor
    }).catch(error => error instanceof Error && error.message === "PRICING_UNAVAILABLE" ? undefined : Promise.reject(error));
    if (!fare) return reply.code(503).send({ error: "PRICING_UNAVAILABLE" });
    const total = fare.totalCents;
    const route = await computeRoute(input.origin, finalDestination.location, destinations.slice(0, -1).map(stop => stop.location)).catch(() => undefined);
    const tripId = (request.params as { tripId: string }).tripId;
    const updated = await sql.begin(async tx => {
      const [trip] = await tx`
        update trips set passengers=${input.passengers}, payment_method=${input.paymentMethod},
          origin=ST_SetSRID(ST_MakePoint(${input.origin.longitude}, ${input.origin.latitude}),4326)::geography,
          destination=ST_SetSRID(ST_MakePoint(${finalDestination.location.longitude}, ${finalDestination.location.latitude}),4326)::geography,
          origin_reference=${input.originReference ?? null}, destination_reference=${finalDestination.reference},
          passenger_notes=${input.notes || null}, service_zone=${zone}, pricing_version=${fare.pricingVersion},
          pricing_snapshot=${JSON.stringify({ version: fare.pricingVersion, zone, baseCents: fare.baseCents, totalCents: total, stops: destinations.length, stopSurchargeCents: fare.stopSurchargeCents, platformCommissionCents: fare.platformCommissionCents, suggested: fare.suggested, legs: fare.legs })}::jsonb,
          quoted_total_cents=${total}, scheduled_for=${scheduledFor},
          estimated_distance_meters=${route?.distanceMeters == null ? null : Math.round(route.distanceMeters)},
          estimated_duration_seconds=${route?.durationSeconds == null ? null : Math.round(route.durationSeconds)},
          service_area_id=${operationalArea.id}::uuid,
          service_area_version_id=${operationalArea.versionId}::uuid,
          route_snapshot=${route ? JSON.stringify({ points: route.points, provider: route.provider }) : null}::jsonb
        where id=${tripId} and passenger_id=${user.id!} and status='SEARCHING'
          and schedule_status='SCHEDULED' and driver_id is null and scheduled_for > now()
        returning id::text
      `;
      if (!trip) return undefined;
      await tx`delete from trip_stops where trip_id=${tripId}`;
      await tx`delete from scheduled_trip_responses where trip_id=${tripId}`;
      for (let index = 0; index < destinations.length; index++) {
        const stop = destinations[index]!;
        await tx`insert into trip_stops (trip_id, stop_order, location, reference)
          values (${tripId}, ${index + 1}, ST_SetSRID(ST_MakePoint(${stop.location.longitude}, ${stop.location.latitude}),4326)::geography, ${stop.reference})`;
      }
      await tx`insert into trip_events (trip_id, from_status, to_status, actor_id, reason_code, metadata)
        values (${tripId}, 'SEARCHING', 'SEARCHING', ${user.id!}, 'SCHEDULED_UPDATED', ${JSON.stringify({ scheduledFor: scheduledFor.toISOString(), stops: destinations.length })}::jsonb)`;
      return trip;
    });
    if (!updated) return reply.code(409).send({ error: "SCHEDULED_TRIP_NOT_EDITABLE" });
    return { tripId, scheduledFor: scheduledFor.toISOString(), quotedTotalCents: total, fareIsSuggested: fare.suggested, stops: destinations };
  });

  app.get("/v1/driver/scheduled-offers", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    if (user.role !== "DRIVER") return reply.code(403).send({ error: "FORBIDDEN" });
    await activateScheduledTrips();
    return database()`
      select t.id::text as "tripId", t.scheduled_for as "scheduledFor",
        t.origin_reference as "originReference", t.destination_reference as "destinationReference",
        t.passengers, t.payment_method as "paymentMethod", t.quoted_total_cents as "quotedTotalCents",
        t.passenger_id::text as "passengerId", passenger.full_name as "passengerName",
        (passenger.profile_photo_data is not null) as "passengerHasPhoto",
        coalesce((select avg(r.score) from ratings r where r.recipient_id=t.passenger_id), 0)::float8 as "passengerRating",
        t.estimated_distance_meters as "distanceMeters", t.estimated_duration_seconds as "durationSeconds",
        coalesce((select json_agg(json_build_object(
          'id', stop.id::text, 'order', stop.stop_order, 'reference', stop.reference,
          'latitude', ST_Y(stop.location::geometry), 'longitude', ST_X(stop.location::geometry)
        ) order by stop.stop_order) from trip_stops stop where stop.trip_id=t.id), '[]'::json) as stops
      from trips t
      join users passenger on passenger.id=t.passenger_id
      join drivers d on d.user_id=${user.id!}
      left join service_areas area on area.id=t.service_area_id and area.enabled
      left join service_area_versions area_version on area_version.id=t.service_area_version_id
      where t.scheduled_for is not null and t.schedule_status='SCHEDULED'
        and t.status='SEARCHING' and t.driver_id is null
        and (t.payment_method='CASH' or d.deuna_enabled=true)
        and (t.service_area_id is null or (d.last_location is not null
        and ST_Covers(area_version.geometry, d.last_location::geometry)
        and (area.audience='ALL' or exists (
          select 1 from user_service_area_access access
          where access.user_id=${user.id!} and access.service_area_id=area.id
            and (access.expires_at is null or access.expires_at>now())
        )))
        )
        and not exists (
          select 1 from scheduled_trip_responses response
          where response.trip_id=t.id and response.driver_id=${user.id!} and response.accepted=false
        )
      order by t.scheduled_for
      limit 30
    `;
  });

  app.post("/v1/driver/scheduled-offers/:tripId/respond", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    if (user.role !== "DRIVER") return reply.code(403).send({ error: "FORBIDDEN" });
    const parsed = z.object({ accept: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_OFFER_RESPONSE" });
    const tripId = (request.params as { tripId: string }).tripId;
    if (!parsed.data.accept) {
      await database()`
        insert into scheduled_trip_responses (trip_id, driver_id, accepted)
        select ${tripId}, ${user.id!}, false
        where exists (select 1 from trips where id=${tripId} and scheduled_for is not null and driver_id is null)
        on conflict (trip_id, driver_id) do update set accepted=false, responded_at=now()
      `;
      return { tripId, status: "REJECTED" };
    }
    const result = await database().begin(async tx => {
      await tx`select pg_advisory_xact_lock(hashtext(${user.id!}::text))`;
      const [conflict] = await tx`
        select 1 from trips
        where driver_id=${user.id!} and scheduled_for is not null
          and schedule_status in ('SCHEDULED_ASSIGNED','SCHEDULED_READY')
          and abs(extract(epoch from (scheduled_for - (select scheduled_for from trips where id=${tripId})))) < 3600
        limit 1
      `;
      if (conflict) return { error: "SCHEDULE_CONFLICT" as const };
      const [trip] = await tx`
        update trips set driver_id=${user.id!},
          cooperative_id=(select cooperative_id from users where id=${user.id!}),
          schedule_status='SCHEDULED_ASSIGNED', assigned_at=now()
        where id=${tripId} and status='SEARCHING' and schedule_status='SCHEDULED'
          and driver_id is null and scheduled_for > now()
        returning passenger_id::text as "passengerId", scheduled_for as "scheduledFor"
      `;
      if (!trip) return { error: "TRIP_ALREADY_ASSIGNED" as const };
      await tx`
        insert into scheduled_trip_responses (trip_id, driver_id, accepted)
        values (${tripId}, ${user.id!}, true)
        on conflict (trip_id, driver_id) do update set accepted=true, responded_at=now()
      `;
      await tx`insert into trip_events (trip_id, from_status, to_status, actor_id, reason_code, metadata) values (${tripId}, 'SEARCHING', 'SEARCHING', ${user.id!}, 'SCHEDULED_ACCEPTED', ${JSON.stringify({ scheduleStatus: "SCHEDULED_ASSIGNED" })}::jsonb)`;
      return { passengerId: String(trip.passengerId), scheduledFor: trip.scheduledFor };
    });
    if ("error" in result) return reply.code(409).send(result);
    await Promise.all([
      sendPush(result.passengerId, "Conductor asignado", "Tu viaje programado ya tiene un conductor reservado.", { tripId, type: "SCHEDULED_TRIP_ASSIGNED" }),
      sendPush(user.id!, "Viaje programado aceptado", "La reserva fue agregada a tus próximos viajes.", { tripId, type: "SCHEDULED_TRIP_ACCEPTED" })
    ]);
    return { tripId, status: "SCHEDULED_ASSIGNED", scheduledFor: result.scheduledFor };
  });

  app.post("/v1/driver/scheduled-trips/:tripId/release", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    if (user.role !== "DRIVER") return reply.code(403).send({ error: "FORBIDDEN" });
    const tripId = (request.params as { tripId: string }).tripId;
    const result = await database().begin(async tx => {
      const [trip] = await tx`
        update trips set driver_id=null, cooperative_id=null, assigned_at=null,
          schedule_status='SCHEDULED'
        where id=${tripId} and driver_id=${user.id!} and status='SEARCHING'
          and schedule_status='SCHEDULED_ASSIGNED' and scheduled_for > now()
        returning passenger_id::text as "passengerId"
      `;
      if (!trip) return undefined;
      await tx`
        insert into scheduled_trip_responses (trip_id, driver_id, accepted)
        values (${tripId}, ${user.id!}, false)
        on conflict (trip_id, driver_id) do update set accepted=false, responded_at=now()
      `;
      await tx`insert into trip_events (trip_id, from_status, to_status, actor_id, reason_code, metadata)
        values (${tripId}, 'SEARCHING', 'SEARCHING', ${user.id!}, 'SCHEDULED_RELEASED', ${JSON.stringify({ scheduleStatus: "SCHEDULED" })}::jsonb)`;
      return trip;
    });
    if (!result) return reply.code(409).send({ error: "SCHEDULED_TRIP_NOT_RELEASABLE" });
    await Promise.all([
      sendPush(String(result.passengerId), "Buscando otro conductor", "El conductor liberó la reserva; volveremos a ofrecerla.", { tripId, type: "SCHEDULED_TRIP_RELEASED" }),
      sendPush(user.id!, "Reserva liberada", "El viaje programado ya no está asignado a tu cuenta.", { tripId, type: "SCHEDULED_TRIP_RELEASED" })
    ]);
    return { tripId, status: "SCHEDULED" };
  });

  app.post("/v1/trips/:tripId/stops/:stopId/complete", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    if (user.role !== "DRIVER") return reply.code(403).send({ error: "FORBIDDEN" });
    const { tripId, stopId } = request.params as { tripId: string; stopId: string };
    const result = await database().begin(async tx => {
      const [next] = await tx`
        select stop.id, stop.stop_order as "order", stop.reference from trip_stops stop join trips trip on trip.id=stop.trip_id
        where stop.trip_id=${tripId} and trip.driver_id=${user.id!} and trip.status='IN_PROGRESS'
          and stop.completed_at is null order by stop.stop_order limit 1 for update
      `;
      if (!next || String(next.id) !== stopId) return undefined;
      await tx`update trip_stops set completed_at=now() where id=${stopId}`;
      const [remaining] = await tx`
        select id::text, stop_order as "order", reference,
          ST_Y(location::geometry) as latitude, ST_X(location::geometry) as longitude
        from trip_stops where trip_id=${tripId} and completed_at is null order by stop_order limit 1
      `;
      return { completedStop: next, nextStop: remaining ?? null };
    });
    if (result === undefined) return reply.code(409).send({ error: "STOP_NOT_ACTIVE" });
    realtime.publishTripEvent(tripId, "trip:stop-completed", {
      completedStop: result.completedStop,
      nextStop: result.nextStop
    });
    return { completed: true, ...result };
  });

  app.get("/v1/trips/pending-rating", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    const rows = await database()`
      select t.id::text as "tripId", t.status, passenger.full_name as "passengerName", driver.full_name as "driverName"
      from trips t join users passenger on passenger.id=t.passenger_id
      join users driver on driver.id=t.driver_id
      where (${user.id!}=t.passenger_id or ${user.id!}=t.driver_id) and t.status='COMPLETED'
        and not exists (select 1 from ratings r where r.trip_id=t.id and r.author_id=${user.id!})
      order by t.completed_at desc limit 1
    `;
    return rows[0] ?? null;
  });

  app.get("/v1/activity", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    const parsed = inboxQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_PAGINATION" });
    const { limit, cursor } = parsed.data;
    const rows = await database()`
      select e.id::text, t.id::text as "tripId", e.to_status as status, e.reason_code as "reasonCode",
        e.occurred_at as "occurredAt", t.origin_reference as "originReference",
        t.destination_reference as "destinationReference", t.quoted_total_cents as "quotedTotalCents",
        passenger.full_name as "passengerName",
        case e.to_status
          when 'SEARCHING' then case when t.scheduled_for is null then 'Solicitaste un viaje' else 'Programaste un viaje' end
          when 'ASSIGNED' then 'Conductor asignado'
          when 'DRIVER_EN_ROUTE' then 'El conductor va en camino'
          when 'DRIVER_ARRIVED' then 'El conductor llegó al punto de encuentro'
          when 'IN_PROGRESS' then 'Viaje iniciado'
          when 'COMPLETED' then 'Viaje completado'
          when 'CANCELLED' then 'Viaje cancelado'
          else 'Actualización del viaje' end as message
      from trip_events e join trips t on t.id=e.trip_id
      join users passenger on passenger.id=t.passenger_id
      where ((${user.role}='DRIVER' and ${user.id!}=t.driver_id and e.to_status<>'SEARCHING')
        or (${user.role}<>'DRIVER' and ${user.id!}=t.passenger_id))
        and (${cursor ?? null}::timestamptz is null or e.occurred_at < ${cursor ?? null}::timestamptz)
      order by e.occurred_at desc, e.id desc limit ${limit + 1}
    `;
    const hasMore = rows.length > limit;
    const pageItems = hasMore ? rows.slice(0, limit) : rows;
    const driverMessages: Record<string, (name: string) => string> = {
      ASSIGNED: name => `Se te asign\u00f3 el viaje de ${name}`,
      DRIVER_EN_ROUTE: name => `Vas en camino a recoger a ${name}`,
      DRIVER_ARRIVED: () => "Confirmaste tu llegada al punto de encuentro",
      IN_PROGRESS: name => `Iniciaste el viaje de ${name}`,
      COMPLETED: () => "Completaste el viaje",
      CANCELLED: () => "El viaje fue cancelado"
    };
    const items = user.role === "DRIVER"
      ? pageItems.map(item => ({
          ...item,
          message: (driverMessages[String(item.status)] ?? (() => "Actualizaci\u00f3n del viaje"))(String(item.passengerName ?? "pasajero"))
        }))
      : pageItems;
    return { items, nextCursor: hasMore ? pageItems.at(-1)?.occurredAt ?? null : null };
  });

  app.get("/v1/notifications", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    const parsed = inboxQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_PAGINATION" });
    const { limit, cursor } = parsed.data;
    const rows = await database()`
      select id::text, title, message, notification_type as type, entity_type as "entityType",
        entity_id::text as "entityId", data, read_at as "readAt", created_at as "createdAt"
      from user_notifications where user_id=${user.id!}
        and (${cursor ?? null}::timestamptz is null or created_at < ${cursor ?? null}::timestamptz)
      order by created_at desc, id desc limit ${limit + 1}
    `;
    const unreadRows = await database()`select count(*)::int count from user_notifications where user_id=${user.id!} and read_at is null`;
    const unreadCount = Number(unreadRows[0]?.count ?? 0);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return { items, unreadCount, nextCursor: hasMore ? items.at(-1)?.createdAt ?? null : null };
  });

  app.patch("/v1/notifications/:notificationId/read", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    const notificationId = (request.params as { notificationId: string }).notificationId;
    if (!z.string().uuid().safeParse(notificationId).success) return reply.code(400).send({ error: "INVALID_NOTIFICATION" });
    const [updated] = await database()`update user_notifications set read_at=coalesce(read_at,now()) where id=${notificationId} and user_id=${user.id!} returning id::text, read_at as "readAt"`;
    if (!updated) return reply.code(404).send({ error: "NOTIFICATION_NOT_FOUND" });
    return updated;
  });

  app.post("/v1/notifications/read-all", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    const result = await database()`update user_notifications set read_at=now() where user_id=${user.id!} and read_at is null returning id`;
    return { updated: result.length, unreadCount: 0 };
  });

  app.post("/v1/trips/:tripId/action", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    if (user.role !== "DRIVER") return reply.code(403).send({ error: "FORBIDDEN" });
    const parsed = tripActionSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "INVALID_TRIP_ACTION" });
    const transitions = {
      EN_ROUTE: { from: "ASSIGNED", to: "DRIVER_EN_ROUTE" },
      ARRIVED: { from: "DRIVER_EN_ROUTE", to: "DRIVER_ARRIVED" },
      START: { from: "DRIVER_ARRIVED", to: "IN_PROGRESS" },
      COMPLETE: { from: "IN_PROGRESS", to: "COMPLETED" }
    } as const;
    const transition = transitions[parsed.data.action];
    const tripId = (request.params as { tripId: string }).tripId;
    const result = await database().begin(async tx => {
      if (parsed.data.action === "COMPLETE") {
        const [pending] = await tx`
          select count(*)::int as count from trip_stops
          where trip_id=${tripId} and completed_at is null
        `;
        if (Number(pending?.count ?? 0) > 1) return { error: "PENDING_STOPS" as const };
      }
      const [trip] = await tx`
        update trips set status=${transition.to},
          schedule_status=case when ${transition.to}='DRIVER_EN_ROUTE' and scheduled_for is not null then 'ACTIVATED' else schedule_status end,
          started_at=case when ${transition.to}='IN_PROGRESS' then now() else started_at end,
          completed_at=case when ${transition.to}='COMPLETED' then now() else completed_at end,
          final_total_cents=case when ${transition.to}='COMPLETED' then quoted_total_cents else final_total_cents end
        where id=${tripId} and driver_id=${user.id!} and status=${transition.from}
        returning id::text as "tripId", status
      `;
      if (!trip) return undefined;
      if (transition.to === "COMPLETED") {
        await tx`update trip_stops set completed_at=coalesce(completed_at,now()) where trip_id=${tripId}`;
      }
      await tx`insert into trip_events (trip_id, from_status, to_status, actor_id) values (${tripId}, ${transition.from}, ${transition.to}, ${user.id!})`;
      // El conductor vuelve a estar disponible solamente al cerrar su viaje activo.
      if (transition.to === "COMPLETED") await tx`update drivers set is_available=true where user_id=${user.id!}`;
      return trip;
    });
    if (!result) return reply.code(409).send({ error: "INVALID_TRIP_STATE" });
    if ("error" in result) return reply.code(409).send(result);
    const [passenger] = await database()`select passenger_id from trips where id=${tripId}`;
    const messages: Record<string, [string, string]> = { DRIVER_EN_ROUTE: ["Conductor en camino", "Tu conductor ya se dirige al punto de recogida."], DRIVER_ARRIVED: ["Tu conductor llegó", "Tu conductor está en el punto de recogida."], IN_PROGRESS: ["Viaje iniciado", "Tu viaje ya está en curso."], COMPLETED: ["Viaje finalizado", "Puedes calificar tu experiencia."] };
    const notification = messages[result.status as string];
    if (passenger && notification) {
      const push = await sendPush(String(passenger.passenger_id), notification[0], notification[1], {
        tripId,
        type: String(result.status)
      });
      if (push.sent === 0) request.log.warn({
        type: String(result.status), tripId, errorCode: push.errorCode, failed: push.failed
      }, "trip_status_push_not_delivered");
    }
    if (result.status === "COMPLETED") void redispatchOldestTrip().catch(() => undefined);
    realtime.publishTripStatus(tripId, String(result.status));
    return result;
  });

  app.post("/v1/trips/:tripId/ratings", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    const parsed = ratingSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "INVALID_RATING" });
    const tripId = (request.params as { tripId: string }).tripId;
    const rows = await database()`select passenger_id, driver_id, status from trips where id=${tripId} and (${user.id!}=passenger_id or ${user.id!}=driver_id)`;
    const trip = rows[0] as { passenger_id: string; driver_id: string | null; status: string } | undefined;
    if (!trip) return reply.code(404).send({ error: "TRIP_NOT_FOUND" });
    if (trip.status !== "COMPLETED" || !trip.driver_id) return reply.code(409).send({ error: "TRIP_NOT_COMPLETED" });
    const recipientId = user.id === trip.passenger_id ? trip.driver_id : trip.passenger_id;
    const [rating] = await database()`
      insert into ratings (trip_id, author_id, recipient_id, score, tags, comment)
      values (${tripId}, ${user.id!}, ${recipientId}, ${parsed.data.score}, ${parsed.data.tags ?? []}, ${parsed.data.comment ?? null})
      on conflict (trip_id, author_id) do update set score=excluded.score, tags=excluded.tags, comment=excluded.comment
      returning id::text as "ratingId", score
    `;
    if (user.role === "PASSENGER") await database()`update drivers set rating=(select avg(score)::numeric(3,2) from ratings where recipient_id=${recipientId}) where user_id=${recipientId}`;
    return rating;
  });

  app.get("/v1/driver/offers", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    if (user.role !== "DRIVER") return reply.code(403).send({ error: "FORBIDDEN" });
    await database()`update drivers set last_location_at=now() where user_id=${user.id!} and is_available=true`;
    const [activeTrip] = await database()`
      select id from trips
      where driver_id=${user.id!}
        and status in ('ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS')
      limit 1
    `;
    if (activeTrip) {
      await database()`
        update driver_offers set responded_at=now(), accepted=false
        where driver_id=${user.id!} and responded_at is null
      `;
      return [];
    }
    await redispatchOldestTrip();
    return database()`
      select o.id::text as "offerId", t.id::text as "tripId", t.passengers,
        t.payment_method as "paymentMethod", t.service_zone as zone,
        t.quoted_total_cents as "quotedTotalCents",
        t.origin_reference as "originReference",
        t.destination_reference as "destinationReference", t.passenger_notes as notes,
        ST_X(t.origin::geometry) as "originLongitude", ST_Y(t.origin::geometry) as "originLatitude",
        ST_X(t.destination::geometry) as "destinationLongitude", ST_Y(t.destination::geometry) as "destinationLatitude",
        coalesce(t.estimated_distance_meters, ST_Distance(t.origin, t.destination)::int)::float8 as "distanceMeters",
        coalesce(t.estimated_duration_seconds, ceil(ST_Distance(t.origin, t.destination) / 400.0)::int * 60) as "durationSeconds",
        coalesce((select json_agg(json_build_object(
          'id', stop.id::text, 'order', stop.stop_order, 'reference', stop.reference,
          'latitude', ST_Y(stop.location::geometry), 'longitude', ST_X(stop.location::geometry),
          'completedAt', stop.completed_at
        ) order by stop.stop_order) from trip_stops stop where stop.trip_id=t.id), '[]'::json) as stops,
        o.offered_at as "offeredAt", o.expires_at as "expiresAt"
      from driver_offers o
      join trips t on t.id=o.trip_id
      where o.driver_id=${user.id!} and o.responded_at is null
        and o.expires_at > now() and t.status='SEARCHING'
        and not exists (
          select 1 from trips active_trip
          where active_trip.driver_id=${user.id!}
            and active_trip.status in ('ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS')
        )
      order by o.offered_at
    `;
  });

  app.get("/v1/locations/reverse", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    const parsed = reverseLocationSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_LOCATION_QUERY" });
    try {
      return await reverseLocation(parsed.data);
    } catch { return reply.code(502).send({ error: "GEOCODER_UNAVAILABLE" }); }
  });

  app.get("/v1/driver/state", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    if (user.role !== "DRIVER") return reply.code(403).send({ error: "FORBIDDEN" });
    const [driver] = await database()`select is_available as available from drivers where user_id=${user.id!}`;
    return { available: Boolean(driver?.available) };
  });

  app.post("/v1/driver/offers/:offerId/respond", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    if (user.role !== "DRIVER") return reply.code(403).send({ error: "FORBIDDEN" });
    const body = z.object({ accept: z.boolean() }).safeParse(request.body); if (!body.success) return reply.code(400).send({ error: "INVALID_OFFER_RESPONSE" });
    const offerId = (request.params as { offerId: string }).offerId;
    const result = await database().begin(async tx => {
      const [offer] = await tx`select trip_id from driver_offers where id=${offerId} and driver_id=${user.id!} and responded_at is null and expires_at > now() for update`;
      if (!offer) return { error: "OFFER_UNAVAILABLE" };
      if (!body.data.accept) {
        await tx`update driver_offers set responded_at=now(), accepted=false where id=${offerId}`;
        return { status: "REJECTED", tripId: String(offer.trip_id), otherDriverIds: [] as string[] };
      }
      await tx`select pg_advisory_xact_lock(hashtext(${user.id!}::text))`;
      const activeTrips = await tx`select id from trips where driver_id=${user.id!} and status in ('ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS') limit 1 for update`;
      if (activeTrips.length) {
        await tx`update driver_offers set responded_at=now(), accepted=false where id=${offerId}`;
        return { error: "DRIVER_BUSY" };
      }
      const accepted = await tx`
        update trips set driver_id=${user.id!},
          cooperative_id=(select cooperative_id from users where id=${user.id!}),
          status='DRIVER_EN_ROUTE', assigned_at=now()
        where id=${offer.trip_id} and status='SEARCHING'
        returning id
      `;
      if (!accepted.length) {
        await tx`update driver_offers set responded_at=now(), accepted=false where id=${offerId}`;
        return { error: "TRIP_ALREADY_ASSIGNED" };
      }
      const otherDrivers = await tx`
        select driver_id::text as "driverId" from driver_offers
        where trip_id=${offer.trip_id} and id<>${offerId}
          and responded_at is null and expires_at > now()
      `;
      await tx`update driver_offers set responded_at=now(), accepted=true where id=${offerId}`;
      await tx`update driver_offers set responded_at=coalesce(responded_at, now()), accepted=coalesce(accepted, false) where trip_id=${offer.trip_id} and id<>${offerId}`;
      await tx`update driver_offers set responded_at=now(), accepted=false where driver_id=${user.id!} and id<>${offerId} and responded_at is null`;
      await tx`update drivers set is_available=false where user_id=${user.id!}`;
      await tx`insert into trip_events (trip_id, from_status, to_status, actor_id) values (${offer.trip_id}, 'SEARCHING', 'DRIVER_EN_ROUTE', ${user.id!})`;
      return {
        status: "DRIVER_EN_ROUTE",
        tripId: String(offer.trip_id),
        otherDriverIds: otherDrivers.map(driver => String(driver.driverId))
      };
    });
    if ("error" in result) return reply.code(409).send(result);
    if (result.status === "REJECTED") {
      request.log.info({ offerId, tripId: result.tripId, driverId: user.id }, "trip_offer_rejected_by_driver");
      return result;
    }
    realtime.publishDriverUnavailable(user.id!);
    realtime.publishTripStatus(String(result.tripId), "DRIVER_EN_ROUTE");
    const cancelledOfferPushes = [];
    for (const driverId of result.otherDriverIds) {
      realtime.publishToUser(driverId, {
        type: "trip:offer:cancelled",
        tripId: String(result.tripId),
        reason: "ACCEPTED_BY_OTHER_DRIVER"
      });
      cancelledOfferPushes.push(sendPush(
        driverId,
        "Solicitud asignada",
        "Este viaje ya fue aceptado por otro conductor.",
        { tripId: String(result.tripId), type: "TRIP_OFFER_CANCELLED" }
      ));
    }
    const [trip] = await database()`select passenger_id from trips where id=${result.tripId}`;
    const passengerPush = trip
      ? await sendPush(String(trip.passenger_id), "Viaje confirmado", "Un conductor aceptó tu solicitud y va en camino.", {
          tripId: String(result.tripId), type: "TRIP_ASSIGNED"
        })
      : undefined;
    await Promise.all(cancelledOfferPushes);
    if (passengerPush?.sent === 0) request.log.warn({
      type: "TRIP_ASSIGNED", tripId: result.tripId,
      errorCode: passengerPush.errorCode, failed: passengerPush.failed
    }, "trip_assignment_push_not_delivered");
    return result;
  });

  app.post("/v1/quotes", async (request, reply) => {
    const parsed = quoteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "INVALID_QUOTE_REQUEST",
        details: parsed.error.issues
      });
    }

    try {
      return calculateQuote(parsed.data);
    } catch (error) {
      return reply.code(422).send({
        error: "QUOTE_NOT_AVAILABLE",
        message: error instanceof Error ? error.message : "No se pudo cotizar."
      });
    }
  });

  const scheduledTimer = process.env.DATABASE_URL
    ? setInterval(() => void activateScheduledTrips().catch(error => app.log.error({ error }, "scheduled_trip_activation_failed")), 60_000)
    : undefined;
  scheduledTimer?.unref();
  app.addHook("onClose", async () => {
    if (scheduledTimer) clearInterval(scheduledTimer);
  });

  return app;
}
