import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("cancelación y reasignación de una carrera aceptada", () => {
  it("mantiene el mismo viaje, audita y reinicia la búsqueda progresiva", async () => {
    const source = await readFile(resolve(process.cwd(), "src/app.ts"), "utf8");
    expect(source).toContain('/v1/driver/trips/:tripId/cancel');
    expect(source).toContain("trip_driver_cancellations");
    expect(source).toContain("driver_search_round=0");
    expect(source).toContain("DRIVER_CANCELLED_REASSIGNING");
    expect(source).toContain("redispatchOldestTrip(tripId)");
    expect(source).toContain("await Promise.all([");
  });

  it("normaliza motivos y solo reactiva ofertas cerradas porque el conductor estaba ocupado", async () => {
    const migration = await readFile(
      resolve(process.cwd(), "migrations/055_trip_request_safety_driver_cancellation.sql"), "utf8");
    expect(migration).toContain("DRIVER_REJECTED");
    expect(migration).toContain("OFFER_EXPIRED");
    expect(migration).toContain("TAKEN_BY_ANOTHER_DRIVER");
    expect(migration).toContain("DRIVER_CANCELLED_AFTER_ACCEPTANCE");
    const initial = await readFile(resolve(process.cwd(), "migrations/001_initial.sql"), "utf8");
    expect(initial).toContain("UNIQUE (trip_id, driver_id)");
    const source = await readFile(resolve(process.cwd(), "src/app.ts"), "utf8");
    const returningDispatch = source.slice(
      source.indexOf("async function dispatchReachedTripsToDriver"),
      source.indexOf("async function processDueDriverSearchRounds")
    );
    expect(returningDispatch).toContain("on conflict (trip_id, driver_id) do update");
    expect(returningDispatch).toContain("existing_offer.response_reason='DRIVER_BUSY'");
    expect(returningDispatch).toContain("existing_offer.accepted=false");
    expect(returningDispatch).toContain("ST_DWithin(d.last_location, t.origin, t.driver_search_upper_meters)");
    expect(returningDispatch).not.toContain("ST_Distance(d.last_location,t.origin)>t.driver_search_lower_meters");
  });

  it("protege la creación de viajes contra doble envío", async () => {
    const migration = await readFile(
      resolve(process.cwd(), "migrations/055_trip_request_safety_driver_cancellation.sql"), "utf8");
    expect(migration).toContain("trips_passenger_client_request_uidx");
    const source = await readFile(resolve(process.cwd(), "src/app.ts"), "utf8");
    expect(source).toContain("idempotentReplay: true");
  });
});
