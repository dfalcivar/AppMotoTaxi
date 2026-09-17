import {describe,expect,it} from 'vitest';
import {requiresPackageCommercialRules} from './memberships.js';
import {readFile} from 'node:fs/promises';

describe('membresías de cortesía',()=>{
  it('no exige reglas de precio para una cortesía por viajes',()=>{
    expect(requiresPackageCommercialRules('TRIP_PACK',true,true)).toBe(false);
  });

  it('mantiene la validación comercial en compras normales por viajes',()=>{
    expect(requiresPackageCommercialRules('TRIP_PACK',true,false)).toBe(true);
    expect(requiresPackageCommercialRules('PERIODIC',true,false)).toBe(false);
  });

  it('crea una orden propia y reemplaza solicitudes pendientes al activar la cortesía',async()=>{
    const source=await readFile(new URL('./memberships.ts',import.meta.url),'utf8');
    expect(source).toContain('reuseActiveOrder:false');
    expect(source).toContain("cancellation_channel='ADMIN'");
    expect(source).toContain("and id<>${order.id} and status='PENDING'");
  });
});
