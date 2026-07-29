namespace St4i.EngineApi.Policy.Rules;

/// <summary>SAFETY-ADJACENT (not a safety function itself — see SM-4 below): refuses the
/// production-resuming commands while the HALT latch (<see cref="St4i.EngineApi.Fleet.FleetHost.EstopEngaged"/>)
/// is engaged, turning the engine's silent <c>StartLocked</c> no-op into an explicit, audited
/// <see cref="PolicyReasonCode.SafetyBlocked"/> denial. Never blocks stop/estop/estop-reset/reads/config
/// (returns <see langword="null"/> for anything outside <see cref="ActuatingActions"/>) — a halt and its
/// reset must ALWAYS be reachable. This rule only ever blocks; it never permits (it leaves permitting to
/// <see cref="RoleObligationRule"/>).
///
/// SM-4 — the class/route names here (<c>EstopGuardRule</c>, <c>fleet.estop</c>) are kept unchanged
/// deliberately (API/identifier stability); the TRUTH this rule enforces is narrower than the name
/// suggests: it gates whether THIS SOFTWARE resumes reading from its configured device(s), never
/// anything about a physical machine's own state. This codebase has no write path to any device — see
/// <see cref="St4i.EngineApi.Fleet.FleetHost.Estop"/>'s own doc comment.
///
/// GĐ3 sub-4 LC-3 — <c>line.start</c>/<c>line.unhold</c> are the <see cref="St4i.EngineApi.Line.LineController"/>
/// commands that ultimately call <see cref="St4i.EngineApi.Fleet.FleetHost.Start"/> (same as <c>fleet.start</c>
/// itself), so they need the SAME halt guard — an operator must not be able to resume production through
/// the line-panel route while <c>fleet.start</c> is blocked. <c>line.hold</c>/<c>line.stop</c>/<c>line.abort</c>/
/// <c>line.reset</c> only ever STOP/halt/reset the fleet, never start it, so — like <c>fleet.stop</c>/
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
                "The halt latch is engaged — this only stopped this software's own data collection, not any " +
                "machine. Reset the latch (POST /v1/fleet/estop/reset) before starting production. " +
                "(This is a supervisory SOFTWARE latch, NOT a substitute for the machine's own safety-rated " +
                "emergency-stop circuit, and this product has no write path to any device at all — SYNAPSE XC-R40.)");
        }
        return null; // latch clear → let RoleObligation decide
    }
}
