using System.Text;
using System.Xml;
using System.Xml.Linq;
using Xunit;

namespace St4i.EdgeCore.Tests;

/// <summary>
/// 🔴 Task W-1 (.superpowers/sdd/edgecore-doc-instrument/task-1-brief.md) — <b>the prose in
/// <c>St4i.EdgeCore</c> now has an instrument that reads it as SYNTAX, and that instrument is not the
/// compiler.</b>
///
/// <para><b>WHY IT IS NOT THE COMPILER, MEASURED RATHER THAN ARGUED.</b> The compiler reads a <c>///</c>
/// block only when <c>GenerateDocumentationFile</c> is set, and setting it turns on ONE switch that carries
/// TWO assertions — "every block parses and every symbol it names resolves" AND "every publicly visible
/// member HAS a block". <c>Directory.Build.props</c> makes that argument at length; this task re-measured it
/// on SDK 10.0.302 at <c>46439925</c> and reproduces it exactly. Turning the property on for
/// <c>St4i.EdgeCore</c> alone takes the tree from 116 warnings to 852: +448 CS1591 and +84 CS1573 on source
/// this repository owns, +95 CS1591 and +8 CS1573 inside the VENDORED SDK file the project
/// <c>Compile</c>-links from outside its own cone, and +101 unresolvable <c>cref</c>/<c>paramref</c> claims.
/// Nothing in the compiler separates those populations, so the compiler half of this question is an owner
/// decision and is reported as one, not taken here.</para>
///
/// <para><b>WHAT THIS FILE ASSERTS, STATED AS A PROPERTY RATHER THAN AS THE INCIDENT THAT PAID FOR IT.</b>
/// A doc comment is XML. XML that does not parse is not "slightly wrong prose" — the compiler abandons the
/// block at the first fault, so a malformed block also HIDES every claim inside it (N-1 measured that:
/// closing 19 blocks made EIGHT further defects appear). So the property is: <b>every <c>///</c> block in
/// this repository parses as XML, and every element name in it is one this repository has registered.</b>
/// Neither half needs a compilation, a build output or a semantic model, so neither half is blocked by the
/// switch nobody may throw.</para>
///
/// <para><b>🔴 WHERE THIS INSTRUMENT IS STANDING, AND WHAT IS OUTSIDE IT (§8.1(f)).</b> It stands in TEXT.
/// It reads files from the source tree; it does not bind, resolve or type-check anything. Named as a
/// boundary rather than implied, because the two halves of "doc-comment correctness" fail in opposite
/// directions and only one of them is here:
/// <list type="bullet">
///   <item><description><b>It cannot see a dangling <c>cref</c>.</b> <c>&lt;see cref="NoSuchMember"/&gt;</c>
///   is perfectly well-formed XML. Only a compilation knows the symbol is absent. There are <b>101</b> such
///   claims in <c>St4i.EdgeCore</c> today (75 CS1574, 23 CS1734, 3 CS0419) and <b>237</b> across the eight
///   projects whose switch is off; this file finds none of them and is not evidence about them.</description></item>
///   <item><description><b>It cannot see a missing or partial block</b> — CS1591 and CS1573 are questions
///   about a member, and this file never looks at a member.</description></item>
///   <item><description><b>It cannot see a block attached to nothing</b> — CS1587. A <c>///</c> run sitting
///   above a blank line is well-formed XML and this file passes it.</description></item>
///   <item><description><b>It CAN see something the compiler never looks at: the element NAME.</b> Roslyn
///   passes unknown elements through untouched, so <c>&lt;summry&gt;</c> silently deletes a whole summary
///   from every rendered surface and no build anywhere reports it. That is the one axis on which this
///   instrument is strictly wider than the switch, which is why the registry below exists.</description></item>
/// </list></para>
///
/// <para><b>🔴 FOUR MORE BOUNDARIES, ADDED BY BRANCH REVIEW, EACH DEMONSTRATED LIVE RATHER THAN REASONED
/// ABOUT.</b> They are here because the list above was otherwise careful enough to be read as complete.
/// <list type="bullet">
///   <item><description><b>Delimited <c>/** … */</c> doc comments are invisible to this reader, and the
///   compiler DOES read them</b> — a delimited block with an unclosed tag produces CS1570 twice. That is a
///   one-way gap in exactly the direction this file claims to close, so it is not merely named:
///   <c>NoDelimitedDocCommentIsWrittenAnywhereInTheCorpus</c> asserts the corpus contains none, and the day
///   somebody writes one the gate says so instead of silently not reading it. Zero today is therefore an
///   ASSERTION and not a sample.</description></item>
///   <item><description>🔴 <b>A <c>///</c> at the start of a line INSIDE a string literal is read as prose
///   — a FALSE POSITIVE.</b> This reader is line-oriented and has no lexer, so a raw string literal whose
///   content happens to look like a malformed doc block compiles cleanly and turns this suite RED. 58 files
///   in the corpus contain a raw-string fence, so the surface is not exotic; the likeliest author to hit it
///   is the next person writing a test ABOUT this file. <b>It is left in deliberately.</b> A line-oriented
///   raw-string tracker was written and measured before this sentence was: the conservative version
///   silently swallowed <b>87 real doc blocks</b> in the current tree. Between a loud false positive that
///   names its file and line and is fixed in one edit, and a silent miss that reports a clean tree, this
///   codebase's whole argument says take the loud one. Doing it properly needs a lexer, and a lexer in a
///   gate is a bigger thing than the defect it prevents.</description></item>
///   <item><description><b>ATTRIBUTE names are unchecked here AND by the compiler.</b>
///   <c>&lt;param nmae="x"&gt;</c> and <c>&lt;see crf="X"/&gt;</c> both pass silently and land verbatim in
///   the generated XML. The registry closes the element-name axis and leaves this one open; it is named
///   because the registry's whole argument is about prose lost in silence, and this is the same loss by a
///   different route. Neither reader in this repository covers it.</description></item>
///   <item><description><b>A block that PARSES but means nothing defeats both halves by construction.</b>
///   Fully escaped markup (<c>&amp;lt;summary&amp;gt;…</c>) parses to zero elements and renders as literal
///   text; a block wholly inside a comment or a CDATA section parses and says nothing; an
///   <c>&lt;inheritdoc/&gt;</c> inheriting from nothing resolves to nothing. This file asserts WELL-FORMED
///   and REGISTERED, never MEANINGFUL, and no assertion here should ever be read as the third.</description></item>
/// </list></para>
///
/// <para><b>🔴 THE RETROACTIVE CONTROL — this class was run against committed history before it was
/// believed.</b> At <c>811c9054</c> (N-1's base) it reports <b>19 malformed blocks in 15 files</b>, which is
/// N-1's own published count, arrived at independently. At <c>9209a81b</c> (T-1's feature commit) it reports
/// the unclosed <c>&lt;b&gt;</c> in the S3 row of <c>FleetCore.cs</c>'s <c>_gate</c> summary. And it
/// reports the unclosed <c>&lt;para&gt;</c> in <c>EnumSpellingContractTests.cs</c> at every one of these
/// merges, which is the enumeration rather than its size — <c>f89da589</c> (P-2), <c>17fa6841</c> (Q-1),
/// <c>79dbf99a</c> (R-1), <c>7bb0c5bd</c> (S-1), <c>895c0c23</c> (T-1), <c>f18f5c29</c> (U-1),
/// <c>46439925</c> (V-1). 🔴 An earlier revision of this sentence said "six" and listed six of those
/// seven, dropping U-1: a ceiling offered as complete and one short, which is worth less than no ceiling
/// because it reads as a sweep. The defect was live in the tree when this task started and nothing in the
/// gate could see it, because that project's switch is off too. The class was emptied by N-1 and refilled
/// at the very next task; that is the argument for a standing check rather than a sweep.</para>
///
/// <para><b>THE CORPUS IS EVERY <c>.cs</c> FILE UNDER <c>tools/machine-simulator</c>, not every file in a
/// compilation</b> — deliberately, and it is the wider of the two: a file excluded from every csproj still
/// has readers. It is walked from <see cref="BuildOutputProbe.MachineSimulatorRoot"/> with <c>bin</c>,
/// <c>obj</c>, <c>TestResults</c>, <c>node_modules</c> and <c>.git</c> pruned. The vendored SDK file is
/// scanned as a SEPARATE population because its remedy is different, and its path is read out of
/// <c>St4i.EdgeCore.csproj</c> rather than re-spelled here, so a re-vendoring moves the scan with it instead
/// of silently emptying it.</para>
///
/// <para><b>PRECONDITION.</b> Like <c>ZeroDependencyTests</c> and <c>EnumSpellingContractTests</c>, this
/// requires being run from inside the source tree. A scan that cannot find its corpus has measured nothing,
/// and "nothing measured" must never read as "nothing wrong" — so
/// <c>TheScanReachesItsCorpus_AndTheVendoredFileTheProjectNames</c> fails loudly instead. The two floors it
/// checks are FLOORS and not a census: they say the walk found a tree, not that the tree is any particular
/// size.</para>
/// </summary>
public sealed class DocCommentProseTests
{
    // ── The corpus floors, and 🔴 THE ONLY TWO SCALARS THIS FILE PUBLISHES ABOUT ITS OWN CORPUS.
    //    Branch review caught the previous version of this comment pairing a file count from one tree with
    //    a block count from another over a different population, and the same unpairable pair had been
    //    copied into three other documents. The rule bought by that: NAME THE ASSERTION, do not copy its
    //    number into prose. So the corpus size is deliberately NOT published here — it is whatever
    //    OwnedSourceFiles() and LinkedInSourceFiles() find, and TheScanReachesItsCorpus_… is the thing that
    //    holds a number about it. These two are FLOORS: they exist to turn "the walk found nothing" into a
    //    loud failure, never to pin a count every subsequent task would have to bump.
    private const int CorpusFileFloor = 400;
    private const int CorpusBlockFloor = 2500;

