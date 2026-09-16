import postgres from "postgres";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(await readFile(resolve(here, "production-cleanup-policy.json"), "utf8"));
if (policy.preserveAllRegisteredAccounts !== true || policy.preserveDeletedAccounts !== false ||
    policy.deleteAllCooperatives !== true || policy.pruneObsoleteConfigurationVersions !== true ||
    policy.preserveScheduledConfigurationVersions !== true || !Number.isInteger(policy.expectedRegisteredUserCount) ||
    !Number.isInteger(policy.expectedRegisteredDriverCount) || !Number.isInteger(policy.expectedCooperativeCount)) {
  throw new Error("La política de conservación de cuentas y eliminación de cooperativa está incompleta");
}
const execute = process.argv.includes("--execute");
const url = new URL(process.env.DATABASE_URL ?? "invalid://missing");
if (!process.env.CLEANUP_EXPECTED_HOST || url.hostname !== process.env.CLEANUP_EXPECTED_HOST) {
  throw new Error("CLEANUP_EXPECTED_HOST no coincide con DATABASE_URL");
}
if (execute && process.env.CLEANUP_EXECUTE !== "YES_DELETE_PRODUCTION_TEST_DATA") {
  throw new Error("Falta la autorización técnica CLEANUP_EXECUTE");
}
if (execute && process.env.CLEANUP_BACKUP_CONFIRMED !== "RESTORE_TESTED") {
  throw new Error("Falta confirmar un respaldo restaurado y verificado");
}

const preserve = [
  "schema_migrations", "spatial_ref_sys", "operational_settings", "service_zones", "pricing_versions",
  "admin_permission_overrides", "driver_approval_notification_settings", "support_faqs",
  "service_area_catalog", "service_areas", "service_area_versions", "service_area_role_access", "fare_sectors",
  "fare_route_rules", "membership_plans", "membership_grace_policies", "collection_points", "collector_assignments",
  "collection_point_payment_accounts", "costa_go_payment_accounts", "advertising_plans", "advertising_payment_methods",
  "collection_point_schedules", "fleet_settings", "smart_notification_config", "app_version_config",
  "notification_delivery_config", "notification_event_definitions", "package_commercial_rules", "mobile_admin_access",
];

const conditional = [
  "users", "drivers", "driver_documents", "user_service_area_access", "mobile_account_roles", "fleet_entitlements",
];

const deleteSeparately = ["admin_sessions", "passenger_cancellation_cycles", "cooperatives"];

// This is deliberately explicit. RESTRICT makes PostgreSQL reject an unknown referencing table.
// CONTINUE IDENTITY is the default: fiscal and audit sequences are never restarted.
const truncate = [
  "vehicles", "device_tokens", "favorite_places", "driver_approval_reviews", "password_reset_tokens",
  "email_verification_codes", "biometric_credentials", "user_vehicle_relations", "vehicle_files",
  "vehicle_ownership_claims", "vehicle_qr_tokens", "user_notification_preferences", "notification_test_users",
  "driver_memberships", "driver_wallets", "package_purchases", "package_price_calculations",
  "fiscal_clients", "fiscal_client_links", "fiscal_profiles", "fiscal_audit", "fiscal_billing_outbox",
  "fiscal_invoices", "fiscal_credit_notes", "membership_payment_orders", "membership_payments",
  "membership_transfer_proofs", "advertising_orders", "advertising_payments", "advertisers",
  "audit_log", "vehicle_audit", "trips", "trip_events", "driver_offers", "ratings", "incidents",
  "trip_live_locations", "trip_location_history", "trip_messages", "affiliate_banners", "admin_notifications",
  "support_incident_messages", "support_incident_attachments", "trip_stops", "scheduled_trip_responses",
  "push_delivery_events", "user_notifications", "account_deletion_requests", "membership_cycle_trip_usages",
  "membership_cycle_adjustments", "collection_point_closures", "collection_point_closure_payments",
  "collection_point_settlements", "api_usage_events", "driver_import_batches", "driver_import_rows",
  "advertising_events", "advertising_leads", "advertising_invitations", "campaign_status_history",
  "advertising_cash_closures", "advertising_payment_upload_tokens", "trip_driver_cancellations", "trip_share_links",
  "passenger_cancellations", "driver_vehicle_sessions", "fleet_notification_outbox", "vehicle_session_assignments",
  "cooperative_demo_requests", "notification_campaigns", "notification_campaign_recipients",
  "notification_analytics_events", "notification_reminder_deliveries", "notification_delivery_jobs",
  "notification_provider_incidents", "notification_trip_attributions", "notification_email_deliveries",
  "driver_wallet_movements", "trip_commercial_assignments", "arrival_search_sessions", "arrival_search_exclusions",
  "smart_notification_patterns",
];

