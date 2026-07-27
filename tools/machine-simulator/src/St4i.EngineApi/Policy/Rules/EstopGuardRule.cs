namespace St4i.EngineApi.Policy.Rules;

/// <summary>SAFETY: refuses the machine-actuating commands while the E-STOP latch is engaged, turning the
/// engine's silent <c>StartLocked</c> no-op into an explicit, audited <see cref="PolicyReasonCode.SafetyBlocked"/>
/// denial. Never blocks stop/estop/estop-reset/reads/config (returns <see langword="null"/> for anything
/// outside <see cref="ActuatingActions"/>) — an E-STOP and its reset must ALWAYS be reachable. This rule only
/// ever blocks; it never permits (it leaves permitting to <see cref="RoleObligationRule"/>).</summary>
public sealed class EstopGuardRule : IPolicyRule
{
    private static readonly HashSet<string> ActuatingActions = new(StringComparer.Ordinal)
    {
        "fleet.start", "scenario.burst",
    };

    public PolicyDecision? Evaluate(PolicyRequest request)
    {
        if (!ActuatingActions.Contains(request.Action)) return null;
        if (request.Safety.EstopEngaged)
        {
            return PolicyDecision.Deny(PolicyReasonCode.SafetyBlocked,
                "E-STOP is engaged — reset the E-STOP latch before starting production. " +
                "(This is a supervisory software latch, NOT a substitute for the machine's safety-rated " +
                "emergency-stop circuit — SYNAPSE XC-R40.)");
        }
        return null; // latch clear → let RoleObligation decide
    }
}
