import Fastify from 'fastify';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {beforeAll,beforeEach,afterAll,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({sql:null as any}));
vi.mock('./database.js',()=>({database:()=>state.sql}));
vi.mock('./admin.js',()=>({requirePermission:(r:any)=>{if(r.headers['x-admin']!=='yes')throw new Error('FORBIDDEN');return {id:null,email:'admin@test',role:'SUPER_ADMIN'};}}));
vi.mock('./service-areas.js',()=>({resolveServiceArea:async()=>null}));
import {registerReferralRoutes,processReferral,referralCodeFor} from './referrals.js';
import {registerBenefitRoutes} from './benefits.js';
let pg:PGlite;const app=Fastify();
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002',d='00000000-0000-4000-8000-000000000003';
let program:any,code:string;
function sqlFor(client:any):any {const sql=async(parts:TemplateStringsArray,...values:any[])=>(await client.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;return Object.assign(sql,{json:JSON.stringify,begin:(fn:any)=>client.transaction((tx:any)=>fn(sqlFor(tx))),savepoint:async(fn:any)=>{await client.exec('savepoint reward');try{const r=await fn(sql);await client.exec('release savepoint reward');return r;}catch(e){await client.exec('rollback to savepoint reward');await client.exec('release savepoint reward');throw e;}}});}
beforeAll(async()=>{pg=new PGlite();state.sql=sqlFor(pg);await pg.exec(`
 create table users(id uuid primary key,full_name text,status text,email text,phone_e164 text,created_at timestamptz default now(),email_verified_at timestamptz default now(),deleted_at timestamptz);
 create table drivers(user_id uuid primary key,approval_status text,approved_at timestamptz);
 create table mobile_account_roles(user_id uuid,role text,primary key(user_id,role));
 create table user_service_area_access(user_id uuid,review_mode boolean);
 create table service_areas(id uuid primary key,name text,enabled boolean);
 create table driver_documents(driver_id uuid,status text);
 create table driver_memberships(id uuid primary key default gen_random_uuid(),driver_id uuid,cycle_closed_at timestamptz,status text,expires_at timestamptz,grace_ends_at timestamptz,suspension_at timestamptz,grace_allows_trips_applied boolean,plan_type_snapshot text,completed_trips int,included_trips_snapshot int);
 create table driver_wallets(driver_id uuid,total numeric,reserved numeric,enabled boolean);
 create table arrival_search_exclusions(session_id uuid,driver_id uuid);
 create table trips(id uuid primary key default gen_random_uuid(),arrival_search_session_id uuid,passenger_id uuid,driver_id uuid,status text,created_at timestamptz default now(),started_at timestamptz,completed_at timestamptz);
 create function trip_offer_economics(uuid,integer) returns jsonb language sql as $$select '{}'::jsonb$$;
 create table costa_go_campaigns(id uuid primary key,title text,content jsonb,audience text,enabled boolean,status text,starts_at timestamptz,ends_at timestamptz,all_zones boolean,priority int default 0);
 create table costa_go_campaign_areas(campaign_id uuid,service_area_id uuid);
 create table audit_log(actor_id uuid,action text,entity_type text,entity_id text,previous_value jsonb,next_value jsonb,reason text,created_at timestamptz default now());
 `);for(const file of ['101_costa_go_benefits.sql','102_referrals.sql','103_referral_rule_snapshots.sql','105_benefit_free_trips.sql'])await pg.exec(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const auth=async(r:any,s:any)=>{if(!r.headers['x-user']){s.code(401).send({error:'UNAUTHORIZED'});return;}return {id:r.headers['x-user'],email:'',name:'',role:r.headers['x-role']??'DRIVER'};};
 await registerBenefitRoutes(app,auth);await registerReferralRoutes(app,auth);
},30000);
beforeEach(async()=>{await pg.exec(`truncate benefit_definitions,benefit_referrals,benefit_reward_programs,referral_codes,users,drivers,mobile_account_roles,trips,audit_log,driver_memberships cascade;
 insert into users(id,full_name,status,email,phone_e164,created_at) values('${a}','Inviter','ACTIVE','a@test.com','+593990000001',now()-interval '30 days'),('${b}','New','ACTIVE','b@test.com','+593990000002',now()-interval '1 day'),('${d}','Other','ACTIVE','d@test.com','+593990000003',now()-interval '1 day');
 insert into drivers values('${a}','APROBADO',now()-interval '20 days'),('${b}','PENDIENTE',null),('${d}','APROBADO',now()-interval '1 day');
 insert into mobile_account_roles select id,'DRIVER' from users;insert into mobile_account_roles select id,'PASSENGER' from users;
 insert into benefit_definitions(code,name,benefit_type,value,audience,one_time,requires_activation,starts_at,ends_at,max_per_user,status) values('REFERRER_DAYS','Días referente','COURTESY_DAYS',3,'DRIVER',false,false,now()-interval '10 days',now()+interval '90 days',10,'ACTIVE'),('REFERRED_DAYS','Días invitado','COURTESY_DAYS',2,'DRIVER',true,false,now()-interval '10 days',now()+interval '90 days',1,'ACTIVE');`);
 code=await referralCodeFor(state.sql,a);
 const payload={code:'DRIVER_REFERRALS',name:'Referidos conductores',description:'Invita a otros conductores',audience:'DRIVER',startsAt:new Date(Date.now()-2*86400000).toISOString(),endsAt:new Date(Date.now()+30*86400000).toISOString(),qualifyingEvent:'DRIVER_APPROVED_AND_FIRST_COMPLETED_TRIP',requiredTrips:1,referrerBenefitCode:'REFERRER_DAYS',referredBenefitCode:'REFERRED_DAYS',maxRewardsPerReferrer:10,maxGlobalRewards:100,zoneIds:[],status:'ACTIVE',shareMessage:'Te invito a Costa-Go: {url}. Código {code}'};
 const r=await app.inject({method:'POST',url:'/v1/admin/referral-programs',headers:{'x-admin':'yes'},payload});expect(r.statusCode,r.body).toBe(201);program=r.json();
});
afterAll(async()=>{await app.close();await pg.close();});
const attribute=(overrides:any={},user=b,role='DRIVER')=>app.inject({method:'POST',url:'/v1/referrals/attribute',headers:{'x-user':user,'x-role':role},payload:{code,programId:program.id,...overrides}});
async function process(id:string){await state.sql.begin((tx:any)=>processReferral(tx,id));}
async function complete(user=b,passenger=a,extra=''){await pg.query(`insert into trips(driver_id,passenger_id,status,started_at,completed_at ${extra?',referral_test_trip':''}) values($1,$2,'COMPLETED',now(),now() ${extra?','+extra:''})`,[user,passenger]);}
async function rewards(){return (await pg.query<any>('select * from benefit_redemptions order by user_id')).rows;}
it('stable code, neutral share URL, landing and invalid code',async()=>{expect(await referralCodeFor(state.sql,a)).toBe(code);const r=await app.inject({url:'/v1/referrals',headers:{'x-user':a}});expect(r.json().programs[0].message).toContain(`https://costa-go.com/r/${code}`);expect(r.json().programs[0].code).toBe(code);
 const landing=await app.inject(`/v1/public/referrals/${code}?program=DRIVER_REFERRALS`);expect(landing.statusCode,landing.body).toBe(200);expect(landing.body).not.toContain('a@test.com');expect((await attribute({code:'CG-0000000000000000'})).json().error).toBe('REFERRAL_NOT_AVAILABLE');
});
it('attributes confirmed new account; registration/approval/incomplete/cancelled/test trips do not reward',async()=>{const r=await attribute();expect(r.statusCode,r.body).toBe(200);const id=r.json().id;await process(id);expect(await rewards()).toHaveLength(0);
 await pg.exec(`update drivers set approval_status='APROBADO',approved_at=now() where user_id='${b}'`);await process(id);expect(await rewards()).toHaveLength(0);
 await pg.exec(`insert into trips(driver_id,passenger_id,status,started_at) values('${b}','${a}','IN_PROGRESS',now());insert into trips(driver_id,passenger_id,status,started_at,completed_at) values('${b}','${a}','CANCELLED',now(),now());`);await process(id);expect(await rewards()).toHaveLength(0);
 await complete(b,a,'true');await process(id);expect(await rewards()).toHaveLength(0);
 await complete();await process(id);expect((await rewards()).map(x=>Number(x.benefit_value))).toEqual([3,2]);
 await Promise.all([process(id),process(id)]);await complete();await process(id);expect(await rewards()).toHaveLength(2);expect((await pg.query<any>('select status from benefit_referrals')).rows[0].status).toBe('REWARDED');expect((await pg.query('select * from benefit_reward_events')).rows).toHaveLength(1);
});
it('rejects self, duplicate, crossed accounts, old accounts and prior activity',async()=>{
 expect((await attribute({},a)).json().error).toBe('SELF_REFERRAL_NOT_ALLOWED');
 const id=(await attribute()).json().id;expect(id).toBeTruthy();expect((await attribute()).json().error).toBe('REFERRAL_ALREADY_ATTRIBUTED');
 await pg.exec(`update drivers set approval_status='APROBADO' where user_id='${b}'`);const other=await referralCodeFor(state.sql,b);expect((await attribute({code:other},a)).json().error).toBe('REFERRER_MUST_PRECEDE_USER');
 await pg.exec(`update users set created_at=now()-interval '8 days' where id='${d}'`);expect((await attribute({},d)).json().error).toBe('REFERRAL_TOO_LATE');
 await pg.exec(`update users set created_at=now()-interval '1 day' where id='${d}';insert into trips(driver_id,passenger_id,status,started_at) values('${d}','${a}','IN_PROGRESS',now())`);expect((await attribute({},d)).json().error).toBe('REFERRAL_TOO_LATE');
});
it('awards passenger promotional credit separately, both parties, once',async()=>{
 await pg.exec("update benefit_definitions set requires_activation=false;insert into benefit_definitions(code,name,benefit_type,value,audience,one_time,requires_activation,starts_at,ends_at,expiration_days,status) values('PASSENGER_CREDIT','Crédito promocional','PROMOTIONAL_BALANCE',1,'PASSENGER',false,false,now()-interval '10 days',now()+interval '90 days',30,'ACTIVE')");
 const body={...program,referrerBenefitCode:'PASSENGER_CREDIT',referredBenefitCode:'PASSENGER_CREDIT',audience:'PASSENGER',mustBeApproved:false,qualifyingEvent:'PASSENGER_FIRST_COMPLETED_TRIP'};delete body.id;delete body.condition;delete body.metrics;
 const updated=await app.inject({method:'PUT',url:`/v1/admin/referral-programs/${program.id}`,headers:{'x-admin':'yes'},payload:body});expect(updated.statusCode,updated.body).toBe(200);
 const r=await attribute({},b,'PASSENGER');expect(r.statusCode,r.body).toBe(200);await complete(d,b);await process(r.json().id);await process(r.json().id);
 expect(await rewards()).toHaveLength(2);expect((await pg.query('select * from benefit_promotional_credits')).rows).toHaveLength(2);expect((await pg.query('select * from benefit_promotional_movements')).rows).toHaveLength(2);expect((await pg.query('select * from driver_wallets')).rows).toHaveLength(0);
});
it('pausing stops attribution but honors previously registered referrals within deadline',async()=>{const id=(await attribute()).json().id;await pg.query("update benefit_reward_programs set enabled=false,status='PAUSED' where id=$1",[program.id]);expect((await attribute({},d)).json().error).toBe('REFERRAL_NOT_AVAILABLE');await pg.exec(`update drivers set approval_status='APROBADO',approved_at=now() where user_id='${b}'`);await complete();await process(id);expect(await rewards()).toHaveLength(2);});
it('expiry and caps block automatic grants; no half-paid referral',async()=>{await pg.exec(`update drivers set approval_status='APROBADO',approved_at=now() where user_id='${b}'`);const id=(await attribute()).json().id;await complete();await pg.exec("update benefit_definitions set status='PAUSED' where code='REFERRED_DAYS'");await process(id);expect(await rewards()).toHaveLength(0);expect((await pg.query<any>('select status,last_error from benefit_referrals')).rows[0]).toMatchObject({status:'QUALIFIED',last_error:'BENEFIT_UNAVAILABLE'});
 await pg.exec("update benefit_definitions set status='ACTIVE' where code='REFERRED_DAYS'");await process(id);expect(await rewards()).toHaveLength(2);
 await pg.exec('update benefit_reward_programs set max_redemptions=1,max_rewards_per_referrer=1');const next=(await attribute({},d)).json().id;await complete(d,a);await process(next);expect(await rewards()).toHaveLength(2);expect((await pg.query<any>('select last_error from benefit_referrals where id=$1',[next])).rows[0].last_error).toBe('REFERRAL_LIMIT_REACHED');
 await pg.exec("update benefit_reward_programs set ends_at=now()-interval '1 second'");expect((await attribute()).json().error).toBe('REFERRAL_NOT_AVAILABLE');
});

it.each(['REGISTRATION_COMPLETED','DRIVER_APPROVED','DRIVER_FIRST_COMPLETED_TRIP','X_COMPLETED_TRIPS'])('qualifies only the configured event: %s',async event=>{
 await pg.query('update benefit_reward_programs set required_event=$1,required_trips=2',[event]);
 if(event==='REGISTRATION_COMPLETED')await pg.exec("insert into benefit_definitions(code,name,benefit_type,value,audience,one_time,requires_activation,starts_at,ends_at,expiration_days,status) values('REG_CREDIT','Crédito','PROMOTIONAL_BALANCE',1,'BOTH',false,false,now()-interval '10 days',now()+interval '90 days',30,'ACTIVE');update benefit_reward_programs set must_be_approved=false,referrer_benefit_code='REG_CREDIT',referred_benefit_code='REG_CREDIT'");
 const result=await attribute();expect(result.statusCode,result.body).toBe(200);const id=result.json().id;
 await process(id);expect(await rewards()).toHaveLength(event==='REGISTRATION_COMPLETED'?2:0);
 if(event==='REGISTRATION_COMPLETED')return;
 await pg.exec(`update drivers set approval_status='APROBADO',approved_at=now() where user_id='${b}'`);await process(id);
 expect(await rewards()).toHaveLength(event==='DRIVER_APPROVED'?2:0);
 if(event==='DRIVER_APPROVED')return;
 await complete();await process(id);expect(await rewards()).toHaveLength(event==='X_COMPLETED_TRIPS'?0:2);
 if(event==='X_COMPLETED_TRIPS'){await complete();await process(id);expect(await rewards()).toHaveLength(2);}
});
it.each(['GLOBAL','REFERRER'])('enforces independent %s limit and preserves metrics',async limit=>{
 await pg.exec(`update drivers set approval_status='APROBADO',approved_at=now() where user_id='${b}';update benefit_reward_programs set max_redemptions=${limit==='GLOBAL'?1:'null'},max_rewards_per_referrer=${limit==='REFERRER'?1:'null'}`);
 const first=(await attribute({source:'LINK'})).json().id,second=(await attribute({},d)).json().id;
 await complete();await complete(d,a);await Promise.all([process(first),process(second)]);
 expect(await rewards()).toHaveLength(2);
 const metrics=(await app.inject({url:'/v1/admin/referral-programs',headers:{'x-admin':'yes'}})).json().items[0].metrics;
 expect(metrics).toMatchObject({registered:2,rewarded:1,grants:2,linksUsed:1,manualCodesUsed:1,blocked:1});
});
it('excludes review accounts and retains test marking on their trips',async()=>{
 await pg.exec(`insert into user_service_area_access values('${b}',true)`);
 expect((await attribute()).json().error).toBe('REFERRAL_TEST_ACCOUNT');
 await complete();expect((await pg.query<any>('select referral_test_trip from trips')).rows[0].referral_test_trip).toBe(true);
 await pg.exec('truncate user_service_area_access');
 await pg.exec(`update users set referral_rewards_excluded=true where id='${b}'`);
 expect((await attribute()).json().error).toBe('REFERRAL_TEST_ACCOUNT');
});
it('requires verification and rejects identity aliases and client reward injection',async()=>{
 await pg.exec(`update users set email_verified_at=null where id='${b}'`);expect((await attribute()).json().error).toBe('REFERRAL_ACCOUNT_REQUIRED');
 await pg.exec(`update users set email_verified_at=now(),phone_e164='+593 990000001' where id='${b}'`);expect((await attribute()).json().error).toBe('SELF_REFERRAL_NOT_ALLOWED');
 expect((await attribute({rewardAmount:100})).statusCode).toBe(400);
});
it('preserves original snapshot after editing and refuses new out-of-zone attribution',async()=>{
 const id=(await attribute()).json().id;expect(id).toBeTruthy();
 const payload={...program,qualifyingEvent:'DRIVER_APPROVED_AND_X_COMPLETED_TRIPS',requiredTrips:3};delete payload.id;delete payload.condition;delete payload.metrics;
 const edit=await app.inject({method:'PUT',url:`/v1/admin/referral-programs/${program.id}`,headers:{'x-admin':'yes'},payload});expect(edit.statusCode,edit.body).toBe(200);const original=(await pg.query<any>('select rules_snapshot from benefit_referrals where id=$1',[id])).rows[0].rules_snapshot;expect(original.required_trips).toBe(1);expect(original.required_event).toBe('DRIVER_APPROVED_AND_FIRST_COMPLETED_TRIP');
 await pg.exec("insert into service_areas values('11111111-1111-4111-8111-111111111111','Zona real',true) on conflict do nothing");await pg.query("insert into referral_program_areas values($1,'11111111-1111-4111-8111-111111111111')",[program.id]);
 expect((await attribute({},d)).json().error).toBe('REFERRAL_NOT_AVAILABLE');
});
it('rejects approval beyond original deadline and does not shorten already accepted terms',async()=>{
 const id=(await attribute()).json().id;
 await complete();await pg.exec(`update drivers set approval_status='APROBADO',approved_at=now()+interval '40 days' where user_id='${b}'`);await process(id);expect(await rewards()).toHaveLength(0);
 await pg.exec(`update drivers set approved_at=now() where user_id='${b}';update benefit_reward_programs set ends_at=now()-interval '1 second'`);await process(id);expect(await rewards()).toHaveLength(2);
 expect((await pg.query<any>('select status from benefit_referrals')).rows[0].status).toBe('REWARDED');
});
it('holds rewards when the referrer loses the required role, then recovers without duplication',async()=>{
 const id=(await attribute()).json().id;await pg.exec(`update drivers set approval_status='APROBADO',approved_at=now() where user_id='${b}'`);await complete();
 await pg.exec(`delete from mobile_account_roles where user_id='${a}' and role='DRIVER'`);await process(id);expect(await rewards()).toHaveLength(0);
 expect((await pg.query<any>('select last_error from benefit_referrals where id=$1',[id])).rows[0].last_error).toBe('FORBIDDEN');
 await pg.exec(`insert into mobile_account_roles values('${a}','DRIVER')`);await process(id);await process(id);expect(await rewards()).toHaveLength(2);
});

it('requires approval, active status and three valid trips together; backend owns progress',async()=>{
 await pg.exec("update benefit_reward_programs set required_event='DRIVER_APPROVED_AND_X_COMPLETED_TRIPS',required_trips=3,must_be_approved=true,must_be_active=true");
 const id=(await attribute()).json().id;
 await complete();await complete();await complete(b,a,'true');await process(id);expect(await rewards()).toHaveLength(0);
 let view=(await app.inject({url:'/v1/referrals',headers:{'x-user':b}})).json();expect(view.attribution.progress).toMatchObject({requiredTrips:3,completedTrips:2,remainingTrips:1,isApproved:false,qualified:false});
 await complete();await process(id);expect(await rewards()).toHaveLength(0);
 await pg.exec(`update drivers set approval_status='APROBADO',approved_at=now() where user_id='${b}';update users set status='SUSPENDED' where id='${b}'`);await process(id);expect(await rewards()).toHaveLength(0);
 await pg.exec(`update users set status='ACTIVE' where id='${b}'`);await process(id);await process(id);expect(await rewards()).toHaveLength(2);
 view=(await app.inject({url:'/v1/referrals',headers:{'x-user':b}})).json();expect(view.attribution.progress).toMatchObject({requiredTrips:3,completedTrips:3,remainingTrips:0,isApproved:true,qualified:true});
});
it('an existing invited account keeps one trip while a new account gets five after an admin edit',async()=>{
 const oldId=(await attribute()).json().id;
 const payload={...program,qualifyingEvent:'DRIVER_APPROVED_AND_X_COMPLETED_TRIPS',requiredTrips:5};delete payload.id;delete payload.condition;delete payload.metrics;
 const edit=await app.inject({method:'PUT',url:`/v1/admin/referral-programs/${program.id}`,headers:{'x-admin':'yes'},payload});expect(edit.statusCode,edit.body).toBe(200);
 const newId=(await attribute({},d)).json().id;
 await pg.exec(`update drivers set approval_status='APROBADO',approved_at=now() where user_id='${b}'`);
 await complete();await complete(d);await complete(d);await complete(d);await process(oldId);await process(newId);expect(await rewards()).toHaveLength(2);
 const view=(await app.inject({url:'/v1/referrals',headers:{'x-user':d}})).json();expect(view.attribution.progress).toMatchObject({requiredTrips:5,completedTrips:3,remainingTrips:2});
 await complete(d);await complete(d);await process(newId);expect(await rewards()).toHaveLength(4);
});
it('codes are immutable, unique and resolved server-side; snapshot and promised benefit economics cannot be rewritten',async()=>{
 const id=(await attribute()).json().id;
 await expect(pg.query('update referral_codes set code=$1 where user_id=$2',['CG-FFFFFFFFFFFFFFFF',a])).rejects.toThrow('REFERRAL_CODE_IMMUTABLE');
 await expect(pg.query('insert into referral_codes(user_id,code) values($1,$2)',[d,code])).rejects.toThrow();
 await expect(pg.query("update benefit_referrals set rules_snapshot=rules_snapshot||'{\"required_trips\":50}' where id=$1",[id])).rejects.toThrow('REFERRAL_IMMUTABLE');
 await expect(pg.exec("update benefit_definitions set value=99 where code='REFERRER_DAYS'")).rejects.toThrow('BENEFIT_REFERRAL_TERMS_LOCKED');
 await pg.exec("insert into service_areas values('22222222-2222-4222-8222-222222222222','Zona de protección',true) on conflict do nothing");
 await expect(pg.exec("insert into benefit_areas select id,'22222222-2222-4222-8222-222222222222' from benefit_definitions where code='REFERRER_DAYS'")).rejects.toThrow('BENEFIT_REFERRAL_TERMS_LOCKED');
 await pg.exec("update benefit_definitions set name='Descripción editable' where code='REFERRER_DAYS'");
 expect((await attribute({referrerUserId:d},d)).statusCode).toBe(400);
 expect(await referralCodeFor(state.sql,a)).toBe(code);
 expect((await app.inject(`/v1/public/referrals/${code}`)).statusCode).toBe(200);
});
it('generic first-trip condition supports BOTH and does not silently require driver approval',async()=>{
 await pg.exec("insert into benefit_definitions(code,name,benefit_type,value,audience,one_time,requires_activation,starts_at,ends_at,expiration_days,status) values('BOTH_CREDIT','Crédito ambos','PROMOTIONAL_BALANCE',2,'BOTH',false,false,now()-interval '10 days',now()+interval '90 days',20,'ACTIVE');update benefit_reward_programs set audience='BOTH',required_event='FIRST_COMPLETED_TRIP',must_be_approved=false,referrer_benefit_code='BOTH_CREDIT',referred_benefit_code='BOTH_CREDIT'");
 const id=(await attribute()).json().id;await complete();await process(id);expect(await rewards()).toHaveLength(2);
});

it('honors a valid trip completed in the original window even when processing occurs after expiration',async()=>{
 await pg.exec("update benefit_definitions set ends_at=now()+interval '2 seconds';update benefit_reward_programs set ends_at=now()+interval '2 seconds'");
 const id=(await attribute()).json().id;await pg.exec(`update drivers set approval_status='APROBADO',approved_at=now() where user_id='${b}'`);await complete();
 await new Promise(resolve=>setTimeout(resolve,2200));await process(id);expect(await rewards()).toHaveLength(2);await process(id);expect(await rewards()).toHaveLength(2);
});
it('does not count trips after the original deadline even if the live programme is extended',async()=>{
 await pg.exec("update benefit_reward_programs set ends_at=now()+interval '2 seconds'");const id=(await attribute()).json().id;
 await pg.exec(`update drivers set approval_status='APROBADO',approved_at=now() where user_id='${b}'`);await new Promise(resolve=>setTimeout(resolve,2200));await complete();
 await pg.exec("update benefit_reward_programs set ends_at=now()+interval '30 days'");await process(id);expect(await rewards()).toHaveLength(0);expect((await pg.query<any>('select status from benefit_referrals where id=$1',[id])).rows[0].status).toBe('REJECTED');
});
