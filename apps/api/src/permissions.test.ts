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
