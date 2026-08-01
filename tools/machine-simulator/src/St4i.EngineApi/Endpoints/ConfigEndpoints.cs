using System.Text.Json;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Models;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Config;
using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Endpoints;

/// <summary>
/// Task C2 — config-sync REST surface, all under <c>/v1</c>. Two families:
///
///  1. Authoring (products/points/recipes CRUD) — thin wrappers over <see cref="ProductConfigStore"/>,
///     letting the web UI (Tasks C4-C6) author what "the machine locally knows" directly.
///  2. Per-machine sync (<c>/v1/machines/{code}/config/*</c>) — thin wrappers over
///     <see cref="ConfigSyncEngine"/>, resolving <c>{code}</c> to a <see cref="MachineDescriptor"/> via
///     <see cref="FleetHost.Fleet"/> first (same lookup pattern as <see cref="FleetEndpoints"/>'s
///     <c>/v1/machines/{code}</c>).
///
/// Friendly errors throughout — <see cref="KeyNotFoundException"/> (unknown product/recipe/machine) maps
/// to 404, <see cref="ArgumentException"/>/<see cref="InvalidOperationException"/> (a request that's
/// well-formed but doesn't apply, e.g. diff on a recipe machine) maps to 400. Nothing here should ever
/// 500 on an expected state.
///
/// JSON casing is symmetric end to end: every RESPONSE that can carry an <c>St4i.EdgeCore.Config</c>
/// enum goes through <see cref="Json{T}"/> (<see cref="ConfigJson.Options"/>), and — the request-side
/// fix this comment was added for — every body-bound endpoint (product/point upsert, recipe upsert,
/// config push, config pull) reads its DTO explicitly via <see cref="ReadBodyAsync{T}"/> on that SAME
/// <see cref="ConfigJson.Options"/> instead of taking the DTO as a direct minimal-API parameter (which
/// would silently fall back to <c>Program.cs</c>'s global JSON options and reject the server's own
/// snake_case/UPPER_SNAKE_CASE enum wire values). See <see cref="ReadBodyAsync{T}"/>'s doc comment for
/// the full converter-precedence explanation.
/// </summary>
public static class ConfigEndpoints
{
    public static void MapConfigEndpoints(this IEndpointRouteBuilder app)
    {
        MapProductEndpoints(app);
        MapRecipeEndpoints(app);
        MapMachineSyncEndpoints(app);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Products (author locally) + points CRUD
    // ─────────────────────────────────────────────────────────────────────
    private static void MapProductEndpoints(IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/products", (ProductConfigStore store) =>
            Json(store.ListProducts().Select(ProductSummaryDto.From).ToList()))
            .RequireAuthorization(Policies.Operator);

        app.MapGet("/v1/products/{code}", (string code, ProductConfigStore store) =>
        {
            var product = store.GetProduct(code);
            return product is null ? ApiNotFound($"product \"{code}\" not found") : Json(product);
        }).RequireAuthorization(Policies.Operator);

        app.MapMethods("/v1/products/{code}", new[] { "POST", "PUT" }, UpsertProductAsync)
            .RequireAuthorization(Policies.Engineer);

        app.MapDelete("/v1/products/{code}", async (string code, ProductConfigStore store, HttpContext context, AuditRecorder recorder, CancellationToken ct) =>
        {
            var before = store.GetProduct(code);
            if (!store.DeleteProduct(code)) return ApiNotFound($"product \"{code}\" not found");
            await recorder.RecordAsync(context, "product.delete", "product", code, before, null, ct).ConfigureAwait(false);
            return Json(new { deleted = true });
        }).RequireAuthorization(Policies.Engineer);

        app.MapGet("/v1/products/{code}/points", (string code, bool? includeDeleted, ProductConfigStore store) =>
        {
            try
            {
                var points = includeDeleted == true ? store.GetAllPoints(code) : store.GetActivePoints(code);
                return Json(points);
            }
            catch (KeyNotFoundException ex)
            {
                return ApiNotFound(ex.Message);
            }
        }).RequireAuthorization(Policies.Operator);

        app.MapGet("/v1/products/{code}/points/{pointCode}", (string code, string pointCode, ProductConfigStore store) =>
        {
            try
            {
                var point = store.GetAllPoints(code).FirstOrDefault(p => string.Equals(p.Code, pointCode, StringComparison.OrdinalIgnoreCase));
                return point is null ? ApiNotFound($"point \"{pointCode}\" not found on product \"{code}\"") : Json(point);
            }
            catch (KeyNotFoundException ex)
            {
                return ApiNotFound(ex.Message);
            }
        }).RequireAuthorization(Policies.Operator);

        app.MapMethods("/v1/products/{code}/points/{pointCode}", new[] { "POST", "PUT" }, UpsertPointAsync)
            .RequireAuthorization(Policies.Engineer);

        app.MapDelete("/v1/products/{code}/points/{pointCode}", async (
            string code, string pointCode, ProductConfigStore store, HttpContext context, AuditRecorder recorder, CancellationToken ct) =>
        {
            try
            {
                var before = store.GetAllPoints(code).FirstOrDefault(p => string.Equals(p.Code, pointCode, StringComparison.OrdinalIgnoreCase));
                if (!store.SoftDeletePoint(code, pointCode))
                {
                    return ApiNotFound($"point \"{pointCode}\" not found (or already deleted) on product \"{code}\"");
                }

                await recorder.RecordAsync(context, "product.point.delete", "point", $"{code}/{pointCode}", before, null, ct).ConfigureAwait(false);
                return Json(new { deleted = true });
            }
            catch (KeyNotFoundException ex)
            {
                return ApiNotFound(ex.Message);
            }
        }).RequireAuthorization(Policies.Engineer);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Recipes (author locally)
    // ─────────────────────────────────────────────────────────────────────
    private static void MapRecipeEndpoints(IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/recipes", (ProductConfigStore store) =>
            Json(store.ListRecipes().Select(RecipeSummaryDto.From).ToList()))
            .RequireAuthorization(Policies.Operator);

        app.MapGet("/v1/recipes/{code}", (string code, ProductConfigStore store) =>
        {
            var recipe = store.GetRecipe(code);
            return recipe is null ? ApiNotFound($"recipe \"{code}\" not found") : Json(recipe);
        }).RequireAuthorization(Policies.Operator);

        app.MapPut("/v1/recipes/{code}", UpsertRecipeAsync)
            .RequireAuthorization(Policies.Engineer);

        app.MapDelete("/v1/recipes/{code}", async (string code, ProductConfigStore store, HttpContext context, AuditRecorder recorder, CancellationToken ct) =>
        {
            var before = store.GetRecipe(code);
            if (!store.DeleteRecipe(code)) return ApiNotFound($"recipe \"{code}\" not found");
            await recorder.RecordAsync(context, "recipe.delete", "recipe", code, before, null, ct).ConfigureAwait(false);
            return Json(new { deleted = true });
        }).RequireAuthorization(Policies.Engineer);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Per-machine sync
    // ─────────────────────────────────────────────────────────────────────
    private static void MapMachineSyncEndpoints(IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/machines/{code}/config/check",
            async (string code, string? productCode, FleetHost fleetHost, ConfigSyncEngine engine, CancellationToken ct) =>
        {
            var machine = FindMachine(fleetHost, code);
            if (machine is null) return ApiNotFound($"machine \"{code}\" not found");

            try
            {
                return Json(await engine.CheckAsync(machine, productCode, ct).ConfigureAwait(false));
            }
            catch (KeyNotFoundException ex)
            {
                return ApiNotFound(ex.Message);
            }
        }).RequireAuthorization(Policies.Operator);

        app.MapPost("/v1/machines/{code}/config/pull", PullConfigAsync)
            .RequireAuthorization(Policies.Engineer);

        app.MapPost("/v1/machines/{code}/config/push", PushConfigAsync)
            .RequireAuthorization(Policies.Engineer);

        app.MapGet("/v1/machines/{code}/config/diff",
            async (string code, string? productCode, FleetHost fleetHost, ConfigSyncEngine engine, CancellationToken ct) =>
        {
            var machine = FindMachine(fleetHost, code);
            if (machine is null) return ApiNotFound($"machine \"{code}\" not found");
            if (string.IsNullOrWhiteSpace(productCode)) return Results.BadRequest(new ApiErrorDto("productCode query parameter is required."));

            try
            {
                return Json(await engine.DiffAsync(machine, productCode, ct).ConfigureAwait(false));
            }
            catch (KeyNotFoundException ex)
            {
                return ApiNotFound(ex.Message);
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new ApiErrorDto(ex.Message));
            }
        }).RequireAuthorization(Policies.Operator);

