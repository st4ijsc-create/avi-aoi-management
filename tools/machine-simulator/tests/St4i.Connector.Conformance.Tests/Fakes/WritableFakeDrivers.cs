using St4i.Connector.Abstractions.Models;

namespace St4i.Connector.Conformance.Tests.Fakes;

/// <summary>
/// Task B-7 negative control — deliberately violates "a timed-out write returns Indeterminate; it does not
/// throw" (the single most consequential invariant in the write contract, per task-7-brief.md) by letting a
/// simulated internal timeout propagate as a thrown exception instead. Proves
/// <see cref="DeviceDriverConformanceSuite.Check_Write_TimedOutWriteOrCommand_ReturnsIndeterminate_NeverThrows"/>
/// genuinely rejects a driver that does this — see <c>WriteNegativeControlTests</c>.
/// </summary>
internal sealed class ThrowsOnTimeoutWritableFakeDriver : WritableFakeDriverBase
{
    public override async Task<SetpointWriteResult> WriteSetpointAsync(SetpointWriteRequest request, CancellationToken ct)
    {
        await Task.Delay(TimeSpan.FromMilliseconds(50), CancellationToken.None);
        throw new TimeoutException("simulated device timeout — this fake exists to violate 'never throws'.");
    }

    public override async Task<CommandResult> InvokeCommandAsync(CommandRequest request, CancellationToken ct)
    {
        await Task.Delay(TimeSpan.FromMilliseconds(50), CancellationToken.None);
        throw new TimeoutException("simulated device timeout — this fake exists to violate 'never throws'.");
    }
}

/// <summary>
/// Task B-7 negative control — deliberately violates "Indeterminate's Detail tells an operator what to
/// check" by funnelling EVERY Indeterminate cause through the exact same canned message, regardless of
/// whether the cause was a genuine (uncancelled) timeout or a caller-initiated cancellation — reproducing,
/// in miniature, the B-4 regression shape task-7-brief.md calls out (a generic message silently replacing a
/// genuinely situational one). Deliberately ignores <paramref name="ct"/> entirely so the SAME code path
/// (and therefore the SAME Detail) is reached either way. Proves
/// <see cref="DeviceDriverConformanceSuite.Check_Write_Indeterminate_DetailIsNonEmpty_AndDistinguishesDistinctCauses"/>
/// genuinely rejects a driver that does this.
/// </summary>
internal sealed class AlwaysSameDetailWritableFakeDriver : WritableFakeDriverBase
{
    public override async Task<SetpointWriteResult> WriteSetpointAsync(SetpointWriteRequest request, CancellationToken ct)
    {
        await Task.Delay(TimeSpan.FromMilliseconds(50), CancellationToken.None);
        return new SetpointWriteResult(request.Point, WriteOutcome.Indeterminate, Detail: "write may not have applied");
    }

    // Also Indeterminate + the SAME canned Detail for InvokeCommandAsync — the check compares BOTH
    // operations (task-7-brief.md's own coil example is a COMMAND, not a setpoint), so this fake must
    // violate the invariant on this operation too, not merely fail it via an unrelated "wrong outcome"
    // assertion the base class's conforming default would otherwise trip first.
    public override async Task<CommandResult> InvokeCommandAsync(CommandRequest request, CancellationToken ct)
    {
        await Task.Delay(TimeSpan.FromMilliseconds(50), CancellationToken.None);
        return new CommandResult(request.Command, WriteOutcome.Indeterminate, Detail: "write may not have applied");
    }
}

/// <summary>
/// Task B-7 negative control — deliberately violates "No implicit retries, ever, for any reason, including a
/// timeout" by internally re-attempting the command once before giving up, standing in for exactly the class
/// of bug task-4-report.md found: a TRANSPORT LAYER underneath a driver's own code silently resending an
/// unacknowledged write, invisible to the driver itself. <see cref="AttemptCount"/> is the externally-observable
/// counter <see cref="DeviceDriverConformanceSuite.UnresponsiveWritableDeviceSession.CommandAttemptsReachingDevice"/>
/// reads — exactly the kind of "count taken from OUTSIDE the driver" the real check needs, since a driver's
/// own return value alone cannot prove a retry did NOT happen. Proves
/// <see cref="DeviceDriverConformanceSuite.Check_Write_NoImplicitRetry_ExactlyOneCommandAttemptReachesTheDeviceOnTimeout"/>
/// genuinely rejects a driver whose underlying transport retries.
/// </summary>
internal sealed class RetriesCommandOnTimeoutWritableFakeDriver : WritableFakeDriverBase
{
    private int _attempts;

    public int AttemptCount => Volatile.Read(ref _attempts);

    public override async Task<CommandResult> InvokeCommandAsync(CommandRequest request, CancellationToken ct)
    {
        Interlocked.Increment(ref _attempts);
        await Task.Delay(TimeSpan.FromMilliseconds(20), CancellationToken.None);

        // The violation itself: a second attempt, exactly like a transport-level retry the driver's own code
        // never decided to make and cannot see.
        Interlocked.Increment(ref _attempts);
        await Task.Delay(TimeSpan.FromMilliseconds(20), CancellationToken.None);

        return new CommandResult(request.Command, WriteOutcome.Indeterminate, Detail: "timed out after a silent retry.");
    }
}

