using System;
using System.IO;
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
}
