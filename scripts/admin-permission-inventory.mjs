import {readdir,readFile,writeFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import ts from 'typescript';

const root=process.cwd(),source=join(root,'apps/api/src'),output=join(root,'docs/admin-rbac-inventory.md');
async function files(dir){const result=[];for(const item of await readdir(dir,{withFileTypes:true})){
  const path=join(dir,item.name);if(item.isDirectory())result.push(...await files(path));
  else if(item.name.endsWith('.ts')&&!item.name.endsWith('.test.ts'))result.push(path);
}return result;}
const routes=[];
for(const path of await files(source)){
  const code=await readFile(path,'utf8'),tree=ts.createSourceFile(path,code,ts.ScriptTarget.Latest,true);
  function visit(node){
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&
      ['get','post','put','patch','delete'].includes(node.expression.name.text)&&node.arguments.length>=2){
      const first=node.arguments[0];
      const url=ts.isStringLiteral(first)?first.text:
        path.endsWith(join('fleet','routes.ts'))&&ts.isTemplateExpression(first)&&first.templateSpans.length===1&&
        first.templateSpans[0].expression.getText(tree)==='base'
          ?'/v1/admin/fleet'+first.templateSpans[0].literal.text:undefined;
      if(!url?.startsWith('/v1/admin/')){ts.forEachChild(node,visit);return;}
      const method=node.expression.name.text.toUpperCase();
      const body=node.arguments.slice(1).map(arg=>arg.getText(tree)).join(' ');
      const permissions=[...body.matchAll(/requirePermission\s*\(\s*\w+\s*,\s*["']([^"']+)["']/g)].map(match=>match[1]);
      const unique=[...new Set(permissions)];
      let guard=unique.length?unique.join(', '):/requireSuperAdmin/.test(body)?'roles:manage (Super Administrador)':
        /actor\(req,reply,true\)/.test(body)?'fleet:manage (actor)':
        /actor\(req,reply\)/.test(body)?'fleet:view (actor)':
        /contextOwner/.test(body)?'Permiso según origen (contextOwner)':
        /session\(request\)/.test(body)?'Permisos por resultado (session)':
        /requireAdminSession|requirePermission|requireAdmin|adminGuard|authenticatedAdmin/.test(body)?'Guardia indirecta':'REVISAR GUARDIA';
      if(url==='/v1/admin/zones'&&method==='POST')guard='service_areas:create / edit según areaId';
      if(url.includes('/driver-approvals/:id/decision'))guard='drivers:approve / reject / request_corrections / suspend según decisión';
      if(url.includes('/commercial/campaigns/:id/action'))guard='commercial:campaigns:review / manage según acción';
      if(url.includes('/fiscal/invoices/:id/:action'))guard='Permiso fiscal según acción';
      if(url==='/v1/admin/session')guard='Inicio de sesión (pública)';
      routes.push({method,url,guard,file:relative(root,path).replaceAll('\\','/'),line:tree.getLineAndCharacterOfPosition(node.getStart(tree)).line+1});
    }
    ts.forEachChild(node,visit);
  }visit(tree);
}
routes.sort((a,b)=>a.url.localeCompare(b.url)||a.method.localeCompare(b.method));
const modules=new Map();for(const route of routes){const key=route.url.split('/')[3]??'root';modules.set(key,(modules.get(key)??0)+1);}
const permissionSource=await readFile(join(root,'apps/api/src/permissions.ts'),'utf8');
const catalogSection=permissionSource.split('export const allPermissions = [')[1]?.split('] as const')[0]??'';
const catalog=[...catalogSection.matchAll(/"([^"]+)"/g)].map(match=>match[1]);
const roleMigration=await readFile(join(root,'apps/api/migrations/099_configurable_admin_roles.sql'),'utf8');
const pilotSection=roleMigration.split('from (values')[1]?.split(') as selected')[0]??'';
const pilot=[...pilotSection.matchAll(/\('([^']+)'\)/g)].map(match=>match[1]);
function uiModule(route){const section=route.url.split('/')[3]??'';
  if(section.startsWith('membership')||['collection-closures','collection-points','commercial-economics'].includes(section))return 'Membresías y cobranzas';
  if(section==='fiscal')return 'Finanzas y facturación';
  if(section==='commercial')return 'Comercial y publicidad';
  if(section==='banners')return 'Publicidad institucional';
  if(['drivers','driver-approvals','driver-approval-settings'].includes(section))return 'Conductores';
  if(['zones','fare-sectors','fare-rules','pricing'].includes(section))return 'Tarifas y cobertura';
  if(['incidents','faqs'].includes(section))return 'Soporte';
  if(['access','mobile-access','users'].includes(section))return 'Usuarios y roles';
  return section.replaceAll('-',' ');
}
const lines=[
  '# Inventario RBAC del panel administrativo',
  '',
  'Generado desde las rutas reales con `node scripts/admin-permission-inventory.mjs`. El menú se define en `apps/admin/src/main.tsx` y `apps/admin/src/console-model.ts`; las acciones internas están en los componentes de cada módulo. Una guardia indirecta requiere inspección manual del controlador.',
  '',
  `Rutas administrativas detectadas: **${routes.length}**. Permisos del catálogo existente y ampliado: **${catalog.length}**.`,
  '',
  '## Módulos visibles y acciones',
  '',
  '| Módulo | Submódulos y acciones visibles |',
  '| --- | --- |',
  '| Inicio y análisis | Métricas, detalles, filtros, mapas y exportaciones |',
  '| Operación y alertas | Buscar, consultar detalles de viajes, disponibilidad y alertas |',
  '| Viajes | Consultar, filtrar, ver detalle y cancelar |',
  '| Conductores | Consultar, aprobar, rechazar, observar, suspender, revisar y subir documentos, editar cuenta |',
  '| Mototaxis y flota | Ver unidades, responsables, relaciones, auditoría y jornadas; gestionar según permiso |',
  '| Pasajeros | Consultar, editar estado, historial y reglas de cancelación |',
  '| Cooperativas | Consultar, crear, editar y ver analítica |',
  '| Membresías y cobranzas | Vigencia, planes, cortesías, órdenes, recargas, transferencias, caja, conciliaciones y puntos de cobro |',
  '| Finanzas y facturación | Clientes fiscales, pagos, facturas, XML/RIDE, reenvío, consulta, reintento y notas de crédito |',
  '| Comercial y publicidad | Prospectos, comercios, órdenes, pagos, conciliación, campañas, banners y planes comerciales |',
  '| Notificaciones | Salud, diagnósticos, campañas, pruebas, recordatorios, configuración y versiones de app |',
  '| Tarifas y cobertura | Versiones, sectores, reglas por trayecto, zonas y áreas de servicio |',
  '| Configuración | Parámetros operativos, comerciales, fiscales, búsqueda y seguridad |',
  '| Soporte | Incidentes, mensajes, respuestas, cierre y preguntas frecuentes |',
  '| Usuarios y roles | Usuarios web, acceso móvil, restablecimiento y roles configurables |',
  '| Auditoría y sistema | Historial de acciones, salud y uso de API |',
  '',
  '## Mapa ruta → acción → permiso',
  '',
  '| Módulo UI | Submódulo | Acción | Ruta | Permiso / guardia | Código |',
  '| --- | --- | --- | --- | --- | --- |',
  ...routes.map(r=>`| ${uiModule(r)} | ${r.url.split('/')[4]??'General'} | ${r.method} | \`${r.url}\` | ${r.guard} | [${r.file}](${relative(join(root,'docs'),join(root,r.file)).replaceAll('\\','/')}:L${r.line}) |`),
  '',
  'La UI filtra módulos y submenús por permisos. La API constituye la comprobación autoritativa. `requireAdminSession` protege `/me` y cambio de clave; la búsqueda usa permisos por resultado; el acceso de flota pasa por `actor`.',
  '',
  '## Catálogo de permisos',
  '',
  ...catalog.map(permission=>`- \`${permission}\``),
  '',
  '## Rol piloto: Gestión Operativa',
  '',
  `Permisos iniciales (${pilot.length}): ${pilot.map(permission=>`\`${permission}\``).join(', ')}.`,
  '',
  'Excluye usuarios y roles, configuración global, parámetros técnicos, tarifas, zonas, seguridad, creación de notas de crédito y modificación de IVA. El Super Administrador conserva los roles legados y acceso completo.',
  ''
];
await writeFile(output,lines.join('\n'));
console.log(JSON.stringify({routes:routes.length,indirect:routes.filter(r=>r.guard==='Guardia indirecta').length,review:routes.filter(r=>r.guard==='REVISAR GUARDIA').length,modules:Object.fromEntries(modules)}));
