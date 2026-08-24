import { database } from "./database.js";
import type { DashboardFilters } from "./dashboard-filters.js";

function scope(filters: DashboardFilters) {
  return {
    from: filters.from,
    to: filters.to,
    cooperativeId: filters.cooperativeId ?? null,
    driverId: filters.driverId ?? null,
    sector: filters.sector ?? null,
    status: filters.status ?? null,
    tripType: filters.tripType
  };
}

export async function dashboardAnalytics(filters: DashboardFilters) {
  const sql = database();
  const value = scope(filters);
  const filteredTrips = (alias = "t") => sql`
    ${sql(alias)}.requested_at >= ${value.from}
    and ${sql(alias)}.requested_at < ${value.to}
    and (${value.cooperativeId}::uuid is null or ${sql(alias)}.cooperative_id=${value.cooperativeId}::uuid)
    and (${value.driverId}::uuid is null or ${sql(alias)}.driver_id=${value.driverId}::uuid)
    and (${value.sector}::text is null or ${sql(alias)}.service_zone::text=${value.sector})
    and (${value.status}::text is null or ${sql(alias)}.status::text=${value.status})
    and (${value.tripType}='ALL'
      or (${value.tripType}='IMMEDIATE' and ${sql(alias)}.scheduled_for is null)
      or (${value.tripType}='SCHEDULED' and ${sql(alias)}.scheduled_for is not null))
  `;

  const [metricsRows, dayRows, hourRows, originRows, destinationRows,
    heatRows, cooperativeRows, typeRows, incidentRows, driverRows,
    optionCooperatives, optionDrivers] = await Promise.all([
    sql`
      with filtered as materialized (
        select t.* from trips t where ${filteredTrips()}
      ), arrivals as (
        select e.trip_id, min(e.occurred_at) arrived_at
        from trip_events e join filtered f on f.id=e.trip_id
        where e.to_status='DRIVER_ARRIVED' group by e.trip_id
      ), offer_totals as (
        select count(*)::int total,
          count(*) filter (where o.accepted=true)::int accepted,
          count(*) filter (where o.response_reason='DRIVER_REJECTED')::int rejected,
          count(*) filter (where o.response_reason='OFFER_EXPIRED')::int expired,
          count(*) filter (where o.response_reason='TAKEN_BY_ANOTHER_DRIVER')::int taken,
          count(*) filter (where o.response_reason='DRIVER_CANCELLED_AFTER_ACCEPTANCE')::int cancelled_after_acceptance,
          coalesce(round(avg(extract(epoch from (o.responded_at-o.offered_at))) filter (where o.responded_at is not null))::int,0) average_response_seconds
        from driver_offers o join filtered f on f.id=o.trip_id
      )
      select
        count(*)::int as "requestedTrips",
        count(*) filter (where status='COMPLETED')::int as "completedTrips",
        count(*) filter (where status='CANCELLED')::int as "cancelledTrips",
        count(*) filter (where status in ('SEARCHING','ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS'))::int as "activeTrips",
        count(*) filter (where scheduled_for is not null)::int as "scheduledTrips",
        count(*) filter (where driver_id is null and status='SEARCHING')::int as "searchingWithoutDriver",
        count(*) filter (where driver_id is null and status='NO_DRIVER')::int as "withoutDriver",
        coalesce(round(avg(extract(epoch from (assigned_at-requested_at))) filter (where assigned_at is not null))::int,0) as "averageAssignmentSeconds",
        coalesce(round(avg(extract(epoch from (a.arrived_at-filtered.requested_at))) filter (where a.arrived_at is not null))::int,0) as "averageWaitSeconds",
        coalesce(round(avg(extract(epoch from (completed_at-started_at))) filter (where completed_at is not null and started_at is not null))::int,0) as "averageTripSeconds",
        coalesce(round(100.0 * (select accepted from offer_totals) / nullif((select total from offer_totals),0),1),0)::float8 as "acceptanceRate",
        coalesce((select total from offer_totals),0)::int as "offersSent",
        coalesce((select rejected from offer_totals),0)::int as "offersRejected",
        coalesce((select expired from offer_totals),0)::int as "offersExpired",
        coalesce((select taken from offer_totals),0)::int as "offersTakenByAnother",
        coalesce((select cancelled_after_acceptance from offer_totals),0)::int as "driverCancellationsAfterAcceptance",
        coalesce((select average_response_seconds from offer_totals),0)::int as "averageOfferResponseSeconds",
        coalesce(round(100.0 * count(*) filter (where status='CANCELLED') / nullif(count(*),0),1),0)::float8 as "cancellationRate",
        (select count(*)::int from users u join drivers d on d.user_id=u.id
          where u.role='DRIVER' and u.status='ACTIVE'
            and (${value.cooperativeId}::uuid is null or u.cooperative_id=${value.cooperativeId}::uuid)
            and (${value.driverId}::uuid is null or u.id=${value.driverId}::uuid)) as "activeDrivers",
        (select count(*)::int from users u join drivers d on d.user_id=u.id
          where u.role='DRIVER' and u.status='ACTIVE' and d.is_available=true
            and d.last_location_at > now() - interval '5 minutes'
            and (${value.cooperativeId}::uuid is null or u.cooperative_id=${value.cooperativeId}::uuid)
            and (${value.driverId}::uuid is null or u.id=${value.driverId}::uuid)) as "connectedDrivers",
        (select count(*)::int from users u where u.role='DRIVER' and u.status='PENDING'
          and (${value.cooperativeId}::uuid is null or u.cooperative_id=${value.cooperativeId}::uuid)
          and (${value.driverId}::uuid is null or u.id=${value.driverId}::uuid)) as "pendingDrivers",
        (select count(*)::int from incidents i left join trips incident_trip on incident_trip.id=i.trip_id
          where i.status not in ('RESUELTO','CERRADO') and i.created_at >= ${value.from} and i.created_at < ${value.to}
            and (${value.cooperativeId}::uuid is null or incident_trip.cooperative_id=${value.cooperativeId}::uuid)) as "openIncidents",
        count(*) filter (where assigned_at-requested_at > interval '2 minutes')::int as "delayedAssignments",
        count(*) filter (where driver_id is null and (status='NO_DRIVER' or (status='SEARCHING' and requested_at < now()-interval '5 minutes')))::int as "neverAccepted"
      from filtered left join arrivals a on a.trip_id=filtered.id
    `,
    sql`
      select to_char(date_trunc('day', t.requested_at at time zone 'America/Guayaquil'),'YYYY-MM-DD') as "day",
        count(*)::int as "requested",
        count(*) filter (where t.status='COMPLETED')::int as "completed",
        count(*) filter (where t.status='CANCELLED')::int as "cancelled"
      from trips t where ${filteredTrips()}
      group by 1 order by 1
    `,
    sql`
      select extract(hour from t.requested_at at time zone 'America/Guayaquil')::int as "hour",
        count(*)::int as "requested",
        count(*) filter (where t.assigned_at is not null)::int as "assigned"
      from trips t where ${filteredTrips()}
      group by 1 order by 1
    `,
    sql`
      select coalesce(nullif(trim(t.origin_reference),''), t.service_zone::text) label, count(*)::int value
      from trips t where ${filteredTrips()}
      group by 1 order by value desc limit 8
    `,
    sql`
      select coalesce(nullif(trim(t.destination_reference),''), t.service_zone::text) label, count(*)::int value
      from trips t where ${filteredTrips()}
      group by 1 order by value desc limit 8
    `,
    sql`
      select round(ST_Y(t.origin::geometry)::numeric,3)::float8 latitude,
        round(ST_X(t.origin::geometry)::numeric,3)::float8 longitude,
        count(*)::int weight
      from trips t where ${filteredTrips()}
      group by 1,2 order by weight desc limit 200
    `,
    sql`
      select coalesce(c.name,'Sin cooperativa') label, count(*)::int value
      from trips t left join cooperatives c on c.id=t.cooperative_id
      where ${filteredTrips()} group by 1 order by value desc
    `,
    sql`
      select case when t.scheduled_for is null then 'Inmediatos' else 'Programados' end label,
        count(*)::int value
      from trips t where ${filteredTrips()} group by 1 order by 1
    `,
    sql`
      select i.category, i.status, count(*)::int value
      from incidents i left join trips t on t.id=i.trip_id
      where i.created_at >= ${value.from} and i.created_at < ${value.to}
        and (${value.cooperativeId}::uuid is null or t.cooperative_id=${value.cooperativeId}::uuid)
        and (${value.driverId}::uuid is null or t.driver_id=${value.driverId}::uuid)
      group by i.category,i.status order by value desc
    `,
    sql`
      with filtered as materialized (
        select t.* from trips t where ${filteredTrips()}
      ), trip_stats as (
        select driver_id, count(*)::int "totalTrips",
          count(*) filter (where status='COMPLETED')::int completed,
          count(*) filter (where status='CANCELLED')::int cancelled,
          coalesce(round(avg(extract(epoch from (assigned_at-requested_at))) filter (where assigned_at is not null))::int,0) "averageAcceptSeconds",
          max(requested_at) "lastTrip"
        from filtered where driver_id is not null group by driver_id
      ), offer_stats as (
        select o.driver_id, count(*)::int offers,
          count(*) filter (where o.accepted=true)::int accepted
        from driver_offers o join filtered f on f.id=o.trip_id group by o.driver_id
      ), arrival_stats as (
        select f.driver_id,
          coalesce(round(avg(extract(epoch from (e.occurred_at-f.assigned_at))) filter (where f.assigned_at is not null))::int,0) "averageArrivalSeconds"
        from filtered f join trip_events e on e.trip_id=f.id and e.to_status='DRIVER_ARRIVED'
        where f.driver_id is not null group by f.driver_id
      ), rating_stats as (
        select r.recipient_id driver_id, round(avg(r.score),2)::float8 rating
        from ratings r join filtered f on f.id=r.trip_id group by r.recipient_id
      )
      select u.id::text, u.full_name name, coalesce(c.name,'Sin cooperativa') cooperative,
        coalesce(ts."totalTrips",0)::int as "totalTrips", coalesce(ts.completed,0)::int completed,
        coalesce(ts.cancelled,0)::int cancelled,
        coalesce(round(100.0*os.accepted/nullif(os.offers,0),1),0)::float8 as "acceptanceRate",
        coalesce(rs.rating,d.rating,0)::float8 rating,
        coalesce(ts."averageAcceptSeconds",0)::int as "averageAcceptSeconds",
        coalesce(ar."averageArrivalSeconds",0)::int as "averageArrivalSeconds",
        null::float8 kilometers, ts."lastTrip" as "lastTrip",
        u.status as "approvalStatus"
      from users u join drivers d on d.user_id=u.id
      left join cooperatives c on c.id=u.cooperative_id
      left join trip_stats ts on ts.driver_id=u.id
      left join offer_stats os on os.driver_id=u.id
      left join arrival_stats ar on ar.driver_id=u.id
      left join rating_stats rs on rs.driver_id=u.id
      where u.role='DRIVER'
        and (${value.cooperativeId}::uuid is null or u.cooperative_id=${value.cooperativeId}::uuid)
        and (${value.driverId}::uuid is null or u.id=${value.driverId}::uuid)
      order by coalesce(ts.completed,0) desc, coalesce(rs.rating,d.rating,0) desc
      limit 50
    `,
    sql`select id::text, name from cooperatives where status='ACTIVE' order by name`,
    sql`
      select u.id::text, u.full_name name, u.cooperative_id::text as "cooperativeId"
      from users u where u.role='DRIVER'
        and (${value.cooperativeId}::uuid is null or u.cooperative_id=${value.cooperativeId}::uuid)
      order by u.full_name
    `
  ]);

  const metrics = metricsRows[0] ?? {};
  const driverPerformance = [...driverRows];
  const lowCoverageHours = hourRows
    .filter(row => Number(row.requested) >= 2 && Number(row.assigned) / Number(row.requested) < .5)
    .map(row => ({ hour: Number(row.hour), requested: Number(row.requested), assigned: Number(row.assigned) }));
  const highCancellationDrivers = driverPerformance
    .filter(row => Number(row.totalTrips) >= 3 && Number(row.cancelled) / Number(row.totalTrips) >= .3)
    .slice(0, 10)
    .map(row => ({ id: row.id, name: row.name, totalTrips: row.totalTrips, cancelled: row.cancelled }));

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      ...filters,
      from: filters.from.toISOString(),
      to: filters.to.toISOString()
    },
    metrics,
    tripsByDay: dayRows,
    tripsByHour: hourRows,
    origins: originRows,
    destinations: destinationRows,
    heatmap: heatRows,
    tripsByCooperative: cooperativeRows,
    tripsByType: typeRows,
    incidents: incidentRows,
    driverPerformance,
    systemSignals: {
      delayedAssignments: Number(metrics.delayedAssignments ?? 0),
      neverAccepted: Number(metrics.neverAccepted ?? 0),
      lowCoverageHours,
      highCancellationDrivers
    },
    options: {
      cooperatives: optionCooperatives,
      drivers: optionDrivers,
      sectors: ["URBAN", "EXTENDED"],
      statuses: ["SEARCHING", "ASSIGNED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_DRIVER", "INCIDENT"]
    }
  };
}

