/** Public copy only; eligibility and reward execution remain in the Benefit Engine. */
export function benefitPresentation(type:string,value:number) {
 const amount=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
 const count=new Intl.NumberFormat('es-EC',{maximumFractionDigits:2}).format(value);
 switch(type){
  case 'COURTESY_DAYS':return {valueLabel:`${count} ${value===1?'día gratis':'días gratis'}`,typeLabel:'de membresía'};
  case 'PROMOTIONAL_BALANCE':return {valueLabel:amount,typeLabel:'de saldo promocional'};
  case 'FIXED_DISCOUNT':return {valueLabel:amount,typeLabel:'de descuento'};
  case 'PERCENTAGE_DISCOUNT':return {valueLabel:`${count}%`,typeLabel:'de descuento'};
  case 'FREE_TRIPS':return {valueLabel:`${count} ${value===1?'viaje':'viajes'}`,typeLabel:'sin comisión Costa-Go'};
  default:return {valueLabel:'Tu beneficio',typeLabel:''};
 }
}
