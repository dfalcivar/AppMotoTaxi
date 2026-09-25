import { database } from '../database.js';
import { billingConfiguration,billingProvider,datilSequenceConfiguration,FiscalProviderError,
  type ProviderResult,type ProviderUnavailable,type ProveedorFacturacion } from './providers.js';

type FiscalRow=Record<string,any>;
type CreditNoteInput={amount:number;reason:string;idempotencyKey:string};
const isUnavailable=(result:ProviderResult|ProviderUnavailable):result is ProviderUnavailable=>result.status==='PENDIENTE_INTEGRACION';
const cents=(value:unknown)=>Math.round(Number(value)*100);
const errorText=(error:unknown)=>error instanceof Error?error.message.slice(0,500):'Error desconocido del proveedor';
const errorCode=(error:unknown)=>error instanceof FiscalProviderError?error.code:'FISCAL_PROVIDER_ERROR';
const retryable=(error:unknown)=>!(error instanceof FiscalProviderError)||error.retryable;
const delaySeconds=(attempt:number)=>Math.min(3600,30*Math.pow(2,Math.max(0,attempt-1)));

export class FacturaService {
  constructor(private provider:ProveedorFacturacion=billingProvider()){}
  private ensureProviderEnabled(){const config=billingConfiguration();if(!config.enabled||!config.cutoverAt||!this.provider.configured||(config.environment==='TEST'&&!config.testOrderCode&&!config.testDriverId&&!config.testAdvertisingPaymentId))throw new Error('FISCAL_PROVIDER_DISABLED');return config;}

  async collectCommittedPayments() {
    const config=billingConfiguration();
    return database().begin(async tx=>{
      const jobs=await tx`select * from fiscal_billing_outbox where processed_at is null and not payment_reversed order by created_at limit 100 for update skip locked`;
      for(const job of jobs){
        const reference=`costago:${job.source}:${job.payment_id}:${job.document_type}`;
        const [testOrder]=config.environment==='TEST'&&job.source==='MEMBRESIA'
          ?await tx`select 1 from membership_payments p join membership_payment_orders o on o.id=p.order_id where p.id=${job.payment_id}
            and (upper(o.short_code)=${config.testOrderCode} or (o.driver_id=${config.testDriverId}::uuid and o.purpose in ('WALLET_TOPUP','MEMBERSHIP')))`:[];
        const selectedAdvertisingPayment=job.source==='PUBLICIDAD'&&job.payment_id===config.testAdvertisingPaymentId;
        const eligible=Boolean(config.cutoverAt&&new Date(job.paid_at)>=config.cutoverAt&&job.fiscal_snapshot&&
          (config.environment!=='TEST'||testOrder||selectedAdvertisingPayment));
        const [invoice]=await tx`insert into fiscal_invoices(external_reference,source,service_type,zone_id,payment_id,document_type,
          client_id,fiscal_snapshot,concept,subtotal,tax_amount,total,currency,provider,environment,email_to,paid_at,status,
          payment_method,vat_rate_percent,emission_eligible,next_attempt_at)
          values(${reference},${job.source},${job.service_type},${job.zone_id},${job.payment_id},${job.document_type},${job.client_id},
          ${job.fiscal_snapshot},${job.concept},${job.subtotal},${job.tax_amount},${job.amount},${job.currency},${config.provider},${config.environment},
          ${((job.fiscal_snapshot??{}) as {billingEmail?:string}).billingEmail??null},${job.paid_at},${eligible?'PENDIENTE':'PENDIENTE_INTEGRACION'},
          ${job.payment_method??null},${job.vat_rate_percent??null},${eligible},${eligible?new Date():null})
          on conflict(source,payment_id,document_type) do nothing returning id::text`;
        if(invoice)await tx`insert into fiscal_audit(client_id,entity_type,entity_id,event_type,actor_process)
          values(${job.client_id},'FACTURA',${invoice.id},${eligible?'FacturaPreparada':'FacturaRetenidaPorCorte'},'BILLING_OUTBOX')`;
        await tx`update fiscal_billing_outbox set processed_at=now() where id=${job.id}`;
      }
      return jobs.length;
    });
  }

