import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {database} from './database.js';

export const preferenceKeys=[
  'PASSENGER_SMART_RECOMMENDATIONS',
  'PASSENGER_SCHEDULED_TRIP_REMINDERS',
  'DRIVER_MEMBERSHIP_REMINDERS',
  'DRIVER_DOCUMENT_EXPIRATION_REMINDERS',
  'PROMOTIONAL_NOTIFICATIONS'
] as const;
export type NotificationPreferenceKey=typeof preferenceKeys[number];
export type NotificationPreferenceContext='PASSENGER'|'DRIVER'|'COMMON';

const contextFor=(key:NotificationPreferenceKey):NotificationPreferenceContext=>
  key.startsWith('PASSENGER_')?'PASSENGER':key.startsWith('DRIVER_')?'DRIVER':'COMMON';

export async function notificationPreference(userId:string,key:NotificationPreferenceKey){
  const context=contextFor(key);
  const [row]=await database()`select enabled,state,auto_paused_until as "autoPausedUntil",ignored_streak as "ignoredStreak",modified_source as source,updated_at as "updatedAt"
    from user_notification_preferences where user_id=${userId} and context=${context} and preference_key=${key}`;
  if(!row)return {key,context,enabled:true,state:'ENABLED',autoPausedUntil:null,ignoredStreak:0,source:'DEFAULT',updatedAt:null};
  if(row.state==='AUTO_PAUSED'&&row.autoPausedUntil&&new Date(row.autoPausedUntil).getTime()<=Date.now()){
    const [resumed]=await database()`update user_notification_preferences set enabled=true,state='ENABLED',auto_paused_until=null,ignored_streak=0,modified_source='SYSTEM',updated_at=now()
      where user_id=${userId} and context=${context} and preference_key=${key} and state='AUTO_PAUSED'
      returning enabled,state,auto_paused_until as "autoPausedUntil",ignored_streak as "ignoredStreak",modified_source as source,updated_at as "updatedAt"`;
    return {key,context,...resumed};
  }
  return {key,context,...row,enabled:Boolean(row.enabled)};
}

export async function notificationPreferenceAllows(userId:string,key:NotificationPreferenceKey){
  const value=await notificationPreference(userId,key);
  return value.enabled&&value.state==='ENABLED';
}

export async function updateSmartSaturation(userId:string,config:{ignoredToReduceFrequency:number;ignoredToPause:number;autoPauseDays:number}):Promise<any>{
  const current=await notificationPreference(userId,'PASSENGER_SMART_RECOMMENDATIONS');
  if(current.state==='USER_DISABLED')return {...current,reduced:false};
  const recent=await database()`select n.id::text,
      exists(select 1 from notification_analytics_events e where e.notification_id=n.id and e.event in ('OPENED','DEEP_LINK_OPENED','TRIP_PREPARATION_OPENED','TRIP_REQUESTED','TRIP_COMPLETED')) as engaged
    from user_notifications n where n.user_id=${userId} and n.category='SMART' and n.status='SENT' and n.push_sent_at<now()-interval '24 hours'
    order by n.push_sent_at desc limit ${Math.max(config.ignoredToPause,config.ignoredToReduceFrequency)+2}`;
  let ignored=0;
  for(const item of recent){if(item.engaged)break;ignored++;}
  if(recent.some(item=>item.engaged)&&ignored===0&&current.state==='AUTO_PAUSED'){
    await database()`update user_notification_preferences set enabled=true,state='ENABLED',auto_paused_until=null,ignored_streak=0,modified_source='SYSTEM',updated_at=now()
      where user_id=${userId} and context='PASSENGER' and preference_key='PASSENGER_SMART_RECOMMENDATIONS' and state='AUTO_PAUSED'`;
  }
  if(ignored>=config.ignoredToPause){
    const [paused]=await database()`insert into user_notification_preferences(user_id,context,preference_key,enabled,state,auto_paused_until,ignored_streak,modified_source)
      values (${userId},'PASSENGER','PASSENGER_SMART_RECOMMENDATIONS',false,'AUTO_PAUSED',now()+(${config.autoPauseDays}*interval '1 day'),${ignored},'SYSTEM')
      on conflict(user_id,context,preference_key) do update set enabled=case when user_notification_preferences.state='USER_DISABLED' then false else false end,
        state=case when user_notification_preferences.state='USER_DISABLED' then 'USER_DISABLED' else 'AUTO_PAUSED' end,
        auto_paused_until=case when user_notification_preferences.state='USER_DISABLED' then null else excluded.auto_paused_until end,
        ignored_streak=${ignored},modified_source=case when user_notification_preferences.state='USER_DISABLED' then user_notification_preferences.modified_source else 'SYSTEM' end,updated_at=now()
      returning enabled,state,auto_paused_until as "autoPausedUntil",ignored_streak as "ignoredStreak",modified_source as source,updated_at as "updatedAt"`;
    return {key:'PASSENGER_SMART_RECOMMENDATIONS',context:'PASSENGER',...paused,reduced:false};
  }
  await database()`insert into user_notification_preferences(user_id,context,preference_key,enabled,state,ignored_streak,modified_source)
    values (${userId},'PASSENGER','PASSENGER_SMART_RECOMMENDATIONS',true,'ENABLED',${ignored},'SYSTEM')
    on conflict(user_id,context,preference_key) do update set ignored_streak=${ignored},updated_at=now()
    where user_notification_preferences.state<>'USER_DISABLED'`;
  return {...await notificationPreference(userId,'PASSENGER_SMART_RECOMMENDATIONS'),reduced:ignored>=config.ignoredToReduceFrequency};
}

