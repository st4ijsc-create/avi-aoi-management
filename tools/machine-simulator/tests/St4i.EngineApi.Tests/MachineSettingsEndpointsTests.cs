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

        var result = MachineSettingsEndpoints.DeleteSetting(AoiMachine.Code, "gain", AdjustmentScope.Machine, null, fleetHost, store);

        var dto = ExpectOk<MachineSettingsResponseDto>(result);
        var gain = dto.Effective.Single(p => p.Def.Key == "gain");
        Assert.Equal(1.0, gain.Value); // schema default
        Assert.Equal(ConfigProvenance.Baseline, gain.Source);
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
            EmptyBodyRequest(), AoiMachine.Code, fleetHost, store, CancellationToken.None);

        var dto = ExpectOk<MachineSettingsResponseDto>(result);
        Assert.Equal(2, dto.Baseline.Version);
        Assert.True(dto.MachineAdjustments.ContainsKey("exposureUs"));
        Assert.Equal(1800, dto.MachineAdjustments["exposureUs"].Value);
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
            JsonRequest(json), AoiMachine.Code, fleetHost, store, CancellationToken.None);

        var dto = ExpectOk<MachineSettingsPushResultDto>(result);
        Assert.Equal(beforeVersion, dto.BaselineVersion);
        Assert.Equal(1800, dto.Effective.Single(p => p.Def.Key == "exposureUs").Value);

        var after = store.GetConfig(AoiMachine.Code)!;
        Assert.Equal(before.Baseline.Version, after.Baseline.Version); // untouched by push
        Assert.Contains(after.History, h => h.Op == "push");
    }

    [Fact]
    public async Task Malformed_json_body_on_push_returns_400_not_500()
    {
        var fleetHost = NewFleetHostWithRegisteredMachines(AoiMachine);
        var store = NewStore();

        var result = await MachineSettingsEndpoints.PushSettingsAsync(
            JsonRequest("{ not valid"), AoiMachine.Code, fleetHost, store, CancellationToken.None);

        ExpectBadRequest(result);
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
            JsonRequest("""{ "product": "MODEL-A" }"""), AoiMachine.Code, fleetHost, store, CancellationToken.None);

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
