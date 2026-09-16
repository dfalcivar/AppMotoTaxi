import postgres from "postgres";

const db = postgres(process.env.DATABASE_URL, { max: 1 });

try {
  const report = await db.begin("isolation level repeatable read read only", async (sql) => {
    await sql`set local statement_timeout=30000`;
    const vehicles = await sql`
      select v.id::text,v.identifier,v.fleet_status as "fleetStatus",v.status::text,
        v.driver_id::text as "legacyDriverId",lower(owner.email) as "legacyDriverEmail",
        v.merged_into::text as "mergedInto",v.photo_id::text as "photoId",
        exists(select 1 from user_vehicle_relations r join users current_account on current_account.id=r.user_id
          where r.vehicle_id=v.id and current_account.deleted_at is null and r.status in ('APPROVED','PENDING')) as preserve,
        (select count(*)::int from vehicle_files f where f.vehicle_id=v.id) as files,
        array(select lower(u.email) from user_vehicle_relations r join users u on u.id=r.user_id
          where r.vehicle_id=v.id order by lower(u.email)) as users
      from vehicles v left join users owner on owner.id=v.driver_id order by preserve desc,v.identifier
    `;
    const files = await sql`
      select f.id::text,f.vehicle_id::text,v.identifier,f.kind,lower(u.email) as uploader,
        octet_length(f.original_bytes)::int as "originalBytes",
        coalesce(octet_length(f.display_bytes),0)::int as "displayBytes",
        exists(select 1 from user_vehicle_relations r join users current_account on current_account.id=r.user_id
          where r.vehicle_id=v.id and current_account.deleted_at is null and r.status in ('APPROVED','PENDING'))
          and (f.id=v.photo_id or (f.kind<>'PHOTO' and not exists(select 1 from vehicle_files newer
            where newer.vehicle_id=f.vehicle_id and newer.kind=f.kind
              and (newer.created_at,newer.id)>(f.created_at,f.id)))) as preserve
      from vehicle_files f join vehicles v on v.id=f.vehicle_id join users u on u.id=f.uploaded_by
      order by preserve desc,v.identifier,f.kind
    `;
    const documents = await sql`
      select lower(u.email) as email,d.document_type as type,d.status,count(*)::int as total,
        coalesce(sum(octet_length(d.file_data)),0)::bigint::text as bytes
      from driver_documents d join users u on u.id=d.driver_id
      group by u.email,d.document_type,d.status order by lower(u.email),d.document_type,d.status
    `;
    const relations = await sql`
      select r.id::text,v.identifier,lower(u.email) as email,r.relation_type as type,r.status,r.source
      from user_vehicle_relations r join users u on u.id=r.user_id join vehicles v on v.id=r.vehicle_id
      order by v.identifier,lower(u.email),r.relation_type
    `;
    const triggers = await sql`
      select c.relname as table_name,t.tgname as name,pg_get_triggerdef(t.oid) as definition
      from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
      where not t.tgisinternal and n.nspname='public'
        and c.relname in ('vehicle_files','vehicle_audit','driver_vehicle_sessions','vehicle_session_assignments')
      order by c.relname,t.tgname
    `;
    const fiscal = await sql`
      select 'invoice' as type,environment,status,count(*)::int as total from fiscal_invoices group by environment,status
      union all
      select 'credit_note',i.environment,n.status,count(*)::int
      from fiscal_credit_notes n join fiscal_invoices i on i.id=n.invoice_id
      group by i.environment,n.status
      order by type,environment,status
    `;
    return {mode:"READ_ONLY",vehicles,files,documents,relations,triggers,fiscal};
  });
  console.log(JSON.stringify(report));
} finally {
  await db.end({ timeout: 5 });
}
