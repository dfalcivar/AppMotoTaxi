import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
const state=vi.hoisted(()=>({sql:null as any}));
vi.mock('../database.js',()=>({database:()=>state.sql}));
import {PerfilFiscalService,fiscalProfileSchema,requireOrderFiscalProfile} from './clients.js';
import {FacturaService} from './invoices.js';
import {DatilProvider,AzurProvider,SriProvider} from './providers.js';
import {summarizeFiscalRows,fiscalFilterSchema,registerFiscalRoutes} from './routes.js';
import {tokenFor} from '../admin.js';
import Fastify from 'fastify';
import {createHash} from 'node:crypto';
const driverId='00000000-0000-4000-8000-000000000001',advertiserId='00000000-0000-4000-8000-000000000002',orderId='00000000-0000-4000-8000-000000000003',adOrder='00000000-0000-4000-8000-000000000004',actorId='00000000-0000-4000-8000-000000000005',sessionId='00000000-0000-4000-8000-000000000006';
let pg:PGlite;
const owner={type:'CONDUCTOR' as const,id:driverId};
const input={identificationType:'CEDULA' as const,identification:'0912345678',legalName:'Prueba Fiscal',address:'Dirección de prueba 123',billingEmail:'fiscal@example.test',expectedRevision:0};
function sqlFor(client:any):any {
  const sql=(parts:TemplateStringsArray,...values:any[])=>client.query(parts.reduce((s,p,i)=>s+(i?'$'+i:'')+p,''),values).then((r:any)=>r.rows);
  return Object.assign(sql,{begin:(fn:any)=>client.transaction((tx:any)=>fn(sqlFor(tx)))});
}
beforeAll(async()=>{
  pg=new PGlite();state.sql=sqlFor(pg);
  await pg.exec(`create table users(id uuid primary key,full_name text,email text,deleted_at timestamptz,active_session_id uuid);
    create table advertisers(id uuid primary key,business_name text,email text);
    create table service_areas(id uuid primary key,name text);
    create table operational_settings(id int primary key,vat_rate_percent numeric(6,3) not null default 15,updated_at timestamptz default now(),updated_by uuid);
    insert into operational_settings(id) values(1);
    create table membership_payment_orders(id uuid primary key,driver_id uuid,status text default 'PENDING',expires_at timestamptz default now()+interval '1 day');
    create table advertising_orders(id uuid primary key,advertiser_id uuid,status text default 'PENDING_PAYMENT',assigned_commercial_id uuid);
    create table affiliate_banners(id uuid primary key,order_id uuid,service_area_id uuid);
    create table membership_payments(id uuid primary key default gen_random_uuid(),driver_id uuid,order_id uuid,collection_point_id uuid,status text default 'CONFIRMED',method text default 'CASH',amount numeric,currency text default 'USD',confirmed_at timestamptz default now());
    create table advertising_payments(id uuid primary key default gen_random_uuid(),advertiser_id uuid,order_id uuid,status text default 'PENDING',settlement_status text default 'NOT_RECEIVED',payment_method_id uuid,amount numeric,currency text default 'USD',reviewed_at timestamptz,created_at timestamptz default now());
    create table advertising_payment_methods(id uuid primary key,code text);
    create table advertising_payment_upload_tokens(id uuid primary key default gen_random_uuid(),order_id uuid,token_hash text,status text,expires_at timestamptz);
    create table collector_assignments(collector_id uuid,collection_point_id uuid,starts_at timestamptz,ends_at timestamptz);
    create table collection_points(id uuid primary key,status text,service_area_id uuid);
  `);
  await pg.exec(await readFile(new URL('../../migrations/072_fiscal_clients_and_invoicing.sql',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),'utf8').catch(()=>readFile('migrations/072_fiscal_clients_and_invoicing.sql','utf8')));
},30000);
beforeEach(async()=>{
  vi.stubEnv('FACTURACION_ENABLED','false');vi.stubEnv('NODE_ENV','test');
  await pg.exec('truncate fiscal_credit_notes,fiscal_invoices,fiscal_billing_outbox,fiscal_profiles,fiscal_client_links,fiscal_audit,fiscal_clients,users,advertisers,membership_payment_orders,advertising_orders,membership_payments,advertising_payments,advertising_payment_upload_tokens cascade');
  await pg.query('insert into users(id,full_name,email,active_session_id) values($1,$2,$3,$4),($5,$6,$7,null)',[driverId,'Conductor','driver@example.test',sessionId,actorId,'Administrador','admin@example.test']);
  await pg.query('insert into advertisers(id,business_name,email) values($1,$2,$3)',[advertiserId,'Hotel de prueba','contact@example.test']);
  await pg.query('insert into membership_payment_orders(id,driver_id) values($1,$2)',[orderId,driverId]);
  await pg.query('insert into advertising_orders(id,advertiser_id) values($1,$2)',[adOrder,advertiserId]);
});
afterAll(async()=>{vi.unstubAllEnvs();await pg.close();});
const service=new PerfilFiscalService();
async function pay(){return (await pg.query<any>('insert into membership_payments(driver_id,order_id,amount) values($1,$2,12) returning id',[driverId,orderId])).rows[0].id;}
describe('fiscal integration, durable local payments and deletion',()=>{
  it.runIf(process.env.FISCAL_UI_QA==='true')('manual UI preview on loopback only',async()=>{
    await service.save(owner,input,{});await pay();await new FacturaService().collectCommittedPayments();
    const token='q'.repeat(43),hash=createHash('sha256').update(`${process.env.ADMIN_SESSION_SECRET??'costa-go-local-development'}:advertising-payment-upload:${token}`).digest('hex');
    await pg.query("insert into advertising_payment_upload_tokens(order_id,token_hash,status,expires_at) values($1,$2,'OPENED',now()+interval '1 day')",[adOrder,hash]);
    const app=Fastify();await registerFiscalRoutes(app);
    app.get('/qa/session',async()=>({token:tokenFor({id:actorId,name:'Admin QA',email:'qa@example.test',role:'ADMIN'}),permissions:['FACTURACION_VER','FACTURACION_ADMINISTRAR','CLIENTES_FISCALES_VER','CLIENTES_FISCALES_EDITAR','FACTURACION_DASHBOARD_VER']}));
    // Receipt context is a test fixture; fiscal GET/PUT above are the real handlers.
    app.get('/v1/public/advertising/payment-proof/:token',async()=>({received:false,orderCode:'QA-ONLY',businessName:'Comercio de prueba',planName:'Mensual',amount:25,currency:'USD'}));
    let stop:()=>void=()=>{};const stopped=new Promise<void>(resolve=>{stop=resolve;});app.post('/qa/stop',async()=>{stop();return {ok:true};});
    await app.listen({host:'127.0.0.1',port:3311});await stopped;await app.close();
  },1_800_000);
  it('does not create a profile merely on consultation',async()=>{expect(await service.forOwner(owner)).toEqual({clientId:null,profile:null});expect((await pg.query('select * from fiscal_clients')).rows).toHaveLength(0);});
  it('creates once, retries idempotently and reuses the driver profile',async()=>{
    const one=await service.save(owner,input,{id:actorId});const two=await service.save(owner,input,{id:actorId});
    expect(two?.id).toBe(one?.id);expect(two?.revision).toBe(1);expect((await pg.query('select * from fiscal_audit')).rows).toHaveLength(1);
    expect((await service.forOwner(owner)).profile?.id).toBe(one?.id);
  });
  it('updates with revision control without duplicating identities',async()=>{
    const p=await service.save(owner,input,{});expect(p).not.toBeNull();
    await service.save(owner,{...input,expectedRevision:1,address:'Nueva dirección 456'},{});
    await expect(service.save(owner,{...input,address:'Otra dirección'},{})).rejects.toThrow('FISCAL_PROFILE_CHANGED');
    expect((await pg.query('select * from fiscal_profiles')).rows).toHaveLength(1);
  });
  it('keeps the commercial contact independent from the fiscal company',async()=>{
    await service.save({type:'COMERCIO',id:advertiserId},{...input,identificationType:'RUC',identification:'1790012345001',legalName:'Hotel Fiscal S.A.S.'},{});
    expect((await pg.query<any>('select email from advertisers')).rows[0].email).toBe('contact@example.test');
  });
  it('requires fiscal data for new payments, not historical orders',async()=>{
    await expect(requireOrderFiscalProfile(state.sql,'MEMBRESIA',orderId)).rejects.toThrow('FISCAL_PROFILE_REQUIRED');
    await pg.query('update membership_payment_orders set fiscal_required=false where id=$1',[orderId]);
    await expect(requireOrderFiscalProfile(state.sql,'MEMBRESIA',orderId)).resolves.toBeUndefined();
  });
  it('permits collection after inline profile creation',async()=>{
    await service.save(owner,input,{id:actorId});await expect(requireOrderFiscalProfile(state.sql,'MEMBRESIA',orderId)).resolves.toBeUndefined();
    const payment=await pay();expect((await pg.query<any>('select status from membership_payments where id=$1',[payment])).rows[0].status).toBe('CONFIRMED');
  });
  it('captures approved payments only once, then creates pending records without XML/tax guesses',async()=>{
    await service.save(owner,input,{});const id=await pay();await pg.query("update membership_payments set status='CONFIRMED' where id=$1",[id]);
    const svc=new FacturaService();await svc.collectCommittedPayments();await svc.collectCommittedPayments();await svc.processPending();
    const rows=(await pg.query<any>('select * from fiscal_invoices')).rows;expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({status:'PENDIENTE_INTEGRACION',authorization_number:null,access_key:null,xml_location:null,subtotal:null,tax_amount:null});
  });
  it('snapshots remain unchanged when current profile changes',async()=>{
    await service.save(owner,input,{});await pay();await service.save(owner,{...input,expectedRevision:1,billingEmail:'new@example.test'},{});
    await new FacturaService().collectCommittedPayments();expect((await pg.query<any>('select fiscal_snapshot from fiscal_invoices')).rows[0].fiscal_snapshot.billingEmail).toBe(input.billingEmail);
  });
  it('never invoices unverified commercial receipts',async()=>{
    await pg.query("insert into advertising_payments(advertiser_id,order_id,amount,status,settlement_status) values($1,$2,25,'RECEIVED','PENDING_RECONCILIATION')",[advertiserId,adOrder]);
    expect((await pg.query('select * from fiscal_billing_outbox')).rows).toHaveLength(0);
    await pg.exec("update advertising_payments set status='APPROVED',settlement_status='RECONCILED'");
    await new FacturaService().collectCommittedPayments();expect((await pg.query('select * from fiscal_invoices')).rows).toHaveLength(1);
  });
  it('deletion erases reusable profiles/links but preserves financial snapshots',async()=>{
    await service.save(owner,input,{});await pay();await new FacturaService().collectCommittedPayments();
    await pg.query('update users set deleted_at=now() where id=$1',[driverId]);
    expect((await pg.query('select * from fiscal_profiles')).rows).toHaveLength(0);expect((await pg.query('select * from fiscal_client_links')).rows).toHaveLength(0);
    expect((await pg.query('select * from fiscal_invoices')).rows).toHaveLength(1);expect((await service.forOwner(owner)).profile).toBeNull();
    await expect(service.save(owner,input,{})).rejects.toThrow('FISCAL_OWNER_NOT_FOUND');
  });
  it('a recreated account does not recover a prior fiscal profile',async()=>{
    await service.save(owner,input,{});await pg.query('update users set deleted_at=now() where id=$1',[driverId]);
    const newId='00000000-0000-4000-8000-000000000099';await pg.query('insert into users(id,full_name,email) values($1,$2,$3)',[newId,'Conductor','driver@example.test']);
    expect((await service.forOwner({type:'CONDUCTOR',id:newId})).profile).toBeNull();
  });
  it('a second membership renewal reuses the profile and creates a distinct payment document',async()=>{
    const profile=await service.save(owner,input,{});await pay();
    const next='00000000-0000-4000-8000-000000000077';
    await pg.query('insert into membership_payment_orders(id,driver_id) values($1,$2)',[next,driverId]);
    await requireOrderFiscalProfile(state.sql,'MEMBRESIA',next);
    await pg.query('insert into membership_payments(driver_id,order_id,amount) values($1,$2,12)',[driverId,next]);
    await new FacturaService().collectCommittedPayments();
    expect((await pg.query('select * from fiscal_profiles')).rows).toHaveLength(1);
    expect((await pg.query<any>('select fiscal_profile_id from membership_payments')).rows.every(p=>p.fiscal_profile_id===profile!.id)).toBe(true);
    expect((await pg.query('select * from fiscal_invoices')).rows).toHaveLength(2);
  });
  it('authorized totals cannot be fabricated and authorized credit notes stay immutable',async()=>{
    await service.save(owner,input,{});await pay();await new FacturaService().collectCommittedPayments();
    await expect(pg.exec("update fiscal_invoices set status='AUTORIZADA'")).rejects.toThrow();
    await pg.exec("insert into fiscal_credit_notes(invoice_id,external_reference,fiscal_snapshot,amount,status) select id,'TEST-CREDIT-ONLY',fiscal_snapshot,1,'AUTORIZADA' from fiscal_invoices");
    await expect(pg.exec('update fiscal_credit_notes set amount=2')).rejects.toThrow('AUTHORIZED_FISCAL_DOCUMENT_IMMUTABLE');
    await expect(pg.exec('delete from fiscal_credit_notes')).rejects.toThrow('AUTHORIZED_FISCAL_DOCUMENT_IMMUTABLE');
  });
  it('deletion retains paid and authorized historical metrics',async()=>{
    await service.save(owner,input,{});await pay();await new FacturaService().collectCommittedPayments();
    await pg.exec("update fiscal_invoices set status='AUTORIZADA',subtotal=12,tax_amount=0,document_number='TEST-ONLY',access_key='TEST-ONLY',authorization_number='TEST-ONLY',authorized_at=now()");
    const app=Fastify();await registerFiscalRoutes(app);
    const headers={authorization:`Bearer ${tokenFor({id:actorId,name:'Admin',email:'admin@example.test',role:'ADMIN'})}`};
    const before=(await app.inject({url:'/v1/admin/fiscal/dashboard',headers})).json();
    await pg.query('update users set deleted_at=now() where id=$1',[driverId]);
    const after=(await app.inject({url:'/v1/admin/fiscal/dashboard',headers})).json();
    expect(after.collected).toBe(before.collected);expect(after.invoiced).toBe(before.invoiced);expect(after.authorizedCount).toBe(before.authorizedCount);
    expect((await app.inject({url:'/v1/admin/fiscal/clients',headers})).json().items).toHaveLength(0);await app.close();
  });
  it('revoked driver sessions cannot create fiscal profiles',async()=>{
    const app=Fastify();await registerFiscalRoutes(app);
    const token=tokenFor({id:driverId,name:'Driver',email:'d@example.test',role:'DRIVER',sessionId});
    await pg.query('update users set active_session_id=null where id=$1',[driverId]);
    expect((await app.inject({method:'PUT',url:'/v1/driver/fiscal-profile',headers:{authorization:`Bearer ${token}`},payload:input})).statusCode).toBe(401);
    expect((await pg.query('select * from fiscal_profiles')).rows).toHaveLength(0);await app.close();
  });
  it('a commercial advisor cannot edit an unassigned or automatic-transfer order',async()=>{
    const app=Fastify();await registerFiscalRoutes(app);
    const headers={authorization:`Bearer ${tokenFor({id:actorId,name:'Advisor',email:'c@example.test',role:'COMMERCIAL'})}`},url=`/v1/admin/fiscal/context/advertising/${adOrder}`;
    expect((await app.inject({method:'PUT',url,headers,payload:input})).statusCode).toBe(400);
    await pg.query('update advertising_orders set assigned_commercial_id=$1 where id=$2',[actorId,adOrder]);
    expect((await app.inject({method:'PUT',url,headers,payload:input})).statusCode).toBe(200);
    const method='00000000-0000-4000-8000-000000000088';
    await pg.query("insert into advertising_payment_methods(id,code) values($1,'BANK_TRANSFER')",[method]);
    await pg.query('insert into advertising_payments(advertiser_id,order_id,payment_method_id,amount) values($1,$2,$3,25)',[advertiserId,adOrder,method]);
    expect((await app.inject({method:'PUT',url,headers,payload:input})).statusCode).toBe(400);await app.close();
  });
  it('deletion without a fiscal profile is harmless',async()=>{await expect(pg.query('update users set deleted_at=now() where id=$1',[driverId])).resolves.toBeDefined();});
  it('authorized documents cannot be edited or deleted',async()=>{
    await service.save(owner,input,{});await pay();await new FacturaService().collectCommittedPayments();
    // Test-only fixtures, never issued or sent to any authority.
    await pg.exec("update fiscal_invoices set status='AUTORIZADA',subtotal=12,tax_amount=0,document_number='TEST-ONLY',access_key='TEST-ONLY',authorization_number='TEST-ONLY',authorized_at=now()");
    await expect(pg.exec("update fiscal_invoices set total=1")).rejects.toThrow('AUTHORIZED_FISCAL_DOCUMENT_IMMUTABLE');
    await expect(pg.exec('delete from fiscal_invoices')).rejects.toThrow('AUTHORIZED_FISCAL_DOCUMENT_IMMUTABLE');
    await pg.query('update users set deleted_at=now() where id=$1',[driverId]);expect((await pg.query('select * from fiscal_invoices')).rows).toHaveLength(1);
  });
  it('disabled providers cannot call external services even with an accidental true flag',async()=>{
    vi.stubEnv('FACTURACION_ENABLED','true');for(const provider of [new DatilProvider(),new AzurProvider(),new SriProvider()]){
      expect(provider.configured).toBe(false);expect((await provider.emitirFactura({})).status).toBe('PENDIENTE_INTEGRACION');
      expect((await provider.obtenerXml('test')).status).toBe('PENDIENTE_INTEGRACION');
    }
  });
  it('a provider failure never changes an approved payment and retries with the same reference',async()=>{
    await service.save(owner,input,{});await pay();
    const emit=vi.fn(async(_invoice:any)=>{throw new Error('Test provider unavailable');});
    const provider={...new DatilProvider(),name:'DATIL',configured:true,emitirFactura:emit} as any;
    vi.stubEnv('FACTURACION_ENABLED','true');const svc=new FacturaService(provider);
    await svc.collectCommittedPayments();await svc.processPending();await svc.processPending();
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[0]?.[0].external_reference).toEqual(emit.mock.calls[1]?.[0].external_reference);
    expect((await pg.query<any>('select status from membership_payments')).rows[0].status).toBe('CONFIRMED');
    expect((await pg.query<any>('select status from fiscal_invoices')).rows[0].status).toBe('PENDIENTE_REINTENTO');
  });
  it('rolls back the local outbox when the business transaction rolls back',async()=>{
    await expect(pg.transaction(async tx=>{await tx.query('insert into membership_payments(driver_id,order_id,amount) values($1,$2,12)',[driverId,orderId]);throw new Error('activation failed');})).rejects.toThrow('activation failed');
    expect((await pg.query('select * from fiscal_billing_outbox')).rows).toHaveLength(0);
  });
  it('serves fiscal lists, dashboard and filtered payment details without a provider',async()=>{
    await service.save(owner,input,{});const payment=await pay();await new FacturaService().collectCommittedPayments();
    const app=Fastify();await registerFiscalRoutes(app);
    const headers={authorization:`Bearer ${tokenFor({id:actorId,name:'Admin',email:'admin@example.test',role:'ADMIN'})}`};
    for(const path of ['config','clients','invoices','payments','dashboard','options']){
      const res=await app.inject({url:`/v1/admin/fiscal/${path}`,headers});expect(res.json(),path).not.toHaveProperty('error');expect(res.statusCode,path).toBe(200);
    }
    const client=(await service.forOwner(owner)).clientId;
    for(const path of [`clients/${client}`,`clients/${client}/profile`,`payments?clientId=${client}&status=UNBILLED`,`invoices?status=PENDING_ALL`]){
      const res=await app.inject({url:`/v1/admin/fiscal/${path}`,headers});expect(res.json(),path).not.toHaveProperty('error');
    }
    expect((await app.inject({url:'/v1/admin/fiscal/payments?source=PUBLICIDAD',headers})).json().items).toHaveLength(0);
    expect((await app.inject({url:'/v1/admin/fiscal/payments?search=nonexistent',headers})).json().items).toHaveLength(0);
    await pg.query("update membership_payments set status='REVERSED' where id=$1",[payment]);
    expect((await app.inject({url:'/v1/admin/fiscal/payments?status=COLLECTED',headers})).json().items).toHaveLength(0);
    await app.close();
  });
  it('a collector needs an active assignment and cannot reuse a paid order for fiscal edits',async()=>{
    const point='00000000-0000-4000-8000-000000000010';
    await pg.query("insert into collection_points(id,status) values($1,'ACTIVE')",[point]);
    const headers={authorization:`Bearer ${tokenFor({id:actorId,name:'Collector',email:'c@example.test',role:'COLLECTOR'})}`};
    const app=Fastify();await registerFiscalRoutes(app);const url=`/v1/admin/fiscal/context/membership/${orderId}`;
    expect((await app.inject({url,headers})).statusCode).toBe(403);
    await pg.query("insert into collector_assignments(collector_id,collection_point_id,starts_at) values($1,$2,now()-interval '1 day')",[actorId,point]);
    expect((await app.inject({method:'PUT',url,headers,payload:input})).statusCode).toBe(200);
    await pg.query("update membership_payment_orders set status='PAID' where id=$1",[orderId]);
    expect((await app.inject({method:'PUT',url,headers,payload:input})).statusCode).toBe(400);
    await app.close();
  });
  it('reversed payments stop being collected income without rewriting issued documents',async()=>{
    const id=await pay();await pg.query("update membership_payments set status='REVERSED' where id=$1",[id]);
    expect((await pg.query<any>('select payment_reversed from fiscal_billing_outbox')).rows[0].payment_reversed).toBe(true);
  });
  it('fiscal validation rejects incomplete or malformed data',()=>{
    for(const change of [{identification:'123'},{identification:'0000000000'},{billingEmail:'bad'},{address:''},{legalName:''}])expect(fiscalProfileSchema.safeParse({...input,...change}).success).toBe(false);
  });
  it('separates paid amounts from authorized amounts and ignores reversed income',()=>{
    expect(summarizeFiscalRows([{amount:12,status:'PENDIENTE_INTEGRACION',invoiceId:'x'},{amount:10,reversed:true}])).toMatchObject({collected:12,invoiced:0,pendingAmount:12,invoiceCount:1});
    expect(summarizeFiscalRows([{amount:12,paidAt:'2026-08-29T01:00:00Z'},{amount:5,paidAt:'2026-08-28T22:00:00Z'},{amount:10,paidAt:'2026-08-29T01:00:00Z',reversed:true}]).collectedByDay).toEqual([{label:'2026-08-28',value:17}]);
    expect(fiscalFilterSchema.safeParse({start:'2026-09-01',end:'2026-08-01'}).success).toBe(false);
  });
  it('requires authentication for driver data and admin permissions for fiscal lists',async()=>{
    const app=Fastify();await registerFiscalRoutes(app);
    expect((await app.inject('/v1/driver/fiscal-profile')).statusCode).toBe(401);
    expect((await app.inject({url:'/v1/admin/fiscal/clients',headers:{authorization:`Bearer ${tokenFor({id:actorId,name:'Support',email:'s@example.test',role:'SUPPORT'})}`}})).statusCode).toBe(403);
    const token=tokenFor({id:driverId,name:'Driver',email:'driver@example.test',role:'DRIVER',sessionId});
    const res=await app.inject({url:'/v1/driver/fiscal-profile',headers:{authorization:`Bearer ${token}`}});expect(res.statusCode).toBe(200);expect(res.json().profile).toBeNull();await app.close();
  });
  it('a secure commercial token can save only its associated profile and expires on submission',async()=>{
    const token='a'.repeat(43),hash=createHash('sha256').update(`${process.env.ADMIN_SESSION_SECRET??'costa-go-local-development'}:advertising-payment-upload:${token}`).digest('hex');
    await pg.query("insert into advertising_payment_upload_tokens(order_id,token_hash,status,expires_at) values($1,$2,'OPENED',now()+interval '1 day')",[adOrder,hash]);
    const app=Fastify();await registerFiscalRoutes(app);
    const path=`/v1/public/advertising/payment-proof/${token}/fiscal-profile`;
    const res=await app.inject({method:'PUT',url:path,payload:input});expect(res.statusCode).toBe(200);expect((await service.forOwner(owner)).profile).toBeNull();
    await pg.exec("update advertising_payment_upload_tokens set status='SUBMITTED'");expect((await app.inject(path)).statusCode).toBe(400);await app.close();
  });
});
