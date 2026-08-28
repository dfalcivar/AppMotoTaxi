import {ManagedTable} from './console-ui';
import {ecuDate} from './console-model';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from './api.js';
import './panel-dialog.css';
import './passenger-cancellations.css';

export type Policy = { enabled:boolean; cycleDurationDays:number; steps:Array<{fromCount:number;suspensionDays:number|null}> };
const date = ecuDate;
const outcome = (days:number|null) => days === null ? 'Suspensión indefinida' : days === 0 ? 'Advertencia' : `${days} días de suspensión`;
const tone = (days:number|null) => days === null ? 'indefinite' : days === 0 ? 'warning' : 'suspension';
const rangeLabel = (steps:Policy['steps'], index:number) => {
  const start=steps[index]!.fromCount, end=steps[index+1]?.fromCount;
  return end === undefined ? `Cancelación ${start} o más` : end === start+1 ? `Cancelación ${start}` : `Cancelaciones ${start}–${end-1}`;
};

export function CancellationPolicyOverview({policy}:{policy:Policy}) {
  return <><div className="cancellation-policy-stats"><div><span>Aplicación de sanciones</span><strong className={`cancellation-policy-status ${policy.enabled?'enabled':''}`}><span aria-hidden="true">●</span> {policy.enabled?'Control activo':'Solo registro'}</strong></div><div><span>Duración de cada ciclo nuevo</span><strong>{policy.cycleDurationDays} días</strong></div><div><span>Inicio del ciclo</span><strong>Primera cancelación penalizable</strong></div></div>
    <div className="cancellation-policy-rules" aria-label="Rangos de cancelaciones">{policy.steps.map((step,index)=><div className={`cancellation-policy-rule ${tone(step.suspensionDays)}`} key={step.fromCount}><span>{rangeLabel(policy.steps,index)}</span><strong>{outcome(step.suspensionDays)}</strong></div>)}</div></>;
}

export function CancellationPolicyFields({draft,onChange,disabled}:{draft:Policy;onChange:(value:Policy)=>void;disabled:boolean}) {
  return <fieldset className="cancellation-policy-fields" disabled={disabled}><legend className="cancellation-sr-only">Condiciones de cancelación</legend>
    <label className="cancellation-policy-toggle"><span><strong>Suspensiones automáticas</strong><small>Desactiva para registrar cancelaciones sin aplicar nuevas sanciones.</small></span><input type="checkbox" role="switch" checked={draft.enabled} onChange={e=>onChange({...draft,enabled:e.target.checked})}/></label>
    <div className="cancellation-cycle-setting"><label>Duración de los nuevos ciclos (días)<input required type="number" min="1" max="3650" step="1" value={draft.cycleDurationDays} onChange={e=>onChange({...draft,cycleDurationDays:Number(e.target.value)})}/></label><p>Por ejemplo: 30, 60 o 90 días desde la primera cancelación. Los ciclos ya iniciados conservan su duración.</p></div>
    <div className="cancellation-rules-heading"><h3>Escala de sanciones</h3><p>Cada rango aplica desde el número indicado hasta el siguiente rango.</p></div>
    <div className="cancellation-rule-editors">{draft.steps.map((step,index)=><section className="cancellation-rule-editor" key={index} aria-label={`Rango ${index+1}`}><div className="cancellation-rule-heading"><span className="cancellation-rule-number">Rango {index+1}</span><span className={`cancellation-outcome ${tone(step.suspensionDays)}`}>{outcome(step.suspensionDays)}</span><button type="button" className="cancellation-remove" disabled={draft.steps.length===1} aria-label={`Quitar rango ${index+1}`} onClick={()=>onChange({...draft,steps:draft.steps.filter((_,j)=>j!==index)})}>Quitar</button></div>
      <div className="cancellation-rule-inputs"><label>Desde cancelación<input required type="number" min="1" max="10000" step="1" value={step.fromCount} onChange={e=>onChange({...draft,steps:draft.steps.map((value,j)=>j===index?{...value,fromCount:Number(e.target.value)}:value)})}/></label><label>Días de suspensión<input required disabled={step.suspensionDays===null} type="number" min="0" max="3650" step="1" value={step.suspensionDays??0} onChange={e=>onChange({...draft,steps:draft.steps.map((value,j)=>j===index?{...value,suspensionDays:Number(e.target.value)}:value)})}/><small>{step.suspensionDays===null?'Sin fecha de finalización':'0 días = solo advertencia'}</small></label><label className="cancellation-indefinite"><input type="checkbox" checked={step.suspensionDays===null} onChange={e=>onChange({...draft,steps:draft.steps.map((value,j)=>j===index?{...value,suspensionDays:e.target.checked?null:0}:value)})}/><span>Indefinida</span></label></div>
    </section>)}</div>
    <button className="secondary cancellation-add-range" type="button" disabled={draft.steps.length>=30} onClick={()=>onChange({...draft,steps:[...draft.steps,{fromCount:(draft.steps.at(-1)?.fromCount??0)+1,suspensionDays:0}]})}>+ Agregar rango</button>
    <p className="cancellation-policy-note">Una suspensión indefinida requiere reactivación manual. Cambiar esta política no acorta suspensiones ya aplicadas.</p>
  </fieldset>;
}

