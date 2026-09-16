import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const scripts = new URL("../scripts/", import.meta.url);
const policy = JSON.parse(
  readFileSync(new URL("production-cleanup-policy.json", scripts), "utf8"),
) as Record<string, unknown>;
const cleanup = readFileSync(new URL("production-cleanup.mjs", scripts), "utf8");
const fleetPreview = readFileSync(
  new URL("production-cleanup-fleet-preview-readonly.mjs", scripts),
  "utf8",
);

describe("production cleanup safety policy", () => {
  it("preserves every registered account and removes deleted identities", () => {
    expect(policy).toMatchObject({
      preserveAllRegisteredAccounts: true,
      preserveDeletedAccounts: false,
      expectedRegisteredUserCount: 37,
      expectedRegisteredDriverCount: 8,
      pruneObsoleteConfigurationVersions: true,
      preserveScheduledConfigurationVersions: true,
    });
    expect(cleanup).toContain("from users u where u.deleted_at is null");
    expect(cleanup).toMatch(/delete from users where id not in\s*\(select id from cleanup_protected_users\)/);
  });

  it("removes the cooperative and all trip history", () => {
    expect(policy).toMatchObject({
      deleteAllCooperatives: true,
      expectedCooperativeCount: 1,
    });
    expect(cleanup).toContain('const deleteSeparately = ["admin_sessions", "passenger_cancellation_cycles", "cooperatives"]');
    expect(cleanup).toContain("delete from cooperatives");
    expect(cleanup).toMatch(/const truncate = \[[\s\S]*"trips"/);
  });

  it("prunes obsolete configuration versions without deleting active or scheduled rules", () => {
    expect(cleanup).toContain("delete from pricing_versions where active_until is not null and active_until<=now()");
    expect(cleanup).toContain("delete from service_zones where active_until is not null and active_until<=now()");
    expect(cleanup).toContain("delete from service_area_versions where id not in(select current_version_id from service_areas)");
    expect(cleanup).toContain('table === "pricing_versions" || table === "service_zones" ? " where active_until is null or active_until > now()"');
  });

  it("cannot execute without the production safeguards", () => {
    expect(cleanup).toContain('process.argv.includes("--execute")');
    expect(cleanup).toContain('CLEANUP_EXECUTE !== "YES_DELETE_PRODUCTION_TEST_DATA"');
    expect(cleanup).toContain('CLEANUP_BACKUP_CONFIRMED !== "RESTORE_TESTED"');
    expect(cleanup).toContain("CLEANUP_PLAN_TOKEN");
  });

  it("avoids PostgreSQL reserved session identifiers as aliases", () => {
    expect(cleanup).not.toMatch(/\bcurrent_user\b/);
    expect(fleetPreview).not.toMatch(/\bcurrent_user\b/);
  });
});
