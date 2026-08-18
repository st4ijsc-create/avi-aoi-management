using System.Text.RegularExpressions;
using System.Xml.Linq;
using Xunit;

namespace St4i.EdgeCore.Tests;

/// <summary>
/// 🔴 Task AE-1 (.superpowers/sdd/item12-stage2/task-1-brief.md), owner decision item 12, STAGE 2 —
/// <b>"no override has shipped since N-1" is a sentence in four documents and an assertion in none of them.
/// This file makes it an assertion.</b>
///
/// <para><b>WHY A SECOND INSTRUMENT, WHEN THE GATE ALREADY COUNTS WARNINGS.</b>
/// <c>scripts/verify-suites.sh</c> pins the build's warnings twice over: once as a total
/// (<c>EXPECT_WARNINGS</c>) and, since this task, once as an ORIGIN-SPLIT LEDGER that pins every
/// (bucket, code) row separately so that a fall in one population cannot hide a rise in the other. That
/// ledger is the right instrument for every override that removes a warning WHICH EXISTS. It is blind, by
/// construction, to an override aimed at a code standing at <b>zero</b> — and that is not a corner case here,
/// it is the whole exposure item 12 creates. With <c>GenerateDocumentationFile</c> off, CS1591 and CS1573
/// are emitted NOWHERE in this solution. So <c>&lt;NoWarn&gt;$(NoWarn);CS1591&lt;/NoWarn&gt;</c> committed on
/// St4i.EdgeCore today moves not one row of that ledger, not one digit of the total, and then silences 543
/// warnings the moment the switch is turned on. Measured, both halves, in this task's report.</para>
///
/// <para><b>SO THE PROPERTY ASSERTED HERE IS ABOUT INSTRUCTIONS, NOT ABOUT DIAGNOSTICS:</b> the set of
/// places in this repository that can make a compiler diagnostic stop being reported is EXACTLY the
/// enumerated set below, and the set of projects that turn documentation diagnostics ON is exactly the other
/// enumerated set below. Neither needs the diagnostic to exist yet, which is the entire reason this file can
/// be written in the round BEFORE the switch is thrown rather than the round after.</para>
///
/// <para><b>🔴 THE TEST THIS PAIR IS BUILT TO SATISFY, and it is falsifiable rather than aspirational:</b>
/// <i>a mechanism NAMES a debt rather than SUPPRESSING it if and only if putting one more override on top of
/// it turns the gate RED.</i> Under a <c>&lt;NoWarn&gt;</c> a second override changes nothing — that is
/// precisely why a <c>&lt;NoWarn&gt;</c> is never a naming. Under this pair the FIRST override is red, and
/// red whether or not the code it names is emitted today. The control pair that demonstrates it was run on
/// the live gate, both halves, and the transcripts are in the task report; the in-process half of it is
/// <see cref="TheDetector_ReportsEachMechanismItClaimsToRead"/>, which drives the same functions the
/// assertions drive so that a detector which stops detecting fails HERE even on a clean tree.</para>
///
/// <para><b>🔴 WHERE THIS INSTRUMENT STANDS, AND WHAT IS OUTSIDE IT (§8.1(f)).</b> It stands in TEXT, over a
/// domain that is deliberately WIDER than every other scan in this repository, because the override that
/// matters most cannot be planted inside this product's tree at all:
/// <list type="bullet">
///   <item><description><b>The whole of <c>tools/machine-simulator</c></b>, with <c>bin</c>, <c>obj</c>,
///   <c>TestResults</c>, <c>node_modules</c> and <c>.git</c> pruned — every <c>.cs</c>, every MSBuild file,
///   every analyzer-config file.</description></item>
///   <item><description><b>The vendored SDK file itself</b>, resolved out of <c>St4i.EdgeCore.csproj</c>'s own
///   <c>Compile Include</c> rather than re-spelled, so a re-vendoring moves this scan instead of emptying
///   it.</description></item>
///   <item><description>🔴 <b>Every directory on that file's ANCESTOR CHAIN, up to and including the
///   repository root.</b> This is the half no existing instrument has. EditorConfig discovery walks the
///   SOURCE FILE's ancestors, not the project's — measured in <c>Directory.Build.props</c>, three placements,
///   one build each — so the narrowest possible exemption of the vendored file sits at
///   <c>examples/device-client/csharp/</c>, which is OUTSIDE <c>tools/machine-simulator</c> and therefore
///   outside <c>DocCommentProseTests</c>, outside the token censuses, and outside every path any gate in this
///   repository has ever looked at.</description></item>
/// </list>
/// And what is outside, named rather than implied:
/// <list type="bullet">
///   <item><description><b>Above the repository root.</b> EditorConfig discovery does not stop at a
///   repository; it stops at a file declaring <c>root = true</c> or at the filesystem root. A config planted
///   in <c>D:\</c> would reach the vendored file and is invisible here. The boundary is drawn at the
///   repository because that is the largest domain that is the same on every machine — a scan that read the
///   developer's home directory would report a different tree per person, which is the failure class
///   §8.1 keeps paying for.</description></item>
///   <item><description><b>Directories of this repository that a sparse checkout omits.</b> The scan is the
///   product tree plus one ancestor chain, both present in every checkout, so this file measures the same
///   population everywhere. It is NOT a repository-wide sweep and must not be read as one.</description></item>
///   <item><description><b>Suppression that is not spelled as one of the four mechanisms below</b> — an
///   analyzer package removed from a project, a <c>Compile Remove</c>, a target that swallows output, a
///   custom <c>DiagnosticSuppressor</c>. None exists here today and none is detected here.</description></item>
///   <item><description><b>It is line-oriented for the C# half.</b> A <c>#pragma</c> that is not the first
///   non-whitespace token of its line is not a preprocessor directive and is correctly ignored; a line
///   inside a raw string literal that IS shaped like one would be a false positive. The MSBuild half is not
///   line-oriented: it is parsed as XML, so an element mentioned inside an XML COMMENT is not a finding —
///   which matters, because <c>Directory.Build.props</c> quotes both suppression spellings in prose and a
///   grep-based reader would report the argument against overrides as an override.</description></item>
/// </list></para>
///
/// <para><b>🔴 THE MATCHER COUNTS ITSELF, AND THAT IS HANDLED BY CONSTRUCTION RATHER THAN LEFT TO BE
/// DISCOVERED.</b> §8.1(f) records a process matcher that counted its own process; a suppression scanner
/// over its own test file is the same defect one field over. Three of the four detectors cannot see this
/// file (the MSBuild one reads only build files, the analyzer-config one reads only config files, and the
/// pragma one requires the directive to open its line, which no sample here does). The fourth would see the
/// attribute spelling, so every sample of it below is ASSEMBLED AT RUNTIME from fragments and this file's
/// text never contains the token sequence. Do not "tidy" those concatenations into literals: doing so adds
/// this file to the census it performs.</para>
///
/// <para><b>PRECONDITION.</b> Like <c>DocCommentProseTests</c> and <c>ZeroDependencyTests</c>, this requires
/// being run from inside the source tree. A scan that cannot find its corpus has measured nothing, and
/// "nothing measured" must never read as "nothing wrong" — so
/// <see cref="TheCensusReachesItsCorpus_AndTheVendoredFilesAncestorChain"/> fails loudly instead.</para>
/// </summary>
public sealed class SuppressionCensusTests
{
    private static readonly string[] PrunedDirectoryNames = { "bin", "obj", "TestResults", "node_modules", ".git" };

