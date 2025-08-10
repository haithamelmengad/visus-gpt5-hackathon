// Simple in-memory TTL cache shared across API route hot reloads
// Uses a global Map so values persist within the running dev server process.

type CacheEntry<T> = { value: T; expiresAt: number };

const GLOBAL_CACHE_KEY = "__visus_ttl_cache__";
const GLOBAL_INFLIGHT_KEY = "__visus_ttl_cache_inflight__";

function getStore(): Map<string, CacheEntry<unknown>> {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g[GLOBAL_CACHE_KEY]) {
    g[GLOBAL_CACHE_KEY] = new Map<string, CacheEntry<unknown>>();
  }
  return g[GLOBAL_CACHE_KEY] as Map<string, CacheEntry<unknown>>;
}

function getInFlightStore(): Map<string, Promise<unknown>> {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g[GLOBAL_INFLIGHT_KEY]) {
    g[GLOBAL_INFLIGHT_KEY] = new Map<string, Promise<unknown>>();
  }
  return g[GLOBAL_INFLIGHT_KEY] as Map<string, Promise<unknown>>;
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

  // Single-flight: if another request is already computing this key, await it
  const inFlightStore = getInFlightStore();
  const inProgress = inFlightStore.get(key) as Promise<T> | undefined;
  if (inProgress) return inProgress;

  const promise = (async () => {
    try {
      const value = await compute();
      cacheSet(key, value, ttlMs);
      return value;
    } finally {
      // Ensure cleanup even if compute throws
      inFlightStore.delete(key);
    }
  })();
  inFlightStore.set(key, promise as unknown as Promise<unknown>);
  return promise;
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


