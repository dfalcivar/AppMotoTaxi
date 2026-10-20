import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

describe('membership grace date arithmetic in PostgreSQL', () => {
  it.each([0, 15])('keeps scheduler dates and suspension time for %i grace days', async days => {
    const pg = new PGlite();
    try {
      await pg.exec(`create table cycle (
        expires_at timestamptz, timezone text, suspension_time time,
        last_grace_local_date date, suspension_at timestamptz
      );
      insert into cycle(expires_at, timezone, suspension_time)
      values ('2026-10-09T21:05:41.658Z', 'America/Guayaquil', '04:00');`);
      const result = await pg.query<{
        last_grace_local_date: string;
        suspension_at: string;
      }>(`update cycle set
        last_grace_local_date=((expires_at at time zone timezone)::date+$1::integer),
        suspension_at=(((expires_at at time zone timezone)::date+$2::integer)::date+suspension_time) at time zone timezone
        returning last_grace_local_date::text, suspension_at::text`, [days, days + 1]);
      expect(result.rows[0]?.last_grace_local_date).toBe(days === 0 ? '2026-10-09' : '2026-10-24');
      expect(new Date(result.rows[0]!.suspension_at).toISOString())
        .toBe(days === 0 ? '2026-10-10T09:00:00.000Z' : '2026-10-25T09:00:00.000Z');
    } finally {
      await pg.close();
    }
  }, 15_000);

  it('uses explicit integer operands in scheduler and administrative grant', async () => {
    const source = await readFile(new URL('./memberships.ts', import.meta.url), 'utf8');
    expect(source).toContain('::date+${graceDays}::integer');
    expect(source).toContain('::date+${graceDays + 1}::integer');
    expect(source).toContain('::date+${body.days}::integer');
    expect(source).toContain('::date+${body.days+1}::integer');
  });
});
