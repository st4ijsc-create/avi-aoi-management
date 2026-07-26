using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using St4i.EdgeCore.Historian;
using St4i.EngineApi.Endpoints;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// Task 8 (WS-A) — endpoint coverage for the historian read surface (results/serial/telemetry/stats/
/// prune), calling the <c>internal</c> handler methods directly, same pattern as
/// <see cref="MachineSettingsEndpointsTests"/>/<see cref="ConfigEndpointsRequestBodyTests"/> (this
/// assembly is named in <c>St4i.EngineApi</c>'s <c>AssemblyInfo.cs</c> <c>InternalsVisibleTo</c>). The
/// "override the DI registration" the Task 8 brief calls for is, concretely, this file's own
/// <see cref="NewStore"/>: a real <see cref="SqliteHistorianStore"/> rooted at a per-test temp directory
/// (never the app's real <c>%ProgramData%</c> path <c>Program.cs</c>'s DI registration points at) — the
/// SAME "hand-construct the exact store type, no TestServer" convention
/// <see cref="MachineSettingsEndpointsTests.NewStore"/> already established for
/// <c>MachineConfigStore</c>. Seeding goes straight through <see cref="IHistorianStore.AppendResultsAsync"/>
/// (the real store, not a fake) so every read handler is exercised against genuine SQLite rows.
/// </summary>
public sealed class HistorianEndpointsReadTests
{
    private static string TempDir() => Directory.CreateTempSubdirectory("st4i-historian-endpoints-tests-").FullName;

    private static SqliteHistorianStore NewStore() => new(TempDir());

    private static T ExpectOk<T>(IResult result)
    {
        var ok = Assert.IsType<Ok<T>>(result);
        Assert.Equal(StatusCodes.Status200OK, ok.StatusCode);
        Assert.NotNull(ok.Value);
        return ok.Value!;
    }

    private static ApiErrorDto ExpectBadRequest(IResult result)
    {
        var bad = Assert.IsType<BadRequest<ApiErrorDto>>(result);
        Assert.Equal(StatusCodes.Status400BadRequest, bad.StatusCode);
        Assert.NotNull(bad.Value);
        return bad.Value!;
    }

    private static HistorianResultRecord MakeRecord(
        string machineCode, string serialNumber, string verdict, DateTimeOffset eventTimeUtc,
        IReadOnlyList<TelemetrySampleRecord>? telemetry = null) =>
        new(
            MachineCode: machineCode, DeviceClass: "AoiAvi", MachineType: "AOI", ReadingKind: "ProcessResult",
            CycleCounter: 1, SerialNumber: serialNumber, Verdict: verdict,
            RecipeCode: "RC-A", RecipeVersion: "1",
            KeyMetricName: "Exposure", KeyMetricValue: 120.5, KeyMetricUnit: "us",
            NgCount: verdict == "Fail" ? 1 : 0, PointCount: 6,
            AckSuccess: true, AckDuplicate: false, AckQueued: false,
            GenealogyJson: null, MeasurementsJson: null,
            EventTimeUtc: eventTimeUtc, IngestedAtUtc: eventTimeUtc,
            TelemetrySamples: telemetry ?? Array.Empty<TelemetrySampleRecord>());

