import { execFileSync } from "node:child_process"

/**
 * WS-HMI-1 whole-branch review, finding L4 — three specs (`32-hmi-screen-wiring.spec.ts`,
 * `33-hmi-policy-gate.spec.ts`, `34-hmi-widget-error-boundary.spec.ts`) mutate REAL, tracked
 * `web/screens/*.json` files on disk to build a fixture, and restore them in a `try/finally`.
 * `finally` survives a test's own timeout (verified — see `11-hmi.spec.ts`'s `matchThreshold` test,
 * which makes and cites the same claim) but not SIGINT, a CI cancellation, or a crash: an interrupted
 * run can leave a mutated screen document on disk, committed by accident on the next `git commit -a`,
 * with every static gate (`tsc`, `oxlint`, `npm run build`, `check-contracts`) staying green in that
 * state — only `npm run test:runtime` reddens (the finding's own measurement).
 *
 * This is the "make the recovery robust" half of the finding's two offered fixes (the other being "make
 * the corrupted state loud", which this also does — see the thrown error below). Call it in a
 * `test.beforeAll` for any spec that mutates a tracked fixture: it resets the given path(s) to their
 * committed `HEAD` content via `git checkout --` BEFORE the test runs, so a prior interrupted run's
 * leftover mutation cannot leak into this one. Self-healing on the very next run, not a human noticing a
 * stray diff and remembering the right git incantation.
 *
 * Deliberately narrow: this touches ONLY the exact paths callers name, via `git checkout --` (never `.`
 * or a directory), and only paths already known to be exactly these test fixtures — it is not a general
 * "clean the working tree" hammer.
 */
export function resetTrackedScreenFixtures(...absolutePaths: string[]): void {
  if (absolutePaths.length === 0) return
  try {
    execFileSync("git", ["checkout", "--", ...absolutePaths], { stdio: "pipe" })
  } catch (err) {
    // Loud, not swallowed — a git failure here (e.g. one of these paths was never committed, or the
    // working tree has an unrelated conflict) means this spec's OWN precondition cannot be established
    // safely; better to fail the test with a clear cause than to proceed against unknown fixture state.
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(
      `resetTrackedScreenFixtures: "git checkout --" thất bại cho ${absolutePaths.join(", ")} — ` +
        `không thể đảm bảo trạng thái sạch trước khi mutate fixture. Chi tiết: ${message}`
    )
  }
}
