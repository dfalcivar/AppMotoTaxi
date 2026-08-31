import { describe, expect, it } from "vitest";
import { cooperativeDemoSchema } from "./cooperative-demo.js";

const valid = {
  cooperativeName: "Cooperativa Costa Azul",
  contactName: "Contacto Demostrativo",
  roleTitle: "Administrador",
  phone: "+593 99 000 0000",
  email: "demo@example.com",
  city: "Atacames",
  unitCount: 42,
  message: "Deseamos conocer el panel operativo.",
  submissionKey: "9ee891f2-6c71-4d5a-9ec6-d0e859083cb0"
};

describe("cooperativeDemoSchema", () => {
  it("acepta una solicitud completa para una cooperativa de mototaxis", () => {
    expect(cooperativeDemoSchema.parse(valid)).toMatchObject({ unitCount: 42, city: "Atacames" });
  });

  it("rechaza correos, teléfonos y cantidades inválidas", () => {
    expect(() => cooperativeDemoSchema.parse({ ...valid, email: "incorrecto" })).toThrow();
    expect(() => cooperativeDemoSchema.parse({ ...valid, phone: "123" })).toThrow();
    expect(() => cooperativeDemoSchema.parse({ ...valid, unitCount: 0 })).toThrow();
  });
});
