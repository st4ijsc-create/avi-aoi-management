using St4i.EngineApi.Auth;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.Policy;

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

        app.MapGet("/v1/fleet", (FleetHost host) => Results.Ok(host.Snapshot()))
            .RequireAuthorization(Policies.Operator);

        app.MapGet("/v1/machines/{code}", (string code, FleetHost host) =>
        {
            var detail = host.MachineDetail(code);
            return detail is null
                ? Results.NotFound(new ApiErrorDto($"machine \"{code}\" not found"))
                : Results.Ok(detail);
        }).RequireAuthorization(Policies.Operator);

        app.MapPost("/v1/fleet/start", async (FleetHost host, HttpContext context, AuditRecorder recorder, PolicyEngine policy, CancellationToken ct) =>
        {
            var decision = policy.Evaluate(PolicyRequest.For(context, "fleet.start", host.GetSafetyStatus()));
            if (!decision.IsPermitted)
                return await PolicyResults.DenyAsync(context, recorder, "fleet.start", decision, ct).ConfigureAwait(false);

            var before = new { host.IsRunning, host.EstopEngaged };
            host.Start();
            await recorder.RecordAsync(context, "fleet.start", null, null, before, new { host.IsRunning, host.EstopEngaged }, ct)
                .ConfigureAwait(false);
            return Results.Ok(new FleetActionResultDto(host.IsRunning, host.Mode.ToString()));
        }).RequireAuthorization(Policies.Operator);

        app.MapPost("/v1/fleet/stop", async (FleetHost host, HttpContext context, AuditRecorder recorder, PolicyEngine policy, CancellationToken ct) =>
        {
            var decision = policy.Evaluate(PolicyRequest.For(context, "fleet.stop", host.GetSafetyStatus()));
            if (!decision.IsPermitted)
                return await PolicyResults.DenyAsync(context, recorder, "fleet.stop", decision, ct).ConfigureAwait(false);

            var before = new { host.IsRunning, host.EstopEngaged };
            host.Stop();
            await recorder.RecordAsync(context, "fleet.stop", null, null, before, new { host.IsRunning, host.EstopEngaged }, ct)
                .ConfigureAwait(false);
            return Results.Ok(new FleetActionResultDto(host.IsRunning, host.Mode.ToString()));
        }).RequireAuthorization(Policies.Operator);

        // Branch-review C-2/C-3 — the E-STOP latch (FleetHost.EstopEngaged), engine-owned so it's
        // shared across every panel/tab and survives a reload. Both return the FULL fleet snapshot
        // (not just the action-result shape /start and /stop use) so the client can update its shared
        // fleet-runtime state from ONE trustworthy, already-confirmed response — the mutation itself
        // IS the "did the machine actually stop" confirmation (C-3), not a fire-and-forget.
        //
        // WS-D-D4 — logged even though Operator-reachable ("who pressed E-STOP" is exactly the kind of
        // question this audit trail exists to answer, regardless of which role was allowed to press it).
        app.MapPost("/v1/fleet/estop", async (FleetHost host, HttpContext context, AuditRecorder recorder, PolicyEngine policy, CancellationToken ct) =>
        {
            var decision = policy.Evaluate(PolicyRequest.For(context, "fleet.estop", host.GetSafetyStatus()));
            if (!decision.IsPermitted)
                return await PolicyResults.DenyAsync(context, recorder, "fleet.estop", decision, ct).ConfigureAwait(false);

            var before = new { host.IsRunning, host.EstopEngaged };
            host.Estop();
            await recorder.RecordAsync(context, "fleet.estop", null, null, before, new { host.IsRunning, host.EstopEngaged }, ct)
                .ConfigureAwait(false);
            return Results.Ok(host.Snapshot());
        }).RequireAuthorization(Policies.Operator);

        app.MapPost("/v1/fleet/estop/reset", async (FleetHost host, HttpContext context, AuditRecorder recorder, PolicyEngine policy, CancellationToken ct) =>
        {
            var decision = policy.Evaluate(PolicyRequest.For(context, "fleet.estop_reset", host.GetSafetyStatus()));
            if (!decision.IsPermitted)
                return await PolicyResults.DenyAsync(context, recorder, "fleet.estop_reset", decision, ct).ConfigureAwait(false);

            var before = new { host.IsRunning, host.EstopEngaged };
            host.ResetEstop();
            await recorder.RecordAsync(context, "fleet.estop_reset", null, null, before, new { host.IsRunning, host.EstopEngaged }, ct)
                .ConfigureAwait(false);
            return Results.Ok(host.Snapshot());
        }).RequireAuthorization(Policies.Operator);

        // WS-D-D5 — the sync-config audit gap D4's review flagged: every other config-family mutation
        // (product.upsert, settings.update, machine.settings.set, historian.oee_settings.update, …) already
        // gets an audit row, but this one — an Engineer explicitly pulling config onto a machine — didn't.
        // No "before" value to record (this is a version CHECK against whatever the machine already cached,
        // not an old→new field edit); `newValue` is the full result summary (changed/version/driftState/
        // applied — see SyncConfigResponse), which already carries the "did it actually pull anything"
        // outcome, success or transport failure alike (FleetHost.SyncConfigAsync never throws — see its own
        // catch — so the audit row is written the same way whether the sync succeeded or errored).
        app.MapPost("/v1/machines/{code}/sync-config", async (
            string code, FleetHost host, HttpContext context, AuditRecorder recorder, CancellationToken ct) =>
        {
            var result = await host.SyncConfigAsync(code, ct).ConfigureAwait(false);
            if (result is null)
            {
                return Results.NotFound(new ApiErrorDto($"machine \"{code}\" not found"));
            }

            await recorder.RecordAsync(context, "machine.config.sync", "machine", code, null, result, ct)
                .ConfigureAwait(false);
            return Results.Ok(result);
        }).RequireAuthorization(Policies.Engineer);
    }
}
