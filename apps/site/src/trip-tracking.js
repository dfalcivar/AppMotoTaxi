import { createTripMap } from './trip-tracking-map.mjs';
import { startTracking } from './trip-tracking-client.mjs';

const config = window.COSTA_GO_PUBLIC_CONFIG || {};
const get = (id) => document.getElementById(id);
function reportMapError(detail) {
  // Temporary production diagnostic. The key and the tracking token are deliberately excluded.
  console.error('[Costa-Go][seguimiento][mapa] ' + JSON.stringify({
    code: detail?.code || 'MAP_UNAVAILABLE',
    keyConfigured: Boolean(detail?.keyConfigured),
    host: location.hostname,
    online: navigator.onLine,
    visibility: document.visibilityState,
  }));
}
const map = createTripMap({ element: get('tripMap'), placeholder: get('mapPlaceholder'),
  message: get('mapMessage'), hint: get('mapHint'), recenter: get('recenter'),
  key: config.googleMapsWebApiKey, reportError: reportMapError });
startTracking({ map, config });
