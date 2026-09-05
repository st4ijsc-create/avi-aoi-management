#!/usr/bin/env bash
#
# delete-and-redden.sh — mutation sweep for WS-HMI-0b's pinned production lines.
#
# WHY THIS EXISTS, AND WHY IT IS COMMITTED RATHER THAN LIVING IN A TRANSCRIPT
# ---------------------------------------------------------------------------
# A test that is green tells you nothing about whether it would go red. Across WS-HMI-0b,
# three separate rounds saw a repair silently un-pin an EARLIER repair's line, and the only
# thing that ever caught it was deleting each production line and counting the reds. Running
# that by hand is where the second failure mode came from:
#
#   TWICE a mutation silently did not apply — once a regex that did not match CRLF line
#   endings, once an injected probe that referenced an out-of-scope variable and did not
#   compile — and BOTH reported as "green", i.e. as a lost pin that was really a lost
#   measurement. A mutation that does not land and a mutation that does not build are the
#   same thing: no evidence. Reading "green" as "unpinned" would have been wrong; reading it
#   as "fine" would have been worse.
#
# So this script refuses to report a row it did not actually measure. Every mutation is
# grep-confirmed PRESENT IN SOURCE before the tests run, and every build failure is reported
# as MUTATION DID NOT COMPILE rather than folded into a pass/fail count.
#
# It is committed so the next person inherits the harness rather than the anecdote. A process
# fix that exists only in a transcript is a process fix nobody has.
#
# USAGE
#   bash tools/machine-simulator/scripts/delete-and-redden.sh
#
# Every mutation is applied to a working copy, measured, and reverted from a pristine backup
# taken at start-up. On any exit path the sources are restored; verify with `git status`.
#
# 🔴 DO NOT KILL THIS SCRIPT MID-ROW. The EXIT trap restores on Ctrl-C and on normal failure, but a
# SIGKILL (or a harness that kills the wrapper while a child `perl`/`dotnet` is mid-row) leaves the
# CURRENT row's mutation on disk — measured during the whole-branch-review fix wave, where a killed run
# stranded a mutation that then failed an unrelated test and read exactly like a real regression. If a run
# is interrupted for any reason, the recovery is:
#
#     grep -rn "MUTANT" src/ | grep -v /bin/ | grep -v /obj/     # expect NO output
#     git diff HEAD --stat -- src/                               # expect only your own edits
#
# and `git checkout -- <file>` for anything it names. Let the script finish instead.
#
# 🔴 HOW LONG IT ACTUALLY TAKES — measured at Gate 1, because the sentence here used to say "~25 minutes"
# and had been false for two workstreams. One filtered EngineApi run is 3m20 for 373 tests (2m28 for the
# 278 the filter selected before Gate 1; the screen classes add ~54s, of which the real SQLITE_BUSY probe
# alone is tens of seconds of deliberate blocking). At 79 rows that is 4-5 HOURS, not 25 minutes. Budget
# for it, or run it where nothing is waiting on the machine. Gate 1 took the one saving available without
# narrowing what is measured: non-measurements are now decided from a ~20-second build, before the suite
# is entered at all.
#
# 🔴 THE STALE-BUILD DETECTOR WAS VERIFIED BY DELIBERATELY FAKING A ROW — Gate 1, because a detector that
# has never fired is a claim, not an instrument. Two fakes, and the FIRST ONE FAILED TO REPRODUCE, which
# is the more useful of the two results: back-dating the mutated source's mtime (WS-HMI-0c's exact hazard)
# did NOT produce a stale binary here, because `restore()` copies EVERY file in SOURCES between rows and
# those fresh mtimes force a recompile regardless — so this harness is structurally immune to the mtime
# half. The second fake reproduced the half it is NOT immune to, the WS-HMI-2 Task 3 locked-DLL mode:
# `dotnet build` shadowed to exit 0 with "0 Error(s)" and touch nothing. The row reported STALE BUILD and
# skipped the suite, against a control row (a real mutation, real build) that reported an ordinary
# `Failed: 0, Passed: 373` — so the check discriminates, rather than firing on everything.
#
# ─────────────────────────────────────────────────────────────────────────────────────────
# 🔴 WHAT THIS IS, AND WHAT IT IS NOT — owner ruling, whole-branch review fix wave, 2026-08-31.
#
# THIS IS A CURATED REGRESSION LIST, NOT A COVERAGE TOOL. Each row exists because a specific line was
# once found deletable-while-green, or because a review named it as load-bearing. Rows are evidence that
# particular decisions stayed pinned across repairs — three separate rounds on this branch saw a repair
# silently un-pin an earlier repair's line, and this is what caught it.
#
# The FILE list (SOURCES) must be complete: a file absent from it cannot be mutated at all, so any
# conclusion drawn from a run is silently narrower than it sounds. That was the actual defect the
# whole-branch review found — SOURCES held four files while the report concluded about three tasks — and
# it is fixed.
#
# The ROW list is deliberately NOT complete, and does not need to be. The review enumerated six further
# load-bearing lines with no row: the two `catch (ContractViolationException) -> BadRequest` arms,
# HmiChangeStream's unsubscribe in its finally block, Program.cs's collision-query DbPath wiring and the
# IHmiChangeBus registration, and the eight HTTP routes' .RequireAuthorization calls. The owner ruled:
# PARK THEM. Every one is already covered by ordinary tests — deleting a `catch` arm reddens the §5
# 400-tests Tasks 1 and 2 pin, and deleting a .RequireAuthorization reddens RbacPolicyTests' exhaustive
# census in both directions. Adding rows for lines that already fail loudly buys little and costs a
# minute of wall clock each.
#
# So: EXTENDING THE ROW LIST IS ORDINARY MAINTENANCE, and belongs to whoever next touches those files.
# Add a row when you find a line that a full-suite run does NOT catch, or when a review names one. The
# cost if that ruling is wrong, stated so a future reader can weigh it rather than re-derive it: a repair
# un-pins one of those six and only a full-suite red catches it — one step later than a row here would,
# but caught.
# ─────────────────────────────────────────────────────────────────────────────────────────

set -u

cd "$(dirname "$0")/.." || exit 1

TESTS="$(pwd)/tests/St4i.EngineApi.Tests/St4i.EngineApi.Tests.csproj"
HTE=src/St4i.EngineApi/Endpoints/HmiTagEndpoints.cs
HME=src/St4i.EngineApi/Endpoints/HmiModelEndpoints.cs
TIQ=src/St4i.EngineApi/HmiModel/TagIndexCollisionQuery.cs
EV=src/St4i.EngineApi/HmiModel/HmiModelEvents.cs
# 🔴 WHOLE-BRANCH REVIEW — THE HARNESS COULD NOT SEE THE LINES IT WAS BUILT AFTER.
# SOURCES listed only the four files above, so every row was Task 2 or Task 3 and there was NO TASK 1 ROW
# AT ALL — while the closing report concluded "no line pinned by Tasks 1, 2 or 3 has stopped reddening".
# A sweep is only evidence for the files it can mutate, and a conclusion wider than the instrument is the
# same defect this branch spent five rounds removing, this time inside the instrument itself.
CMC=src/St4i.EngineApi/HmiModel/CanonicalMachineCodeStores.cs
HCS=src/St4i.EngineApi/Hubs/HmiChangeStream.cs
PROG=src/St4i.EngineApi/Program.cs

# 🔴 WS-HMI-0c WHOLE-BRANCH REVIEW — THE SAME HOLE, ONE WORKSTREAM LATER.
# SOURCES contained NONE of the four files WS-HMI-0c adds and FILTER none of its five test classes: the
# harness ran 158 of 1721 tests and none of 0c's 100, while that branch's closing report published a
# "42 of 45 rows red" table produced by an ad-hoc script that exists in no file, so nobody could re-run it.
# A sweep is only evidence for the files it can mutate; a table nobody can reproduce is not evidence at all.
# Both are fixed here, in the committed harness, because the instrument is the thing nobody checks.
TMD=src/St4i.EngineApi/HmiModel/TagMapDeclaration.cs
DTS=src/St4i.EngineApi/HmiModel/DriverTagSupport.cs
TNB=src/St4i.EngineApi/HmiModel/TagNamespaceBuilder.cs
TIS=src/St4i.EngineApi/HmiModel/TagIngestionService.cs
# In a DIFFERENT project (St4i.Hmi.Contracts). It is here because WS-HMI-0c's MED-3 fix put three
# schema-required-field checks in it and they are exercised through this suite's store.
CI=src/St4i.Hmi.Contracts/ContractInvariants.cs

# 🔴 WS-HMI-2 GATE 1 — THE SAME HOLE A THIRD TIME, PREDICTED IN THE LEDGER BEFORE IT WAS MEASURED.
# WS-HMI-2 Phase 1 (Tasks 1-4) added four production files and none of them was in SOURCES; FILTER named
# neither of its two test classes. The harness therefore could not mutate ONE line this workstream added,
# which is exactly the defect the 0b and 0c blocks above record — twice is a coincidence, three times is
# the harness's default state, so this note exists to say the widening is part of finishing a workstream,
# not a repair somebody remembered.
IHS=src/St4i.EngineApi/HmiModel/IHmiScreenStore.cs
HSS=src/St4i.EngineApi/HmiModel/HmiScreenStore.cs
CSS=src/St4i.EngineApi/HmiModel/CanonicalScreenStore.cs
HSE=src/St4i.EngineApi/Endpoints/HmiScreenEndpoints.cs

