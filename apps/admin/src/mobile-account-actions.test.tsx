import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {MobileAccountActions} from './mobile-account-actions';

const account={id:'00000000-0000-4000-8000-000000000001',name:'Prueba',email:'prueba@example.com',phone:'0991234567',approvalStatus:'PENDIENTE_DOCUMENTOS'};
const onChanged=async()=>{};
describe('acciones administrativas de identidad',()=>{
  it('no muestra acciones sin permisos',()=>{
    expect(renderToStaticMarkup(<MobileAccountActions token="test" account={account} canEdit={false} onChanged={onChanged}/>)).toBe('');
  });
  it('permite corregir pasajeros pero no ofrece baja de conductor',()=>{
    const html=renderToStaticMarkup(<MobileAccountActions token="test" account={{...account,approvalStatus:undefined}} canEdit canDelete onChanged={onChanged}/>);
    expect(html).toContain('Editar datos');expect(html).not.toContain('Eliminar registro incompleto');
  });
  it('ofrece baja únicamente si nunca se aprobó el registro',()=>{
    expect(renderToStaticMarkup(<MobileAccountActions token="test" account={account} canEdit canDelete onChanged={onChanged}/>)).toContain('Eliminar registro incompleto');
    expect(renderToStaticMarkup(<MobileAccountActions token="test" account={{...account,approvedAt:'2026-08-01',approvalStatus:'RECHAZADO'}} canEdit canDelete onChanged={onChanged}/>)).not.toContain('Eliminar registro incompleto');
  });
});
