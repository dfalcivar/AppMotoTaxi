import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { database as rawDatabase } from "./database.js";
import { imageDimensions, persistAudit, requirePermission, type SessionUser } from "./admin.js";
import { renderCostaGoEmail, sendTransactionalEmail } from "./email.js";
import { composeAdvertisingActionValue, normalizeAdvertisingActionMessage, normalizeAdvertisingActionValue } from "./advertising-actions.js";
import { requireOrderFiscalProfile } from './fiscal/clients.js';
import { taxBreakdown } from './taxes.js';

// El cliente postgres infiere las filas en tiempo de ejecución; este módulo
// concentra consultas comerciales heterogéneas y valida sus bordes con Zod.
type LooseSql = {
  (strings: TemplateStringsArray, ...values: any[]): Promise<any[]>;
  begin<T>(callback: (transaction: any) => Promise<T>): Promise<T>;
  unsafe(query: string, parameters?: any[]): Promise<any[]>;
};
const database = rawDatabase as unknown as () => LooseSql;

const sourceSchema = z.enum(["INSTAGRAM", "FACEBOOK", "WHATSAPP", "WEB", "COMMERCIAL", "ADMIN", "OTHER"]);
const currentPlacementSchema = z.enum(["PASSENGER_SEARCHING_DRIVER", "PASSENGER_WAITING_DRIVER", "PASSENGER_TRIP_IN_PROGRESS"]);
const leadStatusSchema = z.enum(["NEW", "IN_PROGRESS", "QUALIFIED", "REQUIRES_CONTACT", "CONVERTED", "LOST"]);
const campaignStatusSchema = z.enum(["DRAFT", "PENDING_PAYMENT", "PAYMENT_REVIEW", "PENDING_REVIEW", "APPROVED", "SCHEDULED", "ACTIVE", "PAUSED", "REJECTED", "EXPIRED", "CANCELLED"]);
const leadSchema = z.object({
  businessName: z.string().trim().min(2).max(160),
  contactName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(30),
  email: z.string().email().max(200),
  city: z.string().trim().min(2).max(120),
  businessType: z.string().trim().min(2).max(80),
  interest: z.string().trim().min(2).max(300),
  source: sourceSchema.default("WEB"),
  requiresContact: z.boolean().default(false),
  submissionKey: z.string().uuid().optional(),
  conversationState: z.record(z.string(), z.unknown()).default({})
});
const draftSchema = z.object({
  step: z.number().int().min(1).max(20).optional(),
  business: z.record(z.string(), z.unknown()).optional(),
  campaign: z.record(z.string(), z.unknown()).optional(),
  planId: z.string().uuid().optional(),
  confirmedPlanId: z.string().uuid().optional(),
  paymentMethodId: z.string().uuid().optional(),
  submissionKey: z.string().uuid().optional(),
  notes: z.string().trim().max(2000).optional()
}).strict();
const submitSchema = z.object({
  submissionKey: z.string().uuid().optional(),
  business: z.object({
    businessName: z.string().trim().min(2).max(160),
    contactName: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(8).max(30),
    email: z.string().email(), city: z.string().trim().min(2).max(120),
    businessType: z.string().trim().min(2).max(80)
  }),
  campaign: z.object({
    title: z.string().trim().min(3).max(120),
    placement: currentPlacementSchema.optional(),
    serviceAreaId: z.string().uuid().nullable().optional(),
    actionType: z.enum(["WEB", "PHONE", "WHATSAPP", "MAPS", "NONE"]).default("NONE"),
    actionValue: z.string().trim().max(500).optional().default(""),
    actionMessage: z.string().trim().max(300).optional().default(""),
    startsAt: z.string().datetime({ offset: true }),
    imageBase64: z.string().min(100),
    imageMime: z.enum(["image/jpeg", "image/png", "image/webp"])
  }),
  planId: z.string().uuid(), paymentMethodId: z.string().uuid(),
  proof: z.object({
    fileBase64: z.string().min(100).max(7_500_000),
    fileMime: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
    reference: z.string().trim().max(160).optional().default("")
  }).optional()
});
const chatSubmitSchema = z.object({
  submissionKey: z.string().uuid(),
  source: sourceSchema.default("WEB"),
  lead: leadSchema.omit({ submissionKey: true, conversationState: true, requiresContact: true, source: true }),
  campaign: submitSchema.shape.campaign.omit({ serviceAreaId: true }).extend({
    imageMime: z.enum(["image/jpeg", "image/png"])
  }),
  planId: z.string().uuid(),
  paymentMethodId: z.string().uuid()
});
const paymentProofUploadSchema = z.object({
  proof: z.object({
    fileBase64: z.string().min(100).max(7_500_000),
    fileMime: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
    reference: z.string().trim().min(3).max(160)
  })
});
const correctionSubmitSchema = z.object({ campaign: z.object({ imageBase64: z.string().min(100), imageMime: z.enum(["image/jpeg", "image/png", "image/webp"]) }) });
const listSchema = z.object({
  insight: z.enum(["open","review","monthSales"]).optional(),
  status: z.string().trim().max(50).optional(), source: sourceSchema.optional(),
  scope: z.enum(["ACTIVE", "HISTORY", "ALL"]).optional(),
  search: z.string().trim().max(120).optional(), limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});
const inviteSchema = z.object({ leadId: z.string().uuid(), purpose: z.enum(["APPLICATION", "CORRECTION"]).default("APPLICATION"), correctionFields: z.array(z.string().max(80)).max(20).default([]), campaignId: z.string().uuid().optional() }).refine(value=>value.purpose!=="CORRECTION"||Boolean(value.campaignId),{message:"CAMPAIGN_REQUIRED",path:["campaignId"]});
const leadUpdateSchema = z.object({ status: leadStatusSchema.optional(), assignedCommercialId: z.string().uuid().nullable().optional(), note: z.string().trim().max(1000).optional() });
const paymentReviewSchema = z.object({ decision: z.enum(["APPROVE", "REJECT", "REFUND"]), reason: z.string().trim().max(1000).optional().default("") });
const commercialPaymentSchema = z.object({
  method: z.enum(["CASH", "BANK_TRANSFER"]),
  amount: z.number().positive().max(100_000),
  reference: z.string().trim().max(160).optional().default(""),
  proof: z.object({
    fileBase64: z.string().min(100).max(7_500_000),
    fileMime: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"])
  }).optional(),
  idempotencyKey: z.string().uuid()
}).superRefine((value, context) => {
  if (value.method === "BANK_TRANSFER" && value.reference.length < 3) context.addIssue({ code: "custom", path: ["reference"], message: "REFERENCE_REQUIRED" });
  if (value.method === "BANK_TRANSFER" && !value.proof) context.addIssue({ code: "custom", path: ["proof"], message: "PROOF_REQUIRED" });
});
const cashClosureSchema = z.object({ businessDate: z.string().date(), notes: z.string().trim().max(500).optional().default("") });
const closureReviewSchema = z.object({ decision: z.enum(["RECONCILE", "REJECT"]), reference: z.string().trim().max(160).optional().default(""), note: z.string().trim().max(500).optional().default("") })
  .superRefine((value, context) => {
    if (value.decision === "RECONCILE" && value.reference.length < 3) context.addIssue({ code: "custom", path: ["reference"], message: "REFERENCE_REQUIRED" });
    if (value.decision === "REJECT" && value.note.length < 5) context.addIssue({ code: "custom", path: ["note"], message: "REJECTION_REASON_REQUIRED" });
  });
const campaignActionSchema = z.object({ action: z.enum(["APPROVE", "REJECT", "REQUEST_CORRECTION", "PAUSE", "RESUME", "CANCEL"]), note: z.string().trim().max(1000).optional().default("") });
const campaignRenewalSchema = z.object({ planId: z.string().uuid(), note: z.string().trim().max(500).optional().default("") });
const campaignActionConfigSchema = z.object({
  actionType: z.enum(["WEB", "PHONE", "WHATSAPP", "MAPS", "NONE"]),
  actionValue: z.string().trim().max(500).optional().default(""),
  actionMessage: z.string().trim().max(300).optional().default("")
});
const publicCampaignQuerySchema = z.object({
  placement: currentPlacementSchema,
  serviceAreaId: z.string().uuid().optional()
});
const publicEventSchema = z.object({
  eventType: z.enum(["IMPRESSION", "CLICK"]), campaignId: z.string().uuid(),
  exhibitionId: z.string().trim().min(8).max(100), sessionKey: z.string().trim().min(8).max(200),
  placement: z.string().trim().min(3).max(80), serviceAreaId: z.string().uuid().optional(),
  actionType: z.string().trim().max(30).optional(), platform: z.enum(["WEB", "MOBILE"]).default("WEB")
});
const planSchema = z.object({
  code: z.string().trim().min(2).max(40).regex(/^[A-Z0-9_]+$/), name: z.string().trim().min(2).max(120),
  category: z.enum(["BASIC", "PREMIUM"]).optional(),
  description: z.string().trim().max(1000).default(""), placement: z.string().trim().min(3).max(80),
  durationDays: z.number().int().min(1).max(365), price: z.number().min(0).max(100000), currency: z.string().length(3).default("USD"),
  defaultWeight: z.number().int().min(1).max(10).default(1), allowedPlacements: z.array(z.string().min(3).max(80)).min(1).max(10),
  active: z.boolean().default(false), sortOrder: z.number().int().min(0).max(9999).default(0)
});
const commercialSettingsSchema=z.object({
  invitationDays:z.number().int().min(1).max(30),maxImageBytes:z.number().int().min(100_000).max(5_000_000),
  bannerWidth:z.number().int().min(320).max(4000),bannerHeight:z.number().int().min(100).max(2000),
  maxActivePerZone:z.number().int().min(1).max(100),commercialEmails:z.array(z.string().email()).max(20)
});
const paymentMethodSchema=z.object({name:z.string().trim().min(2).max(120),instructions:z.string().trim().max(1000),active:z.boolean(),requiresProof:z.boolean(),sortOrder:z.number().int().min(0).max(9999)});

