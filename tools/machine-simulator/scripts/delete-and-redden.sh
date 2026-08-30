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
# and `git checkout -- <file>` for anything it names. Let the script finish instead; it is ~25 minutes.

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
SOURCES="$HTE $HME $TIQ $EV $CMC $HCS $PROG"

FILTER='FullyQualifiedName~HmiTagEndpointsTests|FullyQualifiedName~TagIndexCollisionQueryTests|FullyQualifiedName~CanonicalMachineCodeStoresTests|FullyQualifiedName~TagNamespaceStoreTests|FullyQualifiedName~HmiModelEndpointsTests|FullyQualifiedName~HmiModelWiringTests|FullyQualifiedName~RbacPolicyTests|FullyQualifiedName~HmiModelEventsTests'

BK="$(mktemp -d)"
for f in $SOURCES; do cp "$f" "$BK/$(basename "$f")"; done
restore() { for f in $SOURCES; do cp "$BK/$(basename "$f")" "$f"; done; }
trap 'restore; rm -rf "$BK"' EXIT

# measure <label> <sentinel-that-must-be-present-in-source>
#
# The sentinel is the whole point: it is grep'd across the sources AFTER the mutation and
# BEFORE the test run. If it is absent the mutation did not land, and the row is reported as
# a non-measurement instead of as a green.
measure() {
  local label="$1" sentinel="$2" out summary
  if ! grep -qF -- "$sentinel" $SOURCES; then
    echo "### $label => MUTATION DID NOT LAND (sentinel '$sentinel' absent) — NOT A MEASUREMENT"
    restore
    return
  fi

  out=$(dotnet test "$TESTS" --filter "$FILTER" 2>&1)
  if echo "$out" | grep -q "error CS"; then
    echo "### $label => MUTATION DID NOT COMPILE — NOT A MEASUREMENT"
    echo "$out" | grep -m2 "error CS" | sed 's/\[.*//' | sed 's/^/      /'
    restore
    return
  fi

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

  summary=$(echo "$out" | grep -oE 'Failed:[[:space:]]+[0-9]+, Passed:[[:space:]]+[0-9]+' | tail -1)
  echo "### $label => $summary"
  echo "$out" | grep -oE '^\[xUnit\.net [0-9:.]+\][[:space:]]+[A-Za-z0-9_.]+\.([A-Za-z0-9_]+)( |\()' \
    | sed -E 's/^\[[^]]*\][[:space:]]*//; s/[ (]$//' | sort -u | sed 's/^/      RED /'
  restore
}

# The baseline is deliberately NOT run through measure(): there is no mutation, so there is no
# sentinel to confirm, and asking for one printed a spurious "MUTATION DID NOT LAND" beside a
# perfectly good green. A harness whose own output has to be explained is a harness that will be
# misread — which is the failure it exists to prevent, one level up.
echo "=== BASELINE (no mutation) ==="
echo "### baseline => $(dotnet test "$TESTS" --filter "$FILTER" 2>&1 \
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

echo "=== sources restored ==="
