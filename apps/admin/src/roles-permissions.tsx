import {useEffect,useMemo,useState} from 'react';
import {apiFetch} from './api.js';

type Role={id:string;name:string;description:string;enabled:boolean;permissions:string[];userCount:number;users:{id:string;name:string;email:string}[]};
const moduleNames:Record<string,string>={
  fleet:'Mototaxis y flota',FACTURACION:'Facturación',CLIENTES:'Clientes fiscales',
  dashboard:'Análisis operativo',cooperative:'Cooperativas',passengers:'Pasajeros',
  mobile:'Cuentas móviles',drivers:'Conductores',cooperatives:'Cooperativas',
  trips:'Viajes',support:'Soporte',incidents:'Incidentes',reports:'Reportes',
  pricing:'Tarifas',zones:'Zonas',service:'Áreas de servicio',advertising:'Publicidad institucional',
  commercial:'Comercial y publicidad',settings:'Configuración',users:'Usuarios',roles:'Roles',
  audit:'Auditoría',database:'Estado del sistema',operations:'Operaciones',alerts:'Alertas',
  notifications:'Notificaciones',notification:'Campañas de notificaciones',faq:'Preguntas frecuentes',
  memberships:'Membresías',membership:'Planes y cortesías',payment:'Órdenes de pago',
  payments:'Pagos',collection:'Puntos de cobro',cash:'Cierres de caja',settlements:'Conciliaciones',
  financial:'Cuentas financieras',api:'Uso de API',costa:'Campañas Costa-Go'
};
const actionNames:Record<string,string>={view:'Ver',manage:'Gestionar',approve:'Aprobar',
  create:'Crear',edit:'Editar',activate:'Activar',deactivate:'Pausar y finalizar',reject:'Rechazar',archive:'Archivar',export:'Exportar',
  review:'Revisar',collect:'Cobrar',reverse:'Revertir',test:'Probar',delete_incomplete:'Eliminar incompletos',
  transfer_review:'Revisar transferencias',courtesy_grant:'Otorgar cortesía'};
const protectedPermissions=new Set(['roles:manage','users:manage']);
function groupOf(permission:string){
  if(permission.startsWith('FACTURACION_'))return 'Facturación';
  if(permission.startsWith('CLIENTES_FISCALES_'))return 'Clientes fiscales';
  const prefix=permission.split(':')[0]!.split('_')[0]!;
  return moduleNames[prefix]??prefix.replaceAll('_',' ');
}
function labelOf(permission:string){
  if(permission==='drivers:approve')return 'Aprobar y gestionar decisiones (permiso anterior)';
  if(permission==='commercial:campaigns:review')return 'Revisar decisiones (permiso anterior)';
  if(permission==='FACTURACION_ADMINISTRAR')return 'Gestionar documentos y acciones fiscales';
  if(permission==='FACTURACION_CONSULTAR_ESTADO')return 'Consultar estado en Dátil';
  if(permission==='FACTURACION_REINTENTAR')return 'Reintentar emisión';
  if(permission==='FACTURACION_DESCARGAR')return 'Descargar XML y RIDE';
  if(permission==='FACTURACION_REENVIAR')return 'Reenviar factura por correo';
  if(permission==='FACTURACION_NOTA_CREDITO')return 'Crear nota de crédito';
  if(permission==='FACTURACION_DASHBOARD_VER')return 'Ver resumen financiero';
  if(permission==='FACTURACION_VER')return 'Ver facturas y pagos';
  if(permission==='CLIENTES_FISCALES_VER')return 'Ver clientes fiscales';
  if(permission==='CLIENTES_FISCALES_EDITAR')return 'Editar clientes fiscales';
  const parts=permission.split(':');const action=parts.at(-1)!;
  const sub=parts.length>2?parts.slice(1,-1).join(' ').replaceAll('_',' '):'';
  return `${sub?sub+' · ':''}${actionNames[action]??action.replaceAll('_',' ')}`;
}
function subgroups(items:string[]){const groups=new Map<string,string[]>();for(const permission of items){
  const parts=permission.split(':'),sub=parts.length>2?parts.slice(1,-1).join(' · ').replaceAll('_',' '):'General';
  groups.set(sub,[...(groups.get(sub)??[]),permission]);
}return [...groups];}