  private async allocateInvoiceSequence(invoiceId:string){const config=billingConfiguration(),seq=datilSequenceConfiguration();
    return database().begin(async tx=>{
      const [row]=await tx`select sequential,issued_at from fiscal_invoices where id=${invoiceId} for update`;
      if(row?.sequential)return row;
      const [allocated]=await tx`select allocate_fiscal_sequence('FACTURA',${config.environment},${seq.establishment},${seq.emissionPoint},${seq.invoiceInitial}) as value`;
      if(!allocated)throw new Error('FISCAL_SEQUENCE_ALLOCATION_FAILED');
      const [updated]=await tx`update fiscal_invoices set sequential=${allocated.value},issued_at=coalesce(issued_at,now()),updated_at=now() where id=${invoiceId} returning sequential,issued_at`;
      return updated;
    });
  }

  private async applyInvoiceResult(invoice:FiscalRow,result:ProviderResult){
    const validAuthorization=result.status!=='AUTORIZADA'||Boolean(result.number&&result.accessKey&&result.authorization&&result.authorizedAt);
    const totalsMatch=result.status!=='AUTORIZADA'||((result.subtotal==null||cents(result.subtotal)===cents(invoice.subtotal))&&(result.tax==null||cents(result.tax)===cents(invoice.tax_amount)));
    if(!totalsMatch)throw new FiscalProviderError('DATIL_TOTAL_MISMATCH','Los totales autorizados por Dátil no coinciden con el documento local.',false);
    const status=result.status==='AUTORIZADA'&&!validAuthorization?'RECIBIDA':result.status;
    await database().begin(async tx=>{
      await tx`update fiscal_invoices set status=${status},remote_id=${result.remoteId},provider_status=${result.providerStatus},
        document_number=coalesce(${result.number??null},document_number),access_key=coalesce(${result.accessKey??null},access_key),
        authorization_number=coalesce(${result.authorization??null},authorization_number),authorized_at=coalesce(${result.authorizedAt??null},authorized_at),
        xml_location=coalesce(${result.xml??null},xml_location),ride_location=coalesce(${result.ride??null},ride_location),
        email_sent=email_sent or ${Boolean(result.emailSent)},email_sent_at=case when email_sent or ${Boolean(result.emailSent)} then coalesce(email_sent_at,now()) else null end,
        email_status=case when email_sent or ${Boolean(result.emailSent)} then 'ENVIADO' else email_status end,
        next_attempt_at=${status==='RECIBIDA'?new Date(Date.now()+30_000):null},last_provider_check_at=now(),
        provider_error_code=${result.reasonCode??null},provider_error_message=${result.reason??null},updated_at=now() where id=${invoice.id}`;
      await tx`insert into fiscal_audit(client_id,entity_type,entity_id,event_type,result,actor_process)
        values(${invoice.client_id},'FACTURA',${invoice.id},${status==='AUTORIZADA'?'FacturaAutorizada':status==='RECHAZADA'?'FacturaRechazada':'FacturaRecibida'},
          ${result.reasonCode??'SUCCESS'},'BILLING_WORKER')`;
    });
  }

  private async failInvoice(invoice:FiscalRow,error:unknown){const attempt=Math.max(1,Number(invoice.attempt_count??1)),isRetryable=retryable(error),status=isRetryable?'PENDIENTE_REINTENTO':'ERROR';
    await database().begin(async tx=>{
      await tx`update fiscal_invoices set status=${status},attempt_count=${attempt},provider_error_code=${errorCode(error)},provider_error_message=${errorText(error)},
        next_attempt_at=${isRetryable?new Date(Date.now()+delaySeconds(attempt)*1000):null},last_provider_check_at=now(),updated_at=now() where id=${invoice.id}`;
      await tx`insert into fiscal_audit(client_id,entity_type,entity_id,event_type,result,actor_process)
        values(${invoice.client_id},'FACTURA',${invoice.id},${isRetryable?'FacturaReintentada':'FacturaConError'},${errorCode(error)},'BILLING_WORKER')`;
    });
  }

