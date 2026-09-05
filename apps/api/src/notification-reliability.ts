import {hostname} from 'node:os';
import {database} from './database.js';
import {normalizePushData,sendPush} from './push.js';
import type {NotificationPriority} from './user-notifications.js';

export const immediatePriorities=new Set<NotificationPriority>(['SECURITY','TRIP_CRITICAL']);
const transientCodes=['messaging/internal-error','messaging/server-unavailable','messaging/unknown-error','app/network-error','ECONNRESET','ETIMEDOUT'];

export function notificationTtlMs(priority:NotificationPriority,type=''):number{
  if(type==='TRIP_OFFER')return 90_000;
  if(priority==='SECURITY')return 15*60_000;
  if(priority==='TRIP_CRITICAL')return 10*60_000;
  if(priority==='OPERATIONAL'||priority==='REMINDER')return 24*60*60_000;
  if(priority==='SYSTEM')return 7*24*60*60_000;
  return 3*24*60*60_000;
}

export function retryDelaySeconds(attempt:number,base=30):number{
  return Math.min(3600,base*Math.pow(2,Math.max(0,attempt-1)));
}

export function isRetriablePushError(code?:string):boolean{
  return Boolean(code&&transientCodes.some(value=>code.includes(value)));
}

export async function enqueueNotification(input:{notificationId:string;userId:string;priority:NotificationPriority;expiresAt:Date;collapseKey:string}):Promise<void>{
  await database().begin(async tx=>{
    const replaced=await tx`update notification_delivery_jobs set status='SKIPPED',completed_at=now(),last_error_code='notification/replaced',last_error_message='Reemplazada por una notificación más reciente',updated_at=now() where user_id=${input.userId} and collapse_key=${input.collapseKey} and notification_id<>${input.notificationId} and status in('QUEUED','RETRY') returning notification_id::text id`;
    if(replaced.length)await tx`update user_notifications set status='SKIPPED',error_code='notification/replaced',error_message='Reemplazada por una notificación más reciente' where id=any(${replaced.map(row=>String(row.id))}::uuid[])`;
    await tx`insert into notification_delivery_jobs(notification_id,user_id,priority,expires_at,collapse_key,max_attempts)
      select ${input.notificationId},${input.userId},${input.priority},${input.expiresAt},${input.collapseKey},max_attempts from notification_delivery_config where id=1
      on conflict(notification_id) do nothing`;
    await tx`update user_notifications set status='QUEUED',expires_at=${input.expiresAt},collapse_key=${input.collapseKey} where id=${input.notificationId}`;
  });
}

async function circuitOpen():Promise<boolean>{
  const [config]=await database()`select circuit_failure_threshold as threshold,circuit_window_minutes as window,circuit_cooldown_minutes as cooldown from notification_delivery_config where id=1`;
  const [open]=await database()`select id from notification_provider_incidents where state='OPEN' and opened_at>now()-(${Number(config?.cooldown??10)}||' minutes')::interval order by opened_at desc limit 1`;
  if(open)return true;
  const [failures]=await database()`select count(*)::int count from push_delivery_events where status='FAILED' and created_at>now()-(${Number(config?.window??5)}||' minutes')::interval`;
  if(Number(failures?.count??0)>=Number(config?.threshold??10)){
    await database()`insert into notification_provider_incidents(state,reason,failure_count) values('OPEN','Umbral de fallos del proveedor superado',${Number(failures?.count??0)})`;
    return true;
  }
  await database()`update notification_provider_incidents set state='CLOSED',closed_at=now() where state='OPEN' and opened_at<=now()-(${Number(config?.cooldown??10)}||' minutes')::interval`;
  return false;
}

