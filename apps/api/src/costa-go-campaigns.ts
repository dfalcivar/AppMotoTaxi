import type {FastifyInstance, FastifyRequest, FastifyReply} from 'fastify';
import {z} from 'zod';
import sharp from 'sharp';
import {database} from './database.js';
import {requirePermission, type SessionUser} from './admin.js';
import type {Permission} from './permissions.js';
import {resolveServiceArea} from './service-areas.js';

export const campaignPermissions = ['costa_campaigns:view','costa_campaigns:create','costa_campaigns:edit','costa_campaigns:approve','costa_campaigns:reject','costa_campaigns:activate','costa_campaigns:deactivate'] as const;
export const campaignStates = ['DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','ACTIVE','PAUSED','FINISHED'] as const;
const assetKinds = ['MAIN','DARK','THUMBNAIL','DECORATION'] as const;
export function safeCampaignUrl(value:string) {
  try { const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&
    /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname)&&!/(^|\.)(localhost|local|internal)$/i.test(u.hostname); } catch { return false; }
}
export const campaignSchema=z.object({
  internalName:z.string().trim().min(3).max(120),title:z.string().trim().min(3).max(160),
  subtitle:z.string().trim().max(240).default(''),description:z.string().trim().max(12000).default(''),
  audience:z.enum(['PASSENGER','DRIVER','BOTH']),startsAt:z.string().datetime({offset:true}),endsAt:z.string().datetime({offset:true}),
  priority:z.number().int().min(0).max(1000).default(0),allZones:z.boolean(),zoneIds:z.array(z.string().uuid()).max(100).default([]),
  decorateHeader:z.boolean().default(false),
  variant:z.enum(['DEFAULT','CHRISTMAS','CARNIVAL','SUMMER','CUSTOM']).default('DEFAULT'),
  placements:z.array(z.enum(['HOME','CAMPAIGNS','NOTIFICATION'])).min(1).max(3).default(['CAMPAIGNS']),
  ctaType:z.enum(['NONE','CAMPAIGN_DETAIL','MEMBERSHIP','REFERRAL','SUPPORT','INTERNAL_ROUTE','EXTERNAL_URL']).default('NONE'),
  ctaText:z.string().trim().max(80).default(''),ctaDestination:z.string().trim().max(2048).default(''),
  terms:z.string().trim().max(12000).default(''),
}).superRefine((v,c)=>{
  const issue=(path:string,message:string)=>c.addIssue({code:'custom',path:[path],message});
  if(Date.parse(v.endsAt)<=Date.parse(v.startsAt))issue('endsAt','El fin debe ser posterior al inicio.');
  if(!v.allZones&&!v.zoneIds.length)issue('zoneIds','Selecciona al menos una zona.');
  if(v.allZones&&v.zoneIds.length)issue('zoneIds','Todas las zonas no admite una selección parcial.');
  if(v.ctaType!=='NONE'&&!v.ctaText)issue('ctaText','Escribe el texto de la acción.');
  if(v.ctaType==='REFERRAL')issue('ctaType','Referidos aún no tiene un destino móvil disponible.');
  if(v.ctaType==='EXTERNAL_URL'&&!safeCampaignUrl(v.ctaDestination))issue('ctaDestination','Usa una dirección HTTPS pública sin credenciales.');
  if(v.ctaType==='INTERNAL_ROUTE'&&!['support','membership','profile','activity','campaigns'].includes(v.ctaDestination))issue('ctaDestination','Destino interno no disponible.');
  if((v.ctaType==='MEMBERSHIP'||(v.ctaType==='INTERNAL_ROUTE'&&v.ctaDestination==='membership'))&&v.audience!=='DRIVER')issue('audience','Membresía solo está disponible para conductores.');
});
const idSchema=z.object({id:z.string().uuid()});
const actionSchema=z.object({version:z.number().int().positive(),action:z.enum(['SUBMIT','APPROVE','REJECT','ACTIVATE','PAUSE','FINISH']),reason:z.string().trim().max(1000).default('')});
const querySchema=z.object({latitude:z.coerce.number().min(-90).max(90).optional(),longitude:z.coerce.number().min(-180).max(180).optional(),placement:z.enum(['HOME','CAMPAIGNS','NOTIFICATION']).optional()})
  .refine(v=>(v.latitude===undefined)===(v.longitude===undefined),'Envía ambas coordenadas.');
