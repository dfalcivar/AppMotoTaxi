import { driverDocumentProgress } from "./driver-document-progress";
import { StrictMode, Suspense, lazy, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { apiFetch, apiUrl, changeAdminPassword, login, type Session, type SessionUser } from "./api.js";
import "./styles.css";
import "./settings.css";
import "./advertising.css";
import "./password-reset.css";
import "./dashboard.css";
import "./navigation.css";
import "./responsive.css";
import "./admin-enhancements.css";
import "./operations.css";
import "./service-areas.css";
import "./brand.css";
import "./fare-audit.css";
import { MobileAccountActions } from "./mobile-account-actions.js";
import { MembershipAdmin } from "./memberships-admin.js";
import {FleetAdmin} from './fleet-admin.js';
import {MototaxiIcon} from './mototaxi-icon.js';
import { SupportAdmin } from "./support-admin.js";
import { CoverageZones } from "./service-area-admin.js";
import { FareTerritories } from "./fare-admin.js";
import { CommercialAdmin } from "./commercial-admin.js";
const FiscalAdmin = lazy(() => import('./fiscal-admin.js').then(module => ({default:module.FiscalAdmin})));
import { AdminErrorBoundary } from "./observability.js";
import { PassengerCancellationSettings, PassengerCancellationHistory } from './passenger-cancellations.js';

type Module = "fleet" | "fiscal" | "dashboard" | "operations" | "alerts" | "trips" | "drivers" | "memberships" | "passengers" | "cooperatives" | "pricing" | "zones" | "settings" | "advertising" | "commercial" | "incidents" | "access" | "audit" | "database";

const labels: Record<Module, string> = {
  fleet:'Mototaxis',
  fiscal: 'Finanzas / Facturación',
  dashboard: "Tablero",
  operations: "Centro de operaciones",
  alerts: "Centro de alertas",
  trips: "Viajes",
  drivers: "Conductores",
  memberships: "Membresías",
  passengers: "Pasajeros",
  cooperatives: "Cooperativas",
  pricing: "Tarifas",
  zones: "Zonas de cobertura",
  settings: "Configuración operativa",
  advertising: "Publicidad institucional",
  commercial: "Comercial y publicidad",
  incidents: "Soporte e incidentes",
  access: "Usuarios y roles",
  audit: "Auditoría",
  database: "PostgreSQL"
};
const icons: Record<Module, string> = { fleet:'▣', fiscal: "▤", dashboard: "▦", operations: "◫", alerts: "△", trips: "↔", drivers: "◉", memberships: "◈", passengers: "◎", cooperatives: "⌂", pricing: "$", zones: "◇", settings: "⌖", advertising: "▣", commercial: "◆", incidents: "!", access: "⚿", audit: "≡", database: "◫" };
const modulePermissions: Record<Module, string[]> = {
  fleet:['fleet:view'],
  fiscal: ['FACTURACION_VER','FACTURACION_DASHBOARD_VER','CLIENTES_FISCALES_VER'],
  dashboard: ["dashboard:view", "cooperative_dashboard:view"],
  operations: ["operations:view"], alerts: ["alerts:view"],
  trips: ["trips:view"], drivers: ["drivers:view"], memberships: ["memberships:view"], passengers: ["passengers:view"],
  cooperatives: ["cooperatives:view"], pricing: ["pricing:view"], zones: ["service_areas:view"],
  settings: ["settings:view"], advertising: ["advertising:view"],
  commercial: ["commercial:dashboard", "commercial:leads:view", "commercial:campaigns:view", "commercial:payments:view"], incidents: ["incidents:view"],
  access: ["roles:manage"], audit: ["audit:view"], database: ["database:view"]
};
const roleLabels: Record<string, string> = {
  ADMIN: "Administrador actual", SUPPORT: "Soporte actual", SUPER_ADMIN: "Superadministrador",
  ADMIN_OPERACIONES: "Administrador de operaciones", SOPORTE: "Soporte",
  ANALISTA_COOPERATIVA: "Analista de cooperativa", COLLECTOR: "Recaudador", FINANCE: "Finanzas", COMMERCIAL: "Comercial"
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
  CANCELLED: "Cancelado", NO_DRIVER: "Sin conductor encontrado", INCIDENT: "Incidente", PENDING: "Pendiente",
  ACTIVE: "Activo", SUSPENDED: "Suspendido", REJECTED: "Rechazado", OPEN: "Abierto",
  PENDIENTE_DOCUMENTOS: "Pendiente de documentos", PENDIENTE_REVISION: "Pendiente de revisión",
  OBSERVADO: "Observado", APROBADO: "Aprobado", RECHAZADO: "Rechazado", SUSPENDIDO: "Suspendido",
  IN_REVIEW: "En revisión", RESOLVED: "Resuelto", SCHEDULED: "Programado sin conductor",
  SCHEDULED_ASSIGNED: "Programado con conductor", SCHEDULED_READY: "Próximo a iniciar",
  ACTIVATED: "Activado", URBAN: "Urbana", EXTENDED: "Extendida",
  NUEVO: "Nuevo", ASIGNADO: "Asignado", EN_REVISION: "En revisión",
  ESPERANDO_USUARIO: "Esperando usuario", RESUELTO: "Resuelto", CERRADO: "Cerrado",
  SUGGESTED: "Valor sugerido", CONFIGURED: "Regla territorial",
  CASH: "Efectivo", DEUNA: "Transferencia",
  NO_DEUNA_COMPATIBLE_DRIVER: "Sin conductor habilitado para Transferencia",
  NO_DRIVER_ACCEPTED: "Ningún conductor aceptó",
  NO_ELIGIBLE_DRIVER_IN_RADIUS: "Sin conductores elegibles en el radio"
};

function errorText(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "INVALID_DASHBOARD_FILTERS") return "Revisa el período y los filtros seleccionados.";
  if (message === "DRIVER_DOCUMENTS_NOT_APPROVED") return "Falta aprobar uno o más documentos obligatorios. Revisa el expediente y actualiza la lista antes de aprobar al conductor.";
  if (message === "WEAK_PASSWORD") return "Usa 10+ caracteres con mayúscula, minúscula, número y símbolo.";
  if (message === "EMAIL_ALREADY_EXISTS") return "Este correo ya está registrado.";
  if (message === "PHONE_ALREADY_EXISTS") return "Este teléfono ya está registrado.";
  if (message === "PASSWORD_MUST_BE_DIFFERENT") return "La nueva contraseña debe ser diferente de la clave temporal.";
  if (message === "CANNOT_RESET_CURRENT_USER") return "No puedes restablecer tu propia clave desde esta opción.";
  if (message === "ADMIN_SESSION_REVOKED") return "La sesión fue cerrada por seguridad. Ingresa nuevamente.";
  if (message === "COMMERCIAL_WORKFLOW_REQUIRED") return "Esta campaña pertenece al flujo comercial. Debes gestionarla desde Comercial y publicidad después de conciliar el pago.";
  if (message === "PAYMENT_NOT_RECONCILED") return "La campaña todavía no puede aprobarse porque su pago no ha sido conciliado por Finanzas.";
  return message || "No se pudo completar la operación.";
}

function strongPasswordError(password: string) {
  if (password.length < 10 || password.length > 100) return "Usa entre 10 y 100 caracteres.";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) return "Incluye una mayúscula y una minúscula.";
  if (!/\d/.test(password)) return "Incluye al menos un número.";
  if (!/[^A-Za-z0-9\s]/.test(password)) return "Incluye al menos un símbolo, por ejemplo ! o @.";
  if (/\s/.test(password)) return "La contraseña no puede contener espacios.";
  return "";
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

