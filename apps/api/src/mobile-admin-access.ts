import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { database } from "./database.js";
import { commercialContext } from "./arrival-commercial.js";
import { immediateArrival, scheduledArrivalSnapshot } from "./commercial-economics.js";
import { storedScheduledArrivalConfiguration } from "./scheduled-arrival.js";
import {
  requirePermission,
  tokenFor,
  userFrom,
  type SessionUser
} from "./admin.js";
import { permissionsForRole, type AdminRole, type Permission } from "./permissions.js";

const accessRole = z.enum(["SUPER_ADMIN", "MOBILE_OPERATIONS_ADMIN"]);
const updateSchema = z.object({
  enabled: z.boolean(),
  role: accessRole,
  reason: z.string().trim().min(5).max(500)
});

// Mobile administration deliberately excludes credentials, database access and
// technical infrastructure even for a mobile SUPER_ADMIN.
export const mobileSafePermissions = [
  "dashboard:view", "operations:view", "alerts:view", "trips:view", "trips:manage",
  "pricing:view", "pricing:manage", "zones:view", "service_areas:view",
  "settings:view", "settings:manage", "memberships:view", "memberships:manage",
  "membership_plans:manage", "advertising:view", "advertising:manage",
  "notifications:view", "notifications:manage", "notification_campaigns:view",
  "notification_campaigns:manage", "audit:view"
] satisfies Permission[];

const modulePermission: Record<string, Permission> = {
  overview: "operations:view", fares: "pricing:view", dispatch: "settings:view",
  arrival: "memberships:view", trips: "trips:view", scheduled: "settings:view",
  cancellations: "settings:view", wallet: "memberships:view", memberships: "memberships:view",
  packages: "memberships:view", advertising: "advertising:view",
  notifications: "notifications:view", flags: "settings:view", simulator: "settings:view",
  audit: "audit:view"
};

function effectivePermissions(role: "SUPER_ADMIN" | "MOBILE_OPERATIONS_ADMIN"): Permission[] {
  if (role === "SUPER_ADMIN") {
    const base = permissionsForRole("SUPER_ADMIN");
    return mobileSafePermissions.filter(permission => base.includes(permission));
  }
  // This is a dedicated additive role. Its scope is the operational allowlist
  // above, not the broader web ADMIN_OPERACIONES role and never infrastructure.
  return [...mobileSafePermissions];
}

async function mobileIdentity(request: FastifyRequest) {
  const user = userFrom(request);
  if (!user?.id || !["PASSENGER", "DRIVER"].includes(user.role) || !user.sessionId) return null;
  const [row] = await database()`select u.id::text,u.email,u.full_name as name,a.access_role as role,a.version,
      a.updated_at as "updatedAt"
    from users u join mobile_admin_access a on a.user_id=u.id
    where u.id=${user.id} and u.status='ACTIVE' and u.deleted_at is null
      and u.active_session_id=${user.sessionId}::uuid and a.enabled=true`;
  return row;
}

