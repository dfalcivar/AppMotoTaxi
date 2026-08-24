import { database } from "./database.js";
import type { DashboardFilters } from "./dashboard-filters.js";

export const dashboardDetailMetrics = [
  "requestedTrips", "completedTrips", "cancelledTrips", "activeTrips",
  "scheduledTrips", "searchingWithoutDriver", "withoutDriver", "connectedDrivers", "activeDrivers",
  "pendingDrivers", "averageAssignmentSeconds", "averageWaitSeconds",
  "averageTripSeconds", "openIncidents", "acceptanceRate", "cancellationRate",
  "offersSent", "offersRejected", "offersExpired", "offersTakenByAnother",
  "driverCancellationsAfterAcceptance", "averageOfferResponseSeconds",
  "delayedAssignments", "neverAccepted", "highCancellationDrivers", "lowCoverageHours"
] as const;

export type DashboardDetailMetric = typeof dashboardDetailMetrics[number];

interface DetailOptions { search: string; page: number; pageSize: number }

function tripScope(sql: ReturnType<typeof database>, filters: DashboardFilters, alias = "t") {
  return sql`
    ${sql(alias)}.requested_at >= ${filters.from}
    and ${sql(alias)}.requested_at < ${filters.to}
    and (${filters.cooperativeId ?? null}::uuid is null or ${sql(alias)}.cooperative_id=${filters.cooperativeId ?? null}::uuid)
    and (${filters.driverId ?? null}::uuid is null or ${sql(alias)}.driver_id=${filters.driverId ?? null}::uuid)
    and (${filters.sector ?? null}::text is null or ${sql(alias)}.service_zone::text=${filters.sector ?? null})
    and (${filters.status ?? null}::text is null or ${sql(alias)}.status::text=${filters.status ?? null})
    and (${filters.tripType}='ALL'
      or (${filters.tripType}='IMMEDIATE' and ${sql(alias)}.scheduled_for is null)
      or (${filters.tripType}='SCHEDULED' and ${sql(alias)}.scheduled_for is not null))
  `;
}

function tripMetricCondition(sql: ReturnType<typeof database>, metric: DashboardDetailMetric) {
  switch (metric) {
    case "completedTrips": return sql`t.status='COMPLETED'`;
    case "cancelledTrips":
    case "cancellationRate": return sql`t.status='CANCELLED'`;
    case "activeTrips": return sql`t.status in ('SEARCHING','ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS')`;
    case "scheduledTrips": return sql`t.scheduled_for is not null`;
    case "searchingWithoutDriver": return sql`t.driver_id is null and t.status='SEARCHING'`;
    case "withoutDriver": return sql`t.driver_id is null and t.status='NO_DRIVER'`;
    case "averageAssignmentSeconds": return sql`t.assigned_at is not null`;
    case "averageWaitSeconds": return sql`exists(select 1 from trip_events e where e.trip_id=t.id and e.to_status='DRIVER_ARRIVED')`;
    case "averageTripSeconds": return sql`t.completed_at is not null and t.started_at is not null`;
    case "delayedAssignments": return sql`t.assigned_at-t.requested_at > interval '2 minutes'`;
    case "neverAccepted": return sql`t.driver_id is null and (t.status='NO_DRIVER' or (t.status='SEARCHING' and t.requested_at < now()-interval '5 minutes'))`;
    default: return sql`true`;
  }
}

function result(metric: DashboardDetailMetric, options: DetailOptions, rows: any[], columns: Array<{ key: string; label: string; type?: string }>) {
  const total = Number(rows[0]?.__total ?? 0);
  return {
    metric, page: options.page, pageSize: options.pageSize, total, columns,
    rows: rows.map(({ __total: _total, ...row }) => row)
  };
}

