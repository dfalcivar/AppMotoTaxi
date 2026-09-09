import Fastify from 'fastify';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {beforeAll,beforeEach,afterAll,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({sql:null as any}));
vi.mock('./database.js',()=>({database:()=>state.sql}));
vi.mock('./admin.js',()=>({requirePermission:()=>({id:'00000000-0000-4000-8000-000000000001'})}));
import {registerCommercialEconomicsRoutes} from './commercial-economics-admin.js';
const user='00000000-0000-4000-8000-000000000001',plan='00000000-0000-4000-8000-000000000002';
let pg:PGlite;const app=Fastify();
function sqlFor(client:any):any {
  const sql=async(parts:TemplateStringsArray,...values:any[])=>(await client.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
  return Object.assign(sql,{begin:(fn:any)=>client.transaction((tx:any)=>fn(sqlFor(tx))),json:(value:unknown)=>JSON.stringify(value)});
}
beforeAll(async()=>{
  pg=new PGlite();state.sql=sqlFor(pg);
  await pg.exec(`create table users(id uuid primary key,full_name text);insert into users values('${user}','Prueba');
    create table drivers(user_id uuid primary key references users(id));insert into drivers values('${user}');
    create table operational_settings(id int primary key,membership_extra_trip_share_percent numeric default 40,
      driver_search_initial_radius_meters int default 2000,driver_search_radius_increment_meters int default 2000,
      search_radius_meters int default 7000,driver_search_round_wait_seconds int default 30,updated_at timestamptz,updated_by uuid);
    insert into operational_settings(id) values(1);
    create table pricing_versions(version int,platform_commission_cents_per_leg int,active_from timestamptz,active_until timestamptz);
    insert into pricing_versions values(1,25,now()-interval '1 day',null);
    create table service_areas(id uuid primary key);
    create table membership_plans(id uuid primary key default gen_random_uuid(),code text,version int,name text,plan_type text,period_unit text,
      period_count int,duration_days int,base_amount numeric(12,2),currency text,included_trips int,pack_validity_days int,
      max_renewal_amount numeric,extra_trip_share_percent numeric,enabled boolean,effective_from timestamptz default now(),effective_until timestamptz,
      created_by uuid,updated_by uuid,updated_at timestamptz,unique(code,version));
    create table driver_memberships(id uuid primary key,driver_id uuid,status text,cycle_closed_at timestamptz,suspension_at timestamptz,
      plan_type_snapshot text,completed_trips int,included_trips_snapshot int,grace_allows_trips_applied boolean);
    create table membership_cycle_trip_usages(id uuid primary key);
    create table membership_payment_orders(id uuid primary key,plan_id uuid not null,membership_cycle_id uuid,plan_snapshot jsonb,base_amount numeric,
      prior_usage_amount numeric,taxable_subtotal numeric,vat_amount numeric);
    create table membership_payments(id uuid primary key,order_id uuid,status text,confirmed_at timestamptz);
    create table trips(id uuid primary key,driver_id uuid,status text,started_at timestamptz,driver_search_round int,pricing_snapshot jsonb,
      scheduled_for timestamptz,completed_at timestamptz,service_area_id uuid);
    create table driver_offers(id uuid primary key,trip_id uuid,driver_id uuid,search_round int,accepted boolean);
    create table audit_log(actor_id uuid,action text,entity_type text,entity_id text,previous_value jsonb,next_value jsonb,reason text);`);
  await pg.exec(await readFile(new URL('../migrations/088_arrival_commercial_model.sql',import.meta.url),'utf8'));
  await registerCommercialEconomicsRoutes(app);await app.ready();
},30000);
beforeEach(async()=>{
  await pg.exec('truncate membership_plans cascade;truncate audit_log;');
  await pg.query(`insert into membership_plans(id,code,version,name,plan_type,base_amount,included_trips,currency,enabled)
    values($1,'PACK_TEST',1,'Paquete prueba','TRIP_PACK',8,50,'USD',true)`,[plan]);
  await pg.query(`update operational_settings set arrival_commercial_version=1,arrival_commercial_configuration=$1::jsonb`,[JSON.stringify({
    enabled:true,searchSessionMinutes:30,sameRouteToleranceMeters:100,lowBalanceThreshold:'1',minimumTopUp:'1',maximumTopUp:'100',
    historicalWindowDays:30,minimumSamples:10,fullConfidenceSamples:100,recalculateMinutes:60,referenceDistribution:[{round:1,count:1},{round:3,count:1}]})]);
  await pg.exec('delete from package_commercial_rules');
});
afterAll(async()=>{await app.close();await pg.close();});
const route=`/v1/admin/commercial-economics/packages/${plan}`;
async function rules(){
  const r=await app.inject({method:'PUT',url:`${route}/rules`,payload:{version:0,commercialFactor:'1',volumeDiscountPercent:'10',fixedCost:'0',minimumPrice:'1',serviceAreaId:null}});
  expect(r.statusCode).toBe(200);
}
it('calculates a suggestion without publishing and publishes only a confirmed new version',async()=>{
  await rules();
  const calc=await app.inject({method:'POST',url:`${route}/recalculate`});expect(calc.statusCode).toBe(200);
  expect(calc.json()).toMatchObject({technicalCost:'10.00',suggestedPrice:'9.00',scope:'REFERENCE',publishedPrice:'8.00'});
  await pg.query(`insert into membership_payment_orders(id,plan_id,base_amount,plan_snapshot)
    values('00000000-0000-4000-8000-000000000003',$1,8,'{"publishedPrice":"8.00"}')`,[plan]);
  expect((await pg.query<any>('select base_amount::text as price from membership_plans where id=$1',[plan])).rows[0].price).toBe('8.00');
  const missing=await app.inject({method:'POST',url:`${route}/apply-suggested-price`,payload:{calculationId:calc.json().calculationId}});
  expect(missing.statusCode).toBe(400);
  const result=await app.inject({method:'POST',url:`${route}/apply-suggested-price`,payload:{calculationId:calc.json().calculationId,confirm:true}});
  expect(result.statusCode).toBe(200);expect(result.json().version).toBe(2);
  expect((await pg.query<any>('select base_amount::text as base,plan_snapshot from membership_payment_orders')).rows[0])
    .toEqual({base:'8',plan_snapshot:{publishedPrice:'8.00'}});
  expect((await pg.query<any>('select version,base_amount::text as price,enabled from membership_plans order by version')).rows)
    .toEqual([{version:1,price:'8.00',enabled:false},{version:2,price:'9.00',enabled:true}]);
  const duplicate=await app.inject({method:'POST',url:`${route}/apply-suggested-price`,payload:{calculationId:calc.json().calculationId,confirm:true}});
  expect(duplicate.statusCode).toBe(409);
});
it('rejects a suggestion calculated with an old configuration',async()=>{
  await rules();const calc=await app.inject({method:'POST',url:`${route}/recalculate`});
  await pg.exec('update operational_settings set arrival_commercial_version=2');
  const result=await app.inject({method:'POST',url:`${route}/apply-suggested-price`,payload:{calculationId:calc.json().calculationId,confirm:true}});
  expect(result.statusCode).toBe(409);expect(result.json().error).toBe('CALCULATION_STALE');
});
it('validates configuration versions and does not activate invalid topup limits',async()=>{
  const configuration=(await pg.query<any>('select arrival_commercial_configuration as c from operational_settings')).rows[0].c;
  const result=await app.inject({method:'PUT',url:'/v1/admin/commercial-economics/configuration',payload:{version:1,configuration:{...configuration,maximumTopUp:'0'}}});
  expect(result.statusCode).toBe(409);
  expect((await pg.query<any>('select arrival_commercial_version as v from operational_settings')).rows[0].v).toBe(1);
});
it('uses the mandatory tariff commission as the single value per round',async()=>{
  const configuration=(await pg.query<any>('select arrival_commercial_configuration as c from operational_settings')).rows[0].c;
  const saved=await app.inject({method:'PUT',url:'/v1/admin/commercial-economics/configuration',payload:{
    version:1,costaGoPercent:'35',configuration
  }});
  expect(saved.statusCode).toBe(200);
  expect(saved.json()).toMatchObject({version:2,costaGoPercent:'35'});
  expect((await pg.query<any>(`select membership_extra_trip_share_percent::text as percentage
    from operational_settings where id=1`)).rows[0]).toEqual({percentage:'35'});
  const response=await app.inject({method:'GET',url:'/v1/admin/commercial-economics'});
  expect(response.statusCode).toBe(200);
  expect(response.json().settings).toMatchObject({feePerRound:'0.25',minimumArrival:'0.25',maximumArrival:'1.00',rounds:4,costaGoPercent:'35'});
});
it('queries the dashboard on the real schema and distinguishes fiscal receipts from trip commissions',async()=>{
  const result=await app.inject({method:'GET',url:'/v1/admin/commercial-economics/dashboard'});
  expect(result.statusCode).toBe(200);
  expect(result.json()).toMatchObject({modalities:[],rounds:[],packages:[],receipts:[],receiptsScope:'GLOBAL_DATE_WINDOW'});
});
