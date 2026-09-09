import {useEffect,useState} from 'react';
import {apiFetch} from './api.js';
import {usePanelDialog} from './panel-dialog.js';
import {ManagedTable} from './console-ui';
import './commercial-economics-panel.css';

const money=(v:unknown)=>v==null?'—':new Intl.NumberFormat('es-EC',{style:'currency',currency:'USD'}).format(Number(v));
type EconomicsDraft={enabled:boolean;costaGoPercent:string;searchSessionMinutes:string;sameRouteToleranceMeters:string;
  lowBalanceThreshold:string;minimumTopUp:string;maximumTopUp:string;historicalWindowDays:string;minimumSamples:string;
  fullConfidenceSamples:string;recalculateMinutes:string};
const numberField=(value:string)=>Number(value);
export function CommercialEconomicsPanel({token,permissions,mode}:{token:string;permissions:string[];mode:'settings'|'packages'|'dashboard'}) {
  const [data,setData]=useState<any>(),[report,setReport]=useState<any>(),[wallets,setWallets]=useState<any>(),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const [configurationDraft,setConfigurationDraft]=useState<EconomicsDraft|null>(null),[configurationError,setConfigurationError]=useState('');
  const [from,setFrom]=useState(''),[to,setTo]=useState(''),[zone,setZone]=useState(''),[plan,setPlan]=useState(''),[modality,setModality]=useState('');
  const dialog=usePanelDialog();
  const can=(p:string)=>permissions.includes('*')||permissions.includes(p);
  async function load(){setData(await apiFetch('/v1/admin/commercial-economics',token));}
  useEffect(()=>{void load().catch(e=>setMessage(String(e)));},[token]);
  async function action(fn:()=>Promise<void>){setBusy(true);setMessage('');try{await fn();await load();setMessage('Operación completada.');}catch(e){setMessage(String(e));}finally{setBusy(false);}}
  function configure(){
    const config=data?.settings.configuration??{};
    setConfigurationError('');
    setConfigurationDraft({enabled:Boolean(config.enabled),costaGoPercent:String(data.settings.costaGoPercent??''),searchSessionMinutes:String(config.searchSessionMinutes??''),
      sameRouteToleranceMeters:String(config.sameRouteToleranceMeters??''),lowBalanceThreshold:String(config.lowBalanceThreshold??''),
      minimumTopUp:String(config.minimumTopUp??''),maximumTopUp:String(config.maximumTopUp??''),historicalWindowDays:String(config.historicalWindowDays??''),
      minimumSamples:String(config.minimumSamples??''),fullConfidenceSamples:String(config.fullConfidenceSamples??''),recalculateMinutes:String(config.recalculateMinutes??'')});
  }
  async function saveConfiguration(event:React.FormEvent){
    event.preventDefault();if(!configurationDraft)return;
    const d=configurationDraft,positiveMoney=['minimumTopUp','maximumTopUp'] as const;
    if(positiveMoney.some(key=>!Number.isFinite(Number(d[key]))||Number(d[key])<=0)){setConfigurationError('Los límites de recarga deben ser mayores que cero.');return;}
    if(Number(d.maximumTopUp)<Number(d.minimumTopUp)){setConfigurationError('La recarga máxima no puede ser menor que la recarga mínima.');return;}
    if(!Number.isFinite(Number(d.costaGoPercent))||Number(d.costaGoPercent)<=0||Number(d.costaGoPercent)>100){setConfigurationError('La participación Costa-Go debe estar entre 0,01% y 100%.');return;}
    const integerKeys=['searchSessionMinutes','sameRouteToleranceMeters','historicalWindowDays','minimumSamples','fullConfidenceSamples','recalculateMinutes'] as const;
    if(integerKeys.some(key=>!Number.isInteger(Number(d[key]))||Number(d[key])<1)){setConfigurationError('Los tiempos, distancias y tamaños de muestra deben ser números enteros mayores que cero.');return;}
    if(Number(d.fullConfidenceSamples)<Number(d.minimumSamples)){setConfigurationError('La muestra de confianza completa no puede ser menor que la muestra mínima.');return;}
    const current=data.settings.configuration??{};
    const preservedReference=Array.isArray(current.referenceDistribution)?current.referenceDistribution.filter((item:any)=>Number.isInteger(Number(item.round))&&Number(item.round)>=1&&Number(item.round)<=totalRounds&&Number(item.count)>=0):[];
    const referenceDistribution=preservedReference.some((item:any)=>Number(item.count)>0)?preservedReference:[{round:1,count:1}];
    const configuration={...current,enabled:d.enabled,
      searchSessionMinutes:numberField(d.searchSessionMinutes),sameRouteToleranceMeters:numberField(d.sameRouteToleranceMeters),
      lowBalanceThreshold:Number(d.lowBalanceThreshold||0).toFixed(2),minimumTopUp:Number(d.minimumTopUp).toFixed(2),maximumTopUp:Number(d.maximumTopUp).toFixed(2),
      historicalWindowDays:numberField(d.historicalWindowDays),minimumSamples:numberField(d.minimumSamples),
      fullConfidenceSamples:numberField(d.fullConfidenceSamples),recalculateMinutes:numberField(d.recalculateMinutes),
      referenceDistribution};
    setBusy(true);setConfigurationError('');
    try{await apiFetch('/v1/admin/commercial-economics/configuration',token,{method:'PUT',body:JSON.stringify({version:data.settings.version,configuration,costaGoPercent:String(Number(d.costaGoPercent))})});
      setConfigurationDraft(null);await load();setMessage('Configuración económica guardada. Los nuevos valores se aplicarán solo a operaciones futuras.');}
    catch(e){setConfigurationError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  }
  async function rules(p:any){
    const r=p.rule??{};
    const values=await dialog.open({title:`Reglas comerciales · ${p.name}`,description:'Los factores afectan la recomendación, nunca cambian automáticamente el precio publicado.',fields:[
      {name:'commercialFactor',label:'Factor comercial',required:true,initialValue:String(r.commercial_factor??'')},
      {name:'volumeDiscountPercent',label:'Descuento por volumen (%)',required:true,initialValue:String(r.volume_discount_percent??'')},
      {name:'fixedCost',label:'Costo comercial fijo sin IVA',required:true,initialValue:String(r.fixed_cost??'')},
      {name:'minimumPrice',label:'Precio mínimo sin IVA',required:true,initialValue:String(r.minimum_price??'')},
      {name:'serviceAreaId',label:'ID de zona (vacío: referencia global)',initialValue:r.service_area_id??''}]});
    if(values)await action(async()=>{await apiFetch(`/v1/admin/commercial-economics/packages/${p.id}/rules`,token,{method:'PUT',body:JSON.stringify({...values,version:r.version??0,serviceAreaId:String(values.serviceAreaId).trim()||null})});});
  }
  async function apply(p:any){
    if(!await dialog.open({title:'Aplicar precio sugerido',description:`${p.name}: ${money(p.price)} → ${money(p.calculation.suggestedPrice)} sin IVA. Solo compras futuras; se creará una versión nueva.`,confirmLabel:'Aplicar precio sugerido'}))return;
    await action(async()=>{await apiFetch(`/v1/admin/commercial-economics/packages/${p.id}/apply-suggested-price`,token,{method:'POST',body:JSON.stringify({calculationId:p.calculationId,confirm:true})});});
  }
  async function reportLoad(){await action(async()=>{
    const query=new URLSearchParams();if(from)query.set('from',new Date(`${from}T00:00:00-05:00`).toISOString());if(to)query.set('to',new Date(`${to}T00:00:00-05:00`).toISOString());
    if(zone)query.set('serviceAreaId',zone);if(plan)query.set('planId',plan);if(modality)query.set('billingMode',modality);
    setReport(await apiFetch(`/v1/admin/commercial-economics/dashboard?${query}`,token));
    setWallets(await apiFetch('/v1/admin/commercial-economics/wallets',token));
  });}
  async function wallet(w:any){
    const response:any=await apiFetch(`/v1/admin/commercial-economics/wallets?driverId=${w.driverId}`,token);
    await dialog.open({title:`Movimientos · ${w.name}`,description:response.movements.map((m:any)=>`${new Date(m.created_at).toLocaleString('es-EC')} · ${m.kind} · ${money(m.amount)} · ${m.reason}`).join('\n')||'Sin movimientos',confirmLabel:'Cerrar'});
  }
  async function adjust(w:any){
    const result=await dialog.open({title:`Ajuste auditado · ${w.name}`,description:'No puede dejar el saldo por debajo de las reservas vigentes.',fields:[
      {name:'amount',label:'Importe con signo, sin IVA',required:true},{name:'reason',label:'Motivo',required:true,minLength:5}]});
    if(result)await action(async()=>{await apiFetch(`/v1/admin/commercial-economics/wallets/${w.driverId}/adjust`,token,{method:'POST',body:JSON.stringify({...result,idempotencyKey:crypto.randomUUID()})});setWallets(await apiFetch('/v1/admin/commercial-economics/wallets',token));});
  }
  const updateDraft=(key:keyof EconomicsDraft,value:string|boolean)=>setConfigurationDraft(current=>current?{...current,[key]:value}:current);
  const totalRounds=Math.max(1,Number(data?.settings?.rounds??1));
  const displayedRounds=Array.from({length:Math.min(totalRounds,6)},(_,index)=>index+1);
  if(totalRounds>6)displayedRounds.push(totalRounds);
  const draftFee=Number(data?.settings?.feePerRound??0),draftShare=Number(configurationDraft?.costaGoPercent??0);
  const input=(key:Exclude<keyof EconomicsDraft,'enabled'>,label:string,help:string,options?:{prefix?:string;min?:number;max?:number;step?:string})=><label className="economic-field"><span>{label}</span><div className="economic-input">{options?.prefix&&<b>{options.prefix}</b>}<input type="number" required min={options?.min??0} max={options?.max} step={options?.step??'1'} value={configurationDraft?.[key]??''} onChange={event=>updateDraft(key,event.target.value)}/></div><small>{help}</small></label>;
  return <section className="card">
    <h2>{mode==='settings'?'Tarifa de llegada y saldo Costa-Go':mode==='packages'?'Precios técnicos y sugeridos':'Resultados comerciales y saldos'}</h2>
    {message&&<p role="status">{message}</p>}
    {mode==='settings'&&data&&<><p>Modelo: {data.settings.configuration?.enabled?'Activo para nuevas operaciones':'Sin activar'}. Los ciclos existentes conservan sus condiciones.</p>
      <p>Despacho: {data.settings.initialRadiusMeters} m iniciales · incremento {data.settings.radiusIncrementMeters} m · máximo {data.settings.maximumRadiusMeters} m · {data.settings.roundWaitSeconds} s por ronda.</p>
      <p>Valor por ronda: {money(data.settings.feePerRound)} · participación Costa-Go: {data.settings.costaGoPercent}%. Las rondas siguientes se calculan automáticamente.</p>
      <p>{data.settings.rounds??'—'} rondas · llegada mínima {money(data.settings.minimumArrival)} · máxima {money(data.settings.maximumArrival)} por viaje.</p>
      <button disabled={busy||!can('settings:manage')} onClick={configure}>Configurar modelo económico</button></>}
    {mode==='packages'&&<div className="table-wrap"><ManagedTable><thead><tr><th>Paquete</th><th>Actual sin IVA</th><th>Técnico / sugerido</th><th>Base estadística</th><th>Factor / diferencia</th><th>Acciones</th></tr></thead><tbody>
      {data?.plans.map((p:any)=><tr key={p.id}><td>{p.name}<small>{p.quantity} viajes</small></td><td>{money(p.price)}</td><td>{money(p.calculation?.technicalCost)} / {money(p.calculation?.suggestedPrice)}</td>
        <td>{p.calculation?`${money(p.calculation.expectedCommissionPerTrip)}/viaje · ronda ${p.calculation.meanRound}`:'Pendiente de configurar'}<small>{p.calculation?.scope} · {p.calculatedAt?new Date(p.calculatedAt).toLocaleString('es-EC'):''}</small></td>
        <td>{p.rule?.commercial_factor??'—'} · descuento {p.rule?.volume_discount_percent??'—'}%<small>Diferencia: {p.calculation?.percentageDifference??'—'}%</small></td>
        <td><button disabled={busy||!can('membership_plans:manage')} onClick={()=>void rules(p)}>Reglas</button><button disabled={busy||!p.rule||!can('membership_plans:manage')} onClick={()=>void action(async()=>{await apiFetch(`/v1/admin/commercial-economics/packages/${p.id}/recalculate`,token,{method:'POST'});})}>Recalcular</button>
          <button disabled={busy||!p.calculationId||!can('membership_plans:manage')} onClick={()=>void apply(p)}>Aplicar precio sugerido</button></td></tr>)}
    </tbody></ManagedTable></div>}
    {mode==='dashboard'&&<><div className="settings-grid"><label>Desde<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Hasta (exclusivo)<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
      <label>ID de zona<input value={zone} onChange={e=>setZone(e.target.value)}/></label><label>ID de plan<input value={plan} onChange={e=>setPlan(e.target.value)}/></label><label>Modalidad<select value={modality} onChange={e=>setModality(e.target.value)}><option value="">Todas</option>{['PAY_PER_USE','TRIP_PACKAGE','PERIOD_PLAN_INCLUDED','PERIOD_PLAN_OVERAGE','PERIOD_PLAN_CAP_REACHED'].map(v=><option key={v}>{v}</option>)}</select></label></div>
      <button disabled={busy} onClick={()=>void reportLoad()}>Consultar</button>
      <p>Comisión aplicada no equivale siempre a ingreso cobrado: los excedentes periódicos se pagan en la renovación.</p>
      {report&&<><div className="table-wrap"><ManagedTable><thead><tr><th>Modalidad</th><th>Viajes</th><th>Llegada</th><th>Teórica</th><th>Aplicada</th><th>Cubierta / no aplicada</th><th>Promedios</th></tr></thead><tbody>{report.modalities.map((r:any)=><tr key={r.mode}><td>{r.mode}</td><td>{r.trips}</td><td>{money(r.arrivalTotal)}</td><td>{money(r.theoretical)}</td><td>{money(r.applied)}</td><td>{money(r.covered)}</td><td>Ronda {r.averageRound??'—'}<small>Llegada {money(r.averageArrival)} · comisión {money(r.averageCommission)}</small></td></tr>)}</tbody></ManagedTable></div>
      <h3>Distribución de rondas</h3><p>{report.rounds.map((r:any)=>`${r.round==='PROGRAMADO'?'Programados':`R${r.round}`}: ${r.trips} viajes`).join(' · ')||'Sin viajes en el filtro.'}</p>
      <h3>Paquetes vendidos</h3><p>Compras del período seleccionado; consumo y margen acumulados de cada compra. El margen es provisional mientras queden viajes. Por zona se incluyen compras con viajes en esa zona.</p><div className="table-wrap"><ManagedTable><thead><tr><th>Paquete</th><th>Uso</th><th>Ingreso base sin IVA</th><th>Comisión teórica real</th><th>Margen esperado / acumulado</th></tr></thead><tbody>{report.packages.map((p:any)=><tr key={p.id}><td>{p.snapshot.name}</td><td>{p.used}/{p.quantity}</td><td>{money(p.snapshot.publishedPrice)}</td><td>{money(p.realTheoreticalCommission)}</td><td>{money(p.snapshot.priceEconomics?.expectedMargin)} / {money(p.realMargin)}</td></tr>)}</tbody></ManagedTable></div>
      <h3>Cobros confirmados · alcance global</h3><p>Solo aplica el filtro de fechas: una recarga o membresía no pertenece a una zona de viaje. Las recargas son saldo prepago, no comisión ganada.</p>
      <div className="table-wrap"><ManagedTable><thead><tr><th>Concepto</th><th>Pagos</th><th>Base</th><th>Excedentes / saldo anterior</th><th>Neto sin IVA</th><th>IVA</th></tr></thead><tbody>{report.receipts.map((r:any)=><tr key={r.mode}><td>{r.mode==='WALLET_TOPUP'?'Recargas':r.mode==='TRIP_PACK'?'Paquetes':'Planes por período'}</td><td>{r.payments}</td><td>{money(r.base)}</td><td>{money(r.overages)}</td><td>{money(r.net)}</td><td>{money(r.vat)}</td></tr>)}</tbody></ManagedTable></div>
      <p>Saldos globales actuales: {money(report.wallets.total)} · reservado {money(report.wallets.reserved)}.</p></>}
      {wallets&&<><h3>Saldos de conductores</h3><div className="table-wrap"><ManagedTable><thead><tr><th>Conductor</th><th>Total</th><th>Reservado</th><th>Disponible</th><th>Acciones</th></tr></thead><tbody>{wallets.wallets.map((w:any)=><tr key={w.driverId}><td>{w.name}</td><td>{money(w.total)}</td><td>{money(w.reserved)}</td><td>{money(w.available)}</td><td><button onClick={()=>void wallet(w)}>Movimientos</button><button disabled={busy||!can('memberships:manage')} onClick={()=>void adjust(w)}>Ajustar</button></td></tr>)}</tbody></ManagedTable></div></>}
    </>}
    {configurationDraft&&<div className="economic-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)setConfigurationDraft(null);}}>
      <form className="economic-modal" role="dialog" aria-modal="true" aria-labelledby="economic-modal-title" onSubmit={event=>void saveConfiguration(event)}>
        <header className="economic-modal-heading"><div><span className="eyebrow">GESTIÓN SEGURA</span><h2 id="economic-modal-title">Configuración económica</h2><p>Define un único valor por ronda. Costa-Go calcula automáticamente los importes de las rondas siguientes.</p></div><button type="button" className="modal-close-button" aria-label="Cerrar" disabled={busy} onClick={()=>setConfigurationDraft(null)}>×</button></header>
        <section className="economic-activation"><label className="economic-toggle"><input type="checkbox" checked={configurationDraft.enabled} onChange={event=>updateDraft('enabled',event.target.checked)}/><i aria-hidden="true"/><span><strong>Activar modelo para nuevas solicitudes y ciclos</strong><small>Los viajes, compras y ciclos existentes conservarán sus condiciones.</small></span></label><p><b>ⓘ</b><span>Solo aplica a operaciones futuras.<small>No modifica precios publicados automáticamente.</small></span></p></section>
        <section className="economic-rate-card"><div className="economic-section-heading"><span className="economic-section-icon">$</span><div><h3>Tarifa de llegada por rondas</h3><p>Ingresa una sola tarifa base; no es necesario configurar cada ronda.</p></div></div><div className="economic-rate-layout">
          <div className="economic-rate-source"><span>Valor base obligatorio</span><strong>{money(draftFee)} <small>por ronda</small></strong><p>Se toma del campo de comisión del tarifario vigente. Para cambiarlo debes publicar una nueva versión en <b>Tarifas</b>.</p></div>
          {input('costaGoPercent','Participación Costa-Go','Porcentaje calculado sobre la tarifa de llegada resultante.',{prefix:'%',min:.01,max:100,step:'.01'})}
          <div className="economic-round-preview"><span>Vista previa automática</span><div>{displayedRounds.map((round,index)=><article key={round} className={index===displayedRounds.length-1&&totalRounds>6?'last-round':''}><small>Ronda {round}</small><strong>{money(draftFee*round)}</strong><em>Costa-Go {money(draftFee*round*draftShare/100)}</em></article>)}</div>{totalRounds>6&&<small>Se muestran las primeras rondas y la ronda máxima configurada.</small>}</div>
        </div></section>
        <div className="economic-config-grid">
          <section className="economic-config-card"><div className="economic-section-heading"><span className="economic-section-icon">◷</span><div><h3>Parámetros operativos</h3><p>Controlan la continuidad de una misma búsqueda.</p></div></div><div className="economic-fields">{input('searchSessionMinutes','Ventana de la búsqueda','Tiempo durante el cual se reconoce el mismo trayecto.',{min:1,max:1440})}{input('sameRouteToleranceMeters','Tolerancia del trayecto','Distancia permitida para considerar que es la misma ruta.',{min:1,max:1000})}</div></section>
          <section className="economic-config-card"><div className="economic-section-heading"><span className="economic-section-icon">＄</span><div><h3>Cargos y saldos</h3><p>Configura los límites visibles para las recargas.</p></div></div><div className="economic-fields three">{input('lowBalanceThreshold','Aviso de saldo bajo','Se notificará al conductor bajo este valor.',{prefix:'$',min:0,step:'.01'})}{input('minimumTopUp','Recarga mínima','Valor mínimo de recarga, antes de IVA.',{prefix:'$',min:.01,step:'.01'})}{input('maximumTopUp','Recarga máxima','Valor máximo de recarga, antes de IVA.',{prefix:'$',min:.01,step:'.01'})}</div></section>
          <section className="economic-config-card"><div className="economic-section-heading"><span className="economic-section-icon">▥</span><div><h3>Validación y seguridad</h3><p>Define cuándo los datos reales tienen suficiente respaldo.</p></div></div><div className="economic-fields">{input('minimumSamples','Muestra mínima','Viajes requeridos para empezar a usar datos reales.',{min:1})}{input('fullConfidenceSamples','Confianza completa','Viajes requeridos para usar totalmente los datos reales.',{min:1})}</div></section>
          <section className="economic-config-card"><div className="economic-section-heading"><span className="economic-section-icon">▣</span><div><h3>Historial y análisis</h3><p>Controla la ventana usada en cálculos y recomendaciones.</p></div></div><div className="economic-fields">{input('historicalWindowDays','Ventana histórica','Cantidad de días incluidos en el análisis.',{min:1,max:730})}{input('recalculateMinutes','Frecuencia de recálculo','Minutos entre cálculos técnicos de paquetes.',{min:1,max:10080})}</div><p className="economic-reference">Referencia inicial protegida: <strong>{(data.settings.configuration?.referenceDistribution??[{round:1,count:1}]).map((item:any)=>`R${item.round}: ${item.count}`).join(' · ')}</strong><small>Se usa únicamente mientras no exista una muestra real suficiente y ya no requiere editar JSON.</small></p></section>
        </div>
        <aside className="economic-notice"><b>ⓘ</b><span><strong>Información importante</strong><small>Los cambios crean una nueva versión económica para operaciones futuras. Los históricos permanecen congelados.</small></span></aside>
        {configurationError&&<div className="alert error">{configurationError}</div>}
        <footer className="economic-modal-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>setConfigurationDraft(null)}>Cancelar</button><button type="submit" className="primary" disabled={busy}>{busy?'Guardando…':'Guardar configuración'}</button></footer>
      </form>
    </div>}
    {dialog.modal}
  </section>;
}
