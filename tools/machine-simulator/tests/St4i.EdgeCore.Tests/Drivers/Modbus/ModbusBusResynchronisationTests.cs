using NModbus;
using St4i.EdgeCore.Drivers.Modbus;
using Xunit;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// Task D-2 — <b>"a timeout leaves the bus in a state where the next transaction is trustworthy — prove it,
/// do not assert it."</b>
///
/// <para>The proof has three parts and needs all of them.
/// <see cref="RawNModbus_WhenAFrameLandsJustAfterTheRequest_ReturnsItAsThatRequestsAnswer"/> establishes that
/// the hazard is REAL against the exact NModbus build this product ships — a stale RTU frame with a matching
/// slave address, function code and length is returned to the caller as the answer, silently, with no
/// exception. <see cref="AfterATimeout_ALateFrameThatArrivesBeforeTheNextRequest_IsDiscarded_AndTheCorrectValueIsRead"/>
/// shows the quarantine running and paying for that frame. And
/// <see cref="ALateBurstThatOutlastsTheQuietWindow_RestartsIt_AndTheBusWaitsForRealSilence"/> is the one that
/// discriminates the quiet window from a fixed delay — without a restarting window it fails, whereas the
/// middle test would still pass on NModbus's own per-request purge alone. Everything here is only interesting
/// because the first one is true; without it, a green "the second read was correct" would be
/// indistinguishable from a bus that was never at risk.</para>
/// </summary>
public class ModbusBusResynchronisationTests
{
    /// <summary>
    /// 🔴 <b>The hazard, demonstrated against raw NModbus with no <see cref="ModbusBus"/> involved at all.</b>
    /// A frame answering register 0 arrives just after a request for register 99 goes out; NModbus returns
    /// register 0's value as register 99's answer, silently, with no exception. Nothing is wrong with NModbus:
    /// an RTU response frame is a slave address, a function code, a byte count, the data and a CRC, and every
    /// one of those matches. There is simply nothing left to check — which is why RTU needs a
    /// resynchronisation step and Modbus TCP, whose MBAP header carries a transaction id, does not.
    ///
    /// <para><b>The frame must land AFTER the request is written, and getting that wrong was itself a finding.</b>
    /// The first version of this test planted the stale frame BEFORE the transaction and expected the same
    /// outcome. It did not happen — because <c>ModbusSerialTransport</c> calls <c>DiscardInBuffer()</c> once
    /// before writing each request, and <see cref="InMemoryBusLink"/> (like
    /// <see cref="St4i.EdgeCore.Drivers.Modbus.GatewayTcpBusLink"/>, and unlike NModbus's own
    /// <c>TcpClientAdapter</c>) actually implements it, so the planted frame was purged and the read timed
    /// out instead. That sharpens the whole design rather than contradicting it: NModbus's built-in purge
    /// already covers a late frame that has ALREADY arrived, and what
    /// <see cref="St4i.EdgeCore.Drivers.Modbus.ModbusBus"/>'s quiet window adds is converting the
    /// <i>still-in-flight</i> case — the one below, which the purge cannot see — into the already-arrived one.
    /// <see cref="LateFrameStream"/> reproduces exactly that instant, deterministically, with no timing race.</para>
    /// </summary>
    [Fact]
    public async Task RawNModbus_WhenAFrameLandsJustAfterTheRequest_ReturnsItAsThatRequestsAnswer()
    {
        // A complete, CRC-valid response to "unit 1, FC03, 1 register" carrying 111 — delivered at the exact
        // moment the request for register 99 hits the wire.
        var stream = new LateFrameStream(AppendCrc(new byte[] { 0x01, 0x03, 0x02, 0x00, 0x6F }));

        var factory = new ModbusFactory();
        var transport = factory.CreateRtuTransport(stream);
        transport.Retries = 0;
        transport.ReadTimeout = 1_000;
        transport.WriteTimeout = 1_000;
        using var master = factory.CreateMaster(transport);

        var answer = await master.ReadHoldingRegistersAsync(1, 99, 1);

        // Asked for register 99, received register 0's value. Asserted rather than merely narrated so this
        // fails loudly if a future NModbus starts detecting it — which would be excellent news and would mean
        // this design can be revisited.
        Assert.Equal(111, answer[0]);
        Assert.True(stream.DiscardCalls > 0, "NModbus did purge the buffer first — the frame simply arrived after it");
    }

