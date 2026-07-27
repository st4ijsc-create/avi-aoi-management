using St4i.EngineApi.Alarms;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.Line;
using St4i.EngineApi.Policy;

namespace St4i.EngineApi.Endpoints;

/// <summary>
/// GĐ3 sub-4 LC-3 — the <see cref="LineController"/> HTTP surface: <c>GET /v1/line</c> (the effective
/// PackML state, Operator) and <c>POST /v1/line/{command}</c> (Operator, policy-gated + audited — same
/// <c>policy.Evaluate</c> → <see cref="PolicyResults.DenyAsync"/> → mutate → <c>recorder.RecordAsync</c>
/// template <c>FleetEndpoints.cs</c> already establishes for <c>/v1/fleet/*</c>). The action string used for
/// BOTH the policy evaluation and the success audit row is derived from the PARSED <see cref="LineCommand"/>
/// (never the raw route text) so it's byte-identical regardless of the caller's casing (e.g. a client
/// posting <c>/v1/line/Start</c> is still gated/audited as <c>line.start</c>, matching the exact keys
/// <c>EstopGuardRule</c>/<c>RoleObligationRule</c> register).
/// </summary>
public static class LineEndpoints
{
    public static void MapLineEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/line", GetLineAsync).RequireAuthorization(Policies.Operator);
        app.MapPost("/v1/line/{command}", ExecuteAsync).RequireAuthorization(Policies.Operator);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/line
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> GetLineAsync(LineController line, IAlarmStore alarms, CancellationToken ct)
    {
        var criticalAlarmActive = await AnyCriticalAlarmActiveAsync(alarms, ct).ConfigureAwait(false);
        return Results.Ok(line.Snapshot(criticalAlarmActive));
    }

    // ─────────────────────────────────────────────────────────────────────
    // POST /v1/line/{command}
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> ExecuteAsync(
        string command, LineController line, FleetHost host, IAlarmStore alarms,
        HttpContext context, AuditRecorder recorder, PolicyEngine policy, CancellationToken ct)
    {
        if (!Enum.TryParse<LineCommand>(command, ignoreCase: true, out var cmd) || !Enum.IsDefined(cmd))
        {
            return Results.BadRequest(new ApiErrorDto($"'{command}' is not a valid line command."));
        }

        // Canonical, casing-stable action string — see the class doc comment for why this (not the raw
        // route text) is what both the policy engine and the audit row use.
        var action = $"line.{cmd.ToString().ToLowerInvariant()}";

        var decision = policy.Evaluate(PolicyRequest.For(context, action, host.GetSafetyStatus()));
        if (!decision.IsPermitted)
        {
            return await PolicyResults.DenyAsync(context, recorder, action, decision, ct).ConfigureAwait(false);
        }

        var criticalAlarmActive = await AnyCriticalAlarmActiveAsync(alarms, ct).ConfigureAwait(false);
        var before = line.Snapshot(criticalAlarmActive);

        var result = line.Execute(cmd, criticalAlarmActive);
        if (!result.Accepted)
        {
            // Rejected mutation (409) — per the WS-D-D4 ordering rule, no audit row is written here (the
            // policy DENY path above is the one exception to that rule, already audited by DenyAsync).
            return Results.Json(new ApiErrorDto(result.RejectReason ?? "Invalid line transition."), statusCode: StatusCodes.Status409Conflict);
        }

        var after = line.Snapshot(criticalAlarmActive);
        await recorder.RecordAsync(context, action, "line", null, before, after, ct).ConfigureAwait(false);
        return Results.Ok(after);
    }

    private static async Task<bool> AnyCriticalAlarmActiveAsync(IAlarmStore alarms, CancellationToken ct)
    {
        var active = await alarms.ListActiveAsync(ct).ConfigureAwait(false);
        return active.Any(a => a.Priority == AlarmPriority.Critical);
    }
}
