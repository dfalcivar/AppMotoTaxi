import { z } from "zod";

const tripStatuses = [
  "SEARCHING", "ASSIGNED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED",
  "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_DRIVER", "INCIDENT"
] as const;

// PostgreSQL accepts legacy UUID values seeded before RFC version bits were
// enforced (for example 00000000-0000-0000-0000-000000000102). They are valid
// database identifiers even though z.string().uuid() rejects their version.
const postgresUuid = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
);

const querySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  cooperativeId: postgresUuid.optional(),
  driverId: postgresUuid.optional(),
  sector: z.enum(["URBAN", "EXTENDED"]).optional(),
  status: z.enum(tripStatuses).optional(),
  tripType: z.enum(["ALL", "IMMEDIATE", "SCHEDULED"]).default("ALL")
});

export interface DashboardFilters {
  from: Date;
  to: Date;
  cooperativeId?: string;
  driverId?: string;
  sector?: "URBAN" | "EXTENDED";
  status?: typeof tripStatuses[number];
  tripType: "ALL" | "IMMEDIATE" | "SCHEDULED";
}

export function dashboardFilters(
  query: unknown,
  forcedCooperativeId?: string
): DashboardFilters {
  const parsed = querySchema.parse(query);
  const to = parsed.to ? new Date(parsed.to) : new Date();
  const from = parsed.from
    ? new Date(parsed.from)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (from >= to || to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000) {
    throw new z.ZodError([{
      code: "custom",
      path: ["from"],
      message: "INVALID_DASHBOARD_DATE_RANGE"
    }]);
  }
  return {
    ...parsed,
    from,
    to,
    cooperativeId: forcedCooperativeId ?? parsed.cooperativeId
  };
}