export function PassengerCancellationSettings({token,canManage}:{token:string;canManage:boolean}) {
  const [policy,setPolicy]=useState<Policy>(); const [draft,setDraft]=useState<Policy>();
  const [busy,setBusy]=useState(false); const [message,setMessage]=useState('');
  const dialogRef=useRef<HTMLFormElement>(null), triggerRef=useRef<HTMLButtonElement>(null);
  const dialogOpen=Boolean(draft);
  useEffect(()=>{
    if(!dialogOpen)return;
    const overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    return()=>{document.body.style.overflow=overflow;triggerRef.current?.focus();};
  },[dialogOpen]);
  function dialogKeyDown(event:React.KeyboardEvent) {
    if(event.key==='Escape'&&!busy){event.preventDefault();setDraft(undefined);return;}
    if(event.key!=='Tab')return;
    const controls=Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button,input,[tabindex="0"]')??[]).filter(element=>!element.matches(':disabled')&&element.tabIndex>=0);
    const first=controls[0],last=controls.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
  useEffect(()=>{let current=true;apiFetch<Policy>('/v1/admin/settings/passenger-cancellations',token).then(v=>{if(current)setPolicy(v);}).catch(()=>{if(current)setMessage('No se pudo cargar la política de cancelaciones.');});return()=>{current=false;};},[token]);
  async function save(event:React.FormEvent) {
    event.preventDefault(); if(busy||!draft)return; setBusy(true);setMessage('');
    try {const v=await apiFetch<Policy>('/v1/admin/settings/passenger-cancellations',token,{method:'PATCH',body:JSON.stringify(draft)});setPolicy(v);setDraft(undefined);setMessage('Política guardada. La duración se aplicará a ciclos nuevos; las fechas y suspensiones existentes se conservan.');}
    catch {setMessage('No se pudo guardar. Los rangos deben iniciar en 1 y aumentar, dejando la suspensión indefinida al final.');}
    finally {setBusy(false);}
  }
  return <section className="card cancellation-policy-card"><div className="cancellation-policy-heading"><div className="cancellation-policy-title"><span className="settings-summary-icon" aria-hidden="true">↺</span><div><span className="eyebrow">POLÍTICA DE PASAJEROS</span><h2>Cancelaciones después de aceptar</h2></div></div>{policy&&<button ref={triggerRef} className="secondary" onClick={()=>{setMessage('');setDraft(structuredClone(policy));}}>{canManage?'Configurar política':'Ver política'}</button>}</div><p className="cancellation-policy-description">Solo cuentan las cancelaciones del pasajero después de una aceptación real y antes de iniciar el viaje.</p>
    {policy&&<CancellationPolicyOverview policy={policy}/>}
    <p className="cancellation-policy-note">Al vencer el ciclo se reinicia el contador, no el historial ni una suspensión vigente. No depende del mes calendario.</p>
    {!policy&&!message&&<p role="status">Cargando política…</p>}{message&&!draft&&<p className="cancellation-policy-note" role="status">{message}</p>}
    {draft&&<div className="panel-dialog-backdrop cancellation-policy-backdrop"><form ref={dialogRef} className="panel-dialog-card cancellation-policy-modal" role="dialog" aria-modal="true" aria-labelledby="cancellation-policy-title" onKeyDown={dialogKeyDown} onSubmit={save}>
      <div className="panel-dialog-heading cancellation-policy-modal-header"><div><span className="eyebrow">CONFIGURACIÓN OPERATIVA</span><h2 id="cancellation-policy-title">Política de cancelaciones</h2><p>Define el ciclo y las condiciones de cada sanción.</p></div><button autoFocus type="button" className="modal-close-button" aria-label="Cerrar política" disabled={busy} onClick={()=>setDraft(undefined)}>×</button></div>
      <div className="cancellation-policy-modal-body"><CancellationPolicyFields draft={draft} onChange={setDraft} disabled={!canManage||busy}/>{message&&<p className="alert error" role="alert">{message}</p>}</div>
      <div className="cancellation-policy-actions"><button className="secondary" type="button" disabled={busy} onClick={()=>setDraft(undefined)}>{canManage?'Cancelar':'Cerrar'}</button>{canManage&&<button className="primary" type="submit" disabled={busy}>{busy?'Guardando…':'Guardar política'}</button>}</div>
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
      {rows.length?<div className="table-wrap cancellation-history"><ManagedTable serverPaged><thead><tr><th>Ciclo / cancelación</th><th>Viaje y responsable</th><th>Penalización</th><th>Estado</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}>
        <td><strong>N.º {r.consecutive_number} del ciclo</strong><small className="table-line">Cancelación: {date(r.occurred_at)}</small><small className="table-line">Ciclo: {date(r.cycleStartsAt)} → {date(r.cycleEndsAt)}</small><small className="table-line">{r.cycleDurationDays} días{r.cycleSource==='LEGACY'?' · Historial previo al sistema de ciclos':''}</small><details><summary>Identificador del ciclo</summary>{r.cycle_id}</details></td>
        <td>{r.origin} → {r.destination}<small className="table-line">Conductor: {r.driverName}</small><small className="table-line">Originada por: {r.originatorName} (pasajero)</small><small className="table-line">Motivo: {r.reason_code==='PASSENGER_CANCELLED'?'Cancelación del pasajero':r.reason_code}</small><details><summary>Referencia del viaje</summary>{r.trip_id}</details></td>
        <td>{r.policy_snapshot?.enabled===false?'Registrada sin sanción automática':outcome(r.suspension_days)}{r.suspension_started_at&&<small className="table-line">{date(r.suspension_started_at)} → {r.suspension_until?date(r.suspension_until):'Sin fecha de fin'}</small>}</td>
        <td>{r.policy_snapshot?.enabled===false&&r.status==='RECORDED'?'Registrada':statuses[r.status]??r.status}<small className="table-line">{r.reactivated_at?`Reactivada: ${date(r.reactivated_at)}`:''}</small></td>
      </tr>)}</tbody></ManagedTable></div>:<p>No hay cancelaciones después de la aceptación.</p>}
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
