import {describe,expect,it} from 'vitest';
import {ecuadorCalendarDate,registeredInRange,registrationDateRange} from './passenger-registration';

describe('fecha de registro de pasajeros',()=>{
  it('usa el día de Ecuador al cruzar medianoche UTC',()=>{
    expect(ecuadorCalendarDate('2026-09-29T02:30:00Z')).toBe('2026-09-28');
    expect(registeredInRange('2026-09-29T02:30:00Z','2026-09-28','2026-09-28')).toBe(true);
    expect(registeredInRange('2026-09-29T05:30:00Z','2026-09-28','2026-09-28')).toBe(false);
  });

  it('incluye ambos extremos de los períodos recientes',()=>{
    expect(registrationDateRange('LAST_7_DAYS','2026-09-28','','')).toEqual({from:'2026-09-22',to:'2026-09-28'});
    expect(registrationDateRange('LAST_30_DAYS','2026-09-28','','')).toEqual({from:'2026-08-30',to:'2026-09-28'});
  });
});
