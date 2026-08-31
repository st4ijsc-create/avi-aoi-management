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

SOURCES="$HTE $HME $TIQ $EV $CMC $HCS $PROG $TMD $DTS $TNB $TIS $CI"

FILTER='FullyQualifiedName~HmiTagEndpointsTests|FullyQualifiedName~TagIndexCollisionQueryTests|FullyQualifiedName~CanonicalMachineCodeStoresTests|FullyQualifiedName~TagNamespaceStoreTests|FullyQualifiedName~HmiModelEndpointsTests|FullyQualifiedName~HmiModelWiringTests|FullyQualifiedName~RbacPolicyTests|FullyQualifiedName~HmiModelEventsTests|FullyQualifiedName~TagMapDeclarationTests|FullyQualifiedName~DriverTagSupportTests|FullyQualifiedName~TagNamespaceBuilderTests|FullyQualifiedName~TagIngestionServiceTests|FullyQualifiedName~TagIngestionWiringTests'

# Where the suite's assemblies are deployed — used by the STALE BUILD check in measure().
OUTDIR="$(pwd)/tests/St4i.EngineApi.Tests/bin/Debug/net10.0-windows"

# The assembly a mutated source compiles into, as deployed beside the test binary.
built_dll_for() { echo "$OUTDIR/$(echo "$1" | cut -d/ -f2).dll"; }

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
  local label="$1" sentinel="$2" out summary mutated dll
  if ! grep -qF -- "$sentinel" $SOURCES; then
    echo "### $label => MUTATION DID NOT LAND (sentinel '$sentinel' absent) — NOT A MEASUREMENT"
    restore
    return
  fi

  # Which source currently carries the sentinel — the file whose assembly must be rebuilt below.
  mutated=$(grep -lF -- "$sentinel" $SOURCES | head -1)

  out=$(dotnet test "$TESTS" --filter "$FILTER" 2>&1)

  # 🔴 STALE BUILD — the deepest non-measurement this repository has hit, and it came from a harness.
  # WS-HMI-0c's ad-hoc sweep restored sources with a copy that PRESERVED mtime, so a restored file looked
  # OLDER than the DLL built from the mutated source; MSBuild's up-to-date check then skipped recompiling
  # and later rows ran against an EARLIER row's mutated binary. It produced a confident false diagnosis
  # (that the C# compiler had dropped an `else if` branch) that was nearly shipped as a source change.
  # This harness restores with `cp`, which does not preserve mtime, so it is not exposed to that — but a
  # green row is only evidence if the binary under test contains the mutation, and that is worth checking
  # rather than reasoning about.
  dll=$(built_dll_for "$mutated")
  if [ -f "$dll" ] && [ ! "$dll" -nt "$mutated" ]; then
    echo "### $label => STALE BUILD ($(basename "$dll") is not newer than $mutated) — NOT A MEASUREMENT"
    restore
    return
  fi
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
perl -0777 -pi -e 's/public const string DirectoryName = "hmi-tagmaps";/public const string DirectoryName = "hmi-tagmapz"; \/* MUTANT-0C-DIRNAME *\//' $TIS
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

echo "=== sources restored ==="
