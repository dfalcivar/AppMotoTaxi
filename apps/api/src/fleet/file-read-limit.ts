import { FleetError } from './service.js';

const MAX_ACTIVE = 4;
const MAX_WAITING = 16;
const WAIT_MS = 20_000;
let active = 0;
const waiting: Array<{ resolve: (release: () => void) => void; reject: (error: Error) => void; timer: NodeJS.Timeout; signal?: AbortSignal; onAbort?: () => void }> = [];

function detach(item: (typeof waiting)[number]) {
  clearTimeout(item.timer);
  if (item.signal && item.onAbort) item.signal.removeEventListener('abort', item.onAbort);
}

function releaseSlot(): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = waiting.shift();
    if (next) {
      detach(next);
      next.resolve(releaseSlot());
    } else {
      active--;
    }
  };
}

export function fileReadStats() {
  return { active, waiting: waiting.length };
}

export function acquireFileReadSlot(signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) return Promise.reject(new FleetError('FLEET_FILE_CANCELLED', 499));
  if (active < MAX_ACTIVE) {
    active++;
    return Promise.resolve(releaseSlot());
  }
  if (waiting.length >= MAX_WAITING) return Promise.reject(new FleetError('FLEET_FILE_BUSY', 503));
  return new Promise((resolve, reject) => {
    const item = {
      resolve,
      reject,
      signal,
      onAbort: undefined as (() => void) | undefined,
      timer: setTimeout(() => {
        const index = waiting.indexOf(item);
        if (index !== -1) waiting.splice(index, 1);
        detach(item);
        reject(new FleetError('FLEET_FILE_BUSY', 503));
      }, WAIT_MS)
    };
    item.timer.unref();
    item.onAbort = () => {
      const index = waiting.indexOf(item);
      if (index === -1) return;
      waiting.splice(index, 1);
      detach(item);
      reject(new FleetError('FLEET_FILE_CANCELLED', 499));
    };
    signal?.addEventListener('abort', item.onAbort, { once: true });
    waiting.push(item);
    if (signal?.aborted) item.onAbort();
  });
}
