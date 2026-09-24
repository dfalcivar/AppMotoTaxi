import {useEffect,useState} from 'react';
import {apiUrl} from './api';

export const resourceGroups=[
  {kind:'THUMBNAIL',title:'Imagen para Home',help:'Miniatura compacta junto al título de la card. Recomendado: 480 × 320 px.'},
  {kind:'MAIN',title:'Imagen principal',help:'Se muestra al abrir el detalle. Recomendado: 1280 × 720 px, sin botones dibujados.'},
  {kind:'HEADER',title:'Decoración de isla superior',help:'Overlay PNG/WebP con transparencia real. Recomendado: 1200 × 240 px. Deja el centro, el avatar y el saludo despejados.'},
  {kind:'DECORATION',title:'Decoración adicional',help:'Recurso secundario opcional, reservado para otras superficies. No sustituye la miniatura ni decora la isla salvo que lo habilites expresamente.'},
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
 <h4>Vista aproximada de la isla</h4><label className="check"><input type="checkbox" checked={dark} onChange={e=>setDark(e.target.checked)}/>Previsualizar tema oscuro</label>
 <div className={`campaign-island-preview ${dark?'is-dark':''}`}>
 {campaign.decorateHeader&&campaign.headerDecorationMode!=='NONE'&&header&&<div className={`campaign-island-art mode-${campaign.headerDecorationMode??'AVATAR_ACCENT'}`}><Preview campaign={campaign} token={token} kind={header} file={files[header]}/></div>}
 <div className="campaign-island-content"><span aria-hidden="true">👤</span><div><strong>Hola, Usuario</strong><small>¿A dónde vamos hoy?</small></div><span aria-hidden="true">♧</span></div>
 </div><p><small>El contenido queda encima del overlay. Bordes protege el centro. Esta vista no incluye los pequeños recursos locales de respaldo.</small></p>
 </section>;
}
