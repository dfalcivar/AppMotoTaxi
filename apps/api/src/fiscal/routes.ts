import type { FastifyInstance,FastifyRequest,FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { database } from '../database.js';
import { requirePermission,userFrom,type SessionUser } from '../admin.js';
import { PerfilFiscalService,ClienteService,fiscalProfileSchema,type FiscalOwner } from './clients.js';
import { billingConfiguration,billingProvider } from './providers.js';
import { FacturaService } from './invoices.js';

const profileService=new PerfilFiscalService();
const uuid=z.string().uuid();
export const fiscalFilterSchema=z.object({
  search:z.string().trim().max(120).default(''),limit:z.coerce.number().int().min(1).max(100).default(25),
  offset:z.coerce.number().int().min(0).default(0),start:z.string().date().optional(),end:z.string().date().optional(),
  source:z.enum(['MEMBRESIA','PUBLICIDAD','PUNTO_VENTA','OTRO']).optional(),status:z.string().max(40).optional(),
  zoneId:z.string().uuid().optional(),serviceType:z.string().max(40).optional(),clientId:z.string().uuid().optional()
}).refine(v=>!v.start||!v.end||v.start<=v.end,'Rango de fechas inválido');
const messages:Record<string,string>={
  FISCAL_PROFILE_REQUIRED:'Registra los datos de facturación para continuar con el pago.',
  FISCAL_PROFILE_CHANGED:'Los datos cambiaron en otra sesión. Actualiza y vuelve a intentarlo.',
  FISCAL_OWNER_NOT_FOUND:'No se encontró un cliente vigente para esta operación.',
  FISCAL_CONTEXT_UNAVAILABLE:'La orden ya no está disponible o no tienes acceso a ella.',
  FISCAL_PROVIDER_DISABLED:'La emisión electrónica aún no está habilitada. El pago y el servicio no se modifican.',
  FORBIDDEN:'No tienes permiso para consultar o modificar estos datos.',UNAUTHORIZED:'Inicia sesión nuevamente.'
};
export function fiscalError(error:unknown,reply:FastifyReply){
  if(error instanceof z.ZodError)return reply.code(400).send({error:'INVALID_FISCAL_DATA',message:'Revisa la identificación, nombre, dirección y correo de facturación.',fields:error.issues.map(v=>({field:v.path[0],message:v.message}))});
  const code=error instanceof Error?error.message:'';
  return reply.code(code==='UNAUTHORIZED'?401:code==='FORBIDDEN'?403:code==='FISCAL_PROFILE_CHANGED'?409:messages[code]?400:500)
    .send({error:messages[code]?code:'FISCAL_OPERATION_FAILED',message:messages[code]??'No fue posible guardar o consultar los datos. Intenta nuevamente.'});
}
async function driver(request:FastifyRequest):Promise<SessionUser>{
  const actor=userFrom(request);
  if(!actor?.id||actor.role!=='DRIVER')throw new Error('UNAUTHORIZED');
  const [valid]=await database()`select id from users where id=${actor.id} and active_session_id=${actor.sessionId??null}::uuid and deleted_at is null`;
  if(!valid)throw new Error('UNAUTHORIZED');
  return actor;
}
async function contextOwner(kind:string,id:string,request:FastifyRequest){
  uuid.parse(id);
  if(kind==='membership'){
    let reviewer=false;
    try{requirePermission(request,'payments:transfer_review');reviewer=true;}catch{/* scoped collectors use their assignment */}
    const actor=reviewer?requirePermission(request,'payments:transfer_review'):requirePermission(request,'payments:collect');
    if(reviewer&&request.method==='PUT')requirePermission(request,'CLIENTES_FISCALES_EDITAR');
    if(!reviewer){
    const [assignment]=await database()`select 1 from collector_assignments ca join collection_points cp on cp.id=ca.collection_point_id
      where ca.collector_id=${actor.id!} and cp.status='ACTIVE' and ca.starts_at<=now() and (ca.ends_at is null or ca.ends_at>now()) limit 1`;
    if(!assignment)throw new Error('FORBIDDEN');
    }
    const [order]=await database()`select driver_id::text as owner from membership_payment_orders
      where id=${id} and (${reviewer&&request.method==='GET'} or (status in ('PENDING','PENDING_VERIFICATION') and expires_at>now()))`;
    if(!order)throw new Error('FISCAL_CONTEXT_UNAVAILABLE');
    return {owner:{type:'CONDUCTOR',id:String(order.owner)} as FiscalOwner,actor};
  }
  if(kind==='advertising'){
    const actor=requirePermission(request,'commercial:orders:view');
    if(actor.role!=='COMMERCIAL'&&request.method==='PUT')requirePermission(request,'CLIENTES_FISCALES_EDITAR');
    const [order]=await database()`select o.advertiser_id::text as owner from advertising_orders o
      where o.id=${id} and (${actor.role!=='COMMERCIAL'&&request.method==='GET'} or o.status in ('PENDING_PAYMENT','PAYMENT_REVIEW'))
      and (${actor.role!=='COMMERCIAL'} or (o.assigned_commercial_id=${actor.id!} and not exists(
        select 1 from advertising_payments p join advertising_payment_methods m on m.id=p.payment_method_id where p.order_id=o.id and m.code='BANK_TRANSFER')))`;
    if(!order)throw new Error('FISCAL_CONTEXT_UNAVAILABLE');
    return {owner:{type:'COMERCIO',id:String(order.owner)} as FiscalOwner,actor};
  }
  throw new Error('FISCAL_CONTEXT_UNAVAILABLE');
}
async function ownerData(owner:FiscalOwner){
  const fiscal=await profileService.forOwner(owner);
  const [prefill]=owner.type==='CONDUCTOR'
    ?await database()`select full_name as "legalName",email as "billingEmail" from users where id=${owner.id} and deleted_at is null`
    :await database()`select business_name as "legalName",email as "billingEmail" from advertisers where id=${owner.id}`;
  return {...fiscal,prefill:prefill??{}};
}
function uploadHash(token:string){return createHash('sha256').update(`${process.env.ADMIN_SESSION_SECRET??'costa-go-local-development'}:advertising-payment-upload:${token}`).digest('hex');}
async function publicOwner(token:string,tx:ReturnType<typeof database>|any){
  z.string().min(32).max(200).parse(token);
  const [order]=await tx`select orders.advertiser_id::text as owner from advertising_payment_upload_tokens upload
    join advertising_orders orders on orders.id=upload.order_id where upload.token_hash=${uploadHash(token)}
    and upload.status in ('CREATED','OPENED') and upload.expires_at>now() and orders.status in ('PENDING_PAYMENT','PAYMENT_REVIEW') for update of upload`;
  if(!order)throw new Error('FISCAL_CONTEXT_UNAVAILABLE');
  return {type:'COMERCIO',id:String(order.owner)} as FiscalOwner;
}

export async function registerFiscalRoutes(app:FastifyInstance){
  app.addHook('onSend',async(request,reply,payload)=>{
    if(request.url.startsWith('/v1/admin/fiscal/')||request.url.startsWith('/v1/driver/fiscal-profile')||request.url.includes('/fiscal-profile'))reply.header('Cache-Control','private, no-store');
    return payload;
  });
  app.get('/v1/admin/fiscal/options',async(req,reply)=>{try{requirePermission(req,'FACTURACION_DASHBOARD_VER');return {zones:await database()`select id::text,name from service_areas order by name`};}catch(e){return fiscalError(e,reply);}});
  app.get('/v1/admin/fiscal/clients/:id/profile',async(req,reply)=>{try{requirePermission(req,'CLIENTES_FISCALES_VER');reply.header('Cache-Control','private, no-store');return {profile:await profileService.get(uuid.parse((req.params as any).id))};}catch(e){return fiscalError(e,reply);}});
  app.get('/v1/driver/fiscal-profile',async(req,reply)=>{try{reply.header('Cache-Control','private, no-store');const actor=await driver(req);return await ownerData({type:'CONDUCTOR',id:actor.id!});}catch(e){return fiscalError(e,reply);}});
  app.put('/v1/driver/fiscal-profile',async(req,reply)=>{try{const actor=await driver(req);return {profile:await profileService.save({type:'CONDUCTOR',id:actor.id!},fiscalProfileSchema.parse(req.body),{id:actor.id})};}catch(e){return fiscalError(e,reply);}});
  app.get('/v1/admin/fiscal/context/:kind/:id',async(req,reply)=>{try{reply.header('Cache-Control','private, no-store');const p=req.params as any;const {owner}=await contextOwner(p.kind,p.id,req);return await ownerData(owner);}catch(e){return fiscalError(e,reply);}});
  app.put('/v1/admin/fiscal/context/:kind/:id',async(req,reply)=>{try{const p=req.params as any;const {owner,actor}=await contextOwner(p.kind,p.id,req);
    if(p.kind==='advertising')requirePermission(req,actor.role==='COMMERCIAL'?'commercial:orders:manage':'commercial:payments:review');
    return {profile:await profileService.save(owner,fiscalProfileSchema.parse(req.body),{id:actor.id})};}catch(e){return fiscalError(e,reply);}});
  app.get('/v1/public/advertising/payment-proof/:token/fiscal-profile',async(req,reply)=>{try{
    reply.header('Cache-Control','private, no-store');const owner=await publicOwner((req.params as any).token,database());return await ownerData(owner);
  }catch(e){return fiscalError(e,reply);}});
  app.put('/v1/public/advertising/payment-proof/:token/fiscal-profile',async(req,reply)=>{try{
    const input=fiscalProfileSchema.parse(req.body);
    const profile=await database().begin(async tx=>{const owner=await publicOwner((req.params as any).token,tx);
      const clientId=await new ClienteService().ensure(owner,tx);return profileService.saveClient(clientId,input,{process:'SECURE_PAYMENT_LINK'},tx);});
    return {profile};
  }catch(e){return fiscalError(e,reply);}});

  app.get('/v1/admin/fiscal/config',async(req,reply)=>{try{requirePermission(req,'FACTURACION_VER');return {...billingConfiguration(),providerReady:billingProvider().configured,
    profilesEnabled:true,emissionAvailable:billingConfiguration().enabled&&billingProvider().configured};}catch(e){return fiscalError(e,reply);}});
  app.get('/v1/admin/fiscal/clients',async(req,reply)=>{try{
    requirePermission(req,'CLIENTES_FISCALES_VER');const q=fiscalFilterSchema.parse(req.query);reply.header('Cache-Control','private, no-store');
    const rows=await database()`select c.id::text,c.active,c.created_at as "createdAt",c.updated_at as "updatedAt",
      p.identification_type as "identificationType",p.identification,p.legal_name as "legalName",p.billing_email as "billingEmail",
      (select string_agg(distinct l.link_type,', ') from fiscal_client_links l where l.client_id=c.id) as origin,
      count(*) over()::int as "totalCount" from fiscal_clients c left join fiscal_profiles p on p.client_id=c.id
      where c.active and (${q.search}='' or concat_ws(' ',p.legal_name,p.identification,p.billing_email) ilike ${'%'+q.search+'%'})
      and (${q.clientId??null}::uuid is null or c.id=${q.clientId??null})
      and (${q.start??null}::date is null or c.created_at>=(${q.start??null}::date::timestamp at time zone 'America/Guayaquil'))
      and (${q.end??null}::date is null or c.created_at<((${q.end??null}::date+1)::timestamp at time zone 'America/Guayaquil'))
      order by c.created_at desc limit ${q.limit} offset ${q.offset}`;
    return {items:rows,total:Number(rows[0]?.totalCount??0)};
  }catch(e){return fiscalError(e,reply);}});
  app.get('/v1/admin/fiscal/clients/:id',async(req,reply)=>{try{
    requirePermission(req,'CLIENTES_FISCALES_VER');const id=uuid.parse((req.params as any).id);reply.header('Cache-Control','private, no-store');
    const [client]=await database()`select id::text,active,created_at as "createdAt" from fiscal_clients where id=${id}`;
    if(!client)throw new Error('FISCAL_OWNER_NOT_FOUND');
    const links=await database()`select l.link_type as type,l.entity_id::text as "entityId",coalesce(u.full_name,a.business_name) as name
      from fiscal_client_links l left join users u on u.id=l.user_id left join advertisers a on a.id=l.advertiser_id where l.client_id=${id}`;
    const history=await database()`select event_type as event,result,actor_process as process,actor_id::text as "actorId",created_at as date
      from fiscal_audit where client_id=${id} order by created_at desc limit 100`;
    const notes=await database()`select n.id::text,n.amount::float8,n.status,n.created_at as date from fiscal_credit_notes n join fiscal_invoices i on i.id=n.invoice_id where i.client_id=${id} order by n.created_at desc limit 100`;
    return {client,links,profile:await profileService.get(id),history,creditNotes:notes};
  }catch(e){return fiscalError(e,reply);}});
  app.put('/v1/admin/fiscal/clients/:id/profile',async(req,reply)=>{try{
    const actor=requirePermission(req,'CLIENTES_FISCALES_EDITAR'),id=uuid.parse((req.params as any).id),input=fiscalProfileSchema.parse(req.body);
    return {profile:await database().begin(tx=>profileService.saveClient(id,input,{id:actor.id},tx))};
  }catch(e){return fiscalError(e,reply);}});
  app.get('/v1/admin/fiscal/invoices',async(req,reply)=>{try{
    requirePermission(req,'FACTURACION_VER');const q=fiscalFilterSchema.parse(req.query);reply.header('Cache-Control','private, no-store');
    const rows=await database()`select id::text,document_number as number,external_reference as reference,client_id::text as "clientId",
      fiscal_snapshot as profile,concept,source,subtotal::float8,tax_amount::float8 as tax,total::float8,currency,status,provider,
      issued_at as "issuedAt",authorized_at as "authorizedAt",created_at as "createdAt",count(*) over()::int as "totalCount"
      from fiscal_invoices where (${q.start??null}::date is null or paid_at>=(${q.start??null}::date::timestamp at time zone 'America/Guayaquil'))
      and (${q.end??null}::date is null or paid_at<((${q.end??null}::date+1)::timestamp at time zone 'America/Guayaquil'))
      and (${q.source??null}::text is null or source=${q.source??null}) and (${q.status??null}::text is null or status=${q.status??null}
        or (${q.status??null}='PENDING_ALL' and status in ('BORRADOR','PENDIENTE','PENDIENTE_INTEGRACION','ENVIANDO','RECIBIDA','PENDIENTE_REINTENTO')))
      and (${q.zoneId??null}::uuid is null or zone_id=${q.zoneId??null}) and (${q.serviceType??null}::text is null or service_type=${q.serviceType??null})
      and (${q.clientId??null}::uuid is null or client_id=${q.clientId??null})
      and (${q.search}='' or concat_ws(' ',document_number,external_reference,fiscal_snapshot->>'legalName',fiscal_snapshot->>'identification') ilike ${'%'+q.search+'%'})
      order by created_at desc limit ${q.limit} offset ${q.offset}`;
    return {items:rows,total:Number(rows[0]?.totalCount??0)};
  }catch(e){return fiscalError(e,reply);}});
  app.get('/v1/admin/fiscal/invoices/:id',async(req,reply)=>{try{
    requirePermission(req,'FACTURACION_VER');const id=uuid.parse((req.params as any).id);reply.header('Cache-Control','private, no-store');
    const [invoice]=await database()`select * from fiscal_invoices where id=${id}`;
    if(!invoice)return reply.code(404).send({message:'No se encontró el documento.'});
    const history=await database()`select event_type as event,result,created_at as date from fiscal_audit where entity_type='FACTURA' and entity_id=${id} order by created_at desc`;
    return {invoice,history,actionsEnabled:false};
  }catch(e){return fiscalError(e,reply);}});
  app.post('/v1/admin/fiscal/invoices/:id/:action',async(req,reply)=>{try{
    requirePermission(req,'FACTURACION_ADMINISTRAR');uuid.parse((req.params as any).id);
    // Explicitly unavailable; never manufacture XML, RIDE, authorization or credit notes.
    throw new Error('FISCAL_PROVIDER_DISABLED');
  }catch(e){return fiscalError(e,reply);}});
  app.get('/v1/admin/fiscal/payments',async(req,reply)=>{try{
    requirePermission(req,'FACTURACION_VER');const q=fiscalFilterSchema.parse(req.query);
    const rows=await database()`select o.id::text,o.payment_id::text as "paymentId",o.source,o.concept,o.amount::float8,o.currency,
      o.paid_at as "paidAt",o.payment_reversed as reversed,o.client_id::text as "clientId",o.fiscal_snapshot as profile,coalesce(i.status,'PENDIENTE_INTEGRACION') as "billingStatus",i.id::text as "invoiceId",count(*) over()::int as "totalCount"
      from fiscal_billing_outbox o left join fiscal_invoices i on i.source=o.source and i.payment_id=o.payment_id and i.document_type=o.document_type
      where (${q.clientId??null}::uuid is null or o.client_id=${q.clientId??null}) and (${q.source??null}::text is null or o.source=${q.source??null})
      and (${q.start??null}::date is null or o.paid_at>=(${q.start??null}::date::timestamp at time zone 'America/Guayaquil'))
      and (${q.end??null}::date is null or o.paid_at<((${q.end??null}::date+1)::timestamp at time zone 'America/Guayaquil'))
      and (${q.zoneId??null}::uuid is null or o.zone_id=${q.zoneId??null})
      and (${q.serviceType??null}::text is null or o.service_type=${q.serviceType??null})
      and (${q.status??null}::text is null or coalesce(i.status,'PENDIENTE_INTEGRACION')=${q.status??null}
        or (${q.status??null}='COLLECTED' and not o.payment_reversed)
        or (${q.status??null}='UNBILLED' and not o.payment_reversed and coalesce(i.status,'PENDIENTE_INTEGRACION')<>'AUTORIZADA'))
      and (${q.search}='' or concat_ws(' ',o.payment_id,o.fiscal_snapshot->>'legalName',o.fiscal_snapshot->>'identification') ilike ${'%'+q.search+'%'})
      order by o.paid_at desc limit ${q.limit} offset ${q.offset}`;
    return {items:rows,total:Number(rows[0]?.totalCount??0)};
  }catch(e){return fiscalError(e,reply);}});
  app.get('/v1/admin/fiscal/dashboard',async(req,reply)=>{try{
    requirePermission(req,'FACTURACION_DASHBOARD_VER');return await fiscalDashboard(fiscalFilterSchema.parse(req.query));
  }catch(e){return fiscalError(e,reply);}});
  // Durable work is independent of HTTP payment approval; failures do not roll it back.
  if(process.env.DATABASE_URL&&process.env.NODE_ENV!=='test'){
    let running=false;
    const tick=async()=>{if(running)return;running=true;try{const svc=new FacturaService();await svc.collectCommittedPayments();await svc.processPending();}
      catch{app.log.error({module:'billing'},'billing_worker_retry_pending');}finally{running=false;}};
    const timer=setInterval(()=>void tick(),30_000);timer.unref();void tick();app.addHook('onClose',async()=>clearInterval(timer));
  }
}

export async function fiscalDashboard(q:z.infer<typeof fiscalFilterSchema>){
  const rows=await database()`select o.source,o.service_type as "serviceType",o.client_id::text as "clientId",o.amount::float8,o.payment_reversed as reversed,
    o.paid_at as "paidAt",i.status,i.subtotal::float8,i.tax_amount::float8 as tax,i.total::float8,
    i.authorized_at as "authorizedAt",i.fiscal_snapshot->>'legalName' as name,i.id::text as "invoiceId"
    from fiscal_billing_outbox o left join fiscal_invoices i on i.source=o.source and i.payment_id=o.payment_id and i.document_type=o.document_type
    where (${q.start??null}::date is null or o.paid_at>=(${q.start??null}::date::timestamp at time zone 'America/Guayaquil'))
    and (${q.end??null}::date is null or o.paid_at<((${q.end??null}::date+1)::timestamp at time zone 'America/Guayaquil'))
    and (${q.source??null}::text is null or o.source=${q.source??null}) and (${q.zoneId??null}::uuid is null or o.zone_id=${q.zoneId??null})
    and (${q.serviceType??null}::text is null or o.service_type=${q.serviceType??null})
    and (${q.clientId??null}::uuid is null or o.client_id=${q.clientId??null})
    and (${q.status??null}::text is null or coalesce(i.status,'PENDIENTE_INTEGRACION')=${q.status??null})`;
  const [clients]=await database()`select count(*) filter(where active)::int as active,count(*) filter(where active and
    (${q.start??null}::date is null or created_at>=(${q.start??null}::date::timestamp at time zone 'America/Guayaquil')) and
    (${q.end??null}::date is null or created_at<((${q.end??null}::date+1)::timestamp at time zone 'America/Guayaquil')))::int as new
    from fiscal_clients c where exists(select 1 from fiscal_profiles p where p.client_id=c.id and p.active)`;
  const newClients=await database()`select to_char(created_at at time zone 'America/Guayaquil','YYYY-MM-DD') as label,count(*)::int as value
    from fiscal_clients c where active and exists(select 1 from fiscal_profiles p where p.client_id=c.id and p.active)
    and (${q.start??null}::date is null or created_at>=(${q.start??null}::date::timestamp at time zone 'America/Guayaquil'))
    and (${q.end??null}::date is null or created_at<((${q.end??null}::date+1)::timestamp at time zone 'America/Guayaquil')) group by label order by label`;
  const [notes]=await database()`select count(*)::int as count,coalesce(sum(n.amount),0)::float8 as amount from fiscal_credit_notes n join fiscal_invoices i on i.id=n.invoice_id
    where n.status='AUTORIZADA' and (${q.start??null}::date is null or n.created_at>=(${q.start??null}::date::timestamp at time zone 'America/Guayaquil'))
    and (${q.end??null}::date is null or n.created_at<((${q.end??null}::date+1)::timestamp at time zone 'America/Guayaquil'))
    and (${q.source??null}::text is null or i.source=${q.source??null}) and (${q.zoneId??null}::uuid is null or i.zone_id=${q.zoneId??null})
    and (${q.serviceType??null}::text is null or i.service_type=${q.serviceType??null}) and (${q.clientId??null}::uuid is null or i.client_id=${q.clientId??null})`;
  return {...summarizeFiscalRows(rows),clients,newClients,creditNotes:notes,configuration:billingConfiguration(),
    clientMetricsScope:'Clientes activos globales; altas por fecha de registro. Importes y documentos por fecha de pago y filtros operativos.'};
}
export function summarizeFiscalRows(rows:any[]){
  const authorized=rows.filter(r=>r.status==='AUTORIZADA');
  const sum=(items:any[],key:string)=>Math.round(items.reduce((n,r)=>n+Number(r[key]??0),0)*100)/100;
  const groups=(items:any[],key:(r:any)=>string,value:string)=>Object.entries(items.reduce((map:Record<string,number>,r)=>{
    const k=key(r);map[k]=(map[k]??0)+Number(r[value]??0);return map;},{})).map(([label,value])=>({label,value:Number(Number(value).toFixed(2))}));
  const day=(r:any)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Guayaquil',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(r.authorizedAt));
  const ids=new Set(authorized.map(r=>r.clientId).filter(Boolean));
  return {collected:sum(rows.filter(r=>!r.reversed),'amount'),invoiced:sum(authorized,'total'),pendingAmount:sum(rows.filter(r=>!r.reversed&&r.status!=='AUTORIZADA'),'amount'),
    subtotal:sum(authorized,'subtotal'),tax:sum(authorized,'tax'),invoiceCount:rows.filter(r=>r.invoiceId).length,
    authorizedCount:authorized.length,pendingCount:rows.filter(r=>r.invoiceId&&['BORRADOR','PENDIENTE','PENDIENTE_INTEGRACION','ENVIANDO','RECIBIDA','PENDIENTE_REINTENTO'].includes(r.status)).length,
    rejectedCount:rows.filter(r=>r.status==='RECHAZADA').length,errorCount:rows.filter(r=>r.status==='ERROR').length,
    averageTicket:authorized.length?sum(authorized,'total')/authorized.length:0,averagePerClient:ids.size?sum(authorized,'total')/ids.size:0,
    averageInvoicesPerClient:ids.size?authorized.length/ids.size:0,
    averagePerDriver:averageForSource('MEMBRESIA'),averagePerBusiness:averageForSource('PUBLICIDAD'),
    recurringClients:groups(rows.filter(r=>!r.reversed&&r.clientId).map(r=>({...r,one:1})),r=>r.clientId,'one').filter(r=>r.value>1).length,
    collectedByDay:groups(rows.filter(r=>!r.reversed&&r.paidAt),r=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Guayaquil',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(r.paidAt)),'amount').sort((a,b)=>a.label.localeCompare(b.label)),
    byDay:groups(authorized,day,'total'),byMonth:groups(authorized,r=>day(r).slice(0,7),'total'),
    bySource:groups(authorized,r=>r.source,'total'),byService:groups(authorized,r=>r.serviceType,'total'),
    byStatus:groups(rows.filter(r=>r.invoiceId).map(r=>({...r,one:1})),r=>r.status,'one'),
    topClients:groups(authorized,r=>r.clientId??'Histórico sin cliente','total').sort((a,b)=>b.value-a.value).slice(0,10)
      .map(r=>({...r,clientId:authorized.find(a=>a.clientId===r.label)?.clientId,label:authorized.find(a=>a.clientId===r.label)?.name??r.label}))};
  function averageForSource(source:string){const items=authorized.filter(r=>r.source===source&&r.clientId),clients=new Set(items.map(r=>r.clientId));return clients.size?sum(items,'total')/clients.size:0;}
}
