using System.Net;
using System.Net.Http;
using System.Text.Json;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Models;
using St4i.EngineApi.Config;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// Task C3 — <see cref="LiveConfigSyncBackend"/>. Uses a stub <see cref="HttpMessageHandler"/> (same
/// "capture the request, script the response" shape as <c>St4i.EdgeCore.Tests.Fakes.CapturingHandler</c>
/// used by <c>LiveTransportTests</c> — duplicated locally since this test project has no reference to
/// St4i.EdgeCore.Tests) to assert Live builds exact requests against the real server contract and maps
/// responses/errors the way the plan requires: friendly states, never an exception, except the one
/// documented KeyNotFoundException case on a 404 push.
/// </summary>
public sealed class LiveConfigSyncTests
{
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

    private static LiveConfigSyncBackend Backend(CapturingHandler h, string mkKey = "mk_test", string machineCode = "AOI-01") =>
        LiveConfigSyncBackend.ForMachine("http://synapse.local", mkKey, machineCode, verifyTls: true, handler: h);

    // ─────────────────────────────────────────────────────────────────────
    // get-points — exact URL + query.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task GetPointsAsync_builds_exact_url_and_query()
    {
        var h = new CapturingHandler
        {
            Responder = (_, _) => (HttpStatusCode.OK, """
                {"success":true,"machineId":7,"machineCode":"AOI-01","productModels":[
                  {"productModelId":1,"productModelCode":"MODEL-A","productModelName":"Bo mach",
                   "referenceImageUrl":"https://x/model-a.png","imageWidth":1600,"imageHeight":1200,
                   "pointsConfigVersion":5,"coordinateMode":"pixel","fiducials":[],"totalPoints":1,
                   "points":[{"code":"P05","name":"Resistor R5","measurementType":"DIMENSION",
                     "toleranceMode":"range","shape":"circle","lowerLimit":4700,"upperLimit":5300,
                     "positionX":480,"positionY":840,"orderIndex":4,"isActive":true}]}
                ]}
                """
            )
        };
        using var backend = Backend(h);

        var product = await backend.GetPointsAsync("MODEL-A", null, default);

        Assert.NotNull(h.LastRequest);
        Assert.Equal(HttpMethod.Get, h.LastRequest!.Method);
        var url = h.LastRequest.RequestUri!.ToString();
        Assert.StartsWith("http://synapse.local/api/machine/get-points?", url);
        Assert.Contains("machineCode=AOI-01", url);
        Assert.Contains("productModelCode=MODEL-A", url);
        Assert.Equal("mk_test", h.LastRequest.Headers.GetValues("X-API-Key").Single());

        // The response's own enum casing round-trips correctly (SnakeUpper/SnakeLower type converters,
        // no competing global JsonStringEnumConverter — same ConfigJson.Options gotcha C2 hit on the /v1
        // response path, verified here on the INBOUND Live side).
        Assert.NotNull(product);
        Assert.Equal("MODEL-A", product!.Code);
        Assert.Equal(CoordinateMode.Pixel, product.CoordinateMode);
        var p05 = Assert.Single(product.Points);
        Assert.Equal(MeasurementType.Dimension, p05.MeasurementType);
        Assert.Equal(ToleranceMode.Range, p05.ToleranceMode);
        Assert.Equal(PointShape.Circle, p05.Shape);
        Assert.Equal(4700, p05.LowerLimit);
        Assert.Equal(5300, p05.UpperLimit);
    }

