import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("internal premium advertising placements", () => {
  it.each(["app.ts", "commercial.ts"])(
    "does not restrict internal campaigns by order_id in %s",
    async file => {
      const source = await readFile(resolve(process.cwd(), "src", file), "utf8");

      expect(source).not.toContain("banner.order_id is null and");
      expect(source).not.toContain("banner.order_id is not null and");
      expect(source).toContain("upper(coalesce(plan.code,''))='PREMIUM'");
      expect(source).toContain(
        "array['PASSENGER_SEARCHING_DRIVER','PASSENGER_WAITING_DRIVER','PASSENGER_TRIP_IN_PROGRESS']::text[]",
      );
    },
  );
});
