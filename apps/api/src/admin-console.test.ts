import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from 'vitest';
import Fastify,{type FastifyInstance} from 'fastify';
import {PGlite} from '@electric-sql/pglite';
import {type AdminRole,type Permission} from './permissions.js';
const state=vi.hoisted(()=>({sql:null as any}));
vi.mock('./database.js',()=>({database:()=>state.sql}));
import {consoleSearchScopes,registerConsoleRoutes} from './admin-console.js';
let pg:PGlite,app:FastifyInstance;let actor:{id?:string;role:AdminRole;permissions?:Permission[];cooperativeId?:string};
const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
beforeAll(async()=>{
  pg=new PGlite();state.sql=(parts:TemplateStringsArray,...values:unknown[])=>pg.query(parts.reduce((sql,p,i)=>sql+(i?'$'+i:'')+p,''),values).then(r=>r.rows);
  await pg.exec(`create table users(id uuid,full_name text,email text,phone_e164 text,deleted_at timestamptz);
  create table drivers(user_id uuid); create table mobile_account_roles(user_id uuid,role text);
  create table trips(id uuid,origin_reference text,destination_reference text,passenger_id uuid,requested_at timestamptz);
  create table cooperatives(id uuid,name text); create table driver_memberships(driver_id uuid);
  create table incidents(id uuid,subject text,category text,description text,created_at timestamptz);
  create table affiliate_banners(id uuid,title text,campaign_status text,order_id uuid,created_at timestamptz);
  create table advertising_orders(id uuid,code text,assigned_commercial_id uuid,advertiser_id uuid);
  create table advertisers(id uuid,business_name text,email text,assigned_commercial_id uuid);
  create table advertising_payments(order_id uuid,payment_method_id uuid);
  create table advertising_payment_methods(id uuid,code text);
  insert into users values('${owner}','Prueba Costa','prueba@example.invalid','0990000001',null),('${other}','Prueba borrada','deleted@example.invalid','0990000002',now());
  insert into drivers values('${owner}'),('${other}');insert into mobile_account_roles values('${owner}','PASSENGER'),('${other}','PASSENGER');
  insert into trips values('${owner}','Prueba origen','Prueba destino','${owner}',now());
  insert into cooperatives values('${owner}','Prueba cooperativa');insert into driver_memberships values('${owner}');
  insert into incidents values('${owner}','Prueba incidente','APP','Descripción',now());
  insert into advertising_orders values('${owner}','PUB-PRUEBA','${owner}','${owner}'),('${other}','PUB-PRUEBA2','${other}','${other}');
  insert into affiliate_banners values('${owner}','Prueba campaña','ACTIVE','${owner}',now()),('${other}','Prueba ajena','ACTIVE','${other}',now());
  insert into advertisers values('${owner}','Prueba comercio','comercio@example.invalid','${owner}'),('${other}','Prueba ajena','otro@example.invalid','${other}');
  insert into advertising_payment_methods values('${owner}','ADVISOR'),('${other}','BANK_TRANSFER');
  insert into advertising_payments values('${owner}','${owner}'),('${other}','${other}');`);
  await pg.exec(`alter table users add status text default 'ACTIVE',add cooperative_id uuid;
    alter table drivers add is_available boolean default true,add last_location_at timestamptz default now();
    alter table trips add driver_id uuid,add status text default 'SEARCHING',add scheduled_for timestamptz;
    alter table incidents add status text default 'ABIERTO',add priority text default 'CRITICA',add reported_by uuid;
    update trips set requested_at=now()-interval '3 minutes';
    update incidents set reported_by='${owner}';`);
  app=Fastify();registerConsoleRoutes(app,()=>{if(!actor)throw new Error('UNAUTHORIZED');return actor;});await app.ready();
});
beforeEach(()=>{vi.stubEnv('DATABASE_URL','postgres://test');actor={id:owner,role:'SUPER_ADMIN'};});
afterAll(async()=>{await app.close();await pg.close();vi.unstubAllEnvs();});
describe('detalles de operación',()=>{
  it('consulta cada indicador con paginación y condiciones reales',async()=>{
    for(const metric of ['activeTrips','searchingTrips','delayedRequests','upcomingScheduled','connectedDrivers','availableDrivers','busyDrivers','criticalIncidents']){
      const response=await app.inject('/v1/admin/operations/details/'+metric+'?page=1&pageSize=1');
      expect(response.statusCode,response.body).toBe(200);expect(response.json().rows.length).toBeLessThanOrEqual(1);
    }
    expect((await app.inject('/v1/admin/operations/details/searchingTrips')).json().total).toBe(1);
    expect((await app.inject('/v1/admin/operations/details/delayedRequests')).json().total).toBe(1);
    expect((await app.inject('/v1/admin/operations/details/activeTrips')).json().total).toBe(0);
    expect((await app.inject('/v1/admin/operations/details/criticalIncidents')).json().module).toBe('incidents');
  });
  it('rechaza scopes ajenos, parámetros inválidos e inyección',async()=>{
    actor={role:'COLLECTOR',permissions:['operations:view']};
    expect((await app.inject('/v1/admin/operations/details/activeTrips')).statusCode).toBe(403);
    actor={role:'SUPER_ADMIN'};
    expect((await app.inject('/v1/admin/operations/details/unknown')).statusCode).toBe(400);
    expect((await app.inject('/v1/admin/operations/details/activeTrips?pageSize=999')).statusCode).toBe(400);
    expect((await app.inject('/v1/admin/operations/details/searchingTrips?search='+encodeURIComponent("%' OR 1=1 --"))).json().rows).toEqual([]);
  });
});
describe('búsqueda administrativa por permisos',()=>{
  it('consulta todos los tipos reales sin incluir cuentas eliminadas',async()=>{const r=await app.inject('/v1/admin/console/search?q=Prueba');expect(r.statusCode).toBe(200);const rows=r.json().results;expect(new Set(rows.map((x:any)=>x.module)).size).toBe(7);expect(rows.some((x:any)=>x.title==='Prueba borrada')).toBe(false);});
  it('respeta los permisos explícitos incluso para administrador',async()=>{actor.permissions=['passengers:view'];const rows=(await app.inject('/v1/admin/console/search?q=Prueba')).json().results;expect(rows).toHaveLength(1);expect(rows[0].module).toBe('passengers');});
  it('el analista de cooperativa no accede a directorios globales por overrides',async()=>{actor={role:'ANALISTA_COOPERATIVA',cooperativeId:owner,permissions:['drivers:view','trips:view']};const rows=(await app.inject('/v1/admin/console/search?q=Prueba')).json().results;expect(rows).toEqual([]);});
  it('el recaudador no recibe identidades ni pagos ajenos',async()=>{actor={role:'COLLECTOR'};expect(Object.values(consoleSearchScopes(actor)).every(v=>!v)).toBe(true);});
  it('comercial solo recibe campañas y comercios asignados y no transferencias autónomas',async()=>{actor={id:owner,role:'COMMERCIAL'};const rows=(await app.inject('/v1/admin/console/search?q=Prueba')).json().results;expect(rows.some((x:any)=>x.title.includes('ajena'))).toBe(false);expect(rows.some((x:any)=>x.title==='Prueba comercio')).toBe(true);await pg.exec(`update advertising_payments set payment_method_id='${other}' where order_id='${owner}'`);const next=(await app.inject('/v1/admin/console/search?q=Prueba')).json().results;expect(next.some((x:any)=>x.module==='commercial'&&x.sub==='advertisers')).toBe(false);});
  it('no permite inyección ni comodines masivos',async()=>{expect((await app.inject('/v1/admin/console/search?q='+encodeURIComponent("%' OR 1=1 --"))).json().results).toEqual([]);expect((await app.inject('/v1/admin/console/search?q=aa')).statusCode).toBe(200);});
  it('valida longitud y no muestra mocks cuando la base está ausente',async()=>{expect((await app.inject('/v1/admin/console/search?q=x')).statusCode).toBe(400);vi.stubEnv('DATABASE_URL','');expect((await app.inject('/v1/admin/console/search?q=Prueba')).statusCode).toBe(503);});
});
