import type {FastifyInstance} from 'fastify';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {database} from './database.js';
import {notificationService,type NotificationCommand} from './notification-service.js';
import {requirePermission} from './admin.js';

const modes=['OFF','TEST','ON'] as const;
const patternTypes=['FREQUENT_TRIP','RETURN_HOME','FAVORITE_DESTINATION','REACTIVATION'] as const;
const campaignTypes=['CAMPAIGN','EVENT','PROMOTIONAL'] as const;
const configSchema=z.object({
  mode:z.enum(modes),frequentTripEnabled:z.boolean(),returnTripEnabled:z.boolean(),favoriteDestinationEnabled:z.boolean(),reactivationEnabled:z.boolean(),
  minimumTrips:z.number().int().min(2).max(100),minimumMatches:z.number().int().min(2).max(100),minimumConfidence:z.number().min(0).max(100),
  analysisWindowDays:z.number().int().min(7).max(365),scheduleToleranceMinutes:z.number().int().min(5).max(180),notificationLeadMinutes:z.number().int().min(1).max(180),
  maxPerUserPerDay:z.number().int().min(0).max(20),minimumIntervalMinutes:z.number().int().min(1).max(10080),
  allowedStartTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),allowedEndTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  enabledWeekDays:z.array(z.number().int().min(1).max(7)).min(1).max(7),inactiveUserDays:z.number().int().min(7).max(365),schedulerIntervalMinutes:z.number().int().min(1).max(1440)
}).refine(v=>v.allowedStartTime<v.allowedEndTime,{message:'INVALID_ALLOWED_TIME'});
const segmentSchema=z.object({zones:z.array(z.string().min(1).max(100)).max(50).default([]),roles:z.array(z.enum(['PASSENGER','DRIVER'])).max(2).default([]),platforms:z.array(z.enum(['ANDROID','IOS'])).max(2).default([]),activeWithinDays:z.number().int().min(1).max(365).optional(),userIds:z.array(z.string().uuid()).max(500).default([])});
const campaignSchema=z.object({name:z.string().trim().min(3).max(120),campaignType:z.enum(campaignTypes),title:z.string().trim().min(1).max(120),body:z.string().trim().min(1).max(500),deepLink:z.string().trim().max(500).optional().or(z.literal('')),action:z.string().trim().max(80).optional().or(z.literal('')),metadata:z.record(z.string(),z.unknown()).default({}),segment:segmentSchema.default({zones:[],roles:[],platforms:[],userIds:[]})});
function storedJson(value:unknown){if(typeof value!=='string')return value;try{return JSON.parse(value);}catch{return value;}}
const testSendSchema=z.object({userId:z.string().uuid(),type:z.string().trim().min(2).max(80).default('TEST_PUSH'),title:z.string().trim().min(1).max(120),message:z.string().trim().min(1).max(500),action:z.string().trim().max(80).optional(),deepLink:z.string().trim().max(500).optional(),destination:z.object({reference:z.string().trim().min(1).max(200),latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180)}).optional()});

