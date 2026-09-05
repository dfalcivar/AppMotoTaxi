import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { database } from "./database.js";
import { persistAudit, requirePermission, userFrom, type SessionUser } from "./admin.js";
import { legacyPhoneAliases, normalizeEmail, normalizePhone } from "./auth-security.js";
import { renderCostaGoEmail, sendTransactionalEmail } from "./email.js";
import { sendPush } from "./push.js";
import { lockMembershipBilling } from './membership-trip-usage.js';
import { requireOrderFiscalProfile } from './fiscal/clients.js';
import { taxBreakdown } from './taxes.js';
import {notificationPreferenceAllows} from './notification-preferences.js';
import {sendMembershipActivationConfirmation} from './membership-activation.js';

const ACTIVE_TRIP_STATES = ["ASSIGNED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "IN_PROGRESS"] as const;
const membershipStatusSchema = z.enum([
  "PENDING", "ACTIVE", "EXPIRING", "GRACE_PERIOD", "PAYMENT_DUE",
  "SUSPENSION_PENDING_ACTIVE_TRIP", "SUSPENDED_NON_PAYMENT", "SUSPENDED", "EXHAUSTED", "CLOSED"
]);
const membershipPlanTypeSchema = z.enum(["PERIODIC", "TRIP_PACK"]);
const navigationProviderSchema = z.enum(["MAP_ONLY", "EXTERNAL_MAPS", "NAVIGATION_SDK"]);
const navigationStartModeSchema = z.enum(["MANUAL", "AUTO"]);

const platformSettingsSchema = z.object({
  navigationPickupProvider: navigationProviderSchema,
  navigationDestinationProvider: navigationProviderSchema,
  navigationPickupStartMode: navigationStartModeSchema,
  navigationDestinationStartMode: navigationStartModeSchema,
  mobileCloudMapStyleEnabled: z.boolean(),
  textSearchMinimumCharacters: z.number().int().min(2).max(10),
  textSearchDebounceMilliseconds: z.number().int().min(200).max(1500),
  textSearchFreeCapReference: z.number().int().min(0).max(10_000_000),
  textSearchPricePerThousandUsd: z.number().min(0).max(10000),
  textSearchMonthlyBudgetUsd: z.number().min(0).max(1_000_000),
  textSearchWarningPercent: z.number().int().min(1).max(99),
  textSearchCriticalPercent: z.number().int().min(2).max(100),
  textSearchHardLimitEnabled: z.boolean(),
  navigationFreeCapReference: z.number().int().min(0).max(10_000_000),
  navigationPricePerThousandUsd: z.number().min(0).max(10000),
  navigationWarningPercent: z.number().int().min(1).max(99),
  navigationCriticalPercent: z.number().int().min(2).max(100),
  routesFreeCapReference: z.number().int().min(0).max(10_000_000),
  routesPricePerThousandUsd: z.number().min(0).max(10000),
  geocodingFreeCapReference: z.number().int().min(0).max(10_000_000),
  geocodingPricePerThousandUsd: z.number().min(0).max(10000),
  driverMembershipsEnabled: z.boolean(),
  membershipEnforcementEnabled: z.boolean(),
  membershipUsageBillingEnabled: z.boolean(),
  membershipSuspensionSchedulerEnabled: z.boolean(),
  collectorPortalEnabled: z.boolean(),
  bankTransferEnabled: z.boolean(),
  cashCollectionEnabled: z.boolean(),
  deunaCollectionEnabled: z.boolean(),
  collectionPointSettlementsEnabled: z.boolean(),
  collectionPointCommissionsEnabled: z.boolean(),
  collectionPointLimitsEnabled: z.boolean(),
  financeRoleEnabled: z.boolean(),
  membershipExpiryNoticeDays: z.number().int().min(1).max(90),
  membershipGraceDays: z.number().int().min(0).max(90),
  membershipGraceAllowsTrips: z.boolean(),
  membershipSuspensionLocalTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  membershipTimezone: z.string().min(3).max(80),
  newDriverGraceEnabled: z.boolean(),
  newDriverGraceDurationHours: z.number().int().min(0).max(24 * 90),
  newDriverGraceAllowsTrips: z.boolean(),
  newDriverGraceMaxGrants: z.number().int().min(0).max(20),
  membershipExtraTripSharePercent: z.number().min(0).max(100),
  membershipQrDurationHours: z.number().int().min(1).max(168),
  advertisingRotationSeconds: z.number().int().min(3).max(60),
  advertisingMaxActivePerZone: z.number().int().min(1).max(100)
}).refine(value => value.textSearchCriticalPercent > value.textSearchWarningPercent, {
  path: ["textSearchCriticalPercent"], message: "CRITICAL_THRESHOLD_MUST_EXCEED_WARNING"
}).refine(value => value.navigationCriticalPercent > value.navigationWarningPercent, {
  path: ["navigationCriticalPercent"], message: "CRITICAL_THRESHOLD_MUST_EXCEED_WARNING"
});

const planBaseSchema = z.object({
  code: z.string().trim().min(3).max(40).regex(/^[A-Z0-9_]+$/),
  name: z.string().trim().min(3).max(100),
  planType: membershipPlanTypeSchema.default("PERIODIC"),
  periodUnit: z.enum(["DAY", "MONTH", "QUARTER", "YEAR"]),
  periodCount: z.number().int().min(1).max(24),
  durationDays: z.number().int().min(1).max(730),
  baseAmount: z.number().min(0).max(10000),
  currency: z.string().length(3).default("USD"),
  includedTrips: z.number().int().min(0).max(1_000_000),
  maxRenewalAmount: z.number().min(0).max(100000),
  extraTripSharePercent: z.number().min(0).max(100),
  packValidityDays: z.number().int().min(1).max(3650).nullable().optional(),
  enabled: z.boolean().default(true),
  effectiveFrom: z.string().datetime({ offset: true }).optional()
});

const validatePlan = <T extends z.infer<typeof planBaseSchema>>(value: T, context: z.RefinementCtx) => {
  if (value.planType === "PERIODIC" && value.maxRenewalAmount < value.baseAmount) {
    context.addIssue({ code: "custom", path: ["maxRenewalAmount"], message: "MAXIMUM_BELOW_BASE" });
  }
  if (value.planType === "TRIP_PACK" && value.includedTrips < 1) {
    context.addIssue({ code: "custom", path: ["includedTrips"], message: "TRIP_PACK_REQUIRES_CREDITS" });
  }
};

const planSchema = planBaseSchema.superRefine(validatePlan);

const planVersionSchema = planBaseSchema.omit({
  code: true,
  planType: true,
  enabled: true,
  effectiveFrom: true
});

const gracePolicySchema = z.object({
  name: z.string().trim().min(3).max(120),
  reason: z.string().trim().min(5).max(500),
  scope: z.enum(["ALL", "COOPERATIVE", "DRIVER"]),
  cooperativeId: z.string().uuid().nullable().optional(),
  driverId: z.string().uuid().nullable().optional(),
  graceDays: z.number().int().min(0).max(90),
  allowsTrips: z.boolean(),
  campaignKind: z.enum(["RENEWAL", "NEW_DRIVER_ONBOARDING"]),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  expiryWindowStart: z.string().date().nullable().optional(),
  expiryWindowEnd: z.string().date().nullable().optional(),
  priority: z.number().int().min(-1000).max(1000).default(0),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "FINISHED"]).default("DRAFT")
}).superRefine((value, context) => {
  if (new Date(value.endsAt) <= new Date(value.startsAt)) context.addIssue({ code: "custom", path: ["endsAt"], message: "INVALID_CAMPAIGN_DATES" });
  if (value.scope === "COOPERATIVE" && !value.cooperativeId) context.addIssue({ code: "custom", path: ["cooperativeId"], message: "COOPERATIVE_REQUIRED" });
  if (value.scope === "DRIVER" && !value.driverId) context.addIssue({ code: "custom", path: ["driverId"], message: "DRIVER_REQUIRED" });
});

const paymentOrderSchema = z.object({
  planId: z.string().uuid(),
  intendedMethod: z.enum(["CASH", "DEUNA", "BANK_TRANSFER"]).optional(),
  idempotencyKey: z.string().trim().min(8).max(120)
});
const paymentOrderCancellationSchema = z.object({
  reason: z.enum([
    "ORDER_GENERATION_ERROR", "WRONG_MEMBERSHIP", "CHANGED_MIND",
    "DUPLICATE_ORDER", "OTHER"
  ]),
  observation: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().min(8).max(120)
}).superRefine((value, context) => {
  if (value.reason === "OTHER" && (value.observation?.length ?? 0) < 3) {
    context.addIssue({ code: "custom", path: ["observation"], message: "CANCELLATION_OBSERVATION_REQUIRED" });
  }
});
const paymentConfirmSchema = z.object({
  method: z.enum(["CASH", "DEUNA", "BANK_TRANSFER"]),
  collectionPointId: z.string().uuid(),
  reference: z.string().trim().min(3).max(120).optional(),
  idempotencyKey: z.string().trim().min(8).max(120)
});
const collectorOrderSearchSchema = z.object({ query: z.string().trim().min(3).max(200) });
const transferProofSchema = z.object({
  bankName: z.string().trim().min(2).max(100),
  reference: z.string().trim().min(3).max(120),
  transferDate: z.string().date(),
  declaredAmount: z.number().positive().max(100000),
  fileMime: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
  fileBase64: z.string().min(100).max(7_500_000),
  observation: z.string().trim().max(500).optional()
});
const collectionPointDirectoryQuerySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional()
}).refine(value => (value.latitude == null) === (value.longitude == null), { message: "LOCATION_PAIR_REQUIRED" });
const usageSchema = z.object({
  provider: z.enum(["NAVIGATION_SDK", "ROUTES", "PLACES_AUTOCOMPLETE", "PLACE_DETAILS", "TEXT_SEARCH_PRO", "GEOCODING", "MOBILE_MAP", "WEB_DYNAMIC_MAP"]),
  requestKey: z.string().trim().min(8).max(200),
  tripId: z.string().uuid().optional(),
  serviceAreaId: z.string().uuid().optional(),
  phase: z.string().trim().max(50).optional(),
  sessionKey: z.string().trim().max(200).optional(),
  result: z.string().trim().max(80).optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional()
});

const driverImportSchema = z.object({
  filename: z.string().trim().min(5).max(180).refine(value => value.toLowerCase().endsWith(".csv")),
  contentBase64: z.string().min(8).max(3_000_000)
});

type DriverImportRow = {
  rowNumber: number;
  firstNames: string;
  lastNames: string;
  identityNumber: string;
  email: string;
  phone: string;
  cooperativeCode: string;
  plate: string;
  vehicleBrand: string;
  vehicleModel: string;
  vehicleYear?: number;
  notes: string;
};

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < content.length; index++) {
    const character = content[index]!;
    if (character === '"') {
      if (quoted && content[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell.trim()); cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && content[index + 1] === "\n") index++;
      row.push(cell.trim()); cell = "";
      if (row.some(value => value.length)) rows.push(row);
      row = [];
    } else cell += character;
  }
  if (quoted) throw new Error("INVALID_CSV_QUOTES");
  row.push(cell.trim());
  if (row.some(value => value.length)) rows.push(row);
  return rows;
}

const driverImportHeaders = [
  "nombres", "apellidos", "identificacion", "correo", "telefono", "cooperativa",
  "placa", "marca", "modelo", "anio", "informacion_adicional"
] as const;

