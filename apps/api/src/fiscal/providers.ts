type JsonObject=Record<string,any>;

export type ProviderResult = {
  status:'RECIBIDA'|'AUTORIZADA'|'RECHAZADA'; remoteId:string; providerStatus:string;
  reasonCode?:string;reason?:string;number?:string;accessKey?:string;authorization?:string;authorizedAt?:string;
  subtotal?:number;tax?:number;xml?:string;ride?:string;emailSent?:boolean;
};
export type ProviderUnavailable={status:'PENDIENTE_INTEGRACION';reason:string};
export type ProviderArtifact={url:string};
export type ProviderEmailResult={sent:boolean;result?:string};

export interface ProveedorFacturacion {
  readonly name:string;readonly configured:boolean;
  emitirFactura(document:Record<string,unknown>):Promise<ProviderResult|ProviderUnavailable>;
  consultarEstado(reference:string):Promise<ProviderResult|ProviderUnavailable>;
  obtenerXml(reference:string):Promise<ProviderArtifact|ProviderUnavailable>;
  obtenerRide(reference:string):Promise<ProviderArtifact|ProviderUnavailable>;
  reenviarCorreo(reference:string,emails?:string[]):Promise<ProviderEmailResult|ProviderUnavailable>;
  crearNotaCredito(reference:string,input:Record<string,unknown>):Promise<ProviderResult|ProviderUnavailable>;
  consultarNotaCredito?(reference:string):Promise<ProviderResult|ProviderUnavailable>;
}

export class FiscalProviderError extends Error {
  constructor(readonly code:string,message:string,readonly retryable:boolean,readonly httpStatus?:number){super(message);this.name='FiscalProviderError';}
}

class UnconfiguredProvider implements ProveedorFacturacion {
  readonly configured=false;
  constructor(readonly name:string){}
  protected async unavailable():Promise<ProviderUnavailable>{return {status:'PENDIENTE_INTEGRACION',reason:'Proveedor aún no contratado/configurado'};}
  emitirFactura(_document:Record<string,unknown>){return this.unavailable();}
  consultarEstado(_reference:string){return this.unavailable();}
  obtenerXml(_reference:string){return this.unavailable();}
  obtenerRide(_reference:string){return this.unavailable();}
  reenviarCorreo(_reference:string,_emails?:string[]){return this.unavailable();}
  crearNotaCredito(_reference:string,_input:Record<string,unknown>){return this.unavailable();}
}

export type DatilConfig={
  baseUrl:string;apiKey:string;certificatePassword:string;environment:1|2;timeoutMs:number;
  issuer:{ruc:string;legalName:string;tradeName:string;address:string;accountingRequired:boolean;specialTaxpayer:string;
    establishmentCode:string;emissionPoint:string;establishmentAddress:string};
};

