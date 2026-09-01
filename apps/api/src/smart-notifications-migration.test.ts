import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {expect,it} from 'vitest';

it('extiende el centro existente sin perder datos y deja SMART apagado',async()=>{
  const pg=new PGlite();
  try{
    await pg.exec(`
      create table users(id uuid primary key);
      create table favorite_places(id uuid primary key,user_id uuid references users(id));
      create table user_notifications(
        id uuid primary key default gen_random_uuid(),user_id uuid not null references users(id),
        title text not null,message text not null,notification_type text not null,event_key text,data jsonb not null default '{}',
        read_at timestamptz,created_at timestamptz not null default now()
      );
      create unique index user_notifications_user_event_unique on user_notifications(user_id,event_key) where event_key is not null;
      create table device_tokens(user_id uuid references users(id),token text primary key,platform text,last_seen_at timestamptz not null default now());
      insert into users(id) values ('00000000-0000-4000-8000-000000000001');
      insert into user_notifications(user_id,title,message,notification_type,event_key)
      values ('00000000-0000-4000-8000-000000000001','Conductor llegó','Ya está en el origen','DRIVER_ARRIVED','existing-event');
      insert into device_tokens(user_id,token,platform) values ('00000000-0000-4000-8000-000000000001','existing-token','ANDROID');
    `);
    const migration=await readFile(new URL('../migrations/079_smart_notifications.sql',import.meta.url),'utf8');
    await pg.exec(migration);
    const [config]=(await pg.query(`select mode from smart_notification_config where id=1`)).rows as Array<{mode:string}>;
    const [notification]=(await pg.query(`select notification_type,category,priority from user_notifications where event_key='existing-event'`)).rows as Array<Record<string,unknown>>;
    const [token]=(await pg.query(`select token,enabled,invalidated_at from device_tokens where token='existing-token'`)).rows as Array<Record<string,unknown>>;
    expect(config?.mode).toBe('OFF');
    expect(notification).toMatchObject({notification_type:'DRIVER_ARRIVED',category:'TRANSACTIONAL',priority:'HIGH'});
    expect(token).toMatchObject({token:'existing-token',enabled:true,invalidated_at:null});
    await expect(pg.exec(`insert into user_notifications(user_id,title,message,notification_type,idempotency_key) values
      ('00000000-0000-4000-8000-000000000001','A','A','SMART_FREQUENT_TRIP','same-key'),
      ('00000000-0000-4000-8000-000000000001','B','B','SMART_FREQUENT_TRIP','same-key')`)).rejects.toThrow();
  }finally{await pg.close();}
},30_000);
