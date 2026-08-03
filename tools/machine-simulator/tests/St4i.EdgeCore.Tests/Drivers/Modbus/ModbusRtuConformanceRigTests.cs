using System.Diagnostics;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers.Modbus;
using Xunit;
using Xunit.Abstractions;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// 🔴 Task D-6 — <b>the conformance rig's own teeth.</b> The brief's rule, and it is the same one
/// <see cref="St4i.Connector.Conformance.DeviceDriverConformanceSuite"/> applies to itself through
/// <c>NegativeControlTests</c>: <i>anything you add to the harness must itself be able to fail — a loopback
/// responder that always answers correctly makes several checks vacuous.</i>
///
/// <para>Every test below is about <see cref="ModbusRtuConformanceRig"/> and the maps
/// <c>ModbusRtuConformanceTestsBase</c> feeds it, never about <see cref="ModbusRtuDriver"/>. They exist so that
/// a green conformance run means "the driver satisfied the contract" rather than "nothing in the rig ever
/// asked".</para>
/// </summary>
public class ModbusRtuConformanceRigTests
{
    private readonly ITestOutputHelper _output;

    public ModbusRtuConformanceRigTests(ITestOutputHelper output) => _output = output;

    private const string SpeedPoint = ModbusRtuLoopbackHarness.WritableSpeedPoint;
    private const string StartCycleCommand = ModbusRtuLoopbackHarness.StartCycleCommand;

    // ─────────────────────────────────────────────────────────────────────
    // 1. CreateDriver()'s target: no device reachable, and FAST.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>The "no device reachable" target is genuinely ASKED, and it fails an order of magnitude faster
    /// than its own read timeout — which is the claim a silent RS-485 line could not make.</b>
    ///
    /// <para>Three assertions, each of which fails to a different way of getting this wrong. (1) The opener was
    /// invoked: a rig whose driver never even tried would satisfy every "Health was never Connected" check for
    /// the wrong reason, which is D-5's "the master timed out vs the master never transmitted" distinction.
    /// (2) Not one reading was produced. (3) The first degrade landed far below the map's declared
    /// <c>readTimeoutMs</c> of 5 000 ms — so the failure cannot have been a timeout, which is exactly what the
    /// <see cref="St4i.Connector.Conformance.DeviceDriverConformanceSuite.CreateDriver"/> hook asks for and
    /// what an unanswering device could never give.</para>
    /// </summary>
    [Fact]
    public async Task TheNoDeviceTarget_IsGenuinelyAsked_AndFailsAnOrderOfMagnitudeFasterThanItsOwnReadTimeout()
    {
        const int readTimeoutMs = 5_000;

        await using var registry = new ModbusBusRegistry();
        var openAttempts = 0;
        var lease = registry.Acquire(
            ModbusRtuConformanceRig.AbsentLineBusKey,
            ModbusRtuConformanceRig.UnopenableLine(() => Interlocked.Increment(ref openAttempts)));

        await using var driver = new ModbusRtuDriver(
            lease,
            ModbusRtuLoopbackHarness.BuildWritableMap(
                "RIG-NODEVICE", unitId: 1, readTimeoutMs: readTimeoutMs, pollIntervalMs: 20, retries: 0));

        var stopwatch = Stopwatch.StartNew();
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        var readings = 0;
        var pump = Task.Run(
            async () =>
            {
                try
                {
                    await foreach (var _ in driver.ReadAsync(cts.Token)) { Interlocked.Increment(ref readings); }
                }
                catch (OperationCanceledException) { }
            },
            CancellationToken.None);

        await WaitUntilAsync(() => driver.Health == DriverHealthState.Degraded, "the no-device target to degrade");
        stopwatch.Stop();

        await cts.CancelAsync();
        try { await pump; } catch (OperationCanceledException) { }

        _output.WriteLine(
            $"MEASURED: the unopenable-line target degraded in {stopwatch.Elapsed.TotalMilliseconds:F2} ms " +
            $"against its own {readTimeoutMs} ms read timeout, after {Volatile.Read(ref openAttempts)} open attempt(s).");

        Assert.True(Volatile.Read(ref openAttempts) >= 1,
            "the driver never even attempted to open the line, so 'no device reachable' would be passing for " +
            "the wrong reason — nothing asked.");
        Assert.Equal(0, Volatile.Read(ref readings));
        Assert.Equal(DriverHealthState.Degraded, driver.Health);
        Assert.True(stopwatch.ElapsedMilliseconds < readTimeoutMs / 10,
            $"the first failure took {stopwatch.ElapsedMilliseconds} ms against a declared {readTimeoutMs} ms " +
            "read timeout — that is a timeout, not the fast failure CreateDriver()'s hook asks for.");
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2. The silent peer: it really receives, and really never answers.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>The unresponsive peer receives every request frame and answers none of them.</b> Without this, an
    /// <see cref="WriteOutcome.Indeterminate"/> from any write check could be passing because nothing was ever
    /// transmitted — the two are indistinguishable from the master's side, and only one of them is a
    /// conformance result.
    /// </summary>
    [Fact]
    public async Task TheSilentPeer_ReceivesEveryRequestFrame_AndAnswersNone()
    {
        await using var peer = ModbusRtuConformanceRig.SilentPeer.Start("rig-silent");
        await using var driver = new ModbusRtuDriver(
            peer.Acquire(),
            ModbusRtuLoopbackHarness.BuildWritableMap("RIG-SILENT", unitId: 1, readTimeoutMs: 300, retries: 3));

        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest(SpeedPoint, 100.0), CancellationToken.None);
        Assert.Equal(WriteOutcome.Indeterminate, result.Outcome);

        // Generous settle so a late answer, if this peer had one, would have arrived before the assertions.
        await Task.Delay(300);

        Assert.True(peer.RequestsSeen >= 1, "the far end never read a request frame off the line.");
        Assert.Equal(1, peer.RequestFramesAtTheBusBoundary(1, RtuFrames.FunctionWriteSingleRegister));
        // Nothing came BACK: the master's own inbox is empty, which is what "never answers" means at the wire.
        Assert.Equal(0, peer.Links.Master.BufferedInputCount);
        // And nothing else went OUT: every byte this master wrote belonged to a request frame the far end read.
        Assert.Equal(RtuFrames.RequestFrameLength * peer.RequestsSeen, peer.Links.Master.BytesWritten);
    }