const allExpected = [...preserve, ...conditional, ...deleteSeparately, ...truncate];
if (new Set(allExpected).size !== allExpected.length) throw new Error("Clasificación de tablas duplicada");

const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
const stableHash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex").toUpperCase();

async function protectedUsers(sql) {
  return sql`
    select u.id::text,lower(trim(u.email)) as email,u.role::text,u.status::text
    from users u where u.deleted_at is null
    order by u.id
  `;
}

async function configurationFingerprint(sql) {
  const result = {};
  for (const table of preserve.filter((name) => name !== "spatial_ref_sys")) {
    const scope = table === "membership_grace_policies" ? " where cooperative_id is null" :
      table === "pricing_versions" || table === "service_zones" ? " where active_until is null or active_until > now()" :
      table === "service_area_versions" ? " where id in(select current_version_id from service_areas)" : "";
    const [row] = await sql.unsafe(`select count(*)::text as count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as hash from ${quote(table)} t${scope}`);
    result[table] = row;
  }
  return result;
}

async function snapshot(sql) {
  const relations = await sql`
    select c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') order by c.relname
  `;
  const actual = relations.map((row) => String(row.name));
  const missing = allExpected.filter((name) => !actual.includes(name));
  const unexpected = actual.filter((name) => !allExpected.includes(name));
  const counts = {};
  for (const table of allExpected) {
    const [row] = await sql.unsafe(`select count(*)::text as total from ${quote(table)}`);
    counts[table] = row.total;
  }
  const users = await protectedUsers(sql);
  const play = await sql`
    select u.id::text,lower(u.email) as email,u.role::text,u.status::text,u.password_hash is not null as "hasPassword"
    from users u where lower(u.email) in ${sql(policy.preserveEmails)} order by u.email
  `;
  const reviewVehicle = await sql`
    select v.id::text,v.identifier,v.driver_id::text as "driverId",v.photo_id::text as "photoId",
      (select count(*)::int from vehicle_files f where f.vehicle_id=v.id) as files,
      (select count(*)::int from user_vehicle_relations r join users u on u.id=r.user_id
        where r.vehicle_id=v.id and lower(u.email)=${policy.preserveEmails[0]}) as "playRelations"
    from vehicles v where v.id=${policy.reviewVehicleId}
  `;
  const fiscal = await sql`
    select count(*) filter(where status='AUTORIZADA')::int as authorized,
      count(*) filter(where environment<>'TEST')::int as "nonTest",count(*)::int as total
    from fiscal_invoices
  `;
  const [conditionalKeep] = await sql`
    select
      (select count(*) from drivers d join users u on u.id=d.user_id where u.deleted_at is null)::int as drivers,
      (select count(*) from driver_documents d join users u on u.id=d.driver_id where u.deleted_at is null and d.status='ACTIVE')::int as driver_documents,
      (select count(*) from user_service_area_access x join users u on u.id=x.user_id where u.deleted_at is null)::int as user_service_area_access,
      (select count(*) from mobile_account_roles x join users u on u.id=x.user_id where u.deleted_at is null)::int as mobile_account_roles,
      (select count(*) from fleet_entitlements x join users u on u.id=x.user_id where u.deleted_at is null)::int as fleet_entitlements,
      (select count(distinct v.id) from vehicles v join user_vehicle_relations r on r.vehicle_id=v.id
        join users u on u.id=r.user_id where u.deleted_at is null and r.status in ('APPROVED','PENDING'))::int as vehicles,
      (select count(*) from user_vehicle_relations r join users u on u.id=r.user_id
        where u.deleted_at is null and r.status in ('APPROVED','PENDING') and exists(
          select 1 from user_vehicle_relations current_relation join users current_account on current_account.id=current_relation.user_id
          where current_relation.vehicle_id=r.vehicle_id and current_account.deleted_at is null and current_relation.status in ('APPROVED','PENDING')))::int as user_vehicle_relations,
      (select count(*) from vehicle_files f join vehicles v on v.id=f.vehicle_id
        where exists(select 1 from user_vehicle_relations r join users u on u.id=r.user_id
          where r.vehicle_id=v.id and u.deleted_at is null and r.status in ('APPROVED','PENDING'))
        and (f.id=v.photo_id or (f.kind<>'PHOTO' and not exists(select 1 from vehicle_files newer
          where newer.vehicle_id=f.vehicle_id and newer.kind=f.kind
            and (newer.created_at,newer.id)>(f.created_at,f.id)))))::int as vehicle_files
  `;
  const cooperatives = await sql`select id::text,name,status from cooperatives order by id`;
  const [configurationVersions] = await sql`select
    (select count(*) from pricing_versions)::int as "pricingCurrent",
    (select count(*) from pricing_versions where active_until is not null and active_until<=now())::int as "pricingObsolete",
    (select count(*) from service_zones)::int as "zonesCurrent",
    (select count(*) from service_zones where active_until is not null and active_until<=now())::int as "zonesObsolete",
    (select count(*) from service_area_versions)::int as "areaVersionsCurrent",
    (select count(*) from service_area_versions where id not in(select current_version_id from service_areas))::int as "areaVersionsObsolete"`;
  const [migrations] = await sql`select count(*)::int as total,max(name) as latest from schema_migrations`;
  const truncateReferences = await sql`
    select child.relname as child,parent.relname as parent,k.conname as constraint
    from pg_constraint k join pg_class child on child.oid=k.conrelid
    join pg_namespace child_ns on child_ns.oid=child.relnamespace
    join pg_class parent on parent.oid=k.confrelid
    join pg_namespace parent_ns on parent_ns.oid=parent.relnamespace
    where k.contype='f' and child_ns.nspname='public' and parent_ns.nspname='public'
      and parent.relname in ${sql(truncate)} and child.relname not in ${sql(truncate)}
    order by child.relname,parent.relname,k.conname
  `;
  const protectedIds = new Set(users.map((row) => row.id));
  const keepFleetActors = await sql`
    select 'vehicle.created_by' as reference,v.created_by::text as user_id from vehicles v
      where exists(select 1 from user_vehicle_relations r join users u on u.id=r.user_id
        where r.vehicle_id=v.id and u.deleted_at is null and r.status in ('APPROVED','PENDING')) and v.created_by is not null
    union all
    select 'vehicle_file.uploaded_by',f.uploaded_by::text from vehicle_files f
      join vehicles v on v.id=f.vehicle_id where exists(select 1 from user_vehicle_relations r join users u on u.id=r.user_id
        where r.vehicle_id=v.id and u.deleted_at is null and r.status in ('APPROVED','PENDING'))
      and (f.id=v.photo_id or (f.kind<>'PHOTO' and not exists(select 1 from vehicle_files newer
        where newer.vehicle_id=f.vehicle_id and newer.kind=f.kind
          and (newer.created_at,newer.id)>(f.created_at,f.id))))
    union all
    select 'vehicle_relation.reviewed_by',r.reviewed_by::text from user_vehicle_relations r join users u on u.id=r.user_id
      where u.deleted_at is null and r.status in ('APPROVED','PENDING') and r.reviewed_by is not null
  `;
  const blockers = [];
  if (missing.length || unexpected.length) blockers.push({code:"SCHEMA_MISMATCH",missing,unexpected});
  if (Number(migrations.total) !== policy.expectedMigrationCount || migrations.latest !== policy.expectedLatestMigration)
    blockers.push({code:"MIGRATION_MISMATCH",migrations});
  if (play.length !== 2 || play.some((row) => row.status !== "ACTIVE" || !row.hasPassword))
    blockers.push({code:"PLAY_ACCOUNT_INVALID",play});
  if (users.length !== policy.expectedRegisteredUserCount)
    blockers.push({code:"REGISTERED_USER_COUNT_CHANGED",actual:users.length,expected:policy.expectedRegisteredUserCount});
  if (Number(conditionalKeep.drivers) !== policy.expectedRegisteredDriverCount)
    blockers.push({code:"REGISTERED_DRIVER_COUNT_CHANGED",actual:conditionalKeep.drivers,expected:policy.expectedRegisteredDriverCount});
  if (cooperatives.length !== policy.expectedCooperativeCount)
    blockers.push({code:"COOPERATIVE_COUNT_CHANGED",actual:cooperatives.length,expected:policy.expectedCooperativeCount,cooperatives});
  if (reviewVehicle.length !== 1 || reviewVehicle[0].identifier !== policy.reviewVehicleIdentifier ||
      reviewVehicle[0].files !== 1 || reviewVehicle[0].playRelations !== 1)
    blockers.push({code:"PLAY_VEHICLE_INVALID",reviewVehicle});
  if (Number(fiscal[0].authorized) || Number(fiscal[0].nonTest)) blockers.push({code:"REAL_FISCAL_DOCUMENT_FOUND",fiscal:fiscal[0]});
  if (truncateReferences.length) blockers.push({code:"TRUNCATE_SET_NOT_CLOSED",references:truncateReferences});
  const unprotectedFleetActors = keepFleetActors.filter((row) => !protectedIds.has(row.user_id));
  if (unprotectedFleetActors.length) blockers.push({code:"CURRENT_FLEET_REFERENCES_DELETED_USER",references:unprotectedFleetActors});
  const [priorCleanup] = await sql`select count(*)::int as total from audit_log where action='PRODUCTION_DATA_CLEANUP'`;
  if (Number(priorCleanup.total)) blockers.push({code:"CLEANUP_ALREADY_RECORDED"});
  const config = await configurationFingerprint(sql);
  const tokenData = {counts,users,play,reviewVehicle,cooperatives,configurationVersions,fiscal,migrations,conditionalKeep,truncateReferences,keepFleetActors,config};
  return {mode:"DRY_RUN",counts,protectedUsers:users,play,reviewVehicle,cooperatives,fiscal:fiscal[0],migrations,config,
    configurationVersions,conditionalKeep,truncateReferences,keepFleetActors,blockers,planToken:stableHash(tokenData)};
}

