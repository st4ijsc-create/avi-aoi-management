using System;
using System.IO;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Drivers.OpcUa;
using St4i.EdgeCore.Infrastructure;
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
}