function ForcedPasswordChange({ session, onSession, onLogout }: { session: Session; onSession: (session: Session) => void; onLogout: () => void }) {
  const [password,setPassword]=useState(""); const [confirmation,setConfirmation]=useState("");
  const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
  async function submit(event:React.FormEvent){event.preventDefault();setError("");const policy=strongPasswordError(password);if(policy){setError(policy);return;}if(password!==confirmation){setError("Las contraseñas no coinciden.");return;}setBusy(true);try{onSession(await changeAdminPassword(session.token,password));}catch(reason){setError(errorText(reason));}finally{setBusy(false);}}
  return <div className="login-shell"><form className="login-card" onSubmit={submit}><div className="admin-brand-lockup"><img src="/costa-go-emblem.png" alt="" /><strong><span>COSTA-</span>GO</strong></div><span className="eyebrow">SEGURIDAD DE LA CUENTA</span><h1>Crea tu contraseña personal</h1><p>Ingresaste con una clave temporal. Debes reemplazarla antes de acceder al panel.</p><label>Nueva contraseña<input autoFocus autoComplete="new-password" type="password" minLength={10} maxLength={100} required value={password} onChange={event=>setPassword(event.target.value)} /></label><small>10+ caracteres con mayúscula, minúscula, número y símbolo.</small><label>Confirmar contraseña<input autoComplete="new-password" type="password" minLength={10} maxLength={100} required value={confirmation} onChange={event=>setConfirmation(event.target.value)} /></label><Notice error={error} /><button className="primary" disabled={busy}>{busy?"Actualizando…":"Guardar y continuar"}</button><button className="secondary" type="button" disabled={busy} onClick={onLogout}>Cerrar sesión</button></form></div>;
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

type DashboardDetailSelection = { metric: string; title: string };
function dashboardCell(value: unknown, type?: string) {
  if (value == null || value === "") return "—";
  if (type === "date") return new Date(String(value)).toLocaleString("es-EC");
  if (type === "money") return money(Number(value));
  if (type === "percent") return `${Number(value).toLocaleString("es-EC")}%`;
  if (type === "duration") {
    const seconds = Math.max(0, Math.round(Number(value)));
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return minutes ? `${minutes} min${remainder ? ` ${remainder} s` : ""}` : `${remainder} s`;
  }
  if (type === "status") return <Badge value={String(value)} />;
  return typeof value === "boolean" ? value ? "Sí" : "No" : String(value);
}

function DashboardDetailDialog({ token, selection, query, onClose }: { token: string; selection: DashboardDetailSelection; query: string; onClose: () => void }) {
  const [draft,setDraft]=useState(""); const [search,setSearch]=useState(""); const [page,setPage]=useState(1);
  const [data,setData]=useState<any>(); const [loading,setLoading]=useState(true); const [error,setError]=useState("");
  useEffect(()=>{setLoading(true);setError("");const params=new URLSearchParams(query);params.set("search",search);params.set("page",String(page));params.set("pageSize","15");apiFetch<any>(`/v1/admin/dashboard/details/${selection.metric}?${params}`,token).then(setData).catch(reason=>setError(errorText(reason))).finally(()=>setLoading(false));},[token,selection.metric,query,search,page]);
  const pages=Math.max(1,Math.ceil(Number(data?.total??0)/Number(data?.pageSize??15)));
  return <div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><section className="modal-card metric-detail-modal" role="dialog" aria-modal="true" aria-labelledby="metric-detail-title"><div className="decision-heading"><div><span className="eyebrow">DETALLE DE MÉTRICA</span><h2 id="metric-detail-title">{selection.title}</h2></div><button className="modal-close-button" type="button" aria-label="Cerrar" onClick={onClose}>×</button></div><form className="metric-detail-search" onSubmit={event=>{event.preventDefault();setPage(1);setSearch(draft.trim());}}><input aria-label="Buscar en el detalle" value={draft} onChange={event=>setDraft(event.target.value)} placeholder="Buscar por nombre, viaje, lugar…"/><button className="secondary">Buscar</button>{search&&<button className="link" type="button" onClick={()=>{setDraft("");setSearch("");setPage(1);}}>Limpiar</button>}</form><Notice error={error}/>{loading?<Empty text="Consultando registros…"/>:data?.rows?.length?<Table headers={data.columns.map((column:any)=>column.label)} rows={data.rows.map((row:any)=>data.columns.map((column:any)=>dashboardCell(row[column.key],column.type)))}/>:<Empty text="No existen registros para esta métrica y los filtros aplicados."/>}<div className="metric-detail-footer"><small>{Number(data?.total??0).toLocaleString("es-EC")} registro(s) · página {page} de {pages}</small><div className="row-actions"><button className="secondary" type="button" disabled={page<=1||loading} onClick={()=>setPage(value=>value-1)}>Anterior</button><button className="secondary" type="button" disabled={page>=pages||loading} onClick={()=>setPage(value=>value+1)}>Siguiente</button><button className="primary" type="button" onClick={onClose}>Cerrar</button></div></div></section></div>;
}

function Dashboard({ token, cooperative = false }: { token: string; cooperative?: boolean }) {
  const today = new Date(); const monthAgo = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000);
  const dateValue = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const initial = { from: dateValue(monthAgo), to: dateValue(today), cooperativeId: "", driverId: "", sector: "", status: "", tripType: "ALL" };
  const [draft, setDraft] = useState(initial); const [filters, setFilters] = useState(initial);
  const [data, setData] = useState<any>(); const [error, setError] = useState(""); const [loading, setLoading] = useState(true); const [selectedDriver, setSelectedDriver] = useState<any>(); const [driverLoading, setDriverLoading] = useState(false); const [detail,setDetail]=useState<DashboardDetailSelection>(); const [cooperativeDetail,setCooperativeDetail]=useState(false);

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
    const path = cooperative ? "/v1/admin/cooperative-dashboard/overview" : `/v1/admin/dashboard?${dashboardQuery(filters)}`;
    apiFetch<any>(path, token).then(setData).catch(reason => setError(errorText(reason))).finally(() => setLoading(false));
  }, [token, cooperative, filters]);

  if (cooperative) {
    if (error) return <Notice error={error} />; if (!data) return <Empty text="Cargando operación…" />;
    const organization=data.cooperative; const stats=[["Conductores",organization.totalDrivers],["Conductores activos",organization.activeDrivers],["Conductores conectados",organization.connectedDrivers],["Viajes totales",organization.totalTrips],["Viajes del mes",organization.tripsThisMonth],["Completados",organization.completedTrips],["Cancelados",organization.cancelledTrips]];
    return <><div className="metric-grid">{stats.map(([label,value])=><button type="button" className="metric interactive-metric" key={String(label)} onClick={()=>setCooperativeDetail(true)}><span>{String(label)}</span><strong>{String(value??0)}</strong><small>Ver registros</small></button>)}</div><section className="card"><Header eyebrow="ALCANCE RESTRINGIDO" title={organization.name}/><p className="note">Estas cifras contienen únicamente información de tu cooperativa. Selecciona cualquier indicador para consultar los conductores, viajes y actividad que lo componen.</p></section>{cooperativeDetail&&<CooperativeOverviewDialog token={token} item={organization} self onClose={()=>setCooperativeDetail(false)}/>}</>;
  }

  const setPreset = (days: number) => { const end = new Date(); const start = new Date(end.getTime() - (days - 1) * 86400000); const next = { ...draft, from: dateValue(start), to: dateValue(end) }; setDraft(next); setFilters(next); };
  const metricLabels: Record<string, { label: string; icon: string; tone: string }> = {
    requestedTrips: { label: "Viajes solicitados", icon: "↗", tone: "neutral" },
    completedTrips: { label: "Completados", icon: "✓", tone: "positive" },
    cancelledTrips: { label: "Cancelados", icon: "×", tone: "negative" },
    activeTrips: { label: "Viajes activos", icon: "●", tone: "live-tone" },
    scheduledTrips: { label: "Programados", icon: "◷", tone: "neutral" },
    searchingWithoutDriver: { label: "Buscando conductor", icon: "⌕", tone: "live-tone" },
    withoutDriver: { label: "Sin conductor encontrado", icon: "!", tone: "warning" },
    deunaWithoutCompatibleDriver: { label: "Sin conductor habilitado para Transferencia", icon: "$", tone: "warning" },
    connectedDrivers: { label: "Conductores conectados", icon: "⌁", tone: "positive" },
    activeDrivers: { label: "Conductores habilitados", icon: "◉", tone: "neutral" },
    pendingDrivers: { label: "Pendientes de aprobación", icon: "…", tone: "warning" },
    averageAssignmentSeconds: { label: "Promedio de asignación", icon: "◷", tone: "neutral" },
    averageWaitSeconds: { label: "Promedio de espera", icon: "⌛", tone: "neutral" },
    averageTripSeconds: { label: "Duración promedio", icon: "↔", tone: "neutral" },
    openIncidents: { label: "Incidentes abiertos", icon: "!", tone: "negative" },
    acceptanceRate: { label: "Aceptación", icon: "%", tone: "positive" },
    cancellationRate: { label: "Cancelación", icon: "%", tone: "negative" },
    offersSent: { label: "Ofertas enviadas", icon: "↗", tone: "neutral" },
    offersRejected: { label: "Ofertas rechazadas", icon: "×", tone: "warning" },
    offersExpired: { label: "Ofertas sin respuesta", icon: "◷", tone: "warning" },
    offersTakenByAnother: { label: "Tomadas por otro conductor", icon: "✓", tone: "neutral" },
    driverCancellationsAfterAcceptance: { label: "Canceladas tras aceptar", icon: "!", tone: "negative" },
    averageOfferResponseSeconds: { label: "Respuesta promedio a oferta", icon: "⌛", tone: "neutral" }
  };
  const durations = new Set(["averageAssignmentSeconds", "averageWaitSeconds", "averageTripSeconds", "averageOfferResponseSeconds"]); const rates = new Set(["acceptanceRate", "cancellationRate"]);
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
      <section className="dashboard-section"><Header eyebrow="1 · RESUMEN EJECUTIVO" title="Estado general de la operación" /><div className="metric-grid dashboard-metrics">{Object.entries(metricLabels).map(([key, metric]) => <button type="button" className={`metric dashboard-metric interactive-metric ${metric.tone}`} key={key} onClick={()=>setDetail({metric:key,title:metric.label})}><div><span>{metric.label}</span><i aria-hidden="true">{metric.icon}</i></div><strong>{metricValue(key, data.metrics?.[key])}</strong><small>Ver registros según los filtros</small></button>)}</div></section>

      <section className="dashboard-section"><Header eyebrow="2 · DEMANDA Y ZONAS" title="Cuándo y desde dónde solicitan" /><div className="split"><article className="card"><Header eyebrow="TENDENCIA" title="Viajes por día" /><DashboardBars items={data.tripsByDay ?? []} valueKey="requested" labelKey="day" /></article><article className="card"><Header eyebrow="HORARIOS" title="Viajes por hora" /><DashboardBars items={(data.tripsByHour ?? []).map((item: any) => ({ ...item, label: `${String(item.hour).padStart(2, "0")}:00` }))} valueKey="requested" /></article></div><div className="split"><article className="card"><Header eyebrow="ORÍGENES" title="Puntos con mayor demanda" /><DashboardBars items={data.origins ?? []} /></article><article className="card"><Header eyebrow="DESTINOS" title="Destinos frecuentes" /><DashboardBars items={data.destinations ?? []} /></article></div><div className="split"><article className="card"><Header eyebrow="COORDENADAS" title="Concentración de solicitudes" /><DashboardHeatmap points={data.heatmap ?? []} /></article><article className="card"><Header eyebrow="DISTRIBUCIÓN" title="Viajes por cooperativa" /><DashboardBars items={data.tripsByCooperative ?? []} /><Header eyebrow="MODALIDAD" title="Inmediatos y programados" /><DashboardBars items={data.tripsByType ?? []} /></article></div></section>

      <section className="dashboard-section"><Header eyebrow="3 · CONDUCTORES" title="Rendimiento multidimensional" /><section className="card"><p className="note">El orden combina viajes completados y calificación. Las métricas se muestran por separado para evitar clasificaciones injustas.</p>{data.driverPerformance?.length ? <Table headers={["Conductor", "Cooperativa", "Viajes", "Completados", "Cancelados", "Aceptación", "Calificación", "Acepta en", "Llega en", "Último viaje", "Perfil"]} rows={data.driverPerformance.map((driver: any) => [driver.name, driver.cooperative, driver.totalTrips, driver.completed, driver.cancelled, `${driver.acceptanceRate}%`, `★ ${Number(driver.rating).toFixed(2)}`, metricValue("averageAssignmentSeconds", driver.averageAcceptSeconds), metricValue("averageWaitSeconds", driver.averageArrivalSeconds), driver.lastTrip ? new Date(driver.lastTrip).toLocaleString() : "Sin viajes", <button className="link" onClick={() => void openDriver(driver)}>Ver detalle</button>])} /> : <Empty text="No hay rendimiento registrado para estos filtros." />}</section></section>

      <section className="dashboard-section"><Header eyebrow="4 · OPERACIÓN" title="Señales que requieren seguimiento" /><div className="signal-grid">{[["delayedAssignments","Asignaciones con demora mayor a 2 minutos",data.systemSignals?.delayedAssignments??0],["neverAccepted","Solicitudes nunca aceptadas o demoradas",data.systemSignals?.neverAccepted??0],["lowCoverageHours","Franjas horarias con cobertura menor al 50%",data.systemSignals?.lowCoverageHours?.length??0],["highCancellationDrivers","Conductores con cancelación alta y muestra suficiente",data.systemSignals?.highCancellationDrivers?.length??0]].map(([metric,title,value])=><button type="button" className="card interactive-signal" key={String(metric)} onClick={()=>setDetail({metric:String(metric),title:String(title)})}><strong>{String(value)}</strong><span>{String(title)}</span><small>Consultar detalle</small></button>)}</div>{data.systemSignals?.lowCoverageHours?.length > 0 && <section className="card"><Header eyebrow="COBERTURA" title="Horas con demanda y baja asignación" /><DashboardBars items={data.systemSignals.lowCoverageHours.map((item: any) => ({ label: `${String(item.hour).padStart(2, "0")}:00 · ${item.assigned}/${item.requested} asignados`, value: item.requested }))} /></section>}</section>

      <section className="dashboard-section"><Header eyebrow="5 · INCIDENTES Y ALERTAS" title="Casos por categoría y estado" /><section className="card">{data.incidents?.length ? <Table headers={["Categoría", "Estado", "Cantidad"]} rows={data.incidents.map((item: any) => [item.category, <Badge value={item.status} />, item.value])} /> : <Empty text="No existen incidentes en el período seleccionado." />}</section></section>
    </>}
    {detail && <DashboardDetailDialog token={token} selection={detail} query={dashboardQuery(filters)} onClose={()=>setDetail(undefined)} />}

    {selectedDriver && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedDriver(undefined); }}><section className="modal-card driver-stat-modal" role="dialog" aria-modal="true"><Header eyebrow="PERFIL ESTADÍSTICO" title={selectedDriver.name} action={selectedDriver.cooperative} />{driverLoading ? <Empty text="Calculando perfil del conductor…" /> : <><div className="metric-grid"><article className="metric"><span>Total de viajes</span><strong>{selectedDriver.performance?.totalTrips ?? selectedDriver.totalTrips}</strong></article><article className="metric"><span>Completados</span><strong>{selectedDriver.performance?.completed ?? selectedDriver.completed}</strong></article><article className="metric"><span>Cancelados</span><strong>{selectedDriver.performance?.cancelled ?? selectedDriver.cancelled}</strong></article><article className="metric"><span>Calificación</span><strong>★ {Number(selectedDriver.rating).toFixed(2)}</strong></article></div><Table headers={["Aceptación", "Tiempo para aceptar", "Tiempo hasta origen", "Estado"]} rows={[[`${selectedDriver.performance?.acceptanceRate ?? selectedDriver.acceptanceRate}%`, metricValue("averageAssignmentSeconds", selectedDriver.performance?.averageAcceptSeconds ?? selectedDriver.averageAcceptSeconds), metricValue("averageWaitSeconds", selectedDriver.performance?.averageArrivalSeconds ?? selectedDriver.averageArrivalSeconds), <Badge value={selectedDriver.approvalStatus} />]]} /><div className="split driver-detail-grid"><article><Header eyebrow="ACTIVIDAD" title="Viajes por día" /><DashboardBars items={selectedDriver.tripsByDay ?? []} valueKey="requested" labelKey="day" /></article><article><Header eyebrow="ZONAS" title="Sectores frecuentes" /><DashboardBars items={selectedDriver.zones ?? []} /></article></div><div className="split driver-detail-grid"><article><Header eyebrow="HORARIOS" title="Horas de actividad" /><DashboardBars items={(selectedDriver.activityByHour ?? []).map((item: any) => ({ ...item, label: `${String(item.hour).padStart(2, "0")}:00` }))} /></article><article><Header eyebrow="DOCUMENTOS" title="Estado de habilitantes" />{selectedDriver.documents?.length ? <Table headers={["Documento", "Estado", "Vencimiento"]} rows={selectedDriver.documents.map((item: any) => [item.documentType, <Badge value={item.status} />, item.expiresAt ? new Date(item.expiresAt).toLocaleDateString() : "Sin vencimiento"])} /> : <Empty text="No hay documentos cargados." />}</article></div><Header eyebrow="INCIDENTES" title="Casos relacionados en el período" />{selectedDriver.incidents?.length ? <Table headers={["Categoría", "Estado", "Cantidad"]} rows={selectedDriver.incidents.map((item: any) => [item.category, <Badge value={item.status} />, item.value])} /> : <Empty text="Sin incidentes en el período." />}</>}<button className="secondary" onClick={() => setSelectedDriver(undefined)}>Cerrar</button></section></div>}
  </div>;
}

function fareSectorLabel(value: unknown) {
  const code = typeof value === "string" ? value : "";
  const known: Record<string, string> = {
    ATACAMES_CABECERA: "Atacames · cabecera cantonal",
    TONSUPA_CABECERA: "Tonsupa · centro parroquial",
    TONSUPA_CABAPLAN: "Tonsupa · Cabaplan",
    CLUB_DEL_PACIFICO: "Club del Pacífico",
    SUA_CABECERA: "Súa · centro parroquial",
    TONSUPA_RURAL_ESTE: "Salima · Taseche · Estero del Medio",
    SUA_GUACHAL_MUCHIN: "Guachal · Muchín",
    LAS_BRISAS: "Las Brisas",
    LA_UNION: "La Unión",
    CUMBA: "Cumba",
    LA_LUCHA: "La Lucha",
    LAS_VEGAS: "Las Vegas"
  };
  return known[code] ?? (code ? code.toLowerCase().split("_").map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") : "Fuera de sector configurado");
}

function pricingSnapshotOf(trip: any): any {
  const snapshot = trip?.pricingSnapshot;
  if (snapshot && typeof snapshot === "object") return snapshot;
  if (typeof snapshot !== "string") return {};
  try { return JSON.parse(snapshot); } catch { return {}; }
}

function fareLegs(trip: any): any[] {
  const snapshot = pricingSnapshotOf(trip);
  return Array.isArray(snapshot.legs) ? snapshot.legs : [];
}

function fareMethodLabel(leg: any) {
  if (leg?.method === "DISTANCE") return "Tarifa por distancia";
  if (leg?.method === "CONFIGURED" || leg?.suggested === false) return "Regla territorial";
  return "Valor sugerido";
}

function fareRangeSummary(trip: any) {
  const legs = fareLegs(trip);
  if (!legs.length) return "Sin detalle histórico";
  return legs.map(leg => {
    const origin = fareSectorLabel(leg.originSector);
    const destination = fareSectorLabel(leg.destinationSector);
    return origin === destination ? `Dentro de ${origin}` : `${origin} → ${destination}`;
  }).join(" · ");
}

function validFarePoint(point: any) {
  return Number.isFinite(Number(point?.latitude)) && Number.isFinite(Number(point?.longitude));
}

function farePointCoordinates(point: any) {
  return `${Number(point.latitude).toFixed(6)}, ${Number(point.longitude).toFixed(6)}`;
}

function farePointMapUrl(point: any) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${Number(point.latitude)},${Number(point.longitude)}`)}`;
}