function importedRow(values: string[], headerIndex: Map<string, number>, rowNumber: number): DriverImportRow {
  const value = (name: typeof driverImportHeaders[number]) => values[headerIndex.get(name) ?? -1]?.trim() ?? "";
  const yearText = value("anio");
  return {
    rowNumber,
    firstNames: value("nombres"), lastNames: value("apellidos"), identityNumber: value("identificacion"),
    email: normalizeEmail(value("correo")), phone: value("telefono"), cooperativeCode: value("cooperativa").toUpperCase(),
    plate: value("placa").replace(/\s+/g, "").toUpperCase(), vehicleBrand: value("marca"), vehicleModel: value("modelo"),
    vehicleYear: /^\d{4}$/.test(yearText) ? Number(yearText) : undefined, notes: value("informacion_adicional")
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function money(value: unknown): number {
  return Number(Number(value ?? 0).toFixed(2));
}

function maskReference(value: string): string {
  const normalized = value.replace(/\s+/g, "").toUpperCase();
  return normalized.length <= 4 ? "****" : `****${normalized.slice(-4)}`;
}

function normalizeReference(value: string): string {
  return value.normalize("NFKC").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function validFileSignature(data: Buffer, mime: string): boolean {
  if (mime === "image/jpeg") return data[0] === 0xff && data[1] === 0xd8 && data[data.length - 2] === 0xff && data[data.length - 1] === 0xd9;
  if (mime === "image/png") return data.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (mime === "image/webp") return data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP";
  if (mime === "application/pdf") return data.subarray(0, 5).toString("ascii") === "%PDF-";
  return false;
}

async function requireMobileUser(request: FastifyRequest, reply: FastifyReply, role?: "DRIVER" | "PASSENGER"): Promise<SessionUser | undefined> {
  const token = userFrom(request);
  if (!token?.id) {
    reply.code(401).send({ error: "UNAUTHORIZED" });
    return;
  }
  const [row] = await database()`
    select u.status::text, u.active_session_id::text as "activeSessionId", u.deleted_at,
      exists(select 1 from mobile_account_roles mar where mar.user_id=u.id and mar.role=${role ?? token.role}) as "hasRole"
    from users u where u.id=${token.id}
  `;
  if (!row || row.deleted_at || row.status !== "ACTIVE" || !row.hasRole || (token.sessionId && row.activeSessionId !== token.sessionId)) {
    reply.code(401).send({ error: "SESSION_EXPIRED" });
    return;
  }
  if (role && token.role !== role) {
    reply.code(403).send({ error: "FORBIDDEN" });
    return;
  }
  return token;
}

export interface DriverEligibility {
  eligible: boolean;
  reason?: string;
  membership?: Record<string, unknown>;
  enforcementEnabled: boolean;
}

export async function driverMembershipEligibility(driverId: string): Promise<DriverEligibility> {
  const [settings] = await database()`
    select driver_memberships_enabled as "membershipsEnabled",
      membership_enforcement_enabled as "enforcementEnabled"
    from operational_settings where id=1
  `;
  if (!settings?.membershipsEnabled || !settings?.enforcementEnabled) {
    return { eligible: true, enforcementEnabled: Boolean(settings?.enforcementEnabled) };
  }
  const [driver] = await database()`
    select u.status::text as "accountStatus", d.approval_status as "approvalStatus",
      exists(select 1 from driver_documents dd where dd.driver_id=d.user_id and dd.status='SUSPENDED') as "hasSuspendedDocuments"
    from drivers d join users u on u.id=d.user_id where d.user_id=${driverId}
  `;
  if (!driver || driver.accountStatus !== "ACTIVE") return { eligible: false, reason: "DRIVER_ACCOUNT_INACTIVE", enforcementEnabled: true };
  if (driver.approvalStatus !== "APROBADO") return { eligible: false, reason: "DRIVER_NOT_APPROVED", enforcementEnabled: true };
  if (driver.hasSuspendedDocuments) return { eligible: false, reason: "DRIVER_DOCUMENTS_INVALID", enforcementEnabled: true };
  const [membership] = await database()`
    select id::text, status, starts_at as "startsAt", expires_at as "expiresAt",
      grace_ends_at as "graceEndsAt", suspension_at as "suspensionAt",
      grace_allows_trips_applied as "graceAllowsTrips",plan_type_snapshot as "planType",
      completed_trips as "completedTrips",included_trips_snapshot as "includedTrips"
    from driver_memberships where driver_id=${driverId} and cycle_closed_at is null
    order by created_at desc limit 1
  `;
  if (!membership) return { eligible: false, reason: "MEMBERSHIP_REQUIRED", enforcementEnabled: true };
  const status = String(membership.status);
  if (membership.planType === "TRIP_PACK" && Number(membership.completedTrips) >= Number(membership.includedTrips)) {
    return { eligible: false, reason: "MEMBERSHIP_EXHAUSTED", membership, enforcementEnabled: true };
  }
  const now = Date.now();
  if (membership.suspensionAt && new Date(String(membership.suspensionAt)).getTime() <= now && status !== "ACTIVE" && status !== "EXPIRING") {
    return { eligible: false, reason: "MEMBERSHIP_SUSPENDED_NON_PAYMENT", membership, enforcementEnabled: true };
  }
  const permitted = ["ACTIVE", "EXPIRING", "PAYMENT_DUE"].includes(status)
    || (status === "GRACE_PERIOD" && Boolean(membership.graceAllowsTrips));
  return { eligible: permitted, reason: permitted ? undefined : `MEMBERSHIP_${status}`, membership, enforcementEnabled: true };
}

export async function grantInitialDriverGrace(driverId: string, actorId?: string): Promise<void> {
  const sql = database();
  await sql.begin(async tx => {
    const [settings] = await tx`
      select driver_memberships_enabled as enabled, new_driver_grace_enabled as "graceEnabled",
        new_driver_grace_duration_hours as "durationHours", new_driver_grace_allows_trips as "allowsTrips",
        new_driver_grace_max_grants as "maxGrants", membership_timezone as timezone,
        membership_suspension_local_time::text as "suspensionTime",
        membership_extra_trip_share_percent::numeric as "sharePercent"
      from operational_settings where id=1
    `;
    if (!settings?.enabled) return;
    const [existing] = await tx`select id from driver_memberships where driver_id=${driverId} and cycle_closed_at is null for update`;
    if (existing) return;
    const [grants] = await tx`select count(*)::int as count from driver_memberships where driver_id=${driverId} and source='NEW_DRIVER_ONBOARDING'`;
    const [plan] = await tx`select * from membership_plans where code='MONTHLY' and enabled=true order by effective_from desc limit 1`;
    if (!plan) return;
    const graceEnabled = Boolean(settings.graceEnabled) && Number(grants?.count ?? 0) < Number(settings.maxGrants ?? 1);
    const durationHours = graceEnabled ? Number(settings.durationHours ?? 48) : 0;
    const [price] = await tx`select platform_commission_cents_per_leg from pricing_versions where active_from<=now() and (active_until is null or active_until>now()) order by active_from desc limit 1`;
    const passengerAdditional = Number(price?.platform_commission_cents_per_leg ?? 5) / 100;
    const sharePercent = Number(settings.sharePercent ?? plan.extra_trip_share_percent ?? 40);
    const extraFee = Number((passengerAdditional * sharePercent / 100).toFixed(4));
    await tx`
      insert into driver_memberships (
        driver_id,plan_id,plan_code,status,starts_at,expires_at,grace_ends_at,suspension_at,
        suspension_timezone_snapshot,suspension_local_time_snapshot,grace_reason,
        grace_days_applied,grace_allows_trips_applied,plan_snapshot,plan_type_snapshot,cycle_duration_snapshot,
        base_membership_amount_snapshot,included_trips_snapshot,extra_trip_fee_snapshot,
        extra_trip_share_percent_snapshot,max_renewal_amount_snapshot,
        passenger_service_additional_snapshot,estimated_next_renewal_amount,payer_type,
        amount,currency,payment_status,source,created_by,updated_by
      ) values (
        ${driverId},${plan.id},${plan.code},${graceEnabled ? "GRACE_PERIOD" : "PENDING"},now(),
        ${graceEnabled ? new Date(Date.now() + durationHours * 3_600_000) : null},
        ${graceEnabled ? new Date(Date.now() + durationHours * 3_600_000) : null},
        ${graceEnabled ? new Date(Date.now() + durationHours * 3_600_000) : null},
        ${settings.timezone},${settings.suspensionTime},${graceEnabled ? "NEW_DRIVER_ONBOARDING" : null},
        ${Math.ceil(durationHours / 24)},${graceEnabled && Boolean(settings.allowsTrips)},
        ${JSON.stringify({ code: plan.code, name: plan.name, planType: "PERIODIC", periodUnit: plan.period_unit, periodCount: plan.period_count })}::jsonb,
        'PERIODIC',${plan.duration_days},${plan.base_amount},${plan.included_trips},${extraFee},${sharePercent},
        ${plan.max_renewal_amount},${passengerAdditional},${plan.base_amount},'INDIVIDUAL',
        ${plan.base_amount},${plan.currency},'PENDING',${graceEnabled ? "NEW_DRIVER_ONBOARDING" : "NORMAL"},
        ${actorId ?? null},${actorId ?? null})
    `;
  });
}

async function currentMembership(driverId: string) {
  const [row] = await database()`
    select dm.id::text, dm.plan_code as "planCode", coalesce(mp.name,dm.plan_code) as "planName",
      dm.status,dm.starts_at as "startsAt",dm.expires_at as "expiresAt",dm.grace_ends_at as "graceEndsAt",
      dm.plan_type_snapshot as "planType",dm.exhausted_at as "exhaustedAt",
      dm.suspension_at as "suspensionAt",dm.completed_trips as "completedTrips",
      dm.included_trips_snapshot as "includedTrips",dm.extra_trips as "extraTrips",
      greatest(0,dm.included_trips_snapshot-dm.completed_trips) as "remainingTrips",
      dm.extra_trip_fee_snapshot::float8 as "extraTripFee",dm.raw_extra_amount::float8 as "rawExtraAmount",
      dm.billable_extra_amount::float8 as "billableExtraAmount",dm.estimated_next_renewal_amount::float8 as "estimatedNextRenewalAmount",
      dm.final_renewal_amount::float8 as "finalRenewalAmount",dm.base_membership_amount_snapshot::float8 as "baseAmount",
      dm.max_renewal_amount_snapshot::float8 as "maximumAmount",dm.passenger_service_additional_snapshot::float8 as "passengerAdditional",
      dm.currency,dm.payer_type as "payerType",coalesce(c.name,'Individual') as "payerName",
      dm.grace_reason as "graceReason",dm.grace_allows_trips_applied as "graceAllowsTrips"
    from driver_memberships dm left join membership_plans mp on mp.id=dm.plan_id
    left join cooperatives c on c.id=dm.cooperative_id
    where dm.driver_id=${driverId} and dm.cycle_closed_at is null order by dm.created_at desc limit 1
  `;
  return row;
}

function paymentOrderPublicToken(orderId: string) {
  const secret = process.env.ADMIN_SESSION_SECRET ?? "local-development-secret-change-me";
  const signature = createHmac("sha256", secret).update(`membership-payment:${orderId}`).digest("base64url");
  return `v1.${orderId}.${signature}`;
}

function paymentOrderQrUrl(orderId: string) {
  return `https://costa-go.com/collector-payment.html?token=${encodeURIComponent(paymentOrderPublicToken(orderId))}`;
}

function paymentOrderResult(order: Record<string, unknown>) {
  const { metadata: rawMetadata, ...safeOrder } = order;
  const metadata = rawMetadata as Record<string, unknown> | undefined;
  const configuredBreakdown = metadata?.economicBreakdown;
  const breakdown = configuredBreakdown && typeof configuredBreakdown === "object"
    ? configuredBreakdown
    : {
        baseAmount: Number(order.baseAmount ?? 0),
        billableExtraAmount: Number(order.priorUsageAmount ?? 0),
        adjustmentAmount: Number(order.adjustmentAmount ?? 0),
        subtotalAmount: Number(order.taxableSubtotal ?? order.totalAmount ?? 0),
        vatRatePercent: Number(order.vatRatePercent ?? 0),
        vatAmount: Number(order.vatAmount ?? 0),
        totalAmount: Number(order.totalAmount ?? 0),
        legacy: true
      };
  const id = String(order.id);
  const payable = ["PENDING", "PENDING_VERIFICATION"].includes(String(order.status));
  return {
    ...safeOrder,
    breakdown,
    token: payable ? paymentOrderPublicToken(id) : null,
    qrUrl: payable ? paymentOrderQrUrl(id) : null
  };
}

function haversineKm(latitude: number, longitude: number, targetLatitude: number, targetLongitude: number) {
  const radians = (value: number) => value * Math.PI / 180;
  const earthRadiusKm = 6371;
  const deltaLatitude = radians(targetLatitude - latitude);
  const deltaLongitude = radians(targetLongitude - longitude);
  const a = Math.sin(deltaLatitude / 2) ** 2 + Math.cos(radians(latitude)) * Math.cos(radians(targetLatitude)) * Math.sin(deltaLongitude / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function localScheduleState(schedules: Array<Record<string, unknown>>, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts().map(part => [part.type, part.value]));
  const day = ({ Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 } as Record<string,number>)[parts.weekday ?? "Sun"] ?? 0;
  const time = `${parts.hour}:${parts.minute}`;
  const today = schedules.find(item => Number(item.dayOfWeek) === day);
  const previous = schedules.find(item => Number(item.dayOfWeek) === (day + 6) % 7);
  const previousOpens = String(previous?.opensAt ?? "").slice(0,5);
  const previousCloses = String(previous?.closesAt ?? "").slice(0,5);
  const openFromPreviousDay = previous?.closed !== true && previousOpens.length === 5 && previousCloses.length === 5 && previousCloses < previousOpens && time < previousCloses;
  if (!today) return openFromPreviousDay ? { isOpen: true, todaySchedule: `Abierto hasta ${previousCloses}` } : { isOpen: null, todaySchedule: "Horario no configurado" };
  if (today.closed === true) return openFromPreviousDay ? { isOpen: true, todaySchedule: `Abierto hasta ${previousCloses}` } : { isOpen: false, todaySchedule: "Cerrado hoy" };
  const opensAt = String(today.opensAt ?? "").slice(0,5);
  const closesAt = String(today.closesAt ?? "").slice(0,5);
  const overnight = closesAt < opensAt;
  const isOpen = openFromPreviousDay || (overnight ? time >= opensAt : time >= opensAt && time < closesAt);
  return { isOpen, todaySchedule: `${opensAt} a ${closesAt}` };
}

async function activePaymentOrder(driverId: string) {
  const [order] = await database()`
    select id::text,status,short_code as "shortCode",base_amount::float8 as "baseAmount",
      prior_usage_amount::float8 as "priorUsageAmount",adjustment_amount::float8 as "adjustmentAmount",
      taxable_subtotal::float8 as "taxableSubtotal",vat_rate_percent::float8 as "vatRatePercent",
      vat_amount::float8 as "vatAmount",
      total_amount::float8 as "totalAmount",
      currency,expires_at as "expiresAt",plan_snapshot as "plan",metadata
    from membership_payment_orders
    where driver_id=${driverId} and status in ('PENDING','PENDING_VERIFICATION') and expires_at>now()
    order by case when status='PENDING_VERIFICATION' then 0 else 1 end,created_at desc limit 1
  `;
  if (!order) return null;
  if (Number((order.metadata as Record<string, unknown> | undefined)?.tokenVersion) !== 1) {
    const rawToken = paymentOrderPublicToken(String(order.id));
    await database()`
      update membership_payment_orders
      set public_token_hash=${sha256(rawToken)},
          metadata=metadata || '{"tokenVersion":1}'::jsonb,
          updated_at=now()
      where id=${order.id}
    `;
    order.metadata = { ...(order.metadata as Record<string, unknown> | undefined), tokenVersion: 1 };
  }
  const { metadata, ...safeOrder } = order as Record<string, unknown>;
  return Number((metadata as Record<string, unknown> | undefined)?.tokenVersion) === 1
    ? paymentOrderResult(order as Record<string, unknown>)
    : { ...safeOrder, token: null, qrUrl: null };
}

async function createPaymentOrder(driverId: string, input: z.infer<typeof paymentOrderSchema>) {
  const result = await database().begin(async tx => {
    await lockMembershipBilling(tx, driverId);
    await tx`update membership_payment_orders set status='EXPIRED',updated_at=now() where driver_id=${driverId} and status='PENDING' and expires_at<=now()`;
    const [existing] = await tx`
      select id::text,status,short_code as "shortCode",base_amount::float8 as "baseAmount",
        prior_usage_amount::float8 as "priorUsageAmount",adjustment_amount::float8 as "adjustmentAmount",
        taxable_subtotal::float8 as "taxableSubtotal",vat_rate_percent::float8 as "vatRatePercent",
        vat_amount::float8 as "vatAmount",
        total_amount::float8 as "totalAmount",
        currency,expires_at as "expiresAt",plan_snapshot as "plan",metadata
      from membership_payment_orders
      where driver_id=${driverId} and status in ('PENDING','PENDING_VERIFICATION') and expires_at>now()
      order by case when status='PENDING_VERIFICATION' then 0 else 1 end,created_at desc limit 1 for update
    `;
    if (existing) {
      if (Number((existing.metadata as Record<string, unknown> | undefined)?.tokenVersion) !== 1) {
        const rawToken = paymentOrderPublicToken(String(existing.id));
        await tx`
          update membership_payment_orders
          set public_token_hash=${sha256(rawToken)},
              metadata=metadata || '{"tokenVersion":1}'::jsonb,
              updated_at=now()
          where id=${existing.id}
        `;
        existing.metadata = { ...(existing.metadata as Record<string, unknown> | undefined), tokenVersion: 1 };
      }
      return { order: existing as Record<string, unknown>, reused: true };
    }

    const [settings] = await tx`select membership_qr_duration_hours as hours,vat_rate_percent::float8 as "vatRatePercent" from operational_settings where id=1`;
    const [plan] = await tx`select * from membership_plans where id=${input.planId} and enabled=true and effective_from<=now() and (effective_until is null or effective_until>now())`;
    if (!plan) throw new Error("MEMBERSHIP_PLAN_DISABLED");
    const [cycle] = await tx`
      select id,plan_type_snapshot,completed_trips,included_trips_snapshot,extra_trips,
        passenger_service_additional_snapshot::float8,
        extra_trip_share_percent_snapshot::float8,
        extra_trip_fee_snapshot::float8,
        raw_extra_amount::float8,billable_extra_amount::float8,
        adjustment_amount::float8,base_membership_amount_snapshot::float8,
        max_renewal_amount_snapshot::float8
      from driver_memberships where driver_id=${driverId} and cycle_closed_at is null
      order by created_at desc limit 1
    `;
    const usageAmount = money(Math.max(0, Number(cycle?.billable_extra_amount ?? 0)));
    const adjustmentAmount = money(Number(cycle?.adjustment_amount ?? 0));
    const planType = String(plan.plan_type ?? "PERIODIC");
    const tax = taxBreakdown(Math.max(0, Number(plan.base_amount) + usageAmount + adjustmentAmount), settings?.vatRatePercent ?? 0);
    const economicBreakdown = {
      baseAmount: money(Number(plan.base_amount)),
      planType,
      purchasedTrips: planType === "TRIP_PACK" ? Number(plan.included_trips) : undefined,
      packValidityDays: planType === "TRIP_PACK" ? (plan.pack_validity_days == null ? null : Number(plan.pack_validity_days)) : undefined,
      includedTrips: planType === "TRIP_PACK"
        ? Number(plan.included_trips ?? 0)
        : Number(cycle?.included_trips_snapshot ?? plan.included_trips ?? 0),
      completedTrips: Number(cycle?.completed_trips ?? 0),
      extraTrips: Number(cycle?.extra_trips ?? 0),
      passengerServiceAdditional: Number(cycle?.passenger_service_additional_snapshot ?? 0),
      extraTripSharePercent: Number(cycle?.extra_trip_share_percent_snapshot ?? plan.extra_trip_share_percent ?? 0),
      extraTripUnitAmount: Number(cycle?.extra_trip_fee_snapshot ?? 0),
      rawExtraAmount: Number(cycle?.raw_extra_amount ?? 0),
      maximumExtraAmount: money(Math.max(0,
        Number(cycle?.max_renewal_amount_snapshot ?? plan.max_renewal_amount ?? plan.base_amount) -
        Number(cycle?.base_membership_amount_snapshot ?? plan.base_amount))),
      billableExtraAmount: usageAmount,
      adjustmentAmount,
      subtotalAmount: tax.subtotal,
      vatRatePercent: tax.vatRatePercent,
      vatAmount: tax.vatAmount,
      totalAmount: tax.total
    };
    const orderId = randomUUID();
    const rawToken = paymentOrderPublicToken(orderId);
    const shortCode = randomBytes(5).toString("hex").toUpperCase();
    const [order] = await tx`
      insert into membership_payment_orders (
        id,public_token_hash,short_code,driver_id,membership_cycle_id,plan_id,plan_snapshot,
        base_amount,prior_usage_amount,adjustment_amount,taxable_subtotal,vat_rate_percent,vat_amount,total_amount,currency,intended_method,receiver_scope,
        verification_channel,status,expires_at,created_by,idempotency_key,metadata
      ) values (${orderId},${sha256(rawToken)},${shortCode},${driverId},${cycle?.id ?? null},${plan.id},
        ${JSON.stringify({ code: plan.code, name: plan.name, planType, durationDays: planType === "PERIODIC" ? plan.duration_days : null, includedTrips: plan.included_trips, purchasedTrips: planType === "TRIP_PACK" ? plan.included_trips : null, packValidityDays: planType === "TRIP_PACK" ? plan.pack_validity_days : null, maximumAmount: plan.max_renewal_amount, extraTripSharePercent: plan.extra_trip_share_percent })}::jsonb,
        ${plan.base_amount},${usageAmount},${adjustmentAmount},${tax.subtotal},${tax.vatRatePercent},${tax.vatAmount},${tax.total},${plan.currency},${input.intendedMethod ?? null},
        ${input.intendedMethod === "BANK_TRANSFER" ? "COSTA_GO_CENTRAL" : "NOT_APPLICABLE"},
        ${input.intendedMethod === "BANK_TRANSFER" ? "REMOTE_PROOF" : null},'PENDING',
        now()+(${Number(settings?.hours ?? 24)}*interval '1 hour'),${driverId},${input.idempotencyKey},
        ${JSON.stringify({ tokenVersion: 1, economicBreakdown })}::jsonb)
      returning id::text,status,short_code as "shortCode",base_amount::float8 as "baseAmount",
        prior_usage_amount::float8 as "priorUsageAmount",adjustment_amount::float8 as "adjustmentAmount",
        taxable_subtotal::float8 as "taxableSubtotal",vat_rate_percent::float8 as "vatRatePercent",
        vat_amount::float8 as "vatAmount",
        total_amount::float8 as "totalAmount",currency,expires_at as "expiresAt",plan_snapshot as "plan",metadata
    `;
    return { order: order as Record<string, unknown>, reused: false };
  });
  return { ...paymentOrderResult(result.order), reused: result.reused } as unknown as {
    id: string; status: string; shortCode: string; baseAmount: number; priorUsageAmount: number; adjustmentAmount: number;
    taxableSubtotal: number; vatRatePercent: number; vatAmount: number;
    totalAmount: number; currency: string; expiresAt: string; plan: Record<string, unknown>;
    token: string | null; qrUrl: string | null; reused: boolean;
  };
}

async function cancelPaymentOrder(
  driverId: string,
  orderId: string,
  input: z.infer<typeof paymentOrderCancellationSchema>
) {
  return database().begin(async tx => {
    const [order] = await tx`
      select id::text,status,cancellation_idempotency_key,short_code,total_amount::float8
      from membership_payment_orders
      where id=${orderId} and driver_id=${driverId}
      for update
    `;
    if (!order) throw new Error("PAYMENT_ORDER_NOT_FOUND");
    if (order.status === "CANCELLED" && order.cancellation_idempotency_key === input.idempotencyKey) {
      return { id: order.id, status: "CANCELLED", replay: true };
    }
    if (order.status !== "PENDING") throw new Error("PAYMENT_ORDER_NOT_CANCELLABLE");

    const invalidTokenHash = sha256(`cancelled:${orderId}:${randomUUID()}`);
    const [cancelled] = await tx`
      update membership_payment_orders
      set status='CANCELLED',cancelled_at=now(),cancelled_by=${driverId},
          cancellation_reason_code=${input.reason},
          cancellation_observation=${input.observation ?? null},
          cancellation_channel='MOBILE',
          cancellation_idempotency_key=${input.idempotencyKey},
          public_token_hash=${invalidTokenHash},
          metadata=metadata || ${JSON.stringify({ tokenInvalidated: true })}::jsonb,
          updated_at=now()
      where id=${orderId} and driver_id=${driverId} and status='PENDING'
      returning id::text,status,cancelled_at as "cancelledAt",
        cancellation_reason_code as "cancellationReason",
        cancellation_observation as "cancellationObservation"
    `;
    if (!cancelled) throw new Error("PAYMENT_ORDER_NOT_CANCELLABLE");
    await tx`
      insert into audit_log(actor_id,action,entity_type,entity_id,previous_value,next_value,reason)
      values (${driverId},'MEMBERSHIP_PAYMENT_ORDER_CANCELLED','MEMBERSHIP_PAYMENT_ORDER',${orderId},
        ${JSON.stringify({ status: String(order.status), shortCode: String(order.short_code), totalAmount: Number(order.total_amount) })}::jsonb,
        ${JSON.stringify({ status: "CANCELLED", reason: input.reason, observation: input.observation ?? null, channel: "MOBILE" })}::jsonb,
        ${input.observation ?? input.reason})
    `;
    return { ...cancelled, replay: false };
  });
}

async function processMembershipPayment(orderId: string, actor: SessionUser, input: {
  method: "CASH" | "DEUNA" | "BANK_TRANSFER" | "COURTESY";
  receiverScope: "COLLECTION_POINT" | "COSTA_GO_CENTRAL" | "NOT_APPLICABLE";
  verificationChannel: string;
  collectionPointId?: string;
  reference?: string;
  referenceHash?: string;
  referenceMasked?: string;
  referenceDisplay?: string;
  idempotencyKey: string;
}) {
  const result=await database().begin(async tx => {
    const [priorPayment] = await tx`select id::text,"status",membership_cycle_id::text as "membershipId" from membership_payments where idempotency_key=${input.idempotencyKey}`;
    if (priorPayment) return { alreadyProcessed: true, paymentId: priorPayment.id, membershipId: priorPayment.membershipId };
    const [orderOwner] = await tx`select driver_id from membership_payment_orders where id=${orderId}`;
    if (!orderOwner) throw new Error("PAYMENT_ORDER_NOT_FOUND");
    await lockMembershipBilling(tx, String(orderOwner.driver_id));
    const [order] = await tx`select * from membership_payment_orders where id=${orderId} for update`;
    if (!order) throw new Error("PAYMENT_ORDER_NOT_FOUND");
    if (order.status === "PAID") throw new Error("PAYMENT_ORDER_ALREADY_PAID");
    if (!["PENDING", "PENDING_VERIFICATION"].includes(String(order.status))) throw new Error("PAYMENT_ORDER_NOT_PAYABLE");
    if (new Date(String(order.expires_at)).getTime() <= Date.now()) {
      await tx`update membership_payment_orders set status='EXPIRED',updated_at=now() where id=${order.id}`;
      throw new Error("PAYMENT_ORDER_EXPIRED");
    }
    if(input.receiverScope==='COLLECTION_POINT')await requireOrderFiscalProfile(tx,'MEMBRESIA',orderId);
    const [plan] = await tx`select * from membership_plans where id=${order.plan_id}`;
    if (!plan) throw new Error("MEMBERSHIP_PLAN_DISABLED");
    const normalizedReference = input.reference ? normalizeReference(input.reference) : undefined;
    const referenceHash = input.referenceHash
      ?? (normalizedReference ? sha256(`${input.method}:${input.receiverScope}:${normalizedReference}`) : undefined);
    const referenceMasked = input.referenceMasked ?? (input.reference ? maskReference(input.reference) : undefined);
    const [payment] = await tx`
      insert into membership_payments (
        order_id,driver_id,collection_point_id,collector_id,method,receiver_scope,
        verification_channel,amount,currency,reference_normalized_hash,reference_masked,reference_display,
        settlement_status,confirmed_by,idempotency_key
      ) values (${order.id},${order.driver_id},${input.collectionPointId ?? null},${actor.id!},${input.method},
        ${input.receiverScope},${input.verificationChannel},${order.total_amount},${order.currency},
        ${referenceHash ?? null},
        ${referenceMasked ?? null},
        ${input.referenceDisplay ?? input.reference?.trim() ?? referenceMasked ?? null},
        ${input.receiverScope === "COLLECTION_POINT" ? "PENDING_SETTLEMENT" : "NOT_APPLICABLE"},
        ${actor.id!},${input.idempotencyKey})
      returning id::text
    `;
    if (!payment) throw new Error("PAYMENT_NOT_CREATED");
    const [current] = await tx`select * from driver_memberships where driver_id=${order.driver_id} and cycle_closed_at is null order by created_at desc limit 1 for update`;
    const planType = String(plan.plan_type ?? "PERIODIC");
    const currentPlanType = String(current?.plan_type_snapshot ?? "PERIODIC");
    const [price] = await tx`select platform_commission_cents_per_leg from pricing_versions where active_from<=now() and (active_until is null or active_until>now()) order by active_from desc limit 1`;
    const passengerAdditional = Number(price?.platform_commission_cents_per_leg ?? 5) / 100;
    const extraFee = Number((passengerAdditional * Number(plan.extra_trip_share_percent) / 100).toFixed(4));
    let membership: any;
    if (current && planType === "TRIP_PACK" && currentPlanType === "TRIP_PACK") {
      const configuredExpiry = plan.pack_validity_days == null
        ? null
        : new Date(Math.max(Date.now(), current.expires_at ? new Date(String(current.expires_at)).getTime() : 0) + Number(plan.pack_validity_days) * 86_400_000);
      [membership] = await tx`
        update driver_memberships set
          plan_id=${plan.id},plan_code=${plan.code},plan_snapshot=${order.plan_snapshot},plan_type_snapshot='TRIP_PACK',
          status='ACTIVE',expires_at=${configuredExpiry},expiration_local_date=${configuredExpiry},
          included_trips_snapshot=included_trips_snapshot+${Number(plan.included_trips)},
          base_membership_amount_snapshot=${plan.base_amount},extra_trip_fee_snapshot=0,
          extra_trip_share_percent_snapshot=0,max_renewal_amount_snapshot=${plan.base_amount},
          estimated_next_renewal_amount=0,extra_trips=0,raw_extra_amount=0,billable_extra_amount=0,
          exhausted_at=null,amount=amount+${order.total_amount},currency=${order.currency},payment_status='CONFIRMED',
          payment_method=${input.method},payment_reference=${input.referenceDisplay ?? input.reference?.trim() ?? referenceMasked ?? null},
          paid_at=now(),renewed_at=now(),renewal_order_id=${order.id},updated_by=${actor.id!},updated_at=now()
        where id=${current.id}
        returning id::text,expires_at as "expiresAt",status,included_trips_snapshot-completed_trips as "remainingTrips"
      `;
    } else {
      const baseDate = planType === "PERIODIC"
        ? Math.max(Date.now(), current?.expires_at ? new Date(String(current.expires_at)).getTime() : 0, current?.grace_ends_at ? new Date(String(current.grace_ends_at)).getTime() : 0)
        : Date.now();
      const expiresAt = planType === "PERIODIC"
        ? new Date(baseDate + Number(plan.duration_days) * 86_400_000)
        : plan.pack_validity_days == null ? null : new Date(baseDate + Number(plan.pack_validity_days) * 86_400_000);
      const closeReason = currentPlanType === planType ? "PAID_RENEWAL" : "PLAN_CHANGED";
      if (current) await tx`update driver_memberships set status='CLOSED',cycle_closed_at=now(),cycle_close_reason=${closeReason},final_renewal_amount=coalesce(final_renewal_amount,estimated_next_renewal_amount),renewal_order_id=${order.id},updated_at=now() where id=${current.id}`;
      [membership] = await tx`
        insert into driver_memberships (
          driver_id,plan_id,plan_code,status,starts_at,expires_at,expiration_local_date,
          suspension_timezone_snapshot,suspension_local_time_snapshot,previous_membership_cycle_id,
          plan_snapshot,plan_type_snapshot,cycle_duration_snapshot,base_membership_amount_snapshot,included_trips_snapshot,
          extra_trip_fee_snapshot,extra_trip_share_percent_snapshot,max_renewal_amount_snapshot,
          passenger_service_additional_snapshot,estimated_next_renewal_amount,payer_type,cooperative_id,
          amount,currency,payment_status,payment_method,payment_reference,paid_at,renewed_at,
          opening_payment_id,source,created_by,updated_by
        ) select ${order.driver_id},${plan.id},${plan.code},'ACTIVE',${new Date(baseDate)},
          ${expiresAt},${expiresAt},os.membership_timezone,os.membership_suspension_local_time,${current?.id ?? null},${order.plan_snapshot},
          ${planType},${planType === "PERIODIC" ? plan.duration_days : 0},${plan.base_amount},${plan.included_trips},${planType === "PERIODIC" ? extraFee : 0},${planType === "PERIODIC" ? plan.extra_trip_share_percent : 0},
          ${planType === "PERIODIC" ? plan.max_renewal_amount : plan.base_amount},${passengerAdditional},${planType === "PERIODIC" ? plan.base_amount : 0},'INDIVIDUAL',null,
          ${order.total_amount},${order.currency},'CONFIRMED',${input.method},${input.referenceDisplay ?? input.reference?.trim() ?? referenceMasked ?? null},
          now(),now(),${payment.id},'NORMAL',${actor.id!},${actor.id!}
        from operational_settings os where os.id=1 returning id::text,expires_at as "expiresAt",status,included_trips_snapshot-completed_trips as "remainingTrips"
      `;
    }
    if (!membership) throw new Error("MEMBERSHIP_NOT_CREATED");
    await tx`update membership_payments set membership_cycle_id=${membership.id} where id=${payment.id}`;
    await tx`update membership_payment_orders set status='PAID',paid_at=now(),updated_at=now() where id=${order.id}`;
    await tx`insert into audit_log(actor_id,action,entity_type,entity_id,next_value,reason) values (${actor.id!},'MEMBERSHIP_PAYMENT_CONFIRMED','MEMBERSHIP_PAYMENT',${payment.id},${JSON.stringify({ orderId: String(order.id), membershipId: membership.id, planType, method: input.method, amount: Number(order.total_amount) })}::jsonb,${planType === "TRIP_PACK" ? 'Pago verificado y viajes acreditados' : 'Pago verificado y membresía activada'})`;
    return { alreadyProcessed: false, paymentId: payment.id, membershipId: membership.id, expiresAt: membership.expiresAt };
  });
  if(!result.alreadyProcessed&&result.paymentId&&result.membershipId){
    try{
      await sendMembershipActivationConfirmation(String(result.paymentId),String(result.membershipId));
    }catch(error){
      console.error('membership_activation_notification_failed',{paymentId:result.paymentId,membershipId:result.membershipId,error});
    }
  }
  return result;
}

async function confirmCollectorPayment(orderId: string, actor: SessionUser, body: z.infer<typeof paymentConfirmSchema>) {
  const [assignment] = await database()`
    select cp.id,cp.status,cp.cash_enabled,cp.deuna_enabled,cp.bank_transfer_enabled
    from collector_assignments ca join collection_points cp on cp.id=ca.collection_point_id
    where ca.collector_id=${actor.id!} and ca.collection_point_id=${body.collectionPointId}
      and ca.starts_at<=now() and (ca.ends_at is null or ca.ends_at>now())
  `;
  if (!assignment || assignment.status !== "ACTIVE") throw new Error("COLLECTION_POINT_INACTIVE");
  const enabled = body.method === "CASH" ? assignment.cash_enabled : body.method === "DEUNA" ? assignment.deuna_enabled : assignment.bank_transfer_enabled;
  if (!enabled) throw new Error("PAYMENT_METHOD_DISABLED");
  return processMembershipPayment(orderId, actor, {
    method: body.method,
    receiverScope: "COLLECTION_POINT",
    verificationChannel: body.method === "CASH" ? "IN_PERSON" : "COLLECTION_POINT",
    collectionPointId: body.collectionPointId,
    reference: body.reference,
    idempotencyKey: body.idempotencyKey
  });
}

export async function membershipSchedulerTick(): Promise<void> {
  const [settings] = await database()`select membership_suspension_scheduler_enabled as enabled,membership_enforcement_enabled as enforcement from operational_settings where id=1`;
  if (!settings?.enabled || !settings?.enforcement) return;
  await database()`update membership_payment_orders set status='EXPIRED',updated_at=now() where status in ('PENDING','PENDING_VERIFICATION') and expires_at<=now()`;

  const expiring = await database()`
    update driver_memberships dm set status='EXPIRING',updated_at=now()
    from operational_settings os
    where os.id=1 and dm.cycle_closed_at is null and dm.status='ACTIVE'
      and dm.expires_at>now() and dm.expires_at<=now()+(os.membership_expiry_notice_days*interval '1 day')
    returning dm.id::text,dm.driver_id::text as "driverId",dm.expires_at as "expiresAt"
  `;
  for (const item of expiring) {
    if(await notificationPreferenceAllows(String(item.driverId),'DRIVER_MEMBERSHIP_REMINDERS'))
      void sendPush(item.driverId, "Tu membresía está próxima a vencer", `Renueva antes del ${new Date(String(item.expiresAt)).toLocaleDateString("es-EC", { timeZone: "America/Guayaquil" })} para seguir recibiendo solicitudes.`, { type: "MEMBERSHIP_EXPIRING", membershipId: item.id }).catch(() => undefined);
  }

  const expired = await database()`
    select dm.id::text,dm.driver_id::text as "driverId",dm.expires_at as "expiresAt",
      dm.cooperative_id::text as "cooperativeId",os.membership_grace_days::int as "defaultGraceDays",
      os.membership_grace_allows_trips as "defaultAllowsTrips",os.membership_timezone as timezone,
      os.membership_suspension_local_time::text as "suspensionTime"
    from driver_memberships dm cross join operational_settings os
    where os.id=1 and dm.cycle_closed_at is null and dm.status in ('ACTIVE','EXPIRING') and dm.expires_at<=now()
    order by dm.expires_at limit 100
  `;
  for (const item of expired) {
    const transition = await database().begin(async tx => {
      const [locked] = await tx`select id,status from driver_memberships where id=${item.id} for update`;
      if (!locked || !["ACTIVE", "EXPIRING"].includes(String(locked.status))) return;
      const [policy] = await tx`
        select gp.id::text,gp.grace_days::int as "graceDays",gp.allows_trips as "allowsTrips",gp.reason
        from membership_grace_policies gp
        where gp.status='ACTIVE' and gp.campaign_kind='RENEWAL' and gp.starts_at<=now() and gp.ends_at>now()
          and (gp.expiry_window_start is null or (${item.expiresAt} at time zone ${item.timezone})::date>=gp.expiry_window_start)
          and (gp.expiry_window_end is null or (${item.expiresAt} at time zone ${item.timezone})::date<=gp.expiry_window_end)
          and (gp.scope='ALL' or (gp.scope='COOPERATIVE' and gp.cooperative_id=${item.cooperativeId ?? null})
            or (gp.scope='DRIVER' and gp.driver_id=${item.driverId}))
        order by case gp.scope when 'DRIVER' then 3 when 'COOPERATIVE' then 2 else 1 end desc,gp.priority desc,gp.created_at desc limit 1
      `;
      const graceDays = Number(policy?.graceDays ?? item.defaultGraceDays ?? 0);
      const allowsTrips = Boolean(policy?.allowsTrips ?? item.defaultAllowsTrips);
      const [updated] = await tx`
        update driver_memberships set
          status=${graceDays > 0 ? "GRACE_PERIOD" : "PAYMENT_DUE"},
          expiration_local_date=(${item.expiresAt} at time zone ${item.timezone})::date,
          grace_ends_at=case when ${graceDays}>0 then ${item.expiresAt}::timestamptz+(${graceDays}*interval '1 day') else ${item.expiresAt}::timestamptz end,
          last_grace_local_date=((${item.expiresAt} at time zone ${item.timezone})::date+${graceDays}),
          suspension_at=(((${item.expiresAt} at time zone ${item.timezone})::date+${graceDays + 1})::date+${item.suspensionTime}::time) at time zone ${item.timezone},
          grace_policy_id=${policy?.id ?? null},grace_reason=${policy?.reason ?? "DEFAULT_RENEWAL_GRACE"},
          grace_days_applied=${graceDays},grace_allows_trips_applied=${graceDays > 0 && allowsTrips},updated_at=now()
        where id=${item.id} returning id::text,status,grace_ends_at as "graceEndsAt",suspension_at as "suspensionAt"
      `;
      return updated;
    });
    if (transition) {
      void sendPush(item.driverId, "Membresía pendiente de renovación", transition.status === "GRACE_PERIOD" ? "Tu período de gracia ya comenzó. Revisa la fecha límite en Costa-Go." : "Renueva tu membresía antes de la hora de suspensión.", { type: "MEMBERSHIP_PAYMENT_DUE", membershipId: item.id }).catch(() => undefined);
    }
  }
  const due = await database()`select id::text,driver_id::text as "driverId" from driver_memberships where cycle_closed_at is null and suspension_at is not null and suspension_at<=now() and status in ('GRACE_PERIOD','PAYMENT_DUE') order by suspension_at limit 100`;
  for (const item of due) {
    const outcome = await database().begin(async tx => {
      const [membership] = await tx`select status from driver_memberships where id=${item.id} for update`;
      if (!membership || !["GRACE_PERIOD", "PAYMENT_DUE"].includes(String(membership.status))) return;
      const [activeTrip] = await tx`select id from trips where driver_id=${item.driverId} and status in ${tx(ACTIVE_TRIP_STATES as unknown as string[])} limit 1`;
      const status = activeTrip ? "SUSPENSION_PENDING_ACTIVE_TRIP" : "SUSPENDED_NON_PAYMENT";
      await tx`update driver_memberships set status=${status},suspension_pending_active_trip=${Boolean(activeTrip)},suspended_non_payment_at=case when ${Boolean(activeTrip)} then suspended_non_payment_at else now() end,updated_at=now() where id=${item.id}`;
      if (!activeTrip) await tx`update drivers set is_available=false where user_id=${item.driverId}`;
      return status;
    });
    if (outcome) void sendPush(item.driverId, "Membresía Costa-Go", outcome === "SUSPENDED_NON_PAYMENT" ? "Tu membresía venció. Renueva para volver a recibir solicitudes." : "Finaliza tu viaje actual y renueva tu membresía.", { type: outcome, membershipId: item.id }).catch(() => undefined);
  }

  const pendingAfterTrip = await database()`
    select dm.id::text,dm.driver_id::text as "driverId" from driver_memberships dm
    where dm.cycle_closed_at is null and dm.status='SUSPENSION_PENDING_ACTIVE_TRIP'
      and not exists(select 1 from trips t where t.driver_id=dm.driver_id and t.status in ${database()(ACTIVE_TRIP_STATES as unknown as string[])})
    limit 100
  `;
  for (const item of pendingAfterTrip) {
    const [updated] = await database()`update driver_memberships set status='SUSPENDED_NON_PAYMENT',suspension_pending_active_trip=false,suspended_non_payment_at=now(),updated_at=now() where id=${item.id} and status='SUSPENSION_PENDING_ACTIVE_TRIP' returning id`;
    if (updated) {
      await database()`update drivers set is_available=false where user_id=${item.driverId}`;
      void sendPush(item.driverId, "Membresía vencida", "Tu viaje terminó y la recepción de nuevas solicitudes quedó pausada. Renueva para reconectarte.", { type: "MEMBERSHIP_SUSPENDED_NON_PAYMENT", membershipId: item.id }).catch(() => undefined);
    }
  }
}

function settingsProjection(row: any) {
  return {
    navigationPickupProvider: row.navigation_pickup_provider,
    navigationDestinationProvider: row.navigation_destination_provider,
    navigationPickupStartMode: row.navigation_pickup_start_mode,
    navigationDestinationStartMode: row.navigation_destination_start_mode,
    mobileCloudMapStyleEnabled: Boolean(row.mobile_cloud_map_style_enabled),
    textSearchMinimumCharacters: Number(row.text_search_minimum_characters),
    textSearchDebounceMilliseconds: Number(row.text_search_debounce_milliseconds),
    textSearchFreeCapReference: Number(row.text_search_free_cap_reference),
    textSearchPricePerThousandUsd: Number(row.text_search_price_per_thousand_usd),
    textSearchMonthlyBudgetUsd: Number(row.text_search_monthly_budget_usd),
    textSearchWarningPercent: Number(row.text_search_warning_percent),
    textSearchCriticalPercent: Number(row.text_search_critical_percent),
    textSearchHardLimitEnabled: Boolean(row.text_search_hard_limit_enabled),
    navigationFreeCapReference: Number(row.navigation_free_cap_reference),
    navigationPricePerThousandUsd: Number(row.navigation_price_per_thousand_usd),
    navigationWarningPercent: Number(row.navigation_warning_percent),
    navigationCriticalPercent: Number(row.navigation_critical_percent),
    routesFreeCapReference: Number(row.routes_free_cap_reference),
    routesPricePerThousandUsd: Number(row.routes_price_per_thousand_usd),
    geocodingFreeCapReference: Number(row.geocoding_free_cap_reference),
    geocodingPricePerThousandUsd: Number(row.geocoding_price_per_thousand_usd),
    driverMembershipsEnabled: Boolean(row.driver_memberships_enabled),
    membershipEnforcementEnabled: Boolean(row.membership_enforcement_enabled),
    membershipUsageBillingEnabled: Boolean(row.membership_usage_billing_enabled),
    membershipSuspensionSchedulerEnabled: Boolean(row.membership_suspension_scheduler_enabled),
    collectorPortalEnabled: Boolean(row.collector_portal_enabled),
    bankTransferEnabled: Boolean(row.bank_transfer_enabled),
    cashCollectionEnabled: Boolean(row.cash_collection_enabled),
    deunaCollectionEnabled: Boolean(row.deuna_collection_enabled),
    collectionPointSettlementsEnabled: Boolean(row.collection_point_settlements_enabled),
    collectionPointCommissionsEnabled: Boolean(row.collection_point_commissions_enabled),
    collectionPointLimitsEnabled: Boolean(row.collection_point_limits_enabled),
    financeRoleEnabled: Boolean(row.finance_role_enabled),
    membershipExpiryNoticeDays: Number(row.membership_expiry_notice_days),
    membershipGraceDays: Number(row.membership_grace_days),
    membershipGraceAllowsTrips: Boolean(row.membership_grace_allows_trips),
    membershipSuspensionLocalTime: String(row.membership_suspension_local_time).slice(0,5),
    membershipTimezone: row.membership_timezone,
    newDriverGraceEnabled: Boolean(row.new_driver_grace_enabled),
    newDriverGraceDurationHours: Number(row.new_driver_grace_duration_hours),
    newDriverGraceAllowsTrips: Boolean(row.new_driver_grace_allows_trips),
    newDriverGraceMaxGrants: Number(row.new_driver_grace_max_grants),
    membershipExtraTripSharePercent: Number(row.membership_extra_trip_share_percent),
    membershipQrDurationHours: Number(row.membership_qr_duration_hours),
    advertisingRotationSeconds: Number(row.advertising_rotation_seconds),
    advertisingMaxActivePerZone: Number(row.advertising_max_active_per_zone)
  };
}

function businessError(error: unknown, reply: FastifyReply) {
  if(error instanceof Error&&error.message==='FISCAL_PROFILE_REQUIRED')return reply.code(400).send({error:error.message,message:'Registra los datos de facturación antes de confirmar el pago.'});
  if (error instanceof z.ZodError) return reply.code(400).send({ error: "INVALID_DATA", details: error.issues });
  const message = error instanceof Error ? error.message : "ERROR";
  const conflict = [
    "PAYMENT_ORDER_ALREADY_PAID", "PAYMENT_ORDER_NOT_PAYABLE",
    "PAYMENT_ORDER_NOT_CANCELLABLE",
    "TRANSFER_PROOF_ALREADY_SUBMITTED",
    "PAYMENT_REFERENCE_ALREADY_USED", "MEMBERSHIP_PLAN_CODE_EXISTS",
    "MEMBERSHIP_PLAN_NOT_CURRENT"
  ];
  const notFound = ["PAYMENT_ORDER_NOT_FOUND", "MEMBERSHIP_PLAN_NOT_FOUND"];
  const badRequest = [
    "PAYMENT_ORDER_EXPIRED", "MEMBERSHIP_PLAN_DISABLED", "PAYMENT_AMOUNT_MISMATCH",
    "INVALID_CSV_QUOTES", "INVALID_CSV_ENCODING", "INVALID_CSV_HEADERS", "EMPTY_CSV",
    "MEMBERSHIP_REQUIRED", "MEMBERSHIP_NOT_CREATED", "PAYMENT_NOT_CREATED",
    "COLLECTION_POINT_INACTIVE", "PAYMENT_METHOD_DISABLED", "MAXIMUM_BELOW_BASE",
    "TRIP_PACK_REQUIRES_CREDITS", "MEMBERSHIP_EXHAUSTED"
  ];
  if (message === "NO_PAYMENTS_TO_CLOSE") return reply.code(409).send({
    error: message,
    message: "No hay cobros pendientes para cerrar en la jornada seleccionada."
  });
  if (message === "FUTURE_CLOSURE_DATE") return reply.code(400).send({
    error: message,
    message: "No se puede cerrar una jornada futura."
  });
  if (conflict.includes(message)) return reply.code(409).send({ error: message });
  if (notFound.includes(message)) return reply.code(404).send({ error: message });
  if (badRequest.includes(message)) return reply.code(400).send({ error: message });
  if (["UNAUTHORIZED", "FORBIDDEN"].includes(message)) return reply.code(message === "UNAUTHORIZED" ? 401 : 403).send({ error: message });
  throw error;
}

export async function registerMembershipRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/mobile/config", async (request, reply) => {
    const user = await requireMobileUser(request, reply); if (!user) return;
    const [row] = await database()`select * from operational_settings where id=1`;
    const config = settingsProjection(row);
    return {
      navigation: {
        pickupProvider: config.navigationPickupProvider,
        destinationProvider: config.navigationDestinationProvider,
        pickupStartMode: config.navigationPickupStartMode,
        destinationStartMode: config.navigationDestinationStartMode,
        mobileCloudMapStyleEnabled: config.mobileCloudMapStyleEnabled
      },
      places: {
        minimumCharacters: config.textSearchMinimumCharacters,
        debounceMilliseconds: config.textSearchDebounceMilliseconds
      },
      memberships: { enabled: config.driverMembershipsEnabled }
    };
  });

  app.post("/v1/usage-events", async (request, reply) => {
    const user = await requireMobileUser(request, reply); if (!user) return;
    const parsed = usageSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_USAGE_EVENT" });
    const body = parsed.data;
    await database()`
      insert into api_usage_events(provider,environment,billing_period,trip_id,user_id,service_area_id,
        cooperative_id,phase,session_key_hash,request_key,result,metadata)
      values (${body.provider},${process.env.NODE_ENV === "production" ? "PRODUCTION" : "TEST"},date_trunc('month',now())::date,
        ${body.tripId ?? null},${user.id!},${body.serviceAreaId ?? null},${user.cooperativeId ?? null},${body.phase ?? null},
        ${body.sessionKey ? sha256(body.sessionKey) : null},${body.requestKey},${body.result ?? null},${JSON.stringify(body.metadata ?? {})}::jsonb)
      on conflict(provider,request_key) do nothing
    `;
    return reply.code(202).send({ recorded: true });
  });

  app.get("/v1/driver/membership", async (request, reply) => {
    const user = await requireMobileUser(request, reply, "DRIVER"); if (!user) return;
    const membership = await currentMembership(user.id!);
    const eligibility = await driverMembershipEligibility(user.id!);
    const [plans, pendingOrder, settingsRows] = await Promise.all([
      database()`select id::text,code,name,plan_type as "planType",base_amount::float8 as amount,currency,
        case when plan_type='PERIODIC' then duration_days end as "durationDays",
        included_trips as "includedTrips",pack_validity_days as "packValidityDays",
        max_renewal_amount::float8 as "maximumAmount"
        from membership_plans where enabled=true and effective_from<=now() and (effective_until is null or effective_until>now())
        order by case when plan_type='PERIODIC' then 0 else 1 end,duration_days,included_trips`,
      activePaymentOrder(user.id!),
      database()`select vat_rate_percent::float8 as "vatRatePercent" from operational_settings where id=1`
    ]);
    const vatRatePercent = Number(settingsRows[0]?.vatRatePercent ?? 0);
    const pricedPlans = plans.map(plan => ({ ...plan, ...taxBreakdown(plan.amount, vatRatePercent) }));
    const renewalTax = taxBreakdown(membership?.estimatedNextRenewalAmount ?? 0, vatRatePercent);
    return {
      membership: membership ? { ...membership, estimatedRenewalTax: renewalTax } : { status: "PENDING" },
      eligibility,
      plans: pricedPlans,
      pendingOrder,
      tax: { vatRatePercent, pricesIncludeVat: false }
    };
  });

  app.get("/v1/driver/membership/collection-points", async (request, reply) => {
    const user = await requireMobileUser(request, reply, "DRIVER"); if (!user) return;
    try {
      const location = collectionPointDirectoryQuerySchema.parse(request.query);
      const rows = await database()`select cp.id::text,cp.code,cp.name,cp.address,cp.reference,cp.phone,cp.whatsapp,cp.email,cp.latitude::float8,cp.longitude::float8,cp.display_order as "displayOrder",cp.timezone,coalesce((select jsonb_agg(jsonb_build_object('dayOfWeek',s.day_of_week,'opensAt',to_char(s.opens_at,'HH24:MI'),'closesAt',to_char(s.closes_at,'HH24:MI'),'closed',s.closed) order by s.day_of_week) from collection_point_schedules s where s.collection_point_id=cp.id),'[]'::jsonb) as schedules from collection_points cp where cp.status='ACTIVE' and cp.cash_enabled=true order by cp.display_order,cp.name`;
      return rows.map(row => {
        const schedules = Array.isArray(row.schedules) ? row.schedules as Array<Record<string,unknown>> : [];
        const latitude = row.latitude == null ? null : Number(row.latitude);
        const longitude = row.longitude == null ? null : Number(row.longitude);
        const distanceKm = location.latitude != null && location.longitude != null && latitude != null && longitude != null
          ? haversineKm(location.latitude, location.longitude, latitude, longitude) : null;
        return { ...row, ...localScheduleState(schedules, String(row.timezone ?? "America/Guayaquil")), distanceKm: distanceKm == null ? null : Math.round(distanceKm * 10) / 10 };
      });
    } catch (error) { return businessError(error, reply); }
  });

  app.get("/v1/driver/membership/payment-account", async (request, reply) => {
    const user = await requireMobileUser(request, reply, "DRIVER"); if (!user) return;
    const [account] = await database()`select id::text,bank_name as "bankName",account_type_name as "accountType",account_identifier_public as "accountIdentifier",account_last_four as "accountLastFour",holder_name as "holderName",holder_identification_public as "holderIdentification",support_email as "supportEmail" from costa_go_payment_accounts where enabled=true and remote_payments_enabled=true and account_type='BANK_ACCOUNT' order by updated_at desc limit 1`;
    if (!account) return reply.code(404).send({ error:"PAYMENT_ACCOUNT_NOT_CONFIGURED" });
    return account;
  });

  app.get("/v1/driver/membership/history", async (request, reply) => {
    const user = await requireMobileUser(request, reply, "DRIVER"); if (!user) return;
    return database()`select id::text,plan_code as "planCode",plan_type_snapshot as "planType",status,starts_at as "startsAt",expires_at as "expiresAt",completed_trips as "completedTrips",included_trips_snapshot as "includedTrips",greatest(0,included_trips_snapshot-completed_trips) as "remainingTrips",extra_trips as "extraTrips",final_renewal_amount::float8 as "finalAmount",estimated_next_renewal_amount::float8 as "estimatedAmount",currency,cycle_closed_at as "closedAt" from driver_memberships where driver_id=${user.id!} order by created_at desc limit 100`;
  });

  app.get("/v1/driver/membership/payments", async (request, reply) => {
    const user = await requireMobileUser(request, reply, "DRIVER"); if (!user) return;
    return database()`select p.id::text,p.amount::float8,p.currency,p.method,p.status,p.confirmed_at as "confirmedAt",o.plan_snapshot as "plan",o.taxable_subtotal::float8 as "subtotalAmount",o.vat_rate_percent::float8 as "vatRatePercent",o.vat_amount::float8 as "vatAmount",p.reference_masked as "reference" from membership_payments p join membership_payment_orders o on o.id=p.order_id where p.driver_id=${user.id!} order by p.confirmed_at desc limit 100`;
  });

  app.get("/v1/driver/membership/payment-orders", async (request, reply) => {
    const user = await requireMobileUser(request, reply, "DRIVER"); if (!user) return;
    const rows = await database()`
      select id::text,status,short_code as "shortCode",plan_snapshot as plan,
        base_amount::float8 as "baseAmount",prior_usage_amount::float8 as "priorUsageAmount",
        adjustment_amount::float8 as "adjustmentAmount",taxable_subtotal::float8 as "taxableSubtotal",
        vat_rate_percent::float8 as "vatRatePercent",vat_amount::float8 as "vatAmount",total_amount::float8 as "totalAmount",
        currency,expires_at as "expiresAt",paid_at as "paidAt",cancelled_at as "cancelledAt",
        cancellation_reason_code as "cancellationReason",
        cancellation_observation as "cancellationObservation",created_at as "createdAt",metadata
      from membership_payment_orders
      where driver_id=${user.id!}
      order by created_at desc limit 100
    `;
    return rows.map(row => paymentOrderResult(row as Record<string, unknown>));
  });

  app.post("/v1/driver/membership/payment-orders", async (request, reply) => {
    const user = await requireMobileUser(request, reply, "DRIVER"); if (!user) return;
    try {
      const input = paymentOrderSchema.parse(request.body);
      return reply.code(201).send(await createPaymentOrder(user.id!, input));
    } catch (error) { return businessError(error, reply); }
  });

  app.get("/v1/driver/membership/payment-orders/:id", async (request, reply) => {
    const user = await requireMobileUser(request, reply, "DRIVER"); if (!user) return;
    const id = (request.params as { id: string }).id;
    const [order] = await database()`select id::text,status,short_code as "shortCode",plan_snapshot as plan,base_amount::float8 as "baseAmount",prior_usage_amount::float8 as "priorUsageAmount",adjustment_amount::float8 as "adjustmentAmount",taxable_subtotal::float8 as "taxableSubtotal",vat_rate_percent::float8 as "vatRatePercent",vat_amount::float8 as "vatAmount",total_amount::float8 as "totalAmount",currency,expires_at as "expiresAt",paid_at as "paidAt",cancelled_at as "cancelledAt",cancellation_reason_code as "cancellationReason",cancellation_observation as "cancellationObservation",created_at as "createdAt",metadata from membership_payment_orders where id=${id} and driver_id=${user.id!}`;
    if (!order) return reply.code(404).send({ error: "PAYMENT_ORDER_NOT_FOUND" });
    return Number((order.metadata as Record<string, unknown> | undefined)?.tokenVersion) === 1 ? paymentOrderResult(order as Record<string, unknown>) : order;
  });

  app.post("/v1/driver/membership/payment-orders/:id/cancel", async (request, reply) => {
    const user = await requireMobileUser(request, reply, "DRIVER"); if (!user) return;
    try {
      const id = (request.params as { id: string }).id;
      const input = paymentOrderCancellationSchema.parse(request.body);
      return await cancelPaymentOrder(user.id!, id, input);
    } catch (error) { return businessError(error, reply); }
  });

  app.post("/v1/driver/membership/payment-orders/:id/transfer-proof", async (request, reply) => {
    const user = await requireMobileUser(request, reply, "DRIVER"); if (!user) return;
    try {
      const body = transferProofSchema.parse(request.body);
      const id = (request.params as { id: string }).id;
      const data = Buffer.from(body.fileBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
      if (data.length < 100 || data.length > 5_242_880 || !validFileSignature(data, body.fileMime)) {
        return reply.code(400).send({ error: "INVALID_TRANSFER_PROOF" });
      }
      const normalized = normalizeReference(body.reference);
      const [proof] = await database().begin(async tx => {
        const [order] = await tx`select id,total_amount,status,expires_at from membership_payment_orders where id=${id} and driver_id=${user.id!} for update`;
        if (!order) throw new Error("PAYMENT_ORDER_NOT_FOUND");
        if (order.status !== "PENDING") throw new Error("PAYMENT_ORDER_NOT_PAYABLE");
        if (new Date(String(order.expires_at)).getTime() <= Date.now()) throw new Error("PAYMENT_ORDER_EXPIRED");
        if (money(order.total_amount) !== money(body.declaredAmount)) throw new Error("PAYMENT_AMOUNT_MISMATCH");
        await requireOrderFiscalProfile(tx,'MEMBRESIA',id);
        const [existingProof] = await tx`select id from membership_transfer_proofs where order_id=${id} and status in ('PENDING','APPROVED') limit 1`;
        if (existingProof) throw new Error("TRANSFER_PROOF_ALREADY_SUBMITTED");
        const [created] = await tx`insert into membership_transfer_proofs(order_id,bank_name,reference_normalized_hash,reference_masked,reference_display,transfer_date,declared_amount,file_mime,file_data,observation) values (${id},${body.bankName},${sha256(normalized)},${maskReference(body.reference)},${body.reference.trim()},${body.transferDate},${body.declaredAmount},${body.fileMime},${data},${body.observation ?? null}) returning id::text,status`;
        await tx`update membership_payment_orders set status='PENDING_VERIFICATION',receiver_scope='COSTA_GO_CENTRAL',verification_channel='REMOTE_PROOF',updated_at=now() where id=${id}`;
        return [created];
      });
      const [recipient] = await database()`select u.email,u.full_name as name,o.short_code as code,o.total_amount::float8 as amount,o.currency,o.plan_snapshot as plan from membership_payment_orders o join users u on u.id=o.driver_id where o.id=${id}`;
      const recipientPlan = (recipient?.plan ?? {}) as Record<string, unknown>;
      const recipientPlanDescription = recipientPlan.planType === "TRIP_PACK"
        ? `plan por viajes de ${Number(recipientPlan.purchasedTrips ?? recipientPlan.includedTrips ?? 0)} viajes`
        : `plan por período ${String(recipientPlan.name ?? "Costa-Go")}`;
      if (recipient?.email) void sendTransactionalEmail({
        to:String(recipient.email),subject:"Comprobante recibido — Orden "+String(recipient.code),
        text:`Hola ${recipient.name}. Recibimos el comprobante de la orden ${recipient.code}, correspondiente al ${recipientPlanDescription}, por ${recipient.currency} ${Number(recipient.amount).toFixed(2)}. Será revisado y te notificaremos el resultado.`,
        html:renderCostaGoEmail({title:'Comprobante recibido',greeting:String(recipient.name),
          lead:'Recibimos correctamente el comprobante de tu transferencia. Revisaremos tu pago y te notificaremos cuando sea aprobado o rechazado.',
          badge:{label:'En revisión',tone:'warning'},rows:[
            {label:'Orden',value:String(recipient.code),emphasis:true},{label:'Concepto',value:recipientPlanDescription},
            {label:'Método',value:'Transferencia bancaria'},{label:'Total',value:`${recipient.currency} ${Number(recipient.amount).toFixed(2)}`,emphasis:true},
            {label:'Estado',value:'En revisión'}],
          notice:{title:'Tu información está protegida',text:'No necesitas responder este correo.',tone:'info'},
          primaryAction:{label:'Ver mi pago',url:'costa-go://membership'},secondaryAction:{label:'Abrir Costa-Go',url:'costa-go://membership'}})
      }).catch(()=>false);
      void sendPush(user.id!,"Comprobante recibido","Tu pago será revisado. Te notificaremos cuando finalice el proceso.",{type:"MEMBERSHIP_PAYMENT_REVIEW",orderId:id}).catch(()=>undefined);
      return reply.code(201).send(proof);
    } catch (error) { return businessError(error, reply); }
  });

  app.get("/v1/admin/platform-settings", async (request, reply) => { try {
    requirePermission(request, "settings:view");
    const [row] = await database()`select * from operational_settings where id=1`;
    return settingsProjection(row);
  } catch (error) { return businessError(error, reply); } });

  app.patch("/v1/admin/platform-settings", async (request, reply) => { try {
    const actor = requirePermission(request, "settings:manage");
    const value = platformSettingsSchema.parse(request.body);
    const [previous] = await database()`select * from operational_settings where id=1`;
    await database()`update operational_settings set
      navigation_pickup_provider=${value.navigationPickupProvider},navigation_destination_provider=${value.navigationDestinationProvider},
      navigation_pickup_start_mode=${value.navigationPickupStartMode},navigation_destination_start_mode=${value.navigationDestinationStartMode},
      mobile_cloud_map_style_enabled=${value.mobileCloudMapStyleEnabled},text_search_minimum_characters=${value.textSearchMinimumCharacters},
      text_search_debounce_milliseconds=${value.textSearchDebounceMilliseconds},text_search_free_cap_reference=${value.textSearchFreeCapReference},
      text_search_price_per_thousand_usd=${value.textSearchPricePerThousandUsd},text_search_monthly_budget_usd=${value.textSearchMonthlyBudgetUsd},
      text_search_warning_percent=${value.textSearchWarningPercent},text_search_critical_percent=${value.textSearchCriticalPercent},
      text_search_hard_limit_enabled=${value.textSearchHardLimitEnabled},navigation_free_cap_reference=${value.navigationFreeCapReference},
      navigation_price_per_thousand_usd=${value.navigationPricePerThousandUsd},
      navigation_warning_percent=${value.navigationWarningPercent},navigation_critical_percent=${value.navigationCriticalPercent},
      routes_free_cap_reference=${value.routesFreeCapReference},routes_price_per_thousand_usd=${value.routesPricePerThousandUsd},
      geocoding_free_cap_reference=${value.geocodingFreeCapReference},geocoding_price_per_thousand_usd=${value.geocodingPricePerThousandUsd},
      driver_memberships_enabled=${value.driverMembershipsEnabled},membership_enforcement_enabled=${value.membershipEnforcementEnabled},
      membership_usage_billing_enabled=${value.membershipUsageBillingEnabled},membership_suspension_scheduler_enabled=${value.membershipSuspensionSchedulerEnabled},
      collector_portal_enabled=${value.collectorPortalEnabled},bank_transfer_enabled=${value.bankTransferEnabled},
      cash_collection_enabled=${value.cashCollectionEnabled},deuna_collection_enabled=${value.deunaCollectionEnabled},
      collection_point_settlements_enabled=${value.collectionPointSettlementsEnabled},collection_point_commissions_enabled=${value.collectionPointCommissionsEnabled},
      collection_point_limits_enabled=${value.collectionPointLimitsEnabled},finance_role_enabled=${value.financeRoleEnabled},
      membership_expiry_notice_days=${value.membershipExpiryNoticeDays},membership_grace_days=${value.membershipGraceDays},
      membership_grace_allows_trips=${value.membershipGraceAllowsTrips},membership_suspension_local_time=${value.membershipSuspensionLocalTime},
      membership_timezone=${value.membershipTimezone},new_driver_grace_enabled=${value.newDriverGraceEnabled},
      new_driver_grace_duration_hours=${value.newDriverGraceDurationHours},new_driver_grace_allows_trips=${value.newDriverGraceAllowsTrips},
      new_driver_grace_max_grants=${value.newDriverGraceMaxGrants},membership_extra_trip_share_percent=${value.membershipExtraTripSharePercent},
      membership_qr_duration_hours=${value.membershipQrDurationHours},advertising_rotation_seconds=${value.advertisingRotationSeconds},
      advertising_max_active_per_zone=${value.advertisingMaxActivePerZone},updated_by=${actor.id!},updated_at=now() where id=1`;
    await database()`insert into audit_log(actor_id,action,entity_type,entity_id,previous_value,next_value,reason) values (${actor.id!},'PLATFORM_SETTINGS_UPDATED','SETTINGS','1',${JSON.stringify(settingsProjection(previous))}::jsonb,${JSON.stringify(value)}::jsonb,'Configuración operativa actualizada')`;
    return value;
  } catch (error) { return businessError(error, reply); } });

  app.get("/v1/admin/membership-plans", async (request, reply) => { try {
    requirePermission(request, "memberships:view");
    return database()`select id::text,code,version,name,plan_type as "planType",period_unit as "periodUnit",period_count as "periodCount",duration_days as "durationDays",base_amount::float8 as "baseAmount",currency,included_trips as "includedTrips",pack_validity_days as "packValidityDays",max_renewal_amount::float8 as "maxRenewalAmount",extra_trip_share_percent::float8 as "extraTripSharePercent",enabled,effective_from as "effectiveFrom",effective_until as "effectiveUntil",(enabled=true and effective_from<=now() and effective_until is null) as "current" from membership_plans order by plan_type,code,version desc`;
  } catch (error) { return businessError(error, reply); } });

  app.post("/v1/admin/membership-plans", async (request, reply) => { try {
    const actor = requirePermission(request, "membership_plans:manage");
    const body = planSchema.parse(request.body);
    const [existing] = await database()`select id from membership_plans where code=${body.code} limit 1`;
    if (existing) throw new Error("MEMBERSHIP_PLAN_CODE_EXISTS");
    const [plan] = await database()`insert into membership_plans(code,version,name,plan_type,period_unit,period_count,duration_days,base_amount,currency,included_trips,pack_validity_days,max_renewal_amount,extra_trip_share_percent,enabled,effective_from,created_by,updated_by) values (${body.code},1,${body.name},${body.planType},${body.periodUnit},${body.periodCount},${body.durationDays},${body.baseAmount},${body.currency.toUpperCase()},${body.includedTrips},${body.planType === "TRIP_PACK" ? body.packValidityDays ?? null : null},${body.planType === "TRIP_PACK" ? body.baseAmount : body.maxRenewalAmount},${body.planType === "TRIP_PACK" ? 0 : body.extraTripSharePercent},${body.enabled},${body.effectiveFrom ?? new Date()},${actor.id!},${actor.id!}) returning id::text,code,version,name,plan_type as "planType"`;
    if (!plan) throw new Error("MEMBERSHIP_PLAN_NOT_CREATED");
    await persistAudit(actor,"MEMBERSHIP_PLAN_CREATED","MEMBERSHIP_PLAN",plan.id,body.code);
    return reply.code(201).send(plan);
  } catch (error) { return businessError(error, reply); } });

  app.post("/v1/admin/membership-plans/:planId/versions", async (request, reply) => { try {
    const actor = requirePermission(request, "membership_plans:manage");
    const planId = (request.params as { planId: string }).planId;
    const body = planVersionSchema.parse(request.body);
    const next = await database().begin(async tx => {
      const [previous] = await tx`select * from membership_plans where id=${planId} for update`;
      if (!previous) throw new Error("MEMBERSHIP_PLAN_NOT_FOUND");
      if (!previous.enabled || previous.effective_until) throw new Error("MEMBERSHIP_PLAN_NOT_CURRENT");
      if (previous.plan_type === "PERIODIC" && body.maxRenewalAmount < body.baseAmount) throw new Error("MAXIMUM_BELOW_BASE");
      if (previous.plan_type === "TRIP_PACK" && body.includedTrips < 1) throw new Error("TRIP_PACK_REQUIRES_CREDITS");
      const changedAt = new Date();
      await tx`update membership_plans set enabled=false,effective_until=${changedAt},updated_by=${actor.id!},updated_at=${changedAt} where id=${planId}`;
      const [created] = await tx`insert into membership_plans(code,version,name,plan_type,period_unit,period_count,duration_days,base_amount,currency,included_trips,pack_validity_days,max_renewal_amount,extra_trip_share_percent,enabled,effective_from,created_by,updated_by) values (${previous.code},${Number(previous.version) + 1},${body.name},${previous.plan_type},${body.periodUnit},${body.periodCount},${body.durationDays},${body.baseAmount},${body.currency.toUpperCase()},${body.includedTrips},${previous.plan_type === "TRIP_PACK" ? body.packValidityDays ?? null : null},${previous.plan_type === "TRIP_PACK" ? body.baseAmount : body.maxRenewalAmount},${previous.plan_type === "TRIP_PACK" ? 0 : body.extraTripSharePercent},true,${changedAt},${actor.id!},${actor.id!}) returning id::text,code,version,name,plan_type as "planType"`;
      return created;
    });
    if (!next) throw new Error("MEMBERSHIP_PLAN_NOT_CREATED");
    await persistAudit(actor,"MEMBERSHIP_PLAN_VERSION_CREATED","MEMBERSHIP_PLAN",next.id,`${next.code} v${next.version}; reemplaza ${planId}`);
    return reply.code(201).send(next);
  } catch (error) { return businessError(error, reply); } });

  app.post("/v1/admin/membership-plans/:planId/deactivate", async (request, reply) => { try {
    const actor = requirePermission(request, "membership_plans:manage");
    const planId = (request.params as { planId: string }).planId;
    const reason = z.object({ reason: z.string().trim().min(5).max(500) }).parse(request.body).reason;
    const [plan] = await database()`update membership_plans set enabled=false,effective_until=coalesce(effective_until,now()),updated_by=${actor.id!},updated_at=now() where id=${planId} and enabled=true and effective_until is null returning id::text,code,version`;
    if (!plan) throw new Error("MEMBERSHIP_PLAN_NOT_CURRENT");
    await persistAudit(actor,"MEMBERSHIP_PLAN_DEACTIVATED","MEMBERSHIP_PLAN",plan.id,`${plan.code} v${plan.version}: ${reason}`);
    return plan;
  } catch (error) { return businessError(error, reply); } });

  app.get("/v1/admin/memberships", async (request, reply) => { try {
    requirePermission(request, "memberships:view");
    const query = z.object({ insight: z.enum(["active","expiring7Days","grace","expired","suspended"]).optional(), status: membershipStatusSchema.optional(), cooperativeId: z.string().uuid().optional(), search: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }).parse(request.query);
    const offset=(query.page-1)*query.limit;
    const rows=await database()`select dm.id::text,dm.driver_id::text as "driverId",u.full_name as driver,u.email,u.phone_e164 as phone,c.name as cooperative,dm.plan_code as plan,dm.plan_type_snapshot as "planType",dm.status,dm.starts_at as "startsAt",dm.expires_at as "expiresAt",dm.grace_ends_at as "graceEndsAt",dm.suspension_at as "suspensionAt",dm.completed_trips as "completedTrips",dm.included_trips_snapshot as "includedTrips",greatest(0,dm.included_trips_snapshot-dm.completed_trips) as "remainingTrips",dm.extra_trips as "extraTrips",dm.billable_extra_amount::float8 as "extraAmount",dm.estimated_next_renewal_amount::float8 as "estimatedRenewal",dm.currency,dm.payer_type as "payerType",count(*) over()::int as total from driver_memberships dm join users u on u.id=dm.driver_id left join cooperatives c on c.id=dm.cooperative_id where u.deleted_at is null and dm.cycle_closed_at is null and (${query.status ?? null}::text is null or dm.status=${query.status ?? null}) and (${query.insight??null}::text is null or (${query.insight??null}='active' and dm.status in ('ACTIVE','EXPIRING')) or (${query.insight??null}='expiring7Days' and dm.expires_at between now() and now()+interval '7 days') or (${query.insight??null}='grace' and dm.status='GRACE_PERIOD') or (${query.insight??null}='expired' and dm.status in ('PAYMENT_DUE','SUSPENDED_NON_PAYMENT','EXHAUSTED')) or (${query.insight??null}='suspended' and dm.status in ('SUSPENDED','SUSPENDED_NON_PAYMENT'))) and (${query.cooperativeId ?? null}::uuid is null or dm.cooperative_id=${query.cooperativeId ?? null}) and (${query.search ?? null}::text is null or u.full_name ilike ${query.search ? `%${query.search}%` : null} or u.email ilike ${query.search ? `%${query.search}%` : null} or u.phone_e164 ilike ${query.search ? `%${query.search}%` : null}) order by dm.expires_at nulls first,u.full_name limit ${query.limit} offset ${offset}`;
    return { items: rows, page: query.page, limit: query.limit, total: Number(rows[0]?.total ?? 0) };
  } catch (error) { return businessError(error, reply); } });

  app.get("/v1/admin/memberships/dashboard", async (request, reply) => { try {
    requirePermission(request,"memberships:view");
    const [summary]=await database()`select count(*) filter(where status in ('ACTIVE','EXPIRING'))::int as active,count(*) filter(where expires_at between now() and now()+interval '7 days')::int as "expiring7Days",count(*) filter(where status='GRACE_PERIOD')::int as grace,count(*) filter(where status in ('PAYMENT_DUE','SUSPENDED_NON_PAYMENT'))::int as expired,count(*) filter(where status in ('SUSPENDED','SUSPENDED_NON_PAYMENT'))::int as suspended,count(*) filter(where payer_type='COOPERATIVE')::int as cooperatives,count(*) filter(where payer_type='INDIVIDUAL')::int as individual,count(*) filter(where status='PENDING')::int as pending from driver_memberships where cycle_closed_at is null and exists(select 1 from users u where u.id=driver_memberships.driver_id and u.deleted_at is null)`;
    const [income]=await database()`select coalesce(sum(amount),0)::float8 as amount,count(*)::int as payments from membership_payments where status='CONFIRMED' and method<>'COURTESY' and confirmed_at>=date_trunc('month',now())`;
    return { ...summary, confirmedIncomeMonth: Number(income?.amount ?? 0), confirmedPaymentsMonth: Number(income?.payments ?? 0) };
  } catch(error){return businessError(error,reply);} });

  app.get("/v1/admin/memberships/:driverId/history", async (request, reply) => { try {
    requirePermission(request,"memberships:view"); const driverId=(request.params as {driverId:string}).driverId;
    const memberships=await database()`select id::text,plan_code as plan,status,starts_at as "startsAt",expires_at as "expiresAt",completed_trips as "completedTrips",extra_trips as "extraTrips",raw_extra_amount::float8 as "rawExtra",billable_extra_amount::float8 as "billableExtra",adjustment_amount::float8 as adjustments,estimated_next_renewal_amount::float8 as "estimatedRenewal",final_renewal_amount::float8 as "finalRenewal",currency,cycle_closed_at as "closedAt",source from driver_memberships where driver_id=${driverId} order by created_at desc`;
    const payments=await database()`select id::text,amount::float8,currency,method,status,settlement_status as "settlementStatus",coalesce(reference_display,reference_masked) as reference,confirmed_at as "confirmedAt" from membership_payments where driver_id=${driverId} order by confirmed_at desc`;
    const orders=await database()`select id::text,short_code as "shortCode",status,plan_snapshot as plan,base_amount::float8 as "baseAmount",prior_usage_amount::float8 as "priorUsageAmount",adjustment_amount::float8 as "adjustmentAmount",total_amount::float8 as "totalAmount",currency,created_at as "createdAt",expires_at as "expiresAt",paid_at as "paidAt",cancelled_at as "cancelledAt",cancellation_reason_code as "cancellationReason",cancellation_observation as "cancellationObservation" from membership_payment_orders where driver_id=${driverId} order by created_at desc`;
    return { memberships,payments,orders };
  }catch(error){return businessError(error,reply);} });

  app.post("/v1/admin/memberships/:driverId/action", async (request, reply) => { try {
    const actor=requirePermission(request,"memberships:manage");
    const driverId=(request.params as {driverId:string}).driverId;
    const body=z.discriminatedUnion("action",[
      z.object({action:z.literal("SUSPEND"),reason:z.string().trim().min(5).max(500)}),
      z.object({action:z.literal("REACTIVATE"),reason:z.string().trim().min(5).max(500)}),
      z.object({action:z.literal("GRANT_GRACE"),days:z.number().int().min(1).max(90),allowsTrips:z.boolean(),reason:z.string().trim().min(5).max(500)}),
      z.object({action:z.literal("ADJUST"),amount:z.number().min(-100000).max(100000).refine(value=>value!==0),adjustmentType:z.enum(["BONUS","DISCOUNT","WAIVER","POSITIVE","NEGATIVE"]),reason:z.string().trim().min(5).max(500)}),
      z.object({action:z.literal("COURTESY_RENEW"),planId:z.string().uuid(),reason:z.string().trim().min(5).max(500)})
    ]).parse(request.body);
    const [driver]=await database()`select d.user_id::text from drivers d where d.user_id=${driverId}`;
    if(!driver)return reply.code(404).send({error:"DRIVER_NOT_FOUND"});
    let result:unknown;
    if(body.action==="SUSPEND") {
      [result]=await database()`update driver_memberships set status='SUSPENDED',suspended_at=now(),suspension_reason=${body.reason},updated_by=${actor.id!},updated_at=now() where driver_id=${driverId} and cycle_closed_at is null returning id::text,status`;
      await database()`update drivers set is_available=false where user_id=${driverId}`;
    } else if(body.action==="REACTIVATE") {
      [result]=await database()`update driver_memberships set status=case when plan_type_snapshot='TRIP_PACK' and completed_trips<included_trips_snapshot and (expires_at is null or expires_at>now()) then 'ACTIVE' when plan_type_snapshot='TRIP_PACK' then 'EXHAUSTED' when expires_at>now() then 'ACTIVE' when grace_ends_at>now() then 'GRACE_PERIOD' else 'PAYMENT_DUE' end,suspended_at=null,suspension_reason=null,reactivated_after_payment_at=now(),updated_by=${actor.id!},updated_at=now() where driver_id=${driverId} and cycle_closed_at is null returning id::text,status`;
    } else if(body.action==="GRANT_GRACE") {
      [result]=await database()`update driver_memberships dm set status='GRACE_PERIOD',grace_ends_at=greatest(coalesce(dm.grace_ends_at,now()),now())+(${body.days}*interval '1 day'),last_grace_local_date=(greatest(coalesce(dm.grace_ends_at,now()),now()) at time zone dm.suspension_timezone_snapshot)::date+${body.days},suspension_at=((((greatest(coalesce(dm.grace_ends_at,now()),now()) at time zone dm.suspension_timezone_snapshot)::date+${body.days+1})::date+dm.suspension_local_time_snapshot) at time zone dm.suspension_timezone_snapshot),grace_reason=${body.reason},grace_days_applied=dm.grace_days_applied+${body.days},grace_allows_trips_applied=${body.allowsTrips},updated_by=${actor.id!},updated_at=now() where dm.driver_id=${driverId} and dm.cycle_closed_at is null returning id::text,status,grace_ends_at as "graceEndsAt",suspension_at as "suspensionAt"`;
    } else if(body.action==="ADJUST") {
      result=await database().begin(async tx=>{
        const [cycle]=await tx`select * from driver_memberships where driver_id=${driverId} and cycle_closed_at is null for update`;
        if(!cycle)throw new Error("MEMBERSHIP_REQUIRED");
        const [adjustment]=await tx`insert into membership_cycle_adjustments(membership_cycle_id,adjustment_type,amount,reason,created_by) values (${cycle.id},${body.adjustmentType},${body.amount},${body.reason},${actor.id!}) returning id::text,amount::float8`;
        const nextAdjustment=money(Number(cycle.adjustment_amount)+body.amount);
        const estimate=Math.max(0,Math.min(Number(cycle.max_renewal_amount_snapshot),money(Number(cycle.base_membership_amount_snapshot)+Number(cycle.billable_extra_amount)+nextAdjustment)));
        await tx`update driver_memberships set adjustment_amount=${nextAdjustment},estimated_next_renewal_amount=${estimate},updated_by=${actor.id!},updated_at=now() where id=${cycle.id}`;
        return adjustment;
      });
    } else {
      requirePermission(request,"payments:courtesy_grant");
      const input={planId:body.planId,intendedMethod:undefined,idempotencyKey:`courtesy-${driverId}-${Date.now()}`};
      const order=await createPaymentOrder(driverId,input);
      result=await processMembershipPayment(String(order.id),actor,{method:"COURTESY",receiverScope:"NOT_APPLICABLE",verificationChannel:"ADMIN_COURTESY",idempotencyKey:`courtesy-payment-${order.id}`});
    }
    if(!result)return reply.code(409).send({error:"MEMBERSHIP_REQUIRED"});
    await persistAudit(actor,`MEMBERSHIP_${body.action}`,"DRIVER_MEMBERSHIP",driverId,body.reason);
    if(body.action!=="COURTESY_RENEW")void sendPush(driverId,"Membresía Costa-Go","Tu membresía fue actualizada. Revisa el detalle en la aplicación.",{type:"MEMBERSHIP_UPDATED"}).catch(()=>undefined);
    return result;
  }catch(error){return businessError(error,reply);} });

  app.get("/v1/admin/drivers/import/template",async(request,reply)=>{try{
    requirePermission(request,"membership_import:manage");
    reply.header("content-type","text/csv; charset=utf-8").header("content-disposition",'attachment; filename="plantilla-conductores-costa-go.csv"');
    return `${driverImportHeaders.join(",")}\nJuan,Costa,1712345678,juan@example.com,0991234567,INDIVIDUAL,ABC1234,TukTuk,Modelo 1,2025,\n`;
  }catch(error){return businessError(error,reply);} });

  app.post("/v1/admin/drivers/import/validate",async(request,reply)=>{try{
    const actor=requirePermission(request,"membership_import:manage");
    const body=driverImportSchema.parse(request.body);
    const buffer=Buffer.from(body.contentBase64.replace(/^data:[^;]+;base64,/,""),"base64");
    if(!buffer.length||buffer.length>2_000_000)return reply.code(400).send({error:"CSV_FILE_TOO_LARGE"});
    const text=buffer.toString("utf8").replace(/^\uFEFF/,"");
    const parsed=parseCsv(text);
    if(parsed.length<2)return reply.code(400).send({error:"CSV_EMPTY"});
    if(parsed.length>1001)return reply.code(400).send({error:"CSV_TOO_MANY_ROWS"});
    const headers=parsed[0]!.map(value=>value.trim().toLocaleLowerCase("es"));
    const headerIndex=new Map(headers.map((value,index)=>[value,index]));
    const missing=driverImportHeaders.filter(header=>!headerIndex.has(header));
    if(missing.length)return reply.code(400).send({error:"CSV_MISSING_COLUMNS",missing});
    const rows=parsed.slice(1).map((values,index)=>importedRow(values,headerIndex,index+2));
    const emails=rows.map(row=>row.email); const phones=rows.map(row=>normalizePhone(row.phone)).filter(Boolean) as string[];
    const identities=rows.map(row=>row.identityNumber);
    const cooperatives=await database()`select id::text,name,coalesce(registration_number,'') as code from cooperatives where status='ACTIVE'`;
    const cooperativeMap=new Map<string,string>();
    for(const cooperative of cooperatives){cooperativeMap.set(String(cooperative.name).trim().toUpperCase(),String(cooperative.id));if(cooperative.code)cooperativeMap.set(String(cooperative.code).trim().toUpperCase(),String(cooperative.id));}
    const existing=await database()`select lower(email) email,phone_e164 phone from users where deleted_at is null and (lower(email)=any(${emails.map(value=>value.toLowerCase())}) or phone_e164=any(${phones}))`;
    const existingDrivers=await database()`select lower(coalesce(d.identity_number,'')) identity from drivers d where lower(coalesce(d.identity_number,''))=any(${identities.map(value=>value.toLowerCase())})`;
    const existingEmails=new Set(existing.map(row=>String(row.email)));const existingPhones=new Set(existing.map(row=>String(row.phone)));
    const existingIdentities=new Set(existingDrivers.map(row=>String(row.identity)));
    const seenEmails=new Set<string>(),seenPhones=new Set<string>(),seenIdentities=new Set<string>();
    const preview=rows.map(row=>{
      const errors:string[]=[];const phone=normalizePhone(row.phone);const email=row.email.toLowerCase();const identity=row.identityNumber.toLowerCase();
      if(!row.firstNames||!row.lastNames)errors.push("NAME_REQUIRED");
      if(!/^\S+@\S+\.\S+$/.test(email))errors.push("INVALID_EMAIL");
      if(!phone)errors.push("INVALID_PHONE");
      if(row.identityNumber.length<5)errors.push("INVALID_IDENTITY");
      if(row.plate&&(!/^[a-zA-Z0-9 -]{3,30}$/.test(row.plate)))errors.push("INVALID_PLATE");
      if(row.vehicleYear&&(row.vehicleYear<1980||row.vehicleYear>new Date().getFullYear()+1))errors.push("INVALID_VEHICLE_YEAR");
      if(row.cooperativeCode!=="INDIVIDUAL"&&!cooperativeMap.has(row.cooperativeCode))errors.push("COOPERATIVE_NOT_FOUND");
      if(existingEmails.has(email)||seenEmails.has(email))errors.push("EMAIL_ALREADY_EXISTS");else seenEmails.add(email);
      if(phone&&(existingPhones.has(phone)||seenPhones.has(phone)))errors.push("PHONE_ALREADY_EXISTS");else if(phone)seenPhones.add(phone);
      if(existingIdentities.has(identity)||seenIdentities.has(identity))errors.push("IDENTITY_ALREADY_EXISTS");else seenIdentities.add(identity);
      return {...row,phone:phone??row.phone,cooperativeId:row.cooperativeCode==="INDIVIDUAL"?null:cooperativeMap.get(row.cooperativeCode),errors,status:errors.length?"REJECTED":"VALID"};
    });
    const validRows=preview.filter(row=>row.status==="VALID").length;
    const [batch]=await database()`insert into driver_import_batches(original_filename,total_rows,valid_rows,rejected_rows,status,created_by) values (${body.filename},${preview.length},${validRows},${preview.length-validRows},'VALIDATED',${actor.id!}) returning id::text`;
    for(const row of preview)await database()`insert into driver_import_rows(batch_id,row_number,normalized_data,status,errors) values (${batch!.id},${row.rowNumber},${JSON.stringify(row)}::jsonb,${row.status},${row.errors})`;
    await persistAudit(actor,"DRIVER_IMPORT_VALIDATED","DRIVER_IMPORT_BATCH",String(batch!.id),`${validRows}/${preview.length} filas válidas`);
    return {batchId:batch!.id,totalRows:preview.length,validRows,rejectedRows:preview.length-validRows,items:preview.slice(0,200)};
  }catch(error){return businessError(error,reply);} });

  app.post("/v1/admin/drivers/import/:batchId/confirm",async(request,reply)=>{try{
    const actor=requirePermission(request,"membership_import:manage");const batchId=(request.params as {batchId:string}).batchId;
    const imported=await database().begin(async tx=>{
      const [batch]=await tx`select * from driver_import_batches where id=${batchId} and status='VALIDATED' for update`;
      if(!batch)throw new Error("IMPORT_BATCH_NOT_AVAILABLE");
      const rows=await tx`select id::text,normalized_data from driver_import_rows where batch_id=${batchId} and status='VALID' order by row_number for update`;
      const created:Array<{id:string;email:string;name:string}>=[];
      for(const item of rows){const row=item.normalized_data as DriverImportRow&{cooperativeId?:string|null};const password=randomBytes(32).toString("base64url");
        const [user]=await tx`insert into users(phone_e164,full_name,email,password_hash,role,status,cooperative_id,phone_verified_at,email_verified_at,terms_accepted_at,must_change_password) values (${row.phone},${`${row.firstNames} ${row.lastNames}`.trim()},${row.email},crypt(${password},gen_salt('bf')),'DRIVER','ACTIVE',${row.cooperativeId??null},now(),now(),now(),true) returning id::text,email,full_name as name`;
        await tx`insert into mobile_account_roles(user_id,role) values (${user!.id},'PASSENGER'),(${user!.id},'DRIVER') on conflict do nothing`;
        await tx`insert into drivers(user_id,is_available,approval_status,identity_number,imported_at,imported_by) values (${user!.id},false,'PENDIENTE_DOCUMENTOS',${row.identityNumber},now(),${actor.id!})`;
        if(row.plate){
          await tx`select pg_advisory_xact_lock(737301)`;
          let [vehicle]=await tx`select id from vehicles where merged_into is null and fleet_normalize_identifier(identifier)=fleet_normalize_identifier(${row.plate})`;
          if(!vehicle)[vehicle]=await tx`insert into vehicles(identifier,cooperative_id,maximum_passengers,status,brand,model,model_year,notes)
            values (${row.plate},${row.cooperativeId??null},3,'PENDING',${row.vehicleBrand||null},${row.vehicleModel||null},${row.vehicleYear??null},${row.notes||null}) returning id`;
          await tx`insert into user_vehicle_relations(user_id,vehicle_id,relation_type,status,source)
            values(${user!.id},${vehicle!.id},'AUTHORIZED_DRIVER','PENDING','ADMIN') on conflict do nothing`;
          await tx`insert into vehicle_audit(vehicle_id,driver_id,actor_id,action,reason)
            values(${vehicle!.id},${user!.id},${actor.id!},'driver_link_requested','Importación CSV: no asigna propiedad ni autoriza automáticamente')`;
        }
        await tx`update driver_import_rows set status='IMPORTED',driver_id=${user!.id} where id=${item.id}`;created.push(user as {id:string;email:string;name:string});
      }
      await tx`update driver_import_batches set status='COMPLETED',imported_rows=${created.length},completed_at=now() where id=${batchId}`;
      return created;
    });
    for(const account of imported)void sendTransactionalEmail({to:account.email,subject:"Completa tu registro de conductor en Costa-Go",text:"Tu cuenta fue precargada por Costa-Go. Abre la aplicación, selecciona Recuperar contraseña, crea una contraseña segura y carga personalmente tu fotografía y documentos. Tu cuenta no podrá conectarse hasta completar la revisión y aprobación.",html:`<h2>Bienvenido a Costa-Go</h2><p>Tu cuenta de conductor fue precargada.</p><ol><li>Abre la aplicación.</li><li>Selecciona <strong>Recuperar contraseña</strong>.</li><li>Crea una contraseña segura.</li><li>Carga tu fotografía y documentos habilitantes.</li></ol><p>La importación no aprueba ni habilita automáticamente tu cuenta.</p>`}).catch(()=>false);
    await persistAudit(actor,"DRIVER_IMPORT_COMPLETED","DRIVER_IMPORT_BATCH",batchId,`${imported.length} cuentas creadas en PENDIENTE_DOCUMENTOS`);
    return {batchId,importedRows:imported.length};
  }catch(error){return businessError(error,reply);} });

  app.get("/v1/admin/membership-grace-policies",async(request,reply)=>{try{requirePermission(request,"memberships:view");return database()`select id::text,name,reason,scope,cooperative_id::text as "cooperativeId",driver_id::text as "driverId",grace_days as "graceDays",allows_trips as "allowsTrips",campaign_kind as "campaignKind",starts_at as "startsAt",ends_at as "endsAt",expiry_window_start as "expiryWindowStart",expiry_window_end as "expiryWindowEnd",priority,status,created_at as "createdAt" from membership_grace_policies order by created_at desc`; }catch(error){return businessError(error,reply);} });

  app.post("/v1/admin/membership-grace-policies/preview",async(request,reply)=>{try{requirePermission(request,"membership_grace:manage");const body=gracePolicySchema.parse(request.body);const [preview]=await database()`select count(*)::int as affected,count(*) filter(where dm.status='PENDING')::int as pending,count(*) filter(where dm.status in ('ACTIVE','EXPIRING'))::int as active,count(distinct u.cooperative_id)::int as cooperatives from driver_memberships dm join users u on u.id=dm.driver_id where dm.cycle_closed_at is null and (${body.scope}='ALL' or (${body.scope}='COOPERATIVE' and u.cooperative_id=${body.cooperativeId ?? null}) or (${body.scope}='DRIVER' and dm.driver_id=${body.driverId ?? null})) and (${body.expiryWindowStart ?? null}::date is null or dm.expiration_local_date>=${body.expiryWindowStart ?? null}::date) and (${body.expiryWindowEnd ?? null}::date is null or dm.expiration_local_date<=${body.expiryWindowEnd ?? null}::date)`;return preview;}catch(error){return businessError(error,reply);} });

  app.post("/v1/admin/membership-grace-policies",async(request,reply)=>{try{const actor=requirePermission(request,"membership_grace:manage");const body=gracePolicySchema.parse(request.body);const [item]=await database()`insert into membership_grace_policies(name,reason,scope,cooperative_id,driver_id,grace_days,allows_trips,campaign_kind,starts_at,ends_at,expiry_window_start,expiry_window_end,priority,status,created_by,approved_by) values (${body.name},${body.reason},${body.scope},${body.cooperativeId ?? null},${body.driverId ?? null},${body.graceDays},${body.allowsTrips},${body.campaignKind},${body.startsAt},${body.endsAt},${body.expiryWindowStart ?? null},${body.expiryWindowEnd ?? null},${body.priority},${body.status},${actor.id!},${body.status==='ACTIVE'?actor.id!:null}) returning id::text,name,status`;if(!item)throw new Error("GRACE_POLICY_NOT_CREATED");await persistAudit(actor,"MEMBERSHIP_GRACE_POLICY_CREATED","MEMBERSHIP_GRACE_POLICY",item.id,body.reason);return reply.code(201).send(item);}catch(error){return businessError(error,reply);} });

  app.get("/v1/admin/api-usage",async(request,reply)=>{try{
    requirePermission(request,"api_usage:view");
    const [settings]=await database()`select * from operational_settings where id=1`;
    if(!settings)throw new Error("SETTINGS_NOT_FOUND");
    const rows=await database()`select provider,count(*)::int as requests,count(*) filter(where result like '%ERROR%')::int as errors from api_usage_events where billing_period=date_trunc('month',now())::date group by provider order by provider`;
    const usage=Object.fromEntries(rows.map(row=>[String(row.provider),{used:Number(row.requests),errors:Number(row.errors)}]));
    const priced=(provider:string,freeCap:number,pricePerThousand:number)=>{
      const item=usage[provider]??{used:0,errors:0};
      const billable=Math.max(0,item.used-freeCap);
      return {...item,freeCap,billable,pricePerThousand,estimatedCost:billable*pricePerThousand/1000};
    };
    const textSearch=priced("TEXT_SEARCH_PRO",Number(settings.text_search_free_cap_reference),Number(settings.text_search_price_per_thousand_usd));
    const navigationEnabled=settings.navigation_pickup_provider==='NAVIGATION_SDK'||settings.navigation_destination_provider==='NAVIGATION_SDK';
    return {
      period:new Date().toISOString().slice(0,7),providers:rows,
      textSearch:{...textSearch,operationalLimit:Number(settings.text_search_free_cap_reference)+Math.floor(Number(settings.text_search_monthly_budget_usd)*1000/Math.max(0.01,Number(settings.text_search_price_per_thousand_usd)))},
      routes:priced("ROUTES",Number(settings.routes_free_cap_reference),Number(settings.routes_price_per_thousand_usd)),
      geocoding:priced("GEOCODING",Number(settings.geocoding_free_cap_reference),Number(settings.geocoding_price_per_thousand_usd)),
      navigation:{...priced("NAVIGATION_SDK",Number(settings.navigation_free_cap_reference),Number(settings.navigation_price_per_thousand_usd)),enabled:navigationEnabled,optional:true}
    };
  }catch(error){return businessError(error,reply);} });

  app.get("/v1/collector/payment-orders/token/:token",async(request,reply)=>{try{requirePermission(request,"payments:collect");const token=(request.params as {token:string}).token;const [order]=await database()`select o.id::text,o.status,o.short_code as "shortCode",o.taxable_subtotal::float8 as "subtotalAmount",o.vat_rate_percent::float8 as "vatRatePercent",o.vat_amount::float8 as "vatAmount",o.total_amount::float8 as amount,o.currency,o.expires_at as "expiresAt",o.plan_snapshot as plan,u.full_name as driver,concat('****',right(coalesce(d.identity_number,''),4)) as identification,v.identifier as vehicle,c.name as cooperative,dm.expires_at as "currentExpiresAt" from membership_payment_orders o join users u on u.id=o.driver_id join drivers d on d.user_id=o.driver_id left join lateral(select string_agg(v.identifier,', ' order by v.identifier) as identifier from vehicles v join user_vehicle_relations r on r.vehicle_id=v.id where r.user_id=o.driver_id and r.relation_type='AUTHORIZED_DRIVER' and r.status='APPROVED' and v.merged_into is null)v on true left join cooperatives c on c.id=u.cooperative_id left join lateral(select expires_at from driver_memberships where driver_id=o.driver_id and cycle_closed_at is null order by created_at desc limit 1)dm on true where o.public_token_hash=${sha256(token)} and o.status in ('PENDING','PENDING_VERIFICATION') and o.expires_at>now()`;if(!order)return reply.code(404).send({error:"PAYMENT_ORDER_NOT_FOUND"});return order;}catch(error){return businessError(error,reply);} });

  app.get("/v1/collector/payment-orders/search",async(request,reply)=>{try{
    requirePermission(request,"payments:collect");
    const {query}=collectorOrderSearchSchema.parse(request.query);
    let token:string|null=null;
    try{const parsed=new URL(query);token=parsed.searchParams.get("token")??parsed.searchParams.get("paymentToken");}catch{if(query.startsWith("v1."))token=query;}
    const tokenHash=token?sha256(token):null;
    const normalized=query.toLowerCase().replace(/[^a-z0-9]/g,"");
    const rows=await database()`
      select o.id::text,o.status,o.short_code as "shortCode",
        o.taxable_subtotal::float8 as "subtotalAmount",o.vat_rate_percent::float8 as "vatRatePercent",
        o.vat_amount::float8 as "vatAmount",o.total_amount::float8 as amount,o.currency,
        o.expires_at as "expiresAt",o.plan_snapshot as plan,u.full_name as driver,u.email,
        concat('****',right(coalesce(d.identity_number,''),4)) as identification,v.identifier as vehicle,
        c.name as cooperative,dm.expires_at as "currentExpiresAt"
      from membership_payment_orders o
      join users u on u.id=o.driver_id join drivers d on d.user_id=o.driver_id
      left join lateral(select string_agg(v.identifier,', ' order by v.identifier) as identifier from vehicles v join user_vehicle_relations r on r.vehicle_id=v.id where r.user_id=o.driver_id and r.relation_type='AUTHORIZED_DRIVER' and r.status='APPROVED' and v.merged_into is null)v on true
      left join cooperatives c on c.id=u.cooperative_id
      left join lateral(select expires_at from driver_memberships where driver_id=o.driver_id and cycle_closed_at is null order by created_at desc limit 1)dm on true
      where o.status in ('PENDING','PENDING_VERIFICATION') and o.expires_at>now() and (
        (${tokenHash}::text is not null and o.public_token_hash=${tokenHash})
        or upper(o.short_code)=upper(${query})
        or (
          lower(u.email)=lower(${query})
          or exists(select 1 from vehicles unit join user_vehicle_relations rel on rel.vehicle_id=unit.id where rel.user_id=o.driver_id and rel.relation_type='AUTHORIZED_DRIVER' and rel.status='APPROVED' and unit.merged_into is null and fleet_normalize_identifier(unit.identifier)=upper(${normalized}))
          or regexp_replace(lower(coalesce(u.phone_e164,'')),'[^a-z0-9]','','g')=${normalized}
          or lower(u.full_name) like lower(${`%${query}%`})
        )
      )
      order by case when o.status in ('PENDING','PENDING_VERIFICATION') and o.expires_at>now() then 0 else 1 end,o.created_at desc limit 10
    `;
    return rows;
  }catch(error){return businessError(error,reply);} });

  app.post("/v1/collector/payment-orders/:id/confirm",async(request,reply)=>{try{const actor=requirePermission(request,"payments:collect");const body=paymentConfirmSchema.parse(request.body);const id=(request.params as {id:string}).id;return await confirmCollectorPayment(id,actor,body);}catch(error){return businessError(error,reply);} });

  app.post("/v1/collector/payment-orders/token/:token/confirm",async(request,reply)=>{try{const actor=requirePermission(request,"payments:collect");const body=paymentConfirmSchema.parse(request.body);const token=(request.params as {token:string}).token;const [order]=await database()`select id::text from membership_payment_orders where public_token_hash=${sha256(token)} and status in ('PENDING','PENDING_VERIFICATION') and expires_at>now()`;if(!order)return reply.code(404).send({error:"PAYMENT_ORDER_NOT_FOUND"});return await confirmCollectorPayment(order.id,actor,body);}catch(error){return businessError(error,reply);} });

  app.get("/v1/collector/payments/today",async(request,reply)=>{try{const actor=requirePermission(request,"payments:view_own_point");return database()`select p.id::text,p.amount::float8,p.currency,p.method,p.settlement_status as "settlementStatus",p.confirmed_at as "confirmedAt",u.full_name as driver,cp.id::text as "collectionPointId",cp.name as point from membership_payments p join users u on u.id=p.driver_id join collection_points cp on cp.id=p.collection_point_id join collector_assignments ca on ca.collection_point_id=cp.id and ca.collector_id=${actor.id!} where p.collector_id=${actor.id!} and p.confirmed_at>=date_trunc('day',now()) and p.status='CONFIRMED' and not exists(select 1 from collection_point_closure_payments link where link.payment_id=p.id) order by p.confirmed_at desc`; }catch(error){return businessError(error,reply);} });

  app.get("/v1/collector/payments/pending-closure",async(request,reply)=>{try{
    const actor=requirePermission(request,"payments:view_own_point");
    return database()`
      select p.id::text,p.amount::float8,p.currency,p.method,p.settlement_status as "settlementStatus",
        p.confirmed_at as "confirmedAt",u.full_name as driver,cp.id::text as "collectionPointId",cp.name as point,
        (p.confirmed_at at time zone coalesce(settings.membership_timezone,'America/Guayaquil'))::date::text as "businessDate"
      from membership_payments p
      join users u on u.id=p.driver_id
      join collection_points cp on cp.id=p.collection_point_id
      join collector_assignments ca on ca.collection_point_id=cp.id and ca.collector_id=${actor.id!}
        and ca.starts_at<=now() and (ca.ends_at is null or ca.ends_at>now())
      cross join operational_settings settings
      where p.collector_id=${actor.id!} and p.status='CONFIRMED'
        and not exists(select 1 from collection_point_closure_payments link where link.payment_id=p.id)
      order by p.confirmed_at asc
    `;
  }catch(error){return businessError(error,reply);} });

  app.get("/v1/collector/me",async(request,reply)=>{try{const actor=requirePermission(request,"payments:view_own_point");const points=await database()`select cp.id::text,cp.code,cp.name,cp.address,cp.status,cp.cash_enabled as "cashEnabled",cp.deuna_enabled as "deunaEnabled",cp.bank_transfer_enabled as "bankTransferEnabled" from collector_assignments ca join collection_points cp on cp.id=ca.collection_point_id where ca.collector_id=${actor.id!} and ca.starts_at<=now() and (ca.ends_at is null or ca.ends_at>now()) order by cp.name`;return {user:{id:actor.id,name:actor.name},points};}catch(error){return businessError(error,reply);} });

  app.get("/v1/collector/closures",async(request,reply)=>{try{const actor=requirePermission(request,"settlements:view_own_point");return database()`select c.id::text,c.period_start as "periodStart",c.period_end as "periodEnd",c.status,c.cash_total::float8 as "cashTotal",c.deuna_total::float8 as "deunaTotal",c.transfer_total::float8 as "transferTotal",c.gross_amount::float8 as "grossAmount",c.commission_amount::float8 as "commissionAmount",c.net_amount::float8 as "netAmount",cp.name as point from collection_point_closures c join collection_points cp on cp.id=c.collection_point_id where c.collector_id=${actor.id!} and c.gross_amount>0 order by c.created_at desc limit 100`; }catch(error){return businessError(error,reply);} });

  app.post("/v1/collector/closures", async (request, reply) => {
    try {
      const actor = requirePermission(request, "cash_closures:create");
      const body = z.object({
        collectionPointId: z.string().uuid(),
        businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        notes: z.string().trim().max(500).optional()
      }).parse(request.body);
      const result = await database().begin(async (tx) => {
        const [assignment] = await tx`select cp.id from collector_assignments ca join collection_points cp on cp.id=ca.collection_point_id where ca.collector_id=${actor.id!} and cp.id=${body.collectionPointId} and cp.status='ACTIVE' and ca.starts_at<=now() and (ca.ends_at is null or ca.ends_at>now())`;
        if (!assignment) throw new Error("FORBIDDEN");
        const [settings] = await tx`select coalesce(membership_timezone,'America/Guayaquil') as timezone from operational_settings limit 1`;
        const timezone = String(settings?.timezone ?? "America/Guayaquil");
        const [period] = await tx`select
          (${body.businessDate}::date at time zone ${timezone}) as start,
          ((${body.businessDate}::date + 1) at time zone ${timezone}) as end,
          (now() at time zone ${timezone})::date::text as "today"`;
        if (!period || body.businessDate > String(period.today)) throw new Error("FUTURE_CLOSURE_DATE");
        await tx`select pg_advisory_xact_lock(hashtext(${`${body.collectionPointId}:${actor.id!}:${body.businessDate}`}))`;
        const payments = await tx`select p.id,p.method,p.amount from membership_payments p where p.collection_point_id=${body.collectionPointId} and p.collector_id=${actor.id!} and p.status='CONFIRMED' and p.confirmed_at>=${period.start} and p.confirmed_at<${period.end} and not exists(select 1 from collection_point_closure_payments link where link.payment_id=p.id) for update`;
        if (!payments.length) throw new Error("NO_PAYMENTS_TO_CLOSE");
        const total = (method: string) => money(payments.filter((item) => item.method === method).reduce((sum, item) => sum + Number(item.amount), 0));
        const cash = total("CASH");
        const deuna = total("DEUNA");
        const transfer = total("BANK_TRANSFER");
        const gross = money(cash + deuna + transfer);
        const periodEnd = body.businessDate === String(period.today) ? new Date() : period.end;
        const [closure] = await tx`insert into collection_point_closures(collection_point_id,collector_id,period_start,period_end,status,cash_total,deuna_total,transfer_total,gross_amount,net_amount,closed_at,notes) values(${body.collectionPointId},${actor.id!},${period.start},${periodEnd},'PENDING_SETTLEMENT',${cash},${deuna},${transfer},${gross},${gross},now(),${body.notes ?? null}) returning id::text,status,gross_amount::float8 as "grossAmount",net_amount::float8 as "netAmount"`;
        if (!closure) throw new Error("CLOSURE_NOT_CREATED");
        for (const payment of payments) await tx`insert into collection_point_closure_payments(closure_id,payment_id) values(${closure.id},${payment.id})`;
        return { id: String(closure.id), status: String(closure.status), businessDate: body.businessDate, grossAmount: Number(closure.grossAmount), netAmount: Number(closure.netAmount), payments: payments.length };
      });
      await persistAudit(actor, "COLLECTION_CLOSURE_CREATED", "COLLECTION_POINT_CLOSURE", result.id, body.notes ?? "Cierre de caja");
      return reply.code(201).send(result);
    } catch (error) {
      return businessError(error, reply);
    }
  });

  app.get("/v1/admin/collection-closures",async(request,reply)=>{try{requirePermission(request,"cash_closures:review");return database()`select c.id::text,c.status,c.period_start as "periodStart",c.period_end as "periodEnd",c.gross_amount::float8 as "grossAmount",c.commission_amount::float8 as "commissionAmount",c.net_amount::float8 as "netAmount",cp.name as point,u.full_name as collector,c.created_at as "createdAt" from collection_point_closures c join collection_points cp on cp.id=c.collection_point_id join users u on u.id=c.collector_id where c.gross_amount>0 order by c.created_at desc limit 200`; }catch(error){return businessError(error,reply);} });

  app.get("/v1/admin/membership-payments/pending",async(request,reply)=>{try{requirePermission(request,"payments:transfer_review");return database()`select proof.id::text,proof.order_id::text as "orderId",u.full_name as driver,o.plan_snapshot as plan,o.total_amount::float8 as "expectedAmount",proof.declared_amount::float8 as "declaredAmount",o.currency,proof.bank_name as bank,coalesce(proof.reference_display,proof.reference_masked) as reference,proof.transfer_date as "transferDate",proof.status,proof.created_at as "createdAt" from membership_transfer_proofs proof join membership_payment_orders o on o.id=proof.order_id join users u on u.id=o.driver_id where proof.status='PENDING' order by proof.created_at`; }catch(error){return businessError(error,reply);} });

  app.post("/v1/admin/membership-payments/:proofId/approve",async(request,reply)=>{try{const actor=requirePermission(request,"payments:transfer_review");const proofId=(request.params as {proofId:string}).proofId;const body=z.object({idempotencyKey:z.string().min(8).max(120)}).parse(request.body);const [proof]=await database()`select p.*,o.id::text as "orderId" from membership_transfer_proofs p join membership_payment_orders o on o.id=p.order_id where p.id=${proofId} and p.status='PENDING'`;if(!proof)return reply.code(404).send({error:"PAYMENT_ORDER_NOT_FOUND"});const result=await processMembershipPayment(proof.orderId,actor,{method:'BANK_TRANSFER',receiverScope:'COSTA_GO_CENTRAL',verificationChannel:'REMOTE_PROOF',referenceHash:String(proof.reference_normalized_hash),referenceMasked:String(proof.reference_masked),referenceDisplay:String(proof.reference_display ?? proof.reference_masked),idempotencyKey:body.idempotencyKey});await database()`update membership_transfer_proofs set status='APPROVED',reviewed_by=${actor.id!},reviewed_at=now() where id=${proofId} and status='PENDING'`;return result;}catch(error){return businessError(error,reply);} });

  app.post("/v1/admin/membership-payments/:proofId/reject",async(request,reply)=>{try{const actor=requirePermission(request,"payments:transfer_review");const proofId=(request.params as {proofId:string}).proofId;const body=z.object({reason:z.enum(['TRANSFER_NOT_FOUND','WRONG_AMOUNT','DUPLICATE_RECEIPT','INVALID_RECEIPT','OTHER']),comment:z.string().trim().min(3).max(500)}).parse(request.body);const [proof]=await database().begin(async tx=>{const [item]=await tx`update membership_transfer_proofs set status='REJECTED',reviewed_by=${actor.id!},reviewed_at=now(),rejection_reason=${`${body.reason}: ${body.comment}`} where id=${proofId} and status='PENDING' returning id::text,order_id::text as "orderId"`;if(item)await tx`update membership_payment_orders set status='REJECTED',rejected_at=now(),updated_at=now() where id=${item.orderId}`;return [item];});if(!proof)return reply.code(409).send({error:'PAYMENT_ORDER_NOT_PAYABLE'});await persistAudit(actor,'PAYMENT_REJECTED','MEMBERSHIP_TRANSFER_PROOF',proofId,body.comment);return proof;}catch(error){return businessError(error,reply);} });
}
