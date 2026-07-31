using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers.Modbus;
using Xunit;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// Task B-4 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-4-brief.md) — the write and
/// command-execution proof for <see cref="ModbusTcpDriver"/>: a real in-process NModbus TCP slave
/// (<see cref="ModbusLoopbackHarness"/>, the SAME harness <see cref="ModbusTcpDriverLoopbackTests"/> and the
/// conformance suite already use) for the "reaches the device" cases, and a hand-rolled raw Modbus-TCP
/// responder (mirroring <c>ModbusTcpDriverConformanceTests.RunOnePollThenGoProtocolSilentAsync</c>'s own
/// technique) wherever the test needs to observe or control the EXACT bytes on the wire — a genuine timeout,
/// a genuine device-level rejection, or exactly which coil/value a command actually sent.
///
/// <para>Deliberately a NEW file — <see cref="ModbusTcpDriverLoopbackTests"/> and the conformance suite stay
/// completely unchanged (the brief's own "extend, never weaken" instruction); only <see cref="ModbusLoopbackHarness"/>
/// gained one new, purely-additive property (<see cref="ModbusLoopbackHarness.RunningSlave.Slave"/>).</para>
/// </summary>
public sealed class ModbusTcpDriverWriteTests
{
    // ─────────────────────────────────────────────────────────────────────
    // Map builders
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>A map with ONE writable Holding register ("speed", address 5, declared range [0,500]) and
    /// ONE command ("start-cycle", coil 3) — everything these tests need, nothing more.</summary>
    private static ModbusRegisterMap BuildWritableMap(string machineCode, int? readTimeoutMs = null, int pollIntervalMs = 5_000) => new()
    {
        MachineCode = machineCode,
        UnitId = 1,
        PollIntervalMs = pollIntervalMs,
        ReadTimeoutMs = readTimeoutMs,
        Registers = new List<ModbusRegister>
        {
            new(Address: 5, Type: ModbusRegisterType.Holding, DataType: ModbusDataType.UInt16, Scale: 1.0, Metric: "speed", Unit: "rpm",
                Writable: new ModbusWritableRange(0, 500)),
        },
        Commands = new List<ModbusCommand>
        {
            new("start-cycle", CoilAddress: 3),
        },
    };

    /// <summary>Exactly the single writable register above, with NO commands — used by the concurrency test
    /// so a poll iteration only ever issues ONE read request (kept minimal/predictable on the wire).</summary>
    private static ModbusRegisterMap BuildSingleWritableRegisterMap(string machineCode, int readTimeoutMs, int pollIntervalMs) => new()
    {
        MachineCode = machineCode,
        UnitId = 1,
        PollIntervalMs = pollIntervalMs,
        ReadTimeoutMs = readTimeoutMs,
        Registers = new List<ModbusRegister>
        {
            new(Address: 5, Type: ModbusRegisterType.Holding, DataType: ModbusDataType.UInt16, Scale: 1.0, Metric: "speed", Unit: "rpm",
                Writable: new ModbusWritableRange(0, 500)),
        },
        Commands = Array.Empty<ModbusCommand>(),
    };

    // ─────────────────────────────────────────────────────────────────────
    // 1) A write within the declared range reaches the device and reports Applied.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task WriteSetpointAsync_WithinDeclaredRange_ReachesDevice_ReportsApplied()
    {
        await using var slave = ModbusLoopbackHarness.Start();
        await using var driver = new ModbusTcpDriver("127.0.0.1", slave.Port, BuildWritableMap("PLC-WRITE-OK"));

        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest("speed", 123.0), CancellationToken.None);

        Assert.Equal("speed", result.Point);
        Assert.Equal(WriteOutcome.Applied, result.Outcome);
        Assert.Null(result.RejectionReason);

