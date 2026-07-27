/**
 * Doc 69 · Wave 4 / C1 — inline (ghost-text) completion: request/debounce/race-safety state
 * machine, kept THUẦN (pure — no CodeMirror/DOM dependency) so it is unit-testable without a
 * full editor harness (this repo's client vitest config only runs jsdom-free `.unit.test.ts`
 * files in the `node` environment — see vitest.config.ts). The CodeMirror-specific wiring
 * (StateField/decoration/keymap) lives in ./inlineCopilotExtension.ts and drives this class.
 */

export interface CompletionWindow {
  /** Code immediately BEFORE the cursor, bounded to `maxPrefixChars`. */
  prefix: string;
  /** Code immediately AFTER the cursor, bounded to `maxSuffixChars`. */
  suffix: string;
}

export interface BuildWindowOptions {
  maxPrefixChars?: number;
  maxSuffixChars?: number;
}

/** Default window size — a few dozen lines around the cursor, NOT the whole file. */
export const DEFAULT_MAX_PREFIX_CHARS = 1500;
export const DEFAULT_MAX_SUFFIX_CHARS = 800;

/**
 * Slice a bounded prefix/suffix window around `cursor` out of the FULL document text. Pure:
 * given the same (docText, cursor, opts) it always returns the same window — this is what
 * makes the request scheduler below fully testable without a real editor.
 */
export function buildCompletionWindow(
  docText: string,
  cursor: number,
  opts: BuildWindowOptions = {},
): CompletionWindow {
  const text = typeof docText === "string" ? docText : "";
  const pos = Number.isFinite(cursor) ? Math.max(0, Math.min(Math.floor(cursor), text.length)) : 0;
  const maxPrefix = opts.maxPrefixChars ?? DEFAULT_MAX_PREFIX_CHARS;
  const maxSuffix = opts.maxSuffixChars ?? DEFAULT_MAX_SUFFIX_CHARS;
  return {
    prefix: text.slice(Math.max(0, pos - maxPrefix), pos),
    suffix: text.slice(pos, pos + maxSuffix),
  };
}

/** The (document text, cursor offset) pair a request/result is scoped to. */
export interface InlineCopilotSnapshot {
  docText: string;
  cursor: number;
}

export type FetchInlineCompletion = (window: CompletionWindow) => Promise<string>;

export interface InlineCopilotControllerOptions extends BuildWindowOptions {
  /** Debounce delay after the last edit/selection change before firing a request. Default 350ms. */
  debounceMs?: number;
}

export const DEFAULT_DEBOUNCE_MS = 350;

/**
 * Debounced, RACE-SAFE scheduler for inline completion requests.
 *
 * - `schedule()` is called on every doc/selection change; it debounces (default 350ms) and,
 *   once settled, builds a bounded window and calls `fetchCompletion`.
 * - `cancel()` (called on any new edit) immediately invalidates the current debounce timer
 *   AND bumps an internal sequence counter, so even an ALREADY IN-FLIGHT network call whose
 *   promise resolves later is discarded (its `mySeq` no longer matches `this.seq`).
 * - As a second, independent guard, a result is applied only if `getCurrentSnapshot()` — the
 *   editor's state AT THE MOMENT the result arrives — still matches the snapshot the request
 *   was made for. This covers any edit path that might not route through schedule()/cancel().
 * - Network/callback errors never throw out of `schedule()` — a failed fetch resolves to `""`
 *   via `onResult`, mirroring the server's fail-safe empty completion.
 */
export class InlineCopilotController {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  constructor(
    private readonly fetchCompletion: FetchInlineCompletion,
    private readonly options: InlineCopilotControllerOptions = {},
  ) {}

  /** Number of schedule() calls issued so far — diagnostics / test hook. */
  get requestCount(): number {
    return this.seq;
  }

  /** Cancel any pending debounce timer and invalidate any in-flight request's eventual result. */
  cancel(): void {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.seq++;
  }

  /**
   * Debounce a completion request scoped to `snapshot`. `getCurrentSnapshot` is called ONLY
   * when the (possibly slow) fetch resolves, to re-check the editor hasn't moved on.
   * `onResult(completion, snapshot)` fires with the (possibly empty) completion — but ONLY
   * when this request is still the latest AND still matches the live editor state.
   */
  schedule(
    snapshot: InlineCopilotSnapshot,
    getCurrentSnapshot: () => InlineCopilotSnapshot,
    onResult: (completion: string, snapshot: InlineCopilotSnapshot) => void,
  ): void {
    if (this.timer != null) clearTimeout(this.timer);
    const mySeq = ++this.seq;
    this.timer = setTimeout(() => {
      this.timer = null;
      const window = buildCompletionWindow(snapshot.docText, snapshot.cursor, this.options);
      this.fetchCompletion(window)
        .then((completion) => {
          if (mySeq !== this.seq) return; // superseded by a newer schedule()/cancel() — stale
          const now = getCurrentSnapshot();
          if (now.docText !== snapshot.docText || now.cursor !== snapshot.cursor) return; // doc/cursor moved
          onResult(completion ?? "", snapshot);
        })
        .catch(() => {
          if (mySeq !== this.seq) return;
          onResult("", snapshot); // fail-safe: a rejected fetch shows no ghost text
        });
    }, this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
  }
}