export async function notificationDeliveryTick():Promise<{processed:number}> {
  if(!process.env.DATABASE_URL)return {processed:0};
  await database()`update notification_delivery_jobs set status='RETRY',locked_at=null,locked_by=null,next_attempt_at=now(),updated_at=now()
    where status='PROCESSING' and locked_at<now()-interval '5 minutes'`;
  await database()`update notification_delivery_jobs set status='EXPIRED',completed_at=now(),updated_at=now()
    where status in ('QUEUED','RETRY') and expires_at<=now()`;
  await database()`update user_notifications n set status='EXPIRED' from notification_delivery_jobs j where j.notification_id=n.id and j.status='EXPIRED' and n.status<>'EXPIRED'`;
  const paused=await circuitOpen();
  const [config]=await database()`select batch_size as "batchSize",base_backoff_seconds as "baseBackoff" from notification_delivery_config where id=1`;
  const rows=await database().begin(async tx=>tx`with selected as (
      select j.id from notification_delivery_jobs j where j.status in ('QUEUED','RETRY') and j.next_attempt_at<=now() and j.expires_at>now()
        and (not ${paused} or j.priority in ('SECURITY','TRIP_CRITICAL'))
      order by case j.priority when 'SECURITY' then 1 when 'TRIP_CRITICAL' then 2 when 'OPERATIONAL' then 3 when 'REMINDER' then 4 when 'SMART' then 5 when 'SYSTEM' then 6 when 'CAMPAIGN' then 7 else 8 end,j.created_at
      for update skip locked limit ${Number(config?.batchSize??50)}
    ) update notification_delivery_jobs j set status='PROCESSING',locked_at=now(),locked_by=${hostname()},attempts=j.attempts+1,updated_at=now()
      from selected where j.id=selected.id returning j.id::text,j.notification_id::text as "notificationId",j.user_id::text as "userId",j.priority,j.attempts,j.max_attempts as "maxAttempts",j.expires_at as "expiresAt",j.collapse_key as "collapseKey"`);
  for(const job of rows){
    const [notification]=await database()`select title,message,notification_type as type,reference_id as "referenceId",deep_link as "deepLink",action,data from user_notifications where id=${job.notificationId}`;
    if(!notification)continue;
    const data=normalizePushData({...(notification.data??{}),type:String(notification.type),internalNotificationId:String(job.notificationId),notificationPriority:String(job.priority)});
    if(notification.referenceId)data.referenceId=String(notification.referenceId);
    if(notification.deepLink)data.deepLink=String(notification.deepLink);
    if(notification.action)data.action=String(notification.action);
    const started=Date.now();
    const result=await sendPush(String(job.userId),String(notification.title),String(notification.message),data,{expiresAt:new Date(job.expiresAt),collapseKey:String(job.collapseKey),priority:job.priority});
    const code=result.errorCode??result.errors?.[0]?.code;
    const success=result.sent>0;
    const terminal=!isRetriablePushError(code)||Number(job.attempts)>=Number(job.maxAttempts);
    const status=success?'SENT':result.skipped?'SKIPPED':terminal?'DEAD_LETTER':'RETRY';
    const delay=retryDelaySeconds(Number(job.attempts),Number(config?.baseBackoff??30));
    await database().begin(async tx=>{
      await tx`update notification_delivery_jobs set status=${status},next_attempt_at=case when ${status}='RETRY' then now()+(${delay}||' seconds')::interval else next_attempt_at end,
        completed_at=case when ${status} in ('SENT','SKIPPED','DEAD_LETTER') then now() else null end,locked_at=null,locked_by=null,last_error_code=${code??null},last_error_message=${result.errors?.[0]?.message??null},processing_ms=${Date.now()-started},updated_at=now() where id=${job.id}`;
      await tx`update user_notifications set status=${status},attempt_count=${Number(job.attempts)},last_attempt_at=now(),processing_started_at=null,
        push_sent_at=case when ${success} then now() else push_sent_at end,error_code=${code??null},error_message=${result.errors?.[0]?.message??null} where id=${job.notificationId}`;
      await tx`insert into notification_analytics_events(notification_id,user_id,event,metadata) values(${job.notificationId},${job.userId},${success?'SENT':status},${JSON.stringify({attempt:job.attempts,attempted:result.attempted??0,sent:result.sent,failed:result.failed??0})}::jsonb)`;
      await tx`update notification_campaign_recipients set status=case when ${success} then 'SENT' when ${status}='RETRY' then 'QUEUED' else 'FAILED' end,sent_at=case when ${success} then now() else sent_at end,error_code=${code??null},error_message=${result.errors?.[0]?.message??null} where notification_id=${job.notificationId}`;
      await tx`update notification_campaigns c set status='SENT',completed_at=now(),updated_at=now() where c.status='PROCESSING' and exists(select 1 from notification_campaign_recipients r where r.campaign_id=c.id and r.notification_id=${job.notificationId}) and not exists(select 1 from notification_campaign_recipients pending where pending.campaign_id=c.id and pending.status='QUEUED')`;
    });
  }
  return {processed:rows.length};
}

