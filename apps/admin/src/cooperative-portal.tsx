import {useEffect,useMemo,useState} from 'react';
import {apiFetch} from './api';
import {ecuDate,navigateConsole,usd} from './console-model';
import {ConsoleIcon,DataTable,ErrorState,LoadingState} from './console-ui';

type CooperativeDriver={id:string;name:string;email?:string;phone?:string;status:string;vehicle?:string;available?:boolean;lastActivity?:string;rating?:number;trips?:number;tripsThisMonth?:number;completed?:number;cancelled?:number};
type CooperativeTrip={id:string;status:string;passenger?:string;driver?:string;origin?:string;destination?:string;totalCents?:number;requestedAt:string};
type CooperativeOverview={
  cooperative:{id:string;name:string;legalName?:string;registrationNumber?:string;email?:string;phone?:string;status:string;updatedAt?:string;totalDrivers:number;activeDrivers:number;inactiveDrivers:number;connectedDrivers:number;totalTrips:number;tripsThisMonth:number;completedTrips:number;cancelledTrips:number;averageRating:number};
  drivers:CooperativeDriver[];trips:CooperativeTrip[];activity:{id:string;action:string;actor?:string;detail?:string;createdAt:string}[];
};

const statusLabels:Record<string,string>={ACTIVE:'Activa',COMPLETED:'Finalizado',CANCELLED:'Cancelado',IN_PROGRESS:'En curso',DRIVER_EN_ROUTE:'En camino',DRIVER_ARRIVED:'Conductor llegó',ASSIGNED:'Asignado',SEARCHING:'Buscando conductor',SCHEDULED:'Programado',SCHEDULED_ASSIGNED:'Programado con conductor',SCHEDULED_READY:'Próximo a iniciar'};
const safeNumber=(value:unknown)=>Number(value)||0;
const percent=(value:number,total:number)=>total?Math.round(value*1000/total)/10:0;
const statusText=(status:string)=>statusLabels[status]??status.replaceAll('_',' ').toLocaleLowerCase('es');

