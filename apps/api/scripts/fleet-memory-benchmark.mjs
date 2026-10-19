// Local-only synthetic benchmark. Build @mototaxi/api first; no network or production data.
import { setTimeout as delay } from 'node:timers/promises';
import { acquireFileReadSlot, fileReadStats } from '../dist/fleet/file-read-limit.js';

const mib = bytes => Number((bytes / 1024 / 1024).toFixed(1));
function sample(label) {
  const m = process.memoryUsage();
  console.log(JSON.stringify({ label, rssMiB: mib(m.rss), heapUsedMiB: mib(m.heapUsed),
    externalMiB: mib(m.external), arrayBuffersMiB: mib(m.arrayBuffers), ...fileReadStats() }));
}

let unblock;
const hold = new Promise(resolve => { unblock = resolve; });
let busy = 0;
sample('before');
const requests = Array.from({ length: 14 }, async () => {
  let release;
  try { release = await acquireFileReadSlot(); }
  catch { busy++; return; }
  try {
    // Each admitted request owns one synthetic 5 MiB photograph while sending.
    const photograph = Buffer.alloc(5 * 1024 * 1024, 0x7f);
    await hold;
    if (photograph.length !== 5 * 1024 * 1024) throw new Error('INVALID_SYNTHETIC_FILE');
  } finally { release(); }
});
await delay(100);
sample('four_active_ten_waiting');
unblock();
await Promise.all(requests);
global.gc?.();
sample('after');
await delay(250);
global.gc?.();
sample('after_settle');
console.log(JSON.stringify({ admitted: 14 - busy, rejectedTemporarily: busy }));