    // ─────────────────────────────────────────────────────────────────────
    // sync-points POST body — full point shape, correct enum casing, expectedUpdatedAt, X-API-Key.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task SyncPointsAsync_posts_full_point_shape_with_contract_casing_and_auth_header()
    {
        var h = new CapturingHandler
        {
            Responder = (_, _) => (HttpStatusCode.OK, """
                {"success":true,"productModelCode":"MODEL-A","previousVersion":5,"newVersion":6,
                 "pointsCreated":0,"pointsUpdated":1,"pointsFailed":0,"staleConflicts":0,"blindOverwrites":1,
                 "limitChangesBlocked":false,"points":[{"code":"P05","status":"updated","limitBlocked":false}]}
                """
            )
        };
        using var backend = Backend(h);

        var expectedUpdatedAt = new DateTimeOffset(2026, 7, 20, 10, 0, 0, TimeSpan.FromHours(7));
        var point = new SyncPointDto(
            Code: "P05", Name: "Resistor R5", Description: "Gia tri dien tro R5",
            MeasurementType: "DIMENSION", Unit: "Ω",
            LowerLimit: 4700, UpperLimit: 5300, NominalValue: 5000,
            PositionX: 480, PositionY: 840, Radius: null,
            NormalizedX: 0.30, NormalizedY: 0.70, NormalizedRadius: null,
            CropWidth: 40, CropHeight: 24, OrderIndex: 4, WorkstationCode: null, IsActive: true,
            ImageBase64: null, ImageMimeType: null, ImageUrl: null,
            Shape: "circle", Geometry: null,
            ExpectedUpdatedAt: expectedUpdatedAt);
        var request = new SyncPointsRequestDto("AOI-01", "MODEL-A", null, null, null, null, new[] { point });

        var result = await backend.SyncPointsAsync("MODEL-A", request, default);

        Assert.True(result.Success);
        Assert.Equal(HttpMethod.Post, h.LastRequest!.Method);
        Assert.Equal("http://synapse.local/api/machine/sync-points", h.LastRequest.RequestUri!.ToString());
        Assert.Equal("mk_test", h.LastRequest.Headers.GetValues("X-API-Key").Single());

        var body = h.LastBody!;
        Assert.Contains("\"measurementType\":\"DIMENSION\"", body);
        Assert.Contains("\"shape\":\"circle\"", body);
        Assert.Contains("\"code\":\"P05\"", body);
        Assert.Contains("\"positionX\":480", body);
        Assert.Contains("\"expectedUpdatedAt\":\"2026-07-20T10:00:00", body);
        // Null-optional fields (radius/normalizedRadius/description present but e.g. workstationCode)
        // are OMITTED, not sent as an explicit JSON null — see LiveConfigSyncBackend.RequestOptions'
        // doc comment for why (the LiveTransport defectSeverity precedent).
        Assert.DoesNotContain("\"workstationCode\":null", body);
        Assert.DoesNotContain("\"radius\":null", body);
    }

    // ─────────────────────────────────────────────────────────────────────
    // sync-points response with limitBlocked:true + counts — parsed and surfaced.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task SyncPointsAsync_surfaces_limitBlocked_and_governance_counts_from_response()
    {
        var h = new CapturingHandler
        {
            Responder = (_, _) => (HttpStatusCode.OK, """
                {"success":true,"productModelCode":"MODEL-A","previousVersion":5,"newVersion":6,
                 "pointsCreated":0,"pointsUpdated":8,"pointsFailed":0,"staleConflicts":2,"blindOverwrites":3,
                 "limitChangesBlocked":true,
                 "points":[
                   {"code":"P05","status":"updated","limitBlocked":true,"message":"limit fields blocked by threshold governance"},
                   {"code":"P06","status":"updated","limitBlocked":false}
                 ]}
                """
            )
        };
        using var backend = Backend(h);
        var request = new SyncPointsRequestDto("AOI-01", "MODEL-A", null, null, null, null, new[]
        {
            MakePoint("P05"), MakePoint("P06"),
        });

        var result = await backend.SyncPointsAsync("MODEL-A", request, default);

        Assert.True(result.Success);
        Assert.Equal(5, result.PreviousVersion);
        Assert.Equal(6, result.NewVersion);
        Assert.Equal(2, result.StaleConflicts);
        Assert.Equal(3, result.BlindOverwrites);
        Assert.True(result.LimitChangesBlocked);
        var p05Outcome = Assert.Single(result.Points, p => p.Code == "P05");
        Assert.True(p05Outcome.LimitBlocked);
        Assert.Equal("limit fields blocked by threshold governance", p05Outcome.Message);
        var p06Outcome = Assert.Single(result.Points, p => p.Code == "P06");
        Assert.False(p06Outcome.LimitBlocked);
    }

