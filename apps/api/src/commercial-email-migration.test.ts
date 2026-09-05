import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {expect,it} from 'vitest';

it('crea eventos comerciales apagados y evita duplicados reales',async()=>{
  const pg=new PGlite();
  try{
    await pg.exec(`
      create table users(id uuid primary key);
      create table advertisers(id uuid primary key);
      create table affiliate_banners(id uuid primary key);
      create table operational_settings(id smallint primary key);
      insert into operational_settings(id) values(1);
    `);
    const migration=await readFile(new URL('../migrations/086_commercial_email_notifications.sql',import.meta.url),'utf8');
    await pg.exec(migration);
    const result=await pg.query(`select event_type,enabled,channels from notification_event_definitions order by event_type`);
    expect(result.rows).toHaveLength(4);
    expect(result.rows.every((row:any)=>row.enabled===false&&row.channels.includes('EMAIL'))).toBe(true);
    await pg.exec(`insert into affiliate_banners(id) values('00000000-0000-4000-8000-000000000001');
      insert into notification_email_deliveries(event_type,campaign_id,recipient_email,subject,period_key)
      values('CAMPAIGN_EXPIRED','00000000-0000-4000-8000-000000000001','a@example.com','A','FINAL');`);
    await expect(pg.exec(`insert into notification_email_deliveries(event_type,campaign_id,recipient_email,subject,period_key)
      values('CAMPAIGN_EXPIRED','00000000-0000-4000-8000-000000000001','a@example.com','A','FINAL');`)).rejects.toThrow();
    await pg.exec(`insert into notification_email_deliveries(event_type,campaign_id,recipient_email,subject,period_key,is_test,status)
      values('CAMPAIGN_EXPIRED','00000000-0000-4000-8000-000000000001','a@example.com','A','FINAL',true,'TEST');`);
  }finally{await pg.close();}
},30_000);
