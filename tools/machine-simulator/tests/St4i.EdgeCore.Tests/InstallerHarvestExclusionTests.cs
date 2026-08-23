using System.Text;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;
using System.Xml.Xsl;
using Xunit;

/// <summary>
/// 🔴 <b>Task BN-1, 2026-08-24 — <c>docs/owner-decisions.md</c> item 46, owner's ruling of 2026-08-23:
/// "HARVEST EXCLUDES BY NAME."</b> The witness for that ruling, and the binding between a name list that
/// lives in XSLT and the C# sources that actually decide what the names are.
///
/// <para><b>THE DEFECT.</b> <c>packaging/installer/build-installer.ps1</c> publishes a
/// <c>-SkipDotnetPublish</c> flag. On that branch it skips the
/// <c>Remove-Item -Recurse -Force publish-desktop</c> that the ordinary path performs, and
/// <c>St4i.Installer.wixproj</c>'s <c>HarvestDirectory</c> reads the WHOLE directory — so whatever a build
/// box's own runs of the product left beside the binary is harvested into the customer's MSI. The ruling
/// is that the exclusion must not lean on that delete: a delete protects only the arm that runs it, and
/// the flag exists to skip that arm.</para>
///
/// <para>🔴 <b>WHAT SHAPE A WITNESS FOR A POWERSHELL SCRIPT AND AN XSLT CAN TAKE — said plainly, because
/// the honest answer is "not the obvious one".</b> There is no test runner in this repository that can
/// execute <c>build-installer.ps1</c>, and building a real MSI needs the pinned WiX v4.0.5 SDK restored
/// from nuget.org against a real <c>publish-desktop\</c> tree — a release artefact, deliberately not built
/// by a test. So the thing under test here is the ONE piece of the pipeline that is a pure function:
/// <c>exclude-shell-and-engine-exe.xslt</c> is a deterministic document-to-document transform, and .NET
/// can run it with no WiX, no heat.exe and no MSI. This suite loads the REAL transform off the tree —
/// never a copy — applies it to a heat-shaped fragment, and asserts BOTH banks: the operator-authorable
/// files are gone, and every file the published payload actually ships is still there.</para>
///
/// <para>🔴 <b>WHAT THIS INSTRUMENT DOES NOT MEASURE.</b> Restated in every failure message, not just
/// here, because a check that hides its blind spots is worse than no check:
/// <list type="bullet">
/// <item><b>It does not run heat.exe.</b> <see cref="HarvestedFragment"/> is a transcription of the shape
/// heat really emitted on this tree (<c>packaging/installer/obj/x64/Release/_HarvestedFiles_dir.wxs</c>,
/// 63 Components / 63 Files / 63 ComponentRefs, with the two explicitly-authored exes already absent) —
/// but <c>obj/</c> is not committed, so this is a transcription and not the artefact. If heat's output
/// shape changes, nothing here notices. <see cref="TheTwoExplicitlyAuthoredExes_AreStillDropped"/> is the
/// floor that keeps that from being a SILENT problem: those two needles are known to fire in a real
/// build, so a fixture whose shape the transform can no longer reach fails that fact first.</item>
/// <item><b>It does not build an MSI</b>, so it says nothing about what Windows Installer does with a
/// <c>Directory</c> element left with no components under it (the <c>engine\ecosystem</c> folder becomes
/// exactly that once both of its files are dropped).</item>
/// <item><b>It does not see a writer this repository has not named.</b> The population is derived — see
/// <see cref="BesideTheBinaryStoreSources"/> — from the call sites of
/// <c>LegacyRootMigration.CopyOnce</c>, which is the product's own statement of "this store used to
/// persist beside the binary". A future writer that puts a file in the install directory WITHOUT going
/// through that migration is outside this instrument entirely.</item>
/// <item><b>It does not measure <c>build-installer.ps1</c> at all</b> — not the flag, not the skipped
/// delete, not the ordering. It measures the harvest filter that the ruling moved the burden onto.</item>
/// </list></para>
/// </summary>
public class InstallerHarvestExclusionTests
{
    // ══ THE TREE ═══════════════════════════════════════════════════════════════════════════════════

