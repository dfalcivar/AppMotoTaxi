export class BoundedTtlMap<K, V> {
  private readonly entries = new Map<K, { value: V; expiresAt: number }>();
  private sweepTimer: NodeJS.Timeout | undefined;

  constructor(private readonly maxEntries: number, private readonly full: 'evict' | 'reject' = 'evict') {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error('INVALID_CACHE_LIMIT');
  }

  get size() { return this.entries.size; }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V, expiresAt: number): boolean {
    if (this.entries.size >= this.maxEntries) this.prune();
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      if (this.full === 'reject') return false;
      this.entries.delete(this.entries.keys().next().value!);
    }
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt });
    if (!this.sweepTimer) {
      this.sweepTimer = setInterval(() => {
        this.prune();
        if (!this.entries.size) this.stopSweep();
      }, 60_000);
      this.sweepTimer.unref();
    }
    return true;
  }

  delete(key: K) { return this.entries.delete(key); }

  prune(now = Date.now()) {
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
    this.stopSweep();
  }

  private stopSweep() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
  }
}
