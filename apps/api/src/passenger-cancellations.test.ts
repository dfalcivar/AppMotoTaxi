import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const state=vi.hoisted(()=>({sql:null as any}));
vi.mock('./database.js',()=>({database:()=>state.sql}));
import { cancelPassengerTrip, cancellationConsequence, passengerCancellationPolicySchema, releaseExpiredPassengerSuspensions, expirePassengerCancellationCycles, passengerCancellationSummary, passengerCancellationHistory } from './passenger-cancellations.js';
import { recordAcceptedTripMembershipUsage, reversePassengerCancelledMembershipUsage, markMembershipTripCompleted, cycleAmounts } from './membership-trip-usage.js';

const passenger='00000000-0000-4000-8000-000000000001';
const driver='00000000-0000-4000-8000-000000000002';
let pg:PGlite;
const policy={enabled:true,steps:[{fromCount:1,suspensionDays:0},{fromCount:3,suspensionDays:2},{fromCount:4,suspensionDays:5},{fromCount:5,suspensionDays:7},{fromCount:6,suspensionDays:null}]};
function sqlFor(client:any):any {
  const sql=async(parts:TemplateStringsArray,...values:any[]) => (await client.query(parts.reduce((out,part,i)=>out+(i?`$${i}`:'')+part,''),values)).rows;
  return Object.assign(sql,{begin:(fn:any)=>client.transaction((tx:any)=>fn(sqlFor(tx)))});
}
beforeAll(async()=>{
  pg=new PGlite();state.sql=sqlFor(pg);
  // Isolated PostgreSQL WASM; never uses DATABASE_URL or production credentials.
  await pg.exec(`create type account_status as enum('PENDING','ACTIVE','SUSPENDED','REJECTED');
    create type trip_status as enum('SEARCHING','ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS','COMPLETED','CANCELLED','NO_DRIVER');
    create table users(id uuid primary key,status account_status default 'ACTIVE',deleted_at timestamptz,updated_at timestamptz,full_name text default 'Prueba');
    create table drivers(user_id uuid primary key references users(id),is_available boolean default false,approval_status text default 'APROBADO');
    create table trips(id uuid primary key default gen_random_uuid(), passenger_id uuid references users(id),driver_id uuid references users(id),status trip_status default 'SEARCHING',assigned_at timestamptz,started_at timestamptz,completed_at timestamptz,cancelled_at timestamptz,schedule_status text,driver_search_next_round_at timestamptz);
    create table driver_offers(id uuid primary key default gen_random_uuid(),trip_id uuid references trips(id),driver_id uuid references users(id),accepted boolean,responded_at timestamptz,response_reason text);
    create table scheduled_trip_responses(trip_id uuid references trips(id),driver_id uuid references users(id),accepted boolean);
    create table trip_events(id uuid primary key default gen_random_uuid(),trip_id uuid references trips(id),from_status trip_status,to_status trip_status,actor_id uuid references users(id),reason_code text,metadata jsonb);
    create table operational_settings(id int primary key,updated_at timestamptz,updated_by uuid references users(id),membership_usage_billing_enabled boolean default true);
    create table device_tokens(token text primary key);
    alter table trips add column origin_reference text default 'Origen';
    alter table trips add column destination_reference text default 'Destino';
    create table driver_memberships(id uuid primary key default gen_random_uuid(),driver_id uuid references drivers(user_id),
      status text default 'ACTIVE',cycle_closed_at timestamptz,updated_at timestamptz,
      completed_trips int default 80,included_trips_snapshot int default 120,extra_trips int default 0,
      extra_trip_fee_snapshot numeric(12,4) default 0.04,base_membership_amount_snapshot numeric(12,2) default 12,
      max_renewal_amount_snapshot numeric(12,2) default 17,raw_extra_amount numeric(12,2) default 0,
      billable_extra_amount numeric(12,2) default 0,adjustment_amount numeric(12,2) default 0,
      estimated_next_renewal_amount numeric(12,2) default 12,final_renewal_amount numeric(12,2));
    create table membership_payment_orders(id uuid primary key default gen_random_uuid(),membership_cycle_id uuid references driver_memberships(id),
      base_amount numeric(12,2) default 12,prior_usage_amount numeric(12,2) default 0,adjustment_amount numeric(12,2) default 0,
      total_amount numeric(12,2) default 12,metadata jsonb default '{}',status text default 'PENDING',updated_at timestamptz);
    create table membership_cycle_adjustments(id uuid primary key default gen_random_uuid(),membership_cycle_id uuid references driver_memberships(id),
      adjustment_type text,amount numeric(12,2),reason text,reference text,created_by uuid references users(id));
    create table audit_log(id uuid primary key default gen_random_uuid(),actor_id uuid references users(id),action text,entity_type text,entity_id uuid,next_value jsonb,reason text);
  `);
  const membershipMigration=await readFile(new URL('../migrations/041_memberships_navigation_collection.sql',import.meta.url),'utf8');
  await pg.exec(membershipMigration.slice(membershipMigration.indexOf('CREATE TABLE IF NOT EXISTS membership_cycle_trip_usages ('),membershipMigration.indexOf('CREATE TABLE IF NOT EXISTS membership_cycle_adjustments (')));
  await pg.exec(await readFile(new URL('../migrations/070_membership_usage_passenger_reversal.sql',import.meta.url),'utf8'));
  await pg.exec(await readFile(new URL('../migrations/069_passenger_cancellations_and_trip_integrity.sql',import.meta.url),'utf8'));
  await pg.exec(await readFile(new URL('../migrations/071_passenger_cancellation_cycles.sql',import.meta.url),'utf8'));
},30000);
beforeEach(async()=>{
  await pg.exec('truncate audit_log,passenger_cancellations,trip_events,driver_offers,scheduled_trip_responses,trips,drivers,operational_settings,users cascade');
  await pg.query('insert into users(id) values($1),($2)',[passenger,driver]);
  await pg.query('insert into drivers(user_id) values($1)',[driver]);
  await pg.exec('insert into operational_settings(id) values(1)');
});
afterAll(async()=>{await pg.close();vi.unstubAllEnvs();});
async function makeTrip(status='DRIVER_EN_ROUTE',scheduled=false) {
  const rows=await pg.query<{id:string}>('insert into trips(passenger_id) values($1) returning id',[passenger]);
  const id=rows.rows[0]!.id;
  if(status!=='SEARCHING') await pg.transaction(async tx=>{
    await tx.query('update trips set driver_id=$1,assigned_at=now(),status=$2 where id=$3',[driver,status,id]);
    await tx.query(`insert into ${scheduled?'scheduled_trip_responses':'driver_offers'}(trip_id,driver_id,accepted) values($1,$2,true)`,[id,driver]);
  });
  return id;
}