    /// <summary>
    /// 🔴 <b>The quiet window is a window of OBSERVED SILENCE, not a fixed delay — and this is the test that
    /// tells the two apart.</b> A link that keeps producing bytes for far more drains than the window is worth
    /// must not be declared quiet; the window has to restart on every byte.
    ///
    /// <para>Deterministic on CALL COUNTS, not on the clock. <see cref="DrainScriptedLink"/> reports bytes on
    /// its first <c>N</c> drains and nothing afterwards, so a window that restarts must make MORE than <c>N</c>
    /// drain calls, whereas a fixed delay would return after roughly
    /// <c>QuietWindowMs / PollSliceMs</c> of them no matter what the link said. With N = 40 against a window
    /// worth ~10 polls the two answers cannot be confused, and neither depends on timer resolution — which
    /// matters, because an earlier version of this test drove the burst with <c>Task.Delay(4)</c> and was at
    /// the mercy of Windows' ~15 ms timer granularity.</para>
    /// </summary>
    [Fact]
    public async Task ALinkThatKeepsProducingBytes_RestartsTheQuietWindow_RatherThanExpiringOnASchedule()
    {
        const int noisyDrains = 10;
        const int bytesPerDrain = 3;
        const int quietWindowMs = 200;

        await using var harness = ModbusRtuLoopbackHarness.Start(((byte)1, new ushort[] { 111, 222 }));
        var link = new DrainScriptedLink(harness.Links.Master, noisyDrains, bytesPerDrain);
        var lease = harness.Registry.Acquire(
            "restarting-window-bus",
            _ => Task.FromResult<IModbusBusLink>(link),
            new ModbusBusSettings(QuietWindowMs: quietWindowMs, PollSliceMs: 4));
        var bus = lease.Bus;

        // Quarantine the bus with a genuine timeout: the device answers, but its answer is captured.
        harness.Links.Device.HoldWrites = true;
        await using (var timedOut = await bus.BeginTransactionAsync(readTimeoutMs: 200, retries: 0, CancellationToken.None))
        {
            await AssertFailsPromptlyAsync(timedOut.ExecuteAsync(m => m.ReadHoldingRegistersAsync(1, 0, 1)));
        }
        Assert.True(bus.IsDesynchronised);
        // The device's stale answer to the timed-out request lands on the line too — a real frame, alongside
        // the scripted noise, so the exact byte count below accounts for both rather than only the script.
        harness.Links.Device.ReleaseHeldWrites();
        await WaitUntilAsync(() => harness.Links.Master.BufferedInputCount > 0, "the stale frame to land");
        var staleBytes = harness.Links.Master.BufferedInputCount;

        var drainsBefore = link.DrainCalls;

        await using (var recovered = await bus.BeginTransactionAsync(readTimeoutMs: 5_000, retries: 0, CancellationToken.None))
        {
            var msSinceTheLastByte = Environment.TickCount64 - link.LastNoisyDrainAt;
            var drainsDuringResynchronisation = link.DrainCalls - drainsBefore;

            // 🔴 THE discriminating assertion, and it took a surviving mutation to find the right one. My
            // first version asserted only `drains > noisyDrains`, and the mutation that deletes
            // `lastByteAt = now` SURVIVED it — because the quiet check sits in an `else if` that a
            // bytes-were-drained iteration skips entirely, so the loop keeps going through the noisy phase
            // either way. What the mutation actually destroys is the TRAILING silence: without it,
            // `lastByteAt` stays pinned at resynchronisation start, so the very FIRST zero-drain after the
            // noise exits immediately instead of waiting a full window from the last byte. Measured from the
            // last byte, that is the difference between ~one poll slice and a full 200 ms.
            Assert.True(msSinceTheLastByte >= quietWindowMs,
                $"the bus began its transaction {msSinceTheLastByte} ms after the last byte on the line, which is less " +
                $"than the {quietWindowMs} ms quiet window — the window is expiring on a schedule rather than being " +
                "measured from the last observed byte");

            // Kept as the weaker sanity check it is: it proves the loop did not give up mid-noise.
            Assert.True(drainsDuringResynchronisation > noisyDrains,
                $"the resynchronisation gave up after {drainsDuringResynchronisation} drains while the link was still " +
                $"producing bytes on its first {noisyDrains}");

            var value = await recovered.ExecuteAsync(m => m.ReadHoldingRegistersAsync(1, 1, 1));
            Assert.Equal(222, value[0]);
        }

        // Every scripted byte AND the real stale frame were paid for, not slept through.
        Assert.Equal((noisyDrains * bytesPerDrain) + staleBytes, bus.LastResynchronisationBytesDiscarded);
        Assert.False(bus.IsDesynchronised);

        await lease.DisposeAsync();
    }

