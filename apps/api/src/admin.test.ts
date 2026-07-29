import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";

describe("consola administrativa", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let supportToken: string;

  beforeAll(async () => {
    app = await buildApp();
    const admin = await app.inject({ method: "POST", url: "/v1/admin/session", payload: { email: "admin@mototaxi.local", password: "Mototaxi2026!" } });
    const support = await app.inject({ method: "POST", url: "/v1/admin/session", payload: { email: "soporte@mototaxi.local", password: "Soporte2026!" } });
    adminToken = admin.json().token;
    supportToken = support.json().token;
  });
  afterAll(async () => app.close());

  it("rechaza credenciales inválidas", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/admin/session", payload: { email: "admin@mototaxi.local", password: "incorrecta" } });
    expect(response.statusCode).toBe(401);
  });

  it("entrega métricas y viajes activos al administrador", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/admin/dashboard", headers: { authorization: `Bearer ${adminToken}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json().metrics.activeTrips).toBeGreaterThan(0);
  });

  it("impide que soporte apruebe conductores", async () => {
    const response = await app.inject({ method: "PATCH", url: "/v1/admin/drivers/DRV-001", headers: { authorization: `Bearer ${supportToken}` }, payload: { status: "ACTIVE", reason: "Aprobación de prueba" } });
    expect(response.statusCode).toBe(403);
  });

  it("permite al administrador aprobar y audita el cambio", async () => {
    const updated = await app.inject({ method: "PATCH", url: "/v1/admin/drivers/DRV-001", headers: { authorization: `Bearer ${adminToken}` }, payload: { status: "ACTIVE", reason: "Documentación completa" } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().status).toBe("ACTIVE");
    const audit = await app.inject({ method: "GET", url: "/v1/admin/audit", headers: { authorization: `Bearer ${adminToken}` } });
    expect(audit.json()).toEqual(expect.arrayContaining([expect.objectContaining({ action: "DRIVER_STATUS", entity: "DRV-001" })]));
  });
});