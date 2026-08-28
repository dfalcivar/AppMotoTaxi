import {useEffect,useRef,useState} from 'react';
import {apiFetch} from './api.js';
import './fiscal.css';

export function FiscalProfileDialog({endpoint,token,editable,onClose}:{endpoint:string;token:string;editable:boolean;onClose:()=>void}){
  return <div className="fiscal-modal-overlay"><section className="fiscal-modal" role="dialog" aria-modal="true" aria-label="Datos de facturación de la orden"><button className="secondary fiscal-close" type="button" aria-label="Cerrar datos de facturación" onClick={onClose}>×</button><h2>Datos de la orden</h2><FiscalProfileCard endpoint={endpoint} token={token} editable={editable}/><button className="secondary" type="button" onClick={onClose}>Volver al pago</button></section></div>;
}

export function FiscalProfileCard({endpoint,token,editable=true,onReady,onSaved}:{endpoint:string;token:string;editable?:boolean;onReady?:(ready:boolean)=>void;onSaved?:()=>void}){
  const [profile,setProfile]=useState<any>(null),[data,setData]=useState<any>({}),[editing,setEditing]=useState(false),[busy,setBusy]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const revision=useRef(0),saving=useRef(false);
  async function load(){const sequence=++revision.current;setBusy(true);setError('');onReady?.(false);try{const result=await apiFetch<any>(endpoint,token);if(sequence!==revision.current)return;setProfile(result.profile);setData({identificationType:'CEDULA',identification:'',legalName:'',address:'',billingEmail:'',...result.prefill,...result.profile});setEditing(!result.profile);onReady?.(!!result.profile);}catch{if(sequence===revision.current)setError('No se pudieron consultar los datos fiscales. Intenta nuevamente.');}finally{if(sequence===revision.current)setBusy(false);}}
  useEffect(()=>{void load();return()=>{revision.current++;};},[endpoint,token]);
  async function save(event:React.FormEvent){event.preventDefault();if(busy||saving.current)return;saving.current=true;const sequence=revision.current;setBusy(true);setError('');try{
    const payload={identificationType:data.identificationType,identification:data.identification,legalName:data.legalName,address:data.address,billingEmail:data.billingEmail,expectedRevision:profile?.revision??0};
    const result=await apiFetch<any>(endpoint,token,{method:'PUT',body:JSON.stringify(payload)});if(sequence!==revision.current)return;setProfile(result.profile);setEditing(false);setNotice('Datos de facturación guardados correctamente.');onReady?.(true);onSaved?.();
  }catch(e){if(sequence===revision.current)setError(fiscalMessage(e));}finally{saving.current=false;if(sequence===revision.current)setBusy(false);}}
  return <section className="fiscal-profile-card"><div className="fiscal-section-heading"><span className="fiscal-icon" aria-hidden="true">▤</span><div><h3>Datos de facturación</h3><p>Se reutilizan en tus próximos comprobantes. No modifican el contacto comercial.</p></div></div>
    {busy&&!profile&&<p role="status">Consultando datos…</p>}{error&&<div role="alert" className="alert error">{error}<button type="button" className="secondary" onClick={()=>void load()}>Actualizar</button></div>}{notice&&<p role="status" className="fiscal-success">✓ {notice}</p>}
    {profile&&!editing&&<><strong className="fiscal-success">✓ Datos registrados</strong><dl><dt>Nombre / Razón social</dt><dd>{profile.legalName}</dd><dt>{profile.identificationType==='RUC'?'RUC':'Cédula'}</dt><dd>{profile.identification}</dd><dt>Correo</dt><dd>{profile.billingEmail}</dd><dt>Dirección</dt><dd>{profile.address}</dd></dl>{editable&&<button className="secondary" type="button" onClick={()=>{setEditing(true);setData(profile);onReady?.(false);}}>Modificar datos</button>}</>}
    {!profile&&!busy&&(!editing||!editable)&&<p>Datos de facturación pendientes.</p>}
    {editing&&editable&&<form className="fiscal-form" onSubmit={save}><p>Registra estos datos una sola vez. Los utilizaremos para tus futuros comprobantes.</p><label>Tipo de identificación<select disabled={busy} value={data.identificationType} onChange={e=>setData({...data,identificationType:e.target.value})}><option value="CEDULA">Cédula</option><option value="RUC">RUC</option></select></label>
      <label>Número de identificación<input required inputMode="numeric" pattern={data.identificationType==='RUC'?'[0-9]{13}':'[0-9]{10}'} maxLength={data.identificationType==='RUC'?13:10} value={data.identification??''} disabled={busy} onChange={e=>setData({...data,identification:e.target.value})}/></label>
      <label>Nombres / Razón social<input required minLength={3} maxLength={200} value={data.legalName??''} disabled={busy} onChange={e=>setData({...data,legalName:e.target.value})}/></label>
      <label>Dirección<input required minLength={5} maxLength={500} value={data.address??''} disabled={busy} onChange={e=>setData({...data,address:e.target.value})}/></label>
      <label>Correo para facturación<input type="email" required maxLength={254} value={data.billingEmail??''} disabled={busy} onChange={e=>setData({...data,billingEmail:e.target.value})}/></label>
      <div className="fiscal-actions">{profile&&<button type="button" className="secondary" disabled={busy} onClick={()=>{setEditing(false);onReady?.(true);}}>Volver</button>}<button className="primary" disabled={busy} type="submit">{busy?'Guardando…':'Guardar datos'}</button></div>
    </form>}
  </section>;
}
export function fiscalMessage(error:unknown){const text=error instanceof Error?String((error as Error&{code?:string}).code??error.message):'';return ({FISCAL_PROFILE_CHANGED:'Los datos cambiaron en otra sesión. Pulsa Actualizar antes de volver a guardar.',INVALID_FISCAL_DATA:'Revisa todos los campos: cédula de 10 dígitos o RUC de 13, nombre, dirección y correo válidos.',FISCAL_PROFILE_REQUIRED:'Registra los datos de facturación antes de confirmar el cobro.',FORBIDDEN:'No tienes permiso para consultar o modificar estos datos.',UNAUTHORIZED:'La sesión expiró. Inicia sesión nuevamente.',FISCAL_CONTEXT_UNAVAILABLE:'La orden ya no está disponible para modificar datos fiscales.'} as Record<string,string>)[text]??'No fue posible completar la operación. Tus datos siguen en pantalla; intenta nuevamente.';}
