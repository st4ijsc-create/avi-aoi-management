using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using St4i.Connector.Abstractions.Json;
using St4i.Connector.Abstractions.Models;
using Xunit;

namespace St4i.Connector.Abstractions.Tests;

/// <summary>
/// Task P-2 (.superpowers/sdd/enum-spelling-witnessed/task-1-brief.md) — <b>the spelling of an enum member
/// on this assembly is a published string, and until this file existed nothing in this repository read it
/// as one.</b>
///
/// <para><b>THE PROPERTY, DERIVED FROM THE QUESTION RATHER THAN FROM THE RENAME EXAMPLE.</b> The question
/// is "what breaks when a member's spelling changes, and what would notice". The answer is not confined to
/// renames, and it is not confined to one direction. This product turns a member's CLR name into a
/// published string by reflection — <see cref="Enum.ToString()"/> onto stored rows and cycle logs, a
/// no-naming-policy <c>JsonStringEnumConverter</c> onto the HTTP surface, a camelCase one onto the
/// connector wire format — and consumers on the far side of a process boundary then use those strings as
/// LOOKUP KEYS and LITERAL COMPARANDS. So the property asserted here is:
/// <list type="bullet">
///   <item><description><b>Set equality at every closed enumeration.</b> A site that must list every
///   member (a translation block, a record literal, a union type, a switch) must hold exactly the current
///   member-name set. A RENAME leaves a key nothing produces; an ADDED MEMBER leaves a value nothing
///   handles. Both land at the same lookup as <c>undefined</c>, so both are red here. The brief's own
///   phrasing named only renames; that is narrower than the hazard.</description></item>
///   <item><description><b>Membership at every scattered comparison.</b> A site that compares one value
///   (<c>deviceClass === "Iot"</c>, <c>verdict &lt;&gt; 'Skip'</c>, a XAML <c>DataTrigger</c>) cannot be
///   checked for completeness — nothing says it should mention every member — but every literal it does
///   mention must still NAME a current member. A rename makes those compare against a string the product
///   can no longer emit.</description></item>
/// </list>
/// A <b>missing</b> dependency and a <b>wrong</b> one are therefore the same failure at the lookup and
/// different failures at the cause, and this file reports them apart — the same "two separately fatal
/// populations, never a net count" shape <c>scripts/verify-suites.sh</c>'s credential bracket already
/// uses.</para>
///
/// <para><b>WHY THE LEFT-HAND SIDE IS REFLECTION AND NOT A REGEX OVER <c>Enums.cs</c>.</b> Every member
/// set below comes from <see cref="Type.GetEnumNames"/> on the COMPILED type, and every published string
/// comes from the same converter the product configures. A check that re-read the C# source instead would
/// be a second copy of the contract rather than a measurement of it — the exact defect
/// <c>verify-suites.sh</c> caught in its own credential-root derivation, which "resolved correctly here by
/// luck" while looking derived.</para>
///
/// <para><b>WHERE THIS INSTRUMENT IS STANDING, AND WHAT IS OUTSIDE IT (§8.1(f)).</b> It stands in .NET: it
/// reflects over the compiled assembly and reads every consumer as TEXT. That domain is stated as a
/// boundary rather than implied, and the things outside it are named on
/// <see cref="ThingsThisInstrumentCannotSee"/>. The one that matters most: this file's registry of sites
/// is a claim about where the dependents ARE, and a registry seeded from a previous author's citation list
/// is how a scan inherits its domain from where its author was standing. So the registry ships with a
/// census that can refute it — see
/// <see cref="EveryTsTypeAliasOrTableNamedForAPublishedEnum_IsARegisteredMirror"/> and
/// <see cref="EveryComparandAgainstARegisteredCarrier_NamesACurrentMember"/>, neither of which reads the
/// registry to decide what to look at.</para>
///
/// <para><b>PRECONDITION.</b> Like <c>ZeroDependencyTests</c> and <c>RealCredentialStoreLeakGuard</c>, this
/// requires being run from inside the source tree: it walks up from <see cref="AppContext.BaseDirectory"/>
/// to <c>St4iMachineSimulator.sln</c> and reads <c>web/src</c> and <c>src/</c> beneath it. Off-tree
/// execution fails this class rather than passing it — a scan that cannot find its corpus has measured
/// nothing, and "nothing measured" must never read as "nothing wrong".</para>
/// </summary>
public class EnumSpellingContractTests
{
    // ══ THE CORPUS ═════════════════════════════════════════════════════════════════════════════════
    //
    // Three roots, each named here and nowhere else. `tests/` is deliberately NOT among them, and the
    // reason is not tidiness: this file itself holds every member spelling as a string literal, so a
    // corpus that included it would find its own registry and report the instrument as its own dependent.

    private const string WebSourceRoot = "web/src";
    private const string ProductSourceRoot = "src";