export async function dashboardMetricDetails(filters: DashboardFilters, metric: DashboardDetailMetric, options: DetailOptions) {
  const sql = database();
  const offset = (options.page - 1) * options.pageSize;
  const search = `%${options.search.trim()}%`;

  if (metric === "lowCoverageHours") {
    const rows = await sql`
      select count(*) over()::int __total, extract(hour from t.requested_at)::int hour,
        count(*)::int requested, count(*) filter(where t.assigned_at is not null)::int assigned,
        round(count(*) filter(where t.assigned_at is not null)::numeric*100/nullif(count(*),0),1)::float8 as "coverageRate"
      from trips t where ${tripScope(sql, filters)}
      group by extract(hour from t.requested_at)
      having count(*)>0 and count(*) filter(where t.assigned_at is not null)::numeric/nullif(count(*),0)<.5
      order by hour limit ${options.pageSize} offset ${offset}
    `;
    return result(metric, options, rows, [
      {key:"hour",label:"Hora"},{key:"requested",label:"Solicitudes"},
      {key:"assigned",label:"Asignadas"},{key:"coverageRate",label:"Cobertura",type:"percent"}
    ]);
  }

  if (["connectedDrivers", "activeDrivers", "pendingDrivers", "highCancellationDrivers"].includes(metric)) {
    const statusCondition = metric === "pendingDrivers" ? sql`u.status='PENDING'`
      : metric === "connectedDrivers" ? sql`u.status='ACTIVE' and d.is_available=true and d.last_location_at > now()-interval '5 minutes'`
      : sql`u.status='ACTIVE'`;
    const cancellationCondition = metric === "highCancellationDrivers"
      ? sql`and coalesce(stats.total,0)>=3 and coalesce(stats.cancelled,0)::numeric/nullif(stats.total,0)>=.3`
      : sql``;
    const rows = await sql`
      with stats as (
        select t.driver_id, count(*)::int total,
          count(*) filter(where t.status='COMPLETED')::int completed,
          count(*) filter(where t.status='CANCELLED')::int cancelled
        from trips t where ${tripScope(sql, filters)} and t.driver_id is not null group by t.driver_id
      )
      select count(*) over()::int __total, u.id::text id, u.full_name name,
        coalesce(c.name,'Sin cooperativa') cooperative, u.status,
        case when d.last_location_at > now()-interval '5 minutes' then 'Conectado' else 'Sin conexión reciente' end connection,
        d.is_available as available, d.last_location_at as "lastActivity",
        case when d.last_location is null then null else ST_Y(d.last_location::geometry) end latitude,
        case when d.last_location is null then null else ST_X(d.last_location::geometry) end longitude,
        case when d.last_location is null then 'Sin ubicación reciente'
          when sector.name is not null and area.name is not null then sector.name||' · '||area.name
          else coalesce(sector.name,area.name,'Fuera de sectores configurados') end location,
        coalesce(stats.total,0)::int trips, coalesce(stats.completed,0)::int completed,
        coalesce(stats.cancelled,0)::int cancelled
      from users u join drivers d on d.user_id=u.id
      left join cooperatives c on c.id=u.cooperative_id left join stats on stats.driver_id=u.id
      left join lateral (
        select fare.name from fare_sectors fare
        where fare.enabled=true and ST_Covers(fare.boundary,d.last_location)
        order by fare.priority desc,ST_Area(fare.boundary) asc,fare.updated_at desc limit 1
      ) sector on true
      left join lateral (
        select service.name from service_areas service
        join service_area_versions version on version.id=service.current_version_id
        where service.enabled=true and ST_Covers(version.geometry,d.last_location::geometry)
        order by service.priority desc,ST_Area(version.geometry) asc,service.updated_at desc limit 1
      ) area on true
      where u.role='DRIVER' and u.deleted_at is null and ${statusCondition}
        and (${filters.cooperativeId ?? null}::uuid is null or u.cooperative_id=${filters.cooperativeId ?? null}::uuid)
        and (${filters.driverId ?? null}::uuid is null or u.id=${filters.driverId ?? null}::uuid)
        and (${options.search.trim()}='' or u.full_name ilike ${search} or coalesce(c.name,'') ilike ${search})
        ${cancellationCondition}
      order by d.last_location_at desc nulls last, u.full_name limit ${options.pageSize} offset ${offset}
    `;
    return result(metric, options, rows, [
      { key:"name",label:"Conductor" }, { key:"status",label:"Estado",type:"status" },
      { key:"cooperative",label:"Cooperativa" }, { key:"connection",label:"Conexión" },
      { key:"lastActivity",label:"Última actividad",type:"date" }, { key:"trips",label:"Viajes" },
      { key:"cancelled",label:"Cancelados" }, { key:"location",label:"Ubicación" }
    ]);
  }

  if (metric === "openIncidents") {
    const rows = await sql`
      select count(*) over()::int __total, i.id::text id, i.category, i.status,
        reporter.full_name reporter, i.created_at as "createdAt", i.description,
        t.id::text as "tripId"
      from incidents i left join trips t on t.id=i.trip_id
      left join users reporter on reporter.id=i.reported_by
      where i.status not in ('RESUELTO','CERRADO','RESOLVED')
        and i.created_at>=${filters.from} and i.created_at<${filters.to}
        and (${filters.cooperativeId ?? null}::uuid is null or t.cooperative_id=${filters.cooperativeId ?? null}::uuid)
        and (${options.search.trim()}='' or i.category ilike ${search} or coalesce(reporter.full_name,'') ilike ${search})
      order by i.created_at desc limit ${options.pageSize} offset ${offset}
    `;
    return result(metric, options, rows, [
      { key:"category",label:"Categoría" }, { key:"status",label:"Estado",type:"status" },
      { key:"reporter",label:"Reportado por" }, { key:"createdAt",label:"Creado",type:"date" },
      { key:"description",label:"Detalle" }
    ]);
  }

  if (["acceptanceRate", "offersSent", "offersRejected", "offersExpired", "offersTakenByAnother", "driverCancellationsAfterAcceptance", "averageOfferResponseSeconds"].includes(metric)) {
    const condition = metric === "offersRejected" ? sql`o.response_reason='DRIVER_REJECTED'`
      : metric === "offersExpired" ? sql`o.response_reason='OFFER_EXPIRED'`
      : metric === "offersTakenByAnother" ? sql`o.response_reason='TAKEN_BY_ANOTHER_DRIVER'`
      : metric === "driverCancellationsAfterAcceptance" ? sql`o.response_reason='DRIVER_CANCELLED_AFTER_ACCEPTANCE'`
      : metric === "acceptanceRate" ? sql`o.accepted=true` : sql`true`;
    const rows = await sql`
      select count(*) over()::int __total, o.id::text id, o.trip_id::text as "tripId",
        passenger.full_name passenger,
        coalesce(nullif(trim(t.origin_reference),''),'Origen sin referencia') || ' → ' ||
          coalesce(nullif(trim(t.destination_reference),''),'Destino sin referencia') as "tripRoute",
        u.full_name driver, coalesce(c.name,'Sin cooperativa') cooperative,
        o.offered_at as "offeredAt", o.responded_at as "respondedAt",
        case when o.response_reason='DRIVER_REJECTED' then 'Rechazada por el conductor'
          when o.response_reason='OFFER_EXPIRED' then 'Tiempo de respuesta agotado'
          when o.response_reason='TAKEN_BY_ANOTHER_DRIVER' then 'Aceptada por otro conductor'
          when o.response_reason='DRIVER_CANCELLED_AFTER_ACCEPTANCE' then 'Cancelada por el conductor'
          when o.accepted then 'Aceptada' when o.responded_at is null then 'Sin respuesta'
          else 'No aceptada' end result,
        case when o.responded_at is null then null else round(extract(epoch from(o.responded_at-o.offered_at)))::int end "responseSeconds"
      from driver_offers o join trips t on t.id=o.trip_id join users u on u.id=o.driver_id
      join users passenger on passenger.id=t.passenger_id
      left join cooperatives c on c.id=u.cooperative_id
      where ${tripScope(sql, filters)} and ${condition}
        and (${options.search.trim()}='' or u.full_name ilike ${search} or passenger.full_name ilike ${search}
          or o.trip_id::text ilike ${search} or coalesce(t.origin_reference,'') ilike ${search}
          or coalesce(t.destination_reference,'') ilike ${search})
      order by o.offered_at desc limit ${options.pageSize} offset ${offset}
    `;
    return result(metric, options, rows, [
      { key:"tripRoute",label:"Trayecto" }, { key:"passenger",label:"Pasajero" },
      { key:"driver",label:"Conductor" },
      { key:"cooperative",label:"Cooperativa" }, { key:"result",label:"Resultado" },
      { key:"offeredAt",label:"Enviada",type:"date" },
      { key:"responseSeconds",label:"Tiempo de respuesta",type:"duration" }
    ]);
  }

  const condition = tripMetricCondition(sql, metric);
  const rows = await sql`
    select count(*) over()::int __total, t.id::text id, t.status,
      passenger.full_name passenger, coalesce(driver.full_name,'Sin asignar') driver,
      coalesce(t.origin_reference,'Sin referencia') origin,
      coalesce(t.destination_reference,'Sin referencia') destination,
      t.quoted_total_cents as "totalCents", t.requested_at as "requestedAt",
      t.scheduled_for as "scheduledFor"
    from trips t join users passenger on passenger.id=t.passenger_id
    left join users driver on driver.id=t.driver_id
    where ${tripScope(sql, filters)} and ${condition}
      and (${options.search.trim()}='' or passenger.full_name ilike ${search}
        or coalesce(driver.full_name,'') ilike ${search} or t.id::text ilike ${search}
        or coalesce(t.origin_reference,'') ilike ${search} or coalesce(t.destination_reference,'') ilike ${search})
    order by t.requested_at desc limit ${options.pageSize} offset ${offset}
  `;
  return result(metric, options, rows, [
    { key:"status",label:"Estado",type:"status" }, { key:"passenger",label:"Pasajero" },
    { key:"driver",label:"Conductor" }, { key:"origin",label:"Origen" },
    { key:"destination",label:"Destino" }, { key:"totalCents",label:"Total",type:"money" },
    { key:"requestedAt",label:"Solicitado",type:"date" }
  ]);
}
