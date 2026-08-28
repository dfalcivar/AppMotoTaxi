import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('./database.js', () => ({ database: () => async (parts:TemplateStringsArray) => {
  const query=parts.join('?');
  if (query.includes('from trips t')) return [{id:'00000000-0000-4000-8000-000000000003',
    passengerId:'passenger-1',driverId:'driver-1',driverName:'Conductor de prueba',passengerName:'Pasajera de prueba',
    vehicleIdentifier:'ABC-123',driverRating:5,status:'DRIVER_EN_ROUTE',originReference:'Origen',destinationReference:'Destino'}];
  if (query.includes('from operational_settings')) return [{graceMinutes:45,supportEnabled:false}];
  if (query.includes('from trip_share_links')) return [{publicReference:'CG-PRUEBA',token:'token-existente'}];
  throw new Error('Consulta inesperada en prueba');
} }));
import { tokenFor } from './admin.js';
import { registerTripSharingRoutes } from './trip-sharing.js';

describe('Seguridad del viaje: datos del participante correcto',()=>{
  const app=Fastify();
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
});
