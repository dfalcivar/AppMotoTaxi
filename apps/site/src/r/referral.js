import {referralLocation,appleStoreLink} from './referral-model.mjs';
const status=document.querySelector('#status');
try {
 const invitation=referralLocation(window.location);
 if(!invitation)throw new Error('El enlace de invitación no es válido.');
 const config=window.COSTA_GO_PUBLIC_CONFIG??{};
 const response=await fetch(`${config.apiBaseUrl}/v1/public/referrals/${invitation.code}${invitation.program?'?program='+encodeURIComponent(invitation.program):''}`,{credentials:'omit',cache:'no-store'});
 if(!response.ok)throw new Error('Esta invitación no está disponible o el programa ya terminó.');
 const data=await response.json();
 document.querySelector('#program').textContent=data.name;document.querySelector('#description').textContent=data.description;
 document.querySelector('#code').textContent=invitation.code;document.querySelector('#open').href=invitation.deepLink;
 document.querySelector('#condition').textContent=`La recompensa se entrega cuando el invitado ${data.condition}. Costa-Go verifica la condición.`;
 document.querySelector('#invitation').hidden=false;status.textContent='Invitación disponible. La app comprobará tu cuenta y zona antes de registrarla.';
 document.querySelector('#copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(invitation.code);status.textContent='Código copiado. Consérvalo para registrarte.';}catch{status.textContent='Selecciona el código y cópialo manualmente.';}});
 const ios=appleStoreLink(config.appStoreUrl);if(ios){document.querySelector('#ios').href=ios;document.querySelector('#ios').hidden=false;document.querySelector('#ios-note').hidden=true;}
} catch(e){status.textContent=e.message||'No pudimos comprobar la invitación. Intenta nuevamente.';}
