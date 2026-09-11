import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { describe,expect,it } from 'vitest';

describe('catálogo móvil de membresías',()=>{
  it('mantiene los planes activos y les asigna visibilidad y orden independientes',async()=>{
    const pg=new PGlite();
    try{
      await pg.exec(`create table membership_plans(
        id uuid primary key default gen_random_uuid(),plan_type text not null,name text not null,
        version integer not null,duration_days integer not null,included_trips integer not null,
        enabled boolean not null default true,effective_until timestamptz
      );
      insert into membership_plans(plan_type,name,version,duration_days,included_trips) values
        ('PERIODIC','Anual',1,365,1000),('PERIODIC','Mensual',1,30,80),
        ('TRIP_PACK','50 viajes',1,30,50),('TRIP_PACK','10 viajes',1,30,10);`);
      await pg.exec(await readFile(new URL('../migrations/095_membership_mobile_catalog.sql',import.meta.url),'utf8'));
      expect((await pg.query<any>(`select plan_type as type,name,mobile_visible as visible,mobile_sort_order as "order"
        from membership_plans order by plan_type,mobile_sort_order`)).rows).toEqual([
          {type:'PERIODIC',name:'Mensual',visible:true,order:0},
          {type:'PERIODIC',name:'Anual',visible:true,order:1},
          {type:'TRIP_PACK',name:'10 viajes',visible:true,order:0},
          {type:'TRIP_PACK',name:'50 viajes',visible:true,order:1}
        ]);
      await pg.exec("update membership_plans set mobile_visible=false where name='Mensual'");
      expect((await pg.query<any>("select enabled,mobile_visible as visible from membership_plans where name='Mensual'")).rows[0])
        .toEqual({enabled:true,visible:false});
    }finally{await pg.close();}
  },30_000);

  it('filtra, ordena y administra la publicación móvil desde backend',async()=>{
    const source=await readFile(new URL('./memberships.ts',import.meta.url),'utf8');
    expect(source).toContain('enabled=true and mobile_visible=true');
    expect(source).toContain('order by case when plan_type=\'PERIODIC\' then 0 else 1 end,mobile_sort_order,name,id');
    expect(source).toContain('/v1/admin/membership-plans/:planId/mobile-visibility');
    expect(source).toContain('/v1/admin/membership-plans/mobile-order');
  });
});
