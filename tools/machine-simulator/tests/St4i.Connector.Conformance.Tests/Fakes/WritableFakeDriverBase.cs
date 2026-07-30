using System.Runtime.CompilerServices;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;

namespace St4i.Connector.Conformance.Tests.Fakes;

/// <summary>
/// Task B-7 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-7-brief.md) — the shared
/// scaffolding every write-contract negative-control fake in this file group needs (a working <see
/// cref="IDeviceDriver"/> read-side it never actually exercises, and a CORRECTLY-BEHAVING default
/// <see cref="WriteSetpointAsync"/>/<see cref="InvokeCommandAsync"/> pair), so each concrete fake below can
/// override ONLY the one member it exists to violate — exactly the "one fake, one violation, one check it
/// targets" discipline task-7-brief.md calls for. None of the write-contract checks this task adds ever call
/// <see cref="ReadAsync"/>, so it is a permanently-empty enumerable, never exercised.
/// </summary>
internal abstract class WritableFakeDriverBase : IWritableDeviceDriver
{
    public virtual string Id => $"fake:{GetType().Name}";

    public virtual string Kind => "fake.writable";

    public virtual DriverHealthState Health => DriverHealthState.Connected;

    public virtual IReadOnlyList<string> WritablePoints { get; } = new List<string> { "point" }.AsReadOnly();

    public virtual IReadOnlyList<string> Commands { get; } = new List<string> { "command" }.AsReadOnly();

    public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
    {
        await Task.CompletedTask;
        yield break;
    }

    public virtual ValueTask DisposeAsync() => ValueTask.CompletedTask;

    /// <summary>Correctly rejects an unknown point, correctly applies a known one — the CONFORMING default a
    /// fake only overrides when a setpoint write specifically is what it exists to violate.</summary>
    public virtual Task<SetpointWriteResult> WriteSetpointAsync(SetpointWriteRequest request, CancellationToken ct)
    {
        if (!WritablePoints.Contains(request.Point, StringComparer.Ordinal))
        {
            return Task.FromResult(new SetpointWriteResult(
                request.Point, WriteOutcome.Rejected, SetpointRejectionReason.UnknownPoint, $"'{request.Point}' is unknown."));
        }

        return Task.FromResult(new SetpointWriteResult(request.Point, WriteOutcome.Applied));
    }

    /// <summary>The <see cref="InvokeCommandAsync"/> mirror of <see cref="WriteSetpointAsync"/>'s own
    /// conforming default.</summary>
    public virtual Task<CommandResult> InvokeCommandAsync(CommandRequest request, CancellationToken ct)
    {
        if (!Commands.Contains(request.Command, StringComparer.Ordinal))
        {
            return Task.FromResult(new CommandResult(
                request.Command, WriteOutcome.Rejected, CommandRejectionReason.UnknownCommand, $"'{request.Command}' is unknown."));
        }

        return Task.FromResult(new CommandResult(request.Command, WriteOutcome.Applied));
    }
}
