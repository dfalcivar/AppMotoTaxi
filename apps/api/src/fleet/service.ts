import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { database } from '../database.js';

export type FleetActor = { id: string; admin?: boolean; cooperativeId?: string; ip?: string };
export class FleetError extends Error {
  constructor(public code: string, public status = 409) { super(code); }
}
export const vehicleSchema = z.object({
  identifier: z.string().trim().min(3).max(30).refine(v => /^[a-zA-Z0-9 -]+$/.test(v)),
  brand: z.string().trim().min(1).max(80), model: z.string().trim().min(1).max(80),
  color: z.string().trim().min(1).max(40), unitNumber: z.string().trim().max(40).optional(),
  declaredOwnerName: z.string().trim().min(3).max(160),
  cooperativeId: z.uuid().nullable().optional(),
  maximumPassengers: z.number().int().min(1).max(10).default(3),
  relationType: z.enum(['AUTHORIZED_DRIVER','OWNER_MANAGER']).default('AUTHORIZED_DRIVER')
});
export const settingsSchema = z.object({
  heartbeatSeconds: z.number().int().min(10).max(120),
  offlineSeconds: z.number().int().min(30).max(1800),
  autoReleaseSeconds: z.number().int().min(60).max(86400),
  ownerNotifications: z.boolean()
}).refine(p => p.heartbeatSeconds < p.offlineSeconds && p.offlineSeconds < p.autoReleaseSeconds);
type Tx = any;
async function audit(tx: Tx, actor: FleetActor | null, vehicleId: string | null, action: string,
  next: unknown = null, reason: string | null = null, previous: unknown = null, driverId: string | null = null,notifyOwners=true) {
  const [entry]=await tx`insert into vehicle_audit(vehicle_id,driver_id,actor_id,action,reason,previous_value,next_value,source_ip)
    values(${vehicleId},${driverId},${actor?.id ?? null},${action},${reason},${JSON.stringify(previous)}::jsonb,
      ${JSON.stringify(next)}::jsonb,${actor?.ip ?? null}) returning id`;
  if(notifyOwners&&vehicleId&&['session_started','session_ended','session_auto_released','vehicle_takeover'].includes(action))await tx`
    insert into fleet_notification_outbox(audit_id,user_id,vehicle_id,event)
    select ${entry.id},r.user_id,${vehicleId},${action} from user_vehicle_relations r
    cross join fleet_settings p left join fleet_entitlements e on e.user_id=r.user_id
    where r.vehicle_id=${vehicleId} and r.relation_type='OWNER_MANAGER' and r.status='APPROVED'
      and p.owner_notifications and coalesce((e.capabilities->>'notifications')::boolean,true)
      and (e.user_id is null or ${action}=any(e.notification_events)) on conflict do nothing`;
}
async function lock(tx: Tx) {
  // Serialize infrequent fleet mutations; heartbeats and read-only queries do not take this lock.
  await tx`select pg_advisory_xact_lock(737301)`;
}
export async function authorizeVehicle(tx: Tx, actor: FleetActor, vehicleId: string, manage = false) {
  const [vehicle] = await tx`select v.* from vehicles v where v.id=${vehicleId} and v.merged_into is null
    and (${actor.admin === true} or exists(select 1 from user_vehicle_relations r
      where r.vehicle_id=v.id and r.user_id=${actor.id} and (r.status='APPROVED' or (${!manage} and r.status='PENDING'))
      and (${!manage} or r.relation_type='OWNER_MANAGER')))
    and (${!actor.cooperativeId} or v.cooperative_id=${actor.cooperativeId ?? null}::uuid)`;
  if (!vehicle) throw new FleetError('VEHICLE_FORBIDDEN',403);
  return vehicle;
}
export async function fleetSettings(tx: Tx = database()) {
  const [row] = await tx`select heartbeat_seconds as "heartbeatSeconds",offline_seconds as "offlineSeconds",
    auto_release_seconds as "autoReleaseSeconds",owner_notifications as "ownerNotifications" from fleet_settings`;
  return row;
}
export async function saveFleetSettings(actor: FleetActor, input: unknown) {
  if (!actor.admin || actor.cooperativeId) throw new FleetError('FORBIDDEN',403);
  const p=settingsSchema.parse(input);
  return database().begin(async tx => {
    await lock(tx);
    const previous=await fleetSettings(tx);
    await tx`update fleet_settings set heartbeat_seconds=${p.heartbeatSeconds},offline_seconds=${p.offlineSeconds},
      auto_release_seconds=${p.autoReleaseSeconds},owner_notifications=${p.ownerNotifications}`;
    await audit(tx,actor,null,'fleet_settings_updated',p,null,previous);
    return p;
  });
}
export async function listVehicles(actor: FleetActor, search = '', page = 0, status = '', managedOnly = false,
  relationType: 'AUTHORIZED_DRIVER'|'OWNER_MANAGER'|'' = '', authorizedOnly = false) {
  const sql=database();
  return sql`select v.id,v.identifier,v.brand,v.model,v.color,v.unit_number as "unitNumber",
    v.fleet_status as status,v.photo_id as "photoId",v.cooperative_id as "cooperativeId",c.name as cooperative,
    v.declared_owner_name as "declaredOwnerName",s.id as "sessionId",s.driver_id as "currentDriverId",
    u.full_name as "currentDriverName",s.started_at as "startedAt",s.last_heartbeat as "lastHeartbeat",
    coalesce(d.is_available,false) and fleet_driver_can_receive(s.driver_id) as available,
    coalesce((select jsonb_agg(jsonb_build_object('type',r.relation_type,'status',r.status))
      from user_vehicle_relations r where r.vehicle_id=v.id and r.user_id=${actor.id}),'[]'::jsonb) as relations,
    count(*) over()::int as "totalCount"
    from vehicles v left join cooperatives c on c.id=v.cooperative_id
    left join driver_vehicle_sessions s on s.vehicle_id=v.id and s.status='ACTIVE'
    left join users u on u.id=s.driver_id left join drivers d on d.user_id=s.driver_id
    where v.merged_into is null
      and (${actor.admin === true} or exists(select 1 from user_vehicle_relations r where r.vehicle_id=v.id
        and r.user_id=${actor.id} and r.status in ('APPROVED','PENDING')
        and (${!managedOnly} or r.relation_type='OWNER_MANAGER')
        and (${!relationType} or r.relation_type=${relationType})
        and (${!authorizedOnly} or (r.relation_type='AUTHORIZED_DRIVER' and r.status='APPROVED'))))
      and (${!actor.cooperativeId} or v.cooperative_id=${actor.cooperativeId ?? null}::uuid)
      and (${!status} or v.fleet_status=${status})
      and (v.identifier ilike ${`%${search}%`} or coalesce(v.unit_number,'') ilike ${`%${search}%`}
        or coalesce(v.declared_owner_name,'') ilike ${`%${search}%`} or coalesce(c.name,'') ilike ${`%${search}%`}
        or exists(select 1 from user_vehicle_relations r join users person on person.id=r.user_id
          where r.vehicle_id=v.id and r.status='APPROVED' and person.full_name ilike ${`%${search}%`}))
    order by v.identifier limit 30 offset ${page*30}`;
}
export async function requestVehicle(actor: FleetActor, input: unknown) {
  const v=vehicleSchema.parse(input);
  return database().begin(async tx => {
    await lock(tx);
    const [existing] = await tx`select id,cooperative_id from vehicles where merged_into is null
      and fleet_normalize_identifier(identifier)=fleet_normalize_identifier(${v.identifier}) for update`;
    if (actor.cooperativeId && existing && existing.cooperative_id!==actor.cooperativeId) throw new FleetError('VEHICLE_FORBIDDEN',403);
    let id:string=existing?.id;
    if (!id) {
      const [person]=await tx`select cooperative_id from users where id=${actor.id}`;
      const [created] = await tx`insert into vehicles(identifier,brand,model,color,unit_number,declared_owner_name,
        cooperative_id,maximum_passengers,created_by) values(${v.identifier.toUpperCase()},${v.brand},${v.model},${v.color},
        ${v.unitNumber ?? null},${v.declaredOwnerName},${actor.cooperativeId ?? (actor.admin ? v.cooperativeId ?? null : person?.cooperative_id??null)},
        ${v.maximumPassengers},${actor.id}) returning id`;
      id=String(created!.id);
      await audit(tx,actor,id,'vehicle_created',v);
    }
    // Even a new asset does not let its creator self-approve ownership or driving rights.
    if(!actor.admin){const changed=await tx`insert into user_vehicle_relations(user_id,vehicle_id,relation_type,status,source)
      values(${actor.id},${id},${v.relationType},'PENDING','USER_REQUEST')
      on conflict(user_id,vehicle_id,relation_type) do update set status='PENDING',requested_at=now(),
        reviewed_by=null,reviewed_at=null,reason=null
      where user_vehicle_relations.status in ('REJECTED','REVOKED') returning id`;
      if(changed.length)await audit(tx,actor,id,'driver_link_requested',{type:v.relationType,existing:Boolean(existing)});
    }
    return {id,existing:Boolean(existing),message:'Solicitud registrada. Un administrador validará la unidad y tu relación.'};
  });
}
export async function updateVehicle(actor: FleetActor, id: string, input: unknown) {
  const v=vehicleSchema.omit({relationType:true}).parse(input);
  return database().begin(async tx=>{
    await lock(tx);
    const previous=await authorizeVehicle(tx,actor,id,true);
    const [busy]=await tx`select 1 from driver_vehicle_sessions where vehicle_id=${id} and status='ACTIVE'
      and fleet_driver_has_active_trip(driver_id)`;
    if(busy)throw new FleetError('VEHICLE_HAS_ACTIVE_TRIP');
    await tx`update vehicles set identifier=${v.identifier.toUpperCase()},brand=${v.brand},model=${v.model},
      color=${v.color},unit_number=${v.unitNumber ?? null},declared_owner_name=${v.declaredOwnerName},
      maximum_passengers=${v.maximumPassengers},updated_at=now(),
      cooperative_id=case when ${actor.admin === true && !actor.cooperativeId} then ${v.cooperativeId ?? null}::uuid else cooperative_id end
      where id=${id}`;
    await audit(tx,actor,id,'vehicle_updated',v,null,previous);
    return {saved:true};
  });
}
export async function requestExistingVehicle(actor:FleetActor,input:unknown){
  const data=vehicleSchema.pick({identifier:true,relationType:true}).parse(input);
  return database().begin(async tx=>{
    await lock(tx);
    const [v]=await tx`select id from vehicles where merged_into is null
      and fleet_normalize_identifier(identifier)=fleet_normalize_identifier(${data.identifier})`;
    if(!v)throw new FleetError('VEHICLE_NOT_FOUND',404);
    const rows=await tx`insert into user_vehicle_relations(user_id,vehicle_id,relation_type,status,source)
      values(${actor.id},${v.id},${data.relationType},'PENDING','USER_REQUEST')
      on conflict(user_id,vehicle_id,relation_type) do update set status='PENDING',requested_at=now(),reviewed_at=null,reviewed_by=null
      where user_vehicle_relations.status in ('REVOKED','REJECTED') returning id`;
    if(rows.length)await audit(tx,actor,v.id,'driver_link_requested',{type:data.relationType,source:'IDENTIFIER'});
    return {id:v.id,existing:true,requested:true};
  });
}
export async function setVehicleStatus(actor: FleetActor, id: string, status: string, reason: string) {
  if(!actor.admin)throw new FleetError('FORBIDDEN',403);
  z.enum(['PENDING','VERIFIED','SUSPENDED']).parse(status);z.string().trim().min(5).max(500).parse(reason);
  return database().begin(async tx=>{
    await lock(tx);const vehicle=await authorizeVehicle(tx,actor,id,true);
    if(status==='VERIFIED'&&!vehicle.photo_id&&!vehicle.driver_id)throw new FleetError('VEHICLE_PHOTO_REQUIRED',400);
    const sessions=await tx`select * from driver_vehicle_sessions where vehicle_id=${id} and status='ACTIVE' for update`;
    for(const s of sessions) if(status!=='VERIFIED')await finishSession(tx,actor,s,'ADMIN_RELEASE',reason);
    await tx`update vehicles set fleet_status=${status},updated_at=now() where id=${id}`;
    await audit(tx,actor,id,status==='VERIFIED'?'vehicle_verified':'vehicle_suspended',{status},reason,{status:vehicle.fleet_status});
    return {status};
  });
}
export async function setRelation(actor: FleetActor, vehicleId: string, userId: string, type: string, status: string, reason: string) {
  z.uuid().parse(userId);z.enum(['AUTHORIZED_DRIVER','OWNER_MANAGER']).parse(type);
  z.enum(['APPROVED','REJECTED','REVOKED']).parse(status);z.string().trim().min(5).max(500).parse(reason);
  return database().begin(async tx=>{
    await lock(tx);await authorizeVehicle(tx,actor,vehicleId,true);
    if(type==='OWNER_MANAGER'&&!actor.admin)throw new FleetError('FORBIDDEN',403);
    const [user]=await tx`select u.id from users u where u.id=${userId} and deleted_at is null
      and (${!actor.cooperativeId} or u.cooperative_id=${actor.cooperativeId??null}::uuid)
      and (${type!=='AUTHORIZED_DRIVER'} or exists(select 1 from drivers where user_id=u.id))`;
    if(!user)throw new FleetError('USER_NOT_ELIGIBLE');
    if(type==='AUTHORIZED_DRIVER'&&status!=='APPROVED') {
      const [s]=await tx`select * from driver_vehicle_sessions where driver_id=${userId} and vehicle_id=${vehicleId} and status='ACTIVE' for update`;
      if(s)await finishSession(tx,actor,s,'ADMIN_RELEASE',reason);
    }
    await tx`insert into user_vehicle_relations(user_id,vehicle_id,relation_type,status,source,reviewed_by,reviewed_at,reason)
      values(${userId},${vehicleId},${type},${status},${actor.admin?'ADMIN':'MANAGER'},${actor.id},now(),${reason})
      on conflict(user_id,vehicle_id,relation_type) do update set status=excluded.status,reviewed_by=excluded.reviewed_by,
        reviewed_at=excluded.reviewed_at,reason=excluded.reason`;
    await audit(tx,actor,vehicleId,status==='APPROVED'?'driver_authorized':'driver_removed',{userId,type,status},reason,null,userId);
    return {saved:true};
  });
}
async function finishSession(tx:Tx,actor:FleetActor|null,s:any,reason:string,note:string|null=null){
  const [busy]=await tx`select fleet_driver_has_active_trip(${s.driver_id}) as busy`;
  if(busy.busy)throw new FleetError('VEHICLE_HAS_ACTIVE_TRIP');
  const ended=await tx`update driver_vehicle_sessions set status='ENDED',ended_at=now(),end_reason=${reason},updated_at=now()
    where id=${s.id} and status='ACTIVE' returning id`;
  if(!ended.length)return;
  await tx`update drivers set is_available=false where user_id=${s.driver_id}`;
  await audit(tx,actor,s.vehicle_id,reason==='AUTO_RELEASE'?'session_auto_released':'session_ended',
    {sessionId:s.id,endReason:reason},note,null,s.driver_id,reason!=='TAKEOVER');
}
export async function startSession(actor:FleetActor,vehicleId:string,method='MANUAL_SELECTION',takeover=false){
  z.enum(['MANUAL_SELECTION','QR_SCAN','RECOVERY']).parse(method);
  await releaseStaleSessions(actor.id);
  return database().begin(async tx=>{
    await lock(tx);
    const vehicle=await authorizeVehicle(tx,actor,vehicleId);
    const [eligible]=await tx`select 1 from drivers d join users u on u.id=d.user_id
      join user_vehicle_relations r on r.user_id=d.user_id and r.vehicle_id=${vehicleId}
      and r.relation_type='AUTHORIZED_DRIVER' and r.status='APPROVED'
      where d.user_id=${actor.id} and d.approval_status='APROBADO' and u.status='ACTIVE' and u.deleted_at is null`;
    if(!eligible)throw new FleetError('DRIVER_NOT_AUTHORIZED',403);
    if(vehicle.fleet_status!=='VERIFIED')throw new FleetError('VEHICLE_NOT_VERIFIED');
    const sessions=await tx`select * from driver_vehicle_sessions where status='ACTIVE'
      and (driver_id=${actor.id} or vehicle_id=${vehicleId}) order by id for update`;
    const mine=sessions.find((s:any)=>s.driver_id===actor.id);
    if(mine?.vehicle_id===vehicleId){
      await tx`update driver_vehicle_sessions set last_heartbeat=now(),updated_at=now() where id=${mine.id}`;
      return {sessionId:mine.id,vehicleId,recovered:true};
    }
    if(mine)await finishSession(tx,actor,mine,'VEHICLE_CHANGE');
    const occupied=sessions.find((s:any)=>s.vehicle_id===vehicleId&&s.driver_id!==actor.id);
    if(occupied){
      const [stale]=await tx`select ${occupied.last_heartbeat}::timestamptz<=now()-make_interval(secs=>offline_seconds) as stale from fleet_settings`;
      if(!stale?.stale)throw new FleetError('VEHICLE_IN_USE');
      if(!takeover)throw new FleetError('VEHICLE_TAKEOVER_CONFIRMATION_REQUIRED');
      await finishSession(tx,actor,occupied,'TAKEOVER','El conductor autorizado confirmó posesión física de la unidad');
      await audit(tx,actor,vehicleId,'vehicle_takeover',{previousSessionId:occupied.id},null,null,actor.id);
    }
    const [busy]=await tx`select fleet_driver_has_active_trip(${actor.id}) as busy`;
    if(busy?.busy)throw new FleetError('VEHICLE_HAS_ACTIVE_TRIP');
    const [session]=await tx`insert into driver_vehicle_sessions(driver_id,vehicle_id,start_method)
      values(${actor.id},${vehicleId},${method}) returning id`;
    await audit(tx,actor,vehicleId,'session_started',{sessionId:session!.id,startMethod:method},null,null,actor.id,!occupied);
    return {sessionId:session!.id,vehicleId,recovered:false};
  });
}
export async function currentSession(actor:FleetActor){
  await releaseStaleSessions(actor.id);
  const [session]=await database()`select s.id,s.vehicle_id as "vehicleId",s.started_at as "startedAt",
    s.last_heartbeat as "lastHeartbeat",v.identifier,v.color,v.unit_number as "unitNumber",v.photo_id as "photoId",
    fleet_driver_can_receive(s.driver_id) as eligible,fleet_driver_has_active_trip(s.driver_id) as "hasActiveTrip"
    from driver_vehicle_sessions s join vehicles v on v.id=s.vehicle_id where s.driver_id=${actor.id} and s.status='ACTIVE'`;
  const [lastEnded]=session?[]:await database()`select id,end_reason as reason,ended_at as "endedAt"
    from driver_vehicle_sessions where driver_id=${actor.id} and status='ENDED' order by ended_at desc limit 1`;
  return {session:session??null,lastEnded:lastEnded??null,settings:await fleetSettings()};
}
export async function heartbeat(actor:FleetActor,id:string){
  await releaseStaleSessions(actor.id);
  const result=await database()`update driver_vehicle_sessions s set last_heartbeat=now(),updated_at=now()
    where s.id=${id} and s.driver_id=${actor.id} and s.status='ACTIVE'
    and exists(select 1 from vehicles v join user_vehicle_relations r on r.vehicle_id=v.id
      where v.id=s.vehicle_id and v.fleet_status='VERIFIED' and r.user_id=s.driver_id
      and r.relation_type='AUTHORIZED_DRIVER' and r.status='APPROVED') returning id`;
  if(!result.length)throw new FleetError('VEHICLE_SESSION_EXPIRED');
  return {alive:true};
}
export async function releaseSession(actor:FleetActor,id:string,reason='MANUAL_RELEASE',note:string|null=null){
  z.enum(['MANUAL_RELEASE','LOGOUT','ADMIN_RELEASE']).parse(reason);
  return database().begin(async tx=>{
    await lock(tx);
    const [s]=await tx`select * from driver_vehicle_sessions where id=${id} for update`;
    if(!s)throw new FleetError('SESSION_NOT_FOUND',404);
    if(s.driver_id!==actor.id){
      if(!actor.admin||reason!=='ADMIN_RELEASE')throw new FleetError('FORBIDDEN',403);
      await authorizeVehicle(tx,actor,s.vehicle_id,true);z.string().trim().min(5).max(500).parse(note);
    }
    if(s.status==='ACTIVE')await finishSession(tx,actor,s,reason,note);
    return {released:true};
  });
}
export async function releaseStaleSessions(driverId:string|null=null){
  return database().begin(async tx=>{
    await lock(tx);
    const sessions=await tx`select s.* from driver_vehicle_sessions s cross join fleet_settings p
      where s.status='ACTIVE' and (${driverId===null} or s.driver_id=${driverId}::uuid)
      and s.last_heartbeat<=now()-make_interval(secs=>p.auto_release_seconds)
      and not fleet_driver_has_active_trip(s.driver_id) for update of s`;
    for(const s of sessions)await finishSession(tx,null,s,'AUTO_RELEASE');
    return sessions.length;
  });
}
export async function generateQr(actor:FleetActor,vehicleId:string,regenerate=false,reason='Generación inicial'){
  if(!actor.admin)throw new FleetError('FORBIDDEN',403);
  return database().begin(async tx=>{
    await lock(tx);const vehicle=await authorizeVehicle(tx,actor,vehicleId,true);
    if(vehicle.fleet_status!=='VERIFIED')throw new FleetError('VEHICLE_NOT_VERIFIED');
    const [existing]=await tx`select token from vehicle_qr_tokens where vehicle_id=${vehicleId} and revoked_at is null`;
    if(existing&&!regenerate)return {token:existing.token};
    if(existing){
      z.string().trim().min(5).max(500).parse(reason);
      await tx`update vehicle_qr_tokens set revoked_at=now(),revoked_by=${actor.id},reason=${reason}
        where vehicle_id=${vehicleId} and revoked_at is null`;
    }
    const token=randomBytes(32).toString('base64url');
    await tx`insert into vehicle_qr_tokens(vehicle_id,token,created_by) values(${vehicleId},${token},${actor.id})`;
    await audit(tx,actor,vehicleId,existing?'vehicle_qr_regenerated':'vehicle_qr_generated',null,reason);
    return {token};
  });
}
export async function revokeQr(actor:FleetActor,vehicleId:string,reason:string){
  if(!actor.admin)throw new FleetError('FORBIDDEN',403);
  z.string().trim().min(5).max(500).parse(reason);
  return database().begin(async tx=>{
    await lock(tx);await authorizeVehicle(tx,actor,vehicleId,true);
    await tx`update vehicle_qr_tokens set revoked_at=now(),revoked_by=${actor.id},reason=${reason}
      where vehicle_id=${vehicleId} and revoked_at is null`;
    await audit(tx,actor,vehicleId,'vehicle_qr_invalidated',null,reason);return {revoked:true};
  });
}
export async function resolveQr(actor:FleetActor,token:string){
  z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(token);
  const [row]=await database()`select vehicle_id from vehicle_qr_tokens where token=${token} and revoked_at is null`;
  if(!row)throw new FleetError('VEHICLE_QR_INVALID',404);
  try {
    const vehicle=await authorizeVehicle(database(),actor,String(row.vehicle_id));
    const [relation]=await database()`select 1 from user_vehicle_relations where user_id=${actor.id}
      and vehicle_id=${vehicle.id} and relation_type='AUTHORIZED_DRIVER' and status='APPROVED'`;
    return {id:vehicle.id,identifier:vehicle.identifier,color:vehicle.color,unitNumber:vehicle.unit_number,photoId:vehicle.photo_id,authorized:Boolean(relation)};
  } catch(error) {
    if(!(error instanceof FleetError)||error.code!=='VEHICLE_FORBIDDEN')throw error;
    return {authorized:false};
  }
}
export async function requestQrLink(actor:FleetActor,token:string){
  z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(token);
  return database().begin(async tx=>{
    await lock(tx);
    const [qr]=await tx`select vehicle_id from vehicle_qr_tokens where token=${token} and revoked_at is null`;
    if(!qr)throw new FleetError('VEHICLE_QR_INVALID',404);
    const rows=await tx`insert into user_vehicle_relations(user_id,vehicle_id,relation_type,status,source)
      values(${actor.id},${qr.vehicle_id},'AUTHORIZED_DRIVER','PENDING','USER_REQUEST')
      on conflict(user_id,vehicle_id,relation_type) do update set status='PENDING',requested_at=now()
      where user_vehicle_relations.status in ('REJECTED','REVOKED') returning id`;
    if(rows.length)await audit(tx,actor,qr.vehicle_id,'driver_link_requested',{source:'QR_SCAN'});
    return {requested:true};
  });
}
export async function authorizeDriverByEmail(actor:FleetActor,id:string,email:string,reason:string){
  await authorizeVehicle(database(),actor,id,true);
  z.email().parse(email);
  const [user]=await database()`select u.id from users u join drivers d on d.user_id=u.id
    where lower(u.email)=lower(${email.trim()}) and u.deleted_at is null and u.status='ACTIVE'
      and (${!actor.cooperativeId} or u.cooperative_id=${actor.cooperativeId??null}::uuid)`;
  if(!user)throw new FleetError('USER_NOT_ELIGIBLE',404);
  return setRelation(actor,id,String(user.id),'AUTHORIZED_DRIVER','APPROVED',reason);
}
export async function notificationPreferences(actor:FleetActor,events?:string[]){
  if(events){
    z.array(z.enum(['session_started','session_ended','session_auto_released','vehicle_takeover'])).max(4).parse(events);
    await database()`insert into fleet_entitlements(user_id,notification_events) values(${actor.id},${events})
      on conflict(user_id) do update set notification_events=excluded.notification_events`;
  }
  const [row]=await database()`select notification_events as events from fleet_entitlements where user_id=${actor.id}`;
  return row??{events:['session_started','session_ended','session_auto_released','vehicle_takeover']};
}
export async function fleetDetail(actor:FleetActor,id:string,page=0,from='1970-01-01',to='2100-01-01'){
  const sql=database();const v=await authorizeVehicle(sql,actor,id);
  const [manager]=await sql`select 1 from user_vehicle_relations where vehicle_id=${id} and user_id=${actor.id}
    and relation_type='OWNER_MANAGER' and status='APPROVED'`;
  const canManage=actor.admin===true||Boolean(manager);
  const [entitlement]=await sql`select capabilities from fleet_entitlements where user_id=${actor.id}`;
  const canReadHistory=actor.admin===true||!manager||entitlement?.capabilities?.history!==false;
  const [draft]=await sql`select 1 from user_vehicle_relations r where r.vehicle_id=${id} and r.user_id=${actor.id}
    and r.status='PENDING' and not exists(select 1 from user_vehicle_relations a where a.vehicle_id=${id} and a.status='APPROVED')`;
  const canUpload=canManage||(v.created_by===actor.id&&v.fleet_status==='PENDING'&&Boolean(draft));
  const [current]=await sql`select s.id,u.full_name as "driverName",s.started_at as "startedAt",s.last_heartbeat as "lastHeartbeat",
    d.is_available and fleet_driver_can_receive(s.driver_id) as available from driver_vehicle_sessions s
    join users u on u.id=s.driver_id join drivers d on d.user_id=s.driver_id where s.vehicle_id=${id} and s.status='ACTIVE'`;
  const relations=canManage?await sql`select r.id,r.user_id as "userId",r.relation_type as type,r.status,r.source,
    u.full_name as name,r.requested_at as "requestedAt",r.reason from user_vehicle_relations r
    join users u on u.id=r.user_id where r.vehicle_id=${id} and u.deleted_at is null order by r.requested_at desc`:[];
  const sessions=await sql`select s.id,s.driver_id as "driverId",u.full_name as "driverName",s.started_at as "startedAt",
    s.ended_at as "endedAt",s.status,s.start_method as "startMethod",s.end_reason as "endReason",s.last_heartbeat as "lastHeartbeat",
    extract(epoch from (coalesce(s.ended_at,now())-s.started_at))::int as "durationSeconds",
    (select count(*)::int from driver_offers o where o.vehicle_session_id=s.id) as received,
    (select count(*)::int from vehicle_session_assignments a where a.session_id=s.id) as accepted,
    (select count(*)::int from vehicle_session_assignments a where a.session_id=s.id and a.outcome='COMPLETED') as completed,
    (select count(*)::int from vehicle_session_assignments a where a.session_id=s.id and a.outcome='DRIVER_CANCELLED') as "driverCancelled",
    (select count(*)::int from vehicle_session_assignments a where a.session_id=s.id and a.outcome='PASSENGER_CANCELLED') as "passengerCancelled",
    (select coalesce(sum(total_cents),0)::bigint from vehicle_session_assignments a where a.session_id=s.id and a.outcome='COMPLETED') as "totalCents",
    (select coalesce(sum(distance_meters),0) from vehicle_session_assignments a where a.session_id=s.id and a.outcome='COMPLETED') as "distanceMeters"
    from driver_vehicle_sessions s join users u on u.id=s.driver_id
    where ${canReadHistory} and s.vehicle_id=${id} and (${canManage} or s.driver_id=${actor.id})
      and s.started_at>=${from}::timestamptz and s.started_at<${to}::timestamptz
    order by s.started_at desc limit 30 offset ${page*30}`;
  const trips=await sql`select a.trip_id as id,a.session_id as "sessionId",a.accepted_at as "acceptedAt",a.ended_at as "endedAt",
    a.outcome,a.distance_meters as "distanceMeters",a.total_cents as "totalCents",a.vehicle_snapshot as vehicle,
    u.full_name as "driverName" from vehicle_session_assignments a join users u on u.id=a.driver_id
    where ${canReadHistory} and a.vehicle_id=${id} and (${canManage} or a.driver_id=${actor.id})
      and a.accepted_at>=${from}::timestamptz and a.accepted_at<${to}::timestamptz
    order by a.accepted_at desc limit 30 offset ${page*30}`;
  const files=canUpload?await sql`select id,kind,mime_type as "mimeType",created_at as "createdAt" from vehicle_files
    where vehicle_id=${id} order by created_at desc limit 30 offset ${page*30}`:[];
  const history=canManage&&canReadHistory?await sql`select a.id,a.action,a.reason,a.occurred_at as "occurredAt",u.full_name as actor
    from vehicle_audit a left join users u on u.id=a.actor_id where a.vehicle_id=${id}
    order by a.occurred_at desc limit 30 offset ${page*30}`:[];
  const claims=actor.admin?await sql`select c.id,c.claimant_id as "claimantId",u.full_name as name,c.evidence_id as "evidenceId",
    c.status,c.reason,c.created_at as "createdAt" from vehicle_ownership_claims c join users u on u.id=c.claimant_id
    where c.vehicle_id=${id} order by c.created_at desc`:[];
  return {vehicle:{id:v.id,identifier:v.identifier,brand:v.brand,model:v.model,color:v.color,unitNumber:v.unit_number,
    maximumPassengers:v.maximum_passengers,status:v.fleet_status,photoId:v.photo_id,cooperativeId:v.cooperative_id,
    declaredOwnerName:canManage?v.declared_owner_name:null},current:canManage?current??null:null,canManage,canUpload,relations,sessions,trips,files,history,claims};
}

