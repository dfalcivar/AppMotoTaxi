import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it, vi } from 'vitest';
import { scheduledArrivalSchema, scheduledQuote, storedScheduledArrivalConfiguration } from './scheduled-arrival.js';
import type { TerritorialFare } from './fare-engine.js';

const configuration={enabled:true,dayStartTime:'06:00',nightStartTime:'19:00',dayArrivalFee:'0.25',nightArrivalFee:'0.75',timezone:'America/Guayaquil'};
const fare:TerritorialFare={pricingVersion:7,baseCents:300,platformCommissionCents:50,stopSurchargeCents:0,totalCents:350,
  suggested:false,distancePolicy:{centsPerKm:0,localMaximumMeters:0,minimumCents:0},legs:[]};
describe('scheduled arrival integration contract',()=>{
  it('replaces the per-leg additional instead of charging it twice',()=>{
    const quote=scheduledQuote(fare,new Date('2026-09-10T02:00:00Z'),configuration,1,'40',{passenger:'A'});
    expect(quote.totalCents).toBe(375);expect(quote.arrivalCents).toBe(75);
    expect(quote.economic.theoreticalCommission).toBe('0.30');
  });
  it('changes confirmation fingerprint on rescheduling, pricing/config changes and identity changes',()=>{
    const pickup=new Date('2026-09-10T02:00:00Z');
    const quote=scheduledQuote(fare,pickup,configuration,1,'40','A');
    expect(scheduledQuote(fare,pickup,configuration,1,'40','A').confirmation).toBe(quote.confirmation);
    for(const changed of [
      scheduledQuote(fare,new Date('2026-09-09T20:00:00Z'),configuration,1,'40','A'),
      scheduledQuote(fare,pickup,configuration,2,'40','A'),
      scheduledQuote({...fare,baseCents:400},pickup,configuration,1,'40','A'),
      scheduledQuote(fare,pickup,configuration,1,'50','A'),
      scheduledQuote(fare,pickup,configuration,1,'40','B')
    ])expect(changed.confirmation).not.toBe(quote.confirmation);
  });
  it('does not use current creation/acceptance time',()=>{
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-09T10:00:00-05:00'));
      const quote=scheduledQuote(fare,new Date('2026-09-09T21:00:00-05:00'),configuration,1,'40','A');
      vi.setSystemTime(new Date('2026-09-09T18:00:00-05:00'));
      expect(scheduledQuote(fare,new Date('2026-09-09T21:00:00-05:00'),configuration,1,'40','A')).toEqual(quote);
      expect(quote.economic.scheduledRateType).toBe('NIGHT');
    }finally{vi.useRealTimers();}
  });
  it('requires explicit configuration, valid timezone and different boundaries',()=>{
    expect(scheduledArrivalSchema.safeParse({enabled:true}).success).toBe(false);
    expect(scheduledArrivalSchema.safeParse({...configuration,timezone:'invalid/zone'}).success).toBe(false);
    expect(scheduledArrivalSchema.safeParse({...configuration,nightStartTime:'06:00'}).success).toBe(false);
    expect(scheduledArrivalSchema.safeParse({...configuration,dayArrivalFee:'-1'}).success).toBe(false);
  });
  it('reads both native JSONB objects and legacy double-encoded values',()=>{
    expect(storedScheduledArrivalConfiguration(configuration)).toEqual(configuration);
    expect(storedScheduledArrivalConfiguration(JSON.stringify(configuration))).toEqual(configuration);
    expect(storedScheduledArrivalConfiguration(null)).toBeNull();
  });
  it('migration is repeatable and leaves current pricing and trips unchanged',async()=>{
    const pg=new PGlite();
    try{
      await pg.exec(`create table operational_settings(id integer primary key); insert into operational_settings values(1);
        create table trips(id integer primary key,pricing_snapshot jsonb);insert into trips values(1,'{"totalCents":350}');`);
      const sql=await readFile(new URL('../migrations/087_scheduled_arrival_configuration.sql',import.meta.url),'utf8');
      await pg.exec(sql);await pg.exec(sql);
      expect((await pg.query('select scheduled_arrival_configuration,scheduled_arrival_version from operational_settings')).rows)
        .toEqual([{scheduled_arrival_configuration:null,scheduled_arrival_version:0}]);
      expect((await pg.query('select pricing_snapshot from trips')).rows).toEqual([{pricing_snapshot:{totalCents:350}}]);
    }finally{await pg.close();}
  },30000);
  it('repairs the double-encoded JSONB value already stored in production',async()=>{
    const pg=new PGlite();
    try{
      await pg.exec('create table operational_settings(id integer primary key,scheduled_arrival_configuration jsonb);');
      await pg.query('insert into operational_settings values(1,$1::jsonb)',[JSON.stringify(JSON.stringify(configuration))]);
      const sql=await readFile(new URL('../migrations/093_repair_scheduled_arrival_json.sql',import.meta.url),'utf8');
      await pg.exec(sql);await pg.exec(sql);
      expect((await pg.query('select scheduled_arrival_configuration as configuration from operational_settings')).rows)
        .toEqual([{configuration}]);
    }finally{await pg.close();}
  },30000);
});
