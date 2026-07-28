using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;

namespace St4i.Connector.Conformance.Tests.Fakes;

/// <summary>
/// GP-6 — one minimal, non-<c>[Fact]</c>-bearing <see cref="DeviceDriverConformanceSuite"/> subclass per
/// negative-control fake, wiring the suite's hooks to that ONE fake. Deliberately has NO <c>[Fact]</c>
/// methods of its own — see <see cref="DeviceDriverConformanceSuite"/>'s class doc comment for why a harness
/// wired to a known-non-conforming driver must never be auto-discovered/auto-run by xunit as an ordinary
/// test class; <c>NegativeControlTests</c> instantiates these directly and calls the one check method each
/// is meant to prove has teeth.
/// </summary>
internal sealed class ConnectsInConstructorHarness : DeviceDriverConformanceSuite
{
    protected override bool ModelsExternalDeviceConnection => false;

    protected override IDeviceDriver CreateDriver() => new ConnectsInConstructorFakeDriver();

    protected override Task<IReadOnlyList<DeviceReading>> CollectReadingsAsync(
        int count, TimeSpan timeout, Action<DeviceReading>? onYielded = null) =>
        CollectFromAsync(CreateDriver(), count, timeout, onYielded);
}

internal sealed class IgnoresCancellationHarness : DeviceDriverConformanceSuite
{
    protected override IDeviceDriver CreateDriver() => new IgnoresCancellationFakeDriver();

    protected override Task<IReadOnlyList<DeviceReading>> CollectReadingsAsync(
        int count, TimeSpan timeout, Action<DeviceReading>? onYielded = null) =>
        CollectFromAsync(CreateDriver(), count, timeout, onYielded);
}

internal sealed class ReusesReadingInstanceHarness : DeviceDriverConformanceSuite
{
    protected override IDeviceDriver CreateDriver() => new ReusesReadingInstanceFakeDriver();

    protected override Task<IReadOnlyList<DeviceReading>> CollectReadingsAsync(
        int count, TimeSpan timeout, Action<DeviceReading>? onYielded = null) =>
        CollectFromAsync(CreateDriver(), count, timeout, onYielded);
}

internal sealed class EmitsOutOfDomainTelemetryHarness : DeviceDriverConformanceSuite
{
    protected override IDeviceDriver CreateDriver() => new EmitsOutOfDomainTelemetryFakeDriver();

    protected override Task<IReadOnlyList<DeviceReading>> CollectReadingsAsync(
        int count, TimeSpan timeout, Action<DeviceReading>? onYielded = null) =>
        CollectFromAsync(CreateDriver(), count, timeout, onYielded);
}

internal sealed class MutatesSharedTelemetryListHarness : DeviceDriverConformanceSuite
{
    protected override IDeviceDriver CreateDriver() => new MutatesSharedTelemetryListFakeDriver();

    protected override Task<IReadOnlyList<DeviceReading>> CollectReadingsAsync(
        int count, TimeSpan timeout, Action<DeviceReading>? onYielded = null) =>
        CollectFromAsync(CreateDriver(), count, timeout, onYielded);
}
