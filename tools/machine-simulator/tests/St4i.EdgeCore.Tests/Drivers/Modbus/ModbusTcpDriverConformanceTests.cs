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
/// <see cref="DeviceDriverConformanceSuite"/> against the real <see cref="ModbusTcpDriver"/>. GP-6 originally
/// found that against a target that accepts the TCP connection but never responds at the Modbus protocol
/// level, <c>ReadAsync</c> did NOT honour cancellation — <c>NModbus</c>'s <c>ReadHoldingRegistersAsync</c>
/// call takes no <see cref="CancellationToken"/> and has no bounded internal timeout either, so a
/// silent/unresponsive peer could hang the poll loop indefinitely, un-cancellable, with
/// <see cref="IDeviceDriver.Health"/> frozen at whatever it last reported (never degrading, so no alarm ever
/// fired) — see task-6-report.md for the original finding. GP-6b (task-6b-report.md) fixed the root cause in
/// <see cref="ModbusTcpDriver"/> itself (bounded <c>Transport.ReadTimeout</c>/<c>WriteTimeout</c>/<c>Retries</c>,
/// plus <c>ct.Register(DisposeConnection)</c> to interrupt an in-flight read promptly), so every check —
/// including cancellation — now passes as a normal <c>[Fact]</c> with no acknowledged gaps.
/// </summary>
public sealed class ModbusTcpDriverConformanceTests : DeviceDriverConformanceSuite
{
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

    /// <summary>Task B-7 — switched from <see cref="ModbusLoopbackHarness.BuildMap"/> to
    /// <see cref="ModbusLoopbackHarness.BuildWritableMap"/>: the write-contract checks (e.g.
    /// <see cref="Check_Write_SetpointAndCommandNamespaces_AreDistinct"/>) need at least one real declared
    /// point AND command name to cross-check, which the original read-only map never declared. Purely
    /// additive to what every existing READ check already exercises — none of them read
    /// <see cref="Models.IWritableDeviceDriver.WritablePoints"/>/<see cref="Models.IWritableDeviceDriver.Commands"/>
    /// at all, so this changes nothing about their own outcomes.</summary>
    protected override IDeviceDriver CreateDriver() =>
        new ModbusTcpDriver("127.0.0.1", ClosedPort, ModbusLoopbackHarness.BuildWritableMap("PLC-CONFORMANCE-NODEVICE"));

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

    /// <summary>GP-6b (task-6b-report.md) — GP-6's KnownGap pin promoted to the real, strict check now that
    /// <see cref="ModbusTcpDriver"/> is fixed: against a real, portable, loopback-only peer that accepts the
    /// TCP connection but never sends a single byte back, <c>ReadAsync</c> now ends within
    /// <see cref="DeviceDriverConformanceSuite.CancellationBudget"/> of the token being cancelled — bounded
    /// I/O (<c>Transport.ReadTimeout</c>/<c>WriteTimeout</c>) plus <c>ct.Register(DisposeConnection)</c>
    /// interrupting the in-flight NModbus call (which has no <see cref="CancellationToken"/> overload of its
    /// own) together close the gap GP-6 originally pinned as broken.</summary>
    [Fact]
    public Task ReadAsync_HonoursCancellation_WhenNoDeviceIsReachable() => Check_ReadAsync_HonoursCancellation_WhenNoDeviceIsReachable();

    // ─────────────────────────────────────────────────────────────────────
    // Task B-7 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-7-brief.md) — the write
    // contract, wired against the SAME real ModbusTcpDriver this class already conformance-tests for reads.
    // CreateDriver() already returns an IWritableDeviceDriver (ModbusTcpDriver implements it since B-4), so
    // EveryCheckIsWiredOrAcknowledged now requires every Check_Write_* below to be wired or acknowledged —
    // see DeviceDriverConformanceSuite's own "applicability, not a gap" remarks for why a READ-only driver
    // never reaches this obligation at all.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>A real, portable, loopback-only responder that accepts TCP connections and counts raw
    /// Modbus-TCP requests received (any 12-byte request — a single-register write and a single-coil write
    /// are the same wire size) but NEVER answers any of them — the write-contract mirror of this class's own
    /// <see cref="CreateUnresponsiveDeviceAsync"/> target, extended with the externally-observable attempt
    /// count <see cref="DeviceDriverConformanceSuite.UnresponsiveWritableDeviceSession.CommandAttemptsReachingDevice"/>
    /// needs. Keeps accepting fresh connections for its whole lifetime (never just one) so a hypothetically
    /// broken driver that reconnects to retry would still be counted correctly.</summary>
    protected override Task<UnresponsiveWritableDeviceSession> CreateUnresponsiveWritableDeviceAsync()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;

