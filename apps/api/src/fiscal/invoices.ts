import { database } from '../database.js';
import { billingConfiguration,billingProvider,type ProveedorFacturacion } from './providers.js';

export class FacturaService {
  constructor(private provider:ProveedorFacturacion=billingProvider()){}
  async collectCommittedPayments() {
    const config=billingConfiguration();
    return database().begin(async tx=>{
      const jobs=await tx`select * from fiscal_billing_outbox where processed_at is null and not payment_reversed order by created_at limit 100 for update skip locked`;
      for(const job of jobs){
        const reference=`costago:${job.source}:${job.payment_id}:${job.document_type}`;
        const [invoice]=await tx`insert into fiscal_invoices(external_reference,source,service_type,zone_id,payment_id,document_type,
          client_id,fiscal_snapshot,concept,total,currency,provider,environment,email_to,paid_at,status)
          values(${reference},${job.source},${job.service_type},${job.zone_id},${job.payment_id},${job.document_type},${job.client_id},
          ${job.fiscal_snapshot},${job.concept},${job.amount},${job.currency},${config.provider},${config.environment},
          ${((job.fiscal_snapshot??{}) as {billingEmail?:string}).billingEmail??null},${job.paid_at},
          ${config.enabled&&this.provider.configured?'PENDIENTE':'PENDIENTE_INTEGRACION'})
          on conflict(source,payment_id,document_type) do nothing returning id::text`;
        if(invoice)await tx`insert into fiscal_audit(client_id,entity_type,entity_id,event_type,actor_process)
          values(${job.client_id},'FACTURA',${invoice.id},'FacturaCreada','BILLING_OUTBOX')`;
        await tx`update fiscal_billing_outbox set processed_at=now() where id=${job.id}`;
      }
      return jobs.length;
    });
  }
  async processPending() {
    const config=billingConfiguration();
    if(!config.enabled||!this.provider.configured)return; // No calls at all in disabled/unconfigured mode.
    // A future adapter receives the same stable ExternalReference after any crash/retry.
    const rows=await database()`update fiscal_invoices set status='ENVIANDO',updated_at=now()
      where id in (select id from fiscal_invoices where (status in ('PENDIENTE','PENDIENTE_REINTENTO','PENDIENTE_INTEGRACION')
        or (status='ENVIANDO' and updated_at<now()-interval '10 minutes')) and fiscal_snapshot is not null
        and provider=${config.provider} and environment=${config.environment}
        and not exists(select 1 from fiscal_billing_outbox o where o.source=fiscal_invoices.source and o.payment_id=fiscal_invoices.payment_id and o.payment_reversed)
        order by created_at limit 10 for update skip locked)
      returning *`;
    for(const invoice of rows){
      try{
        await database()`insert into fiscal_audit(client_id,entity_type,entity_id,event_type,actor_process)
          values(${invoice.client_id},'FACTURA',${invoice.id},'FacturaEnviada','BILLING_WORKER')`;
        const result=await this.provider.emitirFactura(invoice);
        if(result.status==='AUTORIZADA'){
          await database().begin(async tx=>{
            await tx`update fiscal_invoices set status='AUTORIZADA',document_number=${result.number},access_key=${result.accessKey},
              authorization_number=${result.authorization},authorized_at=${result.authorizedAt},issued_at=now(),
              subtotal=${result.subtotal},tax_amount=${result.tax},xml_location=${result.xml},ride_location=${result.ride},
              email_sent=${result.emailSent},email_sent_at=${result.emailSent?new Date():null},email_status=${result.emailSent?'ENVIADO':'PENDIENTE'},updated_at=now()
              where id=${invoice.id} and status='ENVIANDO'`;
            await tx`insert into fiscal_audit(client_id,entity_type,entity_id,event_type,actor_process)
              values(${invoice.client_id},'FACTURA',${invoice.id},'FacturaAutorizada','BILLING_WORKER')`;
          });
        }else {
          await database()`update fiscal_invoices set status=${result.status},updated_at=now() where id=${invoice.id} and status='ENVIANDO'`;
          if(result.status==='RECHAZADA')await database()`insert into fiscal_audit(client_id,entity_type,entity_id,event_type,actor_process)
            values(${invoice.client_id},'FACTURA',${invoice.id},'FacturaRechazada','BILLING_WORKER')`;
        }
      }catch{
        await database()`update fiscal_invoices set status='PENDIENTE_REINTENTO',updated_at=now() where id=${invoice.id} and status='ENVIANDO'`;
        await database()`insert into fiscal_audit(client_id,entity_type,entity_id,event_type,result,actor_process)
          values(${invoice.client_id},'FACTURA',${invoice.id},'FacturaReintentada','PENDING_RETRY','BILLING_WORKER')`;
      }
    }
  }
}
