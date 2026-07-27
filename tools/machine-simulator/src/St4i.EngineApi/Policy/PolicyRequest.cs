using System.Security.Claims;
using St4i.EngineApi.Safety;

namespace St4i.EngineApi.Policy;

/// <summary>One command to be authorized by the <see cref="PolicyEngine"/>: the action id, the actor's
/// role/name (extracted from the auth context exactly as <c>AuditRecorder</c> does), and the current
/// read-only <see cref="SafetySnapshot"/>. Deliberately transport-agnostic so a future non-HTTP command
/// path (e.g. a UNS NCMD) can build the same request and be gated by the same rules (the "no back-door").</summary>
public sealed record PolicyRequest(string Action, string ActorRole, string ActorName, SafetySnapshot Safety)
{
    public static PolicyRequest For(HttpContext ctx, string action, SafetySnapshot safety) => new(
        action,
        ctx.User.FindFirstValue(ClaimTypes.Role) ?? "(none)",
        ctx.User.Identity?.Name ?? "(anonymous)",
        safety);
}