export async function registerMobileAdminAccessRoutes(app: FastifyInstance) {
  app.get("/v1/mobile-admin/access", async (request, reply) => {
    const user = userFrom(request);
    if (!user?.id || !["PASSENGER", "DRIVER"].includes(user.role)) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const identity = await mobileIdentity(request);
    return { authorized: Boolean(identity), role: identity?.role ?? null, updatedAt: identity?.updatedAt ?? null };
  });

  app.post("/v1/mobile-admin/session", async (request, reply) => {
    const identity = await mobileIdentity(request);
    if (!identity) return reply.code(403).send({ error: "MOBILE_ADMIN_FORBIDDEN" });
    const role = String(identity.role) as "SUPER_ADMIN" | "MOBILE_OPERATIONS_ADMIN";
    const permissions = effectivePermissions(role);
    const adminRole: AdminRole = role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN_OPERACIONES";
    const session: SessionUser = {
      id: String(identity.id), email: String(identity.email), name: String(identity.name), role: adminRole,
      permissions, sessionId: randomUUID(), expiresAt: Date.now() + 60 * 60 * 1000,
      administrativeSource: "MOBILE_ADMIN"
    };
    const token = tokenFor(session);
    await database()`insert into admin_sessions(id,user_id,token_hash,expires_at)
      values(${session.sessionId!}::uuid,${session.id!},${createHash("sha256").update(token).digest("hex")},${new Date(session.expiresAt!)})`;
    await database()`insert into audit_log(actor_id,action,entity_type,entity_id,next_value,reason)
      values(${session.id!},'MOBILE_ADMIN_SESSION_STARTED','SESSION',${session.sessionId!},
        ${JSON.stringify({ source: "MOBILE_ADMIN", role, accessVersion: identity.version })}::jsonb,'Acceso desde Administración Costa-Go móvil')`;
    return {
      token,
      user: session,
      access: { role, version: Number(identity.version), updatedAt: identity.updatedAt },
      modules: Object.entries(modulePermission).filter(([, permission]) => permissions.includes(permission)).map(([id]) => id)
    };
  });

  app.post("/v1/mobile-admin/simulate", async (request, reply) => { try {
    const actor = requirePermission(request, "settings:view");
    if (actor.administrativeSource !== "MOBILE_ADMIN") return reply.code(403).send({ error: "MOBILE_ADMIN_REQUIRED" });
    const body = z.object({
      tripType: z.enum(["IMMEDIATE", "SCHEDULED_DAY", "SCHEDULED_NIGHT"]),
      billingMode: z.enum(["PAY_PER_USE", "PERIOD_PLAN_INCLUDED", "PERIOD_PLAN_OVERAGE", "PERIOD_PLAN_CAP_REACHED", "TRIP_PACKAGE"]),
      round: z.number().int().positive(), journeyFare: z.string().regex(/^\d{1,6}\.\d{2}$/)
    }).parse(request.body);
    const context = await commercialContext();
    if (!context) return reply.code(409).send({ error: "CONFIGURATION_NOT_ACTIVE" });
    let calculation: Record<string, unknown>;
    if (body.tripType === "IMMEDIATE") {
      calculation = immediateArrival({settings:context.settings,round:body.round,feePerRound:context.feePerRound,
        journeyFare:body.journeyFare,costaGoPercent:context.costaGoPercent});
    } else {
      const [scheduled] = await database()`select scheduled_arrival_configuration as configuration,
        scheduled_arrival_version as version from operational_settings where id=1`;
      const scheduledConfiguration = storedScheduledArrivalConfiguration(scheduled?.configuration);
      if (!scheduled || !scheduledConfiguration?.enabled) return reply.code(409).send({ error: "SCHEDULED_CONFIGURATION_NOT_ACTIVE" });
      const pickup = body.tripType === "SCHEDULED_DAY"
        ? `2026-01-15T${scheduledConfiguration.dayStartTime}:00-05:00`
        : `2026-01-15T${scheduledConfiguration.nightStartTime}:00-05:00`;
      calculation = scheduledArrivalSnapshot(pickup,body.journeyFare,{...scheduledConfiguration,
        version:String(scheduled.version),costaGoPercent:context.costaGoPercent});
    }
    const theoretical = String(calculation.theoreticalCommission);
    const applied = ["PAY_PER_USE","PERIOD_PLAN_OVERAGE"].includes(body.billingMode) ? theoretical : "0.00";
    const coverageStatus = {
      PAY_PER_USE: "SALDO_REQUERIDO",
      PERIOD_PLAN_INCLUDED: "VIAJE_INCLUIDO",
      PERIOD_PLAN_OVERAGE: "EXCEDENTE_BAJO_TOPE",
      PERIOD_PLAN_CAP_REACHED: "TOPE_ALCANZADO",
      TRIP_PACKAGE: "COMISION_INCLUIDA_PREPAGADA"
    }[body.billingMode];
    const [totals] = await database()`select (${String(calculation.passengerTotal)}::numeric-${applied}::numeric)::text as "driverProfit"`;
    return {...calculation,billingMode:body.billingMode,appliedCommission:applied,driverProfit:totals!.driverProfit,
      balanceRequired:body.billingMode==="PAY_PER_USE"?theoretical:null,coverageStatus,simulation:true,persisted:false};
  } catch (error) {
    if (error instanceof z.ZodError) return reply.code(400).send({error:"INVALID_SIMULATION",details:error.issues});
    throw error;
  } });

  app.get("/v1/mobile-admin/fare-suggestions", async (request, reply) => { try {
    const actor=requirePermission(request,"pricing:view");
    if(actor.administrativeSource!=="MOBILE_ADMIN")return reply.code(403).send({error:"MOBILE_ADMIN_REQUIRED"});
    return await database()`select origin.id::text as "originSectorId",origin.name as "originSector",
      destination.id::text as "destinationSectorId",destination.name as "destinationSector",
      origin.service_area_id::text as "serviceAreaId",count(*)::int as uses,
      round(avg((leg.value->>'fareCents')::numeric))::int as "averageFareCents",
      max(t.requested_at) as "lastUsedAt"
      from trips t cross join lateral jsonb_array_elements(
        case when jsonb_typeof(t.pricing_snapshot->'legs')='array' then t.pricing_snapshot->'legs' else '[]'::jsonb end
      ) leg(value)
      join fare_sectors origin on origin.code=leg.value->>'originSector' and origin.service_area_id=t.service_area_id
      join fare_sectors destination on destination.code=leg.value->>'destinationSector' and destination.service_area_id=t.service_area_id
      where t.requested_at>=now()-interval '30 days' and coalesce((leg.value->>'suggested')::boolean,false)
      and not exists(
        select 1 from fare_route_rules rule
        where rule.service_area_id=t.service_area_id and rule.enabled
          and (
            (rule.origin_sector_id=origin.id and rule.destination_sector_id=destination.id)
            or (rule.bidirectional and rule.origin_sector_id=destination.id and rule.destination_sector_id=origin.id)
          )
      )
      group by origin.id,origin.name,destination.id,destination.name,origin.service_area_id
      order by uses desc,"lastUsedAt" desc limit 50`;
  } catch(error) { throw error; } });

  app.get("/v1/admin/mobile-access/users", async (request, reply) => { try {
    requirePermission(request, "roles:manage");
    return await database()`select u.id::text,u.full_name as name,u.email,u.phone_e164 as phone,
      array(select role from mobile_account_roles where user_id=u.id order by role) as "mobileRoles",
      coalesce(a.enabled,false) enabled,coalesce(a.access_role,'MOBILE_OPERATIONS_ADMIN') role,
      coalesce(a.version,0)::int version,a.updated_at as "updatedAt"
      from users u left join mobile_admin_access a on a.user_id=u.id
      where u.deleted_at is null and exists(select 1 from mobile_account_roles where user_id=u.id)
      order by a.enabled desc,u.full_name`;
  } catch (error) {
    const message=error instanceof Error?error.message:"ERROR";
    return reply.code(message==="FORBIDDEN"?403:401).send({error:message});
  } });

  app.put("/v1/admin/mobile-access/users/:userId", async (request, reply) => { try {
    const actor = requirePermission(request, "roles:manage");
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    const body = updateSchema.parse(request.body);
    const result = await database().begin(async tx => {
      const [target] = await tx`select id,full_name,email from users where id=${userId} and deleted_at is null
        and exists(select 1 from mobile_account_roles where user_id=${userId}) for update`;
      if (!target) throw new Error("MOBILE_ACCOUNT_NOT_FOUND");
      const [previous] = await tx`select enabled,access_role,version from mobile_admin_access where user_id=${userId} for update`;
      const [updated] = await tx`insert into mobile_admin_access(user_id,access_role,enabled,assigned_by,version,updated_at)
        values(${userId},${body.role},${body.enabled},${actor.id!},1,now())
        on conflict(user_id) do update set access_role=excluded.access_role,enabled=excluded.enabled,
          assigned_by=excluded.assigned_by,version=mobile_admin_access.version+1,updated_at=now()
        returning enabled,access_role as role,version,updated_at as "updatedAt"`;
      await tx`update admin_sessions set revoked_at=coalesce(revoked_at,now()) where user_id=${userId}
        and revoked_at is null and id<>coalesce(${actor.sessionId??null}::uuid,'00000000-0000-0000-0000-000000000000'::uuid)`;
      await tx`insert into audit_log(actor_id,action,entity_type,entity_id,previous_value,next_value,reason)
        values(${actor.id!},${body.enabled?'MOBILE_ADMIN_ACCESS_GRANTED':'MOBILE_ADMIN_ACCESS_REVOKED'},'USER',${userId},
          ${tx.json(previous??{})},${tx.json({...updated,source:'WEB_ADMIN'})},${body.reason})`;
      return updated;
    });
    return result;
  } catch (error) {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: "INVALID_MOBILE_ADMIN_ACCESS", details:error.issues });
    const message=error instanceof Error?error.message:"ERROR";
    return reply.code(message==="FORBIDDEN"?403:message==="MOBILE_ACCOUNT_NOT_FOUND"?404:401).send({error:message});
  } });
}
