import { describe, expect, it } from 'vitest';
import { acquireFileReadSlot, fileReadStats } from './file-read-limit.js';

describe('fleet file read admission', () => {
  it('bounds a 14-file burst to four active and four pending operations', async () => {
    const active = await Promise.all(Array.from({ length: 4 }, acquireFileReadSlot));
    const queued = Array.from({ length: 4 }, acquireFileReadSlot);
    expect(fileReadStats()).toEqual({ active: 4, waiting: 4 });
    const rejected = await Promise.allSettled(Array.from({ length: 6 }, acquireFileReadSlot));
    expect(rejected.every(result => result.status === 'rejected' && result.reason.code === 'FLEET_FILE_BUSY')).toBe(true);

    active.forEach(release => release());
    const resumed = await Promise.all(queued);
    expect(fileReadStats()).toEqual({ active: 4, waiting: 0 });
    resumed.forEach(release => release());
    expect(fileReadStats()).toEqual({ active: 0, waiting: 0 });
  });
});
