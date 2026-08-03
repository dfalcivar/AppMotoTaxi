import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";

describe("API de cotización", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("responde al control de salud", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
  });

  it("permite preflight CORS para cambios PATCH del panel", async () => {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/admin/drivers/test",
      headers: {
        origin: "https://mototaxi-atacames-admin.onrender.com",
        "access-control-request-method": "PATCH",
        "access-control-request-headers": "authorization,content-type"
      }
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toContain("PATCH");
    expect(response.headers["access-control-allow-headers"]?.toLowerCase()).toContain("authorization");
  });

  it("protege el listado de mototaxis cercanas", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/drivers/nearby?latitude=-2.9&longitude=-79.0"
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: "UNAUTHORIZED" });
  });

  it("protege el historial del chat de un viaje", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/trips/00000000-0000-4000-8000-000000000000/messages"
    });
    expect(response.statusCode).toBe(401);
  });

  it("cotiza la promoción urbana de tres pasajeros", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/quotes",
      payload: { zone: "URBAN", passengers: 3, localTime: "18:30" }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      totalCents: 100,
      appliedRule: "URBAN_DAY_GROUP_PROMOTION"
    });
  });

  it("aplica la noche desde las 20:00", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/quotes",
      payload: { zone: "URBAN", passengers: 3, localTime: "20:00" }
    });
    expect(response.json()).toMatchObject({
      totalCents: 300,
      appliedRule: "NIGHT_PER_PASSENGER"
    });
  });
});
