using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;

namespace St4i.Connector.Conformance.Tests.Fakes;

/// <summary>
/// Task B-7 — the write-contract mirror of <c>FakeDriverHarnesses.cs</c>: one minimal, non-<c>[Fact]</c>-bearing
/// <see cref="DeviceDriverConformanceSuite"/> subclass per negative-control fake in <c>WritableFakeDrivers.cs</c>,
/// wiring the suite's write-contract hooks to that ONE fake. <see cref="DeviceDriverConformanceSuite.IsConformanceTarget"/>
/// is <see langword="false"/> on every one of these, for the identical reason the read-side harnesses are —
/// none of them wire every check, and none are meant to; <c>WriteNegativeControlTests</c> instantiates these
/// directly and calls the one check method each is meant to prove has teeth.
/// </summary>
internal abstract class WritableFakeDriverHarnessBase : DeviceDriverConformanceSuite
{
    protected override bool IsConformanceTarget => false;

    protected override Task<IReadOnlyList<DeviceReading>> CollectReadingsAsync(
        int count, TimeSpan timeout, Action<DeviceReading>? onYielded = null) =>
        CollectFromAsync(CreateDriver(), count, timeout, onYielded);

    /// <summary>Default: wraps <see cref="DeviceDriverConformanceSuite.CreateDriver"/>'s own fake with a
    /// no-op unstick and a constant-zero attempt counter — correct for a harness whose targeted check never
    /// actually calls <see cref="DeviceDriverConformanceSuite.CreateUnresponsiveWritableDeviceAsync"/>. A
    /// harness whose check DOES depend on genuinely-unresponsive/counting behaviour overrides this to expose
    /// its fake's own instrumented counter instead.</summary>
    protected override Task<UnresponsiveWritableDeviceSession> CreateUnresponsiveWritableDeviceAsync() =>
        Task.FromResult(new UnresponsiveWritableDeviceSession(
            (IWritableDeviceDriver)CreateDriver(), "point", 1.0, "command", null,
            static () => 0, TimeSpan.Zero, static () => Task.CompletedTask));
}

internal sealed class ThrowsOnTimeoutWritableHarness : WritableFakeDriverHarnessBase
{
    protected override IDeviceDriver CreateDriver() => new ThrowsOnTimeoutWritableFakeDriver();

    protected override Task<UnresponsiveWritableDeviceSession> CreateUnresponsiveWritableDeviceAsync() =>
        Task.FromResult(new UnresponsiveWritableDeviceSession(
            new ThrowsOnTimeoutWritableFakeDriver(), "point", 1.0, "command", null,
            static () => 0, TimeSpan.Zero, static () => Task.CompletedTask));
}

internal sealed class AlwaysSameDetailWritableHarness : WritableFakeDriverHarnessBase
{
    protected override IDeviceDriver CreateDriver() => new AlwaysSameDetailWritableFakeDriver();

    protected override Task<UnresponsiveWritableDeviceSession> CreateUnresponsiveWritableDeviceAsync() =>
        Task.FromResult(new UnresponsiveWritableDeviceSession(
            new AlwaysSameDetailWritableFakeDriver(), "point", 1.0, "command", null,
            static () => 0, TimeSpan.Zero, static () => Task.CompletedTask));
}

internal sealed class RetriesCommandOnTimeoutWritableHarness : WritableFakeDriverHarnessBase
{
    protected override IDeviceDriver CreateDriver() => new RetriesCommandOnTimeoutWritableFakeDriver();

    protected override Task<UnresponsiveWritableDeviceSession> CreateUnresponsiveWritableDeviceAsync()
    {
        var fake = new RetriesCommandOnTimeoutWritableFakeDriver();
        return Task.FromResult(new UnresponsiveWritableDeviceSession(
            fake, "point", 1.0, "command", null,
            () => fake.AttemptCount, TimeSpan.FromMilliseconds(200), static () => Task.CompletedTask));
    }
}

internal sealed class ConflatesSetpointAndCommandNamespacesHarness : WritableFakeDriverHarnessBase
{
    protected override IDeviceDriver CreateDriver() => new ConflatesSetpointAndCommandNamespacesFakeDriver();
}

internal sealed class AcceptsUnknownPointOrCommandHarness : WritableFakeDriverHarnessBase
{
    protected override IDeviceDriver CreateDriver() => new AcceptsUnknownPointOrCommandFakeDriver();
}

internal sealed class MutableCapabilityListHarness : WritableFakeDriverHarnessBase
{
    protected override IDeviceDriver CreateDriver() => new MutableCapabilityListFakeDriver();
}

internal sealed class IgnoresCancellationOnWriteHarness : WritableFakeDriverHarnessBase
{
    protected override IDeviceDriver CreateDriver() => new IgnoresCancellationOnWriteFakeDriver();

    protected override Task<UnresponsiveWritableDeviceSession> CreateUnresponsiveWritableDeviceAsync() =>
        Task.FromResult(new UnresponsiveWritableDeviceSession(
            new IgnoresCancellationOnWriteFakeDriver(), "point", 1.0, "command", null,
            static () => 0, TimeSpan.Zero, static () => Task.CompletedTask));
}

internal sealed class EmitsUnserializableWriteResultHarness : WritableFakeDriverHarnessBase
{
    protected override IDeviceDriver CreateDriver() => new EmitsUnserializableWriteResultFakeDriver();

    protected override Task<UnresponsiveWritableDeviceSession> CreateUnresponsiveWritableDeviceAsync() =>
        Task.FromResult(new UnresponsiveWritableDeviceSession(
            new EmitsUnserializableWriteResultFakeDriver(), "point", 1.0, "command", null,
            static () => 0, TimeSpan.Zero, static () => Task.CompletedTask));
}
