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

# 🔴 NODE-REUSE POSTURE IS THIS SCRIPT'S, NOT THE OPERATOR'S (K-1 re-review 2, Q2).
# `MSBUILDDISABLENODEREUSE=1` was an inline prefix on the ONE `dotnet build` below. `dotnet test` carries
# no prefix, and `--no-build` still runs MSBuild project evaluation — so the five test invocations kept
# whatever posture the caller's environment happened to have. K-1 ran its final gate with the variable
# EXPORTED and initially recorded that as redundant; it was not, and that is the point: the gate's
# behaviour differed depending on whether whoever ran it had set a variable. A check whose posture is
# supplied by the person running it is the same class as a check that passes for the wrong reason.
# Exported once, here, so every child process in this script gets it — build and suites alike.
export MSBUILDDISABLENODEREUSE=1

# Expected per-suite totals. Update deliberately when a task adds tests, and state
# the new numbers in the task report -- a changed total is a fact to be justified,
# not a number to be pasted over.
# 🔴 TASK K-1 (.superpowers/sdd/creds-leak-guard/task-1-brief.md) raises ALL FIVE totals by exactly +1,
# counted from the runner. ONE new file, tests/Shared/RealCredentialStoreLeakGuard.cs, LINKED into all five
# test projects the way tests/Shared/TestRunTempRoot.cs already is — one source file, five assemblies, one
# [Fact] each:
#   St4i.Connector.Abstractions.Tests  151 -> 152
#   St4i.Connector.Conformance.Tests    22 ->  23
#   St4i.EdgeCore.Tests               1093 -> 1094
#   St4i.EdgeService.Tests              50 ->  51
#   St4i.EngineApi.Tests              1334 -> 1335
# Grand total 2650 -> 2655. Nothing is rewritten, split or deleted, and no src/ file changes at all.
#
# WHY ALL FIVE RATHER THAN THE ONE SUITE THE LEAK WAS FOUND IN. The property is "no test PROCESS adds a file
# to the product's real credential store"; St4i.EngineApi.Tests was the EXAMPLE that paid for it, not the
# scope (§8.1(a), and §8.1(f) on domains inherited from where the author was standing). The five suites run
# sequentially in five separate processes, so a guard installed in one measures one process and says nothing
# about the other four — installing it in one suite and reading it as a repository-wide guarantee is exactly
# the completeness claim this repo has now paid for five times.
#
# 🔴 EXPECT_CONFORMANCE MOVING 22 -> 23 IS NOT THE THING THE "stays 22" NOTES BELOW PROTECT. There are
# ELEVEN genuine notes, at lines 167, 236, 343, 492, 572, 841, 877, 1023, 1762, 2065 and 2187.
# 🔴 `grep -c 'stays 22'` returns THIRTEEN, not eleven and not the "twelve" this parenthetical used to
# claim — because THIS SUMMARY quotes the literal string twice while describing it. A number offered in
# the voice of a measurement, naming the exact command, that the command does not produce, inside the
# paragraph defending a moved count (branch re-review, N-3; it pre-dates this round and two reviews
# missed it). The eleven is the checked claim: each of those lines is scoped to a SPECIFIC TASK and to
# CONTENT —
# no new driver, no new connector kind, no Check_* added to the shared conformance suite — and none
# asserts a standing invariant on the integer. K-1 adds none of those things: it adds the same hygiene
# [Fact] every other suite gets, from a linked file outside that project, with no ProjectReference and no
# assembly reference, so that project's deliberate one-reference boundary is intact. Shared suite untouched.
#
# EXPECT_WARNINGS stays 116: the new file adds no warning (measured on a full -t:Rebuild).
#
# 🔴 TASK P-2 (.superpowers/sdd/enum-spelling-witnessed/task-1-brief.md) raises EXPECT_ABSTRACTIONS
# 152 -> 159 (+7) and MOVES NO OTHER TOTAL. COUNTED FROM THE RUNNER (`dotnet test --list-tests`), not by
# hand — the reason D-2 wrote down: a total that reconciles is not evidence that anybody knows where the
# tests are. ONE new file, tests/St4i.Connector.Abstractions.Tests/EnumSpellingContractTests.cs, seven
# [Fact]s and no [Theory] (a theory's row count is data, and a suite total that moves when a data row is
# added is a total nobody can defend):
#   + 1  PublishedString_IsTheMemberNameVerbatim_UnderEveryDerivationThisProductUses — the three
#        derivations that turn a member's CLR name into a published string (ToString, the product's
#        no-naming-policy JsonStringEnumConverter, ConnectorJson's camelCase one), plus the read of
#        src/St4i.EngineApi/JsonConfig.cs that catches a naming policy being added there — which re-spells
#        every member on the HTTP surface at once with NO member renamed.
#   + 1  EveryExportedEnum_IsAccountedForInTheRegistry — the population is closed at the ASSEMBLY, not at
#        a list in a comment: a ninth exported enum makes this red until somebody decides what depends on
#        its spelling.
#   + 1  EveryRegisteredMirror_ListsExactlyTheMemberNamesOfWhatItMirrors — set equality at the registered
#        closed enumerations across TypeScript, the i18n resources and WPF markup. That count was 19 when
#        this paragraph was written and is 20 after the review-fix round registered TraceTable.tsx's
#        KIND_DOT — which is exactly why it is not stated as an invariant: registering a site is a normal
#        edit and moves no total here. (The count moved within one round; a number that had been load
#        bearing would have had to move with it.) Reports "not carried
#        here" and "names no member" APART, for the same reason the credential bracket below reports added
#        and removed apart: a net count cancels exactly the case worth seeing.
#   + 1  EveryLiteralBoundToARegisteredCarrier_NamesACurrentMember — the corpus-wide sweep for "a carrier
#        meeting a literal", which does NOT read the registry to decide where to look. RENAMED in the
#        review-fix round (was EveryComparandAgainstARegisteredCarrier_…): it now sweeps PRODUCERS as well
#        as comparisons, and the old name asserted the narrower half. No count change from the rename.
#   + 1  EveryTsTypeAliasOrTableNamedForAPublishedEnum_IsARegisteredMirror — the census that can refute
#        the registry. It is what found web/src/components/hmi/SchematicPanel.tsx's FIG_KEY, which the
#        measurement this task was handed did not name.
#   + 1  TheEnumsRecordedAsHavingNoComparand_StillHaveNone — DriverHealthState and CommandArgumentType are
#        recorded as having no comparand in the declared corpus. A universal negative is only worth the
#        census that could refute it, so the census is the assertion.
#   + 1  TheCorpusThisInstrumentScans_IsPresentAndPopulated — every assertion above is a sweep, and every
#        sweep over nothing passes.
#
# 🔴 THE REVIEW-FIX ROUND RAISES THIS AGAIN, 159 -> 160 (+1), AND IT IS THE ONLY TOTAL THAT MOVES. Counted
# from the runner on the same rule as above. ONE new [Fact], in the same file, no new file anywhere:
#   + 1  EveryObjectLiteralKeyedByMemberNames_IsARegisteredMirror — the census that can ACTUALLY refute the
#        registry. The one above it (…TsTypeAliasOrTableNamedForAPublishedEnum…) is indexed on a
#        declaration's TYPE ANNOTATION, and review found that SIX OF THE SEVEN member-keyed tables in this
#        codebase carry none — VERDICT_META and KIND_DOT are Record<string,…>, the four i18n blocks are
#        bare object properties. So the only thing able to tell the registry it was incomplete was blind to
#        the shape that dominates it, and a LIVE unregistered site (web/src/components/TraceTable.tsx's
#        KIND_DOT, keyed by the three ReadingKind spellings and read at line 225) sat inside the declared
#        corpus, invisible to all three assertions. This one is indexed on the KEYS instead — any object
#        literal whose top-level keys are drawn entirely from the published member vocabulary, naming at
#        least two of them, must be registered — which is what the question asks about rather than what the
#        six examples in front of the author happened to look like. PROVED by withdrawing KIND_DOT's
#        registration and watching it name the site unaided.
#        The old census is KEPT, not replaced: it still catches a typed declaration whose KEYS are wrong
#        or absent, which the key-indexed one cannot see.
# Grand total 2664 -> 2665, which is 160 + 23 + 1094 + 51 + 1337 read off the five constants below rather
# than carried forward from K-1's paragraph — three of them have moved since K-1 wrote 2655.
#
# 🔴 THE SAME ROUND WIDENS TWO SWEEPS AND MOVES NO TOTAL DOING IT, which is the check that they were
# widenings rather than new assertions: the C# arm now also reads ORDINARY DOUBLE-QUOTED literals bound to
# a PascalCase carrier (it was single-quoted/SQL-shaped only, so FleetCore.cs:3548's bare
# `DeviceClass = "Automation"` — where its own sibling MappingProfile.ForClass uses nameof — and two
# doc-comment restatements of `ReadingKind == "ProcessResult"` were outside a sweep whose corpus already
# held the file); and the WPF arm no longer requires `Binding=` before `Value=` nor rejects
# `{Binding Path=Class}`, both of which were SILENT misses.
#
# WHY THE ABSTRACTIONS SUITE AND NOT ONE OF THE OTHER FOUR. The enums are St4i.Connector.Abstractions', the
# left-hand side of every assertion is REFLECTION OVER THAT COMPILED ASSEMBLY, and the reader who has to be
# told these names are published strings is the one reading that assembly — a third-party driver author,
# per N-2. EngineApi.Tests owns the JSON derivation but none of the SQL or the markup; EdgeCore.Tests owns
# the SQL but neither the browser client nor the markup. Choosing either would have been §8.1(f) exactly:
# a domain inherited from where the file sits rather than derived from the question.
#
# 🔴 AND THE COST, STATED THE WAY K-1 STATED ITS OWN. This adds a THIRD source-tree dependency to a project
# whose csproj says a third-party author's suite "would look exactly like this" — and a wider one than
# K-1's: it now reads web/src and the WPF shell's markup, which no third-party author has. The ASSEMBLY
# boundary is untouched (no ProjectReference, no PackageReference, System.* and Xunit only), but the claim
# in that csproj comment is now weaker than it reads. Deliberate is not the same as free.
#
# EVERY OTHER SUITE IS UNCHANGED, and that is a check rather than a coincidence: P-2 adds no file outside
# tests/St4i.Connector.Abstractions.Tests and changes no src/ file at all, so a moved total anywhere else
# would mean this task reached somewhere it had no business reaching.
#
# EXPECT_WARNINGS stays 116: the new file builds with 0 warnings of its own (measured — the project builds
# clean, and the full -t:Rebuild below is what pins the repository figure).
#
# ══════════════════════════════════════════════════════════════════════════════════════════════════════
# 🔴 TASK Q-1 (.superpowers/sdd/third-state-unreadable/task-1-brief.md) raises EXPECT_EDGECORE 1094 -> 1101
# (+7) and EXPECT_ENGINEAPI 1337 -> 1338 (+1). The other three constants DO NOT MOVE. Grand total
# 2665 -> 2673, read off the five constants below rather than carried forward.
#
# 🔴 COUNTED FROM THE RUNNER, and this task is the reason to say HOW. `dotnet test --list-tests` reports
# 1094 for EdgeCore AFTER the seven were added — the same figure the constant held BEFORE them. VSTest
# discovery does not enumerate every data row, so the list count and the executed total are two different
# numbers and only one of them is what this file asserts. Both suites were RUN to completion instead:
# EdgeCore `Total: 1101`, EngineApi `Total: 1338`, both `Failed: 0`. Anyone re-deriving these with
# --list-tests will get 1094/1338 and must not "correct" the constants to match.
#
# WHAT THE EIGHT ARE, and why the split is 7/1 rather than all in one place. The property Q-1 installs is
# "a file that exists but could not be read is a THIRD outcome, never the absent one, and nothing writes on
# it". That has two halves and they are separately falsifiable:
#
#   + 7  tests/St4i.EdgeCore.Tests/FleetSettingsStoreTests.cs — the STORE half, on FleetSettingsStore.Read's
#        three outcomes. Six of the seven are one per branch of that method, and the four Unreadable ones
#        are asserted MEMBER BY MEMBER rather than through one example (malformed JSON; an empty file;
#        legal JSON that deserializes to nothing, which is the only unreadable shape that throws NOTHING and
#        is what forces `Failure` to be nullable there; and a FileShare.None handle, which is the vector
#        that has no bad bytes in it at all). That is deliberate: docs/startup-failure-posture.md §3.1a
#        records TWICE that this exact question was answered from one member and written about the
#        population. The seventh covers Delete() after its File.Exists gate was removed.
#   + 1  tests/St4i.EngineApi.Tests/StartupSettingsReplayHardeningTests.cs — the COMPOSITION-ROOT half, and
#        the control-pair witness §8.1(h6) asks for: it boots the real Program.cs over a hand-malformed
#        fleet-settings.json with the env floor set, and reads the file's BYTES back off disk. It is one
#        test rather than three because the assertion that carries it is a single comparison against the
#        operator's original bytes — which is simultaneously "not overwritten" and "not deleted". Run at
#        BOTH sides: at dd4a3e68 the bytes on disk are the environment floor; at this commit they are
#        unchanged.
#
# EXPECT_ABSTRACTIONS / EXPECT_CONFORMANCE / EXPECT_EDGESERVICE STAY PUT, and that is a check rather than a
# coincidence: Q-1 changes three files under src/ (FleetSettingsStore.cs, Program.cs, and a doc comment in
# FleetCore.cs), all reached only by EdgeCore.Tests and EngineApi.Tests. A moved total in any of the other
# three would mean this task reached somewhere it had no business reaching. P-2's enum-spelling witness in
# the Abstractions suite is one of the three that must not move, and it did not: Q-1 adds a public enum to
# St4i.EdgeCore, and that registry is closed at St4i.Connector.Abstractions' exported types.
#
# EXPECT_WARNINGS stays 116 and EXPECT_BUILD_NODES stays 0. No suppression of any kind was added — no
# NoWarn, no #pragma, no .editorconfig, no WarningLevel change. The three changed src/ files build with no
# warning of their own (measured per-project; the full -t:Rebuild below is what pins the repository figure).
#
# 🔴 Q-1 FIX ROUND raises EXPECT_EDGECORE 1101 -> 1106 (+5) and EXPECT_ENGINEAPI 1338 -> 1339 (+1).
# Grand total 2673 -> 2679. The other three constants still do not move.
#
# WHY A SECOND MOVE IN THE SAME TASK, which is a fact to justify rather than a number to paste over. Review
# found that Q-1's scope table excluded `SiteLinkStore` with a reason that was FALSE: it is the pre-Q-1
# `FleetSettingsStore` verbatim, and `SiteBridgeManager.ApplyAsync` calls `Save` UNCONDITIONALLY on the
# startup path — so an unreadable site-link.json was overwritten with the default standalone record on an
# ordinary successful start, losing the Site broker host, its port and the pinned trust anchor, with NO log
# line and, unlike the settings twin, NO environment precondition at all (the UNS spine that gates the block
# defaults on). The owner's ruling states the rule once for all four items, so the twin is in scope.
#
#   + 5  tests/St4i.EdgeCore.Tests/Site/SiteLinkStoreTests.cs — one per branch of the new
#        SiteLinkStore.Read(), with the Unreadable population asserted member by member (malformed; legal
#        JSON yielding no object; a FileShare.None handle) rather than from one example. The lock test
#        carries the same anti-tautology second half its settings counterpart does: the same store reads the
#        same file successfully once the handle is gone, which kills a Read() that always answered
#        Unreadable.
#   + 1  tests/St4i.EngineApi.Tests/Site/SiteEndpointsTests.cs — the twin's control-pair witness, through
#        the real composition root, reading the file's BYTES off disk. Run at BOTH sides: at d83194bd the
#        bytes on disk are the default standalone record; at this commit they are unchanged. It reuses that
#        file's existing factory (two new OPTIONAL parameters, so every other test there is unaffected)
#        rather than standing up a sixth copy of the env-var harness.
#
# Also in this round and moving NO total: the settings witness gained two assertions inside an existing test
# (it asserted only "not the floor"; the documented claim is the stronger "FleetHost's built-in defaults",
# so that is now what it asserts).
#
# 🔴 Q-1 FIX ROUND 2 raises EXPECT_ENGINEAPI 1339 -> 1340 (+1). Nothing else moves; grand total 2679 -> 2680.
#
#   + 1  tests/St4i.EngineApi.Tests/Site/SiteEndpointsTests.cs —
#        TheSiteLinkFileHasExactlyOneWriterInSrc_AndItIsTheSharedApplyBody (named ..._AndItIsApplyAsync
#        until task Z-1 moved the Save into ApplyCoreAsync). Review N3: the claim "ApplyAsync holds
#        the only Save of site-link.json in the whole product" is what makes the new Error message's
#        sentence "it was NOT overwritten or deleted by this start" TRUE, and it had no census while its
#        settings counterpart (TheStartupReplayHasExactlyOneArm_...) has had one since H-1a. An enumeration
#        is verified by the check that could refute it, never by re-reading the members it names.
#        TWO populations asserted APART, because they fail differently and a single number would cancel the
#        case worth seeing: (1) every src/ file that NAMES SiteLinkStore — a writer must, to obtain one —
#        swept for `.Save(`, expected 1 and in SiteBridgeManager.cs; (2) all of src/ swept for the LITERAL
#        "site-link.json", which is how a writer that BYPASSES the store would appear, expected 1 and in the
#        store's own private FileName constant. Same stated non-reach as the settings census.
#
# The other four fix-round-2 items move no total: the census recount (prose, four published statements),
# SiteLinkRead gaining a `Failure` member so its LogError passes the exception its settings twin already
# passed, and two new entries on docs/owner-decisions.md.
# ══════════════════════════════════════════════════════════════════════════════════════════════════════
#
# ══════════════════════════════════════════════════════════════════════════════════════════════════════
# 🔴 TASK X-1 (.superpowers/sdd/suites-hermetic/task-1-brief.md) — +1 ON ALL FIVE, AND +1 MORE ON EDGECORE.
# 2732 -> 2738. COUNTED FROM THE RUNNER (`dotnet test --list-tests`) on every suite, not by hand. The full
# justification lives here; the other four constants carry a pointer back to it.
#
# WHAT WAS ADDED, and it is two things rather than one:
#   (1) tests/Shared/OwnOutputDirectoryGuard.cs — ONE [Fact], LINKED into all five projects exactly as
#       TestRunTempRoot.cs and RealCredentialStoreLeakGuard.cs already are. +1 on each of the five.
#   (2) tests/St4i.EdgeCore.Tests/TestRunTempRootTests.cs gains ONE [Fact],
#       MachineConfigStore_ResolvesAwayFromThisAssembliesOwnOutputDirectory — the sibling of the
#       CredentialStore_ResolvesAwayFromTheRealProgramDataCredentialDirectory fact already in that class,
#       and it lives in EdgeCore.Tests because that is the only suite that can see MachineConfigStore.
#       +1 on EDGECORE only. Nothing is rewritten, split or deleted anywhere.
#
# 🔴 EDGECORE'S RUNNER NUMBER AND ITS RUN TOTAL ARE NOT THE SAME NUMBER, and this is where that shows.
# `--list-tests` returned 161 / 24 / 1124 / 52 / 1370. Four of those are exactly the old constant plus the
# facts added above. EDGECORE's is SEVEN SHORT of the 1131 a real run reports — discovery counts a theory
# whose data it cannot enumerate as one case and the run expands it — so on that one suite the rule
# "counted from the runner" cannot be applied to the constant directly, and pretending otherwise would be
# the smoothing this file exists to refuse.
#
# WHAT IS MEASURED AND WHAT IS ARGUED, kept apart. MEASURED, on this tree: `--list-tests` 1124 against a
# real run's `Total: 1131` — a gap of exactly 7, on the SAME tree, in the same session. ARGUED, not
# measured: that the gap was also 7 at the base. The argument is that both facts X-1 adds are plain
# `[Fact]`s — no `[Theory]`, no `MemberData`, no `InlineData` — and only theory expansion produces this
# gap, so neither of them can have moved it. Nobody re-ran the base tree to check, and that is the whole
# of the evidence for the 1129 half.
#
# WHAT THE NEW GUARD ASSERTS: that a test process leaves its OWN OUTPUT DIRECTORY — AppContext.BaseDirectory,
# beside the built binary — exactly as it found it. That directory outlives every run (`dotnet build` does
# not clean it, and neither does this script), and THREE of the product's stores resolve to it by default,
# so a file one run writes is a file the next run reads. Measured on this machine before the fix:
# St4i.EngineApi.Tests' output directory held a products.json of 625 products, 623 of them minted one per
# run, and a machine-operating-config.json of 240,778 bytes whose AOI-01 History list stood at 624 entries.
#
# 🔴 THE GUARD DOES NOT MAKE THE SUITES HERMETIC AND MUST NOT BE READ AS SAYING SO. One of the three
# stores was closed (MachineConfigStore, via the ST4I_MACHINE_CONFIG_DIR redirect that task H-1c's seam
# made possible and tests/Shared/TestRunTempRoot.cs now sets). The other two — ProductConfigStore and
# SimulatedEcosystem — have NO relocation variable of any kind, so no harness can move them; giving them
# one is a change to src/ and to every shipped install's on-disk layout, which task X-1 was told to report
# rather than do. They are EXEMPT from the guard, the exemption is derived from those two stores' own
# sources, and the derivation re-checks its own justification on every run: the day either store gains an
# EnvVarDir, the guard goes RED and demands the exemption be spent.
#
# 🔴 AND A THIRD THING WAS ADDED THAT MOVES NO TOTAL: the output-directory bracket in this file, above the
# suite loop. It adds no test, exactly as K-1's credential bracket adds none, and it exists because the
# C# guard's window hole was MEASURED OPEN on this task's own dirty arm — the guard reported green while
# the pre-fix tree wrote machine-operating-config.json underneath it. A control pair resting on the guard
# alone would have been scheduling-dependent, which is not a control.
#
# EXPECT_WARNINGS stays 116 and EXPECT_BUILD_NODES stays 0. No suppression of any kind was added and no
# TRACKED .editorconfig exists in this tree — the qualifier is the correction, not decoration (review Minor
# 1): NINE exist under web/node_modules/, third-party and ignored, so the unqualified sentence was a
# whole-tree sweep that is false of the filesystem. None can reach a .cs compilation (.editorconfig scoping
# walks UP from a source file and web/node_modules is nobody's ancestor), so the risk was always nil and
# the CEILING was always wrong — which is the brief's own fourth wording rule landing on the block that
# quotes it. None of the five test projects sets GenerateDocumentationFile, so the
# new `///` blocks are not compiled either way — tag balance on every block was checked directly rather
# than inferred from that, because an unbalanced block HIDES the diagnostics inside it.
# ══════════════════════════════════════════════════════════════════════════════════════════════════════
EXPECT_ABSTRACTIONS=161
EXPECT_CONFORMANCE=24
# chore/test-hygiene raised this 735 -> 741 (+6): guards proving the test-isolation seam added to
# CredentialStore, which was the only one of THIRTEEN stores without one — which is exactly why
# (🔴 Dot F branch review, F-7: this said FOURTEEN while the same file says THIRTEEN in three later
# places and the product declares thirteen directories. Dot F's own R4 counts census named this file's
# directory in its corpus and did not reach this line — it corrected packaging/remove-data.ps1 and
# stopped there.)
# 2,999 DPAPI blobs accumulated in the product's REAL credential directory, dating to 2026-07-18.
# 🔴 Đợt D, D-1 re-review — this total is UNCHANGED at 741, and that is the point. A reviewer's gate run
# came back EdgeCore 740/741 on WalFlushPumpTests.Pump_DrainsAnIdleBacklogOnItsOwnTimer_..., an IOException
# out of File.ReadAllLines (not out of any assertion), reproducing 1 run in 4. Byte-for-byte the defect Đợt C
# closed in StoreAndForwardRestartSurvivalTests: a FileShare.Read reader opened against a LIVE writer — the
# pump is `await using`, so it is still ticking on the assertion line, and every tick's drain ends in the
# vendored SDK's unconditional File.WriteAllText(queuePath, ""). Fixed at the mechanism in all three of this
# file's reads by disposing the pump first (DisposeAsync cancels the loop AND awaits it, so no handle can be
# open afterwards) — no retry, no share-mode tolerance, NO NEW TUNABLE, and no test added or removed. The
# reviewer's 1-in-4 became 0 failures in 12 consecutive runs, but the load-bearing argument is the mechanism,
# not the sample: after DisposeAsync returns there is no writer for the read to collide with.
# 🔴 Đợt D, D-2 raises this 741 -> 787 (+46).
#
# 🔴 COUNTED FROM THE RUNNER (`dotnet test --list-tests`), not by hand. The previous revision of this block
# said 7/4/8/12/8 where the truth was 7/4/9/11/8 — two files wrong, and the two errors CANCELLED, so the
# grand total was right and the justification was not. That is the failure mode this per-file breakdown
# exists to prevent: a total that reconciles is not evidence that anybody knows where the tests are. Both
# numbers now come from the runner enumerating them.
#
#     + 8  ModbusRtuDriverLoopbackTests      (new) — a real read against an in-process RTU slave; Input
#                                             registers read through FC04 not FC03; two drivers on ONE bus
#                                             each reading their own slave address; the driver handing the bus
#                                             ITS OWN map's timeout and retry count; the device going quiet
#                                             (Health degrades, iterator survives); Health never reporting
#                                             Connected even transiently against a device that never answers;
#                                             construction opening no link; disposal releasing the lease once.
#     + 6  ModbusBusCancellationTests        (new) — the task's non-negotiable: cancel while queued for the
#                                             bus; cancel an in-flight read WITHOUT rebuilding the link; a
#                                             second device on the same bus still reading correctly after the
#                                             first one's cancellation; a cancellation BETWEEN two registers
#                                             leaving the bus clean; an aborted read never retrying even when
#                                             the transport allows three; an already-cancelled token refused at
#                                             the arbitration gate.
#     + 9  ModbusBusResynchronisationTests   (new) — the post-timeout bus state: the hazard demonstrated
#                                             against raw NModbus; the late frame discarded; the quiet window
#                                             restarting rather than expiring on a schedule; a fresh link NOT
#                                             clearing the quarantine; exactly one request on the wire
#                                             (Retries honoured); a transaction that executed nothing staying
#                                             clean; a clean transaction costing the next one nothing; a bus
#                                             that never goes quiet being refused AND its link rebuilt; the
#                                             arbitration lock surviving that refusal.
#     +15  ModbusBusRegistryTests            (new) — the sharing/refcount contract D-4 consumes: sharing per
#                                             key, distinct keys, one release vs the last release, a double
#                                             release decrementing once, re-acquire after disposal, registry
#                                             disposal, acquire-after-disposal, the settings defaults and their
#                                             validation, 32 concurrent acquires, BeginTransactionAsync's own
#                                             argument validation (3 cases) and its one-operation-at-a-time
#                                             guard.
#     + 8  GatewayTcpBusLinkTests            (new) — the RTU-over-TCP transport: DiscardInBuffer head to head
#                                             against NModbus's own TcpClientAdapter, abort-without-close,
#                                             the bounded timeout, the hang-up, disposal, RTU end to end over
#                                             a real socket, the bus-key rule, and a dead endpoint.
#
# Eight of those 46 exist only because a mutation survived an earlier version of this suite: a fresh link
# clearing the quarantine; Transport.Retries left at NModbus's own default of 3; Health reporting Connected
# transiently; DiscardInBuffer's own hook being unwired from the drain it delegates to; the quiet window's
# TRAILING silence; the FC04 (Input register) arm, which no RTU map in the suite had ever declared; and the
# driver's own map reaching the bus at all. The 46th (AnAbortedInFlightRead_NeverRetries_...) pins a property
# of a THIRD-PARTY exception filter rather than of this code: NModbus happens not to retry the
# OperationCanceledException the abort throws from inside its own retry loop, and nothing here would notice if
# that changed — a retried abort re-transmits a request whose caller has given up, which on D-5's write path is
# a physical double-actuation. Verified to have teeth: making the link throw TimeoutException instead makes the
# same test see 32 bytes (four attempts) rather than 8. See task-2-report.md §8 — none was found by reading.
#
# EVERY OTHER SUITE IS UNCHANGED, and that is a check rather than a coincidence: D-2 adds no code outside
# src/St4i.EdgeCore/Drivers/Modbus, so a moved total anywhere else would mean this task reached somewhere it
# had no business reaching. In particular EXPECT_CONFORMANCE stays 22 — RTU conformance wiring is D-6 — and
# every pre-existing Modbus test passes UNCHANGED (verified: 114/114 on four consecutive baseline runs at
# 36d9454c). The D-2 review fix round also rewrites two PRE-EXISTING conformance helpers
# (Modbus/OpcUaDriverConformanceTests' FindAndReleaseFreePort -> Drivers/ClosedLoopbackPort) and adds NO test
# for them: a released ephemeral port can be reassigned to another test's listener, which is what made an
# unrelated TLS test fail once. A moved total there would mean that rewrite was not behaviour-preserving.
#
# 🔴 Đợt D, D-3 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-3-brief.md) raises this
# 787 -> 817 (+30). D-3 adds the NATIVE SERIAL transport — Modbus RTU over a real COM port — in its OWN
# assembly (src/St4i.EdgeCore.Serial), which is the only place in the product allowed to depend on
# System.IO.Ports. Every number below is COUNTED FROM THE RUNNER (`dotnet test --list-tests`), not by hand,
# for the reason D-2 wrote down: a total that reconciles is not evidence that anybody knows where the tests
# are.
#
#     + 9  SerialLineSettingsTests          (new) — the line parameters of one RS-485 segment: the defaults
#                                            are the MODBUS spec's 19200-8-E-1 and not SerialPort's own
#                                            9600-8-N-1 (asserted against a real SerialPort as the control,
#                                            so the test is about the decision rather than about reading back
#                                            the numbers written in the type); six rows of lines a port cannot
#                                            honour (baud <= 0, 7/9 data bits, StopBits.None/OnePointFive);
#                                            a blank port name; and the port-name normalisation, because
#                                            "com3" and "COM3" are one physical port and the bus key is built
#                                            from that string.
#     +14  SerialPortBusLinkTests           (new) — the transport itself, to the exact extent a machine with
#                                            no RS-485 hardware can drive it: SerialPort.DiscardInBuffer
#                                            verified to reach Kernel32.PurgeComm while TWO of NModbus's three
#                                            own adapters are 1-IL-byte empty bodies (the brief's "verify,
#                                            don't trust the name" obligation, discharged by reading the
#                                            shipped IL because no loopback exists to measure it
#                                            behaviourally); the port configured from an explicit line AND
#                                            from the default line (both arms — D-2's I-2 lesson); the
#                                            handshake forced off and RTS left deasserted, which is the
#                                            RS-485 direction-control decision; four theory rows proving the
#                                            bus key distinguishes every line parameter, plus its
#                                            case-insensitivity; an absent port failing with the port AND its
#                                            framing in the message; the abort check firing BEFORE the port is
#                                            touched (with the cleared-abort arm as the discriminator); the
#                                            write timeout reaching the port object; a closed port draining to
#                                            nothing without throwing, and disposal being idempotent; and two
#                                            registry tests — two connectors on one line sharing ONE bus and
#                                            ONE open, and two connectors that disagree about baud rate
#                                            getting TWO buses rather than one silently shared port.
#     + 7  SerialDependencyScopingTests     (new) — the STRUCTURAL proof the brief demands instead of
#                                            inspection: the three shipping executables (EdgeService, EngineApi,
#                                            the WPF shell) carry no System.IO.Ports.dll; St4i.EdgeCore — which
#                                            holds ModbusBus, the RTU framing and GatewayTcpBusLink — references
#                                            neither the package nor the serial assembly; plus THREE positive
#                                            controls without which those FOUR would be vacuous (this test
#                                            assembly's own output DOES carry the DLL, the serial assembly DOES
#                                            reference the package, and the output search refuses a project that
#                                            was never built rather than reporting it clean). 4 + 3 = the 7 above.
#                                            (Review M-6: this said "those five" — a hand-kept count that drifted
#                                            when the never-built guard landed.)
#
# Six of those 30 exist only because a mutation survived an earlier version of this suite: the "never built"
# guard (which every caller bypassed, so nothing ever ASKED it — a reachability gap a mutation cannot find on
# its own); the abort check and the write timeout (unreachable until an internal Adopt() let a test drive the
# pre-I/O half of those members without hardware); the write timeout's non-positive arm (the test originally
# used -1, which IS SerialPort.InfiniteTimeout, so its expected value coincided with its input); and the read
# slice's own bound, which is that defect's sibling found by sweeping rather than by care.
#
# 🔴 FIVE mutations still SURVIVE and are recorded rather than papered over — see task-3-report.md §8. Four of
# the five need a COM port with something on the other end of it, which no CI machine and no portable virtual
# COM pair provides; the fifth is untestable by construction. Nothing hardware-conditional was committed: a
# dynamically skipped test would fail this very gate, which expects 0 skipped.
#
# EVERY OTHER SUITE IS UNCHANGED, and that is the check rather than a coincidence: D-3 adds no code outside
# src/St4i.EdgeCore.Serial and tests/St4i.EdgeCore.Tests. In particular EXPECT_ABSTRACTIONS stays 151 even
# though St4i.Connector.Abstractions.Tests owns the sibling "this assembly references only the BCL" guard, and
# EXPECT_CONFORMANCE stays 22 because RTU conformance wiring is D-6. D-3 also EXTRACTS MakaretuNotShippedTests'
# solution-root walk and output search into tests/St4i.EdgeCore.Tests/BuildOutputProbe.cs so the new scoping
# suite shares one implementation rather than growing a second copy that can drift silently — that rewrite is
# behaviour-preserving and adds NO test (MakaretuNotShippedTests stays at 3, counted from the runner). A moved
# total there would mean it was not.
#
# 🔴 D-3's REVIEW FIX round raises this 817 -> 824 (+7), all in SerialPortBusLinkTests (14 -> 21), counted
# from the runner. Every one closes something the review found; none is a rewrite or a split:
#   + 1  I-1  Read_WithAZeroLengthCount_ReturnsImmediately_WithoutTouchingThePort. SerialPort.Read(buf,0,0)
#             returns 0 WITHOUT WAITING (measured: 0.46 ms; a bare loop over it ran at 33 MILLION
#             iterations/second), so a zero count fell through the `read > 0` check and span the loop holding
#             the bus's arbitration lock and a core — with no deadline at all when ReadTimeout <= 0.
#             GatewayTcpBusLink never had this because Socket.Poll consumes its slice whatever the count is:
#             a divergence between two links on one seam that the report's own §8.6 was written to catch and
#             did not. The discriminating assertion is that the port is CLOSED, so anything that reached it
#             would throw.
#   + 1  I-2  EveryLink_PinsThePortsReadTimeoutToOneSlice_HoweverItWasConstructed. The slice pin lived in
#             CreatePort, so Adopt produced a link whose port kept SerialPort's own default of -1
#             (InfiniteTimeout) — the unbounded blocking read measured as releasable by nothing but Dispose(),
#             i.e. Đợt B's forbidden mechanism on a shared bus. All three mutations defending the pin targeted
#             CreatePort, so the evidence had a hole the same shape as the code. The pin moved to the
#             constructor; the test's first assertion (the factory leaves the BCL default alone) is what makes
#             the second one discriminating.
#   + 4  I-3  The four members that were unreachable while the class held a concrete SerialPort — every member
#             of which is non-virtual and which cannot be constructed without hardware. A ~40-line internal
#             ISerialPortHandle (7 members) with a real-backed impl and a fake whose every behaviour was
#             MEASURED against a real port makes them CI-testable: the drain's true count (M19b, the most
#             consequential survivor), the outer deadline (M21b), the between-slice abort recheck with the
#             port left OPEN, and a read returning as soon as a byte arrives. Same move D-2 made when
#             NModbus's IStreamResource could not be driven.
#   + 1        AnRtuFrameRoundTripsThroughThisLinksOwnReadAndWrite — a real NModbus RTU master and slave on
#             opposite ends of a paired handle, so real CRC, real t3.5 framing and real slave dispatch pass
#             through THIS transport's own Read/Write rather than through D-2's in-memory link. It narrows
#             "no Modbus frame has ever traversed this transport" to "…has ever traversed a real SerialPort".
#             Verified to have teeth: truncating the write by one byte kills it.
#
# The hardware half is now a COMMITTED, runnable artefact — tools/serial-bench, an executable OUTSIDE the five
# suites, so `skipped == 0` is untouched. That constraint is right and the brief was wrong about it: xUnit
# counts a dynamically skipped test in Total, so a hardware-conditional suite would make Skipped
# environment-dependent and any fixed expectation would fail on the BETTER-equipped machine — trap #2 in a
# hardware costume. It is in the solution so this gate's build keeps it compiling, and it adds no test.
#
# 🔴 D-3's SECOND review round raises this 824 -> 825 (+1), in SerialPortBusLinkTests (21 -> 22), for M-10:
#   + 1  DrainBufferedInput_WhenThePortIsTornDownMidDrain_ReturnsWhatItAlreadyRemoved_RatherThanThrowing.
#        The drain swallowed the two "the port went away underneath me" shapes around BytesToRead and NOT
#        around Read, so a disposal landing between them threw out of the drain — and
#        ModbusBus.ResynchroniseAsync turns any throw from there into ModbusBusResynchronisationException +
#        FaultLink(). Noisier teardown rather than a wrong number, but the half-guarded shape was the defect.
#        The test has TWO arms because the drain touches the port twice per iteration and a mutation aimed at
#        the Read catch matched the BytesToRead one instead and SURVIVED — fixing one instance of a defect
#        class buys no immunity to the class. Its load-bearing assertion is that PARTIAL progress is still
#        reported: a `catch { return 0; }` would pass a "doesn't throw" test while telling the quiet window
#        the line had been silent when 512 bytes had just come off it.
#
# 🔴 GatewayTcpBusLink gets the IDENTICAL one-line fix in the same commit and adds NO test. It is a shared
# nit, not a serial regression, and fixing only the serial one would create exactly the two-links-on-one-seam
# divergence D-3's report §8.6 exists to catch. It is untestable for the same reason the serial drain was
# before review I-3 — that class holds a concrete TcpClient — and the mutation disabling it SURVIVES and is
# recorded as such rather than papered over. All 198 Drivers.Modbus tests pass unchanged, which is the check
# that the edit is behaviour-preserving.
#
# 🔴 TASK D-4 (multidrop) raises this 825 -> 850 (+25), counted from the runner (`dotnet test --list-tests`),
# not by hand. Three files; none is a rewrite, a split or a deletion:
#   +17  ModbusMultidropMapTests      (new file — how a bus of N devices is DECLARED and how it fans out)
#   + 5  ModbusMultidropBusTests      (new file — N devices actually RUNNING on one bus)
#   + 3  ModbusRtuDriverLoopbackTests (8 -> 11 — the RTU addressing boundary; see below)
#
# The 17 map tests are each a configuration that would otherwise fail SILENTLY or WRONGLY rather than throw:
# two devices at one slave address (both answer, the frames collide, and the master decodes whichever survived
# — a plausible wrong number); two devices claiming one machine (the second silently never registers, and the
# reason is a log line); a bus declaring no devices (indistinguishable from a connector that failed); a device
# element that will not parse (an error naming no device out of eight). Plus the ONE refusal that is
# deliberately ABSENT: unit 0 parses fine here, because this document shape is shared with the Modbus TCP
# driver where unit 0 is legal and common — D-2's own m-9 correction, which is why the RTU rule lives at the
# RTU CONSTRUCTION boundary instead, i.e. the 3 tests below.
#
# The +3 in ModbusRtuDriverLoopbackTests are that boundary and its control: unit 0 (broadcast — a read to it
# can NEVER be answered, and on a multidrop bus each of those timeouts holds the shared arbitration lock for a
# full read timeout), units 248-255 (reserved by MODBUS over Serial Line V1.02 §2.2 — a separate check with a
# separate message, so a mutation deleting one leaves the other standing), and BOTH EDGES of the addressable
# range accepted, because a refusal that is too WIDE takes a legitimately-addressed device off the bus while
# blaming the operator. That last one is the control: without it, narrowing the range to 1..127 kills nothing.
#
# 🔴 The 5 bus tests MEASURE the costs of sharing one wire rather than asserting them, and each prints its own
# figures (`--logger "console;verbosity=detailed"`) so nobody has to take task-4-report.md's word for them —
# D-3's reviewer had to rewrite its whole hardware probe to check its numbers. On this machine:
#   * one timeout quarantines the bus ONCE for the WHOLE bus (14 stale bytes discarded, both healthy devices
#     reading again 92 ms later against a 50 ms quiet window) — NARROWER than D-2 §5.5's own wording, which
#     reads as though every device pays a window;
#   * one unanswered device collapses two healthy devices from 135.0 to 2.0 reads/s — a 67.5x tax, three
#     orders of magnitude worse than the quarantine, and the finding of the task;
#   * a device polling at 200 ms hit 15 of a nominal 15 polls while three others completed 119,069 flat out —
#     not starved, because the driver delays AFTER each poll rather than on a schedule.
# The two ratio tests compare a rate against a rate measured on the SAME machine in the SAME test and assert a
# 4x margin against a ~50x effect, so they state a mechanism rather than a machine's speed.
#
# 28 mutations, all KILLED, every round opened with a positive control and every verdict gated on all five
# verbs of scripts/mutate-guard.sh. One SURVIVED on the first pass and was a real vacuous test: the
# nested-`devices` refusal could be deleted with every test green, because the generic "this element is not a
# valid single-device map" wrapper names the same element index. What the dedicated check buys is the WORDING,
# so the assertions are now on the phrase and on the ABSENCE of an inner exception. One reported NOT-APPLIED
# (a needle that no longer matched the source) and was re-run rather than read as a gap.
#
# EXPECT_ENGINEAPI moves too (+6) because the fan-out's REGISTRATION half necessarily lives beside
# ConnectorRegistry — see its own note below. EXPECT_ABSTRACTIONS, EXPECT_CONFORMANCE and EXPECT_EDGESERVICE
# are deliberately unchanged: D-4 adds no code outside src/St4i.EdgeCore/Drivers/Modbus,
# src/St4i.EngineApi/Config and their two test projects, so a moved total anywhere else would mean this task
# reached somewhere it had no business reaching. EXPECT_CONFORMANCE in particular stays 22 — RTU conformance
# wiring is still D-6.
#
# 🔴 D-4's REVIEW FIX round raises this 850 -> 860 (+10), counted from the runner. Two files:
#   + 9  ModbusMultidropMapTests      (17 -> 26)
#   + 1  ModbusRtuDriverLoopbackTests (11 -> 12)
# ModbusMultidropBusTests stays 5 — the m2/m7 fixes there change only what the test PRINTS, not what it
# asserts, and a moved total would mean they did more than that.
#
#   + 5  I-2  EveryDeviceLevelKeyAtTheRoot_IsRefused_NotOnlyTheMandatoryOnes — one InlineData per device-level
#             key. {"pollIntervalMs": 5000, "devices": […]} parsed cleanly and every device silently ran its
#             own value: verbatim the failure the class's own no-inheritance doc uses to justify itself, left
#             reachable by the check written to prevent it. The first list held only the two MANDATORY fields
#             — the wrong test; the right one is "could a reader believe this applies to the bus", which is
#             every key the per-device parse consumes. Each key is a separate case because a mutation deleting
#             one entry survives a test that checks another.
#   + 3  I-1  The worst-case arbitration hold is decidable from the map alone and nothing computed it:
#             20 registers x (5 retries + 1) x 60 000 ms readTimeout ~= TWO HOURS of shared bus per poll, every
#             input declared, every value inside this map's own accepted maxima. ModbusRegisterMap gains
#             WorstCaseBusHoldMs (long, because that product overflows int and a NEGATIVE hold would make the
#             check report a comfortable number) and FanOut warns, comparing each device's hold against the SUM
#             OF THE OTHER devices' poll intervals. Three tests: the hog is named with its arithmetic; a
#             correctly-sized bus is SILENT (the control — without it the check could be tightened into noise);
#             and the warning names the DOMINANT term, because a derived timeout is the product's own default
#             and a declared one is the operator's number.
#   + 1  I-1  ABusOfOne_IsNeverWarnedAbout_InEitherDocumentShape, and it is here because a mutation found the
#             first version could not fail: it used only the LEGACY single-device document, which RETURNS
#             EARLY and never reaches the check. The shape the devices.Count < 2 guard actually defends is a
#             one-element `devices` ARRAY, where the siblings' cadence is 0 and every such bus would otherwise
#             be warned about. Both arms now.
#   + 1  I-5  ValidateRtuUnitId_RefusesWithoutALease_AndTheConstructorUsesTheSameRule. The rule moved out of
#             the ctor into a public static so D-7 can refuse a bad map BEFORE ModbusBusRegistry.Acquire — a
#             ctor throw after a lease is taken leaks a reference count nothing decrements, and D-3 measured
#             that SerialPort opens a COM port EXCLUSIVELY, so the port is dead for the process lifetime and
#             presents as an unrelated connector failing to start. The discriminating assertion is that it
#             throws with no bus, no lease and no registry at all; the second half pins that both paths give
#             the SAME message so they cannot drift.
#
# 9 further mutations this round (8 + a re-run), all KILLED, every verdict gated on all five verbs. ONE
# survived first — the devices.Count < 2 guard — and was a real vacuous test rather than dead code; see the
# +1 above.
#
# 🔴 backlog-test-deadlines (edgecore-host-crash-report.md) raises this 860 -> 861 (+1), counted from the
# runner (`dotnet test --list-tests`: 853 -> 854). ONE file, ONE new test, none rewritten and none deleted:
#
#     + 1  HotFolderDriverTests (4 -> 5)
#          DisposeAsync_WhileTheReadLoopIsIdle_EndsTheEnumeration_RatherThanStrandingItForever
#
# 🔴 IT IS THE REGRESSION TEST FOR THIS SCRIPT'S OWN RECURRING "ABORTED SUITE", and the diagnosis every
# previous reading got wrong. The log said `Test host process crashed : [deviceidentity] ... corrupt or
# unreadable` and printed `Passed! ... 731` — trap #2's exact costume — so four tasks recorded it as "a
# pre-existing DeviceIdentityStore flake, no root cause". None of that was the defect:
#   * the "crash reason" is just whatever the host last wrote to STDERR. That line comes from the
#     corrupt-blob test's own HANDLED path, which had already PASSED. A red herring, printed by a green test.
#   * the host did not crash. The trx's own <Times> shows start 20:47:53, last result 20:48:36, and the
#     abort recorded at 21:03:58 — 966 s later, i.e. the exact moment THIS SCRIPT's ceiling fired
#     `taskkill //F //IM testhost.exe`. The gate manufactured the crash it then reported. Trap 7 again, in a
#     third costume: a healthy-looking negative produced by the checker itself.
#   * the CPU heuristic could not have caught it either (trap 7(d), already documented above).
# The real defect: HotFolderAoiDriver.DisposeAsync disposed the SemaphoreSlim its own ReadAsync was parked
# on. SemaphoreSlim.Dispose() drops queued ASYNC waiters WITHOUT completing them, so the await is stranded
# permanently and its CancellationToken can no longer reach it — measured 200/200 on this runtime. Because
# xunit starts a DisableParallelization collection only after the whole parallel phase drains, that one
# stranded test kept the Site (70) and OpcUa (52) collections from ever starting: 731 of the 860 this line
# then expected, forever.
# Reproduced 2 times in 8 runs under two-worker load, 0 in 24 runs after the fix.
#
# EXPECT_EDGECORE is the ONLY total that moves. The fix also touches src/St4i.Connector.Conformance
# (bounding the unbounded `await runTask` that let one stranded driver hang a whole assembly) and
# src/St4i.EdgeCore/Drivers/OpcUa/OpcUaDriver.cs (the identical `_sessionLock.Dispose()`, a second instance
# of the same defect class) — both ADD assertions/delete a line and add NO test, so a moved total on
# Abstractions, Conformance, EdgeService or EngineApi would mean this task reached further than it meant to.
#
# 🔴 TASK D-5 (the RTU WRITE path) raises this 861 -> 896 (+35). COUNTED FROM THE RUNNER
# (`dotnet test --list-tests`: 854 -> 889), not by hand, for the reason D-2 wrote down: a total that
# reconciles is not evidence that anybody knows where the tests are. ONE file, ONE new test class; nothing
# else in this suite gains or loses a test.
#
#     +35  ModbusRtuDriverWriteTests (new) — 24 methods, 35 cases (three theories: 3 wrong-answer shapes,
#          9 setpoint rejections, 2 command rejections). What each group buys:
#
#      * ATTRIBUTION (2) — a setpoint written to unit 2 of a three-device bus lands on unit 2 and NOWHERE
#        else, and a coil pulse addresses only its own coil, TRUE then FALSE. Asserted twice over: off each
#        slave's OWN data store, AND off the frames that reached the bus boundary — because a pulse ends with
#        the coil back at FALSE, which the data store cannot distinguish from "never touched".
#      * NO IMPLICIT RETRY (3) — exactly ONE request FRAME on the wire for a write and for a command, plus
#        the read path getting its own tolerance back afterwards. 🔴 NON-VACUOUS BY CONSTRUCTION: the map
#        declares `retries: 5`, i.e. the test supplies the number that must NOT be used, and the assertions
#        are on the frame count at the boundary and on ModbusBus.LastTransactionRetries — neither of which
#        this test provides. D-2's equivalent read test passed while the driver hardcoded a different count
#        precisely because it supplied the value it checked. MEASURED for a WRITE specifically against NModbus
#        3.0.83 (D-2 had only measured it for a read): 1 request frame at Retries=0, 2 at 1, 4 at 3 — i.e.
#        retries+1, from which 5 gives 6. The 6 is derived; the other three are on the probe's own output.
#      * INDETERMINATE (1) — produced by a GENUINE timeout (elapsed >= the bound), with four separate
#        content assertions on Detail (what happened, that it is unknown, WHICH unit, that nothing was
#        resent) plus a DoesNotContain on the generic backstop string. Đợt B shipped two defects in which a
#        NullReferenceException replaced an authored Indeterminate message with a generic one, and both were
#        invisible to a "Detail is not null" check.
#      * NO STALE FRAME CAN ACKNOWLEDGE A WRITE (4) — three hand-crafted responses that differ from the true
#        echo in exactly one field (wrong register, wrong value, a stale FC03 read response) are each refused,
#        plus the correct-echo CONTROL without which all three would pass on a driver that can never report
#        Applied at all. Driven through the new RawRtuResponder, because a real NModbus slave always answers
#        correctly and this question needs an answer that is wrong on purpose. In effect a contract test on
#        NModbus's echo validation, which D-5 measured and which is STRICTLY STRONGER than a read's: a write
#        response is an echo checked on slave address, function code, start address AND value.
#      * THE BUS AFTER A FAILED WRITE (2) — a write times out on machine A, its echo arrives LATE on the
#        shared line, and machine B's next read still returns B's own value; the quarantine is asserted
#        ENTERED and paid ONCE, with real bytes discarded, and LinkGeneration never moves. Plus: a bus that
#        will not go quiet REFUSES the write and reports Failed, with ZERO frames on the line — the one place
#        this driver reports a definite "no" that is not a device rejection, decided on WriteOutcome.Failed's
#        own words ("the device OR THE TRANSPORT TALKING TO IT was reached and explicitly reported failure").
#      * CANCELLATION AND WHAT AN OPERATOR WAITS (4) — an in-flight write cancelled in ~209 ms against a
#        30 000 ms bound, with the link NOT rebuilt and a second machine still reading (the mechanism
#        assertions; the clock is not the claim); a write queued behind a dead device's 700 ms hold served
#        after ~1.7 s; and the same write cancelled after 150 ms returning in ~151 ms with NOT ONE FC06 frame
#        on a line that was busy throughout. Those three are the evidence behind task-5-report.md §7's
#        decision NOT to build the per-device backoff. The fourth pins the branch for a cancellation observed
#        AFTER the bus was taken but BEFORE the request was written — reachable only in a race, so a mutation
#        could never find a defect in it (the reachability gap D-1's review found by READING); made
#        deterministic by cancelling from inside the bus's own openLink delegate, which ModbusBus invokes with
#        the arbitration lock already held.
#      * B-3's LIMITS THROUGH THIS ENTRY POINT (12) — nine setpoint rejections (unknown point, read-only
#        point, over, under, NaN, +Infinity, bool, string, null) and three command ones (unknown, arguments
#        supplied, no declared coil address), each asserting the shared bus saw ZERO bytes. "No frame ever
#        left the master" is what B-1 requires; "the register still holds its old value" also passes for a
#        write the device refused. One row per rejection because a mutation deleting one guard survives a
#        test that exercises another.
#      * THE REST OF THE SURFACE (7) — WritablePoints/Commands immutable and not castable back to a List;
#        a write after disposal; a write serialised against this driver's own running poll; a device-rejected
#        write and a device-rejected pulse assert (Failed, naming the Modbus exception code); a pulse whose
#        RESET never completes (Indeterminate, naming the coil and that it may be latched); and both halves
#        of a pulse sharing ONE transaction so no other machine can run between them with a coil latched high.
#
# 🔴 NO OTHER TOTAL IN THIS SUITE MOVES, and that is the check rather than a coincidence. D-5 also does two
# behaviour-preserving extractions, both of which add NO test and both of which are proved by a total that
# does not move:
#   * src/…/Modbus/ModbusWritePreflight.cs (new) takes five `private static` members VERBATIM off
#     ModbusTcpDriver (point/command lookup, the object?->double narrowing, and the hand-written six-entry
#     Modbus-exception-code table) so the RTU driver reuses them instead of holding a second copy that can
#     drift silently. ModbusTcpDriverWriteTests is what proves it behaviour-preserving.
#   * tests/…/Modbus/RawRtuResponder.cs (new) carries RtuFrames.WithCrc, which ModbusBusResynchronisationTests'
#     own private AppendCrc now delegates to. That suite stays at 9.
# ModbusBusTransaction gains an ADDITIVE Task-returning ExecuteAsync overload that delegates to the existing
# generic one (NModbus's write calls return Task, not Task<T>), so the quarantine accounting D-4 and D-6 sit
# on is literally the same code for a write as for a read.
#
# EXPECT_ABSTRACTIONS, EXPECT_CONFORMANCE, EXPECT_EDGESERVICE and EXPECT_ENGINEAPI are deliberately unchanged:
# D-5 adds no code outside src/St4i.EdgeCore/Drivers/Modbus and tests/St4i.EdgeCore.Tests, so a moved total
# anywhere else would mean this task reached somewhere it had no business reaching. EXPECT_CONFORMANCE in
# particular stays 22 — RTU conformance wiring is D-6, and no operator can turn the RTU write path on at all
# until D-7 builds the connector factory, the policy gate and the RBAC route.
#
# 🔴 D-5's REVIEW FIX ROUND raises this 896 -> 905 (+9), counted from the runner
# (`dotnet test --list-tests`: 889 -> 898). Two files; none is a rewrite, a split or a deletion. The expected
# total is the ONLY executable line this task has changed in this script, per the standing rule the D-5 review
# settled: totals may move with a per-file justification in this block; nothing else in this file may change.
#
#   + 5  ModbusRtuDriverWriteTests (35 -> 40) — 🔴 THE CRITICAL. The review applied FIVE mutations to
#        InvokeCommandAsync SIMULTANEOUSLY (bus refusal -> Indeterminate, assert-half Detail -> the generic
#        backstop string, queued cancellation -> Failed, in-flight cancellation Detail -> generic,
#        bus-disposed -> Failed) and the whole suite reported `Passed! - Failed: 0, Passed: 896`; a sixth
#        mutant in the same tree killed 1, so the pipeline was live. Every content assertion D-5 shipped was
#        on the setpoint path or the pulse's RESET half, so the member that answers "did a machine cycle
#        start?" asserted its outcome and nothing else. The four branches now have command-path equivalents
#        of the setpoint tests (assert-half timeout with nine content assertions plus a DoesNotContain on the
#        backstop string; in-flight cancel with LinkGeneration and a second machine still reading; queued
#        cancel proven at the bus boundary with ZERO FC05 frames; bus refusal reporting Failed), and the
#        fifth covers a branch that turned out to be unguarded on BOTH members: a bus disposed out from under
#        a live driver. That last one is distinct from AWriteOrCommandAfterDisposal_..., which covers the
#        DRIVER's own flag.
#   + 1  ModbusRtuDriverWriteTests — review I-1. ModbusBusResynchronisationException is raised from exactly
#        two places and the driver hard-coded the reason of ONE of them, so a failed drain (live and
#        intentional: GatewayTcpBusLink lets an IOException escape on the strength of the bus's catch
#        "saying so") told an operator to go hunting a babbling device. Both refusal causes are now driven
#        through one parameterised link decorator in ONE test, because "distinguishable" is a claim about a
#        pair: the Assert.NotEqual is the discriminating assertion and the two Contains stop it passing on
#        any two strings that merely differ.
#   + 3  ModbusTcpDriverWriteTests (13 -> 16) — review m-2. A [Theory] with one row per non-numeric setpoint
#        shape (bool, string, null). Found by a D-5 mutation, not by reading: mutating the SHARED
#        ModbusWritePreflight.TryToEngineeringValue to accept a bool killed a test in the RTU suite and NONE
#        here, because this file had 13 tests and zero [InlineData] and had never passed a non-numeric value
#        since B-4. The behaviour was guarded (through the shared method, by the RTU suite) — what these
#        retire is a future re-inlining silently unguarding TCP.
#
# NO OTHER TOTAL MOVES. The fix round also REMOVES two assertions that could not discriminate (review m-1 and
# m-5 — a frame-length count that is structurally always 0 because every RTU master request is 8 bytes, and an
# Assert.All over a collection that can hold only the single frame the line above already checked) and adds
# none in their place: each test's remaining assertions are the ones that carry it, so those two edits move no
# count.
#
# 🔴 TASK D-6 (conformance) raises this 905 -> 951 (+46), counted from the runner (`dotnet test --list-tests`:
# 898 -> 944 — the two agree here because none of the new tests is a [Theory]). Three new files; nothing is
# rewritten, split or deleted. The expected total is again the ONLY executable line this task changes in this
# script, per the standing rule.
#
#   +19  ModbusRtuDriverConformanceTests (new) — the shared DeviceDriverConformanceSuite against the real
#          ModbusRtuDriver on a bus it owns alone: the 17 Check_* wirings, the suite's own
#          EveryCheckIsWiredOrAcknowledged census (ZERO AcknowledgedGaps — every check runs), and one test
#          this transport needs that the other four drivers do not (below). Three device shapes, all in
#          St4i.EdgeCore.Tests because there is no portable virtual COM port: CreateDriver() rides a bus whose
#          LINK CANNOT BE OPENED (RTU's real fast failure — SerialPortBusLink.OpenAsync throws on an absent
#          port with no handshake to wait out; a silent line could only produce a timeout, which is not fast),
#          CreateUnresponsiveDeviceAsync/CreateUnresponsiveWritableDeviceAsync ride D-2's paired in-memory link
#          with D-5's RawRtuResponder answering nothing, and CollectReadingsAsync drives a REAL in-process
#          NModbus RTU slave network.
#   +21  ModbusRtuMultidropConformanceTests (new) — the SAME 19 (inherited from a shared abstract base, so the
#          wirings exist once and run twice) with the device under test sharing a live, continuously polled
#          line with another machine, plus 2 claims only this shape can make. D-4 shipped N devices on one bus
#          and no conformance check had ever run against it. Worth its runtime, measured: the mutation that
#          reduces ModbusRtuDriver.Id to the BUS alone (the TCP driver's endpoint-only shape) is KILLED here
#          and INVISIBLE to every one of the 19 single-device checks.
#   + 6  ModbusRtuConformanceRigTests (new) — the harness's own teeth, per the brief's rule that a loopback
#          peer which always behaves makes several checks vacuous. The no-device target is proved genuinely
#          ASKED and to fail an order of magnitude inside its own read timeout; the silent peer is proved to
#          RECEIVE every request and answer none (otherwise Indeterminate could be passing because nothing was
#          transmitted); the attempt counter the no-retry check reads is proved able to report TWO; the rig's
#          map is proved to declare a retry count the bus then records as 0; the readings rig is a control PAIR
#          (readings when the slave answers, none when it is silenced); and the last one pins the RTU form of
#          the ClosedLoopbackPort defect — releasing the last lease disposes the bus AND its link, which is why
#          every rig holds a keep-alive lease.
#
# ModbusRtuDriverWriteTests's own count is UNCHANGED (the +46 above is exactly the three new files, counted
# from the runner and reconciling to the suite total with nothing left over), and that is the check rather
# than a coincidence: D-6 MOVES its
# private `WritableMap` into ModbusRtuLoopbackHarness.BuildWritableMap (with the point/coil/command names as
# named constants) so RTU has ONE writable map shape rather than two, and that suite's own tests are what prove
# the move behaviour-preserving. Same call D-5 made twice (ModbusWritePreflight, RtuFrames).
#
# EXPECT_ABSTRACTIONS, EXPECT_CONFORMANCE, EXPECT_EDGESERVICE and EXPECT_ENGINEAPI are deliberately unchanged.
# EXPECT_CONFORMANCE in particular stays 22: D-6 WIRES the shared suite, it does not change it — no Check_*
# method was added, removed or edited, so the suite's own negative controls still describe it exactly.
# EXPECT_ENGINEAPI staying 1190 is the evidence for the AmbiguousDriver claim: that guard lives in
# ConnectorRegistry/FleetHost, the conformance rig never constructs either, and D-4's
# ModbusMultidropRegistrationTests still prove the routing unchanged.
#
# 🔴 D-6's REVIEW FIX ROUND raises this 951 -> 952 (+1), counted from the runner (`--list-tests`: 944 -> 945).
# ONE file, one test; the Critical's own fix adds none.
#
#   + 1  ModbusRtuConformanceRigTests (6 -> 7) — review M-5. The MULTIDROP rig's "no device" target is a
#          SILENCED SLAVE, not the single-device rig's unopenable line (a shared link cannot be refused for one
#          device without making every device on the segment unreachable), and that substitution had no harness
#          control of its own. The new one asserts the three things that could each make it green for the wrong
#          reason: the silenced slave really RECEIVED the request and its reply really was dropped
#          (FramesSilenced > 0 — "the master timed out" and "the master never transmitted" are
#          indistinguishable from the master's side), the driver addressed at it yields zero readings, and its
#          BUS-MATE still reads its own value off the same line, which is what stops "no readings" also being
#          satisfied by a rig whose whole bus was broken.
#
# The CRITICAL's fix moves no total, and that is the check rather than a coincidence: it is a `base`-calling
# override of Check_Write_Cancellation_HonouredPromptly_EvenAgainstAnUnresponsiveDevice on the shared abstract
# base, raising ONLY that one check's target bound from 300 ms to the rig's existing 8 000 ms so that an
# ordinary timeout can no longer satisfy a cancellation check. No shared-suite change, EXPECT_CONFORMANCE
# unmoved, four other drivers untouched, no test added or removed. Proven by re-running the mutation that
# neuters ModbusBusTransaction's AbortPendingRead registration: it used to kill 2 tests and now kills 4 — the
# two write-side cancellation checks join the two read-side ones. Passing cost: 231 ms / 223 ms against the
# 8 000 ms bound.
#
# The other fixes are documentation corrections on records that were WRONG rather than merely thin (a false
# impossibility proof, an untested keep-alive claim, an arithmetically wrong retries rationale, an imprecise
# "every write check" and an over-general "no fast per-device failure"), plus blueprint §10 item 4 answered on
# IModbusBusLink.DrainBufferedInput where D-7 will stand. Comment-only in src/; none moves a count.
#
# 🔴 TASK D-7a (backend: configuration, lifecycle, and a path an operator can reach) raises this 952 -> 1009
# (+57). Three new files; nothing is rewritten, split or deleted. Both moved EXPECT_* constants are again the
# ONLY executable lines this task changes in this script, per the standing rule.
#
#   +22  ModbusRtuBusSettingsTests (new) — the schema half of "connectors.json can declare a multidrop RTU
#          bus". 6 facts + two [Theory] blocks (10 rows + 6). The two that carry it: the COMPATIBILITY rule
#          (10 rows of documents that must NOT be read as RTU, including three that do not parse at all —
#          DeclaresATransport must answer false rather than throw, or a malformed map would be reported twice
#          by two different paths), and the SERIAL refusal, which asserts the reason and the alternative AND
#          asserts the message does NOT read as "unknown transport" — the wording an operator would act on by
#          assuming they had a typo.
#   +15  ModbusMultidropMapTests (25 -> 40) — D-4 review m5 and blueprint §10 item 2. A [Theory] of 12 rows
#          pins the derived-id namespace at its boundaries (":unit" with no digits, "unit1a", ":unit1" with no
#          bus half); one fact proves a bus named like a device position is REFUSED, which is what makes the
#          namespace disjoint and is what the ghost sweep depends on; one computes the bus-wide write bound on
#          a bus whose devices differ by 20x so "the first" or "its own" is red rather than merely different;
#          and one finally pins the LITERAL "{bus}:unit{n}" (D-4 review m1 — every existing assertion goes
#          through the generator, which cannot see a change to the format).
#   +10  ModbusRtuReadBackoffTests (new) — the backoff arithmetic. The load-bearing ones are about
#          RELATIONSHIPS, not an input/output table: that the base is the HOLD and not the poll interval
#          (asserted against a second device whose hold is small, so a constant floor would fail), that the
#          multiplier really drives the growth (a 1.5x instance, whose answers this test does not also supply
#          as inputs), and that 60 consecutive failures cannot overflow into a NEGATIVE delay — which would
#          make a dead device poll in a tight loop, i.e. the opposite of the mechanism, produced by it.
#   + 6  ModbusRtuConnectorFactoryTests (new) — the first thing in src/ that builds an RTU driver from
#          configuration. THE LEASE LEAK is here twice: once as "an unbuildable device takes no lease at all"
#          (validate before Acquire), and once as the discriminating version — a driver-constructor throw AFTER
#          the lease is owned, observed through the OPENER being invoked a SECOND time. A lease count cannot
#          discriminate: had it leaked, a later Acquire would silently ride the leaked bus and every read would
#          still work, which is the leak's whole signature. Also pins that the factory turns the read backoff
#          ON where a directly-constructed driver leaves it off, asserted through the two drivers' own
#          failed-poll messages on one bus in one test.
#   + 3  ModbusRtuDriverWriteTests (40 -> 43) — blueprint §10 items 1, 2 and 3. The budget test passes
#          CancellationToken.None deliberately — literally the unbounded token §10 item 1 forbids — so only the
#          driver's own bound can end the call, and asserts the Detail does NOT say "cancelled" (nobody
#          cancelled anything). Its control is a driver with NO budget, which still waits the hold out and
#          applies; without that pair the first would pass against an implementation that bounded every write
#          at a constant. The third pins that an Applied COMMAND now carries the acknowledgement-not-observation
#          sentence, with the pulse having genuinely worked.
#   + 1  ModbusMultidropBusTests (11 -> 12) — the read backoff measured on D-4's OWN harness, before and after,
#          in one process. Measured: 2.0 reads/s with the backoff off, 60.0 with it on — a 30x recovery, against
#          an asserted 3x. D-4's own dead-device tax test is unchanged (82x collapse on this machine) and now
#          passes ModbusRtuReadBackoff.Disabled EXPLICITLY, so a future flip of the driver's default cannot
#          silently turn that baseline into a measurement of something else.
#
# 🔴 AND ONE DEFECT THIS MOVE PAID FOR, recorded because it is the reason the measurement exists: the failure
# counter was incremented inside the ARGUMENT of `_logError?.Invoke(ex, DescribeFailedPoll())`, and `?.`
# short-circuits its arguments — so for every driver constructed without a log callback the counter never moved
# and the backoff never engaged. Every unit test of the arithmetic passed. Only the end-to-end number could see
# it, and it reported a 1.0x "improvement".
#
# 🔴 D-7a's REVIEW FIX ROUND raises this 1009 -> 1012 (+3). One file; nothing rewritten, split or deleted. It
# is again the ONLY executable line this task has changed in this script, and it is the ONLY total that moves —
# the round touches src/St4i.EdgeCore and its tests plus doc comments in EngineApi, so a moved total anywhere
# else would mean the fix round reached somewhere it had no business reaching.
#
#   + 3  ModbusRtuConnectorFactoryTests (6 -> 9)
#        + 1  review I-2 — 🔴 THE ONE THAT MATTERS. D-7a's report claimed no test could distinguish
#             "validate before Acquire" from "release on constructor failure", and that claim was FALSE: the
#             reviewer built the counterexample. The observation is at the public seam, not on the lease —
#             a device that cannot produce a driver must be refused BY ITS OWN MAP'S ERROR and must never
#             touch the bus registry. A disposed registry plus a unitId:0 map discriminates, and it still
#             discriminates after I-1's fix (the error becomes "Cannot access a disposed object" instead of
#             the device's own configuration error), which is why it guards something outliving this round.
#             M5 was SURVIVED across 20 runs in the original batch; it is KILLED by this test.
#        + 1  review M-1 — a backed-off device whose WorstCaseBusHoldMs is at or below its poll interval told
#             its operator "no read backoff is configured for this driver", because the message branched on
#             the COMPUTED DELAY rather than on the configuration. Ordinary, not exotic: 1 register, default
#             retries, readTimeoutMs 100, pollIntervalMs 1000 -> a 200 ms hold. D-5's I-1 class for the third
#             time in this batch, landed on the exact message pair the report offers as the operator's way to
#             tell backed-off from quiet.
#        + 1  the SWEEP of M-1's rule rather than the instance: the RECOVERY notice had the same defect one
#             method away, claiming "its read backoff is cleared" for a driver that never had one. Driven as a
#             Default/Disabled PAIR on one bus, because "true of only one of two producing paths" is exactly
#             what a single-path test cannot see. Both messages now branch on ModbusRtuReadBackoff.IsEnabled.
#
# Review M-6 STRENGTHENS an existing assertion without adding a test: UnitZero_IsNotRefusedHere_... now proves
# "still legal for TCP" through ModbusConnectorFactory itself rather than at the parse layer, so the pair is
# RTU-refuses / TCP-accepts at the SAME boundary. Same test, more teeth, no count change.
#
# 🔴 TASK D-7c (direct RS-485: a COM port declarable in connectors.json, on all three hosts) raises this
# 1012 -> 1053 (+41). One new file; nothing is rewritten, split or deleted. EXPECT_ENGINEAPI moves too (+7)
# because the transport SWITCH lives in the composition root and can only be driven there — see its own note
# below. EXPECT_ABSTRACTIONS, EXPECT_CONFORMANCE and EXPECT_EDGESERVICE are deliberately unchanged: D-7c adds
# no driver, no conformance check and nothing St4i.EdgeService executes, so a moved total in any of those
# would mean this task reached somewhere it had no business reaching. EXPECT_CONFORMANCE in particular stays
# 22 — the serial transport sits on the SAME IModbusBusLink seam D-2 built, so the RTU conformance rig is
# untouched.
#
#   +27  ModbusRtuSerialBusSettingsTests (new) — the SERIAL half of the connectors.json schema, which cannot
#          live beside the gateway half: ModbusRtuBusSettings is in St4i.EdgeCore and SerialLineSettings is in
#          St4i.EdgeCore.Serial, which references it, so a third arm in that parser would be a CIRCULAR
#          reference. 8 facts/theories (1 + 6 + 14 + 2 + 1 + 1 + 1 + 1 rows). The three that carry it:
#          (a) the LITERAL bus key "modbus-rtu-serial:COM7:19200:8:E:1" from a document naming only its port —
#              a literal because comparing against CreateBusKey(new SerialLineSettings("COM7")) would pass for
#              a parser that read no defaults at all, both sides coming from the same constructor. It is red
#              for SerialPort's own 9600-8-N-1 defaults, for any dropped line parameter, and for an
#              un-normalised port name, all at once;
#          (b) a port ABSENT from this machine parses cleanly and fails only when OPENED — the decision the
#              brief asks for, asserted rather than argued (a config file is written for a SITE; an unplugged
#              USB adapter must recover without a restart; TryCreate performs no I/O);
#          (c) the same document fanned out by ModbusMultidropMap yields N devices whose stored MapJson
#              contains NO port name — which is what makes D-7a's projection decision (host/SummaryColumns,
#              never map_json) structurally true rather than filtered, with a positive control so the three
#              DoesNotContain assertions are not satisfied by an empty string.
#   +12  ModbusRtuBusSettingsTests (22 -> 34) — the gateway half, where the schema-level members live.
#          +11  ReadTransport (new member) as an 11-row [Theory]: the routing peek the composition root
#               switches on. It answers with the operator's OWN SPELLING (never normalised — the
#               unknown-transport message has to quote what they wrote) and never throws for a document too
#               malformed to read, which is what keeps a bad map reported by ONE path instead of two.
#          + 1  'portName' refused on a gateway bus. The SWEEP half of the rule ModbusRtuSerialBusSettings
#               applies to 'host'/'port' on a serial bus: a well-formed key that is silently IGNORED makes the
#               file on disk and the configuration actually running two different things. Both directions ship
#               in one commit, because fixing one is the "an instance, not the class" failure §8.1 records.
#          + 0  TheSerialTransport_IsRefusedWithTheReasonAndTheAlternative_… RENAMED and re-pointed to
#               …_IsNoLongerRefusedAsUnavailable_ButAsTheWrongParser. D-7a's message said the serial transport
#               "is not available in this build"; that became FALSE with the ProjectReference, and it was
#               actionable-false — an operator who believed it would buy and cable a gateway they do not need.
#               The test now asserts against that sentence by content.
#   + 2  SerialPortBusLinkTests (+2, and one existing test strengthened) — 🔴 THE DEFECT D-3 RECORDED AND DID
#          NOT FIX. Its open-failure wrapper appended ONE sentence naming all three causes at once ("may not be
#          present …, may be held by another application, or the name may not be a serial port"), which is true
#          of exactly one producing path at a time and sends a reader to three different places. D-5's I-1
#          class, the fourth sighting in this batch. DescribeOpenFailure now branches on the BCL exception the
#          open actually threw, and the assertions are a MATRIX (each arm carries its own diagnosis AND not the
#          other two) — three positive "contains" checks would all have passed on the old shotgun message.
#          Driven from synthesised exceptions because reaching the HELD arm needs a real port plus a second
#          holder; the existing absent-port test is what proves the function is the one OpenAsync calls.
#   + 0  SerialDependencyScopingTests (7 -> 7) — the three deployment assertions INVERTED into positive ones
#          (the owner's ruling of 2026-08-03: direct RS-485 in all three hosts), NOT deleted, because a deleted
#          assertion lets the capability vanish in a later "remove the unused reference" refactor. The FOURTH,
#          TheRtuFramingLayersOwnAssembly_ReferencesNeitherSystemIoPorts_NorTheSerialAssembly, is UNTOUCHED and
#          still green — it is what forces D-7c's design, since the circular-reference-free alternative would
#          have required inverting it.
#
# 🔴 D-7c's REVIEW FIX ROUND raises this 1053 -> 1071 (+18). It is the ONLY total that moves — EXPECT_ENGINEAPI
# stays 1226 because the round's EngineApi edits are doc comments (review M-1's pair obligation, and the I-3
# correction on the lease test's own remarks). No test is rewritten, split or deleted.
#
#   + 1  SerialPortBusLinkTests — 🔴 review I-3, and the finding is that D-7c's report said this could not be
#          done. OneOpenForNLeases_ObservedThroughTheSerialLink_AndTheLastReleaseClosesThePort OBSERVES what
#          the EngineApi test derives: the opener mints one handle per call so the openings are COUNTED (1 for
#          3 leases), ModbusBus.LinkGeneration is pinned at 1, and the PORT's own IsOpen is asserted after each
#          release — open, open, CLOSED. The shipped test asserted LeaseCount, correctly rejected it for the
#          final check, and substituted HasBus: the same witness one field over, both being the registry's own
#          bookkeeping, while the thing protected is a COM port not held to process exit. Everything it needs
#          already existed for exactly this reason — AdoptHandle is internal behind D-3's InternalsVisibleTo
#          and FakeSerialPortHandle.Unpaired is D-6's. No hardware, no virtual COM pair, no conditional skip.
#   + 8  ModbusRtuSerialBusSettingsTests — 🔴 review I-2, the THIRD direction of the sweep. A devices[] element
#          carrying a BUS-level key was accepted, did nothing, and was copied VERBATIM into that device's
#          MapJson, which falsified D-7c report section 6's structural guarantee for any malformed document.
#          ModbusMultidropMap now refuses BusLevelKeys inside an element, mirroring the DeviceLevelKeys check
#          at the root it already had. The [Theory]'s 8 rows are the two parsers' own const fields, which makes
#          it the DRIFT GUARD for a list that cannot be shared: half those keys are declared in
#          St4i.EdgeCore.Serial, which St4i.EdgeCore may never reference, so BusLevelKeys must hold literals.
#   + 1  ModbusRtuSerialBusSettingsTests — the same leak in its PUREST shape, found while fixing I-2 and not
#          named by the review: FanOut's DEGENERATE branch makes the root simultaneously the bus and its only
#          device, so {"transport":"rtu-serial","portName":"COM3","machineCode":"M1",…} stored the port path
#          inside the device's configuration with nothing malformed anywhere. Now refused, with a control
#          proving an ordinary legacy single-device map still fans out under its own instance id unchanged.
#   + 5  ModbusRtuSerialBusSettingsTests — 🔴 review M-2 (4 [Theory] rows + 1 fact). A misspelled key of the
#          operator's OWN transport was silently ignored: {"portName":"COM31","baudrate":9600,"Parity":"none"}
#          parsed to 19200-8-E-1 — TryGetProperty is case-sensitive — so the operator asked for 9600-8-N-1 and
#          got a line whose parity mismatch has no symptom but a device that never answers. The near-miss
#          ("Did you mean 'baudRate'?") is asserted, not merely the refusal.
#   + 3  ModbusRtuBusSettingsTests — M-2 swept to the GATEWAY parser (2 rows) rather than matched, per the
#          coordinator's ruling, through ONE shared implementation with a per-transport key list so the two
#          cannot diverge; plus 1 fact pinning that the unknown-key refusal runs LAST and never pre-empts a
#          more specific one ('portName' on a gateway bus must still be answered by the cross-transport rule).
# 🔴 THE CARRIED-FINDINGS REVIEW FIX ROUND raises this 1071 -> 1072 (+1), counted from the runner. ONE test,
# and it guards a FINDING rather than a behaviour — which is why it is here and not deferred with the finding.
#
#     + 1  ModbusTcpDriverConformanceTests.ThisRigsPollIntervalIsWhatKeepsTheCarriedDisposeFindingReproducible
#          A carried finding says Check_DisposeAsync_IsIdempotent_AfterCancellation passes on the Modbus TCP
#          rig because of its TOKEN, not because DisposeAsync ends the read loop: mutating the shared check so
#          the cancellation is never issued leaves five rigs green (correctly — Dispose is the mechanism that
#          check enforces, cancellation is only scene-setting) and fails that one at ~5.25 s.
#
#          🔴 The MECHANISM is a boundary condition, and the first write-up of it was WRONG in a way that
#          would have sent the next round hunting a disposed semaphore. It is NOT HotFolderAoiDriver's scar —
#          nothing is stranded permanently. DisposeAsync tears the connection down and the read loop observes
#          its flag at the top of the NEXT iteration, having parked in Task.Delay(PollIntervalMs). The whole
#          question is whether that one tick fits inside CancellationBudget — and
#          ModbusLoopbackHarness.BuildWritableMap's default pollIntervalMs (5 000 ms) is EXACTLY EQUAL to
#          CancellationBudget (5 000 ms), from two unrelated files, while the RTU rigs pass 50.
#
#          So: lower that harness default and the TCP rig silently becomes a sixth rig on which the mutation
#          survives, the carried finding stops being reproducible, and NOT ONE TEST GOES RED. That is the
#          "nothing detects deletion of the override" lesson in different clothes, so it gets the same
#          treatment — an assertion rather than a sentence in a report. Asserted as >= rather than == 5000
#          deliberately: the claim is the relationship, not either number.
# 🔴 Task E-3 (docs/plans/2026-08-04-dotE-fleet-core-extraction-blueprint.md §11) raises EXPECT_EDGECORE
# 1072 -> 1080 (+8) and EXPECT_EDGESERVICE 28 -> 45 (+17). Grand total 2556 -> 2581. Per file, and nothing
# is rewritten, split or deleted:
#
#   +8  tests/St4i.EdgeCore.Tests/Engine/EdgeAgentPipelinesTests.cs  (NEW FILE) — the N-driver lifecycle an
#       edge agent gets. The headline one measures at the TRANSPORT that N registered device instances
#       produce N drivers each pushing readings, not that N slots exist; the rest are fault isolation, a
#       refusing factory named in StartIssues, the all-faulted rethrow, orphan-driver disposal, driver
#       disposal at end of run, and the nothing-to-poll case that must not reach SimulatedDriver's ctor guard.
#
#   +7  tests/St4i.EdgeService.Tests/EdgeAgentWriteSurfaceTests.cs   (NEW FILE) — blueprint §3's read-only
#       limit as a STRUCTURAL fact. Runs from St4i.EdgeService.Tests, which has no InternalsVisibleTo from
#       St4i.EdgeCore, so "not exported" here means exactly what it means for the production host. Two of the
#       seven are positive controls (the assembly really is St4i.EdgeCore and really does export things; the
#       driver-shape walker really can see a driver — ConnectorRegistry.TryCreateDriver; MachineState really
#       is an exported mutable type), without which every absence assertion could pass vacuously.
#       🔴 E-3 REVIEW ROUND, +2 in this file. The review found the member census was EIGHT when the real
#       number is THIRTEEN plus one indirect, and that the two missing names were `Start` — the member that
#       builds every driver and opens every port — and `Stop`. One test now CHECKS the census against
#       FleetCore's real public surface (so the count is a measurement, not prose), and one closes the
#       fourteenth, indirect path by asserting nothing exported hands out a MachineState. Nothing was
#       unprotected before: the type-level assertion always guarded all fourteen.
#
#  +10  tests/St4i.EdgeService.Tests/EdgeWorkerConnectorsTests.cs    (NEW FILE) — the connectors.json read
#       path, and the task's most important regression: a deployment with no connectors.json (and one with a
#       malformed one) still runs exactly the simulated fleet it always did, with every commit coming from
#       EdgeWorker's own 8-machine roster. Also pins the two decisions E-4 inherits: entries key on their own
#       id here (not on kind, as in EngineApi), and OPC-UA/RTU entries are refused BY NAME rather than
#       dispatched — OPC-UA because dispatching it would make this host a new writer to the machine-wide
#       %ProgramData%\ST4I\sim\opcua-pki root, which E-3's brief forbids outright. The tenth is the seam
#       that joins the task's two halves: it asserts EdgeWorker actually hands the registry it built to the
#       agent it runs, which nothing else did — a mutation passing `connectors: null` there left every other
#       test in the task green.
#       🔴 E-3 REVIEW ROUND, +0 tests in this file but one assertion strengthened, recorded here because the
#       run got ~2 s slower and that is visible: the headline regression was a MEMBERSHIP check over ~3
#       observed commits, and the reviewer's R2 mutation (collapse all eight simulators onto machine #1)
#       SURVIVED 45/45 with seven of eight machines gone from the run. It is now a SET-EQUALITY check with
#       smoke raised to 60 so full coverage is reachable at all; R2 re-run against it dies in both regression
#       tests.
#
# EXPECT_ABSTRACTIONS, EXPECT_CONFORMANCE and EXPECT_ENGINEAPI are deliberately UNCHANGED, and that is the
# evidence for two of E-3's claims rather than a convenience. EXPECT_ENGINEAPI staying 1283 is what says the
# two things E-3 did to EngineApi's own tree — making FleetCore `internal`, and moving ConnectorsConfig down
# to St4i.EdgeCore.Config — changed no behaviour there: the first touched one word and no call site (FleetHost
# is the only file outside St4i.EdgeCore that names the type), the second is a namespace move carried by three
# added `using` lines. EXPECT_CONFORMANCE in particular stays 22: E-3 adds no driver and no connector kind.
#
# 🔴 Task E-5 (docs/plans/2026-08-04-dotE-fleet-core-extraction-blueprint.md §14) raises EXPECT_EDGECORE
# 1080 -> 1082 (+2) and EXPECT_EDGESERVICE 46 -> 49 (+3). Grand total 2589 -> 2594. Per file:
#
#   +2  tests/St4i.EdgeCore.Tests/Config/ModbusMultidropAgentTests.cs   (NEW FILE) — the second half of the
#       split E-3 set: "N instances run N drivers that actually reach the transport", for RTU. The headline
#       one drives ONE RS-485 bus document through the fan-out E-5 moved here, then through
#       EdgeAgentPipelines, over D-2's in-memory paired link (a real in-process NModbus slave network), and
#       asserts three separate claims — three instances keyed {bus}:unit{n}; each machine's readings carry
#       that DEVICE's own register value, read out of the canonical payload at the transport (attribution,
#       which is the thing a shared wire gets wrong); and the link was opened EXACTLY ONCE for three
#       drivers, counted at the opener rather than read off ModbusBusRegistry's own ledger (D-7c's rule:
#       read the thing being protected). The second is the D-7a witness: the ghost sweep runs with BOTH log
#       callbacks absent, which is the composition under which a mechanism computed inside a `?.` argument
#       list silently stops existing. E-5 is what made those callbacks nullable, so E-5 owns that witness.
#
#   +3  tests/St4i.EdgeService.Tests/EdgeWorkerConnectorsTests.cs — 10 -> 13. The RTU refusal test E-3
#       shipped (AnRtuBusEntry_IsRefusedByName_…) is REPLACED, not deleted and not left to go red: it pinned
#       a DECISION, and E-5 reverses that decision in the open, so its successor
#       (AnRtuBusEntry_FansOutIntoOneInstancePerDevice_EachClaimingItsOwnMachine) asserts the derived id SET
#       plus each device's machine claim — a set, because a fan-out registering N instances under one id, or
#       one instance for N machines, satisfies a count. That is +0. The three that move the number are: the
#       auto-DE hardware limit now being logged where the operator plugging the adapter in will meet it
#       (blueprint §9's limit is SILENT when violated, and this is the host on that machine); the
#       no-bus-registry arm, which is why Build's parameter is optional at all; and the SEAM — that
#       EdgeWorker hands a REAL ModbusBusRegistry to the dispatch, which nothing else asserts and whose
#       mutation (pass null) leaves every other test in this task green while every RS-485 bus in production
#       is silently skipped. That is E-3's own `connectors: null` finding, one layer down.
#
# EXPECT_ABSTRACTIONS, EXPECT_CONFORMANCE and EXPECT_ENGINEAPI are deliberately UNCHANGED, and EXPECT_ENGINEAPI
# staying 1290 is evidence rather than convenience: E-5 moves ModbusMultidropRegistration and ModbusRtuBusPlan
# OUT of St4i.EngineApi and moves RtuBusConfiguration.IsInBusNamespace to ModbusMultidropMap, and every test
# of all three stayed where it was and kept passing — the E-3 precedent (ConnectorsConfigTests stayed put when
# ConnectorsConfig moved down), and the same argument: a namespace move carried by added `using` lines plus,
# here, one ILogger->callback signature change at the call sites. A behavioural change in EngineApi would show
# up as a moved number. EXPECT_CONFORMANCE in particular stays 22: E-5 adds no driver and no connector kind —
# ModbusRtuDriver has shipped since D-5 and its conformance wiring since D-6.
# 🔴 TASK F-1 (.superpowers/sdd/per-host-roots/task-1-brief.md) raises EXPECT_EDGECORE 1082 -> 1088 (+6),
# COUNTED FROM THE RUNNER (`dotnet test --list-tests`), not by hand. Two NEW files; nothing is rewritten,
# split or deleted, and no existing test in this suite gains or loses a case.
#
#   +3  tests/St4i.EdgeCore.Tests/PerHostDataRootIsolationTests.cs (NEW FILE) — the load-bearing half of
#       F-1 Part 1: TWO HOSTS, TWO ROOTS, and neither observes the other's data. Not a ResolveRoot test: a
#       resolver can be correct while the store ignores it, which is the defect CredentialStoreTests' own
#       redirect test exists for.
#       🔴 WHAT CARRIES EACH ARM, ENUMERATED — fix round 2, review NEW-1. This block has stated a false
#       UNIVERSAL twice. Round 1 said "every assertion is an observation made through the store", which was
#       false of the WAL arm; its replacement said "no arm computes a file name or asserts on a path
#       string", which was false of the CREDENTIAL arm the same day. Ninth instance of that class in four
#       batches, third inside the correction written for it — so this is a list, and a third universal is
#       not the fix:
#         * credential arm — SUBJECT is CredentialStore.Load/ListMachineCodes after only an env var moved.
#           It ALSO corroborates on disk, and that half DOES compute <machineCode>.bin, under three roots
#           (host A, host B, CredentialStore.DefaultRoot()). The third is a negative control on the real
#           %ProgramData% root and earns its duplication of the naming rule; the first two sit on top of
#           the Load assertions rather than carrying them.
#         * settings arm — SUBJECT is FleetSettingsStore.Load per instance. Its one path assertion is a
#           PRECONDITION on two roots this test chose, and can fail only if CreateTempSubdirectory
#           returned the same path twice.
#         * WAL arm — SUBJECT is a glob over each root after a real offline SendAsync. Computes no file
#           name and asserts on no path. It does encode ONE detail the SDK chooses — that a queue file ends
#           in .jsonl — as the pattern it enumerates with, which is the smallest coupling that keeps the
#           observation "what appeared under this root" rather than "what appeared at this path".
#       Anyone editing this block who reaches for "every arm" or "no arm" should enumerate the three
#       against the claim instead.
#         + 1  CredentialStore, the static one whose only seam is the env var, driven with ONE machine code
#              on both sides deliberately: two codes would be separated by the FILENAME even inside one
#              shared directory, so such a test passes on a build where the redirect does nothing. Both
#              directions, because "B cannot read A" and "B did not overwrite A" are different failures.
#         + 1  FleetSettingsStore, via its explicit-directory seam and no env var at all — the store that
#              holds exactly one (ServerUrl, MachineCode, VerifyTls) triple, so sharing its root is a
#              last-writer-wins overwrite rather than a merge.
#         + 1  the WAL, which is the only machine-wide store St4i.EdgeService has ever WRITTEN (blueprint
#              §11.4) and therefore the collision a two-host deployment hits first. 🔴 FIX ROUND 1 (review
#              I-1) REWROTE THIS ARM AND THIS JUSTIFICATION WITH IT. The first version resolved the queue
#              path itself and wrote it with File.WriteAllText, which made it a fact about Path.Combine —
#              WalOptions.ResolveQueueFile documents itself as a pure function of (Directory, machineCode) —
#              so the "through the store" sentence above was FALSE of one of the three arms it justified,
#              in the one place the binding constraint requires a per-file justification to be accurate.
#              The arm now drives a real TransportCoordinator (whose RebuildLive is what calls EnsureDir()
#              and ResolveQueueFile and hands the result to LiveTransport.ForMachine) and a real offline
#              SendAsync, so the bytes are appended by the vendored SDK's own Enqueue. No socket: the
#              injected CapturingHandler throws HttpRequestException, the same technique and the same reason
#              as TransportCoordinatorWalTests. Its CONTROL arm is a third send from host A's OWN root with
#              the SAME machine code, which lands in host A's existing file — one file, two backlogs — so
#              "the two roots stayed separate" is distinguished from "the WAL wrote nowhere at all".
#              Costs ~22 s (three real retry-exhaustions at the SDK's fixed maxRetries/backoff); that is the
#              price of the arm being about this product rather than about Path.Combine.
#       🔴 MUTATION, and it is the one that discriminates: memoise CredentialStore.CredsDir() into a static
#       field (`_cache ??= ResolveRoot()`) — a first-resolution-wins shape nobody would flag on review. The
#       new credential test is KILLED deterministically; the pre-existing redirect test's verdict is
#       ORDER-DEPENDENT, because it only ever resolves one root. All five verbs of mutate-guard.sh, clean
#       first, with a positive control reported KILLED in the same session.
#
#   +3  tests/St4i.EdgeCore.Tests/Drivers/Modbus/RtuSegmentOwnershipTests.cs (NEW FILE) — F-1 Part 2: the
#       one-host-per-segment DEPLOYMENT CONSTRAINT, stated on BOTH transports and stated as a constraint
#       rather than a guarantee. The two transports are asserted in one file on purpose: the claim is a
#       PAIR (each transport carries the rule exactly once, where its operator can meet it), and E-5 is the
#       evidence that two tests each looking at one half do not establish it — E-5 rewrote the serial
#       message and left the gateway with nothing, invisibly.
#         + 1  the plan's two arms together: a gateway plan carries SegmentOwnershipNotice and no
#              LimitNotice; a serial plan carries LimitNotice and no SegmentOwnershipNotice. Either arm
#              alone passes on a build that put the same string on both — the specific mistake available
#              here, since the RULE is true of both transports and only its DELIVERY differs.
#         + 1  the wording, because the wording IS the deliverable: names the segment, says NOTHING
#              enforces it, says CONSTRAINT-not-guarantee, and keeps the write consequence labelled
#              NOBODY HAS MEASURED. The DoesNotContain arms ("prevents", "blocks") are the discriminating
#              ones — a notice that reads as a promise stops the operator checking the other host's
#              connectors.json, which is the only thing that settles it.
#         + 1  the serial half: DescribeOpenFailure's held arm now attributes the refusal to the OPERATING
#              SYSTEM and points at the gateway, so the two halves of the rule cannot be learned
#              separately. E-5's own assertions ("already held", "THE OTHER ST4I HOST") are re-asserted
#              here so this task cannot be read as having weakened them.
#
# No behaviour in this assembly changed. ModbusRtuBusPlan gains a seventh positional member and
# ModbusRtuBusSettings gains one pure string method; every pre-existing RTU test passes unchanged, which is
# the check that the record change is additive rather than a rewrite. CredentialStoreTests gains a
# [Collection] attribute (it and PerHostDataRootIsolationTests both flip the PROCESS-WIDE ST4I_CREDS_DIR, and
# two classes doing that in parallel is a real race) — an attribute moves no count, and a moved count there
# would mean the attribute did more than serialize.
#
# 🔴 TASK H-1c raises this 1088 -> 1093 (+5), counted from the runner. ONE new file,
# MachineConfigStoreRootResolutionTests.cs; no existing file rewritten or deleted.
#   ResolveRoot_NoOverrideAtAll_ReturnsDefaultRoot                          +1
#   ResolveRoot_EnvOverride_ReturnsConfiguredDirectory                      +1
#   ResolveRoot_ExplicitDirectory_TakesPriorityOverEnvVar                   +1
#       The three arms of the explicit > env > default order F-1 established, on the seam H-1c added to
#       MachineConfigStore. Same three FleetSettingsStoreTests already carries for its own store, because
#       the contract is meant to be one idiom rather than one dialect per store.
#   DefaultRoot_IsBesideTheBinary_AndIsNotUnderProgramData                  +1
#       🔴 THE POPULATION MARKER. H-1c added a seam and deliberately did NOT move the default: moving it
#       relocates live customer data on the next start with nothing migrating it. This asserts the property
#       (default is AppContext.BaseDirectory, and is NOT under %ProgramData%\ST4I) rather than a literal
#       path, and its failure message is the checklist a genuine move would owe — a directory constant, a
#       derivable variable name, a README §15.9 row, a remove-data.ps1 parameter and the count in every
#       artefact that spells it.
#   TheEnvVar_IsHonouredAllTheWayToTheFile_NotJustAtResolution              +1
#       The arm PerHostDataRootsTests says in as many words that it CANNOT reach: it proves a variable is
#       declared and read at a resolution site, never that the resolved value is honoured to a file.
#       Constructs the store with NO explicit directory (the production shape — Program.cs registers a bare
#       singleton), writes through a real Ensure, and reads the JSON back off the env-var directory.
#
# The class joins the existing "St4i.EdgeCore.Tests.MachineWideStoreEnv" collection because it mutates a
# PROCESS-WIDE variable. That collection's NAME says machine-wide and this store is not — recorded in the
# class comment rather than renamed, since renaming touches three unrelated classes to no measured end.
# 🔴 Task K-1 raises this 1093 -> 1094 (+1): the one linked hygiene [Fact] every suite gets. Full
# justification beside EXPECT_ABSTRACTIONS at the top of this file.
#
# 🔴 TASK V-1 (.superpowers/sdd/one-unreadable-posture/task-1-brief.md) raises EXPECT_EDGECORE 1106 -> 1118
# (+12) and EXPECT_ENGINEAPI 1364 -> 1368 (+4). Grand total 2704 -> 2720. ONE existing file gains all
# twelve here; nothing is rewritten, split or deleted.
#
#   tests/St4i.EdgeCore.Tests/Historian/OeeSettingsStoreTests.cs                              +12
#       The three-outcome read V-1 gave OeeSettingsStore, built to FleetSettingsStoreTests' own shape.
#       Absent / Loaded / an empty JSON array that must stay Loaded (an operator who cleared the table),
#       then the Unreadable POPULATION member by member — malformed, empty, literal `null` (the one shape
#       that throws nothing), and a FileShare.None handle that is released again to prove the read is not
#       simply answering Unreadable to everything. Then the refusal: Set over an unreadable file throws
#       and the bytes are equal to what was written; the range guardrail still fires FIRST; Resolve keeps
#       answering the documented defaults, which is what makes the refusal a report rather than an outage;
#       the logError callback fires exactly once and a clean store fires none; and Reload after a repair
#       clears the refusal, so "refuses while broken" is distinguishable from "refuses forever".
#
# EXPECT_ABSTRACTIONS, EXPECT_CONFORMANCE and EXPECT_EDGESERVICE are deliberately UNCHANGED. V-1 touches
# four src files (OeeSettingsStore.cs, ProductConfigStore.cs, HistorianEndpoints.cs, Program.cs) and three
# test files; a movement in any of the other three totals would mean it reached somewhere it had no
# business reaching. EXPECT_CONFORMANCE in particular stays 23: V-1 adds no driver and no connector kind.
#
# 🔴 V-1 FIX ROUND 1 (review I-3) raises EXPECT_EDGECORE 1118 -> 1121 (+3) and EXPECT_ENGINEAPI 1368 -> 1369
# (+1). Grand total 2720 -> 2724. This is the one part of the fix round that is not documentation, and the
# reason it is not: V-1 round 1 gated the refusal on a classification the CONSTRUCTOR cached, so what
# shipped was "the file was unreadable when this store was built" and NOT "...is unreadable now". A host up
# on a good file, an operator hand-editing that file into invalid JSON — the repair the refusal message
# itself asks for — and one PUT afterwards still overwrote the operator's bytes silently. Same harm, same
# store, same mutator, one moment later. NO INSTRUMENT IN THE TREE COULD SEE IT: Reach C only ever
# constructs a store over an ALREADY-corrupt directory, so the census is blind to corruption that arrives
# after construction. These four tests are that instrument.
#
#   tests/St4i.EdgeCore.Tests/Historian/OeeSettingsStoreTests.cs                               +3
#       Set_WhenTheFileIsCorruptedAfterConstruction_Refuses_AndLeavesTheOperatorsBytes — the arm that was
#           open, with the premise asserted (the store came up Loaded, so construction cannot explain the
#           refusal) and the bytes compared byte-for-byte with no temp file beside them.
#       Set_WhenAnUnreadableFileIsRepairedAfterConstruction_StillRefuses_UntilReload — the hole re-reading
#           would have OPENED on its own: an unreadable load leaves the table EMPTY, so a repaired file
#           reads Loaded while writing that table would discard the repair. Refusal holds, Reload is the
#           way out, and the write then lands ON TOP of the repaired content.
#       Read_RecordsWhatItAnswered_SoStatusMeansTheMostRecentRead — review M-2: `Status`'s doc sentence was
#           false on the member the refusal hangs on.
#
#   tests/St4i.EngineApi.Tests/HistorianEndpointsOeeTests.cs                                    +1
#       OeeSettings_Put_AfterTheFileIsCorruptedBeneathALiveStore_Returns409_AndDoesNotOverwrite — the same
#       window at the operator's own surface, through the real handler.
#
# 🔴 THE CONTROL PAIR FOR THIS ROUND, RUN ON BOTH SIDES. Base is 5dbe09a6 (V-1 round 1, already green at
# 2720), so the arms differ only in the fix. Same file on both, naming nothing the fix round introduced:
#   BASE 5dbe09a6 — the post-construction corruption is OVERWRITTEN: Set returns normally and the
#       operator's hand-edited bytes are replaced by the in-memory table.
#   HEAD — Set throws OeeSettingsUnreadableException and the bytes are byte-for-byte unchanged.
# Retained, with both transcripts, under .superpowers/sdd/one-unreadable-posture/evidence/ — the retention
# rule adopted last task, and the gap this task's own review named (a `git hash-object` of a blob that was
# never written to the object store proves nothing).
#
# EXPECT_WARNINGS stays 116 and EXPECT_BUILD_NODES stays 0.
#
# 🔴 V-1 FIX ROUND 2 (review N-2) raises EXPECT_EDGECORE 1121 -> 1122 (+1). Grand total 2724 -> 2725.
# EXPECT_ENGINEAPI does NOT move: the rest of the round is documentation and one owner item.
#
#   tests/St4i.EdgeCore.Tests/Historian/OeeSettingsStoreTests.cs                                +1
#       Set_WhenTheUnreadableFileWasMovedAside_RefusesWithoutClaimingItReadsCorrectly. The stale-table
#       refusal fires on TWO different fresh readings and one sentence cannot be true of both: an operator
#       who took the SIBLING message's own advice ("move it aside and restart") was being told "the file
#       reads correctly again now" about a file that no longer exists. Three messages now, and this pins
#       the one that was wrong -- by what it must NOT say as well as by what it must.
#
# 🔴 TASK W-1 (.superpowers/sdd/edgecore-doc-instrument/task-1-brief.md) raises EXPECT_EDGECORE 1122 -> 1129
# (+7). Grand total 2725 -> 2732. ONE new file; nothing is rewritten, split or deleted.
# (W-1 fix round 1 adds the seventh; the six below are the original round and the seventh is named after
# them, so the arithmetic is readable rather than re-stated.)
#
#   tests/St4i.EdgeCore.Tests/DocCommentProseTests.cs   (NEW FILE)                               +7
#       The instrument this task exists to build: `///` prose in St4i.EdgeCore -- and in every other
#       compilation in this tree -- now has something that reads it as SYNTAX. It is NOT the compiler, and
#       that is measured rather than preferred: turning GenerateDocumentationFile on for St4i.EdgeCore alone
#       takes this build from 116 warnings to 852 (measured, SDK 10.0.302, `dotnet build -t:Rebuild`), and
#       nothing in the compiler separates the 543 CS1591 + 92 CS1573 coverage half from the 101 parse/resolve
#       half. The coverage half is an owner decision (Directory.Build.props), so this task takes the half
#       that needs no switch. Six tests:
#       TheScanReachesItsCorpus_AndTheVendoredFileTheProjectNames -- the floor guard, first because
#           everything else is vacuous without it; also derives the vendored SDK path from the csproj's own
#           Compile Include rather than re-spelling it.
#       EveryDocBlockInSourceThisRepositoryOwns_ParsesAsXml -- the assertion. Its corpus size is NOT quoted
#           here on purpose: the first revision of this line said "530 files, 3,616 blocks", which paired a
#           file count from one tree with a block count from another over a different population (the 3,616
#           included the vendored file, which the file count does not). Measured at 3f6eccb1: 531 owned
#           files carrying 3,603 owned blocks, plus one linked-in file carrying 15. Name the assertion, do
#           not copy its number -- the only scalars it holds are its two floors.
#       EveryDocBlockInTheVendoredSdkFileEdgeCoreCompiles_ParsesAsXml -- the SAME question asked of the file
#           this repository may not edit, kept as a separate population because its remedy is a report to
#           the SDK's owner and not an edit. Two separately fatal populations, never a net count.
#       EveryElementNameInEveryDocBlock_IsOneThisRepositoryHasRegistered -- the one axis on which this
#           instrument is WIDER than the switch: Roslyn ignores element names entirely, so `<summry>` drops
#           a whole summary from every rendered surface and no build anywhere says so.
#       NoDelimitedDocCommentIsWrittenAnywhereInTheCorpus -- W-1 FIX ROUND 1, and it is a boundary turned
#           into an assertion rather than a sentence. C# has a SECOND doc-comment form, `/** ... */`; the
#           compiler reads it (CS1570 on an unclosed tag, demonstrated by review) and this reader does not
#           look at it at all -- a one-way gap in exactly the direction the file exists to close. There are
#           none in the corpus and this is what keeps it so. Its detector is proven inside the same test, so
#           the zero cannot be the zero of a detector that stopped detecting.
#       TheParseCheck_ReportsABlockThatIsNotWellFormed        \  §8.1(h6). An instrument that cannot go red
#       TheElementNameCheck_ReportsAnUnregisteredName          /  is not an instrument, and a green suite
#           that would stay green with the checker broken witnesses nothing. Both drive the same functions
#           the four assertions drive, on hand-built inputs, including the exact shapes T-1 and P-2 shipped.
#
# 🔴 WHAT IT FOUND ON ITS FIRST RUN, and it is why this is a standing check rather than a sweep. One live
# malformed block: tests/St4i.Connector.Abstractions.Tests/EnumSpellingContractTests.cs, a `<para>` opened
# and closed by its parent `</summary>`. Introduced at 05a4f7a8 (P-2 round 2) and present at every merge
# from there to this branch's base -- the ENUMERATION, because its size is what went wrong the first time:
#     f89da589 (P-2)  17fa6841 (Q-1)  79dbf99a (R-1)  7bb0c5bd (S-1)
#     895c0c23 (T-1)  f18f5c29 (U-1)  46439925 (V-1)
# Seven. The first revision of this note said SIX and listed six of those seven, dropping U-1 -- a ceiling
# offered as complete and one short, which is the V-1 rule exactly, inside the note that installs the
# instrument against it. None of the seven could see the defect, because that project does not set the
# switch either. Fixed here by re-siting one `</para>` so the two paragraphs are siblings rather than
# nested; no assertion in that file is touched, which is why EXPECT_ABSTRACTIONS stays 160.
#
# EXPECT_CONFORMANCE, EXPECT_EDGESERVICE and EXPECT_ENGINEAPI are deliberately UNCHANGED: W-1 adds no
# driver, no connector kind and no product code at all. A move in any of them would mean this task reached
# somewhere it had no business reaching.
# 🔴 Task X-1 raises this 1129 -> 1131 (+2), the only suite to move by more than one: it takes the linked
# OwnOutputDirectoryGuard [Fact] every suite gets, PLUS
# TestRunTempRootTests.MachineConfigStore_ResolvesAwayFromThisAssembliesOwnOutputDirectory, which can only
# live here because this is the only suite that can see MachineConfigStore. Full justification — including
# why the runner's 1124 is not this number — beside EXPECT_ABSTRACTIONS at the top of this file.
#
# 🔴 TASK Z-1 (.superpowers/sdd/one-law-three-sites/task-1-brief.md) raises EXPECT_EDGECORE 1131 -> 1143
# (+12) and EXPECT_ENGINEAPI 1370 -> 1371 (+1). Grand total 2738 -> 2751. THREE existing files gain the
# twelve; nothing is rewritten, split or deleted. Z-1 closes the last three items of ONE law
# (docs/owner-decisions.md items 8, 10 and 11), and the three sites need three DIFFERENT mechanisms, so the
# twelve are grouped by site rather than by file:
#
#   tests/St4i.EdgeCore.Tests/Historian/OeeSettingsStoreTests.cs   (item 11, the owner's predicate)    +5
#       Set_WhenAFileAppearsAfterTheStoreCameUpWithNone_Refuses_AndTheRestoredFileSurvives -- the
#           measurement: table built from Absent, disk now Loaded, write refused, bytes byte-for-byte.
#       Set_TheFirstTimeAfterACleanStart_StillEstablishesTheFile -- the price the decision named and the
#           fix must not pay. It survives on the SECOND fact (the fresh read is Absent too), not on an
#           exemption, which is why it is asserted rather than argued.
#       Set_AfterReloadingTheFileThatAppeared_LandsOnTopOfIt -- the documented way out.
#       Set_WhenAnEmptyTableFileAppearsAfterTheStoreCameUpWithNone_AlsoRefuses -- the refusal is WIDER
#           than the measured harm, deliberately; pinned so the widening is a decision and not a surprise.
#       Set_AfterARestoreOntoAHostThatCameUpWithAFile_StillOverwritesIt_AndThatIsTheKnownCeiling -- 🔴 the
#           RESIDUE, pinned LIVE the way S-1 pinned item 5's defect. The owner's predicate closes the
#           restore onto a host that came up with NO file; the same restore onto a host that came up WITH
#           one still writes, because both readings are Loaded and nothing records which bytes the table
#           came from. If a later task closes it, this assertion inverts and the inversion is that diff.
#
#   tests/St4i.EdgeCore.Tests/CredentialStoreTests.cs              (item 10, the owner's data MOVE)    +5
#       Save_OverABlobThisProcessCannotDecrypt_KeepsTheOldBytesAside_UnderANameThatSaysWhy -- the one the
#           decision is about: the re-claim still succeeds AND the bytes survive.
#       Save_OverAUsableBlob_ReplacesIt_AndKeepsNothingAside      \  the two arms that stop the fix being
#       Save_WithNothingAtThePath_WritesTheOneFile_AndKeepsNothingAside  /  a sweep. Three outcomes, three
#           facts; without them, "keeps a copy of every credential ever written" would pass the first one.
#       ListMachineCodes_DoesNotReportABlobThatWasKeptAside -- `*.bin` is a THREE-character extension and
#           Win32 pattern matching returns names whose extension merely begins with it. Measured, not
#           reasoned about, because being wrong here tells the Settings view a machine has a key it hasn't.
#       Save_KeepingABlobAside_NeverOverwritesAKeptBlobThatIsAlreadyThere -- the collision item 10 left to
#           the executing task, FORCED rather than hoped for: both candidate second-stamps are pre-created,
#           so the collision happens whichever side of a second boundary the save lands on.
#
#   tests/St4i.EdgeCore.Tests/Site/SiteBridgeManagerTests.cs       (item 8, the third caller)          +2
#       ReapplyCurrentAsync_WithAnUnreadableSiteLinkFile_LeavesEveryByteWhereItWas -- the measurement:
#           rotate while the file is unreadable, and the record the PROCESS invented no longer lands on it.
#       ReapplyCurrentAsync_DoesNotPersist_EvenWhenTheFileReadsPerfectly -- the half that makes the
#           guarantee STRUCTURAL. The fix is not "skip the write when the file is unreadable"; a re-apply
#           establishes no value on ANY arm, so it never persists. Without this the fix is one forgotten
#           flag away from reverting silently.
#
#   tests/St4i.EngineApi.Tests/HistorianEndpointsOeeTests.cs       (item 11 at the operator surface)   +1
#       OeeSettings_Put_AfterABackupIsRestoredUnderALiveStore_Returns409_AndDoesNotOverwriteIt -- and it
#           also pins the catch widening: the store now raises a SECOND refusal type and the handler
#           catches their shared base. Reusing the `Unreadable` type would have kept the 409 green behind a
#           published name asserting something false about a file that read correctly.
#
# 🔴 ONE EXISTING ASSERTION INVERTED AND ONE MEMBER RENAMED, WHICH IS WHY EXPECT_ENGINEAPI MOVES BY ONLY
# ONE. CredentialStorePostureCensusTests.TheCredentialStore_CannotTellAnUnusableBlobFromNoBlob_AndTheReclaim-
# OverwritesIt is now ...AndTheReclaimNowKeepsItAside, and its last assertion says the old bytes SURVIVE
# where it used to say a re-claim replaced them. docs/owner-decisions.md item 10 predicted exactly that
# ("when the fix arrives, that assertion inverts, and the inversion is the diff"). A rename, not an
# addition — the count is unchanged and the NAME had to move because a member name is a published string.
#
# EXPECT_ABSTRACTIONS, EXPECT_CONFORMANCE and EXPECT_EDGESERVICE are deliberately UNCHANGED. Z-1 touches
# three stores in St4i.EdgeCore and one endpoint in St4i.EngineApi; a move anywhere else would mean this
# task reached somewhere it had no business reaching. EXPECT_CONFORMANCE in particular stays 24: Z-1 adds
# no driver and no connector kind.
#
# EXPECT_WARNINGS stays 116 and EXPECT_BUILD_NODES stays 0 (measured on a full solution build). No
# suppression of any kind was added — no .editorconfig, no <NoWarn>, no #pragma — which makes this the
# ninth consecutive task with none.

# 🔴 TASK AA-1 (.superpowers/sdd/oee-definition-and-row-shape/task-1-brief.md) raises this 1143 -> 1147
# (+4). Grand total 2751 -> 2755. ONE new file, four plain [Fact]s, nothing rewritten, split or deleted —
# and it is the ONLY executable line this task changes. Everything else AA-1 does is prose: doc comments on
# WaveformSeries/Verdict/OeeResultDto/GetOeeFleetAsync/BuildReportPdf, and docs/owner-decisions.md.
#
#   tests/St4i.EdgeCore.Tests/WaveformSeriesRowShapeContractTests.cs   (owner item 4, the witness)      +4
#       Owner item 4 asked for a witness "so it does not drift back". Nothing pinned anything: every
#       `RateHz` use in tests/ was round-trip serialization, which asserts a value SURVIVES and never that
#       it CORRELATES with a row shape. What the four facts pin is the row shape THIS PRODUCT'S TWO
#       PRODUCERS EMIT — a measured fact — and NOT which row shape is canonical, which is open owner item
#       14 (see the retraction block below).
#       EveryWaveformTheBuiltInSimulatorsEmit_MatchesTheRowShapeThoseProducersUse_AndBothArmsAreExercised +1
#           Swept over all eight built-in simulators. Two FLOORS: a tree emitting no rated series, or no
#           untimed series, fails here instead of reporting a clean sweep of nothing. The floors count
#           SERIES that touched each arm, not rows inspected — stated precisely because they are weaker
#           than a row census (a series with an empty Samples list passes a floor and contributes no
#           inspected row); what actually forecloses a vacuous pass is the next fact.
#       TheTwoBuiltInProducers_SitOnOppositeSidesOfTheRateHzSplit_AndElementZeroIsAnAngleNotATime    +1
#           The producers named individually, each pinned to a concrete number out of the SAME reading: on
#           the rated side the sample count over the rate reproduces that reading's own weld_time, and on
#           the untimed side element 0 rises to that reading's own angle metric — so element 0 is
#           demonstrably an ANGLE and not a time.
#       TheRowShapeCheck_GoesRedOnEveryDeviationFromTheProducersShape                                +1
#       TheRowShapeCheck_GoesRedOnARealProducersOwnSeries_WhenOnlyTheRateHzFieldMoves                +1
#           §8.1(h6), two banks. 🔴 SAY IT PLAINLY RATHER THAN LET THE LIST IMPLY OTHERWISE: the FIRST of
#           these two is a test of TEST CODE. It drives a private predicate in its own file with data it
#           builds itself, so NO product change can redden it — which is exactly why it stayed green on
#           both control arms below. It is a legitimate bank-one control and it is NOT an assertion about
#           the product; only three of these +4 are. The second bank drives the same predicate with the
#           producers' REAL rows and moves nothing but the RateHz field: the identical rows sit on one side
#           of the split or the other with not one sample touched.
#
# 🔴 THE CONTROL PAIR, RUN ON BOTH ARMS AGAINST THE PRODUCT AND RECORDED AS OUTCOMES. The witness file is
# identical on every arm; only src/ moves, and both mutations were reverted (`git status` clean on both
# simulators before the gate ran):
#   HEAD (both simulators as shipped) — Failed: 0, Passed: 4.
#   DIRTY 1: WelderSim emits `[t, current]` while still setting RateHz — Failed: 3, Passed: 1.
#   DIRTY 2: ScrewdriveSim keeps its `[angle, torque]` rows and claims RateHz = 500 — Failed: 3, Passed: 1.
# The ONE test green on every arm is the bank-one control named above, and that is the right result rather
# than a weak test: it measures the PREDICATE, which neither mutation touches.
#
# 🔴 WHEN THESE THREE NUMBERS WERE MEASURED, said because the diff cannot show it. They were taken TWICE:
# once against the original witness (2026-08-18, round 0) and AGAIN against the rewritten witness after
# review round 1 renamed every fact and deleted the spec-shaped assertion. Both runs produced 0/4, 3/1 and
# 3/1, which is why these lines do not appear in the round-1 diff at all — an unchanged number leaves no
# hunk. The re-review read that absence as "not re-measured"; it is the opposite, and the fix is to record
# the provenance rather than to write down an inference that did not happen.
#
# ══════════════════════════════════════════════════════════════════════════════════════════════════════
# 🔴 AA-1 REVIEW ROUND 1, 2026-08-18 — THIS BLOCK MOVES NO TOTAL (still 1147) AND RETRACTS TWO CLAIMS
# IT PUBLISHED. Kept verbatim rather than rewritten, because they were shipped and read. (The date is
# on this line because AA-1's own preservation rule, stated in docs/owner-decisions.md's 📎 note, is
# "verbatim, dated, attributed, reason alongside" — and until the re-review caught it, this was the one
# of the four retraction sites that carried no date. A style declared and then not followed is a false
# claim about itself.)
#   * "Swept over ALL EIGHT built-in simulators rather than the two known producers, so a THIRD producer
#     is covered the day it appears." — an OVERCLAIM. BuiltInSimulators() is a HAND-WRITTEN list of the
#     eight classes that exist today; a NINTH simulator class would not be swept and nothing anywhere
#     would say so (there is no reflection census of SimulatorBase in this suite). True narrower claim:
#     if one of the eight LISTED simulators starts emitting a waveform, it is swept.
#   * "the exact shape the vendored device-client SDK's own worked examples send" / "This second arm is
#     not hypothetical: it is exactly the shape the vendored device-client SDK's own screwdriver examples
#     publish." — the framing was that those examples are wrong. They are not: they match the platform's
#     own published feed specification and its runtime ingest validator, which require exactly two numbers
#     per row with rateHz an independent optional field. The assertion that reused that example's own
#     figures has been REMOVED from the first bank rather than reworded — a test is the worst place to
#     settle a question nobody has decided.
# The four [Fact] names above changed with them (the old names asserted "the Rule"). A member name is a
# published string, so the rename is recorded here rather than done quietly. THE TOTAL DOES NOT MOVE:
# four facts before, four after, none added, none split, none deleted.
#
# 🔴 AND THE FOUR NAMES THAT WERE TAKEN AWAY ARE WRITTEN OUT HERE, because the sentence above only
# works in one direction otherwise. If a member name is a published string, then a member name that has
# been REMOVED is a published string too, and somebody who wrote
# `--filter FullyQualifiedName~<old name>` has no way back from a list of the new ones. The four, as
# they stood at 84836ad6, in the same order as the four above:
#     EveryWaveformTheBuiltInSimulatorsEmit_ObeysTheRateHzRowShapeRule_AndBothArmsAreExercised
#     TheTwoBuiltInProducers_SitOnOppositeArmsOfTheRule_AndElementZeroIsAnAngleNotATime
#     TheRowShapeCheck_GoesRedOnEveryWayTheRuleCanBreak
#     TheRowShapeCheck_GoesRedOnARealProducersOwnSeries_WhenOnlyTheDiscriminatorMoves
# The private predicate was renamed with them: RowShapeViolation -> RowShapeDeviation.
# ══════════════════════════════════════════════════════════════════════════════════════════════════════
#
# EXPECT_WARNINGS stays 116 and EXPECT_BUILD_NODES stays 0 — measured on a full `dotnet build -t:Rebuild`
# of the whole solution AFTER the change, never on an incremental build, because an incremental build only
# reports the projects it rebuilt and the previous task went red at the gate for exactly that. The new test
# file compiles with no warning of its own. Of the four source files whose `///` blocks AA-1 edits, only
# St4i.Connector.Abstractions sets GenerateDocumentationFile, so only its blocks are compiled at all —
# every edited block was nonetheless checked directly by running DocCommentProseTests, because an
# unbalanced block HIDES the diagnostics inside it and no compiler anywhere checks an element NAME. No
# suppression of any kind was added, which makes this the TENTH consecutive task with none.
#
# ══════════════════════════════════════════════════════════════════════════════════════════════════════
# 🔴 TASK AE-1 (.superpowers/sdd/item12-stage2/task-1-brief.md) — owner decision item 12, STAGE 2 — raises
# this 1147 -> 1152 (+5). Grand total 2758 -> 2763. ONE new file,
# tests/St4i.EdgeCore.Tests/SuppressionCensusTests.cs; nothing is rewritten, split or deleted, and the five
# are named rather than counted:
#     TheCensusReachesItsCorpus_AndBothAncestorChainsThatReachThisSolution
#     TheEnumerationOfSuppressionInstructions_IsExactlyThis
#     TheEnumerationOfAnalyzerConfigFilesThatWouldReachThisSolution_IsExactlyThis
#     TheDocumentationSwitchIsSetOnExactlyTheseProjects
#     TheDetector_ReportsEachMechanismItClaimsToRead
#
# 🔴 TWO OF THOSE FIVE WERE RENAMED WITHIN THIS BRANCH, AND THE OLD NAMES ARE WRITTEN OUT HERE BECAUSE A
# MEMBER NAME IS A PUBLISHED STRING AND A REMOVED ONE IS TOO (P-2's rule, applied to itself). As they stood
# at 116d8bdb:
#     TheCensusReachesItsCorpus_AndTheVendoredFilesAncestorChain
#     TheEnumerationOfAnalyzerConfigFilesThatWouldReachTheVendoredFile_IsExactlyThis
# Both named ONE ancestor chain, both were accurate about the scan they described, and that accuracy is
# exactly what hid the defect branch review found: there are TWO chains that reach this solution. The scan
# now walks both and the names say so. THE TOTAL DOES NOT MOVE: five facts before, five after.
#
# EXPECT_ABSTRACTIONS, EXPECT_CONFORMANCE, EXPECT_EDGESERVICE and EXPECT_ENGINEAPI are deliberately
# UNCHANGED, and that is a check rather than a convenience: AE-1 adds one file to one suite and changes the
# build gate; a total moving anywhere else would mean it reached somewhere it had no business reaching.
#
# 🔴 WHY THAT FILE IS IN THIS SUITE AND NOT SOMEWHERE MORE OBVIOUS. It scans a domain that is not this
# project's — the whole product tree PLUS the vendored SDK file's ancestor chain, which lives OUTSIDE
# tools/machine-simulator. It sits here because this is the suite that already owns the vendored file's
# identity (DocCommentProseTests derives the same path from the same csproj), and one suite owning one
# question is worth more than a tidier home.
#
# 🔴 WHAT IT IS FOR, in one sentence, because a census of suppressions reads like bureaucracy until you
# see what it protects: the origin-split warning ledger added to the build gate below can only see an
# override that removes a warning WHICH EXISTS. With GenerateDocumentationFile off, CS1591 and CS1573 are
# emitted nowhere, so `<NoWarn>$(NoWarn);CS1591</NoWarn>` committed today moves NO number in this file and
# then silences 543 warnings the day stage 3 turns the switch on. That file is what makes "no override has
# shipped since N-1" — asserted in prose in four documents and by nothing anywhere — into an assertion.
#
# EXPECT_WARNINGS stays 116 and EXPECT_BUILD_NODES stays 0, measured on a full `dotnet build -t:Rebuild` of
# the whole solution, never on an incremental one. The new file compiles with no warning of its own. NO
# SUPPRESSION OF ANY KIND WAS ADDED — which makes this the FOURTEENTH consecutive task with none, and the
# first one whose successor can no longer take that on trust.
#
# 🔴 TASK AF-1 (.superpowers/sdd/item12-stage3/task-1-brief.md) — ITEM 12 STAGE 3, THE SWITCH IS ON — MOVES
# NO SUITE TOTAL AT ALL. EXPECT_ABSTRACTIONS 161, EXPECT_CONFORMANCE 24, EXPECT_EDGECORE 1152,
# EXPECT_EDGESERVICE 52, EXPECT_ENGINEAPI 1374, grand total 2763: every one unchanged, and here that is a
# MEASUREMENT rather than a convenience. AF-1 adds no test and deletes none; it turns one MSBuild property
# on in src/St4i.EdgeCore/St4i.EdgeCore.csproj and moves the two tables AE-1 built to hold it — the
# EXPECT_WARNINGS/EXPECT_WARNING_LEDGER pair in this file (116 -> 852, twelve rows -> nineteen) and the
# GenerateDocumentationFile table in SuppressionCensusTests (seven on / eight off -> eight on / seven off).
# A suite total moving on this commit would mean the switch changed behaviour somewhere, which is exactly
# what it must not do. EXPECT_BUILD_NODES stays 0.
#
# 🔴 AND THE CENSUS WENT RED BEFORE ITS TABLE WAS MOVED, WHICH IS THE ONLY REASON TO BELIEVE ANY OF THIS.
# The switch was flipped FIRST and SuppressionCensusTests run against the unedited table: 1 failed / 4
# passed, TheDocumentationSwitchIsSetOnExactlyTheseProjects, naming St4i.EdgeCore.csproj at "on" against an
# expectation of "off". AE-1 built that assertion for precisely this edit and it caught precisely this
# edit. Transcripts: .superpowers/sdd/item12-stage3/task-1-report.md.
#
# 🔴 TASK AG-1 (.superpowers/sdd/item12-stage4/task-1-brief.md) — ITEM 12 STAGE 4, THE 101 ALREADY-FALSE
# CLAIMS ARE PAID — ALSO MOVES NO SUITE TOTAL. EXPECT_ABSTRACTIONS 161, EXPECT_CONFORMANCE 24,
# EXPECT_EDGECORE 1152, EXPECT_EDGESERVICE 52, EXPECT_ENGINEAPI 1374, grand total 2763: unchanged, and
# again as a MEASUREMENT rather than a convenience. AG-1 adds no test and deletes none. It edits 29 files
# under src/St4i.EdgeCore and NOT ONE changed line in them is anything but a `///` line — that is a ZERO,
# in both directions, and it is the claim; the raw diff is 106 `///` lines added and 99 removed. A suite
# total moving would mean it had edited code while claiming to edit prose. It moves EXPECT_WARNINGS 852 -> 751
# and EXPECT_WARNING_LEDGER nineteen rows -> sixteen (three rows DELETED, not zeroed — see the block at
# the ledger for why a zeroed row would fail). SuppressionCensusTests is untouched and its three tables
# are unmoved, which is the check that no override arrived: 5 file / 8 instruction / CS0618 + CS0162,
# 8 on / 7 off, analyzer-config files EMPTY. EXPECT_BUILD_NODES stays 0.
#
# 🔴 THE THREE LINES ABOVE SAID "— 96 of them —" UNTIL BRANCH REVIEW, AND THAT IS THE NINTH TIME. AG-1
# measured 96, made four more edits, wrote 96 into three files without re-measuring, then withdrew it in
# commit c3df4f6d and reported "withdrawn in all three places". True BY FILE. False BY OCCURRENCE: the
# number appears TWICE in THIS file and only ONE of them was retired. The withdrawal block sits at the
# EXPECT_WARNING_LEDGER, about 3,460 lines BELOW this line, in the same file.
#   Read the distance, because it is the whole lesson and it is getting worse, not better: AF-1's seventh
#   instance wrote over a correct number 140 lines away. This one is 3,460 lines away, IN THE FIX FOR
#   ITSELF. A `grep` for the retired literal is four seconds and neither of us ran it. The correction to a
#   correction is where this rule keeps landing, so: WHEN YOU WITHDRAW A NUMBER, GREP THE REPOSITORY FOR
#   IT — retiring one occurrence and saying "all of them" is the same defect wearing the fix's clothes.
#
# 🔴 TASK AH-1 (.superpowers/sdd/item12-stage5/task-1-brief.md) — ITEM 12 STAGE 5, THE FIRST 120 COVERAGE
# GAPS ARE PAID BY WRITING — ALSO MOVES NO SUITE TOTAL. EXPECT_ABSTRACTIONS 161, EXPECT_CONFORMANCE 24,
# EXPECT_EDGECORE 1152, EXPECT_EDGESERVICE 52, EXPECT_ENGINEAPI 1374, grand total 2763: unchanged, and
# again as a MEASUREMENT. AH-1 adds no test and deletes none. It edits SEVEN files under
# src/St4i.EdgeCore/Config and moves EXPECT_WARNINGS 751 -> 631 and one ledger row
# (OURS CS1591 448 -> 328); the table still holds sixteen rows because nothing reached zero.
# SuppressionCensusTests is untouched and its three tables are unmoved: 5 file / 8 instruction /
# CS0618 + CS0162, 8 on / 7 off, analyzer-config files EMPTY. EXPECT_BUILD_NODES stays 0.
#   🔴 THE DIFF CLAIM IS NARROWER THAN STAGE 4's AND THAT IS STRUCTURAL, NOT SLOPPINESS. Documenting an
#   enum MEMBER forces the one-line `public enum X { A, B }` declaration to be re-laid out, because a
#   `///` block cannot attach to a member inside it. Seven declarations were re-laid out. Outside `///`
#   lines, blank lines, one 3-line `//` banner and those seven re-layouts, ZERO lines changed — and all
#   seven member sequences are identical name-for-name and order-for-order, which is the part that would
#   have mattered had it not held. Stages 6..8 documenting enums will meet exactly the same thing.
#   🔴 AND ONE SENTENCE AH-1 SHIPPED HAD TO BE WITHDRAWN ONE COMMIT LATER, BY ITSELF. It is the failure
#   mode the whole of stages 5..8 should expect, so it is recorded here rather than only in the report.
#   `ProductModel.ImageWidth`'s doc said it was "also the denominator for
#   MeasurementPoint.NormalizedRadius". The arithmetic is real — the seed's 10-unit radius on a
#   1600-wide board is 0.00625, and the board canvas multiplies back by container WIDTH — but NO CODE
#   ANYWHERE PERFORMS THAT DIVISION: normalizedRadius is authored by hand and only range-checked to
#   [0,1] by the web form. The sentence attributed an OPERATION to code that does not do it, while
#   every number in it was correct. THAT is the shape to watch for when the deliverable is prose: not
#   a wrong fact, a right fact given a false mechanism, and it reads perfectly. The only defence is
#   walking the code path before asserting — which is also how the same round caught itself claiming
#   that JSON key order reaches the drift key (ConfigChecksum.StableStringify sorts keys ordinally, so
#   it does not, and that sentence never reached a commit because the code was read first).
#
# 🔴 AND THE BRANCH REVIEW THEN FOUND SEVENTEEN MORE, WHICH IS THE REAL RESULT OF STAGE 5 AND THE ONE
# STAGES 6..8 MUST BUDGET FOR. It sampled 48 of the 120 sentences and refuted 17 -- about 35% -- and
# NOT ONE of them was visible to anything in this repository: the gate was green, DocCommentProseTests
# was green, every ledger row reproduced exactly, and EXPECT_WARNINGS did not move. A documentation
# stage's output is assertions, and this file's instruments count assertions without reading them.
#
# 🔴 THE CAUSE WAS NOT CARELESS PROSE, IT WAS A SAMPLE WEARING A CENSUS'S CLOTHES. Twelve of the 17
# had one origin: the author read ProductConfigStore's seed as far as point P05, stopped, and then
# wrote EXISTENCE NEGATIONS ("no seed sets this", "unused by anything this repository seeds") over
# nine points never opened -- P06..P08 and all of SeedModelB. Two more were a `BumpVersion` caller
# census written without a grep, and then COPIED INTO A SECOND FILE, so one unrun command produced two
# wrong claims. That is the ninth-instance lesson from stage 4 (retire one occurrence, declare "all")
# reappearing one layer up, in the stage that quoted it.
#
# 🔴 TWO MECHANICAL RULES, AND STAGES 6..8 SHOULD TREAT THEM AS PRECONDITIONS RATHER THAN ADVICE:
#   (i)  Any sentence containing `unused` / `no seed` / `unpopulated` / `never` / `only` / `every` /
#        `exactly N` / `spans A-B` is a claim about a POPULATION. Enumerate that population WITH A
#        TOOL before negating it by hand, and keep the command.
#   (ii) Any observable SET or RANGE must be EXTRACTED automatically from the source it describes,
#        never typed from memory of having read it. Stage 5's round-two fix extracted every seed value
#        with a script and corrected 39 of its own 120 sentences: 17 outright false, 8 stating a
#        definite article over an incomplete set, 4 that merely restated the member name, 2 reaching
#        past their evidence, 1 describing a mechanism this tree never exercises, and 7 too thin.
#
# 🔴 AND A THIRD THING, SMALLER AND EASY TO MISS: A NEW `//` COMMENT IS PROSE NOTHING GUARDS.
# DocCommentProseTests reads `///` only, and the compiler reads neither. Stage 5's first round put a
# three-line `//` banner carrying a factual claim above a property block, and the claim was WRONG --
# an assertion planted at the one spot both instruments are blind to, and its own diff filter listed
# "`//` lines" as an excluded class, so its "zero non-`///` lines" check absorbed it. The fix was not
# to count those lines separately but to REMOVE them: the corrected statement moved into a `<summary>`
# where W-1 can see it, and the new-`//`-line count for the whole stage is now zero.
# ══════════════════════════════════════════════════════════════════════════════════════════════════════
#
# ══════════════════════════════════════════════════════════════════════════════════════════════════════
# 🔴 TASK AJ-1 (.superpowers/sdd/items-9-13-executed/task-1-brief.md) — OWNER DECISIONS 9 AND 13 EXECUTED.
# RAISES EXPECT_EDGECORE 1152 -> 1153 (+1). Nothing else moves; grand total 2763 -> 2764.
#
# WHAT WAS ADDED — ONE [Fact], and it is the PRICE rather than the fix:
#   + 1  tests/St4i.EdgeCore.Tests/Historian/OeeSettingsStoreTests.cs —
#        Set_AfterTheFileIsMerelyReformatted_IsAlsoRefused_AndThatIsTheAcceptedPrice. Item 13's identity
#        comparison is over the file's BYTES, so a file that was only re-indented or had its keys reordered
#        is refused with the same 409 as a restore. The owner decided item 13 with that written down
#        ("kể cả khi thứ đổi file là một biên tập tay hợp lệ"), so it is pinned: a later round that
#        "improves" the comparison into a semantic one reddens here and has to say so, rather than
#        reopening item 13's hole quietly (a parsed-table comparison has a false NEGATIVE at exactly the
#        case item 13 closes — Load skips empty machine codes and collapses duplicates).
#
# 🔴 WHAT WAS *NOT* ADDED, AND THE ZERO IS THE POINT. Both decisions are executed by INVERTING existing
# witnesses, not by adding new ones, which is why +1 and not +3:
#   * OeeSettingsStoreTests.Set_AfterARestoreOntoAHostThatCameUpWithAFile_StillOverwritesIt_AndThatIsTheKnownCeiling
#     -> ..._IsRefused_AndTheRestoredBytesSurvive. It pinned a LIVE defect as a baseline (S-1's idiom for
#     item 5, V-1's for item 10) precisely so the closure would appear as an inversion in a diff. Renamed
#     with the body: a name saying "the known ceiling" over a body asserting a refusal is a published
#     string asserting something false (P-2).
#   * StartupSettingsReplayHardeningTests.AMalformedSettingsFile_SurvivesAnOrdinarySuccessfulStart_AndTheHostSaysSo
#     -> ..._IsOverwrittenByTheEnvironmentFloor_AndTheHostSaysSo. Same shape, opposite direction: item 9(b)
#     decides that the ST4I_* floor IS applied and IS persisted over an unreadable file.
#   Neither rename moves a count, and neither test was split or deleted.
#
# 🔴 AND THE ONE THAT DID NOT MOVE THOUGH IT LOOKS LIKE IT SHOULD HAVE:
# StartupSettingsReplayHardeningTests.TheStartupReplayHasExactlyOneArm_AndTheSettingsFileOneWriterAndOneDeleter
# STAYS GREEN through item 9(b) and is untouched. (b) is executed by DELETING one guard expression — on the
# Unreadable arm `initialSettingsRequest` is already the env floor — so `TryReplayStartupSettings(` is still
# named exactly twice, `Save` still has one call site and `Delete` still has one. A source census counting
# text was never the instrument for this change; the behaviour witness above is. Stated here because a green
# census beside a behavioural change reads as evidence when it is only silence.
#
# EXPECT_WARNINGS stays 631, EXPECT_WARNING_LEDGER stays at its sixteen rows unmoved unit for unit, and
# EXPECT_BUILD_NODES stays 0 — measured on a full `dotnet build -t:Rebuild`, not assumed. The new public
# type (OeeSettingsFileChangedException) and the new internal member (OeeSettingsRead.Text) both carry `///`
# blocks, which is what keeps `OURS CS1591 328` from moving in St4i.EdgeCore, where
# GenerateDocumentationFile is ON. No suppression of any kind was added — no NoWarn, no #pragma, no
# .editorconfig severity — and SuppressionCensusTests' three tables are untouched.
# ══════════════════════════════════════════════════════════════════════════════════════════════════════
#
# ══════════════════════════════════════════════════════════════════════════════════════════════════════
# 🔴 TASK AK-1 (.superpowers/sdd/item14-option3/task-1-brief.md) — OWNER DECISION 14 EXECUTED, OPTION 3.
# RAISES EXPECT_EDGECORE 1153 -> 1160 (+7). Nothing else moves; grand total 2764 -> 2771.
#
# WHAT WAS ADDED — ONE NEW FILE, SEVEN [Fact], AND THE +7 IS THE POINT RATHER THAN AN OVERHEAD.
#   +7  tests/St4i.EdgeCore.Tests/WaveformPairAtTheWireBoundaryTests.cs (NEW FILE). Item 14 was decided by
#       building the published [t, v] pair at the Normalizer boundary. The measurement that preceded the
#       ruling established that doing so reddens NOTHING in the suite as it stood: the only two files that
#       touch a waveform (ConnectorRoundTripTests, WaveformSeriesRowShapeContractTests) both sit UPSTREAM
#       of that boundary on DeviceReading, and no test anywhere asserted the shape of
#       payload["waveforms"][*]["samples"]. A green suite there was the absence of an instrument, not
#       evidence of safety, so the witness is the FIRST work item of this decision and not a trailing one.
#
# 🔴 THE SPLIT INSIDE THE +7, STATED BECAUSE "SEVEN NEW TESTS" WOULD OTHERWISE READ AS SEVEN WITNESSES.
# Measured by removing the transform and re-running: FOUR go red, THREE stay green.
#   * Red on removal (these measure the CHANGE): WelderSimsOneElementRows_LeaveTheHttpBoundaryAsPairs_...,
#     TheTimeAxisPublished_IsTheOneRateHzIMPLIES_..., TheBoundaryPairsExactlyTheRowsItCan_...,
#     TheRetainedSemanticMirror_CarriesTheSamePairs_....
#   * Green on removal BY CONSTRUCTION (these measure the NON-change, and a test that is red on both sides
#     measures nothing): ScrewdriveSimsAlreadyPairedRows_CrossTheBoundaryUntouched_...,
#     ARatedSeriesThatALREADYCarriesPairs_IsNotPairedASecondTime,
#     EveryRowLeavingTheBoundaryIsADoubleArray_....
#   A second control was run for the failure mode that a green payload cannot show: making the boundary
#   emit List<double> rows instead of double[] — the shape LiveTransport.ReadSampleSeries drops with no
#   exception and no log — reddens SIX of the seven. The one that survives it is the retained-mirror fact,
#   because the MQTT mirror serializes the envelope directly and never passes through that reader. The two
#   published surfaces therefore fail DIFFERENTLY under the same defect, and that is recorded here rather
#   than left for the next person to rediscover.
#
# 🔴 WHAT WAS *NOT* TOUCHED, AND THE ZEROES ARE THE CONTENT OF THE RULING. WaveformSeries, WelderSim and
# ScrewdriveSim: ZERO lines. WaveformSeriesRowShapeContractTests (the round-4 witness): ZERO lines, and it
# stays GREEN — it looks upstream of the boundary, so its silence here is silence and not consent, which is
# exactly why a new file had to exist. No validator, no server/, no client/, no examples/, no SDK sample.
#
# EXPECT_WARNINGS stays 631, EXPECT_WARNING_LEDGER stays at its sixteen rows unmoved unit for unit, and
# EXPECT_BUILD_NODES stays 0 — measured on a full `dotnet build -t:Rebuild`, not assumed. The one member
# added to St4i.EdgeCore (Normalizer.ToWireSampleRows) is PRIVATE and carries a `///` block anyway, so
# neither `OURS CS1591 328` nor `OURS CS1573 84` moves in the project where GenerateDocumentationFile is
# ON. No suppression of any kind was added — no NoWarn, no #pragma, no .editorconfig severity — and
# SuppressionCensusTests' three tables are untouched.
# ══════════════════════════════════════════════════════════════════════════════════════════════════════
#
# ══════════════════════════════════════════════════════════════════════════════════════════════════════
# 🔴 TASK AL-1 (.superpowers/sdd/item12-stage6/task-1-brief.md) — ITEM 12 STAGE 6 — MOVES NO SUITE TOTAL.
# EXPECT_ABSTRACTIONS 161, EXPECT_CONFORMANCE 24, EXPECT_EDGECORE 1160, EXPECT_EDGESERVICE 52,
# EXPECT_ENGINEAPI 1374, grand total 2771: unchanged, and READ BACK OUT OF THIS FILE rather than carried
# from a brief -- a draft of that brief distributed the same correct total as 1152/52/1382, which is the
# right sum over the wrong terms, so the sum is not the check. AL-1 adds no test and deletes none. It
# edits EIGHT files, all under src/St4i.EdgeCore, and moves EXPECT_WARNINGS 631 -> 502 plus TWO ledger
# rows (OURS CS1591 328 -> 243, OURS CS1573 84 -> 40); the table still holds sixteen rows because nothing
# reached zero. SuppressionCensusTests is untouched and its three tables are unmoved.
# EXPECT_BUILD_NODES stays 0.
#   THE LITERAL 631 WAS GREPPED FOR ACROSS THE WHOLE REPOSITORY BEFORE IT WAS MOVED, as the AF-1 lesson
#   three blocks up requires, and every occurrence was classified rather than blanket-retired. The two
#   "EXPECT_WARNINGS stays 631" lines above this one (AJ-1's and AK-1's) are records of what THOSE tasks
#   did not move, scoped to their own trees; they are left exactly as written and are not pins. The
#   forward-looking occurrences — the ones that read as the live figure — are retired in place, here and
#   at the ledger, in Directory.Build.props, and in docs/owner-decisions.md.
#   🔴 STAGE 4's STRONG DIFF CLAIM IS AVAILABLE AGAIN AND IS TAKEN: over `src/`, ZERO changed lines in
#   either direction that are not `///` lines (657 added, 1 removed). Stage 5 could not say that because
#   it documented enum members; this cluster contains no enum, so the narrowing stage 5 recorded was
#   specific to enums and is not a permanent loss for stages 7..8.
#   🔴 THE FAILURE MODE THIS STAGE HIT, for stages 7..8 to expect: extending an EXISTING doc block is
#   where a paid member gets un-paid. Rewriting IHistorianStore.AggregateForOeeAsync's block dropped an
#   existing `<param>` while adding four, creating a NEW CS1573 that nothing but a re-measurement could
#   see -- the prose parsed, W-1 was green, and the diff read as pure addition. Count REMOVED `///` lines
#   in the diff, and re-measure per file until each cluster file's residue is zero.
# ══════════════════════════════════════════════════════════════════════════════════════════════════════
# 🔴 TASK AM-1 (.superpowers/sdd/item12-stage7/task-1-brief.md) — ITEM 12 STAGE 7 — MOVES NO SUITE TOTAL.
# EXPECT_ABSTRACTIONS 161, EXPECT_CONFORMANCE 24, EXPECT_EDGECORE 1160, EXPECT_EDGESERVICE 52,
# EXPECT_ENGINEAPI 1374, grand total 2771: unchanged, and READ BACK OUT OF THIS FILE line by line rather
# than carried from a brief or from AL-1's block above -- for the same reason AL-1 gives, and the check is
# the TERMS and not the sum. AM-1 adds no test and deletes none. It edits TWELVE files, all under
# src/St4i.EdgeCore, and moves EXPECT_WARNINGS 502 -> 440 plus the SAME TWO ledger rows (OURS CS1591
# 243 -> 192, OURS CS1573 40 -> 29); the table still holds sixteen rows because nothing reached zero.
# SuppressionCensusTests is untouched and its three tables are unmoved. EXPECT_BUILD_NODES stays 0.
#   THE LITERALS 502 AND 283 WERE GREPPED FOR ACROSS THE WHOLE REPOSITORY BEFORE EITHER MOVED, and every
#   occurrence was classified rather than blanket-retired -- AL-1's own classification, re-run. Records of
#   what a NAMED task did or did not move (AJ-1's and AK-1's "stays 631" lines, AL-1's own blocks here and
#   in Directory.Build.props and in owner-decisions.md §11) are left EXACTLY as written; only the
#   forward-looking figures are retired in place. 🔴 One occurrence of `502` is not this constant at all:
#   README §"ST4I_MODBUS_PORT" documents the Modbus TCP port, whose value is 502. A blanket substitution
#   would have edited a protocol constant, which is the whole reason this file requires the grep to be
#   CLASSIFIED rather than applied.
#   🔴 THE STRONG DIFF CLAIM IS NARROWED AGAIN, AND BY THE SAME MECHANISM AS STAGE 5 -- the narrowing is
#   a property of ENUMS, exactly as AL-1's note above predicted, and this cluster contains one. Over
#   `src/`: 513 lines added, 4 removed. THREE of the four removed are `///` lines and all three are the
#   OLD ITransport summary, reproduced VERBATIM inside its replacement (see that file). The fourth is the
#   one-line `public enum TransportMode { Live, Demo, Auto }` declaration, re-laid out over six lines so
#   its three members can carry doc comments; the member SEQUENCE is identical name-for-name and
#   order-for-order, which matters because enum order is the underlying value AND, here, the order an
#   operator sees in a combo box. Outside those, ZERO changed lines in either direction that are not
#   `///` lines or blank separators. No executable statement, no signature, no member name was touched.
#   🔴 THE FAILURE MODE AL-1 NAMED WAS TREATED AS A PRECONDITION AND DID NOT FIRE. The cluster was costed
#   PER FILE before a character was written (twelve files, 62 warnings, 51 CS1591 + 11 CS1573), and the
#   three doc blocks that already carried SOME `<param>` -- TransportCoordinator's ctor, WalFlushPump's
#   ctor, MappingProfileResolver.Build -- were extended by INSERTING tags beside the existing ones, never
#   by rewriting the block. Per-file residue after writing: zero in all twelve, and zero in all three
#   directories the cluster empties. Removed `///` lines in the diff: three, all accounted for above.
# ══════════════════════════════════════════════════════════════════════════════════════════════════════
#
# ══════════════════════════════════════════════════════════════════════════════════════════════════════
# 🔴 TASK AP-1 (.superpowers/sdd/item15-dropoldest/task-1-brief.md) — OWNER DECISION 15 EXECUTED.
# RAISES EXPECT_EDGECORE 1160 -> 1165 (+5). Nothing else moves; grand total 2771 -> 2776.
#   THE FOUR OTHER TERMS WERE READ BACK OUT OF THIS FILE LINE BY LINE, not carried from the brief, for
#   the reason AL-1 and AM-1 both give: EXPECT_ABSTRACTIONS 161 (line ~331), EXPECT_CONFORMANCE 24
#   (~332), EXPECT_EDGESERVICE 52 (~1859), EXPECT_ENGINEAPI 1374 (~3315). The sum is not the check; the
#   TERMS are. 1165 is MEASURED (`dotnet test tests/St4i.EdgeCore.Tests` alone: 1165/1165), not 1160+5.
#
# WHAT WAS ADDED — FIVE [Fact] ACROSS THREE FILES, ONE PAIR PER CHANNEL THE RULING COVERS.
#   +2  tests/St4i.EdgeCore.Tests/Historian/HistorianWriterTests.cs (EXISTING FILE) —
#       Enqueue_OnAFullChannel_EvictsTheOldest_AndEveryEvictionIsCountedAndWarned and
#       Enqueue_AfterDispose_IsCountedSeparately_AndReportedAsShutdownNotSaturation. Item 15 measured
#       that this file held ten [Fact] and NOT ONE of them mentioned saturation, capacity or DropOldest:
#       the drop this writer actually suffers had no instrument, and a green file was the absence of one
#       rather than evidence of safety.
#   +2  tests/St4i.EdgeCore.Tests/Uns/UnsPublisherDropAccountingTests.cs (NEW FILE) — the same pair for
#       UnsPublisher, whose six "queue saturated" branches were all unreachable by saturation.
#   +1  tests/St4i.EdgeCore.Tests/Site/UnsBridgeSpoolTests.cs (EXISTING FILE) —
#       ForwardQueueSaturated_EvictsTheOldest_IsCountedAndWarned_AndTheSpoolsDroppedTotalDoesNotMove.
#       Only ONE here, and the asymmetry is stated rather than padded: this bridge's completed-writer
#       branch is reachable only by a call racing DisposeAsync through an MQTT client's receive callback,
#       which this harness cannot schedule deterministically. A fifth test that could not be made to fail
#       on demand would be the exact species this file exists to refuse.
#
# 🔴 THE +5 ARE WITNESSES, AND THAT WAS MEASURED IN BOTH DIRECTIONS RATHER THAN ASSERTED. Two control
# rounds, each built and run whole:
#   * CONTROL A — the three `itemDropped:` callbacks neutered (early return, counter and warning both
#     dead). RED: all three saturation tests. GREEN: the two shutdown tests, correctly — they measure a
#     different path, and a test that reddens under every mutation localises nothing.
#   * CONTROL B — the two shutdown branches reverted to their pre-AP-1 wording ("queue saturated —
#     dropped oldest for X", the string that shipped on the one path that could never be saturation).
#     RED: both shutdown tests. GREEN: the three saturation tests.
#   Every mutation was reverted and `grep -rn MUTATION-AP1 src/ tests/` returns nothing.
#
# 🔴 WHAT WAS *NOT* TOUCHED. FullMode stays DropOldest on all four channels — the ruling is "apply the
# shape AlarmNotifier already solved", not "change the policy", and the non-blocking guarantee that
# policy buys is the whole reason those pipelines exist. AlarmNotifier itself: doc only, ZERO executable
# lines. IUnsPublisher: ZERO lines (owner item 23 is ruled REMOVE and belongs to another task). No
# payload changed: not GET /v1/site, not the retained resync record the Site consumes. No MSI, no
# publish-desktop/, no server/, no client/.
#
# 🔴 EXPECT_WARNINGS STAYS 328, MEASURED ON A FULL `MSBUILDDISABLENODEREUSE=1 dotnet build -t:Rebuild`
# AFTER THE CHANGE — not assumed, and not assumed for a specific reason this task had to pay attention
# to. St4i.EdgeCore is the project where item 12 turned GenerateDocumentationFile ON, so every new PUBLIC
# member there is a CS1591 unless it carries a `///` block, and every new PARAMETER on an
# already-documented member is a CS1573. This task adds SEVEN public members to that project — three
# records (HistorianWriterStats, UnsPublisherStats, BridgeForwardQueueStats) with their eleven
# parameters, three properties (HistorianWriter.Stats, UnsPublisher.Stats, UnsBridge.ForwardQueueStats)
# and one constructor parameter (UnsBridge's channelCapacity) — and the count did not move by one unit,
# because all of them are documented. AL-1's stage-6 failure mode (extending an existing doc block and
# dropping a `<param>` while adding others) was treated as a precondition: the UnsBridge constructor's
# block was extended by INSERTING one `<param>` beside the existing ones, never by rewriting it.
# EXPECT_WARNING_LEDGER stays at its sixteen rows unmoved unit for unit (OURS CS1591 90, OURS CS1573 19,
# eight VENDORED rows untouched). EXPECT_BUILD_NODES stays 0. No suppression of any kind was added — no
# NoWarn, no #pragma, no .editorconfig severity — and SuppressionCensusTests' three tables are untouched.
# ══════════════════════════════════════════════════════════════════════════════════════════════════════
#
# ══════════════════════════════════════════════════════════════════════════════════════════════════════
# 🔴 TASK AQ-1 (.superpowers/sdd/items-16-21/task-1-brief.md) — OWNER DECISION 21 EXECUTED. OWNER
# DECISION 16 WAS **NOT** EXECUTED: its brief carried a STOP condition, the measurement fired it, and the
# stop is recorded in owner-decisions.md item 16 rather than paid in code. So this block moves ONE term.
# RAISES EXPECT_EDGECORE 1165 -> 1168 (+3). Nothing else moves; grand total 2776 -> 2779.
#   THE FOUR OTHER TERMS WERE READ BACK OUT OF THIS FILE LINE BY LINE, not carried from the brief, for
#   the reason AL-1, AM-1 and AP-1 all give: EXPECT_ABSTRACTIONS 161 (line ~331), EXPECT_CONFORMANCE 24
#   (~332), EXPECT_EDGESERVICE 52 (~1916), EXPECT_ENGINEAPI 1374 (~3372). The sum is not the check; the
#   TERMS are. 1168 is MEASURED (`dotnet test tests/St4i.EdgeCore.Tests` alone: 1168/1168), not 1165+3.
#
# 🔴 THE ORDER OF OPERATIONS, BECAUSE AP-1 GOT IT WRONG IN THIS EXACT BLOCK AND CAUGHT ITSELF. AP-1 wrote
# "EXPECT_WARNINGS 328 -> 331" into its justification BEFORE measuring, then the rebuild returned 328 and
# the predicted number was corrected before it shipped. Both numbers in this block were measured FIRST
# and written SECOND: the EdgeCore suite was run alone and returned 1168/1168, and the full rebuild was
# run and returned 328, and only then was either digit typed into this file.
#
# WHAT WAS ADDED — THREE [Fact], ALL IN ONE EXISTING FILE.
#   +3  tests/St4i.EdgeCore.Tests/MappingProfileResolverTests.cs (EXISTING FILE) —
#       An_ABSOLUTE_mappingProfile_pointing_outside_the_mapping_directory_is_refused_and_warns_what_to_fix,
#       A_dotdot_mappingProfile_that_climbs_out_of_the_mapping_directory_is_refused_and_warns, and
#       A_SUBDIRECTORY_of_the_mapping_directory_still_resolves_so_the_confinement_rejects_only_what_LEAVES.
#
# 🔴 TWO OF THE THREE ARE WITNESSES; THE THIRD IS NOT, AND SAYING SO IS THE POINT. The control arm was
# the confinement call replaced by `var path = combined;` — the exact pre-AQ-1 expression — built and run
# whole:
#   * CONTROL (fix removed): RED on the ABSOLUTE test and RED on the dotdot test. GREEN on the other
#     eight, including the subdirectory test.
#   * FIX RESTORED: 10/10 GREEN. The file was restored from a byte copy taken before the mutation, and
#     `git diff` afterwards showed the fix and the tests and nothing else.
#   The subdirectory test is GREEN IN BOTH ARMS **BY CONSTRUCTION** and is therefore NOT a witness for
#   the fix — it is the guard against the opposite error, a confinement drawn so tight that it also
#   rejects `mapping/vendor-a/preset`, which owner item 21 names as the deployment a fix must not break.
#   A ceiling stated too small is worse than no ceiling, so the guard is carried; it is just not counted
#   as evidence that the confinement works.
#
# 🔴 WHAT THE FIX IS, AND WHAT IT DELIBERATELY IS NOT. MappingProfileResolver.ResolveOne now normalizes
# both the mapping directory and the combined candidate to ABSOLUTE paths (Path.GetFullPath) and requires
# the candidate to start with the root plus a trailing separator. It does NOT filter `..` or a separator
# out of the operator's string — that is the classic wrong answer, and the dotdot test exercises both
# separator spellings precisely so a string rule could not pass it. The boundary is LEXICAL: a symlink
# INSIDE the mapping directory pointing out of it is still followed, and the resolver's doc comment says
# so rather than implying a stronger promise than the code keeps. Refusal routes to `logWarning`, not to
# `logError`, because `logError` carries an Exception and a refusal has none.
#
# 🔴 WHAT WAS *NOT* TOUCHED. OeeCalculator: ZERO lines — item 16 is STOPPED, not deferred, and the reason
# is in owner-decisions.md item 16 under its 2026-08-21 measurement. IUnsPublisher: ZERO lines (item 23
# is ruled REMOVE and belongs to another task). No public member was renamed or added. No payload
# changed. No MSI, no publish-desktop/, no server/, no client/.
#
# 🔴 EXPECT_WARNINGS STAYS 328, MEASURED ON A FULL `MSBUILDDISABLENODEREUSE=1 dotnet build -t:Rebuild`
# AFTER THE CHANGE — `Build succeeded.`, `0 Error(s)`, `328 Warning(s)`, 15/15 compilations. THE FIRST
# ATTEMPT WAS DISCARDED AND THE REASON IS THE ONE THIS FILE ALREADY DOCUMENTS: it returned 14 errors, all
# CS2001 for missing `*.g.cs`, all attributed to `St4iMachineSimulator_2whtdmpd_wpftmp.csproj` — the WPF
# markup race the build-phase note above names, with the VS Code C# Dev Kit build host resident on this
# workspace throughout (eight dotnet.exe, all parented to Microsoft.VisualStudio.Code.ServiceHost, a
# population sampled TWICE ~25 s apart and identical both times). The second attempt was clean. The
# change adds no public member to St4i.EdgeCore — the two new members are `private static` — so no CS1591
# was available to move, and Mapping/'s residue of zero is unchanged. EXPECT_WARNING_LEDGER stays at its
# sixteen rows unmoved unit for unit. EXPECT_BUILD_NODES stays 0. No suppression of any kind was added —
# no NoWarn, no #pragma, no .editorconfig severity — and SuppressionCensusTests' three tables are
# untouched.
# ══════════════════════════════════════════════════════════════════════════════════════════════════════
#
# 🔴 AR-1 (owner-decisions.md items 18/19/20/22/23/24, 2026-08-21) MOVES EXPECT_EDGECORE 1168 -> 1171 (+3)
# and EXPECT_ENGINEAPI 1374 -> 1378 (+4). Grand total 2779 -> 2786. EXPECT_ABSTRACTIONS, EXPECT_CONFORMANCE
# and EXPECT_EDGESERVICE do not move. EVERY NUMBER HERE WAS READ OFF A RUN BEFORE IT WAS TYPED: EdgeCore
# `Passed! - Failed: 0, Passed: 1171, Total: 1171`, EngineApi `Passed! - Failed: 0, Passed: 1378,
# Total: 1378`, both from a --no-build run against a solution that had just built with 0 errors.
#
# EDGECORE, +3 NET, WHICH IS +4 AND -1 AND THE -1 IS THE ONE THAT NEEDS THE JUSTIFICATION:
#   + 4  tests/St4i.EdgeCore.Tests/Transport/TransportCoordinatorDisposalTests.cs (item 20) — the ordered
#        shutdown TransportCoordinator did not have. It disposed the LiveTransport it REPLACED and had no
#        path to dispose the one it still HELD. Disposal is observed through the real chain
#        (Dispose -> LiveTransport.Dispose -> St4iDeviceClient.Dispose -> HttpClient.Dispose -> handler),
#        not a proxy flag. CONTROL PAIR, RUN TO COMPLETION, NOT ASSUMED: with Dispose()'s BODY emptied and
#        its signature left in place, `Failed: 3, Passed: 1` — the three new-half tests go red and
#        RebuildLive_StillDisposesTheReplacedLiveTransport stays GREEN, which is what proves the pair
#        discriminates instead of just moving together. Restored, re-run, `Passed: 4`.
#   - 1  tests/St4i.EdgeCore.Tests/Uns/UnsNodeLifecycleTests.cs —
#        `PublishBirth_DeviceLevelDbirth_DoesNotResetTheNodeSequence` DELETED. It is the only test in the
#        tree that CALLED IUnsPublisher.PublishBirth rather than implementing it on a fake, and the owner
#        ruled that method removed (item 23). 🔴 THIS IS A DELETED REGRESSION GUARD, WHICH IS A COST: it
#        pinned the G2-3 fix for a DBIRTH that wrongly reset the edge node's Sparkplug sequence, with the
#        exact discriminating value (seq 2, where the pre-fix bug gave 1) rather than a loose non-zero
#        check. The loss is bounded rather than open only because the code path it guarded no longer
#        exists — nothing in this repository publishes a DBIRTH now — and the NBIRTH-must-reset guards in
#        the same file are untouched. A ceiling stated small would be worse than none: if a DBIRTH path is
#        ever reintroduced, this test must come back with it.
#
# ENGINEAPI, +4, all in tests/St4i.EngineApi.Tests/Auth/AuditWiringTests.cs (item 18) — the Demo gate now
# guards the FABRICATING TRANSPORT and not only the MODE. They live in that class because it owns the only
# factory in the suite that boots the real composition root with ST4I_DEMO_ENABLED set EITHER WAY, and
# because "a refused mutation writes no audit row" is that class's own subject.
#   🔴 THEY ARE TWO PAIRS, DELIBERATELY. Two assert the 400 with the gate DISABLED; two assert that the
#   outage scenario STILL APPLIES with the gate ENABLED and that a non-outage preset is unaffected with it
#   disabled. Without the second pair a build that simply deleted an intentional exhibition feature would
#   be green, which is the "a test green on both sides measures nothing" trap this session has paid for.
#   CONTROL PAIR, RUN TO COMPLETION: with both gate conditions short-circuited to false,
#   `Failed: 2, Passed: 3` — exactly the two DemoDisabled tests red, the two over-block guards and the
#   pre-existing ScenarioApply_AsEngineer_RecordsAppliedParams green. Restored, re-run, `Passed: 5`.
#   🔴 THE ROUTE SET IS TWO, NOT ONE, AND THE ITEM NAMED ONE. POST /v1/scenario is not the only way into
#   FleetCore.ApplyNetworkOutageLocked: the shipped "network-outage" PRESET reaches it through
#   POST /v1/scenario/preset carrying no networkOutage field at all. The gate keys off the RESOLVED
#   preset's own config rather than a preset name, so a future catalogue entry is covered without an edit.
#
# 🔴 EXPECT_WARNINGS STAYS 328, MEASURED ON A FULL `MSBUILDDISABLENODEREUSE=1 dotnet build -t:Rebuild`
# AFTER ALL SIX ITEMS: `0 Error(s)`, `328 Warning(s)`. That figure was NOT predicted before the run — the
# brief flagged that removing two DOCUMENTED public members (item 23) could move it, and the measured
# answer is that it does not: PublishBirth/PublishDeath both carried doc comments, so neither was
# generating a CS1591 that their removal could take away, and the three <see cref>s that pointed at them
# were rewritten to <c> in the same change so no CS1574 appeared either. EXPECT_BUILD_NODES stays 0. No
# suppression of any kind was added — no NoWarn, no #pragma, no .editorconfig severity change — and
# SuppressionCensusTests' tables are untouched.
# ══════════════════════════════════════════════════════════════════════════════════════════════════════
#
# 🔴 TASK AT-1 (.superpowers/sdd/items-16-27-ruled/task-1-brief.md) — OWNER ITEMS 16 AND 27, BOTH
# EXECUTED UNDER THE OWNER'S RULINGS OF 2026-08-22. Raises EXPECT_EDGECORE 1171 -> 1179 (+8). It is the
# ONLY suite total that moves; grand total 2796 -> 2804. Every figure below was MEASURED after the code
# was written, not predicted before it.
#
# +2 — tests/St4i.EdgeCore.Tests/Historian/OeeAggregateSnapshotUnderConcurrentWriterTests.cs (item 16).
#   One deferred transaction now wraps the four reads of SqliteHistorianStore.AggregateForOeeAsync, so its
#   two COUNT(*)s come from ONE snapshot. Both tests are WITNESSES with named counterfactuals, and both
#   counterfactuals were RUN TO COMPLETION AND REVERTED:
#     · ..._never_reports_more_good_than_total_while_a_writer_commits_concurrently — transaction removed
#       ⇒ RED 5/5, reporting real values (good=212 total=211 quality=1.004739). Restored ⇒ GREEN 8/8.
#     · ..._does_not_take_the_write_lock_a_concurrent_writer_needs — `deferred: true` swapped for the
#       parameterless BeginTransaction() ⇒ RED 5/5 ("a concurrent write waited 14977 ms behind"). The
#       parameterless overload issues BEGIN IMMEDIATE, i.e. a WRITE lock for a read-only method that sits
#       on three synchronous request paths. Restored ⇒ GREEN 8/8.
#   🔴 The fault is a RACE, so neither test is red by construction; the rates above are measured, not
#   assumed, and both tests assert a floor on the work they did so a starved run fails as inconclusive
#   rather than passing vacuously.
#
# +6 — tests/St4i.EdgeCore.Tests/Infrastructure/ApiTraceBodySeparateLaneTests.cs (item 27). The owner
#   ruled a SEPARATE lane for the request body: new record ApiTraceBody, new route GET /v1/inspector/bodies.
#   THREE CONTROL PAIRS, RUN TO COMPLETION AND REVERTED: adding an OPTIONAL `string? RequestBody = null`
#   member to ApiTraceEvent (compiles, breaks no caller) ⇒ the frozen-surface witness RED; restoring
#   `idempotencyKey` to the allowlist ⇒ TWO witnesses RED; removing the byte cap ⇒ the cap witness RED.
#   Restored ⇒ 6/6 green.
#   🔴 ApiTraceEvent, the WS /v1/inspector/stream frame and the two Export JSON files DO NOT MOVE A BYTE,
#   and the diff is the proof: ApiTraceEvent.cs, ApiInspector.tsx, inspector.ts, InspectorViewModel.cs,
#   ApiInspectorView.xaml and TraceTable.tsx have ZERO changed lines in this task.
#
# 🔴 EXPECT_ENGINEAPI DOES NOT MOVE, AND THAT IS A MEASUREMENT RATHER THAN AN OMISSION. The new route is
# registered in RbacPolicyTests.ExpectedRoutes, which is a DATA ARRAY and not a [Fact] — the suite still
# holds 1388 tests. That array is exactly the guard that caught the new endpoint: adding the route without
# it turned EveryV1Route_CarriesExactlyTheExpectedPolicyOrAnonymous red with "Expected: 106, Actual: 107",
# which is the matrix working as designed. /v1/inspector/bodies is Engineer — it can never be weaker than
# /v1/inspector/stream, because that route carries trace METADATA and this one carries a view of the BODY.
#
# 🔴 EXPECT_WARNINGS STAYS 328, MEASURED ON A FULL `MSBUILDDISABLENODEREUSE=1 dotnet build -t:Rebuild`
# AFTER BOTH ITEMS: `0 Error(s)`, `328 Warning(s)`, no MSB3061. It was NOT written before it was measured.
# The first draft of this change DID move it, to 335: adding one <param> tag to the previously
# param-tag-free ApplyRealPresenceGateAsync raised five CS1573s (documenting one parameter obliges you to
# document them all), and the new EventBus.Publish overload made two existing <see cref="Publish"/> tags
# ambiguous (CS0419). Both were FIXED AT SOURCE — the five missing <param> tags were written, the two
# crefs disambiguated to Publish(ApiTraceEvent) — and NOT re-baselined. EXPECT_BUILD_NODES stays 0. No
# suppression of any kind was added: no NoWarn, no #pragma, no .editorconfig severity change, and
# SuppressionCensusTests' tables are untouched.
# ══════════════════════════════════════════════════════════════════════════════════════════════════════
EXPECT_EDGECORE=1179
# 🔴 Task E-4 (docs/plans/2026-08-04-dotE-fleet-core-extraction-blueprint.md §12) raises EXPECT_EDGESERVICE
# 45 -> 46 (+1) and EXPECT_ENGINEAPI 1283 -> 1289 (+6). Grand total 2581 -> 2588. Per file, and nothing is
# rewritten, split or deleted:
#
#   +1  tests/St4i.EdgeService.Tests/EdgeServiceSerialReachabilityTests.cs   (NEW FILE) — the census rule
#       "every claim of the form 'only X can do Y' gets a test", applied to README §23.6's "Only
#       St4i.EngineApi can open a COM port." That sentence is false as a CAPABILITY claim and has been since
#       D-7c itself, which is what gave all three hosts the ProjectReference: SerialPortBusLink.OpenAsync and
#       SerialLineSettings are public on St4i.EdgeCore.Serial. This test performs a real open from
#       St4i.EdgeService.Tests — whose ONLY ProjectReference is St4i.EdgeService, so naming the type compiles
#       solely because it is reachable through THAT host's reference graph — and the open is refused by the
#       OPERATING SYSTEM (SerialPortUnavailableException, "NOT PRESENT" wording, non-null InnerException),
#       not by the compiler. Deterministic on a machine with no RS-485 hardware: the port name is DERIVED
#       from SerialPort.GetPortNames() the same way SerialPortBusLinkTests derives its own, never hardcoded.
#       The TRUE statement — only St4i.EngineApi has a CONFIGURED path from connectors.json to a serial open
#       — is README §24.5, and its other half is already pinned by E-3's
#       EdgeWorkerConnectorsTests.AnRtuBusEntry_IsRefusedByName_…, so no test is added for it here.
#
#   +6  tests/St4i.EngineApi.Tests/MachineWriteUnavailableMessageTests.cs   (NEW FILE) — the four
#       operator-facing "this write was never attempted" explanations, asserted BY CONTENT on every path
#       that produces them. They had never been asserted at all: every existing test checked the STATUS and
#       the REASON CODE, and the closest any came to the message was
#       Assert.False(string.IsNullOrWhiteSpace(body.Error)), which is true of the wrong string too. Three of
#       the four had drifted into stating something false — each presupposed a connector exists, so none was
#       true for a machine with no connector configured, nor for a machine a St4i.EdgeService edge agent
#       holds (blueprint §12 / README §24.4). One of the six is the COLLAPSE witness (pairwise-distinct, so
#       a single generic "not available" string cannot satisfy the other five individually); one is the
#       throwing default for MachineDriverAvailability.Writable, which is also what makes a future enum
#       member with no arm a red test rather than a soothing sentence.
#
# EXPECT_ABSTRACTIONS, EXPECT_CONFORMANCE and EXPECT_EDGECORE are deliberately UNCHANGED. E-4 touches three
# production files, all in St4i.EngineApi (MachineWriteGate, MachineWriteEndpoints, RelayNotificationChannel)
# — a movement in any of the other three suites would mean this task reached somewhere it had no business
# reaching. EXPECT_CONFORMANCE in particular stays 22: E-4 adds no driver and no connector kind.
#
# 🔴 And the four assertions that carry E-4's fix are DELIBERATELY NOT new tests — they replace vacuous
# assertions inside tests that already reached the right states, so they move NO count: the four
# not-available cases in MachineWriteEndpointsTests now assert the HTTP body equals
# MachineWriteGate.ExplainUnavailable(...), and RelayNotificationChannelTests'
# TheFourUnavailableCases_AreDistinguished_AndNoneIsCollapsed now asserts the operator WARNING carries the
# same text. Those two files are the join: the new file proves the text is right, and these prove the two
# surfaces that render it actually use it. A count that did not move is the evidence that the states were
# already covered and only the assertion was empty.
# 🔴 TASK F-1 raises EXPECT_EDGESERVICE 49 -> 50 (+1), counted from the runner. ONE file, ONE test; nothing
# rewritten, split or deleted.
#
#   +1  EdgeWorkerConnectorsTests.AGatewayBus_WarnsThatNothingEnforcesOneHostPerSegment_AndASerialBusDoesNot
#       — the one-host-per-segment constraint emitted by THIS host. It is not a copy of EngineApi's for
#       tidiness: this host is the one an operator adds SECOND, and a gateway accepts its connection whether
#       or not the other host is already on the segment — no error, no log line on either side. Stated only
#       by EngineApi, the constraint would be stated only to the host that was already there. The serial arm
#       in the same file is the discriminator (a COM line must NOT get this notice; its operator meets the
#       rule at the OS's refusal instead). No socket is opened: TryCreate performs no I/O and the link is
#       dialled lazily inside the first transaction, so gw.example is never resolved.
#
# The OPC-UA refusal message in EdgeConnectors.cs is REWORDED by F-1 (the blocking condition — an unmade
# per-host data-root decision — is now made; the refusal stands because what remains is engineering) and
# AnOpcUaEntry_IsRefusedByName_… is unchanged and still green: it asserts the refusal and the word
# "opcua-pki", both of which survive deliberately. A moved count here would mean the reword changed behaviour.
# 🔴 Task K-1 raises this 50 -> 51 (+1): the one linked hygiene [Fact] every suite gets. Full
# justification beside EXPECT_ABSTRACTIONS at the top of this file.
# 🔴 Task X-1 raises this 51 -> 52 (+1): the one linked OwnOutputDirectoryGuard [Fact] every suite gets.
# Full justification beside EXPECT_ABSTRACTIONS at the top of this file. This suite writes nothing beside
# its binary today, and the guard is here anyway for the reason K-1's is — a guard installed only where a
# leak has already been paid for is a guard that arrives one incident late.
EXPECT_EDGESERVICE=52
# Task C-7 raised this from 1087 to 1122 across two rounds.
#   +29 in the implementation round:
#     +24  NotificationEndpointsTests    (new file — the eleven notification routes)
#     + 2  RbacPolicyTests               (the relay Admin gate end to end; the reads not being Operator)
#     + 2  AlarmAnnunciationStreamTests  (the SSE subscriber cap's 503; the shipped cap's value)
#     + 1  LocalAnnunciationChannelTests (the hub-level subscriber cap)
#   + 6 in the review round, all NotificationEndpointsTests:
#     + 2  I-1  a failed credential write must not answer 200 (webhook, smtp)
#     + 1  I-2  webhook instance cardinality is capped
#     + 1  I-4  the limiter RECOVERS — the previous test could not tell a bound from a wall
#     + 1  M-3  hub gauges survive a degraded host
#     + 1  M-5  the SMTP send test's bound is measured, not inherited
# No other suite is touched: C-7 adds no code outside St4i.EngineApi.
#
# Task C-8 raised this from 1122 to 1131 (+9), all in St4i.EngineApi.Tests:
#   + 3  NotificationEndpointsTests   — GET /v1/notifications/annunciator, the new Operator-tier route:
#          the payload carries NO channel configuration (with the Engineer route as the control);
#          a failed config read is distinguishable from "nothing configured" ON THIS ROUTE;
#          a host with no configuration store still answers and says nothing is running.
#   + 6  NotificationDocumentationTests (new file) — the census, as a test rather than as a claim in a
#          report: the retired "alarms cannot reach anyone" claim is not asserted in EN or VI; the
#          Alarms/ file-count claim is not present-tense (and the folder is measured); the retired
#          "additive and default-off" claim is not restated; the honest limitations are stated in both
#          languages; ST4I_NOTIFICATIONS_DIR is documented AND purged by remove-data.ps1; and
#          docs/ALARM_WEBHOOK_CONTRACT.md's load-bearing UNSIGNED/read-the-body text is intact.
#          (This is the doc-drift guard C-7's §11.2 note 14 recommended and declined to build; the
#          working-directory objection is answered by walking up from AppContext.BaseDirectory, the
#          idiom PackagingFleetJsonTests already uses.)
# RbacPolicyTests' ExpectedRoutes goes 105 -> 106 for the new route but adds no test.
#
# C-8's review round 1 raised it again, 1131 -> 1133 (+2), both NotificationDocumentationTests:
#   + 1  I-1  EveryDirectoryTheEngineCreatesUnderProgramData_IsPurgedByTheDecommissioningScript.
#            The engine creates THIRTEEN directories under %ProgramData%\ST4I\sim; remove-data.ps1
#            purged five, and two of the eight it missed hold credentials (`identity` is the device's
#            PFX private key sealed at LocalMachine scope; `connector-config` stores an OPC-UA password
#            in plaintext). The old test pinned the five-name list, freezing the gap as if closed — so
#            this one DERIVES the expected set by scanning src/ for each store's own default-path
#            constant, and a fourteenth MACHINE-WIDE store fails it until the script purges that too.
#            🔴 The qualifier was missing until the whole-branch review (C-2), and H-1c falsified the
#            sentence without it: MachineConfigStore is a fourteenth STORE, it arrived, and this census
#            stayed green — correctly, because it writes beside the binary and declares no
#            "ST4I","sim","<name>" constant. remove-data.ps1 does not purge it and is not meant to.
#   + 1  I-2  TheWebhookContract_DedupRecipe_NamesTheSignedBodyField_NeverTheUnsignedHeader.
#            The reviewer changed §3's numbered recipe to dedup on the UNSIGNED X-ST4I-Delivery header
#            and all six existing doc tests passed — C-3's defect reproduced, in the half of the
#            contract that was RIGHT last time and therefore unguarded.
# EXPECT_EDGECORE stays 735: I-4 fixes leaked TcpListener accepts in three ModbusTcpDriverWriteTests
# (and bounds two conformance accepts) but adds no test.
# No other suite is touched: C-8 adds no code outside St4i.EngineApi, web/ and docs.
#
# Đợt C CLOSEOUT ROUND raised this from 1133 to 1135 (+2), both AlarmStoreTests, both for I-4:
#   + 1  RaiseAsync_StillNeverThrows_WhenTheLogErrorDelegateItselfThrows
#   + 1  ClearAsync_StillNeverThrows_WhenTheLogErrorDelegateItselfThrows
#        AlarmStore's never-throws contract ended each of its two implementing catch blocks with an
#        UNGUARDED `_logError?.Invoke(...)` — a hole in the last statement of the handler written to close
#        it (NotifySafely wrapped the identical call in its own try/catch, so the two sites disagreed).
#        Program.cs binds logError to `sp.GetRequiredService<ILoggerFactory>()`, a service resolution on
#        the error path, which throws ObjectDisposedException once the root provider is disposed — i.e.
#        during shutdown, which is also when alarms.db is most likely failing. The twelve pre-existing
#        AlarmStore tests could NOT see it: their own logError delegate succeeds. Two tests rather than
#        one because the two catch blocks are separate statements and a fix applied to only one would
#        still pass a single test. Both die with ReportSafely's catch removed (verified by mutation).
#
# 🔴 EVERY OTHER SUITE IS UNCHANGED, and EXPECT_EDGECORE deliberately stays 735: the closeout round moves
# three ModbusTcpDriverWriteTests' teardown into a `finally` and rewrites three EngineApi tests' timing,
# but RESTRUCTURES them — it adds no test and deletes none. A moved total on any suite other than
# EngineApi would mean something unintended happened.
# chore/test-hygiene raised this 1135 -> 1136 (+1): a guard proving the Playwright harness really
# does isolate the creds directory. The config previously justified leaving it un-isolated with
# "this suite never calls anything that writes there" — FALSE: 613 of the 2,999 leaked blobs carry
# exactly the prefixes 04-onboarding.spec.ts mints, one per e2e run. A claim in a comment, believed
# because nobody measured it, is what kept this leak open.
#
# Task D-1 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-1-brief.md) raised this 1136 -> 1165
# (+29), all in St4i.EngineApi.Tests. D-1 moves connector identity from "the protocol kind" to "this
# connector instance"; every number below is a NEW test, none is a rewritten or split one, and no test was
# deleted:
#   + 9  ConnectorRegistryTests — instance identity at the unit level: two instances of ONE kind coexisting;
#          the derived default (omitting the id == naming the kind, the fact the whole migration rests on);
#          id normalization and blank-id fallback; and the four covering the MACHINE-CODE CLAIM, which is the
#          structural gate that makes MachineDriverAvailability.AmbiguousDriver unconstructible — a second
#          instance claiming a served machine is refused with nothing mutated, a claim differing only by
#          casing is still the same claim, an instance may keep its OWN claim across a reconfigure, and an
#          unbound instance blocks nobody. The ninth drives 20 threads through a Barrier at one machine code
#          and asserts exactly one winner (the claim is a CROSS-entry invariant that a ConcurrentDictionary's
#          per-key atomicity cannot supply).
#   + 5  ConnectorConfigStoreTests — migration v4 (kind PRIMARY KEY -> instance_id PRIMARY KEY, a table
#          rebuild). Three build a GENUINE version-3 database with raw SQL, in the old column ORDER, and
#          assert every row and every field survives with instance_id = kind. This is deliberately NOT how
#          the two pre-existing "MigratesExistingRowsToVersionN" tests work: those construct their "old"
#          database by calling THIS build's own constructor, which runs the ladder to the current version
#          first, so they can never exercise a migration FROM an older schema — a rung that dropped every row
#          would have passed both. Plus two rows of one kind being independently readable/deletable, and a
#          re-pin that ListAsync still never selects map_json (its SELECT list was edited by this task).
#   + 7  FleetHostConnectorInstanceRoutingTests (new file) — the routing proof. The non-negotiable: two
#          machines on two connector instances, a write for B reaching B's driver and ONLY B's (asserted as
#          driverA.WriteCallCount == 0, never as a status code); the same for the command path, which Đợt B
#          treats as the higher-risk member; each machine cycling off its own connector and not double-driven;
#          a machine claimed by an instance whose id is NOT its DriverKind still excluded from simulation;
#          Đợt B's exact ambiguity recipe now resolving instead of refusing, with zero I/O reaching the
#          unclaimed machine; every roster member enumerated and none landing on AmbiguousDriver; and
#          AmbiguousDriver still being returned AND still refusing a write through the one seam that can
#          still construct it.
#   + 5  ConnectorEndpointsTests — two same-kind connectors over the real HTTP surface (both save, both
#          visible, both in the roster, deleting one leaves the other); a second connector naming an
#          already-served machine refused; the no-instanceId request still configuring and deleting exactly as
#          before; both surviving a simulated restart with the live registry's bindings re-established; and
#          the env-var-configured Modbus AND OPC-UA connectors being bound to their maps' machines. That last
#          one required adding an opcUaEnvMapPath parameter to this file's own factory helper (additive,
#          default null): NO test in this repository had ever booted with ST4I_OPCUA_MAP set.
#   + 3  ConnectorEndpointsMachineClaimTests (new file) — the claim check at the handler level, because the
#          HTTP-level version of it could not fail: a machine a live connector serves is also a machine in the
#          roster, so the PRE-EXISTING cross-kind roster-collision guard answers one branch earlier. Proven by
#          mutation (the first draft passed with the claim check deleted). Calling the handler directly with a
#          registry claim that has no roster entry separates the two invariants; the discriminating assertion
#          is that the store is still EMPTY, since without the pre-check the row is written and only then
#          refused.
# RbacPolicyTests' ExpectedRoutes changes one STRING (/v1/connectors/{kind} -> /v1/connectors/{instanceId})
# and adds no test — the route count is unchanged, and the exact-count sweep passes in both directions.
#
# 🔴 EVERY OTHER SUITE IS UNCHANGED. D-1 adds no code outside St4i.EngineApi, and the four other totals below
# are deliberately untouched: a moved total on Abstractions, Conformance, EdgeCore or EdgeService would mean
# this task reached somewhere it had no business reaching.
#
# D-1's REVIEW-FIX round raised this again, 1165 -> 1181 (+16), all in St4i.EngineApi.Tests. Every one closes
# something the review found; none is a rewrite or a split:
#   + 6  ConnectorEndpointsMachineClaimTests — I-1 and m2. THREE for the rollback the review proved was
#          missing: the claim pre-check, SaveAsync and Register are not atomic, so two concurrent POSTs for
#          one machine both pass the pre-check and the loser wrote its row, was refused, and left that row
#          behind PERMANENTLY (persisted, listed in GET /v1/connectors/configured, refused again by
#          Program.cs on every boot, never in the roster) — exactly the state this endpoint's own SM-5
#          comment says must never be creatable. Two cover the compensation's arms deterministically
#          (delete when this request created the row; restore field-for-field, provenance included, when it
#          overwrote one) and one covers its never-throws contract with a cancelled token. A FOURTH proves
#          the compensation is actually WIRED, by producing the interleaving for real: 8 rounds x 16 racers.
#          It is probabilistic in what it KILLS and never in whether it passes (its invariant holds under
#          every interleaving), and the rate was MEASURED, not assumed — 1 round x 12 killed 3/10, the
#          shipped 8 x 16 killed 10/10. TWO more for m2: a 409 naming a claimant whose row is already gone
#          must say "restart", not "delete the connector you already deleted", with the still-configured
#          case as its control.
#   + 7  ConnectorsJsonRegistrationTests (new file) — I-3. The connectors.json -> registry dispatch had NEVER
#          been covered, before or after D-1, and D-1 added code to it: a mutation making every such
#          connector register UNBOUND left the whole suite green. It was untestable where it lived
#          (Program.cs reads connectors.json from AppContext.BaseDirectory, one shared artifact in this
#          assembly's output), so the loop moved verbatim to ConnectorsJsonRegistration — an extraction, NOT
#          a new ST4I_CONNECTORS_CONFIG knob, because a configuration surface added to serve a test is a
#          permanent commitment. Covers both dispatch arms separately (never one plus an inference that the
#          other "is the same code"), the machine binding, the deliberate non-adoption of the entry's own id,
#          an unparseable blob still registering but unbound, an undispatchable kind being skipped and never
#          registered, the claim gate from this path, and one bad entry not aborting the loop.
#   + 2  FleetHostConnectorInstanceRoutingTests — one for m3's snapshot lookup being case-INSENSITIVE like
#          every other machine-code comparison in the codebase (mutation-found: all existing routing tests
#          spelled the code identically on both sides, so a case-sensitive lookup survived); one recording a
#          hazard D-1 silently FIXES rather than leaving it to be rediscovered as a bug — a connector whose
#          map names a machine already in the roster as Simulated now leaves the simulated group, closing the
#          two-EdgePipelines-one-MachineState double-drive corruption GP-5 closed for third-party kinds.
#   + 1  ConnectorConfigStoreTests — m1: SaveAsync now folds the instance id through DriverKinds.Normalize
#          rather than a bare Trim(), matching the registry and the DELETE route. A row written as
#          instance_id = "modbus" was UNDELETABLE (the route normalizes to "Modbus", GetAsync misses, 404 for
#          a row the operator can see). Also pins that a third-party id stays case-SENSITIVE.
# No suite other than EngineApi is touched by this round either.
#
# D-1's RE-REVIEW round raised this 1181 -> 1184 (+3), all ConnectorEndpointsMachineClaimTests, all for I-A:
# the 409 returned on a failed live registration ASSERTED that a rollback had happened instead of checking.
# It said "its configuration was rolled back, so there is no leftover row to clean up" unconditionally —
# directly contradicting this suite's own CompensatingAFailedRegistration_NeverThrows_... test, which pins
# that a FAILED compensation leaves the row, and false in the direction that stops an operator looking.
# Guaranteed, not exotic: the compensation was handed the REQUEST's CancellationToken, so for any client
# that hung up the rollback threw at its first store call while the message claimed success.
#   + 2  the sentence's own three outcomes, now a pure extracted function (DescribeRollbackOutcome) because
#          the branch that produces it is only reachable under a concurrent registration — code a test
#          cannot reach is code nothing ever asks a consequence question about, which is exactly how the
#          contradictory wording shipped. One test for the failed-rollback arm (must point at
#          GET /v1/connectors/configured and must NOT claim "no leftover row"), one for the two success arms
#          NOT being interchangeable (a restored row still exists at that instance id).
#   + 1  both compensation arms driven through the store together, so a wrong sentence and a wrong rollback
#          cannot drift apart.
# The existing race test (ConcurrentSavesForOneMachine_...) additionally gained cancellation on half its
# racers, which is what makes the CancellationToken.None fix observable at all: an already-cancelled token
# cannot reach that branch through the handler, because the handler's FIRST store read takes the request
# token and throws long before it. Measured against the mutation that restores `ct`: KILLED 8/8 runs. That
# test's own count is unchanged.
#
# 🔴 TASK D-4 (multidrop) raises this 1184 -> 1190 (+6), counted from the runner. One new file,
# ModbusMultidropRegistrationTests — the REGISTRATION half of blueprint §7.1, which is the half that decides
# whether multidrop is safe. The map format alone does not: the same document can be registered two ways and
# only one preserves D-1's routing invariant, so this has to live where ConnectorRegistry and FleetHost do.
#   + 1  a three-device bus map fans out into three instances and a write for the middle one reaches ONLY its
#          device — the load-bearing assertion is the pair of ZEROES on its bus-mates, not the status code,
#          and the COMMAND path is driven in the same test because CommandRequest carries no machine code
#          either and "one fix, one sibling untouched" is this batch's most repeated defect.
#   + 1  each instance stores its OWN device's standalone document, asserted on what the registry handed the
#          FACTORY. A fan-out that stored the whole bus under three ids passes every count in the test above
#          and would then hand D-7's real factory a document declaring three machines — verbatim the
#          "one driver emitting N machine codes" shape §7.1 forbids.
#   + 1  every registered instance holds exactly ONE machine code and no code is held twice, enumerated over
#          the registry's own snapshot and resolved BACK per code.
#   + 1  a device whose machine another BUS already claims is skipped, NAMED (with the incumbent), and its
#          bus-mates still come up.
#   + 1  a malformed bus map registers nothing, logs, and does not throw — it runs inside startup wiring.
#   + 1  a LEGACY single-device map registers under the bus id ITSELF, so an existing connector keeps its
#          instance id, its slot label and therefore its alarm TargetId when a registration path starts
#          calling the fan-out. The discriminating assertion is the id, not the count.
# The fake factory in that suite builds its driver from the CONFIG IT IS HANDED (parsing the machine code out
# of the map) rather than from a lookup the test keeps — otherwise it would report the machine the test
# expects no matter what the registry stored, which is D-2's I-2 shape exactly.
#
# Nothing in Program.cs calls RegisterAll: the RTU connector factory is still D-7's, so no operator can turn
# multidrop on yet — the same posture D-2 and D-3 both shipped with and said so.
#
# 🔴 TASK D-7a raises this 1190 -> 1219 (+29), and the sentence directly above stops being true: Program.cs
# now calls ModbusMultidropRegistration.RegisterAll through ConnectorsJsonRegistration's RTU arm, so a
# connectors.json entry can declare a multidrop bus and an operator can turn it on. No file is rewritten,
# split or deleted, and NO NEW ROUTE IS ADDED — RbacPolicyTests.ExpectedRoutes is unchanged and its
# exact-count sweep still runs in both directions, which is why that suite's own total does not move.
#
#   + 7  ConnectorsJsonRegistrationTests (11 -> 18) — the deliverable. A three-device bus entry produces THREE
#          registered instances, each bound to its own machine, each building a real ModbusRtuDriver, all three
#          leasing ONE bus (asserted on the ModbusBusRegistry that enforces it, not on three drivers that
#          merely work); two RS-485 lines in one file are two buses, not a duplicate, with two bus keys and one
#          lease each; the registration-key rule is pinned as a discriminating pair (every pre-D-7a entry shape
#          still answers with its KIND, including one carrying an explicit id — the case that must NOT move,
#          because its slot label and therefore its alarm TargetId would fork); a bus in a host composed with
#          no ModbusBusRegistry is skipped rather than half-wired; a bus whose settings will not parse disables
#          THAT BUS and nothing else; and re-running registration after a device is deleted from the file
#          leaves no ghost.
#   + 7  ModbusMultidropRegistrationTests (12 -> 19) — D-4 review m5 and m6. m6: a removed device is
#          unregistered AND another connector can then claim its machine, which is the only way to prove a
#          CLAIM was released (the brief's own instruction: prove the ghost is gone, not that a method returned
#          true). A RE-ADDRESSED device (unit 2 -> unit 4) is the ordinary edit and is why removal runs BEFORE
#          registration. m5: a derived id already held by something serving a DIFFERENT machine is refused and
#          COUNTED as refused — the half D-4's review found broken. The sweep is proved not to touch a second
#          bus whose id SHARES A PREFIX, nor an ordinary connector. Plus: the factory is built once per bus
#          with the LARGEST device's hold (a bus built so those answers differ by 20x), and a bus that will not
#          parse never builds its factory at all, so a transport that would have been dialled for it is not.
#   + 7  ConnectorRegistryTests (24 -> 31) — the removal path itself: the claim is released (proved by another
#          instance taking it, after asserting the gate was real first), unknown/blank/null ids are ordinary
#          false answers ([Theory], 4 rows), removal uses the SAME DriverKinds.Normalize as everything else
#          (with the third-party half — "vendor.acme.weld" must NOT remove "Vendor.Acme.Weld"), and a
#          TryCreateDriver for an id removed after a snapshot is a visible failure rather than a throw. That
#          last one is the consequence question the old "this task never removes entries" comment let nobody
#          ask, asked.
#   + 6  ConnectorEndpointsMachineClaimTests (13 -> 19) — DELETE releases the live claim, so the 409 that used
#          to tell an operator to restart because a connector they had already deleted was "STILL RUNNING" is
#          gone. 🔴 AND ITS LIMIT, which a failing run corrected: FleetHost.RegisterMachine has no un-register
#          either, so with the machine in the ROSTER the replacement save is still refused — by the roster
#          guard. The first draft of that test asserted the optimistic version and went red. Both are now
#          pinned, and the DELETE response says the roster half in advance. Plus the reserved-instance-id 400
#          (the second door into the derived namespace) and its control [Theory] (3 rows) proving names that
#          are merely SIMILAR are still accepted.
#   + 2  ConnectorsConfigTests (30 -> 32) — ResolveEntries de-duplicates and applies env precedence on the
#          REGISTRATION KEY. Driven with a stand-in resolver so this suite states the RULE rather than
#          restating the production predicate; the real one is driven in ConnectorsJsonRegistrationTests. The
#          three pre-existing ResolveEntries tests are untouched and still pass with no resolver supplied,
#          which is the compatibility half.
#
# 🔴 TASK D-7c raises this 1219 -> 1226 (+7), all in ConnectorsJsonRegistrationTests (13 -> 20). This suite
# moves because the TRANSPORT SWITCH lives here and can live nowhere else: ModbusRtuBusSettings is in
# St4i.EdgeCore, SerialPortBusLink is in St4i.EdgeCore.Serial which references it, so the choice between them
# belongs to the composition root. No other EngineApi file gains or loses a test.
#
#   + 1  ASerialRtuBusEntry_FansOutToNInstances_AllSharingOneSerialBusBuiltFromItsLineParameters — THE
#          deliverable. Three devices on one declared COM port, each bound to its own machine, all on the
#          literal bus key "modbus-rtu-serial:COM7:19200:8:E:1" read off the DRIVERS' own ids (which embed the
#          bus key) rather than off the registry's bookkeeping. Plus the routing proof D-7a met, by enumeration.
#   + 1  OneOpenForNLeases_AndTheLastReleaseDisposes_ThroughTheSerialOpener — 3 leases, two releases leave the
#          bus alive, the third disposes it. Asserted with HasBus and not LeaseCount at the end, because
#          LeaseCount answers 0 for a key that never existed and therefore cannot tell "the last release
#          disposed it" from "it was never created" — on serial that difference is a COM port held to exit.
#   + 1  ASerialBusAndAGatewayBusInOneFile_AreTwoBusesOnTwoTransports — the switch is per ENTRY.
#   + 1  TwoSerialBusesNamingOnePortWithDifferentFraming_AreTwoBuses_NotOneSharedLine — CreateBusKey's rule
#          carried up to a file an operator writes, and the misconfiguration whose runtime symptom is the
#          held-port message (which is why that message names TWO holders).
#   + 1  ASerialBusWhoseAdapterIsNotThere_DegradesAndTellsTheOperatorWhichPort — 🔴 the only test in the batch
#          that makes the SERIAL OPENER actually run on the production path. Everything else observes the bus
#          KEY, which a switch could compute correctly while handing over the wrong opener — they are two
#          arguments. One real poll, through ModbusBus and ModbusRtuDriver's poll catch, to the ILogger the
#          composition root wired: no observer the mechanism does not itself need. Its first draft waited on
#          "a message naming the port" and passed INSTANTLY off the §9 hardware notice logged at registration,
#          reading Health as its initial Down; it now waits on the failed-poll line itself.
#   + 1  TheAutoDirectionControlLimit_IsLoggedOncePerSerialBus_AndNeverForAGatewayOrADeadBus — blueprint §9's
#          hardware limit said where an operator configuring a port will see it. The three NEGATIVE halves are
#          the discriminating ones: not for a gateway bus, not for a serial bus that registered nothing, and
#          exactly once for a bus of three devices.
#   + 1  TheEngineApisOwnIl_ReferencesTheSerialAssembly_… — the half SerialDependencyScopingTests cannot make,
#          because St4i.EdgeCore.Tests does not reference St4i.EngineApi and cannot load it. It distinguishes
#          "this deployment carries System.IO.Ports.dll" (true of all three hosts, and true of anything that
#          merely inherits a copied package asset) from "this host's own code can open a COM port". Asserted
#          for the ENGINE ONLY, deliberately: measured, St4i.EdgeService and St4iMachineSimulator have no
#          ConnectorRegistry, no IConnectorFactory and no connectors.json reader, so neither has IL that could
#          reference the serial assembly and asserting that it does would assert something false.
#
# 🔴 TASK D-7b raises this 1226 -> 1251 (+25). Counted from the runner (three `dotnet test --filter` runs,
# 14/6/5), not by hand — D-2's rule: a total that reconciles is not evidence that anybody knows where the
# tests are. Three NEW files; no pre-existing EngineApi test is added or removed. Two pre-existing assertions
# CHANGE VALUE without moving the count: ConnectorConfigStoreTests' two `Assert.Equal(4, ReadUserVersion(dir))`
# become 5, because the migration ladder grew a rung (bus_instance_id/bus_settings_json). They assert the
# ladder's CURRENT top rather than "the rung this test is about", which is what makes a v3 database opened by
# this build prove that the LAST rung ran too.
#
#   +14  ConnectorRtuBusEndpointTests           (new) — POST /v1/connectors creating a BUS, the first of the
#          two endpoint gaps D-7a deferred with an argument. 3 devices -> 3 store rows, 3 registry claims, 3
#          roster machines; the LINE projection through the endpoint for both transports; 🔴 the partial-
#          failure pair, which is the point — device 5 of 8 invalid and a third device colliding with an
#          existing claim BOTH leave zero rows, zero registrations and an unchanged roster, asserted on all
#          three surfaces rather than on a status code (a 400 that had already written seven rows satisfies a
#          status assertion); a re-save that DROPS a device losing exactly that row; a bus with no instanceId
#          and a bus named like a device position both refused; an ordinary Modbus TCP save proved to still
#          take the single-connector path; DELETE removing exactly one device of two with its sibling's claim
#          intact; the last device's delete saying the bus is gone; and B-3's save gate over a whole bus, whose
#          discriminating half is that re-pointing ONE device's register changes the required fingerprint.
#          🔴 The LAST TWO of the fourteen exist ONLY because a mutation survived, and both were reached by
#          attempting the counterexample on a DIFFERENT AXIS than the one the code was reasoned about
#          (blueprint §8.1, principle 1). The rollback branch was written for a concurrent registration,
#          which no test can stage — so deleting the rollback SURVIVED. The axis that reaches it is not
#          concurrency at all but the BUS'S OWN NAMESPACE: swapping two devices' machine codes between two
#          slave addresses passes the pre-check (every incumbent claim belongs to an id this bus is about to
#          re-register) and is then refused by Register itself, deterministically, after the store has been
#          written. ABusSaveThatFailsToRegister_… kills the store half; a SECOND mutation (leave the partial
#          registrations behind) then survived THAT, because in a two-device swap the first device is the one
#          that fails and nothing is registered yet to undo — so ABusSaveThatFailsPartWayThrough_… moves the
#          swap to units 2 and 3 of three, putting one success ahead of the refusal. Its assertion is the
#          DOCUMENTED LIMIT (the re-registered id ends up registered by nothing, because Register is
#          last-write-wins and the incumbent entry was destroyed at the moment of success), not an optimistic
#          one — asserting that the previous binding came back would assert something false.
#   + 6  ConnectorConfigStoreBusProjectionTests (new) — 🔴 the store BOUNDARY, where the SummaryColumns/
#          FullColumns split actually lives and where D-7c said D-7a's projection decision had to be asserted:
#          portName in `host`, NULL in `port`, through BOTH projections. The credential-free projection is
#          proved to carry neither the bus document nor the map — by putting a recognisable sentinel in each
#          and serializing the whole returned summary, which is a statement about the SQL rather than about a
#          C# type's property list. Plus: a bus save replaces its whole row set; a restore puts the exact
#          previous set back INCLUDING created_at (without the explicit @created_at parameter this is the one
#          that fails, and it fails in the direction that rewrites history); an empty restore is a pure delete;
#          a bus save leaves a connector whose id merely SHARES A PREFIX alone; and a pre-D-7b row reads back
#          with no bus at all.
#   + 5  ConnectorConfigVisibilitySeederBusTests (new) — the second endpoint gap: GET /v1/connectors/configured
#          now seeds an RTU bus, removing D-7a's explicit Program.cs skip. N rows one per device, tagged
#          Seeded, carrying the line; a re-seed LOSING a device the operator deleted from connectors.json (an
#          insert-only seeder leaves a row for a device that is not on the wire); 🔴 a bus with ANY operator-
#          owned row skipped WHOLE and warned about, because half a seeded bus is worse than none; and two
#          never-throws arms (a malformed device, an unreadable transport) that seed nothing and warn naming
#          the offending element.
#
# 🔴 D-7b FIX ROUND 1 raises this 1251 -> 1265 (+14). Counted from the runner (18/10/6/5), not by hand.
#   + 4  ConnectorRtuBusEndpointTests (14 -> 18) — review I-1 and I-2, and the count moves for a reason worth
#          reading: TWO tests were REPLACED rather than added to. The rollback pair I built last round drove a
#          device SWAP, and I-2's fix makes that swap SUCCEED — re-addressing two devices on a line was a
#          permanent DEAD END (the registry kept the old claims, so the identical retry failed identically,
#          forever, and the refusal named a cause that had not happened). So those two became
#          TwoDevicesTradingSlaveAddresses_… (the save works, and a write for the moved machine resolves to
#          its NEW unit) and ADeviceDroppedFromTheMap_LosesItsMachineClaimToo_… (the endpoint half of D-4's
#          own m6 ghost). Net +4 is those two plus I-1's three: the failed-save SENTENCE is now a pure
#          function (DescribeBusRollbackOutcome) driven over every combination, because the version it
#          replaces told an operator their live registry had been destroyed on a path where nothing was
#          touched — a [Theory] of 2 rows pinning that false half, plus the released-count arm and the
#          failed-rollback arm.
#   +10  RtuBusRegistrationTests (new) — 🔴 where the rollback is provable now that I-2 removed the only
#          deterministic path to it through the endpoint. Both halves of the undo driven directly against an
#          OUTSIDE claim (one success ahead of the refusal, taken back), the IncumbentsReleased count I-1's
#          message branches on (0 on a first save, 2 on a re-save), the proof that a release touches this
#          bus's namespace and nothing else (`line1-spare` and `line2:unit1` both survive — a bare-prefix
#          rule would take the first), and a 7-row [Theory] stating the namespace rule itself, since
#          TryFindBlockedDevice's exemption and ReleaseOwnNamespace's removal must be the SAME set or an edit
#          is refused that the register pass was about to make work.
#
# 🔴 D-7b FIX ROUND 2 raises this 1265 -> 1269 (+4), all in RtuBusRegistrationTests (10 -> 14). Counted from
# the runner (18/14/6/5). Review N-2: the shared bus-namespace predicate was OVER-BROAD — it asked only that
# an id start with "{bus}:unit" and end in digits, so bus `line1` claimed `line1:unitA:unit3`, which is a
# legitimate device of the DIFFERENT bus `line1:unitA` (a legal name: ValidateBusInstanceId reserves only an
# all-DIGIT suffix). Saving `line1` released that device's machine claim while its driver kept polling.
#
#     + 3  three rows added to TheBusNamespaceRule_… — the falsifying row the reviewer supplied
#            (`line1` vs `line1:unitA:unit3` = false), its mirror (`line1:unitA` vs the same id = true, so the
#            fix does not simply narrow the rule into uselessness), and a same-length/different-prefix row
#            (`abcde` vs `xyzab:unit3`) proving the new position check did not REPLACE the prefix check. The
#            theory was named `…AndNothingElse` while omitting the row that falsified it, which is what let a
#            doc call the property "a guarantee rather than a hope".
#     + 1  SavingOneBus_NeverReleasesADeviceOfADifferentBusWhoseNameSharesItsPrefix — the same defect at its
#            CONSEQUENCE on the production path rather than at the predicate: a registered device of bus
#            `line1:unitA` survives a save of bus `line1`, with IncumbentsReleased == 0.
#
# No test is added for N-3 (SweepGhosts now calls the shared predicate instead of its own inline copy) and
# that is deliberate: ModbusMultidropRegistrationTests already owns that behaviour and its
# TheGhostSweep_NeverTouchesAnotherBusOrAnOrdinaryConnector is what a redirection must not break — verified
# by mutation (making the sweep ignore the namespace kills 2 of its 13). A redirection that moved the total
# there would mean it was not behaviour-preserving.
#
# 🔴 WHOLE-BRANCH REVIEW, I-1 raises this 1269 -> 1272 (+3), all in ConnectorRtuBusEndpointTests (18 -> 21).
# Counted from the runner (21/14/6/5). The bus-device DELETE branch selected on BusInstanceId alone and never
# consulted Source, so for a bus declared in connectors.json — the PRIMARY way an RS-485 line is declared —
# it told the operator "the bus is no longer configured at all" while the seeder re-seeds that bus on every
# boot. One operator-facing string covering two producing paths, true of only one: the sixth instance of this
# batch's defect class #1, and the THIRD in that one file.
#
#     + 1  DeletingTheLastDeviceOfASEEDEDBus_SaysItComesBack_NeverThatTheBusIsGone — driven through the REAL
#            seeder and the real endpoint rather than a hand-written Seeded row, so the provenance under test
#            is the one production produces. Asserts the false sentence as an ABSENCE, because the defect was
#            not a missing caveat but an active assertion of the opposite.
#     + 1  DeletingTheLastDeviceOfAnOPERATORBus_StillSaysTheBusIsGone — the other arm, so the fix is a FORK
#            rather than a blanket caveat. Telling an operator their own deleted bus will come back is the
#            same defect pointing the other way.
#     + 1  TheRemedyForAnIncumbentConnector_DependsOnWhereThatConnectorCameFrom — I-1's SWEEP, not its
#            instance. "Remove that connector first (DELETE …)" is right for an Operator-owned incumbent and
#            WRONG for a Seeded one, which is re-created at every start, so the DELETE frees the machine only
#            until the next restart. A pure function, three arms; two of them are otherwise reachable only by
#            constructing a specific store state at a specific endpoint.
#
# 🔴 WHOLE-BRANCH REVIEW, LAST ITEM raises this 1272 -> 1276 (+4). Counted from the runner (23/16/6/5).
# TryFindBlockedDevice — the refusal an operator hits SAVING an RS-485 bus — still emitted "Remove that
# connector (DELETE …)" with no provenance fork, wrong the same way for a connectors.json-seeded incumbent
# (the DELETE frees the machine until the next restart and no longer). The sibling of the I-1 sweep, and the
# reason that sweep could not reach it is the finding: the grep was on `existing.Source`/`ConnectorConfigSource`,
# tokens that appear ONLY where the field is already in scope, and TryFindBlockedDevice takes bindings +
# roster and never the store — so `Source` could not have appeared in it under any circumstances.
#
#     + 2  ConnectorRtuBusEndpointTests (21 -> 23) — both arms at the endpoint, where the store is in scope:
#            a SEEDED incumbent is told to change the connectors.json entry (naming its bus) and is NOT told
#            to delete a row that comes back; an OPERATOR incumbent still gets the DELETE, which for it works.
#            The seeded one is driven through the REAL seeder.
#     + 2  RtuBusRegistrationTests (14 -> 16) — the seam: the refusal names the incumbent and the remedy is
#            ABSENT (a type that cannot see provenance must not ship a sentence that depends on it), and the
#            ROSTER arm hands out no incumbent and keeps its advice — nothing removes a machine from the
#            roster, so "use a different machine code" is true whatever wrote it. A sentence true without the
#            field beats a fork that cannot be built.
#
# 🔴 CARRIED FINDINGS (fix/carried-findings, task 1) raises this 1276 -> 1280 (+4). Counted from the runner
# (`dotnet test --list-tests`), not by hand. ONE file, four new tests; nothing rewritten, split or deleted.
# This line is the ONLY executable line the task changes in this script, per the standing rule.
#
#     + 4  NotificationEndpointsTests
#          + 1  TheWebhookSendTest_TellsARefusedDestinationFromASilentOne_AtTheProductionBound — the PAIR, both
#                 arms at the 5 s bound Program.cs actually constructs, because "distinguishable" is a claim
#                 about a pair and two arms at two configurations would not be one. Assert.NotEqual is the
#                 discriminator; the two Contains stop it passing on any two strings that merely differ.
#          + 1  TheWebhookSendTest_AtABoundBelowTheConnectPath_ReportsTheCauseAsUndetermined_NotAsABlackHole —
#                 the carried Important itself. A REFUSED destination at a 1 s bound lands in the TIMEOUT arm,
#                 and that arm no longer names the black-holing peer as the cause. Its lower bound on elapsed
#                 time is what makes it non-vacuous: it proves the two producing paths genuinely collapsed
#                 before asserting on the message the collapsed case produces.
#          + 1  TheEmailSendTest_NeverTellsAnOperatorARelayRefusedAMessageThatNeverReachedOne — the SWEEP's own
#                 find, in the sibling channel. SmtpNotificationChannel.Classify returns descriptions covering
#                 both "a relay decided something" and "nothing was ever reached", and BOTH callers wrapped
#                 every one of them in a sentence asserting the relay had acted. No grep could have found it:
#                 the distinguishing fact did not exist as a field anywhere to grep for. Classify now returns
#                 it.
#          + 1  TheEmailDispatch_ReportsAMessageThatNeverLeftThisMachine_AsNeverSENT_NotAsARelayRejection — the
#                 same find on the DISPATCH half, which an operator meets without pressing anything. Reachable
#                 and ordinary: SaveSmtpAsync requires a From address to be non-blank and not to PARSE, so a
#                 mistyped one throws FormatException out of Compose before a socket is opened — permanent,
#                 with no relay involved, and reported as a relay REJECTION until now.
#
# 🔴 THIS PARAGRAPH WAS TRUE WHEN WRITTEN AND STALE ONE COMMIT LATER, in the one file this project treats
# as the record. It said EXPECT_EDGECORE was "deliberately UNCHANGED ... staying 1071", and the fix round
# that followed added the harness-default pin above, taking it to 1072. The claim below is still true of
# the conformance work it describes — no test was added or removed BY THAT WORK — but a reader checking it
# against the constant finds 1072 and has no way to tell which half is wrong. Corrected rather than
# deleted, because the reasoning it carries is the evidence that the conformance fix cost nothing.
#
# EXPECT_ABSTRACTIONS, EXPECT_CONFORMANCE and EXPECT_EDGESERVICE are deliberately UNCHANGED, and
# EXPECT_EDGECORE moved by exactly +1 — the pin at :750, nothing else. That the CONFORMANCE half of this
# task moved it by ZERO is the check rather than a coincidence: the other half of this task fixes
# a conformance check that could not fail on the Modbus TCP and OPC-UA rigs, and it does so exactly as D-6 did
# for RTU — a `base`-CALLING override that raises ONLY that one check's own target bound, with an assertion
# that it genuinely strengthened before delegating. No shared-suite change, no test added or removed, four
# drivers' other checks untouched. Proven by re-running the mutation that removes `cts.Cancel()` from
# DeviceDriverConformanceSuite.cs so cancellation is never issued at all: it used to kill 2 of the 4 writable
# rigs and now kills 4 of 4.
#
# 🔴 THE REVIEW FIX ROUND raises this 1280 -> 1282 (+2), counted from the runner. ONE file; nothing is
# rewritten, split or deleted. Both close CRITICALS that are finding 1's own defect class reproduced INSIDE
# the fix for finding 1's class — which is blueprint §8.1 principle 3 landing on this task exactly as it
# landed on three people in Đợt D.
#
#     + 1  TheEmailSendTest_TellsARelayThatBrokeTheConversation_FromAHostThatNeverAnswered — C-2. The fix's
#            first shape answered "no relay was reached" for EVERY transport failure. A relay that greets,
#            reads EHLO and then RSTs is a transport failure in which a conversation demonstrably took place
#            and the RELAY ended it. MEASURED, and the measurement corrected this test's own first doc
#            comment: the refused port carries SocketException(ConnectionRefused), while the reset relay
#            carries a bare IOException with NO SocketException at all — so the pair is separated by the
#            classifier's no-socket-error FALLBACK, not by its socket-code switch. Mutation found that: the
#            switch could be mutated with this test still green.
#     + 1  TheEmailSendTest_TellsAMessageThatNeverLeftThisMachine_FromOneNoRelayAnswered — the Minor beneath
#            C-2. "Nothing was reached" and "nothing was SENT" are different facts wanting different advice: a
#            mistyped From address never opens a socket, so "check the host, the port and this machine's
#            route to it" is advice written for the other producing path. Three situations need three
#            sentences and a bool carries two, which is why the flag is now an enum.
#
# C-1 adds NO test and that is the check rather than an omission: it is closed by an assertion added to the
# EXISTING pair test (the credentials hint must not ride along on a "no SMTP conversation took place"
# sentence). One assertion of the same shape was written on the dispatch test and DELETED after mutation
# proved it could not fail — that path's exception yields no hint code, so it would have read as coverage of
# the composition defect while being incapable of detecting it.
# 🔴 Task E-2 (docs/plans/2026-08-04-dotE-fleet-core-extraction-blueprint.md) raises this 1282 -> 1283, and
# the SIZE of that delta is the point of the number rather than an inconvenience to it.
#
# E-2 extracted the N-driver lifecycle core out of St4i.EngineApi.Fleet.FleetHost into
# St4i.EdgeCore.Fleet.FleetCore — ~2 400 lines relocated, ConnectorRegistry/MachineState/SafetySnapshot
# moved with it, MachineState.cs and Dtos.cs split, 14 ILogger call sites re-expressed as EdgeCore callbacks,
# and FleetHost rewritten as a shell. Its brief made the gate the CHECK on that: "this is a move, not an
# addition — if a number moves, stop and report the reason before changing it."
#
#     THE MOVE ITSELF MOVED NOTHING. It was committed and run first, on its own, at exactly
#     151/22/1072/28/1282 = 2555, 0 errors, 116 warnings, 0 build nodes. That run is the evidence, and it is
#     why this constant could be left alone through the entire relocation.
#
# The +1 is the one test the SAME brief separately required, and it is irreducible to zero:
#
#     + 1  Safety/EstopLatchVisibilityRaceTests.Estop_RacedAgainstAContinuousWriteLoop_… — blueprint §9.3b's
#            racing test. Nothing in 2555 tests had ever raced Estop() against anything; every latch test was
#            sequential, so a latch write moved off FleetCore._gate was invisible. It guards a REAL,
#            PRE-EXISTING, previously-untested safety property (every guard evaluation beginning after
#            Estop() returns denies) and it says in its own header that it does NOT guard the cut — §9.3b
#            proved with two mutations that no racing test can, because EstopGuardRule reads EstopEngaged
#            alone. A new behaviour under test is a new [Fact]; folding it into an existing test to protect
#            this constant would have been the constant lying.
#
# The brief's other two mandated witnesses cost ZERO, deliberately, and that is not an accounting trick —
# §9.3b's own words are "any test that kills the hardcoded `true` is enough":
#
#     + 0  SafetySnapshot.IsRunning now has a witness: two assertions inside the EXISTING
#            RelayNotificationChannelTests.HaltLatched_TheBeaconDoesNotLight_… — already the batch's headline
#            safety test, with a latched/cleared pair to hang them on. §9.3b measured that a hardcoded `true`
#            in that field survived all 1282; it now fails.
#     + 0  The redaction property (FleetCore's write path emits ex.GetType().Name and NEVER ex.Message) now
#            has a witness: assertions inside the two EXISTING disposal-race tests in
#            FleetHostMachineDriverResolutionTests, plus a secret-shaped message on the test double so a leak
#            is legible. E-1 §4.5 measured that the ex.Message mutation left all 2555 green; it now fails on
#            both the setpoint and the command path.
# 🔴 Task E-4 raises this 1283 -> 1289 (+6). The whole justification is in the block above
# EXPECT_EDGESERVICE — one new file, MachineWriteUnavailableMessageTests.cs, and the four assertions that
# actually carry the fix cost 0 because they replaced vacuous ones inside tests that already existed.
#
# 🔴 E-4 REVIEW ROUND raises it once more, 1289 -> 1290 (+1), in ONE existing file. It is the only total
# that moves in that round; every other correction the review asked for is a comment or a doc sentence.
#
#   +1  tests/St4i.EngineApi.Tests/MachineWriteEndpointsTests.cs
#         Setpoint_FleetRunning_NoConnectorEverConfigured_409_NoLiveDriver_WithAllThreeOldCausesFalse
#       Review finding C3: the comment on the EXISTING NoLiveDriver test claimed that test's own scenario
#       "satisfies none of" the old string's three named causes. It does not — that test never calls
#       host.Start(), so "the fleet may be stopped" is exactly true of it. The claim was right about the
#       product and wrong about its witness, which is the same defect class one layer up, so it gets a
#       witness instead of a rewording: a Modbus-kind roster machine on a RUNNING fleet with no connector
#       ever configured, asserting all three old causes false AT the moment the 409 is produced
#       (host.IsRunning true, EstopEngaged false, GetConfiguredConnectorIssues empty) and then asserting
#       the body. Modbus-kind specifically because ResolveSlotLabelFor excludes Modbus/OPC-UA from the
#       simulated group unconditionally; a simulated-kind machine would report ReadOnly, the other case.
# 🔴 TASK F-1 raises EXPECT_ENGINEAPI 1290 -> 1293 (+3), counted from the runner. Two files; nothing
# rewritten, split or deleted.
#
#   +2  tests/St4i.EngineApi.Tests/PerHostDataRootsTests.cs (NEW FILE) — it lives in THIS suite, not in
#       EdgeCore's, because it is the THIRD scan-derived census test of the same set and the other two are
#       already here (NotificationDocumentationTests' decommissioning scan, TestHarnessIsolationTests'
#       Playwright scan). It also has to see EngineApi's own five stores, which St4i.EdgeCore.Tests cannot.
#         + 1  EveryMachineWideDirectory_IsRelocatable_ByADerivableEnvVarName — 🔴 THE FIFTH-STORE GUARD,
#              and the reason F-1 enumerated instead of trusting its brief. The brief named FOUR stores;
#              the enumeration found THIRTEEN. All thirteen were already relocatable, so this test is not
#              a fix — it is the thing that makes a FOURTEENTH MACHINE-WIDE store impossible to add without
#              a variable (H-1c's ST4I_MACHINE_CONFIG_DIR is a fourteenth store that this guard correctly
#              stayed green for, because it is not machine-wide — see the partition addendum below), which
#              is where this defect would actually have lived. Derives BOTH sets from src/ and requires the
#              variable NAME to be derivable from the directory name (ST4I_<NAME>_DIR), because that is the
#              rule README §15.9 tells an operator; requiring only "thirteen of each exist" would pass
#              while a directory and its variable named different things. Non-vacuity floors on both sets
#              plus five named controls, the same shape both siblings carry. The quantity it measures is
#              "a quoted ST4I_<NAME>_DIR literal exists in src/" — narrower than "relocatable", which is
#              why fix round 1 added the test below rather than letting README §15.9 lean on this one.
#              🔴 TASK H-1c CHANGED WHAT THIS COUNTS, AND IT IS A REPAIR, NOT A WEAKENING. It used to floor
#              on "every ST4I_*_DIR literal in src/", which was a true pairing while every such literal
#              named a %ProgramData% store. ST4I_MACHINE_CONFIG_DIR names a BESIDE-THE-BINARY store, so
#              the floor now applies to the MACHINE-WIDE half of the partition and the second half gets
#              its own guard (below). Leaving it alone would have turned "thirteen directories, thirteen
#              variables" into "thirteen and fourteen" with no artefact saying which number was which —
#              the count sentence would have gone false in a direction nobody chose, through an
#              instrument built for the other question. That is blueprint §8.1(f) exactly, which is why
#              H-1c repaired the instrument in the same change that made it necessary.
#         + 1  TheReadme_TellsAnOperatorThatRelocatingARootDoesNotMigrateTheOldData — §8.1's fourth census
#              tier: a rule stated to an OPERATOR is a different population of text from one stated to a
#              programmer. Relocating a root on a running deployment silently orphans that store's data,
#              and a host that cannot read its own saved credential looks exactly like one that was never
#              onboarded. Pins the three FACTS (the section exists, EN+VI both say nothing is migrated, the
#              credential consequence is named) and deliberately not the prose.
#
#   +1  ConnectorsJsonRegistrationTests.TheOneHostPerSegmentConstraint_IsLoggedOncePerGatewayBus_AndNever-
#       ForASerialOrADeadBus — the exact mirror of the file's own DE-limit test, and the mirroring is the
#       argument. Once per SEGMENT (three devices, one notice), never for a serial bus, never for a bus that
#       registered nothing. It also asserts the two load-bearing phrases reach the log ("NOTHING enforces
#       it", "NOBODY HAS MEASURED"), because a notice an operator reads as a promise is worse than none.
#
# The startup persisted-bus path (Program.cs) and the POST /v1/connectors save response also carry the new
# notice, and neither gains a test: both were already covered for LimitNotice by tests that assert the
# notice-carrying branch, and the new statement rides the identical branch. Recorded as a KNOWN GAP rather
# than claimed as covered — see task-1-report.md.
# 🔴 TASK F-1 FIX ROUND 1 (review I-4) raises EXPECT_ENGINEAPI 1293 -> 1294 (+1), counted from the runner.
# ONE file, ONE test; nothing rewritten, split or deleted.
#
#   +1  PerHostDataRootsTests.EveryRelocationVariable_IsActuallyREAD_NotMerelyDeclared — closes the
#       instrument/criterion gap the review named. The guard above measures "a quoted ST4I_<NAME>_DIR
#       literal appears somewhere in src/"; README §15.9 cited it for "there is no exception", i.e. that the
#       directory is RELOCATABLE. A fourteenth store declaring `const string EnvVarDir = "ST4I_FOO_DIR"` and
#       never reading it satisfied the first and violated the second — and neither M3 (no variable) nor M4
#       (non-derivable name) reaches that shape, so the gap was untested as well as undisclosed. The new
#       test requires every variable to reach a real Environment.GetEnvironmentVariable call, binding
#       constants to literals PER FILE so that the stores all naming their constant `EnvVarDir` cannot
#       vouch for each other (thirteen when this was written; FOURTEEN since H-1c added
#       MachineConfigStore.EnvVarDir, which is the BESIDE-THE-BINARY population — see the partition note
#       above), and resolving a qualified Type.Member against Type.cs. Two named controls, one
#       per resolution form: ST4I_HISTORIAN_DIR (read only as a bare literal, in Program.cs, not on its
#       store) and ST4I_CREDS_DIR (read only through a same-file constant).
#       🔴 What it still does NOT measure, disclosed here and in README §15.9 rather than left to a reader:
#       "declared and read at a resolution site" is not "the resolved value is honoured to a file". Nothing
#       here executes a store. A sweep that did would have to set every one of those process-wide variables inside a
#       suite whose other classes boot real hosts that read them — trading a documented narrowness for an
#       undocumented race.
#       🔴 WHERE THAT HALF ACTUALLY IS — and this note has been wrong twice, in opposite directions.
#       Fix round 2 removed an over-claim (SecurityEnvVarTests carries NO TEST; it is a
#       [CollectionDefinition] marker whose only member is a collection name). The branch review found the
#       replacement wrong as well, on both the instrument and opcua-pki:
#         * F-8, THE INSTRUMENT. This said the rows came from "counting the files under tests/ that name
#           each variable" — the very grep PerHostDataRootsTests explains cannot work, because every store
#           reads through its own constant. FleetSettingsStoreTests spells ST4I_SETTINGS_DIR ZERO times
#           while driving the seam through FleetSettingsStore.EnvVarDir; BridgeSpoolTests' only occurrence
#           of its literal is a doc comment. TWO instruments were used and one was named: (a) a literal
#           count over tests/, which gives the breadth, and (b) reading each candidate for a
#           SetEnvironmentVariable(<Store>.EnvVarDir, …) call, which gives the per-store rows.
#         * F-10, OPCUA-PKI. "Nothing measures it" was false. OpcUaDriver's ctor calls
#           OpcUaPkiPaths.ResolveRoot(pkiDir), and OpcUaDriverConformanceTests / OpcUaDriverLoopbackTests /
#           OpcUaDriverWriteTests each hand it a real temp root and let it write its app-instance
#           certificate there — the EXPLICIT-PATH arm of the same explicit > env > default chain. The true
#           residual: nothing exercises ST4I_OPCUA_PKI_DIR, the env var.
#       By (b): FOUR dedicated witnesses (creds, settings, wal, bridge-spool); EIGHT redirected
#       incidentally by host harnesses; opcua-pki covered on its explicit arm and not on its env arm.
#
# TheReadme_TellsAnOperator... does NOT move a count and its assertions changed: it used to require the
# phrase "not onboarded", and review C-2 showed the sentence beside it prescribed a remedy ("until it claims
# again") that St4i.EdgeService cannot perform. It now pins the ASYMMETRY — that §15.9 says the edge agent
# cannot claim — in both languages. Same test, different (and correct) subject.
# 🔴 DOT F BRANCH REVIEW (F-15) raises EXPECT_ENGINEAPI 1294 -> 1295 (+1), counted from the runner. ONE
# file, ONE test; nothing rewritten, split or deleted.
#
#   +1  PerHostDataRootsTests.TheNumberOfMachineWideDirectories_IsDerivedFromSource_AndAgreesWithEvery-
#       PlaceThatSpellsIt — the other guards in that file floor at `>= 13`, so a fourteenth MACHINE-WIDE
#       store that arrives WITH a variable passes them all while the word "thirteen" rots in six
#       artefacts. (🔴 Whole-branch review I-4: this said "the three guards" and was unqualified, eight
#       lines above the detail sentence fix round 2 DID qualify — the N5/N7 repair went into the .cs and
#       was not swept to its mirror here. The count was stale too: that file now holds five [Fact]s, two
#       of which sit above this one. Written without an ordinal so it cannot rot again.) It
#       derives the count from src/ and compares it against the number spelled in the two sentences that
#       state it as a rule: README §15.9's "There are **N** of them today" and remove-data.ps1's
#       .DESCRIPTION. Those two are each the authoritative sentence of their own artefact; the rest of the
#       prose repeats them.
#       🔴 MEASURED, not asserted (branch re-review, N-4). TWO mutations, because the first was not
#       discriminating and the report said it was. 🔴 BOTH are about a fourteenth MACHINE-WIDE store, and
#       that qualifier was missing until H-1c fix round 2 (re-review N6): a beside-the-binary fourteenth
#       store moves none of the three numbers below, which is the whole reason the populations were
#       split. A BARE fourteenth store (variable declared and read,
#       but no playwright env entry and no remove-data.ps1 purge entry) is killed by THREE tests — this
#       one plus the two SET-MEMBERSHIP censuses, TestHarnessIsolationTests and
#       NotificationDocumentationTests. A FULLY INTEGRATED fourteenth store (variable + playwright entry +
#       purge entry + parameter, with only the spelled count left alone) is killed by THIS TEST ALONE:
#       1 failed, 12 passed, both set-membership censuses green. That second shape is the gap F-15 named,
#       and it is the one that justifies the test existing.
#       🔴 WHAT THIS TEST REACHES, stated because the first version of this block overstated it (branch
#       re-review, N-2). It opens exactly two files besides src/: README.md and packaging/remove-data.ps1.
#       It never opens web/playwright.config.ts or this file. So it would NOT have caught the four
#       FOURTEENs the Dot F branch review found — at 709df245 the derived count was 13, README said
#       "thirteen" and remove-data.ps1 said "THIRTEEN", all three compared values agreed, and this test
#       would have been GREEN with every one of those defects in the tree. What it does do: it fires the
#       moment src/ and those two rule sentences diverge, and its failure message then names the other
#       artefacts by hand for a human to walk. The overstatement is recorded rather than deleted because
#       it was a claim in the VOICE OF A MEASUREMENT about the reach of the instrument built to end that
#       class, sitting in the binding per-file justification.
#       🔴 THIS IS THE MECHANICAL CHECK THE LEDGER'S §G.6 TRIGGER ASKED FOR, and the grep for
#       "every"/"all"/"no arm" was declined — but NOT for the reason first written here. That reason was
#       "a quantifier grep cannot decide whether a universal is true, so it answers a narrower question
#       than the criterion". It is wrong, and it would disqualify this count check too: a count does not
#       decide whether "thirteen" is TRUE either, it decides whether three artefacts AGREE. An instrument
#       answering a narrower question is a defect only when it is REPORTED as answering the criterion,
#       which is what F-8 was. The real reason to decline is RECALL: the grep keys on quantifier WORDS,
#       and this branch's worst false universal used none — "two uncoordinated frame sources on one
#       segment do not corrupt data" is a universal by generic plural, and so was its replacement. The
#       grep would have flagged neither, only the historical "every assertion …" / "no arm computes …"
#       pair that the prose trigger already covers. Bounded recall on a sub-class already covered, versus
#       a count check whose class has produced four real defects in one branch.
# 🔴 TASK G-1 (.superpowers/sdd/gate-and-log-channel/task-1-brief.md) raises this 1295 -> 1300 (+5),
# COUNTED FROM THE RUNNER (`dotnet test --list-tests`: 1295 -> 1300), not by hand. TWO new files; nothing is
# rewritten, split or deleted. Per file:
#   FleetHostSeedNotificationOffGateTests            +2   NEW
#   FleetHostTeardownLogChannelTests                 +3   NEW
#
# WHY EACH TEST EXISTS, and why five is the number rather than "a suite":
#   - Two of the five are MEASUREMENTS of the same shape, against the two mechanisms G-1 took off
#     FleetCore._gate: a host callback is made deliberately slow, and a reader of `EstopEngaged` — the very
#     reader blueprint §9.2 timed at 12.35 ms, and the same lock Estop() takes — is timed while it runs.
#     That is §8.1's fifth rule applied ("measure the effect on the thing the mechanism protects, on the
#     production path, with no observer the mechanism does not itself need"), not a shape check on where a
#     call sits in a file. Both are MUTATION-PROVEN: putting the callback back inside `lock (_gate)` gives
#     2012.0 ms and 2011.7 ms against a 500 ms budget. Neither hangs under its mutant — the blocks are
#     bounded on purpose, so a mutant FAILS rather than looking like this script's trap 6.
#   - One pins the three invariants that moving a call out of a lock could have broken: exactly one
#     notification per seeded machine, in roster order, never before the machine is in the roster. It tests
#     what CHANGED, not what was kept.
#   - Two pin the third log channel end to end through the real FleetHost: the two teardown sites that are
#     deterministically reachable now arrive as Debug and NOT as Error. The negative is the half that
#     matters — "no Error on a best-effort teardown path" is the operator-facing claim, because under
#     AddWindowsService an Error there is a synchronous Windows Event Log write.
#
# EXPECT_ABSTRACTIONS, EXPECT_CONFORMANCE, EXPECT_EDGECORE and EXPECT_EDGESERVICE are deliberately
# UNCHANGED, and that is the check rather than a coincidence: G-1 touches exactly two product files
# (src/St4i.EdgeCore/Fleet/FleetCore.cs, src/St4i.EngineApi/Fleet/FleetHost.cs) and adds two test files in
# one suite. A total moving anywhere else would mean this task reached somewhere it had no business
# reaching. EXPECT_CONFORMANCE in particular stays 22: G-1 adds no driver and no connector kind.
# EXPECT_WARNINGS stays 116 — the new code adds no warning, and the third log channel adds a parameter to an
# internal ctor rather than an unused symbol.
#
# 🔴 G-1 REVIEW FIX ROUND raises this 1300 -> 1303 (+3), counted from the runner, ALL THREE in the existing
# FleetHostSeedNotificationOffGateTests. No file added, none rewritten, none deleted. The review's finding was
# that the invariant MOST at risk from the fix was the one LEAST tested — the two original tests are both
# single-threaded and both deliberately leave the fleet stopped, so the two properties that only
# record-then-drain could break had no witness at all, and neither gap was listed in the report's own "what is
# NOT proven" section, which is what made it a finding rather than a known gap.
#   ConcurrentRegistrations_NeverRunTwoSeedCallbacksAtOnce_AndDeliverInRosterOrder   +1
#       The seed-notify lock's actual job. Asserts MaxConcurrentCallbacks == 1 plus exactly-once and roster
#       order, with 8 threads released from a common start line and a dwell inside the callback.
#       🔴 This entry used to add "— order is a probabilistic witness, overlap is the property". The test's
#       own doc was corrected by MEASUREMENT after that (overlap is what kills the lock-removed mutant, 6 of
#       6; order is what catches an interleave at the DEQUEUE point, which produces zero overlap and is
#       invisible to the high-water mark — "do not trim either one"), and this line was not swept with it.
#       Corrected by G-2 under §8.1(c): the gate script is an operator-facing artifact describing the same
#       mechanism, and "probabilistic witness" is exactly the wording review N-1 flagged as inviting a
#       maintainer to delete the assertion that covers the schedule the other one cannot see.
#   RegisteringIntoARunningFleet_StillNotifiesExactlyOnce_AfterTheRestart            +1
#       The path that changed most: the drain moved past StopLocked + WaitAndDisposeOldPipeline +
#       StartLocked. Previously asserted nowhere.
#   WhenTheRestartThrows_TheSeedNotificationIsStillDelivered_NotStrandedInTheQueue   +1
#       The witness for review I-3, a REGRESSION G-1 introduced: the roster write commits under _gate and is
#       never rolled back, so a throw between it and the drain left a registered machine owing a notification
#       forever. Fixed with a try/finally; this test is what makes the finally falsifiable.
#
# EXPECT_ABSTRACTIONS, EXPECT_CONFORMANCE, EXPECT_EDGECORE and EXPECT_EDGESERVICE stay put, same check as
# above: the review round touches FleetCore.cs, FleetHost.cs, one test file, this script, one blueprint
# section and mutate-guard.sh's header. EXPECT_WARNINGS stays 116.
#
# 🔴 TASK G-2 (.superpowers/sdd/gate-and-log-channel/task-2-brief.md) raises this 1303 -> 1310 (+7), COUNTED
# FROM THE RUNNER (`dotnet test --list-tests`: 1303 -> 1310), not by hand. ONE new file; nothing is
# rewritten, split or deleted. Per file:
#   FleetHostGateCommitCompletionTests               +7   NEW
#
# G-2 closes the defect CLASS G-1 found one instance of: state committed while FleetCore._gate is held whose
# correctness depends on a step that runs after the lock is released.
#
# 🔴 SEVEN TESTS, and here is what the number actually reconciles to. The unit is a THROW SITE, not a member
# and not a (commit, completion) pair — a test can only witness one consequence of one throw. Five members
# appear below (S1 was closed by G-1; S6 was refused at the time of this block and was closed later by H-1a,
# from Program.cs and with its own test in another suite — see the "NOT COVERED BY THIS FILE" note below.
# Neither gets a test HERE):
#
#     S2 = 2   the in-lock IUnsPublisher seam, and the deferred-log flush
#     S3 = 2   the same two throw sites on the start path
#     S4 = 1   the throwing off-lock teardown (S4's second half is OPEN and gets no test)
#     S5 = 2   the scheduling, and the revert's own failure
#     S7 = 0   🔴 NONE OF ITS OWN — its assertion RIDES INSIDE S3's second test, which is why the per-test
#              block below attributes that one test to "S3 ... and S7"
#     ------
#     2+2+1+2+0 = 7
#
# 🔴 S7 = 0 IS THE LOAD-BEARING LINE AND IT WAS WRONG TWICE. The first version of this block derived seven
# from "one member per (commit, completion) pair", a rule that yields EIGHT. Its replacement said "three
# members need two tests and two need one" and printed "2+2+1+1+2 = 7" — both of which are EIGHT, over a list
# of seven, while the correct structure was stated eight lines below in this same file. Recorded rather than
# quietly fixed because of what it ASSERTS: a maintainer told S7 has a test of its own either hunts for one
# that does not exist, adds a redundant one, or concludes a CLOSED member is untested and reopens it. A wrong
# count is embarrassing; a wrong count that is actionable costs someone an afternoon.
#
# Per test:
#   Estop_WhenTheUnsSeamThrowsUnderTheGate_TheOldPipelineIsStillDisposed                        +1
#   Estop_WhenTheHostLoggerThrowsFlushingTheHaltPathLines_TheOldPipelineIsStillDisposed         +1
#       S2 — the halt path, the most serious member. The two tests are two different throw sites in the same
#       window, not one property twice: the first is the IUnsPublisher seam called with _gate held (the
#       enumeration's own P8); the second is the deferred-log flush that G-1 placed AS THE FIRST
#       STATEMENT of WaitAndDisposeOldPipeline, ahead of every disposal — a regression G-1 introduced into
#       the routine whose job is to release the pipeline. Each asserts the driver was disposed EXACTLY once,
#       so a fix that traded a lost teardown for a doubled one fails.
#   Start_WhenTheUnsSeamThrowsUnderTheGate_TheOrphanedConnectorDriverIsStillDisposed            +1
#   Start_WhenTheHostLoggerThrowsFlushingDeferredLines_TheOrphanIsDisposedAndTheRunEventRecorded +1
#       S3 (same two throw sites, on the start path — the leak here is the orphaned connector driver
#       "review fix round 2" exists to prevent) and S7 (the historian Start run event, a SECOND completion
#       owed by the same commit, which sits after the first). The second test is the one that caught a
#       defect in G-2's own first draft: a throw inside a `finally` abandons the rest of that same `finally`,
#       so the run event was still exposed until the two statements were nested.
#   ARestartWhoseTeardownThrows_StillRebuildsThePipeline_RatherThanLeavingTheFleetStopped       +1
#       S4's first half — the restart chokepoint's rebuild now survives a throwing off-lock teardown. S4's
#       SECOND half (StartLocked itself throwing) is reported OPEN and is asserted as such in the next test.
#   Burst_WhenApplyingTheBurstThrows_TheRevertIsStillScheduled                                  +1
#   Burst_WhenTheScheduledRevertItselfThrows_ItIsReported_NotDroppedOnAnUnobservedTask          +1
#       S5, and the one genuinely SILENT instance of S4. Review M-5 named only the Cancel half of Burst's
#       window; the larger half is ApplyScenario, reachable through the enumeration's P5. The second
#       test covers the revert task's own failure, which ran on an unobserved Task and was dropped by the
#       finalizer with nothing logged anywhere.
#
# NOT COVERED BY THIS FILE, said out loud rather than implied: S6 (UpdateSettings). 🔴 TASK H-1a CLOSED IT,
# but not here and not with a test in this class — the fix is in St4i.EngineApi/Program.cs (the startup
# replay is now guarded and logs at Error, with exactly ONE arm and no env-var fallback) and the persistence in
# FleetCore.UpdateSettings only THEN became unconditional. The order is the fix. Its coverage is
# StartupSettingsReplayHardeningTests (St4i.EngineApi.Tests, +2 — see EXPECT_ENGINEAPI's own block below),
# because the property that had to be measured is "a host replaying an unusable triple still comes up and
# says so", which is a HOST property and unreachable from a FleetCore-level test. S4's second half and S3's
# residual are still OPEN and still get no test; H-1a closed S6 alone and claims nothing about the others.
#
# 🔴 RUNTIME, disclosed HERE and not only in the task report (G-2 review, Minor 10). This CLASS takes ~8-9 s
# to run, and TWO tests are the reason: both Burst tests wait on the real BurstDuration (4 s, FleetCore.cs)
# because the property under test IS "a revert was scheduled". The other four "waits" are POLLS
# (PollTimeout 20 s, PollInterval 100 ms) that resolve in milliseconds on a healthy run — only their TIMEOUTS
# are long, which is what keeps a failure red rather than hung.
#
# 🔴 WHAT THIS DOES NOT SAY, corrected by the whole-branch review (m-3): it does NOT say the file adds ~8 s to
# every gate run. That earlier wording was INSPECTION IN THE VOICE OF A MEASUREMENT. There is no
# xunit.runner.json and no CollectionBehavior attribute anywhere under tests/, so xunit runs test CLASSES in
# parallel: the marginal wall clock this class adds to the assembly is at most ~8 s and is ZERO whenever it
# is not on the critical path. Nobody has measured which it is. The honest figure is per-class, above.
# If it ever needs to come down, the fix is making BurstDuration injectable — a production change nobody has
# asked for — NOT loosening a bound (§8's rule).
#
# 🔴 G-2 FIX ROUND 1 raises this 1310 -> 1314 (+4), counted from the runner, ALL FOUR in the existing
# FleetHostGateCommitCompletionTests. No file added, none rewritten, none deleted.
#   Estop_WhenTheUnsSeamThrowsUnderTheGate_TheHaltRunEventIsStillRecorded              +1
#   Stop_WhenTheUnsSeamThrowsUnderTheGate_TheStopRunEventIsStillRecorded               +1
#       Review C-1. Round 1 closed S2's teardown and left S2's OTHER completion — the halt run event —
#       exposed to the same throw site the member's own test injects. SqliteHistorianStore's OEE query opens
#       an interval on "Start" and closes it on "Stop"/"Estop", so a dropped halt event INFLATES availability.
#       Two tests, not one: Estop needed a new latched flag (an unconditional finally would record a halt
#       StopLocked never completed), Stop already had one.
#   Estop_WhenTheHostDebugLoggerThrowsOnOneSlot_EverySubsequentSlotIsStillDisposed     +1
#       Review I-3. DisposeOldSlots called the host _logDebug from INSIDE each per-slot catch — interleaved
#       with the disposals, not in front of them — so a throwing host logger stranded every later slot's
#       driver and CTS on the halt path. Two slots; the second one's disposal is the assertion. The same
#       shape was found by grep in DisposeOrphanedConnectorDrivers and fixed there too — and witnessed, not
#       argued from similarity:
#   Start_WhenTheHostDebugLoggerThrowsOnOneOrphan_EveryOtherOrphanIsStillDisposed     +1
#       The sibling. Two rejecting-but-leaking connector factories, both orphans faulting on dispose, both
#       disposal counts asserted — so the test does not depend on ConnectorRegistry.RegisteredIds
#       enumeration order. Added because "identical mechanism, no separate test" is exactly the reasoning
#       this project has been burned by; a fix nothing can turn red is a fix nobody has measured.
#
# 🔴 G-2 FIX ROUND 2 raises this 1314 -> 1315 (+1), counted from the runner. Same file; no file added,
# rewritten or deleted.
#   WhenAFaultingSlotsOwnErrorLogThrows_TheFaultIsStillRecordedInLastError            +1
#       Re-review NEW-1 — the THIRD instance of the same shape in FleetCore.cs, and the one two rounds of
#       sibling grepping could not reach: StartSlot's per-slot fault handler called the host _logError as its
#       FIRST statement, ahead of the under-_gate slot removal and the guarded disposal. A throwing host
#       logger abandoned the whole handler, and the sharp casualty is not the leak — LastError was never set,
#       so GET /v1/health reported HEALTHY on a faulted fleet, permanently. The assertion is LastError, not a
#       log line. Both earlier sweeps grepped `_logDebug` in a disposal LOOP; this is `_logError` in a fault
#       handler with no loop, which is why a grep on wording cannot find a shape.
#
# 🔴 RUNTIME, updated with the count: SIX of the twelve tests in this file now wait on something — two Burst
# tests on the real BurstDuration (4 s), three on a polled fire-and-forget historian write, and this one on a
# polled LastError. Still ~8-9 s for the file; the polls resolve in milliseconds on a healthy run and only
# their TIMEOUTS are long, which is what keeps a failure red rather than hung.
#
# EXPECT_ABSTRACTIONS, EXPECT_CONFORMANCE, EXPECT_EDGECORE and EXPECT_EDGESERVICE are deliberately UNCHANGED,
# and that is the check rather than a coincidence: G-2 touches exactly ONE product file
# (src/St4i.EdgeCore/Fleet/FleetCore.cs) and adds one test file in one suite. A total moving anywhere else
# would mean this task reached somewhere it had no business reaching. EXPECT_CONFORMANCE in particular stays
# 22: G-2 adds no driver and no connector kind. EXPECT_WARNINGS stays 116 — the new code adds no warning and
# the one signature change (DisposeOrphanedConnectorDrivers' parameter becoming nullable) is matched by a
# null guard at its head, so no CS86xx appears.
#
# 🔴 TASK H-1a raises this 1315 -> 1317 (+2), counted from the runner. ONE new file,
# StartupSettingsReplayHardeningTests.cs; no existing file rewritten or deleted.
#   AnUnactivatablePersistedTriple_StillBootsTheHost_AndReportsItAtErrorLevel        +1
#       The claim S6's closure rests on. A hand-edited fleet-settings.json with machineCode "" is replayed
#       into FleetHost.UpdateSettings before app.Run(); CredentialStore.Load throws at its first statement.
#       Before H-1a that took the whole service down at EVERY start. Asserts the host answers a REAL
#       request over the REAL pipeline (not merely that factory.Server did not throw) AND that the
#       operator-facing line came out at LogLevel.Error. The LEVEL is a separate assertion on purpose:
#       §10.4 — this product ships no appsettings.json, so a demotion to LogDebug emits NOTHING while every
#       text assertion stays green, and the capturing provider returns IsEnabled(_) => true precisely so a
#       demoted call is still captured and can be caught.
#   AFailedReplay_LeavesThePersistedTripleIntact_AndDoesNotLetTheEnvFloorWin        +1
#       🔴 REPLACED IN FIX ROUND 1. This slot used to hold
#       WhenThePersistedTripleFails_TheEnvironmentFloorIsReplayedInstead, which asserted that a failed
#       replay falls back to the env floor — the remedy exactly as it was SKETCHED, and a data-loss
#       defect once composed with H-1a's own unconditional persist: the fallback replay goes through
#       UpdateSettings, so it OVERWROTE the operator's fleet-settings.json with the floor. The fallback
#       is gone (Program.cs carries the full argument) and this test is its inverse: with a FULL env
#       floor differing from the file on all three fields, the file must still hold what the operator
#       wrote (read back through a separate FleetSettingsStore) AND GET /v1/settings must not report the
#       floor. Count unchanged at +1 — one test replaced by one test, not added.
#
# EXPECT_WARNINGS stays 116 for H-1a: the added code is one guarded call site plus a static local function
# in Program.cs (top-level statements already carry one, LogIfRegisterMachineCollided) and one new test
# file; no signature changes, no nullability changes, no new package.
#
# 🔴 TASK H-1c raises this 1317 -> 1318 (+1), counted from the runner. No new file; the test is added to
# PerHostDataRootsTests.cs, beside the three guards it partitions.
#   TheBesideTheBinaryStorePopulation_IsEnumerated_AndKeptDistinctFromTheThirteenMachineWideOnes   +1
#       The SECOND store population, made checkable. Two halves. (a) The ST4I_*_DIR set is partitioned on
#       whether the name is derivable from a declared %ProgramData% directory — both halves derived from
#       src/, neither a list — and the beside-the-binary half must be exactly ST4I_MACHINE_CONFIG_DIR.
#       (b) The STORES: every file under src/ that names any KNOWN ROUTE to the beside-the-binary root
#       is pinned as an exact map of repo-relative path -> CATEGORY. THIRTEEN paths, FOUR categories:
#       three population-two stores (MachineConfigStore, ProductConfigStore, SimulatedEcosystem), three
#       read-only artefacts (FleetCore/EdgeConnectors/FleetService — fleet.json, connectors.json,
#       mapping/*.json), four non-stores (App.xaml.cs's --capture dir, MainWindow.xaml.cs's per-USER
#       %LOCALAPPDATA%, Program.cs's wwwroot, ServiceInstallVerbs.cs's service binPath) and three
#       prose-only mentions. A fourteenth file entering the set fails until it is classified, and the
#       CATEGORY is enforced on the axis a text scan can decide: a prose-only entry must have every
#       occurrence on a /// line, every other category at least one that is not.
#       🔴 THIS BLOCK DESCRIBED A DELETED INSTRUMENT FOR TWO ROUNDS (whole-branch review C-1) — it still
#       said "co-occurs with Directory.CreateDirectory(", "exactly six", two categories, and "zero such
#       routes exist in src/ today". The conjunct was removed in fix round 1 (it was the unstated filter
#       that made a beside-binary writer with no CreateDirectory invisible) and the completeness claim was
#       WITHDRAWN in fix round 2, refuted by two live Environment.ProcessPath occurrences in
#       ServiceInstallVerbs.cs. What the test claims now is a MEASUREMENT, not completeness: these are
#       the routes that have been swept (AppContext.BaseDirectory, Environment.ProcessPath, and
#       MachineConfigStore.DefaultRoot/ResolveRoot — the public helper H-1c itself added, through which a
#       new store can reach the root without naming the token), six more measured at zero, and a seventh
#       idiom nobody has thought of is still invisible. This file is the one artefact the standing
#       constraints bind, and a maintainer reads THIS to decide whether the guard will see their store —
#       so a stale description here is worse than none.
#       It also repairs a FALSE COMPLETENESS CLAIM that F-1 shipped in this same file's class comment
#       ("the only place the product writes outside %ProgramData% is DesktopShell's %LOCALAPPDATA%"),
#       which was wrong the day it was written and is the §8.1(f) failure in its resting state: a sentence
#       that made a reader stop looking.
#
# EXPECT_WARNINGS stays 116 for H-1c: MachineConfigStore gains one const, two static methods and doc
# comments; every cref resolves (a CS1574 would move this number). No signature of any existing member
# changes — the constructor keeps `string? directory = null` and only its body's resolution changes.
#
# 🔴 TASK H-1a, SECOND PASS raises this 1318 -> 1319 (+1), added during the mutation round and for the
# reason the mutation round exists. No new file; added to FleetHostSettingsPersistenceTests.cs.
#   UpdateSettings_WhenActivationThrows_StillPersistsTheTripleItAlreadyCommitted        +1
#       🔴 S6's ACTUAL CLOSURE, which until this test nothing could turn red. The two
#       StartupSettingsReplayHardeningTests measure the HARDENING (the host comes up and says so); moving
#       FleetCore's `Save` back out of its `finally` left all five green, because the persisted file in
#       those tests already held the bad triple. A `finally` no mutation can kill proves nothing, which
#       is this repository's own stated rule. The throw site is real rather than injected
#       (CredentialStore.Load's ArgumentException.ThrowIfNullOrEmpty on an empty machine code, reachable
#       from PUT /v1/settings and from a hand-edited file), the persisted value is read back through a
#       SEPARATE store instance, and the REPORTED value is asserted alongside it so a build that rolled
#       the fields back — remedy (b), a different contract — fails here instead of looking like an
#       improvement. It also asserts the exception still propagates: H-1a did not swallow it.
#
# 🔴 FIX ROUND 2 (re-review N4) raises this 1319 -> 1320 (+1), counted from the runner. No new file; added
# to StartupSettingsReplayHardeningTests.cs.
#   TheStartupReplayHasExactlyOneArm_AndTheSettingsFileOneWriterAndOneDeleter          +1
#       "Exactly one writer of fleet-settings.json at startup" became the load-bearing premise of the
#       rationale at FleetCore.UpdateSettings when C1 was fixed, and it was true only by inspection.
#       🔴 AND THE INSTRUMENT THE RE-REVIEW PROPOSED WOULD NOT HAVE CAUGHT C1 — measured, not argued:
#       C1 added a second call to the startup REPLAY, not a second Save, and the replay persists as a
#       side effect of UpdateSettings, so a Save-call census returns ONE both before and after it.
#       Mutation R2 reinstates C1 and shows the Save-site count not moving. So the test asserts THREE
#       numbers and names which one carries which property: one Save call site (the weaker half, the one
#       that stays green through C1); one startup replay call site (the number C1 moved, 2 -> 3
#       occurrences of TryReplayStartupSettings in Program.cs); and — added by the I-3 fix below — one
#       DELETER call site, so the seed-rollback cannot grow a second one silently.
#       🔴 This block said "BOTH numbers" and listed two for one round after the third was added (branch
#       re-review I-4). No count moved when the deleter census landed, so no justification was owed and
#       none was written — which is exactly how a summary drifts from its list in the one artefact the
#       standing constraints bind. Same class as C-1, same file, one round later. Its stated non-reach is the shape a
#       source scan cannot see — a writer through a differently-named local — which is exactly what the
#       file-property regression witness above covers instead.
#
# 🔴 FIX ROUND 3 (whole-branch review I-3) raises this 1320 -> 1321 (+1), counted from the runner. No new
# file; added to StartupSettingsReplayHardeningTests.cs.
#   AFailedEnvFloorSeed_LeavesNoFile_SoTheEnvVarsStayTheFloor                          +1
#       C1's class on the arm that was KEPT. With no fleet-settings.json the replay SEEDS FleetCore from
#       the env floor; the unconditional persist that closed S6 then CREATES the file even when activation
#       throws, holding the floor merged with FleetHost's built-in defaults — and from the next boot that
#       file wins over the env vars, permanently, on the strength of a triple that never activated. Two of
#       the four consequences the branch enumerated against the DELETED fallback are properties of the
#       `finally`, not of the fallback, and they survived here. Program.cs now discards that seeded file
#       on that arm ONLY (a failed RESTORE never deletes anything — that would be C1 with a delete).
#       🔴 THE INJECTION IS THE INTERESTING PART, and it corrects the review: the WAL example the review
#       gives is NOT reachable at startup through an env var, because Program.cs calls wal.EnsureDir() on
#       the same env-derived options ~1550 lines earlier, unwrapped, so a bad ST4I_WAL_DIR stops the host
#       there and never reaches the replay. The test instead overrides the TransportCoordinator singleton
#       with a real one whose WalOptions.Directory points at an existing FILE — same throw, same call,
#       from options the early EnsureDir never saw. It asserts the host is UP and the file does not exist
#       ON DISK (not merely that Load() returns null, which is also true for a corrupt file).
#
# 🔴 TASK J-1 (.superpowers/sdd/restart-chokepoint/task-1-brief.md) raises EXPECT_ENGINEAPI 1321 -> 1328
# (+7), COUNTED FROM THE RUNNER (`dotnet test --list-tests`). ONE new file, nothing rewritten, split or
# deleted; the two other test files J-1 touches are prose-only corrections and contribute 0.
#   FleetHostStartBuildHoistTests.cs                                                    +7
#       The witnesses for hoisting the enumeration's P4 (MappingProfileResolver.Build -> File.Exists/
#       File.ReadAllText per machine, the 2.39 ms measurement) and P5 (SimulatorFactory.Create ->
#       MachineConfigStore.Ensure -> File.WriteAllText + File.Move, plus a second lock) out of
#       FleetCore.StartLocked and off _gate, the lock Estop() takes.
#       Two prove the work moved: the store's file is on disk AND _gate is grantable to ANOTHER THREAD at
#       the moment the build's last statement runs; and a mapping warning appears exactly ONCE, which is
#       what says the install consumed the plan instead of re-reading every mapping file under the lock.
#       Two prove the roster-changed-underneath window is EXCLUDED rather than tolerated: a machine
#       registered mid-build is CYCLING afterwards (not merely present in the roster — being present and
#       never driven is the silent outcome), and its own mapping profile is resolved by the install's
#       supplementary Build, which is what makes that arm live code rather than an unreachable branch.
#       Two are the HALT latch, and they are separate because the two checks are not equivalent: an Estop
#       landing DURING the build must still be refused by the check inside the lock (that is the guard),
#       and a Start made while already latched must not even build (that is the cheap pre-check in Start(),
#       an optimisation — deleting it wastes work, deleting the other opens a window on the safety path).
#       One is the SEVENTH, added DURING the mutation round because the round found it missing: the
#       multiplier a plan was built with is not recoverable from the descriptors it holds, because
#       MinCycleSeconds CLAMPS the pre-scaled CycleSeconds — so for a machine already at the floor two very
#       different multipliers give byte-identical descriptors and only StartPlan.Multiplier separates them.
#       Dropping that one check survived every other witness in this file. The new test drives the
#       config-derived cadence to the schema's slowest legal setting (0.2 + 3.6 + 5.0 = 8.8 s), so three
#       cycles take 0.15 s rebuilt and 26.4 s reused: the separation is structural, not a race against the
#       clock.
#
# EXPECT_ABSTRACTIONS, EXPECT_CONFORMANCE, EXPECT_EDGECORE and EXPECT_EDGESERVICE are deliberately
# UNCHANGED, and EXPECT_EDGECORE staying put is evidence rather than convenience: J-1 edits four files in
# St4i.EdgeCore (FleetCore, MappingProfileResolver, SimulatorFactory/SimulatorBase/IotSensorSim prose) and
# adds no behaviour that suite can see — every consequence of the hoist is observable only through a live
# FleetHost, which is why the witnesses live here. EXPECT_CONFORMANCE in particular stays 22: J-1 adds no
# driver and no connector kind, and deliberately does NOT move P7 (IConnectorFactory.TryCreate stays under
# _gate) — the conformance suite's own "construction is non-blocking because FleetCore.StartLocked
# constructs drivers under the same _gate lock Estop() takes" string is still TRUE after J-1 and was
# re-checked rather than assumed, precisely because it is a live assertion message in a contract assembly.
#
# 🔴 J-1 FIX ROUND 1 raises EXPECT_ENGINEAPI 1328 -> 1330 (+2). Same one file; nothing rewritten, split or
# deleted. Both are review I-1, which is a BEHAVIOUR fix and not a disclosure fix: J-1's hoist opened an
# interval inside Start() in which a concurrent Stop() was silently dropped (StopLocked returns on
# !_running, because the start has not installed yet), inverting a Start||Stop race that could previously
# end stopped. FleetCore now counts operator stop REQUESTS, and a start whose snapshot predates one
# abandons its install.
#   AStopLandingDuringTheHoistedBuild_WinsTheRace_TheStartIsAbandoned                   +1
#       The regression itself: Stop() from another thread inside the build window, then the fleet must be
#       NOT running afterwards. It also pins that the halt latch was not used to get there (EstopEngaged
#       stays false) — a stop must leave the fleet restartable, not latched.
#   AStopThatCompletedBeforeTheStartBegan_DoesNotCancelIt                               +1
#       The complement, and the reason the pair is not one test: a counter compared against the wrong
#       baseline would make every fleet permanently unstartable after its first Stop, and the test above
#       alone stays green on exactly that bug.
#
# Review Minor 6 (mappingKeys compared Code ordinally while MappingProfileResolver's map is
# OrdinalIgnoreCase) adds NO test and is stated as such: the disagreement is unreachable today because
# RegisterMachine's duplicate check is case-insensitive, so no test can construct the divergence without
# first breaking that check. The comparer is pinned anyway, because "unreachable by a property of another
# call site" is the sentence pattern this file's own banner exists to stop.
#
# 🔴 COUNTED FROM THE EXECUTED TOTAL, not from `--list-tests | grep -c`. The grep form ALSO matches the
# runner's own header line (it ends "...\St4i.EngineApi.Tests.dll", which contains the pattern), so it
# reports one more than the suite runs. That is §8.1(a3) in miniature — the instrument answers "lines
# matching a pattern in a listing" while the criterion this constant feeds is "tests executed" — and it was
# caught here by the two numbers disagreeing, not by re-reading the command.
#
# EXPECT_ABSTRACTIONS, EXPECT_CONFORMANCE, EXPECT_EDGECORE and EXPECT_EDGESERVICE remain unchanged: the fix
# round touches FleetCore, MachineState's doc comment and one test file, and adds no behaviour those suites
# can observe.
#
# 🔴 J-1 BRANCH-REVIEW ROUND raises EXPECT_ENGINEAPI 1330 -> 1332 (+2), counted from the EXECUTED total.
# Same one file. Both close the branch review's Critical: THE HALT LATCH HAD NO SURVIVING WITNESS.
# Fix round 1 made Estop() increment _stopRequests, so from that commit Start()'s abandon check returned
# before StartLocked ran and the test whose name claims to cover the latch was passing through the counter
# instead. MEASURED: mutation M1 (delete the latch) was re-run at the branch tip and SURVIVED all 1330
# tests. The behaviour was never wrong — Estop is refused either way — but the coverage claim was stale,
# and a stale coverage claim is worse than a gap because it stops the next person looking.
#   AnEstopLandingDuringARestartsRebuild_IsRefusedByTheLatchInsideTheLock                +1
#       The _estopEngaged arm. Reaches the latch because RebuildPipelineOffLock (the RegisterMachine/
#       ApplyScenario restart) reads no _stopRequests, so an Estop landing in that rebuild's build window
#       meets the latch and nothing else. (🔴 J-1b gave that method a pre-check too; this test still reaches
#       the latch because the check is read BEFORE the build and this Estop lands at the END of it — MEASURED
#       on the post-J-1b tree by re-running the whole latch mutation cluster, not argued. 🔴 Branch review
#       Minor 11 — AND THE VERDICT ITSELF BELONGS IN-TREE, not only in a gitignored report: re-running the
#       latch deletion at 1cbdc564 against St4i.EngineApi.Tests gives KILLED, 2 failures, and they are
#       exactly this test and the one below. Its session's positive control — `_running = true` -> `false`
#       in StartLocked, run against THE SAME SUITE — was KILLED at 91. That pair of numbers is what the
#       stale SURVIVED 1330 above is now superseded by, and §8.1(h) is the reason it is written here rather
#       than cited from somewhere a clone does not have.)
#   ASecondStartWinningTheRace_LeavesTheLoserRefusedByTheLatch_NotASecondSetOfSlots      +1
#       The IsRunning arm, still live on Start()'s own path because a racing Start moves no counter. The
#       assertion is the SLOT COUNT, not a flag: what the latch prevents is a second set of pipeline slots
#       over one roster, i.e. two simulated groups writing the same MachineState — the silent double-drive.
# M1 now kills both — and still kills both after J-1b (KILLED 2, at 1cbdc564, these same two tests, control
# KILLED 91 on the same suite). Neither witness was taken by the pre-check J-1b added upstream of the latch.
#
# 🔴 THE ROUND'S OTHER LESSON, recorded because it is about evidence rather than about code: M1's KILLED
# verdict in the task report was obtained BEFORE the mechanism it tested changed, and was cited afterwards
# as current. This project already records that an absence of failures is not evidence of a repair; this is
# the same error one layer up — a PRESENCE of a past failure cited as evidence of a present guard. A
# mutation result is only evidence for the tree it was run against.
#
# 🔴 TASK J-1b (brief at .superpowers/sdd/symmetric-precheck/task-1-brief.md — UNTRACKED/gitignored, cited
# for provenance only; every number below is justified here) raises EXPECT_ENGINEAPI 1332 -> 1334
# (+2), counted from the EXECUTED total. Same one file (FleetHostStartBuildHoistTests.cs); nothing rewritten,
# split or deleted. J-1b adds the pre-check J-1 left as an owner decision: RebuildPipelineOffLock now reads
# `IsRunning || _estopEngaged` under _gate BEFORE BuildStartPlan, symmetric with Start()'s.
#   AnEstopLandingInTheRestartTeardown_IsRefusedBeforeTheRebuildBuildsAnything           +1
#       The pre-check's own witness, and the only window it covers: an Estop landing in the restart's
#       TEARDOWN (the gap the caller's lock release opens, containing WaitAndDisposeOldPipeline's TWO bounded
#       waits per old slot — the run-task wait, then the driver's own third-party DisposeAsync, which IS the
#       second of the two and not a third component; 🔴 branch review Minor 6, this read as three). The seam
#       is the OLD driver's disposal — DriverDecoratorForTests on the pipeline that is already running —
#       which is the one place inside that gap a test can stand. Asserts the build-observation count is 0
#       (deleting the pre-check makes this red) AND that the machine registered by the triggering call has no
#       MachineConfigStore entry, in memory or on disk, which is P5's write not happening rather than a call
#       not being counted. End state on THIS path is unchanged (halted, not running, no slots), so here the
#       change is about work not done.
#       🔴 BRANCH REVIEW IMPORTANT 1 — this sentence used to end "…not about a different outcome", stated of
#       THE CHANGE rather than of this path, and that universal is FALSE: FleetCore's own block comment at
#       the pre-check names the one interleaving where the outcome differs (a flag set at the check and
#       cleared before the install — Estop then ResetEstop, or a racing Start then a Stop). A whole-branch
#       enumeration of two-read divergences found FOUR cases and exactly ONE differs: the pre-check either
#       passes (the latch then decides exactly as pre-J-1b) or refuses, and if it refuses the latch would
#       have refused too in two of the three refusing cases — halt landed in the teardown, racing Start
#       installed in the teardown — leaving only "flag set at the check, cleared before the install" as a
#       changed outcome. It is the whole family, not an instance of one, and it
#       is the owner's to ratify — which two shipped artifacts, this one included, said did not exist.
#   ARegisterOrScenarioChangeMadeWhileTheLatchIsEngaged_NeverReachesTheRebuild           +1
#       🔴 THE ZERO, PINNED — a measurement that contradicted this task's own motivating case, committed
#       rather than merely reported. The case a symmetric pre-check sounds like it is for ("a roster/scenario
#       change during a HALT reads N mapping files and writes N machine configs, then refuses") does not
#       exist here and never did: RegisterMachine restarts only `if (IsRunning)` and ApplyScenario only
#       `if (IsRunning && multiplierChanged)`, and Estop leaves the fleet not running. So that call does ZERO
#       builds, reads and writes — before and after J-1b alike. It is also the only halt-path coverage
#       ApplyScenario has here.
#       🔴 REVIEW C-1 — WHAT IT PINS, CORRECTED, AND THE CORRECTION IS §8.1(h) RECURRING INSIDE THE FIX FOR
#       §8.1(h). This block first said the test "makes a later change that makes a restart unconditional go
#       red". IT CANNOT: J-1b's own pre-check inside RebuildPipelineOffLock returns before BuildStartPlan in
#       exactly that hypothetical, so all FIVE assertions of the terminal block stay green — observation
#       count, store entry, EstopEngaged, IsRunning, driver health. (🔴 Re-review N3: this said "four",
#       inside the paragraph written to correct a false claim; the five are named so the count cannot drift
#       from them silently.) The claim was invalidated by the guard
#       added in the SAME COMMIT that made the claim — the same shape as the mutation result J-1 carried
#       across a tree that had moved under it. What the test actually pins is the observable PROPERTY, and it
#       is mechanism-agnostic: from either public entry point during a HALT, zero pipeline builds, no
#       MachineConfigStore entry for the machine the call registers, and a fleet still latched, not running
#       and slotless. TWO independent mechanisms deliver that today — the callers' own IsRunning guards and
#       (since J-1b) the pre-check — so it goes red only when BOTH are gone, never when one is. Measured, not
#       reasoned: under mutation M13 (J-1b's pre-check deleted) this test stayed GREEN, which is precisely
#       what says the zero it records belongs to the callers' guards rather than to the new check.
# The pre-check adds NO test to any other suite and moves no other constant: EXPECT_ABSTRACTIONS,
# EXPECT_CONFORMANCE, EXPECT_EDGECORE and EXPECT_EDGESERVICE are unchanged, and EXPECT_EDGECORE staying put
# is evidence rather than convenience — J-1b edits exactly one src file (FleetCore.cs, itself EdgeCore) and
# every consequence of the change is observable only through a live FleetHost, which is why both witnesses
# live here. EXPECT_CONFORMANCE in particular stays 22: no driver, no connector kind, and the shared suite's
# "FleetCore.StartLocked constructs drivers under the same _gate lock Estop() takes" assertion string is
# still TRUE — J-1b moves no driver construction and P7 is untouched.
# 🔴 Task K-1 raises this 1334 -> 1335 (+1): the one linked hygiene [Fact] every suite gets. Full
# justification beside EXPECT_ABSTRACTIONS at the top of this file. K-1 changes no src/ file, so every
# other number in this script is unchanged for it.
#
# 🔴 TASK J-2 raises this 1335 -> 1337 (+2), counted from the runner. ONE existing file gains two [Fact]s
# (FleetHostGateCommitCompletionTests.cs — the S-set witness file); nothing is rewritten, split or deleted.
#   AStartThatThrowsWhileInstallingSlots_LeavesSlotsTheHaltPathCanStillTearDown        +1
#       S3's residual, consequence (2): a StartLocked that throws part-way through its slot loop left
#       `_slots` populated with `_running == false`, and StopLocked's `if (!_running) return default;`
#       refused to tear those LIVE slots down — so Estop could not halt them and nothing else ever could.
#       Asserts the divergence first (IsRunning false while GetDriverHealth lists the installed slot, driver
#       undisposed) and then that a subsequent Estop releases it exactly once. Reverting StopLocked's guard
#       to the disjunct makes this red.
#   AStartThatThrowsWhileInstallingSlots_StillDisposesTheConnectorDriverItOrphaned      +1
#       S3's residual, consequence (1): `orphanedConnectorDrivers` is now allocated by StartLocked's CALLERS
#       and passed in, so a throw between an orphan's collection and the return can no longer take it out of
#       scope with its socket open. EXACTLY one disposal, same bar as every other count in that file. Its
#       second assertion PINS consequence (4) as an open gap — the drivers after the failing index in
#       `groups` are still never disposed — rather than leaving it to be rediscovered.
#
# EXPECT_ABSTRACTIONS, EXPECT_CONFORMANCE, EXPECT_EDGECORE and EXPECT_EDGESERVICE are deliberately UNCHANGED,
# and EXPECT_EDGECORE staying put is evidence rather than convenience: J-2 edits exactly one src file
# (FleetCore.cs, itself EdgeCore) and every consequence of both changes is observable only through a live
# FleetHost, which is why both witnesses live here — St4i.EdgeCore.Tests has no live reference to FleetCore
# at all (measured at J-1b; see §8.1's paired-control rule). EXPECT_CONFORMANCE in particular stays 23: J-2
# adds no driver and no connector kind, and the shared suite's "FleetCore.StartLocked constructs drivers
# under the same _gate lock Estop() takes" assertion string is still TRUE — J-2 moves no driver construction
# and P7 is untouched. EXPECT_WARNINGS stays 116: no new warning (measured on a full -t:Rebuild).
#
# 🔴 TASK S-1 raises this 1340 -> 1351 (+11), COUNTED FROM THE RUNNER (`dotnet test --list-tests`: 1340 ->
# 1351), not by hand. ONE new file, `OperatorDataRemovalCensusTests.cs`; nothing is rewritten, split or
# deleted, and NO src/ file is touched at all — S-1 is a measurement task and a measurement that edits what
# it measures has destroyed its own baseline. That is also why EXPECT_ABSTRACTIONS, EXPECT_CONFORMANCE,
# EXPECT_EDGECORE and EXPECT_EDGESERVICE are unchanged, and here that is a stronger statement than usual:
# with zero src/ edits there is no mechanism by which any of them COULD move, so their staying put is a
# check on this claim rather than a convenience. New grand total 2691.
#
# The file is the instrument `docs/owner-decisions.md` item 5 says must exist before that item can be a
# decision. It stands in three places, and the split is why it is eleven tests and not three:
#   TheIlWalker_ResolvesEveryTokenItFrames_AndSeesCallsItIsSupposedToSee                +1
#   TheRemovalCapableApiSurface_IsDerivedFromTheIl_AndEveryMemberIsClassified           +1
#   EveryRemovalCapableCallTheIlSees_IsAlsoSeenByTheSourceScan                          +1
#       REACH A. A real IL decode (operand lengths read off System.Reflection.Emit.OpCodes, not a byte scan
#       for 0x28) over every method body of the four assemblies this suite references. It exists to make
#       the removal VOCABULARY a measurement instead of a guess: every member of a byte-owning BCL type the
#       product actually calls must be classified, and every removal-capable call the IL contains must also
#       have been found by the source patterns. The third one is the refuter — it is what can prove the
#       text scan short, and `new FileInfo(p).Delete()` is a shape that makes it red (control run, S-1).
#   TheDeleteVocabularyThisTaskArrivedWith_IsATrueLowerBound_AndUselessAsACensus        +1
#   TheEnumerationOfRemovalCapableFilesystemSites_IsExactlyThis                         +1
#   TheEnumerationOfRowRemovingSqlSites_IsExactlyThis                                   +1
#   TheSourceScanner_FindsSitesItIsKnownToContain_AndIgnoresProseThatMerelyNamesThem    +1
#       REACH B, over all EIGHT projects under src/ — including the two WPF hosts and the SQL, none of
#       which Reach A can see. The first of the four measures the `Delete(` vocabulary this task arrived
#       with: 20 lines in 10 files, of which 9 are MapDelete route registrations and 4 are prose, and
#       ELEVEN files carrying a removal-capable filesystem call never spell `Delete(` at all.
#   ThePostureRig_ReallyDoesPutUnreadableBytesWhereTheStoreLooks                        +1
#   EveryOperatorArtifact_HasThePostureRecordedForIt_AtTheOneSituationHeldFixed         +1
#   ThePosturesAtTheFixedSituation_AreNotAllTheSame                                     +1
#   TheOneStoreThatCannotTellUnreadableFromAbsent_ReplacesTheOperatorsBytes             +1
#       REACH C — EXECUTION, which is the only reach that can answer "do they behave differently". Nine
#       stores constructed for real over an unreadable artifact in this run's own temp root (never anything
#       under %ProgramData%\ST4I). THREE postures, measured: two express a third state, six throw, and ONE
#       — OeeSettingsStore — cannot tell "unreadable" from "absent" and therefore replaces the operator's
#       oee-settings.json on its next ordinary write, with no exception and no log line. The last test is
#       that harm, executed. It PINS a live defect as a baseline and FIXES NOTHING: S-1 was forbidden to.
#       If the owner rules FIX, that assertion inverts and the inversion is the diff.
#
# EXPECT_WARNINGS stays 116: the new file adds no warning (measured on a full -t:Rebuild), and
# St4i.EngineApi.Tests is one of the NINE projects that do not set GenerateDocumentationFile, so its `///`
# blocks are not compiled — see the EXPECT_WARNINGS block below, which says so about itself.
#
# 🔴 S-1 FIX ROUND 1 raises this again, 1351 -> 1354 (+3), counted from the runner. Same one file, still
# zero src/ edits. The review found six defects and EVERY ONE was in the author's own justification rather
# than in a measured number — so two of the three new tests exist to turn a SENTENCE that was believed into
# a NUMBER that can be refuted, which is the only durable answer to that class of defect.
#   TheRawStringBlindSpot_IsMeasuredRatherThanDenied                                    +1
#       The class doc comment's own "what is outside" list said raw strings were "~30 in ProductConfigStore
#       plus one in App.xaml.cs", that NONE carried a removal shape, and that the IL cross-check closed the
#       gap. All three false, in the paragraph stating the instrument's limits, marked "Checked, not
#       assumed". Re-derived from scratch: 67 blocks in 12 files, and TEN of them in FIVE files carry
#       removal SQL. It also asserts those five are already in the pinned SQL enumeration, which is the tie
#       between the blind spot and the thing that covers it.
#   EveryEnumeratedRemovalSite_IsClassified_AndEveryMeasuredStoreIsAccountedFor         +1
#       The doc comment claimed provenance was "checked for COVERAGE against the mechanically-enumerated
#       set". Nothing did that: the two enumerations and the posture table were never referenced by one
#       another, and SecurityDb sat in the posture table and in NEITHER enumeration with nothing able to
#       notice. Now set equality both ways, plus the store->file link, plus SecurityDb declared as a store
#       that owns an artifact and performs no removal itself (its DML lives in SqliteUserStore and
#       SqliteAuditStore).
#   TheThrowingStores_ConstructCleanlyOverAnEmptyDirectory_AndLeaveTheUnreadableBytesIntact  +1
#       `Observe` maps ANY throw to Posture.Throws, so six of the nine published rows rested on a throw
#       whose cause nothing checked — a rig-shaped throw would have propped them up identically. Each of the
#       six now also constructs cleanly over an EMPTY directory (attribution) and leaves the unreadable
#       bytes byte-identical (which is the evidence for "nothing is destroyed on this posture", previously
#       prose). Note the read uses FileShare.ReadWrite: the three SQLite stores throw from the constructor,
#       so nothing disposes the connection and the pool keeps the handle — that is the artifact being held,
#       not the artifact being gone, and a stricter read would have reported it as a failure of this test.
#
# Two existing tests also gained assertions (no count change): the IL walker now asserts its decode-abort
# counter is zero, symmetrically with the `unresolved` counter it always had; and the vocabulary test now
# pins the SIZE of Reach B's hole — 37 removal-capable members classified, 9 text shapes, 21 removal-capable
# members with no text pattern at all. The scanner control now pins `.SetLength(` at ZERO occurrences under
# src/, which is the lower bound on the one escape that gets past all three reaches (Roslyn resolves
# FileStream.SetLength to System.IO.Stream, deliberately outside ByteOwningTypes).
#
# New grand total 2694. EXPECT_WARNINGS stays 116.
#
# 🔴 TASK T-1 raises this again, 1354 -> 1358 (+4), counted from the runner. Grand total 2694 -> 2698.
# One file touched on the test side (FleetHostGateCommitCompletionTests.cs); the src side is FleetCore.cs
# only. Owner decision 6 (docs/owner-decisions.md §6) ruled 2026-08-17: a failed install must say what
# already happened before it threw; the two SIBLING non-installing paths stay silent. All four tests are
# consequence probes on the production path, in the file that already owns S3's residual.
#   AStartThatThrowsWhileInstallingSlots_StillSaysWhatHappenedBeforeItThrew             +1
#       THE RULING'S WITNESS. One start that does real work and then throws: a roster machine whose
#       mappingProfile names no file (the resolver warns and falls back, off the lock, in the plan), a
#       registered connector whose factory rejects (the connector loop records it, under the lock), then a
#       null profile so StartSlot's `new EdgePipeline` throws after both. Asserts the install failure STILL
#       reaches the caller first — the emission must never be bought with the failure — then exactly one of
#       each line at Warning. Both halves are asserted because they are buffered by different code on
#       different sides of the lock, and a fix reaching only one would pass a one-sided test.
#   AFailedInstallsRejectedConnector_IsStillReportedByTheProjectionThatOutlivesTheLine  +1
#       §8.1(h5.1) — the surviving projection the ruling's own evidence rests on, RE-MEASURED rather than
#       inherited. GREEN ON BOTH SIDES of T-1's diff, deliberately: it measures a property T-1 did not
#       change, and a control that only passes after the fix could not have verified the premise.
#   AStartAbandonedByAConcurrentStopRequest_StillSaysNothing                            +1
#   AnInstallRefusedByTheHaltLatch_StillSaysNothing                                     +1
#       THE TWO SIBLINGS' SILENCE, pinned rather than asserted in prose. The same warning is asserted
#       PRESENT on the throw path above, from the same producer through the same flush, so a fix that
#       emitted from every non-installing path turns these red and that one green together. The second also
#       turned out to KILL the HALT-latch mutation — re-run on this tree, three failures where the recorded
#       figure at 1cbdc564 was two; see FleetHostStartBuildHoistTests' own verdict paragraph.
#
# EXPECT_WARNINGS stays 116: measured on a full rebuild after the change — FleetCore.cs gains one parameter
# and loses a return type, and St4i.EngineApi.Tests is one of the NINE projects that do not set
# GenerateDocumentationFile, so its `///` blocks are not compiled either. EXPECT_BUILD_NODES stays 0.
#
# 🔴 T-1 FIX ROUND 1 raises this once more, 1358 -> 1359 (+1), counted from the runner. Grand total
# 2698 -> 2699. Same one test file. The added test is the witness for the one thing this round had to BUILD
# rather than name.
#   AFailedInstallWhoseHostLoggerAlsoThrows_StillReportsWhyTheInstallFailed             +1
#       Round 1 shipped the emission and left a masking window open, justified by a measurement of the
#       pre-G-1 tree. Review ruled the measurement true and the inference wrong: pre-G-1 the logger threw
#       AHEAD of the throw site, so the install never reached the slot loop and there was no competing
#       diagnostic to lose. The EXPOSURE is old; the MASKING is new — reachable neither pre-G-1 nor at base.
#       Verified rather than argued: with round 1's src (commit 9209a81b) and this test present, the caller
#       gets InvalidOperationException ("this host's log provider failed") where the install threw
#       ArgumentNullException. The guard is an `installFaulted` exception filter around the FLUSH ONLY inside
#       CompleteStartOffLock, set from one `catch` per caller. The test asserts the install's exception type
#       reaches the caller, that the completion's `finally` still disposes the orphan (J-2's own
#       four-condition window at the DISPOSAL is deliberately left as J-2 made it), and that the flush still
#       aborts at the throwing entry rather than resuming.
#       The success path is unchanged and is pinned by an EXISTING test in the same file —
#       Start_WhenTheHostLoggerThrowsFlushingDeferredLines_TheOrphanIsDisposedAndTheRunEventRecorded is a
#       SUCCEEDING start whose host logger throws, and it still expects that throw to reach the caller. If
#       the guard ever widened past the faulting path, that test goes red.
#
# EXPECT_WARNINGS stays 116 and EXPECT_BUILD_NODES stays 0 for this round too.
#
# ─────────────────────────────────────────────────────────────────────────────────────────────────
# 🔴 U-1 (docs/owner-decisions.md item 7 — S4's SECOND HALF) raises this 1359 -> 1364 (+5), counted from
# the EXECUTED total, and MOVES NO OTHER TOTAL. One new file, tests/St4i.EngineApi.Tests/
# FleetHostFailedRestartReportsTests.cs. The other four suites are untouched: the change is one `catch`
# in FleetCore.RebuildPipelineOffLock plus comment corrections, and no suite outside EngineApi constructs
# a FleetCore restart.
#
# WHAT THE OWNER RULED, because the totals below only make sense against it: a restart whose rebuild
# throws leaves the fleet STOPPED with its roster/scenario commit STANDING, and records the exception on
# FleetCore.LastError — the field `GET /v1/health` is literally `LastError is null` over. Before this, a
# fleet an internal restart had torn down and could not rebuild reported HEALTHY. Neither of the two
# mechanisms J-2 named was taken; both are refused with reasons at the S4 row in FleetCore.cs's own banner.
#
# 🔴 U-1 FIX ROUND 1 — the sentence above ended "permanently, because nothing else set that field", and
# that is a FALSE UNIVERSAL over the two arms. It holds when BuildStartPlan throws: StopLocked cleared
# `_slots`, no slot survives that could fault, nothing writes the field. It fails when StartLocked throws
# mid-slot-loop: StartSlot's `_slots.Add` runs BEFORE `Task.Run`, so a stranded slot that later faults
# finds `removed == true` and sets LastError — a late, conditional (the slot must actually fault, and no
# Stop/Estop must have cleared `_slots` first) and mis-attributed self-report, naming the slot's fault
# rather than the restart's. Same family as the "GetDriverHealth lists NOTHING" universal corrected in
# 08fd75cb, which fixed the premise here and left the conclusion resting on it. The verdict is unchanged:
# the build-throws arm alone carries the finding, and on the install-throws arm U-1 replaces a contingent
# late report with an immediate one carrying the install's own exception.
#   ARegisterWhoseRebuildReallyThrows_LeavesTheFleetStopped_AndPutsTheSameExceptionOnTheHealthSurface  +1
#       The control-pair test and the only REAL throw of the five: a machine whose MachineConfigStore
#       record already carries a different configKind, so BuildStartPlan -> SimulatorFactory.Create ->
#       SimulatorBase's ctor -> MachineConfigStore.Ensure throws InvalidOperationException — the
#       enumeration's P5, production-reachable, no seam. Asserts Assert.Same between the exception the
#       caller receives and the one on LastError, so "the HTTP 500 and the health surface cannot disagree
#       about what failed" is measured rather than claimed.
#   AScenarioChangeWhoseRebuildThrows_ReportsTheSameFaultOnTheSameSurface                             +1
#   AFailedBurstRevert_ReportsOnTheHealthSurface_ThoughNoCallerEverSeesTheException                   +1
#       Entry paths 2 and 3. The third is the one that made a log line insufficient: Burst starts its
#       revert as `_ = RevertBurstAfterDelayAsync(...)`, so no caller ever sees the exception at all.
#       Both use the AdditionalPipelinesForTests stand-in rather than the real P5 site, and the reason is
#       mechanical rather than convenience: Ensure SEEDS a record on the first successful build, so the
#       real site cannot be armed a second time against one roster. Stated at the tests.
#   ARebuildRefusedByTheHaltLatch_LeavesTheHealthSurfaceUntouched                                     +1
#       The halt path still says nothing, pinned rather than asserted. It is silent STRUCTURALLY: both
#       refusals RETURN (RebuildPipelineOffLock's pre-check, StartLocked's latch), so neither can reach a
#       `catch`. Deleting the `if (!_running)` guard leaves this GREEN — that guard is about a concurrent
#       Start, not about the latch — which is exactly why the two are witnessed separately.
#   AStartThatInstallsAfterAFailedRestart_ClearsTheHealthSurfaceAgain                                 +1
#       U-1 added no clearing rule; StartLocked's pre-existing `LastError = null` sits past its own latch.
#       Without this pin, "stopped and unhealthy" being an absorbing state would be untested.
#
# 🔴 THE CONTROL PAIR, RUN ON BOTH SIDES AND RECORDED AS NUMBERS RATHER THAN AS AN EXPECTATION. Same test
# file, both arms, only src/St4i.EdgeCore/Fleet/FleetCore.cs swapped between them:
#   BASE (895c0c23, FleetCore.cs unmodified) — Failed: 4, Passed: 1. Every failure is LastError being
#       null: Assert.Same reports "Actual: null" for the two paths with a caller, Assert.NotNull fails on
#       the recovery test, and the burst path times out waiting for a field nothing writes.
#   HEAD — Failed: 0, Passed: 5.
# The ONE test green on BOTH arms is ARebuildRefusedByTheHaltLatch_LeavesTheHealthSurfaceUntouched, and
# that is the right result rather than a weak test: it measures a property U-1 did not change (the halt
# path says nothing here, on either side), which is what makes it a REGRESSION pin instead of a
# demonstration. Same shape as T-1's own green-on-both-sides witness.
#
# EXPECT_WARNINGS stays 116 and EXPECT_BUILD_NODES stays 0: measured on a full -t:Rebuild. The new test
# file compiles with no warning of its own, and FleetCore.cs gains one `catch` variable, one lock region
# and doc/comment text — St4i.EdgeCore and St4i.EngineApi are both among the projects that do NOT set
# GenerateDocumentationFile, so their `///` blocks are not compiled either way. Tag balance on the two
# edited `///` blocks was checked directly rather than inferred from that, because an unbalanced block
# on this file HIDES the diagnostics inside it.

# 🔴 TASK V-1 raises EXPECT_ENGINEAPI 1364 -> 1368 (+4), counted from the runner. Two files; nothing is
# rewritten or deleted, and TWO tests are REPLACED rather than added (so the census file is +3, not +5).
# 🔴 This said "ONE" until V-1's fix round (review M-4). The arithmetic was right and the sentence
# undercounted: ThePosturesAtTheFixedSituation_AreNotAllTheSame became
# NoStoreAnswersAbsentForAnArtifactThatIsPresent_ExceptTheOnesNamedAndDecided, AND
# TheOneStoreThatCannotTellUnreadableFromAbsent_ReplacesTheOperatorsBytes became
# TheStoreThatCouldNotTellUnreadableFromAbsent_NowRefusesTheWrite_AndTheOperatorsBytesSurvive — the
# second being S-1's live-defect baseline with its assertions INVERTED, which is the more interesting
# of the two and was the one the sentence dropped.
#
#   tests/St4i.EngineApi.Tests/OperatorDataRemovalCensusTests.cs                               +3
#       ThePosturesAtTheFixedSituation_AreNotAllTheSame is REPLACED by
#       NoStoreAnswersAbsentForAnArtifactThatIsPresent_ExceptTheOnesNamedAndDecided — net 0. S-1's
#       assertion was `classes.Count > 1`, which is the wrong guard for the answer the owner took: under
#       the law in docs/startup-failure-posture.md §3.6 a tree where every store threw would be fully
#       compliant and that assertion would be RED, while a tree with one store quietly conflating the two
#       cases is non-compliant and it would be GREEN. The replacement reddens in both directions.
#       EveryArtifactOwningStore_HasARow_AndTheOnesOutsideAreNamed                            +1
#           The membership rule S-1's set of nine did not have, so "nine" could not be refuted. Applying
#           it added five stores to the posture table and leaves exactly three enumerated files out, each
#           with a stated reason that this fact checks in both directions.
#       SeedingTheRecipesFile_DoesNotRewriteAHandWrittenProductsFile                          +1
#           S-1's second finding, decided: seeding recipes.json no longer rewrites a hand-written
#           products.json. Pins the fix AND that the missing file is still seeded.
#       CredentialStorePostureCensusTests (NEW CLASS, same file)                              +1
#           The store that cannot join the parallel table because Load is static and resolves a
#           process-wide variable per call. Measured with no environment mutation — the machine CODE is
#           the discriminator — and in the serialized env-var collection so a sibling repointing
#           ST4I_CREDS_DIR cannot make it measure two directories.
#
#   tests/St4i.EngineApi.Tests/HistorianEndpointsOeeTests.cs                                   +1
#       OeeSettings_Put_WithAnUnreadableSettingsFile_Returns409_AndTheOperatorsBytesSurvive. The surface
#       the loss is named on, and the assertion that GET's published DTO shape did NOT widen.
#
# 🔴 THE TWO CONTROL PAIRS, RUN ON BOTH SIDES AND RECORDED AS OUTCOMES RATHER THAN AS AN EXPECTATION. Base
# is f18f5c29 with src/ AND tests/ both at base, so the arms differ only in the tree, never in the file
# that measures it:
#   OeeSettingsStore — a hand-malformed oee-settings.json, then Set for a DIFFERENT machine.
#       BASE: Set SUCCEEDS, the file on disk no longer contains the operator's marker and does contain
#           SOME-OTHER-MACHINE. HEAD: Set throws InvalidOperationException naming the file, and the bytes
#           are byte-for-byte what was written, with nothing else in the directory.
#   ProductConfigStore — a hand-written products.json carrying a field ProductModel does not declare, with
#       recipes.json absent, then merely CONSTRUCTING the store.
#       BASE: products.json is rewritten and the field is gone. HEAD: byte-for-byte intact, and
#           recipes.json is still seeded.
#
# EXPECT_WARNINGS stays 116 and EXPECT_BUILD_NODES stays 0: measured on a full -t:Rebuild. No suppression
# of any kind was added. St4i.EdgeCore and St4i.EngineApi are both among the projects that do NOT set
# GenerateDocumentationFile, so the `///` blocks V-1 adds are not compiled either way — tag balance on
# every edited block was checked directly rather than inferred from that, because an unbalanced block
# HIDES the diagnostics inside it.
#
# 🔴 V-1 FIX ROUND 1 raises this 1368 -> 1369 (+1) — the endpoint arm of review I-3. Full justification
# beside EXPECT_EDGECORE above, where the EdgeCore half of the same fix is accounted for.
# 🔴 Task X-1 raises this 1369 -> 1370 (+1): the one linked OwnOutputDirectoryGuard [Fact] every suite
# gets. Full justification beside EXPECT_ABSTRACTIONS at the top of this file. THIS is the suite the whole
# measurement was taken on — all 20 of its WebApplicationFactory-building classes resolve
# ProductConfigStore, SimulatedEcosystem and MachineConfigStore to the default beside-the-binary root, and
# it is the only one of the five that had anything in its output directory at all.
# 🔴 Task Z-1 raises this 1370 -> 1371 (+1): item 11 measured at the operator's own surface, the PUT that
# answers 409 after a backup is restored under a live store. Full justification beside EXPECT_EDGECORE
# above, including why an inverted census assertion and a renamed census member move this by ZERO.
#
# 🔴 TASK AC-1 (.superpowers/sdd/trial-run-defects/task-1-brief.md) raises this 1371 -> 1374 (+3), COUNTED
# FROM THE RUNNER, and MOVES NO OTHER TOTAL — the other four suites are untouched by this task, which
# changes two files under src/St4i.EngineApi and none under src/St4i.EdgeCore. Grand total 2755 -> 2758.
# Both defects it addresses are startup behaviour of a REAL PROCESS, so both new instruments had to reach a
# surface no suite had: a started Kestrel host, and a directory this run cannot write to.
#   + 2  tests/St4i.EngineApi.Tests/Site/BoundServerAddressesTests.cs — two [Fact]s, no [Theory].
#        Program.cs supplied SiteAdvertiser's address delegate as
#        `…Features.Get<IServerAddressesFeature>()?.Addresses as IReadOnlyCollection<string>`. Kestrel's
#        runtime type for that property implements ICollection<string> and NOT IReadOnlyCollection<string>,
#        so the `as` yielded null on EVERY call in EVERY process and the advertiser reported "No server
#        addresses are bound yet" on a fully-listening host. Nothing in 2755 tests could see it: the
#        existing SiteAdvertiser tests pass string[] (which satisfies the conversion) and every
#        WebApplicationFactory class runs on TestServer, whose address feature is a List<string>. These two
#        start a real Kestrel host on 127.0.0.1:0. Counter-pair, both arms run: with the old expression
#        restored inside BoundServerAddresses.Read, 2 failed / 0 passed and the second failure quotes the
#        published build's line verbatim; with the fix, 2 passed / 0 failed.
#   + 1  OperatorDataRemovalCensusTests.OverANonWritableRoot_TheTwoSeamlessBesideTheBinaryStoresEndTheProcess_AndTheSeamedOneDoesNot
#        — docs/startup-failure-posture.md §3.5 said in a parenthesis that a read-only install directory is
#        a second fatal arm for ProductConfigStore and SimulatedEcosystem. Nothing executed it. This applies
#        one deny ACE, asserts the ACE bit BEFORE asserting anything about a store, and measures the split:
#        those two throw, MachineConfigStore (whose constructor only reads) does not. Non-vacuity was run,
#        not argued — with the SetAccessControl call removed the fact goes RED on its first assertion.
# No src/ behaviour changed for that third one: AC-1 ruled ProductConfigStore's beside-the-binary DEFAULT to
# be the same documented product behaviour X-1 ruled for MachineConfigStore, and its ABSENT SEAM to be a
# separate, deliberate, thrice-derived decision (OwnOutputDirectoryGuard's exemption, this script's own
# output-directory bracket, and PerHostDataRootsTests' partition all derive from that absence). Adding a
# seam would redden all three and would not move the fatal arm, because a seam leaves the default where it
# is. See README §15.9 and docs/startup-failure-posture.md §3.5.
#
# EXPECT_WARNINGS stays 116 and EXPECT_BUILD_NODES stays 0: measured on a full -t:Rebuild after this task.
# Nothing was suppressed — no .editorconfig, no <NoWarn>, no #pragma, no SuppressMessage.
# 🔴 AR-1 (2026-08-21) raises this 1374 -> 1378 (+4). The four are itemised, with their control pair and
# with why they are TWO PAIRS rather than four one-sided assertions, in the AR-1 block above
# EXPECT_EDGECORE. Counted from a run (`Passed: 1378, Total: 1378`), not derived by addition.
#
# 🔴 TASK AS-1 (.superpowers/sdd/items-27-28-29/task-1-brief.md — owner items 27/28/29) raises this
# 1378 -> 1388 (+10) and MOVES NO OTHER TOTAL. Grand total 2786 -> 2796. ONE new file,
# tests/St4i.EngineApi.Tests/OnboardingPasteKeyReachabilityTests.cs; nothing is rewritten, split or
# deleted. 🔴 COUNTED FROM A RUN, NOT FROM `--list-tests` AND NOT BY ADDITION: `dotnet test` on this suite
# printed `Passed: 1388, Total: 1388` with the new file in place. The other four suites are untouched —
# AS-1 changes two files under src/St4i.EngineApi and none under src/St4i.EdgeCore,
# src/St4i.EdgeService, src/St4i.Connector.* or src/St4iMachineSimulator, so EXPECT_ABSTRACTIONS,
# EXPECT_CONFORMANCE, EXPECT_EDGECORE and EXPECT_EDGESERVICE staying put is the check that this task did
# not reach somewhere it had no business reaching, rather than a coincidence.
#
# THE TEN, AND WHAT EACH ONE IS WORTH — stated this way because six of them are green on both sides of the
# first control pair, and a file that counted all six as witnesses would be five-sixths self-congratulation.
#   + 1  OnboardingPasteKeyReachabilityTests.MismatchedCode_MessageNamesTheCodeTheEngineActuallyAuthenticatesAs
#        🔴 THE ONLY RED-ABLE WITNESS IN THE SET (owner item 29). CONTROL PAIR 1, run whole and reverted:
#        with OnboardingEndpoints.AnnotatePasteKeyReachability's body reverted to `return result;` — the
#        BASE-commit behaviour — the filtered run was 1 failed / 9 passed, and the failure quotes the old
#        message verbatim ("Pasted mk_ key stored for WELD-01", `Not found: "ENGINE-API-01"`). With the
#        fix: 10 passed / 0 failed.
#   + 6  MatchingCode_MessageIsLeftExactlyAsPasteKeyWroteIt, CaseDifferenceAloneIsNotAMismatch,
#        ValidationFailure_IsLeftAlone, UnknownActiveCode_SaysNothing (a [Theory], 3 cases). These are
#        GREEN ON BOTH SIDES of control pair 1 and therefore measure NOTHING about the change. They earn
#        their place under CONTROL PAIR 2 instead — annotating unconditionally, i.e. deleting both guards —
#        which took the filtered run to 6 failed / 4 passed, exactly these six. Also run whole and reverted.
#   + 1  AnnotatedResult_KeepsEveryOtherMember — 🔴 green on BOTH control pairs, deliberately. It is the
#        assertion that holds "no published payload changed shape": same record, same Step ("Claimed",
#        which Onboarding.tsx and Settings.tsx both branch on), same MachineCode/MkKey/IsApproved. Only the
#        human-readable Message VALUE grew a clause, and only on the mismatch branch.
#   + 2  InspectorStreamBackfillCapTests (owner item 28) — 🔴 A CEILING GUARD, NOT A WITNESS, and labelled
#        that way in the file itself: both are green on both sides of every control pair that leaves
#        InspectorStreamEndpoint.BackfillEventCount at 200. Non-vacuity was RUN, not argued: a third
#        mutation setting that constant to 600 turned both red (2 failed / 8 passed), then was reverted.
#
# EXPECT_WARNINGS and EXPECT_BUILD_NODES: re-measured on a full -t:Rebuild after this task, not assumed —
# the numbers are stated at their own constants below. Nothing was suppressed for AS-1: no .editorconfig
# change, no <NoWarn>, no #pragma left in the tree, no SuppressMessage. (Two #pragma warning disable CS0162
# lines existed transiently INSIDE control mutation 1 and were removed with it; `git diff` at the branch
# tip contains neither.) AS-1 also touches web/ (five files) — `npm run build` (`tsc -b && vite build`)
# was run green, because this gate does not compile TypeScript.
# 🔴 AU-1 (2026-08-22, owner item 17 — base 659bcfb2) RAISES THIS 1388 -> 1395 (+7) AND MOVES NO OTHER SUITE
# TOTAL. COUNTED FROM THE RUNNER (`dotnet test --list-tests`: 1395), not by hand, and counted AFTER the file
# was written rather than predicted before it. ONE new file, tests/St4i.EngineApi.Tests/
# HistorianTelemetryProvenanceTests.cs, seven [Fact]s; no existing test was rewritten or deleted. The three
# IHistorianStore test fakes that had to gain the new optional parameter (HistorianWriterTests,
# FleetHostGateCommitCompletionTests, FleetHostHistorianWiringTests) each changed exactly one signature line
# and moved no count — EXPECT_EDGECORE stays 1179.
#
# 🔴 WHAT THE SEVEN ARE, MEASURED BY RUNNING BOTH CONTROLS RATHER THAN ASSERTED. The taxonomy below CORRECTED
# a label the author had written wrong, which is the reason it is stated here at all:
#   - Control A (the gate deleted from SqliteHistorianStore.QueryTelemetryAsync): 4 RED / 3 green. The four
#     reds are the witnesses — GateOptIn_OnAMachineWithBothKinds_…, GateOptIn_OnAPurelyFabricatedMachine_…,
#     GateOptIn_UnknownProvenanceSamples_AreExcludedOnce…, StoreLevelDefault_IsTheGatedOne_….
#   - Control B (the endpoint default flipped from `?? true` to the sibling rule): exactly 1 RED —
#     Default_WithNoExplicitValue_StillReturnsEverySampleIncludingFabricated_LegacyContinuity — and it was the
#     ONLY red anywhere. 🔴 That is a finding, not a pass: before this file existed NOTHING in the suite could
#     see that flip, so the row-loss item 17's STOP condition exists to prevent had no witness at all.
#   - RED under NEITHER control: TheJoinThisReadWasSaidToBeUnableToMake_IsTotal_… (a structural measurement,
#     deliberately independent of the gate) and GateOptIn_UnknownProvenanceSamples_PassWhenNothingExplicitly
#     Real… — 🔴 THE LATTER WAS WRITTEN AS A WITNESS AND MEASURED AS A GUARD, then relabelled in the file.
#     Both carry that label on themselves. A test green on both sides of a control measures nothing about it.
#
# EXPECT_WARNINGS and EXPECT_BUILD_NODES: re-measured on a full `MSBUILDDISABLENODEREUSE=1 dotnet build
# -t:Rebuild` after this task, not assumed — stated at their own constants below. Nothing was suppressed for
# AU-1: no .editorconfig change, no <NoWarn>, no #pragma, no SuppressMessage. The two control mutations were
# a one-line `if (false)` and a one-character default flip; both were reverted and `git diff` at the branch tip
# contains neither. AU-1 does NOT touch web/, so no web build was required (and none of its edits are TS).
#
# 🔴 AV-1 (2026-08-22, owner item 33 — base e6faec60) RAISES THIS 1395 -> 1405 (+10) AND MOVES NO OTHER SUITE
# TOTAL. COUNTED FROM THE RUNNER (`dotnet test --list-tests`: 1405), not by hand, and counted AFTER the files
# were written rather than predicted before them. ONE new file, tests/St4i.EngineApi.Tests/
# ScenarioTransportTruthTests.cs (nine [Fact]s), plus ONE [Fact] appended to
# tests/St4i.EngineApi.Tests/Auth/AuditWiringTests.cs. No existing test was rewritten or deleted, and no test
# fake changed shape — EXPECT_ABSTRACTIONS 161, EXPECT_CONFORMANCE 24, EXPECT_EDGECORE 1179 and
# EXPECT_EDGESERVICE 52 are all unmoved. New suite total 2821.
#
# 🔴 WHAT THE TEN ARE, TAXONOMY TAKEN FROM THE CONTROL RUN AND NOT FROM THE AUTHOR'S INTENT. The one-line
# control mutation is `FleetHost.CurrentScenarioDto` reverted to `ScenarioDto.From(_core.CurrentScenario, …)`
# — i.e. the fix removed, the new `FleetCore.NetworkOutageTransportInstalled` member and all ten tests left in
# place, so everything still compiles and the comparison isolates exactly the behaviour change.
#   - ScenarioTransportTruthTests under the control: `Failed: 6, Passed: 3`. Restored: `Passed: 9`.
#   - AuditWiringTests.ModeSwitch_* under the control: `Failed: 1, Passed: 1` (the pre-existing
#     ModeSwitch_WrittenByEngineer_… stayed green, the new one went red). Restored: `Passed: 2`.
#   - 🔴 THE AUTHOR WROTE "three of the nine go red" INTO THE TEST FILE'S OWN DOC COMMENT BEFORE RUNNING THE
#     CONTROL, AND THE MEASUREMENT SAID SIX. Three tests carry a witness assertion AND a guard assertion in
#     one body (the simulator-knob, active-preset and declared-flag-residue tests), which is why they redden.
#     The doc comment was corrected in place rather than quietly; the miscount is recorded because a
#     witness/guard label asserted from intent is the thing this convention exists to prevent.
#   - GREEN ON BOTH SIDES, therefore guards and NOT witnesses, and labelled so on themselves:
#     WhileTheOutageTransportIsInstalled_…, WithNoScenarioEverApplied_… and
#     TheApplyResponse_ReportsWhatWasREQUESTED_NotWhatTheGetWouldDerive.
#
# EXPECT_WARNINGS and EXPECT_BUILD_NODES: re-measured on a full `MSBUILDDISABLENODEREUSE=1 dotnet build
# -t:Rebuild` after this task, not assumed — stated at their own constants below. Nothing was suppressed for
# AV-1: no .editorconfig change, no <NoWarn>, no #pragma, no SuppressMessage. The single control mutation was
# the one-line revert described above; it was reverted and `git diff` at the branch tip contains neither it
# nor any pragma. AV-1 does NOT touch web/, so no web build was required (and none of its edits are TS) —
# note that `web/src/routes/Scenario.tsx` nonetheless CHANGES BEHAVIOUR as a consequence, because it seeds
# every outgoing POST body from the polled snapshot; that is the point of the fix and is recorded in item 33.
EXPECT_ENGINEAPI=1405

SUITES=(
  "tests/St4i.Connector.Abstractions.Tests:$EXPECT_ABSTRACTIONS"
  "tests/St4i.Connector.Conformance.Tests:$EXPECT_CONFORMANCE"
  "tests/St4i.EdgeCore.Tests:$EXPECT_EDGECORE"
  "tests/St4i.EdgeService.Tests:$EXPECT_EDGESERVICE"
  "tests/St4i.EngineApi.Tests:$EXPECT_ENGINEAPI"
)

LOGDIR="${TMPDIR:-/tmp}/st4i-verify-$$"

# ══ ONE MEASURING RUN AT A TIME — AND A RUN IS NOT ITS CORPSE (task R-1, §8.1(a)/(h6)) ══════════
#
# THE PROPERTY, stated in the terms of the thing being protected rather than in the terms of the
# incident that paid for it: every quantity this file asserts is a property of THE WHOLE MACHINE at
# an instant — how many build servers are resident, which test hosts are alive, what the product's
# credential directory contains. An instrument that asserts a machine-wide quantity is only sound
# while it is the ONLY thing perturbing that machine in the way it perturbs it. So the property is
#
#     AT MOST ONE INSTANCE OF THIS FILE MAY BE INSIDE ITS MEASURING WINDOW ON A GIVEN MACHINE,
#     AND AN INSTANCE THAT HAS STOPPED EXISTING MUST NOT BE ABLE TO KEEP THE NEXT ONE OUT.
#
# Both halves are load-bearing and they pull in opposite directions, which is why this is a lock
# with an adjudicator rather than a lock. The first half alone is a mutex; a mutex that outlives its
# holder is a machine nobody can verify again until a human deletes a file. The second half alone is
# no exclusion at all.
#
# 🔴 WHAT THIS REPLACES, AND WHY THE THING IT REPLACES WAS NOT NOTHING. Until now the only conduct
# this file had toward a second instance was the name-wide `taskkill //F //IM testhost.exe //T` at
# [1/3]: a second run DESTROYED the first one's live test host and then read the wreckage as a
# product fault. That is trap 7(j), and the file has always said so. But the kill has a legitimate
# job underneath the illegitimate one — an orphaned test host from a run that DIED is a real
# obstruction to the next build, and nothing else on this machine will reap it. The two jobs were
# fused because nothing could tell a live run from a dead one's leavings. Separating them is the
# whole of this block: acquire exclusivity FIRST, and only then let the name-wide kill run — at
# which point every test host it can see is, by construction, not a live gate run's.
#
# 🔴 WHAT COUNTS AS PROOF THAT A RUN IS ALIVE, and this is where the obvious answer is wrong. "The
# lock file exists" proves nothing: a power loss, a `kill -9`, a closed terminal all leave it exactly
# as a healthy run does. "The recorded process id exists" is weaker than it looks, because the OS
# reissues process ids and the number alone cannot tell a holder from its successor. What this uses
# is the pair (process id, PROCESS CREATION INSTANT) — Windows reports the second for every live
# process, and the pair is unique for as long as the process exists. A holder is ALIVE only if a
# process bearing that id exists AND was created at exactly the recorded instant; anything else is a
# corpse and the lock is taken from it, out loud, with the evidence printed.
#
# 🔴 AND THE ADJUDICATOR DELIBERATELY DOES NOT MATCH COMMAND LINES — see the §8.1(f) block below.
# The identity above is a pair of scalars written by another process into a file this run did not
# write. That is the entire population this instrument reads: ONE process id, never a search.
#
# 🔴 THE PUBLICATION IS ATOMIC AND CARRIES ITS OWN IDENTITY, which took three designs to get right
# and the two rejected ones are recorded because they look correct:
#   * `mkdir LOCK && echo record > LOCK/holder` — two steps. A reader arriving between them sees a
#     lock with no holder, which is a state that has no honest reading: it is neither a live run nor
#     a corpse. Every remedy for it is a timeout, and a timeout here is a tolerance on an assertion.
#   * `set -o noclobber; echo record > LOCKFILE` — one open, still two operations; the same reader
#     can still see a zero-byte file.
# What is used instead: build the record in a PRIVATE directory, then publish it with a single
# `mv -T`. MEASURED here, all three branches: `mv -T` onto an absent name succeeds; onto a
# NON-EMPTY directory it fails with "Directory not empty" and destroys nothing; onto an empty
# directory it succeeds. The published lock therefore contains its holder record AT EVERY INSTANT AT
# WHICH IT EXISTS, so "a lock with no identity" is not a state this design can produce, and no
# timeout is needed anywhere in it.
#
# 🔴 THE DOMAIN, DECLARED WITH WHAT LIES OUTSIDE IT, because a mutex whose reach is assumed is worse
# than none. This lock lives under `${TMPDIR:-/tmp}`, which on this platform is PER-USER. So:
#   INSIDE  — every invocation of this file by this account with this TMPDIR. That is the population
#             that has ever collided here, and it is the one the log-directory evidence came from.
#   OUTSIDE — a second Windows account running this gate; an invocation that exports a different
#             TMPDIR; any build, IDE build host or `dotnet test` that is not this file. NONE of those
#             are excluded by this lock, and the machine-wide quantities this file asserts CAN be
#             perturbed by all of them. That gap is not closed here and it is not closeable by a
#             lock: what closes it is the measurement at the failure exits below, which reads the
#             live population instead of assuming exclusivity bought it.
#
# 🔴 WHY NOT WIDEN IT TO A MACHINE-WIDE LOCATION, stated properly because the first version of this
# paragraph leaned on the task's constraints and that is the weaker argument (review, Minor 5). The
# constraint bars deleting or cleaning under `%ProgramData%\ST4I\`; it does not bar a lock elsewhere.
# The real objection is that widening the domain widens the WEDGE. A per-user lock left by a holder
# this gate cannot adjudicate is removable by the person whose gate it is blocking. A machine-wide
# lock published by one account is, by default ACL, NOT removable by another -- so the failure mode
# of the wider design is "user B cannot run the gate at all, and cannot fix it either", which is
# strictly worse than the coverage it buys. The narrow lock fails toward a nuisance one person can
# clear; the wide lock fails toward an obstruction that needs an administrator.
# The honest summary is that this lock closes SELF-collision, which is the only collision it can
# observe, and the build-server census closes nothing but reports everything.
#
# 🔴 §8.1(f) — WHERE THIS INSTRUMENT STANDS, AND THE MEASUREMENT THAT SETTLES IT. The obvious way to
# ask "is another run of this script alive" is to look for processes whose command line names the
# script. MEASURED IN THIS REPOSITORY, on this platform, and it is worse than the warning that
# prompted the check: a query for `Name='bash.exe'` carrying `verify-suites` returned FOUR processes
# on a machine running ONE — the shell that launched the query (its command line contains the string
# because the QUERY does), that shell's parents, and two short-lived forks of them. Command
# substitution in MSYS forks `bash.exe`, and a fork carries its parent's command line verbatim, so a
# script written this way manufactures copies of ITSELF inside the set it is counting, and the set
# is not even stable between two consecutive readings (measured: one reading `5380 10028 6712
# 14544`, the next `5380 17588`). Excluding the reader's own id does not fix it and excluding the
# reader's whole lineage does not fix it either — the forks of a SIBLING shell survive both.
#
# So the domain was not narrowed, it was DERIVED FROM THE QUESTION instead. The question is "does
# the process that published this lock still exist", which names ONE process; it is not "which
# processes look like me", which is a search over a population this instrument is standing inside.
# The population this adjudicator reads is a single process id taken from a file written by someone
# else. THE REFUTATION THAT WOULD BREAK IT, named so it can be run: a lock record whose id belongs
# to this very run's process lineage. That is the one input under which "the holder is alive" would
# be true and "another run is in progress" would be false — so it is checked explicitly against the
# lineage this run computes for itself from /proc, and it SEIZES rather than refusing. The lineage
# is enumerated, not summarised: it is printed on every adjudication, so the set the exclusion rests
# on is visible rather than asserted.
GATE_LOCK_BASE="${TMPDIR:-/tmp}/st4i-verify-suites-lock"
GATE_LOCK_DIR="$GATE_LOCK_BASE/held"
GATE_LOCK_TOKEN=""
GATE_SELF_WINPID=""
GATE_SELF_LINEAGE=""

# This run's own Windows process id and those of every MSYS ancestor, comma-separated. Read from
# /proc, so it costs no process query and cannot be perturbed by what it is about to be compared
# against. Bounded at 64 hops and stops on a self-parent, because a /proc that lies must not spin.
gate_self_lineage() {
  local p="$$" acc="" wp ppid i
  for ((i = 0; i < 64; i++)); do
    [[ -r "/proc/$p/winpid" ]] || break
    wp=$(cat "/proc/$p/winpid" 2>/dev/null)
    [[ -n "$wp" ]] && acc="${acc}${acc:+,}${wp}"
    [[ -r "/proc/$p/stat" ]] || break
    ppid=$(awk '{print $4}' "/proc/$p/stat" 2>/dev/null)
    [[ -n "$ppid" && "$ppid" != "0" && "$ppid" != "$p" ]] || break
    p="$ppid"
  done
  printf '%s' "$acc"
}

# "ALIVE <name> <creation instant>", "GONE", or "UNPARSEABLE". EMPTY MEANS CANNOT TELL and never
# means GONE — the same rule the CPU detector, the settle poll and the credential bracket each state
# for themselves. The filter is an exact process id: this query has no search in it, which is the
# §8.1(f) argument above expressed as code rather than as a paragraph.
#
# 🔴 THE INSTANT IS UTC TICKS, AND THE OBVIOUS RENDERING WAS WRONG IN THE DIRECTION THAT ACTS
# (review, Critical 3). This used to return `CreationDate.ToString('o')`. MEASURED on this machine:
# `CreationDate.Kind` is **Local**, and `'o'` renders the CURRENT offset —
#     local   2026-08-17T00:05:11.6211420+07:00
#     utc     2026-08-16T17:05:11.6211420Z
# So a timezone or DST change between the moment a holder published its instant and the moment the
# next run reads it produces A DIFFERENT STRING FOR THE SAME LIVE PROCESS. The pair check then fires,
# the gate calls a live run a corpse, seizes its lock, and runs [1/3]'s name-wide taskkill through its
# test hosts. That is destroy-instead-of-refuse, reintroduced by the discriminator built to end it —
# and it was not found by any control, because no control changes the clock. Ticks on the UTC instant
# have no offset to render and no format to disagree about.
#
# 🔴 AND THE ID IS VALIDATED BEFORE IT IS SPLICED, which closes a second hole in the same call. The id
# arrives from a FILE. MEASURED: `ProcessId=abc` makes the query error, `-ErrorAction
# SilentlyContinue` turns that into `$null`, and the caller read it as **GONE** — "cannot parse"
# arriving as "dead", on the one path where "dead" authorises a seizure. That is the fail-quiet shape
# the third-state work has just spent a round removing, rebuilt here by an omitted guard. A
# non-numeric id is now its own answer and is never a statement about liveness.
gate_process_identity() {
  local pid="${1:?pid}"
  case "$pid" in ''|*[!0-9]*) printf 'UNPARSEABLE'; return 0 ;; esac
  powershell -NoProfile -NonInteractive -Command \
    "\$p = Get-CimInstance Win32_Process -Filter \"ProcessId=${pid}\" -ErrorAction SilentlyContinue; if (\$null -ne \$p) { 'ALIVE {0} {1}' -f \$p.Name, \$p.CreationDate.ToUniversalTime().Ticks } else { 'GONE' }" \
    2>/dev/null | tr -d '\r' | head -1
}

gate_lock_field() { sed -n "s/^${1:?field}=//p" "$GATE_LOCK_DIR/holder" 2>/dev/null | head -1; }

# 🔴 EXIT 3, NOT 1, AND NOT 0. A refusal is not a verdict about the tree, and this file's contract is
# that its one PASS/FAIL line describes the tree. Borrowed from mutate-guard.sh, which spends exit 3
# on exactly this distinction ("NO-VERDICT"). A caller that treats any non-zero as "the tests failed"
# is wrong here, and the text says so rather than leaving it to the exit code to imply.
# 🔴 THE HEADLINE AND THE REMEDY ARE PER-CALLER, AND THE FIRST DRAFT'S WERE UNIVERSAL — found by
# WALKING the cannot-parse branch, which the round before had only named. Three states reach this
# function and only ONE of them is "another run is already measuring this machine": the other two
# are "this run cannot tell whether one is". Printing the certain headline over the uncertain states
# is limb 5 again, and the remedy was worse than the headline. "There is nothing to clean up by
# hand" is TRUE when a live holder was measured (wait, and it releases) and FALSE for a record this
# version cannot parse — no future run can adjudicate that record either, so the advice promised a
# self-healing that would never arrive and left the gate wedged with a reassuring sentence. Each
# caller now supplies what its own state licenses: $1 the reason, $2 the remedy, $3 whether a live
# holder was actually established.
gate_lock_refuse() {
  local reason="${1:?reason}" remedy="${2:?remedy}" holder_alive="${3:-no}"
  if [[ "$holder_alive" == "yes" ]]; then
    echo "REFUSED: another run of this gate is already measuring this machine."
  else
    echo "REFUSED: this run cannot establish that it is the only thing measuring this machine."
  fi
  echo "  $reason"
  echo "  holder ... pid $(gate_lock_field winpid), ${_gl_holder_name:-<name unread>}, started $(gate_lock_field started) UTC"
  echo "             from $(gate_lock_field tree)"
  echo "             its logs: $(gate_lock_field logdir)"
  echo "  lock ..... $GATE_LOCK_DIR"
  echo "  this run . pid ${GATE_SELF_WINPID:-<unknown>} (lineage ${GATE_SELF_LINEAGE:-<unknown>}) -- NOT the holder"
  # 🔴 "STOPPED BEFORE ITS FIRST ACTION" IS PRINTED ONLY WHEN IT IS TRUE (review, Important 3,
  # second half). A run can seize one corpse and then be refused by the live holder that published
  # next; on that path this run HAS acted -- it removed a lock directory. The claim is therefore
  # made from the counter rather than from the shape of the code.
  if [[ ${_gl_seizures:-0} -eq 0 ]]; then
    echo "  🔴 NOTHING WAS KILLED AND NOTHING WAS MEASURED. This run stopped before its first action,"
    echo "     so whatever holds that lock still has its test hosts, build servers and log directory"
    echo "     exactly as they were."
  else
    echo "  🔴 NOTHING WAS KILLED, AND NOTHING WAS MEASURED ABOUT THE TREE. This run did remove"
    echo "     ${_gl_seizures} lock director(ies) whose holders it had measured as gone. It ran no build and no"
    echo "     suite, and whatever holds the lock named above still has its test hosts, build servers"
    echo "     and log directory exactly as they were."
  fi
  echo "     That is the entire point: the old conduct here was to kill every test host on the machine"
  echo "     by name and read the wreckage, which produced an ABORTED suite on a healthy tree and, in"
  echo "     one measured session, three log directories in twenty-seven minutes and a suite log"
  echo "     truncated at 221 bytes."
  echo "  🔴 A PASS FROM A RACED RUN IS EXACTLY AS WORTHLESS AS A FAIL, so do not go looking for"
  echo "     another gate's number to read instead of this one."
  # 🔴 THE BLANKET ADVICE TO REMOVE THE LOCK BY HAND IS GONE (review, Minor 6) — where a live holder
  # was measured, removing it by hand is the ONE action on this machine that destroys a live run's
  # lock, and an instrument does not close by recommending the thing it exists to prevent. Where no
  # live holder was established, the opposite is true and saying "nothing to clean up" would wedge
  # the gate forever. So the remedy comes from the caller and never from here.
  echo "  $remedy"
  echo "  This is NOT a verdict about the tree: no build ran, no suite ran, exit 3."
  exit 3
}

# 🔴 THE CLOSING SENTENCE IS PER-BRANCH, AND THE FIRST DRAFT'S WAS NOT — caught by running the
# control rather than by re-reading it. It said "the holder was already gone" on EVERY seizure, and
# that is FALSE on the branch that seizes a lock naming THIS RUN'S OWN lineage: that process is not
# gone, it is alive, and it is this run's own ancestor. A universal sentence printed under a
# predicate that does not hold of every member is the defect this file spends its length warning
# about, committed inside the message announcing a fix for it. So what is true of EVERY seizure is
# stated once, here; what is true of ONE branch is supplied by that branch and nowhere else.
gate_lock_seize() {
  local why="${1:?why}" evidence="${2:?evidence}" staging
  echo "  seizing the exclusive-run lock: ${why}"
  echo "    lock was: pid $(gate_lock_field winpid) ${_gl_holder_name:-} created $(gate_lock_field created) (UTC ticks = $(gate_lock_field createdUtc)), started $(gate_lock_field started) UTC"
  echo "    ${evidence}"
  echo "    NOTHING WAS KILLED to take this lock, and NO LIVE RUN'S LOCK WAS REMOVED. Every arm that"
  echo "    reaches this point has first asked Windows about that exact process id -- the reason is"
  echo "    printed above and is never inferred from the lock's AGE, which is the one property a lock"
  echo "    left by a power loss and a lock held by a healthy run have in common."
  echo "    Orphan test hosts left behind are cleaned by [1/3] below."
  # 🔴 REMOVED THE WAY IT IS PUBLISHED, WHICH THE FIRST DRAFT DID NOT DO (review, Important 4). This
  # was `rm -rf "$GATE_LOCK_DIR"`, which passes through unlink(holder) then rmdir(dir) -- so between
  # those two syscalls the published lock exists WITH NO HOLDER RECORD. That is precisely the state
  # the publication note calls "not a state this design can produce", and whose handler refuses with
  # a message saying so. The branch labelled unreachable was reachable by this file's own cleanup,
  # and a rival starting inside that window got a spurious REFUSED. `mv -T` out first, then delete:
  # the lock disappears in ONE operation, exactly as `gate_lock_release` already did it. The two
  # removal paths now have one shape, which is also why a later reader cannot fix one and miss the
  # other -- the drift this file has paid for at the process matcher.
  # 🔴 THE COUNTER COUNTS WHAT ACTUALLY HAPPENED, NOT WHAT WAS ATTEMPTED (review, N4). It used to
  # increment unconditionally while the removal is `mv -T ... && rm -rf`, and on Windows a directory
  # rename fails while a handle inside it is open -- so the two messages that read this counter
  # ("adjudicated and REMOVED n locks") could report a removal that did not occur. Same class as the
  # fall-through's "a fourth appeared", one level down: a number in a printed sentence that the code
  # never established. Incremented only on the branch that succeeded.
  staging="$GATE_LOCK_BASE/.seized-$$-${_gl_seizures}"
  rm -rf "$staging" 2>/dev/null
  if mv -T "$GATE_LOCK_DIR" "$staging" 2>/dev/null; then
    rm -rf "$staging" 2>/dev/null
    _gl_seizures=$((_gl_seizures + 1))
  else
    echo "    🔴 AND THE REMOVAL DID NOT HAPPEN: this lock was adjudicated as a corpse and could NOT be"
    echo "    removed (the rename failed -- a handle inside it may be open, or the directory may not be"
    echo "    writable). Nothing about that changes the finding above; it changes what this run was able"
    echo "    to DO about it, and this run will not claim otherwise."
  fi
}

gate_lock_acquire() {
  local ident state created name staging attempt h_pid h_created h_ident h_state h_now
  GATE_SELF_WINPID=$(cat "/proc/$$/winpid" 2>/dev/null)
  GATE_SELF_LINEAGE=$(gate_self_lineage)
  if [[ -z "$GATE_SELF_WINPID" ]]; then
    # 🔴 EXIT 3, NOT 1 (review, Important 8). This is not a verdict about the tree -- no build ran
    # and no suite ran -- which is the exact distinction this task minted `exit 3` for two functions
    # below. A `FAIL:` headline here is read as "the tests failed" by every caller that greps for it.
    echo "NO-VERDICT: this run cannot read its own Windows process id (/proc/$$/winpid)."
    echo "  The lock records WHO holds it, and a holder that cannot name itself cannot be shown to be"
    echo "  dead by the run that comes after it -- it would wedge this gate until a human intervened."
    echo "  Failing closed rather than publishing a lock nobody can adjudicate."
    echo "  Nothing about the tree was measured. exit 3."
    exit 3
  fi
  ident=$(gate_process_identity "$GATE_SELF_WINPID")
  state="${ident%% *}"
  if [[ "$state" != "ALIVE" ]]; then
    echo "NO-VERDICT: Windows would not describe this run's own process (pid ${GATE_SELF_WINPID})."
    echo "  The query answered: '${ident:-<nothing>}'. An empty answer is 'cannot tell', which this"
    echo "  file never reads as a healthy one."
    echo "  Without an identity there is no lock to publish, and without a lock this gate cannot say"
    echo "  it is the only thing measuring this machine."
    echo "  🔴 THIS CHANGES WHICH RUNS GO GREEN: NONE. A machine whose PowerShell cannot answer was"
    echo "  already certain to fail -- build_node_sample returns empty, the settle poll never settles,"
    echo "  and the run FAILs there. This is that same doomed run failing minutes earlier with a"
    echo "  message that names the cause. It is not a verdict about the tree. exit 3."
    exit 3
  fi
  ident="${ident#ALIVE }"
  name="${ident%% *}"
  created="${ident#* }"
  GATE_LOCK_TOKEN="${GATE_SELF_WINPID}@${created}"

  if ! mkdir -p "$GATE_LOCK_BASE" 2>/dev/null; then
    echo "NO-VERDICT: cannot create the lock directory's parent: $GATE_LOCK_BASE"
    echo "  Fix TMPDIR (currently '${TMPDIR:-/tmp}'); do not run the gate without exclusivity."
    echo "  Nothing about the tree was measured. exit 3."
    exit 3
  fi

  # Three attempts, not a poll: an attempt is only spent when a corpse was seized, and a corpse can
  # only be seized once. Three is a bound on how many stale holders one start-up will step over
  # before it stops trusting the file at all -- not a wait, not a retry, and there is no sleep in it.
  for ((attempt = 1; attempt <= 3; attempt++)); do
    staging="$GATE_LOCK_BASE/.claim-$$-$attempt"
    rm -rf "$staging" 2>/dev/null
    if ! mkdir -p "$staging" 2>/dev/null; then
      echo "NO-VERDICT: cannot build a lock record under $GATE_LOCK_BASE"
      echo "  This run had already removed ${_gl_seizures} lock(s) whose holders it measured as gone."
      echo "  Nothing about the tree was measured. exit 3."
      exit 3
    fi
    if ! {
      printf 'winpid=%s\n'  "$GATE_SELF_WINPID"
      printf 'created=%s\n' "$created"
      printf 'name=%s\n'    "$name"
      printf 'token=%s\n'   "$GATE_LOCK_TOKEN"
      printf 'started=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      printf 'tree=%s\n'    "$(pwd)"
      printf 'logdir=%s\n'  "$LOGDIR"
      printf 'msyspid=%s\n' "$$"
      printf 'lineage=%s\n' "$GATE_SELF_LINEAGE"
    } > "$staging/holder" 2>/dev/null; then
      echo "NO-VERDICT: could not write this run's lock record to $staging/holder"
      echo "  This run had already removed ${_gl_seizures} lock(s) whose holders it measured as gone."
      echo "  Nothing about the tree was measured. exit 3."
      rm -rf "$staging" 2>/dev/null
      exit 3
    fi

    # The publication. Succeeds only when no lock is published; never overwrites a published one.
    if mv -T "$staging" "$GATE_LOCK_DIR" 2>/dev/null; then
      return 0
    fi
    rm -rf "$staging" 2>/dev/null

    h_pid=$(gate_lock_field winpid)
    h_created=$(gate_lock_field created)
    _gl_holder_name=$(gate_lock_field name)
    # 🔴 A FIELD THAT CANNOT BE PARSED IS NOT A DEAD HOLDER (review, Important 2). Both fields are
    # numeric by construction -- a Windows process id and a UTC tick count -- so anything else means
    # the record was not written by this version of this file, or was corrupted, or was edited by
    # hand. Every one of those is "cannot tell", and "cannot tell" refuses. The `-z` guard alone let a
    # NON-NUMERIC id reach the process query, where `-ErrorAction SilentlyContinue` turned the WQL
    # error into `$null` and the caller read it as GONE -- measured, `ProcessId=abc` -> GONE. That is
    # "cannot parse" arriving as "dead" on the one path where "dead" authorises a SEIZURE, which is
    # the fail-quiet shape the third-state work has just spent a round removing.
    case "$h_pid" in ''|*[!0-9]*) h_pid="" ;; esac
    case "$h_created" in ''|*[!0-9]*) h_created="" ;; esac
    if [[ -z "$h_pid" || -z "$h_created" ]]; then
      # A lock with NO record is not reachable by construction (see the publication note above): a
      # published lock carries its record at every instant it exists. A lock with an UNREADABLE
      # record IS reachable -- by a hand edit, or by a record written by a different version of this
      # file, which is exactly what a lock carrying the older offset-rendered `created=` would be.
      # Both land here, and both refuse, which is the direction that destroys nothing.
      gate_lock_refuse "Its holder record does not parse: the process id and the creation instant must both be numeric and at least one is not. That is 'cannot tell', and this gate does not seize on 'cannot tell'." \
        "🔴 THIS ONE DOES NOT HEAL ITSELF, which is why it is the only state here that asks you to act: no future run can adjudicate a record it cannot read either, so the gate stays refused until the lock is removed. Check that no gate is running (a live one prints its own pid at start-up), then remove ${GATE_LOCK_DIR}. A record in this shape was written by something other than this version of this file."
    fi

    # 🔴 THE ORDER OF THE NEXT TWO TESTS IS LOAD-BEARING AND THE FIRST DRAFT HAD IT BACKWARDS
    # (review, Important 1 and 2). The lineage test used to run BEFORE the process query, which cost
    # two things at once. (a) A corpse whose id had been REISSUED to one of this run's ancestors took
    # the lineage arm and was seized with the sentence "The named process IS alive" -- an outcome
    # that happens to be right, reached through a premise nothing had checked at that moment.
    # (b) The shared closing text asserted that the reason "was measured on the process itself",
    # which on that arm was false, because that arm took no measurement. Query first, then classify,
    # and the property stops being incidental and becomes structural:
    #
    #     NO SEIZURE IN THIS FUNCTION IS REACHED WITHOUT A LIVE QUERY ON THAT EXACT PROCESS ID.
    #
    # Check it by reading: every `gate_lock_seize` below sits inside the `$h_ident` case.
    h_ident=$(gate_process_identity "$h_pid")
    h_state="${h_ident%% *}"
    case "$h_state" in
      GONE)
        gate_lock_seize "no process with id $h_pid exists on this machine." "This is a CORPSE, not a run: the recorded process is gone, so nothing is holding this lock."
        continue ;;
      ALIVE)
        h_now="${h_ident##* }"
        if [[ "$h_now" != "$h_created" ]]; then
          gate_lock_seize "a process with id $h_pid exists but was created at $h_now, not at the recorded $h_created (UTC ticks)." "This is a CORPSE, not a run: the id was reissued to a later process, so the holder itself is gone. The id ALONE would have said 'alive' here; the creation instant is what refutes it."
          continue
        fi
        # §8.1(f) as code, now reached only with the identity confirmed. This is the one input under
        # which "the holder is alive" is TRUE and "another run holds this" is FALSE. The lineage is
        # enumerated in the message so a reader can check the claim rather than accept it.
        case ",${GATE_SELF_LINEAGE}," in
          *",$h_pid,"*)
            gate_lock_seize "the lock names pid $h_pid, which is in THIS RUN'S OWN process lineage (${GATE_SELF_LINEAGE})." "This is a RECORD LEFT BEHIND, not a second run. That process was just measured ALIVE at the recorded creation instant -- and it is an ancestor of this one, so it is this run rather than a rival to it. A process cannot be a second run of itself."
            continue ;;
        esac
        gate_lock_refuse "Its process is ALIVE: id and creation instant both match what it recorded." \
          "There is nothing to clean up by hand, and doing so here is the one action that can destroy a live run's lock. Wait for that run to finish -- it releases the lock itself -- then run one gate." \
          yes
        ;;
      UNPARSEABLE)
        # Unreachable today: the field guard above already refused a non-numeric id. Handled anyway,
        # because "unreachable by construction" is a claim about today's arrangement of two adjacent
        # guards, and this file has paid for a branch whose first execution came at the worst moment.
        gate_lock_refuse "Its recorded process id could not be used to ask Windows anything. 'Cannot tell' is not 'dead'." \
          "Fix the process query, then re-run: if that holder is alive this run must not start, and if it is gone the next run will measure it gone and take the lock by itself."
        ;;
      *)
        gate_lock_refuse "Whether its process still exists CANNOT BE READ (the process query answered '${h_ident:-<nothing>}'). 'Cannot tell' is not 'dead', and this gate will not take a lock it cannot prove is free." \
          "Fix the process query (PowerShell absent, refusing, or hung), then re-run: if that holder is alive this run must not start, and if it is gone the next run will measure it gone and take the lock by itself."
        ;;
    esac
  done
  # 🔴 THIS USED TO REPORT AN OBSERVATION THE LOOP NEVER MAKES (review, Important 3). It said "a
  # fourth appeared" -- but the loop ends on its COUNTER, having never attempted a fourth
  # publication, so no fourth lock was ever seen. It then printed the holder's fields, read from a
  # directory the last seizure had just removed, so every one of them was empty; and it closed with
  # "this run stopped before its first action" after three removals. Three false clauses on one
  # path, in the file whose whole subject is published sentences the run itself refutes. What is
  # said now is what the counter knows and nothing beyond it.
  echo "REFUSED: this run could not obtain the exclusive-run lock, and stopped rather than keep trying."
  echo "  It adjudicated and removed ${_gl_seizures} lock(s) whose holders it had measured as gone, and each time"
  echo "  another lock had already been published before it could take one."
  echo "  The bound is on ATTEMPTS, not on time: there is no sleep in this mechanism and this run did"
  echo "  not wait. Something on this machine is publishing gate locks faster than they can be"
  echo "  adjudicated -- that is what to go and stop."
  echo "  lock ..... $GATE_LOCK_DIR"
  echo "  this run . pid ${GATE_SELF_WINPID:-<unknown>} (lineage ${GATE_SELF_LINEAGE:-<unknown>})"
  echo "  🔴 WHAT THIS RUN DID DO, stated because the other refusal path can truthfully say it did"
  echo "     nothing and this one cannot: it removed ${_gl_seizures} lock director(ies). It killed no process,"
  echo "     ran no build, ran no suite, and measured nothing whatever about the tree."
  echo "  This is NOT a verdict about the tree, exit 3."
  exit 3
}

# 🔴 RELEASES ONLY WHAT IT STILL HOLDS. If the record on disk no longer carries this run's token then
# a later run judged this one dead and took the lock; removing it here would delete a LIVE holder's
# lock, which is the exact harm this whole block exists to prevent, committed by the cleanup path.
# `mv -T` first, so the lock never exists in a half-removed state for anyone else to read.
gate_lock_release() {
  [[ -n "${GATE_LOCK_TOKEN:-}" ]] || return 0
  local tok staging
  tok=$(gate_lock_field token)
  if [[ "$tok" != "$GATE_LOCK_TOKEN" ]]; then
    echo "  NOTE: the exclusive-run lock on disk is not this run's any more. Another run judged this"
    echo "        one dead and took it; this run left it alone. Its numbers were still measured under"
    echo "        two runs, so treat them as raced."
    GATE_LOCK_TOKEN=""
    return 0
  fi
  staging="$GATE_LOCK_BASE/.releasing-$$"
  rm -rf "$staging" 2>/dev/null
  mv -T "$GATE_LOCK_DIR" "$staging" 2>/dev/null && rm -rf "$staging" 2>/dev/null
  GATE_LOCK_TOKEN=""
}

_gl_holder_name=""
_gl_seizures=0
gate_lock_acquire
# Armed the instant the lock is held and never before: a run that was REFUSED must not run a cleanup
# path, because everything it could clean belongs to the run that refused it.
trap gate_lock_release EXIT

mkdir -p "$LOGDIR"
FAILURES=()
UPDATE=0
[[ "${1:-}" == "--update" ]] && UPDATE=1

note() { printf '  %s\n' "$*"; }
note "exclusive-run lock held: pid ${GATE_SELF_WINPID} (lock $GATE_LOCK_DIR)"

# ══ THE THREE TOOLING CHECKS (task AW-1 — owner-decisions.md items 26, 32 and 37) ════════════════
#
# 🔴 WHY THEY ARE HERE AT ALL. Items 26, 32 and 37 are not defects in the PRODUCT; they are defects in
# the INSTRUMENTS, and each of them had the same shape: a rule that existed only as advice. Item 37's
# was the sharpest — "no gate reads docs/owner-decisions.md", so that file's verdict table could
# disagree with its own bodies, and its Part I enumeration could list ELEVEN items that had already
# moved, for THREE CONSECUTIVE TASKS, with the gate green throughout. These three lines are what makes
# that sentence stop being true. THE GATE NOW READS docs/owner-decisions.md.
#
# WHY HERE AND NOT AT THE VERDICT. They run before the build so they run at all even on the early
# `exit 1` paths' side of the tree, and their results are folded into FAILURES rather than exiting, so
# the normal path still prints EXACTLY ONE PASS/FAIL line — the same contract the credential and
# output-directory brackets keep.
#
# 🔴 WHAT IS DELIBERATELY *NOT* HERE, because item 26 measured the cost of putting it here. There is NO
# whole-tree assertion on the universal-negation census. That census flags 5780 of 15965 doc-comment
# sentences — more than a third of the tree — so a gate on it would redden for any documentation edit
# whatsoever. Item 26's own text names that shape: "a tool with no green definition". The census is a
# CEILING, reported by `scan-doc-negations.sh --census` on demand; what is gated is the far narrower
# and green-definable question of what this branch ADDED since its recorded baseline.
#
# 🔴 AND WHAT NONE OF THE THREE CAN DO: none of them can see a ruling that was never written down.
# That is the first half of item 37 and it stays unenforceable — see the boundaries at the head of
# each script, which are the load-bearing part of each of them.
#
# Each script is standalone-runnable, which matters: this gate takes a machine and many minutes, and
# an author who has just edited a markdown table should not have to buy that to learn one line is out
# of sync. Run them directly:
#     bash scripts/check-owner-decisions.sh
#     bash scripts/repo-scan.sh --self-test
#     bash scripts/scan-doc-negations.sh --since "$DOC_ABSOLUTES_BASELINE" --expect "$EXPECT_NEW_DOC_ABSOLUTES"
#
# ── THE BASELINE PAIR, MEASURED AND THEN WRITTEN, the way every other constant in this file moves ──
# DOC_ABSOLUTES_BASELINE is the commit this branch's documentation claims are measured against, and
# EXPECT_NEW_DOC_ABSOLUTES is how many absolute doc-comment claims have been ADDED since it. Moving
# either is an act of REVIEW: every sentence the tool lists must be read and shown to be true first.
# Raising the number to make this green is the one thing it exists to prevent.
#
# 🔴 MEASURED AFTER THE WORK WAS WRITTEN, NOT PREDICTED BEFORE IT: 0 at e99019c0 for task AW-1, which
# added three shell scripts and no C# doc comments at all. A zero here is an assertion about the C#
# corpus only — see boundary (c) in scan-doc-negations.sh for the four surfaces it does not read.
DOC_ABSOLUTES_BASELINE="e99019c0"
EXPECT_NEW_DOC_ABSOLUTES=0

# `$0`'s directory is passed to bash as an argument rather than spliced into a delimited string: on
# this platform a script path can be `D:/…`, and a colon-delimited "name:command" pairing would split
# on the drive letter. Argument vectors, not string surgery.
_SCRIPTDIR="$(dirname "$0")"
run_tooling_check() {                       # $1 = human name, $2.. = argv
  local _name="$1"; shift
  local _log="$LOGDIR/tool-$(printf '%s' "$_name" | tr ' /' '--').log"
  if bash "$@" > "$_log" 2>&1; then
    note "$_name: OK"
  else
    FAILURES+=("$_name: $(cat "$_log")")
    note "$_name: FAILED (see verdict below)"
  fi
}

run_tooling_check "owner-decisions structure" "$_SCRIPTDIR/check-owner-decisions.sh"
run_tooling_check "repo-scan cwd-invariance"  "$_SCRIPTDIR/repo-scan.sh" --self-test
run_tooling_check "new absolute doc claims"   "$_SCRIPTDIR/scan-doc-negations.sh" \
                  --since "$DOC_ABSOLUTES_BASELINE" --expect "$EXPECT_NEW_DOC_ABSOLUTES"

# ══ THE BRACKET ON THE REAL CREDENTIAL DIRECTORY (task K-1, branch review §2) ═══════════════════
#
# WHAT THIS IS FOR. tests/Shared/RealCredentialStoreLeakGuard.cs asserts that the product's REAL
# credential directory gains no entry while ONE test process runs. That guard has two holes it names
# in its own doc comment and cannot close from inside a test:
#   * five suites are five processes, so five baselines and no delta across them;
#   * its interval ends when its [Fact] runs, and xunit orders nothing. MEASURED, not feared: K-1's
#     mutation M1 wrote a real DPAPI blob into the real root and the guard stayed GREEN, because the
#     writer happened to be scheduled after it.
# This script is the only anchor in the repository that spans all five processes. Snapshot before the
# build, compare after everything, and both holes close at once. It adds no test, so no EXPECT_* moves.
#
# 🔴 NAME SETS, NOT COUNTS, AND TWO SEPARATELY FATAL POPULATIONS. A count delta cancels on
# one-add-plus-one-delete, which would make this instrument STRICTLY WEAKER than the set difference the
# per-suite guard already ships. `added` and `removed` are compared and reported apart.
#
# 🔴 WHAT THE SECOND DIRECTION DOES AND DOES NOT BUY — stated carefully, because the comfortable version
# of this sentence is false and this file is where such sentences get believed. Reporting `removed`
# closes the case where the kept evidence base is pruned while the gate is otherwise green. It does NOT
# close the adaptation anyone actually reaches for: when this fires because file X appeared, DELETING X
# restores before == after and buys a green — and the message below will have named X. A delta sampled at
# two instants is structurally blind to a file that appears and vanishes inside the bracket. There is no
# arrangement of two snapshots that fixes that; only a watcher would, and this is not one.
#
# 🔴 AND THE OTHER THING NEITHER INSTRUMENT SEES: an IN-PLACE OVERWRITE of a name already present. Both
# sides compare SETS OF NAMES, not content and not timestamps, so re-sealing a credential that was
# already there changes nothing either one looks at. The leak shapes this repo has paid for all mint a
# fresh machine code per run and therefore land as new names — but an overwrite of one of the eleven kept
# blobs would destroy evidence silently, and nothing here would say a word. Named because this comment
# previously listed only the appear-and-vanish hole and read as if that were the whole of it.
#
# 🔴 AND THE DOMAIN IS WIDER THAN THE CRITERION'S. This measures THE MACHINE over the window, not "the
# test processes". Anything else running here that writes a credential — the WPF shell, the edge service,
# an operator onboarding a machine in another window — reddens this gate and is not a test defect. That is
# §8.1(f) running in reverse: a tool whose domain is wider than the question, which is a false-positive
# source rather than a blind spot. The per-suite guard is what attributes; keep both.
_creds_src="src/St4i.EdgeCore/Infrastructure/CredentialStore.cs"
_creds_expr=$(tr '\n' ' ' < "$_creds_src" 2>/dev/null \
  | grep -oE 'SpecialFolder\.CommonApplicationData\)[[:space:]]*(,[[:space:]]*"[^"]*")+' || true)
_creds_expr_count=$(printf '%s' "$_creds_expr" | grep -c . || true)
if [[ "${_creds_expr_count:-0}" != "1" ]]; then
  # Fail closed, exactly as the C# side does. A bracket that silently watched the wrong directory would
  # be green forever, which is the vacuity shape this whole task exists to avoid.
  echo "FAIL: could not derive the REAL creds root from ${_creds_src}"
  echo "  (found ${_creds_expr_count:-0} CommonApplicationData root expressions, expected exactly 1)."
  echo "  Fix the derivation. Do NOT hardcode the directory here — a restated literal is how this check"
  echo "  would keep passing while watching a directory the product no longer writes to."
  exit 1
fi
# 🔴 THE ROOT HALF, AND IT HAD THE EXACT DEFECT THE CHECK ABOVE EXISTS TO PREVENT (re-review New-1).
# This read `cygpath -u "${PROGRAMDATA:-C:/ProgramData}"`. MEASURED in this repo's Git Bash: `PROGRAMDATA`
# is NOT SET — Windows exports `ProgramData` (mixed case) and `ALLUSERSPROFILE`, and bash is
# case-sensitive — so the `:-` fallback fired on EVERY run and the "derivation" was a hardcoded literal
# wearing a derivation's clothes. It resolved correctly here by luck; on a machine with a relocated
# ProgramData it would have watched a nonexistent directory and been SILENTLY GREEN FOREVER. The
# fail-closed check above covered the SEGMENT half and left the ROOT half to a `:-`.
#
# Fixed by asking the SAME API the product asks. `CredentialStore.DefaultRoot()` calls
# `Environment.GetFolderPath(SpecialFolder.CommonApplicationData)`, which is the shell folder API and NOT
# an environment variable at all; PowerShell reaches the identical call. So the two derivations now agree
# BY CONSTRUCTION rather than by coincidence, and there is no literal left to be silently wrong.
# (PowerShell is already this script's idiom for asking Windows a question — see the build-node check.)
_creds_base_win=$(powershell -NoProfile -NonInteractive -Command \
  "[Environment]::GetFolderPath('CommonApplicationData')" 2>/dev/null | tr -d '\r' | head -1)
REAL_CREDS_ROOT=""
[[ -n "$_creds_base_win" ]] && REAL_CREDS_ROOT="$(cygpath -u "$_creds_base_win" 2>/dev/null || true)"
if [[ -z "$REAL_CREDS_ROOT" || ! -d "$REAL_CREDS_ROOT" ]]; then
  echo "FAIL: could not resolve CommonApplicationData, so the credential bracket has no root to watch."
  echo "  PowerShell returned: '${_creds_base_win:-<nothing>}' -> '${REAL_CREDS_ROOT:-<nothing>}'"
  echo "  Refusing to guess. A default here is how this check came to watch a hardcoded path on every"
  echo "  run while looking derived (re-review New-1); an unresolvable root must stop the gate, never"
  echo "  silently disarm it."
  exit 1
fi
while IFS= read -r _seg; do
  REAL_CREDS_ROOT="${REAL_CREDS_ROOT%/}/${_seg}"
done < <(printf '%s' "$_creds_expr" | grep -oE '"[^"]*"' | tr -d '"')

# Names only, relative to the root, sorted for `comm`. Enumerates and never opens, deletes or creates.
#
# 🔴 FAILS CLOSED ON AN UNREADABLE ROOT (re-review Minor). The `|| true` that used to end this line
# swallowed a root that EXISTS but cannot be listed — an ACL change, a lock — into an empty snapshot,
# i.e. into a silent pass, which is the same hole the C# side closed for its own `Snapshot()` call. A
# root that is absent is legitimate (a machine that never onboarded); a root that is present and
# unreadable is not.
creds_snapshot() {
  # 🔴 ABSENT AND UNREADABLE ARE DIFFERENT ANSWERS, AND `[[ -d ]]` GIVES THE SAME ONE TO BOTH
  # (branch review, Important 2). `[[ -d ]]` is false on EACCES just as it is on "no such directory", so
  # the earlier `|| return 0` turned a permission denial into an EMPTY SNAPSHOT — a silent green, in the
  # one function whose whole job is to refuse to pass silently. The New-7 work covered only the
  # traverse-but-cannot-list slice; this is the cannot-traverse slice, and it is reachable on any
  # non-elevated identity given the ACL SecurityDirAcl.Apply puts on this directory.
  if [[ -d "$REAL_CREDS_ROOT" ]]; then
    ( cd "$REAL_CREDS_ROOT" && find . -mindepth 1 | sed 's|^\./||' | LC_ALL=C sort ) || {
      echo "FAIL: the REAL credential directory exists but could not be LISTED: $REAL_CREDS_ROOT" >&2
      echo "  The bracket cannot measure what it cannot read, and an empty reading would be a SILENT" >&2
      echo "  PASS. Fix the ACL or the lock; do not disarm the check." >&2
      return 1
    }
    return 0
  fi

  # Not a readable directory. Decide WHICH by asking the parent, whose answer distinguishes the two.
  local _parent _base
  _parent=$(dirname "$REAL_CREDS_ROOT"); _base=$(basename "$REAL_CREDS_ROOT")
  if [[ -e "$REAL_CREDS_ROOT" ]] || { ls -1a "$_parent" 2>/dev/null | LC_ALL=C grep -qxF "$_base"; }; then
    echo "FAIL: the REAL credential root EXISTS but cannot be entered: $REAL_CREDS_ROOT" >&2
    echo "  The parent lists it, so this is a PERMISSION or lock problem, not an absent directory." >&2
    echo "  Treating it as absent would be a silent green. Fix access; do not disarm the check." >&2
    return 1
  fi
  if ! ls -1a "$_parent" >/dev/null 2>&1; then
    echo "FAIL: cannot read the parent of the REAL credential root either: $_parent" >&2
    echo "  Nothing can be concluded about the creds directory from here, and 'nothing concluded'" >&2
    echo "  must not read as 'nothing changed'." >&2
    return 1
  fi
  # Genuinely absent — a machine that has never onboarded. Legitimate, and an empty snapshot is correct:
  # any entry appearing later still reads as an addition.
  return 0
}

CREDS_BEFORE="$LOGDIR/creds-before.txt"
CREDS_AFTER="$LOGDIR/creds-after.txt"
CREDS_ADDED=""
CREDS_REMOVED=""
# 🔴 SEPARATE FROM THE TWO POPULATIONS (re-review New-7). "Could not read the directory" is a THIRD
# outcome, not a deletion. It used to be stuffed into CREDS_REMOVED, which printed a diagnostic string
# under the heading "something DELETED from a directory nothing is allowed to delete from" — a heading
# contradicting the line beneath it, in a gate whose entire premise is that deletions there are alarming.
# Manufacturing the wrong alarm is worse than a vague one: it sends the reader to look for a culprit that
# does not exist.
CREDS_UNREADABLE=0
CREDS_EVALUATED=0
CREDS_REPORTED=0
if ! creds_snapshot > "$CREDS_BEFORE"; then
  echo "FAIL: could not take the credential bracket's BASELINE. Stopping rather than running the suites"
  echo "  under a bracket that cannot fail. (This runs before the EXIT trap is armed, so nothing else"
  echo "  in this script has started yet.)"
  exit 1
fi
# NOT a check — a `note` is for a human reading alongside a verdict, never something a verdict depends on
# (this script's own rule, stated at gate 3). The verdict below depends on the SET COMPARISON, never on
# this number; it is printed so a reader can see the bracket armed against a plausible population.
note "real creds root under watch: $REAL_CREDS_ROOT ($(grep -c . < "$CREDS_BEFORE" || true) entries at start)"

# Evaluates once; later calls reuse the verdict. Returns 0 when the directory is unchanged.
creds_bracket_eval() {
  if [[ $CREDS_EVALUATED -eq 1 ]]; then
    [[ $CREDS_UNREADABLE -eq 0 && -z "$CREDS_ADDED" && -z "$CREDS_REMOVED" ]] && return 0 || return 1
  fi
  CREDS_EVALUATED=1
  if ! creds_snapshot > "$CREDS_AFTER"; then
    # Unreadable-but-present root at the closing read. Still fatal — a bracket that cannot read its own
    # directory has not measured anything — but reported as ITS OWN outcome, never as a deletion.
    CREDS_UNREADABLE=1
    CREDS_ADDED=""
    CREDS_REMOVED=""
    return 1
  fi
  # 🔴 LC_ALL=C ON `comm` TOO (branch review, Minor). Both input files are sorted under LC_ALL=C, but
  # `comm` was left to the ambient locale — and `comm` re-checks collation order as it merges. A locale
  # whose collation differs from C makes it consider its own correctly-sorted input unsorted, at which
  # point its output is undefined rather than wrong-in-a-visible-way. Pin the comparison to the same
  # collation the sort used; a set difference whose two halves disagree about order is not a set
  # difference.
  CREDS_ADDED=$(LC_ALL=C comm -13 "$CREDS_BEFORE" "$CREDS_AFTER" || true)
  CREDS_REMOVED=$(LC_ALL=C comm -23 "$CREDS_BEFORE" "$CREDS_AFTER" || true)
  [[ -z "$CREDS_ADDED" && -z "$CREDS_REMOVED" ]] && return 0 || return 1
}

creds_bracket_text() {
  if [[ $CREDS_UNREADABLE -eq 1 ]]; then
    echo "REAL credential directory could NOT BE READ at the end of this run: $REAL_CREDS_ROOT"
    echo "  NOTHING WAS DELETED and nothing was added — the directory exists and could not be listed, so"
    echo "  this run measured NOTHING. Do not go looking for a culprit; there is no evidence of one."
    echo "  Causes worth checking, in order: an ACL change on the creds directory (SecurityDirAcl.Apply"
    echo "  runs on every CredentialStore.Save), a handle held open by another process, or the directory"
    echo "  being replaced mid-run. Fix the read and re-run; do not disarm the bracket."
    return
  fi
  echo "REAL credential directory CHANGED across this run: $REAL_CREDS_ROOT"
  if [[ -n "$CREDS_ADDED" ]]; then
    echo "  ADDED ($(printf '%s\n' "$CREDS_ADDED" | grep -c .)) — something wrote a machine credential into a real install's store:"
    printf '%s\n' "$CREDS_ADDED" | head -25 | sed 's/^/      /'
  fi
  if [[ -n "$CREDS_REMOVED" ]]; then
    echo "  REMOVED ($(printf '%s\n' "$CREDS_REMOVED" | grep -c .)) — something DELETED from a directory nothing is allowed to delete from:"
    printf '%s\n' "$CREDS_REMOVED" | head -25 | sed 's/^/      /'
  fi
  echo "  🔴 DO NOT MAKE THIS GREEN BY DELETING. Removing a file named above WILL restore before == after"
  echo "     and WILL buy a green, because this compares two instants and cannot see a file that appears"
  echo "     and vanishes between them. That is not the check working; it is the check being defeated, and"
  echo "     the evidence base five artifacts cite is what gets spent doing it."
  echo "  SCOPE: this measures THE MACHINE over the whole gate window, not just the test processes. If the"
  echo "     WPF shell, the edge service, or an operator onboarding a machine was running here, that is a"
  echo "     false positive of this gate and not a test defect — check before you go hunting a test."
  echo "  WHAT THE SUITE RESULTS ABOVE DO AND DO NOT TELL YOU:"
  echo "     * bracket RED + one or more suites RED on"
  echo "       RealCredentialStoreLeakGuardTests  ->  STRONGLY SUGGESTIVE, not decisive. It narrows the"
  echo "       WINDOW: the entry appeared while that suite's process was alive. Start there."
  echo "       🔴 But the guard names the OBSERVING process, never the WRITING one. It watches the same"
  echo "       machine-wide directory this bracket does — it is narrower in TIME, not in DOMAIN — so an"
  echo "       operator, the WPF shell or the edge service completing a claim during that suite's window"
  echo "       turns it red too. That is the same population the SCOPE line above declares real; it does"
  echo "       not stop existing because a guard went red."
  echo "     * bracket RED + all five suites GREEN  ->  🔴 NOT DECISIVE. DO NOT read it as \"external\"."
  echo "       TWO causes produce this exact signature and this output cannot separate them:"
  echo "         (a) another process on this machine wrote it — WPF shell, edge service, or an operator"
  echo "             onboarding a machine in another window; or"
  echo "         (b) A TEST wrote it AFTER its own guard [Fact] had already run. xunit orders nothing, so"
  echo "             a writer scheduled after the guard is invisible to it and the suite stays GREEN."
  echo "       (b) is not hypothetical — it is this repository's MEASURED mutation M1: a test that sealed a"
  echo "       real DPAPI blob into this directory while its suite reported 1336/1336 green. Recorded in"
  echo "       tests/Shared/RealCredentialStoreLeakGuard.cs under \"A window, not the whole process\"."
  echo "       🔴 A GREEN RE-RUN IS NOT CONFIRMATION OF (a): case (b) is scheduling-dependent, so it comes"
  echo "       back green on its own about as often as not. Re-running decides nothing here."
  echo "       WHAT DOES SEPARATE THEM: the entry's WRITE TIME against this run's suite phase — inside it"
  echo "       means a test wrote it. The names above are a hint and NOTHING MORE: a census by machine-code"
  echo "       prefix is the very instrument this guard exists because it returns green over real leaks."
  echo "     Both instruments are still needed — this one is complete but anonymous, the per-suite guard"
  echo "     narrows the window but is equally anonymous about the writer."
  echo "     🔴 And to be exact about (b): this bracket DETECTS it — that is why you are reading this text"
  echo "     at all — it just cannot ATTRIBUTE it. Saying \"neither closes (b)\" understated the instrument"
  echo "     that caught it; detection and attribution are different things and only the second is missing."
}

# 🔴 Unconditional, via trap: the warnings gate and the build-node gate below both `exit 1` before the
# suites run, and a bracket placed at the end would be skipped by exactly the runs most likely to have
# left something behind. `exit` inside an EXIT trap does not re-enter it, so the status set here is final.
#
# 🔴 IT ALSO RELEASES THE EXCLUSIVE-RUN LOCK, AND THAT IS A CHANGE OF CONTRACT, NOT AN ADDITION OF A
# LINE (task R-1). bash allows exactly ONE EXIT trap: installing this one REPLACES the
# `trap gate_lock_release EXIT` armed at the lock, so without the call below every path that reaches
# this point would leak a published lock and the NEXT run would have to seize it as a corpse. The
# corpse adjudication would get that right — the process really is gone — but a mechanism that is
# only ever exercised on its recovery path is a mechanism nobody is measuring. `local rc=$?` comes
# FIRST and the release comes after it, because the release runs commands and would otherwise be the
# status this trap propagates. Whoever adds a third EXIT trap to this file owns both of these.
creds_bracket_trap() {
  local rc=$?
  # 🔴 THE RELEASE HAPPENS AFTER THE BRACKET'S CLOSING SNAPSHOT, AND THE ORDER IS THE WHOLE POINT
  # (review, Minor 1). The first draft released the lock FIRST. The credential bracket is a
  # comparison between two instants, and the second instant is taken inside `creds_bracket_eval`
  # below -- so releasing before it opens a window in which the NEXT run may already have started
  # and be writing into the real credential root that this run is still about to measure. An entry
  # it created would land in this run's AFTER set and be reported as this run's leak. The lock is
  # what makes the bracket's two instants belong to one run; giving it up early gives that up.
  # `creds_bracket_eval` is memoised, so calling it here is the same evaluation gate 3 may already
  # have made, never a second snapshot.
  local _cb_ok=0
  creds_bracket_eval && _cb_ok=1
  [[ $CREDS_REPORTED -eq 1 ]] && _cb_ok=1
  gate_lock_release
  if [[ $_cb_ok -eq 1 ]]; then
    exit "$rc"
  fi
  echo "FAIL (credential bracket):"
  creds_bracket_text
  exit 1
}
trap creds_bracket_trap EXIT

# Total processor SECONDS consumed by every live `testhost` process, as a float, or the
# empty string when there is none (or when PowerShell is unavailable). See the hang
# check below for why this cannot be `ps`: Windows' `ps` has no CPU column at all.
# Empty must read as "cannot tell", never as "flat".
# 🔴 This hard-codes a process named `testhost`, which is vstest's host. Under
# Microsoft.Testing.Platform the host is the test assembly's OWN executable, so this would
# return empty forever, the CPU check would go permanently inert (correctly reading "cannot
# tell", never "flat"), and only the wall-clock ceiling would remain. That degrades safely --
# but SILENTLY. If an SDK bump ever removes half this detector, this comment is why.
# 🔴 TRAP 7(i) and 7(j), BOTH FOUND BY AN AGENT DEBUGGING A FAILURE THIS SCRIPT CAUSED.
#
# (i) THE REMEDY MANUFACTURED THE EVIDENCE. When the ceiling fired, this script ran
#     `taskkill //F //IM testhost.exe`, and vstest then wrote "Test host process crashed"
#     into the log. Four tasks read that line as a product crash and carried it forward as
#     "a pre-existing DeviceIdentityStore flake, no root cause". The trx timestamps settle
#     it: last result 20:48:36, abort recorded 21:03:58 -- 966s later, the exact second the
#     ceiling fired. THE SUITE HUNG; IT NEVER CRASHED. A tool whose remedy fabricates a
#     different diagnosis than the fault is worse than one that only reports.
#
# (j) THE CLEANUP WAS NAME-WIDE, NOT RUN-SCOPED. `//IM testhost.exe` kills EVERY test host
#     on the machine, so two overlapping gate runs execute each other. That accounts for
#     three further aborts in the preserved history -- including a set I produced myself and
#     briefly read as a code regression.
#
# So: kill only the descendants of THIS run's `dotnet test`, and say plainly in the failure
# text that the kill is ours, so nobody reads vstest's crash line as a product fault again.
kill_this_runs_hosts() {
  local root_pid="${1:?pid}"
  # //T on a PID kills that process tree only. The name-wide form is what caused (j).
  taskkill //F //T //PID "$root_pid" >/dev/null 2>&1 || true
}

testhost_cpu_seconds() {
  powershell -NoProfile -NonInteractive -Command \
    "(Get-Process testhost -ErrorAction SilentlyContinue | Measure-Object -Property CPU -Sum).Sum" \
    2>/dev/null | tr -d '\r' | head -1
}

# ══ WHAT A BUILD SERVER IS — ONE DEFINITION, TWO READERS (task P-1) ═════════════════════════════
# 🔴 The predicate below is UNCHANGED, character for character, from the one that used to live inline
# in `build_node_sample`. All the reasoning for every clause of it — why it matches on what a process
# IS rather than what it is called, why `rzc.dll` stays in a repo with no Razor, and why a NULL
# CommandLine must COUNT rather than fail open — is in the trap block at the settle poll below, which
# is still its home. It is hoisted here for exactly one reason: P-1 adds a SECOND reader of the same
# population (the census below), and two copies of this matcher is the drift this file has already
# paid for. Trap 7's first rewrite dropped the Razor server and failed open on a null command line;
# both were found by asking "does the new matcher miss anything". A copy that a future fix reaches
# and a copy it does not is that same defect with a delay fuse on it. One string, interpolated twice.
BUILD_SERVER_WHERE="Get-CimInstance Win32_Process -Filter \"Name='dotnet.exe' OR Name='VBCSCompiler.exe'\" | Where-Object { \$null -eq \$_.CommandLine -or \$_.CommandLine -match 'MSBuild\.dll|VBCSCompiler|rzc\.dll' }"

# ══ THE CENSUS — the instrument this script did not have (task P-1, §8.1(h7)) ═══════════════════
#
# WHAT WAS MISSING. The settle poll below produces a COUNT. A count cannot answer the only question
# a non-zero reading actually raises, which is WHOSE. The old failure text answered it anyway, by
# assertion — "a population this script created" — and that sentence is FALSE for the population it
# was written about. This is §8.1(f) in this script's own voice: the instrument stood in the position
# of its AUTHOR (inside this script's process tree, where every build server plausibly is ours) and
# inherited its domain from there instead of deriving it from the question.
#
# 🔴 WHAT THE NEW READING STANDS ON, and it is deliberately not a position. Two axes, both properties
# of the process rather than of the observer:
#
#   1. THE FLAG THE PROCESS CARRIES. This script declares node reuse OFF twice — the export at the
#      top of the file and the inline prefix on the build line. MEASURED, both directions, on this
#      tree (P-1):
#        * a rebuild under THIS script's posture spawns 14 worker nodes carrying `/nodeReuse:false`,
#          and they are GONE the moment the build ends — the resident population it leaves is one
#          VBCSCompiler and nothing else;
#        * the same rebuild with the variable unset spawns 14 carrying `/nodeReuse:true`, and all 14
#          are STILL RESIDENT minutes later, because that is what node reuse means.
#      So `/nodeReuse:true` on a live process is not a hint about provenance, it is a proof of
#      exclusion: this script cannot have started it. That is the divergence §8.1(h7) says nothing
#      here could read, and reading it is most of this task.
#   2. WHETHER IT WAS ALREADY THERE. The census taken before this script's FIRST action fixes a PID
#      set that no later behaviour of this script can alter. A survivor in that set was inherited; a
#      survivor outside it arrived while this run was going.
#
# 🔴 AND THE LIMITS, stated here rather than left to be discovered, because both are real:
#   * PIDs are reused by the OS. A recycled PID could make a new process look inherited. Windows does
#     not recycle aggressively over a gate run's lifetime, but this is a heuristic on the "was it
#     already there" axis — the FLAG axis has no such weakness and is the one that carries the claim.
#   * A census is TWO INSTANTS, not a watcher. A foreign build that starts and finishes between two
#     readings is invisible to it, exactly like the appear-and-vanish hole the settle poll names for
#     itself and the credential bracket names for itself. Closing that needs a watcher; this is not
#     one, and pretending otherwise is how the last three instruments in this file got their domains
#     wrong.
#
# 🔴 A THIRD LIMIT, STATED HERE WITH THE OTHER TWO RATHER THAN IN A REPORT (P-1 fix round 2). NOT ONE
# of this file's PowerShell call sites carries a timeout. The set is CLOSED -- it is the sites in this
# one file -- so it is enumerated rather than summarised, and ALL SIX are named (R-1: the first list
# said five and left the credential bracket's own out, which is a closed set counted short):
#     1. `gate_process_identity`      -- the FIRST call every run makes
#     2. `_creds_base_win` (the credential bracket's root derivation, just below)
#     3. `testhost_cpu_seconds`
#     4. `build_server_census`        -- this function
#     5. `build_server_parentage`
#     6. `build_node_sample`
# A PowerShell that HANGS rather than failing is not "unreadable", it is "not yet answered", and it
# stalls whatever is waiting on it. That is a PRE-EXISTING class and it is deliberately not fixed
# here: a timeout changes what "unreadable" MEANS to the settle poll, which is an assertion, so it is
# a new mechanism that needs its own control pair and its own task.
#
# 🔴 WHAT R-1 CHANGED IS THE POSITION, NOT THE CLASS, AND THE POSITION IS THE WORSE HALF. Site 1 is
# new and it runs before everything: a hang there wedges the gate BEFORE IT HAS PRINTED ANYTHING AT
# ALL, where the older sites at least hung after some output. And THE WEDGE IS UNBOUNDED -- the suite
# wall-clock ceiling and the CPU-flat detector both arm only INSIDE the suite loop, which this call
# runs long before, so nothing in this file bounds a hang at acquisition. It is loud in the only way
# that matters (a wedged gate cannot emit a wrong number, and no green is reachable through it), and
# it is stated here because that is the difference between a limit and a surprise.
# Recorded in the file, next to the code it constrains, because a limit that lives only in a task
# report is a limit the next reader does not have.
#
# Emits ONE line: "<count> <comma-separated pids, or -> <reuseTrue>,<reuseFalse>,<noToken>,<unreadable>"
# An unreadable sample emits NOTHING, and every caller must treat empty as "cannot tell" — never as 0.
# That rule is borrowed from the CPU detector and the settle poll for the third time in this file:
# an absent measurement that reads as a healthy one is the shape of every trap in the header.
build_server_census() {
  powershell -NoProfile -NonInteractive -Command \
    "\$p = @(${BUILD_SERVER_WHERE}); \$t=0; \$f=0; \$n=0; \$u=0; foreach (\$q in \$p) { if (\$null -eq \$q.CommandLine) { \$u++ } elseif (\$q.CommandLine -match '/nodeReuse:[Tt]rue') { \$t++ } elseif (\$q.CommandLine -match '/nodeReuse:[Ff]alse') { \$f++ } else { \$n++ } }; \$ids = if (\$p.Count -gt 0) { (\$p | ForEach-Object { \$_.ProcessId }) -join ',' } else { '-' }; Write-Output \"\$(\$p.Count) \$ids \$t,\$f,\$n,\$u\"" \
    2>/dev/null | tr -d '\r' | head -1
}

# ══ A THIRD AXIS: WHO STARTED THEM (task R-1) ═══════════════════════════════════════════════════
#
# 🔴 WHY THE TWO AXES ABOVE WERE NOT ENOUGH, and it is a gap in EVIDENCE rather than in reasoning.
# The flag axis proves a NEGATIVE — "this script cannot have started that process" — and the arrival
# axis proves a boundary in time. Neither of them can name anything. An operator holding both still
# has to go and find the culprit by hand, and the gate's own advice at that point is "an IDE build
# host, another shell, a watch task", which is a list of GUESSES printed by an instrument that was
# one query away from the answer.
#
# Every process carries the id of the process that created it. Grouping the resident build servers by
# that id and resolving each one turns "13 of them, not yours" into a NAME. MEASURED during R-1 on
# this tree, and it is the reason this axis exists rather than a hypothetical for it: a gate run that
# went red with 9 resident `/nodeReuse:true` nodes had all 9 sharing ONE parent, and that parent was
# alive and was
#     dotnet.exe  ...\ms-dotnettools.csdevkit-3.20.199-win32-x64\...\visualstudio-projectsystem-buildhost...
# — the VS Code C# Dev Kit build host, which the trap-7 note at the settle poll names as a
# possibility and had never once been able to confirm. One query, and the guess became a reading.
#
# 🔴 THE POPULATION CLOSES WHERE THIS TOOL REACHES, which is the whole reason a NUMBER is allowed to
# stand here at all. Each resident build server has exactly one parent id; the parents are therefore
# enumerable, and this prints the WHOLE enumeration — every distinct parent, its count, and whether
# it is still alive — rather than a summary of it. Nothing here is a scalar standing in for a set
# nobody listed.
#
# 🔴 AND ITS TWO LIMITS, stated here with it rather than discovered later:
#   * A PARENT THAT HAS ALREADY EXITED reads as GONE, and that is the common case for a foreign
#     build whose driving process finished while its reusable nodes stayed. GONE is genuinely
#     informative — it rules out "a spawner is still running, waiting does not help" — but it names
#     nobody, and no arrangement of this query can, because the information no longer exists on the
#     machine. That is a bound on the instrument, not a defect in it.
#   * A REISSUED PARENT ID could resolve to an unrelated live process, which would name the WRONG
#     culprit. The creation instants are printed beside both so the reader can see a parent that is
#     younger than its own children; this axis is a pointer to be checked, and the flag axis remains
#     the one that carries the exclusion claim.
#
# Emits one line per distinct parent: "<count> <parentPid> LIVE|GONE <name> <command line>", then a
# terminator. NO TERMINATOR MEANS THE READING FAILED, which is how empty is kept distinguishable
# from "nothing resident" -- the same rule every other reader in this file states for itself.
build_server_parentage() {
  powershell -NoProfile -NonInteractive -Command \
    "\$p = @(${BUILD_SERVER_WHERE}); foreach (\$g in (\$p | Group-Object -Property ParentProcessId)) { \$par = Get-CimInstance Win32_Process -Filter \"ProcessId=\$(\$g.Name)\" -ErrorAction SilentlyContinue; if (\$null -ne \$par) { \$cl = if (\$null -eq \$par.CommandLine) { '<command line unreadable>' } else { \$par.CommandLine }; if (\$cl.Length -gt 200) { \$cl = \$cl.Substring(0,200) + ' ...[truncated]' }; Write-Output \"\$(\$g.Count) \$(\$g.Name) LIVE \$(\$par.Name) started \$(\$par.CreationDate.ToString('HH:mm:ss')) :: \$cl\" } else { Write-Output \"\$(\$g.Count) \$(\$g.Name) GONE - - :: (the process that started them has already exited)\" } }; Write-Output 'PARENTAGE-END'" \
    2>/dev/null | tr -d '\r'
}

# Prints the parentage axis, or says plainly that it could not be read. Never prints a reassuring
# sentence it did not measure -- the rule this file states at `build_server_census` and then broke
# once, two functions below where it was written.
report_build_server_parents() {
  local out
  out=$(build_server_parentage)
  if [[ "$out" != *"PARENTAGE-END"* ]]; then
    echo "    who started them ..................... COULD NOT BE READ (the process query returned"
    echo "                                           nothing). That is 'cannot tell', not 'nobody'."
    return
  fi
  out=$(printf '%s\n' "$out" | grep -v '^PARENTAGE-END$')
  if [[ -z "$out" ]]; then
    echo "    who started them ..................... nothing is resident, so there is no parent to name."
    return
  fi
  echo "    WHO STARTED THEM -- every distinct parent, enumerated, not summarised:"
  printf '%s\n' "$out" | sed 's/^/      /'
  echo "      A LIVE parent means the spawner is still running: waiting does not help, stopping it does."
  echo "      A GONE parent means the spawner has exited and its nodes outlived it: the population will"
  echo "      not grow again on its own, and 'dotnet build-server shutdown' on an idle machine clears it."
  echo "      🔴 This gate does NOT act on either: it never kills a BUILD SERVER it did not start."
  echo "      Naming a culprit and executing it are different powers, and only the first is safe to"
  echo "      give an unattended checker."
  echo "      🔴 SCOPED DELIBERATELY, BECAUSE THE WIDER SENTENCE WAS FALSE AND THIS RUN REFUTES IT."
  echo "      This block is only ever reached AFTER [1/3], which has already run a name-wide kill on"
  echo "      testhost.exe and vstest.console.exe -- so a test host started by hand or by an IDE is"
  echo "      already dead by the time you read this line. That kill is deliberate, it is what reaps"
  echo "      the hosts of a run that DIED, and its residual reach is declared at the line that does"
  echo "      it. What is claimed here is the narrow thing that is true: the build-server population"
  echo "      named above is measured and never touched."
}

# ══ THE SHUTDOWN, WITH ITS EVIDENCE KEPT (task P-1) ═════════════════════════════════════════════
#
# 🔴 WHAT THIS REPLACES AND WHY. Both calls used to be `>/dev/null 2>&1 || true`, which discards the
# output AND the exit code. That collapses THREE different machine states into one silence:
#   (a) the command FAILED;
#   (b) the command SUCCEEDED AND REMOVED NOTHING;
#   (c) the command succeeded and did its job.
# (b) is not hypothetical and it is not rare. MEASURED (P-1), at PID level, from this script's exact
# posture: with a foreign multi-project build IN FLIGHT, `dotnet build-server shutdown` printed
# "MSBuild server shut down successfully", exited 0, and 14 of the 15 resident processes came out the
# other side WITH THE SAME PIDS. The one that changed was the VBCSCompiler, replaced by the foreign
# build itself. Zero MSBuild nodes were terminated by a command that reported success and was believed.
# Those 14 then persist, because they carry `/nodeReuse:true`, and the settle poll below reads them —
# correctly — as a STABLE non-zero population, and the old text blamed this script's own build for them.
#
# The same command against the same population when it is IDLE removes all of it (measured twice:
# 27 -> 0, exit 0, with the full per-process before/after census on file -- 26 x /nodeReuse:true plus a
# VBCSCompiler in, nothing out). So "the command is broken" is refuted, and so is "the command ignores
# a pre-existing population" — the discriminator is whether a foreign build holds those nodes AT THE
# INSTANT OF THE CALL, which is a property of the machine and not of this script.
#
# So: keep the log, keep the exit code, and take a census on BOTH sides so the three states above are
# three different sentences. Sets SD_* for the caller to read.
#
# 🔴 THIS IS A CENSUS, NOT A POLL, AND THE DIFFERENCE IS THE WHOLE COST ARGUMENT. What the note at the
# settle poll refused to add here was a POLL — a settle loop, three readings and two sleeps, ~4.9 s
# floor on every run. This is two instantaneous readings, ~0.29 s each, and it waits for nothing. The
# refusal was about the wait; it was never about the evidence.
build_server_shutdown() {
  local label="${1:?label}"
  local log="$LOGDIR/build-server-shutdown-$label.log"
  local before after rest p

  before=$(build_server_census)
  dotnet build-server shutdown > "$log" 2>&1
  SD_RC=$?
  after=$(build_server_census)
  SD_LOG="$log"

  SD_BEFORE_COUNT=""; SD_BEFORE_PIDS=""; SD_BEFORE_POSTURE=""
  SD_AFTER_COUNT="";  SD_AFTER_PIDS="";  SD_AFTER_POSTURE=""
  if [[ -n "$before" ]]; then
    SD_BEFORE_COUNT="${before%% *}"; rest="${before#* }"
    SD_BEFORE_PIDS="${rest%% *}";    SD_BEFORE_POSTURE="${rest#* }"
  fi
  if [[ -n "$after" ]]; then
    SD_AFTER_COUNT="${after%% *}";   rest="${after#* }"
    SD_AFTER_PIDS="${rest%% *}";     SD_AFTER_POSTURE="${rest#* }"
  fi

  # Survivors: the processes that were there BEFORE the call and are still there AFTER it. This is
  # the whole point -- a count that happens to be equal on both sides would also be produced by
  # "killed 14, gained 14", which is a different machine and a different bug.
  SD_SURVIVOR_PIDS=""; SD_SURVIVOR_COUNT=0
  for p in ${SD_BEFORE_PIDS//,/ }; do
    [[ "$p" == "-" || -z "$p" ]] && continue
    case ",${SD_AFTER_PIDS}," in
      *",$p,"*) SD_SURVIVOR_PIDS="${SD_SURVIVOR_PIDS}${SD_SURVIVOR_PIDS:+,}$p"
                SD_SURVIVOR_COUNT=$((SD_SURVIVOR_COUNT + 1)) ;;
    esac
  done

  if [[ $SD_RC -ne 0 ]]; then
    SD_VERDICT="FAILED"
    SD_DETAIL="exit ${SD_RC} -- the command itself failed; see ${log}"
  elif [[ -z "$SD_BEFORE_COUNT" || -z "$SD_AFTER_COUNT" ]]; then
    # Never read an absent census as a clean one. This does not fail the run on its own: the settle
    # poll below is the assertion on the population and it already refuses to settle on an unreadable
    # sample. What this must not do is report a reassuring word it did not measure.
    #
    # 🔴 THAT IS A DEPENDENCY, NOT AN OBSERVATION, AND IT IS LOAD-BEARING (P-1 fix round 2). Not
    # failing here is only legitimate BECAUSE `build_node_sample` returning empty forces
    # `_bn_stable=0`, never settles, and FAILs the run -- so there is no path on which an
    # unmeasurable population lets this gate go green. IF A FUTURE TASK EVER LETS THAT POLL DEGRADE
    # GRACEFULLY ON UNREADABLE SAMPLES, THIS BRANCH SILENTLY BECOMES THE FORBIDDEN
    # skip-when-unmeasurable. Whoever touches the poll's empty-sample handling owns this line too.
    SD_VERDICT="UNMEASURED"
    SD_DETAIL="exit ${SD_RC}, but the population could not be read (PowerShell absent or refusing) -- cannot tell what it did"
  elif [[ "$SD_BEFORE_COUNT" == "0" ]]; then
    SD_VERDICT="NOTHING-TO-DO"
    SD_DETAIL="exit 0, 0 resident before the call -- nothing to shut down"
  elif [[ $SD_SURVIVOR_COUNT -eq 0 ]]; then
    SD_VERDICT="EFFECTIVE"
    SD_DETAIL="exit 0, ${SD_BEFORE_COUNT} -> ${SD_AFTER_COUNT}, none of the ${SD_BEFORE_COUNT} survived"
  else
    SD_VERDICT="NO-EFFECT"
    SD_DETAIL="exit 0 AND IT REPORTED SUCCESS, but ${SD_SURVIVOR_COUNT} of ${SD_BEFORE_COUNT} resident process(es) came out with the SAME PIDs (${SD_SURVIVOR_PIDS}); ${SD_BEFORE_COUNT} -> ${SD_AFTER_COUNT}"
  fi
  SD_DETAIL="${SD_VERDICT}: ${SD_DETAIL} [posture before ${SD_BEFORE_POSTURE:-?}, after ${SD_AFTER_POSTURE:-?}; reuse:true,reuse:false,no-token,unreadable]"
}

# ══ WHOSE ARE THEY (task P-1) ═══════════════════════════════════════════════════════════════════
# Prints an indented provenance block for the population resident RIGHT NOW, on the two failure paths
# that have a population to explain. Both axes are described at the census above; this is where they
# are turned into sentences.
#
# 🔴 WHY THIS IS ONLY ON THE FAILURE PATHS, since trap 9 says every number is asserted or deleted and
# this one is neither. On a passing run the settled population is ZERO, so there is no posture to
# report and no provenance to attribute -- the block would print four zeroes and mean nothing. The
# numbers it does print are read BY A HUMAN ALONGSIDE A VERDICT that has already been decided by the
# settle poll, which is the one use trap 9 explicitly allows. And the reason the gate-entry population
# is NOT itself asserted is trap 7: an inherited population is normal and harmless -- the pre-build
# shutdown clears it, measured 27 -> 0 with a full per-process census -- so failing on it would red
# every run made with an editor open, which is precisely the crying-wolf failure this file has now
# paid for three times.
attribute_build_servers() {
  local census rest now_count now_pids now_posture p t f n u entry_known shutdown_known
  local inherited=0 arrived=0 inh_pids="" arr_pids=""
  local survived=0 arrived_late=0 surv_pids="" late_pids=""
  census=$(build_server_census)
  if [[ -z "$census" ]]; then
    echo "  WHERE THIS POPULATION CAME FROM: it could not be read at all (PowerShell absent or refusing)."
    echo "    That is 'cannot tell'. This gate reports it and never waves it through."
    return
  fi
  now_count="${census%% *}"; rest="${census#* }"
  now_pids="${rest%% *}";    now_posture="${rest#* }"
  IFS=',' read -r t f n u <<< "$now_posture"

  # 🔴 THE TWO AXES DEGRADE INDEPENDENTLY, AND THE FIRST VERSION OF THIS FUNCTION GOT IT WRONG
  # (P-1 fix round 1, found by review). `${GATE_ENTRY_PIDS:--}` collapsed two states that are not the
  # same: "the entry census was never read" and "the entry census was read and the machine was empty".
  # Both became `-`, every survivor fell to the arrived arm, and the gate printed `INHERITED 0` /
  # `appeared while this run was going N` WITH FULL CONFIDENCE on a run where it had no baseline.
  # That is the exact rule stated at `build_server_census` -- "every caller must treat empty as
  # 'cannot tell', never as 0" -- broken by a caller two functions below it, by the hand that wrote
  # the rule. It is also §8.1(f) resurfacing inside the instrument built to answer (f): the FLAG axis
  # reads a property of the process and stands outside this script, but "was it in the set I saw when
  # I started" is a property of THE OBSERVER'S TIMELINE, and a position-derived instrument fails in
  # position-derived ways.
  #
  # So the arrival axis is refused outright when it has no baseline, and the flag axis is printed
  # anyway -- it needs no baseline, and it is the axis that carries the exclusion claim.
  entry_known=1
  [[ -z "${GATE_ENTRY_PIDS:-}" ]] && entry_known=0
  if [[ $entry_known -eq 1 ]]; then
    for p in ${now_pids//,/ }; do
      [[ "$p" == "-" || -z "$p" ]] && continue
      case ",${GATE_ENTRY_PIDS}," in
        *",$p,"*) inherited=$((inherited + 1)); inh_pids="${inh_pids}${inh_pids:+,}$p" ;;
        *)        arrived=$((arrived + 1));     arr_pids="${arr_pids}${arr_pids:+,}$p" ;;
      esac
    done
  fi

  # ══ THE SHUTDOWN-INSTANT AXIS -- A THIRD AXIS, BECAUSE TWO WAS THE WRONG NUMBER ═══════════════
  # 🔴 THE DEFECT THIS FIXES, RECORDED BECAUSE IT IS THE SUBTLEST ONE IN THIS FILE'S NEW CODE
  # (P-1 fix round 2, found by review). The block used to end by telling the operator that the
  # `appeared while this run was going` count was what separated SURVIVAL from ARRIVAL. IT IS NOT.
  # That count is keyed on GATE ENTRY; SURVIVAL and ARRIVAL are decided at THE SHUTDOWN INSTANT.
  # Those are two different moments, and everything a foreign build spawns BETWEEN them is a
  # SURVIVAL case that the entry axis reports as an arrival.
  #
  # It is not a hypothetical: the control pair filed as this block's OWN evidence is exactly that
  # run -- 7 of 8 came out with the SAME PIDs (SURVIVAL) while the entry axis printed
  # `INHERITED 0 / appeared 8`. An operator following the old sentence read 8/8 arrived, took the
  # ARRIVAL remedy, and would have gone looking for a spawner to stop while the true remedy was to
  # WAIT for a build that was already finishing. A discriminator that points at the wrong instant is
  # worse than none, because it is confident.
  #
  # So the split is COMPUTED here rather than left as arithmetic for a human to do across two
  # printed lines. The author of the old sentence did that arithmetic by hand for the comment beside
  # it and got the number INVERTED (wrote "1 survivor of 8" for a capture showing 7) -- which is the
  # argument for computing it, made by the person who most wanted to believe he could do it by eye.
  #
  # 🔴 AND IT CARRIES ITS OWN EMPTY-VS-UNKNOWN GUARD, because that is the exact bug round 1 fixed on
  # the entry axis and it would otherwise reappear here verbatim: an empty POST_SHUTDOWN_SURVIVORS
  # means "measured, and nothing survived" when the verdict is EFFECTIVE or NOTHING-TO-DO, and it
  # means "we never found out" when the verdict is UNMEASURED. The VERDICT is what separates them,
  # so the verdict is what this branches on -- never the emptiness of the list.
  # 🔴 `FAILED` IS LISTED HERE AND IT IS CURRENTLY UNREACHABLE, WHICH IS THE REASON TO LIST IT
  # (P-1 fix round 3, found by review). Today a FAILED post-build shutdown never gets this far:
  # `assert_shutdown_ran` exits the run BEFORE `POST_SHUTDOWN_VERDICT` is even assigned. So the arm
  # was complete BY ARRANGEMENT -- by the order of two adjacent statements at the call site -- rather
  # than BY CONSTRUCTION. Swap those two lines, which is a reordering nobody would think twice about,
  # and a FAILED shutdown reaches this guard, passes it, and yields a COMPUTED SURVIVAL/ARRIVAL SPLIT
  # DERIVED FROM A COMMAND THAT NEVER RAN. That is a confident number about a call that did not
  # happen, which is this file's oldest failure shape.
  #
  # A guard whose correctness lives in a neighbouring statement's position is not a guard, it is a
  # coincidence with good manners. This one now stands on its own: every verdict under which the
  # before-set is not trustworthy is named, whether or not today's control flow can deliver it.
  shutdown_known=1
  case "${POST_SHUTDOWN_VERDICT:-}" in
    ""|UNMEASURED|FAILED) shutdown_known=0 ;;
  esac
  if [[ $shutdown_known -eq 1 ]]; then
    for p in ${now_pids//,/ }; do
      [[ "$p" == "-" || -z "$p" ]] && continue
      case ",${POST_SHUTDOWN_SURVIVORS:-}," in
        *",$p,"*) survived=$((survived + 1));    surv_pids="${surv_pids}${surv_pids:+,}$p" ;;
        *)        arrived_late=$((arrived_late + 1)); late_pids="${late_pids}${late_pids:+,}$p" ;;
      esac
    done
  fi
  echo "  WHERE THIS POPULATION CAME FROM -- measured on the live processes, not inferred:"
  echo "    resident now ......................... ${now_count} (pids ${now_pids})"
  if [[ $entry_known -eq 1 ]]; then
  echo "    present at gate entry, before this script acted"
  echo "                        -> INHERITED ..... ${inherited}${inh_pids:+ (pids ${inh_pids})}"
  echo "    appeared while this run was going .... ${arrived}${arr_pids:+ (pids ${arr_pids})}"
  else
  echo "    arrival axis ......................... NOT ATTRIBUTABLE ON THIS RUN. The gate-entry census"
  echo "                                           was never read (the pre-build shutdown reported"
  echo "                                           UNMEASURED), so there is no baseline to ask 'was it"
  echo "                                           already there'. This is 'cannot tell' -- it is NOT"
  echo "                                           'nothing was inherited'. The flag axis below is"
  echo "                                           unaffected: it reads a property of each process and"
  echo "                                           needs no baseline."
  fi
  if [[ $shutdown_known -eq 1 ]]; then
  echo "    measured at the POST-BUILD SHUTDOWN INSTANT -- this is the SURVIVAL/ARRIVAL split:"
  echo "      SURVIVAL: still here with the SAME PID across that call"
  echo "                                       ... ${survived}${surv_pids:+ (pids ${surv_pids})}"
  echo "      ARRIVAL:  not in that call's before-set, so they started after it"
  echo "                                       ... ${arrived_late}${late_pids:+ (pids ${late_pids})}"
  else
  echo "    SURVIVAL/ARRIVAL split ............... NOT ATTRIBUTABLE ON THIS RUN. The post-build shutdown"
  echo "                                           reported ${POST_SHUTDOWN_VERDICT:-<never reached>}, so there is no trustworthy"
  echo "                                           before-set to compare against. 'Cannot tell' -- and"
  echo "                                           emphatically NOT 'none of them survived'."
  fi
  echo "    posture actually carried, vs the posture this script declares TWICE (export + build prefix):"
  echo "      /nodeReuse:true .................... ${t}  <- CANNOT be this script's. Every node it starts"
  echo "                                              carries /nodeReuse:false and exits with the build"
  echo "                                              (measured: 14 spawned, 0 resident afterwards). A live"
  echo "                                              /nodeReuse:true process came from a build that did"
  echo "                                              not disable node reuse -- an IDE build host, another"
  echo "                                              shell, a watch task. Not this run."
  echo "      /nodeReuse:false ................... ${f}  <- consistent with this script's own build, which"
  echo "                                              means it should already have exited"
  echo "      no /nodeReuse token ................ ${n}  <- VBCSCompiler / Razor server. Node reuse does not"
  echo "                                              govern them; this script's build does leave one"
  echo "      unreadable command line ............ ${u}  <- cannot tell whose. Counted, never waved through"
  report_build_server_parents
  echo "    shutdown before the rebuild .......... ${PRE_SHUTDOWN_DETAIL:-<not reached>}"
  echo "    shutdown after the rebuild ........... ${POST_SHUTDOWN_DETAIL:-<not reached>}"
  echo "  READ IT LIKE THIS, and the states are different people's problems:"
  echo "    * a shutdown reported FAILED ........ the command did not run to completion. Read its log."
  echo "      No run during this instrument's construction ever produced it, so it has no measured cause"
  echo "      to offer you -- which is said here rather than guessed at."
  echo "    * a shutdown reported NO-EFFECT ..... it printed success, exited 0, and at least one of the"
  echo "      SAME PIDs came out the other side. TWO PATHS ARE SUFFICIENT, this gate cannot always"
  echo "      separate them, and the remedy DIFFERS, so both are named:"
  echo "        (1) SURVIVAL -- nodes busy in another build at the instant of the call are not torn"
  echo "            down. Measured at PID level, n=3, every trial identical: 15 in, 15 out, 14 of the"
  echo "            same PIDs, exit 0, while the SAME call did remove the VBCSCompiler."
  echo "            Remedy: let the other build FINISH, then re-run."
  echo "        (2) ARRIVAL -- teardown worked and a foreign build started fresh nodes right after it."
  echo "            Remedy: waiting does NOT help; a live spawner will do it again. STOP it."
  if [[ $shutdown_known -eq 1 ]]; then
  echo "      USE THE SURVIVAL/ARRIVAL SPLIT ABOVE to tell them apart -- it is measured at the shutdown"
  echo "      instant, which is the moment these two differ. Do NOT use the gate-entry axis for this:"
  echo "      it answers a different question, at a different moment, and anything a foreign build"
  echo "      spawned BETWEEN gate entry and that shutdown is a SURVIVAL that the entry axis calls an"
  echo "      arrival. That mistake is on the record in this file's own control pair (7 survivors of 8,"
  echo "      printed beside 'appeared ... 8'), which is why the split above is computed, not derived."
  else
  echo "      YOU CANNOT TELL THEM APART ON THIS RUN. The split that separates them was refused above,"
  echo "      and the gate-entry axis is NOT a substitute -- it is keyed on a different moment and will"
  echo "      report a SURVIVAL as an arrival. Re-run with the population readable rather than guessing."
  fi
  echo "    * INHERITED > 0 while both shutdowns reported EFFECTIVE .. that combination is INTERNALLY"
  echo "      INCONSISTENT and is a symptom, not a diagnosis: EFFECTIVE means nothing in the entry set"
  echo "      survived, so a PID from that set being resident now is a PID-REUSE artefact -- the OS"
  echo "      handed an old number to a new process. Trust the flag axis, not the label."
  echo "    * /nodeReuse:false or a self-generated set .. then it IS this run's build, and trap 8 in the"
  echo "      build gate above is the story to read."
  echo "  WHAT THIS BLOCK DOES NOT SAY: whether this tree's code is sound. The suites have not run yet."
  echo "  A NO-EFFECT shutdown and a foreign-looking population tell you THIS RED is not about the code;"
  echo "  they cannot tell you the code is clean, and this gate will not send you away from a regression"
  echo "  it never looked for."
}

# ══ THE TWO EXITS THAT COULD NOT SAY WHY (task R-1) ═════════════════════════════════════════════
#
# THE STATE THIS ADDRESSES, stated as a property of the instrument: two of this file's assertions can
# be driven red by a condition that is not a property of the tree at all, and neither of them could
# report anything about that condition. One printed nine compiler error lines and a log path; the
# other printed a single integer and stopped. Both left the reader with a red gate and the strong
# implication that the code was at fault — which is the failure this whole file exists to prevent,
# arriving through the door marked "diagnosis" instead of the one marked "verdict".
#
# The condition is another build writing the same `obj` tree while this script's `-t:Rebuild` runs.
#
# WHAT IS MEASURED, R-1, and it is TWO things rather than three: the gate's rebuild ran on a machine
# holding ZERO build servers and came out the other side with NINE resident nodes carrying a flag
# this script never passes, all nine created inside the build window, all nine sharing ONE live
# parent, and that parent resolved to the editor's project-system build host. That is ARRIVAL (when
# they appeared) and ATTRIBUTION (who started them). Both are new, both are solid, and both are
# exactly what the axes below report.
#
# 🔴 THE THIRD THING IS NOT MEASURED, THE FIRST DRAFT OF THIS PARAGRAPH ASSERTED IT AS FACT, AND IT
# IS NOW REFUTED RATHER THAN MERELY UNSUPPORTED. The draft said the foreign build was CAUSED BY this
# script's rebuild. Nine nodes appearing during the window is CO-OCCURRENCE, which is the identical
# inference a control killed one function below ("these are downstream of it") -- the rule this file
# bought there, not applied to this file's own headline. Both arms were then run:
#
#   * ISOLATING ARM -- build host alive (two pids, recorded), a 120 s window, no gate rebuild:
#     build-server population read 0 at all seven readings. So the host is not building on a
#     schedule of its own, and the arrival above was not simply the clock.
#   * THE ARM THAT DECIDES IT -- build host alive AND VERIFIED ALIVE ON BOTH SIDES OF EVERY TRIAL
#     (the same two pids before and after each), three consecutive rebuilds under this script's
#     exact posture: 0 -> 1 every time, and the 1 is this script's own VBCSCompiler. ZERO
#     /nodeReuse:true nodes, three times out of three, WITH THE ALLEGED PROVOKER DEMONSTRABLY
#     RUNNING.
#
# A rebuild that provokes that host would have provoked it there. So the causal claim is WRONG, and
# it is withdrawn rather than softened. What the nine nodes witness is the thing that actually
# matters here and needs no causation at all: A FOREIGN BUILD CAN ARRIVE INSIDE THIS SCRIPT'S BUILD
# WINDOW ON A MACHINE THAT WAS EMPTY WHEN THE RUN STARTED. That is enough to make "clean the machine
# first and then run" an unreliable remedy, and it is the whole justification for measuring at the
# exits below instead of assuming.
#
# 🔴 WHAT THIS BLOCK ASSERTS: NOTHING. It is printed on paths that have already decided to fail, and
# it changes no verdict, no accepted set and no threshold. Trap 9's rule ("every number is asserted
# or deleted") permits exactly this use and no other: numbers read BY A HUMAN ALONGSIDE A VERDICT
# THAT IS ALREADY DECIDED. Touching that — making any line below able to turn a red green, or to
# soften one — reopens every assertion in this file, because it would make an unasserted measurement
# load-bearing.
#
# 🔴 AND THE SIGNATURE LIST IS AN OPEN SET — WHICH IS NOW A MEASUREMENT RATHER THAN A CAUTION. The
# record this file carried listed THREE diagnostics (BG1002, CS2001, CS2012) in the voice of a
# complete enumeration. A FOURTH then arrived: MSB3101, "cannot write state file ... being used by
# another process", which is a WARNING, so it walks through the 0-errors gate untouched and stops the
# run at the warning count instead — a different door, which is why nobody had met it.
#
# THEN R-1 RAN ONE CONTROL — a real `dotnet build` on the same workspace, concurrent with this
# script's own rebuild — AND THAT SINGLE RUN PRODUCED THREE MORE: MSB3030 ("could not copy the file
# ... because it was not found"), CS0006 ("metadata file ... could not be found"), and MSB3491
# ("could not write lines to file ... being used by another process"). The membership went 3 -> 4 ->
# 7, and 3 of the 4 additions arrived in ONE trial. So the openness of this set is not a hedge; it
# is the strongest thing measured about it.
#
#     LOWER BOUND: 7. DERIVATION: one member per distinct PRIMARY diagnostic observed on this tree
#     with another build active on the same workspace and a clean build immediately before and
#     after. PRIMARY means the diagnostic itself reports a file that vanished or could not be
#     written — the direct signature of two processes contending for one output directory. The set
#     is NOT closed and cannot be closed from here: its true membership is whatever MSBuild, Roslyn
#     and the WPF markup pass emit under that contention, and nothing on this machine can enumerate
#     that.
#
# 🔴 AND THE CASCADE IS NAMED SEPARATELY, because it is what a reader actually sees and it is
# terrifying out of context. In that same control the top line of the error census was `190 error
# CS0246`, with 168 CS0234, 46 CS0103, 12 CS0534 and 12 CS0012 under it — which reads as a tree that
# has lost hundreds of symbols. It had lost NONE. All of them are downstream of ONE CS0006: a
# reference assembly that a concurrent build deleted mid-compile, after which every type in it is
# unresolvable. Counting a cascade as evidence of scale is how a race gets reported as a rewrite, so
# the cascade codes are listed as derived and are deliberately NOT members of the set above.
#
# 🔴 SO THE VERDICT LINE BELOW DOES NOT REST ON THE LIST. It rests on the live process population,
# which DOES close where this tool reaches: at an instant, the set of processes matching this file's
# one build-server predicate is finite, enumerable by id, and every member is printed. The list of
# codes is a corroborating hint and is labelled as one; a red that shows no listed code is not
# thereby exonerated, and that is said in the output rather than left to be inferred.
#
# 🔴 WHAT WOULD REFUTE THE WHOLE PARAGRAPH, named so that it can be run (§8.1(b)): any of these
# diagnostics reproducing on this workspace WITH NO OTHER BUILD ACTIVE — no second `dotnet build` or
# `msbuild`, no IDE build host, no watch task. The population block printed below is the instrument
# for "was anything else active", so the two halves of this report check each other; if it says the
# machine was empty and a signature is present anyway, this paragraph is WRONG and the tree is the
# suspect again.
# 🔴 HOW OFTEN CS0006 ARRIVES WITHOUT A RACE, MEASURED ON THIS BUILD COMMAND RATHER THAN ASSUMED,
# because the answer changes what the cascade note below is allowed to say and it is not the obvious
# one. The natural claim is "CS0006 is what every project emits when a project it references failed
# to compile". On THIS gate's command -- one `dotnet build -t:Rebuild` over the whole solution --
# that is FALSE, and R-1 measured it twice: break a referenced project outright and MSBuild does not
# build its dependents AT ALL, so the log carries the referenced project's own compile errors
# (CS1519/CS1002 in the trial) and ZERO CS0006. The dependents never run, so they never miss
# anything.
# What DOES produce it here is the file being absent when a dependent compiles ANYWAY -- measured by
# deleting one reference assembly out of obj/ during the build: 6 x CS0006 immediately. So on this
# command the ordinary, no-race path to CS0006 is a HALF-POPULATED obj/ tree (an interrupted build,
# a hand-deleted bin/, a partial clean), not a plain compile error upstream. Rarer than the natural
# claim, and still real, which is why the caveat below is a caveat and not a removal.
FOREIGN_OBJ_RACE_CODES="BG1002 CS2001 CS2012 MSB3101 MSB3030 CS0006 MSB3491"
FOREIGN_OBJ_RACE_LOWER_BOUND=7
# Downstream of a member above (chiefly of CS0006), never a member itself. See the cascade note.
FOREIGN_OBJ_RACE_CASCADE_CODES="CS0246 CS0234 CS0103 CS0534 CS0012"

foreign_build_report() {
  local why="${1:?why}" census rest now_count now_pids now_posture t f n u
  local p arrived=0 arr_pids="" entry_known=1 code found=0 hits sample casc holders
  echo "  ══ WAS ANOTHER BUILD TOUCHING THIS WORKSPACE? — MEASURED AT THIS EXIT, NOT GUESSED ══"
  echo "  This block asserts nothing and cannot change the verdict above. It exists because ${why},"
  echo "  and that outcome has a cause this gate can measure but never used to report."

  census=$(build_server_census)
  if [[ -z "$census" ]]; then
    echo "  POPULATION: COULD NOT BE READ (the process query returned nothing). That is 'cannot tell'."
    echo "    Nothing below is a claim that the machine was quiet -- an unread population is not an"
    echo "    empty one, and this gate says so rather than filling the silence."
  else
    now_count="${census%% *}"; rest="${census#* }"
    now_pids="${rest%% *}";    now_posture="${rest#* }"
    IFS=',' read -r t f n u <<< "$now_posture"
    [[ -z "${GATE_ENTRY_PIDS:-}" ]] && entry_known=0
    if [[ $entry_known -eq 1 ]]; then
      for p in ${now_pids//,/ }; do
        [[ "$p" == "-" || -z "$p" ]] && continue
        case ",${GATE_ENTRY_PIDS}," in
          *",$p,"*) ;;
          *) arrived=$((arrived + 1)); arr_pids="${arr_pids}${arr_pids:+,}$p" ;;
        esac
      done
    fi
    if [[ "${t:-0}" -gt 0 ]]; then
      echo "  🔴 YES -- A BUILD THAT IS NOT THIS ONE IS RESIDENT ON THIS MACHINE RIGHT NOW."
      echo "    ${t} process(es) carry /nodeReuse:true. This script refuses node reuse twice (the export"
      echo "    at the top of this file and the prefix on its build line) and every MSBuild WORKER NODE"
      echo "    it starts carries the opposite flag and exits with the build -- measured in both"
      echo "    directions, and re-measured in R-1: five consecutive rebuilds under this posture left"
      echo "    zero of them. (Its build does leave one VBCSCompiler, which carries no /nodeReuse token"
      echo "    at all and is counted on the third line below -- node reuse does not govern it.)"
      if [[ $entry_known -eq 1 && $arrived -gt 0 ]]; then
        echo "    ${arrived} of them (pids ${arr_pids}) were NOT here when this run started, so they were"
        echo "    STARTED WHILE THIS RUN WAS GOING -- inside the window whose result you are reading."
      elif [[ $entry_known -eq 1 ]]; then
        echo "    All of them were already resident when this run started. The shutdown this script runs"
        echo "    before its build is what should have cleared them; read its verdict below -- NO-EFFECT"
        echo "    there means they were HELD BUSY by a build in flight at that instant."
      fi
      echo "    WHAT THIS DOES AND DOES NOT SETTLE: it settles that the failure above happened on a"
      echo "    machine that was not this run's alone. It does NOT settle that the tree is sound -- no"
      echo "    suite has run, and this gate will not send you away from a regression it never sought."
    elif [[ "${u:-0}" -gt 0 ]]; then
      echo "  CANNOT TELL: ${u} resident build server(s) will not surrender a command line, so whether"
      echo "    they are this run's cannot be read. Counted, never waved through."
    else
      echo "  NOT BY THIS MEASUREMENT: at this instant ${now_count:-0} build server(s) are resident and"
      echo "    none carries a flag this script could not have produced."
      echo "    🔴 READ THAT AS A LOWER BOUND, NOT AN ACQUITTAL. This is a census at ONE INSTANT, not a"
      echo "    watcher: a foreign build that started and finished inside this run's build window leaves"
      echo "    nothing here to see, and the diagnostics below are then the only trace of it. The same"
      echo "    blind spot is named by the settle poll and by the credential bracket for themselves."
    fi
    attribute_build_servers
  fi

  echo "  DIAGNOSTICS IN THIS BUILD'S LOG THAT AN OUTPUT-DIRECTORY RACE IS KNOWN TO PRODUCE:"
  for code in $FOREIGN_OBJ_RACE_CODES; do
    hits=$(grep -c -- "$code" "$BUILD_LOG" 2>/dev/null || true)
    [[ "${hits:-0}" == "0" ]] && continue
    found=$((found + 1))
    sample=$(grep -m1 -- "$code" "$BUILD_LOG" 2>/dev/null | sed 's/^[[:space:]]*//' | cut -c1-180)
    echo "    ${code} x${hits}: ${sample}"
  done
  if [[ $found -eq 0 ]]; then
    echo "    none of the ${FOREIGN_OBJ_RACE_LOWER_BOUND} known members is present."
  fi
  # 🔴 "CS2012 NAMES THE PROCESS" IS TRUE OF THE DIAGNOSTIC AND NOT OF EVERY INSTANCE OF IT, which
  # the record above states universally and which R-1 measured both ways on this tree in one hour.
  # The SDK appends "locked by <name>" only when it could resolve the handle's owner; when it could
  # not, the message names the FILE and stops. The first draft of this block printed the header
  # unconditionally and, on the run that could not resolve an owner, produced a 🔴 line with nothing
  # under it -- an instrument announcing evidence it did not have, in the block whose whole subject
  # is the difference between measuring and implying.
  if grep -q 'CS2012' "$BUILD_LOG" 2>/dev/null; then
    holders=$(grep -oE "locked by '[^']*'" "$BUILD_LOG" 2>/dev/null | sort -u | head -5)
    if [[ -n "$holders" ]]; then
      echo "    🔴 START WITH CS2012 -- on THIS run it named the process holding the file:"
      printf '%s\n' "$holders" | sed 's/^/      /'
    else
      echo "    CS2012 is present and THIS log does not name a holding process: the SDK resolves the"
      echo "    handle's owner only when it can, and here it could not. The message still names the"
      echo "    FILE, which is the next thing to look at."
    fi
  fi
  # 🔴 PRINTED ON CS0006'S OWN PRESENCE, NOT ON THE CASCADE ARM (review, N1 + R-1's own re-walk).
  # The corrected wording first went into the cascade arm, which additionally requires a resolution
  # error in the same log -- so the run that shows CS0006 by itself, which is the common shape,
  # printed nothing at all about it. A caveat an operator only meets in the rarer of two states is
  # not a caveat. Walked: a reference assembly removed from obj/ mid-build gives 6 x CS0006 and this
  # block prints.
  if grep -q 'CS0006' "$BUILD_LOG" 2>/dev/null; then
    echo "    🔴 CS0006 DOES NOT TELL YOU WHICH CAUSE. All it reports is that a metadata file was not"
    echo "    there when a dependent compiled. TWO things do that on this build command: a contending"
    echo "    build removing it mid-compile, or an obj/ tree that was already half populated -- an"
    echo "    interrupted build, a hand-deleted bin/, a partial clean. This block cannot separate them"
    echo "    and does not try."
    echo "    WHAT IT IS *NOT*, MEASURED IN R-1 RATHER THAN ASSUMED: it is NOT what a referenced"
    echo "    project that simply failed to compile gives you. MSBuild does not build the dependents of"
    echo "    a failed project at all, so that log carries the broken project's OWN errors and ZERO"
    echo "    CS0006. If you are reading this line, the reference was missing while something compiled"
    echo "    against it anyway -- a fact about this workspace's obj/ tree, which says nothing either"
    echo "    way about the source."
  fi
  casc=""
  for code in $FOREIGN_OBJ_RACE_CASCADE_CODES; do
    hits=$(grep -c -- "$code" "$BUILD_LOG" 2>/dev/null || true)
    [[ "${hits:-0}" == "0" ]] && continue
    casc="${casc}${casc:+, }${code} x${hits}"
  done
  # 🔴 THE CASCADE NOTE IS CONDITIONAL ON A PRIMARY MEMBER BEING PRESENT, AND THAT CONDITION IS THE
  # WHOLE SAFETY OF IT. These same codes are ALSO what an ordinary broken tree emits. Printing "do
  # not read the largest number as the worst news" over a genuine regression would be this file
  # talking a reader out of a real defect -- the one direction it must never fail in. So the
  # reassurance is attached to the evidence that licenses it, and its absence is stated just as
  # plainly.
  if [[ -n "$casc" ]] && grep -q 'CS0006' "$BUILD_LOG" 2>/dev/null; then
    echo "    AND THE CASCADE, WHICH IS NOT MORE EVIDENCE -- IT IS THE SAME EVIDENCE, COUNTED AGAIN:"
    echo "      ${casc}"
    echo "      CS0006 names a metadata file that was not there, and every type that file declared is"
    echo "      unresolvable afterwards, so these counts are DOWNSTREAM OF IT. That much is a fact"
    echo "      about the compile graph and holds whatever removed the file. Their SIZE therefore says"
    echo "      nothing about the size of the problem: measured here, ONE missing assembly produced"
    echo "      190 CS0246."
    echo "      The link is CS0006, whose own note is printed above."
  elif [[ -n "$casc" && $found -gt 0 ]]; then
    echo "    RESOLUTION ERRORS AND A RACE SIGNATURE ARE BOTH PRESENT, AND THIS BLOCK CANNOT ORDER"
    echo "    THEM:"
    echo "      ${casc}"
    echo "      A member above fired, so something did contend for this workspace -- but the member"
    echo "      that fired does not name a missing metadata file (CS0006 is the one that does), so"
    echo "      nothing here links these resolution errors to it. They may be downstream of the"
    echo "      contention or they may be the tree's own. 🔴 Measured, R-1: this exact combination"
    echo "      was produced with a deliberately broken source file AND a genuinely locked state"
    echo "      file, where the two had NO causal relation at all -- which is why this arm exists"
    echo "      rather than the confident sentence that used to stand here."
  elif [[ -n "$casc" ]]; then
    echo "    RESOLUTION ERRORS ARE PRESENT AND NO RACE SIGNATURE IS:"
    echo "      ${casc}"
    echo "      These codes appear BOTH downstream of a vanished reference assembly AND in an"
    echo "      ordinarily broken tree, and on this run nothing above licenses the first reading."
    echo "      🔴 So read them as the TREE'S. This gate will not talk you out of a real regression"
    echo "      on the strength of a population reading that came back empty."
  fi
  echo "    THIS LIST IS OPEN, and its openness is MEASURED rather than assumed: it stood at THREE"
  echo "    members, stated as complete, until MSB3101 was found passing the 0-errors gate and"
  echo "    stopping the run at the warning count instead -- and then ONE control run with a real"
  echo "    concurrent build added THREE more (MSB3030, CS0006, MSB3491). 3 -> 4 -> ${FOREIGN_OBJ_RACE_LOWER_BOUND}."
  echo "    LOWER BOUND ${FOREIGN_OBJ_RACE_LOWER_BOUND}, derived as one member per distinct PRIMARY diagnostic seen on this"
  echo "    tree with another build active and a clean build either side of it, where PRIMARY means"
  echo "    the diagnostic itself names a file that vanished or could not be written."
  echo "    A red showing NONE of them is therefore not cleared by their absence -- the population"
  echo "    block above is what decides, and this list only corroborates."
  echo "    🔴 AND THE OTHER DIRECTION, WHICH IS THE ONE THAT COULD HURT: PRESENCE IS CORROBORATION,"
  echo "    NOT CONVICTION. CS0006 and MSB3030 both also arise with NOTHING contending for this"
  echo "    workspace -- a half-populated obj/ tree, an interrupted build, a deleted bin/ -- because"
  echo "    all either one reports is that a file it needed was not there. Seeing them does not"
  echo "    establish a race and does not exonerate the tree. Absence is no acquittal; presence is no"
  echo "    conviction; the population block is the only thing in this output that MEASURES."
  echo "    Full build log: $BUILD_LOG"
}

# ══ THE ASSERTION ON THE COMMAND ITSELF (task P-1) ══════════════════════════════════════════════
# The old form's `|| true` was the SECOND half of the discarded evidence, and the note at the settle
# poll defended only the first: it argued that nothing reads a verdict between the pre-build shutdown
# and the build, so there is no instant there that can be MIS-MEASURED. That is true, and it is silent
# about the other half -- if the command FAILS, nothing notices, at either site. It costs one integer
# to notice, and no wait at all.
#
# 🔴 THIS BRANCH HAD NEVER BEEN WALKED WHEN IT SHIPPED, AND THAT IS ITS OWN HAZARD (P-1 fix round 1).
# No non-zero exit from `dotnet build-server shutdown` was observed in ANY state during this task --
# not idle, not busy, not against an empty machine. So this is a hard red on a state nobody had
# produced, which is the shape of trap 7: a path that first executes at the worst possible moment.
# It is now exercised under control, with a `dotnet` stub that exits non-zero and an otherwise
# identical run: FAILED classifies, this function exits 1, and the message names the log. The
# companion UNMEASURED branch is exercised the same way with a `powershell` stub that emits nothing,
# and it deliberately does NOT fail here -- the settle poll is the assertion on the population, and
# two hard reds on one property is how a checker starts crying wolf.
assert_shutdown_ran() {
  local when="${1:?when}"
  [[ "$SD_VERDICT" != "FAILED" ]] && return 0
  echo "FAIL: 'dotnet build-server shutdown' ${when} exited ${SD_RC}."
  echo "  ${SD_DETAIL}"
  echo "  This is the state the old '|| true' swallowed. Two things produce it, and the log tells them"
  echo "  apart: the command ran and failed, OR it never started because its log could not be created"
  echo "  (bash does not run a command whose redirection fails, and reports 1 for that too)."
  echo "  Command output: ${SD_LOG}"
  exit 1
}

# ── Gate 1: the build. Nothing below is trustworthy until this passes. ───────────
# Trap 1 and 4. Read the LOG, not the exit code: a locked file can leave a project
# unrelinked while the overall invocation still reports success.
# 🔴 TRAP 1, RESTATED AFTER SOMEONE RAN INTO IT FROM THE OTHER SIDE (E-3, Đợt E). The kill below is why
# THIS SCRIPT IS NOT RE-ENTRANT: launch a second run while a first is still going and the second's cleanup
# kills the first's live test host mid-suite. E-3 did exactly that and got
# `St4i.Connector.Conformance.Tests: ABORTED (host crash)` — trap 1, self-inflicted, on a healthy tree.
#
# The half worth writing down is not the FAIL. It is what the implementer said about the other run:
# **a PASS from a raced run is exactly as worthless as the FAIL.** Both runs were racing, so neither
# number describes the tree. The instinct on seeing the red is to re-read the passing one and move on —
# and that instinct is what turns a self-inflicted abort into a recorded fact about the code.
#
# One gate at a time. If two are running, discard both and start one.
#
# 🔴 R-1 CHANGED WHAT THESE TWO LINES MEAN, WITHOUT CHANGING THEM — WHICH IS WHY THIS PARAGRAPH IS
# PART OF THE CHANGE. Everything above stays true about the OLD conduct and is kept as the record of
# it. What is no longer true is the sentence "this script is not re-entrant" read as a warning to the
# operator: re-entry is now REFUSED at the exclusive-run lock near the top of this file, before this
# line and before anything else this script does. Two consequences, and both are the deliverable:
#   * A SECOND RUN NO LONGER REACHES THIS KILL. It stops at the lock, kills nothing, measures
#     nothing, and names the holder. The E-3 outcome above cannot be produced by two runs of this
#     file any more.
#   * THIS KILL KEPT ITS JOB AND LOST ITS VICTIM. Its legitimate purpose was always reaping the test
#     hosts a run that DIED left behind -- nothing else on this machine reaps them, and the next
#     build fails on their file locks. It is name-wide because an orphan has no parent left to be
#     found by. That was safe only by luck before; it is safe by CONSTRUCTION now, because this line
#     is unreachable unless this run holds the only lock, so no test host it can see belongs to a
#     live gate run.
#
# 🔴 AND WHAT IS STILL OUTSIDE THAT, said plainly rather than left to be discovered: a `dotnet test`
# or a test run started by an IDE, by hand, in another window, IS still killed by these two lines.
# The lock excludes other runs OF THIS FILE; it says nothing about anyone else's test host, and no
# lock could. Narrowing this kill to a set this script can prove it owns would need a different
# instrument (an orphan has no owner to prove), so it is recorded here rather than half-fixed.
echo "[1/3] Killing stray test hosts, then rebuilding..."
taskkill //F //IM testhost.exe //T >/dev/null 2>&1 || true
taskkill //F //IM vstest.console.exe //T >/dev/null 2>&1 || true

# 🔴 THE BASELINE THIS SCRIPT NEVER TOOK (task P-1). The census inside this call, on its BEFORE side,
# is the population this run WALKED INTO -- taken before this script has built anything, so nothing
# in it can be this script's doing. Everything downstream that says the word "inherited" means
# "was in this set", and that is the only sense in which this script is entitled to use the word.
build_server_shutdown pre-build
assert_shutdown_ran "before the rebuild"
GATE_ENTRY_COUNT="$SD_BEFORE_COUNT"
GATE_ENTRY_PIDS="$SD_BEFORE_PIDS"
GATE_ENTRY_POSTURE="$SD_BEFORE_POSTURE"
PRE_SHUTDOWN_DETAIL="$SD_DETAIL"
note "build servers at gate entry: ${GATE_ENTRY_COUNT:-unreadable} (posture ${GATE_ENTRY_POSTURE:-?}) -- shutdown ${SD_DETAIL}"

# 🔴 §8.1(h7), AND IT IS THE SMALLEST INSTRUMENT IN THIS FILE: NOTHING HERE EVER READ THE POSTURE
# THIS SCRIPT DECLARES. Node reuse is refused twice -- the export at the top and the inline prefix on
# the build line below -- and the redundancy is deliberate (see the K-1 note at the export: the prefix
# alone left the five `dotnet test` invocations taking whatever posture the OPERATOR happened to have).
# Two declarations, and until now zero readings of either. This reads the one that is readable.
# It cannot be flaky and it costs nothing: it fires only if a future edit deletes the export, which is
# exactly the regression the K-1 note describes and the one that would silently hand the suites back
# to the caller's environment. The OTHER declaration -- the flag the spawned processes actually carry
# -- is read by the census, and the two together are the whole of "check the flag this script passes".
if [[ "${MSBUILDDISABLENODEREUSE:-}" != "1" ]]; then
  echo "FAIL: this script's declared node-reuse posture is not in effect."
  echo "  MSBUILDDISABLENODEREUSE is '${MSBUILDDISABLENODEREUSE:-<unset>}', expected '1'."
  echo "  The export at the top of this file is what puts every child process -- the build AND all five"
  echo "  suites -- under one posture instead of the caller's. Without it the gate's behaviour depends on"
  echo "  who ran it, which is the same class as a check that passes for the wrong reason."
  exit 1
fi

BUILD_LOG="$LOGDIR/build.log"
# 🔴 TRAP 8, and it is this script's own cleanup being right once and then never again.
# D-6 hit a RED first gate run: UnsBridgeSpoolTests died on WSAENOBUFS ("lacked sufficient
# buffer space") on a LOOPBACK MQTT connect -- a machine-wide resource failure in a subsystem
# nothing in that task touched. The implementer diagnosed it as orphaned build-server nodes and
# concluded this script does not clean them. It does, on the line above -- so that story is
# self-refuting: any TRUE pre-existing orphan is already dead by the time the build starts.
#
# The review then measured what actually happens, which is worse and is ours:
#   * ONE `dotnet build` leaves 13 MSBuild nodes (~110-150 MB each) plus a ~705 MB VBCSCompiler.
#     "13 orphaned dotnet.exe" is not the signature of accumulated rounds; it is one build.
#   * The shutdown above runs ONCE, BEFORE the build. During [2/3], with the gate unattended:
#     14 build-server processes, 1955 MB resident, alive through ALL FIVE suites.
# So the gate created a ~2 GB population and then ran the memory-sensitive part of its own job
# underneath it. That is the same shape as trap 7(i) -- the remedy manufacturing the evidence --
# one step earlier: here the tool manufactures the CONDITIONS it then measures under.
#
# Node reuse buys nothing for a one-shot -t:Rebuild, so refuse it, and shut the servers down
# again after the build so the suites do not run under the build's leftovers.
MSBUILDDISABLENODEREUSE=1 dotnet build -t:Rebuild --nologo > "$BUILD_LOG" 2>&1 || true

# 🔴 A SECOND FOREIGN-BUILD FAILURE MODE, RECORDED HERE BECAUSE THIS IS THE BRANCH THAT CATCHES IT AND
# THIS BRANCH OFFERS NO ADVICE AT ALL (P-1). If you are reading this because the gate just told you the
# build did not report 0 errors, check the log for these two signatures FIRST, before concluding
# anything about the tree:
#     error BG1002: File '...\obj\...\*.baml' cannot be found      [St4iMachineSimulator.csproj]
#     error CS2001: Source file '...\obj\...\*.g.cs' could not be found   [..._wpftmp.csproj]
#     error CS2012: Cannot open '...\obj\...\*.dll' for writing ... file may be locked by 'X' (PID)
# All three are SOMETHING ELSE WRITING THE SAME `obj` DIRECTORY while this script's `-t:Rebuild` ran
# (the first two are the WPF markup pass losing its generated files mid-flight). MEASURED during P-1:
# all three were produced on a tree that built clean immediately before and immediately after, with a
# foreign build active on the same workspace -- the VS Code C# Dev Kit build host, which also produces
# the resident `/nodeReuse:true` populations the build-node gate below reports. Same root cause,
# different gate. THE TREE WAS FINE in every case.
#
# 🔴 R-1 NARROWED THE NEXT SENTENCE, AND THE NARROWING IS A MEASUREMENT. "CS2012 names the process" is
# true of the DIAGNOSTIC and not of every INSTANCE of it: the SDK appends "locked by <name>" only when it
# could resolve the handle's owner, and R-1 saw it both ways on this tree inside one hour -- once naming
# `VBCSCompiler`, once naming only the file. The runnable block at the two build-phase exits below prints
# the holder when the log carries one and says the log does not carry one when it does not; it no longer
# announces a name it has not got. The sentence below is kept as written because it is the record of what
# was believed, and this is the correction to it.
# 🔴 START WITH CS2012 IF YOU SEE IT: alone among the three it NAMES THE PROCESS holding the file. The
# other two only tell you a file vanished, which reads like a broken tree and is not one. Note also
# that BG1002 and CS2001 did NOT reproduce on demand -- the CLASS did, every time, by simply running a
# second build against this tree -- so "I could not reproduce it" is expected here and is not evidence
# that the tree was at fault.
#
# 🔴 WHAT WOULD REFUTE ALL OF THE ABOVE, NAMED SO THAT IT CAN BE (§8.1(b); the exculpation is only
# worth anything if it ships its own falsifier):
#     ANY of these three signatures reproducing WITH NO FOREIGN BUILD ACTIVE ON THIS WORKSPACE.
# Check before you believe this note: no second `dotnet build`/`msbuild`, no IDE build host (the
# build-node census below names them), no watch task. If it reproduces on a quiet machine, this
# paragraph is WRONG and the tree is the suspect again -- and note that the population census below
# is the instrument for "was anything else active", so the two halves of this file check each other.
#
# What this exculpation actually rests on -- stated so nobody mistakes it for "it didn't reproduce, so
# it's fine": a POSITIVE CONTROL. The same tree built clean, 0 errors / 116 warnings, immediately
# BEFORE and immediately AFTER each occurrence. Non-reproduction of a SIGNATURE is a prediction of the
# race mechanism, not the evidence of innocence; the clean builds either side are the evidence.
#
# 🔴 AND DO NOT REACH FOR THE MSB3061 ADVICE BELOW: that branch says "kill stray test hosts and re-run",
# and it is UNREACHABLE for this mode -- a build that reports errors exits HERE first. So this failure
# arrives with the error greps, a log path, and nothing that names a foreign builder. That silence is
# why this note exists rather than a check: instrumenting it is a NEW build-gate assertion, it needs its
# own control pair, and P-1's brief barred both remedies that would otherwise apply (relaxing an
# assertion, and killing processes this gate does not own -- trap 7(j)). Recorded, not fixed.
# 🔴 HANDOVER, AND IT SITS DIRECTLY ON THIS PIN (R-1 residual 1, named by review rather than fixed).
# This comparison, the `Warning\(s\)` parse that feeds EXPECT_WARNINGS, and the `error [A-Za-z]+[0-9]+`
# census all match ENGLISH MSBuild output. That is the same class as the defect R-1 fixed at
# `gate_process_identity` -- a comparison keyed on an ENVIRONMENT-DEPENDENT RENDERING of a value
# rather than on the value -- except that this one sits on a PIN rather than on a diagnostic. On a
# localized SDK the pattern misses, `WARNINGS` comes out empty, and the gate REDS; so it fails safe
# and is a handover rather than an emergency. It is named here, at the pin, because the sweep that
# closes this class should start where the consequence is an assertion. (`build_server_parentage`'s
# `ToString('HH:mm:ss')` is the same class and is display-only -- evidence the sweep is small.)
if ! grep -qE '^ *0 Error\(s\)' "$BUILD_LOG"; then
  echo "FAIL: build did not report 0 errors. Refusing to read any test count."
  grep -E 'error |Error\(s\)' "$BUILD_LOG" | head -20
  # 🔴 R-1: the DISTINCT error codes, enumerated in full rather than sampled. The twenty lines above
  # are a HEAD of an unbounded list; this is the whole of a set that closes where this tool reaches
  # (the codes present in one log file), so it is stated as a set and not as a first few.
  echo "  Distinct error CODES in this build, by occurrence count (MSBuild counts a code once per"
  echo "  project that emits it, so these are pointers and not a total):"
  grep -oE 'error [A-Za-z]+[0-9]+' "$BUILD_LOG" | sort | uniq -c | sort -rn | sed 's/^/    /'
  echo "  full log: $BUILD_LOG"
  # 🔴 (h8) THE DIAGNOSIS AND ITS APPLICATION ARE TWO ACTIONS, and until R-1 only the first had been
  # taken here: the account of what an output-directory race does to this branch lived in the comment
  # block directly above, where a red run PRINTS NONE OF IT. Only somebody who opened this file ever
  # saw it, and nobody opens a build script to find out why a build failed. The block is now RUN.
  foreign_build_report "this run's build reported errors"
  exit 1
fi
# 🔴 TRAP 7(e), demonstrated live: a rebuild reported "117 Warning(s) / 0 Error(s)" of which
# TWELVE were MSB3061 "Unable to delete file ... Access to the path" -- a live process holding
# output files, so Rebuild could not delete them. THE GATE ABOVE PASSED. Its own header says
# "a locked file can leave a project unrelinked while the overall invocation still reports
# success" -- that is trap 1 verbatim, and the gate reads the log precisely to catch it, but it
# was reading the wrong line. There the un-deleted files were runner assemblies so the build
# stayed valid; MSB3061 on a PRODUCT assembly is trap 4 and the gate cannot tell them apart.
# Every suite then runs --no-build against whatever did not relink.
if grep -q 'MSB3061' "$BUILD_LOG"; then
  echo "FAIL: the rebuild could not delete build outputs (MSB3061) -- a project may not have relinked."
  grep -E 'MSB3061' "$BUILD_LOG" | head -10
  echo "  Kill stray test hosts and re-run. Full log: $BUILD_LOG"
  exit 1
fi
WARNINGS=$(grep -oE '^ *[0-9]+ Warning\(s\)' "$BUILD_LOG" | grep -oE '[0-9]+' | head -1)
note "build: 0 errors, ${WARNINGS} warnings (only comparable from -t:Rebuild on an unlocked tree)"

# 🔴 TRAP 9 — this line PRINTED the number for eight tasks and never checked it, and the branch's
# own history is the argument. The count sat at 115 across D-1..D-7; THREE separate rounds drifted
# it by exactly one (xUnit1031, then xUnit1030 from a ConfigureAwait(false) written out of src/
# habit, then two CS8767 from a test double), and every one of those was caught by a HUMAN reading
# this line -- never by the gate. One warning is precisely the size of signal that gets waved
# through, which is why it needs a check rather than better attention.
#
# This is the same shape as trap 2, one field over: a printed number that looks like evidence.
# The whole batch's rule is "assert a POSITIVE expected quantity, never the absence of failure",
# and a warning count is a quantity like any other. Move it deliberately, in the same breath as a
# test total, and say why in the block below -- a warning that arrives with a task is a fact to be
# justified, not a number to be pasted over.
#
# Deliberately NOT a ratchet ("<= EXPECTED"): a DROP is also a fact worth a sentence, and a
# one-sided bound would let a real fix that removes a warning silently rot the number until the
# next addition hides inside the slack.
# 🔴 THIS NUMBER IS PINNED TO AN SDK THAT IS NOT PINNED. There is no global.json in this repo;
# 115 was measured on 10.0.302. A colleague on a different SDK gets a red gate on a CLEAN tree from
# a shifted analyzer set. The direction is safe — it fails closed, never falsely green, and the
# message says what to do — but it is §8.1's `skipped != 0` reasoning inverted: there, an
# environment-dependent count was refused so one number would mean the same thing everywhere; here,
# an environment-dependent number is asserted. If this bites someone, the fix is a global.json, not
# a looser check. Recorded rather than left for them to discover.
# 🔴 CARRIED FINDINGS (fix/carried-findings, task 1) raises this 115 -> 116 (+1), and the +1 is ONE xUnit1013
# in St4i.EdgeCore.Tests, on the two `base`-calling Check_Write_Cancellation_… overrides this task adds:
#   "Public method '…' on test class 'DeviceDriverConformanceSuite' should be marked as a Fact.
#    Reduce the visibility of the method, or add a Fact attribute to the method."
# BOTH remedies it offers are impossible, and its premise is false. The method overrides a `public virtual`, so
# visibility cannot be reduced; marking it [Fact] would run the check TWICE, because the [Fact] wrapper right
# above it already calls it. Its premise — that a public non-[Fact] method on a test class never runs — is
# exactly wrong here.
#
# D-6's identical RTU override does NOT emit it, and the difference is the whole reason this drifted: that one
# sits on an ABSTRACT base (ModbusRtuConformanceTestsBase), which the analyzer skips. These two rigs are SEALED
# concrete classes. Reproducing the abstract-base structure on two more rigs, purely to dodge an analyzer,
# would split each rig across two types and is a worse trade than one documented warning.
#
# 🔴 A THIRD impossible remedy, and it is the one a future author will actually reach for (found by review,
# not by me): put the [Fact] on the OVERRIDE and delete the wrapper. That is blocked by the census's own
# convention — EveryCheckIsWiredOrAcknowledged requires a [Fact] on the CONCRETE SUBCLASS named identically
# MINUS the "Check_" prefix (src/St4i.Connector.Conformance/DeviceDriverConformanceSuite.cs:36-43). A [Fact]
# named Check_Write_Cancellation_... does not satisfy it, so that rig would fail the census instead.
#
# 🔴 IT IS NOT SUPPRESSED, and that was tried first and REPORTED here rather than quietly dropped: the
# diagnostic is emitted as `CSC :` with NO source location (it names the symbol's original definition, which
# lives in a referenced assembly), so a #pragma in either rig cannot reach it — measured, the count stayed at
# 116 with both pragmas in place. The mechanisms that WOULD reach it are assembly-wide (<NoWarn> or a
# GlobalSuppressions entry), and blinding St4i.EdgeCore.Tests to every future xUnit1013 to hide one known-good
# instance is a strictly larger loss than +1. A number that is justified still fails on the NEXT drift; a
# suppressed analyzer does not.
#
# 🔴 HOW THIS NUMBER GROWS, MEASURED by the review — and it is better than either of us assumed, which is
# exactly why it is written down instead of left for the next reader to guess (they would guess "+1 per rig"
# and be wrong):
#
#     tree                                                     warnings   distinct xUnit1013
#     two rigs override the SAME check (this commit)              102              1
#     + a third rig overrides a DIFFERENT check                   103              2
#     + a second rig overrides that same different check          103              2
#
# It grows per DISTINCT Check_* METHOD that any sealed rig overrides, NOT per rig — because the diagnostic
# carries no source location and names the BASE symbol, so every override of one method collapses into one
# warning. **A new driver rig applying this proven remedy costs 0.** The bad half stands: +1 the first time
# anyone applies it to a NEW check.
#
# 🔴 N-1 — THE NUMBER DID NOT MOVE AND WHAT IT WITNESSES DID. Read this before concluding "nothing changed".
# N-1's brief expected this literal to rise, because a 2026-08-08 experiment measured 116 -> 148 for ONE
# assembly. It did not rise, and the reason is the deliverable rather than an escape from it: six projects
# now set `GenerateDocumentationFile` — St4i.Connector.Conformance, St4i.EdgeCore.Serial, St4i.EdgeService,
# St4i.DesktopShell, St4i.SerialBench, St4i.SettingsAclProbe — so the compiler PARSES their `///` blocks and
# RESOLVES every symbol those blocks name, and all 33 warnings that surfaced there were FIXED rather than
# suppressed. Nothing survived, so the count is unchanged. (The 116 -> 148 figure is also wrong twice over;
# the report shows the arithmetic.)
#
# So this literal now indexes STRICTLY MORE than it did at 811c9054, at the same value. Before N-1 a green
# run here said nothing whatever about doc-comment validity anywhere in the tree — no project generated a
# documentation file, so CS1570/CS1574/CS1734/CS0419/CS1587/CS1591 could not be emitted at all and §8.1(h7)
# records that as the reason a malformed `<para>` and a rotted cross-assembly `cref` both shipped green.
# After N-1 a green run additionally witnesses: in those six projects, every `///` block is well-formed XML
# and every `cref`/`paramref` in them names something that exists.
#
# 🔴 WHAT IT STILL DOES NOT WITNESS, stated because the same green number now means two different things
# depending on the project: the other NINE projects do not set the property, so this count says exactly
# nothing about their doc comments — and 237 already-false claims are on record there (233 distinct source
# sites: five of the 237 are ONE defect in tests/Shared/TestRunTempRoot.cs, which is Compile-linked into all
# five test projects; 259 if you count the way MSBuild does, because the WPF markup pass compiles
# St4iMachineSimulator a second time), listed by file in
# .superpowers/sdd/doc-comments-compiled/task-1-report.md. They are unset because the switch also asserts
# documentation COVERAGE (CS1591, 2870 members) and that is an owner decision, not an implementer one; see
# Directory.Build.props for the measured per-project price of all fifteen.
#
# 🔴 THE THREE NUMBERS IN THE PARAGRAPH DIRECTLY ABOVE ARE WITHDRAWN, 2026-08-19, BY TASK AE-1 (item 12
# stage 2) — quoted rather than rewritten, because a reader who bookmarked them must see them retired and
# because the paragraph is the record of what was believed. Withdrawn: "237 already-false claims",
# "233 distinct source sites", "259 if you count the way MSBuild does". Re-measured at 3b773e11 on SDK
# 10.0.302 by task AD-1 (item 12 stage 1) and independently reproduced by this task, both from a full
# `dotnet build -t:Rebuild -p:GenerateDocumentationFile=true` — a DIAGNOSTIC that sets the property for one
# invocation and writes nothing to the tree:
#     239   already-false cref/paramref claims across the eight unset projects (101/43/34/32/22/5/1/1)
#     235   distinct source sites  (239 - 4: five of the 239 are ONE defect in tests/Shared/
#           TestRunTempRoot.cs, Compile-linked into all five test projects)
#     261   counting the way MSBuild does, because the WPF markup pass compiles St4iMachineSimulator again
# The class GREW BY TWO WHILE NOTHING WATCHED IT, and both arrived in one commit, 4d1422a7, inside the last
# merge before item 12's stage 1 began: a CS1574 in BoundServerAddressesTests.cs (a `cref="Collection"` that
# does not resolve) and a CS0419 in OperatorDataRemovalCensusTests.cs (an ambiguous
# `cref="Directory.CreateDirectory"`). That is N-1's lesson repeating one layer up — N-1 emptied the
# malformed-BLOCK class and the very next task refilled it, which is why DocCommentProseTests is a standing
# assertion; the unresolvable-CREF class is refilling on the same rhythm and STILL has nothing watching it.
# It is item 12's stage 3 that closes it, not this one.
#
# 🔴 THAT LAST PARAGRAPH IS A MEASUREMENT, NOT A CAVEAT — negative control, run on this gate, N-1.
# One `</para>` was deleted from a doc block in FleetCore.cs, recreating one of the four malformed blocks
# J-3 needed a purpose-built parser to find. The defect was confirmed present by two independent instruments
# (that parser: 1 block failing to parse; the compiler with the flag on: 2 x CS1570). This gate was then run
# end to end against it:
#     build: 0 errors, 116 warnings ... PASS: 0 build errors, 5/5 suites at their exact expected totals (2657)
# Full green, exit 0, this number unmoved. Say it the way §8.1(h6) requires: the gate did not weaken, did not
# strengthen, DID NOT NOTICE — and it did not fail, because nothing is indexed there for St4i.EdgeCore. The
# positive control is the mirror: the same class of defect placed in one of the SIX takes this to 119 and
# exits 1. Same gate, same defect class, two projects, opposite verdicts. That is the boundary, measured.
#
# To ask the whole tree the question this gate only asks of six projects, from tools/machine-simulator:
#     dotnet build -t:Rebuild -p:GenerateDocumentationFile=true
# That is a diagnostic, not a gate: it does not change this number and nothing here asserts its output.
#
# 🔴 W-1 — 116 -> 116 AGAIN, AND FOR A THIRD DISTINCT REASON. N-1's zero was "nothing surfaced"; N-2's was
# "95 surfaced and all 95 were WRITTEN". W-1's is neither: **this task did not turn the switch on for
# St4i.EdgeCore, so nothing could surface**, and the reason it did not is measured rather than asserted.
# Re-measured at 46439925 on SDK 10.0.302, `dotnet build -t:Rebuild`, counted the way the summary above
# counts:
#     116   as shipped                     (101 nullable in St4i.EdgeCore -- 82 of them in the vendored SDK
#                                           file -- plus 9 NU1701, 2 CS8767, 2 CS8604, 1 xUnit2029,
#                                           1 xUnit1013. NOTHING in that list is a doc comment.)
#     852   + GenerateDocumentationFile on St4i.EdgeCore ALONE
#     757   + an .editorconfig section scoped to the vendored file's REAL path, CS1591 only
#     749   + the same section BESIDE that file naming BOTH its codes -- a perfect exemption of it
# Nothing survives into this number because nothing was turned on; every one of the 116 is a pre-existing
# warning of a class this task did not touch.
#
# 🔴 THE MIDDLE LINE IS THE OWNER DECISION AND IT IS NOT MINE. 852 - 116 = 736, of which 543 CS1591 and
# 92 CS1573 are documentation COVERAGE. 448 + 84 of those are our own source and are the same decision the
# other seven unset projects carry; 95 + 8 are inside examples/device-client/csharp/St4iDeviceClient.cs,
# which this repository may not edit at all.
#
# 🔴 AND THE THIRD LINE SETTLES SOMETHING N-1 EXPLICITLY RECORDED AS UNMEASURED. N-1 wrote that a
# path-scoped .editorconfig "has to be scoped to the real path ... and that should be verified by running it
# rather than reasoned about". Run: it works, exactly -95, and CS1591 vanishes from that file. THREE things
# that were not on record follow, and they are why "narrower" is not the same as "available":
#   (1) It leaves EIGHT CS1573 in the same untouchable file. N-1's (a)-vs-(b) framing named CS1591 only, so
#       (b) as described does not actually exempt the vendored file -- it exempts one of its two codes.
#   (2) 🔴 THIS ONE WAS WRONG AND IS CORRECTED IN PLACE RATHER THAN REPLACED, because the wrong version was
#       load-bearing in an OWNER'S artefact. It read: "the section cannot live in this product's tree at
#       all: it has to be planted at the repository root, above an unrelated TypeScript/Node application."
#       The premise is right -- .editorconfig SECTIONS match at or below their own directory, and that file's
#       real path is outside tools/machine-simulator -- and the conclusion does not follow, because analyzer
#       -config DISCOVERY walks the SOURCE FILE's ancestors, not the project's. Measured, three placements,
#       one build each: repository root, CS1591 -> 757. examples/, CS1591 -> 757. examples/device-client/
#       csharp/ -- BESIDE the file -- naming CS1591 AND CS1573 -> 749, with ZERO CS15xx left in that file.
#       So the remedy sits two directories from the file it is about, inside the SDK example it exempts, and
#       is not forced anywhere near the TypeScript application. What is left of the objection is a different
#       one and is NOT measured: that directory is the published SDK sample kept in step with the Python and
#       Node siblings, so a file planted there ships to machine developers and can be lost to a re-vendor.
#   (3) 749 is still not 116, and 757 is not either. "Leaves the other 448 ASSERTED" is true and is not the
#       same as "passing": a PERFECT exemption of the vendored file removes the 103 nobody may fix and leaves
#       633 -- 532 coverage warnings on our own source plus 101 false `cref` claims -- to write or to pin.
# So a path-scoped severity is an override, it does not on its own make the switch settable, and W-1 stops
# and reports rather than taking it. No override has shipped since N-1 (f1dba1a8): N-2, P-1, P-2, Q-1, R-1,
# S-1, T-1, U-1, V-1 and this branch -- the enumeration, because "the seventh in a row" was inherited from a
# count nobody had re-derived and it understates by three.
#
# 🔴 WHAT DID CHANGE, AND IT IS NOT THIS NUMBER. The negative control three paragraphs above -- a `</para>`
# deleted from FleetCore.cs, this gate FULL GREEN and unmoved -- no longer describes this gate. That defect
# now fails DocCommentProseTests in the EdgeCore suite. The build half of the gate still does not notice it
# and never will while the switch is off; the suite half does. Both halves were run on the same defect (the
# transcripts are in the W-1 report). The boundary moved from "the gate cannot see a malformed block outside
# the six" to "the gate cannot see an unresolvable `cref` outside the seven" -- 237 of those are on record
# and NONE of them is indexed here.  [🔴 "237" WITHDRAWN 2026-08-19 by task AE-1: re-measured 239. See the
# withdrawal block above for the two that arrived and where. The sentence's point is unchanged and is worse
# than it reads: none of the 239 is indexed here, and the number is moving.]
#
# 🔴 AE-1 (item 12 stage 2) ADDED A SECOND ASSERTION BELOW THIS ONE AND DID NOT TOUCH THIS LITERAL. Read the
# block that follows before concluding that 116 is still the whole of what this gate says about warnings: it
# is not, and the reason is that 116 is a SCALAR OVER A UNION and therefore cannot see one population fall
# while another rises. It stays 116 because nothing was paid, nothing was silenced and nothing regressed.
# [🔴 "It stays 116" WITHDRAWN 2026-08-19 by task AF-1: item 12 stage 3 turned the switch on and this
#  literal is now 852. AE-1's sentence was true of AE-1's tree and its reasoning is unchanged — the scalar
#  is a scalar over a union at 852 exactly as it was at 116, and it is WEAKER at 852, because the union it
#  summarises is now seven times larger. What holds it to a meaning is the (bucket x code) ledger below.]
#
# ══ 116 -> 852 — task AF-1, owner item 12, STAGE 3: THE SWITCH IS ON ══════════════════════════════════
#
# 🔴 THE ONLY INCREASE ITEM 12 IS EVER ALLOWED. Stages 4..8 may only lower this number; a later stage that
# raises it is a finding to be explained, never a constant to be updated. The move is ONE property in
# src/St4i.EdgeCore/St4i.EdgeCore.csproj — `<GenerateDocumentationFile>true</GenerateDocumentationFile>`,
# with NO exemption of any kind — enforcing the owner's ruling on item 12 option (b).
#
# 🔴 "option (b)" IN THE LINE ABOVE IS WITHDRAWN, 2026-08-19, by task AF-1 — quoted and retired in place
# rather than overwritten, the style AA-1 established for this repository. THE RULING IS NOT ANY OF THE
# FOUR LABELLED OPTIONS, and item 12 opens by saying so: (c) is not turning the switch on at all, while
# (a), (b1) and (b2) are ALL overrides in the decision's own words. It is a FIFTH thing — turn the switch
# on AND accept no override — recorded BY DESCRIPTION, never by label.
#   Read this as the failure it is, because the mistake is instructive and the line it sits on is the
#   worst possible place for it: THIS FILE is where stages 4..8 come to learn what the ruling was, since
#   it is the file that holds EXPECT_WARNINGS. A reader who took "(b)" at face value would learn that the
#   ruling authorises an .editorconfig severity section — after fifteen consecutive tasks with not one
#   override — which is the exact failure mode item 12 warns about by name.
#   AF-1 wrote this line and, in the SAME commit, wrote a correct analysis of this very error beside the
#   property in St4i.EdgeCore.csproj. It then "fixed" the error in that one file without grepping for the
#   copy it had just created here. §8.1(b): the least-scanned artefact is your own justification.
#
# 🔴 852 IS MEASURED, NOT COMPUTED. `MSBUILDDISABLENODEREUSE=1 dotnet build -t:Rebuild --nologo` over the
# whole solution, SDK 10.0.302, 15/15 compilations, `Build succeeded.`, `0 Error(s)`, `852 Warning(s)`, on
# the tree this commit produces. It is NOT 116 + a difference: stage 1 measured that the population is NOT
# preserved under payment — writing `<param>` for SOME parameters of a member turns one CS1591 into one
# CS1573 — so every stage re-measures its own constant instead of subtracting. This one happens to agree
# with stage 1's arithmetic (837 in-EdgeCore + 15 outside = 852) and with stage 1's own direct measurement
# at 59bebd21, and THAT AGREEMENT IS THE FINDING: two merges (AC-1, AE-1) landed between them and moved
# none of it. Nothing here is rounded toward the old number.
#
# THE ENUMERATION FIRST, THE TOTAL AFTER — every code in this build, measured in the summary block:
#   CS1591 543 · CS1573 92 · CS1574 75 · CS8625 37 · CS8618 35 · CS1734 23 · CS8604 15 · CS8601 9
#   NU1701 9 · CS8600 5 · CS0419 3 · CS8603 2 · CS8767 2 · xUnit2029 1 · xUnit1013 1     = 852
# The 736 the switch added are CS1591 543 + CS1573 92 + CS1574 75 + CS1734 23 + CS0419 3, all of them in
# the St4i.EdgeCore compilation, and the other 116 are unchanged code-for-code from the line above.
#
# 🔴 NOT ONE OF THE 736 IS PAID BY THIS COMMIT, AND THAT IS THE POINT, NOT AN OMISSION. Item 12 stays in
# PART II of docs/owner-decisions.md — a PARTIAL-enforcement note, not a completion note — because 633 of
# them are ours and unpaid. 103 (95 CS1591 + 8 CS1573) are in the vendored SDK file this repository may
# not edit; they are the NAMED DEBT the ruling created, they must stay VISIBLE, and the ledger below is
# what stops them from being quietly retired. A stage that lowers 852 by silencing rather than by writing
# is exactly what the two instruments exist to catch.
#
# 🔴 AND THIS NUMBER IS NOW A WEAKER INSTRUMENT THAN IT WAS AT 116, WHICH IS WHY THE LEDGER BELOW IS NOT
# OPTIONAL. A scalar over 852 hides a cancellation just as it hid one over 116, and stages 4..8 are a long
# run of deliberate reductions in one bucket standing beside a bucket that can rise. Read the block below
# before treating a green 852 as a statement about anything.
#
# ══ 852 -> 751 — task AG-1, owner item 12, STAGE 4: THE 101 ALREADY-FALSE CLAIMS ARE PAID ═════════════
#
# 🔴 THE FIRST DECREASE, AND IT IS A DECREASE BY WRITING, NOT BY SILENCING. Stage 3's sentence directly
# above ("stages 4..8 may only lower this number") is now exercised for the first time. What moved: 101
# doc-comment claims that were FALSE — 75 CS1574 (`cref` naming a symbol that does not resolve), 23 CS1734
# (`paramref` naming a parameter not in scope), 3 CS0419 (`cref` matching several overloads) — across 29
# files, every one of them in src/St4i.EdgeCore. Not one code line was touched, and the checkable form of
# that is a ZERO rather than a total: `git diff 3e001642 HEAD -- .../src | grep '^[+-]' | grep -v '///'`
# returns NOTHING, in both directions. The raw diff is 106 `///` lines added and 99 removed.
#   🔴 "all 96 changed lines" IS WITHDRAWN, 2026-08-19, by the task that wrote it, before it left the
#   branch. 96 was measured, and then FOUR more edits were made (two over-long lines re-wrapped, one
#   sentence given the member that owns its arguments, one re-flowed) and the number was not re-measured
#   before it was written into three files. This is "ENUMERATE FIRST, COUNT AFTER" failing for the EIGHTH
#   time in this batch, and the second time it reached a commit -- caught here on a re-read, one commit
#   later, by re-running the measurement instead of re-reading the sentence.
#   The lesson is in WHICH number was wrong: the load-bearing claim is "ZERO non-`///` lines changed", and
#   that one was measured last and held. A total of changed lines was never the assertion; it was a
#   decoration that outranked its own evidence. Prefer the zero.
#
# 🔴 751 IS MEASURED, NOT SUBTRACTED. `MSBUILDDISABLENODEREUSE=1 dotnet build -t:Rebuild --nologo` over
# the whole solution, SDK 10.0.302, 15/15 compilations, `Build succeeded.`, `0 Error(s)`,
# `751 Warning(s)`. 852 - 101 = 751 is arithmetic and it AGREES with the measurement; the agreement is
# reported as a result, not used as a substitute for measuring. Stage 1 measured the channel that makes
# subtraction unsafe here (writing `<summary>` plus SOME of a member's `<param>` tags turns one CS1591
# into one CS1573) and that channel is EMPTY for this stage BY CONSTRUCTION rather than by luck: this
# stage wrote no `<summary>` and no `<param>`, it only re-pointed references inside blocks that already
# existed. `OURS CS1591 448` and `OURS CS1573 84` are unmoved, unit for unit, which is the check.
#
# 🔴 AND THE THREE PAID ROWS ARE DELETED FROM THE LEDGER, NOT SET TO ZERO — this is a property of the
# mechanism and the next stage will meet it too. `warning_ledger()` below emits a row only for a
# (bucket,code) pair it actually OBSERVES in the log, so a code that reaches zero produces NO row at all.
# A `OURS CS1574 0` line left in EXPECT_WARNING_LEDGER would fail the equality against an observed list
# that simply omits it. Nineteen rows -> sixteen.
#   The cost of that deletion is named rather than hidden, and it is exactly the cost the block further
#   down already predicted: "the day a stage finishes paying CS1574, an override naming CS1574 becomes
#   invisible to this half again". That day is today, for three codes. The half that still sees it is
#   tests/St4i.EdgeCore.Tests/SuppressionCensusTests.cs, which enumerates suppression INSTRUCTIONS and so
#   does not need the code to be emitted anywhere. That is why both halves exist.
#
# ══ TASK AH-1 (.superpowers/sdd/item12-stage5/task-1-brief.md) — ITEM 12 STAGE 5 ══════════════════════
# 751 -> 631. THE FIRST STAGE THAT PAYS BY WRITING, and the first whose deliverable is itself a pile of
# new published claims. One coherent surface was paid, chosen for a reason and not for a count: the
# config-sync DOMAIN MODEL, the seven types whose member SPELLING is a string published outside this
# repository. MeasurementPoint and Fiducial are deserialized DIRECTLY off the real ecosystem's
# get-points/delta-sync responses (St4i.EngineApi/Config/LiveConfigSyncWireDtos.cs declares them as the
# wire shape, camelCase policy), LightingShot rides inside a point, and ProductModel/ProductVariant/
# VariantPointOverride/Recipe are the shape of products.json / recipes.json, the two operator-editable
# files this very script exempts by name from its outdir watch. Every enum member paid states the exact
# token it serializes to; `allowIntegerValues:false` in ConfigJsonConverters makes that spelling the
# WHOLE contract, since a numeric value is a hard read failure. That is P-2's law -- a member's spelling
# is a published string -- applied where the reader is a different company's server.
#
# 🔴 631 IS MEASURED, NOT SUBTRACTED, AND IT WAS MEASURED TWICE. `MSBUILDDISABLENODEREUSE=1 dotnet build
# -t:Rebuild --nologo` over the whole solution, SDK 10.0.302. The FIRST run reported 7 errors and 14
# compilations, every error CS2001 inside St4iMachineSimulator_nwqh2aku_wpftmp.csproj -- the exact shape
# this file already warns must be re-run before it is believed. Re-run: 15/15 compilations,
# `Build succeeded.`, `0 Error(s)`, `631 Warning(s)`. 751 - 120 = 631 is arithmetic that AGREES; it is
# reported as a result and was not used in place of the measurement.
#
# 🔴 ONE ROW MOVED AND ONLY ONE: `OURS CS1591 448 -> 328`. Sixteen rows before, sixteen after -- nothing
# reached zero, so nothing was deleted this time. `OURS CS1573 84` DID NOT MOVE, and for this stage that
# is a measured result rather than a construction: stage 1 proved that paying a CS1591 with a partial set
# of `<param>` tags CREATES a CS1573, and stages 5..8 are the stages that write. It did not fire here
# because NOT ONE of the 120 members paid takes a parameter -- 118 properties and enum members, plus
# ProductModel.BumpVersion() and Recipe.BumpVersion(), both nullary. So this stage does NOT de-risk that
# channel for stages 6..8; it never opened it. The eight VENDORED rows did not move one unit.
#
# 🔴 AND THE CHECKABLE CLAIM ABOUT THE DIFF CHANGES SHAPE HERE, WHICH THE NEXT STAGES INHERIT. Stage 4
# could say "ZERO changed lines that are not `///`". A stage that documents ENUM MEMBERS cannot: you
# cannot attach a doc comment to a member of a one-line `public enum X { A, B }` declaration, so paying
# those warnings REQUIRES re-laying the declaration out. Seven declarations were re-laid out here
# (MeasurementType, ToleranceMode, PointShape, ProductLifecycleStatus, CoordinateMode, RecipeStatus,
# VariantOverrideAction). The claim that survives is narrower and still a zero: outside `///` lines,
# blank lines, one 3-line `//` banner and those seven brace/comma re-layouts, ZERO lines changed -- and
# the member SEQUENCE of all seven is identical name-for-name and order-for-order, which matters because
# enum order is the underlying value. No executable statement was touched anywhere.
#
# ══ TASK AL-1 (.superpowers/sdd/item12-stage6/task-1-brief.md) — ITEM 12 STAGE 6 ══════════════════════
# 631 -> 502. THE SECOND STAGE THAT PAYS BY WRITING, and the FIRST that opens the CS1573 channel stage 1
# predicted and stages 2..5 never reached.
#
# 🔴 THE CLUSTER, AND THE CANDIDATES WERE ENUMERATED BEFORE ITS SIZE WAS. The 412 outstanding were first
# grouped by directory, whole, from one `-t:Rebuild` of St4i.EdgeCore: Historian 97 · Config 50 ·
# Drivers/Modbus 46 · Models 42 · Transport 38 · Drivers/Simulators 27 · Uns 19 · Drivers/OpcUa 17 ·
# Mapping 13 · Site 12 · Engine 11 · Fleet 8 · Drivers/Mqtt 7 · Drivers/HotFolder 7 · Uns/Sparkplug 6 ·
# Infrastructure 6 · Drivers 5 · Metrics 1. Only then was a cluster named. Stage 5's selection rule --
# "the surface a driver author or an integrator touches first" -- was CONSIDERED AND NOT USED, because on
# this remainder it points at the built-in driver families (Modbus + OpcUa + Mqtt + HotFolder +
# Simulators + SimulatedDriver = 109), whose published contract surface St4i.Connector.Abstractions was
# already paid in full by N-2; what is left there is host-internal plumbing whose members mostly cannot be
# described beyond their names. The rule used instead is RECOVERABILITY: pick the surface whose sentences
# are fixed by an artefact already in this tree, so that a claim can be checked rather than composed.
#
# 🔴 WHAT WAS PAID, PER FILE, 129 IN EIGHT FILES:
#     Historian/HistorianModels.cs 71 · Models/TransportAck.cs 23 · Historian/IHistorianStore.cs 13 ·
#     Historian/SqliteHistorianStore.cs 11 · Models/MachineDescriptor.cs 8 ·
#     Historian/HistorianWriter.cs 1 · Historian/OeeSettingsStore.cs 1 · Metrics/OeeCalculator.cs 1
# They go together because ONE function joins them: `HistorianResultRecord.From(MachineDescriptor,
# DeviceReading, TransportAck, DateTimeOffset)` folds exactly four inputs into the one row this product
# writes to its own disk, and three of the four are in this cluster -- the fourth, DeviceReading, is the
# surface N-2 already paid. Around that row sit its contract (IHistorianStore), its only implementation
# and physical schema (SqliteHistorianStore), the write-behind that feeds it (HistorianWriter), and the
# one computation ever read back out of it (OeeSettingsStore + OeeCalculator). Every sentence written here
# is fixed by something checkable in the same tree: a CREATE TABLE, a WHERE clause, a route's clamp.
#
# 🔴 502 IS MEASURED, NOT SUBTRACTED, AND THE FIRST RUN WAS DISCARDED AGAIN. `MSBUILDDISABLENODEREUSE=1
# dotnet build -t:Rebuild --nologo` over the whole solution, SDK 10.0.302. FIRST run: 3 errors, 14
# compilations, every error CS2001 inside St4iMachineSimulator_ioczjmtn_wpftmp.csproj -- the shape this
# file says must be re-run before it is believed, and the second stage running to hit it. Re-run: 15/15
# compilations, `Build succeeded.`, `0 Error(s)`, `502 Warning(s)`. 631 - 129 = 502 is arithmetic that
# AGREES and is reported as a result, not used in place of the measurement.
#
# 🔴 TWO ROWS MOVED, AND THE SECOND IS THE ONE STAGE 5 SAID IT HAD NOT DE-RISKED. `OURS CS1591 328 ->
# 243` (-85) and `OURS CS1573 84 -> 40` (-44). Sixteen rows before, sixteen after; nothing reached zero.
# The eight VENDORED rows did not move one unit. 44 of the 129 were paid by ADDING `<param>` tags to
# members that already carried a doc comment -- 22 on HistorianResultRecord, 8 on HistorianResultQuery, 8
# on MachineDescriptor, 6 on IHistorianStore -- which is the channel stage 5 reported it never opened.
#
# 🔴 AND THE CHANNEL FIRED ONCE, AGAINST THIS TASK, AND ONLY THE MEASUREMENT CAUGHT IT. An intermediate
# build measured 128 paid, not 129: rewriting the doc block on `IHistorianStore.AggregateForOeeAsync`
# DROPPED an existing `<param name="includeFabricated">` while adding four new ones, which converted a
# paid member back into a fresh CS1573. Nothing else saw it -- the prose was well-formed, W-1 was green,
# the diff looked like pure addition. The general form for stages 7..8: WHEN YOU EXTEND AN EXISTING DOC
# BLOCK, THE RISK IS NOT THE TAG YOU ADD, IT IS THE ONE ALREADY THERE. Re-measure per file; a per-file
# residue of zero is the check, and `git diff` counting REMOVED `///` lines is the cheap pre-check.
#
# 🔴 THE STRONG DIFF CLAIM IS BACK, because nothing here is an enum. Over this branch, `git diff`
# restricted to `src/` has ZERO changed lines in either direction that are not `///` lines: 657 added, 1
# removed (a `</summary>` moved down a line to admit a `<para>`). No executable statement, no signature,
# no member name was touched. That is stage 4's shape, not stage 5's, and it holds only because this
# cluster contains no enum declaration.
#
# ══ TASK AM-1 (.superpowers/sdd/item12-stage7/task-1-brief.md) — ITEM 12 STAGE 7 ══════════════════════
# 502 -> 440. THE THIRD STAGE THAT PAYS BY WRITING.
#
# 🔴 THE CLUSTER, AND THE CANDIDATES WERE ENUMERATED BEFORE ITS SIZE WAS. The 283 outstanding were first
# grouped by directory, whole, from one `-t:Rebuild` of St4i.EdgeCore, and the grouping REPRODUCED AL-1's
# forecast row for row: Config 50 · Drivers/Modbus 46 · Transport 38 · Drivers/Simulators 27 · Uns 19 ·
# Drivers/OpcUa 17 · Mapping 13 · Site 12 · Engine 11 · Models 11 · Fleet 8 · Drivers/Mqtt 7 ·
# Drivers/HotFolder 7 · Uns/Sparkplug 6 · Infrastructure 6 · Drivers 5. Only then was a cluster named.
# Four were weighed: A, the built-in driver families (Drivers/* = 109) -- the surface AL-1 named as
# "full of exactly those cases", left for whoever takes it and owed as a FINDING rather than as 109
# sentences; B, edge-local configuration (Config + Fleet + Infrastructure = 64); C, the northbound UNS
# door (Uns + Uns/Sparkplug + Site = 37); D, the chosen one below.
#
# 🔴 THE SELECTION RULE IS AL-1's — RECOVERABILITY — RE-DERIVED RATHER THAN INHERITED, and it is the
# reason A was not taken even though A is the largest remaining unit. Every sentence written here is
# pinned by an artefact already in this tree: the three route constants by the SDK's own hardcoded URLs,
# `UnitMap` by seven checked-in `mapping/*.json` presets, `TransportMode`'s spellings by a registered
# string enum converter and by a hand-written TypeScript union in web/, the outage disagreement between
# the two `Mode` properties by `ScenarioConfig.NetworkOutage`'s own doc comment and by FleetCore's
# `ApplyNetworkOutageLocked`. Nothing here was composed.
#
# 🔴 WHAT WAS PAID, PER FILE, 62 IN TWELVE FILES -- costed BEFORE writing, re-measured after:
#     Transport/TransportCoordinator.cs 9 · Models/Envelopes.cs 7 · Mapping/MappingProfile.cs 7 ·
#     Transport/AutoTransport.cs 6 · Transport/DemoTransport.cs 5 · Transport/LiveTransport.cs 5 ·
#     Transport/SwitchableTransport.cs 5 · Transport/ITransport.cs 4 · Transport/WalFlushPump.cs 4 ·
#     Models/Enums.cs 4 · Mapping/Normalizer.cs 4 · Mapping/MappingProfileResolver.cs 2
# They go together because ONE TYPE joins them: `CanonicalEnvelope`. It is built by `Normalizer.Normalize`
# from a reading and a `MappingProfile`, it is the single argument of `ITransport.SendAsync`, and it is
# carried by every implementation of that interface, steered by `TransportCoordinator`, and re-sent from
# disk by `WalFlushPump` when the carrier was down. The boundary is checkable rather than argued: it is
# THREE DIRECTORIES TAKEN WHOLE -- Transport/, Mapping/, Models/ -- and after this stage each of the three
# has a residue of ZERO, so nothing was left behind inside a boundary this cluster crossed.
#   This continues AL-1 exactly: stage 6 paid the three types `ITransport`'s three methods RETURN
#   (TransportAck, HeartbeatResult, ConfigSyncResult, all in Models/TransportAck.cs). Stage 7 pays the
#   interface itself, the two types in its signature that were still unpaid (CanonicalEnvelope,
#   TransportMode) and everything that implements it. `ITransport`'s whole signature is now documented in
#   both directions.
#
# 🔴 440 IS MEASURED, NOT SUBTRACTED, AND THIS TIME THE FIRST RUN STOOD. `MSBUILDDISABLENODEREUSE=1
# dotnet build -t:Rebuild --nologo` over the whole solution, SDK 10.0.302: 15/15 compilations,
# `Build succeeded.`, `0 Error(s)`, `440 Warning(s)`, on the FIRST attempt -- the `_wpftmp` CS2001 shape
# that forced a discard in stages 5 and 6 did not appear. That is a NON-EVENT and is recorded as one: it
# is evidence about this run, not evidence that the shape has gone, and stage 8 must still expect it.
# 502 - 62 = 440 is arithmetic that AGREES and is reported as a result, not used in place of the
# measurement. 440 was read out of the partition (VENDORED 185 / OURS 255).
#
# 🔴 TWO ROWS MOVED, THE SAME TWO, AND BOTH FELL: `OURS CS1591 243 -> 192` (-51) and
# `OURS CS1573 40 -> 29` (-11). Sixteen rows before, sixteen after; nothing reached zero. The eight
# VENDORED rows did not move one unit. 11 of the 62 were paid by COMPLETING `<param>` sets that were
# already partial -- 5 on TransportCoordinator's constructor, 4 on WalFlushPump's, 2 on
# MappingProfileResolver.Build -- which is AL-1's channel, entered deliberately and with its trap named
# in advance. ZERO new CS1573 were created: the row fell monotonically, and that was checked per file
# rather than inferred from the total.
#
# 🔴 THE ENUM NARROWING IS BACK, AND IT IS THE SAME ONE STAGE 5 RECORDED. This cluster contains exactly
# one enum declaration (`TransportMode`), so the strong claim stage 6 could make is unavailable and the
# honest one is stage 5's: over `src/`, 513 added / 4 removed, of which three removed are `///` lines
# reproduced verbatim in place and the fourth is the enum's one-line declaration, re-laid out with its
# member sequence identical name-for-name and order-for-order. Outside that declaration and blank
# separators, ZERO changed lines that are not `///`. Stage 8 inherits neither claim as a promise: which
# one it can make is decided by whether ITS cluster contains an enum.
#
# 🔴 ONE PUBLISHED CLAIM INSIDE THE CLUSTER WAS REFUTED BY MEASUREMENT AND RETIRED IN PLACE, NOT FIXED IN
# CODE. `ITransport`'s summary called itself "the single seam between edge-core reading capture/
# normalization and 'how it actually leaves the building'". Measured: `EdgePipeline` hands the SAME
# envelope to `IUnsPublisher.PublishReading` one statement before it calls `SendAsync`, and
# `Site.UnsBridge` republishes that spine to a SYNAPSE Site's broker off-box. The sentence was true when
# written and was falsified by G2-2; it is quoted verbatim and withdrawn inside the file it lives in,
# with the surviving half (this is the ST4I INGEST seam, one of two egress paths) stated beside it.
#
# 🔴 THE SELF-CHECK RAN TWICE AND THE SPLIT IS THE FINDING, NOT THE RATE. 62 warnings became 199
# sentences. Round 1 filtered on universal/existence NEGATIONS (stage 5's rule (i), turned on this
# task's own output): 112 flagged, 7 corrected, 2 of them outright false -- and both false ones failed
# the same way, because a grep for a MEMBER'S NAME cannot see a SERIALIZER, which reads every member and
# names none. `UnsPublisher` serializes the whole `CanonicalEnvelope` as the retained semantic mirror,
# so `Path` and `IdempotencyKey` DO leave the box, for every reading kind. Round 2 went after the shape
# round 1's filter cannot see -- an asserted PURPOSE or MECHANISM -- and corrected 6 more, four sharing
# one root: `ITransport.HeartbeatAsync` HAS NO PRODUCTION CALLER and there is no heartbeat timer in this
# repository. That mechanism was not invented from nothing; it was PROMOTED out of `AutoTransport`'s own
# doc comment, which hedges it honestly as "typically a background timer, per the INTENDED
# architecture". Taking a neighbouring doc comment as a premise, in a tree where stage 4 measured 101
# false published claims, is the same error as recalling instead of measuring. 13 of 199 total.
# FOR STAGE 8: one mechanical filter is not a round. Run the negation filter, then ask of every sentence
# "what does this assert about a caller, a timer or a user, and can I name it?"
#
# 🔴 SIX CODE OBSERVATIONS WERE STOPPED AND REPORTED, NONE FIXED AND NONE OPENED AS AN ITEM. The one
# with an operational consequence today: the Demo gate guards the MODE and not the fabricator.
# `PUT /v1/mode` refuses Demo with a 400 when `DemoModeGate.Enabled` is false; `POST /v1/scenario` with
# `networkOutage` is not gated by it at all and points the running fleet's transport at a lossy
# `DemoTransport`, while `GET /v1/mode` keeps answering the mode the operator selected. It is audited
# (`scenario.apply`) and Engineer-only; it is not refused. Both routes are outside this stage's twelve
# files. See the report's §7 for the ranked list.
#
# ══ TASK AN-1 (.superpowers/sdd/item12-stage8/task-1-brief.md) — ITEM 12 STAGE 8 ══════════════════════
# 440 -> 328. THE FOURTH AND LAST STAGE THAT PAYS BY WRITING -- and the first that deliberately hands
# something over UNPAID, with a measurement in place of the sentences.
#
# 🔴 THE REMAINDER WAS REGROUPED WHOLE BEFORE ANY NUMBER WAS NAMED, and AM-1's forecast reproduced
# exactly. One `-t:Rebuild` of the whole solution at the base commit, 221 warnings partitioned by
# directory: Config 50 (6 files) · Drivers/Modbus 46 (10) · Drivers/Simulators 27 (11) · Uns 19 (4) ·
# Drivers/OpcUa 17 (5) · Site 12 (2) · Engine 11 (3) · Fleet 8 (1) · Drivers/HotFolder 7 (2) ·
# Drivers/Mqtt 7 (2) · Infrastructure 6 (3) · Uns/Sparkplug 6 (1) · Drivers 5 (1). All THIRTEEN rows
# match AM-1's paragraph unit for unit -- the second consecutive stage able to say that of its
# predecessor. Split by the driver-family boundary: 109 inside `Drivers/`, 112 outside. AM-1's forecast
# of 112 is therefore CONFIRMED by measurement rather than carried; it was re-derived, not believed.
#
# 🔴 WHAT WAS PAID, PER FILE, 112 IN TWENTY FILES -- costed BEFORE writing, re-measured after:
#     Config/MachineConfigModels.cs 33 · Uns/UnsOptions.cs 10 · Fleet/MachineState.cs 8 ·
#     Engine/ScenarioAwareDriver.cs 6 · Site/BridgeSpool.cs 6 · Site/BridgeStatus.cs 6 ·
#     Uns/Sparkplug/SparkplugPayload.cs 6 · Uns/UnsTopicBuilder.cs 6 · Config/MachineParameterSchema.cs 5 ·
#     Config/ModbusMultidropRegistration.cs 5 · Engine/EdgePipeline.cs 4 · Config/FleetSettingsStore.cs 3 ·
#     Config/ConnectorsConfig.cs 2 · Config/DemoModeGate.cs 2 · Infrastructure/EventBus.cs 2 ·
#     Infrastructure/FleetConfig.cs 2 · Infrastructure/ResilienceProbe.cs 2 · Uns/UnsBroker.cs 2 ·
#     Engine/EdgeAgentPipelines.cs 1 · Uns/UnsPublisher.cs 1
# The cluster is not a theme, it is a COMPLEMENT: everything in the remainder that is not a driver. The
# boundary is checkable rather than argued -- SEVEN directories taken WHOLE (Config/, Uns/,
# Uns/Sparkplug/, Site/, Engine/, Fleet/, Infrastructure/) and every one of the seven is left at a
# residue of ZERO. After this stage the whole outstanding population is `Drivers/` and nothing else.
#
# 🔴 328 IS MEASURED, NOT SUBTRACTED, AND THE FIRST RUN STOOD AGAIN. `MSBUILDDISABLENODEREUSE=1 dotnet
# build -t:Rebuild --nologo` over the whole solution, SDK 10.0.302: 15/15 compilations,
# `Build succeeded.`, `0 Error(s)`, `328 Warning(s)`, first attempt. Second stage in a row without the
# `_wpftmp` CS2001 discard, and it is recorded the same way AM-1 recorded it -- evidence about THIS run,
# not evidence that the shape has gone. 440 - 112 = 328 is arithmetic that AGREES and is reported as a
# result. 328 was read out of the partition (VENDORED 185 / OURS 143).
#   🔴 AND 328 COLLIDES WITH THIS FILE'S OWN HISTORY, which is why the literal was grepped and CLASSIFIED
#   before it was written here: `OURS CS1591` was 328 after stage 5 and appears as that figure in AH-1's
#   and AL-1's blocks above and in Directory.Build.props. Those occurrences are records of what a NAMED
#   task measured and are left exactly as written. This is the third time in this chain a moving figure
#   has collided with an unrelated one (AF-1's rule; AM-1 found ST4I_MODBUS_PORT = 502).
#
# 🔴 TWO ROWS MOVED, THE SAME TWO, AND BOTH FELL: `OURS CS1591 192 -> 90` (-102) and
# `OURS CS1573 29 -> 19` (-10). Sixteen rows before, sixteen after; nothing reached zero. The eight
# VENDORED rows did not move one unit. 10 of the 112 were paid by COMPLETING `<param>` sets that were
# already partial -- 5 on ModbusMultidropRegistration.RegisterAll's second overload, 4 on EdgePipeline's
# constructor, 1 on EdgeAgentPipelines.RunAsync -- and every one was extended by INSERTING tags beside
# the existing ones. NO block was rewritten, which is the operation that un-paid a member in stage 6.
# ZERO new CS1573 were created.
#
# 🔴 THE DIFF CLAIM IS STAGE 5's AND STAGE 7's SHAPE, FOR THE PREDICTED REASON. Over `src/`: 611 added,
# 7 removed. FOUR removed `///` lines, all four the old `SparkplugMsgType` summary, quoted VERBATIM
# inside the withdrawal block that replaces them. THREE removed non-`///` lines, all three one-line enum
# declarations re-laid out so their members can carry doc comments (ParameterValueKind, AdjustmentScope,
# ConfigProvenance), each with its member sequence identical name-for-name and order-for-order -- which
# matters twice, because enum order is the underlying value and `ConfigProvenance` is also a wire
# vocabulary. Outside `///` lines, blank separators and those three re-layouts, ZERO changed lines in
# either direction.
#
# 🔴 A PUBLISHED CLAIM INSIDE THE CLUSTER WAS REFUTED BY MEASUREMENT AND RETIRED IN PLACE, NOT FIXED IN
# CODE. `SparkplugMsgType`'s summary said the four lifecycle members "are landed here only as
# topic-building targets" and that "G2-2's own wiring only ever produces DDATA". Measured: G2-3 wired
# NBIRTH/NDEATH to FleetCore's real Start/Stop/E-stop transitions, so two of its three parts are false.
# The third is TRUE and was re-measured rather than assumed: the strings `WithWill`/`LastWill` occur in
# no `.cs` file in this repository, so there is still no MQTT Will and an abrupt kill emits no NDEATH.
#
# 🔴 STAGE 8 DOES NOT REACH ZERO, AND THAT IS THE DELIVERABLE RATHER THAN A SHORTFALL. The 109 that
# remain are the driver families. AL-1 named that surface as the place where "nothing to say beyond the
# name" is the honest answer and said a stage that takes it owes a FINDING; AM-1 showed a stage cannot
# both pay the remainder and owe a finding on part of it. This stage pays the 112 and measures the 109
# instead of writing them. THE MEASUREMENT REFUTES THE PREMISE IT WAS ASKED TO CONFIRM -- see the
# EXPECT_WARNING_LEDGER block below for the classification, the read-surface census and the price of
# each direction. Item 12 STAYS IN PART II and leaves it on a RULING, not on a count reaching zero.
EXPECT_WARNINGS=328
if [[ "${WARNINGS:-}" != "$EXPECT_WARNINGS" ]]; then
  echo "FAIL: build warnings are ${WARNINGS:-unknown}, expected ${EXPECT_WARNINGS}."
  echo "  A warning count is an expected quantity, not a readout. If this move is intended,"
  echo "  update EXPECT_WARNINGS and justify it beside the suite totals below."
  # 🔴 J-1b branch review, Minor 15 — this literal said 115 against a pinned EXPECT_WARNINGS of 116, i.e. a
  # stale copy of the very number it sits beside. Interpolated now, so it cannot go stale again.
  echo "  Warning CODES in this build, by occurrence count across all projects (NOT the ${EXPECT_WARNINGS} --"
  echo "  MSBuild counts a warning once per project that emits it; this is a pointer, not the total):"
  # 🔴 R-1 REMOVED A `head -10` FROM THIS LINE, AND THE TRUNCATION WAS NOT COSMETIC. Sorted by
  # occurrence count, the code that MOVED the total is the one most likely to appear ONCE, i.e. LAST,
  # i.e. below the cut. The diagnostic that motivated this task -- MSB3101, a single occurrence -- is
  # exactly that shape: the one line in this listing that explains the failure was the one the
  # listing dropped. The set of distinct codes in one build log is small, finite and closed where
  # this tool reaches, so it is now printed WHOLE. Where a population closes at a place a tool can
  # touch, enumerating it IS the fix.
  grep -oE 'warning [A-Za-z]+[0-9]+' "$BUILD_LOG" | sort | uniq -c | sort -rn | sed 's/^/    /'
  echo "  full log: $BUILD_LOG"
  # 🔴 (h8) THIS WAS THE ONLY ASSERTION IN THIS FILE WITH NO DIAGNOSTIC BLOCK AT ALL. It printed one
  # integer and exited, so it could not explain itself even in principle -- and it is the exit that a
  # foreign build reaches when its interference produces a WARNING rather than an error, which walks
  # through the 0-errors gate above untouched. Same cause, second door, and this door had no sign on
  # it. The population is now measured HERE too, on the same evidence and in the same words.
  foreign_build_report "this run's warning count moved off its pinned value"
  exit 1
fi

# ══ THE ORIGIN-SPLIT WARNING LEDGER — task AE-1, owner item 12, STAGE 2 ═══════════════════════════════
#
# 🔴 THE ASSERTION DIRECTLY ABOVE IS A SCALAR OVER A UNION, AND A SCALAR OVER A UNION IS BLIND TO
# CANCELLATION. That is not a hypothesis about a future tree; it is a property of the number, and item 12's
# owner decision deliberately manufactures the conditions under which it bites. The decision puts a population
# NOBODY MAY PAY (the vendored SDK file's warnings, 82 today and 185 with the documentation switch on) beside
# a population that stages 4..N exist to PAY DOWN (ours). Pay three in our source while a re-vendoring adds
# three to theirs and 116 does not move: the gate stays green and BOTH events vanish. A long run of deliberate
# reductions in one ledger, next to a ledger that can rise, is exactly the interval during which a rise is
# invisible -- and that interval is the plan.
# [🔴 "82 today" WITHDRAWN 2026-08-19 by task AF-1: stage 3 turned the switch on, so the vendored bucket now
#  stands at 185 TODAY — measured, and identical to the figure AE-1 predicted for it. Substitute 852 for 116
#  in the sentence above and every word of it still holds; the interval AE-1 described has now begun.]
#
# 🔴 SO THE FIX IS NOT A BIGGER NUMBER, IT IS A PARTITIONED ONE. This block asserts EQUALITY on an ENUMERATED
# map from (ORIGIN BUCKET, WARNING CODE) to COUNT. Every row is pinned; a row appearing, disappearing or
# changing value is red, in either direction, for either bucket. Deliberately NOT a ratchet, for the reason
# EXPECT_WARNINGS already gives at length -- an override can only ever REDUCE, so a one-sided bound would
# swallow the whole class of defect this ledger exists to catch.
#
# ── WHY (BUCKET x CODE), AND NOT THE THREE PARTITIONS THAT LOOK EQUIVALENT. Each was measured on this tree
#    at 3b773e11, and each fails on a case the tree exhibits TODAY:
#      * BY CODE ALONE (which is what stage 1's plan proposed, and it is not enough): CS8601 stands at 2 in
#        the vendored file and 7 in ours; CS8604 at 1 and 14. Both populations already emit the same code, so
#        a code-keyed ledger cancels TODAY, with the switch off. Under the switch it gets worse, not better:
#        CS1591 becomes 95 theirs and 2745 ours, CS1573 8 and 374 -- i.e. the two codes stages 4..N pay are
#        precisely the two codes a re-vendoring moves.
#      * BY PROJECT: the vendored file is COMPILED INTO St4i.EdgeCore. A project-keyed ledger cannot separate
#        these two populations at all, by construction -- they are the same project.
#      * BY FILE: correct but unusable. 90 files carry our own coverage bill; a per-file ledger would have to
#        be edited by every task that touches any of them, and a ledger nobody can leave alone stops being
#        read. It is also STILL not fine enough: one file emits codes with different remedies -- the vendored
#        file's 82 nullable warnings are blocked MECHANICALLY (its own header pins C# 7.3+, so `string?` is
#        illegal there) while its 103 documentation warnings are blocked only by OWNERSHIP.
#    (bucket x code) is the COARSEST partition that is finer than every remedy boundary item 12 draws.
#
# ── THE TEST THIS SATISFIES, stated as the falsifiable form and not as an intention:
#      A mechanism NAMES a debt rather than SUPPRESSING it if and only if putting one more override on top of
#      it turns the gate RED.
#    Under `<NoWarn>` a second override changes nothing, which is why `<NoWarn>` is never naming. Under this
#    ledger the FIRST override is already red: an .editorconfig planted beside the vendored file drops that
#    bucket's rows, the diff below names the bucket, the file it is derived from, the code and both counts.
#    Measured, both halves, transcripts in .superpowers/sdd/item12-stage2/task-1-report.md.
#
# 🔴 AND THIS HALF ALONE DOES NOT PASS THAT TEST, WHICH IS WHY THERE IS A SECOND ONE. This ledger can only see
# an override that removes a warning THAT EXISTS TODAY. `<NoWarn>$(NoWarn);CS1591</NoWarn>` on St4i.EdgeCore,
# committed TODAY, moves not one row here -- CS1591's count is 0 in both buckets while the switch is off -- and
# it would then silence all 543 the moment stage 3 turns the switch on, with no gate anywhere noticing. That is
# not a corner: it is the exact shape of the failure stage 3 is exposed to. The other half is
# [🔴 THE EXAMPLE IS SPENT, THE ARGUMENT IS NOT — recorded 2026-08-19 by task AF-1. Stage 3 has turned the
#  switch on, so THAT particular `<NoWarn>` now moves 543 rows here and this half would catch it. Do not read
#  that as "the second half was for stage 2 only": the property is about codes standing at ZERO, and after
#  stage 3 the codes standing at zero are the ones stages 4..8 drive to zero one file at a time. The day a
#  stage finishes paying CS1574, an override naming CS1574 becomes invisible to this half again, in exactly
#  the shape described above. The second half is what stays.]
# The other half is
# tests/St4i.EdgeCore.Tests/SuppressionCensusTests.cs, which enumerates SUPPRESSION INSTRUCTIONS rather than
# warnings and therefore does not need the code to exist yet. Neither half is redundant and neither is
# sufficient: this one catches suppression of what IS emitted plus every drift in the populations; that one
# catches the instruction itself, including for codes standing at zero.
#
# ── DOMAIN, DECLARED BEFORE THE CODE (§8.1(f)) -- and what is OUTSIDE it:
#      * It reads THIS run's `-t:Rebuild` log and nothing else. An incremental build never shows the whole
#        repository's number; that warning already sits on EXPECT_WARNINGS and it governs this too.
#      * It counts the way MSBuild's own summary counts: once per COMPILATION that emits it. One defect in
#        tests/Shared/TestRunTempRoot.cs counts five times; one in St4iMachineSimulator counts twice, because
#        the WPF markup pass compiles it again as `_wpftmp`. These are MEMBER/OCCURRENCE counts, never
#        distinct source sites -- 543 CS1591 in St4i.EdgeCore sit on 532 distinct sites, because 11 positional
#        `record`s emit two at one location (the type and its primary constructor). Anyone counting this
#        ledger by `grep`ping locations is 11 short.
#      * ORIGIN here means the file the diagnostic NAMES, not the project that emitted it and not the file
#        that caused it. A warning with no source location at all (`CSC : warning xUnit1013`, and NU1701,
#        which names a csproj) lands in OURS -- correctly, since nothing in the vendored file can produce one.
#
# 🔴 AND ORIGIN IS READ FROM THE SOURCE LOCATION ONLY -- THE TEXT BEFORE `: warning` -- NEVER FROM THE
# WHOLE LINE. That distinction is worth 12 warnings TODAY, measured on this tree, and it is written here
# because the obvious implementation is the wrong one and the next person will reach for it:
#     src\St4i.EdgeCore\Transport\LiveTransport.cs(75,24): warning CS8604: Possible null reference argument
#     for parameter 'queuePath' in 'St4iDeviceClient.St4iDeviceClient(string serverUrl, ...)'
# That warning is OURS -- our file, our line, our fix -- and its MESSAGE names the vendored type because
# our transport calls into it. Twelve of the current 116 have that shape (thirteen with the documentation
# switch on). A ledger that matched the vendored file's identity anywhere in the line would report
# 94 vendored / 22 ours instead of 82 / 34, and would file twelve of OUR OWN warnings under the population
# this repository is forbidden to edit -- the worst possible direction, because that bucket's whole meaning
# is "nobody here may touch these".
# Earlier per-population figures in this repository were derived by filtering the log on the file PATH, and
# they are correct -- but only because the path they matched carries the `.cs` extension while the message
# names the bare type. That is luck rather than method: one differently worded diagnostic and it inverts.
# The awk below takes `substr($0, 1, RSTART - 1)` for exactly this reason. Do not "simplify" it to a grep.
#      * It is keyed on ENGLISH MSBuild rendering, the same handover already recorded at EXPECT_WARNINGS. On a
#        localized SDK the match misses, the buckets come out empty and the sum check below REDS. Fails safe.
#      * It says NOTHING about doc-comment coverage today, because with the switch off no such diagnostic is
#        emitted anywhere. What it does say today is not nothing and not asleep: 82 of the 116 already live in
#        the vendored file, so the split it asserts is LIVE, NON-EMPTY and unequal from the day it ships.
#        [🔴 "says NOTHING about doc-comment coverage today" WITHDRAWN 2026-08-19 by task AF-1: the switch is
#         ON in St4i.EdgeCore since stage 3, so doc-comment coverage is now the LARGER half of what this
#         ledger says — 736 of its 852, on five codes. The rest of the bullet stands unchanged.]
#
# 🔴 ITS STAGE-3 BEHAVIOUR IS MEASURED, NOT PROMISED. The same function below, run unchanged over a
# `dotnet build -t:Rebuild -p:GenerateDocumentationFile=true` log (a DIAGNOSTIC: no file in the tree was
# touched, the switch is not set anywhere, `git status --porcelain` was empty either side), splits the whole
# tree into VENDORED 185 / OURS 3414. The vendored bucket gains exactly the 103 nobody may pay -- 95 CS1591
# and 8 CS1573 -- and not one row more. Stage 3 therefore installs no mechanism; it moves two tables.
#
# 🔴 AND STAGE 3 HAS NOW RUN, SO THE PREDICTION ABOVE IS A CLOSED LOOP RATHER THAN A FORECAST (task AF-1,
# 2026-08-19). What AE-1 measured was the ceiling with the switch on for ALL FIFTEEN projects, which is why
# its OURS figure is 3414 against a total of 3599. The owner's ruling names ONE project, so what shipped is
# VENDORED 185 / OURS 667 = 852. The halves that were the actual prediction both landed EXACTLY:
#   * the VENDORED bucket is 185, and its documentation half is precisely the 103 nobody may pay
#     (95 CS1591 + 8 CS1573) with not one row more -- the 82 nullable rows are unmoved, code for code;
#   * the OURS bucket gained precisely 633 (448 CS1591 + 84 CS1573 + 75 CS1574 + 23 CS1734 + 3 CS0419)
#     over its 34, which is the population stages 4..8 exist to pay, MEASURED here rather than subtracted.
# AE-1's closing sentence is therefore confirmed rather than quoted: stage 3 installed NO mechanism. It
# moved two tables and turned one property on.
VENDORED_SOURCE_CSPROJ="src/St4i.EdgeCore/St4i.EdgeCore.csproj"
# 🔴 THE VENDORED FILE'S IDENTITY IS DERIVED, NEVER RE-SPELLED. It is read out of the csproj's own
# `Compile Include`, exactly as DocCommentProseTests derives it, so the two instruments cannot disagree about
# which file this is and a re-vendoring that MOVES the file moves this ledger's definition with it instead of
# quietly reclassifying 82 warnings as ours. More than one outside-cone item is a new population with its own
# owner and its own remedy, so it is a decision to be made here rather than absorbed.
#
# 🔴 AND "OUTSIDE THE CONE" IS DECIDED THE SAME WAY IN BOTH INSTRUMENTS, which it was not on this branch's
# first revision (found by branch review). This block used to filter on the literal prefix `../`, while
# DocCommentProseTests and SuppressionCensusTests resolve the item and ask whether the result lies under the
# project directory. The two agree on today's spelling and disagree on others -- an absolute path, or one
# built from an MSBuild property, is "outside" to the C# pair and invisible to a `../` filter, which would
# have made this gate FAIL LOUD (zero outside-cone items) while the tests passed. Fail-loud is the safe
# direction and a two-criteria "single source of truth" is still a fiction, so the criterion is now RESOLVE
# THEN COMPARE in all three. Sentence retired: "three instruments read one place" was true only of the file
# they read, not of the question they asked it.
VENDORED_PROJECT_DIR=$(cygpath -m "$(realpath -m "$(dirname "$VENDORED_SOURCE_CSPROJ")")")
VENDORED_LINKED=$(
  grep -oE '<Compile[[:space:]]+Include="[^"]*"' "$VENDORED_SOURCE_CSPROJ" 2>/dev/null \
  | sed -E 's/.*Include="([^"]*)".*/\1/' | tr '\\' '/' \
  | while IFS= read -r inc; do
      [[ -n "$inc" ]] || continue
      abs=$(cd "$(dirname "$VENDORED_SOURCE_CSPROJ")" && cygpath -m "$(realpath -m "$inc")" 2>/dev/null) || continue
      case "$(printf '%s' "$abs" | tr 'A-Z' 'a-z')" in
        "$(printf '%s/' "$VENDORED_PROJECT_DIR" | tr 'A-Z' 'a-z')"*) ;;
        *) printf '%s\n' "$abs" ;;
      esac
    done
)
VENDORED_LINKED_COUNT=$(printf '%s\n' "$VENDORED_LINKED" | grep -c . || true)
if [[ "$VENDORED_LINKED_COUNT" != "1" ]]; then
  echo "FAIL: St4i.EdgeCore.csproj declares ${VENDORED_LINKED_COUNT} Compile items from outside its own"
  echo "  directory; the warning ledger below was written when there was exactly one (the vendored"
  echo "  device-client SDK). Every extra one is a population with its own owner and its own remedy."
  echo "  Decide which, and say so beside the ledger: ${VENDORED_LINKED//$'\n'/, }"
  exit 1
fi
VENDORED_FILE="$VENDORED_LINKED"
if [[ ! -f "$VENDORED_FILE" ]]; then
  echo "FAIL: ${VENDORED_FILE} -- named by St4i.EdgeCore.csproj's Compile Include, absent on disk."
  echo "  The warning ledger derives its VENDORED bucket from that path. A ledger whose bucket cannot"
  echo "  exist would sort every one of those warnings into OURS and pass on the totals."
  exit 1
fi
VENDORED_KEY=$(printf '%s' "$VENDORED_FILE" | tr 'A-Z' 'a-z')

# One pass over the SUMMARY block only. MSBuild prints every warning twice -- once inline, once in the
# summary -- and a reader that took both would report exactly double, which is the shape of a census that
# looks careful and is wrong by a constant. The sum check below is what makes that unmistakable rather than
# plausible: two independent counts (MSBuild's own "N Warning(s)" and this partition) must agree.
warning_ledger() {
  awk -v vend="$VENDORED_KEY" '
    /^Build succeeded\./ { insummary = 1; next }
    !insummary { next }
    {
      if (match($0, /: warning [A-Za-z]+[0-9]+/) == 0) next
      prefix = substr($0, 1, RSTART - 1)
      code   = substr($0, RSTART + 10, RLENGTH - 10)
      gsub(/\\/, "/", prefix)
      prefix = tolower(prefix)
      bucket = (index(prefix, vend) > 0) ? "VENDORED" : "OURS"
      n[bucket "\t" code]++
    }
    END { for (k in n) { split(k, a, "\t"); printf "%s %s %d\n", a[1], a[2], n[k] } }
  ' "$BUILD_LOG" | LC_ALL=C sort
}

# 🔴 THE PINNED LEDGER. Move a row only in the same breath as the change that moved it, and say why HERE --
# a warning that arrives with a task is a fact to be justified, not a number to be pasted over. The two
# buckets are pinned separately ON PURPOSE: that separation is the entire deliverable, and merging them back
# into one sorted list would restore precisely the blindness this block exists to remove.
#
#   VENDORED = examples/device-client/csharp/St4iDeviceClient.cs, the published reference SDK kept in step
#              with its Python and Node siblings. THIS REPOSITORY MAY NOT EDIT IT. A row moving here is a
#              re-vendoring or an override, never a defect to fix in place, and never a number to lower.
#   OURS     = every other compilation unit in this solution. A row moving here is ours to explain.
#
# ══ THE ROWS MOVED ONCE, BY TASK AF-1 (item 12 stage 3, 2026-08-19), AND HERE IS EVERY ONE ═════════════
# [🔴 "ONCE" WITHDRAWN 2026-08-19 by task AG-1 (item 12 stage 4), which moved them a second time — see the
#  second banner below. This banner and everything under it is kept verbatim as the record of what stage 3
#  did; only the word "once" was ever a claim about the future, and it is the one that expired.]
#
# 🔴 THE ENUMERATION FIRST, THE COUNTS AFTER, because the count is what goes wrong when it is written
# first — this file has now watched that rule prove itself six times, and the draft of THIS block said
# "six new rows" over a list of seven. AE-1 pinned twelve rows (6 OURS + 6 VENDORED) at 82/34. This table
# holds nineteen (11 OURS + 8 VENDORED) at 185/667. What changed, listed:
# [🔴 "This table holds nineteen ... at 185/667" WITHDRAWN 2026-08-19 by task AG-1: it holds SIXTEEN
#  (8 OURS + 8 VENDORED) at 185/566. True of AF-1's tree, and its enumeration below is still the correct
#  record of what stage 3 added. Read it as history; the live shape is the second banner below.]
#     NEW, OURS      CS1591 448 · CS1573 84 · CS1574 75 · CS1734 23 · CS0419 3   — five rows,  +633
#     NEW, VENDORED  CS1591 95 · CS1573 8                                        — two rows,   +103
#     MOVED          none. Not one of AE-1's twelve rows changed value, in either bucket.
# Seven new rows; 12 + 7 = 19. 633 + 103 = 736, the whole of what the switch added. Every figure was READ
# OUT of the (bucket x code) partition of this commit's own `-t:Rebuild` log. None was subtracted from a
# previous one -- stage 1 measured that this population is not preserved under payment, so a difference is
# not a measurement here and will not be at stages 4..8 either.
#
# 🔴 THE TWELVE THAT DID NOT MOVE ARE EVIDENCE, NOT DECORATION. The switch reaches exactly one compilation.
# If turning it on had changed a nullable count, an NU1701 or an xUnit row anywhere, this task would have
# reached somewhere it had no business reaching, and the ledger is the only thing in this repository that
# could have said so. It is also the check on the classifier: the twelve carry the SAME bucket assignment
# they carried at 116, including the 14 OURS CS8604 whose message text names the vendored type (see the
# source-location note above) -- a whole-line matcher would have moved them into VENDORED the moment the
# populations grew, and it did not, because the classifier reads the source location.
#
# 🔴 "THE 14 OURS CS8604 WHOSE MESSAGE TEXT NAMES THE VENDORED TYPE" IS WITHDRAWN, 2026-08-19, by the task
# that wrote it, one branch-review round later. IT IS 13, AND THEY ARE NOT ALL CS8604. Measured on this
# commit's own log with this file's own classifier: OURS-bucket warnings whose MESSAGE contains
# `St4iDeviceClient` are 12 CS8604 + 1 CS1591 = 13, all thirteen in
# src/St4i.EdgeCore/Transport/LiveTransport.cs. "14" was not measured at all -- it was copied from the
# value of the row sitting next to the sentence (`OURS CS8604 14`), which counts something else entirely:
# every CS8604 we own, whether or not its message names that type.
#   🔴 AND THE CORRECT NUMBER WAS ALREADY IN THIS FILE, ABOUT 140 LINES ABOVE: AE-1's source-location note
#   says "Twelve of the current 116 have that shape (thirteen with the documentation switch on)". Twelve
#   with the switch off, thirteen with it on. The switch is on. A number was written over a correct
#   number, in the same file, by someone who had read that file closely enough to edit around it.
#   This is the "ENUMERATE FIRST, COUNT AFTER" rule failing for the SEVENTH time in this batch, and the
#   first time it reached a commit without anyone catching it in the writing.
# THE PROPERTY THE SENTENCE IS ABOUT IS UNCHANGED AND MEASURED: a matcher testing the WHOLE LINE instead
# of the source-location prefix reports VENDORED 198 / OURS 654 on this same log, against the true
# 185 / 667 -- filing 13 of OUR OWN warnings under the population this repository is forbidden to edit.
# The classifier's correctness is worth exactly those 13, and the count of them is now measured.
#
# 🔴 95 + 8 = 103 IS THE NAMED DEBT AND IT IS PINNED AS AN EQUALITY IN BOTH DIRECTIONS. Nobody in this
# repository may write those comments and nobody may silence them. The two VENDORED documentation rows
# going DOWN is not progress; it is an override or a re-vendoring, and lowering the pin to match is
# precisely how a named debt stops being named. The two going UP is a re-vendoring too. Either is red.
#
# 🔴 AND THE 633 IN `OURS` IS WHAT STAGES 4..8 PAY, ROW BY ROW. Each of those stages re-MEASURES this
# table; none may subtract. Watch CS1573 in particular: paying a CS1591 by writing `<summary>` plus SOME
# of a member's `<param>` tags CREATES a CS1573, so `OURS CS1573 84` is expected to RISE mid-payment while
# `OURS CS1591 448` falls. A stage that reports both falling in lockstep has not measured, it has guessed.
# [🔴 "THE 633" WITHDRAWN 2026-08-19 by task AG-1: 101 of it is PAID and 532 remain, on 90 files, in the
#  two rows named in the sentence. The sentence is otherwise unchanged and its warning is UNSPENT — it is
#  addressed to stages 5..8, which are the stages that WRITE, and this stage wrote nothing. The
#  CS1591 -> CS1573 channel it describes has not been exercised yet by anybody.]
# [🔴 "532 remain" AND "`OURS CS1591 448` falls" BOTH WITHDRAWN 2026-08-19 by task AH-1 (item 12 stage 5),
#  which grepped the whole repository for the literals it was moving because the last stage learned that
#  lesson the expensive way. 412 remain, in those same two rows: 328 CS1591 + 84 CS1573.
#  🔴 THE WARNING IN THE SENTENCE IS STILL UNSPENT, AND AH-1 IS THE STAGE THAT HAD TO SAY SO ABOUT
#  ITSELF. Stage 5 DID write, and CS1573 still did not rise — not because the channel is safe but
#  because none of the 120 members it documented takes a parameter (118 properties and enum members,
#  plus two nullary methods). "Both rows fell in lockstep" would have been the guess this sentence
#  warns about; what happened is that ONE row fell and the other was measured and found unmoved. Stages
#  6..8 inherit the warning at full strength.]
# [🔴 "412 remain" WITHDRAWN 2026-08-20 by task AL-1 (item 12 stage 6), which grepped the repository for
#  the literal before moving it, as the two brackets above require. 283 remain, in those same two rows:
#  243 CS1591 + 40 CS1573.
#  🔴 AND THE WARNING IN THE SENTENCE IS NOW SPENT, WHICH NO STAGE HAS BEEN ABLE TO SAY BEFORE. Stage 6
#  documented 44 members that DO take parameters, so the CS1591 -> CS1573 channel was finally exercised:
#  it fired ONCE, against this stage, when an edit that rewrote an existing block dropped a `<param>` it
#  already had. The row therefore did NOT rise on net -- it fell 84 -> 40 -- but the mechanism is now
#  observed rather than predicted, and its trigger is narrower and nastier than the sentence says. It is
#  not "writing some of a member's tags"; it is EDITING A BLOCK THAT WAS ALREADY COMPLETE. Stages 7..8
#  should read the warning that way, and should count REMOVED `///` lines in their own diff.]
#
# ══ THE ROWS MOVED A SECOND TIME, BY TASK AG-1 (item 12 stage 4, 2026-08-19) ═══════════════════════════
#
# 🔴 THE ENUMERATION FIRST, THE COUNTS AFTER — eighth time this file has watched that rule earn its
# keep. What changed, listed:
#     GONE, OURS   CS1574 75 · CS1734 23 · CS0419 3    — three rows, -101, PAID by re-pointing the claims
#     MOVED        none. Not one of the other sixteen rows changed value, in either bucket.
# Three rows removed; 19 - 3 = 16. VENDORED 185 / OURS 566 = 751.
#
# 🔴 THE EIGHT VENDORED ROWS DID NOT MOVE ONE UNIT, AND THAT IS AN ASSERTION THIS STAGE HAD TO PASS, not
# a pleasant observation. Stage 4 edited 29 files and none of them is the vendored SDK file; if a VENDORED
# row had moved, this task would have edited a file it may not edit. CS1573 8 · CS1591 95 · CS8600 5 ·
# CS8601 2 · CS8603 2 · CS8604 1 · CS8618 35 · CS8625 37 = 185, identical to stage 3.
#
# 🔴 `OURS CS1591 448` AND `OURS CS1573 84` DID NOT MOVE EITHER, AND THAT IS THE SECOND CHECK. Those two
# rows are stages 5..8's bill, not this stage's. The block above explains why they COULD have moved (the
# CS1591 -> CS1573 channel) and why they did not here (nothing was written, only re-pointed). A stage-4
# report showing either of them moving would have been a stage that reached past its own scope.
#
# ══ THE ROWS MOVED A THIRD TIME, BY TASK AH-1 (item 12 stage 5, 2026-08-19) ════════════════════════════
#
# 🔴 THE ENUMERATION FIRST, THE COUNTS AFTER — ninth time this file has watched that rule earn its keep.
# What changed, listed:
#     MOVED, OURS  CS1591 448 -> 328    — one row, -120, PAID by WRITING documentation
#     MOVED        none other. Not one of the other fifteen rows changed value, in either bucket.
# No row was added and no row reached zero, so the table still holds SIXTEEN rows.
# VENDORED 185 / OURS 446 = 631.
#
# 🔴 THE 120 ARE ONE SURFACE, NOT A QUOTA, AND HERE IS THE WHOLE OF IT, per file:
#     Config/MeasurementPoint.cs 64 · Config/ProductModel.cs 17 · Config/LightingShot.cs 12 ·
#     Config/Fiducial.cs 11 · Config/Recipe.cs 8 · Config/ProductVariant.cs 4 ·
#     Config/VariantPointOverride.cs 4
# Seven files, 120 members, all CS1591, zero CS1573 -- they are the edge-local mirror of the ecosystem's
# config-sync data model (docs/CONFIG_SYNC_SERVER_CONTRACT.md). The STORES and CONVERTERS around them
# (ProductConfigStore, MachineConfigStore, ConfigChecksum, ConfigJsonConverters) already carried full
# documentation and contributed no warning at all; it was only the DATA that crossed the boundary
# undescribed.
#
# 🔴 THE EIGHT VENDORED ROWS DID NOT MOVE ONE UNIT — the same assertion stage 4 had to pass, and this
# stage edited seven files, none of them the vendored SDK file. CS1573 8 · CS1591 95 · CS8600 5 ·
# CS8601 2 · CS8603 2 · CS8604 1 · CS8618 35 · CS8625 37 = 185, identical to stages 3 and 4.
#
# 🔴 WHAT STAGES 6..8 STILL OWE, and it is no longer 532: 412 coverage warnings remain on our own source,
# 328 CS1591 + 84 CS1573. The CS1591 -> CS1573 channel is STILL UNEXERCISED by anybody -- see the block
# at EXPECT_WARNINGS for why this stage could not exercise it -- so the first stage that documents a
# member WITH PARAMETERS is still the first stage that can make CS1573 rise. It must expect that and
# re-measure rather than subtract.
# [🔴 THIS WHOLE PARAGRAPH WITHDRAWN 2026-08-20 by task AL-1 (item 12 stage 6), quoted and retired in
#  place. Its figure is superseded (283 owed, not 412 -- see the AL-1 block below) and its forecast came
#  true: stage 6 was the stage that documented members with parameters, it did expect the channel, and
#  the channel fired. What it got right is worth keeping visible; what it could not know is that the
#  channel's real trigger is an edit to an ALREADY-COMPLETE block, not a half-written new one.]
# ══ THE ROWS MOVED A FOURTH TIME, BY TASK AL-1 (item 12 stage 6, 2026-08-20) ═══════════════════════════
#
# 🔴 THE ENUMERATION FIRST, THE COUNTS AFTER — tenth time this file has watched that rule earn its keep.
# What changed, listed:
#     MOVED, OURS  CS1591 328 -> 243    — one row, -85, PAID by WRITING documentation
#     MOVED, OURS  CS1573  84 ->  40    — one row, -44, PAID by COMPLETING `<param>` sets
#     MOVED        none other. Not one of the other fourteen rows changed value, in either bucket.
# No row was added and no row reached zero, so the table still holds SIXTEEN rows.
# VENDORED 185 / OURS 317 = 502.
#
# 🔴 THIS IS THE FIRST STAGE IN WHICH `OURS CS1573` MOVED AT ALL, and it moved DOWN. Stage 1 measured
# that a partial `<param>` set CREATES a CS1573 and warned that stages 5..8 are the stages that write;
# stage 5 reported that it had not de-risked that channel because not one of its 120 members took a
# parameter. This stage's cluster is nothing but parameterised members, so the channel is now exercised
# in both directions: 44 pre-existing CS1573 were paid by completing sets that were already partial, and
# one NEW one was created mid-task by an edit that dropped an existing tag while adding others. It was
# caught by re-measuring per file, not by reading, and it is fixed. Net for the row: -44, measured.
#
# 🔴 THE 129 ARE ONE SURFACE, NOT A QUOTA, AND HERE IS THE WHOLE OF IT, per file:
#     Historian/HistorianModels.cs 71 · Models/TransportAck.cs 23 · Historian/IHistorianStore.cs 13 ·
#     Historian/SqliteHistorianStore.cs 11 · Models/MachineDescriptor.cs 8 ·
#     Historian/HistorianWriter.cs 1 · Historian/OeeSettingsStore.cs 1 · Metrics/OeeCalculator.cs 1
# Eight files, 129 members: 85 CS1591 + 44 CS1573. They are the edge-local historian -- the record this
# product keeps of what its own machines did -- plus the two shapes `HistorianResultRecord.From` folds
# into a row and the one computation read back out of it. See the block at EXPECT_WARNINGS for the
# candidate list this cluster was chosen against, and for why stage 5's selection rule was not reused.
#
# 🔴 THE EIGHT VENDORED ROWS DID NOT MOVE ONE UNIT — the assertion every stage since 4 has had to pass.
# CS1573 8 · CS1591 95 · CS8600 5 · CS8601 2 · CS8603 2 · CS8604 1 · CS8618 35 · CS8625 37 = 185,
# identical to stages 3, 4 and 5. This stage edited eight files, none of them the vendored SDK file.
#
# 🔴 WHAT STAGES 7..8 STILL OWE, and it is no longer 412: 283 coverage warnings remain on our own source,
# 243 CS1591 + 40 CS1573. Measured on the tree this commit produces, the whole remaining population by
# directory: Config 50 (6 files) · Drivers/Modbus 46 (10) · Transport 38 (7) · Drivers/Simulators 27 (11) ·
# Uns 19 (4) · Drivers/OpcUa 17 (5) · Mapping 13 (3) · Site 12 (2) · Engine 11 (3) · Fleet 8 (1) ·
# Drivers/Mqtt 7 (2) · Drivers/HotFolder 7 (2) · Uns/Sparkplug 6 (1) · Infrastructure 6 (3) · Drivers 5
# (1) · Models 11 (2). Largest single file: Config/MachineConfigModels.cs at 33. No figure here may be
# subtracted from by a later stage -- re-measure.
# [🔴 "WHAT STAGES 7..8 STILL OWE ... 283 ... 243 CS1591 + 40 CS1573" WITHDRAWN 2026-08-20 by task AM-1
#  (item 12 stage 7), which re-measured the paragraph before moving it -- and the re-measurement
#  REPRODUCED every one of its sixteen directory figures exactly, which is the strongest thing anybody has
#  been able to say about a forecast in this chain. 221 remain, in those same two rows: 192 CS1591 + 29
#  CS1573. Stage 8 owes them. The directory line above is superseded by the one in the AM-1 block below.]
#
# ══ THE ROWS MOVED A FIFTH TIME, BY TASK AM-1 (item 12 stage 7, 2026-08-20) ════════════════════════════
#
# 🔴 THE ENUMERATION FIRST, THE COUNTS AFTER — eleventh time this file has watched that rule earn its
# keep, and the first time the enumeration was made TWICE for one stage: once per file BEFORE writing (the
# precondition AL-1 asked for) and once after, as the check. What changed, listed:
#     MOVED, OURS  CS1591 243 -> 192    — one row, -51, PAID by WRITING documentation
#     MOVED, OURS  CS1573  40 ->  29    — one row, -11, PAID by COMPLETING `<param>` sets
#     MOVED        none other. Not one of the other fourteen rows changed value, in either bucket.
# No row was added and no row reached zero, so the table still holds SIXTEEN rows.
# VENDORED 185 / OURS 255 = 440.
#
# 🔴 THE 62 ARE ONE SURFACE, NOT A QUOTA, AND HERE IS THE WHOLE OF IT, per file:
#     Transport/TransportCoordinator.cs 9 · Models/Envelopes.cs 7 · Mapping/MappingProfile.cs 7 ·
#     Transport/AutoTransport.cs 6 · Transport/DemoTransport.cs 5 · Transport/LiveTransport.cs 5 ·
#     Transport/SwitchableTransport.cs 5 · Transport/ITransport.cs 4 · Transport/WalFlushPump.cs 4 ·
#     Models/Enums.cs 4 · Mapping/Normalizer.cs 4 · Mapping/MappingProfileResolver.cs 2
# Twelve files, 62 members: 51 CS1591 + 11 CS1573. They are the CANONICAL ENVELOPE and its whole journey
# -- built by `Normalizer` out of a reading and a `MappingProfile`, carried across `ITransport` by four
# implementations, steered by `TransportCoordinator`, replayed from disk by `WalFlushPump`. The cluster is
# three directories taken WHOLE (Transport/, Mapping/, Models/) and each is left at a residue of ZERO.
# See the block at EXPECT_WARNINGS for the candidate list it was chosen against.
#
# 🔴 PER-FILE COSTING AS A PRECONDITION, WHICH IS WHAT AL-1 ASKED FOR AND IT PAID FOR ITSELF DIFFERENTLY
# THAN EXPECTED. It did not catch a dropped tag -- none was dropped, because the three already-partial
# blocks were extended by INSERTION and never rewritten. It caught something else: an intermediate
# measurement taken with seven of the twelve files written showed 36 paid and a residue of 26 sitting
# EXACTLY on the five files not yet touched, file for file. That is how a stage knows the number it is
# watching is the number it intends rather than a coincidence of totals -- a solution-level count of 36
# would have looked identical if one file had been over-paid and another under-paid.
# The cheap pre-check AL-1 named was run too: THREE `///` lines removed in the whole branch diff, all
# three the old `ITransport` summary, all three reproduced verbatim where they stood.
#
# 🔴 THE EIGHT VENDORED ROWS DID NOT MOVE ONE UNIT — the assertion every stage since 4 has had to pass.
# CS1573 8 · CS1591 95 · CS8600 5 · CS8601 2 · CS8603 2 · CS8604 1 · CS8618 35 · CS8625 37 = 185,
# identical to stages 3, 4, 5 and 6. This stage edited twelve files, none of them the vendored SDK file.
#
# 🔴 WHAT STAGE 8 STILL OWES, and it is no longer 283: 221 coverage warnings remain on our own source,
# 192 CS1591 + 29 CS1573. Measured on the tree this commit produces, the whole remaining population by
# directory: Config 50 (6 files) · Drivers/Modbus 46 (10) · Drivers/Simulators 27 (11) · Uns 19 (4) ·
# Drivers/OpcUa 17 (5) · Site 12 (2) · Engine 11 (3) · Fleet 8 (1) · Drivers/HotFolder 7 (2) ·
# Drivers/Mqtt 7 (2) · Infrastructure 6 (3) · Uns/Sparkplug 6 (1) · Drivers 5 (1). Transport, Mapping and
# Models are GONE from this list, which is the checkable form of "three directories, taken whole".
# Largest single file: Config/MachineConfigModels.cs at 33, unchanged. 🔴 Stage 8 is the LAST coverage
# stage and 109 of its 221 are the driver families AL-1 named as the place where "nothing to say beyond
# the name" is the answer -- it owes a FINDING there, not 109 sentences, and item 12 does not leave PART
# II on a stage that filled them. No figure here may be subtracted from -- re-measure.
# [🔴 "WHAT STAGE 8 STILL OWES ... 221 ... 192 CS1591 + 29 CS1573" WITHDRAWN 2026-08-20 by task AN-1 (item
#  12 stage 8), which re-measured the paragraph before moving it -- and the re-measurement REPRODUCED all
#  THIRTEEN of its directory figures exactly, the second consecutive stage able to say that of its
#  predecessor. 109 remain, in those same two rows: 90 CS1591 + 19 CS1573, and they are `Drivers/` and
#  nothing else. 🔴 They are NOT owed to a stage 9. They are owed to a RULING -- see the AN-1 block below
#  and docs/owner-decisions.md §13. The directory line above is superseded by the one in that block.]
#
# ══ THE ROWS MOVED A SIXTH TIME, BY TASK AN-1 (item 12 stage 8, 2026-08-20) ════════════════════════════
#
# 🔴 THE ENUMERATION FIRST, THE COUNTS AFTER — twelfth time this file has watched that rule earn its keep,
# and this stage owes it TWICE: once for what it paid and once for what it deliberately did not. What
# changed, listed:
#     MOVED, OURS  CS1591 192 -> 90    — one row, -102, PAID by WRITING documentation
#     MOVED, OURS  CS1573  29 -> 19    — one row,  -10, PAID by COMPLETING `<param>` sets
#     MOVED        none other. Not one of the other fourteen rows changed value, in either bucket.
# No row was added and no row reached zero, so the table still holds SIXTEEN rows.
# VENDORED 185 / OURS 143 = 328.
#
# 🔴 THE 112 ARE ONE COMPLEMENT, NOT ONE THEME, AND HERE IS THE WHOLE OF IT: twenty files across seven
# directories, all seven taken WHOLE and all seven left at a residue of ZERO -- Config/ 50 (6 files),
# Uns/ 19 (4), Site/ 12 (2), Engine/ 11 (3), Fleet/ 8 (1), Infrastructure/ 6 (3), Uns/Sparkplug/ 6 (1).
# Per file, see the block at EXPECT_WARNINGS. 102 CS1591 + 10 CS1573.
#
# 🔴 THE EIGHT VENDORED ROWS DID NOT MOVE ONE UNIT — the assertion every stage since 4 has had to pass.
# CS1573 8 · CS1591 95 · CS8600 5 · CS8601 2 · CS8603 2 · CS8604 1 · CS8618 35 · CS8625 37 = 185,
# identical to stages 3, 4, 5, 6 and 7. This stage edited twenty files, none of them the vendored SDK file.
#
# ══ WHAT IS LEFT, AND WHY IT IS A QUESTION RATHER THAN A DEBT ════════════════════════════════════════
#
# 🔴 109 COVERAGE WARNINGS REMAIN AND THEY ARE ALL `Drivers/`: Modbus 46 (10 files) · Simulators 27 (11) ·
# OpcUa 17 (5) · HotFolder 7 (2) · Mqtt 7 (2) · Drivers 5 (1). 90 CS1591 + 19 CS1573. They fall on
# NINETY-SEVEN distinct members: 90 with no doc comment at all, plus 7 whose `<param>` set is partial
# (those 7 account for the 19 CS1573). The member count is the honest unit here and it is not the warning
# count -- a scalar over a set nobody has enumerated is not a fact, so the full ninety-seven are listed
# in .superpowers/sdd/item12-stage8/task-1-report.md §6 before any of these numbers is used.
#
# 🔴 AL-1's PREMISE WAS RE-MEASURED AND IT DID NOT SURVIVE. Stage 6 measured this surface as "host-internal
# plumbing whose members mostly cannot be described beyond their names" and named four exemplars; stage 7
# carried that forward and this stage's brief was written on it. Checked member by member against the five
# tests (an invariant, a unit, a value domain, a precondition, a failure mode):
#     Class 1 — a failure mode or a precondition a caller can get wrong ............ 84
#     Class 2 — a unit, a default or a value domain, and no failure mode ........... 13
#     Class 3 — NOTHING beyond the name ............................................. 0
# Two of AL-1's four exemplars survive (`ModbusOptions.Host`, `ModbusOptions.Port` are real and are both
# Class 2). One does not exist as an unpaid member at all: `OpcUaConnectorFactory.Create` already carries
# a doc comment and emits no warning. And "eleven simulator constructors" is a count of FILES read as a
# count of CONSTRUCTORS -- `Drivers/Simulators/` has 11 files and EIGHT simulator classes, so eight
# concrete constructors are owed plus one `protected` base constructor. That is this file's own law
# failing in the other direction, inside the record that this file keeps.
#
# 🔴 THE OWNER'S QUESTION IS "SHOULD THEY BE PUBLIC", AND FOR MOST OF THEM THE QUESTION IS NOT AVAILABLE.
# Measured against the read surface, at a pinned SHA, over the whole tree including the paths this sparse
# checkout does not have on disk:
#     A1  implementations/overrides of a PUBLIC interface or abstract member .... 41  `internal` = compile error
#     A2  enum members ......................................................... 5   C# forbids a modifier
#     B   read by System.Text.Json and by no named call site .................... 9   `internal` COMPILES,
#                                                                                    then silently parses
#                                                                                    to defaults
#     C0  reached only by St4i.EngineApi, which already holds the one IVT ....... 2   free
#     C1  reached by NOTHING outside src/St4i.EdgeCore/ ........................ 15   free, and removes
#                                                                                    dead public surface
#     C2  reached only from TEST assemblies .................................... 16   needs a new IVT to a
#                                                                                    test project
#     C3  reached from a peer PRODUCTION assembly with no IVT ................... 9   needs an IVT to a
#                                                                                    peer production
#                                                                                    assembly
# 41 + 5 + 9 + 2 + 15 + 16 + 9 = 97. St4i.EdgeCore carries exactly ONE InternalsVisibleTo, to
# St4i.EngineApi (src/St4i.EdgeCore/AssemblyInfo.cs), and that file argues in its own prose both against
# widening to a peer production assembly and against restoring the St4i.EdgeCore.Tests entry that GĐ3
# closeout WI-1 Part A deliberately removed. So C2 and C3 are not free: they are paid in the currency that
# file spends most carefully.
#
# 🔴 WHAT THIS MEASUREMENT DOES NOT ANSWER, said plainly: it does not say whether to narrow anything. It
# prices each direction. Documenting costs ~109 doc elements; at stage 7's own measured rate (62 warnings
# -> 199 sentences, 13 of them wrong across two self-check rounds) that is roughly 350 sentences of which
# ~23 would be false on first write. Narrowing is unavailable for 46, silently wrong for 9, free for 17,
# and costs a new InternalsVisibleTo for 25. NO ACCESS LEVEL AND NO NAME WAS CHANGED BY THIS STAGE.
EXPECT_WARNING_LEDGER="OURS CS1573 19
OURS CS1591 90
OURS CS8601 7
OURS CS8604 14
OURS CS8767 2
OURS NU1701 9
OURS xUnit1013 1
OURS xUnit2029 1
VENDORED CS1573 8
VENDORED CS1591 95
VENDORED CS8600 5
VENDORED CS8601 2
VENDORED CS8603 2
VENDORED CS8604 1
VENDORED CS8618 35
VENDORED CS8625 37"

OBSERVED_WARNING_LEDGER="$(warning_ledger)"
LEDGER_SUM=$(printf '%s\n' "$OBSERVED_WARNING_LEDGER" | awk '{s+=$3} END {printf "%d", s+0}')
if [[ "$LEDGER_SUM" != "${WARNINGS:-}" ]]; then
  echo "FAIL: the warning ledger partitioned ${LEDGER_SUM} warnings but MSBuild reported ${WARNINGS:-unknown}."
  echo "  These are two independent counts of one population and they must agree. They do not, so the"
  echo "  partition below is not a census of this build and NOTHING it says may be believed -- including"
  echo "  a green one. Likeliest causes: the 'Build succeeded.' summary marker moved or is absent, or a"
  echo "  localized SDK is not rendering 'warning CSxxxx' in English."
  echo "  full log: $BUILD_LOG"
  exit 1
fi
if [[ "$OBSERVED_WARNING_LEDGER" != "$EXPECT_WARNING_LEDGER" ]]; then
  echo "FAIL: the warning ledger moved. The TOTAL may not have."
  echo "  This assertion exists because ${EXPECT_WARNINGS} is a scalar over a union and a scalar over a union"
  echo "  cannot see one population fall while another rises. Rows are (BUCKET CODE COUNT); '<' is expected,"
  echo "  '>' is what this build produced:"
  diff <(printf '%s\n' "$EXPECT_WARNING_LEDGER") <(printf '%s\n' "$OBSERVED_WARNING_LEDGER") | sed 's/^/    /'
  echo "  VENDORED means: ${VENDORED_FILE}"
  echo "    -- derived from St4i.EdgeCore.csproj's Compile Include, not spelled here. This repository may not"
  echo "       edit that file. A row falling in this bucket is an OVERRIDE (an .editorconfig at or above that"
  echo "       path, a <NoWarn>, a #pragma) or a re-vendoring; it is never a fix, and lowering the pin to"
  echo "       match is how a debt stops being named."
  echo "  OURS means: every other compilation unit in this solution."
  echo "  full log: $BUILD_LOG"
  foreign_build_report "this run's warning ledger moved off its pinned rows"
  exit 1
fi
note "warning ledger: $(printf '%s\n' "$OBSERVED_WARNING_LEDGER" | awk '$1=="VENDORED"{v+=$3} $1=="OURS"{o+=$3} END {printf "%d vendored / %d ours", v+0, o+0}') -- every (bucket,code) row asserted, not printed"

# ── Gate 2: each suite, sequentially, asserting an EXACT total. ──────────────────
# Trap 2. `Failed: 0` is not evidence: an aborted run prints it with a short total.
# Trap 8 (see the build above): the build's own server population must not still be resident
# while the suites run. Measured before this line existed: 14 processes, 1955 MB, alive through
# all five suites. Report what the suites are actually running underneath, so the next person
# reading a machine-wide failure has the number instead of a hypothesis.
#
# 🔴 P-1: this call's BEFORE census is also the answer to "did the build leave anything", which is a
# question this script asked in prose for eight tasks and never measured. MEASURED on this tree: under
# the posture above, one full `-t:Rebuild` leaves exactly ONE resident process, a VBCSCompiler, and no
# MSBuild worker node at all -- the 13-plus population the trap-8 note records was measured BEFORE the
# export existed, and it is what a build WITHOUT this posture still leaves today (14, measured).
build_server_shutdown post-build
assert_shutdown_ran "after the rebuild"
POST_BUILD_COUNT="$SD_BEFORE_COUNT"
POST_BUILD_POSTURE="$SD_BEFORE_POSTURE"
POST_SHUTDOWN_DETAIL="$SD_DETAIL"
# 🔴 THE SURVIVOR LIST IS BACK, AND THE ROUND TRIP IS THE LESSON (P-1, rounds 1 and 2).
# Round 1 DELETED this variable, correctly: it was assigned and never read, which is trap 9 committed in
# the same change that quotes trap 9's rule at two other sites. Round 2 reinstates it because it now has
# a READER -- `attribute_build_servers` needs it to separate SURVIVAL from ARRIVAL, and that separation
# is the thing the NO-EFFECT guidance sends an operator to act on. Trap 9's rule is "asserted or
# deleted", not "never computed": the difference between the two rounds is whether anything consumes it.
# The VERDICT travels with the list on purpose -- see the empty-vs-unknown note in the attribution block.
POST_SHUTDOWN_VERDICT="$SD_VERDICT"
POST_SHUTDOWN_SURVIVORS="$SD_SURVIVOR_PIDS"
note "build servers left by the build: ${POST_BUILD_COUNT:-unreadable} (posture ${POST_BUILD_POSTURE:-?}) -- shutdown ${SD_DETAIL}"
# 🔴 TRAP 7 AGAIN, IN A NEW COSTUME — a checker that cries wolf, found by the first task that ran
# under it. This counted processes BY NAME (`Get-Process dotnet`), and VS Code's C# Dev Kit language
# server is also `dotnet.exe`. So the assertion below failed whenever the repository was merely OPEN
# IN AN EDITOR: a run reported "3 build-server processes" of which TWO were
# Microsoft.CodeAnalysis.LanguageServer, untouched by `dotnet build-server shutdown` and no business
# of this gate's.
#   (Reproducing that needs the language server hosted UNDER `dotnet.exe`. On csdevkit-3.20.199 /
#   csharp-2.140.9 it ships its own apphost `Microsoft.CodeAnalysis.LanguageServer.exe`, so today
#   the OLD matcher would also return 0 for Dev Kit -- the review measured that. The .dll ships too
#   and `vscode-dotnet-runtime` is installed, which is how it lands under `dotnet.exe`. Version
#   named so the next person re-testing does not conclude this comment is false and reach for the
#   ceiling instead. What is NOT version-dependent is Dev Kit's build host, measured live:
#   `Microsoft.CodeAnalysis.Workspaces.MSBuild.BuildHost.dll` passes the name filter and fails the
#   regex, because it never contains the literal `MSBuild.dll`.)
# That is trap 7's exact inversion — a healthy positive read as a failure — and it
# costs the same, because a verification tool that fires on innocent states gets its output ignored,
# which is precisely how the number this assertion protects went unwatched for eight tasks.
#
# So match on what the process IS, not what it is called: an MSBuild worker node, the Roslyn
# compiler server, or the Razor server. Those three are exactly what `dotnet build-server shutdown`
# targets -- it names all three in its own output -- which is the only population this check is
# entitled to have an opinion about.
#
# 🔴 AND THE FIRST REWRITE INTRODUCED TWO FALSE NEGATIVES, i.e. it could newly read HEALTHY while
# the defect was present -- the one direction this whole rewrite exists to avoid. Both found by the
# review pressing "does the new matcher miss anything", which is the question the fix did not ask
# itself:
#   (a) `rzc.dll`, the Razor server, was dropped. Measured: a live one scores False on the old
#       regex, and `dotnet build-server shutdown` reports "Shutting down Razor build server
#       (process N)... shut down successfully" and kills it. Unreachable in this repo today (no
#       .razor/.cshtml anywhere), reachable the day someone adds one -- a check that silently stops
#       covering a case when the repo grows into it is worse than one that never covered it.
#   (b) A NULL CommandLine matched nothing, so it FAILED OPEN. Measured non-elevated: 182 of 419
#       processes report a null command line, because a process owned by another account or an
#       elevated shell does not surrender it. `Get-Process` still sees them. So an MSBuild node
#       started elevated was counted by the old name-based matcher and skipped silently by the new
#       one. Null now counts as a hit: this check may cry wolf on an unreadable process, and must
#       never wave one through.
# 🔴 P-1 moved the predicate itself into BUILD_SERVER_WHERE, above the build gate, and changed NOT ONE
# CHARACTER of it -- verified by diffing the expanded command against the old literal. It is shared
# with the census because a second copy is a matcher that a future fix reaches only half of, and the
# two false negatives recorded above are what that costs. Everything this comment block says about
# WHY the predicate is shaped this way still governs it; only its storage moved.
build_node_sample() {
  powershell -NoProfile -NonInteractive -Command \
    "(${BUILD_SERVER_WHERE} | Measure-Object).Count" \
    2>/dev/null | tr -d '\r' | head -1
}

# 🔴 TRAP 9 AGAIN, ELEVEN LINES BELOW ITS OWN FIX. The whole-branch review found this while
# reviewing the EXPECT_WARNINGS commit directly above: that commit argues "a printed number is not
# a check" and then left an identical printed number here — trap 8's OWN instrument, reporting the
# population this script creates, asserting nothing about it. The header records it measured at 14
# processes and 1955 MB alive through all five suites. The sweep that added the warnings check
# stopped at the number it was looking at.
#
# So the rule this script keeps re-learning, now stated where both instances sit: EVERY number
# this script computes is either asserted or deleted. A `note` is for something a human reads
# alongside a verdict, never for something the verdict depends on.
# ══ TRAP 10 — THE SAMPLE WAS TAKEN AT AN INSTANT THAT MEANT NOTHING (carried from K-1, closed by L-1).
#
# `dotnet build-server shutdown` above SIGNALS teardown; the sample used to run with NO wait, poll or
# retry. It went red three times during K-1, ALWAYS against a rebuild this script itself had just
# launched, and cleared every time on a re-run with NO CODE CHANGE. That is the tell: a genuine leftover
# population does not clear itself on a re-run — a teardown race does.
#
# Two aggravators, both still in this file and both still deliberate:
#   * the null-`CommandLine` rule counts unreadable processes (fail-loud, added on purpose above) — and a
#     process IN TEARDOWN is exactly when CommandLine becomes unreadable, so that fix feeds this failure;
#   * MSBUILDDISABLENODEREUSE does not govern VBCSCompiler, which is precisely what `shutdown` must race.
#
# 🔴 WHY THIS WAS DEFERRED, AND WHAT PAYS THE DEBT. K-1 deferred it for a reason that was about INCENTIVE
# rather than authorship: *the natural remedy RELAXES an assertion — "zero now" becomes "zero within N" —
# on evidence EQUALLY CONSISTENT with a genuine leftover population draining, inside the round that
# assertion is judging.* That reason is correct and it is the specification this fix had to satisfy.
#
# SO THIS IS NOT "ZERO WITHIN N", AND THE DIFFERENCE IS THE WHOLE POINT:
#   * The ACCEPTED SET IS UNCHANGED. The verdict is still `settled == 0` — exactly one value passes, the
#     same one as before. No count above zero is tolerated at any deadline, so nothing was loosened.
#   * WHAT MOVED IS WHICH INSTANT IS MEASURED, and only that: the sample is now taken at the first moment
#     the population has STOPPED MOVING, instead of at an arbitrary point inside an asynchronous teardown.
#   * A POPULATION THAT DOES NOT DRAIN IS STILL RED, and it is red NO LATER than a draining one: standing
#     still IS stability, so it settles at its non-zero value on the third reading — the earliest any
#     reading can settle — and fails there. Demonstrated by measurement, not by argument: see the task
#     L-1 report for two end-to-end runs of this script against a population that cannot drain.
#   * NEVER SETTLING IS ITS OWN RED. A count that keeps moving for the whole bound is not waved through as
#     "still draining"; it fails with its own message. "Sample until stable, and FAIL if it never
#     stabilises" is the shape — never "zero eventually".
# The old form's failure text already claimed the property this form actually measures ("the suites would
# run under a population this script created"): the suites start AFTER this loop, so a settled zero is a
# statement about the state the suites are ENTERED in, while a single sample was a statement about one
# instant that nothing depended on.
#
# 🔴 AND THE LIMIT OF THAT, STATED HERE RATHER THAN LEFT TO BE DISCOVERED: it is still a measurement at ONE
# instant — the instant the count stops moving. A build server that ARRIVES AFTER that is invisible to this
# check, exactly like the appear-and-vanish hole the credential bracket names for itself. MEASURED, not
# feared: a run made under a churner that started a short-lived matching process every few seconds settled
# at 0 and passed. Closing that needs a WATCHER, and this is not one.
#
# THE IDIOM IS BORROWED, NOT INVENTED: the CPU-flat hang detector below already decides "has this stopped
# moving?" by consecutive samples carried across iterations, and for the same reason — one observation of
# a quantity in motion cannot distinguish a transient from a state. Two rules are borrowed with it:
#   * an UNREADABLE sample means "cannot tell" and can NEVER count towards stability (empty must never
#     read as flat), so a machine with no PowerShell fails this gate rather than skipping it; and
#   * the tolerance is deliberately lopsided — the bound is generous because waiting costs seconds while a
#     false red costs a whole gate run.
#
# 🔴 THE SYMMETRIC SITE, NAMED RATHER THAN LEFT SILENT (§8.1(h4)): `dotnet build-server shutdown` is called
# TWICE in this script — once at [1/3] before the rebuild, once above. The first one is STILL DELIBERATELY
# NOT POLLED, for the reason this note has always given: no verdict is read from it, nothing samples the
# population between it and the build, so there is no instant there that can be measured wrongly. What that
# shutdown is for — the build not running under a previous run's leftovers — is asserted by the build's own
# gates instead (0 errors, and the MSB3061 check that catches exactly the "a live process held our output
# files" outcome). Adding a POLL there would buy no assertion and would cost every run the wait.
#
# 🔴 P-1 CORRECTED THE HALF OF THAT ARGUMENT THAT WAS NEVER TRUE, and it is worth being precise about
# which half. Everything above is about MIS-MEASURING, and it is right. It was silent about the other
# direction: IF THE COMMAND FAILS, NOTHING NOTICED — at either site, because both were
# `>/dev/null 2>&1 || true`, which throws away the output and the exit code together. "No verdict is read
# from it" was offered as the reason not to measure, and it was in fact a description of the defect.
# BOTH sites now keep the log, assert the exit code, and take a CENSUS on each side. A census is not a
# poll: two instantaneous readings, ~0.29 s each, no wait, no settle loop, no tolerance. The refusal above
# was always about the ~4.9 s floor of the poll; it was never about the evidence, and conflating the two
# is what let a discarded exit code sit next to a paragraph explaining why it was fine.
#
# 🔴 TRAP 9 STILL APPLIES: the settled number is ASSERTED, and the series below it is printed for a human
# to read alongside the verdict. EVERY number this script computes is either asserted or deleted.
# 🔴 WHAT THIS COSTS ON A RUN THAT PASSES, because a check that taxes every green run should say the
# number rather than leave it to be discovered (review, Minor 3). The cheapest possible outcome is still
# THREE readings and TWO sleeps: MEASURED on this machine, one reading is ~0.29 s (PowerShell start-up
# dominates it — the CIM query itself is nothing) and the floor is ~4.9 s, three runs, 4.87/4.91/4.94.
# That is the FLOOR, paid by every green gate run, not a worst case. It buys the distinction between a
# teardown that is draining and a population that is standing still, which one reading cannot make at any
# price. The ceiling is ~60 s + query time, and only a machine that never settles pays it.
BUILD_NODE_STABLE_SAMPLES=3       # equal consecutive readings before the population counts as settled
BUILD_NODE_SAMPLE_INTERVAL=2      # seconds between readings
BUILD_NODE_MAX_SAMPLES=30         # hard bound: ~60s of polling, then FAIL for never settling
BUILD_NODES=""
BUILD_NODE_SERIES=""
_bn_stable=0
_bn_prev=""
_bn_settled=0
for ((_bn_i = 1; _bn_i <= BUILD_NODE_MAX_SAMPLES; _bn_i++)); do
  _bn_now=$(build_node_sample)
  BUILD_NODE_SERIES="${BUILD_NODE_SERIES}${BUILD_NODE_SERIES:+ }${_bn_now:-?}"
  if [[ -z "${_bn_now:-}" ]]; then
    # "Cannot tell" is not "unchanged". Reset, exactly as the CPU detector refuses to call an empty
    # sample flat -- otherwise a PowerShell that stopped answering would settle this check at "".
    _bn_stable=0
  elif [[ "$_bn_now" == "$_bn_prev" ]]; then
    _bn_stable=$((_bn_stable + 1))
  else
    _bn_stable=1
  fi
  _bn_prev="${_bn_now:-}"
  if [[ -n "${_bn_now:-}" && $_bn_stable -ge $BUILD_NODE_STABLE_SAMPLES ]]; then
    BUILD_NODES="$_bn_now"
    _bn_settled=1
    break
  fi
  sleep "$BUILD_NODE_SAMPLE_INTERVAL"
done
note "build servers entering the test phase: ${BUILD_NODES:-unsettled} (samples: ${BUILD_NODE_SERIES})"

if [[ $_bn_settled -eq 0 ]]; then
  echo "FAIL: the build-server population NEVER STOPPED MOVING across ${BUILD_NODE_MAX_SAMPLES} readings"
  echo "  ${BUILD_NODE_SAMPLE_INTERVAL}s apart, so this run has no instant at which it can honestly say what"
  echo "  the suites are about to run underneath. Readings: ${BUILD_NODE_SERIES}"
  echo "  A '?' is an UNREADABLE sample (PowerShell absent or refusing), which never counts as settled --"
  echo "  a check that cannot measure must fail, not skip."
  # 🔴 R-1 REMOVED "another gate run" FROM THIS LIST, and removing it is a claim that has to be
  # earned rather than a tidy-up. It is earned by the exclusive-run lock near the top of this file:
  # a second run of THIS FILE cannot reach this point while this one holds the lock, so it is no
  # longer a candidate cause and leaving it named would send the reader to look for something the
  # gate has already excluded. Everything else on the list is untouched, because nothing excludes it.
  echo "  Something is spawning or reaping build servers continuously: an IDE or project-system build"
  echo "  host, a second build in another shell, or a watch task. The block below names their parent"
  echo "  process where the machine still knows it. Stop it and re-run."
  attribute_build_servers
  exit 1
fi

EXPECT_BUILD_NODES=0
if [[ "${BUILD_NODES:-}" != "$EXPECT_BUILD_NODES" ]]; then
  echo "FAIL: ${BUILD_NODES:-unknown} build-server process(es) are resident entering the test phase,"
  echo "  expected ${EXPECT_BUILD_NODES}. Readings: ${BUILD_NODE_SERIES}"
  echo "  This is a SETTLED count, not a snapshot taken mid-teardown: it stopped moving and it is not zero,"
  echo "  so 'try again, it was probably draining' is exactly what this reading rules out."
  echo "  The suites would run underneath it, which is machine-wide memory pressure in the same window as"
  echo "  the memory-sensitive part of this run. For a sense of SCALE only: a population of this kind was"
  echo "  once measured at 14 processes / 1955 MB -- that figure sized a SELF-CREATED, pre-export"
  echo "  population (trap 8) and is not a claim about where THIS one came from; see the block below."
  # 🔴 P-1 DELETED A SENTENCE THAT WAS FALSE. This used to say the suites "would run under a population
  # THIS SCRIPT CREATED", unconditionally, as the explanation for every non-zero reading. It is an
  # attribution the gate never measured and, for the run that motivated this task, it was simply wrong:
  # the resident processes carried /nodeReuse:true, which this script cannot produce. A checker that
  # names the wrong culprit sends its reader to rewrite the wrong file, and this file's own history has
  # four tasks carrying forward a diagnosis that a remedy had manufactured. So the culprit is measured
  # now, and the block below is the measurement rather than the story.
  attribute_build_servers
  exit 1
fi
# ══ THE BRACKET ON EACH SUITE'S OWN OUTPUT DIRECTORY (task X-1) ═════════════════════════════════
#
# WHAT THIS IS FOR. tests/Shared/OwnOutputDirectoryGuard.cs asserts that a test process leaves its own
# output directory exactly as it found it. That directory outlives every run -- the build writes it, and
# nothing ever cleans it -- and THREE of the product's stores resolve to it by default, so a file one run
# writes is a file the next run reads. The C# guard has the same two holes K-1's credential guard has, it
# names them in its own doc comment, and neither is closable from inside a test:
#   * five suites are five processes, so five baselines and no delta across them;
#   * its interval ends when its [Fact] runs, and xunit orders nothing.
#
# 🔴 THE SECOND HOLE IS MEASURED ON THIS TASK, not inherited from K-1's write-up, and it is why this
# bracket exists rather than being booked. X-1's own §8.1(h6) DIRTY ARM -- the ST4I_MACHINE_CONFIG_DIR
# redirect disabled, i.e. the exact pre-fix tree, over a 15-test filter of St4i.EngineApi.Tests -- wrote a
# fresh machine-operating-config.json into that suite's output directory (1 entry, AOI-01, History list of
# 1: one run's worth of the 624 that had accumulated) and the C# guard reported GREEN, because its [Fact]
# was scheduled ahead of the writer. So the guard is the ATTRIBUTING half and never the complete one, and
# a control pair resting on it alone would have been scheduling-dependent -- which is not a control.
#
# WHY THE SNAPSHOT IS HERE AND NOT AT THE TOP OF THE FILE. The BUILD writes these directories, so a
# bracket spanning the build would report the build. Taking the BEFORE reading at this line -- after the
# build gate, after the warnings gate, after the build-node gate, immediately before the first suite
# starts -- makes the window exactly the test phase and nothing else. That placement is also why this
# needs NO EXIT trap: every `exit 1` above this line happens before the snapshot exists, and nothing
# between here and gate 3 exits, so the evaluation folded into FAILURES down there is always reached.
# bash allows exactly ONE EXIT trap and `creds_bracket_trap` already owns it; a second would silently
# replace it and leak the exclusive-run lock, which that function's own comment spells out.
#
# 🔴 WHAT IS EXEMPT, AND THE EXEMPTION IS DERIVED SO THAT IT CANNOT OUTLIVE ITS REASON. The product roots
# three stores beside the binary. ONE of them, MachineConfigStore, has a relocation variable (task H-1c
# built the seam; tests/Shared/TestRunTempRoot.cs now sets it), so its file leaves this directory
# altogether and is NOT exempt -- it is the thing this bracket is watching for. The other two,
# ProductConfigStore and SimulatedEcosystem, declare no EnvVarDir, so no ENVIRONMENT VARIABLE moves them.
#
# 🔴 THAT IS NOT "NO SEAM", AND THE FIRST DRAFT OF THIS BLOCK SAID IT WAS (review Important 2). Both take
# `string? directory = null` and the suites already run the RemoveAll/AddSingleton replacement idiom, so a
# tests/-only closure IS available today. The refusal stands on the reason tests/Shared/TestRunTempRoot.cs
# already gives for its own 263 call sites, not on an absent seam: closing a leak at N call sites fixes
# today's N and none of tomorrow's, and the (N+1)th leaks silently with nothing in the way. Here N is 23
# sites across 20 files. The mechanism-level fix is a relocation variable, and THAT is the src/ change --
# shipped behaviour on every install -- which task X-1 was told to REPORT rather than do.
# Their files are exempt, and the filenames are read out of
# those two stores' OWN SOURCES together with the justification -- the sources must still declare their
# filenames and must still declare NO EnvVarDir. The day either store gains a seam this derivation fails
# the run and demands the exemption be spent instead of inherited.
#
# 🔴 WHAT THIS BRACKET DOES NOT SEE, on top of everything the C# guard's doc comment already lists.
#   * APPEAR-AND-VANISH. A file created and deleted inside the window cancels out, exactly as for the
#     credential bracket. Two readings cannot see it; only a watcher could.
#   * CONTENT AT CONSTANT SIZE AND TIMESTAMP. This compares path + BYTE COUNT + MODIFICATION TIME, never
#     content. A rewrite producing the same length within the same filesystem tick is invisible.
#   * READS. This sees WRITES. A run that READS residue an earlier run left and writes nothing is green
#     here and is still not hermetic. That half is not closed by any assertion in this file; it is closed
#     by the directory being at its build-clean state, which is a fact about a machine on a day.
#   * THE DOMAIN IS WIDER THAN THE CRITERION'S, exactly as the credential bracket's is. This measures
#     THE DIRECTORIES over the window, not "the test processes". A `dotnet build` in another shell, an
#     IDE writing into bin/, or a developer running the engine out of one of these folders reddens it and
#     is not a test defect. The C# guard is what attributes; keep both.
_x1_unseamed_srcs=(
  "src/St4i.EdgeCore/Config/ProductConfigStore.cs"
  "src/St4i.EngineApi/Config/SimulatedEcosystem.cs"
)
_x1_seamed_src="src/St4i.EdgeCore/Config/MachineConfigStore.cs"
OUTDIR_EXEMPT=()
for _src in "${_x1_unseamed_srcs[@]}"; do
  if [[ ! -f "$_src" ]]; then
    echo "FAIL: could not read \"$_src\" to derive which files an UNSEAMED beside-the-binary store persists."
    echo "  Do NOT restate the filenames here -- a restated list outlives the reason it was written, which"
    echo "  is the defect this derivation exists to prevent. Point this at the store's new home, or delete"
    echo "  the exemption if the store is gone."
    exit 1
  fi
  if grep -q 'EnvVarDir' "$_src"; then
    echo "FAIL: \"$_src\" now declares a relocation seam (EnvVarDir), so it is NO LONGER an unseamed store"
    echo "  and must not be exempt from this bracket. Set that variable in tests/Shared/TestRunTempRoot.cs"
    echo "  beside ST4I_CREDS_DIR and ST4I_MACHINE_CONFIG_DIR, then remove this source from the list above."
    echo "  This is the GOOD outcome: the exemption existed only because the store could not be moved."
    exit 1
  fi
  mapfile -t _x1_names < <(
    grep -oE 'const[[:space:]]+string[[:space:]]+[A-Za-z0-9_]*FileName[A-Za-z0-9_]*[[:space:]]*=[[:space:]]*"[^"]+\.json"' "$_src" \
      | grep -oE '"[^"]+\.json"' | tr -d '"')
  if [[ ${#_x1_names[@]} -eq 0 ]]; then
    echo "FAIL: found no persisted-filename constant in \"$_src\", so this bracket cannot tell which of that"
    echo "  store's files to exempt. A scan that stops matching must fail loudly rather than exempt nothing"
    echo "  and report that store's every write as an unexplained one."
    exit 1
  fi
  OUTDIR_EXEMPT+=("${_x1_names[@]}")
done
if [[ ! -f "$_x1_seamed_src" ]] || ! grep -q 'EnvVarDir' "$_x1_seamed_src"; then
  echo "FAIL: \"$_x1_seamed_src\" no longer declares an EnvVarDir seam. TestRunTempRoot's"
  echo "  ST4I_MACHINE_CONFIG_DIR redirect depends on it, so without it that store is writing into these"
  echo "  directories again and the exemption above is describing a population that has changed shape."
  echo "  Re-derive the whole arrangement rather than widening the exemption."
  exit 1
fi

# The five directories, derived from SUITES rather than listed -- a sixth suite is bracketed the day it is
# added. `bin/Debug/*` because the target framework differs across them (net10.0 vs net10.0-windows) and
# spelling either would be a literal that rots.
outdir_list() {
  local entry proj d
  for entry in "${SUITES[@]}"; do
    proj="${entry%%:*}"
    for d in "$proj"/bin/Debug/*/; do
      [[ -d "$d" ]] && printf '%s\n' "${d%/}"
    done
  done
}

# path + byte count + modification time, one file per line, exempt basenames dropped. Enumerates metadata
# and never opens, creates or deletes anything.
#
# 🔴 THIS FUNCTION'S FAIL-CLOSED ARM DEPENDS ON `set -o pipefail` AT LINE 51, TWO THOUSAND LINES AWAY, AND
# THAT DEPENDENCY IS NAMED HERE BECAUSE DELETING IT WOULD DISARM THE ARM SILENTLY RATHER THAN BREAK IT
# LOUDLY (review Minor 3). The body ends in a pipeline, so `find ... || return 1` runs in the LEFT-HAND
# subshell; without pipefail the function would return `sort`'s status -- 0 -- and `if ! outdir_snapshot`
# could never fire, which would make a directory that could not be READ read exactly like a clean one.
# That is the absent-vs-unreadable hole the credential bracket had to close twice on its own snapshot.
outdir_snapshot() {
  local d
  while IFS= read -r d; do
    find "$d" -type f -printf '%p\t%s\t%T@\n' || return 1
  done < <(outdir_list) \
    | awk -F'\t' -v ex="$(IFS='|'; printf '%s' "${OUTDIR_EXEMPT[*]}")" '
        BEGIN { n = split(ex, a, "|"); for (i = 1; i <= n; i++) e[a[i]] = 1 }
        { p = $1; sub(/^.*\//, "", p); if (!(p in e)) print }' \
    | LC_ALL=C sort
}

OUTDIR_BEFORE="$LOGDIR/outdirs-before.txt"
OUTDIR_AFTER="$LOGDIR/outdirs-after.txt"
# 🔴 PER SUITE, NOT A TOTAL — review Important 3, and the first revision of this check FAILED OPEN in
# exactly the case its own message claims to refuse. It compared `outdir_list | grep -c .` against
# ${#SUITES[@]}: a suite carrying TWO target-framework directories (a retarget leftover) plus a suite
# carrying NONE sums to five and passes, while one suite goes entirely unwatched. A sum cannot see a
# cancellation, which is the same defect the credential bracket's own comment records for count deltas —
# committed here in the check whose message is "a partial reading reads exactly like a clean one".
for entry in "${SUITES[@]}"; do
  proj="${entry%%:*}"
  _x1_n=0
  for d in "$proj"/bin/Debug/*/; do [[ -d "$d" ]] && _x1_n=$((_x1_n + 1)); done
  if [[ $_x1_n -ne 1 ]]; then
    echo "FAIL: suite \"$proj\" contributes ${_x1_n} output director(ies) under bin/Debug, expected exactly 1."
    echo "  Checked PER SUITE on purpose: a total over the five cancels, so two directories on one suite"
    echo "  would mask none on another and the bracket would watch four suites while reporting five."
    echo "  Fix the layout or the glob; do not relax this to a sum."
    exit 1
  fi
done
if ! outdir_snapshot > "$OUTDIR_BEFORE"; then
  echo "FAIL: could not take the output-directory bracket's BASELINE. Stopping rather than running the"
  echo "  suites under a bracket that cannot fail."
  exit 1
fi
# NOT a check -- a `note` is for a human reading alongside a verdict, never something a verdict depends on.
# 🔴 THE CAVEAT TRAVELS WITH THE GREEN TOO (review Minor 2). The failure text below carries the window
# caveat; this line is what a reader meets when everything passes, and a green OwnOutputDirectoryGuardTests
# is the single most misreadable output this change produces. Say what green does NOT mean, here.
note "suite output directories under watch: ${#SUITES[@]} ($(grep -c . < "$OUTDIR_BEFORE" || true) files at start, exempt: ${OUTDIR_EXEMPT[*]})"
note "  green here means NOTHING WAS LEFT BEHIND -- never that nothing was READ; a residue file loaded at"
note "  startup and not written back is invisible to both halves of this instrument."

echo "[2/3] Running ${#SUITES[@]} suites sequentially..."
for entry in "${SUITES[@]}"; do
  proj="${entry%%:*}"; expected="${entry##*:}"; name=$(basename "$proj")
  log="$LOGDIR/$name.log"
  # 🔴 TRAP 7(f): this ran at `-v q`, so the log this script hands you on a failure carried the
  # failing test's NAME AND NOT ITS REASON — the one occasion the log exists to serve was the one
  # occasion it was empty. Output goes to a FILE, never to a terminal, so the quiet was bought
  # with nothing and cost the only thing the log is for.
  #
  # 🔴 TRAP 7(g) and 7(h) — I caused both while fixing 7(f), and they are the most instructive
  # entries here because each looked correct until it was measured.
  #   (g) My first fix was `-v n`. WRONG KNOB. `-v` sets MSBuild's verbosity; test results come
  #       from the vstest LOGGER, which `-v` does not control. The run emitted a 170-line BUILD
  #       log ending in "0 Error(s)" with no result line at all. This script's own "no Total
  #       line" guard caught it and failed all five suites — correctly, on its author.
  #   (h) My second fix was `--logger console;verbosity=detailed`. That DOES carry failure
  #       messages, and it REPLACES the summary with a different format: `Total tests: 151`
  #       instead of `Total: 151`, and no `Skipped:` line at all when nothing skipped. Every
  #       parse below would have broken. Caught by comparing the two invocations side by side
  #       rather than by reasoning about which flag sounded right.
  # The trx logger is the answer: it writes full failure detail to a FILE and leaves vstest's
  # console summary byte-for-byte untouched, which is exactly the two things needed at once.
  # Verified by running both forms and diffing the last three lines.
  dotnet test "$proj" --no-build --nologo -v q \
    --logger "trx;LogFileName=$name.trx" > "$log" 2>&1 &
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
  # HUNG_SAMPLES consecutive flat periods before it will kill anything.
  #
  # 🔴 AND THE CPU CHECK IS THE COMPANION, NOT THE PRIMARY -- I had that backwards. C-7 observed
  # EdgeCore idle at a GENUINELY FLAT 9.55s of CPU for several minutes mid-suite and then finish
  # 735/735 normally, in the same session where another suite sat "flat but stopped". So
  # flat-and-healthy and flat-and-hung both occur here, minutes apart, in the same project: the
  # CPU heuristic cannot separate them IN EITHER DIRECTION. The wall-clock ceiling below is what
  # actually bounds the failure; the CPU check only makes the common case fail faster.
  #
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
  # 🔴 TRAP 7(d) — a STRUCTURAL limit of the CPU heuristic, not a bug in it. Found by C-7 when
  # DeviceIdentityStoreTests' real-mTLS-handshake test wedged EdgeCore for ~20 MINUTES at
  # 9.77s CPU, creeping ~16ms at a time. That creep is enough to reset the consecutive-flat
  # counter on every iteration, so the detector below waits on it FOREVER. A process that is
  # stopped but not idle is invisible to "is the CPU flat" by construction.
  #
  # 🔴 R-1 SAW THAT SAME TEST DO SOMETHING ELSE, AND IT IS RECORDED HERE BECAUSE A LIMIT THAT LIVES
  # ONLY IN A TASK REPORT IS A LIMIT THE NEXT READER DOES NOT HAVE — this file's own rule, written
  # by the previous task at `build_server_census` and, until this line, applied everywhere except to
  # itself. Trap 7(d) above is about that test WEDGING. R-1 observed it FAIL outright, ONCE IN FIVE
  # otherwise-identical gate runs, on a run whose five suite totals were all exact:
  #     Certificate_LoadedFromStore_CanCompleteARealMutualTlsHandshake
  #     server-side handshake threw: System.IO.IOException ... SocketException (10054):
  #     An existing connection was forcibly closed by the remote host
  # It performs a REAL mutual-TLS handshake over loopback, so it can lose the connection for reasons
  # that are nothing to do with the certificate it is asserting about. Different failure mode from
  # the wedge, so the note above does not cover it, and somebody reading `EdgeCore 1105/1106` needs
  # to find this rather than a paragraph about a hang.
  # WHAT THIS IS NOT: it is not a claim the test is wrong, and it is emphatically not permission to
  # ignore it. 1 in 5 is a frequency, not a diagnosis; nobody has found the mechanism, nothing here
  # retries it, and NO ASSERTION WAS RELAXED FOR IT — a red from this test still fails the gate. If
  # it reddens on a run you care about, the next question is whether the handshake or the tree
  # failed, and this note exists so that question starts from a measurement instead of a surprise.
  #
  # So the CPU heuristic gets a companion it cannot argue with: a hard wall-clock ceiling.
  # The two answer different questions -- "is it doing anything?" and "has it taken longer than
  # any healthy run ever does?" -- and a hang only has to trip one. The ceiling is generous
  # (the slowest suite here runs ~3-4 min; 15 min is ~4x) because killing a healthy suite costs
  # the whole run, orphans a test host and breaks the NEXT build.
  #
  # Was 1500s, lowered to 900s once the mTLS leak that motivated it was fixed at the mechanism.
  # Worth stating plainly: at 1500s the ceiling would NOT have caught the incident that prompted
  # it -- the observed wedge was ~20 min and resolved on its own. A ceiling's value is bounding
  # the UNBOUNDED case, not the one you happened to measure.
  SUITE_CEILING_SECONDS=900
  started=$SECONDS
  HUNG_SAMPLES=5
  hung=0
  flat=0
  last_cpu=""
  while kill -0 "$test_pid" 2>/dev/null; do
    sleep 60
    kill -0 "$test_pid" 2>/dev/null || break

    if [[ $((SECONDS - started)) -ge $SUITE_CEILING_SECONDS ]]; then
      hung=1
      note "$name: EXCEEDED the ${SUITE_CEILING_SECONDS}s ceiling ($((SECONDS - started))s) -- killing. A suite creeping slowly is invisible to the CPU check."
      kill_this_runs_hosts "$test_pid"
      kill -9 "$test_pid" 2>/dev/null || true
      break
    fi
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
    kill_this_runs_hosts "$test_pid"
    kill -9 "$test_pid" 2>/dev/null || true
    break
  done
  wait "$test_pid" 2>/dev/null || true

  if [[ $hung -eq 1 ]]; then
    # Say whose kill it was. vstest will write "Test host process crashed" into the log
    # BECAUSE WE KILLED IT -- that line is our own remedy talking, not a product fault.
    FAILURES+=("$name: HUNG, and WE killed it -- any 'Test host process crashed' in its log is OUR taskkill, not a crash. Rebuild before trusting anything that follows.")
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
  # Point the reader at the trx, which carries the REASON. The console log carries only the
  # NAME — that was trap 7(f), and a failure message you must re-run a whole suite to obtain
  # is a failure message you do not have.
  if [[ "${failed:-0}" != "0" ]]; then
    trx=$(find "$proj/TestResults" -name "$name.trx" 2>/dev/null | head -1)
    FAILURES+=("$name: ${failed} failed — reason in ${trx:-<no trx written>}")
  fi
  [[ "${skipped:-0}" != "0" ]] && FAILURES+=("$name: ${skipped} skipped (this repo expects 0)")
  if [[ "$total" != "$expected" ]]; then
    FAILURES+=("$name: total ${total}, expected ${expected} -- discovery loss or an unjustified change")
  fi
  note "$name: ${total}/${expected} total, ${failed:-?} failed, ${skipped:-?} skipped"
  eval "OBSERVED_${name//[.-]/_}=$total"
done

# ── Gate 3: the verdict, as one line. ───────────────────────────────────────────
# The credential bracket is folded into FAILURES here rather than left to its EXIT trap, so that the
# normal path still prints EXACTLY ONE PASS/FAIL line. A trap firing after a printed "PASS:" would be a
# summary contradicting the list below it — the signature defect §8.1 records five branches of. The trap
# stays armed for the early `exit 1` paths above, which never reach this line; CREDS_REPORTED stops it
# saying the same thing twice.
if ! creds_bracket_eval; then
  CREDS_REPORTED=1
  FAILURES+=("$(creds_bracket_text)")
fi

# Task X-1 -- the closing reading of the output-directory bracket, folded into FAILURES for the same
# reason the credential bracket is: one PASS/FAIL line on the normal path. No EXIT trap; see the block
# above the suite loop for why this line is always reached whenever a baseline was taken.
#
# 🔴 THREE POPULATIONS, NOT TWO, AND A REWRITE IS ITS OWN ONE. Each line carries path + size + mtime, so
# a rewritten file leaves BOTH sets: its old line vanished and its new line appeared. Reported as
# APPEARED/DISAPPEARED it would read as two unrelated events at one path, which is the shape that sends a
# reader looking for a deletion that never happened. Paths present on both sides are lifted out first and
# reported as REWRITTEN.
# `-f` alone (review Minor 4): `-s` implied `-f`, so the disjunction tested one condition twice. Kept as a
# guard at all because the baseline is taken above under an `exit 1`, so reaching here without one would
# mean a future edit introduced a path that skips it -- which should read as "not measured", not as green.
if [[ -f "$OUTDIR_BEFORE" ]]; then
  if ! outdir_snapshot > "$OUTDIR_AFTER"; then
    FAILURES+=("Suite output directories could NOT BE READ at the end of this run. NOTHING was measured by
    this bracket -- that is not a pass and it is not evidence of a writer either. Check for a lock or for
    a directory replaced mid-run; do not disarm the bracket.")
  else
    _x1_gone=$(LC_ALL=C comm -23 "$OUTDIR_BEFORE" "$OUTDIR_AFTER" | cut -f1 | LC_ALL=C sort -u)
    _x1_new=$(LC_ALL=C comm -13 "$OUTDIR_BEFORE" "$OUTDIR_AFTER" | cut -f1 | LC_ALL=C sort -u)
    _x1_rewritten=$(LC_ALL=C comm -12 <(printf '%s\n' "$_x1_gone") <(printf '%s\n' "$_x1_new") | grep -c . || true)
    _x1_rewritten_list=$(LC_ALL=C comm -12 <(printf '%s\n' "$_x1_gone") <(printf '%s\n' "$_x1_new"))
    _x1_appeared=$(LC_ALL=C comm -13 <(printf '%s\n' "$_x1_gone") <(printf '%s\n' "$_x1_new") | grep -v '^$' || true)
    _x1_disappeared=$(LC_ALL=C comm -23 <(printf '%s\n' "$_x1_gone") <(printf '%s\n' "$_x1_new") | grep -v '^$' || true)
    if [[ -n "$_x1_rewritten_list" || -n "$_x1_appeared" || -n "$_x1_disappeared" ]]; then
      {
        echo "Suite output directories CHANGED across the test phase -- a test process wrote beside its own binary."
        [[ -n "$_x1_rewritten_list" ]] && {
          echo "  REWRITTEN ($_x1_rewritten):"; printf '%s\n' "$_x1_rewritten_list" | head -25 | sed 's/^/      /'; }
        [[ -n "$_x1_appeared" ]] && {
          echo "  APPEARED ($(printf '%s\n' "$_x1_appeared" | grep -c .)):"; printf '%s\n' "$_x1_appeared" | head -25 | sed 's/^/      /'; }
        [[ -n "$_x1_disappeared" ]] && {
          echo "  DISAPPEARED ($(printf '%s\n' "$_x1_disappeared" | grep -c .)):"; printf '%s\n' "$_x1_disappeared" | head -25 | sed 's/^/      /'; }
        echo "  WHY THIS MATTERS: nothing cleans those directories -- not this script, not \`dotnet build\` --"
        echo "     so a file written during the test phase is a file the NEXT run READS. That channel is not"
        echo "     theoretical: a 610-byte all-NUL recipes.json failed 190 tests in one run of"
        echo "     St4i.EngineApi.Tests, and that suite's machine-operating-config.json reached 240,778 bytes"
        echo "     with 624 History entries on ONE machine code -- one appended per run, forever."
        echo "  DELETING THE FILE BUYS NOTHING HERE, unlike the credential bracket above: this compares the"
        echo "     directories against their own state at the START of the same test phase, so removing a file"
        echo "     first makes the run CREATE it, which is still a difference. Fix the WRITER."
        echo "  HOW: if the store has a relocation variable, set it in tests/Shared/TestRunTempRoot.cs beside"
        echo "     ST4I_CREDS_DIR and ST4I_MACHINE_CONFIG_DIR -- one line there covers every existing call site"
        echo "     and every future one. If it has NO variable, giving it one changes src/ and every shipped"
        echo "     install's on-disk layout: that is a product decision, and it is exactly why"
        echo "     ProductConfigStore and SimulatedEcosystem are exempt here rather than fixed. Say so and"
        echo "     stop -- the exemption is derived from those stores' own sources so that it cannot be"
        echo "     extended by hand."
        echo "  SCOPE: this measures THE DIRECTORIES over the test phase, not just the test processes. A"
        echo "     second build, an IDE writing into bin/, or the engine being run out of one of these folders"
        echo "     reddens it and is not a test defect -- check before hunting a test."
        echo "  WHAT THE SUITE RESULTS ABOVE DO AND DO NOT TELL YOU: a red here with"
        echo "     OwnOutputDirectoryGuardTests red in some suite NARROWS the writer to that process. A red"
        echo "     here with all five suites GREEN is NOT decisive and must not be read as external: that"
        echo "     guard's window ends when its own [Fact] runs, and X-1 MEASURED it staying green while the"
        echo "     pre-fix tree wrote machine-operating-config.json underneath it."
      } > "$LOGDIR/outdirs-report.txt"
      FAILURES+=("$(cat "$LOGDIR/outdirs-report.txt")")
    fi
  fi
fi

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