    // ─────────────────────────────────────────────────────────────────────
    // config-sync/check for recipe — exact query.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task CheckRecipeAsync_builds_config_sync_check_query()
    {
        var h = new CapturingHandler
        {
            Responder = (_, _) => (HttpStatusCode.OK, """
                {"success":true,"configKind":"recipe","code":"SCREWDRIVE-M4","version":"3",
                 "checksum":"abc123","resolvedBy":"machineType"}
                """),
        };
        using var backend = Backend(h, machineCode: "SCRW-01");

        var result = await backend.CheckRecipeAsync(null, "SCREWDRIVE", "recipe", default);

        Assert.Equal(HttpMethod.Get, h.LastRequest!.Method);
        var url = h.LastRequest.RequestUri!.ToString();
        Assert.StartsWith("http://synapse.local/api/machine/config-sync/check?", url);
        Assert.Contains("configKind=recipe", url);
        Assert.Contains("machineCode=SCRW-01", url);

        Assert.True(result.Success);
        Assert.Equal("SCREWDRIVE-M4", result.Code);
        Assert.Equal(3, result.Version);
        Assert.Equal("machineType", result.ResolvedBy);
    }

    // ─────────────────────────────────────────────────────────────────────
    // config-sync/check — Task review #4: an IoT machine's configKind is "device_settings", not always
    // the hardcoded "recipe" the pre-fix code always sent regardless of caller.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task CheckRecipeAsync_for_an_IoT_machine_sends_device_settings_configKind()
    {
        var h = new CapturingHandler
        {
            Responder = (_, _) => (HttpStatusCode.OK, """{"success":false,"resolvedBy":"none"}"""),
        };
        using var backend = Backend(h, machineCode: "IOT-01");

        await backend.CheckRecipeAsync(null, "IOT_SENSOR", "device_settings", default);

        var url = h.LastRequest!.RequestUri!.ToString();
        Assert.Contains("configKind=device_settings", url);
    }

    [Fact]
    public async Task GetRecipeAsync_sends_the_configKind_it_was_given()
    {
        var h = new CapturingHandler
        {
            Responder = (_, _) => (HttpStatusCode.OK, """
                {"success":true,"configKind":"device_settings","code":"IOT-SETTINGS-1","name":"IoT settings",
                 "version":"1","checksum":"abc","payload":{"reportIntervalSec":30}}
                """),
        };
        using var backend = Backend(h, machineCode: "IOT-01");

        var recipe = await backend.GetRecipeAsync("IOT-SETTINGS-1", "device_settings", default);

        var url = h.LastRequest!.RequestUri!.ToString();
        Assert.Contains("configKind=device_settings", url);
        Assert.NotNull(recipe);
        Assert.Equal("IOT-SETTINGS-1", recipe!.Code);
    }

    // ─────────────────────────────────────────────────────────────────────
    // config-sync/ack — Task review #4: real POST, friendly (never throws) on every non-2xx/not-configured
    // path, matching every other Live call's error-handling shape.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task AckAsync_posts_configKind_code_version_checksum_and_parses_driftState()
    {
        var h = new CapturingHandler
        {
            Responder = (_, _) => (HttpStatusCode.OK, """
                {"success":true,"machineId":42,"configKind":"recipe","driftState":"in_sync"}
                """),
        };
        using var backend = Backend(h, machineCode: "SCRW-01");

        var result = await backend.AckAsync("recipe", "SCREWDRIVE-M4", 3, "abc123", default);

        Assert.Equal(HttpMethod.Post, h.LastRequest!.Method);
        Assert.Equal("http://synapse.local/api/machine/config-sync/ack", h.LastRequest.RequestUri!.ToString());
        var body = h.LastBody!;
        Assert.Contains("\"configKind\":\"recipe\"", body);
        Assert.Contains("\"code\":\"SCREWDRIVE-M4\"", body);
        Assert.Contains("\"version\":3", body);
        Assert.Contains("\"checksum\":\"abc123\"", body);

        Assert.True(result.Success);
        Assert.Equal("42", result.MachineId);
        Assert.Equal("in_sync", result.DriftState);
    }

    [Fact]
    public async Task AckAsync_with_no_mkKey_returns_friendly_result_not_throw()
    {
        var h = new CapturingHandler
        {
            Responder = (_, _) => throw new InvalidOperationException("handler must never be reached — not configured"),
        };
        var backend = LiveConfigSyncBackend.ForMachine("http://synapse.local", mkKey: null, machineCode: "SCRW-01", verifyTls: true, handler: h);

        var result = await backend.AckAsync("recipe", "SCREWDRIVE-M4", 3, "abc123", default);

        Assert.False(result.Success);
        Assert.Null(h.LastRequest);
    }

