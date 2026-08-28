import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { database } from "./database.js";
import { userFrom } from "./admin.js";

const terminalStatuses = new Set(["COMPLETED", "CANCELLED", "NO_DRIVER"]);
const trackingStatuses = new Set(["ASSIGNED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "IN_PROGRESS"]);

const statusLabels: Record<string, string> = {
  SEARCHING: "Buscando conductor",
  ASSIGNED: "Conductor asignado",
  DRIVER_EN_ROUTE: "Conductor en camino",
  DRIVER_ARRIVED: "El conductor llegó",
  IN_PROGRESS: "Viaje en curso",
  COMPLETED: "Viaje finalizado",
  CANCELLED: "Viaje cancelado",
  NO_DRIVER: "Sin conductor disponible",
  INCIDENT: "Viaje con incidencia",
};

function normalizePhone(countryCode: string, phone: string): string {
  const cleanCountry = countryCode.replace(/\D/g, "");
  const cleanPhone = phone.replace(/\D/g, "").replace(/^0+/, "");
  return cleanPhone.startsWith(cleanCountry) ? cleanPhone : `${cleanCountry}${cleanPhone}`;
}

async function safeTrip(tripId: string) {
  const [trip] = await database()`
    select t.id::text, t.passenger_id::text as "passengerId", t.driver_id::text as "driverId",
      t.status::text, t.origin_reference as "originReference",
      t.destination_reference as "destinationReference", t.requested_at as "requestedAt",
      t.started_at as "startedAt", t.completed_at as "completedAt", t.cancelled_at as "cancelledAt",
      u.full_name as "driverName", p.full_name as "passengerName",
      coalesce(nullif(v.identifier,''), 'Sin identificar') as "vehicleIdentifier",
      coalesce(d.rating, 0)::float as "driverRating",
      st_y(ll.position::geometry)::float as latitude,
      st_x(ll.position::geometry)::float as longitude, ll.recorded_at as "locationUpdatedAt"
    from trips t
    left join users u on u.id=t.driver_id
    left join drivers d on d.user_id=t.driver_id
    left join users p on p.id=t.passenger_id
    left join lateral (
      select vehicle.identifier from vehicles vehicle
      where vehicle.id=t.vehicle_id or vehicle.driver_id=t.driver_id
      order by (vehicle.id=t.vehicle_id) desc nulls last, vehicle.created_at desc
      limit 1
    ) v on true
    left join lateral (
      select location.position,location.recorded_at
      from trip_live_locations location
      where location.trip_id=t.id and location.driver_id=t.driver_id
      order by location.recorded_at desc limit 1
    ) ll on true
    where t.id=${tripId}::uuid
    limit 1
  `;
  return trip;
}

async function sharingSettings() {
  const [row] = await database()`
    select coalesce(trip_tracking_grace_minutes,45)::int as "graceMinutes",
      coalesce(support_whatsapp_country_code,'593') as "countryCode",
      coalesce(support_whatsapp_number,'') as "phone",
      coalesce(support_whatsapp_enabled,false) as "supportEnabled"
    from operational_settings where id=1
  `;
  const envPhone = process.env.SUPPORT_WHATSAPP ?? "";
  return {
    graceMinutes: Number(row?.graceMinutes ?? 45),
    countryCode: String(row?.countryCode ?? "593"),
    phone: String(row?.phone || envPhone),
    supportEnabled: row ? row.supportEnabled === true : envPhone.length > 0,
  };
}

function isExpired(trip: Record<string, any>, graceMinutes: number): boolean {
  if (!terminalStatuses.has(String(trip.status))) return false;
  const finished = trip.completedAt ?? trip.cancelledAt ?? trip.requestedAt;
  return Date.now() > new Date(finished).getTime() + graceMinutes * 60_000;
}

async function shareLink(tripId: string, userId: string): Promise<{ publicReference: string; token: string }> {
  const [existing] = await database()`
    select public_reference as "publicReference", access_token as token
    from trip_share_links where trip_id=${tripId}::uuid and revoked_at is null
  `;
  if (existing) return {
    publicReference: String(existing.publicReference),
    token: String(existing.token),
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = randomBytes(32).toString("base64url");
    const publicReference = `CG-${randomBytes(5).toString("hex").toUpperCase()}`;
    try {
      const [created] = await database()`
        insert into trip_share_links(trip_id,public_reference,access_token,created_by)
        values(${tripId}::uuid,${publicReference},${token},${userId}::uuid)
        on conflict(trip_id) do update set revoked_at=null
        returning public_reference as "publicReference", access_token as token
      `;
      if (created) return {
        publicReference: String(created.publicReference),
        token: String(created.token),
      };
    } catch (error: any) {
      if (error?.code !== "23505" || attempt === 2) throw error;
    }
  }
  throw new Error("SHARE_LINK_UNAVAILABLE");
}

function publicPayload(trip: Record<string, any>, publicReference: string) {
  const terminal = terminalStatuses.has(String(trip.status));
  const latitude = Number(trip.latitude), longitude = Number(trip.longitude);
  const validLocation = trip.driverId && trackingStatuses.has(String(trip.status)) &&
    trip.latitude != null && trip.longitude != null &&
    Number.isFinite(latitude) && Math.abs(latitude) <= 90 &&
    Number.isFinite(longitude) && Math.abs(longitude) <= 180 &&
    trip.locationUpdatedAt != null && Number.isFinite(new Date(trip.locationUpdatedAt).getTime());
  return {
    publicReference,
    status: String(trip.status),
    statusLabel: statusLabels[String(trip.status)] ?? "Estado del viaje",
    driverName: trip.driverName ?? "Conductor por asignar",
    vehicleIdentifier: trip.vehicleIdentifier ?? "Sin identificar",
    driverRating: Number(trip.driverRating ?? 0),
    originReference: trip.originReference ?? "Origen",
    destinationReference: trip.destinationReference ?? "Destino",
    startedAt: trip.startedAt ?? trip.requestedAt,
    // La página conserva el estado durante la gracia, pero deja de publicar
    // la última ubicación en cuanto el viaje termina.
    location: !validLocation ? null : {
      latitude, longitude,
      updatedAt: trip.locationUpdatedAt,
    },
    terminal,
  };
}

export async function registerTripSharingRoutes(app: FastifyInstance) {
  app.post("/v1/trips/:tripId/share", async (request: FastifyRequest<{ Params: { tripId: string } }>, reply: FastifyReply) => {
    reply.header("Cache-Control", "no-store");
    const parsed = z.string().uuid().safeParse(request.params.tripId);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_TRIP_ID" });
    const user = userFrom(request);
    if (!user?.id) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const trip = await safeTrip(request.params.tripId);
    if (!trip) return reply.code(404).send({ error: "TRIP_NOT_FOUND" });
    if (trip.passengerId !== user.id && trip.driverId !== user.id) return reply.code(403).send({ error: "FORBIDDEN" });
    const settings = await sharingSettings();
    if (isExpired(trip, settings.graceMinutes)) return reply.code(410).send({ error: "TRIP_SHARE_EXPIRED" });
    const link = await shareLink(request.params.tripId, user.id);
    const publicUrl = `${(process.env.PUBLIC_SITE_BASE_URL ?? "https://costa-go.com").replace(/\/$/, "")}/viaje/${link.token}`;
    const payload = publicPayload(trip, link.publicReference);
    const message = [
      "🚕 Estoy viajando con Costa-Go.",
      user.id === trip.driverId
        ? `Pasajero: ${trip.passengerName ?? 'Pasajero'}`
        : `Conductor: ${payload.driverName}`,
      `Mototaxi: ${payload.vehicleIdentifier}`,
      `Calificación: ${payload.driverRating.toFixed(1)}`,
      `Origen: ${payload.originReference}`,
      `Destino: ${payload.destinationReference}`,
      `Estado: ${payload.statusLabel}`,
      `Referencia: ${payload.publicReference}`,
      `Sigue el viaje de forma segura: ${publicUrl}`,
      "Por seguridad, no compartas datos personales.",
    ].join("\n");
    const supportText = `Hola, necesito ayuda con el viaje ${payload.publicReference}. Estado: ${payload.statusLabel}. Ruta: ${payload.originReference} → ${payload.destinationReference}. Seguimiento seguro: ${publicUrl}`;
    const supportUrl = settings.supportEnabled && settings.phone
      ? `https://wa.me/${normalizePhone(settings.countryCode, settings.phone)}?text=${encodeURIComponent(supportText)}`
      : null;
    return { message, publicUrl, supportUrl, trip: payload };
  });

  app.get("/v1/public/trips/:token", async (request: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply) => {
    reply.header("Cache-Control", "no-store");
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(request.params.token)) return reply.code(404).send({ error: "TRIP_SHARE_NOT_FOUND" });
    const [link] = await database()`
      select trip_id::text as "tripId", public_reference as "publicReference"
      from trip_share_links where access_token=${request.params.token} and revoked_at is null
    `;
    if (!link) return reply.code(404).send({ error: "TRIP_SHARE_NOT_FOUND" });
    const trip = await safeTrip(link.tripId);
    if (!trip) return reply.code(404).send({ error: "TRIP_SHARE_NOT_FOUND" });
    const settings = await sharingSettings();
    if (isExpired(trip, settings.graceMinutes)) return reply.code(410).send({ error: "TRIP_SHARE_EXPIRED" });
    return {
      trip: publicPayload(trip, link.publicReference), refreshSeconds: 15,
      serverTime: new Date().toISOString(), locationFreshnessSeconds: 60,
    };
  });
}
