import Fastify from 'fastify';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {beforeAll,beforeEach,afterAll,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({sql:null as any}));
vi.mock('./database.js',()=>({database:()=>state.sql}));
vi.mock('./admin.js',()=>({requirePermission:(r:any,p:string)=>{if(r.headers['x-admin']!=='yes')throw new Error('FORBIDDEN');return {id:'00000000-0000-4000-8000-000000000001',role:'SUPER_ADMIN',email:'test@example.test'};}}));
vi.mock('./service-areas.js',()=>({resolveServiceArea:async()=>undefined}));
import {registerBenefitRoutes,benefitSchema} from './benefits.js';
const uid='00000000-0000-4000-8000-000000000001',cid='00000000-0000-4000-8000-000000000002';
const app=Fastify();let pg:PGlite;
function sqlFor(client:any):any {const sql=async(parts:TemplateStringsArray,...values:any[])=>(await client.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;return Object.assign(sql,{begin:(fn:any)=>client.transaction((tx:any)=>fn(sqlFor(tx))),json:JSON.stringify});}
const payload=()=>({code:'DRIVER_FOUNDER_COURTESY',name:'Conductor fundador',description:'15 días de cortesía',benefitType:'COURTESY_DAYS',value:15,audience:'DRIVER',oneTime:true,requiresActivation:true,startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString(),maxGlobal:null,maxPerUser:1,status:'ACTIVE',zoneIds:[]});
beforeAll(async()=>{pg=new PGlite();state.sql=sqlFor(pg);
 await pg.exec(`create table users(id uuid primary key,full_name text,status text);insert into users values('${uid}','Conductor','ACTIVE');
 create table drivers(user_id uuid primary key,approval_status text);insert into drivers values('${uid}','APROBADO');
 create table service_areas(id uuid primary key,name text,enabled boolean);
 create table driver_documents(driver_id uuid,status text);
 create table driver_memberships(id uuid primary key default gen_random_uuid(),driver_id uuid,cycle_closed_at timestamptz,status text,expires_at timestamptz,grace_ends_at timestamptz,suspension_at timestamptz,grace_allows_trips_applied boolean,plan_type_snapshot text,completed_trips int,included_trips_snapshot int);
 create table driver_wallets(driver_id uuid,total numeric,reserved numeric,enabled boolean);
 create table arrival_search_exclusions(session_id uuid,driver_id uuid);create table trips(id uuid,arrival_search_session_id uuid);
 create function trip_offer_economics(uuid,integer) returns jsonb language sql stable as $$select '{"theoreticalCommission":"0.25"}'::jsonb$$;
 create table costa_go_campaigns(id uuid primary key,title text,content jsonb,audience text,enabled boolean,status text,starts_at timestamptz,ends_at timestamptz,all_zones boolean,priority int default 0);
 create table costa_go_campaign_areas(campaign_id uuid,service_area_id uuid);
 create table audit_log(actor_id uuid,action text,entity_type text,entity_id text,previous_value jsonb,next_value jsonb,reason text,created_at timestamptz default now());`);
 await pg.exec(await readFile(new URL('../migrations/101_costa_go_benefits.sql',import.meta.url),'utf8'));
 await registerBenefitRoutes(app,async(r,s)=>{if(!r.headers['x-user']){s.code(401).send({error:'UNAUTHORIZED'});return;}return {id:String(r.headers['x-user']),role:(r.headers['x-role']??'DRIVER') as any,email:'test@example.test',name:'Test'};});
},30000);
beforeEach(async()=>{await pg.exec(`truncate benefit_redemptions,benefit_areas,benefit_definitions,costa_go_campaigns,audit_log,driver_memberships,driver_documents cascade;
 update users set status='ACTIVE';update drivers set approval_status='APROBADO';
 insert into costa_go_campaigns values('${cid}','Fundadores','{"benefitCode":"DRIVER_FOUNDER_COURTESY"}','DRIVER',true,'ACTIVE',now()-interval '1 day',now()+interval '1 day',true,1);`);
 const r=await app.inject({method:'POST',url:'/v1/admin/benefits',headers:{'x-admin':'yes'},payload:payload()});expect(r.statusCode,r.body).toBe(201);
});
afterAll(async()=>{await app.close();await pg.close();});
const claim=(campaignId=cid,extra={})=>app.inject({method:'POST',url:'/v1/benefits/DRIVER_FOUNDER_COURTESY/claim',headers:{'x-user':uid},payload:{campaignId,...extra}});
it('grants 15 actual days without changing memberships or wallet; access expires by database time',async()=>{
 const r=await claim();expect(r.statusCode,r.body).toBe(200);const grant=r.json().redemption;expect(grant.status).toBe('ACTIVE');expect(Date.parse(grant.effectiveUntil)-Date.parse(grant.effectiveFrom)).toBe(15*86400000);
 expect((await pg.query<any>(`select active_courtesy_benefit('${uid}') as id`)).rows[0].id).toBe(grant.id);
 expect((await pg.query<any>(`select commercial_driver_can_accept('${uid}','${cid}',1) as ok`)).rows[0].ok).toBe(true);
 expect((await pg.query('select * from driver_memberships')).rows).toHaveLength(0);
 await pg.exec("update benefit_redemptions set effective_from=now()-interval '16 days',effective_until=now()-interval '1 day'");
 expect((await pg.query<any>(`select active_courtesy_benefit('${uid}') as id`)).rows[0].id).toBe(null);
 expect((await app.inject({url:'/v1/benefits/mine',headers:{'x-user':uid}})).json().items[0].status).toBe('EXPIRED');
});
it.each(['PENDIENTE','RECHAZADO'])('rejects driver approval %s',async status=>{await pg.query('update drivers set approval_status=$1',[status]);expect((await claim()).json().error).toBe('NOT_ELIGIBLE');});
it('rejects inactive users, suspended documents and manual membership suspension',async()=>{
 await pg.exec("update users set status='INACTIVE'");expect((await claim()).json().error).toBe('NOT_ELIGIBLE');
 await pg.exec(`update users set status='ACTIVE';insert into driver_documents values('${uid}','SUSPENDED')`);expect((await claim()).json().error).toBe('NOT_ELIGIBLE');
 await pg.exec(`truncate driver_documents;insert into driver_memberships(driver_id,status) values('${uid}','SUSPENDED')`);expect((await claim()).json().error).toBe('NOT_ELIGIBLE');
});
it('rejects expired campaign and benefit independently',async()=>{
 await pg.exec("update costa_go_campaigns set ends_at=now()-interval '1 second'");expect((await claim()).json().error).toBe('BENEFIT_EXPIRED');
 await pg.exec("update costa_go_campaigns set ends_at=now()+interval '1 day';update benefit_definitions set starts_at=now()-interval '2 days',ends_at=now()-interval '1 day'");expect((await claim()).json().error).toBe('BENEFIT_EXPIRED');
});
it('serializes double clicks/concurrent requests and replay after reinstall/device/campaign duplication',async()=>{
 const responses=await Promise.all([claim(),claim(),claim()]);expect(responses.map(r=>r.statusCode).sort()).toEqual([200,409,409]);
 const other='00000000-0000-4000-8000-000000000003';await pg.exec(`insert into costa_go_campaigns select '${other}',title,content,audience,enabled,status,starts_at,ends_at,all_zones,priority from costa_go_campaigns where id='${cid}'`);
 expect((await claim(other)).json().error).toBe('ALREADY_REDEEMED');expect((await claim()).json().error).toBe('ALREADY_REDEEMED');
 expect((await pg.query('select * from benefit_redemptions')).rows).toHaveLength(1);
 await expect(pg.exec(`insert into benefit_redemptions(benefit_id,benefit_code,user_id,campaign_id,audience,benefit_type,benefit_value,one_time,source,effective_from,effective_until) select benefit_id,benefit_code,user_id,campaign_id,audience,benefit_type,benefit_value,false,source,effective_from,effective_until from benefit_redemptions`)).rejects.toThrow(/benefit_once_per_user/);
});
it('schedules after existing paid membership and preserves it byte for byte',async()=>{
 await pg.exec(`insert into driver_memberships(driver_id,status,expires_at,plan_type_snapshot) values('${uid}','ACTIVE',now()+interval '30 days','TRIP_PACK')`);
 const before=(await pg.query<any>('select * from driver_memberships')).rows[0];const r=(await claim()).json();expect(new Date(r.redemption.effectiveFrom).toISOString()).toBe(new Date(before.expires_at).toISOString());expect(r.redemption.status).toBe('PENDING');
 expect((await pg.query('select * from driver_memberships')).rows[0]).toEqual(before);
 await pg.exec("update driver_memberships set expires_at=expires_at+interval '30 days'");
 const after=(await pg.query<any>('select * from benefit_redemptions')).rows[0];expect(new Date(after.effective_until).getTime()-new Date(after.effective_from).getTime()).toBe(15*86400000);
 expect(new Date(after.effective_from).getTime()-new Date(before.expires_at).getTime()).toBe(30*86400000);
});
it('enforces global capacity, authenticated audience and server-owned amount',async()=>{
 expect((await claim(cid,{value:999,userId:cid})).statusCode).toBe(400);
 const r=await app.inject({method:'POST',url:'/v1/benefits/DRIVER_FOUNDER_COURTESY/claim',headers:{'x-user':uid,'x-role':'PASSENGER'},payload:{campaignId:cid}});expect(r.json().error).toBe('NOT_ELIGIBLE');
 await pg.exec('update benefit_definitions set max_global=1');await claim();
 const other='00000000-0000-4000-8000-000000000004';await pg.exec(`insert into users values('${other}','Other','ACTIVE');insert into drivers values('${other}','APROBADO')`);
 const second=await app.inject({method:'POST',url:'/v1/benefits/DRIVER_FOUNDER_COURTESY/claim',headers:{'x-user':other},payload:{campaignId:cid}});expect(second.json().error).toBe('BENEFIT_LIMIT_REACHED');
});
it('protects immutable identity and refuses unsupported automatic/financial types',async()=>{
 await expect(pg.exec("update benefit_definitions set code='OTHER_CODE'")).rejects.toThrow('BENEFIT_IDENTITY_IMMUTABLE');
 expect(benefitSchema.safeParse({...payload(),code:'PROMO_CREDIT',benefitType:'PROMOTIONAL_BALANCE'}).success).toBe(false);
 expect(benefitSchema.safeParse({...payload(),requiresActivation:false}).success).toBe(false);
 expect((await app.inject('/v1/admin/benefits')).statusCode).toBe(403);
});

it('available/mine/detail follow server eligibility and never expose a claim button after redemption',async()=>{
 const headers={'x-user':uid};
 expect((await app.inject({url:'/v1/benefits/available',headers})).json().items).toHaveLength(1);
 expect((await app.inject({url:`/v1/benefits/DRIVER_FOUNDER_COURTESY?campaignId=${cid}`,headers})).json().state).toBe('AVAILABLE');
 await claim();
 expect((await app.inject({url:'/v1/benefits/available',headers})).json().items).toHaveLength(0);
 expect((await app.inject({url:`/v1/benefits/DRIVER_FOUNDER_COURTESY?campaignId=${cid}`,headers})).json().state).toBe('ALREADY_REDEEMED');
 const list=await app.inject({url:'/v1/admin/benefits/redemptions?status=ACTIVE&audience=DRIVER',headers:{'x-admin':'yes'}});expect(list.statusCode,list.body).toBe(200);expect(list.json().total).toBe(1);
 const definitions=(await app.inject({url:'/v1/admin/benefits',headers:{'x-admin':'yes'}})).json().items;
 expect(definitions[0]).toMatchObject({redemptions:1,totalGranted:15});
 const history=await app.inject({url:`/v1/admin/benefits/${definitions[0].id}/history`,headers:{'x-admin':'yes'}});expect(history.statusCode,history.body).toBe(200);expect(history.json().items.map((h:any)=>h.action)).toContain('BENEFIT_CLAIMED');
});
it('requires applicable campaign and zone; no location does not mean all areas',async()=>{
 await pg.exec("update costa_go_campaigns set all_zones=false");expect((await claim()).json().error).toBe('NOT_ELIGIBLE');
 await pg.exec("update costa_go_campaigns set all_zones=true,content='{}'");expect((await claim()).json().error).toBe('BENEFIT_UNAVAILABLE');
});
it('repeatable definitions are still idempotent within the same campaign',async()=>{
 const body={...payload(),code:'REPEAT_COURTESY',oneTime:false,maxPerUser:3,value:2};
 expect((await app.inject({method:'POST',url:'/v1/admin/benefits',headers:{'x-admin':'yes'},payload:body})).statusCode).toBe(201);
 await pg.exec("update costa_go_campaigns set content='{"+ '"benefitCode":"REPEAT_COURTESY"' +"}'");
 const send=()=>app.inject({method:'POST',url:'/v1/benefits/REPEAT_COURTESY/claim',headers:{'x-user':uid},payload:{campaignId:cid}});
 const results=await Promise.all([send(),send()]);expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);
});