const transitions:Record<string,{from:string[];to:string;permission:Permission}>={
  SUBMIT:{from:['DRAFT','REJECTED'],to:'PENDING_APPROVAL',permission:'costa_campaigns:edit'},
  APPROVE:{from:['PENDING_APPROVAL'],to:'APPROVED',permission:'costa_campaigns:approve'},
  REJECT:{from:['PENDING_APPROVAL'],to:'REJECTED',permission:'costa_campaigns:reject'},
  ACTIVATE:{from:['APPROVED','PAUSED'],to:'ACTIVE',permission:'costa_campaigns:activate'},
  PAUSE:{from:['ACTIVE'],to:'PAUSED',permission:'costa_campaigns:deactivate'},
  FINISH:{from:['DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','ACTIVE','PAUSED'],to:'FINISHED',permission:'costa_campaigns:deactivate'},
};
const campaignErrors:Record<string,string>={
  CAMPAIGN_NOT_FOUND:'La campaña no está disponible.',
  CAMPAIGN_VERSION_CONFLICT:'La campaña cambió mientras la editabas. Actualiza el detalle antes de continuar.',
  CAMPAIGN_FINISHED:'La campaña está finalizada. Puedes duplicarla para crear un nuevo borrador.',
  CAMPAIGN_INVALID_TRANSITION:'Esta acción no está disponible en el estado actual. Actualiza el detalle.',
  CAMPAIGN_REASON_REQUIRED:'Escribe el motivo del rechazo.',
  CAMPAIGN_EXPIRED:'La vigencia ya terminó. Ajusta las fechas del borrador antes de continuar.',
  CAMPAIGN_INVALID_ZONE:'Una zona seleccionada ya no está habilitada. Revisa las zonas de la campaña.',
  CAMPAIGN_IMAGE_TOO_LARGE:'La imagen debe pesar como máximo 2 MB.',
  CAMPAIGN_INVALID_IMAGE:'Usa una imagen JPG, PNG o WebP válida, sin animación y de hasta 4096 px.',
};
const guarded=(fn:(request:FastifyRequest,reply:FastifyReply)=>Promise<unknown>)=>async(request:FastifyRequest,reply:FastifyReply)=>{
  try{return await fn(request,reply);}catch(e){
    if(e instanceof z.ZodError)return reply.code(400).send({error:'INVALID_DATA',message:e.issues[0]?.message,details:e.issues});
    const message=e instanceof Error?e.message:'';
    if(message==='UNAUTHORIZED'||message==='FORBIDDEN')return reply.code(message==='UNAUTHORIZED'?401:403).send({error:message});
    if(message.startsWith('CAMPAIGN_'))return reply.code(message==='CAMPAIGN_NOT_FOUND'?404:409).send({error:message,message:campaignErrors[message]??'No fue posible completar la acción de la campaña.'});
    throw e;
  }
};
function present(row:any,mobile=false) {
  const result={...row.content,id:row.id,title:row.title,audience:row.audience,startsAt:new Date(row.starts_at).toISOString(),endsAt:new Date(row.ends_at).toISOString(),priority:row.priority,
    allZones:row.all_zones,zoneIds:row.zone_ids??[],assets:row.assets??[],version:row.version,updatedAt:row.updated_at};
  return mobile?result:{...result,internalName:row.internal_name,status:row.status,enabled:row.enabled,createdBy:row.created_by,
    updatedBy:row.updated_by,reviewedBy:row.reviewed_by,reviewedAt:row.reviewed_at,reviewReason:row.review_reason,createdAt:row.created_at};
}
async function record(tx:any,id:string) {
  const [row]=await tx`select c.*,array(select service_area_id::text from costa_go_campaign_areas where campaign_id=c.id order by service_area_id) as zone_ids,
    array(select kind from costa_go_campaign_assets where campaign_id=c.id order by kind) as assets from costa_go_campaigns c where c.id=${id}`;
  if(!row)throw new Error('CAMPAIGN_NOT_FOUND');return row;
}
async function lock(tx:any,id:string,version:number) {
  const [row]=await tx`select * from costa_go_campaigns where id=${id} for update`;
  if(!row)throw new Error('CAMPAIGN_NOT_FOUND');if(row.version!==version)throw new Error('CAMPAIGN_VERSION_CONFLICT');return row;
}
async function audit(tx:any,actor:SessionUser,id:string,action:string,previous:unknown,next:unknown,reason='') {
  await tx`insert into audit_log(actor_id,action,entity_type,entity_id,previous_value,next_value,reason)
    values(${actor.id??null},${'COSTA_CAMPAIGN_'+action},'COSTA_GO_CAMPAIGN',${id},${tx.json(previous)},${tx.json(next)},${reason||actor.email})`;
}
async function validateAreas(tx:any,ids:string[]) {
  for(const zone of new Set(ids)) {
    const [area]=await tx`select id from service_areas where id=${zone} and enabled`;
    if(!area)throw new Error('CAMPAIGN_INVALID_ZONE');
  }
}
async function writeAreas(tx:any,id:string,ids:string[]) {
  await validateAreas(tx,ids);
  await tx`delete from costa_go_campaign_areas where campaign_id=${id}`;
  for(const zone of new Set(ids))await tx`insert into costa_go_campaign_areas(campaign_id,service_area_id) values(${id},${zone})`;
}
type Auth=(request:FastifyRequest,reply:FastifyReply)=>Promise<SessionUser|undefined>;
export async function registerCostaGoCampaignRoutes(app:FastifyInstance,authenticate:Auth) {
  const root='/v1/admin/costa-go-campaigns';
  app.get(root+'/options',guarded(async request=>{
    requirePermission(request,'costa_campaigns:view');
    return {zones:await database()`select id::text,name,code,enabled from service_areas order by name`,states:campaignStates,
      internalRoutes:['support','membership','profile','activity','campaigns'],referralAvailable:false};
  }));
  app.get(root,guarded(async request=>{
    requirePermission(request,'costa_campaigns:view');
    const q=z.object({limit:z.coerce.number().int().min(1).max(100).default(30),offset:z.coerce.number().int().min(0).default(0),search:z.string().trim().max(120).default(''),status:z.enum(campaignStates).optional()}).parse(request.query);
    const rows=await database()`select c.*,count(*) over()::int as total,
      array(select service_area_id::text from costa_go_campaign_areas where campaign_id=c.id order by service_area_id) as zone_ids,
      array(select kind from costa_go_campaign_assets where campaign_id=c.id order by kind) as assets
      from costa_go_campaigns c where (${q.status??null}::text is null or c.status=${q.status??null})
      and (${q.search}='' or c.title ilike ${'%'+q.search+'%'} or c.internal_name ilike ${'%'+q.search+'%'})
      order by c.priority desc,c.created_at desc,c.id limit ${q.limit} offset ${q.offset}`;
    return {items:rows.map(r=>present(r)),total:rows[0]?.total??0};
  }));
  app.get(root+'/:id',guarded(async request=>{
    requirePermission(request,'costa_campaigns:view');const {id}=idSchema.parse(request.params);
    const row=await record(database(),id);
    const history=await database()`select a.action,a.reason,a.created_at as "createdAt",coalesce(u.full_name,a.reason) as actor
      from audit_log a left join users u on u.id=a.actor_id where a.entity_type='COSTA_GO_CAMPAIGN' and a.entity_id=${id} order by a.created_at desc limit 100`;
    return {...present(row),history};
  }));
  app.post(root,guarded(async(request,reply)=>{
    const actor=requirePermission(request,'costa_campaigns:create'),b=campaignSchema.parse(request.body);
    const {internalName,title,audience,startsAt,endsAt,priority,allZones,zoneIds,...content}=b;
    const result=await database().begin(async tx=>{
      const [row]=await tx`insert into costa_go_campaigns(internal_name,title,audience,starts_at,ends_at,priority,all_zones,content,created_by,updated_by)
        values(${internalName},${title},${audience},${startsAt},${endsAt},${priority},${allZones},${tx.json(content)},${actor.id??null},${actor.id??null}) returning id`;
      await writeAreas(tx,row!.id,zoneIds);const result=present(await record(tx,row!.id));await audit(tx,actor,row!.id,'CREATED',null,result);return result;
    });return reply.code(201).send(result);
  }));
  app.put(root+'/:id',guarded(async request=>{
    const actor=requirePermission(request,'costa_campaigns:edit'),{id}=idSchema.parse(request.params);
    const {version}=z.object({version:z.number().int().positive()}).parse(request.body),b=campaignSchema.parse(request.body);
    const {internalName,title,audience,startsAt,endsAt,priority,allZones,zoneIds,...content}=b;
    return database().begin(async tx=>{
      const old=await lock(tx,id,version);if(old.status==='FINISHED')throw new Error('CAMPAIGN_FINISHED');
      const previous=present(await record(tx,id));
      await tx`update costa_go_campaigns set internal_name=${internalName},title=${title},audience=${audience},starts_at=${startsAt},ends_at=${endsAt},priority=${priority},all_zones=${allZones},content=${tx.json(content)},
        status='DRAFT',enabled=false,reviewed_by=null,reviewed_at=null,review_reason=null,updated_by=${actor.id??null},updated_at=now(),version=version+1 where id=${id}`;
      await writeAreas(tx,id,zoneIds);const result=present(await record(tx,id));await audit(tx,actor,id,'EDITED',previous,result);return result;
    });
  }));
  app.post(root+'/:id/actions',guarded(async request=>{
    const b=actionSchema.parse(request.body),transition=transitions[b.action]!,actor=requirePermission(request,transition.permission),{id}=idSchema.parse(request.params);
    if(b.action==='REJECT'&&b.reason.length<3)throw new Error('CAMPAIGN_REASON_REQUIRED');
    return database().begin(async tx=>{
      const old=await lock(tx,id,b.version);
      if(!transition.from.includes(old.status))throw new Error('CAMPAIGN_INVALID_TRANSITION');
      if(['SUBMIT','APPROVE','ACTIVATE'].includes(b.action)) {
        const campaign=campaignSchema.parse(present(await record(tx,id)));
        await validateAreas(tx,campaign.zoneIds);
        const [valid]=await tx`select ends_at>now() as valid from costa_go_campaigns where id=${id}`;
        if(!valid?.valid)throw new Error('CAMPAIGN_EXPIRED');
      }
      const review=b.action==='APPROVE'||b.action==='REJECT';
      await tx`update costa_go_campaigns set status=${transition.to},enabled=${b.action==='ACTIVATE'},
        reviewed_by=case when ${review} then ${actor.id??null}::uuid else reviewed_by end,
        reviewed_at=case when ${review} then now() else reviewed_at end,
        review_reason=case when ${review} then ${b.reason} else review_reason end,updated_by=${actor.id??null},updated_at=now(),version=version+1 where id=${id}`;
      const result=present(await record(tx,id));await audit(tx,actor,id,b.action,present(old),result,b.reason);return result;
    });
  }));
  app.post(root+'/:id/duplicate',guarded(async(request,reply)=>{
    const actor=requirePermission(request,'costa_campaigns:create');requirePermission(request,'costa_campaigns:view');const {id}=idSchema.parse(request.params);
    const result=await database().begin(async tx=>{
      await tx`select id from costa_go_campaigns where id=${id} for update`;const old=await record(tx,id);
      const [copy]=await tx`insert into costa_go_campaigns(internal_name,title,audience,starts_at,ends_at,priority,all_zones,content,created_by,updated_by)
        select left(internal_name,110)||' (copia)',title,audience,starts_at,ends_at,priority,all_zones,content,${actor.id??null},${actor.id??null} from costa_go_campaigns where id=${id} returning id`;
      await tx`insert into costa_go_campaign_areas select ${copy!.id},service_area_id from costa_go_campaign_areas where campaign_id=${id}`;
      await tx`insert into costa_go_campaign_assets select ${copy!.id},kind,mime,data,now() from costa_go_campaign_assets where campaign_id=${id}`;
      const result=present(await record(tx,copy!.id));await audit(tx,actor,copy!.id,'DUPLICATED',{sourceId:old.id},result);return result;
    });return reply.code(201).send(result);
  }));
  app.put(root+'/:id/assets/:kind',guarded(async request=>{
    const actor=requirePermission(request,'costa_campaigns:edit'),{id,kind}=idSchema.extend({kind:z.enum(assetKinds)}).parse(request.params);
    const b=z.object({version:z.number().int().positive(),mime:z.enum(['image/jpeg','image/png','image/webp']),base64:z.string().min(4).max(2_800_000)}).parse(request.body);
    const data=Buffer.from(b.base64,'base64');if(data.length>2_097_152)throw new Error('CAMPAIGN_IMAGE_TOO_LARGE');
    let meta;try{meta=await sharp(data,{limitInputPixels:16_000_000}).metadata();}catch{throw new Error('CAMPAIGN_INVALID_IMAGE');}
    if(!meta.width||!meta.height||meta.width>4096||meta.height>4096||meta.pages&&meta.pages>1||'image/'+meta.format!==b.mime)throw new Error('CAMPAIGN_INVALID_IMAGE');
    return database().begin(async tx=>{
      const old=await lock(tx,id,b.version);if(old.status==='FINISHED')throw new Error('CAMPAIGN_FINISHED');
      await tx`insert into costa_go_campaign_assets(campaign_id,kind,mime,data) values(${id},${kind},${b.mime},${data}) on conflict(campaign_id,kind) do update set mime=excluded.mime,data=excluded.data,updated_at=now()`;
      await tx`update costa_go_campaigns set status='DRAFT',enabled=false,reviewed_by=null,reviewed_at=null,review_reason=null,version=version+1,updated_by=${actor.id??null},updated_at=now() where id=${id}`;
      const result=present(await record(tx,id));await audit(tx,actor,id,'ASSET_UPDATED',{status:old.status},{kind,bytes:data.length,version:result.version});return result;
    });
  }));
  app.delete(root+'/:id/assets/:kind',guarded(async request=>{
    const actor=requirePermission(request,'costa_campaigns:edit'),{id,kind}=idSchema.extend({kind:z.enum(assetKinds)}).parse(request.params);
    const {version}=z.object({version:z.coerce.number().int().positive()}).parse(request.query);
    return database().begin(async tx=>{
      const old=await lock(tx,id,version);if(old.status==='FINISHED')throw new Error('CAMPAIGN_FINISHED');
      await tx`delete from costa_go_campaign_assets where campaign_id=${id} and kind=${kind}`;
      await tx`update costa_go_campaigns set status='DRAFT',enabled=false,reviewed_by=null,reviewed_at=null,review_reason=null,version=version+1,updated_by=${actor.id??null},updated_at=now() where id=${id}`;
      const result=present(await record(tx,id));await audit(tx,actor,id,'ASSET_REMOVED',null,{kind,version:result.version});return result;
    });
  }));
  async function mobileRows(request:FastifyRequest,reply:FastifyReply,id?:string) {
    const user=await authenticate(request,reply);if(!user)return;
    if(!user.id||!['PASSENGER','DRIVER'].includes(user.role))throw new Error('FORBIDDEN');
    const q=querySchema.parse(request.query);
    const area=q.latitude===undefined?undefined:await resolveServiceArea(user.id,{latitude:q.latitude,longitude:q.longitude!});
    return database()`select c.*,array(select kind from costa_go_campaign_assets where campaign_id=c.id order by kind) as assets
      from costa_go_campaigns c where c.enabled and c.status='ACTIVE' and c.starts_at<=now() and c.ends_at>now()
      and c.audience in ('BOTH',${user.role}) and (${id??null}::uuid is null or c.id=${id??null})
      and (${q.placement??null}::text is null or c.content->'placements' ? ${q.placement??''})
      and (c.all_zones or exists(select 1 from costa_go_campaign_areas a where a.campaign_id=c.id and a.service_area_id=${area?.id??null}::uuid))
      order by c.priority desc,c.starts_at desc,c.id limit 100`;
  }
  app.get('/v1/costa-go-campaigns',guarded(async(request,reply)=>{
    const rows=await mobileRows(request,reply);if(!rows)return;
    reply.header('Cache-Control','private, no-store');return {items:rows.map(r=>present(r,true)),serverNow:new Date().toISOString(),refreshAfterSeconds:300};
  }));
  app.get('/v1/costa-go-campaigns/:id',guarded(async(request,reply)=>{
    const {id}=idSchema.parse(request.params),rows=await mobileRows(request,reply,id);if(!rows)return;if(!rows.length)throw new Error('CAMPAIGN_NOT_FOUND');
    reply.header('Cache-Control','private, no-store');return present(rows[0],true);
  }));
  for(const admin of [true,false])app.get((admin?root:'/v1/costa-go-campaigns')+'/:id/assets/:kind',guarded(async(request,reply)=>{
    const {id,kind}=idSchema.extend({kind:z.enum(assetKinds)}).parse(request.params);
    if(admin)requirePermission(request,'costa_campaigns:view');else {const rows=await mobileRows(request,reply,id);if(!rows)return;if(!rows.length)throw new Error('CAMPAIGN_NOT_FOUND');}
    const [asset]=await database()`select mime,data from costa_go_campaign_assets where campaign_id=${id} and kind=${kind}`;
    if(!asset)throw new Error('CAMPAIGN_NOT_FOUND');return reply.header('Cache-Control','private, no-store').header('X-Content-Type-Options','nosniff').type(asset.mime).send(Buffer.from(asset.data));
  }));
}
