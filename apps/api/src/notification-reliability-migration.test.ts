import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {expect,it} from 'vitest';

it('aplica la evolución durable sin perder notificaciones ni tokens existentes',async()=>{
  const pg=new PGlite();
  try{
    await pg.exec(`
      create table users(id uuid primary key,active_session_id uuid);
      create table trips(id uuid primary key);
      create table favorite_places(id uuid primary key,user_id uuid references users(id));
      create table operational_settings(id smallint primary key,updated_by uuid references users(id),updated_at timestamptz default now());
      insert into operational_settings(id) values(1);
      create table user_notifications(id uuid primary key default gen_random_uuid(),user_id uuid not null references users(id),title text not null,message text not null,notification_type text not null,event_key text,data jsonb not null default '{}',read_at timestamptz,created_at timestamptz not null default now());
      create unique index user_notifications_user_event_unique on user_notifications(user_id,event_key) where event_key is not null;
      create table device_tokens(id uuid primary key default gen_random_uuid(),user_id uuid references users(id),token text unique,platform text,last_seen_at timestamptz default now(),created_at timestamptz default now());
      insert into users(id) values('00000000-0000-4000-8000-000000000001');
      insert into user_notifications(user_id,title,message,notification_type,event_key) values('00000000-0000-4000-8000-000000000001','Viaje','En camino','DRIVER_EN_ROUTE','keep-me');
      insert into device_tokens(user_id,token,platform) values('00000000-0000-4000-8000-000000000001','existing-token','ANDROID');
    `);
    for(const name of ['029_push_delivery_events.sql','079_smart_notifications.sql','080_app_update_campaigns.sql','081_notification_preferences.sql','084_notification_reliability.sql']){
      await pg.exec(await readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
    }
    const [notification]=(await pg.query<any>(`select event_key,priority,status from user_notifications where event_key='keep-me'`)).rows;
    const [token]=(await pg.query<any>(`select token,permission_status from device_tokens where token='existing-token'`)).rows;
    expect(notification).toMatchObject({event_key:'keep-me',priority:'OPERATIONAL',status:'CREATED'});
    expect(token).toMatchObject({token:'existing-token',permission_status:'UNKNOWN'});
    expect((await pg.query(`select * from notification_delivery_config`)).rows).toHaveLength(1);
  }finally{await pg.close();}
},30_000);
