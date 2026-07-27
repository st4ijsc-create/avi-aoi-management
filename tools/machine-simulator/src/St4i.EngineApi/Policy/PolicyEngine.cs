namespace St4i.EngineApi.Policy;

/// <summary>Thin default-deny policy engine. Evaluates every rule: ANY deny wins over any permit (so a
/// safety block can never be overridden by a later permit); an action that no rule permits is DENIED. Rules
/// are ordered safety-first so a <see cref="PolicyReasonCode.SafetyBlocked"/> is the reported reason when
/// more than one rule would deny.</summary>
public sealed class PolicyEngine
{
    private readonly IReadOnlyList<IPolicyRule> _rules;
    public PolicyEngine(IEnumerable<IPolicyRule> rules) => _rules = rules.ToArray();

    public PolicyDecision Evaluate(PolicyRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        PolicyDecision? permit = null;
        foreach (var rule in _rules)
        {
            var d = rule.Evaluate(request);
            if (d is null) continue;
            if (d.Effect == PolicyEffect.Deny) return d; // deny wins; rules ordered safety-first
            permit ??= d;                                 // remember a permit but keep scanning for a deny
        }
        return permit ?? PolicyDecision.Deny(PolicyReasonCode.PolicyDenied,
            $"No policy permits action '{request.Action}'.");
    }
}
