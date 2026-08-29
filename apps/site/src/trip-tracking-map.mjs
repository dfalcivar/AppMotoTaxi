const darkStyles = [
  { elementType: 'geometry', stylers: [{ color: '#172731' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#a9bdc7' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#101b22' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#304654' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#436271' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#06375d' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
];

// Only the Maps library is loaded: no Routes, Places or Navigation requests.
export function loadGoogleMaps(key, onFailure) {
  const cleanKey = typeof key === 'string' ? key.trim() : '';
  if (!cleanKey) {
    const error = new Error('MAP_NOT_CONFIGURED');
    onFailure?.(error);
    return Promise.reject(error);
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    let settled = false;
    const timeout = setTimeout(() => fail(new Error('MAP_SCRIPT_TIMEOUT')), 15_000);
    function fail(error = new Error('MAP_UNAVAILABLE')) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      onFailure?.(error);
      reject(error);
    }
    // Authentication can fail after the script callback; keep this handler active.
    window.gm_authFailure = () => fail(new Error('MAP_AUTH_FAILURE'));
    window.costaGoTrackingMapReady = () => {
      if (settled) return;
      clearTimeout(timeout);
      if (!window.google?.maps?.Map) return fail(new Error('MAP_NAMESPACE_MISSING'));
      settled = true;
      resolve(window.google.maps);
    };
    script.onerror = () => fail(new Error('MAP_SCRIPT_NETWORK_ERROR'));
    script.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({ key: cleanKey, loading: 'async', callback: 'costaGoTrackingMapReady', v: 'quarterly', language: 'es', region: 'EC' })}`;
    script.async = true;
    script.referrerPolicy = 'strict-origin'; // Never send the bearer token in the page path.
    document.head.append(script);
  });
}

export function createTripMap({ element, placeholder, message, hint, recenter, key, load = loadGoogleMaps, reportError }) {
  let mapsPromise, maps, map, marker, latest, revision = 0, failed = false, follow = true, frame;
  const theme = matchMedia('(prefers-color-scheme: dark)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  function empty(title, copy) {
    placeholder.hidden = false; element.hidden = true; recenter.disabled = true;
    message.textContent = title; hint.textContent = copy;
  }
  function failure(error) {
    const code = error instanceof Error ? error.message : 'MAP_UNAVAILABLE';
    reportError?.({ code, keyConfigured: Boolean(typeof key === 'string' && key.trim()) });
    failed = true;
    cancelAnimationFrame(frame);
    if (!latest?.position) return;
    empty('No se pudo cargar el mapa', 'El estado del viaje seguirá actualizándose. Puedes abrir la última ubicación en Google Maps o recargar la página.');
  }
  function createMarker() {
    return new class extends maps.OverlayView {
      onAdd() {
        this.node = document.createElement('div');
        this.node.className = 'moto-marker'; this.node.setAttribute('role', 'img');
        this.node.setAttribute('aria-label', 'Mototaxi Costa-Go');
        const image = document.createElement('img'); image.src = '/assets/mototaxi-map-marker.png'; image.alt = '';
        this.node.append(image); this.getPanes().floatPane.append(this.node);
      }
      draw() {
        if (!this.position || !this.node) return;
        const pixel = this.getProjection().fromLatLngToDivPixel(new maps.LatLng(this.position.lat, this.position.lng));
        if (!pixel) return;
        this.node.style.left = `${pixel.x}px`; this.node.style.top = `${pixel.y}px`;
        this.node.dataset.stale = String(latest?.tone !== 'live');
      }
      onRemove() { this.node?.remove(); }
      move(position) { this.position = position; this.draw(); }
    }();
  }
  async function update(view) {
    latest = view;
    const currentRevision = ++revision;
    if (!view.position) {
      cancelAnimationFrame(frame); marker?.setMap(null); marker = null;
      empty(view.title, view.copy); return;
    }
    if (failed) return;
    if (!map) {
      empty('Cargando mapa…', 'Preparando la ubicación de la mototaxi.');
      mapsPromise ??= load(key, failure);
      try { maps = await mapsPromise; } catch (error) { if (latest?.position&&!failed) failure(error); return; }
      if (currentRevision !== revision || failed) return;
      element.hidden = false;
      // One map instance per page. Updates move the overlay, never recreate the map.
      const { latitude: lat, longitude: lng } = view.position;
      map = new maps.Map(element, { center: { lat, lng }, zoom: 16,
        mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
        gestureHandling: 'cooperative', styles: theme.matches ? darkStyles : [],
      });
      map.addListener('dragstart', () => { follow = false; });
    }
    placeholder.hidden = true; element.hidden = false; recenter.disabled = false;
    const target = { lat: view.position.latitude, lng: view.position.longitude };
    if (!marker) { marker = createMarker(); marker.move(target); marker.setMap(map); }
    const from = marker.position;
    cancelAnimationFrame(frame);
    if (view.tone === 'live' && !reducedMotion.matches && (from.lat !== target.lat || from.lng !== target.lng)) {
      const start = performance.now();
      const animate = (now) => {
        const fraction = Math.min(1, (now - start) / 650);
        marker.move({ lat: from.lat + (target.lat - from.lat) * fraction, lng: from.lng + (target.lng - from.lng) * fraction });
        if (fraction < 1) frame = requestAnimationFrame(animate);
      };
      frame = requestAnimationFrame(animate);
    } else marker.move(target);
    if (follow) map.panTo(target);
  }
  function setTone(view) { latest = view; if (view.tone !== 'live') cancelAnimationFrame(frame); marker?.draw(); }
  function center() {
    if (!map || !latest?.position || failed) return;
    follow = true; map.panTo({ lat: latest.position.latitude, lng: latest.position.longitude });
  }
  function changeTheme() { map?.setOptions({ styles: theme.matches ? darkStyles : [] }); }
  recenter.addEventListener('click', center);
  if (typeof theme.addEventListener === 'function') theme.addEventListener('change', changeTheme);
  else theme.addListener?.(changeTheme); // Safari/iOS anterior.
  return { update, setTone, clear(title, copy) { return update({ title, copy, position: null }); },
    destroy() { revision++; cancelAnimationFrame(frame); marker?.setMap(null);
      if (typeof theme.removeEventListener === 'function') theme.removeEventListener('change', changeTheme);
      else theme.removeListener?.(changeTheme);
      recenter.removeEventListener('click', center); } };
}
