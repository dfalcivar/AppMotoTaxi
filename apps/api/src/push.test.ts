import { describe, expect, it } from "vitest";
import { normalizePushData, pushDeliveryStatus, pushPresentationForType, pushRouteForType } from "./push.js";

describe("normalizePushData", () => {
  it("convierte metadatos APP_UPDATE al contrato de cadenas requerido por FCM", () => {
    expect(normalizePushData({
      type: "APP_UPDATE",
      targetBuild: 61,
      required: false,
      versions: { current: "0.17.6", target: "0.18.0" },
      omitted: null
    })).toEqual({
      type: "APP_UPDATE",
      targetBuild: "61",
      required: "false",
      versions: '{"current":"0.17.6","target":"0.18.0"}'
    });
  });

  it("preserva rutas y coordenadas de notificaciones inteligentes sin alterar su contenido", () => {
    expect(normalizePushData({
      type: "SMART_FREQUENT_TRIP",
      deepLink: "costa-go://trip/prepare",
      destinationLatitude: 0.8672,
      destinationLongitude: -79.8471,
      weekDays: [1, 2, 3]
    })).toEqual({
      type: "SMART_FREQUENT_TRIP",
      deepLink: "costa-go://trip/prepare",
      destinationLatitude: "0.8672",
      destinationLongitude: "-79.8471",
      weekDays: "[1,2,3]"
    });
  });
});

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
    expect(pushRouteForType("NO_DRIVER")).toBe("TRIP_DETAIL");
    expect(pushRouteForType("SUPPORT_UPDATE")).toBe("SUPPORT");
    expect(pushRouteForType("MEMBERSHIP_EXPIRING")).toBe("MEMBERSHIP");
    expect(pushRouteForType("SCHEDULED_TRIP_ASSIGNED")).toBe("SCHEDULED_TRIPS");
  });
});

describe("pushPresentationForType", () => {
  it("usa la misma presentación canónica para el ciclo del viaje", () => {
    expect(pushPresentationForType("ASSIGNED", "Otro", "Otro")).toEqual(pushPresentationForType("DRIVER_EN_ROUTE", "Otro", "Otro"));
    expect(pushPresentationForType("NO_DRIVER", "Otro", "Otro").body).toBe("Ninguna mototaxi disponible en este momento.");
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
