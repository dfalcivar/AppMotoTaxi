import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { apiFetch, apiUrl, login, type Session, type SessionUser } from "./api.js";
import "./styles.css";
import "./settings.css";
import "./advertising.css";
import "./password-reset.css";
import "./dashboard.css";
import "./navigation.css";
import "./responsive.css";
import "./operations.css";
import "./service-areas.css";
import "./brand.css";
import { SupportAdmin } from "./support-admin.js";
import { CoverageZones } from "./service-area-admin.js";
import { AdminErrorBoundary } from "./observability.js";

type Module = "dashboard" | "operations" | "alerts" | "trips" | "drivers" | "passengers" | "cooperatives" | "pricing" | "zones" | "settings" | "advertising" | "incidents" | "access" | "audit" | "database";

const labels: Record<Module, string> = {
  dashboard: "Tablero",
  operations: "Centro de operaciones",
  alerts: "Centro de alertas",
  trips: "Viajes",
  drivers: "Conductores",
  passengers: "Pasajeros",
  cooperatives: "Cooperativas",
  pricing: "Tarifas",
  zones: "Zonas de cobertura",
  settings: "Radio de búsqueda",
  advertising: "Publicidad",
  incidents: "Soporte e incidentes",
  access: "Usuarios y roles",
  audit: "Auditoría",
  database: "PostgreSQL"
};
const icons: Record<Module, string> = { dashboard: "▦", operations: "◫", alerts: "△", trips: "↔", drivers: "◉", passengers: "◎", cooperatives: "⌂", pricing: "$", zones: "◇", settings: "⌖", advertising: "▣", incidents: "!", access: "⚿", audit: "≡", database: "◫" };
const modulePermissions: Record<Module, string[]> = {
  dashboard: ["dashboard:view", "cooperative_dashboard:view"],
  operations: ["operations:view"], alerts: ["alerts:view"],
  trips: ["trips:view"], drivers: ["drivers:view"], passengers: ["passengers:view"],
  cooperatives: ["cooperatives:view"], pricing: ["pricing:view"], zones: ["service_areas:view"],
  settings: ["settings:view"], advertising: ["advertising:view"], incidents: ["incidents:view"],
  access: ["roles:manage"], audit: ["audit:view"], database: ["database:view"]
};
const legacySupportPermissions = new Set(["dashboard:view", "passengers:view", "drivers:view", "trips:view", "support:view", "support:manage", "incidents:view", "incidents:manage", "faq:view", "faq:manage"]);
function can(user: SessionUser, permission: string) {
  if (Array.isArray(user.permissions)) return user.permissions.includes(permission);
  if (["ADMIN", "SUPER_ADMIN"].includes(user.role)) return true;
  if (["SUPPORT", "SOPORTE"].includes(user.role)) return legacySupportPermissions.has(permission);
  return false;
}
const stateLabels: Record<string, string> = {
  SEARCHING: "Buscando conductor", ASSIGNED: "Asignado", DRIVER_EN_ROUTE: "Conductor en camino",
  DRIVER_ARRIVED: "Conductor llegó", IN_PROGRESS: "Viaje en curso", COMPLETED: "Finalizado",
  CANCELLED: "Cancelado", NO_DRIVER: "Sin conductor", INCIDENT: "Incidente", PENDING: "Pendiente",
  ACTIVE: "Activo", SUSPENDED: "Suspendido", REJECTED: "Rechazado", OPEN: "Abierto",
  PENDIENTE_DOCUMENTOS: "Pendiente de documentos", PENDIENTE_REVISION: "Pendiente de revisión",
  OBSERVADO: "Observado", APROBADO: "Aprobado", RECHAZADO: "Rechazado", SUSPENDIDO: "Suspendido",
  IN_REVIEW: "En revisión", RESOLVED: "Resuelto", SCHEDULED: "Programado sin conductor",
  SCHEDULED_ASSIGNED: "Programado con conductor", SCHEDULED_READY: "Próximo a iniciar",
  ACTIVATED: "Activado", URBAN: "Urbana", EXTENDED: "Extendida",
  NUEVO: "Nuevo", ASIGNADO: "Asignado", EN_REVISION: "En revisión",
  ESPERANDO_USUARIO: "Esperando usuario", RESUELTO: "Resuelto", CERRADO: "Cerrado"
};

function errorText(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "INVALID_DASHBOARD_FILTERS") return "Revisa el período y los filtros seleccionados.";
  return message || "No se pudo completar la operación.";
}
function money(cents: number) { return `$${(Number(cents) / 100).toFixed(2)}`; }
function localDateTimeInput(value: string | Date = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function Badge({ value }: { value: string }) { return <span className={`badge ${value.toLowerCase()}`}>{stateLabels[value] ?? value.replaceAll("_", " ")}</span>; }
const pricingStatusLabels: Record<string, string> = { ACTIVE: "Activa", SCHEDULED: "Programada", FINALIZED: "Finalizada" };
function PricingBadge({ value }: { value: string }) { return <span className={`badge ${value.toLowerCase()}`}>{pricingStatusLabels[value] ?? value}</span>; }
function Header({ eyebrow, title, action }: { eyebrow: string; title: string; action?: string }) { return <div className="section-title"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>{action && <span className="muted-pill">{action}</span>}</div>; }
function Table({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) { return <div className="table-wrap"><table><thead><tr>{headers.map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} data-label={headers[j]}>{cell}</td>)}</tr>)}</tbody></table></div>; }
function Empty({ text }: { text: string }) { return <div className="empty">{text}</div>; }
function Notice({ error, success }: { error?: string; success?: string }) { return <>{error && <div className="alert error">{error}</div>}{success && <div className="alert success">{success}</div>}</>; }

function DecisionDialog({ title, description, fieldLabel = "Observación", initialValue = "", required = false, showField = true, confirmLabel, dangerous = false, busy = false, error, onCancel, onConfirm }: {
  title: string;
  description: React.ReactNode;
  fieldLabel?: string;
  initialValue?: string;
  required?: boolean;
  showField?: boolean;
  confirmLabel: string;
  dangerous?: boolean;
  busy?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (value: string) => void | Promise<void>;
}) {
  const [value, setValue] = useState(initialValue);
  const valid = !showField || !required || value.trim().length >= 5;
  return <div className="modal-backdrop decision-backdrop" role="presentation" onMouseDown={event => { if (!busy && event.target === event.currentTarget) onCancel(); }}>
    <form className="modal-card decision-modal" role="dialog" aria-modal="true" aria-labelledby="decision-dialog-title" onSubmit={event => { event.preventDefault(); if (valid && !busy) void onConfirm(value.trim()); }}>
      <div className="decision-heading"><div><span className="eyebrow">CONFIRMACIÓN</span><h2 id="decision-dialog-title">{title}</h2></div><button className="modal-close-button" type="button" aria-label="Cerrar" disabled={busy} onClick={onCancel}>×</button></div>
      <p>{description}</p>
      {showField && <label>{fieldLabel}{required && <span className="required-copy"> · obligatoria</span>}<textarea autoFocus rows={4} minLength={required ? 5 : undefined} required={required} value={value} onChange={event => setValue(event.target.value)} placeholder={required ? "Escribe al menos 5 caracteres" : "Observación opcional"} /></label>}
      <Notice error={error} />
      <div className="modal-actions decision-actions"><button className="secondary" type="button" disabled={busy} onClick={onCancel}>Cancelar</button><button className={dangerous ? "primary destructive" : "primary"} type="submit" disabled={busy || !valid}>{busy ? "Procesando…" : confirmLabel}</button></div>
    </form>
  </div>;
}

function Login({ onSession }: { onSession: (session: Session) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { onSession(await login(email.trim(), password)); } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  }
  return <div className="login-shell"><form className="login-card" onSubmit={submit}><div className="admin-brand-lockup"><img src="/costa-go-emblem.png" alt="" /><strong><span>COSTA-</span>GO</strong></div><span className="eyebrow">PLATAFORMA DE MOVILIDAD</span><h1>Centro de control</h1><p>Acceso para administración y soporte.</p><label>Correo<input autoComplete="username" type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label><label>Contraseña<input autoComplete="current-password" type="password" required value={password} onChange={e => setPassword(e.target.value)} /></label><Notice error={error} /><button className="primary" disabled={busy}>{busy ? "Ingresando…" : "Ingresar"}</button></form></div>;
}

function DashboardBars({ items, valueKey = "value", labelKey = "label" }: { items: any[]; valueKey?: string; labelKey?: string }) {
  const maximum = Math.max(1, ...items.map(item => Number(item[valueKey] ?? 0)));
  if (!items.length) return <Empty text="No hay datos para el período seleccionado." />;
  return <div className="bar-chart">{items.map((item, index) => <div className="bar-row" key={`${item[labelKey]}-${index}`}><span title={String(item[labelKey])}>{String(item[labelKey])}</span><div><i style={{ width: `${Math.max(2, Number(item[valueKey] ?? 0) * 100 / maximum)}%` }} /></div><strong>{String(item[valueKey] ?? 0)}</strong></div>)}</div>;
}

function DashboardHeatmap({ points }: { points: any[] }) {
  if (!points.length) return <Empty text="No existen coordenadas para representar." />;
  const latitudes = points.map(point => Number(point.latitude)); const longitudes = points.map(point => Number(point.longitude));
  const minLat = Math.min(...latitudes); const maxLat = Math.max(...latitudes); const minLng = Math.min(...longitudes); const maxLng = Math.max(...longitudes);
  const maximum = Math.max(1, ...points.map(point => Number(point.weight)));
  return <div className="heatmap" aria-label="Mapa de concentración de solicitudes">{points.map((point, index) => {
    const left = maxLng === minLng ? 50 : (Number(point.longitude) - minLng) * 100 / (maxLng - minLng);
    const top = maxLat === minLat ? 50 : (maxLat - Number(point.latitude)) * 100 / (maxLat - minLat);
    const size = 14 + Number(point.weight) * 30 / maximum;
    return <span key={index} title={`${point.weight} solicitudes · ${point.latitude}, ${point.longitude}`} style={{ left: `${left}%`, top: `${top}%`, width: size, height: size, opacity: .38 + Number(point.weight) * .55 / maximum }} />;
  })}<small>Norte ↑ · concentración aproximada por coordenadas agrupadas</small></div>;
}

