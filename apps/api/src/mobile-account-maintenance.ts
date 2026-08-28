import { randomBytes } from 'node:crypto';
import type { TransactionSql } from 'postgres';
import { z } from 'zod';
import { database } from './database.js';
import { legacyPhoneAliases, normalizeEmail, normalizePhone } from './auth-security.js';

export const mobileIdentitySchema = z.object({
  name:z.string().trim().min(3).max(120),
  email:z.string().trim().email().max(254).transform(normalizeEmail),
  phone:z.string().trim().max(30).transform(normalizePhone).refine(v=>v!==null,'INVALID_PHONE'),
  reason:z.string().trim().min(5).max(500),
  expectedEmail:z.string().nullable(),
}).strict();
export const incompleteAccountDeletionSchema=z.object({
  reason:z.string().trim().min(5).max(500),confirmation:z.literal('ELIMINAR'),expectedEmail:z.string().nullable(),
}).strict();

export async function revokeMobileAccess(tx:TransactionSql,userId:string) {
  await tx`delete from device_tokens where user_id=${userId}`;
  await tx`delete from biometric_credentials where user_id=${userId}`;
  await tx`delete from password_reset_tokens where user_id=${userId}`;
  await tx`delete from email_verification_codes where user_id=${userId}`;
  await tx`update account_deletion_requests set expires_at=least(expires_at,now()) where user_id=${userId} and completed_at is null`;
  await tx`update users set active_session_id=null where id=${userId}`;
  await tx`update drivers set is_available=false where user_id=${userId}`;
}

// Shared by self-service deletion and administrative cleanup. Keep the UUID and
// relational history; only release identifying fields and revoke credentials.
export async function anonymizeMobileIdentity(tx:TransactionSql,userId:string) {
  await revokeMobileAccess(tx,userId);
  await tx`update drivers set is_available=false,last_location=null,last_location_at=null where user_id=${userId}`;
  // Units are shared assets: deleting an account must never rename its vehicles.
  const ended=await tx`update driver_vehicle_sessions set status='ENDED',ended_at=now(),end_reason='ADMIN_RELEASE',updated_at=now()
    where driver_id=${userId} and status='ACTIVE' returning id,vehicle_id`;
  for(const session of ended)await tx`insert into vehicle_audit(vehicle_id,driver_id,action,reason,next_value)
    values(${session.vehicle_id},${userId},'session_ended','Cuenta eliminada',${JSON.stringify({sessionId:session.id,endReason:'ADMIN_RELEASE'})}::jsonb)`;
  await tx`update user_vehicle_relations set status='REVOKED',reason='Cuenta eliminada',reviewed_at=now() where user_id=${userId}`;
  await tx`update users set full_name='Cuenta eliminada',email=${`deleted+${userId}@deleted.invalid`},
    phone_e164=${`deleted:${userId}`},password_hash=crypt(${randomBytes(32).toString('hex')},gen_salt('bf')),
    profile_photo_data=null,profile_photo_mime=null,profile_photo_updated_at=null,
    cooperative_id=null,active_session_id=null,status='SUSPENDED',deleted_at=now(),updated_at=now() where id=${userId}`;
}

async function lockMobileAccount(tx:TransactionSql,id:string) {
  const [account]=await tx`select id,full_name as name,email,phone_e164 as phone,role,status,deleted_at,
    email_verified_at from users where id=${id} for update`;
  if(!account||!['PASSENGER','DRIVER'].includes(String(account.role)))throw new Error('MOBILE_ACCOUNT_NOT_FOUND');
  return account;
}