function preview(snapshotValue) {
  const rows = [];
  for (const table of preserve) rows.push({table,current:snapshotValue.counts[table],delete:"0",keep:snapshotValue.counts[table],action:"PRESERVE"});
  const versionPruning = {
    pricing_versions: snapshotValue.configurationVersions.pricingObsolete,
    service_zones: snapshotValue.configurationVersions.zonesObsolete,
    service_area_versions: snapshotValue.configurationVersions.areaVersionsObsolete,
  };
  for (const [table, obsolete] of Object.entries(versionPruning)) {
    const row=rows.find((item)=>item.table===table);
    row.delete=String(obsolete);
    row.keep=String(Number(row.current)-Number(obsolete));
    row.action="PRUNE_OBSOLETE_VERSIONS";
  }
  const currentFleet = new Set(["vehicles","vehicle_files","user_vehicle_relations"]);
  for (const table of truncate) if (!currentFleet.has(table)) rows.push({table,current:snapshotValue.counts[table],delete:snapshotValue.counts[table],keep:"0",action:"RESET"});
  for (const table of deleteSeparately) rows.push({table,current:snapshotValue.counts[table],delete:snapshotValue.counts[table],keep:"0",action:"RESET"});
  const protectedIds = new Set(snapshotValue.protectedUsers.map((row) => row.id));
  rows.push({table:"users",current:snapshotValue.counts.users,delete:String(Number(snapshotValue.counts.users)-protectedIds.size),keep:String(protectedIds.size),action:"WHITELIST"});
  rows.push({table:"drivers",current:snapshotValue.counts.drivers,delete:String(Number(snapshotValue.counts.drivers)-Number(snapshotValue.conditionalKeep.drivers)),keep:String(snapshotValue.conditionalKeep.drivers),action:"REGISTERED_ACCOUNTS"});
  for (const table of ["driver_documents","user_service_area_access","mobile_account_roles","fleet_entitlements"]) {
    const keep=Number(snapshotValue.conditionalKeep[table]);
    rows.push({table,current:snapshotValue.counts[table],delete:String(Number(snapshotValue.counts[table])-keep),keep:String(keep),action:"PROTECTED_USERS"});
  }
  for (const table of ["vehicles","vehicle_files","user_vehicle_relations"]) {
    const keep=Number(snapshotValue.conditionalKeep[table]);
    rows.push({table,current:snapshotValue.counts[table],delete:String(Number(snapshotValue.counts[table])-keep),keep:String(keep),action:"CURRENT_REGISTERED_FLEET"});
  }
  rows.find((row)=>row.table==="driver_memberships").keep="1 COURTESY nueva";
  rows.find((row)=>row.table==="audit_log").keep="1 auditoría nueva";
  return rows.sort((a,b)=>a.table.localeCompare(b.table));
}

