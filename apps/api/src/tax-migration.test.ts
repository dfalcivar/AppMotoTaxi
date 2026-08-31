import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

let pg: PGlite;

describe("configurable VAT migration", () => {
  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(`
      create table operational_settings(id int primary key,updated_at timestamptz default now(),updated_by uuid);
      insert into operational_settings(id) values(1);
      create table membership_payment_orders(id uuid primary key,driver_id uuid,total_amount numeric(12,2) not null);
      create table advertising_orders(id uuid primary key,advertiser_id uuid,amount numeric(12,2) not null);
      create table fiscal_clients(id uuid primary key,active boolean default true);
      create table fiscal_profiles(id uuid primary key,client_id uuid,active boolean default true,identification_type text,identification text,legal_name text,address text,billing_email text);
      create table fiscal_client_links(client_id uuid,link_type text,entity_id uuid);
      create table service_areas(id uuid primary key);
      create table collection_points(id uuid primary key,service_area_id uuid);
      create table affiliate_banners(id uuid primary key,order_id uuid,service_area_id uuid);
      create table membership_payments(id uuid primary key,order_id uuid,driver_id uuid,collection_point_id uuid,status text,method text,amount numeric,currency text,confirmed_at timestamptz,fiscal_client_id uuid,fiscal_profile_id uuid);
      create table advertising_payments(id uuid primary key,order_id uuid,advertiser_id uuid,status text,settlement_status text,amount numeric,currency text,reviewed_at timestamptz,fiscal_client_id uuid,fiscal_profile_id uuid);
      create table fiscal_billing_outbox(id uuid primary key default gen_random_uuid(),source text,payment_id uuid,document_type text default 'FACTURA',client_id uuid,fiscal_snapshot jsonb,amount numeric(14,2) not null,currency text,concept text,zone_id uuid,service_type text,paid_at timestamptz,payment_reversed boolean default false,processed_at timestamptz,created_at timestamptz default now(),unique(source,payment_id,document_type));
      insert into membership_payment_orders values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',12);
      insert into advertising_orders values('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004',35);
    `);
    const migration = await readFile(new URL("../migrations/077_configurable_vat_billing.sql", import.meta.url), "utf8");
    await pg.exec(migration);
    await pg.exec(`
      create trigger trg_membership_payment_fiscal
      before insert or update on membership_payments
      for each row execute function capture_fiscal_payment();
    `);
  });

  afterAll(async () => pg.close());

  it("keeps historical orders untaxed and configures the current default", async () => {
    expect((await pg.query("select vat_rate_percent from operational_settings")).rows).toEqual([{ vat_rate_percent: "15.000" }]);
    expect((await pg.query("select taxable_subtotal,vat_rate_percent,vat_amount,total_amount from membership_payment_orders")).rows[0]).toEqual({
      taxable_subtotal: "12.00", vat_rate_percent: "0.000", vat_amount: "0.00", total_amount: "12.00"
    });
  });

  it("carries the frozen breakdown into the fiscal outbox", async () => {
    await pg.exec(`
      insert into membership_payment_orders(id,driver_id,total_amount,taxable_subtotal,vat_rate_percent,vat_amount)
      values('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000006',13.80,12,15,1.80);
      insert into membership_payments(id,order_id,driver_id,status,method,amount,currency,confirmed_at)
      values('00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000006','CONFIRMED','CASH',13.80,'USD',now());
    `);
    expect((await pg.query("select subtotal,vat_rate_percent,tax_amount,amount from fiscal_billing_outbox")).rows[0]).toEqual({
      subtotal: "12.00", vat_rate_percent: "15.000", tax_amount: "1.80", amount: "13.80"
    });
  });
});
