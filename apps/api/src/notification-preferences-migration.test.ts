import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {expect,it} from 'vitest';

it('agrega preferencias sin volver opcionales las alertas críticas',async()=>{
  const pg=new PGlite();
  try{
    await pg.exec(`
      create table users(id uuid primary key);
      create table user_notifications(id uuid primary key default gen_random_uuid(),category text not null default 'TRANSACTIONAL');
      alter table user_notifications add constraint user_notifications_category_check check(category in ('TRANSACTIONAL','OPERATIONAL','SMART','CAMPAIGN','PROMOTIONAL'));
      create table smart_notification_config(id smallint primary key);
      create table operational_settings(id integer primary key);
      insert into smart_notification_config values(1);
      insert into operational_settings values(1);
      insert into users values('00000000-0000-4000-8000-000000000001');
    `);
    const migration=await readFile(new URL('../migrations/081_notification_preferences.sql',import.meta.url),'utf8');
    await pg.exec(migration);
    await pg.exec(`insert into user_notification_preferences(user_id,context,preference_key,enabled,state)
      values('00000000-0000-4000-8000-000000000001','PASSENGER','PASSENGER_SMART_RECOMMENDATIONS',false,'USER_DISABLED')`);
    const [preference]=(await pg.query(`select enabled,state,modified_source from user_notification_preferences`)).rows as any[];
    const [config]=(await pg.query(`select max_per_user_per_week,ignored_to_pause,auto_pause_days from smart_notification_config`)).rows as any[];
    expect(preference).toMatchObject({enabled:false,state:'USER_DISABLED',modified_source:'USER'});
    expect(config).toMatchObject({max_per_user_per_week:3,ignored_to_pause:5,auto_pause_days:15});
    await expect(pg.exec(`insert into user_notification_preferences(user_id,context,preference_key,enabled,state)
      values('00000000-0000-4000-8000-000000000001','PASSENGER','PROMOTIONAL_NOTIFICATIONS',true,'ENABLED')`)).rejects.toThrow();
    await pg.exec(`insert into user_notifications(category) values('SYSTEM'),('REMINDER')`);
  }finally{await pg.close();}
},30_000);
