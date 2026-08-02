using System.Diagnostics;
using St4i.EdgeCore.Drivers.Modbus;
using Xunit;
using Xunit.Abstractions;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// Task D-2's non-negotiable: <b>cancellation unwinds one transaction without destroying the transport, and
/// the transport is still usable afterwards by a second device on the same bus.</b>
///
/// <para>The measurements printed here are reported in task-2-report.md. They are printed, not asserted
/// tightly: a latency assertion tight enough to be interesting is an assertion that fails under CI load, and
/// "a rate is a symptom, not a diagnosis". The assertions are about MECHANISM —
/// <see cref="ModbusBus.LinkGeneration"/> did not move, the link is still open, a second device still reads
/// correct values — and the bounds that are asserted are generous enough that only a genuinely broken
/// mechanism (one that waits out a full read timeout, or tears the link down and reconnects) can breach
/// them.</para>
/// </summary>
public class ModbusBusCancellationTests(ITestOutputHelper output)
{
    /// <summary>Mechanism #1 — cancelled while queued for the bus. The transaction never started, so the bus
    /// must be left CLEAN: no quarantine is owed to anybody, and the next device pays nothing.</summary>
    [Fact]
    public async Task CancellingWhileAwaitingArbitration_UnblocksPromptly_AndLeavesTheBusClean()
    {
        await using var harness = ModbusRtuLoopbackHarness.Start(((byte)1, new ushort[] { 500, 0 }));
        await using var holder = harness.Lease();
        await using var waiter = harness.Lease();
        var bus = holder.Bus;

        // Device A takes the bus and holds it.
        var held = await bus.BeginTransactionAsync(readTimeoutMs: 2_000, retries: 0, CancellationToken.None);

        using var cts = new CancellationTokenSource();
        // A genuinely async call (it yields at the semaphore), so it needs no thread of its own — see BlockingWork
        // for which calls in this file do.
        var queued = bus.BeginTransactionAsync(readTimeoutMs: 2_000, retries: 0, cts.Token);

        // Let the second caller genuinely reach the semaphore before cancelling — otherwise this would test
        // the already-cancelled fast path, which is a different (and easier) thing.
        await WaitUntilAsync(() => queued.Status == TaskStatus.WaitingForActivation, "the second device to queue for the bus");

        var sw = Stopwatch.StartNew();
        await cts.CancelAsync();

        // Bounded, so a bus that IGNORES the token FAILS this test instead of hanging it. Found by mutation:
        // the mutant that drops `ct` from the arbitration wait left `queued` pending forever, and xunit has no
        // per-test timeout — the whole run stalled until the harness's own 900 s kill. A test that hangs under
        // a defect is strictly worse than one that fails under it: a failure names the defect, a hang names
        // nothing and looks like infrastructure.
        var settled = await Task.WhenAny(queued, Task.Delay(TimeSpan.FromSeconds(10)));
        Assert.Same(queued, settled);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => queued);
        sw.Stop();
        output.WriteLine($"cancel-while-awaiting-arbitration unblocked in {sw.Elapsed.TotalMilliseconds:F2} ms");

        // Nothing reached the wire, so nothing is owed.
        Assert.False(bus.IsDesynchronised);
        Assert.Equal(0, bus.ResynchronisationCount);

        // Well under the 2 s read timeout: proves this did not fall through to the in-flight path.
        Assert.True(sw.ElapsedMilliseconds < 500, $"expected prompt arbitration cancellation, took {sw.ElapsedMilliseconds} ms");