async function makeCycle(driverId=driver) {
  return (await pg.query<{id:string}>('insert into driver_memberships(driver_id) values($1) returning id',[driverId])).rows[0]!.id;
}
async function consume(tripId:string,driverId=driver) {
  await state.sql.begin((tx:any)=>recordAcceptedTripMembershipUsage(tx,tripId,driverId));
}
async function cycle(id:string) {
  return (await pg.query<any>('select * from driver_memberships where id=$1',[id])).rows[0]!;
}

describe('consumo de membresía y reversión por pasajero',()=>{
  it('80 → aceptación 81 → cancelación pasajero 80, con una sola auditoría de reversión',async()=>{
    const cycleId=await makeCycle();const tripId=await makeTrip();
    await consume(tripId);expect((await cycle(cycleId)).completed_trips).toBe(81);
    await Promise.all([cancelPassengerTrip(passenger,tripId),cancelPassengerTrip(passenger,tripId)]);
    await consume(tripId);await cancelPassengerTrip(passenger,tripId);
    expect((await cycle(cycleId)).completed_trips).toBe(80);
    const usages=(await pg.query<any>('select * from membership_cycle_trip_usages')).rows;
    expect(usages).toHaveLength(1);
    expect(usages[0]).toMatchObject({trip_id:tripId,driver_id:driver,reversal_reason:'PASSENGER_CANCELLED',reversed_by:passenger,completed_at:null});
    expect(usages[0].reversed_at).toBeTruthy();
    const audits=(await pg.query<any>("select * from audit_log where action='MEMBERSHIP_TRIP_REVERSED'")).rows;
    expect(audits).toHaveLength(1);expect(audits[0].next_value).toMatchObject({tripId,driverId:driver,before:81,used:80});
    expect((await pg.query<any>('select metadata from trip_events')).rows[0]!.metadata.membershipReversal.used).toBe(80);
  });
  it('serializa reintentos de aceptación sin consumir dos unidades',async()=>{
    const cycleId=await makeCycle();const tripId=await makeTrip();
    await Promise.all([consume(tripId),consume(tripId)]);
    expect((await cycle(cycleId)).completed_trips).toBe(81);
    expect((await pg.query('select * from membership_cycle_trip_usages')).rows).toHaveLength(1);
  });
  it('búsqueda cancelada sin aceptación no cambia el ciclo',async()=>{
    const cycleId=await makeCycle();const tripId=await makeTrip('SEARCHING');
    await consume(tripId);await cancelPassengerTrip(passenger,tripId);
    expect((await cycle(cycleId)).completed_trips).toBe(80);
    expect((await pg.query('select * from membership_cycle_trip_usages')).rows).toHaveLength(0);
  });
  it('conductor cancela y pasajero cancela durante nueva búsqueda: conserva el consumo del conductor',async()=>{
    const cycleId=await makeCycle();const tripId=await makeTrip();await consume(tripId);
    await pg.query("update trips set driver_id=null,assigned_at=null,status='SEARCHING' where id=$1",[tripId]);
    expect(await state.sql.begin((tx:any)=>reversePassengerCancelledMembershipUsage(tx,tripId,driver,passenger))).toBeNull();
    await cancelPassengerTrip(passenger,tripId);
    expect((await cycle(cycleId)).completed_trips).toBe(81);
    expect((await pg.query<any>('select reversed_at from membership_cycle_trip_usages')).rows[0]!.reversed_at).toBeNull();
  });
  it('reasignación A → B: cancelar pasajero revierte B, nunca A',async()=>{
    const second='00000000-0000-4000-8000-000000000003';
    await pg.query('insert into users(id) values($1)',[second]);await pg.query('insert into drivers(user_id) values($1)',[second]);
    const a=await makeCycle(),b=await makeCycle(second),tripId=await makeTrip();await consume(tripId);
    await pg.transaction(async tx=>{
      await tx.query('update trips set driver_id=$1,assigned_at=now() where id=$2',[second,tripId]);
      await tx.query('insert into driver_offers(trip_id,driver_id,accepted) values($1,$2,true)',[tripId,second]);
    });
    await consume(tripId,second);await cancelPassengerTrip(passenger,tripId);
    expect((await cycle(a)).completed_trips).toBe(81);expect((await cycle(b)).completed_trips).toBe(80);
    expect((await pg.query<any>('select driver_id from membership_cycle_trip_usages where reversed_at is not null')).rows).toEqual([{driver_id:second}]);
  });
  it('reserva aceptada cuenta una vez; activación no duplica y pasajero puede revertir',async()=>{
    const cycleId=await makeCycle(),tripId=await makeTrip('ASSIGNED',true);
    await pg.query("update trips set status='SEARCHING',schedule_status='SCHEDULED_ASSIGNED' where id=$1",[tripId]);
    await consume(tripId);expect((await cycle(cycleId)).completed_trips).toBe(81);
    await pg.query("update trips set status='DRIVER_EN_ROUTE' where id=$1",[tripId]);await consume(tripId);
    await cancelPassengerTrip(passenger,tripId);expect((await cycle(cycleId)).completed_trips).toBe(80);
  });
  it('recalcula excedentes y orden pendiente usando snapshot, no configuración nueva',async()=>{
    const cycleId=await makeCycle(),tripId=await makeTrip();
    await pg.query('update driver_memberships set completed_trips=120 where id=$1',[cycleId]);
    await pg.query("insert into membership_payment_orders(membership_cycle_id,status,metadata) values($1,'PENDING_VERIFICATION','{\"proof\":\"keep\"}')",[cycleId]);
    await consume(tripId);
    expect(await cycle(cycleId)).toMatchObject({completed_trips:121,extra_trips:1,raw_extra_amount:'0.04',billable_extra_amount:'0.04',estimated_next_renewal_amount:'12.04'});
    await cancelPassengerTrip(passenger,tripId);
    expect(await cycle(cycleId)).toMatchObject({completed_trips:120,extra_trips:0,raw_extra_amount:'0.00',billable_extra_amount:'0.00',estimated_next_renewal_amount:'12.00'});
    const order=(await pg.query<any>('select * from membership_payment_orders')).rows[0]!;
    expect(order).toMatchObject({status:'PENDING_VERIFICATION',total_amount:'12.00',metadata:{proof:'keep',economicBreakdown:{completedTrips:120,extraTrips:0,totalAmount:12}}});
  });
  it('revertir una aceptación incluida libera cupo ocupado después por otra reserva',async()=>{
    const cycleId=await makeCycle();await pg.query('update driver_memberships set completed_trips=119 where id=$1',[cycleId]);
    const first=await makeTrip('ASSIGNED',true),second=await makeTrip('ASSIGNED',true);
    await consume(first);await consume(second);await cancelPassengerTrip(passenger,first);
    expect(await cycle(cycleId)).toMatchObject({completed_trips:120,extra_trips:0,billable_extra_amount:'0.00'});
    await consume(second);expect((await cycle(cycleId)).completed_trips).toBe(120);
  });
  it('ciclo cerrado conserva pago liquidado y aplica crédito, sin restar viajes al nuevo ciclo',async()=>{
    const old=await makeCycle(),tripId=await makeTrip('ASSIGNED',true);
    await pg.query('update driver_memberships set completed_trips=120 where id=$1',[old]);await consume(tripId);
    await pg.query("update driver_memberships set cycle_closed_at=now(),status='CLOSED',final_renewal_amount=12.04 where id=$1",[old]);
    await pg.query("insert into membership_payment_orders(membership_cycle_id,status,total_amount,prior_usage_amount) values($1,'PAID',12.04,0.04)",[old]);
    const current=await makeCycle();await cancelPassengerTrip(passenger,tripId);await cancelPassengerTrip(passenger,tripId);
    expect(await cycle(old)).toMatchObject({completed_trips:120,final_renewal_amount:'12.04'});
    expect(await cycle(current)).toMatchObject({completed_trips:80,adjustment_amount:'-0.04',estimated_next_renewal_amount:'11.96'});
    expect((await pg.query<any>('select total_amount from membership_payment_orders')).rows[0]!.total_amount).toBe('12.04');
    expect((await pg.query('select * from membership_cycle_adjustments')).rows).toHaveLength(1);
  });
  it('cancelación revierte aunque desactiven contabilización después de aceptar',async()=>{
    const cycleId=await makeCycle(),tripId=await makeTrip();await consume(tripId);
    await pg.exec('update operational_settings set membership_usage_billing_enabled=false');await cancelPassengerTrip(passenger,tripId);
    expect((await cycle(cycleId)).completed_trips).toBe(80);
    const other=await makeTrip();await consume(other);await cancelPassengerTrip(passenger,other);
    expect((await cycle(cycleId)).completed_trips).toBe(80);
  });
  it('no revierte viaje iniciado/finalizado ni consumos históricos',async()=>{
    const cycleId=await makeCycle(),tripId=await makeTrip();await consume(tripId);
    await pg.query("update trips set status='IN_PROGRESS',started_at=now() where id=$1",[tripId]);
    expect(await cancelPassengerTrip(passenger,tripId)).toBeNull();
    await pg.query("update trips set status='COMPLETED',completed_at=now() where id=$1",[tripId]);
    await state.sql.begin((tx:any)=>markMembershipTripCompleted(tx,tripId,driver));
    await state.sql.begin((tx:any)=>markMembershipTripCompleted(tx,tripId,driver));
    expect((await pg.query<any>('select completed_at from membership_cycle_trip_usages')).rows[0]!.completed_at).toBeTruthy();
    expect(await cancelPassengerTrip(passenger,tripId)).toBeNull();
    await consume(tripId);expect((await cycle(cycleId)).completed_trips).toBe(81);
  });
  it('conserva consumos históricos completados sin cobrarlos al reabrir o sincronizar',async()=>{
    const cycleId=await makeCycle(),tripId=await makeTrip('COMPLETED');
    await pg.query('update trips set completed_at=now() where id=$1',[tripId]);
    await pg.query(`insert into membership_cycle_trip_usages(membership_cycle_id,trip_id,driver_id,completed_at,sequence_number,usage_kind,idempotency_key)
      values($1,$2,$3,now(),80,'INCLUDED',$4)`,[cycleId,tripId,driver,`trip-completed:${tripId}`]);
    await consume(tripId);await state.sql.begin((tx:any)=>markMembershipTripCompleted(tx,tripId,driver));
    expect((await cycle(cycleId)).completed_trips).toBe(80);
    expect((await pg.query('select * from membership_cycle_trip_usages')).rows).toHaveLength(1);
  });
  it('un fallo de auditoría revierte también cancelación, contador y ledger',async()=>{
    const cycleId=await makeCycle(),tripId=await makeTrip();await consume(tripId);
    await pg.exec("alter table audit_log add constraint fail_reversal check(action<>'MEMBERSHIP_TRIP_REVERSED')");
    try {
      await expect(cancelPassengerTrip(passenger,tripId)).rejects.toThrow();
      expect((await cycle(cycleId)).completed_trips).toBe(81);
      expect((await pg.query<any>('select reversed_at from membership_cycle_trip_usages')).rows[0]!.reversed_at).toBeNull();
      expect((await pg.query<any>('select status from trips where id=$1',[tripId])).rows[0]!.status).toBe('DRIVER_EN_ROUTE');
    } finally {await pg.exec('alter table audit_log drop constraint fail_reversal');}
  });
  it('respeta el tope de excedente y no genera importes negativos',()=>{
    const snapshot={included_trips_snapshot:120,extra_trip_fee_snapshot:0.04,base_membership_amount_snapshot:12,max_renewal_amount_snapshot:17,adjustment_amount:0};
    expect(cycleAmounts(snapshot,250)).toMatchObject({extra:130,raw:5.2,billable:5,estimate:17});
    expect(cycleAmounts(snapshot,249)).toMatchObject({extra:129,raw:5.16,billable:5,estimate:17});
    expect(cycleAmounts(snapshot,0)).toMatchObject({extra:0,raw:0,billable:0,estimate:12});
    expect(cycleAmounts({...snapshot,extra_trip_fee_snapshot:0.045},123).raw).toBe(0.14);
  });
});
describe('política y persistencia de cancelaciones en PostgreSQL',()=>{
  it('mantiene los umbrales configurados, incluida suspensión indefinida',()=>{
    expect([1,2,3,4,5,6,10].map(n=>cancellationConsequence(policy,n))).toEqual([0,0,2,5,7,null,null]);
    expect(cancellationConsequence({...policy,enabled:false},8)).toBe(0);
    expect(passengerCancellationPolicySchema.safeParse({enabled:true,steps:[{fromCount:3,suspensionDays:1}]}).success).toBe(false);
    expect(passengerCancellationPolicySchema.safeParse({enabled:true,steps:[{fromCount:1,suspensionDays:null},{fromCount:2,suspensionDays:1}]}).success).toBe(false);
  });
  it('cancela búsqueda sin penalización ni historial de aceptación',async()=>{
    const id=await makeTrip('SEARCHING'); const result=await cancelPassengerTrip(passenger,id);
    expect(result?.consequence).toBeNull();
    expect((await pg.query('select * from passenger_cancellations')).rows).toHaveLength(0);
    expect((await pg.query('select status from trips where id=$1',[id])).rows[0]).toEqual({status:'CANCELLED'});
  });
  it('cancela en camino, libera conductor y conserva estado/actor en auditoría',async()=>{
    const id=await makeTrip();const result=await cancelPassengerTrip(passenger,id);
    expect(result?.consequence).toMatchObject({count:1,suspensionDays:0});
    expect((await pg.query('select is_available from drivers')).rows[0]).toEqual({is_available:true});
    expect((await pg.query('select trip_status,consecutive_number,status from passenger_cancellations')).rows[0]).toEqual({trip_status:'DRIVER_EN_ROUTE',consecutive_number:1,status:'RECORDED'});
    expect((await pg.query('select reason_code from trip_events')).rows[0]).toEqual({reason_code:'PASSENGER_CANCELLED'});
  });
  it('dos reintentos de la misma cancelación cuentan solo una vez',async()=>{
    const id=await makeTrip();const results=await Promise.all([cancelPassengerTrip(passenger,id),cancelPassengerTrip(passenger,id)]);
    expect(results.filter(r=>r?.replay)).toHaveLength(1);
    expect((await pg.query('select passenger_cancellation_count as count from users where id=$1',[passenger])).rows[0]).toEqual({count:1});
    expect((await pg.query('select * from passenger_cancellations')).rows).toHaveLength(1);
  });
  it('no cancela después de iniciar ni permite a otro pasajero cancelar',async()=>{
    const id=await makeTrip('IN_PROGRESS');
    expect(await cancelPassengerTrip(passenger,id)).toBeNull();
    expect(await cancelPassengerTrip(driver,id)).toBeNull();
    const arrived=await makeTrip('DRIVER_ARRIVED');
    await pg.query('update trips set started_at=now() where id=$1',[arrived]);
    expect(await cancelPassengerTrip(passenger,arrived)).toBeNull();
  });
  it('contabiliza también la aceptación real de reserva y no libera otro viaje activo',async()=>{
    const first=await makeTrip('ASSIGNED',true);await makeTrip();
    expect((await cancelPassengerTrip(passenger,first))?.consequence?.count).toBe(1);
    expect((await pg.query('select is_available from drivers')).rows[0]).toEqual({is_available:false});
  });
  it('tercera cancelación suspende dos días; vencer no reinicia el contador',async()=>{
    let lastTrip='';
    for(let i=0;i<3;i++){lastTrip=await makeTrip();await cancelPassengerTrip(passenger,lastTrip);}
    expect(await cancelPassengerTrip(passenger,lastTrip)).toMatchObject({replay:true,consequence:{count:3,suspensionDays:2}});
    expect(await cancelPassengerTrip(passenger,await makeTrip('SEARCHING'))).toBeNull();
    const account=(await pg.query<any>('select * from users where id=$1',[passenger])).rows[0]!;
    expect(account.status).toBe('SUSPENDED');expect(account.passenger_cancellation_count).toBe(3);
    expect(new Date(account.passenger_suspended_until).getTime()-Date.now()).toBeGreaterThan(47*3600000);
    vi.stubEnv('DATABASE_URL','isolated-pglite-not-a-network-address');
    await releaseExpiredPassengerSuspensions(passenger);
    expect((await pg.query('select status from users where id=$1',[passenger])).rows[0]).toEqual({status:'SUSPENDED'});
    await pg.query("update users set passenger_suspended_until=now()-interval '1 second' where id=$1",[passenger]);
    await pg.exec("update passenger_cancellations set suspension_until=now()-interval '1 second' where status='SUSPENDED'");
    await releaseExpiredPassengerSuspensions(passenger);
    expect((await pg.query('select status,passenger_cancellation_count as count from users where id=$1',[passenger])).rows[0]).toEqual({status:'ACTIVE',count:3});
  });
  it('no vence suspensión indefinida ni una suspensión manual',async()=>{
    vi.stubEnv('DATABASE_URL','isolated-pglite-not-a-network-address');
    await cancelPassengerTrip(passenger,await makeTrip());
    await pg.query('update users set passenger_cancellation_count=5 where id=$1',[passenger]);
    expect((await cancelPassengerTrip(passenger,await makeTrip()))?.consequence?.suspensionDays).toBeNull();
    await releaseExpiredPassengerSuspensions();
    expect((await pg.query('select status from users where id=$1',[passenger])).rows[0]).toEqual({status:'SUSPENDED'});
    await pg.query("update users set passenger_cancellation_suspended=false,passenger_suspended_until=now()-interval '1 day' where id=$1",[passenger]);
    await releaseExpiredPassengerSuspensions();
    expect((await pg.query('select status from users where id=$1',[passenger])).rows[0]).toEqual({status:'SUSPENDED'});
  });
  it('rechaza asignación fantasma sin conductor o sin prueba de aceptación',async()=>{
    const id=await makeTrip('SEARCHING');
    await expect(pg.query("update trips set status='DRIVER_EN_ROUTE' where id=$1",[id])).rejects.toThrow('TRIP_ASSIGNMENT_REQUIRED');
    await expect(pg.query("update trips set status='DRIVER_EN_ROUTE',driver_id=$1,assigned_at=now() where id=$2",[driver,id])).rejects.toThrow('TRIP_ACCEPTANCE_REQUIRED');
    expect((await pg.query('select status from trips where id=$1',[id])).rows[0]).toEqual({status:'SEARCHING'});
  });
});

