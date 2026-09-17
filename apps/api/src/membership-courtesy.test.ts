import {describe,expect,it} from 'vitest';
import {requiresPackageCommercialRules} from './memberships.js';

describe('membresías de cortesía',()=>{
  it('no exige reglas de precio para una cortesía por viajes',()=>{
    expect(requiresPackageCommercialRules('TRIP_PACK',true,true)).toBe(false);
  });

  it('mantiene la validación comercial en compras normales por viajes',()=>{
    expect(requiresPackageCommercialRules('TRIP_PACK',true,false)).toBe(true);
    expect(requiresPackageCommercialRules('PERIODIC',true,false)).toBe(false);
  });
});
