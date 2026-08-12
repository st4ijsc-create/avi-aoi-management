using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using Xunit;

namespace St4i.TestHygiene;

/// <summary>
/// 🔴 Task K-1 — <b>the REAL credential directory must not GAIN a file while a test process runs.</b>
/// Linked (not copied) into all five test projects beside <see cref="TestRunTempRoot"/>; each assembly
/// gets its own module initializer, its own baseline and its own copy of the assertion below.
///
/// <para><b>Why a consequence measurement and not a census of who sets the variable.</b> A census keyed
/// on "which test classes assign <c>ST4I_*_DIR</c>" returns GREEN over BOTH of this repository's measured
/// leaks, and it misses them on TWO DIFFERENT AXES — which is why widening that census would not have
/// worked either:
/// <list type="bullet">
/// <item><b>DEPTH.</b> <c>OnboardingFleetJoinTests</c> reached <c>ST4I_CREDS_DIR</c> two frames deep
/// (<c>ClaimAsync</c> → <c>OnboardingService</c> → <c>CredentialStore.Save</c>) and named neither the
/// variable nor the store. Every membership sweep on the branch that found it missed it.</item>
/// <item><b>NAMING.</b> <c>StoreAndForwardRestartSurvivalTests</c> calls <c>CredentialStore.Save</c>
/// DIRECTLY (line 217) — no depth at all — and still sets no <c>ST4I_*_DIR</c>, so the same census calls
/// it clean. It reads through <c>FleetHost.UpdateSettings</c> → <c>CredentialStore.Load</c> as well,
/// which is what forced it into the env-var collection; the WRITE was never at depth.</item>
/// </list>
/// That is blueprint §8.1(f) with a completeness claim on top — a recogniser whose domain is inherited
/// from where its author was standing. This measures the CONSEQUENCE
/// instead, so <b>DEPTH stops being a way to hide</b>: a writer is seen whether it is one frame away or
/// five, and whether it names the variable, clears it, or passes <c>CredentialStore.Save</c>'s directory
/// explicitly and never touches the variable at all. 🔴 Depth is the only axis that sentence covers —
/// TIME is a separate one and this instrument does NOT cover it (see "a window, not the whole process"
/// below, which is measured rather than feared).</para>
///
/// <para>🔴 <b>"GAINS NO FILE", not "IS EMPTY", and the distinction is load-bearing.</b> That directory
/// HAS files and they are KEPT ON PURPOSE — five artifacts cite them as an evidence base. An assertion
/// demanding it be empty would be red on this machine forever, and the cheapest way to make it green
/// would be to DELETE THE EVIDENCE. So the quantity here is a DIFFERENCE ACROSS AN INTERVAL, never an
/// absolute state, and nothing in this file deletes, moves, prunes or "tidies" anything under
/// <c>%ProgramData%\ST4I\</c> — not before the measurement, not after a failure, not ever. A green run
/// leaves that directory byte-for-byte as it found it, and so does a red one.</para>
///
/// <para>🔴 <b>THE QUANTITY THIS ACTUALLY MEASURES, named here rather than only in a report</b> — the
/// criterion is "no writer, at any depth"; the instrument is narrower, and §8.1(a3) is the rule that says
/// to write the gap down instead of letting the narrower thing be read in the criterion's voice:
/// <list type="bullet">
/// <item><b>What it sees.</b> Filesystem entries present under the real creds root when the assertion
/// runs that were ABSENT when THIS ASSEMBLY's module initializer ran — i.e. one process, one interval.
/// Any call depth, any assembly, any thread, named or unnamed.</item>
/// <item><b>One process, not the run.</b> The five suites run SEQUENTIALLY, each in its OWN process
/// (<c>scripts/verify-suites.sh</c>), so a baseline taken in one of them cannot see what another writes.
/// That is why this file is linked into all five: five independent per-process measurements, not one
/// repository-wide guarantee. Nothing here measures a delta ACROSS suites — that needs an anchor outside
/// every process, and there isn't one in here. Do not read a green from one suite as a statement about
/// any other.</item>
/// <item>🔴 <b>A window, not the whole process — MEASURED, not feared.</b> The interval ends when THIS
/// fact runs, and xunit orders neither collections nor the classes inside them, so a writer that happens
/// to be scheduled after this fact is invisible to it. K-1's own mutation round proves it rather than
/// worrying about it: mutation M1 — a <c>[Fact]</c> in its own class that clears <c>ST4I_CREDS_DIR</c>
/// and calls <c>CredentialStore.Save</c> — <b>SURVIVED</b> on <c>St4i.EngineApi.Tests</c> at commit
/// c012ec51 (1336/1336 green) <b>while genuinely writing a DPAPI blob into the real root</b> (censused
/// immediately after: 32 files, up from 31). The same write moved inside the interval, M2, KILLED it.
/// So a GREEN from this fact is "nothing was written BEFORE me", never "nothing was written". Not
/// fixable from inside a test — see BOOKED below.</item>
/// <item><b>Additions, not overwrites.</b> A write that REPLACES a name already present at baseline
/// changes no entry name and is invisible here. The leak shapes this repository has actually paid for
/// mint a fresh machine code per run (<c>SIM-E2E-*</c>, <c>SF-RESTART-&lt;guid&gt;</c>, ...) and so land as
/// new names; an overwrite of a kept credential is a different, un-guarded failure.</item>
/// <item><b>xunit only.</b> <c>npm run test:e2e</c> and <c>npm run dev</c> are separate processes that
/// never load this assembly. Their isolation is asserted by
/// <c>TestHarnessIsolationTests.EveryStoreTheEngineCreates_IsIsolatedByThePlaywrightHarness</c>, by a
/// different mechanism, and this file says nothing about them.</item>
/// </list></para>
///
/// <para><b>The root is DERIVED, not restated.</b> Two of the five suites
/// (<c>St4i.Connector.Abstractions.Tests</c>, <c>St4i.Connector.Conformance.Tests</c>) reference only
/// their own contract assembly on purpose, so <c>CredentialStore.DefaultRoot()</c> is not callable from
/// this shared file. Restating <c>"ST4I", "sim", "creds"</c> here would make the whole assertion go
/// silently vacuous the day the product moved the store — it would watch a directory nothing writes to
/// and be green forever, which is the exact failure shape this repository keeps paying for. So the
/// segments are read out of <c>src/St4i.EdgeCore/Infrastructure/CredentialStore.cs</c>, the same
/// source-of-truth scan idiom <c>TestHarnessIsolationTests</c> and
/// <c>NotificationDocumentationTests</c> already use, and a scan that stops matching FAILS rather than
/// falls back.</para>
///
/// <para>🔴 <b>BOOKED, NOT BUILT — the anchor that would close the two holes above.</b> Both "one process,
/// not the run" and "a window, not the whole process" have the same fix and it is not reachable from
/// inside a test: snapshot the real creds root in <c>scripts/verify-suites.sh</c> before the suite loop
/// and compare after it, which brackets all five processes end to end. It is deliberately NOT built here.
/// It needs its own decision, because a gate that goes red over a MACHINE-WIDE directory can be made
/// green by deleting the evidence base, and that is the failure this whole guard is shaped to avoid — the
/// remedy has to be designed before the trigger is installed. Named so the next person starts from the
/// set rather than rediscovering it.</para>
/// </summary>
internal static class RealCredentialStoreWatch
{
    /// <summary>The real creds root as the PRODUCT resolves it with no override in effect, or
    /// <see langword="null"/> when it could not be derived (in which case <see cref="SetupFailure"/> says
    /// why and the assertion below fails rather than passing over an empty baseline).</summary>
    internal static string? Root { get; private set; }

