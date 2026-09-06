using System.Xml.Linq;
using St4i.EdgeCore.Updates;
using Xunit;

namespace St4i.EdgeCore.Tests.Updates;

/// <summary>
/// 🔴🔴 WS-F4 Task 2 — <b>THE <c>ADDLOCAL</c> TRAP, and it is a trap because its failure is SILENT.</b>
///
/// <para><b>The measured mechanism, not a suspicion.</b>
/// <c>packaging/installer/Package.wxs</c> declares four features. <c>MainFeature</c> is <c>Level="1"</c>
/// and installs by default. <c>ServiceFeature</c>, <c>StartupFeature</c> and <c>ExhibitionFeature</c> are
/// all <c>Level="1000"</c> — authored, but excluded unless explicitly requested via <c>ADDLOCAL</c>. A
/// <c>MajorUpgrade</c> removes the old product and installs the new one, and the new install re-evaluates
/// <c>Level</c> from scratch: it does not inherit what was previously selected.</para>
///
/// <para>🔴 <b>So an upgrade run without <c>ADDLOCAL</c> silently uninstalls the background service.</b>
/// The installer reports success. The machine comes back. The desktop shell starts. And the engine that
/// had been running as a Windows service is simply gone — so the symptom is "the line stopped working
/// after the update", which every engineer on site will read as a regression in the new version. They
/// will roll back, that will appear to fix it, and the real cause — one missing argument — is invisible
/// from every direction. That is why this needs a test rather than a comment.</para>
///
/// <para><b>What is tested here and what is not.</b> This asserts the ARGUMENT: that the applier re-passes
/// the installed feature set. It does not run a real MSI — no MSI is built in this tree and a test that
/// installed one would not be a unit test. The second test below closes the other half by reading
/// <c>Package.wxs</c> itself, so the two together say "the trap is real in the installer" and "the code
/// avoids it", which is the pair that would catch either side changing alone.</para>
/// </summary>
public sealed class AddLocalIsRePassedOnUpgradeTests
{
    /// <summary>
    /// 🔴 The installed feature set is re-passed as <c>ADDLOCAL</c>, so the optional features survive the
    /// upgrade.
    /// </summary>
    [Fact]
    public void TheInstalledFeatureSet_IsRePassedAsAddLocal()
    {
        var args = UpdateApplier.BuildArguments(
            @"C:\stick\St4iMachineSimulator.msi", ["MainFeature", "ServiceFeature"]);

        var addLocal = Assert.Single(args, a => a.StartsWith("ADDLOCAL=", StringComparison.Ordinal));
        Assert.Equal("ADDLOCAL=MainFeature,ServiceFeature", addLocal);

        Assert.Equal("/i", args[0]);
        Assert.Equal(@"C:\stick\St4iMachineSimulator.msi", args[1]);
        Assert.Contains("/qb", args);
    }

    /// <summary>
    /// 🔴🔴 <b>THE ONE THAT MATTERS: <c>ServiceFeature</c> SURVIVES.</b> Stated as its own test rather
    /// than folded into the one above, because this is the feature whose silent loss looks like a
    /// software bug, and a test named after it is what an engineer will find when they search for why the
    /// service disappeared.
    /// </summary>
    [Fact]
    public void AMachineWithTheBackgroundService_KeepsItAcrossTheUpgrade()
    {
        var args = UpdateApplier.BuildArguments(
            @"C:\stick\St4iMachineSimulator.msi",
            ["MainFeature", "ServiceFeature", "StartupFeature"]);

        var addLocal = Assert.Single(args, a => a.StartsWith("ADDLOCAL=", StringComparison.Ordinal));

        Assert.Contains("ServiceFeature", addLocal, StringComparison.Ordinal);
        Assert.Contains("StartupFeature", addLocal, StringComparison.Ordinal);
        Assert.Contains("MainFeature", addLocal, StringComparison.Ordinal);
    }

