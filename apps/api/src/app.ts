import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { calculateQuote, initialPricingConfig } from "@mototaxi/domain";
import { z } from "zod";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import { registerAdminRoutes, tokenFor, userFrom, type SessionUser } from "./admin.js";
import { database } from "./database.js";
import { pushConfigurationStatus, sendPush } from "./push.js";
import { registerRealtimeRoutes } from "./realtime.js";
import { reverseLocation, searchLocations } from "./geocoding.js";
import { computeRoute } from "./routing.js";

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
  password: z.string().min(8)
});
const changePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(100).optional(),
  password: z.string().min(8).max(100)
});
const registrationSchema = z.object({
  fullName: z.string().trim().min(3).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(100),
  phone: z.string().trim().regex(/^\+?[0-9]{8,15}$/),
  role: z.enum(["PASSENGER", "DRIVER"]),
  vehicleIdentifier: z.string().trim().min(3).max(30).optional(),
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
const pointSchema = z.object({ longitude: z.number().min(-180).max(180), latitude: z.number().min(-90).max(90) });
const availabilitySchema = z.object({ available: z.boolean(), location: pointSchema.optional() });
const tripRequestSchema = z.object({ origin: pointSchema, destination: pointSchema, passengers: z.number().int().min(1).max(4), paymentMethod: z.enum(['CASH','DEUNA']).default('CASH'), originReference: z.string().max(200).optional(), destinationReference: z.string().max(200).optional(), notes: z.string().trim().max(300).optional() });
const tripActionSchema = z.object({ action: z.enum(["EN_ROUTE", "ARRIVED", "START", "COMPLETE"]) });
const ratingSchema = z.object({ score: z.number().int().min(1).max(5), comment: z.string().trim().max(500).optional(), tags: z.array(z.string().trim().min(1).max(50)).max(5).optional() });
const locationSearchSchema = z.object({
  q: z.string().trim().min(3).max(160),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional()
}).refine(value => (value.latitude == null) === (value.longitude == null));
const reverseLocationSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180)
});
const routeSchema = z.object({ origin: pointSchema, destination: pointSchema });
const deviceTokenSchema = z.object({
  token: z.string().min(20).max(4096),
  platform: z.enum(["ANDROID"]).default("ANDROID"),
  firebaseProjectId: z.string().trim().min(3).max(200).optional()
});
const testPushSchema = z.object({ delaySeconds: z.number().int().min(0).max(15).default(0) });
const bannerPlacementSchema = z.object({ placement: z.enum(["PASSENGER_HOME", "DRIVER_HOME"]).default("PASSENGER_HOME") });
const favoritePlaceSchema = z.object({
  label: z.string().trim().min(2).max(50),
  address: z.string().trim().min(3).max(200),
  location: pointSchema
});
const driverDocumentSchema = z.object({
  documentType: z.enum(["PROFILE_PHOTO", "LICENSE", "REGISTRATION", "OPERATING_PERMIT"]),
  fileBase64: z.string().min(100).max(3_500_000),
  fileMime: z.enum(["image/jpeg", "image/png", "image/webp"]),
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

async function configuredSearchRadius(): Promise<number> {
  const [settings] = await database()`select search_radius_meters from operational_settings where id=1`;
  return Number(settings?.search_radius_meters ?? 3000);
}

async function authenticatedUser(request: { headers: Record<string, string | string[] | undefined> }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }, options: { allowPasswordChange?: boolean } = {}) {
  const user = userFrom(request as never);
  if (!user?.id || !user.sessionId) { reply.code(401).send({ error: "UNAUTHORIZED" }); return; }
  const active = await database()`
    select must_change_password as "mustChangePassword" from users
    where id=${user.id} and active_session_id=${user.sessionId}::uuid
  `;
  if (!active.length) { reply.code(401).send({ error: "SESSION_REPLACED" }); return; }
  if (active[0]?.mustChangePassword && !options.allowPasswordChange) {
    reply.code(428).send({ error: "PASSWORD_CHANGE_REQUIRED" });
    return;
  }
  return user;
}

export async function buildApp() {
  const app = Fastify({ logger: true, bodyLimit: 4 * 1024 * 1024 });
  await app.register(cors, {
    origin: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  });
  await app.register(websocket);
  const realtime = registerRealtimeRoutes(app);
  await registerAdminRoutes(app, realtime);

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
    service: "mototaxi-atacames-api",
    uptimeSeconds: Math.round(process.uptime())
  }));

  app.get("/v1/pricing/config", async () => initialPricingConfig);

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

  // Cuando un conductor se libera, vuelve a publicar la solicitud mÃ¡s antigua
  // que ya no tenga una oferta vigente. AsÃ­ una carrera no queda abandonada
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
      for (const driverId of dispatched.driverIds) realtime.publishToUser(driverId, { type: "trip:offer", tripId: dispatched.tripId });
      void Promise.all(dispatched.driverIds.map(driverId => sendPush(driverId, "Nuevo viaje cercano", `${dispatched.passengers} pasajero(s): ${dispatched.originReference ?? "Origen"} → ${dispatched.destinationReference ?? "Destino"}`, { tripId: dispatched.tripId, type: "TRIP_OFFER" }))).catch(() => undefined);
    }
    return dispatched;
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
      return await searchLocations(parsed.data.q, focus);
    } catch { return reply.code(502).send({ error: "GEOCODER_UNAVAILABLE" }); }
  });

  app.post("/v1/routes", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    const parsed = routeSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "INVALID_ROUTE" });
    try {
      const { origin, destination } = parsed.data;
      return await computeRoute(origin, destination);
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

  app.post("/v1/auth/session", async (request, reply) => {
    const parsed = mobileLoginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_LOGIN" });
    if (!process.env.DATABASE_URL) {
      return reply.code(503).send({ error: "AUTH_DATABASE_UNAVAILABLE" });
    }

    const rows = await database()`
      select id, email, full_name, role, status, must_change_password as "mustChangePassword"
      from users
      where lower(email) = lower(${parsed.data.email})
        and password_hash = crypt(${parsed.data.password}, password_hash)
        and role in ('PASSENGER', 'DRIVER')
    `;
    const account = rows[0] as { id: string; email: string; full_name: string; role: "PASSENGER" | "DRIVER"; status: string; mustChangePassword: boolean } | undefined;
    if (!account) return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
    if (account.status === "PENDING" && account.role === "DRIVER") return reply.code(403).send({ error: "DRIVER_PENDING_APPROVAL" });
    if (account.status !== "ACTIVE") return reply.code(403).send({ error: "ACCOUNT_NOT_ACTIVE" });

    const sessionId = randomUUID();
    await database().begin(async tx => {
      await tx`update users set active_session_id=${sessionId} where id=${account.id}`;
      await tx`delete from device_tokens where user_id=${account.id}`;
    });
    const user: SessionUser = { id: account.id, email: account.email, name: account.full_name, role: account.role, sessionId, mustChangePassword: account.mustChangePassword };
    return { token: tokenFor(user), user };
  });

  app.post("/v1/auth/change-password", async (request, reply) => {
    const user = await authenticatedUser(request, reply, { allowPasswordChange: true }); if (!user) return;
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_PASSWORD" });
    const [updated] = await database()`
      update users
      set password_hash=crypt(${parsed.data.password}, gen_salt('bf')),
          must_change_password=false,
          updated_at=now()
      where id=${user.id!}
        and (must_change_password=true or (${parsed.data.currentPassword ?? ""} <> ''
          and password_hash=crypt(${parsed.data.currentPassword ?? ""}, password_hash)))
        and password_hash <> crypt(${parsed.data.password}, password_hash)
      returning id::text
    `;
    if (!updated) {
      const [samePassword] = await database()`select 1 from users where id=${user.id!} and password_hash=crypt(${parsed.data.password}, password_hash)`;
      return reply.code(samePassword ? 409 : 401).send({ error: samePassword ? "PASSWORD_REUSED" : "INVALID_CURRENT_PASSWORD" });
    }
    return { changed: true };
  });

  app.post("/v1/auth/register", async (request, reply) => {
    const parsed = registrationSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_REGISTRATION", details: parsed.error.issues });
    const input = parsed.data;
    if (input.role === "DRIVER" && !input.vehicleIdentifier) return reply.code(400).send({ error: "VEHICLE_REQUIRED" });
    let profilePhoto: Buffer | null = null;
    if (input.profilePhotoBase64 && input.profilePhotoMime) {
      try { profilePhoto = decodeImage(input.profilePhotoBase64, input.profilePhotoMime); }
      catch { return reply.code(400).send({ error: "INVALID_PROFILE_PHOTO" }); }
    }
    try {
      const account = await database().begin(async tx => {
        const status = input.role === "DRIVER" ? "PENDING" : "ACTIVE";
        const [user] = await tx`
          insert into users (phone_e164, full_name, email, password_hash, role, status, phone_verified_at, terms_accepted_at,
            profile_photo_data, profile_photo_mime, profile_photo_updated_at)
          values (${input.phone.startsWith("+") ? input.phone : `+${input.phone}`}, ${input.fullName}, ${input.email.toLowerCase()}, crypt(${input.password}, gen_salt('bf')), ${input.role}, ${status}, now(), now(),
            ${profilePhoto}, ${input.profilePhotoMime ?? null}, ${profilePhoto ? new Date() : null})
          returning id, email, full_name, role, status
        `;
        if (input.role === "DRIVER") {
          await tx`insert into drivers (user_id, is_available) values (${user!.id}, false)`;
          await tx`insert into vehicles (driver_id, identifier, maximum_passengers, status) values (${user!.id}, ${input.vehicleIdentifier!}, 4, 'PENDING')`;
          await tx`insert into driver_documents
            (driver_id, document_type, file_url, file_data, file_mime, status)
            values (${user!.id}, 'PROFILE_PHOTO', 'database', ${profilePhoto!}, ${input.profilePhotoMime!}, 'PENDING')`;
        }
        return user!;
      });
      if (account.role === "DRIVER") return reply.code(201).send({ status: "PENDING_APPROVAL", message: "Registro recibido. Un administrador debe aprobar tu perfil de conductor." });
      const sessionId = randomUUID();
      await database()`update users set active_session_id=${sessionId} where id=${account.id}`;
      const user: SessionUser = { id: account.id, email: account.email, name: account.full_name, role: "PASSENGER", sessionId, mustChangePassword: false };
      return reply.code(201).send({ status: "ACTIVE", token: tokenFor(user), user });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") return reply.code(409).send({ error: "ACCOUNT_ALREADY_EXISTS" });
      throw error;
    }
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    const user = await authenticatedUser(request, reply, { allowPasswordChange: true }); if (!user) return;
    await database().begin(async tx => {
      await tx`update users set active_session_id=null where id=${user.id!} and active_session_id=${user.sessionId!}::uuid`;
      await tx`delete from device_tokens where user_id=${user.id!}`;
      if (user.role === "DRIVER") await tx`update drivers set is_available=false where user_id=${user.id!}`;
    });
    return { closed: true };
  });

  app.post("/v1/auth/lock", async (request, reply) => {
    const user = await authenticatedUser(request, reply, { allowPasswordChange: true }); if (!user) return;
    await database().begin(async tx => {
      await tx`delete from device_tokens where user_id=${user.id!}`;
      if (user.role === "DRIVER") await tx`update drivers set is_available=false where user_id=${user.id!}`;
    });
    return { locked: true, biometricSessionPreserved: true };
  });

  app.put("/v1/devices/fcm-token", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    const parsed = deviceTokenSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "INVALID_DEVICE_TOKEN" });
    await database()`
      insert into device_tokens (user_id, token, platform, last_seen_at)
      values (${user.id!}, ${parsed.data.token}, ${parsed.data.platform}, now())
      on conflict (token) do update set user_id=excluded.user_id, platform=excluded.platform, last_seen_at=now()
    `;
    return { registered: true, push: pushConfigurationStatus(parsed.data.firebaseProjectId) };
  });

  // Diagnóstico temporal del piloto: permite comprobar el envío al dispositivo
  // autenticado sin depender de que exista un viaje nuevo.
  app.post("/v1/devices/test-push", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
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
    const user = await authenticatedUser(request, reply); if (!user) return;
    const [profile] = await database()`
      select u.id::text, u.full_name as name, u.email, u.role, u.phone_e164 as phone,
        coalesce(d.rating, (select avg(score)::numeric(3,2) from ratings where recipient_id=u.id), 0)::float8 as rating,
        (select count(*)::int from ratings where recipient_id=u.id) as "ratingCount",
        v.identifier as vehicle,
        (coalesce(u.profile_photo_data, photo.file_data) is not null) as "hasPhoto",
        u.profile_photo_updated_at as "photoUpdatedAt"
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
    const user = await authenticatedUser(request, reply); if (!user) return;
    const parsed = profilePhotoSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_PROFILE_PHOTO" });
    let data: Buffer;
    try { data = decodeImage(parsed.data.fileBase64, parsed.data.fileMime); }
    catch { return reply.code(400).send({ error: "INVALID_PROFILE_PHOTO" }); }
    await database().begin(async tx => {
      await tx`update users set profile_photo_data=${data}, profile_photo_mime=${parsed.data.fileMime}, profile_photo_updated_at=now(), updated_at=now() where id=${user.id!}`;
      if (user.role === "DRIVER") await tx`
        insert into driver_documents (driver_id, document_type, file_url, file_data, file_mime, status)
        values (${user.id!}, 'PROFILE_PHOTO', 'database', ${data}, ${parsed.data.fileMime}, 'PENDING')
        on conflict (driver_id, document_type) do update set file_data=excluded.file_data,
          file_mime=excluded.file_mime, status='PENDING', reviewed_by=null, reviewed_at=null,
          review_note=null, created_at=now()
      `;
    });
    return { updated: true };
  });

  app.delete("/v1/profile/photo", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    if (user.role === "DRIVER") return reply.code(409).send({ error: "DRIVER_PHOTO_REQUIRED" });
    await database()`update users set profile_photo_data=null, profile_photo_mime=null, profile_photo_updated_at=null, updated_at=now() where id=${user.id!}`;
    return { deleted: true };
  });

  app.get("/v1/users/:id/profile-photo", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    const id = (request.params as { id: string }).id;
    const [photo] = await database()`
      select target.profile_photo_data as data, target.profile_photo_mime as mime
      from users target
      where target.id=${id} and (target.id=${user.id!} or exists (
        select 1 from trips t
        where (${user.id!}=t.passenger_id and target.id=t.driver_id)
           or (${user.id!}=t.driver_id and target.id=t.passenger_id)
      ))
    `;
    if (!photo?.data) return reply.code(404).send({ error: "PHOTO_NOT_FOUND" });
    return reply.header("Content-Type", String(photo.mime)).header("Cache-Control", "private, max-age=300").send(photo.data);
  });

  app.get("/v1/driver/documents", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    if (user.role !== "DRIVER") return reply.code(403).send({ error: "FORBIDDEN" });
    return database()`
      select id::text, document_type as "documentType", file_mime as "fileMime",
        status, expires_at as "expiresAt", review_note as "reviewNote",
        created_at as "createdAt"
      from driver_documents where driver_id=${user.id!} order by document_type
    `;
  });

  app.post("/v1/driver/documents", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    if (user.role !== "DRIVER") return reply.code(403).send({ error: "FORBIDDEN" });
    const parsed = driverDocumentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_DRIVER_DOCUMENT" });
    const input = parsed.data;
    let data: Buffer;
    try { data = decodeImage(input.fileBase64, input.fileMime); }
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
    return reply.code(201).send(document);
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
    await database()`update drivers set is_available=${parsed.data.available}, last_location=case when ${parsed.data.location ? true : false} then ST_SetSRID(ST_MakePoint(${parsed.data.location?.longitude ?? 0}, ${parsed.data.location?.latitude ?? 0}),4326)::geography else last_location end, last_location_at=case when ${parsed.data.location ? true : false} then now() else last_location_at end where user_id=${user.id!}`;
    if (parsed.data.available) void redispatchOldestTrip().catch(() => undefined);
    else realtime.publishDriverUnavailable(user.id!);
    return { available: parsed.data.available };
  });

  app.post("/v1/trips", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    if (user.role !== "PASSENGER") return reply.code(403).send({ error: "FORBIDDEN" });
    const parsed = tripRequestSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "INVALID_TRIP_REQUEST", details: parsed.error.issues });
    const input = parsed.data;
    const sql = database();
    const searchRadius = await configuredSearchRadius();
    const zones = await sql`select zone_type from service_zones where active_until is null and ST_Covers(boundary, ST_SetSRID(ST_MakePoint(${input.origin.longitude}, ${input.origin.latitude}),4326)::geography) and ST_Covers(boundary, ST_SetSRID(ST_MakePoint(${input.destination.longitude}, ${input.destination.latitude}),4326)::geography) order by case when zone_type='EXTENDED' then 0 else 1 end limit 1`;
    const zone = (zones[0]?.zone_type ?? "EXTENDED") as "URBAN" | "EXTENDED";
    const prices = await sql`select version, urban_day_cents_per_passenger, night_cents_per_passenger, extended_cents_per_passenger, group_promotion_enabled, group_promotion_passengers, group_promotion_total_cents from pricing_versions where active_from <= now() and (active_until is null or active_until > now()) order by version desc limit 1`;
    const price = prices[0]; if (!price) return reply.code(503).send({ error: "PRICING_UNAVAILABLE" });
    const hour = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Guayaquil", hour: "2-digit", hour12: false }).format(new Date());
    const isNight = Number(hour) >= 20 || Number(hour) < 6;
    const total = isNight ? Number(price.night_cents_per_passenger) * input.passengers : zone === "EXTENDED" ? Number(price.extended_cents_per_passenger) * input.passengers : Boolean(price.group_promotion_enabled) && input.passengers === Number(price.group_promotion_passengers) ? Number(price.group_promotion_total_cents) : Number(price.urban_day_cents_per_passenger) * input.passengers;
    const trip = await sql.begin(async tx => {
      const [created] = await tx`insert into trips (passenger_id, passengers, payment_method, origin, destination, origin_reference, destination_reference, passenger_notes, service_zone, pricing_version, pricing_snapshot, quoted_total_cents) values (${user.id!}, ${input.passengers}, ${input.paymentMethod}, ST_SetSRID(ST_MakePoint(${input.origin.longitude}, ${input.origin.latitude}),4326)::geography, ST_SetSRID(ST_MakePoint(${input.destination.longitude}, ${input.destination.latitude}),4326)::geography, ${input.originReference ?? null}, ${input.destinationReference ?? null}, ${input.notes || null}, ${zone}, ${price.version}, ${JSON.stringify({ version: price.version, zone, totalCents: total })}::jsonb, ${total}) returning id`;
      await tx`insert into trip_events (trip_id, to_status, actor_id, metadata) values (${created!.id}, 'SEARCHING', ${user.id!}, '{}'::jsonb)`;
      const candidates = await tx`select d.user_id from drivers d join users u on u.id=d.user_id where d.is_available=true and u.status='ACTIVE' and (${input.paymentMethod}='CASH' or d.deuna_enabled=true) and d.last_location is not null and d.last_location_at > now() - interval '5 minutes' and not exists (select 1 from trips active_trip where active_trip.driver_id=d.user_id and active_trip.status in ('ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS')) and ST_DWithin(d.last_location, ST_SetSRID(ST_MakePoint(${input.origin.longitude}, ${input.origin.latitude}),4326)::geography, ${searchRadius}) order by ST_Distance(d.last_location, ST_SetSRID(ST_MakePoint(${input.origin.longitude}, ${input.origin.latitude}),4326)::geography) limit 3`;
      for (const candidate of candidates) await tx`insert into driver_offers (trip_id, driver_id, expires_at) values (${created!.id}, ${candidate.user_id}, now() + interval '2 minutes')`;
      return { id: created!.id, offers: candidates.length, driverIds: candidates.map(candidate => String(candidate.user_id)) };
    });
    void Promise.all(trip.driverIds.map(driverId => sendPush(driverId, "Nuevo viaje cercano", `${input.passengers} pasajero(s): ${input.originReference ?? "Origen"} → ${input.destinationReference ?? "Destino"}`, { tripId: trip.id, type: "TRIP_OFFER" }))).catch(() => undefined);
    for (const driverId of trip.driverIds) realtime.publishToUser(driverId, { type: "trip:offer", tripId: String(trip.id) });
    return reply.code(201).send({ tripId: trip.id, status: "SEARCHING", offers: trip.offers, quotedTotalCents: total, zone });
  });

  app.post("/v1/trips/:tripId/cancel", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    if (user.role !== "PASSENGER") return reply.code(403).send({ error: "FORBIDDEN" });
    const tripId = (request.params as { tripId: string }).tripId;
    const result = await database().begin(async tx => {
      const [trip] = await tx`
        update trips set status='CANCELLED', cancelled_at=now()
        where id=${tripId} and passenger_id=${user.id!} and status='SEARCHING'
        returning id::text
      `;
      if (!trip) return null;
      const drivers = await tx`select driver_id from driver_offers where trip_id=${tripId} and responded_at is null`;
      await tx`update driver_offers set responded_at=coalesce(responded_at, now()), accepted=coalesce(accepted, false) where trip_id=${tripId}`;
      await tx`insert into trip_events (trip_id, from_status, to_status, actor_id, reason_code) values (${tripId}, 'SEARCHING', 'CANCELLED', ${user.id!}, 'PASSENGER_CANCELLED')`;
      return drivers.map(driver => String(driver.driver_id));
    });
    if (!result) return reply.code(409).send({ error: "TRIP_NOT_CANCELLABLE" });
    for (const driverId of result) realtime.publishToUser(driverId, { type: "trip:offer:cancelled", tripId });
    void Promise.all(result.map(driverId => sendPush(driverId, "Solicitud cancelada", "El pasajero canceló la solicitud antes de ser asignada.", { tripId, type: "TRIP_CANCELLED" }))).catch(() => undefined);
    realtime.publishTripStatus(tripId, "CANCELLED");
    return { tripId, status: "CANCELLED", cancellationReason: "PASSENGER_CANCELLED" };
  });

  app.get("/v1/trips/:tripId", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    const tripId = (request.params as { tripId: string }).tripId;
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
        cancellation.reason_code as "cancellationReason"
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
        live.bearing as "driverBearing", live.speed_mps as "driverSpeed", live.recorded_at as "driverLocationAt"
      from trips t
      join users p_user on p_user.id=t.passenger_id
      left join users d_user on d_user.id=t.driver_id
      left join drivers d on d.user_id=t.driver_id
      left join lateral (select identifier from vehicles where driver_id=t.driver_id order by created_at desc limit 1) v on true
      left join trip_live_locations live on live.trip_id=t.id
      where (${user.id!}=t.passenger_id or ${user.id!}=t.driver_id)
        and t.status in ('SEARCHING','ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS')
      order by t.requested_at desc limit 1
    `;
    return rows[0] ?? null;
  });

  app.get("/v1/trips/mine", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    return database()`
      select t.id::text as "tripId", t.status, t.requested_at as "requestedAt",
        t.origin_reference as "originReference", t.destination_reference as "destinationReference",
        t.quoted_total_cents as "quotedTotalCents", passenger.full_name as "passengerName", driver.full_name as "driverName"
      from trips t join users passenger on passenger.id=t.passenger_id
      left join users driver on driver.id=t.driver_id
      where ${user.id!}=t.passenger_id or ${user.id!}=t.driver_id
      order by t.requested_at desc limit 30
    `;
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

  app.get("/v1/notifications", async (request, reply) => {
    const user = await authenticatedUser(request, reply); if (!user) return;
    return database()`
      select e.id, t.id::text as "tripId", e.to_status as status, e.occurred_at as "occurredAt",
        case e.to_status
          when 'ASSIGNED' then 'Viaje confirmado: conductor asignado.'
          when 'DRIVER_EN_ROUTE' then 'El conductor va en camino.'
          when 'DRIVER_ARRIVED' then 'El conductor llegó al punto de encuentro.'
          when 'IN_PROGRESS' then 'Tu viaje inició.'
          when 'COMPLETED' then 'Viaje finalizado. Puedes calificarlo.'
          when 'CANCELLED' then 'El viaje fue cancelado.'
          else 'Actualización de viaje.' end as message
      from trip_events e join trips t on t.id=e.trip_id
      where ${user.id!}=t.passenger_id or ${user.id!}=t.driver_id
      order by e.occurred_at desc limit 50
    `;
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
      const [trip] = await tx`
        update trips set status=${transition.to},
          started_at=case when ${transition.to}='IN_PROGRESS' then now() else started_at end,
          completed_at=case when ${transition.to}='COMPLETED' then now() else completed_at end,
          final_total_cents=case when ${transition.to}='COMPLETED' then quoted_total_cents else final_total_cents end
        where id=${tripId} and driver_id=${user.id!} and status=${transition.from}
        returning id::text as "tripId", status
      `;
      if (!trip) return undefined;
      await tx`insert into trip_events (trip_id, from_status, to_status, actor_id) values (${tripId}, ${transition.from}, ${transition.to}, ${user.id!})`;
      // El conductor vuelve a estar disponible solamente al cerrar su viaje activo.
      if (transition.to === "COMPLETED") await tx`update drivers set is_available=true where user_id=${user.id!}`;
      return trip;
    });
    if (!result) return reply.code(409).send({ error: "INVALID_TRIP_STATE" });
    const [passenger] = await database()`select passenger_id from trips where id=${tripId}`;
    const messages: Record<string, [string, string]> = { DRIVER_EN_ROUTE: ["Conductor en camino", "Tu conductor ya se dirige al punto de recogida."], DRIVER_ARRIVED: ["Tu conductor llegó", "Tu conductor está en el punto de recogida."], IN_PROGRESS: ["Viaje iniciado", "Tu viaje ya está en curso."], COMPLETED: ["Viaje finalizado", "Puedes calificar tu experiencia."] };
    const notification = messages[result.status as string];
    if (passenger && notification) void sendPush(String(passenger.passenger_id), notification[0], notification[1], { tripId, type: result.status }).catch(() => undefined);
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
        o.expires_at as "expiresAt"
      from driver_offers o
      join trips t on t.id=o.trip_id
      where o.driver_id=${user.id!} and o.responded_at is null
        and o.expires_at > now() and t.status='SEARCHING'
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
        return { status: "REJECTED" };
      }
      await tx`select pg_advisory_xact_lock(hashtext(${user.id!}::text))`;
      const activeTrips = await tx`select id from trips where driver_id=${user.id!} and status in ('ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS') limit 1 for update`;
      if (activeTrips.length) {
        await tx`update driver_offers set responded_at=now(), accepted=false where id=${offerId}`;
        return { error: "DRIVER_BUSY" };
      }
      const accepted = await tx`update trips set driver_id=${user.id!}, status='DRIVER_EN_ROUTE', assigned_at=now() where id=${offer.trip_id} and status='SEARCHING' returning id`;
      if (!accepted.length) {
        await tx`update driver_offers set responded_at=now(), accepted=false where id=${offerId}`;
        return { error: "TRIP_ALREADY_ASSIGNED" };
      }
      await tx`update driver_offers set responded_at=now(), accepted=true where id=${offerId}`;
      await tx`update driver_offers set responded_at=coalesce(responded_at, now()), accepted=coalesce(accepted, false) where trip_id=${offer.trip_id} and id<>${offerId}`;
      await tx`update driver_offers set responded_at=now(), accepted=false where driver_id=${user.id!} and id<>${offerId} and responded_at is null`;
      await tx`update drivers set is_available=false where user_id=${user.id!}`;
      await tx`insert into trip_events (trip_id, from_status, to_status, actor_id) values (${offer.trip_id}, 'SEARCHING', 'DRIVER_EN_ROUTE', ${user.id!})`;
      return { status: "DRIVER_EN_ROUTE", tripId: offer.trip_id };
    });
    if ("error" in result) return reply.code(409).send(result);
    realtime.publishDriverUnavailable(user.id!);
    realtime.publishTripStatus(String(result.tripId), "DRIVER_EN_ROUTE");
    const [trip] = await database()`select passenger_id from trips where id=${result.tripId}`;
    if (trip) void sendPush(String(trip.passenger_id), "Viaje confirmado", "Un conductor aceptó tu solicitud y va en camino.", { tripId: result.tripId, type: "TRIP_ASSIGNED" }).catch(() => undefined);
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

  return app;
}