const leadRate = new Map<string, { count: number; expires: number }>();
function allowLead(request: FastifyRequest): boolean {
  const key = request.ip || "unknown", now = Date.now(), current = leadRate.get(key);
  if (!current || current.expires <= now) { leadRate.set(key, { count: 1, expires: now + 3_600_000 }); return true; }
  current.count += 1; return current.count <= 10;
}
function tokenHash(token: string): string {
  const pepper = process.env.ADMIN_SESSION_SECRET ?? "costa-go-local-development";
  return createHash("sha256").update(`${pepper}:advertising:${token}`).digest("hex");
}
function paymentUploadToken(submissionKey: string): string {
  const pepper = process.env.ADMIN_SESSION_SECRET ?? "costa-go-local-development";
  return createHash("sha256").update(`${pepper}:advertising-payment:${submissionKey}`).digest("base64url");
}
function paymentUploadTokenHash(token: string): string {
  const pepper = process.env.ADMIN_SESSION_SECRET ?? "costa-go-local-development";
  return createHash("sha256").update(`${pepper}:advertising-payment-upload:${token}`).digest("hex");
}
function publicBase(): string { return (process.env.PUBLIC_WEB_BASE_URL ?? "https://costa-go.com").replace(/\/$/, ""); }
function cleanSource(value: unknown): z.infer<typeof sourceSchema> {
  const candidate = String(value ?? "WEB").trim().toUpperCase();
  return sourceSchema.safeParse(candidate).success ? candidate as z.infer<typeof sourceSchema> : "OTHER";
}
export function normalizeAdvertisingPlacement(value: unknown): z.infer<typeof currentPlacementSchema> {
  if (value === "PASSENGER_WAITING_DRIVER" || value === "PASSENGER_TRIP_IN_PROGRESS") return value;
  return "PASSENGER_SEARCHING_DRIVER";
}
export type AdvertisingCategory = "BASIC" | "PREMIUM";
export const BASIC_ADVERTISING_PLACEMENTS = ["PASSENGER_SEARCHING_DRIVER"] as const;
export const PREMIUM_ADVERTISING_PLACEMENTS = [
  "PASSENGER_SEARCHING_DRIVER",
  "PASSENGER_WAITING_DRIVER",
  "PASSENGER_TRIP_IN_PROGRESS"
] as const;
export function advertisingCategoryFromPlacements(values: unknown): AdvertisingCategory {
  const placements = Array.isArray(values) ? values.map(String) : [];
  return placements.includes("PASSENGER_WAITING_DRIVER") || placements.includes("PASSENGER_TRIP_IN_PROGRESS") ? "PREMIUM" : "BASIC";
}
export function advertisingPlacementsForCategory(category: unknown): string[] {
  return category === "PREMIUM" ? [...PREMIUM_ADVERTISING_PLACEMENTS] : [...BASIC_ADVERTISING_PLACEMENTS];
}
export function commercialCampaignReviewBlock(campaign:{order_id?:unknown;order_status?:unknown;payment_verified?:unknown}):"COMMERCIAL_ORDER_REQUIRED"|"PAYMENT_NOT_RECONCILED"|null{
  if(!campaign.order_id)return "COMMERCIAL_ORDER_REQUIRED";
  if(campaign.order_status!=="PAID"||campaign.payment_verified!==true)return "PAYMENT_NOT_RECONCILED";
  return null;
}
export function advertisingRenewalWindow(sourceEndsAt: unknown, durationDays: number, now = new Date()): { startsAt: Date; endsAt: Date } {
  const candidate = new Date(String(sourceEndsAt ?? ""));
  const startsAt = Number.isFinite(candidate.getTime()) && candidate > now ? candidate : now;
  return { startsAt, endsAt: new Date(startsAt.getTime() + Math.max(1, Math.trunc(durationDays)) * 86_400_000) };
}
function publicError(error: unknown, reply: FastifyReply) {
  if(error instanceof Error&&error.message==='FISCAL_PROFILE_REQUIRED')return reply.code(400).send({error:error.message,message:'Registra los datos de facturación antes de enviar el comprobante.'});
  if (error instanceof z.ZodError) return reply.code(400).send({ error: "INVALID_DATA", details: error.flatten() });
  const message = error instanceof Error ? error.message : "ERROR";
  const status = ["INVALID_WHATSAPP_NUMBER","WHATSAPP_NUMBER_REQUIRED"].includes(message) ? 400 : ["INVITATION_NOT_FOUND","PAYMENT_UPLOAD_NOT_FOUND"].includes(message) ? 404 : ["INVITATION_EXPIRED","PAYMENT_UPLOAD_EXPIRED"].includes(message) ? 410 : ["INVITATION_LOCKED","PAYMENT_UPLOAD_LOCKED"].includes(message) ? 409 : 500;
  if (status < 500) return reply.code(status).send({ error: message });
  reply.log.error({ err: error }, "No se pudo completar la solicitud comercial");
  return reply.code(500).send({
    error: "COMMERCIAL_SUBMISSION_FAILED",
    message: "No pudimos guardar la solicitud comercial. Tus datos siguen en pantalla; intenta enviarla nuevamente en unos minutos."
  });
}
function adminError(error: unknown, reply: FastifyReply) {
  if(error instanceof Error&&error.message==='FISCAL_PROFILE_REQUIRED')return reply.code(400).send({error:error.message,message:'Registra los datos de facturación antes de confirmar el cobro.'});
  if (error instanceof z.ZodError) return reply.code(400).send({ error: "INVALID_DATA", details: error.flatten() });
  const message = error instanceof Error ? error.message : "ERROR";
  if (message === "UNAUTHORIZED") return reply.code(401).send({ error: message });
  if (message === "FORBIDDEN") return reply.code(403).send({ error: message });
  if (["PAYMENT_ALREADY_REVIEWED","PAYMENT_NOT_REFUNDABLE","PAYMENT_REQUIRES_CASH_CLOSURE","PAYMENT_NOT_READY_FOR_RECONCILIATION","PAYMENT_ALREADY_RECEIVED","PAYMENT_AMOUNT_MISMATCH","PAYMENT_NOT_RECONCILED","PAYMENT_REMINDER_NOT_AVAILABLE","COMMERCIAL_ORDER_REQUIRED","AUTOMATIC_TRANSFER_FLOW","CASH_CLOSURE_ALREADY_EXISTS","CASH_CLOSURE_EMPTY","CASH_CLOSURE_ALREADY_REVIEWED","LEAD_CONVERSION_REQUIRES_PAID_ORDER","CONVERTED_LEAD_LOCKED","LEAD_NOT_ACTIONABLE","LEAD_ALREADY_HAS_ORDER","CAMPAIGN_NOT_RENEWABLE","CAMPAIGN_RENEWAL_ALREADY_EXISTS"].includes(message)) return reply.code(409).send({ error: message });
  if (message.endsWith("_NOT_FOUND")) return reply.code(404).send({ error: message });
  throw error;
}
async function publicAudit(action:string,entityType:string,entityId:string,detail:string){if(!process.env.DATABASE_URL)return;await database()`insert into audit_log(actor_id,action,entity_type,entity_id,next_value,reason) values (null,${action},${entityType},${entityId},${JSON.stringify({detail})}::jsonb,${detail})`;}
async function createInvitation(leadId: string, source: string, actorId?: string, purpose = "APPLICATION", correctionFields: string[] = [], campaignId?: string) {
  const token = randomBytes(32).toString("base64url");
  const [settings] = await database()`select advertising_invitation_days as days from operational_settings where id=1`;
  const days = Math.max(1, Math.min(30, Number(settings?.days ?? 7)));
  await database()`update advertising_invitations set status='REVOKED',revoked_at=now(),updated_at=now() where lead_id=${leadId} and status in ('CREATED','OPENED','IN_PROGRESS','CORRECTION')`;
  const [invitation] = await database()`insert into advertising_invitations(lead_id,advertiser_id,campaign_id,token_hash,status,source,purpose,correction_fields,created_by,expires_at)
    select lead.id,lead.advertiser_id,${campaignId??null},${tokenHash(token)},${purpose === "CORRECTION" ? "CORRECTION" : "CREATED"},${source},${purpose},${correctionFields},${actorId ?? null},now()+(${days}*interval '1 day')
    from advertising_leads lead where lead.id=${leadId} returning id::text,expires_at as "expiresAt"`;
  if (!invitation) throw new Error("LEAD_NOT_FOUND");
  await publicAudit("ADVERTISING_INVITATION_CREATED","ADVERTISING_INVITATION",String(invitation.id),purpose);
  return { id: String(invitation.id), expiresAt: invitation.expiresAt, token, url: `${publicBase()}/anunciarme/i/${token}` };
}
async function invitationFor(token: string, lock = false) {
  const rows = await database().unsafe(`select invitation.*,lead.code as lead_code,lead.business_name,lead.contact_name,lead.phone_e164,lead.email,lead.city,lead.business_type,lead.interest,lead.source as lead_source
    from advertising_invitations invitation join advertising_leads lead on lead.id=invitation.lead_id where invitation.token_hash=$1 ${lock ? "for update" : ""}`, [tokenHash(token)]);
  const invitation = rows[0];
  if (!invitation) throw new Error("INVITATION_NOT_FOUND");
  if (["REVOKED", "EXPIRED"].includes(String(invitation.status)) || new Date(String(invitation.expires_at)).getTime() <= Date.now()) {
    await database()`update advertising_invitations set status='EXPIRED',updated_at=now() where id=${invitation.id} and status<>'SUBMITTED'`;
    throw new Error("INVITATION_EXPIRED");
  }
  return invitation;
}

async function submittedApplicationFor(sql: LooseSql, invitation: any) {
  const [item] = await sql`select orders.code as "orderCode",banner.id::text as "campaignId",
      coalesce(payment.status,orders.status) as status
    from advertising_orders orders
    left join affiliate_banners banner on banner.order_id=orders.id
    left join advertising_payments payment on payment.order_id=orders.id
    where orders.invitation_id=${invitation.id}
       or (orders.invitation_id is null and orders.lead_id=${invitation.lead_id})
    order by orders.created_at desc limit 1`;
  return item ?? null;
}
function decodeBase64(value: string): Buffer { return Buffer.from(value.replace(/^data:[^;]+;base64,/, ""), "base64"); }
function validProof(data: Buffer, mime: string): boolean {
  if (data.length < 100 || data.length > 5_000_000) return false;
  if (mime === "application/pdf") return data.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mime === "image/jpeg") return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (mime === "image/png") return data.subarray(1, 4).toString() === "PNG";
  return mime === "image/webp" && data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP";
}
function emailHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}
function bankInstructions(method: any): string {
  const details = method?.account_details && typeof method.account_details === "object"
    ? Object.entries(method.account_details).filter(([, value]) => value !== null && value !== "").map(([key, value]) => `${key}: ${String(value)}`).join("\n")
    : "";
  return [String(method?.instructions ?? "").trim(), details].filter(Boolean).join("\n");
}
async function transitionCampaign(campaignId: string, to: string, actor?: SessionUser, note = "") {
  const [current] = await database()`select campaign_status from affiliate_banners where id=${campaignId}`;
  if (!current) throw new Error("CAMPAIGN_NOT_FOUND");
  await database()`update affiliate_banners set campaign_status=${to},active=${to === "ACTIVE"},rejection_reason=case when ${to}='REJECTED' then ${note || null} else rejection_reason end,correction_note=case when ${to}='PENDING_REVIEW' then ${note || null} else correction_note end,updated_at=now() where id=${campaignId}`;
  await database()`insert into campaign_status_history(campaign_id,from_status,to_status,note,changed_by) values (${campaignId},${current.campaign_status},${to},${note || null},${actor?.id ?? null})`;
  if (actor) await persistAudit(actor, "ADVERTISING_CAMPAIGN_STATUS_UPDATED", "AFFILIATE_BANNER", campaignId, `${current.campaign_status} → ${to}. ${note}`);
}

async function markAdvertisingOrdersPaid(tx: any, paymentIds: string[], actorId: string, note: string) {
  if (!paymentIds.length) return { campaigns: [] as string[], leads: [] as string[], recipients: [] as Array<{email:string;contactName:string;orderCode:string;contentReused:boolean}> };
  const payments = await tx`select pay.id::text,pay.order_id::text,o.lead_id::text,o.code,o.content_reused,a.email,a.contact_name
    from advertising_payments pay join advertising_orders o on o.id=pay.order_id join advertisers a on a.id=o.advertiser_id
    where pay.id=any(${paymentIds}::uuid[]) for update`;
  const orderIds = payments.map((item:any)=>String(item.order_id));
  await tx`update advertising_payments set status='APPROVED',settlement_status='RECONCILED',reviewed_by=${actorId},reviewed_at=now(),updated_at=now() where id=any(${paymentIds}::uuid[])`;
  await tx`update advertising_orders set status='PAID',updated_at=now() where id=any(${orderIds}::uuid[])`;
  await tx`update advertisers set status='ACTIVE',updated_at=now() where id in (select advertiser_id from advertising_orders where id=any(${orderIds}::uuid[]))`;
  const campaigns=await tx`
    with candidates as (
      select banner.id,banner.campaign_status as old_status,banner.starts_at,orders.content_reused
      from affiliate_banners banner join advertising_orders orders on orders.id=banner.order_id
      where banner.order_id=any(${orderIds}::uuid[])
    )
    update affiliate_banners banner set
      campaign_status=case when candidates.content_reused then case when candidates.starts_at>now() then 'SCHEDULED' else 'ACTIVE' end else 'PENDING_REVIEW' end,
      active=case when candidates.content_reused and candidates.starts_at<=now() then true else false end,
      review_requested_at=case when candidates.content_reused then banner.review_requested_at else now() end,
      updated_at=now()
    from candidates where banner.id=candidates.id
    returning banner.id::text,candidates.old_status,banner.campaign_status as new_status
  `;
  const leads=await tx`update advertising_leads set status='CONVERTED',updated_at=now() where id in (select lead_id from advertising_orders where id=any(${orderIds}::uuid[]) and lead_id is not null) and status<>'CONVERTED' returning id::text`;
  for(const campaign of campaigns)await tx`insert into campaign_status_history(campaign_id,from_status,to_status,note,changed_by) values (${campaign.id},${campaign.old_status},${campaign.new_status},${note},${actorId})`;
  return { campaigns:campaigns.map((item:any)=>String(item.id)), leads:leads.map((item:any)=>String(item.id)), recipients:payments.map((item:any)=>({email:String(item.email),contactName:String(item.contact_name),orderCode:String(item.code),contentReused:Boolean(item.content_reused)})) };
}

function sendAdvertisingPaymentConfirmed(recipients:Array<{email:string;contactName:string;orderCode:string;contentReused:boolean}>){
  for(const recipient of recipients){const detail=recipient.contentReused?"La renovación quedó programada automáticamente porque conserva la pieza aprobada.":"La campaña pasó a revisión de contenido; te notificaremos cualquier novedad.";void sendTransactionalEmail({to:recipient.email,subject:`Pago confirmado ${recipient.orderCode} · Costa-Go`,text:`Hola ${recipient.contactName}. Confirmamos el pago de la orden ${recipient.orderCode}. ${detail}`,html:`<p>Hola <strong>${recipient.contactName}</strong>.</p><p>Confirmamos el pago de la orden <strong>${recipient.orderCode}</strong>.</p><p>${detail}</p>`}).catch(()=>false)}
}

export async function advertisingSchedulerTick(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  await database()`with changed as (update affiliate_banners set campaign_status='ACTIVE',active=true,updated_at=now() where campaign_status='SCHEDULED' and starts_at<=now() and (ends_at is null or ends_at>now()) returning id) insert into campaign_status_history(campaign_id,from_status,to_status,note) select id,'SCHEDULED','ACTIVE','Activación automática' from changed`;
  await database()`with expired as (select id,campaign_status as old_status from affiliate_banners where campaign_status in ('ACTIVE','SCHEDULED') and ends_at is not null and ends_at<=now() for update),changed as (update affiliate_banners banner set campaign_status='EXPIRED',active=false,updated_at=now() from expired where banner.id=expired.id returning banner.id,expired.old_status) insert into campaign_status_history(campaign_id,from_status,to_status,note) select id,old_status,'EXPIRED','Finalización automática' from changed`;
  await database()`update advertising_invitations set status='EXPIRED',updated_at=now() where status in ('CREATED','OPENED','IN_PROGRESS','CORRECTION') and expires_at<=now()`;
}

