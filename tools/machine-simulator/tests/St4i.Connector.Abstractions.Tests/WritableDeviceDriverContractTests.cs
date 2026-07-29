using System.Reflection;
using St4i.Connector.Abstractions.Models;
using Xunit;

namespace St4i.Connector.Abstractions.Tests;

/// <summary>
/// Task B-1 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-1-brief.md) —
/// <see cref="IWritableDeviceDriver"/> is the first contract in this assembly that lets a caller change a
/// real machine's physical state, so this suite proves the shape holds from the OUTSIDE: a third-party-style
/// implementation (this project references ONLY <c>St4i.Connector.Abstractions</c> itself, same isolation
/// <c>IConnectorFactoryTests</c> already establishes) can genuinely implement it, a host can genuinely test
/// for the capability without assuming it, and every documented outcome (including the one most products
/// hide — <see cref="WriteOutcome.Indeterminate"/>) is actually reachable.
/// </summary>
public class WritableDeviceDriverContractTests
{
    /// <summary>Keeps the contract's surface honest — the brief's own "every member is a permanent
    /// commitment" instruction, enforced structurally (mirrors
    /// <c>IConnectorFactoryTests.Contract_HasExactlyTwoMembers_KindAndTryCreate</c>) so a future addition has
    /// to consciously touch this assertion, not slip in silently.</summary>
    [Fact]
    public void Contract_DeclaresExactlyFourNewMembers()
    {
        var members = typeof(IWritableDeviceDriver).GetMembers(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly);
        var names = members.Select(m => m.Name).Where(n => !n.StartsWith("get_", StringComparison.Ordinal)).ToArray();

        Assert.Equal(
            new[] { "Commands", "InvokeCommandAsync", "WritablePoints", "WriteSetpointAsync" },
            names.OrderBy(n => n, StringComparer.Ordinal));
    }

    [Fact]
    public void Interface_ExtendsIDeviceDriver_SoACapabilityCheckWorksOnALiveDriverReference()
    {
        // Constraint #1: this is an OPTIONAL, SEPARATE interface, not a new member on IDeviceDriver — but it
        // still IS-A IDeviceDriver, so a host holding a plain IDeviceDriver reference can test for the
        // capability with a single `is` pattern match, exactly as the interface's own doc comment describes.
        Assert.True(typeof(IDeviceDriver).IsAssignableFrom(typeof(IWritableDeviceDriver)));
    }

    [Fact]
    public void ThirdPartyStyleWritableDriver_SatisfiesBothInterfaces_ViaPatternMatch()
    {
        IDeviceDriver driver = new ThirdPartyStyleWritableDriver();

        Assert.True(driver is IWritableDeviceDriver);
    }

    [Fact]
    public void ReadOnlyStyleDriver_DoesNotSatisfyIWritableDeviceDriver_NegativeControl()
    {
        // The optionality proof: every driver in this codebase today (and any third-party driver already
        // compiled against IDeviceDriver alone) must NOT accidentally satisfy IWritableDeviceDriver, and a
        // host's capability check must return false rather than throw or misbehave.
        IDeviceDriver driver = new ReadOnlyStyleDriver();

        Assert.False(driver is IWritableDeviceDriver);
    }

    [Fact]
    public async Task WriteSetpointAsync_UnknownPoint_RejectedBeforeTouchingTheDevice()
    {
        var driver = new ThirdPartyStyleWritableDriver();

        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest("does-not-exist", 1.0), CancellationToken.None);