function FarePointCard({ label, reference, point, historicalSector, copied, onCopy }: { label: string; reference?: string; point: any; historicalSector?: unknown; copied: boolean; onCopy: () => void }) {
  if (!validFarePoint(point)) return <article className="fare-point-card unavailable"><strong>{label}</strong><span>{reference ?? "Sin referencia"}</span><small>Este viaje no conserva coordenadas consultables.</small></article>;
  const currentSector = point?.fareSector;
  const currentStatus = currentSector?.contains
    ? `Actualmente dentro de ${currentSector.name ?? fareSectorLabel(currentSector.code)}`
    : currentSector
      ? `Actualmente fuera de los sectores · más cercano: ${currentSector.name ?? fareSectorLabel(currentSector.code)} a ${Math.max(0, Number(currentSector.distanceMeters ?? 0))} m`
      : "Actualmente fuera de todos los sectores tarifarios activos";
  return <article className="fare-point-card">
    <div className="fare-point-heading"><div><strong>{label}</strong><span>{reference ?? "Sin referencia"}</span></div><span className={`fare-point-status ${currentSector?.contains ? "inside" : "outside"}`}>{currentSector?.contains ? "Dentro" : "Fuera"}</span></div>
    <code>{farePointCoordinates(point)}</code>
    <small><b>Clasificación histórica:</b> {fareSectorLabel(historicalSector)}</small>
    <small><b>Geometría vigente:</b> {currentStatus}</small>
    <div className="fare-point-actions"><a className="secondary" href={farePointMapUrl(point)} target="_blank" rel="noreferrer">Ver en Google Maps</a><button className="secondary" type="button" onClick={onCopy}>{copied ? "Coordenadas copiadas" : "Copiar coordenadas"}</button></div>
  </article>;
}

function FareAuditDialog({ trip, onClose }: { trip: any; onClose: () => void }) {
  const snapshot = pricingSnapshotOf(trip);
  const legs = fareLegs(trip);
  const hasDistanceFare = legs.some(leg => leg.method === "DISTANCE");
  const [copiedPoint, setCopiedPoint] = useState("");
  const stops = Array.isArray(trip.stops) && trip.stops.length
    ? trip.stops
    : [{ order: 1, reference: trip.destinationReference, ...trip.destinationLocation }];
  async function copyPoint(key: string, point: any) {
    try { await navigator.clipboard.writeText(farePointCoordinates(point)); setCopiedPoint(key); }
    catch { setCopiedPoint(""); }
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="modal-card fare-audit-modal" role="dialog" aria-modal="true">
    <Header eyebrow="AUDITORÍA TARIFARIA" title="Cómo se calculó este viaje" action={`Versión ${trip.pricingVersion ?? snapshot.version ?? "—"}`} />
    <p><strong>{trip.originReference ?? "Origen"}</strong> → {trip.destinationReference ?? "Destino"}</p>
    <section className="fare-point-section"><div className="fare-point-title"><strong>Puntos geográficos del pedido</strong><small>La clasificación histórica explica el cobro. La geometría vigente permite comprobar ajustes posteriores de los polígonos.</small></div><div className="fare-point-grid">
      <FarePointCard label="Origen" reference={trip.originReference} point={trip.originLocation} historicalSector={legs[0]?.originSector} copied={copiedPoint === "origin"} onCopy={() => void copyPoint("origin", trip.originLocation)} />
      {stops.map((stop: any, index: number) => <FarePointCard key={stop.order ?? index} label={`Destino ${Number(stop.order ?? index + 1)}`} reference={stop.reference} point={stop} historicalSector={legs[index]?.destinationSector} copied={copiedPoint === `stop-${index}`} onCopy={() => void copyPoint(`stop-${index}`, stop)} />)}
    </div></section>
    {legs.length ? <Table headers={["Tramo", "Rango tarifario", "Distancia de ruta", "Tarifa", "Comisión", "Aplicación"]} rows={legs.map((leg, index) => [Number(leg.order ?? index + 1), `${fareSectorLabel(leg.originSector)} → ${fareSectorLabel(leg.destinationSector)}`, leg.distanceMeters == null ? "No registrada" : `${(Number(leg.distanceMeters) / 1000).toFixed(2)} km`, money(Number(leg.fareCents ?? 0)), money(Number(leg.commissionCents ?? 0)), fareMethodLabel(leg)])} /> : <Empty text="Este viaje es anterior al detalle tarifario por tramos." />}
    <div className="metric-grid fare-audit-summary"><article className="metric"><span>Tarifa de trayectos</span><strong>{money(Number(snapshot.baseCents ?? 0))}</strong></article><article className="metric"><span>Comisión operativa</span><strong>{money(Number(snapshot.platformCommissionCents ?? 0))}</strong></article><article className="metric"><span>Adicional por paradas</span><strong>{money(Number(snapshot.stopSurchargeCents ?? 0))}</strong></article><article className="metric"><span>Total cotizado</span><strong>{money(Number(trip.quotedTotalCents ?? snapshot.totalCents ?? 0))}</strong></article></div>
    <small>{snapshot.suggested ? "Se utilizó al menos un valor sugerido porque no existía una regla territorial exacta y la ruta estaba dentro del límite local." : hasDistanceFare ? `No existía una regla territorial exacta; se aplicaron ${Number(snapshot.distancePolicy?.centsPerKm ?? 0)} ctvs/km sobre la ruta real, con límite local de ${Number(snapshot.distancePolicy?.localMaximumMeters ?? 0) / 1000} km y mínimo de ${money(Number(snapshot.distancePolicy?.minimumCents ?? 0))}.` : "Se aplicaron reglas territoriales configuradas vigentes al momento de solicitar el viaje."}</small>
    <div className="modal-actions"><button className="primary" type="button" onClick={onClose}>Cerrar</button></div>
  </section></div>;
}

function Trips({ token, admin }: { token: string; admin: boolean }) {
  const [data, setData] = useState<any[]>([]); const [error, setError] = useState("");
  const [cancelTrip, setCancelTrip] = useState<any | null>(null); const [cancelling, setCancelling] = useState(false);
  const [fareTrip, setFareTrip] = useState<any | null>(null); const [fareLoadingId, setFareLoadingId] = useState("");
  const [filters, setFilters] = useState({ scheduled: "ALL", status: "", passenger: "", driver: "", from: "", to: "", unassigned: false });
  const load = () => { const query = new URLSearchParams(); Object.entries(filters).forEach(([key, value]) => { if (value !== "" && value !== false && value !== "ALL") query.set(key, String(value)); }); return apiFetch<any[]>(`/v1/admin/trips${query.size ? `?${query}` : ""}`, token).then(setData).catch(reason => setError(errorText(reason))); };
  useEffect(() => { void load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [token, filters]);
  async function cancel(reason: string) { if (!cancelTrip) return; setCancelling(true); setError(""); try { await apiFetch(`/v1/admin/trips/${cancelTrip.id}/action`, token, { method: "POST", body: JSON.stringify({ action: "CANCEL", reason }) }); setCancelTrip(null); await load(); } catch (cause) { setError(errorText(cause)); } finally { setCancelling(false); } }
  async function openFareAudit(trip: any) { setFareLoadingId(trip.id); setError(""); try { setFareTrip(await apiFetch(`/v1/admin/trips/${trip.id}/fare-audit`, token)); } catch (cause) { setError(errorText(cause)); } finally { setFareLoadingId(""); } }
  return <>
    <section className="card"><Header eyebrow="FILTROS" title="Viajes inmediatos y programados" action={`${data.filter(t => !["COMPLETED", "CANCELLED", "NO_DRIVER"].includes(t.status)).length} activos`} /><div className="filter-grid"><label>Tipo<select value={filters.scheduled} onChange={event => setFilters({ ...filters, scheduled: event.target.value })}><option value="ALL">Todos</option><option value="IMMEDIATE">Inmediatos</option><option value="SCHEDULED">Programados</option></select></label><label>Estado<select value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value })}><option value="">Todos</option>{["SEARCHING", "ASSIGNED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "IN_PROGRESS", "COMPLETED", "CANCELLED"].map(value => <option key={value} value={value}>{stateLabels[value]}</option>)}</select></label><label>Pasajero<input value={filters.passenger} onChange={event => setFilters({ ...filters, passenger: event.target.value })} /></label><label>Conductor<input value={filters.driver} onChange={event => setFilters({ ...filters, driver: event.target.value })} /></label><label>Desde<input type="date" value={filters.from} onChange={event => setFilters({ ...filters, from: event.target.value })} /></label><label>Hasta<input type="date" value={filters.to} onChange={event => setFilters({ ...filters, to: event.target.value })} /></label><label className="checkbox"><input type="checkbox" checked={filters.unassigned} onChange={event => setFilters({ ...filters, unassigned: event.target.checked })} /> Solo sin conductor</label></div></section>
    <section className="card"><Header eyebrow="OPERACIÓN" title="Viajes y asignaciones" /><Notice error={error} />{data.length ? <Table headers={["Fecha del viaje", "Pasajero", "Conductor", "Itinerario", "Rango tarifario", "Estado", "Total", "Creado", "Acción"]} rows={data.map(t => [
      t.scheduledFor ? new Date(t.scheduledFor).toLocaleString() : "Ahora",
      t.passenger,
      t.driver,
      <div><strong>{t.originReference ?? "Origen"}</strong>{(t.stops?.length ? t.stops : [{ reference: t.destinationReference }]).map((stop: any, index: number) => <small key={index} className="table-line">→ {index + 1}. {stop.reference ?? "Destino"}</small>)}</div>,
      <div className="fare-range-cell"><strong>{fareRangeSummary(t)}</strong>{fareLegs(t).length ? <><small className="table-line">{[...new Set(fareLegs(t).map(fareMethodLabel))].join(" · ")}</small><button className="link" type="button" disabled={fareLoadingId === t.id} onClick={() => void openFareAudit(t)}>{fareLoadingId === t.id ? "Consultando…" : "Ver cálculo"}</button></> : null}</div>,
      <div><Badge value={t.scheduleStatus ?? t.status} /><small className="table-line">{stateLabels[t.status] ?? String(t.status).replaceAll("_", " ")}</small></div>,
      money(t.quotedTotalCents),
      new Date(t.requestedAt).toLocaleString(),
      admin && !["COMPLETED", "CANCELLED", "NO_DRIVER"].includes(t.status) ? <button className="link" onClick={() => { setError(""); setCancelTrip(t); }}>Cancelar</button> : "—"
    ])} /> : <Empty text="No hay viajes para los filtros seleccionados." />}</section>
    {cancelTrip && <DecisionDialog title="Cancelar viaje" description={<>Esta acción avisará a <strong>{cancelTrip.passenger}</strong>{cancelTrip.driver ? <> y a <strong>{cancelTrip.driver}</strong></> : null}.</>} fieldLabel="Motivo de cancelación" initialValue="Cancelado desde el panel administrativo" required confirmLabel="Cancelar viaje" dangerous busy={cancelling} error={error} onCancel={() => { if (!cancelling) { setCancelTrip(null); setError(""); } }} onConfirm={cancel} />}
    {fareTrip && <FareAuditDialog trip={fareTrip} onClose={() => setFareTrip(null)} />}
  </>;
}

function PasswordReset({ token, userId, userName }: { token: string; userId: string; userName: string }) {
  const [open, setOpen] = useState(false); const [password, setPassword] = useState(""); const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [success, setSuccess] = useState(false); const [showPassword,setShowPassword]=useState(false);
  function close() { if (!busy) { setOpen(false); setPassword(""); setConfirmation(""); setError(""); } }
  function generatePassword(){const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";const random=crypto.getRandomValues(new Uint32Array(12));const generated=`Cg!7${Array.from(random,value=>alphabet[value%alphabet.length]).join("")}`;setPassword(generated);setConfirmation(generated);setShowPassword(true);setError("");}
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(""); setSuccess(false);
    const policyError = strongPasswordError(password); if (policyError) { setError(policyError); return; }
    if (password !== confirmation) { setError("Las contraseñas no coinciden."); return; }
    setBusy(true);
    try { await apiFetch(`/v1/admin/users/${userId}/reset-password`, token, { method: "POST", body: JSON.stringify({ password }) }); setSuccess(true); setOpen(false); setPassword(""); setConfirmation(""); }
    catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  }
  return <><button className="link" type="button" onClick={() => { setSuccess(false); setOpen(true); }}>Restablecer clave</button>{success && <small className="inline-success">Clave temporal actualizada</small>}{open && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><form className="modal-card" role="dialog" aria-modal="true" aria-label={`Restablecer contraseña de ${userName}`} onSubmit={submit}><Header eyebrow="SEGURIDAD" title="Restablecer contraseña" /><p>Define una clave temporal para <strong>{userName}</strong>. Se cerrarán sus sesiones activas y deberá crear una contraseña personal en su próximo ingreso.</p><button className="secondary" type="button" onClick={generatePassword}>Generar clave temporal segura</button><label>Nueva contraseña temporal<input autoFocus autoComplete="new-password" type={showPassword?"text":"password"} minLength={10} maxLength={100} required value={password} onChange={event => setPassword(event.target.value)} /></label><small>10+ caracteres con mayúscula, minúscula, número y símbolo.</small><label>Confirmar contraseña<input autoComplete="new-password" type={showPassword?"text":"password"} minLength={10} maxLength={100} required value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label><label className="inline-check"><input type="checkbox" checked={showPassword} onChange={event=>setShowPassword(event.target.checked)}/> Mostrar temporalmente la clave</label><Notice error={error} /><div className="modal-actions"><button className="secondary" type="button" disabled={busy} onClick={close}>Cancelar</button><button className="primary" disabled={busy}>{busy ? "Guardando…" : "Restablecer y cerrar sesiones"}</button></div></form></div>}</>;
}

function DriverDocuments({ token, driver, canManage, onChanged }: { token: string; driver: any; canManage: boolean; onChanged?: () => void }) {
  const labels: Record<string, string> = { PROFILE_PHOTO: "Foto del conductor", IDENTIFICATION: "Documento de identificación", LICENSE: "Licencia de conducir", REGISTRATION: "Matrícula de la mototaxi", OPERATING_PERMIT: "Permiso de operación" };
  const [open, setOpen] = useState(false); const [items, setItems] = useState<any[]>([]); const [error, setError] = useState(""); const [busy, setBusy] = useState("");
  const [action, setAction] = useState<{ kind: "review"; item: any; status: "ACTIVE" | "REJECTED" } | { kind: "deactivate"; item: any } | null>(null);
  async function load() { setError(""); try { setItems(await apiFetch<any[]>(`/v1/admin/drivers/${driver.id}/documents`, token)); setOpen(true); } catch (reason) { setError(errorText(reason)); } }
  function notifyChanged() { onChanged?.(); window.dispatchEvent(new CustomEvent("driver-documents-changed")); }
  async function upload(documentType: string, file?: File) { if (!file) return; const imageTypes=["image/jpeg","image/png","image/webp"]; const permitTypes=[...imageTypes,"application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document"]; const allowed=documentType==="OPERATING_PERMIT"?permitTypes:imageTypes; const maximum=documentType==="OPERATING_PERMIT"?5_000_000:2_500_000; if(file.size>maximum||!allowed.includes(file.type)){setError(documentType==="OPERATING_PERMIT"?"Usa JPG, PNG, WebP, PDF, DOC o DOCX de máximo 5 MB.":"Usa JPG, PNG o WebP de máximo 2,5 MB.");return;} setBusy(documentType); const reader = new FileReader(); reader.onload = async () => { try { await apiFetch(`/v1/admin/drivers/${driver.id}/documents`, token, { method: "POST", body: JSON.stringify({ documentType, fileMime: file.type, fileBase64: String(reader.result).split(",")[1] }) }); await load(); notifyChanged(); } catch (reason) { setError(errorText(reason)); } finally { setBusy(""); } }; reader.onerror = () => { setBusy(""); setError("No se pudo leer el archivo."); }; reader.readAsDataURL(file); }
  useEffect(()=>{if(!open)return;queueMicrotask(()=>{const inputs=document.querySelectorAll<HTMLInputElement>(".document-grid input[type=file]");inputs.forEach((input,index)=>{input.accept=index===4?"image/jpeg,image/png,image/webp,application/pdf,.doc,.docx":"image/jpeg,image/png,image/webp";});});},[open]);
  function review(item: any, status: "ACTIVE" | "REJECTED") { setError(""); setAction({ kind: "review", item, status }); }
  function deactivate(item: any) { if (item.documentType === "PROFILE_PHOTO") { setError("La foto obligatoria no puede desactivarse; reemplázala por una nueva."); return; } setError(""); setAction({ kind: "deactivate", item }); }
  async function submitAction(note: string) {
    if (!action) return;
    setBusy(action.item.id); setError("");
    try {
      if (action.kind === "review") await apiFetch(`/v1/admin/drivers/${driver.id}/documents/${action.item.id}`, token, { method: "PATCH", body: JSON.stringify({ status: action.status, note }) });
      else await apiFetch(`/v1/admin/drivers/${driver.id}/documents/${action.item.id}`, token, { method: "DELETE" });
      setAction(null); await load(); notifyChanged();
    } catch (reason) { setError(errorText(reason)); } finally { setBusy(""); }
  }
  function openFile(item: any, download = false) { const bytes = Uint8Array.from(atob(item.fileBase64), char => char.charCodeAt(0)); const url = URL.createObjectURL(new Blob([bytes], { type: item.fileMime })); const anchor = document.createElement("a"); anchor.href = url; anchor.target = "_blank"; const extension=item.fileMime==="application/pdf"?"pdf":item.fileMime==="application/msword"?"doc":item.fileMime.includes("wordprocessingml")?"docx":item.fileMime.split("/")[1]; if (download) anchor.download = `${item.documentType.toLowerCase()}.${extension}`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000); }
  const actionLabel = action ? labels[action.item.documentType] ?? "documento" : "documento";
  return <><button className="link" type="button" onClick={load}>Administrar documentos</button>{open && <div className="modal-backdrop document-backdrop" role="presentation" onMouseDown={event => { if (!busy && event.target === event.currentTarget) setOpen(false); }}><section className="modal-card document-modal" role="dialog" aria-modal="true" aria-label={`Documentos de ${driver.name}`}><div className="document-modal-heading"><Header eyebrow="IDENTIDAD Y HABILITANTES" title={driver.name} action={driver.email} /><button className="modal-close-button" type="button" aria-label="Cerrar documentos" disabled={Boolean(busy)} onClick={() => setOpen(false)}>×</button></div><Notice error={error} /><div className="document-grid">{Object.entries(labels).map(([type, label]) => { const item = items.find(value => value.documentType === type); return <article className="document-item" key={type}>{item?.fileBase64 ? <img src={`data:${item.fileMime};base64,${item.fileBase64}`} alt={label} /> : <div className="document-placeholder">Sin archivo</div>}<strong>{label}</strong><small>{type === "OPERATING_PERMIT" ? "Opcional · No impide aprobar al conductor" : "Obligatorio"}</small>{item ? <><Badge value={item.status} /><small>Cargado: {new Date(item.createdAt).toLocaleString()}</small>{item.expiresAt && <small>Vence: {new Date(item.expiresAt).toLocaleDateString()}</small>}{item.reviewNote && <small>{item.reviewNote}</small>}<div className="row-actions document-file-actions"><button className="link" type="button" onClick={() => openFile(item)}>Abrir</button><button className="link" type="button" onClick={() => openFile(item, true)}>Descargar</button></div></> : <small>{type === "OPERATING_PERMIT" ? "Sin archivo opcional" : "Pendiente de cargar"}</small>}{canManage && <><label className="file-action">{item ? "Reemplazar" : "Cargar"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={Boolean(busy)} onChange={event => upload(type, event.target.files?.[0])} /></label>{item && <div className="row-actions document-review-actions"><button className="link" type="button" disabled={busy === item.id} onClick={() => review(item, "ACTIVE")}>Aprobar</button><button className="link danger" type="button" disabled={busy === item.id} onClick={() => review(item, "REJECTED")}>Rechazar</button><button className="link danger" type="button" disabled={busy === item.id} onClick={() => deactivate(item)}>Desactivar</button></div>}</>}</article>; })}</div><div className="document-modal-footer"><button className="secondary" type="button" disabled={Boolean(busy)} onClick={() => setOpen(false)}>Cerrar</button></div></section></div>}{action && <DecisionDialog title={action.kind === "deactivate" ? "Desactivar documento" : action.status === "ACTIVE" ? "Aprobar documento" : "Rechazar documento"} description={<><strong>{actionLabel}</strong> de {driver.name}</>} fieldLabel={action.kind === "review" && action.status === "ACTIVE" ? "Observación de aprobación" : "Motivo"} initialValue={action.kind === "review" ? action.status === "ACTIVE" ? "Documento verificado" : "Documento ilegible o incompleto" : ""} required={action.kind === "review"} showField={action.kind === "review"} confirmLabel={action.kind === "deactivate" ? "Sí, desactivar" : action.status === "ACTIVE" ? "Aprobar documento" : "Rechazar documento"} dangerous={action.kind === "deactivate" || (action.kind === "review" && action.status === "REJECTED")} busy={Boolean(busy)} error={error} onCancel={() => { if (!busy) { setAction(null); setError(""); } }} onConfirm={submitAction} />}</>;
}

function DriverApprovalInbox({ token, canManageDocuments, onChanged }: { token: string; canManageDocuments: boolean; onChanged: () => void }) {
  const [items, setItems] = useState<any[]>([]); const [busy, setBusy] = useState(""); const [error, setError] = useState("");
  const [decisionAction, setDecisionAction] = useState<{ driver: any; decision: "APPROVE" | "REQUEST_CORRECTIONS" | "REJECT" } | null>(null);
  const load = () => apiFetch<any[]>("/v1/admin/driver-approvals", token).then(setItems).catch(reason => setError(errorText(reason)));
  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener("driver-documents-changed", refresh);
    window.addEventListener("mobile-account-changed", refresh);
    return () => {window.removeEventListener("driver-documents-changed", refresh);window.removeEventListener("mobile-account-changed", refresh);};
  }, [token]);
  function decide(driver: any, decision: "APPROVE" | "REQUEST_CORRECTIONS" | "REJECT") { setError(""); setDecisionAction({ driver, decision }); }
  async function submitDecision(observation: string) {
    if (!decisionAction) return;
    setBusy(decisionAction.driver.id); setError("");
    try { await apiFetch(`/v1/admin/driver-approvals/${decisionAction.driver.id}/decision`, token, { method: "POST", body: JSON.stringify({ decision: decisionAction.decision, observation }) }); setDecisionAction(null); await load(); onChanged(); }
    catch (reason) { setError(errorText(reason)); } finally { setBusy(""); }
  }
  const pending = items.filter(item => ["PENDIENTE_REVISION", "OBSERVADO", "PENDIENTE_DOCUMENTOS"].includes(item.approvalStatus));
  const decisionTitles = { APPROVE: "Aprobar conductor", REQUEST_CORRECTIONS: "Solicitar correcciones", REJECT: "Rechazar conductor" };
  return <><section className="card approval-inbox"><Header eyebrow="BANDEJA DE APROBACIONES" title="Conductores pendientes" action={`${pending.length} solicitudes`} /><Notice error={error} />{pending.length ? <div className="approval-grid">{pending.map(driver => <article className="approval-card" key={driver.id}>{driver.profilePhotoBase64 ? <img src={`data:${driver.profilePhotoMime};base64,${driver.profilePhotoBase64}`} alt={driver.name} /> : <div className="approval-avatar">{driver.name?.[0] ?? "?"}</div>}<div className="approval-summary"><strong>{driver.name}</strong><small>{driver.email} · {driver.phone}</small><small>{driver.vehicle ?? "Sin vehículo"} · {driver.cooperative}</small><div><Badge value={driver.approvalStatus} /> <span>{driverDocumentProgress(driver).label}</span></div>{driver.approvalObservation && <p>{driver.approvalObservation}</p>}<DriverDocuments token={token} driver={driver} canManage={canManageDocuments} /></div><div className="approval-actions"><button className="primary" disabled={busy === driver.id || !driverDocumentProgress(driver).complete} onClick={() => decide(driver, "APPROVE")}>Aprobar</button><button className="secondary" disabled={busy === driver.id} onClick={() => decide(driver, "REQUEST_CORRECTIONS")}>Solicitar correcciones</button><button className="link danger" disabled={busy === driver.id} onClick={() => decide(driver, "REJECT")}>Rechazar</button></div></article>)}</div> : <Empty text="No existen conductores pendientes de revisión." />}</section>{decisionAction && <DecisionDialog title={decisionTitles[decisionAction.decision]} description={<>Revisa la decisión para <strong>{decisionAction.driver.name}</strong>. El conductor recibirá este resultado en la aplicación.</>} fieldLabel={decisionAction.decision === "APPROVE" ? "Observación de aprobación" : "Observación para el conductor"} initialValue={decisionAction.decision === "APPROVE" ? "Documentación completa y verificada" : decisionAction.driver.approvalObservation ?? ""} required={decisionAction.decision !== "APPROVE"} confirmLabel={decisionTitles[decisionAction.decision]} dangerous={decisionAction.decision === "REJECT"} busy={Boolean(busy)} error={error} onCancel={() => { if (!busy) { setDecisionAction(null); setError(""); } }} onConfirm={submitDecision} />}</>;
}

