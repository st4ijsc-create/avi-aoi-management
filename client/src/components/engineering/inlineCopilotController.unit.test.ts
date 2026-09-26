/**
 * Doc 69 · Wave 4 / C1 — inline (ghost-text) completion state machine tests (THUẦN, no
 * CodeMirror/DOM). The in-editor ghost-text RENDERING (ChromiumStateField/decoration/keymap)
 * is CodeMirror-specific and is verified live by the controller (see ai-c1-report.md) — this
 * file covers the request/debounce/race-safety engine that drives it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildCompletionWindow,
  InlineCopilotController,
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_MAX_PREFIX_CHARS,
  DEFAULT_MAX_SUFFIX_CHARS,
  type InlineCopilotSnapshot,
} from "./inlineCopilotController";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("buildCompletionWindow — pure prefix/suffix slicing", () => {
  it("slices prefix before / suffix after the cursor", () => {
    const w = buildCompletionWindow("IF x THEN\n  y := 1;\nEND_IF", 10);
    expect(w.prefix).toBe("IF x THEN\n");
    expect(w.suffix).toBe("  y := 1;\nEND_IF");
  });

  it("bounds the prefix to maxPrefixChars (a window, not the whole file)", () => {
    const doc = "a".repeat(5000);
    const w = buildCompletionWindow(doc, 5000, { maxPrefixChars: 100 });
    expect(w.prefix.length).toBe(100);
  });

  it("bounds the suffix to maxSuffixChars", () => {
    const doc = "b".repeat(5000);
    const w = buildCompletionWindow(doc, 0, { maxSuffixChars: 50 });
    expect(w.suffix.length).toBe(50);
  });

  it("defaults match the exported constants", () => {
    const doc = "x".repeat(10000);
    const w = buildCompletionWindow(doc, 5000);
    expect(w.prefix.length).toBe(DEFAULT_MAX_PREFIX_CHARS);
    expect(w.suffix.length).toBe(DEFAULT_MAX_SUFFIX_CHARS);
  });

  it("clamps an out-of-range cursor into [0, doc.length] instead of throwing", () => {
    expect(() => buildCompletionWindow("abc", -5)).not.toThrow();
    expect(buildCompletionWindow("abc", -5)).toEqual({ prefix: "", suffix: "abc" });
    expect(buildCompletionWindow("abc", 999)).toEqual({ prefix: "abc", suffix: "" });
  });

  it("cursor at document start/end", () => {
    expect(buildCompletionWindow("hello", 0)).toEqual({ prefix: "", suffix: "hello" });
    expect(buildCompletionWindow("hello", 5)).toEqual({ prefix: "hello", suffix: "" });
  });

  it("empty document → empty window, no throw", () => {
    expect(buildCompletionWindow("", 0)).toEqual({ prefix: "", suffix: "" });
  });
});

describe("InlineCopilotController — debounce", () => {
  it("does not call fetchCompletion before the debounce window elapses", () => {
    const fetchCompletion = vi.fn(async () => "x");
    const c = new InlineCopilotController(fetchCompletion);
    const snap: InlineCopilotSnapshot = { docText: "abc", cursor: 3 };
    c.schedule(snap, () => snap, () => {});

    vi.advanceTimersByTime(DEFAULT_DEBOUNCE_MS - 1);
    expect(fetchCompletion).not.toHaveBeenCalled();
  });

  it("calls fetchCompletion once the debounce window elapses", async () => {
    const fetchCompletion = vi.fn(async () => "x");
    const c = new InlineCopilotController(fetchCompletion);
    const snap: InlineCopilotSnapshot = { docText: "abc", cursor: 3 };
    c.schedule(snap, () => snap, () => {});

    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);
    expect(fetchCompletion).toHaveBeenCalledTimes(1);
  });

  it("re-scheduling before the debounce fires resets the timer (only the LAST schedule fires)", async () => {
    const fetchCompletion = vi.fn(async () => "x");
    const c = new InlineCopilotController(fetchCompletion);
    const snapA: InlineCopilotSnapshot = { docText: "a", cursor: 1 };
    const snapB: InlineCopilotSnapshot = { docText: "ab", cursor: 2 };

    c.schedule(snapA, () => snapB, () => {});
    vi.advanceTimersByTime(200); // typing continues before the first debounce settles
    c.schedule(snapB, () => snapB, () => {});
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);

    expect(fetchCompletion).toHaveBeenCalledTimes(1); // the superseded snapA request never fired
    expect(fetchCompletion.mock.calls[0][0]).toEqual({ prefix: "ab", suffix: "" });
  });

  it("respects a custom debounceMs", async () => {
    const fetchCompletion = vi.fn(async () => "x");
    const c = new InlineCopilotController(fetchCompletion, { debounceMs: 50 });
    const snap: InlineCopilotSnapshot = { docText: "abc", cursor: 3 };
    c.schedule(snap, () => snap, () => {});

    await vi.advanceTimersByTimeAsync(49);
    expect(fetchCompletion).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchCompletion).toHaveBeenCalledTimes(1);
  });
});

describe("InlineCopilotController — race-safety (stale results ignored)", () => {
  it("cancel() before the debounce fires prevents fetchCompletion from ever being called", () => {
    const fetchCompletion = vi.fn(async () => "x");
    const c = new InlineCopilotController(fetchCompletion);
    const snap: InlineCopilotSnapshot = { docText: "abc", cursor: 3 };
    c.schedule(snap, () => snap, () => {});
    c.cancel();

    vi.advanceTimersByTime(DEFAULT_DEBOUNCE_MS * 2);
    expect(fetchCompletion).not.toHaveBeenCalled();
  });

  it("a slow in-flight request superseded by a newer schedule() is DROPPED, not applied", async () => {
    const onResult = vi.fn();
    let resolveFirst!: (v: string) => void;
    const fetchCompletion = vi
      .fn()
      .mockImplementationOnce(() => new Promise<string>((r) => { resolveFirst = r; }))
      .mockImplementationOnce(async () => "second");
    const c = new InlineCopilotController(fetchCompletion);
    const snap1: InlineCopilotSnapshot = { docText: "one", cursor: 3 };
    const snap2: InlineCopilotSnapshot = { docText: "onetwo", cursor: 6 };

    // First request fires and is left pending (network still in flight)…
    c.schedule(snap1, () => snap2, onResult);
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);
    expect(fetchCompletion).toHaveBeenCalledTimes(1);

    // …then a NEW edit happens, superseding it with a second request that resolves fast.
    c.schedule(snap2, () => snap2, onResult);
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);
    expect(fetchCompletion).toHaveBeenCalledTimes(2);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith("second", snap2);

    // Now the FIRST (stale) request's network call finally resolves — must be ignored.
    resolveFirst("stale-ghost-text");
    await Promise.resolve();
    await Promise.resolve();
    expect(onResult).toHaveBeenCalledTimes(1); // still just the one call, from the second request
  });

  it("a result whose snapshot no longer matches the LIVE editor state (getCurrentSnapshot) is dropped", async () => {
    const onResult = vi.fn();
    const fetchCompletion = vi.fn(async () => "ghost");
    const c = new InlineCopilotController(fetchCompletion);
    const requestedSnap: InlineCopilotSnapshot = { docText: "abc", cursor: 3 };
    // The user kept typing DURING the (mocked, instant) fetch — by the time it resolves the
    // live doc/cursor has moved on, even though this was never technically "superseded" via
    // schedule()/cancel() (e.g. a caret move that the host forgot to route through schedule).
    const liveSnap: InlineCopilotSnapshot = { docText: "abcd", cursor: 4 };

    c.schedule(requestedSnap, () => liveSnap, onResult);
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);

    expect(onResult).not.toHaveBeenCalled();
  });

  it("a rejected fetch resolves onResult with an EMPTY completion (fail-safe), not a throw", async () => {
    const onResult = vi.fn();
    const fetchCompletion = vi.fn(async () => { throw new Error("network down"); });
    const c = new InlineCopilotController(fetchCompletion);
    const snap: InlineCopilotSnapshot = { docText: "abc", cursor: 3 };

    expect(() => c.schedule(snap, () => snap, onResult)).not.toThrow();
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);
    await Promise.resolve();

    expect(onResult).toHaveBeenCalledWith("", snap);
  });

  it("a rejected but SUPERSEDED fetch does not call onResult at all", async () => {
    const onResult = vi.fn();
    let rejectFirst!: (e: Error) => void;
    const fetchCompletion = vi
      .fn()
      .mockImplementationOnce(() => new Promise<string>((_resolve, reject) => { rejectFirst = reject; }))
      .mockImplementationOnce(async () => "fresh");
    const c = new InlineCopilotController(fetchCompletion);
    const snap1: InlineCopilotSnapshot = { docText: "a", cursor: 1 };
    const snap2: InlineCopilotSnapshot = { docText: "ab", cursor: 2 };

    // First request fires and is left pending (still "in flight")…
    c.schedule(snap1, () => snap2, onResult);
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);
    expect(fetchCompletion).toHaveBeenCalledTimes(1);

    // …then a NEW edit supersedes it with a second request that resolves fast.
    c.schedule(snap2, () => snap2, onResult);
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith("fresh", snap2);

    // Now the FIRST (stale) request finally rejects — must be silently ignored (already handled
    // by the controller's own .catch(), so this also proves no unhandled-rejection leak).
    rejectFirst(new Error("network down"));
    await Promise.resolve();
    await Promise.resolve();
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it("requestCount increments once per schedule() call (diagnostics)", () => {
    const c = new InlineCopilotController(async () => "");
    const snap: InlineCopilotSnapshot = { docText: "a", cursor: 1 };
    expect(c.requestCount).toBe(0);
    c.schedule(snap, () => snap, () => {});
    c.schedule(snap, () => snap, () => {});
    expect(c.requestCount).toBe(2);
  });
});
