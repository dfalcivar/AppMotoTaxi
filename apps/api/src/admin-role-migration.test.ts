import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {allPermissions} from './permissions.js';

describe('migración de roles configurables',()=>{
  it('conserva usuarios y siembra Gestión Operativa sin permisos críticos',async()=>{
    const pg=new PGlite();try{
      await pg.exec(`create table users(id uuid primary key,role text not null);
        insert into users values('00000000-0000-4000-8000-000000000001','ADMIN');`);
      const migration=await readFile(resolve('migrations/099_configurable_admin_roles.sql'),'utf8');
      await pg.exec(migration);
      const users=await pg.query<{role:string;admin_custom_role_id:string|null}>(
        'select role,admin_custom_role_id from users');
      expect(users.rows).toEqual([{role:'ADMIN',admin_custom_role_id:null}]);
      const result=await pg.query<{permission:string}>(`select p.permission from admin_custom_role_permissions p
        join admin_custom_roles r on r.id=p.role_id where r.name='Gestión Operativa'`);
      const permissions=result.rows.map(row=>row.permission);
      expect(permissions.length).toBeGreaterThan(35);
      expect(permissions.every(permission=>(allPermissions as readonly string[]).includes(permission))).toBe(true);
      for(const permission of ['drivers:approve','memberships:manage','FACTURACION_VER','incidents:manage',
        'commercial:campaigns:review'])expect(permissions).toContain(permission);
      for(const permission of ['roles:manage','users:manage','settings:manage','pricing:manage','zones:manage',
        'FACTURACION_NOTA_CREDITO'])expect(permissions).not.toContain(permission);
    }finally{await pg.close();}
  });
});
