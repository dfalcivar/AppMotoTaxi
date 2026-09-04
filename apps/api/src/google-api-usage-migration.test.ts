import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("agrega referencias de precio sin activar Navigation SDK", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`
      create table operational_settings (
        id integer primary key,
        navigation_pickup_provider text not null default 'EXTERNAL_MAPS',
        navigation_destination_provider text not null default 'EXTERNAL_MAPS'
      );
      insert into operational_settings(id) values (1);
    `);
    const migration = await readFile(
      new URL("../migrations/082_google_api_usage_metering.sql", import.meta.url),
      "utf8"
    );
    await pg.exec(migration);
    const [settings] = (await pg.query(`select
      routes_free_cap_reference as "routesFreeCap",
      routes_price_per_thousand_usd::float8 as "routesPrice",
      geocoding_free_cap_reference as "geocodingFreeCap",
      geocoding_price_per_thousand_usd::float8 as "geocodingPrice",
      navigation_price_per_thousand_usd::float8 as "navigationPrice",
      navigation_pickup_provider as "pickupProvider",
      navigation_destination_provider as "destinationProvider"
      from operational_settings where id=1`)).rows as Array<Record<string, unknown>>;
    expect(settings).toEqual({
      routesFreeCap: 10000,
      routesPrice: 5,
      geocodingFreeCap: 10000,
      geocodingPrice: 5,
      navigationPrice: 25,
      pickupProvider: "EXTERNAL_MAPS",
      destinationProvider: "EXTERNAL_MAPS"
    });
  } finally {
    await pg.close();
  }
}, 30_000);
