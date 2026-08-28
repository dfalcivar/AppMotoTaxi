import { createTripMap } from './trip-tracking-map.mjs';
import { startTracking } from './trip-tracking-client.mjs';

const config = window.COSTA_GO_PUBLIC_CONFIG || {};
const get = (id) => document.getElementById(id);
const map = createTripMap({ element: get('tripMap'), placeholder: get('mapPlaceholder'),
  message: get('mapMessage'), hint: get('mapHint'), recenter: get('recenter'), key: config.googleMapsWebApiKey });
startTracking({ map, config });
