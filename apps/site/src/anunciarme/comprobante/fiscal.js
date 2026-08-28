(() => {
  'use strict';
  window.costaGoFiscalProfile = async ({request,token,onConfirmed}) => {
    const section=document.querySelector('#fiscal-section'),form=document.querySelector('#fiscal-form'),summary=document.querySelector('#fiscal-summary'),actions=document.querySelector('#fiscal-actions'),result=document.querySelector('#fiscal-result'),save=document.querySelector('#fiscal-save');
    const path=`/v1/public/advertising/payment-proof/${encodeURIComponent(token)}/fiscal-profile`;
    let profile=null,busy=false;
    const fields=['identificationType','identification','legalName','address','billingEmail'];
    function fill(data){for(const name of fields)form.elements.namedItem(name).value=data?.[name]??(name==='identificationType'?'CEDULA':'');}
    function showSummary(){form.hidden=true;summary.hidden=false;actions.hidden=false;summary.textContent=`✓ Datos de facturación registrados\n${profile.legalName}\n${profile.identificationType==='RUC'?'RUC':'Cédula'} ${profile.identification}\n${profile.billingEmail}\n${profile.address}`;}
    section.hidden=false;
    const data=await request(path);profile=data.profile;fill(profile??data.prefill);if(profile)showSummary();else form.hidden=false;
    document.querySelector('#fiscal-edit').onclick=()=>{fill(profile);form.hidden=false;summary.hidden=true;actions.hidden=true;};
    document.querySelector('#fiscal-confirm').onclick=()=>{section.hidden=true;onConfirmed();};
    form.addEventListener('submit',async(event)=>{
      event.preventDefault();if(busy)return;const payload=Object.fromEntries(fields.map(name=>[name,form.elements.namedItem(name).value.trim()]));
      if(!new RegExp(payload.identificationType==='RUC'?'^\\d{13}$':'^\\d{10}$').test(payload.identification)){result.textContent='Revisa el número de identificación.';return;}
      busy=true;for(const control of form.elements)control.disabled=true;save.textContent='Guardando…';result.textContent='';
      try{const saved=await request(path,{method:'PUT',body:JSON.stringify({...payload,expectedRevision:profile?.revision??0})});profile=saved.profile;showSummary();result.textContent='✓ Datos guardados correctamente.';}
      catch(error){result.textContent=error.message;}
      finally{busy=false;for(const control of form.elements)control.disabled=false;save.textContent='Guardar y continuar';}
    });
  };
})();