    /// <summary>
    /// A link that reports <paramref name="bytesPerDrain"/> discarded bytes on each of its first
    /// <paramref name="noisyDrains"/> <see cref="DrainBufferedInput"/> calls and nothing afterwards, delegating
    /// everything else to <paramref name="inner"/>. Scripted on CALL COUNT rather than on elapsed time so the
    /// tests that use it cannot be decided by timer granularity — see
    /// <see cref="ALinkThatKeepsProducingBytes_RestartsTheQuietWindow_RatherThanExpiringOnASchedule"/>.
    /// <paramref name="noisyDrains"/> of <see cref="int.MaxValue"/> is a link that never goes quiet at all.
    /// </summary>
    private sealed class DrainScriptedLink(IModbusBusLink inner, int noisyDrains, int bytesPerDrain) : IModbusBusLink
    {
        private int _drainCalls;
        private long _lastNoisyDrainAt;
        private volatile bool _forcedQuiet;

        public int DrainCalls => Volatile.Read(ref _drainCalls);

        /// <summary>The tick at which this link last reported a byte. The tests measure the quiet window from
        /// HERE rather than from when the resynchronisation started — that difference is exactly what the
        /// "window restarts on a byte" behaviour is, and asserting anything else lets a mutation that deletes
        /// it survive.</summary>
        public long LastNoisyDrainAt => Volatile.Read(ref _lastNoisyDrainAt);

        /// <summary>Stops the scripted noise from this point on, whatever the call count says. Lets a test
        /// drive "noisy, then genuinely quiet" without having to predict how many drains the noisy phase will
        /// consume — a number that depends on the runtime's timer resolution and is exactly the kind of
        /// guess that makes a test flaky.</summary>
        public void GoQuiet() => _forcedQuiet = true;

        public int InfiniteTimeout => inner.InfiniteTimeout;
        public int ReadTimeout { get => inner.ReadTimeout; set => inner.ReadTimeout = value; }
        public int WriteTimeout { get => inner.WriteTimeout; set => inner.WriteTimeout = value; }
        public bool IsOpen => inner.IsOpen;

        public int DrainBufferedInput()
        {
            var call = Interlocked.Increment(ref _drainCalls);
            var real = inner.DrainBufferedInput();
            var noisy = !_forcedQuiet && call <= noisyDrains;
            if (noisy || real > 0) Volatile.Write(ref _lastNoisyDrainAt, Environment.TickCount64);
            return noisy ? real + bytesPerDrain : real;
        }

        public void DiscardInBuffer() => inner.DiscardInBuffer();
        public void AbortPendingRead() => inner.AbortPendingRead();
        public void ResetAbort() => inner.ResetAbort();
        public int Read(byte[] buffer, int offset, int count) => inner.Read(buffer, offset, count);
        public void Write(byte[] buffer, int offset, int count) => inner.Write(buffer, offset, count);
        public void Dispose() { /* the harness owns the inner link's lifetime */ }
    }