function Drivers({ token, canApprove, canViewDocuments, canManageDocuments, canResetPasswords, canEditAccounts, canDeleteIncomplete }: { token: string; canApprove: boolean; canViewDocuments: boolean; canManageDocuments: boolean; canResetPasswords: boolean; canEditAccounts:boolean; canDeleteIncomplete:boolean }) {
  const [accountMessage,setAccountMessage]=useState("");
  const [data, setData] = useState<any[]>([]); const [error, setError] = useState(""); const [busy, setBusy] = useState<string>();
  const [cooperatives, setCooperatives] = useState<any[]>([]);
  async function load() { try { const next = await apiFetch<any[]>("/v1/admin/drivers", token); setData(next); if (canApprove) setCooperatives(await apiFetch<any[]>("/v1/admin/cooperatives", token)); } catch (reason) { setError(errorText(reason)); } }
  useEffect(() => { void load(); }, [token, canApprove]);
  async function update(driver: any, status = driver.status, deunaEnabled = Boolean(driver.deunaEnabled), cooperativeId: string | null | undefined = driver.cooperativeId) { setBusy(driver.id); setError(""); try { await apiFetch(`/v1/admin/drivers/${driver.id}`, token, { method: "PATCH", body: JSON.stringify({ status, deunaEnabled, cooperativeId, reason: status === "ACTIVE" ? "Conductor aprobado desde el panel" : "Estado actualizado desde el panel" }) }); await load(); } catch (reason) { setError(errorText(reason)); } finally { setBusy(undefined); } }
  return <>{canApprove && <DriverApprovalInbox token={token} canManageDocuments={canManageDocuments} onChanged={() => void load()} />}<section className="card"><Header eyebrow="GESTIÓN GENERAL" title="Todos los conductores" action={`${data.length} registrados`} /><Notice error={error} />{accountMessage&&<p className="note" role="status">{accountMessage}</p>}{data.length ? <Table headers={["Nombre", "Correo", "Teléfono", "Vehículo", "Cooperativa", "Documentos", "Aprobación", "Transferencia", "Acción"]} rows={data.map(driver => [driver.name, driver.email ?? "Sin correo", driver.phone, driver.vehicle, canApprove ? <select aria-label={`Cooperativa de ${driver.name}`} value={driver.cooperativeId ?? ""} disabled={busy === driver.id} onChange={event => update(driver, driver.status, Boolean(driver.deunaEnabled), event.target.value || null)}><option value="">Sin cooperativa</option>{cooperatives.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : driver.cooperativeName ?? "Sin cooperativa", <div><span>{driver.documents}</span>{canViewDocuments && <DriverDocuments token={token} driver={driver} canManage={canManageDocuments} />}</div>, <Badge value={driver.approvalStatus ?? driver.status} />, canApprove ? <input aria-label={`Transferencia para ${driver.name}`} type="checkbox" checked={Boolean(driver.deunaEnabled)} disabled={busy === driver.id} onChange={e => update(driver, driver.status, e.target.checked)} /> : "—", canEditAccounts || canDeleteIncomplete || canResetPasswords ? <div className="row-actions"><MobileAccountActions token={token} account={driver} canEdit={canEditAccounts} canDelete={canDeleteIncomplete} onChanged={async message=>{setAccountMessage(message);await load();}}/>{canResetPasswords&&<PasswordReset token={token} userId={driver.id} userName={driver.name}/>}</div> : "Solo lectura"])} /> : <Empty text="No hay conductores registrados." />}</section></>;
}

function Passengers({ token, canManage, canResetPasswords, canEditAccounts }: { token: string; canManage: boolean; canResetPasswords: boolean; canEditAccounts:boolean }) {
  const [accountMessage,setAccountMessage]=useState("");
  const [data, setData] = useState<any[]>([]); const [error, setError] = useState("");
  const load = () => apiFetch<any[]>("/v1/admin/passengers", token).then(setData).catch(reason => setError(errorText(reason)));
  useEffect(() => { void load(); }, [token]);
  async function update(passenger: any) { try { await apiFetch(`/v1/admin/passengers/${passenger.id}`, token, { method: "PATCH", body: JSON.stringify({ status: passenger.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE", reason: "Actualización desde el panel administrativo" }) }); await load(); } catch (reason) { setError(errorText(reason)); } }
  return <section className="card"><Header eyebrow="USUARIOS" title="Pasajeros" action={`${data.length} registrados`} /><Notice error={error} />{accountMessage&&<p className="note" role="status">{accountMessage}</p>}{data.length ? <Table headers={["Nombre", "Correo", "Teléfono", "Viajes", "Último viaje", "Estado", "Acción"]} rows={data.map(passenger => [<div>{passenger.name}<PassengerCancellationHistory token={token} passenger={passenger}/></div>, passenger.email ?? "Sin correo", passenger.phone, passenger.trips, passenger.lastTrip ? new Date(passenger.lastTrip).toLocaleString() : "Sin viajes", <Badge value={passenger.status} />, canManage || canResetPasswords || canEditAccounts ? <div className="row-actions"><MobileAccountActions token={token} account={passenger} canEdit={canEditAccounts} onChanged={async message=>{setAccountMessage(message);await load();}}/>{canManage && <button className="link" onClick={() => update(passenger)}>{passenger.status === "ACTIVE" ? "Suspender" : "Reactivar"}</button>}{canResetPasswords && <PasswordReset token={token} userId={passenger.id} userName={passenger.name} />}</div> : "Solo lectura"])} /> : <Empty text="No hay pasajeros registrados." />}</section>;
}

function Pricing({ token, admin }: { token: string; admin: boolean }) {
  const [data, setData] = useState<any[]>([]); const [error, setError] = useState(""); const [success, setSuccess] = useState("");
  const [form, setForm] = useState({ urbanDayCents: 50, nightCents: 100, extendedCents: 100, stopSurchargeCents: 25, platformCommissionCentsPerLeg: 5, promotionPassengers: 3, promotionTotalCents: 100, activeFrom: new Date().toISOString().slice(0, 16) });
  const load = () => apiFetch<any[]>("/v1/admin/pricing", token).then(setData).catch(reason => setError(errorText(reason)));
  useEffect(() => { void load(); }, [token]);
  async function save(event: React.FormEvent) { event.preventDefault(); setError(""); setSuccess(""); try { await apiFetch("/v1/admin/pricing", token, { method: "POST", body: JSON.stringify(form) }); setSuccess("Nueva versión tarifaria publicada correctamente."); await load(); } catch (reason) { setError(errorText(reason)); } }
  return <div className="split"><section className="card"><Header eyebrow="HISTORIAL" title="Versiones tarifarias" action={`${data.length} versiones`} /><p className="muted">Las versiones son históricas y no se editan. Al iniciar una nueva versión, la anterior se finaliza automáticamente.</p><Notice error={error} success={success} />{data.length ? <Table headers={["Versión", "Urbana día", "Noche", "Extendida", "Por parada", "Comisión/tramo", "Promoción", "Vigencia", "Estado"]} rows={data.map(price => [`v${price.version}`, money(price.urbanDayCents), money(price.nightCents), money(price.extendedCents), money(price.stopSurchargeCents ?? 0), money(price.platformCommissionCentsPerLeg ?? 0), `${price.promotionPassengers} pasajeros por ${money(price.promotionTotalCents)}`, <div><small className="table-line">Desde: {new Date(price.activeFrom).toLocaleString()}</small><small className="table-line">Hasta: {price.activeUntil ? new Date(price.activeUntil).toLocaleString() : "Sin fecha definida"}</small></div>, <PricingBadge value={price.status} />])} /> : <Empty text="No hay tarifas configuradas." />}</section>{admin && <form className="card form-card" onSubmit={save}><Header eyebrow="PUBLICAR" title="Nueva versión" /><div className="form-grid">{([ ["urbanDayCents", "Urbana de día (centavos)"], ["nightCents", "Nocturna (centavos)"], ["extendedCents", "Extendida heredada (centavos)"], ["stopSurchargeCents", "Adicional por cada parada (centavos)"], ["platformCommissionCentsPerLeg", "Comisión interna por tramo (centavos)"], ["promotionPassengers", "Pasajeros promoción"], ["promotionTotalCents", "Total promoción (centavos)"] ] as Array<[keyof typeof form, string]>).map(([key, label]) => <label key={key}>{label}<input min="0" required type="number" value={form[key]} onChange={e => setForm({ ...form, [key]: Number(e.target.value) })} /></label>)}<p className="note">La comisión se suma al total de cada tramo, pero no se desglosa al pasajero. El recargo por parada se aplica una vez por cada destino intermedio.</p><label>Vigente desde<input required type="datetime-local" value={form.activeFrom} onChange={e => setForm({ ...form, activeFrom: e.target.value })} /></label></div><button className="primary">Publicar versión</button></form>}</div>;
}

type SettingsPanel = "search" | "fare" | "scheduled" | "documents" | "safety" | "notifications";

function Settings({ token, admin }: { token: string; admin: boolean }) {
  const [radius, setRadius] = useState(3000); const [success, setSuccess] = useState(""); const [error, setError] = useState("");
  const [initialRadius, setInitialRadius] = useState(1000);
  const [radiusIncrement, setRadiusIncrement] = useState(1000);
  const [roundWaitSeconds, setRoundWaitSeconds] = useState(15);
  const [scheduledLead, setScheduledLead] = useState(10);
  const [scheduledMinimumNotice, setScheduledMinimumNotice] = useState(30);
  const [documentExpiryDays, setDocumentExpiryDays] = useState(30);
  const [distanceFareCentsPerKm, setDistanceFareCentsPerKm] = useState(50);
  const [localFareMaxDistanceMeters, setLocalFareMaxDistanceMeters] = useState(2000);
  const [distanceFareMinimumCents, setDistanceFareMinimumCents] = useState(0);
  const [tripTrackingGraceMinutes, setTripTrackingGraceMinutes] = useState(45);
  const [supportWhatsappCountryCode, setSupportWhatsappCountryCode] = useState("593");
  const [supportWhatsappNumber, setSupportWhatsappNumber] = useState("");
  const [supportWhatsappEnabled, setSupportWhatsappEnabled] = useState(false);
  const [approvalSettings, setApprovalSettings] = useState({ adminEmails: [] as string[], emailEnabled: false, internalEnabled: true, pushEnabled: true });
  const [activePanel, setActivePanel] = useState<SettingsPanel | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([apiFetch<any>("/v1/admin/settings", token), apiFetch<typeof approvalSettings>("/v1/admin/driver-approval-settings", token)])
      .then(([settings, approval]) => {
        setRadius(settings.searchRadiusMeters); setInitialRadius(settings.driverSearchInitialRadiusMeters ?? 1000);
        setRadiusIncrement(settings.driverSearchRadiusIncrementMeters ?? 1000); setRoundWaitSeconds(settings.driverSearchRoundWaitSeconds ?? 15);
        setScheduledLead(settings.scheduledTripLeadMinutes ?? 10); setScheduledMinimumNotice(settings.scheduledTripMinimumNoticeMinutes ?? 30);
        setDocumentExpiryDays(settings.documentExpiryAlertDays ?? 30); setDistanceFareCentsPerKm(settings.distanceFareCentsPerKm ?? 50);
        setLocalFareMaxDistanceMeters(settings.localFareMaxDistanceMeters ?? 2000); setDistanceFareMinimumCents(settings.distanceFareMinimumCents ?? 0);
        setTripTrackingGraceMinutes(settings.tripTrackingGraceMinutes ?? 45); setSupportWhatsappCountryCode(settings.supportWhatsappCountryCode ?? "593");
        setSupportWhatsappNumber(settings.supportWhatsappNumber ?? ""); setSupportWhatsappEnabled(settings.supportWhatsappEnabled ?? false);
        setApprovalSettings(approval);
      }).catch(reason => setError(errorText(reason)));
  }, [token]);

  async function saveConfiguration(event: React.FormEvent) {
    event.preventDefault(); setSuccess(""); setError(""); setBusy(true);
    try {
      const value = await apiFetch<any>("/v1/admin/settings", token, { method: "PATCH", body: JSON.stringify({ searchRadiusMeters: radius, driverSearchInitialRadiusMeters: initialRadius, driverSearchRadiusIncrementMeters: radiusIncrement, driverSearchRoundWaitSeconds: roundWaitSeconds, scheduledTripLeadMinutes: scheduledLead, scheduledTripMinimumNoticeMinutes: scheduledMinimumNotice, documentExpiryAlertDays: documentExpiryDays, distanceFareCentsPerKm, localFareMaxDistanceMeters, distanceFareMinimumCents, tripTrackingGraceMinutes, supportWhatsappCountryCode, supportWhatsappNumber, supportWhatsappEnabled }) });
      setRadius(value.searchRadiusMeters); setInitialRadius(value.driverSearchInitialRadiusMeters); setRadiusIncrement(value.driverSearchRadiusIncrementMeters);
      setRoundWaitSeconds(value.driverSearchRoundWaitSeconds); setScheduledLead(value.scheduledTripLeadMinutes);
      setScheduledMinimumNotice(value.scheduledTripMinimumNoticeMinutes); setDocumentExpiryDays(value.documentExpiryAlertDays);
      setDistanceFareCentsPerKm(value.distanceFareCentsPerKm); setLocalFareMaxDistanceMeters(value.localFareMaxDistanceMeters);
      setDistanceFareMinimumCents(value.distanceFareMinimumCents); setSuccess("Configuración operativa guardada correctamente."); setActivePanel(null);
      setTripTrackingGraceMinutes(value.tripTrackingGraceMinutes); setSupportWhatsappCountryCode(value.supportWhatsappCountryCode);
      setSupportWhatsappNumber(value.supportWhatsappNumber); setSupportWhatsappEnabled(value.supportWhatsappEnabled);
    } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  }

  async function saveApprovals(event: React.FormEvent) {
    event.preventDefault(); setSuccess(""); setError(""); setBusy(true);
    try {
      const value = await apiFetch<typeof approvalSettings>("/v1/admin/driver-approval-settings", token, { method: "PUT", body: JSON.stringify(approvalSettings) });
      setApprovalSettings(value); setSuccess("Avisos administrativos actualizados correctamente."); setActivePanel(null);
    } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  }

  const panels: Array<{ id: SettingsPanel; eyebrow: string; title: string; description: string; icon: string; values: Array<[string, string]> }> = [
    { id: "search", eyebrow: "DESPACHO", title: "Búsqueda de conductores", description: "Rondas progresivas desde el origen del pasajero.", icon: "⌖", values: [["Primera ronda", `${(initialRadius / 1000).toFixed(1)} km`], ["Incremento", `${(radiusIncrement / 1000).toFixed(1)} km`], ["Radio máximo", `${(radius / 1000).toFixed(1)} km`], ["Espera por ronda", `${roundWaitSeconds} s`]] },
    { id: "fare", eyebrow: "TARIFA DE RESPALDO", title: "Cálculo por distancia", description: "Respaldo cuando no existe una regla territorial exacta.", icon: "$", values: [["Valor por km", money(distanceFareCentsPerKm)], ["Límite local", `${(localFareMaxDistanceMeters / 1000).toFixed(1)} km`], ["Tarifa mínima", money(distanceFareMinimumCents)]] },
    { id: "scheduled", eyebrow: "RESERVAS", title: "Viajes programados", description: "Anticipación mínima y activación automática de reservas.", icon: "◷", values: [["Reserva mínima", `${scheduledMinimumNotice} min`], ["Activación previa", `${scheduledLead} min`]] },
    { id: "documents", eyebrow: "DOCUMENTOS", title: "Alertas de vencimiento", description: "Aviso anticipado de documentos próximos a caducar.", icon: "▤", values: [["Anticipación", `${documentExpiryDays} días`]] },
    { id: "safety", eyebrow: "SEGURIDAD", title: "Viaje compartido y soporte", description: "Enlaces seguros de seguimiento y atención por WhatsApp.", icon: "🛡", values: [["Vigencia posterior", `${tripTrackingGraceMinutes} min`], ["WhatsApp", supportWhatsappEnabled && supportWhatsappNumber ? "Habilitado" : "Deshabilitado"]] },
    { id: "notifications", eyebrow: "APROBACIONES", title: "Avisos administrativos", description: "Canales y destinatarios para novedades de aprobación.", icon: "◉", values: [["Correos", `${approvalSettings.adminEmails.length} configurado(s)`], ["Canales activos", `${[approvalSettings.internalEnabled, approvalSettings.emailEnabled, approvalSettings.pushEnabled].filter(Boolean).length} de 3`]] }
  ];

  function modalContent() {
    if (activePanel === "search") return <><label>Radio de la primera ronda<div className="radius-control"><input type="number" min="100" max={radius} step="100" value={initialRadius} disabled={!admin} onChange={e => setInitialRadius(Number(e.target.value))} /><span>metros</span></div></label><label>Incremento de distancia por ronda<div className="radius-control"><input type="number" min="100" max="20000" step="100" value={radiusIncrement} disabled={!admin} onChange={e => setRadiusIncrement(Number(e.target.value))} /><span>metros</span></div></label><label>Radio máximo desde el origen<div className="range-with-value"><input type="range" min="500" max="20000" step="500" value={radius} disabled={!admin} onChange={e => setRadius(Number(e.target.value))} /><div className="radius-control"><input type="number" min="500" max="20000" step="500" value={radius} disabled={!admin} onChange={e => setRadius(Number(e.target.value))} /><span>metros</span></div></div></label><label>Espera antes de ampliar la ronda<div className="radius-control"><input type="number" min="5" max="300" step="1" value={roundWaitSeconds} disabled={!admin} onChange={e => setRoundWaitSeconds(Number(e.target.value))} /><span>segundos</span></div></label><p className="note">Cada ronda consulta solamente una franja nueva y cada conductor recibe la solicitud una sola vez.</p></>;
    if (activePanel === "fare") return <><label>Valor por kilómetro de ruta<div className="radius-control"><input type="number" min="1" max="10000" step="1" value={distanceFareCentsPerKm} disabled={!admin} onChange={e => setDistanceFareCentsPerKm(Number(e.target.value))} /><span>centavos/km</span></div></label><label>Distancia máxima considerada local<div className="radius-control"><input type="number" min="100" max="50000" step="100" value={localFareMaxDistanceMeters} disabled={!admin} onChange={e => setLocalFareMaxDistanceMeters(Number(e.target.value))} /><span>metros</span></div></label><label>Tarifa mínima por distancia<div className="radius-control"><input type="number" min="0" max="100000" step="1" value={distanceFareMinimumCents} disabled={!admin} onChange={e => setDistanceFareMinimumCents(Number(e.target.value))} /><span>centavos</span></div></label><p className="note">Prioridad: regla territorial exacta → tarifa por km → valor sugerido local. La comisión vigente se suma por tramo.</p></>;
    if (activePanel === "scheduled") return <><label>Tiempo mínimo para reservar<div className="range-with-value"><input type="range" min="5" max="720" step="5" value={scheduledMinimumNotice} disabled={!admin} onChange={e => setScheduledMinimumNotice(Number(e.target.value))} /><div className="radius-control"><input type="number" min="5" max="720" step="5" value={scheduledMinimumNotice} disabled={!admin} onChange={e => setScheduledMinimumNotice(Number(e.target.value))} /><span>minutos</span></div></div></label><label>Anticipación para activar y recordar<div className="range-with-value"><input type="range" min="5" max="60" step="5" value={scheduledLead} disabled={!admin} onChange={e => setScheduledLead(Number(e.target.value))} /><div className="radius-control"><input type="number" min="5" max="60" step="5" value={scheduledLead} disabled={!admin} onChange={e => setScheduledLead(Number(e.target.value))} /><span>minutos</span></div></div></label><p className="note">Al llegar a la anticipación configurada, la reserva entra al flujo activo y se notifica a ambas partes.</p></>;
    if (activePanel === "documents") return <><label>Días de anticipación<div className="range-with-value"><input type="range" min="1" max="180" step="1" value={documentExpiryDays} disabled={!admin} onChange={e => setDocumentExpiryDays(Number(e.target.value))} /><div className="radius-control"><input type="number" min="1" max="180" value={documentExpiryDays} disabled={!admin} onChange={e => setDocumentExpiryDays(Number(e.target.value))} /><span>días</span></div></div></label><p className="note">El Centro de alertas incluirá licencias, matrículas, identificaciones y permisos antes de su vencimiento.</p></>;
    if (activePanel === "safety") return <><label>Vigencia después de finalizar el viaje<div className="radius-control"><input type="number" min="30" max="60" step="5" value={tripTrackingGraceMinutes} disabled={!admin} onChange={e => setTripTrackingGraceMinutes(Number(e.target.value))} /><span>minutos</span></div></label><label>Código de país<input type="text" inputMode="numeric" maxLength={4} value={supportWhatsappCountryCode} disabled={!admin} onChange={e => setSupportWhatsappCountryCode(e.target.value.replace(/\D/g, ""))} placeholder="593" /></label><label>Número de WhatsApp de soporte<input type="text" inputMode="tel" maxLength={30} value={supportWhatsappNumber} disabled={!admin} onChange={e => setSupportWhatsappNumber(e.target.value)} placeholder="0991234567" /></label><div className="settings-toggle-list"><label><span><strong>Soporte por WhatsApp</strong><small>Permite contactar al equipo con el contexto seguro del viaje.</small></span><input type="checkbox" disabled={!admin || !supportWhatsappNumber.trim()} checked={supportWhatsappEnabled} onChange={e => setSupportWhatsappEnabled(e.target.checked)} /></label></div><p className="note">El pasajero y el conductor comparten una referencia pública; nunca se expone el identificador interno del viaje.</p></>;
    return null;
  }

  const activeDefinition = panels.find(panel => panel.id === activePanel);
  return <div className="operations-settings">
    <PassengerCancellationSettings token={token} canManage={admin}/>
    <section className="settings-intro"><div><span className="eyebrow">CONTROL CENTRAL</span><h2>Parámetros de operación</h2><p>Consulta la configuración vigente y edita únicamente el grupo que necesites.</p></div><span className="settings-access">{admin ? "Edición habilitada" : "Solo lectura"}</span></section>
    <Notice error={error} success={success} />
    <div className="settings-overview-grid">{panels.map(panel => <article className="settings-summary-card" key={panel.id}><div className="settings-summary-heading"><span className="settings-summary-icon" aria-hidden="true">{panel.icon}</span><div><span className="eyebrow">{panel.eyebrow}</span><h3>{panel.title}</h3></div></div><p>{panel.description}</p><dl>{panel.values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><button className="secondary settings-edit-button" type="button" onClick={() => { setError(""); setSuccess(""); setActivePanel(panel.id); }}>{admin ? "Configurar" : "Ver detalle"}<span aria-hidden="true">→</span></button></article>)}</div>
    {activePanel && activeDefinition && <div className="modal-backdrop settings-modal-backdrop" role="presentation" onMouseDown={event => { if (!busy && event.target === event.currentTarget) setActivePanel(null); }}><section className="modal-card settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title"><div className="settings-modal-heading"><div><span className="eyebrow">{activeDefinition.eyebrow}</span><h2 id="settings-modal-title">{activeDefinition.title}</h2><p>{activeDefinition.description}</p></div><button className="modal-close-button" type="button" aria-label="Cerrar" disabled={busy} onClick={() => setActivePanel(null)}>×</button></div>{activePanel === "notifications" ? <form className="settings-modal-form" onSubmit={saveApprovals}><label>Correos administrativos<input type="text" disabled={!admin} value={approvalSettings.adminEmails.join(", ")} onChange={event => setApprovalSettings({ ...approvalSettings, adminEmails: event.target.value.split(",").map(value => value.trim()).filter(Boolean) })} placeholder="operaciones@empresa.com, admin@empresa.com" /></label><div className="settings-toggle-list"><label><span><strong>Notificación interna</strong><small>Mostrar novedades dentro del panel.</small></span><input type="checkbox" disabled={!admin} checked={approvalSettings.internalEnabled} onChange={event => setApprovalSettings({ ...approvalSettings, internalEnabled: event.target.checked })} /></label><label><span><strong>Notificación por correo</strong><small>Enviar el aviso a los destinatarios configurados.</small></span><input type="checkbox" disabled={!admin} checked={approvalSettings.emailEnabled} onChange={event => setApprovalSettings({ ...approvalSettings, emailEnabled: event.target.checked })} /></label><label><span><strong>Respuesta push al conductor</strong><small>Informar el resultado en la aplicación.</small></span><input type="checkbox" disabled={!admin} checked={approvalSettings.pushEnabled} onChange={event => setApprovalSettings({ ...approvalSettings, pushEnabled: event.target.checked })} /></label></div><p className="note">El envío por correo requiere las credenciales de Resend configuradas en la API.</p><div className="settings-modal-actions"><button className="secondary" type="button" disabled={busy} onClick={() => setActivePanel(null)}>Cancelar</button>{admin && <button className="primary" type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar avisos"}</button>}</div></form> : <form className="settings-modal-form" onSubmit={saveConfiguration}>{modalContent()}<div className="settings-modal-actions"><button className="secondary" type="button" disabled={busy} onClick={() => setActivePanel(null)}>Cancelar</button>{admin && <button className="primary" type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar cambios"}</button>}</div></form>}</section></div>}
  </div>;
}

function Advertising({ token, admin }: { token: string; admin: boolean }) {
  const placementLabels:Record<string,string>={PASSENGER_SEARCHING_DRIVER:"Buscando conductor",PASSENGER_WAITING_DRIVER:"Esperando conductor",PASSENGER_TRIP_IN_PROGRESS:"Viaje en curso"};
  const institutionalTypeLabels:Record<string,string>={COSTA_GO:"Costa-Go",PAYMENT_POINT:"Punto de pago",STRATEGIC_ALLIANCE:"Alianza estratégica",COURTESY:"Campaña de cortesía"};
  const displayStatusLabels:Record<string,string>={VISIBLE:"Visible en la aplicación",SCHEDULED:"Pendiente por fecha de inicio",EXPIRED:"Vigencia finalizada",INACTIVE:"Inactiva"};
  const actionLabels:Record<string,string>={WEB:"Sitio web",WHATSAPP:"WhatsApp",PHONE:"Llamada",MAPS:"Ubicación",NONE:"Sin acción"};
  const defaultWhatsAppMessage="Hola, vi su publicidad en Costa-Go y deseo más información.";
  const emptyForm = () => ({ title: "", advertiserName:"Costa-Go", planCode:"BASIC", placement: "PASSENGER_SEARCHING_DRIVER", serviceAreaId:"", weight:1, actionType:"WEB", actionValue:"", actionMessage:"", targetUrl: "", startsAt: localDateTimeInput(), endsAt: localDateTimeInput(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)), sortOrder: 0, active: true, imageBase64: "", imageMime: "", internalCampaignType:"COSTA_GO", internalPartnerName:"", internalReason:"", internalReference:"" });
  const [data, setData] = useState<any[]>([]); const [zones, setZones] = useState<any[]>([]); const [error, setError] = useState(""); const [success, setSuccess] = useState(""); const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const load = () => Promise.all([apiFetch<any[]>("/v1/admin/banners", token),apiFetch<any[]>("/v1/admin/zones",token)]).then(([campaigns,areas])=>{setData(campaigns);setZones(areas);}).catch(reason => setError(errorText(reason)));
  useEffect(() => { void load(); }, [token]);
  function resetForm() { setEditingId(null); setForm(emptyForm()); }
  function edit(item: any) {
    setError(""); setSuccess(""); setEditingId(item.id);
    const placement=Object.hasOwn(placementLabels,item.placement)?item.placement:"PASSENGER_SEARCHING_DRIVER";
    const planCode=item.planCode==="PREMIUM"?"PREMIUM":"BASIC";
    setForm({ title: item.title, advertiserName:item.advertiserName??item.title, planCode, placement, serviceAreaId:item.serviceAreaId??"", weight:item.weight??1, actionType:item.actionType??"WEB", actionValue:item.actionValue??item.targetUrl??"", actionMessage:item.actionMessage??(item.actionType==="WHATSAPP"?defaultWhatsAppMessage:""), targetUrl: item.targetUrl ?? "", startsAt: localDateTimeInput(item.startsAt), endsAt: item.endsAt ? localDateTimeInput(item.endsAt) : localDateTimeInput(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)), sortOrder: item.sortOrder, active: item.active, imageBase64: "", imageMime: "", internalCampaignType:item.internalCampaignType??"COSTA_GO",internalPartnerName:item.internalPartnerName??"",internalReason:item.internalReason??"Contenido institucional existente",internalReference:item.internalReference??"" });
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
      ...fields, serviceAreaId:fields.serviceAreaId||null,
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
      <Header eyebrow="CONTENIDO PROPIO Y CONVENIOS" title="Publicidad institucional y alianzas" action={`${data.filter(item => item.active).length} activas`} />
      <Notice error={error} success={success} />
      <p className="note">Publica piezas propias, puntos de pago, alianzas o cortesías autorizadas. Las campañas vendidas a comercios permanecen en «Comercial y publicidad» y requieren pago conciliado.</p>
      <div className="banner-grid">
        <article className="banner-placeholder-card permanent"><img src="/advertising-placeholder.png" alt="Tu publicidad aquí" /><div><strong>Tu publicidad aquí · pieza fija</strong><p>Respaldo permanente de la app. Se muestra automáticamente cuando no existen campañas vigentes.</p></div></article>
        {data.map(item => <article className={`banner-card ${item.active ? "" : "inactive"}`} key={item.id}>
        <img src={apiUrl(`/v1/banners/${item.id}/image?v=${encodeURIComponent(item.updatedAt)}`)} alt={item.title} />
        <div><strong>{item.title}</strong><small><strong>{institutionalTypeLabels[item.internalCampaignType]??"Costa-Go"}</strong>{item.internalPartnerName?` · ${item.internalPartnerName}`:""}</small><small>{item.internalReason??"Sin motivo registrado"}{item.internalReference?` · Ref. ${item.internalReference}`:""}</small><small>{item.planCode==="PREMIUM"?"Premium":"Básico"} · {item.planCode==="PREMIUM"?"Búsqueda, espera y viaje en curso":placementLabels[item.placement]??"Buscando conductor"} · peso {item.weight}</small><small>Acción: <strong>{actionLabels[item.actionType]??"Sin acción"}</strong>{item.actionType!=="NONE"&&item.actionValue?` · ${item.actionValue}`:""}</small>{item.actionType==="WHATSAPP"&&<small>Mensaje: {item.actionMessage??defaultWhatsAppMessage}</small>}<small>{new Date(item.startsAt).toLocaleString()} — {item.endsAt ? new Date(item.endsAt).toLocaleString() : "sin fecha final"}</small><small><strong>{displayStatusLabels[item.displayStatus]??"Estado por verificar"}</strong>{item.internalAuthorizedBy?` · autorizado por ${item.internalAuthorizedBy}`:""}</small></div>
        {admin && <div className="banner-actions"><button className="secondary" onClick={() => edit(item)}>Editar</button><button className="secondary" onClick={() => toggle(item)}>{item.active ? "Desactivar" : "Activar"}</button></div>}
        </article>)}
      </div>
    </section>
    {admin && <form className="card form-card advertising-form" onSubmit={save}>
      <Header eyebrow={editingId ? "EDITAR PIEZA" : "NUEVA PIEZA"} title={editingId ? "Modificar publicidad institucional" : "Publicar contenido o alianza"} />
      <p className="banner-spec">1200×400 px · JPG, PNG o WebP · máximo 1 MB</p>
      <div className="placement-note"><strong>Campaña con vigencia automática</strong><span>La pieza «Tu publicidad aquí» queda como respaldo permanente cuando no existan campañas activas.</span></div>
      <div className="form-grid"><label>Tipo de publicación<select value={form.internalCampaignType} onChange={e=>setForm({...form,internalCampaignType:e.target.value,internalPartnerName:e.target.value==="COSTA_GO"?"":form.internalPartnerName})}>{Object.entries(institutionalTypeLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>Aliado relacionado<input required={form.internalCampaignType!=="COSTA_GO"} minLength={form.internalCampaignType!=="COSTA_GO"?2:undefined} value={form.internalPartnerName} onChange={e=>setForm({...form,internalPartnerName:e.target.value})} placeholder={form.internalCampaignType==="PAYMENT_POINT"?"Nombre del punto de pago":"Nombre del aliado"}/></label></div>
      <label>Comercio o campaña<input required minLength={3} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
      <label>Nombre del anunciante<input required minLength={2} value={form.advertiserName} onChange={e=>setForm({...form,advertiserName:e.target.value})}/></label>
      <label>Motivo de autorización<textarea required minLength={5} maxLength={500} value={form.internalReason} onChange={e=>setForm({...form,internalReason:e.target.value})} placeholder="Ej. Beneficio acordado por operar como punto de pago autorizado"/></label>
      <label>Referencia del convenio o respaldo<input maxLength={300} value={form.internalReference} onChange={e=>setForm({...form,internalReference:e.target.value})} placeholder="Opcional: convenio, acta, ticket o autorización"/></label>
      <div className="form-grid">
        <label>Plan<select value={form.planCode} onChange={e=>setForm({...form,planCode:e.target.value,placement:"PASSENGER_SEARCHING_DRIVER",weight:e.target.value==="PREMIUM"?2:1})}><option value="BASIC">Básico</option><option value="PREMIUM">Premium</option></select></label>
        <div className="advertising-placement-summary"><span>Dónde aparecerá</span><strong>{form.planCode==="PREMIUM"?"Búsqueda, espera y viaje en curso":"Solo mientras se busca conductor"}</strong><small>La ubicación la define el plan automáticamente.</small></div>
        <label>Peso de rotación<input type="number" min="1" max="5" value={form.weight} onChange={e=>setForm({...form,weight:Number(e.target.value)})}/></label>
        <label>Zona de cobertura<select value={form.serviceAreaId} onChange={e=>setForm({...form,serviceAreaId:e.target.value})}><option value="">Todas las zonas autorizadas</option>{zones.map(zone=><option key={zone.id} value={zone.id}>{zone.name} · {zone.code}</option>)}</select></label>
      </div>
      <label>{editingId ? "Reemplazar imagen (opcional)" : "Imagen"}<input required={!editingId} type="file" accept="image/jpeg,image/png,image/webp" onChange={e => choose(e.target.files?.[0])} /></label>
      {form.imageBase64 && <img className="banner-preview" src={`data:${form.imageMime};base64,${form.imageBase64}`} alt="Vista previa" />}
      <div className="form-grid"><label>Acción<select value={form.actionType} onChange={e=>setForm({...form,actionType:e.target.value,actionValue:"",actionMessage:e.target.value==="WHATSAPP"?defaultWhatsAppMessage:""})}><option value="WEB">Sitio web</option><option value="WHATSAPP">WhatsApp</option><option value="PHONE">Llamada</option><option value="MAPS">Mapa</option><option value="NONE">Sin acción</option></select></label><label>{form.actionType==="WHATSAPP"?"Número de WhatsApp":"Destino de la acción"}<input type={["WHATSAPP","PHONE"].includes(form.actionType)?"tel":"text"} value={form.actionValue} onChange={e=>setForm({...form,actionValue:e.target.value})} placeholder={form.actionType==="PHONE"?"+593...":form.actionType==="WHATSAPP"?"0991234567":"https://..."}/>{form.actionType==="WHATSAPP"&&<small>Escribe el número normalmente; Costa-Go generará el enlace de WhatsApp.</small>}</label></div>
      {form.actionType==="WHATSAPP"&&<label>Mensaje inicial de WhatsApp<textarea required minLength={3} maxLength={300} value={form.actionMessage} onChange={e=>setForm({...form,actionMessage:e.target.value})}/><small>WhatsApp mostrará este texto listo para que el pasajero lo envíe.</small></label>}
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

function CooperativeOverviewDialog({token,item,onClose,self=false}:{token:string;item:any;onClose:()=>void;self?:boolean}){
  const [data,setData]=useState<any>();const [error,setError]=useState("");const [loading,setLoading]=useState(true);const [view,setView]=useState("drivers");const [filter,setFilter]=useState("ALL");const [search,setSearch]=useState("");
  useEffect(()=>{setLoading(true);apiFetch<any>(self?"/v1/admin/cooperative-dashboard/overview":`/v1/admin/cooperatives/${item.id}/overview`,token).then(setData).catch(reason=>setError(errorText(reason))).finally(()=>setLoading(false));},[token,item.id,self]);
  const cooperative=data?.cooperative??item;const drivers=(data?.drivers??[]).filter((driver:any)=>(filter==="ALL"||(filter==="ACTIVE"&&driver.status==="ACTIVE")||(filter==="INACTIVE"&&driver.status!=="ACTIVE")||(filter==="CONNECTED"&&driver.status==="ACTIVE"&&driver.lastActivity&&Date.now()-new Date(driver.lastActivity).getTime()<300000))&&(!search||`${driver.name} ${driver.email} ${driver.vehicle}`.toLowerCase().includes(search.toLowerCase())));const trips=(data?.trips??[]).filter((trip:any)=>(filter==="ALL"||trip.status===filter||(filter==="MONTH"&&new Date(trip.requestedAt)>=new Date(new Date().getFullYear(),new Date().getMonth(),1)))&&(!search||`${trip.passenger} ${trip.driver} ${trip.origin} ${trip.destination}`.toLowerCase().includes(search.toLowerCase())));
  const open=(nextView:string,nextFilter="ALL")=>{setView(nextView);setFilter(nextFilter);setSearch("");};
  const stats=[["Conductores",cooperative.totalDrivers,"drivers","ALL"],["Activos",cooperative.activeDrivers,"drivers","ACTIVE"],["Inactivos",cooperative.inactiveDrivers,"drivers","INACTIVE"],["Conectados",cooperative.connectedDrivers,"drivers","CONNECTED"],["Viajes totales",cooperative.totalTrips,"trips","ALL"],["Viajes del mes",cooperative.tripsThisMonth,"trips","MONTH"],["Completados",cooperative.completedTrips,"trips","COMPLETED"],["Cancelados",cooperative.cancelledTrips,"trips","CANCELLED"]];
  return <div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><section className="modal-card cooperative-overview-modal" role="dialog" aria-modal="true"><div className="decision-heading"><div><span className="eyebrow">COOPERATIVA</span><h2>{cooperative.name}</h2><small>{cooperative.legalName??"Sin razón social"} · {cooperative.registrationNumber??"Sin registro"}</small></div><button className="modal-close-button" type="button" onClick={onClose}>×</button></div><Notice error={error}/>{loading?<Empty text="Cargando información de la cooperativa…"/>:<><div className="metric-grid cooperative-stats">{stats.map(([label,value,nextView,nextFilter])=><button type="button" className="metric interactive-metric" key={String(label)} onClick={()=>open(String(nextView),String(nextFilter))}><span>{String(label)}</span><strong>{String(value??0)}</strong><small>Ver registros</small></button>)}</div><div className="cooperative-tabs"><button className={view==="drivers"?"primary":"secondary"} onClick={()=>open("drivers")}>Conductores</button><button className={view==="trips"?"primary":"secondary"} onClick={()=>open("trips")}>Viajes</button><button className={view==="activity"?"primary":"secondary"} onClick={()=>open("activity")}>Actividad reciente</button><input aria-label="Buscar registros" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Buscar en el detalle…"/></div>{view==="drivers"?(drivers.length?<Table headers={["Conductor","Estado","Vehículo","Disponible","Última actividad","Viajes","Calificación"]} rows={drivers.map((driver:any)=>[<div><strong>{driver.name}</strong><br/><small>{driver.email}</small></div>,<Badge value={driver.status}/>,driver.vehicle,driver.available?"Sí":"No",driver.lastActivity?new Date(driver.lastActivity).toLocaleString("es-EC"):"Sin actividad",driver.trips,`★ ${Number(driver.rating??0).toFixed(2)}`])}/>:<Empty text="No hay conductores para este filtro."/>):view==="trips"?(trips.length?<Table headers={["Fecha","Pasajero","Conductor","Recorrido","Estado","Total"]} rows={trips.map((trip:any)=>[new Date(trip.requestedAt).toLocaleString("es-EC"),trip.passenger,trip.driver,<span>{trip.origin??"Origen"} → {trip.destination??"Destino"}</span>,<Badge value={trip.status}/>,money(Number(trip.totalCents??0))])}/>:<Empty text="No hay viajes para este filtro."/>):(data.activity?.length?<Table headers={["Fecha","Actor","Acción","Detalle"]} rows={data.activity.map((entry:any)=>[new Date(entry.createdAt).toLocaleString("es-EC"),entry.actor??"Sistema",entry.action,entry.detail??"—"])}/>:<Empty text="No hay actividad auditada todavía."/>)}<div className="modal-actions"><small>Calificación promedio: ★ {Number(cooperative.averageRating??0).toFixed(2)}</small><button className="primary" type="button" onClick={onClose}>Cerrar</button></div></>}</section></div>;
}

function Cooperatives({ token, canManage }: { token: string; canManage: boolean }) {
  const [data,setData]=useState<any[]>([]);const [error,setError]=useState("");const [success,setSuccess]=useState("");const [loading,setLoading]=useState(true);const [search,setSearch]=useState("");const [selected,setSelected]=useState<any>();const [statusAction,setStatusAction]=useState<any>();const [busy,setBusy]=useState(false);
  const [form,setForm]=useState({name:"",legalName:"",registrationNumber:"",email:"",phone:"",status:"ACTIVE"});
  const load=async()=>{setLoading(true);setError("");try{setData(await apiFetch<any[]>("/v1/admin/cooperatives",token));}catch(reason){setError(errorText(reason));}finally{setLoading(false);}};useEffect(()=>{void load();},[token]);
  async function save(event:React.FormEvent){event.preventDefault();setBusy(true);setError("");setSuccess("");try{await apiFetch("/v1/admin/cooperatives",token,{method:"POST",body:JSON.stringify(form)});setForm({name:"",legalName:"",registrationNumber:"",email:"",phone:"",status:"ACTIVE"});setSuccess("Cooperativa registrada correctamente.");await load();}catch(reason){setError(errorText(reason));}finally{setBusy(false);}}
  async function confirmStatus(reason:string){if(!statusAction)return;setBusy(true);setError("");try{const status=statusAction.status==="ACTIVE"?"SUSPENDED":"ACTIVE";await apiFetch(`/v1/admin/cooperatives/${statusAction.id}`,token,{method:"PATCH",body:JSON.stringify({status})});setSuccess(`${statusAction.name} fue ${status==="ACTIVE"?"activada":"suspendida"}.`);setStatusAction(undefined);await load();}catch(value){setError(errorText(value));}finally{setBusy(false);}}
  const filtered=data.filter(item=>`${item.name} ${item.legalName??""} ${item.registrationNumber??""}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="cooperatives-module"><section className="card"><Header eyebrow="ORGANIZACIONES" title="Cooperativas" action={`${filtered.length} de ${data.length}`}/><div className="module-toolbar"><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Buscar por nombre, razón social o RUC…"/><button className="secondary" type="button" onClick={()=>void load()}>Actualizar</button></div><Notice error={error} success={success}/>{loading?<Empty text="Cargando cooperativas…"/>:filtered.length?<Table headers={["Nombre","RUC / registro","Contacto","Conductores","Conectados","Viajes del mes","Estado","Acciones"]} rows={filtered.map(item=>[<button className="link record-link" onClick={()=>setSelected(item)}><strong>{item.name}</strong><small>Ver ficha completa</small></button>,item.registrationNumber??"Sin registrar",<div>{item.email??"Sin correo"}<br/><small>{item.phone??"Sin teléfono"}</small></div>,<button className="link" onClick={()=>setSelected(item)}>{item.activeDrivers??0} activos / {item.drivers??0}</button>,<button className="link" onClick={()=>setSelected(item)}>{item.connectedDrivers??0}</button>,<button className="link" onClick={()=>setSelected(item)}>{item.tripsThisMonth??0}</button>,<Badge value={item.status}/>,<div className="row-actions"><button className="link" onClick={()=>setSelected(item)}>Ver detalle</button>{canManage&&<button className="link danger" onClick={()=>setStatusAction(item)}>{item.status==="ACTIVE"?"Suspender":"Activar"}</button>}</div>])}/>:<Empty text={search?"No hay cooperativas que coincidan con la búsqueda.":"No existen cooperativas registradas."}/>}</section>{canManage&&<form className="card form-card cooperative-create" onSubmit={save}><Header eyebrow="NUEVO REGISTRO" title="Agregar cooperativa"/><div className="form-grid"><label>Nombre<input required minLength={3} value={form.name} onChange={event=>setForm({...form,name:event.target.value})}/></label><label>Razón social<input value={form.legalName} onChange={event=>setForm({...form,legalName:event.target.value})}/></label><label>RUC o registro<input value={form.registrationNumber} onChange={event=>setForm({...form,registrationNumber:event.target.value})}/></label><label>Correo<input type="email" value={form.email} onChange={event=>setForm({...form,email:event.target.value})}/></label><label>Teléfono<input value={form.phone} onChange={event=>setForm({...form,phone:event.target.value})}/></label></div><button className="primary" disabled={busy}>{busy?"Guardando…":"Guardar cooperativa"}</button></form>}{selected&&<CooperativeOverviewDialog token={token} item={selected} onClose={()=>setSelected(undefined)}/>} {statusAction&&<DecisionDialog title={statusAction.status==="ACTIVE"?"Suspender cooperativa":"Activar cooperativa"} description={<>Confirma el cambio de estado de <strong>{statusAction.name}</strong>. Sus datos históricos se conservarán.</>} fieldLabel="Motivo del cambio" required showField confirmLabel={statusAction.status==="ACTIVE"?"Sí, suspender":"Sí, activar"} dangerous={statusAction.status==="ACTIVE"} busy={busy} error={error} onCancel={()=>setStatusAction(undefined)} onConfirm={confirmStatus}/>}</div>;
}

function AccessManagement({ token, currentUserId }: { token: string; currentUserId?: string }) {
  const [users, setUsers] = useState<any[]>([]); const [roles, setRoles] = useState<any[]>([]); const [cooperatives, setCooperatives] = useState<any[]>([]);
  const [error, setError] = useState(""); const [success, setSuccess] = useState(""); const [busy, setBusy] = useState("");
  const [selectedUser, setSelectedUser] = useState<any>(); const [creating, setCreating] = useState(false); const [search, setSearch] = useState("");
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", password: "", role: "SOPORTE", cooperativeId: "" });
  async function load() { try { const [nextUsers, nextRoles, nextCooperatives] = await Promise.all([apiFetch<any[]>("/v1/admin/access/users", token), apiFetch<any[]>("/v1/admin/access/roles", token), apiFetch<any[]>("/v1/admin/cooperatives", token)]); setUsers(nextUsers); setRoles(nextRoles); setCooperatives(nextCooperatives); } catch (reason) { setError(errorText(reason)); } }
  useEffect(() => { void load(); }, [token]);
  async function save(user: any) { setBusy(user.id); setError(""); setSuccess(""); try { await apiFetch(`/v1/admin/access/users/${user.id}`, token, { method: "PATCH", body: JSON.stringify({ role: user.role, cooperativeId: user.role === "ANALISTA_COOPERATIVA" ? user.cooperativeId || null : null, overrides: user.overrides ?? [] }) }); setSuccess(`Acceso actualizado para ${user.name}. Deberá iniciar sesión nuevamente.`); setSelectedUser(undefined); await load(); } catch (reason) { setError(errorText(reason)); } finally { setBusy(""); } }
  async function create(event: React.FormEvent) { event.preventDefault(); const policyError = strongPasswordError(form.password); if (policyError) { setError(policyError); return; } setBusy("new"); setError(""); setSuccess(""); try { await apiFetch("/v1/admin/access/users", token, { method: "POST", body: JSON.stringify({ ...form, cooperativeId: form.role === "ANALISTA_COOPERATIVA" ? form.cooperativeId || null : null }) }); setForm({ fullName: "", email: "", phone: "", password: "", role: "SOPORTE", cooperativeId: "" }); setCreating(false); setSuccess("Usuario administrativo creado correctamente."); await load(); } catch (reason) { setError(errorText(reason)); } finally { setBusy(""); } }
  const filteredUsers=users.filter(user=>`${user.name} ${user.email} ${roleLabels[user.role]??user.role}`.toLowerCase().includes(search.trim().toLowerCase()));
  const selectableRoles=roles.filter(item => !["ADMIN", "SUPPORT"].includes(item.role));
  return <div className="access-module"><section className="card"><Header eyebrow="CONTROL DE ACCESO" title="Usuarios y roles" action={`${users.length} usuarios`} /><div className="module-toolbar access-toolbar"><input aria-label="Buscar usuario administrativo" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Buscar por usuario, correo o rol…"/><button className="primary" type="button" onClick={()=>{setError("");setCreating(true);}}>+ Nuevo usuario</button></div><Notice error={error} success={success} /><p className="note">Selecciona un usuario para consultar o modificar su acceso. Las contraseñas actuales nunca pueden visualizarse.</p>{filteredUsers.length ? <Table headers={["Usuario", "Rol", "Detalle"]} rows={filteredUsers.map(user => [<button className="access-user-button" type="button" onClick={()=>{setError("");setSelectedUser({...user});}}><strong>{user.name}</strong><small>{user.email}</small></button>, <span className="access-role-pill">{roleLabels[user.role] ?? user.role}</span>, <button className="link" type="button" onClick={()=>{setError("");setSelectedUser({...user});}}>Ver información</button>])} /> : <Empty text={search ? "No existen usuarios que coincidan con la búsqueda." : "No existen usuarios administrativos en la base."} />}</section>
    {selectedUser&&<div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)setSelectedUser(undefined);}}><section className="modal-card access-user-modal" role="dialog" aria-modal="true"><div className="decision-heading"><div><span className="eyebrow">DETALLE DE USUARIO</span><h2>{selectedUser.name}</h2><small>{selectedUser.id===currentUserId?"Tu cuenta actual":"Cuenta administrativa"}</small></div><button className="modal-close-button" type="button" aria-label="Cerrar" disabled={Boolean(busy)} onClick={()=>setSelectedUser(undefined)}>×</button></div><div className="access-detail-grid"><div><span>Correo</span><strong>{selectedUser.email}</strong></div><div><span>Teléfono</span><strong>{selectedUser.phone??"Sin teléfono"}</strong></div><div><span>Estado</span><Badge value={selectedUser.status}/></div><div><span>Seguridad</span><strong>{selectedUser.mustChangePassword?"Debe cambiar su clave":"Clave personal configurada"}</strong></div><div><span>Cooperativa</span><strong>{selectedUser.cooperativeName??"Sin cooperativa"}</strong></div><div><span>Última actualización</span><strong>{selectedUser.updatedAt?new Date(selectedUser.updatedAt).toLocaleString("es-EC"):"Sin registro"}</strong></div></div><label>Rol<select value={selectedUser.role} onChange={event=>setSelectedUser({...selectedUser,role:event.target.value,cooperativeId:event.target.value==="ANALISTA_COOPERATIVA"?selectedUser.cooperativeId:null,cooperativeName:event.target.value==="ANALISTA_COOPERATIVA"?selectedUser.cooperativeName:null})}>{roles.map(item=><option key={item.role} value={item.role}>{roleLabels[item.role]??item.role}</option>)}</select></label>{selectedUser.role==="ANALISTA_COOPERATIVA"?<label>Cooperativa<select required value={selectedUser.cooperativeId??""} onChange={event=>{const cooperative=cooperatives.find(item=>item.id===event.target.value);setSelectedUser({...selectedUser,cooperativeId:event.target.value||null,cooperativeName:cooperative?.name??null});}}><option value="">Selecciona una cooperativa</option>{cooperatives.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>:<div className="access-scope-note"><strong>Sin cooperativa</strong><span>Este rol no requiere alcance por cooperativa.</span></div>}<Notice error={error}/><div className="modal-actions access-modal-actions">{selectedUser.id!==currentUserId?<PasswordReset token={token} userId={selectedUser.id} userName={selectedUser.name}/>:<small>La clave de tu cuenta se cambia desde tu propia sesión.</small>}<div className="row-actions"><button className="secondary" type="button" disabled={Boolean(busy)} onClick={()=>setSelectedUser(undefined)}>Cancelar</button><button className="primary" type="button" disabled={busy===selectedUser.id||(selectedUser.role==="ANALISTA_COOPERATIVA"&&!selectedUser.cooperativeId)} onClick={()=>void save(selectedUser)}>{busy===selectedUser.id?"Guardando…":"Guardar acceso"}</button></div></div></section></div>}
    {creating&&<div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)setCreating(false);}}><form className="modal-card access-user-modal" role="dialog" aria-modal="true" onSubmit={create}><div className="decision-heading"><div><span className="eyebrow">NUEVO ACCESO</span><h2>Crear usuario administrativo</h2></div><button className="modal-close-button" type="button" aria-label="Cerrar" disabled={Boolean(busy)} onClick={()=>setCreating(false)}>×</button></div><div className="form-grid"><label>Nombre<input autoFocus required minLength={3} value={form.fullName} onChange={event=>setForm({...form,fullName:event.target.value})}/></label><label>Correo<input required type="email" value={form.email} onChange={event=>setForm({...form,email:event.target.value})}/></label><label>Teléfono<input required minLength={8} value={form.phone} onChange={event=>setForm({...form,phone:event.target.value})}/></label><label>Clave temporal<input required type="password" minLength={10} value={form.password} onChange={event=>setForm({...form,password:event.target.value})}/></label></div><small>10+ caracteres con mayúscula, minúscula, número y símbolo. El usuario deberá reemplazarla al ingresar.</small><label>Rol<select value={form.role} onChange={event=>setForm({...form,role:event.target.value,cooperativeId:event.target.value==="ANALISTA_COOPERATIVA"?form.cooperativeId:""})}>{selectableRoles.map(item=><option key={item.role} value={item.role}>{roleLabels[item.role]??item.role}</option>)}</select></label>{form.role==="ANALISTA_COOPERATIVA"&&<label>Cooperativa<select required value={form.cooperativeId} onChange={event=>setForm({...form,cooperativeId:event.target.value})}><option value="">Selecciona una cooperativa</option>{cooperatives.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}<Notice error={error}/><div className="modal-actions"><button className="secondary" type="button" disabled={Boolean(busy)} onClick={()=>setCreating(false)}>Cancelar</button><button className="primary" disabled={busy==="new"||(form.role==="ANALISTA_COOPERATIVA"&&!form.cooperativeId)}>{busy==="new"?"Creando…":"Crear usuario"}</button></div></form></div>}
  </div>;
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
  const [module, setModule] = useState<Module>(() => {
    const requested=new URLSearchParams(window.location.search).get("module");
    return (requested&&requested in labels?requested:"dashboard") as Module;
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  function save(next: Session) { localStorage.setItem("admin-session", JSON.stringify(next)); setSession(next); }
  function logout() { localStorage.removeItem("admin-session"); setSession(undefined); }
  useEffect(()=>{const expired=()=>logout();window.addEventListener("admin-session-expired",expired);return()=>window.removeEventListener("admin-session-expired",expired);},[]);
  if (!session) return <Login onSession={save} />;
  if (session.user.mustChangePassword) return <ForcedPasswordChange session={session} onSession={save} onLogout={logout} />;
  const allowed = (permission: string) => can(session.user, permission);
  const visible = (Object.keys(labels) as Module[]).filter(item => modulePermissions[item].some(allowed));
  const currentModule = visible.includes(module) ? module : (visible[0] ?? "dashboard");
  const cooperativeDashboard = allowed("cooperative_dashboard:view") && !allowed("dashboard:view");
  function selectModule(next: Module) {
    setModule(next);
    const url=new URL(window.location.href);url.searchParams.set("module",next);window.history.replaceState({},"",url);
    if (window.innerWidth <= 720) setSidebarOpen(false);
  }
  return <div className={`app-shell ${sidebarOpen ? "sidebar-open" : "sidebar-collapsed"}`}>
    <aside aria-label="Menú principal">
      <div className="sidebar-head">
        <button className="menu-toggle" type="button" aria-label={sidebarOpen ? "Cerrar menú" : "Abrir menú"} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(value => !value)}>☰</button>
        <div className="brand"><img className="brand-logo" src="/costa-go-emblem.png" alt="" /><div><strong><span>Costa-</span>Go</strong><small>Centro de control</small></div></div>
      </div>
      <nav>{visible.map(item => <button key={item} title={!sidebarOpen ? labels[item] : undefined} className={currentModule === item ? "active" : ""} onClick={() => selectModule(item)}><span>{item==='fleet'?<MototaxiIcon size={20}/>:icons[item]}</span><span className="nav-label">{labels[item]}</span></button>)}</nav>
      <div className="profile"><strong>{session.user.name}</strong><small>{roleLabels[session.user.role] ?? session.user.role.replaceAll("_", " ")}</small><button onClick={logout}>Cerrar sesión</button></div>
    </aside>
    {sidebarOpen && <button className="sidebar-scrim" aria-label="Cerrar menú" onClick={() => setSidebarOpen(false)} />}
    <main>
      <header className="topbar"><button className="mobile-menu-toggle" type="button" aria-label="Abrir menú" onClick={() => setSidebarOpen(true)}>☰</button><div><span className="eyebrow">CONSOLA ADMINISTRATIVA</span><h1>{labels[currentModule]}</h1></div><span className="status">● Render conectado</span></header>
      {currentModule === "dashboard" && <Dashboard token={session.token} cooperative={cooperativeDashboard} />}
      {currentModule === "operations" && <OperationsCenter token={session.token} />}
      {currentModule === "alerts" && <AlertsCenter token={session.token} />}
      {currentModule === "trips" && <Trips token={session.token} admin={allowed("trips:manage")} />}
      {currentModule === "drivers" && <Drivers canEditAccounts={allowed("mobile_accounts:edit")} canDeleteIncomplete={allowed("mobile_accounts:delete_incomplete")} token={session.token} canApprove={allowed("drivers:approve")} canViewDocuments={allowed("drivers:documents:view")} canManageDocuments={allowed("drivers:documents:manage")} canResetPasswords={allowed("users:manage")} />}
      {currentModule === "memberships" && <MembershipAdmin token={session.token} permissions={session.user.permissions ?? []} />}
      {currentModule === "fleet" && <FleetAdmin token={session.token} permissions={session.user.permissions ?? []} cooperativeScoped={session.user.role==='ANALISTA_COOPERATIVA'} />}
      {currentModule === "passengers" && <Passengers canEditAccounts={allowed("mobile_accounts:edit")} token={session.token} canManage={allowed("passengers:manage")} canResetPasswords={allowed("users:manage")} />}
      {currentModule === "cooperatives" && <Cooperatives token={session.token} canManage={allowed("cooperatives:manage")} />}
      {currentModule === "pricing" && <Pricing token={session.token} admin={allowed("pricing:manage")} />}
      {currentModule === "pricing" && <FareTerritories token={session.token} canManage={allowed("pricing:manage")} />}
      {currentModule === "zones" && <CoverageZones token={session.token} permissions={session.user.permissions ?? []} />}
      {currentModule === "settings" && <Settings token={session.token} admin={allowed("settings:manage")} />}
      {currentModule === "advertising" && <Advertising token={session.token} admin={allowed("advertising:manage")} />}
      {currentModule === "commercial" && <CommercialAdmin token={session.token} permissions={session.user.permissions ?? []} />}
      {currentModule === "fiscal" && <Suspense fallback={<p role="status">Cargando módulo fiscal…</p>}><FiscalAdmin token={session.token} permissions={session.user.permissions ?? []} /></Suspense>}
      {currentModule === "incidents" && <SupportAdmin token={session.token} />}
      {currentModule === "access" && <AccessManagement token={session.token} currentUserId={session.user.id} />}
      {currentModule === "audit" && <Audit token={session.token} />}
      {currentModule === "database" && <Database token={session.token} />}
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