/// <summary>
/// Task B-7 negative control — deliberately violates "Setpoint write and command invocation are two distinct
/// operations... a command must not be invocable through the setpoint member or vice versa" by accepting a
/// COMMAND's own declared name as though it were a valid setpoint <c>Point</c>. Proves
/// <see cref="DeviceDriverConformanceSuite.Check_Write_SetpointAndCommandNamespaces_AreDistinct"/> genuinely
/// rejects a driver that conflates the two namespaces.
/// </summary>
internal sealed class ConflatesSetpointAndCommandNamespacesFakeDriver : WritableFakeDriverBase
{
    public override Task<SetpointWriteResult> WriteSetpointAsync(SetpointWriteRequest request, CancellationToken ct)
    {
        if (Commands.Contains(request.Point, StringComparer.Ordinal))
        {
            // The violation: a command's own name, accepted through the SETPOINT member.
            return Task.FromResult(new SetpointWriteResult(request.Point, WriteOutcome.Applied));
        }

        return base.WriteSetpointAsync(request, ct);
    }
}

/// <summary>
/// Task B-7 negative control — deliberately violates "Points are named, never addresses; an unknown point is
/// Rejected, not attempted" (and its InvokeCommandAsync mirror) by accepting ANY point/command name at all,
/// never rejecting one it does not recognise. Proves
/// <see cref="DeviceDriverConformanceSuite.Check_Write_UnknownPointOrCommand_RejectedWithoutTouchingDevice"/>
/// genuinely rejects a driver that does this.
/// </summary>
internal sealed class AcceptsUnknownPointOrCommandFakeDriver : WritableFakeDriverBase
{
    public override Task<SetpointWriteResult> WriteSetpointAsync(SetpointWriteRequest request, CancellationToken ct) =>
        Task.FromResult(new SetpointWriteResult(request.Point, WriteOutcome.Applied));

    public override Task<CommandResult> InvokeCommandAsync(CommandRequest request, CancellationToken ct) =>
        Task.FromResult(new CommandResult(request.Command, WriteOutcome.Applied));
}

/// <summary>
/// Task B-7 negative control — reproduces task-4-report.md's exact shipped shape: hands out the underlying
/// mutable <c>List&lt;string&gt;</c> itself, merely reference-typed as <c>IReadOnlyList&lt;string&gt;</c>,
/// rather than an effectively-immutable wrapper. Proves
/// <see cref="DeviceDriverConformanceSuite.Check_Write_CapabilityLists_AreEffectivelyImmutable"/> genuinely
/// rejects a driver that does this.
/// </summary>
internal sealed class MutableCapabilityListFakeDriver : WritableFakeDriverBase
{
    private readonly List<string> _points = new() { "point" };
    private readonly List<string> _commands = new() { "command" };

    public override IReadOnlyList<string> WritablePoints => _points;

    public override IReadOnlyList<string> Commands => _commands;
}

/// <summary>
/// Task B-7 negative control — deliberately violates "Cancellation must be honoured promptly" by never
/// observing <paramref name="ct"/> at all — the write-contract mirror of
/// <see cref="IgnoresCancellationFakeDriver"/>. The delay is finite (not <see cref="Timeout.Infinite"/>)
/// purely so this fake's own background work eventually winds down on its own, same reasoning as that
/// fake's own doc comment. Proves
/// <see cref="DeviceDriverConformanceSuite.Check_Write_Cancellation_HonouredPromptly_EvenAgainstAnUnresponsiveDevice"/>
/// genuinely rejects a driver that does this.
/// </summary>
internal sealed class IgnoresCancellationOnWriteFakeDriver : WritableFakeDriverBase
{
    public override async Task<SetpointWriteResult> WriteSetpointAsync(SetpointWriteRequest request, CancellationToken ct)
    {
        // Deliberately does NOT pass ct here — the conformance violation under test.
        await Task.Delay(TimeSpan.FromSeconds(20), CancellationToken.None);
        return new SetpointWriteResult(request.Point, WriteOutcome.Indeterminate, Detail: "gave up waiting on its own, eventually.");
    }
}

/// <summary>
/// Task B-7 negative control — deliberately violates "Every result round-trips losslessly through
/// ConnectorJson" by embedding a lone (unpaired) UTF-16 surrogate in <c>Detail</c>. This does NOT throw on
/// serialize — <see cref="System.Text.Json"/> silently substitutes U+FFFD for an unpaired surrogate rather
/// than rejecting it — so the violation is only visible by comparing round-tripped CONTENT, not by any
/// exception: exactly the "absence of information silently deserialising to something else" shape B-1's own
/// zero-value defect was. Proves
/// <see cref="DeviceDriverConformanceSuite.Check_Write_RoundTripsLosslesslyThroughConnectorJson"/> genuinely
/// rejects a driver that does this.
/// </summary>
internal sealed class EmitsUnserializableWriteResultFakeDriver : WritableFakeDriverBase
{
    public override Task<SetpointWriteResult> WriteSetpointAsync(SetpointWriteRequest request, CancellationToken ct)
    {
        if (!WritablePoints.Contains(request.Point, StringComparer.Ordinal))
        {
            return base.WriteSetpointAsync(request, ct);
        }

        // The violation: a lone high surrogate with no matching low surrogate — legal as a raw CLR string,
        // silently mangled (never thrown) by System.Text.Json on serialize.
        return Task.FromResult(new SetpointWriteResult(request.Point, WriteOutcome.Indeterminate, Detail: "bad:\uD800:end"));
    }
}