    /// <summary>Every entry under <see cref="Root"/> at module-initializer time, relative to it.</summary>
    internal static IReadOnlyCollection<string>? Baseline { get; private set; }

    /// <summary>Why no baseline exists, or <see langword="null"/>. Non-null makes the assertion RED: a
    /// missing baseline can only ever produce a vacuous pass.</summary>
    internal static string? SetupFailure { get; private set; }

    [ModuleInitializer]
    internal static void CaptureBaseline()
    {
        // A throw here would fault the module's static constructor and fail the ENTIRE assembly before a
        // single test ran. Nothing is allowed to escape; a failure is recorded and asserted on instead.
        //
        // Ordering against TestRunTempRoot's initializer is unspecified and does not matter: this one only
        // READS the real creds root, and that one never writes to it.
        try
        {
            var root = ResolveRealCredsRootFromProductSource();
            Root = root;
            Baseline = Snapshot(root);
        }
        catch (Exception ex)
        {
            SetupFailure = $"{ex.GetType().Name}: {ex.Message}";
        }
    }

    /// <summary>The entries under <paramref name="root"/> right now, as paths relative to it. A root that
    /// does not exist yields an EMPTY set rather than an error — a machine that has never onboarded is a
    /// legitimate state, and an entry appearing later (root included) still reads as an addition.
    /// Read-only by construction: this enumerates and never creates, deletes or opens anything.</summary>
    internal static SortedSet<string> Snapshot(string root)
    {
        var entries = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        if (!Directory.Exists(root)) return entries;

        foreach (var path in Directory.EnumerateFileSystemEntries(root, "*", SearchOption.AllDirectories))
        {
            entries.Add(Path.GetRelativePath(root, path));
        }

        return entries;
    }

