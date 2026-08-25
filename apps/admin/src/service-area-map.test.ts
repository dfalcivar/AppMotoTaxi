import { describe,expect,it } from "vitest";
import { parseGoogleMapsCoordinates } from "./service-area-map.js";

describe("parseGoogleMapsCoordinates",()=>{
  it("acepta latitud y longitud separadas por coma",()=>{
    expect(parseGoogleMapsCoordinates("-0.86820, -79.84710")).toEqual({latitude:-0.8682,longitude:-79.8471});
  });

  it("extrae coordenadas de un enlace largo de Google Maps",()=>{
    expect(parseGoogleMapsCoordinates("https://www.google.com/maps/place/Punto/@-0.86743,-79.84891,17z")).toEqual({latitude:-0.86743,longitude:-79.84891});
  });

  it("rechaza texto y coordenadas fuera de rango",()=>{
    expect(parseGoogleMapsCoordinates("https://maps.app.goo.gl/abc123")).toBeNull();
    expect(parseGoogleMapsCoordinates("-95, -200")).toBeNull();
  });
});
