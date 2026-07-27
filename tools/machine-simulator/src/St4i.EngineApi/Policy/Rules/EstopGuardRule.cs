namespace St4i.EngineApi.Policy.Rules;

/// <summary>SAFETY: refuses the machine-actuating commands while the E-STOP latch is engaged, turning the
/// engine's silent <c>StartLocked</c> no-op into an explicit, audited <see cref="PolicyReasonCode.SafetyBlocked"/>
/// denial. Never blocks stop/estop/estop-reset/reads/config (returns <see langword="null"/> for anything
/// outside <see cref="ActuatingActions"/>) — an E-STOP and its reset must ALWAYS be reachable. This rule only
/// ever blocks; it never permits (it leaves permitting to <see cref="RoleObligationRule"/>).
///
/// GĐ3 sub-4 LC-3 — <c>line.start</c>/<c>line.unhold</c> are the <see cref="St4i.EngineApi.Line.LineController"/>
/// commands that ultimately call <see cref="St4i.EngineApi.Fleet.FleetHost.Start"/> (same as <c>fleet.start</c>
/// itself), so they need the SAME E-STOP guard — an operator must not be able to resume production through
/// the line-panel route while <c>fleet.start</c> is blocked. <c>line.hold</c>/<c>line.stop</c>/<c>line.abort</c>/
/// <c>line.reset</c> only ever STOP/E-STOP/reset the fleet, never start it, so — like <c>fleet.stop</c>/
/// <c>fleet.estop</c>/<c>fleet.estop_reset</c> above — they stay reachable while latched.</summary>
public sealed class EstopGuardRule : IPolicyRule
{
    private static readonly HashSet<string> ActuatingActions = new(StringComparer.Ordinal)
    {
        "fleet.start", "scenario.burst", "line.start", "line.unhold",
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