  async processPending() {
    const config=billingConfiguration();if(!config.enabled||!config.cutoverAt||!this.provider.configured||(config.environment==='TEST'&&!config.testOrderCode&&!config.testDriverId&&!config.testAdvertisingPaymentId))return;
    if(config.environment==='TEST'&&config.testAdvertisingPaymentId){
      // A payment collected before this one-payment allowlist was configured already has
      // a durable local invoice. Promote that document only; never create a second one.
      const promoted=await database()`update fiscal_invoices i set status='PENDIENTE',emission_eligible=true,next_attempt_at=now(),updated_at=now()
        from fiscal_billing_outbox o where i.source='PUBLICIDAD' and i.payment_id=${config.testAdvertisingPaymentId}::uuid
          and i.status='PENDIENTE_INTEGRACION' and not i.emission_eligible and i.provider=${config.provider} and i.environment='TEST'
          and i.fiscal_snapshot is not null and i.paid_at>=${config.cutoverAt} and o.source=i.source and o.payment_id=i.payment_id
          and o.document_type=i.document_type and not o.payment_reversed and o.paid_at>=${config.cutoverAt}
        returning i.id,i.client_id`;
      for(const invoice of promoted)await database()`insert into fiscal_audit(client_id,entity_type,entity_id,event_type,actor_process)
        values(${invoice.client_id},'FACTURA',${invoice.id},'FacturaHabilitadaParaPrueba','BILLING_WORKER')`;
    }
    const rows=await database()`update fiscal_invoices set status='ENVIANDO',attempt_count=attempt_count+1,updated_at=now()
      where id in (select id from fiscal_invoices where emission_eligible and fiscal_snapshot is not null
        and (status in ('PENDIENTE','PENDIENTE_REINTENTO','RECIBIDA') or (status='ENVIANDO' and updated_at<now()-interval '10 minutes'))
        and coalesce(next_attempt_at,now())<=now() and provider=${config.provider} and environment=${config.environment}
        and (${config.environment}<>'TEST' or (source='PUBLICIDAD' and payment_id=${config.testAdvertisingPaymentId}::uuid)
          or (source='MEMBRESIA' and exists(select 1 from membership_payments p join membership_payment_orders o on o.id=p.order_id where p.id=fiscal_invoices.payment_id
          and (upper(o.short_code)=${config.testOrderCode} or (o.driver_id=${config.testDriverId}::uuid and o.purpose in ('WALLET_TOPUP','MEMBERSHIP'))))))
        and not exists(select 1 from fiscal_billing_outbox o where o.source=fiscal_invoices.source and o.payment_id=fiscal_invoices.payment_id and o.payment_reversed)
        order by created_at limit 10 for update skip locked) returning *`;
    for(let invoice of rows){
      try{
        if(!invoice.remote_id){await this.allocateInvoiceSequence(String(invoice.id));[invoice]=await database()`select * from fiscal_invoices where id=${invoice.id}`;}
        await database()`insert into fiscal_audit(client_id,entity_type,entity_id,event_type,actor_process) values(${invoice.client_id},'FACTURA',${invoice.id},${invoice.remote_id?'FacturaConsultada':'FacturaEnviada'},'BILLING_WORKER')`;
        const result=invoice.remote_id?await this.provider.consultarEstado(String(invoice.remote_id)):await this.provider.emitirFactura(invoice);
        if(isUnavailable(result))throw new FiscalProviderError('FISCAL_PROVIDER_DISABLED',result.reason,false);
        await this.applyInvoiceResult(invoice,result);
      }catch(error){await this.failInvoice(invoice,error);}
    }
    await this.processPendingCreditNotes();
  }