    /// <summary>
    /// 🔴 <b>The attempt counter the no-retry check reads CAN report more than one.</b>
    /// <see cref="St4i.Connector.Conformance.DeviceDriverConformanceSuite.Check_Write_NoImplicitRetry_ExactlyOneCommandAttemptReachesTheDeviceOnTimeout"/>
    /// asserts a delta of exactly 1; a counter pinned at 1 — or at 0 with an off-by-one comparison — would
    /// satisfy that forever. Two commands, two frames, asserted after each.
    /// </summary>
    [Fact]
    public async Task TheAttemptCounterAtTheBusBoundary_CanReportMoreThanOne()
    {
        await using var peer = ModbusRtuConformanceRig.SilentPeer.Start("rig-counter");
        await using var driver = new ModbusRtuDriver(
            peer.Acquire(),
            ModbusRtuLoopbackHarness.BuildWritableMap("RIG-COUNTER", unitId: 1, readTimeoutMs: 300, retries: 3));

        Assert.Equal(0, peer.RequestFramesAtTheBusBoundary(1, RtuFrames.FunctionWriteSingleCoil));

        var first = await driver.InvokeCommandAsync(new CommandRequest(StartCycleCommand), CancellationToken.None);
        Assert.Equal(WriteOutcome.Indeterminate, first.Outcome);
        Assert.Equal(1, peer.RequestFramesAtTheBusBoundary(1, RtuFrames.FunctionWriteSingleCoil));

        var second = await driver.InvokeCommandAsync(new CommandRequest(StartCycleCommand), CancellationToken.None);
        Assert.Equal(WriteOutcome.Indeterminate, second.Outcome);
        Assert.Equal(2, peer.RequestFramesAtTheBusBoundary(1, RtuFrames.FunctionWriteSingleCoil));
    }

