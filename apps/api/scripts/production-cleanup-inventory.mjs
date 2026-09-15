// Inventory only. Intentionally has no deletion/execution mode.
// Run from apps/api with an explicitly selected DATABASE_URL and CLEANUP_EXPECTED_HOST.
import postgres from 'postgres';
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(await readFile(resolve(here, 'production-cleanup-policy.json'), 'utf8'));
let url;
try { url = new URL(process.env.DATABASE_URL ?? ''); }
catch { throw new Error('DATABASE_URL ausente o inválida. No se intentó ninguna conexión.'); }
if (!process.env.CLEANUP_EXPECTED_HOST || url.hostname !== process.env.CLEANUP_EXPECTED_HOST) {
  throw new Error('CLEANUP_EXPECTED_HOST debe coincidir explícitamente con el destino de DATABASE_URL.');
}
if (policy.dryRun !== true || !policy.preserveEmails?.length ||
    policy.preserveAllRegisteredAccounts !== true || policy.preserveDeletedAccounts !== false ||
    policy.deleteAllCooperatives !== true || policy.pruneObsoleteConfigurationVersions !== true ||
    policy.preserveScheduledConfigurationVersions !== true) {
  throw new Error('Se requiere dryRun=true y una lista blanca no vacía.');
}
const emails = policy.preserveEmails.map(e => e.trim().toLowerCase());
if (new Set(emails).size !== emails.length) throw new Error('Lista blanca duplicada.');

const groups = {
  PRESERVE: `schema_migrations spatial_ref_sys operational_settings service_zones pricing_versions
    admin_permission_overrides driver_approval_notification_settings support_faqs
    service_area_catalog service_areas service_area_versions service_area_role_access fare_sectors
    fare_route_rules membership_plans membership_grace_policies collection_points collector_assignments
    collection_point_payment_accounts costa_go_payment_accounts advertising_plans advertising_payment_methods
    collection_point_schedules fleet_settings smart_notification_config smart_notification_patterns
    app_version_config notification_delivery_config notification_event_definitions package_commercial_rules
    mobile_admin_access`,
  CONDITIONAL: `users drivers vehicles driver_documents admin_sessions device_tokens favorite_places
    driver_approval_reviews user_service_area_access password_reset_tokens email_verification_codes
    mobile_account_roles biometric_credentials user_vehicle_relations vehicle_files vehicle_ownership_claims
    vehicle_qr_tokens fleet_entitlements user_notification_preferences notification_test_users`,
  COMMERCIAL_REVIEW: `driver_memberships driver_wallets package_purchases package_price_calculations`,
  FISCAL_REVIEW: `fiscal_clients fiscal_client_links fiscal_profiles fiscal_audit fiscal_billing_outbox
    fiscal_invoices fiscal_credit_notes membership_payment_orders membership_payments membership_transfer_proofs
    advertising_orders advertising_payments advertisers`,
  AUDIT_REVIEW: `audit_log vehicle_audit`,
  DELETE_CANDIDATE: `cooperatives trips trip_events driver_offers ratings incidents trip_live_locations trip_location_history
    trip_messages affiliate_banners admin_notifications support_incident_messages support_incident_attachments
    trip_stops scheduled_trip_responses push_delivery_events user_notifications account_deletion_requests
    membership_cycle_trip_usages membership_cycle_adjustments collection_point_closures
    collection_point_closure_payments collection_point_settlements api_usage_events driver_import_batches
    driver_import_rows advertising_events advertising_leads advertising_invitations campaign_status_history
    advertising_cash_closures advertising_payment_upload_tokens trip_driver_cancellations trip_share_links
    passenger_cancellations passenger_cancellation_cycles driver_vehicle_sessions fleet_notification_outbox
    vehicle_session_assignments cooperative_demo_requests notification_campaigns notification_campaign_recipients
    notification_analytics_events notification_reminder_deliveries notification_delivery_jobs
    notification_provider_incidents notification_trip_attributions notification_email_deliveries
    driver_wallet_movements trip_commercial_assignments arrival_search_sessions arrival_search_exclusions`
};
const classes = new Map();
for (const [kind, list] of Object.entries(groups)) {
  for (const table of list.trim().split(/\s+/)) {
    if (classes.has(table)) throw new Error(`Clasificación duplicada: ${table}`);
    classes.set(table, kind);
  }
}
const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 10, idle_timeout: 5,
  connection: { application_name: 'ProductionDataCleanup-inventory', default_transaction_read_only: 'on' } });
