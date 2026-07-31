#!/usr/bin/env bash
# verify-suites.sh — assert a POSITIVE expected quantity, never the absence of failure.
#
# WHY THIS EXISTS
# ---------------
# Đợt C hit seven distinct verification traps. Five produced a GREEN-LOOKING NUMBER,
# and four of those survive an exit-code check:
#
#   1. An orphaned `testhost` held file locks -> the build emitted errors, a project
#      never relinked, and the suite that followed ran against a half-copied output
#      directory and cascaded into ~100 bogus failures.
#   2. A crashed test host -> vstest printed `Passed!  - Failed: 0, Passed: 606`
#      with a TRUNCATED TOTAL, after a clean build, with exit code 0. The real
#      number was 735. This is the dangerous one: it looks like success.
#   3. A mutation that silently failed to apply -> a clean run that reads as
#      "the mutation survived, therefore this code is untested".
#   4. A stale binary after a skipped rebuild -> a spurious failure, nearly reported
#      as a defect. The batch already had a written rule against this and both an
#      implementer and a reviewer still walked into it.
#   5. Vacuous tests -> seven caught in this project, EVERY ONE by mutation and
#      NONE by reading, including two written by authors who had just read a report
#      about that exact failure mode.
#   6. A genuinely hung suite -> the host stays alive, nothing is printed, and the
#      run never ends. Handled by the CPU sample below.
#   7. 🔴 THIS SCRIPT'S OWN HANG CHECK, on its first real run (C-7), and it was wrong
#      TWICE for two different reasons:
#        (a) it sampled `ps -W | awk '{print $NF}'`, which on Windows is the
#            executable PATH -- a CONSTANT -- so the two samples always matched and
#            EVERY suite running longer than 90s was killed and reported HUNG. It
#            killed the two largest suites and passed the three short ones, which is
#            exactly what makes the verdict look plausible.
#        (b) with a REAL CPU sample in place, one flat 30s window still is not a
#            hang: a suite awaiting a timer burns no CPU. The very next run killed a
#            suite that had passed 735/735 minutes earlier. It now needs several
#            consecutive flat windows.
#      Both fixes, and why the tolerance is deliberately lopsided, are at the check.
#
# The shape of 1-5 is always the same: AN ABSENT NEGATIVE READ AS A POSITIVE. Trap 7
# is its inversion -- A HEALTHY POSITIVE READ AS A FAILURE -- and it costs the same,
# because a verification tool that cries wolf gets its output ignored. Awareness of a
# failure mode does not prevent it; only a check that runs every time does. So this
# asserts exact totals rather than "no failures", and refuses to look at any test
# number until the build reports 0 errors.
#
# USAGE
#   scripts/verify-suites.sh                 # verify against the expected totals below
#   scripts/verify-suites.sh --update        # print the observed totals, to update them
#
# Run from tools/machine-simulator. Prints exactly one PASS/FAIL line at the end.

set -uo pipefail

# Expected per-suite totals. Update deliberately when a task adds tests, and state
# the new numbers in the task report -- a changed total is a fact to be justified,
# not a number to be pasted over.
EXPECT_ABSTRACTIONS=151
EXPECT_CONFORMANCE=22
EXPECT_EDGECORE=735
EXPECT_EDGESERVICE=28
# Task C-7 raised this from 1087 to 1116: +29 tests, all in St4i.EngineApi.Tests.
#   +24  NotificationEndpointsTests           (new file — the eleven notification routes)
#   + 2  RbacPolicyTests                      (the relay Admin gate end to end; the reads not being Operator)
#   + 2  AlarmAnnunciationStreamTests         (the SSE subscriber cap's 503; the shipped cap's value)
#   + 1  LocalAnnunciationChannelTests        (the hub-level subscriber cap)
# No other suite is touched: C-7 adds no code outside St4i.EngineApi.
EXPECT_ENGINEAPI=1116

SUITES=(
  "tests/St4i.Connector.Abstractions.Tests:$EXPECT_ABSTRACTIONS"
  "tests/St4i.Connector.Conformance.Tests:$EXPECT_CONFORMANCE"
  "tests/St4i.EdgeCore.Tests:$EXPECT_EDGECORE"
  "tests/St4i.EdgeService.Tests:$EXPECT_EDGESERVICE"
  "tests/St4i.EngineApi.Tests:$EXPECT_ENGINEAPI"
)

LOGDIR="${TMPDIR:-/tmp}/st4i-verify-$$"
mkdir -p "$LOGDIR"
FAILURES=()
UPDATE=0
[[ "${1:-}" == "--update" ]] && UPDATE=1

note() { printf '  %s\n' "$*"; }

# Total processor SECONDS consumed by every live `testhost` process, as a float, or the
# empty string when there is none (or when PowerShell is unavailable). See the hang
# check below for why this cannot be `ps`: Windows' `ps` has no CPU column at all.
# Empty must read as "cannot tell", never as "flat".
testhost_cpu_seconds() {
  powershell -NoProfile -NonInteractive -Command \
    "(Get-Process testhost -ErrorAction SilentlyContinue | Measure-Object -Property CPU -Sum).Sum" \
    2>/dev/null | tr -d '\r' | head -1
}

