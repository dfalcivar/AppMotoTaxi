import {afterEach,describe,expect,it,vi} from 'vitest';
import {buildDatilCreditNotePayload,buildDatilInvoicePayload,DatilProvider,type DatilConfig} from './providers.js';

const config:DatilConfig={baseUrl:'https://link.datil.test',apiKey:'test-key',certificatePassword:'test-password',environment:1,timeoutMs:500,
  issuer:{ruc:'1790012345001',legalName:'Costa-Go S.A.S.',tradeName:'Costa-Go',address:'Atacames',accountingRequired:false,
    specialTaxpayer:'',establishmentCode:'001',emissionPoint:'002',establishmentAddress:'Atacames'}};
const document={idempotency_key:'123e4567-e89b-42d3-a456-426614174000',sequential:7,issued_at:'2026-09-22T12:00:00-05:00',
  external_reference:'costago:MEMBRESIA:test:FACTURA',fiscal_snapshot:{identificationType:'CEDULA',identification:'0912345678',legalName:'Cliente Prueba',address:'Atacames',billingEmail:'test@example.test'},
  subtotal:10,tax_amount:1.5,total:11.5,vat_rate_percent:15,currency:'USD',concept:'Recarga de saldo Costa-Go',service_type:'RECARGA',payment_method:'BANK_TRANSFER'};
const env={DATIL_API_KEY:'test-key',DATIL_CERTIFICATE_PASSWORD:'test-password',DATIL_ISSUER_RUC:'1790012345001',DATIL_ISSUER_LEGAL_NAME:'Costa-Go S.A.S.',
  DATIL_ISSUER_TRADE_NAME:'Costa-Go',DATIL_ISSUER_ADDRESS:'Atacames',DATIL_ESTABLISHMENT_CODE:'001',DATIL_EMISSION_POINT:'002',DATIL_BASE_URL:'https://link.datil.test'} as NodeJS.ProcessEnv;

afterEach(()=>vi.restoreAllMocks());

describe('Dátil provider',()=>{
  it('builds Ecuador identifiers, IVA 15% and payment method exactly',()=>{
    const payload=buildDatilInvoicePayload(document,config) as any;
    expect(payload.comprador.tipo_identificacion).toBe('05');
    expect(payload.totales.impuestos[0]).toMatchObject({codigo:'2',codigo_porcentaje:'4',base_imponible:10,valor:1.5});
    expect(payload.items[0].impuestos[0]).toMatchObject({codigo:'2',codigo_porcentaje:'4',tarifa:15});
    expect(payload.pagos).toEqual([{medio:'transferencia',total:11.5}]);
    expect(payload.items[0].descripcion).toBe('Recarga de saldo Costa-Go');
    const note=buildDatilCreditNotePayload({...document,reason:'Anulación',invoice_number:'001-002-000000001',invoice_issued_at:'2026-09-22T12:00:00-05:00'},config) as any;
    expect(note).toMatchObject({tipo_documento_modificado:'01',numero_documento_modificado:'001-002-000000001',motivo:'Anulación'});expect(note).not.toHaveProperty('pagos');
  });

  it('sends a 36-character idempotency key and persists the remote state data',async()=>{
    const fetcher=vi.fn(async(_url:URL|string|Request,_init?:RequestInit)=>new Response(JSON.stringify({id:'remote-1',estado:'RECIBIDO'}),{status:200,headers:{'content-type':'application/json'}}));
    const provider=new DatilProvider(fetcher as typeof fetch,env),result=await provider.emitirFactura(document);
    expect(result).toMatchObject({status:'RECIBIDA',remoteId:'remote-1',providerStatus:'RECIBIDO'});
    const init=fetcher.mock.calls[0]?.[1] as RequestInit,headers=new Headers(init.headers);
    expect(headers.get('Idempotency-key')).toBe(document.idempotency_key);
    expect(headers.get('X-Key')).toBe('test-key');expect(headers.get('X-Password')).toBe('test-password');
    await provider.reenviarCorreo('remote-1',['fiscal@example.test']);
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({destinatarios:['fiscal@example.test']});
  });

  it('rejects oversized local references as idempotency keys and classifies server failures as retryable',async()=>{
    const provider=new DatilProvider(vi.fn() as unknown as typeof fetch,env);
    await expect(provider.emitirFactura({...document,idempotency_key:'costago:MEMBRESIA:too-long-for-datil-idempotency'})).rejects.toMatchObject({code:'INVALID_IDEMPOTENCY_KEY',retryable:false});
    const failing=new DatilProvider(vi.fn(async()=>new Response(JSON.stringify({message:'maintenance'}),{status:503})) as unknown as typeof fetch,env);
    await expect(failing.emitirFactura(document)).rejects.toMatchObject({code:'DATIL_HTTP_503',retryable:true});
  });
});
