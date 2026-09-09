import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';

const driver='00000000-0000-4000-8000-000000000001',trip='00000000-0000-4000-8000-000000000002';
let pg:PGlite;
beforeEach(async()=>{
  pg=new PGlite();
  await pg.exec(`create table users(id uuid primary key);insert into users values('${driver}');
    create table drivers(user_id uuid primary key references users(id));insert into drivers values('${driver}');
    create table operational_settings(id int primary key);insert into operational_settings values(1);
    create table service_areas(id uuid primary key);
    create table membership_plans(id uuid primary key);
    create table driver_memberships(id uuid primary key,driver_id uuid,status text,cycle_closed_at timestamptz,
      suspension_at timestamptz,plan_type_snapshot text,completed_trips int,included_trips_snapshot int,grace_allows_trips_applied boolean);
    create table membership_cycle_trip_usages(id uuid primary key);
    create table membership_payment_orders(id uuid primary key,plan_id uuid not null,membership_cycle_id uuid);
    create table membership_payments(id uuid primary key);
    create table trips(id uuid primary key,driver_id uuid,status text,started_at timestamptz,driver_search_round int default 0,pricing_snapshot jsonb default '{}');
    create table driver_offers(id uuid primary key default gen_random_uuid(),trip_id uuid,driver_id uuid,search_round int);
    insert into trips(id,status)values('${trip}','SEARCHING');`);
  await pg.exec(await readFile(new URL('../migrations/088_arrival_commercial_model.sql',import.meta.url),'utf8'));
},30000);
afterEach(async()=>{await pg.close();});
const move=(kind:string,amount:string,key:string)=>pg.query(`select apply_driver_wallet_movement($1,$2,$3::numeric,$4,null,null,$1,'Prueba auditada')`,[driver,kind,amount,key]);
const balance=async()=>(await pg.query(`select total::text,reserved::text,(total-reserved)::text as available from driver_wallets where driver_id=$1`,[driver])).rows[0];

