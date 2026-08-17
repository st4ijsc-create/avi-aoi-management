using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using St4i.EdgeCore.Historian;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Metrics;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Endpoints;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.Tests.Auth;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// Task 9 (WS-A) — endpoint coverage for the OEE surface (<c>GET /v1/historian/oee</c>,
/// <c>GET /v1/historian/oee/fleet</c>, <c>GET</c>/<c>PUT /v1/historian/oee/settings</c>), calling the
/// <c>internal</c> handler methods directly — same convention as <see cref="HistorianEndpointsReadTests"/>
/// (real <see cref="SqliteHistorianStore"/> rooted at a per-test temp directory) plus a real
/// <see cref="OeeSettingsStore"/> (also a per-test temp directory, never <c>Program.cs</c>'s real
/// <c>%ProgramData%</c> path) and a real <see cref="FleetHost"/> constructed the SAME lightweight way
/// <see cref="FleetHostHealthAndRegistrationTests.CreateHost"/>/<see cref="FleetHostHistorianWiringTests.CreateHostWithHistorian"/>
/// already do (fake transports, never started — this test only needs <see cref="FleetHost.Fleet"/>'s
/// roster snapshot, not a running pipeline) — <see cref="FleetHost.Fleet"/> is the "exact roster accessor"
/// the Task 9 brief asked to confirm.
/// </summary>
// 🔴 Task L-1 — joins this collection for the PROCESS-WIDE SQLITE CONNECTION POOL, not for env vars.
//    SqliteConnection.ClearAllPools() is process-global; membership rule and the full list are in
//    tests/St4i.EngineApi.Tests/Auth/SecurityEnvVarTests.cs.
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class HistorianEndpointsOeeTests
{
    private static string TempDir() => Directory.CreateTempSubdirectory("st4i-oee-endpoints-tests-").FullName;

    private static SqliteHistorianStore NewStore() => new(TempDir());

    private static OeeSettingsStore NewSettingsStore() => new(TempDir());

    /// <summary>Same fake-transport composition as <c>FleetHostHealthAndRegistrationTests.CreateHost</c> —
    /// never <see cref="FleetHost.Start"/>ed here, so this is purely a way to get a real, production-shaped
    /// <see cref="FleetHost.Fleet"/> roster (the shipped default fleet — SCRW-01 at
    /// <c>CycleSeconds = 0.6</c> among it) without spinning up any actual simulated cycling.</summary>
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

    private static T ExpectOk<T>(IResult result)
    {
        var ok = Assert.IsType<Ok<T>>(result);
        Assert.Equal(StatusCodes.Status200OK, ok.StatusCode);
        Assert.NotNull(ok.Value);
        return ok.Value!;
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

    /// <summary>Seeds 10 ProcessResult rows (8 Pass, 2 Fail) for <paramref name="machineCode"/> spread over
    /// the last 50 minutes of the (from, to) window, plus a single Start@from / Stop@to run-event pair so
    /// <see cref="IHistorianStore.AggregateForOeeAsync"/>'s run-time comes out to EXACTLY <c>to - from</c>
    /// (see <see cref="SqliteHistorianStore"/>'s <c>ClippedSpan</c> — start==from, end==to clips to nothing,
    /// so RunTime == the full window) — a controlled seed, not a coincidence.</summary>
    private static async Task SeedOeeInputsAsync(SqliteHistorianStore store, string machineCode, DateTimeOffset from, DateTimeOffset to, CancellationToken ct)
    {
        await store.AppendRunEventAsync(new HistorianRunEvent("Start", from), ct);
        await store.AppendRunEventAsync(new HistorianRunEvent("Stop", to), ct);

        for (var i = 1; i <= 10; i++)
        {
            var verdict = i <= 8 ? "Pass" : "Fail";
            var at = to.AddMinutes(-i);
            await store.AppendResultsAsync(new[] { MakeProcessResult(machineCode, verdict, at) }, ct);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/historian/oee
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Oee_ForKnownMachine_MatchesHandComputedOeeCalculatorResultForTheSameSeededInputs()
    {
        var store = NewStore();
        var settingsStore = NewSettingsStore();
        var fleetHost = NewFleetHost();
        const string machineCode = "SCRW-01";
        var descriptor = fleetHost.Fleet.Single(d => d.Code == machineCode);

        var to = DateTimeOffset.UtcNow;
        var from = to.AddHours(-1);
        await SeedOeeInputsAsync(store, machineCode, from, to, CancellationToken.None);

        // Independently compute the expected OeeResult from the SAME store/settings inputs the endpoint
        // itself will resolve — never a hardcoded/duplicated formula.
        var agg = await store.AggregateForOeeAsync(machineCode, from, to, CancellationToken.None);
        var settings = settingsStore.Resolve(machineCode, descriptor.CycleSeconds);
        var idealCycle = settings.IdealCycleSecondsOverride ?? descriptor.CycleSeconds;
        var planned = TimeSpan.FromSeconds((to - from).TotalSeconds * settings.PlannedProductionRatio);
        var expected = OeeCalculator.Calculate(agg, planned, idealCycle);

        var result = await HistorianEndpoints.GetOeeAsync(
            machine: machineCode, from: from.ToString("O"), to: to.ToString("O"),
            store, settingsStore, fleetHost, CancellationToken.None);

        var dto = ExpectOk<OeeResultDto>(result);

        Assert.Equal(machineCode, dto.MachineCode);
        Assert.Equal(expected.Availability, dto.Availability);
        Assert.Equal(expected.Performance, dto.Performance);
        Assert.Equal(expected.Quality, dto.Quality);
        Assert.Equal(expected.Oee, dto.Oee);
        Assert.Equal(expected.PlannedProductionTime.TotalSeconds, dto.PlannedProductionSeconds);
        Assert.Equal(expected.RunTime.TotalSeconds, dto.RunSeconds);
        Assert.Equal(expected.DowntimeLossTime.TotalSeconds, dto.DowntimeLossSeconds);
        Assert.Equal(expected.SpeedLossTime.TotalSeconds, dto.SpeedLossSeconds);
        Assert.Equal(expected.QualityLossTime.TotalSeconds, dto.QualityLossSeconds);
        Assert.Equal(expected.TotalCount, dto.TotalCount);
        Assert.Equal(expected.GoodCount, dto.GoodCount);
        Assert.Equal(expected.IdealCycleSeconds, dto.IdealCycleSeconds);

        // Sanity on the seed itself — never a vacuous pass.
        Assert.Equal(10, dto.TotalCount);
        Assert.Equal(8, dto.GoodCount);
        Assert.Equal(descriptor.CycleSeconds, dto.IdealCycleSeconds); // no override yet
        Assert.Equal(1.0, dto.Availability); // RunTime == planned exactly, by seed construction
    }

    [Fact]
    public async Task Oee_ForUnknownMachine_Returns404()
    {
        var store = NewStore();
        var settingsStore = NewSettingsStore();
        var fleetHost = NewFleetHost();

        var result = await HistorianEndpoints.GetOeeAsync(
            machine: "NOPE-999", from: null, to: null, store, settingsStore, fleetHost, CancellationToken.None);

        var error = ExpectNotFound(result);
        Assert.Contains("NOPE-999", error.Error);
    }

    [Fact]
    public async Task Oee_WithAnUnparseableFromDateReturns400()
    {
        var store = NewStore();
        var settingsStore = NewSettingsStore();
        var fleetHost = NewFleetHost();

        var result = await HistorianEndpoints.GetOeeAsync(
            machine: "SCRW-01", from: "not-a-date", to: null, store, settingsStore, fleetHost, CancellationToken.None);

        var error = ExpectBadRequest(result);
        Assert.Contains("from", error.Error);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/historian/oee/settings, PUT /v1/historian/oee/settings
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void OeeSettings_Get_WithNoStoredOverride_ReturnsRosterDefaults()
    {
        var settingsStore = NewSettingsStore();
        var fleetHost = NewFleetHost();
        const string machineCode = "SCRW-01";
        var descriptor = fleetHost.Fleet.Single(d => d.Code == machineCode);

        var result = HistorianEndpoints.GetOeeSettings(machineCode, settingsStore, fleetHost);

        var dto = ExpectOk<OeeSettingsDto>(result);
        Assert.Equal(machineCode, dto.MachineCode);
        Assert.Equal(descriptor.CycleSeconds, dto.IdealCycleSeconds);
        Assert.False(dto.IsOverridden);
        Assert.Equal(1.0, dto.PlannedProductionRatio);
    }

    [Fact]
    public void OeeSettings_Get_ForUnknownMachine_Returns404()
    {
        var settingsStore = NewSettingsStore();
        var fleetHost = NewFleetHost();

        var result = HistorianEndpoints.GetOeeSettings("NOPE-999", settingsStore, fleetHost);

        ExpectNotFound(result);
    }

    [Fact]
    public async Task OeeSettings_Put_WithAValidOverrideAndRatio_PersistsAndIsReflectedByASubsequentOeeCall()
    {
        var store = NewStore();
        var settingsStore = NewSettingsStore();
        var fleetHost = NewFleetHost();
        const string machineCode = "SCRW-01";

        var putResult = await HistorianEndpoints.PutOeeSettingsAsync(
            machineCode, new OeeSettingsUpdateRequest(IdealCycleSecondsOverride: 0.5, PlannedProductionRatio: 0.75),
            settingsStore, fleetHost);

        var putDto = ExpectOk<OeeSettingsDto>(putResult);
        Assert.Equal(machineCode, putDto.MachineCode);
        Assert.Equal(0.5, putDto.IdealCycleSeconds);
        Assert.True(putDto.IsOverridden);
        Assert.Equal(0.75, putDto.PlannedProductionRatio);

        // A fresh GET settings call reflects the persisted override (same store instance — persistence
        // within-process is enough here; OeeSettingsStore's own restart-survival is WS-A-T5's concern).
        var getResult = HistorianEndpoints.GetOeeSettings(machineCode, settingsStore, fleetHost);
        var getDto = ExpectOk<OeeSettingsDto>(getResult);
        Assert.Equal(0.5, getDto.IdealCycleSeconds);
        Assert.True(getDto.IsOverridden);
        Assert.Equal(0.75, getDto.PlannedProductionRatio);

        // And a subsequent /oee call now uses the OVERRIDDEN ideal cycle (0.5) instead of SCRW-01's
        // roster CycleSeconds (0.6), and the ratio-scaled (0.75x) planned production time.
        var to = DateTimeOffset.UtcNow;
        var from = to.AddHours(-1);
        await SeedOeeInputsAsync(store, machineCode, from, to, CancellationToken.None);

        var oeeResult = await HistorianEndpoints.GetOeeAsync(
            machine: machineCode, from: from.ToString("O"), to: to.ToString("O"),
            store, settingsStore, fleetHost, CancellationToken.None);

        var oeeDto = ExpectOk<OeeResultDto>(oeeResult);
        Assert.Equal(0.5, oeeDto.IdealCycleSeconds);
        Assert.Equal((to - from).TotalSeconds * 0.75, oeeDto.PlannedProductionSeconds);
    }

    [Fact]
    public async Task OeeSettings_Put_WithARatioAboveOne_Returns400AndLeavesTheStoreUntouched()
    {
        var settingsStore = NewSettingsStore();
        var fleetHost = NewFleetHost();
        const string machineCode = "SCRW-01";

        var result = await HistorianEndpoints.PutOeeSettingsAsync(
            machineCode, new OeeSettingsUpdateRequest(IdealCycleSecondsOverride: null, PlannedProductionRatio: 1.5),
            settingsStore, fleetHost);

        var error = ExpectBadRequest(result);
        Assert.Contains("plannedProductionRatio", error.Error);

        // Untouched — a subsequent GET still reports the untouched default.
        var getResult = HistorianEndpoints.GetOeeSettings(machineCode, settingsStore, fleetHost);
        var getDto = ExpectOk<OeeSettingsDto>(getResult);
        Assert.False(getDto.IsOverridden);
        Assert.Equal(1.0, getDto.PlannedProductionRatio);
    }

    /// <summary>🔴 <b>Task V-1 — the surface the loss is named on.</b> This store's only mutator rewrites the
    /// whole table, so with <c>oee-settings.json</c> present and unparseable a PUT would replace every other
    /// machine's entry with nothing. The write is REFUSED and the operator is told at the moment they would
    /// have destroyed the file.
    ///
    /// <para>⚠️ <b>This said <i>"Run at <c>f18f5c29</c> this returns 200"</i> and it is withdrawn (review
    /// I-2).</b> The claim is derivable from the base source and it is not something anybody ran: the base
    /// arm was taken with <c>git checkout f18f5c29 -- src tests</c>, so this test was not on that tree. What
    /// was measured at base is the store-level write, by the retained control file under
    /// <c>.superpowers/sdd/one-unreadable-posture/evidence/</c>.</para></summary>
    [Fact]
    public async Task OeeSettings_Put_WithAnUnreadableSettingsFile_Returns409_AndTheOperatorsBytesSurvive()
    {
        var dir = TempDir();
        var path = Path.Combine(dir, "oee-settings.json");
        var operatorBytes = "[ { \"machineCode\": \"SCRW-01\", idealCycleSecondsOverride: 42 ]";
        File.WriteAllText(path, operatorBytes);

        var settingsStore = new OeeSettingsStore(dir);
        var fleetHost = NewFleetHost();

        var result = await HistorianEndpoints.PutOeeSettingsAsync(
            "SCRW-01", new OeeSettingsUpdateRequest(IdealCycleSecondsOverride: 0.5, PlannedProductionRatio: 0.75),
            settingsStore, fleetHost);

        var conflict = Assert.IsType<JsonHttpResult<ApiErrorDto>>(result);
        Assert.Equal(StatusCodes.Status409Conflict, conflict.StatusCode);
        Assert.Contains("oee-settings.json", conflict.Value!.Error, StringComparison.Ordinal);

        Assert.Equal(operatorBytes, File.ReadAllText(path));

        // GET keeps answering, truthfully, on what this process actually holds — refusing the write is a
        // report, not an outage. The response SHAPE is deliberately unchanged: widening a published DTO is
        // the class of change reserved to the owner, and the same line Q-1 drew at GET /v1/settings.
        var getDto = ExpectOk<OeeSettingsDto>(HistorianEndpoints.GetOeeSettings("SCRW-01", settingsStore, fleetHost));
        Assert.False(getDto.IsOverridden);
        Assert.Equal(1.0, getDto.PlannedProductionRatio);
    }

    /// <summary>🔴 <b>V-1 fix round (review I-3) — the window round one shipped OPEN, at the operator's own
    /// surface.</b> The refusal used to be gated on a classification cached at construction, so a host that
    /// came up on a good file and then had that file hand-edited into invalid JSON — the repair the refusal
    /// message itself asks for — answered <c>200</c> to the next PUT and wrote the in-memory table straight
    /// over the operator's bytes. Nothing constructs a store here after the corruption, which is exactly why
    /// no instrument in the tree could see it: Reach C only ever builds a store over an already-corrupt
    /// directory.</summary>
    [Fact]
    public async Task OeeSettings_Put_AfterTheFileIsCorruptedBeneathALiveStore_Returns409_AndDoesNotOverwrite()
    {
        var dir = TempDir();
        var path = Path.Combine(dir, "oee-settings.json");
        var settingsStore = new OeeSettingsStore(dir);
        var fleetHost = NewFleetHost();

        // A perfectly ordinary start: the store comes up, an operator sets a value, everything is fine.
        var okResult = await HistorianEndpoints.PutOeeSettingsAsync(
            "SCRW-01", new OeeSettingsUpdateRequest(IdealCycleSecondsOverride: 0.5, PlannedProductionRatio: null),
            settingsStore, fleetHost);
        Assert.Equal(0.5, ExpectOk<OeeSettingsDto>(okResult).IdealCycleSeconds);

        // …and only NOW does the file stop being readable, with the store already live.
        var handEdited = "[ { \"machineCode\": \"SCRW-01\", idealCycleSecondsOverride: 0.5 ]";
        File.WriteAllText(path, handEdited);

        var result = await HistorianEndpoints.PutOeeSettingsAsync(
            "SCRW-01", new OeeSettingsUpdateRequest(IdealCycleSecondsOverride: 0.9, PlannedProductionRatio: null),
            settingsStore, fleetHost);

        var conflict = Assert.IsType<JsonHttpResult<ApiErrorDto>>(result);
        Assert.Equal(StatusCodes.Status409Conflict, conflict.StatusCode);
        Assert.Equal(handEdited, File.ReadAllText(path));
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/historian/oee/fleet
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task OeeFleet_ReturnsOneEntryPerRosterMachine()
    {
        var store = NewStore();
        var settingsStore = NewSettingsStore();
        var fleetHost = NewFleetHost();

        var to = DateTimeOffset.UtcNow;
        var from = to.AddHours(-1);

        var result = await HistorianEndpoints.GetOeeFleetAsync(
            from: from.ToString("O"), to: to.ToString("O"), store, settingsStore, fleetHost, CancellationToken.None);

        var dtos = ExpectOk<OeeResultDto[]>(result);
        var rosterCodes = fleetHost.Fleet.Select(d => d.Code).ToArray();

        Assert.Equal(rosterCodes.Length, dtos.Length);
        Assert.Equal(rosterCodes.OrderBy(c => c), dtos.Select(d => d.MachineCode).OrderBy(c => c));
        // No seeded results/run-events for any machine here — every entry still comes back well-formed
        // (zero counts, zero run-time), never a throw/500, since AggregateForOeeAsync tolerates an empty
        // window and OeeCalculator clamps every ratio.
        Assert.All(dtos, d => Assert.Equal(0, d.TotalCount));
    }
}
