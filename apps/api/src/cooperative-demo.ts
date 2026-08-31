import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { database } from "./database.js";
import { sendTransactionalEmail } from "./email.js";

export const cooperativeDemoSchema = z.object({
  cooperativeName: z.string().trim().min(3).max(160),
  contactName: z.string().trim().min(3).max(120),
  roleTitle: z.string().trim().min(2).max(100),
  phone: z.string().trim().regex(/^\+?[0-9][0-9\s()-]{7,24}$/),
  email: z.string().trim().email().max(200),
  city: z.string().trim().min(2).max(120),
  unitCount: z.number().int().min(1).max(10_000),
  message: z.string().trim().min(10).max(1500),
  submissionKey: z.string().uuid()
}).strict();

const attempts = new Map<string, number[]>();
function allowed(request: FastifyRequest) {
  const key = request.ip || "unknown";
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter(value => now - value < 15 * 60_000);
  if (recent.length >= 5) return false;
  recent.push(now); attempts.set(key, recent); return true;
}

export async function registerCooperativeDemoRoutes(app: FastifyInstance) {
  app.post("/v1/public/cooperative-demo-requests", async (request, reply) => {
    try {
      const body = cooperativeDemoSchema.parse(request.body);
      const [existing] = await database()`select code,status from cooperative_demo_requests where submission_key=${body.submissionKey}`;
      if (existing) return { requestCode: existing.code, status: existing.status, duplicate: true };
      if (!allowed(request)) return reply.code(429).send({ error: "TOO_MANY_REQUESTS" });
      const [created] = await database()`insert into cooperative_demo_requests(
        code,cooperative_name,contact_name,role_title,phone,email,city,unit_count,message,submission_key
      ) values (
        'COOP-'||extract(year from now())::int||'-'||lpad(nextval('cooperative_demo_code_seq')::text,6,'0'),
        ${body.cooperativeName},${body.contactName},${body.roleTitle},${body.phone},lower(${body.email}),
        ${body.city},${body.unitCount},${body.message},${body.submissionKey}
      ) on conflict(submission_key) do nothing returning id::text,code,status`;
      if (!created) {
        const [duplicate] = await database()`select code,status from cooperative_demo_requests where submission_key=${body.submissionKey}`;
        return { requestCode: duplicate?.code, status: duplicate?.status, duplicate: true };
      }
      const recipient = process.env.COOPERATIVE_DEMO_EMAIL ?? process.env.SUPPORT_EMAIL ?? "soporte@costa-go.com";
      void sendTransactionalEmail({
        to: recipient,
        subject: `Nueva demostración para cooperativa ${created.code} · Costa-Go`,
        text: `${body.cooperativeName} solicita una demostración. Contacto: ${body.contactName}, ${body.roleTitle}, ${body.phone}, ${body.email}. Ciudad: ${body.city}. Unidades: ${body.unitCount}. Mensaje: ${body.message}`
      }).catch(() => false);
      void sendTransactionalEmail({
        to: body.email,
        subject: `Recibimos tu solicitud ${created.code} · Costa-Go`,
        text: `Hola ${body.contactName}. Recibimos la solicitud de demostración para ${body.cooperativeName}. Un asesor se comunicará contigo. Código: ${created.code}.`
      }).catch(() => false);
      return reply.code(201).send({ requestCode: created.code, status: created.status, duplicate: false });
    } catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ error: "INVALID_DEMO_REQUEST" });
      request.log.error({ err: error }, "cooperative_demo_request_failed");
      return reply.code(500).send({ error: "DEMO_REQUEST_FAILED" });
    }
  });
}