describe('transactional wallet and immutable offers',()=>{
  it('starts a new economic search after NO_DRIVER but preserves cancellation continuity',async()=>{
    await pg.exec(await readFile(new URL('../migrations/090_expire_exhausted_arrival_search.sql',import.meta.url),'utf8'));
    const exhausted=await pg.query<any>(`insert into arrival_search_sessions(passenger_id,expires_at,route_points,configuration,max_round_reached)
      values($1,now()+interval '30 minutes','[]','{}',3) returning id`,[driver]);
    await pg.query(`update trips set arrival_search_session_id=$1,status='NO_DRIVER' where id=$2`,[exhausted.rows[0].id,trip]);
    expect((await pg.query('select status from arrival_search_sessions where id=$1',[exhausted.rows[0].id])).rows[0])
      .toEqual({status:'EXPIRED'});

    const cancelled=await pg.query<any>(`insert into arrival_search_sessions(passenger_id,expires_at,route_points,configuration,max_round_reached)
      values($1,now()+interval '30 minutes','[]','{}',2) returning id`,[driver]);
    await pg.query(`update trips set arrival_search_session_id=$1,status='SEARCHING' where id=$2`,[cancelled.rows[0].id,trip]);
    await pg.query(`update trips set status='CANCELLED' where id=$1`,[trip]);
    expect((await pg.query('select status,cancel_count from arrival_search_sessions where id=$1',[cancelled.rows[0].id])).rows[0])
      .toEqual({status:'OPEN',cancel_count:1});
  });
  it('repairs search sessions serialized as JSON strings and enforces their shape',async()=>{
    const legacyPoints=JSON.stringify([{latitude:0.8689,longitude:-79.8487},{latitude:0.87,longitude:-79.85}]);
    const legacyConfiguration=JSON.stringify({version:'legacy',totalRounds:3});
    await pg.query(`insert into arrival_search_sessions(passenger_id,expires_at,route_points,configuration)
      values($1,now()+interval '1 hour',to_jsonb($2::text),to_jsonb($3::text))`,[driver,legacyPoints,legacyConfiguration]);
    await pg.exec(await readFile(new URL('../migrations/089_fix_arrival_search_session_json.sql',import.meta.url),'utf8'));
    const repaired=(await pg.query<any>(`select jsonb_typeof(route_points) as points_type,
      jsonb_typeof(configuration) as configuration_type,jsonb_array_length(route_points) as point_count
      from arrival_search_sessions`)).rows[0];
    expect(repaired).toEqual({points_type:'array',configuration_type:'object',point_count:2});
    await expect(pg.query(`insert into arrival_search_sessions(passenger_id,expires_at,route_points,configuration)
      values($1,now()+interval '1 hour','"bad"'::jsonb,'{}'::jsonb)`,[driver])).rejects.toThrow();
  });
  it('rejects non-finite monetary inputs without changing the balance',async()=>{
    await move('TOPUP','5','payment:1');
    await expect(move('TOPUP','NaN','payment:2')).rejects.toThrow('INVALID_WALLET_MOVEMENT');
    expect(await balance()).toEqual({total:'5.00',reserved:'0.00',available:'5.00'});
  });
  it('keeps rejected drivers excluded for the entire search session',async()=>{
    await move('TOPUP','5','payment:1');await pg.exec('update driver_wallets set enabled=true');
    const session=await pg.query<any>(`insert into arrival_search_sessions(passenger_id,expires_at,route_points,configuration)
      values($1,now()+interval '1 hour','[]','{}') returning id`,[driver]);
    await pg.query(`update trips set arrival_search_session_id=$1,pricing_snapshot='{"economic":{"theoreticalCommission":"0.10","passengerTotal":"3.25"}}' where id=$2`,[session.rows[0].id,trip]);
    await pg.query('insert into arrival_search_exclusions(session_id,driver_id) values($1,$2)',[session.rows[0].id,driver]);
    expect((await pg.query('select commercial_driver_can_accept($1,$2,4) as ok',[driver,trip])).rows[0]).toEqual({ok:false});
    await pg.query('update trips set driver_search_round=4 where id=$1',[trip]);
    expect((await pg.query('select max_round_reached from arrival_search_sessions')).rows[0]).toEqual({max_round_reached:4});
  });
  it('reassignment preserves passenger economics but never another driver wallet data',async()=>{
    const economic={journeyFare:'3.00',arrivalFee:'0.50',passengerTotal:'3.50',matchedRound:2,theoreticalCommission:'0.20',
      billingMode:'PAY_PER_USE',balanceBefore:'100.00',reservedCommission:'0.20',packagePurchaseId:'private',economicProfit:'3.30'};
    await pg.query('update trips set pricing_snapshot=$1::jsonb where id=$2',[JSON.stringify({economic}),trip]);
    const offer=(await pg.query<any>('select trip_offer_economics($1,4) as e',[trip])).rows[0].e;
    expect(offer).toMatchObject({matchedRound:2,passengerTotal:'3.50'});
    expect(offer).not.toHaveProperty('balanceBefore');expect(offer).not.toHaveProperty('packagePurchaseId');
    const passenger=(await pg.query<any>('select visible_trip_economics($1::jsonb,false) as e',[JSON.stringify(economic)])).rows[0].e;
    expect(passenger).not.toHaveProperty('theoreticalCommission');expect(passenger).not.toHaveProperty('balanceBefore');
  });
  it('reserves, debits once and never credits VAT',async()=>{
    await move('TOPUP','5','payment:1');await move('TOPUP','5','payment:1');
    expect(await balance()).toEqual({total:'5.00',reserved:'0.00',available:'5.00'});
    await move('RESERVE','.10','reserve:1');
    expect(await balance()).toEqual({total:'5.00',reserved:'0.10',available:'4.90'});
    await move('TRIP_COMMISSION','.10','complete:1');await move('TRIP_COMMISSION','.10','complete:1');
    expect(await balance()).toEqual({total:'4.90',reserved:'0.00',available:'4.90'});
    expect((await pg.query('select count(*)::int as n from driver_wallet_movements')).rows[0]).toEqual({n:3});
  });
  it('rejects key reuse with different economic intent',async()=>{
    await move('TOPUP','5','payment:1');
    await expect(move('TOPUP','6','payment:1')).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    await expect(move('RESERVE','5','payment:1')).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });
  it('serializes competing reserves without a negative balance',async()=>{
    await move('TOPUP','.10','payment:1');
    const results=await Promise.allSettled([move('RESERVE','.10','reserve:1'),move('RESERVE','.10','reserve:2')]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
    expect(await balance()).toEqual({total:'0.10',reserved:'0.10',available:'0.00'});
  });
  it('releases once when the assigned driver changes, including automated reassignment',async()=>{
    await move('TOPUP','5','payment:1');await move('RESERVE','.4','reserve:1');
    await pg.query(`update trips set driver_id=$1,status='DRIVER_EN_ROUTE' where id=$2`,[driver,trip]);
    await pg.query(`insert into trip_commercial_assignments(trip_id,driver_id,reserved_amount,snapshot)values($1,$2,.4,'{"billingMode":"PAY_PER_USE"}')`,[trip,driver]);
    await pg.query(`update trips set driver_id=null,status='SEARCHING' where id=$1`,[trip]);
    expect(await balance()).toEqual({total:'5.00',reserved:'0.00',available:'5.00'});
    await pg.query(`update trips set status='CANCELLED' where id=$1`,[trip]);
    expect(await balance()).toEqual({total:'5.00',reserved:'0.00',available:'5.00'});
  });
  it('settles completion through the database, regardless of repeated status events',async()=>{
    await move('TOPUP','5','payment:1');await move('RESERVE','.4','reserve:1');
    await pg.query(`update trips set driver_id=$1,status='IN_PROGRESS' where id=$2`,[driver,trip]);
    await pg.query(`insert into trip_commercial_assignments(trip_id,driver_id,reserved_amount,snapshot)values($1,$2,.4,'{"billingMode":"PAY_PER_USE"}')`,[trip,driver]);
    await pg.query(`update trips set status='COMPLETED' where id=$1`,[trip]);
    await pg.query(`update trips set status='COMPLETED' where id=$1`,[trip]);
    expect(await balance()).toEqual({total:'4.60',reserved:'0.00',available:'4.60'});
  });
  it('cannot adjust below money reserved for active trips',async()=>{
    await move('TOPUP','5','payment:1');await move('RESERVE','4','reserve:1');
    await expect(move('ADMIN_ADJUSTMENT','-2','adjust:1')).rejects.toThrow('INSUFFICIENT');
    expect(await balance()).toEqual({total:'5.00',reserved:'4.00',available:'1.00'});
  });
  it('filters unaffordable rounds but still permits the affordable first round',async()=>{
    await move('TOPUP','.10','payment:1');await pg.query('update driver_wallets set enabled=true');
    await pg.query(`update trips set pricing_snapshot=$1::jsonb where id=$2`,[JSON.stringify({economicQuote:{feePerRound:'0.25',costaGoPercent:'40',journeyFare:'3.00',version:'v1',minimumRound:1,
      settings:{initialRadiusMeters:2000,radiusIncrementMeters:2000,maximumRadiusMeters:7000}}}),trip]);
    const one=await pg.query(`select commercial_driver_can_accept($1,$2,1) as ok`,[driver,trip]);
    const two=await pg.query(`select commercial_driver_can_accept($1,$2,2) as ok`,[driver,trip]);
    expect(one.rows[0]).toEqual({ok:true});expect(two.rows[0]).toEqual({ok:false});
    await pg.query(`insert into driver_offers(trip_id,driver_id,search_round)values($1,$2,1),($1,$2,2)`,[trip,driver]);
    const offers=await pg.query(`select economic_snapshot->>'passengerTotal' as total from driver_offers`);
    expect(offers.rows).toEqual([{total:'3.25'}]);
  });
});