    private static readonly string[] AnalyzerConfigFileNames = { ".editorconfig", ".globalconfig" };

    /// <summary>MSBuild elements that reduce or remove diagnostics. <c>WarningLevel</c> and the two
    /// warnings-as-errors switches are included not because either is suppression on its own, but because
    /// each is a lever on the same surface, and an enumeration that covered three of five levers would read
    /// as a sweep — which this codebase's whole argument says is worth less than no sweep at all.</summary>
    private static readonly string[] MsBuildSuppressionElements =
    {
        "NoWarn", "DisabledWarnings", "WarningLevel", "TreatWarningsAsErrors", "WarningsNotAsErrors",
    };

    private static readonly Regex PragmaDisable =
        new(@"^\s*#\s*pragma\s+warning\s+disable\b(?<codes>[^/]*)", RegexOptions.Compiled);

    private static readonly Regex DiagnosticCode = new(@"[A-Za-z]{2,}[0-9]+", RegexOptions.Compiled);

    /// <summary>Assembled at runtime — see the class remark on the matcher counting itself.</summary>
    private static readonly Regex SuppressAttribute =
        new(@"\[\s*(?:[A-Za-z_.]+\.)?(?:Unconditional)?" + "Suppress" + "Message" + @"\s*\(", RegexOptions.Compiled);

