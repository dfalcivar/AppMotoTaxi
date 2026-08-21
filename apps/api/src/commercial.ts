import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { database as rawDatabase } from "./database.js";
import { imageDimensions, persistAudit, requirePermission, type SessionUser } from "./admin.js";
import { sendTransactionalEmail } from "./email.js";

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
  conversationState: z.record(z.string(), z.unknown()).default({})
});
const draftSchema = z.object({
  step: z.number().int().min(1).max(20).optional(),
  business: z.record(z.string(), z.unknown()).optional(),
  campaign: z.record(z.string(), z.unknown()).optional(),
  planId: z.string().uuid().optional(),
  paymentMethodId: z.string().uuid().optional(),
  notes: z.string().trim().max(2000).optional()
}).strict();
const submitSchema = z.object({
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
const correctionSubmitSchema = z.object({ campaign: z.object({ imageBase64: z.string().min(100), imageMime: z.enum(["image/jpeg", "image/png", "image/webp"]) }) });
const listSchema = z.object({
  status: z.string().trim().max(50).optional(), source: sourceSchema.optional(),
  search: z.string().trim().max(120).optional(), limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});
const inviteSchema = z.object({ leadId: z.string().uuid(), purpose: z.enum(["APPLICATION", "CORRECTION"]).default("APPLICATION"), correctionFields: z.array(z.string().max(80)).max(20).default([]), campaignId: z.string().uuid().optional() }).refine(value=>value.purpose!=="CORRECTION"||Boolean(value.campaignId),{message:"CAMPAIGN_REQUIRED",path:["campaignId"]});
const leadUpdateSchema = z.object({ status: leadStatusSchema.optional(), assignedCommercialId: z.string().uuid().nullable().optional(), note: z.string().trim().max(1000).optional() });
const paymentReviewSchema = z.object({ decision: z.enum(["APPROVE", "REJECT", "REFUND"]), reason: z.string().trim().max(1000).optional().default("") });
const campaignActionSchema = z.object({ action: z.enum(["APPROVE", "REJECT", "REQUEST_CORRECTION", "PAUSE", "RESUME", "CANCEL"]), note: z.string().trim().max(1000).optional().default("") });
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
function publicBase(): string { return (process.env.PUBLIC_WEB_BASE_URL ?? "https://costa-go.com").replace(/\/$/, ""); }
function cleanSource(value: unknown): z.infer<typeof sourceSchema> {
  const candidate = String(value ?? "WEB").trim().toUpperCase();
  return sourceSchema.safeParse(candidate).success ? candidate as z.infer<typeof sourceSchema> : "OTHER";
}
export function normalizeAdvertisingPlacement(value: unknown): z.infer<typeof currentPlacementSchema> {
  if (value === "PASSENGER_WAITING_DRIVER" || value === "PASSENGER_TRIP_IN_PROGRESS") return value;
  return "PASSENGER_SEARCHING_DRIVER";
}
function publicError(error: unknown, reply: FastifyReply) {
  if (error instanceof z.ZodError) return reply.code(400).send({ error: "INVALID_DATA", details: error.flatten() });
  const message = error instanceof Error ? error.message : "ERROR";
  const status = message === "INVITATION_NOT_FOUND" ? 404 : message === "INVITATION_EXPIRED" ? 410 : message === "INVITATION_LOCKED" ? 409 : 500;
  if (status < 500) return reply.code(status).send({ error: message });
  reply.log.error({ err: error }, "No se pudo completar la solicitud comercial");
  return reply.code(500).send({
    error: "COMMERCIAL_SUBMISSION_FAILED",
    message: "No pudimos guardar la solicitud comercial. Tus datos siguen en pantalla; intenta enviarla nuevamente en unos minutos."
  });
}
function adminError(error: unknown, reply: FastifyReply) {
  if (error instanceof z.ZodError) return reply.code(400).send({ error: "INVALID_DATA", details: error.flatten() });
  const message = error instanceof Error ? error.message : "ERROR";
  if (message === "UNAUTHORIZED") return reply.code(401).send({ error: message });
  if (message === "FORBIDDEN") return reply.code(403).send({ error: message });
  if (["PAYMENT_ALREADY_REVIEWED","PAYMENT_NOT_REFUNDABLE","LEAD_CONVERSION_REQUIRES_PAID_ORDER","CONVERTED_LEAD_LOCKED"].includes(message)) return reply.code(409).send({ error: message });
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
function decodeBase64(value: string): Buffer { return Buffer.from(value.replace(/^data:[^;]+;base64,/, ""), "base64"); }
function validProof(data: Buffer, mime: string): boolean {
  if (data.length < 100 || data.length > 5_000_000) return false;
  if (mime === "application/pdf") return data.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mime === "image/jpeg") return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (mime === "image/png") return data.subarray(1, 4).toString() === "PNG";
  return mime === "image/webp" && data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP";
}
async function transitionCampaign(campaignId: string, to: string, actor?: SessionUser, note = "") {
  const [current] = await database()`select campaign_status from affiliate_banners where id=${campaignId}`;
  if (!current) throw new Error("CAMPAIGN_NOT_FOUND");
  await database()`update affiliate_banners set campaign_status=${to},active=${to === "ACTIVE"},rejection_reason=case when ${to}='REJECTED' then ${note || null} else rejection_reason end,correction_note=case when ${to}='PENDING_REVIEW' then ${note || null} else correction_note end,updated_at=now() where id=${campaignId}`;
  await database()`insert into campaign_status_history(campaign_id,from_status,to_status,note,changed_by) values (${campaignId},${current.campaign_status},${to},${note || null},${actor?.id ?? null})`;
  if (actor) await persistAudit(actor, "ADVERTISING_CAMPAIGN_STATUS_UPDATED", "AFFILIATE_BANNER", campaignId, `${current.campaign_status} → ${to}. ${note}`);
}

export async function advertisingSchedulerTick(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  await database()`with changed as (update affiliate_banners set campaign_status='ACTIVE',active=true,updated_at=now() where campaign_status='SCHEDULED' and starts_at<=now() and (ends_at is null or ends_at>now()) returning id) insert into campaign_status_history(campaign_id,from_status,to_status,note) select id,'SCHEDULED','ACTIVE','Activación automática' from changed`;
  await database()`with expired as (select id,campaign_status as old_status from affiliate_banners where campaign_status in ('ACTIVE','SCHEDULED') and ends_at is not null and ends_at<=now() for update),changed as (update affiliate_banners banner set campaign_status='EXPIRED',active=false,updated_at=now() from expired where banner.id=expired.id returning banner.id,expired.old_status) insert into campaign_status_history(campaign_id,from_status,to_status,note) select id,old_status,'EXPIRED','Finalización automática' from changed`;
  await database()`update advertising_invitations set status='EXPIRED',updated_at=now() where status in ('CREATED','OPENED','IN_PROGRESS','CORRECTION') and expires_at<=now()`;
}

export async function registerCommercialRoutes(app: FastifyInstance) {
  app.get("/v1/public/advertising/plans", async () => database()`select id::text,code,name,description,placement,duration_days as "durationDays",price::float8,currency,default_weight as "defaultWeight",allowed_placements as "allowedPlacements" from advertising_plans where enabled=true and active=true order by sort_order,name`);
  app.get("/v1/public/advertising/payment-methods", async () => database()`select id::text,code,name,instructions,account_details as "accountDetails",requires_proof as "requiresProof" from advertising_payment_methods where active=true order by sort_order,name`);
  app.get("/v1/public/advertising/active", async (request, reply) => { try {
    const query=publicCampaignQuerySchema.parse(request.query);
    const campaigns=await database()`select banner.id::text,banner.title,banner.advertiser_name as "advertiserName",banner.action_type as "actionType",banner.action_value as "actionValue",case when banner.action_type='WEB' then banner.action_value else null end as "targetUrl",banner.placement,banner.starts_at as "startsAt",banner.ends_at as "endsAt",coalesce(banner.weight,plan.default_weight,1)::int as weight,banner.updated_at as "updatedAt",'/v1/banners/'||banner.id||'/image' as "imageUrl" from affiliate_banners banner left join advertising_plans plan on plan.id=banner.advertising_plan_id where banner.active=true and banner.campaign_status='ACTIVE' and banner.starts_at<=now() and (banner.ends_at is null or banner.ends_at>now()) and (${query.serviceAreaId??null}::uuid is null or banner.service_area_id is null or banner.service_area_id=${query.serviceAreaId??null}) and (${query.placement}=banner.placement or ${query.placement}=any(coalesce(plan.allowed_placements,array[banner.placement]))) order by banner.sort_order,banner.starts_at desc limit (select advertising_max_active_per_zone from operational_settings where id=1)`;
    return {campaigns};
  } catch(error){ return publicError(error,reply); } });
  app.post("/v1/public/advertising/events", async (request, reply) => { try {
    const value=publicEventSchema.parse(request.body);
    await database()`insert into advertising_events(campaign_id,event_type,exhibition_id,session_key_hash,placement,service_area_id,action_type,platform) select ${value.campaignId},${value.eventType},${value.exhibitionId},encode(digest(${value.sessionKey},'sha256'),'hex'),${value.placement},${value.serviceAreaId??null},${value.actionType??null},${value.platform} where exists(select 1 from affiliate_banners where id=${value.campaignId} and active=true and campaign_status='ACTIVE') on conflict(campaign_id,event_type,exhibition_id) do nothing`;
    return reply.code(202).send({accepted:true});
  } catch(error){ return publicError(error,reply); } });
  app.post("/v1/public/advertising/leads", async (request, reply) => { try {
    if (!allowLead(request)) return reply.code(429).send({ error: "TOO_MANY_REQUESTS" });
    const body = leadSchema.parse({ ...(request.body as object), source: cleanSource((request.body as any)?.source) });
    const [lead] = await database()`insert into advertising_leads(code,business_name,contact_name,phone_e164,email,city,business_type,interest,source,status,conversation_state)
      values ('LEAD-'||extract(year from now())::int||'-'||lpad(nextval('advertising_lead_code_seq')::text,6,'0'),${body.businessName},${body.contactName},${body.phone},lower(${body.email}),${body.city},${body.businessType},${body.interest},${body.source},${body.requiresContact ? "REQUIRES_CONTACT" : "NEW"},${JSON.stringify(body.conversationState)}::jsonb)
      returning id::text,code,status,email,business_name as "businessName"`;
    if (!lead) throw new Error("LEAD_NOT_CREATED");
    await publicAudit("ADVERTISING_LEAD_CREATED","ADVERTISING_LEAD",String(lead.id),body.source);
    const invitation = await createInvitation(String(lead.id), body.source);
    void sendTransactionalEmail({ to: body.email, subject: `Continúa tu solicitud comercial ${lead.code} · Costa-Go`, text: `Hola ${body.contactName}. Continúa tu solicitud para ${body.businessName}: ${invitation.url}`, html: `<p>Hola <strong>${body.contactName}</strong>.</p><p>Continúa la solicitud publicitaria de <strong>${body.businessName}</strong>:</p><p><a href="${invitation.url}">Continuar solicitud</a></p><p>El enlace vence en ${new Date(String(invitation.expiresAt)).toLocaleDateString("es-EC")}.</p>` }).catch(() => false);
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
    await database()`update advertising_invitations set draft_data=draft_data||${serialized}::jsonb,status='IN_PROGRESS',updated_at=now() where id=${invitation.id}`;
    await publicAudit("ADVERTISING_APPLICATION_SAVED","ADVERTISING_INVITATION",String(invitation.id),`Paso ${draft.step??"actualizado"}`);
    return { saved: true, status: "IN_PROGRESS" };
  } catch (error) { return publicError(error, reply); } });
  app.post("/v1/public/advertising/invitations/:token/submit", async (request, reply) => { try {
    const token = z.string().min(32).max(200).parse((request.params as any).token); const invitation = await invitationFor(token); if (invitation.status === "SUBMITTED") throw new Error("INVITATION_LOCKED");
    if(invitation.purpose==="CORRECTION"){
      const correction=correctionSubmitSchema.parse(request.body),image=decodeBase64(correction.campaign.imageBase64),dimensions=imageDimensions(image,correction.campaign.imageMime);
      const [settings]=await database()`select advertising_max_image_bytes as bytes,advertising_banner_width as width,advertising_banner_height as height from operational_settings where id=1`;
      if(!invitation.campaign_id)throw new Error("CAMPAIGN_NOT_FOUND");
      if(!dimensions||image.length>Number(settings?.bytes??1_048_576)||dimensions.width!==Number(settings?.width??1200)||dimensions.height!==Number(settings?.height??400))return reply.code(400).send({error:"INVALID_BANNER_IMAGE",message:`El banner debe medir ${settings?.width??1200}×${settings?.height??400} px.`});
      const result=await database().begin(async tx=>{const [campaign]=await tx`update affiliate_banners set image_mime=${correction.campaign.imageMime},image_data=${image},campaign_status='PENDING_REVIEW',active=false,correction_note=null,review_requested_at=now(),updated_at=now() where id=${invitation.campaign_id} returning id::text,order_id`;if(!campaign)throw new Error("CAMPAIGN_NOT_FOUND");await tx`insert into campaign_status_history(campaign_id,from_status,to_status,note) values (${campaign.id},'PENDING_REVIEW','PENDING_REVIEW','Banner corregido y reenviado')`;await tx`update advertising_invitations set status='SUBMITTED',submitted_at=now(),draft_data=${JSON.stringify({campaign:{imageMime:correction.campaign.imageMime},corrected:true})}::jsonb,updated_at=now() where id=${invitation.id}`;const [order]=await tx`select code from advertising_orders where id=${campaign.order_id}`;return {orderCode:order?.code??invitation.lead_code,campaignId:campaign.id,status:"PENDING_REVIEW"};});
      await publicAudit("ADVERTISING_CORRECTION_SUBMITTED","AFFILIATE_BANNER",String(result.campaignId),"Pieza reenviada");
      return reply.code(201).send(result);
    }
    const body = submitSchema.parse(request.body), image = decodeBase64(body.campaign.imageBase64), dimensions = imageDimensions(image, body.campaign.imageMime);
    const [settings] = await database()`select advertising_max_image_bytes as bytes,advertising_banner_width as width,advertising_banner_height as height from operational_settings where id=1`;
    if (!dimensions || image.length > Number(settings?.bytes ?? 1_048_576) || dimensions.width !== Number(settings?.width ?? 1200) || dimensions.height !== Number(settings?.height ?? 400)) return reply.code(400).send({ error: "INVALID_BANNER_IMAGE", message: `El banner debe medir ${settings?.width ?? 1200}×${settings?.height ?? 400} px.` });
    const result = await database().begin(async tx => {
      const [plan] = await tx`select * from advertising_plans where id=${body.planId} and enabled=true and active=true for share`; if (!plan) throw new Error("PLAN_NOT_FOUND");
      const [method] = await tx`select * from advertising_payment_methods where id=${body.paymentMethodId} and active=true`; if (!method) throw new Error("PAYMENT_METHOD_NOT_FOUND");
      const [advertiser] = await tx`insert into advertisers(business_name,contact_name,phone_e164,email,city,business_type,status,assigned_commercial_id)
        values (${body.business.businessName},${body.business.contactName},${body.business.phone},lower(${body.business.email}),${body.business.city},${body.business.businessType},'PROSPECT',${invitation.created_by})
        on conflict(lower(email),lower(business_name)) do update set contact_name=excluded.contact_name,phone_e164=excluded.phone_e164,city=excluded.city,business_type=excluded.business_type,updated_at=now() returning id::text`;
      if (!advertiser) throw new Error("ADVERTISER_NOT_CREATED");
      const amount = Number(plan.price ?? plan.monthly_price ?? 0), duration = Number(plan.duration_days ?? 30), start = new Date(body.campaign.startsAt), end = new Date(start.getTime() + duration * 86_400_000), campaignPlacement = normalizeAdvertisingPlacement(plan.placement ?? plan.allowed_placements?.[0]);
      const [order] = await tx`insert into advertising_orders(code,lead_id,advertiser_id,plan_id,assigned_commercial_id,status,amount,currency,plan_snapshot,requested_start_at,requested_end_at)
        values ('PUB-'||extract(year from now())::int||'-'||lpad(nextval('advertising_request_code_seq')::text,6,'0'),${invitation.lead_id},${advertiser.id},${plan.id},${invitation.created_by},'PENDING_PAYMENT',${amount},${plan.currency},${JSON.stringify({ code: plan.code, name: plan.name, durationDays: duration, price: amount })}::jsonb,${start.toISOString()},${end.toISOString()}) returning id::text,code`;
      if (!order) throw new Error("ORDER_NOT_CREATED");
      let paymentStatus = method.requires_proof ? "PENDING" : "UNDER_REVIEW"; let proof: Buffer | null = null;
      if (body.proof) { proof = decodeBase64(body.proof.fileBase64); if (!validProof(proof, body.proof.fileMime)) throw new Error("INVALID_PAYMENT_PROOF"); paymentStatus = "UNDER_REVIEW"; }
      await tx`insert into advertising_payments(order_id,advertiser_id,amount,currency,payment_method_id,proof_mime,proof_data,reference,status)
        values (${order.id},${advertiser.id},${amount},${plan.currency},${method.id},${body.proof?.fileMime ?? null},${proof},${body.proof?.reference ?? null},${paymentStatus})`;
      const [campaign] = await tx`insert into affiliate_banners(title,advertiser_id,advertiser_name,advertising_plan_id,service_area_id,placement,weight,action_type,action_value,image_mime,image_data,target_url,starts_at,ends_at,active,campaign_status,sort_order,order_id,submitted_at,review_requested_at)
        values (${body.campaign.title},${advertiser.id},${body.business.businessName},${plan.id},${body.campaign.serviceAreaId ?? null},${campaignPlacement},${plan.default_weight},${body.campaign.actionType},${body.campaign.actionValue || null},${body.campaign.imageMime},${image},${body.campaign.actionType === "WEB" ? body.campaign.actionValue || null : null},${start.toISOString()},${end.toISOString()},false,${paymentStatus === "UNDER_REVIEW" ? "PAYMENT_REVIEW" : "PENDING_PAYMENT"},${plan.sort_order ?? 0},${order.id},now(),now()) returning id::text`;
      if (!campaign) throw new Error("CAMPAIGN_NOT_CREATED");
      await tx`insert into campaign_status_history(campaign_id,to_status,note) values (${campaign.id},${paymentStatus === "UNDER_REVIEW" ? "PAYMENT_REVIEW" : "PENDING_PAYMENT"},'Solicitud enviada por comercio')`;
      const submittedSummary={business:body.business,campaign:{title:body.campaign.title,placement:campaignPlacement,serviceAreaId:body.campaign.serviceAreaId,actionType:body.campaign.actionType,actionValue:body.campaign.actionValue,startsAt:body.campaign.startsAt,imageMime:body.campaign.imageMime},planId:body.planId,paymentMethodId:body.paymentMethodId,orderCode:order.code};
      await tx`update advertising_invitations set status='SUBMITTED',submitted_at=now(),advertiser_id=${advertiser.id},draft_data=${JSON.stringify(submittedSummary)}::jsonb,updated_at=now() where id=${invitation.id}`;
      await tx`update advertising_leads set status='QUALIFIED',advertiser_id=${advertiser.id},updated_at=now() where id=${invitation.lead_id}`;
      return { orderCode: order.code, campaignId: campaign.id, status: paymentStatus === "UNDER_REVIEW" ? "PAYMENT_REVIEW" : "PENDING_PAYMENT" };
    });
    await publicAudit("ADVERTISING_APPLICATION_SUBMITTED","AFFILIATE_BANNER",String(result.campaignId),String(result.orderCode));
    return reply.code(201).send(result);
  } catch (error) { return publicError(error, reply); } });

  app.get("/v1/admin/commercial/dashboard", async (request, reply) => { try { const actor = requirePermission(request, "commercial:dashboard"), actorId=actor.id ?? null, own = actor.role === "COMMERCIAL";
    const [row] = await database()`select
      (select count(*)::int from advertising_leads l where l.status='NEW' and (not ${own} or l.assigned_commercial_id is null or l.assigned_commercial_id=${actorId})) as "newLeads",
      (select count(*)::int from advertising_leads l where l.status='REQUIRES_CONTACT' and (not ${own} or l.assigned_commercial_id is null or l.assigned_commercial_id=${actorId})) as "requiresContact",
      (select count(*)::int from advertising_orders o where o.status in ('DRAFT','PENDING_PAYMENT','PAYMENT_REVIEW') and (not ${own} or o.assigned_commercial_id=${actorId})) as "openOrders",
      (select count(*)::int from affiliate_banners b left join advertising_orders o on o.id=b.order_id where b.campaign_status in ('PENDING_REVIEW','PAYMENT_REVIEW') and (not ${own} or o.assigned_commercial_id=${actorId})) as "pendingCampaigns",
      (select count(*)::int from affiliate_banners b left join advertising_orders o on o.id=b.order_id where b.campaign_status='ACTIVE' and (not ${own} or o.assigned_commercial_id=${actorId})) as "activeCampaigns",
      (select coalesce(sum(o.amount),0)::float8 from advertising_orders o where o.status='PAID' and date_trunc('month',o.updated_at)=date_trunc('month',now()) and (not ${own} or o.assigned_commercial_id=${actorId})) as "monthlySales",
      (select count(*)::int from advertisers a where a.status='ACTIVE' and (not ${own} or a.assigned_commercial_id=${actorId})) as "activeAdvertisers"`;
    return row;
  } catch (error) { return adminError(error, reply); } });
  app.get("/v1/admin/commercial/leads", async (request, reply) => { try { const actor=requirePermission(request,"commercial:leads:view"),q=listSchema.parse(request.query),own=actor.role==="COMMERCIAL";
    return database()`select l.id::text,l.code,l.business_name as "businessName",l.contact_name as "contactName",l.phone_e164 as phone,l.email,l.city,l.business_type as "businessType",l.interest,l.source,l.status,l.assigned_commercial_id::text as "assignedCommercialId",u.full_name as "assignedCommercial",l.created_at as "createdAt",l.updated_at as "updatedAt" from advertising_leads l left join users u on u.id=l.assigned_commercial_id where (not ${own} or l.assigned_commercial_id is null or l.assigned_commercial_id=${actor.id} or l.created_by=${actor.id}) and (${q.status ?? null}::text is null or l.status=${q.status ?? null}) and (${q.source ?? null}::text is null or l.source=${q.source ?? null}) and (${q.search ?? null}::text is null or l.business_name ilike ${q.search ? `%${q.search}%` : null} or l.contact_name ilike ${q.search ? `%${q.search}%` : null} or l.email ilike ${q.search ? `%${q.search}%` : null}) order by l.created_at desc limit ${q.limit} offset ${q.offset}`;
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
  app.post("/v1/admin/commercial/leads/:id/claim",async(request,reply)=>{try{const actor=requirePermission(request,"commercial:leads:manage"),id=z.string().uuid().parse((request.params as any).id);const [item]=await database()`update advertising_leads set assigned_commercial_id=${actor.id},status=case when status='NEW' then 'IN_PROGRESS' else status end,updated_at=now() where id=${id} and (assigned_commercial_id is null or assigned_commercial_id=${actor.id} or ${actor.role!=="COMMERCIAL"}) returning id::text,code,status`;if(!item)return reply.code(409).send({error:"LEAD_ALREADY_ASSIGNED"});await persistAudit(actor,"ADVERTISING_LEAD_CLAIMED","ADVERTISING_LEAD",id,"Prospecto asignado");return item;}catch(error){return adminError(error,reply);} });
  app.post("/v1/admin/commercial/invitations",async(request,reply)=>{try{const actor=requirePermission(request,"commercial:leads:manage"),body=inviteSchema.parse(request.body),own=actor.role==="COMMERCIAL";
    const [lead]=await database()`select id::text,contact_name,email,business_name,assigned_commercial_id::text as assigned_commercial_id from advertising_leads where id=${body.leadId} and (not ${own} or assigned_commercial_id is null or assigned_commercial_id=${actor.id} or created_by=${actor.id})`;
    if(!lead)throw new Error("LEAD_NOT_FOUND");
    if(own&&lead.assigned_commercial_id===null)await database()`update advertising_leads set assigned_commercial_id=${actor.id},status=case when status='NEW' then 'IN_PROGRESS' else status end,updated_at=now() where id=${body.leadId} and assigned_commercial_id is null`;
    const invitation=await createInvitation(body.leadId,"COMMERCIAL",actor.id,body.purpose,body.correctionFields,body.campaignId);
    void sendTransactionalEmail({to:String(lead.email),subject:`Invitación comercial Costa-Go`,text:`Continúa la solicitud de ${lead.business_name}: ${invitation.url}`,html:`<p>Hola ${lead.contact_name}.</p><p><a href="${invitation.url}">Continuar solicitud comercial</a></p>`}).catch(()=>false);await persistAudit(actor,"ADVERTISING_INVITATION_CREATED","ADVERTISING_INVITATION",String(invitation.id),body.purpose);return reply.code(201).send(invitation);}catch(error){return adminError(error,reply);} });
  app.get("/v1/admin/commercial/advertisers",async(request,reply)=>{try{const actor=requirePermission(request,"commercial:advertisers:view"),q=listSchema.parse(request.query),own=actor.role==="COMMERCIAL";return database()`select a.id::text,a.business_name as "businessName",a.contact_name as "contactName",a.phone_e164 as phone,a.email,a.city,a.business_type as "businessType",a.status,a.assigned_commercial_id::text as "assignedCommercialId",u.full_name as "assignedCommercial",a.created_at as "createdAt" from advertisers a left join users u on u.id=a.assigned_commercial_id where (not ${own} or a.assigned_commercial_id=${actor.id}) and (${q.status??null}::text is null or a.status=${q.status??null}) and (${q.search??null}::text is null or a.business_name ilike ${q.search?`%${q.search}%`:null} or a.email ilike ${q.search?`%${q.search}%`:null}) order by a.updated_at desc limit ${q.limit} offset ${q.offset}`;}catch(error){return adminError(error,reply);} });
  app.get("/v1/admin/commercial/orders",async(request,reply)=>{try{const actor=requirePermission(request,"commercial:orders:view"),q=listSchema.parse(request.query),own=actor.role==="COMMERCIAL";return database()`select o.id::text,o.code,o.status,o.amount::float8,o.currency,o.requested_start_at as "requestedStartAt",o.requested_end_at as "requestedEndAt",o.created_at as "createdAt",a.business_name as "businessName",p.name as "planName",u.full_name as "assignedCommercial" from advertising_orders o join advertisers a on a.id=o.advertiser_id join advertising_plans p on p.id=o.plan_id left join users u on u.id=o.assigned_commercial_id where (not ${own} or o.assigned_commercial_id=${actor.id}) and (${q.status??null}::text is null or o.status=${q.status??null}) order by o.created_at desc limit ${q.limit} offset ${q.offset}`;}catch(error){return adminError(error,reply);} });
  app.get("/v1/admin/commercial/payments",async(request,reply)=>{try{const actor=requirePermission(request,"commercial:payments:view"),q=listSchema.parse(request.query),own=actor.role==="COMMERCIAL";return database()`select pay.id::text,pay.status,pay.amount::float8,pay.currency,pay.reference,pay.proof_mime as "proofMime",pay.created_at as "createdAt",o.code as "orderCode",a.business_name as "businessName",m.name as "paymentMethod" from advertising_payments pay join advertising_orders o on o.id=pay.order_id join advertisers a on a.id=pay.advertiser_id join advertising_payment_methods m on m.id=pay.payment_method_id where (not ${own} or o.assigned_commercial_id=${actor.id}) and (${q.status??null}::text is null or pay.status=${q.status??null}) order by pay.created_at desc limit ${q.limit} offset ${q.offset}`;}catch(error){return adminError(error,reply);} });
  app.get("/v1/admin/commercial/payments/:id/proof",async(request,reply)=>{try{const actor=requirePermission(request,"commercial:payments:view"),own=actor.role==="COMMERCIAL";const id=z.string().uuid().parse((request.params as any).id);const [file]=await database()`select pay.proof_mime,pay.proof_data from advertising_payments pay join advertising_orders o on o.id=pay.order_id where pay.id=${id} and (not ${own} or o.assigned_commercial_id=${actor.id})`;if(!file?.proof_data)throw new Error("PAYMENT_PROOF_NOT_FOUND");return reply.header("content-type",String(file.proof_mime)).header("cache-control","private, no-store").send(file.proof_data);}catch(error){return adminError(error,reply);} });
  app.post("/v1/admin/commercial/payments/:id/review",async(request,reply)=>{try{const actor=requirePermission(request,"commercial:payments:review"),id=z.string().uuid().parse((request.params as any).id),body=paymentReviewSchema.parse(request.body);if(body.decision==="REJECT"&&body.reason.length<5)return reply.code(400).send({error:"REASON_REQUIRED"});const result=await database().begin(async tx=>{const [pay]=await tx`select pay.*,o.id as order_id,o.advertiser_id,o.lead_id from advertising_payments pay join advertising_orders o on o.id=pay.order_id where pay.id=${id} for update`;if(!pay)throw new Error("PAYMENT_NOT_FOUND");if(body.decision!=="REFUND"&&!['PENDING','UNDER_REVIEW','REJECTED'].includes(String(pay.status)))throw new Error("PAYMENT_ALREADY_REVIEWED");if(body.decision==="REFUND"&&pay.status!=="APPROVED")throw new Error("PAYMENT_NOT_REFUNDABLE");const status=body.decision==="APPROVE"?"APPROVED":body.decision==="REJECT"?"REJECTED":"REFUNDED";await tx`update advertising_payments set status=${status},reviewed_by=${actor.id},reviewed_at=now(),rejection_reason=${body.reason||null},updated_at=now() where id=${id}`;const orderStatus=status==="APPROVED"?"PAID":status==="REFUNDED"?"REFUNDED":"PENDING_PAYMENT";await tx`update advertising_orders set status=${orderStatus},updated_at=now() where id=${pay.order_id}`;if(status==="APPROVED")await tx`update advertisers set status='ACTIVE',updated_at=now() where id=${pay.advertiser_id}`;let convertedLeadId:string|undefined;if(status==="APPROVED"&&pay.lead_id){const [converted]=await tx`update advertising_leads set status='CONVERTED',updated_at=now() where id=${pay.lead_id} and status<>'CONVERTED' returning id::text`;convertedLeadId=converted?.id;}const [campaign]=await tx`update affiliate_banners set campaign_status=${status==="APPROVED"?"PENDING_REVIEW":"PENDING_PAYMENT"},review_requested_at=case when ${status}='APPROVED' then now() else review_requested_at end,updated_at=now() where order_id=${pay.order_id} returning id::text`;return {status,campaignId:campaign?.id,convertedLeadId};});if(result.campaignId)await database()`insert into campaign_status_history(campaign_id,from_status,to_status,note,changed_by) values (${result.campaignId},'PAYMENT_REVIEW',${result.status==="APPROVED"?"PENDING_REVIEW":"PENDING_PAYMENT"},${body.reason||"Pago revisado"},${actor.id})`;if(result.convertedLeadId)await persistAudit(actor,"ADVERTISING_LEAD_CONVERTED","ADVERTISING_LEAD",result.convertedLeadId,"Conversión automática por primer pago aprobado");await persistAudit(actor,"ADVERTISING_PAYMENT_REVIEWED","ADVERTISING_PAYMENT",id,`${body.decision}: ${body.reason}`);return result;}catch(error){return adminError(error,reply);} });
  app.get("/v1/admin/commercial/campaigns",async(request,reply)=>{try{const actor=requirePermission(request,"commercial:campaigns:view"),q=listSchema.parse(request.query),own=actor.role==="COMMERCIAL";return database()`select b.id::text,b.title,b.advertiser_name as "advertiserName",b.placement,b.campaign_status as status,b.starts_at as "startsAt",b.ends_at as "endsAt",b.active,b.rejection_reason as "rejectionReason",b.correction_note as "correctionNote",o.code as "orderCode",coalesce((select count(*) from advertising_events e where e.campaign_id=b.id and e.event_type='IMPRESSION'),0)::int as impressions,coalesce((select count(*) from advertising_events e where e.campaign_id=b.id and e.event_type in ('CLICK','ACTION')),0)::int as clicks from affiliate_banners b left join advertising_orders o on o.id=b.order_id where (not ${own} or o.assigned_commercial_id=${actor.id}) and (${q.status??null}::text is null or b.campaign_status=${q.status??null}) order by b.created_at desc limit ${q.limit} offset ${q.offset}`;}catch(error){return adminError(error,reply);} });
  app.post("/v1/admin/commercial/campaigns/:id/action",async(request,reply)=>{try{const body=campaignActionSchema.parse(request.body),reviewAction=["APPROVE","REJECT","REQUEST_CORRECTION"].includes(body.action),actor=requirePermission(request,reviewAction?"commercial:campaigns:review":"commercial:campaigns:manage"),own=actor.role==="COMMERCIAL",id=z.string().uuid().parse((request.params as any).id);if(["REJECT","REQUEST_CORRECTION"].includes(body.action)&&body.note.length<5)return reply.code(400).send({error:"NOTE_REQUIRED"});const [campaign]=await database()`select b.starts_at,b.ends_at,b.campaign_status from affiliate_banners b left join advertising_orders o on o.id=b.order_id where b.id=${id} and (not ${own} or o.assigned_commercial_id=${actor.id})`;if(!campaign)throw new Error("CAMPAIGN_NOT_FOUND");const allowed:Record<string,string[]>={APPROVE:["PENDING_REVIEW"],REJECT:["PENDING_REVIEW"],REQUEST_CORRECTION:["PENDING_REVIEW"],PAUSE:["ACTIVE","SCHEDULED"],RESUME:["PAUSED"],CANCEL:["DRAFT","PENDING_PAYMENT","PAYMENT_REVIEW","PENDING_REVIEW","SCHEDULED","ACTIVE","PAUSED","REJECTED"]};if(!allowed[body.action]?.includes(String(campaign.campaign_status)))return reply.code(409).send({error:"INVALID_CAMPAIGN_TRANSITION"});let to:string;if(body.action==="APPROVE")to=new Date(String(campaign.starts_at))>new Date()?"SCHEDULED":"ACTIVE";else to={REJECT:"REJECTED",REQUEST_CORRECTION:"PENDING_REVIEW",PAUSE:"PAUSED",RESUME:new Date(String(campaign.starts_at))>new Date()?"SCHEDULED":"ACTIVE",CANCEL:"CANCELLED"}[body.action]!;await transitionCampaign(id,to,actor,body.note);if(body.action==="REQUEST_CORRECTION"){const [lead]=await database()`select o.lead_id::text as id from affiliate_banners b join advertising_orders o on o.id=b.order_id where b.id=${id}`;if(lead?.id){const invitation=await createInvitation(String(lead.id),"ADMIN",actor.id,"CORRECTION",["campaign.image"],id);const [recipient]=await database()`select contact_name,email from advertising_leads where id=${lead.id}`;if(recipient)void sendTransactionalEmail({to:String(recipient.email),subject:"Corrección solicitada para tu campaña · Costa-Go",text:`Costa-Go solicitó una corrección: ${body.note}. ${invitation.url}`,html:`<p>Hola ${recipient.contact_name}.</p><p>Necesitamos una corrección en tu campaña:</p><p><strong>${body.note}</strong></p><p><a href="${invitation.url}">Corregir banner</a></p>`}).catch(()=>false);}}return {id,status:to};}catch(error){return adminError(error,reply);} });
  app.get("/v1/admin/commercial/plans",async(request,reply)=>{try{requirePermission(request,"commercial:campaigns:view");return database()`select id::text,code,name,description,placement,duration_days as "durationDays",price::float8,currency,default_weight as "defaultWeight",allowed_placements as "allowedPlacements",active,enabled,sort_order as "sortOrder",updated_at as "updatedAt" from advertising_plans order by sort_order,name`;}catch(error){return adminError(error,reply);} });
  app.post("/v1/admin/commercial/plans",async(request,reply)=>{try{const actor=requirePermission(request,"commercial:plans:manage"),body=planSchema.parse(request.body);const [item]=await database()`insert into advertising_plans(code,name,description,placement,duration_days,price,monthly_price,currency,default_weight,allowed_placements,active,enabled,sort_order,created_by,updated_by) values (${body.code},${body.name},${body.description},${body.placement},${body.durationDays},${body.price},${body.price},${body.currency.toUpperCase()},${body.defaultWeight},${body.allowedPlacements},${body.active},${body.active},${body.sortOrder},${actor.id},${actor.id}) returning id::text,code,name`;await persistAudit(actor,"ADVERTISING_PLAN_CREATED","ADVERTISING_PLAN",String(item.id),body.name);return reply.code(201).send(item);}catch(error){return adminError(error,reply);} });
  app.patch("/v1/admin/commercial/plans/:id",async(request,reply)=>{try{const actor=requirePermission(request,"commercial:plans:manage"),id=z.string().uuid().parse((request.params as any).id),body=planSchema.partial().parse(request.body);const [current]=await database()`select * from advertising_plans where id=${id}`;if(!current)throw new Error("PLAN_NOT_FOUND");const [item]=await database()`update advertising_plans set name=${body.name??current.name},description=${body.description??current.description},placement=${body.placement??current.placement},duration_days=${body.durationDays??current.duration_days},price=${body.price??current.price},monthly_price=${body.price??current.monthly_price},currency=${body.currency?.toUpperCase()??current.currency},default_weight=${body.defaultWeight??current.default_weight},allowed_placements=${body.allowedPlacements??current.allowed_placements},active=${body.active??current.active},enabled=${body.active??current.enabled},sort_order=${body.sortOrder??current.sort_order},updated_by=${actor.id},updated_at=now() where id=${id} returning id::text,code,name,active`;await persistAudit(actor,"ADVERTISING_PLAN_UPDATED","ADVERTISING_PLAN",id,String(item.name));return item;}catch(error){return adminError(error,reply);} });
  app.get("/v1/admin/commercial/settings",async(request,reply)=>{try{requirePermission(request,"commercial:plans:manage");const [settings]=await database()`select advertising_invitation_days as "invitationDays",advertising_max_image_bytes as "maxImageBytes",advertising_banner_width as "bannerWidth",advertising_banner_height as "bannerHeight",advertising_max_active_per_zone as "maxActivePerZone",advertising_commercial_emails as "commercialEmails" from operational_settings where id=1`;const methods=await database()`select id::text,code,name,instructions,active,requires_proof as "requiresProof",sort_order as "sortOrder" from advertising_payment_methods order by sort_order,name`;return {...settings,paymentMethods:methods};}catch(error){return adminError(error,reply);} });
  app.patch("/v1/admin/commercial/settings",async(request,reply)=>{try{const actor=requirePermission(request,"commercial:plans:manage"),body=commercialSettingsSchema.parse(request.body);const [settings]=await database()`update operational_settings set advertising_invitation_days=${body.invitationDays},advertising_max_image_bytes=${body.maxImageBytes},advertising_banner_width=${body.bannerWidth},advertising_banner_height=${body.bannerHeight},advertising_max_active_per_zone=${body.maxActivePerZone},advertising_commercial_emails=${body.commercialEmails},updated_at=now(),updated_by=${actor.id} where id=1 returning advertising_invitation_days as "invitationDays",advertising_max_image_bytes as "maxImageBytes",advertising_banner_width as "bannerWidth",advertising_banner_height as "bannerHeight",advertising_max_active_per_zone as "maxActivePerZone",advertising_commercial_emails as "commercialEmails"`;await persistAudit(actor,"ADVERTISING_SETTINGS_UPDATED","OPERATIONAL_SETTINGS","1","Configuración comercial actualizada");return settings;}catch(error){return adminError(error,reply);} });
  app.patch("/v1/admin/commercial/payment-methods/:id",async(request,reply)=>{try{const actor=requirePermission(request,"commercial:plans:manage"),id=z.string().uuid().parse((request.params as any).id),body=paymentMethodSchema.parse(request.body);const [method]=await database()`update advertising_payment_methods set name=${body.name},instructions=${body.instructions},active=${body.active},requires_proof=${body.requiresProof},sort_order=${body.sortOrder},updated_at=now() where id=${id} returning id::text,code,name,active,requires_proof as "requiresProof",sort_order as "sortOrder"`;if(!method)throw new Error("PAYMENT_METHOD_NOT_FOUND");await persistAudit(actor,"ADVERTISING_PAYMENT_METHOD_UPDATED","ADVERTISING_PAYMENT_METHOD",id,body.name);return method;}catch(error){return adminError(error,reply);} });
}
