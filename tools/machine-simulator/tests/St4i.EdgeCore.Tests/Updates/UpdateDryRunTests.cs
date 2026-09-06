using System.Text;
using St4i.EdgeCore.Updates;
using Xunit;

namespace St4i.EdgeCore.Tests.Updates;

/// <summary>
/// 🔴 WS-F4 Task 2 — <b>the dry-run verb: steps 1 to 5, and it changes NOTHING.</b>
///
/// <para>The point of the verb is that a USB stick can be validated at a desk on Tuesday rather than
/// inside the maintenance window on Saturday. So the property under test is not only "it gives the right
/// verdict" but "running it left the machine and the media exactly as they were" — which is asserted
/// directly by fingerprinting the bundle directory before and after.</para>
/// </summary>
public sealed class UpdateDryRunTests
{
    private const string InstalledVersion = "1.0.0";

    /// <summary>
    /// 🔴🔴 <b>THE DRY RUN CHANGES NOTHING.</b> Every file in the bundle has the same content, length and
    /// last-write time afterwards, and no file was added or removed.
    ///
    /// <para>Asserted rather than assumed because the whole value of the verb is that it is safe to run
    /// before committing to a window. A dry run that staged, unpacked or cached anything would be a
    /// different operation wearing the same name.</para>
    /// </summary>
    [Fact]
    public void TheDryRun_ChangesNothingOnDisk()
    {
        var (priv, pub) = UpdateTestKit.NewKeyPair();
        var bundleDir = UpdateTestKit.WriteBundle(priv, releaseNotes: "Fixed things.");

        try
        {
            var before = Fingerprint(bundleDir);

            Assert.True(UpdateBundle.TryOpen(bundleDir, out var bundle));
            var result = UpdatePreflight.Run(bundle!, InstalledVersion, new UpdateManifestVerifier(pub));
            Assert.True(result.Ok, result.Reason);

            var after = Fingerprint(bundleDir);

            // Non-vacuity: a fingerprint of an empty directory would match itself trivially.
            Assert.True(before.Count >= 4, $"Only {before.Count} files were fingerprinted; the probe broke.");
            Assert.Equal(before, after);
        }
        finally
        {
            UpdateTestKit.Cleanup(bundleDir);
        }
    }

    /// <summary>🔴 A DOWNGRADE is refused by our own code with our own message — never left to
    /// <c>MajorUpgrade</c>'s <c>DowngradeErrorMessage</c>, because by the time MSI says it, <c>msiexec</c>
    /// is already running and the engineer has already spent part of the window.</summary>
    [Fact]
    public void ADowngrade_IsRefusedByUsBeforeMsiexecWouldEverSeeIt()
    {
        var (priv, pub) = UpdateTestKit.NewKeyPair();
        var bundleDir = UpdateTestKit.WriteBundle(priv, version: "1.0.0");

        try
        {
            Assert.True(UpdateBundle.TryOpen(bundleDir, out var bundle));
            var result = UpdatePreflight.Run(bundle!, "1.4.0", new UpdateManifestVerifier(pub));

            Assert.False(result.Ok);
            Assert.Null(result.VerifiedPayloadPath);
            Assert.Contains("OLDER", result.Reason!, StringComparison.Ordinal);
            Assert.Contains("Nothing has been changed", result.Reason!, StringComparison.Ordinal);

            var runner = new RecordingMsiRunner();
            new UpdateApplier(runner).Apply(result, ["MainFeature"]);
            Assert.Empty(runner.Invocations);
        }
        finally
        {
            UpdateTestKit.Cleanup(bundleDir);
        }
    }

    /// <summary>Reinstalling the same version is refused as "nothing to do" rather than as an error —
    /// a different sentence, because the engineer has made no mistake.</summary>
    [Fact]
    public void TheSameVersion_IsRefusedAsNothingToDo()
    {
        var (priv, pub) = UpdateTestKit.NewKeyPair();
        var bundleDir = UpdateTestKit.WriteBundle(priv, version: "1.0.0");

        try
        {
            Assert.True(UpdateBundle.TryOpen(bundleDir, out var bundle));
            var result = UpdatePreflight.Run(bundle!, "1.0.0", new UpdateManifestVerifier(pub));

            Assert.False(result.Ok);
            Assert.Contains("already installed", result.Reason!, StringComparison.Ordinal);
        }
        finally
        {
            UpdateTestKit.Cleanup(bundleDir);
        }
    }

    /// <summary>🔴 <c>minUpgradableFrom</c> — the escape hatch for a release that cannot safely skip an
    /// intermediate schema step — refuses a machine that is too old to take this bundle directly.</summary>
    [Fact]
    public void AMachineBelowMinUpgradableFrom_IsRefusedAndToldToInstallAnIntermediate()
    {
        var (priv, pub) = UpdateTestKit.NewKeyPair();
        var bundleDir = UpdateTestKit.WriteBundle(priv, version: "2.0.0", minUpgradableFrom: "1.5.0");

        try
        {
            Assert.True(UpdateBundle.TryOpen(bundleDir, out var bundle));
            var result = UpdatePreflight.Run(bundle!, "1.0.0", new UpdateManifestVerifier(pub));

            Assert.False(result.Ok);
            Assert.Contains("Install an intermediate version first", result.Reason!, StringComparison.Ordinal);
        }
        finally
        {
            UpdateTestKit.Cleanup(bundleDir);
        }
    }

