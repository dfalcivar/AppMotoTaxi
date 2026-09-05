import type {FastifyInstance,FastifyReply} from 'fastify';
import {z} from 'zod';
import {database as rawDatabase} from './database.js';
import {escapeEmailHtml,renderCostaGoEmail} from './email.js';
import {notificationService} from './notification-service.js';
import {requirePermission} from './admin.js';

type LooseSql={(strings:TemplateStringsArray,...values:any[]):Promise<any[]>;begin<T>(callback:(tx:any)=>Promise<T>):Promise<T>};
const database=rawDatabase as unknown as()=>LooseSql;
export const commercialEmailEvents=['CAMPAIGN_EXPIRING_7D','CAMPAIGN_EXPIRING_3D','CAMPAIGN_EXPIRED','CAMPAIGN_MONTHLY_REPORT'] as const;
export type CommercialEmailEvent=typeof commercialEmailEvents[number];
const eventSchema=z.enum(commercialEmailEvents);

type CampaignEmailData={
  campaignId:string;campaign:string;business:string;contact:string;email:string;plan:string;zone:string;
  startsAt:string;endsAt:string;periodStart:string;periodEnd:string;impressions:number;clicks:number;ctr:number;activeDays:number;renewalUrl:string;daysBefore?:number;
};

function amount(value:unknown){return Number(value??0);}
function dateLabel(value:string){return new Intl.DateTimeFormat('es-EC',{dateStyle:'long',timeZone:'America/Guayaquil'}).format(new Date(value));}
function isoDay(value:Date){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Guayaquil',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);}
function ecuadorDayOfMonth(value:Date){return Number(isoDay(value).slice(-2));}
function dayDiff(from:string,to:string){return Math.max(0,Math.ceil((new Date(to).getTime()-new Date(from).getTime())/86_400_000));}
function priorMonth(){const now=new Date(),ecu=new Date(now.getTime()-5*3_600_000),year=ecu.getUTCMonth()===0?ecu.getUTCFullYear()-1:ecu.getUTCFullYear(),month=ecu.getUTCMonth()===0?11:ecu.getUTCMonth()-1;const start=new Date(Date.UTC(year,month,1,5)),end=new Date(Date.UTC(year,month+1,1,5));return {start,end,key:`${year}-${String(month+1).padStart(2,'0')}`};}
function eventLabel(event:CommercialEmailEvent,daysBefore?:number){if(event.startsWith('CAMPAIGN_EXPIRING_'))return `Vence en ${daysBefore??(event.endsWith('7D')?7:3)} días`;return event==='CAMPAIGN_EXPIRED'?'Campaña finalizada':'Reporte mensual';}
function renewalUrl(value:unknown){const fallback=`${(process.env.PUBLIC_WEB_BASE_URL??'https://costa-go.com').replace(/\/$/,'')}/anunciarme`;try{const parsed=new URL(String(value??fallback));return /^https?:$/.test(parsed.protocol)?parsed.toString():fallback;}catch{return fallback;}}

async function campaignData(campaignId:string|undefined,event:CommercialEmailEvent,demo=false):Promise<CampaignEmailData>{
  const monthly=priorMonth();
  if(demo||!campaignId)return {campaignId:'DEMO',campaign:'Campaña Costa-Go Verano',business:'Comercio de demostración',contact:'María',email:'demo@costa-go.com',plan:'Premium',zone:'Tonsupa',startsAt:'2026-08-01T05:00:00.000Z',endsAt:'2026-09-12T05:00:00.000Z',periodStart:monthly.start.toISOString(),periodEnd:monthly.end.toISOString(),impressions:1840,clicks:126,ctr:6.85,activeDays:31,renewalUrl:renewalUrl(undefined),daysBefore:event.endsWith('7D')?7:event.endsWith('3D')?3:undefined};
  const [definition]=await database()`select schedule_config as config from notification_event_definitions where event_type=${event}`;
  const period=event==='CAMPAIGN_MONTHLY_REPORT'?monthly:{start:new Date(0),end:new Date('2999-01-01T00:00:00Z'),key:'ALL'};
  const [row]=await database()`select b.id::text as "campaignId",b.title as campaign,coalesce(a.business_name,b.advertiser_name,'Comercio') as business,coalesce(a.contact_name,'Cliente') as contact,a.email,coalesce(p.name,o.plan_snapshot->>'name','Sin plan') as plan,coalesce(sa.name,'Todas las zonas') as zone,b.starts_at as "startsAt",b.ends_at as "endsAt",coalesce(s.advertising_renewal_contact_url,'') as "renewalUrl",
    count(e.id) filter(where e.event_type='IMPRESSION')::int as impressions,count(e.id) filter(where e.event_type in('CLICK','ACTION'))::int as clicks
    from affiliate_banners b join advertising_orders o on o.id=b.order_id left join advertisers a on a.id=o.advertiser_id left join advertising_plans p on p.id=o.plan_id left join service_areas sa on sa.id=b.service_area_id cross join operational_settings s left join advertising_events e on e.campaign_id=b.id and e.occurred_at>=${period.start} and e.occurred_at<${period.end}
    where b.id=${campaignId} group by b.id,b.title,a.business_name,b.advertiser_name,a.contact_name,a.email,p.name,o.plan_snapshot,sa.name,s.advertising_renewal_contact_url,b.starts_at,b.ends_at`;
  if(!row||!row.email)throw new Error('COMMERCIAL_CAMPAIGN_EMAIL_NOT_FOUND');
  const impressions=amount(row.impressions),clicks=amount(row.clicks),startsAt=new Date(row.startsAt),endsAt=new Date(row.endsAt),overlapStart=new Date(Math.max(startsAt.getTime(),period.start.getTime())),overlapEnd=new Date(Math.min(endsAt.getTime(),period.end.getTime()));
  return {...row,email:String(row.email).toLowerCase(),startsAt:startsAt.toISOString(),endsAt:endsAt.toISOString(),periodStart:period.start.toISOString(),periodEnd:period.end.toISOString(),impressions,clicks,ctr:impressions?Math.round(clicks/impressions*10_000)/100:0,activeDays:dayDiff(overlapStart.toISOString(),overlapEnd.toISOString()),renewalUrl:renewalUrl(row.renewalUrl),daysBefore:Number(definition?.config?.daysBefore)||(event.endsWith('7D')?7:event.endsWith('3D')?3:undefined)} as CampaignEmailData;
}

export function renderCommercialCampaignEmail(event:CommercialEmailEvent,data:CampaignEmailData){
  const report=event==='CAMPAIGN_MONTHLY_REPORT',expired=event==='CAMPAIGN_EXPIRED';
  const title=report?`Resultados de ${data.campaign}`:expired?`Tu campaña ${data.campaign} finalizó`:`Tu campaña ${data.campaign} vence en ${data.daysBefore??3} días`;
  const subject=report?`Reporte mensual de tu campaña · Costa-Go`:expired?`Tu campaña Costa-Go finalizó`:`Tu campaña Costa-Go vence pronto`;
  const bodyHtml=`<div style="margin:18px 0;padding:18px;border-radius:12px;background:#f4f8fb;border:1px solid #d8e3ec"><div style="font-size:14px;color:#667085">Resultados reales del período</div><table role="presentation" width="100%" style="margin-top:10px"><tr><td style="padding:7px;color:#20242a"><strong>${data.impressions.toLocaleString('es-EC')}</strong><br><span style="color:#667085">Impresiones</span></td><td style="padding:7px;color:#20242a"><strong>${data.clicks.toLocaleString('es-EC')}</strong><br><span style="color:#667085">Clics / acciones</span></td><td style="padding:7px;color:#20242a"><strong>${data.ctr.toFixed(2)}%</strong><br><span style="color:#667085">CTR</span></td></tr></table></div>`;
  const html=renderCostaGoEmail({title,preheader:subject,greeting:data.contact,lead:report?`Este es el resumen verificable del rendimiento de tu publicidad en Costa-Go.`:expired?`Gracias por anunciar ${data.business} en Costa-Go. Puedes renovar la campaña cuando lo desees.`:`La campaña termina el ${dateLabel(data.endsAt)}. Puedes coordinar su renovación con nuestro equipo.`,badge:{label:eventLabel(event,data.daysBefore),tone:expired?'warning':'info'},bodyHtml,rows:[{label:'Campaña',value:data.campaign},{label:'Plan',value:data.plan},{label:'Zona',value:data.zone},{label:'Inicio',value:dateLabel(data.startsAt)},{label:'Finalización',value:dateLabel(data.endsAt)},{label:'Días activos',value:String(data.activeDays),emphasis:true}],primaryAction:{label:expired?'Renovar campaña':'Gestionar mi campaña',url:data.renewalUrl},notice:{title:'Métricas transparentes',text:'Las cifras corresponden a impresiones y acciones registradas por Costa-Go. No estimamos alcance sin datos fiables.',tone:'info'}});
  return {subject,html,text:`${title}. Impresiones: ${data.impressions}. Clics o acciones: ${data.clicks}. CTR: ${data.ctr.toFixed(2)}%.`};
}

async function enqueueDue(){
  const definitions=await database()`select event_type as event,"schedule_config" from notification_event_definitions where category='COMMERCIAL' and enabled and 'EMAIL'=any(channels)`;
  if(!definitions.length)return 0;
  const campaigns=await database()`select b.id::text,b.campaign_status as status,b.starts_at as "startsAt",b.ends_at as "endsAt",a.id::text as "advertiserId",lower(a.email) email from affiliate_banners b join advertising_orders o on o.id=b.order_id join advertisers a on a.id=o.advertiser_id where b.order_id is not null and b.ends_at is not null and a.email is not null`;
  let queued=0;const today=isoDay(new Date()),monthly=priorMonth();
  for(const definition of definitions){
    const event=eventSchema.parse(definition.event),config=definition.schedule_config??{};
    for(const campaign of campaigns){
      let due=false,periodKey='FINAL';
      if(event==='CAMPAIGN_MONTHLY_REPORT'){due=ecuadorDayOfMonth(new Date())>=Number(config.dayOfMonth??1)&&new Date(campaign.startsAt)<monthly.end&&new Date(campaign.endsAt)>monthly.start&&['ACTIVE','PAUSED','EXPIRED','FINISHED'].includes(campaign.status);periodKey=monthly.key;}
      else if(event==='CAMPAIGN_EXPIRED')due=['EXPIRED','FINISHED'].includes(campaign.status)&&isoDay(new Date(campaign.endsAt))<=today;
      else {const days=Number(config.daysBefore??(event.endsWith('7D')?7:3)),target=new Date(Date.now()+days*86_400_000);due=['ACTIVE','SCHEDULED','PAUSED'].includes(campaign.status)&&isoDay(new Date(campaign.endsAt))===isoDay(target);periodKey=isoDay(new Date(campaign.endsAt));}
      if(!due)continue;
      const rendered=renderCommercialCampaignEmail(event,await campaignData(campaign.id,event));
      const inserted=await database()`insert into notification_email_deliveries(event_type,campaign_id,advertiser_id,recipient_email,subject,period_key,max_attempts) select ${event},${campaign.id},${campaign.advertiserId},${campaign.email},${rendered.subject},${periodKey},max_attempts from notification_event_definitions where event_type=${event} on conflict do nothing returning id`;
      queued+=inserted.length;
    }
  }
  return queued;
}

async function processQueue(){
  await database()`update notification_email_deliveries set status='RETRY',next_attempt_at=now(),last_error_code='email/stale-processing',last_error_message='La ejecución anterior se interrumpió y fue recuperada.',updated_at=now() where status='PROCESSING' and updated_at<now()-interval '10 minutes'`;
  const rows=await database()`update notification_email_deliveries set status='PROCESSING',updated_at=now() where id in(select d.id from notification_email_deliveries d join notification_event_definitions e on e.event_type=d.event_type and e.enabled and 'EMAIL'=any(e.channels) where d.status in('QUEUED','RETRY') and d.next_attempt_at<=now() order by d.created_at limit 20 for update of d skip locked) returning id::text,event_type as event,"campaign_id"::text as "campaignId",recipient_email as email,attempts,max_attempts as "maxAttempts"`;
  for(const row of rows){
    const event=eventSchema.parse(row.event);
    try{
      const data=await campaignData(row.campaignId,event),rendered=renderCommercialCampaignEmail(event,data),result=await notificationService.sendEmail({to:row.email,...rendered});
      if(result.sent)await database()`update notification_email_deliveries set status='SENT',attempts=attempts+1,sent_at=now(),provider_message_id=${result.providerMessageId??null},last_error_code=null,last_error_message=null,updated_at=now() where id=${row.id}`;
      else {const terminal=Number(row.attempts)+1>=Number(row.maxAttempts);await database()`update notification_email_deliveries set status=${terminal?'FAILED':'RETRY'},attempts=attempts+1,next_attempt_at=now()+make_interval(secs=>least(21600,60*power(2,attempts)::int)),last_error_code=${result.errorCode??'email/unknown'},last_error_message=${result.errorMessage??null},updated_at=now() where id=${row.id}`;}
    }catch(error){const terminal=Number(row.attempts)+1>=Number(row.maxAttempts);await database()`update notification_email_deliveries set status=${terminal?'FAILED':'RETRY'},attempts=attempts+1,next_attempt_at=now()+interval '5 minutes',last_error_code='email/render',last_error_message=${String(error instanceof Error?error.message:error).slice(0,500)},updated_at=now() where id=${row.id}`;}
  }
  return rows.length;
}

export async function commercialEmailSchedulerTick(){if(!process.env.DATABASE_URL)return {queued:0,processed:0};return {queued:await enqueueDue(),processed:await processQueue()};}

function guard(error:unknown,reply:FastifyReply){const message=error instanceof z.ZodError?'INVALID_REQUEST':error instanceof Error?error.message:'UNKNOWN_ERROR';return reply.code(message.includes('NOT_FOUND')?404:message==='INVALID_REQUEST'?400:500).send({error:message});}
export async function registerCommercialEmailNotificationRoutes(app:FastifyInstance){
  app.get('/v1/admin/notifications/commercial-email/test-recipients',async(request,reply)=>{try{const actor=requirePermission(request,'notifications:test'),[settings]=await database()`select advertising_commercial_emails as emails from operational_settings where id=1`;return [...new Set([actor.email.toLowerCase(),...(settings?.emails??[]).map((item:string)=>item.toLowerCase())])].map(email=>({email}));}catch(error){return guard(error,reply);}});
  app.get('/v1/admin/notifications/commercial-email/events',async(request,reply)=>{try{requirePermission(request,'notifications:view');return database()`select event_type as "eventType",category,communication_class as "communicationClass",channels,enabled,template_key as "templateKey",schedule_config as "scheduleConfig",updated_at as "updatedAt",(select count(*)::int from notification_email_deliveries d where d.event_type=e.event_type and d.status='SENT') sent,(select count(*)::int from notification_email_deliveries d where d.event_type=e.event_type and d.status='FAILED') failed from notification_event_definitions e where category='COMMERCIAL' order by event_type`;}catch(error){return guard(error,reply);}});
  app.patch('/v1/admin/notifications/commercial-email/events/:event',async(request,reply)=>{try{const actor=requirePermission(request,'notifications:manage'),event=eventSchema.parse((request.params as any).event),body=z.object({enabled:z.boolean(),scheduleConfig:z.object({daysBefore:z.number().int().min(1).max(90).optional(),dayOfMonth:z.number().int().min(1).max(28).optional()}).default({})}).parse(request.body),[previous]=await database()`select enabled,schedule_config as "scheduleConfig" from notification_event_definitions where event_type=${event}`;const [row]=await database()`update notification_event_definitions set enabled=${body.enabled},schedule_config=${JSON.stringify(body.scheduleConfig)}::jsonb,updated_by=${actor.id!},updated_at=now() where event_type=${event} returning event_type as "eventType",enabled,schedule_config as "scheduleConfig"`;await database()`insert into audit_log(actor_id,action,entity_type,entity_id,previous_value,next_value,reason) values(${actor.id!},'COMMERCIAL_EMAIL_EVENT_UPDATED','NOTIFICATION_EVENT',${event},${JSON.stringify(previous??{})}::jsonb,${JSON.stringify(body)}::jsonb,'Configuración multicanal comercial actualizada')`;return row;}catch(error){return guard(error,reply);}});
  app.get('/v1/admin/notifications/commercial-email/campaigns',async(request,reply)=>{try{requirePermission(request,'notifications:view');return database()`select b.id::text,b.title,coalesce(a.business_name,b.advertiser_name,'Comercio') business,b.campaign_status as status,b.ends_at as "endsAt" from affiliate_banners b join advertising_orders o on o.id=b.order_id left join advertisers a on a.id=o.advertiser_id order by b.updated_at desc limit 200`;}catch(error){return guard(error,reply);}});
  app.post('/v1/admin/notifications/commercial-email/preview',async(request,reply)=>{try{requirePermission(request,'notifications:view');const body=z.object({eventType:eventSchema,campaignId:z.string().uuid().optional(),demo:z.boolean().default(false)}).parse(request.body),data=await campaignData(body.campaignId,body.eventType,body.demo||!body.campaignId),rendered=renderCommercialCampaignEmail(body.eventType,data);return {...rendered,data,isDemo:body.demo||!body.campaignId};}catch(error){return guard(error,reply);}});
  app.post('/v1/admin/notifications/commercial-email/test',async(request,reply)=>{try{const actor=requirePermission(request,'notifications:test'),body=z.object({eventType:eventSchema,campaignId:z.string().uuid().optional(),demo:z.boolean().default(false),email:z.string().email()}).parse(request.body),[settings]=await database()`select advertising_commercial_emails as emails from operational_settings where id=1`,allowed=new Set([actor.email.toLowerCase(),...(settings?.emails??[]).map((item:string)=>item.toLowerCase())]);if(!allowed.has(body.email.toLowerCase()))return reply.code(403).send({error:'TEST_EMAIL_NOT_ALLOWED',allowedEmails:[...allowed]});const data=await campaignData(body.campaignId,body.eventType,body.demo||!body.campaignId),rendered=renderCommercialCampaignEmail(body.eventType,data),result=await notificationService.sendEmail({to:body.email,...rendered});await database()`insert into notification_email_deliveries(event_type,campaign_id,advertiser_id,recipient_email,subject,period_key,status,attempts,max_attempts,sent_at,provider_message_id,last_error_code,last_error_message,is_test,created_by) values(${body.eventType},${body.campaignId??null},null,${body.email.toLowerCase()},${rendered.subject},${`TEST-${Date.now()}`},'TEST',1,1,${result.sent?new Date():null},${result.providerMessageId??null},${result.errorCode??null},${result.errorMessage??null},true,${actor.id!})`;if(!result.sent)return reply.code(502).send({error:result.errorCode,message:result.errorMessage});return {sent:true,providerMessageId:result.providerMessageId};}catch(error){return guard(error,reply);}});
  app.get('/v1/admin/notifications/commercial-email/deliveries',async(request,reply)=>{try{requirePermission(request,'notifications:view');const query=z.object({campaignId:z.string().uuid().optional(),limit:z.coerce.number().int().min(1).max(200).default(100)}).parse(request.query);return database()`select d.id::text,d.event_type as "eventType",d.campaign_id::text as "campaignId",b.title as campaign,d.recipient_email as recipient,d.subject,d.status,d.attempts,d.scheduled_at as "scheduledAt",d.sent_at as "sentAt",d.last_error_code as "errorCode",d.last_error_message as "errorMessage",d.is_test as "isTest" from notification_email_deliveries d left join affiliate_banners b on b.id=d.campaign_id where (${query.campaignId??null}::uuid is null or d.campaign_id=${query.campaignId??null}) order by d.created_at desc limit ${query.limit}`;}catch(error){return guard(error,reply);}});
}
