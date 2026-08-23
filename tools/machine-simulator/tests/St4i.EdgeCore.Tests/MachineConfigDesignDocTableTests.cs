using System.Text.RegularExpressions;
using St4i.EdgeCore.Config;
using Xunit;

/// <summary>
/// 🔴 <b>Task BP-1, 2026-08-24 — docs/owner-decisions.md item 71. The parameter table in
/// <c>docs/MACHINE_CONFIG_DESIGN.md</c> §3 has never had a mechanical check of any kind, and that — not
/// any one wrong row — is why four of its five rows drifted away from
/// <see cref="MachineParameterSchema"/> with nothing to notice.</b>
///
/// <para><b>WHY THE ABSENCE OF THIS FILE IS THE DEFECT, rather than the rows it catches.</b> Item 42 built
/// <see cref="MachineParameterSchema.IsConsumedBySimulator"/> and pinned it with
/// <c>UnconsumedConfigKindsTests</c>, so "does a simulator read this kind" became a measurement. Nothing
/// did the same for "does the design doc still name this kind's parameters". The recording rule actually in
/// force was <i>whichever row the current task happened to be standing on</i>: BL-1 was executing item 42,
/// whose subject is <c>weld_profile</c> and <c>dispense_program</c>, and it recorded the WELDER row's
/// mismatch in the doc (<c>:84-86</c>) and left the other four. That rule is uncorrelated with danger, and
/// measurably it picked the least dangerous of the four — WELDER is the only mismatched row that is BOTH
/// unconsumed by any simulator AND free of the operator-facing name collision that
/// <see cref="MachineParameterSchema.DispenseProgram"/>'s own doc comment records for DISPENSING.</para>
///
/// <para><b>🔴 WHAT THIS DOES NOT MEASURE, said where the result appears.</b>
/// <list type="number">
/// <item>It reads the doc's <c>code</c>-spanned keys only. A row that names a parameter in PROSE
/// ("lưu lượng", "lực ép") declares nothing this can compare, and before this task two of the five rows
/// were written that way — which is exactly why their drift was invisible. Prose rows now fail this
/// instrument rather than passing it, because a row it cannot read has been measured for nothing.</item>
/// <item>It does NOT read <c>server/services/recipes/recipeSchemas.ts</c>, the source §3 (<c>:59</c>) names
/// as the one it follows. That file is outside this product directory entirely and is not on disk in a
/// sparse checkout of this repository, so every scan ever run from <c>tools/machine-simulator</c> has
/// returned "no hits" for it rather than "not measured". The direction of each doc/code disagreement was
/// resolved against it BY HAND for this task and the finding is recorded in item 71; it is not
/// re-derivable here, and a green here must not be read as "the doc agrees with the server".</item>
/// <item>It says nothing about whether a parameter is CORRECT, in range, or reaches a simulator — those
/// are <c>MachineConfigStoreTests</c>, <c>ValidateRange</c> and <c>UnconsumedConfigKindsTests</c>
/// respectively.</item>
/// </list></para>
/// </summary>
public class MachineConfigDesignDocTableTests
{
    /// <summary>🔴 Keys the design doc lists that <see cref="MachineParameterSchema"/> deliberately does NOT
    /// implement, and the reason is ONE reason for all three: every parameter in that schema is a single
    /// number with a hard min/max band, and none of these three is that shape — <c>sequence[]</c> is an
    /// array of steps, <c>thresholds{}</c> is a free-form map, <c>retestPolicy</c> is a policy rather than a
    /// magnitude.
    ///
    /// <para>Before this task exactly ONE of the three was recorded (<c>thresholds{}</c>, at
    /// <see cref="MachineParameterSchema.IotSettings"/>). Listing them here makes the exclusion a declared
    /// set instead of a habit, and the non-vacuity assertion below stops a stale entry hiding a real
    /// drift.</para></summary>
    private static readonly Dictionary<string, string[]> DeclaredNonScalarOmissions = new(StringComparer.Ordinal)
    {
        [MachineParameterSchema.ScrewProgram] = ["sequence[]"],
        [MachineParameterSchema.IotSettings] = ["thresholds{}"],
        [MachineParameterSchema.AoiInspection] = ["retestPolicy"],
    };

    /// <summary>The five kinds §3's table declares, in the table's own order. A sixth kind added to the
    /// schema without a table row (or the reverse) reddens
    /// <see cref="The_table_and_the_schema_declare_the_same_five_kinds"/>.</summary>
    public static TheoryData<string> Kinds() =>
    [
        MachineParameterSchema.ScrewProgram,
        MachineParameterSchema.DispenseProgram,
        MachineParameterSchema.WeldProfile,
        MachineParameterSchema.IotSettings,
        MachineParameterSchema.AoiInspection,
    ];

