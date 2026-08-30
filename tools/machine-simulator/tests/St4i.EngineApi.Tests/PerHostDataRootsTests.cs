using System.Globalization;
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
/// question and it fails the same way: a fourteenth <b>MACHINE-WIDE</b> store added without an
/// <c>ST4I_*_DIR</c> variable would be un-separable, two hosts would share it, and nothing anywhere would
/// say so. 🔴 <b>A fourteenth BESIDE-THE-BINARY store does NOT fail the same way</b>, and this was the one
/// paragraph in the file where the qualifier was still missing — the paragraph that introduces the file
/// (whole-branch review, Minor 8). That is what the fourth guard below exists for; see
/// <see cref="TheBesideTheBinaryStorePopulation_IsEmpty_AndTheMachineWideOnesAccountForEveryVariable"/>.</para>
///
/// <para>🔴 <b>The task brief that produced this file named FOUR stores. The enumeration found THIRTEEN, and
/// the brief's own instruction was to start from the SET rather than from its list</b> (blueprint §8.1: "not
/// in view" is the dangerous answer, not the safe one). The four it named all had the seam. So did the other
/// nine — but only one of the thirteen resolves its variable somewhere other than on the store itself, and
/// that asymmetry is recorded at the assertion below rather than in a report nobody re-reads.</para>
///
/// <para>🔴 <b>The SCOPE of "machine-wide", asked rather than assumed.</b> This scans for the
/// <c>%ProgramData%\ST4I\sim\&lt;name&gt;</c> constant, so it is blind by construction to anything the product
/// writes elsewhere. Enumerated, because "not in view" is the dangerous answer.</para>
///
/// <para>🔴 <b>AND THE FIRST VERSION OF THAT ENUMERATION WAS WRONG — corrected by H-1c, and the way it was
/// wrong is the reason this file now has a fourth guard.</b> It said the only place the product writes
/// outside <c>%ProgramData%</c> is <c>St4i.DesktopShell</c>'s
/// <c>%LOCALAPPDATA%\St4iMachineSimulator\{logs,WebView2}</c>. That was a false statement of COMPLETENESS,
/// and it had been in the tree since F-1: the product also writes THREE persistent stores BESIDE THE
/// BINARY (<c>MachineConfigStore</c>, <c>ProductConfigStore</c>, <c>SimulatedEcosystem</c> — see
/// <see cref="TheBesideTheBinaryStorePopulation_IsEmpty_AndTheMachineWideOnesAccountForEveryVariable"/>
/// for the enumeration, the exclusions and the instrument's own blind spots). The claim was written from
/// inside a <c>%ProgramData%</c>-shaped instrument and inherited that instrument's domain — blueprint
/// §8.1(f) — and its cost is the one §8.1 names as invisible by construction: a reader who believed it
/// stopped looking.</para>
///
/// <para>The <c>%LOCALAPPDATA%</c> half of the original sentence still stands and is still out of scope:
/// an engine log file and a WebView2 browser profile are PER-USER rather than machine-wide and are not
/// product data. Two service hosts under two accounts already have two of them; under one account they
/// would share, which is a defect only if either ever became a data store.</para>
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
    ///
    /// <para>📎 🔴 <b>THE PARAGRAPH ABOVE IS RETRACTED, 2026-08-25 (CD-1), kept verbatim and un-struck. It is
    /// the record of the exception, and the exception is closed.</b> <i>FALSE as of the owner's ruling of
    /// 2026-08-25 on item 72 (<c>"open the seam"</c>):</i> "One store resolves its variable somewhere other
    /// than on the store"; "those two types have no <c>EnvVarDir</c> and no <c>ResolveRoot</c> of their own,
    /// unlike their twelve siblings"; and the consequence sentence — "a host that constructs a historian store
    /// WITHOUT going through that composition root gets the machine-wide default with no env-var step".
    /// <see cref="St4i.EdgeCore.Historian.SqliteHistorianStore"/> and
    /// <see cref="St4i.EdgeCore.Historian.OeeSettingsStore"/> now carry the same triple as their siblings.
    /// <i>STILL TRUE and still load-bearing for THIS test's shape:</i> the scan looks for the LITERAL anywhere
    /// in <c>src/</c> rather than for a constant on a store type, which is what keeps it correct across BOTH
    /// forms; and <c>Program.cs</c> still reads the variable at the composition root and still WINS there, by
    /// <c>explicit &gt; env &gt; default</c>. The historian is no longer a thirteenth SHAPE, only a second
    /// reader of one name.</para>
    /// </summary>
    [Fact]
    public void EveryMachineWideDirectory_IsRelocatable_ByADerivableEnvVarName()
    {
        var directories = DeclaredDirectoryNames();
        var (machineWideVariables, besideBinaryVariables) = PartitionRelocationVariables();

        // Non-vacuity, both halves. An empty (or collapsed) set on either side must fail loudly rather than
        // pass by asserting over nothing.
        Assert.True(directories.Count >= 13,
            $"Only {directories.Count} data directory constant(s) were found in src/ " +
            $"({string.Join(", ", directories)}). The scan, not the product, is what broke — fix the scan " +
            "rather than deleting this assertion.");

        // 🔴 H-1c — this counts the MACHINE-WIDE half of the variable population, not the whole of it, and
        // that is the repair rather than a weakening. Before H-1c every ST4I_*_DIR literal in src/ named a
        // %ProgramData% store, so "thirteen directories, thirteen variables" was a true pairing and this
        // assertion measured it. ST4I_MACHINE_CONFIG_DIR relocates a BESIDE-THE-BINARY store, so counting
        // all literals here would silently turn thirteen into fourteen on the variable side of a pairing
        // whose directory side is still thirteen — the number would stop meaning what six artefacts say it
        // means, in the direction nobody intended. The second population gets its own guard below.
        //
        // 🔴 BF-1 (2026-08-23) — THE PARTITION IS UNCHANGED AND ITS SECOND HALF IS NOW EMPTY. The owner's
        // ruling moved all three beside-the-binary defaults under %ProgramData%\ST4I\sim, so every
        // ST4I_*_DIR literal in src/ is once again derivable from a declared directory and the pairing is
        // EIGHTEEN and EIGHTEEN. The partition is deliberately NOT deleted along with its last member: it is
        // what makes the emptiness a measurement instead of an assumption, and the guard below pins that
        // half at exactly zero for the reason an empty set always needs pinning — it satisfies every
        // universal claim made about it.
        Assert.True(machineWideVariables.Count >= 13,
            $"Only {machineWideVariables.Count} MACHINE-WIDE ST4I_*_DIR literal(s) were found in src/ " +
            $"({string.Join(", ", machineWideVariables)}); the beside-the-binary population held " +
            $"{besideBinaryVariables.Count} ({string.Join(", ", besideBinaryVariables)}). The scan, not " +
            "the product, is what broke.");

        // Controls, named explicitly: the credential-bearing stores plus the one whose variable is read at a
        // composition root rather than on the store. A scan that silently stopped matching any of these could
        // otherwise leave this test green.
        foreach (var mustFind in new[] { "creds", "identity", "connector-config", "notifications", "historian" })
        {
            Assert.Contains(mustFind, directories);
        }

        var missing = directories
            .Select(name => (Directory: name, Variable: DerivedVariableName(name)))
            .Where(pair => !machineWideVariables.Contains(pair.Variable))
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
        //
        // 📎 🔴 THE COMMENT ABOVE IS RETRACTED IN HALF, 2026-08-25 (CD-1), kept verbatim. FALSE as of the
        // owner's item-72 ruling: "ST4I_HISTORIAN_DIR is only ever read as a bare literal ... not on its
        // store". It is read BOTH ways now — the bare literal at Program.cs's composition root AND a
        // same-file constant on SqliteHistorianStore — so it is no longer a control for the literal FORM
        // specifically, only for the variable being recognised at all. ST4I_CREDS_DIR still carries the
        // same-file-constant form alone; the literal form's remaining sole carrier is ST4I_ASSETS_DIR /
        // ST4I_SERVER_URL-style reads in Program.cs, which this assertion does not name. STILL TRUE: both
        // assertions below hold, and neither had to move.
        Assert.Contains("ST4I_HISTORIAN_DIR", readVariables);
        Assert.Contains("ST4I_CREDS_DIR", readVariables);

        // 🔴 H-1c — this used to derive its subjects from the MACHINE-WIDE directory names, so a variable
        // belonging to the beside-the-binary population would have been declared, documented and never
        // checked. The property "a declared-but-unread variable is worse than no variable" does not care
        // which population the store is in, so the subject set is now EVERY declared literal. The count
        // floor above stays at 13 deliberately: it is a non-vacuity floor on the recogniser, not a census.
        var declaredButUnread = DeclaredRelocationVariables()
            .Where(variable => !readVariables.Contains(variable))
            .ToList();

        Assert.True(declaredButUnread.Count == 0,
            "These relocation variables are declared but never reach an Environment.GetEnvironmentVariable " +
            $"call, so setting them relocates nothing: {string.Join(", ", declaredButUnread)}. A directory " +
            "whose variable is declared and unread is WORSE than one that was never relocatable: README " +
            "§15.9 tells an operator to set it, the operator sets it, and the store keeps writing to its " +
            "old root with no error anywhere.");
    }

    /// <summary>The set of <c>%ProgramData%\ST4I\sim\&lt;name&gt;</c> leaves declared in <c>src/</c>, shared by
    /// every guard here so they can never disagree about which directories exist.</summary>
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

    /// <summary>The rule README §15.9 states to an operator, as a function: <c>ST4I_</c> + the directory
    /// name uppercased with <c>-</c> → <c>_</c> + <c>_DIR</c>.</summary>
    private static string DerivedVariableName(string directoryName) =>
        "ST4I_" + directoryName.ToUpperInvariant().Replace('-', '_') + "_DIR";

    /// <summary>Every <c>ST4I_*_DIR</c> literal declared anywhere in <c>src/</c>.</summary>
    private static SortedSet<string> DeclaredRelocationVariables()
    {
        var variables = new SortedSet<string>(StringComparer.Ordinal);
        var variableLiteral = new Regex("\"(?<name>ST4I_[A-Z0-9_]*_DIR)\"");

        foreach (var file in ProductSources())
        {
            foreach (Match m in variableLiteral.Matches(File.ReadAllText(file)))
            {
                variables.Add(m.Groups["name"].Value);
            }
        }

        return variables;
    }

    /// <summary>🔴 <b>Fix round 2 (re-review N1) — the KNOWN ROUTES to the beside-the-binary root.</b>
    /// The instrument's domain is this set, not a single token, because the re-review found two routes the
    /// single-token version could not see: <c>Environment.ProcessPath</c> (live, two occurrences in
    /// <c>src/</c>) and the <c>public static</c> helper H-1c itself added, through which a new store can
    /// reach the root without ever naming <see cref="AppContext.BaseDirectory"/>. Adding an idiom here is
    /// how a newly-discovered route gets swept; the guard's own remarks say what a text scan can never
    /// close.
    ///
    /// <para>🔴 <b>BF-1 swapped two idioms for three, and the swap is not cosmetic.</b>
    /// <c>MachineConfigStore.DefaultRoot</c>/<c>ResolveRoot</c> stopped being routes to the beside-the-binary
    /// root on 2026-08-23: that store's default is now <c>%ProgramData%\ST4I\sim\machine-config</c>, so a
    /// caller reaching the root through them would reach the WRONG root and the idiom would sweep files that
    /// have nothing to do with this population. The three <c>LegacyRoot</c> helpers replace them — they are
    /// what each store now calls the pre-BF-1 root, they are <c>public static</c> in exactly the shape that
    /// made the old pair worth sweeping, and they are the ONLY thing in <c>src/</c> that still resolves
    /// beside the binary on purpose.</para></summary>
    private static readonly string[] BesideBinaryRootIdioms =
    [
        "AppContext.BaseDirectory",
        "Environment.ProcessPath",
        "MachineConfigStore.LegacyRoot",
        "ProductConfigStore.LegacyRoot",
        "SimulatedEcosystem.LegacyRoot",
    ];

    /// <summary>🔴 <b>H-1c — the two populations, split by the one property that actually separates them:
    /// whether the variable's name is derivable from a declared
    /// <c>%ProgramData%\ST4I\sim\&lt;name&gt;</c> directory.</b>
    ///
    /// <para>Both halves are derived from <c>src/</c>; neither is a list. A machine-wide store's variable
    /// is derivable BY CONSTRUCTION — that is the rule §15.9 tells an operator and the rule
    /// <see cref="EveryMachineWideDirectory_IsRelocatable_ByADerivableEnvVarName"/> asserts — so anything
    /// left over relocates something that is not machine-wide, and belongs to the second population by the
    /// same measurement rather than by anyone's say-so.</para></summary>
    private static (SortedSet<string> MachineWide, SortedSet<string> BesideBinary) PartitionRelocationVariables()
    {
        var derivable = new HashSet<string>(DeclaredDirectoryNames().Select(DerivedVariableName), StringComparer.Ordinal);
        var machineWide = new SortedSet<string>(StringComparer.Ordinal);
        var besideBinary = new SortedSet<string>(StringComparer.Ordinal);

        foreach (var variable in DeclaredRelocationVariables())
        {
            (derivable.Contains(variable) ? machineWide : besideBinary).Add(variable);
        }

        return (machineWide, besideBinary);
    }

    /// <summary>
    /// 🔴 <b>Branch review F-15 — the COUNT is now derived and compared, because the <c>&gt;= 13</c>
    /// assertions in the two guards above this one are FLOORS, and a floor cannot notice a fourteenth
    /// MACHINE-WIDE store arriving; it would arrive silently while the word "thirteen" rots in six
    /// places.</b>
    /// (🔴 Fix round 3, whole-branch review Minor 9: the round-2 replacement for the garbled original said
    /// "the three guards above it in THIS FILE" — <b>TWO</b> guards are above it, carrying three
    /// <c>&gt;= 13</c> assertions between them. A wrong summary replaced by a differently wrong summary,
    /// in the edit that named the class. Counted this time, and phrased so the number that matters is the
    /// ASSERTIONS rather than an ordinal position that moves whenever a test is added.)
    /// (🔴 Fix round 2: this sentence was garbled — "because every census in this / three guards in THIS
    /// FILE floor at &gt;= 13" had a dropped clause, present since <c>19cf8407</c> (re-review N7) — and its
    /// ordinal was unqualified while the detail sentence below had been qualified in the round before
    /// (N5). A summary contradicting the list it summarises, for the third time on this branch, which is
    /// why both halves are fixed in one edit rather than one.)
    ///
    /// <para>🔴 <b>WHAT THIS TEST REACHES — said because the first version of this paragraph overstated it
    /// (branch re-review, N-2).</b> It claimed "this test would have caught all four" of the FOURTEEN
    /// defects the branch review found. It would not. It opens exactly two files besides <c>src/</c>:
    /// <c>README.md</c> and <c>packaging/remove-data.ps1</c>, and never <c>web/playwright.config.ts</c> or
    /// <c>scripts/verify-suites.sh</c> — where those four lived. At the commit where all four were present
    /// the derived count was 13, both rule sentences said thirteen, every compared value agreed, and this
    /// test would have been <b>green with all four defects in the tree</b>. What it actually does: it fires
    /// the moment <c>src/</c> and those two rule sentences diverge, and its failure message then names the
    /// remaining artefacts for a human to walk. The overstatement is recorded rather than quietly deleted,
    /// because it was a claim in the VOICE OF A MEASUREMENT about the reach of the instrument built to end
    /// exactly that class.</para>
    ///
    /// <para><b>Why this check and not a grep for "every"/"all"/"no arm" — and the first answer given here
    /// was the wrong one.</b> That answer was: a quantifier grep cannot decide whether a universal is TRUE,
    /// so it answers a narrower question than the criterion. <b>That reasoning disqualifies this test too</b>
    /// — a count does not decide whether "thirteen" is true either, only whether three artefacts AGREE. An
    /// instrument that answers a narrower question is a defect only when it is REPORTED as answering the
    /// criterion, which is what F-8 was; the remedy this branch adopted everywhere else is to state the
    /// narrow quantity, not to refuse to measure. <b>The real reason is RECALL.</b> The grep keys on
    /// quantifier WORDS, and this branch's worst false universal used none: "two uncoordinated frame sources
    /// on one segment do not corrupt data" is a universal by generic plural, and so was its replacement. It
    /// would have flagged only the historical "every assertion …"/"no arm computes …" pair, a sub-class the
    /// prose trigger in <c>PerHostDataRootIsolationTests</c> already covers — bounded yield, against a count
    /// check whose class has produced four real defects in one branch.</para>
    ///
    /// <para><b>What it compares:</b> the number derived from <c>src/</c> against the number SPELLED in the
    /// two sentences that state it as a rule — README §15.9's "There are **N** of them today" and
    /// <c>packaging/remove-data.ps1</c>'s ".DESCRIPTION … create N directories". Those two were chosen
    /// because each is the authoritative sentence of its own artefact; the remaining prose repeats them. A
    /// fourteenth MACHINE-WIDE store makes the derived number 14 and turns both comparisons red, with a
    /// message naming
    /// every place the word has to move.</para>
    ///
    /// <para>📎 🔴 <b>THE PARAGRAPH ABOVE IS RETRACTED, 2026-08-30, KEPT VERBATIM — it says TWO sentences,
    /// and TWO is what made this test state a requirement it could not check</b> (whole-branch review of
    /// WS-HMI-0a, Important 1). Both sentences it named are ENGLISH. The failure message below has always
    /// named "README §15.9 (EN+VI table and rule sentence), §24.6 (EN+VI)" among the places the number must
    /// move — <b>a requirement in the message that was absent from the measurement</b>. WS-HMI-0a walked
    /// straight through the gap: the branch moved the count 16 → 18 in English, left the Vietnamese halves
    /// of §15.9's rule sentence and §24.6 reading <i>mười sáu</i>, and this test stayed green while the two
    /// language halves of one sentence contradicted each other and a Vietnamese-reading operator was told
    /// sixteen. Fixing only the words would have left the same hole open for the next author.</para>
    ///
    /// <para><b>SEVEN sentences are now compared, not two</b> — README §15.9 EN + VI rule sentences, README
    /// §24.6 EN + VI, README §15.4 EN + VI, and <c>packaging/remove-data.ps1</c>'s <c>.DESCRIPTION</c>.
    /// Each pattern must match <b>EXACTLY ONCE among LIVE text</b>, not merely at least once: this tree's
    /// retract-in-place convention leaves superseded numbers sitting verbatim inside quoted 🔴 blocks, so a
    /// first-match-wins scan would happily read <i>mười ba</i> out of a 2026-08-23 retraction and call it
    /// today's count. Matches that begin immediately after a <c>"</c> are treated as quoted retractions
    /// and discarded; an ambiguous parse among what remains is reported as a broken SCAN, which is what it
    /// is. A verbatim retraction written WITHOUT quotation marks would still read as live — the honest
    /// ceiling of a text scan, stated at the code rather than left to be discovered.</para>
    ///
    /// <para>🔴 <b>WHAT IS STILL NOT CHECKED, stated instead of implied — this is the half of Important 1
    /// that cannot be closed by adding a pattern.</b> The failure message also names
    /// <c>packaging/remove-data.ps1</c>'s <c>.EXAMPLE</c>/<c>.NOTES</c>/Step-2 comment,
    /// <c>web/playwright.config.ts</c>, <c>scripts/verify-suites.sh</c>, and §15.9's WRITES/READS table
    /// rows. Those state the number in running commentary, in retracted-and-kept blocks, and in tables
    /// whose row count is the fact — there is no single sentence per artefact to anchor on, and a scan that
    /// guessed would produce false reds that get it deleted. They are named as <b>UNCHECKED prose</b> in
    /// the message now, not as requirements this test enforces. The distinction is the whole point of the
    /// finding: an instrument may measure less than the criterion, but it must not be REPORTED as measuring
    /// the criterion.</para>
    ///
    /// <para><b>AND A CONSTRAINT ON FUTURE EDITS, because exactly-once has a cost:</b> when this number
    /// moves again, edit each live sentence <b>in place</b> and quote the old one inside a dated 🔴 block —
    /// do not append a second live sentence carrying the same anchor phrase. Two live sentences with one
    /// anchor make the scan ambiguous and this test red with "found 2". That is the repository's
    /// retract-in-place convention anyway; it is written down here because this test now depends on
    /// it.</para>
    /// </summary>
    [Fact]
    public void TheNumberOfMachineWideDirectories_IsDerivedFromSource_AndAgreesWithEveryPlaceThatSpellsIt()
    {
        var derived = DeclaredDirectoryNames().Count;

        // Non-vacuity: the scan must find a plausible set before its count is compared to anything.
        Assert.InRange(derived, 13, 40);

        // 🔴 Whole-branch review of WS-HMI-0a, Minor 1: the map used to stop at "seventeen", so an author
        // who wrote the WORD form of the new count got a FormatException stack trace out of int.Parse
        // instead of this test's own message — the message being the entire reason the test is worth
        // having. Extended past the current count with headroom, and the fall-through below now fails with
        // a sentence rather than an exception, so the next word past the end is a repair instruction too.
        //
        // 🔴 And the VIETNAMESE numerals, which is Important 1: the mirrors below spell the count in words
        // in both languages. Keyed OrdinalIgnoreCase and looked up after ToLowerInvariant, because §15.4's
        // VI sentence shouts its count in capitals (MƯỜI TÁM) while §15.9's writes it lowercase.
        var words = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)
        {
            ["eleven"] = 11, ["twelve"] = 12, ["thirteen"] = 13, ["fourteen"] = 14,
            ["fifteen"] = 15, ["sixteen"] = 16, ["seventeen"] = 17,
            ["eighteen"] = 18, ["nineteen"] = 19, ["twenty"] = 20, ["twenty-one"] = 21,

            ["mười một"] = 11, ["mười hai"] = 12, ["mười ba"] = 13, ["mười bốn"] = 14,
            ["mười lăm"] = 15, ["mười sáu"] = 16, ["mười bảy"] = 17, ["mười tám"] = 18,
            ["mười chín"] = 19, ["hai mươi"] = 20, ["hai mươi mốt"] = 21,
        };

        // README.md is hard-wrapped at ~110 columns, so a two-word Vietnamese numeral can straddle a line
        // break. Collapse runs of whitespace before the lookup so the pattern does not pin the WRAPPING —
        // the same reasoning TheReadme_TellsAnOperator… gives for using [\s\S] rather than [^\n].
        static string Collapse(string s) => Regex.Replace(s, @"\s+", " ").Trim();

        int SpelledCount(string relativePath, string pattern, string what)
        {
            // core.autocrlf=true on this repository. The patterns below use \s+ rather than anchors so a
            // \r would not break them, but normalising costs nothing and this tree has been bitten twice.
            var text = File.ReadAllText(Path.Combine(MachineSimulatorRoot(), relativePath))
                           .Replace("\r\n", "\n", StringComparison.Ordinal);

            var matches = Regex.Matches(text, pattern, RegexOptions.IgnoreCase | RegexOptions.Singleline);

            // 🔴 A match that begins immediately after a quotation mark is RETRACTED TEXT, quoted verbatim
            // — this repository's §5 convention for a superseded sentence, and the reason a naive
            // first-match-wins scan can read "mười ba" out of a 2026-08-23 block and call it today's
            // count. Those are dropped here rather than pattern-dodged, because the whole point of
            // retract-in-place is that the old sentence stays REPRODUCED WORD FOR WORD; a pattern crafted
            // to miss it would have to be re-crafted every time a sentence is retracted.
            //
            // WHAT THIS DOES NOT DECIDE, said rather than implied: a verbatim retraction written WITHOUT
            // the quotation marks this repository wraps them in reads as live text to any scan, including
            // this one. That is the honest ceiling here, and it is why the quoting convention is
            // load-bearing rather than decorative.
            var live = matches.Where(m => m.Index == 0 || text[m.Index - 1] != '"').ToList();

            // EXACTLY ONE live match, not at-least-one: two live sentences with one anchor means the scan
            // cannot tell which one states the rule, and guessing is how the number it reads stops being
            // the number a reader reads.
            Assert.True(live.Count == 1,
                $"Expected EXACTLY ONE live {what} in {relativePath}; found {live.Count} " +
                $"({matches.Count} total, {matches.Count - live.Count} discarded as quoted retractions)" +
                (matches.Count > 0
                    ? ": " + string.Join(" · ", matches.Select(m =>
                        (m.Index > 0 && text[m.Index - 1] == '"' ? "[quoted] " : "[live] ") + Collapse(m.Value)))
                    : string.Empty) +
                ". The SCAN broke, not the product — repair the pattern rather than deleting this " +
                "assertion, because its whole job is to notice that a number stopped being true. If the " +
                "count just moved: edit the LIVE sentence in place and quote the old one in a dated 🔴 " +
                "block; appending a second UNQUOTED sentence with the same anchor phrase is what produces " +
                "\"found 2\" here.");

            var raw = Collapse(live[0].Groups["n"].Value);
            if (words.TryGetValue(raw, out var word)) return word;
            if (int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var digits)) return digits;

            Assert.Fail(
                $"{what} in {relativePath} spells its count as \"{raw}\", which is neither a digit form nor " +
                "a word this test's vocabulary knows. Add it to the `words` map above — that map exists so " +
                "an author who writes the word form gets THIS sentence instead of a FormatException stack " +
                "trace, and a map that stops one short of the current count is the defect it was built to " +
                "prevent (whole-branch review, Minor 1).");
            return -1;
        }

        // 🔴 SEVEN sentences, not two — see this method's doc comment for why two was the defect. Every
        // entry here is a LIVE rule sentence, deliberately anchored on surrounding words rather than on a
        // date, so a count change is a one-token edit rather than a pattern rewrite. EN and VI sit next to
        // each other on purpose: the two halves of one sentence are what drifted apart, so they are read
        // by one instrument in one pass.
        var spelled = new (string Where, int Value)[]
        {
            ("README §15.9 rule sentence (EN)", SpelledCount(
                "README.md",
                @"There are \*\*(?<n>[\p{L}\d-]+)\*\* of them\s+today",
                "README §15.9's EN count sentence")),

            ("README §15.9 rule sentence (VI)", SpelledCount(
                "README.md",
                @"Hôm nay có\s+\*\*(?<n>[\p{L}\s]+?)\*\*\s+thư mục, \*\*không có ngoại lệ",
                "README §15.9's VI count sentence")),

            ("README §24.6 (EN)", SpelledCount(
                "README.md",
                @"every one of the \*\*(?<n>[\p{L}\d-]+)\*\*",
                "README §24.6's EN count clause")),

            ("README §24.6 (VI)", SpelledCount(
                "README.md",
                @"cả \*\*(?<n>[\p{L}\s]+?)\*\* thư mục \*\*toàn máy\*\*",
                "README §24.6's VI count clause")),

            ("README §15.4 (EN)", SpelledCount(
                "README.md",
                @"engine declares \*\*(?<n>[\p{L}\d-]+)\*\*\s+directories there",
                "README §15.4's EN count sentence")),

            ("README §15.4 (VI)", SpelledCount(
                "README.md",
                @"engine KHAI (?<n>[\p{L}\s]+?) thư mục",
                "README §15.4's VI count sentence")),

            ("packaging/remove-data.ps1 .DESCRIPTION", SpelledCount(
                Path.Combine("packaging", "remove-data.ps1"),
                @"declares (?<n>[\p{L}\d-]+) directories under",
                "remove-data.ps1's .DESCRIPTION count")),
        };

        var disagreeing = spelled.Where(s => s.Value != derived).ToList();

        Assert.True(disagreeing.Count == 0,
            $"The product declares {derived} directories under %ProgramData%\\ST4I\\sim, but " +
            string.Join("; ", disagreeing.Select(d => $"{d.Where} says {d.Value}")) + ". " +
            "CHECKED BY THIS TEST, all seven and both languages: " +
            string.Join(", ", spelled.Select(s => s.Where)) + ". " +
            "🔴 NOT CHECKED BY THIS TEST, and named as prose rather than as a requirement it enforces " +
            "(whole-branch review, Important 1 — a message must not state a requirement the measurement " +
            "does not make): §15.9's WRITES/READS table rows, packaging/remove-data.ps1's .EXAMPLE / " +
            ".NOTES / Step-2 comment, web/playwright.config.ts's running commentary, and " +
            "scripts/verify-suites.sh — plus a new -XxxDir parameter, a new playwright env entry and a new " +
            "row in §15.9's WRITES/READS table, none of which is a countable sentence. Walk those by hand. " +
            "🔴 THAT LIST WAS NOT THE WHOLE RESIDUE, and saying so was this message's own instance of the " +
            "defect it polices (fix-wave re-review, N-2). Eleven further LIVE 'sixteen' assertions survived " +
            "the sweep, measured at c0cece8b in eight files none of which is named above. 🔴 ALL ELEVEN ARE " +
            "CLOSED as of WS-HMI-0b Task 4 (2026-08-31), the owner having assigned that debt to 0b rather " +
            "than parking it further — so this message no longer lists them, because a 'still stale' list " +
            "that is no longer true is the same defect one generation on, which is exactly what this " +
            "message exists to police. What the closure had to respect, recorded because it is the reusable " +
            "part: 'sixteen' is NOT one fact in this tree. It is the DECLARED-directory count in those " +
            "eleven places, the PURGE count (18 minus the two the owner's 2026-08-23(b) ruling keeps) in " +
            "remove-data.ps1's .SYNOPSIS/.PARAMETER/parameter-block prose, and a count of unrelated " +
            "artefacts in TestHarnessIsolationTests.cs:64 — so a find-and-replace corrupts two of those " +
            "three. The eleven line numbers above were the authority, not the word. Anyone moving 18→19 " +
            "must still walk the by-hand list named earlier in this message. " +
            "This test exists because four of those places were already off by one when it was written, " +
            "and it was extended because the Vietnamese half of two of them was off by two afterwards.");
    }

    /// <summary>
    /// 🔴 <b>H-1c — THE SECOND POPULATION: stores the product writes BESIDE THE BINARY. This exists because
    /// the guards above are an instrument built for a different question, and pointing them at a
    /// beside-the-binary store is blueprint §8.1(f) in its purest form.</b>
    ///
    /// <para><b>The two populations, and why the distinction is not pedantry.</b> The thirteen
    /// <c>%ProgramData%\ST4I\sim\&lt;name&gt;</c> directories are relocatable BY MECHANISM: an operator sets
    /// a derivable variable and gets their own root, which is how two hosts on one machine stop overwriting
    /// each other. The three stores enumerated below default to <see cref="AppContext.BaseDirectory"/>, and
    /// there the isolation between two hosts is <b>ACCIDENTAL</b> — it holds only because two installs
    /// happen to sit in two directories. <b>Two hosts launched from ONE install directory share every one
    /// of these files.</b> That is the same distinction E-5 had to draw for COM ports, and it is labelled
    /// here, in README §15.9, and at each store, because a resource that is separate today only because
    /// nothing has asked it to be shared is not an isolated resource.</para>
    ///
    /// <para><b>THE MEMBERS — enumerated from the tree, not from the three names a brief supplied.</b>
    /// Starting from the property ("a store that PERSISTS product data to a default root that is not
    /// machine-wide") rather than from a name: <c>MachineConfigStore</c>
    /// (<c>machine-operating-config.json</c>), <c>ProductConfigStore</c> (<c>products.json</c> +
    /// <c>recipes.json</c>) and <c>SimulatedEcosystem</c> (<c>ecosystem/ecosystem-products.json</c> +
    /// <c>ecosystem/ecosystem-recipes.json</c>). <b>THREE.</b> <c>FleetConfig</c> — which
    /// <c>MachineConfigStore</c>'s own doc comment named as a sibling of the same shape — is NOT one: it is
    /// a static class with a single <c>Load</c> and no writer anywhere, so it is a read-only artefact and
    /// counting it would have inflated the population by taking a doc comment's word for a measurement.</para>
    ///
    /// <para><b>What is deliberately NOT in it, said because "not in view" is the dangerous answer.</b>
    /// (1) <c>fleet.json</c>, <c>connectors.json</c> and <c>mapping/*.json</c> sit beside the binary and are
    /// shared by accident in exactly the same way — but the product only ever READS them; they are operator
    /// input, not state the product accumulates, so a shared copy is the intent rather than the defect.
    /// (2) <c>wwwroot</c>, which <c>Program.cs</c> creates beside the binary, holds the packaged web UI and
    /// no data. (3) <c>HotFolderAoiDriver</c>/<c>Doc28Writer</c> write to caller-supplied paths with no
    /// default at all, so there is nothing to relocate.
    /// (4) <c>St4i.DesktopShell</c>'s <c>%LOCALAPPDATA%</c> log + WebView2 folders are per-USER, already
    /// excluded by this file's own class remarks for that reason.</para>
    ///
    /// <para>🔴 <b>THE INSTRUMENT — and fix round 1 rebuilt it, because the first version recommitted
    /// §8.1(f) INSIDE the guard written to repair §8.1(f).</b> That version scanned for
    /// <c>AppContext.BaseDirectory</c> <b>∩</b> <c>Directory.CreateDirectory(</c>, and its blind-spot
    /// paragraph enumerated blind spots on the PATH half only — never naming the second conjunct as a
    /// filter at all. It is the conjunct that actually excludes: <c>AppContext.BaseDirectory</c>
    /// <b>always exists</b>, so a store written as
    /// <c>File.WriteAllText(Path.Combine(AppContext.BaseDirectory, "foo.json"), …)</c> has no reason to
    /// call <c>Directory.CreateDirectory</c> at all. Such a store is a full member of population two and
    /// was invisible — arriving silently, which is the exact failure the test claimed to prevent. That the
    /// three current members all happen to create a directory in their constructors is a property of where
    /// the author was standing, not of the question. (Branch review, Important 1.)</para>
    ///
    /// <para><b>The conjunct is gone, and fix round 2 widened the domain from one token to the SET OF
    /// KNOWN ROUTES.</b> The scan is every <c>*.cs</c> under <c>src/</c> that mentions any idiom in
    /// <see cref="BesideBinaryRootIdioms"/>, pinned as an exact map of repo-relative path to CATEGORY. A
    /// new store that composes a path from the base directory fails this test whether or not it creates
    /// anything.</para>
    ///
    /// <para>🔴 <b>WHY THE DOMAIN GREW — the re-review answered a question this paragraph asked and got
    /// it wrong twice (N1).</b> Fix round 1 listed four alternative routes and called them all zero-hit,
    /// then staked its own completeness ("if this paragraph is ever incomplete again, that is the bug").
    /// It was incomplete twice over:
    /// <list type="number">
    /// <item><b><c>Environment.ProcessPath</c> was missing and is NOT zero-hit</b> — two live occurrences
    /// in <c>St4i.EngineApi/ServiceHost/ServiceInstallVerbs.cs</c>.
    /// <c>Path.GetDirectoryName(Environment.ProcessPath)</c> is the same directory as
    /// <see cref="AppContext.BaseDirectory"/> for every host here, and the file was not pinned.</item>
    /// <item><b>Cross-file indirection, which H-1c itself created.</b>
    /// <c>MachineConfigStore.DefaultRoot()</c>/<c>ResolveRoot()</c> are <c>public static</c> and return
    /// the beside-binary root, so a new store written the way a maintainer would copy the local pattern
    /// never names the token at all. The pin is per FILE, and the pinned files include the helper —
    /// which is exactly why reaching the root THROUGH one of them was invisible.</item>
    /// </list>
    /// Both are now idioms in the set, so both enter the pin. Neither was a live defect; what made it
    /// worth the change is that a completeness claim makes a reader stop checking, which is the harm
    /// §8.1 calls invisible by construction.</para>
    ///
    /// <para>🔴 <b>AND THIS PARAGRAPH NO LONGER STAKES COMPLETENESS, because it cannot honestly.</b> The
    /// domain is a set of TOKENS, and "every way to name a directory" is not a set a text scan can close.
    /// What is claimed is narrower and is a measurement: these are the routes that have been SWEPT, and
    /// the sweep is re-runnable. Measured this round —
    /// <c>Directory.GetCurrentDirectory</c>, <c>Environment.CurrentDirectory</c>,
    /// <c>AppDomain.CurrentDomain.BaseDirectory</c>, <c>Assembly.Location</c>,
    /// <c>Process.GetCurrentProcess().MainModule</c> and <c>AppContext.GetData</c> are all genuinely
    /// ZERO in <c>src/</c>; <c>Assembly.GetEntryAssembly</c> has one hit
    /// (<c>CapabilitiesEndpoints.cs</c>) and is not a root route — it reads the assembly's VERSION. A
    /// seventh idiom nobody has thought of is still invisible, and that sentence is the honest ceiling
    /// of a text scan.</para>
    ///
    /// <para>🔴 <b>THE CATEGORY IS ENFORCED, not merely written down (N2) — but on the axis a scan can
    /// actually decide.</b> The re-review proposed asserting that <c>prose only</c> entries contain no
    /// write call and no <c>Path.Combine(AppContext.BaseDirectory</c>. <b>That check fails against this
    /// tree</b>: <c>ConnectorsJsonRegistration.cs:45</c> quotes
    /// <c>Path.Combine(AppContext.BaseDirectory, "connectors.json")</c> VERBATIM inside a <c>///</c> line
    /// while being genuinely prose-only. A text scan cannot tell a quoted expression from a live one — so
    /// the property asserted here is the one it CAN decide: <b>a <c>prose only</c> entry has every idiom
    /// occurrence on a <c>///</c> line, and every other category has at least one occurrence that is
    /// NOT.</b> That cannot be satisfied by pasting a path with a plausible comment; it would take moving
    /// real code into a doc comment. <b>What it still does NOT decide, said plainly: code is code.</b>
    /// The store / read-only / not-a-store split among the non-prose entries is a HUMAN classification
    /// and this test cannot check it — a store mislabelled "reads only" passes. That distinction is
    /// carried by the per-entry comment and by whoever reviews the diff that adds one.</para>
    ///
    /// <para><b>Repo-relative paths, not base names</b> (branch review, Minor 3): <c>src/</c> contains two
    /// <c>Program.cs</c>. Keyed on <see cref="Path.GetFileName(string)"/>, EdgeService's entering the set
    /// while EngineApi's left it would have kept this green over a changed population.</para>
    ///
    /// <para>🔴 <b>RENAMED 2026-08-30 — the count came OUT of the name</b> (whole-branch review of
    /// WS-HMI-0a, Minor 2). It read <c>…AndTheSixteenMachineWideOnes…</c>, and WS-HMI-0a made sixteen
    /// false while the test stayed green, because <b>a name is not an assertion</b> and nothing can catch a
    /// stale one. The count IS asserted, one line into the body:
    /// <c>Assert.Equal(DeclaredDirectoryNames().Count, machineWide.Count)</c> — derived from <c>src/</c>,
    /// so it moves by itself. Putting a number in a method name duplicates a fact that already has a
    /// measurement, and the duplicate is the copy that rots. Previous names are recorded in
    /// <c>scripts/verify-suites.sh</c>'s rename ledger.</para>
    /// </summary>
    [Fact]
    public void TheBesideTheBinaryStorePopulation_IsEmpty_AndTheMachineWideOnesAccountForEveryVariable()
    {
        // The variable side first: whatever is NOT derivable from a machine-wide directory relocates
        // something that is not machine-wide, so the partition itself is the classification.
        var (machineWide, besideBinary) = PartitionRelocationVariables();

        Assert.Equal(DeclaredDirectoryNames().Count, machineWide.Count);

        // 🔴 BF-1 — population two's VARIABLE side is now EMPTY, and an empty set satisfies every universal
        // claim anyone might make about it, so it is pinned at exactly zero rather than merely quantified
        // over. A store that re-acquires a beside-the-binary default with a non-derivable variable lands
        // here and reddens; before BF-1 the same line pinned the single member ST4I_MACHINE_CONFIG_DIR,
        // whose literal did not change — only the directory it is now derivable FROM came into existence.
        Assert.Equal(Array.Empty<string>(), besideBinary.ToArray());

        // The store side: every file naming any KNOWN ROUTE to the beside-the-binary root, mapped to its
        // category. See the remarks for why the domain is a set of idioms and what the category check
        // can and cannot decide.
        const string Migration =
            "MIGRATION SOURCE — names the pre-BF-1 beside-the-binary root to COPY from it once; its own " +
            "default root is machine-wide";
        const string ReadOnly = "READS ONLY — operator-authored input beside the binary; a shared copy is the intent";
        const string NotAStore = "NOT A DATA STORE";
        const string Prose = "PROSE ONLY — names a root in a doc comment, resolves nothing";

        var expected = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            // 🔴 These three were category "POPULATION TWO — persists product data, default root beside the
            // binary" until 2026-08-23. They still NAME the beside-the-binary root, in LegacyRoot(), which
            // is why they are still in this map — but they name it as the SOURCE of a one-time copy, not as
            // a place they write. Re-categorised rather than deleted, so the day one of them starts
            // resolving that root again the entry is here to be re-read instead of re-invented.
            ["src/St4i.EdgeCore/Config/MachineConfigStore.cs"] = Migration,   // machine-operating-config.json
            ["src/St4i.EdgeCore/Config/ProductConfigStore.cs"] = Migration,   // products.json + recipes.json
            ["src/St4i.EngineApi/Config/SimulatedEcosystem.cs"] = Migration,  // ecosystem-{products,recipes}.json

            ["src/St4i.EdgeCore/Fleet/FleetCore.cs"] = ReadOnly,              // fleet.json + mapping/*.json
            ["src/St4i.EdgeService/EdgeConnectors.cs"] = ReadOnly,            // connectors.json
            ["src/St4iMachineSimulator/Services/FleetService.cs"] = ReadOnly, // fleet.json

            ["src/St4i.DesktopShell/MainWindow.xaml.cs"] = NotAStore,         // engine exe path; its writes are per-USER %LOCALAPPDATA%
            ["src/St4i.EngineApi/Program.cs"] = NotAStore,                    // connectors.json read + wwwroot (packaged web UI)
            ["src/St4i.EngineApi/ServiceHost/ServiceInstallVerbs.cs"] = NotAStore, // Environment.ProcessPath -> the service binPath for sc.exe
            ["src/St4iMachineSimulator/App.xaml.cs"] = NotAStore,             // --capture output dir (CLI arg) + a %TEMP% selftest file

            // 🔴 BF-1 — the migration helper itself names the legacy root only to EXPLAIN why its callers
            // must gate on it; it takes both roots as parameters and resolves neither. Prose, and the
            // category check enforces that: the day it starts composing a path from the base directory,
            // every occurrence stops being on a `///` line and this entry goes red.
            ["src/St4i.EdgeCore/Config/LegacyRootMigration.cs"] = Prose,
            ["src/St4i.EdgeCore/Engine/EdgeAgentPipelines.cs"] = Prose,
            ["src/St4i.EdgeCore/Mapping/MappingProfileResolver.cs"] = Prose,
            ["src/St4i.EngineApi/Config/ConnectorsJsonRegistration.cs"] = Prose,
        };

        var root = MachineSimulatorRoot();
        var found = new SortedDictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var file in ProductSources())
        {
            var lines = File.ReadAllLines(file);
            var hits = lines.Where(line => BesideBinaryRootIdioms.Any(t => line.Contains(t, StringComparison.Ordinal))).ToList();
            if (hits.Count > 0) found[Path.GetRelativePath(root, file).Replace('\\', '/')] = hits;
        }

        // Set equality first, so a new arrival names itself rather than failing on a category mismatch.
        Assert.Equal(
            expected.Keys.OrderBy(k => k, StringComparer.Ordinal).ToArray(),
            found.Keys.ToArray());

        // 🔴 N2 — the CATEGORY is checked on the one axis a text scan can decide: is the idiom in code, or
        // only in a `///` line? A `prose only` entry must have EVERY occurrence in a doc comment; every
        // other category must have at least one that is not. This cannot be satisfied by pasting a path
        // with a plausible comment. It deliberately does NOT try to tell a store from a read — both are
        // code, that split is a human judgement, and the remarks say so rather than implying otherwise.
        static bool IsDocComment(string line) => line.TrimStart().StartsWith("///", StringComparison.Ordinal);

        foreach (var (path, hits) in found)
        {
            var category = expected[path];
            if (category == Prose)
            {
                var code = hits.Where(h => !IsDocComment(h)).Select(h => h.Trim()).ToList();
                Assert.True(code.Count == 0,
                    $"{path} is categorised \"{Prose}\" but names a beside-the-binary root in CODE: " +
                    $"{string.Join(" | ", code)}. Either it resolves a root — in which case classify it as a " +
                    "store, a read, or a non-store and say which — or the scan broke.");
            }
            else
            {
                Assert.True(hits.Any(h => !IsDocComment(h)),
                    $"{path} is categorised \"{category}\" but every occurrence is in a `///` line, so it " +
                    "resolves nothing. Re-categorise it as prose only, or the classification is stale.");
            }
        }
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
