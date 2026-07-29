using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
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

    [Fact]
    public async Task Results_PureFabricatedPeriod_DefaultStillReturnsEverything_ExhibitionContinuity()
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

        Assert.Equal(2, page.Total);
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