    /// <summary>🔴 <b>Item 71's WITNESS.</b> Red before this task for FOUR of the five rows, in both
    /// directions: a key the doc names that the schema does not define, and a key the schema defines that
    /// the doc never names. The second direction is the one no reader-driven scan finds, because reading a
    /// doc row and looking each of its parameters up in code cannot see a parameter the row never
    /// mentions — and it is the direction DISPENSING's <c>temperature</c> hides in.</summary>
    [Theory]
    [MemberData(nameof(Kinds))]
    public void Every_table_row_names_exactly_the_parameters_the_schema_defines(string configKind)
    {
        var docKeys = DocKeysFor(configKind);
        var omitted = DeclaredNonScalarOmissions.TryGetValue(configKind, out var o) ? o : [];

        var expected = docKeys.Except(omitted, StringComparer.Ordinal)
            .OrderBy(k => k, StringComparer.Ordinal).ToArray();
        var actual = MachineParameterSchema.ParametersFor(configKind)
            .Select(d => d.Key).OrderBy(k => k, StringComparer.Ordinal).ToArray();

        Assert.Equal(expected, actual);
    }

    /// <summary>Non-vacuity for the exclusion list: an entry that the doc row no longer names is a stale
    /// exemption, and a stale exemption is how a real drift gets absorbed instead of reported.</summary>
    [Fact]
    public void Every_declared_omission_is_still_named_by_the_row_it_exempts()
    {
        foreach (var (configKind, omissions) in DeclaredNonScalarOmissions)
        {
            var docKeys = DocKeysFor(configKind);
            foreach (var omission in omissions)
            {
                Assert.Contains(omission, docKeys);
            }
        }

        Assert.Equal(3, DeclaredNonScalarOmissions.Sum(kv => kv.Value.Length));
    }

    /// <summary>The table and the schema must cover the same kind set — listed first, counted second. A
    /// kind present in one and absent from the other is a whole row nobody is comparing.</summary>
    [Fact]
    public void The_table_and_the_schema_declare_the_same_five_kinds()
    {
        var fromTable = ParseTable().Keys.OrderBy(k => k, StringComparer.Ordinal).ToArray();
        string[] fromSchema =
        [
            MachineParameterSchema.AoiInspection,
            MachineParameterSchema.DispenseProgram,
            MachineParameterSchema.IotSettings,
            MachineParameterSchema.ScrewProgram,
            MachineParameterSchema.WeldProfile,
        ];

        Assert.Equal(fromSchema, fromTable);
        Assert.Equal(5, fromTable.Length);
    }

    // ── the reader ────────────────────────────────────────────────────────────────────────────────

    private static string[] DocKeysFor(string configKind)
    {
        var table = ParseTable();
        Assert.True(
            table.TryGetValue(configKind, out var keys),
            $"docs/MACHINE_CONFIG_DESIGN.md §3 has no row for configKind \"{configKind}\". A schema kind with " +
            "no design-doc row is not a passing case — it is an unmeasured one.");
        return keys!;
    }

    /// <summary>configKind → the <c>code</c>-spanned parameter names in that row's third column. Reads the
    /// ONE table in §3, bounded by its header row and the first blank line after it, so a second table
    /// elsewhere in the file cannot silently become the corpus.</summary>
    private static Dictionary<string, string[]> ParseTable()
    {
        var lines = File.ReadAllLines(Path.Combine(
            MachineSimulatorRoot(), "docs", "MACHINE_CONFIG_DESIGN.md"));

        var header = Array.FindIndex(lines, l => l.StartsWith("| Loại máy | `configKind` | Tham số |", StringComparison.Ordinal));
        Assert.True(header >= 0,
            "Could not find §3's parameter table header in docs/MACHINE_CONFIG_DESIGN.md. The table moved or " +
            "was reshaped; this instrument read nothing and will not report a clean run.");

        var rows = new Dictionary<string, string[]>(StringComparer.Ordinal);
        for (var i = header + 2; i < lines.Length && lines[i].StartsWith('|'); i++)
        {
            var cells = lines[i].Split('|', StringSplitOptions.None);
            if (cells.Length < 4) continue;

            var kind = Backticked(cells[2]).FirstOrDefault();
            if (kind is null) continue;

            rows[kind] = Backticked(cells[3]);
        }

        return rows;
    }

    private static string[] Backticked(string cell) =>
        Regex.Matches(cell, "`([^`]+)`").Select(m => m.Groups[1].Value).ToArray();

    /// <summary>Walks up to the solution file, the same precondition <c>EnumSpellingContractTests</c>
    /// states: an instrument that cannot find its corpus FAILS rather than reporting a clean run.</summary>
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
            "This instrument reads docs/MACHINE_CONFIG_DESIGN.md off the tree; with no tree it has measured " +
            "nothing, and \"nothing measured\" must never read as \"nothing wrong\".");
    }
}
