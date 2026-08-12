import { describe, expect, it } from "vitest";
import { pushDeliveryStatus } from "./push.js";

describe("pushDeliveryStatus", () => {
  it("clasifica entregas completas, parciales, fallidas y omitidas", () => {
    expect(pushDeliveryStatus({ sent: 2, failed: 0 })).toBe("SENT");
    expect(pushDeliveryStatus({ sent: 1, failed: 1 })).toBe("PARTIAL");
    expect(pushDeliveryStatus({ sent: 0, failed: 2 })).toBe("FAILED");
    expect(pushDeliveryStatus({ sent: 0, skipped: true })).toBe("SKIPPED");
  });
});