async function expireTestCycle() {
  // Simulate elapsed time in the isolated fixture, never against production.
  await pg.exec("update passenger_cancellation_cycles set starts_at=starts_at-interval '100 days',ends_at=ends_at-interval '100 days'");
}
describe('ciclos de cancelaciones independientes del calendario',()=>{
  it('solo la primera cancelación penalizable inicia un ciclo de 30 días',async()=>{
    await cancelPassengerTrip(passenger,await makeTrip('SEARCHING'));
    expect((await pg.query('select * from passenger_cancellation_cycles')).rows).toHaveLength(0);
    await cancelPassengerTrip(passenger,await makeTrip());
    const record=(await passengerCancellationHistory(passenger,1))[0]!;
    expect(record.consecutive_number).toBe(1);expect(record.originated_by).toBe(passenger);
    expect(record.reason_code).toBe('PASSENGER_CANCELLED');expect(record.cycleDurationDays).toBe(30);
    expect(new Date(record.cycleStartsAt).getTime()).toBe(new Date(record.occurred_at).getTime());
    expect(new Date(record.cycleEndsAt).getTime()-new Date(record.cycleStartsAt).getTime()).toBe(30*86400000);
    expect(await passengerCancellationSummary(passenger)).toMatchObject({cycleCount:1,historicalTotal:1,cycleActive:true,state:'WARNING',threshold:3,nextThreshold:3});
  });
  it('no reinicia el inicio al cancelar de nuevo dentro del período',async()=>{
    await cancelPassengerTrip(passenger,await makeTrip());const first=await passengerCancellationSummary(passenger);
    await cancelPassengerTrip(passenger,await makeTrip());const second=await passengerCancellationSummary(passenger);
    expect(second).toMatchObject({cycleCount:2,historicalTotal:2,cycleId:first!.cycleId,cycleStartsAt:first!.cycleStartsAt,cycleEndsAt:first!.cycleEndsAt});
  });
  it('vence sin borrar historial ni esperar otra cancelación; después comienza en #1',async()=>{
    await cancelPassengerTrip(passenger,await makeTrip());await cancelPassengerTrip(passenger,await makeTrip());
    await expireTestCycle();
    const before=(await pg.query('select * from passenger_cancellations order by id')).rows;
    // Reads project zero immediately, even before the maintenance timer has run.
    expect(await passengerCancellationSummary(passenger)).toMatchObject({cycleCount:0,historicalTotal:2,cycleActive:false,state:'NORMAL'});
    vi.stubEnv('DATABASE_URL','isolated-pglite-not-a-network-address');await expirePassengerCancellationCycles();await expirePassengerCancellationCycles();
    expect((await pg.query<any>('select passenger_cancellation_count from users where id=$1',[passenger])).rows[0]!.passenger_cancellation_count).toBe(0);
    expect((await pg.query('select * from passenger_cancellations order by id')).rows).toEqual(before);
    const trip=await makeTrip();expect((await cancelPassengerTrip(passenger,trip))?.consequence?.count).toBe(1);
    expect(await passengerCancellationSummary(passenger)).toMatchObject({cycleCount:1,historicalTotal:3,cycleActive:true,state:'WARNING'});
    expect((await pg.query('select * from passenger_cancellation_cycles')).rows).toHaveLength(2);
  });
  it('reintentar una cancelación antigua no abre ciclo ni incrementa totales',async()=>{
    const trip=await makeTrip();await cancelPassengerTrip(passenger,trip);await expireTestCycle();
    expect(await cancelPassengerTrip(passenger,trip)).toMatchObject({replay:true,consequence:{count:1}});
    expect(await passengerCancellationSummary(passenger)).toMatchObject({cycleCount:0,historicalTotal:1,cycleActive:false});
    expect((await pg.query('select * from passenger_cancellation_cycles')).rows).toHaveLength(1);
    const currentTrip=await makeTrip();await cancelPassengerTrip(passenger,currentTrip);await cancelPassengerTrip(passenger,trip);
    expect(await passengerCancellationSummary(passenger)).toMatchObject({cycleCount:1,historicalTotal:2});
  });
  it('nuevas cancelaciones concurrentes tras vencer crean un solo ciclo y no sancionan por el anterior',async()=>{
    await cancelPassengerTrip(passenger,await makeTrip());await expireTestCycle();
    const first=await makeTrip(),second=await makeTrip();
    const results=await Promise.all([cancelPassengerTrip(passenger,first),cancelPassengerTrip(passenger,second)]);
    expect(results.map(r=>r?.consequence?.count).sort()).toEqual([1,2]);
    expect(await passengerCancellationSummary(passenger)).toMatchObject({cycleCount:2,historicalTotal:3,state:'WARNING'});
    expect((await pg.query('select * from passenger_cancellation_cycles')).rows).toHaveLength(2);
  });
  it('duración nueva de 60/90 días no modifica el ciclo abierto',async()=>{
    await cancelPassengerTrip(passenger,await makeTrip());const first=await passengerCancellationSummary(passenger);
    await pg.exec(`update operational_settings set passenger_cancellation_policy=passenger_cancellation_policy || '{"cycleDurationDays":60}'`);
    await cancelPassengerTrip(passenger,await makeTrip());
    expect(await passengerCancellationSummary(passenger)).toMatchObject({cycleDurationDays:30,cycleEndsAt:first!.cycleEndsAt,configuredDurationDays:60});
    await expireTestCycle();await cancelPassengerTrip(passenger,await makeTrip());
    expect(await passengerCancellationSummary(passenger)).toMatchObject({cycleCount:1,cycleDurationDays:60});
    await pg.exec(`update operational_settings set passenger_cancellation_policy=passenger_cancellation_policy || '{"cycleDurationDays":90}'`);
    await expireTestCycle();await cancelPassengerTrip(passenger,await makeTrip());
    expect(await passengerCancellationSummary(passenger)).toMatchObject({cycleCount:1,cycleDurationDays:90,historicalTotal:4});
  });
  it('vencer el ciclo no levanta suspensión temporal vigente',async()=>{
    for(let i=0;i<3;i++)await cancelPassengerTrip(passenger,await makeTrip());
    const before=await passengerCancellationSummary(passenger);await expireTestCycle();
    vi.stubEnv('DATABASE_URL','isolated-pglite-not-a-network-address');await expirePassengerCancellationCycles();
    await releaseExpiredPassengerSuspensions();
    expect(await passengerCancellationSummary(passenger)).toMatchObject({cycleCount:0,historicalTotal:3,state:'SUSPENDED',suspendedUntil:before!.suspendedUntil});
    expect(await cancelPassengerTrip(passenger,await makeTrip())).toBeNull();
    await pg.query("update users set passenger_suspended_until=now()-interval '1 minute' where id=$1",[passenger]);
    await releaseExpiredPassengerSuspensions();
    expect((await cancelPassengerTrip(passenger,await makeTrip()))?.consequence?.count).toBe(1);
  });
  it('suspensión indefinida persiste tras vencer; solo la reactivación manual permite nuevo ciclo',async()=>{
    await pg.exec(`update operational_settings set passenger_cancellation_policy='{"enabled":true,"cycleDurationDays":30,"steps":[{"fromCount":1,"suspensionDays":null}]}'`);
    await cancelPassengerTrip(passenger,await makeTrip());await expireTestCycle();
    vi.stubEnv('DATABASE_URL','isolated-pglite-not-a-network-address');await expirePassengerCancellationCycles();await releaseExpiredPassengerSuspensions();
    expect(await passengerCancellationSummary(passenger)).toMatchObject({cycleCount:0,historicalTotal:1,state:'INDEFINITE'});
    expect(await cancelPassengerTrip(passenger,await makeTrip())).toBeNull();
    await pg.query("update users set status='ACTIVE',passenger_cancellation_suspended=false where id=$1",[passenger]);
    expect((await cancelPassengerTrip(passenger,await makeTrip()))?.consequence?.count).toBe(1);
    expect((await passengerCancellationSummary(passenger))!.historicalTotal).toBe(2);
  });
  it('historial pagina por fecha en todos los ciclos aunque la numeración se reinicie',async()=>{
    await pg.exec(`update operational_settings set passenger_cancellation_policy=passenger_cancellation_policy || '{"enabled":false}'`);
    for(let i=0;i<21;i++){if(i===10)await expireTestCycle();await cancelPassengerTrip(passenger,await makeTrip());}
    const first=await passengerCancellationHistory(passenger,1),second=await passengerCancellationHistory(passenger,2);
    expect(first).toHaveLength(20);expect(second).toHaveLength(1);expect(first[0]!.totalCount).toBe(21);
    expect(first[0]!.consecutive_number).toBe(11);expect(second[0]!.consecutive_number).toBe(1);
    expect(first[0]!.cycle_id).not.toBe(second[0]!.cycle_id);
    expect(await passengerCancellationSummary(passenger)).toMatchObject({historicalTotal:21,cycleCount:11,state:'NORMAL',threshold:null});
  });
  it('valida duración parametrizable sin permitir cero, fracciones o valores negativos',()=>{
    for(const days of [0,-1,1.5,3651])expect(passengerCancellationPolicySchema.safeParse({...policy,cycleDurationDays:days}).success).toBe(false);
    for(const days of [1,30,60,90,3650])expect(passengerCancellationPolicySchema.parse({...policy,cycleDurationDays:days}).cycleDurationDays).toBe(days);
  });
});
