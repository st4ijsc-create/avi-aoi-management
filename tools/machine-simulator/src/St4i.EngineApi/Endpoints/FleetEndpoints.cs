using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Endpoints;

/// <summary><c>/v1/health</c>, <c>/v1/fleet</c>, <c>/v1/machines/{code}</c>,
/// <c>/v1/fleet/start</c>/<c>stop</c>, <c>/v1/machines/{code}/sync-config</c> — see the Task 3 brief for
/// the exact response shapes; each maps 1:1 onto a <see cref="FleetHost"/> method/DTO.</summary>
public static class FleetEndpoints
{
    public static void MapFleetEndpoints(this IEndpointRouteBuilder app)
    {
        // E1: Ok used to be hardcoded true — a client had no way to tell a genuinely faulted engine
        // (StartLocked's pipeline task threw, LastError set, IsRunning flipped back to false — see
        // FleetHost.StartLocked's catch) from a healthy one. LastError is null both before the fleet has
        // ever been started and after a clean Stop(), so this stays true in both of those ordinary
        // states too — it only goes false once something has actually gone wrong.
        app.MapGet("/v1/health", (FleetHost host) => Results.Ok(new HealthDto(host.LastError is null, host.Mode)));

        app.MapGet("/v1/fleet", (FleetHost host) => Results.Ok(host.Snapshot()));

        app.MapGet("/v1/machines/{code}", (string code, FleetHost host) =>
        {
            var detail = host.MachineDetail(code);
            return detail is null
                ? Results.NotFound(new ApiErrorDto($"machine \"{code}\" not found"))
                : Results.Ok(detail);
        });

        app.MapPost("/v1/fleet/start", (FleetHost host) =>
        {
            host.Start();
            return Results.Ok(new FleetActionResultDto(host.IsRunning, host.Mode.ToString()));
        });

        app.MapPost("/v1/fleet/stop", (FleetHost host) =>
        {
            host.Stop();
            return Results.Ok(new FleetActionResultDto(host.IsRunning, host.Mode.ToString()));
        });

        app.MapPost("/v1/machines/{code}/sync-config", async (string code, FleetHost host, CancellationToken ct) =>
        {
            var result = await host.SyncConfigAsync(code, ct).ConfigureAwait(false);
            return result is null
                ? Results.NotFound(new ApiErrorDto($"machine \"{code}\" not found"))
                : Results.Ok(result);
        });
    }
}
