using St4i.EngineApi.Policy;
using St4i.EngineApi.Safety;
using Xunit;

namespace St4i.EngineApi.Tests.Policy;

/// <summary>G2-4 — plain xUnit, no web host: proves <see cref="PolicyEngine"/>'s default-deny/deny-wins
/// semantics in isolation, using tiny fake <see cref="IPolicyRule"/>s rather than the real
/// EstopGuard/RoleObligation rules (those get their own dedicated test classes).</summary>
public sealed class PolicyEngineTests
{
    private static PolicyRequest AnyRequest(string action = "some.action") =>
        new(action, "Operator", "tester", new SafetySnapshot(EstopEngaged: false, IsRunning: false));

    private sealed class FixedRule : IPolicyRule
    {
        private readonly PolicyDecision? _decision;
        public FixedRule(PolicyDecision? decision) => _decision = decision;
        public PolicyDecision? Evaluate(PolicyRequest request) => _decision;
    }

    [Fact]
    public void Evaluate_OneRulePermitsAnotherDenies_DenyWins()
    {
        var engine = new PolicyEngine(new IPolicyRule[]
        {
            new FixedRule(PolicyDecision.Permit()),
            new FixedRule(PolicyDecision.Deny(PolicyReasonCode.PolicyDenied, "denied by second rule")),
        });

        var decision = engine.Evaluate(AnyRequest());

        Assert.False(decision.IsPermitted);
        Assert.Equal(PolicyReasonCode.PolicyDenied, decision.Reason);
    }

    [Fact]
    public void Evaluate_DenyBeforePermitInRuleOrder_DenyStillWins()
    {
        // Order shouldn't matter — deny always wins regardless of which rule ran first.
        var engine = new PolicyEngine(new IPolicyRule[]
        {
            new FixedRule(PolicyDecision.Deny(PolicyReasonCode.SafetyBlocked, "safety first")),
            new FixedRule(PolicyDecision.Permit()),
        });

        var decision = engine.Evaluate(AnyRequest());

        Assert.False(decision.IsPermitted);
        Assert.Equal(PolicyReasonCode.SafetyBlocked, decision.Reason);
    }

    [Fact]
    public void Evaluate_AllRulesNull_DefaultDeniesWithPolicyDenied()
    {
        var engine = new PolicyEngine(new IPolicyRule[]
        {
            new FixedRule(null),
            new FixedRule(null),
        });

        var decision = engine.Evaluate(AnyRequest("unhandled.action"));

        Assert.False(decision.IsPermitted);
        Assert.Equal(PolicyReasonCode.PolicyDenied, decision.Reason);
        Assert.Contains("unhandled.action", decision.Message);
    }

    [Fact]
    public void Evaluate_NoRulesAtAll_DefaultDenies()
    {
        var engine = new PolicyEngine(Array.Empty<IPolicyRule>());

        var decision = engine.Evaluate(AnyRequest());

        Assert.False(decision.IsPermitted);
        Assert.Equal(PolicyReasonCode.PolicyDenied, decision.Reason);
    }

    [Fact]
    public void Evaluate_SinglePermittingRule_Permits()
    {
        var engine = new PolicyEngine(new IPolicyRule[]
        {
            new FixedRule(null),
            new FixedRule(PolicyDecision.Permit()),
        });

        var decision = engine.Evaluate(AnyRequest());

        Assert.True(decision.IsPermitted);
        Assert.Equal(PolicyReasonCode.Ok, decision.Reason);
    }

    [Fact]
    public void Evaluate_MultipleDenies_ReasonIsTheFirstDenyInRuleOrder()
    {
        var engine = new PolicyEngine(new IPolicyRule[]
        {
            new FixedRule(PolicyDecision.Deny(PolicyReasonCode.SafetyBlocked, "first deny")),
            new FixedRule(PolicyDecision.Deny(PolicyReasonCode.PolicyDenied, "second deny — never reached")),
        });

        var decision = engine.Evaluate(AnyRequest());

        Assert.False(decision.IsPermitted);
        Assert.Equal(PolicyReasonCode.SafetyBlocked, decision.Reason);
        Assert.Equal("first deny", decision.Message);
    }

    [Fact]
    public void Evaluate_NullRequest_Throws()
    {
        var engine = new PolicyEngine(Array.Empty<IPolicyRule>());
        Assert.Throws<ArgumentNullException>(() => engine.Evaluate(null!));
    }
}
