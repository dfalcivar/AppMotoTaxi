import { describe, expect, it } from "vitest";
import { pushDeliveryStatus, pushPresentationForType, pushRouteForType } from "./push.js";

describe("pushDeliveryStatus", () => {
  it("clasifica entregas completas, parciales, fallidas y omitidas", () => {
    expect(pushDeliveryStatus({ sent: 2, failed: 0 })).toBe("SENT");
    expect(pushDeliveryStatus({ sent: 1, failed: 1 })).toBe("PARTIAL");
    expect(pushDeliveryStatus({ sent: 0, failed: 2 })).toBe("FAILED");
    expect(pushDeliveryStatus({ sent: 0, skipped: true })).toBe("SKIPPED");
  });
});

describe("pushRouteForType", () => {
  it("dirige cada notificación al módulo correcto", () => {
    expect(pushRouteForType("CHAT_MESSAGE")).toBe("CHAT");
    expect(pushRouteForType("DRIVER_ARRIVED")).toBe("ACTIVE_TRIP");
    expect(pushRouteForType("TRIP_OFFER")).toBe("TRIP_OFFERS");
    expect(pushRouteForType("COMPLETED")).toBe("TRIP_DETAIL");
    expect(pushRouteForType("SUPPORT_UPDATE")).toBe("SUPPORT");
    expect(pushRouteForType("MEMBERSHIP_EXPIRING")).toBe("MEMBERSHIP");
    expect(pushRouteForType("SCHEDULED_TRIP_ASSIGNED")).toBe("SCHEDULED_TRIPS");
  });
});

describe("pushPresentationForType", () => {
  it("usa la misma presentación canónica para el ciclo del viaje", () => {
    expect(pushPresentationForType("TRIP_ASSIGNED", "Otro", "Otro")).toEqual({
      title: "Viaje confirmado",
      body: "Un conductor aceptó tu solicitud y ya va en camino."
    });
    expect(pushPresentationForType("CHAT_MESSAGE", "Mensaje de Ana", "Hola")).toEqual({
      title: "Mensaje de Ana",
      body: "Hola"
    });
  });
});
