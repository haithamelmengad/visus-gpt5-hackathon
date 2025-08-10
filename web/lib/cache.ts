// Simple in-memory TTL cache shared across API route hot reloads
// Uses a global Map so values persist within the running dev server process.

type CacheEntry<T> = { value: T; expiresAt: number };

const GLOBAL_CACHE_KEY = "__visus_ttl_cache__";

function getStore(): Map<string, CacheEntry<unknown>> {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g[GLOBAL_CACHE_KEY]) {
    g[GLOBAL_CACHE_KEY] = new Map<string, CacheEntry<unknown>>();
  }
  return g[GLOBAL_CACHE_KEY] as Map<string, CacheEntry<unknown>>;
}

export function cacheGet<T>(key: string): T | undefined {
  const store = getStore();
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  const store = getStore();
  const expiresAt = Date.now() + Math.max(0, ttlMs);
  store.set(key, { value, expiresAt });
}

export async function cacheGetOrSet<T>(
  key: string,
  ttlMs: number,
  compute: () => Promise<T> | T
): Promise<T> {
  const existing = cacheGet<T>(key);
  if (existing !== undefined) return existing;
  const value = await compute();
  cacheSet(key, value, ttlMs);
  return value;
}

export function cacheDelete(key: string): void {
  getStore().delete(key);
}

export function cacheStats() {
  const store = getStore();
  const now = Date.now();
  let valid = 0;
  let expired = 0;
  for (const [, entry] of store) {
    if (entry.expiresAt > now) valid++;
    else expired++;
  }
  return { size: store.size, valid, expired };
}


