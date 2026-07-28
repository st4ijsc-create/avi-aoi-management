using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;

namespace St4i.Connector.Conformance.Tests.Fakes;

/// <summary>
/// GP-6 — one minimal, non-<c>[Fact]</c>-bearing <see cref="DeviceDriverConformanceSuite"/> subclass per
/// negative-control fake, wiring the suite's hooks to that ONE fake. Deliberately has NO <c>[Fact]</c>
/// methods of its own — see <see cref="DeviceDriverConformanceSuite"/>'s class doc comment for why a harness
/// wired to a known-non-conforming driver must never be auto-discovered/auto-run by xunit as an ordinary
/// test class; <c>NegativeControlTests</c> instantiates these directly and calls the one check method each
/// is meant to prove has teeth. <see cref="DeviceDriverConformanceSuite.IsConformanceTarget"/> is overridden
/// <see langword="false"/> on every one of these (task-6-report.md "Fix round 1", IMPORTANT 3) — none of them
/// wire every check, and none are meant to; that is not itself a conformance gap.
/// </summary>
internal sealed class ConnectsInConstructorHarness : DeviceDriverConformanceSuite
{
    // No ModelsExternalDeviceConnection override here — this harness only ever has
    // Check_Construction_IsNonBlocking_AndPerformsNoIO invoked against it, which DOES consult that flag (it
    // gates the check's second, "Health not already Connected" assertion — see
    // DeviceDriverConformanceSuite.ModelsExternalDeviceConnection's own doc comment, batch review fix 4).
    // Left at its default (true) deliberately: ConnectsInConstructorFakeDriver is exactly the device-backed
    // violation that second assertion exists to catch, so gating it away here would defeat this harness's
    // own purpose. task-6-report.md "Fix round 1" (IMPORTANT 2) flagged an earlier `=> false` override here
    // as an unjustified, unused example of the escape hatch — removed rather than left as a bad precedent.
    protected override bool IsConformanceTarget => false;

    protected override IDeviceDriver CreateDriver() => new ConnectsInConstructorFakeDriver();

    protected override Task<IReadOnlyList<DeviceReading>> CollectReadingsAsync(
        int count, TimeSpan timeout, Action<DeviceReading>? onYielded = null) =>
        CollectFromAsync(CreateDriver(), count, timeout, onYielded);
}

internal sealed class IgnoresCancellationHarness : DeviceDriverConformanceSuite
{
    protected override bool IsConformanceTarget => false;

    protected override IDeviceDriver CreateDriver() => new IgnoresCancellationFakeDriver();

    protected override Task<IReadOnlyList<DeviceReading>> CollectReadingsAsync(
        int count, TimeSpan timeout, Action<DeviceReading>? onYielded = null) =>
        CollectFromAsync(CreateDriver(), count, timeout, onYielded);
}

internal sealed class ReusesReadingInstanceHarness : DeviceDriverConformanceSuite
{
    protected override bool IsConformanceTarget => false;

    protected override IDeviceDriver CreateDriver() => new ReusesReadingInstanceFakeDriver();

    protected override Task<IReadOnlyList<DeviceReading>> CollectReadingsAsync(
        int count, TimeSpan timeout, Action<DeviceReading>? onYielded = null) =>
        CollectFromAsync(CreateDriver(), count, timeout, onYielded);
}

internal sealed class EmitsOutOfDomainTelemetryHarness : DeviceDriverConformanceSuite
{
    protected override bool IsConformanceTarget => false;

    protected override IDeviceDriver CreateDriver() => new EmitsOutOfDomainTelemetryFakeDriver();

    protected override Task<IReadOnlyList<DeviceReading>> CollectReadingsAsync(
        int count, TimeSpan timeout, Action<DeviceReading>? onYielded = null) =>
        CollectFromAsync(CreateDriver(), count, timeout, onYielded);
}

internal sealed class MutatesSharedTelemetryListHarness : DeviceDriverConformanceSuite
{
    protected override bool IsConformanceTarget => false;

    protected override IDeviceDriver CreateDriver() => new MutatesSharedTelemetryListFakeDriver();

    protected override Task<IReadOnlyList<DeviceReading>> CollectReadingsAsync(
        int count, TimeSpan timeout, Action<DeviceReading>? onYielded = null) =>
        CollectFromAsync(CreateDriver(), count, timeout, onYielded);
}

/// <summary>
/// GP-6 "Fix round 1" (IMPORTANT 1, the fully-isolating proof) — wired to
/// <see cref="TransientlyConnectedThenDownFakeDriver"/>, a device-backed fake whose <c>Health</c> is
/// <c>Connected</c> only for a short window at the start and <c>Down</c> by the time the check's drive
/// window ends — proving <c>sawConnected</c> is independently load-bearing (the check's final single-sample
/// assertion alone would miss this transient violation entirely).
/// </summary>
internal sealed class TransientlyConnectedThenDownHarness : DeviceDriverConformanceSuite
{
    protected override bool IsConformanceTarget => false;

    protected override IDeviceDriver CreateDriver() => new TransientlyConnectedThenDownFakeDriver();

    protected override Task<IReadOnlyList<DeviceReading>> CollectReadingsAsync(
        int count, TimeSpan timeout, Action<DeviceReading>? onYielded = null) =>
        CollectFromAsync(CreateDriver(), count, timeout, onYielded);
}

/// <summary>
/// GP-6 "Fix round 1" (IMPORTANT 2) — wired to <see cref="DeviceLessDriverWithDriftingHealthFakeDriver"/>,
/// a device-less driver (<see cref="ModelsExternalDeviceConnection"/> = <see langword="false"/>) whose
/// <see cref="IDeviceDriver.Health"/> DRIFTS away from the constant it implicitly claims — proving the
/// device-less Health branch's falsifiable assertion (against <see cref="ExpectedConstantHealthWhenDeviceLess"/>)
/// actually catches a violation, unlike the unfalsifiable before/after comparison it replaced.
/// </summary>
internal sealed class DeviceLessDriverWithDriftingHealthHarness : DeviceDriverConformanceSuite
{
    protected override bool IsConformanceTarget => false;

    protected override bool ModelsExternalDeviceConnection => false;

    protected override IDeviceDriver CreateDriver() => new DeviceLessDriverWithDriftingHealthFakeDriver();

    protected override Task<IReadOnlyList<DeviceReading>> CollectReadingsAsync(
        int count, TimeSpan timeout, Action<DeviceReading>? onYielded = null) =>
        CollectFromAsync(CreateDriver(), count, timeout, onYielded);
}
