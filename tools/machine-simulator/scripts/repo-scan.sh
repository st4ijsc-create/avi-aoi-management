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
# 🔴 AND THIS INSTRUMENT SHIPPED CARRYING THE DEFECT IT WAS BUILT TO CATCH, from cfcfae42
# (2026-08-22) to 89018893. Found by AZ-1, confirmed twice independently, fixed here by BA-1
# (2026-08-22, item 40). The default when the caller named NO pathspec was `SPECS=(".")`, which the
# rewriting rule below turned into `:(top).` — a pathspec git matches against NOTHING. Measured at
# 89018893, and note that the standing place does NOT change it:
#
#     git grep --full-name -l 'class' HEAD -- ':(top).'   ->     0   from EITHER directory
#     git grep --full-name -l 'class' HEAD -- ':(top)'    ->  1804
#     git grep --full-name -l 'class' HEAD                ->   641   (narrowed to cwd)
#
# 🔴 THE SECOND COLUMN IS WHY --self-test DID NOT CATCH IT, and it is worth stating as a property
# rather than as an oversight: the broken default is PERFECTLY cwd-INVARIANT — invariantly zero —
# so assertion (a), the only property this self-test asserted about the default, was SATISFIED by
# the defect. The probe never reached the default path at all, because every self-test reading
# passed an explicit pathspec. A self-test can be blind exactly where its subject is blind.
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
#     6. 🔴 THE DOMAIN IS COUNTED BEFORE THE PATTERN IS RUN, AND AN EMPTY DOMAIN IS REFUSED, NOT
#        REPORTED. `files in scope` is measured with `git ls-files --with-tree=<SHA>` (plain `git
#        ls-files` for the working tree) over the SAME rewritten pathspecs — see domain_size() for
#        why it is not `ls-tree`. If it is 0 the tool exits 2 and prints no
#        count, because a `0` matches over `0` files is not a fact about the pattern. This is what
#        makes the sentence in the header — "1 means NO MATCH, which is a measurement" — TRUE
#        rather than structural: exit 1 is now only reachable with a non-empty domain behind it.
#        It is the same refusal, and the same reasoning, as the missing-PATTERN guard further down.
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
#     f. 🔴 THE EMPTY-DOMAIN REFUSAL DOES NOT MAKE A NON-EMPTY DOMAIN THE RIGHT ONE. It separates
#        "0 files were in scope" from "0 of N files matched"; it cannot tell you that N was the N
#        you meant. `-- 'docs/*.md'` over a tree whose docs live elsewhere selects a non-empty N
#        and answers a question you did not ask. The refusal catches a domain narrowed to NOTHING,
#        which is the shape item 32 is about; it does not catch a domain narrowed to the WRONG
#        SOMETHING, and no check in this file does.
#
# Usage:
#   scripts/repo-scan.sh [--sha <tree-ish>] [--] <git-grep-arg>... [-- <pathspec>...]
#   scripts/repo-scan.sh --self-test
#
#   With no `-- <pathspec>`, the scan covers THE WHOLE TREE (`:(top)`). It is never narrowed to the
#   directory you typed it in, and it is never narrowed to nothing.
#
# Exit: 0 matches found · 1 no match over a NON-EMPTY domain (NOT an error — read the header)
#       2 usage/setup failure, INCLUDING a pathspec that selects no files at all
#       --self-test: 0 all assertions hold · 1 one or more do not
# ═════════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail

CALLER_PWD="$(pwd -P)"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "repo-scan: not inside a git work tree (cwd: $CALLER_PWD)" >&2; exit 2; }

# Resolved BEFORE anything chdirs, because the self-test re-invokes this file as a subprocess from
# other directories and `$0` may have arrived relative.
SELF_ABS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/$(basename "${BASH_SOURCE[0]}")"

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

# 🔴 THE DEFAULT WHEN THE CALLER NAMES NO PATHSPEC — the line this task exists to fix. It is a
# FUNCTION for the same reason `rewrite_pathspec` is one: the self-test must measure the value the
# main path actually uses, not a literal the self-test wrote for itself. `:(top)` is the whole tree;
# the previous value `.` became `:(top).`, which git matches against nothing at all.
default_pathspec() { printf ':(top)'; }

