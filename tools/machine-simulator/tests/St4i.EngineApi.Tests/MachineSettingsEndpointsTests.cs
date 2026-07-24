using System.Net;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Config;
using St4i.EngineApi.Endpoints;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// Task 2 (docs/plans/2026-07-21-machine-config.md) — endpoint coverage for the six machine
/// operating-configuration routes, calling the <c>internal</c> handler methods directly against a
/// hand-built <see cref="DefaultHttpContext"/>, same pattern as <see cref="ConfigEndpointsRequestBodyTests"/>
/// (this assembly is named in <c>St4i.EngineApi</c>'s <c>AssemblyInfo.cs</c> <c>InternalsVisibleTo</c>).
/// </summary>
public sealed class MachineSettingsEndpointsTests
{
    private static string TempDir() => Directory.CreateTempSubdirectory("st4i-machine-settings-tests-").FullName;

    private static MachineConfigStore NewStore() => new(TempDir());

    /// <summary>Task 7 — Pull/Push now need an <see cref="IConfigSyncBackend"/> (dispatches Demo vs Live
    /// exactly like the app's real <c>SwitchableConfigSyncBackend</c> DI registration). A fresh, freshly
    /// seeded <see cref="SimulatedEcosystem"/> is Demo's real backend, not a hand-rolled stub — using it
    /// here exercises the actual "ask the active backend for a recommendation" path these tests are
    /// meant to cover, the same instance type production wiring uses when the app is in Demo mode.</summary>
    private static SimulatedEcosystem NewDemoBackend() => new(TempDir());