    [Fact]
    public async Task AckAsync_with_HTTP_500_flag_off_returns_friendly_result_not_throw()
    {
        var h = new CapturingHandler
        {
            Responder = (_, _) => (HttpStatusCode.InternalServerError, """{"error":"config-sync disabled"}"""),
        };
        using var backend = Backend(h, machineCode: "SCRW-01");

        var result = await backend.AckAsync("recipe", "SCREWDRIVE-M4", 3, "abc123", default);

        Assert.False(result.Success);
    }

    // ─────────────────────────────────────────────────────────────────────
    // HTTP 500 on config-sync/get (CONFIG_SYNC_GENERIC_ENABLED off) — friendly disabled state, no throw.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task GetRecipeAsync_with_HTTP_500_flag_off_returns_null_not_throw()
    {
        var h = new CapturingHandler
        {
            Responder = (_, _) => (HttpStatusCode.InternalServerError, """{"error":"config-sync disabled"}"""),
        };
        using var backend = Backend(h, machineCode: "SCRW-01");

        var recipe = await backend.GetRecipeAsync("SCREWDRIVE-M4", "recipe", default);

        Assert.Null(recipe);
        Assert.Equal("http://synapse.local/api/machine/config-sync/get", h.LastRequest!.RequestUri!.GetLeftPart(UriPartial.Path));
    }