function Dashboard({ token, cooperative = false }: { token: string; cooperative?: boolean }) {
  const today = new Date(); const monthAgo = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000);
  const dateValue = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const initial = { from: dateValue(monthAgo), to: dateValue(today), cooperativeId: "", driverId: "", sector: "", status: "", tripType: "ALL" };
  const [draft, setDraft] = useState(initial); const [filters, setFilters] = useState(initial);
  const [data, setData] = useState<any>(); const [error, setError] = useState(""); const [loading, setLoading] = useState(true); const [selectedDriver, setSelectedDriver] = useState<any>(); const [driverLoading, setDriverLoading] = useState(false);

  const dashboardQuery = (values: typeof initial) => {
    const query = new URLSearchParams();
    query.set("from", new Date(`${values.from}T00:00:00`).toISOString());
    const inclusiveTo = new Date(`${values.to}T00:00:00`); inclusiveTo.setDate(inclusiveTo.getDate() + 1); query.set("to", inclusiveTo.toISOString());
    if (values.cooperativeId) query.set("cooperativeId", values.cooperativeId);
    if (values.driverId) query.set("driverId", values.driverId);
    if (values.sector) query.set("sector", values.sector);
    if (values.status) query.set("status", values.status);
    query.set("tripType", values.tripType);
    return query.toString();
  };

  useEffect(() => {
    setLoading(true); setError("");
    const path = cooperative ? "/v1/admin/cooperative-dashboard/summary" : `/v1/admin/dashboard?${dashboardQuery(filters)}`;
    apiFetch<any>(path, token).then(setData).catch(reason => setError(errorText(reason))).finally(() => setLoading(false));
  }, [token, cooperative, filters]);

  if (cooperative) {
    if (error) return <Notice error={error} />; if (!data) return <Empty text="Cargando operación…" />;
    const labels: Record<string, string> = { totalTrips: "Viajes totales", completedTrips: "Completados", cancelledTrips: "Cancelados", passengersServed: "Pasajeros atendidos", activeDrivers: "Conductores activos" };
    return <><div className="metric-grid">{Object.entries(data).filter(([key]) => key in labels).map(([key, value]) => <article className="metric" key={key}><span>{labels[key]}</span><strong>{String(value)}</strong></article>)}</div><section className="card"><Header eyebrow="ALCANCE RESTRINGIDO" title={data.cooperative} /><p className="note">Estas cifras contienen únicamente información agregada de tu cooperativa.</p></section></>;
  }

  const setPreset = (days: number) => { const end = new Date(); const start = new Date(end.getTime() - (days - 1) * 86400000); const next = { ...draft, from: dateValue(start), to: dateValue(end) }; setDraft(next); setFilters(next); };
  const metricLabels: Record<string, { label: string; icon: string; tone: string }> = {
    requestedTrips: { label: "Viajes solicitados", icon: "↗", tone: "neutral" },
    completedTrips: { label: "Completados", icon: "✓", tone: "positive" },
    cancelledTrips: { label: "Cancelados", icon: "×", tone: "negative" },
    activeTrips: { label: "Viajes activos", icon: "●", tone: "live-tone" },
    scheduledTrips: { label: "Programados", icon: "◷", tone: "neutral" },
    withoutDriver: { label: "Sin conductor", icon: "!", tone: "warning" },
    connectedDrivers: { label: "Conductores conectados", icon: "⌁", tone: "positive" },
    activeDrivers: { label: "Conductores habilitados", icon: "◉", tone: "neutral" },
    pendingDrivers: { label: "Pendientes de aprobación", icon: "…", tone: "warning" },
    averageAssignmentSeconds: { label: "Promedio de asignación", icon: "◷", tone: "neutral" },
    averageWaitSeconds: { label: "Promedio de espera", icon: "⌛", tone: "neutral" },
    averageTripSeconds: { label: "Duración promedio", icon: "↔", tone: "neutral" },
    openIncidents: { label: "Incidentes abiertos", icon: "!", tone: "negative" },
    acceptanceRate: { label: "Aceptación", icon: "%", tone: "positive" },
    cancellationRate: { label: "Cancelación", icon: "%", tone: "negative" }
  };
  const durations = new Set(["averageAssignmentSeconds", "averageWaitSeconds", "averageTripSeconds"]); const rates = new Set(["acceptanceRate", "cancellationRate"]);
  const metricValue = (key: string, value: unknown) => durations.has(key) ? `${Math.floor(Number(value) / 60)}m ${Number(value) % 60}s` : rates.has(key) ? `${value}%` : String(value ?? 0);
  const options = data?.options ?? { cooperatives: [], drivers: [], sectors: [], statuses: [] };
  const drivers = options.drivers.filter((driver: any) => !draft.cooperativeId || driver.cooperativeId === draft.cooperativeId);
  async function openDriver(driver: any) {
    setSelectedDriver(driver); setDriverLoading(true);
    try { setSelectedDriver(await apiFetch<any>(`/v1/admin/dashboard/drivers/${driver.id}?${dashboardQuery(filters)}`, token)); }
    catch (reason) { setError(errorText(reason)); setSelectedDriver(undefined); }
    finally { setDriverLoading(false); }
  }

  return <div className="dashboard"><section className="card dashboard-filters"><Header eyebrow="FILTROS GENERALES" title="Período y alcance" action={data?.generatedAt ? `Actualizado ${new Date(data.generatedAt).toLocaleTimeString()}` : undefined} /><form onSubmit={event => { event.preventDefault(); setFilters({ ...draft }); }}><div className="filter-grid"><label>Desde<input type="date" value={draft.from} onChange={event => setDraft({ ...draft, from: event.target.value })} /></label><label>Hasta<input type="date" value={draft.to} onChange={event => setDraft({ ...draft, to: event.target.value })} /></label><label>Cooperativa<select value={draft.cooperativeId} onChange={event => setDraft({ ...draft, cooperativeId: event.target.value, driverId: "" })}><option value="">Todas</option>{options.cooperatives.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Conductor<select value={draft.driverId} onChange={event => setDraft({ ...draft, driverId: event.target.value })}><option value="">Todos</option>{drivers.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Sector<select value={draft.sector} onChange={event => setDraft({ ...draft, sector: event.target.value })}><option value="">Todos</option>{options.sectors.map((item: string) => <option key={item} value={item}>{stateLabels[item] ?? item}</option>)}</select></label><label>Estado<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}><option value="">Todos</option>{options.statuses.map((item: string) => <option key={item} value={item}>{stateLabels[item] ?? item}</option>)}</select></label><label>Tipo de viaje<select value={draft.tripType} onChange={event => setDraft({ ...draft, tripType: event.target.value })}><option value="ALL">Todos</option><option value="IMMEDIATE">Inmediatos</option><option value="SCHEDULED">Programados</option></select></label><button className="primary filter-submit"><span aria-hidden="true">✓</span> Aplicar</button></div><div className="preset-row"><button type="button" className="secondary" onClick={() => setPreset(1)}>Hoy</button><button type="button" className="secondary" onClick={() => setPreset(7)}>Esta semana</button><button type="button" className="secondary" onClick={() => setPreset(30)}>Este mes</button></div></form></section><Notice error={error} />

    {loading && <div className="skeleton-grid">{Array.from({ length: 8 }, (_, index) => <span key={index} />)}</div>}
    {!loading && data && <>
      <section className="dashboard-section"><Header eyebrow="1 · RESUMEN EJECUTIVO" title="Estado general de la operación" /><div className="metric-grid dashboard-metrics">{Object.entries(metricLabels).map(([key, metric]) => <article className={`metric dashboard-metric ${metric.tone}`} key={key}><div><span>{metric.label}</span><i aria-hidden="true">{metric.icon}</i></div><strong>{metricValue(key, data.metrics?.[key])}</strong><small>Según los filtros aplicados</small></article>)}</div></section>

      <section className="dashboard-section"><Header eyebrow="2 · DEMANDA Y ZONAS" title="Cuándo y desde dónde solicitan" /><div className="split"><article className="card"><Header eyebrow="TENDENCIA" title="Viajes por día" /><DashboardBars items={data.tripsByDay ?? []} valueKey="requested" labelKey="day" /></article><article className="card"><Header eyebrow="HORARIOS" title="Viajes por hora" /><DashboardBars items={(data.tripsByHour ?? []).map((item: any) => ({ ...item, label: `${String(item.hour).padStart(2, "0")}:00` }))} valueKey="requested" /></article></div><div className="split"><article className="card"><Header eyebrow="ORÍGENES" title="Puntos con mayor demanda" /><DashboardBars items={data.origins ?? []} /></article><article className="card"><Header eyebrow="DESTINOS" title="Destinos frecuentes" /><DashboardBars items={data.destinations ?? []} /></article></div><div className="split"><article className="card"><Header eyebrow="COORDENADAS" title="Concentración de solicitudes" /><DashboardHeatmap points={data.heatmap ?? []} /></article><article className="card"><Header eyebrow="DISTRIBUCIÓN" title="Viajes por cooperativa" /><DashboardBars items={data.tripsByCooperative ?? []} /><Header eyebrow="MODALIDAD" title="Inmediatos y programados" /><DashboardBars items={data.tripsByType ?? []} /></article></div></section>

      <section className="dashboard-section"><Header eyebrow="3 · CONDUCTORES" title="Rendimiento multidimensional" /><section className="card"><p className="note">El orden combina viajes completados y calificación. Las métricas se muestran por separado para evitar clasificaciones injustas.</p>{data.driverPerformance?.length ? <Table headers={["Conductor", "Cooperativa", "Viajes", "Completados", "Cancelados", "Aceptación", "Calificación", "Acepta en", "Llega en", "Último viaje", "Perfil"]} rows={data.driverPerformance.map((driver: any) => [driver.name, driver.cooperative, driver.totalTrips, driver.completed, driver.cancelled, `${driver.acceptanceRate}%`, `★ ${Number(driver.rating).toFixed(2)}`, metricValue("averageAssignmentSeconds", driver.averageAcceptSeconds), metricValue("averageWaitSeconds", driver.averageArrivalSeconds), driver.lastTrip ? new Date(driver.lastTrip).toLocaleString() : "Sin viajes", <button className="link" onClick={() => void openDriver(driver)}>Ver detalle</button>])} /> : <Empty text="No hay rendimiento registrado para estos filtros." />}</section></section>

      <section className="dashboard-section"><Header eyebrow="4 · OPERACIÓN" title="Señales que requieren seguimiento" /><div className="signal-grid"><article className="card"><strong>{data.systemSignals?.delayedAssignments ?? 0}</strong><span>Asignaciones con demora mayor a 2 minutos</span></article><article className="card"><strong>{data.systemSignals?.neverAccepted ?? 0}</strong><span>Solicitudes nunca aceptadas o demoradas</span></article><article className="card"><strong>{data.systemSignals?.lowCoverageHours?.length ?? 0}</strong><span>Franjas horarias con cobertura menor al 50%</span></article><article className="card"><strong>{data.systemSignals?.highCancellationDrivers?.length ?? 0}</strong><span>Conductores con cancelación alta y muestra suficiente</span></article></div>{data.systemSignals?.lowCoverageHours?.length > 0 && <section className="card"><Header eyebrow="COBERTURA" title="Horas con demanda y baja asignación" /><DashboardBars items={data.systemSignals.lowCoverageHours.map((item: any) => ({ label: `${String(item.hour).padStart(2, "0")}:00 · ${item.assigned}/${item.requested} asignados`, value: item.requested }))} /></section>}</section>

      <section className="dashboard-section"><Header eyebrow="5 · INCIDENTES Y ALERTAS" title="Casos por categoría y estado" /><section className="card">{data.incidents?.length ? <Table headers={["Categoría", "Estado", "Cantidad"]} rows={data.incidents.map((item: any) => [item.category, <Badge value={item.status} />, item.value])} /> : <Empty text="No existen incidentes en el período seleccionado." />}</section></section>
    </>}

    {selectedDriver && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedDriver(undefined); }}><section className="modal-card driver-stat-modal" role="dialog" aria-modal="true"><Header eyebrow="PERFIL ESTADÍSTICO" title={selectedDriver.name} action={selectedDriver.cooperative} />{driverLoading ? <Empty text="Calculando perfil del conductor…" /> : <><div className="metric-grid"><article className="metric"><span>Total de viajes</span><strong>{selectedDriver.performance?.totalTrips ?? selectedDriver.totalTrips}</strong></article><article className="metric"><span>Completados</span><strong>{selectedDriver.performance?.completed ?? selectedDriver.completed}</strong></article><article className="metric"><span>Cancelados</span><strong>{selectedDriver.performance?.cancelled ?? selectedDriver.cancelled}</strong></article><article className="metric"><span>Calificación</span><strong>★ {Number(selectedDriver.rating).toFixed(2)}</strong></article></div><Table headers={["Aceptación", "Tiempo para aceptar", "Tiempo hasta origen", "Estado"]} rows={[[`${selectedDriver.performance?.acceptanceRate ?? selectedDriver.acceptanceRate}%`, metricValue("averageAssignmentSeconds", selectedDriver.performance?.averageAcceptSeconds ?? selectedDriver.averageAcceptSeconds), metricValue("averageWaitSeconds", selectedDriver.performance?.averageArrivalSeconds ?? selectedDriver.averageArrivalSeconds), <Badge value={selectedDriver.approvalStatus} />]]} /><div className="split driver-detail-grid"><article><Header eyebrow="ACTIVIDAD" title="Viajes por día" /><DashboardBars items={selectedDriver.tripsByDay ?? []} valueKey="requested" labelKey="day" /></article><article><Header eyebrow="ZONAS" title="Sectores frecuentes" /><DashboardBars items={selectedDriver.zones ?? []} /></article></div><div className="split driver-detail-grid"><article><Header eyebrow="HORARIOS" title="Horas de actividad" /><DashboardBars items={(selectedDriver.activityByHour ?? []).map((item: any) => ({ ...item, label: `${String(item.hour).padStart(2, "0")}:00` }))} /></article><article><Header eyebrow="DOCUMENTOS" title="Estado de habilitantes" />{selectedDriver.documents?.length ? <Table headers={["Documento", "Estado", "Vencimiento"]} rows={selectedDriver.documents.map((item: any) => [item.documentType, <Badge value={item.status} />, item.expiresAt ? new Date(item.expiresAt).toLocaleDateString() : "Sin vencimiento"])} /> : <Empty text="No hay documentos cargados." />}</article></div><Header eyebrow="INCIDENTES" title="Casos relacionados en el período" />{selectedDriver.incidents?.length ? <Table headers={["Categoría", "Estado", "Cantidad"]} rows={selectedDriver.incidents.map((item: any) => [item.category, <Badge value={item.status} />, item.value])} /> : <Empty text="Sin incidentes en el período." />}</>}<button className="secondary" onClick={() => setSelectedDriver(undefined)}>Cerrar</button></section></div>}
  </div>;
}

