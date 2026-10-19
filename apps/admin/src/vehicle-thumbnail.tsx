import {useEffect,useRef,useState} from 'react';
import {apiUrl} from './api.js';
import {MototaxiIcon} from './mototaxi-icon.js';
import {queueThumbnail} from './thumbnail-queue.js';

// The authorized endpoint resolves display -> original, including historical photo IDs.
export function VehicleThumbnail({id,token}:{id?:string|null;token:string}){
  const elementRef=useRef<HTMLSpanElement>(null);
  const [image,setImage]=useState<{id:string;url:string}|null>(null);
  const [loading,setLoading]=useState(Boolean(id));
  useEffect(()=>{
    let object='';let abort:AbortController|null=null;let cancelQueued:(()=>void)|null=null;
    const element=elementRef.current;
    setImage(null);setLoading(Boolean(id));
    const observer=id&&element?new IntersectionObserver(entries=>{
      for(const entry of entries){
        if(entry.isIntersecting&&!abort){
          abort=new AbortController();const current=abort;
          cancelQueued=queueThumbnail(async()=>{
            try{
              const response=await fetch(apiUrl(`/v1/admin/fleet/files/${id}`),{signal:current.signal,headers:{authorization:`Bearer ${token}`}});
              if(!response.ok)throw Error('photo');
              const blob=await response.blob();
              if(current.signal.aborted)return;
              object=URL.createObjectURL(blob);setImage({id,url:object});
            }catch{if(!current.signal.aborted)setLoading(false);}
            finally{if(!current.signal.aborted)setLoading(false);}
          },Math.abs(entry.boundingClientRect.top));
        }else if(!entry.isIntersecting&&abort&&!object){
          cancelQueued?.();abort.abort();abort=null;cancelQueued=null;
        }
      }
    }):null;
    if(observer&&element)observer.observe(element);
    return()=>{observer?.disconnect();cancelQueued?.();abort?.abort();if(object)URL.revokeObjectURL(object);};
  },[id,token]);
  return <span className="fleet-photo" ref={elementRef} aria-busy={loading}>
    {image?.id===id&&image?<img src={image.url} alt="Fotografía real de la mototaxi" onError={()=>setImage(null)}/>:
      loading?<span className="fleet-photo-loading" role="status" aria-label="Cargando fotografía"/>:
      <span className="fleet-placeholder" role="img" aria-label="Mototaxi sin fotografía disponible"><MototaxiIcon size={36}/></span>}
  </span>;
}
