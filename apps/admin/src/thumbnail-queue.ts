type Pending = { run: () => Promise<void>; priority: number; cancelled: boolean };
const MAX_ACTIVE = 3;
const MAX_PENDING = 30;
const pending: Pending[] = [];
let active = 0;

function pump() {
  while (active < MAX_ACTIVE && pending.length) {
    pending.sort((a, b) => a.priority - b.priority);
    const next = pending.shift()!;
    if (next.cancelled) continue;
    active++;
    void Promise.resolve().then(next.run).catch(() => {}).finally(() => { active--; pump(); });
  }
}

export function queueThumbnail(run: () => Promise<void>, priority: number): () => void {
  if (pending.length >= MAX_PENDING) return () => {};
  const item: Pending = { run, priority, cancelled: false };
  pending.push(item);
  pump();
  return () => {
    item.cancelled = true;
    const index = pending.indexOf(item);
    if (index >= 0) pending.splice(index, 1);
  };
}

export function thumbnailQueueStats() {
  return { active, pending: pending.length };
}