        await held.DisposeAsync();
    }

    /// <summary>
    /// 🔴 Mechanism #2, and the task's central claim: a cancelled IN-FLIGHT read unblocks promptly and the
    /// link SURVIVES. <see cref="ModbusBus.LinkGeneration"/> is the load-bearing assertion — it counts every
    /// physical link this bus has ever opened, so "still 1" is the difference between "the link survived" and
    /// "the link was rebuilt quickly enough that a later read looked fine", which is precisely the outcome
    /// Đợt B's <c>ct.Register(DisposeConnection)</c> would have produced here.
    /// </summary>
    [Fact]
    public async Task CancellingAnInFlightRead_UnblocksPromptly_AndDoesNotRebuildTheLink()
    {
        await using var harness = ModbusRtuLoopbackHarness.Start(((byte)1, new ushort[] { 500, 0 }));
        await using var lease = harness.Lease();
        var bus = lease.Bus;

        // The device receives the request and computes, but its answer never reaches the master.
        harness.Links.Device.HoldWrites = true;

        using var cts = new CancellationTokenSource();
        // A deliberately LONG read timeout: if cancellation fell back to "wait out the bound", this test would
        // take 30 seconds instead of milliseconds, which is the failure it is written to catch.
        await using var transaction = await bus.BeginTransactionAsync(readTimeoutMs: 30_000, retries: 0, cts.Token);

        // NModbus starts its own worker for the blocking read, so this returns a pending task promptly.
        var read = transaction.ExecuteAsync(m => m.ReadHoldingRegistersAsync(1, 0, 1));

        await WaitUntilAsync(() => harness.Links.Device.BytesWritten > 0,
            "the device to have produced its (held) answer, i.e. the master is genuinely blocked in a read");

        var linkGenerationBefore = bus.LinkGeneration;

        var sw = Stopwatch.StartNew();
        await cts.CancelAsync();

        // Bounded well below the read's own 30 s bound, so a mechanism that merely WAITS OUT the timeout
        // fails here promptly and by name rather than passing 30 seconds later. (Found by mutation: the
        // mutant that removes the abort registration does exactly that.)
        var settled = await Task.WhenAny(read, Task.Delay(TimeSpan.FromSeconds(10)));
        Assert.Same(read, settled);
        await Assert.ThrowsAnyAsync<Exception>(() => read);
        sw.Stop();
        output.WriteLine($"cancel-an-in-flight-read unblocked in {sw.Elapsed.TotalMilliseconds:F2} ms " +
                         $"(the read's own bound was 30000 ms)");

        // The mechanism, not the clock: the link was never rebuilt, and it is still open.
        Assert.Equal(linkGenerationBefore, bus.LinkGeneration);
        Assert.True(harness.Links.Master.IsOpen, "the shared link must survive one device's cancellation");

        // Generous, but 100x smaller than the read's own bound — only a mechanism that waits out the timeout
        // can breach this.
        Assert.True(sw.ElapsedMilliseconds < 3_000, $"expected prompt in-flight cancellation, took {sw.ElapsedMilliseconds} ms");
    }

    /// <summary>
    /// 🔴 The brief's non-negotiable, stated as a device outcome rather than a status: after device A's read
    /// is cancelled mid-flight, device B on the SAME bus reads ITS OWN correct value — and the link it read
    /// over is the same one A was using.
    /// </summary>
    [Fact]
    public async Task AfterACancelledInFlightRead_ASecondDeviceOnTheSameBus_StillReadsItsOwnCorrectValue()
    {
        await using var harness = ModbusRtuLoopbackHarness.Start(
            ((byte)1, new ushort[] { 111, 0 }),
            ((byte)7, new ushort[] { 777, 0 }));

        await using var leaseA = harness.Lease();
        await using var leaseB = harness.Lease();
        var bus = leaseA.Bus;
        Assert.Same(leaseA.Bus, leaseB.Bus);

        harness.Links.Device.HoldWrites = true;

        using var ctsA = new CancellationTokenSource();
        var transactionA = await bus.BeginTransactionAsync(readTimeoutMs: 30_000, retries: 0, ctsA.Token);
        var readA = transactionA.ExecuteAsync(m => m.ReadHoldingRegistersAsync(1, 0, 1));

        await WaitUntilAsync(() => harness.Links.Device.BytesWritten > 0, "device A's request to have been answered (into the hold)");

        var generationBefore = bus.LinkGeneration;
        await ctsA.CancelAsync();
        // Bounded for the same reason as the test above: a mechanism that waits out the 30 s read bound must
        // fail here, not pass late.
        var settledA = await Task.WhenAny(readA, Task.Delay(TimeSpan.FromSeconds(10)));
        Assert.Same(readA, settledA);
        await Assert.ThrowsAnyAsync<Exception>(() => readA);
        await transactionA.DisposeAsync();

        // The bus is now quarantined — an aborted read leaves it in exactly the state a timeout does.
        Assert.True(bus.IsDesynchronised);

        // Device A's stale answer is released onto the line at the worst possible moment: after A gave up,
        // before B asks. This is the frame RTU cannot correlate away.
        harness.Links.Device.ReleaseHeldWrites();
        await WaitUntilAsync(() => harness.Links.Master.BufferedInputCount > 0, "device A's stale answer to land on the line");
        Assert.True(harness.Links.Master.BufferedInputCount > 0, "the stale frame must genuinely be on the line, or this test proves nothing");

        // Now device B reads, over the SAME link.
        await using var transactionB = await bus.BeginTransactionAsync(readTimeoutMs: 5_000, retries: 0, CancellationToken.None);
        var valueB = await transactionB.ExecuteAsync(m => m.ReadHoldingRegistersAsync(7, 0, 1));

        Assert.Equal(777, valueB[0]);                            // B's own device, not A's 111
        Assert.Equal(generationBefore, bus.LinkGeneration);       // and over A's link, not a rebuilt one
        Assert.Equal(1, bus.ResynchronisationCount);
        Assert.True(bus.LastResynchronisationBytesDiscarded > 0,
            "the resynchronisation must have actually discarded A's stale frame, not merely waited");
    }

    /// <summary>
    /// An already-cancelled token is refused at the arbitration gate and puts nothing on the wire.
    ///
    /// <para><b>Which mechanism does this, stated precisely, because my first version of this test was vague
    /// about it in a way that would have been wrong.</b> It is mechanism #1 and ONLY mechanism #1:
    /// <c>SemaphoreSlim.WaitAsync(ct)</c> throws for an already-cancelled token even when the semaphore is
    /// free, so an already-cancelled caller can never reach the transaction at all. The abort flag would NOT
    /// have saved this case — it gates <c>Read</c>, and NModbus writes the request BEFORE it reads, so a
    /// transaction that got as far as <c>ExecuteAsync</c> would have transmitted. That is not a defect: it is
    /// the documented in-flight path, where the request does reach the wire, the read aborts, and the bus is
    /// quarantined for it. The comment this replaces implied either mechanism would do, and the assertion
    /// below (nothing written) is only true of the first.</para>
    /// </summary>
    [Fact]
    public async Task ATransactionBegunWithAnAlreadyCancelledToken_IsRefusedAtTheArbitrationGate_WithoutReachingTheWire()
    {
        await using var harness = ModbusRtuLoopbackHarness.Start(((byte)1, new ushort[] { 5, 0 }));
        await using var lease = harness.Lease();
        var bus = lease.Bus;

        // Open the link first with a live token, so the failure below cannot be blamed on the connect.
        await using (var warmup = await bus.BeginTransactionAsync(1_000, 0, CancellationToken.None))
        {
            await warmup.ExecuteAsync(m => m.ReadHoldingRegistersAsync(1, 0, 1));
        }

        var bytesBefore = harness.Links.Master.BytesWritten;

        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => bus.BeginTransactionAsync(1_000, 0, cts.Token));

        Assert.Equal(bytesBefore, harness.Links.Master.BytesWritten);
        // And nothing was quarantined, because nothing was outstanding.
        Assert.False(bus.IsDesynchronised);
    }

    /// <summary>
    /// 🔴 A cancellation landing BETWEEN two registers of a poll leaves the bus CLEAN — nothing is
    /// outstanding on the wire, so no other device on the bus pays a quiet window for it.
    ///
    /// <para>This closes the one mutation D-2 shipped surviving. I reported that
    /// <c>ct.ThrowIfCancellationRequested()</c> between registers could not be scheduled deterministically
    /// without making the test link's <c>Read</c> diverge from the production one. <b>The reviewer was right
    /// and I was wrong:</b> a pass-through decorator that cancels the token AFTER the last byte of a response
    /// has been handed over only OBSERVES the read, changing no semantics on either link — the token is then
    /// certainly cancelled by the time the driver returns from register 1 and reaches the check before
    /// register 2. Recorded rather than quietly fixed, because my stated reason for leaving it was the wrong
    /// kind of argument: I concluded "no test can reach this" without asking whether a different instrument
    /// could.</para>
    ///
    /// <para>The discriminating assertion is <see cref="ModbusBus.IsDesynchronised"/> being FALSE. Without
    /// the check, the driver issues register 2's request, the abort unblocks it, and the bus is quarantined —
    /// correct, but it costs every other device on the bus a quiet window on every driver teardown.</para>
    /// </summary>
    [Fact]
    public async Task CancellingBetweenTwoRegistersOfAPoll_LeavesTheBusClean()
    {
        await using var harness = ModbusRtuLoopbackHarness.Start(((byte)1, new ushort[] { 235, 0xFFFF }));
        using var cts = new CancellationTokenSource();

        // Cancel once the device has delivered a COMPLETE first response — i.e. while the driver is between
        // register 1 and register 2. Purely an observer: it forwards every call through unchanged.
        var observed = 0;
        var link = new CancelAfterNthReadLink(
            harness.Links.Master,
            onRead: () =>
            {
                // NModbus reads an RTU response in two calls (4-byte header, then the remainder), so the
                // second completes register 1's frame.
                if (Interlocked.Increment(ref observed) == 2) cts.Cancel();
            });

        var lease = harness.Registry.Acquire("between-registers-bus", _ => Task.FromResult<IModbusBusLink>(link));
        await using var driver = new ModbusRtuDriver(lease, ModbusRtuLoopbackHarness.BuildMap("PLC-BETWEEN"));

        var readTask = Task.Run(async () =>
        {
            await foreach (var _ in driver.ReadAsync(cts.Token)) { }
        });

        var settled = await Task.WhenAny(readTask, Task.Delay(TimeSpan.FromSeconds(15)));
        Assert.Same(readTask, settled);
        try { await readTask; } catch (OperationCanceledException) { }

        Assert.True(cts.IsCancellationRequested, "the decorator must actually have cancelled, or this proves nothing");
        Assert.False(lease.Bus.IsDesynchronised,
            "a cancellation between two registers leaves nothing outstanding on the wire, so the bus must not be quarantined");
        Assert.Equal(0, lease.Bus.ResynchronisationCount);

        await lease.DisposeAsync();
    }

    /// <summary>A pass-through <see cref="IModbusBusLink"/> that runs <paramref name="onRead"/> after each
    /// <see cref="Read"/> returns. It observes and never alters: no buffering, no reordering, no change to
    /// what any read returns or when. That is what makes it safe to use for scheduling — the link under test
    /// behaves exactly as it does in production.</summary>
    private sealed class CancelAfterNthReadLink(IModbusBusLink inner, Action onRead) : IModbusBusLink
    {
        public int InfiniteTimeout => inner.InfiniteTimeout;
        public int ReadTimeout { get => inner.ReadTimeout; set => inner.ReadTimeout = value; }
        public int WriteTimeout { get => inner.WriteTimeout; set => inner.WriteTimeout = value; }
        public bool IsOpen => inner.IsOpen;

        public int Read(byte[] buffer, int offset, int count)
        {
            var read = inner.Read(buffer, offset, count);
            onRead();
            return read;
        }

        public void Write(byte[] buffer, int offset, int count) => inner.Write(buffer, offset, count);
        public int DrainBufferedInput() => inner.DrainBufferedInput();
        public void DiscardInBuffer() => inner.DiscardInBuffer();
        public void AbortPendingRead() => inner.AbortPendingRead();
        public void ResetAbort() => inner.ResetAbort();
        public void Dispose() { /* the harness owns the inner link's lifetime */ }
    }

    private static async Task WaitUntilAsync(Func<bool> predicate, string because)
    {
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(10);
        while (DateTime.UtcNow < deadline)
        {
            if (predicate()) return;
            await Task.Delay(10);
        }

        Assert.True(predicate(), $"timed out waiting for: {because}");
    }
}