# 🔴 WS-HMI-2 PERIMETER PASS (2026-09-05) — THE SAME HOLE A FOURTH TIME, AND THIS TIME IT WAS FOUND BY
# COUNTING THE BRANCH'S FILES AGAINST SOURCES RATHER THAN BY A SUITE GOING RED.
# The whole-branch review (M-3) states it exactly: "SOURCES is .NET-only" reads as "the .NET half is
# covered", and the .NET half is FOURTEEN OF SIXTEEN FILES. The two missing ones are below. Neither is
# large and neither is clever, which is the whole reason they were skipped — and a positional record is
# precisely where a silent defect hides, because REORDERING TWO PARAMETERS OF THE SAME TYPE COMPILES
# EVERYWHERE AND CHANGES EVERY CALL SITE'S MEANING. There is no red squiggle for `WidgetRect(col, row,
# rowSpan, colSpan)`; there is only a screen that lays out wrong.
HMD=src/St4i.EngineApi/Endpoints/HmiModelDtos.cs
HSD=src/St4i.Hmi.Contracts/HmiScreenDocument.cs

SOURCES="$HTE $HME $TIQ $EV $CMC $HCS $PROG $TMD $DTS $TNB $TIS $CI $IHS $HSS $CSS $HSE $HMD $HSD"

# 🔴 LINE ENDINGS ARE MIXED IN THIS SET, MEASURED NOT ASSUMED — Gate 1. HmiScreenStore.cs and
# HmiScreenEndpointsTests' subject HmiScreenEndpoints.cs are CRLF; CanonicalScreenStore.cs and
# IHmiScreenStore.cs are LF; every 0b/0c file is CRLF. A regex anchored on a bare `\n` matches three of
# these four and silently does not match the other — the "mutation did not land" mode that defeated three
# earlier sweeps. EVERY multi-line pattern below uses `\r?\n`, without exception, including in files that
# are LF today: a file's line endings are not a property anybody is guarding.
FILTER='FullyQualifiedName~HmiTagEndpointsTests|FullyQualifiedName~TagIndexCollisionQueryTests|FullyQualifiedName~CanonicalMachineCodeStoresTests|FullyQualifiedName~TagNamespaceStoreTests|FullyQualifiedName~HmiModelEndpointsTests|FullyQualifiedName~HmiModelWiringTests|FullyQualifiedName~RbacPolicyTests|FullyQualifiedName~HmiModelEventsTests|FullyQualifiedName~TagMapDeclarationTests|FullyQualifiedName~DriverTagSupportTests|FullyQualifiedName~TagNamespaceBuilderTests|FullyQualifiedName~TagIngestionServiceTests|FullyQualifiedName~TagIngestionWiringTests|FullyQualifiedName~HmiScreenStoreTests|FullyQualifiedName~HmiScreenEndpointsTests'
# `~HmiScreenStoreTests` is a SUBSTRING match, so it also selects CanonicalizingHmiScreenStoreTests (the
# decorator's own class, in the same file). Verified by name, not assumed.

# 🔴 A SECOND TEST PROJECT, BECAUSE ONE OF THE MUTATED FILES IS NOT REACHABLE FROM THE FIRST — Gate 1.
# ContractInvariants.cs has been in SOURCES since WS-HMI-0c, and its 0c rows redden through THIS suite's
# store, so nobody had to notice that `St4i.Hmi.Contracts`'s OWN tests live in a DIFFERENT project this
# script never ran. Phase 1 made that a false-green: `ScreenIdPattern`'s `\z` anchor (WS-HMI-2 Task 2
# MED-2) is pinned by exactly ONE test — ContractInvariantsTests' trailing-newline theory, in
# St4i.Hmi.Contracts.Tests — and nothing in St4i.EngineApi.Tests distinguishes `\z` from `$` at all. A
# `\z`→`$` row run against the EngineApi suite alone comes back GREEN and reads as a lost pin. That is
# the same class as a mutation that does not land: no evidence, dressed as evidence.
#
# It runs ONLY for rows whose mutated file is under src/St4i.Hmi.Contracts/. That is not a shortcut, it
# is the reachability fact: St4i.Hmi.Contracts.Tests references St4i.Hmi.Contracts and nothing else, so a
# mutation anywhere in St4i.EngineApi cannot change one of its results, and running it there would only
# add wall clock and a second summary line to read.
CTESTS="$(pwd)/tests/St4i.Hmi.Contracts.Tests/St4i.Hmi.Contracts.Tests.csproj"
CFILTER='FullyQualifiedName~ContractInvariantsTests|FullyQualifiedName~HmiScreenSchemaPinTests|FullyQualifiedName~HmiScreenRoundTripTests'

# Where each suite's assemblies are deployed — used by the STALE BUILD check in measure().
OUTDIR="$(pwd)/tests/St4i.EngineApi.Tests/bin/Debug/net10.0-windows"
COUTDIR="$(pwd)/tests/St4i.Hmi.Contracts.Tests/bin/Debug/net10.0"

# Every deployed copy of the assembly a mutated source compiles into — a shared project such as
# St4i.Hmi.Contracts is copied beside BOTH test binaries, and a row that rebuilt one but not the other
# measured only half of what it ran.
dlls_for() {
  local asm base
  asm=$(echo "$1" | cut -d/ -f2)
  for base in "$OUTDIR" "$COUTDIR"; do
    [ -f "$base/$asm.dll" ] && echo "$base/$asm.dll"
  done
  return 0
}

# 🔴 CHECKSUM, NOT MTIME — Gate 1, tightening the STALE BUILD detector the WS-HMI-2 Task 3 review asked
# for by name ("verify the DLL timestamp moved before trusting a row"). A timestamp moves for reasons that
# are not a recompile (a touch, a copy, a clock), and — the mode this project actually paid for — MSBuild
# can report success while its copy to the test output FAILED with MSB3021/27 because a running test host
# or probe server held the DLL open, leaving the OLD bytes in place under a NEW timestamp. A content hash
# cannot be fooled by either. Deterministic builds make this exact: same source in, same bytes out, so a
# hash that did not move means the binary under test does not contain the mutation.
sums_for() {
  local d
  for d in $(dlls_for "$1"); do printf '%s ' "$(md5sum "$d" | cut -d' ' -f1)"; done
}

BK="$(mktemp -d)"
for f in $SOURCES; do cp "$f" "$BK/$(basename "$f")"; done
restore() { for f in $SOURCES; do cp "$BK/$(basename "$f")" "$f"; done; }
trap 'restore; rm -rf "$BK"' EXIT

# measure <label> <sentinel-that-must-be-present-in-source>
#
# The sentinel is the whole point: it is grep'd across the sources AFTER the mutation and
# BEFORE the test run. If it is absent the mutation did not land, and the row is reported as
# a non-measurement instead of as a green.
# 🔴 `ONLY` — RUN A SUBSET, ADDED BY THE WS-HMI-2 PERIMETER PASS, AND WHY IT IS SAFE.
# This file's own header measures a full run at 4-5 HOURS. That number is why the sweep was not re-run
# after Gate 1, and an instrument nobody can afford to run is on its way to being an instrument nobody
# runs. `ONLY=<extended-regex>` restricts which rows are MEASURED; every other row's mutation is still
# applied and then immediately restored, so the tree ends in the same state either way.
#
# 🔴 IT IS A CONVENIENCE, NOT A VERDICT, AND THE DISTINCTION IS ENFORCED: a subset run prints a banner
# saying so, because "the sweep passed" said of a filtered run is exactly the class of overclaim this
# harness exists to stop — a conclusion wider than the instrument. Merge decisions take the FULL run.
#   ONLY='^G5' bash scripts/delete-and-redden.sh     # just the post-Gate-1 rows
ONLY="${ONLY:-}"

