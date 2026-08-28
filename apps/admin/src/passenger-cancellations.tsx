import { useEffect, useState } from 'react';
import { apiFetch } from './api.js';
import './panel-dialog.css';
import './passenger-cancellations.css';

type Policy = { enabled:boolean; cycleDurationDays:number; steps:Array<{fromCount:number;suspensionDays:number|null}> };
const date = (v:string|null) => v ? new Date(v).toLocaleString('es-EC',{timeZone:'America/Guayaquil'}) : '—';
const outcome = (days:number|null) => days === null ? 'Suspensión indefinida' : days === 0 ? 'Advertencia' : `${days} días de suspensión`;

export function PassengerCancellationSettings({token,canManage}:{token:string;canManage:boolean}) {
  const [policy,setPolicy]=useState<Policy>(); const [draft,setDraft]=useState<Policy>();
  const [busy,setBusy]=useState(false); const [message,setMessage]=useState('');
  useEffect(()=>{let current=true;apiFetch<Policy>('/v1/admin/settings/passenger-cancellations',token).then(v=>{if(current)setPolicy(v);}).catch(()=>{if(current)setMessage('No se pudo cargar la política de cancelaciones.');});return()=>{current=false;};},[token]);
  async function save(event:React.FormEvent) {
    event.preventDefault(); if(busy||!draft)return; setBusy(true);setMessage('');
    try {const v=await apiFetch<Policy>('/v1/admin/settings/passenger-cancellations',token,{method:'PATCH',body:JSON.stringify(draft)});setPolicy(v);setDraft(undefined);setMessage('Política guardada. La duración se aplicará a ciclos nuevos; las fechas y suspensiones existentes se conservan.');}
    catch {setMessage('No se pudo guardar. Los rangos deben iniciar en 1 y aumentar, dejando la suspensión indefinida al final.');}
    finally {setBusy(false);}
  }
  return <section className="card"><h2>Cancelaciones después de aceptar</h2><p className="muted">Solo cuentan las cancelaciones del pasajero posteriores a una aceptación real y antes de iniciar el viaje. Cada ciclo comienza con la primera cancelación, no con el mes calendario. Al vencer se reinicia el contador, nunca el historial ni una suspensión vigente.</p>
    {policy&&<><p>{policy.enabled?'Control activo':'Solo registro, sin sanciones automáticas'} · Ciclos de {policy.cycleDurationDays} días</p><div className="row-actions">{policy.steps.map(s=><span key={s.fromCount}>Desde la n.º {s.fromCount}: {outcome(s.suspensionDays)}</span>)}</div><button onClick={()=>setDraft(structuredClone(policy))}>{canManage?'Configurar política':'Ver política'}</button></>}
    {!policy&&!message&&<p role="status">Cargando…</p>}{message&&<p role="status">{message}</p>}
    {draft&&<div className="panel-dialog-backdrop"><form className="panel-dialog-card" role="dialog" aria-modal="true" aria-label="Política de cancelaciones" onSubmit={save}>
      <h2>Política de cancelaciones</h2><fieldset disabled={!canManage||busy}><label><input type="checkbox" checked={draft.enabled} onChange={e=>setDraft({...draft,enabled:e.target.checked})}/> Aplicar suspensiones automáticas</label>
      <label>Duración de los nuevos ciclos (días)<input required type="number" min="1" max="3650" step="1" value={draft.cycleDurationDays} onChange={e=>setDraft({...draft,cycleDurationDays:Number(e.target.value)})}/></label>
      <p className="note">Por ejemplo: 30, 60 o 90 días desde la primera cancelación. Los ciclos ya iniciados conservan su duración.</p>
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
  const [summary,setSummary]=useState<CancellationSummary>(); const [history,setHistory]=useState(false); const [refresh,setRefresh]=useState(0);
  useEffect(()=>{
    if(!open)return;let current=true;setLoading(true);setError('');
    Promise.all([apiFetch<CancellationSummary>(`/v1/admin/passengers/${passenger.id}/cancellation-summary`,token),
      history?apiFetch<any[]>(`/v1/admin/passengers/${passenger.id}/cancellations?page=${page}`,token):Promise.resolve([])])
      .then(([next,items])=>{if(current){setSummary(next);setRows(items);}})
      .catch(()=>{if(current)setError('No se pudo cargar la información de cancelaciones. Intenta actualizar.');})
      .finally(()=>{if(current)setLoading(false);});
    return()=>{current=false;};
  },[open,history,page,token,passenger.id,refresh]);
  useEffect(()=>{if(!open)return;const timer=setInterval(()=>setRefresh(n=>n+1),60_000);const close=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};window.addEventListener('keydown',close);return()=>{clearInterval(timer);window.removeEventListener('keydown',close);};},[open]);
  const statuses:Record<string,string>={RECORDED:'Advertencia registrada',SUSPENDED:'Suspensión aplicada',EXPIRED:'Suspensión cumplida',REACTIVATED:'Reactivada por administración'};
  return <><button className="link" onClick={()=>{setPage(1);setHistory(false);setSummary(undefined);setOpen(true);}}>Información del pasajero</button>
    {open&&<div className="panel-dialog-backdrop"><section className="panel-dialog-card wide" role="dialog" aria-modal="true" aria-label="Información del pasajero">
      <div className="panel-dialog-heading"><div><h2>{passenger.name}</h2><p className="muted">{passenger.email??'Sin correo'} · {passenger.phone}</p></div><button className="secondary" autoFocus onClick={()=>setOpen(false)} aria-label="Cerrar información">Cerrar</button></div>
      <h3>Cancelaciones del pasajero</h3>
      {error&&<p role="alert">{error}</p>}{loading&&<p role="status">Actualizando información…</p>}
      {summary&&<PassengerCancellationSummaryCard summary={summary}/>}
      <div className="row-actions"><button className="secondary" disabled={loading} onClick={()=>setRefresh(n=>n+1)}>Actualizar</button><button className="secondary" disabled={loading} aria-expanded={history} onClick={()=>{setPage(1);setHistory(!history);}}>{history?'Ocultar historial':'Ver historial de cancelaciones'}</button></div>
      {history&&!loading&&!error&&<><h3>Historial permanente · todos los ciclos</h3><p className="note">Solo consulta. Los registros y las penalizaciones de ciclos anteriores no se eliminan.</p>
      {rows.length?<div className="table-wrap cancellation-history"><table><thead><tr><th>Ciclo / cancelación</th><th>Viaje y responsable</th><th>Penalización</th><th>Estado</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}>
        <td><strong>N.º {r.consecutive_number} del ciclo</strong><small className="table-line">Cancelación: {date(r.occurred_at)}</small><small className="table-line">Ciclo: {date(r.cycleStartsAt)} → {date(r.cycleEndsAt)}</small><small className="table-line">{r.cycleDurationDays} días{r.cycleSource==='LEGACY'?' · Historial previo al sistema de ciclos':''}</small><details><summary>Identificador del ciclo</summary>{r.cycle_id}</details></td>
        <td>{r.origin} → {r.destination}<small className="table-line">Conductor: {r.driverName}</small><small className="table-line">Originada por: {r.originatorName} (pasajero)</small><small className="table-line">Motivo: {r.reason_code==='PASSENGER_CANCELLED'?'Cancelación del pasajero':r.reason_code}</small><details><summary>Referencia del viaje</summary>{r.trip_id}</details></td>
        <td>{r.policy_snapshot?.enabled===false?'Registrada sin sanción automática':outcome(r.suspension_days)}{r.suspension_started_at&&<small className="table-line">{date(r.suspension_started_at)} → {r.suspension_until?date(r.suspension_until):'Sin fecha de fin'}</small>}</td>
        <td>{r.policy_snapshot?.enabled===false&&r.status==='RECORDED'?'Registrada':statuses[r.status]??r.status}<small className="table-line">{r.reactivated_at?`Reactivada: ${date(r.reactivated_at)}`:''}</small></td>
      </tr>)}</tbody></table></div>:<p>No hay cancelaciones después de la aceptación.</p>}
      <div className="row-actions"><button className="secondary" disabled={page===1} onClick={()=>setPage(page-1)}>Anterior</button><span>Página {page}</span><button className="secondary" disabled={rows.length<20||page*20>=Number(rows[0]?.totalCount??0)} onClick={()=>setPage(page+1)}>Siguiente</button></div></>}
    </section></div>}</>;
}

