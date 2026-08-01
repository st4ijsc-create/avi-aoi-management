/**
 * Unit tests for usePollingInterval (doc 27 gap B12/R10).
 *
 * Runs in the node environment (no jsdom in this repo), so we test the two
 * injectable pieces the hook is composed of:
 *  - createVisibilityStore: Page Visibility subscription + snapshot,
 *    exercised against a fake document whose visibilitychange we dispatch;
 *  - pollingQueryOptions: the (visible, baseMs) → react-query options mapping.
 * The hook itself is a 4-line useSyncExternalStore wrapper over exactly these.
 */
import { describe, it, expect } from "vitest";
import {
  createVisibilityStore,
  pollingQueryOptions,
  type VisibilityDocLike,
} from "./usePollingInterval";

/** Fake document: mutable visibilityState + real listener dispatch. */
function makeFakeDoc(initial: DocumentVisibilityState) {
  const listeners = new Set<() => void>();
  let state = initial;
  const doc: VisibilityDocLike & {
    setVisibility: (v: DocumentVisibilityState) => void;
    listenerCount: () => number;
  } = {
    get visibilityState() {
      return state;
    },
    addEventListener(type: string, listener: () => void) {
      if (type === "visibilitychange") listeners.add(listener);
    },
    removeEventListener(_type: string, listener: () => void) {
      listeners.delete(listener);
    },
    setVisibility(v: DocumentVisibilityState) {
      state = v;
      for (const l of [...listeners]) l();
    },
    listenerCount: () => listeners.size,
  };
  return doc;
}

describe("createVisibilityStore", () => {
  it("snapshot reflects document.visibilityState across visibilitychange toggles", () => {
    const doc = makeFakeDoc("visible");
    const store = createVisibilityStore(doc);

    expect(store.getSnapshot()).toBe(true);

    let notified = 0;
    const unsubscribe = store.subscribe(() => { notified += 1; });
    expect(doc.listenerCount()).toBe(1);

    doc.setVisibility("hidden");
    expect(notified).toBe(1);
    expect(store.getSnapshot()).toBe(false); // hidden tab → polling must stop

    doc.setVisibility("visible");
    expect(notified).toBe(2);
    expect(store.getSnapshot()).toBe(true); // back → polling resumes

    unsubscribe();
    expect(doc.listenerCount()).toBe(0);
    doc.setVisibility("hidden");
    expect(notified).toBe(2); // no notifications after unsubscribe
  });

  it("without a document (SSR/node) it is always 'visible' and subscribe is a no-op", () => {
    const store = createVisibilityStore(undefined);
    expect(store.getSnapshot()).toBe(true);
    const unsubscribe = store.subscribe(() => {});
    expect(() => unsubscribe()).not.toThrow();
  });
});

describe("pollingQueryOptions", () => {
  it("visible tab polls at baseMs with background polling off and always-refetch-on-focus", () => {
    expect(pollingQueryOptions(true, 5000)).toEqual({
      refetchInterval: 5000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: "always",
    });
  });

  it("hidden tab disables the interval (pause)", () => {
    expect(pollingQueryOptions(false, 5000).refetchInterval).toBe(false);
  });

  it("baseMs=false keeps polling off regardless of visibility (enabled-gate pattern)", () => {
    expect(pollingQueryOptions(true, false).refetchInterval).toBe(false);
    expect(pollingQueryOptions(false, false).refetchInterval).toBe(false);
  });

  it("end-to-end toggle: store snapshot drives the interval on/off and back", () => {
    const doc = makeFakeDoc("visible");
    const store = createVisibilityStore(doc);
    const at = () => pollingQueryOptions(store.getSnapshot(), 2000).refetchInterval;

    expect(at()).toBe(2000);
    doc.setVisibility("hidden");
    expect(at()).toBe(false);
    doc.setVisibility("visible");
    expect(at()).toBe(2000);
  });
});
