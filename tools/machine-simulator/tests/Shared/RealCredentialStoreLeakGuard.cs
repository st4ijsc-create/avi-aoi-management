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
/// <para>🔴 <b>THE ANCHOR THAT CLOSES THE TWO HOLES ABOVE IS NOW BUILT — in
/// <c>scripts/verify-suites.sh</c>, not here.</b> Both "one process, not the run" and "a window, not the
/// whole process" have the same fix, and it is not reachable from inside a test: the gate snapshots this
/// same directory before the build and compares after everything, bracketing all five processes end to
/// end. <b>This paragraph said "deliberately NOT built" until the closing re-read caught it in the very
/// commit that built it</b> — §8.1(h2). 🔴 This said "the third time"; its own commit list makes it the
/// FOURTH, and an ordinal written while the list is still growing is exactly what §8.1 records rotting
/// twice already in this file. Not renumbered again — the count does no work here, so it is gone: the
/// rule has fired on this task's own diff <b>repeatedly</b>, which is the only part that means anything.
/// <para>The two instruments are complementary and neither replaces the other: <b>the gate bracket is
/// complete but anonymous</b> (it measures THE MACHINE over the window — the WPF shell or edge service
/// running alongside reddens it too), while <b>this one is partial but attributes</b>, naming the process
/// it saw. Reading them together narrows a red, but see the bracket's own failure text: the pair does
/// NOT decide, because a test writing after its own <c>[Fact]</c> looks exactly like an external writer.</para>
/// <para>🔴 <b>WHAT IS STILL NOT CLOSED — BY EITHER INSTRUMENT. Three things, and this list used to name
/// one</b> (branch review, Important 1: a summary contradicting the list it summarises, in the summary of
/// what is not closed, four bullets above its own source):
/// <list type="number">
/// <item><b>Appear-and-vanish.</b> A file created and deleted inside the bracket cancels out. No pair of
/// snapshots can see it. Measured, not assumed — see the bracket's own comment.</item>
/// <item><b>In-place OVERWRITE of an existing name.</b> Neither instrument watches content or timestamps,
/// only the set of names, so re-sealing a credential that was already there is invisible to BOTH. Named
/// in the bullet list above and, until now, dropped from this summary.</item>
/// <item><b>A writer scheduled after this fact</b> — for this instrument; the bracket covers it, but the
/// bracket cannot say WHICH process, which is what makes the pair non-decisive rather than complete.</item>
/// </list></para></para>
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

    /// <summary>🔴 Whether <see cref="SetupFailure"/> was an ACCESS DENIAL rather than a broken scan —
    /// carried separately because the two need OPPOSITE advice, and because this round's own fix made the
    /// first one likely (branch re-review, N-1). Before the absent-vs-unreadable fix, an ACL denial at
    /// module-initializer time threw NOTHING: <c>Directory.Exists</c> returned false and the baseline came
    /// back empty. Now it throws by design and lands in <see cref="SetupFailure"/> — so the single most
    /// likely producer of a setup failure on a real machine became the one case the floor's message was
    /// telling the reader to fix a working regex over.</summary>
    internal static bool SetupFailureIsAccessDenied { get; private set; }

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
            SetupFailureIsAccessDenied = ex is UnauthorizedAccessException;
            SetupFailure = $"{ex.GetType().Name}: {ex.Message}";
        }
    }

    /// <summary>The entries under <paramref name="root"/> right now, as paths relative to it. A root that
    /// does not exist yields an EMPTY set — a machine that has never onboarded is a legitimate state, and
    /// an entry appearing later (root included) still reads as an addition.
    /// Read-only by construction: this enumerates and never creates, deletes or opens anything.
    ///
    /// <para>🔴 <b>ABSENT AND UNREADABLE ARE DIFFERENT ANSWERS, and <see cref="Directory.Exists"/> gives
    /// the same one to both</b> (branch review, Important 2). It returns <see langword="false"/> on a
    /// permissions error exactly as it does for "no such directory", so the earlier
    /// <c>if (!Directory.Exists(root)) return entries;</c> turned an ACL denial into an EMPTY SNAPSHOT —
    /// a silent green, in the method whose entire job is to refuse to pass silently. That is reachable on
    /// any non-elevated identity, because <c>SecurityDirAcl.Apply</c> restricts this directory to
    /// SYSTEM/Administrators/owner on every single <c>CredentialStore.Save</c>. So the existence test is
    /// gone: this ENUMERATES and lets the exception type answer the question, which is the only way to
    /// get a different answer for the two cases.</para></summary>
    internal static SortedSet<string> Snapshot(string root)
    {
        var entries = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            foreach (var path in Directory.EnumerateFileSystemEntries(root, "*", SearchOption.AllDirectories))
            {
                entries.Add(Path.GetRelativePath(root, path));
            }
        }
        catch (DirectoryNotFoundException)
        {
            // Genuinely absent. The one legitimate empty reading.
        }

        // UnauthorizedAccessException, IOException and anything else propagate ON PURPOSE: the callers
        // turn them into a RED with a message naming access as the cause. "Could not read" must never be
        // spelled the same way as "nothing was there".
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

    /// <summary>Renders a population as NAMES ONLY, capped. Never touches a file's bytes.</summary>
    private static string Listed(IReadOnlyList<string> names)
    {
        var text = string.Join(", ", names.Take(MaxNamesListed));
        return names.Count > MaxNamesListed ? $"{text}, … (+{names.Count - MaxNamesListed} more)" : text;
    }

    [Fact]
    public void TheRealCredentialDirectory_GainsNoEntry_WhileThisSuitesProcessRuns()
    {
        // Non-vacuity floor. A missing baseline cannot produce a meaningful pass, only a silent one, so it
        // is RED — but red pointing at THE RIGHT THING, which is not always the scan.
        //
        // 🔴 This message said "fix the derivation" unconditionally until the branch re-review (N-1), and
        // the round that introduced the absent-vs-unreadable fix is what made that wrong: an ACL denial
        // now REACHES here, where before it threw nothing at all. So the fix for one silent-vacuity hole
        // routed its newly-detected case straight into a message naming a culprit that does not exist —
        // the same defect New-7 was, at the site New-7 originally named, while the adjacent site got
        // corrected. Fixed one side, left the symmetric side: the shape this branch has now paid for
        // three times.
        Assert.True(
            RealCredentialStoreWatch.SetupFailure is null,
            "The REAL creds root was never resolved, so this assertion had nothing to compare and could " +
            "only have passed vacuously. NOTHING was measured — do not go looking for a writer.\n" +
            (RealCredentialStoreWatch.SetupFailureIsAccessDenied
                ? "  ACCESS DENIED, and the derivation is FINE — do NOT rewrite it. SecurityDirAcl.Apply " +
                  "restricts that directory to SYSTEM/Administrators/owner on every CredentialStore.Save, " +
                  "so a run under another identity cannot enumerate it. Read access to that machine-wide " +
                  "directory is a real requirement of these test projects, stated in their .csproj.\n"
                : "  Fix the derivation in RealCredentialStoreWatch, and do NOT hardcode the directory — a " +
                  "restated literal is how this guard would watch a dead path and stay green forever.\n") +
            "  Either way: do NOT delete this assertion, and do NOT delete anything under " +
            $"%ProgramData%\\ST4I\\. Reason: {RealCredentialStoreWatch.SetupFailure}");

        var root = RealCredentialStoreWatch.Root!;
        var baseline = RealCredentialStoreWatch.Baseline!;

        // Branch review, Minor 6: the identical call inside the module initializer is wrapped, this one was
        // not — so an ACL change or a mid-enumeration I/O error surfaced as a raw exception instead of the
        // message below. A guard whose failure mode is a stack trace is a guard nobody triages.
        SortedSet<string> now;
        try
        {
            now = RealCredentialStoreWatch.Snapshot(root);
        }
        catch (Exception ex)
        {
            // 🔴 An ACCESS DENIAL is not a broken scan, and telling the reader to "fix the derivation"
            // would send them to rewrite a regex that is working (branch review, Important 3). Name the
            // cause the exception type actually indicates.
            var isAccess = ex is UnauthorizedAccessException;
            Assert.Fail(
                $"Could not read the REAL credential directory \"{root}\" to compare against this " +
                $"assembly's baseline: {ex.GetType().Name}: {ex.Message}\n" +
                "  This is NOT a pass — NOTHING was measured, and nothing was added or deleted as far as " +
                "anyone here knows. Do not go hunting a writer.\n" +
                (isAccess
                    ? "  ACCESS DENIED, and that is the expected shape: SecurityDirAcl.Apply restricts this " +
                      "directory to SYSTEM/Administrators/owner on every CredentialStore.Save, so a test " +
                      "run under a different identity cannot list it. This guard needs READ access to that " +
                      "machine-wide directory; that is a real dependency of these test projects, not a bug " +
                      "in the scan. Do NOT 'fix the derivation' — it is working.\n"
                    : "  Check for a lock, or for the directory being replaced mid-run.\n") +
                "  And do NOT delete this assertion or anything under %ProgramData%\\ST4I\\.");
            return; // unreachable; keeps `now` definitely-assigned for the compiler
        }

        var added = now.Except(baseline, StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        // Branch review, Minor 7 — the REMOVED arm, which is not symmetry for its own sake. The binding
        // constraint on this directory is that nothing may be deleted from it, and until now no assertion
        // anywhere enforced that: a run that quietly pruned the evidence base five artifacts cite was
        // indistinguishable from a clean one. Reported as its own population, separately fatal.
        var removed = baseline.Except(now, StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        // 🔴 ONE ASSERTION OVER BOTH POPULATIONS (branch review, Minor). Asserting `removed` first meant a
        // run that both added AND deleted reported only the deletion — the added half was never evaluated,
        // because the first Assert throws. A guard that hides half of what it measured, in the exact case
        // where the most is going wrong, is the shape this file exists to complain about.
        var report = new List<string>();

        if (removed.Count > 0)
        {
            report.Add(
                $"{removed.Count} entr{(removed.Count == 1 ? "y" : "ies")} DISAPPEARED from the REAL " +
                $"credential directory \"{root}\" while this suite's process ran: {Listed(removed)}.\n" +
                "  Nothing in this repository is allowed to delete from that directory — its contents are a " +
                "deliberately kept evidence base. A test that prunes it, or a \"clean up before measuring\" " +
                "step added to make some other assertion green, is the failure this arm exists to catch.");
        }

        if (added.Count > 0)
        {
            report.Add(
            $"{added.Count} entr{(added.Count == 1 ? "y" : "ies")} appeared in the REAL credential " +
            $"directory \"{root}\" while this suite's process ran: {Listed(added)}.\n" +
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

        Assert.True(report.Count == 0, string.Join("\n\n", report));
    }
}
