import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { persistAudit, requirePermission } from "./admin.js";
import { database } from "./database.js";

function failure(error: unknown, reply: FastifyReply) {
  if (error instanceof z.ZodError) return reply.code(400).send({ error: "INVALID_COLLECTION_DATA", details: error.flatten() });
  const code = error instanceof Error ? error.message : "COLLECTION_OPERATION_FAILED";
  const status = code === "FORBIDDEN" ? 403 : code.endsWith("_NOT_FOUND") ? 404 : code.includes("NOT_SETTLEABLE") ? 409 : 400;
  return reply.code(status).send({ error: code });
}

const pointSchema = z.object({
  name: z.string().trim().min(2).max(120), address: z.string().trim().max(300).nullable().optional(),
  reference: z.string().trim().max(300).nullable().optional(), phone: z.string().trim().max(40).nullable().optional(),
  whatsapp: z.string().trim().max(40).nullable().optional(), email: z.string().email().max(200).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(), longitude: z.number().min(-180).max(180).nullable().optional(),
  displayOrder: z.number().int().min(-10000).max(10000).default(0), timezone: z.string().trim().min(3).max(80).default("America/Guayaquil"),
  schedules: z.array(z.object({ dayOfWeek:z.number().int().min(0).max(6), opensAt:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(), closesAt:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(), closed:z.boolean().default(false) }).superRefine((value,context)=>{ if(!value.closed&&(!value.opensAt||!value.closesAt||value.opensAt===value.closesAt))context.addIssue({code:"custom",message:"INVALID_SCHEDULE"}); })).max(7).default([]),
  serviceAreaId: z.string().uuid().nullable().optional(), status: z.enum(["ACTIVE", "SUSPENDED", "INACTIVE"]),
  cashEnabled: z.boolean(), deunaEnabled: z.boolean(), bankTransferEnabled: z.boolean(),
  settlementDeadlineHours: z.number().int().min(1).max(720), pendingLimit: z.number().min(0).nullable().optional()
});

const paymentAccountSchema = z.object({
  bankName: z.string().trim().min(2).max(120),
  accountType: z.string().trim().min(2).max(80),
  accountIdentifier: z.string().trim().min(4).max(60),
  holderName: z.string().trim().min(2).max(160),
  holderIdentification: z.string().trim().max(40).nullable().optional(),
  supportEmail: z.string().trim().email().max(200).nullable().optional(),
  enabled: z.boolean().default(true)
});