type AuthenticatedUser=(request:any,reply:any,options?:any)=>Promise<any>;
export async function registerNotificationPreferenceRoutes(app:FastifyInstance,authenticatedUser:AuthenticatedUser){
  app.get('/v1/account/notification-preferences',async(request,reply)=>{
    const user=await authenticatedUser(request,reply,{allowPendingDriver:true});if(!user)return;
    const roles=(await database()`select role from mobile_account_roles where user_id=${user.id} order by role`).map(row=>String(row.role));
    const values=await Promise.all(preferenceKeys.map(key=>notificationPreference(user.id,key)));
    const [device]=await database()`select enabled,platform,last_seen_at as "lastSeenAt" from device_tokens where user_id=${user.id} and invalidated_at is null order by last_seen_at desc limit 1`;
    return {activeRole:user.role,availableRoles:roles,systemPermission:{enabled:Boolean(device?.enabled),known:Boolean(device),platform:device?.platform??null,lastSeenAt:device?.lastSeenAt??null},preferences:Object.fromEntries(values.map(value=>[value.key,value]))};
  });
  app.put('/v1/account/notification-preferences/:key',async(request,reply)=>{
    const user=await authenticatedUser(request,reply,{allowPendingDriver:true});if(!user)return;
    const key=z.enum(preferenceKeys).parse((request.params as any).key);
    const body=z.object({enabled:z.boolean()}).parse(request.body);
    const context=contextFor(key);
    const roles=(await database()`select role from mobile_account_roles where user_id=${user.id}`).map(row=>String(row.role));
    if(context!=='COMMON'&&!roles.includes(context))return reply.code(403).send({error:'ROLE_NOT_AVAILABLE'});
    const [value]=await database()`insert into user_notification_preferences(user_id,context,preference_key,enabled,state,auto_paused_until,ignored_streak,modified_source)
      values (${user.id},${context},${key},${body.enabled},${body.enabled?'ENABLED':'USER_DISABLED'},null,0,'USER')
      on conflict(user_id,context,preference_key) do update set enabled=excluded.enabled,state=excluded.state,auto_paused_until=null,ignored_streak=0,modified_source='USER',updated_at=now()
      returning enabled,state,auto_paused_until as "autoPausedUntil",ignored_streak as "ignoredStreak",modified_source as source,updated_at as "updatedAt"`;
    return {key,context,...value};
  });
}
