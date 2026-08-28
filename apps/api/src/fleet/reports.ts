import {z} from 'zod';
import {database} from '../database.js';
import {FleetError,type FleetActor} from './service.js';
export const fleetReportSchema=z.object({
  from:z.iso.datetime().default('1970-01-01T00:00:00Z'),to:z.iso.datetime().default('2100-01-01T00:00:00Z'),
  driverId:z.uuid().optional(),vehicleId:z.uuid().optional(),ownerId:z.uuid().optional(),cooperativeId:z.uuid().optional(),
  state:z.enum(['ACTIVE','ENDED']).optional(),endReason:z.enum(['MANUAL_RELEASE','LOGOUT','AUTO_RELEASE','TAKEOVER','VEHICLE_CHANGE','ADMIN_RELEASE']).optional(),
  page:z.coerce.number().int().min(0).max(10000).default(0)
}).refine(v=>v.from<v.to);
export async function fleetReportOptions(actor:FleetActor,search=''){
  z.string().max(80).parse(search);const sql=database();
  const scope=sql`select v.id from vehicles v where v.merged_into is null
    and (${actor.admin===true} or exists(select 1 from user_vehicle_relations r where r.vehicle_id=v.id
      and r.user_id=${actor.id} and r.relation_type='OWNER_MANAGER' and r.status='APPROVED'))
    and (${!actor.cooperativeId} or v.cooperative_id=${actor.cooperativeId??null}::uuid)`;
  const vehicles=await sql`select id,identifier from vehicles where id in (${scope}) and identifier ilike ${`%${search}%`} order by identifier limit 30`;
  const drivers=await sql`select u.id,u.full_name as name from users u where u.deleted_at is null
    and u.full_name ilike ${`%${search}%`} and (exists(select 1 from user_vehicle_relations r where r.user_id=u.id
      and r.relation_type='AUTHORIZED_DRIVER' and r.status='APPROVED' and r.vehicle_id in (${scope}))
      or exists(select 1 from driver_vehicle_sessions s where s.driver_id=u.id and s.vehicle_id in (${scope})))
    order by u.full_name limit 30`;
  return {vehicles,drivers};
}
export async function fleetReport(actor:FleetActor,input:unknown){
  const f=fleetReportSchema.parse(input),sql=database();
  const [cap]=await sql`select capabilities,tier from fleet_entitlements where user_id=${actor.id}`;
  if(!actor.admin&&cap?.capabilities?.reports===false)throw new FleetError('FORBIDDEN',403);
  const scope=sql`select v.id from vehicles v where v.merged_into is null
    and (${actor.admin===true} or exists(select 1 from user_vehicle_relations r where r.vehicle_id=v.id
      and r.user_id=${actor.id} and r.relation_type='OWNER_MANAGER' and r.status='APPROVED'))
    and (${!actor.cooperativeId} or v.cooperative_id=${actor.cooperativeId??null}::uuid)
    and (${!f.cooperativeId} or v.cooperative_id=${f.cooperativeId??null}::uuid)
    and (${!f.vehicleId} or v.id=${f.vehicleId??null}::uuid)
    and (${!f.ownerId} or exists(select 1 from user_vehicle_relations r where r.vehicle_id=v.id
      and r.user_id=${f.ownerId??null}::uuid and r.relation_type='OWNER_MANAGER' and r.status='APPROVED'))`;
  const sessions=sql`select s.* from driver_vehicle_sessions s where s.vehicle_id in (${scope})
    and s.started_at<${f.to}::timestamptz and coalesce(s.ended_at,now())>=${f.from}::timestamptz
    and (${!f.driverId} or s.driver_id=${f.driverId??null}::uuid)
    and (${!f.state} or s.status=${f.state??null}) and (${!f.endReason} or s.end_reason=${f.endReason??null})`;
  const [summary]=await sql`with units as (${scope}), sessions as (${sessions}), assignments as (
      select a.* from vehicle_session_assignments a join sessions s on s.id=a.session_id
      where a.accepted_at>=${f.from}::timestamptz and a.accepted_at<${f.to}::timestamptz)
    select (select count(*)::int from units) as "totalUnits",
      (select count(distinct vehicle_id)::int from sessions) as "activeUnits",
      (select count(distinct driver_id)::int from sessions) as "activeDrivers",
      (select count(*)::int from assignments where outcome='COMPLETED') as completed,
      (select count(*)::int from assignments where outcome in ('DRIVER_CANCELLED','PASSENGER_CANCELLED','CANCELLED')) as cancelled,
      (select count(*)::int from assignments where outcome='INCIDENT') as incidents,
      (select count(*)::int from units where id not in(select vehicle_id from sessions)) as "inactiveUnits",
      (select coalesce(sum(extract(epoch from (least(coalesce(ended_at,now()),${f.to}::timestamptz)-greatest(started_at,${f.from}::timestamptz)))),0)::bigint from sessions) as "operationSeconds",
      (select coalesce(sum(total_cents),0)::bigint from assignments where outcome='COMPLETED') as "totalCents",
      (select coalesce(sum(distance_meters),0) from assignments where outcome='COMPLETED') as "distanceMeters"`;
  const items=await sql`with sessions as (${sessions}) select s.id,s.vehicle_id as "vehicleId",v.identifier,
    s.driver_id as "driverId",u.full_name as "driverName",s.started_at as "startedAt",s.ended_at as "endedAt",
    s.status,s.start_method as "startMethod",s.end_reason as "endReason",s.last_heartbeat as "lastHeartbeat",
    (select count(*)::int from vehicle_session_assignments a where a.session_id=s.id) as accepted,
    count(*) over()::int as "totalCount"
    from sessions s join users u on u.id=s.driver_id join vehicles v on v.id=s.vehicle_id
    order by s.started_at desc limit 30 offset ${f.page*30}`;
  return {summary,items,capabilities:cap?.capabilities??{history:true,reports:true,notifications:true},tier:cap?.tier??'BASIC'};
}
