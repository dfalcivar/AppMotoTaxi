import { FleetError } from './service.js';

const MAX_ACTIVE = 2;
const MAX_WAITING = 4;
let active = 0;
const waiting: Array<{ resolve: (release: () => void) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }> = [];

function makeRelease(): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = waiting.shift();
    if (next) { clearTimeout(next.timer); next.resolve(makeRelease()); }
    else active--;
  };
}

export function imageProcessingStats() { return { active, waiting: waiting.length }; }

export function acquireImageProcessingSlot(): Promise<() => void> {
  if (active < MAX_ACTIVE) {
    active++;
    return Promise.resolve(makeRelease());
  }
  if (waiting.length >= MAX_WAITING) return Promise.reject(new FleetError('FLEET_IMAGE_BUSY', 503));
  return new Promise((resolve, reject) => {
    const item = {
      resolve, reject,
      timer: setTimeout(() => {
        const index = waiting.indexOf(item);
        if (index >= 0) waiting.splice(index, 1);
        reject(new FleetError('FLEET_IMAGE_BUSY', 503));
      }, 20_000)
    };
    item.timer.unref();
    waiting.push(item);
  });
}
