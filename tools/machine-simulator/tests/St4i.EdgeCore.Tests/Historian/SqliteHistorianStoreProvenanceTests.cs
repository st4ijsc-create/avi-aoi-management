using Microsoft.Data.Sqlite;
using St4i.EdgeCore.Historian;
using Xunit;

namespace St4i.EdgeCore.Tests.Historian;

/// <summary>
/// SM-2 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-2-brief.md) — the
/// durable half of "fabricated data must never silently blend into a number a customer reads": the new
/// <c>is_fabricated</c> column (migration v2), what a pre-migration row (<see langword="null"/>, this
/// project's deliberate "Unknown provenance" state) means to a query, and the "real-presence gate" rule
/// every customer-facing historian query/aggregate applies by default:
///
/// <b>Rule:</b> for a query's own filtered scope (machine/time/serial/etc., exactly as requested), if at
/// least one row in that scope is explicitly known to be real (<c>is_fabricated = 0</c>), the query
/// additionally excludes every row that is NOT explicitly real — both explicitly-fabricated (1) AND
/// unknown-provenance (<see langword="null"/>) rows are dropped, since once we know real data exists in
/// this exact scope, an uncertain row can no longer be trusted to belong with it. If NO row in that scope
/// is explicitly real (a pure-demo scope, or a scope containing only pre-migration/unknown rows), no
/// filter is applied at all — the scope's data passes through byte-identical to before this task, which is
/// what keeps a pure-demo historian/OEE view showing its own numbers and keeps a pre-migration row
/// readable rather than silently vanishing the moment nothing can disprove it might be fabricated.
///
/// This is a SEPARATE file (not folded into <see cref="SqliteHistorianStoreQueryTests"/>) specifically so
/// none of the pre-existing WS-A-T2/T3 fixtures (which never set <c>IsFabricated</c>, i.e. legitimately
/// represent "unknown provenance" test data under the new column) need to change — this file's own tests
/// are the ones that exercise the gate explicitly, with fixtures that deliberately tag real/fabricated.
/// </summary>
public sealed class SqliteHistorianStoreProvenanceTests : IDisposable
{
    private readonly List<string> _tempDirs = new();

    public void Dispose()
    {
        foreach (var dir in _tempDirs)
        {
            try { Directory.Delete(dir, recursive: true); } catch { /* best-effort cleanup */ }
        }
    }

    private string NewTempDir()
    {
        var dir = Directory.CreateTempSubdirectory("st4i-historian-provenance-tests-").FullName;
        _tempDirs.Add(dir);
        return dir;
    }

    private SqliteHistorianStore NewStore() => new(NewTempDir());

    private static HistorianResultRecord MakeResult(
        string machineCode, string serialNumber, DateTimeOffset eventTime, bool? isFabricated, string verdict = "Pass") =>
        new(
            MachineCode: machineCode, DeviceClass: "Automation", MachineType: "MODBUS_TCP", ReadingKind: "ProcessResult",
            CycleCounter: 1, SerialNumber: serialNumber, Verdict: verdict,
            RecipeCode: null, RecipeVersion: null,
            KeyMetricName: null, KeyMetricValue: null, KeyMetricUnit: null,
            NgCount: 0, PointCount: 0,
            AckSuccess: true, AckDuplicate: false, AckQueued: false,
            GenealogyJson: null, MeasurementsJson: null,
            EventTimeUtc: eventTime, IngestedAtUtc: eventTime,
            TelemetrySamples: Array.Empty<TelemetrySampleRecord>(),
            IsFabricated: isFabricated);

