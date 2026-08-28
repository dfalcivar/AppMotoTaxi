// Local-only visual QA. No production API, Google requests, real tokens or real drivers.
// Run: node test/tracking-preview.mjs, then http://127.0.0.1:3312/qa
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const cases = ['active', 'stale', 'waiting', 'ended', 'expired', 'offline', 'map-error'];
const tokens = cases.map((name, index) => String.fromCharCode(97 + index).repeat(43));
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:3312');
  const send = (body, type = 'text/html', status = 200) => { res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' }); res.end(body); };
  try {
    if (url.pathname === '/qa') {
      const scenario = cases.includes(url.searchParams.get('case')) ? url.searchParams.get('case') : 'active';
      const width = Math.min(1000, Math.max(320, Number(url.searchParams.get('width')) || 390));
      const dark = url.searchParams.get('theme') === 'dark';
      return send(`<html lang="es"><meta charset="utf-8"><style>body{margin:12px;background:#c5d2d9;font:14px system-ui}nav{margin:12px}iframe{display:block;width:${width}px;height:1040px;border:0;color-scheme:${dark ? 'dark' : 'light'}}</style><strong>QA local: mapa y GPS simulados (sin llamadas a Google)</strong><nav>${cases.map(name => `<a href="/qa?case=${name}&theme=${dark ? 'dark' : 'light'}&width=${width}">${name}</a>`).join(' · ')} · <a href="/qa?case=${scenario}&theme=${dark ? 'light' : 'dark'}&width=${width}">Cambiar tema</a></nav><iframe title="Seguimiento de prueba" src="/viaje/${tokens[cases.indexOf(scenario)]}"></iframe></html>`);
    }
    if (url.pathname.startsWith('/v1/public/trips/')) {
      const scenario = cases[tokens.indexOf(url.pathname.split('/').at(-1))];
      if (scenario === 'expired') return send(JSON.stringify({ error: 'TRIP_SHARE_EXPIRED' }), 'application/json', 410);
      if (scenario === 'offline') return send('{}', 'application/json', 503);
      const now = Date.now();
      const step = Math.floor(now / 15000) % 6;
      return send(JSON.stringify({ serverTime: new Date(now).toISOString(), refreshSeconds: 15, locationFreshnessSeconds: 60,
        trip: { status: scenario === 'ended' ? 'COMPLETED' : scenario === 'waiting' ? 'SEARCHING' : 'IN_PROGRESS',
          statusLabel: scenario === 'ended' ? 'Viaje finalizado' : scenario === 'waiting' ? 'Buscando conductor' : 'Viaje en curso',
          publicReference: 'CG-PRUEBA', driverName: 'Conductor de prueba', vehicleIdentifier: 'CG-001', driverRating: 4.9,
          originReference: 'Parque central de Atacames', destinationReference: 'Tonsupa · Centro parroquial',
          terminal: scenario === 'ended', location: ['waiting', 'ended'].includes(scenario) ? null : {
            latitude: 0.87 + step * 0.0001, longitude: -79.83 + step * 0.0001,
            updatedAt: new Date(now - (scenario === 'stale' ? 180000 : 0)).toISOString(),
          } } }), 'application/json');
    }
    if (url.pathname === '/config.js') return send('window.COSTA_GO_PUBLIC_CONFIG={apiBaseUrl:"http://127.0.0.1:3312",googleMapsWebApiKey:"QA-LOCAL"};', 'text/javascript');
    if (url.pathname === '/trip-tracking.js') {
      const entry = await readFile(resolve(root, 'src/trip-tracking.js'), 'utf8');
      return send(`import { mockMaps } from '/qa-map.mjs';\n${entry.replace('key: config.googleMapsWebApiKey', "key: config.googleMapsWebApiKey, load: async () => { if(location.pathname.endsWith('g'.repeat(43))) throw new Error('QA'); return mockMaps; }")}`, 'text/javascript');
    }
    if (url.pathname === '/qa-map.mjs') return send(`
      let current;
      export const mockMaps={
        Map:class{constructor(el,options){current=this;this.el=el;this.center=options.center;el.style.cssText='position:relative;overflow:hidden;background-color:var(--soft);background-image:repeating-linear-gradient(25deg,transparent 0px,transparent 40px,var(--line) 41px,var(--line) 44px,transparent 45px),repeating-linear-gradient(115deg,transparent 0px,transparent 70px,var(--line) 71px,var(--line) 75px,transparent 76px)';const label=document.createElement('span');label.textContent='Mapa simulado · QA local';label.style.cssText='position:absolute;bottom:8px;left:12px;font:12px system-ui;color:var(--muted)';el.append(label)}addListener(){}panTo(value){this.center=value;this.overlay?.draw()}setOptions(){}},
        OverlayView:class{setMap(map){if(map){this.map=map;map.overlay=this;this.onAdd();this.draw()}else this.onRemove()}getPanes(){return{floatPane:this.map.el}}getProjection(){return{fromLatLngToDivPixel:p=>({x:this.map.el.clientWidth/2+(p.lng-this.map.center.lng)*80000,y:this.map.el.clientHeight/2-(p.lat-this.map.center.lat)*80000})}}},
        LatLng:class{constructor(lat,lng){this.lat=lat;this.lng=lng}}
      };
    `, 'text/javascript');
    const path = url.pathname.startsWith('/viaje/') ? 'src/viaje/index.html' : url.pathname.startsWith('/assets/') ? `dist${url.pathname}` : `src${url.pathname}`;
    const file = resolve(root, path);
    if (!file.startsWith(root)) return send('Not found', 'text/plain', 404);
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }[extname(file)] || 'text/plain';
    send(await readFile(file), type);
  } catch { send('Not found', 'text/plain', 404); }
});
server.listen(3312, '127.0.0.1', () => console.log('QA local: http://127.0.0.1:3312/qa'));
