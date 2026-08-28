import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import { z } from "zod";
import { userFrom, type SessionUser } from "./admin.js";
import { database } from "./database.js";
import { sendPush, pushPresentationForType } from "./push.js";
import { resolveServiceArea } from "./service-areas.js";

const pointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180)
});
const paymentMethodSchema = z.enum(["CASH", "DEUNA"]);

const incomingSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("trip:subscribe"), tripId: z.string().uuid() }),
  z.object({
    type: z.literal("nearby:subscribe"),
    latitude: pointSchema.shape.latitude,
    longitude: pointSchema.shape.longitude,
    paymentMethod: paymentMethodSchema.default("CASH")
  }),
  z.object({
    type: z.literal("driver:location"),
    tripId: z.string().uuid().optional(),
    latitude: pointSchema.shape.latitude,
    longitude: pointSchema.shape.longitude,
    bearing: z.number().min(0).max(360).optional(),
    speed: z.number().min(0).max(100).optional(),
    accuracy: z.number().min(0).max(1000).optional(),
    recordedAt: z.string().datetime(),
    sequence: z.number().int().nonnegative()
  }),
  z.object({
    type: z.literal("chat:send"),
    tripId: z.string().uuid(),
    clientMessageId: z.string().uuid(),
    body: z.string().trim().min(1).max(500)
  }),
  z.object({ type: z.literal("chat:read"), tripId: z.string().uuid() })
]);

const historyQuerySchema = z.object({ before: z.string().datetime().optional() });
const nearbyQuerySchema = pointSchema.extend({ paymentMethod: paymentMethodSchema.default("CASH") });
const restMessageSchema = z.object({ clientMessageId: z.string().uuid(), body: z.string().trim().min(1).max(500) });

interface ClientState {
  socket: WebSocket;
  user: SessionUser;
  tripIds: Set<string>;
  nearby?: { latitude: number; longitude: number; paymentMethod: "CASH" | "DEUNA" };
}

interface ChatInput {
  tripId: string;
  clientMessageId: string;
  body: string;
}

interface LiveLocation {
  tripId: string;
  latitude: number;
  longitude: number;
  bearing: number | null;
  speed: number | null;
  accuracy: number | null;
  recordedAt: string;
  sequence: number;
}

export interface RealtimeHub {
  publishTripStatus(tripId: string, status: string): void;
  publishTripEvent(tripId: string, type: string, payload?: Record<string, unknown>): void;
  publishDriverUnavailable(driverId: string): void;
  publishToUser(userId: string, payload: unknown): void;
}

function publicDriverId(driverId: string): string {
  const salt = process.env.ADMIN_SESSION_SECRET ?? "local-development-secret-change-me";
  return createHash("sha256").update(`${salt}:${driverId}`).digest("hex").slice(0, 16);
}

function send(socket: WebSocket, value: unknown): void {
  if (socket.readyState === 1) socket.send(JSON.stringify(value));
}

function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const earthRadius = 6_371_000;
  const latitudeDelta = radians(b.latitude - a.latitude);
  const longitudeDelta = radians(b.longitude - a.longitude);
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

async function authenticated(request: FastifyRequest, reply?: FastifyReply): Promise<SessionUser | undefined> {
  const user = userFrom(request);
  if (!user?.id || !user.sessionId) {
    if (reply) reply.code(401).send({ error: "UNAUTHORIZED" });
    return;
  }
  const active = await database()`select 1 from users where id=${user.id} and active_session_id=${user.sessionId}::uuid and must_change_password=false`;
  if (!active.length) {
    if (reply) reply.code(401).send({ error: "SESSION_REPLACED" });
    return;
  }
  return user;
}

async function tripForParticipant(user: SessionUser, tripId: string) {
  const [trip] = await database()`
    select id::text as "tripId", passenger_id::text as "passengerId", driver_id::text as "driverId",
      status, completed_at as "completedAt"
    from trips
    where id=${tripId} and (${user.id!}=passenger_id or ${user.id!}=driver_id)
  `;
  return trip as { tripId: string; passengerId: string; driverId: string | null; status: string; completedAt: Date | null } | undefined;
}

