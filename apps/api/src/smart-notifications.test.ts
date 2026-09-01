import {describe,expect,it} from 'vitest';
import {smartModeReasons} from './smart-notifications.js';

describe('modo seguro de notificaciones SMART',()=>{
  it('OFF analiza pero bloquea todo envío SMART',()=>{
    expect(smartModeReasons('OFF',true)).toEqual(['SMART_MODE_OFF']);
  });
  it('TEST admite únicamente usuarios de la whitelist',()=>{
    expect(smartModeReasons('TEST',false)).toEqual(['TEST_USER_NOT_ALLOWED']);
    expect(smartModeReasons('TEST',true)).toEqual([]);
  });
  it('ON deja la decisión a las reglas individuales de elegibilidad',()=>{
    expect(smartModeReasons('ON',false)).toEqual([]);
  });
});