        var attemptCount = 0;
        var serverCts = new CancellationTokenSource();
        var serverTask = Task.Run(async () =>
        {
            try
            {
                while (!serverCts.IsCancellationRequested)
                {
                    using var accepted = await listener.AcceptTcpClientAsync(serverCts.Token).ConfigureAwait(false);
                    var stream = accepted.GetStream();
                    while (!serverCts.IsCancellationRequested)
                    {
                        var request = new byte[12];
                        if (!await ReadExactAsync(stream, request, request.Length, serverCts.Token).ConfigureAwait(false))
                        {
                            break; // this connection closed (e.g. the driver force-closed it on its own timeout) — go accept the next one.
                        }

                        Interlocked.Increment(ref attemptCount);
                        // never respond — every attempt (the first, or a would-be retried one) times out identically.
                    }
                }
            }
            catch
            {
                // teardown (listener stopped, or the deadline/ForceUnstickAsync below cancelling) — expected.
            }
        });

        // A SHORT internal write timeout — see CreateUnresponsiveWritableDeviceAsync's own doc comment for
        // why: the write-contract checks deliberately issue an UNCANCELLED call and wait for this bound to
        // elapse on its own.
        var driver = new ModbusTcpDriver(
            "127.0.0.1", port, ModbusLoopbackHarness.BuildWritableMap("PLC-CONFORMANCE-WRITE-UNRESPONSIVE", readTimeoutMs: 300));

        async Task ForceUnstickAsync()
        {
            try { await serverCts.CancelAsync(); } catch { }
            try { await serverTask; } catch { }
            try { listener.Stop(); } catch { }
            serverCts.Dispose();
        }

