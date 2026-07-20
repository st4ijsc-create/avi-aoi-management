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
/// C4 P0 fix — regression coverage for the REQUEST-side twin of the response-side bug
/// <see cref="ConfigJson"/>'s doc comment describes: <c>ConfigEndpoints</c>' PUT/POST handlers used to
/// bind their DTO (<see cref="ProductModel"/>/<see cref="MeasurementPoint"/>/<see cref="Recipe"/>/
/// <see cref="ConfigPushRequest"/>) as a direct minimal-API parameter, which goes through
/// <c>Program.cs</c>'s DI-configured GLOBAL <c>JsonSerializerOptions</c> (plain
/// <c>JsonStringEnumConverter()</c>, PascalCase member names) instead of <see cref="ConfigJson.Options"/>
/// (the type-level snake_case/UPPER_SNAKE_CASE converters every <c>St4i.EdgeCore.Config</c> enum
/// carries) — so a request body written in the server's OWN wire casing
/// (<c>toleranceMode:"min_only"</c>) silently failed to deserialize. These tests call the endpoint
/// handler methods directly (they're <c>internal</c> — this assembly is named in <c>St4i.EngineApi</c>'s
/// <c>AssemblyInfo.cs</c> <c>InternalsVisibleTo</c>) against a hand-built <see cref="DefaultHttpContext"/>
/// carrying a raw JSON byte body, exactly like a real client's HTTP request would — no
/// WebApplicationFactory/TestServer needed since the fix reads the body explicitly instead of relying on
/// ASP.NET's own request pipeline to bind it.
/// </summary>
public sealed class ConfigEndpointsRequestBodyTests
{
    private static string TempDir() => Directory.CreateTempSubdirectory("st4i-config-endpoints-tests-").FullName;

    private static ProductConfigStore NewStore() => new(TempDir());

    /// <summary>Builds a request carrying <paramref name="json"/> as its body, with a proper
    /// <c>application/json</c> Content-Type + Content-Length — what <c>ReadFromJsonAsync</c> (and thus
    /// <c>ConfigEndpoints.ReadBodyAsync</c>) requires to actually attempt deserialization instead of
    /// short-circuiting on "no body sent".</summary>
    private static DefaultHttpContext JsonRequest(string json, string? contentType = "application/json")
    {
        var bytes = Encoding.UTF8.GetBytes(json);
        var context = new DefaultHttpContext();
        context.Request.Body = new MemoryStream(bytes);
        context.Request.ContentLength = bytes.Length;
        if (contentType is not null) context.Request.ContentType = contentType;
        return context;
    }

    /// <summary>An HTTP request with literally no body at all (Content-Length 0) — what a bare
    /// <c>POST /v1/machines/{code}/config/pull</c> with no body sends.</summary>
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

