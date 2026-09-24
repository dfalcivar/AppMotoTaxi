import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import Fastify,{type FastifyInstance} from 'fastify';
import {PGlite} from '@electric-sql/pglite';

const state=vi.hoisted(()=>({sql:null as any}));
vi.mock('./database.js',()=>({database:()=>state.sql}));
import {registerAdminRoutes,tokenFor} from './admin.js';

const owner='00000000-0000-4000-8000-000000000001';
const member='00000000-0000-4000-8000-000000000002';

describe('administración de roles configurables',()=>{
  let pg:PGlite,app:FastifyInstance,token:string;
  beforeAll(async()=>{
    vi.stubEnv('DATABASE_URL','postgres://test');
    pg=new PGlite();
    await pg.exec(`create table users(id uuid primary key,role text not null,full_name text,email text,
      deleted_at timestamptz,active_session_id uuid);
      insert into users(id,role,full_name,email) values
      ('${owner}','SUPER_ADMIN','Super Administrador','super@example.test'),
      ('${member}','ADMIN_OPERACIONES','Operador','operador@example.test');
      create table admin_sessions(id uuid primary key,user_id uuid,token_hash text,expires_at timestamptz,revoked_at timestamptz);
      create table audit_log(actor_id uuid,action text,entity_type text,entity_id text,next_value jsonb,reason text);`);
    await pg.exec(await readFile(resolve('migrations/099_configurable_admin_roles.sql'),'utf8'));
    const sql:any=(parts:TemplateStringsArray,...values:unknown[])=>pg.query(
      parts.reduce((statement,part,index)=>statement+(index?'$'+index:'')+part,''),values).then(result=>result.rows);
    sql.begin=async(callback:(query:any)=>Promise<unknown>)=>{
      await pg.exec('begin');try{const value=await callback(sql);await pg.exec('commit');return value;}
      catch(error){await pg.exec('rollback');throw error;}
    };
    state.sql=sql;
    token=tokenFor({id:owner,email:'super@example.test',name:'Super Administrador',role:'SUPER_ADMIN',
      sessionId:'10000000-0000-4000-8000-000000000001',permissions:['roles:manage'],expiresAt:Date.now()+3600000});
    await pg.query(`insert into admin_sessions(id,user_id,token_hash,expires_at)
      values($1,$2,$3,now()+interval '1 hour')`,
      ['10000000-0000-4000-8000-000000000001',owner,createHash('sha256').update(token).digest('hex')]);
    app=Fastify({logger:false});await registerAdminRoutes(app);await app.ready();
  });
  afterAll(async()=>{await app.close();await pg.close();vi.unstubAllEnvs();});
  it('crea, consulta y modifica un rol; revoca sesiones de sus miembros',async()=>{
    const headers={authorization:`Bearer ${token}`};
    const created=await app.inject({method:'POST',url:'/v1/admin/access/custom-roles',headers,
      payload:{name:'Revisión piloto',description:'Revisa conductores',enabled:true,
        permissions:['drivers:view','drivers:reject']}});
    expect(created.statusCode,created.body).toBe(201);
    const id=created.json().id;
    const listed=await app.inject({method:'GET',url:'/v1/admin/access/custom-roles',headers});
    expect(listed.statusCode,listed.body).toBe(200);
    expect(listed.json()).toEqual(expect.arrayContaining([expect.objectContaining({id,name:'Revisión piloto'})]));
    await pg.query('update users set admin_custom_role_id=$1 where id=$2',[id,member]);
    await pg.query(`insert into admin_sessions(id,user_id,token_hash,expires_at)
      values('10000000-0000-4000-8000-000000000002',$1,'member',now()+interval '1 hour')`,[member]);
    const updated=await app.inject({method:'PUT',url:`/v1/admin/access/custom-roles/${id}`,headers,
      payload:{name:'Revisión piloto',description:'Rol ajustado',enabled:false,permissions:['drivers:view']}});
    expect(updated.statusCode,updated.body).toBe(200);
    const session=await pg.query<{revoked_at:string|null}>("select revoked_at from admin_sessions where token_hash='member'");
    expect(session.rows[0]?.revoked_at).not.toBeNull();
    const audit=await pg.query<{action:string}>('select action from audit_log order by action');
    expect(audit.rows.map(row=>row.action)).toEqual(['ADMIN_ROLE_CREATED','ADMIN_ROLE_UPDATED']);
  });
  it('impide otorgar permisos reservados a un rol configurable',async()=>{
    const response=await app.inject({method:'POST',url:'/v1/admin/access/custom-roles',
      headers:{authorization:`Bearer ${token}`},
      payload:{name:'Escalado',description:'',enabled:true,permissions:['roles:manage']}});
    expect(response.statusCode).toBe(400);
  });
});
