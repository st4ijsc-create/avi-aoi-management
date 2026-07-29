using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers;
using St4i.EdgeCore.Drivers.HotFolder;
using St4i.EdgeCore.Drivers.Modbus;
using St4i.EdgeCore.Drivers.Mqtt;
using St4i.EdgeCore.Drivers.OpcUa;
using St4i.EdgeCore.Engine;
using Xunit;

namespace St4i.EdgeCore.Tests.Drivers;

/// <summary>
/// Task B-1 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-1-brief.md) — the acceptance
/// criterion "an existing read-only driver still satisfies IDeviceDriver with no changes" made concrete and
/// falsifiable: every one of the five built-in drivers named in <see cref="DriverKinds"/>
/// (<see cref="SimulatedDriver"/>, <see cref="HotFolderAoiDriver"/>, <see cref="MqttDriver"/>,
/// <see cref="ModbusTcpDriver"/>, <see cref="OpcUaDriver"/>) — plus <see cref="ScenarioAwareDriver"/>, the
/// actual wrapper <c>FleetHost</c> installs into the simulator slot — still implements ONLY
/// <see cref="IDeviceDriver"/>: none of them was touched by this task, and none of them accidentally already
/// satisfies the new, OPTIONAL <see cref="IWritableDeviceDriver"/> capability interface.
///
/// <para>This is a type-level reflection check, not a behavioural one, deliberately: <see cref="IWritableDeviceDriver"/>
/// exists to be tested for via <c>is</c>, never assumed, so a driver that silently started satisfying it
/// (e.g. by coincidentally declaring members with matching names/signatures during unrelated future work)
/// would be exactly as consequential as one that declared it deliberately — a host's capability check has no
/// way to tell the difference, and would start routing writes to a driver nobody decided should accept
/// them.</para>
///
/// <para>Positive control: <see cref="WritableFakeDriver"/> (declared in this file, never constructed —
/// existing only so the compiler/reflection surface is real) proves this check can actually detect the
/// capability when it IS present, so the six "does NOT satisfy" assertions below aren't vacuously true
/// because the check itself is broken.</para>
/// </summary>
public sealed class BuiltInDriversRemainReadOnlyTests
{
    [Theory]
    [InlineData(typeof(SimulatedDriver))]
    [InlineData(typeof(HotFolderAoiDriver))]
    [InlineData(typeof(MqttDriver))]
    [InlineData(typeof(ModbusTcpDriver))]
    [InlineData(typeof(OpcUaDriver))]
    [InlineData(typeof(ScenarioAwareDriver))]
    public void BuiltInDriver_ImplementsIDeviceDriver_ButNotIWritableDeviceDriver(Type driverType)
    {
        Assert.True(typeof(IDeviceDriver).IsAssignableFrom(driverType),
            $"{driverType.Name} must still implement IDeviceDriver — this task must not have touched it.");
        Assert.False(typeof(IWritableDeviceDriver).IsAssignableFrom(driverType),
            $"{driverType.Name} unexpectedly satisfies IWritableDeviceDriver — B-1 added an OPTIONAL " +
            "capability interface; no built-in driver should implement it yet (that is a later task's job).");
    }

    [Fact]
    public void PositiveControl_AFakeThatDoesImplementIWritableDeviceDriver_IsDetectedByTheSameCheck()
    {
        Assert.True(typeof(IWritableDeviceDriver).IsAssignableFrom(typeof(WritableFakeDriver)));
    }

    /// <summary>Exists ONLY to prove the reflection check above has teeth — never constructed, never
    /// exercised behaviourally (every member throws if it somehow ever were).</summary>
    private sealed class WritableFakeDriver : IWritableDeviceDriver
    {
        public string Id => throw new NotSupportedException();

        public string Kind => throw new NotSupportedException();

        public DriverHealthState Health => throw new NotSupportedException();

        public IReadOnlyList<string> WritablePoints => throw new NotSupportedException();

        public IReadOnlyList<string> Commands => throw new NotSupportedException();

        public IAsyncEnumerable<DeviceReading> ReadAsync(CancellationToken ct) => throw new NotSupportedException();

        public ValueTask DisposeAsync() => throw new NotSupportedException();

        public Task<SetpointWriteResult> WriteSetpointAsync(SetpointWriteRequest request, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<CommandResult> InvokeCommandAsync(CommandRequest request, CancellationToken ct) =>
            throw new NotSupportedException();
    }
}
