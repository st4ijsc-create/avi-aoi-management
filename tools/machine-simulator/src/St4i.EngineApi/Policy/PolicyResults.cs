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
