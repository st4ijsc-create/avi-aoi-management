using St4i.EngineApi.Auth;
using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Endpoints;

/// <summary><c>POST /v1/scenario {cycleRate,defectRate,faultRate,networkOutage}</c> ·
/// <c>POST /v1/scenario/preset {name}</c> · <c>POST /v1/scenario/burst</c>. Also exposes a <c>GET
/// /v1/scenario</c> (not required by the Task 3 brief, but a natural low-cost addition — lets a client
/// read the currently-active scenario/preset without guessing).</summary>
public static class ScenarioEndpoints
{
    public static void MapScenarioEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/scenario", (FleetHost host) => Results.Ok(new
        {
            current = host.CurrentScenarioDto(),
            presets = host.ListPresets(),
        })).RequireAuthorization(Policies.Operator);

        app.MapPost("/v1/scenario", (ScenarioRequest request, FleetHost host) =>
            Results.Ok(host.ApplyScenario(request.ToScenarioConfig())))
            .RequireAuthorization(Policies.Engineer);

        app.MapPost("/v1/scenario/preset", async (ScenarioPresetRequest request, FleetHost host, CancellationToken ct) =>
        {
            var (preset, applied, hotFolderStatus) = await host.ApplyPresetAsync(request.Name, ct).ConfigureAwait(false);
            if (preset is null)
            {
                var known = string.Join(", ", host.ListPresets().Select(p => p.Name));
                return Results.NotFound(new ApiErrorDto($"unknown preset \"{request.Name}\" — known: {known}"));
            }

            return Results.Ok(new { scenario = applied, hotFolderStatus });
        }).RequireAuthorization(Policies.Engineer);

        app.MapPost("/v1/scenario/burst", (FleetHost host) => Results.Ok(host.Burst()))
            .RequireAuthorization(Policies.Engineer);
    }
}
