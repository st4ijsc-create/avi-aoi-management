using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Historian;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Endpoints;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// SM-2 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-2-brief.md) — end-to-end
/// endpoint coverage proving the customer-facing historian read surfaces (results, OEE, CSV export) honor
/// <see cref="SqliteHistorianStore"/>'s real-presence gate by default, and can bypass it explicitly via
/// <c>includeFabricated=true</c> — the acceptance test the brief calls out directly: "a historian report
/// over a period that contains both fabricated and real rows ⇒ the customer-facing report contains only
/// real data." Same "hand-construct the exact store, call the internal handler directly" convention as
/// <see cref="HistorianEndpointsReadTests"/>/<see cref="HistorianEndpointsOeeTests"/>/
/// <see cref="HistorianEndpointsExportTests"/> — this file adds NEW tests only, none of those pre-existing
/// files are touched.
///
/// Task-7 (whole-batch review, CRITICAL) added the `*_DemoModeEnabled_*` tests below: the OTHER half of
/// this file's own acceptance test, proving the exact opposite failure mode a hardcoded `?? false`
/// default left untested — a PURE-fabricated period (the shipped demo fleet's own condition) must still
/// render SOMETHING by default when <see cref="St4i.EdgeCore.Config.DemoModeGate.Enabled"/>, not silently
/// stay empty forever the way a real exhibition install's `/historian`/`/reports` did before this fix.
/// </summary>
public sealed class HistorianEndpointsProvenanceTests
{
    private static string TempDir() => Directory.CreateTempSubdirectory("st4i-historian-provenance-endpoints-").FullName;

    private static SqliteHistorianStore NewStore() => new(TempDir());

    private static OeeSettingsStore NewSettingsStore() => new(TempDir());

