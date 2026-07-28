using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.Connector.Conformance;
using St4i.EdgeCore.Drivers;
using St4i.EdgeCore.Drivers.Simulators;
using St4i.EdgeCore.Models;
using Xunit;

namespace St4i.EdgeCore.Tests.Drivers;

/// <summary>
/// GP-6 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-6-brief.md) — runs the shared
/// <see cref="DeviceDriverConformanceSuite"/> against the real <see cref="SimulatedDriver"/>. Every check
/// passes — see task-6-report.md.
///
/// <para><see cref="SimulatedDriver"/> has no external device/connection concept at all (its own class doc
/// comment: "a pure in-process simulator has no external link to lose", <see cref="DriverHealthState.Connected"/>
/// always) — <see cref="ModelsExternalDeviceConnection"/> is overridden to <see langword="false"/> so the
/// Health check applies the invariant that DOES apply to it (Health never changes) rather than the
/// "must not report Connected with no device reachable" example that's specific to a device-BACKED
/// driver.</para>
/// </summary>
public sealed class SimulatedDriverConformanceTests : DeviceDriverConformanceSuite
{
    private static IMachineSimulator NewSim() =>
        new IotSensorSim(
            new MachineDescriptor("IOT-CONF-01", "SN-CONF", DeviceClass.Iot, "IOT_SENSOR", null, DriverKinds.Simulated, null, null, 0.02),
            seed: 123);

    protected override bool ModelsExternalDeviceConnection => false;

    protected override IDeviceDriver CreateDriver() => new SimulatedDriver(new[] { NewSim() });

    protected override Task<IReadOnlyList<DeviceReading>> CollectReadingsAsync(
        int count, TimeSpan timeout, Action<DeviceReading>? onYielded = null) =>
        CollectFromAsync(CreateDriver(), count, timeout, onYielded);

    [Fact]
    public Task Construction_IsNonBlocking_AndPerformsNoIO() => Check_Construction_IsNonBlocking_AndPerformsNoIO();

    [Fact]
    public Task Id_And_Kind_AreNonEmpty_AndStableAcrossLifetime() => Check_Id_And_Kind_AreNonEmpty_AndStableAcrossLifetime();

    [Fact]
    public Task Health_OnlyTakesDocumentedValues_AndIsSaneWithNoDevice() => Check_Health_OnlyTakesDocumentedValues_AndIsSaneWithNoDevice();

    [Fact]
    public Task ReadAsync_HonoursCancellation_WhenNoDeviceIsReachable() => Check_ReadAsync_HonoursCancellation_WhenNoDeviceIsReachable();

    [Fact]
    public Task DisposeAsync_IsIdempotent_WithoutEverEnumerating() => Check_DisposeAsync_IsIdempotent_WithoutEverEnumerating();

    [Fact]
    public Task DisposeAsync_IsIdempotent_AfterCancellation() => Check_DisposeAsync_IsIdempotent_AfterCancellation();

    [Fact]
    public Task DisposeAsync_IsIdempotent_AfterCompletedEnumeration() => Check_DisposeAsync_IsIdempotent_AfterCompletedEnumeration();

    [Fact]
    public Task ReadAsync_NeverReusesOrMutatesAYieldedReading() => Check_ReadAsync_NeverReusesOrMutatesAYieldedReading();

    [Fact]
    public Task Telemetry_RoundTripsLosslesslyThroughConnectorJson() => Check_Telemetry_RoundTripsLosslesslyThroughConnectorJson();
}
