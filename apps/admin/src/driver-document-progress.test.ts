import { describe, expect, it } from 'vitest';
import { driverDocumentProgress } from './driver-document-progress';

describe('documentos obligatorios en la bandeja de conductores', () => {
  it('habilita aprobar cuatro obligatorios sin exigir el opcional', () => {
    expect(driverDocumentProgress({ requiredDocumentCount: 4, approvedRequiredDocuments: 4, approvedDocuments: 4 }))
      .toEqual({ label: '4/4 obligatorios aprobados', complete: true });
  });
  it('no suma opcionales para sustituir un obligatorio', () => {
    expect(driverDocumentProgress({ requiredDocumentCount: 4, approvedRequiredDocuments: 3, approvedDocuments: 4 }).complete).toBe(false);
    expect(driverDocumentProgress({ requiredDocumentCount: 4, approvedDocuments: 4 }).complete).toBe(false);
  });
  it('aprobar el quinto archivo no vuelve a deshabilitar el botón', () => {
    expect(driverDocumentProgress({ requiredDocumentCount: 4, approvedRequiredDocuments: 4, approvedDocuments: 5 }).complete).toBe(true);
  });
  it('durante despliegues mixtos respeta el contrato anterior de cinco documentos', () => {
    expect(driverDocumentProgress({ approvedDocuments: 4 }).complete).toBe(false);
    expect(driverDocumentProgress({ approvedDocuments: 5 }).complete).toBe(true);
    expect(driverDocumentProgress({}).complete).toBe(false);
  });
});
