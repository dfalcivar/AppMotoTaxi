import { useCallback, useRef, useState } from "react";
import "./panel-dialog.css";
import { CollectionPointMap } from "./service-area-map.js";

export type PanelDialogValue = string | number | boolean | { latitude:number; longitude:number };
export type PanelDialogField = {
  name: string;
  label: string;
  type?: "text" | "number" | "textarea" | "select" | "checkbox" | "map-point";
  initialValue?: PanelDialogValue;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string; label: string }>;
  help?: string;
};
export type PanelDialogConfig = {
  eyebrow?: string;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  dangerous?: boolean;
  fields?: PanelDialogField[];
};

export function usePanelDialog() {
  const [config,setConfig]=useState<PanelDialogConfig|null>(null);
  const [values,setValues]=useState<Record<string,PanelDialogValue>>({});
  const [error,setError]=useState("");
  const resolver=useRef<((result:Record<string,PanelDialogValue>|null)=>void)|null>(null);

  const close=useCallback((result:Record<string,PanelDialogValue>|null)=>{
    const resolve=resolver.current;resolver.current=null;setConfig(null);setError("");resolve?.(result);
  },[]);
  const open=useCallback((next:PanelDialogConfig)=>new Promise<Record<string,PanelDialogValue>|null>(resolve=>{
    resolver.current?.(null);resolver.current=resolve;
    setValues(Object.fromEntries((next.fields??[]).map(field=>[field.name,field.initialValue??(field.type==="checkbox"?false:"")])));
    setError("");setConfig(next);
  }),[]);

  function submit(event:React.FormEvent){
    event.preventDefault();
    for(const field of config?.fields??[]){
      const value=values[field.name];
      const text=typeof value==="object"?JSON.stringify(value):String(value??"").trim();
      if(field.required&&(field.type==="checkbox"?!value:!text)){setError(`Completa «${field.label}».`);return;}
      if(field.minLength&&text.length<field.minLength){setError(`«${field.label}» debe tener al menos ${field.minLength} caracteres.`);return;}
      if(field.type==="number"){
        const number=Number(value);
        if(!Number.isFinite(number)){setError(`«${field.label}» debe ser un número válido.`);return;}
        if(field.min!==undefined&&number<field.min){setError(`«${field.label}» debe ser al menos ${field.min}.`);return;}
        if(field.max!==undefined&&number>field.max){setError(`«${field.label}» no puede superar ${field.max}.`);return;}
      }
    }
    close(values);
  }

  const modal=config?<div className="panel-dialog-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)close(null);}}>
    <form className="panel-dialog-card" role="dialog" aria-modal="true" aria-labelledby="panel-dialog-title" onSubmit={submit}>
      <div className="panel-dialog-heading"><div><span className="eyebrow">{config.eyebrow??"GESTIÓN SEGURA"}</span><h2 id="panel-dialog-title">{config.title}</h2></div><button type="button" className="modal-close-button" aria-label="Cerrar" onClick={()=>close(null)}>×</button></div>
      {config.description&&<p className="panel-dialog-description">{config.description}</p>}
      <div className="panel-dialog-fields">{(config.fields??[]).map((field,index)=>field.type==="map-point"?(()=>{const point=values[field.name] as {latitude:number;longitude:number};return <div key={field.name} className="panel-dialog-map-field"><strong>{field.label}</strong><CollectionPointMap latitude={point.latitude} longitude={point.longitude} onChange={next=>setValues({...values,[field.name]:next})}/></div>;})():field.type==="checkbox"?
        <label className="panel-dialog-checkbox" key={field.name}><input type="checkbox" checked={Boolean(values[field.name])} onChange={event=>setValues({...values,[field.name]:event.target.checked})}/><span>{field.label}{field.help&&<small>{field.help}</small>}</span></label>:
        <label key={field.name}>{field.label}{field.type==="textarea"?<textarea autoFocus={index===0} rows={4} required={field.required} minLength={field.minLength} placeholder={field.placeholder} value={String(values[field.name]??"")} onChange={event=>setValues({...values,[field.name]:event.target.value})}/>:field.type==="select"?<select autoFocus={index===0} required={field.required} value={String(values[field.name]??"")} onChange={event=>setValues({...values,[field.name]:event.target.value})}>{field.options?.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>:<input autoFocus={index===0} type={field.type==="number"?"number":"text"} required={field.required} minLength={field.minLength} min={field.min} max={field.max} step={field.step} placeholder={field.placeholder} value={String(values[field.name]??"")} onChange={event=>setValues({...values,[field.name]:field.type==="number"?Number(event.target.value):event.target.value})}/>} {field.help&&<small>{field.help}</small>}</label>)}</div>
      {error&&<div className="alert error">{error}</div>}
      <div className="panel-dialog-actions"><button type="button" className="secondary" onClick={()=>close(null)}>{config.cancelLabel??"Cancelar"}</button><button type="submit" className={config.dangerous?"danger-button":"primary"}>{config.confirmLabel??"Confirmar"}</button></div>
    </form>
  </div>:null;
  return {open,modal};
}
