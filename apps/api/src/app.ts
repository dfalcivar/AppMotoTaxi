import cors from "@fastify/cors";
import Fastify from "fastify";
import { calculateQuote, initialPricingConfig } from "@mototaxi/domain";
import { z } from "zod";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import { registerAdminRoutes, tokenFor, userFrom, type SessionUser } from "./admin.js";
import { database } from "./database.js";

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
const registrationSchema = z.object({
  fullName: z.string().trim().min(3).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(100),
  phone: z.string().trim().regex(/^\+?[0-9]{8,15}$/),
  role: z.enum(["PASSENGER", "DRIVER"]),
  vehicleIdentifier: z.string().trim().min(3).max(30).optional()
});
const pointSchema = z.object({ longitude: z.number().min(-180).max(180), latitude: z.number().min(-90).max(90) });
const availabilitySchema = z.object({ available: z.boolean(), location: pointSchema.optional() });
const tripRequestSchema = z.object({ origin: pointSchema, destination: pointSchema, passengers: z.number().int().min(1).max(3), originReference: z.string().max(200).optional(), destinationReference: z.string().max(200).optional() });
const tripActionSchema = z.object({ action: z.enum(["EN_ROUTE", "ARRIVED", "START", "COMPLETE"]) });
const ratingSchema = z.object({ score: z.number().int().min(1).max(5), comment: z.string().trim().max(500).optional(), tags: z.array(z.string().trim().min(1).max(50)).max(5).optional() });
const locationSearchSchema = z.object({ q: z.string().trim().min(3).max(160) });
const routeSchema = z.object({ origin: pointSchema, destination: pointSchema });

function authenticatedUser(request: { headers: Record<string, string | string[] | undefined> }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) {
  const user = userFrom(request as never);
  if (!user?.id) { reply.code(401).send({ error: "UNAUTHORIZED" }); return; }
  return user;
}

