import {describe,it,expect} from 'vitest';
import {applyBenefitTypeTemplate,benefitSaveBody} from './costa-go-benefits';

const response={id:'benefit-id',version:3,code:'WELCOME',name:'Bienvenida',description:'Cortesía',benefitType:'COURTESY_DAYS',value:7,expirationDays:null,audience:'DRIVER',oneTime:true,requiresActivation:true,startsAt:'2026-09-01T00:00:00Z',endsAt:'2026-10-01T00:00:00Z',maxGlobal:null,maxPerUser:1,status:'DRAFT',zoneIds:['zone-id'],valueLabel:'7 días gratis',typeLabel:'de membresía',redemptions:2,totalGranted:14,futureServerField:'read-only'};

describe('benefit save request',()=>{
 it('activates a draft from an API response without submitting display fields or counters',()=>{
  const body=JSON.parse(JSON.stringify(benefitSaveBody({...response,status:'ACTIVE'})));
  expect(body).toEqual({code:response.code,name:response.name,description:response.description,benefitType:response.benefitType,value:7,expirationDays:null,audience:'DRIVER',oneTime:true,requiresActivation:true,startsAt:response.startsAt,endsAt:response.endsAt,maxGlobal:null,maxPerUser:1,status:'ACTIVE',zoneIds:['zone-id'],version:3});
 });
 it('creates without an update version and preserves nullable limits',()=>{
  const body=benefitSaveBody({...response,id:undefined,oneTime:false,maxPerUser:null});
  expect(body).not.toHaveProperty('version');
  expect(body).not.toHaveProperty('code');
  expect(body).not.toHaveProperty('valueLabel');
  expect(body).not.toHaveProperty('typeLabel');
  expect(body.maxPerUser).toBeNull();
  expect(body.status).toBe('DRAFT');
 });
 it('loads a free-trip template when the type changes without reusing a courtesy code',()=>{
  const form=applyBenefitTypeTemplate({...response,id:undefined,code:undefined},'FREE_TRIPS');
  expect(form).toMatchObject({benefitType:'FREE_TRIPS',name:'Viajes sin comisión Costa-Go',value:80,audience:'DRIVER',requiresActivation:true,expirationDays:30,status:'DRAFT'});
  expect(form.description).toContain('El pasajero paga');
  expect(benefitSaveBody(form)).not.toHaveProperty('code');
 });
});
