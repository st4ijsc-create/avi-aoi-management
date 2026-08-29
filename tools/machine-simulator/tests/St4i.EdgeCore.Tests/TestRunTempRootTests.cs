using System;
using System.IO;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Drivers.OpcUa;
using St4i.EdgeCore.Identity;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Site;
using St4i.EdgeCore.Transport;
using St4i.TestHygiene;
using Xunit;

namespace St4i.EdgeCore.Tests;

/// <summary>
/// 🔴 Test-hygiene batch — <b>the guard on the harness that keeps this suite's scratch data out of the
/// developer's real <c>%TEMP%</c> and real <c>%ProgramData%</c>.</b>
///
/// <para><b>The measurement that produced it.</b> <c>%TEMP%</c> held <b>501,713</b> directories matching
/// <c>st4i-*</c> — <b>97%</b> of all 514,795 entries in it — and <c>%ProgramData%\ST4I\sim\creds</c> held
/// <b>2,999</b> DPAPI-sealed <c>.bin</c> blobs, still growing. Both were produced by the test suites and
/// neither had any cleanup at all.</para>
///
/// <para><b>Why the mechanism needs a test rather than a comment.</b>
/// <see cref="TestRunTempRoot"/> works by setting <c>TMP</c>/<c>TEMP</c> before the first test runs and
/// relying on <see cref="Path.GetTempPath"/> reading the Win32 environment block on every call. That is
/// true on .NET 10/Windows today and was verified with a standalone probe, but it is an
/// IMPLEMENTATION DETAIL of the runtime, not a documented contract — a future SDK that cached the temp
/// path once at startup would silently restore the leak at full rate, with every test still green. The
/// same is true of the module initializer itself: if the linked <c>Compile</c> item were dropped from a
/// <c>.csproj</c> during an unrelated edit, nothing else in the suite would notice.</para>
///
/// <para>These tests fail loudly in either case. They assert the ambient state the whole suite runs
/// under, which is the thing that actually prevents the leak — as distinct from
/// <c>CredentialStoreTests</c>' seam tests, which set the env var themselves and would keep passing even
/// with the harness entirely absent.</para>
/// </summary>
/// 🔴 <b>Task CB-1 — this class joined <c>MachineWideStoreEnv</c>, and that is a FIX, not bookkeeping.</b>
/// Every fact here reads AMBIENT process-wide state, four of them by calling a store's <c>ResolveRoot()</c>
/// — which reads an <c>ST4I_*_DIR</c> environment variable that other classes in this assembly legitimately
/// flip, including flips to <see langword="null"/> to assert the default arm. xunit runs collections in
/// parallel by default and this repository sets no <c>xunit.runner.json</c>, so those reads and those flips
/// could interleave. That hazard was LATENT here from the day the class was written; it is not something
/// CB-1 introduced and then fixed. No failure from it has been observed — this is a race that was possible,
/// not one that was seen, and the distinction is the point.
[Collection("St4i.EdgeCore.Tests.MachineWideStoreEnv")]
public class TestRunTempRootTests
{
    [Fact]
    public void TempPath_IsRedirectedIntoThisRunsDisposableRoot()
    {
        Assert.False(string.IsNullOrEmpty(TestRunTempRoot.Root),
            "TestRunTempRoot never initialised — the module initializer did not run. Check that " +
            "tests/Shared/TestRunTempRoot.cs is still linked into this project's .csproj.");

        var tempPath = Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.GetTempPath()));
        var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(TestRunTempRoot.Root!));

        Assert.Equal(root, tempPath);
        Assert.Contains("st4i-testrun-", tempPath, StringComparison.Ordinal);
    }

    /// <summary>Proves the redirect governs the API the 263 leaking call sites actually use, not merely
    /// <see cref="Path.GetTempPath"/>. <see cref="Directory.CreateTempSubdirectory(string)"/> could in
    /// principle resolve its parent by some other means; this pins that it does not.</summary>
    [Fact]
    public void CreateTempSubdirectory_LandsInsideThisRunsRoot_NotTheRealTempDirectory()
    {
        var created = Directory.CreateTempSubdirectory("st4i-hygiene-probe-");
        try
        {
            Assert.StartsWith(
                Path.GetFullPath(TestRunTempRoot.Root!), created.FullName, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            try { created.Delete(recursive: true); } catch { /* the run root's teardown will get it */ }
        }
    }

    /// <summary>
    /// The credential store is the one that is NOT under <c>%TEMP%</c> — it resolves under
    /// <c>%ProgramData%</c> — so redirecting the temp directory does nothing for it and it needs its own
    /// env var. This asserts the harness actually sets that env var, which is what stands between this
    /// suite and the real credential directory.
    /// </summary>
    [Fact]
    public void CredentialStore_ResolvesAwayFromTheRealProgramDataCredentialDirectory()
    {
        var resolved = Path.TrimEndingDirectorySeparator(Path.GetFullPath(CredentialStore.ResolveRoot()));
        var real = Path.TrimEndingDirectorySeparator(Path.GetFullPath(CredentialStore.DefaultRoot()));

        Assert.NotEqual(real, resolved);
        Assert.StartsWith(
            Path.GetFullPath(TestRunTempRoot.Root!), resolved, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// 🔴 Task X-1 — the THIRD redirect, and the store behind it is in neither of the two places the two
    /// facts above are about. <see cref="MachineConfigStore"/> resolves to
    /// <see cref="AppContext.BaseDirectory"/> — this assembly's own output directory, beside the built
    /// binary — so neither the <c>TMP</c>/<c>TEMP</c> redirect nor <c>ST4I_CREDS_DIR</c> ever reached it,
    /// and its file accumulated there across every run of every suite for as long as both existed.
    ///
    /// <para>Asserted the same way as the credential fact above and for the same reason: this pins the
    /// AMBIENT state the whole suite runs under, which is the thing that actually stops the write.
    /// <c>MachineConfigStoreRootResolutionTests</c> sets the variable itself and would keep passing with
    /// the harness entirely absent.</para>
    ///
    /// <para><b>The predicate is "not the default root", not "some temp path".</b> Asserting a literal
    /// would pass just as happily if the redirect pointed at another accumulating directory, which is the
    /// defect and not the fix — so both halves are checked: it must not be
    /// <see cref="MachineConfigStore.DefaultRoot"/>, and it must be inside this run's disposable root,
    /// which is the only thing that makes it disappear at process exit.</para>
    /// </summary>
    [Fact]
    public void MachineConfigStore_ResolvesAwayFromThisAssembliesOwnOutputDirectory()
    {
        var resolved = Path.TrimEndingDirectorySeparator(Path.GetFullPath(MachineConfigStore.ResolveRoot()));
        var besideTheBinary =
            Path.TrimEndingDirectorySeparator(Path.GetFullPath(MachineConfigStore.DefaultRoot()));

        Assert.NotEqual(besideTheBinary, resolved);
        Assert.StartsWith(
            Path.GetFullPath(TestRunTempRoot.Root!), resolved, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// 🔴 Task BW-1, 2026-08-24 — the SEVENTH redirect, and the one whose seam was declared present and
    /// measured absent (docs/owner-decisions.md item 72, option B).
    ///
    /// <para><b>What the record said and what re-counting found.</b> Item 72's table lists
    /// <c>ST4I_OPCUA_PKI_DIR</c> under a column headed "the file that SETS it" with the value 1, against
    /// 20-24 for each of the nine sibling leaves, and rests the judgement "the leaf to do first" on that 1.
    /// Re-counted at BW-1 across <c>tests/</c>: one file MENTIONS the literal and zero files SET it. Both
    /// mentions live inside a doc comment in <c>PerHostDataRootsTests</c>, one of which states the residual
    /// outright — "nothing exercises <c>ST4I_OPCUA_PKI_DIR</c>, the env var". The instrument behind the
    /// table was a literal count over <c>tests/</c>, and <c>PerHostDataRootsTests</c>' own F-8 note records
    /// that this instrument cannot produce a "sets it" row at all.</para>
    ///
    /// <para><b>What this asserts, and why it is two predicates rather than one.</b> A test that checked
    /// "the variable is set" would pass just as happily with the variable pointed at a second accumulating
    /// directory, which is the defect wearing the fix's clothes. So both halves are pinned, exactly as the
    /// credential and machine-config facts above pin theirs: the resolved root must differ from
    /// <see cref="OpcUaPkiPaths.DefaultRoot"/> — the real installation's certificate store, holding an
    /// app-instance certificate AND its private key — and it must sit inside this run's disposable root,
    /// which is the thing that makes it disappear at process exit.</para>
    ///
    /// <para><b>What it does NOT assert.</b> The three OPC-UA driver suites pass an explicit PKI root and
    /// take the explicit arm of <see cref="OpcUaPkiPaths.ResolveRoot"/>, so they were already clear of the
    /// real store and this fact says nothing about them. It pins the AMBIENT default a class that passes
    /// no path inherits — including a class nobody has written yet, which is the shape a structural
    /// redirect buys and a per-class convention does not. It also asserts nothing about path LENGTH: the
    /// run root is deeper than <c>%ProgramData%\ST4I\sim\opcua-pki</c>, and <see cref="OpcUaPkiPaths"/>'
    /// own class doc records a native crypto failure once a certificate's full path approaches legacy
    /// MAX_PATH. That ceiling is named in <c>TestRunTempRoot</c> with the measurement behind it and is
    /// deliberately left unasserted here.
    /// </para>
    /// </summary>
    [Fact]
    public void OpcUaPkiStore_ResolvesAwayFromTheRealProgramDataPkiDirectory()
    {
        var resolved = Path.TrimEndingDirectorySeparator(Path.GetFullPath(OpcUaPkiPaths.ResolveRoot()));
        var real = Path.TrimEndingDirectorySeparator(Path.GetFullPath(OpcUaPkiPaths.DefaultRoot()));

        Assert.NotEqual(real, resolved);
        Assert.StartsWith(
            Path.GetFullPath(TestRunTempRoot.Root!), resolved, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>The real <c>%ProgramData%\ST4I\sim\&lt;leaf&gt;</c> directory for each leaf this assembly can
    /// see, taken from the STORE'S OWN <c>DefaultRoot()</c> rather than from a path literal rebuilt here.
    /// A literal would keep passing if a store's default moved, which is precisely the change that would
    /// matter.</summary>
    private static string RealLeafRoot(string leaf) => leaf switch
    {
        "settings" => FleetSettingsStore.DefaultRoot(),
        "identity" => DeviceIdentityStore.DefaultRoot(),
        "sitelink" => SiteLinkStore.DefaultRoot(),
        "bridge-spool" => BridgeSpoolOptions.DefaultRoot(),
        "wal" => WalOptions.DefaultRoot(),
        _ => throw new ArgumentOutOfRangeException(nameof(leaf), leaf, "Unknown leaf."),
    };

    /// <summary>
    /// 🔴 <b>Task CB-1, 2026-08-29 — docs/owner-decisions.md item 72, OPTION A. The five leaves this
    /// assembly can see move from CONVENTION to STRUCTURE, and this is what makes that claim falsifiable.</b>
    ///
    /// <para><b>What "convention" meant and why counting classes never settled it.</b> Item 72's own body
    /// records ~20 test classes setting each of these variables by hand. Twenty classes remembering proves
    /// nothing about the twenty-first — and the twenty-first is not hypothetical: <c>ST4I_NOTIFICATIONS_DIR</c>
    /// was added after an audit declared the isolation list complete, and every e2e run in between read and
    /// wrote a real install's webhook URLs. A structural redirect covers the class nobody has written yet;
    /// a convention covers exactly the classes someone remembered.</para>
    ///
    /// <para><b>Why this asserts the INSTALLED record and not the live variable.</b> Calling
    /// <c>ResolveRoot()</c> here would read a process-wide value that eighteen classes in the sibling suite
    /// and several in this one deliberately flip — some to <see langword="null"/>. That test would be flaky,
    /// and a flaky leak guard trains its readers to re-run it rather than to believe it. See
    /// <see cref="TestRunTempRoot.InstalledRedirects"/> for the measurement behind that sentence.</para>
    ///
    /// <para><b>Two predicates, because either alone is satisfiable by the wrong thing.</b> The redirect must
    /// point somewhere OTHER than the real leaf (or it buys nothing), and it must point INSIDE this run's
    /// disposable root (or it is a second accumulating directory wearing the fix's clothes — the defect, not
    /// the remedy).</para>
    ///
    /// <para><b>What it does not measure.</b> It says nothing about whether any test actually writes to these
    /// stores, and nothing about the <c>historian</c> leaf, which is not on this list for a measured reason —
    /// see <see cref="HistorianVariable_IsInstalled_ButReachesOnlyTheCompositionRoot"/>.</para>
    /// </summary>
    [Theory]
    [InlineData("ST4I_SETTINGS_DIR", "settings")]
    [InlineData("ST4I_IDENTITY_DIR", "identity")]
    [InlineData("ST4I_SITELINK_DIR", "sitelink")]
    [InlineData("ST4I_BRIDGE_SPOOL_DIR", "bridge-spool")]
    [InlineData("ST4I_WAL_DIR", "wal")]
    public void EveryConventionOnlyLeaf_IsStructurallyRedirectedAwayFromItsRealProgramDataDirectory(
        string variable, string leaf)
    {
        Assert.True(TestRunTempRoot.InstalledRedirects.TryGetValue(variable, out var installed),
            $"{variable} was NOT installed by TestRunTempRoot. Item 72 option A is the claim that this leaf " +
            "is redirected STRUCTURALLY rather than by each class remembering; if the line was removed, " +
            "every class that does not set it by hand now resolves to the REAL install directory.");

        var redirected = Path.TrimEndingDirectorySeparator(Path.GetFullPath(installed!));
        var real = Path.TrimEndingDirectorySeparator(Path.GetFullPath(RealLeafRoot(leaf)));

        Assert.NotEqual(real, redirected);
        Assert.StartsWith(
            Path.GetFullPath(TestRunTempRoot.Root!), redirected, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// 🔴 <b>Task CB-1 — THE REGRESSION THIS BATCH COULD HAVE CAUSED, asserted rather than reasoned about.</b>
    ///
    /// <para>Roughly twenty classes across the suites set these variables themselves. Installing a start-up
    /// default for the same variables is only safe if those classes STILL WIN — so this pins the winning arm
    /// directly, not merely the existence of the default. It goes red if a store stops reading its variable,
    /// which is the change that would silently redirect every one of those classes back onto a shared root.</para>
    ///
    /// <para><c>ST4I_IDENTITY_DIR</c> is the subject because <c>DeviceIdentityStoreTests</c> is the only other
    /// class in this assembly that touches it, and CB-1 put that class in this same serialized collection —
    /// so this flip cannot interleave with another. The leaf is also the one holding the device's PFX private
    /// key, which makes it the right place to spend the assertion.</para>
    ///
    /// <para><b>Both directions are checked</b> — "a truth written only forwards is half a truth". The class's
    /// own value must win while set, AND the structural default must be what is there again once the class
    /// restores, because a class that leaves the variable empty on the way out would hand the NEXT class the
    /// real install directory.</para>
    /// </summary>
    [Fact]
    public void AClassThatSetsTheVariableItself_StillBeatsTheStructuralDefault()
    {
        var structural = TestRunTempRoot.InstalledRedirects["ST4I_IDENTITY_DIR"];
        var previous = Environment.GetEnvironmentVariable(DeviceIdentityStore.EnvVarDir);
        var mine = Path.Combine(Path.GetTempPath(), "st4i-cb1-class-wins-" + Guid.NewGuid().ToString("N"));
        try
        {
            Environment.SetEnvironmentVariable(DeviceIdentityStore.EnvVarDir, mine);

            var resolved = Path.TrimEndingDirectorySeparator(Path.GetFullPath(DeviceIdentityStore.ResolveRoot()));

            Assert.Equal(Path.TrimEndingDirectorySeparator(Path.GetFullPath(mine)), resolved);
            Assert.NotEqual(Path.TrimEndingDirectorySeparator(Path.GetFullPath(structural)), resolved);
            Assert.NotEqual(
                Path.TrimEndingDirectorySeparator(Path.GetFullPath(DeviceIdentityStore.DefaultRoot())), resolved);
        }
        finally
        {
            Environment.SetEnvironmentVariable(DeviceIdentityStore.EnvVarDir, previous);
        }

        Assert.Equal(
            Path.TrimEndingDirectorySeparator(Path.GetFullPath(structural)),
            Path.TrimEndingDirectorySeparator(Path.GetFullPath(DeviceIdentityStore.ResolveRoot())));
    }

    /// <summary>
    /// 🔴 <b>Task CB-1 — the NINTH leaf is not like the other eight, and this fact exists to say so where the
    /// result is read rather than in a report nobody re-opens.</b>
    ///
    /// <para><b>What is asserted:</b> <c>ST4I_HISTORIAN_DIR</c> IS installed structurally, and it points away
    /// from the real historian directory and into this run's disposable root — the same two predicates the
    /// five-leaf theory above applies.</para>
    ///
    /// <para>🔴 <b>WHAT IS NOT ASSERTED, AND IT IS THE HALF THAT MATTERS.</b> For the other eight leaves the
    /// variable is read by the STORE TYPE ITSELF, through a public static entry point — a <c>ResolveRoot</c>
    /// for six of them, and <c>FromEnvironment()</c> for <c>bridge-spool</c> and <c>wal</c>, whose stores
    /// build an options object rather than resolve a path directly. Either way setting the variable reaches
    /// every caller, including one that constructs the store with no argument. <c>historian</c> has no such
    /// seam at all.
    /// <c>SqliteHistorianStore.DefaultRoot()</c> and <c>OeeSettingsStore.DefaultRoot()</c> are both PRIVATE,
    /// both hardcode <c>%ProgramData%\ST4I\sim\historian</c>, and NEITHER reads an environment variable —
    /// measured at CB-1, the <c>GetEnvironmentVariable</c> count in both files is zero. The variable is read
    /// in exactly ONE place, <c>Program.cs:412</c>, as a bare literal with no constant behind it: the
    /// composition root, which threads the resolved value into both stores.</para>
    ///
    /// <para>So this redirect covers a test that boots the engine through
    /// <c>WebApplicationFactory&lt;Program&gt;</c>, and does NOT cover <c>new SqliteHistorianStore()</c> or
    /// <c>new OeeSettingsStore()</c>. Those still resolve to the REAL install directory, and no value set in
    /// the harness can change that. Closing it means giving those two stores a seam, which changes how the
    /// SHIPPING product resolves its historian directory — a <c>src/</c> change this task's brief forbids.
    /// It is therefore reported rather than fixed, and item 72 remains PARTIAL on this leaf. This fact is
    /// deliberately NOT written to fail on that gap: a test that pinned the defect in place would have to be
    /// deleted by whoever finally fixes it.</para>
    ///
    /// <para>📎 🔴 <b>EVERYTHING FROM "🔴 WHAT IS NOT ASSERTED" DOWN IS RETRACTED, 2026-08-25 (CD-1), KEPT
    /// VERBATIM AND UN-STRUCK.</b> It was exactly true when CB-1 measured it, and it is the record of the STOP
    /// that produced the owner's ruling of 2026-08-25 (<i>"open the seam"</i>).
    /// <i>FALSE as of that ruling:</i> "<c>historian</c> has no such seam at all"; "both PRIVATE"; "NEITHER
    /// reads an environment variable"; "read in exactly ONE place, <c>Program.cs:412</c>"; "does NOT cover
    /// <c>new SqliteHistorianStore()</c> or <c>new OeeSettingsStore()</c>"; "no value set in the harness can
    /// change that". Both stores now carry the same public <c>EnvVarDir</c>/<c>DefaultRoot</c>/
    /// <c>ResolveRoot</c> triple as their eight siblings, reading THIS variable, so the redirect installed
    /// above is structural for this leaf in the same sense as for the other eight.
    /// <i>STILL TRUE:</i> <c>Program.cs</c> reads the variable too, and — by <c>explicit &gt; env &gt;
    /// default</c> — its explicit constructor argument still WINS; the two stores deliberately share ONE
    /// variable because they share one directory.
    /// <b>The last sentence is the one that aged best and it is why this method's body did not have to
    /// change:</b> it asserts the redirect and its destination, never the gap, so nothing here had to be
    /// deleted by whoever fixed it — which is the whole argument that sentence was making. The method is
    /// renamed (the old name asserted the gap in its own words) and the SECOND half of the claim now has its
    /// own witnesses in <c>HistorianRootSeamTests</c>.</para>
    /// </summary>
    [Fact]
    public void HistorianVariable_IsInstalled_AndPointsAwayFromTheRealInstall()
    {
        Assert.True(TestRunTempRoot.InstalledRedirects.TryGetValue("ST4I_HISTORIAN_DIR", out var installed),
            "ST4I_HISTORIAN_DIR was not installed. Program.cs reads it at the composition root, so without " +
            "it every WebApplicationFactory-booted test writes historian.db and oee-settings.json into the " +
            "REAL install.");

        var redirected = Path.TrimEndingDirectorySeparator(Path.GetFullPath(installed!));
        var real = Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "ST4I", "sim", "historian")));

        Assert.NotEqual(real, redirected);
        Assert.StartsWith(
            Path.GetFullPath(TestRunTempRoot.Root!), redirected, StringComparison.OrdinalIgnoreCase);
    }
}