        // The load-bearing assertion: read the value straight off the SLAVE's own DataStore — independent
        // of ModbusTcpDriver entirely — proving the write genuinely reached the "device", not merely that
        // our own code returned a success-shaped result.
        var raw = slave.Slave.DataStore.HoldingRegisters.ReadPoints(5, 1);
        Assert.Equal((ushort)123, raw[0]);
    }

    [Fact]
    public async Task WriteSetpointAsync_UnknownPoint_RejectedWithoutTouchingDevice()
    {
        await using var slave = ModbusLoopbackHarness.Start();
        await using var driver = new ModbusTcpDriver("127.0.0.1", slave.Port, BuildWritableMap("PLC-WRITE-UNKNOWN"));

        var before = slave.Slave.DataStore.HoldingRegisters.ReadPoints(5, 1)[0];
        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest("does-not-exist", 1.0), CancellationToken.None);

        Assert.Equal(WriteOutcome.Rejected, result.Outcome);
        Assert.Equal(SetpointRejectionReason.UnknownPoint, result.RejectionReason);
        Assert.Equal(before, slave.Slave.DataStore.HoldingRegisters.ReadPoints(5, 1)[0]);
    }

    [Fact]
    public async Task WriteSetpointAsync_OutOfDeclaredRange_RejectedWithoutTouchingDevice()
    {
        await using var slave = ModbusLoopbackHarness.Start();
        await using var driver = new ModbusTcpDriver("127.0.0.1", slave.Port, BuildWritableMap("PLC-WRITE-OOR"));

        var before = slave.Slave.DataStore.HoldingRegisters.ReadPoints(5, 1)[0];
        // B-3's own guarantee (ModbusRegister.TryComputeRawWordForWrite) — called, not re-derived: the
        // declared [0,500] range rejects 60000 before any I/O is attempted.
        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest("speed", 60000.0), CancellationToken.None);

        Assert.Equal(WriteOutcome.Rejected, result.Outcome);
        Assert.Equal(SetpointRejectionReason.OutOfRange, result.RejectionReason);
        Assert.Equal(before, slave.Slave.DataStore.HoldingRegisters.ReadPoints(5, 1)[0]);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2) A write that times out reports Indeterminate — and genuinely times out.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task WriteSetpointAsync_DeviceNeverResponds_GenuinelyTimesOut_ReportsIndeterminate()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;

        // 🔴 Task C-8 review round 1 (I-4) — bounded by its OWN deadline token, and AWAITED in teardown.
        //
        // This used to be a token-less `AcceptTcpClientAsync()` plus `Task.Delay(Timeout.Infinite)` with
        // no token, on a task nobody ever awaited. `listener.Stop()` cannot close an ALREADY-ACCEPTED
        // connection, so every run of this test unconditionally stranded a thread-pool task holding a
        // `TcpClient` whose `using` never ran. That is exactly the shape C-7's own mTLS fix described as
        // "the direct generator of the orphaned-`testhost` trap": a host process that is stopped but not
        // idle — which `scripts/verify-suites.sh`'s CPU heuristic structurally cannot see, because the
        // drip of leftover work is not flat, just stopped. Five sibling tests in this file already did it
        // correctly (deadline token on every await + an unconditional `await serverTask`); this now
        // matches them.
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        var acceptTask = Task.Run(async () =>
        {
            try
            {
                using var accepted = await listener.AcceptTcpClientAsync(deadline.Token).ConfigureAwait(false);
                // Accept, then go silent — but bounded, so teardown can actually end this task.
                await Task.Delay(Timeout.Infinite, deadline.Token).ConfigureAwait(false);
            }
            catch { /* deadline firing, or listener.Stop() below — both expected teardown */ }
        });

        const int boundMs = 300;
        await using var driver = new ModbusTcpDriver("127.0.0.1", port, BuildWritableMap("PLC-WRITE-TIMEOUT", readTimeoutMs: boundMs));

        var stopwatch = Stopwatch.StartNew();
        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest("speed", 42.0), CancellationToken.None);
        stopwatch.Stop();

        Assert.Equal(WriteOutcome.Indeterminate, result.Outcome);
        Assert.Null(result.RejectionReason);
        // Fix round 1 (review) — content, not just non-null: a vacuity class one level down from the one
        // the brief warned about (Detail could be ANY non-null string and this assertion would still pass).
        // This exact string is what Critical #2's NullReferenceException used to destroy — asserting it here
        // is what would have caught that regression directly, without needing the mutation test below too.
        Assert.Contains("write did not complete", result.Detail, StringComparison.Ordinal);

        // The load-bearing assertion this test exists to make: it GENUINELY waited out the bound rather
        // than approximating/short-circuiting it. Retries are forced to 0 for a write (see the no-retry
        // test below), so the wait is ~one WriteTimeout, not a multiple of it.
        Assert.True(stopwatch.Elapsed >= TimeSpan.FromMilliseconds(boundMs - 50),
            $"write returned after only {stopwatch.Elapsed} — too fast to have genuinely waited out a {boundMs}ms bound.");
        Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(5),
            $"write took {stopwatch.Elapsed} — unexpectedly slow for a single {boundMs}ms-bounded attempt with no retry.");

        listener.Stop();
        deadline.Cancel();
        try { await acceptTask; } catch { /* teardown */ }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3) Cancellation unblocks a stuck write promptly (ct.Register(DisposeConnection)) — measured.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task WriteSetpointAsync_CancelledMidFlight_UnblocksPromptly_ReportsIndeterminate()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;

        // 🔴 Task C-8 review round 1 (I-4) — see the first test in this file for the full reasoning:
        // token-less accept + un-tokened infinite delay + a task nobody awaits strands a live TcpClient
        // on every run, which is the orphaned-`testhost` shape C-7 fixed elsewhere.
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        var acceptTask = Task.Run(async () =>
        {
            try
            {
                using var accepted = await listener.AcceptTcpClientAsync(deadline.Token).ConfigureAwait(false);
                await Task.Delay(Timeout.Infinite, deadline.Token).ConfigureAwait(false);
            }
            catch { /* deadline firing, or listener.Stop() below — both expected teardown */ }
        });

        // Deliberately a LONG bound (30s): if cancellation did NOT promptly unblock the in-flight write,
        // this test would itself hang for ~30s rather than fail fast — the elapsed-time assertion below is
        // the actual proof, not a guess dressed up as one.
        await using var driver = new ModbusTcpDriver("127.0.0.1", port, BuildWritableMap("PLC-WRITE-CANCEL", readTimeoutMs: 30_000));

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));
        var stopwatch = Stopwatch.StartNew();
        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest("speed", 42.0), cts.Token);
        stopwatch.Stop();

        Assert.Equal(WriteOutcome.Indeterminate, result.Outcome);
        // Fix round 1 (review) — content, not just non-null (the same vacuity class one level down from the
        // brief's own warning): this is the exact string Critical #2's NullReferenceException replaced with
        // a generic "unexpected failure: Object reference not set..." message — asserting the real content
        // here is what would have caught that regression directly.
        Assert.Contains("cancelled before a definitive response arrived", result.Detail, StringComparison.Ordinal);
        Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(2),
            $"cancellation took {stopwatch.Elapsed} to unblock a write bounded by a 30s WriteTimeout — " +
            "ct.Register(DisposeConnection) should unblock it almost immediately (measured ~2ms on the read " +
            "path), not wait out anywhere close to the full bound.");

        listener.Stop();
        deadline.Cancel();
        try { await acceptTask; } catch { /* teardown */ }
    }

    /// <summary>The class doc comment's own claim ("DisposeAsync deliberately does NOT acquire _ioLock —
    /// mirrors FleetHost's own signed-off B-2 design") made concrete: <see cref="ModbusTcpDriver.DisposeAsync"/>
    /// itself must return promptly even while a write is genuinely stuck mid-flight on the SAME connection —
    /// never waiting, even boundedly, the same way B-2's own <c>FleetHost.Estop</c> proof requires of the
    /// FleetHost layer above this one.</summary>
    [Fact]
    public async Task DisposeAsync_WhileWriteIsStuckMidFlight_ReturnsPromptly_AndTheStuckWriteObservesIndeterminate()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;

        // 🔴 Task C-8 review round 1 (I-4) — see the first test in this file for the full reasoning:
        // token-less accept + un-tokened infinite delay + a task nobody awaits strands a live TcpClient
        // on every run, which is the orphaned-`testhost` shape C-7 fixed elsewhere.
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        var acceptTask = Task.Run(async () =>
        {
            try
            {
                using var accepted = await listener.AcceptTcpClientAsync(deadline.Token).ConfigureAwait(false);
                await Task.Delay(Timeout.Infinite, deadline.Token).ConfigureAwait(false);
            }
            catch { /* deadline firing, or listener.Stop() below — both expected teardown */ }
        });

        // Deliberately a LONG bound (30s) — same reasoning as the cancellation test above: if DisposeAsync
        // waited for this write, it would take ~30s, not merely be slow.
        var driver = new ModbusTcpDriver("127.0.0.1", port, BuildWritableMap("PLC-WRITE-DISPOSE", readTimeoutMs: 30_000));

        var writeTask = driver.WriteSetpointAsync(new SetpointWriteRequest("speed", 42.0), CancellationToken.None);
        await Task.Delay(TimeSpan.FromMilliseconds(200)); // let the write genuinely start and reach the connect+I/O phase.

        var stopwatch = Stopwatch.StartNew();
        await driver.DisposeAsync();
        stopwatch.Stop();

        Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(2),
            $"DisposeAsync took {stopwatch.Elapsed} while a write was still stuck mid-flight, bounded by a " +
            "30s WriteTimeout — disposal must never wait on an in-flight write, not even boundedly.");

        var completed = await Task.WhenAny(writeTask, Task.Delay(TimeSpan.FromSeconds(5)));
        Assert.Same(writeTask, completed);
        var result = await writeTask;
        Assert.Equal(WriteOutcome.Indeterminate, result.Outcome);
        // Fix round 1 (review) — content, not just the outcome enum. NOTE this write's own `ct` is
        // CancellationToken.None (DisposeAsync(), not the write's token, is what tears the connection down),
        // so `ct.IsCancellationRequested` is false throughout — this lands in the GENERIC failure catch, not
        // the cancellation-shaped one, and must still produce the real message, not the outer backstop's
        // generic "unexpected failure" (which is exactly what Critical #2's NullReferenceException produced
        // instead, before this fix).
        Assert.Contains("write did not complete", result.Detail, StringComparison.Ordinal);

        listener.Stop();
        deadline.Cancel();
        try { await acceptTask; } catch { /* teardown */ }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 1 (review, Critical #1) — a timed-out write must not leave a desynced connection behind:
    // the NEXT operation must reconnect from scratch, never reuse a connection whose in-flight response may
    // still be pending on the wire. Proven by counting how many separate TCP connections the driver opens
    // across two consecutive timed-out writes.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task WriteSetpointAsync_AfterATimeout_ForcesAFreshConnectionOnTheNextAttempt()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;

        var acceptCount = 0;
        var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var serverTask = Task.Run(async () =>
        {
            try
            {
                while (!deadline.IsCancellationRequested)
                {
                    var accepted = await listener.AcceptTcpClientAsync(deadline.Token).ConfigureAwait(false);
                    Interlocked.Increment(ref acceptCount);
                    // Never respond, never read further — hold EACH accepted connection open forever on its
                    // OWN background task (never blocking this loop), so the driver's own write against it
                    // times out client-side. If the driver (bug) reuses this SAME connection for its NEXT
                    // write, no second accept ever happens here; if it (fix) reconnects from scratch, this
                    // loop is free to accept a genuinely new one.
                    _ = Task.Run(async () =>
                    {
                        try { await Task.Delay(Timeout.Infinite, deadline.Token).ConfigureAwait(false); }
                        catch { /* deadline/teardown */ }
                        finally { try { accepted.Dispose(); } catch { } }
                    });
                }
            }
            catch { /* deadline firing, or listener.Stop() below — both expected teardown */ }
        });

        await using var driver = new ModbusTcpDriver("127.0.0.1", port, BuildWritableMap("PLC-DESYNC", readTimeoutMs: 300));

        var r1 = await driver.WriteSetpointAsync(new SetpointWriteRequest("speed", 111.0), CancellationToken.None);
        Assert.Equal(WriteOutcome.Indeterminate, r1.Outcome);

        var r2 = await driver.WriteSetpointAsync(new SetpointWriteRequest("speed", 222.0), CancellationToken.None);
        Assert.Equal(WriteOutcome.Indeterminate, r2.Outcome); // the server never responds to either — both time out.

        listener.Stop();
        try { await serverTask; } catch { /* teardown */ }

        // The load-bearing assertion (Fix round 1, Critical #1): TWO separate connections, one per write —
        // reusing a connection whose in-flight response may still arrive late is the exact desync hazard
        // this fix closes. Mutation-tested: removing the DisposeConnection() calls this fix added reproduces
        // acceptCount == 1 (see the task report's "Fix round 1" section).
        Assert.Equal(2, Volatile.Read(ref acceptCount));
        deadline.Dispose();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 1 (review, Critical #2 + Important #1) — a command cancelled AFTER the coil is confirmed
    // asserted but WHILE the reset write is stuck must report Indeterminate with a Detail that NAMES the
    // coil and its unconfirmed rest state — never the generic backstop's "unexpected failure" text (which is
    // what a NullReferenceException in the Transport.Retries restore used to produce instead).
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task InvokeCommandAsync_CancelledWhileResetWriteIsStuck_ReportsIndeterminate_NamingTheCoilAndUnconfirmedState()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;

        var assertReceived = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var resetReceived = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var serverTask = Task.Run(async () =>
        {
            // Bounded by its OWN internal deadline (not by the caller ever closing the connection) — see
            // the "no retry" test's own remarks on the identical hazard: the driver's connection is
            // deliberately left OPEN past the reset write's own attempt (disposed only when the `await using
            // driver` at the end of this test method runs), so a wait with no deadline of its own would
            // block forever, hanging this whole test.
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            using var accepted = await listener.AcceptTcpClientAsync(deadline.Token).ConfigureAwait(false);
            var stream = accepted.GetStream();

            // The ASSERT (coil = true) half: ack it immediately — the coil IS confirmed asserted.
            var assertRequest = new byte[12];
            await ReadExactAsync(stream, assertRequest, deadline.Token).ConfigureAwait(false);
            assertReceived.TrySetResult();
            await stream.WriteAsync(assertRequest, deadline.Token).ConfigureAwait(false); // FC05 ack = verbatim echo.

            // The RESET (coil = false) half: signal it was RECEIVED (so the test knows the driver is now
            // genuinely stuck waiting on ITS response), then go silent until the deadline — never ack it.
            var resetRequest = new byte[12];
            await ReadExactAsync(stream, resetRequest, deadline.Token).ConfigureAwait(false);
            resetReceived.TrySetResult();
            try { await Task.Delay(Timeout.Infinite, deadline.Token).ConfigureAwait(false); } catch { /* deadline */ }
        });

        // Deliberately a LONG bound (30s) — same reasoning as the setpoint cancellation test: if
        // cancellation did NOT unblock the stuck reset write promptly, this test would hang for ~30s.
        await using var driver = new ModbusTcpDriver("127.0.0.1", port, BuildWritableMap("PLC-CMD-CANCEL-RESET", readTimeoutMs: 30_000));

        using var cts = new CancellationTokenSource();
        var commandTask = driver.InvokeCommandAsync(new CommandRequest("start-cycle"), cts.Token);

        // Wait until the RESET write's own request has already reached the wire — i.e. the pre-reset
        // `ct.IsCancellationRequested` check already passed, and the driver is now genuinely blocked waiting
        // for a response that will never come — before cancelling.
        await resetReceived.Task.WaitAsync(TimeSpan.FromSeconds(5));
        cts.Cancel();

        var result = await commandTask;

        Assert.Equal(WriteOutcome.Indeterminate, result.Outcome);
        Assert.Null(result.RejectionReason);
        // The load-bearing assertion (Fix round 1, Critical #2 + Important #1): the coil address and its
        // UNCONFIRMED rest state must be named — the exact information a NullReferenceException in the
        // Transport.Retries restore used to destroy, replacing it with a generic, useless message. Mutation-
        // tested: removing the try/catch this fix added around that restore reproduces "unexpected failure:
        // Object reference not set to an instance of an object." here instead (see the task report).
        Assert.Contains("coil 3", result.Detail, StringComparison.Ordinal);
        Assert.Contains("unconfirmed", result.Detail, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("unexpected failure", result.Detail, StringComparison.Ordinal);
        Assert.DoesNotContain("Object reference", result.Detail, StringComparison.Ordinal);

        listener.Stop();
        try { await serverTask; } catch { /* teardown */ }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 4) No retry occurs on failure — made NON-VACUOUS: a real server counts REQUESTS RECEIVED OVER THE
    // WIRE, an externally-observable fact this test cannot fake by construction. See the task report for
    // how this was verified to actually fail if NModbus's own transport-level retry were left enabled.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task WriteSetpointAsync_OnTimeout_TransportNeverRetries_ExactlyOneRequestReachesTheWire()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;

        var requestCount = 0;
        var serverTask = Task.Run(async () =>
        {
            try
            {
                using var accepted = await listener.AcceptTcpClientAsync().ConfigureAwait(false);
                var stream = accepted.GetStream();

                // Bounded by its OWN internal deadline (not by the caller ever closing the connection) —
                // the driver's connection is deliberately left OPEN past this method's own write attempt
                // (disposed only when the `await using driver` at the end of the test method runs), so a
                // loop with no deadline of its own would block in ReadExactAsync forever waiting for bytes
                // that will never arrive, hanging this whole test. A generous 2s window is ample time for a
                // would-be RETRIED request to arrive if the fix under test were absent.
                using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                while (!deadline.IsCancellationRequested)
                {
                    var request = new byte[12];
                    if (!await ReadExactAsync(stream, request, deadline.Token).ConfigureAwait(false))
                    {
                        return;
                    }

                    Interlocked.Increment(ref requestCount);
                    // Never respond — every attempt (the first one, and any retry) times out identically,
                    // so a retry would show up here as a SECOND received request.
                }
            }
            catch { /* teardown, including the deadline above firing */ }
        });

        await using var driver = new ModbusTcpDriver("127.0.0.1", port, BuildWritableMap("PLC-WRITE-NORETRY", readTimeoutMs: 300));

        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest("speed", 42.0), CancellationToken.None);
        Assert.Equal(WriteOutcome.Indeterminate, result.Outcome);

        // Generous extra wait so a would-be second (retried) request has every opportunity to arrive before
        // this test asserts against it.
        await Task.Delay(TimeSpan.FromMilliseconds(500));
        listener.Stop();
        try { await serverTask; } catch { /* teardown */ }

        Assert.Equal(1, Volatile.Read(ref requestCount));
    }

    /// <summary>The command-path mirror of the setpoint no-retry test above — <see cref="ModbusTcpDriver.InvokeCommandAsync"/>
    /// forces <c>Transport.Retries = 0</c> independently, in its own code path
    /// (<c>ExecuteCoilPulseAsync</c>), not by sharing a helper with the setpoint path — verified separately
    /// here rather than assumed identical, since a command's double-actuation hazard (a real coil pulsing
    /// twice) is, per B-1, the HIGHER-risk of the two.</summary>
    [Fact]
    public async Task InvokeCommandAsync_OnTimeout_TransportNeverRetries_ExactlyOneRequestReachesTheWire()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;

        var requestCount = 0;
        var serverTask = Task.Run(async () =>
        {
            try
            {
                using var accepted = await listener.AcceptTcpClientAsync().ConfigureAwait(false);
                var stream = accepted.GetStream();

                using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                while (!deadline.IsCancellationRequested)
                {
                    var request = new byte[12];
                    if (!await ReadExactAsync(stream, request, deadline.Token).ConfigureAwait(false))
                    {
                        return;
                    }

                    Interlocked.Increment(ref requestCount);
                    // Never respond — a retried assert-coil write would show up here as a second request.
                }
            }
            catch { /* teardown, including the deadline above firing */ }
        });

        await using var driver = new ModbusTcpDriver("127.0.0.1", port, BuildWritableMap("PLC-CMD-NORETRY", readTimeoutMs: 300));

        var result = await driver.InvokeCommandAsync(new CommandRequest("start-cycle"), CancellationToken.None);
        Assert.Equal(WriteOutcome.Indeterminate, result.Outcome);

        await Task.Delay(TimeSpan.FromMilliseconds(500));
        listener.Stop();
        try { await serverTask; } catch { /* teardown */ }

        Assert.Equal(1, Volatile.Read(ref requestCount));
    }

    // ─────────────────────────────────────────────────────────────────────
    // 5) A command pulses the declared coil, and only the declared coil — TRUE then FALSE, observed on the
    // wire (the strongest possible evidence for "only the declared coil": the exact bytes NModbus sent).
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task InvokeCommandAsync_PulsesOnlyTheDeclaredCoil_TrueThenFalse_ReportsApplied()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;

        var recordedTask = Task.Run(() => RecordCoilWritesAsync(listener, requestsToHandle: 2));

        await using var driver = new ModbusTcpDriver("127.0.0.1", port, BuildWritableMap("PLC-CMD-PULSE"));

        var result = await driver.InvokeCommandAsync(new CommandRequest("start-cycle"), CancellationToken.None);

        Assert.Equal("start-cycle", result.Command);
        Assert.Equal(WriteOutcome.Applied, result.Outcome);
        Assert.Null(result.RejectionReason);

        var recorded = await recordedTask;
        Assert.Equal(2, recorded.Count);

        const byte writeSingleCoilFunctionCode = 5;
        Assert.All(recorded, r => Assert.Equal(writeSingleCoilFunctionCode, r.FunctionCode));
        // The load-bearing "only the declared coil" assertion — every request this command issued targeted
        // coil 3 (the ONE coil "start-cycle" declares), and no other address ever appeared on the wire.
        Assert.All(recorded, r => Assert.Equal((ushort)3, r.Address));

        Assert.Equal((ushort)0xFF00, recorded[0].Value); // assert TRUE
        Assert.Equal((ushort)0x0000, recorded[1].Value); // then reset FALSE

        listener.Stop();
    }

    [Fact]
    public async Task InvokeCommandAsync_UnknownCommand_RejectedWithoutTouchingDevice()
    {
        await using var slave = ModbusLoopbackHarness.Start();
        await using var driver = new ModbusTcpDriver("127.0.0.1", slave.Port, BuildWritableMap("PLC-CMD-UNKNOWN"));

        var before = slave.Slave.DataStore.CoilDiscretes.ReadPoints(3, 1)[0];
        var result = await driver.InvokeCommandAsync(new CommandRequest("does-not-exist"), CancellationToken.None);

        Assert.Equal(WriteOutcome.Rejected, result.Outcome);
        Assert.Equal(CommandRejectionReason.UnknownCommand, result.RejectionReason);
        Assert.Equal(before, slave.Slave.DataStore.CoilDiscretes.ReadPoints(3, 1)[0]);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 6) The concurrency question: a write while polling is in flight behaves as documented — it WAITS for
    // the in-flight poll iteration to finish (never interleaves bytes with it), then proceeds correctly.
    // Deterministic (signal-based, not a wall-clock guess): the poll's own response is deliberately withheld
    // until the test explicitly releases it.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task WriteWhilePollIsInFlight_WaitsForThePollToFinish_ThenBothCompleteCorrectly()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;

        var pollRequestReceived = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var releasePollResponse = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var writeRequestReceived = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var serverTask = Task.Run(async () =>
        {
            using var accepted = await listener.AcceptTcpClientAsync().ConfigureAwait(false);
            var stream = accepted.GetStream();

            // First request: the poll loop's own read of register 5 ("speed"). Deliberately held — the
            // response is withheld until the test explicitly releases it, simulating "the poll is slow".
            var readRequest = new byte[12];
            await ReadExactAsync(stream, readRequest, CancellationToken.None).ConfigureAwait(false);
            pollRequestReceived.TrySetResult();
            await releasePollResponse.Task.ConfigureAwait(false);

            var readAck = new byte[] { readRequest[0], readRequest[1], 0x00, 0x00, 0x00, 0x05, readRequest[6], readRequest[7], 0x02, 0x00, 0x0A };
            await stream.WriteAsync(readAck).ConfigureAwait(false);

            // Second request: the write. Must not arrive until AFTER the poll's own response above went out
            // — proven by the test itself, not assumed here.
            var writeRequest = new byte[12];
            await ReadExactAsync(stream, writeRequest, CancellationToken.None).ConfigureAwait(false);
            writeRequestReceived.TrySetResult();
            await stream.WriteAsync(writeRequest).ConfigureAwait(false); // FC06 ack = verbatim echo, per spec.
        });

        await using var driver = new ModbusTcpDriver(
            "127.0.0.1", port, BuildSingleWritableRegisterMap("PLC-CONCURRENCY", readTimeoutMs: 30_000, pollIntervalMs: 30_000));

        using var pollCts = new CancellationTokenSource();
        var pollTask = Task.Run(async () =>
        {
            await foreach (var _ in driver.ReadAsync(pollCts.Token))
            {
                break;
            }
        });

        await pollRequestReceived.Task.WaitAsync(TimeSpan.FromSeconds(5));

        // Issue the write WHILE the poll is deliberately held mid-flight (its response still withheld).
        var writeTask = driver.WriteSetpointAsync(new SetpointWriteRequest("speed", 42.0), CancellationToken.None);

        // The load-bearing assertion: the write's own request must NOT reach the wire while a poll
        // iteration still holds the connection — it is queued behind _ioLock, not racing it.
        var maybeWriteArrived = await Task.WhenAny(writeRequestReceived.Task, Task.Delay(TimeSpan.FromMilliseconds(500)));
        Assert.NotSame(writeRequestReceived.Task, maybeWriteArrived);
        Assert.False(writeTask.IsCompleted, "the write must not complete while a poll iteration is still holding the connection.");

        // Now let the poll's response go out, finishing that iteration and releasing _ioLock.
        releasePollResponse.TrySetResult();

        // NOW the write's own request reaches the wire, and the write completes correctly.
        await writeRequestReceived.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var writeResult = await writeTask;
        Assert.Equal(WriteOutcome.Applied, writeResult.Outcome);

        pollCts.Cancel();
        try { await pollTask; } catch (OperationCanceledException) { }
        listener.Stop();
        try { await serverTask; } catch { /* teardown */ }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Raw Modbus-TCP helpers — mirrors ModbusTcpDriverConformanceTests' own hand-rolled-responder technique.
    // ─────────────────────────────────────────────────────────────────────

    private static async Task<bool> ReadExactAsync(NetworkStream stream, byte[] buffer, CancellationToken ct)
    {
        var offset = 0;
        while (offset < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(offset, buffer.Length - offset), ct).ConfigureAwait(false);
            if (read == 0)
            {
                return false;
            }

            offset += read;
        }

        return true;
    }

    private static async Task<List<(byte FunctionCode, ushort Address, ushort Value)>> RecordCoilWritesAsync(TcpListener listener, int requestsToHandle)
    {
        var recorded = new List<(byte, ushort, ushort)>();
        using var accepted = await listener.AcceptTcpClientAsync().ConfigureAwait(false);
        var stream = accepted.GetStream();

        for (var i = 0; i < requestsToHandle; i++)
        {
            var request = new byte[12];
            if (!await ReadExactAsync(stream, request, CancellationToken.None).ConfigureAwait(false))
            {
                break;
            }

            var functionCode = request[7];
            var address = (ushort)((request[8] << 8) | request[9]);
            var value = (ushort)((request[10] << 8) | request[11]);
            recorded.Add((functionCode, address, value));

            // FC05 (Write Single Coil) ack is a verbatim echo of the request, per the Modbus spec.
            await stream.WriteAsync(request).ConfigureAwait(false);
        }

        return recorded;
    }
}
