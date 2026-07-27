using St4i.EngineApi.Auth;

namespace St4i.EngineApi.Policy.Rules;

/// <summary>Re-expresses each policy-gated action's minimum-role obligation as an evaluatable rule (mirroring
/// the route's <c>RequireAuthorization</c>) so a command that does NOT arrive via the HTTP route — a future
/// UNS NCMD — is still gated by the same check ("no back-door"). Unknown action → UNSUPPORTED (default-deny).</summary>
public sealed class RoleObligationRule : IPolicyRule
{
    private static readonly IReadOnlyDictionary<string, string> Obligations = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["fleet.start"] = Roles.Operator,
        ["fleet.stop"] = Roles.Operator,
        ["fleet.estop"] = Roles.Operator,
        ["fleet.estop_reset"] = Roles.Operator,
        ["scenario.burst"] = Roles.Engineer,

        // GĐ3 sub-4 LC-3 — the LineController command surface (POST /v1/line/{command}); same Operator
        // obligation as every other fleet-actuating action above (RbacPolicyTests.ExpectedRoutes also
        // requires GET /v1/line + POST /v1/line/{command} to carry Policies.Operator).
        ["line.start"] = Roles.Operator,
        ["line.hold"] = Roles.Operator,
        ["line.unhold"] = Roles.Operator,
        ["line.stop"] = Roles.Operator,
        ["line.abort"] = Roles.Operator,
        ["line.reset"] = Roles.Operator,
    };

    public PolicyDecision? Evaluate(PolicyRequest request)
    {
        if (!Obligations.TryGetValue(request.Action, out var required))
        {
            return PolicyDecision.Deny(PolicyReasonCode.Unsupported,
                $"Action '{request.Action}' is not a recognized policy-gated command.");
        }
        return SatisfiesRole(request.ActorRole, required)
            ? PolicyDecision.Permit()
            : PolicyDecision.Deny(PolicyReasonCode.PolicyDenied,
                $"Action '{request.Action}' requires the {required} role (or higher).");
    }

    // Role hierarchy Admin > Engineer > Operator — MUST match the RequireRole OR-lists in Program.cs:211-213.
    private static bool SatisfiesRole(string actorRole, string required) => required switch
    {
        Roles.Operator => actorRole is Roles.Operator or Roles.Engineer or Roles.Admin,
        Roles.Engineer => actorRole is Roles.Engineer or Roles.Admin,
        Roles.Admin => actorRole is Roles.Admin,
        _ => false,
    };
}
