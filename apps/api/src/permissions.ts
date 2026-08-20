export const adminRoles = [
  "ADMIN",
  "SUPPORT",
  "SUPER_ADMIN",
  "ADMIN_OPERACIONES",
  "SOPORTE",
  "ANALISTA_COOPERATIVA",
  "COLLECTOR",
  "FINANCE"
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
  "service_areas:view",
  "service_areas:create",
  "service_areas:edit",
  "service_areas:activate",
  "service_areas:archive",
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
  "faq:manage",
  "memberships:view",
  "memberships:manage",
  "membership_plans:manage",
  "membership_grace:manage",
  "membership_import:manage",
  "payment_orders:create",
  "payments:collect",
  "payments:transfer_review",
  "payments:view_own_point",
  "payments:view_all",
  "payments:courtesy_grant",
  "payments:reverse",
  "collection_points:manage",
  "cash_closures:create",
  "cash_closures:review",
  "settlements:create",
  "settlements:review",
  "settlements:view_own_point",
  "settlements:view_all",
  "financial_accounts:manage",
  "collection_point_limits:manage",
  "api_usage:view"
] as const;

export type Permission = typeof allPermissions[number];
export interface PermissionOverride { permission: string; allowed: boolean }

const operationsPermissions: Permission[] = [
  "dashboard:view", "passengers:view", "passengers:manage", "drivers:view",
  "drivers:manage", "drivers:approve", "drivers:documents:view",
  "drivers:documents:manage", "cooperatives:view", "cooperatives:manage",
  "trips:view", "trips:manage", "support:view", "support:manage",
  "incidents:view", "incidents:manage", "reports:view", "reports:export",
  "pricing:view", "zones:view", "service_areas:view", "advertising:view", "settings:view",
  "operations:view", "alerts:view", "faq:view"
];

const supportPermissions: Permission[] = [
  "dashboard:view", "passengers:view", "drivers:view", "trips:view",
  "support:view", "support:manage", "incidents:view", "incidents:manage",
  "faq:view", "faq:manage", "service_areas:view"
];

const cooperativeAnalystPermissions: Permission[] = [
  "cooperative_dashboard:view", "reports:view", "reports:export_aggregated"
];

const collectorPermissions: Permission[] = [
  "memberships:view", "payment_orders:create", "payments:collect",
  "payments:view_own_point", "cash_closures:create", "settlements:create",
  "settlements:view_own_point", "drivers:view"
];

const financePermissions: Permission[] = [
  "dashboard:view", "memberships:view", "payments:transfer_review",
  "payments:view_all", "cash_closures:review", "settlements:review",
  "settlements:view_all", "financial_accounts:manage", "reports:view",
  "reports:export"
];

export const rolePermissions: Record<AdminRole, readonly Permission[]> = {
  // Roles legados: se conservan para que las cuentas actuales no pierdan acceso.
  ADMIN: allPermissions,
  SUPPORT: supportPermissions,
  SUPER_ADMIN: allPermissions,
  ADMIN_OPERACIONES: operationsPermissions,
  SOPORTE: supportPermissions,
  ANALISTA_COOPERATIVA: cooperativeAnalystPermissions,
  COLLECTOR: collectorPermissions,
  FINANCE: financePermissions
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
