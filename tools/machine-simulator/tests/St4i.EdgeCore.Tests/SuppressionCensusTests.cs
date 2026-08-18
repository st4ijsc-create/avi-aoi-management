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
/// <para><b>🔴 STAGE 3 HAS RUN — task AF-1, 2026-08-19 — AND THE EXAMPLE ABOVE IS SPENT WHILE THE ARGUMENT
/// IS NOT.</b> The switch is now ON for St4i.EdgeCore, so THAT <c>&lt;NoWarn&gt;</c> would move 543 rows of
/// the origin-split ledger and be caught by it. Do not conclude that this file was scaffolding for stage 2.
/// The property it asserts is about codes standing at <b>zero</b>, and after stage 3 the codes standing at
/// zero are the ones stages 4..8 are driving to zero, one file at a time: the day a stage finishes paying
/// CS1574, an override naming CS1574 is invisible to the warning ledger again and visible only here. The
/// inverse hole is also still open and still only visible here — turning the switch OFF on any of the eight
/// projects that now have it on removes an assertion and moves NO warning count, because those projects
/// stand at zero doc warnings. The eighth, St4i.EdgeCore, is the exception in DEGREE and not in kind: it
/// stands at 736, so turning it off would drop all 736 at once and — to the warning ledger alone, which
/// sees only that rows fell — be indistinguishable from a stage that PAID them. This table is the only
/// thing in the repository that tells those two apart.</para>
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
///   <item><description>🔴 <b>Every directory on BOTH ANCESTOR CHAINS that reach this solution, up to and
///   including the repository root</b> — the chain above the VENDORED FILE and the chain above the PRODUCT
///   TREE. This is the half no existing instrument has. EditorConfig discovery walks the SOURCE FILE's
///   ancestors, not the project's — measured in <c>Directory.Build.props</c>, three placements, one build
///   each — so the narrowest possible exemption of the vendored file sits at
///   <c>examples/device-client/csharp/</c>, which is OUTSIDE <c>tools/machine-simulator</c> and therefore
///   outside <c>DocCommentProseTests</c>, outside the token censuses, and outside every path any gate in this
///   repository has ever looked at.
///   <para>🔴 <b>THE SECOND CHAIN WAS MISSING ON THIS FILE'S FIRST REVISION, AND THE HOLE WAS EXACTLY THE
///   SHAPE OF THE ONE THIS FILE EXISTS TO CLOSE</b> (found by branch review, not by me). The walk starts AT
///   <c>tools/machine-simulator</c>, so its PARENT, <c>tools/</c>, belonged to neither the product tree nor
///   the vendored file's chain — and <c>tools/</c> is a direct ancestor of every source file of all fifteen
///   projects. A <c>tools/.editorconfig</c> reading
///   <c>dotnet_diagnostic.CS1591.severity = none</c> would silence the 543 warnings stages 4..8 exist to pay,
///   move no number anywhere today, and be seen by nothing — the same structure as the pre-emptive
///   <c>&lt;NoWarn&gt;</c> this file was written to catch, aimed at OUR population instead of the vendored
///   one. The claim below said the enumerated set was EXACT while the domain was one directory short, which
///   is §8.1(f) verbatim. Both chains are scanned now; today that adds ZERO rows to all three tables, because
///   <c>tools/</c> holds exactly one entry and it is a directory.</para></description></item>
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
///   product tree plus the two ancestor chains, all present in every checkout, so this file measures the same
///   population everywhere. It is NOT a repository-wide sweep and must not be read as one. In particular
///   <c>server/</c> and <c>client/</c> are absent from this checkout and nothing here says anything about
///   them.</description></item>
///   <item><description><b>Sibling directories of an ancestor.</b> The chains are walked, not their
///   siblings: an analyzer-config file in <c>examples/device-client/python/</c> reaches nothing this solution
///   compiles, and is neither scanned nor claimed.</description></item>
///   <item><description><b>MSBuild <c>Condition</c> attributes are not evaluated.</b> A
///   <c>&lt;GenerateDocumentationFile Condition="…"&gt;true&lt;/…&gt;</c> reads here as a plain declaration.
///   No project uses one today; the day one does, this file reports the declaration and not its effect.</description></item>
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
/// <see cref="TheCensusReachesItsCorpus_AndBothAncestorChainsThatReachThisSolution"/> fails loudly instead.</para>
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

    /// <summary>Assembled at runtime — see the class remark on the matcher counting itself.
    /// <para>🔴 THE FIRST REVISION OF THIS PATTERN COULD NOT SEE THE SPELLING THE TOOLING ACTUALLY EMITS,
    /// and its positive control did not try it (found by branch review). It required the type name
    /// immediately after <c>[</c>, so an ATTRIBUTE TARGET — <c>[assembly: …]</c>, <c>[module: …]</c> — slid
    /// past, and that is precisely what Visual Studio writes into <c>GlobalSuppressions.cs</c> for
    /// "Suppress in Suppression File". The bare <c>…Attribute</c> suffix, legal C#, slid past too. Not a live
    /// hole — this attribute cannot silence a compiler <c>CSxxxx</c>, so item 12's exposure never ran through
    /// it — but the analyzer diagnostics in the OURS bucket (<c>xUnit1013</c>, <c>xUnit2029</c>) can be
    /// silenced this way, and a control that certifies a blind detector is worth less than no control.</para></summary>
    private static readonly Regex SuppressAttribute =
        new(@"\[\s*(?:(?:assembly|module|type|method|property|field|event|param|return)\s*:\s*)?" +
            @"(?:[A-Za-z_][A-Za-z_0-9]*\s*\.\s*)*(?:Unconditional)?" + "Suppress" + "Message" +
            @"(?:Attribute)?\s*\(", RegexOptions.Compiled);

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

    /// <summary>Every directory from <paramref name="startDirectory"/> outward to the repository root,
    /// inclusive — i.e. every place an analyzer-config file could sit and still be discovered from a source
    /// file inside it. Ordered innermost first.</summary>
    private static IReadOnlyList<string> AncestorChainToRepositoryRoot(string startDirectory)
    {
        var root = RepositoryRoot().TrimEnd(Path.DirectorySeparatorChar);
        var chain = new List<string>();
        var dir = new DirectoryInfo(startDirectory);
        while (dir is not null)
        {
            chain.Add(dir.FullName);
            if (string.Equals(dir.FullName.TrimEnd(Path.DirectorySeparatorChar), root, StringComparison.OrdinalIgnoreCase))
            {
                break;
            }

            dir = dir.Parent;
        }

        return chain;
    }

    /// <summary>🔴 BOTH chains, because there are two source populations and they hang off different parents.
    /// The vendored file's chain reaches the 103 warnings nobody may pay; the PRODUCT TREE's chain reaches
    /// every source file of all fifteen projects — and its first link, the product tree's own parent, belongs
    /// to neither the recursive walk (which starts inside it) nor the vendored chain (which goes through
    /// <c>examples/</c>). That link was missing until branch review named it; see the class remark.</summary>
    private static IReadOnlyList<string> AncestorChainsReachingThisSolution() =>
        AncestorChainToRepositoryRoot(Path.GetDirectoryName(VendoredSdkFile())!)
            .Concat(AncestorChainToRepositoryRoot(BuildOutputProbe.MachineSimulatorRoot()))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

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
    /// directly in one of the ancestor directories of EITHER.</summary>
    private static IReadOnlyList<string> ScannedFiles()
    {
        var files = new List<string>(FilesUnderProductTree()) { VendoredSdkFile() };
        foreach (var dir in AncestorChainsReachingThisSolution())
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

    /// <summary>🔴 The switch itself, and the INVERSE of a suppression: turning
    /// <c>GenerateDocumentationFile</c> OFF on one of the seven that has it on removes an assertion and moves
    /// no warning count anywhere, because those seven stand at zero. Nothing in this repository could see
    /// that before this row existed. Stage 3 of item 12 moves exactly one row here — St4i.EdgeCore, off to
    /// on — and having to move it deliberately, with a sentence, is the point.
    /// <para>🔴 <b>STAGE 3 RAN ON 2026-08-19 (task AF-1) AND MOVED EXACTLY THAT ONE ROW</b>, so the table is
    /// now EIGHT on / SEVEN off plus the vendored sample's own project. It went red on the flip before the
    /// row was edited — 1 failed / 4 passed, this assertion, naming the path and the direction — which is
    /// the measurement that this table watches the DECLARATION and not the diagnostics. The sentence in the
    /// paragraph above is unchanged for the other seven `on` rows and now has one exception in degree: with
    /// 736 warnings behind it, turning St4i.EdgeCore's switch back off would drop all 736 and look, to the
    /// warning ledger alone, like a stage that paid them.</para>
    /// <para>🔴 EVERY <c>.csproj</c> ROW PLUS ANY <c>.props</c>/<c>.targets</c> THAT DECLARES IT, and the
    /// second half was missing on this file's first revision (found by branch review). Reading only
    /// <c>.csproj</c> pinned one spelling of the switch out of two: MSBuild imports
    /// <c>Directory.Build.targets</c> AFTER the project body, so a single new
    /// <c>Directory.Build.targets</c> carrying <c>false</c> BEATS every csproj here, turns the switch off on
    /// all seven, and — because those seven stand at zero — moves no warning count at all. Both tables were
    /// blind to it. The tree carries exactly one <c>Directory.Build.props</c> and no <c>.targets</c> at all
    /// today, and the props file names the property only inside XML comments, so this addition contributes
    /// ZERO rows and would contribute one the moment either fact changed.</para></summary>
    private static readonly Dictionary<string, string> ExpectedDocumentationSwitch = new(StringComparer.Ordinal)
    {
        ["tools/machine-simulator/src/St4i.Connector.Abstractions/St4i.Connector.Abstractions.csproj"] = "on",
        ["tools/machine-simulator/src/St4i.Connector.Conformance/St4i.Connector.Conformance.csproj"] = "on",
        ["tools/machine-simulator/src/St4i.DesktopShell/St4i.DesktopShell.csproj"] = "on",
        ["tools/machine-simulator/src/St4i.EdgeCore.Serial/St4i.EdgeCore.Serial.csproj"] = "on",
        ["tools/machine-simulator/src/St4i.EdgeService/St4i.EdgeService.csproj"] = "on",
        ["tools/machine-simulator/tools/serial-bench/St4i.SerialBench.csproj"] = "on",
        ["tools/machine-simulator/tools/settings-acl-probe/St4i.SettingsAclProbe.csproj"] = "on",

        // 🔴 THE ONE ROW ITEM 12 IS ABOUT, MOVED off -> on ON 2026-08-19 BY TASK AF-1 (stage 3), enforcing
        // the owner's ruling with NO exemption of any kind. It is the eighth `on` and it is deliberately
        // NOT written up beside the other seven: those seven stand at ZERO documentation warnings because
        // N-1 and N-2 WROTE the comments first, and this one stands at 736 because the ruling was that the
        // debt be NAMED rather than paid before it is named.
        //
        // WHAT MOVING THIS ROW COST, MEASURED on a full `dotnet build -t:Rebuild` of the solution at the
        // commit that moved it — never derived by subtraction, because stage 1 measured that the
        // population is not preserved under payment:
        //   the tree goes 116 -> 852 warnings, 0 errors, 15/15 compilations;
        //   736 of the 852 are this row (543 CS1591, 92 CS1573, 75 CS1574, 23 CS1734, 3 CS0419);
        //   103 of those 736 (95 CS1591 + 8 CS1573) are in the vendored SDK file this repository may not
        //   edit, and they are the NAMED DEBT — they must stay visible, and the origin-split ledger in
        //   scripts/verify-suites.sh pins them as an equality in both directions;
        //   the other 633 are ours, unpaid, and stages 4..8 pay them one measurement at a time.
        //
        // 🔴 THIS ASSERTION WENT RED ON THE FLIP BEFORE THIS LINE WAS EDITED — 1 failed / 4 passed, this
        // test, naming this path at "on" against "off". That is the evidence that it watches the SWITCH
        // and not the warnings: nothing else in this repository could have seen the edit, in either
        // direction. The rule that follows from it is the reason the row is not simply retyped: move a row
        // here only in the same commit as the property, and write the sentence.
        //
        // 🔴 AND A SECOND FACT ARRIVED WITH IT, MEASURED, WHICH NO ROW HERE ASSERTS: this switch also
        // SHIPS A FILE. `St4i.EdgeCore.xml` (1.3 MB, 959 members) now lands beside the single-file engine
        // in the published payload and is harvested whole into the MSI. Three sibling .xml files from the
        // seven `on` rows above already ship the same way and never entered this repository's record.
        // See docs/owner-decisions.md item 12 and .superpowers/sdd/item12-stage3/task-1-report.md; this
        // table is about DECLARATIONS, so the fact is named there rather than asserted here.
        ["tools/machine-simulator/src/St4i.EdgeCore/St4i.EdgeCore.csproj"] = "on",

        // 🔴 The seven that are still OFF. They are not off by neglect: the switch carries a
        // documentation-COVERAGE policy this product has never adopted, priced project by project in
        // Directory.Build.props. Turning ANY of them on is an owner decision, not an implementer one —
        // item 12's ruling names St4i.EdgeCore and nothing else.
        ["tools/machine-simulator/src/St4i.EngineApi/St4i.EngineApi.csproj"] = "off",
        ["tools/machine-simulator/src/St4iMachineSimulator/St4iMachineSimulator.csproj"] = "off",
        ["tools/machine-simulator/tests/St4i.Connector.Abstractions.Tests/St4i.Connector.Abstractions.Tests.csproj"] = "off",
        ["tools/machine-simulator/tests/St4i.Connector.Conformance.Tests/St4i.Connector.Conformance.Tests.csproj"] = "off",
        ["tools/machine-simulator/tests/St4i.EdgeCore.Tests/St4i.EdgeCore.Tests.csproj"] = "off",
        ["tools/machine-simulator/tests/St4i.EdgeService.Tests/St4i.EdgeService.Tests.csproj"] = "off",
        ["tools/machine-simulator/tests/St4i.EngineApi.Tests/St4i.EngineApi.Tests.csproj"] = "off",

        // The vendored SDK sample's own project, which sits in the vendored file's directory and is therefore
        // inside the scanned domain. It is not one of the fifteen and this repository does not build it; it
        // is listed because the domain reaches it and an unlisted file in a scanned directory is a hole.
        ["examples/device-client/csharp/ExampleScrewdriver.csproj"] = "off",
    };

    /// <summary>Declarations of the switch, keyed by repository-relative path. A <c>.csproj</c> always gets a
    /// row (<c>off</c> when it declares nothing — that IS the fact item 12 is about); a <c>.props</c> or
    /// <c>.targets</c> gets one only when it declares the property, so the ordinary case contributes
    /// nothing and any new declaration is a new row.</summary>
    private static Dictionary<string, string> ObservedDocumentationSwitch()
    {
        var observed = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var file in ScannedFiles())
        {
            var extension = Path.GetExtension(file);
            var isProject = extension.Equals(".csproj", StringComparison.OrdinalIgnoreCase);
            var isImport = extension.Equals(".props", StringComparison.OrdinalIgnoreCase) ||
                           extension.Equals(".targets", StringComparison.OrdinalIgnoreCase);
            if (!isProject && !isImport)
            {
                continue;
            }

            List<string> declared;
            try
            {
                declared = XDocument.Parse(File.ReadAllText(file))
                    .Descendants()
                    .Where(e => e.Name.LocalName == "GenerateDocumentationFile")
                    .Select(e => e.Value.Trim())
                    .ToList();
            }
            catch (System.Xml.XmlException)
            {
                observed[Relative(file)] = "UNPARSEABLE";
                continue;
            }

            if (declared.Count == 0)
            {
                if (isProject)
                {
                    observed[Relative(file)] = "off";
                }

                continue;
            }

            observed[Relative(file)] = declared.All(v => v.Equals("true", StringComparison.OrdinalIgnoreCase))
                ? (isProject ? "on" : "import-declares:true")
                : (isProject ? "off:" + string.Join("/", declared) : "import-declares:" + string.Join("/", declared));
        }

        return observed;
    }

    // ══ THE ASSERTIONS ═══════════════════════════════════════════════════════════════════════════════════

    /// <summary>The corpus guard. Named first because everything below is vacuous without it.
    /// <para>🔴 RENAMED WITHIN THIS BRANCH, and recorded rather than done quietly, because a member name is a
    /// published string (P-2). It was
    /// <c>TheCensusReachesItsCorpus_AndTheVendoredFilesAncestorChain</c> at <c>116d8bdb</c>. The old name was
    /// TRUE of the old scan and is exactly what made the old scan wrong: there are TWO chains that reach this
    /// solution, and naming one of them is how the other went unwatched.</para></summary>
    [Fact]
    public void TheCensusReachesItsCorpus_AndBothAncestorChainsThatReachThisSolution()
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

        var chains = AncestorChainsReachingThisSolution()
            .Select(d => d.TrimEnd(Path.DirectorySeparatorChar))
            .ToList();
        Assert.True(
            chains.Count >= 5,
            "The two ancestor chains reaching this solution hold only " + chains.Count + " distinct " +
            "director(ies): " + string.Join(", ", chains) + ". They were written when the union ran " +
            "examples/device-client/csharp -> examples/device-client -> examples -> repository root, PLUS " +
            "tools/machine-simulator -> tools -> repository root. A shorter union means a walk stopped early " +
            "or a population moved, and every directory that drops out is a place an exempting .editorconfig " +
            "could sit unwatched.");

        // 🔴 The three links this file exists to watch, asserted by NAME rather than left to the count above:
        // the directory holding the vendored file, the PRODUCT TREE'S PARENT (the link branch review found
        // missing, and the one that reaches all fifteen projects), and the repository root that bounds both.
        Assert.Contains(Path.GetDirectoryName(vendored)!.TrimEnd(Path.DirectorySeparatorChar), chains);
        Assert.Contains(
            Directory.GetParent(BuildOutputProbe.MachineSimulatorRoot())!.FullName.TrimEnd(Path.DirectorySeparatorChar),
            chains);
        Assert.Contains(RepositoryRoot().TrimEnd(Path.DirectorySeparatorChar), chains);
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
    /// narrowest override item 12 records can only arrive as one — and can be planted OUTSIDE
    /// tools/machine-simulator, where nothing else in this repository looks.
    /// <para>🔴 RENAMED WITHIN THIS BRANCH and recorded rather than done quietly, because a member name is a
    /// published string (P-2). It was
    /// <c>TheEnumerationOfAnalyzerConfigFilesThatWouldReachTheVendoredFile_IsExactlyThis</c> at
    /// <c>116d8bdb</c>. The old name described the old domain accurately, and the old domain was one
    /// directory short: a config reaching OUR 543 rather than THEIR 103 was outside both the name and the
    /// scan.</para></summary>
    [Fact]
    public void TheEnumerationOfAnalyzerConfigFilesThatWouldReachThisSolution_IsExactlyThis()
    {
        var observed = ObservedAnalyzerConfigFiles();

        Assert.True(
            observed.Count == ExpectedAnalyzerConfigFiles.Count &&
            observed.All(kv => ExpectedAnalyzerConfigFiles.TryGetValue(kv.Key, out var e) && e == kv.Value),
            "The analyzer-config census moved. An .editorconfig or .globalconfig appeared, vanished or " +
            "changed size in the product tree, or on EITHER ancestor chain that reaches this solution.\n" +
            "  MEASURED (Directory.Build.props records three placements, one build each): a severity section " +
            "at the repository root, at examples/, or beside the vendored file itself all reach it, because " +
            "analyzer-config discovery walks the SOURCE FILE's ancestors and not the project's. Beside that " +
            "file, naming both its documentation codes, is a perfect exemption of the 103 warnings item 12 " +
            "exists to keep NAMED.\n" +
            "  AND THE OTHER CHAIN IS THE ONE THAT REACHES US: the product tree's own parent is an ancestor " +
            "of every source file of all fifteen projects, so a section there silences OUR population — the " +
            "543 that stages 4..8 exist to pay — while moving no warning count today. That directory was " +
            "outside this scan until branch review named it.\n" +
            "  A style-only config is a legitimate thing to want. Add its row here and say in the commit that " +
            "it carries no dotnet_diagnostic severity — do not delete this assertion.\n" +
            "OBSERVED:\n" + Render(observed));
    }

    /// <summary>🔴 The switch, per project — the one row stage 3 of item 12 moved (2026-08-19, task AF-1),
    /// and the direction nothing else could see: OFF.</summary>
    [Fact]
    public void TheDocumentationSwitchIsSetOnExactlyTheseProjects()
    {
        var observed = ObservedDocumentationSwitch();

        Assert.True(
            observed.Count == ExpectedDocumentationSwitch.Count &&
            observed.All(kv => ExpectedDocumentationSwitch.TryGetValue(kv.Key, out var e) && e == kv.Value),
            "The GenerateDocumentationFile census moved. Read the direction before anything else:\n" +
            "  on -> off  REMOVES an assertion. For the seven projects N-1 and N-2 documented it moves NO " +
            "warning count at all, because those seven stand at zero doc warnings — 107 comments were " +
            "written to get them there. For St4i.EdgeCore, whose switch stage 3 turned on over an UNPAID " +
            "debt, it drops all 736 at once and looks — to the warning ledger, which sees only that rows " +
            "fell — exactly like a stage that paid them. Nothing else in this repository can tell those " +
            "apart.\n" +
            "  off -> on  is item 12 being enforced. For St4i.EdgeCore that WAS stage 3, done 2026-08-19, " +
            "and it is measured: the tree went 116 -> 852 warnings, of which 103 sit in the vendored SDK " +
            "file nobody may edit and 633 are ours and unpaid. It arrived with the origin-split ledger in " +
            "scripts/verify-suites.sh moved in the same commit and with no override of any kind. For any " +
            "OTHER project, off -> on is an owner decision that item 12 does not authorise: the ruling " +
            "names St4i.EdgeCore and the measured price of all fifteen is 3599.\n" +
            "  an `import-declares:` row is a .props or .targets file declaring the switch for EVERY project " +
            "under it at once. Directory.Build.targets is imported AFTER the project body, so `false` there " +
            "BEATS all fifteen csproj rows above while moving no warning count at all — that is the same " +
            "inverse hole as the first line, wearing a different spelling.\n" +
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
        // 🔴 THE FOUR SPELLINGS THE FIRST REVISION OF THIS CONTROL DID NOT TRY, AND THE PATTERN COULD NOT
        //    SEE. The first two are what Visual Studio writes into GlobalSuppressions.cs; a control that
        //    omits the tooling's own output certifies a detector that is blind where it will actually be
        //    used. Found by branch review.
        Assert.True(IsSuppressAttributeLine("[assembly: " + "Suppress" + "Message(\"x\", \"xUnit1013\")]"));
        Assert.True(IsSuppressAttributeLine("[assembly: System.Diagnostics.CodeAnalysis." + "Suppress" + "Message(\"x\", \"xUnit2029\")]"));
        Assert.True(IsSuppressAttributeLine("[module: " + "Suppress" + "Message(\"x\", \"xUnit1013\")]"));
        Assert.True(IsSuppressAttributeLine("[" + "Suppress" + "MessageAttribute(\"x\", \"xUnit1013\")]"));
        Assert.False(IsSuppressAttributeLine("// prose naming the " + "Suppress" + "Message attribute without applying it"));
        Assert.False(IsSuppressAttributeLine("[Obsolete(\"not this one\")]"));

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