    private static readonly Regex AnalyzerConfigSeverity =
        new(@"^\s*dotnet_(?:diagnostic|analyzer_diagnostic)(?:\.(?<code>[A-Za-z]{2,}[0-9]+))?(?:\.category-[A-Za-z]+)?\.severity\s*=\s*(?<level>[A-Za-z_]+)",
            RegexOptions.Compiled);

    /// <summary>The severities that keep a diagnostic out of the build's warning count. <c>warning</c> and
    /// <c>error</c> keep or raise it and are deliberately not findings. <c>default</c> IS one, and that is a
    /// judgement rather than a fact: whether it silences depends on the diagnostic's own default severity, so
    /// this instrument refuses to guess and reports it. It errs LOUD — a legitimate <c>default</c> costs one
    /// row and a sentence; a silencing one waved through costs the assertion.</summary>
    private static readonly HashSet<string> SilencingSeverities =
        new(StringComparer.OrdinalIgnoreCase) { "none", "silent", "suggestion", "default" };

    // ══ THE WALK ═════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>The vendored SDK file <c>St4i.EdgeCore</c> compiles from outside its own cone, read out of the
    /// csproj that links it. Deliberately the same derivation <c>DocCommentProseTests</c> uses and the same
    /// one <c>scripts/verify-suites.sh</c>'s warning ledger uses, so three instruments cannot disagree about
    /// which file this is.</summary>
    private static string VendoredSdkFile()
    {
        var projectPath = Path.Combine(
            BuildOutputProbe.MachineSimulatorRoot(), "src", "St4i.EdgeCore", "St4i.EdgeCore.csproj");
        Assert.True(File.Exists(projectPath), $"{projectPath} does not exist — this scan derives its corpus from it.");

        var projectDir = Path.GetDirectoryName(projectPath)!;
        var linked = XDocument.Load(projectPath)
            .Descendants("Compile")
            .Select(e => (string?)e.Attribute("Include"))
            .Where(i => !string.IsNullOrWhiteSpace(i))
            .Select(i => Path.GetFullPath(Path.Combine(projectDir, i!.Replace('\\', Path.DirectorySeparatorChar))))
            .Where(p => !p.StartsWith(projectDir + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            .ToList();

        Assert.True(
            linked.Count == 1,
            "St4i.EdgeCore.csproj declares " + linked.Count + " Compile items from outside its own directory; " +
            "this census was written when there was exactly one (the vendored device-client SDK). Every extra " +
            "one is a population with its own owner, its own remedy and its own ancestor chain to watch, so " +
            "decide which and say so here: " + string.Join(", ", linked));
        return linked[0];
    }

    /// <summary>The repository root, found by walking up from the vendored file to the directory holding
    /// <c>.git</c>. Named as the boundary of the ancestor scan rather than assumed: see the class remark.</summary>
    private static string RepositoryRoot()
    {
        var dir = new DirectoryInfo(Path.GetDirectoryName(VendoredSdkFile())!);
        while (dir is not null)
        {
            var git = Path.Combine(dir.FullName, ".git");
            if (Directory.Exists(git) || File.Exists(git))
            {
                return dir.FullName;
            }

            dir = dir.Parent;
        }

        throw new InvalidOperationException(
            "Could not locate the repository root (a `.git` entry) by walking up from the vendored SDK file. " +
            "This census's ancestor scan has no boundary without it, so it refuses to run rather than scan a " +
            "domain it cannot describe.");
    }

    /// <summary>Every directory an analyzer-config file could sit in and still reach the vendored file,
    /// bounded at the repository root. Ordered from the file's own directory outward.</summary>
    private static IReadOnlyList<string> VendoredFileAncestorChain()
    {
        var root = RepositoryRoot();
        var chain = new List<string>();
        var dir = new DirectoryInfo(Path.GetDirectoryName(VendoredSdkFile())!);
        while (dir is not null)
        {
            chain.Add(dir.FullName);
            if (string.Equals(dir.FullName.TrimEnd(Path.DirectorySeparatorChar),
                              root.TrimEnd(Path.DirectorySeparatorChar),
                              StringComparison.OrdinalIgnoreCase))
            {
                break;
            }

            dir = dir.Parent;
        }

        return chain;
    }

    private static IReadOnlyList<string> FilesUnderProductTree()
    {
        var found = new List<string>();
        var pending = new Stack<string>();
        pending.Push(BuildOutputProbe.MachineSimulatorRoot());
        while (pending.Count > 0)
        {
            var dir = pending.Pop();
            found.AddRange(Directory.EnumerateFiles(dir));
            foreach (var child in Directory.EnumerateDirectories(dir))
            {
                if (!PrunedDirectoryNames.Contains(Path.GetFileName(child), StringComparer.OrdinalIgnoreCase))
                {
                    pending.Push(child);
                }
            }
        }

        found.Sort(StringComparer.OrdinalIgnoreCase);
        return found;
    }

    /// <summary>The whole scanned domain: the product tree, the vendored file, and every file sitting
    /// directly in one of the vendored file's ancestor directories.</summary>
    private static IReadOnlyList<string> ScannedFiles()
    {
        var files = new List<string>(FilesUnderProductTree()) { VendoredSdkFile() };
        foreach (var dir in VendoredFileAncestorChain())
        {
            files.AddRange(Directory.EnumerateFiles(dir));
        }

        return files
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(p => p, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    // ══ THE DETECTORS ════════════════════════════════════════════════════════════════════════════════════

    /// <summary>Codes disabled by one line, or the single entry <c>*</c> for a bare directive that disables
    /// everything. Empty for every line that is not a disabling directive — a <c>restore</c> is the END of a
    /// suppression and is deliberately not one.</summary>
    internal static IReadOnlyList<string> PragmaDisabledCodes(string line)
    {
        var m = PragmaDisable.Match(line);
        if (!m.Success)
        {
            return Array.Empty<string>();
        }

        var codes = DiagnosticCode.Matches(m.Groups["codes"].Value).Select(x => x.Value).ToList();
        return codes.Count > 0 ? codes : new List<string> { "*" };
    }

    internal static bool IsSuppressAttributeLine(string line) => SuppressAttribute.IsMatch(line);

    /// <summary>The codes an analyzer-config line silences, or empty when the line raises, keeps or does not
    /// speak about a severity. A bare <c>dotnet_analyzer_diagnostic.severity</c> reaches every analyzer
    /// diagnostic at once and is rendered <c>*</c>.</summary>
    internal static IReadOnlyList<string> AnalyzerConfigSilencedCodes(string line)
    {
        var m = AnalyzerConfigSeverity.Match(line);
        if (!m.Success || !SilencingSeverities.Contains(m.Groups["level"].Value))
        {
            return Array.Empty<string>();
        }

        var code = m.Groups["code"].Value;
        return new[] { string.IsNullOrEmpty(code) ? "*" : code };
    }

    /// <summary>The MSBuild suppression elements a build file really declares. Parsed as XML on purpose: the
    /// two spellings this repository argues AGAINST are both quoted inside an XML comment in
    /// <c>Directory.Build.props</c>, and a reader that found them there would report the argument as the
    /// thing it argues against.</summary>
    internal static IReadOnlyList<string> MsBuildSuppressionsIn(string xml)
    {
        XDocument doc;
        try
        {
            doc = XDocument.Parse(xml);
        }
        catch (System.Xml.XmlException)
        {
            return new[] { "UNPARSEABLE" };
        }

        return doc.Descendants()
            .Where(e => MsBuildSuppressionElements.Contains(e.Name.LocalName, StringComparer.Ordinal))
            .Select(e => $"<{e.Name.LocalName}>{e.Value.Trim()}")
            .OrderBy(s => s, StringComparer.Ordinal)
            .ToList();
    }

    // ══ THE CENSUS ═══════════════════════════════════════════════════════════════════════════════════════

    private static string Relative(string absolutePath) =>
        Path.GetRelativePath(RepositoryRoot(), absolutePath).Replace(Path.DirectorySeparatorChar, '/');

    private static string Render(IReadOnlyDictionary<string, string> observed) =>
        observed.Count == 0
            ? "    (empty)"
            : string.Join(Environment.NewLine, observed.OrderBy(kv => kv.Key, StringComparer.Ordinal)
                .Select(kv => $"    [\"{kv.Key}\"] = \"{kv.Value}\","));

    /// <summary>Every suppression instruction in the scanned domain, keyed by repository-relative path and
    /// rendered as a sorted, COUNTED list of mechanisms and codes. Counted, because two disables of one code
    /// in one file are two decisions; sorted, so the rendering does not depend on file order; keyed by file
    /// rather than by line, so an unrelated edit above one does not move the ledger.</summary>
    private static Dictionary<string, string> ObservedSuppressionSites()
    {
        var sites = new Dictionary<string, List<string>>(StringComparer.Ordinal);

        void Add(string path, string finding)
        {
            var key = Relative(path);
            if (!sites.TryGetValue(key, out var list))
            {
                sites[key] = list = new List<string>();
            }

            list.Add(finding);
        }

        foreach (var file in ScannedFiles())
        {
            var extension = Path.GetExtension(file);
            var name = Path.GetFileName(file);

            if (string.Equals(extension, ".cs", StringComparison.OrdinalIgnoreCase))
            {
                foreach (var line in File.ReadLines(file))
                {
                    foreach (var code in PragmaDisabledCodes(line))
                    {
                        Add(file, "pragma-disable " + code);
                    }

                    if (IsSuppressAttributeLine(line))
                    {
                        Add(file, "suppress-attribute " +
                                  (DiagnosticCode.Match(line) is { Success: true } c ? c.Value : "?"));
                    }
                }
            }
            else if (extension.Equals(".csproj", StringComparison.OrdinalIgnoreCase) ||
                     extension.Equals(".props", StringComparison.OrdinalIgnoreCase) ||
                     extension.Equals(".targets", StringComparison.OrdinalIgnoreCase))
            {
                foreach (var found in MsBuildSuppressionsIn(File.ReadAllText(file)))
                {
                    Add(file, "msbuild " + found);
                }
            }
            else if (AnalyzerConfigFileNames.Contains(name, StringComparer.OrdinalIgnoreCase))
            {
                foreach (var line in File.ReadLines(file))
                {
                    foreach (var code in AnalyzerConfigSilencedCodes(line))
                    {
                        Add(file, "analyzer-config " + code);
                    }
                }
            }
        }

        return sites.ToDictionary(
            kv => kv.Key,
            kv => string.Join(", ", kv.Value
                .GroupBy(f => f, StringComparer.Ordinal)
                .OrderBy(g => g.Key, StringComparer.Ordinal)
                .Select(g => g.Count() == 1 ? g.Key : $"{g.Key} x{g.Count()}")),
            StringComparer.Ordinal);
    }

    // ── 🔴 THE LEDGER. Every one of these is a decision somebody took and wrote a reason beside; none of them
    //    is a documentation code and none of them reaches the vendored file. ADDING A ROW IS AN OWNER
    //    DECISION FOR ITEM 12's PURPOSES — item 12's whole shape is "the 103 warnings inside the vendored SDK
    //    file may be neither written nor silenced, so they must be NAMED", and this table is where a silencing
    //    would have to appear. Do not add a row to make a build quiet. If a row is genuinely right, add it in
    //    the same commit as the code and put the reason beside the code, not here.
    private static readonly Dictionary<string, string> ExpectedSuppressionSites = new(StringComparer.Ordinal)
    {
        // Two calls into the OPC Foundation stack whose non-obsolete overloads do not exist on the pinned
        // MIT release; the reasons are on the lines themselves.
        ["tools/machine-simulator/src/St4i.EdgeCore/Drivers/OpcUa/OpcUaDriver.cs"] = "pragma-disable CS0618 x2",
        ["tools/machine-simulator/tests/St4i.EdgeCore.Tests/Drivers/OpcUa/OpcUaLoopbackHarness.cs"] = "pragma-disable CS0618",
        // Iterators with no `yield` on their live path: the unreachable code is the point of the fake.
        ["tools/machine-simulator/tests/St4i.Connector.Conformance.Tests/Fakes/IgnoresCancellationFakeDriver.cs"] = "pragma-disable CS0162",
        ["tools/machine-simulator/tests/St4i.EngineApi.Tests/FleetHostGateCommitCompletionTests.cs"] = "pragma-disable CS0162 x3",
        ["tools/machine-simulator/tests/St4i.EngineApi.Tests/FleetHostTeardownLogChannelTests.cs"] = "pragma-disable CS0162",
    };

    /// <summary>Analyzer-config files anywhere in the scanned domain. 🔴 EMPTY, AND THE EMPTINESS IS THE
    /// POINT: this repository has never had one, and the narrowest override item 12 records as available —
    /// a severity section beside the vendored SDK file, measured at CS1591 −95 and at both its codes −103 —
    /// can only arrive as one. An empty table asserted is a zero that cannot rot; the alternative is the
    /// sentence "there are none today" written into a comment, which is the failure class this whole batch
    /// has been paying for.</summary>
    private static readonly Dictionary<string, string> ExpectedAnalyzerConfigFiles = new(StringComparer.Ordinal);

    private static Dictionary<string, string> ObservedAnalyzerConfigFiles() =>
        ScannedFiles()
            .Where(f => AnalyzerConfigFileNames.Contains(Path.GetFileName(f), StringComparer.OrdinalIgnoreCase))
            .ToDictionary(
                Relative,
                f => $"{File.ReadLines(f).Count()} line(s)",
                StringComparer.Ordinal);

    /// <summary>🔴 The switch itself, per project, and the INVERSE of a suppression: turning
    /// <c>GenerateDocumentationFile</c> OFF on one of the seven that has it on removes an assertion and moves
    /// no warning count anywhere, because those seven stand at zero. Nothing in this repository could see
    /// that before this row existed. Stage 3 of item 12 moves exactly one row here — St4i.EdgeCore, off to
    /// on — and having to move it deliberately, with a sentence, is the point.</summary>
    private static readonly Dictionary<string, string> ExpectedDocumentationSwitch = new(StringComparer.Ordinal)
    {
        ["src/St4i.Connector.Abstractions/St4i.Connector.Abstractions.csproj"] = "on",
        ["src/St4i.Connector.Conformance/St4i.Connector.Conformance.csproj"] = "on",
        ["src/St4i.DesktopShell/St4i.DesktopShell.csproj"] = "on",
        ["src/St4i.EdgeCore.Serial/St4i.EdgeCore.Serial.csproj"] = "on",
        ["src/St4i.EdgeService/St4i.EdgeService.csproj"] = "on",
        ["tools/serial-bench/St4i.SerialBench.csproj"] = "on",
        ["tools/settings-acl-probe/St4i.SettingsAclProbe.csproj"] = "on",

        // 🔴 The eight that are OFF, and item 12 is about the first of them. They are not off by neglect:
        // the switch carries a documentation-COVERAGE policy this product has never adopted, priced project
        // by project in Directory.Build.props.
        ["src/St4i.EdgeCore/St4i.EdgeCore.csproj"] = "off",
        ["src/St4i.EngineApi/St4i.EngineApi.csproj"] = "off",
        ["src/St4iMachineSimulator/St4iMachineSimulator.csproj"] = "off",
        ["tests/St4i.Connector.Abstractions.Tests/St4i.Connector.Abstractions.Tests.csproj"] = "off",
        ["tests/St4i.Connector.Conformance.Tests/St4i.Connector.Conformance.Tests.csproj"] = "off",
        ["tests/St4i.EdgeCore.Tests/St4i.EdgeCore.Tests.csproj"] = "off",
        ["tests/St4i.EdgeService.Tests/St4i.EdgeService.Tests.csproj"] = "off",
        ["tests/St4i.EngineApi.Tests/St4i.EngineApi.Tests.csproj"] = "off",
    };

    private static Dictionary<string, string> ObservedDocumentationSwitch()
    {
        var root = BuildOutputProbe.MachineSimulatorRoot();
        return FilesUnderProductTree()
            .Where(f => Path.GetExtension(f).Equals(".csproj", StringComparison.OrdinalIgnoreCase))
            .ToDictionary(
                f => Path.GetRelativePath(root, f).Replace(Path.DirectorySeparatorChar, '/'),
                f =>
                {
                    var declared = XDocument.Parse(File.ReadAllText(f))
                        .Descendants()
                        .Where(e => e.Name.LocalName == "GenerateDocumentationFile")
                        .Select(e => e.Value.Trim())
                        .ToList();
                    return declared.Count == 0
                        ? "off"
                        : (declared.All(v => v.Equals("true", StringComparison.OrdinalIgnoreCase)) ? "on" : "off:" + string.Join("/", declared));
                },
                StringComparer.Ordinal);
    }

    // ══ THE ASSERTIONS ═══════════════════════════════════════════════════════════════════════════════════

    /// <summary>The corpus guard. Named first because everything below is vacuous without it.</summary>
    [Fact]
    public void TheCensusReachesItsCorpus_AndTheVendoredFilesAncestorChain()
    {
        var scanned = ScannedFiles();
        Assert.True(
            scanned.Count >= 500,
            $"The suppression scan found only {scanned.Count} files, below its floor of 500. That floor is a " +
            "FLOOR, not a census: it exists so that a walk which stopped finding the tree fails here instead " +
            "of reporting an empty suppression ledger and passing every assertion below vacuously. Fix the " +
            "walk — do NOT lower the floor.");

        var vendored = VendoredSdkFile();
        Assert.True(File.Exists(vendored), $"{vendored} — named by St4i.EdgeCore.csproj's Compile Include, absent on disk.");

        var chain = VendoredFileAncestorChain();
        Assert.True(
            chain.Count >= 4,
            "The vendored file's ancestor chain up to the repository root has only " + chain.Count +
            " director(ies): " + string.Join(", ", chain) + ". It was written when that chain ran " +
            "examples/device-client/csharp -> examples/device-client -> examples -> repository root. A shorter " +
            "chain means the file moved INTO the product tree or the root walk stopped early; either way the " +
            "directory an exempting .editorconfig would be planted in is no longer being watched.");
        Assert.Contains(RepositoryRoot(), chain);
        Assert.DoesNotContain(
            BuildOutputProbe.MachineSimulatorRoot(),
            chain.Select(d => d.TrimEnd(Path.DirectorySeparatorChar)).ToList());
    }

    /// <summary>🔴 The assertion this task exists to install. Adding ANY override anywhere this scan reaches
    /// turns this red, whether or not the code it silences is emitted today.</summary>
    [Fact]
    public void TheEnumerationOfSuppressionInstructions_IsExactlyThis()
    {
        var observed = ObservedSuppressionSites();

        Assert.True(
            observed.Count == ExpectedSuppressionSites.Count &&
            observed.All(kv => ExpectedSuppressionSites.TryGetValue(kv.Key, out var e) && e == kv.Value),
            "The suppression census moved. This is a MEASUREMENT, not a formality: something in this " +
            "repository gained, lost or changed a way of making a compiler diagnostic stop being reported.\n" +
            "  If you are here because a build was noisy: the warning count in scripts/verify-suites.sh and " +
            "its origin-split ledger are the instruments that say WHICH warnings, and item 12 " +
            "(docs/owner-decisions.md) is the decision that says a documentation warning inside the vendored " +
            "SDK file may be neither written nor silenced. Silencing one is an owner decision, not an " +
            "implementer one, and lowering this table to match is how a named debt stops being named.\n" +
            "OBSERVED:\n" + Render(observed));
    }

    /// <summary>🔴 The population whose remedy is a FILE rather than a line, kept separate because the
    /// narrowest override item 12 records can only arrive as one — and can only be planted OUTSIDE
    /// tools/machine-simulator, where nothing else in this repository looks.</summary>
    [Fact]
    public void TheEnumerationOfAnalyzerConfigFilesThatWouldReachTheVendoredFile_IsExactlyThis()
    {
        var observed = ObservedAnalyzerConfigFiles();

        Assert.True(
            observed.Count == ExpectedAnalyzerConfigFiles.Count &&
            observed.All(kv => ExpectedAnalyzerConfigFiles.TryGetValue(kv.Key, out var e) && e == kv.Value),
            "The analyzer-config census moved. An .editorconfig or .globalconfig appeared, vanished or " +
            "changed size somewhere in the product tree or on the vendored SDK file's ancestor chain.\n" +
            "  MEASURED (Directory.Build.props records the three placements and one build each): a severity " +
            "section at the repository root, at examples/, or beside the vendored file itself all reach it, " +
            "because analyzer-config discovery walks the SOURCE FILE's ancestors and not the project's. " +
            "Beside the file, naming both its documentation codes, is a perfect exemption of the 103 warnings " +
            "item 12 exists to keep NAMED.\n" +
            "  A style-only config is a legitimate thing to want. Add its row here and say in the commit that " +
            "it carries no dotnet_diagnostic severity — do not delete this assertion.\n" +
            "OBSERVED:\n" + Render(observed));
    }

    /// <summary>🔴 The switch, per project — the one row stage 3 of item 12 is going to move, and the
    /// direction nothing else could see: OFF.</summary>
    [Fact]
    public void TheDocumentationSwitchIsSetOnExactlyTheseProjects()
    {
        var observed = ObservedDocumentationSwitch();

        Assert.True(
            observed.Count == ExpectedDocumentationSwitch.Count &&
            observed.All(kv => ExpectedDocumentationSwitch.TryGetValue(kv.Key, out var e) && e == kv.Value),
            "The GenerateDocumentationFile census moved. Read the direction before anything else:\n" +
            "  on -> off  REMOVES an assertion and moves NO warning count, because every project that has it " +
            "on stands at zero doc warnings — N-1 and N-2 wrote 107 comments to get them there. Nothing else " +
            "in this repository can see this happen.\n" +
            "  off -> on  is item 12 being enforced. For St4i.EdgeCore that is stage 3 and it is measured: " +
            "the tree goes to 852 warnings, of which 103 sit in the vendored SDK file nobody may edit. It " +
            "must arrive with the origin-split ledger in scripts/verify-suites.sh moved in the same commit, " +
            "and with no override of any kind.\n" +
            "  a NEW project appearing/vanishing is neither, and needs its own row.\n" +
            "OBSERVED:\n" + Render(observed));
    }

    // ══ THE POSITIVE CONTROLS ════════════════════════════════════════════════════════════════════════════
    //
    // §8.1(h6) — an instrument that cannot go red is not an instrument, and three of the four tables above
    // are pinned at values a broken detector would also produce (two rows of zero findings and a table of
    // defaults). So every detector is driven here with hand-built inputs, in both directions.

    /// <summary>🔴 Each of the four mechanisms, proven detectable, plus the near-misses that must NOT be
    /// findings — a detector that fires on a `restore`, on prose, or on a raised severity gets its output
    /// ignored, which is exactly how the number this file protects went unwatched.</summary>
    [Fact]
    public void TheDetector_ReportsEachMechanismItClaimsToRead()
    {
        // ── pragma. Note every sample starts mid-line, which is also why this file is not in its own census.
        Assert.Equal(new[] { "CS1591" }, PragmaDisabledCodes("    #pragma warning disable CS1591"));
        Assert.Equal(new[] { "CS1591", "CS1573" }, PragmaDisabledCodes("#pragma warning disable CS1591, CS1573"));
        Assert.Equal(new[] { "*" }, PragmaDisabledCodes("#pragma warning disable"));
        Assert.Equal(new[] { "CS0618" }, PragmaDisabledCodes("#pragma warning disable CS0618 // CS1591 in the comment is not a code"));
        Assert.Empty(PragmaDisabledCodes("#pragma warning restore CS1591"));
        Assert.Empty(PragmaDisabledCodes("// a comment about #pragma warning disable CS1591"));
        Assert.Empty(PragmaDisabledCodes("nothing here"));

        // ── the attribute. Assembled, never spelled — see the class remark.
        var attr = "[" + "Suppress" + "Message(\"Microsoft.Design\", \"CS1591\")]";
        Assert.True(IsSuppressAttributeLine(attr));
        Assert.True(IsSuppressAttributeLine("    [System.Diagnostics.CodeAnalysis." + "Suppress" + "Message(\"x\", \"CS1591\")]"));
        Assert.True(IsSuppressAttributeLine("[Unconditional" + "Suppress" + "Message(\"x\", \"IL2026\")]"));
        Assert.False(IsSuppressAttributeLine("// prose naming the " + "Suppress" + "Message attribute without applying it"));

        // ── MSBuild, parsed as XML so a commented-out element is not a finding. Both spellings below appear
        //    inside XML comments in Directory.Build.props, which is why this matters and is not pedantry.
        Assert.Equal(
            new[] { "<NoWarn>$(NoWarn);CS1591" },
            MsBuildSuppressionsIn("<Project><PropertyGroup><NoWarn>$(NoWarn);CS1591</NoWarn></PropertyGroup></Project>"));
        Assert.Empty(MsBuildSuppressionsIn("<Project><!-- <NoWarn>$(NoWarn);CS1591</NoWarn> --></Project>"));
        Assert.Equal(
            new[] { "<WarningLevel>0" },
            MsBuildSuppressionsIn("<Project><PropertyGroup><WarningLevel>0</WarningLevel></PropertyGroup></Project>"));
        Assert.Empty(MsBuildSuppressionsIn("<Project><PropertyGroup><Nullable>enable</Nullable></PropertyGroup></Project>"));
        Assert.Equal(new[] { "UNPARSEABLE" }, MsBuildSuppressionsIn("<Project>"));

        // ── analyzer config. The exact section Directory.Build.props measured at −95 and at −103.
        Assert.Equal(new[] { "CS1591" }, AnalyzerConfigSilencedCodes("dotnet_diagnostic.CS1591.severity = none"));
        Assert.Equal(new[] { "CS1573" }, AnalyzerConfigSilencedCodes("   dotnet_diagnostic.CS1573.severity=silent"));
        Assert.Equal(new[] { "*" }, AnalyzerConfigSilencedCodes("dotnet_analyzer_diagnostic.severity = none"));
        Assert.Empty(AnalyzerConfigSilencedCodes("dotnet_diagnostic.CS1591.severity = warning"));
        Assert.Empty(AnalyzerConfigSilencedCodes("dotnet_diagnostic.CS1591.severity = error"));
        Assert.Empty(AnalyzerConfigSilencedCodes("indent_style = space"));
    }
}
