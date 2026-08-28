import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { imageDimensions, tokenFor } from "./admin.js";

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

  it("protege por backend la política y el historial de cancelaciones", async () => {
    const passengerToken = tokenFor({ email: "pasajero@test.local", name: "Pasajero", role: "PASSENGER" });
    for (const headers of [{}, { authorization: `Bearer ${passengerToken}` }]) {
      for (const request of [
        { method: "GET" as const, url: "/v1/admin/settings/passenger-cancellations" },
        { method: "PATCH" as const, url: "/v1/admin/settings/passenger-cancellations", payload: { enabled: false, steps: [] } },
        { method: "GET" as const, url: "/v1/admin/passengers/00000000-0000-4000-8000-000000000001/cancellations" }
      ]) {
        expect((await app.inject({ ...request, headers })).statusCode).toBe(403);
      }
    }
    expect((await app.inject({ method: "PATCH", url: "/v1/admin/settings/passenger-cancellations",
      headers: { authorization: `Bearer ${adminToken}` }, payload: { enabled: true, steps: [{ fromCount: 3, suspensionDays: -2 }] }
    })).statusCode).toBe(400);
  });

  it("rechaza credenciales inválidas", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/admin/session", payload: { email: "admin@mototaxi.local", password: "incorrecta" } });
    expect(response.statusCode).toBe(401);
  });

  it("valida las dimensiones del banner PNG", () => {
    const image = Buffer.alloc(24);
    image.write("PNG", 1);
    image.writeUInt32BE(1200, 16);
    image.writeUInt32BE(400, 20);
    expect(imageDimensions(image, "image/png")).toEqual({ width: 1200, height: 400 });
    expect(imageDimensions(Buffer.from("no-es-imagen"), "image/png")).toBeUndefined();
  });

  it("no inventa métricas si la base no está disponible", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/admin/dashboard", headers: { authorization: `Bearer ${adminToken}` } });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe("DATABASE_UNAVAILABLE");
  });

  it("valida el período del dashboard antes de consultar", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/dashboard?from=2024-01-01T00%3A00%3A00.000Z&to=2026-01-02T00%3A00%3A00.000Z",
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("INVALID_DASHBOARD_FILTERS");
  });

  it("no inventa el perfil estadístico de un conductor sin base", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/dashboard/drivers/11111111-1111-4111-8111-111111111111",
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe("DATABASE_UNAVAILABLE");
  });

  it("valida la métrica solicitada y no inventa su detalle sin base", async () => {
    const invalid = await app.inject({ method: "GET", url: "/v1/admin/dashboard/details/desconocida", headers: { authorization: `Bearer ${adminToken}` } });
    expect(invalid.statusCode).toBe(404);
    expect(invalid.json().error).toBe("DASHBOARD_METRIC_NOT_FOUND");
    const valid = await app.inject({ method: "GET", url: "/v1/admin/dashboard/details/connectedDrivers", headers: { authorization: `Bearer ${adminToken}` } });
    expect(valid.statusCode).toBe(503);
    expect(valid.json().error).toBe("DATABASE_UNAVAILABLE");
    const searching = await app.inject({ method: "GET", url: "/v1/admin/dashboard/details/searchingWithoutDriver", headers: { authorization: `Bearer ${adminToken}` } });
    expect(searching.statusCode).toBe(503);
    expect(searching.json().error).toBe("DATABASE_UNAVAILABLE");
  });

  it("no expone una ficha de cooperativa inexistente sin base", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/admin/cooperatives/11111111-1111-4111-8111-111111111111/overview", headers: { authorization: `Bearer ${adminToken}` } });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe("DATABASE_UNAVAILABLE");
  });

  it("protege los centros operativos y no inventa datos sin base", async () => {
    const supportOperations = await app.inject({ method: "GET", url: "/v1/admin/operations", headers: { authorization: `Bearer ${supportToken}` } });
    const supportAlerts = await app.inject({ method: "GET", url: "/v1/admin/alerts", headers: { authorization: `Bearer ${supportToken}` } });
    expect(supportOperations.statusCode).toBe(403);
    expect(supportAlerts.statusCode).toBe(403);

    const adminOperations = await app.inject({ method: "GET", url: "/v1/admin/operations", headers: { authorization: `Bearer ${adminToken}` } });
    const adminAlerts = await app.inject({ method: "GET", url: "/v1/admin/alerts", headers: { authorization: `Bearer ${adminToken}` } });
    expect(adminOperations.statusCode).toBe(503);
    expect(adminOperations.json().error).toBe("DATABASE_UNAVAILABLE");
    expect(adminAlerts.statusCode).toBe(503);
    expect(adminAlerts.json().error).toBe("DATABASE_UNAVAILABLE");
  });

  it("impide que soporte apruebe conductores", async () => {
    const response = await app.inject({ method: "PATCH", url: "/v1/admin/drivers/DRV-001", headers: { authorization: `Bearer ${supportToken}` }, payload: { status: "ACTIVE", reason: "Aprobación de prueba" } });
    expect(response.statusCode).toBe(403);
  });

  it("permite visualizar zonas a soporte pero bloquea su modificación", async () => {
    const visible = await app.inject({ method: "GET", url: "/v1/admin/zones", headers: { authorization: `Bearer ${supportToken}` } });
    expect(visible.statusCode).toBe(200);
    const denied = await app.inject({
      method: "POST", url: "/v1/admin/zones", headers: { authorization: `Bearer ${supportToken}` },
      payload: { code: "TEST_PROD", name: "Zona prueba", environment: "PRODUCTION", audience: "ALL",
        geometry: { type: "Polygon", coordinates: [[[0,0],[1,0],[1,1],[0,0]]] },
        sourceName: "Prueba automatizada", changeNote: "Debe ser rechazada" }
    });
    expect(denied.statusCode).toBe(403);
  });

  it("acepta una regla tarifaria nueva aunque el formulario envíe el id vacío", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/fare-rules",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        id: "",
        serviceAreaId: "11111111-1111-4111-8111-111111111111",
        originSectorId: "22222222-2222-4222-8222-222222222222",
        destinationSectorId: "33333333-3333-4333-8333-333333333333",
        minimumPassengers: 1,
        maximumPassengers: 1,
        dayTotalCents: 100,
        nightTotalCents: 200,
        bidirectional: true,
        enabled: true,
        priority: 0
      }
    });
    // Sin DATABASE_URL la ruta no puede persistir, pero debe superar la
    // validación del formulario en lugar de responder INVALID_FARE_RULE.
    expect(response.statusCode).toBe(500);
    expect(response.json().error).not.toBe("INVALID_FARE_RULE");
  });

  it("protege la bandeja de aprobaciones con permisos de backend", async () => {
    const denied = await app.inject({ method: "GET", url: "/v1/admin/driver-approvals", headers: { authorization: `Bearer ${supportToken}` } });
    expect(denied.statusCode).toBe(403);
    const allowed = await app.inject({ method: "GET", url: "/v1/admin/driver-approvals", headers: { authorization: `Bearer ${adminToken}` } });
    expect(allowed.statusCode).toBe(200);
  });

  it("exige una observación para rechazar u observar", async () => {
    const response = await app.inject({
      method: "POST", url: "/v1/admin/driver-approvals/DRV-001/decision",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { decision: "REQUEST_CORRECTIONS", observation: "" }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("INVALID_APPROVAL_DECISION");
  });

  it("aplica permisos en backend y rechaza sesiones móviles", async () => {
    const supportRoles = await app.inject({
      method: "GET",
      url: "/v1/admin/access/roles",
      headers: { authorization: `Bearer ${supportToken}` }
    });
    expect(supportRoles.statusCode).toBe(403);

    const adminRoles = await app.inject({
      method: "GET",
      url: "/v1/admin/access/roles",
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(adminRoles.statusCode).toBe(200);
    expect(adminRoles.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "SUPER_ADMIN" }),
      expect.objectContaining({ role: "ANALISTA_COOPERATIVA" })
    ]));

    const passengerToken = tokenFor({ email: "pasajero@test.local", name: "Pasajero", role: "PASSENGER" });
    const mobileDenied = await app.inject({
      method: "GET",
      url: "/v1/admin/dashboard",
      headers: { authorization: `Bearer ${passengerToken}` }
    });
    expect(mobileDenied.statusCode).toBe(403);
  });

  it("solo permite al administrador restablecer contraseñas", async () => {
    const denied = await app.inject({
      method: "POST",
      url: "/v1/admin/users/DRV-002/reset-password",
      headers: { authorization: `Bearer ${supportToken}` },
      payload: { password: "Temporal2026!" }
    });
    expect(denied.statusCode).toBe(403);

    const updated = await app.inject({
      method: "POST",
      url: "/v1/admin/users/DRV-002/reset-password",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { password: "Temporal2026!" }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({ ok: true, sessionsRevoked: true });
  });

  it("valida la longitud de la nueva contraseña", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/users/DRV-002/reset-password",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { password: "corta" }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("WEAK_PASSWORD");
  });

  it("permite al administrador aprobar y audita el cambio", async () => {
    const updated = await app.inject({ method: "PATCH", url: "/v1/admin/drivers/DRV-001", headers: { authorization: `Bearer ${adminToken}` }, payload: { status: "ACTIVE", reason: "Documentación completa" } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().status).toBe("ACTIVE");
    const audit = await app.inject({ method: "GET", url: "/v1/admin/audit", headers: { authorization: `Bearer ${adminToken}` } });
    expect(audit.json()).toEqual(expect.arrayContaining([expect.objectContaining({ action: "DRIVER_STATUS", entity: "DRV-001" })]));
  });
});
