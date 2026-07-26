using St4i.EdgeCore.Historian;
using Xunit;

namespace St4i.EdgeCore.Tests.Historian;

/// <summary>
/// WS-A-T2 — <see cref="SqliteHistorianStore"/>: append/query for results and run-events, and
/// restart-survival (a fresh store instance pointed at the same directory still sees prior rows).
/// Comprehensive telemetry/serial/prune/stats/aggregate coverage is WS-A-T3's job; this task only proves
/// the store compiles against <see cref="IHistorianStore"/>, persists to a real SQLite file, and the
/// results/run-events paths this task's brief calls out round-trip correctly.
/// </summary>
public sealed class SqliteHistorianStoreTests : IDisposable
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
        var dir = Directory.CreateTempSubdirectory("st4i-historian-tests-").FullName;
        _tempDirs.Add(dir);
        return dir;
    }

    private SqliteHistorianStore NewStore() => new(NewTempDir());

    private static HistorianResultRecord MakeResult(
        string machineCode = "AOI-01",
        string serialNumber = "SN-0001",
        DateTimeOffset? eventTime = null,
        DateTimeOffset? ingestedAt = null,
        IReadOnlyList<TelemetrySampleRecord>? telemetry = null)
    {
        var evt = eventTime ?? new DateTimeOffset(2026, 7, 26, 10, 0, 0, TimeSpan.Zero);
        var ingested = ingestedAt ?? evt.AddSeconds(1);
        return new HistorianResultRecord(
            MachineCode: machineCode,
            DeviceClass: "AoiAvi",
            MachineType: "AOI",
            ReadingKind: "ProcessResult",
            CycleCounter: 42,
            SerialNumber: serialNumber,
            Verdict: "Pass",
            RecipeCode: "RC1",
            RecipeVersion: "v2",
            KeyMetricName: "torque",
            KeyMetricValue: 12.1,
            KeyMetricUnit: "Nm",
            NgCount: 1,
            PointCount: 4,
            AckSuccess: true,
            AckDuplicate: false,
            AckQueued: true,
            GenealogyJson: "{\"lot\":\"L100\"}",
            MeasurementsJson: "[{\"Point\":\"PT-01\"}]",
            EventTimeUtc: evt,
            IngestedAtUtc: ingested,
            TelemetrySamples: telemetry ?? Array.Empty<TelemetrySampleRecord>());
    }

    // ─────────────────────────────────────────────────────────────────────
    // 1. Single append -> db file created -> query round-trips every field
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task AppendResultsAsync_creates_the_db_file_and_QueryResultsAsync_round_trips_every_field()
    {
        var dir = NewTempDir();
        var store = new SqliteHistorianStore(dir);
        var record = MakeResult();

        await store.AppendResultsAsync(new[] { record }, CancellationToken.None);

        Assert.True(File.Exists(store.DbPath));
        Assert.Equal(Path.Combine(dir, "historian.db"), store.DbPath);

        var page = await store.QueryResultsAsync(
            new HistorianResultQuery(MachineCode: "AOI-01", From: record.EventTimeUtc.AddMinutes(-1), To: record.EventTimeUtc.AddMinutes(1)),
            CancellationToken.None);

        var row = Assert.Single(page.Items);
        Assert.Equal("AOI-01", row.Record.MachineCode);
        Assert.Equal("AoiAvi", row.Record.DeviceClass);
        Assert.Equal("AOI", row.Record.MachineType);
        Assert.Equal("ProcessResult", row.Record.ReadingKind);
        Assert.Equal(42L, row.Record.CycleCounter);
        Assert.Equal("SN-0001", row.Record.SerialNumber);
        Assert.Equal("Pass", row.Record.Verdict);
        Assert.Equal("RC1", row.Record.RecipeCode);
        Assert.Equal("v2", row.Record.RecipeVersion);
        Assert.Equal("torque", row.Record.KeyMetricName);
        Assert.Equal(12.1, row.Record.KeyMetricValue);
        Assert.Equal("Nm", row.Record.KeyMetricUnit);
        Assert.Equal(1, row.Record.NgCount);
        Assert.Equal(4, row.Record.PointCount);
        Assert.True(row.Record.AckSuccess);
        Assert.False(row.Record.AckDuplicate);
        Assert.True(row.Record.AckQueued);
        Assert.Equal("{\"lot\":\"L100\"}", row.Record.GenealogyJson);
        Assert.Equal("[{\"Point\":\"PT-01\"}]", row.Record.MeasurementsJson);
        Assert.Equal(record.EventTimeUtc, row.Record.EventTimeUtc);
        Assert.Equal(record.IngestedAtUtc, row.Record.IngestedAtUtc);
        Assert.Equal(1, page.Total);
        Assert.Equal(200, page.Limit);
        Assert.Equal(0, page.Offset);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2. Batch append (some with telemetry) -> newest-first, Total ignores LIMIT
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task AppendResultsAsync_batch_with_telemetry_QueryResultsAsync_returns_newest_first_and_Total_ignores_LIMIT()
    {
        var store = NewStore();
        var baseTime = new DateTimeOffset(2026, 7, 26, 9, 0, 0, TimeSpan.Zero);
        var records = new List<HistorianResultRecord>();
        for (var i = 0; i < 5; i++)
        {
            var telemetry = i == 2
                ? new[] { new TelemetrySampleRecord("temperature", 40.0 + i, "C", "good") }
                : Array.Empty<TelemetrySampleRecord>();
            records.Add(MakeResult(serialNumber: $"SN-{i:000}", eventTime: baseTime.AddMinutes(i), telemetry: telemetry));
        }

        await store.AppendResultsAsync(records, CancellationToken.None);

        var page = await store.QueryResultsAsync(
            new HistorianResultQuery(MachineCode: "AOI-01", From: baseTime.AddMinutes(-1), To: baseTime.AddMinutes(10), Limit: 2),
            CancellationToken.None);

        Assert.Equal(5, page.Total);
        Assert.Equal(2, page.Items.Count);
        Assert.Equal("SN-004", page.Items[0].Record.SerialNumber); // newest first (highest id)
        Assert.Equal("SN-003", page.Items[1].Record.SerialNumber);

        var telemetryPoints = await store.QueryTelemetryAsync(
            "AOI-01", "temperature", baseTime.AddMinutes(-1), baseTime.AddMinutes(10), CancellationToken.None);
        var point = Assert.Single(telemetryPoints);
        Assert.Equal(42.0, point.Value);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3. Restart survival
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_new_store_instance_pointed_at_the_same_directory_still_sees_prior_rows()
    {
        var dir = NewTempDir();
        var store1 = new SqliteHistorianStore(dir);
        var record = MakeResult(serialNumber: "SN-RESTART");
        await store1.AppendResultsAsync(new[] { record }, CancellationToken.None);

        var store2 = new SqliteHistorianStore(dir); // simulates a process restart
        var page = await store2.QueryResultsAsync(
            new HistorianResultQuery(MachineCode: "AOI-01", From: record.EventTimeUtc.AddMinutes(-1), To: record.EventTimeUtc.AddMinutes(1)),
            CancellationToken.None);

        var row = Assert.Single(page.Items);
        Assert.Equal("SN-RESTART", row.Record.SerialNumber);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 4. Run-events append + query round-trip
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task AppendRunEventAsync_and_QueryRunEventsAsync_round_trip_within_a_range()
    {
        var store = NewStore();
        var start = new DateTimeOffset(2026, 7, 26, 8, 0, 0, TimeSpan.Zero);
        var stop = start.AddMinutes(30);

        await store.AppendRunEventAsync(new HistorianRunEvent("Start", start, "shift begin"), CancellationToken.None);
        await store.AppendRunEventAsync(new HistorianRunEvent("Stop", stop, null), CancellationToken.None);

        var events = await store.QueryRunEventsAsync(start.AddMinutes(-5), stop.AddMinutes(5), CancellationToken.None);

        Assert.Equal(2, events.Count);
        Assert.Equal("Start", events[0].EventType);
        Assert.Equal(start, events[0].AtUtc);
        Assert.Equal("shift begin", events[0].Note);
        Assert.Equal("Stop", events[1].EventType);
        Assert.Equal(stop, events[1].AtUtc);
        Assert.Null(events[1].Note);
    }
}
