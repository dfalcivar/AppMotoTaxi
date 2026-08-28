import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ trip: {} as Record<string, unknown>, link: true, queries: [] as string[] }));

vi.mock('./database.js', () => ({ database: () => async (parts:TemplateStringsArray) => {
  const query=parts.join('?');
  state.queries.push(query);
  if (query.includes('from trips t')) return [{id:'00000000-0000-4000-8000-000000000003',
    passengerId:'passenger-1',driverId:'driver-1',driverName:'Conductor de prueba',passengerName:'Pasajera de prueba',
    vehicleIdentifier:'ABC-123',driverRating:5,status:'DRIVER_EN_ROUTE',originReference:'Origen',destinationReference:'Destino', ...state.trip}];
  if (query.includes('from operational_settings')) return [{graceMinutes:45,supportEnabled:false}];
  if (query.includes('from trip_share_links')) return state.link ? [{tripId:'00000000-0000-4000-8000-000000000003',publicReference:'CG-PRUEBA',token:'token-existente'}] : [];
  throw new Error('Consulta inesperada en prueba');
} }));
import { tokenFor } from './admin.js';
import { registerTripSharingRoutes } from './trip-sharing.js';

describe('Seguridad del viaje: datos del participante correcto',()=>{
  const app=Fastify();
  beforeEach(() => { state.trip = {}; state.link = true; state.queries = []; });
  beforeAll(async()=>{await registerTripSharingRoutes(app);await app.ready();});
  afterAll(async()=>{await app.close();});
  async function share(id:string,role:'PASSENGER'|'DRIVER') {
    return app.inject({method:'POST',url:'/v1/trips/00000000-0000-4000-8000-000000000003/share',
      headers:{authorization:`Bearer ${tokenFor({id,role,email:'test@example.test',name:'Prueba'})}`}});
  }
  it('pasajero comparte conductor y placa existente',async()=>{
    const response=await share('passenger-1','PASSENGER');
    expect(response.statusCode).toBe(200);
    expect(response.json().message).toContain('Conductor: Conductor de prueba');
    expect(response.json().message).toContain('Mototaxi: ABC-123');
  });
  it('conductor comparte el nombre del pasajero, sin cambiar el mapa público',async()=>{
    const response=await share('driver-1','DRIVER');
    expect(response.statusCode).toBe(200);
    expect(response.json().message).toContain('Pasajero: Pasajera de prueba');
    expect(response.json().message).not.toContain('Conductor: Conductor de prueba');
    expect(response.json().trip.driverName).toBe('Conductor de prueba');
  });
  it('otro usuario no puede compartir un viaje ajeno',async()=>{
    expect((await share('otro','PASSENGER')).statusCode).toBe(403);
  });
  const publicUrl = `/v1/public/trips/${'a'.repeat(43)}`;
  it('publica la última ubicación del conductor actual sin datos privados', async () => {
    state.trip = { latitude: 0.87, longitude: -79.82, locationUpdatedAt: new Date().toISOString() };
    const response = await app.inject({ method: 'GET', url: publicUrl });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const data = response.json();
    expect(data.trip.location).toEqual({ latitude: 0.87, longitude: -79.82, updatedAt: state.trip.locationUpdatedAt });
    expect(data.refreshSeconds).toBe(15);
    expect(data.locationFreshnessSeconds).toBe(60);
    expect(Number.isFinite(Date.parse(data.serverTime))).toBe(true);
    for (const field of ['id', 'driverId', 'passengerId', 'passengerName', 'email', 'phone']) expect(data.trip).not.toHaveProperty(field);
    expect(state.queries.some(query => query.includes('location.trip_id=t.id and location.driver_id=t.driver_id'))).toBe(true);
  });
  it('conserva el timestamp antiguo para que la web advierta GPS sin señal', async () => {
    const old = new Date(Date.now() - 180_000).toISOString();
    state.trip = { latitude: 0.87, longitude: -79.82, locationUpdatedAt: old };
    expect((await app.inject({ method: 'GET', url: publicUrl })).json().trip.location.updatedAt).toBe(old);
  });
  it.each(['COMPLETED', 'CANCELLED', 'NO_DRIVER'])('oculta coordenadas al finalizar en %s', async (status) => {
    state.trip = { status, latitude: 0.87, longitude: -79.82, locationUpdatedAt: new Date(), requestedAt: new Date(), completedAt: new Date() };
    const data = (await app.inject({ method: 'GET', url: publicUrl })).json();
    expect(data.trip.terminal).toBe(true); expect(data.trip.location).toBeNull();
  });
  it.each([
    { driverId: null }, { status: 'SEARCHING' }, { status: 'INCIDENT' },
    { latitude: 91 }, { longitude: NaN }, { locationUpdatedAt: 'invalid' },
  ])('no publica posiciones de una asignación inexistente/inválida: %j', async (patch) => {
    state.trip = { latitude: 0.87, longitude: -79.82, locationUpdatedAt: new Date(), ...patch };
    expect((await app.inject({ method: 'GET', url: publicUrl })).json().trip.location).toBeNull();
  });
  it('enlace caducado devuelve 410 sin datos', async () => {
    state.trip = { status: 'COMPLETED', completedAt: new Date(Date.now() - 46 * 60_000) };
    const response = await app.inject({ method: 'GET', url: publicUrl });
    expect(response.statusCode).toBe(410); expect(response.json()).not.toHaveProperty('trip');
  });
  it('rechaza enlaces revocados y tokens inválidos', async () => {
    state.link = false;
    expect((await app.inject({ method: 'GET', url: publicUrl })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/v1/public/trips/invalido' })).statusCode).toBe(404);
  });
});