function Trips({ token, admin }: { token: string; admin: boolean }) {
  const [data, setData] = useState<any[]>([]); const [error, setError] = useState("");
  const [cancelTrip, setCancelTrip] = useState<any | null>(null); const [cancelling, setCancelling] = useState(false);
  const [filters, setFilters] = useState({ scheduled: "ALL", status: "", passenger: "", driver: "", from: "", to: "", unassigned: false });
  const load = () => { const query = new URLSearchParams(); Object.entries(filters).forEach(([key, value]) => { if (value !== "" && value !== false && value !== "ALL") query.set(key, String(value)); }); return apiFetch<any[]>(`/v1/admin/trips${query.size ? `?${query}` : ""}`, token).then(setData).catch(reason => setError(errorText(reason))); };
  useEffect(() => { void load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [token, filters]);
  async function cancel(reason: string) { if (!cancelTrip) return; setCancelling(true); setError(""); try { await apiFetch(`/v1/admin/trips/${cancelTrip.id}/action`, token, { method: "POST", body: JSON.stringify({ action: "CANCEL", reason }) }); setCancelTrip(null); await load(); } catch (cause) { setError(errorText(cause)); } finally { setCancelling(false); } }
  return <><section className="card"><Header eyebrow="FILTROS" title="Viajes inmediatos y programados" action={`${data.filter(t => !["COMPLETED", "CANCELLED", "NO_DRIVER"].includes(t.status)).length} activos`} /><div className="filter-grid"><label>Tipo<select value={filters.scheduled} onChange={event => setFilters({ ...filters, scheduled: event.target.value })}><option value="ALL">Todos</option><option value="IMMEDIATE">Inmediatos</option><option value="SCHEDULED">Programados</option></select></label><label>Estado<select value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value })}><option value="">Todos</option>{["SEARCHING", "ASSIGNED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "IN_PROGRESS", "COMPLETED", "CANCELLED"].map(value => <option key={value}>{value}</option>)}</select></label><label>Pasajero<input value={filters.passenger} onChange={event => setFilters({ ...filters, passenger: event.target.value })} /></label><label>Conductor<input value={filters.driver} onChange={event => setFilters({ ...filters, driver: event.target.value })} /></label><label>Desde<input type="date" value={filters.from} onChange={event => setFilters({ ...filters, from: event.target.value })} /></label><label>Hasta<input type="date" value={filters.to} onChange={event => setFilters({ ...filters, to: event.target.value })} /></label><label className="checkbox"><input type="checkbox" checked={filters.unassigned} onChange={event => setFilters({ ...filters, unassigned: event.target.checked })} /> Solo sin conductor</label></div></section><section className="card"><Header eyebrow="OPERACIÓN" title="Viajes y asignaciones" /><Notice error={error} />{data.length ? <Table headers={["Fecha del viaje", "Pasajero", "Conductor", "Itinerario", "Estado", "Total", "Creado", "Acción"]} rows={data.map(t => [t.scheduledFor ? new Date(t.scheduledFor).toLocaleString() : "Ahora", t.passenger, t.driver, <div><strong>{t.originReference ?? "Origen"}</strong>{(t.stops?.length ? t.stops : [{ reference: t.destinationReference }]).map((stop: any, index: number) => <small key={index} className="table-line">→ {index + 1}. {stop.reference ?? "Destino"}</small>)}</div>, <div><Badge value={t.scheduleStatus ?? t.status} /><small className="table-line">{t.status}</small></div>, money(t.quotedTotalCents), new Date(t.requestedAt).toLocaleString(), admin && !["COMPLETED", "CANCELLED", "NO_DRIVER"].includes(t.status) ? <button className="link" onClick={() => { setError(""); setCancelTrip(t); }}>Cancelar</button> : "—"])} /> : <Empty text="No hay viajes para los filtros seleccionados." />}</section>{cancelTrip && <DecisionDialog title="Cancelar viaje" description={<>Esta acción avisará a <strong>{cancelTrip.passenger}</strong>{cancelTrip.driver ? <> y a <strong>{cancelTrip.driver}</strong></> : null}.</>} fieldLabel="Motivo de cancelación" initialValue="Cancelado desde el panel administrativo" required confirmLabel="Cancelar viaje" dangerous busy={cancelling} error={error} onCancel={() => { if (!cancelling) { setCancelTrip(null); setError(""); } }} onConfirm={cancel} />}</>;
}

function PasswordReset({ token, userId, userName }: { token: string; userId: string; userName: string }) {
  const [open, setOpen] = useState(false); const [password, setPassword] = useState(""); const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [success, setSuccess] = useState(false);
  function close() { if (!busy) { setOpen(false); setPassword(""); setConfirmation(""); setError(""); } }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(""); setSuccess(false);
    if (password.length < 8) { setError("La contraseña debe tener al menos 8 caracteres."); return; }
    if (password !== confirmation) { setError("Las contraseñas no coinciden."); return; }
    setBusy(true);
    try { await apiFetch(`/v1/admin/users/${userId}/reset-password`, token, { method: "POST", body: JSON.stringify({ password }) }); setSuccess(true); setOpen(false); setPassword(""); setConfirmation(""); }
    catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  }
  return <><button className="link" type="button" onClick={() => { setSuccess(false); setOpen(true); }}>Restablecer clave</button>{success && <small className="inline-success">Clave temporal actualizada</small>}{open && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><form className="modal-card" role="dialog" aria-modal="true" aria-label={`Restablecer contraseña de ${userName}`} onSubmit={submit}><Header eyebrow="SEGURIDAD" title="Restablecer contraseña" /><p>Define una clave temporal para <strong>{userName}</strong>. Se cerrarán sus sesiones activas y deberá crear una contraseña personal en su próximo ingreso.</p><label>Nueva contraseña temporal<input autoFocus autoComplete="new-password" type="password" minLength={8} maxLength={100} required value={password} onChange={event => setPassword(event.target.value)} /></label><label>Confirmar contraseña<input autoComplete="new-password" type="password" minLength={8} maxLength={100} required value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label><Notice error={error} /><div className="modal-actions"><button className="secondary" type="button" disabled={busy} onClick={close}>Cancelar</button><button className="primary" disabled={busy}>{busy ? "Guardando…" : "Restablecer y cerrar sesiones"}</button></div></form></div>}</>;
}

