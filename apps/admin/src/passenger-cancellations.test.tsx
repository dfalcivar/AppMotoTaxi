import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PassengerCancellationSummaryCard, type CancellationSummary } from './passenger-cancellations';

const summary:CancellationSummary={cycleCount:2,historicalTotal:14,threshold:3,nextThreshold:3,
  cycleActive:true,cycleStartsAt:'2026-09-10T15:00:00Z',cycleEndsAt:'2026-10-10T15:00:00Z',
  cycleDurationDays:30,configuredDurationDays:60,enforcementEnabled:true,state:'WARNING',suspendedUntil:null};
describe('resumen de cancelaciones del pasajero',()=>{
  it('distingue contador de ciclo, histórico y umbral con fechas en español',()=>{
    const html=renderToStaticMarkup(<PassengerCancellationSummaryCard summary={summary}/>);
    expect(html).toContain('Cancelaciones del ciclo actual');expect(html).toContain('<dd>2</dd>');
    expect(html).toContain('Cancelaciones históricas totales');expect(html).toContain('<dd>14</dd>');
    expect(html).toContain('Advertencia');expect(html).toContain('30 días');
    expect(html).toContain('10/9/2026');expect(html).toContain('Siguiente penalización: n.º 3');
  });
  it('ciclo vencido muestra cero y conserva suspensión indefinida',()=>{
    const html=renderToStaticMarkup(<PassengerCancellationSummaryCard summary={{...summary,cycleCount:0,cycleActive:false,state:'INDEFINITE'}}/>);
    expect(html).toContain('<dd>0</dd>');expect(html).toContain('Suspensión indefinida');
    expect(html).toContain('Sin ciclo vigente');expect(html).toContain('ciclo de 60 días');
    expect(html).toContain('<dd>14</dd>');expect(html).not.toContain('10/9/2026');
  });
  it('no presenta controles para borrar el historial',()=>{
    const html=renderToStaticMarkup(<PassengerCancellationSummaryCard summary={summary}/>);
    expect(html).not.toContain('<button');expect(html).toContain('nunca se reinicia');
  });
});