    private static string MachineSimulatorRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "fleet.json")) &&
                Directory.Exists(Path.Combine(dir.FullName, "packaging")) &&
                Directory.Exists(Path.Combine(dir.FullName, "src")))
            {
                return dir.FullName;
            }

            dir = dir.Parent;
        }

        throw new InvalidOperationException(
            "Could not locate tools/machine-simulator (fleet.json + packaging/ + src/) by walking up from " +
            $"\"{AppContext.BaseDirectory}\". This instrument reads the real transform and the real store " +
            "sources off the tree; with no tree it has measured NOTHING, and it fails rather than " +
            "reporting a clean run.");
    }

    private static string TransformPath() => Path.Combine(
        MachineSimulatorRoot(), "packaging", "installer", "exclude-shell-and-engine-exe.xslt");

    private static string WixProjPath() => Path.Combine(
        MachineSimulatorRoot(), "packaging", "installer", "St4i.Installer.wixproj");

    private static string PackageWxsPath() => Path.Combine(
        MachineSimulatorRoot(), "packaging", "installer", "Package.wxs");

    /// <summary>🔴 The files <c>Package.wxs</c> authors EXPLICITLY, read off Package.wxs (BQ-1,
    /// 2026-08-24, docs/owner-decisions.md item 67).
    ///
    /// <para>This half of the derivation used to be the hand-typed pair
    /// <c>{ \St4i.DesktopShell.exe, \St4i.EngineApi.exe }</c>, and that literal was the whole of item
    /// 67: <c>ExhibitionLauncherComponent</c> was added to Package.wxs authoring a THIRD file, nobody
    /// updated the pair, and the harvest kept a second component claiming the same installed target
    /// path. Two components on one target path is ICE30; and because the harvested copy lands in
    /// <c>HarvestedFiles</c> → <c>MainFeature</c> (<c>Level="1"</c>, always installed) while the
    /// explicit one sits behind <c>ExhibitionFeature</c> (<c>Level="1000"</c>, OFF by default), it
    /// also silently REVOKES the opt-in gate that component exists to build.</para>
    ///
    /// <para>Derived rather than listed for the same reason the store half is: a set fitted to
    /// today's Package.wxs breaks at the next <c>&lt;File&gt;</c>. A fourth explicit component now
    /// appears here on its own.</para></summary>
    private static IReadOnlyList<string> ExplicitlyAuthoredFileNames()
    {
        XNamespace wix = "http://wixtoolset.org/schemas/v4/wxs";
        var names = XDocument.Load(PackageWxsPath())
            .Descendants(wix + "File")
            .Select(f => (string?)f.Attribute("Name")
                         ?? Path.GetFileName((string)f.Attribute("Source")!))
            .Where(n => !string.IsNullOrWhiteSpace(n))
            .Select(n => n!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        Assert.True(
            names.Count > 0,
            "Package.wxs yielded NO explicitly-authored <File> elements. Either the file moved, or its " +
            "namespace changed and this derivation stopped matching — in which case the set below " +
            "collapses to the store files alone and this whole assertion goes quietly vacuous, which is " +
            "the failure shape docs/owner-decisions.md item 40 is about." + NotMeasured);

        return names;
    }

    // ══ WHO AUTHORS THE FILE — §8.1(a) ═════════════════════════════════════════════════════════════
    //
    // The name list is NOT "the files that happened to be in publish-desktop\ the day this was written".
    // A list fitted to today's residue breaks at the next name. It is derived from the product's own
    // statement of which stores ever persisted beside the binary: the call sites of
    // LegacyRootMigration.CopyOnce. That is a CENSUS, not a registry — a fourth store that joins the
    // population appears here on its own, without anybody editing this file.

    /// <summary>Matches a store's persisted filename constant. Same idiom, deliberately, as
    /// <c>tests/Shared/OwnOutputDirectoryGuard.cs</c>'s own derivation — one shape to learn.</summary>
    private static readonly Regex PersistedFileNameConst =
        new(@"const\s+string\s+\w*FileName\w*\s*=\s*""(?<name>[^""]+\.json)""", RegexOptions.None);

    /// <summary>Matches the needles the transform actually matches on, e.g. <c>'\products.json'</c>.
    /// Run over the stylesheet with its XML comments stripped, so the prose in the header — which names
    /// several of these files while explaining them — cannot be mistaken for a needle.</summary>
    private static readonly Regex TransformNeedle =
        new(@"'(?<needle>\\[A-Za-z0-9._\-]+)'", RegexOptions.None);

    private static readonly Regex XmlComment =
        new(@"<!--.*?-->", RegexOptions.Singleline);

    /// <summary>Every <c>src/</c> file that calls <c>LegacyRootMigration.CopyOnce</c>, i.e. every store
    /// the product itself says used to persist into <see cref="AppContext.BaseDirectory"/> — which is
    /// exactly <c>publish-desktop\</c> (and <c>publish-desktop\engine\</c>) on a build box.</summary>
    private static IReadOnlyList<string> BesideTheBinaryStoreSources()
    {
        var srcRoot = Path.Combine(MachineSimulatorRoot(), "src");
        var hits = Directory
            .EnumerateFiles(srcRoot, "*.cs", SearchOption.AllDirectories)
            .Where(p => File.ReadAllText(p).Contains("LegacyRootMigration.CopyOnce", StringComparison.Ordinal))
            .OrderBy(p => p, StringComparer.OrdinalIgnoreCase)
            .ToList();

        // Non-vacuity floor. An empty or near-empty census makes every set comparison below trivially
        // satisfiable, and it is reachable — a rename of the migration helper, a moved src/ root. Three
        // is what the product declares today (ProductConfigStore, SimulatedEcosystem, MachineConfigStore);
        // MORE is fine and is the case this census exists to catch, FEWER means the scan broke.
        Assert.True(
            hits.Count >= 3,
            $"Only {hits.Count} source file(s) under \"{srcRoot}\" call LegacyRootMigration.CopyOnce. At " +
            "least three do (ProductConfigStore, SimulatedEcosystem, MachineConfigStore), so this census " +
            "has stopped matching and every assertion built on it below would pass vacuously. Fix the " +
            "scan — do NOT relax this floor.\n" +
            $"  Found: {(hits.Count == 0 ? "(nothing)" : string.Join(", ", hits))}");

        return hits;
    }

    /// <summary>The file names those stores persist, listed before they are counted.</summary>
    private static SortedSet<string> OperatorAuthorableFileNames()
    {
        var names = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var source in BesideTheBinaryStoreSources())
        {
            var text = File.ReadAllText(source);

            // "This really is a beside-the-binary store" — re-earned per run rather than assumed from the
            // CopyOnce hit alone. A store whose LegacyRoot stops being AppContext.BaseDirectory has left
            // this population, and that must be a RED demanding re-derivation, not a silent shrink.
            Assert.True(
                text.Contains("LegacyRoot", StringComparison.Ordinal) &&
                text.Contains("AppContext.BaseDirectory", StringComparison.Ordinal),
                $"\"{source}\" calls LegacyRootMigration.CopyOnce but no longer declares a LegacyRoot " +
                "rooted at AppContext.BaseDirectory. Either it left the beside-the-binary population — in " +
                "which case its file names should come OUT of " +
                "packaging/installer/exclude-shell-and-engine-exe.xslt, deliberately and in a commit that " +
                "says so — or the source moved. Do not silence this.");

            var found = PersistedFileNameConst.Matches(text)
                .Select(m => m.Groups["name"].Value)
                .ToList();

            Assert.True(
                found.Count > 0,
                $"Found no persisted-filename constant in \"{source}\", so this derivation cannot say " +
                "which names that store writes beside the binary. A scan that stops matching must fail " +
                "loudly rather than contribute an empty set to an exclusion list.");

            foreach (var name in found)
            {
                names.Add(name);
            }
        }

        return names;
    }

    // ══ THE FIXTURE ════════════════════════════════════════════════════════════════════════════════

    /// <summary>The shape heat's directory harvester emits, transcribed from a real run on this tree
    /// (see the class remarks for what that transcription does and does not buy). Components only —
    /// <see cref="WithComponentGroup"/> derives the <c>ComponentGroup</c>/<c>ComponentRef</c> fragment
    /// from the Component Ids present, so the two halves of the document cannot drift apart by hand.
    ///
    /// <para>Every entry is here for a reason and the reasons are two, not one: the five
    /// operator-authorable store files and the two explicitly-authored exes are what must be DROPPED;
    /// everything else is what <c>St4i.EngineApi.csproj</c>/<c>St4i.DesktopShell.csproj</c> actually
    /// publish, and must SURVIVE — including three deliberate near-misses
    /// (<c>engine-recipes.json</c>, <c>my-products.json</c>, <c>products.json.bak</c>) whose basenames
    /// embed a needle without a path separator in front of it.</para></summary>
    private const string HarvestedFragment = """
        <Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">
            <Fragment>
                <DirectoryRef Id="INSTALLFOLDER">
                    <Component Id="cmpShellExe" Guid="*">
                        <File Id="filShellExe" KeyPath="yes" Source="SourceDir\St4i.DesktopShell.exe" />
                    </Component>
                    <Component Id="cmpShellPdb" Guid="*">
                        <File Id="filShellPdb" KeyPath="yes" Source="SourceDir\St4i.DesktopShell.pdb" />
                    </Component>
                    <Component Id="cmpShellXml" Guid="*">
                        <File Id="filShellXml" KeyPath="yes" Source="SourceDir\St4i.DesktopShell.xml" />
                    </Component>
                    <Component Id="cmpWebView2Loader" Guid="*">
                        <File Id="filWebView2Loader" KeyPath="yes" Source="SourceDir\WebView2Loader.dll" />
                    </Component>
                    <Component Id="cmpWpfGfx" Guid="*">
                        <File Id="filWpfGfx" KeyPath="yes" Source="SourceDir\wpfgfx_cor3.dll" />
                    </Component>
                    <Component Id="cmpExhibitionBat" Guid="*">
                        <File Id="filExhibitionBat" KeyPath="yes" Source="SourceDir\run-exhibition.bat" />
                    </Component>
                    <Directory Id="dirEngine" Name="engine">
                        <Component Id="cmpEngineExe" Guid="*">
                            <File Id="filEngineExe" KeyPath="yes" Source="SourceDir\engine\St4i.EngineApi.exe" />
                        </Component>
                        <Component Id="cmpEngineFleetJson" Guid="*">
                            <File Id="filEngineFleetJson" KeyPath="yes" Source="SourceDir\engine\fleet.json" />
                        </Component>
                        <Component Id="cmpEngineConnectorsJson" Guid="*">
                            <File Id="filEngineConnectorsJson" KeyPath="yes" Source="SourceDir\engine\connectors.json" />
                        </Component>
                        <Component Id="cmpEngineStaticWebAssets" Guid="*">
                            <File Id="filEngineStaticWebAssets" KeyPath="yes" Source="SourceDir\engine\St4i.EngineApi.staticwebassets.endpoints.json" />
                        </Component>
                        <Component Id="cmpEngineWebConfig" Guid="*">
                            <File Id="filEngineWebConfig" KeyPath="yes" Source="SourceDir\engine\web.config" />
                        </Component>
                        <Component Id="cmpEngineEdgeCoreXml" Guid="*">
                            <File Id="filEngineEdgeCoreXml" KeyPath="yes" Source="SourceDir\engine\St4i.EdgeCore.xml" />
                        </Component>
                        <Component Id="cmpEngineSqlite" Guid="*">
                            <File Id="filEngineSqlite" KeyPath="yes" Source="SourceDir\engine\e_sqlite3.dll" />
                        </Component>
                        <Component Id="cmpEngineProductsJson" Guid="*">
                            <File Id="filEngineProductsJson" KeyPath="yes" Source="SourceDir\engine\products.json" />
                        </Component>
                        <Component Id="cmpEngineRecipesJson" Guid="*">
                            <File Id="filEngineRecipesJson" KeyPath="yes" Source="SourceDir\engine\recipes.json" />
                        </Component>
                        <Component Id="cmpEngineMachineOperatingConfigJson" Guid="*">
                            <File Id="filEngineMachineOperatingConfigJson" KeyPath="yes" Source="SourceDir\engine\machine-operating-config.json" />
                        </Component>
                        <Component Id="cmpNearMissEngineRecipes" Guid="*">
                            <File Id="filNearMissEngineRecipes" KeyPath="yes" Source="SourceDir\engine\engine-recipes.json" />
                        </Component>
                        <Component Id="cmpNearMissMyProducts" Guid="*">
                            <File Id="filNearMissMyProducts" KeyPath="yes" Source="SourceDir\engine\my-products.json" />
                        </Component>
                        <Component Id="cmpNearMissProductsBak" Guid="*">
                            <File Id="filNearMissProductsBak" KeyPath="yes" Source="SourceDir\engine\products.json.bak" />
                        </Component>
                        <Directory Id="dirEcosystem" Name="ecosystem">
                            <Component Id="cmpEcosystemProductsJson" Guid="*">
                                <File Id="filEcosystemProductsJson" KeyPath="yes" Source="SourceDir\engine\ecosystem\ecosystem-products.json" />
                            </Component>
                            <Component Id="cmpEcosystemRecipesJson" Guid="*">
                                <File Id="filEcosystemRecipesJson" KeyPath="yes" Source="SourceDir\engine\ecosystem\ecosystem-recipes.json" />
                            </Component>
                        </Directory>
                        <Directory Id="dirMapping" Name="mapping">
                            <Component Id="cmpMappingScrewdrive" Guid="*">
                                <File Id="filMappingScrewdrive" KeyPath="yes" Source="SourceDir\engine\mapping\screwdrive.json" />
                            </Component>
                            <Component Id="cmpMappingAoi" Guid="*">
                                <File Id="filMappingAoi" KeyPath="yes" Source="SourceDir\engine\mapping\aoi.json" />
                            </Component>
                            <Component Id="cmpMappingMqttIot" Guid="*">
                                <File Id="filMappingMqttIot" KeyPath="yes" Source="SourceDir\engine\mapping\mqtt-iot.json" />
                            </Component>
                        </Directory>
                        <Directory Id="dirWwwroot" Name="wwwroot">
                            <Component Id="cmpWwwrootIndex" Guid="*">
                                <File Id="filWwwrootIndex" KeyPath="yes" Source="SourceDir\engine\wwwroot\index.html" />
                            </Component>
                            <Directory Id="dirWwwrootAssets" Name="assets">
                                <Component Id="cmpWwwrootBundle" Guid="*">
                                    <File Id="filWwwrootBundle" KeyPath="yes" Source="SourceDir\engine\wwwroot\assets\index-BhED63_h.js" />
                                </Component>
                                <Directory Id="dirWwwrootProducts" Name="products">
                                    <Component Id="cmpBoardPng" Guid="*">
                                        <File Id="filBoardPng" KeyPath="yes" Source="SourceDir\engine\wwwroot\assets\products\model-a-board.png" />
                                    </Component>
                                </Directory>
                            </Directory>
                        </Directory>
                    </Directory>
                </DirectoryRef>
            </Fragment>
        </Wix>
        """;

    /// <summary>The names that MUST survive the transform — the published payload, plus the three
    /// near-misses. Kept as a list rather than "everything not in the drop set" on purpose: the point of
    /// the second bank is that somebody wrote down, by hand, which files the product actually ships.
    ///
    /// <para>🔴 <c>SourceDir\run-exhibition.bat</c> WAS ON THIS LIST AND DID NOT MEET ITS MEMBERSHIP
    /// RULE (BQ-1, 2026-08-24, docs/owner-decisions.md item 67). This bank's own definition, one
    /// paragraph up, is "what <c>St4i.EngineApi.csproj</c>/<c>St4i.DesktopShell.csproj</c> actually
    /// publish". <c>run-exhibition.bat</c> is published by NEITHER — measured at BQ-1 over a domain
    /// of <b>18 files</b> (16 <c>.csproj</c> + 1 <c>.props</c> + 1 <c>.wixproj</c>; the repository
    /// contains no <c>.targets</c>), which mention it ZERO times. The domain is stated because a 0
    /// over an empty set is not a fact about the pattern — <c>scripts/repo-scan.sh</c> printed both
    /// numbers, which is what makes this sentence a measurement rather than an absence.
    /// It reaches <c>publish-desktop\</c> only through the manual <c>copy</c> step README.md §13.5
    /// documents (<c>build-installer.ps1</c> contains no <c>Copy-Item</c> at all), and Package.wxs
    /// installs it itself under <c>ExhibitionFeature</c>. So it belongs in
    /// the DROPPED bank, and its presence here was the assertion that held item 67's defect in
    /// place — a test standing on the side of the defect, which is the worst shape a pinned defect
    /// takes.</para></summary>
    private static readonly string[] MustSurvive =
    {
        @"SourceDir\St4i.DesktopShell.pdb",
        @"SourceDir\St4i.DesktopShell.xml",
        @"SourceDir\WebView2Loader.dll",
        @"SourceDir\wpfgfx_cor3.dll",
        @"SourceDir\engine\fleet.json",
        @"SourceDir\engine\connectors.json",
        @"SourceDir\engine\St4i.EngineApi.staticwebassets.endpoints.json",
        @"SourceDir\engine\web.config",
        @"SourceDir\engine\St4i.EdgeCore.xml",
        @"SourceDir\engine\e_sqlite3.dll",
        @"SourceDir\engine\engine-recipes.json",
        @"SourceDir\engine\my-products.json",
        @"SourceDir\engine\products.json.bak",
        @"SourceDir\engine\mapping\screwdrive.json",
        @"SourceDir\engine\mapping\aoi.json",
        @"SourceDir\engine\mapping\mqtt-iot.json",
        @"SourceDir\engine\wwwroot\index.html",
        @"SourceDir\engine\wwwroot\assets\index-BhED63_h.js",
        @"SourceDir\engine\wwwroot\assets\products\model-a-board.png",
    };

    private const string NotMeasured =
        "\n  WHAT THIS DID NOT MEASURE: heat.exe was not run, no MSI was built, and " +
        "build-installer.ps1 was not executed. This is the harvest FILTER under test, applied to a " +
        "transcription of the fragment heat emits. See InstallerHarvestExclusionTests' remarks.";

    // ══ THE MECHANICS ══════════════════════════════════════════════════════════════════════════════

    private static string WithComponentGroup(string componentsOnly)
    {
        var doc = XDocument.Parse(componentsOnly);
        XNamespace wix = "http://wixtoolset.org/schemas/v4/wxs";

        var group = new XElement(wix + "ComponentGroup", new XAttribute("Id", "HarvestedFiles"));
        foreach (var id in doc.Descendants(wix + "Component").Select(c => (string)c.Attribute("Id")!))
        {
            group.Add(new XElement(wix + "ComponentRef", new XAttribute("Id", id)));
        }

        doc.Root!.Add(new XElement(wix + "Fragment", group));
        return doc.ToString();
    }

    /// <summary>Runs the REAL stylesheet — loaded off the tree, never a copy — over the fixture.</summary>
    private static XDocument Transformed()
    {
        var xslt = new XslCompiledTransform();
        xslt.Load(TransformPath());

        var input = WithComponentGroup(HarvestedFragment);
        var output = new StringBuilder();
        using (var reader = XmlReader.Create(new StringReader(input)))
        using (var writer = XmlWriter.Create(output, xslt.OutputSettings))
        {
            xslt.Transform(reader, writer);
        }

        return XDocument.Parse(output.ToString());
    }

    private static IReadOnlyList<string> SurvivingSources(XDocument doc)
    {
        XNamespace wix = "http://wixtoolset.org/schemas/v4/wxs";
        return doc.Descendants(wix + "File")
            .Select(f => (string)f.Attribute("Source")!)
            .ToList();
    }

    private static IReadOnlyList<string> FixtureSources()
    {
        XNamespace wix = "http://wixtoolset.org/schemas/v4/wxs";
        return XDocument.Parse(HarvestedFragment)
            .Descendants(wix + "File")
            .Select(f => (string)f.Attribute("Source")!)
            .ToList();
    }

    // ══ THE FACTS ══════════════════════════════════════════════════════════════════════════════════

    /// <summary>🔴 The load-bearing one. XSLT cannot read C#, so the name list in the stylesheet is a
    /// COPY of what the stores declare — and this is what stops that copy from outliving its source.</summary>
    [Fact]
    public void TheNamesTheTransformDrops_AreExactlyTheOnesTheBesideTheBinaryStoresPersist()
    {
        var derived = OperatorAuthorableFileNames();

        var stylesheet = XmlComment.Replace(File.ReadAllText(TransformPath()), string.Empty);
        var needles = TransformNeedle.Matches(stylesheet)
            .Select(m => m.Groups["needle"].Value)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(n => n, StringComparer.OrdinalIgnoreCase)
            .ToList();

        // BOTH halves are now read off the tree (BQ-1, item 67): the explicitly-authored files come
        // from Package.wxs instead of from a pair typed here, which is what let item 67 exist.
        var expected = ExplicitlyAuthoredFileNames().Select(n => "\\" + n)
            .Concat(derived.Select(n => "\\" + n))
            .Distinct(StringComparer.Ordinal)
            .OrderBy(n => n, StringComparer.OrdinalIgnoreCase)
            .ToList();

        Assert.True(
            needles.SequenceEqual(expected, StringComparer.OrdinalIgnoreCase),
            "packaging/installer/exclude-shell-and-engine-exe.xslt no longer excludes exactly the set it " +
            "is supposed to.\n" +
            $"  Needles in the stylesheet ({needles.Count}): {string.Join(", ", needles)}\n" +
            $"  Derived from the tree     ({expected.Count}): {string.Join(", ", expected)}\n" +
            "  The derived set is the two exes Package.wxs authors explicitly, PLUS every persisted " +
            "filename constant declared by every src/ file that calls LegacyRootMigration.CopyOnce — " +
            "i.e. every store that ever wrote beside the binary, which on a build box IS " +
            "publish-desktop\\.\n" +
            "  If a store gained a file: add the needle to BOTH templates in the stylesheet (the " +
            "Component one and the ComponentRef one). If a store lost one, or left the population, take " +
            "the needle out deliberately and say so in the commit. Do NOT edit this test to match the " +
            "stylesheet — that inverts which of the two is the source of truth." + NotMeasured);
    }

    /// <summary>Bank one: the files a build box's own runs leave behind must not reach the MSI.</summary>
    [Fact]
    public void EveryOperatorAuthorableStoreFile_IsDroppedFromTheHarvest()
    {
        var names = OperatorAuthorableFileNames();
        var before = FixtureSources();

        // Non-vacuity: a fixture that never held the file cannot witness its removal.
        foreach (var name in names)
        {
            Assert.True(
                before.Any(s => s.EndsWith("\\" + name, StringComparison.OrdinalIgnoreCase)),
                $"The fixture in this file does not contain a harvested \"{name}\", so asserting that the " +
                "transform drops it would pass without measuring anything. Add it to HarvestedFragment at " +
                "the directory depth the store really writes it." + NotMeasured);
        }

        var after = SurvivingSources(Transformed());
        var leaked = after
            .Where(s => names.Any(n => s.EndsWith("\\" + n, StringComparison.OrdinalIgnoreCase)))
            .ToList();

        Assert.True(
            leaked.Count == 0,
            $"{leaked.Count} operator-authorable file(s) survived the harvest transform and would be " +
            $"installed on a customer's machine: {string.Join(", ", leaked)}\n" +
            "  These are files the running product WRITES into its own directory. " +
            "build-installer.ps1 -SkipDotnetPublish skips the wipe of publish-desktop\\, and " +
            "HarvestDirectory reads the whole tree — so a build box's own data ships. The owner ruled on " +
            "2026-08-23 that the exclusion is by NAME and does not lean on that delete " +
            "(docs/owner-decisions.md item 46)." + NotMeasured);
    }

    /// <summary>🔴 Bank two, and it is the quiet one: a filter wide enough to be safe against tomorrow's
    /// residue can drop a REAL product asset out of the MSI, and the MSI still builds and still installs.
    /// Nothing goes red on that path except this.</summary>
    [Fact]
    public void EveryFileThePublishedPayloadShips_SurvivesTheHarvest()
    {
        var before = FixtureSources();
        foreach (var expected in MustSurvive)
        {
            Assert.True(
                before.Contains(expected, StringComparer.OrdinalIgnoreCase),
                $"\"{expected}\" is on the must-survive list but is not in the fixture, so its survival " +
                "would be asserted against nothing." + NotMeasured);
        }

        var after = SurvivingSources(Transformed());
        var dropped = MustSurvive
            .Where(s => !after.Contains(s, StringComparer.OrdinalIgnoreCase))
            .ToList();

        Assert.True(
            dropped.Count == 0,
            $"{dropped.Count} file(s) the published payload actually ships were dropped by the harvest " +
            $"transform: {string.Join(", ", dropped)}\n" +
            "  This is the failure that does NOT announce itself: the MSI still builds, still validates " +
            "and still installs — it is simply missing a file, and the product finds out at runtime on a " +
            "customer's machine. Three of those entries (engine-recipes.json, my-products.json, " +
            "products.json.bak) are deliberate near-misses: their basenames embed an excluded name " +
            "WITHOUT a path separator in front of it, which is exactly what the leading `\\` in every " +
            "needle exists to require. A needle that lost its separator, or a `contains()` rewrite, drops " +
            "them." + NotMeasured);
    }

    /// <summary>🔴 ITEM 67, AS AN ASSERTION RATHER THAN A PARAGRAPH (BQ-1, 2026-08-24).
    ///
    /// <para>Every file Package.wxs authors EXPLICITLY must be dropped from the harvest, because the
    /// harvest lands in <c>[INSTALLFOLDER]</c> too — <c>St4i.Installer.wixproj</c> declares
    /// <c>&lt;HarvestDirectory Include="..\..\publish-desktop"&gt;</c> with
    /// <c>DirectoryRefId=INSTALLFOLDER</c> AND <c>SuppressRootDirectory=true</c>, so a file at the root
    /// of <c>publish-desktop\</c> lands on exactly the path the explicit component claims.</para>
    ///
    /// <para>TWO consequences, and the second is the one no prior record named. (1) Two components on
    /// one target path is ICE30 — a link-time failure. (2) The harvested copy is referenced by
    /// <c>MainFeature</c> (<c>Level="1"</c>, always installed) while the explicit one sits behind its
    /// own <c>Feature</c>; for <c>ExhibitionFeature</c> that Level is <c>1000</c> — OFF by default — so
    /// the harvest does not merely duplicate the file, it INSTALLS A FEATURE THE OPERATOR DID NOT
    /// CHOOSE. This assertion is one-directional on purpose: it says the explicit set must be dropped,
    /// never that the drop set must be explicit — the five store files are dropped for an unrelated
    /// reason (item 46) and must not be dragged into this claim.</para></summary>
    [Fact]
    public void EveryFilePackageWxsAuthorsExplicitly_IsDroppedFromTheHarvest()
    {
        var explicitNames = ExplicitlyAuthoredFileNames();
        var before = FixtureSources();

        // Non-vacuity, same rule as the store bank: a fixture that never held the file cannot witness
        // its removal, and a silently-absent name would make this test pass by measuring nothing.
        foreach (var name in explicitNames)
        {
            Assert.True(
                before.Any(s => s.EndsWith("\\" + name, StringComparison.OrdinalIgnoreCase)),
                $"The fixture in this file does not contain a harvested \"{name}\", which Package.wxs " +
                "authors explicitly, so asserting that the transform drops it would pass without " +
                "measuring anything. Add it to HarvestedFragment at the depth heat really emits it." +
                NotMeasured);
        }

        var after = SurvivingSources(Transformed());
        var collided = after
            .Where(s => explicitNames.Any(n => s.EndsWith("\\" + n, StringComparison.OrdinalIgnoreCase)))
            .ToList();

        Assert.True(
            collided.Count == 0,
            $"{collided.Count} file(s) survive the harvest that Package.wxs ALSO authors explicitly: " +
            $"{string.Join(", ", collided)}\n" +
            "  Both copies resolve to the SAME installed path ([INSTALLFOLDER], via " +
            "SuppressRootDirectory + DirectoryRefId=INSTALLFOLDER), so the build either fails ICE30 or " +
            "installs the file from the HARVESTED component — which MainFeature (Level=\"1\") always " +
            "installs, revoking the opt-in gate the explicit Feature was authored to provide.\n" +
            "  Reachable only from `build-installer.ps1 -SkipDotnetPublish`: the ordinary path runs " +
            "`Remove-Item -Recurse -Force publish-desktop` first (build-installer.ps1:91), and that " +
            "delete is exactly the protection the owner's 2026-08-23 ruling on item 46 said the " +
            "exclusion must not lean on.\n" +
            "  Fix by adding the needle to BOTH templates in the stylesheet, not by editing this test: " +
            "the tree's own authored intent (ExhibitionFeature Level=\"1000\", \"OFF by default\") is " +
            "the source of truth here." + NotMeasured);
    }

    /// <summary>The floor under the transcription. These two needles are known to fire against real heat
    /// output — the harvested fragment on this tree came back 63 Components / 63 ComponentRefs with both
    /// exes already gone — so a fixture the transform can no longer reach fails HERE, loudly, instead of
    /// letting the two facts above pass on a document nothing matches.</summary>
    [Fact]
    public void TheTwoExplicitlyAuthoredExes_AreStillDropped()
    {
        var after = SurvivingSources(Transformed());

        Assert.DoesNotContain(@"SourceDir\St4i.DesktopShell.exe", after, StringComparer.OrdinalIgnoreCase);
        Assert.DoesNotContain(@"SourceDir\engine\St4i.EngineApi.exe", after, StringComparer.OrdinalIgnoreCase);

        Assert.True(
            after.Count > 0,
            "The transform returned a document with no File elements at all, so every 'was it dropped?' " +
            "assertion in this class is vacuously true. The stylesheet, the namespace or the fixture is " +
            "what broke — not the harvest." + NotMeasured);
    }

    /// <summary>Every dropped Component must lose its ComponentRef too. A surviving ref to a component
    /// that no longer exists is a link error rather than a silent leak — but it is the other half of the
    /// edit, and the two predicates in the stylesheet are hand-duplicated, so one can be updated without
    /// the other.</summary>
    [Fact]
    public void EveryDroppedComponent_LosesItsComponentRefAsWell()
    {
        XNamespace wix = "http://wixtoolset.org/schemas/v4/wxs";
        var doc = Transformed();

        var componentIds = doc.Descendants(wix + "Component")
            .Select(c => (string)c.Attribute("Id")!)
            .ToHashSet(StringComparer.Ordinal);
        var refIds = doc.Descendants(wix + "ComponentRef")
            .Select(c => (string)c.Attribute("Id")!)
            .ToList();

        Assert.True(refIds.Count > 0, "The transformed fragment has no ComponentRef elements at all, so " +
            "this comparison is vacuous — the ComponentGroup half of the fixture is what broke." + NotMeasured);

        var dangling = refIds.Where(id => !componentIds.Contains(id)).ToList();
        Assert.True(
            dangling.Count == 0,
            $"{dangling.Count} ComponentRef(s) survived whose Component was dropped: " +
            $"{string.Join(", ", dangling)}\n" +
            "  The stylesheet spells its needle list TWICE — once on the Component template, once on the " +
            "ComponentRef template — because XSLT 1.0 has no variables usable inside a match pattern. " +
            "One was edited and the other was not." + NotMeasured);
    }

    /// <summary>🔴 The wiring. This whole file measures a stylesheet; if the installer project does not
    /// actually wire THAT stylesheet in, the measurement is of a file nobody runs — and a mis-wired
    /// <c>Transforms</c> value fails SILENTLY: the harvest simply stops excluding and the MSI still
    /// builds.</summary>
    [Fact]
    public void TheTransformThisSuiteExercises_IsTheOneTheInstallerProjectWiresUp()
    {
        var wixproj = WixProjPath();
        Assert.True(File.Exists(wixproj), $"Not found: {wixproj}" + NotMeasured);

        var doc = XDocument.Parse(File.ReadAllText(wixproj));
        var wired = doc.Descendants()
            .Where(e => e.Name.LocalName == "Transforms")
            .Select(e => e.Value.Trim())
            .Where(v => v.Length > 0)
            .ToList();

        Assert.True(
            wired.Count == 1,
            $"Expected exactly one <Transforms> value in \"{wixproj}\"; found {wired.Count}: " +
            $"{string.Join(" | ", wired)}. The harvest exclusion is wired through that metadata and " +
            "nothing else." + NotMeasured);

        var expected = Path.GetFileName(TransformPath());
        Assert.True(
            string.Equals(wired[0], expected, StringComparison.OrdinalIgnoreCase),
            $"St4i.Installer.wixproj wires HarvestDirectory/@Transforms to \"{wired[0]}\", but this suite " +
            $"measures \"{expected}\". One of the two moved. A Transforms value naming a file that is not " +
            "the exclusion stylesheet does not fail the build — the harvest just stops excluding, the MSI " +
            "still builds, and both banks this file asserts become untrue at once." + NotMeasured);
    }
}
