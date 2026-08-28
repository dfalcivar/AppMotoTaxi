import { z } from 'zod';
import { database } from '../database.js';
import type { TransactionSql, Sql } from 'postgres';

export const fiscalProfileSchema = z.object({
  identificationType: z.enum(['CEDULA','RUC']),
  identification: z.string().trim().regex(/^\d+$/),
  legalName: z.string().trim().min(3).max(200),
  address: z.string().trim().min(5).max(500),
  billingEmail: z.string().trim().email().max(254).transform(v=>v.toLowerCase()),
  expectedRevision: z.number().int().min(0)
}).strict().superRefine((v,ctx)=>{
  // Format validation is not a claim that an identity is registered or active at SRI.
  if(v.identification.length!==(v.identificationType==='CEDULA'?10:13)||/^0+$/.test(v.identification))
    ctx.addIssue({code:'custom',path:['identification'],message:'Identificación inválida: cédula de 10 dígitos o RUC de 13 dígitos.'});
});
export type FiscalProfileInput = z.infer<typeof fiscalProfileSchema>;
export type FiscalOwner = {type:'CONDUCTOR'|'COMERCIO';id:string};
export type FiscalActor = {id?:string;process?:string};
type Db = Sql | TransactionSql;

export class ClienteService {
  async find(owner:FiscalOwner,tx:Db=database()) {
    const [client]=await tx`select c.id::text,c.active,c.created_at as "createdAt" from fiscal_client_links l
      join fiscal_clients c on c.id=l.client_id where l.link_type=${owner.type} and l.entity_id=${owner.id} and c.active`;
    return client??null;
  }
  async ensure(owner:FiscalOwner,tx:TransactionSql) {
    // Lock the actual owner to serialize profile creation with account deletion.
    const owners=owner.type==='CONDUCTOR'
      ?await tx`select id from users where id=${owner.id} and deleted_at is null for update`
      :await tx`select id from advertisers where id=${owner.id} for update`;
    if(!owners.length)throw new Error('FISCAL_OWNER_NOT_FOUND');
    const existing=await this.find(owner,tx);
    if(existing)return String(existing.id);
    const [client]=await tx`insert into fiscal_clients default values returning id::text`;
    await tx`insert into fiscal_client_links(client_id,link_type,entity_id,user_id,advertiser_id)
      values(${client!.id},${owner.type},${owner.id},${owner.type==='CONDUCTOR'?owner.id:null},${owner.type==='COMERCIO'?owner.id:null})`;
    return String(client!.id);
  }
}

export class PerfilFiscalService {
  async get(clientId:string,tx:Db=database()) {
    const [profile]=await tx`select id::text,client_id::text as "clientId",identification_type as "identificationType",
      identification,legal_name as "legalName",address,billing_email as "billingEmail",revision,updated_at as "updatedAt"
      from fiscal_profiles where client_id=${clientId} and active`;
    return profile??null;
  }
  async forOwner(owner:FiscalOwner,tx:Db=database()) {
    const client=await new ClienteService().find(owner,tx);
    return {clientId:client?.id??null,profile:client?await this.get(String(client.id),tx):null};
  }
  async save(owner:FiscalOwner,input:FiscalProfileInput,actor:FiscalActor) {
    const data=fiscalProfileSchema.parse(input);
    return database().begin(async tx=>{
      const clientId=await new ClienteService().ensure(owner,tx);
      return this.saveClient(clientId,data,actor,tx);
    });
  }
  async saveClient(clientId:string,input:FiscalProfileInput,actor:FiscalActor,tx:TransactionSql) {
    const [client]=await tx`select id from fiscal_clients where id=${clientId} and active for update`;
    if(!client)throw new Error('FISCAL_OWNER_NOT_FOUND');
    const existing=await this.get(clientId,tx);
    if(Number(existing?.revision??0)!==input.expectedRevision) {
      // Retrying an already committed identical write is successful, not a second revision/audit event.
      if(existing&&['identificationType','identification','legalName','address','billingEmail'].every(k=>existing[k]===input[k as keyof FiscalProfileInput]))return existing;
      throw new Error('FISCAL_PROFILE_CHANGED');
    }
    if(existing&&['identificationType','identification','legalName','address','billingEmail'].every(k=>existing[k]===input[k as keyof FiscalProfileInput]))return existing;
    await tx`insert into fiscal_profiles(client_id,identification_type,identification,legal_name,address,billing_email)
      values(${clientId},${input.identificationType},${input.identification},${input.legalName},${input.address},${input.billingEmail})
      on conflict(client_id) do update set identification_type=excluded.identification_type,identification=excluded.identification,
        legal_name=excluded.legal_name,address=excluded.address,billing_email=excluded.billing_email,
        revision=fiscal_profiles.revision+1,updated_at=now(),active=true`;
    await tx`update fiscal_clients set updated_at=now() where id=${clientId}`;
    const saved=await this.get(clientId,tx);
    await tx`insert into fiscal_audit(client_id,entity_type,entity_id,event_type,actor_id,actor_process)
      values(${clientId},'PERFIL_FISCAL',${saved!.id},${existing?'PerfilFiscalActualizado':'PerfilFiscalCreado'},${actor.id??null},${actor.process??null})`;
    return saved;
  }
}

export async function requireOrderFiscalProfile(tx:Db,source:'MEMBRESIA'|'PUBLICIDAD',orderId:string) {
  const [order]=source==='MEMBRESIA'
    ?await tx`select driver_id::text as owner,fiscal_required from membership_payment_orders where id=${orderId}`
    :await tx`select advertiser_id::text as owner,fiscal_required from advertising_orders where id=${orderId}`;
  if(!order)throw new Error('FISCAL_OWNER_NOT_FOUND');
  if(!order.fiscal_required)return; // Old orders/proofs can still be approved without a forced migration.
  const {profile}=await new PerfilFiscalService().forOwner({type:source==='MEMBRESIA'?'CONDUCTOR':'COMERCIO',id:String(order.owner)},tx);
  if(!profile)throw new Error('FISCAL_PROFILE_REQUIRED');
}
