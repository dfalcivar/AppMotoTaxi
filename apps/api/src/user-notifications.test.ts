import { describe, expect, it } from "vitest";
import { notificationClassification, shouldPersistNotification } from "./user-notifications.js";

describe("notificaciones internas", () => {
  it("persiste eventos que requieren atención del usuario", () => {
    expect(shouldPersistNotification("CHAT_MESSAGE")).toBe(true);
    expect(shouldPersistNotification("DRIVER_ARRIVED")).toBe(true);
    expect(shouldPersistNotification("SUPPORT_UPDATE")).toBe(true);
  });

  it("no llena el buzón con ofertas operativas del conductor", () => {
    expect(shouldPersistNotification("TRIP_OFFER")).toBe(true);
    expect(shouldPersistNotification("SCHEDULED_TRIP_AVAILABLE")).toBe(true);
    expect(shouldPersistNotification("DRIVER_AVAILABILITY")).toBe(false);
  });

  it("separa recomendaciones y campañas sin degradar alertas críticas", () => {
    expect(notificationClassification("SMART_FREQUENT_TRIP")).toEqual({category:"SMART",priority:"SMART"});
    expect(notificationClassification("PROMOTIONAL")).toEqual({category:"PROMOTIONAL",priority:"PROMOTIONAL"});
    expect(notificationClassification("TRIP_CANCELLED")).toEqual({category:"TRANSACTIONAL",priority:"TRIP_CRITICAL"});
  });
});