    /// <summary>
    /// 🔴 <b>The conformance write map DECLARES a retry count the driver must not use, and the bus records
    /// zero.</b> Blueprint §8.1's rule applied to the rig itself: a map declaring <c>retries: null</c> would
    /// make the suite's no-retry check pass for a driver that inherited the read path's value, because that
    /// default is 1 and the check's own arithmetic would still see one attempt short of a retry. Declaring 3
    /// makes an inherited answer FOUR frames.
    ///
    /// <para>Both halves are asserted at a boundary this test did not supply: the frame count at the wire and
    /// <see cref="ModbusBus.LastTransactionRetries"/>, the value the BUS applied to the shared transport. The
    /// number this test DID supply (3) is the one asserted absent.</para>
    /// </summary>
    [Fact]
    public async Task TheConformanceWriteMapDeclaresARetryCountTheDriverMustNotUse_AndTheBusRecordsZero()
    {
        await using var peer = ModbusRtuConformanceRig.SilentPeer.Start("rig-retries");
        var map = ModbusRtuLoopbackHarness.BuildWritableMap("RIG-RETRIES", unitId: 1, readTimeoutMs: 300, retries: 3);

        Assert.Equal(3, map.EffectiveRetries);

        var lease = peer.Acquire();
        await using var driver = new ModbusRtuDriver(lease, map);

        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest(SpeedPoint, 100.0), CancellationToken.None);
        Assert.Equal(WriteOutcome.Indeterminate, result.Outcome);

        await Task.Delay(300);

        Assert.Equal(1, peer.RequestFramesAtTheBusBoundary(1, RtuFrames.FunctionWriteSingleRegister));
        Assert.Equal(0, lease.Bus.LastTransactionRetries);
        Assert.Equal(300, lease.Bus.LastTransactionReadTimeoutMs);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3. The readings rig: it can produce nothing.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>The readings rig is a control PAIR: the same bus, the same driver shape, yields readings when the
    /// slave answers and none at all when it does not.</b> The suite's own class doc comment names "a check
    /// that silently examines zero real readings" as one of the two traps it exists to avoid, and
    /// <c>CollectFromAsync</c> discharges it by throwing rather than returning short. That mechanism is only
    /// worth anything if this rig's greenness genuinely comes from the slave ANSWERING — which is what the
    /// negative half establishes, and which no amount of passing round-trip checks would.
    /// </summary>
    [Fact]
    public async Task TheReadingsRig_YieldsReadingsOnlyBecauseTheSlaveAnswers()
    {
        await using var bus = ModbusRtuLoopbackHarness.Start(((byte)1, new ushort[] { 235, 0xFFFF }));
        await using var keepAlive = bus.Lease();

        int answered;
        await using (var healthy = new ModbusRtuDriver(
            bus.Lease(),
            ModbusRtuLoopbackHarness.BuildMap("RIG-READINGS-OK", unitId: 1, pollIntervalMs: 20, readTimeoutMs: 1_000)))
        {
            answered = await CountReadingsAsync(healthy, max: 3, window: TimeSpan.FromSeconds(15));
        }

        Assert.True(answered >= 3, $"the healthy half of this control only produced {answered} readings.");

        // Same bus, same map shape — only the slave's ability to reply changes.
        bus.Links.Device.SilentUnitId = 1;

        int silenced;
        await using (var silent = new ModbusRtuDriver(
            bus.Lease(),
            ModbusRtuLoopbackHarness.BuildMap("RIG-READINGS-SILENT", unitId: 1, pollIntervalMs: 20, readTimeoutMs: 250)))
        {
            silenced = await CountReadingsAsync(silent, max: 1, window: TimeSpan.FromSeconds(3));
        }

        Assert.Equal(0, silenced);
        Assert.True(bus.Links.Device.FramesSilenced > 0,
            "the slave never replied at all, so the negative half proves nothing about the reply being dropped.");
    }

