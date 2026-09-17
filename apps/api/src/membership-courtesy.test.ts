import {describe,expect,it} from 'vitest';
import {requiresPackageCommercialRules,shouldReplaceEmptyCourtesyTripPack} from './memberships.js';
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

  it('reemplaza una cortesía por viajes agotada en lugar de acumularla',()=>{
    expect(shouldReplaceEmptyCourtesyTripPack({paymentMethod:'COURTESY',planType:'TRIP_PACK',currentPlanType:'TRIP_PACK',includedTrips:0,completedTrips:0})).toBe(true);
    expect(shouldReplaceEmptyCourtesyTripPack({paymentMethod:'COURTESY',planType:'TRIP_PACK',currentPlanType:'TRIP_PACK',includedTrips:10,completedTrips:10})).toBe(true);
  });

  it('conserva la acumulación normal y las cortesías que aún tienen viajes',()=>{
    expect(shouldReplaceEmptyCourtesyTripPack({paymentMethod:'CASH',planType:'TRIP_PACK',currentPlanType:'TRIP_PACK',includedTrips:0,completedTrips:0})).toBe(false);
    expect(shouldReplaceEmptyCourtesyTripPack({paymentMethod:'COURTESY',planType:'TRIP_PACK',currentPlanType:'TRIP_PACK',includedTrips:10,completedTrips:2})).toBe(false);
  });
});