export async function registerCollectionAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/admin/membership-payment-account", async (request, reply) => {
    try {
      requirePermission(request, "settings:view");
      const [account] = await database()`select id::text,bank_name as "bankName",account_type_name as "accountType",account_identifier_public as "accountIdentifier",account_last_four as "accountLastFour",holder_name as "holderName",holder_identification_public as "holderIdentification",support_email as "supportEmail",enabled,updated_at as "updatedAt" from costa_go_payment_accounts where account_type='BANK_ACCOUNT' order by updated_at desc limit 1`;
      return { account: account ?? null };
    } catch (error) { return failure(error, reply); }
  });

  app.put("/v1/admin/membership-payment-account", async (request, reply) => {
    try {
      const actor = requirePermission(request, "settings:manage");
      const body = paymentAccountSchema.parse(request.body);
      const lastFour = body.accountIdentifier.replace(/\s+/g, "").slice(-4);
      const account = await database().begin(async tx => {
        const [current] = await tx`select id::text from costa_go_payment_accounts where account_type='BANK_ACCOUNT' order by updated_at desc limit 1 for update`;
        if (current) {
          const [updated] = await tx`update costa_go_payment_accounts set bank_name=${body.bankName},account_type_name=${body.accountType},account_identifier_public=${body.accountIdentifier},account_last_four=${lastFour},holder_name=${body.holderName},holder_identification_public=${body.holderIdentification??null},support_email=${body.supportEmail??null},enabled=${body.enabled},remote_payments_enabled=${body.enabled},updated_at=now() where id=${current.id} returning id::text,bank_name as "bankName",account_type_name as "accountType",account_identifier_public as "accountIdentifier",holder_name as "holderName",enabled`;
          return updated;
        }
        const [created] = await tx`insert into costa_go_payment_accounts(account_type,bank_name,account_type_name,account_identifier_public,account_last_four,holder_name,holder_identification_public,support_email,enabled,remote_payments_enabled,created_by) values('BANK_ACCOUNT',${body.bankName},${body.accountType},${body.accountIdentifier},${lastFour},${body.holderName},${body.holderIdentification??null},${body.supportEmail??null},${body.enabled},${body.enabled},${actor.id!}) returning id::text,bank_name as "bankName",account_type_name as "accountType",account_identifier_public as "accountIdentifier",holder_name as "holderName",enabled`;
        return created;
      });
      if (!account) throw new Error("PAYMENT_ACCOUNT_NOT_SAVED");
      await persistAudit(actor, "MEMBERSHIP_PAYMENT_ACCOUNT_UPDATED", "PAYMENT_ACCOUNT", String(account.id), `${body.bankName}: ****${lastFour}`);
      return { account };
    } catch (error) { return failure(error, reply); }
  });

  app.get("/v1/admin/collection-points", async (request, reply) => {
    try {
      requirePermission(request, "collection_points:manage");
      const points = await database()`select cp.id::text,cp.code,cp.name,cp.address,cp.reference,cp.phone,cp.whatsapp,cp.email,cp.latitude::float8,cp.longitude::float8,cp.display_order as "displayOrder",cp.timezone,cp.service_area_id::text as "serviceAreaId",sa.name as "serviceArea",cp.status,cp.cash_enabled as "cashEnabled",cp.deuna_enabled as "deunaEnabled",cp.bank_transfer_enabled as "bankTransferEnabled",cp.settlement_deadline_hours as "settlementDeadlineHours",cp.pending_limit::float8 as "pendingLimit",cp.created_at as "createdAt",cp.updated_at as "updatedAt",coalesce((select jsonb_agg(jsonb_build_object('dayOfWeek',s.day_of_week,'opensAt',to_char(s.opens_at,'HH24:MI'),'closesAt',to_char(s.closes_at,'HH24:MI'),'closed',s.closed) order by s.day_of_week) from collection_point_schedules s where s.collection_point_id=cp.id),'[]'::jsonb) as schedules,coalesce(jsonb_agg(jsonb_build_object('id',u.id::text,'name',u.full_name,'email',u.email)) filter(where u.id is not null and ca.ends_at is null),'[]'::jsonb) as collectors from collection_points cp left join service_areas sa on sa.id=cp.service_area_id left join collector_assignments ca on ca.collection_point_id=cp.id left join users u on u.id=ca.collector_id group by cp.id,sa.name order by cp.display_order,cp.name`;
      const collectors = await database()`select id::text,full_name as name,email,status from users where role='COLLECTOR' and deleted_at is null order by full_name`;
      return { points, collectors };
    } catch (error) { return failure(error, reply); }
  });

  app.post("/v1/admin/collection-points", async (request, reply) => {
    try {
      const actor = requirePermission(request, "collection_points:manage");
      const body = pointSchema.extend({ code: z.string().trim().min(2).max(40).regex(/^[A-Z0-9_-]+$/) }).parse(request.body);
      const point = await database().begin(async tx=>{const [created]=await tx`insert into collection_points(code,name,address,reference,phone,whatsapp,email,latitude,longitude,display_order,timezone,service_area_id,status,cash_enabled,deuna_enabled,bank_transfer_enabled,settlement_deadline_hours,pending_limit,created_by,updated_by) values(${body.code},${body.name},${body.address??null},${body.reference??null},${body.phone??null},${body.whatsapp??null},${body.email??null},${body.latitude??null},${body.longitude??null},${body.displayOrder},${body.timezone},${body.serviceAreaId??null},${body.status},${body.cashEnabled},${body.deunaEnabled},${body.bankTransferEnabled},${body.settlementDeadlineHours},${body.pendingLimit??null},${actor.id!},${actor.id!}) returning id::text,code,name,status`;if(!created)throw new Error("COLLECTION_POINT_NOT_CREATED");for(const schedule of body.schedules)await tx`insert into collection_point_schedules(collection_point_id,day_of_week,opens_at,closes_at,closed) values(${created.id},${schedule.dayOfWeek},${schedule.opensAt??null},${schedule.closesAt??null},${schedule.closed})`;return created;});
      if (!point) throw new Error("COLLECTION_POINT_NOT_CREATED");
      await persistAudit(actor, "COLLECTION_POINT_CREATED", "COLLECTION_POINT", String(point.id), body.name);
      return reply.code(201).send(point);
    } catch (error) { return failure(error, reply); }
  });

  app.patch("/v1/admin/collection-points/:pointId", async (request, reply) => {
    try {
      const actor = requirePermission(request, "collection_points:manage");
      const pointId = (request.params as { pointId: string }).pointId;
      const body = pointSchema.parse(request.body);
      const point = await database().begin(async tx=>{const [updated]=await tx`update collection_points set name=${body.name},address=${body.address??null},reference=${body.reference??null},phone=${body.phone??null},whatsapp=${body.whatsapp??null},email=${body.email??null},latitude=${body.latitude??null},longitude=${body.longitude??null},display_order=${body.displayOrder},timezone=${body.timezone},service_area_id=${body.serviceAreaId??null},status=${body.status},cash_enabled=${body.cashEnabled},deuna_enabled=${body.deunaEnabled},bank_transfer_enabled=${body.bankTransferEnabled},settlement_deadline_hours=${body.settlementDeadlineHours},pending_limit=${body.pendingLimit??null},updated_by=${actor.id!},updated_at=now() where id=${pointId} returning id::text,code,name,status`;if(!updated)return undefined;await tx`delete from collection_point_schedules where collection_point_id=${pointId}`;for(const schedule of body.schedules)await tx`insert into collection_point_schedules(collection_point_id,day_of_week,opens_at,closes_at,closed) values(${pointId},${schedule.dayOfWeek},${schedule.opensAt??null},${schedule.closesAt??null},${schedule.closed})`;return updated;});
      if (!point) throw new Error("COLLECTION_POINT_NOT_FOUND");
      await persistAudit(actor, "COLLECTION_POINT_UPDATED", "COLLECTION_POINT", pointId, `${body.name}: ${body.status}`);
      return point;
    } catch (error) { return failure(error, reply); }
  });

  app.post("/v1/admin/collection-points/:pointId/collectors", async (request, reply) => {
    try {
      const actor = requirePermission(request, "collection_points:manage");
      const pointId = (request.params as { pointId: string }).pointId;
      const { collectorId } = z.object({ collectorId: z.string().uuid() }).parse(request.body);
      const [collector] = await database()`select id::text from users where id=${collectorId} and role='COLLECTOR' and status='ACTIVE' and deleted_at is null`;
      if (!collector) throw new Error("COLLECTOR_NOT_AVAILABLE");
      await database().begin(async (tx) => {
        await tx`update collector_assignments set ends_at=now() where collector_id=${collectorId} and collection_point_id=${pointId} and ends_at is null`;
        await tx`insert into collector_assignments(collector_id,collection_point_id,created_by) values(${collectorId},${pointId},${actor.id!})`;
      });
      await persistAudit(actor, "COLLECTOR_ASSIGNED", "COLLECTION_POINT", pointId, collectorId);
      return reply.code(201).send({ ok: true });
    } catch (error) { return failure(error, reply); }
  });

  app.delete("/v1/admin/collection-points/:pointId/collectors/:collectorId", async (request, reply) => {
    try {
      const actor = requirePermission(request, "collection_points:manage");
      const { pointId, collectorId } = request.params as { pointId: string; collectorId: string };
      const changed = await database()`update collector_assignments set ends_at=now() where collector_id=${collectorId} and collection_point_id=${pointId} and ends_at is null returning collector_id`;
      if (!changed.length) throw new Error("COLLECTOR_ASSIGNMENT_NOT_FOUND");
      await persistAudit(actor, "COLLECTOR_UNASSIGNED", "COLLECTION_POINT", pointId, collectorId);
      return { ok: true };
    } catch (error) { return failure(error, reply); }
  });

  app.post("/v1/admin/collection-closures/:closureId/settle", async (request, reply) => {
    try {
      const actor = requirePermission(request, "settlements:review");
      const closureId = (request.params as { closureId: string }).closureId;
      const body = z.object({ method:z.string().trim().min(2).max(40), reference:z.string().trim().min(3).max(120), notes:z.string().trim().max(500).optional(), idempotencyKey:z.string().min(8).max(120) }).parse(request.body);
      const referenceHash = createHash("sha256").update(body.reference.trim().toUpperCase()).digest("hex");
      const referenceMasked = `****${body.reference.trim().slice(-4)}`;
      const settlement = await database().begin(async (tx) => {
        const [closure] = await tx`select * from collection_point_closures where id=${closureId} and status='PENDING_SETTLEMENT' for update`;
        if (!closure) throw new Error("CLOSURE_NOT_SETTLEABLE");
        const [item] = await tx`insert into collection_point_settlements(closure_id,collection_point_id,gross_amount,commission_amount,net_amount,method,reference_normalized_hash,reference_masked,status,submitted_at,verified_at,verified_by,notes,idempotency_key) values(${closureId},${closure.collection_point_id},${closure.gross_amount},${closure.commission_amount},${closure.net_amount},${body.method},${referenceHash},${referenceMasked},'VERIFIED',now(),now(),${actor.id!},${body.notes??null},${body.idempotencyKey}) returning id::text,status,net_amount::float8 as "netAmount"`;
        await tx`update collection_point_closures set status='SETTLED',settled_at=now(),verified_by=${actor.id!} where id=${closureId}`;
        await tx`update membership_payments p set settlement_status='SETTLED' from collection_point_closure_payments link where link.closure_id=${closureId} and link.payment_id=p.id`;
        return item;
      });
      if (!settlement) throw new Error("SETTLEMENT_NOT_CREATED");
      await persistAudit(actor, "COLLECTION_CLOSURE_SETTLED", "COLLECTION_POINT_CLOSURE", closureId, referenceMasked);
      return settlement;
    } catch (error) { return failure(error, reply); }
  });

  app.patch("/v1/admin/membership-grace-policies/:policyId/status", async (request, reply) => {
    try {
      const actor = requirePermission(request, "membership_grace:manage");
      const policyId = (request.params as { policyId: string }).policyId;
      const { status } = z.object({ status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "FINISHED"]) }).parse(request.body);
      const [policy] = await database()`update membership_grace_policies set status=${status},approved_by=case when ${status}='ACTIVE' then ${actor.id!} else approved_by end,updated_at=now() where id=${policyId} and status<>'FINISHED' returning id::text,name,status`;
      if (!policy) throw new Error("GRACE_POLICY_NOT_FOUND");
      await persistAudit(actor, `MEMBERSHIP_GRACE_POLICY_${status}`, "MEMBERSHIP_GRACE_POLICY", policyId, String(policy.name));
      return policy;
    } catch (error) { return failure(error, reply); }
  });

  app.get("/v1/admin/membership-payments/:proofId/proof", async (request, reply) => {
    try {
      requirePermission(request, "payments:transfer_review");
      const proofId = (request.params as { proofId: string }).proofId;
      const [proof] = await database()`select file_mime as mime,file_data as data from membership_transfer_proofs where id=${proofId}`;
      if (!proof) throw new Error("PAYMENT_PROOF_NOT_FOUND");
      return reply.header("Content-Type", String(proof.mime))
        .header("Content-Disposition", `inline; filename=membership-proof-${proofId}.${proof.mime === "application/pdf" ? "pdf" : "img"}`)
        .header("Cache-Control", "private, no-store")
        .send(proof.data);
    } catch (error) { return failure(error, reply); }
  });
}
