import {database} from '../database.js';
import {sendPush} from '../push.js';
export async function deliverFleetNotifications(){
  const rows=await database().begin(async tx=>{
    const pending=await tx`select o.id,o.user_id,o.vehicle_id,o.event,v.identifier,u.full_name as driver_name
      from fleet_notification_outbox o join vehicles v on v.id=o.vehicle_id
      join vehicle_audit a on a.id=o.audit_id left join users u on u.id=a.driver_id
      where (o.status='PENDING' or (o.status='SENDING' and o.updated_at<now()-interval '5 minutes'))
      and o.attempts<3 order by o.updated_at limit 20 for update of o skip locked`;
    for(const row of pending)await tx`update fleet_notification_outbox set status='SENDING',attempts=attempts+1,updated_at=now() where id=${row.id}`;
    return pending;
  });
  for(const row of rows){
    const title=row.event==='session_started'?'Jornada iniciada':row.event==='vehicle_takeover'?'Cambio de conductor':'Jornada finalizada';
    try{
      const [allowed]=await database()`select 1 from user_vehicle_relations r join users recipient on recipient.id=r.user_id
        cross join fleet_settings settings left join fleet_entitlements e on e.user_id=r.user_id
        where r.user_id=${row.user_id} and r.vehicle_id=${row.vehicle_id} and r.relation_type='OWNER_MANAGER'
          and r.status='APPROVED' and recipient.deleted_at is null and recipient.status='ACTIVE'
          and settings.owner_notifications and coalesce((e.capabilities->>'notifications')::boolean,true)
          and (e.user_id is null or ${row.event}=any(e.notification_events))`;
      if(!allowed){await database()`update fleet_notification_outbox set status='FAILED',updated_at=now() where id=${row.id}`;continue;}
      const result=await sendPush(String(row.user_id),title,`${row.identifier} · ${row.driver_name??'Consulta la actividad de tu unidad'}`,{
        type:'FLEET_SESSION',notificationRoute:'FLEET',vehicleId:String(row.vehicle_id),eventId:String(row.id),
      });
      await database()`update fleet_notification_outbox set status=${result.sent>0||result.skipped?'SENT':'FAILED'},updated_at=now() where id=${row.id}`;
    }catch{await database()`update fleet_notification_outbox set status='FAILED',updated_at=now() where id=${row.id}`;}
  }
}