    /// <summary>An <c>IStreamResource</c> whose canned response is delivered only once the request has been
    /// WRITTEN — i.e. after <c>ModbusSerialTransport</c>'s own pre-request <c>DiscardInBuffer()</c> has already
    /// run. That models "the stale frame was still in flight when the next request went out", which is the one
    /// case NModbus's built-in purge structurally cannot cover. Deterministic: no delay, no race.</summary>
    private sealed class LateFrameStream(byte[] frameToDeliverAfterTheNextWrite) : NModbus.IO.IStreamResource
    {
        private readonly Queue<byte> _inbox = new();

        public int DiscardCalls { get; private set; }

        public int InfiniteTimeout => -1;
        public int ReadTimeout { get; set; } = -1;
        public int WriteTimeout { get; set; } = -1;

        public void DiscardInBuffer()
        {
            DiscardCalls++;
            _inbox.Clear();
        }

        public void Write(byte[] buffer, int offset, int count)
        {
            foreach (var b in frameToDeliverAfterTheNextWrite) _inbox.Enqueue(b);
        }

        public int Read(byte[] buffer, int offset, int count)
        {
            if (_inbox.Count == 0) throw new TimeoutException("LateFrameStream: nothing left to deliver");
            var n = Math.Min(count, _inbox.Count);
            for (var i = 0; i < n; i++) buffer[offset + i] = _inbox.Dequeue();
            return n;
        }

        public void Dispose() { }
    }

    /// <summary>
    /// The same stale frame, over a real <see cref="ModbusBus"/>. The bus was quarantined by the timeout, so
    /// the next transaction drains the frame before writing and the caller gets the value it asked for.
    /// </summary>
    [Fact]
    public async Task AfterATimeout_ALateFrameThatArrivesBeforeTheNextRequest_IsDiscarded_AndTheCorrectValueIsRead()
    {
        await using var harness = ModbusRtuLoopbackHarness.Start(((byte)1, new ushort[] { 111, 222 }));
        await using var lease = harness.Lease();
        var bus = lease.Bus;

        // Transaction 1: the device answers, but its answer is captured rather than delivered — the master
        // times out on a device that did in fact reply.
        harness.Links.Device.HoldWrites = true;

        await using (var timedOut = await bus.BeginTransactionAsync(readTimeoutMs: 300, retries: 0, CancellationToken.None))
        {
            await AssertFailsPromptlyAsync(timedOut.ExecuteAsync(m => m.ReadHoldingRegistersAsync(1, 0, 1)));
        }

        Assert.True(bus.IsDesynchronised, "a timed-out transaction must quarantine the bus");

        // The late answer lands now — after the master gave up, before the next request.
        harness.Links.Device.ReleaseHeldWrites();
        await WaitUntilAsync(() => harness.Links.Master.BufferedInputCount > 0, "the late frame to land on the line");
        var staleBytes = harness.Links.Master.BufferedInputCount;
        Assert.True(staleBytes > 0, "the stale frame must genuinely be on the line, or this test proves nothing");

        // Transaction 2 asks for a DIFFERENT register. Without the resynchronisation this would return
        // register 0's stale 111 (see RawNModbus_... above); with it, register 1's 222.
        await using (var recovered = await bus.BeginTransactionAsync(readTimeoutMs: 3_000, retries: 0, CancellationToken.None))
        {
            var value = await recovered.ExecuteAsync(m => m.ReadHoldingRegistersAsync(1, 1, 1));
            Assert.Equal(222, value[0]);
        }

        Assert.False(bus.IsDesynchronised, "a successful transaction must leave the bus clean");
        Assert.Equal(1, bus.ResynchronisationCount);
        Assert.Equal(staleBytes, bus.LastResynchronisationBytesDiscarded);
        Assert.Equal(1, bus.LinkGeneration);
    }