    // ─────────────────────────────────────────────────────────────────────
    // Shared seed — 4 results: two on AOI-01 (one carrying a telemetry sample), one on SCRW-01 sharing
    // AOI-01's first result's serial number (cross-machine serial lookup), and one old enough to be
    // pruned.
    // ─────────────────────────────────────────────────────────────────────
    private static async Task<(SqliteHistorianStore Store, DateTimeOffset Now, HistorianResultRecord R1, HistorianResultRecord R2, HistorianResultRecord R3, HistorianResultRecord R4)>
        SeedAsync()
    {
        var store = NewStore();
        var now = DateTimeOffset.UtcNow;

        var r1 = MakeRecord("AOI-01", "SN-100", "Pass", now.AddDays(-5),
            telemetry: new[] { new TelemetrySampleRecord("Exposure", 120.5, "us", "Good") });
        var r2 = MakeRecord("AOI-01", "SN-101", "Fail", now.AddDays(-3));
        var r3 = MakeRecord("SCRW-01", "SN-100", "Pass", now.AddDays(-2));
        var r4 = MakeRecord("AOI-01", "SN-102", "Pass", now.AddDays(-40)); // old — pruned later

        await store.AppendResultsAsync(new[] { r1 }, CancellationToken.None);
        await store.AppendResultsAsync(new[] { r2 }, CancellationToken.None);
        await store.AppendResultsAsync(new[] { r3 }, CancellationToken.None);
        await store.AppendResultsAsync(new[] { r4 }, CancellationToken.None);

        return (store, now, r1, r2, r3, r4);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/historian/results
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Results_filtered_by_machine_and_time_range_returns_expected_rows_and_paging()
    {
        var (store, now, r1, r2, _, _) = await SeedAsync();

        var result = await HistorianEndpoints.GetResultsAsync(
            machine: "AOI-01", from: now.AddDays(-6).ToString("O"), to: now.AddDays(-1).ToString("O"),
            serial: null, verdict: null, kind: null, limit: null, offset: null, store, CancellationToken.None);

        var page = ExpectOk<HistorianResultsPageDto>(result);

        Assert.Equal(2, page.Total);
        Assert.Equal(200, page.Limit);
        Assert.Equal(0, page.Offset);
        Assert.Equal(2, page.Items.Count);
        Assert.All(page.Items, i => Assert.Equal("AOI-01", i.MachineCode));
        Assert.Contains(page.Items, i => i.SerialNumber == r1.SerialNumber);
        Assert.Contains(page.Items, i => i.SerialNumber == r2.SerialNumber);
        // The DTO carries the flattened scalars, not the JSON blobs.
        Assert.All(page.Items, i => Assert.True(i.Id > 0));
    }

    [Fact]
    public async Task Results_honor_an_explicit_limit_while_Total_still_reflects_the_full_match_count()
    {
        var (store, now, _, _, _, _) = await SeedAsync();

        var result = await HistorianEndpoints.GetResultsAsync(
            machine: "AOI-01", from: now.AddDays(-6).ToString("O"), to: now.AddDays(-1).ToString("O"),
            serial: null, verdict: null, kind: null, limit: 1, offset: 0, store, CancellationToken.None);

        var page = ExpectOk<HistorianResultsPageDto>(result);

        Assert.Equal(2, page.Total); // full match count, independent of limit
        Assert.Equal(1, page.Limit);
        Assert.Single(page.Items);
    }

    [Fact]
    public async Task Results_with_an_unparseable_from_date_returns_400()
    {
        var (store, _, _, _, _, _) = await SeedAsync();

        var result = await HistorianEndpoints.GetResultsAsync(
            machine: null, from: "not-a-date", to: null, serial: null, verdict: null, kind: null,
            limit: null, offset: null, store, CancellationToken.None);

        var error = ExpectBadRequest(result);
        Assert.Contains("from", error.Error);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/historian/serial/{serial}
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Results_by_serial_returns_rows_across_different_machines()
    {
        var (store, _, r1, _, r3, _) = await SeedAsync();

        var result = await HistorianEndpoints.GetBySerialAsync("SN-100", store, CancellationToken.None);

        var rows = ExpectOk<HistorianResultDto[]>(result);
        Assert.Equal(2, rows.Length);
        Assert.Contains(rows, r => r.MachineCode == "AOI-01");
        Assert.Contains(rows, r => r.MachineCode == "SCRW-01");
        Assert.All(rows, r => Assert.Equal("SN-100", r.SerialNumber));
        Assert.Equal(r1.SerialNumber, r3.SerialNumber); // sanity: same serial, seeded on purpose
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/historian/telemetry
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Telemetry_returns_the_seeded_points_for_machine_and_metric_in_range()
    {
        var (store, now, r1, _, _, _) = await SeedAsync();

        var result = await HistorianEndpoints.GetTelemetryAsync(
            machine: "AOI-01", metric: "Exposure", from: now.AddDays(-6).ToString("O"), to: now.ToString("O"),
            store, CancellationToken.None);

        var points = ExpectOk<TelemetryPointDto[]>(result);
        var point = Assert.Single(points);
        Assert.Equal(120.5, point.Value);
        Assert.Equal(r1.EventTimeUtc, point.At);
    }

    [Fact]
    public async Task Telemetry_missing_a_required_param_returns_400()
    {
        var (store, now, _, _, _, _) = await SeedAsync();

        var result = await HistorianEndpoints.GetTelemetryAsync(
            machine: "AOI-01", metric: null, from: now.AddDays(-6).ToString("O"), to: now.ToString("O"),
            store, CancellationToken.None);

        var error = ExpectBadRequest(result);
        Assert.Contains("metric", error.Error);
    }

    [Fact]
    public async Task Telemetry_with_an_unparseable_date_returns_400()
    {
        var (store, now, _, _, _, _) = await SeedAsync();

        var result = await HistorianEndpoints.GetTelemetryAsync(
            machine: "AOI-01", metric: "Exposure", from: now.AddDays(-6).ToString("O"), to: "garbage",
            store, CancellationToken.None);

        var error = ExpectBadRequest(result);
        Assert.Contains("to", error.Error);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/historian/stats
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Stats_reflects_seeded_counts_and_min_max_event_time()
    {
        var (store, _, _, _, r3, r4) = await SeedAsync();

        var result = await HistorianEndpoints.GetStatsAsync(store, CancellationToken.None);

        var stats = ExpectOk<HistorianStatsDto>(result);
        Assert.Equal(4, stats.ResultRowCount);
        Assert.Equal(1, stats.TelemetryRowCount); // only r1 carries a telemetry sample
        Assert.Equal(r4.EventTimeUtc, stats.OldestEventTimeUtc); // r4 is the oldest (-40 days)
        Assert.Equal(r3.EventTimeUtc, stats.NewestEventTimeUtc); // r3 is the newest (-2 days)
        Assert.True(stats.DbSizeBytes > 0);
    }

    // ─────────────────────────────────────────────────────────────────────
    // POST /v1/historian/prune
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Prune_deletes_rows_older_than_the_cutoff_and_returns_the_deleted_count()
    {
        var (store, _, _, _, _, _) = await SeedAsync();

        // Cutoff at 35 days catches only r4 (-40 days); r1/r2/r3 (-5/-3/-2 days) survive.
        var result = await HistorianEndpoints.PruneAsync(new PruneRequest(35), store, CancellationToken.None);

        var dto = ExpectOk<PruneResultDto>(result);
        Assert.Equal(1, dto.DeletedRows);

        var statsResult = await HistorianEndpoints.GetStatsAsync(store, CancellationToken.None);
        var stats = ExpectOk<HistorianStatsDto>(statsResult);
        Assert.Equal(3, stats.ResultRowCount);
    }

    [Fact]
    public async Task Prune_rejects_a_negative_olderThanDays_with_400()
    {
        var store = NewStore();

        var result = await HistorianEndpoints.PruneAsync(new PruneRequest(-1), store, CancellationToken.None);

        var error = ExpectBadRequest(result);
        Assert.Contains("olderThanDays", error.Error);
    }
}
