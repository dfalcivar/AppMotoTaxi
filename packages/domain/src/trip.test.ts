import { describe, expect, it } from "vitest";
import { canTransitionTrip, transitionTrip } from "./trip.js";

describe("estados del viaje", () => {
  it("permite completar el recorrido normal", () => {
    expect(canTransitionTrip("SEARCHING", "ASSIGNED")).toBe(true);
    expect(canTransitionTrip("ASSIGNED", "DRIVER_EN_ROUTE")).toBe(true);
    expect(canTransitionTrip("DRIVER_ARRIVED", "IN_PROGRESS")).toBe(true);
    expect(canTransitionTrip("IN_PROGRESS", "COMPLETED")).toBe(true);
  });

  it("impide saltar directamente de búsqueda a completado", () => {
    expect(() => transitionTrip("SEARCHING", "COMPLETED")).toThrow(
      "Transición de viaje no permitida"
    );
  });
});
