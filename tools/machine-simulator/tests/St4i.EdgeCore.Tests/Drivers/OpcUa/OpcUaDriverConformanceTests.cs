using System.Net;
using System.Net.Sockets;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.Connector.Conformance;
using St4i.EdgeCore.Drivers.OpcUa;
using Xunit;

namespace St4i.EdgeCore.Tests.Drivers.OpcUa;

/// <summary>
/// GP-6 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-6-brief.md) — runs the shared
/// <see cref="DeviceDriverConformanceSuite"/> against the real <see cref="OpcUaDriver"/>. GP-6 originally
/// found that against a target that accepts the TCP connection but never responds at the OPC-UA protocol
/// level, <c>ReadAsync</c> did NOT honour cancellation within a realistic budget — the underlying
/// session/endpoint-selection call blocked for this driver's own configured
/// <c>TransportQuotas.OperationTimeout</c> (15 seconds, empirically confirmed) regardless of the caller's
/// token, 5x <c>FleetHost</c>'s 3-second teardown budget — see task-6-report.md for the original finding.
/// GP-6b (task-6b-report.md) fixed the root cause in <see cref="OpcUaDriver"/> itself (swapped the
/// blocking, uncancellable <c>CoreClientUtils.SelectEndpoint</c> for the token-accepting
/// <c>SelectEndpointAsync</c> overload), so every check — including cancellation — now passes as a normal
/// <c>[Fact]</c> with no acknowledged gaps.
///
/// <para>Serialized (via <see cref="OpcUaTestCollection"/>) against this task's sibling OPC-UA test classes,
/// same reasoning as <see cref="OpcUaDriverLoopbackTests"/>.</para>
/// </summary>
[Collection("St4i.EdgeCore.Tests.OpcUa")]
public sealed class OpcUaDriverConformanceTests : DeviceDriverConformanceSuite
{
    /// <summary>A definitely-closed loopback port, computed ONCE (not inside <see cref="CreateDriver"/>).
    /// Connecting here fails FAST, unlike <see cref="CreateUnresponsiveDeviceAsync"/>'s target below.</summary>
    private static readonly int ClosedPort = FindAndReleaseFreePort();

    private static int FindAndReleaseFreePort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    private static string NewPkiRoot(string tag) =>
        Path.Combine(Path.GetTempPath(), $"st4i-opcua-conf-{tag}-" + Guid.NewGuid().ToString("N")[..8]);

    protected override IDeviceDriver CreateDriver() =>
        new OpcUaDriver(
            OpcUaLoopbackHarness.BuildMap("PLC-CONFORMANCE-NODEVICE", $"opc.tcp://127.0.0.1:{ClosedPort}/nobody-home"),
            pkiDir: NewPkiRoot("nodevice"));

    /// <summary>A real, portable, loopback-only "silent" peer — accepts the TCP connection but never
    /// writes a byte back — rather than <see cref="CreateDriver"/>'s fast-failing closed port. See
    /// task-6-report.md for why this specific shape (not an external unroutable address) is what actually
    /// reproduces the realistic "device is unreachable and the driver is stuck retrying" failure mode this
    /// check exists to catch.</summary>
    protected override async Task<UnresponsiveDeviceSession> CreateUnresponsiveDeviceAsync()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;

        TcpClient? accepted = null;
        var acceptTask = Task.Run(async () =>
        {
            try { accepted = await listener.AcceptTcpClientAsync().ConfigureAwait(false); }
            catch { /* listener stopped during teardown — fine */ }
        });

        var driver = new OpcUaDriver(
            OpcUaLoopbackHarness.BuildMap("PLC-CONFORMANCE-SILENT", $"opc.tcp://127.0.0.1:{port}/silent"),
            pkiDir: NewPkiRoot("silent"));

        async Task ForceUnstickAsync()
        {
            try { await acceptTask.ConfigureAwait(false); } catch { }
            try { accepted?.Close(); } catch { }
            try { accepted?.Dispose(); } catch { }
            try { listener.Stop(); } catch { }
        }

        return new UnresponsiveDeviceSession(driver, ForceUnstickAsync);
    }

    protected override Task<IReadOnlyList<DeviceReading>> CollectReadingsAsync(
        int count, TimeSpan timeout, Action<DeviceReading>? onYielded = null) =>
        CollectFromLoopbackServerAsync(count, timeout, onYielded);

    private static async Task<IReadOnlyList<DeviceReading>> CollectFromLoopbackServerAsync(
        int count, TimeSpan timeout, Action<DeviceReading>? onYielded)
    {
        var pkiRoot = NewPkiRoot("readings");
        await using var testServer = await OpcUaLoopbackHarness.StartServerAsync(
            pkiRoot,
            new (string, object)[] { ("Temperature", 42.5), ("Status", "RUNNING") });

        await using var driver = new OpcUaDriver(
            OpcUaLoopbackHarness.BuildMap("PLC-CONFORMANCE-READINGS", testServer.EndpointUrl, pollIntervalMs: 100),
            pkiDir: pkiRoot);

        return await CollectFromAsync(driver, count, timeout, onYielded).ConfigureAwait(false);
    }

    [Fact]
    public Task Construction_IsNonBlocking_AndPerformsNoIO() => Check_Construction_IsNonBlocking_AndPerformsNoIO();

    [Fact]
    public Task Id_And_Kind_AreNonEmpty_AndStableAcrossLifetime() => Check_Id_And_Kind_AreNonEmpty_AndStableAcrossLifetime();

    [Fact]
    public Task Health_OnlyTakesDocumentedValues_AndIsSaneWithNoDevice() => Check_Health_OnlyTakesDocumentedValues_AndIsSaneWithNoDevice();

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

    /// <summary>GP-6b (task-6b-report.md) — GP-6's KnownGap pin promoted to the real, strict check now that
    /// <see cref="OpcUaDriver"/> is fixed: against a real, portable, loopback-only peer that accepts the TCP
    /// connection but never sends a single byte back, <c>ReadAsync</c> now ends within
    /// <see cref="DeviceDriverConformanceSuite.CancellationBudget"/> of the token being cancelled — swapping
    /// the blocking, uncancellable <c>CoreClientUtils.SelectEndpoint</c> sync call for the token-accepting
    /// <c>SelectEndpointAsync</c> overload closes the gap GP-6 originally pinned as broken.</summary>
    [Fact]
    public Task ReadAsync_HonoursCancellation_WhenNoDeviceIsReachable() => Check_ReadAsync_HonoursCancellation_WhenNoDeviceIsReachable();
}
