import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshDelay, trackingView, validPosition } from '../src/trip-tracking-model.mjs';
import { startTracking } from '../src/trip-tracking-client.mjs';

const epoch = Date.parse('2026-08-28T12:00:00Z');
function payload(patch = {}) {
  return { serverTime: new Date(epoch).toISOString(), refreshSeconds: 15, locationFreshnessSeconds: 60,
    trip: { status: 'IN_PROGRESS', statusLabel: 'Viaje en curso', publicReference: 'CG-PRUEBA', driverName: 'Conductor de prueba',
      vehicleIdentifier: 'ABC123', driverRating: 5, originReference: 'Atacames', destinationReference: 'Tonsupa',
      location: { latitude: 0.87, longitude: -79.82, updatedAt: new Date(epoch).toISOString() }, ...patch } };
}
test('ubicación fresca/antigua usa reloj del servidor y deja de decir en vivo sin señal', () => {
  assert.equal(trackingView(payload(), 20_000, false, epoch + 600_000).tone, 'live');
  assert.equal(trackingView(payload(), 61_000).title, 'Sin señal reciente');
  assert.equal(trackingView(payload(), 0, true).title, 'Reconectando…');
  assert.equal(trackingView(payload({ location: null })).position, null);
  assert.equal(trackingView(payload({ status: 'SEARCHING' })).position, null);
  for (const status of ['COMPLETED', 'CANCELLED', 'NO_DRIVER']) {
    assert.equal(trackingView(payload({ status })).position, null);
    assert.equal(trackingView(payload({ status })).terminal, true);
  }
});
test('valida coordenadas/timestamp y acota polling sin afectar API anterior', () => {
  for (const location of [null, {}, { latitude: null, longitude: 0 }, { ...payload().trip.location, latitude: Infinity },
    { ...payload().trip.location, longitude: 190 }, { ...payload().trip.location, updatedAt: 'x' }]) assert.ok(!validPosition(location));
  const data = payload(); delete data.serverTime;
  assert.equal(trackingView(data, 0, false, epoch).tone, 'live');
  assert.equal(refreshDelay(undefined), 15_000); assert.equal(refreshDelay(1), 10_000); assert.equal(refreshDelay(Infinity), 60_000);
});

class Element extends EventTarget {
  hidden = false; textContent = ''; dataset = {}; href = '';
  removeAttribute(name) { delete this[name]; }
}
function fixture(request, path = 'a'.repeat(43)) {
  const elements = new Map(); const timers = new Map(); const intervals = new Map(); let id = 0, time = 0;
  const doc = new EventTarget(); doc.hidden = false;
  doc.getElementById = key => { if (!elements.has(key)) elements.set(key, new Element()); return elements.get(key); };
  const win = new EventTarget(); Object.assign(win, {
    location: { pathname: `/viaje/${path}` }, performance: { now: () => time },
    setTimeout: (fn, delay) => { timers.set(++id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id),
    setInterval: fn => { intervals.set(++id, fn); return id; }, clearInterval: id => intervals.delete(id),
  });
  const updates = []; const tones = []; let clears = 0;
  const map = { update: view => updates.push(view), setTone: view => tones.push(view), clear: () => clears++, destroy() {} };
  const client = startTracking({ doc, win, request, map, config: { apiBaseUrl: 'https://api.example.test' } });
  return { doc, win, timers, intervals, updates, tones, client, get: doc.getElementById,
    get clears() { return clears; }, async flush() { await new Promise(resolve => setImmediate(resolve)); },
    async next() { const [key, timer] = [...timers][0] || []; assert.ok(timer); timers.delete(key); time += timer.delay; await timer.fn(); },
  };
}
const ok = data => ({ status: 200, ok: true, json: async () => data });

test('actualiza el mapa, conserva diseño/datos y reintenta tras un corte de red', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; if (calls === 2) throw new Error('Network'); return ok(payload()); });
  await f.flush(); assert.equal(f.updates.length, 1); assert.equal(f.get('statusLabel').textContent, 'Viaje en curso');
  await f.next(); assert.equal(f.tones.at(-1).title, 'Reconectando…'); assert.equal(f.get('tripCard').hidden, false);
  await f.next(); assert.equal(f.updates.length, 2); assert.equal(f.tones.at(-1).title, 'Seguimiento en vivo');
  f.client.destroy();
});
test('error inicial/500 no invalida enlace y luego se recupera', async () => {
  let calls = 0;
  const f = fixture(async () => ++calls === 1 ? { status: 500, ok: false } : ok(payload()));
  await f.flush(); assert.equal(f.get('errorTitle').textContent, 'Reconectando con tu viaje');
  assert.equal(f.get('retry').hidden, false); await f.next(); assert.equal(f.get('error').hidden, true);
  f.client.destroy();
});
test('finalización quita ubicación/enlace, detiene refresco y no se reactiva al regresar', async () => {
  let calls = 0;
  const f = fixture(async () => ok(payload(++calls > 1 ? { status: 'COMPLETED' } : {})));
  await f.flush(); await f.next(); assert.equal(f.updates.at(-1).position, null);
  assert.equal(f.get('mapLink').hidden, true); assert.equal(f.get('mapLink').href, undefined);
  assert.equal(f.timers.size, 0); assert.equal(f.intervals.size, 0);
  f.doc.dispatchEvent(new Event('visibilitychange')); await f.flush(); assert.equal(calls, 2); f.client.destroy();
});
test('revocación/caducidad elimina mapa incluso después de verlo', async () => {
  for (const status of [403, 404, 410]) {
    let calls = 0; const f = fixture(async () => ++calls === 1 ? ok(payload()) : { ok: false, status });
    await f.flush(); await f.next(); assert.equal(f.clears, 1); assert.equal(f.get('tripCard').hidden, true);
    assert.equal(f.timers.size, 0); assert.equal(f.get('mapLink').href, undefined); f.client.destroy();
  }
});
test('pausa en pestaña oculta, se reconecta al volver y no duplica solicitudes simultáneas', async () => {
  let calls = 0, finish;
  const f = fixture(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  f.win.dispatchEvent(new Event('online')); f.get('retry').dispatchEvent(new Event('click'));
  assert.equal(calls, 1); finish(ok(payload())); await f.flush();
  f.doc.hidden = true; f.doc.dispatchEvent(new Event('visibilitychange')); assert.equal(f.timers.size, 0);
  f.doc.hidden = false; f.doc.dispatchEvent(new Event('visibilitychange')); assert.equal(calls, 2);
  finish(ok(payload())); await f.flush(); f.client.destroy();
});
test('aborta peticiones que no responden y reintenta sin dejar pantalla bloqueada', async () => {
  const f = fixture((url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Timeout')))));
  await f.next(); await f.flush(); assert.equal(f.get('errorTitle').textContent, 'Reconectando con tu viaje');
  assert.equal([...f.timers.values()][0].delay, 5000); f.client.destroy();
});
test('token malformado no llama API ni Google Maps', async () => {
  let calls = 0; const f = fixture(async () => { calls++; return ok(payload()); }, '%bad');
  await f.flush(); assert.equal(calls, 0); assert.equal(f.updates.length, 0); assert.equal(f.clears, 1); f.client.destroy();
});
