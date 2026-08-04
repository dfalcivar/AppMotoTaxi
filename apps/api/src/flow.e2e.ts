import { randomUUID } from "node:crypto";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "./app.js";
import { closeDatabase, database } from "./database.js";

interface SessionBody {
  token: string;
  user: { id: string; role: string };
}

const e2ePassengerId = "00000000-0000-4000-8000-00000000e201";
const e2eDriverId = "00000000-0000-4000-8000-00000000e202";

async function prepareAccounts(): Promise<void> {
  const sql = database();
  await sql.begin(async tx => {
    await tx`
      insert into users (id, phone_e164, full_name, role, status, email, password_hash, phone_verified_at, terms_accepted_at)
      values (${e2ePassengerId}, '+593990002201', 'Pasajero E2E', 'PASSENGER', 'ACTIVE',
        'e2e.pasajero@mototaxi.local', crypt('E2ePasajero2026!', gen_salt('bf')), now(), now())
      on conflict (id) do update set status='ACTIVE', email=excluded.email,
        password_hash=excluded.password_hash, active_session_id=null,
        must_change_password=false
    `;
    await tx`
      insert into users (id, phone_e164, full_name, role, status, email, password_hash, phone_verified_at, terms_accepted_at)
      values (${e2eDriverId}, '+593990002202', 'Conductor E2E', 'DRIVER', 'ACTIVE',
        'e2e.conductor@mototaxi.local', crypt('E2eConductor2026!', gen_salt('bf')), now(), now())
      on conflict (id) do update set status='ACTIVE', email=excluded.email,
        password_hash=excluded.password_hash, active_session_id=null,
        must_change_password=false
    `;
    await tx`
      insert into drivers (user_id, approval_note, approved_at, is_available)
      values (${e2eDriverId}, 'Cuenta automática E2E', now(), false)
      on conflict (user_id) do update set is_available=false
    `;
    await tx`
      insert into vehicles (driver_id, identifier, maximum_passengers, status)
      values (${e2eDriverId}, 'E2E-TEST', 3, 'ACTIVE')
      on conflict (identifier) do update set driver_id=excluded.driver_id, status='ACTIVE'
    `;
  });
}

