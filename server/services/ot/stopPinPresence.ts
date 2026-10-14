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

// One cache per module instance (= per process in production; per simulated replica in the two-replica tests).
const state = { globalGen: 0 };
const cache = new Map<number, { hasPins: boolean; at: number }>();
const gens = new Map<number, number>();
/** R-12-g — when a pin change of the adapter was last learnt here (local or broadcast): an older "none" is never used */
const changedAt = new Map<number, number>();

/** "pins" | "none" while a fresh answer is known; null when unknown / expired. */
export function cachedStopPinPresence(adapterId: number, now = Date.now()): "pins" | "none" | null {
  const e = cache.get(adapterId);
  if (!e) return null;
  if (now - e.at > STOP_PIN_PRESENCE_TTL_MS || now < e.at) {
    cache.delete(adapterId);
    return null;
  }
  // R-12-g — a "no pins" not newer than the last pin change learnt for this adapter is never used (fail closed)
  if (!e.hasPins && e.at <= (changedAt.get(adapterId) ?? -Infinity)) {
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
  changedAt.set(adapterId, Date.now());
  cache.delete(adapterId);
}

/**
 * doc 81 Đợt 12 final fix wave residual 2 (ruling R-12-g) — a pin of `adapterId` changed ON THIS REPLICA (set, removed, changed):
 * forget it here AND tell every other central replica (the signed `pins` message of otStopEpochSync — installed only while the sync
 * runs with a key; without it no peer STOP can arrive, so no other replica's exemption depends on this cache). Never throws.
 */
let pinChangeBroadcaster: ((adapterId: number) => void) | null = null;
export function setStopPinChangeBroadcaster(fn: ((adapterId: number) => void) | null): () => void {
  pinChangeBroadcaster = fn;
  return () => {
    if (pinChangeBroadcaster === fn) pinChangeBroadcaster = null;
  };
}
export function stopPinChanged(adapterId: number): void {
  invalidateStopPinPresence(adapterId);
  const b = pinChangeBroadcaster;
  if (!b) return;
  try {
    b(adapterId);
  } catch {
    /* the broadcaster alerts on its own failures */
  }
}

/** Test seam. */
export function _resetStopPinPresenceForTests(): void {
  cache.clear();
  state.globalGen += 1;
}
