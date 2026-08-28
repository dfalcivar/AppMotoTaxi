import { refreshDelay, trackingView } from './trip-tracking-model.mjs';

export function startTracking({ map, config, doc = document, win = window, request = fetch }) {
  const get = (id) => doc.getElementById(id);
  const text = (id, value) => { if (get(id).textContent !== String(value ?? '')) get(id).textContent = value ?? ''; };
  const api = (config.apiBaseUrl || '').replace(/\/$/, '');
  // Do not decode arbitrary malformed paths or expose the link in errors/logs.
  const token = win.location.pathname.split('/').filter(Boolean).at(-1) || '';
  let timer, ticker, inFlight = false, stopped = false, data, receivedAt, receivedMono, disconnected = false, failures = 0, controller;
  const now = () => win.performance.now();
  function view() { return trackingView(data, now() - receivedMono, disconnected, receivedAt); }
  function trackingStatus() {
    if (!data) return;
    const current = view();
    text('trackingState', current.title); get('trackingState').dataset.tone = current.tone;
    text('trackingCopy', current.copy);
    get('mapNote').hidden = current.terminal;
    text('updatedAt', current.position ? new Intl.DateTimeFormat('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(current.position.updatedAt)) : '');
    const link = get('mapLink'); link.hidden = !current.position;
    if (current.position) link.href = `https://www.google.com/maps/search/?api=1&query=${current.position.latitude},${current.position.longitude}`;
    else link.removeAttribute('href');
    map.setTone(current);
  }
  function render() {
    const trip = data.trip;
    get('loading').hidden = true; get('error').hidden = true; get('tripCard').hidden = false;
    for (const [id, value] of Object.entries({ statusLabel: trip.statusLabel, reference: trip.publicReference,
      driverName: trip.driverName, vehicle: trip.vehicleIdentifier, rating: Number(trip.driverRating || 0).toFixed(1),
      origin: trip.originReference, destination: trip.destinationReference })) text(id, value);
    trackingStatus(); void map.update(view());
    if (view().terminal) { stopped = true; win.clearInterval(ticker); }
  }
  function permanentError(expired = false) {
    stopped = true; data = undefined;
    win.clearTimeout(timer); win.clearInterval(ticker);
    get('loading').hidden = true; get('tripCard').hidden = true; get('error').hidden = false; get('retry').hidden = true;
    get('mapLink').hidden = true; get('mapLink').removeAttribute('href');
    text('errorTitle', 'Enlace no disponible');
    text('errorText', expired ? 'Este seguimiento ya caducó.' : 'Este enlace no es válido, fue revocado o ya no está disponible.');
    void map.clear('Seguimiento no disponible', 'Ya no se comparte la ubicación.');
  }
  function schedule(delay) {
    win.clearTimeout(timer);
    if (!stopped && !doc.hidden) timer = win.setTimeout(refresh, delay);
  }
  async function refresh() {
    if (inFlight || stopped || doc.hidden) return;
    win.clearTimeout(timer); inFlight = true;
    controller = new AbortController();
    const timeout = win.setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await request(`${api}/v1/public/trips/${encodeURIComponent(token)}`, { cache: 'no-store', signal: controller.signal, referrerPolicy: 'strict-origin' });
      if (stopped) return;
      if ([400, 401, 403, 404, 410].includes(response.status)) { permanentError(response.status === 410); return; }
      if (!response.ok) throw new Error('TEMPORARY');
      const result = await response.json();
      if (stopped) return;
      if (!result?.trip || typeof result.trip.status !== 'string') throw new Error('INVALID_RESPONSE');
      data = result; receivedAt = Date.now(); receivedMono = now(); disconnected = false; failures = 0;
      render();
    } catch {
      if (stopped) return;
      disconnected = true; failures++;
      if (data) trackingStatus();
      else {
        get('loading').hidden = true; get('error').hidden = false; get('retry').hidden = false;
        text('errorTitle', 'Reconectando con tu viaje');
        text('errorText', 'La conexión está tardando. Reintentaremos automáticamente, sin que tengas que abrir otro enlace.');
      }
    } finally {
      win.clearTimeout(timeout); inFlight = false;
      schedule(failures ? Math.min(30_000, 5_000 * 2 ** Math.min(failures - 1, 3)) : refreshDelay(data?.refreshSeconds));
    }
  }
  function resume() {
    win.clearTimeout(timer);
    if (!doc.hidden && !stopped) { disconnected = true; trackingStatus(); void refresh(); }
  }
  function offline() { disconnected = true; trackingStatus(); }
  function pause() { win.clearTimeout(timer); controller?.abort(); }
  function destroy() {
    stopped = true; pause(); win.clearInterval(ticker); map.destroy();
    doc.removeEventListener('visibilitychange', resume); win.removeEventListener('online', resume);
    win.removeEventListener('offline', offline); win.removeEventListener('pagehide', pause);
    win.removeEventListener('pageshow', resume); get('retry').removeEventListener('click', refresh);
  }
  get('retry').addEventListener('click', refresh);
  doc.addEventListener('visibilitychange', resume); win.addEventListener('online', resume);
  win.addEventListener('offline', offline); win.addEventListener('pagehide', pause); win.addEventListener('pageshow', resume);
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token) || !api) permanentError();
  else { ticker = win.setInterval(() => { if (!doc.hidden) trackingStatus(); }, 1000); void refresh(); }
  return { destroy };
}