async function request<T>(app: FastifyInstance, options: InjectOptions, expected = 200): Promise<T> {
  const response = await app.inject(options);
  if (response.statusCode !== expected) {
    throw new Error(`${options.method} ${options.url}: esperado ${expected}, recibido ${response.statusCode} ${response.body}`);
  }
  return response.json() as T;
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function cleanup(tripId?: string): Promise<void> {
  const sql = database();
  await sql.begin(async tx => {
    if (tripId) {
      await tx`delete from incidents where trip_id=${tripId}`;
      await tx`delete from driver_offers where trip_id=${tripId}`;
      await tx`delete from trip_events where trip_id=${tripId}`;
      await tx`delete from trips where id=${tripId}`;
    }
    await tx`delete from vehicles where driver_id=${e2eDriverId}`;
    await tx`delete from drivers where user_id=${e2eDriverId}`;
    await tx`delete from users where id in (${e2ePassengerId}, ${e2eDriverId})`;
  });
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL es obligatoria para test:flow.");
  await prepareAccounts();
  const app = await buildApp();
  let tripId: string | undefined;
  let driverToken: string | undefined;
  try {
    const passenger = await request<SessionBody>(app, {
      method: "POST", url: "/v1/auth/session",
      payload: { email: "e2e.pasajero@mototaxi.local", password: "E2ePasajero2026!" }
    });
    const driver = await request<SessionBody>(app, {
      method: "POST", url: "/v1/auth/session",
      payload: { email: "e2e.conductor@mototaxi.local", password: "E2eConductor2026!" }
    });
    driverToken = driver.token;
    console.log("✓ Autenticación de pasajero y conductor");

    const [passengerActive, driverActive] = await Promise.all([
      request<unknown>(app, { method: "GET", url: "/v1/trips/active", headers: auth(passenger.token) }),
      request<unknown>(app, { method: "GET", url: "/v1/trips/active", headers: auth(driver.token) })
    ]);
    if (passengerActive || driverActive) {
      throw new Error("Las cuentas de prueba tienen un viaje activo. Finalízalo o cancélalo antes de ejecutar test:flow.");
    }

    await request(app, {
      method: "PUT", url: "/v1/driver/availability", headers: auth(driver.token),
      payload: { available: true, location: { latitude: -2.9001, longitude: -79.0059 } }
    });
    console.log("✓ Conductor disponible con GPS de Cuenca");

    const created = await request<{ tripId: string; offers: number }>(app, {
      method: "POST", url: "/v1/trips", headers: auth(passenger.token),
      payload: {
        origin: { latitude: -2.9001, longitude: -79.0059 },
        destination: { latitude: -2.896063, longitude: -79.0077691 },
        passengers: 1,
        paymentMethod: "CASH",
        originReference: `E2E: origen ${randomUUID()}`,
        destinationReference: "E2E: Tarqui y Bolívar"
      }
    }, 201);
    tripId = created.tripId;
    if (created.offers < 1) throw new Error("La solicitud no generó ofertas para conductores cercanos.");
    console.log(`✓ Solicitud creada y distribuida (${created.offers} oferta/s)`);

    const offers = await request<Array<{ offerId: string; tripId: string }>>(app, {
      method: "GET", url: "/v1/driver/offers", headers: auth(driver.token)
    });
    const offer = offers.find(value => value.tripId === tripId);
    if (!offer) throw new Error("El conductor de prueba no recibió la oferta.");
    await request(app, {
      method: "POST", url: `/v1/driver/offers/${offer.offerId}/respond`,
      headers: auth(driver.token), payload: { accept: true }
    });
    console.log("✓ Oferta aceptada por un solo conductor");

    const remainingOffers = await request<unknown[]>(app, {
      method: "GET", url: "/v1/driver/offers", headers: auth(driver.token)
    });
    if (remainingOffers.length) throw new Error("El conductor conserva ofertas después de aceptar un viaje.");
    console.log("✓ Ofertas pendientes bloqueadas durante el viaje activo");

    const clientMessageId = randomUUID();
    await request(app, {
      method: "POST", url: `/v1/trips/${tripId}/messages`, headers: auth(passenger.token),
      payload: { clientMessageId, body: "Mensaje automático del flujo E2E" }
    }, 201);
    const messages = await request<Array<{ senderId: string; body: string }>>(app, {
      method: "GET", url: `/v1/trips/${tripId}/messages`, headers: auth(driver.token)
    });
    if (!messages.some(message => message.senderId === passenger.user.id && message.body === "Mensaje automático del flujo E2E")) {
      throw new Error("El mensaje no apareció en el historial del conductor.");
    }
    console.log("✓ Chat persistido y visible para el conductor");

    for (const [action, expectedStatus] of [
      ["ARRIVED", "DRIVER_ARRIVED"],
      ["START", "IN_PROGRESS"],
      ["COMPLETE", "COMPLETED"]
    ] as const) {
      const result = await request<{ status: string }>(app, {
        method: "POST", url: `/v1/trips/${tripId}/action`,
        headers: auth(driver.token), payload: { action }
      });
      if (result.status !== expectedStatus) throw new Error(`Estado inesperado para ${action}: ${result.status}`);
      console.log(`✓ Transición ${expectedStatus}`);
    }

    await request(app, {
      method: "POST", url: `/v1/trips/${tripId}/ratings`, headers: auth(passenger.token),
      payload: { score: 5, tags: ["Puntual"], comment: "Calificación automática" }
    });
    await request(app, {
      method: "POST", url: `/v1/trips/${tripId}/ratings`, headers: auth(driver.token),
      payload: { score: 5, tags: ["Amable"], comment: "Calificación automática" }
    });
    console.log("✓ Calificación registrada por ambos participantes");

    const activeAfter = await request<unknown>(app, {
      method: "GET", url: "/v1/trips/active", headers: auth(driver.token)
    });
    if (activeAfter) throw new Error("El viaje continúa activo después de finalizar.");
    console.log("✓ Flujo E2E completado correctamente");
  } finally {
    if (driverToken) {
      await app.inject({ method: "PUT", url: "/v1/driver/availability", headers: auth(driverToken), payload: { available: false } });
    }
    await cleanup(tripId);
    await app.close();
    await closeDatabase();
  }
}

main().catch(error => {
  console.error(`✗ ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
