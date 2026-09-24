import {randomBytes} from 'node:crypto';
import type {FastifyInstance,FastifyReply,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {database} from './database.js';
import {requirePermission,type SessionUser} from './admin.js';
import {resolveServiceArea} from './service-areas.js';
import {grantReferralBenefit,redemption} from './benefits.js';
export const referralEvents=['REGISTRATION_COMPLETED','PASSENGER_FIRST_COMPLETED_TRIP','DRIVER_APPROVED','DRIVER_FIRST_COMPLETED_TRIP','DRIVER_APPROVED_AND_FIRST_COMPLETED_TRIP','X_COMPLETED_TRIPS','FIRST_COMPLETED_TRIP','DRIVER_APPROVED_AND_X_COMPLETED_TRIPS'] as const;
export const referralProgramSchema=z.object({code:z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/),name:z.string().trim().min(3).max(120),description:z.string().trim().max(1000),audience:z.enum(['DRIVER','PASSENGER','BOTH']),startsAt:z.string().datetime({offset:true}),endsAt:z.string().datetime({offset:true}),qualifyingEvent:z.enum(referralEvents),requiredTrips:z.number().int().min(1).max(100).default(1),mustBeApproved:z.boolean().optional(),mustBeActive:z.boolean().default(true),referrerBenefitCode:z.string().max(80),referredBenefitCode:z.string().max(80).nullable(),maxRewardsPerReferrer:z.number().int().positive().nullable(),maxGlobalRewards:z.number().int().positive().nullable(),zoneIds:z.array(z.string().uuid()).max(100),status:z.enum(['DRAFT','ACTIVE','PAUSED','FINISHED']),shareMessage:z.string().trim().min(10).max(600)}).strict().superRefine((p,c)=>{
 const fail=(message:string)=>c.addIssue({code:'custom',message});
 if(Date.parse(p.endsAt)<=Date.parse(p.startsAt))fail('El fin debe ser posterior al inicio.');
 if(p.qualifyingEvent.startsWith('DRIVER_')&&p.audience!=='DRIVER'||p.qualifyingEvent.startsWith('PASSENGER_')&&p.audience!=='PASSENGER')fail('El evento debe coincidir con la audiencia.');
 if(p.mustBeApproved&&p.audience!=='DRIVER')fail('La aprobación adicional requiere audiencia Conductores.');
 if(!p.shareMessage.includes('{url}'))fail('El mensaje debe incluir {url}. Puedes añadir {code}.');
});
const errors:Record<string,string>={REFERRAL_NOT_AVAILABLE:'El programa o código no está disponible.',REFERRAL_ALREADY_ATTRIBUTED:'Tu cuenta ya tiene un referente y no puede cambiarlo.',REFERRAL_TOO_LATE:'El código se ingresa durante los primeros 7 días, antes de iniciar un viaje o recibir beneficios.',SELF_REFERRAL_NOT_ALLOWED:'No puedes referirte a ti mismo.',REFERRER_MUST_PRECEDE_USER:'El referente debe tener una cuenta anterior a la tuya.',REFERRAL_ACCOUNT_REQUIRED:'Confirma tu cuenta para continuar.',REFERRAL_LIMIT_REACHED:'Se alcanzó el límite de recompensas del programa.',REFERRAL_CONTRACT_LOCKED:'El código del programa es permanente. Los demás cambios se aplican a futuros referidos.',REFERRAL_VERSION_CONFLICT:'El programa cambió. Actualiza antes de editar.',REFERRAL_INVALID_BENEFIT:'Selecciona beneficios activos, automáticos y compatibles. El beneficio del referente debe ser repetible.',REFERRAL_TEST_ACCOUNT:'Las cuentas de prueba no participan en referidos.'};
const guarded=(fn:(r:FastifyRequest,s:FastifyReply)=>Promise<unknown>)=>async(r:FastifyRequest,s:FastifyReply)=>{try{return await fn(r,s);}catch(e){if(e instanceof z.ZodError)return s.code(400).send({error:'INVALID_DATA',message:e.issues[0]?.message});const message=(e as Error).message;if(['UNAUTHORIZED','FORBIDDEN'].includes(message))return s.code(message==='UNAUTHORIZED'?401:403).send({error:message});if(errors[message])return s.code(409).send({error:message,message:errors[message]});if((e as any).code==='23505')return s.code(409).send({error:'REFERRAL_ALREADY_ATTRIBUTED',message:'La cuenta o código ya está registrado.'});throw e;}};
async function audit(tx:any,actor:string|null,action:string,id:string,next:any,previous:any=null){await tx`insert into audit_log(actor_id,action,entity_type,entity_id,next_value,previous_value,reason) values(${actor},${action},'REFERRAL',${id},${tx.json(next)},${tx.json(previous)},'Referidos Costa-Go')`;}
function needsApproval(p:any){return p.must_be_approved===true||['DRIVER_APPROVED','DRIVER_APPROVED_AND_FIRST_COMPLETED_TRIP','DRIVER_APPROVED_AND_X_COMPLETED_TRIPS'].includes(p.required_event);}
function tripTarget(p:any){return ['X_COMPLETED_TRIPS','DRIVER_APPROVED_AND_X_COMPLETED_TRIPS','COMPLETED_TRIP_TARGET'].includes(p.required_event)?p.required_trips:['REGISTRATION_COMPLETED','DRIVER_APPROVED'].includes(p.required_event)?0:1;}
function conditionText(p:any){const parts=[];if(p.must_be_active!==false)parts.push('mantenga su cuenta activa');if(needsApproval(p))parts.push('esté aprobado como conductor');const target=tripTarget(p);if(target)parts.push('complete '+target+' viaje'+(target===1?' válido':'s válidos'));else if(p.required_event==='REGISTRATION_COMPLETED')parts.push('confirme su cuenta');return parts.join(' y ');}
function referralRules(r:any){const p=typeof r.rules_snapshot==='string'?JSON.parse(r.rules_snapshot):r.rules_snapshot;if(!p?.required_event)throw new Error('REFERRAL_SNAPSHOT_REQUIRED');return p;}
function present(p:any){return {id:p.id,code:p.code,name:p.name,description:p.description,audience:p.audience,startsAt:p.starts_at,endsAt:p.ends_at,qualifyingEvent:p.required_event,requiredTrips:p.required_trips??1,mustBeApproved:needsApproval(p),mustBeActive:p.must_be_active!==false,referrerBenefitCode:p.referrer_benefit_code,referredBenefitCode:p.referred_benefit_code,maxRewardsPerReferrer:p.max_rewards_per_referrer,maxGlobalRewards:p.max_redemptions,status:p.status,shareMessage:p.share_message,version:p.version,zoneIds:p.zone_ids??[],condition:conditionText(p),metrics:p.metrics};}
async function activeAccount(tx:any,id:string,role:string,driverApproval=true){const [u]=await tx`select u.*,referral_test_account(u.id) as test_account,d.approval_status from users u left join drivers d on d.user_id=u.id where u.id=${id}`;
 if(!u||u.status!=='ACTIVE'||!u.email_verified_at||u.deleted_at)throw new Error('REFERRAL_ACCOUNT_REQUIRED');
 if(u.test_account)throw new Error('REFERRAL_TEST_ACCOUNT');
 if(role==='DRIVER'&&driverApproval&&u.approval_status!=='APROBADO')throw new Error('REFERRAL_ACCOUNT_REQUIRED');
 const [r]=await tx`select 1 from mobile_account_roles where user_id=${id} and role=${role}`;if(!r)throw new Error('FORBIDDEN');return u;
}
export async function referralCodeFor(tx:any,userId:string){const [old]=await tx`select code from referral_codes where user_id=${userId}`;if(old)return old.code as string;
 for(let attempt=0;attempt<5;attempt++){const code='CG-'+randomBytes(8).toString('hex').toUpperCase();const [r]=await tx`insert into referral_codes(user_id,code) values(${userId},${code}) on conflict do nothing returning code`;if(r)return r.code as string;const [existing]=await tx`select code from referral_codes where user_id=${userId}`;if(existing)return existing.code as string;}throw new Error('REFERRAL_CODE_GENERATION_FAILED');}