it('reserved referral infrastructure rejects self/duplicate referrals and cannot activate programs',async()=>{
 const other='00000000-0000-4000-8000-000000000005';
 await pg.exec(`alter table users add column if not exists email text;alter table users add column if not exists phone text;
 insert into users(id,full_name,status,email,phone) values('${other}','Other','ACTIVE','duplicate@example.test','+593990000001');
 update users set email='Duplicate@Example.Test',phone='0990000001' where id='${uid}';`);
 const program=(await pg.query<any>("insert into benefit_reward_programs(name,required_event) values('Future','FIRST_COMPLETED_TRIP') returning id")).rows[0].id;
 await expect(pg.query('update benefit_reward_programs set enabled=true where id=$1',[program])).rejects.toThrow();
 await expect(pg.query('insert into benefit_referrals(program_id,referrer_user_id,referred_user_id) values($1,$2,$3)',[program,uid,uid])).rejects.toThrow('SELF_REFERRAL_NOT_ALLOWED');
 await expect(pg.query('insert into benefit_referrals(program_id,referrer_user_id,referred_user_id) values($1,$2,$3)',[program,uid,other])).rejects.toThrow('SELF_REFERRAL_NOT_ALLOWED');
 await pg.query('update users set email=$1,phone=$2 where id=$3',['different@example.test','0990000001',other]);
 await expect(pg.query('insert into benefit_referrals(program_id,referrer_user_id,referred_user_id) values($1,$2,$3)',[program,uid,other])).rejects.toThrow('SELF_REFERRAL_NOT_ALLOWED');
 await pg.query('update users set phone=$1 where id=$2',['0990000002',other]);
 await pg.query('insert into benefit_referrals(program_id,referrer_user_id,referred_user_id) values($1,$2,$3)',[program,uid,other]);
 await expect(pg.query('insert into benefit_referrals(program_id,referrer_user_id,referred_user_id) values($1,$2,$3)',[program,uid,other])).rejects.toThrow(/unique/);
 expect((await pg.query('select * from benefit_redemptions')).rows).toHaveLength(0);
});

it('preserves current grace coverage before scheduling the new courtesy',async()=>{
 await pg.exec(`insert into driver_memberships(driver_id,status,expires_at,grace_ends_at,grace_allows_trips_applied) values('${uid}','GRACE_PERIOD',now()-interval '1 day',now()+interval '3 days',true)`);
 const current=(await pg.query<any>('select grace_ends_at from driver_memberships')).rows[0].grace_ends_at;
 const response=await claim();expect(response.statusCode,response.body).toBe(200);
 expect(new Date(response.json().redemption.effectiveFrom).toISOString()).toBe(new Date(current).toISOString());
});
