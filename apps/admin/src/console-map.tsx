import {useEffect,useRef,useState} from 'react';
import {ConsoleIcon,ErrorState} from './console-ui';
import {navigateConsole} from './console-model';
import {loadGoogleMaps} from './service-area-map';

/** Reuses the existing Maps loader. Loaded only on explicit request, not on each poll. */
export function ConsoleMap({drivers,trips}:{drivers:any[];trips:any[]}) {
  const host=useRef<HTMLDivElement>(null),map=useRef<any>(null),markers=useRef<any[]>([]),fitted=useRef(false);
  const [enabled,setEnabled]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{if(!enabled)return;let active=true;setError('');void loadGoogleMaps().then(maps=>{if(!active||!host.current)return;map.current??=new maps.Map(host.current,{center:{lat:0.868,lng:-79.85},zoom:13,streetViewControl:false,mapTypeControl:false,fullscreenControl:true});setReady(true);}).catch(()=>{if(active)setError('No se pudo cargar el mapa. Los listados operativos siguen disponibles. Verifica la conexión y la clave web de Maps.');});return()=>{active=false;};},[enabled,retry]);
  useEffect(()=>{if(!ready||!map.current)return;const maps=window.google.maps;markers.current.forEach(marker=>marker.setMap(null));const bounds=new maps.LatLngBounds();let count=0;
    const points=[...drivers.map(d=>({lat:Number(d.latitude),lng:Number(d.longitude),title:d.name,color:d.busy?'#e58c20':d.available?'#0c9a74':'#718096',id:d.id,module:'drivers'})),...trips.filter(t=>t.originLatitude!=null&&t.originLongitude!=null).map(t=>({lat:Number(t.originLatitude),lng:Number(t.originLongitude),title:t.passenger+' · '+(t.origin??'Solicitud'),color:'#0968de',id:t.id,module:'trips'}))];
    markers.current=points.filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180).map(p=>{const position={lat:p.lat,lng:p.lng};bounds.extend(position);count++;const marker=new maps.Marker({map:map.current,position,title:p.title,icon:{path:maps.SymbolPath.CIRCLE,scale:7,fillColor:p.color,fillOpacity:1,strokeColor:'#ffffff',strokeWeight:2}});marker.addListener('click',()=>navigateConsole(p.module,p.id?{record:p.id}:{q:p.title}));return marker;});
    if(count&&!fitted.current){map.current.fitBounds(bounds);if(count===1)map.current.setZoom(15);fitted.current=true;}
    return()=>markers.current.forEach(marker=>marker.setMap(null));
  },[ready,drivers,trips]);
  return <div className="cg-live-map">{!enabled?<div className="cg-map-placeholder"><ConsoleIcon name="map" size={38}/><strong>Ubicaciones reportadas en tiempo real</strong><p>{drivers.length} posiciones de conductores · {trips.length} solicitudes activas</p><button className="secondary" onClick={()=>setEnabled(true)}>Cargar mapa geográfico</button><small>Se carga bajo demanda para evitar solicitudes innecesarias a Maps.</small></div>:<><div ref={host} style={{height:290,borderRadius:12}} aria-label="Mapa de ubicaciones operativas"/>{error&&<ErrorState message={error} onRetry={()=>setRetry(v=>v+1)}/>}</>}<div className="cg-map-legend"><span>● Disponible</span><span>● Ocupado</span><span>● No disponible</span><span>● Solicitud / viaje</span></div></div>;
}
