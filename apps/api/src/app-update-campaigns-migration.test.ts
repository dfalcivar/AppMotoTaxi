import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {expect,it} from 'vitest';

it('agrega APP_UPDATE y deja REQUIRED desactivado',async()=>{
  const pg=new PGlite();
  try{
    await pg.exec(`
      create table users(id uuid primary key);
      create table device_tokens(user_id uuid references users(id),token text primary key,platform text,last_seen_at timestamptz,enabled boolean default true,invalidated_at timestamptz);
      create table notification_campaigns(id uuid primary key default gen_random_uuid(),campaign_type text not null check(campaign_type in ('CAMPAIGN','EVENT','PROMOTIONAL')));
      create table user_notifications(id uuid primary key default gen_random_uuid(),user_id uuid references users(id));
      create table notification_analytics_events(id bigserial primary key,notification_id uuid references user_notifications(id),user_id uuid references users(id),event text not null check(event in ('CREATED','SENT','FAILED','OPENED','DEEP_LINK_OPENED','TRIP_PREPARATION_OPENED','TRIP_REQUESTED','TRIP_COMPLETED')),occurred_at timestamptz default now(),metadata jsonb default '{}');
    `);
    const migration=await readFile(new URL('../migrations/080_app_update_campaigns.sql',import.meta.url),'utf8');
    await pg.exec(migration);
    await pg.exec(`insert into notification_campaigns(campaign_type) values ('APP_UPDATE')`);
    const rows=(await pg.query(`select platform,update_policy,required_update_enabled,store_url from app_version_config order by platform`)).rows as Array<Record<string,unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows.every(row=>row.update_policy==='RECOMMENDED'&&row.required_update_enabled===false)).toBe(true);
    expect(rows.find(row=>row.platform==='ANDROID')?.store_url).toContain('play.google.com');
  }finally{await pg.close();}
},30_000);
