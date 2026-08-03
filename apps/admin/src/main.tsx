import { StrictMode, useEffect, useState, type MouseEvent } from "react";
import { createRoot } from "react-dom/client";
import { apiFetch, apiUrl, login, type Session } from "./api.js";
import "./styles.css";
import "./settings.css";
import "./advertising.css";

type Module = "dashboard" | "trips" | "drivers" | "passengers" | "pricing" | "zones" | "settings" | "advertising" | "incidents" | "audit" | "database";

const labels: Record<Module, string> = {
  dashboard: "Tablero",
  trips: "Viajes",
  drivers: "Conductores",
  passengers: "Pasajeros",
  pricing: "Tarifas",
  zones: "Zonas",
  settings: "Radio de búsqueda",
  advertising: "Publicidad",
  incidents: "Incidentes",
  audit: "Auditoría",
  database: "PostgreSQL"
};
const icons: Record<Module, string> = { dashboard: "▦", trips: "↔", drivers: "◉", passengers: "◎", pricing: "$", zones: "◇", settings: "⌖", advertising: "▣", incidents: "!", audit: "≡", database: "◫" };
const stateLabels: Record<string, string> = {
  SEARCHING: "Buscando conductor", ASSIGNED: "Asignado", DRIVER_EN_ROUTE: "Conductor en camino",
  DRIVER_ARRIVED: "Conductor llegó", IN_PROGRESS: "Viaje en curso", COMPLETED: "Finalizado",
  CANCELLED: "Cancelado", NO_DRIVER: "Sin conductor", INCIDENT: "Incidente", PENDING: "Pendiente",
  ACTIVE: "Activo", SUSPENDED: "Suspendido", REJECTED: "Rechazado", OPEN: "Abierto",
  IN_REVIEW: "En revisión", RESOLVED: "Resuelto", SCHEDULED: "Programada", URBAN: "Urbana", EXTENDED: "Extendida"
};