# ── how many FILES the rewritten pathspecs select, before any pattern is applied ──────────────────
# The separation this whole file is about, in one measurement: `0 matches` is only a fact about the
# pattern if the set it searched was non-empty. `git grep` will not tell you the difference, so it
# is asked here, of the same tree-ish and the same rewritten specs.
#
# 🔴 IT IS `ls-files --with-tree` AND NOT `ls-tree -r`, AND THE FIRST DRAFT OF THIS FUNCTION GOT IT
# WRONG. `git ls-tree` does not honour wildcard pathspecs the way `git grep` does — measured at
# 89018893 with git 2.55.0.windows.3, the SAME pathspec on the SAME commit:
#
#     git grep  -l -e '' <SHA> -- ':(top)tools/machine-simulator/scripts/*.sh'  ->  5
#     git ls-files --with-tree=<SHA> -- ':(top)tools/machine-simulator/scripts/*.sh'  ->  5
#     git ls-tree -r --name-only <SHA> -- ':(top)tools/machine-simulator/scripts/*.sh'  ->  0
#
# and likewise 1534 / 1534 / 0 for ':(top)server/*.ts'. An `ls-tree` domain would therefore have
# REFUSED a large class of perfectly good scans as "empty domain" — trading a silent wrong zero for
# a loud wrong refusal, which is not an improvement. Caught by assertion (f) below, which went RED
# on the first run of this very change; the probe it reddened on was `scripts/*.sh`.
#
# The remaining inexactness is stated rather than hidden: `--with-tree` lists the INDEX UNIONED WITH
# the tree, so a path staged-but-not-in-<SHA> counts toward the domain. That direction is the safe
# one — it can only make an empty domain look non-empty, never the reverse — so it cannot cause a
# false refusal. It can in principle let a genuinely empty domain through as exit 1; a scan of a
# tree-ish far from the index is where to expect that.
domain_size() {                                # $1 = SHA or empty for working tree; $2.. = specs
  local sha="$1"; shift
  (cd "$ROOT" && { if [[ -n "$sha" ]]; then git ls-files --with-tree="$sha" -- "$@"
                   else                    git ls-files                    -- "$@"; fi; } 2>/dev/null) \
    | grep -c . || true
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

  # ═══ (d)(e)(f) THE DEFAULT PATH — added by BA-1 because (a)(b)(c) NEVER WALKED IT ═══════════════
  # 🔴 Every reading above passes an explicit pathspec, so all three assertions stayed green for the
  # whole life of the `SPECS=(".")` default. The three below are the no-pathspec case, and they are
  # run through the CLI as a SUBPROCESS — not by calling the parse logic in-process — because what
  # broke was the WIRING between "caller named no pathspec" and "what git was handed".
  local dom_default dom_top def_n empty_rc nomatch_rc
  local rooted_default; rooted_default="$(rewrite_pathspec "$(default_pathspec)")"
  dom_default=$(domain_size "$probe_sha" "$rooted_default")
  dom_top=$(domain_size "$probe_sha" ':(top)')

  # (d) the default must name the WHOLE TREE. Stated as an equality against `:(top)` rather than as
  # "> 0", because ">0" would also accept a default that quietly covered some smaller slice.
  echo "  default pathspec '$(default_pathspec)' selects       : $dom_default files"
  echo "  explicit ':(top)' selects                  : $dom_top files"
  if [[ "$dom_top" -eq 0 ]]; then
    echo "FAIL: even ':(top)' selects no files at $probe_sha. The domain probe itself is broken; every
      assertion below it would be two zeroes agreeing." >&2
    rc=1
  elif [[ "$dom_default" != "$dom_top" ]]; then
    echo "FAIL: the NO-PATHSPEC DEFAULT selects $dom_default files but the whole tree is $dom_top. A scan
      that names no pathspec is being silently narrowed, and with $dom_default = 0 it returns a clean-
      looking 0 for every pattern on earth. This is docs/owner-decisions.md item 40 reoccurring —
      see default_pathspec() above; the value that caused it was '.', becoming ':(top).'." >&2
    rc=1
  fi

  # (e) and (f) are the two banks of the same claim, and neither alone is worth anything: a tool
  # that refused EVERY zero would be useless, and a tool that reported every zero is what item 32
  # is about. So both are pinned — an empty domain must be REFUSED (2), and a genuine no-match over
  # a non-empty domain must still be REPORTED (1).
  # 🔴 THE ABSENT PATTERN IS GENERATED AT RUN TIME, AND THE FIRST VERSION OF THIS WAS A LITERAL.
  # It read 'zzq-no-such-pattern-zzq', and the assertion below went RED in the gate the moment this
  # file was committed: the literal now lived in the very tree the probe scans, so the "true
  # no-match" scan found ITSELF and exited 0. That is the self-reference species this task retracted
  # two published numbers for (docs/owner-decisions.md item 40 §1(d)) — a scan for a string, run over
  # a tree that contains the scan, measures its own source. A nonce cannot be in a committed tree.
  local absent="zzq-absent-probe-$$-$(date +%s)-${RANDOM}"
  (cd "$sub" && bash "$SELF_ABS" --sha "$probe_sha" -l -F "$absent" \
       -- 'no/such/directory/anywhere/*.zzz') >/dev/null 2>&1; empty_rc=$?
  (cd "$sub" && bash "$SELF_ABS" --sha "$probe_sha" -l -F "$absent" \
       -- 'tools/machine-simulator/scripts/*.sh') >/dev/null 2>&1; nomatch_rc=$?
  echo "  empty domain -> exit                       : $empty_rc   (must be 2, REFUSED)"
  echo "  true no-match over a real domain -> exit   : $nomatch_rc   (must be 1, MEASURED)"
  if [[ "$empty_rc" -ne 2 ]]; then
    echo "FAIL: a pathspec selecting zero files exited $empty_rc, not 2. The wrapper is again presenting
      an empty domain as a result, which is the sentence 'result lines : 0' meaning nothing." >&2
    rc=1
  fi
  if [[ "$nomatch_rc" -ne 1 ]]; then
    echo "FAIL: a genuine no-match over a non-empty domain exited $nomatch_rc, not 1. The empty-domain
      refusal has swallowed the true negative it was supposed to be distinguishable FROM; the tool
      can no longer report 'searched, found nothing', which is a measurement callers need." >&2
    rc=1
  fi

  # (g) end-to-end through the CLI with NO pathspec at all. (d) proves the default names the whole
  # tree; this proves the default is actually REACHED by an invocation that omits `--`.
  def_n=$( (cd "$sub" && bash "$SELF_ABS" --sha "$probe_sha" -l "$probe_pat" 2>/dev/null) | grep -c . || true)
  echo "  CLI, no pathspec, '$probe_pat'                : $def_n files matched"
  if [[ "$def_n" -eq 0 ]]; then
    echo "FAIL: the CLI with no '--' returned 0 for '$probe_pat', which the whole tree does contain. The
      default is not being reached, or is being rewritten into something empty." >&2
    rc=1
  fi

  # The population protocol (verify-suites.sh run_tooling_check, docs/owner-decisions.md item 40).
  # The sets every assertion above quantifies over: the default pathspec's domain — the one whose
  # collapse to 0 WAS the defect — and the probe's own match count, which is what makes (a)'s
  # cwd-invariance an agreement between two real numbers rather than between two zeroes.
  echo "POPULATION default-domain $dom_default"
  echo "POPULATION probe-matches $from_root"

  [[ $rc -eq 0 ]] && echo "PASS: rooted scans are cwd-invariant ($from_root from both places) while the naive form loses $((from_root - naive)); the no-pathspec default covers the whole tree ($dom_default files); empty domain refused (2) and true no-match reported (1)."
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
[[ ${#SPECS[@]} -eq 0 ]] && SPECS=("$(default_pathspec)")

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

# 🔴 THE DOMAIN IS COUNTED BEFORE THE PATTERN IS RUN. Everything above this line describes WHERE the
# scan will look; this is the first line that measures whether "where" contains anything. It is done
# before the grep on purpose — a refusal must not depend on how long the search took.
DOMAIN=$(domain_size "$SHA" "${ROOTED[@]}")

_claim() {
  echo "── repo-scan domain claim ──────────────────────────────────────────────────────────────"
  echo "  typed from   : $CALLER_PWD"
  echo "  ran from     : $ROOT   (the wrapper chdirs; your directory did not narrow this)"
  echo "  scanned      : $SHA_LABEL"
  echo "  worktree     : $DIRTY"
  echo "  pathspecs    : ${SPECS[*]}   ->   ${ROOTED[*]}"
  echo "  files in scope: $DOMAIN   (git ls-files${SHA:+ --with-tree} over those same rewritten pathspecs, before any pattern)"
}

# 🔴 THE REFUSAL THIS TASK EXISTS FOR. A pathspec that selects NO FILES cannot produce a fact about
# the pattern, so no count is printed and exit 1 is not used: exit 1 is reserved for "searched N
# files, matched none", and that sentence must stay true. This is the same shape as the missing-
# PATTERN guard above — a 0 with no question asked, versus a 0 with nowhere to ask it.
if [[ "$DOMAIN" -eq 0 ]]; then
  { _claim
    echo "  result       : REFUSED — the pathspecs above select ZERO FILES at the scanned tree-ish."
    echo "────────────────────────────────────────────────────────────────────────────────────────"
    echo "repo-scan: EMPTY DOMAIN, not a measurement. git grep would have printed nothing and exited
       1, and that 0 would have been indistinguishable from a true negative — the exact defect of
       docs/owner-decisions.md item 32, and the defect this wrapper itself shipped with (item 40).
       Check the pathspec: it is applied from the REPO ROOT, so it must be repo-root-relative.
       Nothing is claimed about '${ARGS[*]}' by this run."
  } >&2
  exit 2
fi

OUT=$(cd "$ROOT" && { if [[ -n "$SHA" ]]; then git grep --full-name "${ARGS[@]}" "$SHA" -- "${ROOTED[@]}"
                      else                    git grep --full-name "${ARGS[@]}"        -- "${ROOTED[@]}"; fi; } 2>&1)
RC=$?
COUNT=$(printf '%s\n' "$OUT" | grep -c . || true)
[[ -z "$OUT" ]] && COUNT=0

{
  _claim
  echo "  argv         : git grep --full-name ${ARGS[*]} ${SHA:+$SHA }-- ${ROOTED[*]}"
  echo "  result lines : $COUNT   (exit $RC; 1 means NO MATCH AMONG THOSE $DOMAIN FILES — a
       measurement, not an error. The domain was counted above and is non-empty, which is what
       makes this sentence true rather than merely printed.)"
  echo "────────────────────────────────────────────────────────────────────────────────────────"
} >&2

[[ -n "$OUT" ]] && printf '%s\n' "$OUT"
exit $RC
