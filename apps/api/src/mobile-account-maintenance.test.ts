import {beforeAll,beforeEach,afterAll,describe,expect,it,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {createHash} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
const state=vi.hoisted(()=>({sql:null as any}));
vi.mock('./database.js',()=>({database:()=>state.sql}));
import {deleteIncompleteDriver,mobileIdentitySchema,incompleteAccountDeletionSchema,updateMobileIdentity} from './mobile-account-maintenance.js';
import {buildApp} from './app.js';

const id='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003';
let pg:PGlite;
let app:FastifyInstance;
function sqlFor(client:any):any {
  const sql=(parts:any,...values:any[]):any=>{
    if(!parts.raw)return {list:parts};
    const params:any[]=[];let query=parts[0];
    for(let i=0;i<values.length;i++){
      const value=values[i];
      if(value&&Array.isArray(value.list))query+='('+value.list.map((v:any)=>{params.push(v);return '$'+params.length;}).join(',')+')';
      else {params.push(value);query+='$'+params.length;}
      query+=parts[i+1];
    }
    return client.query(query,params).then((r:any)=>r.rows);
  };
  return Object.assign(sql,{begin:(fn:any)=>client.transaction((tx:any)=>fn(sqlFor(tx)))});
}
beforeAll(async()=>{
  pg=new PGlite();state.sql=sqlFor(pg);
  // Hash stubs are confined to this database fixture; production uses pgcrypto.
  await pg.exec(`create function gen_salt(text) returns text language sql as $$ select 'test-salt'::text $$;
    create function crypt(text,text) returns text language sql as $$ select md5($1||$2) $$;
    create type account_status as enum ('PENDING','ACTIVE','SUSPENDED','REJECTED');
    create table users(id uuid primary key,full_name text,email text,phone_e164 text unique,role text,status account_status,
      deleted_at timestamptz,email_verified_at timestamptz,phone_verified_at timestamptz,active_session_id uuid,
      password_hash text,profile_photo_data bytea,profile_photo_mime text,profile_photo_updated_at timestamptz,
      cooperative_id uuid,updated_at timestamptz,last_mobile_role text,must_change_password boolean default false,
      passenger_cancellation_count int default 0,passenger_cancellation_suspended boolean default false);
    create unique index users_email_lower_idx on users(lower(email));
    create table drivers(user_id uuid primary key references users(id),approval_status text,approved_at timestamptz,is_available boolean,last_location text,last_location_at timestamptz);
    create table vehicles(id uuid primary key default gen_random_uuid(),driver_id uuid references users(id),identifier text);
    create table trips(id uuid primary key default gen_random_uuid(),passenger_id uuid references users(id),driver_id uuid references users(id),status text);
    create table driver_memberships(id uuid primary key default gen_random_uuid(),driver_id uuid references users(id));
    create table membership_payment_orders(id uuid primary key default gen_random_uuid(),driver_id uuid references users(id));
    create table audit_log(actor_id uuid,action text,entity_type text,entity_id text,previous_value jsonb,next_value jsonb,reason text,created_at timestamptz default now());
    create table device_tokens(user_id uuid references users(id));
    create table biometric_credentials(user_id uuid references users(id));
    create table email_verification_codes(id uuid primary key default gen_random_uuid(),user_id uuid references users(id),code_hash text,expires_at timestamptz,used_at timestamptz,created_at timestamptz default now(),attempts int default 0);
    create table password_reset_tokens(id uuid primary key default gen_random_uuid(),user_id uuid references users(id),code_hash text,expires_at timestamptz,used_at timestamptz,created_at timestamptz default now(),attempts int default 0);
    create table mobile_account_roles(user_id uuid references users(id),role text);
    create table account_deletion_requests(user_id uuid references users(id),expires_at timestamptz,completed_at timestamptz);
    create table user_service_area_access(user_id uuid references users(id));
    create table driver_documents(driver_id uuid references users(id),file_url text);
    create table driver_approval_reviews(driver_id uuid references users(id),decision text);
  `);
  app=await buildApp();
},30000);
beforeEach(async()=>{
  await pg.exec('truncate users,audit_log cascade');
  await pg.query(`insert into users(id,full_name,email,phone_e164,role,status,email_verified_at,phone_verified_at,active_session_id,password_hash) values
    ($1,'Conductor de prueba','registro@gimal.test','+593991234567','DRIVER','PENDING',null,now(),gen_random_uuid(),'previous-hash'),
    ($2,'Administrador','admin@example.test','+593991234568','ADMIN','ACTIVE',now(),now(),null,'admin-hash'),
    ($3,'Otra cuenta','otra@example.test','0991234569','PASSENGER','ACTIVE',now(),now(),null,'other-hash')`,[id,actor,other]);
  await pg.query("insert into drivers(user_id,approval_status,is_available) values($1,'PENDIENTE_DOCUMENTOS',true)",[id]);
  await pg.query("insert into mobile_account_roles(user_id,role) values($1,'DRIVER')",[id]);
  await pg.query("insert into vehicles(driver_id,identifier) values($1,'TEST-123')",[id]);
  for(const table of ['device_tokens','biometric_credentials','email_verification_codes','password_reset_tokens','user_service_area_access'])await pg.query(`insert into ${table}(user_id) values($1)`,[id]);
  await pg.query("insert into account_deletion_requests(user_id,expires_at) values($1,now()+interval '1 day')",[id]);
  await pg.query("insert into driver_documents(driver_id,file_url) values($1,'private-document')",[id]);
  await pg.query("insert into driver_approval_reviews(driver_id,decision) values($1,'REQUEST_CORRECTIONS')",[id]);
});
afterAll(async()=>{await app.close();await pg.close();});
function edit(overrides:Record<string,unknown>={}){return mobileIdentitySchema.parse({name:'Nombre corregido',email:'registro@example.test',phone:'0991234567',reason:'Confirmado con el titular',expectedEmail:'registro@gimal.test',...overrides});}
const deletion={reason:'Registro incompleto duplicado',confirmation:'ELIMINAR' as const,expectedEmail:'registro@gimal.test'};
const account=async()=>(await pg.query<any>('select * from users where id=$1',[id])).rows[0]!;
describe('mantenimiento seguro de cuentas móviles',()=>{
  it('corrige correo, revoca accesos y registra antes/después sin aprobar al conductor',async()=>{
    expect(await updateMobileIdentity(id,edit(),actor)).toMatchObject({updated:true,emailVerificationRequired:true,sessionRevoked:true});
    expect(await account()).toMatchObject({full_name:'Nombre corregido',email:'registro@example.test',phone_e164:'+593991234567',status:'PENDING',email_verified_at:null,active_session_id:null,password_hash:'previous-hash'});
    for(const table of ['device_tokens','biometric_credentials','email_verification_codes','password_reset_tokens'])expect((await pg.query(`select * from ${table}`)).rows).toHaveLength(0);
    expect((await pg.query('select * from account_deletion_requests where expires_at>now()')).rows).toHaveLength(0);
    expect((await pg.query<any>('select approval_status,is_available from drivers')).rows[0]).toEqual({approval_status:'PENDIENTE_DOCUMENTOS',is_available:false});
    const audit=(await pg.query<any>('select * from audit_log')).rows[0];
    expect(audit).toMatchObject({actor_id:actor,action:'MOBILE_ACCOUNT_IDENTITY_UPDATED',reason:'Confirmado con el titular'});
    expect(audit.previous_value.email).toBe('registro@gimal.test');expect(audit.next_value.email).toBe('registro@example.test');expect(JSON.stringify(audit)).not.toContain('previous-hash');
  });
  it('permite editar pasajero y no cambia suspensión ni contador',async()=>{
    await pg.query("update users set role='PASSENGER',status='SUSPENDED',email_verified_at=now(),passenger_cancellation_count=6,passenger_cancellation_suspended=true where id=$1",[id]);
    await updateMobileIdentity(id,edit(),actor);
    expect(await account()).toMatchObject({status:'SUSPENDED',passenger_cancellation_count:6,passenger_cancellation_suspended:true,email_verified_at:null});
  });
  it('editar solo nombre conserva correo verificado y sesión',async()=>{
    await pg.query('update users set email_verified_at=now() where id=$1',[id]);const previous=await account();
    await updateMobileIdentity(id,edit({email:'registro@gimal.test'}),actor);
    expect((await account()).email_verified_at).toEqual(previous.email_verified_at);expect((await account()).active_session_id).toBe(previous.active_session_id);
  });
  it('rechaza duplicados entre roles y teléfonos con formato local',async()=>{
    await expect(updateMobileIdentity(id,edit({email:' ADMIN@example.test '}),actor)).rejects.toThrow('EMAIL_ALREADY_EXISTS');
    await expect(updateMobileIdentity(id,edit({phone:'+593991234569'}),actor)).rejects.toThrow('PHONE_ALREADY_EXISTS');
    expect((await account()).email).toBe('registro@gimal.test');expect((await pg.query('select * from audit_log')).rows).toHaveLength(0);
  });
  it('bloquea editar mientras existe un viaje y rechaza una vista obsoleta',async()=>{
    await expect(updateMobileIdentity(id,edit({expectedEmail:'antiguo@example.test'}),actor)).rejects.toThrow('ACCOUNT_CHANGED_REFRESH');
    await pg.query("insert into trips(passenger_id,driver_id,status) values($1,$2,'DRIVER_EN_ROUTE')",[other,id]);
    await expect(updateMobileIdentity(id,edit(),actor)).rejects.toThrow('ACCOUNT_HAS_ACTIVE_TRIP');
  });
  it('no permite modificar cuentas administrativas por el endpoint móvil',async()=>{
    await expect(updateMobileIdentity(actor,edit({expectedEmail:'admin@example.test'}),actor)).rejects.toThrow('MOBILE_ACCOUNT_NOT_FOUND');
  });
  it('anonimiza una sola vez, libera correo/teléfono y conserva documentos y auditoría',async()=>{
    expect(await deleteIncompleteDriver(id,deletion,actor)).toEqual({deleted:true,replay:false});
    expect(await deleteIncompleteDriver(id,deletion,actor)).toEqual({deleted:true,replay:true});
    expect(await account()).toMatchObject({full_name:'Cuenta eliminada',email:`deleted+${id}@deleted.invalid`,phone_e164:`deleted:${id}`,status:'SUSPENDED',active_session_id:null});
    expect((await account()).deleted_at).toBeTruthy();expect((await account()).password_hash).not.toBe('previous-hash');
    expect((await pg.query('select * from driver_documents')).rows).toHaveLength(1);expect((await pg.query('select * from driver_approval_reviews')).rows).toHaveLength(1);
    expect((await pg.query('select * from audit_log')).rows).toHaveLength(1);
    await pg.query("insert into users(id,email,phone_e164) values(gen_random_uuid(),'registro@gimal.test','+593991234567')");
    await expect(updateMobileIdentity(id,edit(),actor)).rejects.toThrow('MOBILE_ACCOUNT_NOT_FOUND');
  });
  it('serializa dos eliminaciones concurrentes con una sola auditoría',async()=>{
    const results=await Promise.all([deleteIncompleteDriver(id,deletion,actor),deleteIncompleteDriver(id,deletion,actor)]);
    expect(results.filter(r=>r.replay)).toHaveLength(1);expect((await pg.query('select * from audit_log')).rows).toHaveLength(1);
  });
  for(const table of ['trips','driver_memberships','membership_payment_orders'])it(`protege historial de ${table}`,async()=>{
    await pg.query(`insert into ${table}(driver_id) values($1)`,[id]);
    await expect(deleteIncompleteDriver(id,deletion,actor)).rejects.toThrow('ACCOUNT_HAS_OPERATIONAL_HISTORY');expect((await account()).deleted_at).toBeNull();
  });
  it('protege conductores aprobados aunque posteriormente fueron rechazados',async()=>{
    await pg.query("update drivers set approval_status='RECHAZADO',approved_at=now() where user_id=$1",[id]);
    await expect(deleteIncompleteDriver(id,deletion,actor)).rejects.toThrow('ACCOUNT_NOT_INCOMPLETE');
  });
  it('validación estricta no permite inyectar estado/verificación ni omitir confirmación',()=>{
    expect(()=>edit({status:'ACTIVE'})).toThrow();expect(()=>edit({emailVerifiedAt:'2026-08-27'})).toThrow();
    expect(()=>edit({phone:'abc'})).toThrow();expect(()=>edit({email:'sin-correo'})).toThrow();
    expect(()=>incompleteAccountDeletionSchema.parse({...deletion,confirmation:'si'})).toThrow();
  });
});

describe('verificación y recuperación después de una corrección',()=>{
  async function code(table:string,email='registro@gimal.test') {
    const hash=createHash('sha256').update(`${process.env.ADMIN_SESSION_SECRET??'costa-go-local-development'}:${email}:123456`).digest('hex');
    await pg.query(`insert into ${table}(user_id,code_hash,expires_at) values($1,$2,now()+interval '15 minutes')`,[id,hash]);
  }
  it('el código correcto verifica una cuenta pendiente una sola vez',async()=>{
    await code('email_verification_codes');
    const input={method:'POST' as const,url:'/v1/auth/email-verification/confirm',payload:{email:'registro@gimal.test',code:'123456'}};
    expect((await app.inject(input)).statusCode).toBe(200);
    expect((await account()).status).toBe('ACTIVE');
    expect((await app.inject(input)).statusCode).toBe(400);
  });
  it('el correo corregido exige un código nuevo y no acepta códigos del anterior',async()=>{
    await code('email_verification_codes');await code('password_reset_tokens');
    await updateMobileIdentity(id,edit(),actor);
    expect((await app.inject({method:'POST',url:'/v1/auth/email-verification/confirm',payload:{email:'registro@gimal.test',code:'123456'}})).statusCode).toBe(400);
    expect((await app.inject({method:'POST',url:'/v1/auth/password-reset/confirm',payload:{email:'registro@gimal.test',code:'123456',password:'NuevoPassword123!'}})).statusCode).toBe(400);
    await code('email_verification_codes','registro@example.test');
    expect((await app.inject({method:'POST',url:'/v1/auth/email-verification/confirm',payload:{email:'registro@example.test',code:'123456'}})).statusCode).toBe(200);
    expect((await account()).email_verified_at).toBeTruthy();
  });
  it('verificar el correo no levanta una suspensión ni crea una sesión válida',async()=>{
    await pg.query("update users set status='SUSPENDED' where id=$1",[id]);await code('email_verification_codes');
    expect((await app.inject({method:'POST',url:'/v1/auth/email-verification/confirm',payload:{email:'registro@gimal.test',code:'123456'}})).statusCode).toBe(403);
    expect(await account()).toMatchObject({status:'SUSPENDED',active_session_id:null});
  });
  it('restablecer contraseña tampoco reactiva una cuenta suspendida',async()=>{
    await pg.query("update users set status='SUSPENDED' where id=$1",[id]);await code('password_reset_tokens');
    const input={method:'POST' as const,url:'/v1/auth/password-reset/confirm',payload:{email:'registro@gimal.test',code:'123456',password:'NuevoPassword123!'}};
    expect((await app.inject(input)).statusCode).toBe(200);expect((await account()).status).toBe('SUSPENDED');
    expect((await app.inject(input)).statusCode).toBe(400);
  });
});
