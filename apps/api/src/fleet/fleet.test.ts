import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const state=vi.hoisted(()=>({sql:null as any}));
vi.mock('../database.js',()=>({database:()=>state.sql}));
vi.mock('../push.js',()=>({sendPush:vi.fn(async()=>({sent:1,skipped:false}))}));
import * as fleet from './service.js';
import {prepareVehicleFile,uploadVehicleFile,readVehicleFile} from './files.js';
import {fleetReport,fleetReportOptions} from './reports.js';
import {registerFleetRoutes} from './routes.js';
import {deliverFleetNotifications} from './notifications.js';
import {sendPush} from '../push.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import {tokenFor} from '../admin.js';
import sharp from 'sharp';
let pg:PGlite;
const ids={admin:'00000000-0000-4000-8000-000000000001',driver:'00000000-0000-4000-8000-000000000002',
  other:'00000000-0000-4000-8000-000000000003',owner:'00000000-0000-4000-8000-000000000004',
  coop:'00000000-0000-4000-8000-000000000005',coop2:'00000000-0000-4000-8000-000000000006'};
const admin={id:ids.admin,admin:true},driver={id:ids.driver},other={id:ids.other},owner={id:ids.owner};
const input={identifier:'MT-20',brand:'Bajaj',model:'RE',color:'Azul',unitNumber:'020',declaredOwnerName:'Propietaria declarada',maximumPassengers:3,relationType:'AUTHORIZED_DRIVER'};
function sqlFor(client:any):any{
  const sql=(parts:TemplateStringsArray,...values:any[])=>{
    const fragment={parts,values,then(resolve:any,reject:any){const args:any[]=[];
      const compile=(f:any):string=>f.parts.reduce((s:string,p:string,i:number)=>{
        if(!i)return p;const v=f.values[i-1];return s+(v?.parts?compile(v):(args.push(v),'$'+args.length))+p;
      },'');return client.query(compile(fragment),args).then((r:any)=>r.rows).then(resolve,reject);
    }};return fragment;
  };
  return Object.assign(sql,{begin:(fn:any)=>client.transaction((tx:any)=>fn(sqlFor(tx)))});
}
beforeAll(async()=>{
  pg=new PGlite();state.sql=sqlFor(pg);
  await pg.exec(`create table cooperatives(id uuid primary key,name text);
    create table users(id uuid primary key,full_name text,email text,cooperative_id uuid references cooperatives(id),status text default 'ACTIVE',deleted_at timestamptz);
    create table drivers(user_id uuid primary key references users(id),is_available boolean default false,approval_status text default 'APROBADO');
    create table vehicles(id uuid primary key default gen_random_uuid(),driver_id uuid not null references drivers(user_id),identifier text unique not null,
      maximum_passengers smallint not null,status text default 'PENDING',created_at timestamptz default now(),brand text,model text,model_year integer,notes text);
    create table trips(id uuid primary key default gen_random_uuid(),driver_id uuid references drivers(user_id),passenger_id uuid references users(id),
      vehicle_id uuid references vehicles(id),status text default 'SEARCHING',quoted_total_cents int default 100,final_total_cents int,distance_meters numeric);
    create table trip_events(id bigserial primary key,trip_id uuid references trips(id),actor_id uuid,from_status text,to_status text);
    create table driver_offers(id uuid primary key default gen_random_uuid(),trip_id uuid references trips(id),driver_id uuid references drivers(user_id),offered_at timestamptz default now());
  `);
  await pg.exec(await readFile(fileURLToPath(new URL('../../migrations/073_vehicle_fleet.sql',import.meta.url)),'utf8'));
  await pg.exec(await readFile(fileURLToPath(new URL('../../migrations/074_vehicle_session_integrity.sql',import.meta.url)),'utf8'));
},30000);
beforeEach(async()=>{
  vi.mocked(sendPush).mockClear();
  await pg.exec('truncate vehicle_audit,vehicle_ownership_claims,vehicle_qr_tokens,vehicle_session_assignments,trip_events,trips,driver_vehicle_sessions,user_vehicle_relations,vehicle_files,vehicles,drivers,users,cooperatives cascade');
  await pg.query('insert into cooperatives values($1,$2),($3,$4)',[ids.coop,'Cooperativa uno',ids.coop2,'Cooperativa dos']);
  for(const [name,id]of Object.entries(ids).filter(([key])=>!key.startsWith('coop')))await pg.query('insert into users(id,full_name,email,cooperative_id) values($1,$2,$3,$4)',[id,name,`${name}@example.test`,ids.coop]);
  await pg.query('insert into drivers(user_id) values($1),($2)',[ids.driver,ids.other]);
  await pg.exec('update fleet_settings set heartbeat_seconds=30,offline_seconds=180,auto_release_seconds=900,owner_notifications=false');
});
afterAll(async()=>{await pg.close();});
async function unit(identifier='MT-20'){
  const {id}=await fleet.requestVehicle(driver,{...input,identifier});
  const bytes=await sharp({create:{width:20,height:10,channels:3,background:'blue'}}).png().toBuffer();
  await uploadVehicleFile(admin,id,{kind:'PHOTO',mimeType:'image/png',data:bytes.toString('base64')});
  await fleet.setVehicleStatus(admin,id,'VERIFIED','Documentación verificada');
  await fleet.setRelation(admin,id,ids.driver,'AUTHORIZED_DRIVER','APPROVED','Conductor autorizado');
  await fleet.setRelation(admin,id,ids.other,'AUTHORIZED_DRIVER','APPROVED','Conductor autorizado');
  return id;
}
async function trip(driverId=ids.driver){
  const row=await pg.query<any>("insert into trips(passenger_id,driver_id,status,distance_meters) values($1,$2,'DRIVER_EN_ROUTE',2500) returning *",[ids.owner,driverId]);
  return row.rows[0];
}
describe('fleet real SQL integration',()=>{
  it('links an existing identifier idempotently without requiring invented vehicle data',async()=>{
    const {id}=await fleet.requestVehicle(driver,input);
    for(let n=0;n<2;n++)expect((await fleet.requestExistingVehicle(other,{identifier:'mt 20',relationType:'AUTHORIZED_DRIVER'})).id).toBe(id);
    expect((await pg.query('select * from vehicles')).rows).toHaveLength(1);
    expect((await pg.query('select * from user_vehicle_relations where user_id=$1',[ids.other])).rows).toHaveLength(1);
    await expect(fleet.requestExistingVehicle(other,{identifier:'NOT-FOUND'})).rejects.toThrow('VEHICLE_NOT_FOUND');
  });
  it('HTTP flow registers, authorizes, confirms, heartbeats and releases a unit with friendly errors',async()=>{
    const app=Fastify();await registerFleetRoutes(app,async()=>({id:ids.driver,email:'driver@example.test',name:'Driver',role:'DRIVER'}));
    const headers={authorization:`Bearer ${tokenFor({id:ids.admin,email:'admin@example.test',name:'Admin',role:'ADMIN'})}`};
    const create=await app.inject({method:'POST',url:'/v1/fleet/vehicles',payload:input});expect(create.statusCode).toBe(200);const id=create.json().id;
    const bytes=await sharp({create:{width:20,height:10,channels:3,background:'blue'}}).png().toBuffer();
    expect((await app.inject({method:'POST',url:`/v1/fleet/vehicles/${id}/files`,payload:{kind:'PHOTO',mimeType:'image/png',data:bytes.toString('base64')}})).statusCode).toBe(200);
    expect((await app.inject({method:'PUT',url:`/v1/admin/fleet/vehicles/${id}/status`,headers,payload:{status:'VERIFIED',reason:'Prueba completa de revisión'}})).statusCode).toBe(200);
    expect((await app.inject({method:'PUT',url:`/v1/admin/fleet/vehicles/${id}/relations`,headers,payload:{userId:ids.driver,type:'AUTHORIZED_DRIVER',status:'APPROVED',reason:'Prueba completa de autorización'}})).statusCode).toBe(200);
    const qr=await app.inject({method:'POST',url:`/v1/admin/fleet/vehicles/${id}/qr`,headers,payload:{}});expect(qr.statusCode).toBe(200);expect(qr.json().svg).toContain('<svg');
    const selected=await app.inject({method:'POST',url:'/v1/fleet/session',payload:{vehicleId:id,method:'QR_SCAN'}});expect(selected.statusCode).toBe(200);const session=selected.json().sessionId;
    expect((await app.inject({method:'POST',url:`/v1/fleet/sessions/${session}/heartbeat`,payload:{}})).statusCode).toBe(200);
    await trip();const blocked=await app.inject({method:'POST',url:`/v1/fleet/sessions/${session}/release`,payload:{}});expect(blocked.statusCode).toBe(409);expect(blocked.json().message).toContain('carrera activa');expect(blocked.body).not.toContain('SELECT');
    await pg.exec("update trips set status='COMPLETED'");expect((await app.inject({method:'POST',url:`/v1/fleet/sessions/${session}/release`,payload:{}})).statusCode).toBe(200);
    expect((await app.inject({url:'/v1/fleet/session'})).json().session).toBeNull();await app.close();
  });
  it('only the creator can complete an unapproved draft photo',async()=>{
    const {id}=await fleet.requestVehicle(driver,input);await fleet.requestVehicle(other,input);
    const bytes=await sharp({create:{width:10,height:10,channels:3,background:'blue'}}).png().toBuffer();
    const photo={kind:'PHOTO',mimeType:'image/png',data:bytes.toString('base64')};
    await expect(uploadVehicleFile(other,id,photo)).rejects.toThrow('VEHICLE_FORBIDDEN');
    await uploadVehicleFile(driver,id,photo);
    expect((await fleet.fleetDetail(driver,id)).canUpload).toBe(true);
    expect((await fleet.fleetDetail(other,id)).canUpload).toBe(false);
  });
  it('a fresh confirmation starts a new session after expiry without reviving history',async()=>{
    const id=await unit();const old=await fleet.startSession(driver,id);
    await pg.exec("update driver_vehicle_sessions set last_heartbeat=now()-interval '1 hour'");
    expect((await fleet.currentSession(driver)).lastEnded?.reason).toBe('AUTO_RELEASE');
    const next=await fleet.startSession(driver,id);expect(next.sessionId).not.toBe(old.sessionId);
    expect((await pg.query<any>('select status from driver_vehicle_sessions where id=$1',[old.sessionId])).rows[0].status).toBe('ENDED');
  });
  it.runIf(process.env.FLEET_UI_QA==='true')('local browser fixture',async()=>{
    const id=await unit();await unit('MT-21');await fleet.setRelation(admin,id,ids.owner,'OWNER_MANAGER','APPROVED','Responsable validado');
    await fleet.startSession(driver,id);await trip();
    const app=Fastify();await app.register(cors,{origin:['http://127.0.0.1:3314','http://localhost:3314','http://127.0.0.1:3315'],methods:['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']});
    await registerFleetRoutes(app,async()=>({id:ids.driver,email:'driver@example.test',name:'Conductor de prueba',role:'DRIVER'}));
    app.get('/qa/session',async()=>({token:tokenFor({id:ids.admin,email:'admin@example.test',name:'Administrador de pruebas',role:'ADMIN'})}));
    let finish:()=>void=()=>{};const finished=new Promise<void>(resolve=>{finish=resolve;});
    app.post('/qa/finish',async()=>{setTimeout(finish,100);return {done:true};});
    await app.listen({host:'127.0.0.1',port:3313});await finished;
    await app.close();
  },900000);
  it('report filters operate on real sessions without exposing unrelated units',async()=>{
    const id=await unit();await fleet.setRelation(admin,id,ids.owner,'OWNER_MANAGER','APPROVED','Responsable validado');
    await fleet.startSession(driver,id);const t=await trip();await pg.query("update trips set status='COMPLETED',final_total_cents=250 where id=$1",[t.id]);
    const report=await fleetReport(owner,{});expect(report.summary).toMatchObject({activeUnits:1,activeDrivers:1,completed:1});
    expect(Number(report.summary!.totalCents)).toBe(250);expect(report.items).toHaveLength(1);
    expect((await fleetReport(owner,{driverId:ids.other})).items).toHaveLength(0);
    expect((await fleetReport({...admin,cooperativeId:ids.coop2},{})).summary!.totalUnits).toBe(0);
    expect((await fleetReportOptions(owner)).drivers).toHaveLength(2);
    expect((await fleetReportOptions({...admin,cooperativeId:ids.coop2})).drivers).toHaveLength(0);
    expect((await fleetReportOptions(owner,'other')).drivers.map((d:any)=>d.id)).toEqual([ids.other]);
  });
  it.each(['ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS','INCIDENT'])('never releases a unit during %s, even after a lost connection',async status=>{
    const id=await unit();const s=await fleet.startSession(driver,id);const t=await trip();await pg.query('update trips set status=$1 where id=$2',[status,t.id]);
    await pg.exec("update driver_vehicle_sessions set last_heartbeat=now()-interval '1 day'");
    expect(await fleet.releaseStaleSessions()).toBe(0);await expect(fleet.releaseSession(driver,s.sessionId)).rejects.toThrow('VEHICLE_HAS_ACTIVE_TRIP');
  });
  it('handles simultaneous selection with only one winner',async()=>{
    const id=await unit();const results=await Promise.allSettled([fleet.startSession(driver,id),fleet.startSession(other,id)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await pg.query("select * from driver_vehicle_sessions where status='ACTIVE'")).rows).toHaveLength(1);
  });
  it('pause preserves the unit while logout releases it without changing relations',async()=>{
    const id=await unit();const s=await fleet.startSession(driver,id);await pg.query('update drivers set is_available=false where user_id=$1',[ids.driver]);
    expect((await fleet.currentSession(driver)).session?.id).toBe(s.sessionId);
    await fleet.releaseSession(driver,s.sessionId,'LOGOUT');expect((await fleet.currentSession(driver)).session).toBeNull();
    expect((await pg.query("select * from user_vehicle_relations where status='APPROVED'")).rows).toHaveLength(2);
  });
  it('supports three units and three drivers without duplicate ownership or sessions',async()=>{
    await pg.query('insert into drivers(user_id) values($1)',[ids.owner]);const id=await unit();await unit('MT-21');await unit('MT-22');
    await fleet.setRelation(admin,id,ids.owner,'OWNER_MANAGER','APPROVED','Responsable validado');await fleet.setRelation(admin,id,ids.owner,'AUTHORIZED_DRIVER','APPROVED','Conductor validado');
    expect(await fleet.listVehicles(driver)).toHaveLength(3);await fleet.startSession(owner,id);
    expect((await fleet.fleetDetail(owner,id)).relations.filter((r:any)=>r.type==='AUTHORIZED_DRIVER')).toHaveLength(3);
  });
  it('migration merges legacy aliases, keeps original trip identity and never grants ownership',async()=>{
    const legacy=new PGlite();try{
      await legacy.exec(`create table cooperatives(id uuid primary key);create table users(id uuid primary key,cooperative_id uuid,status text,deleted_at timestamptz);
        create table drivers(user_id uuid primary key references users(id),approval_status text,is_available boolean);
        create table vehicles(id uuid primary key default gen_random_uuid(),driver_id uuid not null references drivers(user_id),identifier text not null,status text,created_at timestamptz default now(),brand text,model text);
        create table trips(id uuid primary key default gen_random_uuid(),vehicle_id uuid references vehicles(id),driver_id uuid,status text);
        insert into users(id,status) values('${ids.driver}','ACTIVE'),('${ids.other}','ACTIVE');
        insert into drivers values('${ids.driver}','APROBADO',false),('${ids.other}','APROBADO',false);
        insert into vehicles(driver_id,identifier,status) values('${ids.driver}','MT-2','ACTIVE'),('${ids.other}','mt 2','ACTIVE');
        insert into trips(vehicle_id,driver_id,status) select id,driver_id,'COMPLETED' from vehicles;
        insert into trips(status) values('CANCELLED');`);
      await legacy.exec(await readFile(fileURLToPath(new URL('../../migrations/073_vehicle_fleet.sql',import.meta.url)),'utf8'));
      expect((await legacy.query('select * from vehicles where merged_into is null')).rows).toHaveLength(1);
      expect((await legacy.query('select * from vehicles')).rows).toHaveLength(2);
      expect((await legacy.query("select * from user_vehicle_relations where source='LEGACY_MIGRATION' and relation_type='AUTHORIZED_DRIVER'")).rows).toHaveLength(2);
      expect((await legacy.query("select * from user_vehicle_relations where relation_type='OWNER_MANAGER'")).rows).toHaveLength(0);
      expect((await legacy.query<any>('select vehicle_snapshot from trips where vehicle_id is null')).rows[0].vehicle_snapshot).toBeNull();
      expect((await legacy.query<any>("select vehicle_snapshot->>'identifier' as plate from trips where vehicle_id is not null order by plate")).rows.map(r=>r.plate)).toEqual(['MT-2','mt 2']);
    }finally{await legacy.close();}
  },30000);
  it('records received offers on the session that existed when they were sent',async()=>{
    const id=await unit();const s=await fleet.startSession(driver,id);
    await pg.query('insert into driver_offers(driver_id) values($1)',[ids.driver]);
    await fleet.releaseSession(driver,s.sessionId);await fleet.startSession(driver,id);
    const rows=(await fleet.fleetDetail(admin,id)).sessions;expect(rows.find((r:any)=>r.id===s.sessionId)!.received).toBe(1);
  });
  it('QR is not authorization and permits an idempotent access request',async()=>{
    const id=await unit();const qr=await fleet.generateQr(admin,id);
    expect(await fleet.resolveQr(owner,qr.token)).toEqual({authorized:false});
    await fleet.requestQrLink(owner,qr.token);await fleet.requestQrLink(owner,qr.token);
    expect((await pg.query('select * from user_vehicle_relations where user_id=$1',[ids.owner])).rows).toHaveLength(1);
    await expect(fleet.startSession(owner,id)).rejects.toThrow('DRIVER_NOT_AUTHORIZED');
  });
  it('does not issue a QR to a pending unit',async()=>{
    const {id}=await fleet.requestVehicle(driver,input);await expect(fleet.generateQr(admin,id)).rejects.toThrow('VEHICLE_NOT_VERIFIED');
  });
  it('does not revive an idle expired session with a late heartbeat',async()=>{
    const id=await unit();const s=await fleet.startSession(driver,id);
    await pg.exec("update driver_vehicle_sessions set last_heartbeat=now()-interval '1 hour'");
    await expect(fleet.heartbeat(driver,s.sessionId)).rejects.toThrow('VEHICLE_SESSION_EXPIRED');
  });
  it('allows heartbeat recovery during a trip without releasing the unit',async()=>{
    const id=await unit();const s=await fleet.startSession(driver,id);await trip();
    await pg.exec("update driver_vehicle_sessions set last_heartbeat=now()-interval '1 hour'");
    expect(await fleet.heartbeat(driver,s.sessionId)).toEqual({alive:true});
  });
  it('blocks manual release by an unrelated driver and requires an administrator reason',async()=>{
    const id=await unit();const s=await fleet.startSession(driver,id);
    await expect(fleet.releaseSession(other,s.sessionId)).rejects.toThrow('FORBIDDEN');
    await expect(fleet.releaseSession(admin,s.sessionId,'ADMIN_RELEASE')).rejects.toThrow();
    await fleet.releaseSession(admin,s.sessionId,'ADMIN_RELEASE','Unidad liberada tras verificar que está detenida');
    await fleet.releaseSession(driver,s.sessionId);
    expect((await pg.query("select * from vehicle_audit where action='session_ended'")).rows).toHaveLength(1);
  });
  it('authorizes an existing driver by exact email without granting owner rights',async()=>{
    const id=await unit();await fleet.setRelation(admin,id,ids.owner,'OWNER_MANAGER','APPROVED','Responsable validado');
    await fleet.authorizeDriverByEmail(owner,id,'other@example.test','Conductor invitado por responsable');
    await expect(fleet.authorizeDriverByEmail(driver,id,'owner@example.test','Acción no permitida')).rejects.toThrow('VEHICLE_FORBIDDEN');
    await expect(fleet.authorizeDriverByEmail(owner,id,'missing@example.test','Conductor no registrado')).rejects.toThrow('USER_NOT_ELIGIBLE');
  });
  it('retains original evidence and snapshots the old photo after a replacement',async()=>{
    const id=await unit();const bytes=await sharp({create:{width:20,height:10,channels:3,background:'blue'}}).png().toBuffer();
    const photo=await uploadVehicleFile(admin,id,{kind:'PHOTO',mimeType:'image/png',data:bytes.toString('base64')});
    expect(Buffer.from((await readVehicleFile(admin,String(photo.id),true)).bytes).equals(bytes)).toBe(true);
    await expect(readVehicleFile(other,String(photo.id),true)).rejects.toThrow();
    await fleet.startSession(driver,id);const t=await trip();
    expect(t.vehicle_snapshot.photoId).toBe(photo.id);
    expect((await readVehicleFile(owner,String(photo.id))).mimeType).toBe('image/jpeg');
    await pg.query("update trips set status='COMPLETED' where id=$1",[t.id]);
    await uploadVehicleFile(admin,id,{kind:'PHOTO',mimeType:'image/png',data:bytes.toString('base64')});
    expect((await pg.query<any>('select vehicle_snapshot from trips where id=$1',[t.id])).rows[0].vehicle_snapshot.photoId).toBe(photo.id);
    await expect(pg.query('delete from vehicle_files where id=$1',[photo.id])).rejects.toThrow('FLEET_HISTORY_IMMUTABLE');
  });
  it('claims ownership with evidence without replacing the vehicle or QR',async()=>{
    const id=await unit();const qr=await fleet.generateQr(admin,id);
    const evidence=await uploadVehicleFile(owner,id,{kind:'OWNERSHIP_EVIDENCE',mimeType:'application/pdf',data:Buffer.from('%PDF-1.4\n test evidence').toString('base64')});
    const claim=await fleet.requestOwnership(owner,id,String(evidence.id),'Soy el propietario legal de esta unidad');
    await expect(fleet.reviewOwnership(driver,String(claim.id),true,'Intento sin autorización')).rejects.toThrow('FORBIDDEN');
    await fleet.reviewOwnership(admin,String(claim.id),true,'Documentación contrastada');
    expect((await fleet.fleetDetail(owner,id)).canManage).toBe(true);expect((await fleet.generateQr(admin,id)).token).toBe(qr.token);
    expect((await pg.query('select * from vehicles')).rows).toHaveLength(1);
  });
  it('creates one owner notification for a repeated session confirmation',async()=>{
    const id=await unit();await fleet.setRelation(admin,id,ids.owner,'OWNER_MANAGER','APPROVED','Responsable validado');
    await pg.exec('update fleet_settings set owner_notifications=true');await fleet.notificationPreferences(owner,['session_started']);
    const s=await fleet.startSession(driver,id);await fleet.startSession(driver,id);await fleet.releaseSession(driver,s.sessionId);
    expect((await pg.query('select * from fleet_notification_outbox')).rows).toHaveLength(1);
  });
  it('delivers the owner event once with a unit-specific navigation payload',async()=>{
    const id=await unit();await fleet.setRelation(admin,id,ids.owner,'OWNER_MANAGER','APPROVED','Responsable validado');
    await pg.exec('update fleet_settings set owner_notifications=true');await fleet.notificationPreferences(owner,['session_started']);
    await fleet.startSession(driver,id);
    await deliverFleetNotifications();await deliverFleetNotifications();
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(sendPush).toHaveBeenCalledWith(ids.owner,'Jornada iniciada',expect.stringContaining('MT-20'),expect.objectContaining({type:'FLEET_SESSION',notificationRoute:'FLEET',vehicleId:id,eventId:expect.any(String)}));
    expect((await pg.query<any>('select status from fleet_notification_outbox')).rows[0].status).toBe('SENT');
  });
  it('does not deliver queued unit activity after ownership has been revoked',async()=>{
    const id=await unit();await fleet.setRelation(admin,id,ids.owner,'OWNER_MANAGER','APPROVED','Responsable validado');
    await pg.exec('update fleet_settings set owner_notifications=true');await fleet.notificationPreferences(owner,['session_started']);
    await fleet.startSession(driver,id);
    await fleet.setRelation(admin,id,ids.owner,'OWNER_MANAGER','REVOKED','Cambio de responsable');
    await deliverFleetNotifications();expect(sendPush).not.toHaveBeenCalled();
    expect((await pg.query<any>('select status from fleet_notification_outbox')).rows[0].status).toBe('FAILED');
  });
  it('uses one owner takeover alert instead of three start/end/change notifications',async()=>{
    const id=await unit();await fleet.setRelation(admin,id,ids.owner,'OWNER_MANAGER','APPROVED','Responsable validado');
    await pg.exec('update fleet_settings set owner_notifications=true');await fleet.startSession(driver,id);
    await pg.exec("update driver_vehicle_sessions set last_heartbeat=now()-interval '4 minutes'");
    await fleet.startSession(other,id,'QR_SCAN',true);
    const events=(await pg.query<any>('select event from fleet_notification_outbox')).rows.map(r=>r.event).sort();
    expect(events).toEqual(['session_started','vehicle_takeover']);
    expect((await pg.query("select * from vehicle_audit where action='session_ended'")).rows).toHaveLength(1);
  });
  it('enforces the history capability without hiding current ownership information',async()=>{
    const id=await unit();await fleet.setRelation(admin,id,ids.owner,'OWNER_MANAGER','APPROVED','Responsable validado');
    await fleet.startSession(driver,id);await trip();
    await pg.query("insert into fleet_entitlements(user_id,capabilities) values($1,'{\"history\":false,\"reports\":false}')",[ids.owner]);
    const detail=await fleet.fleetDetail(owner,id);
    expect(detail.canManage).toBe(true);expect(detail.sessions).toHaveLength(0);expect(detail.trips).toHaveLength(0);expect(detail.history).toHaveLength(0);
    expect((await fleet.fleetDetail(admin,id)).sessions).toHaveLength(1);
    await expect(fleetReport(owner,{})).rejects.toThrow();
  });
  it('keeps assignment evidence immutable even through direct writes',async()=>{
    const id=await unit();await fleet.startSession(driver,id);await trip();
    await expect(pg.exec("update vehicle_session_assignments set vehicle_snapshot='{}'" )).rejects.toThrow('FLEET_HISTORY_IMMUTABLE');
  });
  it('does not lose cancellation attribution on repeated terminal updates',async()=>{
    const id=await unit();await fleet.startSession(driver,id);const t=await trip();
    await pg.query("update trips set status='CANCELLED' where id=$1",[t.id]);
    await pg.query("insert into trip_events(trip_id,actor_id,to_status) values($1,$2,'CANCELLED')",[t.id,ids.owner]);
    await pg.query("update trips set status='CANCELLED' where id=$1",[t.id]);
    expect((await fleet.fleetDetail(admin,id)).sessions[0]!.passengerCancelled).toBe(1);
  });
  it('enforces endpoint roles and cooperative scope even with a permission override',async()=>{
    const app=Fastify();await registerFleetRoutes(app,async(_req,reply)=>{reply.code(401).send({error:'UNAUTHORIZED'});return undefined;});
    const id=await unit();const restricted=tokenFor({id:ids.admin,email:'x@example.test',name:'Test',role:'COMMERCIAL',permissions:['fleet:view','fleet:manage']});
    expect((await app.inject({url:'/v1/admin/fleet/vehicles',headers:{authorization:`Bearer ${restricted}`}})).statusCode).toBe(403);
    expect((await app.inject({url:'/v1/fleet/vehicles'})).statusCode).toBe(401);
    const analyst=tokenFor({id:ids.admin,email:'x@example.test',name:'Analista',role:'ANALISTA_COOPERATIVA',cooperativeId:ids.coop2});
    expect((await app.inject({url:`/v1/admin/fleet/vehicles/${id}`,headers:{authorization:`Bearer ${analyst}`}})).statusCode).toBe(403);
    const unscoped=tokenFor({id:ids.admin,email:'x@example.test',name:'Sin ámbito',role:'ANALISTA_COOPERATIVA'});
    expect((await app.inject({url:'/v1/admin/fleet/vehicles',headers:{authorization:`Bearer ${unscoped}`}})).statusCode).toBe(403);
    await app.close();
  });
  it('creates a pending relation without granting ownership or automatic approval',async()=>{
    const v=await fleet.requestVehicle(driver,input);
    expect((await pg.query<any>('select * from user_vehicle_relations')).rows[0]).toMatchObject({status:'PENDING',relation_type:'AUTHORIZED_DRIVER'});
    await expect(fleet.startSession(driver,v.id)).rejects.toThrow();
    await expect(fleet.setVehicleStatus(driver,v.id,'VERIFIED','Intento de autoaprobación')).rejects.toThrow('FORBIDDEN');
  });
  it('reuses normalized plates and does not overwrite the existing asset',async()=>{
    const first=await fleet.requestVehicle(driver,input);
    const next=await fleet.requestVehicle(other,{...input,identifier:'mt 20',color:'Rojo'});
    expect(next).toMatchObject({id:first.id,existing:true});
    expect((await pg.query<any>('select color from vehicles')).rows[0].color).toBe('Azul');
    expect((await pg.query('select * from vehicles')).rows).toHaveLength(1);
  });
  it('rejects an unverified vehicle and a non-authorized driver',async()=>{
    const {id}=await fleet.requestVehicle(driver,input);
    await fleet.setRelation(admin,id,ids.driver,'AUTHORIZED_DRIVER','APPROVED','Autorizado para pruebas');
    await expect(fleet.startSession(driver,id)).rejects.toThrow('VEHICLE_NOT_VERIFIED');
    await expect(fleet.setVehicleStatus(admin,id,'VERIFIED','Verificada para pruebas')).rejects.toThrow('VEHICLE_PHOTO_REQUIRED');
    const bytes=await sharp({create:{width:20,height:10,channels:3,background:'blue'}}).png().toBuffer();
    await uploadVehicleFile(admin,id,{kind:'PHOTO',mimeType:'image/png',data:bytes.toString('base64')});await fleet.setVehicleStatus(admin,id,'VERIFIED','Verificada para pruebas');
    await expect(fleet.startSession(other,id)).rejects.toThrow('VEHICLE_FORBIDDEN');
  });
  it('has one active session per unit and driver and makes repeat selection idempotent',async()=>{
    const id=await unit();const s=await fleet.startSession(driver,id);
    expect((await fleet.startSession(driver,id)).sessionId).toBe(s.sessionId);
    await expect(fleet.startSession(other,id)).rejects.toThrow('VEHICLE_IN_USE');
    await expect(pg.query("insert into driver_vehicle_sessions(driver_id,vehicle_id,start_method) values($1,$2,'QR_SCAN')",[ids.other,id])).rejects.toThrow();
    expect((await pg.query('select * from driver_vehicle_sessions')).rows).toHaveLength(1);
  });
  it('changes units by ending the previous session, without deleting its history',async()=>{
    const id=await unit();const next=await unit('MT-21');
    const s=await fleet.startSession(driver,id);await fleet.startSession(driver,next);
    expect((await pg.query<any>('select * from driver_vehicle_sessions where id=$1',[s.sessionId])).rows[0]).toMatchObject({status:'ENDED',end_reason:'VEHICLE_CHANGE'});
    await expect(pg.query('delete from driver_vehicle_sessions where id=$1',[s.sessionId])).rejects.toThrow('FLEET_HISTORY_IMMUTABLE');
  });
  it('blocks release, switching, suspension and takeover during an active trip',async()=>{
    const id=await unit();const next=await unit('MT-22');const s=await fleet.startSession(driver,id);await trip();
    await expect(fleet.releaseSession(driver,String(s.sessionId))).rejects.toThrow('VEHICLE_HAS_ACTIVE_TRIP');
    await expect(fleet.startSession(driver,next)).rejects.toThrow('VEHICLE_HAS_ACTIVE_TRIP');
    await expect(fleet.setVehicleStatus(admin,id,'SUSPENDED','Suspender la unidad')).rejects.toThrow('VEHICLE_HAS_ACTIVE_TRIP');
    await pg.exec("update driver_vehicle_sessions set last_heartbeat=now()-interval '1 hour'");
    await expect(fleet.startSession(other,id,'QR_SCAN',true)).rejects.toThrow('VEHICLE_HAS_ACTIVE_TRIP');
    expect(await fleet.releaseStaleSessions()).toBe(0);
  });
  it('snapshots the actual unit and keeps it immutable after profile changes',async()=>{
    const id=await unit();await fleet.startSession(driver,id);const t=await trip();
    expect(t.vehicle_snapshot.identifier).toBe('MT-20');expect(t.vehicle_id).toBe(id);
    await pg.query("update trips set status='COMPLETED',final_total_cents=220 where id=$1",[t.id]);
    await fleet.updateVehicle(admin,id,{...input,identifier:'NEW-20',color:'Rojo'});
    await pg.query("update trips set vehicle_snapshot='{}' where id=$1",[t.id]);
    const saved=(await pg.query<any>('select * from trips where id=$1',[t.id])).rows[0];
    expect(saved.vehicle_snapshot.identifier).toBe('MT-20');
    const detail=await fleet.fleetDetail(admin,id);
    expect(Number(detail.sessions[0]!.totalCents)).toBe(220);expect(detail.sessions[0]!.completed).toBe(1);
    expect(Number(detail.sessions[0]!.distanceMeters)).toBe(2500);
  });
  it('requires a live authorized session before a real assignment',async()=>{
    await expect(trip()).rejects.toThrow('VEHICLE_SESSION_REQUIRED');
    const id=await unit();await fleet.startSession(driver,id);
    await pg.exec("update driver_vehicle_sessions set last_heartbeat=now()-interval '4 minutes'");
    await expect(trip()).rejects.toThrow('VEHICLE_SESSION_REQUIRED');
  });
  it('expires idle sessions but cannot resurrect their heartbeats',async()=>{
    const id=await unit();const s=await fleet.startSession(driver,id);
    await pg.exec("update driver_vehicle_sessions set last_heartbeat=now()-interval '16 minutes'");
    expect(await fleet.releaseStaleSessions()).toBe(1);expect(await fleet.releaseStaleSessions()).toBe(0);
    await expect(fleet.heartbeat(driver,String(s.sessionId))).rejects.toThrow('VEHICLE_SESSION_EXPIRED');
  });
  it('requires explicit physical-possession confirmation for an offline takeover',async()=>{
    const id=await unit();const s=await fleet.startSession(driver,id);
    await pg.exec("update driver_vehicle_sessions set last_heartbeat=now()-interval '4 minutes'");
    await expect(fleet.startSession(other,id,'QR_SCAN')).rejects.toThrow('VEHICLE_TAKEOVER_CONFIRMATION_REQUIRED');
    await fleet.startSession(other,id,'QR_SCAN',true);
    expect((await pg.query<any>('select end_reason from driver_vehicle_sessions where id=$1',[s.sessionId])).rows[0].end_reason).toBe('TAKEOVER');
  });
  it('keeps QR tokens private, random and revocable without changing the asset',async()=>{
    const id=await unit();const qr=await fleet.generateQr(admin,id);
    expect(qr.token).toMatch(/^[\w-]{43}$/);expect((await fleet.resolveQr(driver,qr.token)).id).toBe(id);
    await expect(fleet.generateQr(driver,id)).rejects.toThrow('FORBIDDEN');
    const replaced=await fleet.generateQr(admin,id,true,'Etiqueta de QR reemplazada');
    expect(replaced.token).not.toBe(qr.token);
    await expect(fleet.resolveQr(driver,qr.token)).rejects.toThrow('VEHICLE_QR_INVALID');
    await fleet.revokeQr(admin,id,'QR extraviado en la unidad');
    await expect(fleet.resolveQr(driver,replaced.token)).rejects.toThrow('VEHICLE_QR_INVALID');
  });
  it('limits cooperative analysts even when they know an external vehicle UUID',async()=>{
    const id=await unit();await pg.query('update vehicles set cooperative_id=$1 where id=$2',[ids.coop,id]);
    const analyst={...admin,cooperativeId:ids.coop2};
    expect(await fleet.listVehicles(analyst)).toHaveLength(0);
    await expect(fleet.fleetDetail(analyst,id)).rejects.toThrow('VEHICLE_FORBIDDEN');
    await expect(fleet.generateQr(analyst,id)).rejects.toThrow('VEHICLE_FORBIDDEN');
    await expect(fleet.saveFleetSettings(analyst,{heartbeatSeconds:30,offlineSeconds:180,autoReleaseSeconds:900,ownerNotifications:false})).rejects.toThrow('FORBIDDEN');
  });
  it('supports non-driver managers without giving them driving rights',async()=>{
    const id=await unit();await fleet.setRelation(admin,id,ids.owner,'OWNER_MANAGER','APPROVED','Responsable validado');
    expect((await fleet.fleetDetail(owner,id)).canManage).toBe(true);
    await expect(fleet.startSession(owner,id)).rejects.toThrow('DRIVER_NOT_AUTHORIZED');
    await expect(fleet.setRelation(owner,id,ids.other,'OWNER_MANAGER','APPROVED','Intenta asignar propietario')).rejects.toThrow('FORBIDDEN');
    await fleet.setRelation(owner,id,ids.other,'AUTHORIZED_DRIVER','REVOKED','Autorización terminada');
  });
  it('does not expose passenger identities, addresses or chats to fleet managers',async()=>{
    const id=await unit();await fleet.setRelation(admin,id,ids.owner,'OWNER_MANAGER','APPROVED','Responsable validado');
    await fleet.startSession(driver,id);await trip();const detail=await fleet.fleetDetail(owner,id);
    for(const field of ['passenger_id','phone','origin_reference','chat'])expect(Object.keys(detail.trips[0]!)).not.toContain(field);
    expect(JSON.stringify(detail.trips)).not.toContain('owner@example.test');
  });
  it('classifies cancellation per session without double counting repeated trip events',async()=>{
    const id=await unit();await fleet.startSession(driver,id);const t=await trip();
    await pg.query("update trips set status='CANCELLED' where id=$1",[t.id]);
    for(let i=0;i<2;i++)await pg.query("insert into trip_events(trip_id,actor_id,to_status) values($1,$2,'CANCELLED')",[t.id,ids.owner]);
    const detail=await fleet.fleetDetail(admin,id);expect(detail.sessions[0]!.passengerCancelled).toBe(1);expect(detail.sessions[0]!.accepted).toBe(1);
  });
  it('validates parameter ordering rather than hardcoding offline time',async()=>{
    await expect(fleet.saveFleetSettings(admin,{heartbeatSeconds:120,offlineSeconds:60,autoReleaseSeconds:900,ownerNotifications:false})).rejects.toThrow();
    await fleet.saveFleetSettings(admin,{heartbeatSeconds:10,offlineSeconds:40,autoReleaseSeconds:80,ownerNotifications:false});
    const id=await unit();await fleet.startSession(driver,id);
    await pg.exec("update driver_vehicle_sessions set last_heartbeat=now()-interval '90 seconds'");
    expect(await fleet.releaseStaleSessions()).toBe(1);
  });
  it('normalizes real photos without changing or discarding original bytes',async()=>{
    const bytes=await sharp({create:{width:20,height:10,channels:3,background:'blue'}}).png().toBuffer();
    const prepared=await prepareVehicleFile({kind:'PHOTO',mimeType:'image/png',data:bytes.toString('base64')});
    expect(prepared.bytes.equals(bytes)).toBe(true);
    expect(await sharp(prepared.display!).metadata()).toMatchObject({width:800,height:600,format:'jpeg'});
    await expect(prepareVehicleFile({kind:'PHOTO',mimeType:'image/png',data:Buffer.from('not a png').toString('base64')})).rejects.toThrow('INVALID_IMAGE');
  });
});