type Config=z.infer<typeof configSchema> & {lastSchedulerRunAt?:string;updatedAt?:string};
type PatternType=typeof patternTypes[number];
export function smartModeReasons(mode:'OFF'|'TEST'|'ON',tester:boolean):string[]{
  if(mode==='OFF')return ['SMART_MODE_OFF'];
  if(mode==='TEST'&&!tester)return ['TEST_USER_NOT_ALLOWED'];
  return [];
}
function number(value:unknown){return Number(value??0);}
function time(value:unknown){return String(value??'').slice(0,5);}
function configFrom(row:any):Config{return {mode:row.mode,frequentTripEnabled:Boolean(row.frequentTripEnabled),returnTripEnabled:Boolean(row.returnTripEnabled),favoriteDestinationEnabled:Boolean(row.favoriteDestinationEnabled),reactivationEnabled:Boolean(row.reactivationEnabled),minimumTrips:number(row.minimumTrips),minimumMatches:number(row.minimumMatches),minimumConfidence:number(row.minimumConfidence),analysisWindowDays:number(row.analysisWindowDays),scheduleToleranceMinutes:number(row.scheduleToleranceMinutes),notificationLeadMinutes:number(row.notificationLeadMinutes),maxPerUserPerDay:number(row.maxPerUserPerDay),minimumIntervalMinutes:number(row.minimumIntervalMinutes),allowedStartTime:time(row.allowedStartTime),allowedEndTime:time(row.allowedEndTime),enabledWeekDays:(row.enabledWeekDays??[]).map(Number),inactiveUserDays:number(row.inactiveUserDays),schedulerIntervalMinutes:number(row.schedulerIntervalMinutes),lastSchedulerRunAt:row.lastSchedulerRunAt?new Date(row.lastSchedulerRunAt).toISOString():undefined,updatedAt:row.updatedAt?new Date(row.updatedAt).toISOString():undefined};}
async function smartConfig():Promise<Config>{
  const [row]=await database()`select mode,frequent_trip_enabled as "frequentTripEnabled",return_trip_enabled as "returnTripEnabled",favorite_destination_enabled as "favoriteDestinationEnabled",reactivation_enabled as "reactivationEnabled",minimum_trips as "minimumTrips",minimum_matches as "minimumMatches",minimum_confidence::float8 as "minimumConfidence",analysis_window_days as "analysisWindowDays",schedule_tolerance_minutes as "scheduleToleranceMinutes",notification_lead_minutes as "notificationLeadMinutes",max_per_user_per_day as "maxPerUserPerDay",minimum_interval_minutes as "minimumIntervalMinutes",allowed_start_time::text as "allowedStartTime",allowed_end_time::text as "allowedEndTime",enabled_week_days as "enabledWeekDays",inactive_user_days as "inactiveUserDays",scheduler_interval_minutes as "schedulerIntervalMinutes",last_scheduler_run_at as "lastSchedulerRunAt",updated_at as "updatedAt" from smart_notification_config where id=1`;
  return configFrom(row);
}
function normalized(value:unknown){return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();}
function patternKey(type:PatternType,userId:string,origin:string,destination:string){return createHash('sha256').update(`${type}|${userId}|${normalized(origin)}|${normalized(destination)}`).digest('hex');}
function ecuParts(date:Date){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Guayaquil',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);const get=(name:string)=>parts.find(p=>p.type===name)?.value??'';const week:{[key:string]:number}={Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6,Sun:7};return {weekDay:week[get('weekday')]??1,minutes:Number(get('hour'))*60+Number(get('minute'))};}
function averageTime(values:number[]){const average=Math.round(values.reduce((sum,value)=>sum+value,0)/Math.max(values.length,1));return `${String(Math.floor(average/60)%24).padStart(2,'0')}:${String(average%60).padStart(2,'0')}`;}

export async function analyzeSmartPatterns(userId?:string):Promise<{usersAnalyzed:number;patternsDetected:number}>{
  const config=await smartConfig();
  const rows=await database()`select t.id::text,t.passenger_id::text as "userId",t.origin_reference as "originReference",t.destination_reference as "destinationReference",t.requested_at as "requestedAt",t.completed_at as "completedAt",ST_Y(t.origin::geometry)::float8 as "originLat",ST_X(t.origin::geometry)::float8 as "originLng",ST_Y(t.destination::geometry)::float8 as "destinationLat",ST_X(t.destination::geometry)::float8 as "destinationLng",favorite.id::text as "favoriteId",favorite.label as "favoriteLabel"
    from trips t join users u on u.id=t.passenger_id
    left join lateral(select f.id,f.label from favorite_places f where f.user_id=t.passenger_id and t.destination is not null and ST_DWithin(f.location,t.destination,150) order by ST_Distance(f.location,t.destination) limit 1) favorite on true
    where t.status='COMPLETED' and t.completed_at>=now()-(${config.analysisWindowDays}*interval '1 day') and t.origin is not null and t.destination is not null and u.status='ACTIVE' and u.deleted_at is null
      and (${userId??null}::uuid is null or t.passenger_id=${userId??null}::uuid)
      and exists(select 1 from device_tokens d where d.user_id=u.id and d.enabled and d.invalidated_at is null and d.last_seen_at>now()-interval '90 days')
    order by t.passenger_id,t.completed_at desc limit 10000`;
  const byUser=new Map<string,any[]>();for(const row of rows){const list=byUser.get(String(row.userId))??[];list.push(row);byUser.set(String(row.userId),list);}
  let detected=0;
  for(const [candidateId,trips] of byUser){
    await database()`update smart_notification_patterns set is_active=false,last_evaluated_at=now(),updated_at=now() where user_id=${candidateId}`;
    const groups=new Map<string,any[]>();for(const trip of trips){const key=`${normalized(trip.originReference)}|${normalized(trip.destinationReference)}`;const list=groups.get(key)??[];list.push(trip);groups.set(key,list);}
    for(const group of groups.values()){
      if(group.length<config.minimumMatches)continue;
      const origin=String(group[0].originReference??'Origen habitual'),destination=String(group[0].destinationReference??'Destino habitual');
      const times=group.map(item=>ecuParts(new Date(item.requestedAt)).minutes),weekDays=[...new Set(group.map(item=>ecuParts(new Date(item.requestedAt)).weekDay))].sort();
      const confidence=Math.min(100,Math.round(group.length/Math.max(trips.length,config.minimumTrips)*10000)/100);
      const variants:Array<{type:PatternType;favoriteId?:string}>=[{type:'FREQUENT_TRIP'}];
      if(group[0].favoriteId)variants.push({type:'FAVORITE_DESTINATION',favoriteId:String(group[0].favoriteId)});
      if(/casa|hogar|home/.test(normalized(group[0].favoriteLabel??destination)))variants.push({type:'RETURN_HOME',favoriteId:group[0].favoriteId?String(group[0].favoriteId):undefined});
      for(const variant of variants){
        const key=patternKey(variant.type,candidateId,origin,destination);
        await database()`insert into smart_notification_patterns(user_id,pattern_key,pattern_type,origin_reference,destination_reference,origin_lat,origin_lng,destination_lat,destination_lng,favorite_destination_id,week_days,average_time,time_tolerance_minutes,matches_count,trips_analyzed,confidence_score,is_active)
          values (${candidateId},${key},${variant.type},${origin},${destination},${number(group[0].originLat)},${number(group[0].originLng)},${number(group[0].destinationLat)},${number(group[0].destinationLng)},${variant.favoriteId??null},${weekDays},${averageTime(times)}::time,${config.scheduleToleranceMinutes},${group.length},${trips.length},${confidence},true)
          on conflict(user_id,pattern_key) do update set week_days=excluded.week_days,average_time=excluded.average_time,time_tolerance_minutes=excluded.time_tolerance_minutes,matches_count=excluded.matches_count,trips_analyzed=excluded.trips_analyzed,confidence_score=excluded.confidence_score,last_detected_at=now(),last_evaluated_at=now(),is_active=true,updated_at=now()`;
        detected++;
      }
    }
  }
  if(config.reactivationEnabled){
    const inactive=await database()`select u.id::text as "userId",max(t.completed_at) as "lastTripAt",count(t.id)::int as trips from users u join trips t on t.passenger_id=u.id and t.status='COMPLETED' where u.status='ACTIVE' and u.deleted_at is null and (${userId??null}::uuid is null or u.id=${userId??null}::uuid) group by u.id having max(t.completed_at)<now()-(${config.inactiveUserDays}*interval '1 day') limit 1000`;
    for(const row of inactive){const key=patternKey('REACTIVATION',String(row.userId),'','');await database()`insert into smart_notification_patterns(user_id,pattern_key,pattern_type,matches_count,trips_analyzed,confidence_score,last_detected_at,is_active) values (${row.userId},${key},'REACTIVATION',${number(row.trips)},${number(row.trips)},100,${row.lastTripAt},true) on conflict(user_id,pattern_key) do update set matches_count=excluded.matches_count,trips_analyzed=excluded.trips_analyzed,confidence_score=100,last_evaluated_at=now(),is_active=true,updated_at=now()`;detected++;}
  }
  return {usersAnalyzed:byUser.size,patternsDetected:detected};
}

async function eligibility(patternId:string,providedConfig?:Config):Promise<any>{
  const config=providedConfig??await smartConfig();
  const [row]=await database()`select p.id::text,p.user_id::text as "userId",p.pattern_type as type,p.origin_reference as origin,p.destination_reference as destination,p.destination_lat as "destinationLat",p.destination_lng as "destinationLng",p.week_days as "weekDays",p.average_time::text as "averageTime",p.matches_count as matches,p.trips_analyzed as "tripsAnalyzed",p.confidence_score::float8 as confidence,u.full_name as user,
    exists(select 1 from notification_test_users x where x.user_id=p.user_id and x.enabled) as tester,
    exists(select 1 from device_tokens d where d.user_id=p.user_id and d.invalidated_at is null) as "hasToken",
    exists(select 1 from device_tokens d where d.user_id=p.user_id and d.enabled and d.invalidated_at is null and d.last_seen_at>now()-interval '90 days') as "validToken",
    exists(select 1 from trips active where (active.passenger_id=p.user_id or active.driver_id=p.user_id) and active.status in ('SEARCHING','ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS')) as "activeTrip",
    (select count(*)::int from user_notifications n where n.user_id=p.user_id and n.category='SMART' and n.created_at>=date_trunc('day',now() at time zone 'America/Guayaquil') at time zone 'America/Guayaquil') as "sentToday",
    (select max(created_at) from user_notifications n where n.user_id=p.user_id and n.category='SMART' and n.status='SENT') as "lastSmartAt",
    exists(select 1 from trips recent where recent.passenger_id=p.user_id and recent.requested_at>now()-(${config.minimumIntervalMinutes}*interval '1 minute') and recent.status not in ('CANCELLED','NO_DRIVER') and recent.destination is not null and p.destination_lat is not null and ST_DWithin(recent.destination,ST_SetSRID(ST_MakePoint(p.destination_lng,p.destination_lat),4326)::geography,150)) as "recentEquivalentTrip"
    from smart_notification_patterns p join users u on u.id=p.user_id where p.id=${patternId} and p.is_active`;
  if(!row)return {eligible:false,score:0,reasons:['PATTERN_NOT_FOUND']};
  const reasons:string[]=[];const parts=ecuParts(new Date());
  reasons.push(...smartModeReasons(config.mode,Boolean(row.tester)));
  const enabled=row.type==='FREQUENT_TRIP'?config.frequentTripEnabled:row.type==='RETURN_HOME'?config.returnTripEnabled:row.type==='FAVORITE_DESTINATION'?config.favoriteDestinationEnabled:config.reactivationEnabled;
  if(!enabled)reasons.push('PATTERN_TYPE_DISABLED');
  if(number(row.tripsAnalyzed)<config.minimumTrips)reasons.push('INSUFFICIENT_TRIPS');
  if(number(row.matches)<config.minimumMatches)reasons.push('INSUFFICIENT_MATCHES');
  if(number(row.confidence)<config.minimumConfidence)reasons.push('CONFIDENCE_TOO_LOW');
  if(row.hasToken&&!row.validToken)reasons.push('NOTIFICATIONS_DISABLED');else if(!row.validToken)reasons.push('INVALID_FCM_TOKEN');
  if(row.activeTrip)reasons.push('ACTIVE_TRIP_EXISTS');
  if(row.recentEquivalentTrip)reasons.push('RECENT_EQUIVALENT_TRIP');
  if(!config.enabledWeekDays.includes(parts.weekDay))reasons.push('WEEKDAY_DISABLED');
  const nowTime=`${String(Math.floor(parts.minutes/60)).padStart(2,'0')}:${String(parts.minutes%60).padStart(2,'0')}`;if(nowTime<config.allowedStartTime||nowTime>config.allowedEndTime)reasons.push('OUTSIDE_ALLOWED_TIME');
  if(number(row.sentToday)>=config.maxPerUserPerDay)reasons.push('DAILY_LIMIT_REACHED');
  if(row.lastSmartAt&&Date.now()-new Date(row.lastSmartAt).getTime()<config.minimumIntervalMinutes*60000)reasons.push('MINIMUM_INTERVAL_NOT_REACHED');
  const averageMinutes=String(row.averageTime??'').split(':').slice(0,2).reduce((v,p,i)=>v+Number(p)*(i?1:60),0);const targetMinutes=averageMinutes-config.notificationLeadMinutes;
  if(row.type!=='REACTIVATION'&&Math.abs(parts.minutes-targetMinutes)>config.scheduleToleranceMinutes)reasons.push('OUTSIDE_PATTERN_WINDOW');
  return {...row,eligible:reasons.length===0,score:number(row.confidence),reasons:reasons.length?reasons:['ELIGIBLE'],suggestedSendAt:row.averageTime};
}

function smartCommand(item:any,date=new Date()):NotificationCommand{
  const title=item.type==='RETURN_HOME'?'¿Listo para regresar a casa? 🛺':item.type==='REACTIVATION'?'Costa-Go está listo cuando tú lo estés':`¿Listo para ir a ${item.destination??'tu destino habitual'}? 🛺`;
  const body=item.type==='REACTIVATION'?'Vuelve a moverte por la costa cuando lo necesites.':`Tu destino habitual está preparado. Revísalo antes de solicitar.`;
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Guayaquil'}).format(date);
  const preparesTrip=item.type!=='REACTIVATION'&&item.destinationLat!=null&&item.destinationLng!=null;
  return {userId:String(item.userId),type:`SMART_${item.type}`,category:'SMART',priority:'NORMAL',title,body,referenceId:String(item.id),deepLink:preparesTrip?'costa-go://trip/prepare':'costa-go://notifications',action:preparesTrip?'PREPARE_TRIP':'OPEN_NOTIFICATIONS',metadata:{patternId:item.id,...(preparesTrip?{originReference:item.origin??'',destinationReference:item.destination??'',destinationLatitude:item.destinationLat,destinationLongitude:item.destinationLng}:{})},persistInCenter:true,sendPush:true,idempotencyKey:`SMART:${item.type}:${item.userId}:${item.id}:${day}:${item.averageTime??'reactivation'}`};
}

function scheduleLimitReasons(date:Date,config:Config):string[]{
  const parts=ecuParts(date),nowTime=`${String(Math.floor(parts.minutes/60)).padStart(2,'0')}:${String(parts.minutes%60).padStart(2,'0')}`;
  const reasons:string[]=[];
  if(!config.enabledWeekDays.includes(parts.weekDay))reasons.push('WEEKDAY_DISABLED');
  if(nowTime<config.allowedStartTime||nowTime>config.allowedEndTime)reasons.push('OUTSIDE_ALLOWED_TIME');
  return reasons;
}

async function candidatesForSegment(segment:z.infer<typeof segmentSchema>){
  return database()`select distinct u.id::text,u.full_name as name,u.role::text as role,d.platform,d.last_seen_at as "lastSeenAt",area.name as zone
    from users u join device_tokens d on d.user_id=u.id and d.enabled and d.invalidated_at is null and d.last_seen_at>now()-interval '90 days'
    left join lateral(select t.service_area_id,t.requested_at from trips t where t.passenger_id=u.id or t.driver_id=u.id order by t.requested_at desc limit 1) recent on true left join service_areas area on area.id=recent.service_area_id
    where u.status='ACTIVE' and u.deleted_at is null
      and (${segment.userIds.length}=0 or u.id=any(${segment.userIds}::uuid[]))
      and (${segment.platforms.length}=0 or d.platform=any(${segment.platforms}::text[]))
      and (${segment.roles.length}=0 or u.role::text=any(${segment.roles}::text[]) or exists(select 1 from mobile_account_roles r where r.user_id=u.id and r.role=any(${segment.roles}::text[])))
      and (${segment.zones.length}=0 or area.name=any(${segment.zones}::text[]) or recent.service_area_id::text=any(${segment.zones}::text[]))
      and (${segment.activeWithinDays??null}::int is null or coalesce(recent.requested_at,u.updated_at,u.created_at)>=now()-(coalesce(${segment.activeWithinDays??null},365)*interval '1 day')) order by u.full_name limit 10000`;
}

async function estimateSegment(segment:z.infer<typeof segmentSchema>){
  const rows=await database()`select distinct u.id::text,d.platform,
    (d.token is not null and d.enabled and d.invalidated_at is null and d.last_seen_at>now()-interval '90 days') as "validToken"
    from users u
    left join lateral(select token,platform,last_seen_at,enabled,invalidated_at from device_tokens where user_id=u.id order by last_seen_at desc limit 1)d on true
    left join lateral(select t.service_area_id,t.requested_at from trips t where t.passenger_id=u.id or t.driver_id=u.id order by t.requested_at desc limit 1) recent on true
    left join service_areas area on area.id=recent.service_area_id
    where u.status='ACTIVE' and u.deleted_at is null
      and (${segment.userIds.length}=0 or u.id=any(${segment.userIds}::uuid[]))
      and (${segment.platforms.length}=0 or d.platform=any(${segment.platforms}::text[]))
      and (${segment.roles.length}=0 or u.role::text=any(${segment.roles}::text[]) or exists(select 1 from mobile_account_roles r where r.user_id=u.id and r.role=any(${segment.roles}::text[])))
      and (${segment.zones.length}=0 or area.name=any(${segment.zones}::text[]) or recent.service_area_id::text=any(${segment.zones}::text[]))
      and (${segment.activeWithinDays??null}::int is null or coalesce(recent.requested_at,u.updated_at,u.created_at)>=now()-(coalesce(${segment.activeWithinDays??null},365)*interval '1 day'))
    order by u.id`;
  const valid=rows.filter((row:any)=>row.validToken);
  return {usersFound:rows.length,total:valid.length,android:valid.filter((row:any)=>row.platform==='ANDROID').length,ios:valid.filter((row:any)=>row.platform==='IOS').length,withoutValidToken:rows.length-valid.length,excluded:rows.length-valid.length};
}

async function nonCriticalLimitReasons(userId:string,config:Config):Promise<string[]>{
  const parts=ecuParts(new Date());
  const nowTime=`${String(Math.floor(parts.minutes/60)).padStart(2,'0')}:${String(parts.minutes%60).padStart(2,'0')}`;
  const [usage]=await database()`select
    count(*) filter(where status='SENT' and created_at>=date_trunc('day',now() at time zone 'America/Guayaquil') at time zone 'America/Guayaquil')::int as today,
    max(created_at) filter(where status='SENT') as "lastSentAt"
    from user_notifications where user_id=${userId} and category in ('SMART','CAMPAIGN','PROMOTIONAL')`;
  const reasons:string[]=[];
  if(!config.enabledWeekDays.includes(parts.weekDay))reasons.push('WEEKDAY_DISABLED');
  if(nowTime<config.allowedStartTime||nowTime>config.allowedEndTime)reasons.push('OUTSIDE_ALLOWED_TIME');
  if(number(usage?.today)>=config.maxPerUserPerDay)reasons.push('DAILY_LIMIT_REACHED');
  if(usage?.lastSentAt&&Date.now()-new Date(usage.lastSentAt).getTime()<config.minimumIntervalMinutes*60000)reasons.push('MINIMUM_INTERVAL_NOT_REACHED');
  return reasons;
}

export async function smartNotificationSchedulerTick():Promise<void>{
  if(!process.env.DATABASE_URL)return;
  const due=await database().begin(async tx=>{const [row]=await tx`select scheduler_interval_minutes as minutes,last_scheduler_run_at as "lastRun",mode from smart_notification_config where id=1 for update`;if(row?.lastRun&&Date.now()-new Date(row.lastRun).getTime()<number(row.minutes)*60000)return false;await tx`update smart_notification_config set last_scheduler_run_at=now() where id=1`;return true;});
  if(!due)return;await analyzeSmartPatterns();await processScheduledCampaigns();const config=await smartConfig();if(config.mode==='OFF')return;
  const patterns=await database()`select id::text from smart_notification_patterns where is_active order by confidence_score desc,last_evaluated_at desc limit 500`;
  for(const pattern of patterns){const evaluated=await eligibility(String(pattern.id),config);if(evaluated.eligible)await notificationService.send(smartCommand(evaluated));}
}

async function processScheduledCampaigns(){
  const campaigns=await database().begin(async tx=>{const rows=await tx`select id::text from notification_campaigns where status='SCHEDULED' and scheduled_at<=now() order by scheduled_at limit 5 for update skip locked`;for(const row of rows)await tx`update notification_campaigns set status='PROCESSING',started_at=now(),updated_at=now() where id=${row.id}`;return rows;});
  const config=await smartConfig();
  for(const item of campaigns){
    try{
      const [campaign]=await database()`select *,campaign_type as "campaignType" from notification_campaigns where id=${item.id}`;
      if(!campaign)throw new Error('CAMPAIGN_NOT_FOUND');
      const segment=segmentSchema.parse(storedJson(campaign.segment??{})),users=await candidatesForSegment(segment);
      for(const user of users){
        const [recipient]=await database()`insert into notification_campaign_recipients(campaign_id,user_id,status,scheduled_at) values (${item.id},${user.id},'QUEUED',${campaign.scheduled_at}) on conflict(campaign_id,user_id) do nothing returning id::text`;
        if(!recipient)continue;
        const limits=await nonCriticalLimitReasons(String(user.id),config);
        if(limits.length){
          await database()`update notification_campaign_recipients set status='SKIPPED',error_code='NON_CRITICAL_LIMIT',error_message=${limits.join(',')} where id=${recipient.id}`;
          continue;
        }
        const category=campaign.campaignType==='PROMOTIONAL'?'PROMOTIONAL':'CAMPAIGN';
        const result=await notificationService.send({userId:String(user.id),type:String(campaign.campaignType),category,priority:category==='PROMOTIONAL'?'LOW':'NORMAL',title:String(campaign.title),body:String(campaign.body),referenceId:String(item.id),deepLink:campaign.deep_link??undefined,action:campaign.action??undefined,metadata:{campaignId:item.id,...(campaign.metadata??{})},persistInCenter:true,sendPush:true,idempotencyKey:`CAMPAIGN:${item.id}:${user.id}`});
        await database()`update notification_campaign_recipients set notification_id=${result.notificationId||null},status=${result.pushSent?'SENT':result.status},sent_at=case when ${result.pushSent} then now() else null end,error_code=${result.errorCode??null},error_message=${result.errorMessage??null} where id=${recipient.id}`;
      }
      await database()`update notification_campaigns set status='SENT',completed_at=now(),updated_at=now() where id=${item.id}`;
    }catch(error){
      await database()`update notification_campaigns set status='FAILED',completed_at=now(),updated_at=now() where id=${item.id}`;
      console.error('notification_campaign_failed',{campaignId:item.id,error:error instanceof Error?error.message:String(error)});
    }
  }
}

function guard(error:unknown,reply:any){const message=error instanceof Error?error.message:'ERROR';if(message==='FORBIDDEN')return reply.code(403).send({error:message});if(message==='UNAUTHORIZED')return reply.code(401).send({error:message});if(error instanceof z.ZodError)return reply.code(400).send({error:'INVALID_DATA',issues:error.issues});throw error;}
export async function registerSmartNotificationRoutes(app:FastifyInstance){
  app.get('/v1/admin/notifications/summary',async(request,reply)=>{try{requirePermission(request,'notifications:view');const [summary]=await database()`select (select count(distinct passenger_id)::int from trips where requested_at>=now()-interval '30 days') as "usersAnalyzed",(select count(*)::int from smart_notification_patterns where is_active) as "patternsDetected",(select count(*)::int from smart_notification_patterns where is_active and confidence_score>=(select minimum_confidence from smart_notification_config where id=1)) as "eligible",(select count(*)::int from user_notifications where category in ('SMART','CAMPAIGN','PROMOTIONAL') and created_at>=current_date and status='SENT') as "sentToday",(select count(*)::int from notification_analytics_events e join user_notifications n on n.id=e.notification_id where n.category in ('SMART','CAMPAIGN','PROMOTIONAL') and e.event='OPENED' and e.occurred_at>=current_date) as "openedToday",(select count(*)::int from notification_analytics_events e join user_notifications n on n.id=e.notification_id where n.category in ('SMART','CAMPAIGN','PROMOTIONAL') and e.event='TRIP_REQUESTED' and e.occurred_at>=current_date) as "tripsGenerated"`;const trend=await database()`select day::date::text,coalesce(sent,0)::int sent,coalesce(opened,0)::int opened,coalesce(trips,0)::int trips from generate_series(current_date-29,current_date,'1 day') day left join lateral(select count(*) filter(where e.event='SENT') sent,count(*) filter(where e.event='OPENED') opened,count(*) filter(where e.event='TRIP_REQUESTED') trips from notification_analytics_events e join user_notifications n on n.id=e.notification_id where n.category in ('SMART','CAMPAIGN','PROMOTIONAL') and e.occurred_at>=day and e.occurred_at<day+interval '1 day') metrics on true order by day`;const values=summary??{};return {...values,conversion:number(values.sentToday)?Math.round(number(values.tripsGenerated)/number(values.sentToday)*10000)/100:0,trend};}catch(error){return guard(error,reply);}});
  app.get('/v1/admin/notifications/smart/config',async(request,reply)=>{try{requirePermission(request,'notifications:view');return smartConfig();}catch(error){return guard(error,reply);}});
  app.put('/v1/admin/notifications/smart/config',async(request,reply)=>{try{const actor=requirePermission(request,'notifications:manage');const value=configSchema.parse(request.body);const [previous]=await database()`select to_jsonb(smart_notification_config) value from smart_notification_config where id=1`;const [row]=await database()`update smart_notification_config set mode=${value.mode},frequent_trip_enabled=${value.frequentTripEnabled},return_trip_enabled=${value.returnTripEnabled},favorite_destination_enabled=${value.favoriteDestinationEnabled},reactivation_enabled=${value.reactivationEnabled},minimum_trips=${value.minimumTrips},minimum_matches=${value.minimumMatches},minimum_confidence=${value.minimumConfidence},analysis_window_days=${value.analysisWindowDays},schedule_tolerance_minutes=${value.scheduleToleranceMinutes},notification_lead_minutes=${value.notificationLeadMinutes},max_per_user_per_day=${value.maxPerUserPerDay},minimum_interval_minutes=${value.minimumIntervalMinutes},allowed_start_time=${value.allowedStartTime}::time,allowed_end_time=${value.allowedEndTime}::time,enabled_week_days=${value.enabledWeekDays},inactive_user_days=${value.inactiveUserDays},scheduler_interval_minutes=${value.schedulerIntervalMinutes},updated_by=${actor.id!},updated_at=now() where id=1 returning updated_at as "updatedAt"`;if(!row)throw new Error('SMART_CONFIG_NOT_FOUND');await database()`insert into audit_log(actor_id,action,entity_type,entity_id,previous_value,next_value,reason) values (${actor.id!},'SMART_NOTIFICATION_CONFIG_UPDATED','SMART_NOTIFICATION_CONFIG','1',${JSON.stringify(previous?.value??{})}::jsonb,${JSON.stringify(value)}::jsonb,'Configuración modificada desde Notificaciones Inteligentes')`;return {...value,updatedAt:row.updatedAt};}catch(error){return guard(error,reply);}});
  app.post('/v1/admin/notifications/smart/analyze',async(request,reply)=>{try{requirePermission(request,'notifications:manage');const parsed=z.object({userId:z.string().uuid().optional()}).parse(request.body??{});return analyzeSmartPatterns(parsed.userId);}catch(error){return guard(error,reply);}});
  app.get('/v1/admin/notifications/smart/patterns',async(request,reply)=>{try{requirePermission(request,'notifications:view');const query=z.object({limit:z.coerce.number().int().min(1).max(200).default(50),type:z.enum(patternTypes).optional(),q:z.string().trim().max(100).default('')}).parse(request.query);const search=`%${query.q.replace(/[\\%_]/g,'\\$&')}%`;const rows=await database()`select p.id::text,p.pattern_type as type,p.origin_reference as origin,p.destination_reference as destination,p.week_days as "weekDays",p.average_time::text as "averageTime",p.matches_count as matches,p.trips_analyzed as "tripsAnalyzed",p.confidence_score::float8 as confidence,p.last_evaluated_at as "lastEvaluatedAt",u.full_name as user,u.id::text as "userId" from smart_notification_patterns p join users u on u.id=p.user_id where p.is_active and (${query.type??null}::text is null or p.pattern_type=${query.type??null}) and (${query.q}='' or u.full_name ilike ${search} or p.origin_reference ilike ${search} or p.destination_reference ilike ${search}) order by p.confidence_score desc,p.last_evaluated_at desc limit ${query.limit}`;return {items:rows};}catch(error){return guard(error,reply);}});
  app.get('/v1/admin/notifications/smart/patterns/:id',async(request,reply)=>{try{requirePermission(request,'notifications:view');const id=z.string().uuid().parse((request.params as any).id);const evaluated=await eligibility(id);if(evaluated.reasons?.includes('PATTERN_NOT_FOUND'))return reply.code(404).send({error:'PATTERN_NOT_FOUND'});return evaluated;}catch(error){return guard(error,reply);}});
  app.post('/v1/admin/notifications/smart/patterns/:id/simulate',async(request,reply)=>{try{requirePermission(request,'notifications:test');const id=z.string().uuid().parse((request.params as any).id);return eligibility(id);}catch(error){return guard(error,reply);}});
  app.post('/v1/admin/notifications/smart/patterns/:id/test-send',async(request,reply)=>{try{requirePermission(request,'notifications:test');const id=z.string().uuid().parse((request.params as any).id);const evaluated=await eligibility(id,{...(await smartConfig()),mode:'TEST'});if(!evaluated.tester)return reply.code(403).send({error:'TEST_USER_NOT_ALLOWED'});return notificationService.send({...smartCommand(evaluated),idempotencyKey:`TEST:SMART:${id}:${Date.now()}`});}catch(error){return guard(error,reply);}});
  app.get('/v1/admin/notifications/test-users',async(request,reply)=>{try{requirePermission(request,'notifications:test');const query=z.object({q:z.string().trim().max(100).default('')}).parse(request.query);const search=`%${query.q.replace(/[\\%_]/g,'\\$&')}%`;return database()`select u.id::text,u.full_name as name,u.email,t.enabled,d.platform,d.last_seen_at as "lastActivity",(select max(n.push_sent_at) from user_notifications n where n.user_id=u.id) as "lastPush" from notification_test_users t join users u on u.id=t.user_id left join lateral(select platform,last_seen_at from device_tokens where user_id=u.id and enabled and invalidated_at is null order by last_seen_at desc limit 1)d on true where ${query.q}='' or u.full_name ilike ${search} or u.email ilike ${search} order by u.full_name`;}catch(error){return guard(error,reply);}});
  app.get('/v1/admin/notifications/test-users/search',async(request,reply)=>{try{requirePermission(request,'notifications:test');const q=z.string().trim().min(2).max(100).parse((request.query as any).q);const search=`%${q.replace(/[\\%_]/g,'\\$&')}%`;return database()`select u.id::text,u.full_name as name,u.email,d.platform,d.last_seen_at as "lastActivity",(d.token is not null) as "validToken" from users u left join lateral(select token,platform,last_seen_at from device_tokens where user_id=u.id and enabled and invalidated_at is null order by last_seen_at desc limit 1)d on true where u.status='ACTIVE' and u.deleted_at is null and (u.full_name ilike ${search} or u.email ilike ${search} or u.phone_e164 ilike ${search}) order by u.full_name limit 20`;}catch(error){return guard(error,reply);}});
  app.post('/v1/admin/notifications/test-users',async(request,reply)=>{try{const actor=requirePermission(request,'notifications:test');const body=z.object({userId:z.string().uuid()}).parse(request.body);const [row]=await database()`insert into notification_test_users(user_id,enabled,created_by) values (${body.userId},true,${actor.id!}) on conflict(user_id) do update set enabled=true,updated_at=now() returning id::text`;return reply.code(201).send(row);}catch(error){return guard(error,reply);}});
  app.delete('/v1/admin/notifications/test-users/:userId',async(request,reply)=>{try{requirePermission(request,'notifications:test');const userId=z.string().uuid().parse((request.params as any).userId);await database()`update notification_test_users set enabled=false,updated_at=now() where user_id=${userId}`;return {disabled:true};}catch(error){return guard(error,reply);}});
  app.post('/v1/admin/notifications/test-send',async(request,reply)=>{try{requirePermission(request,'notifications:test');const body=testSendSchema.parse(request.body);const [tester]=await database()`select 1 from notification_test_users where user_id=${body.userId} and enabled`;if(!tester)return reply.code(403).send({error:'TEST_USER_NOT_ALLOWED'});return notificationService.send({userId:body.userId,type:body.type,category:body.type.startsWith('SMART_')?'SMART':'OPERATIONAL',priority:'NORMAL',title:body.title,body:body.message,deepLink:body.deepLink,action:body.action,metadata:body.destination?{destinationReference:body.destination.reference,destinationLatitude:body.destination.latitude,destinationLongitude:body.destination.longitude}:undefined,persistInCenter:true,sendPush:true,idempotencyKey:`MANUAL_TEST:${body.userId}:${Date.now()}`});}catch(error){return guard(error,reply);}});
  app.get('/v1/admin/notifications/campaigns',async(request,reply)=>{try{requirePermission(request,'notification_campaigns:view');const rows=await database()`select c.id::text,c.name,c.campaign_type as type,c.title,c.segment,c.status,c.scheduled_at as "scheduledAt",c.created_at as "createdAt",count(r.id)::int recipients,count(r.id) filter(where r.status='SENT')::int sent,count(r.id) filter(where r.status='OPENED')::int opened from notification_campaigns c left join notification_campaign_recipients r on r.campaign_id=c.id group by c.id order by c.created_at desc limit 200`;return rows.map(row=>({...row,segment:storedJson(row.segment)}));}catch(error){return guard(error,reply);}});
  app.post('/v1/admin/notifications/campaigns',async(request,reply)=>{try{const actor=requirePermission(request,'notification_campaigns:manage');const body=campaignSchema.parse(request.body);const [row]=await database()`insert into notification_campaigns(name,campaign_type,title,body,deep_link,action,metadata,segment,created_by,updated_by) values (${body.name},${body.campaignType},${body.title},${body.body},${body.deepLink||null},${body.action||null},${JSON.stringify(body.metadata)}::jsonb,${JSON.stringify(body.segment)}::jsonb,${actor.id!},${actor.id!}) returning id::text,status`;return reply.code(201).send(row);}catch(error){return guard(error,reply);}});
  app.get('/v1/admin/notifications/campaigns/:id',async(request,reply)=>{try{requirePermission(request,'notification_campaigns:view');const id=z.string().uuid().parse((request.params as any).id);const [row]=await database()`select id::text,name,campaign_type as "campaignType",title,body,deep_link as "deepLink",action,metadata,segment,status,scheduled_at as "scheduledAt",created_at as "createdAt",updated_at as "updatedAt" from notification_campaigns where id=${id}`;return row??reply.code(404).send({error:'CAMPAIGN_NOT_FOUND'});}catch(error){return guard(error,reply);}});
  app.put('/v1/admin/notifications/campaigns/:id',async(request,reply)=>{try{const actor=requirePermission(request,'notification_campaigns:manage');const id=z.string().uuid().parse((request.params as any).id),body=campaignSchema.parse(request.body);const [row]=await database()`update notification_campaigns set name=${body.name},campaign_type=${body.campaignType},title=${body.title},body=${body.body},deep_link=${body.deepLink||null},action=${body.action||null},metadata=${JSON.stringify(body.metadata)}::jsonb,segment=${JSON.stringify(body.segment)}::jsonb,updated_by=${actor.id!},updated_at=now() where id=${id} and status='DRAFT' returning id::text,status`;return row??reply.code(409).send({error:'CAMPAIGN_NOT_EDITABLE'});}catch(error){return guard(error,reply);}});
  app.post('/v1/admin/notifications/campaigns/:id/estimate',async(request,reply)=>{try{requirePermission(request,'notification_campaigns:view');const id=z.string().uuid().parse((request.params as any).id);const [campaign]=await database()`select segment from notification_campaigns where id=${id}`;if(!campaign)return reply.code(404).send({error:'CAMPAIGN_NOT_FOUND'});return estimateSegment(segmentSchema.parse(storedJson(campaign.segment)));}catch(error){return guard(error,reply);}});
  app.post('/v1/admin/notifications/campaigns/:id/test',async(request,reply)=>{try{requirePermission(request,'notifications:test');const id=z.string().uuid().parse((request.params as any).id),body=z.object({userId:z.string().uuid()}).parse(request.body);const [campaign]=await database()`select campaign_type as type,title,body,deep_link as "deepLink",action,metadata from notification_campaigns where id=${id}`;const [tester]=await database()`select 1 from notification_test_users where user_id=${body.userId} and enabled`;if(!campaign||!tester)return reply.code(403).send({error:'TEST_USER_NOT_ALLOWED'});return notificationService.send({userId:body.userId,type:String(campaign.type),category:campaign.type==='PROMOTIONAL'?'PROMOTIONAL':'CAMPAIGN',priority:'NORMAL',title:String(campaign.title),body:String(campaign.body),deepLink:campaign.deepLink,action:campaign.action,metadata:{campaignId:id,...(campaign.metadata??{})},persistInCenter:true,sendPush:true,idempotencyKey:`CAMPAIGN_TEST:${id}:${body.userId}:${Date.now()}`});}catch(error){return guard(error,reply);}});
  app.post('/v1/admin/notifications/campaigns/:id/schedule',async(request,reply)=>{try{const actor=requirePermission(request,'notification_campaigns:manage');const id=z.string().uuid().parse((request.params as any).id),body=z.object({scheduledAt:z.string().datetime({offset:true})}).parse(request.body);const scheduled=new Date(body.scheduledAt);if(scheduled.getTime()<Date.now()+60000)return reply.code(400).send({error:'SCHEDULE_TOO_SOON'});const scheduleReasons=scheduleLimitReasons(scheduled,await smartConfig());if(scheduleReasons.length)return reply.code(400).send({error:'CAMPAIGN_OUTSIDE_ALLOWED_WINDOW',reasons:scheduleReasons});const [row]=await database()`update notification_campaigns set status='SCHEDULED',scheduled_at=${scheduled},updated_by=${actor.id!},updated_at=now() where id=${id} and status='DRAFT' returning id::text,status,scheduled_at as "scheduledAt"`;return row??reply.code(409).send({error:'CAMPAIGN_NOT_SCHEDULABLE'});}catch(error){return guard(error,reply);}});
  app.post('/v1/admin/notifications/campaigns/:id/cancel',async(request,reply)=>{try{const actor=requirePermission(request,'notification_campaigns:manage');const id=z.string().uuid().parse((request.params as any).id);const [row]=await database()`update notification_campaigns set status='CANCELLED',cancelled_at=now(),updated_by=${actor.id!},updated_at=now() where id=${id} and status in ('DRAFT','SCHEDULED') returning id::text,status`;return row??reply.code(409).send({error:'CAMPAIGN_NOT_CANCELLABLE'});}catch(error){return guard(error,reply);}});
}