    /// <summary>
    /// 🔴 A REBUILT link does not clear the quarantine. Found by a surviving mutation, and the survival was
    /// honest: nothing here exercised a link rebuild at all, because the in-memory harness hands out the same
    /// link object every time. This test gives the bus an opener that returns a genuinely NEW link each call,
    /// faults the old one, and asserts the quarantine is still owed afterwards.
    ///
    /// <para>Why the conservative answer is the right one: for TCP a fresh socket genuinely cannot carry the
    /// old one's bytes, so clearing would be safe — but D-3's serial link re-opens a COM port, which purges
    /// the local UART buffer and tells the DEVICE on the far end nothing. A slave mid-transmission is still
    /// mid-transmission. Being right for one transport and wrong for the other, where the wrong version
    /// returns a plausible number, is not a trade worth one quiet window.</para>
    /// </summary>
    [Fact]
    public async Task AFreshlyOpenedLink_DoesNotClearTheQuarantine()
    {
        await using var registry = new ModbusBusRegistry();
        var opened = 0;
        var links = new List<InMemoryBusLinkPair>();

        var lease = registry.Acquire(
            "rebuilt-link-bus",
            _ =>
            {
                opened++;
                var pair = InMemoryBusLinkPair.Create();
                links.Add(pair);
                return Task.FromResult<IModbusBusLink>(pair.Master);
            },
            new ModbusBusSettings(QuietWindowMs: 20, PollSliceMs: 4));
        var bus = lease.Bus;

        // Nothing ever answers, so this times out and quarantines the bus.
        await using (var timedOut = await bus.BeginTransactionAsync(readTimeoutMs: 150, retries: 0, CancellationToken.None))
        {
            await AssertFailsPromptlyAsync(timedOut.ExecuteAsync(m => m.ReadHoldingRegistersAsync(1, 0, 1)));
        }
        Assert.Equal(1, opened);
        Assert.True(bus.IsDesynchronised);

        // Kill the link out from under the bus, so the next transaction must open a brand-new one.
        links[0].Master.Dispose();
        Assert.False(links[0].Master.IsOpen);

        var resynchronisationsBefore = bus.ResynchronisationCount;

        await using (var rebuilt = await bus.BeginTransactionAsync(readTimeoutMs: 150, retries: 0, CancellationToken.None))
        {
            // A second link really was opened...
            Assert.Equal(2, opened);
            Assert.Equal(2, bus.LinkGeneration);
        }

        // ...and the quarantine was still honoured across the rebuild rather than being cleared by it.
        Assert.Equal(resynchronisationsBefore + 1, bus.ResynchronisationCount);

        await lease.DisposeAsync();
    }

    /// <summary>
    /// 🔴 <c>Transport.Retries</c> is honoured — exactly ONE request frame reaches the wire on a timeout.
    /// Found by a surviving mutation: nothing counted request frames, so leaving <c>Retries</c> at NModbus's
    /// own default (probed: <b>3</b>) went unnoticed. This is the RTU counterpart of Đợt B's own
    /// <c>WriteSetpointAsync_OnTimeout_TransportNeverRetries_ExactlyOneRequestReachesTheWire</c>, and it
    /// matters more here than for a read: D-5's write path rides on this same bus, and a silently retried
    /// write is a physical double-actuation.
    /// </summary>
    [Fact]
    public async Task ATimedOutTransaction_PutsExactlyOneRequestOnTheWire_NeverARetry()
    {
        await using var harness = ModbusRtuLoopbackHarness.Start(((byte)1, new ushort[] { 7, 0 }));
        await using var lease = harness.Lease();
        var bus = lease.Bus;

        // The device receives the request and answers, but its answer is captured — so the master times out
        // having genuinely transmitted, which is the only state in which a retry could happen.
        harness.Links.Device.HoldWrites = true;
        var before = harness.Links.Master.BytesWritten;

        await using (var timedOut = await bus.BeginTransactionAsync(readTimeoutMs: 200, retries: 0, CancellationToken.None))
        {
            await AssertFailsPromptlyAsync(timedOut.ExecuteAsync(m => m.ReadHoldingRegistersAsync(1, 0, 1)));
        }

        // One FC03 RTU request frame is exactly 8 bytes: unit + fc + addr(2) + count(2) + crc(2).
        Assert.Equal(8, harness.Links.Master.BytesWritten - before);
    }

