import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const state=vi.hoisted(()=>({sql:null as any}));
vi.mock('./database.js',()=>({database:()=>state.sql}));
import { cancelPassengerTrip, cancellationConsequence, passengerCancellationPolicySchema, releaseExpiredPassengerSuspensions } from './passenger-cancellations.js';

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
    create table users(id uuid primary key,status account_status default 'ACTIVE',deleted_at timestamptz,updated_at timestamptz);
    create table drivers(user_id uuid primary key references users(id),is_available boolean default false,approval_status text default 'APROBADO');
    create table trips(id uuid primary key default gen_random_uuid(), passenger_id uuid references users(id),driver_id uuid references users(id),status trip_status default 'SEARCHING',assigned_at timestamptz,started_at timestamptz,cancelled_at timestamptz,schedule_status text,driver_search_next_round_at timestamptz);
    create table driver_offers(id uuid primary key default gen_random_uuid(),trip_id uuid references trips(id),driver_id uuid references users(id),accepted boolean,responded_at timestamptz,response_reason text);
    create table scheduled_trip_responses(trip_id uuid references trips(id),driver_id uuid references users(id),accepted boolean);
    create table trip_events(id uuid primary key default gen_random_uuid(),trip_id uuid references trips(id),from_status trip_status,to_status trip_status,actor_id uuid references users(id),reason_code text,metadata jsonb);
    create table operational_settings(id int primary key,updated_at timestamptz,updated_by uuid references users(id));
    create table device_tokens(token text primary key);
  `);
  await pg.exec(await readFile(new URL('../migrations/069_passenger_cancellations_and_trip_integrity.sql',import.meta.url),'utf8'));
},30000);
beforeEach(async()=>{
  await pg.exec('truncate passenger_cancellations,trip_events,driver_offers,scheduled_trip_responses,trips,drivers,operational_settings,users cascade');
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
