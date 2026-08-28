/** Only return after authenticating the account; no personal contact data. */
export function cancellationSuspensionResponse(accountId:string, until:unknown) {
  const date=until==null?null:new Date(until as string | Date);
  const suspendedUntil=date&&!Number.isNaN(date.getTime())?date.toISOString():null;
  const whatsapp=(process.env.SUPPORT_WHATSAPP??'').replace(/\D/g,'');
  return {error:'PASSENGER_CANCELLATION_SUSPENDED',accountId,suspendedUntil,
    indefinite:until==null,reason:'Cancelaciones después de que un conductor aceptó la carrera.',
    supportUrl:whatsapp?`https://wa.me/${whatsapp}`:'mailto:soporte@costa-go.com'};
}