export async function notificationRetentionTick():Promise<void>{
  if(!process.env.DATABASE_URL)return;
  const [config]=await database()`select analytics_retention_days as analytics,delivery_retention_days as delivery from notification_delivery_config where id=1`;
  await database()`delete from notification_analytics_events where occurred_at<now()-(${Number(config?.analytics??180)}||' days')::interval`;
  await database()`delete from push_delivery_events where created_at<now()-(${Number(config?.delivery??90)}||' days')::interval`;
  await database()`delete from notification_delivery_jobs where completed_at<now()-(${Number(config?.delivery??90)}||' days')::interval`;
}

export async function notificationSystemHealth(){
  const [queue]=await database()`select count(*) filter(where status in ('QUEUED','RETRY'))::int queued,count(*) filter(where status='PROCESSING')::int processing,count(*) filter(where status='DEAD_LETTER')::int "deadLetter",coalesce(avg(processing_ms) filter(where completed_at>now()-interval '24 hours'),0)::int as "averageProcessingMs" from notification_delivery_jobs`;
  const [delivery]=await database()`select count(*)::int attempted,count(*) filter(where status in ('SENT','PARTIAL'))::int successful,count(*) filter(where status='FAILED')::int failed from push_delivery_events where created_at>now()-interval '24 hours'`;
  const [tokens]=await database()`select count(*) filter(where enabled and invalidated_at is null)::int valid,count(*) filter(where invalidated_at is not null)::int invalid from device_tokens`;
  const incidents=await database()`select id,state,reason,failure_count as "failureCount",opened_at as "openedAt",closed_at as "closedAt" from notification_provider_incidents order by opened_at desc limit 10`;
  const errors=await database()`select event_type as "type",error_codes as "errorCodes",created_at as "createdAt" from push_delivery_events where status in ('FAILED','PARTIAL') order by created_at desc limit 20`;
  const attempted=Number(delivery?.attempted??0),successful=Number(delivery?.successful??0);
  return {provider:'FCM',circuit:incidents[0]?.state==='OPEN'?'OPEN':'CLOSED',queue:queue??{},delivery:{...(delivery??{}),successRate:attempted?Math.round(successful/attempted*10000)/100:100},tokens:tokens??{},incidents,errors};
}

export async function notificationUserDiagnostic(query:string){
  const search=`%${query.replace(/[\\%_]/g,'\\$&')}%`;
  const users=await database()`select u.id::text,u.full_name as name,u.email,u.role::text,u.status,u.active_session_id::text as "activeSessionId",
      coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'deviceId',d.device_id,'platform',d.platform,'enabled',d.enabled,'permission',d.permission_status,'lastActivity',d.last_seen_at,'appVersion',d.app_version,'appBuild',d.app_build,'invalidatedAt',d.invalidated_at,'invalidatedReason',d.invalidated_reason,'providerError',d.provider_error_code) order by d.last_seen_at desc) from device_tokens d where d.user_id=u.id),'[]'::jsonb) devices,
      coalesce((select jsonb_agg(jsonb_build_object('context',p.context,'preference',p.preference_key,'enabled',p.enabled,'state',p.state,'autoPausedUntil',p.auto_paused_until)) from user_notification_preferences p where p.user_id=u.id),'[]'::jsonb) preferences,
      (select jsonb_build_object('id',n.id,'type',n.notification_type,'status',n.status,'sentAt',n.push_sent_at,'openedAt',n.opened_at,'errorCode',n.error_code,'errorMessage',n.error_message) from user_notifications n where n.user_id=u.id order by n.created_at desc limit 1) as "lastNotification"
    from users u where u.deleted_at is null and (u.email ilike ${search} or u.full_name ilike ${search} or coalesce(u.phone_e164,'') ilike ${search}) order by u.full_name limit 20`;
  return {items:users};
}