function errorText(error: unknown) { return error instanceof Error ? error.message : "No se pudo completar la operación."; }
function money(cents: number) { return `$${(Number(cents) / 100).toFixed(2)}`; }
function localDateTimeInput(value: string | Date = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function Badge({ value }: { value: string }) { return <span className={`badge ${value.toLowerCase()}`}>{stateLabels[value] ?? value.replaceAll("_", " ")}</span>; }
function Header({ eyebrow, title, action }: { eyebrow: string; title: string; action?: string }) { return <div className="section-title"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>{action && <span className="muted-pill">{action}</span>}</div>; }
function Table({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) { return <div className="table-wrap"><table><thead><tr>{headers.map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>; }
function Empty({ text }: { text: string }) { return <div className="empty">{text}</div>; }
function Notice({ error, success }: { error?: string; success?: string }) { return <>{error && <div className="alert error">{error}</div>}{success && <div className="alert success">{success}</div>}</>; }

function Login({ onSession }: { onSession: (session: Session) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { onSession(await login(email.trim(), password)); } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  }
  return <div className="login-shell"><form className="login-card" onSubmit={submit}><div className="brand-mark">M</div><span className="eyebrow">MOTOTAXI ATACAMES</span><h1>Centro de control</h1><p>Acceso para administración y soporte.</p><label>Correo<input autoComplete="username" type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label><label>Contraseña<input autoComplete="current-password" type="password" required value={password} onChange={e => setPassword(e.target.value)} /></label><Notice error={error} /><button className="primary" disabled={busy}>{busy ? "Ingresando…" : "Ingresar"}</button></form></div>;
}

function Dashboard({ token }: { token: string }) {
  const [data, setData] = useState<any>(); const [error, setError] = useState("");
  useEffect(() => { apiFetch<any>("/v1/admin/dashboard", token).then(setData).catch(reason => setError(errorText(reason))); }, [token]);
  if (error) return <Notice error={error} />; if (!data) return <Empty text="Cargando operación…" />;
  const metricLabels: Record<string, string> = { activeTrips: "Viajes activos", availableDrivers: "Conductores disponibles", pendingDrivers: "Por aprobar", openIncidents: "Incidentes abiertos" };
  return <><div className="metric-grid">{Object.entries(data.metrics).map(([key, value]) => <article className="metric" key={key}><span>{metricLabels[key] ?? key}</span><strong>{String(value)}</strong></article>)}</div><section className="card"><Header eyebrow="OPERACIÓN EN VIVO" title="Resumen del piloto" action="Conectado a Render" /><p className="note">Administra viajes, aprobaciones, tarifas, zonas y el radio de búsqueda desde el menú lateral.</p></section></>;
}

function Trips({ token, admin }: { token: string; admin: boolean }) {
  const [data, setData] = useState<any[]>([]); const [error, setError] = useState("");
  const load = () => apiFetch<any[]>("/v1/admin/trips", token).then(setData).catch(reason => setError(errorText(reason)));
  useEffect(() => { void load(); const id = setInterval(load, 5000); return () => clearInterval(id); }, [token]);
  async function cancel(id: string) { const reason = prompt("Motivo que recibirán pasajero y conductor:", "Cancelado desde el panel administrativo"); if (!reason?.trim()) return; try { await apiFetch(`/v1/admin/trips/${id}/action`, token, { method: "POST", body: JSON.stringify({ action: "CANCEL", reason: reason.trim() }) }); await load(); } catch (cause) { setError(errorText(cause)); } }
  return <section className="card"><Header eyebrow="OPERACIÓN" title="Viajes y asignaciones" action={`${data.filter(t => !["COMPLETED", "CANCELLED", "NO_DRIVER"].includes(t.status)).length} activos`} /><Notice error={error} />{data.length ? <Table headers={["Hora", "Pasajero", "Conductor", "Ruta", "Estado", "Total", "Acción"]} rows={data.map(t => [new Date(t.requestedAt).toLocaleString(), t.passenger, t.driver, `${t.originReference ?? "Origen"} → ${t.destinationReference ?? "Destino"}`, <Badge value={t.status} />, money(t.quotedTotalCents), admin && !["COMPLETED", "CANCELLED", "NO_DRIVER"].includes(t.status) ? <button className="link" onClick={() => cancel(t.id)}>Cancelar</button> : "—"])} /> : <Empty text="Todavía no hay viajes registrados." />}</section>;
}

function Drivers({ token, admin }: { token: string; admin: boolean }) {
  const [data, setData] = useState<any[]>([]); const [error, setError] = useState(""); const [busy, setBusy] = useState<string>();
  const load = () => apiFetch<any[]>("/v1/admin/drivers", token).then(setData).catch(reason => setError(errorText(reason)));
  useEffect(() => { void load(); }, [token]);
  async function update(driver: any, status = driver.status, deunaEnabled = Boolean(driver.deunaEnabled)) { setBusy(driver.id); setError(""); try { await apiFetch(`/v1/admin/drivers/${driver.id}`, token, { method: "PATCH", body: JSON.stringify({ status, deunaEnabled, reason: status === "ACTIVE" ? "Conductor aprobado desde el panel" : "Estado actualizado desde el panel" }) }); await load(); } catch (reason) { setError(errorText(reason)); } finally { setBusy(undefined); } }
  return <section className="card"><Header eyebrow="VALIDACIÓN" title="Conductores" action={`${data.filter(d => d.status === "PENDING").length} pendientes`} /><Notice error={error} />{data.length ? <Table headers={["Nombre", "Teléfono", "Vehículo", "Documentos", "Estado", "De Una", "Acción"]} rows={data.map(driver => [driver.name, driver.phone, driver.vehicle, driver.documents, <Badge value={driver.status} />, admin ? <input aria-label={`De Una para ${driver.name}`} type="checkbox" checked={Boolean(driver.deunaEnabled)} disabled={busy === driver.id} onChange={e => update(driver, driver.status, e.target.checked)} /> : "—", admin ? <select aria-label={`Estado de ${driver.name}`} value={driver.status} disabled={busy === driver.id} onChange={e => update(driver, e.target.value)}><option value="PENDING">Pendiente</option><option value="ACTIVE">Aprobar / activar</option><option value="SUSPENDED">Suspender</option><option value="REJECTED">Rechazar</option></select> : "Solo lectura"])} /> : <Empty text="No hay conductores registrados." />}</section>;
}

function Passengers({ token, admin }: { token: string; admin: boolean }) {
  const [data, setData] = useState<any[]>([]); const [error, setError] = useState("");
  const load = () => apiFetch<any[]>("/v1/admin/passengers", token).then(setData).catch(reason => setError(errorText(reason)));
  useEffect(() => { void load(); }, [token]);
  async function update(passenger: any) { try { await apiFetch(`/v1/admin/passengers/${passenger.id}`, token, { method: "PATCH", body: JSON.stringify({ status: passenger.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE", reason: "Actualización desde el panel administrativo" }) }); await load(); } catch (reason) { setError(errorText(reason)); } }
  return <section className="card"><Header eyebrow="USUARIOS" title="Pasajeros" action={`${data.length} registrados`} /><Notice error={error} />{data.length ? <Table headers={["Nombre", "Teléfono", "Viajes", "Último viaje", "Estado", "Acción"]} rows={data.map(passenger => [passenger.name, passenger.phone, passenger.trips, passenger.lastTrip ? new Date(passenger.lastTrip).toLocaleString() : "Sin viajes", <Badge value={passenger.status} />, admin ? <button className="link" onClick={() => update(passenger)}>{passenger.status === "ACTIVE" ? "Suspender" : "Reactivar"}</button> : "Solo lectura"])} /> : <Empty text="No hay pasajeros registrados." />}</section>;
}

function Pricing({ token, admin }: { token: string; admin: boolean }) {
  const [data, setData] = useState<any[]>([]); const [error, setError] = useState(""); const [success, setSuccess] = useState("");
  const [form, setForm] = useState({ urbanDayCents: 50, nightCents: 100, extendedCents: 100, promotionPassengers: 3, promotionTotalCents: 100, activeFrom: new Date().toISOString().slice(0, 16) });
  const load = () => apiFetch<any[]>("/v1/admin/pricing", token).then(setData).catch(reason => setError(errorText(reason)));
  useEffect(() => { void load(); }, [token]);
  async function save(event: React.FormEvent) { event.preventDefault(); setError(""); setSuccess(""); try { await apiFetch("/v1/admin/pricing", token, { method: "POST", body: JSON.stringify(form) }); setSuccess("Nueva versión tarifaria publicada correctamente."); await load(); } catch (reason) { setError(errorText(reason)); } }
  return <div className="split"><section className="card"><Header eyebrow="HISTORIAL" title="Versiones tarifarias" action={`${data.length} versiones`} /><Notice error={error} success={success} />{data.length ? <Table headers={["Versión", "Urbana día", "Noche", "Extendida", "Promoción", "Vigencia", "Estado"]} rows={data.map(price => [`v${price.version}`, money(price.urbanDayCents), money(price.nightCents), money(price.extendedCents), `${price.promotionPassengers} pasajeros por ${money(price.promotionTotalCents)}`, new Date(price.activeFrom).toLocaleString(), <Badge value={price.status} />])} /> : <Empty text="No hay tarifas configuradas." />}</section>{admin && <form className="card form-card" onSubmit={save}><Header eyebrow="PUBLICAR" title="Nueva versión" /><div className="form-grid">{([ ["urbanDayCents", "Urbana de día (centavos)"], ["nightCents", "Nocturna (centavos)"], ["extendedCents", "Extendida (centavos)"], ["promotionPassengers", "Pasajeros promoción"], ["promotionTotalCents", "Total promoción (centavos)"] ] as Array<[keyof typeof form, string]>).map(([key, label]) => <label key={key}>{label}<input min="0" required type="number" value={form[key]} onChange={e => setForm({ ...form, [key]: Number(e.target.value) })} /></label>)}<label>Vigente desde<input required type="datetime-local" value={form.activeFrom} onChange={e => setForm({ ...form, activeFrom: e.target.value })} /></label></div><button className="primary">Publicar versión</button></form>}</div>;
}

function Zones({ token, admin }: { token: string; admin: boolean }) {
  const [data, setData] = useState<any[]>([]); const [points, setPoints] = useState<Array<{ x: number; y: number }>>([]); const [name, setName] = useState("Nueva zona"); const [type, setType] = useState("URBAN"); const [error, setError] = useState("");
  const load = () => apiFetch<any[]>("/v1/admin/zones", token).then(setData).catch(reason => setError(errorText(reason)));
  useEffect(() => { void load(); }, [token]);
  function addPoint(event: MouseEvent<SVGSVGElement>) { if (!admin) return; const rect = event.currentTarget.getBoundingClientRect(); setPoints(previous => [...previous, { x: +(((event.clientX - rect.left) / rect.width) * 100).toFixed(1), y: +(((event.clientY - rect.top) / rect.height) * 100).toFixed(1) }]); }
  async function save() { try { await apiFetch("/v1/admin/zones", token, { method: "POST", body: JSON.stringify({ name, type, points }) }); setPoints([]); await load(); } catch (reason) { setError(errorText(reason)); } }
  return <div className="split zones-layout"><section className="card"><Header eyebrow="COBERTURA" title="Editor de zonas" action={admin ? "Haz clic para dibujar" : "Solo lectura"} /><Notice error={error} /><svg className="zone-map" viewBox="0 0 100 100" onClick={addPoint}><defs><pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="#cfe0e2" strokeWidth=".35" /></pattern></defs><rect width="100" height="100" fill="url(#grid)" /><path d="M2 65 Q25 42 48 56 T98 38" fill="none" stroke="#71b7c0" strokeWidth="3" opacity=".55" />{data.map(zone => <polygon key={zone.id} points={(zone.points ?? []).map((point: any) => `${point.x},${point.y}`).join(" ")} className={`saved-zone ${zone.type.toLowerCase()}`} />)}{points.length > 1 && <polygon points={points.map(point => `${point.x},${point.y}`).join(" ")} className="draft-zone" />}{points.map((point, i) => <circle key={i} cx={point.x} cy={point.y} r="1.3" />)}</svg>{admin && <div className="zone-tools"><input aria-label="Nombre de zona" value={name} onChange={e => setName(e.target.value)} /><select aria-label="Tipo de zona" value={type} onChange={e => setType(e.target.value)}><option value="URBAN">Urbana</option><option value="EXTENDED">Extendida</option></select><button className="secondary" onClick={() => setPoints([])}>Limpiar</button><button className="primary" disabled={points.length < 3 || name.trim().length < 3} onClick={save}>Guardar polígono</button></div>}</section><section className="card"><Header eyebrow="VERSIONES" title="Zonas activas" action={`${data.length} zonas`} />{data.map(zone => <div className="list-row" key={zone.id}><div><strong>{zone.name}</strong><small>{(zone.points ?? []).length} vértices · versión {zone.version}</small></div><Badge value={zone.type} /></div>)}</section></div>;
}

function Settings({ token, admin }: { token: string; admin: boolean }) {
  const [radius, setRadius] = useState(3000); const [success, setSuccess] = useState(""); const [error, setError] = useState("");
  useEffect(() => { apiFetch<{ searchRadiusMeters: number }>("/v1/admin/settings", token).then(value => setRadius(value.searchRadiusMeters)).catch(reason => setError(errorText(reason))); }, [token]);
  async function save(event: React.FormEvent) { event.preventDefault(); setSuccess(""); setError(""); try { const value = await apiFetch<{ searchRadiusMeters: number }>("/v1/admin/settings", token, { method: "PATCH", body: JSON.stringify({ searchRadiusMeters: radius }) }); setRadius(value.searchRadiusMeters); setSuccess("Radio guardado. Las nuevas solicitudes utilizarán este valor."); } catch (reason) { setError(errorText(reason)); } }
  return <section className="card settings-card"><Header eyebrow="DESPACHO" title="Radio máximo de búsqueda" action={`${(radius / 1000).toFixed(1)} km`} /><form onSubmit={save}><label>Distancia máxima entre el conductor disponible y el origen del pasajero<div className="radius-control"><input type="range" min="500" max="20000" step="500" value={radius} disabled={!admin} onChange={e => setRadius(Number(e.target.value))} /><input type="number" min="500" max="20000" step="500" value={radius} disabled={!admin} onChange={e => setRadius(Number(e.target.value))} /><span>metros</span></div></label><p className="note">Rango permitido: 500 metros a 20 kilómetros. El cálculo utiliza la última posición GPS real del conductor.</p><Notice error={error} success={success} />{admin && <button className="primary" type="submit">Guardar radio de búsqueda</button>}</form></section>;
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
    const payload = { ...form, startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString() };
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
      {data.length ? <div className="banner-grid">{data.map(item => <article className={`banner-card ${item.active ? "" : "inactive"}`} key={item.id}>
        <img src={apiUrl(`/v1/banners/${item.id}/image?v=${encodeURIComponent(item.updatedAt)}`)} alt={item.title} />
        <div><strong>{item.title}</strong><small>Inicio del pasajero · orden {item.sortOrder}</small><small>{new Date(item.startsAt).toLocaleString()} — {item.endsAt ? new Date(item.endsAt).toLocaleString() : "sin fecha final"}</small></div>
        {admin && <div className="banner-actions"><button className="secondary" onClick={() => edit(item)}>Editar</button><button className="secondary" onClick={() => toggle(item)}>{item.active ? "Desactivar" : "Activar"}</button></div>}
      </article>)}</div> : <article className="banner-placeholder-card"><img src="/advertising-placeholder.png" alt="Tu publicidad aquí" /><div><strong>Vista previa en la app del pasajero</strong><p>Este banner demostrativo ocupa el espacio hasta que publiques la primera campaña.</p></div></article>}
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

function Database({ token }: { token: string }) {
  const [data, setData] = useState<any>();
  useEffect(() => { apiFetch<any>("/v1/admin/database", token).then(setData).catch(reason => setData({ connected: false, message: errorText(reason) })); }, [token]);
  return <section className="card database-card"><Header eyebrow="INFRAESTRUCTURA" title="PostgreSQL / PostGIS" /><div className={`connection ${data?.connected ? "ok" : "down"}`}><strong>{data?.connected ? "Conexión activa" : "Sin conexión"}</strong><p>{data?.connected ? "La API de Render está conectada a la base del proyecto." : data?.message ?? "Verificando conexión…"}</p></div>{data?.connected && <div className="database-details"><div><span>Base de datos</span><strong>{data.database}</strong></div><div><span>Motor</span><strong>PostgreSQL</strong><small>{String(data.postgres_version).split(",")[0]}</small></div><div><span>Extensión geográfica</span><strong>PostGIS activa</strong><small>{String(data.postgis_version).split(" ").slice(0, 2).join(" ")}</small></div></div>}<p className="note">Las cuentas, tarifas, zonas, viajes y configuraciones operativas se almacenan en esta base.</p></section>;
}

function App() {
  const [session, setSession] = useState<Session | undefined>(() => { try { return JSON.parse(localStorage.getItem("admin-session") ?? ""); } catch { return undefined; } });
  const [module, setModule] = useState<Module>("dashboard");
  function save(next: Session) { localStorage.setItem("admin-session", JSON.stringify(next)); setSession(next); }
  function logout() { localStorage.removeItem("admin-session"); setSession(undefined); }
  if (!session) return <Login onSession={save} />;
  const admin = session.user.role === "ADMIN";
  const visible = (Object.keys(labels) as Module[]).filter(item => admin || !["audit", "database"].includes(item));
  return <div className="app-shell"><aside><div className="brand"><div className="brand-mark">M</div><div><strong>Mototaxi</strong><small>Atacames</small></div></div><nav>{visible.map(item => <button key={item} className={module === item ? "active" : ""} onClick={() => setModule(item)}><span>{icons[item]}</span>{labels[item]}</button>)}</nav><div className="profile"><strong>{session.user.name}</strong><small>{session.user.role}</small><button onClick={logout}>Cerrar sesión</button></div></aside><main><header className="topbar"><div><span className="eyebrow">CONSOLA ADMINISTRATIVA</span><h1>{labels[module]}</h1></div><span className="status">● Render conectado</span></header>{module === "dashboard" && <Dashboard token={session.token} />}{module === "trips" && <Trips token={session.token} admin={admin} />}{module === "drivers" && <Drivers token={session.token} admin={admin} />}{module === "passengers" && <Passengers token={session.token} admin={admin} />}{module === "pricing" && <Pricing token={session.token} admin={admin} />}{module === "zones" && <Zones token={session.token} admin={admin} />}{module === "settings" && <Settings token={session.token} admin={admin} />}{module === "advertising" && <Advertising token={session.token} admin={admin} />}{module === "incidents" && <Incidents token={session.token} />}{module === "audit" && <Audit token={session.token} />}{module === "database" && <Database token={session.token} />}</main></div>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
