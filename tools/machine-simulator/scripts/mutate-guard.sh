#!/usr/bin/env bash
# mutate-guard.sh — give the mutation harness the gate's first check.
#
# WHY THIS EXISTS
# ---------------
# `scripts/verify-suites.sh` refuses to read any test number until the build reports
# 0 errors, because "an absent negative read as a positive" is the shape of every trap
# this project has hit. Ad-hoc mutation runs bypass that gate entirely — and that is
# exactly when someone is most likely to trust a bare `Passed!`.
#
# Four people have now walked into it on this batch. The sharpest account, from the D-2
# implementer, was written while it was happening:
#
#   "I mutated the link to throw TimeoutException, read PASSED, and was about to report
#    that the assertion had no teeth. It was a stale binary: the build in that same
#    command had failed and --no-build ran the previous DLL. Rebuilt properly, the mutant
#    writes 32 bytes — four attempts — against the asserted 8. This is the third
#    recurrence in this task, and I walked into it while writing the paragraph about
#    walking into it."
#
# A mutation harness asserts "the test failed". It has never asserted "…and I ran the
# thing I just wrote". These two checks are that.
#
# WHY NOT JUST BAN --no-build
# ---------------------------
# Because dropping the flag does NOT guarantee a rebuild — MSBuild's up-to-date check can
# still skip it, which is the same trap from the other direction. The mtime comparison
# closes both, and it is an assertion the harness makes about its own state rather than a
# rule a human has to remember. Ban the flag too; it is the weakest of the three.
#
# WHAT THE MTIME CHECK CANNOT SEE
# -------------------------------
# A wrong --filter, the wrong assembly, a test-discovery failure, or a pattern that applied
# to dead code. All of those produce a confident SURVIVED with a perfectly fresh binary.
# Only a POSITIVE CONTROL catches them: one known-lethal mutation must be reported KILLED
# in the same session before any SURVIVED in that session is believable.
#
# The D-2 reviewer hit exactly this and said so: its first batch reported NOT-APPLIED five
# times because `python` is absent from this shell and its script read a non-zero exit as
# "the pattern didn't match". It caught that only because five-for-five is implausible —
# "which is a judgement call, not a check."
#
# USAGE
#   scripts/mutate-guard.sh fresh  <assembly.dll> <mutated-source.cs>   # before trusting a verdict
#   scripts/mutate-guard.sh control <"KILLED"|"SURVIVED">               # record the session's control
#   scripts/mutate-guard.sh check                                       # may I believe a SURVIVED?

set -uo pipefail
STATE="${TMPDIR:-/tmp}/st4i-mutate-control-$PPID"

case "${1:-}" in
  fresh)
    asm="${2:?assembly path}"; src="${3:?mutated source path}"
    [[ -f "$asm" ]] || { echo "NO-VERDICT: assembly does not exist: $asm"; exit 3; }
    [[ -f "$src" ]] || { echo "NO-VERDICT: source does not exist: $src"; exit 3; }
    if [[ ! "$asm" -nt "$src" ]]; then
      echo "NO-VERDICT: STALE BINARY — $(basename "$asm") is not newer than $(basename "$src")."
      echo "  The run you are about to read did not execute the code you just wrote."
      exit 3
    fi
    echo "fresh: $(basename "$asm") is newer than $(basename "$src")"
    ;;

  control)
    verdict="${2:?KILLED or SURVIVED}"
    if [[ "$verdict" == "KILLED" ]]; then
      echo "ok" > "$STATE"
      echo "positive control KILLED — SURVIVED verdicts in this session are now believable"
    else
      rm -f "$STATE"
      echo "NO-VERDICT: the positive control was NOT killed."
      echo "  A known-lethal mutation that survives means the harness is not measuring what"
      echo "  you think — wrong filter, wrong assembly, failed discovery, or dead code path."
      echo "  Every SURVIVED in this session is meaningless until this passes."
      exit 3
    fi
    ;;

  check)
    if [[ -f "$STATE" ]]; then
      echo "positive control on record — SURVIVED is meaningful"
    else
      echo "NO-VERDICT: no positive control recorded this session."
      echo "  Run one known-lethal mutation first and record it with: mutate-guard.sh control KILLED"
      exit 3
    fi
    ;;

  *)
    sed -n '2,40p' "$0"
    exit 2
    ;;
esac