    // ─────────────────────────────────────────────────────────────────────
    // Product PUT/POST — the exact P0 symptom (MODEL-A/MODEL-B save)
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Put_product_with_min_only_and_max_only_tolerance_modes_saves_and_round_trips()
    {
        var store = NewStore(); // auto-seeds MODEL-A/MODEL-B, exactly like the real engine on first run

        const string json = """
        {
          "code": "MODEL-A",
          "name": "Bo mạch điều khiển chính (Main Control Board)",
          "lifecycleStatus": "active",
          "coordinateMode": "pixel",
          "pointsConfigVersion": 9,
          "points": [
            {
              "code": "P01",
              "name": "C1 Height (min only)",
              "measurementType": "DIMENSION",
              "unit": "mm",
              "lowerLimit": 0.35,
              "toleranceMode": "min_only",
              "positionX": 240,
              "positionY": 240,
              "orderIndex": 0,
              "isActive": true,
              "shape": "circle"
            },
            {
              "code": "P03",
              "name": "Connector CN2 Offset (max only)",
              "measurementType": "POSITION",
              "unit": "mm",
              "upperLimit": 0.20,
              "toleranceMode": "max_only",
              "positionX": 1152,
              "positionY": 660,
              "orderIndex": 1,
              "isActive": true,
              "shape": "rect"
            }
          ]
        }
        """;

        var result = await ConfigEndpoints.UpsertProductAsync(JsonRequest(json), "MODEL-A", store, CancellationToken.None);

        var saved = ExpectOk<ProductModel>(result);
        Assert.Equal(ProductLifecycleStatus.Active, saved.LifecycleStatus);
        Assert.Equal(CoordinateMode.Pixel, saved.CoordinateMode);
        var savedMin = Assert.Single(saved.Points, p => p.Code == "P01");
        Assert.Equal(ToleranceMode.MinOnly, savedMin.ToleranceMode);
        var savedMax = Assert.Single(saved.Points, p => p.Code == "P03");
        Assert.Equal(ToleranceMode.MaxOnly, savedMax.ToleranceMode);

        // Round trip: what GET /v1/products/MODEL-A would return is exactly store.GetProduct — confirm
        // the store (not just the handler's echoed response) actually persisted the parsed enum values.
        var reloaded = store.GetProduct("MODEL-A");
        Assert.NotNull(reloaded);
        Assert.Equal(ToleranceMode.MinOnly, reloaded!.Points.Single(p => p.Code == "P01").ToleranceMode);
        Assert.Equal(ToleranceMode.MaxOnly, reloaded.Points.Single(p => p.Code == "P03").ToleranceMode);
    }

