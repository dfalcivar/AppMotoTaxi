export type ProviderResult = {status:'PENDIENTE_INTEGRACION';reason:string} |
  {status:'RECHAZADA'|'RECIBIDA';reasonCode:string} |
  {status:'AUTORIZADA';number:string;accessKey:string;authorization:string;authorizedAt:string;subtotal:number;tax:number;xml:string;ride:string;emailSent:boolean};
export interface ProveedorFacturacion {
  readonly name:string;
  readonly configured:boolean;
  emitirFactura(document:Record<string,unknown>):Promise<ProviderResult>;
  consultarEstado(reference:string):Promise<ProviderResult>;
  obtenerXml(reference:string):Promise<ProviderResult>;
  obtenerRide(reference:string):Promise<ProviderResult>;
  reenviarCorreo(reference:string):Promise<ProviderResult>;
  crearNotaCredito(reference:string,input:Record<string,unknown>):Promise<ProviderResult>;
}
class UnconfiguredProvider implements ProveedorFacturacion {
  readonly configured=false;
  constructor(readonly name:string){}
  private async unavailable():Promise<ProviderResult>{return {status:'PENDIENTE_INTEGRACION',reason:'Proveedor aún no contratado/configurado'};}
  emitirFactura(_document:Record<string,unknown>){return this.unavailable();}
  consultarEstado(_reference:string){return this.unavailable();}
  obtenerXml(_reference:string){return this.unavailable();}
  obtenerRide(_reference:string){return this.unavailable();}
  reenviarCorreo(_reference:string){return this.unavailable();}
  crearNotaCredito(_reference:string,_input:Record<string,unknown>){return this.unavailable();}
}
export class DatilProvider extends UnconfiguredProvider {constructor(){super('DATIL');}}
export class AzurProvider extends UnconfiguredProvider {constructor(){super('AZUR');}}
export class SriProvider extends UnconfiguredProvider {constructor(){super('SRI');}}
export function billingConfiguration(){
  return {enabled:process.env.FACTURACION_ENABLED==='true',provider:process.env.FACTURACION_PROVIDER??'DATIL',
    environment:process.env.FACTURACION_ENVIRONMENT??'TEST',emailMode:process.env.FACTURACION_EMAIL_MODE??'PROVIDER',
    smtpEnabled:process.env.FACTURACION_SMTP_ENABLED==='true',fromEmail:process.env.FACTURACION_FROM_EMAIL??''};
}
export function billingProvider():ProveedorFacturacion {
  switch(billingConfiguration().provider){case 'AZUR':return new AzurProvider();case 'SRI':return new SriProvider();default:return new DatilProvider();}
}
