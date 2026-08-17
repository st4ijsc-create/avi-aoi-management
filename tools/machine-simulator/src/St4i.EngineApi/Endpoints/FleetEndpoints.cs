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
        // E1: Ok used to be hardcoded true — a client had no way to tell a genuinely faulted engine from a
        // healthy one. LastError is null both before the fleet has ever been started and after a clean
        // Stop(), so this stays true in both of those ordinary states too — it only goes false once
        // something has actually gone wrong.
        //
        // 🔴 U-1 — WHICH FAULTS THOSE ARE IS NOT DEFINED HERE; see FleetCore.LastError's own declaration,
        // which names both producers. This comment used to name ONE of them inline ("StartLocked's pipeline
        // task threw … see FleetCore.StartLocked's catch"), which read as the definition and was already
        // stale twice over: that catch lives in FleetCore.StartSlot, and since U-1 a restart whose rebuild
        // throws sets the field too (docs/owner-decisions.md item 7). A second copy of a producer list is
        // the copy nobody updates.
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

        // Branch-review C-2/C-3 — the HALT latch (FleetHost.EstopEngaged), engine-owned so it's
        // shared across every panel/tab and survives a reload. Both return the FULL fleet snapshot
        // (not just the action-result shape /start and /stop use) so the client can update its shared
        // fleet-runtime state from ONE trustworthy, already-confirmed response — the mutation itself
        // IS the "did this software's read pipeline actually stop" confirmation (C-3), not a
        // fire-and-forget. SM-4: this is a supervisory software latch, not a machine safety function —
        // see FleetHost.Estop's own doc comment and README §1.
        //
        // WS-D-D4 — logged even though Operator-reachable ("who pressed HALT" is exactly the kind of
        // question this audit trail exists to answer, regardless of which role was allowed to press it).
        //
        // 🔴 CARRIED, NOT FIXED — G-2 whole-branch review I-4. NAMED HERE BECAUSE THIS IS WHERE THE NEXT
        // PERSON LOOKS, and the divergence must not live only in a task report.
        //
        // `host.Estop()` below is unwrapped, so a throw from it skips `recorder.RecordAsync`. That was
        // already true before G-2 — what CHANGED is what the missing row MEANS. Pre-G-2 a throwing Estop()
        // left a half-done halt (drivers possibly undisposed, no historian run event), so "no audit row"
        // accompanied "not much happened". Post-G-2 the same throw leaves the halt ITSELF complete on every
        // path: EstopEngaged latched, every driver disposed. So the audit trail is now silent about a halt
        // that demonstrably happened — and the line directly above says that trail exists to answer "who
        // pressed HALT".
        //
        // 🔴 ENUMERATED, NOT SUMMARISED, because the first draft of this comment summarised and was wrong on
        // one of four. Estop() names its throw sites at its own definition; per site, what is true when the
        // audit row is skipped:
        //   1. the in-lock PublishNodeDeath seam ....... latch set, drivers disposed, run event WRITTEN
        //   2. RecordRunEventFireAndForget's disposed arm  latch set, drivers disposed, run event NOT written
        //      — because on this path the run event IS the throw site
        //   3. WaitAndDisposeOldPipeline's deferred flush  latch set, drivers disposed, run event written
        //   4. DisposeOldSlots' buffered _logDebug ...... latch set, drivers disposed, run event written
        // The first draft said "and the historian run event written" flat, which is false for site 2. The
        // CONCLUSION survives all four — the halt completed and no audit row records it — but the universal
        // did not, and it summarised over an enumeration that already existed one file away.
        //
        // NOT A REGRESSION (no row either way) and NOT fixed inside G-2, deliberately: the remedy is a
        // behaviour decision, not a mechanical one — record-before-acting changes what a row MEANS (it would
        // assert an action that may not have completed), and a try/finally around the recorder writes a row
        // for a failed call. WS-D-D4's ordering rule already governs that choice and it is not G-2's to make.
        //
        // 🔴 IT IS THE SAME SHAPE AS THE S-SET, ONE LAYER UP, and G-2's instrument structurally could not see
        // it: that instrument is scoped to FleetCore._gate, and FleetHost holds no lock at all. This is an
        // instance of blueprint §8.1(f) — an instrument's domain gets inherited from the author's POSITION
        // rather than derived from the question — and here the position was a LAYER. (An earlier draft of
        // this comment paired it with G-2's own StartSlot finding as "the same blind spot"; that one is the
        // VOCABULARY half of the same rule, not the layer half, and calling them one thing was the very
        // over-generalisation §8.1(f) exists to prevent. G-1's UnsPublisher path is the layer sibling.)
        // THE SWEEP THIS WANTS, named so it is not re-derived from scratch: every endpoint that mutates
        // fleet state and then records an audit row as a SEPARATE statement. Same shape at fleet.start,
        // fleet.stop, scenario.apply and scenario.burst.
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
