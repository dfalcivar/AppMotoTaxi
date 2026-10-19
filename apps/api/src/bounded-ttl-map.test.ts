import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoundedTtlMap } from './bounded-ttl-map.js';

afterEach(() => vi.useRealTimers());

describe('bounded expiring process caches', () => {
  it('evicts oldest routes and sweeps expired entries even without another request', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T00:00:00Z'));
    const cache = new BoundedTtlMap<string, string>(2);
    expect(cache.set('one', 'a', Date.now() + 60_000)).toBe(true);
    expect(cache.set('two', 'b', Date.now() + 120_000)).toBe(true);
    expect(cache.set('three', 'c', Date.now() + 120_000)).toBe(true);
    expect(cache.size).toBe(2);
    expect(cache.get('one')).toBeUndefined();
    vi.advanceTimersByTime(120_000);
    expect(cache.size).toBe(0);
    cache.clear();
  });

  it('fails closed instead of evicting active IP rate-limit entries', () => {
    const cache = new BoundedTtlMap<string, number>(2, 'reject');
    expect(cache.set('first', 5, Date.now() + 900_000)).toBe(true);
    expect(cache.set('second', 5, Date.now() + 900_000)).toBe(true);
    expect(cache.set('third', 1, Date.now() + 900_000)).toBe(false);
    expect(cache.get('first')).toBe(5);
    expect(cache.size).toBe(2);
    cache.clear();
  });
});