  async reconcileInvoice(id:string){this.ensureProviderEnabled();const [invoice]=await database()`select * from fiscal_invoices where id=${id}`;
    if(!invoice)throw new Error('FISCAL_INVOICE_NOT_FOUND');if(!invoice.emission_eligible||!invoice.remote_id)throw new Error('FISCAL_DOCUMENT_NOT_EMITTED');
    const result=await this.provider.consultarEstado(String(invoice.remote_id));if(isUnavailable(result))throw new Error('FISCAL_PROVIDER_DISABLED');await this.applyInvoiceResult(invoice,result);return result;
  }
  async retryInvoice(id:string){this.ensureProviderEnabled();const [row]=await database()`update fiscal_invoices set status='PENDIENTE_REINTENTO',next_attempt_at=now(),updated_at=now()
    where id=${id} and emission_eligible and status in ('ERROR','RECHAZADA','PENDIENTE_REINTENTO','RECIBIDA') returning id::text,status`;
    if(!row)throw new Error('FISCAL_DOCUMENT_NOT_RETRYABLE');return row;
  }
  async artifact(id:string,kind:'xml'|'ride'){this.ensureProviderEnabled();const [invoice]=await database()`select remote_id,status from fiscal_invoices where id=${id}`;
    if(!invoice?.remote_id||invoice.status!=='AUTORIZADA')throw new Error('FISCAL_DOCUMENT_NOT_AUTHORIZED');const result=kind==='xml'?await this.provider.obtenerXml(String(invoice.remote_id)):await this.provider.obtenerRide(String(invoice.remote_id));
    if('status' in result)throw new Error('FISCAL_PROVIDER_DISABLED');
    if(kind==='xml')await database()`update fiscal_invoices set xml_location=${result.url},updated_at=now() where id=${id}`;
    else await database()`update fiscal_invoices set ride_location=${result.url},updated_at=now() where id=${id}`;
    return result;
  }
  async resendEmail(id:string){this.ensureProviderEnabled();const [invoice]=await database()`select remote_id,status,email_to,client_id from fiscal_invoices where id=${id}`;
    if(!invoice?.remote_id||invoice.status!=='AUTORIZADA')throw new Error('FISCAL_DOCUMENT_NOT_AUTHORIZED');const result=await this.provider.reenviarCorreo(String(invoice.remote_id),invoice.email_to?[String(invoice.email_to)]:undefined);
    if('status' in result)throw new Error('FISCAL_PROVIDER_DISABLED');await database()`update fiscal_invoices set email_sent=true,email_sent_at=now(),email_status='ENVIADO',updated_at=now() where id=${id}`;
    await database()`insert into fiscal_audit(client_id,entity_type,entity_id,event_type,actor_process) values(${invoice.client_id},'FACTURA',${id},'FacturaReenviada','ADMIN')`;return result;
  }

  async createCreditNote(invoiceId:string,input:CreditNoteInput){const config=this.ensureProviderEnabled();
    return database().begin(async tx=>{
      const [invoice]=await tx`select * from fiscal_invoices where id=${invoiceId} and status='AUTORIZADA' for update`;if(!invoice)throw new Error('FISCAL_DOCUMENT_NOT_AUTHORIZED');
      if(!invoice.emission_eligible||invoice.provider!==config.provider||invoice.environment!==config.environment)throw new Error('FISCAL_DOCUMENT_NOT_AUTHORIZED');
      if(config.environment==='TEST'&&invoice.source!=='PUBLICIDAD'){
        const [selected]=await tx`select 1 from membership_payments p join membership_payment_orders o on o.id=p.order_id where p.id=${invoice.payment_id}
          and (upper(o.short_code)=${config.testOrderCode} or (o.driver_id=${config.testDriverId}::uuid and o.purpose in ('WALLET_TOPUP','MEMBERSHIP')))`;
        if(invoice.source!=='MEMBRESIA'||!selected)throw new Error('FISCAL_DOCUMENT_NOT_AUTHORIZED');
      }
      if(config.environment==='TEST'&&invoice.source==='PUBLICIDAD'&&invoice.payment_id!==config.testAdvertisingPaymentId)throw new Error('FISCAL_DOCUMENT_NOT_AUTHORIZED');
      const total=cents(invoice.total),amount=cents(input.amount);if(amount<1||amount>total)throw new Error('INVALID_CREDIT_NOTE_AMOUNT');
      const [existing]=await tx`select id::text,status from fiscal_credit_notes where idempotency_key=${input.idempotencyKey}::uuid`;if(existing)return existing;
      const [reserved]=await tx`select coalesce(sum(amount),0) as amount from fiscal_credit_notes
        where invoice_id=${invoiceId} and status not in ('ERROR','RECHAZADA','ANULADA')`;
      if(amount>total-cents(reserved?.amount??0))throw new Error('INVALID_CREDIT_NOTE_AMOUNT');
      const subtotal=Math.round(cents(invoice.subtotal)*amount/total)/100,tax=amount/100-subtotal;
      const [note]=await tx`insert into fiscal_credit_notes(invoice_id,external_reference,fiscal_snapshot,amount,status,idempotency_key,provider,environment,
        reason,subtotal,tax_amount,vat_rate_percent,issued_at,emission_eligible,next_attempt_at)
        values(${invoiceId},${`costago:credit:${input.idempotencyKey}`},${invoice.fiscal_snapshot},${amount/100},'PENDIENTE',${input.idempotencyKey}::uuid,
        ${config.provider},${config.environment},${input.reason},${subtotal},${tax},${invoice.vat_rate_percent},now(),true,now()) returning id::text,status`;
      if(!note)throw new Error('FISCAL_CREDIT_NOTE_CREATION_FAILED');
      await tx`insert into fiscal_audit(client_id,entity_type,entity_id,event_type,actor_process) values(${invoice.client_id},'NOTA_CREDITO',${note.id},'NotaCreditoPreparada','ADMIN')`;return note;
    });
  }