    // ── 🔴 THE REGISTERED ELEMENT NAMES. This is the one assertion here that is a NEW POLICY rather than a
    //    re-reading of an existing one, and it is stated as such. Roslyn does not check element names at
    //    all, so a name that is not here is either a typo — in which case the prose it wraps is silently
    //    dropped from every rendered surface — or a deliberate new tag, in which case ADD IT HERE. Do not
    //    delete the check to make a name pass.
    //
    //    🔴 THE SET IS THE DOCUMENTED STANDARD, NOT THIS TREE'S HABITS, and branch review is the reason.
    //    The first version registered exactly the 18 names the corpus happened to use, which would have
    //    failed CORRECT, STANDARD C# the first time anyone documented a generic type (`typeparam`) or wrote
    //    a `<value>` on a property — an author with no defect, red at a gate. It also sat over the VENDORED
    //    SDK file, where a re-vendor introducing any standard tag would have reddened a gate nobody here
    //    may fix. Registering the whole documented set costs nothing in detection power: `<summry>` and
    //    `<remark>` are still not in it.
    private static readonly HashSet<string> RegisteredElementNames = new(StringComparer.Ordinal)
    {
        // The documented C# documentation-comment elements, whether or not this tree uses them yet.
        "summary", "remarks", "returns", "value", "example", "para", "list", "listheader", "item", "term",
        "description", "param", "paramref", "typeparam", "typeparamref", "exception", "permission",
        "see", "seealso", "c", "code", "inheritdoc", "include",
        // HTML-ish emphasis this tree uses inside prose; Roslyn passes them through untouched. These four
        // are the ones actually in use that the documented set does not cover.
        "b", "i", "em", "h3",
    };

