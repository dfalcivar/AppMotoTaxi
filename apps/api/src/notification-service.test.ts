import {describe,expect,it} from 'vitest';
import {notificationRouteForCommand} from './notification-service.js';
describe('rutas de notificación',()=>{
  it('abre Membresía Costa-Go para cualquier evento de membresía',()=>{
    expect(notificationRouteForCommand('MEMBERSHIP_ACTIVATED','costa-go://membership')).toBe('MEMBERSHIP');
    expect(notificationRouteForCommand('membership_expiring')).toBe('MEMBERSHIP');
  });
});
