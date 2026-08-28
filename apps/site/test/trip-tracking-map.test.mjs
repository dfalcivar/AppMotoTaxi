import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTripMap } from '../src/trip-tracking-map.mjs';

test('mapa único: actualiza marcador, tema, seguimiento y no conserva posición al terminar', async (t) => {
  class Element extends EventTarget {
    hidden = false; disabled = false; style = {}; dataset = {}; children = [];
    append(child) { this.children.push(child); } setAttribute() {} remove() { this.removed = true; }
  }
  let instances = 0, loads = 0, instance, overlay;
  const media = new EventTarget(); media.matches = false;
  const reduced = { matches: true };
  const globals = { document: { createElement: () => new Element() }, matchMedia: query => query.includes('reduced') ? reduced : media,
    cancelAnimationFrame() {}, requestAnimationFrame() { throw new Error('Reduced motion must not animate'); } };
  for (const [key, value] of Object.entries(globals)) {
    const original = globalThis[key]; globalThis[key] = value;
    t.after(() => { if (original === undefined) delete globalThis[key]; else globalThis[key] = original; });
  }
  const maps = {
    Map: class { constructor() { instances++; instance = this; this.listeners = {}; } addListener(name, fn) { this.listeners[name] = fn; }
      panTo(value) { this.center = value; } setOptions(value) { this.options = value; } },
    OverlayView: class { constructor() { overlay = this; } setMap(map) { this.map = map; map ? this.onAdd() : this.onRemove(); this.draw(); }
      getPanes() { return { floatPane: new Element() }; } getProjection() { return { fromLatLngToDivPixel: p => ({ x: p.lng, y: p.lat }) }; } },
    LatLng: class { constructor(lat, lng) { this.lat = lat; this.lng = lng; } },
  };
  const elements = Object.fromEntries(['element', 'placeholder', 'message', 'hint', 'recenter'].map(key => [key, new Element()]));
  const tracker = createTripMap({ ...elements, key: 'test', load: async () => { loads++; return maps; } });
  const view = { position: { latitude: 0.87, longitude: -79.82 }, tone: 'live' };
  await tracker.update(view); assert.equal(instances, 1); assert.equal(loads, 1); assert.equal(elements.placeholder.hidden, true);
  await tracker.update({ ...view, position: { latitude: 0.88, longitude: -79.83 } });
  assert.equal(instances, 1); assert.deepEqual(overlay.position, { lat: 0.88, lng: -79.83 });
  instance.listeners.dragstart(); await tracker.update(view); assert.deepEqual(instance.center, { lat: 0.88, lng: -79.83 });
  elements.recenter.dispatchEvent(new Event('click')); assert.deepEqual(instance.center, { lat: 0.87, lng: -79.82 });
  tracker.setTone({ ...view, tone: 'waiting' }); assert.equal(overlay.node.dataset.stale, 'true');
  media.matches = true; media.dispatchEvent(new Event('change')); assert.ok(instance.options.styles.length > 0);
  await tracker.clear('Seguimiento finalizado', 'Sin ubicación'); assert.equal(overlay.map, null);
  assert.equal(elements.element.hidden, true); assert.equal(elements.recenter.disabled, true);
  // A reassignment with new GPS may reuse the map, not a second billable instance.
  await tracker.update(view); assert.equal(instances, 1); assert.equal(loads, 1); tracker.destroy();
});

test('una carga tardía de Google no restaura el mapa después de finalizar el viaje', async (t) => {
  const original = { matchMedia: globalThis.matchMedia, cancelAnimationFrame: globalThis.cancelAnimationFrame };
  globalThis.matchMedia = () => Object.assign(new EventTarget(), { matches: false }); globalThis.cancelAnimationFrame = () => {};
  t.after(() => { for (const [key, value] of Object.entries(original)) value === undefined ? delete globalThis[key] : globalThis[key] = value; });
  let finish, instances = 0;
  const elements = Object.fromEntries(['element', 'placeholder', 'message', 'hint', 'recenter'].map(key => [key, new EventTarget()]));
  const tracker = createTripMap({ ...elements, key: 'test', load: () => new Promise(resolve => { finish = resolve; }) });
  const pending = tracker.update({ position: { latitude: 1, longitude: 2 }, tone: 'live' });
  await tracker.clear('Seguimiento finalizado', 'Sin ubicación');
  finish({ Map: class { constructor() { instances++; } } }); await pending;
  assert.equal(instances, 0); assert.equal(elements.element.hidden, true); tracker.destroy();
});