    /// <summary>Reads the store's own default-root expression out of the product source and resolves it
    /// against this machine. Requires EXACTLY ONE match: two would mean the scan can no longer tell which
    /// expression is the store's, and guessing is how an assertion goes quietly vacuous.</summary>
    private static string ResolveRealCredsRootFromProductSource()
    {
        var source = Path.Combine(
            MachineSimulatorRoot(), "src", "St4i.EdgeCore", "Infrastructure", "CredentialStore.cs");

        if (!File.Exists(source))
        {
            throw new FileNotFoundException(
                $"Could not read the credential store's own source at \"{source}\" to derive the REAL creds " +
                "root. Fix this walk — do NOT restate the directory literal here, which would make this " +
                "guard watch a directory the product may no longer use.", source);
        }

        var matches = Regex.Matches(
            File.ReadAllText(source),
            @"SpecialFolder\.CommonApplicationData\s*\)\s*((?:,\s*""[^""]+"")+)\s*\)");

        if (matches.Count != 1)
        {
            throw new InvalidOperationException(
                $"Expected exactly ONE CommonApplicationData root expression in \"{source}\", found " +
                $"{matches.Count}. That expression is how this guard learns which directory to watch, so a " +
                "scan that stops matching (or starts matching twice) must fail loudly rather than watch " +
                "the wrong directory and stay green forever.");
        }

        var segments = Regex.Matches(matches[0].Groups[1].Value, @"""([^""]+)""")
            .Select(m => m.Groups[1].Value)
            .ToArray();

        var parts = new List<string>(segments.Length + 1)
        {
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        };
        parts.AddRange(segments);
        return Path.Combine(parts.ToArray());
    }

    /// <summary>Walks up from the test binary's own output directory, the idiom
    /// <c>PackagingFleetJsonTests.MachineSimulatorRoot</c> established, so nothing here depends on the
    /// working directory.</summary>
    private static string MachineSimulatorRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "README.md")) &&
                File.Exists(Path.Combine(dir.FullName, "fleet.json")) &&
                Directory.Exists(Path.Combine(dir.FullName, "docs")))
            {
                return dir.FullName;
            }

            dir = dir.Parent;
        }

        throw new InvalidOperationException(
            "Could not locate tools/machine-simulator (README.md + fleet.json + docs/) by walking up from " +
            $"\"{AppContext.BaseDirectory}\".");
    }
}

/// <summary>
/// 🔴 Task K-1 — the one assertion. See <see cref="RealCredentialStoreWatch"/> for the case, for the
/// quantity this actually measures versus the one the criterion names, and for what is booked and not
/// built.
/// </summary>
public sealed class RealCredentialStoreLeakGuardTests
{
    /// <summary>At most this many names are listed in a failure. NAMES ONLY — a machine code is an
    /// identifier an operator already sees; the file's CONTENT is a sealed credential and never appears
    /// in a message, a log line or an audit row, by structure rather than by redaction.</summary>
    private const int MaxNamesListed = 25;

    [Fact]
    public void TheRealCredentialDirectory_GainsNoEntry_WhileThisSuitesProcessRuns()
    {
        // Non-vacuity floor. A missing baseline cannot produce a meaningful pass, only a silent one, so it
        // is RED — and red pointing at the scan, which is what broke.
        Assert.True(
            RealCredentialStoreWatch.SetupFailure is null,
            "The REAL creds root was never resolved, so this assertion had nothing to compare and could " +
            "only have passed vacuously. Fix the derivation in RealCredentialStoreWatch — do NOT delete " +
            $"this assertion, and do NOT hardcode the directory. Reason: {RealCredentialStoreWatch.SetupFailure}");

        var root = RealCredentialStoreWatch.Root!;
        var baseline = RealCredentialStoreWatch.Baseline!;

        var added = RealCredentialStoreWatch.Snapshot(root)
            .Except(baseline, StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var listed = string.Join(", ", added.Take(MaxNamesListed));
        if (added.Count > MaxNamesListed) listed += $", … (+{added.Count - MaxNamesListed} more)";

        Assert.True(added.Count == 0,
            $"{added.Count} entr{(added.Count == 1 ? "y" : "ies")} appeared in the REAL credential " +
            $"directory \"{root}\" while this suite's process ran: {listed}.\n" +
            "  Something in this process wrote a machine credential to a real install's store. It does not " +
            "have to NAME ST4I_CREDS_DIR to have done it, and it does not have to be at depth either: " +
            "CredentialStore is static and resolves per call, so a direct Save that simply never sets the " +
            "variable (StoreAndForwardRestartSurvivalTests) leaks exactly as a call two frames down " +
            "OnboardingService does (OnboardingFleetJoinTests). Both shapes are on record.\n" +
            "  🔴 DO NOT DELETE THOSE FILES, and do not delete anything else under %ProgramData%\\ST4I\\. " +
            "The pre-existing contents of that directory are a deliberately kept evidence base that five " +
            "artifacts cite, this assertion measures a DIFFERENCE and never an absolute state, and " +
            "\"tidying\" is how the evidence would be lost while the leak stayed open.\n" +
            "  Fix the WRITER instead: give the class an ST4I_CREDS_DIR of its own (and the collection " +
            "that stops it racing another class on that process-wide variable), or leave it to the " +
            "assembly-wide redirect in tests/Shared/TestRunTempRoot.cs — and check that nothing put the " +
            "variable back.");
    }
}
