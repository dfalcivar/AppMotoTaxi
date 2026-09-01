/** Presentation contracts only. API permissions remain authoritative. */
export const consoleGroups = [
  { label: 'Inicio', modules: ['home', 'dashboard'] },
  { label: 'Operación', modules: ['operations', 'alerts', 'trips'] },
  { label: 'Usuarios y flota', modules: ['drivers', 'fleet', 'passengers', 'cooperatives'] },
  { label: 'Membresías y cobranzas', modules: ['memberships'] },
  { label: 'Finanzas y facturación', modules: ['fiscal'] },
  { label: 'Comercial y crecimiento', modules: ['commercial', 'advertising'] },
  { label: 'Comunicación', modules: ['notifications'] },
  { label: 'Cobertura y tarifas', modules: ['pricing', 'zones'] },
  { label: 'Gestión y soporte', modules: ['settings', 'incidents', 'access', 'audit', 'database'] },
];
export const consoleDescriptions: Record<string,string> = {
  home:'Tu operación, prioridades y accesos en un solo lugar.', dashboard:'Analiza tendencias y consulta los registros detrás de cada indicador.',
  operations:'Sigue solicitudes, disponibilidad y viajes en tiempo real.', alerts:'Detecta novedades y revisa las entregas de notificaciones.',
  trips:'Consulta viajes inmediatos, programados y su cálculo tarifario.',drivers:'Gestiona aprobación, documentación y estado de los conductores.',
  passengers:'Consulta actividad, cancelaciones y datos de las cuentas.', fleet:'Administra unidades, responsables, autorizaciones y jornadas.',
  cooperatives:'Consulta conductores, viajes y actividad de cada cooperativa.', memberships:'Gestiona vigencia, renovaciones, cobranzas y puntos de pago.',
  fiscal:'Consulta clientes fiscales, documentos, ingresos y comprobantes según tus permisos.',commercial:'Gestiona prospectos, ventas, pagos y campañas sin perder su trazabilidad.',
  advertising:'Administra publicidad institucional y sus momentos de exposición.',pricing:'Configura tarifas, sectores y reglas por trayecto.',
  notifications:'Analiza patrones, controla recomendaciones y administra campañas sin reemplazar las alertas críticas.',
  zones:'Define, valida y consulta los polígonos de cobertura.',settings:'Parámetros de búsqueda, tarifas, seguridad y operación.',
  incidents:'Atiende solicitudes, incidencias y preguntas frecuentes.',access:'Administra usuarios, roles y credenciales sin revelar contraseñas.',
  audit:'Consulta el historial de acciones y cambios administrativos.',database:'Comprueba la conexión real y el motor de almacenamiento.',
};
export function ecuDate(value: unknown, time=true): string {
  if(!value)return '—'; const raw=String(value);const date=new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw)?raw+'T12:00:00-05:00':raw);if(!Number.isFinite(date.getTime()))return '—';
  return new Intl.DateTimeFormat('es-EC',{timeZone:'America/Guayaquil',day:'2-digit',month:'2-digit',year:'numeric',...(time?{hour:'2-digit',minute:'2-digit',hourCycle:'h23' as const}:{})}).format(date);
}
export function usd(value: unknown): string {return new Intl.NumberFormat('es-EC',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value)||0);}
export function normalizeSearch(value: string) {return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es').trim();}
export function csvCell(value:string) {return '"'+(/^[\s]*[=+@\-\t\r]/.test(value)?"'"+value:value).replaceAll('"','""')+'"';}
export function dateRange(preset:string,now=new Date()) {
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Guayaquil',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const start=new Date(today+'T00:00:00-05:00');
  if(preset==='week')start.setUTCDate(start.getUTCDate()-6);
  if(preset==='month')start.setUTCDate(1);
  return {from:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Guayaquil',year:'numeric',month:'2-digit',day:'2-digit'}).format(start),to:today};
}
export function routeQuery() {return new URLSearchParams(typeof window==='undefined'?'':window.location.search);}
export function navigateConsole(module:string,params:Record<string,string>={}) {
  window.dispatchEvent(new CustomEvent('console-navigate',{detail:{module,params}}));
}
export const subNavigation: Record<string,{id:string;label:string;permission:string}[]> = {
  memberships:[{id:'memberships',label:'Vigencia y renovaciones',permission:'memberships:view'},{id:'payments',label:'Transferencias y comprobantes',permission:'payments:transfer_review'},{id:'collection',label:'Puntos y recaudadores',permission:'collection_points:manage'},{id:'plans',label:'Planes',permission:'membership_plans:manage'},{id:'grace',label:'Cortesías y gracia',permission:'membership_grace:manage'}],
  fiscal:[{id:'dashboard',label:'Resumen financiero',permission:'FACTURACION_DASHBOARD_VER'},{id:'invoices',label:'Facturación',permission:'FACTURACION_VER'},{id:'clients',label:'Clientes fiscales',permission:'CLIENTES_FISCALES_VER'},{id:'payments',label:'Pagos y comprobantes',permission:'FACTURACION_VER'}],
  commercial:[{id:'dashboard',label:'Resumen comercial',permission:'commercial:dashboard'},{id:'leads',label:'Prospectos y seguimientos',permission:'commercial:leads:view'},{id:'advertisers',label:'Comercios',permission:'commercial:advertisers:view'},{id:'orders',label:'Ventas y órdenes',permission:'commercial:orders:view'},{id:'payments',label:'Pagos',permission:'commercial:payments:view'},{id:'cash',label:'Caja y conciliación',permission:'commercial:payments:view'},{id:'campaigns',label:'Campañas y renovaciones',permission:'commercial:campaigns:view'}]
};
