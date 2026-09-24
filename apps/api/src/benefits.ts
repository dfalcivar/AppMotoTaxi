import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import {z} from 'zod';
import {database} from './database.js';
import {requirePermission,type SessionUser} from './admin.js';
import {resolveServiceArea} from './service-areas.js';
import {benefitPresentation} from './benefit-presentation.js';

export const benefitTypes=['COURTESY_DAYS','PROMOTIONAL_BALANCE','TRIP_DISCOUNT','FIXED_DISCOUNT','PERCENTAGE_DISCOUNT','FREE_TRIPS','MEMBERSHIP','REFERRAL_REWARD','CUSTOM'] as const;
export const benefitSchema=z.object({
 code:z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/),name:z.string().trim().min(3).max(160),description:z.string().trim().max(4000).default(''),
 expirationDays:z.number().int().min(1).max(365).nullable().default(null),benefitType:z.enum(benefitTypes),value:z.number().positive().max(365),audience:z.enum(['DRIVER','PASSENGER','BOTH']),
 oneTime:z.boolean(),requiresActivation:z.boolean(),startsAt:z.string().datetime({offset:true}),endsAt:z.string().datetime({offset:true}),
 maxGlobal:z.number().int().positive().max(1000000).nullable(),maxPerUser:z.number().int().positive().max(1000).nullable(),
 status:z.enum(['DRAFT','ACTIVE','PAUSED','ARCHIVED']),zoneIds:z.array(z.string().uuid()).max(100).default([]),
}).strict().superRefine((v,c)=>{
 const issue=(message:string)=>c.addIssue({code:'custom',message});
 if(Date.parse(v.endsAt)<=Date.parse(v.startsAt))issue('El fin debe ser posterior al inicio.');
 if(v.oneTime&&v.maxPerUser!==1)issue('Un beneficio de una sola vez requiere máximo 1 por usuario.');
 if(v.benefitType==='COURTESY_DAYS'&&(v.audience!=='DRIVER'||!Number.isInteger(v.value)))issue('La cortesía requiere conductores y días enteros.');
 if(v.status==='ACTIVE'&&!['COURTESY_DAYS','PROMOTIONAL_BALANCE'].includes(v.benefitType))issue('Tipo de beneficio aún no operativo.');
 if(v.status==='ACTIVE'&&v.benefitType==='PROMOTIONAL_BALANCE'&&!v.expirationDays)issue('Configura los días de vigencia del saldo promocional.');
 if(v.benefitType==='PROMOTIONAL_BALANCE'&&(v.value<0.01||Math.abs(v.value*100-Math.round(v.value*100))>0.000001))issue('El saldo requiere un valor en centavos.');
 if(v.benefitType==='PROMOTIONAL_BALANCE'&&v.requiresActivation)issue('El saldo promocional se entrega automáticamente mediante referidos.');
 if(v.code==='DRIVER_FOUNDER_COURTESY'&&(v.benefitType!=='COURTESY_DAYS'||v.value!==15||!v.requiresActivation||!v.oneTime||v.audience!=='DRIVER'||v.maxPerUser!==1))issue('Conductor fundador requiere 15 días para conductores, una sola vez.');
});
const messages:Record<string,string>={BENEFIT_REFERRAL_TERMS_LOCKED:'Este beneficio ya fue prometido a referidos. Crea otro código para cambiar sus condiciones económicas.',ALREADY_REDEEMED:'Ya activaste este beneficio.',NOT_ELIGIBLE:'Tu cuenta no cumple las condiciones de este beneficio.',BENEFIT_LIMIT_REACHED:'Este beneficio ya no está disponible.',BENEFIT_EXPIRED:'La vigencia del beneficio o de la campaña terminó.',BENEFIT_UNAVAILABLE:'El beneficio no está disponible.',BENEFIT_VERSION_CONFLICT:'La definición cambió. Actualiza antes de guardar.',BENEFIT_IDENTITY_IMMUTABLE:'El código, tipo y condición de una sola vez no pueden modificarse.',BENEFIT_INVALID_ZONE:'Una zona no está habilitada.',BENEFIT_CODE_EXISTS:'Ya existe un beneficio con ese código.'};
const guard=(fn:(r:FastifyRequest,s:FastifyReply)=>Promise<unknown>)=>async(r:FastifyRequest,s:FastifyReply)=>{try{return await fn(r,s);}catch(e){
 if(e instanceof z.ZodError)return s.code(400).send({error:'INVALID_DATA',message:e.issues[0]?.message});
 const code=e instanceof Error?e.message:'';
 if(code==='UNAUTHORIZED'||code==='FORBIDDEN')return s.code(code==='UNAUTHORIZED'?401:403).send({error:code});
 if(messages[code])return s.code(409).send({error:code,message:messages[code]});
 if((e as any)?.code==='23505'){
 const duplicate=String((e as any).constraint_name??(e as any).constraint??'').startsWith('benefit_once_');
 const error=duplicate?'ALREADY_REDEEMED':'BENEFIT_CODE_EXISTS';return s.code(409).send({error,message:messages[error]});
 }
 throw e;
}};
function definition(r:any){return {id:r.id,code:r.code,name:r.name,description:r.description,benefitType:r.benefit_type,...benefitPresentation(r.benefit_type,Number(r.value)),value:Number(r.value),expirationDays:r.expiration_days??null,audience:r.audience,oneTime:r.one_time,requiresActivation:r.requires_activation,startsAt:r.starts_at,endsAt:r.ends_at,maxGlobal:r.max_global,maxPerUser:r.max_per_user,status:r.status,zoneIds:r.zone_ids??[],version:r.version,redemptions:Number(r.redemptions??0),totalGranted:Number(r.total_granted??0)};}
export function redemption(r:any){const now=Date.now();return {id:r.id,benefitCode:r.benefit_code,campaignId:r.campaign_id,benefitType:r.benefit_type,value:Number(r.benefit_value),source:r.source,status:['ACTIVE','PENDING'].includes(r.status)?new Date(r.effective_until).getTime()<=now?'EXPIRED':new Date(r.effective_from).getTime()>now?'PENDING':'ACTIVE':r.status,effectiveFrom:r.effective_from,effectiveUntil:r.effective_until,redeemedAt:r.redeemed_at};}
async function audit(tx:any,actor:string|null,action:string,id:string,previous:any,next:any,reason=''){
 await tx`insert into audit_log(actor_id,action,entity_type,entity_id,previous_value,next_value,reason) values(${actor},${action},'BENEFIT',${id},${tx.json(previous)},${tx.json(next)},${reason})`;
}
// A single definition lock serializes the global cap; membership lock coordinates purchases and trip acceptance.
export async function claimBenefit(tx:any,user:SessionUser,code:string,campaignId:string,zoneId:string|null){
 await tx`select pg_advisory_xact_lock(hashtext(${`membership-order:${user.id}`}))`;
 const [b]=await tx`select *,now() as clock from benefit_definitions where code=${code} for update`;
 if(!b)throw new Error('BENEFIT_UNAVAILABLE');
 const [c]=await tx`select * from costa_go_campaigns where id=${campaignId} for share`;
 await validateEligibility(tx,user,b,c,zoneId,true);
 return applyBenefitGrant(tx,user,b,{source:'CAMPAIGN',campaignId,zoneId});
}
async function applyBenefitGrant(tx:any,user:SessionUser,b:any,input:{source:string;campaignId?:string;zoneId:string|null;referenceId?:string}) {
 let starts:unknown=new Date();
 if(b.benefit_type==='COURTESY_DAYS') {
 const [coverage]=await tx`select greatest(now(),
   coalesce((select max(greatest(expires_at,case when status='GRACE_PERIOD' and grace_allows_trips_applied then grace_ends_at end)) from driver_memberships where driver_id=${user.id!} and cycle_closed_at is null and (status in ('ACTIVE','EXPIRING') or status='GRACE_PERIOD' and grace_allows_trips_applied)),now()),
   coalesce((select max(effective_until) from benefit_redemptions where user_id=${user.id!} and benefit_type='COURTESY_DAYS' and status in ('ACTIVE','PENDING')),now())) as starts`;
 starts=coverage.starts;
 }
 const [r]=await tx`insert into benefit_redemptions(benefit_id,benefit_code,user_id,campaign_id,audience,zone_id,benefit_type,benefit_value,one_time,source,reference_id,effective_from,effective_until,expires_at,metadata)
 values(${b.id},${b.code},${user.id!},${input.campaignId??null},${user.role},${input.zoneId},${b.benefit_type},${b.value},${b.one_time},${input.source},${input.referenceId??null},${starts},${starts}::timestamptz+${b.benefit_type==='COURTESY_DAYS'?b.value:b.expiration_days}::numeric*interval '1 day',${starts}::timestamptz+${b.benefit_type==='COURTESY_DAYS'?b.value:b.expiration_days}::numeric*interval '1 day',${tx.json({origin:input.source,definitionVersion:b.version,name:b.name})}) returning *`;
 if(b.benefit_type==='PROMOTIONAL_BALANCE') {
 const [credit]=await tx`insert into benefit_promotional_credits(redemption_id,user_id,currency,original_amount,remaining,expires_at) values(${r.id},${user.id!},'USD',${b.value},${b.value},${r.effective_until}) returning id`;
 await tx`insert into benefit_promotional_movements(credit_id,kind,amount,reference_id,idempotency_key) values(${credit.id},'GRANT',${b.value},${input.referenceId??r.id},${'benefit-credit:'+r.id})`;
 }
 await audit(tx,user.id!,'BENEFIT_CLAIMED',r.id,null,redemption(r));
 return {success:true,benefit:definition(b),redemption:redemption(r)};
}
async function validateEligibility(tx:any,user:SessionUser,b:any,c:any,zoneId:string|null,lock=false,automatic=false){
 const [previous]=await tx`select count(*)::int as count,count(*) filter(where campaign_id=${c?.id??null})::int as campaign_count from benefit_redemptions where user_id=${user.id!} and benefit_code=${b.code}`;
 if(b.one_time&&previous.count>0||previous.campaign_count>0)throw new Error('ALREADY_REDEEMED');
 const now=new Date(b.clock??Date.now()).getTime();
 if(new Date(b.ends_at).getTime()<=now||c&&new Date(c.ends_at).getTime()<=now)throw new Error('BENEFIT_EXPIRED');
 if(b.status!=='ACTIVE'||b.requires_activation===automatic||!['COURTESY_DAYS','PROMOTIONAL_BALANCE'].includes(b.benefit_type)||new Date(b.starts_at).getTime()>now)throw new Error('BENEFIT_UNAVAILABLE');
 if(!c||c.content.benefitCode!==b.code||!c.enabled||c.status!=='ACTIVE'||new Date(c.starts_at).getTime()>now)throw new Error('BENEFIT_UNAVAILABLE');
 if(!['DRIVER','PASSENGER'].includes(user.role)||![user.role,'BOTH'].includes(b.audience)||![user.role,'BOTH'].includes(c.audience))throw new Error('NOT_ELIGIBLE');
 // Lock user and driver identity during the grant, while retaining the same read logic for availability.
 if(lock){await tx`select id from users where id=${user.id!} for share`;await tx`select user_id from drivers where user_id=${user.id!} for share`;}
 const [account]=await tx`select u.status,d.approval_status,
 exists(select 1 from driver_documents x where x.driver_id=u.id and x.status='SUSPENDED') as suspended,
 exists(select 1 from driver_memberships m where m.driver_id=u.id and m.cycle_closed_at is null and m.status in ('SUSPENDED','SUSPENDED_NON_PAYMENT','SUSPENSION_PENDING_ACTIVE_TRIP')) as blocked
 from users u left join drivers d on d.user_id=u.id where u.id=${user.id!}`;
 if(!account||account.status!=='ACTIVE'||user.role==='DRIVER'&&b.benefit_type==='COURTESY_DAYS'&&(account.approval_status!=='APROBADO'||account.suspended||account.blocked))throw new Error('NOT_ELIGIBLE');
 const [zones]=await tx`select
 (not exists(select 1 from benefit_areas where benefit_id=${b.id}) or exists(select 1 from benefit_areas a join service_areas s on s.id=a.service_area_id and s.enabled where a.benefit_id=${b.id} and a.service_area_id=${zoneId}::uuid)) as benefit,
 (${c.all_zones} or exists(select 1 from costa_go_campaign_areas a join service_areas s on s.id=a.service_area_id and s.enabled where a.campaign_id=${c.id} and a.service_area_id=${zoneId}::uuid)) as campaign`;
 if(!zones.benefit||!zones.campaign)throw new Error('NOT_ELIGIBLE');
 const [total]=await tx`select count(*)::int as count from benefit_redemptions where benefit_id=${b.id}`;
 if(b.max_global!==null&&total.count>=b.max_global||b.max_per_user!==null&&previous.count>=b.max_per_user)throw new Error('BENEFIT_LIMIT_REACHED');
}
const location=z.object({latitude:z.coerce.number().min(-90).max(90).optional(),longitude:z.coerce.number().min(-180).max(180).optional()}).refine(v=>(v.latitude===undefined)===(v.longitude===undefined),'Envía ambas coordenadas.');
type Auth=(r:FastifyRequest,s:FastifyReply)=>Promise<SessionUser|undefined>;
export async function registerBenefitRoutes(app:FastifyInstance,authenticate:Auth){
 const root='/v1/admin/benefits';
 app.get(root,guard(async r=>{requirePermission(r,'benefits:view');
 const rows=await database()`select b.*,array(select service_area_id::text from benefit_areas where benefit_id=b.id) as zone_ids,
 (select count(*) from benefit_redemptions where benefit_id=b.id) as redemptions,
 (select coalesce(sum(benefit_value),0) from benefit_redemptions where benefit_id=b.id) as total_granted
 from benefit_definitions b order by created_at desc limit 500`;
 return {items:rows.map(definition),zones:await database()`select id::text,name,enabled from service_areas order by name`,types:benefitTypes,supportedTypes:['COURTESY_DAYS','PROMOTIONAL_BALANCE']};
 }));
 const write=async(r:FastifyRequest,edit:boolean)=>{
 const actor=requirePermission(r,'benefits:manage');const raw=r.body as any;
 const b=benefitSchema.parse(edit?Object.fromEntries(Object.entries(raw).filter(([k])=>k!=='version')):raw);
 const id=edit?z.object({id:z.string().uuid()}).parse(r.params).id:null;
 const version=edit?z.number().int().positive().parse(raw.version):null;
 return database().begin(async tx=>{
 let old:any=null;
 if(edit){[old]=await tx`select * from benefit_definitions where id=${id} for update`;if(!old||old.version!==version)throw new Error('BENEFIT_VERSION_CONFLICT');if(old.code!==b.code||old.benefit_type!==b.benefitType||old.one_time!==b.oneTime)throw new Error('BENEFIT_IDENTITY_IMMUTABLE');}
 for(const zone of b.zoneIds){const [a]=await tx`select id from service_areas where id=${zone} and enabled`;if(!a)throw new Error('BENEFIT_INVALID_ZONE');}
 let result:any;
 if(edit){[result]=await tx`update benefit_definitions set expiration_days=${b.expirationDays},name=${b.name},description=${b.description},value=${b.value},audience=${b.audience},requires_activation=${b.requiresActivation},starts_at=${b.startsAt},ends_at=${b.endsAt},max_global=${b.maxGlobal},max_per_user=${b.maxPerUser},status=${b.status},updated_at=now(),version=version+1 where id=${id} returning *`;}
 else {[result]=await tx`insert into benefit_definitions(expiration_days,code,name,description,benefit_type,value,audience,one_time,requires_activation,starts_at,ends_at,max_global,max_per_user,status) values(${b.expirationDays},${b.code},${b.name},${b.description},${b.benefitType},${b.value},${b.audience},${b.oneTime},${b.requiresActivation},${b.startsAt},${b.endsAt},${b.maxGlobal},${b.maxPerUser},${b.status}) returning *`;}
 const oldZones=(await tx`select service_area_id::text as id from benefit_areas where benefit_id=${result.id}`).map(x=>x.id).sort();
 if(JSON.stringify(oldZones)!==JSON.stringify([...new Set(b.zoneIds)].sort())){await tx`delete from benefit_areas where benefit_id=${result.id}`;for(const zone of new Set(b.zoneIds))await tx`insert into benefit_areas values(${result.id},${zone})`;}
 await audit(tx,actor.id??null,edit?'BENEFIT_UPDATED':'BENEFIT_CREATED',result.id,old,{...definition(result),zoneIds:b.zoneIds});
 return definition(result);
 });};
 app.post(root,guard(async(r,s)=>s.code(201).send(await write(r,false))));
 app.put(root+'/:id',guard(async r=>write(r,true)));
 app.get(root+'/:id/history',guard(async r=>{requirePermission(r,'benefits:view');const {id}=z.object({id:z.string().uuid()}).parse(r.params);return {items:await database()`select a.*,u.full_name as actor from audit_log a left join users u on u.id=a.actor_id where a.entity_type='BENEFIT' and (a.entity_id=${id} or a.entity_id in (select r.id::text from benefit_redemptions r where r.benefit_id=${id})) order by a.created_at desc limit 100`};}));
 app.get(root+'/redemptions',guard(async r=>{
 requirePermission(r,'benefits:view');const q=z.object({code:z.string().max(80).optional(),audience:z.enum(['DRIVER','PASSENGER']).optional(),zone:z.string().uuid().optional(),from:z.string().datetime({offset:true}).optional(),until:z.string().datetime({offset:true}).optional(),status:z.enum(['PENDING','ACTIVE','USED','EXPIRED','CANCELLED','FAILED']).optional(),offset:z.coerce.number().int().min(0).default(0)}).parse(r.query);
 const rows=await database()`select r.*,u.full_name,c.title as campaign_title,count(*) over()::int as total from benefit_redemptions r join users u on u.id=r.user_id left join costa_go_campaigns c on c.id=r.campaign_id
 where (${q.code??null}::text is null or r.benefit_code=${q.code??null}) and (${q.audience??null}::text is null or r.audience=${q.audience??null})
 and (${q.zone??null}::uuid is null or r.zone_id=${q.zone??null}) and (${q.from??null}::timestamptz is null or r.redeemed_at>=${q.from??null}) and (${q.until??null}::timestamptz is null or r.redeemed_at<${q.until??null})
 and (${q.status??null}::text is null or (case when r.status in ('ACTIVE','PENDING') then case when r.effective_until<=now() then 'EXPIRED' when r.effective_from>now() then 'PENDING' else 'ACTIVE' end else r.status end)=${q.status??null}) order by r.redeemed_at desc,r.id limit 50 offset ${q.offset}`;
 return {items:rows.map(x=>({...redemption(x),user:x.full_name,userId:x.user_id,campaign:x.campaign_title,zoneId:x.zone_id})),total:rows[0]?.total??0};
 }));
 async function mobile(r:FastifyRequest,s:FastifyReply){const user=await authenticate(r,s);if(!user)return;if(!user.id||!['DRIVER','PASSENGER'].includes(user.role))throw new Error('FORBIDDEN');s.header('Cache-Control','private, no-store');return user;}
 app.get('/v1/benefits/mine',guard(async(r,s)=>{const user=await mobile(r,s);if(!user)return;const rows=await database()`select * from benefit_redemptions where user_id=${user.id!} order by redeemed_at desc limit 100`;return {items:rows.map(redemption)};}));
 app.get('/v1/benefits/available',guard(async(r,s)=>{const user=await mobile(r,s);if(!user)return;const point=location.parse(r.query);const area=point.latitude===undefined?undefined:await resolveServiceArea(user.id!,{latitude:point.latitude,longitude:point.longitude!});
 const rows=await database()`select b.*,c.id as campaign from benefit_definitions b join costa_go_campaigns c on c.content->>'benefitCode'=b.code where b.status='ACTIVE' and c.enabled and c.status='ACTIVE' and b.ends_at>now() and c.ends_at>now() order by c.priority desc limit 100`;
 const items=[];for(const b of rows){const [c]=await database()`select * from costa_go_campaigns where id=${b.campaign}`;try{await validateEligibility(database(),user,b,c,area?.id??null);items.push({...definition(b),campaignId:c!.id,state:'AVAILABLE'});}catch(e){if(!messages[(e as Error).message])throw e;}}return {items};
 }));
 app.get('/v1/benefits/:code',guard(async(r,s)=>{
 const user=await mobile(r,s);if(!user)return;const {code}=z.object({code:z.string().max(80)}).parse(r.params);
 const {campaignId}=z.object({campaignId:z.string().uuid()}).parse(r.query);const point=location.parse(r.query);
 const area=point.latitude===undefined?undefined:await resolveServiceArea(user.id!,{latitude:point.latitude,longitude:point.longitude!});
 const [b]=await database()`select * from benefit_definitions where code=${code}`;
 const [c]=await database()`select * from costa_go_campaigns where id=${campaignId}`;
 if(!b||!c||c.content.benefitCode!==code||![user.role,'BOTH'].includes(c.audience))throw new Error('BENEFIT_UNAVAILABLE');
 const previous=await database()`select * from benefit_redemptions where user_id=${user.id!} and benefit_code=${code} order by redeemed_at desc limit 1`;
 let state='AVAILABLE';try{await validateEligibility(database(),user,b,c,area?.id??null);}catch(e){state=(e as Error).message;if(!messages[state])throw e;}
 return {benefit:definition(b),state,message:messages[state]??'',redemption:previous[0]?redemption(previous[0]):null};
 }));
 app.post('/v1/benefits/:code/claim',guard(async(r,s)=>{const user=await mobile(r,s);if(!user)return;const {code}=z.object({code:z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/)}).parse(r.params);
 const body=z.object({campaignId:z.string().uuid(),latitude:z.number().min(-90).max(90).optional(),longitude:z.number().min(-180).max(180).optional()}).strict().parse(r.body);location.parse(body);
 const area=body.latitude===undefined?undefined:await resolveServiceArea(user.id!,{latitude:body.latitude,longitude:body.longitude!});
 try{return await database().begin(tx=>claimBenefit(tx,user,code,body.campaignId,area?.id??null));}catch(e){const reason=(e as Error).message;if(messages[reason])await audit(database(),user.id!,'BENEFIT_CLAIM_DENIED',body.campaignId,null,{code},reason);throw e;}
 }));
}

export async function grantReferralBenefit(tx:any,user:SessionUser,code:string,referenceId:string,zoneId:string|null,qualifiedAt?:Date|string) {
 const [existing]=await tx`select * from benefit_redemptions where source='REFERRAL' and reference_id=${referenceId}`;
 if(existing)return {success:true,redemption:redemption(existing)};
 const [b]=await tx`select *,now() as clock from benefit_definitions where code=${code} for update`;
 if(!b)throw new Error('BENEFIT_UNAVAILABLE');
 // Processing delays must not invalidate a condition fulfilled inside the promised window.
 // Account, status and caps remain live checks; courtesy/credit duration starts at actual grant time.
 if(qualifiedAt)b.clock=qualifiedAt;
 const campaign={id:null,content:{benefitCode:code},enabled:true,status:'ACTIVE',starts_at:b.starts_at,ends_at:b.ends_at,audience:b.audience,all_zones:true};
 await validateEligibility(tx,user,b,campaign,zoneId,true,true);
 return applyBenefitGrant(tx,user,b,{source:'REFERRAL',referenceId,zoneId});
}
