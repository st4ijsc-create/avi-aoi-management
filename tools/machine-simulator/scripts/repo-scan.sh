#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════════════════════════
# repo-scan.sh — ITEM 32'S INSTRUMENT: a repo-wide scan that CANNOT be silently narrowed by the
# directory it was typed in, and that CANNOT be reported without saying where it was typed.
#
# THE DEFECT THIS EXISTS FOR, stated as the property rather than as the incident (docs/owner-
# decisions.md item 32):
#
#     A git pathspec is RELATIVE TO THE CURRENT DIRECTORY, and a pathspec that has been narrowed
#     to nothing DOES NOT ERROR — IT RETURNS 0. So `0 because nothing matched` and `0 because the
#     pathspec excluded the whole tree` are INDISTINGUISHABLE in a report.
#
# Measured, same pattern, same SHA, only the standing place differs (item 32's table, SHA a70ed5d6,
# typed from tools/machine-simulator):
#
#     git grep -l 'ingest' <SHA> -- 'server/*.ts'          ->   0
#     git grep -l 'ingest' <SHA> -- ':(top)server/*.ts'    -> 197
#     git grep -l 'ingest' <SHA> -- '*.ts'                 ->   1
#     git grep -l 'ingest' <SHA> -- ':(top)*.ts'           -> 214
#
# The second half, found by item 15: `:(top)` ALONE IS NOT ENOUGH. Without `--full-name` git prints
# paths relative to the cwd, so a path that exists BOTH at the repo root AND under
# tools/machine-simulator prints identically from the two places and the reader cannot resolve it.
#
# THE PRICE ALREADY PAID, recorded here and not only in the ledger: item 14 was RULED BY THE OWNER
# carrying a ceiling that was FALSE — "the consumer cannot be measured from this repo" — while the
# consumer's code (server/contracts/machineDataContract.ts, server/services/processResultService.ts,
# server/api/v1/openapi.ts, server/routers/machineApiRouters.ts,
# client/src/components/apiDocs/AutomationProcessFeedSection.tsx) sat inside that very commit. A
# ruling issued under a false ceiling is exactly what owner-decisions.md exists to record.
#
# ── WHAT THIS ENFORCES ───────────────────────────────────────────────────────────────────────────
#   For any scan that goes THROUGH it:
#     1. cwd cannot narrow the result — the wrapper chdirs to the repo root itself, so the caller's
#        directory is data in the header, never an input to the pathspec.
#     2. every bare pathspec is rewritten to `:(top)<p>` — the whole tree is always in scope unless
#        the caller writes a magic prefix on purpose.
#     3. `--full-name` is always passed — printed paths are repo-root-relative and unambiguous.
#     4. the tree-ish is resolved to a FULL SHA and printed, and a dirty worktree is printed as
#        dirty, so a scan of HEAD is never reported as a scan of what is on disk.
#     5. the domain claim is EMITTED WITH THE RESULT — caller cwd, repo root, full SHA, worktree
#        state, the pathspecs after rewriting, the exact argv, and the match count. A `0` from this
#        tool carries the evidence that makes it readable as "nothing matched".
#
# ── WHAT THIS DOES NOT ENFORCE — a ceiling stated too small is worse than no ceiling ─────────────
#     a. IT CANNOT MAKE ANYBODY USE IT. There is no mechanism in git, in this repo, or in this shell
#        that stops the next person typing `git grep foo -- 'server/*.ts'` by hand. This is a
#        DEFAULT and a WITNESS, not a gate on human typing. The one thing that IS enforced by the
#        gate is that the wrapper's own cwd-invariance keeps holding (`--self-test`).
#     b. IT DOES NOT COVER NON-GIT SCANS. `grep -r`, ripgrep, editor search and the Grep tool read
#        the WORKING TREE, and this checkout is sparse: server/ (1589 files) and client/ (711 files)
#        are IN THE COMMIT and NOT ON DISK. Those tools will report 0 for them and this wrapper
#        cannot know they were run.
#     c. IT DOES NOT CHECK THAT A REPORT COPIED THE HEADER. It prints provenance; it cannot make a
#        human paste it.
#     d. IT SAYS NOTHING ABOUT WHETHER THE PATTERN WAS THE RIGHT PATTERN. A scan for the wrong
#        string is still a scan for the wrong string, correctly scoped.
#     e. IT DOES NOT REACH OUTSIDE THE REPO. The MQTT retained-mirror subscriber of item 32 — 37
#        files under server/+client/ mention `syn/`, none proven to BE a subscriber — is outside
#        every scan this tool can run, and stays unmeasured.
#
# Usage:
#   scripts/repo-scan.sh [--sha <tree-ish>] [--] <git-grep-arg>... [-- <pathspec>...]
#   scripts/repo-scan.sh --self-test
#
# Exit: 0 matches found · 1 no match (NOT an error — read the header) · 2 usage/setup failure
#       --self-test: 0 invariant holds · 1 it does not
# ═════════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail

CALLER_PWD="$(pwd -P)"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "repo-scan: not inside a git work tree (cwd: $CALLER_PWD)" >&2; exit 2; }

# ── the rewriting rule, in one function so the self-test exercises the SAME code the caller does ──
# A pathspec that already carries a magic prefix is left alone: `:(top)`, `:/`, `:(exclude)` and
# friends are deliberate acts. Everything else is rooted. An absolute path is refused rather than
# silently rooted, because rooting it would change what it means.
rewrite_pathspec() {
  local p="$1"
  case "$p" in
    :*)        printf '%s' "$p" ;;                       # already magic — the caller meant it
    /*|[A-Za-z]:[/\\]*)
               echo "repo-scan: refusing absolute pathspec '$p' — a pathspec is repo-relative and
       rooting an absolute path would change what it means. Write it repo-relative." >&2
               exit 2 ;;
    *)         printf ':(top)%s' "$p" ;;
  esac
}

# ── self-test: the wrapper's ONE property, asserted against a live hazard ─────────────────────────
# Three assertions, and the third is the one that keeps this from being a guard that passes because
# it sees nothing:
#   (a) INVARIANCE  — same count from the repo root and from tools/machine-simulator.
#   (b) NOT VACUOUS — that count is > 0. Two zeroes are equal and prove nothing.
#   (c) HAZARD LIVE — the NAIVE form (no :(top), typed from the subdirectory) returns FEWER. If this
#       ever stops holding, the probe has stopped measuring the defect and must be re-chosen; it is
#       reported as a failure rather than passed over, because a probe that no longer sees the
#       hazard would let (a) and (b) go green while enforcing nothing.
self_test() {
  local probe_pat='ingest' probe_spec='server/*.ts'
  local sub="$ROOT/tools/machine-simulator"
  local from_root from_sub naive rc=0 probe_sha

  # 🔴 THE PROBE SCANS A COMMIT, NOT THE WORKING TREE, AND THE FIRST DRAFT OF THIS FUNCTION DID NOT
  # — it was written against the working tree and this self-test REFUSED ITS OWN GREEN, reporting
  # three zeroes and failing assertion (b). The reason is boundary (b) at the top of this file,
  # demonstrated on the instrument that names it: this checkout is sparse, server/ is not on disk,
  # so a working-tree scan cannot see the very files the probe is about. The tool caught the tool.
  probe_sha=$(git rev-parse --verify 'HEAD^{commit}' 2>/dev/null) || {
    echo "FAIL: HEAD does not resolve to a commit; the probe has nothing to scan." >&2; return 1; }

  # 🔴 THE TWO ROOTED READINGS GO THROUGH `rewrite_pathspec`, NOT THROUGH A HAND-TYPED ":(top)".
  # If they did not, deleting the rewriting rule would leave this self-test green while every real
  # scan silently narrowed — the instrument would be asserting a string it wrote itself. Proven by
  # control pair: with the `:*` / `*)` arms of `rewrite_pathspec` collapsed to `printf '%s'`, this
  # function goes RED on assertion (a).
  local rooted; rooted="$(rewrite_pathspec "$probe_spec")"
  from_root=$(cd "$ROOT" && git grep --full-name -l -- "$probe_pat" "$probe_sha" "$rooted" 2>/dev/null | grep -c . || true)
  from_sub=$(cd "$sub"  && git grep --full-name -l -- "$probe_pat" "$probe_sha" "$rooted" 2>/dev/null | grep -c . || true)
  naive=$(cd "$sub"     && git grep            -l -- "$probe_pat" "$probe_sha" "$probe_spec"    2>/dev/null | grep -c . || true)

  echo "repo-scan --self-test  (probe: '$probe_pat' over '$probe_spec' at commit $probe_sha)"
  echo "  rooted, typed at repo root                 : $from_root"
  echo "  rooted, typed at tools/machine-simulator   : $from_sub"
  echo "  NAIVE relative, typed at tools/machine-sim : $naive"

  if [[ "$from_root" != "$from_sub" ]]; then
    echo "FAIL: the rooted scan is NOT cwd-invariant ($from_root vs $from_sub). The :(top) rewriting
      or the chdir-to-root has stopped working, and every domain claim made through this wrapper is
      now as unreadable as the raw command it replaces." >&2
    rc=1
  fi
  if [[ "$from_root" -eq 0 ]]; then
    echo "FAIL: the probe matched NOTHING, so the invariance above is two zeroes agreeing. Re-choose
      the probe — a self-test that cannot see anything measures nothing." >&2
    rc=1
  fi
  if [[ "$naive" -ge "$from_root" ]]; then
    echo "FAIL: the naive relative pathspec returned $naive, not fewer than $from_root. The hazard
      this wrapper exists for is no longer reproducible with this probe, so a green here would
      certify nothing. Re-measure item 32 and re-choose the probe." >&2
    rc=1
  fi
  [[ $rc -eq 0 ]] && echo "PASS: rooted scans are cwd-invariant ($from_root from both places) while the naive form loses $((from_root - naive))."
  return $rc
}

[[ "${1:-}" == "--self-test" ]] && { self_test; exit $?; }

# ── argument split ────────────────────────────────────────────────────────────────────────────────
TREEISH=""
if [[ "${1:-}" == "--sha" ]]; then TREEISH="${2:-}"; shift 2 || { echo "repo-scan: --sha needs a value" >&2; exit 2; }; fi
[[ $# -eq 0 ]] && { sed -n '/^# Usage:/,/^# Exit:/p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }

ARGS=(); SPECS=(); seen_dashdash=0
for a in "$@"; do
  if [[ $seen_dashdash -eq 0 && "$a" == "--" ]]; then seen_dashdash=1; continue; fi
  if [[ $seen_dashdash -eq 1 ]]; then SPECS+=("$a"); else ARGS+=("$a"); fi
done
[[ ${#SPECS[@]} -eq 0 ]] && SPECS=(".")

# 🔴 A GUARD THIS TOOL EARNED BY FAILING ITS OWN TEST DRIVE. `scripts/repo-scan.sh --sha HEAD -l --
# 'server/*.ts'` — no pattern — printed `result lines : 0` and looked exactly like a clean negative.
# `git grep` takes the first non-option word as the PATTERN, so with none supplied it consumed the
# resolved SHA as the pattern and searched the working tree for a hex string. That is item 32's
# defect in a second costume: a 0 that means "you did not ask a question". Refused, not printed.
_has_pattern=0
for a in ${ARGS[@]+"${ARGS[@]}"}; do [[ "$a" == -* ]] || { _has_pattern=1; break; }; done
if [[ $_has_pattern -eq 0 ]]; then
  echo "repo-scan: no PATTERN among [${ARGS[*]-}] — git grep would have taken your tree-ish as the
       pattern and returned a silent 0. Refusing: a 0 with no question asked is the exact defect
       item 32 exists for. Write:  scripts/repo-scan.sh --sha HEAD -l 'pattern' -- 'path/*.ts'" >&2
  exit 2
fi

ROOTED=(); for s in "${SPECS[@]}"; do ROOTED+=("$(rewrite_pathspec "$s")"); done

# ── resolve the tree-ish, and never let "HEAD" stand in for "what is on disk" ─────────────────────
SHA=""; SHA_LABEL=""
if [[ -n "$TREEISH" ]]; then
  SHA=$(git rev-parse --verify "${TREEISH}^{commit}" 2>/dev/null) || {
    echo "repo-scan: '$TREEISH' does not resolve to a commit" >&2; exit 2; }
  SHA_LABEL="$TREEISH -> $SHA"
else
  SHA_LABEL="WORKING TREE (no --sha given; server/ and client/ are NOT on disk in this sparse
       checkout, so a working-tree scan CANNOT see them — pass --sha HEAD to scan the commit)"
fi

DIRTY="clean"
git diff --quiet 2>/dev/null && git diff --cached --quiet 2>/dev/null || DIRTY="DIRTY (tracked changes not committed)"

OUT=$(cd "$ROOT" && { if [[ -n "$SHA" ]]; then git grep --full-name "${ARGS[@]}" "$SHA" -- "${ROOTED[@]}"
                      else                    git grep --full-name "${ARGS[@]}"        -- "${ROOTED[@]}"; fi; } 2>&1)
RC=$?
COUNT=$(printf '%s\n' "$OUT" | grep -c . || true)
[[ -z "$OUT" ]] && COUNT=0

{
  echo "── repo-scan domain claim ──────────────────────────────────────────────────────────────"
  echo "  typed from   : $CALLER_PWD"
  echo "  ran from     : $ROOT   (the wrapper chdirs; your directory did not narrow this)"
  echo "  scanned      : $SHA_LABEL"
  echo "  worktree     : $DIRTY"
  echo "  pathspecs    : ${SPECS[*]}   ->   ${ROOTED[*]}"
  echo "  argv         : git grep --full-name ${ARGS[*]} ${SHA:+$SHA }-- ${ROOTED[*]}"
  echo "  result lines : $COUNT   (exit $RC; 1 means NO MATCH, which is a measurement, not an error)"
  echo "────────────────────────────────────────────────────────────────────────────────────────"
} >&2

[[ -n "$OUT" ]] && printf '%s\n' "$OUT"
exit $RC
