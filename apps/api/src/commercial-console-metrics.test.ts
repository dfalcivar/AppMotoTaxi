import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,it,expect} from 'vitest';

// Execute the production dashboard SQL, not a mock result, against an isolated database.
let pg:PGlite,query:string;
const actor='00000000-0000-4000-8000-000000000001';
beforeAll(async()=>{
  pg=new PGlite();
  const source=await readFile(resolve(process.cwd(),'src/commercial.ts'),'utf8');
  query=source.split('const [row] = await database()`with scoped_orders as (')[1]!.split('`;')[0]!;
  query='with scoped_orders as ('+query;
  await pg.exec(`create table advertising_orders(id int,lead_id int,advertiser_id int,assigned_commercial_id uuid,status text,amount numeric,created_at timestamptz default now(),updated_at timestamptz default now());
    create table advertising_leads(id int,status text,assigned_commercial_id uuid,created_by uuid);
    create table advertising_payments(order_id int,payment_method_id int,created_at timestamptz default now());
    create table advertising_payment_methods(id int,code text);
    create table affiliate_banners(order_id int,campaign_status text);
    create table advertisers(id int,status text,assigned_commercial_id uuid);
    insert into advertising_payment_methods values(1,'COMMERCIAL_MANAGED'),(2,'BANK_TRANSFER');
    insert into advertising_leads values(1,'NEW','${actor}',null),(2,'REQUIRES_CONTACT','${actor}',null),(3,'NEW',null,null);
    insert into advertising_orders(id,lead_id,advertiser_id,assigned_commercial_id,status,amount) values
      (1,1,1,'${actor}','PAID',25),(2,2,2,'${actor}','PENDING_PAYMENT',30),(3,3,3,null,'PENDING_PAYMENT',10);
    insert into advertising_payments(order_id,payment_method_id) values(1,1),(2,2),(3,1);
    insert into affiliate_banners values(1,'ACTIVE'),(2,'PAYMENT_REVIEW'),(null,'ACTIVE');
    insert into advertisers values(1,'ACTIVE','${actor}'),(2,'ACTIVE','${actor}'),(3,'ACTIVE',null);`);
});
afterAll(async()=>{await pg.close();});
async function dashboard(own:boolean){const values:unknown[]=[];const text=query.replace(/\$\{(own|actorId)\}/g,(_,key)=>{values.push(key==='own'?own:actor);return '$'+values.length;});return (await pg.query<Record<string,number>>(text,values)).rows[0]!;}
it('excludes institutional banners from paid commercial campaign metrics',async()=>{
  const data=await dashboard(false);expect(data.activeCampaigns).toBe(1);expect(data.pendingCampaigns).toBe(1);expect(data.openOrders).toBe(2);expect(data.monthlySales).toBe(25);
});
it('uses the same advisor ownership and transfer exclusions as the list',async()=>{
  const data=await dashboard(true);expect(data.activeAdvertisers).toBe(1);expect(data.requiresContact).toBe(0);expect(data.newLeads).toBe(2);expect(data.openOrders).toBe(0);expect(data.monthlySales).toBe(25);
});
