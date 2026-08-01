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

        // Task B-6 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-6-brief.md) — deliberate
        // placement against the existing Operator/Engineer/Admin scale (RbacPolicyTests.ExpectedRoutes also
        // requires POST /v1/machines/{code}/setpoint to carry Policies.Engineer and POST
        // /v1/machines/{code}/command to carry Policies.Admin — MUST match the RequireRole OR-lists in
        // Program.cs, same discipline as every obligation above).
        //
        // machine.setpoint.write = Engineer, not Operator: every Operator-gated action above (fleet/line
        // start-stop) never touches a device at all — it starts/stops THIS SOFTWARE's own read pipeline.
        // A setpoint write is the first capability in the product that changes a physical machine, which is
        // a different kind of authority than "start reading a machine" — placing it at Operator would treat
        // "flip this software's own switch" and "poke a live device's control loop" as the same trust tier,
        // which they are not. Engineer already gates config/connector mutations, including the ability to
        // DECLARE a point writable at all (POST /v1/connectors' save gate) — the same tier trusted to grant
        // write capability is the natural tier trusted to exercise an ordinary, bounded (min/max-enforced)
        // setpoint write day to day.
        //
        // machine.command.invoke = Admin, strictly ABOVE setpoint: B-1 kept setpoint and command as two
        // separate contract members, and B-3 kept them separately declarable, precisely so this layer could
        // treat them differently — "setting a value and starting a motion are different acts". A command can
        // fire real, ungoverned motion (a coil pulse, an OPC-UA CallAsync) with no setpoint-style bound beyond
        // argument narrowing — B-5's own report calls method-call "the highest-risk surface this batch". This
        // product's existing precedent for its single highest-risk, hardest-to-undo action (identity rotation
        // — Policies.Admin, echo-back fingerprint, audit old->new) already reserves Admin for exactly this
        // class of consequence; Engineer would put "trigger a physical motion sequence" behind the SAME gate
        // as "edit a connector's host/port", the specific mismatch this task's own brief warns against.
        ["machine.setpoint.write"] = Roles.Engineer,
        ["machine.command.invoke"] = Roles.Admin,
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
