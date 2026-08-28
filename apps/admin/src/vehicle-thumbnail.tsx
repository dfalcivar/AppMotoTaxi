import {useEffect,useState} from 'react';
import {apiUrl} from './api.js';
import {MototaxiIcon} from './mototaxi-icon.js';

// The authorized endpoint resolves display -> original, including historical photo IDs.
export function VehicleThumbnail({id,token}:{id?:string|null;token:string}){
  const [image,setImage]=useState<{id:string;url:string}|null>(null);
  const [loading,setLoading]=useState(Boolean(id));
  useEffect(()=>{
    const abort=new AbortController();let object='';
    setImage(null);setLoading(Boolean(id));
    if(id)void fetch(apiUrl(`/v1/admin/fleet/files/${id}`),{signal:abort.signal,headers:{authorization:`Bearer ${token}`}})
      .then(r=>{if(!r.ok)throw Error('photo');return r.blob();})
      .then(b=>{if(abort.signal.aborted)return;object=URL.createObjectURL(b);setImage({id,url:object});})
      .catch(()=>{}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return()=>{abort.abort();if(object)URL.revokeObjectURL(object);};
  },[id,token]);
  return <span className="fleet-photo" aria-busy={loading}>
    {image?.id===id&&image?<img src={image.url} alt="Fotografía real de la mototaxi" onError={()=>setImage(null)}/>:
      loading?<span className="fleet-photo-loading" role="status" aria-label="Cargando fotografía"/>:
      <span className="fleet-placeholder" role="img" aria-label="Mototaxi sin fotografía disponible"><MototaxiIcon size={36}/></span>}
  </span>;
}