async function nearbyDrivers(
  latitude: number,
  longitude: number,
  paymentMethod: "CASH" | "DEUNA" = "CASH",
  excludeDriverId?: string,
  onlyDriverId?: string
) {
  const [settings] = await database()`select search_radius_meters from operational_settings where id=1`;
  const radius = Number(settings?.search_radius_meters ?? 3000);
  const rows = await database()`
    select d.user_id::text as "driverId",
      ST_Y(d.last_location::geometry) as latitude,
      ST_X(d.last_location::geometry) as longitude,
      d.last_location_at as "recordedAt"
    from drivers d
    join users u on u.id=d.user_id
    where d.is_available=true and fleet_driver_can_receive(d.user_id) and u.status='ACTIVE' and u.deleted_at is null
      and (${onlyDriverId ?? null}::uuid is null or d.user_id=${onlyDriverId ?? null}::uuid)
      and d.approval_status='APROBADO' and d.last_location is not null
      and (${paymentMethod}='CASH' or d.deuna_enabled=true)
      and not exists (
        select 1 from driver_documents dd
        where dd.driver_id=d.user_id and dd.status='SUSPENDED'
      )
      and ((select not membership_enforcement_enabled from operational_settings where id=1)
        or exists (
          select 1 from driver_memberships dm
          where dm.driver_id=d.user_id and dm.cycle_closed_at is null
            and (dm.status in ('ACTIVE','EXPIRING','PAYMENT_DUE')
              or (dm.status='GRACE_PERIOD' and dm.grace_allows_trips_applied=true))
            and (dm.suspension_at is null or dm.suspension_at>now())
        ))
      and (${excludeDriverId ?? null}::uuid is null or d.user_id <> ${excludeDriverId ?? null}::uuid)
      and d.last_location_at > now() - interval '5 minutes'
      and not exists (
        select 1 from trips t where t.driver_id=d.user_id
          and t.status in ('ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS')
      )
      and ST_DWithin(
        d.last_location,
        ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}),4326)::geography,
        ${radius}
      )
    order by ST_Distance(d.last_location, ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}),4326)::geography)
  `;
  return rows.map(row => ({
    driverId: publicDriverId(String(row.driverId)),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    recordedAt: new Date(row.recordedAt as string | Date).toISOString()
  }));
}

