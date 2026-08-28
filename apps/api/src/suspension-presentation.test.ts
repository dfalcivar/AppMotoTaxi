import {afterEach,describe,expect,it,vi} from 'vitest';
import {cancellationSuspensionResponse} from './suspension-presentation.js';
afterEach(()=>vi.unstubAllEnvs());
describe('suspension details for the mobile UI',()=>{
  it('returns an explicit expiry and the configured support contact',()=>{
    vi.stubEnv('SUPPORT_WHATSAPP','+593 999 000 000');
    expect(cancellationSuspensionResponse('test-user',new Date('2026-08-30T12:00:00Z')))
      .toMatchObject({error:'PASSENGER_CANCELLATION_SUSPENDED',accountId:'test-user',suspendedUntil:'2026-08-30T12:00:00.000Z',indefinite:false,supportUrl:'https://wa.me/593999000000'});
  });
  it('distinguishes indefinite suspension without inventing an end date',()=>{
    vi.stubEnv('SUPPORT_WHATSAPP','');
    expect(cancellationSuspensionResponse('test-user',null)).toMatchObject({indefinite:true,suspendedUntil:null,supportUrl:'mailto:soporte@costa-go.com'});
  });
});
