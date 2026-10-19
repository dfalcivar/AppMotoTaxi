import { describe, expect, it } from 'vitest';
import { measuredTask, memorySnapshot } from './memory-metrics.js';

describe('aggregate Node metrics', () => {
  it('reports memory categories, cache counts and task failures without request data', async () => {
    await measuredTask('test_success', async () => 1);
    await expect(measuredTask('test_failure', async () => { throw new Error('synthetic'); })).rejects.toThrow('synthetic');
    const snapshot = memorySnapshot(2);
    for (const name of ['rss', 'heapUsed', 'heapTotal', 'external', 'arrayBuffers'] as const) {
      expect(snapshot[name]).toBeGreaterThan(0);
    }
    expect(snapshot.websocketClients).toBe(2);
    expect(snapshot.scheduler.test_success).toMatchObject({ runs: 1, errors: 0, active: 0 });
    expect(snapshot.scheduler.test_failure).toMatchObject({ runs: 1, errors: 1, active: 0 });
    expect(JSON.stringify(snapshot)).not.toContain('synthetic');
    expect(memorySnapshot(0).scheduler.test_failure).toMatchObject({ runs: 0, errors: 0 });
  });
});
