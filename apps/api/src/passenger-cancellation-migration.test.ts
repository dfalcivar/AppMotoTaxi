import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

it('migra el historial acumulativo sin borrar números, fechas ni suspensiones', async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`create table users(id uuid primary key,status text,passenger_label text);
      create table trips(id uuid primary key);
      create table operational_settings(id int primary key);
      create table device_tokens(token text);
    `);
    const previous = await readFile(new URL('../migrations/069_passenger_cancellations_and_trip_integrity.sql', import.meta.url), 'utf8');
    await pg.exec(previous.slice(0, previous.indexOf('-- Existing historical rows')));
    await pg.exec(`insert into users(id,status,passenger_label,passenger_cancellation_count,passenger_cancellation_suspended,passenger_suspended_until) values
      ('00000000-0000-4000-8000-000000000001','SUSPENDED','indefinida',6,true,null),
      ('00000000-0000-4000-8000-000000000002','SUSPENDED','temporal',3,true,now()+interval '2 days'),
      ('00000000-0000-4000-8000-000000000003','ACTIVE','conductor',0,false,null);
      insert into operational_settings(id) values(1);
      insert into trips(id) values('00000000-0000-4000-8000-000000000004'),('00000000-0000-4000-8000-000000000005');
      insert into passenger_cancellations(passenger_id,driver_id,trip_id,occurred_at,consecutive_number,trip_status,
        suspension_days,suspension_started_at,suspension_until,status,policy_snapshot)
      select u.id,'00000000-0000-4000-8000-000000000003',
        case when passenger_label='indefinida' then '00000000-0000-4000-8000-000000000004'::uuid else '00000000-0000-4000-8000-000000000005'::uuid end,
        now()-interval '40 days',u.passenger_cancellation_count,'DRIVER_EN_ROUTE',
        case when passenger_label='indefinida' then null else 2 end,now()-interval '40 days',u.passenger_suspended_until,'SUSPENDED','{"enabled":true}'
      from users u where passenger_cancellation_suspended;
    `);
    const historicalColumns = 'id,passenger_id,trip_id,driver_id,occurred_at,consecutive_number,trip_status,suspension_days,suspension_started_at,suspension_until,status,policy_snapshot';
    const before = (await pg.query(`select ${historicalColumns} from passenger_cancellations order by passenger_id`)).rows;
    const suspensions = (await pg.query('select id,status,passenger_cancellation_suspended,passenger_suspended_until from users order by id')).rows;
    await pg.exec(await readFile(new URL('../migrations/071_passenger_cancellation_cycles.sql', import.meta.url), 'utf8'));
    expect((await pg.query(`select ${historicalColumns} from passenger_cancellations order by passenger_id`)).rows).toEqual(before);
    expect((await pg.query('select id,status,passenger_cancellation_suspended,passenger_suspended_until from users order by id')).rows).toEqual(suspensions);
    expect((await pg.query('select passenger_cancellation_count,passenger_cancellation_total::int from users where passenger_cancellation_suspended')).rows)
      .toEqual([{passenger_cancellation_count:0,passenger_cancellation_total:1},{passenger_cancellation_count:0,passenger_cancellation_total:1}]);
    expect((await pg.query('select distinct source,duration_days from passenger_cancellation_cycles')).rows).toEqual([{source:'LEGACY',duration_days:30}]);
    expect((await pg.query("select count(*)::int as total from passenger_cancellations where cycle_id is not null and originated_by=passenger_id and reason_code='PASSENGER_CANCELLED'")).rows).toEqual([{total:2}]);
    expect((await pg.query("select passenger_cancellation_policy->>'cycleDurationDays' as days from operational_settings")).rows).toEqual([{days:'30'}]);
  } finally { await pg.close(); }
}, 30000);
