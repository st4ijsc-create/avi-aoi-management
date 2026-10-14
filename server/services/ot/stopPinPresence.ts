/**
 * doc 81 Đợt 12 final fix wave residual (ruling R-12-f item 1, L-7) — does an adapter have ANY stop pin? A per-process cache of the
 * answer the dispatcher needs for the PEER-STOP exemption of an unverified stop (R-12-e I-1: exempt only on an adapter without pins),
 * so that an unverified stop does not wait on an adapter-wide pin read in the common case:
 *   • bounded TTL (STOP_PIN_PRESENCE_TTL_MS) — a pin changed on ANOTHER replica is seen here within it;
 *   • invalidated on every local pin change (stopPin.datStopPin, the automatic unpins of a tag / adapter edit), with a generation so
 *     that a read that STARTED before the change can never store the old answer after it;
 *   • bounded size (oldest entry evicted).
 * Seeded by every full pin read (stopPin.loadStopPins). No DB here; never throws.
 */
export const STOP_PIN_PRESENCE_TTL_MS = 10_000;
export const STOP_PIN_PRESENCE_MAX = 10_000;

// ONE cache per PROCESS (globalThis-keyed): pins are database state, and a module loaded twice in one process (a test's
// vi.resetModules, a dynamic import graph) must not read one copy and invalidate another.
type PresenceState = { cache: Map<number, { hasPins: boolean; at: number }>; gens: Map<number, number>; globalGen: number };
const KEY = Symbol.for("avi.ot.stopPinPresence.v1");
const g = globalThis as unknown as Record<symbol, PresenceState | undefined>;
const state: PresenceState = (g[KEY] ??= { cache: new Map(), gens: new Map(), globalGen: 0 });
const cache = state.cache;
const gens = state.gens;

/** "pins" | "none" while a fresh answer is known; null when unknown / expired. */
export function cachedStopPinPresence(adapterId: number, now = Date.now()): "pins" | "none" | null {
  const e = cache.get(adapterId);
  if (!e) return null;
  if (now - e.at > STOP_PIN_PRESENCE_TTL_MS || now < e.at) {
    cache.delete(adapterId);
    return null;
  }
  return e.hasPins ? "pins" : "none";
}

/** Take a token BEFORE reading the pins; pass it to rememberStopPinPresence. */
export function stopPinReadToken(adapterId: number): string {
  return `${gens.get(adapterId) ?? 0}:${state.globalGen}`;
}

/** Store the answer of a read that started at `token`; ignored when a pin changed since (the read may predate the change). */
export function rememberStopPinPresence(adapterId: number, hasPins: boolean, token: string, now = Date.now()): void {
  if (token !== stopPinReadToken(adapterId)) return;
  if (!cache.has(adapterId) && cache.size >= STOP_PIN_PRESENCE_MAX) {
    const first = cache.keys().next().value as number;
    cache.delete(first);
  }
  cache.delete(adapterId);
  cache.set(adapterId, { hasPins, at: now });
}

/** A pin of `adapterId` changed (or, without an id, any adapter's): forget the answer. */
export function invalidateStopPinPresence(adapterId?: number): void {
  if (adapterId === undefined) {
    state.globalGen += 1;
    cache.clear();
    return;
  }
  gens.set(adapterId, (gens.get(adapterId) ?? 0) + 1);
  cache.delete(adapterId);
}

/** Test seam. */
export function _resetStopPinPresenceForTests(): void {
  cache.clear();
  state.globalGen += 1;
}