try {
  const report = await sql.begin('isolation level repeatable read read only', async tx => {
    await tx`set local statement_timeout = '30s'`;
    await tx`set local lock_timeout = '3s'`;
    const relations = await tx`
      select n.nspname as schema, c.relname as name, c.relkind as kind,
        c.relrowsecurity as row_security, c.relispartition as partition,
        exists(select 1 from pg_depend d where d.classid='pg_class'::regclass
          and d.objid=c.oid and d.deptype='e') as extension_owned
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%'
        and c.relkind in ('r','p','v','m','f') order by n.nspname,c.relname`;
    const result = { process: policy.name, dryRun: true, phase: 'INVENTORY_NOT_EXECUTABLE',
      createdAt: new Date().toISOString(), host: url.hostname, database: url.pathname.slice(1),
      policy, blockers: [], tables: [], whitelist: [], userSummary: [],
      note: 'Candidatos no son autorización de borrado. null significa pendiente de resolver; no equivale a cero.' };
    for (const relation of relations) {
      let classification = relation.extension_owned ? 'PRESERVE_EXTENSION' :
        relation.schema === 'public' ? classes.get(relation.name) ?? 'UNCLASSIFIED' : 'UNCLASSIFIED';
      if (relation.kind === 'v' || relation.kind === 'm') classification = 'VIEW_REVIEW';
      const row = { ...relation, classification, current: null, deleteCandidates: null, keep: null };
      // Do not execute unknown views/functions or foreign table connections while inventorying.
      if (['r','p'].includes(relation.kind) && !relation.extension_owned) {
        const [count] = await tx`select count(*)::text as total from ${tx([relation.schema, relation.name])}`;
        row.current = count.total;
      }
      if (classification === 'PRESERVE') { row.deleteCandidates = '0'; row.keep = row.current; }
      if (classification === 'DELETE_CANDIDATE') row.deleteCandidates = row.current;
      if (classification === 'UNCLASSIFIED' || relation.row_security || relation.partition) {
        result.blockers.push(`Revisión obligatoria de ${relation.schema}.${relation.name}: ${classification}, RLS=${relation.row_security}, partición=${relation.partition}`);
      }
      result.tables.push(row);
    }
    result.constraints = await tx`
      select n.nspname as schema,c.relname as table_name,k.conname as name,k.contype as type,
        pn.nspname as parent_schema,p.relname as parent_table,pg_get_constraintdef(k.oid) as definition
      from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
      left join pg_class p on p.oid=k.confrelid left join pg_namespace pn on pn.oid=p.relnamespace
      where n.nspname='public' order by c.relname,k.conname`;
    result.triggers = await tx`
      select n.nspname as schema,c.relname as table_name,t.tgname as name,t.tgenabled as enabled,
        pg_get_triggerdef(t.oid) as definition
      from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
      where not t.tgisinternal and n.nspname='public' order by c.relname,t.tgname`;
    result.columns = await tx`
      select table_schema,table_name,column_name,data_type,is_nullable,column_default
      from information_schema.columns where table_schema='public' order by table_name,ordinal_position`;
    result.functions = await tx`
      select p.proname as name,pg_get_function_identity_arguments(p.oid) as arguments,
        md5(p.prosrc) as body_fingerprint from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and not exists(select 1 from pg_depend d
        where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') order by p.proname,p.oid`;
    const names = new Set(relations.filter(r => r.schema === 'public').map(r => r.name));
    if (names.has('schema_migrations')) {
      result.migrations = await tx`select name from public.schema_migrations order by name`;
      const local = (await readdir(resolve(here, '../migrations'))).filter(n => n.endsWith('.sql'));
      const applied = new Set(result.migrations.map(r => r.name));
      result.missingMigrations = local.filter(n => !applied.has(n));
      result.unexpectedMigrations = [...applied].filter(n => !local.includes(n));
      if (result.missingMigrations.length || result.unexpectedMigrations.length) result.blockers.push('El historial de migraciones difiere del checkout.');
    } else result.blockers.push('No se encontró schema_migrations.');
    if (names.has('users')) {
      result.whitelist = await tx`select id::text,lower(trim(email)) as email,role::text,status::text
        from public.users where lower(trim(email)) in ${tx(emails)} order by email`;
      for (const email of emails) if (result.whitelist.filter(u => u.email === email).length !== 1) {
        result.blockers.push(`Cuenta ausente o ambigua: ${email}`);
      }
      result.userSummary = await tx`select role::text,status::text,count(*)::text as total
        from public.users group by role,status order by role,status`;
      const expectedRoles = { 'play.driver@costa-go.com': 'DRIVER', 'play.passenger@costa-go.com': 'PASSENGER' };
      for (const user of result.whitelist) {
        if (expectedRoles[user.email] && user.role !== expectedRoles[user.email]) result.blockers.push(`Rol inesperado para ${user.email}.`);
        if (user.status !== 'ACTIVE') result.blockers.push(`Cuenta de revisión no activa: ${user.email}.`);
      }
      if (names.has('mobile_admin_access') && names.has('admin_permission_overrides')) {
        // Preserve every registered account that has not been deleted.
        const [counts] = await tx`select count(*)::text as current,
          count(*) filter(where u.deleted_at is null)::text as keep
          from public.users u`;
        const row = result.tables.find(t => t.schema === 'public' && t.name === 'users');
        row.keep = counts.keep;
        row.deleteCandidates = String(BigInt(counts.current)-BigInt(counts.keep));
        if (Number(counts.keep) !== policy.expectedRegisteredUserCount) {
          result.blockers.push(`El total de cuentas registradas cambió: esperado ${policy.expectedRegisteredUserCount}, actual ${counts.keep}.`);
        }
      } else result.blockers.push('No se puede calcular la protección administrativa completa: faltan tablas de permisos.');
    } else result.blockers.push('No se encontró users.');
    if (names.has('fiscal_invoices')) result.fiscalSummary = await tx`
      select environment,status,count(*)::text as total from public.fiscal_invoices
      group by environment,status order by environment,status`;
    if (names.has('cooperatives')) {
      result.cooperatives = await tx`select id::text,name,status from public.cooperatives order by id`;
      if (result.cooperatives.length !== policy.expectedCooperativeCount) {
        result.blockers.push(`El total de cooperativas cambió: esperado ${policy.expectedCooperativeCount}, actual ${result.cooperatives.length}.`);
      }
    }
    if (names.has('pricing_versions') && names.has('service_zones') && names.has('service_area_versions')) {
      result.configurationVersions = await tx`select
        (select count(*)::text from pricing_versions) as pricing_total,
        (select count(*)::text from pricing_versions where active_until is not null and active_until<=now()) as pricing_obsolete,
        (select count(*)::text from service_zones) as zones_total,
        (select count(*)::text from service_zones where active_until is not null and active_until<=now()) as zones_obsolete,
        (select count(*)::text from service_area_versions) as area_versions_total,
        (select count(*)::text from service_area_versions where id not in(select current_version_id from service_areas)) as area_versions_obsolete`;
    } else result.blockers.push('No se puede calcular la depuración de versiones de configuración.');
    result.blockers.push('Conservar todas las cuentas registradas y sus perfiles actuales; eliminar cuentas ya anonimizadas y todo historial transaccional.');
    result.blockers.push('Eliminar la cooperativa de prueba y desvincular usuarios, vehículos y configuraciones dependientes.');
    result.blockers.push('Verificar respaldo restaurable, archivos externos y ventana sin escrituras antes de cualquier ejecución.');
    return result;
  });
  const output = resolve(here, '../../../artifacts/production-cleanup', new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'inventory.json'), JSON.stringify(report, null, 2)+'\n', { flag: 'wx' });
  const rows = report.tables.map(t => `| ${t.schema}.${t.name} | ${t.classification} | ${t.current ?? 'pendiente'} | ${t.deleteCandidates ?? 'pendiente'} | ${t.keep ?? 'pendiente'} |`);
  await writeFile(resolve(output, 'preview.md'), `# ProductionDataCleanup — inventario de solo lectura\n\n`+
    `Destino: ${report.host}/${report.database}. Fecha: ${report.createdAt}.\n\n`+
    `Este inventario NO es un plan ejecutable. Candidatos sujetos a revisión de dependencias.\n\n`+
    `| Entidad | Clasificación | Actuales | Candidatos a eliminar | Conservar |\n|---|---|---:|---:|---:|\n`+rows.join('\n')+
    '\n\n## Pendientes\n\n'+report.blockers.map(b => `- ${b}`).join('\n')+'\n', { flag: 'wx' });
  console.log(JSON.stringify({ output, tables: report.tables.length, blockers: report.blockers.length, dryRun: true }));
} catch (error) {
  // Avoid logging database URLs, credentials or query parameters.
  console.error(JSON.stringify({ process: policy.name, result: 'FAILED', code: error.code ?? 'INVENTORY_ERROR' }));
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
