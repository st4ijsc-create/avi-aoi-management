using Microsoft.Extensions.DependencyInjection;
using St4i.EngineApi.Alarms;
using St4i.EngineApi.Auth;

namespace St4i.EngineApi.Policy;

public static class PolicyResults
{
    /// <summary>Audits the denial (policy denials ARE recorded — a deliberate departure from the WS-D-D4
    /// "no audit row on a pre-mutation rejection" rule, same safety/security rationale as <c>auth.login_failed</c>
    /// and <c>fleet.estop</c> already are) and returns the reason→status-mapped error response.</summary>
    public static async Task<IResult> DenyAsync(
        HttpContext ctx, AuditRecorder recorder, string action, PolicyDecision decision, CancellationToken ct)
    {
        var code = decision.Reason.ToWireCode();
        await recorder.RecordAsync(ctx, $"{action}.denied", "policy", code,
            null, new { reason = code, message = decision.Message }, ct).ConfigureAwait(false);

        // GĐ3 sub-4 LC-1 — the FIRST alarm SOURCE: every policy DENY raises a latched Policy alarm.
        // SAFETY_BLOCKED (the halt guard, EstopGuardRule) is Critical + a halt-specific runbook; every
        // other denial reason is High + a generic one. ClearOnAck=true — a DENY has no lingering condition of its own
        // (see Alarm's doc comment for the EVENT-vs-CONDITION distinction); it's a point-in-time event an
        // operator resolves by acknowledging it, so AckAsync both acks AND clears it in one step. Resolved
        // from ctx.RequestServices (NOT a ctor-injected parameter) so this method's signature — and every
        // existing call site (FleetEndpoints/ScenarioEndpoints) — is untouched; GetService (not
        // GetRequiredService) so a host that never registers IAlarmStore still behaves exactly as before
        // (null-safe, additive). RaiseAsync itself never throws (see AlarmStore's doc comment), so this call
        // needs no try/catch of its own on top of that guarantee.
        var alarms = ctx.RequestServices.GetService<IAlarmStore>();
        if (alarms is not null)
        {
            var priority = decision.Reason == PolicyReasonCode.SafetyBlocked ? AlarmPriority.Critical : AlarmPriority.High;
            var runbook = decision.Reason switch
            {
                // SM-4 — this only stopped THIS SOFTWARE's own data collection, never any machine (the
                // product has no write path to any device). Say so, rather than telling the operator to
                // "verify the machine is safe" as if this control had any bearing on that.
                PolicyReasonCode.SafetyBlocked =>
                    "The halt latch is engaged — this stopped this software's own data collection only, not any " +
                    "machine. Reset the latch (POST /v1/fleet/estop/reset) before starting.",
                _ => "The action was denied by policy. Check the operator's role and the current fleet state.",
            };
            await alarms.RaiseAsync(
                    new AlarmRaise(AlarmSource.Policy, code, priority, decision.Message, runbook, TargetId: action, ClearOnAck: true), ct)
                .ConfigureAwait(false);
        }

        var status = decision.Reason switch
        {
            PolicyReasonCode.SafetyBlocked or PolicyReasonCode.NotReady or PolicyReasonCode.Busy
                => StatusCodes.Status409Conflict,
            PolicyReasonCode.PolicyDenied => StatusCodes.Status403Forbidden,
            _ => StatusCodes.Status400BadRequest, // InvalidArgs, Unsupported
        };
        return Results.Json(new PolicyDenyDto(decision.Message, code), statusCode: status);
    }
}
