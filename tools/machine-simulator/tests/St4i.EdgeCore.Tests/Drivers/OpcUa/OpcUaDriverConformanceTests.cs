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
/// <see cref="DeviceDriverConformanceSuite"/> against the real <see cref="OpcUaDriver"/>. See
/// task-6-report.md for the one real finding this surfaced: against a target that accepts the TCP
/// connection but never responds at the OPC-UA protocol level, <c>ReadAsync</c> does NOT honour
/// cancellation within a realistic budget — the underlying session/endpoint-selection call blocks for
/// this driver's own configured <c>TransportQuotas.OperationTimeout</c> (15 seconds, empirically confirmed)
/// regardless of the caller's token, which is 5x <c>FleetHost</c>'s 3-second teardown budget. That ONE check
/// is therefore NOT wired up as a passing <c>[Fact]</c> here — see
/// <see cref="KnownGap_ReadAsync_DoesNotHonourCancellation_AgainstAProtocolSilentPeer"/>, which pins the
/// actual observed behaviour instead of silently passing or silently omitting it. Every other check passes.
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

    // Check_ReadAsync_HonoursCancellation_WhenNoDeviceIsReachable is deliberately NOT wired up here as a
    // passing [Fact] — see this class's own doc comment and the KNOWN GAP test below.

    /// <summary>
    /// KNOWN GAP (task-6-report.md) — pins the CURRENT, observed-broken behaviour rather than silently
    /// passing or silently omitting it: against a real, portable, loopback-only peer that accepts the TCP
    /// connection but never sends a single byte back, <see cref="OpcUaDriver.ReadAsync"/> does NOT end
    /// within <see cref="DeviceDriverConformanceSuite.CancellationBudget"/> of the token being cancelled.
    /// Empirically measured (task-6-report.md): the session/endpoint-selection path blocks for this driver's
    /// own configured 15-second <c>TransportQuotas.OperationTimeout</c> regardless of cancellation — bounded,
    /// unlike Modbus's finding, but still 5x <c>FleetHost</c>'s 3-second teardown budget. This test goes red
    /// the moment that changes — either regressing further, or (hopefully) getting fixed, at which point
    /// promote OpcUaDriver onto the strict
    /// <see cref="DeviceDriverConformanceSuite.Check_ReadAsync_HonoursCancellation_WhenNoDeviceIsReachable"/>
    /// check like the other two drivers.
    /// </summary>
    [Fact]
    public async Task KnownGap_ReadAsync_DoesNotHonourCancellation_AgainstAProtocolSilentPeer()
    {
        var session = await CreateUnresponsiveDeviceAsync();
        try
        {
            using var cts = new CancellationTokenSource();
            var runTask = DriveAsync(session.Driver, cts.Token);

            await Task.Delay(TimeSpan.FromMilliseconds(500));
            cts.Cancel();

            var finishedInTime = await Task.WhenAny(runTask, Task.Delay(CancellationBudget)) == runTask;

            Assert.False(
                finishedInTime,
                $"OpcUaDriver.ReadAsync ended within {CancellationBudget} of cancellation against a " +
                "protocol-silent peer — this contradicts task-6-report.md's finding. If this is now " +
                "genuinely fixed, promote OpcUaDriver onto the strict shared cancellation check and delete " +
                "this pinning test.");
        }
        finally
        {
            await session.ForceUnstickAsync();
            await session.Driver.DisposeAsync();
        }
    }

    private static async Task DriveAsync(IDeviceDriver driver, CancellationToken ct)
    {
        try
        {
            await foreach (var _ in driver.ReadAsync(ct)) { }
        }
        catch (OperationCanceledException) { }
    }
}