function DriverDocuments({ token, driver, canManage }: { token: string; driver: any; canManage: boolean }) {
  const labels: Record<string, string> = { PROFILE_PHOTO: "Foto del conductor", IDENTIFICATION: "Documento de identificación", LICENSE: "Licencia de conducir", REGISTRATION: "Matrícula de la mototaxi", OPERATING_PERMIT: "Permiso de operación" };
  const [open, setOpen] = useState(false); const [items, setItems] = useState<any[]>([]); const [error, setError] = useState(""); const [busy, setBusy] = useState("");
  const [action, setAction] = useState<{ kind: "review"; item: any; status: "ACTIVE" | "REJECTED" } | { kind: "deactivate"; item: any } | null>(null);
  async function load() { setError(""); try { setItems(await apiFetch<any[]>(`/v1/admin/drivers/${driver.id}/documents`, token)); setOpen(true); } catch (reason) { setError(errorText(reason)); } }
  async function upload(documentType: string, file?: File) { if (!file) return; if (file.size > 2_500_000 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("Usa JPG, PNG o WebP de máximo 2,5 MB."); return; } setBusy(documentType); const reader = new FileReader(); reader.onload = async () => { try { await apiFetch(`/v1/admin/drivers/${driver.id}/documents`, token, { method: "POST", body: JSON.stringify({ documentType, fileMime: file.type, fileBase64: String(reader.result).split(",")[1] }) }); await load(); } catch (reason) { setError(errorText(reason)); } finally { setBusy(""); } }; reader.onerror = () => { setBusy(""); setError("No se pudo leer el archivo."); }; reader.readAsDataURL(file); }
  function review(item: any, status: "ACTIVE" | "REJECTED") { setError(""); setAction({ kind: "review", item, status }); }
  function deactivate(item: any) { if (item.documentType === "PROFILE_PHOTO") { setError("La foto obligatoria no puede desactivarse; reemplázala por una nueva."); return; } setError(""); setAction({ kind: "deactivate", item }); }
  async function submitAction(note: string) {
    if (!action) return;
    setBusy(action.item.id); setError("");
    try {
      if (action.kind === "review") await apiFetch(`/v1/admin/drivers/${driver.id}/documents/${action.item.id}`, token, { method: "PATCH", body: JSON.stringify({ status: action.status, note }) });
      else await apiFetch(`/v1/admin/drivers/${driver.id}/documents/${action.item.id}`, token, { method: "DELETE" });
      setAction(null); await load();
    } catch (reason) { setError(errorText(reason)); } finally { setBusy(""); }
  }
  function openFile(item: any, download = false) { const bytes = Uint8Array.from(atob(item.fileBase64), char => char.charCodeAt(0)); const url = URL.createObjectURL(new Blob([bytes], { type: item.fileMime })); const anchor = document.createElement("a"); anchor.href = url; anchor.target = "_blank"; if (download) anchor.download = `${item.documentType.toLowerCase()}.${item.fileMime.split("/")[1]}`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000); }
  const actionLabel = action ? labels[action.item.documentType] ?? "documento" : "documento";
  return <><button className="link" type="button" onClick={load}>Administrar documentos</button>{open && <div className="modal-backdrop document-backdrop" role="presentation" onMouseDown={event => { if (!busy && event.target === event.currentTarget) setOpen(false); }}><section className="modal-card document-modal" role="dialog" aria-modal="true" aria-label={`Documentos de ${driver.name}`}><div className="document-modal-heading"><Header eyebrow="IDENTIDAD Y HABILITANTES" title={driver.name} action={driver.email} /><button className="modal-close-button" type="button" aria-label="Cerrar documentos" disabled={Boolean(busy)} onClick={() => setOpen(false)}>×</button></div><Notice error={error} /><div className="document-grid">{Object.entries(labels).map(([type, label]) => { const item = items.find(value => value.documentType === type); return <article className="document-item" key={type}>{item?.fileBase64 ? <img src={`data:${item.fileMime};base64,${item.fileBase64}`} alt={label} /> : <div className="document-placeholder">Sin archivo</div>}<strong>{label}</strong>{item ? <><Badge value={item.status} /><small>Cargado: {new Date(item.createdAt).toLocaleString()}</small>{item.expiresAt && <small>Vence: {new Date(item.expiresAt).toLocaleDateString()}</small>}{item.reviewNote && <small>{item.reviewNote}</small>}<div className="row-actions document-file-actions"><button className="link" type="button" onClick={() => openFile(item)}>Abrir</button><button className="link" type="button" onClick={() => openFile(item, true)}>Descargar</button></div></> : <small>Pendiente de cargar</small>}{canManage && <><label className="file-action">{item ? "Reemplazar" : "Cargar"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={Boolean(busy)} onChange={event => upload(type, event.target.files?.[0])} /></label>{item && <div className="row-actions document-review-actions"><button className="link" type="button" disabled={busy === item.id} onClick={() => review(item, "ACTIVE")}>Aprobar</button><button className="link danger" type="button" disabled={busy === item.id} onClick={() => review(item, "REJECTED")}>Rechazar</button><button className="link danger" type="button" disabled={busy === item.id} onClick={() => deactivate(item)}>Desactivar</button></div>}</>}</article>; })}</div><div className="document-modal-footer"><button className="secondary" type="button" disabled={Boolean(busy)} onClick={() => setOpen(false)}>Cerrar</button></div></section></div>}{action && <DecisionDialog title={action.kind === "deactivate" ? "Desactivar documento" : action.status === "ACTIVE" ? "Aprobar documento" : "Rechazar documento"} description={<><strong>{actionLabel}</strong> de {driver.name}</>} fieldLabel={action.kind === "review" && action.status === "ACTIVE" ? "Observación de aprobación" : "Motivo"} initialValue={action.kind === "review" ? action.status === "ACTIVE" ? "Documento verificado" : "Documento ilegible o incompleto" : ""} required={action.kind === "review"} showField={action.kind === "review"} confirmLabel={action.kind === "deactivate" ? "Sí, desactivar" : action.status === "ACTIVE" ? "Aprobar documento" : "Rechazar documento"} dangerous={action.kind === "deactivate" || (action.kind === "review" && action.status === "REJECTED")} busy={Boolean(busy)} error={error} onCancel={() => { if (!busy) { setAction(null); setError(""); } }} onConfirm={submitAction} />}</>;
}

function DriverApprovalInbox({ token, canManageDocuments, onChanged }: { token: string; canManageDocuments: boolean; onChanged: () => void }) {
  const [items, setItems] = useState<any[]>([]); const [busy, setBusy] = useState(""); const [error, setError] = useState("");
  const [decisionAction, setDecisionAction] = useState<{ driver: any; decision: "APPROVE" | "REQUEST_CORRECTIONS" | "REJECT" } | null>(null);
  const load = () => apiFetch<any[]>("/v1/admin/driver-approvals", token).then(setItems).catch(reason => setError(errorText(reason)));
  useEffect(() => { void load(); }, [token]);
  function decide(driver: any, decision: "APPROVE" | "REQUEST_CORRECTIONS" | "REJECT") { setError(""); setDecisionAction({ driver, decision }); }
  async function submitDecision(observation: string) {
    if (!decisionAction) return;
    setBusy(decisionAction.driver.id); setError("");
    try { await apiFetch(`/v1/admin/driver-approvals/${decisionAction.driver.id}/decision`, token, { method: "POST", body: JSON.stringify({ decision: decisionAction.decision, observation }) }); setDecisionAction(null); await load(); onChanged(); }
    catch (reason) { setError(errorText(reason)); } finally { setBusy(""); }
  }
  const pending = items.filter(item => ["PENDIENTE_REVISION", "OBSERVADO", "PENDIENTE_DOCUMENTOS"].includes(item.approvalStatus));
  const decisionTitles = { APPROVE: "Aprobar conductor", REQUEST_CORRECTIONS: "Solicitar correcciones", REJECT: "Rechazar conductor" };
  return <><section className="card approval-inbox"><Header eyebrow="BANDEJA DE APROBACIONES" title="Conductores pendientes" action={`${pending.length} solicitudes`} /><Notice error={error} />{pending.length ? <div className="approval-grid">{pending.map(driver => <article className="approval-card" key={driver.id}>{driver.profilePhotoBase64 ? <img src={`data:${driver.profilePhotoMime};base64,${driver.profilePhotoBase64}`} alt={driver.name} /> : <div className="approval-avatar">{driver.name?.[0] ?? "?"}</div>}<div className="approval-summary"><strong>{driver.name}</strong><small>{driver.email} · {driver.phone}</small><small>{driver.vehicle ?? "Sin vehículo"} · {driver.cooperative}</small><div><Badge value={driver.approvalStatus} /> <span>{driver.approvedDocuments}/5 aprobados</span></div>{driver.approvalObservation && <p>{driver.approvalObservation}</p>}<DriverDocuments token={token} driver={driver} canManage={canManageDocuments} /></div><div className="approval-actions"><button className="primary" disabled={busy === driver.id || driver.approvedDocuments !== 5} onClick={() => decide(driver, "APPROVE")}>Aprobar</button><button className="secondary" disabled={busy === driver.id} onClick={() => decide(driver, "REQUEST_CORRECTIONS")}>Solicitar correcciones</button><button className="link danger" disabled={busy === driver.id} onClick={() => decide(driver, "REJECT")}>Rechazar</button></div></article>)}</div> : <Empty text="No existen conductores pendientes de revisión." />}</section>{decisionAction && <DecisionDialog title={decisionTitles[decisionAction.decision]} description={<>Revisa la decisión para <strong>{decisionAction.driver.name}</strong>. El conductor recibirá este resultado en la aplicación.</>} fieldLabel={decisionAction.decision === "APPROVE" ? "Observación de aprobación" : "Observación para el conductor"} initialValue={decisionAction.decision === "APPROVE" ? "Documentación completa y verificada" : decisionAction.driver.approvalObservation ?? ""} required={decisionAction.decision !== "APPROVE"} confirmLabel={decisionTitles[decisionAction.decision]} dangerous={decisionAction.decision === "REJECT"} busy={Boolean(busy)} error={error} onCancel={() => { if (!busy) { setDecisionAction(null); setError(""); } }} onConfirm={submitDecision} />}</>;
}

