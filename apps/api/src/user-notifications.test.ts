import { describe, expect, it } from "vitest";
import { shouldPersistNotification } from "./user-notifications.js";

describe("notificaciones internas", () => {
  it("persiste eventos que requieren atención del usuario", () => {
    expect(shouldPersistNotification("CHAT_MESSAGE")).toBe(true);
    expect(shouldPersistNotification("DRIVER_ARRIVED")).toBe(true);
    expect(shouldPersistNotification("SUPPORT_UPDATE")).toBe(true);
  });

  it("no llena el buzón con ofertas operativas del conductor", () => {
    expect(shouldPersistNotification("TRIP_OFFER")).toBe(false);
    expect(shouldPersistNotification("DRIVER_AVAILABILITY")).toBe(false);
  });
});
