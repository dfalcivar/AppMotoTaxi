import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { earningsRangeSchema, earningsTotals } from './driver-earnings.js';

describe('ganancias y comisiones del conductor', () => {
  it('valida rangos con zona horaria, orden y límite', () => {
    expect(earningsRangeSchema.safeParse({
      from: '2026-09-14T00:00:00-05:00',
      to: '2026-09-15T00:00:00-05:00'
    }).success).toBe(true);
    expect(earningsRangeSchema.safeParse({
      from: '2026-09-15T00:00:00-05:00',
      to: '2026-09-14T00:00:00-05:00'
    }).success).toBe(false);
    expect(earningsRangeSchema.safeParse({
      from: '2025-01-01T00:00:00-05:00',
      to: '2026-09-14T00:00:00-05:00'
    }).success).toBe(false);
  });

  it('mantiene dos decimales para cero, un viaje y varios viajes', () => {
    expect(earningsTotals(0, 0, 0)).toEqual({
      grossTripIncome: '0.00', costaGoCommission: '0.00',
      netEarnings: '0.00', averagePerTrip: '0.00'
    });
    expect(earningsTotals(1, '1.50', '0.10')).toMatchObject({
      netEarnings: '1.40', averagePerTrip: '1.50'
    });
    expect(earningsTotals(3, '4.75', '0.25')).toEqual({
      grossTripIncome: '4.75', costaGoCommission: '0.25',
      netEarnings: '4.50', averagePerTrip: '1.58'
    });
  });

  it('protege ambos endpoints sin aceptar un driverId del cliente', async () => {
    const app = await buildApp();
    try {
      const query = '?from=2026-09-14T00%3A00%3A00-05%3A00&to=2026-09-15T00%3A00%3A00-05%3A00&driverId=00000000-0000-4000-8000-000000000001';
      expect((await app.inject(`/v1/driver/earnings/summary${query}`)).statusCode).toBe(401);
      expect((await app.inject(`/v1/driver/earnings/movements${query}`)).statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('consulta únicamente viajes completados del conductor autenticado y usa importes persistidos', async () => {
    const source = await readFile(new URL('./driver-earnings.ts', import.meta.url), 'utf8');
    expect(source).toContain("t.driver_id=${user.id!} and t.status='COMPLETED'");
    expect(source).toContain('coalesce(t.final_total_cents,t.quoted_total_cents)');
    expect(source).toContain("snapshot->>'appliedCommission'");
    expect(source).not.toMatch(/request\.query.*driverId|driverId.*request\.query/);
  });
});
