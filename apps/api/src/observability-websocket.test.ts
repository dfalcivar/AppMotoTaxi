import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("Sentry y WebSocket", () => {
  const previousDsn = process.env.SENTRY_DSN;

  beforeAll(() => {
    process.env.SENTRY_DSN = "https://public@example.invalid/1";
    vi.resetModules();
  });

  afterAll(() => {
    if (previousDsn == null) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = previousDsn;
  });

  it("no instrumenta el handler especial de @fastify/websocket", async () => {
    const Sentry = await import("@sentry/node");
    await import("./observability.js");
    const integrations = Sentry.getClient()?.getOptions().integrations ?? [];

    expect(integrations.some(integration => integration.name === "Fastify")).toBe(false);
    expect(integrations.length).toBeGreaterThan(0);
  });
});
