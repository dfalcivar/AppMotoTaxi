import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ options: [] as any[], closed: 0 }));
vi.mock('postgres', () => ({
  default: (_url: string, options: unknown) => {
    state.options.push(options);
    return { end: async () => { state.closed++; } };
  }
}));
import { closeDatabase, closeFleetFileDatabase, database, fleetFileDatabase } from './database.js';

afterEach(async () => {
  await closeFleetFileDatabase();
  await closeDatabase();
});

it('isolates fleet file statement limits from the normal PostgreSQL pool', () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/costago_e2e';
  try {
    database();
    fleetFileDatabase();
    expect(state.options).toHaveLength(2);
    expect(state.options[0]).toMatchObject({ max: 10, connect_timeout: 10 });
    expect(state.options[0].connection?.statement_timeout).toBeUndefined();
    expect(state.options[1]).toMatchObject({
      max: 4, connect_timeout: 10, connection: { statement_timeout: 10_000 }
    });
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});