    /// <summary>A clean transaction leaves the bus clean and costs the NEXT one nothing — the control for
    /// every test above. Without it, a bus that quarantined itself after EVERY transaction would pass all of
    /// them while making the product uselessly slow.</summary>
    [Fact]
    public async Task ASuccessfulTransaction_LeavesTheBusClean_AndTheNextOneDoesNotResynchronise()
    {
        await using var harness = ModbusRtuLoopbackHarness.Start(((byte)1, new ushort[] { 9, 0 }));
        await using var lease = harness.Lease();
        var bus = lease.Bus;

        for (var i = 0; i < 3; i++)
        {
            await using var transaction = await bus.BeginTransactionAsync(2_000, 0, CancellationToken.None);
            var value = await transaction.ExecuteAsync(m => m.ReadHoldingRegistersAsync(1, 0, 1));
            Assert.Equal(9, value[0]);
        }

        Assert.False(bus.IsDesynchronised);
        Assert.Equal(0, bus.ResynchronisationCount);
        Assert.Equal(1, bus.LinkGeneration);
    }

    /// <summary>A transaction that never executed anything is clean — nothing reached the wire, so nothing is
    /// owed. This is the case a cancelled-while-queued caller produces, and quarantining for it would make
    /// every cancellation cost the whole bus a quiet window for no reason.</summary>
    [Fact]
    public async Task ATransactionThatExecutedNothing_LeavesTheBusClean()
    {
        await using var harness = ModbusRtuLoopbackHarness.Start();
        await using var lease = harness.Lease();
        var bus = lease.Bus;

        await using (await bus.BeginTransactionAsync(1_000, 0, CancellationToken.None)) { }

        Assert.False(bus.IsDesynchronised);
    }

    /// <summary>
    /// 🔴 A bus that will not go quiet is REFUSED, not read from. This is the honest end of the design: if the
    /// line keeps emitting, no amount of waiting makes the next answer attributable, so the transaction fails
    /// and the link is torn down rather than returning a number that looks fine.
    /// </summary>
    [Fact]
    public async Task ABusThatNeverGoesQuiet_RefusesTheTransaction_AndFaultsTheLink()
    {
        var links = InMemoryBusLinkPair.Create();
        await using var registry = new ModbusBusRegistry();

        // A link that reports bytes on EVERY drain — it can never be observed silent, deterministically, with
        // no background writer and therefore no dependence on timer granularity.
        var babbling = new DrainScriptedLink(links.Master, noisyDrains: int.MaxValue, bytesPerDrain: 1);

        var openCount = 0;
        var lease = registry.Acquire(
            "babbling-bus",
            _ => { openCount++; return Task.FromResult<IModbusBusLink>(babbling); },
            new ModbusBusSettings(QuietWindowMs: 30, PollSliceMs: 2));
        var bus = lease.Bus;

        // Put the bus into quarantine via a genuine timeout (nothing ever answers).
        await using (var timedOut = await bus.BeginTransactionAsync(readTimeoutMs: 100, retries: 0, CancellationToken.None))
        {
            await AssertFailsPromptlyAsync(timedOut.ExecuteAsync(m => m.ReadHoldingRegistersAsync(1, 0, 1)));
        }
        Assert.True(bus.IsDesynchronised);
        Assert.Equal(1, openCount);

        var generationBefore = bus.LinkGeneration;

        await Assert.ThrowsAsync<ModbusBusResynchronisationException>(
            () => bus.BeginTransactionAsync(readTimeoutMs: 200, retries: 0, CancellationToken.None));

        Assert.True(bus.IsDesynchronised);

        // 🔴 "AndFaultsTheLink" is in this test's title, and until now the only thing after the refusal was a
        // re-assertion of IsDesynchronised — which was ALREADY true before the refusal, so it could not
        // distinguish a faulted link from an untouched one. Found by mutation: deleting TearDownLink() from
        // FaultLink() left all 153 Modbus tests green, and would have made BOTH
        // ModbusBusResynchronisationException messages false where they say "the link has been torn down and
        // will be rebuilt before the next transaction" — a message an operator would act on.
        //
        // The link is torn down, so the NEXT attempt must OPEN A NEW ONE. The line goes quiet first, so this
        // asserts the rebuild rather than another refusal.
        babbling.GoQuiet();
        await using (await bus.BeginTransactionAsync(readTimeoutMs: 200, retries: 0, CancellationToken.None))
        {
            Assert.Equal(2, openCount);
            Assert.Equal(generationBefore + 1, bus.LinkGeneration);
        }

        await lease.DisposeAsync();
    }

