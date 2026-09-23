import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("adds disabled commissions without changing existing closure balances", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`
      create table users (id uuid primary key);
      create table collection_points (id uuid primary key);
      create table collection_point_closures (id uuid primary key, collection_point_id uuid references collection_points(id), gross_amount numeric(12,2), commission_amount numeric(12,2), net_amount numeric(12,2));
      insert into collection_points values ('00000000-0000-0000-0000-000000000001');
      insert into collection_point_closures values ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001',34.50,0,34.50);
    `);
    await pg.exec(await readFile(new URL("../migrations/098_collection_point_commissions.sql", import.meta.url), "utf8"));
    const point = await pg.query<{ commission_enabled: boolean; commission_per_payment: string; commission_price_basis: string }>("select commission_enabled,commission_per_payment,commission_price_basis from collection_points");
    const closure = await pg.query<{ commission_payment_count: number; net_amount: string }>("select commission_payment_count,net_amount from collection_point_closures");
    expect(point.rows[0]).toMatchObject({ commission_enabled: false, commission_price_basis: "BASE_PLUS_TAX" });
    expect(Number(point.rows[0]?.commission_per_payment)).toBe(0);
    expect(closure.rows[0]).toMatchObject({ commission_payment_count: 0 });
    expect(Number(closure.rows[0]?.net_amount)).toBe(34.5);
  } finally {
    await pg.close();
  }
}, 15000);