export async function requestOwnership(actor:FleetActor,vehicleId:string,evidenceId:string,reason:string){
  z.uuid().parse(evidenceId);z.string().trim().min(10).max(500).parse(reason);
  return database().begin(async tx=>{
    await lock(tx);
    const [evidence]=await tx`select 1 from vehicle_files where id=${evidenceId} and vehicle_id=${vehicleId}
      and uploaded_by=${actor.id} and kind='OWNERSHIP_EVIDENCE'`;
    if(!evidence)throw new FleetError('OWNERSHIP_EVIDENCE_REQUIRED',400);
    const [pending]=await tx`select id from vehicle_ownership_claims where vehicle_id=${vehicleId} and claimant_id=${actor.id} and status='PENDING'`;
    if(pending)return {id:pending.id};
    const [claim]=await tx`insert into vehicle_ownership_claims(vehicle_id,claimant_id,evidence_id,reason)
      values(${vehicleId},${actor.id},${evidenceId},${reason})
      on conflict(vehicle_id,claimant_id) where status='PENDING' do update set reason=vehicle_ownership_claims.reason returning id`;
    await audit(tx,actor,vehicleId,'vehicle_ownership_claim_requested',{claimId:claim!.id},reason);
    return {id:claim!.id};
  });
}
export async function reviewOwnership(actor:FleetActor,id:string,approved:boolean,reason:string){
  if(!actor.admin)throw new FleetError('FORBIDDEN',403);
  z.string().trim().min(5).max(500).parse(reason);
  return database().begin(async tx=>{
    await lock(tx);
    const [claim]=await tx`select * from vehicle_ownership_claims where id=${id} for update`;
    if(!claim)throw new FleetError('CLAIM_NOT_FOUND',404);
    await authorizeVehicle(tx,actor,claim.vehicle_id,true);
    if(claim.status!=='PENDING')return {status:claim.status};
    const status=approved?'APPROVED':'REJECTED';
    await tx`update vehicle_ownership_claims set status=${status},reviewed_by=${actor.id},reviewed_at=now(),review_note=${reason} where id=${id}`;
    if(approved){
      await tx`insert into user_vehicle_relations(user_id,vehicle_id,relation_type,status,source,reviewed_by,reviewed_at,reason)
        values(${claim.claimant_id},${claim.vehicle_id},'OWNER_MANAGER','APPROVED','ADMIN',${actor.id},now(),${reason})
        on conflict(user_id,vehicle_id,relation_type) do update set status='APPROVED',reviewed_by=excluded.reviewed_by,
          reviewed_at=excluded.reviewed_at,reason=excluded.reason`;
    }
    await audit(tx,actor,claim.vehicle_id,approved?'vehicle_ownership_claimed':'vehicle_ownership_claim_rejected',
      {claimId:id,claimantId:claim.claimant_id},reason);
    return {status};
  });
}
