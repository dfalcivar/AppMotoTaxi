import cors from "@fastify/cors";
import Fastify from "fastify";
import { calculateQuote, initialPricingConfig } from "@mototaxi/domain";
import { z } from "zod";

const quoteSchema = z.object({
  zone: z.enum(["URBAN", "EXTENDED"]),
  passengers: z.number().int().positive(),
  localTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
});

export async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  app.get("/health", async () => ({
    status: "ok",
    service: "mototaxi-atacames-api"
  }));

  app.get("/v1/pricing/config", async () => initialPricingConfig);

  app.post("/v1/quotes", async (request, reply) => {
    const parsed = quoteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "INVALID_QUOTE_REQUEST",
        details: parsed.error.issues
      });
    }

    try {
      return calculateQuote(parsed.data);
    } catch (error) {
      return reply.code(422).send({
        error: "QUOTE_NOT_AVAILABLE",
        message: error instanceof Error ? error.message : "No se pudo cotizar."
      });
    }
  });

  return app;
}
