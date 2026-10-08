import {describe,expect,it} from 'vitest';
import {notificationRouteForCommand} from './notification-service.js';
describe('rutas de notificación',()=>{
  it('abre Membresía Costa-Go para cualquier evento de membresía',()=>{
    expect(notificationRouteForCommand('MEMBERSHIP_ACTIVATED','costa-go://membership')).toBe('MEMBERSHIP');
    expect(notificationRouteForCommand('membership_expiring')).toBe('MEMBERSHIP');
  });
  it('envía tutoriales oficiales al Centro de ayuda sin desviar otras notificaciones',()=>{
    expect(notificationRouteForCommand('CAMPAIGN','https://costa-go.com/ayuda/vincular-mototaxi')).toBe('HELP_ARTICLE');
    expect(notificationRouteForCommand('CAMPAIGN','https://otro-sitio.com/ayuda/vincular-mototaxi')).toBe('NOTIFICATIONS');
    expect(notificationRouteForCommand('CAMPAIGN','https://costa-go.com/ayuda/vincular-mototaxi?x=1')).toBe('NOTIFICATIONS');
  });
});
