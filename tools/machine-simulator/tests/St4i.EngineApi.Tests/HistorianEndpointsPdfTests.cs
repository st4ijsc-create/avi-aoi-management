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
/// Task 11 (WS-A) — endpoint coverage for the PDF report surface (<c>GET /v1/historian/report.pdf</c>),
/// calling the <c>internal</c> handler method directly — same conventions as
/// <see cref="HistorianEndpointsOeeTests"/> (real <see cref="SqliteHistorianStore"/> + real
/// <see cref="OeeSettingsStore"/>, each rooted at its own per-test temp directory; a real
/// <see cref="FleetHost"/> built the same lightweight fake-transport way, never started) and
/// <see cref="HistorianEndpointsExportTests"/> (the handler returns a hand-rolled <c>IResult</c> that
/// writes headers/bytes straight onto <see cref="HttpContext.Response"/>, so it's executed against a
/// hand-built <see cref="DefaultHttpContext"/> to observe the actual response). The one new assertion
/// this file adds beyond those two patterns: the response BODY itself must start with the PDF magic
/// bytes <c>%PDF-</c> (0x25 0x50 0x44 0x46 0x2D) — the only reliable, deterministic way to confirm a
/// real PDF (not just a plausible-looking Content-Type) came back, without asserting on any
/// non-deterministic "generated at" timestamp the report body may also contain.
/// </summary>
public sealed class HistorianEndpointsPdfTests
{
    private static readonly byte[] PdfMagicBytes = { 0x25, 0x50, 0x44, 0x46, 0x2D }; // "%PDF-"

    private static string TempDir() => Directory.CreateTempSubdirectory("st4i-pdf-endpoints-tests-").FullName;

    private static SqliteHistorianStore NewStore() => new(TempDir());

    private static OeeSettingsStore NewSettingsStore() => new(TempDir());

    /// <summary>Same fake-transport composition as <see cref="HistorianEndpointsOeeTests.NewFleetHost"/> —
    /// never <see cref="FleetHost.Start"/>ed, just a way to get a real, production-shaped
    /// <see cref="FleetHost.Fleet"/> roster (SCRW-01 among it) with no actual simulated cycling.</summary>
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

    private static HistorianResultRecord MakeProcessResult(string machineCode, string verdict, DateTimeOffset eventTimeUtc) =>
        new(
            MachineCode: machineCode, DeviceClass: "Automation", MachineType: "SCREWDRIVE", ReadingKind: "ProcessResult",
            CycleCounter: 1, SerialNumber: $"SN-{Guid.NewGuid():N}", Verdict: verdict,
            RecipeCode: "RC-SCRW-A", RecipeVersion: "1",
            KeyMetricName: "Torque", KeyMetricValue: 12.3, KeyMetricUnit: "Nm",
            NgCount: verdict == "Fail" ? 1 : 0, PointCount: 1,
            AckSuccess: true, AckDuplicate: false, AckQueued: false,
            GenealogyJson: null, MeasurementsJson: null,
            EventTimeUtc: eventTimeUtc, IngestedAtUtc: eventTimeUtc,
            TelemetrySamples: Array.Empty<TelemetrySampleRecord>());

    /// <summary>Seeds a mixed-verdict set (Pass/Warn/Fail/Skip) for <paramref name="machineCode"/> spread
    /// across the (from, to) window, plus a Start@from/Stop@to run-event pair — mirrors
    /// <c>HistorianEndpointsOeeTests.SeedOeeInputsAsync</c>'s "controlled seed" reasoning, extended with a
    /// Skip verdict specifically so the report's verdict-breakdown table (which counts ALL results) can be
    /// checked against the OEE block (which excludes Skip from TotalCount) as two genuinely different
    /// numbers, never a coincidental match.</summary>
    private static async Task SeedMixedVerdictResultsAsync(
        SqliteHistorianStore store, string machineCode, DateTimeOffset from, DateTimeOffset to, CancellationToken ct)
    {
        await store.AppendRunEventAsync(new HistorianRunEvent("Start", from), ct);
        await store.AppendRunEventAsync(new HistorianRunEvent("Stop", to), ct);

        var verdicts = new[] { "Pass", "Pass", "Pass", "Warn", "Fail", "Skip" };
        for (var i = 0; i < verdicts.Length; i++)
        {
            var at = to.AddMinutes(-(i + 1));
            await store.AppendResultsAsync(new[] { MakeProcessResult(machineCode, verdicts[i], at) }, ct);
        }
    }

