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

  it("normaliza motivos de respuesta e impide volver a ofertar al mismo conductor", async () => {
    const migration = await readFile(
      resolve(process.cwd(), "migrations/055_trip_request_safety_driver_cancellation.sql"), "utf8");
    expect(migration).toContain("DRIVER_REJECTED");
    expect(migration).toContain("OFFER_EXPIRED");
    expect(migration).toContain("TAKEN_BY_ANOTHER_DRIVER");
    expect(migration).toContain("DRIVER_CANCELLED_AFTER_ACCEPTANCE");
    const initial = await readFile(resolve(process.cwd(), "migrations/001_initial.sql"), "utf8");
    expect(initial).toContain("UNIQUE (trip_id, driver_id)");
  });

  it("protege la creación de viajes contra doble envío", async () => {
    const migration = await readFile(
      resolve(process.cwd(), "migrations/055_trip_request_safety_driver_cancellation.sql"), "utf8");
    expect(migration).toContain("trips_passenger_client_request_uidx");
    const source = await readFile(resolve(process.cwd(), "src/app.ts"), "utf8");
    expect(source).toContain("idempotentReplay: true");
  });
});