export type CancellationSummary = {
  cycleCount:number;historicalTotal:number;threshold:number|null;nextThreshold:number|null;
  cycleActive:boolean;cycleStartsAt:string|null;cycleEndsAt:string|null;cycleDurationDays:number|null;
  configuredDurationDays:number;enforcementEnabled:boolean;state:string;suspendedUntil:string|null;
};
export function PassengerCancellationSummaryCard({summary:s}:{summary:CancellationSummary}) {
  const stateLabels:Record<string,string>={NORMAL:'Normal',WARNING:'Advertencia',SUSPENDED:'Suspendido',INDEFINITE:'Suspensión indefinida'};
  return <><dl className="cancellation-summary">
    <div className="card"><dt>Cancelaciones del ciclo actual</dt><dd>{s.cycleCount}</dd></div>
    <div className="card"><dt>Límite / umbral actual</dt><dd>{s.threshold??'Sin suspensión automática'}</dd>{s.nextThreshold&&<small>Siguiente penalización: n.º {s.nextThreshold}</small>}</div>
    <div className="card"><dt>Inicio del ciclo</dt><dd>{s.cycleActive?date(s.cycleStartsAt):'Sin ciclo vigente'}</dd></div>
    <div className="card"><dt>Fin estimado del ciclo</dt><dd>{s.cycleActive?date(s.cycleEndsAt):'—'}</dd></div>
    <div className="card"><dt>Estado</dt><dd>{stateLabels[s.state]??s.state}</dd>{s.suspendedUntil&&<small>Fin de suspensión: {date(s.suspendedUntil)}</small>}</div>
    <div className="card"><dt>Cancelaciones históricas totales</dt><dd>{s.historicalTotal}</dd><small>Este total nunca se reinicia.</small></div>
  </dl><p className="note">{s.cycleActive?`Duración del ciclo actual: ${s.cycleDurationDays} días.`:`La próxima cancelación penalizable iniciará un ciclo de ${s.configuredDurationDays} días.`} El vencimiento del ciclo no levanta una suspensión vigente.</p></>;
}