    private sealed record DocBlock(string Path, int Line, string Body);

    // ══ THE WALK ═════════════════════════════════════════════════════════════════════════════════════════

    private static readonly string[] PrunedDirectoryNames = { "bin", "obj", "TestResults", "node_modules", ".git" };

    private static IReadOnlyList<string> OwnedSourceFiles()
    {
        var root = BuildOutputProbe.MachineSimulatorRoot();
        var found = new List<string>();
        var pending = new Stack<string>();
        pending.Push(root);
        while (pending.Count > 0)
        {
            var dir = pending.Pop();
            found.AddRange(Directory.EnumerateFiles(dir, "*.cs"));
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

    /// <summary>The vendored SDK file <c>St4i.EdgeCore</c> compiles from outside its own cone, resolved from
    /// the csproj's own <c>Compile Include</c> so that a re-vendoring moves this scan instead of emptying
    /// it. Exactly one such item is expected; more than one is a change this file must be told about.</summary>
    private static IReadOnlyList<string> LinkedInSourceFiles()
    {
        var projectPath = Path.Combine(
            BuildOutputProbe.MachineSimulatorRoot(), "src", "St4i.EdgeCore", "St4i.EdgeCore.csproj");
        Assert.True(File.Exists(projectPath), $"{projectPath} does not exist — this scan derives its corpus from it.");

        var projectDir = Path.GetDirectoryName(projectPath)!;
        return XDocument.Load(projectPath)
            .Descendants("Compile")
            .Select(e => (string?)e.Attribute("Include"))
            .Where(i => !string.IsNullOrWhiteSpace(i))
            .Select(i => Path.GetFullPath(Path.Combine(projectDir, i!.Replace('\\', Path.DirectorySeparatorChar))))
            .Where(p => !p.StartsWith(projectDir + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            .ToList();
    }

    // ══ THE READER ═══════════════════════════════════════════════════════════════════════════════════════

    private static bool IsDocLine(string line)
    {
        var trimmed = line.AsSpan().TrimStart();
        return trimmed.StartsWith("///", StringComparison.Ordinal)
            && !trimmed.StartsWith("////", StringComparison.Ordinal);
    }

    /// <summary>A line opening a DELIMITED doc comment, <c>/** … */</c>, which this reader does not read
    /// and the compiler does. <c>/***</c> and longer are banner comments, not doc comments, and are not
    /// matched.</summary>
    private static bool IsDelimitedDocOpener(string line)
    {
        var trimmed = line.AsSpan().TrimStart();
        return trimmed.StartsWith("/**", StringComparison.Ordinal)
            && !trimmed.StartsWith("/***", StringComparison.Ordinal);
    }

    /// <summary>Every maximal run of consecutive <c>///</c> lines in a file, which is exactly the unit the
    /// compiler treats as one documentation comment. A blank line ends a run, as it does for Roslyn.</summary>
    private static IEnumerable<DocBlock> BlocksIn(string path)
    {
        var lines = File.ReadAllLines(path);
        for (var i = 0; i < lines.Length;)
        {
            if (!IsDocLine(lines[i]))
            {
                i++;
                continue;
            }

            var start = i;
            var body = new StringBuilder();
            while (i < lines.Length && IsDocLine(lines[i]))
            {
                body.AppendLine(lines[i].AsSpan().TrimStart()[3..].ToString());
                i++;
            }

            yield return new DocBlock(path, start + 1, body.ToString());
        }
    }

    /// <summary>The parse. Returns the parser's own message, or <see langword="null"/> when the block is
    /// well-formed. A synthetic root wraps the body because a doc comment is a FRAGMENT — several top-level
    /// elements are normal and are not the defect being looked for. DTD processing is refused and no
    /// resolver is installed, so nothing here can be talked into opening a file or expanding an entity.</summary>
    private static string? ParseFailure(string body)
    {
        var settings = new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null,
            ConformanceLevel = ConformanceLevel.Document,
        };

        try
        {
            using var reader = XmlReader.Create(new StringReader($"<St4iDocBlock>{body}</St4iDocBlock>"), settings);
            while (reader.Read())
            {
            }

            return null;
        }
        catch (XmlException ex)
        {
            return ex.Message;
        }
    }

    /// <summary>Element names used by a block that is already known to parse. A block that does NOT parse is
    /// skipped here rather than guessed at — it is reported by the parse assertion, and reporting the same
    /// block twice under two headings would make one defect look like two.</summary>
    private static IReadOnlyList<string> UnregisteredElementNames(string body)
    {
        var settings = new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null,
            ConformanceLevel = ConformanceLevel.Document,
        };

        var unregistered = new List<string>();
        try
        {
            using var reader = XmlReader.Create(new StringReader($"<St4iDocBlock>{body}</St4iDocBlock>"), settings);
            while (reader.Read())
            {
                if (reader.NodeType == XmlNodeType.Element
                    && !string.Equals(reader.Name, "St4iDocBlock", StringComparison.Ordinal)
                    && !RegisteredElementNames.Contains(reader.Name))
                {
                    unregistered.Add(reader.Name);
                }
            }
        }
        catch (XmlException)
        {
            return Array.Empty<string>();
        }

        return unregistered;
    }

    private static string Relative(string absolutePath) =>
        Path.GetRelativePath(BuildOutputProbe.MachineSimulatorRoot(), absolutePath)
            .Replace(Path.DirectorySeparatorChar, '/');

    private static string Report(IEnumerable<string> findings) =>
        string.Join(Environment.NewLine, findings.Select(f => "    " + f));

    // ══ THE ASSERTIONS ═══════════════════════════════════════════════════════════════════════════════════

    /// <summary>The corpus guard. Named first because everything below is vacuous without it.</summary>
    [Fact]
    public void TheScanReachesItsCorpus_AndTheVendoredFileTheProjectNames()
    {
        var owned = OwnedSourceFiles();
        Assert.True(
            owned.Count >= CorpusFileFloor,
            $"The walk from {BuildOutputProbe.MachineSimulatorRoot()} found only {owned.Count} .cs files, below the " +
            $"floor of {CorpusFileFloor}. That floor is a FLOOR, not a census: it exists so that a walk which " +
            "stopped finding the tree fails here instead of passing every assertion below vacuously. Fix the " +
            "walk — do NOT lower the floor.");

        var blocks = owned.Sum(f => BlocksIn(f).Count());
        Assert.True(
            blocks >= CorpusBlockFloor,
            $"The walk found {owned.Count} files but only {blocks} doc blocks, below the floor of {CorpusBlockFloor}. " +
            "Either the block reader stopped recognising `///`, or the tree lost most of its prose. Both are " +
            "findings; neither is a reason to lower the floor.");

        var linked = LinkedInSourceFiles();
        Assert.True(
            linked.Count == 1,
            "St4i.EdgeCore.csproj declares " + linked.Count + " Compile items from outside its own directory; this " +
            "file was written when there was exactly one (the vendored device-client SDK). Every extra one is a " +
            "population with its own owner and its own remedy, so decide which and say so here: " +
            string.Join(", ", linked));
        Assert.True(File.Exists(linked[0]), $"{linked[0]} — named by St4i.EdgeCore.csproj's Compile Include, absent on disk.");
    }

    /// <summary>🔴 The assertion this task exists to install. Every doc block in source this repository owns
    /// parses as XML. A failure here is ours and is fixed in place.</summary>
    [Fact]
    public void EveryDocBlockInSourceThisRepositoryOwns_ParsesAsXml()
    {
        var findings = new List<string>();
        foreach (var file in OwnedSourceFiles())
        {
            foreach (var block in BlocksIn(file))
            {
                var failure = ParseFailure(block.Body);
                if (failure is not null)
                {
                    findings.Add($"{Relative(block.Path)}:{block.Line} — {failure}");
                }
            }
        }

        Assert.True(
            findings.Count == 0,
            $"{findings.Count} doc block(s) in this repository's own source are not well-formed XML. The compiler " +
            "abandons a block at its first fault, so each of these also HIDES every claim written inside it:" +
            Environment.NewLine + Report(findings) + Environment.NewLine +
            "  If a line above is INSIDE A STRING LITERAL, this reader is wrong and you wrote no defect — it " +
            "is line-oriented and has no lexer (see the boundary list on this class, and the measured reason " +
            "it was left that way). Indent the sample, or stop the line starting with ///.");
    }

    /// <summary>🔴 The same question asked of the VENDORED SDK file, kept as a separate population because
    /// the remedy is different and merging them would lose that. This file is
    /// <c>examples/device-client/csharp/St4iDeviceClient.cs</c>: it is published to machine developers, kept
    /// in step with the Python and Node SDKs, and <b>this repository may not edit it</b>. So a failure here
    /// is NOT a defect to fix in place — it is a report to the SDK's owner, or a re-vendoring. It is asserted
    /// rather than skipped because it was measured clean (0 malformed blocks, and 0 CS1570 under a real
    /// <c>GenerateDocumentationFile</c> build), so the assertion costs nothing today and the day it costs
    /// something is the day somebody needs to know.</summary>
    [Fact]
    public void EveryDocBlockInTheVendoredSdkFileEdgeCoreCompiles_ParsesAsXml()
    {
        var findings = new List<string>();
        foreach (var file in LinkedInSourceFiles())
        {
            foreach (var block in BlocksIn(file))
            {
                var failure = ParseFailure(block.Body);
                if (failure is not null)
                {
                    findings.Add($"{Relative(block.Path)}:{block.Line} — {failure}");
                }
            }
        }

        Assert.True(
            findings.Count == 0,
            $"{findings.Count} doc block(s) in the VENDORED SDK file are not well-formed XML. This repository does " +
            "not own that file: the fix is a report to its owner or a re-vendoring, NOT an edit here, and NOT the " +
            "removal of this assertion:" + Environment.NewLine + Report(findings));
    }

    /// <summary>🔴 The half the compiler does not have. Roslyn ignores element names entirely, so a
    /// misspelled tag deletes its prose from every rendered surface in total silence.</summary>
    [Fact]
    public void EveryElementNameInEveryDocBlock_IsOneThisRepositoryHasRegistered()
    {
        var findings = new List<string>();
        foreach (var file in OwnedSourceFiles().Concat(LinkedInSourceFiles()))
        {
            foreach (var block in BlocksIn(file))
            {
                foreach (var name in UnregisteredElementNames(block.Body).Distinct(StringComparer.Ordinal))
                {
                    findings.Add($"{Relative(block.Path)}:{block.Line} — <{name}>");
                }
            }
        }

        Assert.True(
            findings.Count == 0,
            $"{findings.Count} doc block(s) use an element name this repository has not registered. No compiler " +
            "anywhere reports this: an unknown element is passed through, so a typo silently drops the prose it " +
            "wraps. If the name is deliberate, add it to RegisteredElementNames and say why; if it is a typo, fix " +
            "it:" + Environment.NewLine + Report(findings));
    }

    /// <summary>🔴 The boundary that is asserted rather than merely stated. C# has a SECOND documentation
    /// comment form, <c>/** … */</c>; the compiler reads it (a delimited block with an unclosed tag emits
    /// CS1570) and this reader does not look at it at all. That is a one-way gap in exactly the direction
    /// this file exists to close. There are none in the corpus, and this is what keeps it that way: a zero
    /// that an assertion holds does not rot, and the alternative — writing the sentence "there are none
    /// today" into a comment — is the failure class this whole batch has been paying for.</summary>
    [Fact]
    public void NoDelimitedDocCommentIsWrittenAnywhereInTheCorpus()
    {
        // The detector is proven HERE, in the same test, so that the zero below cannot be the zero of a
        // detector that stopped detecting. §8.1(h6) applies to a census exactly as it applies to a check.
        Assert.True(IsDelimitedDocOpener("    /** <summary>a delimited doc comment</summary> */"));
        Assert.True(IsDelimitedDocOpener("/**"));
        Assert.False(IsDelimitedDocOpener("    /*** a banner, not a doc comment ***/"));
        Assert.False(IsDelimitedDocOpener("    /* an ordinary block comment */"));
        Assert.False(IsDelimitedDocOpener("    /// an ordinary doc comment"));

        var findings = new List<string>();
        foreach (var file in OwnedSourceFiles().Concat(LinkedInSourceFiles()))
        {
            var lines = File.ReadAllLines(file);
            for (var i = 0; i < lines.Length; i++)
            {
                if (IsDelimitedDocOpener(lines[i]))
                {
                    findings.Add($"{Relative(file)}:{i + 1} — {lines[i].Trim()}");
                }
            }
        }

        Assert.True(
            findings.Count == 0,
            $"{findings.Count} delimited /** … */ doc comment(s) exist. THIS FILE CANNOT READ THEM — it is " +
            "line-oriented and only recognises `///` runs — while the compiler can and does. So a defect " +
            "written in one is invisible to the instrument in the eight projects whose switch is off, which " +
            "is precisely the gap this file exists to close. Either rewrite them as `///`, or teach the " +
            "reader above to read them. Do NOT delete this assertion:" + Environment.NewLine + Report(findings));
    }

    // ══ THE POSITIVE CONTROLS ════════════════════════════════════════════════════════════════════════════
    //
    // §8.1(h6) — an instrument that cannot go red is not an instrument, and a green suite that would stay
    // green with the checker broken witnesses nothing. Both controls below drive the SAME functions the four
    // assertions above drive, with hand-built inputs, so a checker that stops reporting fails HERE even
    // while the tree happens to be clean.

    [Fact]
    public void TheParseCheck_ReportsABlockThatIsNotWellFormed()
    {
        Assert.Null(ParseFailure("<summary>a closed block</summary>"));
        Assert.Null(ParseFailure("<summary>two</summary>\n<remarks>top-level elements</remarks>"));

        // The exact shape T-1 shipped: an opening tag inside a summary that never closes.
        Assert.NotNull(ParseFailure("<summary>row S3 <b>never closed</summary>"));
        // The exact shape P-2 shipped and six merges carried: an outer <para> closed by its parent.
        Assert.NotNull(ParseFailure("<summary><para>outer<para>inner</para></summary>"));
        // An unescaped `&`, which is the other way a block stops parsing.
        Assert.NotNull(ParseFailure("<summary>Degraded & Down</summary>"));
    }

    [Fact]
    public void TheElementNameCheck_ReportsAnUnregisteredName()
    {
        Assert.Empty(UnregisteredElementNames("<summary><para>ok</para><see cref=\"X\"/></summary>"));
        Assert.Equal(new[] { "summry" }, UnregisteredElementNames("<summry>a whole summary, silently dropped</summry>"));
        Assert.Equal(new[] { "parah" }, UnregisteredElementNames("<summary><parah>dropped</parah></summary>"));
    }
}
