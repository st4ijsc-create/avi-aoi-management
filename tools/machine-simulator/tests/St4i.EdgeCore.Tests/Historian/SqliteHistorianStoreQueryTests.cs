using Microsoft.Data.Sqlite;
using St4i.EdgeCore.Historian;
using Xunit;

namespace St4i.EdgeCore.Tests.Historian;

/// <summary>
/// WS-A-T3 — hardens the query/aggregate/prune surface of <see cref="SqliteHistorianStore"/> that
/// WS-A-T2 left for this task: telemetry explosion/scoping, cross-machine serial lookup, prune cascade +
/// row counting, <see cref="SqliteHistorianStore.GetStatsAsync"/>, and the subtle edge cases of
/// <see cref="SqliteHistorianStore.AggregateForOeeAsync"/> (unmatched trailing Start, Start-before-window
/// clipping, verdict/reading-kind filtering).
/// </summary>
public sealed class SqliteHistorianStoreQueryTests : IDisposable
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
        string verdict = "Pass",
        string readingKind = "ProcessResult",
        IReadOnlyList<TelemetrySampleRecord>? telemetry = null)
    {
        var evt = eventTime ?? new DateTimeOffset(2026, 7, 26, 10, 0, 0, TimeSpan.Zero);
        var ingested = ingestedAt ?? evt.AddSeconds(1);
        return new HistorianResultRecord(
            MachineCode: machineCode,
            DeviceClass: "AoiAvi",
            MachineType: "AOI",
            ReadingKind: readingKind,
            CycleCounter: 42,
            SerialNumber: serialNumber,
            Verdict: verdict,
            RecipeCode: "RC1",
            RecipeVersion: "v2",
            KeyMetricName: "torque",
            KeyMetricValue: 12.1,
            KeyMetricUnit: "Nm",
            NgCount: 0,
            PointCount: 0,
            AckSuccess: true,
            AckDuplicate: false,
            AckQueued: false,
            GenealogyJson: null,
            MeasurementsJson: null,
            EventTimeUtc: evt,
            IngestedAtUtc: ingested,
            TelemetrySamples: telemetry ?? Array.Empty<TelemetrySampleRecord>());
    }

    // ─────────────────────────────────────────────────────────────────────
    // 1. Telemetry explosion + scoping
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task AppendResultsAsync_explodes_telemetry_scoped_to_its_own_result_and_QueryTelemetryAsync_filters_by_machine_and_metric()
    {
        var store = NewStore();
        var baseTime = new DateTimeOffset(2026, 7, 26, 9, 0, 0, TimeSpan.Zero);

        var resultA = MakeResult(
            machineCode: "AOI-01", serialNumber: "SN-A", eventTime: baseTime,
            telemetry: new[]
            {
                new TelemetrySampleRecord("temperature", 40.0, "C", "good"),
                new TelemetrySampleRecord("pressure", 101.3, "kPa", "good"),
            });
        var resultB = MakeResult(
            machineCode: "AOI-02", serialNumber: "SN-B", eventTime: baseTime.AddMinutes(1),
            telemetry: new[] { new TelemetrySampleRecord("temperature", 55.0, "C", "good") });

        await store.AppendResultsAsync(new[] { resultA, resultB }, CancellationToken.None);

        var idA = Assert.Single((await store.QueryBySerialAsync("SN-A", CancellationToken.None))).Id;
        var idB = Assert.Single((await store.QueryBySerialAsync("SN-B", CancellationToken.None))).Id;

        // White-box: every telemetry row must carry the result_id of its OWN parent result, not the
        // other machine's — proves the FK scoping, not just the redundant machine_code column.
        using (var connection = new SqliteConnection($"Data Source={store.DbPath}"))
        {
            connection.Open();

            using var cmdA = connection.CreateCommand();
            cmdA.CommandText = "SELECT result_id FROM historian_telemetry WHERE machine_code = 'AOI-01';";
            using var readerA = cmdA.ExecuteReader();
            var rowsA = 0;
            while (readerA.Read())
            {
                rowsA++;
                Assert.Equal(idA, readerA.GetInt64(0));
            }
            Assert.Equal(2, rowsA);

            using var cmdB = connection.CreateCommand();
            cmdB.CommandText = "SELECT result_id FROM historian_telemetry WHERE machine_code = 'AOI-02';";
            using var readerB = cmdB.ExecuteReader();
            var rowsB = 0;
            while (readerB.Read())
            {
                rowsB++;
                Assert.Equal(idB, readerB.GetInt64(0));
            }
            Assert.Equal(1, rowsB);
        }

        var temperatureA = await store.QueryTelemetryAsync(
            "AOI-01", "temperature", baseTime.AddMinutes(-1), baseTime.AddMinutes(5), CancellationToken.None);
        var tempPoint = Assert.Single(temperatureA);
        Assert.Equal(baseTime, tempPoint.At);
        Assert.Equal(40.0, tempPoint.Value);

        var pressureA = await store.QueryTelemetryAsync(
            "AOI-01", "pressure", baseTime.AddMinutes(-1), baseTime.AddMinutes(5), CancellationToken.None);
        var pressurePoint = Assert.Single(pressureA);
        Assert.Equal(101.3, pressurePoint.Value);

        var temperatureB = await store.QueryTelemetryAsync(
            "AOI-02", "temperature", baseTime.AddMinutes(-1), baseTime.AddMinutes(5), CancellationToken.None);
        var bPoint = Assert.Single(temperatureB);
        Assert.Equal(55.0, bPoint.Value);

        // A different metric on the same machine returns nothing.
        var noMetric = await store.QueryTelemetryAsync(
            "AOI-01", "humidity", baseTime.AddMinutes(-1), baseTime.AddMinutes(5), CancellationToken.None);
        Assert.Empty(noMetric);

        // The same metric on a machine that never reported it returns nothing.
        var noMachine = await store.QueryTelemetryAsync(
            "AOI-03", "temperature", baseTime.AddMinutes(-1), baseTime.AddMinutes(5), CancellationToken.None);
        Assert.Empty(noMachine);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2. Serial cross-machine lookup
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task QueryBySerialAsync_returns_rows_from_both_machines_ordered_by_event_time_and_empty_for_unknown_serial()
    {
        var store = NewStore();
        var t1 = new DateTimeOffset(2026, 7, 26, 9, 0, 0, TimeSpan.Zero);
        var t2 = t1.AddMinutes(10);

        // Appended out of chronological order (B before A) to prove the ORDER BY is on event_time_utc,
        // not insertion/id order.
        var recordMachineB = MakeResult(machineCode: "AOI-02", serialNumber: "SN-SHARED", eventTime: t2);
        var recordMachineA = MakeResult(machineCode: "AOI-01", serialNumber: "SN-SHARED", eventTime: t1);
        await store.AppendResultsAsync(new[] { recordMachineB, recordMachineA }, CancellationToken.None);

        var rows = await store.QueryBySerialAsync("SN-SHARED", CancellationToken.None);

        Assert.Equal(2, rows.Count);
        Assert.Equal("AOI-01", rows[0].Record.MachineCode);
        Assert.Equal(t1, rows[0].Record.EventTimeUtc);
        Assert.Equal("AOI-02", rows[1].Record.MachineCode);
        Assert.Equal(t2, rows[1].Record.EventTimeUtc);

        var none = await store.QueryBySerialAsync("SN-DOES-NOT-EXIST", CancellationToken.None);
        Assert.Empty(none);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3. Prune cascade + count
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task PruneOlderThanAsync_deletes_old_results_with_their_telemetry_and_old_run_events_but_keeps_newer_rows()
    {
        var store = NewStore();
        var cutoff = new DateTimeOffset(2026, 7, 26, 12, 0, 0, TimeSpan.Zero);

        var oldRecords = new[]
        {
            MakeResult(serialNumber: "SN-OLD-1", eventTime: cutoff.AddHours(-3),
                telemetry: new[] { new TelemetrySampleRecord("temperature", 1.0, "C", "good") }),
            MakeResult(serialNumber: "SN-OLD-2", eventTime: cutoff.AddHours(-2),
                telemetry: new[] { new TelemetrySampleRecord("temperature", 2.0, "C", "good") }),
            MakeResult(serialNumber: "SN-OLD-3", eventTime: cutoff.AddMinutes(-1),
                telemetry: new[] { new TelemetrySampleRecord("temperature", 3.0, "C", "good") }),
        };
        var newRecords = new[]
        {
            MakeResult(serialNumber: "SN-NEW-1", eventTime: cutoff,
                telemetry: new[] { new TelemetrySampleRecord("temperature", 4.0, "C", "good") }),
            MakeResult(serialNumber: "SN-NEW-2", eventTime: cutoff.AddHours(1),
                telemetry: new[] { new TelemetrySampleRecord("temperature", 5.0, "C", "good") }),
        };
        await store.AppendResultsAsync(oldRecords.Concat(newRecords).ToArray(), CancellationToken.None);

        await store.AppendRunEventAsync(new HistorianRunEvent("Start", cutoff.AddHours(-4)), CancellationToken.None);
        await store.AppendRunEventAsync(new HistorianRunEvent("Stop", cutoff.AddMinutes(-30)), CancellationToken.None);
        await store.AppendRunEventAsync(new HistorianRunEvent("Start", cutoff.AddMinutes(30)), CancellationToken.None);

        var statsBefore = await store.GetStatsAsync(CancellationToken.None);
        Assert.Equal(5, statsBefore.ResultRowCount);
        Assert.Equal(5, statsBefore.TelemetryRowCount);

        var deletedCount = await store.PruneOlderThanAsync(cutoff, CancellationToken.None);

        Assert.Equal(3, deletedCount);

        var statsAfter = await store.GetStatsAsync(CancellationToken.None);
        Assert.Equal(2, statsAfter.ResultRowCount);
        Assert.Equal(2, statsAfter.TelemetryRowCount); // cascade removed the 3 old telemetry rows too

        var remaining = await store.QueryResultsAsync(new HistorianResultQuery(Limit: 10), CancellationToken.None);
        var remainingSerials = remaining.Items.Select(r => r.Record.SerialNumber).ToHashSet();
        Assert.Equal(new HashSet<string> { "SN-NEW-1", "SN-NEW-2" }, remainingSerials);

        foreach (var oldSerial in new[] { "SN-OLD-1", "SN-OLD-2", "SN-OLD-3" })
        {
            Assert.Empty(await store.QueryBySerialAsync(oldSerial, CancellationToken.None));
        }

        // Old telemetry is gone even when queried directly by machine/metric/time window.
        var oldTelemetryStillThere = await store.QueryTelemetryAsync(
            "AOI-01", "temperature", cutoff.AddHours(-5), cutoff.AddMinutes(-1), CancellationToken.None);
        Assert.Empty(oldTelemetryStillThere);

        var newTelemetryRemains = await store.QueryTelemetryAsync(
            "AOI-01", "temperature", cutoff.AddMinutes(-1), cutoff.AddHours(2), CancellationToken.None);
        Assert.Equal(2, newTelemetryRemains.Count);

        var remainingEvents = await store.QueryRunEventsAsync(cutoff.AddYears(-1), cutoff.AddYears(1), CancellationToken.None);
        var remainingEvent = Assert.Single(remainingEvents);
        Assert.Equal("Start", remainingEvent.EventType);
        Assert.Equal(cutoff.AddMinutes(30), remainingEvent.AtUtc);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 4. Stats
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetStatsAsync_returns_row_counts_min_max_event_time_and_a_positive_db_size()
    {
        var store = NewStore();
        var t1 = new DateTimeOffset(2026, 7, 26, 8, 0, 0, TimeSpan.Zero);
        var t2 = t1.AddHours(2);
        var t3 = t1.AddHours(5);

        var records = new[]
        {
            MakeResult(serialNumber: "SN-1", eventTime: t2,
                telemetry: new[]
                {
                    new TelemetrySampleRecord("temperature", 1.0, "C", "good"),
                    new TelemetrySampleRecord("pressure", 2.0, "kPa", "good"),
                }),
            MakeResult(serialNumber: "SN-2", eventTime: t1,
                telemetry: new[] { new TelemetrySampleRecord("temperature", 3.0, "C", "good") }),
            MakeResult(serialNumber: "SN-3", eventTime: t3),
        };
        await store.AppendResultsAsync(records, CancellationToken.None);

        var stats = await store.GetStatsAsync(CancellationToken.None);

        Assert.Equal(3, stats.ResultRowCount);
        Assert.Equal(3, stats.TelemetryRowCount);
        Assert.Equal(t1, stats.OldestEventTimeUtc);
        Assert.Equal(t3, stats.NewestEventTimeUtc);
        Assert.True(stats.DbSizeBytes > 0);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 5. AggregateForOee edge cases
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task AggregateForOeeAsync_with_no_run_events_returns_zero_RunTime()
    {
        var store = NewStore();
        var from = new DateTimeOffset(2026, 7, 26, 8, 0, 0, TimeSpan.Zero);
        var to = from.AddHours(4);

        var aggregate = await store.AggregateForOeeAsync("AOI-01", from, to, CancellationToken.None);

        Assert.Equal(TimeSpan.Zero, aggregate.RunTime);
        Assert.Equal(0, aggregate.TotalCount);
        Assert.Equal(0, aggregate.GoodCount);
    }

    [Fact]
    public async Task AggregateForOeeAsync_unmatched_trailing_Start_runs_to_the_query_To_clipped_to_the_window()
    {
        var store = NewStore();
        var from = new DateTimeOffset(2026, 7, 26, 8, 0, 0, TimeSpan.Zero);
        var to = from.AddHours(4);
        var start = from.AddHours(1);

        await store.AppendRunEventAsync(new HistorianRunEvent("Start", start), CancellationToken.None);

        var aggregate = await store.AggregateForOeeAsync("AOI-01", from, to, CancellationToken.None);

        Assert.Equal(to - start, aggregate.RunTime);
    }

    [Fact]
    public async Task AggregateForOeeAsync_Start_before_From_with_Stop_inside_window_clips_RunTime_at_From()
    {
        var store = NewStore();
        var from = new DateTimeOffset(2026, 7, 26, 8, 0, 0, TimeSpan.Zero);
        var to = from.AddHours(4);
        var start = from.AddHours(-1); // before the [from, to] window
        var stop = from.AddHours(2);   // inside the window

        await store.AppendRunEventAsync(new HistorianRunEvent("Start", start), CancellationToken.None);
        await store.AppendRunEventAsync(new HistorianRunEvent("Stop", stop), CancellationToken.None);

        var aggregate = await store.AggregateForOeeAsync("AOI-01", from, to, CancellationToken.None);

        Assert.Equal(stop - from, aggregate.RunTime);
    }

    [Fact]
    public async Task AggregateForOeeAsync_Start_and_Stop_fully_inside_window_gives_the_exact_interval()
    {
        var store = NewStore();
        var from = new DateTimeOffset(2026, 7, 26, 8, 0, 0, TimeSpan.Zero);
        var to = from.AddHours(4);
        var start = from.AddMinutes(30);
        var stop = from.AddHours(2);

        await store.AppendRunEventAsync(new HistorianRunEvent("Start", start), CancellationToken.None);
        await store.AppendRunEventAsync(new HistorianRunEvent("Stop", stop), CancellationToken.None);

        var aggregate = await store.AggregateForOeeAsync("AOI-01", from, to, CancellationToken.None);

        Assert.Equal(stop - start, aggregate.RunTime);
    }

    [Fact]
    public async Task AggregateForOeeAsync_TotalCount_excludes_Skip_GoodCount_is_Pass_plus_Warn_and_non_ProcessResult_kinds_never_count()
    {
        var store = NewStore();
        var from = new DateTimeOffset(2026, 7, 26, 8, 0, 0, TimeSpan.Zero);
        var to = from.AddHours(1);
        var t = from.AddMinutes(10);

        var records = new[]
        {
            MakeResult(serialNumber: "SN-PASS", eventTime: t, verdict: "Pass"),
            MakeResult(serialNumber: "SN-WARN", eventTime: t.AddMinutes(1), verdict: "Warn"),
            MakeResult(serialNumber: "SN-FAIL", eventTime: t.AddMinutes(2), verdict: "Fail"),
            MakeResult(serialNumber: "SN-SKIP", eventTime: t.AddMinutes(3), verdict: "Skip"),
            // Telemetry/Inspection-kind rows must NOT count toward Total even with a countable verdict.
            MakeResult(serialNumber: "SN-TELEMETRY-KIND", eventTime: t.AddMinutes(4), verdict: "Pass", readingKind: "Telemetry"),
            MakeResult(serialNumber: "SN-INSPECTION-KIND", eventTime: t.AddMinutes(5), verdict: "Pass", readingKind: "Inspection"),
        };
        await store.AppendResultsAsync(records, CancellationToken.None);

        var aggregate = await store.AggregateForOeeAsync("AOI-01", from, to, CancellationToken.None);

        Assert.Equal(3, aggregate.TotalCount); // Pass + Warn + Fail, Skip excluded
        Assert.Equal(2, aggregate.GoodCount);  // Pass + Warn
    }
}
