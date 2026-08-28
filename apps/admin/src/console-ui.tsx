import {Children,createContext,isValidElement,useContext,useEffect,useId,useMemo,useRef,useState,Fragment,type ReactNode,type Dispatch,type SetStateAction} from 'react';
import {csvCell,normalizeSearch,routeQuery} from './console-model';

export const ConsoleContext=createContext({userId:'',module:'',canExport:false});
export function useConsoleState<T>(key:string,initial:T|(()=>T)): [T,Dispatch<SetStateAction<T>>] {
  const {userId,module}=useContext(ConsoleContext);const storageKey=`cg:filters:${userId}:${module}:${key}`;
  const [value,setValue]=useState<T>(()=>{try{const raw=sessionStorage.getItem(storageKey);if(raw&&!['sub','record','status','from','to','q','insight'].some(name=>routeQuery().has(name)))return JSON.parse(raw) as T;}catch{}return typeof initial==='function'?(initial as ()=>T)():initial;});
  useEffect(()=>{try{sessionStorage.setItem(storageKey,JSON.stringify(value));}catch{}},[storageKey,value]);return [value,setValue];
}
export function ConsoleIcon({name,size=20}:{name?:string;size?:number}) {
  const paths:Record<string,string>={home:'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',menu:'M4 6h16M4 12h16M4 18h16',trips:'M3 7h17l-4-4M21 17H4l4 4',users:'M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3M16 3a4 4 0 0 1 0 8M22 21v-3a4 4 0 0 0-3-3M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',alert:'m12 3 10 18H2L12 3Zm0 5v6m0 3v1',bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',settings:'M12 3v3m0 12v3M3 12h3m12 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0',chart:'M4 3v18h18M8 16l4-5 4 2 5-8',money:'M12 2v20m6-15c0-5-12-5-12 0s12 5 12 10-12 5-12 0',map:'m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15',shield:'m12 2 9 4v6c0 6-9 10-9 10S3 18 3 12V6l9-4Zm-4 10 3 3 5-6',document:'M5 2h10l5 5v15H5V2Zm10 0v6h5M8 12h9m-9 4h9',refresh:'M21 7v5h-5M3 17v-5h5M20 11a8 8 0 0 0-14-6M4 13a8 8 0 0 0 14 6',support:'M3 14v-3a9 9 0 0 1 18 0v7a3 3 0 0 1-3 3h-5M3 11h4v7H3v-7Zm14 0h4v7h-4v-7Z',star:'m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6Z',logout:'M9 3H3v18h6m6-14 5 5-5 5M8 12h12',database:'M3 6c0-5 18-5 18 0s-18 5-18 0Zm0 0v12c0 5 18 5 18 0V6M3 12c0 5 18 5 18 0',arrow:'m9 5 7 7-7 7',back:'m14 5-7 7 7 7M7 12h15',close:'m5 5 14 14M19 5 5 19',check:'m4 12 5 5L20 6'};
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name??'document']??paths.document}/></svg>;
}
export function ConsoleModal({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}) {
  const ref=useRef<HTMLDivElement>(null),id=useId(),closeRef=useRef(onClose);closeRef.current=onClose;
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const root=ref.current;(root?.querySelector<HTMLElement>('input:not([type=checkbox]),textarea')??root?.querySelector<HTMLElement>('button,[tabindex]'))?.focus();const key=(e:KeyboardEvent)=>{if(root?.querySelector('[role="dialog"]'))return;if(e.key==='Escape'){e.preventDefault();closeRef.current();}if(e.key==='Tab'&&root){const items=[...root.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),a[href],select,[tabindex="0"]')].filter(el=>el.offsetParent!==null);const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus();};},[]);
  return <div className="cg-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div className="cg-modal" ref={ref} role="dialog" aria-modal="true" aria-labelledby={id}><div className="cg-modal-title"><h2 id={id}>{title}</h2><button type="button" className="cg-icon-button" aria-label="Cerrar" onClick={onClose}><ConsoleIcon name="close"/></button></div>{children}</div></div>;
}
/** Extract visible data, never input values or hidden credentials, for local sort/search/export. */
export function cellText(node:ReactNode):string {
  if(typeof node==='string'||typeof node==='number')return String(node);
  if(Array.isArray(node))return node.map(cellText).join(' ');
  if(isValidElement<{children?:ReactNode;value?:string; 'aria-hidden'?:boolean}>(node)){
    if(node.props['aria-hidden']||['input','textarea','select'].includes(String(node.type)))return '';
    if(node.props.children!==undefined)return cellText(node.props.children);
    // Existing status badges render their value. Do not inspect arbitrary component props.
    if(typeof node.type==='function'){const formatter=(node.type as unknown as {toTableText?:(props:any)=>string}).toTableText;if(formatter)return formatter(node.props);}
  }return '';
}
export function compareCells(a:string,b:string):number {
  const parse=(text:string):number|null=>{
    const date=text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:,? (\d{2}):(\d{2}))?/);
    if(date)return Date.UTC(Number(date[3]),Number(date[2])-1,Number(date[1]),Number(date[4]??0),Number(date[5]??0));
    const value=text.replace(/[\s$%]/g,'');
    if(/^-?\d+(?:\.\d{3})*(?:,\d+)?$/.test(value))return Number(value.replaceAll('.','').replace(',','.'));
    return null;
  };
  const left=parse(a),right=parse(b);
  return left!==null&&right!==null?left-right:a.localeCompare(b,'es',{numeric:true});
}
export function MetricStrip({items}:{items:{label:string;value:ReactNode;tone?:string;onClick?:()=>void;hint?:string}[]}) {
  return <div className="cg-metrics">{items.map(item=><button type="button" key={item.label} className={`cg-metric ${item.tone??''}`} onClick={item.onClick} disabled={!item.onClick}><span className="cg-metric-icon"><ConsoleIcon name={item.tone==='danger'?'alert':item.tone==='positive'?'check':'chart'}/></span><span><small>{item.label}</small><strong>{item.value}</strong><em>{item.hint??(item.onClick?'Consultar registros →':'Datos registrados')}</em></span></button>)}</div>;
}
export function LoadingState({label="Cargando información…"}:{label?:string}={}){return <div className="cg-loading" role="status" aria-live="polite"><span/><span/><span/><p>{label}</p></div>;}
export function ErrorState({message,onRetry}:{message:string;onRetry:()=>void}){return <div className="cg-error" role="alert"><ConsoleIcon name="alert"/><div><strong>No se pudo actualizar la información</strong><p>{message}</p></div><button className="secondary" onClick={onRetry}>Reintentar</button></div>;}
function CompactActions({children}:{children:ReactNode}) {
  const count=(node:ReactNode):number=>Children.toArray(node).reduce<number>((total,child)=>total+(isValidElement<{children?:ReactNode}>(child)?(child.type==='button'||child.type==='a'?1:count(child.props.children)):0),0);
  if(count(children)<3)return <>{children}</>;
  return <details className="cg-row-actions"><summary title="Ver acciones disponibles">Acciones ⋯</summary><div>{children}</div></details>;
}
export function DataTable({headers,rows,label='Listado',initialSearch='',serverPaged=false}:{headers:string[];rows:ReactNode[][];label?:string;initialSearch?:string;serverPaged?:boolean}) {
  const context=useContext(ConsoleContext),id=useId();
  const key=`table:${headers.join('|')}`;
  const [query,setQuery]=useConsoleState(key+':q',initialSearch||routeQuery().get('q')||'');
  const [pageSize,setPageSize]=useConsoleState(key+':size',15),[page,setPage]=useState(1),[sort,setSort]=useConsoleState<{column:number;direction:number}|null>(key+':sort',null),[hidden,setHidden]=useConsoleState<number[]>(key+':hidden',[]);
  const actionColumn=(index:number)=>/acción|acciones|detalle|documentos|gestión|seguridad/i.test(headers[index]??'');
  const processed=useMemo(()=>{
    const text=normalizeSearch(query);const values=rows.map((row,index)=>({row,index,texts:row.map(cellText)})).filter(item=>!text||normalizeSearch(item.texts.filter((_,i)=>!actionColumn(i)).join(' ')).includes(text));
    if(sort)values.sort((a,b)=>compareCells(a.texts[sort.column]??'',b.texts[sort.column]??'')*sort.direction||a.index-b.index);return values;
  },[rows,query,sort]);
  useEffect(()=>setPage(1),[query,pageSize]);
  const pages=Math.max(1,Math.ceil(processed.length/pageSize)),current=Math.min(page,pages),visible=serverPaged?processed:processed.slice((current-1)*pageSize,current*pageSize);
  function exportCsv(){const included=headers.map((_,i)=>i).filter(i=>!hidden.includes(i)&&!actionColumn(i));const content=[included.map(i=>csvCell(headers[i]??'')).join(';'),...processed.map(item=>included.map(i=>csvCell(item.texts[i]??'')).join(';'))].join('\r\n');const url=URL.createObjectURL(new Blob(['\uFEFF'+content],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=`costa-go-${context.module}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return <section className="cg-data-table" aria-label={label}><div className="cg-table-tools"><label className="cg-table-search" htmlFor={id}><ConsoleIcon name="search" size={17}/><input id={id} aria-label={serverPaged?"Buscar en esta página":"Buscar en el listado"} value={query} onChange={e=>setQuery(e.target.value)} placeholder={serverPaged?'Buscar en esta página…':'Buscar en el listado…'}/></label><span className="cg-count">{processed.length} resultados{serverPaged?' en esta página':''}</span><details className="cg-columns"><summary>Columnas</summary><div>{headers.map((header,i)=><label key={header+i}><input type="checkbox" checked={!hidden.includes(i)} disabled={!hidden.includes(i)&&hidden.length===headers.length-1} onChange={()=>setHidden(hidden.includes(i)?hidden.filter(n=>n!==i):[...hidden,i])}/>{header}</label>)}</div></details>{context.canExport&&<button className="secondary" onClick={exportCsv}>Exportar{serverPaged?' página':''}</button>}{query&&<button className="link" onClick={()=>setQuery('')}>Limpiar</button>}</div><div className="table-wrap cg-table-scroll"><table style={{minWidth:Math.max(600,(headers.length-hidden.length)*120)}}><thead><tr>{headers.map((header,i)=>!hidden.includes(i)&&<th key={header+i} aria-sort={sort?.column===i?(sort.direction===1?'ascending':'descending'):'none'}>{actionColumn(i)?header:<button onClick={()=>setSort({column:i,direction:sort?.column===i?-sort.direction:1})}>{header} <span aria-hidden="true">{sort?.column===i?(sort.direction===1?'↑':'↓'):'↕'}</span></button>}</th>)}</tr></thead><tbody>{visible.map(item=><tr key={item.index}>{item.row.map((cell,j)=>!hidden.includes(j)&&<td key={j} data-label={headers[j]}>{actionColumn(j)?<CompactActions>{cell}</CompactActions>:cell}</td>)}</tr>)}</tbody></table>{!processed.length&&<div className="empty"><ConsoleIcon name="search"/><strong>{rows.length?'No hay coincidencias':'Todavía no hay registros'}</strong><p>{rows.length?'Prueba otro texto o limpia los filtros.':'La información aparecerá aquí cuando esté disponible.'}</p></div>}</div>{!serverPaged&&<footer className="cg-pagination"><label>Por página <select value={pageSize} onChange={e=>setPageSize(Number(e.target.value))}>{[10,15,25,50].map(n=><option key={n}>{n}</option>)}</select></label><span>{processed.length?`${(current-1)*pageSize+1}–${Math.min(current*pageSize,processed.length)}`:'0'} de {processed.length}</span><button aria-label="Página anterior" disabled={current<=1} onClick={()=>setPage(current-1)}>‹</button><span>Página {current} de {pages}</span><button aria-label="Página siguiente" disabled={current>=pages} onClick={()=>setPage(current+1)}>›</button></footer>}</section>;
}
/** Allows legacy JSX tables to adopt the common controls without rewriting their actions. */
export function ManagedTable({children,serverPaged=false,...props}:React.TableHTMLAttributes<HTMLTableElement>&{serverPaged?:boolean}) {
  const parts=Children.toArray(children);const head=parts.find(p=>isValidElement(p)&&p.type==='thead');const body=parts.find(p=>isValidElement(p)&&p.type==='tbody');
  const kids=(node:ReactNode):ReactNode[]=>isValidElement<{children?:ReactNode}>(node)?Children.toArray(node.props.children).flatMap(child=>isValidElement(child)&&child.type===Fragment?kids(child):[child]):[];
  const headers=kids(kids(head)[0]).map(cellText);const rows=kids(body).filter(isValidElement).map(row=>kids(row).map(cell=>isValidElement<{children?:ReactNode}>(cell)?cell.props.children:cell));
  if(!headers.length||rows.some(row=>row.length!==headers.length))return <table {...props}>{children}</table>;
  return <DataTable headers={headers} rows={rows} serverPaged={serverPaged}/>;
}