    // ─────────────────────────────────────────────────────────────────────
    // 4. 🔴 The RTU form of the ClosedLoopbackPort defect, pinned.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>Releasing the last lease disposes the bus AND its link — so a rig that kept only the bus key and
    /// the link pair would hand the next <see cref="ModbusBusRegistry.Acquire"/> a live bus over a corpse.</b>
    ///
    /// <para>This is the RTU spelling of the defect D-2's review (I-3) found on the TCP side: obtain a resource,
    /// release it, and keep the identifier that names it. There the identifier was an ephemeral port number the
    /// OS could reassign; here it is a bus key whose link the registry has already disposed. The shape that
    /// finds it is exactly this task's — <see cref="St4i.Connector.Conformance.DeviceDriverConformanceSuite"/>
    /// creates many drivers per check and disposes them, so the reference count reaches zero between checks.</para>
    ///
    /// <para>Both halves in ONE test, because "the keep-alive is what prevents it" is a claim about a pair: the
    /// first half shows the link dead and the next write failing, the second shows the identical sequence
    /// succeeding with one extra lease held. A test with only the first half would go green against a rig that
    /// had simply stopped working for some other reason.</para>
    /// </summary>
    [Fact]
    public async Task ReleasingTheLastLease_DisposesTheLink_WhichIsWhyEveryRigHoldsAKeepAliveLease()
    {
        // ---- without a keep-alive: the link does not survive its last driver -------------------------------
        await using (var bus = ModbusRtuLoopbackHarness.Start(((byte)1, new ushort[] { 1, 0, 0, 0, 0, 6 })))
        {
            var first = new ModbusRtuDriver(bus.Lease(), ModbusRtuLoopbackHarness.BuildWritableMap("RIG-LEASE-A", unitId: 1, readTimeoutMs: 1_000));
            var applied = await first.WriteSetpointAsync(new SetpointWriteRequest(SpeedPoint, 11.0), CancellationToken.None);
            Assert.Equal(WriteOutcome.Applied, applied.Outcome);
            Assert.True(bus.Links.Master.IsOpen, "the link should be open once a transaction has run.");

            await first.DisposeAsync();

            Assert.Equal(0, bus.Registry.LeaseCount(bus.BusKey));
            Assert.False(bus.Registry.HasBus(bus.BusKey), "the last release must dispose the bus.");
            Assert.False(bus.Links.Master.IsOpen,
                "disposing the bus must have disposed the LINK too — that is the fact a rig which keeps only " +
                "the key and the pair would be building its next bus on top of.");

            await using var second = new ModbusRtuDriver(bus.Lease(), ModbusRtuLoopbackHarness.BuildWritableMap("RIG-LEASE-B", unitId: 1, readTimeoutMs: 300));
            var afterwards = await second.WriteSetpointAsync(new SetpointWriteRequest(SpeedPoint, 22.0), CancellationToken.None);
            Assert.NotEqual(WriteOutcome.Applied, afterwards.Outcome);
        }

        // ---- with a keep-alive: the identical sequence works -----------------------------------------------
        await using var live = ModbusRtuLoopbackHarness.Start(((byte)1, new ushort[] { 1, 0, 0, 0, 0, 6 }));
        await using var keepAlive = live.Lease();

        var transient = new ModbusRtuDriver(live.Lease(), ModbusRtuLoopbackHarness.BuildWritableMap("RIG-LEASE-C", unitId: 1, readTimeoutMs: 1_000));
        Assert.Equal(WriteOutcome.Applied,
            (await transient.WriteSetpointAsync(new SetpointWriteRequest(SpeedPoint, 33.0), CancellationToken.None)).Outcome);
        await transient.DisposeAsync();

        Assert.Equal(1, live.Registry.LeaseCount(live.BusKey));
        Assert.True(live.Links.Master.IsOpen);

        await using var next = new ModbusRtuDriver(live.Lease(), ModbusRtuLoopbackHarness.BuildWritableMap("RIG-LEASE-D", unitId: 1, readTimeoutMs: 1_000));
        var stillWorks = await next.WriteSetpointAsync(new SetpointWriteRequest(SpeedPoint, 44.0), CancellationToken.None);
        Assert.Equal(WriteOutcome.Applied, stillWorks.Outcome);
        Assert.Equal((ushort)44, live.Slaves[1].DataStore.HoldingRegisters.ReadPoints(ModbusRtuLoopbackHarness.WritableSpeedRegister, 1)[0]);
    }

    // ─────────────────────────────────────────────────────────────────────

    private static async Task<int> CountReadingsAsync(IDeviceDriver driver, int max, TimeSpan window)
    {
        var count = 0;
        using var cts = new CancellationTokenSource(window);
        try
        {
            await foreach (var _ in driver.ReadAsync(cts.Token))
            {
                if (++count >= max) break;
            }
        }
        catch (OperationCanceledException) { }

        return count;
    }

    private static async Task WaitUntilAsync(Func<bool> predicate, string because)
    {
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(20);
        while (DateTime.UtcNow < deadline)
        {
            if (predicate()) return;
            await Task.Delay(5);
        }

        Assert.True(predicate(), $"timed out waiting for: {because}");
    }
}
