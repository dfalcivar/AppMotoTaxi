import { useEffect, useState } from 'react';
import { apiFetch } from './api.js';
import { usePanelDialog } from './panel-dialog.js';

type Configuration = { enabled:boolean; dayArrivalFee:string; nightArrivalFee:string;
  dayStartTime:string; nightStartTime:string; timezone:string };
type SettingsResponse = {version:number; configuration:Configuration|null; costaGoPercent?:string};
export function ScheduledArrivalSettings({token}:{token:string}) {
  const [configuration,setConfiguration]=useState<Configuration>({enabled:false,dayArrivalFee:'',nightArrivalFee:'',
    dayStartTime:'',nightStartTime:'',timezone:''});
  const [version,setVersion]=useState<number>();
  const [percentage,setPercentage]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const dialog=usePanelDialog();
  useEffect(()=>{
    let active=true;
    setLoading(true);setMessage('');
    apiFetch<SettingsResponse>('/v1/admin/scheduled-arrival-settings',token).then(result=>{
      if(!active)return;
      setVersion(result.version);setPercentage(result.costaGoPercent??'');
      if(result.configuration)setConfiguration(result.configuration);
    }).catch(error=>{if(active)setMessage(`No se pudo cargar la configuración guardada. ${String(error)}`);})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[token]);
  async function save(event:React.FormEvent) {
    event.preventDefault();
    if(busy||version===undefined)return;
    const confirmed=await dialog.open({title:'Confirmar tarifas programadas',
      description:'Se aplicarán a nuevas reservas y modificaciones confirmadas. Los viajes ya confirmados conservan su precio. Requiere la app compatible con confirmación de precio.',
      confirmLabel:'Guardar configuración'});
    if(!confirmed)return;
    setBusy(true);setMessage('');
    try {
      const result=await apiFetch<SettingsResponse>('/v1/admin/scheduled-arrival-settings',token,{method:'PUT',body:JSON.stringify({version,configuration})});
      setVersion(result.version);if(result.configuration)setConfiguration(result.configuration);
      setMessage('Configuración guardada. No se modificaron reservas anteriores.');
    }catch(error){setMessage(String(error));}finally{setBusy(false);}
  }
  const field=(key:keyof Omit<Configuration,'enabled'>,label:string,type='text')=><label>{label}
    <input type={type} required value={configuration[key]} disabled={busy}
      inputMode={key.endsWith('Fee')?'decimal':undefined}
      onChange={event=>setConfiguration(current=>({...current,[key]:event.target.value}))}/></label>;
  if(loading)return <section className="card" aria-busy="true">
    <h2>Tarifa de llegada · viajes programados</h2>
    <p className="note">Cargando la configuración guardada…</p>
  </section>;
  return <section className="card">
    <h2>Tarifa de llegada · viajes programados</h2>
    <p>Según la hora del servicio, no la hora de reserva. No cambia las rondas de viajes inmediatos.</p>
    <form onSubmit={event=>void save(event)}>
      <label><input type="checkbox" checked={configuration.enabled} disabled={busy}
        onChange={event=>setConfiguration(current=>({...current,enabled:event.target.checked}))}/> Activar tarifa programada día/noche</label>
      <div className="settings-grid">
        {field('dayStartTime','Inicio del día','time')}{field('nightStartTime','Inicio de la noche','time')}
        {field('dayArrivalFee','Llegada diurna (USD)')}{field('nightArrivalFee','Llegada nocturna (USD)')}
        {field('timezone','Zona horaria IANA')}
      </div>
      <p>Participación Costa-Go: {percentage || '—'}%. Reutiliza el porcentaje general, sin uno adicional para día/noche.</p>
      <button className="primary" disabled={busy||version===undefined}>Guardar tarifas programadas</button>
      {message&&<p role="status">{message}</p>}
    </form>
    {dialog.modal}
  </section>;
}
