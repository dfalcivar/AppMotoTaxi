import { randomUUID } from "node:crypto";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "./app.js";
import { closeDatabase, database } from "./database.js";
import { startSession, releaseSession } from "./fleet/service.js";

interface SessionBody {
  token: string;
  user: { id: string; role: string };
}

const e2ePassengerId = "00000000-0000-4000-8000-00000000e201";
const e2eDriverId = "00000000-0000-4000-8000-00000000e202";
const e2eDriver2Id = "00000000-0000-4000-8000-00000000e203";

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
      insert into users (id, phone_e164, full_name, role, status, email, password_hash, phone_verified_at, terms_accepted_at)
      values (${e2eDriver2Id}, '+593990002203', 'Conductor E2E Dos', 'DRIVER', 'ACTIVE',
        'e2e.conductor2@mototaxi.local', crypt('E2eConductor2026!', gen_salt('bf')), now(), now())
      on conflict (id) do update set status='ACTIVE', email=excluded.email,
        password_hash=excluded.password_hash, active_session_id=null,
        must_change_password=false
    `;
    await tx`
      insert into drivers (user_id, approval_note, approved_at, is_available, approval_status)
      values (${e2eDriverId}, 'Cuenta automática E2E', now(), false, 'APROBADO')
      on conflict (user_id) do update set is_available=false, approval_status='APROBADO'
    `;
    await tx`
      insert into drivers (user_id, approval_note, approved_at, is_available, approval_status)
      values (${e2eDriver2Id}, 'Cuenta automática E2E', now(), false, 'APROBADO')
      on conflict (user_id) do update set is_available=false, approval_status='APROBADO'
    `;
    await tx`
      insert into vehicles (driver_id, identifier, maximum_passengers, status, fleet_status)
      values (${e2eDriverId}, 'E2E-TEST', 3, 'ACTIVE', 'VERIFIED')
      on conflict (identifier) do update set driver_id=excluded.driver_id, status='ACTIVE', fleet_status='VERIFIED'
    `;
    await tx`
      insert into vehicles (driver_id, identifier, maximum_passengers, status, fleet_status)
      values (${e2eDriver2Id}, 'E2E-TEST-2', 3, 'ACTIVE', 'VERIFIED')
      on conflict (identifier) do update set driver_id=excluded.driver_id, status='ACTIVE', fleet_status='VERIFIED'
    `;
    await tx`insert into user_vehicle_relations(user_id,vehicle_id,relation_type,status,source)
      select driver_id,id,'AUTHORIZED_DRIVER','APPROVED','LEGACY_MIGRATION' from vehicles
      where driver_id in (${e2eDriverId},${e2eDriver2Id}) and merged_into is null
      on conflict(user_id,vehicle_id,relation_type) do update set status='APPROVED'`;
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
      await tx`update trips set status='CANCELLED' where id=${tripId}
        and status in ('SEARCHING','ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS','INCIDENT')`;
    }
    await tx`update drivers set is_available=false where user_id in (${e2eDriverId},${e2eDriver2Id})`;
  });
  // Keep immutable assignment/session evidence. The disposable E2E database is
  // reset by its operator, never by deleting business audit rows in this runner.
  const sessions=await sql`select id,driver_id from driver_vehicle_sessions where status='ACTIVE'
    and driver_id in (${e2eDriverId},${e2eDriver2Id})`;
  for(const session of sessions)await releaseSession({id:String(session.driver_id)},String(session.id),'LOGOUT');
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL es obligatoria para test:flow.");
  const target=new URL(process.env.DATABASE_URL);
  if(process.env.E2E_DATABASE_CONFIRMED!=='true'||!['localhost','127.0.0.1','[::1]'].includes(target.hostname)||!/test|e2e/i.test(target.pathname)){
    throw new Error('test:flow requiere una BD local desechable con test/e2e en su nombre y E2E_DATABASE_CONFIRMED=true. No ejecutar sobre producción.');
  }
  await prepareAccounts();
  const app = await buildApp();
  let tripId: string | undefined;
  let driverToken: string | undefined;
  let driver2Token: string | undefined;
  try {
    const passenger = await request<SessionBody>(app, {
      method: "POST", url: "/v1/auth/session",
      payload: { email: "e2e.pasajero@mototaxi.local", password: "E2ePasajero2026!" }
    });
    const driver = await request<SessionBody>(app, {
      method: "POST", url: "/v1/auth/session",
      payload: { email: "e2e.conductor@mototaxi.local", password: "E2eConductor2026!" }
    });
    const driver2 = await request<SessionBody>(app, {
      method: "POST", url: "/v1/auth/session",
      payload: { email: "e2e.conductor2@mototaxi.local", password: "E2eConductor2026!" }
    });
    driverToken = driver.token; driver2Token = driver2.token;
    console.log("✓ Autenticación de pasajero y dos conductores");

    const [passengerActive, driverActive] = await Promise.all([
      request<unknown>(app, { method: "GET", url: "/v1/trips/active", headers: auth(passenger.token) }),
      request<unknown>(app, { method: "GET", url: "/v1/trips/active", headers: auth(driver.token) })
    ]);
    if (passengerActive || driverActive) {
      throw new Error("Las cuentas de prueba tienen un viaje activo. Finalízalo o cancélalo antes de ejecutar test:flow.");
    }

    const units=await database()`select id,driver_id from vehicles where identifier in ('E2E-TEST','E2E-TEST-2') and merged_into is null`;
    for(const unit of units)await startSession({id:String(unit.driver_id)},String(unit.id),'MANUAL_SELECTION');
    console.log('✓ Conductores con unidad autorizada y jornada confirmada');

    await Promise.all([driver, driver2].map((session, index) => request(app, {
      method: "PUT", url: "/v1/driver/availability", headers: auth(session.token),
      payload: { available: true, location: { latitude: -2.9001 + index * 0.0001, longitude: -79.0059 } }
    })));
    console.log("✓ Dos conductores disponibles con GPS de Cuenca");

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

    const offerLists = await Promise.all([driver, driver2].map(session => request<Array<{ offerId: string; tripId: string }>>(app, {
      method: "GET", url: "/v1/driver/offers", headers: auth(session.token)
    })));
    const offers = offerLists[0]!;
    const offers2 = offerLists[1]!;
    const offer = offers.find(value => value.tripId === tripId);
    const offer2 = offers2.find(value => value.tripId === tripId);
    if (!offer || !offer2) throw new Error("La solicitud no llegó a ambos conductores de concurrencia.");
    const responses = await Promise.all([
      app.inject({ method: "POST", url: `/v1/driver/offers/${offer.offerId}/respond`, headers: auth(driver.token), payload: { accept: true } }),
      app.inject({ method: "POST", url: `/v1/driver/offers/${offer2.offerId}/respond`, headers: auth(driver2.token), payload: { accept: true } })
    ]);
    const winnerIndex = responses.findIndex(response => response.statusCode === 200);
    if (winnerIndex < 0 || responses.filter(response => response.statusCode === 409).length !== 1) {
      throw new Error(`Aceptación no atómica: estados ${responses.map(value => value.statusCode).join(",")}`);
    }
    const winningDriver = winnerIndex === 0 ? driver : driver2;
    driverToken = winningDriver.token;
    console.log("✓ Aceptación concurrente atómica: un ganador y un conflicto controlado");

    const remainingOffers = await request<unknown[]>(app, {
      method: "GET", url: "/v1/driver/offers", headers: auth(winningDriver.token)
    });
    if (remainingOffers.length) throw new Error("El conductor conserva ofertas después de aceptar un viaje.");
    console.log("✓ Ofertas pendientes bloqueadas durante el viaje activo");

    const clientMessageId = randomUUID();
    await request(app, {
      method: "POST", url: `/v1/trips/${tripId}/messages`, headers: auth(passenger.token),
      payload: { clientMessageId, body: "Mensaje automático del flujo E2E" }
    }, 201);
    const messages = await request<Array<{ senderId: string; body: string }>>(app, {
      method: "GET", url: `/v1/trips/${tripId}/messages`, headers: auth(winningDriver.token)
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
        headers: auth(winningDriver.token), payload: { action }
      });
      if (result.status !== expectedStatus) throw new Error(`Estado inesperado para ${action}: ${result.status}`);
      console.log(`✓ Transición ${expectedStatus}`);
    }

    await request(app, {
      method: "POST", url: `/v1/trips/${tripId}/ratings`, headers: auth(passenger.token),
      payload: { score: 5, tags: ["Puntual"], comment: "Calificación automática" }
    });
    await request(app, {
      method: "POST", url: `/v1/trips/${tripId}/ratings`, headers: auth(winningDriver.token),
      payload: { score: 5, tags: ["Amable"], comment: "Calificación automática" }
    });
    console.log("✓ Calificación registrada por ambos participantes");

    const activeAfter = await request<unknown>(app, {
      method: "GET", url: "/v1/trips/active", headers: auth(winningDriver.token)
    });
    if (activeAfter) throw new Error("El viaje continúa activo después de finalizar.");
    console.log("✓ Flujo E2E completado correctamente");
  } finally {
    if (driverToken) {
      await app.inject({ method: "PUT", url: "/v1/driver/availability", headers: auth(driverToken), payload: { available: false } });
    }
    if (driver2Token && driver2Token !== driverToken) {
      await app.inject({ method: "PUT", url: "/v1/driver/availability", headers: auth(driver2Token), payload: { available: false } });
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