# ── Gate 1: the build. Nothing below is trustworthy until this passes. ───────────
# Trap 1 and 4. Read the LOG, not the exit code: a locked file can leave a project
# unrelinked while the overall invocation still reports success.
echo "[1/3] Killing stray test hosts, then rebuilding..."
taskkill //F //IM testhost.exe //T >/dev/null 2>&1 || true
taskkill //F //IM vstest.console.exe //T >/dev/null 2>&1 || true
dotnet build-server shutdown >/dev/null 2>&1 || true

BUILD_LOG="$LOGDIR/build.log"
dotnet build -t:Rebuild --nologo > "$BUILD_LOG" 2>&1 || true

if ! grep -qE '^ *0 Error\(s\)' "$BUILD_LOG"; then
  echo "FAIL: build did not report 0 errors. Refusing to read any test count."
  grep -E 'error |Error\(s\)' "$BUILD_LOG" | head -20
  echo "  full log: $BUILD_LOG"
  exit 1
fi
WARNINGS=$(grep -oE '^ *[0-9]+ Warning\(s\)' "$BUILD_LOG" | grep -oE '[0-9]+' | head -1)
note "build: 0 errors, ${WARNINGS} warnings (only comparable from -t:Rebuild on an unlocked tree)"

# ── Gate 2: each suite, sequentially, asserting an EXACT total. ──────────────────
# Trap 2. `Failed: 0` is not evidence: an aborted run prints it with a short total.
echo "[2/3] Running ${#SUITES[@]} suites sequentially..."
for entry in "${SUITES[@]}"; do
  proj="${entry%%:*}"; expected="${entry##*:}"; name=$(basename "$proj")
  log="$LOGDIR/$name.log"
  dotnet test "$proj" --no-build --nologo -v q > "$log" 2>&1 &
  test_pid=$!

  # Trap 6, and it is the GENERATOR of traps 1 and 4: a hung suite forces a kill, a
  # kill orphans a test host, an orphaned host breaks the next build, and a broken
  # build produces numbers that read as a code regression. Sample the host's CPU
  # twice -- FLAT while the process is alive means hung; CLIMBING means merely slow.
  # That one call is the whole difference between "wait longer" and "this is stuck".
  #
  # 🔴 TRAP 7, and it was IN THIS SCRIPT (found by C-7, on its first real run). The
  # sample used to be `ps -W | grep testhost | awk '{print $NF}'`. In Git Bash, `ps -W`
  # prints  PID PPID PGID WINPID TTY UID STIME COMMAND  -- so $NF is the executable
  # PATH, a CONSTANT. cpu1 and cpu2 were therefore ALWAYS equal, and every suite that
  # ran longer than 90s was killed and reported HUNG. On this tree that was EdgeCore
  # (735 tests) and EngineApi (1115) -- i.e. the two suites that matter most -- while
  # the three short ones passed, which is what makes the verdict look plausible.
  #
  # It is the exact inversion of what this script exists to prevent: instead of an
  # absent negative read as a positive, a healthy positive read as a failure. A
  # verification tool that cries wolf gets its output ignored, which costs the same as
  # not having it. `ps` on Windows carries no CPU column at all, so the sample now
  # comes from PowerShell's Get-Process, which reports total processor SECONDS as a
  # float. An empty sample (no host yet, or no PowerShell) still means "cannot tell",
  # never "hung" -- the guard below is unchanged in that respect.
  #
  # 🔴 AND ONE FLAT SAMPLE IS NOT A HANG. With the sample fixed above, the very next run killed
  # EdgeCore -- a suite that had completed 735/735 minutes earlier -- reporting CPU flat at
  # 7.7s across 30s. It was not hung: a suite that legitimately AWAITS a timer (this repository
  # has spool, WAL-maintenance and retry-backoff tests that do) burns no CPU while it waits, and
  # is indistinguishable from a hang over any single window. So the fast path now needs
  # 🔴 TRAP 7(c), found by C-7's review AFTER 7(a) and 7(b) were fixed. The comparison used to
  # be WITHIN one window only -- cpu1 at t+60, cpu2 at t+90 -- so the 60s BETWEEN windows was
  # never compared to anything. A suite busy in the unsampled gaps and idle across each sampled
  # window reads as flat five times running and is killed, while the very notes it prints show
  # the number CLIMBING (10s, 20s, 30s...). Not exotic on this repo: Windows quantises
  # TotalProcessorTime to the scheduler tick, so an I/O-bound suite (SQLite fsync, socket waits)
  # genuinely reads identical across 30s while making real progress. The fix is one variable --
  # carry the LAST OBSERVED sample across iterations, so "flat" means flat across the whole
  # elapsed period rather than across a sampling window we happened to choose.
  #
  # Tolerance, stated correctly (the first version of this comment was wrong by ~3x, which is
  # exactly the sort of number a future maintainer would tune from): each iteration costs
  # sleep 60 + sleep 30 = 90s, so HUNG_SAMPLES=5 means a legitimate idle survives ~7.5 minutes
  # and a genuine hang is caught ~7.5 minutes late. That trade is deliberately lopsided, because
  # the two errors do not cost the same: waiting out a real hang costs minutes, while killing a
  # healthy suite costs the whole run, orphans a test host, and breaks the NEXT build -- which
  # is trap 1, manufactured by the checker itself.
  HUNG_SAMPLES=5
  hung=0
  flat=0
  last_cpu=""
  while kill -0 "$test_pid" 2>/dev/null; do
    sleep 60
    kill -0 "$test_pid" 2>/dev/null || break
    cpu1=$(testhost_cpu_seconds)
    sleep 30
    cpu2=$(testhost_cpu_seconds)

    # Flat means flat against BOTH the in-window sample and the previous iteration's reading.
    # An empty sample means "cannot tell" and must never read as "flat".
    if [[ -z "${cpu1:-}" || -z "${cpu2:-}" ]] \
       || [[ "$cpu1" != "$cpu2" ]] \
       || { [[ -n "$last_cpu" ]] && [[ "$cpu2" != "$last_cpu" ]]; }; then
      flat=0            # progress somewhere, or nothing to sample -- either way, not a hang
      last_cpu="${cpu2:-$last_cpu}"
      continue
    fi

    last_cpu="$cpu2"
    flat=$((flat + 1))
    if [[ $flat -lt $HUNG_SAMPLES ]]; then
      note "$name: no CPU progress for 90s (${flat}/${HUNG_SAMPLES}) at ${cpu1}s -- waiting, a suite may be awaiting a timer"
      continue
    fi

    hung=1
    note "$name: HUNG (test host CPU flat at ${cpu1}s of processor time across ${HUNG_SAMPLES} consecutive 90s periods while alive) -- killing"
    kill -9 "$test_pid" 2>/dev/null || true
    taskkill //F //IM testhost.exe //T >/dev/null 2>&1 || true
    break
  done
  wait "$test_pid" 2>/dev/null || true

  if [[ $hung -eq 1 ]]; then
    FAILURES+=("$name: HUNG and was killed -- rebuild before trusting anything that follows")
    continue
  fi

  # Anchor to vstest's OWN summary token. The unanchored form matched TEST NAMES --
  # `Abort_FromExecute_TransitionsToAborted_...`, `Reset_FromAborted_...` all print under -v q
  # when they fail -- so an ordinary red test was reported as a host crash and the loop skipped
  # reading the real counts, sending the next reader hunting a phantom. It could not produce a
  # false green, only a misleading red; but a checker that misattributes failures gets ignored
  # just as fast as one that cries wolf.
  if grep -qE '^Aborted!|Test host process crashed' "$log"; then
    FAILURES+=("$name: run ABORTED (host crash) -- any count printed is truncated")
    note "$name: ABORTED"
    continue
  fi

  total=$(grep -oE 'Total: *[0-9]+' "$log" | grep -oE '[0-9]+' | tail -1)
  failed=$(grep -oE 'Failed: *[0-9]+' "$log" | grep -oE '[0-9]+' | tail -1)
  skipped=$(grep -oE 'Skipped: *[0-9]+' "$log" | grep -oE '[0-9]+' | tail -1)

  if [[ -z "${total:-}" ]]; then
    FAILURES+=("$name: no Total line -- the suite produced no result at all")
    note "$name: NO RESULT LINE"
    continue
  fi
  [[ "${failed:-0}" != "0" ]] && FAILURES+=("$name: ${failed} failed")
  [[ "${skipped:-0}" != "0" ]] && FAILURES+=("$name: ${skipped} skipped (this repo expects 0)")
  if [[ "$total" != "$expected" ]]; then
    FAILURES+=("$name: total ${total}, expected ${expected} -- discovery loss or an unjustified change")
  fi
  note "$name: ${total}/${expected} total, ${failed:-?} failed, ${skipped:-?} skipped"
  eval "OBSERVED_${name//[.-]/_}=$total"
done

# ── Gate 3: the verdict, as one line. ───────────────────────────────────────────
echo "[3/3] Verdict:"
if [[ $UPDATE -eq 1 ]]; then
  echo "Observed totals (paste into the EXPECT_* constants above, and justify each change):"
  for entry in "${SUITES[@]}"; do
    name=$(basename "${entry%%:*}"); var="OBSERVED_${name//[.-]/_}"
    echo "  $name = ${!var:-<no result>}"
  done
fi

if [[ ${#FAILURES[@]} -eq 0 ]]; then
  grand=$((EXPECT_ABSTRACTIONS + EXPECT_CONFORMANCE + EXPECT_EDGECORE + EXPECT_EDGESERVICE + EXPECT_ENGINEAPI))
  echo "PASS: 0 build errors, ${#SUITES[@]}/${#SUITES[@]} suites at their exact expected totals (${grand}), 0 failed, 0 skipped, none aborted."
  exit 0
fi
echo "FAIL:"
printf '  - %s\n' "${FAILURES[@]}"
echo "  logs: $LOGDIR"
exit 1