const db = postgres(process.env.DATABASE_URL, {max:1,connect_timeout:10,idle_timeout:5,
  connection:{application_name:execute?"ProductionDataCleanup-execute":"ProductionDataCleanup-preview"}});

try {
  if (!execute) {
    const report = await db.begin("isolation level repeatable read read only", async (sql) => {
      await sql`set local statement_timeout='30s'`;
      await sql`set local lock_timeout='3s'`;
      const state = await snapshot(sql);
      return {...state,preview:preview(state)};
    });
    console.log(JSON.stringify(report));
  } else {
    const expectedToken = process.env.CLEANUP_PLAN_TOKEN;
    if (!expectedToken) throw new Error("Falta CLEANUP_PLAN_TOKEN del preview vigente");
    const result = await db.begin(async (tx) => {
      await tx`set local statement_timeout='60s'`;
      await tx`set local lock_timeout='10s'`;
      await tx`select pg_advisory_xact_lock(hashtext('CostaGo:ProductionDataCleanup'))`;
      const before = await snapshot(tx);
      if (before.blockers.length) throw new Error(`PRECHECK_BLOCKED:${JSON.stringify(before.blockers)}`);
      if (before.planToken !== expectedToken) throw new Error("STALE_PLAN_TOKEN");

      await tx`create temp table cleanup_protected_users on commit drop as
        select id from users where deleted_at is null`;
      await tx`create temp table cleanup_keep_vehicles on commit drop as
        select distinct v.* from vehicles v join user_vehicle_relations r on r.vehicle_id=v.id
        join users u on u.id=r.user_id where u.deleted_at is null and r.status in ('APPROVED','PENDING')`;
      await tx`create temp table cleanup_keep_vehicle_photos on commit drop as select id,photo_id from cleanup_keep_vehicles`;
      await tx`update cleanup_keep_vehicles set photo_id=null,cooperative_id=null`;
      await tx`create temp table cleanup_keep_vehicle_files on commit drop as
        select f.* from vehicle_files f join vehicles v on v.id=f.vehicle_id
        where f.vehicle_id in(select id from cleanup_keep_vehicles)
          and (f.id=v.photo_id or (f.kind<>'PHOTO' and not exists(select 1 from vehicle_files newer
            where newer.vehicle_id=f.vehicle_id and newer.kind=f.kind
              and (newer.created_at,newer.id)>(f.created_at,f.id))))`;
      await tx`create temp table cleanup_keep_vehicle_relations on commit drop as
        select r.* from user_vehicle_relations r join users u on u.id=r.user_id
        where r.vehicle_id in(select id from cleanup_keep_vehicles)
          and u.deleted_at is null and r.status in ('APPROVED','PENDING')`;

      await tx.unsafe(`truncate table ${truncate.map(quote).join(", ")} continue identity restrict`);
      await tx`insert into vehicles select * from cleanup_keep_vehicles`;
      await tx`insert into vehicle_files select * from cleanup_keep_vehicle_files`;
      await tx`insert into user_vehicle_relations select * from cleanup_keep_vehicle_relations`;
      await tx`update vehicles v set photo_id=p.photo_id from cleanup_keep_vehicle_photos p where v.id=p.id`;

      await tx`update users set active_session_id=null,passenger_cancellation_count=0,
        passenger_cancellation_suspended=false,passenger_suspended_until=null,
        passenger_cancellation_total=0,passenger_cancellation_cycle_id=null`;
      await tx`delete from admin_sessions`;
      await tx`delete from passenger_cancellation_cycles`;
      await tx`delete from driver_documents where driver_id not in(select id from cleanup_protected_users) or status<>'ACTIVE'`;
      await tx`delete from user_service_area_access where user_id not in(select id from cleanup_protected_users)`;
      await tx`delete from mobile_account_roles where user_id not in(select id from cleanup_protected_users)`;
      await tx`delete from fleet_entitlements where user_id not in(select id from cleanup_protected_users)`;
      await tx`delete from drivers where user_id not in(select id from cleanup_protected_users)`;
      await tx`delete from users where id not in(select id from cleanup_protected_users)`;
      await tx`update drivers set is_available=false,rating=null,last_location=null,last_location_at=null
        where user_id in(select id from cleanup_protected_users)`;
      await tx`delete from membership_grace_policies where cooperative_id is not null`;
      await tx`delete from cooperatives`;
      await tx`delete from pricing_versions where active_until is not null and active_until<=now()`;
      await tx`delete from service_zones where active_until is not null and active_until<=now()`;
      await tx`delete from service_area_versions where id not in(select current_version_id from service_areas)`;

      const [entitlement] = await tx`
        insert into driver_memberships(driver_id,plan_id,plan_code,status,starts_at,expires_at,expiration_local_date,
          plan_snapshot,plan_type_snapshot,cycle_duration_snapshot,base_membership_amount_snapshot,
          included_trips_snapshot,extra_trip_fee_snapshot,extra_trip_share_percent_snapshot,max_renewal_amount_snapshot,
          passenger_service_additional_snapshot,estimated_next_renewal_amount,amount,currency,payment_status,
          payment_method,source,created_by,updated_by)
        select d.user_id,p.id,p.code,'ACTIVE',now(),'2099-12-31 23:59:59+00'::timestamptz,'2099-12-31'::date,
          jsonb_build_object('code',p.code,'name',p.name,'planType','PERIODIC','reviewOnly',true),
          'PERIODIC',0,0,0,0,0,0,0,0,0,'USD','COURTESY','COURTESY','COURTESY',a.id,a.id
        from drivers d join users u on u.id=d.user_id cross join membership_plans p cross join users a
        where lower(u.email)=${policy.preserveEmails[0]} and p.code=${policy.reviewEntitlement.planCode}
          and p.enabled=true and p.effective_until is null and a.id='00000000-0000-0000-0000-000000000001'
        returning id::text
      `;
      if (!entitlement) throw new Error("REVIEW_ENTITLEMENT_NOT_CREATED");

      const afterConfig = await configurationFingerprint(tx);
      if (JSON.stringify(afterConfig) !== JSON.stringify(before.config)) throw new Error("CONFIGURATION_CHANGED");
      await tx`insert into audit_log(actor_id,action,entity_type,entity_id,next_value,reason)
        values('00000000-0000-0000-0000-000000000001','PRODUCTION_DATA_CLEANUP','SYSTEM','Costa-Go',
          ${JSON.stringify({planToken:before.planToken,deletedUsers:Number(before.counts.users)-before.protectedUsers.length,
            preservedRegisteredUsers:before.protectedUsers.length,deletedCooperatives:Number(before.counts.cooperatives),reviewEntitlementId:entitlement.id})}::jsonb,
          'Limpieza controlada de datos de prueba previa al ingreso a producción')`;

      const checks = await tx`select
        (select count(*) from users)::int as users,(select count(*) from drivers)::int as drivers,
        (select count(*) from vehicles)::int as vehicles,(select count(*) from vehicle_files)::int as "vehicleFiles",
        (select count(*) from user_vehicle_relations)::int as "vehicleRelations",
        (select count(*) from driver_documents)::int as documents,(select count(*) from driver_memberships)::int as memberships,
         (select count(*) from cooperatives)::int as cooperatives,
         (select count(*) from pricing_versions where active_until is not null and active_until<=now())::int as "obsoletePricingVersions",
         (select count(*) from service_zones where active_until is not null and active_until<=now())::int as "obsoleteServiceZones",
         (select count(*) from service_area_versions where id not in(select current_version_id from service_areas))::int as "obsoleteServiceAreaVersions",
        (select count(*) from trips)::int as trips,(select count(*) from membership_payments)::int as payments,
        (select count(*) from fiscal_invoices)::int as invoices,(select count(*) from advertisers)::int as advertisers,
        (select count(*) from affiliate_banners)::int as campaigns,(select count(*) from user_notifications)::int as notifications,
        (select count(*) from audit_log)::int as audit`;
      const expected = {users:before.protectedUsers.length,drivers:Number(before.conditionalKeep.drivers),
        vehicles:Number(before.conditionalKeep.vehicles),vehicleFiles:Number(before.conditionalKeep.vehicle_files),
         vehicleRelations:Number(before.conditionalKeep.user_vehicle_relations),documents:Number(before.conditionalKeep.driver_documents),memberships:1,cooperatives:0,
         obsoletePricingVersions:0,obsoleteServiceZones:0,obsoleteServiceAreaVersions:0,
        trips:0,payments:0,invoices:0,advertisers:0,campaigns:0,notifications:0,audit:1};
      if (JSON.stringify(checks[0]) !== JSON.stringify(expected)) throw new Error(`POSTCHECK_FAILED:${JSON.stringify(checks[0])}`);
      return {mode:"EXECUTED",planToken:before.planToken,checks:checks[0],reviewEntitlementId:entitlement.id};
    });
    console.log(JSON.stringify(result));
  }
} catch (error) {
  console.error(JSON.stringify({process:policy.name,result:"FAILED",code:error.code??"CLEANUP_ERROR",message:String(error.message??error)}));
  process.exitCode=1;
} finally {
  await db.end({timeout:5});
}
