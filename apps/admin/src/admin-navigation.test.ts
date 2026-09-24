import {describe,expect,it} from 'vitest';
import {modulePermissions,resolvedAdminModule,visibleAdminModules} from './admin-navigation.js';
import {visibleNotificationTabs} from './notifications-admin.js';

describe('navegación administrativa RBAC',()=>{
  it('separa campañas Costa-Go de publicidad pagada y notificaciones',()=>{
    const modules=Object.keys(modulePermissions);
    expect(visibleAdminModules(modules,p=>['commercial:campaigns:view','notification_campaigns:view'].includes(p))).not.toContain('costaCampaigns');
    expect(visibleAdminModules(modules,p=>p==='costa_campaigns:view')).toEqual(['costaCampaigns','home']);
  });
  const modules=Object.keys(modulePermissions);
  it('oculta módulos sin permiso y rechaza URL directa',()=>{
    const permissions=new Set(['drivers:view','memberships:view','FACTURACION_VER','incidents:view',
      'commercial:campaigns:view','advertising:view']);
    const visible=visibleAdminModules(modules,p=>permissions.has(p));
    for(const module of ['drivers','memberships','fiscal','incidents','commercial','advertising'])
      expect(visible).toContain(module);
    for(const module of ['access','settings','pricing','zones','database','audit']){
      expect(visible).not.toContain(module);
      expect(resolvedAdminModule(module,visible)).toBe('home');
    }
    expect(resolvedAdminModule('drivers',visible)).toBe('drivers');
  });
  it('permite gestionar campañas sin exponer la configuración técnica de notificaciones',()=>{
    const permissions=new Set(['notification_campaigns:view','notification_campaigns:manage']);
    expect(visibleAdminModules(modules,p=>permissions.has(p))).toContain('notifications');
    expect(visibleNotificationTabs([...permissions].map(String)).map(([id])=>id)).toEqual(['campaigns']);
  });
});