    private static FleetHost NewFleetHost()
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        var eventBus = new EventBus();
        return new FleetHost(switchable, coordinator, eventBus);
    }

    private static HistorianResultRecord MakeResult(
        string machineCode, string serialNumber, string verdict, DateTimeOffset eventTimeUtc, bool isFabricated) =>
        new(
            MachineCode: machineCode, DeviceClass: "Automation", MachineType: "MODBUS_TCP", ReadingKind: "ProcessResult",
            CycleCounter: 1, SerialNumber: serialNumber, Verdict: verdict,
            RecipeCode: null, RecipeVersion: null,
            KeyMetricName: null, KeyMetricValue: null, KeyMetricUnit: null,
            NgCount: verdict == "Fail" ? 1 : 0, PointCount: 1,
            AckSuccess: true, AckDuplicate: false, AckQueued: false,
            GenealogyJson: null, MeasurementsJson: null,
            EventTimeUtc: eventTimeUtc, IngestedAtUtc: eventTimeUtc,
            TelemetrySamples: Array.Empty<TelemetrySampleRecord>(),
            IsFabricated: isFabricated);

    private static T ExpectOk<T>(IResult result)
    {
        var ok = Assert.IsType<Ok<T>>(result);
        Assert.Equal(StatusCodes.Status200OK, ok.StatusCode);
        Assert.NotNull(ok.Value);
        return ok.Value!;
    }

    private static async Task<(string Csv, string? ContentType)> ExecuteCsvAsync(IResult result)
    {
        var context = new DefaultHttpContext();
        using var body = new MemoryStream();
        context.Response.Body = body;
        await result.ExecuteAsync(context);
        body.Position = 0;
        return (Encoding.UTF8.GetString(body.ToArray()), context.Response.ContentType);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/historian/results
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Results_MixedPeriod_DefaultReturnsOnlyRealRows_EachRowLabeled()
    {
        var store = NewStore();
        var now = DateTimeOffset.UtcNow;
        await store.AppendResultsAsync(new[]
        {
            MakeResult("MIX-EP-01", "SN-F1", "Pass", now.AddMinutes(-3), isFabricated: true),
            MakeResult("MIX-EP-01", "SN-R1", "Pass", now.AddMinutes(-2), isFabricated: false),
            MakeResult("MIX-EP-01", "SN-R2", "Fail", now.AddMinutes(-1), isFabricated: false),
        }, CancellationToken.None);

        var result = await HistorianEndpoints.GetResultsAsync(
            machine: "MIX-EP-01", from: null, to: null, serial: null, verdict: null, kind: null,
            limit: null, offset: null, store, CancellationToken.None);

        var page = ExpectOk<HistorianResultsPageDto>(result);

        Assert.Equal(2, page.Total);
        Assert.All(page.Items, i => Assert.Equal(false, i.IsFabricated));
        Assert.DoesNotContain(page.Items, i => i.SerialNumber == "SN-F1");
    }

    [Fact]
    public async Task Results_MixedPeriod_IncludeFabricatedTrue_ReturnsEverything_StillLabeledPerRow()
    {
        var store = NewStore();
        var now = DateTimeOffset.UtcNow;
        await store.AppendResultsAsync(new[]
        {
            MakeResult("MIX-EP-02", "SN-F1", "Pass", now.AddMinutes(-2), isFabricated: true),
            MakeResult("MIX-EP-02", "SN-R1", "Pass", now.AddMinutes(-1), isFabricated: false),
        }, CancellationToken.None);

        var result = await HistorianEndpoints.GetResultsAsync(
            machine: "MIX-EP-02", from: null, to: null, serial: null, verdict: null, kind: null,
            limit: null, offset: null, store, CancellationToken.None, includeFabricated: true);

        var page = ExpectOk<HistorianResultsPageDto>(result);

        Assert.Equal(2, page.Total);
        Assert.Contains(page.Items, i => i.SerialNumber == "SN-F1" && i.IsFabricated == true);
        Assert.Contains(page.Items, i => i.SerialNumber == "SN-R1" && i.IsFabricated == false);
    }

    /// <summary>Fix round 1 (review IMPORTANT 1a) — an explicitly-fabricated row is unambiguous and is
    /// excluded from this default (non-opt-in) endpoint call unconditionally, whether or not anything real
    /// exists elsewhere. Renamed/re-asserted from the pre-fix-round-1 version, which wrongly expected a
    /// pure-demo period to pass through unfiltered — see
    /// <see cref="Results_PureUnknownPeriod_DefaultStillReturnsEverything_LegacyContinuity"/> below for the
    /// genuine legacy-continuity guarantee this endpoint still honors.</summary>
    [Fact]
    public async Task Results_PureFabricatedPeriod_DefaultReturnsNothing_ExplicitFabricatedAlwaysExcluded()
    {
        var store = NewStore();
        var now = DateTimeOffset.UtcNow;
        await store.AppendResultsAsync(new[]
        {
            MakeResult("DEMO-EP-01", "SN-1", "Pass", now.AddMinutes(-2), isFabricated: true),
            MakeResult("DEMO-EP-01", "SN-2", "Pass", now.AddMinutes(-1), isFabricated: true),
        }, CancellationToken.None);

        var result = await HistorianEndpoints.GetResultsAsync(
            machine: "DEMO-EP-01", from: null, to: null, serial: null, verdict: null, kind: null,
            limit: null, offset: null, store, CancellationToken.None);

        var page = ExpectOk<HistorianResultsPageDto>(result);

        Assert.Equal(0, page.Total);
    }

    /// <summary>Fix 1 (task-7 review, CRITICAL) — the exact demo-install bug this test class's sibling
    /// above (<see cref="Results_PureFabricatedPeriod_DefaultReturnsNothing_ExplicitFabricatedAlwaysExcluded"/>)
    /// never exercised: on a real product deployment (<see cref="DemoModeGate"/> disabled/absent, the
    /// scenario every other test in this file implicitly covers) a pure-fabricated period still returns
    /// NOTHING by default — that assertion is untouched. But an exhibition/demo-flagged deployment
    /// (<see cref="DemoModeGate.Enabled"/>) is, by construction, 100% <c>Simulated</c> — under the OLD
    /// unconditional-exclude behavior this exact period would ALSO return zero rows, which is precisely
    /// how a fresh demo `historian.db` rendered `/historian`/`/reports` permanently empty. This proves the
    /// fix: the SAME pure-fabricated period, with a Demo-enabled gate and NO explicit `includeFabricated`
    /// override, now returns everything, correctly labeled.</summary>
    [Fact]
    public async Task Results_PureFabricatedPeriod_DemoModeEnabled_DefaultIncludesFabricated()
    {
        var store = NewStore();
        var now = DateTimeOffset.UtcNow;
        await store.AppendResultsAsync(new[]
        {
            MakeResult("DEMO-EP-02", "SN-1", "Pass", now.AddMinutes(-2), isFabricated: true),
            MakeResult("DEMO-EP-02", "SN-2", "Pass", now.AddMinutes(-1), isFabricated: true),
        }, CancellationToken.None);

        var result = await HistorianEndpoints.GetResultsAsync(
            machine: "DEMO-EP-02", from: null, to: null, serial: null, verdict: null, kind: null,
            limit: null, offset: null, store, CancellationToken.None,
            demoGate: new DemoModeGate(rawValue: "true"));

        var page = ExpectOk<HistorianResultsPageDto>(result);

        Assert.Equal(2, page.Total);
        Assert.All(page.Items, i => Assert.Equal(true, i.IsFabricated));
    }

    /// <summary>An explicit `includeFabricated=false` still wins outright even when the deployment is
    /// Demo-enabled — the escape hatch is a caller override, not merely a suggestion the Demo default can
    /// clobber.</summary>
    [Fact]
    public async Task Results_PureFabricatedPeriod_DemoModeEnabled_ExplicitFalseStillExcludes()
    {
        var store = NewStore();
        var now = DateTimeOffset.UtcNow;
        await store.AppendResultsAsync(new[]
        {
            MakeResult("DEMO-EP-03", "SN-1", "Pass", now.AddMinutes(-1), isFabricated: true),
        }, CancellationToken.None);

        var result = await HistorianEndpoints.GetResultsAsync(
            machine: "DEMO-EP-03", from: null, to: null, serial: null, verdict: null, kind: null,
            limit: null, offset: null, store, CancellationToken.None,
            includeFabricated: false, demoGate: new DemoModeGate(rawValue: "true"));

        var page = ExpectOk<HistorianResultsPageDto>(result);

        Assert.Equal(0, page.Total);
    }

    /// <summary>The genuine legacy-continuity guarantee at the API boundary: a period containing ONLY
    /// Unknown-provenance (pre-migration-shaped) rows is not silently emptied by
    /// <c>GET /v1/historian/results</c> merely because nothing in scope can prove them real.</summary>
    [Fact]
    public async Task Results_PureUnknownPeriod_DefaultStillReturnsEverything_LegacyContinuity()
    {
        var store = NewStore();
        var now = DateTimeOffset.UtcNow;
        InsertLegacyShapeRow(store.DbPath, "LEGACY-EP-01", "SN-OLD-1", now.AddMinutes(-2));
        InsertLegacyShapeRow(store.DbPath, "LEGACY-EP-01", "SN-OLD-2", now.AddMinutes(-1));

        var result = await HistorianEndpoints.GetResultsAsync(
            machine: "LEGACY-EP-01", from: null, to: null, serial: null, verdict: null, kind: null,
            limit: null, offset: null, store, CancellationToken.None);

        var page = ExpectOk<HistorianResultsPageDto>(result);

        Assert.Equal(2, page.Total);
        Assert.All(page.Items, i => Assert.Null(i.IsFabricated));
    }

    /// <summary>Same raw pre-SM-2-column INSERT convention as
    /// <c>SqliteHistorianStoreProvenanceTests.InsertLegacyShapeRow</c> — the most faithful simulation of "a
    /// row written before this column existed" available at the endpoint layer.</summary>
    private static void InsertLegacyShapeRow(string dbPath, string machineCode, string serialNumber, DateTimeOffset eventTime)
    {
        using var connection = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={dbPath}");
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
    // GET /v1/historian/serial/{serial} — fix round 1 (review IMPORTANT 2): the "View genealogy" dialog's
    // own data source, reachable from every historian row's row-action.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task BySerial_MixedAcrossMachines_DefaultReturnsOnlyRealRows()
    {
        var store = NewStore();
        var now = DateTimeOffset.UtcNow;
        const string serial = "SN-GENEALOGY-EP-01";
        await store.AppendResultsAsync(new[]
        {
            MakeResult("GENEALOGY-EP-DEMO-01", serial, "Pass", now.AddMinutes(-2), isFabricated: true),
            MakeResult("GENEALOGY-EP-REAL-01", serial, "Pass", now.AddMinutes(-1), isFabricated: false),
        }, CancellationToken.None);

        var result = await HistorianEndpoints.GetBySerialAsync(serial, store, CancellationToken.None);

        var rows = ExpectOk<HistorianResultDto[]>(result);
        var row = Assert.Single(rows);
        Assert.Equal("GENEALOGY-EP-REAL-01", row.MachineCode);
        Assert.Equal(false, row.IsFabricated);
    }

    [Fact]
    public async Task BySerial_MixedAcrossMachines_IncludeFabricatedTrue_ReturnsEverything_StillLabeledPerRow()
    {
        var store = NewStore();
        var now = DateTimeOffset.UtcNow;
        const string serial = "SN-GENEALOGY-EP-02";
        await store.AppendResultsAsync(new[]
        {
            MakeResult("GENEALOGY-EP-DEMO-02", serial, "Pass", now.AddMinutes(-2), isFabricated: true),
            MakeResult("GENEALOGY-EP-REAL-02", serial, "Pass", now.AddMinutes(-1), isFabricated: false),
        }, CancellationToken.None);

        var result = await HistorianEndpoints.GetBySerialAsync(serial, store, CancellationToken.None, includeFabricated: true);

        var rows = ExpectOk<HistorianResultDto[]>(result);
        Assert.Equal(2, rows.Length);
        Assert.Contains(rows, r => r.MachineCode == "GENEALOGY-EP-DEMO-02" && r.IsFabricated == true);
        Assert.Contains(rows, r => r.MachineCode == "GENEALOGY-EP-REAL-02" && r.IsFabricated == false);
    }

    /// <summary>Fix 1 (task-7 review, CRITICAL) — the "View genealogy" dialog gets the SAME demo carve-out
    /// as the results table: a pure-demo genealogy trace (no real machine sharing this serial at all) is no
    /// longer silently emptied on a Demo-enabled deployment.</summary>
    [Fact]
    public async Task BySerial_PureFabricated_DemoModeEnabled_DefaultIncludesFabricated()
    {
        var store = NewStore();
        var now = DateTimeOffset.UtcNow;
        const string serial = "SN-GENEALOGY-EP-03";
        await store.AppendResultsAsync(new[]
        {
            MakeResult("GENEALOGY-EP-DEMO-03", serial, "Pass", now.AddMinutes(-1), isFabricated: true),
        }, CancellationToken.None);

        var result = await HistorianEndpoints.GetBySerialAsync(
            serial, store, CancellationToken.None, demoGate: new DemoModeGate(rawValue: "true"));

        var rows = ExpectOk<HistorianResultDto[]>(result);
        var row = Assert.Single(rows);
        Assert.Equal(true, row.IsFabricated);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/historian/oee
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Oee_MixedPeriod_DefaultExcludesFabricatedRows()
    {
        var store = NewStore();
        var settingsStore = NewSettingsStore();
        var fleetHost = NewFleetHost();
        const string machineCode = "SCRW-01"; // shipped roster member — descriptor lookup only, not filtering

        var to = DateTimeOffset.UtcNow;
        var from = to.AddHours(-1);
        await store.AppendRunEventAsync(new HistorianRunEvent("Start", from), CancellationToken.None);
        await store.AppendRunEventAsync(new HistorianRunEvent("Stop", to), CancellationToken.None);
        await store.AppendResultsAsync(new[]
        {
            MakeResult(machineCode, "SN-F1", "Pass", to.AddMinutes(-30), isFabricated: true),
            MakeResult(machineCode, "SN-F2", "Pass", to.AddMinutes(-25), isFabricated: true),
            MakeResult(machineCode, "SN-F3", "Pass", to.AddMinutes(-20), isFabricated: true),
            MakeResult(machineCode, "SN-R1", "Pass", to.AddMinutes(-10), isFabricated: false),
            MakeResult(machineCode, "SN-R2", "Fail", to.AddMinutes(-5), isFabricated: false),
        }, CancellationToken.None);

        var result = await HistorianEndpoints.GetOeeAsync(
            machine: machineCode, from: from.ToString("O"), to: to.ToString("O"),
            store, settingsStore, fleetHost, CancellationToken.None);

        var dto = ExpectOk<OeeResultDto>(result);

        Assert.Equal(2, dto.TotalCount);
        Assert.Equal(1, dto.GoodCount);
    }

    [Fact]
    public async Task Oee_MixedPeriod_IncludeFabricatedTrue_ReportsTheBlendedTotal()
    {
        var store = NewStore();
        var settingsStore = NewSettingsStore();
        var fleetHost = NewFleetHost();
        const string machineCode = "SCRW-01";

        var to = DateTimeOffset.UtcNow;
        var from = to.AddHours(-1);
        await store.AppendResultsAsync(new[]
        {
            MakeResult(machineCode, "SN-F1", "Pass", to.AddMinutes(-30), isFabricated: true),
            MakeResult(machineCode, "SN-R1", "Pass", to.AddMinutes(-10), isFabricated: false),
        }, CancellationToken.None);

        var result = await HistorianEndpoints.GetOeeAsync(
            machine: machineCode, from: from.ToString("O"), to: to.ToString("O"),
            store, settingsStore, fleetHost, CancellationToken.None, includeFabricated: true);

        var dto = ExpectOk<OeeResultDto>(result);

        Assert.Equal(2, dto.TotalCount);
    }

    /// <summary>Fix 1 (task-7 review, CRITICAL) — the exact "0% A/P/Q/OEE on a fresh demo install" symptom:
    /// a period with ONLY fabricated rows (the shipped demo fleet's own condition) used to compute a
    /// zeroed-out OEE by default. A Demo-enabled gate now includes those rows in the default computation,
    /// so the OEE tiles are non-trivial again.</summary>
    [Fact]
    public async Task Oee_PureFabricatedPeriod_DemoModeEnabled_DefaultIncludesFabricated()
    {
        var store = NewStore();
        var settingsStore = NewSettingsStore();
        var fleetHost = NewFleetHost();
        const string machineCode = "SCRW-01";

        var to = DateTimeOffset.UtcNow;
        var from = to.AddHours(-1);
        await store.AppendResultsAsync(new[]
        {
            MakeResult(machineCode, "SN-F1", "Pass", to.AddMinutes(-30), isFabricated: true),
            MakeResult(machineCode, "SN-F2", "Fail", to.AddMinutes(-10), isFabricated: true),
        }, CancellationToken.None);

        var result = await HistorianEndpoints.GetOeeAsync(
            machine: machineCode, from: from.ToString("O"), to: to.ToString("O"),
            store, settingsStore, fleetHost, CancellationToken.None,
            demoGate: new DemoModeGate(rawValue: "true"));

        var dto = ExpectOk<OeeResultDto>(result);

        Assert.Equal(2, dto.TotalCount);
        Assert.Equal(1, dto.GoodCount);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/historian/results/export.csv
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ExportCsv_MixedPeriod_DefaultContainsOnlyRealRows()
    {
        var store = NewStore();
        var now = DateTimeOffset.UtcNow;
        await store.AppendResultsAsync(new[]
        {
            MakeResult("CSV-EP-01", "SN-FABRICATED", "Pass", now.AddMinutes(-2), isFabricated: true),
            MakeResult("CSV-EP-01", "SN-REAL", "Pass", now.AddMinutes(-1), isFabricated: false),
        }, CancellationToken.None);

        var result = await HistorianEndpoints.ExportResultsCsvAsync(
            machine: "CSV-EP-01", from: null, to: null, serial: null, verdict: null, kind: null,
            store, CancellationToken.None);

        var (csv, _) = await ExecuteCsvAsync(result);

        Assert.Contains("SN-REAL", csv);
        Assert.DoesNotContain("SN-FABRICATED", csv);
    }
}
