using System.Net;
using System.Net.Sockets;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.Connector.Conformance;
using St4i.EdgeCore.Drivers.Modbus;
using Xunit;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// GP-6 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-6-brief.md) — runs the shared
/// <see cref="DeviceDriverConformanceSuite"/> against the real <see cref="ModbusTcpDriver"/>. See
/// task-6-report.md for the one real finding this surfaced: against a target that accepts the TCP
/// connection but never responds at the Modbus protocol level, <c>ReadAsync</c> does NOT honour
/// cancellation — <c>NModbus</c>'s <c>ReadHoldingRegistersAsync</c> call takes no
/// <see cref="CancellationToken"/> and (empirically measured) has no bounded internal timeout either, so a
/// silent/unresponsive peer can hang the poll loop indefinitely, un-cancellable. That ONE check is therefore
/// NOT wired up as a passing <c>[Fact]</c> here — see <see cref="KnownGap_ReadAsync_DoesNotHonourCancellation_AgainstAProtocolSilentPeer"/>,
/// which pins the actual observed behaviour instead of silently passing or silently omitting it. Every other
/// check passes.
/// </summary>
public sealed class ModbusTcpDriverConformanceTests : DeviceDriverConformanceSuite
{
    /// <summary>Declares the ONE check this class deliberately does not wire as a passing <c>[Fact]</c> —
    /// see <see cref="KnownGap_ReadAsync_DoesNotHonourCancellation_AgainstAProtocolSilentPeer"/> and this
    /// class's own doc comment. Required since GP-6 "Fix round 1" (IMPORTANT 3): without this,
    /// <see cref="DeviceDriverConformanceSuite.EveryCheckIsWiredOrAcknowledged"/> would flag the omission as
    /// silent/undeclared instead of a reported finding.</summary>
    protected override ISet<string> AcknowledgedGaps { get; } =
        new HashSet<string> { "ReadAsync_HonoursCancellation_WhenNoDeviceIsReachable" };

    /// <summary>A definitely-closed loopback port, computed ONCE (not inside <see cref="CreateDriver"/> —
    /// see that hook's own doc comment on why setup work must stay outside the timed construction call).
    /// Connecting here fails FAST (instant RST), unlike <see cref="CreateUnresponsiveDeviceAsync"/>'s
    /// target below.</summary>
    private static readonly int ClosedPort = FindAndReleaseFreePort();

    private static int FindAndReleaseFreePort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    protected override IDeviceDriver CreateDriver() =>
        new ModbusTcpDriver("127.0.0.1", ClosedPort, ModbusLoopbackHarness.BuildMap("PLC-CONFORMANCE-NODEVICE"));

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

        var driver = new ModbusTcpDriver("127.0.0.1", port, ModbusLoopbackHarness.BuildMap("PLC-CONFORMANCE-SILENT"));

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
        CollectFromLoopbackSlaveAsync(count, timeout, onYielded);

    private static async Task<IReadOnlyList<DeviceReading>> CollectFromLoopbackSlaveAsync(
        int count, TimeSpan timeout, Action<DeviceReading>? onYielded)
    {
        await using var slave = ModbusLoopbackHarness.Start();
        await using var driver = new ModbusTcpDriver("127.0.0.1", slave.Port, ModbusLoopbackHarness.BuildMap("PLC-CONFORMANCE-READINGS", pollIntervalMs: 20));
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
    /// connection but never sends a single byte back, <see cref="ModbusTcpDriver.ReadAsync"/> does NOT end
    /// within <see cref="DeviceDriverConformanceSuite.CancellationBudget"/> of the token being cancelled.
    /// Empirically measured (task-6-report.md): the underlying <c>NModbus</c>
    /// <c>IModbusMaster.ReadHoldingRegistersAsync</c> call in <c>ModbusTcpDriver.PollOnceAsync</c> takes no
    /// <see cref="CancellationToken"/> at all and did not return within 30+ seconds against a silent peer in
    /// this same test run — i.e. this can hang INDEFINITELY, un-cancellable, far beyond
    /// <c>FleetHost</c>'s 3-second teardown budget. This test goes red the moment that changes — either
    /// regressing further, or (hopefully) getting fixed, at which point promote ModbusTcpDriver onto the
    /// strict <see cref="DeviceDriverConformanceSuite.Check_ReadAsync_HonoursCancellation_WhenNoDeviceIsReachable"/>
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
                $"ModbusTcpDriver.ReadAsync ended within {CancellationBudget} of cancellation against a " +
                "protocol-silent peer — this contradicts task-6-report.md's finding. If this is now " +
                "genuinely fixed, promote ModbusTcpDriver onto the strict shared cancellation check and " +
                "delete this pinning test.");
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