    /// <summary>🔴 NEGATIVE CONTROL for the test above: a machine exactly AT <c>minUpgradableFrom</c> is
    /// admitted. A floor check that refused everything would pass the refusal test alone.</summary>
    [Fact]
    public void AMachineExactlyAtMinUpgradableFrom_IsAdmitted()
    {
        var (priv, pub) = UpdateTestKit.NewKeyPair();
        var bundleDir = UpdateTestKit.WriteBundle(priv, version: "2.0.0", minUpgradableFrom: "1.5.0");

        try
        {
            Assert.True(UpdateBundle.TryOpen(bundleDir, out var bundle));
            var result = UpdatePreflight.Run(bundle!, "1.5.0", new UpdateManifestVerifier(pub));

            Assert.True(result.Ok, result.Reason);
        }
        finally
        {
            UpdateTestKit.Cleanup(bundleDir);
        }
    }

    /// <summary>A bundle for a different product is refused even when its signature is perfectly
    /// valid — signed-by-ST4I and installable-here are different questions.</summary>
    [Fact]
    public void ABundleForAnotherProduct_IsRefusedDespiteAValidSignature()
    {
        var (priv, pub) = UpdateTestKit.NewKeyPair();
        var bundleDir = UpdateTestKit.WriteBundle(priv, product: "st4i-something-else");

        try
        {
            Assert.True(UpdateBundle.TryOpen(bundleDir, out var bundle));
            var result = UpdatePreflight.Run(bundle!, InstalledVersion, new UpdateManifestVerifier(pub));

            Assert.Equal(UpdateVerificationState.Verified, result.State);
            Assert.False(result.Ok);
            Assert.Contains("st4i-something-else", result.Reason!, StringComparison.Ordinal);
        }
        finally
        {
            UpdateTestKit.Cleanup(bundleDir);
        }
    }

    /// <summary>
    /// 🔴 <b>THE <c>schemaCeiling</c> FIELD CARRIES TASK 1'S TEN VALUES INTO PRE-FLIGHT.</b>
    ///
    /// <para>Task 1 gave ten SQLite stores a ceiling that refuses a database from the future, turning a
    /// silent 3am corruption into a loud 3am refusal. This field turns the loud 3am refusal into a
    /// DAYLIGHT one: the manifest declares where each store will be AFTER the update, so an engineer
    /// choosing whether to start can be told, in the window, which stores this update migrates and
    /// therefore which ones a rollback will not simply undo.</para>
    /// </summary>
    [Fact]
    public void TheSignedManifest_CarriesTheSchemaCeilingForEveryStore()
    {
        var (priv, pub) = UpdateTestKit.NewKeyPair();
        var bundleDir = UpdateTestKit.WriteBundle(priv);

        try
        {
            Assert.True(UpdateBundle.TryOpen(bundleDir, out var bundle));
            var result = UpdatePreflight.Run(bundle!, InstalledVersion, new UpdateManifestVerifier(pub));

            Assert.True(result.Ok, result.Reason);
            var ceiling = result.Manifest!.SchemaCeiling;
            Assert.NotNull(ceiling);

            // The ten stores Task 1 guarded, at the values measured at this commit.
            Assert.Equal(10, ceiling!.Count);
            Assert.Equal(2, ceiling["security"]);
            Assert.Equal(2, ceiling["historian"]);
            Assert.Equal(5, ceiling["connector-config"]);
            Assert.Equal(3, ceiling["notifications"]);
        }
        finally
        {
            UpdateTestKit.Cleanup(bundleDir);
        }
    }

