import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import Fastify from 'fastify';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const state = vi.hoisted(() => ({ sql: null as any }));
vi.mock('./database.js', () => ({ database: () => state.sql }));
vi.mock('./approval-notifications.js', () => ({
  notifyAdministratorsDriverReady: vi.fn(async () => true),
  notifyDriverApproved: vi.fn(async () => true)
}));
vi.mock('./push.js', () => ({ sendPush: vi.fn(async () => ({ sent: 1 })) }));
vi.mock('./memberships.js', () => ({ grantInitialDriverGrace: vi.fn(async () => undefined) }));
import { registerAdminRoutes, tokenFor } from './admin.js';
import { refreshDriverApprovalState } from './driver-document-requirements.js';
import { notifyAdministratorsDriverReady } from './approval-notifications.js';

const required = ['PROFILE_PHOTO', 'IDENTIFICATION', 'LICENSE', 'REGISTRATION'];
const driver = '00000000-0000-4000-8000-000000000001';
const actor = '00000000-0000-4000-8000-000000000002';
const app = Fastify();
let pg: PGlite;
let headers: { authorization: string };
function sqlFor(client: any): any {
  const sql = (parts: any, ...values: any[]): any => {
    if (!parts.raw) return { list: parts };
    const params: any[] = []; let query = parts[0];
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (value && Array.isArray(value.list)) query += '(' + value.list.map((v: any) => { params.push(v); return '$' + params.length; }).join(',') + ')';
      else { params.push(value); query += '$' + params.length; }
      query += parts[i + 1];
    }
    return client.query(query, params).then((r: any) => r.rows);
  };
  return Object.assign(sql, { begin: (fn: any) => client.transaction((tx: any) => fn(sqlFor(tx))) });
}
beforeAll(async () => {
  vi.stubEnv('DATABASE_URL', 'postgres://unused/local-test');
  pg = new PGlite(); state.sql = sqlFor(pg);
  await pg.exec(`
    create table users(id uuid primary key, full_name text, email text, phone_e164 text, status text,
      cooperative_id uuid, deleted_at timestamptz, profile_photo_data bytea, profile_photo_mime text,
      email_verified_at timestamptz, created_at timestamptz default now(), updated_at timestamptz);
    create table drivers(user_id uuid primary key references users(id), approval_status text,
      approval_observation text, submitted_for_review_at timestamptz, approval_updated_at timestamptz default now(),
      approved_at timestamptz, approved_by uuid, approval_note text, is_available boolean default false,
      rating numeric, deuna_enabled boolean default false, deuna_qr_image_url text);
    create table driver_documents(id uuid primary key default gen_random_uuid(), driver_id uuid references drivers(user_id),
      document_type text, status text, file_data bytea, file_mime text, file_url text, expires_at timestamptz,
      reviewed_by uuid, reviewed_at timestamptz, review_note text, created_at timestamptz default now(),
      unique(driver_id,document_type));
    create table cooperatives(id uuid primary key, name text);
    create table vehicles(id uuid primary key default gen_random_uuid(), identifier text, merged_into uuid, fleet_status text);
    create table user_vehicle_relations(vehicle_id uuid,user_id uuid,relation_type text,status text);
    create table admin_sessions(token_hash text, revoked_at timestamptz, expires_at timestamptz);
    create table driver_approval_reviews(driver_id uuid,reviewer_id uuid,previous_status text,next_status text,decision text,observation text);
    create table audit_log(actor_id uuid,action text,entity_type text,entity_id text,next_value jsonb,reason text);
    create table driver_approval_notification_settings(id int,push_enabled boolean);
    insert into driver_approval_notification_settings values(1,false);
  `);
  const token = tokenFor({ id: actor, email: 'admin@example.test', name: 'Admin', role: 'ADMIN' });
  headers = { authorization: `Bearer ${token}` };
  await pg.query("insert into admin_sessions(token_hash,expires_at) values($1,now()+interval '1 day')", [createHash('sha256').update(token).digest('hex')]);
  await registerAdminRoutes(app);
}, 30000);
beforeEach(async () => {
  vi.clearAllMocks();
  await pg.exec('truncate users,drivers,driver_documents,vehicles,user_vehicle_relations,driver_approval_reviews,audit_log cascade');
  await pg.query("insert into users(id,full_name,email,status) values($1,'Conductor','driver@example.test','PENDING'),($2,'Admin','admin@example.test','ACTIVE')", [driver, actor]);
  await pg.query("insert into drivers(user_id,approval_status) values($1,'PENDIENTE_DOCUMENTOS')", [driver]);
  await pg.exec("insert into vehicles(identifier,fleet_status) values('MT-1','PENDING')");
});
afterAll(async () => { await app.close(); await pg.close(); vi.unstubAllEnvs(); });
async function documents(types = required, status = 'ACTIVE') {
  for (const type of types) await pg.query('insert into driver_documents(driver_id,document_type,status) values($1,$2,$3)', [driver, type, status]);
}
const approve = () => app.inject({ method: 'POST', url: `/v1/admin/driver-approvals/${driver}/decision`, headers, payload: { decision: 'APPROVE' } });
const approval = async () => (await pg.query<any>('select * from drivers where user_id=$1', [driver])).rows[0];

