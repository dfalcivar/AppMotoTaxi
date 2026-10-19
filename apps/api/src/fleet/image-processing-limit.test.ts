import { expect, it } from 'vitest';
import { acquireImageProcessingSlot, imageProcessingStats } from './image-processing-limit.js';

it('bounds concurrent photo processing and its waiting queue', async () => {
  const first = await Promise.all([acquireImageProcessingSlot(), acquireImageProcessingSlot()]);
  const queued = Array.from({ length: 4 }, acquireImageProcessingSlot);
  expect(imageProcessingStats()).toEqual({ active: 2, waiting: 4 });
  const denied = await Promise.allSettled(Array.from({ length: 8 }, acquireImageProcessingSlot));
  expect(denied.every(result => result.status === 'rejected' && result.reason.code === 'FLEET_IMAGE_BUSY')).toBe(true);
  first.forEach(release => release());
  (await Promise.all(queued.slice(0, 2))).forEach(release => release());
  (await Promise.all(queued.slice(2))).forEach(release => release());
  expect(imageProcessingStats()).toEqual({ active: 0, waiting: 0 });
});
