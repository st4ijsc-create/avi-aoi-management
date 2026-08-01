using St4i.EngineApi.Auth;
using St4i.EngineApi.Policy;
using St4i.EngineApi.Policy.Rules;
using St4i.EngineApi.Safety;
using Xunit;

namespace St4i.EngineApi.Tests.Policy;

/// <summary>G2-4 — proves <see cref="RoleObligationRule"/>'s per-action minimum-role obligations mirror
/// the Admin &gt; Engineer &gt; Operator hierarchy (matching Program.cs's RequireRole OR-lists exactly),
/// and that an unrecognized action default-denies as UNSUPPORTED rather than silently permitting.</summary>
public sealed class RoleObligationRuleTests
{
    private readonly RoleObligationRule _rule = new();

    private static PolicyRequest Request(string action, string role) =>
        new(action, role, "tester", new SafetySnapshot(EstopEngaged: false, IsRunning: false));

    [Theory]
    [InlineData(Roles.Operator)]
    [InlineData(Roles.Engineer)]
    [InlineData(Roles.Admin)]
    public void FleetStart_AnyOfOperatorEngineerAdmin_Permits(string role)
    {
        var decision = _rule.Evaluate(Request("fleet.start", role));

        Assert.NotNull(decision);
        Assert.True(decision!.IsPermitted);
    }

    [Fact]
    public void ScenarioBurst_AsOperator_DeniesPolicyDenied()
    {
        var decision = _rule.Evaluate(Request("scenario.burst", Roles.Operator));

        Assert.NotNull(decision);
        Assert.False(decision!.IsPermitted);
        Assert.Equal(PolicyReasonCode.PolicyDenied, decision.Reason);
    }

    [Theory]
    [InlineData(Roles.Engineer)]
    [InlineData(Roles.Admin)]
    public void ScenarioBurst_AsEngineerOrAdmin_Permits(string role)
    {
        var decision = _rule.Evaluate(Request("scenario.burst", role));

        Assert.NotNull(decision);
        Assert.True(decision!.IsPermitted);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Task B-6 — commands gated strictly more strictly than setpoints: Engineer (or higher) may write a
    // setpoint; only Admin may invoke a command. A setpoint-authorised caller (Engineer) must NOT be able
    // to invoke a command.
    // ─────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(Roles.Operator, false)]
    [InlineData(Roles.Engineer, true)]
    [InlineData(Roles.Admin, true)]
    public void MachineSetpointWrite_RequiresEngineerOrHigher(string role, bool expectedPermit)
    {
        var decision = _rule.Evaluate(Request("machine.setpoint.write", role));

        Assert.NotNull(decision);
        Assert.Equal(expectedPermit, decision!.IsPermitted);
        if (!expectedPermit)
        {
            Assert.Equal(PolicyReasonCode.PolicyDenied, decision.Reason);
        }
    }

    [Theory]
    [InlineData(Roles.Operator, false)]
    [InlineData(Roles.Engineer, false)]
    [InlineData(Roles.Admin, true)]
    public void MachineCommandInvoke_RequiresAdmin_EngineerAlone_IsNotEnough(string role, bool expectedPermit)
    {
        var decision = _rule.Evaluate(Request("machine.command.invoke", role));

        Assert.NotNull(decision);
        Assert.Equal(expectedPermit, decision!.IsPermitted);
        if (!expectedPermit)
        {
            Assert.Equal(PolicyReasonCode.PolicyDenied, decision.Reason);
        }
    }

    [Fact]
    public void UnknownAction_DeniesUnsupported()
    {
        var decision = _rule.Evaluate(Request("no.such.action", Roles.Admin));

        Assert.NotNull(decision);
        Assert.False(decision!.IsPermitted);
        Assert.Equal(PolicyReasonCode.Unsupported, decision.Reason);
    }

    [Theory]
    [InlineData("fleet.stop", Roles.Operator, true)]
    [InlineData("fleet.estop", Roles.Operator, true)]
    [InlineData("fleet.estop_reset", Roles.Operator, true)]
    [InlineData("fleet.stop", "(none)", false)]
    public void FleetStopEstopReset_RequireOperatorOrHigher(string action, string role, bool expectedPermit)
    {
        var decision = _rule.Evaluate(Request(action, role));

        Assert.NotNull(decision);
        Assert.Equal(expectedPermit, decision!.IsPermitted);
    }

    [Fact]
    public void ToWireCode_MapsEachReasonCodeToItsExactScreamingSnakeString()
    {
        Assert.Equal("OK", PolicyReasonCode.Ok.ToWireCode());
        Assert.Equal("NOT_READY", PolicyReasonCode.NotReady.ToWireCode());
        Assert.Equal("SAFETY_BLOCKED", PolicyReasonCode.SafetyBlocked.ToWireCode());
        Assert.Equal("POLICY_DENIED", PolicyReasonCode.PolicyDenied.ToWireCode());
        Assert.Equal("INVALID_ARGS", PolicyReasonCode.InvalidArgs.ToWireCode());
        Assert.Equal("UNSUPPORTED", PolicyReasonCode.Unsupported.ToWireCode());
        Assert.Equal("BUSY", PolicyReasonCode.Busy.ToWireCode());
    }
}
