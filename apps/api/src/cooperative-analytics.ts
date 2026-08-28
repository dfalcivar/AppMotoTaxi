import { database } from "./database.js";

export async function cooperativeOverview(cooperativeId: string) {
  const sql = database();
  const [cooperativeRows, driverRows, tripRows, activityRows] = await Promise.all([
    sql`
      select c.id::text, c.name, c.legal_name as "legalName", c.registration_number as "registrationNumber",
        c.email, c.phone_e164 phone, c.status, c.created_at as "createdAt", c.updated_at as "updatedAt",
        count(distinct u.id)::int as "totalDrivers",
        count(distinct u.id) filter(where u.status='ACTIVE')::int as "activeDrivers",
        count(distinct u.id) filter(where u.status<>'ACTIVE')::int as "inactiveDrivers",
        count(distinct u.id) filter(where u.status='ACTIVE' and d.last_location_at>now()-interval '5 minutes')::int as "connectedDrivers",
        count(distinct t.id)::int as "totalTrips",
        count(distinct t.id) filter(where t.requested_at>=date_trunc('month',now()))::int as "tripsThisMonth",
        count(distinct t.id) filter(where t.status='COMPLETED')::int as "completedTrips",
        count(distinct t.id) filter(where t.status='CANCELLED')::int as "cancelledTrips",
        coalesce((select round(avg(dx.rating),2)::float8 from users ux join drivers dx on dx.user_id=ux.id
          where ux.cooperative_id=c.id and ux.role='DRIVER' and ux.deleted_at is null),0)::float8 as "averageRating"
      from cooperatives c left join users u on u.cooperative_id=c.id and u.role='DRIVER' and u.deleted_at is null
      left join drivers d on d.user_id=u.id left join trips t on t.cooperative_id=c.id
      where c.id=${cooperativeId}::uuid group by c.id
    `,
    sql`
      select u.id::text, u.full_name name, u.email, u.phone_e164 phone, u.status,
        coalesce(v.identifier,'Sin vehículo') vehicle, d.is_available and fleet_driver_can_receive(d.user_id) as available,
        d.last_location_at as "lastActivity", coalesce(d.rating,0)::float8 rating,
        count(t.id)::int trips,
        count(t.id) filter(where t.requested_at>=date_trunc('month',now()))::int as "tripsThisMonth",
        count(t.id) filter(where t.status='COMPLETED')::int completed,
        count(t.id) filter(where t.status='CANCELLED')::int cancelled
      from users u join drivers d on d.user_id=u.id left join lateral(select string_agg(v.identifier,', ' order by v.identifier) as identifier from vehicles v join user_vehicle_relations r on r.vehicle_id=v.id where r.user_id=u.id and r.relation_type='AUTHORIZED_DRIVER' and r.status='APPROVED' and v.merged_into is null) v on true
      left join trips t on t.driver_id=u.id
      where u.cooperative_id=${cooperativeId}::uuid and u.role='DRIVER' and u.deleted_at is null
      group by u.id,v.identifier,d.user_id,d.is_available,d.last_location_at,d.rating
      order by u.status, d.last_location_at desc nulls last, u.full_name
    `,
    sql`
      select t.id::text, t.status, passenger.full_name passenger,
        coalesce(driver.full_name,'Sin asignar') driver, t.origin_reference origin,
        t.destination_reference destination, t.quoted_total_cents as "totalCents",
        t.requested_at as "requestedAt"
      from trips t join users passenger on passenger.id=t.passenger_id
      left join users driver on driver.id=t.driver_id
      where t.cooperative_id=${cooperativeId}::uuid order by t.requested_at desc limit 100
    `,
    sql`
      select a.id::text, a.action, a.entity_type as "entityType", a.entity_id as "entityId",
        actor.full_name actor, a.reason detail, a.created_at as "createdAt"
      from audit_log a left join users actor on actor.id=a.actor_id
      where (a.entity_type='COOPERATIVE' and a.entity_id=${cooperativeId})
        or exists(select 1 from users u where u.id::text=a.entity_id and u.cooperative_id=${cooperativeId}::uuid)
      order by a.created_at desc limit 50
    `
  ]);
  if (!cooperativeRows[0]) return undefined;
  return { cooperative: cooperativeRows[0], drivers: driverRows, trips: tripRows, activity: activityRows };
}