  async retryCreditNote(noteId:string){const config=this.ensureProviderEnabled();
    return database().begin(async tx=>{
      const [note]=await tx`select n.id::text,n.invoice_id::text,n.amount,n.status,n.remote_id,n.provider,n.environment,
        n.emission_eligible,i.source,i.payment_id,i.total,i.client_id from fiscal_credit_notes n
        join fiscal_invoices i on i.id=n.invoice_id where n.id=${noteId} for update of i,n`;
      if(!note||note.status!=='ERROR'||note.remote_id||!note.emission_eligible||
        note.provider!==config.provider||note.environment!==config.environment)throw new Error('FISCAL_DOCUMENT_NOT_RETRYABLE');
      if(config.environment==='TEST'){
        if(note.source==='PUBLICIDAD'){
          if(note.payment_id!==config.testAdvertisingPaymentId)throw new Error('FISCAL_DOCUMENT_NOT_AUTHORIZED');
        }else if(note.source==='MEMBRESIA'){
          const [selected]=await tx`select 1 from membership_payments p join membership_payment_orders o on o.id=p.order_id
            where p.id=${note.payment_id} and (upper(o.short_code)=${config.testOrderCode}
              or (o.driver_id=${config.testDriverId}::uuid and o.purpose in ('WALLET_TOPUP','MEMBERSHIP')))`;
          if(!selected)throw new Error('FISCAL_DOCUMENT_NOT_AUTHORIZED');
        }else throw new Error('FISCAL_DOCUMENT_NOT_AUTHORIZED');
      }
      const [reserved]=await tx`select coalesce(sum(amount),0) as amount from fiscal_credit_notes
        where invoice_id=${note.invoice_id} and id<>${noteId} and status not in ('ERROR','RECHAZADA','ANULADA')`;
      if(cents(note.amount)>cents(note.total)-cents(reserved?.amount??0))throw new Error('INVALID_CREDIT_NOTE_AMOUNT');
      const [updated]=await tx`update fiscal_credit_notes set status='PENDIENTE_REINTENTO',next_attempt_at=now(),
        provider_error_code=null,provider_error_message=null,updated_at=now() where id=${noteId} returning id::text,status`;
      await tx`insert into fiscal_audit(client_id,entity_type,entity_id,event_type,actor_process)
        values(${note.client_id},'NOTA_CREDITO',${noteId},'NotaCreditoReintentada','ADMIN')`;
      return updated;
    });
  }

