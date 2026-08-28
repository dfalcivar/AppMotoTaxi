import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import {z} from 'zod';
import QRCode from 'qrcode';
import {requirePermission,type SessionUser} from '../admin.js';
import {database} from '../database.js';
import * as fleet from './service.js';
import {readVehicleFile,uploadVehicleFile} from './files.js';
import {fleetReport,fleetReportOptions} from './reports.js';

const messages:Record<string,string>={
  VEHICLE_FORBIDDEN:'No tienes autorización para gestionar esta mototaxi.',
  VEHICLE_HAS_ACTIVE_TRIP:'Hay una carrera activa o una incidencia pendiente. Finalízala antes de liberar o cambiar la mototaxi.',
  VEHICLE_IN_USE:'Otro conductor está utilizando esta mototaxi y continúa conectado.',
  VEHICLE_TAKEOVER_CONFIRMATION_REQUIRED:'La unidad tiene una jornada sin conexión. Confirma que tienes físicamente la mototaxi para tomarla.',
  VEHICLE_NOT_VERIFIED:'La mototaxi todavía no está verificada.',
  VEHICLE_NOT_FOUND:'No se encontró esa placa o registro. Revisa el dato o registra una nueva mototaxi.',
  VEHICLE_PHOTO_REQUIRED:'Adjunta la fotografía real de la mototaxi antes de verificarla.',
  DRIVER_NOT_AUTHORIZED:'Debes ser conductor aprobado y estar autorizado para esta mototaxi.',
  VEHICLE_SESSION_EXPIRED:'Tu jornada ya finalizó. Selecciona nuevamente una mototaxi.',
  VEHICLE_QR_INVALID:'Este QR no es válido o fue reemplazado. Solicita el QR vigente.',
  OWNERSHIP_EVIDENCE_REQUIRED:'Adjunta un documento que permita validar tu relación con la unidad.',
  INVALID_IMAGE:'Selecciona una imagen JPG o PNG válida.',FILE_TOO_LARGE:'El archivo debe pesar como máximo 5 MB.'
  ,USER_NOT_ELIGIBLE:'No se encontró un conductor activo con ese correo. Verifica la dirección y su registro en Costa-Go.'
};
export function fleetError(error:unknown,reply:FastifyReply){
  if(error instanceof fleet.FleetError)return reply.code(error.status).send({error:error.code,message:messages[error.code]??'No se puede completar esta acción sobre la mototaxi.'});
  if(error instanceof z.ZodError)return reply.code(400).send({error:'INVALID_FLEET_DATA',message:'Revisa los datos del formulario.'});
  if(error instanceof Error&&['UNAUTHORIZED','FORBIDDEN','COOPERATIVE_SCOPE_REQUIRED'].includes(error.message))return reply.code(error.message==='UNAUTHORIZED'?401:403).send({error:error.message,message:'No tienes permiso para realizar esta acción.'});
  if((error as any)?.code==='23505')return reply.code(409).send({error:'FLEET_CONFLICT',message:'La unidad o solicitud ya existe. Actualiza la lista antes de intentar otra vez.'});
  reply.log.error({err:error},'fleet_operation_failed');
  return reply.code(500).send({error:'FLEET_UNAVAILABLE',message:'No fue posible completar la operación. Intenta nuevamente.'});
}
const pathId=(req:FastifyRequest)=>z.uuid().parse((req.params as any).id);
const query=z.object({search:z.string().max(80).default(''),page:z.coerce.number().int().min(0).max(10000).default(0),
  status:z.enum(['','PENDING','VERIFIED','SUSPENDED']).default(''),managed:z.enum(['true','false']).default('false'),
  from:z.iso.datetime().default('1970-01-01T00:00:00Z'),to:z.iso.datetime().default('2100-01-01T00:00:00Z')});
