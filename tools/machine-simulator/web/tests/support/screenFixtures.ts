import { execFileSync } from "node:child_process"

/**
 * WS-HMI-1 final-fix-re-review.md, finding N2 — this file used to export `resetTrackedScreenFixtures`,
 * which ran `git checkout -- <paths>` UNCONDITIONALLY AND SILENTLY before each of specs 32/33/34. That
 * "fix" (for L4, whole-branch-review.md) destroyed real work: an uncommitted, schema-valid, in-progress
 * edit to `screens/automation-overview.json` — the exact kind of edit this branch's own thesis ("a
 * screen is data") invites an author to make — was silently discarded by a single ordinary, PASSING
 * `npm run test:e2e` run, every time, not only after an interrupted one. `Hmi.tsx:46-48` imports all
 * three of these files; they are shipped product source, not disposable test fixtures, and calling them
 * that in the old doc comment ("paths already known to be exactly these test fixtures") was the
 * description that made the destructiveness read as narrow when it was not.
 *
 * 🔴 The fix is not "check before resetting" — any code path that can still overwrite a file it did not
 * itself dirty is the same defect with an extra step. This module now NEVER writes to these paths. It
 * only reads: `git diff --quiet -- <path>` (read-only; changes nothing regardless of exit code) tells it
 * whether a path already differs from the committed `HEAD` content, and if any of them do, it REFUSES to
 * let the calling spec proceed — loudly, naming exactly which path and why, rather than guessing whether
 * the dirtiness is a human's own in-progress edit or a prior run's uncollected leftover swap. Either way,
 * silently overwriting it is wrong; a human reading the thrown error is the correct next step in both
 * cases, and this module does not try to tell them apart.
 *
 * Each spec's own `try { … } finally { writeFileSync(path, original) }` (unchanged by this fix, and
 * itself the reason this module never needed to "restore" anything by copying from git) already captures
 * whatever content GENUINELY was on disk immediately before mutating it — including a human's
 * in-progress edit — and puts that exact content back, whether the test passes or throws. The ONLY gap
 * that ever existed is a process that dies before `finally` runs at all (SIGINT, a CI cancellation, a
 * hard crash) — and the correct response to that gap is a human seeing a clear "these files are dirty,
 * go look" error on the NEXT run, not a program guessing it is safe to overwrite whatever it finds.
 *
 * Also corrects an overclaim the prior version of this file made: it said a leftover mutation "cannot
 * leak into this run" — true only for specs 32/33/34 themselves. `11-hmi.spec.ts` screenshots the HMI
 * screens roughly twenty spec files earlier in run order and would already fail loudly on stale content
 * well before any of these three specs' own `beforeAll` runs. That earlier failure is real protection,
 * but it is a DIFFERENT mechanism than this file provides, and this file no longer implies otherwise.
 */
export function assertScreenFixturesClean(...absolutePaths: string[]): void {
  if (absolutePaths.length === 0) return
  const dirty = absolutePaths.filter((p) => !isCleanAgainstHead(p))
  if (dirty.length === 0) return

  throw new Error(
    `assertScreenFixturesClean: ${dirty.join(", ")} already differ from the committed HEAD content — ` +
      `refusing to run. This spec mutates these tracked PRODUCT files (imported by Hmi.tsx, not disposable ` +
      `test fixtures) as part of its own test and restores the exact prior content in a "finally" once it ` +
      `finishes normally. A dirty file here means either (a) you have real, uncommitted work in progress on ` +
      `it — this spec will NOT touch or discard it, commit/stash it first — or (b) an earlier run of this ` +
      `same spec was interrupted (SIGINT/crash/CI cancellation) before its own "finally" restored the file. ` +
      `Resolve by hand — inspect the diff, and if it is genuinely leftover corruption from case (b) and not ` +
      `your own work, "git checkout -- <path>" it yourself once you are sure which case you are in.`
  )
}

/** Read-only: `git diff --quiet` exits 0 when `path` matches `HEAD` and non-zero when it differs (or on
 * a git error) — it never writes to the working tree either way. */
function isCleanAgainstHead(absolutePath: string): boolean {
  try {
    execFileSync("git", ["diff", "--quiet", "--", absolutePath], { stdio: "pipe" })
    return true
  } catch {
    return false
  }
}