async function createMessage(user: SessionUser, input: ChatInput) {
  const trip = await tripForParticipant(user, input.tripId);
  if (!trip?.driverId) throw new Error("TRIP_NOT_AVAILABLE");
  const activeStatuses = new Set(["ASSIGNED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "IN_PROGRESS"]);
  const recentlyCompleted = trip.status === "COMPLETED" && trip.completedAt
    && Date.now() - new Date(trip.completedAt).getTime() <= 30 * 60 * 1000;
  if (!activeStatuses.has(trip.status) && !recentlyCompleted) throw new Error("CHAT_CLOSED");
  const [message] = await database()`
    insert into trip_messages (trip_id, sender_id, client_message_id, body)
    values (${input.tripId}, ${user.id!}, ${input.clientMessageId}, ${input.body})
    on conflict (trip_id, sender_id, client_message_id)
      do update set body=trip_messages.body
    returning id::text, trip_id::text as "tripId", sender_id::text as "senderId",
      (xmax = 0) as "created", body, created_at as "createdAt", read_at as "readAt"
  `;
  return {
    ...message,
    created: Boolean((message as Record<string, unknown>).created),
    mine: true,
    senderName: user.name,
    recipientId: user.id === trip.passengerId ? trip.driverId : trip.passengerId
  };
}

function statusForError(error: unknown): { status: number; code: string } {
  const code = error instanceof Error ? error.message : "REALTIME_ERROR";
  if (code === "TRIP_NOT_AVAILABLE") return { status: 404, code };
  if (code === "CHAT_CLOSED") return { status: 409, code };
  return { status: 500, code: "REALTIME_ERROR" };
}

export function registerRealtimeRoutes(app: FastifyInstance): RealtimeHub {
  const clients = new Set<ClientState>();

  const broadcastTrip = (tripId: string, payload: unknown) => {
    for (const client of clients) if (client.tripIds.has(tripId)) send(client.socket, payload);
  };

  const broadcastNearbyLocation = async (driverId: string, location: { latitude: number; longitude: number; recordedAt: string }) => {
    const [settings] = await database()`select search_radius_meters from operational_settings where id=1`;
    const [driver] = await database()`select deuna_enabled as "deunaEnabled" from drivers where user_id=${driverId}`;
    const eligible = await nearbyDrivers(location.latitude, location.longitude, 'CASH', undefined, driverId);
    const radius = Number(settings?.search_radius_meters ?? 3000);
    for (const client of clients) {
      if (!client.nearby) continue;
      if (!eligible.length || distanceMeters(client.nearby, location) > radius ||
          (client.nearby.paymentMethod === "DEUNA" && driver?.deunaEnabled !== true)) {
        send(client.socket, {type:'nearby:remove', driverId:publicDriverId(driverId)});
        continue;
      }
      send(client.socket, {
        type: "nearby:update",
        paymentMethod: client.nearby.paymentMethod,
        driver: { driverId: publicDriverId(driverId), ...location }
      });
    }
  };

  const publishDriverUnavailable = (driverId: string) => {
    const publicId = publicDriverId(driverId);
    for (const client of clients) if (client.nearby) send(client.socket, { type: "nearby:remove", driverId: publicId });
  };

  app.get("/v1/realtime", { websocket: true }, (socket, request) => {
    void (async () => {
      const user = await authenticated(request);
      if (!user) {
        socket.close(4401, "UNAUTHORIZED");
        return;
      }
      const state: ClientState = { socket, user, tripIds: new Set() };
      clients.add(state);
      send(socket, { type: "connected", userId: user.id, role: user.role });

      socket.on("message", (raw: { toString(): string }) => {
        void (async () => {
          let decoded: unknown;
          try { decoded = JSON.parse(raw.toString()); }
          catch { send(socket, { type: "error", code: "INVALID_JSON" }); return; }
          const parsed = incomingSchema.safeParse(decoded);
          if (!parsed.success) { send(socket, { type: "error", code: "INVALID_EVENT" }); return; }
          const event = parsed.data;

          if (event.type === "trip:subscribe") {
            const trip = await tripForParticipant(user, event.tripId);
            if (!trip) { send(socket, { type: "error", code: "TRIP_NOT_FOUND" }); return; }
            state.tripIds.add(event.tripId);
            const [live] = await database()`
              select ST_Y(position::geometry) as latitude, ST_X(position::geometry) as longitude,
                bearing, speed_mps as speed, accuracy_meters as accuracy,
                recorded_at as "recordedAt", sequence
              from trip_live_locations where trip_id=${event.tripId}
            `;
            send(socket, { type: "trip:subscribed", tripId: event.tripId, liveLocation: live ?? null });
            return;
          }

          if (event.type === "nearby:subscribe") {
            if (user.role !== "PASSENGER") { send(socket, { type: "error", code: "FORBIDDEN" }); return; }
            state.nearby = {
              latitude: event.latitude,
              longitude: event.longitude,
              paymentMethod: event.paymentMethod
            };
            send(socket, {
              type: "nearby:snapshot",
              paymentMethod: event.paymentMethod,
              drivers: await nearbyDrivers(event.latitude, event.longitude, event.paymentMethod)
            });
            return;
          }

          if (event.type === "driver:location") {
            if (user.role !== "DRIVER") { send(socket, { type: "error", code: "FORBIDDEN" }); return; }
            const recordedAt = new Date(event.recordedAt);
            if (Math.abs(Date.now() - recordedAt.getTime()) > 10 * 60 * 1000) {
              send(socket, { type: "error", code: "STALE_LOCATION" }); return;
            }
            await database()`update driver_vehicle_sessions set last_heartbeat=now(),updated_at=now()
              where driver_id=${user.id!} and status='ACTIVE'
                and (fleet_driver_has_active_trip(driver_id) or last_heartbeat>now()-make_interval(secs=>(select auto_release_seconds from fleet_settings)))`;
            const [driver] = await database()`
              update drivers set
                last_location=ST_SetSRID(ST_MakePoint(${event.longitude}, ${event.latitude}),4326)::geography,
                last_location_at=${recordedAt}
              where user_id=${user.id!}
              returning is_available as available
            `;
            const [activeTrip] = await database()`
              select id::text as "tripId" from trips
              where driver_id=${user.id!} and status in ('ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS')
              order by requested_at desc limit 1
            `;
            if (activeTrip) {
              const tripId = String(activeTrip.tripId);
              if (event.tripId && event.tripId !== tripId) { send(socket, { type: "error", code: "TRIP_MISMATCH" }); return; }
              const [saved] = await database()`
                insert into trip_live_locations
                  (trip_id, driver_id, position, bearing, speed_mps, accuracy_meters, sequence, recorded_at)
                values (
                  ${tripId}, ${user.id!},
                  ST_SetSRID(ST_MakePoint(${event.longitude}, ${event.latitude}),4326)::geography,
                  ${event.bearing ?? null}, ${event.speed ?? null}, ${event.accuracy ?? null}, ${event.sequence}, ${recordedAt}
                )
                on conflict (trip_id) do update set
                  position=excluded.position, bearing=excluded.bearing, speed_mps=excluded.speed_mps,
                  accuracy_meters=excluded.accuracy_meters, sequence=excluded.sequence,
                  recorded_at=excluded.recorded_at, updated_at=now()
                where excluded.sequence > trip_live_locations.sequence
                returning trip_id
              `;
              if (saved) await database()`
                insert into trip_location_history
                  (trip_id, driver_id, position, bearing, speed_mps, accuracy_meters, sequence, recorded_at)
                values (
                  ${tripId}, ${user.id!},
                  ST_SetSRID(ST_MakePoint(${event.longitude}, ${event.latitude}),4326)::geography,
                  ${event.bearing ?? null}, ${event.speed ?? null}, ${event.accuracy ?? null}, ${event.sequence}, ${recordedAt}
                )
              `;
              const location: LiveLocation = {
                tripId, latitude: event.latitude, longitude: event.longitude,
                bearing: event.bearing ?? null, speed: event.speed ?? null,
                accuracy: event.accuracy ?? null, recordedAt: event.recordedAt, sequence: event.sequence
              };
              if (saved) broadcastTrip(tripId, { type: "driver:location", location });
              send(socket, { type: "driver:location:ack", tripId, sequence: event.sequence });
              return;
            }
            if (driver?.available) await broadcastNearbyLocation(user.id!, {
              latitude: event.latitude, longitude: event.longitude, recordedAt: event.recordedAt
            });
            send(socket, { type: "driver:location:ack", sequence: event.sequence });
            return;
          }

          if (event.type === "chat:send") {
            try {
              const message = await createMessage(user, event);
              send(socket, { type: "chat:ack", clientMessageId: event.clientMessageId, message });
              const pushData: Record<string, string> = {
                type: "CHAT_MESSAGE",
                tripId: event.tripId,
                messageId: String((message as Record<string, unknown>).id ?? event.clientMessageId)
              };
              const push = message.created ? await sendPush(String(message.recipientId), `Mensaje de ${user.name}`, event.body, pushData) : { sent: 1, failed: 0 };
              if (message.created) broadcastTrip(event.tripId, {
                type: "chat:message",
                message: { ...message, mine: undefined, recipientId: undefined, created: undefined,
                  notificationId: pushData.internalNotificationId }
              });
              if (push.sent === 0) app.log.warn({
                type: "CHAT_MESSAGE", tripId: event.tripId,
                recipientId: String(message.recipientId),
                errorCode: push.errorCode, failed: push.failed
              }, "chat_push_not_delivered");
            } catch (error) {
              send(socket, { type: "error", code: statusForError(error).code });
            }
            return;
          }

          if (event.type === "chat:read") {
            const trip = await tripForParticipant(user, event.tripId);
            if (!trip) { send(socket, { type: "error", code: "TRIP_NOT_FOUND" }); return; }
            await database()`update trip_messages set read_at=coalesce(read_at, now()) where trip_id=${event.tripId} and sender_id<>${user.id!}`;
            broadcastTrip(event.tripId, { type: "chat:read", tripId: event.tripId, readAt: new Date().toISOString() });
          }
        })().catch(error => send(socket, { type: "error", code: error instanceof Error ? error.message : "REALTIME_ERROR" }));
      });

      socket.on("close", () => clients.delete(state));
    })().catch(() => socket.close(1011, "REALTIME_ERROR"));
  });

  app.get("/v1/drivers/nearby", async (request, reply) => {
    const user = await authenticated(request, reply); if (!user) return;
    if (user.role !== "PASSENGER" && user.role !== "DRIVER") return reply.code(403).send({ error: "FORBIDDEN" });
    const parsed = nearbyQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_LOCATION" });
    const area = await resolveServiceArea(user.id!, parsed.data);
    if (!area) return reply.code(422).send({ error: "OUTSIDE_SERVICE_AREA" });
    return {
      drivers: await nearbyDrivers(
        parsed.data.latitude,
        parsed.data.longitude,
        parsed.data.paymentMethod,
        user.role === "DRIVER" ? user.id : undefined
      )
    };
  });

  app.get("/v1/trips/:tripId/messages", async (request, reply) => {
    const user = await authenticated(request, reply); if (!user) return;
    const tripId = (request.params as { tripId: string }).tripId;
    if (!(await tripForParticipant(user, tripId))) return reply.code(404).send({ error: "TRIP_NOT_FOUND" });
    const parsed = historyQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_QUERY" });
    const before = parsed.data.before ? new Date(parsed.data.before) : new Date();
    const rows = await database()`
      select m.id::text, m.trip_id::text as "tripId", m.sender_id::text as "senderId",
        u.full_name as "senderName", m.body, m.created_at as "createdAt", m.read_at as "readAt"
      from trip_messages m join users u on u.id=m.sender_id
      where m.trip_id=${tripId} and m.created_at < ${before}
      order by m.created_at desc limit 100
    `;
    return rows.reverse().map(message => ({ ...message, mine: String(message.senderId) === user.id }));
  });

  app.post("/v1/trips/:tripId/messages", async (request, reply) => {
    const user = await authenticated(request, reply); if (!user) return;
    const parsed = restMessageSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_MESSAGE" });
    const tripId = (request.params as { tripId: string }).tripId;
    try {
      const message = await createMessage(user, { tripId, ...parsed.data });
      const pushData: Record<string, string> = {
        type: "CHAT_MESSAGE",
        tripId,
        messageId: String((message as Record<string, unknown>).id ?? parsed.data.clientMessageId)
      };
      const push = message.created ? await sendPush(String(message.recipientId), `Mensaje de ${user.name}`, parsed.data.body, pushData) : { sent: 1, failed: 0 };
      if (message.created) broadcastTrip(tripId, {
        type: "chat:message",
        message: { ...message, mine: undefined, recipientId: undefined, created: undefined,
          notificationId: pushData.internalNotificationId }
      });
      if (push.sent === 0) request.log.warn({
        type: "CHAT_MESSAGE", tripId,
        recipientId: String(message.recipientId),
        errorCode: push.errorCode, failed: push.failed
      }, "chat_push_not_delivered");
      return reply.code(201).send(message);
    } catch (error) {
      const mapped = statusForError(error);
      return reply.code(mapped.status).send({ error: mapped.code });
    }
  });

  const heartbeat = setInterval(() => {
    for (const client of clients) if (client.socket.readyState === 1) client.socket.ping();
  }, 25_000);
  heartbeat.unref();
  app.addHook("onClose", async () => clearInterval(heartbeat));

  return {
    publishTripStatus(tripId, status) {
      const presentation=pushPresentationForType(status,'Actualización del viaje','El estado de tu viaje cambió.');
      broadcastTrip(tripId, { type: "trip:status", tripId, status, ...presentation, occurredAt: new Date().toISOString() });
    },
    publishTripEvent(tripId, type, payload = {}) {
      broadcastTrip(tripId, { type, tripId, ...payload, occurredAt: new Date().toISOString() });
    },
    publishDriverUnavailable,
    publishToUser(userId, payload) {
      for (const client of clients) {
        if (client.user.id === userId) send(client.socket, payload);
      }
    }
  };
}
