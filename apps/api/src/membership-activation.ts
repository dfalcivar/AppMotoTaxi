import {database} from './database.js';
import {renderCostaGoEmail,sendTransactionalEmail} from './email.js';
import {notificationService} from './notification-service.js';

type ActivationRecord={
  userId:string;email:string|null;name:string;plan:Record<string,unknown>;planType:string;
  startsAt:string|Date;expiresAt:string|Date|null;paymentId:string;membershipId:string;
  code:string;subtotal:number;vatRate:number;vat:number;total:number;currency:string;
  invoiceNumber:string|null;hasDocument:boolean;
};

const dateFormatter=new Intl.DateTimeFormat('es-EC',{dateStyle:'long',timeStyle:'short',timeZone:'America/Guayaquil'});
function dateLabel(value:string|Date|null):string{return value?dateFormatter.format(new Date(value)):'Hasta agotar los viajes';}
function money(currency:string,value:number):string{return `${currency} ${Number(value).toFixed(2)}`;}

export function membershipActivationPresentation(record:ActivationRecord){
  const planName=String(record.plan.name??record.plan.code??'Costa-Go');
  const tripCount=Number(record.plan.purchasedTrips??record.plan.includedTrips??0);
  const days=Number(record.plan.durationDays??0);
  const validity=record.planType==='TRIP_PACK'
    ? `${tripCount} ${tripCount===1?'viaje':'viajes'}`
    : `${days} ${days===1?'día':'días'}`;
  const expiry=dateLabel(record.expiresAt);
  const activeUntil=record.expiresAt?`hasta ${expiry}`:'hasta agotar tus viajes';
  return {
    planName,validity,expiry,
    title:'✅ Membresía activada',
    body:`Tu plan ${planName} está activo ${activeUntil}. Ya puedes recibir viajes.`,
    emailHtml:renderCostaGoEmail({
      title:'Tu membresía Costa-Go está activa',greeting:record.name,
      lead:'Confirmamos correctamente tu pago. Tu membresía ya está lista para recibir viajes.',
      badge:{label:'Activa',tone:'success'},
      rows:[
        {label:'Plan',value:planName,emphasis:true},{label:'Vigencia',value:validity},
        {label:'Fecha de vencimiento',value:expiry},{label:'Valor',value:money(record.currency,record.subtotal)},
        {label:`IVA (${Number(record.vatRate).toFixed(0)}%)`,value:money(record.currency,record.vat)},
        {label:'Total',value:money(record.currency,record.total),emphasis:true},{label:'Estado',value:'Activa'}
      ],
      notice:{title:'Membresía habilitada',text:'Ya puedes conectarte y recibir solicitudes de viaje.',tone:'success'},
      primaryAction:{label:'Ver mi membresía',url:'costa-go://membership'},
      secondaryAction:record.hasDocument?{label:record.invoiceNumber?'Ver factura':'Ver comprobante',url:'costa-go://membership'}:undefined
    })
  };
}

export async function sendMembershipActivationConfirmation(paymentId:string,membershipId:string):Promise<void>{
  const [record]=await database()`select
    u.id::text as "userId",u.email,u.full_name as name,o.plan_snapshot as plan,
    dm.plan_type_snapshot as "planType",dm.starts_at as "startsAt",dm.expires_at as "expiresAt",
    p.id::text as "paymentId",dm.id::text as "membershipId",o.short_code as code,
    o.taxable_subtotal::float8 as subtotal,o.vat_rate_percent::float8 as "vatRate",
    o.vat_amount::float8 as vat,o.total_amount::float8 as total,o.currency,
    invoice.document_number as "invoiceNumber",
    (invoice.id is not null or proof.id is not null) as "hasDocument"
    from membership_payments p
    join membership_payment_orders o on o.id=p.order_id
    join driver_memberships dm on dm.id=p.membership_cycle_id
    join users u on u.id=p.driver_id
    left join lateral(select id,document_number from fiscal_invoices where source='MEMBRESIA' and payment_id=p.id order by created_at desc limit 1) invoice on true
    left join lateral(select id from membership_transfer_proofs where order_id=o.id order by created_at desc limit 1) proof on true
    where p.id=${paymentId} and dm.id=${membershipId}` as ActivationRecord[];
  if(!record)return;
  const presentation=membershipActivationPresentation(record);
  const deliveries:Promise<unknown>[]=[notificationService.send({
    userId:record.userId,type:'MEMBERSHIP_ACTIVATED',category:'OPERATIONAL',priority:'HIGH',
    title:presentation.title,body:presentation.body,referenceId:record.membershipId,
    deepLink:'costa-go://membership',action:'OPEN_MEMBERSHIP',persistInCenter:true,sendPush:true,
    idempotencyKey:`MEMBERSHIP_ACTIVATED:${record.membershipId}:${record.paymentId}`,
    metadata:{membershipId:record.membershipId,paymentId:record.paymentId,plan:presentation.planName,expiresAt:record.expiresAt}
  })];
  if(record.email)deliveries.push(sendTransactionalEmail({
    to:record.email,subject:'Tu membresía Costa-Go está activa',
    text:`Hola ${record.name}. Tu plan ${presentation.planName} está activo hasta ${presentation.expiry}. Total: ${money(record.currency,record.total)}. Ya puedes recibir viajes.`,
    html:presentation.emailHtml
  }));
  await Promise.allSettled(deliveries);
}
