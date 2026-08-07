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
    /// Connecting here fails FAST, unlike <see cref="CreateUnresponsiveDeviceAsync"/>'s target below.
    ///
    /// <para>🔴 D-2 review (I-3) — was <c>FindAndReleaseFreePort()</c>, which released the port back to the
    /// OS and let it be reassigned to another test's listener. See
    /// <see cref="St4i.EdgeCore.Tests.Drivers.ClosedLoopbackPort"/> for the cross-test failure that
    /// established this and for the bind-without-listen mechanism that removes it.</para></summary>
    private static int ClosedPort => St4i.EdgeCore.Tests.Drivers.ClosedLoopbackPort.Port;

    private static string NewPkiRoot(string tag) =>
        Path.Combine(Path.GetTempPath(), $"st4i-opcua-conf-{tag}-" + Guid.NewGuid().ToString("N")[..8]);

    /// <summary>Task B-7 — switched from <see cref="OpcUaLoopbackHarness.BuildMap"/> to
    /// <see cref="OpcUaLoopbackHarness.BuildWritableMap"/>: the write-contract checks (e.g.
    /// <see cref="Check_Write_SetpointAndCommandNamespaces_AreDistinct"/>) need at least one real declared
    /// point AND command name to cross-check, which the original read-only map never declared. Purely
    /// additive to what every existing READ check already exercises — none of them read
    /// <see cref="Models.IWritableDeviceDriver.WritablePoints"/>/<see cref="Models.IWritableDeviceDriver.Commands"/>
    /// at all, so this changes nothing about their own outcomes.</summary>
    protected override IDeviceDriver CreateDriver() =>
        new OpcUaDriver(
            OpcUaLoopbackHarness.BuildWritableMap("PLC-CONFORMANCE-NODEVICE", $"opc.tcp://127.0.0.1:{ClosedPort}/nobody-home"),
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
        // 🔴 Task C-8 review round 1 (I-4) — bounded accept; see the identical note in
        // ModbusTcpDriverConformanceTests. This site already awaited the task and disposed the accepted
        // client, so it was not stranding a connection; the deadline closes the "teardown never ran" case.
        var acceptDeadline = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        var acceptTask = Task.Run(async () =>
        {
            try { accepted = await listener.AcceptTcpClientAsync(acceptDeadline.Token).ConfigureAwait(false); }
            catch { /* deadline firing, or listener stopped during teardown — both fine */ }
        });

        var driver = new OpcUaDriver(
            OpcUaLoopbackHarness.BuildMap("PLC-CONFORMANCE-SILENT", $"opc.tcp://127.0.0.1:{port}/silent"),
            pkiDir: NewPkiRoot("silent"));

        async Task ForceUnstickAsync()
        {
            acceptDeadline.Cancel();
            try { await acceptTask.ConfigureAwait(false); } catch { }
            try { accepted?.Close(); } catch { }
            try { accepted?.Dispose(); } catch { }
            try { listener.Stop(); } catch { }
            acceptDeadline.Dispose();
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

    // ─────────────────────────────────────────────────────────────────────
    // Task B-7 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-7-brief.md) — the write
    // contract, wired against the SAME real OpcUaDriver this class already conformance-tests for reads.
    // CreateDriver() already returns an IWritableDeviceDriver (OpcUaDriver implements it since B-5), so
    // EveryCheckIsWiredOrAcknowledged now requires every Check_Write_* below to be wired or acknowledged.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>A real, working OPC-UA session (session establishment itself succeeds normally) whose
    /// "Speed" variable write / "StartCycle" method invocation is held open past the driver's own SHORT
    /// <c>operationTimeoutMs</c> — <see cref="OpcUaLoopbackHarness.WritableServerControls.MethodDelayMs"/>,
    /// unlike <see cref="CreateUnresponsiveDeviceAsync"/>'s plain "never speaks the protocol at all" silent
    /// listener, reproduces the SPECIFIC scenario the write-contract checks need: an ALREADY-LIVE session, a
    /// genuinely in-flight (never-acknowledged) write/call, and the client giving up on its own bound while
    /// the server-side handler is still running — exactly the shape a transport-level retry underneath the
    /// driver would have to resend. "start-cycle" (not "ping") is used because only its own handler
    /// (<see cref="OpcUaLoopbackHarness.WritableServerControls.InvokeStartCycle"/>) — and the "Speed" write
    /// handler — actually respect <see cref="OpcUaLoopbackHarness.WritableServerControls.MethodDelayMs"/>;
    /// "ping" returns immediately regardless.</summary>
    protected override async Task<UnresponsiveWritableDeviceSession> CreateUnresponsiveWritableDeviceAsync()
    {
        var operationTimeoutMs = EffectiveUnresponsiveWriteOperationTimeoutMs;
        var methodDelayMs = EffectiveUnresponsiveWriteMethodDelayMs; // > operationTimeoutMs, so the CLIENT always gives up first.

        var pkiRoot = NewPkiRoot("write-unresponsive");
        var testServer = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot).ConfigureAwait(false);
        testServer.Controls.MethodDelayMs = methodDelayMs;

        var driver = new OpcUaDriver(
            OpcUaLoopbackHarness.BuildWritableMap("PLC-CONFORMANCE-WRITE-UNRESPONSIVE", testServer.EndpointUrl),
            pkiDir: pkiRoot, operationTimeoutMs: operationTimeoutMs);

        async Task ForceUnstickAsync()
        {
            await testServer.DisposeAsync().ConfigureAwait(false);
        }

        return new UnresponsiveWritableDeviceSession(
            driver, "speed", 100.0, "start-cycle",
            CommandArguments: new Dictionary<string, object> { ["speed"] = 42L },
            CommandAttemptsReachingDevice: () => testServer.Controls.StartCycleInvokedCount,
            // Unlike Modbus's synchronous byte-counting responder, "StartCycle"'s own invocation counter only
            // increments AFTER MethodDelayMs elapses server-side — settle long enough for that to have
            // happened even though the CLIENT already gave up much earlier (operationTimeoutMs).
            AttemptCountSettleDelay: TimeSpan.FromMilliseconds(methodDelayMs + 1000),
            ForceUnstickAsync: ForceUnstickAsync);
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

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 The ONE check whose target this rig has to strengthen.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>The client-side bound the unresponsive write target gives up on — the "SHORT internal write
    /// timeout" <see cref="DeviceDriverConformanceSuite.CreateUnresponsiveWritableDeviceAsync"/>'s own doc
    /// comment asks for.
    ///
    /// <para>🔴 <b>It is right for the four checks that issue an UNCANCELLED write and wrong for the one that
    /// does not</b>, which is why
    /// <see cref="Check_Write_Cancellation_HonouredPromptly_EvenAgainstAnUnresponsiveDevice"/> is overridden
    /// below. Proven by mutation rather than by reading: removing <c>cts.Cancel()</c> from the shared check, so
    /// cancellation is NEVER ISSUED AT ALL, left this rig GREEN — at 500 ms the client's own bound resolved the
    /// call long before that check's <see cref="DeviceDriverConformanceSuite.CancellationBudget"/> (5 s), so it
    /// could not tell an honoured cancellation from an ordinary timeout. <b>Nobody had looked at this rig</b>:
    /// the finding that reached the whole-branch review named only the Modbus TCP one, and this was found only
    /// because the reviewer ran the mutation across all four rigs instead of the one it had been told
    /// about.</para></summary>
    private const int UnresponsiveWriteOperationTimeoutMs = 500;

    /// <summary>How long the server-side "Speed" write / "StartCycle" handler holds a call open. Safely greater
    /// than <see cref="UnresponsiveWriteOperationTimeoutMs"/>, so the CLIENT always gives up first.</summary>
    private const int UnresponsiveWriteMethodDelayMs = 2_000;

    /// <summary>🔴 The client-side bound for the ONE check that supplies its own token. <b>Deliberately longer
    /// than <see cref="DeviceDriverConformanceSuite.CancellationBudget"/></b> (5 s) — the same 8 000 ms and the
    /// same reasoning as the two Modbus RTU rigs and the Modbus TCP one: if the target's own bound can expire
    /// inside the budget, a driver that ignored its token entirely still passes, and the check measures the
    /// configuration instead of the mechanism.</summary>
    private const int CancellableWriteOperationTimeoutMs = 8_000;

    /// <summary>🔴 <b>Raised WITH the client bound, and that is the whole point of asserting on the MINIMUM of
    /// the two below.</b> This rig has two bounds where the Modbus rigs have one, and the call is bounded by
    /// whichever is smaller. Raising only <see cref="CancellableWriteOperationTimeoutMs"/> would leave the
    /// server answering at 2 000 ms — well inside the budget — and an assertion naming the 8 000 ms would then
    /// be true of a number that does not govern the call. Kept above the client bound so the documented
    /// "the CLIENT always gives up first" shape is unchanged.</summary>
    private const int CancellableWriteMethodDelayMs = 10_000;

    /// <summary>Set for the duration of ONE check by
    /// <see cref="Check_Write_Cancellation_HonouredPromptly_EvenAgainstAnUnresponsiveDevice"/> and false
    /// otherwise. A plain field is safe: xunit constructs a fresh test-class instance per test and runs a
    /// class's tests sequentially, and the override restores it in a <c>finally</c> regardless.</summary>
    private bool _strengthenUnresponsiveWriteBounds;

    private int EffectiveUnresponsiveWriteOperationTimeoutMs =>
        _strengthenUnresponsiveWriteBounds ? CancellableWriteOperationTimeoutMs : UnresponsiveWriteOperationTimeoutMs;

    private int EffectiveUnresponsiveWriteMethodDelayMs =>
        _strengthenUnresponsiveWriteBounds ? CancellableWriteMethodDelayMs : UnresponsiveWriteMethodDelayMs;

    /// <summary>
    /// 🔴 <b>Runs the shared write-side cancellation check against a target whose own bounds cannot expire
    /// inside <see cref="DeviceDriverConformanceSuite.CancellationBudget"/> — so that passing it proves the
    /// driver honoured its token, not that a timeout got there first.</b> Same shape as
    /// <c>ModbusRtuDriverConformanceTests</c>' and <c>ModbusTcpDriverConformanceTests</c>' own overrides,
    /// deliberately: the defect is the shared suite's, the remedy has to be per-rig, and three rigs solving one
    /// problem three different ways is how the next author learns the wrong lesson.
    ///
    /// <para><b>Legitimate here and nowhere else on the write path:</b> this is the only <c>Check_Write_*</c>
    /// that supplies its own <see cref="CancellationToken"/> rather than
    /// <see cref="CancellationToken.None"/>, so raising its target's bounds cannot make any call unbounded —
    /// the token bounds it. The four uncancelled checks keep
    /// <see cref="UnresponsiveWriteOperationTimeoutMs"/>.</para>
    ///
    /// <para><b>Why the assertion is on the MINIMUM.</b> Two bounds can end this call without anybody
    /// cancelling — the client's own <c>operationTimeoutMs</c> and the server-side handler finally answering
    /// after <see cref="WritableServerControls.MethodDelayMs"/>. The smaller one governs, so the smaller one is
    /// what has to clear the budget. Asserting on the client bound alone would have passed while the server
    /// answered at 2 000 ms.</para>
    ///
    /// <para>
    /// 🔴 <b>THE CAVEAT, because this is a mechanism nothing polices.</b>
    /// <see cref="DeviceDriverConformanceSuite.EveryCheckIsWiredOrAcknowledged"/> proves every check is WIRED;
    /// nothing proves a driver's own subclass has not overridden a <c>Check_*</c> body and weakened it — an
    /// override is invisible to that census, and would be the quietest possible way to make a conformance suite
    /// lie. <b>So an override of a <c>Check_*</c> in a driver's subclass must be a <c>base</c>-CALLING WRAPPER,
    /// never a re-implementation</b>, and the strengthening is ASSERTED below rather than promised in prose.
    /// <b>And nothing detects DELETION of this override</b> — the base check would silently resume being blind,
    /// exactly as it was here until now. The only instrument that finds that is the mutation in
    /// <see cref="UnresponsiveWriteOperationTimeoutMs"/>' own doc block, re-run.</para>
    /// </summary>
    public override async Task Check_Write_Cancellation_HonouredPromptly_EvenAgainstAnUnresponsiveDevice()
    {
        _strengthenUnresponsiveWriteBounds = true;
        try
        {
            var strengthened = Math.Min(
                EffectiveUnresponsiveWriteOperationTimeoutMs, EffectiveUnresponsiveWriteMethodDelayMs);
            Assert.True(
                strengthened > CancellationBudget.TotalMilliseconds,
                $"this wrapper exists to STRENGTHEN the check, and it has stopped doing so: the unresponsive " +
                $"write target's own smallest bound is {strengthened} ms (the lesser of a " +
                $"{EffectiveUnresponsiveWriteOperationTimeoutMs} ms client operation timeout and a " +
                $"{EffectiveUnresponsiveWriteMethodDelayMs} ms server-side handler delay) against a " +
                $"{CancellationBudget.TotalMilliseconds} ms CancellationBudget, so an ordinary timeout could " +
                "satisfy the check and a driver that ignored its token entirely would still pass. Raise the " +
                "bound rather than deleting this assertion.");

            await base.Check_Write_Cancellation_HonouredPromptly_EvenAgainstAnUnresponsiveDevice()
                .ConfigureAwait(false);
        }
        finally
        {
            _strengthenUnresponsiveWriteBounds = false;
        }
    }
}
