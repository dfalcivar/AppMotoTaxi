import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("agrega parámetros y trazabilidad sin alterar las reservas existentes", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`
      create table operational_settings (id integer primary key);
      create table trips (
        id uuid primary key,
        scheduled_for timestamptz,
        status text not null,
        schedule_status text
      );
      insert into operational_settings(id) values (1);
      insert into trips(id, scheduled_for, status, schedule_status)
      values ('00000000-0000-4000-8000-000000000001', now() + interval '1 day', 'SEARCHING', 'SCHEDULED_ASSIGNED');
    `);
    const migration = await readFile(new URL("../migrations/076_scheduled_trip_driver_confirmation.sql", import.meta.url), "utf8");
    await pg.exec(migration);
    const [settings] = (await pg.query(`select scheduled_trip_driver_reminder_minutes as reminder,
      scheduled_trip_confirmation_grace_minutes as grace from operational_settings where id=1`)).rows as Array<{reminder:number;grace:number}>;
    const [trip] = (await pg.query(`select status,schedule_status,
      driver_prepare_reminder_sent_at,driver_confirmation_requested_at,driver_confirmation_deadline_at
      from trips where id='00000000-0000-4000-8000-000000000001'`)).rows as Array<Record<string,unknown>>;
    expect(settings).toEqual({ reminder: 30, grace: 5 });
    expect(trip).toMatchObject({ status: "SEARCHING", schedule_status: "SCHEDULED_ASSIGNED" });
    expect(trip?.driver_prepare_reminder_sent_at).toBeNull();
    expect(trip?.driver_confirmation_requested_at).toBeNull();
    expect(trip?.driver_confirmation_deadline_at).toBeNull();
  } finally {
    await pg.close();
  }
}, 30_000);