function downloadCsv(name:string,headers:string[],rows:(string|number)[][]){
  const cell=(value:string|number)=>`"${String(value??'').replaceAll('"','""')}"`;
  const content=['\uFEFF'+headers.map(cell).join(';'),...rows.map(row=>row.map(cell).join(';'))].join('\r\n');
  const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function Kpi({icon,label,value,detail,tone='blue'}:{icon:string;label:string;value:string|number;detail:string;tone?:string}){
  return <article className={`coop-kpi ${tone}`}><span><ConsoleIcon name={icon}/></span><div><small>{label}</small><strong>{value}</strong><em>{detail}</em></div></article>;
}

function MiniBars({items,label}:{items:{label:string;value:number}[];label:string}){
  const maximum=Math.max(1,...items.map(item=>item.value));
  return <div className="coop-mini-bars" role="img" aria-label={label}>{items.map(item=><div key={item.label} title={`${item.label}: ${item.value}`}><i style={{height:`${Math.max(7,item.value*100/maximum)}%`}}/><small>{item.label}</small></div>)}</div>;
}

export function CooperativePortal({token,name,view='overview',canExport=false}:{token:string;name:string;view?:'overview'|'analytics';canExport?:boolean}){
  const [data,setData]=useState<CooperativeOverview>();const [error,setError]=useState('');const [loading,setLoading]=useState(true);const [revision,setRevision]=useState(0);const [period,setPeriod]=useState<'7'|'30'|'all'>('30');
  useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');apiFetch<CooperativeOverview>('/v1/admin/cooperative-dashboard/overview',token,{signal:controller.signal}).then(setData).catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'No se pudo cargar la cooperativa.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[token,revision]);
  const filteredTrips=useMemo(()=>{if(!data)return[];if(period==='all')return data.trips;const since=Date.now()-Number(period)*86400000;return data.trips.filter(trip=>new Date(trip.requestedAt).getTime()>=since);},[data,period]);
  const insights=useMemo(()=>{
    const days=new Map<string,number>(),hours=Array.from({length:24},(_,hour)=>({label:String(hour).padStart(2,'0'),value:0})),origins=new Map<string,number>();
    for(const trip of filteredTrips){const date=new Date(trip.requestedAt);if(!Number.isFinite(date.getTime()))continue;const day=new Intl.DateTimeFormat('es-EC',{timeZone:'America/Guayaquil',day:'2-digit',month:'2-digit'}).format(date);days.set(day,(days.get(day)??0)+1);const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Guayaquil',hour:'2-digit',hourCycle:'h23'}).format(date));if(hours[hour])hours[hour].value++;const origin=(trip.origin||'Sin referencia').trim();origins.set(origin,(origins.get(origin)??0)+1);}
    return {days:[...days].map(([label,value])=>({label,value})).slice(-14),hours:hours.filter((_,index)=>index%2===0).map((item,index)=>({label:item.label,value:item.value+(hours[index*2+1]?.value??0)})),origins:[...origins].sort((a,b)=>b[1]-a[1]).slice(0,5)};
  },[filteredTrips]);
  if(loading)return <LoadingState label="Preparando el portal de tu cooperativa…"/>;
  if(error||!data)return <ErrorState message={error||'No existe información disponible.'} onRetry={()=>setRevision(value=>value+1)}/>;
  const c=data.cooperative,completion=percent(safeNumber(c.completedTrips),safeNumber(c.completedTrips)+safeNumber(c.cancelledTrips));
  const topDrivers=[...data.drivers].sort((a,b)=>safeNumber(b.tripsThisMonth)-safeNumber(a.tripsThisMonth)||safeNumber(b.rating)-safeNumber(a.rating)).slice(0,5);
  const exportDrivers=()=>downloadCsv(`costa-go-${c.name}-conductores.csv`,['Conductor','Correo','Estado','Mototaxi','Viajes del mes','Viajes totales','Calificación'],data.drivers.map(driver=>[driver.name,driver.email??'',statusText(driver.status),driver.vehicle??'',safeNumber(driver.tripsThisMonth),safeNumber(driver.trips),safeNumber(driver.rating).toFixed(2)]));
  const exportTrips=()=>downloadCsv(`costa-go-${c.name}-viajes.csv`,['Fecha','Pasajero','Conductor','Origen','Destino','Estado','Total'],filteredTrips.map(trip=>[ecuDate(trip.requestedAt),trip.passenger??'',trip.driver??'',trip.origin??'',trip.destination??'',statusText(trip.status),(safeNumber(trip.totalCents)/100).toFixed(2)]));
  return <div className="coop-portal">
    <section className="coop-hero">
      <div className="coop-hero-copy"><span className="coop-product"><ConsoleIcon name="shield" size={17}/> Portal corporativo Costa-Go</span><p>Hola, {name}</p><h1>{c.name}</h1><span>{c.legalName||'Gestión operativa de movilidad'}{c.registrationNumber?` · ${c.registrationNumber}`:''}</span><div className="coop-status"><i/> Datos limitados exclusivamente a tu cooperativa</div></div>
      <div className="coop-hero-actions"><button className="secondary" onClick={()=>setRevision(value=>value+1)}><ConsoleIcon name="refresh" size={16}/> Actualizar</button><button className="primary" onClick={()=>navigateConsole('fleet')}><ConsoleIcon name="vehicle" size={17}/> Ver flota</button><small>{c.updatedAt?`Registro actualizado ${ecuDate(c.updatedAt)}`:'Información operativa vigente'}</small></div>
    </section>
    <nav className="coop-view-nav" aria-label="Secciones del portal"><button className={view==='overview'?'active':''} onClick={()=>navigateConsole('home')}><ConsoleIcon name="home" size={17}/> Resumen ejecutivo</button><button className={view==='analytics'?'active':''} onClick={()=>navigateConsole('dashboard')}><ConsoleIcon name="chart" size={17}/> Inteligencia operativa</button><button onClick={()=>navigateConsole('fleet')}><ConsoleIcon name="vehicle" size={17}/> Flota y unidades</button></nav>
    <section className="coop-kpis" aria-label="Indicadores principales">
      <Kpi icon="users" label="Conductores activos" value={safeNumber(c.activeDrivers)} detail={`${safeNumber(c.totalDrivers)} registrados`} tone="blue"/>
      <Kpi icon="refresh" label="En línea ahora" value={safeNumber(c.connectedDrivers)} detail="Disponibles recientemente" tone="green"/>
      <Kpi icon="trips" label="Viajes este mes" value={safeNumber(c.tripsThisMonth).toLocaleString('es-EC')} detail={`${safeNumber(c.totalTrips).toLocaleString('es-EC')} históricos`} tone="cyan"/>
      <Kpi icon="check" label="Finalización" value={`${completion}%`} detail="Sobre viajes cerrados" tone="green"/>
      <Kpi icon="star" label="Calificación" value={safeNumber(c.averageRating).toFixed(2)} detail="Promedio de conductores" tone="amber"/>
    </section>

    {view==='overview'?<>
      <div className="coop-dashboard-grid">
        <section className="coop-panel coop-operation"><header><div><span className="eyebrow">OPERACIÓN ACTUAL</span><h2>Lo esencial para gestionar hoy</h2></div><button className="link" onClick={()=>navigateConsole('dashboard')}>Analizar operación →</button></header><div className="coop-operation-body"><div className="coop-ring" style={{'--value':`${completion*3.6}deg`} as React.CSSProperties}><strong>{completion}%</strong><span>finalización</span></div><dl><div><dt>Viajes completados</dt><dd>{safeNumber(c.completedTrips).toLocaleString('es-EC')}</dd></div><div><dt>Viajes cancelados</dt><dd>{safeNumber(c.cancelledTrips).toLocaleString('es-EC')}</dd></div><div><dt>Conductores inactivos</dt><dd>{safeNumber(c.inactiveDrivers)}</dd></div></dl></div><p className="coop-data-note">Los indicadores se calculan con registros reales asociados a la cooperativa.</p></section>
        <section className="coop-panel"><header><div><span className="eyebrow">DESEMPEÑO</span><h2>Conductores con más actividad</h2></div><button className="link" onClick={()=>navigateConsole('fleet')}>Gestionar unidades →</button></header>{topDrivers.length?<div className="coop-driver-ranking">{topDrivers.map((driver,index)=><article key={driver.id}><b>{index+1}</b><div><strong>{driver.name}</strong><small>{driver.vehicle||'Sin unidad asignada'}</small></div><span><strong>{safeNumber(driver.tripsThisMonth)}</strong><small>este mes</small></span></article>)}</div>:<p className="empty">Aún no hay conductores registrados.</p>}</section>
      </div>
      <section className="coop-panel coop-recent"><header><div><span className="eyebrow">TRAZABILIDAD</span><h2>Actividad reciente de viajes</h2></div><button className="link" onClick={()=>navigateConsole('dashboard')}>Ver análisis completo →</button></header>{data.trips.length?<DataTable variant="directory" label="Viajes recientes de la cooperativa" headers={['Fecha','Conductor','Recorrido','Estado','Total']} rows={data.trips.slice(0,8).map(trip=>[ecuDate(trip.requestedAt),trip.driver||'Sin asignar',<span className="coop-route">{trip.origin||'Origen sin referencia'} <b>→</b> {trip.destination||'Destino sin referencia'}</span>,<span className={`coop-state ${trip.status.toLowerCase()}`}>{statusText(trip.status)}</span>,usd(safeNumber(trip.totalCents)/100)])}/>:<p className="empty">Los viajes aparecerán aquí cuando se registren.</p>}</section>
      <section className="coop-portfolio"><header><span className="eyebrow">PORTAFOLIO CORPORATIVO</span><h2>Servicios que acompañan la gestión de tu cooperativa</h2><p>Capacidades activas y opciones que Costa-Go puede incorporar de acuerdo con la operación.</p></header><div>
        <article><span><ConsoleIcon name="chart"/></span><small>Incluido</small><h3>Inteligencia operativa</h3><p>Indicadores de conductores, viajes, desempeño y tendencias para decidir con evidencia.</p><button onClick={()=>navigateConsole('dashboard')}>Abrir análisis <ConsoleIcon name="arrow" size={15}/></button></article>
        <article><span><ConsoleIcon name="vehicle"/></span><small>Incluido</small><h3>Gestión de flota</h3><p>Consulta de unidades, responsables, autorizaciones y estado operativo de la mototaxi.</p><button onClick={()=>navigateConsole('fleet')}>Ver flota <ConsoleIcon name="arrow" size={15}/></button></article>
        <article><span><ConsoleIcon name="document"/></span><small>Incluido</small><h3>Reportes ejecutivos</h3><p>Exporta información agregada para análisis interno y reuniones de administración.</p>{canExport?<button onClick={exportTrips}>Exportar viajes <ConsoleIcon name="arrow" size={15}/></button>:<em>Consulta habilitada; exportación según permisos.</em>}</article>
        <article className="optional"><span><ConsoleIcon name="support"/></span><small>Disponible para ampliar</small><h3>Acompañamiento corporativo</h3><p>Revisión de indicadores, adopción operativa y orientación para aprovechar mejor la plataforma.</p><a href="mailto:hola@costa-go.com?subject=Acompañamiento%20corporativo%20Costa-Go">Solicitar información <ConsoleIcon name="arrow" size={15}/></a></article>
      </div></section>
    </>:<>
      <section className="coop-analysis-toolbar"><div><span className="eyebrow">LECTURA OPERATIVA</span><h2>Comportamiento de los registros recientes</h2><p>El período se aplica al detalle disponible en esta vista; los indicadores superiores conservan el consolidado oficial.</p></div><label>Período<select value={period} onChange={event=>setPeriod(event.target.value as '7'|'30'|'all')}><option value="7">Últimos 7 días</option><option value="30">Últimos 30 días</option><option value="all">Últimos registros disponibles</option></select></label></section>
      <div className="coop-dashboard-grid analysis">
        <section className="coop-panel"><header><div><span className="eyebrow">VIAJES POR FECHA</span><h2>Evolución de actividad</h2></div><strong>{filteredTrips.length} registros</strong></header>{insights.days.length?<MiniBars items={insights.days} label="Viajes por fecha"/>:<p className="empty">No hay viajes en el período seleccionado.</p>}</section>
        <section className="coop-panel"><header><div><span className="eyebrow">DEMANDA HORARIA</span><h2>Horas con más actividad</h2></div></header>{insights.hours.some(item=>item.value)?<MiniBars items={insights.hours} label="Viajes agrupados cada dos horas"/>:<p className="empty">No hay horas que analizar en este período.</p>}</section>
        <section className="coop-panel"><header><div><span className="eyebrow">ORÍGENES</span><h2>Puntos referenciados con frecuencia</h2></div></header>{insights.origins.length?<ol className="coop-origins">{insights.origins.map(([origin,count])=><li key={origin}><ConsoleIcon name="map" size={18}/><span><strong>{origin}</strong><small>{count} viaje(s) en la muestra</small></span></li>)}</ol>:<p className="empty">No existen referencias de origen en el período.</p>}</section>
        <section className="coop-panel"><header><div><span className="eyebrow">REPORTES</span><h2>Descargar información</h2></div></header><div className="coop-report-actions"><button className="secondary" disabled={!canExport} onClick={exportDrivers}><ConsoleIcon name="users"/> Conductores en CSV</button><button className="primary" disabled={!canExport} onClick={exportTrips}><ConsoleIcon name="trips"/> Viajes del período</button>{!canExport&&<small>Tu cuenta puede consultar los datos, pero no tiene habilitada la exportación.</small>}</div></section>
      </div>
      <section className="coop-panel"><header><div><span className="eyebrow">DETALLE</span><h2>Viajes del período seleccionado</h2></div><small>Máximo de registros entregados por el servicio</small></header><DataTable variant="directory" label="Detalle de viajes de la cooperativa" headers={['Fecha','Pasajero','Conductor','Origen','Destino','Estado','Total']} rows={filteredTrips.map(trip=>[ecuDate(trip.requestedAt),trip.passenger||'—',trip.driver||'Sin asignar',trip.origin||'—',trip.destination||'—',<span className={`coop-state ${trip.status.toLowerCase()}`}>{statusText(trip.status)}</span>,usd(safeNumber(trip.totalCents)/100)])}/></section>
    </>}
  </div>;
}
