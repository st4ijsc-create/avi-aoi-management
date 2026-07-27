using St4i.EngineApi.Auth;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.Policy;

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

        app.MapPost("/v1/scenario", async (ScenarioRequest request, FleetHost host, HttpContext context, AuditRecorder recorder, CancellationToken ct) =>
        {
            var applied = host.ApplyScenario(request.ToScenarioConfig());
            await recorder.RecordAsync(context, "scenario.apply", null, null, null, applied, ct).ConfigureAwait(false);
            return Results.Ok(applied);
        }).RequireAuthorization(Policies.Engineer);

        app.MapPost("/v1/scenario/preset", async (
            ScenarioPresetRequest request, FleetHost host, HttpContext context, AuditRecorder recorder, CancellationToken ct) =>
        {
            var (preset, applied, hotFolderStatus) = await host.ApplyPresetAsync(request.Name, ct).ConfigureAwait(false);
            if (preset is null)
            {
                // Rejected mutation (404 — unknown preset) — per the WS-D-D4 ordering rule, no audit row.
                var known = string.Join(", ", host.ListPresets().Select(p => p.Name));
                return Results.NotFound(new ApiErrorDto($"unknown preset \"{request.Name}\" — known: {known}"));
            }

            await recorder.RecordAsync(context, "scenario.preset", null, request.Name, null, new { scenario = applied, hotFolderStatus }, ct)
                .ConfigureAwait(false);
            return Results.Ok(new { scenario = applied, hotFolderStatus });
        }).RequireAuthorization(Policies.Engineer);

        app.MapPost("/v1/scenario/burst", async (FleetHost host, HttpContext context, AuditRecorder recorder, PolicyEngine policy, CancellationToken ct) =>
        {
            var decision = policy.Evaluate(PolicyRequest.For(context, "scenario.burst", host.GetSafetyStatus()));
            if (!decision.IsPermitted)
                return await PolicyResults.DenyAsync(context, recorder, "scenario.burst", decision, ct).ConfigureAwait(false);

            var applied = host.Burst();
            await recorder.RecordAsync(context, "scenario.burst", null, null, null, applied, ct).ConfigureAwait(false);
            return Results.Ok(applied);
        }).RequireAuthorization(Policies.Engineer);
    }
}
