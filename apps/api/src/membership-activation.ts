import {database} from './database.js';
import {renderCostaGoEmail,sendTransactionalEmail} from './email.js';
import {notificationService} from './notification-service.js';

type ActivationRecord={
  userId:string;email:string|null;name:string;plan:Record<string,unknown>;planType:string;
  startsAt:string|Date;expiresAt:string|Date|null;paymentId:string;membershipId:string;
  code:string;subtotal:number;vatRate:number;vat:number;total:number;currency:string;
  invoiceNumber:string|null;hasDocument:boolean;paymentMethod:string;
};

const dateFormatter=new Intl.DateTimeFormat('es-EC',{dateStyle:'long',timeStyle:'short',timeZone:'America/Guayaquil'});
function dateLabel(value:string|Date|null):string{return value?dateFormatter.format(new Date(value)):'Hasta agotar los viajes';}
function money(currency:string,value:number):string{return `${currency} ${Number(value).toFixed(2)}`;}

export function membershipActivationPresentation(record:ActivationRecord){
  const courtesy=record.paymentMethod==='COURTESY';
  const planName=String(record.plan.name??record.plan.code??'Costa-Go');
  const tripCount=Number(record.plan.purchasedTrips??record.plan.includedTrips??0);
  const days=Number(record.planType==='TRIP_PACK'?record.plan.packValidityDays??0:record.plan.durationDays??0);
  const validity=days>0
    ? `${days} ${days===1?'día':'días'}`
    : `${tripCount} ${tripCount===1?'viaje':'viajes'}`;
  const expiry=dateLabel(record.expiresAt);
  const activeUntil=record.expiresAt?`hasta ${expiry}`:'hasta agotar tus viajes';
  const tripRows=record.planType==='TRIP_PACK'?[{label:'Viajes incluidos',value:`${tripCount} ${tripCount===1?'viaje':'viajes'}`}]:[];
  const rows=courtesy?[
    {label:'Plan',value:planName,emphasis:true},{label:'Vigencia',value:validity},...tripRows,
    {label:'Fecha de vencimiento',value:expiry},{label:'Modalidad',value:'Cortesía Costa-Go'},
    {label:'Valor',value:'Sin costo',emphasis:true},{label:'Estado',value:'Activa'}
  ]:[
    {label:'Plan',value:planName,emphasis:true},{label:'Vigencia',value:validity},...tripRows,
    {label:'Fecha de vencimiento',value:expiry},{label:'Valor',value:money(record.currency,record.subtotal)},
    {label:`IVA (${Number(record.vatRate).toFixed(0)}%)`,value:money(record.currency,record.vat)},
    {label:'Total',value:money(record.currency,record.total),emphasis:true},{label:'Estado',value:'Activa'}
  ];
  return {
    planName,validity,expiry,courtesy,
    title:courtesy?'✅ Cortesía activada':'✅ Membresía activada',
    body:courtesy?`Costa-Go activó tu plan de cortesía ${planName} ${activeUntil}. Ya puedes recibir viajes.`:`Tu plan ${planName} está activo ${activeUntil}. Ya puedes recibir viajes.`,
    emailSubject:courtesy?'Tu membresía de cortesía Costa-Go está activa':'Tu membresía Costa-Go está activa',
    emailText:courtesy
      ?`Hola ${record.name}. Costa-Go activó tu plan de cortesía ${planName}, con vigencia de ${validity}${record.planType==='TRIP_PACK'?` e incluye ${tripCount} ${tripCount===1?'viaje':'viajes'}`:''}. No necesitas realizar ningún pago. Ya puedes recibir viajes.`
      :`Hola ${record.name}. Tu plan ${planName} está activo hasta ${expiry}. Total: ${money(record.currency,record.total)}. Ya puedes recibir viajes.`,
    emailHtml:renderCostaGoEmail({
      title:courtesy?'Tu membresía de cortesía Costa-Go está activa':'Tu membresía Costa-Go está activa',greeting:record.name,
      lead:courtesy?'Costa-Go activó una membresía de cortesía en tu cuenta. No necesitas realizar ningún pago.':'Confirmamos correctamente tu pago. Tu membresía ya está lista para recibir viajes.',
      badge:{label:courtesy?'Cortesía activa':'Activa',tone:'success'},
      rows,
      notice:{title:courtesy?'Cortesía habilitada':'Membresía habilitada',text:'Ya puedes conectarte y recibir solicitudes de viaje.',tone:'success'},
      primaryAction:{label:'Ver mi membresía',url:'costa-go://membership'},
      secondaryAction:!courtesy&&record.hasDocument?{label:record.invoiceNumber?'Ver factura':'Ver comprobante',url:'costa-go://membership'}:undefined
    })
  };
}

export async function sendMembershipActivationConfirmation(paymentId:string,membershipId:string):Promise<void>{
  const [record]=await database()`select
    u.id::text as "userId",u.email,u.full_name as name,
    coalesce(o.plan_snapshot,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object(
      'name',mp.name,'code',mp.code,'planType',mp.plan_type,
      'durationDays',mp.duration_days,'includedTrips',mp.included_trips,
      'purchasedTrips',case when mp.plan_type='TRIP_PACK' then mp.included_trips else null end,
      'packValidityDays',mp.pack_validity_days
    )) as plan,
    dm.plan_type_snapshot as "planType",dm.starts_at as "startsAt",dm.expires_at as "expiresAt",
    p.id::text as "paymentId",dm.id::text as "membershipId",o.short_code as code,
    o.taxable_subtotal::float8 as subtotal,o.vat_rate_percent::float8 as "vatRate",
    o.vat_amount::float8 as vat,o.total_amount::float8 as total,o.currency,p.method as "paymentMethod",
    invoice.document_number as "invoiceNumber",
    (invoice.id is not null or proof.id is not null) as "hasDocument"
    from membership_payments p
    join membership_payment_orders o on o.id=p.order_id
    left join membership_plans mp on mp.id=o.plan_id
    join driver_memberships dm on dm.id=p.membership_cycle_id
    join users u on u.id=p.driver_id
    left join lateral(select id,document_number from fiscal_invoices where source='MEMBRESIA' and payment_id=p.id order by created_at desc limit 1) invoice on true
    left join lateral(select id from membership_transfer_proofs where order_id=o.id order by created_at desc limit 1) proof on true
    where p.id=${paymentId} and dm.id=${membershipId}` as ActivationRecord[];
  if(!record)return;
  const presentation=membershipActivationPresentation(record);
  const deliveries:Promise<unknown>[]=[notificationService.send({
    userId:record.userId,type:'MEMBERSHIP_ACTIVATED',category:'OPERATIONAL',priority:'OPERATIONAL',
    title:presentation.title,body:presentation.body,referenceId:record.membershipId,
    deepLink:'costa-go://membership',action:'OPEN_MEMBERSHIP',persistInCenter:true,sendPush:true,
    idempotencyKey:`MEMBERSHIP_ACTIVATED:${record.membershipId}:${record.paymentId}`,
    metadata:{membershipId:record.membershipId,paymentId:record.paymentId,plan:presentation.planName,expiresAt:record.expiresAt}
  })];
  if(record.email)deliveries.push(sendTransactionalEmail({
    to:record.email,subject:presentation.emailSubject,
    text:presentation.emailText,
    html:presentation.emailHtml
  }));
  await Promise.allSettled(deliveries);
}