export function RolesAndPermissions({token,roles,onChange}:{token:string;roles:Role[];onChange:()=>Promise<void>}){
  const [catalog,setCatalog]=useState<string[]>([]);
  const [selected,setSelected]=useState<Role|null>(null);
  const [editing,setEditing]=useState(false);
  const [name,setName]=useState(''),[description,setDescription]=useState(''),[enabled,setEnabled]=useState(true),
    [permissions,setPermissions]=useState<string[]>([]),[query,setQuery]=useState(''),[expanded,setExpanded]=useState<string[]>([]),
    [busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
  useEffect(()=>{apiFetch<string[]>('/v1/admin/access/permissions',token).then(setCatalog).catch(e=>setError(String(e.message??e)));},[token]);
  const groups=useMemo(()=>{
    const map=new Map<string,string[]>();
    for(const permission of catalog){const group=groupOf(permission);map.set(group,[...(map.get(group)??[]),permission]);}
    return [...map].sort((a,b)=>a[0].localeCompare(b[0],'es'));
  },[catalog]);
  function edit(role:Role|null){setEditing(true);setSelected(role);setName(role?.name??'');setDescription(role?.description??'');
    setEnabled(role?.enabled??true);setPermissions(role?.permissions??[]);setError('');setSuccess('');
    setExpanded([]);}
  function toggle(items:string[]){const allowed=items.filter(p=>!protectedPermissions.has(p));
    const next=new Set(permissions),all=allowed.every(p=>next.has(p));
    for(const permission of allowed)all?next.delete(permission):next.add(permission);
    setPermissions([...next]);}
  async function save(){setBusy(true);setError('');setSuccess('');try{
    const body=JSON.stringify({name:name.trim(),description:description.trim(),enabled,permissions});
    await apiFetch(`/v1/admin/access/custom-roles${selected?'/'+selected.id:''}`,token,
      {method:selected?'PUT':'POST',body});
    await onChange();setEditing(false);setSelected(null);setSuccess('Rol guardado. Los usuarios asignados deberán iniciar sesión nuevamente.');
  }catch(value){setError(value instanceof Error?value.message:String(value));}finally{setBusy(false);}}
  const normalized=query.trim().toLocaleLowerCase('es');
  return <section className="card rbac-panel"><div className="rbac-heading"><div><span className="eyebrow">CONTROL DE ACCESO</span>
    <h2>Roles y permisos</h2><p>Define accesos por acción. Los cambios se aplican al siguiente inicio de sesión.</p></div>
    <button className="primary" type="button" onClick={()=>edit(null)}>+ Crear rol</button></div>
    {success&&<p role="status">{success}</p>}{error&&<p role="alert">{error}</p>}
    <div className="rbac-role-list">{roles.map(role=><article key={role.id} className="rbac-role-card"><div><strong>{role.name}</strong>
      <small>{role.enabled?'Activo':'Desactivado'} · {role.permissions.length} permisos · {role.userCount} usuarios</small>
      <p>{role.description}</p><details><summary>Usuarios asignados</summary>{role.users.length?<ul>{role.users.map(user=><li key={user.id}>{user.name} · {user.email}</li>)}</ul>:<p>Sin usuarios asignados.</p>}</details></div>
      <button className="secondary" type="button" onClick={()=>edit(role)}>Editar</button></article>)}</div>
    {editing?<div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)setEditing(false);}}>
      <section className="modal-card rbac-editor" role="dialog" aria-modal="true" aria-label="Editar rol y permisos">
        <div className="rbac-heading"><h2>{selected?'Editar rol':'Crear rol'}</h2><button className="secondary" type="button" onClick={()=>setEditing(false)}>Cerrar</button></div>
        <div className="rbac-fields"><label>Nombre<input value={name} maxLength={80} onChange={e=>setName(e.target.value)}/></label>
          <label>Descripción<input value={description} maxLength={500} onChange={e=>setDescription(e.target.value)}/></label>
          <label><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/> Rol activo</label></div>
        <label>Buscar módulos o permisos<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar…"/></label>
        <div className="rbac-matrix">{groups.filter(([group,items])=>!normalized||group.toLocaleLowerCase('es').includes(normalized)||items.some(p=>(p+' '+labelOf(p)).toLocaleLowerCase('es').includes(normalized))).map(([group,items])=>{
          const open=expanded.includes(group)||Boolean(normalized);const selectable=items.filter(p=>!protectedPermissions.has(p));
          return <section key={group} className="rbac-group"><div className="rbac-group-heading"><button type="button" aria-expanded={open} onClick={()=>setExpanded(open?expanded.filter(x=>x!==group):[...expanded,group])}>{open?'▾':'▸'} {group} <small>({items.length})</small></button>
            <label><input type="checkbox" checked={selectable.length>0&&selectable.every(p=>permissions.includes(p))} onChange={()=>toggle(items)}/> Todo el módulo</label></div>
            {open&&<div className="rbac-subgroups">{subgroups(items.filter(p=>!normalized||group.toLocaleLowerCase('es').includes(normalized)||(p+' '+labelOf(p)).toLocaleLowerCase('es').includes(normalized))).map(([sub,subitems])=><div key={sub}>
              <label className="rbac-subgroup-heading"><input type="checkbox" checked={subitems.filter(p=>!protectedPermissions.has(p)).length>0&&subitems.filter(p=>!protectedPermissions.has(p)).every(p=>permissions.includes(p))} onChange={()=>toggle(subitems)}/> {sub==='General'?'Acciones generales':sub}</label>
              <div className="rbac-permissions">{subitems.map(permission=><label key={permission} title={permission}>
                <input type="checkbox" disabled={protectedPermissions.has(permission)} checked={permissions.includes(permission)} onChange={()=>toggle([permission])}/>
                <span>{labelOf(permission)}<small>{permission}</small></span></label>)}</div></div>)}</div>}</section>;
        })}</div><p className="muted">Usuarios y roles son funciones exclusivas del Super Administrador.</p>
        {error&&<p role="alert">{error}</p>}
        <div className="modal-actions"><button className="secondary" type="button" disabled={busy} onClick={()=>setEditing(false)}>Cancelar</button>
          <button className="primary" type="button" disabled={busy||name.trim().length<3} onClick={()=>void save()}>{busy?'Guardando…':'Guardar rol'}</button></div>
      </section></div>:null}
  </section>;
}
