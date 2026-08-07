import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { userFrom, type SessionUser } from "./admin.js";
import { database } from "./database.js";

const categories = ["CONTACT", "TRIP", "LOST_ITEM", "PAYMENT", "SAFETY", "APP", "OTHER"] as const;
const priorities = ["BAJA", "MEDIA", "ALTA", "CRITICA"] as const;
const contacts = ["APP", "TELEFONO", "WHATSAPP", "CORREO"] as const;
const attachmentSchema = z.object({
  fileName: z.string().trim().min(1).max(120),
  fileMime: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
  fileBase64: z.string().min(20).max(3_400_000)
});
const createIncidentSchema = z.object({
  category: z.enum(categories),
  tripId: z.string().uuid().nullable().optional(),
  subject: z.string().trim().min(5).max(140),
  description: z.string().trim().min(10).max(4000),
  priority: z.enum(priorities).default("MEDIA"),
  preferredContact: z.enum(contacts).default("APP"),
  attachments: z.array(attachmentSchema).max(2).default([])
});
const userMessageSchema = z.object({ body: z.string().trim().min(1).max(4000) });

type AuthenticatedSupportUser = SessionUser & { id: string; sessionId: string };

async function supportUser(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<AuthenticatedSupportUser | undefined> {
  const user = userFrom(request);
  if (!user?.id || !user.sessionId) {
    reply.code(401).send({ error: "UNAUTHORIZED" });
    return;
  }
  const [active] = await database()`
    select must_change_password as "mustChangePassword"
    from users where id=${user.id} and active_session_id=${user.sessionId}::uuid
  `;
  if (!active) {
    reply.code(401).send({ error: "SESSION_REPLACED" });
    return;
  }
  if (active.mustChangePassword) {
    reply.code(428).send({ error: "PASSWORD_CHANGE_REQUIRED" });
    return;
  }
  return { ...user, id: user.id, sessionId: user.sessionId };
}

function decodeAttachment(input: z.infer<typeof attachmentSchema>): Buffer {
  const data = Buffer.from(input.fileBase64, "base64");
  const jpeg = data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const png = data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP";
  const pdf = data.length >= 5 && data.subarray(0, 5).toString("ascii") === "%PDF-";
  const valid = input.fileMime === "image/jpeg" ? jpeg : input.fileMime === "image/png" ? png : input.fileMime === "image/webp" ? webp : pdf;
  if (!valid || data.length > 2_500_000) throw new Error("INVALID_SUPPORT_ATTACHMENT");
  return data;
}

export async function registerSupportRoutes(app: FastifyInstance) {
  app.get("/v1/support/config", async (request, reply) => {
    const user = await supportUser(request, reply); if (!user) return;
    return { whatsapp: process.env.SUPPORT_WHATSAPP ?? "" };
  });

  app.get("/v1/support/faqs", async (request, reply) => {
    const user = await supportUser(request, reply); if (!user) return;
    return database()`
      select id::text, category, question, answer, sort_order as "sortOrder"
      from support_faqs where active=true and ${user.role}=any(audiences)
      order by sort_order, category, question
    `;
  });

  app.get("/v1/support/incidents", async (request, reply) => {
    const user = await supportUser(request, reply); if (!user) return;
    return database()`
      select i.id::text, i.trip_id::text as "tripId", i.category, i.subject,
        i.description, i.priority, i.preferred_contact as "preferredContact",
        i.status, i.created_at as "createdAt", i.updated_at as "updatedAt",
        (select count(*)::int from support_incident_messages m
          where m.incident_id=i.id and m.visibility='USER') as "messageCount"
      from incidents i where i.reported_by=${user.id}
      order by i.updated_at desc
    `;
  });

  app.post("/v1/support/incidents", async (request, reply) => {
    const user = await supportUser(request, reply); if (!user) return;
    const parsed = createIncidentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_SUPPORT_REQUEST", details: parsed.error.issues });
    try {
      const body = parsed.data;
      const files = body.attachments.map(item => ({ input: item, data: decodeAttachment(item) }));
      const incident = await database().begin(async sql => {
        let trip: Record<string, unknown> | undefined;
        if (body.tripId) {
          [trip] = await sql`
            select id, passenger_id, driver_id, cooperative_id
            from trips where id=${body.tripId}::uuid
              and (passenger_id=${user.id} or driver_id=${user.id})
          `;
          if (!trip) throw new Error("TRIP_NOT_ACCESSIBLE");
        }
        const relatedUserValue = trip
          ? (String(trip.passenger_id) === user.id ? trip.driver_id : trip.passenger_id)
          : null;
        const relatedUserId = relatedUserValue ? String(relatedUserValue) : null;
        const cooperativeId = trip?.cooperative_id ? String(trip.cooperative_id) : null;
        const [created] = await sql`
          insert into incidents (trip_id,reported_by,related_user_id,cooperative_id,category,
            subject,description,priority,preferred_contact,status)
          values (${body.tripId ?? null},${user.id},${relatedUserId},${cooperativeId},
            ${body.category},${body.subject},${body.description},${body.priority},${body.preferredContact},'NUEVO')
          returning id::text, status, created_at as "createdAt"
        `;
        await sql`
          insert into support_incident_messages (incident_id,author_id,author_role,body,visibility)
          values (${created!.id},${user.id},${user.role},${body.description},'USER')
        `;
        for (const file of files) {
          await sql`
            insert into support_incident_attachments
              (incident_id,uploaded_by,file_name,file_mime,file_size,file_data,visibility)
            values (${created!.id},${user.id},${file.input.fileName},${file.input.fileMime},
              ${file.data.length},${file.data},'USER')
          `;
        }
        await sql`
          insert into admin_notifications(type,title,body,entity_type,entity_id)
          values ('SUPPORT_REQUEST','Nueva solicitud de soporte',${body.subject},'INCIDENT',${created!.id})
        `;
        return created!;
      });
      return reply.code(201).send(incident);
    } catch (error) {
      const message = error instanceof Error ? error.message : "ERROR";
      if (["INVALID_SUPPORT_ATTACHMENT", "TRIP_NOT_ACCESSIBLE"].includes(message)) return reply.code(400).send({ error: message });
      throw error;
    }
  });

  app.get("/v1/support/incidents/:id", async (request, reply) => {
    const user = await supportUser(request, reply); if (!user) return;
    const id = (request.params as { id: string }).id;
    const [incident] = await database()`
      select i.id::text, i.trip_id::text as "tripId", i.category, i.subject,
        i.description, i.priority, i.preferred_contact as "preferredContact",
        i.status, i.resolution_note as "resolutionNote", i.created_at as "createdAt",
        i.updated_at as "updatedAt"
      from incidents i where i.id=${id}::uuid and i.reported_by=${user.id}
    `;
    if (!incident) return reply.code(404).send({ error: "SUPPORT_REQUEST_NOT_FOUND" });
    const [messages, attachments] = await Promise.all([
      database()`
        select m.id::text,m.body,m.author_role as "authorRole",m.created_at as "createdAt",
          coalesce(u.full_name,'Equipo de soporte') author
        from support_incident_messages m left join users u on u.id=m.author_id
        where m.incident_id=${id}::uuid and m.visibility='USER' order by m.created_at
      `,
      database()`
        select id::text,file_name as "fileName",file_mime as "fileMime",file_size as "fileSize",created_at as "createdAt"
        from support_incident_attachments where incident_id=${id}::uuid and visibility='USER' order by created_at
      `
    ]);
    return { ...incident, messages, attachments };
  });

  app.post("/v1/support/incidents/:id/messages", async (request, reply) => {
    const user = await supportUser(request, reply); if (!user) return;
    const parsed = userMessageSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_SUPPORT_MESSAGE" });
    const id = (request.params as { id: string }).id;
    const [message] = await database()`
      insert into support_incident_messages(incident_id,author_id,author_role,body,visibility)
      select i.id,${user.id},${user.role},${parsed.data.body},'USER'
      from incidents i where i.id=${id}::uuid and i.reported_by=${user.id}
        and i.status not in ('RESUELTO','CERRADO')
      returning id::text,body,author_role as "authorRole",created_at as "createdAt"
    `;
    if (!message) return reply.code(409).send({ error: "SUPPORT_REQUEST_CLOSED" });
    await database()`update incidents set status=case when status='ESPERANDO_USUARIO' then 'EN_REVISION' else status end,updated_at=now() where id=${id}::uuid`;
    return reply.code(201).send(message);
  });
}