    [Fact]
    public async Task CheckRecipeAsync_with_HTTP_500_flag_off_returns_unresolved_not_throw()
    {
        var h = new CapturingHandler
        {
            Responder = (_, _) => (HttpStatusCode.InternalServerError, """{"error":"config-sync disabled"}"""),
        };
        using var backend = Backend(h, machineCode: "SCRW-01");

        var result = await backend.CheckRecipeAsync(null, "SCREWDRIVE", "recipe", default);

        Assert.False(result.Success);
        Assert.Null(result.Code);
        Assert.Equal("none", result.ResolvedBy);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 401/404 — friendly error results, no throw (except SyncPointsAsync's documented 404 case below).
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task CheckPointsVersionAsync_with_401_returns_empty_not_throw()
    {
        var h = new CapturingHandler
        {
            Responder = (_, _) => (HttpStatusCode.Unauthorized, """{"error":"invalid mk_"}"""),
        };
        using var backend = Backend(h);

        var versions = await backend.CheckPointsVersionAsync("MODEL-A", default);

        Assert.Empty(versions);
    }

    [Fact]
    public async Task GetPointsAsync_with_404_returns_null_not_throw()
    {
        var h = new CapturingHandler
        {
            Responder = (_, _) => (HttpStatusCode.NotFound, """{"error":"not found"}"""),
        };
        using var backend = Backend(h);

        var product = await backend.GetPointsAsync("NOPE", null, default);

        Assert.Null(product);
    }

    // SyncPointsAsync's own IConfigSyncBackend contract documents throwing KeyNotFoundException on an
    // unknown product — ConfigEndpoints already catches that and maps it to a friendly HTTP 404, so this
    // keeps Demo/Live behaving identically (SimulatedEcosystem also throws for the same case).
    [Fact]
    public async Task SyncPointsAsync_with_404_throws_KeyNotFoundException_matching_interface_contract()
    {
        var h = new CapturingHandler
        {
            Responder = (_, _) => (HttpStatusCode.NotFound, """{"error":"product not found"}"""),
        };
        using var backend = Backend(h);
        var request = new SyncPointsRequestDto("AOI-01", "NOPE", null, null, null, null, new[] { MakePoint("P01") });

        await Assert.ThrowsAsync<KeyNotFoundException>(() => backend.SyncPointsAsync("NOPE", request, default));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Guarded push: not configured (no serverUrl/mk_) — friendly result, no exception, handler never hit.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task SyncPointsAsync_with_no_mkKey_returns_friendly_not_configured_result_not_throw()
    {
        var h = new CapturingHandler
        {
            Responder = (_, _) => throw new InvalidOperationException("handler must never be reached — not configured"),
        };
        var backend = LiveConfigSyncBackend.ForMachine("http://synapse.local", mkKey: null, machineCode: "AOI-01", verifyTls: true, handler: h);
        var request = new SyncPointsRequestDto("AOI-01", "MODEL-A", null, null, null, null, new[] { MakePoint("P01") });

        var result = await backend.SyncPointsAsync("MODEL-A", request, default);

        Assert.False(result.Success);
        Assert.Equal(1, result.PointsFailed);
        var outcome = Assert.Single(result.Points);
        Assert.Equal("failed", outcome.Status);
        Assert.Contains("not configured", outcome.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Null(h.LastRequest);
    }

    [Fact]
    public async Task SyncPointsAsync_with_no_serverUrl_returns_friendly_not_configured_result_not_throw()
    {
        var h = new CapturingHandler
        {
            Responder = (_, _) => throw new InvalidOperationException("handler must never be reached — not configured"),
        };
        var backend = LiveConfigSyncBackend.ForMachine(serverUrl: "", mkKey: "mk_test", machineCode: "AOI-01", verifyTls: true, handler: h);
        var request = new SyncPointsRequestDto("AOI-01", "MODEL-A", null, null, null, null, new[] { MakePoint("P01") });

        var result = await backend.SyncPointsAsync("MODEL-A", request, default);

        Assert.False(result.Success);
        Assert.Null(h.LastRequest);
    }

    // ─────────────────────────────────────────────────────────────────────
    // ConfigSyncCoordinator — Task C3's "wire backend selection by mode".
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public void ConfigSyncCoordinator_Demo_mode_always_selects_SimulatedEcosystem()
    {
        var (coordinator, switchable, demo, _) = MakeCoordinator(configured: true);

        coordinator.ApplyMode(TransportMode.Demo);

        Assert.Same(demo, switchable.Inner);
    }

    [Fact]
    public void ConfigSyncCoordinator_Live_mode_selects_Live_even_when_unconfigured()
    {
        var (coordinator, switchable, _, live) = MakeCoordinator(configured: false);

        coordinator.ApplyMode(TransportMode.Live);

        Assert.Same(live, switchable.Inner);
    }

    [Fact]
    public void ConfigSyncCoordinator_Auto_mode_selects_Live_when_configured_else_Demo()
    {
        var (configuredCoordinator, configuredSwitchable, _, configuredLive) = MakeCoordinator(configured: true);
        configuredCoordinator.ApplyMode(TransportMode.Auto);
        Assert.Same(configuredLive, configuredSwitchable.Inner);

        var (unconfiguredCoordinator, unconfiguredSwitchable, unconfiguredDemo, _) = MakeCoordinator(configured: false);
        unconfiguredCoordinator.ApplyMode(TransportMode.Auto);
        Assert.Same(unconfiguredDemo, unconfiguredSwitchable.Inner);
    }

    private static (ConfigSyncCoordinator Coordinator, SwitchableConfigSyncBackend Switchable, SimulatedEcosystem Demo, LiveConfigSyncBackend Live)
        MakeCoordinator(bool configured)
    {
        var demo = new SimulatedEcosystem(Directory.CreateTempSubdirectory("st4i-live-config-sync-tests-").FullName);
        var live = configured
            ? LiveConfigSyncBackend.ForMachine("http://synapse.local", "mk_test", "AOI-01", true, new CapturingHandler())
            : LiveConfigSyncBackend.ForMachine("", null, "AOI-01", true, new CapturingHandler());
        var switchable = new SwitchableConfigSyncBackend(demo);
        var coordinator = new ConfigSyncCoordinator(switchable, demo, live);
        return (coordinator, switchable, demo, live);
    }

    private static SyncPointDto MakePoint(string code) => new(
        Code: code, Name: code, Description: null, MeasurementType: "DIMENSION", Unit: null,
        LowerLimit: null, UpperLimit: null, NominalValue: null,
        PositionX: 0, PositionY: 0, Radius: null, NormalizedX: null, NormalizedY: null, NormalizedRadius: null,
        CropWidth: null, CropHeight: null, OrderIndex: null, WorkstationCode: null, IsActive: true,
        ImageBase64: null, ImageMimeType: null, ImageUrl: null, Shape: "circle", Geometry: null,
        ExpectedUpdatedAt: null);
}
