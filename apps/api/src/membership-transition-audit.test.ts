import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

it('previews every scheduler transition as aggregate read-only counts', async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`
      create table operational_settings(id integer, membership_suspension_scheduler_enabled boolean,
        membership_enforcement_enabled boolean, membership_expiry_notice_days integer,
        membership_grace_days integer, membership_timezone text);
      insert into operational_settings values(1,true,true,3,15,'America/Guayaquil');
      create table membership_grace_policies(grace_days integer,status text,campaign_kind text,
        starts_at timestamptz,ends_at timestamptz,expiry_window_start date,expiry_window_end date,
        scope text,cooperative_id uuid,driver_id uuid,priority integer,created_at timestamptz);
      create table driver_memberships(driver_id uuid,cooperative_id uuid,cycle_closed_at timestamptz,
        status text,expires_at timestamptz,suspension_at timestamptz);
      create table trips(driver_id uuid,status text);
      create table membership_payment_orders(status text,expires_at timestamptz);
      create function active_courtesy_benefit(uuid) returns uuid language sql stable as $$select null::uuid$$;
      create function active_free_trip_benefit(uuid) returns uuid language sql stable as $$select null::uuid$$;
      insert into driver_memberships values
        ('00000000-0000-4000-8000-000000000001',null,null,'ACTIVE',now()+interval '1 day',null),
        ('00000000-0000-4000-8000-000000000002',null,null,'ACTIVE',now()-interval '2 days',null),
        ('00000000-0000-4000-8000-000000000003',null,null,'GRACE_PERIOD',now()-interval '8 days',now()-interval '2 days'),
        ('00000000-0000-4000-8000-000000000004',null,null,'PAYMENT_DUE',now()-interval '8 days',now()-interval '2 days'),
        ('00000000-0000-4000-8000-000000000005',null,null,'SUSPENSION_PENDING_ACTIVE_TRIP',now()-interval '8 days',now()-interval '2 days'),
        ('00000000-0000-4000-8000-000000000006',null,null,'GRACE_PERIOD',now(),now()+interval '1 day'),
        ('00000000-0000-4000-8000-000000000007',null,null,'EXPIRING',now()-interval '8 days',null);
      insert into membership_grace_policies values
        (0,'ACTIVE','RENEWAL',now()-interval '1 day',now()+interval '1 day',null,null,
         'DRIVER',null,'00000000-0000-4000-8000-000000000007',1,now());
      insert into trips values('00000000-0000-4000-8000-000000000004','IN_PROGRESS');
      insert into membership_payment_orders values('PENDING',now()-interval '8 days');
    `);
    const source = await readFile(new URL('../scripts/check-membership-transitions.sql', import.meta.url), 'utf8');
    const results = await pg.exec(source);
    const counts = results[2]!.rows as Array<{ transition_type: string; age_bucket: string; pending_count: number }>;
    expect(counts.map(row => row.transition_type).sort()).toEqual([
      'DUE_TO_PENDING_ACTIVE_TRIP', 'DUE_TO_SUSPENDED_NON_PAYMENT', 'EXPIRED_TO_GRACE',
      'EXPIRED_TO_PAYMENT_DUE',
      'EXPIRING_NOTICE', 'PAYMENT_ORDER_EXPIRED', 'PENDING_TRIP_ENDED_TO_SUSPENDED'
    ].sort());
    expect(counts.every(row => Number(row.pending_count) === 1)).toBe(true);
    expect(counts.find(row => row.transition_type === 'EXPIRING_NOTICE')?.age_bucket).toBe('1-7d');
    expect(Object.keys(counts[0]!)).toEqual(['transition_type', 'age_bucket', 'pending_count']);
    expect(results[3]!.rows).toEqual([{ current_status: 'GRACE_PERIOD', not_yet_due_count: 1 }]);
  } finally { await pg.close(); }
}, 20_000);