    private static string MachineSimulatorRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "St4iMachineSimulator.sln")))
            {
                return dir.FullName;
            }

            dir = dir.Parent;
        }

        throw new InvalidOperationException(
            $"Could not locate St4iMachineSimulator.sln by walking up from \"{AppContext.BaseDirectory}\". " +
            "This instrument reads the browser client, the WPF markup and the SQL literals off the tree; " +
            "with no tree it can measure nothing, and it fails rather than reporting a clean run.");
    }

    private static string Absolute(string relativePath) =>
        Path.Combine(MachineSimulatorRoot(), relativePath.Replace('/', Path.DirectorySeparatorChar));

    private static string ReadSite(string relativePath)
    {
        var full = Absolute(relativePath);
        if (!File.Exists(full))
        {
            throw new InvalidOperationException(
                $"A registered dependent site is not in the tree: {relativePath}. Either the file moved — " +
                "in which case fix this registry, do not delete the entry — or the dependency really is " +
                "gone, in which case say so in the commit. An entry that silently stops being read is an " +
                "assertion that has silently stopped being made.");
        }

        return File.ReadAllText(full);
    }

    private static IReadOnlyList<string> CorpusFiles(string root, params string[] extensions)
    {
        var full = Absolute(root);
        if (!Directory.Exists(full))
        {
            throw new InvalidOperationException(
                $"The corpus root {root} does not exist under {MachineSimulatorRoot()}. Every scan below " +
                "would return nothing and every assertion would pass vacuously.");
        }

        return Directory.EnumerateFiles(full, "*", SearchOption.AllDirectories)
            .Where(p => extensions.Contains(Path.GetExtension(p), StringComparer.OrdinalIgnoreCase))
            .Where(p => !IsUnderBuildOutput(p, full))
            .OrderBy(p => p, StringComparer.Ordinal)
            .ToList();
    }

    /// <summary>Build output and vendored dependencies are not consumers — they are copies of them. A hit
    /// in <c>obj/</c>, <c>bin/</c>, <c>dist/</c> or <c>node_modules/</c> would be the same source counted
    /// twice, and a stale one at that.</summary>
    private static bool IsUnderBuildOutput(string path, string root)
    {
        var relative = Path.GetRelativePath(root, path);
        var segments = relative.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        return segments.Any(s =>
            s.Equals("obj", StringComparison.OrdinalIgnoreCase)
            || s.Equals("bin", StringComparison.OrdinalIgnoreCase)
            || s.Equals("dist", StringComparison.OrdinalIgnoreCase)
            || s.Equals("node_modules", StringComparison.OrdinalIgnoreCase));
    }

    private static IReadOnlyList<string> WebFiles() => CorpusFiles(WebSourceRoot, ".ts", ".tsx");

    private static IReadOnlyList<string> XamlFiles() => CorpusFiles(ProductSourceRoot, ".xaml");

    private static IReadOnlyList<string> CSharpFiles() => CorpusFiles(ProductSourceRoot, ".cs");

    private static string Relative(string absolutePath) =>
        Path.GetRelativePath(MachineSimulatorRoot(), absolutePath).Replace(Path.DirectorySeparatorChar, '/');

    // ══ THE POPULATION ═════════════════════════════════════════════════════════════════════════════
    //
    // Closed at a named place rather than listed in a sentence: every enum this assembly EXPORTS. A ninth
    // enum added to St4i.Connector.Abstractions lands in this set without anybody editing this file, and
    // EveryExportedEnum_IsAccountedForInTheRegistry then refuses until somebody decides which kind of
    // dependent it has. That is the only arrangement under which "these are all of them" is a claim this
    // file is entitled to make.

    private static IReadOnlyList<Type> ExportedEnums() =>
        typeof(DeviceClass).Assembly.GetExportedTypes()
            .Where(t => t.IsEnum)
            .OrderBy(t => t.Name, StringComparer.Ordinal)
            .ToList();

    private static IReadOnlyList<string> MemberNamesOf(string enumTypeName)
    {
        var type = ExportedEnums().FirstOrDefault(t => string.Equals(t.Name, enumTypeName, StringComparison.Ordinal))
            ?? throw new InvalidOperationException(
                $"The registry names an enum this assembly does not export: {enumTypeName}. " +
                "The registry is addressed by TYPE NAME on purpose — a renamed TYPE lands here rather " +
                "than silently checking nothing.");

        return type.GetEnumNames().OrderBy(n => n, StringComparer.Ordinal).ToList();
    }

    private static IReadOnlyList<string> MemberNamesOf(IEnumerable<string> enumTypeNames) =>
        enumTypeNames.SelectMany(MemberNamesOf).Distinct(StringComparer.Ordinal)
            .OrderBy(n => n, StringComparer.Ordinal).ToList();

    // ══ THE REGISTRY — POINTED BY NAME, NEVER BY POSITION (§8.1(h8)) ═══════════════════════════════

    private enum SiteShape
    {
        /// <summary>A TypeScript string-literal union alias: <c>export type X = "A" | "B"</c>.</summary>
        TsUnionAlias,

        /// <summary>An object property whose value is a brace block, keyed by member name — the i18n
        /// resource shape: <c>deviceClass: { Automation: "…" }</c>.</summary>
        TsObjectBlock,

        /// <summary>A <c>const</c> bound to a brace block keyed by member name — the lookup-table
        /// shape: <c>const CLASS_ICON: Record&lt;DeviceClass, …&gt; = { Automation: Cog }</c>.</summary>
        TsRecordConst,

        /// <summary>A <c>const</c> bound to a bracket list of member names, whether bare or wrapped in
        /// <c>new Set(...)</c>.</summary>
        TsListConst,

        /// <summary>A function whose body switches on a member-name string, one <c>case</c> per
        /// member.</summary>
        TsSwitchCases,

        /// <summary>WPF markup: every <c>DataTrigger</c> in the file bound to one named property, each
        /// comparing against a member name as a literal <c>Value</c>.</summary>
        XamlTriggerValues,
    }

    /// <param name="RelativePath">Where the site lives, from tools/machine-simulator.</param>
    /// <param name="Shape">How its member set is written down, which decides how it is extracted.</param>
    /// <param name="Anchor">The NAME the extractor keys on — a symbol, a property, a binding path. Never a
    /// line number: a site that moves must keep being checked, and a site that is RENAMED OR DELETED must
    /// make this red rather than quietly stop being read.</param>
    /// <param name="EnumTypeNames">Which exported enum(s) this site mirrors. More than one where the site
    /// deliberately merges two vocabularies — the rejection-reason translation block is the union of the
    /// setpoint and command reasons, and checking it against either one alone would be wrong in both
    /// directions at once.</param>
    /// <param name="WhatBreaksIfAMemberIsMissing">Why set equality rather than membership is the right
    /// property HERE. Written per site because it is not the same sentence twice: an absent icon and an
    /// absent translation and an absent panel are three different operator-visible failures.</param>
    private sealed record MirrorSite(
        string RelativePath,
        SiteShape Shape,
        string Anchor,
        string[] EnumTypeNames,
        string WhatBreaksIfAMemberIsMissing);

    private static IReadOnlyList<MirrorSite> Mirrors() =>
    [
        // ── DeviceClass ────────────────────────────────────────────────────────────────────────────
        new("web/src/lib/api.ts", SiteShape.TsUnionAlias, "DeviceClass", ["DeviceClass"],
            "the hand-written mirror every other browser-side site is typed against; a member absent here "
            + "makes the compiler ACCEPT the tables below while they are incomplete, so this one site "
            + "decides whether TypeScript can help at all"),
        new("web/src/i18n/en.ts", SiteShape.TsObjectBlock, "deviceClass", ["DeviceClass"],
            "the English label a machine's class is drawn with, at six t(`deviceClass.${…}`) call sites in "
            + "five files; a missing key renders the interpolated key path itself"),
        new("web/src/i18n/vi.ts", SiteShape.TsObjectBlock, "deviceClass", ["DeviceClass"],
            "the Vietnamese half of the same block — the language an operator actually reads on the floor, "
            + "and the half a reviewer working in English is least likely to open"),
        new("web/src/routes/AssetRegistry.tsx", SiteShape.TsListConst, "KNOWN_DEVICE_CLASSES", ["DeviceClass"],
            "the name gate that decides whether the asset registry translates a class or prints it raw; a "
            + "missing member downgrades that row to an untranslated string"),
        new("web/src/routes/MachineDetail.tsx", SiteShape.TsRecordConst, "CLASS_ICON", ["DeviceClass"],
            "the header icon component; a missing member yields undefined and React renders nothing where "
            + "the machine's figure belongs"),
        new("web/src/routes/Hmi.tsx", SiteShape.TsRecordConst, "SCHEMATIC_READOUT_FLEX", ["DeviceClass"],
            "the schematic/readout width split; a missing member destructures undefined and the HMI panel "
            + "throws rather than degrading"),
        new("web/src/components/hmi/SchematicPanel.tsx", SiteShape.TsRecordConst, "FIG_KEY", ["DeviceClass"],
            "the schematic figure's accessible caption key; a missing member leaves the drawing without the "
            + "name a screen reader announces"),
        new("web/src/routes/Machines.tsx", SiteShape.TsListConst, "DEVICE_CLASS_ORDER", ["DeviceClass"],
            "the fleet grid's class filter; a missing member cannot be filtered for at all"),
        new("src/St4iMachineSimulator/Views/MachineDetailView.xaml", SiteShape.XamlTriggerValues, "Class",
            ["DeviceClass"],
            "which of the three detail panels is visible in the desktop shell — the markup's own comment "
            + "says exactly one is ever visible, so a missing member shows NONE of them"),

        // ── Verdict ────────────────────────────────────────────────────────────────────────────────
        new("web/src/components/CycleLogTable.tsx", SiteShape.TsRecordConst, "VERDICT_META", ["Verdict"],
            "the badge tone and label for every cycle-log row, reused unchanged by the historian table and "
            + "the historian dialog; a missing member falls back to printing the raw wire string in both "
            + "languages"),
        new("web/src/routes/Historian.tsx", SiteShape.TsListConst, "VERDICT_OPTIONS", ["Verdict"],
            "the historian's verdict filter, which is sent to the server as a query value; a missing member "
            + "cannot be filtered for, and a stale one filters for something the server can never store"),

        // ── ReadingKind ────────────────────────────────────────────────────────────────────────────
        new("web/src/lib/inspector.ts", SiteShape.TsUnionAlias, "ReadingKind", ["ReadingKind"],
            "the API inspector's frame-kind union; a missing member makes the inspector's own filter type "
            + "reject a kind the socket really delivers"),

        // ── WriteOutcome and the two rejection vocabularies ────────────────────────────────────────
        //
        // NOT ON N-2's LIST, AND THE HIGHEST-CONSEQUENCE ARM ON IT. `WriteOutcome.Indeterminate` exists so
        // that "we do not know whether the device applied this write" can never be rendered as anything
        // else; both switches below have a `default` that folds an unrecognised outcome INTO Indeterminate,
        // which is the safe direction and is still not a reason to leave them unchecked — an outcome the
        // browser has no case for would be reported to an operator as "we don't know" when the server
        // said something specific.
        new("web/src/lib/api.ts", SiteShape.TsUnionAlias, "WriteOutcome", ["WriteOutcome"],
            "the union every write-result component is typed against"),
        new("web/src/components/MachineControlPanel.tsx", SiteShape.TsSwitchCases, "outcomeStatus",
            ["WriteOutcome"],
            "the colour lane a write result is drawn in; the file's own comment says conflating "
            + "Indeterminate with Rejected or Failed destroys the one distinction the write contract exists "
            + "to preserve"),
        new("web/src/components/MachineControlPanel.tsx", SiteShape.TsSwitchCases, "outcomeLabel",
            ["WriteOutcome"],
            "the translated words an operator reads for that same outcome"),
        new("web/src/lib/api.ts", SiteShape.TsUnionAlias, "SetpointRejectionReason", ["SetpointRejectionReason"],
            "the union a setpoint rejection is typed against"),
        new("web/src/lib/api.ts", SiteShape.TsUnionAlias, "CommandRejectionReason", ["CommandRejectionReason"],
            "the union a command rejection is typed against, kept separate from the setpoint one mirroring "
            + "the server's own refusal to conflate them"),
        new("web/src/i18n/en.ts", SiteShape.TsObjectBlock, "rejectionReason",
            ["SetpointRejectionReason", "CommandRejectionReason"],
            "the English sentence explaining why a write was refused, interpolated by member name; a missing "
            + "key shows the operator the key path instead of the reason"),
        new("web/src/i18n/vi.ts", SiteShape.TsObjectBlock, "rejectionReason",
            ["SetpointRejectionReason", "CommandRejectionReason"],
            "the Vietnamese half of the same block"),
    ];

    /// <summary>How present a carrier's comparands are required to be. The vacuity guard and the
    /// universal negative are different expectations and are written as different values, because
    /// "found nothing" means opposite things at the two.</summary>
    private enum Presence
    {
        /// <summary>At least one comparand must be found. Not an exact count: a NEW comparison is a
        /// legitimate change and must not be red, while ZERO is always this instrument failing — a broken
        /// pattern, a moved corpus, a renamed carrier — and never a clean bill of health.</summary>
        AtLeastOne,

        /// <summary>Any number, none included. The carrier is registered so that a comparand appearing
        /// LATER is checked; its absence today asserts nothing.</summary>
        Any,

        /// <summary>Exactly none, and that is a claim rather than an observation: this file records that
        /// the enum has no comparand in the declared corpus, and this census is what could refute it.</summary>
        None,
    }

    /// <param name="EnumTypeName">Whose member names the literals found here must be.</param>
    /// <param name="Corpus">Which of the three declared roots and file kinds is swept.</param>
    /// <param name="CarrierNames">The identifiers, property paths or SQL columns known to hold this
    /// enum's published string. This is what makes the sweep precise instead of noisy: it looks for
    /// "the thing that carries the value, compared against a literal", never for the literal alone.</param>
    /// <param name="Expected">See <see cref="Presence"/>.</param>
    private sealed record CarrierPattern(
        string EnumTypeName,
        CorpusKind Corpus,
        string[] CarrierNames,
        Presence Expected);

    private enum CorpusKind { WebTypeScript, WpfMarkup, ProductCSharp }

    private static IReadOnlyList<CarrierPattern> Carriers() =>
    [
        new("DeviceClass", CorpusKind.WebTypeScript, ["deviceClass", "class"], Presence.AtLeastOne),
        new("DeviceClass", CorpusKind.WpfMarkup, ["Class"], Presence.AtLeastOne),
        new("DeviceClass", CorpusKind.ProductCSharp, ["device_class"], Presence.Any),

        new("Verdict", CorpusKind.WebTypeScript, ["verdict"], Presence.Any),
        new("Verdict", CorpusKind.ProductCSharp, ["verdict"], Presence.AtLeastOne),

        new("ReadingKind", CorpusKind.WebTypeScript, ["readingKind"], Presence.Any),
        new("ReadingKind", CorpusKind.ProductCSharp, ["reading_kind"], Presence.AtLeastOne),

        new("WriteOutcome", CorpusKind.WebTypeScript, ["outcome"], Presence.AtLeastOne),
        new("SetpointRejectionReason", CorpusKind.WebTypeScript, ["rejectionReason"], Presence.Any),

        // 🔴 THE TWO UNIVERSAL NEGATIVES, AND THE ONLY REASON THEY ARE ALLOWED TO BE STATED.
        // DriverHealthState is documented as reaching no JSON at all — it is read in-process off a live
        // driver and turned into alarms — and CommandArgumentType has no browser consumer either. Both
        // claims are of the form "nothing depends on these spellings", and a claim like that is worth
        // nothing when it is checked by looking for the members it names. It is checked HERE by a census
        // that would fire the moment a comparand against one of these carriers appeared anywhere in the
        // declared corpus. What the claim does NOT say: that nothing anywhere depends on them. It says
        // exactly that no registered carrier in the declared corpus compares against them today.
        new("DriverHealthState", CorpusKind.WebTypeScript, ["driverHealth", "healthState"], Presence.None),
        new("DriverHealthState", CorpusKind.WpfMarkup, ["DriverHealth", "HealthState"], Presence.None),
        new("DriverHealthState", CorpusKind.ProductCSharp, ["driver_health"], Presence.None),
        new("CommandArgumentType", CorpusKind.WebTypeScript, ["argumentType", "argType"], Presence.None),
    ];

    /// <summary>
    /// 🔴 <b>WHAT THIS INSTRUMENT CANNOT SEE — the half that makes the other half honest (§8.1(f)).</b>
    /// Named here rather than left implied, because the registry above is exactly the kind of artefact that
    /// inherits its domain from where its author was standing.
    /// <list type="number">
    ///   <item><description><b>A carrier whose name is not distinctive.</b> <c>kind</c> is the plainest
    ///   case: <c>ApiTraceEvent.kind</c> really is a <see cref="ReadingKind"/>, and
    ///   <c>Connectors.tsx</c>'s <c>live.kind === "issue"</c> is something else entirely. Registering
    ///   <c>kind</c> would make this cry wolf, so only <c>readingKind</c> is registered and a comparison
    ///   written against a variable named <c>kind</c> is OUTSIDE. Same decision, same reason, for bare
    ///   <c>health</c>.</description></item>
    ///   <item><description><b>A mirror TypeScript does not type.</b> The table sweep finds declarations
    ///   NAMED for an exported enum (<c>Record&lt;DeviceClass, …&gt;</c>, <c>DeviceClass[]</c>,
    ///   <c>type DeviceClass =</c>). <see cref="Verdict"/> has no TypeScript union at all — <c>VERDICT_META</c>
    ///   is a <c>Record&lt;string, …&gt;</c> — so a SECOND verdict table added tomorrow would be invisible to
    ///   the sweep and would have to be registered by hand.</description></item>
    ///   <item><description><b>Anything downstream of a hand-written re-spelling.</b> A member is often
    ///   turned into a DIFFERENT vocabulary in C# before it crosses the wire —
    ///   <c>MachineState</c> maps <see cref="Verdict"/> onto <c>"OK"/"WARN"/"FAIL"/"TELEMETRY"</c>, the
    ///   normalizer maps it onto lower-case tokens, the hot-folder writer onto <c>OK/NG/NTF</c>. Those
    ///   target strings are decided by a C# literal, not by the member's spelling, so
    ///   <c>ReadoutGrid</c>'s <c>STATUS_KEY</c>/<c>STATUS_TONE</c> and the eight
    ///   <c>{Binding StatusText}</c> triggers are NOT dependents of this contract and are deliberately
    ///   not registered. Renaming <see cref="Verdict.Fail"/> moves a compiler-checked switch arm and
    ///   leaves <c>"FAIL"</c> exactly where it was.</description></item>
    ///   <item><description><b>A comparison that never names a literal.</b>
    ///   <c>ResultToBrushConverter</c> upper-cases whatever string it is handed and compares against
    ///   <c>"PASS"/"WARN"/"FAIL"</c>; its own doc comment says those arms are for
    ///   <c>Verdict.ToString()</c>. No registered carrier appears in that file — the parameter is called
    ///   <c>value</c> — so it is outside. Measured, and recorded rather than fixed: today the only markup
    ///   that binds through it (<c>BoardView.xaml</c>) supplies a per-point <c>OK/NG/NTF</c> result, so
    ///   those three arms are unreached.</description></item>
    ///   <item><description><b>Whether any of this compiles, runs, or is ever rendered.</b> Set equality
    ///   between a translation block and an enum says the key exists; it says nothing about the words
    ///   behind it being right, and nothing about the branch being reachable.</description></item>
    ///   <item><description><b>Everything outside the three declared roots.</b>
    ///   <c>web/tests</c>, <c>packaging/</c>, <c>docs/</c>, <c>README.md</c>, the shipped
    ///   <c>fleet.json</c>/<c>mapping/</c> profiles and every real install's <c>assets.db</c> and
    ///   historian database hold these spellings too. The databases are the one population no static
    ///   instrument can reach at all: a rename does not migrate rows that were written years
    ///   ago.</description></item>
    /// </list>
    /// </summary>
    private static string ThingsThisInstrumentCannotSee => nameof(ThingsThisInstrumentCannotSee);

    // ══ FACT 1 — THE DERIVATION ITSELF ═════════════════════════════════════════════════════════════

    /// <summary>
    /// The member name reaches the far side VERBATIM, and this pins the three derivations that make it so.
    /// This is not a restatement of the BCL: it is the assumption every other assertion in this file rests
    /// on, and it can be broken WITHOUT ANY MEMBER BEING RENAMED — adding a naming policy to the product's
    /// HTTP serializer would re-spell all of them at once and break every browser-side mirror below while
    /// <c>Enums.cs</c> stayed byte-identical.
    /// </summary>
    [Fact]
    public void PublishedString_IsTheMemberNameVerbatim_UnderEveryDerivationThisProductUses()
    {
        var failures = new List<string>();

        // (a) ToString() — what the historian rows, the cycle log and the Sparkplug metric are written with.
        foreach (var type in ExportedEnums())
        {
            foreach (var name in type.GetEnumNames())
            {
                var value = Enum.Parse(type, name);
                if (!string.Equals(value.ToString(), name, StringComparison.Ordinal))
                {
                    failures.Add($"{type.Name}.{name}.ToString() is \"{value}\", not the member name.");
                }
            }
        }

        // (b) A no-naming-policy JsonStringEnumConverter — what src/St4i.EngineApi/JsonConfig.cs registers,
        //     and therefore what the browser client reads off every DTO.
        var productApiShape = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        productApiShape.Converters.Add(new JsonStringEnumConverter());
        foreach (var type in ExportedEnums())
        {
            foreach (var name in type.GetEnumNames())
            {
                var json = JsonSerializer.Serialize(Enum.Parse(type, name), type, productApiShape);
                if (!string.Equals(json, $"\"{name}\"", StringComparison.Ordinal))
                {
                    failures.Add($"{type.Name}.{name} serializes to {json} under the product's HTTP JSON shape, not \"{name}\".");
                }
            }
        }

        // (c) And the product really does register that converter with no naming policy. Read from the file
        //     rather than restated here, because the failure this guards against is somebody adding a policy.
        var jsonConfig = ReadSite("src/St4i.EngineApi/JsonConfig.cs");
        Assert.Contains("new JsonStringEnumConverter()", jsonConfig, StringComparison.Ordinal);
        if (Regex.IsMatch(jsonConfig, @"new\s+JsonStringEnumConverter\s*\(\s*[^)\s]"))
        {
            failures.Add(
                "src/St4i.EngineApi/JsonConfig.cs now passes an argument to JsonStringEnumConverter. A naming "
                + "policy there re-spells EVERY member on the HTTP surface at once, with no member renamed and "
                + "no compiler anywhere objecting — every browser-side mirror in this file's registry would be "
                + "wrong simultaneously.");
        }

        // (d) The connector wire format is the OTHER derivation, and it is camelCase — a property of THAT
        //     format, not of every place the value is recorded. A third-party driver author reads this one.
        foreach (var name in MemberNamesOf(nameof(ReadingKind)))
        {
            var json = JsonSerializer.Serialize(Enum.Parse<ReadingKind>(name), ConnectorJson.Options);
            var expected = $"\"{char.ToLowerInvariant(name[0])}{name[1..]}\"";
            if (!string.Equals(json, expected, StringComparison.Ordinal))
            {
                failures.Add($"ReadingKind.{name} serializes to {json} on the connector wire format, not {expected}.");
            }
        }

        Assert.True(failures.Count == 0, string.Join(Environment.NewLine, failures));
    }

    // ══ FACT 2 — THE POPULATION IS CLOSED SOMEWHERE, AND THAT SOMEWHERE IS THE ASSEMBLY ════════════

    /// <summary>
    /// Every enum this assembly exports is accounted for: it has at least one registered mirror, or at
    /// least one registered carrier, or both. A NEW exported enum therefore cannot arrive unexamined —
    /// it makes this red, and the only ways to make it green again are to register where it is depended on
    /// or to register the census that would refute a claim that it is depended on nowhere.
    /// </summary>
    [Fact]
    public void EveryExportedEnum_IsAccountedForInTheRegistry()
    {
        var mirrored = Mirrors().SelectMany(m => m.EnumTypeNames).ToHashSet(StringComparer.Ordinal);
        var carried = Carriers().Select(c => c.EnumTypeName).ToHashSet(StringComparer.Ordinal);

        var unaccounted = ExportedEnums()
            .Select(t => t.Name)
            .Where(n => !mirrored.Contains(n) && !carried.Contains(n))
            .ToList();

        Assert.True(
            unaccounted.Count == 0,
            "St4i.Connector.Abstractions exports enum(s) this contract registry says nothing about: "
            + string.Join(", ", unaccounted) + ". Every member name this assembly exports is a string some "
            + "reader may already be keying on. Decide which it is — a registered mirror, a registered "
            + "carrier, or a recorded claim that no carrier in the declared corpus touches it — and write it "
            + "down. Leaving it out is not the same as it having no dependents; it is this file declining to "
            + "look.");
    }

    // ══ FACT 3 — SET EQUALITY AT EVERY CLOSED ENUMERATION ══════════════════════════════════════════

    /// <summary>
    /// Every registered mirror holds exactly the member-name set it mirrors. Both directions are reported,
    /// apart: a member the site does not carry (a rename, or a member added on the C# side and never
    /// mirrored) and a key naming no member (a stale entry, or a rename applied on one side only). They
    /// meet at the same <c>undefined</c> lookup and they have different causes and different repairs, so
    /// a net count would cancel exactly the case worth seeing.
    /// </summary>
    [Fact]
    public void EveryRegisteredMirror_ListsExactlyTheMemberNamesOfWhatItMirrors()
    {
        var failures = new List<string>();

        foreach (var site in Mirrors())
        {
            var expected = MemberNamesOf(site.EnumTypeNames);
            var actual = ExtractMirror(site);

            var missing = expected.Except(actual, StringComparer.Ordinal).ToList();
            var stale = actual.Except(expected, StringComparer.Ordinal).ToList();

            if (missing.Count == 0 && stale.Count == 0)
            {
                continue;
            }

            var vocabulary = string.Join(" + ", site.EnumTypeNames);
            var lines = new List<string>
            {
                $"{site.RelativePath} — {Describe(site)} — does not mirror {vocabulary}.",
            };
            if (missing.Count > 0)
            {
                lines.Add($"    NOT CARRIED HERE: {string.Join(", ", missing)}");
                lines.Add($"    → {site.WhatBreaksIfAMemberIsMissing}");
            }

            if (stale.Count > 0)
            {
                lines.Add($"    NAMES NO MEMBER: {string.Join(", ", stale)}");
                lines.Add("    → nothing on the wire can ever equal these, so whatever they select is dead.");
            }

            failures.Add(string.Join(Environment.NewLine, lines));
        }

        Assert.True(
            failures.Count == 0,
            "A member's SPELLING is a published string, and these sites no longer agree with it. No compiler "
            + "on either side of the wire checks any of this."
            + Environment.NewLine + Environment.NewLine
            + string.Join(Environment.NewLine + Environment.NewLine, failures));
    }

    private static string Describe(MirrorSite site) => site.Shape switch
    {
        SiteShape.TsUnionAlias => $"the string-literal union `type {site.Anchor}`",
        SiteShape.TsObjectBlock => $"the `{site.Anchor}` resource block",
        SiteShape.TsRecordConst => $"the object literal bound to `{site.Anchor}`",
        SiteShape.TsListConst => $"the list bound to `{site.Anchor}`",
        SiteShape.TsSwitchCases => $"the switch inside `{site.Anchor}`",
        SiteShape.XamlTriggerValues => $"every DataTrigger bound to `{{Binding {site.Anchor}}}`",
        _ => site.Anchor,
    };

    // ══ FACT 4 — MEMBERSHIP AT EVERY SCATTERED COMPARISON ══════════════════════════════════════════

    /// <summary>
    /// Sweeps the three declared corpora for "a registered carrier compared against a string literal" and
    /// requires every such literal to name a current member. This half does NOT read the mirror registry to
    /// decide where to look, which is what lets it find dependents nobody wrote down — including, on the
    /// run that introduced this file, several the measurement this task was handed had not named.
    /// </summary>
    [Fact]
    public void EveryComparandAgainstARegisteredCarrier_NamesACurrentMember()
    {
        var failures = new List<string>();

        foreach (var (carrier, hits) in SweepAllCarriers())
        {
            var members = MemberNamesOf(carrier.EnumTypeName);
            foreach (var hit in hits)
            {
                if (!members.Contains(hit.Literal, StringComparer.Ordinal))
                {
                    failures.Add(
                        $"{hit.RelativePath}: `{hit.Carrier}` is compared against \"{hit.Literal}\", which is not "
                        + $"a member of {carrier.EnumTypeName} ({string.Join(", ", members)}). Nothing this "
                        + "product can emit will ever equal it, so this branch is unreachable — silently.");
                }
            }
        }

        Assert.True(failures.Count == 0, string.Join(Environment.NewLine, failures));
    }

    // ══ FACT 5 — THE CENSUS THAT CAN REFUTE THE MIRROR REGISTRY ════════════════════════════════════

    /// <summary>
    /// The registry above is a claim about WHERE the closed enumerations are, and a claim like that is
    /// worth nothing when it is checked by opening the files it already names. This sweeps the browser
    /// client for declarations TYPED on an exported enum — a union alias named for it, a
    /// <c>Record&lt;Enum, …&gt;</c>, an <c>Enum[]</c> — without consulting the registry, and requires each
    /// one to be registered. It is how <c>FIG_KEY</c> entered this file.
    /// </summary>
    [Fact]
    public void EveryTsTypeAliasOrTableNamedForAPublishedEnum_IsARegisteredMirror()
    {
        var enumNames = ExportedEnums().Select(t => t.Name).ToHashSet(StringComparer.Ordinal);
        var registered = Mirrors()
            .Select(m => $"{m.RelativePath}::{m.Anchor}")
            .ToHashSet(StringComparer.Ordinal);

        var unregistered = new List<string>();

        var aliasPattern = new Regex(@"^\s*(?:export\s+)?type\s+(?<name>[A-Za-z_$][\w$]*)\s*=", RegexOptions.Multiline);
        var tablePattern = new Regex(
            @"^\s*(?:export\s+)?const\s+(?<const>[A-Za-z_$][\w$]*)\s*:\s*(?:Record\s*<\s*(?<enum>[A-Za-z_$][\w$]*)\s*,|(?<enum2>[A-Za-z_$][\w$]*)\s*\[\s*\])",
            RegexOptions.Multiline);

        foreach (var file in WebFiles())
        {
            var text = File.ReadAllText(file);
            var relative = Relative(file);

            foreach (Match m in aliasPattern.Matches(text))
            {
                var name = m.Groups["name"].Value;
                if (enumNames.Contains(name) && !registered.Contains($"{relative}::{name}"))
                {
                    unregistered.Add($"{relative}: `type {name}` mirrors an exported enum and is not registered.");
                }
            }

            foreach (Match m in tablePattern.Matches(text))
            {
                var enumName = m.Groups["enum"].Success ? m.Groups["enum"].Value : m.Groups["enum2"].Value;
                var constName = m.Groups["const"].Value;
                if (enumNames.Contains(enumName) && !registered.Contains($"{relative}::{constName}"))
                {
                    unregistered.Add(
                        $"{relative}: `{constName}` is a table keyed on {enumName} and is not registered.");
                }
            }
        }

        Assert.True(
            unregistered.Count == 0,
            "The browser client holds closed enumerations over this assembly's enums that this file's "
            + "registry does not know about, so nothing checks them against the member set:"
            + Environment.NewLine + string.Join(Environment.NewLine, unregistered)
            + Environment.NewLine
            + "Register each one with what breaks if a member goes missing from it. This sweep is the only "
            + "thing here that can tell the registry it is incomplete, and it sees only what TypeScript "
            + "TYPES — see ThingsThisInstrumentCannotSee for what it still misses.");
    }

    // ══ FACT 6 — THE UNIVERSAL NEGATIVES, CHECKED BY SOMETHING THAT COULD REFUTE THEM ══════════════

    /// <summary>
    /// Two enums are recorded above as having no comparand in the declared corpus. A universal negative is
    /// only worth the census that could refute it — never the reassurance of finding the members it names
    /// somewhere else — so this asserts the census comes back EMPTY, and says what to do when it stops
    /// doing so.
    /// </summary>
    [Fact]
    public void TheEnumsRecordedAsHavingNoComparand_StillHaveNone()
    {
        var found = new List<string>();

        foreach (var (carrier, hits) in SweepAllCarriers())
        {
            if (carrier.Expected != Presence.None)
            {
                continue;
            }

            foreach (var hit in hits)
            {
                found.Add($"{hit.RelativePath}: `{hit.Carrier}` is compared against \"{hit.Literal}\".");
            }
        }

        Assert.True(
            found.Count == 0,
            "This file records that no registered carrier in the declared corpus compares against "
            + "DriverHealthState or CommandArgumentType. That is no longer true:"
            + Environment.NewLine + string.Join(Environment.NewLine, found)
            + Environment.NewLine
            + "Either the comparison is real — in which case the enum has crossed out of the type system and "
            + "needs registering like the others — or the carrier name has been reused for something else, in "
            + "which case narrow it. Do not delete the claim to make this green.");
    }

    // ══ FACT 7 — A GREEN HERE IS NOT A GREEN FROM AN EMPTY CORPUS ══════════════════════════════════

    /// <summary>
    /// Every assertion above is a sweep, and every sweep over nothing passes. This is the check that a
    /// green means "looked and found agreement" rather than "looked at nothing": the three corpus roots
    /// enumerate files, and each carrier group recorded as <see cref="Presence.AtLeastOne"/> really does
    /// find comparands. Deliberately a floor and not an exact count — a NEW comparison somewhere in the
    /// browser client is a legitimate change and must not turn this red, while zero is always this
    /// instrument being broken and never the codebase being clean.
    /// </summary>
    [Fact]
    public void TheCorpusThisInstrumentScans_IsPresentAndPopulated()
    {
        Assert.NotEmpty(WebFiles());
        Assert.NotEmpty(XamlFiles());
        Assert.NotEmpty(CSharpFiles());

        var starved = new List<string>();
        foreach (var (carrier, hits) in SweepAllCarriers())
        {
            if (carrier.Expected == Presence.AtLeastOne && hits.Count == 0)
            {
                starved.Add(
                    $"{carrier.EnumTypeName} in {carrier.Corpus}: carrier(s) "
                    + string.Join("/", carrier.CarrierNames) + " matched nothing.");
            }
        }

        Assert.True(
            starved.Count == 0,
            "A sweep that finds nothing passes every assertion built on it. These groups are recorded as "
            + "having comparands and no longer do — a moved corpus, a renamed carrier, or a broken pattern, "
            + "not a clean codebase:"
            + Environment.NewLine + string.Join(Environment.NewLine, starved));
    }

    // ══ EXTRACTION ═════════════════════════════════════════════════════════════════════════════════
    //
    // Every extractor below FAILS CLOSED. An anchor that matches zero times, or more than once, throws
    // instead of returning an empty set: a site that quietly stops being found would turn set equality
    // into a comparison against nothing, which is the one way an assertion here could go green while
    // measuring nothing at all.

    private static IReadOnlyList<string> ExtractMirror(MirrorSite site)
    {
        var text = ReadSite(site.RelativePath);
        return site.Shape switch
        {
            SiteShape.TsUnionAlias => ExtractUnionAlias(text, site),
            SiteShape.TsObjectBlock => ExtractObjectKeys(text, FindObjectBlock(text, site), site),
            SiteShape.TsRecordConst => ExtractObjectKeys(text, FindConstInitializer(text, site, '{'), site),
            SiteShape.TsListConst => ExtractQuoted(Span(text, FindConstInitializer(text, site, '[')), site),
            SiteShape.TsSwitchCases => ExtractSwitchCases(text, site),
            SiteShape.XamlTriggerValues => ExtractXamlTriggerValues(text, site),
            _ => throw new InvalidOperationException($"Unhandled site shape {site.Shape}."),
        };
    }

    private static (int Open, int Close) FindObjectBlock(string text, MirrorSite site)
    {
        var pattern = new Regex($@"^[ \t]*{Regex.Escape(site.Anchor)}\s*:\s*\{{", RegexOptions.Multiline);
        var matches = pattern.Matches(text);
        RequireExactlyOne(matches.Count, site, $"a `{site.Anchor}:` property opening a block");
        var open = matches[0].Index + matches[0].Length - 1;
        return (open, MatchDelimiter(text, open, site));
    }

    private static (int Open, int Close) FindConstInitializer(string text, MirrorSite site, char opener)
    {
        var pattern = new Regex(
            $@"^[ \t]*(?:export\s+)?const\s+{Regex.Escape(site.Anchor)}\b", RegexOptions.Multiline);
        var matches = pattern.Matches(text);
        RequireExactlyOne(matches.Count, site, $"a `const {site.Anchor}` declaration");

        // The assignment `=`, then the initializer's opening delimiter. Looked for in that order because a
        // type annotation can carry the same delimiter before the `=` ever appears — `CLASS_ICON`'s own
        // `Record<DeviceClass, React.ComponentType<{ className?: string }>>` is exactly that shape, and
        // taking "the first `{` after the name" would extract the type instead of the table.
        var cursor = SkipToAssignment(text, matches[0].Index + matches[0].Length, site);
        var open = IndexOfDelimiter(text, cursor, opener, site);
        return (open, MatchDelimiter(text, open, site));
    }

    private static IReadOnlyList<string> ExtractUnionAlias(string text, MirrorSite site)
    {
        var pattern = new Regex(
            $@"^[ \t]*(?:export\s+)?type\s+{Regex.Escape(site.Anchor)}\s*=(?<body>[^\r\n]*)", RegexOptions.Multiline);
        var matches = pattern.Matches(text);
        RequireExactlyOne(matches.Count, site, $"a `type {site.Anchor} =` alias on one line");
        return ExtractQuoted(matches[0].Groups["body"].Value, site);
    }

    private static IReadOnlyList<string> ExtractSwitchCases(string text, MirrorSite site)
    {
        var pattern = new Regex(
            $@"^[ \t]*(?:export\s+)?function\s+{Regex.Escape(site.Anchor)}\b", RegexOptions.Multiline);
        var matches = pattern.Matches(text);
        RequireExactlyOne(matches.Count, site, $"a `function {site.Anchor}` declaration");

        var open = IndexOfDelimiter(text, matches[0].Index + matches[0].Length, '{', site);
        var close = MatchDelimiter(text, open, site);
        var body = text[open..(close + 1)];

        var cases = Regex.Matches(body, @"case\s+""(?<v>[^""]*)""\s*:")
            .Select(m => m.Groups["v"].Value)
            .Distinct(StringComparer.Ordinal)
            .ToList();
        RequireNonEmpty(cases.Count, site, "string `case` labels inside its switch");
        return cases;
    }

    private static IReadOnlyList<string> ExtractXamlTriggerValues(string text, MirrorSite site)
    {
        var pattern = new Regex(
            $@"<DataTrigger\b[^>]*Binding\s*=\s*""\{{Binding\s+{Regex.Escape(site.Anchor)}\s*\}}""[^>]*Value\s*=\s*""(?<v>[^""]*)""");
        var values = pattern.Matches(text)
            .Select(m => m.Groups["v"].Value)
            .Distinct(StringComparer.Ordinal)
            .ToList();
        RequireNonEmpty(values.Count, site, $"DataTriggers bound to {{Binding {site.Anchor}}}");
        return values;
    }

    private static IReadOnlyList<string> ExtractQuoted(string body, MirrorSite site)
    {
        var values = Regex.Matches(body, @"""(?<v>[^""]*)""")
            .Select(m => m.Groups["v"].Value)
            .Distinct(StringComparer.Ordinal)
            .ToList();
        RequireNonEmpty(values.Count, site, "quoted string literals");
        return values;
    }

    /// <summary>The keys at the TOP level of an object literal only. Depth matters: <c>VERDICT_META</c>'s
    /// values are themselves objects, and a flat key sweep would harvest <c>status</c> and <c>key</c> from
    /// each of them and compare THAT against the member set.</summary>
    private static IReadOnlyList<string> ExtractObjectKeys(string text, (int Open, int Close) block, MirrorSite site)
    {
        var keys = new List<string>();
        var depth = 0;
        var segmentStart = block.Open + 1;

        for (var i = block.Open; i <= block.Close; i++)
        {
            var c = text[i];
            if (IsQuote(c))
            {
                i = SkipQuoted(text, i, site);
                continue;
            }

            if (IsCommentStart(text, i))
            {
                i = SkipComment(text, i, site);
                continue;
            }

            if (c is '{' or '[' or '(')
            {
                depth++;
            }
            else if (c is '}' or ']' or ')')
            {
                depth--;
                if (depth == 0)
                {
                    AddKey(keys, text[segmentStart..i]);
                    break;
                }
            }
            else if (c == ',' && depth == 1)
            {
                AddKey(keys, text[segmentStart..i]);
                segmentStart = i + 1;
            }
        }

        RequireNonEmpty(keys.Count, site, "top-level keys");
        return keys.Distinct(StringComparer.Ordinal).ToList();
    }

    private static void AddKey(List<string> keys, string segment)
    {
        var m = Regex.Match(segment, @"^\s*(?:""(?<q>[^""]*)""|'(?<s>[^']*)'|(?<b>[A-Za-z_$][\w$]*))\s*:");
        if (!m.Success)
        {
            return;
        }

        var value = m.Groups["q"].Success ? m.Groups["q"].Value
            : m.Groups["s"].Success ? m.Groups["s"].Value
            : m.Groups["b"].Value;
        keys.Add(value);
    }

    private static string Span(string text, (int Open, int Close) block) => text[block.Open..(block.Close + 1)];

    private static int SkipToAssignment(string text, int from, MirrorSite site)
    {
        for (var i = from; i < text.Length; i++)
        {
            var c = text[i];
            if (IsQuote(c))
            {
                i = SkipQuoted(text, i, site);
                continue;
            }

            if (IsCommentStart(text, i))
            {
                i = SkipComment(text, i, site);
                continue;
            }

            if (c == '=' && (i + 1 >= text.Length || (text[i + 1] != '=' && text[i + 1] != '>')))
            {
                return i + 1;
            }
        }

        throw Unanchored(site, "an `=` assigning its initializer");
    }

    private static int IndexOfDelimiter(string text, int from, char delimiter, MirrorSite site)
    {
        for (var i = from; i < text.Length; i++)
        {
            var c = text[i];
            if (IsQuote(c))
            {
                i = SkipQuoted(text, i, site);
                continue;
            }

            if (IsCommentStart(text, i))
            {
                i = SkipComment(text, i, site);
                continue;
            }

            if (c == delimiter)
            {
                return i;
            }
        }

        throw Unanchored(site, $"an opening `{delimiter}`");
    }

    private static int MatchDelimiter(string text, int openIndex, MirrorSite site)
    {
        var open = text[openIndex];
        var close = open switch { '{' => '}', '[' => ']', '(' => ')', _ => '\0' };
        var depth = 0;

        for (var i = openIndex; i < text.Length; i++)
        {
            var c = text[i];
            if (IsQuote(c))
            {
                i = SkipQuoted(text, i, site);
                continue;
            }

            if (IsCommentStart(text, i))
            {
                i = SkipComment(text, i, site);
                continue;
            }

            if (c == open)
            {
                depth++;
            }
            else if (c == close)
            {
                depth--;
                if (depth == 0)
                {
                    return i;
                }
            }
        }

        throw Unanchored(site, $"a closing `{close}`");
    }

    private static bool IsQuote(char c) => c is '"' or '\'' or '`';

    private static bool IsCommentStart(string text, int i) =>
        text[i] == '/' && i + 1 < text.Length && (text[i + 1] == '/' || text[i + 1] == '*');

    private static int SkipQuoted(string text, int start, MirrorSite site)
    {
        var quote = text[start];
        for (var i = start + 1; i < text.Length; i++)
        {
            if (text[i] == '\\')
            {
                i++;
                continue;
            }

            if (text[i] == quote)
            {
                return i;
            }
        }

        throw Unanchored(site, $"a closing {quote}");
    }

    private static int SkipComment(string text, int start, MirrorSite site)
    {
        if (text[start + 1] == '/')
        {
            var end = text.IndexOf('\n', start);
            return end < 0 ? text.Length - 1 : end;
        }

        var close = text.IndexOf("*/", start + 2, StringComparison.Ordinal);
        if (close < 0)
        {
            throw Unanchored(site, "a closing `*/`");
        }

        return close + 1;
    }

    private static void RequireExactlyOne(int count, MirrorSite site, string what)
    {
        if (count == 1)
        {
            return;
        }

        throw new InvalidOperationException(
            $"{site.RelativePath}: expected exactly one {what}, found {count}. "
            + (count == 0
                ? "The anchor is gone — renamed, deleted, or reshaped. This registry points by NAME so that "
                  + "exactly this makes noise: a site that stops being found stops being checked, and an "
                  + "assertion nobody notices has stopped being made is worse than no assertion."
                : "The anchor is ambiguous, so this extractor cannot say which occurrence is the contract. "
                  + "Give the site a distinct name rather than teaching this to guess."));
    }

    private static void RequireNonEmpty(int count, MirrorSite site, string what)
    {
        if (count > 0)
        {
            return;
        }

        throw new InvalidOperationException(
            $"{site.RelativePath}: found no {what} at `{site.Anchor}`. An empty extraction compares the member "
            + "set against nothing and passes; that is not a measurement.");
    }

    private static InvalidOperationException Unanchored(MirrorSite site, string what) =>
        new($"{site.RelativePath}: could not find {what} for `{site.Anchor}`. "
            + "Fix the extractor or the registry — do not let the site go unread.");

    // ══ THE CARRIER SWEEP ══════════════════════════════════════════════════════════════════════════

    private sealed record CarrierHit(string RelativePath, string Carrier, string Literal);

    private static IReadOnlyList<(CarrierPattern Carrier, IReadOnlyList<CarrierHit> Hits)> SweepAllCarriers()
    {
        var results = new List<(CarrierPattern, IReadOnlyList<CarrierHit>)>();
        foreach (var carrier in Carriers())
        {
            results.Add((carrier, Sweep(carrier)));
        }

        return results;
    }

    private static IReadOnlyList<CarrierHit> Sweep(CarrierPattern carrier)
    {
        var names = string.Join("|", carrier.CarrierNames.Select(Regex.Escape));
        var hits = new List<CarrierHit>();

        var files = carrier.Corpus switch
        {
            CorpusKind.WebTypeScript => WebFiles(),
            CorpusKind.WpfMarkup => XamlFiles(),
            CorpusKind.ProductCSharp => CSharpFiles(),
            _ => throw new InvalidOperationException($"Unhandled corpus {carrier.Corpus}."),
        };

        foreach (var file in files)
        {
            var text = File.ReadAllText(file);
            var relative = Relative(file);

            switch (carrier.Corpus)
            {
                case CorpusKind.WebTypeScript:
                    // `x.deviceClass === "Iot"` and its negation, in either order of operands.
                    foreach (Match m in Regex.Matches(text, $@"\b(?<c>{names})\b\s*(?:===|!==)\s*""(?<v>[^""]*)"""))
                    {
                        hits.Add(new CarrierHit(relative, m.Groups["c"].Value, m.Groups["v"].Value));
                    }

                    foreach (Match m in Regex.Matches(text, $@"""(?<v>[^""]*)""\s*(?:===|!==)\s*(?:[A-Za-z_$][\w$]*\s*[?!]?\.\s*)*\b(?<c>{names})\b"))
                    {
                        hits.Add(new CarrierHit(relative, m.Groups["c"].Value, m.Groups["v"].Value));
                    }

                    // `switch (result.outcome) { case "Applied": … }` — the same dependency written the
                    // other way round, and the shape the write path actually uses.
                    foreach (Match m in Regex.Matches(
                        text, $@"switch\s*\(\s*(?:[A-Za-z_$][\w$]*\s*[?!]?\.\s*)*\b(?<c>{names})\b\s*\)"))
                    {
                        var open = text.IndexOf('{', m.Index + m.Length);
                        if (open < 0)
                        {
                            continue;
                        }

                        var close = MatchSwitchBody(text, open);
                        foreach (Match c in Regex.Matches(text[open..close], @"case\s+""(?<v>[^""]*)""\s*:"))
                        {
                            hits.Add(new CarrierHit(relative, m.Groups["c"].Value, c.Groups["v"].Value));
                        }
                    }

                    break;

                case CorpusKind.WpfMarkup:
                    foreach (Match m in Regex.Matches(
                        text,
                        $@"<DataTrigger\b[^>]*Binding\s*=\s*""\{{Binding\s+(?<c>{names})\s*\}}""[^>]*Value\s*=\s*""(?<v>[^""{{}}]*)"""))
                    {
                        hits.Add(new CarrierHit(relative, m.Groups["c"].Value, m.Groups["v"].Value));
                    }

                    break;

                case CorpusKind.ProductCSharp:
                    // The SQL arms: the value has left the C# type system entirely and is still branched on.
                    // Comments are swept too, deliberately — a doc comment on the published contract that
                    // restates `reading_kind = 'ProcessResult'` is itself a spelling a third-party author
                    // reads, and it goes stale in exactly the same way the query does.
                    foreach (Match m in Regex.Matches(text, $@"\b(?<c>{names})\b\s*(?:=|<>|!=)\s*'(?<v>[^']*)'"))
                    {
                        hits.Add(new CarrierHit(relative, m.Groups["c"].Value, m.Groups["v"].Value));
                    }

                    foreach (Match m in Regex.Matches(
                        text, $@"\b(?<c>{names})\b\s+IN\s*\(\s*(?<vals>'[^)]*)\)", RegexOptions.IgnoreCase))
                    {
                        foreach (Match v in Regex.Matches(m.Groups["vals"].Value, @"'(?<v>[^']*)'"))
                        {
                            hits.Add(new CarrierHit(relative, m.Groups["c"].Value, v.Groups["v"].Value));
                        }
                    }

                    break;

                default:
                    throw new InvalidOperationException($"Unhandled corpus {carrier.Corpus}.");
            }
        }

        return hits;
    }

    private static int MatchSwitchBody(string text, int open)
    {
        var depth = 0;
        for (var i = open; i < text.Length; i++)
        {
            if (text[i] == '{')
            {
                depth++;
            }
            else if (text[i] == '}')
            {
                depth--;
                if (depth == 0)
                {
                    return i;
                }
            }
        }

        return text.Length;
    }
}
