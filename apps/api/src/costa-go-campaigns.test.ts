import Fastify from 'fastify';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {beforeAll,beforeEach,afterAll,it,expect,vi} from 'vitest';
import sharp from 'sharp';
const state=vi.hoisted(()=>({sql:null as any}));
vi.mock('./database.js',()=>({database:()=>state.sql}));
vi.mock('./admin.js',async()=>{
  const {hasPermission}=await import('./permissions.js');
  return {requirePermission:(request:any,permission:any)=>{
    if(!request.headers['x-admin'])throw new Error('UNAUTHORIZED');
    const role=request.headers['x-admin']==='super'?'SUPER_ADMIN':'SUPPORT';
    const explicit=request.headers['x-permissions']?.split(',');
    if(!hasPermission(role,permission,explicit))throw new Error('FORBIDDEN');
    return {id:'00000000-0000-4000-8000-000000000001',email:'audit@example.test',role};
  }};
});
vi.mock('./service-areas.js',()=>({resolveServiceArea:async(_id:string,point:any)=>point.longitude===10?{id:'00000000-0000-4000-8000-000000000002'}:undefined}));
import {registerCostaGoCampaignRoutes,campaignSchema,safeCampaignUrl} from './costa-go-campaigns.js';
const admin={'x-admin':'super'},area='00000000-0000-4000-8000-000000000002';
let pg:PGlite;const app=Fastify();
function sqlFor(client:any):any {
  const sql=async(parts:TemplateStringsArray,...values:any[])=>(await client.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
  return Object.assign(sql,{begin:(fn:any)=>client.transaction((tx:any)=>fn(sqlFor(tx))),json:(value:unknown)=>JSON.stringify(value)});
}
beforeAll(async()=>{
  pg=new PGlite();state.sql=sqlFor(pg);
  await pg.exec(`create table users(id uuid primary key,full_name text);insert into users values('00000000-0000-4000-8000-000000000001','Admin');
    create table service_areas(id uuid primary key,name text,code text,enabled boolean);insert into service_areas values('${area}','Zona real','ZONA',true);
    create table audit_log(actor_id uuid,action text,entity_type text,entity_id text,previous_value jsonb,next_value jsonb,reason text,created_at timestamptz default now());
    create table notification_campaigns(id uuid primary key);
    create table affiliate_banners(id int,title text);insert into affiliate_banners values(1,'Publicidad existente');`);
  await pg.exec(await readFile(new URL('../migrations/100_costa_go_campaigns.sql',import.meta.url),'utf8'));
  await registerCostaGoCampaignRoutes(app,async(request,reply)=>{
    if(!request.headers['x-role']){reply.code(401).send({error:'UNAUTHORIZED'});return;}
    return {id:'00000000-0000-4000-8000-000000000001',email:'user@example.test',name:'User',role:request.headers['x-role'] as any};
  });
},30000);
beforeEach(async()=>{await pg.exec('truncate costa_go_campaigns cascade;truncate audit_log;');});
afterAll(async()=>{await app.close();await pg.close();});
const root='/v1/admin/costa-go-campaigns';
function input(overrides:Record<string,unknown>={}){return {internalName:'Lanzamiento interno',title:'Costa-Go novedades',audience:'BOTH',startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString(),allZones:true,zoneIds:[],priority:1,placements:['CAMPAIGNS','HOME'],...overrides};}
async function create(overrides:Record<string,unknown>={}){
  const response=await app.inject({method:'POST',url:root,headers:admin,payload:input(overrides)});expect(response.statusCode,response.body).toBe(201);return response.json();
}
async function transition(c:any,action:string,headers=admin){
  return app.inject({method:'POST',url:`${root}/${c.id}/actions`,headers,payload:{version:c.version,action,reason:'Motivo de prueba'}});
}
async function activate(overrides:Record<string,unknown>={}){
  let c=await create(overrides);for(const action of ['SUBMIT','APPROVE','ACTIVATE']){const r=await transition(c,action);expect(r.statusCode,r.body).toBe(200);c=r.json();}return c;
}
async function mobile(role='PASSENGER',query=''){return app.inject({url:'/v1/costa-go-campaigns'+query,headers:{'x-role':role}});}
it('keeps header decoration opt-in and returns the approved explicit setting',async()=>{
  expect(campaignSchema.parse(input()).decorateHeader).toBe(false);
  const plain=await activate({priority:10,variant:'SUMMER'});
  const decorated=await activate({priority:5,variant:'CHRISTMAS',decorateHeader:true});
  const items=(await mobile()).json().items;
  expect(items.find((x:any)=>x.id===plain.id).decorateHeader).toBe(false);
  expect(items.find((x:any)=>x.id===decorated.id).decorateHeader).toBe(true);
  expect(items.map((x:any)=>x.id)).toEqual([plain.id,decorated.id]);
});
it('selects authenticated audience, BOTH and priority without changing paid advertising',async()=>{
  const passenger=await activate({audience:'PASSENGER',priority:3}),driver=await activate({audience:'DRIVER',priority:5}),both=await activate({priority:10});
  expect((await mobile()).json().items.map((x:any)=>x.id)).toEqual([both.id,passenger.id]);
  expect((await mobile('DRIVER')).json().items.map((x:any)=>x.id)).toEqual([both.id,driver.id]);
  expect((await pg.query<any>('select * from affiliate_banners')).rows).toEqual([{id:1,title:'Publicidad existente'}]);
  expect((await app.inject('/v1/costa-go-campaigns')).statusCode).toBe(401);
  expect((await mobile('ADMIN')).statusCode).toBe(403);
});
it('excludes drafts, paused, disabled, future and expired campaigns including direct details',async()=>{
  await create();const paused=await activate();await transition(paused,'PAUSE');
  const expired=await activate(),disabled=await activate();await activate({startsAt:new Date(Date.now()+3600000).toISOString()});
  await pg.query('update costa_go_campaigns set starts_at=now()-interval \'2 days\',ends_at=now()-interval \'1 day\' where id=$1',[expired.id]);
  await pg.query('update costa_go_campaigns set enabled=false where id=$1',[disabled.id]);
  expect((await mobile()).json().items).toEqual([]);
  expect((await app.inject({url:`/v1/costa-go-campaigns/${expired.id}`,headers:{'x-role':'PASSENGER'}})).statusCode).toBe(404);
});
it('uses resolved operational area and never treats absent location as every zone',async()=>{
  const local=await activate({allZones:false,zoneIds:[area]});const global=await activate({priority:0});
  expect((await mobile()).json().items.map((x:any)=>x.id)).toEqual([global.id]);
  expect((await mobile('PASSENGER','?latitude=0&longitude=10')).json().items.map((x:any)=>x.id)).toEqual([local.id,global.id]);
  expect((await mobile('PASSENGER','?latitude=0&longitude=11')).json().items.map((x:any)=>x.id)).toEqual([global.id]);
});
it('requires each action permission and approval; prevents stale edits and invalidates approval on edits',async()=>{
  let c=await create();expect((await transition(c,'ACTIVATE')).statusCode).toBe(409);
  expect((await app.inject({method:'PUT',url:`${root}/${c.id}`,headers:{'x-admin':'support'},payload:{...input(),version:c.version}})).statusCode).toBe(403);
  c=(await transition(c,'SUBMIT')).json();
  expect((await transition(c,'APPROVE',{'x-admin':'support','x-permissions':'costa_campaigns:edit'} as any)).statusCode).toBe(403);
  c=(await transition(c,'APPROVE')).json();c=(await transition(c,'ACTIVATE')).json();
  const payload={...input(),version:c.version,title:'Nuevo contenido'};
  const updated=await app.inject({method:'PUT',url:`${root}/${c.id}`,headers:admin,payload});expect(updated.json()).toMatchObject({status:'DRAFT',enabled:false,reviewedBy:null});
  expect((await app.inject({method:'PUT',url:`${root}/${c.id}`,headers:admin,payload})).statusCode).toBe(409);
  expect((await mobile()).json().items).toHaveLength(0);
  const history=(await app.inject({url:`${root}/${c.id}`,headers:admin})).json().history;
  expect(history.map((h:any)=>h.action)).toContain('COSTA_CAMPAIGN_APPROVE');
});
it('refreshes changed campaigns in the same session and filters placements',async()=>{
  const c=await activate({placements:['HOME']});
  expect((await mobile('PASSENGER','?placement=CAMPAIGNS')).json().items).toHaveLength(0);
  expect((await mobile()).json().items).toHaveLength(1);
  await transition(c,'PAUSE');expect((await mobile()).json().items).toHaveLength(0);
});
it('duplicates into a draft and never copies approval or enabled state',async()=>{
  const c=await activate({allZones:false,zoneIds:[area]});
  const copy=(await app.inject({method:'POST',url:`${root}/${c.id}/duplicate`,headers:admin,payload:{}})).json();
  expect(copy).toMatchObject({status:'DRAFT',enabled:false,zoneIds:[area],reviewedBy:null});expect(copy.id).not.toBe(c.id);
});
it('validates CTA destinations and limits membership actions to drivers',()=>{
  expect(campaignSchema.safeParse(input({ctaType:'INTERNAL_ROUTE',ctaText:'Soporte',ctaDestination:'support'})).success).toBe(true);
  for(const destination of ['javascript:alert(1)','http://example.com','https://user:pass@example.com','https://127.0.0.1','https://localhost','https://example.local'])expect(safeCampaignUrl(destination)).toBe(false);
  expect(safeCampaignUrl('https://costa-go.com/promociones')).toBe(true);
  expect(campaignSchema.safeParse(input({ctaType:'INTERNAL_ROUTE',ctaText:'Acción',ctaDestination:'fake-route'})).success).toBe(false);
  expect(campaignSchema.safeParse(input({ctaType:'MEMBERSHIP',ctaText:'Planes'})).success).toBe(false);
  expect(campaignSchema.safeParse(input({ctaType:'MEMBERSHIP',ctaText:'Planes',audience:'DRIVER'})).success).toBe(true);
  expect(campaignSchema.safeParse(input({ctaType:'REFERRAL',ctaText:'Invitar'})).success).toBe(true);
});
it('stores validated images, resets approval, protects assets, and audits changes',async()=>{
  let c=await activate();const data=await sharp({create:{width:2,height:2,channels:3,background:'#123456'}}).png().toBuffer();
  const upload=await app.inject({method:'PUT',url:`${root}/${c.id}/assets/MAIN`,headers:admin,payload:{version:c.version,mime:'image/png',base64:data.toString('base64')}});
  expect(upload.statusCode,upload.body).toBe(200);c=upload.json();expect(c.status).toBe('DRAFT');expect(c.assets).toEqual(['MAIN']);
  expect((await app.inject({url:`/v1/costa-go-campaigns/${c.id}/assets/MAIN`,headers:{'x-role':'PASSENGER'}})).statusCode).toBe(404);
  expect((await app.inject({url:`${root}/${c.id}/assets/MAIN`,headers:admin})).headers['content-type']).toContain('image/png');
  expect((await app.inject({method:'PUT',url:`${root}/${c.id}/assets/MAIN`,headers:admin,payload:{version:c.version,mime:'image/png',base64:'not an image'}})).statusCode).toBe(409);
});
