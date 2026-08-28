import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from './admin.js';
import { deleteIncompleteDriver, incompleteAccountDeletionSchema, mobileIdentitySchema, updateMobileIdentity } from './mobile-account-maintenance.js';

export async function registerMobileAccountAdminRoutes(app:FastifyInstance) {
  const errorReply=(error:unknown,reply:any)=>{
    if(error instanceof z.ZodError)return reply.code(400).send({error:'INVALID_ACCOUNT_DATA'});
    const value=error as {message?:string;code?:string;constraint_name?:string};
    if(['FORBIDDEN','UNAUTHORIZED'].includes(value.message??''))return reply.code(403).send({error:'FORBIDDEN'});
    if(value.message==='MOBILE_ACCOUNT_NOT_FOUND')return reply.code(404).send({error:value.message});
    if(['ACCOUNT_CHANGED_REFRESH','ACCOUNT_HAS_ACTIVE_TRIP','EMAIL_ALREADY_EXISTS','PHONE_ALREADY_EXISTS','ACCOUNT_NOT_INCOMPLETE','ACCOUNT_HAS_OPERATIONAL_HISTORY'].includes(value.message??''))return reply.code(409).send({error:value.message});
    if(value.code==='23505')return reply.code(409).send({error:value.constraint_name?.includes('email')?'EMAIL_ALREADY_EXISTS':value.constraint_name?.includes('phone')?'PHONE_ALREADY_EXISTS':'ACCOUNT_DATA_CONFLICT'});
    app.log.error({err:error},'mobile_account_maintenance_failed');
    return reply.code(500).send({error:'ACCOUNT_MAINTENANCE_FAILED'});
  };
  app.patch('/v1/admin/mobile-accounts/:id/identity',async(request,reply)=>{
    try {
      const actor=requirePermission(request,'mobile_accounts:edit');
      const id=z.string().uuid().parse((request.params as {id:string}).id);
      const input=mobileIdentitySchema.parse(request.body);
      if(!process.env.DATABASE_URL)return reply.code(503).send({error:'DATABASE_UNAVAILABLE'});
      return await updateMobileIdentity(id,input,actor.id!);
    }catch(error){return errorReply(error,reply);}
  });
  app.post('/v1/admin/mobile-accounts/:id/delete-incomplete',async(request,reply)=>{
    try {
      const actor=requirePermission(request,'mobile_accounts:delete_incomplete');
      const id=z.string().uuid().parse((request.params as {id:string}).id);
      const input=incompleteAccountDeletionSchema.parse(request.body);
      if(!process.env.DATABASE_URL)return reply.code(503).send({error:'DATABASE_UNAVAILABLE'});
      return await deleteIncompleteDriver(id,input,actor.id!);
    }catch(error){return errorReply(error,reply);}
  });
}
