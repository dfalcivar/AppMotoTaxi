import {useEffect,useRef,useState} from 'react';
import {apiFetch} from './api.js';
import './panel-dialog.css';
import './mobile-account-actions.css';

type Account={id:string;name:string;email?:string|null;phone:string;emailVerifiedAt?:string|null;approvalStatus?:string;approvedAt?:string|null};
const errors:Record<string,string>={
  INVALID_ACCOUNT_DATA:'Revisa el nombre, el correo, el teléfono y el motivo (mínimo 5 caracteres).',
  EMAIL_ALREADY_EXISTS:'Ese correo ya pertenece a otra cuenta, sea pasajero, conductor o usuario administrativo.',
  PHONE_ALREADY_EXISTS:'Ese teléfono ya pertenece a otra cuenta.',
  ACCOUNT_CHANGED_REFRESH:'La cuenta cambió mientras la editabas. Cierra y vuelve a abrir sus datos.',
  ACCOUNT_HAS_ACTIVE_TRIP:'No se pueden cambiar datos mientras exista un viaje o una reserva pendiente. Espera a que finalice.',
  ACCOUNT_NOT_INCOMPLETE:'Solo se pueden eliminar registros de conductores que nunca fueron aprobados.',
  ACCOUNT_HAS_OPERATIONAL_HISTORY:'Esta cuenta ya tiene viajes, membresías u órdenes de pago. Conserva el historial: corrige sus datos o utiliza la suspensión.',
  FORBIDDEN:'Tu rol no tiene permiso para esta acción.',
  MOBILE_ACCOUNT_NOT_FOUND:'Esta cuenta ya no está disponible. Actualiza el listado.',
  DATABASE_UNAVAILABLE:'La base de datos no está disponible. Intenta nuevamente.',
};
export function MobileAccountActions({token,account,canEdit,canDelete=false,editButtonClassName='link',entityLabel,onChanged}:{token:string;account:Account;canEdit:boolean;canDelete?:boolean;editButtonClassName?:string;entityLabel?:'pasajero'|'conductor';onChanged:(message:string)=>Promise<void>}) {
  const [mode,setMode]=useState<'edit'|'delete'|null>(null);
  const [form,setForm]=useState({name:'',email:'',phone:'',reason:'',confirmation:'',expectedEmail:null as string|null});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');const submitting=useRef(false);
  const incomplete=!account.approvedAt&&['PENDIENTE_DOCUMENTOS','PENDIENTE_REVISION','OBSERVADO','RECHAZADO'].includes(account.approvalStatus??'');
  function open(next:'edit'|'delete'){setForm({name:account.name,email:account.email??'',phone:account.phone,reason:'',confirmation:'',expectedEmail:account.email??null});setError('');setMode(next);}
  useEffect(()=>{if(!mode)return;const close=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!submitting.current)setMode(null);};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[mode]);
  async function submit(event:React.FormEvent){
    event.preventDefault();if(submitting.current||!mode)return;submitting.current=true;setBusy(true);setError('');
    try{
      if(mode==='edit'){
        const result=await apiFetch<{emailVerificationRequired:boolean;sessionRevoked:boolean}>(`/v1/admin/mobile-accounts/${account.id}/identity`,token,{method:'PATCH',body:JSON.stringify({name:form.name,email:form.email,phone:form.phone,reason:form.reason,expectedEmail:form.expectedEmail})});
        setMode(null);window.dispatchEvent(new Event('mobile-account-changed'));
        await onChanged(`Datos guardados.${result.emailVerificationRequired?' El titular debe ingresar con el correo corregido y verificar el código recibido.':''}${result.sessionRevoked?' Se cerraron sus sesiones anteriores.':''}`);
      }else{
        await apiFetch(`/v1/admin/mobile-accounts/${account.id}/delete-incomplete`,token,{method:'POST',body:JSON.stringify({reason:form.reason,confirmation:form.confirmation,expectedEmail:form.expectedEmail})});
        setMode(null);window.dispatchEvent(new Event('mobile-account-changed'));await onChanged('Registro incompleto eliminado del acceso y los listados. La auditoría se conserva; el correo y teléfono quedan libres para registrarse nuevamente.');
      }
    }catch(e){setError(errors[e instanceof Error?e.message:'']??'No se pudo completar la operación. Intenta nuevamente.');}
    finally{submitting.current=false;setBusy(false);}
  }
  return <>{canEdit&&<button type="button" className={editButtonClassName} onClick={()=>open('edit')}>Editar datos</button>}{canDelete&&incomplete&&<button type="button" className="link" onClick={()=>open('delete')}>Eliminar registro incompleto</button>}
    {mode&&<div className="panel-dialog-backdrop"><form className={`panel-dialog-card mobile-account-dialog ${entityLabel?`mobile-account-dialog-${entityLabel}`:''}`} role="dialog" aria-modal="true" aria-label={mode==='edit'?`Editar datos ${entityLabel?`del ${entityLabel}`:'de la cuenta'}`:'Eliminar registro incompleto'} onSubmit={submit}>
      <div className="panel-dialog-heading"><div><span className="eyebrow">CUENTA COSTA-GO</span><h2>{mode==='edit'?`Editar datos${entityLabel?` del ${entityLabel}`:''}`:'Eliminar registro incompleto'}</h2><p>{account.name}</p></div><button type="button" className="modal-close-button" aria-label="Cerrar" disabled={busy} onClick={()=>setMode(null)}>×</button></div>
      <div className="panel-dialog-fields" style={{gridTemplateColumns:'minmax(0,1fr)'}}>
      {mode==='edit'?<><p className="note mobile-account-system-note">Confirma los datos con el titular. Cambiar el correo exige verificar la nueva dirección y cierra las sesiones anteriores. {entityLabel==='pasajero'?'No reactiva la cuenta ni levanta suspensiones.':'No aprueba al conductor ni levanta suspensiones.'}</p>
        <p className={`mobile-account-email-status ${account.emailVerifiedAt?'verified':'pending'}`}>Correo: <strong>{account.emailVerifiedAt?'Verificado':'Pendiente de verificación'}</strong></p>
        <label className="mobile-account-name">Nombre completo<input autoFocus required disabled={busy} minLength={3} maxLength={120} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
        <label className="mobile-account-email">Correo electrónico<input required type="email" disabled={busy} maxLength={254} value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label>
        <label className="mobile-account-phone">Teléfono<input required type="tel" disabled={busy} maxLength={30} placeholder="0991234567 o +593991234567" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label>
      </>:<><p className="note">Se impedirá el acceso de esta cuenta en ambos modos (conductor y pasajero) y se anonimizarán sus datos identificativos. No se borran físicamente los registros ni la auditoría. No uses esta opción si basta con corregir el correo.</p><p>Solo se permite si nunca fue aprobado y no tiene viajes, membresías ni órdenes de pago.</p><label>Escribe ELIMINAR para confirmar<input autoFocus required disabled={busy} pattern="ELIMINAR" value={form.confirmation} onChange={e=>setForm({...form,confirmation:e.target.value})}/></label></>}
      <label className="mobile-account-reason">Motivo obligatorio<textarea required disabled={busy} minLength={5} maxLength={500} value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})} placeholder="Por ejemplo: correo incorrecto confirmado con el titular"/></label></div>
      {error&&<p role="alert" className="alert error">{error}</p>}
      <div className="panel-dialog-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>setMode(null)}>Cancelar</button><button type="submit" className={mode==='delete'?'danger-button':'primary'} disabled={busy}>{busy?'Procesando…':mode==='edit'?'Guardar cambios':'Eliminar registro'}</button></div>
    </form></div>}
  </>;
}