    /// <summary>
    /// 🔴 <b>NEGATIVE CONTROL.</b> The tests above pass if <c>ADDLOCAL</c> is emitted; a builder that
    /// emitted a hard-coded <c>ADDLOCAL=MainFeature,ServiceFeature,StartupFeature,ExhibitionFeature</c>
    /// always would satisfy them both while being wrong — it would ADD features to a machine that never
    /// had them, which is its own support call ("the update installed a service I did not ask for").
    ///
    /// <para>So: a machine carrying only the default feature must produce NO <c>ADDLOCAL</c> at all.
    /// <c>ADDLOCAL=</c> with nothing after it is not the same statement as omitting it.</para>
    /// </summary>
    [Fact]
    public void AMachineWithOnlyTheDefaultFeature_GetsNoAddLocalAndNoUnrequestedFeatures()
    {
        var withOnlyMain = UpdateApplier.BuildArguments(@"C:\stick\x.msi", ["MainFeature"]);
        var mainOnly = Assert.Single(withOnlyMain, a => a.StartsWith("ADDLOCAL=", StringComparison.Ordinal));
        Assert.Equal("ADDLOCAL=MainFeature", mainOnly);
        Assert.DoesNotContain("ServiceFeature", mainOnly, StringComparison.Ordinal);

        var withNothing = UpdateApplier.BuildArguments(@"C:\stick\x.msi", []);
        Assert.DoesNotContain(withNothing, a => a.StartsWith("ADDLOCAL", StringComparison.Ordinal));
    }

    /// <summary>
    /// 🔴 <b>THE TRAP IS STILL REAL IN THE INSTALLER.</b> Reads <c>Package.wxs</c> as XML — a parser, not
    /// a regex — and asserts that the three optional features are still <c>Level="1000"</c>.
    ///
    /// <para>This is what keeps the test above meaningful. If a future change made every feature
    /// <c>Level="1"</c>, the <c>ADDLOCAL</c> re-pass would become harmless decoration and the reasoning in
    /// this file would be stale without anything saying so. If instead a FOURTH optional feature is added,
    /// this test reddens and whoever added it learns, at that moment, that the upgrade path has to carry
    /// it too.</para>
    /// </summary>
    [Fact]
    public void PackageWxs_StillDeclaresTheThreeOptionalFeaturesAtLevel1000()
    {
        var wxsPath = Path.Combine(RepoRoot(), "packaging", "installer", "Package.wxs");
        Assert.True(File.Exists(wxsPath), $"Package.wxs is missing at {wxsPath}.");

        var doc = XDocument.Load(wxsPath);
        var features = doc.Descendants()
            .Where(e => e.Name.LocalName == "Feature")
            .Select(e => (Id: e.Attribute("Id")?.Value, Level: e.Attribute("Level")?.Value))
            .ToList();

        // Non-vacuity: an XML file that parsed to nothing would pass every claim below.
        Assert.True(features.Count >= 4,
            $"Only {features.Count} <Feature> elements were found; the parse, not the installer, is what broke.");

        Assert.Equal("1", features.Single(f => f.Id == "MainFeature").Level);

        foreach (var optional in new[] { "ServiceFeature", "StartupFeature", "ExhibitionFeature" })
        {
            Assert.Equal("1000", features.Single(f => f.Id == optional).Level);
        }

        // 🔴 And the census: every feature is either the default one or one of the three known optional
        // ones. A fourth optional feature must not appear silently, because the upgrade path has to
        // re-pass it and nothing else would say so.
        var known = new[] { "MainFeature", "ServiceFeature", "StartupFeature", "ExhibitionFeature" };
        var unexpected = features.Where(f => !known.Contains(f.Id)).Select(f => f.Id).ToList();
        Assert.True(unexpected.Count == 0,
            "Package.wxs declares a feature this upgrade path does not know about: " +
            string.Join(", ", unexpected) + ". If it is Level=\"1000\", an upgrade that does not re-pass " +
            "it in ADDLOCAL will silently uninstall it — add it to the feature set the applier re-passes.");
    }

    /// <summary>Walks up to the directory holding <c>St4iMachineSimulator.sln</c>.</summary>
    /// <returns>The repository sub-root.</returns>
    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "St4iMachineSimulator.sln"))) return dir.FullName;
            dir = dir.Parent;
        }

        throw new InvalidOperationException("Could not locate St4iMachineSimulator.sln above the test assembly.");
    }
}
