import { describe, expect, it } from "vitest";
import { hasPermission, permissionsForRole } from "./permissions.js";

describe("matriz de permisos administrativos", () => {
  it("conserva ADMIN como superadministrador legado", () => {
    expect(hasPermission("ADMIN", "roles:manage")).toBe(true);
    expect(hasPermission("ADMIN", "database:view")).toBe(true);
  });

  it("soporte consulta conductores pero no puede aprobarlos", () => {
    expect(hasPermission("SOPORTE", "drivers:view")).toBe(true);
    expect(hasPermission("SOPORTE", "drivers:approve")).toBe(false);
    expect(hasPermission("SUPPORT", "audit:view")).toBe(false);
    expect(hasPermission("SOPORTE", "service_areas:view")).toBe(true);
    expect(hasPermission("SOPORTE", "service_areas:edit")).toBe(false);
  });

  it("separa los permisos de lectura, edición, activación y archivo de zonas", () => {
    expect(hasPermission("SUPER_ADMIN", "service_areas:create")).toBe(true);
    expect(hasPermission("SUPER_ADMIN", "service_areas:edit")).toBe(true);
    expect(hasPermission("SUPER_ADMIN", "service_areas:activate")).toBe(true);
    expect(hasPermission("SUPER_ADMIN", "service_areas:archive")).toBe(true);
    expect(hasPermission("ADMIN_OPERACIONES", "service_areas:view")).toBe(true);
    expect(hasPermission("ADMIN_OPERACIONES", "service_areas:activate")).toBe(false);
  });

  it("limita al analista a información agregada de cooperativa", () => {
    expect(hasPermission("ANALISTA_COOPERATIVA", "cooperative_dashboard:view")).toBe(true);
    expect(hasPermission("ANALISTA_COOPERATIVA", "trips:view")).toBe(false);
    expect(hasPermission("ANALISTA_COOPERATIVA", "passengers:view")).toBe(false);
  });

  it("aplica excepciones específicas sin aceptar permisos desconocidos", () => {
    const permissions = permissionsForRole("SOPORTE", [
      { permission: "drivers:approve", allowed: true },
      { permission: "incidents:manage", allowed: false },
      { permission: "unknown:permission", allowed: true }
    ]);
    expect(permissions).toContain("drivers:approve");
    expect(permissions).not.toContain("incidents:manage");
    expect(permissions).not.toContain("unknown:permission");
  });
});

it("permite al rol comercial consultar banners y su segmentación territorial", () => {
  expect(hasPermission("COMMERCIAL", "advertising:view")).toBe(true);
  expect(hasPermission("COMMERCIAL", "service_areas:view")).toBe(true);
  expect(hasPermission("COMMERCIAL", "service_areas:edit")).toBe(false);
  expect(hasPermission("COMMERCIAL", "commercial:plans:manage")).toBe(false);
});
