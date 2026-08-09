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
# 🔴 COMMIT BEFORE YOU MUTATE. `clean` below checks for mutation RESIDUE; nothing here
# checks that the tree you are about to restore is one you can afford to lose, and the
# restore path everyone reaches for is `git checkout -- <file>` — which reverts the
# WHOLE file to HEAD, not just the mutation. G-1's implementer lost an entire task's
# uncommitted work to exactly that, twice in one session, the second time on the census
# pass that followed the first recovery. The mutation round is cheap to repeat; the work
# it is measuring is not. Commit first, then mutate, then `git checkout --` freely.
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
# USAGE — all five verbs. Run them in this order around a mutation round.
#   scripts/mutate-guard.sh clean   <path...>                          # BEFORE anything, esp. after an
#                                                                      #   interrupted run: refuses if a
#                                                                      #   mutant or .bak is still live
#   scripts/mutate-guard.sh control <"KILLED"|"SURVIVED">              # record the session's control
#   scripts/mutate-guard.sh applied <source.cs> <marker>               # PER MUTATION: is it really there?
#   scripts/mutate-guard.sh fresh   <assembly.dll> <mutated-source.cs> # did the build see it?
#   scripts/mutate-guard.sh check                                      # may I believe a SURVIVED?
#
# `applied` turned out to catch a DIFFERENT and more common failure than the one it was
# written for. In its first real round it caught NO false SURVIVED — it caught FOUR
# mutations that never reached the code at all: regexes that silently missed or mangled
# their target, three of which also failed to compile the way the author intended. Under
# the old harness each would have printed SURVIVED and been believed, because — as D-3 put
# it — "five clean green mutations look exactly like 'this code is untested'." That is the
# failure a human is least likely to question.

set -uo pipefail

# 🔴 D-6 concern 6 — this used to key on $PPID, and that made `control` and `check` unable to
# see each other from any runner that does not hold ONE shell open across the whole round. An
# agent harness starts a fresh process per command, so `control KILLED` was recorded under one
# PPID and `check` looked under another and reported "no positive control recorded" — the
# script's own refusal, fired at a session that had done exactly what it asked.
#
# Nothing was lost when it was found (no mutation SURVIVED that round, so the gate had nothing
# to carry) and that is precisely why it is worth fixing now: a check that misfires only when
# it does not matter is a check that gets ignored by the time it does. Note the direction of
# the failure — it was SAFE (a false NO-VERDICT, never a false "believable"), which is the
# right way for this script to break, and still not free.
#
# Keyed on the tree instead: stable across processes, distinct per checkout, and two concurrent
# rounds on ONE tree now collide deliberately rather than silently running blind. Override with
# ST4I_MUTATE_SESSION if you genuinely want two independent rounds in one tree.
_tree_key=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd | tr -c '[:alnum:]' '-')
STATE="${TMPDIR:-/tmp}/st4i-mutate-control-${ST4I_MUTATE_SESSION:-$_tree_key}"

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

  applied)
    # 🔴 THE HOLE `control` DOES NOT COVER, found by D-3 reporting a false SURVIVED it was
    # not obliged to report. Its session control was KILLED and on record, so by this
    # script's own rule the verdict was "believable" — and it was false: the mutation had
    # not reached the built source. Re-applied by hand it killed the test immediately.
    #
    # THE SHAPE: `control KILLED` is PER-SESSION; a mis-applied mutation is PER-MUTATION.
    # A believable session can still contain an unbelievable verdict. What caught it was
    # the result being implausible plus a stray `mv: cannot stat` — a judgement call, which
    # is precisely what this script exists to replace.
    #
    # So: grep the source for the mutation's own marker AFTER the build, not merely trust
    # that the edit applied before it.
    src="${2:?source path}"; marker="${3:?a distinctive string from the mutation}"
    [[ -f "$src" ]] || { echo "NO-VERDICT: source does not exist: $src"; exit 3; }
    if ! grep -qF -- "$marker" "$src"; then
      echo "NO-VERDICT: the mutation is NOT in $(basename "$src")."
      echo "  Marker not found: $marker"
      echo "  A SURVIVED here means the edit did not apply — not that the code is untested."
      exit 3
    fi
    echo "applied: marker present in $(basename "$src")"
    ;;

  clean)
    # 🔴 D-3's concern 3: a mutation round killed by a tool ceiling left `if (false)` live
    # in a production file with a .bak beside it. An interrupted run does not get to skip
    # this — the next build, verdict or commit after one is worthless until the tree is
    # known clean. Run this before believing anything that follows an interruption.
    shift
    dirty=0
    for p in "$@"; do
      while IFS= read -r f; do
        echo "DIRTY: leftover backup — $f"; dirty=1
      done < <(find "$p" -name '*.bak' -o -name '*.orig' -o -name '*.mutant' 2>/dev/null)
      while IFS= read -r hit; do
        echo "DIRTY: mutant marker still in tree — $hit"; dirty=1
      done < <(grep -rn --include='*.cs' -E 'MUTANT|/\* *mutate *\*/' "$p" 2>/dev/null)
    done
    if [[ $dirty -eq 1 ]]; then
      echo "NO-VERDICT: the tree still contains mutation residue. Restore it (and touch the"
      echo "  restored files, or MSBuild's up-to-date check will skip the rebuild) before"
      echo "  believing any build, test count or commit."
      exit 3
    fi
    echo "clean: no mutant markers, no .bak/.orig/.mutant files"
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
    # Print the whole header, derived — not a hardcoded range. A fixed `2,40p` is what
    # truncated this help the moment the USAGE block grew, which is the defect D-3 reported
    # and which I then half-fixed by extending the block without extending the range.
    sed -n "2,$(( $(awk '/^set -uo pipefail/{print NR; exit}' "$0") - 1 ))p" "$0"
    exit 2
    ;;
esac