        return Task.FromResult(new UnresponsiveWritableDeviceSession(
            driver, "speed", 100.0, "start-cycle", CommandArguments: null,
            CommandAttemptsReachingDevice: () => Volatile.Read(ref attemptCount),
            // Modbus's own counting responder counts synchronously as bytes arrive — no server-side handler
            // delay to settle, unlike OPC-UA's instrumented-method-based equivalent.
            AttemptCountSettleDelay: TimeSpan.FromMilliseconds(300),
            ForceUnstickAsync: ForceUnstickAsync));
    }

    [Fact]
    public Task Write_UnknownPointOrCommand_RejectedWithoutTouchingDevice() => Check_Write_UnknownPointOrCommand_RejectedWithoutTouchingDevice();

    [Fact]
    public Task Write_SetpointAndCommandNamespaces_AreDistinct() => Check_Write_SetpointAndCommandNamespaces_AreDistinct();

    [Fact]
    public Task Write_CapabilityLists_AreEffectivelyImmutable() => Check_Write_CapabilityLists_AreEffectivelyImmutable();

    [Fact]
    public Task Write_TimedOutWriteOrCommand_ReturnsIndeterminate_NeverThrows() => Check_Write_TimedOutWriteOrCommand_ReturnsIndeterminate_NeverThrows();

    [Fact]
    public Task Write_Indeterminate_DetailIsNonEmpty_AndDistinguishesDistinctCauses() => Check_Write_Indeterminate_DetailIsNonEmpty_AndDistinguishesDistinctCauses();

    [Fact]
    public Task Write_NoImplicitRetry_ExactlyOneCommandAttemptReachesTheDeviceOnTimeout() => Check_Write_NoImplicitRetry_ExactlyOneCommandAttemptReachesTheDeviceOnTimeout();

    [Fact]
    public Task Write_Cancellation_HonouredPromptly_EvenAgainstAnUnresponsiveDevice() => Check_Write_Cancellation_HonouredPromptly_EvenAgainstAnUnresponsiveDevice();

    [Fact]
    public Task Write_RoundTripsLosslesslyThroughConnectorJson() => Check_Write_RoundTripsLosslesslyThroughConnectorJson();

    /// <summary>
    /// GP-6b (task-6b-report.md) — the PRIMARY acceptance criterion for this defect, more important than
    /// cancellation promptness alone: task-6-report.md's real production concern was that a device which
    /// HAD been talking (<see cref="IDeviceDriver.Health"/> = <see cref="DriverHealthState.Connected"/>) and
    /// then went silent AT THE PROTOCOL LEVEL — while its TCP connection stayed fully open, no FIN/RST, no
    /// keepalive to notice — froze <c>Health</c> at <c>Connected</c> FOREVER (the in-flight NModbus read
    /// never returned at all), so <c>AlarmEvaluator</c> never raised Degraded/Down and the operator saw a
    /// permanently "green" connector that had silently stopped producing. This reproduces exactly that
    /// two-phase scenario with a hand-rolled raw Modbus-TCP responder (see
    /// <see cref="RunOnePollThenGoProtocolSilentAsync"/>): answer the FIRST poll's requests correctly (so
    /// <c>Health</c> genuinely reaches <c>Connected</c>, not merely start from a device-less <c>Down</c> like
    /// <see cref="CreateUnresponsiveDeviceAsync"/>'s target), then stop responding at the protocol level
    /// while the socket itself stays open — and asserts <c>Health</c> moves OFF <c>Connected</c> within a
    /// bounded time, never hanging forever the way it did before this fix.
    /// </summary>
    [Fact]
    public async Task Health_MovesOffConnected_WhenAPreviouslyRespondingPeerGoesProtocolSilent()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;

        using var serverCts = new CancellationTokenSource();
        var serverTask = Task.Run(async () =>
        {
            try
            {
                using var accepted = await listener.AcceptTcpClientAsync(serverCts.Token).ConfigureAwait(false);
                await RunOnePollThenGoProtocolSilentAsync(accepted.GetStream(), requestsToAnswer: 2, serverCts.Token)
                    .ConfigureAwait(false);
            }
            catch
            {
                // best-effort — the harness dying under teardown (listener/socket already closed) is fine.
            }
        });

        await using var driver = new ModbusTcpDriver(
            "127.0.0.1", port, ModbusLoopbackHarness.BuildMap("PLC-HEALTH-FREEZE", pollIntervalMs: 50));

        using var driveCts = new CancellationTokenSource();
        var runTask = DriveAsync(driver, driveCts.Token);

        try
        {
            // Phase 1 — the peer answers the first poll's requests normally: Health MUST reach Connected,
            // same as against any healthy device, proving this is a real "was talking, then went silent"
            // scenario rather than a device that was never reachable in the first place.
            var becameConnected = await WaitForHealthAsync(driver, DriverHealthState.Connected, TimeSpan.FromSeconds(5));
            Assert.True(
                becameConnected,
                $"driver never reached Connected against a peer that DID answer its first poll " +
                $"(Health={driver.Health}) — the responder harness itself is broken, not the fix under test.");

            // Phase 2 — the peer goes silent AT THE PROTOCOL LEVEL from here on while the TCP connection
            // stays fully open. BEFORE this fix, the in-flight NModbus read this triggers had no bound at
            // all, so Health stayed frozen at Connected forever. Now bounded by Transport.ReadTimeout
            // (Math.Max(1000, PollIntervalMs*4) = 1000ms here) + Retries=1 + WaitToRetryMilliseconds, so
            // Health MUST move off Connected within a few seconds — comfortably proven within 10s.
            var becameDegraded = await WaitForHealthAsync(driver, DriverHealthState.Degraded, TimeSpan.FromSeconds(10));
            Assert.True(
                becameDegraded,
                $"Health stayed at {driver.Health} against a peer that went silent at the protocol level " +
                "while keeping its TCP connection open — this IS the health-freeze this fix exists to close.");

            // Resilient by design (ModbusTcpDriver's own class doc comment): degrading must not throw the
            // iterator — it keeps looping/reconnecting instead.
            Assert.False(runTask.IsCompleted, "ReadAsync must keep looping (not throw/complete) after degrading.");
        }
        finally
        {
            driveCts.Cancel();
            try { await runTask; } catch (OperationCanceledException) { }

            await serverCts.CancelAsync();
            try { await serverTask; } catch { /* best-effort teardown */ }
            try { listener.Stop(); } catch { /* best-effort teardown */ }
        }
    }

    /// <summary>Answers exactly <paramref name="requestsToAnswer"/> raw Modbus-TCP requests with a valid
    /// FC03/FC04 single-register response (enough for <see cref="ModbusLoopbackHarness.BuildMap"/>'s
    /// 2-register map to complete one whole poll successfully), then goes silent AT THE PROTOCOL LEVEL
    /// forever — draining (never answering) any further bytes without ever closing the socket. This is the
    /// realistic "accepts TCP but stops responding at the protocol level" failure mode task-6-report.md
    /// describes (a stateful firewall timing out an idle flow, a PLC whose Modbus task hung while its TCP
    /// stack stayed up, ...) — deliberately hand-rolled at the raw byte level (standard Modbus-TCP/MBAP
    /// framing: 6-byte header + unit id + function code + data) rather than reusing NModbus's own slave
    /// network, which has no "answer once then go silent without closing" knob.</summary>
    private static async Task RunOnePollThenGoProtocolSilentAsync(NetworkStream stream, int requestsToAnswer, CancellationToken ct)
    {
        var request = new byte[12]; // MBAP header (7) + FC03/FC04 PDU (1 + 2 + 2)
        for (var i = 0; i < requestsToAnswer; i++)
        {
            if (!await ReadExactAsync(stream, request, request.Length, ct).ConfigureAwait(false))
            {
                return;
            }

            var response = new byte[]
            {
                request[0], request[1], 0x00, 0x00, 0x00, 0x05, request[6], request[7], 0x02, 0x00, 0x01,
            };
            await stream.WriteAsync(response, ct).ConfigureAwait(false);
        }

        var sink = new byte[256];
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var read = await stream.ReadAsync(sink, ct).ConfigureAwait(false);
                if (read == 0)
                {
                    return;
                }
            }
            catch
            {
                return;
            }
        }
    }

    private static async Task<bool> ReadExactAsync(NetworkStream stream, byte[] buffer, int count, CancellationToken ct)
    {
        var offset = 0;
        while (offset < count)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(offset, count - offset), ct).ConfigureAwait(false);
            if (read == 0)
            {
                return false;
            }

            offset += read;
        }

        return true;
    }

    private static async Task<bool> WaitForHealthAsync(IDeviceDriver driver, DriverHealthState expected, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            if (driver.Health == expected)
            {
                return true;
            }

            await Task.Delay(TimeSpan.FromMilliseconds(50));
        }

        return driver.Health == expected;
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
