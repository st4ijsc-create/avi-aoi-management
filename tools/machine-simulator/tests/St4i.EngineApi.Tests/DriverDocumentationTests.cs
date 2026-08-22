using System.Globalization;
using System.Text.RegularExpressions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers.Modbus;
using St4i.EdgeCore.Drivers.OpcUa;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// 🔴 <b>Task AX-1 (owner-decisions.md item 36) — README §16.4 and §16.6 were the THIRD hand-kept copy of
/// two option classes and two map parsers, and the source itself said so.</b> <c>ModbusOptions</c>' class
/// doc comment carried the sentence <i>"The README tables remain a hand-kept copy with no witness: nothing
/// goes red if they drift, and that is still true."</i> The other two copies that same paragraph named —
/// <c>ConnectorEndpointsTests</c> and <c>ConnectorEndpointsEnvSeedingSideEffectsTests</c> — had already been
/// given a COMPILATION witness by being made to call the constants by name. The README was left out on
/// purpose. This file is the witness it was left out of, and that sentence is now retracted at the place it
/// was written.
///
/// <para><b>It was not a hypothetical risk, and that is measured rather than argued.</b> Building this
/// instrument found TWO already-drifted published claims, both retracted in place with a date:
/// <list type="number">
///   <item>§16.6 called the endpoint-selection bound <i>"hardcoded 15 seconds"</i>. It has been
///     <see cref="OpcUaDriver"/>'s <c>operationTimeoutMs</c> constructor parameter since Task B-5. Only the
///     other half of that sentence — no env var, no setting — survived.</item>
///   <item>§16.4 published the command-argument <c>"type"</c> union as SIX members.
///     <see cref="CommandArgumentType"/> has SEVEN: <see cref="CommandArgumentType.String"/> is accepted by
///     <see cref="CommandArgumentDeclaration.ValidateSelf"/>, which is the one schema check both maps'
///     <c>FromJson</c> run over a command argument, and it narrows in <c>TryNarrow</c> like any other
///     member. A closed set published one member short is a claim an integrator acts on.</item>
/// </list></para>
///
/// <para><b>WHAT THIS PINS, and it is deliberately narrower than "§16.4/§16.6 are correct".</b> Item 36
/// measured the cost of the naive shape: §16.4 alone is ~160 lines of prose around a four-row table, so a
/// whole-section pin would redden on rewrites that change no fact, and that friction would fall hardest on
/// the honest RTU and deferral blocks these two sections carry. The subject here is therefore the part that
/// has a SOURCE OF TRUTH IN CODE — env-var name sets, numeric defaults and guards, and the two closed type
/// sets — and each is DERIVED from the code and compared, rather than restated beside it.
///
/// <b>Where a value is produced by BEHAVIOUR rather than by a named constant, it is obtained by running the
/// behaviour.</b> <c>unitId</c>, <c>pollIntervalMs</c>, the retry count and the derived read timeout are
/// property initialisers on a map class, invisible to any text scan; this file gets them by parsing a
/// minimal map through the real <c>FromJson</c> and reading what came out. A defaults table checked against
/// a re-typed copy of the defaults would be a fourth copy.</para>
///
/// <para>🔴 <b>WHAT IT DOES NOT REACH — stated at the same length as what it does, because a ceiling put
/// too low is worse than no ceiling.</b>
/// <list type="bullet">
///   <item><b>PROSE IS ALMOST ENTIRELY UNWITNESSED — and the boundary is not "text vs code", because every
///     comparison here matches TEXT; the README is text.</b> The line that matters is whether the thing
///     compared is a VALUE the code produced or a PHRASE with nothing behind it. Values: the eight variable
///     names, the two Modbus defaults, the PKI leaf, both map guards, three parsed map defaults, the retry
///     default, the stack version, the timeout, and the two type unions. PHRASES, listed because they are
///     the weak ones: the ENDPOINT row's "not consulted", §16.6's "only \"None\" exists", the
///     <c>Math.Max(1000ms, pollIntervalMs × 4)</c> formula (whose two numbers are typed into the pattern
///     rather than derived), and one NEGATIVE phrase check on the "hardcoded" adjective. Outside those
///     four, the rationale paragraphs, the two "honest deferral" lists and the RTU block are as unguarded
///     as they were, and a rewrite that keeps the numbers while inverting a claim is green here. That is
///     the class owner-decisions.md item 26 names, and this file narrows it rather than closing it.</item>
///   <item><b>ONE ASSERTION PINS A WORD, and it is the weakest thing in the file.</b> The check that §16.6
///     no longer calls the 15-second bound "hardcoded" keys on that adjective. An honest rewrite that says
///     the same false thing in other words passes it. It is here because of the two claims measured false,
///     that one is the half no value comparison can see — the NUMBER 15 000 was right the whole time, and
///     only the word around it was wrong. A witness blind to one of the two drifts that motivated it would
///     be certifying less than it appears to; that is the reason, and it is not a model for the rest of the
///     file.</item>
///   <item><b>THE REVERSE DIRECTION IS COMPLETE FOR TWO TYPE SETS, NOT ALL FIVE.</b> The command-argument
///     union and the OPC-UA <c>valueType</c> union are published as machine-readable <c>"A" | "B"</c> runs,
///     so those are compared BOTH ways. <see cref="ModbusRegisterType"/>, <see cref="ModbusDataType"/> and
///     <see cref="OpcUaSecurityMode"/> are published inside prose bullets that also quote unrelated tokens
///     (<c>"writable"</c> sits inside the <c>type</c> bullet), so for those three the guard is: each member
///     is quoted somewhere in the section, AND the member COUNT is pinned. A member added or removed
///     reddens; a member RENAMED to a spelling the prose already happens to contain would not.</item>
///   <item><b>IT READS THE COMMITTED README AND THE COMPILED TYPES, not a rendered document.</b> Nothing
///     here checks that the tables are well-formed markdown, only that the rows it can parse agree with the
///     code. A row this parser cannot see is a row it says nothing about.</item>
///   <item><b>§16.4's RTU block is out of scope.</b> Its schema (<c>rtu-gateway</c> / <c>rtu-serial</c>,
///     the <c>devices</c> array, the 19200-8-E-1 default) lives in <c>connectors.json</c> parsing, not in
///     these two option classes, and is not measured here.</item>
/// </list></para>
///
/// <para><b>Non-vacuity, the shape the two precedents in this suite already carry</b>
/// (<c>PerHostDataRootsTests</c>, <c>NotificationDocumentationTests</c>), and it is three different
/// mechanisms rather than one blanket claim: each section cut asserts it came out over 500 characters, so a
/// broken slice fails loudly instead of silently shrinking the haystack; <c>QuotedUnionAfter</c> asserts
/// both its anchor and its union matched; and the env-var table needs no floor of its own because it is
/// compared for SET EQUALITY against four declared constants, which an empty extraction cannot satisfy.</para>
/// </summary>
public sealed class DriverDocumentationTests
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

    /// <summary>One <c>### 16.x</c> section, sliced between its own heading and the next one — the same
    /// section-cut idiom <c>NotificationDocumentationTests</c> uses, and for the same reason: an assertion
    /// run against the WHOLE README passes because the fact is stated SOMEWHERE in a 6,000-line document,
    /// which is not the question being asked.</summary>
    private static string Section(string heading, string nextHeading)
    {
        var text = File.ReadAllText(Path.Combine(MachineSimulatorRoot(), "README.md"));
        var start = text.IndexOf(heading, StringComparison.Ordinal);
        Assert.True(start >= 0,
            $"README.md has no \"{heading}\" heading any more. If the section was renumbered, fix this " +
            "locator — do not delete the assertions that depend on it.");

        var end = text.IndexOf(nextHeading, start + heading.Length, StringComparison.Ordinal);
        Assert.True(end > start,
            $"README.md has no \"{nextHeading}\" heading after \"{heading}\", so the section could not be " +
            "bounded and every check below would have run against the rest of the document.");

        var section = text[start..end];
        Assert.True(section.Length > 500,
            $"The \"{heading}\" cut came out {section.Length} characters long. That is not a section; the " +
            "slice broke, and a short cut would make several assertions below vacuous.");
        return section;
    }

    private static string ModbusSection() => Section("### 16.4 Modbus TCP driver", "### 16.5 Asset Registry");

    private static string OpcUaSection() => Section("### 16.6 OPC-UA client driver", "### 16.7 ");

    /// <summary>Every pipe-table row in a section whose first cell is a backticked <c>ST4I_*</c> name,
    /// as (whole row, last cell). The last cell is the "Default" column. Prose mentions of a PREFIX
    /// (<c>ST4I_MODBUS_*</c>) are excluded by construction — the copy that matters, and the copy an
    /// integrator reads a variable name off, is the table.</summary>
    private static Dictionary<string, (string Row, string Default)> EnvVarTable(string section)
    {
        var rows = new Dictionary<string, (string, string)>(StringComparer.Ordinal);
        var rowPattern = new Regex(@"^\|\s*`(?<var>ST4I_[A-Z0-9_]+)`\s*\|(?<rest>.*)\|[^|]*$", RegexOptions.Multiline);

        foreach (Match m in rowPattern.Matches(section))
        {
            var line = m.Value.TrimEnd('\r');
            var cells = line.Split('|');
            rows[m.Groups["var"].Value] = (line, cells[^2].Trim());
        }

        return rows;
    }

    /// <summary>The first run of two-or-more quoted tokens joined by <c>|</c> that follows
    /// <paramref name="anchor"/> — the shape both sections use to publish a CLOSED set
    /// (<c>"Bool" | "Int16" | …</c>). Two-or-more on purpose: a lone <c>"type"</c> key sitting between the
    /// anchor and the union would otherwise be read as a one-member set, and the whole point of this helper
    /// is that the set it returns can be compared for EQUALITY.</summary>
    private static List<string> QuotedUnionAfter(string section, string anchor)
    {
        var at = section.IndexOf(anchor, StringComparison.Ordinal);
        Assert.True(at >= 0,
            $"Could not find the anchor \"{anchor}\" in the section, so the type union it introduces could " +
            "not be read. Either the scan broke or the section stopped publishing the set — repair it; " +
            "deleting the assertion would leave a closed set published with no witness again.");

        var tail = section[(at + anchor.Length)..];
        var union = new Regex("\"[A-Za-z0-9]+\"(\\s*\\|\\s*\"[A-Za-z0-9]+\")+").Match(tail);
        Assert.True(union.Success,
            $"The text after \"{anchor}\" no longer contains a quoted union: " +
            $"\"{tail[..Math.Min(160, tail.Length)]}\".");

        return new Regex("\"(?<t>[A-Za-z0-9]+)\"").Matches(union.Value)
            .Select(m => m.Groups["t"].Value).ToList();
    }

    /// <summary>The README writes large numbers with a thousands SPACE ("60 000 ms"), which is how a reader
    /// reads them; the code writes 60_000. Normalising the document is the honest direction — re-typing the
    /// constant as "60 000" to match the markdown would put the copy back.</summary>
    private static string JoinDigitGroups(string text) => Regex.Replace(text, @"(?<=\d)[   ](?=\d)", "");

    /// <summary>
    /// 🔴 <b>The eight <c>ST4I_*</c> rows are compared to the eight constants the drivers actually read, in
    /// BOTH directions.</b> A rename on either side reddens; so does a fifth row for a variable no code
    /// reads, and so does a fifth constant the tables never mention. Forward-only would have let a
    /// documented-but-nonexistent variable stand, which is the shape
    /// <c>PerHostDataRootsTests.EveryRelocationVariable_IsActuallyREAD_NotMerelyDeclared</c> exists for one
    /// section over.
    /// </summary>
    [Fact]
    public void TheEnvVarTablesInSections16_4And16_6_NameExactlyTheConstantsTheDriversRead()
    {
        var modbusRows = EnvVarTable(ModbusSection());
        var opcUaRows = EnvVarTable(OpcUaSection());

        var modbusDeclared = new[]
        {
            ModbusOptions.EnvVarEnabled, ModbusOptions.EnvVarHost,
            ModbusOptions.EnvVarPort, ModbusOptions.EnvVarMapPath,
        };
        var opcUaDeclared = new[]
        {
            OpcUaOptions.EnvVarEnabled, OpcUaOptions.EnvVarEndpoint,
            OpcUaOptions.EnvVarMapPath, OpcUaOptions.EnvVarPkiDir,
        };

        Assert.Equal(
            modbusDeclared.OrderBy(v => v, StringComparer.Ordinal).ToArray(),
            modbusRows.Keys.OrderBy(v => v, StringComparer.Ordinal).ToArray());
        Assert.Equal(
            opcUaDeclared.OrderBy(v => v, StringComparer.Ordinal).ToArray(),
            opcUaRows.Keys.OrderBy(v => v, StringComparer.Ordinal).ToArray());

        // The Default column, for the two rows whose default is a VALUE rather than the word "none". Both
        // are named constants, so this compares the copy to its source and not to a second copy.
        Assert.Contains(ModbusOptions.DefaultHost, modbusRows[ModbusOptions.EnvVarHost].Default, StringComparison.Ordinal);
        Assert.Contains(
            ModbusOptions.DefaultPort.ToString(CultureInfo.InvariantCulture),
            modbusRows[ModbusOptions.EnvVarPort].Default, StringComparison.Ordinal);

        // Both drivers ship OFF, and both tables say so in the column an integrator reads. This is the one
        // fact in either table whose being wrong changes what a fresh install DOES.
        Assert.Contains("false", modbusRows[ModbusOptions.EnvVarEnabled].Default, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("false", opcUaRows[OpcUaOptions.EnvVarEnabled].Default, StringComparison.OrdinalIgnoreCase);
        Assert.False(new ModbusOptions().Enabled);
        Assert.False(new OpcUaOptions().Enabled);

        // The PKI default is a COMPOSED path, so the leaf the table publishes is compared to the leaf the
        // code composes — not to a re-typed "%ProgramData%\ST4I\sim\opcua-pki".
        var pkiLeaf = Path.GetRelativePath(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            OpcUaPkiPaths.DefaultRoot());
        Assert.Contains(
            pkiLeaf.Replace('/', '\\'),
            opcUaRows[OpcUaOptions.EnvVarPkiDir].Default.Replace('/', '\\'),
            StringComparison.OrdinalIgnoreCase);

        // §16.6's ENDPOINT row promises the variable is not consulted. Held to the part a test can decide:
        // OpcUaOptions still surfaces it, and OpcUaDriver takes no endpoint argument at all, so the node
        // map's own EndpointUrl is the only source a driver could have.
        Assert.Contains("not consulted", opcUaRows[OpcUaOptions.EnvVarEndpoint].Row, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(
            typeof(OpcUaDriver).GetConstructors().Single().GetParameters(),
            p => p.Name is not null && p.Name.Contains("endpoint", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// 🔴 <b>The numbers these two sections publish THAT HAVE A SOURCE OF TRUTH IN CODE, each obtained from
    /// the thing that produces it.</b> Two are named constants and are read as constants; three are map
    /// property initialisers with no name a text scan can reach, so they are obtained by parsing a minimal
    /// map through the REAL <c>FromJson</c> and reading the result; one is a constructor parameter default
    /// and is read by reflection; one is a NuGet version and is read from the csproj that pins it.
    ///
    /// <para><b>The numbers deliberately NOT covered, listed rather than counted, because "every number"
    /// would have been false and these sections are full of numbers:</b> the illustrative values inside the
    /// two JSON code fences (register addresses 100/101, the <c>scale: 0.1</c> → 23.5 worked example, the
    /// <c>readTimeoutMs: 3000</c>/<c>retries: 2</c> sample, port 4840); the RTU serial line defaults
    /// (19200-8-E-1) and the Modbus function codes (FC03/FC04), which belong to <c>connectors.json</c>
    /// parsing and to the protocol rather than to these two option classes; the ~2 ms cancellation latency
    /// and the "five times FleetHost's 3-second budget" comparison, both narrative measurements with no
    /// constant behind them; and the 2025-12-04 relicensing date, which is a fact about the world.</para>
    ///
    /// <para><b>The "hardcoded" clause is the weakest assertion in this file, and the class remarks list it
    /// among the phrase-only pins for that reason.</b> It keys on an adjective. The justification is in
    /// those remarks and is not repeated here: of the two drifts that motivated this file, that one is the
    /// half no value comparison could ever have seen.</para>
    /// </summary>
    [Fact]
    public void TheNumbersSections16_4And16_6_SpellAreTheNumbersTheCodeProduces()
    {
        var modbus = ModbusSection();
        var opcUa = OpcUaSection();
        var modbusFlat = JoinDigitGroups(modbus);
        var opcUaFlat = JoinDigitGroups(opcUa);

        // ── the two named guards ──────────────────────────────────────────────────────────────────────
        Assert.Contains(
            ModbusRegisterMap.MaxReadTimeoutMs.ToString(CultureInfo.InvariantCulture),
            modbusFlat, StringComparison.Ordinal);
        Assert.Contains(
            $"guarded at {ModbusRegisterMap.MaxRetries.ToString(CultureInfo.InvariantCulture)}",
            modbusFlat, StringComparison.Ordinal);

        // ── the behavioural defaults: parsed, not read off a literal ──────────────────────────────────
        var minimalModbus = ModbusRegisterMap.FromJson("""
            { "machineCode": "DOC-01", "registers": [ { "address": 1, "type": "Holding", "dataType": "UInt16",
              "scale": 1.0, "metric": "m", "unit": "u" } ] }
            """);

        Assert.Contains(
            $"defaults to `{minimalModbus.UnitId.ToString(CultureInfo.InvariantCulture)}`",
            modbus, StringComparison.Ordinal);
        Assert.Contains(
            $"defaults to `{minimalModbus.PollIntervalMs.ToString(CultureInfo.InvariantCulture)}`",
            modbus, StringComparison.Ordinal);

        // §16.4 says the GP-6b fix dropped NModbus's own retry count to 1 by default, and the number in
        // that sentence is the one the parser produces. `\s+` rather than a literal space: this README is
        // hard-wrapped at ~110 columns, so pinning a single space would pin the WRAPPING.
        Assert.Matches(
            new Regex($@"retry count to {minimalModbus.EffectiveRetries}\s+by\s+default"), modbus);

        // The derived read-timeout FORMULA, tied to the behaviour rather than to a restatement of itself:
        // the section publishes Math.Max(1000ms, pollIntervalMs × 4), so BOTH arms of that max are run.
        Assert.Matches(new Regex(@"Math\.Max\(1000ms, *pollIntervalMs *[x×] *4\)"), modbus);
        Assert.Equal(4000, minimalModbus.EffectiveReadTimeoutMs);                  // product arm (poll 1000)
        Assert.Equal(1000, PollingEvery(100).EffectiveReadTimeoutMs);              // floor arm (100 × 4 < 1000)

        var minimalOpcUa = OpcUaNodeMap.FromJson("""
            { "machineCode": "DOC-02", "endpointUrl": "opc.tcp://127.0.0.1:4840",
              "nodes": [ { "nodeId": "ns=2;s=X", "metric": "m" } ] }
            """);
        Assert.Contains(
            $"defaults to `{minimalOpcUa.PollIntervalMs.ToString(CultureInfo.InvariantCulture)}`",
            opcUa, StringComparison.Ordinal);

        // ── the OPC-UA stack version, from the csproj that pins it ────────────────────────────────────
        var csproj = File.ReadAllText(Path.Combine(
            MachineSimulatorRoot(), "src", "St4i.EdgeCore", "St4i.EdgeCore.csproj"));
        var pinned = Regex.Match(csproj,
            @"OPCFoundation\.NetStandard\.Opc\.Ua\.Client""\s+Version=""(?<v>[0-9.]+)""");
        Assert.True(pinned.Success,
            "St4i.EdgeCore.csproj no longer declares OPCFoundation.NetStandard.Opc.Ua.Client with a " +
            "Version attribute this pattern can read. The scan broke — repair it rather than dropping the " +
            "comparison, because §16.6 states that version to an integrator as a fact about the build.");
        Assert.Contains(pinned.Groups["v"].Value, opcUa, StringComparison.Ordinal);

        // ── the 15-second bound: a CONSTRUCTOR PARAMETER DEFAULT, which is the fact §16.6 got wrong ────
        var timeoutParameter = typeof(OpcUaDriver).GetConstructors().Single().GetParameters()
            .Single(p => p.Name == "operationTimeoutMs");
        Assert.True(timeoutParameter.HasDefaultValue,
            "OpcUaDriver.operationTimeoutMs no longer has a default value, so README §16.6's statement of " +
            "what the bound IS has lost its source. Move the section and this witness together.");
        Assert.Contains(
            ((int)timeoutParameter.DefaultValue!).ToString(CultureInfo.InvariantCulture),
            opcUaFlat, StringComparison.Ordinal);

        // 🔴 The retracted adjective. See this method's remarks and the class remarks for why an assertion
        // on a WORD is here, and why it is the one thing in this file not to copy.
        Assert.DoesNotMatch(new Regex(@"hardcoded\s+15", RegexOptions.IgnoreCase), opcUa);
    }

    /// <summary>A register map identical to the minimal one but polling at <paramref name="pollIntervalMs"/>
    /// — built through <c>FromJson</c> because <see cref="ModbusRegisterMap"/> is a class, not a record, so
    /// there is no <c>with</c> expression and hand-constructing one would bypass the parser this file exists
    /// to measure.</summary>
    private static ModbusRegisterMap PollingEvery(int pollIntervalMs) => ModbusRegisterMap.FromJson($$"""
        { "machineCode": "DOC-01", "pollIntervalMs": {{pollIntervalMs}},
          "registers": [ { "address": 1, "type": "Holding", "dataType": "UInt16",
            "scale": 1.0, "metric": "m", "unit": "u" } ] }
        """);

    /// <summary>
    /// 🔴 <b>The two CLOSED type sets these sections publish, compared to the sets the parsers accept.</b>
    /// §16.4's command-argument union and §16.6's writable <c>valueType</c> union are both published as
    /// machine-readable <c>"A" | "B"</c> runs, so both are compared BOTH ways — a member added to
    /// <see cref="CommandArgumentType"/> and not to the README reddens, and so does a README union naming a
    /// member the enum does not have.
    ///
    /// <para><b>The two unions are deliberately DIFFERENT sets, and that asymmetry is exercised rather than
    /// described.</b> A command ARGUMENT may be a <see cref="CommandArgumentType.String"/> —
    /// <see cref="CommandArgumentDeclaration.ValidateSelf"/> accepts it, and that is the one schema check
    /// both maps run. A writable SETPOINT may not: <c>OpcUaNodeMap.FromJson</c> rejects it explicitly,
    /// because a string's domain is not boundable the way <c>min</c>/<c>max</c> require. Both halves are run
    /// against the real parser below, so "these two lists differ by exactly String" is a measurement here
    /// rather than a comment.</para>
    ///
    /// <para>For <see cref="ModbusRegisterType"/>, <see cref="ModbusDataType"/> and
    /// <see cref="OpcUaSecurityMode"/> the README form is a prose bullet that also quotes unrelated tokens,
    /// so the guard is membership plus a pinned COUNT — see the class remarks for the rename that
    /// misses.</para>
    /// </summary>
    [Fact]
    public void TheClosedTypeSetsSections16_4And16_6_PublishAreTheSetsTheCodeAccepts()
    {
        var modbus = ModbusSection();
        var opcUa = OpcUaSection();

        var allArgumentTypes = Enum.GetNames<CommandArgumentType>()
            .OrderBy(n => n, StringComparer.Ordinal).ToArray();
        Assert.True(allArgumentTypes.Length >= 6,
            $"CommandArgumentType has {allArgumentTypes.Length} member(s); the enum, not the README, is " +
            "what changed shape. Re-read it before touching anything below.");

        // §16.4 — command arguments. This is the set that was published one member short.
        var documentedArgumentTypes = QuotedUnionAfter(modbus, "\"arguments\": [ { \"name\":")
            .OrderBy(n => n, StringComparer.Ordinal).ToArray();
        Assert.Equal(allArgumentTypes, documentedArgumentTypes);

        // §16.6 — writable setpoints: the same enum MINUS String, derived rather than restated.
        var writableExpected = allArgumentTypes
            .Where(n => n != nameof(CommandArgumentType.String))
            .ToArray();
        var documentedWritable = QuotedUnionAfter(opcUa, "\"writable\": { \"valueType\":")
            .OrderBy(n => n, StringComparer.Ordinal).ToArray();
        Assert.Equal(writableExpected, documentedWritable);

        // …and the difference between the two lists is a BEHAVIOUR, run here rather than believed.
        Assert.ThrowsAny<Exception>(() => OpcUaNodeMap.FromJson("""
            { "machineCode": "DOC-03", "endpointUrl": "opc.tcp://127.0.0.1:4840",
              "nodes": [ { "nodeId": "ns=2;s=X", "metric": "m",
                           "writable": { "valueType": "String" } } ] }
            """));

        var boolSetpoint = OpcUaNodeMap.FromJson("""
            { "machineCode": "DOC-04", "endpointUrl": "opc.tcp://127.0.0.1:4840",
              "nodes": [ { "nodeId": "ns=2;s=X", "metric": "m",
                           "writable": { "valueType": "Bool" } } ] }
            """);
        Assert.Single(boolSetpoint.Nodes);

        // A String command ARGUMENT, by contrast, is a valid declaration — the fact §16.4 was missing.
        Assert.Null(new CommandArgumentDeclaration("s", CommandArgumentType.String).ValidateSelf());

        // The three prose-published enums: each member quoted in its section, and the member count pinned
        // so that adding or removing one reddens.
        foreach (var name in Enum.GetNames<ModbusRegisterType>())
        {
            Assert.Contains($"\"{name}\"", modbus, StringComparison.Ordinal);
        }

        foreach (var name in Enum.GetNames<ModbusDataType>())
        {
            Assert.Contains($"\"{name}\"", modbus, StringComparison.Ordinal);
        }

        foreach (var name in Enum.GetNames<OpcUaSecurityMode>())
        {
            Assert.Contains($"\"{name}\"", opcUa, StringComparison.Ordinal);
        }

        Assert.Equal(2, Enum.GetNames<ModbusRegisterType>().Length);
        Assert.Equal(2, Enum.GetNames<ModbusDataType>().Length);

        // §16.6 states this one as a closed set in WORDS ("currently only \"None\" exists"), so the closure
        // is what is checked: a second security mode makes that sentence false the day it is added.
        Assert.Single(Enum.GetNames<OpcUaSecurityMode>());
        Assert.Matches(new Regex("only\\s+`?\"None\"`?\\s+exists", RegexOptions.IgnoreCase), opcUa);
    }
}