    /// <summary>Task 7 — minimal local capturing handler for the ONE end-to-end-shaped test exercising
    /// the full Push handler wired to a Live backend (duplicated from <c>LiveConfigSyncTests.CapturingHandler</c>
    /// — that one is a private nested class, not shared across files, matching this project's established
    /// per-file-duplication convention for this exact helper).</summary>
    private sealed class CapturingHandler : HttpMessageHandler
    {
        public HttpRequestMessage? LastRequest;
        public string? LastBody;
        public Func<HttpRequestMessage, string, (HttpStatusCode Status, string Body)> Responder =
            (_, _) => (HttpStatusCode.OK, "{\"success\":true}");

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            LastRequest = request;
            LastBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(ct);
            var (status, body) = Responder(request, LastBody ?? "");
            return new HttpResponseMessage(status) { Content = new StringContent(body) };
        }
    }

    private static DefaultHttpContext JsonRequest(string json, string? contentType = "application/json")
    {
        var bytes = Encoding.UTF8.GetBytes(json);
        var context = new DefaultHttpContext();
        context.Request.Body = new MemoryStream(bytes);
        context.Request.ContentLength = bytes.Length;
        if (contentType is not null) context.Request.ContentType = contentType;
        return context;
    }

    private static DefaultHttpContext EmptyBodyRequest()
    {
        var context = new DefaultHttpContext();
        context.Request.Body = Stream.Null;
        context.Request.ContentLength = 0;
        return context;
    }

    private static T ExpectOk<T>(IResult result)
    {
        var ok = Assert.IsType<JsonHttpResult<T>>(result);
        Assert.True(ok.StatusCode is null or 200, $"expected 200, got {ok.StatusCode}");
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

    private static ApiErrorDto ExpectNotFound(IResult result)
    {
        var nf = Assert.IsType<NotFound<ApiErrorDto>>(result);
        Assert.NotNull(nf.Value);
        return nf.Value!;
    }

    private static readonly MachineDescriptor AoiMachine = new(
        "TEST-AOI-XYZ", "SN-TEST-AOI-XYZ", DeviceClass.AoiAvi, "AOI", "inspection", DriverKind.Simulated, "RC-AOI-A", "aoi", 1.8);

    private static readonly MachineDescriptor IotMachine = new(
        "TEST-IOT-XYZ", "SN-TEST-IOT-XYZ", DeviceClass.Iot, "IOT_SENSOR", "telemetry", DriverKind.Simulated, null, "iot-sensor", 0.8);

    private static readonly MachineDescriptor UnsupportedMachine = new(
        "TEST-ASSY-XYZ", "SN-TEST-ASSY-XYZ", DeviceClass.Automation, "ASSEMBLY", "press_fit", DriverKind.Simulated, "RC-ASSY-A", null, 0.9);

    private static FleetHost NewFleetHostWithRegisteredMachines(params MachineDescriptor[] descriptors)
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        var host = new FleetHost(switchable, coordinator, new EventBus());
        foreach (var d in descriptors) Assert.True(host.RegisterMachine(d));
        return host;
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/machines/{code}/settings
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Get_settings_for_a_never_before_seen_machine_seeds_and_returns_baseline_defaults()
    {
        var fleetHost = NewFleetHostWithRegisteredMachines(AoiMachine);
        var store = NewStore();

        var result = MachineSettingsEndpoints.GetSettings(AoiMachine.Code, null, fleetHost, store);

        var dto = ExpectOk<MachineSettingsResponseDto>(result);
        Assert.Equal(MachineParameterSchema.AoiInspection, dto.ConfigKind);
        Assert.True(dto.SupportsProductScope);
        Assert.Equal(1, dto.Baseline.Version);
        Assert.Equal(6, dto.Schema.Count);
        Assert.Equal(6, dto.Effective.Count);
        Assert.Empty(dto.DriftedKeys);
        Assert.All(dto.Effective, p => Assert.Equal(ConfigProvenance.Baseline, p.Source));
    }

    [Fact]
    public void Get_settings_for_an_unknown_machine_returns_404()
    {
        var fleetHost = NewFleetHostWithRegisteredMachines(AoiMachine);
        var store = NewStore();

        var result = MachineSettingsEndpoints.GetSettings("NO-SUCH-MACHINE", null, fleetHost, store);

        ExpectNotFound(result);
    }

    [Fact]
    public void Get_settings_for_an_unsupported_machine_type_returns_400()
    {
        var fleetHost = NewFleetHostWithRegisteredMachines(UnsupportedMachine);
        var store = NewStore();

        var result = MachineSettingsEndpoints.GetSettings(UnsupportedMachine.Code, null, fleetHost, store);

        var error = ExpectBadRequest(result);
        Assert.Contains("ASSEMBLY", error.Error);
    }

    [Fact]
    public void Get_settings_reflects_drift_after_a_machine_scoped_write()
    {
        var fleetHost = NewFleetHostWithRegisteredMachines(AoiMachine);
        var store = NewStore();
        store.Ensure(AoiMachine.Code, MachineParameterSchema.AoiInspection);
        store.SetAdjustment(AoiMachine.Code, "exposureUs", 1800, AdjustmentScope.Machine, null, "tech1", null);

        var dto = ExpectOk<MachineSettingsResponseDto>(MachineSettingsEndpoints.GetSettings(AoiMachine.Code, null, fleetHost, store));

        Assert.Contains("exposureUs", dto.DriftedKeys);
        var exposure = dto.Effective.Single(p => p.Def.Key == "exposureUs");
        Assert.Equal(1800, exposure.Value);
        Assert.Equal(ConfigProvenance.Machine, exposure.Source);
    }

    // ─────────────────────────────────────────────────────────────────────
    // PUT /v1/machines/{code}/settings/{key}
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Put_setting_machine_scope_persists_and_round_trips_snake_case_scope()
    {
        var fleetHost = NewFleetHostWithRegisteredMachines(AoiMachine);
        var store = NewStore();

        const string json = """{ "value": 1800, "scope": "machine", "note": "window glare" }""";
        var result = await MachineSettingsEndpoints.UpdateSettingAsync(
            JsonRequest(json), AoiMachine.Code, "exposureUs", fleetHost, store, CancellationToken.None);

        var dto = ExpectOk<MachineSettingsResponseDto>(result);
        var exposure = dto.Effective.Single(p => p.Def.Key == "exposureUs");
        Assert.Equal(1800, exposure.Value);
        Assert.Equal(ConfigProvenance.Machine, exposure.Source);

        var persisted = store.GetConfig(AoiMachine.Code)!;
        Assert.Equal(1800, persisted.MachineAdjustments["exposureUs"].Value);
        Assert.Equal("window glare", persisted.MachineAdjustments["exposureUs"].Note);
    }

    [Fact]
    public async Task Put_setting_product_scope_requires_product_and_wins_for_that_product_only()
    {
        var fleetHost = NewFleetHostWithRegisteredMachines(AoiMachine);
        var store = NewStore();

        const string json = """{ "value": 3200, "scope": "product", "product": "MODEL-B", "note": "darker substrate" }""";
        var result = await MachineSettingsEndpoints.UpdateSettingAsync(
            JsonRequest(json), AoiMachine.Code, "exposureUs", fleetHost, store, CancellationToken.None);

        var dto = ExpectOk<MachineSettingsResponseDto>(result);
        Assert.Equal("MODEL-B", dto.ProductCode);
        var exposure = dto.Effective.Single(p => p.Def.Key == "exposureUs");
        Assert.Equal(3200, exposure.Value);
        Assert.Equal(ConfigProvenance.MachineProduct, exposure.Source);

        // A different product on the same machine is unaffected.
        var otherProduct = MachineSettingsEndpoints.GetSettings(AoiMachine.Code, "MODEL-A", fleetHost, store);
        var otherDto = ExpectOk<MachineSettingsResponseDto>(otherProduct);
        Assert.Equal(1500, otherDto.Effective.Single(p => p.Def.Key == "exposureUs").Value); // still baseline
    }

    [Fact]
    public async Task Put_setting_out_of_range_returns_400_naming_the_allowed_range()
    {
        var fleetHost = NewFleetHostWithRegisteredMachines(AoiMachine);
        var store = NewStore();

        const string json = """{ "value": 99999, "scope": "machine" }""";
        var result = await MachineSettingsEndpoints.UpdateSettingAsync(
            JsonRequest(json), AoiMachine.Code, "exposureUs", fleetHost, store, CancellationToken.None);

        var error = ExpectBadRequest(result);
        Assert.Contains("exposureUs", error.Error);
        Assert.Contains("50", error.Error);
        Assert.Contains("20000", error.Error);

        // The rejected write must not have been persisted.
        var cfg = store.GetConfig(AoiMachine.Code);
        Assert.True(cfg is null || !cfg.MachineAdjustments.ContainsKey("exposureUs"));
    }

    [Fact]
    public async Task Put_setting_unknown_key_returns_404()
    {
        var fleetHost = NewFleetHostWithRegisteredMachines(AoiMachine);
        var store = NewStore();

        const string json = """{ "value": 1, "scope": "machine" }""";
        var result = await MachineSettingsEndpoints.UpdateSettingAsync(
            JsonRequest(json), AoiMachine.Code, "notARealKey", fleetHost, store, CancellationToken.None);

        ExpectNotFound(result);
    }

    [Fact]
    public async Task Put_setting_product_scope_on_iot_machine_returns_400()
    {
        var fleetHost = NewFleetHostWithRegisteredMachines(IotMachine);
        var store = NewStore();

        const string json = """{ "value": 5, "scope": "product", "product": "ANY" }""";
        var result = await MachineSettingsEndpoints.UpdateSettingAsync(
            JsonRequest(json), IotMachine.Code, "sampleRateHz", fleetHost, store, CancellationToken.None);

        var error = ExpectBadRequest(result);
        Assert.Contains("no product dimension", error.Error);
    }

    [Fact]
    public async Task Malformed_json_body_on_put_setting_returns_400_not_500()
    {
        var fleetHost = NewFleetHostWithRegisteredMachines(AoiMachine);
        var store = NewStore();

        var result = await MachineSettingsEndpoints.UpdateSettingAsync(
            JsonRequest("{ not valid"), AoiMachine.Code, "exposureUs", fleetHost, store, CancellationToken.None);

        ExpectBadRequest(result);
    }

    [Fact]
    public async Task Empty_body_on_put_setting_returns_friendly_400()
    {
        var fleetHost = NewFleetHostWithRegisteredMachines(AoiMachine);
        var store = NewStore();

        var result = await MachineSettingsEndpoints.UpdateSettingAsync(
            EmptyBodyRequest(), AoiMachine.Code, "exposureUs", fleetHost, store, CancellationToken.None);

        var error = ExpectBadRequest(result);
        Assert.Contains("body", error.Error, StringComparison.OrdinalIgnoreCase);
    }

    // ─────────────────────────────────────────────────────────────────────
    // DELETE /v1/machines/{code}/settings/{key}
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Delete_setting_resets_to_the_layer_below()
    {
        var fleetHost = NewFleetHostWithRegisteredMachines(AoiMachine);
        var store = NewStore();
        store.Ensure(AoiMachine.Code, MachineParameterSchema.AoiInspection);
        store.SetAdjustment(AoiMachine.Code, "gain", 2.0, AdjustmentScope.Machine, null, "tech1", null);

        var result = MachineSettingsEndpoints.DeleteSetting(AoiMachine.Code, "gain", "machine", null, fleetHost, store);

        var dto = ExpectOk<MachineSettingsResponseDto>(result);
        var gain = dto.Effective.Single(p => p.Def.Key == "gain");
        Assert.Equal(1.0, gain.Value); // schema default
        Assert.Equal(ConfigProvenance.Baseline, gain.Source);
    }

    [Fact]
    public void Delete_setting_rejects_an_unparseable_scope_with_400()
    {
        var fleetHost = NewFleetHostWithRegisteredMachines(AoiMachine);
        var store = NewStore();
        store.Ensure(AoiMachine.Code, MachineParameterSchema.AoiInspection);

        // Reproduces the live gotcha this fix addresses (see `DeleteSetting`'s own doc comment): a
        // completely garbage scope value must 400 with a real, non-empty body naming the problem —
        // never the framework-level empty-body 400 the old `AdjustmentScope`-typed parameter produced
        // for ANY casing other than the exact C# member name.
        var result = MachineSettingsEndpoints.DeleteSetting(AoiMachine.Code, "gain", "sideways", null, fleetHost, store);

        var error = ExpectBadRequest(result);
        Assert.Contains("scope", error.Error, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Delete_setting_accepts_lower_case_scope_matching_the_wire_vocabulary()
    {
        // The exact casing every other part of the contract uses (PUT's JSON body, GET/PUT response
        // `source` values) — `?scope=machine`, not `?scope=Machine`.
        var fleetHost = NewFleetHostWithRegisteredMachines(AoiMachine);
        var store = NewStore();
        store.Ensure(AoiMachine.Code, MachineParameterSchema.AoiInspection);
        store.SetAdjustment(AoiMachine.Code, "gain", 2.0, AdjustmentScope.Machine, null, "tech1", null);

        var result = MachineSettingsEndpoints.DeleteSetting(AoiMachine.Code, "gain", "machine", null, fleetHost, store);

        var dto = ExpectOk<MachineSettingsResponseDto>(result);
        Assert.Equal(ConfigProvenance.Baseline, dto.Effective.Single(p => p.Def.Key == "gain").Source);
    }

    // ─────────────────────────────────────────────────────────────────────
    // POST /v1/machines/{code}/settings/pull
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Pull_with_no_body_refreshes_baseline_and_preserves_adjustments()
    {
        var fleetHost = NewFleetHostWithRegisteredMachines(AoiMachine);
        var store = NewStore();
        store.Ensure(AoiMachine.Code, MachineParameterSchema.AoiInspection);
        store.SetAdjustment(AoiMachine.Code, "exposureUs", 1800, AdjustmentScope.Machine, null, "tech1", null);

        var result = await MachineSettingsEndpoints.PullSettingsAsync(
            EmptyBodyRequest(), AoiMachine.Code, fleetHost, store, NewDemoBackend(), CancellationToken.None);

        var dto = ExpectOk<MachineSettingsResponseDto>(result);
        Assert.Equal(2, dto.Baseline.Version);
        Assert.True(dto.MachineAdjustments.ContainsKey("exposureUs"));
        Assert.Equal(1800, dto.MachineAdjustments["exposureUs"].Value);
        // AOI has no seeded Demo recipe (SimulatedEcosystem only seeds a SCREWDRIVE one) — an honest
        // "no server recommendation" source, schema defaults used, same values as before Task 7.
        Assert.Contains("Demo:", dto.BaselineSource);
        Assert.Contains("schema defaults", dto.BaselineSource, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Pull_for_a_screwdrive_machine_threads_the_Demo_ecosystems_seeded_recipe_values_into_the_baseline()
    {
        // SimulatedEcosystem's own seed recipe (SCREWDRIVE-M4) carries speedRpm/angleTarget/torqueTarget/
        // torqueTolerance/clampTimeMs keys that match MachineParameterSchema.ScrewProgram's keys exactly
        // (docs/plans/2026-07-21-machine-config.md Task 1's "bám đúng tên trường server" — Demo's seed
        // recipe was itself built to match). Task 7 threads it through TryFetchServerBaselineAsync.
        var screwMachine = new MachineDescriptor(
            "TEST-SCRW-XYZ", "SN-TEST-SCRW-XYZ", DeviceClass.Automation, "SCREWDRIVE", "M4", DriverKind.Simulated, "RC-SCRW-A", "screwdrive", 0.85);
        var fleetHost = NewFleetHostWithRegisteredMachines(screwMachine);
        var store = NewStore();

        var result = await MachineSettingsEndpoints.PullSettingsAsync(
            EmptyBodyRequest(), screwMachine.Code, fleetHost, store, NewDemoBackend(), CancellationToken.None);

        var dto = ExpectOk<MachineSettingsResponseDto>(result);
        Assert.Contains("SCREWDRIVE-M4", dto.BaselineSource);
        // SimulatedEcosystem.BuildSeedRecipes() deliberately diverges torqueTarget from
        // ProductConfigStore's own seed (1.35 -> 1.40, "torque +0.05 Nm") so a fresh pull is non-trivial
        // — see that method's own doc comment. torqueTolerance/speedRpm are untouched by the divergence.
        Assert.Equal(1.40, dto.Baseline.Values["torqueTarget"]);
        Assert.Equal(0.15, dto.Baseline.Values["torqueTolerance"]);
        Assert.Equal(450, dto.Baseline.Values["speedRpm"]);
    }

    // ─────────────────────────────────────────────────────────────────────
    // POST /v1/machines/{code}/settings/push
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Push_reports_actual_config_and_never_changes_baseline_version()
    {
        var fleetHost = NewFleetHostWithRegisteredMachines(AoiMachine);
        var store = NewStore();
        var before = store.Ensure(AoiMachine.Code, MachineParameterSchema.AoiInspection);
        store.SetAdjustment(AoiMachine.Code, "exposureUs", 1800, AdjustmentScope.Machine, null, "tech1", null);
        var beforeVersion = store.GetConfig(AoiMachine.Code)!.Baseline.Version;

        const string json = """{ "product": "MODEL-A", "by": "tech1" }""";
        var result = await MachineSettingsEndpoints.PushSettingsAsync(
            JsonRequest(json), AoiMachine.Code, fleetHost, store, NewDemoBackend(), CancellationToken.None);

        var dto = ExpectOk<MachineSettingsPushResultDto>(result);
        Assert.Equal(beforeVersion, dto.BaselineVersion);
        Assert.Equal(1800, dto.Effective.Single(p => p.Def.Key == "exposureUs").Value);

        var after = store.GetConfig(AoiMachine.Code)!;
        Assert.Equal(before.Baseline.Version, after.Baseline.Version); // untouched by push
        Assert.Contains(after.History, h => h.Op == "push");

        // Task 7 — Demo push is a local mirror only, never network: LiveReport says so honestly.
        Assert.False(dto.LiveReport.Attempted);
        Assert.True(dto.LiveReport.Success);
        Assert.Equal("Demo", dto.LiveReport.BackendName);
    }

    [Fact]
    public async Task Malformed_json_body_on_push_returns_400_not_500()
    {
        var fleetHost = NewFleetHostWithRegisteredMachines(AoiMachine);
        var store = NewStore();

        var result = await MachineSettingsEndpoints.PushSettingsAsync(
            JsonRequest("{ not valid"), AoiMachine.Code, fleetHost, store, NewDemoBackend(), CancellationToken.None);

        ExpectBadRequest(result);
    }

    [Fact]
    public async Task Push_in_Live_mode_reports_ONLY_the_product_scoped_adjustments_map_to_the_real_server()
    {
        var fleetHost = NewFleetHostWithRegisteredMachines(AoiMachine);
        var store = NewStore();
        store.Ensure(AoiMachine.Code, MachineParameterSchema.AoiInspection);
        // Two DIFFERENT adjustments at two DIFFERENT scopes — the request sent to the real server for a
        // product-scoped push must carry ONLY the product one, never the machine-scoped one too (see
        // MachineSettingsReportRequestDto's "never both scopes combined" doc comment).
        store.SetAdjustment(AoiMachine.Code, "gain", 2.5, AdjustmentScope.Machine, null, "tech1", "machine-wide recalibration");
        store.SetAdjustment(AoiMachine.Code, "exposureUs", 3200, AdjustmentScope.Product, "MODEL-B", "tech2", "darker substrate");

        var h = new CapturingHandler
        {
            Responder = (_, _) => (HttpStatusCode.OK, """{"success":true,"id":9,"scope":"machine_product"}"""),
        };
        using var live = LiveConfigSyncBackend.ForMachine("http://synapse.local", "mk_test", AoiMachine.Code, verifyTls: true, handler: h);

        const string json = """{ "product": "MODEL-B", "by": "tech2" }""";
        var result = await MachineSettingsEndpoints.PushSettingsAsync(
            JsonRequest(json), AoiMachine.Code, fleetHost, store, live, CancellationToken.None);

        var dto = ExpectOk<MachineSettingsPushResultDto>(result);
        Assert.True(dto.LiveReport.Attempted);
        Assert.True(dto.LiveReport.Success);
        Assert.Equal("Live", dto.LiveReport.BackendName);

        Assert.NotNull(h.LastRequest);
        Assert.Equal("http://synapse.local/api/machine/config-sync/report-settings", h.LastRequest!.RequestUri!.ToString());
        var body = h.LastBody!;
        Assert.Contains("\"productModelCode\":\"MODEL-B\"", body);
        Assert.Contains("\"exposureUs\":{\"value\":3200", body);
        Assert.DoesNotContain("\"gain\":", body); // the machine-scoped one must NOT leak into a product-scoped report
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/machines/{code}/settings/history
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task History_lists_set_and_push_events_newest_first()
    {
        var fleetHost = NewFleetHostWithRegisteredMachines(AoiMachine);
        var store = NewStore();

        await MachineSettingsEndpoints.UpdateSettingAsync(
            JsonRequest("""{ "value": 1800, "scope": "machine" }"""), AoiMachine.Code, "exposureUs", fleetHost, store, CancellationToken.None);
        await MachineSettingsEndpoints.PushSettingsAsync(
            JsonRequest("""{ "product": "MODEL-A" }"""), AoiMachine.Code, fleetHost, store, NewDemoBackend(), CancellationToken.None);

        var result = MachineSettingsEndpoints.GetHistory(AoiMachine.Code, fleetHost, store);
        var history = ExpectOk<IReadOnlyList<MachineConfigHistoryEntry>>(result);

        Assert.Equal(new[] { "push", "set" }, history.Select(h => h.Op).ToArray());
    }

    [Fact]
    public void History_for_an_unknown_machine_returns_404()
    {
        var fleetHost = NewFleetHostWithRegisteredMachines(AoiMachine);
        var store = NewStore();

        var result = MachineSettingsEndpoints.GetHistory("NO-SUCH-MACHINE", fleetHost, store);

        ExpectNotFound(result);
    }
}