export async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });
  await registerAdminRoutes(app);

  app.get("/health", async () => ({
    status: "ok",
    service: "mototaxi-atacames-api"
  }));

  app.get("/v1/pricing/config", async () => initialPricingConfig);

  app.get("/v1/locations/search", async (request, reply) => {
    const user = authenticatedUser(request, reply); if (!user) return;
    const parsed = locationSearchSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_LOCATION_QUERY" });
    try {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("q", `${parsed.data.q}, Atacames, Ecuador`);
      url.searchParams.set("format", "jsonv2"); url.searchParams.set("limit", "5"); url.searchParams.set("addressdetails", "1");
      const response = await fetch(url, { headers: { "User-Agent": "MototaxiAtacamesMVP/0.1 (development contact: admin@mototaxi.local)", Accept: "application/json" } });
      if (!response.ok) return reply.code(502).send({ error: "GEOCODER_UNAVAILABLE" });
      const items = await response.json() as Array<{ display_name: string; lat: string; lon: string }>;
      return items.map(item => ({ label: item.display_name, latitude: Number(item.lat), longitude: Number(item.lon) }));
    } catch { return reply.code(502).send({ error: "GEOCODER_UNAVAILABLE" }); }
  });

  app.post("/v1/routes", async (request, reply) => {
    const user = authenticatedUser(request, reply); if (!user) return;
    const parsed = routeSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "INVALID_ROUTE" });
    const key = process.env.ORS_API_KEY;
    if (!key) return reply.code(503).send({ error: "ROUTING_NOT_CONFIGURED", message: "Configura ORS_API_KEY para mostrar rutas navegables." });
    try {
      const { origin, destination } = parsed.data;
      const response = await fetch("https://api.openrouteservice.org/v2/directions/driving-car/geojson", { method: "POST", headers: { Authorization: key, "Content-Type": "application/json" }, body: JSON.stringify({ coordinates: [[origin.longitude, origin.latitude], [destination.longitude, destination.latitude]] }) });
      if (!response.ok) return reply.code(502).send({ error: "ROUTING_UNAVAILABLE" });
      const payload = await response.json() as { features?: Array<{ geometry?: { coordinates?: number[][] } }> };
      return { points: payload.features?.[0]?.geometry?.coordinates?.map(([longitude, latitude]) => ({ latitude, longitude })) ?? [] };
    } catch { return reply.code(502).send({ error: "ROUTING_UNAVAILABLE" }); }
  });

  app.post("/v1/auth/session", async (request, reply) => {
    const parsed = mobileLoginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_LOGIN" });
    if (!process.env.DATABASE_URL) {
      return reply.code(503).send({ error: "AUTH_DATABASE_UNAVAILABLE" });
    }

    const rows = await database()`
      select id, email, full_name, role
      from users
      where lower(email) = lower(${parsed.data.email})
        and password_hash = crypt(${parsed.data.password}, password_hash)
        and status = 'ACTIVE'
        and role in ('PASSENGER', 'DRIVER')
    `;
    const account = rows[0] as { id: string; email: string; full_name: string; role: "PASSENGER" | "DRIVER" } | undefined;
    if (!account) return reply.code(401).send({ error: "INVALID_CREDENTIALS" });

    const user: SessionUser = { id: account.id, email: account.email, name: account.full_name, role: account.role };
    return { token: tokenFor(user), user };
  });

  app.post("/v1/auth/register", async (request, reply) => {
    const parsed = registrationSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_REGISTRATION", details: parsed.error.issues });
    const input = parsed.data;
    if (input.role === "DRIVER" && !input.vehicleIdentifier) return reply.code(400).send({ error: "VEHICLE_REQUIRED" });
    try {
      const account = await database().begin(async tx => {
        const status = input.role === "DRIVER" ? "PENDING" : "ACTIVE";
        const [user] = await tx`
          insert into users (phone_e164, full_name, email, password_hash, role, status, phone_verified_at, terms_accepted_at)
          values (${input.phone.startsWith("+") ? input.phone : `+${input.phone}`}, ${input.fullName}, ${input.email.toLowerCase()}, crypt(${input.password}, gen_salt('bf')), ${input.role}, ${status}, now(), now())
          returning id, email, full_name, role, status
        `;
        if (input.role === "DRIVER") {
          await tx`insert into drivers (user_id, is_available) values (${user!.id}, false)`;
          await tx`insert into vehicles (driver_id, identifier, maximum_passengers, status) values (${user!.id}, ${input.vehicleIdentifier!}, 3, 'PENDING')`;
        }
        return user!;
      });
      if (account.role === "DRIVER") return reply.code(201).send({ status: "PENDING_APPROVAL", message: "Registro recibido. Un administrador debe aprobar tu perfil de conductor." });
      const user: SessionUser = { id: account.id, email: account.email, name: account.full_name, role: "PASSENGER" };
      return reply.code(201).send({ status: "ACTIVE", token: tokenFor(user), user });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") return reply.code(409).send({ error: "ACCOUNT_ALREADY_EXISTS" });
      throw error;
    }
  });

  app.get("/v1/profile", async (request, reply) => {
    const user = authenticatedUser(request, reply); if (!user) return;
    const [profile] = await database()`
      select u.id::text, u.full_name as name, u.role, u.phone_e164 as phone,
        coalesce(d.rating, (select avg(score)::numeric(3,2) from ratings where recipient_id=u.id), 0)::float8 as rating,
        (select count(*)::int from ratings where recipient_id=u.id) as "ratingCount",
        v.identifier as vehicle
      from users u
      left join drivers d on d.user_id=u.id
      left join lateral (select identifier from vehicles where driver_id=u.id order by created_at desc limit 1) v on true
      where u.id=${user.id!}
    `;
    const reviews = await database()`
      select r.score, r.tags, r.comment, author.full_name as author, r.created_at as "createdAt"
      from ratings r join users author on author.id=r.author_id
      where r.recipient_id=${user.id!} order by r.created_at desc limit 10
    `;
    return { ...profile, reviews };
  });

  app.put("/v1/driver/availability", async (request, reply) => {
    const user = authenticatedUser(request, reply); if (!user) return;
    if (user.role !== "DRIVER") return reply.code(403).send({ error: "FORBIDDEN" });
    const parsed = availabilitySchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "INVALID_AVAILABILITY" });
    if (parsed.data.available && !parsed.data.location) return reply.code(400).send({ error: "LOCATION_REQUIRED" });
    await database()`update drivers set is_available=${parsed.data.available}, last_location=case when ${parsed.data.location ? true : false} then ST_SetSRID(ST_MakePoint(${parsed.data.location?.longitude ?? 0}, ${parsed.data.location?.latitude ?? 0}),4326)::geography else last_location end, last_location_at=case when ${parsed.data.location ? true : false} then now() else last_location_at end where user_id=${user.id!}`;
    return { available: parsed.data.available };
  });

  app.post("/v1/trips", async (request, reply) => {
    const user = authenticatedUser(request, reply); if (!user) return;
    if (user.role !== "PASSENGER") return reply.code(403).send({ error: "FORBIDDEN" });
    const parsed = tripRequestSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "INVALID_TRIP_REQUEST", details: parsed.error.issues });
    const input = parsed.data;
    const sql = database();
    const zones = await sql`select zone_type from service_zones where active_until is null and ST_Covers(boundary, ST_SetSRID(ST_MakePoint(${input.origin.longitude}, ${input.origin.latitude}),4326)::geography) and ST_Covers(boundary, ST_SetSRID(ST_MakePoint(${input.destination.longitude}, ${input.destination.latitude}),4326)::geography) order by case when zone_type='EXTENDED' then 0 else 1 end limit 1`;
    const zone = (zones[0]?.zone_type ?? "EXTENDED") as "URBAN" | "EXTENDED";
    const prices = await sql`select version, urban_day_cents_per_passenger, night_cents_per_passenger, extended_cents_per_passenger, group_promotion_enabled, group_promotion_passengers, group_promotion_total_cents from pricing_versions where active_from <= now() and (active_until is null or active_until > now()) order by version desc limit 1`;
    const price = prices[0]; if (!price) return reply.code(503).send({ error: "PRICING_UNAVAILABLE" });
    const hour = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Guayaquil", hour: "2-digit", hour12: false }).format(new Date());
    const isNight = Number(hour) >= 20 || Number(hour) < 6;
    const total = isNight ? Number(price.night_cents_per_passenger) * input.passengers : zone === "EXTENDED" ? Number(price.extended_cents_per_passenger) * input.passengers : Boolean(price.group_promotion_enabled) && input.passengers === Number(price.group_promotion_passengers) ? Number(price.group_promotion_total_cents) : Number(price.urban_day_cents_per_passenger) * input.passengers;
    const trip = await sql.begin(async tx => {
      const [created] = await tx`insert into trips (passenger_id, passengers, origin, destination, origin_reference, destination_reference, service_zone, pricing_version, pricing_snapshot, quoted_total_cents) values (${user.id!}, ${input.passengers}, ST_SetSRID(ST_MakePoint(${input.origin.longitude}, ${input.origin.latitude}),4326)::geography, ST_SetSRID(ST_MakePoint(${input.destination.longitude}, ${input.destination.latitude}),4326)::geography, ${input.originReference ?? null}, ${input.destinationReference ?? null}, ${zone}, ${price.version}, ${JSON.stringify({ version: price.version, zone, totalCents: total })}::jsonb, ${total}) returning id`;
      await tx`insert into trip_events (trip_id, to_status, actor_id, metadata) values (${created!.id}, 'SEARCHING', ${user.id!}, '{}'::jsonb)`;
      const candidates = await tx`select d.user_id from drivers d join users u on u.id=d.user_id where d.is_available=true and u.status='ACTIVE' and d.last_location is not null and d.last_location_at > now() - interval '5 minutes' and not exists (select 1 from trips active_trip where active_trip.driver_id=d.user_id and active_trip.status in ('ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS')) and ST_DWithin(d.last_location, ST_SetSRID(ST_MakePoint(${input.origin.longitude}, ${input.origin.latitude}),4326)::geography, 1000) order by ST_Distance(d.last_location, ST_SetSRID(ST_MakePoint(${input.origin.longitude}, ${input.origin.latitude}),4326)::geography) limit 3`;
      for (const candidate of candidates) await tx`insert into driver_offers (trip_id, driver_id, expires_at) values (${created!.id}, ${candidate.user_id}, now() + interval '30 seconds')`;
      return { id: created!.id, offers: candidates.length };
    });
    return reply.code(201).send({ tripId: trip.id, status: "SEARCHING", offers: trip.offers, quotedTotalCents: total, zone });
  });

  app.get("/v1/trips/:tripId", async (request, reply) => {
    const user = authenticatedUser(request, reply); if (!user) return;
    const tripId = (request.params as { tripId: string }).tripId;
    const rows = await database()`
      select t.id::text as "tripId", t.status, t.quoted_total_cents as "quotedTotalCents",
        d_user.full_name as "driverName", p_user.full_name as "passengerName", v.identifier as vehicle,
        t.origin_reference as "originReference", t.destination_reference as "destinationReference"
      from trips t
      left join users d_user on d_user.id=t.driver_id
      join users p_user on p_user.id=t.passenger_id
      left join lateral (select identifier from vehicles where driver_id=t.driver_id order by created_at desc limit 1) v on true
      where t.id=${tripId} and (${user.id!}=t.passenger_id or ${user.id!}=t.driver_id)
    `;
    const trip = rows[0];
    if (!trip) return reply.code(404).send({ error: "TRIP_NOT_FOUND" });
    return trip;
  });

  app.get("/v1/trips/active", async (request, reply) => {
    const user = authenticatedUser(request, reply); if (!user) return;
    const rows = await database()`
      select t.id::text as "tripId", t.status, t.quoted_total_cents as "quotedTotalCents",
        d_user.full_name as "driverName", p_user.full_name as "passengerName", v.identifier as vehicle,
        t.origin_reference as "originReference", t.destination_reference as "destinationReference"
      from trips t
      join users p_user on p_user.id=t.passenger_id
      left join users d_user on d_user.id=t.driver_id
      left join lateral (select identifier from vehicles where driver_id=t.driver_id order by created_at desc limit 1) v on true
      where (${user.id!}=t.passenger_id or ${user.id!}=t.driver_id)
        and t.status in ('SEARCHING','ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS')
      order by t.requested_at desc limit 1
    `;
    return rows[0] ?? null;
  });

  app.post("/v1/trips/:tripId/action", async (request, reply) => {
    const user = authenticatedUser(request, reply); if (!user) return;
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
      return trip;
    });
    if (!result) return reply.code(409).send({ error: "INVALID_TRIP_STATE" });
    return result;
  });

  app.post("/v1/trips/:tripId/ratings", async (request, reply) => {
    const user = authenticatedUser(request, reply); if (!user) return;
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
    const user = authenticatedUser(request, reply); if (!user) return;
    if (user.role !== "DRIVER") return reply.code(403).send({ error: "FORBIDDEN" });
    return database()`select o.id::text as "offerId", t.id::text as "tripId", t.passengers, t.service_zone as zone, t.quoted_total_cents as "quotedTotalCents", t.origin_reference as "originReference", t.destination_reference as "destinationReference", o.expires_at as "expiresAt" from driver_offers o join trips t on t.id=o.trip_id where o.driver_id=${user.id!} and o.responded_at is null and o.expires_at > now() and t.status='SEARCHING' order by o.offered_at`;
  });

  app.post("/v1/driver/offers/:offerId/respond", async (request, reply) => {
    const user = authenticatedUser(request, reply); if (!user) return;
    if (user.role !== "DRIVER") return reply.code(403).send({ error: "FORBIDDEN" });
    const body = z.object({ accept: z.boolean() }).safeParse(request.body); if (!body.success) return reply.code(400).send({ error: "INVALID_OFFER_RESPONSE" });
    const result = await database().begin(async tx => {
      const [offer] = await tx`select trip_id from driver_offers where id=${(request.params as { offerId: string }).offerId} and driver_id=${user.id!} and responded_at is null and expires_at > now() for update`;
      if (!offer) return { error: "OFFER_UNAVAILABLE" };
      await tx`update driver_offers set responded_at=now(), accepted=${body.data.accept} where id=${(request.params as { offerId: string }).offerId}`;
      if (!body.data.accept) return { status: "REJECTED" };
      const accepted = await tx`update trips set driver_id=${user.id!}, status='ASSIGNED', assigned_at=now() where id=${offer.trip_id} and status='SEARCHING' returning id`;
      if (!accepted.length) return { error: "TRIP_ALREADY_ASSIGNED" };
      await tx`update driver_offers set responded_at=coalesce(responded_at, now()), accepted=coalesce(accepted, false) where trip_id=${offer.trip_id} and id<>${(request.params as { offerId: string }).offerId}`;
      await tx`insert into trip_events (trip_id, from_status, to_status, actor_id) values (${offer.trip_id}, 'SEARCHING', 'ASSIGNED', ${user.id!})`;
      return { status: "ASSIGNED", tripId: offer.trip_id };
    });
    if ("error" in result) return reply.code(409).send(result);
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