export async function updateMobileIdentity(id:string,input:z.infer<typeof mobileIdentitySchema>,actorId:string) {
  return database().begin(async tx=>{
    const account=await lockMobileAccount(tx,id);
    if(account.deleted_at)throw new Error('MOBILE_ACCOUNT_NOT_FOUND');
    if(account.email!==input.expectedEmail)throw new Error('ACCOUNT_CHANGED_REFRESH');
    const emailChanged=normalizeEmail(String(account.email??''))!==input.email;
    const phoneChanged=account.phone!==input.phone;
    const [active]=await tx`select 1 from trips where (driver_id=${id} or passenger_id=${id})
      and status not in ('COMPLETED','CANCELLED','NO_DRIVER') limit 1`;
    if(active)throw new Error('ACCOUNT_HAS_ACTIVE_TRIP');
    const aliases=legacyPhoneAliases(input.phone!);
    const [duplicate]=await tx`select
      exists(select 1 from users where id<>${id} and deleted_at is null and lower(email)=lower(${input.email})) as email,
      exists(select 1 from users where id<>${id} and deleted_at is null and phone_e164 in ${tx(aliases)}) as phone`;
    if(duplicate?.email)throw new Error('EMAIL_ALREADY_EXISTS');
    if(duplicate?.phone)throw new Error('PHONE_ALREADY_EXISTS');
    // Never approve drivers, reactivate suspended accounts or mark a new email
    // verified from the administrative form.
    await tx`update users set full_name=${input.name},email=${input.email},phone_e164=${input.phone},
      email_verified_at=case when ${emailChanged} then null else email_verified_at end,
      phone_verified_at=case when ${phoneChanged} then null else phone_verified_at end,
      updated_at=now() where id=${id}`;
    if(emailChanged||phoneChanged)await revokeMobileAccess(tx,id);
    await tx`insert into audit_log(actor_id,action,entity_type,entity_id,previous_value,next_value,reason)
      values(${actorId},'MOBILE_ACCOUNT_IDENTITY_UPDATED','USER',${id},
        ${JSON.stringify({name:account.name,email:account.email,phone:account.phone})}::jsonb,
        ${JSON.stringify({name:input.name,email:input.email,phone:input.phone,emailVerificationRequired:emailChanged||!account.email_verified_at})}::jsonb,${input.reason})`;
    return {updated:true,emailVerificationRequired:emailChanged||!account.email_verified_at,sessionRevoked:emailChanged||phoneChanged};
  });
}

export async function deleteIncompleteDriver(id:string,input:z.infer<typeof incompleteAccountDeletionSchema>,actorId:string) {
  return database().begin(async tx=>{
    const account=await lockMobileAccount(tx,id);
    if(account.deleted_at)return {deleted:true,replay:true};
    if(account.email!==input.expectedEmail)throw new Error('ACCOUNT_CHANGED_REFRESH');
    const [driver]=await tx`select approval_status,approved_at from drivers where user_id=${id} for update`;
    if(!driver||driver.approved_at||!['PENDIENTE_DOCUMENTOS','PENDIENTE_REVISION','OBSERVADO','RECHAZADO'].includes(String(driver.approval_status))) {
      throw new Error('ACCOUNT_NOT_INCOMPLETE');
    }
    const [history]=await tx`select
      exists(select 1 from trips where driver_id=${id} or passenger_id=${id}) as trips,
      exists(select 1 from driver_memberships where driver_id=${id}) as memberships,
      exists(select 1 from membership_payment_orders where driver_id=${id}) as payments`;
    if(history?.trips||history?.memberships||history?.payments)throw new Error('ACCOUNT_HAS_OPERATIONAL_HISTORY');
    await anonymizeMobileIdentity(tx,id);
    await tx`delete from user_service_area_access where user_id=${id}`;
    await tx`insert into audit_log(actor_id,action,entity_type,entity_id,previous_value,next_value,reason)
      values(${actorId},'INCOMPLETE_DRIVER_ACCOUNT_DELETED','USER',${id},
        ${JSON.stringify({name:account.name,email:account.email,phone:account.phone,approvalStatus:driver.approval_status})}::jsonb,
        '{"deleted":true,"historyPreserved":true}'::jsonb,${input.reason})`;
    return {deleted:true,replay:false};
  });
}
