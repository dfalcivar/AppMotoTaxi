import {useEffect,useState} from 'react';
import {apiUrl} from './api';

export const resourceGroups=[
  {kind:'THUMBNAIL',title:'Imagen para Home',help:'En la app ocupa 76 × 80 px junto al título y se recorta para llenar el espacio. Prepara una imagen casi cuadrada, por ejemplo 456 × 480 px, con el motivo centrado y margen alrededor. Evita texto pequeño: título y botón se muestran aparte.'},
  {kind:'MAIN',title:'Imagen principal',help:'Al abrir el detalle ocupa el ancho disponible en un área de 220 px de alto. La app ajusta la imagen completa sin recortarla. Recomendado: 1280 × 720 px; deja los elementos importantes centrados y no dibujes botones.'},
  {kind:'HEADER',title:'Decoración de isla superior',help:'La isla mide aproximadamente 328 × 58 px en un móvil típico; su ancho cambia según el teléfono. Para Bordes o Superposición completa, prepara un PNG/WebP transparente de referencia de 1200 × 210 px, sin márgenes vacíos arriba o abajo y con el centro, avatar y saludo despejados. Para Acento de avatar se muestra solo en 25 × 19 px; usa un detalle simple.'},
  {kind:'DECORATION',title:'Decoración adicional',help:'Recurso secundario opcional; no reemplaza la miniatura. Si habilitas su uso en la isla, se adapta al modo elegido: sigue la recomendación de Decoración de isla superior (marco ancho o pequeño acento de avatar).'},
];
export type VisualCampaign={id?:string;version?:number;assets?:string[];headerDecorationMode?:string;decorateHeader?:boolean;useDecorativeAssetForHeader?:boolean;allowLightAssetsInDark?:boolean};
function Preview({token,campaign,kind,file}:{token:string;campaign:VisualCampaign;kind:string;file?:File}){
  const [url,setUrl]=useState('');
  useEffect(()=>{const abort=new AbortController();let local='';setUrl('');
    if(file){local=URL.createObjectURL(file);setUrl(local);}
    else if(campaign.id&&campaign.assets?.includes(kind)){
      fetch(apiUrl(`/v1/admin/costa-go-campaigns/${campaign.id}/assets/${kind}?v=${campaign.version}`),{headers:{authorization:`Bearer ${token}`},signal:abort.signal})
        .then(r=>{if(!r.ok)throw Error();return r.blob();}).then(blob=>{if(!abort.signal.aborted){local=URL.createObjectURL(blob);setUrl(local);}}).catch(()=>{});
    }
    return()=>{abort.abort();if(local)URL.revokeObjectURL(local);};
  },[token,campaign.id,campaign.version,kind,file,campaign.assets?.join(',')]);
  return url?<img src={url} alt={`Vista previa ${kind}`}/>:null;
}
export function CampaignResources({campaign,token,disabled,onUpload,onRemove,files={},storageReady=true}:{
 campaign:VisualCampaign;token:string;disabled:boolean;onUpload:(kind:string,file:File)=>void;onRemove?:(kind:string)=>void;files?:Record<string,File>;storageReady?:boolean;
}){
 const [dark,setDark]=useState(false);
 const [previewRole,setPreviewRole]=useState('DRIVER');
 const available=(kind:string)=>!!files[kind]||campaign.assets?.includes(kind);
 const choose=(surface:string)=>{
   const light=surface+'_LIGHT',night=surface==='MAIN'?'DARK':surface+'_DARK';
   return (dark?[night,surface,...(campaign.allowLightAssetsInDark?[light]:[])]:[light,surface]).find(available);
 };
 const header=choose('HEADER')||(campaign.useDecorativeAssetForHeader?choose('DECORATION'):undefined);
 return <section className="campaign-section"><h3>Recursos visuales</h3>
 <p>Todos son opcionales. General sirve para ambos temas; Claro y Oscuro son alternativas. JPG, PNG o WebP estáticos, hasta 2 MB y 4096 px. Los cambios requieren aprobación y activación.</p>
 {!storageReady&&<p role="status" className="campaign-note">Falta configurar el almacenamiento de objetos en Render. Las imágenes existentes siguen disponibles; las nuevas cargas se habilitarán al configurarlo.</p>}
 <div className="campaign-resource-groups">{resourceGroups.map(group=><article key={group.kind}>
 <h4>{group.title}</h4><p>{group.help}</p><div className="campaign-resource-variants">
 {[[group.kind,'General (ambos temas)'],[group.kind+'_LIGHT','Claro opcional'],[group.kind==='MAIN'?'DARK':group.kind+'_DARK','Oscuro opcional']].map(([kind,label])=><div key={kind}>
 <strong>{label}</strong><div className="campaign-resource-preview"><Preview campaign={campaign} token={token} kind={kind!} file={files[kind!]}/></div>
 <small>{files[kind!]?`Pendiente: ${files[kind!]!.name}`:available(kind!)?'Recurso cargado':'Sin recurso'}</small>
 {!disabled&&<><label>Seleccionar o reemplazar<input type="file" disabled={!storageReady} aria-label={`${group.title} · ${label}`} accept={group.kind==='HEADER'?'image/png,image/webp':'image/png,image/jpeg,image/webp'} onChange={e=>{const file=e.target.files?.[0];if(file)onUpload(kind!,file);e.target.value='';}}/></label>
 {available(kind!)&&onRemove&&<button type="button" className="secondary" onClick={()=>onRemove(kind!)}>Eliminar recurso</button>}</>}
 </div>)}
 </div></article>)}</div>
 <h4>Vista previa de la isla en la app</h4>
 <div className="campaign-island-controls"><label>Vista de usuario<select value={previewRole} onChange={e=>setPreviewRole(e.target.value)}><option value="DRIVER">Conductor</option><option value="PASSENGER">Pasajero</option></select></label><label className="check"><input type="checkbox" checked={dark} onChange={e=>setDark(e.target.checked)}/>Previsualizar tema oscuro</label></div>
 <div className={`campaign-island-stage ${dark?'is-dark':''}`}>

 <div className="campaign-island-preview">
 {campaign.decorateHeader&&campaign.headerDecorationMode!=='NONE'&&header&&<div className={`campaign-island-art mode-${campaign.headerDecorationMode??'AVATAR_ACCENT'}`}><Preview campaign={campaign} token={token} kind={header} file={files[header]}/></div>}
 <div className="campaign-island-content"><span className="campaign-island-avatar" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="3"/><path d="M5 20v-2a7 5 0 0 1 14 0v2Z"/></svg></span><div className="campaign-island-greeting"><strong>¡Hola, {previewRole==='DRIVER'?'Conductor':'Pasajero'}!{previewRole==='DRIVER'?' 👋':''}</strong>{!(previewRole==='DRIVER'&&campaign.decorateHeader&&campaign.headerDecorationMode!=='NONE'&&header)&&<small>{previewRole==='DRIVER'?'Listo para recibir viajes':'¿A dónde vamos hoy?'}</small>}</div></div>
 </div>
 </div><p><small>Solo la isla, con avatar circular y proporciones del encabezado móvil. El saludo es de ejemplo; en la app se muestra el nombre real. Bordes desvanece la decoración hacia el centro. La anchura final depende de la pantalla del dispositivo; esta vista no incluye los recursos locales de respaldo.</small></p>
 </section>;
}