function envString(env:NodeJS.ProcessEnv,key:string){return env[key]?.trim()??'';}
function bool(value:string){return /^(true|1|yes|si)$/i.test(value);}
function positiveInt(value:string,fallback:number){const parsed=Number(value);return Number.isInteger(parsed)&&parsed>0?parsed:fallback;}
function idempotencyKey(document:Record<string,unknown>){const value=String(field(document,'idempotencyKey','idempotency_key')??'');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw new FiscalProviderError('INVALID_IDEMPOTENCY_KEY','La clave idempotente debe ser un UUID de 36 caracteres.',false);
  return value;
}
function datilConfig(env:NodeJS.ProcessEnv):DatilConfig|null {
  const config:DatilConfig={
    baseUrl:(envString(env,'DATIL_BASE_URL')||'https://link.datil.co').replace(/\/+$/,''),
    apiKey:envString(env,'DATIL_API_KEY'),certificatePassword:envString(env,'DATIL_CERTIFICATE_PASSWORD'),
    environment:envString(env,'FACTURACION_ENVIRONMENT')==='PRODUCTION'?2:1,
    timeoutMs:positiveInt(envString(env,'DATIL_REQUEST_TIMEOUT_MS'),12_000),
    issuer:{ruc:envString(env,'DATIL_ISSUER_RUC'),legalName:envString(env,'DATIL_ISSUER_LEGAL_NAME'),
      tradeName:envString(env,'DATIL_ISSUER_TRADE_NAME'),address:envString(env,'DATIL_ISSUER_ADDRESS'),
      accountingRequired:bool(envString(env,'DATIL_ACCOUNTING_REQUIRED')),specialTaxpayer:envString(env,'DATIL_SPECIAL_TAXPAYER'),
      establishmentCode:envString(env,'DATIL_ESTABLISHMENT_CODE'),emissionPoint:envString(env,'DATIL_EMISSION_POINT'),
      establishmentAddress:envString(env,'DATIL_ESTABLISHMENT_ADDRESS')||envString(env,'DATIL_ISSUER_ADDRESS')}
  };
  const i=config.issuer;
  return config.apiKey&&config.certificatePassword&&/^\d{13}$/.test(i.ruc)&&i.legalName&&i.tradeName&&i.address&&
    /^\d{3}$/.test(i.establishmentCode)&&/^\d{3}$/.test(i.emissionPoint)&&i.establishmentAddress?config:null;
}

function field<T=unknown>(row:Record<string,unknown>,camel:string,snake:string):T|undefined{return (row[camel]??row[snake]) as T|undefined;}
function money(value:unknown){const n=Number(value);if(!Number.isFinite(n))throw new FiscalProviderError('INVALID_FISCAL_AMOUNT','Importe fiscal inválido.',false);return Number(n.toFixed(2));}
function fiscalDateTime(value:unknown){const date=value instanceof Date?value:new Date(String(value));
  if(Number.isNaN(date.getTime()))throw new FiscalProviderError('INVALID_FISCAL_DATE','Fecha fiscal inválida.',false);
  return date.toISOString();}
function taxCode(rate:number){const code=new Map([[0,'0'],[5,'5'],[12,'2'],[13,'10'],[14,'3'],[15,'4']]).get(Number(rate.toFixed(3)));if(!code)throw new FiscalProviderError('UNSUPPORTED_VAT_RATE',`Dátil no admite la tarifa de IVA ${rate}%.`,false);return code;}
export function datilIdentificationCode(type:unknown){if(type==='CEDULA')return '05';if(type==='RUC')return '04';throw new FiscalProviderError('UNSUPPORTED_IDENTIFICATION_TYPE','Tipo de identificación fiscal no admitido.',false);}
export function datilPaymentMethod(method:unknown){switch(String(method??'').toUpperCase()){
  case 'CASH':return 'efectivo';case 'BANK_TRANSFER':case 'TRANSFER':case 'TRANSFERENCIA':case 'COOPERATIVE':return 'transferencia';
  case 'DINERO_ELECTRONICO':return 'dinero_electronico_ec';case 'DEUNA':return 'otros';case 'CARD':case 'CREDIT_CARD':return 'tarjeta_credito';
  case 'DEBIT_CARD':return 'tarjeta_debito';case 'DEPOSIT':return 'deposito_cuenta_bancaria';default:return 'otros';
}}
function issuer(c:DatilConfig){return {ruc:c.issuer.ruc,obligado_contabilidad:c.issuer.accountingRequired,
  contribuyente_especial:c.issuer.specialTaxpayer,nombre_comercial:c.issuer.tradeName,razon_social:c.issuer.legalName,
  direccion:c.issuer.address,establecimiento:{punto_emision:c.issuer.emissionPoint,codigo:c.issuer.establishmentCode,direccion:c.issuer.establishmentAddress}};}