    /// <summary>Executes the <c>IResult</c> the handler returned against a fresh <see cref="DefaultHttpContext"/>
    /// (<c>Response.Body</c> a seekable <see cref="MemoryStream"/>) and returns the raw bytes plus the
    /// response headers actually written — same technique <see cref="HistorianEndpointsExportTests.ExecuteAsync"/>
    /// uses for the CSV export's hand-rolled <c>IResult</c>.</summary>
    private static async Task<(byte[] Body, string? ContentType, string? ContentDisposition)> ExecuteAsync(IResult result)
    {
        var context = new DefaultHttpContext();
        using var body = new MemoryStream();
        context.Response.Body = body;

        await result.ExecuteAsync(context);

        body.Position = 0;
        return (body.ToArray(), context.Response.ContentType, context.Response.Headers.ContentDisposition.ToString());
    }

    private static ApiErrorDto ExpectNotFound(IResult result)
    {
        var nf = Assert.IsType<NotFound<ApiErrorDto>>(result);
        Assert.Equal(StatusCodes.Status404NotFound, nf.StatusCode);
        Assert.NotNull(nf.Value);
        return nf.Value!;
    }

    private static ApiErrorDto ExpectBadRequest(IResult result)
    {
        var bad = Assert.IsType<BadRequest<ApiErrorDto>>(result);
        Assert.Equal(StatusCodes.Status400BadRequest, bad.StatusCode);
        Assert.NotNull(bad.Value);
        return bad.Value!;
    }

    private static void AssertValidPdfResponse(byte[] bodyBytes, string? contentType, string? contentDisposition)
    {
        Assert.NotNull(contentType);
        Assert.StartsWith("application/pdf", contentType);
        Assert.NotNull(contentDisposition);
        Assert.StartsWith("attachment", contentDisposition);

        Assert.True(bodyBytes.Length > 500, $"expected a non-trivial PDF body, got {bodyBytes.Length} bytes.");

        var magic = bodyBytes.AsSpan(0, PdfMagicBytes.Length).ToArray();
        Assert.Equal(PdfMagicBytes, magic);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/historian/report.pdf
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Report_ForKnownMachineWithMixedVerdicts_ReturnsAValidPdfWithOeeAndVerdictContent()
    {
        var store = NewStore();
        var settingsStore = NewSettingsStore();
        var fleetHost = NewFleetHost();
        const string machineCode = "SCRW-01";

        var to = DateTimeOffset.UtcNow;
        var from = to.AddHours(-1);
        await SeedMixedVerdictResultsAsync(store, machineCode, from, to, CancellationToken.None);

        var result = await HistorianEndpoints.GetReportPdfAsync(
            machine: machineCode, from: from.ToString("O"), to: to.ToString("O"),
            store, settingsStore, fleetHost, CancellationToken.None);

        var (bodyBytes, contentType, contentDisposition) = await ExecuteAsync(result);
        AssertValidPdfResponse(bodyBytes, contentType, contentDisposition);
    }

    [Fact]
    public async Task Report_ForMachineWithZeroResultsInRange_StillReturnsAValidEmptyStatePdf()
    {
        var store = NewStore();
        var settingsStore = NewSettingsStore();
        var fleetHost = NewFleetHost();
        const string machineCode = "SCRW-01";

        // No seeded results/run-events at all — the historian is genuinely empty for this window.
        var to = DateTimeOffset.UtcNow;
        var from = to.AddHours(-1);

        var result = await HistorianEndpoints.GetReportPdfAsync(
            machine: machineCode, from: from.ToString("O"), to: to.ToString("O"),
            store, settingsStore, fleetHost, CancellationToken.None);

        var (bodyBytes, contentType, contentDisposition) = await ExecuteAsync(result);
        AssertValidPdfResponse(bodyBytes, contentType, contentDisposition);
    }

    [Fact]
    public async Task Report_ForUnknownMachine_Returns404()
    {
        var store = NewStore();
        var settingsStore = NewSettingsStore();
        var fleetHost = NewFleetHost();

        var result = await HistorianEndpoints.GetReportPdfAsync(
            machine: "NOPE-999", from: null, to: null, store, settingsStore, fleetHost, CancellationToken.None);

        var error = ExpectNotFound(result);
        Assert.Contains("NOPE-999", error.Error);
    }

    [Fact]
    public async Task Report_WithAnUnparseableFromDate_Returns400()
    {
        var store = NewStore();
        var settingsStore = NewSettingsStore();
        var fleetHost = NewFleetHost();

        var result = await HistorianEndpoints.GetReportPdfAsync(
            machine: "SCRW-01", from: "not-a-date", to: null, store, settingsStore, fleetHost, CancellationToken.None);

        var error = ExpectBadRequest(result);
        Assert.Contains("from", error.Error);
    }
}
