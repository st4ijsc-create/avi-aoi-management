#!/usr/bin/env bash
# verify-suites.sh — assert a POSITIVE expected quantity, never the absence of failure.
#
# WHY THIS EXISTS
# ---------------
# Đợt C hit five distinct verification traps. Every one produced a GREEN-LOOKING
# NUMBER, and four of the five survive an exit-code check:
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
#
# The shape is always the same: AN ABSENT NEGATIVE READ AS A POSITIVE. Awareness of
# a failure mode does not prevent it -- only a check that runs every time does. So
# this asserts exact totals rather than "no failures", and refuses to look at any
# test number until the build reports 0 errors.
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
EXPECT_ENGINEAPI=1087

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
  hung=0
  while kill -0 "$test_pid" 2>/dev/null; do
    sleep 60
    kill -0 "$test_pid" 2>/dev/null || break
    cpu1=$(ps -W 2>/dev/null | grep -i testhost | awk '{print $NF}' | head -1)
    sleep 30
    cpu2=$(ps -W 2>/dev/null | grep -i testhost | awk '{print $NF}' | head -1)
    if [[ -n "${cpu1:-}" && "$cpu1" == "${cpu2:-}" ]]; then
      hung=1
      note "$name: HUNG (test host CPU flat at $cpu1 across 30s while alive) -- killing"
      kill -9 "$test_pid" 2>/dev/null || true
      taskkill //F //IM testhost.exe //T >/dev/null 2>&1 || true
      break
    fi
  done
  wait "$test_pid" 2>/dev/null || true

  if [[ $hung -eq 1 ]]; then
    FAILURES+=("$name: HUNG and was killed -- rebuild before trusting anything that follows")
    continue
  fi

  if grep -qE 'Aborted|Test host process crashed' "$log"; then
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