function buyer(document:Record<string,unknown>){const p=(field<JsonObject>(document,'fiscalSnapshot','fiscal_snapshot')??{}) as JsonObject;return {
  email:String(p.billingEmail??''),identificacion:String(p.identification??''),tipo_identificacion:datilIdentificationCode(p.identificationType),
  razon_social:String(p.legalName??''),direccion:String(p.address??'')
};}
function taxParts(document:Record<string,unknown>){const subtotal=money(field(document,'subtotal','subtotal')),tax=money(field(document,'taxAmount','tax_amount')),
  total=money(field(document,'total','total')),rate=Number(field(document,'vatRatePercent','vat_rate_percent')??(subtotal?tax*100/subtotal:0));
  if(Math.abs(subtotal+tax-total)>.001)throw new FiscalProviderError('FISCAL_TOTAL_MISMATCH','Subtotal, IVA y total no coinciden.',false);
  const code=taxCode(rate),impuesto={base_imponible:subtotal,valor:tax,codigo:'2',codigo_porcentaje:code};
  return {subtotal,tax,total,rate,impuesto,itemImpuesto:{...impuesto,tarifa:rate}};
}
function commonPayload(document:Record<string,unknown>,config:DatilConfig){const parts=taxParts(document),concept=String(field(document,'concept','concept')??'Servicio Costa-Go'),
  sequential=Number(field(document,'sequential','sequential')),issuedAt=fiscalDateTime(field(document,'issuedAt','issued_at')??new Date()),
  reference=String(field(document,'externalReference','external_reference')??'');
  if(!Number.isInteger(sequential)||sequential<1)throw new FiscalProviderError('FISCAL_SEQUENCE_REQUIRED','El comprobante no tiene secuencial fiscal.',false);
  return {ambiente:config.environment,tipo_emision:1,secuencial:sequential,fecha_emision:issuedAt,emisor:issuer(config),moneda:String(field(document,'currency','currency')??'USD'),
    info_adicional:[{nombre:'Referencia Costa-Go',valor:reference}],
    totales:{total_sin_impuestos:parts.subtotal,impuestos:[parts.impuesto],importe_total:parts.total,propina:0,descuento:0},
    comprador:buyer(document),items:[{cantidad:1,codigo_principal:String(field(document,'serviceType','service_type')??'COSTA-GO').slice(0,25),
      precio_unitario:parts.subtotal,descuento:0,descripcion:concept.slice(0,300),precio_total_sin_impuestos:parts.subtotal,impuestos:[parts.itemImpuesto]}],
    pagos:[{medio:datilPaymentMethod(field(document,'paymentMethod','payment_method')),total:parts.total}],_parts:parts};
}

export function buildDatilInvoicePayload(document:Record<string,unknown>,configOverride?:DatilConfig){const config=configOverride??datilConfig(process.env);if(!config)throw new FiscalProviderError('DATIL_NOT_CONFIGURED','Dátil no está configurado.',false);const {_parts,...payload}=commonPayload(document,config);return payload;}
export function buildDatilCreditNotePayload(document:Record<string,unknown>,configOverride?:DatilConfig){const config=configOverride??datilConfig(process.env);if(!config)throw new FiscalProviderError('DATIL_NOT_CONFIGURED','Dátil no está configurado.',false);
  const {_parts,...base}=commonPayload(document,config);const {pagos:_payments,...withoutPayments}=base;return {...withoutPayments,
    fecha_emision_documento_modificado:fiscalDateTime(field(document,'invoiceIssuedAt','invoice_issued_at')),
    numero_documento_modificado:String(field(document,'invoiceNumber','invoice_number')),tipo_documento_modificado:'01',
    motivo:String(field(document,'reason','reason')??'Anulación o devolución')};}