    [Theory]
    [InlineData("development", ProductLifecycleStatus.Development)]
    [InlineData("active", ProductLifecycleStatus.Active)]
    [InlineData("eol", ProductLifecycleStatus.Eol)]
    [InlineData("archived", ProductLifecycleStatus.Archived)]
    public async Task Put_product_round_trips_every_lifecycle_status_wire_value(string wireValue, ProductLifecycleStatus expected)
    {
        var store = NewStore();
        var json = $$"""
        {
          "code": "MODEL-B",
          "name": "Bo mạch nguồn phụ (Power Supply Module)",
          "lifecycleStatus": "{{wireValue}}",
          "coordinateMode": "mm",
          "pointsConfigVersion": 1,
          "points": []
        }
        """;

        var result = await ConfigEndpoints.UpsertProductAsync(JsonRequest(json), "MODEL-B", store, CancellationToken.None);

        var saved = ExpectOk<ProductModel>(result);
        Assert.Equal(expected, saved.LifecycleStatus);
        Assert.Equal(CoordinateMode.Mm, saved.CoordinateMode);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Point POST/PUT — full-spec point, create then update
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Full_spec_point_survives_create_then_update_via_the_point_endpoint()
    {
        var store = NewStore();

        const string createJson = """
        {
          "code": "PFULL",
          "name": "Full Spec Point",
          "description": "Toàn bộ trường của một điểm đo",
          "measurementType": "DIMENSION",
          "measurementTypeCode": "HEIGHT_2D",
          "unit": "mm",
          "lowerLimit": 0.10,
          "upperLimit": 0.50,
          "nominalValue": 0.30,
          "toleranceMode": "range",
          "positionX": 100,
          "positionY": 200,
          "radius": 12,
          "cropWidth": 48,
          "cropHeight": 48,
          "orderIndex": 10,
          "isActive": true,
          "shape": "circle",
          "positionZ": 0.5,
          "heightMin": 0.05,
          "heightMax": 0.60,
          "heightNominal": 0.30,
          "coplanarityMax": 0.10,
          "criteria": {"note": "full spec create"},
          "lighting": []
        }
        """;

        var createResult = await ConfigEndpoints.UpsertPointAsync(JsonRequest(createJson), "MODEL-A", "PFULL", store, CancellationToken.None);
        var created = ExpectOk<MeasurementPoint>(createResult);
        Assert.Equal(MeasurementType.Dimension, created.MeasurementType);
        Assert.Equal(ToleranceMode.Range, created.ToleranceMode);
        Assert.Equal(PointShape.Circle, created.Shape);

        const string updateJson = """
        {
          "code": "PFULL",
          "name": "Full Spec Point (revised)",
          "measurementType": "DIMENSION",
          "unit": "mm",
          "nominalValue": 0.30,
          "tolPlus": 0.05,
          "tolMinus": 0.05,
          "toleranceMode": "bilateral",
          "positionX": 105,
          "positionY": 205,
          "orderIndex": 10,
          "isActive": true,
          "shape": "polygon",
          "geometry": {"points": [[0,0],[10,0],[10,10],[0,10]]}
        }
        """;

        var updateResult = await ConfigEndpoints.UpsertPointAsync(JsonRequest(updateJson), "MODEL-A", "PFULL", store, CancellationToken.None);
        var updated = ExpectOk<MeasurementPoint>(updateResult);
        Assert.Equal(ToleranceMode.Bilateral, updated.ToleranceMode);
        Assert.Equal(PointShape.Polygon, updated.Shape);

        // Persisted, not just echoed.
        var persisted = store.GetAllPoints("MODEL-A").Single(p => p.Code == "PFULL");
        Assert.Equal(ToleranceMode.Bilateral, persisted.ToleranceMode);
        Assert.Equal(PointShape.Polygon, persisted.Shape);
        Assert.Equal(MeasurementType.Dimension, persisted.MeasurementType);
    }

    [Theory]
    [InlineData("min_only", ToleranceMode.MinOnly)]
    [InlineData("max_only", ToleranceMode.MaxOnly)]
    [InlineData("range", ToleranceMode.Range)]
    [InlineData("bilateral", ToleranceMode.Bilateral)]
    public async Task Point_endpoint_persists_every_tolerance_mode_wire_value(string wireValue, ToleranceMode expected)
    {
        var store = NewStore();
        var json = $$"""
        {
          "code": "PTOL",
          "name": "Tolerance mode sweep",
          "measurementType": "DIMENSION",
          "toleranceMode": "{{wireValue}}",
          "positionX": 1,
          "positionY": 1,
          "orderIndex": 0,
          "isActive": true,
          "shape": "circle"
        }
        """;

        var result = await ConfigEndpoints.UpsertPointAsync(JsonRequest(json), "MODEL-A", "PTOL", store, CancellationToken.None);

        var saved = ExpectOk<MeasurementPoint>(result);
        Assert.Equal(expected, saved.ToleranceMode);
        Assert.Equal(expected, store.GetAllPoints("MODEL-A").Single(p => p.Code == "PTOL").ToleranceMode);
    }

    [Theory]
    [InlineData("circle", PointShape.Circle)]
    [InlineData("rect", PointShape.Rect)]
    [InlineData("polygon", PointShape.Polygon)]
    [InlineData("line", PointShape.Line)]
    [InlineData("ring", PointShape.Ring)]
    [InlineData("mask", PointShape.Mask)]
    [InlineData("array", PointShape.Array)]
    public async Task Point_endpoint_persists_every_shape_wire_value(string wireValue, PointShape expected)
    {
        var store = NewStore();
        var json = $$"""
        {
          "code": "PSHAPE",
          "name": "Shape sweep",
          "measurementType": "VISUAL",
          "positionX": 1,
          "positionY": 1,
          "orderIndex": 0,
          "isActive": true,
          "shape": "{{wireValue}}"
        }
        """;

        var result = await ConfigEndpoints.UpsertPointAsync(JsonRequest(json), "MODEL-A", "PSHAPE", store, CancellationToken.None);

        var saved = ExpectOk<MeasurementPoint>(result);
        Assert.Equal(expected, saved.Shape);
    }

    [Theory]
    [InlineData("DIMENSION", MeasurementType.Dimension)]
    [InlineData("VISUAL", MeasurementType.Visual)]
    [InlineData("ELECTRICAL", MeasurementType.Electrical)]
    [InlineData("POSITION", MeasurementType.Position)]
    [InlineData("COLOR", MeasurementType.Color)]
    [InlineData("SURFACE", MeasurementType.Surface)]
    [InlineData("OTHER", MeasurementType.Other)]
    public async Task Point_endpoint_persists_every_measurement_type_wire_value(string wireValue, MeasurementType expected)
    {
        var store = NewStore();
        var json = $$"""
        {
          "code": "PMEAS",
          "name": "Measurement type sweep",
          "measurementType": "{{wireValue}}",
          "positionX": 1,
          "positionY": 1,
          "orderIndex": 0,
          "isActive": true,
          "shape": "circle"
        }
        """;

        var result = await ConfigEndpoints.UpsertPointAsync(JsonRequest(json), "MODEL-A", "PMEAS", store, CancellationToken.None);

        var saved = ExpectOk<MeasurementPoint>(result);
        Assert.Equal(expected, saved.MeasurementType);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Recipe PUT — status round trip
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Put_recipe_with_active_status_round_trips()
    {
        var store = NewStore(); // auto-seeds SCREWDRIVE-M4 (status "active")

        const string json = """
        {
          "code": "TEST-RECIPE",
          "name": "Test recipe (request-body fix)",
          "machineType": "SCREWDRIVE",
          "version": 1,
          "status": "active",
          "payload": { "speedRpm": 500, "torqueTarget": 1.2 }
        }
        """;

        var result = await ConfigEndpoints.UpsertRecipeAsync(JsonRequest(json), "TEST-RECIPE", store, CancellationToken.None);

        var saved = ExpectOk<Recipe>(result);
        Assert.Equal(RecipeStatus.Active, saved.Status);

        var reloaded = store.GetRecipe("TEST-RECIPE");
        Assert.NotNull(reloaded);
        Assert.Equal(RecipeStatus.Active, reloaded!.Status);
    }

    [Theory]
    [InlineData("draft", RecipeStatus.Draft)]
    [InlineData("active", RecipeStatus.Active)]
    [InlineData("archived", RecipeStatus.Archived)]
    public async Task Put_recipe_round_trips_every_status_wire_value(string wireValue, RecipeStatus expected)
    {
        var store = NewStore();
        var json = $$"""
        {
          "code": "TEST-RECIPE-2",
          "name": "Status sweep",
          "machineType": "SCREWDRIVE",
          "version": 1,
          "status": "{{wireValue}}",
          "payload": {}
        }
        """;

        var result = await ConfigEndpoints.UpsertRecipeAsync(JsonRequest(json), "TEST-RECIPE-2", store, CancellationToken.None);

        var saved = ExpectOk<Recipe>(result);
        Assert.Equal(expected, saved.Status);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Malformed / missing bodies → friendly 400, never an unhandled 500
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Malformed_json_body_on_product_upsert_returns_400_not_500()
    {
        var store = NewStore();

        var result = await ConfigEndpoints.UpsertProductAsync(
            JsonRequest("{ this is not valid json"), "MODEL-A", store, CancellationToken.None);

        ExpectBadRequest(result);
    }

    [Fact]
    public async Task Malformed_json_body_on_point_upsert_returns_400_not_500()
    {
        var store = NewStore();

        var result = await ConfigEndpoints.UpsertPointAsync(
            JsonRequest("not json at all"), "MODEL-A", "P01", store, CancellationToken.None);

        ExpectBadRequest(result);
    }

    [Fact]
    public async Task Malformed_json_body_on_recipe_upsert_returns_400_not_500()
    {
        var store = NewStore();

        var result = await ConfigEndpoints.UpsertRecipeAsync(
            JsonRequest("{\"code\": \"X\", \"status\": "), "SCREWDRIVE-M4", store, CancellationToken.None);

        ExpectBadRequest(result);
    }

    [Fact]
    public async Task Empty_body_on_required_product_endpoint_returns_friendly_400()
    {
        var store = NewStore();

        var result = await ConfigEndpoints.UpsertProductAsync(EmptyBodyRequest(), "MODEL-A", store, CancellationToken.None);

        var error = ExpectBadRequest(result);
        Assert.Contains("body", error.Error, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Regression for a real, non-hypothetical second failure mode this task's own fix had to
    /// guard against: <c>HttpRequest.ReadFromJsonAsync</c> throws <see cref="InvalidOperationException"/>
    /// — NOT a <see cref="System.Text.Json.JsonException"/> — when the request has a non-empty body but
    /// no recognized JSON <c>Content-Type</c> (e.g. a client that sent the right bytes with the wrong/
    /// missing header, or curl's default <c>application/x-www-form-urlencoded</c> for a plain
    /// <c>-d</c>). A catch that only handled <see cref="System.Text.Json.JsonException"/> would let this
    /// exception escape unhandled — exactly the 500 this whole fix is required not to produce.</summary>
    [Fact]
    public async Task Valid_json_bytes_with_missing_content_type_returns_400_not_an_unhandled_exception()
    {
        var store = NewStore();

        var result = await ConfigEndpoints.UpsertProductAsync(
            JsonRequest("""{"code":"MODEL-A","name":"x","points":[]}""", contentType: null),
            "MODEL-A", store, CancellationToken.None);

        ExpectBadRequest(result);
    }

    [Fact]
    public async Task Body_code_mismatch_still_returns_400_after_switching_to_explicit_body_read()
    {
        var store = NewStore();

        var result = await ConfigEndpoints.UpsertProductAsync(
            JsonRequest("""{"code":"SOME-OTHER-CODE","name":"x","points":[]}"""),
            "MODEL-A", store, CancellationToken.None);

        var error = ExpectBadRequest(result);
        Assert.Contains("body.code", error.Error);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Machine sync pull/push bodies — no enums of their own, but exercised for consistency (the fix
    // applies uniformly to every body-bound ConfigEndpoints handler, not just the enum-carrying ones).
    // ─────────────────────────────────────────────────────────────────────

    private static FleetHost NewFleetHostWithRegisteredMachine(MachineDescriptor descriptor)
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        var host = new FleetHost(switchable, coordinator, new EventBus());
        Assert.True(host.RegisterMachine(descriptor));
        return host;
    }

    // A code deliberately NOT in fleet.json's default roster (which already ships its own "SCRW-01",
    // "AOI-01", etc.) — RegisterMachine below would silently return false (no-op) on a duplicate code,
    // so these tests bring their own uniquely-named machine instead of colliding with it.
    private static readonly MachineDescriptor ScrewMachine = new(
        "TEST-SCRW-XYZ", "SN-TEST-SCRW-XYZ", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening", DriverKind.Simulated, "RC-SCRW-A", null, 0.8);

    [Fact]
    public async Task Pull_with_no_body_at_all_is_a_valid_optional_omission_not_an_error()
    {
        var fleetHost = NewFleetHostWithRegisteredMachine(ScrewMachine);
        var local = new ProductConfigStore(TempDir());
        var ecosystem = new SimulatedEcosystem(TempDir());
        var engine = new ConfigSyncEngine(local, ecosystem);

        var result = await ConfigEndpoints.PullConfigAsync(EmptyBodyRequest(), ScrewMachine.Code, fleetHost, engine, CancellationToken.None);

        // Automation machine + no productCode in the body -> recipe pull path, not the "productCode
        // required" ArgumentException an AOI/AVI machine would hit. Just confirms ReadBodyAsync's
        // required:false branch does NOT turn "no body" into a 400.
        var pulled = ExpectOk<MachineConfigPullResultDto>(result);
        Assert.True(pulled.Applied);
        Assert.Equal("recipe", pulled.ConfigKind);
    }

    [Fact]
    public async Task Malformed_json_body_on_config_push_returns_400_not_500()
    {
        var fleetHost = NewFleetHostWithRegisteredMachine(ScrewMachine);
        var local = new ProductConfigStore(TempDir());
        var ecosystem = new SimulatedEcosystem(TempDir());
        var engine = new ConfigSyncEngine(local, ecosystem);

        var result = await ConfigEndpoints.PushConfigAsync(
            JsonRequest("{ not valid"), ScrewMachine.Code, fleetHost, engine, CancellationToken.None);

        ExpectBadRequest(result);
    }
}
