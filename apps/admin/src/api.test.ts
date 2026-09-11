import { describe, expect, it, vi } from "vitest";
import { apiFetch, requestQuote } from "./api.js";

describe("cliente de cotizaciones administrativas", () => {
  it("no reutiliza respuestas anteriores al consultar configuración administrativa", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ version: 2, configuration: null }), {
      status: 200, headers: { "content-type": "application/json" }
    }));

    await apiFetch("/v1/admin/scheduled-arrival-settings", "token", {}, fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/admin/scheduled-arrival-settings",
      expect.objectContaining({ cache: "no-store" })
    );
  });

  it("envía los datos a la API y devuelve la respuesta del servidor", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          currency: "USD",
          totalCents: 100,
          total: "1.00",
          period: "DAY",
          zone: "URBAN",
          passengers: 3,
          appliedRule: "URBAN_DAY_GROUP_PROMOTION",
          pricingVersion: 1,
          explanation: "Promoción urbana diurna."
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const result = await requestQuote(
      { zone: "URBAN", passengers: 3, localTime: "18:30" },
      undefined,
      fetcher
    );

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/quotes",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          zone: "URBAN",
          passengers: 3,
          localTime: "18:30"
        })
      })
    );
    expect(result.totalCents).toBe(100);
    expect(result.appliedRule).toBe("URBAN_DAY_GROUP_PROMOTION");
  });

  it("presenta el mensaje de error entregado por la API", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ message: "Cotización no disponible." }), {
        status: 422,
        headers: { "content-type": "application/json" }
      })
    );

    await expect(
      requestQuote(
        { zone: "URBAN", passengers: 3, localTime: "18:30" },
        undefined,
        fetcher
      )
    ).rejects.toThrow("Cotización no disponible.");
  });
});