measure() {
  local label="$1" sentinel="$2" out summary mutated before after
  if [ -n "$ONLY" ] && ! echo "$label" | grep -Eq -- "$ONLY"; then
    restore
    return
  fi
  if ! grep -qF -- "$sentinel" $SOURCES; then
    echo "### $label => MUTATION DID NOT LAND (sentinel '$sentinel' absent) — NOT A MEASUREMENT"
    restore
    return
  fi

  # Which source currently carries the sentinel — the file whose assembly must be rebuilt below.
  mutated=$(grep -lF -- "$sentinel" $SOURCES | head -1)
  before=$(sums_for "$mutated")

  # 🔴 BUILD FIRST, TEST SECOND — Gate 1 split what used to be one `dotnet test` call. BOTH
  # non-measurement verdicts below (did not compile, stale build) are decidable from the BUILD alone, and
  # deciding them first means a row that measured nothing costs ~20 seconds instead of the ~3m20 a full
  # filtered run now takes. It is not only about wall clock: under the old order the harness ran a
  # three-minute suite against a binary it had not yet established contained the mutation, which is the
  # locked-DLL false green being *performed* before being detected.
  case "$mutated" in
    src/St4i.Hmi.Contracts/*) out=$(dotnet build "$TESTS" -v q --nologo 2>&1; dotnet build "$CTESTS" -v q --nologo 2>&1) ;;
    *) out=$(dotnet build "$TESTS" -v q --nologo 2>&1) ;;
  esac

  # 🔴 COMPILE CHECK BEFORE THE STALE CHECK, deliberately — Gate 1 reordered these. A mutation that does
  # not compile ALSO leaves the binary unmoved, so with the old order every non-compiling row was reported
  # as STALE BUILD: still a non-measurement, so no false green, but a wrong diagnosis of one — and this
  # harness exists precisely so that "no evidence" is never mistaken for a different thing.
  if echo "$out" | grep -q "error CS"; then
    echo "### $label => MUTATION DID NOT COMPILE — NOT A MEASUREMENT"
    echo "$out" | grep -m2 "error CS" | sed 's/\[.*//' | sed 's/^/      /'
    restore
    return
  fi

  # 🔴 STALE BUILD — the deepest non-measurement this repository has hit, and it came from a harness.
  # WS-HMI-0c's ad-hoc sweep restored sources with a copy that PRESERVED mtime, so a restored file looked
  # OLDER than the DLL built from the mutated source; MSBuild's up-to-date check then skipped recompiling
  # and later rows ran against an EARLIER row's mutated binary. It produced a confident false diagnosis
  # (that the C# compiler had dropped an `else if` branch) that was nearly shipped as a source change. The
  # WS-HMI-2 Task 3 review then found the OTHER half of the same mode: a locked output DLL, where MSBuild's
  # copy fails with MSB3021/27, `dotnet build` still exits 0, and the test runs the PREVIOUS binary green.
  # A green row is only evidence if the binary under test contains the mutation. Gate 1 checks CONTENT, not
  # timestamps — see sums_for's own comment for why a timestamp cannot answer the locked-DLL half.
  after=$(sums_for "$mutated")
  if [ -z "$after" ]; then
    echo "### $label => NO BUILT ASSEMBLY for $mutated — NOT A MEASUREMENT"
    restore
    return
  fi
  if [ "$before" = "$after" ]; then
    echo "### $label => STALE BUILD (the assembly built from $mutated is byte-identical to the pre-mutation build) — NOT A MEASUREMENT"
    restore
    return
  fi

  # Only now, with the mutation proved present in source AND in the deployed binary, is it worth the
  # three minutes. `--no-build` because the build above is the one that was just checked — letting
  # `dotnet test` build again would test a binary nothing verified.
  out=$(dotnet test "$TESTS" --filter "$FILTER" --no-build 2>&1)
  # See CTESTS's own comment: this suite can only observe a mutation to the assembly it references.
  case "$mutated" in
    src/St4i.Hmi.Contracts/*)
      out="$out
$(dotnet test "$CTESTS" --filter "$CFILTER" --no-build 2>&1)" ;;
  esac

  # 🔴 CHECKED AFTER THE RUN TOO. Checking only before leaves a window: anything that reverts the source
  # mid-row — an external `git checkout`, an editor writing a stale buffer, a concurrent tool — produces a
  # perfectly ordinary green that means nothing. That happened during the whole-branch review, and it is
  # the same class as the two non-measurement modes already closed here: the failure is not that the test
  # passed, it is that nobody can tell what it was run against.
  if ! grep -qF -- "$sentinel" $SOURCES; then
    echo "### $label => MUTATION VANISHED MID-RUN (sentinel '$sentinel' gone after the run) — NOT A MEASUREMENT"
    restore
    return
  fi

  # SUMMED, not `tail -1` — a row that runs two projects prints two summary lines, and taking the last one
  # would report the Contracts project's counts as if they were the whole run.
  summary=$(echo "$out" | grep -oE 'Failed:[[:space:]]+[0-9]+, Passed:[[:space:]]+[0-9]+' \
    | awk '{f+=$2+0;p+=$4+0} END {printf "Failed: %d, Passed: %d", f, p}')
  echo "### $label => $summary"
  echo "$out" | grep -oE '^\[xUnit\.net [0-9:.]+\][[:space:]]+[A-Za-z0-9_.]+\.([A-Za-z0-9_]+)( |\()' \
    | sed -E 's/^\[[^]]*\][[:space:]]*//; s/[ (]$//' | sort -u | sed 's/^/      RED /'
  restore
}

# The baseline is deliberately NOT run through measure(): there is no mutation, so there is no
# sentinel to confirm, and asking for one printed a spurious "MUTATION DID NOT LAND" beside a
# perfectly good green. A harness whose own output has to be explained is a harness that will be
# misread — which is the failure it exists to prevent, one level up.
if [ -n "$ONLY" ]; then
  echo "🔴 SUBSET RUN — ONLY='$ONLY'. The rows this filter excludes were NOT MEASURED on this run."
  echo "🔴 This output is not 'the sweep'. A merge decision takes the unfiltered run. See ONLY's comment."
fi

echo "=== BASELINE (no mutation) ==="
echo "### baseline (EngineApi) => $(dotnet test "$TESTS" --filter "$FILTER" 2>&1 \
  | grep -oE 'Failed:[[:space:]]+[0-9]+, Passed:[[:space:]]+[0-9]+' | tail -1)"
echo "### baseline (Hmi.Contracts) => $(dotnet test "$CTESTS" --filter "$CFILTER" 2>&1 \
  | grep -oE 'Failed:[[:space:]]+[0-9]+, Passed:[[:space:]]+[0-9]+' | tail -1)"

# ── Task 2's pinned lines ────────────────────────────────────────────────────────────────
perl -0777 -pi -e 's/ex\.SqliteErrorCode == 19 \/\/ SQLITE_CONSTRAINT\s*\r?\n\s*&& \(ex\.SqliteExtendedErrorCode == 1555[^;]*;/ex.SqliteErrorCode == 19; \/\/ MUTANT/s' $HTE
measure "A1 extended-code narrowing widened to bare 19" "ex.SqliteErrorCode == 19; // MUTANT"

perl -0777 -pi -e 's/if \(string\.Equals\(owner, canonicalMachineCode, StringComparison\.Ordinal\)\) continue;/\/\/ MUTANT ownership continue deleted/' $TIQ
measure "A2 ownership continue deleted" "// MUTANT ownership continue deleted"

perl -0777 -pi -e 's/\.ClaimedByAnotherMachineAsync\(MachineCodeIdentity\.Canonicalize\(machineCode\), candidates, ct\)/.ClaimedByAnotherMachineAsync(machineCode, candidates, ct) \/* MUTANT *\//' $HTE
measure "A3 collision query fed the raw route value" "candidates, ct) /* MUTANT */"

perl -0777 -pi -e 's/MachineCodeIdentity\.Canonicalize\(machineCode\), tagCount, backedByDriverCount\)/machineCode, tagCount, backedByDriverCount) \/* MUTANT *\//' $HTE
measure "A4 PUT echo canonicalisation removed" "backedByDriverCount) /* MUTANT */"

perl -0777 -pi -e 's/catch \(Exception\)/catch (SqliteException) \/* MUTANT *\//' $HTE
measure "A5 diagnosis total catch narrowed" "catch (SqliteException) /* MUTANT */"

perl -0777 -pi -e 's/(\s*)(var claimed = await DescribeClaimedPathsAsync\()/$1foreach (var __m in body.Tags.Take(1000000)) { if (__m?.Path is not null) await tags.FindTagAsync(__m.Path, ct).ConfigureAwait(false); } \/* MUTANT *\/$1$2/' $HTE
measure "A6 per-tag probing reintroduced at a 1000000 cap" "/* MUTANT */"

perl -0777 -pi -e 's/internal const int ChunkSize = 500;/internal const int ChunkSize = 666; \/\/ MUTANT/' $TIQ
measure "A7 ChunkSize 500 -> 666" "ChunkSize = 666; // MUTANT"

perl -0777 -pi -e 's/(\.Distinct\(StringComparer\.Ordinal\)\r?\n\s*)(\.ToList\(\);)/$1.Take(200) \/* MUTANT *\/\n                $2/' $HTE
measure "A8 ordinal Take(200) reapplied to candidates" ".Take(200) /* MUTANT */"

perl -0777 -pi -e 's/if \(candidatePaths\.Count == 0\) return Array\.Empty<string>\(\);/\/\/ MUTANT empty guard deleted/' $TIQ
measure "A9 empty-candidate guard deleted" "// MUTANT empty guard deleted"

# ── Task 3's pinned lines ────────────────────────────────────────────────────────────────
perl -0777 -pi -e 's/changes\.Publish\(HmiModelEvents\.ComponentModelChanged\(machineCode\)\);/\/\/ MUTANT component emit deleted/' $HME
measure "T1 component emit deleted" "// MUTANT component emit deleted"

perl -0777 -pi -e 's/changes\.Publish\(HmiModelEvents\.TagNamespaceChanged\(machineCode, tagCount\)\);/\/\/ MUTANT tag emit deleted/' $HTE
measure "T2 tag emit deleted" "// MUTANT tag emit deleted"

perl -0777 -pi -e 's/MachineCodeIdentity\.Canonicalize\(machineCode\), TagCount: null\)/machineCode, TagCount: null) \/* MUTANT *\//; s/MachineCodeIdentity\.Canonicalize\(machineCode\), tagCount\)/machineCode, tagCount) \/* MUTANT *\//' $EV
measure "T3 event machineCode not canonicalised" "TagCount: null) /* MUTANT */"

# The publish must be the LAST statement: moving it back above the response work is exactly
# the HIGH-1 defect, and is the mutation that proves the ordering is pinned rather than tidy.
perl -0777 -pi -e 's/(\s*)(\/\/ Referential integrity against whatever tag namespace)/$1changes.Publish(HmiModelEvents.ComponentModelChanged(machineCode)); \/* MUTANT *\/$1$2/' $HME
perl -0777 -pi -e 's/(\s*)changes\.Publish\(HmiModelEvents\.ComponentModelChanged\(machineCode\)\);\r?\n(\s*)return response;/\n        return response;/' $HME
measure "T4 component publish moved back above the response work" "ComponentModelChanged(machineCode)); /* MUTANT */"

perl -0777 -pi -e 's/(\s*)(\(\(Action<HmiModelChangedEvent>\)handler\)\(e\);)/$1$2 \/* MUTANT-NOCATCH *\//' $EV
perl -0777 -pi -e 's/try\s*\r?\n\s*\{\s*\r?\n(\s*)(\(\(Action<HmiModelChangedEvent>\)handler\)\(e\); \/\* MUTANT-NOCATCH \*\/)\s*\r?\n\s*\}\s*\r?\n\s*catch \(Exception\)\s*\r?\n\s*\{[^}]*\}/$1$2/s' $EV
measure "T5 Publish total catch removed" "MUTANT-NOCATCH"

# ── Task 1's lines — the decorator seam and the composition root ─────────────────────────
# None of these had a row before the whole-branch review, which is why the sweep's "Tasks 1, 2 and 3"
# conclusion was wider than the sweep.

perl -0777 -pi -e 's/return doc is null \? null : Canonical\(doc\);(\s*\}\s*\/\/\/ <summary>Canonicalised AND)/return doc; \/* MUTANT-CM-OUT *\/$1/s' $CMC
perl -0777 -pi -e 's/(var storedKey = await ResolveStoredKeyAsync[^;]*;\s*if \(storedKey is not null\)\s*\{\s*doc = await _inner\.GetAsync\(storedKey, ct\)\.ConfigureAwait\(false\);\s*\}\s*\}\s*)return doc is null \? null : Canonical\(doc\);/$1return doc; \/* MUTANT-CM-OUT *\//s' $CMC
measure "C1 component GetAsync output canonicalisation removed" "MUTANT-CM-OUT"

perl -0777 -pi -e 's/var storedKey = await ResolveStoredKeyAsync\(canonical, ct\)\.ConfigureAwait\(false\);/string? storedKey = null; \/* MUTANT-NO-FALLBACK *\//' $CMC
measure "C2 canonical-miss fallback disabled" "MUTANT-NO-FALLBACK"

perl -0777 -pi -e 's/return stored\.Select\(MachineCodeIdentity\.Canonicalize\)\s*\r?\n\s*\.Distinct\(StringComparer\.Ordinal\)\s*\r?\n\s*\.OrderBy\(code => code, StringComparer\.Ordinal\)\s*\r?\n\s*\.ToList\(\);/return stored; \/* MUTANT-LIST-RAW *\//s' $CMC
measure "C3 list canonicalise+dedup+sort removed" "MUTANT-LIST-RAW"

perl -0777 -pi -e 's/var doc = await _inner\.GetAsync\(MachineCodeIdentity\.Canonicalize\(machineCode\), ct\)\.ConfigureAwait\(false\);\s*\r?\n\s*return doc is null \? null : Canonical\(doc\);/var doc = await _inner.GetAsync(MachineCodeIdentity.Canonicalize(machineCode), ct).ConfigureAwait(false); return doc; \/* MUTANT-TAG-OUT *\//s' $CMC
measure "C4 tag GetAsync output canonicalisation removed" "MUTANT-TAG-OUT"

perl -0777 -pi -e 's/_ => new St4i\.EngineApi\.HmiModel\.CanonicalizingComponentModelStore\(\s*\r?\n\s*new St4i\.EngineApi\.HmiModel\.ComponentModelStore\(/_ => \/* MUTANT-DI-COMP *\/ (St4i.EngineApi.HmiModel.IComponentModelStore)(new St4i.EngineApi.HmiModel.ComponentModelStore(/s' $PROG
perl -0777 -pi -e 's/(MUTANT-DI-COMP[^;]*hmiModelDir\)\)\));/$1;/s' $PROG
measure "C5 component store registered UNDECORATED" "MUTANT-DI-COMP"

perl -0777 -pi -e 's/_ => new St4i\.EngineApi\.HmiModel\.CanonicalizingTagNamespaceStore\(rawTagNamespaceStore\.Value\)\);/_ => rawTagNamespaceStore.Value); \/* MUTANT-DI-TAG *\//' $PROG
measure "C6 tag store registered UNDECORATED" "MUTANT-DI-TAG"

perl -0777 -pi -e 's/if \(string\.IsNullOrWhiteSpace\(machine\)\)[^\S\r\n]*\r?\n[^\S\r\n]*\{/if (false) \/* MUTANT-NO-FILTER-GUARD *\/\n        {/s' $HTE
measure "C7 ?machine= 400 guard removed" "MUTANT-NO-FILTER-GUARD"

perl -0777 -pi -e 's/return tag is null\s*\r?\n\s*\? Results\.NotFound\(new ApiErrorDto\(\$"no tag is declared at path \x27\{path\}\x27\."\)\)\s*\r?\n\s*: Results\.Json\(tag, HmiContractJson\.Options\);/return Results.Json(tag, HmiContractJson.Options); \/* MUTANT-NO-404 *\//s' $HTE
measure "C8 by-path 404 branch removed (always 200)" "MUTANT-NO-404"

# ── Task 1's route/body reject arm ───────────────────────────────────────────────────────
perl -0777 -pi -e 's/if \(!string\.IsNullOrWhiteSpace\(body\.MachineCode\) &&\s*\r?\n\s*!string\.Equals\(body\.MachineCode, machineCode, StringComparison\.OrdinalIgnoreCase\)\)/if (false) \/* MUTANT-NO-ROUTEBODY *\//s' $HME
measure "C9 component route/body reject arm removed" "MUTANT-NO-ROUTEBODY"

# ── Task 3's lane: the route and its policy ──────────────────────────────────────────────
perl -0777 -pi -e 's/\}\)\.RequireAuthorization\(Policies\.Operator\);/}); \/* MUTANT-WS-ANON *\//' $HCS
measure "C10 change lane authorisation removed" "MUTANT-WS-ANON"

perl -0777 -pi -e 's/bus\.Changed \+= OnChanged;/\/* MUTANT-WS-NOSUB *\//' $HCS
measure "C11 change lane never subscribes to the bus" "MUTANT-WS-NOSUB"

# ── WS-HMI-0c ───────────────────────────────────────────────────────────────────────────
# Added by the 0c whole-branch review. Every line below was LOAD-BEARING WITH NO ROW: the branch shipped
# with its own files outside SOURCES entirely.

perl -0777 -pi -e 's/if \(string\.IsNullOrWhiteSpace\(connectorKind\)\) return false;/if (false) return false; \/* MUTANT-0C-BLANKKIND *\//' $DTS
measure "D-0c-1 CanBack blank-kind guard removed (known-redundant; expected GREEN)" "MUTANT-0C-BLANKKIND"

perl -0777 -pi -e 's/return DeclaredKinds\.Contains\(normalized, StringComparer\.Ordinal\);/return true; \/* MUTANT-0C-CANBACK-ALL *\//' $DTS
measure "D-0c-2 CanBack answers true for every kind" "MUTANT-0C-CANBACK-ALL"

perl -0777 -pi -e 's/DriverKinds\.Normalize\(connectorKind\)/connectorKind \/* MUTANT-0C-NOFOLD *\//' $DTS
measure "D-0c-3 CanBack stops folding casing" "MUTANT-0C-NOFOLD"

perl -0777 -pi -e 's/IsBackedByDriver: thisKindCanBackAnything && SourceNamesTheConnectorsOwnKind\(entry\.Source, connectorKind\)/IsBackedByDriver: true \/* MUTANT-0C-FLAG-TRUE *\//' $TNB
measure "D-0c-4 isBackedByDriver always true" "MUTANT-0C-FLAG-TRUE"

perl -0777 -pi -e 's/IsBackedByDriver: thisKindCanBackAnything && SourceNamesTheConnectorsOwnKind/IsBackedByDriver: SourceNamesTheConnectorsOwnKind \/* MUTANT-0C-NO-CANBACK *\/ /' $TNB
measure "D-0c-5 flag drops the CanBack condition" "MUTANT-0C-NO-CANBACK"

perl -0777 -pi -e 's/public string CanonicalMachineCode\(\) => MachineCodeIdentity\.Canonicalize\(MachineCode\);/public string CanonicalMachineCode() => MachineCode; \/* MUTANT-0C-RAWCODE *\//' $TMD
measure "D-0c-6 CanonicalMachineCode returns the raw field" "MUTANT-0C-RAWCODE"

perl -0777 -pi -e 's/decl = parsed\.Entries is null \? parsed with \{ Entries = Array\.Empty<TagMapEntry>\(\) \} : parsed;/decl = parsed; \/* MUTANT-0C-NULLENTRIES *\//' $TMD
measure "D-0c-7 parser stops normalising a null entries list" "MUTANT-0C-NULLENTRIES"

perl -0777 -pi -e 's/!MachineCodeIdentity\.SameIdentity\(declaration\.CanonicalMachineCode\(\), machineCode\)/false \/* MUTANT-0C-NOIDENTITY *\//' $TIS
measure "D-0c-8 declaration-vs-binding identity check removed" "MUTANT-0C-NOIDENTITY"

perl -0777 -pi -e 's/Errors: ex\.Violations\)/Errors: new[] { ex.Violations[0] }) \/* MUTANT-0C-FIRSTONLY *\//' $TIS
measure "D-0c-9 only the FIRST section-5 violation is reported" "MUTANT-0C-FIRSTONLY"

perl -0777 -pi -e 's/BackedCount: document\.Tags\.Count\(t => t\.IsBackedByDriver\)/BackedCount: document.Tags.Count \/* MUTANT-0C-BACKEDCOUNT *\//' $TIS
measure "D-0c-10 BackedCount reports TagCount" "MUTANT-0C-BACKEDCOUNT"

# The per-machine swallow.
# NOTE: anchored on ASCII only. The comment below the catch starts with a 4-byte emoji, and `\x{1f534}`
# in a perl regex over a byte-slurped file matches nothing — the same class of silent non-match as the CRLF
# regexes that defeated three earlier sweeps. `[^\n]{0,8}` steps over whatever those bytes are.
perl -0777 -pi -e 's/            catch \(Exception ex\)\r?\n            \{\r?\n                \/\/ [^\n]{0,8}THE SWALLOW\./            catch (Exception ex) when (false) \/* MUTANT-0C-SWALLOW1 *\/\n            {\n                \/\/ THE SWALLOW./s' $TIS
measure "D-0c-11 per-machine swallow removed" "MUTANT-0C-SWALLOW1"

# 🔴 THE DIRECTORY-LISTING SWALLOW — W-HIGH-1. Wholly unmeasured before this round: `when (false)` on it
# left the entire suite green, while removing it lets a permission change on tag-maps/ propagate out of a
# top-level statement in Program.cs and STOP THE HOST — every machine on the box, not one screen.
perl -0777 -pi -e 's/        catch \(Exception ex\)\r?\n        \{\r?\n            \/\/ [^\n]{0,8}THE DIRECTORY SWALLOW/        catch (Exception ex) when (false) \/* MUTANT-0C-SWALLOW2 *\/\n        {\n            \/\/ THE DIRECTORY SWALLOW/s' $TIS
measure "D-0c-12 directory-listing swallow removed (W-HIGH-1)" "MUTANT-0C-SWALLOW2"

# The leaf name. Repointed for WS-HMI-0c's move to the machine-wide root: this row used to mutate
# Path.Combine(AppContext.BaseDirectory, DirectoryName), which no longer exists — and the harness reported
# MUTATION DID NOT LAND rather than a green, which is the whole reason that check is there.
perl -0777 -pi -e 's/"ST4I", "sim", "hmi-tagmaps"/"ST4I", "sim", "hmi-tagmapz" \/* MUTANT-0C-DIRNAME *\//' $TIS
measure "D-0c-13 tag-map leaf name typo'd" "MUTANT-0C-DIRNAME"

# MED-3: the three schema-required-field presence checks, in the assembly that owns them.
perl -0777 -pi -e 's/if \(t\.Source is null\)/if (false) \/* MUTANT-0C-NOSOURCE *\//' $CI
measure "D-0c-14 ContractInvariants stops checking source presence" "MUTANT-0C-NOSOURCE"

perl -0777 -pi -e 's/if \(string\.IsNullOrWhiteSpace\(t\.DataType\)\)/if (false) \/* MUTANT-0C-NODATATYPE *\//' $CI
measure "D-0c-15 ContractInvariants stops checking dataType presence" "MUTANT-0C-NODATATYPE"

perl -0777 -pi -e 's/else if \(string\.IsNullOrWhiteSpace\(t\.Source\.Kind\)\)/else if (false) \/* MUTANT-0C-NOKIND *\//' $CI
measure "D-0c-16 ContractInvariants stops checking source.kind presence" "MUTANT-0C-NOKIND"

# The composition root: the DI registration and the feature's ONLY production call site.
perl -0777 -pi -e 's/builder\.Services\.AddSingleton<St4i\.EngineApi\.HmiModel\.TagIngestionService>\(\);/builder.Services.AddSingleton(_ => new St4i.EngineApi.HmiModel.TagIngestionService(new St4i.EngineApi.HmiModel.CanonicalizingTagNamespaceStore(new St4i.EngineApi.HmiModel.TagNamespaceStore(null)))); \/* MUTANT-0C-DI-OTHERSTORE *\//' $PROG
measure "D-0c-17 ingestion service given its OWN store, not the registered one" "MUTANT-0C-DI-OTHERSTORE"

perl -0777 -pi -e 's/St4i\.EngineApi\.HmiModel\.TagMapStartupIngestion\.IngestAll\(/if \(false\) St4i.EngineApi.HmiModel.TagMapStartupIngestion.IngestAll( \/* MUTANT-0C-NOCALLSITE *\//' $PROG
measure "D-0c-18 the feature's only production call site never runs" "MUTANT-0C-NOCALLSITE"

# 🔴 F-1 — THE ARGUMENT, NOT JUST THE WRAPPER. D-0c-18 asks "was the loop entered"; this asks "did it have
# anything to enter with". Truncating the bindings disables tag-map ingestion for every machine on every
# host, and it left 1728 green INCLUDING D-0c-18's own pin, because the flag is set before the list is used.
perl -0777 -pi -e 's/tagMapRegistry\.SnapshotBindings\(\)/tagMapRegistry.SnapshotBindings().Take(0) \/* MUTANT-0C-NOBINDINGS *\//' $PROG
measure "D-0c-19 startup loop gets an EMPTY bindings list (F-1)" "MUTANT-0C-NOBINDINGS"

# The kind each binding is ingested under. A wrong kind stores every tag with isBackedByDriver false.
perl -0777 -pi -e 's/tagMapRegistry\.KindOf\(b\.InstanceId\)/"vendor.not.a.kind" \/* MUTANT-0C-KINDOF *\//' $PROG
measure "D-0c-20 bindings ingested under the wrong connector kind (KindOf)" "MUTANT-0C-KINDOF"


# ═════════════════════════════════════════════════════════════════════════════════════════
# WS-HMI-2 PHASE 1 (Tasks 1-4) — GATE 1.
#
# Every row below mutates a line this workstream added and no row could reach before today. The mutations
# are the ones a PLAUSIBLE REFACTOR would make — widen a comparison, drop a call, flip an operator, move a
# statement, restore a design the file's own doc comment argues against — never a compile-breaker: a row
# that cannot compile measures nothing, and this harness reports that as such rather than as a green.
# ═════════════════════════════════════════════════════════════════════════════════════════

# ── Task 1 — the append-only store, its §5 door, and the current-version pointer ──────────

perl -0777 -pi -e 's/        ContractInvariants\.ThrowIfInvalid\(doc\);/        \/\/ MUTANT-G1-NOVALIDATE/' $HSS
measure "G1-1 PutAsync's §5 door deleted | guards: a document violating §5 is refused AT THE STORE" "// MUTANT-G1-NOVALIDATE"

perl -0777 -pi -e 's/        ContractInvariants\.ThrowIfInvalid\(doc\);\r?\n\r?\n        return await AppendVersionAsync\(doc, ct\)\.ConfigureAwait\(false\);/        var __v = await AppendVersionAsync(doc, ct).ConfigureAwait(false); \/* MUTANT-G1-VALIDATE-LAST *\/\n        ContractInvariants.ThrowIfInvalid(doc);\n        return __v;/s' $HSS
measure "G1-2 ThrowIfInvalid runs AFTER the append, not as PutAsync's first statement | guards: a rejected document touches no table" "MUTANT-G1-VALIDATE-LAST"

perl -0777 -pi -e 's/        return await AppendVersionAsync\(target, ct\)\.ConfigureAwait\(false\);\r?\n    \}/        using (var __c = await OpenConnectionAsync(ct).ConfigureAwait(false))\n        using (var __cmd = __c.CreateCommand())\n        {\n            \/* MUTANT-G1-TRUNCATE *\/\n            __cmd.CommandText = "DELETE FROM screens WHERE screen_id = \@s AND version > \@v;";\n            __cmd.Parameters.AddWithValue("\@s", screenId);\n            __cmd.Parameters.AddWithValue("\@v", toVersion);\n            await __cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);\n        }\n        return await AppendVersionAsync(target, ct).ConfigureAwait(false);\n    }/s' $HSS
measure "G1-3 RollbackAsync deletes the versions after its target (the delete-forward design) | guards: rollback APPENDS, never truncates history" "MUTANT-G1-TRUNCATE"

perl -0777 -pi -e 's/        return await AppendVersionAsync\(target, ct\)\.ConfigureAwait\(false\);/        return await PutAsync(target, ct).ConfigureAwait(false); \/* MUTANT-G1-REVALIDATE *\//' $HSS
measure "G1-4 RollbackAsync appends through PutAsync, re-validating restored content | guards: a legacy row still restores (HIGH-1)" "MUTANT-G1-REVALIDATE"

perl -0777 -pi -e 's/                ON CONFLICT\(screen_id\) DO UPDATE SET version = excluded\.version;/                ON CONFLICT(screen_id) DO NOTHING; -- MUTANT-G1-POINTER-STUCK/' $HSS
measure "G1-5 the current-version pointer stops moving on re-PUT | guards: GET without ?version serves the LATEST" "-- MUTANT-G1-POINTER-STUCK"

perl -0777 -pi -e 's/versions\.Add\(new ScreenVersionInfo\(version, savedAt, currentVersion == version\)\);/versions.Add(new ScreenVersionInfo(version, savedAt, true)); \/* MUTANT-G1-ALLCURRENT *\//' $HSS
measure "G1-6 every version reports IsCurrent=true | guards: EXACTLY ONE version is current, and it is the pointer's" "MUTANT-G1-ALLCURRENT"

# ── Task 2 — the identity seam, its fallbacks, its guard, and the composition root ────────

perl -0777 -pi -e 's/        string\.IsNullOrWhiteSpace\(screenId\) \? screenId! : screenId\.Trim\(\);/        screenId!; \/* MUTANT-G2-NOTRIM *\//' $CSS
measure "G2-1 ScreenIdentity.Canonicalize stops trimming | guards: trim-only canonicalisation on EVERY seam method" "MUTANT-G2-NOTRIM"

perl -0777 -pi -e 's/ \? screenId! : screenId\.Trim\(\);/ ? screenId! : screenId.Trim().ToLowerInvariant(); \/* MUTANT-G2-CASEFOLD *\//' $CSS
measure "G2-2 Canonicalize folds case like MachineCodeIdentity | guards: a mixed-case screenId is REFUSED, not laundered into a merge" "MUTANT-G2-CASEFOLD"

perl -0777 -pi -e 's/        return stored\.Select\(ScreenIdentity\.Canonicalize\)\r?\n\s*\.Distinct\(StringComparer\.Ordinal\)\r?\n\s*\.OrderBy\(id => id, StringComparer\.Ordinal\)\r?\n\s*\.ToList\(\);/        return stored; \/* MUTANT-G2-LIST-RAW *\//s' $CSS
measure "G2-3 ListScreenIdsAsync forwards the raw stored ids | guards: the list only names an identity GetAsync can serve (MED-1)" "MUTANT-G2-LIST-RAW"

perl -0777 -pi -e 's/        if \(doc is null\)\r?\n        \{\r?\n            var storedId = await ResolveStoredScreenIdAsync\(canonical, ct\)\.ConfigureAwait\(false\);\r?\n            if \(storedId is not null\)\r?\n            \{\r?\n                doc = await _inner\.GetAsync\(storedId, version, ct\)\.ConfigureAwait\(false\);\r?\n            \}\r?\n        \}/        \/* MUTANT-G2-GET-NOFALLBACK *\//s' $CSS
measure "G2-4 GetAsync canonical-miss fallback removed | guards: a row stored under a non-canonical spelling is still served" "MUTANT-G2-GET-NOFALLBACK"

perl -0777 -pi -e 's/        if \(versions\.Count == 0\)\r?\n        \{\r?\n            var storedId = await ResolveStoredScreenIdAsync\(canonical, ct\)\.ConfigureAwait\(false\);\r?\n            if \(storedId is not null\)\r?\n            \{\r?\n                versions = await _inner\.ListVersionsAsync\(storedId, ct\)\.ConfigureAwait\(false\);\r?\n            \}\r?\n        \}/        \/* MUTANT-G2-VERSIONS-NOFALLBACK *\//s' $CSS
measure "G2-5 ListVersionsAsync canonical-miss fallback removed | guards: version history resolves the same identity GetAsync does" "MUTANT-G2-VERSIONS-NOFALLBACK"

perl -0777 -pi -e 's/            if \(storedId is null \|\| string\.Equals\(storedId, canonical, StringComparison\.Ordinal\)\)/            if (true) \/* MUTANT-G2-RB-NOFALLBACK *\//' $CSS
measure "G2-6 RollbackAsync canonical-miss catch-and-retry always rethrows | guards: a non-canonically-stored screen can still be rolled back" "MUTANT-G2-RB-NOFALLBACK"

perl -0777 -pi -e 's/        var stored = await _inner\.ListScreenIdsAsync\(ct\)\.ConfigureAwait\(false\);\r?\n        return stored\.Where/        var stored = await ListScreenIdsAsync(ct).ConfigureAwait(false); \/* MUTANT-G2-RESOLVE-SELF *\/\n        return stored.Where/s' $CSS
measure "G2-7 the fallback resolves against the decorator's OWN canonicalised list | guards: it reads the RAW ids, so it can find a non-canonical row at all" "MUTANT-G2-RESOLVE-SELF"

perl -0777 -pi -e 's/        nameof\(IHmiScreenStore\.ListVersionsAsync\),/        \/* MUTANT-G2-SEAM-MISSING *\//' $CSS
measure "G2-8 HandledMethods loses a real seam method | guards: the seam guard walks declared+inherited members, so a new method cannot forward unhandled" "MUTANT-G2-SEAM-MISSING"

perl -0777 -pi -e 's/        nameof\(IHmiScreenStore\.RollbackAsync\),/        nameof(IHmiScreenStore.RollbackAsync), "GhostAsync", \/* MUTANT-G2-SEAM-STALE *\//' $CSS
measure "G2-9 HandledMethods gains an entry the interface never declared | guards: that guard reddens in BOTH directions (Task 2's self-certifying-test finding)" "MUTANT-G2-SEAM-STALE"

perl -0777 -pi -e 's/    _ => new St4i\.EngineApi\.HmiModel\.CanonicalizingHmiScreenStore\(\r?\n        new St4i\.EngineApi\.HmiModel\.HmiScreenStore\(\r?\n            string\.IsNullOrWhiteSpace\(hmiScreensDir\) \? null : hmiScreensDir\)\)\);/    _ => new St4i.EngineApi.HmiModel.HmiScreenStore( \/* MUTANT-G2-DI-RAW *\/\n        string.IsNullOrWhiteSpace(hmiScreensDir) ? null : hmiScreensDir));/s' $PROG
measure "G2-10 IHmiScreenStore registered UNDECORATED | guards: DI hands out the decorator only — no handler can reach the raw store" "MUTANT-G2-DI-RAW"

perl -0777 -pi -e 's/        else if \(!ScreenIdPattern\.IsMatch\(doc\.ScreenId\)\)/        else if (false) \/* MUTANT-G2-NOPATTERN *\//' $CI
measure "G2-11 ContractInvariants stops checking screenId's frozen pattern | guards: the write door refuses a spelling the schema forbids" "MUTANT-G2-NOPATTERN"

perl -0777 -pi -e 's/new\("\^\[a-z0-9-\]\+\\\\z", RegexOptions\.Compiled\)/new("^[a-z0-9-]+\$", RegexOptions.Compiled) \/* MUTANT-G2-DOLLAR *\//' $CI
measure "G2-12 the screenId anchor \\z widened back to \$ | guards: MED-2 — .NET's \$ forgives a trailing newline that ECMA-262 refuses" "MUTANT-G2-DOLLAR"

# ── Task 3 — the HTTP surface: the identity guard, the BUSY arm, the range rule ───────────

perl -0777 -pi -e 's/        string\.Equals\(Canonicalize\(a\), Canonicalize\(b\), StringComparison\.Ordinal\);/        string.Equals(Canonicalize(a), Canonicalize(b), StringComparison.OrdinalIgnoreCase); \/* MUTANT-G3-IDENT-ICASE *\//' $CSS
measure "G3-1 the route/body identity comparison widened to OrdinalIgnoreCase | guards: a case-only mismatch is 409, not a silent 400 (0b HIGH-1)" "MUTANT-G3-IDENT-ICASE"

perl -0777 -pi -e 's/        if \(!string\.IsNullOrWhiteSpace\(body\.ScreenId\) && !ScreenIdentity\.SameIdentity\(body\.ScreenId, screenId\)\)/        if (false) \/* MUTANT-G3-NO-ROUTEBODY *\//' $HSE
measure "G3-2 the PUT route-vs-body identity guard removed | guards: two named identities are refused, never silently merged" "MUTANT-G3-NO-ROUTEBODY"

perl -0777 -pi -e 's/ex\.SqliteErrorCode == 5;/ex.SqliteErrorCode >= 0; \/* MUTANT-G3-BUSY-WIDE *\//' $HSE
measure "G3-3 the BUSY predicate widened from ==5 to >=0 | guards: CORRUPT/READONLY/CONSTRAINT are NOT laundered into 'busy, retriable'" "MUTANT-G3-BUSY-WIDE"

perl -0777 -pi -e 's/ex\.SqliteErrorCode == 5;/ex.SqliteErrorCode == 6; \/* MUTANT-G3-BUSY-NARROW *\//' $HSE
measure "G3-4 the BUSY predicate narrowed to ==6 | guards: a real SQLITE_BUSY answers 503, not a 34-second empty 500" "MUTANT-G3-BUSY-NARROW"

perl -0777 -pi -e 's/            widgetCount = restored\?\.Widgets\.Count \?\? 0;/            widgetCount = restored is null ? 0 : 0; \/* MUTANT-G3-WIDGETCOUNT *\//' $HSE
measure "G3-5 rollback WidgetCount replaced by a constant | guards: it reports the RESTORED content, the shape the review found green" "MUTANT-G3-WIDGETCOUNT"

perl -0777 -pi -e 's/        if \(string\.IsNullOrWhiteSpace\(body\.ScreenId\)\)\r?\n        \{\r?\n            body = body with \{ ScreenId = screenId \};\r?\n        \}/        \/* MUTANT-G3-NOFILL *\//s' $HSE
measure "G3-6 the blank-body-screenId fill from the route removed | guards: a body omitting screenId is stored under the route id, not 400" "MUTANT-G3-NOFILL"

perl -0777 -pi -e 's/    private const int LayoutDimensionMax = 48;/    private const int LayoutDimensionMax = 4800; \/\/ MUTANT-G3-COLSMAX/' $CI
measure "G3-7 layout cols/rows upper bound 48 -> 4800 | guards: cols:999 — the ONE range-invalid body that mis-renders SILENTLY — is refused" "// MUTANT-G3-COLSMAX"

perl -0777 -pi -e 's/    private const int LayoutDimensionMin = 1;/    private const int LayoutDimensionMin = 0; \/\/ MUTANT-G3-COLSMIN/' $CI
measure "G3-8 layout cols/rows lower bound 1 -> 0 | guards: the range rule's LOWER boundary, matching the frozen schema's minimum:1" "// MUTANT-G3-COLSMIN"

perl -0777 -pi -e 's/        return Results\.NotFound\(new ApiErrorDto\(\r?\n            version is null/        return Results.Ok(new ApiErrorDto( \/* MUTANT-G3-NO404 *\/\n            version is null/s' $HSE
measure "G3-9 GET by id answers 200 for an undeclared screen | guards: the deliberate 404-vs-empty-200 divergence from its two sibling families" "MUTANT-G3-NO404"

perl -0777 -pi -e 's/        return idx < 0 \? message : message\[\.\.idx\];/        return message; \/* MUTANT-G3-NOSTRIP *\//' $HSE
measure "G3-10 the ArgumentOutOfRange '(Parameter ...)' framing is no longer stripped | guards: the 404 body is the store's sentence, not the CLR's" "MUTANT-G3-NOSTRIP"

# ── Task 4 — the announcement: when it happens, what it names, and whether it can throw ───

perl -0777 -pi -e 's/        \}\r?\n\r?\n        int version;/        }\n\n        changes.Publish(HmiModelEvents.ScreenChanged(screenId, 0)); \/* MUTANT-G4-PUT-HOIST *\/\n        int version;/s' $HSE
perl -0777 -pi -e 's/\r?\n        changes\.Publish\(HmiModelEvents\.ScreenChanged\(screenId, version\)\);\r?\n        return response;/\n        return response;/s' $HSE
measure "G4-1 PUT announces BEFORE the store accepted | guards: publish is after the store said yes — a refused write announces nothing" "MUTANT-G4-PUT-HOIST"

perl -0777 -pi -e 's/        int version;\r?\n        try\r?\n        \{\r?\n            version = await store\.RollbackAsync/        changes.Publish(HmiModelEvents.ScreenChanged(screenId, 0)); \/* MUTANT-G4-RB-HOIST *\/\n        int version;\n        try\n        {\n            version = await store.RollbackAsync/s' $HSE
perl -0777 -pi -e 's/\r?\n        changes\.Publish\(HmiModelEvents\.ScreenChanged\(screenId, version\)\);\r?\n\r?\n        \/\/ WidgetCount is read/\n\n        \/\/ WidgetCount is read/s' $HSE
measure "G4-2 rollback announces BEFORE the store accepted | guards: a rollback to a version that never existed announces nothing" "MUTANT-G4-RB-HOIST"

perl -0777 -pi -e 's/\r?\n        changes\.Publish\(HmiModelEvents\.ScreenChanged\(screenId, version\)\);\r?\n\r?\n        \/\/ WidgetCount is read/\n\n        \/\/ WidgetCount is read/s' $HSE
perl -0777 -pi -e 's/        return Results\.Ok\(new PutScreenResultDto\(ScreenIdentity\.Canonicalize\(screenId\), version, widgetCount\)\);/        changes.Publish(HmiModelEvents.ScreenChanged(screenId, version)); \/* MUTANT-G4-RB-PUBLISH-LATE *\/\n        return Results.Ok(new PutScreenResultDto(ScreenIdentity.Canonicalize(screenId), version, widgetCount));/s' $HSE
measure "G4-3 rollback publishes AFTER its post-commit read (the pre-fix ordering) | guards: a commit cancelled during decoration is still announced" "MUTANT-G4-RB-PUBLISH-LATE"

perl -0777 -pi -e 's/            ScreenId: ScreenIdentity\.Canonicalize\(screenId\), Version: version\);/            ScreenId: screenId, Version: version); \/* MUTANT-G4-RAW-SCREENID *\//' $EV
measure "G4-4 the screen event carries the RAW route screenId | guards: the event names the screen the way GET reports it" "MUTANT-G4-RAW-SCREENID"

perl -0777 -pi -e 's/            ScreenId: ScreenIdentity\.Canonicalize\(screenId\), Version: version\);/            ScreenId: screenId.Trim(), Version: version); \/* MUTANT-G4-FACTORY-THROWS *\//' $EV
measure "G4-5 ScreenChanged trims directly, so a null screenId throws | guards: factory totality — it is evaluated OUTSIDE Publish's catch" "MUTANT-G4-FACTORY-THROWS"

perl -0777 -pi -e 's/    public const string ScreenChangeKind = "screen";/    public const string ScreenChangeKind = "screens"; \/\/ MUTANT-G4-KIND/' $EV
measure "G4-6 the screen change kind renamed | guards: the wire's third change discriminator, which the web branch builds against" "// MUTANT-G4-KIND"


# ═════════════════════════════════════════════════════════════════════════════════════════
# WS-HMI-2 TASK 12 AND THE SECURITY ROUND — GATE 2 (the "perimeter pass", 2026-09-05).
#
# 🔴 WHY THESE ROWS DID NOT EXIST, STATED PLAINLY, BECAUSE IT IS A NEW SHAPE OF THE OLD DEFECT.
# The 0b / 0c / Gate-1 blocks above all record the SAME failure: a file this workstream added was not in
# SOURCES, so the harness could not mutate it at all. That failure is loud once you look — the file list
# is short and you can read it. THIS one is quiet. Every line below lives in a file that HAS been in
# SOURCES for a workstream or more (`ContractInvariants.cs` since 0c, `HmiScreenEndpoints.cs` since
# Gate 1), so nothing about the FILE list was wrong. What was wrong is that the ROW list stopped at the
# lines that existed when Gate 1 was written, and Task 12 plus the security round then added ELEVEN
# guards and TWO audit records inside those already-covered files.
#
# The whole-branch review (M-3) named the consequence exactly: those guards' nineteen falsifications are
# real, are recorded in the ledger, and "exist in no file anybody can re-run" — which is the defect this
# script's own header records having paid for twice ("a table nobody can reproduce is not evidence at
# all"). A file being in SOURCES is NOT the same as its lines being measured, and "the sweep covers
# ContractInvariants.cs" is the sentence that hid the difference.
#
# The header's ruling stands and is what makes this ordinary rather than a repair: EXTENDING THE ROW
# LIST IS ORDINARY MAINTENANCE, and belongs to whoever next touches those files. This is that, done.
#
# Every mutation below is a PLAUSIBLE REFACTOR — a guard relaxed, an enum check dropped, a `return`
# softened to fall-through, two same-typed record parameters transposed — never a compile-breaker.
# ═════════════════════════════════════════════════════════════════════════════════════════

# ── Task 12 — the widget-level door: id, kind, and the two rules the schema itself does not have ──

perl -0777 -pi -e 's/            else if \(!WidgetIdPattern\.IsMatch\(w\.Id\)\)/            else if (false) \/* MUTANT-G5-WIDGETID *\//' $CI
measure "G5-1 the widget-id pattern check deleted | guards: \$defs/widget.properties.id's frozen ^[a-z0-9-]+\$ at the WRITE DOOR — the editor mirrors it, this is the side that refuses" "MUTANT-G5-WIDGETID"

perl -0777 -pi -e 's/            else if \(!KnownWidgetKinds\.Contains\(w\.Kind\)\)/            else if (false) \/* MUTANT-G5-WIDGETKIND *\//' $CI
measure "G5-2 the widget-KIND enum check deleted | guards: the fifteen-member kind enum — a widget the renderer has no module for is refused at the door, not drawn as a placeholder forever" "MUTANT-G5-WIDGETKIND"

# The widget cap, in TWO rows, because it makes TWO claims and one row would conflate them.
perl -0777 -pi -e 's/        if \(doc\.Widgets\.Count > MaxWidgetsPerScreen\)/        if (false) \/* MUTANT-G5-NOCAP *\//' $CI
measure "G5-3 the widget-count ceiling deleted outright | guards: SECURITY REVIEW HIGH-1 — a document with more widgets than the largest legal grid has cells cannot place its own widgets, and a kiosk draws it in ONE synchronous commit" "MUTANT-G5-NOCAP"

# 🔴 THE SECOND CLAIM, AND IT IS THE ONE A REVIEWER WOULD MISS. The cap's fix is not only THAT it
# refuses — it is that it refuses AND RETURNS. Falling through on a 200 000-widget document builds
# 200 000 violation strings and joins them with " | " into one exception message, which IS the attack,
# server-side. So `return v` is deleted while the check itself is left standing: the document is still
# refused, the status code does not move, and the only thing that changes is how much work the refusal
# costs. A row that deleted the whole block could never tell those two apart.
perl -0777 -pi -e 's/(RESET HALT có mặt mà bấm không được\."\);\r?\n)            return v;/$1            \/* MUTANT-G5-CAP-NORETURN *\//s' $CI
measure "G5-4 the cap reports the violation but FALLS THROUGH instead of returning | guards: the return-rather-than-continue half of HIGH-1 — one violation naming the ceiling, not 200 000 joined into the message" "MUTANT-G5-CAP-NORETURN"

perl -0777 -pi -e 's/            if \(!seenIds\.Add\(id\)\)/            if (false) \/* MUTANT-G5-DUPID *\//' $CI
measure "G5-5 the duplicate-widget-id refusal deleted | guards: SECURITY REVIEW LOW-2 — the schema PERMITS duplicates and this door does not, because ScreenRenderer keys React children by widget.id and a duplicate key is undefined behaviour on a panel that redraws every second" "MUTANT-G5-DUPID"

# ── The security round's FIVE LOW-1 schema constraints, one row each ──────────────────────────────
# They are five separate rules over five separate schema keywords and they fail five different ways, so
# they get five rows rather than one representative. A representative row proves the file still has SOME
# enum check; it does not prove that THIS one is wired.

perl -0777 -pi -e 's/        if \(doc\.SchemaVersion != SchemaVersionConst\)/        if (false) \/* MUTANT-G5-SCHEMAVER *\//' $CI
measure "G5-6 (1/5) the schemaVersion const check deleted | guards: properties.schemaVersion.const — a document declaring another number is lying about which contract it obeys" "MUTANT-G5-SCHEMAVER"

perl -0777 -pi -e 's/        else if \(!KnownThemes\.Contains\(doc\.Theme\)\)/        else if (false) \/* MUTANT-G5-THEME *\//' $CI
measure "G5-7 (2/5) the theme enum check deleted | guards: properties.theme.enum — the ONE of the five with an operator-visible effect, since ScreenRenderer stamps it onto the rendered tree" "MUTANT-G5-THEME"

perl -0777 -pi -e 's/            else if \(!KnownBreakpoints\.Contains\(doc\.Layout\.Breakpoint\)\)/            else if (false) \/* MUTANT-G5-BREAKPOINT *\//' $CI
measure "G5-8 (3/5) the layout breakpoint enum check deleted | guards: \$defs.layout.properties.breakpoint.enum, pinned two-way against the schema file" "MUTANT-G5-BREAKPOINT"

perl -0777 -pi -e 's/            else if \(!string\.IsNullOrWhiteSpace\(w\.PolicyAction\) && !KnownPolicyActions\.Contains\(w\.PolicyAction\)\)/            else if (false) \/* MUTANT-G5-POLICYENUM *\//' $CI
measure "G5-9 (4/5) the policyAction enum check deleted | guards: S-6 — storing an action that names nothing at all is the trap; §5's 'a write kind must DECLARE one' is a different rule and is NOT what this row measures" "MUTANT-G5-POLICYENUM"

perl -0777 -pi -e 's/                    if \(value < RectMinimums\[field\]\)/                    if (false) \/* MUTANT-G5-RECTMIN *\//' $CI
measure "G5-10 (5/5) the rect minimums check deleted, all four fields | guards: \$defs.rect.properties.<name>.minimum, compared BY NAME so a minimum that moves between fields cannot be satisfied by a count" "MUTANT-G5-RECTMIN"

# ── The security round's TWO AUDIT RECORDS (MEDIUM-1) ─────────────────────────────────────────────
# 🔴 Neither screen write produced an audit record before that round, while fifteen other write routes
# did. The rows are deletions rather than tampering, and the deletion is `if (false)` rather than a cut,
# so `recorder` stays used and the row measures a MISSING AUDIT rather than an unused-parameter error.

perl -0777 -pi -e 's/        await recorder\.RecordAsync\(\r?\n            context, PublishAction,/        if (false) await recorder.RecordAsync( \/* MUTANT-G5-NOAUDIT-PUB *\/\n            context, PublishAction,/s' $HSE
measure "G5-11 PUT /v1/screens/{id} records no audit row | guards: MEDIUM-1 — the version history says WHAT changed and only the audit log says WHO did it" "MUTANT-G5-NOAUDIT-PUB"

perl -0777 -pi -e 's/        await recorder\.RecordAsync\(\r?\n            context, RollbackAction,/        if (false) await recorder.RecordAsync( \/* MUTANT-G5-NOAUDIT-RB *\/\n            context, RollbackAction,/s' $HSE
measure "G5-12 POST /v1/screens/{id}/rollback records no audit row | guards: MEDIUM-1 on the second write door — a rollback is a write and the review found it unrecorded too" "MUTANT-G5-NOAUDIT-RB"

# 🔴 A DISCRIMINATING CONTROL, NOT A THIRD DELETION. G5-11/12 ask "is a row written at all". This asks
# whether anyone checks WHAT is in it: `toVersion` is dropped while the row itself still lands. If this
# comes back GREEN then the two rows above are only pinning the CALL, and an investigator's "what did
# they ask for" is defended by nothing.
perl -0777 -pi -e 's/            new \{ version, toVersion = body\.ToVersion \},/            new \{ version \}, \/* MUTANT-G5-AUDIT-NOTOVERSION *\//' $HSE
measure "G5-13 the rollback audit row stops carrying toVersion | guards: 'restored version 2' and 'which produced version 9' are two different facts and an investigator needs both" "MUTANT-G5-AUDIT-NOTOVERSION"

# ── The two files that were never in SOURCES ──────────────────────────────────────────────────────
# 🔴 EVERY ROW HERE TRANSPOSES TWO PARAMETERS OF THE SAME TYPE IN A POSITIONAL RECORD. That is the
# mutation these files can actually suffer: it compiles everywhere, no caller changes, no analyser
# fires, and every positional construction in the tree silently swaps two meanings. It is also exactly
# what a tidy-up refactor does when it "puts the fields in a nicer order".

perl -0777 -pi -e 's/public sealed record ScreenLayout\(int Cols, int Rows, string Breakpoint\);/public sealed record ScreenLayout(int Rows, int Cols, string Breakpoint); \/\/ MUTANT-G5-LAYOUT-TRANSPOSE/' $HSD
measure "G5-14 ScreenLayout's Cols and Rows transposed | guards: the C# mirror of \$defs/layout is held to the schema BY NAME — a 12x8 grid silently becoming 8x12 is the whole failure" "// MUTANT-G5-LAYOUT-TRANSPOSE"

perl -0777 -pi -e 's/public sealed record WidgetRect\(int Col, int Row, int ColSpan, int RowSpan\);/public sealed record WidgetRect(int Col, int Row, int RowSpan, int ColSpan); \/\/ MUTANT-G5-RECT-TRANSPOSE/' $HSD
measure "G5-15 WidgetRect's ColSpan and RowSpan transposed | guards: the C# mirror of \$defs/rect — every widget on every screen changes shape and nothing fails to compile" "// MUTANT-G5-RECT-TRANSPOSE"

perl -0777 -pi -e 's/public sealed record PutScreenResultDto\(string ScreenId, int Version, int WidgetCount\);/public sealed record PutScreenResultDto(string ScreenId, int WidgetCount, int Version); \/\/ MUTANT-G5-DTO-TRANSPOSE/' $HMD
measure "G5-16 PutScreenResultDto's Version and WidgetCount transposed | guards: what BOTH write doors answer — the editor reads 'published as version N' straight out of this record" "// MUTANT-G5-DTO-TRANSPOSE"

echo "=== sources restored ==="