export async function driverDashboardProfile(filters: DashboardFilters, driverId: string) {
  const sql = database();
  const scopedFilters: DashboardFilters = { ...filters, driverId };
  const value = scope(scopedFilters);
  const summary = await dashboardAnalytics(scopedFilters);
  const [profileRows, zoneRows, hourRows, incidentRows, documentRows] = await Promise.all([
    sql`
      select u.id::text, u.full_name name, u.email, u.phone_e164 phone,
        u.status as "approvalStatus", coalesce(c.name,'Sin cooperativa') cooperative,
        d.is_available as "isAvailable", d.last_location_at as "lastLocationAt",
        coalesce(d.rating,0)::float8 rating
      from users u join drivers d on d.user_id=u.id
      left join cooperatives c on c.id=u.cooperative_id
      where u.id=${driverId}::uuid and u.role='DRIVER'
    `,
    sql`
      select t.service_zone::text label, count(*)::int value
      from trips t
      where t.driver_id=${driverId}::uuid and t.requested_at>=${value.from} and t.requested_at<${value.to}
        and (${value.cooperativeId}::uuid is null or t.cooperative_id=${value.cooperativeId}::uuid)
        and (${value.sector}::text is null or t.service_zone::text=${value.sector})
        and (${value.status}::text is null or t.status::text=${value.status})
        and (${value.tripType}='ALL' or (${value.tripType}='IMMEDIATE' and t.scheduled_for is null)
          or (${value.tripType}='SCHEDULED' and t.scheduled_for is not null))
      group by 1 order by value desc
    `,
    sql`
      select extract(hour from t.requested_at at time zone 'America/Guayaquil')::int as "hour",
        count(*)::int as "value"
      from trips t
      where t.driver_id=${driverId}::uuid and t.requested_at>=${value.from} and t.requested_at<${value.to}
        and (${value.cooperativeId}::uuid is null or t.cooperative_id=${value.cooperativeId}::uuid)
        and (${value.sector}::text is null or t.service_zone::text=${value.sector})
        and (${value.status}::text is null or t.status::text=${value.status})
        and (${value.tripType}='ALL' or (${value.tripType}='IMMEDIATE' and t.scheduled_for is null)
          or (${value.tripType}='SCHEDULED' and t.scheduled_for is not null))
      group by 1 order by 1
    `,
    sql`
      select i.category, i.status, count(*)::int value
      from incidents i join trips t on t.id=i.trip_id
      where t.driver_id=${driverId}::uuid and i.created_at>=${value.from} and i.created_at<${value.to}
        and (${value.cooperativeId}::uuid is null or t.cooperative_id=${value.cooperativeId}::uuid)
      group by i.category,i.status order by value desc
    `,
    sql`
      select document_type as "documentType", status, expires_at as "expiresAt",
        reviewed_at as "reviewedAt"
      from driver_documents where driver_id=${driverId}::uuid order by document_type
    `
  ]);
  if (!profileRows[0]) return undefined;
  return {
    ...profileRows[0],
    performance: summary.driverPerformance[0] ?? {
      totalTrips: 0, completed: 0, cancelled: 0, acceptanceRate: 0,
      averageAcceptSeconds: 0, averageArrivalSeconds: 0, lastTrip: null
    },
    tripsByDay: summary.tripsByDay,
    zones: zoneRows,
    activityByHour: hourRows,
    incidents: incidentRows,
    documents: documentRows
  };
}
