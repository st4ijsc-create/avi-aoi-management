using St4i.EngineApi.Policy;
using St4i.EngineApi.Policy.Rules;
using St4i.EngineApi.Safety;
using Xunit;

namespace St4i.EngineApi.Tests.Policy;

/// <summary>G2-4 SAFETY — proves <see cref="EstopGuardRule"/> blocks ONLY the machine-actuating actions
/// (fleet.start, scenario.burst) while the E-STOP latch is engaged, and NEVER blocks stop/estop/
/// estop-reset — those must always be reachable so an operator can always clear a latched E-STOP.</summary>
public sealed class EstopGuardRuleTests
{
    private readonly EstopGuardRule _rule = new();

    private static PolicyRequest Request(string action, bool estopEngaged) =>
        new(action, "Operator", "tester", new SafetySnapshot(estopEngaged, IsRunning: false));

    [Fact]
    public void FleetStart_WhileEstopped_DeniesSafetyBlocked()
    {
        var decision = _rule.Evaluate(Request("fleet.start", estopEngaged: true));

        Assert.NotNull(decision);
        Assert.False(decision!.IsPermitted);
        Assert.Equal(PolicyReasonCode.SafetyBlocked, decision.Reason);
    }

    [Fact]
    public void FleetStart_NotEstopped_ReturnsNull_LetsRoleObligationDecide()
    {
        var decision = _rule.Evaluate(Request("fleet.start", estopEngaged: false));
        Assert.Null(decision);
    }

    [Fact]
    public void ScenarioBurst_WhileEstopped_DeniesSafetyBlocked()
    {
        var decision = _rule.Evaluate(Request("scenario.burst", estopEngaged: true));

        Assert.NotNull(decision);
        Assert.False(decision!.IsPermitted);
        Assert.Equal(PolicyReasonCode.SafetyBlocked, decision.Reason);
    }

    [Fact]
    public void ScenarioBurst_NotEstopped_ReturnsNull()
    {
        var decision = _rule.Evaluate(Request("scenario.burst", estopEngaged: false));
        Assert.Null(decision);
    }

    [Theory]
    [InlineData("fleet.stop")]
    [InlineData("fleet.estop")]
    [InlineData("fleet.estop_reset")]
    public void NonActuatingActions_NeverBlocked_EvenWhileEstopped(string action)
    {
        var decision = _rule.Evaluate(Request(action, estopEngaged: true));
        Assert.Null(decision);
    }

    [Fact]
    public void UnknownAction_ReturnsNull_RegardlessOfEstopState()
    {
        Assert.Null(_rule.Evaluate(Request("something.else", estopEngaged: true)));
        Assert.Null(_rule.Evaluate(Request("something.else", estopEngaged: false)));
    }
}
