import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { routeCacheStats } from './routing.js';
import { leadRateStats } from './commercial.js';
import { cooperativeAttemptStats } from './cooperative-demo.js';
import { fileReadStats } from './fleet/file-read-limit.js';

type TaskStats = { runs: number; errors: number; active: number };
const tasks = new Map<string, TaskStats>();

export async function measuredTask<T>(name: string, run: () => Promise<T>): Promise<T> {
  const stats = tasks.get(name) ?? { runs: 0, errors: 0, active: 0 };
  tasks.set(name, stats);
  stats.runs++;
  stats.active++;
  try { return await run(); }
  catch (error) { stats.errors++; throw error; }
  finally { stats.active--; }
}

export function memorySnapshot(websocketClients: number) {
  const memory = process.memoryUsage();
  const scheduler = Object.fromEntries([...tasks].map(([name, stats]) => [name, { ...stats }]));
  for (const stats of tasks.values()) { stats.runs = 0; stats.errors = 0; }
  return {
    rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal,
    external: memory.external, arrayBuffers: memory.arrayBuffers,
    cacheEntries: { routes: routeCacheStats().entries, routeRequests: routeCacheStats().inFlight,
      advertisingIps: leadRateStats().entries, cooperativeIps: cooperativeAttemptStats().entries },
    fleetFiles: fileReadStats(), websocketClients,
    sharp: { cache: sharp.cache(), counters: sharp.counters() }, scheduler
  };
}

export function startMemoryMetrics(app: FastifyInstance, websocketClients: () => number) {
  if (process.env.COSTAGO_MEMORY_METRICS === 'off') return;
  const requested = Number(process.env.COSTAGO_MEMORY_METRICS_INTERVAL_SECONDS ?? 60);
  const seconds = Number.isFinite(requested) ? Math.min(300, Math.max(30, Math.round(requested))) : 60;
  const timer = setInterval(() => {
    app.log.info({ metrics: memorySnapshot(websocketClients()) }, 'node_memory_metrics');
  }, seconds * 1000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
}