        Assert.Equal(WriteOutcome.Rejected, result.Outcome);
        Assert.Equal(SetpointRejectionReason.UnknownPoint, result.RejectionReason);
        Assert.False(driver.DeviceWasTouched);
    }

    [Fact]
    public async Task WriteSetpointAsync_KnownPoint_Applied()
    {
        var driver = new ThirdPartyStyleWritableDriver();

        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest("speed", 42.0), CancellationToken.None);

        Assert.Equal(WriteOutcome.Applied, result.Outcome);
        Assert.Null(result.RejectionReason);
        Assert.True(driver.DeviceWasTouched);
    }

    [Fact]
    public async Task WriteSetpointAsync_SimulatedTimeout_ReturnsIndeterminate_AndIsNeverRetriedByTheDriverItself()
    {
        var driver = new ThirdPartyStyleWritableDriver { SimulateTimeout = true };

        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest("speed", 42.0), CancellationToken.None);

        Assert.Equal(WriteOutcome.Indeterminate, result.Outcome);
        Assert.Null(result.RejectionReason);
        Assert.NotNull(result.Detail);
        // The no-retry rule, made concrete: this test double records how many times it was actually asked
        // to touch the device — a single call in, a single attempt out, never a driver-internal retry loop.
        Assert.Equal(1, driver.WriteAttemptCount);
    }

    [Fact]
    public async Task InvokeCommandAsync_UnknownCommand_RejectedBeforeTouchingTheDevice()
    {
        var driver = new ThirdPartyStyleWritableDriver();

        var result = await driver.InvokeCommandAsync(new CommandRequest("does-not-exist"), CancellationToken.None);

        Assert.Equal(WriteOutcome.Rejected, result.Outcome);
        Assert.Equal(CommandRejectionReason.UnknownCommand, result.RejectionReason);
        Assert.False(driver.DeviceWasTouched);
    }

    [Fact]
    public async Task InvokeCommandAsync_KnownCommand_Applied_AndCanTriggerMotion()
    {
        var driver = new ThirdPartyStyleWritableDriver();

        var result = await driver.InvokeCommandAsync(new CommandRequest("start-cycle"), CancellationToken.None);

        Assert.Equal(WriteOutcome.Applied, result.Outcome);
        // The product owner's own framing for why this batch exists: a command can trigger real motion,
        // unlike a setpoint write — this test double models that as a distinct observable flag.
        Assert.True(driver.MotionTriggered);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fakes — written the way a vendor unfamiliar with this codebase's internals would write one: only
    // St4i.Connector.Abstractions itself is in reach (see this project's own csproj, mirroring
    // IConnectorFactoryTests).
    // ─────────────────────────────────────────────────────────────────────
    private sealed class ThirdPartyStyleWritableDriver : IWritableDeviceDriver
    {
        public bool SimulateTimeout { get; set; }

        public bool DeviceWasTouched { get; private set; }

        public bool MotionTriggered { get; private set; }

        public int WriteAttemptCount { get; private set; }

        public string Id => "widget:1";

        public string Kind => "vendor.acme.widget";

        public DriverHealthState Health => DriverHealthState.Connected;

        public IReadOnlyList<string> WritablePoints { get; } = new[] { "speed" };

        public IReadOnlyList<string> Commands { get; } = new[] { "start-cycle" };

        public IAsyncEnumerable<DeviceReading> ReadAsync(CancellationToken ct) =>
            throw new NotSupportedException("test double — ReadAsync is IDeviceDriver's own contract, not exercised here");

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;

        public Task<SetpointWriteResult> WriteSetpointAsync(SetpointWriteRequest request, CancellationToken ct)
        {
            WriteAttemptCount++;

            if (!WritablePoints.Contains(request.Point))
            {
                return Task.FromResult(new SetpointWriteResult(request.Point, WriteOutcome.Rejected, SetpointRejectionReason.UnknownPoint));
            }

            if (SimulateTimeout)
            {
                return Task.FromResult(new SetpointWriteResult(
                    request.Point, WriteOutcome.Indeterminate, Detail: "simulated write timeout — device state unknown"));
            }

            DeviceWasTouched = true;
            return Task.FromResult(new SetpointWriteResult(request.Point, WriteOutcome.Applied));
        }

        public Task<CommandResult> InvokeCommandAsync(CommandRequest request, CancellationToken ct)
        {
            if (!Commands.Contains(request.Command))
            {
                return Task.FromResult(new CommandResult(request.Command, WriteOutcome.Rejected, CommandRejectionReason.UnknownCommand));
            }

            DeviceWasTouched = true;
            MotionTriggered = true;
            return Task.FromResult(new CommandResult(request.Command, WriteOutcome.Applied));
        }
    }

    /// <summary>A read-only, third-party-style driver — implements ONLY <see cref="IDeviceDriver"/>, exactly
    /// like every existing built-in and third-party driver today. Used as the negative control proving
    /// optionality actually holds.</summary>
    private sealed class ReadOnlyStyleDriver : IDeviceDriver
    {
        public string Id => "sensor:1";

        public string Kind => "vendor.acme.sensor";

        public DriverHealthState Health => DriverHealthState.Connected;

        public IAsyncEnumerable<DeviceReading> ReadAsync(CancellationToken ct) =>
            throw new NotSupportedException("test double — not exercised here");

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