function messages(data:JsonObject){const lists=[data.mensajes,data.envio_sri?.mensajes,data.autorizacion?.mensajes].filter(Array.isArray).flat();return lists.map((v:any)=>v?.mensaje??v?.message).filter(Boolean).join(' | ');}
function normalizedState(data:JsonObject){return String(data.autorizacion?.estado??data.estado??data.envio_sri?.estado??'RECIBIDO').trim().toUpperCase();}
function normalize(data:JsonObject,fallback:Record<string,unknown>,config:DatilConfig):ProviderResult {
  const state=normalizedState(data),remoteId=String(data.id??field(fallback,'remoteId','remote_id')??'');
  if(!remoteId)throw new FiscalProviderError('DATIL_RESPONSE_WITHOUT_ID','Dátil respondió sin identificador de comprobante.',true);
  const status:ProviderResult['status']=state==='AUTORIZADO'?'AUTORIZADA':['NO AUTORIZADO','NO_AUTORIZADO','DEVUELTO','DEVUELTA','ERROR','CREADO'].includes(state)?'RECHAZADA':'RECIBIDA';
  const totals=data.totales??{},tax=Array.isArray(totals.impuestos)?totals.impuestos.reduce((sum:number,v:any)=>sum+Number(v.valor??0),0):field(fallback,'taxAmount','tax_amount');
  const seq=Number(data.secuencial??field(fallback,'sequential','sequential'));
  const number=String(data.numero??(seq?`${config.issuer.establishmentCode}-${config.issuer.emissionPoint}-${String(seq).padStart(9,'0')}`:''));
  return {status,remoteId,providerStatus:state,reasonCode:status==='RECHAZADA'?String(data.autorizacion?.mensajes?.[0]?.identificador??state):undefined,
    reason:messages(data)||undefined,number:number||undefined,accessKey:String(data.clave_acceso??'')||undefined,
    authorization:String(data.autorizacion?.numero??'')||undefined,authorizedAt:String(data.autorizacion?.fecha??'')||undefined,
    subtotal:totals.total_sin_impuestos==null?undefined:Number(totals.total_sin_impuestos),tax:tax==null?undefined:Number(tax),
    xml:String(data.url_documento_electronico??'')||undefined,ride:String(data.url_formato_impresion??'')||undefined,
    emailSent:Array.isArray(data.correos_enviados)&&data.correos_enviados.length>0};
}

