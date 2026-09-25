import {describe,it,expect} from 'vitest';
import {benefitPresentation} from './benefit-presentation.js';
describe('public benefit copy',()=>{
 it.each([
 ['COURTESY_DAYS',15,'15 días gratis','de membresía'],
 ['COURTESY_DAYS',1,'1 día gratis','de membresía'],
 ['PROMOTIONAL_BALANCE',3,'$3.00','de saldo promocional'],
 ['FIXED_DISCOUNT',0.5,'$0.50','de descuento'],
 ['PERCENTAGE_DISCOUNT',10,'10%','de descuento'],
 ['FREE_TRIPS',2,'2 viajes','sin comisión Costa-Go'],
 ['FREE_TRIPS',1,'1 viaje','sin comisión Costa-Go'],
 ])('%s uses the configured value', (type,value,valueLabel,typeLabel)=>{
 expect(benefitPresentation(type as string,value as number)).toEqual({valueLabel,typeLabel});
 });
 it('unknown types never expose internal names',()=>{
 expect(benefitPresentation('PRIVATE_CODE',123)).toEqual({valueLabel:'Tu beneficio',typeLabel:''});
 });
});
