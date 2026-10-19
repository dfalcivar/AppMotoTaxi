import { FleetError } from './service.js';

const MAX_ACTIVE = 4;
const MAX_WAITING = 4;
const WAIT_MS = 10_000;
let active = 0;
const waiting: Array<{ resolve: (release: () => void) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }> = [];

function releaseSlot(): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = waiting.shift();
    if (next) {
      clearTimeout(next.timer);
      next.resolve(releaseSlot());
    } else {
      active--;
    }
  };
}

export function fileReadStats() {
  return { active, waiting: waiting.length };
}

export function acquireFileReadSlot(): Promise<() => void> {
  if (active < MAX_ACTIVE) {
    active++;
    return Promise.resolve(releaseSlot());
  }
  if (waiting.length >= MAX_WAITING) return Promise.reject(new FleetError('FLEET_FILE_BUSY', 503));
  return new Promise((resolve, reject) => {
    const item = {
      resolve,
      reject,
      timer: setTimeout(() => {
        const index = waiting.indexOf(item);
        if (index !== -1) waiting.splice(index, 1);
        reject(new FleetError('FLEET_FILE_BUSY', 503));
      }, WAIT_MS)
    };
    item.timer.unref();
    waiting.push(item);
  });
}
