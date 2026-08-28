import { useEffect, useState } from 'react';
import { apiFetch } from './api.js';
import './panel-dialog.css';

type Policy = { enabled:boolean; steps:Array<{fromCount:number;suspensionDays:number|null}> };
const date = (v:string|null) => v ? new Date(v).toLocaleString('es-EC',{timeZone:'America/Guayaquil'}) : '—';
const outcome = (days:number|null) => days === null ? 'Suspensión indefinida' : days === 0 ? 'Advertencia' : `${days} días de suspensión`;

export function PassengerCancellationSettings({token,canManage}:{token:string;canManage:boolean}) {
  const [policy,setPolicy]=useState<Policy>(); const [draft,setDraft]=useState<Policy>();
  const [busy,setBusy]=useState(false); const [message,setMessage]=useState('');
  useEffect(()=>{let current=true;apiFetch<Policy>('/v1/admin/settings/passenger-cancellations',token).then(v=>{if(current)setPolicy(v);}).catch(()=>{if(current)setMessage('No se pudo cargar la política de cancelaciones.');});return()=>{current=false;};},[token]);
  async function save(event:React.FormEvent) {
    event.preventDefault(); if(busy||!draft)return; setBusy(true);setMessage('');
    try {const v=await apiFetch<Policy>('/v1/admin/settings/passenger-cancellations',token,{method:'PATCH',body:JSON.stringify(draft)});setPolicy(v);setDraft(undefined);setMessage('Política guardada. Los contadores y sanciones anteriores se conservan.');}
    catch {setMessage('No se pudo guardar. Los rangos deben iniciar en 1 y aumentar, dejando la suspensión indefinida al final.');}
    finally {setBusy(false);}
  }
  return <section className="card"><h2>Cancelaciones después de aceptar</h2><p className="muted">Solo cuentan las cancelaciones del pasajero posteriores a una aceptación real y antes de iniciar el viaje. El contador no se reinicia al reactivar una cuenta.</p>
    {policy&&<><p>{policy.enabled?'Control activo':'Solo registro, sin sanciones automáticas'}</p><div className="row-actions">{policy.steps.map(s=><span key={s.fromCount}>Desde la n.º {s.fromCount}: {outcome(s.suspensionDays)}</span>)}</div><button onClick={()=>setDraft(structuredClone(policy))}>{canManage?'Configurar política':'Ver política'}</button></>}
    {!policy&&!message&&<p role="status">Cargando…</p>}{message&&<p role="status">{message}</p>}
    {draft&&<div className="panel-dialog-backdrop"><form className="panel-dialog-card" role="dialog" aria-modal="true" aria-label="Política de cancelaciones" onSubmit={save}>
      <h2>Política de cancelaciones</h2><fieldset disabled={!canManage||busy}><label><input type="checkbox" checked={draft.enabled} onChange={e=>setDraft({...draft,enabled:e.target.checked})}/> Aplicar suspensiones automáticas</label>
      {draft.steps.map((s,i)=><div className="form-grid" key={i}><label>Desde cancelación<input required type="number" min="1" max="10000" step="1" value={s.fromCount} onChange={e=>setDraft({...draft,steps:draft.steps.map((v,j)=>j===i?{...v,fromCount:Number(e.target.value)}:v)})}/></label>
        <label>Días (0 = advertencia)<input required disabled={s.suspensionDays===null} type="number" min="0" max="3650" step="1" value={s.suspensionDays??0} onChange={e=>setDraft({...draft,steps:draft.steps.map((v,j)=>j===i?{...v,suspensionDays:Number(e.target.value)}:v)})}/></label>
        <label><input type="checkbox" checked={s.suspensionDays===null} onChange={e=>setDraft({...draft,steps:draft.steps.map((v,j)=>j===i?{...v,suspensionDays:e.target.checked?null:0}:v)})}/> Indefinida</label>
        <button type="button" disabled={draft.steps.length===1} onClick={()=>setDraft({...draft,steps:draft.steps.filter((_,j)=>j!==i)})}>Quitar rango</button></div>)}
      <button type="button" disabled={draft.steps.length>=30} onClick={()=>setDraft({...draft,steps:[...draft.steps,{fromCount:(draft.steps.at(-1)?.fromCount??0)+1,suspensionDays:0}]})}>Agregar rango</button></fieldset>
      <p className="note">Una suspensión indefinida requiere reactivación manual. Cambiar esta política no acorta suspensiones ya aplicadas.</p>
      {message&&<p role="alert">{message}</p>}<div className="row-actions"><button type="button" disabled={busy} onClick={()=>setDraft(undefined)}>Cerrar</button>{canManage&&<button className="primary" disabled={busy}>{busy?'Guardando…':'Guardar'}</button>}</div>
    </form></div>}
  </section>;
}

export function PassengerCancellationHistory({token,passenger}:{token:string;passenger:any}) {
  const [open,setOpen]=useState(false); const [page,setPage]=useState(1); const [rows,setRows]=useState<any[]>([]); const [loading,setLoading]=useState(false); const [error,setError]=useState('');
  useEffect(()=>{if(!open)return;let current=true;setLoading(true);setError('');apiFetch<any[]>(`/v1/admin/passengers/${passenger.id}/cancellations?page=${page}`,token).then(v=>{if(current)setRows(v);}).catch(()=>{if(current)setError('No se pudo cargar el historial.');}).finally(()=>{if(current)setLoading(false);});return()=>{current=false;};},[open,page,token,passenger.id]);
  const statuses:Record<string,string>={RECORDED:'Advertencia registrada',SUSPENDED:'Suspensión aplicada',EXPIRED:'Suspensión cumplida',REACTIVATED:'Reactivada por administración'};
  return <><button className="link" onClick={()=>{setPage(1);setOpen(true);}}>{passenger.cancellationCount??0} cancelaciones</button>
    {passenger.cancellationSuspended&&<small className="table-line">{passenger.suspendedUntil?`Hasta ${date(passenger.suspendedUntil)}`:'Suspensión indefinida'}</small>}
    {open&&<div className="panel-dialog-backdrop"><section className="panel-dialog-card wide" role="dialog" aria-modal="true" aria-label="Historial de cancelaciones"><h2>Cancelaciones · {passenger.name}</h2>
      {loading?<p role="status">Cargando…</p>:error?<p role="alert">{error}</p>:rows.length?<div className="table-wrap"><table><thead><tr><th>N.º / fecha</th><th>Viaje y conductor</th><th>Medida</th><th>Estado</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.consecutive_number}<small className="table-line">{date(r.occurred_at)}</small></td><td>{r.origin} → {r.destination}<small className="table-line">{r.driverName}</small><small className="table-line">Referencia: {r.trip_id}</small></td><td>{outcome(r.suspension_days)}<small className="table-line">{date(r.suspension_started_at)} → {date(r.suspension_until)}</small></td><td>{statuses[r.status]??r.status}<small className="table-line">{r.reactivated_at?`Reactivada: ${date(r.reactivated_at)}`:''}</small></td></tr>)}</tbody></table></div>:<p>No hay cancelaciones después de la aceptación.</p>}
      <div className="row-actions"><button disabled={loading||page===1} onClick={()=>setPage(page-1)}>Anterior</button><span>Página {page}</span><button disabled={loading||rows.length<20||page*20>=Number(rows[0]?.totalCount??0)} onClick={()=>setPage(page+1)}>Siguiente</button><button onClick={()=>setOpen(false)}>Cerrar</button></div>
    </section></div>}</>;
}
