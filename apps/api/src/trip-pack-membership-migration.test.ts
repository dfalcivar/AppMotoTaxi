import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("agrega planes por viajes sin cambiar los planes periódicos existentes", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`
      create table membership_plans (
        id uuid primary key default gen_random_uuid(),
        code text not null,
        included_trips integer not null default 120
      );
      insert into membership_plans(code,included_trips) values ('MONTHLY',120);
      create table driver_memberships (
        id uuid primary key default gen_random_uuid(),
        status text not null default 'ACTIVE',
        constraint driver_memberships_status_check check(status in ('ACTIVE','CLOSED'))
      );
    `);
    const migration = await readFile(
      new URL("../migrations/083_trip_pack_memberships.sql", import.meta.url),
      "utf8"
    );
    await pg.exec(migration);
    const [existing] = (await pg.query(`select plan_type as "planType",pack_validity_days as "validity" from membership_plans where code='MONTHLY'`)).rows as Array<Record<string, unknown>>;
    expect(existing).toEqual({ planType: "PERIODIC", validity: null });
    await pg.exec(`insert into membership_plans(code,included_trips,plan_type,pack_validity_days) values ('PACK_10',10,'TRIP_PACK',null)`);
    await pg.exec(`insert into driver_memberships(status,plan_type_snapshot) values ('EXHAUSTED','TRIP_PACK')`);
    await expect(pg.exec(`insert into membership_plans(code,included_trips,plan_type) values ('PACK_0',0,'TRIP_PACK')`)).rejects.toThrow();
  } finally {
    await pg.close();
  }
}, 30_000);
