import { describe, expect, it } from 'vitest';
import { queueThumbnail, thumbnailQueueStats } from './thumbnail-queue.js';

describe('visible fleet thumbnails', () => {
  it('loads no more than three at a time and drops thumbnails that leave the screen', async () => {
    const releases: Array<() => void> = [];
    const started: number[] = [];
    const jobs = Array.from({ length: 14 }, (_, index) => () => new Promise<void>(resolve => {
      started.push(index);
      releases.push(resolve);
    }));
    const cancels = jobs.map((job, index) => queueThumbnail(job, index));
    await Promise.resolve();
    expect(thumbnailQueueStats()).toEqual({ active: 3, pending: 11 });
    expect(started).toEqual([0, 1, 2]);
    cancels[3]!();
    releases.splice(0).forEach(release => release());
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(started).toEqual([0, 1, 2, 4, 5, 6]);
    cancels.forEach(cancel => cancel());
    releases.splice(0).forEach(release => release());
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(thumbnailQueueStats()).toEqual({ active: 0, pending: 0 });
  });
});
