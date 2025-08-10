// Persistent TTL cache (JSON on disk) with in-memory layer and single-flight.
// - Works across dev server restarts (persists to .visus-cache/ttl-cache.json)
// - No native deps; compatible with different Node versions
// - API compatible with previous in-memory cache

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

type CacheEntry<T> = { value: T; expiresAt: number };

const GLOBAL_CACHE_KEY = "__visus_ttl_cache__";
const GLOBAL_INFLIGHT_KEY = "__visus_ttl_cache_inflight__";
const GLOBAL_INIT_KEY = "__visus_ttl_cache_initialized__";
const GLOBAL_PERSIST_SCHED_KEY = "__visus_ttl_cache_persist_timer__";
const GLOBAL_PERSISTING_KEY = "__visus_ttl_cache_persisting__";
const GLOBAL_PERSIST_DIRTY_KEY = "__visus_ttl_cache_persist_dirty__";

const CACHE_DIR = path.join(process.cwd(), ".visus-cache");
const CACHE_FILE = path.join(CACHE_DIR, "ttl-cache.json");

function getStore(): Map<string, CacheEntry<unknown>> {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g[GLOBAL_CACHE_KEY]) {
    g[GLOBAL_CACHE_KEY] = new Map<string, CacheEntry<unknown>>();
  }
  if (!g[GLOBAL_INIT_KEY]) {
    // Lazy load persisted data once per process
    try {
      ensureCacheDirSync();
      if (fs.existsSync(CACHE_FILE)) {
        const raw = fs.readFileSync(CACHE_FILE, "utf8");
        if (raw.trim().length > 0) {
          const obj = JSON.parse(raw) as Record<string, CacheEntry<unknown>>;
          const now = Date.now();
          for (const [k, entry] of Object.entries(obj)) {
            if (
              entry &&
              typeof entry.expiresAt === "number" &&
              entry.expiresAt > now
            ) {
              (g[GLOBAL_CACHE_KEY] as Map<string, CacheEntry<unknown>>).set(
                k,
                entry
              );
            }
          }
          // Clean up expired keys on disk opportunistically
          schedulePersist();
        }
      }
    } catch {
      // Ignore load errors; start with empty store
    } finally {
      g[GLOBAL_INIT_KEY] = true;
    }
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

function ensureCacheDirSync(): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
  } catch {
    // Ignore dir creation errors; persistence will be skipped
  }
}

function schedulePersist(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  // Mark cache as dirty so a persist after the current one (if any) will run
  g[GLOBAL_PERSIST_DIRTY_KEY] = true;
  const existingTimer = g[GLOBAL_PERSIST_SCHED_KEY] as
    | NodeJS.Timeout
    | undefined;
  if (existingTimer) return; // already scheduled
  // Debounce to batch multiple mutations in the same tick
  const timer = setTimeout(() => {
    g[GLOBAL_PERSIST_SCHED_KEY] = undefined;
    void persistToDisk();
  }, 50);
  // Avoid keeping the event loop alive unnecessarily
  if (typeof (timer as any).unref === "function") {
    (timer as any).unref();
  }
  g[GLOBAL_PERSIST_SCHED_KEY] = timer as unknown as NodeJS.Timeout;
}

async function persistToDisk(): Promise<void> {
  const g = globalThis as unknown as Record<string, unknown>;
  if (g[GLOBAL_PERSISTING_KEY]) return; // another persist will handle the dirty flag
  g[GLOBAL_PERSISTING_KEY] = true;
  try {
    // Clear the dirty flag; if set again during persist, we will loop once more
    g[GLOBAL_PERSIST_DIRTY_KEY] = false;
    const store = getStore();
    ensureCacheDirSync();
    const now = Date.now();
    // Build plain object snapshot without expired entries
    const snapshot: Record<string, CacheEntry<unknown>> = {};
    for (const [k, entry] of store) {
      if (entry.expiresAt > now) snapshot[k] = entry;
    }

    const tmp = `${CACHE_FILE}.tmp`;
    const data = JSON.stringify(snapshot);
    await fsp.writeFile(tmp, data, "utf8");
    await fsp.rename(tmp, CACHE_FILE);
  } catch {
    // Ignore persist errors
  } finally {
    g[GLOBAL_PERSISTING_KEY] = false;
    // If new mutations happened during persist, run one more time
    if (g[GLOBAL_PERSIST_DIRTY_KEY]) {
      // Avoid unbounded recursion by scheduling on next tick
      setTimeout(() => {
        void persistToDisk();
      }, 0);
    }
  }
}

export function cacheGet<T>(key: string): T | undefined {
  const store = getStore();
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    schedulePersist();
    return undefined;
  }
  return entry.value;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  const store = getStore();
  const expiresAt = Date.now() + Math.max(0, ttlMs);
  store.set(key, { value, expiresAt });
  schedulePersist();
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
  const store = getStore();
  if (store.delete(key)) {
    schedulePersist();
  }
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