    /// <summary>The arbitration lock is released when a resynchronisation refuses a transaction. Without this,
    /// one babbling episode would wedge the whole bus forever and every later transaction would hang rather
    /// than fail — the shape of bug that is hardest to attribute.</summary>
    [Fact]
    public async Task WhenAResynchronisationRefusesATransaction_TheArbitrationLockIsStillReleased()
    {
        var links = InMemoryBusLinkPair.Create();
        await using var registry = new ModbusBusRegistry();

        // Noisy until this test says otherwise, so the FIRST attempt is certain to be refused and the SECOND
        // is certain to be able to succeed — neither outcome depends on how many drains the refusal happened
        // to consume.
        var scripted = new DrainScriptedLink(links.Master, noisyDrains: int.MaxValue, bytesPerDrain: 1);
        var lease = registry.Acquire(
            "lock-release-bus",
            _ => Task.FromResult<IModbusBusLink>(scripted),
            new ModbusBusSettings(QuietWindowMs: 30, PollSliceMs: 2));
        var bus = lease.Bus;

        await using (var timedOut = await bus.BeginTransactionAsync(readTimeoutMs: 100, retries: 0, CancellationToken.None))
        {
            await AssertFailsPromptlyAsync(timedOut.ExecuteAsync(m => m.ReadHoldingRegistersAsync(1, 0, 1)));
        }

        await Assert.ThrowsAsync<ModbusBusResynchronisationException>(
            () => bus.BeginTransactionAsync(readTimeoutMs: 200, retries: 0, CancellationToken.None));

        scripted.GoQuiet();

        // The bus must be reachable again — which it can only be if the refused transaction released the lock.
        // Bounded so a wedged lock FAILS this test instead of hanging the suite.
        var second = bus.BeginTransactionAsync(readTimeoutMs: 500, retries: 0, CancellationToken.None);
        var completed = await Task.WhenAny(second, Task.Delay(TimeSpan.FromSeconds(10)));
        Assert.Same(second, completed);
        await (await second).DisposeAsync();

        await lease.DisposeAsync();
    }

    /// <summary>
    /// Awaits an operation that is EXPECTED to fail, and fails the test if it does not settle promptly.
    ///
    /// <para>Found by mutation, twice. Removing the bus's <c>Transport.ReadTimeout</c> assignment (leaving
    /// NModbus's own default of -1, i.e. infinite — probed) turned every "this should time out" assertion in
    /// this file into a HANG: the mutation harness's own 420 s kill produced no verdict line at all, which is
    /// verify-suites' trap #3 wearing a different costume. A test that hangs under a defect is strictly worse
    /// than one that fails under it — a failure names the defect, a hang names nothing and reads as
    /// infrastructure trouble. The bound is 15 s, far above any legitimate timeout these tests configure
    /// (the largest is 300 ms) and far below anything that would make a hang look like a slow pass.</para>
    /// </summary>
    private static async Task AssertFailsPromptlyAsync(Task operation)
    {
        var settled = await Task.WhenAny(operation, Task.Delay(TimeSpan.FromSeconds(15)));
        Assert.True(ReferenceEquals(settled, operation),
            "the operation was expected to fail within its configured timeout, but was still running after 15 s — " +
            "the read is not bounded at all");
        await Assert.ThrowsAnyAsync<Exception>(() => operation);
    }

    private static byte[] AppendCrc(byte[] pdu)
    {
        ushort crc = 0xFFFF;
        foreach (var b in pdu)
        {
            crc ^= b;
            for (var i = 0; i < 8; i++)
                crc = (crc & 1) != 0 ? (ushort)((crc >> 1) ^ 0xA001) : (ushort)(crc >> 1);
        }

        var framed = new byte[pdu.Length + 2];
        Array.Copy(pdu, framed, pdu.Length);
        framed[pdu.Length] = (byte)(crc & 0xFF);
        framed[pdu.Length + 1] = (byte)(crc >> 8);
        return framed;
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
