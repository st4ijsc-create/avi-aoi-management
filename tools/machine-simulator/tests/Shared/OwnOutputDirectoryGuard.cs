using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using Xunit;

namespace St4i.TestHygiene;

/// <summary>
/// 🔴 Task X-1 — <b>a test process must not change its OWN OUTPUT DIRECTORY.</b> Linked (not copied) into
/// all five test projects beside <see cref="TestRunTempRoot"/> and <see cref="RealCredentialStoreWatch"/>;
/// each assembly gets its own module initializer, its own baseline and its own copy of the assertion.
///
/// <para><b>THE PROPERTY, derived rather than restated.</b> The brief's phrasing is "a run's result must
/// not depend on what a previous run left on disk". That phrasing carries two assumptions this file does
/// not adopt. It assumes the writer is A PREVIOUS RUN — but the same directory is reachable by
/// <c>npm run dev</c>, by the WPF shell, by a developer's <c>dotnet run</c>, and by the suite that ran ten
/// seconds earlier in the same gate. And it assumes ON DISK is the boundary — but a listening port, the
/// process-wide SQLite connection pool (task L-1), an inherited environment variable and
/// <c>%ProgramData%</c> all carry state across runs too, and none of them is on this directory.
///
/// <para>So the property asserted here is REFLEXIVE and narrower, and it is chosen because it needs no
/// memory of any other run to be measurable:</para>
///
/// <para><b>NO TEST PROCESS MAY LEAVE ITS OWN OUTPUT DIRECTORY DIFFERENT FROM HOW IT FOUND IT.</b></para>
///
/// <para>The direction of implication is worth being exact about, because the comfortable reading is
/// wrong. Green here proves this process left NOTHING BEHIND for a later one. It does NOT prove this
/// process READ nothing that an earlier one left — a residue file that is loaded at startup and never
/// written back is invisible to every assertion in this file. That second half is not closed by an
/// assertion at all; it is closed by the directory being at its build-clean state, which is a fact about
/// this machine on a given day and not a property of the tree. Named here so the gap is read in its own
/// voice rather than in the criterion's.</para></para>
///
/// <para><b>WHY A CONSEQUENCE MEASUREMENT AND NOT A SCAN FOR <c>AppContext.BaseDirectory</c>.</b> The
/// obvious instrument is a source scan for that expression. It is a VOCABULARY, and a recogniser keyed on
/// a spelling has the domain of whoever chose the spelling. Everything below defeats such a scan and none
/// of it defeats this one: a root composed from pieces; <c>Directory.GetCurrentDirectory()</c>, which
/// vstest sets to this same directory; <c>Path.GetDirectoryName(Assembly.Location)</c>; a relative path
/// resolved against the process working directory; an embedded resource written out at startup; and any
/// library loaded into the process that does the same thing for its own reasons. This watches THE
/// DIRECTORY, so a writer is seen whether it names the expression, composes it, inherits it, or is a
/// third party that never heard of it.</para>
///
/// <para>🔴 <b>THE QUANTITY THIS ACTUALLY MEASURES — the domain, and what is OUTSIDE it.</b> The criterion
/// above is "no test run depends on a previous one"; the instrument is much narrower, and the gap is
/// written down rather than left to be inferred:
/// <list type="bullet">
/// <item><b>What it sees.</b> Regular FILES under this assembly's own <see cref="AppContext.BaseDirectory"/>
/// tree whose presence, LENGTH or LAST-WRITE TIME differs between this assembly's module-initializer and
/// the moment the fact below runs. Any call depth, any thread, any assembly, named or unnamed.</item>
/// <item><b>Files, not directories.</b> A directory's own timestamp moves whenever a file inside it does,
/// which would report the same write twice; and an empty directory carries no state into a later run.
/// A new file inside a new directory is still seen, because the file is what is enumerated.</item>
/// <item><b>One process, not the run.</b> Five suites are five processes, so this is five independent
/// per-process measurements and never one repository-wide guarantee. A green from one suite says nothing
/// about any other. Same structure, and same limitation, as
/// <see cref="RealCredentialStoreLeakGuardTests"/>.</item>
/// <item>🔴 <b>A window, not the whole process — MEASURED ON THIS TASK, not inherited.</b> The interval
/// ends when THIS fact runs, and xunit orders neither collections nor the classes inside them, so a writer
/// scheduled after it is invisible. Task X-1's own §8.1(h6) DIRTY ARM proved it rather than feared it:
/// with the <c>ST4I_MACHINE_CONFIG_DIR</c> redirect disabled — the exact pre-fix tree — a 15-test filter
/// of <c>St4i.EngineApi.Tests</c> wrote a fresh <c>machine-operating-config.json</c> into that suite's
/// output directory (one entry, <c>AOI-01</c>, <c>History</c> list of 1 — one run's worth of the 624 that
/// had accumulated) and THIS FACT REPORTED GREEN, because it was scheduled ahead of the writer. So a green
/// here is "nothing was written BEFORE me", never "nothing was written". Task K-1 measured the identical
/// hole on the credential guard with its mutation M1; nothing about this directory makes it smaller.</item>
/// <item><b>Appear-and-vanish.</b> A file created and deleted inside the interval cancels out, exactly as
/// it does for the gate's credential bracket. Two snapshots cannot see it; only a watcher could.
/// 🔴 This is also the ONLY way to defeat this guard by deleting, and it is worth separating from the
/// credential bracket's case: there, deleting a named file afterwards buys a green. Here it does not —
/// removing a file BEFORE the run makes the run CREATE it, which is still a difference. So "delete it
/// until the gate is green" fails against this instrument in every arrangement except a delete placed
/// inside the window, which is a different act from tidying up after a red.</item>
/// <item><b>Content that changes with neither length nor timestamp.</b> Nothing here hashes. A rewrite
/// producing the same byte count within the same 100 ns filesystem tick is invisible. That is the price
/// of not reading every byte of a directory that holds a 1.7 MB bundle and a font set on every run.</item>
/// <item><b>Everything not under this directory.</b> <c>%ProgramData%\ST4I\</c> (the credential slice
/// only is watched, by <see cref="RealCredentialStoreLeakGuardTests"/> and by the gate's bracket),
/// <c>%APPDATA%</c>, <c>%TEMP%</c> (redirected but not asserted empty), the process-wide SQLite
/// connection pool, a bound TCP port, an environment variable inherited from the shell, and the Windows
/// registry and DPAPI master keys. Each is a channel that carries state across runs, and this instrument
/// has an opinion about none of them.</item>
/// <item><b>The build.</b> Everything MSBuild puts here lands before the baseline is taken, by
/// construction — the baseline runs inside the test process, which starts after the build. So a rebuild
/// is never reported, and equally: a stale output directory is never reported either.</item>
/// <item><b>Not xunit.</b> <c>npm run test:e2e</c> and <c>npm run dev</c> are separate processes that
/// never load this assembly. Their isolation is
/// <c>TestHarnessIsolationTests.EveryStoreTheEngineCreates_IsIsolatedByThePlaywrightHarness</c>'s
/// question, by a different mechanism.</item>
/// </list></para>
///
/// <para>🔴 <b>THE EXEMPTION, AND WHY IT IS NOT A LIST OF FILENAMES.</b> The product roots THREE stores
/// beside the binary — <c>MachineConfigStore</c>'s own remarks enumerate them — and exactly one of them,
/// <c>MachineConfigStore</c>, has a relocation variable (task H-1c added it).
/// <see cref="TestRunTempRoot"/> now sets that variable, so that store's file leaves this directory
/// altogether. The other two, <c>ProductConfigStore</c> and <c>SimulatedEcosystem</c>, have NO seam of any
/// kind: there is no value any harness can set that moves them, and giving them one is a change to
/// <c>src/</c>, i.e. to shipped behaviour on every existing install. That is out of task X-1's bounds and
/// is REPORTED rather than done.
///
/// <para>So this guard exempts those two stores' files — and it derives WHICH files from the stores' own
/// source, together with the JUSTIFICATION for exempting them. Both halves are checked on every run:
/// the exempted sources must still declare their filenames, and they must still declare NO
/// <c>EnvVarDir</c>. The day either one gains a seam, this derivation goes RED and demands that the
/// exemption be spent rather than inherited — which is the failure this repository keeps paying for when
/// a hand-maintained list outlives its reason. Restating the four filenames here would have made the
/// exemption survive its own justification silently.</para>
///
/// <para><b>What the exemption costs, stated as a quantity rather than as a shrug.</b> Measured on this
/// machine at the start of task X-1: <c>products.json</c> in <c>St4i.EngineApi.Tests</c>' output directory
/// held <b>625</b> products, of which <b>623</b> were <c>AUDIT-MODEL-</c> plus a GUID, one minted per run
/// by <c>AuditWiringTests.ProductUpsert_AsEngineer_RecordsNullOldAndTheSavedProductAsNew</c> — a test
/// whose own comment says it mints a fresh code precisely because the store persists across runs. Two are
/// the seed. That growth is UNBOUNDED and this guard does not stop it; it only refuses to let it hide
/// among writes nobody has accounted for.</para></para>
///
/// <para>🔴 <b>THE ANCHOR THAT CLOSES THE FIRST TWO HOLES IS BUILT — in <c>scripts/verify-suites.sh</c>,
/// not here.</b> "One process, not the run" and "a window, not the whole process" have the same fix and it
/// is not reachable from inside a test: the gate snapshots all five output directories after the build and
/// compares them after the last suite, so its window is the WHOLE test phase and its scope is every
/// process inside it. It sits after the build on purpose — the build writes these directories, so a
/// bracket spanning it would report the build — and it carries the same derived exemption this file does.
///
/// <para>The two are complementary and neither replaces the other, exactly as for the credential pair:
/// <b>the gate bracket is complete but anonymous</b> — a second build, or an IDE writing into <c>bin/</c>,
/// reddens it too — while <b>this one is partial but attributes</b>, naming the process it saw. Reading
/// them together narrows a red; the pair does NOT decide, because a test writing after its own
/// <c>[Fact]</c> looks exactly like an external writer. That is not a worry carried over from K-1's
/// write-up: it is the measured result of this task's own dirty arm, recorded above.</para></para>
/// </summary>
internal static class OwnOutputDirectoryWatch
{
    /// <summary>Files under an exempted store's control, by file NAME, derived from
    /// <see cref="UnseamedStoreSources"/>. Matching on the name rather than the relative path is
    /// deliberately slightly WIDE — a file of that name anywhere under the output tree is exempt — because
    /// the alternative is restating each store's subdirectory layout, which is the same rot the derivation
    /// exists to avoid.</summary>
    internal static IReadOnlyCollection<string>? ExemptFileNames { get; private set; }

