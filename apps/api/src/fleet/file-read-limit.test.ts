import { describe, expect, it } from 'vitest';
import { acquireFileReadSlot, fileReadStats } from './file-read-limit.js';

describe('fleet file read admission', () => {
  it('serves a 14-file burst with four active and a finite waiting queue', async () => {
    const active = await Promise.all(Array.from({ length: 4 }, acquireFileReadSlot));
    const queued = Array.from({ length: 10 }, acquireFileReadSlot);
    expect(fileReadStats()).toEqual({ active: 4, waiting: 10 });
    const extra = Array.from({ length: 6 }, acquireFileReadSlot);
    expect(fileReadStats()).toEqual({ active: 4, waiting: 16 });
    const rejected = await Promise.allSettled(Array.from({ length: 6 }, acquireFileReadSlot));
    expect(rejected.every(result => result.status === 'rejected' && result.reason.code === 'FLEET_FILE_BUSY')).toBe(true);

    active.forEach(release => release());
    for (let index = 0; index < queued.length + extra.length; index += 4) {
      const resumed = await Promise.all([...queued, ...extra].slice(index, index + 4));
      resumed.forEach(release => release());
    }
    expect(fileReadStats()).toEqual({ active: 0, waiting: 0 });
  });
});
