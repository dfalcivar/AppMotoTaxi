import {describe,expect,it} from 'vitest';
import {membershipActivationPresentation} from './membership-activation.js';

describe('confirmación de membresía activa',()=>{
  it('presenta el plan periódico con desglose y acceso a la membresía',()=>{
    const result=membershipActivationPresentation({
      userId:'user',email:'driver@example.com',name:'David',plan:{name:'Mensual',durationDays:30},
      planType:'PERIODIC',startsAt:'2026-09-04T12:00:00Z',expiresAt:'2026-10-04T12:00:00Z',
      paymentId:'payment',membershipId:'membership',code:'ABC123',subtotal:12,vatRate:15,vat:1.8,
      total:13.8,currency:'USD',invoiceNumber:'001-001-1',hasDocument:true
    });
    expect(result.title).toBe('✅ Membresía activada');
    expect(result.body).toContain('Mensual');
    expect(result.emailHtml).toContain('Tu membresía Costa-Go está activa');
    expect(result.emailHtml).toContain('USD 13.80');
    expect(result.emailHtml).toContain('Ver factura');
  });

  it('explica la vigencia de un paquete sin fecha',()=>{
    const result=membershipActivationPresentation({
      userId:'user',email:null,name:'David',plan:{name:'Paquete 25',purchasedTrips:25},planType:'TRIP_PACK',
      startsAt:'2026-09-04T12:00:00Z',expiresAt:null,paymentId:'payment',membershipId:'membership',code:'ABC123',
      subtotal:5,vatRate:15,vat:.75,total:5.75,currency:'USD',invoiceNumber:null,hasDocument:false
    });
    expect(result.validity).toBe('25 viajes');
    expect(result.expiry).toBe('Hasta agotar los viajes');
  });
});