    /// <summary>This assembly's own output directory, or <see langword="null"/> when setup failed.</summary>
    internal static string? Root { get; private set; }

    /// <summary>Every regular file under <see cref="Root"/> at module-initializer time — path relative to
    /// the root, mapped to its length and last-write instant.</summary>
    internal static IReadOnlyDictionary<string, FileFacts>? Baseline { get; private set; }

    /// <summary>Why no baseline exists, or <see langword="null"/>. Non-null makes the assertion RED: a
    /// missing baseline can only ever produce a vacuous pass.</summary>
    internal static string? SetupFailure { get; private set; }

    /// <summary>The size and last-write instant of one file — the two cheap facts that together catch a
    /// rewrite. Neither alone does: a store that appends grows, but one that rewrites a fixed-width field
    /// does not.</summary>
    internal readonly record struct FileFacts(long Length, long LastWriteUtcTicks);

    /// <summary>The product sources whose stores this guard exempts, each of which must still declare at
    /// least one persisted filename and must still declare NO relocation variable. Named as paths rather
    /// than as <c>cref</c>s because two of the five projects this file is linked into reference only their
    /// own contract assembly and cannot see either type.</summary>
    private static readonly string[] UnseamedStoreSources =
    {
        Path.Combine("src", "St4i.EdgeCore", "Config", "ProductConfigStore.cs"),
        Path.Combine("src", "St4i.EngineApi", "Config", "SimulatedEcosystem.cs"),
    };

