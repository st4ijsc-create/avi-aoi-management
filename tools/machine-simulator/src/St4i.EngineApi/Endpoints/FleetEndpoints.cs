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
        // WS-D-D1 — anonymous: St4i.DesktopShell's readiness probe (and any external health check) must
        // work before/without ever logging in, now that the default-deny fallback policy requires auth on
        // everything else.
        app.MapGet("/v1/health", (FleetHost host) => Results.Ok(new HealthDto(host.LastError is null, host.Mode)))
            .AllowAnonymous();

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

        // Branch-review C-2/C-3 — the E-STOP latch (FleetHost.EstopEngaged), engine-owned so it's
        // shared across every panel/tab and survives a reload. Both return the FULL fleet snapshot
        // (not just the action-result shape /start and /stop use) so the client can update its shared
        // fleet-runtime state from ONE trustworthy, already-confirmed response — the mutation itself
        // IS the "did the machine actually stop" confirmation (C-3), not a fire-and-forget.
        app.MapPost("/v1/fleet/estop", (FleetHost host) =>
        {
            host.Estop();
            return Results.Ok(host.Snapshot());
        });

        app.MapPost("/v1/fleet/estop/reset", (FleetHost host) =>
        {
            host.ResetEstop();
            return Results.Ok(host.Snapshot());
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
