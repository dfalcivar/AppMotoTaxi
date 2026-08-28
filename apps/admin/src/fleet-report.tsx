import {ecuDate} from './console-model';
import {useConsoleState,ErrorState} from './console-ui';
import {useEffect,useState} from 'react';
import {apiFetch} from './api.js';
const labels:Record<string,string>={ACTIVE:'Activa',ENDED:'Finalizada',MANUAL_RELEASE:'Fin de jornada',LOGOUT:'Cierre de sesión',AUTO_RELEASE:'Inactividad',TAKEOVER:'Relevo',VEHICLE_CHANGE:'Cambio de unidad',ADMIN_RELEASE:'Liberación administrativa'};
export function FleetReport({token,onVehicle}:{token:string;onVehicle:(id:string)=>void}){
  const [data,setData]=useState<any>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[page,setPage]=useState(0);
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Guayaquil'});
  const [filters,setFilters]=useConsoleState<Record<string,string>>("fleet-report-filters",{from:today,to:today,driverId:'',vehicleId:'',ownerId:'',cooperativeId:'',state:'',endReason:''});
  const [options,setOptions]=useState<any>({users:[],cooperatives:[],vehicles:[]}),[personSearch,setPersonSearch]=useState('');
  async function people(){try{const o=await apiFetch<any>(`/v1/admin/fleet/options?search=${encodeURIComponent(personSearch)}`,token);const v=await apiFetch<any>(`/v1/admin/fleet/vehicles?search=${encodeURIComponent(personSearch)}`,token);setOptions({...o,vehicles:v.items});}catch(e){setError((e as Error).message);}}
  async function load(p=page){setBusy(true);setError('');try{const q=new URLSearchParams({page:String(p)});for(const [k,v]of Object.entries(filters))if(v)q.set(k,k==='from'?new Date(v+'T00:00:00-05:00').toISOString():k==='to'?new Date(v+'T23:59:59-05:00').toISOString():v);setData(await apiFetch<any>(`/v1/admin/fleet/report?${q}`,token));setPage(p);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  useEffect(()=>{void people();void load(0);},[token]);
  const select=(key:string,title:string,items:any[])=> <label>{title}<select value={filters[key]} onChange={e=>setFilters({...filters,[key]:e.target.value})}><option value="">Todos</option>{items.map(i=><option key={i.id} value={i.id}>{i.name??i.identifier}</option>)}</select></label>;
  return <details className="card fleet-report"><summary>Resumen de flota y jornadas</summary><p>Actividad operativa del período. No incluye información privada de pasajeros.</p>
    <form className="fleet-toolbar" onSubmit={e=>{e.preventDefault();void people();}}><input aria-label="Buscar filtros de flota" value={personSearch} onChange={e=>setPersonSearch(e.target.value)} placeholder="Buscar conductor, responsable o unidad"/><button className="secondary">Buscar opciones</button></form>
    <form className="fleet-toolbar" onSubmit={e=>{e.preventDefault();void load(0);}}>{['from','to'].map(k=><label key={k}>{k==='from'?'Desde':'Hasta'}<input type="date" required value={filters[k]} onChange={e=>setFilters({...filters,[k]:e.target.value})}/></label>)}
      {select('driverId','Conductor',options.users.filter((u:any)=>u.driver))}{select('ownerId','Responsable',options.users)}{select('vehicleId','Mototaxi',options.vehicles)}{select('cooperativeId','Cooperativa',options.cooperatives)}
      {select('state','Estado',['ACTIVE','ENDED'].map(id=>({id,name:labels[id]})))}{select('endReason','Motivo de cierre',['MANUAL_RELEASE','LOGOUT','AUTO_RELEASE','TAKEOVER','VEHICLE_CHANGE','ADMIN_RELEASE'].map(id=>({id,name:labels[id]})))}<button className="primary" disabled={busy}>Consultar</button></form>
    {error&&<ErrorState message={error} onRetry={()=>void load(0)}/>}{busy&&<p role="status">Consultando actividad…</p>}
    {data&&<><div className="fleet-summary">{Object.entries({totalUnits:'Unidades',activeUnits:'Con actividad',activeDrivers:'Conductores activos',completed:'Viajes finalizados',cancelled:'Cancelaciones',inactiveUnits:'Sin actividad',incidents:'Incidencias'}).map(([key,title])=><article key={key}><small>{title}</small><strong>{data.summary?.[key]??0}</strong></article>)}<article><small>Horas de operación</small><strong>{(Number(data.summary?.operationSeconds)/3600).toFixed(1)}</strong></article></div>
      {data.items.map((s:any)=><div className="fleet-row" key={s.id}><div><strong>{s.identifier} · {s.driverName}</strong><small>{ecuDate(s.startedAt)} · {labels[s.status]} · {labels[s.endReason]??'En jornada'} · {s.accepted} aceptados</small></div><button className="secondary" onClick={()=>onVehicle(s.vehicleId)}>Ver unidad</button></div>)}{!data.items.length&&<p>No hay jornadas con estos filtros.</p>}<div className="fleet-toolbar"><button className="secondary" disabled={busy||!page} onClick={()=>void load(page-1)}>Anterior</button><span>Página {page+1}</span><button className="secondary" disabled={busy||data.items.length<30} onClick={()=>void load(page+1)}>Siguiente</button></div></>}
  </details>;
}
