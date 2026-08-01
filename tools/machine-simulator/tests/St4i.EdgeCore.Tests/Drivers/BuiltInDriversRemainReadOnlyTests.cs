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
/// falsifiable: every one of the STILL-read-only built-in drivers named in <see cref="DriverKinds"/>
/// (<see cref="SimulatedDriver"/>, <see cref="HotFolderAoiDriver"/>, <see cref="MqttDriver"/>) — plus
/// <see cref="ScenarioAwareDriver"/>, the actual wrapper <c>FleetHost</c> installs into the simulator slot —
/// still implements ONLY <see cref="IDeviceDriver"/>: none of them was touched by this task, and none of
/// them accidentally already satisfies the new, OPTIONAL <see cref="IWritableDeviceDriver"/> capability
/// interface.
///
/// <para>This is a type-level reflection check, not a behavioural one, deliberately: <see cref="IWritableDeviceDriver"/>
/// exists to be tested for via <c>is</c>, never assumed, so a driver that silently started satisfying it
/// (e.g. by coincidentally declaring members with matching names/signatures during unrelated future work)
/// would be exactly as consequential as one that declared it deliberately — a host's capability check has no
/// way to tell the difference, and would start routing writes to a driver nobody decided should accept
/// them.</para>
///
/// <para><b>Task B-4 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-4-brief.md) —
/// <see cref="ModbusTcpDriver"/> REMOVED from the "stays read-only" list above, DELIBERATELY.</b> B-4's own
/// job is to make this driver implement <see cref="IWritableDeviceDriver"/> for real (setpoint write + coil
/// pulse) — B-1's original assertion that it did NOT was pinning a fact that was only ever true "until B-4",
/// never a permanent invariant. <see cref="ModbusTcpDriver_NowImplementsIWritableDeviceDriver_Deliberately"/>
/// below is the mirror-image positive proof this flip actually happened, using the SAME reflection check.</para>
///
/// <para><b>Task B-5 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-5-brief.md) —
/// <see cref="OpcUaDriver"/> ALSO removed from the "stays read-only" list above, for the identical reason:
/// this task makes it implement <see cref="IWritableDeviceDriver"/> for real (setpoint <c>WriteAsync</c> +
/// command <c>CallAsync</c>).</b> <see cref="OpcUaDriver_NowImplementsIWritableDeviceDriver_Deliberately"/>
/// below mirrors <see cref="ModbusTcpDriver_NowImplementsIWritableDeviceDriver_Deliberately"/> exactly.</para>
///
/// <para>Positive control: <see cref="WritableFakeDriver"/> (declared in this file, never constructed —
/// existing only so the compiler/reflection surface is real) proves this check can actually detect the
/// capability when it IS present, so the "does NOT satisfy" assertions below aren't vacuously true because
/// the check itself is broken.</para>
/// </summary>
public sealed class BuiltInDriversRemainReadOnlyTests
{
    [Theory]
    [InlineData(typeof(SimulatedDriver))]
    [InlineData(typeof(HotFolderAoiDriver))]
    [InlineData(typeof(MqttDriver))]
    [InlineData(typeof(ScenarioAwareDriver))]
    public void BuiltInDriver_ImplementsIDeviceDriver_ButNotIWritableDeviceDriver(Type driverType)
    {
        Assert.True(typeof(IDeviceDriver).IsAssignableFrom(driverType),
            $"{driverType.Name} must still implement IDeviceDriver — this task must not have touched it.");
        Assert.False(typeof(IWritableDeviceDriver).IsAssignableFrom(driverType),
            $"{driverType.Name} unexpectedly satisfies IWritableDeviceDriver — no built-in driver other than " +
            "ModbusTcpDriver (B-4) / OpcUaDriver (B-5) should implement it.");
    }

    /// <summary>Task B-4 — the deliberate mirror-image of the check above: <see cref="ModbusTcpDriver"/> NOW
    /// satisfies <see cref="IWritableDeviceDriver"/>, on purpose, and this is the falsifiable proof of it —
    /// the SAME reflection check the "does NOT satisfy" theory above uses, just asserting the opposite for
    /// the one driver this task changed.</summary>
    [Fact]
    public void ModbusTcpDriver_NowImplementsIWritableDeviceDriver_Deliberately()
    {
        Assert.True(typeof(IDeviceDriver).IsAssignableFrom(typeof(ModbusTcpDriver)));
        Assert.True(typeof(IWritableDeviceDriver).IsAssignableFrom(typeof(ModbusTcpDriver)),
            "ModbusTcpDriver must implement IWritableDeviceDriver — this is B-4's own deliverable.");
    }

    /// <summary>Task B-5 — the identical mirror-image proof for <see cref="OpcUaDriver"/>: it NOW satisfies
    /// <see cref="IWritableDeviceDriver"/>, on purpose (setpoint <c>WriteAsync</c> + command <c>CallAsync</c>),
    /// using the SAME reflection check.</summary>
    [Fact]
    public void OpcUaDriver_NowImplementsIWritableDeviceDriver_Deliberately()
    {
        Assert.True(typeof(IDeviceDriver).IsAssignableFrom(typeof(OpcUaDriver)));
        Assert.True(typeof(IWritableDeviceDriver).IsAssignableFrom(typeof(OpcUaDriver)),
            "OpcUaDriver must implement IWritableDeviceDriver — this is B-5's own deliverable.");
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
