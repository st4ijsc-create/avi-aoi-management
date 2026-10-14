/**
 * doc 81 Đợt 12 final fix wave residual (R-12-f item 1) — the per-process cache of "does this adapter have any stop pin": bounded
 * TTL, invalidated by a pin change (a read that started before the change never stores its old answer), bounded size.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  cachedStopPinPresence,
  rememberStopPinPresence,
  invalidateStopPinPresence,
  stopPinReadToken,
  stopPinChanged,
  setStopPinChangeBroadcaster,
  _resetStopPinPresenceForTests,
  STOP_PIN_PRESENCE_TTL_MS,
  STOP_PIN_PRESENCE_MAX,
} from "./stopPinPresence";

beforeEach(() => _resetStopPinPresenceForTests());

describe("stopPinPresence", () => {
  it("remembers pins / none; expires after the TTL (and on a clock that went back)", () => {
    const t0 = 1_000_000;
    rememberStopPinPresence(1, true, stopPinReadToken(1), t0);
    rememberStopPinPresence(2, false, stopPinReadToken(2), t0);
    expect(cachedStopPinPresence(1, t0 + 1)).toBe("pins");
    expect(cachedStopPinPresence(2, t0 + STOP_PIN_PRESENCE_TTL_MS)).toBe("none");
    expect(cachedStopPinPresence(2, t0 + STOP_PIN_PRESENCE_TTL_MS + 1)).toBeNull();
    expect(cachedStopPinPresence(1, t0 - 1)).toBeNull();
    expect(cachedStopPinPresence(3, t0)).toBeNull();
  });
  it("★ a pin change invalidates the answer; a read that STARTED before the change never stores it afterwards", () => {
    const tok = stopPinReadToken(5);
    rememberStopPinPresence(5, false, tok);
    expect(cachedStopPinPresence(5)).toBe("none");
    const inFlight = stopPinReadToken(5); // a read starts …
    invalidateStopPinPresence(5); // … a pin is added meanwhile
    expect(cachedStopPinPresence(5)).toBeNull();
    rememberStopPinPresence(5, false, inFlight); // … the old answer arrives: ignored
    expect(cachedStopPinPresence(5)).toBeNull();
    rememberStopPinPresence(5, true, stopPinReadToken(5));
    expect(cachedStopPinPresence(5)).toBe("pins");
    // an unknown-adapter invalidation forgets everything, and a read in flight then is ignored too
    const t6 = stopPinReadToken(6);
    invalidateStopPinPresence();
    expect(cachedStopPinPresence(5)).toBeNull();
    rememberStopPinPresence(6, false, t6);
    expect(cachedStopPinPresence(6)).toBeNull();
    // another adapter's invalidation does not touch this one
    rememberStopPinPresence(7, false, stopPinReadToken(7));
    invalidateStopPinPresence(8);
    expect(cachedStopPinPresence(7)).toBe("none");
  });
  it("R-12-g: a cached 'none' NOT NEWER than the last pin change learnt is never used; a 'pins' answer is kept (the safe side)", () => {
    const t = Date.now();
    rememberStopPinPresence(40, false, stopPinReadToken(40), t - 5);
    rememberStopPinPresence(41, true, stopPinReadToken(41), t - 5);
    // a change learnt now, but the entries were written with an earlier timestamp by a read that kept its token (gen of 40/41 not bumped)
    invalidateStopPinPresence(42); // another adapter: no effect
    expect(cachedStopPinPresence(40)).toBe("none");
    const tok40 = stopPinReadToken(40);
    invalidateStopPinPresence(40);
    rememberStopPinPresence(40, false, stopPinReadToken(40), t - 1_000); // an answer stamped BEFORE the change
    expect(cachedStopPinPresence(40)).toBeNull();
    rememberStopPinPresence(40, false, tok40); // the in-flight read of the old generation: ignored
    expect(cachedStopPinPresence(40)).toBeNull();
    expect(cachedStopPinPresence(41)).toBe("pins");
  });
  it("R-12-g: stopPinChanged forgets locally and calls the broadcaster (a throwing one never reaches the caller); removed ⇒ not called", () => {
    const calls: number[] = [];
    const off = setStopPinChangeBroadcaster((id) => void calls.push(id));
    rememberStopPinPresence(50, false, stopPinReadToken(50));
    stopPinChanged(50);
    expect(cachedStopPinPresence(50)).toBeNull();
    expect(calls).toEqual([50]);
    off();
    stopPinChanged(51);
    expect(calls).toEqual([50]);
    const off2 = setStopPinChangeBroadcaster(() => {
      throw new Error("boom");
    });
    expect(() => stopPinChanged(52)).not.toThrow();
    off2();
  });

  it("bounded: the oldest entry is evicted at the cap", () => {
    for (let i = 1; i <= STOP_PIN_PRESENCE_MAX + 1; i++) rememberStopPinPresence(i, false, stopPinReadToken(i));
    expect(cachedStopPinPresence(1)).toBeNull();
    expect(cachedStopPinPresence(2)).toBe("none");
    expect(cachedStopPinPresence(STOP_PIN_PRESENCE_MAX + 1)).toBe("none");
  });
});
