import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CancellationPolicyOverview, CancellationPolicyFields, PassengerCancellationSummaryCard, type CancellationSummary, type Policy } from './passenger-cancellations';

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

describe('presentación de la política de cancelaciones',()=>{
  const policy:Policy={enabled:true,cycleDurationDays:60,steps:[{fromCount:1,suspensionDays:0},{fromCount:3,suspensionDays:2},{fromCount:4,suspensionDays:5},{fromCount:5,suspensionDays:7},{fromCount:6,suspensionDays:null}]};
  it('presenta rangos completos y duración dinámica sin confundir advertencias con suspensiones',()=>{
    const html=renderToStaticMarkup(<CancellationPolicyOverview policy={policy}/>);
    expect(html).toContain('60 días');expect(html).toContain('Control activo');
    expect(html).toContain('Cancelaciones 1–2');expect(html).toContain('Cancelación 3');
    expect(html).toContain('Cancelación 6 o más');expect(html).toContain('Suspensión indefinida');
    expect(html).toContain('Primera cancelación penalizable');
  });
  it('distingue el control desactivado sin ocultar las reglas configuradas',()=>{
    const html=renderToStaticMarkup(<CancellationPolicyOverview policy={{...policy,enabled:false}}/>);
    expect(html).toContain('Solo registro');expect(html).not.toContain('Control activo');
    expect(html).toContain('2 días de suspensión');
  });
  it('mantiene campos, límites y solo lectura en el editor',()=>{
    const html=renderToStaticMarkup(<CancellationPolicyFields draft={policy} disabled onChange={()=>{}}/>);
    expect(html).toContain('disabled=""');expect(html).toContain('role="switch"');
    expect(html).toContain('value="60"');expect(html).toContain('max="3650"');
    expect(html).toContain('aria-label="Rango 5"');expect(html).toContain('Quitar rango 5');
    expect(html).toContain('0 días = solo advertencia');
    expect(html).toContain('Sin fecha de finalización');expect(html).toContain('Agregar rango');
  });
});
