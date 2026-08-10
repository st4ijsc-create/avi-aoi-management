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
# uncommitted work to exactly that, THREE times in one session — the third time AFTER
# writing the warning line above. The mutation round is cheap to repeat; the work it is
# measuring is not.
#
# 🔴 SO USE `restore` INSTEAD OF `git checkout --`. The verb below takes its own snapshot
# first and then does the checkout, so the recovery point exists whether or not anyone
# remembered to commit.
#
# 🔴 AND BE HONEST ABOUT WHAT THAT BUYS (review of the round that added it). The first
# draft of this block said "a written rule is not a trigger; the verb is." Half of that is
# true and half is the same shape this script exists to catch: a claim in the voice of a
# mechanism. NOTHING HERE MAKES `restore` THE PATH OF LEAST RESISTANCE — no wrapper, no
# alias, no hook intercepts `git checkout --`. The third loss happened after the person
# wrote the warning; a fourth can happen after they wrote the verb. What the verb actually
# changes is the OUTCOME when it IS used, not the odds of using it. Closing that gap needs
# something that fires without being chosen, which is a bigger change than this one.
#
# FOUR THINGS IT DOES DIFFERENTLY FROM THE OBVIOUS VERSION, each because the obvious one
# was measured and found wanting:
#
#   1. IT GUARDS THE RESTORE, NOT `fresh`/`applied`. The first proposal was "refuse to run
#      fresh/applied when `git status --porcelain` is non-empty". Re-measured against the
#      three actual losses, that blocks ONE of three. All three happened at the checkout.
#      Guard the destroying verb.
#
#   2. IT SNAPSHOTS RATHER THAN REFUSES. A refusal forbids the edit → test → mutate →
#      commit loop that this very round used, and the way people adapt to a refusal is a
#      reflex `--force`. A snapshot also covers a case no structural refusal can: a file
#      edited WHILE the round is running.
#      🔴 Two DIFFERENT things were being conflated here, and the first draft stated the
#      weaker one three times as if it covered both. (a) The DIRTY CHECK is not
#      load-bearing: it only chooses how loud the message is, so a check that is wrong
#      costs a log line rather than the work. That was true. (b) The SNAPSHOT is
#      load-bearing, and in the first draft its `mkdir`/`cp` were UNCHECKED under
#      `set -uo pipefail` — so a failed copy fell straight through to the checkout and
#      destroyed the file it had not saved. "Unconditional" described the intent, not the
#      code. It now refuses to check out anything it could not first copy; see FAIL
#      CLOSED #3 at the verb.
#
#   3. IT USES `git diff --quiet -- <file>` AND COMPARES NO PATHS BY HAND. The hazard is
#      real and it is worth stating what it actually is, because the version of it I was
#      handed does not survive being run. Porcelain prints paths relative to the REPO
#      ROOT while this script runs from tools/machine-simulator. MEASURED, from this cwd,
#      against a dirty src/St4i.EdgeCore/Fleet/FleetCore.cs:
#        - `git status --porcelain | grep -q "$p"`            -> FIRES (substring hit:
#          the printed path CONTAINS the argument)
#        - `git status --porcelain | awk '{print $2}' | grep -qx "$p"` -> SILENT
#        - `git status --porcelain -- "$p"`                    -> FIRES (git resolved the
#          pathspec itself)
#      So "porcelain never matches" is too strong, and "porcelain is the wrong command"
#      is wrong outright — the third form works. The defect is COMPARING ITS OUTPUT: the
#      exact comparison, which is the natural one to write, is the one that goes silent,
#      and it goes silent in the SAFE-LOOKING direction. `git diff --quiet` has no output
#      to compare, which is why it is used here — not because porcelain normalises line
#      endings differently, which it does not; both go through the same index comparison
#      and the same clean filters.
#      And because the snapshot at point 2 is unconditional, this comparison only decides
#      how loud the message is. A latch whose check is wrong still cannot cost you work.
#
#   4. AN UNTRACKED FILE GETS ITS OWN MESSAGE AND IS NEVER TOUCHED. `git checkout --`
#      cannot restore one — there is nothing in the object store to restore it from — so
#      "I ran the safe restore" must not read as "it was recoverable".
#
# IT ONLY EVER TOUCHES THE PATHS YOU NAME. The report, the inventory and the scratch files
# are allowed to be dirty for the whole round; they are not arguments to this verb, so
# nothing here can refuse, revert or complain about them.
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
# 🔴 THE CONTROL PAIRS WITH THE SUITE THE VERDICT IS READ FROM, NOT WITH THE SESSION (J-1b).
# ---------------------------------------------------------------------------------------
# "In the same session" above is NOT ENOUGH, and this is a carried item rather than one task's
# footnote. A believable session can contain an unbelievable verdict when the control ran
# against ONE suite and the SURVIVED was read from ANOTHER — the control certifies A HARNESS,
# and there is one harness per test project.
#
# MEASURED, J-1b: the control (`_running = true` -> `false` inside FleetCore.StartLocked, which
# makes every single Start() report a stopped fleet) was run against St4i.EngineApi.Tests and
# KILLED 91 tests. A mutation on the SAME LINE OF THE SAME FILE was then read from
# St4i.EdgeCore.Tests and reported "SURVIVED 1093/1093". Re-running the CONTROL against
# St4i.EdgeCore.Tests: it SURVIVES TOO, 1093/1093, on a fresh binary. That suite does not
# observe FleetCore's start/stop state machine at all, so its "SURVIVED" was a NULL RESULT
# wearing the costume of strong negative evidence — and 1093 green tests is a very convincing
# costume.
#
# WHY THIS TRAP IS THE DEFAULT RATHER THAN AN EXOTIC MISTAKE: for a file under
# src/St4i.EdgeCore the WRONG suite is the OBVIOUS one. Nothing about the file's location hints
# that its behaviour is only observable through a live FleetHost in St4i.EngineApi.Tests. It
# has already caught someone mid-measurement-round, which is precisely when a null result is
# most likely to be reported as a finding.
#
# → RULE: RUN THE POSITIVE CONTROL AGAINST THE SAME SUITE YOU WILL READ THE VERDICT FROM.
#   The pairing is per (mutation, suite), never per session. Reading one mutation from two
#   suites needs two controls. If a control survives in a suite, every verdict from that suite
#   is NO-VERDICT — report it as "this harness cannot see this code", never as "this code is
#   untested" and never as "the guard is unwitnessed".
#
# The `control` verb below already refuses correctly (a SURVIVED control exits 3 and voids the
# session). What was missing was never the tool — it was this rule, in the place its users
# actually read. See docs/plans/2026-08-02-dotD-modbus-rtu-blueprint.md §8.1(h)/(h2).
#
# USAGE — all six verbs. Run them in this order around a mutation round.
#   scripts/mutate-guard.sh clean   <path...>                          # BEFORE anything, esp. after an
#                                                                      #   interrupted run: refuses if a
#                                                                      #   mutant or .bak is still live
#   scripts/mutate-guard.sh control <"KILLED"|"SURVIVED">              # record the session's control
#   scripts/mutate-guard.sh applied <source.cs> <marker>               # PER MUTATION: is it really there?
#   scripts/mutate-guard.sh fresh   <assembly.dll> <mutated-source.cs> # did the build see it?
#   scripts/mutate-guard.sh restore <mutated-source.cs...>             # PUT THE FILE BACK — snapshot first,
#                                                                      #   then checkout, then touch. Use
#                                                                      #   this, not `git checkout --`.
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

  restore)
    # 🔴 THE LATCH ON THE DESTROYING VERB. See the "COMMIT BEFORE YOU MUTATE" block in the
    # header for why this exists, why it snapshots instead of refusing, why it uses
    # `git diff` instead of `git status --porcelain`, and why an untracked file is a
    # different message rather than a louder one.
    shift
    [[ $# -gt 0 ]] || { echo "NO-VERDICT: restore needs at least one path"; exit 3; }

    # Outside the tree on purpose: a recovery point inside it would itself be mutation
    # residue, and `clean` above would then refuse the next round because of it.
    recovery="${TMPDIR:-/tmp}/st4i-mutate-recovery-${ST4I_MUTATE_SESSION:-$_tree_key}/$(date -u +%Y%m%dT%H%M%SZ)-$$"
    failed=0

    for p in "$@"; do
      if [[ ! -e "$p" ]]; then
        echo "NO-VERDICT: nothing at $p to restore"; failed=1; continue
      fi

      # 🔴 FAIL CLOSED #1 (review I-6): a DIRECTORY is refused, not snapshotted. `git checkout --`
      # happily accepts a directory pathspec and reverts every file under it, while `cp -p` on a
      # directory does nothing but print "omitting directory" — so the obvious code path takes NO
      # recovery point and then destroys a whole subtree. The brief scopes this verb to the mutated
      # FILE; naming the files is the fix, not teaching this to copy trees.
      if [[ -d "$p" ]]; then
        echo "REFUSED: $p is a directory. This verb restores FILES."
        echo "  \`git checkout -- <dir>\` would revert every file under it, and no snapshot here would"
        echo "  cover them. Name the mutated files instead."
        failed=1
        continue
      fi

      if ! git ls-files --error-unmatch -- "$p" >/dev/null 2>&1; then
        # Point 4. Say the true thing: there is no restore for this, at all.
        echo "UNTRACKED: $p is not in git — \`git checkout --\` CANNOT restore it, and neither can this."
        echo "  Left exactly as it is. If it holds a mutation, undo it by hand; if it holds work, commit it."
        failed=1
        continue
      fi

      # 🔴 FAIL CLOSED #2 (review I-6): `..` in an argument would otherwise write the snapshot
      # OUTSIDE the recovery directory (or over something else). Flatten the path into the file
      # name rather than trusting it as a subpath.
      dest="$recovery/$(printf '%s' "$p" | tr -c '[:alnum:]._-' '-')"

      # Point 2: snapshot UNCONDITIONALLY, before anything is destroyed. The comparison
      # below only chooses the wording.
      #
      # 🔴 FAIL CLOSED #3, AND THIS IS THE ONE THAT MATTERED (review I-6). These two commands used
      # to be unchecked. This script runs `set -uo pipefail` with NO `-e`, so a failed `mkdir` or
      # `cp` — a full disk, a read-only TMPDIR, a permissions problem — printed to stderr and
      # execution fell straight through to the `git checkout` below. A safety latch whose snapshot
      # can fail silently while the destructive step proceeds is WORSE than no latch, because it is
      # trusted. It now refuses to check out anything it could not first copy.
      if ! mkdir -p "$(dirname "$dest")" || ! cp -p -- "$p" "$dest"; then
        echo "NO-VERDICT: could NOT take a recovery point for $p — refusing to check it out."
        echo "  Nothing was destroyed. Fix the snapshot destination (\$TMPDIR: ${TMPDIR:-/tmp}) and retry."
        failed=1
        continue
      fi

      # Point 3: `git diff --quiet -- <path>`. The reason is NOT that porcelain "never matches" and
      # NOT line-ending normalisation — both of those were measured and retracted; see the header
      # block, which carries the three-variant measurement. The reason is that `git diff --quiet`
      # HAS NO OUTPUT TO COMPARE, so the class of defect that silently disables a hand-written path
      # comparison cannot arise here at all. And per the snapshot above, this comparison is not
      # load-bearing anyway: it chooses the wording, never whether the recovery point exists.
      if git diff --quiet -- "$p" && git diff --quiet --cached -- "$p"; then
        echo "restore: $p was identical to HEAD; snapshot kept anyway at $dest"
      else
        echo "🔴 restore: $p had UNCOMMITTED CHANGES, which the checkout below discards."
        echo "  Recovery point: $dest"
      fi

      git checkout -- "$p" || { echo "NO-VERDICT: checkout failed for $p"; failed=1; continue; }
      # The `clean` verb already tells people to do this by hand; doing it here removes
      # the step rather than the reminder.
      touch -- "$p"
    done

    [[ $failed -eq 0 ]] || exit 3
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
