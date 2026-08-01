using St4i.EngineApi.Policy;
using St4i.EngineApi.Policy.Rules;
using St4i.EngineApi.Safety;
using Xunit;

namespace St4i.EngineApi.Tests.Policy;

/// <summary>Task B-6 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-6-brief.md) — the
/// Critical-alarm decision, argued in <see cref="CriticalAlarmGuardRule"/>'s own doc comment: a write/command
/// is refused while ANY Critical alarm is active in the fleet, mirroring <c>LineController</c>'s existing
/// <c>line.start</c>/<c>line.unhold</c> gate. Never blocks HALT/reset or any pre-existing action (a High
/// alarm — e.g. the Identity-expiry alarm, deliberately capped there so it can never stop production — must
/// NOT reach this gate either; that is proven at the caller level, since this rule only ever consults the
/// ALREADY-RESOLVED <see cref="PolicyRequest.CriticalAlarmActive"/> boolean, never a raw alarm list).</summary>
public sealed class CriticalAlarmGuardRuleTests
{
    private readonly CriticalAlarmGuardRule _rule = new();

    private static PolicyRequest Request(string action, bool criticalAlarmActive) =>
        new(action, "Admin", "tester", new SafetySnapshot(EstopEngaged: false, IsRunning: false), criticalAlarmActive);

    [Fact]
    public void MachineSetpointWrite_CriticalAlarmActive_DeniesNotReady()
    {
        var decision = _rule.Evaluate(Request("machine.setpoint.write", criticalAlarmActive: true));

        Assert.NotNull(decision);
        Assert.False(decision!.IsPermitted);
        Assert.Equal(PolicyReasonCode.NotReady, decision.Reason);
    }

    [Fact]
    public void MachineSetpointWrite_NoCriticalAlarm_ReturnsNull_LetsRoleObligationDecide()
    {
        var decision = _rule.Evaluate(Request("machine.setpoint.write", criticalAlarmActive: false));
        Assert.Null(decision);
    }

    [Fact]
    public void MachineCommandInvoke_CriticalAlarmActive_DeniesNotReady()
    {
        var decision = _rule.Evaluate(Request("machine.command.invoke", criticalAlarmActive: true));

        Assert.NotNull(decision);
        Assert.False(decision!.IsPermitted);
        Assert.Equal(PolicyReasonCode.NotReady, decision.Reason);
    }

    [Fact]
    public void MachineCommandInvoke_NoCriticalAlarm_ReturnsNull()
    {
        var decision = _rule.Evaluate(Request("machine.command.invoke", criticalAlarmActive: false));
        Assert.Null(decision);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Never blocks HALT/reset or any pre-existing fleet/line action, regardless of CriticalAlarmActive —
    // this rule's blast radius is exactly the two new actions, nothing else.
    // ─────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("fleet.start")]
    [InlineData("fleet.stop")]
    [InlineData("fleet.estop")]
    [InlineData("fleet.estop_reset")]
    [InlineData("scenario.burst")]
    [InlineData("line.start")]
    [InlineData("line.unhold")]
    [InlineData("line.hold")]
    [InlineData("line.stop")]
    [InlineData("line.abort")]
    [InlineData("line.reset")]
    public void PreExistingActions_NeverBlocked_EvenWithCriticalAlarmActive(string action)
    {
        Assert.Null(_rule.Evaluate(Request(action, criticalAlarmActive: true)));
    }

    [Fact]
    public void UnknownAction_ReturnsNull_RegardlessOfCriticalAlarmState()
    {
        Assert.Null(_rule.Evaluate(Request("something.else", criticalAlarmActive: true)));
        Assert.Null(_rule.Evaluate(Request("something.else", criticalAlarmActive: false)));
    }
}
