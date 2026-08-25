import { useEffect, useRef, useState } from "react";

export type Point = [number, number];
export type ServiceAreaGeometry = { type: "Polygon"; coordinates: Point[][] } | { type: "MultiPolygon"; coordinates: Point[][][] };
type ZoneLayer = { id: string; code: string; geometry: ServiceAreaGeometry; enabled: boolean };

declare global { interface Window { google?: any; __costaGoMapsPromise?: Promise<any>; } }

function loadGoogleMaps() {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (window.__costaGoMapsPromise) return window.__costaGoMapsPromise;
  const key = import.meta.env.VITE_GOOGLE_MAPS_WEB_API_KEY as string | undefined;
  if (!key) return Promise.reject(new Error("Falta configurar VITE_GOOGLE_MAPS_WEB_API_KEY en el panel."));
  window.__costaGoMapsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const mapId = import.meta.env.VITE_GOOGLE_MAPS_WEB_MAP_ID as string | undefined;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly${mapId ? `&map_ids=${encodeURIComponent(mapId)}` : ""}`;
    script.async = true; script.defer = true;
    script.onload = () => resolve(window.google.maps);
    script.onerror = () => reject(new Error("No fue posible cargar Google Maps."));
    document.head.appendChild(script);
  });
  return window.__costaGoMapsPromise;
}

export function parseGoogleMapsCoordinates(value:string) {
  let text=value.trim();
  try{text=decodeURIComponent(text);}catch{/* Conserva el texto original si no es una URL codificada válida. */}
  const patterns=[
    /@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
    /(?:[?&](?:query|q|ll|destination|origin)=)(-?\d{1,2}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)/i,
    /(-?\d{1,2}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)/
  ];
  for(const pattern of patterns){
    const match=pattern.exec(text);if(!match)continue;
    const latitude=Number(match[1]);const longitude=Number(match[2]);
    if(Number.isFinite(latitude)&&Number.isFinite(longitude)&&latitude>=-90&&latitude<=90&&longitude>=-180&&longitude<=180)return {latitude,longitude};
  }
  return null;
}

export function CollectionPointMap({latitude,longitude,address="",onChange,onAddressChange}:{latitude:number;longitude:number;address?:string;onChange(value:{latitude:number;longitude:number}):void;onAddressChange?(value:string):void}) {
  const host=useRef<HTMLDivElement>(null);const map=useRef<any>(null);const marker=useRef<any>(null);
  const [error,setError]=useState("");const [search,setSearch]=useState(address);const [coordinateText,setCoordinateText]=useState("");const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");
  const moveTo=(next:{latitude:number;longitude:number},zoom=17)=>{marker.current?.setPosition({lat:next.latitude,lng:next.longitude});map.current?.panTo({lat:next.latitude,lng:next.longitude});if(map.current&&zoom)map.current.setZoom(zoom);onChange(next);};
  const reverseAddress=async(next:{latitude:number;longitude:number})=>{if(!window.google?.maps)return;const result=await new window.google.maps.Geocoder().geocode({location:{lat:next.latitude,lng:next.longitude}});const formatted=String(result.results?.[0]?.formatted_address??"");if(formatted){setSearch(formatted);onAddressChange?.(formatted);}};
  async function searchPlace(){if(!search.trim()||!window.google?.maps)return;setBusy(true);setMessage("");try{const result=await new window.google.maps.Geocoder().geocode({address:search.trim(),componentRestrictions:{country:"EC"}});const first=result.results?.[0];if(!first)throw new Error("No encontramos ese lugar en Ecuador.");const next={latitude:first.geometry.location.lat(),longitude:first.geometry.location.lng()};moveTo(next);const formatted=String(first.formatted_address??search.trim());setSearch(formatted);onAddressChange?.(formatted);setMessage("Ubicación encontrada. Puedes ajustar el pin si hace falta.");}catch(reason){setMessage(reason instanceof Error?reason.message:"No fue posible buscar el lugar.");}finally{setBusy(false);}}
  async function useCoordinates(){const next=parseGoogleMapsCoordinates(coordinateText);if(!next){setMessage("Pega coordenadas como -0.86820, -79.84710 o un enlace largo de Google Maps que las contenga.");return;}setBusy(true);setMessage("");try{moveTo(next);await reverseAddress(next);setMessage("Coordenadas aplicadas. Verifica el pin antes de guardar.");}catch{setMessage("Coordenadas aplicadas. No fue posible obtener el nombre de la dirección.");}finally{setBusy(false);}}
  async function usePinAddress(){setBusy(true);setMessage("");try{await reverseAddress({latitude,longitude});setMessage("Dirección actualizada desde el pin.");}catch{setMessage("No fue posible obtener la dirección del pin. Puedes escribirla manualmente.");}finally{setBusy(false);}}
  useEffect(()=>{let alive=true;void loadGoogleMaps().then(maps=>{if(!alive||!host.current)return;const position={lat:latitude,lng:longitude};const mapId=import.meta.env.VITE_GOOGLE_MAPS_WEB_MAP_ID as string|undefined;map.current=new maps.Map(host.current,{center:position,zoom:15,mapId:mapId||undefined,streetViewControl:false,mapTypeControl:false,fullscreenControl:true});marker.current=new maps.Marker({map:map.current,position,draggable:true,title:"Punto de recaudación"});marker.current.addListener("dragend",(event:any)=>onChange({latitude:event.latLng.lat(),longitude:event.latLng.lng()}));map.current.addListener("click",(event:any)=>{const next={latitude:event.latLng.lat(),longitude:event.latLng.lng()};marker.current.setPosition({lat:next.latitude,lng:next.longitude});onChange(next);});}).catch(reason=>setError(reason instanceof Error?reason.message:String(reason)));return()=>{alive=false;};},[]);
  useEffect(()=>{marker.current?.setPosition({lat:latitude,lng:longitude});},[latitude,longitude]);
  useEffect(()=>{setSearch(address);},[address]);
  return <div className="collection-point-location-editor">
    <div className="collection-point-location-tools"><label><span>Buscar dirección o negocio</span><div><input value={search} onChange={event=>setSearch(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();void searchPlace();}}} placeholder="Ej. Cooperativa Zambrano, Atacames"/><button type="button" className="secondary" disabled={busy||!search.trim()} onClick={()=>void searchPlace()}>Buscar</button></div></label><label><span>Coordenadas o enlace de Google Maps</span><div><input value={coordinateText} onChange={event=>setCoordinateText(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();void useCoordinates();}}} placeholder="-0.86820, -79.84710"/><button type="button" className="secondary" disabled={busy||!coordinateText.trim()} onClick={()=>void useCoordinates()}>Ubicar</button></div></label></div>
    {message&&<small className="collection-point-location-message">{message}</small>}
    {error?<div className="map-configuration-error">{error}</div>:<div ref={host} className="service-area-google-map" style={{height:280}}/>}
    <div className="collection-point-coordinate-summary"><small><strong>Pin actual:</strong> {latitude.toFixed(6)}, {longitude.toFixed(6)}</small><button type="button" className="link" disabled={busy||Boolean(error)} onClick={()=>void usePinAddress()}>Usar dirección del pin</button></div>
    <small>Busca el lugar o pega coordenadas; después ajusta con un clic o arrastrando el marcador.</small>
  </div>;
}

function polygonsOf(geometry?: ServiceAreaGeometry | null): Point[][][] {
  if (!geometry) return [];
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

function closeRing(points: Point[]): Point[] {
  if (!points.length) return [];
  const first = points[0]!; const last = points.at(-1)!;
  return first[0] === last[0] && first[1] === last[1] ? points : [...points, [...first] as Point];
}

function geometryFromPolygons(polygons: Point[][][]): ServiceAreaGeometry | null {
  const normalized = polygons.map(polygon => polygon.map(closeRing)).filter(polygon => (polygon[0]?.length ?? 0) >= 4);
  if (!normalized.length) return null;
  return normalized.length === 1 ? { type: "Polygon", coordinates: normalized[0]! } : { type: "MultiPolygon", coordinates: normalized };
}

function googlePaths(geometry: ServiceAreaGeometry) {
  return polygonsOf(geometry).map(polygon => polygon.map(ring => ring.slice(0, -1).map(([lng, lat]) => ({ lat, lng }))));
}

export function ServiceAreaMap({ geometry, zones, editable, drawing, onDrawingChange, onGeometryChange, selectedId }:{
  geometry?: ServiceAreaGeometry | null; zones: ZoneLayer[]; editable: boolean; drawing: boolean;
  onDrawingChange(value:boolean):void; onGeometryChange(value:ServiceAreaGeometry|null):void; selectedId?:string;
}) {
  const host = useRef<HTMLDivElement>(null); const map = useRef<any>(null); const overlays = useRef<any[]>([]);
  const listenerHandles = useRef<any[]>([]); const draft = useRef<Point[]>([]); const draftLine = useRef<any>(null);
  const syncTimer = useRef<number | null>(null); const skipNextFit = useRef(false);
  const [error,setError]=useState(""); const [ready,setReady]=useState(false);

  useEffect(() => { let alive=true; void loadGoogleMaps().then(maps => {
    if(!alive||!host.current)return;
    const mapId=import.meta.env.VITE_GOOGLE_MAPS_WEB_MAP_ID as string|undefined;
    map.current=new maps.Map(host.current,{center:{lat:-1.1,lng:-79.4},zoom:7,mapId:mapId||undefined,
      streetViewControl:false,mapTypeControl:false,fullscreenControl:true,gestureHandling:"greedy"});
    setReady(true);
  }).catch(reason=>setError(reason instanceof Error?reason.message:String(reason)));return()=>{alive=false;};},[]);

  useEffect(()=>{if(!map.current||!window.google?.maps)return;
    listenerHandles.current.forEach(handle=>handle.remove?.());listenerHandles.current=[];
    overlays.current.forEach(layer=>layer.setMap(null));overlays.current=[];
    const maps=window.google.maps;
    for(const zone of zones){if(zone.id===selectedId)continue;for(const paths of googlePaths(zone.geometry)){
      const polygon=new maps.Polygon({map:map.current,paths,strokeColor:zone.enabled?"#427b85":"#87989c",strokeOpacity:.75,strokeWeight:1.5,fillColor:zone.enabled?"#5ba9b4":"#aebabc",fillOpacity:.12,clickable:false});overlays.current.push(polygon);
    }}
    if(geometry){for(const paths of googlePaths(geometry)){
      const polygon=new maps.Polygon({map:map.current,paths,editable,draggable:false,strokeColor:"#087f8c",strokeWeight:3,fillColor:"#1aa2ae",fillOpacity:.22});overlays.current.push(polygon);
      if(editable){const sync=()=>{if(syncTimer.current)window.clearTimeout(syncTimer.current);syncTimer.current=window.setTimeout(()=>{const polygons=overlays.current.filter(layer=>layer.getPaths&&layer.getEditable?.()).map(layer=>{
        const rings:Point[][]=[];layer.getPaths().forEach((path:any)=>{const points:Point[]=[];path.forEach((p:any)=>points.push([p.lng(),p.lat()]));rings.push(closeRing(points));});return rings;});
        skipNextFit.current=true;onGeometryChange(geometryFromPolygons(polygons));},300);};
        polygon.getPaths().forEach((path:any)=>{for(const event of ["set_at","insert_at","remove_at"])listenerHandles.current.push(maps.event.addListener(path,event,sync));});
        listenerHandles.current.push(maps.event.addListener(polygon,"rightclick",(event:any)=>{if(event.vertex==null)return;const path=polygon.getPaths().getAt(event.path??0);if(path.getLength()>3)path.removeAt(event.vertex);}));
      }
    }}
    const candidates=geometry?[geometry]:zones.map(zone=>zone.geometry);const bounds=new maps.LatLngBounds();let count=0;
    candidates.flatMap(polygonsOf).flat(2).forEach(([lng,lat])=>{bounds.extend({lat,lng});count++;});if(count&&!skipNextFit.current)map.current.fitBounds(bounds,64);skipNextFit.current=false;
  },[geometry,zones,editable,selectedId,ready]);

  useEffect(()=>{if(!map.current||!window.google?.maps)return;const maps=window.google.maps;
    if(draftLine.current){draftLine.current.setMap(null);draftLine.current=undefined;}draft.current=[];
    if(!drawing)return;
    draftLine.current=new maps.Polyline({map:map.current,path:[],strokeColor:"#e2a820",strokeWeight:3});
    const handle=maps.event.addListener(map.current,"click",(event:any)=>{const point:Point=[event.latLng.lng(),event.latLng.lat()];draft.current.push(point);draftLine.current.setPath(draft.current.map(([lng,lat])=>({lat,lng})));
      if(draft.current.length>=3)onGeometryChange({type:"Polygon",coordinates:[closeRing(draft.current)]});});
    return()=>{handle.remove?.();};
  },[drawing,ready]);

  if(error)return <div className="map-configuration-error"><strong>Google Maps no está configurado</strong><span>{error}</span></div>;
  return <div className="service-area-map-shell"><div ref={host} className="service-area-google-map" />{editable&&<div className="map-editor-tools">
    <button type="button" className={drawing?"primary":"secondary"} onClick={()=>onDrawingChange(!drawing)}>{drawing?"Finalizar dibujo":"Dibujar zona"}</button>
    <button type="button" className="secondary" onClick={()=>{draft.current.pop();if(draft.current.length>=3)onGeometryChange({type:"Polygon",coordinates:[closeRing(draft.current)]});else onGeometryChange(null);}}>Deshacer punto</button>
    <button type="button" className="secondary" onClick={()=>{draft.current=[];onGeometryChange(null);}}>Limpiar</button>
    <span>{drawing?"Haz clic alrededor del territorio. Con 3 puntos se crea el polígono.":"Arrastra los vértices; clic derecho elimina un vértice."}</span>
  </div>}</div>;
}
