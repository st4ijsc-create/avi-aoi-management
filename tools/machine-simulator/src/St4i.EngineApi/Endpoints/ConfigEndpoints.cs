using St4i.EdgeCore.Config;
using St4i.EdgeCore.Models;
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
            Json(store.ListProducts().Select(ProductSummaryDto.From).ToList()));

        app.MapGet("/v1/products/{code}", (string code, ProductConfigStore store) =>
        {
            var product = store.GetProduct(code);
            return product is null ? ApiNotFound($"product \"{code}\" not found") : Json(product);
        });

        app.MapMethods("/v1/products/{code}", new[] { "POST", "PUT" }, (string code, ProductModel body, ProductConfigStore store) =>
        {
            if (string.IsNullOrWhiteSpace(body.Code)) body.Code = code;
            if (!string.Equals(body.Code, code, StringComparison.OrdinalIgnoreCase))
            {
                return Results.BadRequest(new ApiErrorDto("body.code must match the route {code} (or be omitted)."));
            }

            return Json(store.UpsertProduct(body));
        });

        app.MapDelete("/v1/products/{code}", (string code, ProductConfigStore store) =>
            store.DeleteProduct(code) ? Json(new { deleted = true }) : ApiNotFound($"product \"{code}\" not found"));

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
        });

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
        });

        app.MapMethods("/v1/products/{code}/points/{pointCode}", new[] { "POST", "PUT" },
            (string code, string pointCode, MeasurementPoint body, ProductConfigStore store) =>
        {
            if (string.IsNullOrWhiteSpace(body.Code)) body.Code = pointCode;
            if (!string.Equals(body.Code, pointCode, StringComparison.OrdinalIgnoreCase))
            {
                return Results.BadRequest(new ApiErrorDto("body.code must match the route {pointCode} (or be omitted)."));
            }

            try
            {
                return Json(store.UpsertPoint(code, body));
            }
            catch (KeyNotFoundException ex)
            {
                return ApiNotFound(ex.Message);
            }
        });

        app.MapDelete("/v1/products/{code}/points/{pointCode}", (string code, string pointCode, ProductConfigStore store) =>
        {
            try
            {
                return store.SoftDeletePoint(code, pointCode)
                    ? Json(new { deleted = true })
                    : ApiNotFound($"point \"{pointCode}\" not found (or already deleted) on product \"{code}\"");
            }
            catch (KeyNotFoundException ex)
            {
                return ApiNotFound(ex.Message);
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // Recipes (author locally)
    // ─────────────────────────────────────────────────────────────────────
    private static void MapRecipeEndpoints(IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/recipes", (ProductConfigStore store) =>
            Json(store.ListRecipes().Select(RecipeSummaryDto.From).ToList()));

        app.MapGet("/v1/recipes/{code}", (string code, ProductConfigStore store) =>
        {
            var recipe = store.GetRecipe(code);
            return recipe is null ? ApiNotFound($"recipe \"{code}\" not found") : Json(recipe);
        });

        app.MapPut("/v1/recipes/{code}", (string code, Recipe body, ProductConfigStore store) =>
        {
            if (string.IsNullOrWhiteSpace(body.Code)) body.Code = code;
            if (!string.Equals(body.Code, code, StringComparison.OrdinalIgnoreCase))
            {
                return Results.BadRequest(new ApiErrorDto("body.code must match the route {code} (or be omitted)."));
            }

            return Json(store.UpsertRecipe(body));
        });

        app.MapDelete("/v1/recipes/{code}", (string code, ProductConfigStore store) =>
            store.DeleteRecipe(code) ? Json(new { deleted = true }) : ApiNotFound($"recipe \"{code}\" not found"));
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
        });

        app.MapPost("/v1/machines/{code}/config/pull",
            async (string code, ConfigPullRequest? body, FleetHost fleetHost, ConfigSyncEngine engine, CancellationToken ct) =>
        {
            var machine = FindMachine(fleetHost, code);
            if (machine is null) return ApiNotFound($"machine \"{code}\" not found");

            try
            {
                return Json(await engine.PullAsync(machine, body?.ProductCode, ct).ConfigureAwait(false));
            }
            catch (KeyNotFoundException ex)
            {
                return ApiNotFound(ex.Message);
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new ApiErrorDto(ex.Message));
            }
        });

        app.MapPost("/v1/machines/{code}/config/push",
            async (string code, ConfigPushRequest body, FleetHost fleetHost, ConfigSyncEngine engine, CancellationToken ct) =>
        {
            var machine = FindMachine(fleetHost, code);
            if (machine is null) return ApiNotFound($"machine \"{code}\" not found");
            if (string.IsNullOrWhiteSpace(body.ProductCode)) return Results.BadRequest(new ApiErrorDto("productCode is required."));

            try
            {
                return Json(await engine.PushAsync(machine, body.ProductCode, body.Confirm, ct).ConfigureAwait(false));
            }
            catch (KeyNotFoundException ex)
            {
                return ApiNotFound(ex.Message);
            }
        });

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
        });

        app.MapGet("/v1/machines/{code}/config/history", (string code, FleetHost fleetHost, ConfigSyncEngine engine) =>
        {
            var machine = FindMachine(fleetHost, code);
            return machine is null ? ApiNotFound($"machine \"{code}\" not found") : Json(engine.History(machine.Code));
        });
    }

    private static MachineDescriptor? FindMachine(FleetHost fleetHost, string code) =>
        fleetHost.Fleet.FirstOrDefault(d => string.Equals(d.Code, code, StringComparison.OrdinalIgnoreCase));

    private static IResult ApiNotFound(string message) => Results.NotFound(new ApiErrorDto(message));

    /// <summary>200 OK using <see cref="ConfigJson.Options"/> instead of the DI-configured global JSON
    /// options — see that type's doc comment for why every response here (anything that can carry an
    /// EdgeCore.Config enum) needs this instead of a plain <c>Results.Ok(value)</c>.</summary>
    private static IResult Json<T>(T value) => Results.Json(value, ConfigJson.Options);
}
