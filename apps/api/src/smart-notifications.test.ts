import {describe,expect,it} from 'vitest';
import {compareAppVersions,smartModeReasons} from './smart-notifications.js';

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

describe('comparación de versiones instaladas',()=>{
  it('compara cada componente numérico sin tratar 0.10 como decimal',()=>{
    expect(compareAppVersions('0.17.5','0.17.5')).toBe(0);
    expect(compareAppVersions('0.17.6','0.17.5')).toBe(1);
    expect(compareAppVersions('0.9.9','0.10.0')).toBe(-1);
    expect(compareAppVersions('1.0','1.0.0')).toBe(0);
  });
});
