import { describe, expect, it } from "vitest";
import { appearsToHaveSwappedGeoJsonCoordinates, serviceAreaGeometrySchema, serviceAreaPublishSchema, serviceAreaRelationError } from "./service-areas.js";

const polygon = {
  type: "Polygon" as const,
  coordinates: [[[-79.1,-3],[-78.9,-3],[-78.9,-2.8],[-79.1,-2.8],[-79.1,-3]]] as [number,number][][]
};

describe("service areas", () => {
  it("acepta un polígono GeoJSON cerrado", () => {
    expect(serviceAreaGeometrySchema.parse(polygon)).toEqual(polygon);
  });

  it("rechaza un anillo abierto", () => {
    expect(() => serviceAreaGeometrySchema.parse({
      type: "Polygon",
      coordinates: [[[-79.1,-3],[-78.9,-3],[-78.9,-2.8],[-79.1,-2.8]]]
    })).toThrow();
  });

  it("detecta coordenadas ecuatorianas intercambiadas latitud/longitud", () => {
    expect(appearsToHaveSwappedGeoJsonCoordinates({type:"Polygon",coordinates:[[[-2.9,-79.1],[-2.8,-79.1],[-2.8,-79],[-2.9,-79.1]]] as [number,number][][]})).toBe(true);
    expect(appearsToHaveSwappedGeoJsonCoordinates(polygon)).toBe(false);
  });

  it("valida metadatos parametrizables", () => {
    const value = serviceAreaPublishSchema.parse({
      code: "CUENCA_TEST", name: "Cuenca - Pruebas", environment: "TEST",
      audience: "TESTERS", enabled: true, geometry: polygon,
      sourceName: "Fuente oficial", changeNote: "Versión de prueba"
    });
    expect(value.allowInterZoneTrips).toBe(false);
  });

  it("crea nuevas zonas desactivadas por defecto y admite audiencias parametrizadas", () => {
    const value = serviceAreaPublishSchema.parse({
      code: "MUISNE_PROD", name: "Muisne", environment: "PRODUCTION",
      audience: "ROLES", geometry: polygon, sourceName: "IGM / ajuste comercial",
      changeNote: "Cobertura inicial de Muisne"
    });
    expect(value.enabled).toBe(false);
    expect(value.audience).toBe("ROLES");
  });

  it("rechaza viajes entre zonas y acepta paradas en la misma zona", () => {
    expect(serviceAreaRelationError("ATACAMES", ["ATACAMES", "ATACAMES"], false)).toBeUndefined();
    expect(serviceAreaRelationError("ATACAMES", ["CUENCA"], false)).toBe("DIFFERENT_SERVICE_AREAS");
  });
});