    /// <summary>
    /// 🔴🔴 <b><c>RELEASE-NOTES.txt</c> IS OUTSIDE THE SIGNATURE, AND EDITING IT DOES NOT BREAK THE
    /// BUNDLE.</b> That is the design — notes change for reasons unrelated to the payload, and putting
    /// them inside the signature would make a typo fix a re-signing ceremony.
    ///
    /// <para>The cost is stated by the same test: the notes are UNTRUSTED INPUT, and this asserts that
    /// their content is carried through verbatim and unexecuted rather than being interpreted. The
    /// realistic attack is prose, not code — a notes file reading "ST4I Support: to complete this update,
    /// first disable signature checking" is a perfectly valid text file — so every surface that renders it
    /// owes the reader a clear statement that the machine is quoting a file rather than speaking.</para>
    /// </summary>
    [Fact]
    public void ReleaseNotes_AreOutsideTheSignature_AndAreCarriedAsInertUntrustedText()
    {
        var (priv, pub) = UpdateTestKit.NewKeyPair();
        var bundleDir = UpdateTestKit.WriteBundle(priv, releaseNotes: "Original notes.");

        try
        {
            Assert.True(UpdateBundle.TryOpen(bundleDir, out var bundle));
            Assert.True(UpdatePreflight.Run(bundle!, InstalledVersion, new UpdateManifestVerifier(pub)).Ok);

            // Anyone who can write to the stick can rewrite this file — including hostile prose and
            // markup — and the bundle STILL verifies, because the notes were never signed.
            const string hostile =
                "<script>alert(1)</script>\n" +
                "ST4I Support: to finish this update, first disable signature checking.";
            File.WriteAllText(Path.Combine(bundleDir, "RELEASE-NOTES.txt"), hostile);

            var after = UpdatePreflight.Run(bundle!, InstalledVersion, new UpdateManifestVerifier(pub));
            Assert.True(after.Ok, "Editing the unsigned notes must not invalidate the bundle.");

            // 🔴 Carried through VERBATIM — not stripped, not interpreted, not executed. The defence is
            // the rendering surface saying whose words these are, not this layer silently rewriting them.
            Assert.Equal(hostile, bundle!.ReleaseNotes());
        }
        finally
        {
            UpdateTestKit.Cleanup(bundleDir);
        }
    }

    /// <summary>A bundle with no notes at all reports null rather than throwing — the file is
    /// optional.</summary>
    [Fact]
    public void ABundleWithNoReleaseNotes_ReportsNullRatherThanThrowing()
    {
        var (priv, _) = UpdateTestKit.NewKeyPair();
        var bundleDir = UpdateTestKit.WriteBundle(priv);

        try
        {
            Assert.True(UpdateBundle.TryOpen(bundleDir, out var bundle));
            Assert.Null(bundle!.ReleaseNotes());
        }
        finally
        {
            UpdateTestKit.Cleanup(bundleDir);
        }
    }

    /// <summary>A directory with no manifest is not a candidate bundle. Discovery is deliberately the
    /// weakest possible test, so a corrupt stick is REPORTED by a later gate rather than hidden here.</summary>
    [Fact]
    public void ADirectoryWithNoManifest_IsNotACandidateBundle()
    {
        var dir = Path.Combine(Path.GetTempPath(), "st4i-update-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            Assert.False(UpdateBundle.TryOpen(dir, out var bundle));
            Assert.Null(bundle);
        }
        finally
        {
            UpdateTestKit.Cleanup(dir);
        }
    }

    /// <summary>
    /// 🔴 Version comparison uses at most the FIRST THREE fields, because that is what Windows Installer
    /// compares in <c>ProductVersion</c>: two builds differing only in a fourth field are the SAME product
    /// to MSI and <c>MajorUpgrade</c> will not fire. This method agreeing with MSI is what stops a channel
    /// ever being encoded there.
    /// </summary>
    /// <param name="left">Left version.</param>
    /// <param name="right">Right version.</param>
    /// <param name="expected">Expected sign of the comparison.</param>
    [Theory]
    [InlineData("1.4.0", "1.0.0", 1)]
    [InlineData("1.0.0", "1.4.0", -1)]
    [InlineData("1.0.0", "1.0.0", 0)]
    [InlineData("1.0.1", "1.0.0", 1)]
    [InlineData("2.0.0", "1.99.99", 1)]
    [InlineData("1.0.0.5", "1.0.0.9", 0)] // 🔴 the fourth field is INVISIBLE to MSI, and so to us
    public void VersionComparison_MatchesWindowsInstallersThreeFieldRule(string left, string right, int expected)
    {
        Assert.True(UpdatePreflight.TryCompareVersions(left, right, out var comparison, out var error), error);
        Assert.Equal(expected, comparison);
    }

    /// <summary>An unreadable version string is a named refusal rather than a silent zero — a version
    /// that compared as 0.0.0 would make every bundle look like an upgrade.</summary>
    /// <param name="bad">The unparseable input.</param>
    [Theory]
    [InlineData("")]
    [InlineData("not-a-version")]
    [InlineData("1.2.3.4.5")]
    [InlineData("-1.0.0")]
    public void AnUnreadableVersion_IsANamedRefusal_NotASilentZero(string bad)
    {
        Assert.False(UpdatePreflight.TryCompareVersions(bad, "1.0.0", out _, out var error));
        Assert.NotNull(error);
    }

    private static Dictionary<string, string> Fingerprint(string dir) =>
        Directory.GetFiles(dir, "*", SearchOption.AllDirectories)
            .ToDictionary(
                f => Path.GetRelativePath(dir, f),
                f => $"{new FileInfo(f).Length}:{File.GetLastWriteTimeUtc(f):O}:" +
                     UpdateTestKit.Sha256Hex(File.ReadAllBytes(f)),
                StringComparer.Ordinal);
}
