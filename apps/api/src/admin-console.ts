import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {database} from './database.js';
import {hasPermission,type AdminRole,type Permission} from './permissions.js';

type Actor={id?:string;role:AdminRole;permissions?:Permission[];cooperativeId?:string};
export function consoleSearchScopes(actor:Actor) {
  const can=(p:Permission)=>hasPermission(actor.role,p,actor.permissions);
  // Scoped roles must use their existing cooperative/payment-point directories.
  // A membership viewing permission is not authority to search all drivers.
  const scoped=actor.role==='ANALISTA_COOPERATIVA'||actor.role==='COLLECTOR';
  return {drivers:can('drivers:view')&&!scoped,passengers:can('passengers:view')&&!scoped,trips:can('trips:view')&&!scoped,cooperatives:can('cooperatives:view')&&!scoped,memberships:can('memberships:view')&&!scoped,incidents:can('incidents:view')&&!scoped,campaigns:can('commercial:campaigns:view')&&!scoped,advertisers:can('commercial:advertisers:view')&&!scoped};
}
export function registerConsoleRoutes(app:FastifyInstance,session:(request:FastifyRequest)=>Actor) {
  app.get('/v1/admin/console/search',async(request,reply)=>{
    let actor:Actor;try{actor=session(request);}catch(e){return reply.code((e as Error).message==='UNAUTHORIZED'?401:403).send({error:'FORBIDDEN'});}
    const parsed=z.object({q:z.string().trim().min(2).max(100)}).safeParse(request.query);
    if(!parsed.success)return reply.code(400).send({error:'INVALID_SEARCH',message:'Escribe entre 2 y 100 caracteres.'});
    if(!process.env.DATABASE_URL)return reply.code(503).send({error:'DATABASE_UNAVAILABLE'});
    const sql=database(),scope=consoleSearchScopes(actor),q=`%${parsed.data.q.replace(/[\\%_]/g,'\\$&')}%`,own=actor.role==='COMMERCIAL',actorId=actor.id??null;
    const tasks:Promise<unknown>[]=[];
    type Result={id:string;title:string;subtitle?:string;module:string;sub?:string;query?:string};const results:Result[]=[];
    const append=(module:string,sub:string|undefined,promise:PromiseLike<any[]>)=>tasks.push(Promise.resolve(promise).then(rows=>{results.push(...rows.map(row=>({...row,module,sub})));}));
    if(scope.drivers)append('drivers',undefined,sql`select u.id::text,u.full_name as title,u.email as subtitle,u.email as query from users u join drivers d on d.user_id=u.id where u.deleted_at is null and (u.full_name ilike ${q} or u.email ilike ${q} or u.phone_e164 ilike ${q}) order by u.full_name limit 6`);
    if(scope.passengers)append('passengers',undefined,sql`select u.id::text,u.full_name as title,u.email as subtitle,u.email as query from users u where u.deleted_at is null and exists(select 1 from mobile_account_roles r where r.user_id=u.id and r.role='PASSENGER') and (u.full_name ilike ${q} or u.email ilike ${q} or u.phone_e164 ilike ${q}) order by u.full_name limit 6`);
    if(scope.trips)append('trips',undefined,sql`select t.id::text,coalesce(t.origin_reference,'Origen')||' → '||coalesce(t.destination_reference,'Destino') as title,u.full_name as subtitle from trips t join users u on u.id=t.passenger_id where (t.id::text ilike ${q} or t.origin_reference ilike ${q} or t.destination_reference ilike ${q} or u.full_name ilike ${q}) order by t.requested_at desc limit 6`);
    if(scope.cooperatives)append('cooperatives',undefined,sql`select id::text,name as title,name as query from cooperatives where name ilike ${q} order by name limit 6`);
    if(scope.memberships)append('memberships','memberships',sql`select distinct u.id::text,u.full_name as title,u.email as subtitle,u.email as query from driver_memberships m join users u on u.id=m.driver_id where u.deleted_at is null and (u.full_name ilike ${q} or u.email ilike ${q}) order by u.full_name limit 6`);
    if(scope.incidents)append('incidents',undefined,sql`select id::text,coalesce(subject,category) as title,category as subtitle,coalesce(subject,category) as query from incidents where id::text ilike ${q} or subject ilike ${q} or description ilike ${q} order by created_at desc limit 6`);
    if(scope.campaigns)append('commercial','campaigns',sql`select b.id::text,b.title as title,b.campaign_status as subtitle,b.title as query from affiliate_banners b join advertising_orders o on o.id=b.order_id where (not ${own} or o.assigned_commercial_id=${actorId}) and (b.title ilike ${q} or o.code ilike ${q}) order by b.created_at desc limit 6`);
    if(scope.advertisers)append('commercial','advertisers',sql`select a.id::text,a.business_name as title,a.email as subtitle,a.business_name as query from advertisers a where (not ${own} or (a.assigned_commercial_id=${actorId} and exists(select 1 from advertising_orders orders join advertising_payments payments on payments.order_id=orders.id join advertising_payment_methods methods on methods.id=payments.payment_method_id where orders.advertiser_id=a.id and orders.assigned_commercial_id=${actorId} and methods.code<>'BANK_TRANSFER'))) and (a.business_name ilike ${q} or a.email ilike ${q}) order by a.business_name limit 6`);
    try{await Promise.all(tasks);return {results:results.sort((a,b)=>a.module.localeCompare(b.module)||a.title.localeCompare(b.title)),limitPerType:6};}
    catch(error){request.log.error({err:error},'Console search failed');return reply.code(503).send({error:'SEARCH_UNAVAILABLE',message:'No se pudo completar la búsqueda. Intenta nuevamente.'});}
  });
  app.get('/v1/admin/operations/details/:metric',async(request,reply)=>{
    let actor:Actor;try{actor=session(request);}catch{return reply.code(401).send({error:'UNAUTHORIZED'});}
    if(!hasPermission(actor.role,'operations:view',actor.permissions)||['COLLECTOR','ANALISTA_COOPERATIVA'].includes(actor.role))return reply.code(403).send({error:'FORBIDDEN'});
    const metric=z.enum(['activeTrips','searchingTrips','delayedRequests','upcomingScheduled','connectedDrivers','availableDrivers','busyDrivers','criticalIncidents']).safeParse((request.params as any).metric);
    const query=z.object({search:z.string().trim().max(120).default(''),page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(15)}).safeParse(request.query);
    if(!metric.success||!query.success)return reply.code(400).send({error:'INVALID_DATA'});
    if(!process.env.DATABASE_URL)return reply.code(503).send({error:'DATABASE_UNAVAILABLE'});
    const sql=database(),m=metric.data,q=query.data,search='%'+q.search.replace(/[\\%_]/g,'\\$&')+'%',offset=(q.page-1)*q.pageSize;
    let rows:any[],columns:{key:string;label:string;type?:string}[],module:string;
    try{
      if(['connectedDrivers','availableDrivers','busyDrivers'].includes(m)){
        rows=await sql`select count(*) over()::int __total,u.id::text id,u.full_name name,u.status,d.is_available available,d.last_location_at as "lastActivity",coalesce(c.name,'Individual') cooperative
          from drivers d join users u on u.id=d.user_id left join cooperatives c on c.id=u.cooperative_id
          where ((${m}='connectedDrivers' and u.status='ACTIVE' and d.last_location_at>=now()-interval '5 minutes')
            or (${m}='availableDrivers' and u.status='ACTIVE' and d.is_available=true)
            or (${m}='busyDrivers' and exists(select 1 from trips t where t.driver_id=d.user_id and t.status in ('ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS'))))
          and (${q.search}='' or u.full_name ilike ${search} or coalesce(c.name,'') ilike ${search})
          order by u.full_name limit ${q.pageSize} offset ${offset}`;
        columns=[{key:'name',label:'Conductor'},{key:'status',label:'Estado',type:'status'},{key:'cooperative',label:'Cooperativa'},{key:'available',label:'Disponible'},{key:'lastActivity',label:'Última ubicación',type:'date'}];module='drivers';
      }else if(m==='criticalIncidents'){
        rows=await sql`select count(*) over()::int __total,i.id::text,i.subject,i.status,i.created_at as "createdAt",u.full_name reporter from incidents i left join users u on u.id=i.reported_by
          where i.priority='CRITICA' and i.status not in ('RESUELTO','CERRADO') and (${q.search}='' or i.subject ilike ${search} or u.full_name ilike ${search})
          order by i.created_at limit ${q.pageSize} offset ${offset}`;
        columns=[{key:'subject',label:'Asunto'},{key:'reporter',label:'Usuario'},{key:'status',label:'Estado',type:'status'},{key:'createdAt',label:'Fecha',type:'date'}];module='incidents';
      }else{
        rows=await sql`select count(*) over()::int __total,t.id::text,t.status,p.full_name passenger,coalesce(d.full_name,'Sin conductor') driver,t.origin_reference origin,t.destination_reference destination,t.requested_at as "requestedAt",t.scheduled_for as "scheduledFor"
          from trips t join users p on p.id=t.passenger_id left join users d on d.id=t.driver_id
          where ((${m}='activeTrips' and t.status in ('ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS'))
            or (${m}='searchingTrips' and t.status='SEARCHING')
            or (${m}='delayedRequests' and t.status='SEARCHING' and t.requested_at<now()-interval '2 minutes')
            or (${m}='upcomingScheduled' and t.scheduled_for between now() and now()+interval '2 hours' and t.status not in ('COMPLETED','CANCELLED')))
          and (${q.search}='' or p.full_name ilike ${search} or d.full_name ilike ${search} or t.origin_reference ilike ${search} or t.destination_reference ilike ${search})
          order by t.requested_at desc limit ${q.pageSize} offset ${offset}`;
        columns=[{key:'passenger',label:'Pasajero'},{key:'driver',label:'Conductor'},{key:'origin',label:'Origen'},{key:'destination',label:'Destino'},{key:'status',label:'Estado',type:'status'},{key:m==='upcomingScheduled'?'scheduledFor':'requestedAt',label:'Fecha',type:'date'}];module='trips';
      }
      return {metric:m,module,total:Number(rows[0]?.__total??0),page:q.page,pageSize:q.pageSize,columns,rows:rows.map(({__total,...row})=>row)};
    }catch(error){request.log.error({err:error},'Operation detail failed');return reply.code(503).send({error:'DETAIL_UNAVAILABLE',message:'No se pudo consultar el detalle. Intenta nuevamente.'});}
  });

}