  private async processPendingCreditNotes(){const config=billingConfiguration();if(!config.enabled||!config.cutoverAt||!this.provider.configured||(config.environment==='TEST'&&!config.testOrderCode&&!config.testDriverId&&!config.testAdvertisingPaymentId))return;const seq=datilSequenceConfiguration();
    const notes=await database()`update fiscal_credit_notes set status='ENVIANDO',attempt_count=attempt_count+1,updated_at=now() where id in
      (select id from fiscal_credit_notes where emission_eligible and (status in ('PENDIENTE','PENDIENTE_REINTENTO','RECIBIDA') or (status='ENVIANDO' and updated_at<now()-interval '10 minutes'))
       and coalesce(next_attempt_at,now())<=now() and provider=${config.provider} and environment=${config.environment}
       and (${config.environment}<>'TEST' or exists(select 1 from fiscal_invoices i where i.id=fiscal_credit_notes.invoice_id
         and i.source='PUBLICIDAD' and i.payment_id=${config.testAdvertisingPaymentId}::uuid)
         or exists(select 1 from fiscal_invoices i join membership_payments p on p.id=i.payment_id join membership_payment_orders o on o.id=p.order_id where i.id=fiscal_credit_notes.invoice_id and i.source='MEMBRESIA'
         and (upper(o.short_code)=${config.testOrderCode} or (o.driver_id=${config.testDriverId}::uuid and o.purpose in ('WALLET_TOPUP','MEMBERSHIP')))))
       order by created_at limit 5 for update skip locked) returning *`;
    for(let note of notes){try{
      if(!note.sequential){const [allocated]=await database()`select allocate_fiscal_sequence('NOTA_CREDITO',${config.environment},${seq.establishment},${seq.emissionPoint},${seq.creditNoteInitial}) as value`;
        if(!allocated)throw new Error('FISCAL_SEQUENCE_ALLOCATION_FAILED');
        [note]=await database()`update fiscal_credit_notes set sequential=${allocated.value},issued_at=coalesce(issued_at,now()) where id=${note.id} returning *`;}
      const [invoice]=await database()`select document_number as invoice_number,issued_at as invoice_issued_at,currency,concept,service_type,payment_method,
        client_id,fiscal_snapshot from fiscal_invoices where id=${note.invoice_id}`;if(!invoice)throw new Error('FISCAL_INVOICE_NOT_FOUND');const document={...note,...invoice,total:note.amount};
      let result:ProviderResult|ProviderUnavailable;if(note.remote_id&&this.provider.consultarNotaCredito)result=await this.provider.consultarNotaCredito(String(note.remote_id));
      else result=await this.provider.crearNotaCredito(String(note.invoice_id),document);if(isUnavailable(result))throw new Error(result.reason);
      const validAuthorization=result.status!=='AUTORIZADA'||Boolean(result.number&&result.accessKey&&result.authorization&&result.authorizedAt),
        totalsMatch=result.status!=='AUTORIZADA'||((result.subtotal==null||cents(result.subtotal)===cents(note.subtotal))&&(result.tax==null||cents(result.tax)===cents(note.tax_amount)));
      if(!totalsMatch)throw new FiscalProviderError('DATIL_TOTAL_MISMATCH','Los totales autorizados por Dátil no coinciden con la nota de crédito local.',false);
      const status=result.status==='AUTORIZADA'&&!validAuthorization?'RECIBIDA':result.status;
      await database().begin(async tx=>{
        await tx`update fiscal_credit_notes set status=${status},remote_id=${result.remoteId},provider_status=${result.providerStatus},
          document_number=coalesce(${result.number??null},document_number),access_key=coalesce(${result.accessKey??null},access_key),authorization_number=coalesce(${result.authorization??null},authorization_number),
          authorized_at=coalesce(${result.authorizedAt??null},authorized_at),xml_location=coalesce(${result.xml??null},xml_location),ride_location=coalesce(${result.ride??null},ride_location),
          next_attempt_at=${status==='RECIBIDA'?new Date(Date.now()+30_000):null},last_provider_check_at=now(),provider_error_code=${result.reasonCode??null},provider_error_message=${result.reason??null},updated_at=now() where id=${note.id}`;
        await tx`insert into fiscal_audit(client_id,entity_type,entity_id,event_type,result,actor_process)
          values(${invoice.client_id},'NOTA_CREDITO',${note.id},${status==='AUTORIZADA'?'NotaCreditoAutorizada':status==='RECHAZADA'?'NotaCreditoRechazada':'NotaCreditoRecibida'},${result.reasonCode??'SUCCESS'},'BILLING_WORKER')`;
      });
    }catch(error){const attempt=Number(note.attempt_count??1),again=retryable(error);await database()`update fiscal_credit_notes set status=${again?'PENDIENTE_REINTENTO':'ERROR'},
      provider_error_code=${errorCode(error)},provider_error_message=${errorText(error)},next_attempt_at=${again?new Date(Date.now()+delaySeconds(attempt)*1000):null},updated_at=now() where id=${note.id}`;}}
  }
}