export class DatilProvider implements ProveedorFacturacion {
  readonly name='DATIL';readonly configured:boolean;private readonly config:DatilConfig|null;
  constructor(private readonly fetcher:typeof fetch=fetch,env:NodeJS.ProcessEnv=process.env){this.config=datilConfig(env);this.configured=Boolean(this.config);}
  private unavailable():ProviderUnavailable{return {status:'PENDIENTE_INTEGRACION',reason:'Faltan credenciales o datos del emisor Dátil'};}
  private async request(path:string,init:RequestInit={},certificate=false):Promise<JsonObject>{const config=this.config;if(!config)throw new FiscalProviderError('DATIL_NOT_CONFIGURED','Dátil no está configurado.',false);
    const headers=new Headers(init.headers);headers.set('Accept','application/json');headers.set('X-Key',config.apiKey);if(certificate)headers.set('X-Password',config.certificatePassword);if(init.body)headers.set('Content-Type','application/json');
    let response:Response;try{response=await this.fetcher(`${config.baseUrl}${path}`,{...init,headers,signal:AbortSignal.timeout(config.timeoutMs)});}catch(error){throw new FiscalProviderError('DATIL_NETWORK_ERROR',error instanceof Error?error.message:'No fue posible conectar con Dátil.',true);}
    const text=await response.text();let body:JsonObject={};try{body=text?JSON.parse(text):{};}catch{body={message:text.slice(0,500)};}
    if(!response.ok){const code=String(body.code??`DATIL_HTTP_${response.status}`),detail=body.details??body.message??body.error??body.errores??body.errors;
      const message=detail==null?`Dátil respondió HTTP ${response.status}`:typeof detail==='string'?detail:JSON.stringify(detail);
      throw new FiscalProviderError(code,message,response.status===408||response.status===429||response.status>=500,response.status);}
    return body;
  }
  async emitirFactura(document:Record<string,unknown>){if(!this.config)return this.unavailable();const body=buildDatilInvoicePayload(document,this.config),idempotency=idempotencyKey(document);
    const data=await this.request('/invoices/issue',{method:'POST',headers:{'Idempotency-key':idempotency},body:JSON.stringify(body)},true);return normalize(data,document,this.config);}
  async consultarEstado(reference:string){if(!this.config)return this.unavailable();return normalize(await this.request(`/invoices/${encodeURIComponent(reference)}`),{remoteId:reference},this.config);}
  private async artifact(reference:string,kind:'xml'|'pdf'):Promise<ProviderArtifact|ProviderUnavailable>{if(!this.config)return this.unavailable();const data=await this.request(`/invoices/${encodeURIComponent(reference)}`),url=kind==='xml'?data.url_documento_electronico:data.url_formato_impresion;
    return {url:String(url||`https://app.datil.co/ver/${encodeURIComponent(reference)}/${kind}`)};}
  obtenerXml(reference:string){return this.artifact(reference,'xml');}
  obtenerRide(reference:string){return this.artifact(reference,'pdf');}
  async reenviarCorreo(reference:string,emails?:string[]){if(!this.config)return this.unavailable();const body=emails?.length?JSON.stringify({destinatarios:emails}):undefined;
    const data=await this.request(`/edocs/send-email/${encodeURIComponent(reference)}`,{method:'POST',body});return {sent:true,result:String(data.result??'')||undefined};}
  async crearNotaCredito(_reference:string,input:Record<string,unknown>){if(!this.config)return this.unavailable();const body=buildDatilCreditNotePayload(input,this.config),idempotency=idempotencyKey(input);
    const data=await this.request('/credit-notes/issue',{method:'POST',headers:{'Idempotency-key':idempotency},body:JSON.stringify(body)},true);return normalize(data,input,this.config);}
  async consultarNotaCredito(reference:string){if(!this.config)return this.unavailable();return normalize(await this.request(`/credit-notes/${encodeURIComponent(reference)}`,{},true),{remoteId:reference},this.config);}
}
export class AzurProvider extends UnconfiguredProvider {constructor(){super('AZUR');}}
export class SriProvider extends UnconfiguredProvider {constructor(){super('SRI');}}

export function billingConfiguration(){const cutoverRaw=process.env.FACTURACION_CUTOVER_AT?.trim()??'',cutoverDate=cutoverRaw?new Date(cutoverRaw):null;
  const testOrderRaw=process.env.FACTURACION_TEST_ORDER_CODE?.trim().toUpperCase()??'';
  return {enabled:process.env.FACTURACION_ENABLED==='true',provider:process.env.FACTURACION_PROVIDER??'DATIL',environment:process.env.FACTURACION_ENVIRONMENT??'TEST',
    emailMode:process.env.FACTURACION_EMAIL_MODE??'PROVIDER',smtpEnabled:process.env.FACTURACION_SMTP_ENABLED==='true',fromEmail:process.env.FACTURACION_FROM_EMAIL??'',
    cutoverAt:cutoverDate&&!Number.isNaN(cutoverDate.getTime())?cutoverDate:null,
    testOrderCode:/^[A-Z0-9-]{3,32}$/.test(testOrderRaw)?testOrderRaw:null,
    webhookReady:Boolean((process.env.DATIL_WEBHOOK_TOKEN??'').trim().length>=32)};
}
export function billingProvider():ProveedorFacturacion {switch(billingConfiguration().provider){case 'AZUR':return new AzurProvider();case 'SRI':return new SriProvider();default:return new DatilProvider();}}
export function datilSequenceConfiguration(){return {establishment:envString(process.env,'DATIL_ESTABLISHMENT_CODE'),emissionPoint:envString(process.env,'DATIL_EMISSION_POINT'),
  invoiceInitial:positiveInt(envString(process.env,'DATIL_INVOICE_INITIAL_SEQUENCE'),1),creditNoteInitial:positiveInt(envString(process.env,'DATIL_CREDIT_NOTE_INITIAL_SEQUENCE'),1)};}