export async function registerCommercialRoutes(app: FastifyInstance) {
  app.get("/v1/public/advertising/plans", async () => {
    const [plans,settings]=await Promise.all([
      database()`select id::text,code,name,description,placement,duration_days as "durationDays",price::float8,currency,default_weight as "defaultWeight",allowed_placements as "allowedPlacements",case when 'PASSENGER_WAITING_DRIVER'=any(allowed_placements) or 'PASSENGER_TRIP_IN_PROGRESS'=any(allowed_placements) then 'PREMIUM' else 'BASIC' end as category from advertising_plans where enabled=true and active=true order by sort_order,name`,
      database()`select vat_rate_percent::float8 as "vatRatePercent" from operational_settings where id=1`
    ]);
    const vatRatePercent=Number(settings[0]?.vatRatePercent??0);
    return plans.map(plan=>({...plan,...taxBreakdown(plan.price,vatRatePercent),pricesIncludeVat:false}));
  });
  app.get("/v1/public/advertising/payment-methods", async () => database()`select id::text,code,case when code='COMMERCIAL_MANAGED' then 'Gestionado por un asesor' else name end as name,instructions,account_details as "accountDetails",requires_proof as "requiresProof" from advertising_payment_methods where active=true and code in ('BANK_TRANSFER','COMMERCIAL_MANAGED') order by sort_order,name`);
  app.post("/v1/public/advertising/chat/submit", async (request, reply) => { try {
    const body = chatSubmitSchema.parse({ ...(request.body as object), source: cleanSource((request.body as any)?.source) });
    const [knownSubmission] = await database()`select 1 from advertising_leads where submission_key=${body.submissionKey}`;
    if (!knownSubmission && !allowLead(request)) return reply.code(429).send({ error: "TOO_MANY_REQUESTS" });
    const image = decodeBase64(body.campaign.imageBase64), dimensions = imageDimensions(image, body.campaign.imageMime);
    const [settings] = await database()`select advertising_max_image_bytes as bytes,advertising_banner_width as width,advertising_banner_height as height from operational_settings where id=1`;
    if (!dimensions || image.length > Number(settings?.bytes ?? 1_048_576) || dimensions.width !== Number(settings?.width ?? 1200) || dimensions.height !== Number(settings?.height ?? 400)) {
      return reply.code(400).send({ error: "INVALID_BANNER_IMAGE", message: `El banner debe medir ${settings?.width ?? 1200}×${settings?.height ?? 400} px, ser JPG o PNG y pesar máximo ${Math.round(Number(settings?.bytes ?? 1_048_576) / 1_048_576)} MB.` });
    }
    const uploadToken = paymentUploadToken(body.submissionKey);
    const result = await database().begin(async tx => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${body.submissionKey},0))`;
      const [existing] = await tx`select lead.id::text,lead.code,lead.conversation_status,orders.code as order_code,orders.status,methods.code as method_code,methods.instructions,methods.account_details,plans.name as plan_name,orders.subtotal_amount::float8,orders.vat_rate_percent::float8,orders.vat_amount::float8,orders.amount::float8,orders.currency
        from advertising_leads lead left join advertising_orders orders on orders.lead_id=lead.id left join advertising_payments payments on payments.order_id=orders.id left join advertising_payment_methods methods on methods.id=payments.payment_method_id left join advertising_plans plans on plans.id=orders.plan_id
        where lead.submission_key=${body.submissionKey} order by orders.created_at desc limit 1`;
      if (existing?.order_code) return { leadCode: existing.code, orderCode: existing.order_code, status: "FINALIZADO", paymentMethod: existing.method_code, planName: existing.plan_name, subtotalAmount: Number(existing.subtotal_amount), vatRatePercent: Number(existing.vat_rate_percent), vatAmount: Number(existing.vat_amount), amount: Number(existing.amount), currency: existing.currency, method: { instructions: existing.instructions, account_details: existing.account_details }, duplicate: true };
      const [plan] = await tx`select * from advertising_plans where id=${body.planId} and enabled=true and active=true for share`;
      if (!plan) throw new Error("PLAN_NOT_FOUND");
      const [method] = await tx`select * from advertising_payment_methods where id=${body.paymentMethodId} and active=true and code in ('BANK_TRANSFER','COMMERCIAL_MANAGED')`;
      if (!method) throw new Error("PAYMENT_METHOD_NOT_FOUND");
      const isTransfer = method.code === "BANK_TRANSFER";
      const [lead] = await tx`insert into advertising_leads(code,business_name,contact_name,phone_e164,email,city,business_type,interest,source,status,conversation_state,conversation_status,submission_key)
        values ('LEAD-'||extract(year from now())::int||'-'||lpad(nextval('advertising_lead_code_seq')::text,6,'0'),${body.lead.businessName},${body.lead.contactName},${body.lead.phone},lower(${body.lead.email}),${body.lead.city},${body.lead.businessType},${body.lead.interest},${body.source},${isTransfer ? "QUALIFIED" : "REQUIRES_CONTACT"},${JSON.stringify({ status: "FINALIZADO", paymentMethod: method.code })}::jsonb,'FINALIZADO',${body.submissionKey}) returning id::text,code`;
      if (!lead) throw new Error("LEAD_NOT_CREATED");
      const [advertiser] = await tx`insert into advertisers(business_name,contact_name,phone_e164,email,city,business_type,status)
        values (${body.lead.businessName},${body.lead.contactName},${body.lead.phone},lower(${body.lead.email}),${body.lead.city},${body.lead.businessType},'PROSPECT')
        on conflict(lower(email),lower(business_name)) do update set contact_name=excluded.contact_name,phone_e164=excluded.phone_e164,city=excluded.city,business_type=excluded.business_type,updated_at=now() returning id::text`;
      const [taxSettings]=await tx`select vat_rate_percent::float8 as "vatRatePercent" from operational_settings where id=1`;
      const tax=taxBreakdown(plan.price ?? plan.monthly_price ?? 0,taxSettings?.vatRatePercent??0),amount=tax.total,duration = Number(plan.duration_days ?? 30), start = new Date(body.campaign.startsAt), end = new Date(start.getTime() + duration * 86_400_000), placement = normalizeAdvertisingPlacement(plan.placement ?? plan.allowed_placements?.[0]), category = advertisingCategoryFromPlacements(plan.allowed_placements);
      const [order] = await tx`insert into advertising_orders(code,lead_id,advertiser_id,plan_id,status,subtotal_amount,vat_rate_percent,vat_amount,amount,currency,plan_snapshot,requested_start_at,requested_end_at)
        values ('PUB-'||extract(year from now())::int||'-'||lpad(nextval('advertising_request_code_seq')::text,6,'0'),${lead.id},${advertiser.id},${plan.id},'PENDING_PAYMENT',${tax.subtotal},${tax.vatRatePercent},${tax.vatAmount},${tax.total},${plan.currency},${JSON.stringify({ code: plan.code, name: plan.name, durationDays: duration, price: tax.subtotal, vatRatePercent: tax.vatRatePercent, vatAmount: tax.vatAmount, total: tax.total })}::jsonb,${start.toISOString()},${end.toISOString()}) returning id::text,code`;
      const [payment] = await tx`insert into advertising_payments(order_id,advertiser_id,amount,currency,payment_method_id,status,settlement_status)
        values (${order.id},${advertiser.id},${amount},${plan.currency},${method.id},'PENDING','NOT_RECEIVED') returning id::text`;
      const actionValue=normalizeAdvertisingActionValue(body.campaign.actionType,body.campaign.actionValue);
      const actionMessage=normalizeAdvertisingActionMessage(body.campaign.actionType,body.campaign.actionMessage);
      const [campaign] = await tx`insert into affiliate_banners(title,advertiser_id,advertiser_name,advertising_plan_id,category,placement,weight,action_type,action_value,action_message,image_mime,image_data,target_url,starts_at,ends_at,active,campaign_status,sort_order,order_id,submitted_at)
        values (${body.campaign.title},${advertiser.id},${body.lead.businessName},${plan.id},${category},${placement},${plan.default_weight},${body.campaign.actionType},${actionValue},${actionMessage},${body.campaign.imageMime},${image},${body.campaign.actionType === "WEB" ? actionValue : null},${start.toISOString()},${end.toISOString()},false,'PENDING_PAYMENT',${plan.sort_order ?? 0},${order.id},now()) returning id::text`;
      await tx`insert into campaign_status_history(campaign_id,to_status,note) values (${campaign.id},'PENDING_PAYMENT',${isTransfer ? "Esperando comprobante de transferencia" : "Pago gestionado por asesor"})`;
      await tx`update advertising_leads set advertiser_id=${advertiser.id},updated_at=now() where id=${lead.id}`;
      if (isTransfer) await tx`insert into advertising_payment_upload_tokens(order_id,payment_id,token_hash,status,expires_at) values (${order.id},${payment.id},${paymentUploadTokenHash(uploadToken)},'CREATED',now()+interval '7 days')`;
      return { leadCode: lead.code, orderCode: order.code, campaignId: campaign.id, status: "FINALIZADO", paymentMethod: method.code, planName: plan.name, subtotalAmount: tax.subtotal, vatRatePercent: tax.vatRatePercent, vatAmount: tax.vatAmount, amount, currency: plan.currency, email: body.lead.email, contactName: body.lead.contactName, businessName: body.lead.businessName, method, duplicate: false };
    });
    if (result.paymentMethod === "BANK_TRANSFER") {
      const uploadUrl = `${publicBase()}/anunciarme/comprobante/?token=${encodeURIComponent(uploadToken)}`;
      const instructions = bankInstructions(result.method);
      const mailSent = await sendTransactionalEmail({
        to: String(result.email ?? body.lead.email), subject: `Datos para tu transferencia ${result.orderCode} · Costa-Go`,
        text: `Hola ${result.contactName ?? body.lead.contactName}.\nCódigo de solicitud: ${result.leadCode}\nOrden: ${result.orderCode}\nPlan: ${result.planName}\nSubtotal: ${result.currency} ${Number(result.subtotalAmount).toFixed(2)}\nIVA (${result.vatRatePercent}%): ${result.currency} ${Number(result.vatAmount).toFixed(2)}\nTotal: ${result.currency} ${Number(result.amount).toFixed(2)}\n\n${instructions}\n\nCuando realices la transferencia, carga el comprobante en este enlace seguro único: ${uploadUrl}`,
        html: `<p>Hola <strong>${emailHtml(result.contactName ?? body.lead.contactName)}</strong>.</p><p>Estos son los datos de tu solicitud comercial:</p><ul><li>Código: <strong>${emailHtml(result.leadCode)}</strong></li><li>Orden: <strong>${emailHtml(result.orderCode)}</strong></li><li>Plan: <strong>${emailHtml(result.planName)}</strong></li><li>Subtotal: ${emailHtml(result.currency)} ${Number(result.subtotalAmount).toFixed(2)}</li><li>IVA (${result.vatRatePercent}%): ${emailHtml(result.currency)} ${Number(result.vatAmount).toFixed(2)}</li><li>Total: <strong>${emailHtml(result.currency)} ${Number(result.amount).toFixed(2)}</strong></li></ul><p style="white-space:pre-line">${emailHtml(instructions)}</p><p><a href="${emailHtml(uploadUrl)}">Cargar comprobante de transferencia</a></p><p>Este enlace es único y vence en 7 días.</p>`
      });
      if (mailSent) await database()`update advertising_payment_upload_tokens set email_sent_at=coalesce(email_sent_at,now()),updated_at=now() where token_hash=${paymentUploadTokenHash(uploadToken)}`;
      if (!mailSent) request.log.error({ leadCode: result.leadCode }, "No se pudo enviar el correo de transferencia comercial");
    }
    if (!result.duplicate && result.paymentMethod !== "BANK_TRANSFER") {
      const [notificationSettings]=await database()`select advertising_commercial_emails as emails from operational_settings where id=1`;
      for(const email of Array.isArray(notificationSettings?.emails)?notificationSettings.emails:[]){
        void sendTransactionalEmail({to:String(email),subject:`Nueva solicitud comercial ${result.leadCode} · Costa-Go`,text:`${body.lead.businessName} finalizó la solicitud ${result.leadCode}. Orden ${result.orderCode}. Método: ${result.paymentMethod}.`,html:`<p>Se registró la solicitud <strong>${emailHtml(result.leadCode)}</strong>.</p><p><strong>${emailHtml(body.lead.businessName)}</strong><br>Orden ${emailHtml(result.orderCode)}<br>Método: ${emailHtml(result.paymentMethod)}</p>`}).catch(()=>false);
      }
    }
    if (!result.duplicate) await publicAudit("ADVERTISING_CHAT_FINALIZED","ADVERTISING_LEAD",String(result.leadCode),String(result.paymentMethod));
    const response = { leadCode: result.leadCode, orderCode: result.orderCode, status: "FINALIZADO", paymentMethod: result.paymentMethod, duplicate: result.duplicate };
    return reply.code(result.duplicate ? 200 : 201).send(response);
  } catch (error) { return publicError(error, reply); } });

  app.get("/v1/public/advertising/payment-proof/:token", async (request, reply) => { try {
    const token = z.string().min(32).max(200).parse((request.params as any).token);
    const [item] = await database()`select upload.id::text,upload.status,upload.expires_at as "expiresAt",orders.code as "orderCode",orders.subtotal_amount::float8 as "subtotalAmount",orders.vat_rate_percent::float8 as "vatRatePercent",orders.vat_amount::float8 as "vatAmount",orders.amount::float8,orders.currency,plans.name as "planName",advertisers.business_name as "businessName"
      from advertising_payment_upload_tokens upload join advertising_orders orders on orders.id=upload.order_id join advertising_plans plans on plans.id=orders.plan_id join advertisers on advertisers.id=orders.advertiser_id where upload.token_hash=${paymentUploadTokenHash(token)}`;
    if (!item) throw new Error("PAYMENT_UPLOAD_NOT_FOUND");
    if (item.status === "SUBMITTED") return { ...item, received: true };
    if (["EXPIRED","REVOKED"].includes(String(item.status)) || new Date(String(item.expiresAt)).getTime() <= Date.now()) { await database()`update advertising_payment_upload_tokens set status='EXPIRED',updated_at=now() where id=${item.id}`; throw new Error("PAYMENT_UPLOAD_EXPIRED"); }
    await database()`update advertising_payment_upload_tokens set status='OPENED',opened_at=coalesce(opened_at,now()),updated_at=now() where id=${item.id} and status='CREATED'`;
    return { ...item, status: "OPENED", received: false };
  } catch (error) { return publicError(error, reply); } });

  app.post("/v1/public/advertising/payment-proof/:token", async (request, reply) => { try {
    const token = z.string().min(32).max(200).parse((request.params as any).token), body = paymentProofUploadSchema.parse(request.body), proof = decodeBase64(body.proof.fileBase64);
    if (!validProof(proof, body.proof.fileMime)) return reply.code(400).send({ error: "INVALID_PAYMENT_PROOF" });
    const result = await database().begin(async tx => {
      const [upload] = await tx`select * from advertising_payment_upload_tokens where token_hash=${paymentUploadTokenHash(token)} for update`;
      if (!upload) throw new Error("PAYMENT_UPLOAD_NOT_FOUND");
      if (upload.status === "SUBMITTED") return { received: true, duplicate: true };
      if (["EXPIRED","REVOKED"].includes(String(upload.status)) || new Date(String(upload.expires_at)).getTime() <= Date.now()) throw new Error("PAYMENT_UPLOAD_EXPIRED");
      await requireOrderFiscalProfile(tx,'PUBLICIDAD',String(upload.order_id));
      await tx`update advertising_payments set proof_mime=${body.proof.fileMime},proof_data=${proof},reference=${body.proof.reference},status='UNDER_REVIEW',settlement_status='PENDING_RECONCILIATION',updated_at=now() where id=${upload.payment_id}`;
      await tx`update advertising_orders set status='PAYMENT_REVIEW',updated_at=now() where id=${upload.order_id}`;
      await tx`update affiliate_banners set campaign_status='PAYMENT_REVIEW',review_requested_at=now(),updated_at=now() where order_id=${upload.order_id}`;
      await tx`update advertising_payment_upload_tokens set status='SUBMITTED',submitted_at=now(),updated_at=now() where id=${upload.id}`;
      return { received: true, duplicate: false };
    });
    return reply.code(result.duplicate ? 200 : 201).send(result);
  } catch (error) { return publicError(error, reply); } });
  app.get("/v1/public/advertising/active", async (request, reply) => { try {
    const query=publicCampaignQuerySchema.parse(request.query);
    const campaigns=await database()`select banner.id::text,banner.title,banner.advertiser_name as "advertiserName",banner.action_type as "actionType",banner.action_value as "actionValue",banner.action_message as "actionMessage",case when banner.action_type='WEB' then banner.action_value else null end as "targetUrl",banner.placement,banner.starts_at as "startsAt",banner.ends_at as "endsAt",coalesce(banner.weight,plan.default_weight,1)::int as weight,banner.updated_at as "updatedAt",'/v1/banners/'||banner.id||'/image' as "imageUrl" from affiliate_banners banner left join advertising_plans plan on plan.id=banner.advertising_plan_id where banner.active=true and banner.campaign_status='ACTIVE' and banner.starts_at<=now() and (banner.ends_at is null or banner.ends_at>now()) and octet_length(banner.image_data)>0 and (${query.serviceAreaId??null}::uuid is null or banner.service_area_id is null or banner.service_area_id=${query.serviceAreaId??null}) and ${query.placement}=any(case when banner.category='PREMIUM' or upper(coalesce(plan.code,''))='PREMIUM' or 'PASSENGER_WAITING_DRIVER'=any(coalesce(plan.allowed_placements,array[]::text[])) or 'PASSENGER_TRIP_IN_PROGRESS'=any(coalesce(plan.allowed_placements,array[]::text[])) then array['PASSENGER_SEARCHING_DRIVER','PASSENGER_WAITING_DRIVER','PASSENGER_TRIP_IN_PROGRESS']::text[] when banner.placement in ('PASSENGER_HOME','DRIVER_HOME') then array['PASSENGER_SEARCHING_DRIVER']::text[] else array[banner.placement]::text[] end) order by banner.sort_order,banner.starts_at desc limit greatest(coalesce((select advertising_max_active_per_zone from operational_settings where id=1),10),1)`;
    return { campaigns: campaigns.map((campaign) => ({
      ...campaign,
      actionValue: composeAdvertisingActionValue(campaign.actionType, campaign.actionValue, campaign.actionMessage)
    })) };
  } catch(error){ return publicError(error,reply); } });
  app.post("/v1/public/advertising/events", async (request, reply) => { try {
    const value=publicEventSchema.parse(request.body);
    await database()`insert into advertising_events(campaign_id,event_type,exhibition_id,session_key_hash,placement,service_area_id,action_type,platform) select ${value.campaignId},${value.eventType},${value.exhibitionId},encode(digest(${value.sessionKey},'sha256'),'hex'),${value.placement},${value.serviceAreaId??null},${value.actionType??null},${value.platform} where exists(select 1 from affiliate_banners where id=${value.campaignId} and active=true and campaign_status='ACTIVE') on conflict(campaign_id,event_type,exhibition_id) do nothing`;
    return reply.code(202).send({accepted:true});
  } catch(error){ return publicError(error,reply); } });
  app.post("/v1/public/advertising/leads", async (request, reply) => { try {
    const body = leadSchema.parse({ ...(request.body as object), source: cleanSource((request.body as any)?.source) });
    if (body.submissionKey) {
      const [existing] = await database()`select code,status from advertising_leads where submission_key=${body.submissionKey}`;
      if (existing) return reply.code(200).send({ leadCode: existing.code, status: existing.status, duplicate: true });
    }
    if (!allowLead(request)) return reply.code(429).send({ error: "TOO_MANY_REQUESTS" });
    const [lead] = await database()`insert into advertising_leads(code,business_name,contact_name,phone_e164,email,city,business_type,interest,source,status,conversation_state,submission_key)
      values ('LEAD-'||extract(year from now())::int||'-'||lpad(nextval('advertising_lead_code_seq')::text,6,'0'),${body.businessName},${body.contactName},${body.phone},lower(${body.email}),${body.city},${body.businessType},${body.interest},${body.source},${body.requiresContact ? "REQUIRES_CONTACT" : "NEW"},${JSON.stringify(body.conversationState)}::jsonb,${body.submissionKey ?? null})
      on conflict(submission_key) where submission_key is not null do nothing
      returning id::text,code,status,email,business_name as "businessName"`;
    if (!lead) {
      const [existing] = body.submissionKey ? await database()`select code,status from advertising_leads where submission_key=${body.submissionKey}` : [];
      return reply.code(200).send({ leadCode: existing?.code, status: existing?.status, duplicate: true });
    }
    if (!lead) throw new Error("LEAD_NOT_CREATED");
    await publicAudit("ADVERTISING_LEAD_CREATED","ADVERTISING_LEAD",String(lead.id),body.source);
    const invitation = await createInvitation(String(lead.id), body.source);
    void sendTransactionalEmail({ to: body.email, subject: `Continúa tu solicitud comercial ${lead.code} · Costa-Go`, text: `Hola ${body.contactName}. Continúa tu solicitud para ${body.businessName}: ${invitation.url}`, html: renderCostaGoEmail({title:`¡Hola ${body.contactName}!`,lead:`Continúa la solicitud publicitaria de ${body.businessName}. Estamos listos para ayudarte a activar tu publicidad en Costa-Go.`,primaryAction:{label:'Continuar solicitud',url:invitation.url},notice:{title:`El enlace vence el ${new Date(String(invitation.expiresAt)).toLocaleDateString('es-EC')}`,text:'Si no realizaste esta solicitud o crees que es un error, puedes ignorar este correo.',tone:'info'}}) }).catch(() => false);
    const [notificationSettings]=await database()`select advertising_commercial_emails as emails from operational_settings where id=1`;
    for(const email of Array.isArray(notificationSettings?.emails)?notificationSettings.emails:[]){
      void sendTransactionalEmail({to:String(email),subject:`Nuevo prospecto publicitario ${lead.code} · Costa-Go`,text:`${body.businessName} solicitó información. Contacto: ${body.contactName}, ${body.phone}, ${body.email}.`,html:`<p>Se registró el prospecto <strong>${lead.code}</strong>.</p><p><strong>${body.businessName}</strong><br>${body.contactName}<br>${body.phone}<br>${body.email}</p>`}).catch(()=>false);
    }
    return reply.code(201).send({ leadCode: lead.code, status: lead.status, invitationUrl: invitation.url, expiresAt: invitation.expiresAt });
  } catch (error) { return publicError(error, reply); } });
  app.get("/v1/public/advertising/leads/status", async (request, reply) => { try {
    const query = z.object({ code: z.string().min(8).max(40), email: z.string().email() }).parse(request.query);
    const [lead] = await database()`select code,status,business_name as "businessName",updated_at as "updatedAt" from advertising_leads where code=${query.code.toUpperCase()} and lower(email)=lower(${query.email})`;
    return lead ?? reply.code(404).send({ error: "LEAD_NOT_FOUND" });
  } catch (error) { return publicError(error, reply); } });
  app.get("/v1/public/advertising/invitations/:token", async (request, reply) => { try {
    const token = z.string().min(32).max(200).parse((request.params as any).token); const invitation = await invitationFor(token);
    if (invitation.status === "SUBMITTED") return { status: "SUBMITTED", leadCode: invitation.lead_code, submittedAt: invitation.submitted_at };
    await database()`update advertising_invitations set status=case when status='CREATED' then 'OPENED' else status end,opened_at=coalesce(opened_at,now()),updated_at=now() where id=${invitation.id}`;
    if(invitation.status==="CREATED"||invitation.status==="CORRECTION")await publicAudit("ADVERTISING_INVITATION_OPENED","ADVERTISING_INVITATION",String(invitation.id),String(invitation.purpose));
    let correctionCampaign=null;if(invitation.purpose==="CORRECTION"&&invitation.campaign_id){const [campaign]=await database()`select id::text,title from affiliate_banners where id=${invitation.campaign_id}`;correctionCampaign=campaign??null;}
    return { status: invitation.status === "CREATED" ? "OPENED" : invitation.status, purpose: invitation.purpose, correctionFields: invitation.correction_fields, correctionCampaign, expiresAt: invitation.expires_at, lead: { code: invitation.lead_code, businessName: invitation.business_name, contactName: invitation.contact_name, phone: invitation.phone_e164, email: invitation.email, city: invitation.city, businessType: invitation.business_type, interest: invitation.interest }, draft: invitation.draft_data };
  } catch (error) { return publicError(error, reply); } });
  app.patch("/v1/public/advertising/invitations/:token", async (request, reply) => { try {
    const token = z.string().min(32).max(200).parse((request.params as any).token); const invitation = await invitationFor(token);
    if (invitation.status === "SUBMITTED") throw new Error("INVITATION_LOCKED"); const draft = draftSchema.parse(request.body);
    const serialized = JSON.stringify(draft); if (Buffer.byteLength(serialized) > 50_000) return reply.code(413).send({ error: "DRAFT_TOO_LARGE" });
    const [saved] = await database()`update advertising_invitations set draft_data=draft_data||${serialized}::jsonb,status='IN_PROGRESS',updated_at=now()
      where id=${invitation.id} and draft_data is distinct from draft_data||${serialized}::jsonb returning id`;
    if (saved) await publicAudit("ADVERTISING_APPLICATION_SAVED","ADVERTISING_INVITATION",String(invitation.id),`Paso ${draft.step??"actualizado"}`);
    return { saved: true, status: "IN_PROGRESS", duplicate: !saved };
  } catch (error) { return publicError(error, reply); } });
  app.post("/v1/public/advertising/invitations/:token/submit", async (request, reply) => { try {
    const token = z.string().min(32).max(200).parse((request.params as any).token); const invitation = await invitationFor(token);
    if (invitation.status === "SUBMITTED") {
      const existing = await submittedApplicationFor(database(), invitation);
      if (!existing) throw new Error("INVITATION_LOCKED");
      return reply.code(200).send({ ...existing, duplicate: true });
    }
    if(invitation.purpose==="CORRECTION"){
      const correction=correctionSubmitSchema.parse(request.body),image=decodeBase64(correction.campaign.imageBase64),dimensions=imageDimensions(image,correction.campaign.imageMime);
      const [settings]=await database()`select advertising_max_image_bytes as bytes,advertising_banner_width as width,advertising_banner_height as height from operational_settings where id=1`;
      if(!invitation.campaign_id)throw new Error("CAMPAIGN_NOT_FOUND");
      if(!dimensions||image.length>Number(settings?.bytes??1_048_576)||dimensions.width!==Number(settings?.width??1200)||dimensions.height!==Number(settings?.height??400))return reply.code(400).send({error:"INVALID_BANNER_IMAGE",message:`El banner debe medir ${settings?.width??1200}×${settings?.height??400} px.`});
      const result=await database().begin(async tx=>{
        await tx`select pg_advisory_xact_lock(hashtextextended(${String(invitation.id)},0))`;
        const [latest]=await tx`select status from advertising_invitations where id=${invitation.id}`;
        if(latest?.status==="SUBMITTED"){
          const existing=await submittedApplicationFor(tx,invitation);
          return {...(existing??{orderCode:invitation.lead_code,campaignId:invitation.campaign_id,status:"PENDING_REVIEW"}),duplicate:true};
        }
        const [campaign]=await tx`update affiliate_banners set image_mime=${correction.campaign.imageMime},image_data=${image},campaign_status='PENDING_REVIEW',active=false,correction_note=null,review_requested_at=now(),updated_at=now() where id=${invitation.campaign_id} returning id::text,order_id`;
        if(!campaign)throw new Error("CAMPAIGN_NOT_FOUND");
        await tx`insert into campaign_status_history(campaign_id,from_status,to_status,note) values (${campaign.id},'PENDING_REVIEW','PENDING_REVIEW','Banner corregido y reenviado')`;
        await tx`update advertising_invitations set status='SUBMITTED',submitted_at=now(),draft_data=${JSON.stringify({campaign:{imageMime:correction.campaign.imageMime},corrected:true})}::jsonb,updated_at=now() where id=${invitation.id}`;
        const [order]=await tx`select code from advertising_orders where id=${campaign.order_id}`;
        return {orderCode:order?.code??invitation.lead_code,campaignId:campaign.id,status:"PENDING_REVIEW",duplicate:false};
      });
      if(!result.duplicate)await publicAudit("ADVERTISING_CORRECTION_SUBMITTED","AFFILIATE_BANNER",String(result.campaignId),"Pieza reenviada");
      return reply.code(result.duplicate?200:201).send(result);
    }
    const body = submitSchema.parse(request.body), image = decodeBase64(body.campaign.imageBase64), dimensions = imageDimensions(image, body.campaign.imageMime);
    const [settings] = await database()`select advertising_max_image_bytes as bytes,advertising_banner_width as width,advertising_banner_height as height from operational_settings where id=1`;
    if (!dimensions || image.length > Number(settings?.bytes ?? 1_048_576) || dimensions.width !== Number(settings?.width ?? 1200) || dimensions.height !== Number(settings?.height ?? 400)) return reply.code(400).send({ error: "INVALID_BANNER_IMAGE", message: `El banner debe medir ${settings?.width ?? 1200}×${settings?.height ?? 400} px.` });
    const result = await database().begin(async tx => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${String(invitation.id)},0))`;
      const [latest]=await tx`select status from advertising_invitations where id=${invitation.id}`;
      if(latest?.status==="SUBMITTED"){
        const existing=await submittedApplicationFor(tx,invitation);
        if(existing)return {...existing,duplicate:true};
      }
      const [plan] = await tx`select * from advertising_plans where id=${body.planId} and enabled=true and active=true for share`; if (!plan) throw new Error("PLAN_NOT_FOUND");
      const [method] = await tx`select * from advertising_payment_methods where id=${body.paymentMethodId} and active=true`; if (!method) throw new Error("PAYMENT_METHOD_NOT_FOUND");
      const [advertiser] = await tx`insert into advertisers(business_name,contact_name,phone_e164,email,city,business_type,status,assigned_commercial_id)
        values (${body.business.businessName},${body.business.contactName},${body.business.phone},lower(${body.business.email}),${body.business.city},${body.business.businessType},'PROSPECT',${invitation.created_by})
        on conflict(lower(email),lower(business_name)) do update set contact_name=excluded.contact_name,phone_e164=excluded.phone_e164,city=excluded.city,business_type=excluded.business_type,updated_at=now() returning id::text`;
      if (!advertiser) throw new Error("ADVERTISER_NOT_CREATED");
      const [taxSettings]=await tx`select vat_rate_percent::float8 as "vatRatePercent" from operational_settings where id=1`;
      const tax=taxBreakdown(plan.price ?? plan.monthly_price ?? 0,taxSettings?.vatRatePercent??0),amount=tax.total,duration = Number(plan.duration_days ?? 30), start = new Date(body.campaign.startsAt), end = new Date(start.getTime() + duration * 86_400_000), campaignPlacement = normalizeAdvertisingPlacement(plan.placement ?? plan.allowed_placements?.[0]), category = advertisingCategoryFromPlacements(plan.allowed_placements);
      const [order] = await tx`insert into advertising_orders(code,lead_id,advertiser_id,plan_id,assigned_commercial_id,status,subtotal_amount,vat_rate_percent,vat_amount,amount,currency,plan_snapshot,requested_start_at,requested_end_at,invitation_id)
        values ('PUB-'||extract(year from now())::int||'-'||lpad(nextval('advertising_request_code_seq')::text,6,'0'),${invitation.lead_id},${advertiser.id},${plan.id},${invitation.created_by},'PENDING_PAYMENT',${tax.subtotal},${tax.vatRatePercent},${tax.vatAmount},${tax.total},${plan.currency},${JSON.stringify({ code: plan.code, name: plan.name, durationDays: duration, price: tax.subtotal, vatRatePercent: tax.vatRatePercent, vatAmount: tax.vatAmount, total: tax.total })}::jsonb,${start.toISOString()},${end.toISOString()},${invitation.id})
        on conflict(invitation_id) where invitation_id is not null do nothing returning id::text,code`;
      if (!order) {
        const existing = await submittedApplicationFor(tx, invitation);
        if (!existing) throw new Error("ORDER_NOT_CREATED");
        return { ...existing, duplicate: true };
      }
      let paymentStatus = method.requires_proof ? "PENDING" : "UNDER_REVIEW"; let proof: Buffer | null = null;
      if (body.proof) { proof = decodeBase64(body.proof.fileBase64); if (!validProof(proof, body.proof.fileMime)) throw new Error("INVALID_PAYMENT_PROOF"); paymentStatus = "UNDER_REVIEW"; }
      await tx`insert into advertising_payments(order_id,advertiser_id,amount,currency,payment_method_id,proof_mime,proof_data,reference,status)
        values (${order.id},${advertiser.id},${amount},${plan.currency},${method.id},${body.proof?.fileMime ?? null},${proof},${body.proof?.reference ?? null},${paymentStatus})`;
      const actionValue=normalizeAdvertisingActionValue(body.campaign.actionType,body.campaign.actionValue);
      const actionMessage=normalizeAdvertisingActionMessage(body.campaign.actionType,body.campaign.actionMessage);
      const [campaign] = await tx`insert into affiliate_banners(title,advertiser_id,advertiser_name,advertising_plan_id,category,service_area_id,placement,weight,action_type,action_value,action_message,image_mime,image_data,target_url,starts_at,ends_at,active,campaign_status,sort_order,order_id,submitted_at,review_requested_at)
        values (${body.campaign.title},${advertiser.id},${body.business.businessName},${plan.id},${category},${body.campaign.serviceAreaId ?? null},${campaignPlacement},${plan.default_weight},${body.campaign.actionType},${actionValue},${actionMessage},${body.campaign.imageMime},${image},${body.campaign.actionType === "WEB" ? actionValue : null},${start.toISOString()},${end.toISOString()},false,${paymentStatus === "UNDER_REVIEW" ? "PAYMENT_REVIEW" : "PENDING_PAYMENT"},${plan.sort_order ?? 0},${order.id},now(),now()) returning id::text`;
      if (!campaign) throw new Error("CAMPAIGN_NOT_CREATED");
      await tx`insert into campaign_status_history(campaign_id,to_status,note) values (${campaign.id},${paymentStatus === "UNDER_REVIEW" ? "PAYMENT_REVIEW" : "PENDING_PAYMENT"},'Solicitud enviada por comercio')`;
      const submittedSummary={business:body.business,campaign:{title:body.campaign.title,placement:campaignPlacement,serviceAreaId:body.campaign.serviceAreaId,actionType:body.campaign.actionType,actionValue,actionMessage,startsAt:body.campaign.startsAt,imageMime:body.campaign.imageMime},planId:body.planId,paymentMethodId:body.paymentMethodId,orderCode:order.code};
      await tx`update advertising_invitations set status='SUBMITTED',submitted_at=now(),advertiser_id=${advertiser.id},draft_data=${JSON.stringify(submittedSummary)}::jsonb,updated_at=now() where id=${invitation.id}`;
      await tx`update advertising_leads set status='QUALIFIED',advertiser_id=${advertiser.id},updated_at=now() where id=${invitation.lead_id}`;
      return { orderCode: order.code, campaignId: campaign.id, status: paymentStatus === "UNDER_REVIEW" ? "PAYMENT_REVIEW" : "PENDING_PAYMENT", duplicate: false };
    });
    if (!result.duplicate) await publicAudit("ADVERTISING_APPLICATION_SUBMITTED","AFFILIATE_BANNER",String(result.campaignId),String(result.orderCode));
    return reply.code(result.duplicate ? 200 : 201).send(result);
  } catch (error) { return publicError(error, reply); } });

  app.get("/v1/admin/commercial/dashboard", async (request, reply) => { try { const actor = requirePermission(request, "commercial:dashboard"), actorId=actor.id ?? null, own = actor.role === "COMMERCIAL";
    const [row] = await database()`with scoped_orders as (
      select o.* from advertising_orders o
      where not ${own} or (o.assigned_commercial_id=${actorId} and coalesce((
        select method.code from advertising_payments payment join advertising_payment_methods method on method.id=payment.payment_method_id
        where payment.order_id=o.id order by payment.created_at desc limit 1),'')<>'BANK_TRANSFER')
    ), scoped_leads as (
      select l.* from advertising_leads l where not ${own} or (
        (l.assigned_commercial_id is null or l.assigned_commercial_id=${actorId} or l.created_by=${actorId})
        and coalesce((select method.code from advertising_orders o
          left join lateral(select payment.payment_method_id from advertising_payments payment where payment.order_id=o.id order by payment.created_at desc limit 1) payment on true
          left join advertising_payment_methods method on method.id=payment.payment_method_id
          where o.lead_id=l.id order by o.created_at desc limit 1),'')<>'BANK_TRANSFER')
    ) select
      (select count(*)::int from scoped_leads where status='NEW') as "newLeads",
      (select count(*)::int from scoped_leads where status='REQUIRES_CONTACT') as "requiresContact",
      (select count(*)::int from scoped_orders where status in ('DRAFT','PENDING_PAYMENT','PAYMENT_REVIEW')) as "openOrders",
      (select count(*)::int from affiliate_banners b join advertising_orders o on o.id=b.order_id where b.campaign_status in ('PENDING_REVIEW','PAYMENT_REVIEW') and (not ${own} or o.assigned_commercial_id=${actorId})) as "pendingCampaigns",
      (select count(*)::int from affiliate_banners b join advertising_orders o on o.id=b.order_id where b.campaign_status='ACTIVE' and (not ${own} or o.assigned_commercial_id=${actorId})) as "activeCampaigns",
      (select coalesce(sum(amount),0)::float8 from scoped_orders where status='PAID' and date_trunc('month',updated_at at time zone 'America/Guayaquil')=date_trunc('month',now() at time zone 'America/Guayaquil')) as "monthlySales",
      (select count(*)::int from advertisers a where a.status='ACTIVE' and (not ${own} or (a.assigned_commercial_id=${actorId} and exists(select 1 from advertising_orders orders join advertising_payments payments on payments.order_id=orders.id join advertising_payment_methods methods on methods.id=payments.payment_method_id where orders.advertiser_id=a.id and orders.assigned_commercial_id=${actorId} and methods.code<>'BANK_TRANSFER')))) as "activeAdvertisers"`;
    return row;
  } catch (error) { return adminError(error, reply); } });
  app.get("/v1/admin/commercial/leads", async (request, reply) => { try { const actor=requirePermission(request,"commercial:leads:view"),q=listSchema.parse(request.query),own=actor.role==="COMMERCIAL";
    return database()`select l.id::text,l.code,l.business_name as "businessName",l.contact_name as "contactName",l.phone_e164 as phone,l.email,l.city,l.business_type as "businessType",l.interest,l.source,l.status,l.assigned_commercial_id::text as "assignedCommercialId",u.full_name as "assignedCommercial",l.created_at as "createdAt",l.updated_at as "updatedAt",latest_order.id::text as "orderId",latest_order.code as "orderCode",latest_order.status as "orderStatus",latest_order.advertiser_id::text as "advertiserId",latest_order.campaign_id::text as "campaignId",latest_order.payment_method_code as "paymentMethodCode"
      from advertising_leads l
      left join users u on u.id=l.assigned_commercial_id
      left join lateral(
        select o.id,o.code,o.status,o.advertiser_id,b.id as campaign_id,
          (select method.code from advertising_payments payment join advertising_payment_methods method on method.id=payment.payment_method_id where payment.order_id=o.id order by payment.created_at desc limit 1) as payment_method_code
        from advertising_orders o
        left join affiliate_banners b on b.order_id=o.id
        where o.lead_id=l.id
        order by o.created_at desc,b.created_at desc
        limit 1
      )latest_order on true
      where (not ${own} or ((l.assigned_commercial_id is null or l.assigned_commercial_id=${actor.id} or l.created_by=${actor.id}) and coalesce(latest_order.payment_method_code,'')<>'BANK_TRANSFER'))
        and (${q.status ?? null}::text is null or l.status=${q.status ?? null})
        and (${q.source ?? null}::text is null or l.source=${q.source ?? null})
        and (${q.scope ?? null}::text is null or ${q.scope ?? null}::text='ALL' or (${q.scope ?? null}::text='ACTIVE' and l.status not in ('CONVERTED','LOST')) or (${q.scope ?? null}::text='HISTORY' and l.status in ('CONVERTED','LOST')))
        and (${q.search ?? null}::text is null or l.business_name ilike ${q.search ? `%${q.search}%` : null} or l.contact_name ilike ${q.search ? `%${q.search}%` : null} or l.email ilike ${q.search ? `%${q.search}%` : null})
      order by l.created_at desc limit ${q.limit} offset ${q.offset}`;
  }catch(error){return adminError(error,reply);} });
  app.post("/v1/admin/commercial/leads", async (request, reply) => { try {
    const actor=requirePermission(request,"commercial:leads:manage");
    const body=leadSchema.parse({...(request.body as object),source:"COMMERCIAL"});
    const [lead]=await database()`insert into advertising_leads(code,business_name,contact_name,phone_e164,email,city,business_type,interest,source,status,conversation_state,assigned_commercial_id,created_by) values ('LEAD-'||extract(year from now())::int||'-'||lpad(nextval('advertising_lead_code_seq')::text,6,'0'),${body.businessName},${body.contactName},${body.phone},lower(${body.email}),${body.city},${body.businessType},${body.interest},'COMMERCIAL',${body.requiresContact?"REQUIRES_CONTACT":"NEW"},${JSON.stringify(body.conversationState)}::jsonb,${actor.id},${actor.id}) returning id::text,code,status`;
    if(!lead)throw new Error("LEAD_NOT_CREATED");
    await persistAudit(actor,"ADVERTISING_LEAD_CREATED","ADVERTISING_LEAD",String(lead.id),body.businessName);
    return reply.code(201).send(lead);
  } catch(error){return adminError(error,reply);} });
  app.patch("/v1/admin/commercial/leads/:id",async(request,reply)=>{try{const actor=requirePermission(request,"commercial:leads:manage"),body=leadUpdateSchema.parse(request.body),id=z.string().uuid().parse((request.params as any).id);if(body.status==="CONVERTED")throw new Error("LEAD_CONVERSION_REQUIRES_PAID_ORDER");const item=await database().begin(async tx=>{const [current]=await tx`select id::text,status from advertising_leads where id=${id} and (${actor.role!=="COMMERCIAL"} or assigned_commercial_id=${actor.id} or created_by=${actor.id}) for update`;if(!current)throw new Error("LEAD_NOT_FOUND");if(current.status==="CONVERTED"&&body.status&&body.status!=="CONVERTED")throw new Error("CONVERTED_LEAD_LOCKED");const [updated]=await tx`update advertising_leads set status=coalesce(${body.status??null},status),assigned_commercial_id=case when ${body.assignedCommercialId===undefined} then assigned_commercial_id else ${body.assignedCommercialId??null}::uuid end,last_contact_at=case when ${body.note??null}::text is not null then now() else last_contact_at end,updated_at=now() where id=${id} returning id::text,code,status`;return updated;});await persistAudit(actor,"ADVERTISING_LEAD_UPDATED","ADVERTISING_LEAD",id,body.note||body.status||"Actualización comercial");return item;}catch(error){return adminError(error,reply);} });
  app.post("/v1/admin/commercial/leads/:id/claim",async(request,reply)=>{try{
    const actor=requirePermission(request,"commercial:leads:manage"),id=z.string().uuid().parse((request.params as any).id);
    const item=await database().begin(async tx=>{
      const [lead]=await tx`select id::text,status,advertiser_id::text as advertiser_id,assigned_commercial_id::text as assigned_commercial_id,
        exists(select 1 from advertising_orders where lead_id=advertising_leads.id) as has_order,
        exists(select 1 from advertising_orders orders join advertising_payments payments on payments.order_id=orders.id join advertising_payment_methods methods on methods.id=payments.payment_method_id where orders.lead_id=advertising_leads.id and methods.code='BANK_TRANSFER') as automatic_transfer_flow,
        exists(select 1 from advertising_orders where lead_id=advertising_leads.id and assigned_commercial_id is not null and assigned_commercial_id<>${actor.id}) as order_assigned_elsewhere,
        exists(select 1 from advertisers where id=advertising_leads.advertiser_id and assigned_commercial_id is not null and assigned_commercial_id<>${actor.id}) as advertiser_assigned_elsewhere
        from advertising_leads where id=${id} for update`;
      if(!lead)throw new Error("LEAD_NOT_FOUND");
      if(["CONVERTED","LOST"].includes(String(lead.status)))throw new Error("LEAD_NOT_ACTIONABLE");
      if(lead.automatic_transfer_flow)throw new Error("AUTOMATIC_TRANSFER_FLOW");
      if(lead.status==="QUALIFIED"&&lead.has_order)throw new Error("LEAD_ALREADY_HAS_ORDER");
      if(lead.order_assigned_elsewhere||lead.advertiser_assigned_elsewhere)throw new Error("LEAD_ALREADY_ASSIGNED");
      const [claimed]=await tx`update advertising_leads set assigned_commercial_id=${actor.id},status=case when status='NEW' then 'IN_PROGRESS' else status end,updated_at=now() where id=${id} and (assigned_commercial_id is null or assigned_commercial_id=${actor.id} or ${actor.role!=="COMMERCIAL"}) returning id::text,code,status`;
      if(!claimed)throw new Error("LEAD_ALREADY_ASSIGNED");
      await tx`update advertisers set assigned_commercial_id=${actor.id},updated_at=now() where id=${lead.advertiser_id??null}::uuid and (assigned_commercial_id is null or assigned_commercial_id=${actor.id})`;
      await tx`update advertising_orders set assigned_commercial_id=${actor.id},updated_at=now() where lead_id=${id} and (assigned_commercial_id is null or assigned_commercial_id=${actor.id})`;
      return claimed;
    });
    await persistAudit(actor,"ADVERTISING_LEAD_CLAIMED","ADVERTISING_LEAD",id,"Prospecto asignado");return item;
  }catch(error){return adminError(error,reply);} });
  app.post("/v1/admin/commercial/invitations",async(request,reply)=>{try{const actor=requirePermission(request,"commercial:leads:manage"),body=inviteSchema.parse(request.body),own=actor.role==="COMMERCIAL";
    const [lead]=await database()`select id::text,contact_name,email,business_name,status,assigned_commercial_id::text as assigned_commercial_id,exists(select 1 from advertising_orders where lead_id=advertising_leads.id) as has_order from advertising_leads where id=${body.leadId} and (not ${own} or assigned_commercial_id is null or assigned_commercial_id=${actor.id} or created_by=${actor.id})`;
    if(!lead)throw new Error("LEAD_NOT_FOUND");
    if(["CONVERTED","LOST"].includes(String(lead.status)))throw new Error("LEAD_NOT_ACTIONABLE");
    if(lead.has_order)throw new Error("LEAD_ALREADY_HAS_ORDER");
    if(own&&lead.assigned_commercial_id===null)await database()`update advertising_leads set assigned_commercial_id=${actor.id},status=case when status='NEW' then 'IN_PROGRESS' else status end,updated_at=now() where id=${body.leadId} and assigned_commercial_id is null`;
    const invitation=await createInvitation(body.leadId,"COMMERCIAL",actor.id,body.purpose,body.correctionFields,body.campaignId);
    void sendTransactionalEmail({to:String(lead.email),subject:`Invitación comercial Costa-Go`,text:`Continúa la solicitud de ${lead.business_name}: ${invitation.url}`,html:renderCostaGoEmail({title:`¡Hola ${String(lead.contact_name)}!`,lead:`Continúa la solicitud publicitaria de ${String(lead.business_name)}.`,primaryAction:{label:'Continuar solicitud',url:invitation.url},notice:{title:'Enlace seguro',text:'Si no realizaste esta solicitud, puedes ignorar este correo.',tone:'info'}})}).catch(()=>false);await persistAudit(actor,"ADVERTISING_INVITATION_CREATED","ADVERTISING_INVITATION",String(invitation.id),body.purpose);return reply.code(201).send(invitation);}catch(error){return adminError(error,reply);} });
  app.get("/v1/admin/commercial/advertisers",async(request,reply)=>{try{const actor=requirePermission(request,"commercial:advertisers:view"),q=listSchema.parse(request.query),own=actor.role==="COMMERCIAL";return database()`select a.id::text,a.business_name as "businessName",a.contact_name as "contactName",a.phone_e164 as phone,a.email,a.city,a.business_type as "businessType",a.status,a.assigned_commercial_id::text as "assignedCommercialId",u.full_name as "assignedCommercial",a.created_at as "createdAt" from advertisers a left join users u on u.id=a.assigned_commercial_id where (not ${own} or (a.assigned_commercial_id=${actor.id} and exists(select 1 from advertising_orders orders join advertising_payments payments on payments.order_id=orders.id join advertising_payment_methods methods on methods.id=payments.payment_method_id where orders.advertiser_id=a.id and orders.assigned_commercial_id=${actor.id} and methods.code<>'BANK_TRANSFER'))) and (${q.status??null}::text is null or a.status=${q.status??null}) and (${q.search??null}::text is null or a.business_name ilike ${q.search?`%${q.search}%`:null} or a.email ilike ${q.search?`%${q.search}%`:null}) order by a.updated_at desc limit ${q.limit} offset ${q.offset}`;}catch(error){return adminError(error,reply);} });
  app.get("/v1/admin/commercial/orders",async(request,reply)=>{try{const actor=requirePermission(request,"commercial:orders:view"),q=listSchema.parse(request.query),own=actor.role==="COMMERCIAL";return database()`select o.id::text,o.code,o.status,o.subtotal_amount::float8 as "subtotalAmount",o.vat_rate_percent::float8 as "vatRatePercent",o.vat_amount::float8 as "vatAmount",o.amount::float8,o.currency,o.requested_start_at as "requestedStartAt",o.requested_end_at as "requestedEndAt",o.created_at as "createdAt",a.business_name as "businessName",p.name as "planName",u.full_name as "assignedCommercial",pay.id as "paymentId",pay.status as "paymentStatus",pay.settlement_status as "settlementStatus",pay.received_at as "receivedAt",pay.method_code as "paymentMethodCode",pay.proof_mime as "proofMime" from advertising_orders o join advertisers a on a.id=o.advertiser_id join advertising_plans p on p.id=o.plan_id left join users u on u.id=o.assigned_commercial_id left join lateral(select payment.id::text,payment.status,payment.settlement_status,payment.received_at,payment.proof_mime,method.code as method_code from advertising_payments payment join advertising_payment_methods method on method.id=payment.payment_method_id where payment.order_id=o.id order by payment.created_at desc limit 1)pay on true where (not ${own} or (o.assigned_commercial_id=${actor.id} and coalesce(pay.method_code,'')<>'BANK_TRANSFER')) and (${q.status??null}::text is null or o.status=${q.status??null}) and (${q.insight??null}::text is distinct from 'open' or o.status in ('DRAFT','PENDING_PAYMENT','PAYMENT_REVIEW')) and (${q.insight??null}::text is distinct from 'monthSales' or (o.status='PAID' and date_trunc('month',o.updated_at at time zone 'America/Guayaquil')=date_trunc('month',now() at time zone 'America/Guayaquil'))) and (${q.search??null}::text is null or o.code ilike ${q.search?`%${q.search}%`:null} or a.business_name ilike ${q.search?`%${q.search}%`:null}) order by o.created_at desc limit ${q.limit} offset ${q.offset}`;}catch(error){return adminError(error,reply);} });
  app.post("/v1/admin/commercial/orders/:id/payments",async(request,reply)=>{try{
    const actor=requirePermission(request,"commercial:orders:manage"),id=z.string().uuid().parse((request.params as any).id),body=commercialPaymentSchema.parse(request.body);
    const result=await database().begin(async tx=>{
      const [duplicate]=await tx`select id::text,status,settlement_status as "settlementStatus" from advertising_payments where idempotency_key=${body.idempotencyKey}`;
      if(duplicate)return {...duplicate,duplicate:true};
      const [order]=await tx`select o.*,a.id::text as advertiser_id from advertising_orders o join advertisers a on a.id=o.advertiser_id where o.id=${id} and (${actor.role!=="COMMERCIAL"} or o.assigned_commercial_id=${actor.id}) for update`;
      if(!order)throw new Error("ORDER_NOT_FOUND");
      if(!["PENDING_PAYMENT","PAYMENT_REVIEW"].includes(String(order.status)))throw new Error("PAYMENT_ALREADY_RECEIVED");
      if(Math.abs(Number(order.amount)-body.amount)>0.009)throw new Error("PAYMENT_AMOUNT_MISMATCH");
      await requireOrderFiscalProfile(tx,'PUBLICIDAD',id);
      const [method]=await tx`select id::text from advertising_payment_methods where code=${body.method} and active=true`;
      if(!method)throw new Error("PAYMENT_METHOD_NOT_FOUND");
      let proof:Buffer|null=null;
      if(body.proof){proof=decodeBase64(body.proof.fileBase64);if(!validProof(proof,body.proof.fileMime))throw new Error("INVALID_PAYMENT_PROOF");}
      const settlementStatus=body.method==="CASH"?"PENDING_CLOSURE":"PENDING_RECONCILIATION";
      const [payment]=await tx`update advertising_payments set amount=${body.amount},payment_method_id=${method.id},proof_mime=${body.proof?.fileMime??null},proof_data=${proof},reference=${body.reference||null},status='RECEIVED',received_by=${actor.id},received_at=now(),receiver_role=${actor.role},settlement_status=${settlementStatus},idempotency_key=${body.idempotencyKey},reviewed_by=null,reviewed_at=null,rejection_reason=null,updated_at=now() where id=(select id from advertising_payments where order_id=${id} order by created_at desc limit 1) and status in ('PENDING','UNDER_REVIEW','REJECTED') returning id::text,status,settlement_status as "settlementStatus",received_at as "receivedAt"`;
      if(!payment)throw new Error("PAYMENT_ALREADY_RECEIVED");
      await tx`update advertising_orders set status='PAYMENT_REVIEW',updated_at=now() where id=${id}`;
      await tx`update affiliate_banners set campaign_status='PAYMENT_REVIEW',active=false,updated_at=now() where order_id=${id}`;
      return {...payment,duplicate:false};
    });
    if(!result.duplicate)await persistAudit(actor,"ADVERTISING_PAYMENT_RECEIVED","ADVERTISING_PAYMENT",String(result.id),`${body.method}: ${body.amount.toFixed(2)}`);
    return reply.code(result.duplicate?200:201).send(result);
  }catch(error){return adminError(error,reply);} });
  app.get("/v1/admin/commercial/payments",async(request,reply)=>{try{const actor=requirePermission(request,"commercial:payments:view"),q=listSchema.parse(request.query),own=actor.role==="COMMERCIAL";return database()`select pay.id::text,pay.status,pay.settlement_status as "settlementStatus",pay.amount::float8,pay.currency,pay.reference,pay.proof_mime as "proofMime",pay.received_at as "receivedAt",pay.created_at as "createdAt",o.id::text as "orderId",o.code as "orderCode",a.business_name as "businessName",m.code as "paymentMethodCode",m.name as "paymentMethod",receiver.full_name as "receivedBy" from advertising_payments pay join advertising_orders o on o.id=pay.order_id join advertisers a on a.id=pay.advertiser_id join advertising_payment_methods m on m.id=pay.payment_method_id left join users receiver on receiver.id=pay.received_by where (not ${own} or (o.assigned_commercial_id=${actor.id} and m.code<>'BANK_TRANSFER')) and (${q.status??null}::text is null or pay.status=${q.status??null}) order by coalesce(pay.received_at,pay.created_at) desc limit ${q.limit} offset ${q.offset}`;}catch(error){return adminError(error,reply);} });
  app.post("/v1/admin/commercial/payments/:id/remind",async(request,reply)=>{try{
    const actor=requirePermission(request,"commercial:payments:review"),id=z.string().uuid().parse((request.params as any).id);
    const [item]=await database()`select pay.id::text,pay.order_id::text,pay.status,pay.proof_data,o.code as order_code,o.amount::float8,o.currency,lead.code as lead_code,lead.contact_name,lead.email,lead.submission_key,plan.name as plan_name,method.instructions,method.account_details,upload.status as upload_status
      from advertising_payments pay
      join advertising_orders o on o.id=pay.order_id
      join advertising_payment_methods method on method.id=pay.payment_method_id
      join advertising_plans plan on plan.id=o.plan_id
      join advertising_leads lead on lead.id=o.lead_id
      left join advertising_payment_upload_tokens upload on upload.payment_id=pay.id
      where pay.id=${id} and method.code='BANK_TRANSFER'`;
    if(!item)throw new Error("PAYMENT_NOT_FOUND");
    if(item.proof_data||!['PENDING','REJECTED'].includes(String(item.status))||!item.submission_key||item.upload_status==='SUBMITTED')throw new Error("PAYMENT_REMINDER_NOT_AVAILABLE");
    const rawToken=paymentUploadToken(String(item.submission_key)),tokenHash=paymentUploadTokenHash(rawToken),uploadUrl=`${publicBase()}/anunciarme/comprobante/?token=${encodeURIComponent(rawToken)}`;
    await database()`insert into advertising_payment_upload_tokens(order_id,payment_id,token_hash,status,expires_at) values(${item.order_id},${id},${tokenHash},'CREATED',now()+interval '7 days') on conflict(payment_id) do update set token_hash=excluded.token_hash,status='CREATED',expires_at=excluded.expires_at,updated_at=now()`;
    const instructions=bankInstructions(item);
    const sent=await sendTransactionalEmail({to:String(item.email),subject:`Recordatorio de transferencia ${item.order_code} · Costa-Go`,text:`Hola ${item.contact_name}.\nTu orden ${item.order_code} continúa pendiente de pago.\nPlan: ${item.plan_name}\nValor: ${item.currency} ${Number(item.amount).toFixed(2)}\n\n${instructions}\n\nCarga el comprobante en este enlace seguro: ${uploadUrl}`,html:`<p>Hola <strong>${emailHtml(item.contact_name)}</strong>.</p><p>Tu orden <strong>${emailHtml(item.order_code)}</strong> continúa pendiente de pago.</p><ul><li>Plan: <strong>${emailHtml(item.plan_name)}</strong></li><li>Valor: <strong>${emailHtml(item.currency)} ${Number(item.amount).toFixed(2)}</strong></li></ul><p style="white-space:pre-line">${emailHtml(instructions)}</p><p><a href="${emailHtml(uploadUrl)}">Cargar comprobante de transferencia</a></p><p>Este enlace es único y vence en 7 días.</p>`});
    if(!sent)throw new Error("PAYMENT_REMINDER_NOT_SENT");
    await database()`update advertising_payment_upload_tokens set email_sent_at=now(),updated_at=now() where payment_id=${id}`;
    await persistAudit(actor,"ADVERTISING_PAYMENT_REMINDER_SENT","ADVERTISING_PAYMENT",id,`Orden ${item.order_code}`);
    return {id,reminded:true};
  }catch(error){return adminError(error,reply);} });
  app.get("/v1/admin/commercial/cash-closures",async(request,reply)=>{try{
    const actor=requirePermission(request,"commercial:payments:view"),own=actor.role==="COMMERCIAL";
    const unclosed=await database()`select (pay.received_at at time zone 'America/Guayaquil')::date::text as "businessDate",count(*)::int as "paymentCount",sum(pay.amount)::float8 as total from advertising_payments pay join advertising_orders o on o.id=pay.order_id join advertising_payment_methods method on method.id=pay.payment_method_id where method.code='CASH' and pay.status='RECEIVED' and pay.settlement_status='PENDING_CLOSURE' and pay.cash_closure_id is null and (not ${own} or pay.received_by=${actor.id}) group by 1 order by 1 desc`;
    const closures=await database()`select closure.id::text,closure.business_date::text as "businessDate",closure.status,closure.payment_count as "paymentCount",closure.cash_total::float8 as total,closure.currency,closure.notes,closure.closed_at as "closedAt",closure.reconciliation_reference as "reconciliationReference",commercial.full_name as commercial from advertising_cash_closures closure join users commercial on commercial.id=closure.commercial_id where (not ${own} or closure.commercial_id=${actor.id}) order by closure.business_date desc,closure.created_at desc limit 200`;
    return {unclosed,closures};
  }catch(error){return adminError(error,reply);} });
  app.post("/v1/admin/commercial/cash-closures",async(request,reply)=>{try{
    const actor=requirePermission(request,"commercial:orders:manage"),body=cashClosureSchema.parse(request.body);
    const closure=await database().begin(async tx=>{
      const [existing]=await tx`select id::text from advertising_cash_closures where commercial_id=${actor.id} and business_date=${body.businessDate}::date`;
      if(existing)throw new Error("CASH_CLOSURE_ALREADY_EXISTS");
      const payments=await tx`select pay.id::text,pay.amount::float8 from advertising_payments pay join advertising_payment_methods method on method.id=pay.payment_method_id where pay.received_by=${actor.id} and method.code='CASH' and pay.status='RECEIVED' and pay.settlement_status='PENDING_CLOSURE' and pay.cash_closure_id is null and (pay.received_at at time zone 'America/Guayaquil')::date=${body.businessDate}::date for update`;
      if(!payments.length)throw new Error("CASH_CLOSURE_EMPTY");
      const total=payments.reduce((sum:number,item:any)=>sum+Number(item.amount),0);
      const [created]=await tx`insert into advertising_cash_closures(commercial_id,business_date,payment_count,cash_total,notes) values(${actor.id},${body.businessDate}::date,${payments.length},${total},${body.notes||null}) returning id::text,status,payment_count as "paymentCount",cash_total::float8 as total,business_date::text as "businessDate"`;
      await tx`update advertising_payments set cash_closure_id=${created.id},settlement_status='PENDING_RECONCILIATION',updated_at=now() where id=any(${payments.map((item:any)=>String(item.id))}::uuid[])`;
      return created;
    });
    await persistAudit(actor,"ADVERTISING_CASH_CLOSURE_CREATED","ADVERTISING_CASH_CLOSURE",String(closure.id),`${closure.businessDate}: ${Number(closure.total).toFixed(2)}`);
    return reply.code(201).send(closure);
  }catch(error){return adminError(error,reply);} });
  app.post("/v1/admin/commercial/cash-closures/:id/review",async(request,reply)=>{try{
    const actor=requirePermission(request,"commercial:payments:review"),id=z.string().uuid().parse((request.params as any).id),body=closureReviewSchema.parse(request.body);
    const result=await database().begin(async tx=>{
      const [closure]=await tx`select * from advertising_cash_closures where id=${id} for update`;
      if(!closure)throw new Error("CASH_CLOSURE_NOT_FOUND");
      if(closure.status!=="PENDING_RECONCILIATION")throw new Error("CASH_CLOSURE_ALREADY_REVIEWED");
      const paymentIds=(await tx`select id::text from advertising_payments where cash_closure_id=${id} and status='RECEIVED' for update`).map((item:any)=>String(item.id));
      if(!paymentIds.length)throw new Error("CASH_CLOSURE_EMPTY");
      if(body.decision==="REJECT"){
        await tx`update advertising_cash_closures set status='REJECTED',reconciled_by=${actor.id},reconciled_at=now(),rejection_reason=${body.note},updated_at=now() where id=${id}`;
        await tx`update advertising_payments set settlement_status='REJECTED',updated_at=now() where id=any(${paymentIds}::uuid[])`;
        return {status:"REJECTED",recipients:[]};
      }
      await tx`update advertising_cash_closures set status='RECONCILED',reconciled_by=${actor.id},reconciled_at=now(),reconciliation_reference=${body.reference},updated_at=now() where id=${id}`;
      const paid=await markAdvertisingOrdersPaid(tx,paymentIds,String(actor.id),`Caja conciliada: ${body.reference}`);
      return {status:"RECONCILED",recipients:paid.recipients};
    });
    sendAdvertisingPaymentConfirmed(result.recipients);
    await persistAudit(actor,"ADVERTISING_CASH_CLOSURE_REVIEWED","ADVERTISING_CASH_CLOSURE",id,`${body.decision}: ${body.reference||body.note}`);
    return {id,status:result.status};
  }catch(error){return adminError(error,reply);} });
  app.get("/v1/admin/commercial/payments/:id/proof",async(request,reply)=>{try{const actor=requirePermission(request,"commercial:payments:view"),own=actor.role==="COMMERCIAL";const id=z.string().uuid().parse((request.params as any).id);const [file]=await database()`select pay.proof_mime,pay.proof_data from advertising_payments pay join advertising_orders o on o.id=pay.order_id where pay.id=${id} and (not ${own} or o.assigned_commercial_id=${actor.id})`;if(!file?.proof_data)throw new Error("PAYMENT_PROOF_NOT_FOUND");return reply.header("content-type",String(file.proof_mime)).header("cache-control","private, no-store").send(file.proof_data);}catch(error){return adminError(error,reply);} });
  app.post("/v1/admin/commercial/payments/:id/review",async(request,reply)=>{try{
    const actor=requirePermission(request,"commercial:payments:review"),id=z.string().uuid().parse((request.params as any).id),body=paymentReviewSchema.parse(request.body);
    if(body.decision==="REJECT"&&body.reason.length<5)return reply.code(400).send({error:"REASON_REQUIRED"});
    const result=await database().begin(async tx=>{
      const [pay]=await tx`select pay.*,method.code as method_code from advertising_payments pay join advertising_payment_methods method on method.id=pay.payment_method_id where pay.id=${id} for update`;
      if(!pay)throw new Error("PAYMENT_NOT_FOUND");
      if(pay.method_code==="CASH"&&body.decision!=="REFUND")throw new Error("PAYMENT_REQUIRES_CASH_CLOSURE");
      if(body.decision==="APPROVE"&&(pay.method_code!=="BANK_TRANSFER"||!pay.proof_data||!pay.reference))throw new Error("PAYMENT_NOT_READY_FOR_RECONCILIATION");
      if(body.decision!=="REFUND"&&!['PENDING','RECEIVED','UNDER_REVIEW','REJECTED'].includes(String(pay.status)))throw new Error("PAYMENT_ALREADY_REVIEWED");
      if(body.decision==="REFUND"&&pay.status!=="APPROVED")throw new Error("PAYMENT_NOT_REFUNDABLE");
      if(body.decision==="APPROVE"){
        const paid=await markAdvertisingOrdersPaid(tx,[id],String(actor.id),body.reason||"Transferencia conciliada");
        return {status:"APPROVED",recipients:paid.recipients};
      }
      const status=body.decision==="REJECT"?"REJECTED":"REFUNDED",settlement=status==="REJECTED"?"REJECTED":"RECONCILED";
      await tx`update advertising_payments set status=${status},settlement_status=${settlement},reviewed_by=${actor.id},reviewed_at=now(),rejection_reason=${body.reason||null},updated_at=now() where id=${id}`;
      await tx`update advertising_orders set status=${status==="REFUNDED"?"REFUNDED":"PENDING_PAYMENT"},updated_at=now() where id=${pay.order_id}`;
      await tx`update affiliate_banners set campaign_status='PENDING_PAYMENT',active=false,updated_at=now() where order_id=${pay.order_id}`;
      return {status,recipients:[]};
    });
    sendAdvertisingPaymentConfirmed(result.recipients);
    await persistAudit(actor,"ADVERTISING_PAYMENT_REVIEWED","ADVERTISING_PAYMENT",id,`${body.decision}: ${body.reason}`);
    return {id,status:result.status};
  }catch(error){return adminError(error,reply);} });
  app.get("/v1/admin/commercial/campaigns",async(request,reply)=>{try{const actor=requirePermission(request,"commercial:campaigns:view"),q=listSchema.parse(request.query),own=actor.role==="COMMERCIAL";return database()`select b.id::text,b.title,b.advertiser_name as "advertiserName",b.placement,b.action_type as "actionType",b.action_value as "actionValue",b.action_message as "actionMessage",b.campaign_status as status,b.starts_at as "startsAt",b.ends_at as "endsAt",b.active,b.rejection_reason as "rejectionReason",b.correction_note as "correctionNote",o.code as "orderCode",o.status as "orderStatus",o.plan_id::text as "planId",plan.code as "planCode",plan.name as "planName",case when coalesce(b.category,'') in ('BASIC','PREMIUM') then b.category when 'PASSENGER_WAITING_DRIVER'=any(plan.allowed_placements) or 'PASSENGER_TRIP_IN_PROGRESS'=any(plan.allowed_placements) then 'PREMIUM' else 'BASIC' end as category,case when coalesce(b.category,'')='PREMIUM' or (coalesce(b.category,'') not in ('BASIC','PREMIUM') and ('PASSENGER_WAITING_DRIVER'=any(plan.allowed_placements) or 'PASSENGER_TRIP_IN_PROGRESS'=any(plan.allowed_placements))) then array['PASSENGER_SEARCHING_DRIVER','PASSENGER_WAITING_DRIVER','PASSENGER_TRIP_IN_PROGRESS'] else array['PASSENGER_SEARCHING_DRIVER'] end as "effectivePlacements",renewal.code as "renewalOrderCode",renewal.status as "renewalOrderStatus",coalesce((select bool_or(pay.status='APPROVED' and pay.settlement_status='RECONCILED') from advertising_payments pay where pay.order_id=o.id),false) as "paymentVerified",coalesce((select count(*) from advertising_events e where e.campaign_id=b.id and e.event_type='IMPRESSION'),0)::int as impressions,coalesce((select count(*) from advertising_events e where e.campaign_id=b.id and e.event_type in ('CLICK','ACTION')),0)::int as clicks from affiliate_banners b join advertising_orders o on o.id=b.order_id join advertising_plans plan on plan.id=o.plan_id left join lateral(select child.code,child.status from advertising_orders child where child.renewal_of_campaign_id=b.id and child.status not in ('CANCELLED','REFUNDED') order by child.created_at desc limit 1)renewal on true where (not ${own} or o.assigned_commercial_id=${actor.id}) and (${q.status??null}::text is null or b.campaign_status=${q.status??null}) and (${q.insight??null}::text is distinct from 'review' or b.campaign_status in ('PENDING_REVIEW','PAYMENT_REVIEW')) and (${q.search??null}::text is null or b.title ilike ${q.search?`%${q.search}%`:null} or b.advertiser_name ilike ${q.search?`%${q.search}%`:null} or o.code ilike ${q.search?`%${q.search}%`:null}) order by b.created_at desc limit ${q.limit} offset ${q.offset}`;}catch(error){return adminError(error,reply);} });
  app.patch("/v1/admin/commercial/campaigns/:id/action-config",async(request,reply)=>{try{
    const actor=requirePermission(request,"commercial:campaigns:manage"),body=campaignActionConfigSchema.parse(request.body),own=actor.role==="COMMERCIAL",id=z.string().uuid().parse((request.params as any).id);
    const actionValue=normalizeAdvertisingActionValue(body.actionType,body.actionValue);
    const actionMessage=normalizeAdvertisingActionMessage(body.actionType,body.actionMessage);
    const [campaign]=await database()`update affiliate_banners b set action_type=${body.actionType},action_value=${actionValue},action_message=${actionMessage},target_url=${body.actionType==="WEB"?actionValue:null},updated_at=now() from advertising_orders o where b.id=${id} and o.id=b.order_id and (not ${own} or o.assigned_commercial_id=${actor.id}) returning b.id::text,b.action_type as "actionType",b.action_value as "actionValue",b.action_message as "actionMessage"`;
    if(!campaign)throw new Error("CAMPAIGN_NOT_FOUND");
    await persistAudit(actor,"ADVERTISING_CAMPAIGN_ACTION_UPDATED","AFFILIATE_BANNER",id,`${body.actionType}: ${actionValue??"sin destino"}`);
    return campaign;
  }catch(error){return adminError(error,reply);} });
  app.post("/v1/admin/commercial/campaigns/:id/renew",async(request,reply)=>{try{
    const actor=requirePermission(request,"commercial:campaigns:manage"),body=campaignRenewalSchema.parse(request.body),own=actor.role==="COMMERCIAL",id=z.string().uuid().parse((request.params as any).id);
    const result=await database().begin(async tx=>{
      const [source]=await tx`select banner.*,orders.lead_id,orders.advertiser_id,orders.assigned_commercial_id from affiliate_banners banner join advertising_orders orders on orders.id=banner.order_id where banner.id=${id} and (not ${own} or orders.assigned_commercial_id=${actor.id}) for update`;
      if(!source)throw new Error("CAMPAIGN_NOT_FOUND");
      if(!["ACTIVE","SCHEDULED","PAUSED","EXPIRED"].includes(String(source.campaign_status)))throw new Error("CAMPAIGN_NOT_RENEWABLE");
      const [existing]=await tx`select code,status from advertising_orders where renewal_of_campaign_id=${id} and status not in ('CANCELLED','REFUNDED') limit 1`;
      if(existing)throw new Error("CAMPAIGN_RENEWAL_ALREADY_EXISTS");
      const [plan]=await tx`select * from advertising_plans where id=${body.planId} and enabled=true and active=true`;
      if(!plan)throw new Error("PLAN_NOT_FOUND");
      const [taxSettings]=await tx`select vat_rate_percent::float8 as "vatRatePercent" from operational_settings where id=1`;
      const duration=Number(plan.duration_days??30),tax=taxBreakdown(plan.price??plan.monthly_price??0,taxSettings?.vatRatePercent??0),window=advertisingRenewalWindow(source.ends_at,duration),placement=normalizeAdvertisingPlacement(plan.placement??plan.allowed_placements?.[0]),category=advertisingCategoryFromPlacements(plan.allowed_placements);
      const [order]=await tx`insert into advertising_orders(code,lead_id,advertiser_id,plan_id,assigned_commercial_id,status,subtotal_amount,vat_rate_percent,vat_amount,amount,currency,plan_snapshot,requested_start_at,requested_end_at,notes,created_by,renewal_of_campaign_id,content_reused) values ('PUB-'||extract(year from now())::int||'-'||lpad(nextval('advertising_request_code_seq')::text,6,'0'),${source.lead_id},${source.advertiser_id},${plan.id},${source.assigned_commercial_id??actor.id},'PENDING_PAYMENT',${tax.subtotal},${tax.vatRatePercent},${tax.vatAmount},${tax.total},${plan.currency},${JSON.stringify({code:plan.code,name:plan.name,durationDays:duration,price:tax.subtotal,vatRatePercent:tax.vatRatePercent,vatAmount:tax.vatAmount,total:tax.total,renewal:true})}::jsonb,${window.startsAt.toISOString()},${window.endsAt.toISOString()},${body.note||`Renovación de ${source.title}`},${actor.id},${id},true) returning id::text,code,status,subtotal_amount::float8 as "subtotalAmount",vat_rate_percent::float8 as "vatRatePercent",vat_amount::float8 as "vatAmount",amount::float8,currency,requested_start_at as "startsAt",requested_end_at as "endsAt"`;
      const [managedMethod]=await tx`select id::text from advertising_payment_methods where code='COMMERCIAL_MANAGED'`;
      if(!managedMethod)throw new Error("PAYMENT_METHOD_NOT_FOUND");
      await tx`insert into advertising_payments(order_id,advertiser_id,amount,currency,payment_method_id,status,settlement_status) values (${order.id},${source.advertiser_id},${tax.total},${plan.currency},${managedMethod.id},'PENDING','NOT_RECEIVED')`;
      const [campaign]=await tx`insert into affiliate_banners(title,advertiser_name,advertiser_id,advertising_plan_id,category,placement,service_area_id,weight,action_type,action_value,image_mime,image_data,target_url,starts_at,ends_at,active,campaign_status,sort_order,created_by,order_id,submitted_at) values (${source.title},${source.advertiser_name},${source.advertiser_id},${plan.id},${category},${placement},${source.service_area_id},${Number(plan.default_weight??source.weight??1)},${source.action_type},${source.action_value},${source.image_mime},${source.image_data},${source.target_url},${window.startsAt.toISOString()},${window.endsAt.toISOString()},false,'PENDING_PAYMENT',${source.sort_order},${actor.id},${order.id},now()) returning id::text`;
      await tx`insert into campaign_status_history(campaign_id,from_status,to_status,note,changed_by) values (${campaign.id},null,'PENDING_PAYMENT',${`Renovación creada desde ${id}. ${body.note}`},${actor.id})`;
      return {...order,campaignId:String(campaign.id)};
    });
    await persistAudit(actor,"ADVERTISING_CAMPAIGN_RENEWAL_CREATED","AFFILIATE_BANNER",id,`Orden ${result.code}; vigencia ${result.startsAt} — ${result.endsAt}`);
    return reply.code(201).send(result);
  }catch(error){return adminError(error,reply);} });
  app.post("/v1/admin/commercial/campaigns/:id/action",async(request,reply)=>{try{const body=campaignActionSchema.parse(request.body),reviewAction=["APPROVE","REJECT","REQUEST_CORRECTION"].includes(body.action),actor=requirePermission(request,reviewAction?"commercial:campaigns:review":"commercial:campaigns:manage"),own=actor.role==="COMMERCIAL",id=z.string().uuid().parse((request.params as any).id);if(["REJECT","REQUEST_CORRECTION"].includes(body.action)&&body.note.length<5)return reply.code(400).send({error:"NOTE_REQUIRED"});const [campaign]=await database()`select b.starts_at,b.ends_at,b.campaign_status,o.id::text as order_id,o.status as order_status,coalesce((select bool_or(pay.status='APPROVED' and pay.settlement_status='RECONCILED') from advertising_payments pay where pay.order_id=o.id),false) as payment_verified from affiliate_banners b left join advertising_orders o on o.id=b.order_id where b.id=${id} and (not ${own} or o.assigned_commercial_id=${actor.id})`;if(!campaign)throw new Error("CAMPAIGN_NOT_FOUND");const reviewBlock=reviewAction?commercialCampaignReviewBlock(campaign):null;if(reviewBlock)throw new Error(reviewBlock);const allowed:Record<string,string[]>={APPROVE:["PENDING_REVIEW"],REJECT:["PENDING_REVIEW"],REQUEST_CORRECTION:["PENDING_REVIEW"],PAUSE:["ACTIVE","SCHEDULED"],RESUME:["PAUSED"],CANCEL:["DRAFT","PENDING_PAYMENT","PAYMENT_REVIEW","PENDING_REVIEW","SCHEDULED","ACTIVE","PAUSED","REJECTED"]};if(!allowed[body.action]?.includes(String(campaign.campaign_status)))return reply.code(409).send({error:"INVALID_CAMPAIGN_TRANSITION"});let to:string;if(body.action==="APPROVE")to=new Date(String(campaign.starts_at))>new Date()?"SCHEDULED":"ACTIVE";else to={REJECT:"REJECTED",REQUEST_CORRECTION:"PENDING_REVIEW",PAUSE:"PAUSED",RESUME:new Date(String(campaign.starts_at))>new Date()?"SCHEDULED":"ACTIVE",CANCEL:"CANCELLED"}[body.action]!;await transitionCampaign(id,to,actor,body.note);if(body.action==="REQUEST_CORRECTION"){const [lead]=await database()`select o.lead_id::text as id from affiliate_banners b join advertising_orders o on o.id=b.order_id where b.id=${id}`;if(lead?.id){const invitation=await createInvitation(String(lead.id),"ADMIN",actor.id,"CORRECTION",["campaign.image"],id);const [recipient]=await database()`select contact_name,email from advertising_leads where id=${lead.id}`;if(recipient)void sendTransactionalEmail({to:String(recipient.email),subject:"Corrección solicitada para tu campaña · Costa-Go",text:`Costa-Go solicitó una corrección: ${body.note}. ${invitation.url}`,html:`<p>Hola ${recipient.contact_name}.</p><p>Necesitamos una corrección en tu campaña:</p><p><strong>${body.note}</strong></p><p><a href="${invitation.url}">Corregir banner</a></p>`}).catch(()=>false);}}return {id,status:to};}catch(error){return adminError(error,reply);} });
  app.get("/v1/admin/commercial/plans",async(request,reply)=>{try{requirePermission(request,"commercial:campaigns:view");return database()`select id::text,code,name,description,placement,duration_days as "durationDays",price::float8,currency,default_weight as "defaultWeight",allowed_placements as "allowedPlacements",case when 'PASSENGER_WAITING_DRIVER'=any(allowed_placements) or 'PASSENGER_TRIP_IN_PROGRESS'=any(allowed_placements) then 'PREMIUM' else 'BASIC' end as category,active,enabled,sort_order as "sortOrder",updated_at as "updatedAt" from advertising_plans order by sort_order,name`;}catch(error){return adminError(error,reply);} });
  app.post("/v1/admin/commercial/plans",async(request,reply)=>{try{const actor=requirePermission(request,"commercial:plans:manage"),body=planSchema.parse(request.body),category=body.category??advertisingCategoryFromPlacements(body.allowedPlacements),allowedPlacements=advertisingPlacementsForCategory(category),placement=allowedPlacements[0];const [item]=await database()`insert into advertising_plans(code,name,description,placement,duration_days,price,monthly_price,currency,default_weight,allowed_placements,active,enabled,sort_order,created_by,updated_by) values (${body.code},${body.name},${body.description},${placement},${body.durationDays},${body.price},${body.price},${body.currency.toUpperCase()},${body.defaultWeight},${allowedPlacements},${body.active},${body.active},${body.sortOrder},${actor.id},${actor.id}) returning id::text,code,name`;await persistAudit(actor,"ADVERTISING_PLAN_CREATED","ADVERTISING_PLAN",String(item.id),body.name);return reply.code(201).send(item);}catch(error){return adminError(error,reply);} });
  app.patch("/v1/admin/commercial/plans/:id",async(request,reply)=>{try{const actor=requirePermission(request,"commercial:plans:manage"),id=z.string().uuid().parse((request.params as any).id),body=planSchema.partial().parse(request.body);const [current]=await database()`select * from advertising_plans where id=${id}`;if(!current)throw new Error("PLAN_NOT_FOUND");const category=body.category??(body.allowedPlacements?advertisingCategoryFromPlacements(body.allowedPlacements):advertisingCategoryFromPlacements(current.allowed_placements)),allowedPlacements=advertisingPlacementsForCategory(category),placement=allowedPlacements[0];const [item]=await database()`update advertising_plans set name=${body.name??current.name},description=${body.description??current.description},placement=${placement},duration_days=${body.durationDays??current.duration_days},price=${body.price??current.price},monthly_price=${body.price??current.monthly_price},currency=${body.currency?.toUpperCase()??current.currency},default_weight=${body.defaultWeight??current.default_weight},allowed_placements=${allowedPlacements},active=${body.active??current.active},enabled=${body.active??current.enabled},sort_order=${body.sortOrder??current.sort_order},updated_by=${actor.id},updated_at=now() where id=${id} returning id::text,code,name,active`;await persistAudit(actor,"ADVERTISING_PLAN_UPDATED","ADVERTISING_PLAN",id,String(item.name));return item;}catch(error){return adminError(error,reply);} });
  app.get("/v1/admin/commercial/settings",async(request,reply)=>{try{requirePermission(request,"commercial:plans:manage");const [settings]=await database()`select advertising_invitation_days as "invitationDays",advertising_max_image_bytes as "maxImageBytes",advertising_banner_width as "bannerWidth",advertising_banner_height as "bannerHeight",advertising_max_active_per_zone as "maxActivePerZone",advertising_commercial_emails as "commercialEmails" from operational_settings where id=1`;const methods=await database()`select id::text,code,name,instructions,active,requires_proof as "requiresProof",sort_order as "sortOrder" from advertising_payment_methods order by sort_order,name`;return {...settings,paymentMethods:methods};}catch(error){return adminError(error,reply);} });
  app.patch("/v1/admin/commercial/settings",async(request,reply)=>{try{const actor=requirePermission(request,"commercial:plans:manage"),body=commercialSettingsSchema.parse(request.body);const [settings]=await database()`update operational_settings set advertising_invitation_days=${body.invitationDays},advertising_max_image_bytes=${body.maxImageBytes},advertising_banner_width=${body.bannerWidth},advertising_banner_height=${body.bannerHeight},advertising_max_active_per_zone=${body.maxActivePerZone},advertising_commercial_emails=${body.commercialEmails},updated_at=now(),updated_by=${actor.id} where id=1 returning advertising_invitation_days as "invitationDays",advertising_max_image_bytes as "maxImageBytes",advertising_banner_width as "bannerWidth",advertising_banner_height as "bannerHeight",advertising_max_active_per_zone as "maxActivePerZone",advertising_commercial_emails as "commercialEmails"`;await persistAudit(actor,"ADVERTISING_SETTINGS_UPDATED","OPERATIONAL_SETTINGS","1","Configuración comercial actualizada");return settings;}catch(error){return adminError(error,reply);} });
  app.patch("/v1/admin/commercial/payment-methods/:id",async(request,reply)=>{try{const actor=requirePermission(request,"commercial:plans:manage"),id=z.string().uuid().parse((request.params as any).id),body=paymentMethodSchema.parse(request.body);const [method]=await database()`update advertising_payment_methods set name=${body.name},instructions=${body.instructions},active=${body.active},requires_proof=${body.requiresProof},sort_order=${body.sortOrder},updated_at=now() where id=${id} returning id::text,code,name,active,requires_proof as "requiresProof",sort_order as "sortOrder"`;if(!method)throw new Error("PAYMENT_METHOD_NOT_FOUND");await persistAudit(actor,"ADVERTISING_PAYMENT_METHOD_UPDATED","ADVERTISING_PAYMENT_METHOD",id,body.name);return method;}catch(error){return adminError(error,reply);} });
}