describe('permiso de operación opcional para el conductor', () => {
  it.each(['MISSING', 'ACTIVE', 'PENDING', 'REJECTED', 'SUSPENDED'])('aprueba cuatro obligatorios con permiso %s; conserva revisión y vehículo', async permitStatus => {
    await documents();
    if (permitStatus !== 'MISSING') await documents(['OPERATING_PERMIT'], permitStatus);
    expect((await approve()).statusCode).toBe(200);
    expect(await approval()).toMatchObject({ approval_status: 'APROBADO', is_available: false, approved_by: actor });
    expect((await pg.query<any>('select fleet_status from vehicles')).rows[0].fleet_status).toBe('PENDING');
    expect((await pg.query<any>('select decision from driver_approval_reviews')).rows).toEqual([{ decision: 'APPROVE' }]);
    expect((await pg.query<any>('select action from audit_log')).rows).toEqual([{ action: 'DRIVER_APPROVAL_DECISION' }]);
    if (permitStatus !== 'MISSING') expect((await pg.query<any>("select status from driver_documents where document_type='OPERATING_PERMIT'")).rows[0].status).toBe(permitStatus);
  });
  it.each(required)('el permiso no sustituye a %s', async missing => {
    await documents([...required.filter(type => type !== missing), 'OPERATING_PERMIT']);
    const response = await approve();
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'DRIVER_DOCUMENTS_NOT_APPROVED' });
    expect((await approval()).approval_status).toBe('PENDIENTE_DOCUMENTOS');
    expect((await pg.query('select * from driver_approval_reviews')).rows).toHaveLength(0);
  });
  it.each(['PENDING', 'REJECTED', 'SUSPENDED'])('un obligatorio %s sigue bloqueando la aprobación', async status => {
    await documents([...required, 'OPERATING_PERMIT']);
    await pg.query("update driver_documents set status=$1 where document_type='LICENSE'", [status]);
    expect((await approve()).statusCode).toBe(409);
  });
  it('los listados distinguen 4 obligatorios de los 5 archivos, sin romper los totales existentes', async () => {
    await documents([...required, 'OPERATING_PERMIT']);
    for (const path of ['drivers', 'driver-approvals']) {
      const response = await app.inject({ url: `/v1/admin/${path}`, headers });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()[0]).toMatchObject({ approvedDocuments: 5, uploadedDocuments: 5, requiredDocumentCount: 4, approvedRequiredDocuments: 4, uploadedRequiredDocuments: 4 });
    }
    await pg.query("update driver_documents set status='REJECTED' where document_type='LICENSE'");
    const response = await app.inject({ url: '/v1/admin/driver-approvals', headers });
    expect(response.json()[0]).toMatchObject({ approvedDocuments: 4, approvedRequiredDocuments: 3 });
  });
  it('la carga de cuatro documentos pasa a revisión, no a aprobación automática', async () => {
    await documents(required, 'PENDING');
    expect(await refreshDriverApprovalState(driver, 'Conductor')).toBe('PENDIENTE_REVISION');
    expect((await approval()).approval_status).toBe('PENDIENTE_REVISION');
    expect(notifyAdministratorsDriverReady).toHaveBeenCalledTimes(1);
    await refreshDriverApprovalState(driver, 'Conductor');
    expect(notifyAdministratorsDriverReady).toHaveBeenCalledTimes(1);
  });
  it('cargar el opcional con solo tres obligatorios no completa el expediente', async () => {
    await documents(['PROFILE_PHOTO', 'IDENTIFICATION', 'REGISTRATION', 'OPERATING_PERMIT'], 'PENDING');
    expect(await refreshDriverApprovalState(driver, 'Conductor')).toBe('PENDIENTE_DOCUMENTOS');
    expect(notifyAdministratorsDriverReady).not.toHaveBeenCalled();
  });
  it.each(['APROBADO', 'SUSPENDIDO'])('carga documental no cambia un conductor %s', async status => {
    await documents(required, 'PENDING');
    await pg.query('update drivers set approval_status=$1', [status]);
    expect(await refreshDriverApprovalState(driver, 'Conductor')).toBe(status);
    expect(notifyAdministratorsDriverReady).not.toHaveBeenCalled();
  });
  it('migración mueve expedientes completos solo a revisión, es repetible y conserva archivos', async () => {
    await documents(required, 'PENDING');
    const migration = await readFile(new URL('../migrations/075_optional_driver_operating_permit.sql', import.meta.url), 'utf8');
    await pg.exec(migration);
    const first = await approval();
    await pg.exec(migration);
    expect(await approval()).toEqual(first);
    expect(first.approval_status).toBe('PENDIENTE_REVISION');
    expect((await pg.query('select * from driver_documents')).rows).toHaveLength(4);
    for (const status of ['OBSERVADO', 'RECHAZADO', 'APROBADO', 'SUSPENDIDO']) {
      await pg.query('update drivers set approval_status=$1', [status]);
      await pg.exec(migration);
      expect((await approval()).approval_status).toBe(status);
    }
    await pg.query("update drivers set approval_status='PENDIENTE_DOCUMENTOS'");
    await pg.query('update users set deleted_at=now() where id=$1', [driver]);
    await pg.exec(migration);
    expect((await approval()).approval_status).toBe('PENDIENTE_DOCUMENTOS');
    await pg.query('update users set deleted_at=null where id=$1', [driver]);
    await pg.query("delete from driver_documents where document_type='LICENSE'");
    await documents(['OPERATING_PERMIT']);
    await pg.exec(migration);
    expect((await approval()).approval_status).toBe('PENDIENTE_DOCUMENTOS');
  });
  it('no concede aprobación a pasajeros sin permisos administrativos', async () => {
    await documents();
    const token = tokenFor({ id: driver, role: 'PASSENGER', email: 'driver@example.test', name: 'Conductor' });
    expect((await app.inject({ method: 'POST', url: `/v1/admin/driver-approvals/${driver}/decision`, headers: { authorization: `Bearer ${token}` }, payload: { decision: 'APPROVE' } })).statusCode).toBe(403);
  });
});