function Drivers({ token, canApprove, canViewDocuments, canManageDocuments, canResetPasswords }: { token: string; canApprove: boolean; canViewDocuments: boolean; canManageDocuments: boolean; canResetPasswords: boolean }) {
  const [data, setData] = useState<any[]>([]); const [error, setError] = useState(""); const [busy, setBusy] = useState<string>();
  const [cooperatives, setCooperatives] = useState<any[]>([]);
  async function load() { try { const next = await apiFetch<any[]>("/v1/admin/drivers", token); setData(next); if (canApprove) setCooperatives(await apiFetch<any[]>("/v1/admin/cooperatives", token)); } catch (reason) { setError(errorText(reason)); } }
  useEffect(() => { void load(); }, [token, canApprove]);
  async function update(driver: any, status = driver.status, deunaEnabled = Boolean(driver.deunaEnabled), cooperativeId: string | null | undefined = driver.cooperativeId) { setBusy(driver.id); setError(""); try { await apiFetch(`/v1/admin/drivers/${driver.id}`, token, { method: "PATCH", body: JSON.stringify({ status, deunaEnabled, cooperativeId, reason: status === "ACTIVE" ? "Conductor aprobado desde el panel" : "Estado actualizado desde el panel" }) }); await load(); } catch (reason) { setError(errorText(reason)); } finally { setBusy(undefined); } }
  return <>{canApprove && <DriverApprovalInbox token={token} canManageDocuments={canManageDocuments} onChanged={() => void load()} />}<section className="card"><Header eyebrow="GESTIÓN GENERAL" title="Todos los conductores" action={`${data.length} registrados`} /><Notice error={error} />{data.length ? <Table headers={["Nombre", "Correo", "Teléfono", "Vehículo", "Cooperativa", "Documentos", "Aprobación", "De Una", "Acción"]} rows={data.map(driver => [driver.name, driver.email ?? "Sin correo", driver.phone, driver.vehicle, canApprove ? <select aria-label={`Cooperativa de ${driver.name}`} value={driver.cooperativeId ?? ""} disabled={busy === driver.id} onChange={event => update(driver, driver.status, Boolean(driver.deunaEnabled), event.target.value || null)}><option value="">Sin cooperativa</option>{cooperatives.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : driver.cooperativeName ?? "Sin cooperativa", <div><span>{driver.documents}</span>{canViewDocuments && <DriverDocuments token={token} driver={driver} canManage={canManageDocuments} />}</div>, <Badge value={driver.approvalStatus ?? driver.status} />, canApprove ? <input aria-label={`De Una para ${driver.name}`} type="checkbox" checked={Boolean(driver.deunaEnabled)} disabled={busy === driver.id} onChange={e => update(driver, driver.status, e.target.checked)} /> : "—", canResetPasswords ? <PasswordReset token={token} userId={driver.id} userName={driver.name} /> : "Solo lectura"])} /> : <Empty text="No hay conductores registrados." />}</section></>;
}

function Passengers({ token, canManage, canResetPasswords }: { token: string; canManage: boolean; canResetPasswords: boolean }) {
  const [data, setData] = useState<any[]>([]); const [error, setError] = useState("");
  const load = () => apiFetch<any[]>("/v1/admin/passengers", token).then(setData).catch(reason => setError(errorText(reason)));
  useEffect(() => { void load(); }, [token]);
  async function update(passenger: any) { try { await apiFetch(`/v1/admin/passengers/${passenger.id}`, token, { method: "PATCH", body: JSON.stringify({ status: passenger.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE", reason: "Actualización desde el panel administrativo" }) }); await load(); } catch (reason) { setError(errorText(reason)); } }
  return <section className="card"><Header eyebrow="USUARIOS" title="Pasajeros" action={`${data.length} registrados`} /><Notice error={error} />{data.length ? <Table headers={["Nombre", "Correo", "Teléfono", "Viajes", "Último viaje", "Estado", "Acción"]} rows={data.map(passenger => [passenger.name, passenger.email ?? "Sin correo", passenger.phone, passenger.trips, passenger.lastTrip ? new Date(passenger.lastTrip).toLocaleString() : "Sin viajes", <Badge value={passenger.status} />, canManage || canResetPasswords ? <div className="row-actions">{canManage && <button className="link" onClick={() => update(passenger)}>{passenger.status === "ACTIVE" ? "Suspender" : "Reactivar"}</button>}{canResetPasswords && <PasswordReset token={token} userId={passenger.id} userName={passenger.name} />}</div> : "Solo lectura"])} /> : <Empty text="No hay pasajeros registrados." />}</section>;
}

function Pricing({ token, admin }: { token: string; admin: boolean }) {
  const [data, setData] = useState<any[]>([]); const [error, setError] = useState(""); const [success, setSuccess] = useState("");
  const [form, setForm] = useState({ urbanDayCents: 50, nightCents: 100, extendedCents: 100, stopSurchargeCents: 0, promotionPassengers: 3, promotionTotalCents: 100, activeFrom: new Date().toISOString().slice(0, 16) });
  const load = () => apiFetch<any[]>("/v1/admin/pricing", token).then(setData).catch(reason => setError(errorText(reason)));
  useEffect(() => { void load(); }, [token]);
  async function save(event: React.FormEvent) { event.preventDefault(); setError(""); setSuccess(""); try { await apiFetch("/v1/admin/pricing", token, { method: "POST", body: JSON.stringify(form) }); setSuccess("Nueva versión tarifaria publicada correctamente."); await load(); } catch (reason) { setError(errorText(reason)); } }
  return <div className="split"><section className="card"><Header eyebrow="HISTORIAL" title="Versiones tarifarias" action={`${data.length} versiones`} /><p className="muted">Las versiones son históricas y no se editan. Al iniciar una nueva versión, la anterior se finaliza automáticamente.</p><Notice error={error} success={success} />{data.length ? <Table headers={["Versión", "Urbana día", "Noche", "Extendida", "Por parada", "Promoción", "Vigencia", "Estado"]} rows={data.map(price => [`v${price.version}`, money(price.urbanDayCents), money(price.nightCents), money(price.extendedCents), money(price.stopSurchargeCents ?? 0), `${price.promotionPassengers} pasajeros por ${money(price.promotionTotalCents)}`, <div><small className="table-line">Desde: {new Date(price.activeFrom).toLocaleString()}</small><small className="table-line">Hasta: {price.activeUntil ? new Date(price.activeUntil).toLocaleString() : "Sin fecha definida"}</small></div>, <PricingBadge value={price.status} />])} /> : <Empty text="No hay tarifas configuradas." />}</section>{admin && <form className="card form-card" onSubmit={save}><Header eyebrow="PUBLICAR" title="Nueva versión" /><div className="form-grid">{([ ["urbanDayCents", "Urbana de día (centavos)"], ["nightCents", "Nocturna (centavos)"], ["extendedCents", "Extendida (centavos)"], ["stopSurchargeCents", "Adicional por cada parada (centavos)"], ["promotionPassengers", "Pasajeros promoción"], ["promotionTotalCents", "Total promoción (centavos)"] ] as Array<[keyof typeof form, string]>).map(([key, label]) => <label key={key}>{label}<input min="0" required type="number" value={form[key]} onChange={e => setForm({ ...form, [key]: Number(e.target.value) })} /></label>)}<label>Vigente desde<input required type="datetime-local" value={form.activeFrom} onChange={e => setForm({ ...form, activeFrom: e.target.value })} /></label></div><button className="primary">Publicar versión</button></form>}</div>;
}

function Settings({ token, admin }: { token: string; admin: boolean }) {
  const [radius, setRadius] = useState(3000); const [success, setSuccess] = useState(""); const [error, setError] = useState("");
  const [scheduledLead, setScheduledLead] = useState(10);
  const [scheduledMinimumNotice, setScheduledMinimumNotice] = useState(30);
  const [documentExpiryDays, setDocumentExpiryDays] = useState(30);
  const [approvalSettings, setApprovalSettings] = useState({ adminEmails: [] as string[], emailEnabled: false, internalEnabled: true, pushEnabled: true });
  useEffect(() => { Promise.all([apiFetch<{ searchRadiusMeters: number; scheduledTripLeadMinutes: number; scheduledTripMinimumNoticeMinutes: number; documentExpiryAlertDays: number }>("/v1/admin/settings", token), apiFetch<typeof approvalSettings>("/v1/admin/driver-approval-settings", token)]).then(([settings, approval]) => { setRadius(settings.searchRadiusMeters); setScheduledLead(settings.scheduledTripLeadMinutes ?? 10); setScheduledMinimumNotice(settings.scheduledTripMinimumNoticeMinutes ?? 30); setDocumentExpiryDays(settings.documentExpiryAlertDays ?? 30); setApprovalSettings(approval); }).catch(reason => setError(errorText(reason))); }, [token]);
  async function save(event: React.FormEvent) { event.preventDefault(); setSuccess(""); setError(""); try { const value = await apiFetch<{ searchRadiusMeters: number; scheduledTripLeadMinutes: number; scheduledTripMinimumNoticeMinutes: number; documentExpiryAlertDays: number }>("/v1/admin/settings", token, { method: "PATCH", body: JSON.stringify({ searchRadiusMeters: radius, scheduledTripLeadMinutes: scheduledLead, scheduledTripMinimumNoticeMinutes: scheduledMinimumNotice, documentExpiryAlertDays: documentExpiryDays }) }); setRadius(value.searchRadiusMeters); setScheduledLead(value.scheduledTripLeadMinutes); setScheduledMinimumNotice(value.scheduledTripMinimumNoticeMinutes); setDocumentExpiryDays(value.documentExpiryAlertDays); setSuccess("Configuración operativa guardada."); } catch (reason) { setError(errorText(reason)); } }
  async function saveApprovals(event: React.FormEvent) { event.preventDefault(); setSuccess(""); setError(""); try { const value = await apiFetch<typeof approvalSettings>("/v1/admin/driver-approval-settings", token, { method: "PUT", body: JSON.stringify(approvalSettings) }); setApprovalSettings(value); setSuccess("Notificaciones de aprobación actualizadas."); } catch (reason) { setError(errorText(reason)); } }
  return <div className="split"><section className="card settings-card"><Header eyebrow="DESPACHO" title="Radio y viajes programados" action={`${(radius / 1000).toFixed(1)} km`} /><form onSubmit={save}><label>Distancia máxima entre el conductor disponible y el origen del pasajero<div className="radius-control"><input type="range" min="500" max="20000" step="500" value={radius} disabled={!admin} onChange={e => setRadius(Number(e.target.value))} /><input type="number" min="500" max="20000" step="500" value={radius} disabled={!admin} onChange={e => setRadius(Number(e.target.value))} /><span>metros</span></div></label><label>Tiempo mínimo para reservar con anticipación<div className="radius-control"><input type="range" min="5" max="720" step="5" value={scheduledMinimumNotice} disabled={!admin} onChange={e => setScheduledMinimumNotice(Number(e.target.value))} /><input type="number" min="5" max="720" step="5" value={scheduledMinimumNotice} disabled={!admin} onChange={e => setScheduledMinimumNotice(Number(e.target.value))} /><span>minutos</span></div></label><p className="note">Una reserva no puede crearse si falta menos de este tiempo.</p><label>Anticipación para activar y recordar un viaje programado<div className="radius-control"><input type="range" min="5" max="60" step="5" value={scheduledLead} disabled={!admin} onChange={e => setScheduledLead(Number(e.target.value))} /><input type="number" min="5" max="60" step="5" value={scheduledLead} disabled={!admin} onChange={e => setScheduledLead(Number(e.target.value))} /><span>minutos</span></div></label><p className="note">El sistema convierte la reserva al flujo activo y avisa a ambas partes con esta anticipación.</p><Notice error={error} success={success} />{admin && <button className="primary" type="submit">Guardar configuración</button>}</form></section><section className="card form-card"><Header eyebrow="APROBACIONES" title="Avisos administrativos" /><form onSubmit={saveApprovals}><label>Correos administrativos<input type="text" disabled={!admin} value={approvalSettings.adminEmails.join(", ")} onChange={event => setApprovalSettings({ ...approvalSettings, adminEmails: event.target.value.split(",").map(value => value.trim()).filter(Boolean) })} placeholder="operaciones@empresa.com, admin@empresa.com" /></label><label><input type="checkbox" disabled={!admin} checked={approvalSettings.internalEnabled} onChange={event => setApprovalSettings({ ...approvalSettings, internalEnabled: event.target.checked })} /> Notificación interna</label><label><input type="checkbox" disabled={!admin} checked={approvalSettings.emailEnabled} onChange={event => setApprovalSettings({ ...approvalSettings, emailEnabled: event.target.checked })} /> Notificación por correo</label><label><input type="checkbox" disabled={!admin} checked={approvalSettings.pushEnabled} onChange={event => setApprovalSettings({ ...approvalSettings, pushEnabled: event.target.checked })} /> Respuesta push al conductor</label><p className="note">El correo requiere RESEND_API_KEY y NOTIFICATION_FROM_EMAIL en la API. Las direcciones no se guardan en el código.</p>{admin && <button className="primary">Guardar avisos</button>}</form></section></div>;
}

function DocumentExpirySettings({ token, admin }: { token: string; admin: boolean }) {
  const [days, setDays] = useState(30); const [error, setError] = useState(""); const [success, setSuccess] = useState("");
  useEffect(() => { apiFetch<any>("/v1/admin/settings",token).then(value => setDays(value.documentExpiryAlertDays ?? 30)).catch(reason => setError(errorText(reason))); },[token]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError(""); setSuccess("");
    try {
      const current = await apiFetch<any>("/v1/admin/settings",token);
      const value = await apiFetch<any>("/v1/admin/settings",token,{ method:"PATCH", body:JSON.stringify({ searchRadiusMeters:current.searchRadiusMeters, scheduledTripLeadMinutes:current.scheduledTripLeadMinutes, scheduledTripMinimumNoticeMinutes:current.scheduledTripMinimumNoticeMinutes, documentExpiryAlertDays:days }) });
      setDays(value.documentExpiryAlertDays); setSuccess("Anticipación para documentos actualizada.");
    } catch(reason) { setError(errorText(reason)); }
  }
  return <section className="card settings-card expiry-settings"><Header eyebrow="DOCUMENTOS" title="Alertas de vencimiento" action={`${days} días`} /><form onSubmit={save}><label>Días de anticipación<div className="radius-control"><input type="range" min="1" max="180" step="1" value={days} disabled={!admin} onChange={event => setDays(Number(event.target.value))} /><input type="number" min="1" max="180" value={days} disabled={!admin} onChange={event => setDays(Number(event.target.value))} /><span>días</span></div></label><p className="note">El Centro de alertas incluirá licencias, matrículas, identificaciones y permisos antes de que venzan.</p><Notice error={error} success={success} />{admin && <button className="primary" type="submit">Guardar anticipación</button>}</form></section>;
}

function Advertising({ token, admin }: { token: string; admin: boolean }) {
  const emptyForm = () => ({ title: "", placement: "PASSENGER_HOME", targetUrl: "", startsAt: localDateTimeInput(), endsAt: localDateTimeInput(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)), sortOrder: 0, active: true, imageBase64: "", imageMime: "" });
  const [data, setData] = useState<any[]>([]); const [error, setError] = useState(""); const [success, setSuccess] = useState(""); const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const load = () => apiFetch<any[]>("/v1/admin/banners", token).then(setData).catch(reason => setError(errorText(reason)));
  useEffect(() => { void load(); }, [token]);
  function resetForm() { setEditingId(null); setForm(emptyForm()); }
  function edit(item: any) {
    setError(""); setSuccess(""); setEditingId(item.id);
    setForm({ title: item.title, placement: item.placement, targetUrl: item.targetUrl ?? "", startsAt: localDateTimeInput(item.startsAt), endsAt: item.endsAt ? localDateTimeInput(item.endsAt) : localDateTimeInput(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)), sortOrder: item.sortOrder, active: item.active, imageBase64: "", imageMime: "" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function choose(file?: File) {
    setError(""); if (!file) return;
    if (file.size > 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("Usa una imagen JPG, PNG o WebP de máximo 1 MB."); return; }
    const url = URL.createObjectURL(file); const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); if (image.naturalWidth !== 1200 || image.naturalHeight !== 400) { setError(`La imagen mide ${image.naturalWidth}×${image.naturalHeight}. Debe medir exactamente 1200×400 px.`); return; } const reader = new FileReader(); reader.onload = () => setForm(previous => ({ ...previous, imageBase64: String(reader.result).split(",")[1] ?? "", imageMime: file.type })); reader.readAsDataURL(file); };
    image.onerror = () => { URL.revokeObjectURL(url); setError("No se pudo leer la imagen seleccionada."); }; image.src = url;
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError(""); setSuccess("");
    if (!editingId && !form.imageBase64) { setError("Selecciona el banner de 1200×400 px."); return; }
    if (new Date(form.endsAt) <= new Date(form.startsAt)) { setError("La fecha final debe ser posterior a la fecha de inicio."); return; }
    const { imageBase64, imageMime, ...fields } = form;
    const payload = {
      ...fields,
      startsAt: new Date(form.startsAt).toISOString(),
      endsAt: new Date(form.endsAt).toISOString(),
      ...(imageBase64 ? { imageBase64, imageMime } : {})
    };
    setBusy(true);
    try {
      await apiFetch(editingId ? `/v1/admin/banners/${editingId}` : "/v1/admin/banners", token, { method: editingId ? "PATCH" : "POST", body: JSON.stringify(payload) });
      setSuccess(editingId ? "Publicidad actualizada con su nueva vigencia." : "Banner publicado con finalización automática.");
      resetForm(); await load();
    } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  }
  async function toggle(item: any) { try { await apiFetch(`/v1/admin/banners/${item.id}`, token, { method: "PATCH", body: JSON.stringify({ active: !item.active }) }); setSuccess(item.active ? "Publicidad desactivada." : "Publicidad activada."); await load(); } catch (reason) { setError(errorText(reason)); } }
  return <div className="advertising-layout">
    <section className="card">
      <Header eyebrow="COMERCIOS AFILIADOS" title="Banners publicados" action={`${data.filter(item => item.active).length} activos`} />
      <Notice error={error} success={success} />
      <p className="note">Las campañas aparecen al pasajero durante su vigencia y se retiran automáticamente al llegar la fecha final. Cuando no hay campañas se muestra permanentemente la pieza fija «Tu publicidad aquí».</p>
      <div className="banner-grid">
        <article className="banner-placeholder-card permanent"><img src="/advertising-placeholder.png" alt="Tu publicidad aquí" /><div><strong>Tu publicidad aquí · pieza fija</strong><p>Respaldo permanente de la app. Se muestra automáticamente cuando no existen campañas vigentes.</p></div></article>
        {data.map(item => <article className={`banner-card ${item.active ? "" : "inactive"}`} key={item.id}>
        <img src={apiUrl(`/v1/banners/${item.id}/image?v=${encodeURIComponent(item.updatedAt)}`)} alt={item.title} />
        <div><strong>{item.title}</strong><small>Inicio del pasajero · orden {item.sortOrder}</small><small>{new Date(item.startsAt).toLocaleString()} — {item.endsAt ? new Date(item.endsAt).toLocaleString() : "sin fecha final"}</small></div>
        {admin && <div className="banner-actions"><button className="secondary" onClick={() => edit(item)}>Editar</button><button className="secondary" onClick={() => toggle(item)}>{item.active ? "Desactivar" : "Activar"}</button></div>}
        </article>)}
      </div>
    </section>
    {admin && <form className="card form-card advertising-form" onSubmit={save}>
      <Header eyebrow={editingId ? "EDITAR BANNER" : "NUEVO BANNER"} title={editingId ? "Modificar publicidad" : "Publicar anuncio"} />
      <p className="banner-spec">1200×400 px · JPG, PNG o WebP · máximo 1 MB</p>
      <div className="placement-note"><strong>Campaña con vigencia automática</strong><span>La pieza «Tu publicidad aquí» queda como respaldo permanente cuando no existan campañas activas.</span></div>
      <label>Comercio o campaña<input required minLength={3} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
      <label>{editingId ? "Reemplazar imagen (opcional)" : "Imagen"}<input required={!editingId} type="file" accept="image/jpeg,image/png,image/webp" onChange={e => choose(e.target.files?.[0])} /></label>
      {form.imageBase64 && <img className="banner-preview" src={`data:${form.imageMime};base64,${form.imageBase64}`} alt="Vista previa" />}
      <label>Enlace opcional<input type="url" placeholder="https://comercio.example" value={form.targetUrl} onChange={e => setForm({ ...form, targetUrl: e.target.value })} /></label>
      <div className="form-grid">
        <label>Mostrar desde<input required type="datetime-local" value={form.startsAt} onChange={e => setForm({ ...form, startsAt: e.target.value })} /></label>
        <label>Mostrar hasta<input required type="datetime-local" value={form.endsAt} onChange={e => setForm({ ...form, endsAt: e.target.value })} /></label>
        <label>Orden<input type="number" min="0" max="999" value={form.sortOrder} onChange={e => setForm({ ...form, sortOrder: Number(e.target.value) })} /></label>
        <label className="check-label"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> Publicidad activa</label>
      </div>
      <div className="form-actions"><button className="primary" disabled={busy}>{busy ? "Guardando…" : editingId ? "Guardar cambios" : "Publicar banner"}</button>{editingId && <button className="secondary" type="button" onClick={resetForm}>Cancelar edición</button>}</div>
    </form>}
  </div>;
}

function Cooperatives({ token, canManage }: { token: string; canManage: boolean }) {
  const [data, setData] = useState<any[]>([]); const [error, setError] = useState(""); const [success, setSuccess] = useState("");
  const [form, setForm] = useState({ name: "", legalName: "", registrationNumber: "", email: "", phone: "", status: "ACTIVE" });
  const load = () => apiFetch<any[]>("/v1/admin/cooperatives", token).then(setData).catch(reason => setError(errorText(reason)));
  useEffect(() => { void load(); }, [token]);
  async function save(event: React.FormEvent) { event.preventDefault(); setError(""); setSuccess(""); try { await apiFetch("/v1/admin/cooperatives", token, { method: "POST", body: JSON.stringify(form) }); setForm({ name: "", legalName: "", registrationNumber: "", email: "", phone: "", status: "ACTIVE" }); setSuccess("Cooperativa registrada."); await load(); } catch (reason) { setError(errorText(reason)); } }
  async function changeStatus(item: any) { const status = item.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE"; try { await apiFetch(`/v1/admin/cooperatives/${item.id}`, token, { method: "PATCH", body: JSON.stringify({ status }) }); await load(); } catch (reason) { setError(errorText(reason)); } }
  return <div className="split"><section className="card"><Header eyebrow="ORGANIZACIONES" title="Cooperativas" action={`${data.length} registradas`} /><Notice error={error} success={success} />{data.length ? <Table headers={["Nombre", "RUC / registro", "Contacto", "Conductores", "Estado", "Acción"]} rows={data.map(item => [item.name, item.registrationNumber ?? "Sin registrar", <div>{item.email ?? "Sin correo"}<br /><small>{item.phone ?? "Sin teléfono"}</small></div>, item.drivers, <Badge value={item.status} />, canManage ? <button className="link" onClick={() => changeStatus(item)}>{item.status === "ACTIVE" ? "Suspender" : "Activar"}</button> : "Solo lectura"])} /> : <Empty text="No existen cooperativas registradas." />}</section>{canManage && <form className="card form-card" onSubmit={save}><Header eyebrow="NUEVO REGISTRO" title="Agregar cooperativa" /><label>Nombre<input required minLength={3} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label><label>Razón social<input value={form.legalName} onChange={event => setForm({ ...form, legalName: event.target.value })} /></label><label>RUC o registro<input value={form.registrationNumber} onChange={event => setForm({ ...form, registrationNumber: event.target.value })} /></label><label>Correo<input type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label><label>Teléfono<input value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} /></label><button className="primary">Guardar cooperativa</button></form>}</div>;
}

function AccessManagement({ token }: { token: string }) {
  const [users, setUsers] = useState<any[]>([]); const [roles, setRoles] = useState<any[]>([]); const [cooperatives, setCooperatives] = useState<any[]>([]);
  const [error, setError] = useState(""); const [success, setSuccess] = useState(""); const [busy, setBusy] = useState("");
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", password: "", role: "SOPORTE", cooperativeId: "" });
  async function load() { try { const [nextUsers, nextRoles, nextCooperatives] = await Promise.all([apiFetch<any[]>("/v1/admin/access/users", token), apiFetch<any[]>("/v1/admin/access/roles", token), apiFetch<any[]>("/v1/admin/cooperatives", token)]); setUsers(nextUsers); setRoles(nextRoles); setCooperatives(nextCooperatives); } catch (reason) { setError(errorText(reason)); } }
  useEffect(() => { void load(); }, [token]);
  function updateDraft(id: string, values: Record<string, unknown>) { setUsers(current => current.map(user => user.id === id ? { ...user, ...values } : user)); }
  async function save(user: any) { setBusy(user.id); setError(""); setSuccess(""); try { await apiFetch(`/v1/admin/access/users/${user.id}`, token, { method: "PATCH", body: JSON.stringify({ role: user.role, cooperativeId: user.cooperativeId || null, overrides: user.overrides ?? [] }) }); setSuccess(`Acceso actualizado para ${user.name}. Deberá iniciar sesión nuevamente.`); await load(); } catch (reason) { setError(errorText(reason)); } finally { setBusy(""); } }
  async function create(event: React.FormEvent) { event.preventDefault(); setBusy("new"); setError(""); setSuccess(""); try { await apiFetch("/v1/admin/access/users", token, { method: "POST", body: JSON.stringify({ ...form, cooperativeId: form.cooperativeId || null }) }); setForm({ fullName: "", email: "", phone: "", password: "", role: "SOPORTE", cooperativeId: "" }); setSuccess("Usuario administrativo creado."); await load(); } catch (reason) { setError(errorText(reason)); } finally { setBusy(""); } }
  const roleLabel: Record<string, string> = { ADMIN: "Administrador actual", SUPPORT: "Soporte actual", SUPER_ADMIN: "Superadministrador", ADMIN_OPERACIONES: "Administrador de operaciones", SOPORTE: "Soporte", ANALISTA_COOPERATIVA: "Analista de cooperativa" };
  return <div className="split"><section className="card"><Header eyebrow="CONTROL DE ACCESO" title="Usuarios y roles" action={`${roles.length} roles`} /><Notice error={error} success={success} /><p className="note">Los permisos se validan también en la API. Un analista debe tener una cooperativa asignada y solo recibe datos agregados de ella.</p>{users.length ? <Table headers={["Usuario", "Rol", "Cooperativa", "Permisos base", "Acción"]} rows={users.map(user => [<div><strong>{user.name}</strong><br /><small>{user.email}</small></div>, <select value={user.role} onChange={event => updateDraft(user.id, { role: event.target.value })}>{roles.map(item => <option key={item.role} value={item.role}>{roleLabel[item.role] ?? item.role}</option>)}</select>, <select value={user.cooperativeId ?? ""} onChange={event => updateDraft(user.id, { cooperativeId: event.target.value || null })}><option value="">Sin cooperativa</option>{cooperatives.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>, roles.find(item => item.role === user.role)?.permissions.length ?? 0, <button className="link" disabled={busy === user.id || (user.role === "ANALISTA_COOPERATIVA" && !user.cooperativeId)} onClick={() => save(user)}>{busy === user.id ? "Guardando…" : "Guardar"}</button>])} /> : <Empty text="No existen usuarios administrativos en la base." />}</section><form className="card form-card" onSubmit={create}><Header eyebrow="NUEVO ACCESO" title="Crear usuario administrativo" /><label>Nombre<input required minLength={3} value={form.fullName} onChange={event => setForm({ ...form, fullName: event.target.value })} /></label><label>Correo<input required type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label><label>Teléfono<input required minLength={8} value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} /></label><label>Clave temporal<input required type="password" minLength={8} value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} /></label><label>Rol<select value={form.role} onChange={event => setForm({ ...form, role: event.target.value })}>{roles.filter(item => !["ADMIN", "SUPPORT"].includes(item.role)).map(item => <option key={item.role} value={item.role}>{roleLabel[item.role] ?? item.role}</option>)}</select></label><label>Cooperativa<select value={form.cooperativeId} onChange={event => setForm({ ...form, cooperativeId: event.target.value })}><option value="">Sin cooperativa</option>{cooperatives.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="primary" disabled={busy === "new" || (form.role === "ANALISTA_COOPERATIVA" && !form.cooperativeId)}>{busy === "new" ? "Creando…" : "Crear usuario"}</button></form></div>;
}

function Incidents({ token }: { token: string }) {
  const [data, setData] = useState<any[]>([]); const [error, setError] = useState("");
  const load = () => apiFetch<any[]>("/v1/admin/incidents", token).then(setData).catch(reason => setError(errorText(reason)));
  useEffect(() => { void load(); }, [token]);
  async function update(id: string, status: string) { try { await apiFetch(`/v1/admin/incidents/${id}`, token, { method: "PATCH", body: JSON.stringify({ status, assignedTo: "Equipo de soporte" }) }); await load(); } catch (reason) { setError(errorText(reason)); } }
  return <section className="card"><Header eyebrow="SOPORTE" title="Incidentes" action={`${data.filter(item => item.status !== "RESOLVED").length} pendientes`} /><Notice error={error} />{data.length ? data.map(item => <article className="incident" key={item.id}><div><span className="eyebrow">{item.id} · {item.trip}</span><h3>{item.category}</h3><p>{item.description}</p><small>{new Date(item.createdAt).toLocaleString()} · {item.assignedTo}</small></div><select value={item.status} onChange={e => update(item.id, e.target.value)}><option value="OPEN">Abierto</option><option value="IN_REVIEW">En revisión</option><option value="RESOLVED">Resuelto</option></select></article>) : <Empty text="No hay incidentes registrados." />}</section>;
}

function Audit({ token }: { token: string }) {
  const [data, setData] = useState<any[]>([]); const [error, setError] = useState("");
  useEffect(() => { apiFetch<any[]>("/v1/admin/audit", token).then(setData).catch(reason => setError(errorText(reason))); }, [token]);
  return <section className="card"><Header eyebrow="TRAZABILIDAD" title="Registro de auditoría" action={`${data.length} eventos`} /><Notice error={error} />{data.length ? <Table headers={["Fecha", "Actor", "Acción", "Entidad", "Detalle"]} rows={data.map(event => [new Date(event.createdAt).toLocaleString(), event.actor, event.action, event.entity, event.detail])} /> : <Empty text="Aún no existen acciones auditadas." />}</section>;
}

function OperationsMap({ drivers, trips }: { drivers: any[]; trips: any[] }) {
  const points = [
    ...drivers.map(item => ({ latitude: Number(item.latitude), longitude: Number(item.longitude), label: item.name, kind: item.busy ? "busy" : item.available ? "available" : "offline" })),
    ...trips.filter(item => item.originLatitude != null && item.originLongitude != null).map(item => ({ latitude: Number(item.originLatitude), longitude: Number(item.originLongitude), label: `${item.passenger} · ${stateLabels[item.status] ?? item.status}`, kind: "trip" }))
  ].filter(point => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
  if (!points.length) return <Empty text="No existen ubicaciones recientes para representar." />;
  const latitudes = points.map(point => point.latitude); const longitudes = points.map(point => point.longitude);
  const minLat = Math.min(...latitudes); const maxLat = Math.max(...latitudes); const minLng = Math.min(...longitudes); const maxLng = Math.max(...longitudes);
  return <div className="operations-map" aria-label="Ubicaciones operativas recientes">{points.map((point, index) => {
    const left = maxLng === minLng ? 50 : 5 + (point.longitude-minLng)*90/(maxLng-minLng);
    const top = maxLat === minLat ? 50 : 5 + (maxLat-point.latitude)*90/(maxLat-minLat);
    return <button type="button" key={`${point.kind}-${index}`} className={`operations-point ${point.kind}`} title={point.label} aria-label={point.label} style={{ left:`${left}%`, top:`${top}%` }}>{point.kind === "trip" ? "●" : "⌖"}</button>;
  })}<div className="operations-legend"><span><i className="available" /> Disponible</span><span><i className="busy" /> Ocupado</span><span><i className="trip" /> Viaje/solicitud</span></div></div>;
}

function OperationsCenter({ token }: { token: string }) {
  const [data, setData] = useState<any>(); const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  async function load() { try { setData(await apiFetch<any>("/v1/admin/operations", token)); setError(""); } catch (reason) { setError(errorText(reason)); } finally { setLoading(false); } }
  useEffect(() => { void load(); const id = setInterval(() => void load(), 10_000); return () => clearInterval(id); }, [token]);
  const metrics = data?.metrics ?? {};
  return <div className="operations-center"><section className="card operations-heading"><Header eyebrow="MONITOREO EN TIEMPO REAL" title="Estado actual de la operación" action={data?.updatedAt ? `Actualizado ${new Date(data.updatedAt).toLocaleTimeString()}` : "Actualizando"} /><p>Se actualiza cada 10 segundos con datos reales de viajes, conductores e incidentes.</p><Notice error={error} /></section>{loading ? <div className="skeleton-grid"><span /><span /><span /><span /></div> : <><div className="metric-grid operations-metrics">{[["Viajes activos",metrics.activeTrips,"↔"],["Buscando conductor",metrics.searchingTrips,"⌕"],["Solicitudes demoradas",metrics.delayedRequests,"!"],["Programados próximos",metrics.upcomingScheduled,"◷"],["Conductores conectados",metrics.connectedDrivers,"●"],["Conductores disponibles",metrics.availableDrivers,"✓"],["Conductores ocupados",metrics.busyDrivers,"⌖"],["Incidentes críticos",metrics.criticalIncidents,"△"]].map(([label,value,icon]) => <article className="metric" key={String(label)}><span>{label}</span><strong>{String(value ?? 0)}</strong><small>{icon}</small></article>)}</div><div className="split"><section className="card"><Header eyebrow="COBERTURA" title="Conductores y solicitudes" /><OperationsMap drivers={data?.driverLocations ?? []} trips={data?.activeTrips ?? []} /></section><section className="card"><Header eyebrow="PRÓXIMAS 2 HORAS" title="Viajes programados" action={`${data?.upcomingTrips?.length ?? 0}`} />{data?.upcomingTrips?.length ? <div className="operations-list">{data.upcomingTrips.map((trip: any) => <article key={trip.id}><div><strong>{new Date(trip.scheduledFor).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })} · {trip.passenger}</strong><small>{trip.origin ?? "Origen"} → {trip.destination ?? "Destino"}</small></div><Badge value={trip.scheduleStatus ?? "SCHEDULED"} /></article>)}</div> : <Empty text="No hay viajes programados próximos." />}</section></div><section className="card"><Header eyebrow="SEGUIMIENTO" title="Viajes activos y solicitudes" action={`${data?.activeTrips?.length ?? 0}`} />{data?.activeTrips?.length ? <Table headers={["Estado","Pasajero","Conductor","Origen","Destino","Espera","Solicitado"]} rows={data.activeTrips.map((trip: any) => [<Badge value={trip.status} />,trip.passenger,trip.driver,trip.origin ?? "Sin referencia",trip.destination ?? "Sin referencia",`${Math.max(0,Math.ceil(Number(trip.ageSeconds)/60))} min`,new Date(trip.requestedAt).toLocaleString()])} /> : <Empty text="No hay viajes activos ahora." />}</section>{data?.criticalIncidents?.length > 0 && <section className="card critical-operations"><Header eyebrow="ATENCIÓN PRIORITARIA" title="Incidentes críticos abiertos" />{data.criticalIncidents.map((incident: any) => <div className="list-row" key={incident.id}><div><strong>{incident.subject ?? incident.category}</strong><small>{incident.reporter ?? "Usuario"} · {new Date(incident.createdAt).toLocaleString()}</small></div><Badge value={incident.status} /></div>)}</section>}</>}</div>;
}

function AlertsCenter({ token }: { token: string }) {
  const [data, setData] = useState<any>(); const [pushData, setPushData] = useState<any>(); const [error, setError] = useState(""); const [severity, setSeverity] = useState("ALL"); const [pushStatus, setPushStatus] = useState("ALL"); const [loading, setLoading] = useState(true);
  async function load() { try { const [alerts, pushes] = await Promise.all([apiFetch<any>("/v1/admin/alerts", token), apiFetch<any>(`/v1/admin/push-deliveries?status=${pushStatus}&hours=24&limit=50`, token)]); setData(alerts); setPushData(pushes); setError(""); } catch (reason) { setError(errorText(reason)); } finally { setLoading(false); } }
  useEffect(() => { void load(); const id=setInterval(() => void load(),30_000); return () => clearInterval(id); },[token]);
  const alerts = (data?.alerts ?? []).filter((item:any) => severity === "ALL" || item.severity === severity);
  const pushSummary = pushData?.summary ?? {};
  return <div className="alerts-center"><section className="card alerts-heading"><Header eyebrow="CONTROL PREVENTIVO" title="Alertas operativas" action={data?.updatedAt ? `Actualizado ${new Date(data.updatedAt).toLocaleTimeString()}` : "Actualizando"} /><div className="alerts-toolbar"><p>Documentos: aviso con {data?.documentExpiryAlertDays ?? 30} días de anticipación.</p><label>Prioridad<select value={severity} onChange={event => setSeverity(event.target.value)}><option value="ALL">Todas</option><option value="CRITICAL">Críticas</option><option value="WARNING">Advertencias</option><option value="INFO">Informativas</option></select></label><button className="secondary" type="button" onClick={() => void load()}>Actualizar</button></div><Notice error={error} /></section>{loading ? <div className="skeleton-grid"><span /><span /><span /></div> : <>{alerts.length ? <div className="alerts-grid">{alerts.map((item:any) => <article className={`alert-card ${item.severity.toLowerCase()}`} key={item.id}><span className="alert-icon" aria-hidden="true">{item.severity === "CRITICAL" ? "!" : item.severity === "WARNING" ? "△" : "i"}</span><div><strong>{item.title}</strong><p>{item.detail}</p><small>{new Date(item.createdAt).toLocaleString()} · {item.type.replaceAll("_"," ")}</small></div></article>)}</div> : <Empty text="No existen alertas para el filtro seleccionado." />}<section className="card"><Header eyebrow="NOTIFICACIONES PUSH · ÚLTIMAS 24 HORAS" title="Diagnóstico de entregas" action={`${pushSummary.sent ?? 0}/${pushSummary.total ?? 0} enviadas`} /><div className="alerts-toolbar"><p>Promedio: {pushSummary.averageDurationMs ?? 0} ms · Fallidas: {pushSummary.failed ?? 0} · Omitidas: {pushSummary.skipped ?? 0}</p><label>Resultado<select value={pushStatus} onChange={event => setPushStatus(event.target.value)}><option value="ALL">Todos</option><option value="SENT">Enviadas</option><option value="PARTIAL">Parciales</option><option value="FAILED">Fallidas</option><option value="SKIPPED">Omitidas</option></select></label><button className="secondary" type="button" onClick={() => void load()}>Aplicar</button></div>{pushData?.deliveries?.length ? <Table headers={["Fecha","Evento","Usuario","Resultado","Entrega","Error"]} rows={pushData.deliveries.map((item:any) => [new Date(item.createdAt).toLocaleString(),item.eventType,item.user,<Badge value={item.status} />,`${item.sent}/${item.attempted}`,item.errorCodes?.join(", ") || "—"])} /> : <Empty text="No existen intentos push en el período seleccionado." />}</section></>}</div>;
}

function Database({ token }: { token: string }) {
  const [data, setData] = useState<any>();
  useEffect(() => { apiFetch<any>("/v1/admin/database", token).then(setData).catch(reason => setData({ connected: false, message: errorText(reason) })); }, [token]);
  return <section className="card database-card"><Header eyebrow="INFRAESTRUCTURA" title="PostgreSQL / PostGIS" /><div className={`connection ${data?.connected ? "ok" : "down"}`}><strong>{data?.connected ? "Conexión activa" : "Sin conexión"}</strong><p>{data?.connected ? "La API de Render está conectada a la base del proyecto." : data?.message ?? "Verificando conexión…"}</p></div>{data?.connected && <div className="database-details"><div><span>Base de datos</span><strong>{data.database}</strong></div><div><span>Motor</span><strong>PostgreSQL</strong><small>{String(data.postgres_version).split(",")[0]}</small></div><div><span>Extensión geográfica</span><strong>PostGIS activa</strong><small>{String(data.postgis_version).split(" ").slice(0, 2).join(" ")}</small></div></div>}<p className="note">Las cuentas, tarifas, zonas, viajes y configuraciones operativas se almacenan en esta base.</p></section>;
}

function App() {
  const [session, setSession] = useState<Session | undefined>(() => { try { return JSON.parse(localStorage.getItem("admin-session") ?? ""); } catch { return undefined; } });
  const [module, setModule] = useState<Module>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  function save(next: Session) { localStorage.setItem("admin-session", JSON.stringify(next)); setSession(next); }
  function logout() { localStorage.removeItem("admin-session"); setSession(undefined); }
  if (!session) return <Login onSession={save} />;
  const allowed = (permission: string) => can(session.user, permission);
  const visible = (Object.keys(labels) as Module[]).filter(item => modulePermissions[item].some(allowed));
  const cooperativeDashboard = allowed("cooperative_dashboard:view") && !allowed("dashboard:view");
  function selectModule(next: Module) {
    setModule(next);
    if (window.innerWidth <= 720) setSidebarOpen(false);
  }
  return <div className={`app-shell ${sidebarOpen ? "sidebar-open" : "sidebar-collapsed"}`}>
    <aside aria-label="Menú principal">
      <div className="sidebar-head">
        <button className="menu-toggle" type="button" aria-label={sidebarOpen ? "Cerrar menú" : "Abrir menú"} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(value => !value)}>☰</button>
        <div className="brand"><img className="brand-logo" src="/costa-go-emblem.png" alt="" /><div><strong><span>Costa-</span>Go</strong><small>Centro de control</small></div></div>
      </div>
      <nav>{visible.map(item => <button key={item} title={!sidebarOpen ? labels[item] : undefined} className={module === item ? "active" : ""} onClick={() => selectModule(item)}><span>{icons[item]}</span><span className="nav-label">{labels[item]}</span></button>)}</nav>
      <div className="profile"><strong>{session.user.name}</strong><small>{session.user.role.replaceAll("_", " ")}</small><button onClick={logout}>Cerrar sesión</button></div>
    </aside>
    {sidebarOpen && <button className="sidebar-scrim" aria-label="Cerrar menú" onClick={() => setSidebarOpen(false)} />}
    <main>
      <header className="topbar"><button className="mobile-menu-toggle" type="button" aria-label="Abrir menú" onClick={() => setSidebarOpen(true)}>☰</button><div><span className="eyebrow">CONSOLA ADMINISTRATIVA</span><h1>{labels[module]}</h1></div><span className="status">● Render conectado</span></header>
      {module === "dashboard" && <Dashboard token={session.token} cooperative={cooperativeDashboard} />}
      {module === "operations" && <OperationsCenter token={session.token} />}
      {module === "alerts" && <AlertsCenter token={session.token} />}
      {module === "trips" && <Trips token={session.token} admin={allowed("trips:manage")} />}
      {module === "drivers" && <Drivers token={session.token} canApprove={allowed("drivers:approve")} canViewDocuments={allowed("drivers:documents:view")} canManageDocuments={allowed("drivers:documents:manage")} canResetPasswords={allowed("users:manage")} />}
      {module === "passengers" && <Passengers token={session.token} canManage={allowed("passengers:manage")} canResetPasswords={allowed("users:manage")} />}
      {module === "cooperatives" && <Cooperatives token={session.token} canManage={allowed("cooperatives:manage")} />}
      {module === "pricing" && <Pricing token={session.token} admin={allowed("pricing:manage")} />}
      {module === "zones" && <CoverageZones token={session.token} permissions={session.user.permissions ?? []} />}
      {module === "settings" && <><Settings token={session.token} admin={allowed("settings:manage")} /><DocumentExpirySettings token={session.token} admin={allowed("settings:manage")} /></>}
      {module === "advertising" && <Advertising token={session.token} admin={allowed("advertising:manage")} />}
      {module === "incidents" && <SupportAdmin token={session.token} />}
      {module === "access" && <AccessManagement token={session.token} />}
      {module === "audit" && <Audit token={session.token} />}
      {module === "database" && <Database token={session.token} />}
    </main>
  </div>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AdminErrorBoundary fallback={<div className="login-shell"><div className="login-card"><h1>No se pudo cargar el panel</h1><p>El error fue registrado. Recarga la página para volver a intentarlo.</p></div></div>}>
      <App />
    </AdminErrorBoundary>
  </StrictMode>
);
