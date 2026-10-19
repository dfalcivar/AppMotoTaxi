import { PGlite } from '@electric-sql/pglite';
import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ sql: null as any }));
vi.mock('./database.js', () => ({ database: () => state.sql }));
vi.mock('./push.js', () => ({ sendPush: vi.fn(async () => ({ sent: 1 })) }));
import { membershipSchedulerTick } from './memberships.js';

function sqlFor(client: any): any {
  const sql = (parts: TemplateStringsArray | string[], ...values: any[]) => {
    if (!('raw' in parts)) {
      const items = parts as string[];
      return { parts: ['(', ...Array(items.length - 1).fill(','), ')'], values: items };
    }
    const fragment = { parts, values, then(resolve: any, reject: any) {
      const args: any[] = [];
      const compile = (item: any): string => item.parts.reduce((text: string, part: string, index: number) => {
        if (!index) return part;
        const value = item.values[index - 1];
        return text + (value?.parts ? compile(value) : (args.push(value), `$${args.length}`)) + part;
      }, '');
      return client.query(compile(fragment), args).then((result: any) => result.rows).then(resolve, reject);
    } };
    return fragment;
  };
  return Object.assign(sql, { begin: (run: any) => client.transaction((tx: any) => run(sqlFor(tx))) });
}

it('transitions an expired membership once and a second scheduler tick stays error-free', async () => {
  const pg = new PGlite();
  state.sql = sqlFor(pg);
  try {
    await pg.exec(`
      create table operational_settings(
        id integer primary key, membership_suspension_scheduler_enabled boolean,
        membership_enforcement_enabled boolean, membership_expiry_notice_days integer,
        membership_grace_days integer, membership_grace_allows_trips boolean,
        membership_timezone text, membership_suspension_local_time time
      );
      insert into operational_settings values(1,true,true,3,15,true,'America/Guayaquil','04:00');
      create table membership_payment_orders(status text,expires_at timestamptz,updated_at timestamptz);
      create table membership_grace_policies(
        id uuid,grace_days integer,allows_trips boolean,reason text,status text,campaign_kind text,
        starts_at timestamptz,ends_at timestamptz,expiry_window_start date,expiry_window_end date,
        scope text,cooperative_id uuid,driver_id uuid,priority integer,created_at timestamptz
      );
      create table driver_memberships(
        id uuid primary key,driver_id uuid,cooperative_id uuid,cycle_closed_at timestamptz,status text,
        expires_at timestamptz,updated_at timestamptz,expiration_local_date date,grace_ends_at timestamptz,
        last_grace_local_date date,suspension_at timestamptz,grace_policy_id uuid,grace_reason text,
        grace_days_applied integer,grace_allows_trips_applied boolean,
        suspension_pending_active_trip boolean,suspended_non_payment_at timestamptz
      );
      create table trips(id uuid,driver_id uuid,status text);
      create table drivers(user_id uuid,is_available boolean);
      create function active_courtesy_benefit(uuid) returns uuid language sql as $$ select null::uuid $$;
      create function active_free_trip_benefit(uuid) returns uuid language sql as $$ select null::uuid $$;
    `);
    const id = '00000000-0000-4000-8000-000000000011';
    const driver = '00000000-0000-4000-8000-000000000012';
    await pg.query(`insert into driver_memberships(id,driver_id,status,expires_at)
      values($1,$2,'ACTIVE',now()-interval '1 minute')`, [id, driver]);
    await membershipSchedulerTick();
    await membershipSchedulerTick();
    const result = await pg.query<{ status: string; grace_days_applied: number; suspension_at: string }>(
      'select status,grace_days_applied,suspension_at from driver_memberships where id=$1', [id]);
    expect(result.rows[0]?.status).toBe('GRACE_PERIOD');
    expect(result.rows[0]?.grace_days_applied).toBe(15);
    expect(new Date(result.rows[0]!.suspension_at).getTime()).toBeGreaterThan(Date.now());
  } finally { await pg.close(); }
}, 20_000);