async function zoneAllowed(tx:any,p:any,zoneId:string|null){const [ok]=await tx`select not exists(select 1 from referral_program_areas where program_id=${p.id}) or exists(select 1 from referral_program_areas a join service_areas s on s.id=a.service_area_id and s.enabled where program_id=${p.id} and a.service_area_id=${zoneId}::uuid) as ok`;return ok.ok;}
export async function attributeReferral(tx:any,user:SessionUser,code:string,programId:string,zoneId:string|null,source:string){
 await tx`select pg_advisory_xact_lock(hashtext(${`referral-attribution:${user.id}`}))`;
 const [p]=await tx`select *,now() as clock from benefit_reward_programs where id=${programId} for update`;
 if(!p||!p.enabled||p.status!=='ACTIVE'||new Date(p.starts_at)>new Date(p.clock)||new Date(p.ends_at)<=new Date(p.clock)||![user.role,'BOTH'].includes(p.audience)||!await zoneAllowed(tx,p,zoneId))throw new Error('REFERRAL_NOT_AVAILABLE');
 const u=await activeAccount(tx,user.id!,user.role,false);
 const [old]=await tx`select id from benefit_referrals where referred_user_id=${user.id!}`;if(old)throw new Error('REFERRAL_ALREADY_ATTRIBUTED');
 const [owner]=await tx`select user_id from referral_codes where code=${code}`;if(!owner)throw new Error('REFERRAL_NOT_AVAILABLE');
 if(owner.user_id===user.id)throw new Error('SELF_REFERRAL_NOT_ALLOWED');
 const referrer=await activeAccount(tx,owner.user_id,user.role);
 if(new Date(referrer.created_at)>=new Date(u.created_at))throw new Error('REFERRER_MUST_PRECEDE_USER');
 const [late]=await tx`select ${u.created_at}::timestamptz<now()-interval '7 days' or exists(select 1 from trips where (passenger_id=${user.id!} or driver_id=${user.id!}) and (started_at is not null or status='COMPLETED')) or exists(select 1 from benefit_redemptions where user_id=${user.id!}) as late`;
 if(late.late||new Date(u.created_at)<new Date(p.starts_at))throw new Error('REFERRAL_TOO_LATE');
 if(p.required_event==='DRIVER_APPROVED'&&u.approval_status==='APROBADO')throw new Error('REFERRAL_TOO_LATE');
 // Canonical identities are checked again by the database trigger, including normalized email/phone.
 const [r]=await tx`insert into benefit_referrals(program_id,referrer_user_id,referred_user_id,referral_code,audience,zone_id,source) values(${p.id},${owner.user_id},${user.id!},${code},${user.role},${zoneId},${source}) returning *`;
 await audit(tx,user.id!,'REFERRAL_ATTRIBUTED',r.id,{programId:p.id,source,code});return {id:r.id,status:r.status,condition:present(p).condition};
}
// Canonical proof, never a client assertion. Started/completed timestamps and explicit test flags are required.
export async function referralProgress(tx:any,r:any){
 const p=referralRules(r),target=tripTarget(p);
 const [u]=await tx`select u.status,u.email_verified_at,referral_test_account(u.id) as test_account,u.deleted_at,d.approval_status,d.approved_at from users u left join drivers d on d.user_id=u.id where u.id=${r.referred_user_id}`;
 const rows=target?await tx`select t.id,t.completed_at from trips t join users passenger on passenger.id=t.passenger_id join users driver on driver.id=t.driver_id
 where ((${r.audience}='DRIVER' and t.driver_id=${r.referred_user_id}) or (${r.audience}='PASSENGER' and t.passenger_id=${r.referred_user_id}))
 and t.status='COMPLETED' and t.completed_at<=now() and t.started_at is not null and t.completed_at>=t.started_at and t.started_at>=${r.created_at} and t.completed_at<=${p.ends_at}
 and not t.referral_test_trip and not referral_test_account(passenger.id) and not referral_test_account(driver.id) and t.driver_id<>t.passenger_id
 order by t.completed_at,t.id`:[];
 const active=u?.status==='ACTIVE',approved=u?.approval_status==='APROBADO'&&!!u.approved_at&&new Date(u.approved_at)<=new Date(p.ends_at)&&new Date(u.approved_at)<=new Date();
 const eligible=!!u?.email_verified_at&&!u?.deleted_at&&!u?.test_account&&(!p.must_be_active||active)&&(!needsApproval(p)||approved);
 const ready=eligible&&rows.length>=target;
 let proof:any=null;
 if(ready){if(target)proof={id:String(rows[target-1].id),at:needsApproval(p)&&new Date(u.approved_at)>new Date(rows[target-1].completed_at)?u.approved_at:rows[target-1].completed_at};else if(p.required_event==='DRIVER_APPROVED')proof=new Date(u.approved_at)>=new Date(r.created_at)?{id:'approval:'+r.referred_user_id,at:u.approved_at}:null;else proof={id:'account:'+r.referred_user_id,at:needsApproval(p)&&new Date(u.approved_at)>new Date(r.created_at)?u.approved_at:r.created_at};}
 return {requiredTrips:target,completedTrips:rows.length,remainingTrips:Math.max(0,target-rows.length),mustBeApproved:needsApproval(p),mustBeActive:p.must_be_active!==false,isApproved:approved,isActive:active,condition:conditionText(p),qualifyingEvent:p.required_event,endsAt:p.ends_at,qualified:!!proof,proof};
}
function publicProgress(progress:any){const {proof,...visible}=progress;return visible;}
export async function processReferral(tx:any,id:string){
 const [initial]=await tx`select * from benefit_referrals where id=${id}`;if(!initial)return;
 for(const userId of [initial.referrer_user_id,initial.referred_user_id].sort())await tx`select pg_advisory_xact_lock(hashtext(${`membership-order:${userId}`}))`;
 await tx`select id from benefit_reward_programs where id=${initial.program_id} for update`;
 const p=referralRules(initial);
 const [r]=await tx`select * from benefit_referrals where id=${id} for update`;if(!r||!['PENDING','QUALIFIED'].includes(r.status))return;
 const {proof}=await referralProgress(tx,r);
 if(!proof&&r.status==='QUALIFIED'){await tx`update benefit_referrals set last_error='QUALIFYING_EVIDENCE_UNAVAILABLE',next_attempt_at=now()+interval '5 minutes' where id=${id}`;return;}
 if(!proof){const [time]=await tx`select now()>${p.ends_at}::timestamptz as expired`;await tx`update benefit_referrals set status=${time.expired?'REJECTED':'PENDING'},last_error=${time.expired?'PROGRAM_EXPIRED':null},next_attempt_at=now()+interval '60 seconds',updated_at=now() where id=${id}`;return;}
 await tx`update benefit_referrals set status='QUALIFIED',qualified_at=coalesce(qualified_at,${proof.at}),qualifying_reference_id=${proof.id},updated_at=now() where id=${id}`;
 const eventId=`referral:${id}:${p.required_event}:${proof.id}`;
 await tx`insert into benefit_reward_events(source_event_id,user_id,event_type,occurred_at,verified_at,metadata) values(${eventId},${r.referred_user_id},${p.required_event},${proof.at},now(),${tx.json({referralId:id,reference:proof.id})}) on conflict(source_event_id) do nothing`;
 const [counts]=await tx`select count(*)::int as total,count(*) filter(where referrer_user_id=${r.referrer_user_id})::int as own from benefit_referrals where program_id=${p.id} and status='REWARDED'`;
 try {
  if(p.max_redemptions!==null&&counts.total>=p.max_redemptions||p.max_rewards_per_referrer!==null&&counts.own>=p.max_rewards_per_referrer)throw new Error('REFERRAL_LIMIT_REACHED');
  await activeAccount(tx,r.referrer_user_id,r.audience);
  // Both rewards commit together. A blocked definition never produces a half-paid referral.
  await tx.savepoint(async(st:any)=>{
   for(const code of [...new Set([p.referrer_benefit_code,p.referred_benefit_code].filter(Boolean))].sort())await st`select id from benefit_definitions where code=${code} for update`;
   const actor=(userId:string)=>({id:userId,role:r.audience,email:'',name:''} as SessionUser);
   await grantReferralBenefit(st,actor(r.referrer_user_id),p.referrer_benefit_code,`${id}:REFERRER`,r.zone_id,proof.at);
   if(p.referred_benefit_code)await grantReferralBenefit(st,actor(r.referred_user_id),p.referred_benefit_code,`${id}:REFERRED`,r.zone_id,proof.at);
  });
 }catch(e){const error=(e as Error).message;
  if(!/^(BENEFIT_|ALREADY_REDEEMED|NOT_ELIGIBLE|REFERRAL_|FORBIDDEN$)/.test(error))throw e;
  if(r.last_error!==error)await audit(tx,null,'REFERRAL_REWARD_BLOCKED',id,{error,eventId});
  await tx`update benefit_referrals set last_error=${error},next_attempt_at=now()+interval '5 minutes',updated_at=now() where id=${id}`;return;
 }
 await tx`update benefit_referrals set status='REWARDED',rewarded_at=now(),last_error=null,updated_at=now() where id=${id}`;
 await tx`update benefit_reward_events set processed_at=now() where source_event_id=${eventId}`;
 await audit(tx,null,'REFERRAL_REWARDED',id,{programId:p.id,eventId,reference:proof.id});
}
let running=false;
export async function referralSchedulerTick(){if(running)return;running=true;try{const rows=await database()`select id from benefit_referrals where status in ('PENDING','QUALIFIED') and next_attempt_at<=now() order by next_attempt_at,id limit 100`;for(const r of rows)await database().begin(tx=>processReferral(tx,r.id));}finally{running=false;}}
const coords=z.object({latitude:z.coerce.number().min(-90).max(90).optional(),longitude:z.coerce.number().min(-180).max(180).optional()}).refine(p=>(p.latitude===undefined)===(p.longitude===undefined));
type Auth=(r:FastifyRequest,s:FastifyReply)=>Promise<SessionUser|undefined>;
export async function registerReferralRoutes(app:FastifyInstance,authenticate:Auth){
 async function mobile(r:FastifyRequest,s:FastifyReply){const user=await authenticate(r,s);if(!user)return;if(!user.id||!['DRIVER','PASSENGER'].includes(user.role))throw new Error('FORBIDDEN');s.header('Cache-Control','private, no-store');return user;}
 async function area(r:FastifyRequest,id:string,body=false){const q=coords.parse(body?r.body:r.query);return q.latitude===undefined?null:(await resolveServiceArea(id,{latitude:q.latitude,longitude:q.longitude!}))?.id??null;}
 app.get('/v1/referrals',guarded(async(r,s)=>{const user=await mobile(r,s);if(!user)return;const tx=database(),zoneId=await area(r,user.id!);
 const [account]=await tx`select created_at,status,email_verified_at,referral_test_account(id) as referral_rewards_excluded from users where id=${user.id!}`;
 const [attributed]=await tx`select * from benefit_referrals where referred_user_id=${user.id!}`;
 const attribution=attributed?{status:attributed.status,name:referralRules(attributed).name,progress:publicProgress(await referralProgress(tx,attributed))}:null;
 const rows=await tx`select * from benefit_reward_programs where enabled and status='ACTIVE' and starts_at<=now() and ends_at>now() and audience in ('BOTH',${user.role}) order by created_at desc,id limit 50`;
 let eligible=true;try{await activeAccount(tx,user.id!,user.role);}catch{eligible=false;}
 const code=eligible&&rows.length?await referralCodeFor(tx,user.id!):null;const programs=[];
 for(const p of rows){if(!await zoneAllowed(tx,p,zoneId))continue;
 const benefits=await tx`select code,name,description,benefit_type as type,value from benefit_definitions where code in (${p.referrer_benefit_code},${p.referred_benefit_code})`;
 const [metrics]=await tx`select count(*)::int as registered,count(*) filter(where status='PENDING')::int as pending,count(*) filter(where status in ('QUALIFIED','REWARDED'))::int as qualified,count(*) filter(where status='REWARDED')::int as rewarded from benefit_referrals where program_id=${p.id} and referrer_user_id=${user.id!}`;
 const url=code?`https://costa-go.com/r/${code}?p=${p.code}`:null;
 programs.push({...present(p),programCode:p.code,benefits,metrics,canInvite:eligible,code,url,message:url?p.share_message.replaceAll('{url}',url).replaceAll('{code}',code):null});
 }
 const [late]=await tx`select exists(select 1 from trips where (passenger_id=${user.id!} or driver_id=${user.id!}) and (started_at is not null or status='COMPLETED')) or exists(select 1 from benefit_redemptions where user_id=${user.id!}) as late`;
 const credits=await tx`select coalesce(sum(remaining-reserved),0)::text as amount from benefit_promotional_credits where user_id=${user.id!} and (expires_at is null or expires_at>now())`;
 const rewarded=await tx`select * from benefit_redemptions where user_id=${user.id!} and source='REFERRAL' order by redeemed_at desc limit 20`;
 return {programs,rewards:rewarded.map(redemption),attribution:attribution??null,canAttribute:!attribution&&!late?.late&&account?.status==='ACTIVE'&&!!account?.email_verified_at&&!account?.referral_rewards_excluded&&new Date(account.created_at).getTime()>=Date.now()-7*86400000,promotionalBalance:credits[0]?.amount??'0.00',promotionalSpendEnabled:false};
 }));
 app.post('/v1/referrals/attribute',guarded(async(r,s)=>{const user=await mobile(r,s);if(!user)return;const b=z.object({code:z.string().trim().toUpperCase().regex(/^CG-[A-F0-9]{16}$/),programId:z.string().uuid(),source:z.enum(['MANUAL','LINK']).default('MANUAL'),latitude:z.number().optional(),longitude:z.number().optional()}).strict().parse(r.body);const zone=await area(r,user.id!,true);return database().begin(tx=>attributeReferral(tx,user,b.code,b.programId,zone,b.source));}));
 app.get('/v1/public/referrals/:code',guarded(async(r,s)=>{s.header('Cache-Control','no-store');const {code}=z.object({code:z.string().regex(/^CG-[A-F0-9]{16}$/)}).parse(r.params);const p=z.object({program:z.string().max(80).optional()}).parse(r.query);
 const [row]=await database()`select p.name,p.code as program,p.description,p.required_event,p.required_trips,p.must_be_approved,p.must_be_active from referral_codes c join users u on u.id=c.user_id cross join benefit_reward_programs p where c.code=${code} and u.status='ACTIVE' and not referral_test_account(u.id) and (${p.program??null}::text is null or p.code=${p.program??null}) and p.enabled and p.status='ACTIVE' and p.starts_at<=now() and p.ends_at>now() order by p.created_at desc,p.id limit 1`;
 if(!row)return s.code(404).send({error:'REFERRAL_NOT_AVAILABLE'});return {...row,code,condition:conditionText(row)};
 }));
 app.post('/v1/admin/referral-exclusions',guarded(async r=>{
 const actor=requirePermission(r,'benefits:manage');const b=z.object({userEmail:z.string().email().optional(),tripId:z.string().uuid().optional(),excluded:z.boolean()}).strict().refine(v=>!!v.userEmail!==!!v.tripId).parse(r.body);
 return database().begin(async tx=>{const rows=b.userEmail?await tx`update users set referral_rewards_excluded=${b.excluded} where lower(email)=lower(${b.userEmail}) returning id`:await tx`update trips set referral_test_trip=${b.excluded} where id=${b.tripId!} returning id`;
 if(!rows.length)throw new Error('REFERRAL_NOT_AVAILABLE');await audit(tx,actor.id??null,'REFERRAL_TEST_EXCLUSION',rows[0]!.id,{excluded:b.excluded,entity:b.userEmail?'USER':'TRIP'});return {updated:true};});
 }));
 const root='/v1/admin/referral-programs';
 app.get(root,guarded(async r=>{requirePermission(r,'benefits:view');const rows=await database()`select p.*,array(select service_area_id::text from referral_program_areas where program_id=p.id) as zone_ids,
 (select jsonb_build_object('registered',count(*),'pending',count(*) filter(where status='PENDING'),'qualified',count(*) filter(where status in ('QUALIFIED','REWARDED')),'rewarded',count(*) filter(where status='REWARDED'),'codesUsed',count(distinct referral_code),'linksUsed',count(*) filter(where source='LINK'),'manualCodesUsed',count(*) filter(where source='MANUAL'),'grants',(select count(*) from benefit_redemptions b join benefit_referrals r on b.reference_id in (r.id::text||':REFERRER',r.id::text||':REFERRED') where b.source='REFERRAL' and r.program_id=p.id),'blocked',count(*) filter(where last_error is not null)) from benefit_referrals where program_id=p.id) as metrics
 from benefit_reward_programs p where p.code is not null order by p.created_at desc`;
 return {items:rows.map(present),events:referralEvents};}));
 const write=async(r:FastifyRequest,edit:boolean)=>{const actor=requirePermission(r,'benefits:manage'),raw=r.body as any,b=referralProgramSchema.parse(edit?Object.fromEntries(Object.entries(raw).filter(([k])=>k!=='version')):raw),id=edit?z.object({id:z.string().uuid()}).parse(r.params).id:null;
 const mustApproved=b.mustBeApproved??b.qualifyingEvent.startsWith('DRIVER_');
 return database().begin(async tx=>{
 let old:any=null;if(edit){[old]=await tx`select * from benefit_reward_programs where id=${id} for update`;if(!old||old.version!==raw.version)throw new Error('REFERRAL_VERSION_CONFLICT');if(old.code!==b.code)throw new Error('REFERRAL_CONTRACT_LOCKED');

 }
 for(const zone of b.zoneIds){const [ok]=await tx`select id from service_areas where id=${zone} and enabled`;if(!ok)throw new Error('REFERRAL_NOT_AVAILABLE');}
 for(const [index,code] of [b.referrerBenefitCode,b.referredBenefitCode].entries()){if(!code)continue;const [benefit]=await tx`select * from benefit_definitions where code=${code}`;
 if(!benefit||benefit.requires_activation||!['COURTESY_DAYS','PROMOTIONAL_BALANCE'].includes(benefit.benefit_type)||benefit.audience!=='BOTH'&&benefit.audience!==b.audience||index===0&&benefit.one_time||b.status==='ACTIVE'&&(benefit.status!=='ACTIVE'||new Date(benefit.starts_at)>new Date(b.startsAt)||new Date(benefit.ends_at)<new Date(b.endsAt)))throw new Error('REFERRAL_INVALID_BENEFIT');
 const benefitZones=await tx`select service_area_id::text as id from benefit_areas where benefit_id=${benefit.id}`;if(benefitZones.length&&(!b.zoneIds.length||b.zoneIds.some(zone=>!benefitZones.some(x=>x.id===zone))))throw new Error('REFERRAL_INVALID_BENEFIT');
 }
 let result:any;if(edit){[result]=await tx`update benefit_reward_programs set must_be_approved=${mustApproved},must_be_active=${b.mustBeActive},name=${b.name},description=${b.description},audience=${b.audience},starts_at=${b.startsAt},ends_at=${b.endsAt},required_event=${b.qualifyingEvent},required_trips=${b.requiredTrips},referrer_benefit_code=${b.referrerBenefitCode},referred_benefit_code=${b.referredBenefitCode},max_rewards_per_referrer=${b.maxRewardsPerReferrer},max_redemptions=${b.maxGlobalRewards},status=${b.status},enabled=${b.status==='ACTIVE'},share_message=${b.shareMessage},version=version+1,updated_at=now() where id=${id} returning *`;}
 else{[result]=await tx`insert into benefit_reward_programs(must_be_approved,must_be_active,code,name,description,audience,starts_at,ends_at,required_event,required_trips,referrer_benefit_code,referred_benefit_code,max_rewards_per_referrer,max_redemptions,status,enabled,share_message) values(${mustApproved},${b.mustBeActive},${b.code},${b.name},${b.description},${b.audience},${b.startsAt},${b.endsAt},${b.qualifyingEvent},${b.requiredTrips},${b.referrerBenefitCode},${b.referredBenefitCode},${b.maxRewardsPerReferrer},${b.maxGlobalRewards},${b.status},${b.status==='ACTIVE'},${b.shareMessage}) returning *`;}
 await tx`delete from referral_program_areas where program_id=${result.id}`;for(const zone of new Set(b.zoneIds))await tx`insert into referral_program_areas values(${result.id},${zone})`;
 await audit(tx,actor.id??null,edit?'REFERRAL_PROGRAM_UPDATED':'REFERRAL_PROGRAM_CREATED',result.id,present(result),old);return present(result);
 });};
 app.post(root,guarded(async(r,s)=>s.code(201).send(await write(r,false))));app.put(root+'/:id',guarded(async r=>write(r,true)));
 app.get(root+'/:id/referrals',guarded(async r=>{requirePermission(r,'benefits:view');const {id}=z.object({id:z.string().uuid()}).parse(r.params);const entries=await database()`select r.*,inviter.full_name as referrer,invitee.full_name as referred from benefit_referrals r join users inviter on inviter.id=r.referrer_user_id join users invitee on invitee.id=r.referred_user_id where program_id=${id} order by r.created_at desc limit 200`;return {items:await Promise.all(entries.map(async entry=>({...entry,progress:publicProgress(await referralProgress(database(),entry))}))),history:await database()`select action,next_value,created_at from audit_log where entity_type='REFERRAL' and (entity_id=${id} or entity_id in(select id::text from benefit_referrals where program_id=${id})) order by created_at desc limit 100`};}));
}