type Authenticate=(req:FastifyRequest,reply:FastifyReply,options?:{allowPendingDriver?:boolean})=>Promise<SessionUser|undefined>;
export async function registerFleetRoutes(app:FastifyInstance,authenticate:Authenticate){
  async function actor(req:FastifyRequest,reply:FastifyReply,manage=false):Promise<fleet.FleetActor|null>{
    if(req.url.startsWith('/v1/admin/')){
      const user=requirePermission(req,manage?'fleet:manage':'fleet:view');
      // A permission override never removes the mandatory cooperative boundary.
      if(!['ADMIN','SUPER_ADMIN','ANALISTA_COOPERATIVA'].includes(user.role))throw new fleet.FleetError('FORBIDDEN',403);
      return {id:user.id!,admin:true,cooperativeId:user.role==='ANALISTA_COOPERATIVA'?user.cooperativeId:undefined,ip:req.ip};
    }
    const user=await authenticate(req,reply,{allowPendingDriver:true});
    return user?.id?{id:user.id,ip:req.ip}:null;
  }
  for(const base of ['/v1/fleet','/v1/admin/fleet']){
    app.get(`${base}/report/options`,async(req,reply)=>{try{const a=await actor(req,reply);if(!a)return;const q=query.parse(req.query);return await fleetReportOptions(a,q.search);}catch(e){return fleetError(e,reply);}});
    app.get(`${base}/report`,async(req,reply)=>{try{const a=await actor(req,reply);if(!a)return;return await fleetReport(a,req.query);}catch(e){return fleetError(e,reply);}});
    app.get(`${base}/vehicles`,async(req,reply)=>{try{
      const a=await actor(req,reply);if(!a)return;const q=query.parse(req.query);
      return {items:await fleet.listVehicles(a,q.search,q.page,q.status,q.managed==='true')};
    }catch(e){return fleetError(e,reply);}});
    app.post(`${base}/vehicles`,async(req,reply)=>{try{const a=await actor(req,reply,true);if(!a)return;return await fleet.requestVehicle(a,req.body);}catch(e){return fleetError(e,reply);}});
    app.get(`${base}/vehicles/:id`,async(req,reply)=>{try{const a=await actor(req,reply);if(!a)return;const q=query.parse(req.query);return await fleet.fleetDetail(a,pathId(req),q.page,q.from,q.to);}catch(e){return fleetError(e,reply);}});
    app.put(`${base}/vehicles/:id`,async(req,reply)=>{try{const a=await actor(req,reply,true);if(!a)return;return await fleet.updateVehicle(a,pathId(req),req.body);}catch(e){return fleetError(e,reply);}});
    app.put(`${base}/vehicles/:id/relations`,async(req,reply)=>{try{const a=await actor(req,reply,true);if(!a)return;
      const b=z.object({userId:z.uuid(),type:z.enum(['AUTHORIZED_DRIVER','OWNER_MANAGER']),status:z.enum(['APPROVED','REJECTED','REVOKED']),reason:z.string()}).parse(req.body);
      return await fleet.setRelation(a,pathId(req),b.userId,b.type,b.status,b.reason);
    }catch(e){return fleetError(e,reply);}});
    app.post(`${base}/vehicles/:id/drivers`,async(req,reply)=>{try{const a=await actor(req,reply,true);if(!a)return;
      const b=z.object({email:z.email(),reason:z.string().min(5).max(500)}).parse(req.body);
      return await fleet.authorizeDriverByEmail(a,pathId(req),b.email,b.reason);
    }catch(e){return fleetError(e,reply);}});
    app.post(`${base}/vehicles/:id/files`,{bodyLimit:7_100_000},async(req,reply)=>{try{const a=await actor(req,reply,true);if(!a)return;return await uploadVehicleFile(a,pathId(req),req.body);}catch(e){return fleetError(e,reply);}});
    app.get(`${base}/files/:id`,async(req,reply)=>{try{const a=await actor(req,reply);if(!a)return;
      const f=await readVehicleFile(a,pathId(req),(req.query as any).original==='true');
      reply.header('Cache-Control','private, no-store').header('X-Content-Type-Options','nosniff');return reply.type(f.mimeType).send(f.bytes);
    }catch(e){return fleetError(e,reply);}});
    app.post(`${base}/sessions/:id/release`,async(req,reply)=>{try{const a=await actor(req,reply,true);if(!a)return;
      const b=z.object({reason:z.enum(['MANUAL_RELEASE','LOGOUT','ADMIN_RELEASE']).default('MANUAL_RELEASE'),note:z.string().nullable().optional()}).parse(req.body);
      return await fleet.releaseSession(a,pathId(req),b.reason,b.note??null);
    }catch(e){return fleetError(e,reply);}});
  }
  app.get('/v1/fleet/session',async(req,reply)=>{try{const a=await actor(req,reply);if(!a)return;return await fleet.currentSession(a);}catch(e){return fleetError(e,reply);}});
  app.post('/v1/fleet/vehicles/link',async(req,reply)=>{try{const a=await actor(req,reply);if(!a)return;return await fleet.requestExistingVehicle(a,req.body);}catch(e){return fleetError(e,reply);}});
  app.post('/v1/fleet/session',async(req,reply)=>{try{const a=await actor(req,reply);if(!a)return;
    const b=z.object({vehicleId:z.uuid(),method:z.enum(['MANUAL_SELECTION','QR_SCAN','RECOVERY']).default('MANUAL_SELECTION'),takeover:z.boolean().default(false)}).parse(req.body);
    return await fleet.startSession(a,b.vehicleId,b.method,b.takeover);
  }catch(e){return fleetError(e,reply);}});
  app.post('/v1/fleet/sessions/:id/heartbeat',async(req,reply)=>{try{const a=await actor(req,reply);if(!a)return;return await fleet.heartbeat(a,pathId(req));}catch(e){return fleetError(e,reply);}});
  app.post('/v1/fleet/qr/resolve',async(req,reply)=>{try{const a=await actor(req,reply);if(!a)return;return await fleet.resolveQr(a,z.object({token:z.string()}).parse(req.body).token);}catch(e){return fleetError(e,reply);}});
  app.post('/v1/fleet/qr/request',async(req,reply)=>{try{const a=await actor(req,reply);if(!a)return;return await fleet.requestQrLink(a,z.object({token:z.string()}).parse(req.body).token);}catch(e){return fleetError(e,reply);}});
  app.get('/v1/fleet/notification-preferences',async(req,reply)=>{try{const a=await actor(req,reply);if(!a)return;return await fleet.notificationPreferences(a);}catch(e){return fleetError(e,reply);}});
  app.put('/v1/fleet/notification-preferences',async(req,reply)=>{try{const a=await actor(req,reply);if(!a)return;return await fleet.notificationPreferences(a,z.object({events:z.array(z.string())}).parse(req.body).events);}catch(e){return fleetError(e,reply);}});
  app.post('/v1/fleet/vehicles/:id/ownership-claims',async(req,reply)=>{try{const a=await actor(req,reply);if(!a)return;
    const b=z.object({evidenceId:z.uuid(),reason:z.string()}).parse(req.body);return await fleet.requestOwnership(a,pathId(req),b.evidenceId,b.reason);
  }catch(e){return fleetError(e,reply);}});
  app.post('/v1/admin/fleet/ownership-claims/:id/review',async(req,reply)=>{try{const a=await actor(req,reply,true);if(!a)return;
    const b=z.object({approved:z.boolean(),reason:z.string()}).parse(req.body);return await fleet.reviewOwnership(a,pathId(req),b.approved,b.reason);
  }catch(e){return fleetError(e,reply);}});
  app.get('/v1/admin/fleet/options',async(req,reply)=>{try{const a=await actor(req,reply);if(!a)return;
    const q=query.parse(req.query);
    return {cooperatives:await database()`select id,name from cooperatives where (${!a.cooperativeId} or id=${a.cooperativeId??null}::uuid) order by name`,
      users:await database()`select u.id,u.full_name as name,u.email,exists(select 1 from drivers where user_id=u.id) as driver
        from users u where u.deleted_at is null and (${!a.cooperativeId} or u.cooperative_id=${a.cooperativeId??null}::uuid)
        and (u.full_name ilike ${`%${q.search}%`} or u.email ilike ${`%${q.search}%`}) order by u.full_name limit 30`};
  }catch(e){return fleetError(e,reply);}});
  app.put('/v1/admin/fleet/vehicles/:id/status',async(req,reply)=>{try{const a=await actor(req,reply,true);if(!a)return;
    const b=z.object({status:z.string(),reason:z.string()}).parse(req.body);return await fleet.setVehicleStatus(a,pathId(req),b.status,b.reason);
  }catch(e){return fleetError(e,reply);}});
  app.post('/v1/admin/fleet/vehicles/:id/qr',async(req,reply)=>{try{const a=await actor(req,reply,true);if(!a)return;
    const b=z.object({regenerate:z.boolean().default(false),reason:z.string().default('Generación inicial')}).parse(req.body);
    const qr=await fleet.generateQr(a,pathId(req),b.regenerate,b.reason);
    const url=`https://costa-go.com/vehicle.html?token=${qr.token}`;
    return {url,svg:await QRCode.toString(url,{type:'svg',errorCorrectionLevel:'H',margin:4,width:512})};
  }catch(e){return fleetError(e,reply);}});
  app.delete('/v1/admin/fleet/vehicles/:id/qr',async(req,reply)=>{try{const a=await actor(req,reply,true);if(!a)return;
    return await fleet.revokeQr(a,pathId(req),z.object({reason:z.string()}).parse(req.body).reason);
  }catch(e){return fleetError(e,reply);}});
  app.get('/v1/admin/fleet/settings',async(req,reply)=>{try{const a=await actor(req,reply);if(!a)return;return await fleet.fleetSettings();}catch(e){return fleetError(e,reply);}});
  app.put('/v1/admin/fleet/settings',async(req,reply)=>{try{const a=await actor(req,reply,true);if(!a)return;return await fleet.saveFleetSettings(a,req.body);}catch(e){return fleetError(e,reply);}});
}