    /// <summary>The store that DOES have a seam, and whose seam <see cref="TestRunTempRoot"/> relies on.
    /// Asserted present for the same reason the two above are asserted absent: the exemption's shape is
    /// "one of three stores is relocatable", and that sentence has to be re-earned on every run.</summary>
    private static readonly string SeamedStoreSource =
        Path.Combine("src", "St4i.EdgeCore", "Config", "MachineConfigStore.cs");

    /// <summary>Matches a store's persisted filename constant, e.g.
    /// <c>private const string ProductsFileName = "products.json";</c>.</summary>
    private static readonly Regex PersistedFileNameConst =
        new(@"const\s+string\s+\w*FileName\w*\s*=\s*""(?<name>[^""]+\.json)""", RegexOptions.None);

    /// <summary>The relocation-seam marker every seamed store in this product declares — see
    /// <c>MachineConfigStore.EnvVarDir</c>, <c>FleetSettingsStore.EnvVarDir</c>,
    /// <c>AssetRegistryStore.EnvVarDir</c>.</summary>
    private static readonly Regex SeamMarker = new(@"\bEnvVarDir\b", RegexOptions.None);

    [ModuleInitializer]
    internal static void CaptureBaseline()
    {
        // A throw here would fault the module's static constructor and fail the ENTIRE assembly before a
        // single test ran, turning an instrument into an outage. Nothing is allowed to escape; a failure
        // is recorded and asserted on instead.
        //
        // Ordering against TestRunTempRoot's initializer is unspecified and does not matter here for the
        // BASELINE (that one writes into %TEMP%, never into this directory) — but it matters a great deal
        // for the RESULT, because its ST4I_MACHINE_CONFIG_DIR redirect is what stops one of the three
        // beside-the-binary stores from writing here at all. Both initializers run before the first test,
        // which is the only ordering this needs.
        try
        {
            var root = AppContext.BaseDirectory;
            ExemptFileNames = DeriveExemptFileNames();
            Root = root;
            Baseline = Snapshot(root);
        }
        catch (Exception ex)
        {
            SetupFailure = $"{ex.GetType().Name}: {ex.Message}";
        }
    }