        app.MapGet("/v1/machines/{code}/config/history", (string code, FleetHost fleetHost, ConfigSyncEngine engine) =>
        {
            var machine = FindMachine(fleetHost, code);
            return machine is null ? ApiNotFound($"machine \"{code}\" not found") : Json(engine.History(machine.Code));
        }).RequireAuthorization(Policies.Operator);
    }

    private static MachineDescriptor? FindMachine(FleetHost fleetHost, string code) =>
        fleetHost.Fleet.FirstOrDefault(d => string.Equals(d.Code, code, StringComparison.OrdinalIgnoreCase));

    private static IResult ApiNotFound(string message) => Results.NotFound(new ApiErrorDto(message));

    // ─────────────────────────────────────────────────────────────────────
    // Body-bound handlers — named (not inline lambdas) so St4i.EngineApi.Tests can invoke them directly
    // against a hand-built HttpContext (no WebApplicationFactory/TestServer needed) and exercise the
    // EXACT same ReadBodyAsync&lt;T&gt;/ConfigJson.Options code path the real routes above register.
    // `internal` + this assembly's existing AssemblyInfo.cs InternalsVisibleTo("St4i.EngineApi.Tests")
    // is what makes that possible without widening the public API surface.
    // ─────────────────────────────────────────────────────────────────────

    internal static async Task<IResult> UpsertProductAsync(
        HttpContext context, string code, ProductConfigStore store, CancellationToken ct, AuditRecorder? recorder = null)
    {
        var (body, error) = await ReadBodyAsync<ProductModel>(context, required: true, ct).ConfigureAwait(false);
        if (error is not null) return error;

        if (string.IsNullOrWhiteSpace(body!.Code)) body.Code = code;
        if (!string.Equals(body.Code, code, StringComparison.OrdinalIgnoreCase))
        {
            return Results.BadRequest(new ApiErrorDto("body.code must match the route {code} (or be omitted)."));
        }

        // WS-D-D4 — "old" read BEFORE the mutation (null for a brand-new product — an upsert's create
        // path has no "before" state, which is itself meaningful audit content, not an error).
        var before = store.GetProduct(code);
        var updated = store.UpsertProduct(body);
        if (recorder is not null)
        {
            await recorder.RecordAsync(context, "product.upsert", "product", code, before, updated, ct).ConfigureAwait(false);
        }

        return Json(updated);
    }

    internal static async Task<IResult> UpsertPointAsync(
        HttpContext context, string code, string pointCode, ProductConfigStore store, CancellationToken ct, AuditRecorder? recorder = null)
    {
        var (body, error) = await ReadBodyAsync<MeasurementPoint>(context, required: true, ct).ConfigureAwait(false);
        if (error is not null) return error;

        if (string.IsNullOrWhiteSpace(body!.Code)) body.Code = pointCode;
        if (!string.Equals(body.Code, pointCode, StringComparison.OrdinalIgnoreCase))
        {
            return Results.BadRequest(new ApiErrorDto("body.code must match the route {pointCode} (or be omitted)."));
        }

        try
        {
            var before = store.GetAllPoints(code).FirstOrDefault(p => string.Equals(p.Code, pointCode, StringComparison.OrdinalIgnoreCase));
            var updated = store.UpsertPoint(code, body);
            if (recorder is not null)
            {
                await recorder.RecordAsync(context, "product.point.upsert", "point", $"{code}/{pointCode}", before, updated, ct).ConfigureAwait(false);
            }

            return Json(updated);
        }
        catch (KeyNotFoundException ex)
        {
            return ApiNotFound(ex.Message);
        }
    }

    internal static async Task<IResult> UpsertRecipeAsync(
        HttpContext context, string code, ProductConfigStore store, CancellationToken ct, AuditRecorder? recorder = null)
    {
        var (body, error) = await ReadBodyAsync<Recipe>(context, required: true, ct).ConfigureAwait(false);
        if (error is not null) return error;

        if (string.IsNullOrWhiteSpace(body!.Code)) body.Code = code;
        if (!string.Equals(body.Code, code, StringComparison.OrdinalIgnoreCase))
        {
            return Results.BadRequest(new ApiErrorDto("body.code must match the route {code} (or be omitted)."));
        }

        var before = store.GetRecipe(code);
        var updated = store.UpsertRecipe(body);
        if (recorder is not null)
        {
            await recorder.RecordAsync(context, "recipe.upsert", "recipe", code, before, updated, ct).ConfigureAwait(false);
        }

        return Json(updated);
    }

    internal static async Task<IResult> PullConfigAsync(
        HttpContext context, string code, FleetHost fleetHost, ConfigSyncEngine engine, CancellationToken ct, AuditRecorder? recorder = null)
    {
        var machine = FindMachine(fleetHost, code);
        if (machine is null) return ApiNotFound($"machine \"{code}\" not found");

        var (body, error) = await ReadBodyAsync<ConfigPullRequest>(context, required: false, ct).ConfigureAwait(false);
        if (error is not null) return error;

        try
        {
            var result = await engine.PullAsync(machine, body?.ProductCode, ct).ConfigureAwait(false);
            if (recorder is not null)
            {
                // WS-D-D4 — "summary" per the brief: the pull RESULT itself (drift/version/applied info),
                // not the machine's full config — old is null (a pull's own "before" isn't a single value).
                await recorder.RecordAsync(context, "machine.config.pull", "machineCode", machine.Code, null, result, ct).ConfigureAwait(false);
            }

            return Json(result);
        }
        catch (KeyNotFoundException ex)
        {
            return ApiNotFound(ex.Message);
        }
        catch (ArgumentException ex)
        {
            return Results.BadRequest(new ApiErrorDto(ex.Message));
        }
    }

    internal static async Task<IResult> PushConfigAsync(
        HttpContext context, string code, FleetHost fleetHost, ConfigSyncEngine engine, CancellationToken ct, AuditRecorder? recorder = null)
    {
        var machine = FindMachine(fleetHost, code);
        if (machine is null) return ApiNotFound($"machine \"{code}\" not found");

        var (body, error) = await ReadBodyAsync<ConfigPushRequest>(context, required: true, ct).ConfigureAwait(false);
        if (error is not null) return error;
        if (string.IsNullOrWhiteSpace(body!.ProductCode)) return Results.BadRequest(new ApiErrorDto("productCode is required."));

        try
        {
            var result = await engine.PushAsync(machine, body.ProductCode, body.Confirm, ct).ConfigureAwait(false);
            if (recorder is not null)
            {
                await recorder.RecordAsync(context, "machine.config.push", "machineCode", machine.Code, null, result, ct).ConfigureAwait(false);
            }

            return Json(result);
        }
        catch (KeyNotFoundException ex)
        {
            return ApiNotFound(ex.Message);
        }
    }

    /// <summary>200 OK using <see cref="ConfigJson.Options"/> instead of the DI-configured global JSON
    /// options — see that type's doc comment for why every response here (anything that can carry an
    /// EdgeCore.Config enum) needs this instead of a plain <c>Results.Ok(value)</c>.</summary>
    private static IResult Json<T>(T value) => Results.Json(value, ConfigJson.Options);

    /// <summary>
    /// Reads and deserializes a config-endpoint REQUEST body using <see cref="ConfigJson.Options"/> —
    /// the request-side twin of <see cref="Json{T}"/>. Every endpoint above that used to bind its DTO as
    /// a direct minimal-API parameter (e.g. <c>(string code, ProductModel body, ...)</c>) went through
    /// ASP.NET's implicit <c>[FromBody]</c> binding, which uses <c>Program.cs</c>'s DI-configured GLOBAL
    /// <see cref="System.Text.Json.JsonSerializerOptions"/> (plain <c>JsonStringEnumConverter()</c>, no
    /// naming policy) — NOT <see cref="ConfigJson.Options"/>. That meant a request body written in the
    /// server's actual wire casing (<c>toleranceMode:"min_only"</c>, <c>measurementType:"DIMENSION"</c>,
    /// ...) failed to deserialize (global options expect the bare enum member name, e.g. <c>"MinOnly"</c>),
    /// while <c>ConfigEndpoints</c>' own RESPONSES were already correct via <see cref="Json{T}"/> — the
    /// PUT/POST side was the untreated twin of that same converter-precedence footgun (see
    /// <see cref="ConfigJson"/>'s doc comment). Reading the body explicitly here — instead of letting
    /// minimal API bind it — puts <see cref="ConfigJson.Options"/> in control of deserialization too, so
    /// every config enum round-trips in exactly the casing it came back out in.
    ///
    /// <paramref name="required"/> mirrors what a nullable-vs-non-nullable direct-binding parameter used
    /// to mean: when true, a missing body is a 400 ("Request body is required."), matching what a
    /// non-nullable <c>TDto body</c> parameter would have produced; when false (only
    /// <c>ConfigPullRequest?</c> today), a missing body is a legitimate no-op (returns a null value, no
    /// error) — the pull endpoint's "just pull whatever product the machine already has" shorthand.
    /// "Missing" is checked via <see cref="HttpRequest.ContentLength"/> BEFORE calling
    /// <see cref="HttpRequestJsonExtensions.ReadFromJsonAsync{TValue}(HttpRequest, JsonSerializerOptions, CancellationToken)"/>
    /// at all — deliberately, so a zero-length body never has to round-trip through that call just to
    /// get an ambiguous empty-stream <see cref="JsonException"/> back.
    ///
    /// A body that WAS sent but is malformed is always a friendly 400, never an unhandled exception
    /// bubbling into a 500 — <c>ReadFromJsonAsync</c> bypasses minimal API's own automatic
    /// malformed-body-to-400 handling once the DTO is no longer a direct parameter, so this is now this
    /// method's job instead. Two distinct exception types both mean "malformed" here:
    /// <see cref="JsonException"/> (invalid JSON syntax) AND <see cref="InvalidOperationException"/>
    /// (the real, non-hypothetical other one — <c>ReadFromJsonAsync</c> throws this, NOT a
    /// <see cref="JsonException"/>, when the request's <c>Content-Type</c> isn't a recognized JSON media
    /// type, e.g. a client that sent the right bytes but forgot the header, or curl's default
    /// <c>application/x-www-form-urlencoded</c> for a plain <c>-d</c>) — both are caught alike below.
    /// </summary>
    private static async Task<(T? Value, IResult? Error)> ReadBodyAsync<T>(HttpContext context, bool required, CancellationToken ct)
        where T : class
    {
        if (context.Request.ContentLength is null or 0)
        {
            return required
                ? (null, Results.BadRequest(new ApiErrorDto("Request body is required.")))
                : (null, null);
        }

        try
        {
            var value = await context.Request.ReadFromJsonAsync<T>(ConfigJson.Options, ct).ConfigureAwait(false);
            if (value is null && required)
            {
                return (null, Results.BadRequest(new ApiErrorDto("Request body is required.")));
            }

            return (value, null);
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or NotSupportedException)
        {
            return (null, Results.BadRequest(new ApiErrorDto("Malformed JSON request body.")));
        }
    }
}
