using System.Text.RegularExpressions;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// 🔴 <b>Task F-1 — every machine-wide directory this product creates must be RELOCATABLE, because that is
/// the entire mechanism by which two hosts on one machine stop overwriting each other's files.</b>
///
/// <para><b>Why this is a scan and not a list, for the third time in this repository.</b> Two sibling tests
/// already derive the set of <c>%ProgramData%\ST4I\sim\&lt;name&gt;</c> directories from <c>src/</c> rather
/// than restating it —
/// <c>NotificationDocumentationTests.EveryDirectoryTheEngineCreatesUnderProgramData_IsPurgedByTheDecommissioningScript</c>
/// (does a decommissioning wipe reach it?) and
/// <c>TestHarnessIsolationTests.EveryStoreTheEngineCreates_IsIsolatedByThePlaywrightHarness</c> (does the e2e
/// harness point it somewhere harmless?). Each of those exists because a HAND-KEPT list was audited, declared
/// complete, and was missing a store that had been added after the audit. This is the third face of the same
/// question and it fails the same way: a fourteenth store added without an <c>ST4I_*_DIR</c> variable would
/// be un-separable, two hosts would share it, and nothing anywhere would say so.</para>
///
/// <para>🔴 <b>The task brief that produced this file named FOUR stores. The enumeration found THIRTEEN, and
/// the brief's own instruction was to start from the SET rather than from its list</b> (blueprint §8.1: "not
/// in view" is the dangerous answer, not the safe one). The four it named all had the seam. So did the other
/// nine — but only one of the thirteen resolves its variable somewhere other than on the store itself, and
/// that asymmetry is recorded at the assertion below rather than in a report nobody re-reads.</para>
///
/// <para>🔴 <b>The SCOPE of "machine-wide", asked rather than assumed.</b> This scans for the
/// <c>%ProgramData%\ST4I\sim\&lt;name&gt;</c> constant, so it is blind by construction to anything the product
/// writes elsewhere. Enumerated, because "not in view" is the dangerous answer: the only such place in
/// <c>src/</c> is <c>St4i.DesktopShell</c>'s <c>%LOCALAPPDATA%\St4iMachineSimulator\{logs,WebView2}</c>
/// (<c>MainWindow.xaml.cs</c>) — an engine log file and a WebView2 browser profile, which are PER-USER rather
/// than machine-wide and are not product data. Two service hosts under two accounts already have two of them;
/// under one account they would share, which is a defect only if either ever became a data store. It is out of
/// scope deliberately, not by oversight, and the sentence is here so the next reader does not have to derive
/// it again.</para>
///
/// <para><b>What makes this non-vacuous</b> (the shape both sibling tests already carry): a floor on the
/// number of directories found, so a refactor that moves the constants fails loudly instead of asserting over
/// an empty set; and named controls, so a scan that silently stopped matching the credential-bearing stores
/// cannot stay green.</para>
/// </summary>
public sealed class PerHostDataRootsTests
{
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
            $"\"{AppContext.BaseDirectory}\". If the output layout changed, fix this walk — do NOT weaken " +
            "the assertions below to make the file findable.");
    }

    /// <summary>Every non-generated <c>*.cs</c> under <c>src/</c>. <c>bin/</c> and <c>obj/</c> carry generated
    /// copies of the same literals and are not sources of truth — the identical exclusion both sibling census
    /// tests make.</summary>
    private static IEnumerable<string> ProductSources()
    {
        foreach (var file in Directory.EnumerateFiles(
                     Path.Combine(MachineSimulatorRoot(), "src"), "*.cs", SearchOption.AllDirectories))
        {
            if (file.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal) ||
                file.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            {
                continue;
            }

            yield return file;
        }
    }

    /// <summary>
    /// 🔴 <b>The fifth-store guard.</b> The set of machine-wide directories and the set of relocation
    /// variables are both derived from <c>src/</c>, and every member of the first must have a member of the
    /// second whose name is derivable from it: <c>ST4I_</c> + the directory name uppercased with <c>-</c> →
    /// <c>_</c> + <c>_DIR</c>.
    ///
    /// <para><b>Why the derivable NAME and not merely "some variable exists".</b> Requiring only that thirteen
    /// directories and thirteen variables both exist would pass while a store's directory and its variable
    /// referred to different things — and an operator following README §15.9 sets variables by reading the
    /// directory name off a path. The rule they are told is the rule this asserts.</para>
    ///
    /// <para>🔴 <b>One store resolves its variable somewhere other than on the store, and the enumeration is
    /// how that was found rather than assumed.</b> <c>ST4I_HISTORIAN_DIR</c> is read by
    /// <c>St4i.EngineApi/Program.cs</c> and threaded into <c>SqliteHistorianStore</c>/<c>OeeSettingsStore</c>
    /// as a constructor argument; those two types have no <c>EnvVarDir</c> and no <c>ResolveRoot</c> of their
    /// own, unlike their twelve siblings. That is why this test scans for the LITERAL anywhere in <c>src/</c>
    /// rather than for a <c>public const string EnvVarDir</c> on a store type: a scan shaped like the twelve
    /// would have reported the thirteenth as unrelocatable and sent someone to "fix" a store that is already
    /// relocatable. The consequence that IS real and is recorded here rather than silently accepted: a host
    /// that constructs a historian store WITHOUT going through that composition root gets the machine-wide
    /// default with no env-var step. No host does today (only <c>St4i.EngineApi</c> has a historian at all),
    /// which is exactly the kind of "not in view" answer §8.1 calls dangerous — so it is written down.</para>
    /// </summary>
    [Fact]
    public void EveryMachineWideDirectory_IsRelocatable_ByADerivableEnvVarName()
    {
        var directories = new SortedSet<string>(StringComparer.Ordinal);
        var variables = new SortedSet<string>(StringComparer.Ordinal);

        // The `"ST4I", "sim", "<name>"` default-path constant every store declares, and every ST4I_*_DIR
        // literal anywhere in src/ — the same two patterns the two sibling census tests already use, asked
        // here against each other rather than each against a hand-maintained artefact.
        var directoryConstant = new Regex("\"ST4I\"\\s*,\\s*\"sim\"\\s*,\\s*\"(?<name>[A-Za-z0-9._-]+)\"");
        var variableLiteral = new Regex("\"(?<name>ST4I_[A-Z0-9_]*_DIR)\"");

        foreach (var file in ProductSources())
        {
            var text = File.ReadAllText(file);
            foreach (Match m in directoryConstant.Matches(text)) directories.Add(m.Groups["name"].Value);
            foreach (Match m in variableLiteral.Matches(text)) variables.Add(m.Groups["name"].Value);
        }

        // Non-vacuity, both halves. An empty (or collapsed) set on either side must fail loudly rather than
        // pass by asserting over nothing.
        Assert.True(directories.Count >= 13,
            $"Only {directories.Count} data directory constant(s) were found in src/ " +
            $"({string.Join(", ", directories)}). The scan, not the product, is what broke — fix the scan " +
            "rather than deleting this assertion.");
        Assert.True(variables.Count >= 13,
            $"Only {variables.Count} ST4I_*_DIR literal(s) were found in src/ " +
            $"({string.Join(", ", variables)}). The scan, not the product, is what broke.");

        // Controls, named explicitly: the credential-bearing stores plus the one whose variable is read at a
        // composition root rather than on the store. A scan that silently stopped matching any of these could
        // otherwise leave this test green.
        foreach (var mustFind in new[] { "creds", "identity", "connector-config", "notifications", "historian" })
        {
            Assert.Contains(mustFind, directories);
        }

        var missing = directories
            .Select(name => (Directory: name, Variable: "ST4I_" + name.ToUpperInvariant().Replace('-', '_') + "_DIR"))
            .Where(pair => !variables.Contains(pair.Variable))
            .ToList();

        Assert.True(missing.Count == 0,
            "These machine-wide data directories have NO relocation environment variable, so two ST4I hosts " +
            "on one machine cannot be given separate roots for them and will share one set of files: " +
            $"{string.Join(", ", missing.Select(p => $"{p.Directory} (expected {p.Variable})"))}. " +
            "Declare the variable on the store the way its twelve siblings do (explicit path > env var > " +
            "default), add it to README §15.9's table, and add a -XxxDir parameter to " +
            "packaging/remove-data.ps1 — a directory a decommissioning wipe cannot find is worse than one " +
            "that was never relocatable.");
    }

    /// <summary>
    /// 🔴 <b>Fix round 1 (review I-4) — the guard above measures a narrower quantity than README §15.9's
    /// "there is no exception" claims, and this is the half that closes the gap: every relocation variable
    /// must reach a real <see cref="Environment.GetEnvironmentVariable(string)"/> call.</b>
    ///
    /// <para><b>The gap, named exactly.</b> The scan above answers <i>"a quoted <c>ST4I_&lt;NAME&gt;_DIR</c>
    /// literal exists in <c>src/</c>"</i>. A fourteenth store that declares
    /// <c>public const string EnvVarDir = "ST4I_FOO_DIR";</c> and never reads it satisfies that, ships
    /// un-relocatable, and leaves the README saying there are no exceptions. So does a variable named only
    /// inside a doc comment. Neither M3 (no variable at all) nor M4 (a non-derivable name) reaches that shape,
    /// so before this test the gap was untested as well as undisclosed.</para>
    ///
    /// <para><b>How a read is recognised, and why it is not a bare <c>grep</c>.</b> Every store reads its
    /// variable through the CONSTANT, not the literal — <c>GetEnvironmentVariable(EnvVarDir)</c> — so a text
    /// search for the literal at a call site finds nothing. This binds constants to literals per FILE NAME and
    /// then resolves each call's argument: a string literal counts directly; a bare identifier counts only
    /// against a constant declared in a file of the SAME NAME (so that thirteen stores all naming their
    /// constant <c>EnvVarDir</c> cannot vouch for each other); a qualified <c>Type.Member</c> counts against
    /// the constant declared in <c>Type.cs</c>.
    /// <b>🔴 Fix round 2 (review NEW-3): "per file NAME", not "per file" — the bucket key is
    /// <see cref="Path.GetFileNameWithoutExtension(string)"/>, so two files sharing a base name share one
    /// bucket, and this tree has three <c>Program.cs</c>.</b> No store type collides today, and none can
    /// without also colliding the file/type naming convention the <c>Type.Member</c> arm already depends on —
    /// but the mechanism is coarser than "per file" and the comment now says which. Measured against the tree, that recognises all thirteen: eleven at
    /// their own store, <c>ST4I_HISTORIAN_DIR</c> as a bare literal in <c>St4i.EngineApi/Program.cs</c>, and
    /// <c>ST4I_OPCUA_PKI_DIR</c> through both a same-file and a qualified form.</para>
    ///
    /// <para>🔴 <b>What this still does NOT measure, stated because the first version of this file did not
    /// state it.</b> "Declared and read at a resolution site" is not "the resolved value is honoured all the
    /// way to a file". Nothing here executes a store, and a sweep that did would have to set thirteen
    /// process-wide variables inside a suite whose other classes boot real hosts that read them — trading a
    /// documented narrowness for an undocumented race. README §15.9 carries this same caveat where the
    /// operator reads it.
    /// <b>🔴 Where that last step actually is — and this sentence has now been wrong twice, in opposite
    /// directions.</b> Fix round 2 corrected an over-claim (<c>SecurityEnvVarTests</c> carries NO TEST; it is
    /// a <c>[CollectionDefinition]</c> marker whose only member is a collection name). The branch review then
    /// found the replacement wrong too, in two ways:
    /// <list type="bullet">
    /// <item><b>F-8, the INSTRUMENT.</b> It said the rows came from "counting the files under <c>tests/</c>
    /// that name each variable". That instrument cannot produce them: every store reads through its own
    /// constant, so <c>FleetSettingsStoreTests</c> spells <c>ST4I_SETTINGS_DIR</c> <b>zero</b> times while
    /// driving the seam through <c>FleetSettingsStore.EnvVarDir</c>, and <c>BridgeSpoolTests</c>' only
    /// occurrence of its literal is a doc comment — it is the very grep the paragraph above explains cannot
    /// work. TWO instruments were used and only one was named: (a) a literal count over <c>tests/</c>, which
    /// gives the breadth, and (b) reading each candidate for a
    /// <c>SetEnvironmentVariable(&lt;Store&gt;.EnvVarDir, …)</c> call, which gives the per-store rows. This
    /// branch's own rule is "name the instrument that produced each number", failing in the paragraph that
    /// asserts it.</item>
    /// <item><b>F-10, <c>opcua-pki</c>.</b> "Nothing measures it" was false. <c>OpcUaDriver</c>'s constructor
    /// calls <c>OpcUaPkiPaths.ResolveRoot(pkiDir)</c>, and <c>OpcUaDriverConformanceTests</c>,
    /// <c>OpcUaDriverLoopbackTests</c> and <c>OpcUaDriverWriteTests</c> each pass a real temporary root and
    /// let the driver write its app-instance certificate there — the EXPLICIT-PATH arm of the same
    /// <c>explicit &gt; env &gt; default</c> chain. The true residual is narrower: nothing exercises
    /// <c>ST4I_OPCUA_PKI_DIR</c>, the env var.</item>
    /// </list>
    /// By (b): FOUR directories have a dedicated env-var witness (<c>creds</c>, <c>settings</c>, <c>wal</c>,
    /// <c>bridge-spool</c>); EIGHT are redirected incidentally by host harnesses; <c>opcua-pki</c> is covered
    /// on its explicit-path arm and not on its env-var arm.</para>
    /// </summary>
    [Fact]
    public void EveryRelocationVariable_IsActuallyREAD_NotMerelyDeclared()
    {
        // name -> literal, per file NAME (see the remarks), so two files that both declare `EnvVarDir`
        // cannot vouch for each other.
        var constantsByFile = new Dictionary<string, Dictionary<string, string>>(StringComparer.OrdinalIgnoreCase);
        var readVariables = new SortedSet<string>(StringComparer.Ordinal);
        var callsByFile = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);

        var constantDeclaration = new Regex(
            @"const\s+string\s+(?<name>\w+)\s*=\s*""(?<literal>ST4I_[A-Z0-9_]*_DIR)""\s*;");
        var environmentRead = new Regex(
            @"GetEnvironmentVariable\(\s*(?<arg>""ST4I_[A-Z0-9_]*_DIR""|[A-Za-z_][\w.]*)\s*[,)]");

        foreach (var file in ProductSources())
        {
            var text = File.ReadAllText(file);
            var key = Path.GetFileNameWithoutExtension(file);

            foreach (Match m in constantDeclaration.Matches(text))
            {
                if (!constantsByFile.TryGetValue(key, out var map))
                {
                    constantsByFile[key] = map = new Dictionary<string, string>(StringComparer.Ordinal);
                }

                map[m.Groups["name"].Value] = m.Groups["literal"].Value;
            }

            foreach (Match m in environmentRead.Matches(text))
            {
                if (!callsByFile.TryGetValue(key, out var calls))
                {
                    callsByFile[key] = calls = new List<string>();
                }

                calls.Add(m.Groups["arg"].Value);
            }
        }

        foreach (var (fileKey, calls) in callsByFile)
        {
            foreach (var arg in calls)
            {
                if (arg.StartsWith('"'))
                {
                    readVariables.Add(arg.Trim('"'));
                    continue;
                }

                var segments = arg.Split('.');
                var member = segments[^1];

                // A bare identifier resolves ONLY against the file it appears in. A qualified Type.Member
                // resolves against the file named for that type — the file/type naming convention this
                // repository follows without exception for the store types involved.
                var owner = segments.Length == 1 ? fileKey : segments[^2];
                if (constantsByFile.TryGetValue(owner, out var map) && map.TryGetValue(member, out var literal))
                {
                    readVariables.Add(literal);
                }
            }
        }

        // Non-vacuity: the recogniser itself must find something, or every assertion below is trivially
        // satisfiable by a regex that stopped matching.
        Assert.True(readVariables.Count >= 13,
            $"Only {readVariables.Count} relocation variable(s) were recognised as READ " +
            $"({string.Join(", ", readVariables)}). The recogniser, not the product, is what broke — fix it " +
            "rather than deleting this assertion.");

        // Controls for the two resolution FORMS, so a recogniser that silently lost one of them cannot pass:
        // ST4I_HISTORIAN_DIR is only ever read as a bare literal (in St4i.EngineApi/Program.cs, not on its
        // store), and ST4I_CREDS_DIR is only ever read through a same-file constant.
        Assert.Contains("ST4I_HISTORIAN_DIR", readVariables);
        Assert.Contains("ST4I_CREDS_DIR", readVariables);

        var declaredButUnread = DeclaredDirectoryNames()
            .Select(name => "ST4I_" + name.ToUpperInvariant().Replace('-', '_') + "_DIR")
            .Where(variable => !readVariables.Contains(variable))
            .ToList();

        Assert.True(declaredButUnread.Count == 0,
            "These relocation variables are declared but never reach an Environment.GetEnvironmentVariable " +
            $"call, so setting them relocates nothing: {string.Join(", ", declaredButUnread)}. A directory " +
            "whose variable is declared and unread is WORSE than one that was never relocatable: README " +
            "§15.9 tells an operator to set it, the operator sets it, and the store keeps writing to " +
            "%ProgramData% with no error anywhere.");
    }

    /// <summary>The set of <c>%ProgramData%\ST4I\sim\&lt;name&gt;</c> leaves declared in <c>src/</c>, shared by
    /// both guards so they can never disagree about which directories exist.</summary>
    private static SortedSet<string> DeclaredDirectoryNames()
    {
        var directories = new SortedSet<string>(StringComparer.Ordinal);
        var directoryConstant = new Regex("\"ST4I\"\\s*,\\s*\"sim\"\\s*,\\s*\"(?<name>[A-Za-z0-9._-]+)\"");

        foreach (var file in ProductSources())
        {
            foreach (Match m in directoryConstant.Matches(File.ReadAllText(file)))
            {
                directories.Add(m.Groups["name"].Value);
            }
        }

        return directories;
    }

    /// <summary>
    /// 🔴 <b>Branch review F-15 — the COUNT is now derived and compared, because every census in this
    /// repository floors at <c>&gt;= 13</c> and therefore lets a fourteenth store arrive silently while the
    /// word "thirteen" rots in six places.</b>
    ///
    /// <para><b>This is the mechanical check the ledger's §G.6 trigger asked for, and it is deliberately
    /// this one rather than a grep for "every"/"all"/"no arm".</b> Both were on the table. A universal-quantifier
    /// grep cannot tell a TRUE universal from a false one, so it would answer a narrower question than the
    /// criterion — which is the exact instrument failure this branch has now been caught by four times, and
    /// building it would be committing the class while claiming to police it. A count, by contrast, is
    /// mechanically decidable and has actually been wrong: <c>web/playwright.config.ts</c> said FOURTEEN in
    /// three places and <c>scripts/verify-suites.sh</c> said FOURTEEN in one, about this same thirteen-member
    /// set, and one of those files is in the corpus a counts census declared it had swept. This test would
    /// have caught all four.</para>
    ///
    /// <para><b>What it compares:</b> the number derived from <c>src/</c> against the number SPELLED in the
    /// two sentences that state it as a rule — README §15.9's "There are **N** of them today" and
    /// <c>packaging/remove-data.ps1</c>'s ".DESCRIPTION … create N directories". Those two were chosen
    /// because each is the authoritative sentence of its own artefact; the remaining prose repeats them. A
    /// fourteenth store makes the derived number 14 and turns both comparisons red, with a message naming
    /// every place the word has to move.</para>
    /// </summary>
    [Fact]
    public void TheNumberOfMachineWideDirectories_IsDerivedFromSource_AndAgreesWithEveryPlaceThatSpellsIt()
    {
        var derived = DeclaredDirectoryNames().Count;

        // Non-vacuity: the scan must find a plausible set before its count is compared to anything.
        Assert.InRange(derived, 13, 40);

        var words = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)
        {
            ["eleven"] = 11, ["twelve"] = 12, ["thirteen"] = 13, ["fourteen"] = 14,
            ["fifteen"] = 15, ["sixteen"] = 16, ["seventeen"] = 17,
        };

        int SpelledCount(string relativePath, string pattern, string what)
        {
            var text = File.ReadAllText(Path.Combine(MachineSimulatorRoot(), relativePath));
            var m = Regex.Match(text, pattern, RegexOptions.IgnoreCase | RegexOptions.Singleline);
            Assert.True(m.Success,
                $"Could not find {what} in {relativePath}. The SCAN broke, not the product — repair the " +
                "pattern rather than deleting this assertion, because its whole job is to notice that a " +
                "number stopped being true.");
            var raw = m.Groups["n"].Value;
            return words.TryGetValue(raw, out var word) ? word : int.Parse(raw);
        }

        var readmeSays = SpelledCount(
            "README.md", @"There are \*\*(?<n>\w+)\*\* of them\s+today", "README §15.9's count sentence");
        var scriptSays = SpelledCount(
            Path.Combine("packaging", "remove-data.ps1"),
            @"goes on to create (?<n>\w+) directories under", "remove-data.ps1's .DESCRIPTION count");

        Assert.True(derived == readmeSays && derived == scriptSays,
            $"The product declares {derived} directories under %ProgramData%\\ST4I\\sim, README §15.9 says " +
            $"{readmeSays}, and packaging/remove-data.ps1 says {scriptSays}. Every place that spells this " +
            "number has to move together: README §15.4 (EN+VI), §15.9 (EN+VI table and rule sentence), " +
            "§24.6 (EN+VI), packaging/remove-data.ps1 (.DESCRIPTION, .EXAMPLE, .NOTES, the Step-2 comment), " +
            "web/playwright.config.ts and scripts/verify-suites.sh — plus a new -XxxDir parameter, a new " +
            "playwright env entry and a new row in §15.9's WRITES/READS table. This test exists because " +
            "four of those places were already off by one when it was written.");
    }

    /// <summary>
    /// 🔴 <b>The no-migration warning must exist where an OPERATOR reads, not only in a report.</b>
    ///
    /// <para>Blueprint §8.1's fourth census tier: a rule stated to a programmer and a rule stated to an
    /// operator are two different populations of text, and the second is the one where a missing sentence
    /// costs somebody an hour on shift. Relocating a root on a RUNNING deployment silently orphans that
    /// store's data — a host that can no longer read its own saved credential looks exactly like a host that
    /// was never onboarded — so silence about it is the worst available outcome, and F-1's brief says so in
    /// as many words.</para>
    ///
    /// <para>This asserts the CLAIM, not the prose: that §15.9 exists, that it says nothing is migrated, and
    /// that it names the credential consequence specifically. Deliberately loose about wording and
    /// deliberately strict about the three facts — a doc test that pins sentences rots on the first honest
    /// edit, and a doc test that pins nothing is decoration.</para>
    /// </summary>
    [Fact]
    public void TheReadme_TellsAnOperatorThatRelocatingARootDoesNotMigrateTheOldData()
    {
        var readme = File.ReadAllText(Path.Combine(MachineSimulatorRoot(), "README.md"));

        Assert.Matches(new Regex(@"###\s*15\.9\b", RegexOptions.None), readme);
        Assert.Contains("NOTHING IS MIGRATED", readme, StringComparison.Ordinal);
        Assert.Contains("KHÔNG CÓ DI TRÚ", readme, StringComparison.Ordinal);
        Assert.Contains("ST4I_CREDS_DIR", readme, StringComparison.Ordinal);

        // 🔴 Fix round 1 (review C-2). This used to require the phrase "not onboarded", which was the
        // consequence — and the section stated a REMEDY beside it ("until it claims again") that the very
        // host §15.9 configures cannot perform: `CredentialStore.Save` exists only in St4i.EngineApi's
        // onboarding service and in the WPF shell, and St4i.EdgeService's one credential call site is a Load.
        // What must not regress is therefore not the consequence but the ASYMMETRY, so that is what is
        // pinned: the section has to say that the edge agent cannot claim.
        // `[\s\S]` rather than `[^\n]`: this file is hard-wrapped at ~110 columns, so a sentence about one
        // subject routinely straddles a line break, and a same-line requirement would pin the WRAPPING.
        Assert.Matches(
            new Regex(@"St4i\.EdgeService[\s\S]{0,80}cannot claim", RegexOptions.IgnoreCase), readme);
        Assert.Matches(
            new Regex(@"St4i\.EdgeService[\s\S]{0,80}KHÔNG claim được", RegexOptions.None), readme);
    }
}
