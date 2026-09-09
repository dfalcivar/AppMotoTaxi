import { describe, expect, it } from 'vitest';
import { arrivalSearchBounds, commercialCharge, exactTaxBreakdown, immediateArrival,
  monetaryAmount, packageEconomics, scheduledArrivalSnapshot } from './commercial-economics.js';

const search={initialRadiusMeters:2000,radiusIncrementMeters:2000,maximumRadiusMeters:7000,roundWaitSeconds:12};
const schedule={version:'3',timezone:'America/Guayaquil',dayStartTime:'06:00',nightStartTime:'19:00',
  dayArrivalFee:'0.25',nightArrivalFee:'0.75',costaGoPercent:'40'};
describe('economic calculations (illustrative test fixtures, not defaults)',()=>{
  it('reuses dispatch including its final partial round',()=>{
    expect(arrivalSearchBounds(search).map(item=>item.upperMeters)).toEqual([2000,4000,6000,7000]);
    expect(arrivalSearchBounds({...search,maximumRadiusMeters:2000})).toHaveLength(1);
    expect(()=>arrivalSearchBounds({...search,radiusIncrementMeters:0})).toThrow();
    expect(()=>arrivalSearchBounds({...search,maximumRadiusMeters:1000})).toThrow();
  });
  it('computes arrival and theoretical commission independently of driver plan',()=>{
    expect(immediateArrival({settings:search,round:4,feePerRound:'0.25',journeyFare:'3.00',costaGoPercent:'40'}))
      .toMatchObject({arrivalFee:'1.00',theoreticalCommission:'0.40',passengerTotal:'4.00',passengerMinimum:'3.25',passengerMaximum:'4.00'});
    expect(()=>immediateArrival({settings:search,round:5,feePerRound:'0.25',journeyFare:'3.00',costaGoPercent:'40'})).toThrow();
  });
  it('rounds exact decimals half-up, including tax without crediting VAT to principal',()=>{
    expect(monetaryAmount('1.005')).toBe('1.01');
    expect(exactTaxBreakdown('5','15')).toEqual({subtotal:'5.00',vatRatePercent:'15',vatAmount:'0.75',total:'5.75'});
    expect(()=>monetaryAmount('-1')).toThrow();
    expect(()=>exactTaxBreakdown('5','101')).toThrow();
  });
  it.each([
    ['2026-09-09T05:59:00-05:00','NIGHT','3.75'],
    ['2026-09-09T06:00:00-05:00','DAY','3.25'],
    ['2026-09-09T18:59:00-05:00','DAY','3.25'],
    ['2026-09-09T19:00:00-05:00','NIGHT','3.75'],
    ['2026-09-10T00:00:00-05:00','NIGHT','3.75'],
    ['2026-09-10T02:00:00Z','NIGHT','3.75']
  ])('uses pickup instant %s, not current clock',(pickup,rate,total)=>{
    const result=scheduledArrivalSnapshot(pickup,'3',schedule);
    expect(result.scheduledRateType).toBe(rate);expect(result.passengerTotal).toBe(total);
    expect(result.economicConfigurationVersion).toBe('3');
  });
  it('supports configured day crossing midnight and different UTC offsets',()=>{
    const config={...schedule,dayStartTime:'19:00',nightStartTime:'06:00'};
    expect(scheduledArrivalSnapshot('2026-09-09T23:00:00-05:00','3',config).scheduledRateType).toBe('DAY');
    expect(scheduledArrivalSnapshot('2026-09-10T07:00:00-05:00','3',config).scheduledRateType).toBe('NIGHT');
    expect(()=>scheduledArrivalSnapshot('2026-09-09T23:00:00','3',config)).toThrow('OFFSET');
    expect(()=>scheduledArrivalSnapshot('2026-09-09T23:00:00Z','3',{...config,nightStartTime:config.dayStartTime})).toThrow('OVERLAP');
  });
  it('does not mutate a saved quote after changing economic configuration',()=>{
    const config={...schedule};
    const saved=scheduledArrivalSnapshot('2026-09-09T21:00:00-05:00','3',config);
    config.nightArrivalFee='2';config.costaGoPercent='50';config.version='4';
    expect(saved.passengerTotal).toBe('3.75');expect(saved.theoreticalCommission).toBe('0.30');
    expect(scheduledArrivalSnapshot('2026-09-09T21:00:00-05:00','3',config).passengerTotal).toBe('5.00');
  });
  it('resolves exactly one charge and enforces available funds',()=>{
    expect(commercialCharge('0.10',{mode:'PAY_PER_USE',availableBalance:'0.10'}).reserve).toBe('0.10');
    expect(()=>commercialCharge('0.20',{mode:'PAY_PER_USE',availableBalance:'0.10'})).toThrow('INSUFFICIENT');
    expect(commercialCharge('0.40',{mode:'TRIP_PACKAGE',remainingTrips:1}).appliedCommission).toBe('0.00');
    expect(()=>commercialCharge('0.40',{mode:'TRIP_PACKAGE',remainingTrips:0})).toThrow('EXHAUSTED');
  });
  it('handles included, first excess, partial cap and reached cap',()=>{
    const policy={mode:'PERIOD_PLAN' as const,usedTrips:119,includedTrips:120,additionalCap:'30',accrued:'0'};
    expect(commercialCharge('0.40',policy).billingMode).toBe('PERIOD_PLAN_INCLUDED');
    expect(commercialCharge('0.40',{...policy,usedTrips:120}).appliedCommission).toBe('0.40');
    expect(commercialCharge('0.40',{...policy,usedTrips:121,accrued:'29.80'}).appliedCommission).toBe('0.20');
    expect(commercialCharge('0.40',{...policy,usedTrips:122,accrued:'30'}).billingMode).toBe('PERIOD_PLAN_CAP_REACHED');
  });
  const pack={quantity:50,feePerRound:'0.25',costaGoPercent:'40',totalRounds:4,
    reference:[{round:2,count:1}],global:[],minimumSamples:10,fullConfidenceSamples:20,
    commercialFactor:'0.9',volumeDiscountPercent:'0',fixedCost:'0',minimumPrice:'1'};
  it('uses configured reference with insufficient history, not invented distributions',()=>{
    const result=packageEconomics(pack);
    expect(result).toMatchObject({scope:'REFERENCE',meanRound:'2.000000',expectedCommissionPerTrip:'0.200000',technicalCost:'10.00',suggestedPrice:'9.00'});
    expect(()=>packageEconomics({...pack,reference:[]})).toThrow('REFERENCE');
  });
  it('blends history progressively and uses zone only with sufficient sample',()=>{
    expect(packageEconomics({...pack,global:[{round:1,count:10}]}).meanRound).toBe('1.500000');
    expect(packageEconomics({...pack,global:[{round:1,count:20}],zone:[{round:4,count:9}]}).scope).toBe('GLOBAL');
    expect(packageEconomics({...pack,global:[{round:1,count:20}],zone:[{round:4,count:20}]}))
      .toMatchObject({scope:'ZONE',meanRound:'4.000000',technicalCost:'20.00'});
  });
  it('supports distinct commercial factors, discount, fixed cost and price floor',()=>{
    expect(packageEconomics({...pack,commercialFactor:'0.8',volumeDiscountPercent:'10',fixedCost:'2'}).suggestedPrice).toBe('8.64');
    expect(packageEconomics({...pack,minimumPrice:'15'}).suggestedPrice).toBe('15.00');
  });
});