    /// <summary>Inserts a row using the EXACT pre-SM-2 column list (no <c>is_fabricated</c> at all) —
    /// the most faithful simulation of "a row written before this column existed": SQLite leaves an
    /// omitted, no-default, nullable column as NULL on insert, so this row is genuinely indistinguishable
    /// at the storage layer from a real pre-migration row, not merely a record constructed with a null
    /// field via the current (post-migration) code path.</summary>
    private static void InsertLegacyShapeRow(string dbPath, string machineCode, string serialNumber, DateTimeOffset eventTime)
    {
        using var connection = new SqliteConnection($"Data Source={dbPath}");
        connection.Open();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            INSERT INTO historian_results
                (machine_code, device_class, machine_type, reading_kind, cycle_counter, serial_number, verdict,
                 recipe_code, recipe_version, key_metric_name, key_metric_value, key_metric_unit,
                 ng_count, point_count, ack_success, ack_duplicate, ack_queued,
                 genealogy_json, measurements_json, event_time_utc, ingested_at_utc)
            VALUES
                (@machine_code, 'Automation', 'MODBUS_TCP', 'ProcessResult', 1, @serial_number, 'Pass',
                 NULL, NULL, NULL, NULL, NULL,
                 0, 0, 1, 0, 0,
                 NULL, NULL, @event_time_utc, @event_time_utc);
            """;
        cmd.Parameters.AddWithValue("@machine_code", machineCode);
        cmd.Parameters.AddWithValue("@serial_number", serialNumber);
        cmd.Parameters.AddWithValue("@event_time_utc", eventTime.ToUniversalTime().ToString("O"));
        cmd.ExecuteNonQuery();
    }

    // ─────────────────────────────────────────────────────────────────────
    // 1. The column exists, round-trips, and a legacy (pre-migration-shape) row is still readable —
    //    classified Unknown (null), never silently dropped when nothing else in scope is real.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task AppendResultsAsync_RoundTripsIsFabricated_TrueAndFalse()
    {
        var store = NewStore();
        var now = DateTimeOffset.UtcNow;

        await store.AppendResultsAsync(new[] { MakeResult("DEMO-01", "SN-1", now, isFabricated: true) }, CancellationToken.None);
        await store.AppendResultsAsync(new[] { MakeResult("REAL-01", "SN-2", now, isFabricated: false) }, CancellationToken.None);

        var page = await store.QueryResultsAsync(
            new HistorianResultQuery(IncludeFabricated: true), CancellationToken.None);

        Assert.Equal(2, page.Total);
        Assert.Equal(true, page.Items.Single(i => i.Record.MachineCode == "DEMO-01").Record.IsFabricated);
        Assert.Equal(false, page.Items.Single(i => i.Record.MachineCode == "REAL-01").Record.IsFabricated);
    }

    [Fact]
    public async Task LegacyShapeRow_WithNoRealDataInScope_IsStillReadable_ClassifiedUnknown_AndIncluded()
    {
        var store = NewStore();
        var now = DateTimeOffset.UtcNow;
        InsertLegacyShapeRow(store.DbPath, "LEGACY-01", "SN-OLD", now);

        var page = await store.QueryResultsAsync(
            new HistorianResultQuery(MachineCode: "LEGACY-01"), CancellationToken.None);

        var row = Assert.Single(page.Items);
        Assert.Null(row.Record.IsFabricated); // Unknown — not real, not (explicitly) fabricated
        Assert.Equal("SN-OLD", row.Record.SerialNumber);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2. The real-presence gate — QueryResultsAsync.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task PureFabricatedScope_DefaultQuery_ReturnsEverything_Unfiltered()
    {
        var store = NewStore();
        var now = DateTimeOffset.UtcNow;
        await store.AppendResultsAsync(new[]
        {
            MakeResult("DEMO-01", "SN-1", now.AddMinutes(-2), isFabricated: true),
            MakeResult("DEMO-01", "SN-2", now.AddMinutes(-1), isFabricated: true),
        }, CancellationToken.None);

        var page = await store.QueryResultsAsync(new HistorianResultQuery(MachineCode: "DEMO-01"), CancellationToken.None);

        Assert.Equal(2, page.Total); // pure demo scope — never suppressed
    }

    [Fact]
    public async Task MixedScope_DefaultQuery_ReturnsOnlyExplicitlyRealRows()
    {
        var store = NewStore();
        var now = DateTimeOffset.UtcNow;
        await store.AppendResultsAsync(new[]
        {
            MakeResult("MIX-01", "SN-F1", now.AddMinutes(-5), isFabricated: true),
            MakeResult("MIX-01", "SN-F2", now.AddMinutes(-4), isFabricated: true),
            MakeResult("MIX-01", "SN-R1", now.AddMinutes(-3), isFabricated: false),
            MakeResult("MIX-01", "SN-R2", now.AddMinutes(-2), isFabricated: false),
            MakeResult("MIX-01", "SN-R3", now.AddMinutes(-1), isFabricated: false),
        }, CancellationToken.None);

        var page = await store.QueryResultsAsync(new HistorianResultQuery(MachineCode: "MIX-01"), CancellationToken.None);

        Assert.Equal(3, page.Total);
        Assert.All(page.Items, i => Assert.Equal(false, i.Record.IsFabricated));
        Assert.DoesNotContain(page.Items, i => i.Record.SerialNumber is "SN-F1" or "SN-F2");
    }

    [Fact]
    public async Task MixedScope_WithAnUnknownLegacyRowToo_UnknownIsExcludedAlongsideFabricated()
    {
        var store = NewStore();
        var now = DateTimeOffset.UtcNow;
        await store.AppendResultsAsync(new[]
        {
            MakeResult("MIX-02", "SN-F1", now.AddMinutes(-3), isFabricated: true),
            MakeResult("MIX-02", "SN-R1", now.AddMinutes(-2), isFabricated: false),
        }, CancellationToken.None);
        InsertLegacyShapeRow(store.DbPath, "MIX-02", "SN-OLD", now.AddMinutes(-1));

        var page = await store.QueryResultsAsync(new HistorianResultQuery(MachineCode: "MIX-02"), CancellationToken.None);

        var row = Assert.Single(page.Items);
        Assert.Equal("SN-R1", row.Record.SerialNumber);
    }

    [Fact]
    public async Task MixedScope_WithIncludeFabricatedTrue_BypassesTheGate_ReturnsEverything()
    {
        var store = NewStore();
        var now = DateTimeOffset.UtcNow;
        await store.AppendResultsAsync(new[]
        {
            MakeResult("MIX-03", "SN-F1", now.AddMinutes(-2), isFabricated: true),
            MakeResult("MIX-03", "SN-R1", now.AddMinutes(-1), isFabricated: false),
        }, CancellationToken.None);

        var page = await store.QueryResultsAsync(
            new HistorianResultQuery(MachineCode: "MIX-03", IncludeFabricated: true), CancellationToken.None);

        Assert.Equal(2, page.Total);
    }

    [Fact]
    public async Task PureRealScope_DefaultQuery_UnaffectedByTheGate()
    {
        var store = NewStore();
        var now = DateTimeOffset.UtcNow;
        await store.AppendResultsAsync(new[]
        {
            MakeResult("REAL-ONLY-01", "SN-1", now.AddMinutes(-2), isFabricated: false),
            MakeResult("REAL-ONLY-01", "SN-2", now.AddMinutes(-1), isFabricated: false),
        }, CancellationToken.None);

        var page = await store.QueryResultsAsync(new HistorianResultQuery(MachineCode: "REAL-ONLY-01"), CancellationToken.None);

        Assert.Equal(2, page.Total);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3. The real-presence gate — AggregateForOeeAsync (the OEE calculation surface).
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task AggregateForOee_MixedScope_DefaultExcludesFabricatedRows()
    {
        var store = NewStore();
        var to = DateTimeOffset.UtcNow;
        var from = to.AddHours(-1);

        var records = new List<HistorianResultRecord>();
        for (var i = 0; i < 5; i++) records.Add(MakeResult("OEE-MIX-01", $"SN-F{i}", to.AddMinutes(-(i + 10)), isFabricated: true));
        for (var i = 0; i < 2; i++) records.Add(MakeResult("OEE-MIX-01", $"SN-R{i}", to.AddMinutes(-(i + 1)), isFabricated: false));
        await store.AppendResultsAsync(records, CancellationToken.None);

        var agg = await store.AggregateForOeeAsync("OEE-MIX-01", from, to, CancellationToken.None);

        Assert.Equal(2, agg.TotalCount);
        Assert.Equal(2, agg.GoodCount); // both real rows seeded as "Pass"
    }

    [Fact]
    public async Task AggregateForOee_PureFabricatedScope_DefaultCountsEverything_DemoContinuity()
    {
        var store = NewStore();
        var to = DateTimeOffset.UtcNow;
        var from = to.AddHours(-1);

        var records = new List<HistorianResultRecord>();
        for (var i = 0; i < 4; i++) records.Add(MakeResult("OEE-DEMO-01", $"SN-F{i}", to.AddMinutes(-(i + 1)), isFabricated: true));
        await store.AppendResultsAsync(records, CancellationToken.None);

        var agg = await store.AggregateForOeeAsync("OEE-DEMO-01", from, to, CancellationToken.None);

        Assert.Equal(4, agg.TotalCount); // pure-demo OEE view stays exactly as before this task
    }

    [Fact]
    public async Task AggregateForOee_MixedScope_IncludeFabricatedTrue_ReportsTheBlendedTotal()
    {
        var store = NewStore();
        var to = DateTimeOffset.UtcNow;
        var from = to.AddHours(-1);

        var records = new List<HistorianResultRecord>();
        for (var i = 0; i < 3; i++) records.Add(MakeResult("OEE-MIX-02", $"SN-F{i}", to.AddMinutes(-(i + 10)), isFabricated: true));
        for (var i = 0; i < 2; i++) records.Add(MakeResult("OEE-MIX-02", $"SN-R{i}", to.AddMinutes(-(i + 1)), isFabricated: false));
        await store.AppendResultsAsync(records, CancellationToken.None);

        var agg = await store.AggregateForOeeAsync("OEE-MIX-02", from, to, CancellationToken.None, includeFabricated: true);

        Assert.Equal(5, agg.TotalCount);
    }
}