    /// <summary>Every regular file under <paramref name="root"/> right now, keyed by path relative to it.
    /// Enumerates metadata and never creates, deletes or opens anything.
    ///
    /// <para>An I/O failure PROPAGATES on purpose — "could not read" must never be spelled the same way as
    /// "nothing changed", which is the silent-vacuity shape the credential guard had to close twice.</para></summary>
    internal static SortedDictionary<string, FileFacts> Snapshot(string root)
    {
        var files = new SortedDictionary<string, FileFacts>(StringComparer.OrdinalIgnoreCase);
        foreach (var path in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
        {
            var info = new FileInfo(path);
            files[Path.GetRelativePath(root, path)] =
                new FileFacts(info.Length, info.LastWriteTimeUtc.Ticks);
        }

        return files;
    }

    /// <summary>Reads the exempted stores' own sources and returns the filenames they persist, having
    /// first re-checked the reason they are exempt at all. Every failure throws: an exemption that cannot
    /// state its justification must stop the run, not shrink quietly to nothing.</summary>
    private static SortedSet<string> DeriveExemptFileNames()
    {
        var repo = MachineSimulatorRoot();
        var names = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var relative in UnseamedStoreSources)
        {
            var source = Path.Combine(repo, relative);
            if (!File.Exists(source))
            {
                throw new FileNotFoundException(
                    $"Could not read \"{source}\" to derive which files an UNSEAMED beside-the-binary store " +
                    "persists. Do NOT restate the filenames here — a restated list outlives the reason it " +
                    "was written, which is the whole defect this derivation exists to prevent. If the store " +
                    "moved, point this at its new home; if it is gone, delete the exemption.", source);
            }

            var text = File.ReadAllText(source);

            if (SeamMarker.IsMatch(text))
            {
                throw new InvalidOperationException(
                    $"\"{relative}\" now declares a relocation seam (EnvVarDir), so it is NO LONGER an " +
                    "unseamed store and must not be exempted from this guard. Set that variable in " +
                    "tests/Shared/TestRunTempRoot.cs beside ST4I_CREDS_DIR and ST4I_MACHINE_CONFIG_DIR, " +
                    "then remove this source from UnseamedStoreSources. This is the good outcome: the " +
                    "exemption existed only because the store could not be moved.");
            }

            var found = PersistedFileNameConst.Matches(text)
                .Select(m => m.Groups["name"].Value)
                .ToList();

            if (found.Count == 0)
            {
                throw new InvalidOperationException(
                    $"Found no persisted-filename constant in \"{relative}\", so this guard cannot tell " +
                    "which of that store's files to exempt. A scan that stops matching must fail loudly " +
                    "rather than exempt nothing and report the store's every write as an unexplained one.");
            }

            foreach (var name in found)
            {
                names.Add(name);
            }
        }

        var seamed = Path.Combine(repo, SeamedStoreSource);
        if (!File.Exists(seamed) || !SeamMarker.IsMatch(File.ReadAllText(seamed)))
        {
            throw new InvalidOperationException(
                $"\"{SeamedStoreSource}\" no longer declares an EnvVarDir seam. TestRunTempRoot's " +
                "ST4I_MACHINE_CONFIG_DIR redirect depends on it, so without it that store is writing into " +
                "this directory again and the exemption below is describing a population that has changed " +
                "shape. Re-derive the whole arrangement rather than widening the exemption.");
        }

        return names;
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
/// 🔴 Task X-1 — the one assertion. See <see cref="OwnOutputDirectoryWatch"/> for the property, for the
/// domain and everything outside it, and for why two stores are exempt and what that exemption costs.
/// </summary>
public sealed class OwnOutputDirectoryGuardTests
{
    /// <summary>At most this many paths are listed per population in a failure, so a suite that somehow
    /// rewrote its whole output directory produces a triageable message rather than a wall.</summary>
    private const int MaxPathsListed = 25;

    private static string Listed(IReadOnlyList<string> paths)
    {
        var text = string.Join(", ", paths.Take(MaxPathsListed));
        return paths.Count > MaxPathsListed ? $"{text}, … (+{paths.Count - MaxPathsListed} more)" : text;
    }

    [Fact]
    public void ThisAssembliesOwnOutputDirectory_IsUnchanged_WhileThisSuitesProcessRuns()
    {
        // Non-vacuity floor #1. A missing baseline cannot produce a meaningful pass, only a silent one.
        Assert.True(
            OwnOutputDirectoryWatch.SetupFailure is null,
            "This assembly's output directory was never baselined, so this assertion had nothing to " +
            "compare and could only have passed vacuously. NOTHING was measured — do not go looking for " +
            "a writer, and do not delete anything to make this green.\n" +
            $"  Reason: {OwnOutputDirectoryWatch.SetupFailure}");

        var root = OwnOutputDirectoryWatch.Root!;
        var baseline = OwnOutputDirectoryWatch.Baseline!;
        var exempt = OwnOutputDirectoryWatch.ExemptFileNames!;

        // Non-vacuity floor #2. An EMPTY baseline is the shape that would make every comparison below
        // trivially true, and it is reachable — a changed output layout, an enumeration that silently
        // returned nothing. Assert against something this directory cannot fail to contain.
        Assert.True(
            baseline.Count > 0,
            $"The baseline of \"{root}\" is EMPTY, so the comparison below is vacuous. The output layout " +
            "or the enumeration is what broke — fix that, and do NOT weaken the assertion to match.");

        var assemblyFile = typeof(OwnOutputDirectoryGuardTests).Assembly.GetName().Name + ".dll";
        Assert.True(
            baseline.Keys.Any(k => string.Equals(k, assemblyFile, StringComparison.OrdinalIgnoreCase)),
            $"The baseline of \"{root}\" does not contain this assembly's own \"{assemblyFile}\", so it is " +
            "not a baseline of the directory this process is running from. The walk, not the suite, is " +
            "what broke.");

        SortedDictionary<string, OwnOutputDirectoryWatch.FileFacts> now;
        try
        {
            now = OwnOutputDirectoryWatch.Snapshot(root);
        }
        catch (Exception ex)
        {
            Assert.Fail(
                $"Could not re-read this assembly's output directory \"{root}\" to compare against its " +
                $"baseline: {ex.GetType().Name}: {ex.Message}\n" +
                "  This is NOT a pass — NOTHING was measured. Check for a lock or a directory replaced " +
                "mid-run; do not disarm the guard.");
            return; // unreachable; keeps `now` definitely-assigned for the compiler
        }

        static bool IsExempt(string relative, IReadOnlyCollection<string> names) =>
            names.Contains(Path.GetFileName(relative), StringComparer.OrdinalIgnoreCase);

        var appeared = now.Keys
            .Where(k => !baseline.ContainsKey(k) && !IsExempt(k, exempt))
            .OrderBy(k => k, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var disappeared = baseline.Keys
            .Where(k => !now.ContainsKey(k) && !IsExempt(k, exempt))
            .OrderBy(k => k, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var modified = now.Keys
            .Where(k => baseline.TryGetValue(k, out var was) && was != now[k] && !IsExempt(k, exempt))
            .OrderBy(k => k, StringComparer.OrdinalIgnoreCase)
            .ToList();

        // ONE assertion over all three populations, for the reason RealCredentialStoreLeakGuardTests
        // records: asserting them in sequence means a run that did two of these things reports only the
        // first, because the first Assert throws — and the case where the most is going wrong is exactly
        // where the least would be shown.
        var report = new List<string>();

        if (appeared.Count > 0)
        {
            report.Add(
                $"{appeared.Count} file(s) APPEARED in this suite's own output directory \"{root}\" while " +
                $"its process ran: {Listed(appeared)}");
        }

        if (modified.Count > 0)
        {
            report.Add(
                $"{modified.Count} file(s) were REWRITTEN in this suite's own output directory \"{root}\" " +
                $"while its process ran: {Listed(modified)}");
        }

        if (disappeared.Count > 0)
        {
            report.Add(
                $"{disappeared.Count} file(s) DISAPPEARED from this suite's own output directory \"{root}\" " +
                $"while its process ran: {Listed(disappeared)}");
        }

        Assert.True(
            report.Count == 0,
            string.Join("\n", report) + "\n\n" +
            "  WHAT THIS MEANS. Everything in that directory outlives this process — `dotnet build` does " +
            "not clean it and neither does the gate — so a file this run wrote is a file the NEXT run " +
            "READS. That channel is not theoretical here: it is how a 610-byte all-NUL recipes.json came " +
            "to fail 190 tests in one run of St4i.EngineApi.Tests, and how that suite's " +
            "machine-operating-config.json reached 240,778 bytes with 624 History entries on ONE machine " +
            "code.\n" +
            "  DELETING THE FILE FIXES NOTHING. Unlike the credential bracket in scripts/verify-suites.sh, " +
            "this compares a directory against ITS OWN state at the start of the same process: remove the " +
            "file first and the run CREATES it, which is still a difference. Fix the WRITER.\n" +
            "  HOW. If the store has a relocation variable, set it in tests/Shared/TestRunTempRoot.cs " +
            "beside ST4I_CREDS_DIR and ST4I_MACHINE_CONFIG_DIR — one line there covers every existing " +
            "call site and every future one, which is why that file exists. If it has NO variable, then " +
            "giving it one is a change to src/ and to every shipped install's on-disk layout: that is a " +
            "product decision, and it is the reason ProductConfigStore and SimulatedEcosystem are exempt " +
            "here rather than fixed. Say so and stop — do not add a name to the exemption, which is " +
            "derived from the stores' own sources precisely so that it cannot be extended by hand.\n" +
            $"  Exempt file names this run derived: {string.Join(", ", exempt)}.");
    }
}
