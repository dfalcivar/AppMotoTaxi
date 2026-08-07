export const adminRoles = [
  "ADMIN",
  "SUPPORT",
  "SUPER_ADMIN",
  "ADMIN_OPERACIONES",
  "SOPORTE",
  "ANALISTA_COOPERATIVA"
] as const;

export type AdminRole = typeof adminRoles[number];

export const allPermissions = [
  "dashboard:view",
  "cooperative_dashboard:view",
  "passengers:view",
  "passengers:manage",
  "drivers:view",
  "drivers:manage",
  "drivers:approve",
  "drivers:documents:view",
  "drivers:documents:manage",
  "cooperatives:view",
  "cooperatives:manage",
  "trips:view",
  "trips:manage",
  "support:view",
  "support:manage",
  "incidents:view",
  "incidents:manage",
  "reports:view",
  "reports:export",
  "reports:export_aggregated",
  "pricing:view",
  "pricing:manage",
  "zones:view",
  "zones:manage",
  "advertising:view",
  "advertising:manage",
  "settings:view",
  "settings:manage",
  "users:manage",
  "roles:manage",
  "audit:view",
  "database:view",
  "operations:view",
  "alerts:view",
  "faq:view",
  "faq:manage"
] as const;

export type Permission = typeof allPermissions[number];
export interface PermissionOverride { permission: string; allowed: boolean }

const operationsPermissions: Permission[] = [
  "dashboard:view", "passengers:view", "passengers:manage", "drivers:view",
  "drivers:manage", "drivers:approve", "drivers:documents:view",
  "drivers:documents:manage", "cooperatives:view", "cooperatives:manage",
  "trips:view", "trips:manage", "support:view", "support:manage",
  "incidents:view", "incidents:manage", "reports:view", "reports:export",
  "pricing:view", "zones:view", "advertising:view", "settings:view",
  "operations:view", "alerts:view", "faq:view"
];

const supportPermissions: Permission[] = [
  "dashboard:view", "passengers:view", "drivers:view", "trips:view",
  "support:view", "support:manage", "incidents:view", "incidents:manage",
  "faq:view", "faq:manage"
];

const cooperativeAnalystPermissions: Permission[] = [
  "cooperative_dashboard:view", "reports:view", "reports:export_aggregated"
];

export const rolePermissions: Record<AdminRole, readonly Permission[]> = {
  // Roles legados: se conservan para que las cuentas actuales no pierdan acceso.
  ADMIN: allPermissions,
  SUPPORT: supportPermissions,
  SUPER_ADMIN: allPermissions,
  ADMIN_OPERACIONES: operationsPermissions,
  SOPORTE: supportPermissions,
  ANALISTA_COOPERATIVA: cooperativeAnalystPermissions
};

const knownPermissions = new Set<string>(allPermissions);

export function isAdminRole(value: string): value is AdminRole {
  return (adminRoles as readonly string[]).includes(value);
}

export function permissionsForRole(
  role: AdminRole,
  overrides: readonly PermissionOverride[] = []
): Permission[] {
  const resolved = new Set<Permission>(rolePermissions[role]);
  for (const override of overrides) {
    if (!knownPermissions.has(override.permission)) continue;
    const permission = override.permission as Permission;
    if (override.allowed) resolved.add(permission);
    else resolved.delete(permission);
  }
  return allPermissions.filter(permission => resolved.has(permission));
}

export function hasPermission(
  role: AdminRole,
  permission: Permission,
  resolvedPermissions?: readonly Permission[]
): boolean {
  return (resolvedPermissions ?? rolePermissions[role]).includes(permission);
}
