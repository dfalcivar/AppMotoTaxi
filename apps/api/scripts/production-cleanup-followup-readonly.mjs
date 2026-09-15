import postgres from "postgres";

const db = postgres(process.env.DATABASE_URL, { max: 1 });
const playDriver = "play.driver@costa-go.com";
const playPassenger = "play.passenger@costa-go.com";

try {
  const report = await db.begin(
    "isolation level repeatable read read only",
    async (sql) => {
      await sql`set local statement_timeout=30000`;

      const users = await sql`
        select
          u.id::text,
          lower(u.email) as email,
          u.role::text,
          u.status::text,
          u.deleted_at is not null as deleted,
          exists(select 1 from mobile_admin_access a where a.user_id=u.id) as "mobileAdmin",
          exists(select 1 from admin_permission_overrides o where o.user_id=u.id) as overrides,
          array(select r.role::text from mobile_account_roles r where r.user_id=u.id order by r.role::text) as "mobileRoles",
          u.deleted_at is null as preserve
        from users u
        order by preserve desc,deleted,u.role::text,email
      `;

      const foreignKeys = await sql`
        select tc.table_name,kcu.column_name,rc.delete_rule
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu
          on kcu.constraint_schema=tc.constraint_schema and kcu.constraint_name=tc.constraint_name
        join information_schema.referential_constraints rc
          on rc.constraint_schema=tc.constraint_schema and rc.constraint_name=tc.constraint_name
        join information_schema.constraint_column_usage ccu
          on ccu.constraint_schema=rc.unique_constraint_schema and ccu.constraint_name=rc.unique_constraint_name
        where tc.constraint_type='FOREIGN KEY'
          and tc.table_schema='public'
          and ccu.table_schema='public'
          and ccu.table_name='users'
          and ccu.column_name='id'
        order by tc.table_name,kcu.column_name
      `;

      const candidateReferences = [];
      for (const fk of foreignKeys) {
        const [row] = await sql`
          select count(*)::int as total,
            count(*) filter(where ${sql(fk.column_name)} in (
              select u.id from users u
              where u.deleted_at is not null
            ))::int as candidates
          from ${sql(fk.table_name)}
        `;
        if (Number(row.candidates) > 0) candidateReferences.push({ ...fk, ...row });
      }

      const [playDependencies] = await sql`
        select
          (select count(*) from driver_memberships m where m.driver_id=u.id)::int as memberships,
          (select count(*) from membership_payment_orders o where o.driver_id=u.id)::int as orders,
          (select count(*) from membership_payments p where p.driver_id=u.id)::int as payments,
          (select count(*) from membership_cycle_trip_usages x join driver_memberships m on m.id=x.membership_cycle_id where m.driver_id=u.id)::int as usages,
          (select count(*) from membership_cycle_adjustments x join driver_memberships m on m.id=x.membership_cycle_id where m.driver_id=u.id)::int as adjustments,
          (select count(*) from package_purchases p where p.driver_id=u.id)::int as packages
        from users u where lower(u.email)=${playDriver}
      `;

      const plans = await sql`
        select id::text,code,name,plan_type,base_amount::text,currency,duration_days,included_trips
        from membership_plans
        where enabled=true and effective_from<=now() and effective_until is null
        order by plan_type,mobile_sort_order,code
      `;
      const [settings] = await sql`
        select driver_memberships_enabled as "membershipsEnabled",
          membership_enforcement_enabled as "enforcementEnabled",
          membership_timezone as timezone
        from operational_settings where id=1
      `;

      return { mode: "READ_ONLY", users, candidateReferences, playDependencies, plans, settings };
    },
  );
  console.log(JSON.stringify(report));
} finally {
  await db.end({ timeout: 5 });
}
