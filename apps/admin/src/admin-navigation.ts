export const modulePermissions:Record<string,string[]>={
  home:[],fleet:['fleet:view'],
  fiscal:['FACTURACION_VER','FACTURACION_DASHBOARD_VER','CLIENTES_FISCALES_VER'],
  dashboard:['dashboard:view','cooperative_dashboard:view'],operations:['operations:view'],alerts:['alerts:view'],
  trips:['trips:view'],drivers:['drivers:view'],memberships:['memberships:view'],passengers:['passengers:view'],
  cooperatives:['cooperatives:view'],pricing:['pricing:view'],zones:['service_areas:view'],
  notifications:['notifications:view','notification_campaigns:view'],settings:['settings:view'],advertising:['advertising:view'],
  commercial:['commercial:dashboard','commercial:leads:view','commercial:campaigns:view','commercial:payments:view'],
  incidents:['incidents:view'],access:['roles:manage'],audit:['audit:view'],database:['database:view']
};
export function visibleAdminModules<T extends string>(modules:readonly T[],allowed:(permission:string)=>boolean):T[]{
  return modules.filter(module=>module==='home'||(modulePermissions[module]??[]).some(allowed));
}
export function resolvedAdminModule<T extends string>(requested:string|null,visible:readonly T[]):T{
  return visible.includes(requested as T)?requested as T:'home' as T;
}
