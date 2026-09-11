import Fastify from 'fastify';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';

const state=vi.hoisted(()=>({sql:null as any}));
vi.mock('./database.js',()=>({database:()=>state.sql}));
vi.mock('./admin.js',()=>({
  userFrom:(request:any)=>request.headers.authorization==='Bearer mobile'?{
    id:'00000000-0000-4000-8000-000000000001',email:'mobile@example.test',name:'Operador',
    role:'PASSENGER',sessionId:'00000000-0000-4000-8000-000000000011'
  }:request.headers.authorization==='Bearer mobile-admin'?{
    id:'00000000-0000-4000-8000-000000000001',email:'mobile@example.test',name:'Operador',
    role:'SUPER_ADMIN',administrativeSource:'MOBILE_ADMIN',permissions:['settings:view']
  }:undefined,
  tokenFor:(user:any)=>`issued-${user.role}-${user.administrativeSource}`,
  requirePermission:(request:any)=>request.headers.authorization==='Bearer web-admin'
    ? {id:'00000000-0000-4000-8000-000000000002',sessionId:'00000000-0000-4000-8000-000000000022'}
    : request.headers.authorization==='Bearer mobile-admin'
      ? {id:'00000000-0000-4000-8000-000000000001',administrativeSource:'MOBILE_ADMIN'}
      : (()=>{throw new Error('FORBIDDEN');})()
}));
import {registerMobileAdminAccessRoutes} from './mobile-admin-access.js';

let pg:PGlite;const app=Fastify();
function sqlFor(client:any):any {
  const sql=async(parts:TemplateStringsArray,...values:any[])=>(await client.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
  return Object.assign(sql,{begin:(fn:any)=>client.transaction((tx:any)=>fn(sqlFor(tx))),json:(value:unknown)=>JSON.stringify(value)});
}

beforeAll(async()=>{
  pg=new PGlite();state.sql=sqlFor(pg);
  await pg.exec(`create table users(id uuid primary key,full_name text,email text,phone_e164 text,status text,deleted_at timestamptz,active_session_id uuid);
    create table mobile_account_roles(user_id uuid,role text);
    create table mobile_admin_access(user_id uuid primary key,access_role text,enabled boolean,assigned_by uuid,version int default 1,updated_at timestamptz default now());
    create table admin_sessions(id uuid,user_id uuid,token_hash text,expires_at timestamptz,revoked_at timestamptz,created_at timestamptz default now());
    create table audit_log(actor_id uuid,action text,entity_type text,entity_id text,previous_value jsonb,next_value jsonb,reason text,created_at timestamptz default now());
    insert into users values('00000000-0000-4000-8000-000000000001','Operador','mobile@example.test','0990000000','ACTIVE',null,'00000000-0000-4000-8000-000000000011');
    insert into users values('00000000-0000-4000-8000-000000000002','Admin web','admin@example.test','0990000001','ACTIVE',null,'00000000-0000-4000-8000-000000000022');
    insert into mobile_account_roles values('00000000-0000-4000-8000-000000000001','PASSENGER');`);
  await registerMobileAdminAccessRoutes(app);await app.ready();
});
afterAll(async()=>{await app.close();await pg.close();});

describe('autorización administrativa móvil independiente',()=>{
  it('oculta y rechaza el módulo cuando el panel web no concedió acceso',async()=>{
    const access=await app.inject({url:'/v1/mobile-admin/access',headers:{authorization:'Bearer mobile'}});
    expect(access.statusCode).toBe(200);expect(access.json()).toMatchObject({authorized:false});
    expect((await app.inject({method:'POST',url:'/v1/mobile-admin/session',headers:{authorization:'Bearer mobile'}})).statusCode).toBe(403);
  });
  it('concede y revoca desde web, emite sesión limitada y deja auditoría',async()=>{
    const grant=await app.inject({method:'PUT',url:'/v1/admin/mobile-access/users/00000000-0000-4000-8000-000000000001',headers:{authorization:'Bearer web-admin'},payload:{enabled:true,role:'MOBILE_OPERATIONS_ADMIN',reason:'Operación territorial autorizada'}});
    expect(grant.statusCode,grant.body).toBe(200);
    expect((await app.inject({url:'/v1/mobile-admin/access',headers:{authorization:'Bearer mobile'}})).json()).toMatchObject({authorized:true,role:'MOBILE_OPERATIONS_ADMIN'});
    const session=await app.inject({method:'POST',url:'/v1/mobile-admin/session',headers:{authorization:'Bearer mobile'}});
    expect(session.statusCode,session.body).toBe(200);expect(session.json().token).toContain('MOBILE_ADMIN');
    expect(session.json().modules).toContain('dispatch');
    const revoke=await app.inject({method:'PUT',url:'/v1/admin/mobile-access/users/00000000-0000-4000-8000-000000000001',headers:{authorization:'Bearer web-admin'},payload:{enabled:false,role:'MOBILE_OPERATIONS_ADMIN',reason:'Finalizó la autorización temporal'}});
    expect(revoke.statusCode,revoke.body).toBe(200);
    expect((await app.inject({method:'POST',url:'/v1/mobile-admin/session',headers:{authorization:'Bearer mobile'}})).statusCode).toBe(403);
    const audits=await pg.query<any>('select action,next_value from audit_log order by action');
    expect(audits.rows.map(row=>row.action)).toContain('MOBILE_ADMIN_ACCESS_GRANTED');
    expect(audits.rows.map(row=>row.action)).toContain('MOBILE_ADMIN_ACCESS_REVOKED');
  });
  it('separa las cuentas autorizadas de los candidatos y expone el historial',async()=>{
    const authorized=await app.inject({url:'/v1/admin/mobile-access/users?scope=authorized',headers:{authorization:'Bearer web-admin'}});
    expect(authorized.statusCode,authorized.body).toBe(200);expect(authorized.json()).toEqual([]);
    const candidates=await app.inject({url:'/v1/admin/mobile-access/users?scope=candidates&search=oper',headers:{authorization:'Bearer web-admin'}});
    expect(candidates.statusCode,candidates.body).toBe(200);expect(candidates.json()).toHaveLength(1);
    await app.inject({method:'PUT',url:'/v1/admin/mobile-access/users/00000000-0000-4000-8000-000000000001',headers:{authorization:'Bearer web-admin'},payload:{enabled:true,role:'SUPER_ADMIN',reason:'Acceso territorial de supervisión'}});
    expect((await app.inject({url:'/v1/admin/mobile-access/users?scope=authorized',headers:{authorization:'Bearer web-admin'}})).json()).toMatchObject([{name:'Operador',enabled:true,role:'SUPER_ADMIN'}]);
    expect((await app.inject({url:'/v1/admin/mobile-access/users?scope=candidates&search=oper',headers:{authorization:'Bearer web-admin'}})).json()).toEqual([]);
    const history=await app.inject({url:'/v1/admin/mobile-access/history',headers:{authorization:'Bearer web-admin'}});
    expect(history.statusCode,history.body).toBe(200);expect(history.json()[0]).toMatchObject({userName:'Operador',actorName:'Admin web',action:'MOBILE_ADMIN_ACCESS_GRANTED'});
  });
});
