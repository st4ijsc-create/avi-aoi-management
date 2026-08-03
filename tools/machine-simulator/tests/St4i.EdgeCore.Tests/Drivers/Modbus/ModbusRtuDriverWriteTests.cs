using System.Diagnostics;
using System.IO;
using NModbus;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers.Modbus;
using Xunit;
using Xunit.Abstractions;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// 🔴 Task D-5 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-5-brief.md) — <b>the RTU write path:
/// a driver physically changing a machine on a line it shares with other machines.</b>
///
/// <para><b>What each group is actually about.</b></para>
/// <list type="bullet">
/// <item><description><b>Attribution</b> — a write reaches its own device and no other device on the bus sees
/// it, asserted BOTH off the target slave's own data store and off the frames that reached the bus
/// boundary.</description></item>
/// <item><description><b>No retry</b> — exactly one request FRAME on the wire. Proven non-vacuous by having the
/// map declare <c>retries: 5</c>, i.e. the test supplies the number that must NOT be used, and by asserting the
/// value the BUS recorded rather than one this file passed in. D-2's own retry test passed while the driver
/// hardcoded a different count, because it supplied the value it was checking.</description></item>
/// <item><description><b><see cref="WriteOutcome.Indeterminate"/></b> — produced by a genuine timeout, with the
/// <c>Detail</c>'s CONTENT asserted. Đợt B shipped two defects in which a carefully-authored
/// <c>Indeterminate</c> message was replaced by a generic string, and both were invisible to a "Detail is not
/// null" assertion.</description></item>
/// <item><description><b>No stale frame can acknowledge a write</b> — driven through
/// <see cref="RawRtuResponder"/>, which is the only way to make a device answer WRONGLY on purpose, with a
/// correct-echo control that makes the three wrong-answer cases non-vacuous.</description></item>
/// <item><description><b>The bus after a failed write</b> — another MACHINE's next read returns its own correct
/// value, the quarantine is asserted to have been entered and paid once, and the link is asserted never to have
/// been rebuilt.</description></item>
/// <item><description><b>What an operator waits</b> — a write queued behind a dead device's hold, measured, and
/// the cancellation that bounds it, measured. These two are the evidence behind this task's decision not to
/// build the per-device backoff; see task-5-report.md §7.</description></item>
/// <item><description><b>B-3's limits, through this entry point</b> — every rejection asserted to have reached
/// the device with ZERO bytes, which is stronger than "the register still holds its old value".</description></item>
/// </list>
///
/// <para><b>On the timing assertions.</b> The two measurement tests print their own numbers
/// (<c>--logger "console;verbosity=detailed"</c>) so nobody has to take the report's word for them, and every
/// asserted bound is at least an order of magnitude away from the mechanism it is about — the load-bearing
/// claims are mechanistic (<see cref="ModbusBus.LinkGeneration"/> did not move, no FC06 frame ever reached the
/// wire), never a wall-clock constant.</para>
/// </summary>
public class ModbusRtuDriverWriteTests
{
    private readonly ITestOutputHelper _output;

    public ModbusRtuDriverWriteTests(ITestOutputHelper output) => _output = output;

    private const ushort SpeedRegister = 5;
    private const ushort StartCycleCoil = 3;
    private const string SpeedPoint = "speed";
    private const string ReadOnlyPoint = "temperature";
    private const string StartCycleCommand = "start-cycle";

    /// <summary>One read-only register ("temperature", address 0) and one writable one ("speed", address 5,
    /// declared <c>[0,500]</c>), plus one coil-pulse command ("start-cycle", coil 3) — the same shape
    /// <c>ModbusTcpDriverWriteTests.BuildWritableMap</c> uses, deliberately, so any difference between the two
    /// transports' write behaviour is about the transport rather than about the map.</summary>
    private static ModbusRegisterMap WritableMap(
        string machineCode,
        byte unitId,
        int? readTimeoutMs = null,
        int pollIntervalMs = 60_000,
        int? retries = null) => new()
        {
            MachineCode = machineCode,
            UnitId = unitId,
            PollIntervalMs = pollIntervalMs,
            ReadTimeoutMs = readTimeoutMs,
            Retries = retries,
            Registers = new List<ModbusRegister>
            {
                new(Address: 0, Type: ModbusRegisterType.Holding, DataType: ModbusDataType.UInt16, Scale: 1.0,
                    Metric: ReadOnlyPoint, Unit: "C"),
                new(Address: SpeedRegister, Type: ModbusRegisterType.Holding, DataType: ModbusDataType.UInt16, Scale: 1.0,
                    Metric: SpeedPoint, Unit: "rpm", Writable: new ModbusWritableRange(0, 500)),
            },
            Commands = new List<ModbusCommand> { new(StartCycleCommand, CoilAddress: StartCycleCoil) },
        };

    private static ModbusRegisterMap ReadOnlySingleRegisterMap(string machineCode, byte unitId, int pollIntervalMs, int? readTimeoutMs = null)
        => ModbusRtuLoopbackHarness.BuildSingleRegisterMap(machineCode, unitId: unitId, pollIntervalMs: pollIntervalMs, readTimeoutMs: readTimeoutMs);

    private static Task DriveAsync(IDeviceDriver driver, Action<DeviceReading> onReading, CancellationToken ct)
        => Task.Run(
            async () =>
            {
                try
                {
                    await foreach (var reading in driver.ReadAsync(ct))
                    {
                        onReading(reading);
                    }
                }
                catch (OperationCanceledException) { }
            },
            CancellationToken.None);

    private static async Task WaitUntilAsync(Func<bool> predicate, string because)
    {
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(20);
        while (DateTime.UtcNow < deadline)
        {
            if (predicate()) return;
            await Task.Delay(10);
        }

        Assert.True(predicate(), $"timed out waiting for: {because}");
    }

    /// <summary>Every frame the MASTER put on the line that names <paramref name="functionCode"/>. The whole
    /// point of reading these rather than a byte count: a multidrop write has to prove WHICH unit and WHICH
    /// address it addressed, and neither is visible in a total.</summary>
    private static List<byte[]> FramesWithFunction(InMemoryBusLink master, byte functionCode)
        => master.WrittenFrames
            .Where(f => f.Length == RtuFrames.RequestFrameLength && f[1] == functionCode)
            .ToList();

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 1. A write reaches its own device — and no other device on the bus sees it.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>Three machines on one RS-485 line; a setpoint written to the middle one reaches only the middle
    /// one.</b> This is the write-path form of Đợt B's Critical (a write for machine B arriving at machine A's
    /// device) and of D-4's own positive control (a read that always addressed slave 1).
    ///
    /// <para>Two independent load-bearing assertions, because they fail to different defects. The first reads
    /// the value straight off each slave's OWN data store — a defect that wrote to the wrong unit shows up as a
    /// changed register on a machine nobody addressed. The second reads the frames that reached the BUS
    /// BOUNDARY and asserts that every FC06 frame named unit 2 and register 5 — which also catches a defect
    /// that wrote to the right slave for the wrong reason, and which no assertion about the driver's own return
    /// value could see.</para>
    /// </summary>
    [Fact]
    public async Task WriteSetpointAsync_WithinDeclaredRange_ReachesItsOwnDeviceOnAMultidropBus_AndNoOtherDeviceSeesIt()
    {
        await using var harness = ModbusRtuLoopbackHarness.Start(
            ((byte)1, new ushort[] { 111, 0, 0, 0, 0, 11 }),
            ((byte)2, new ushort[] { 222, 0, 0, 0, 0, 22 }),
            ((byte)3, new ushort[] { 333, 0, 0, 0, 0, 33 }));

        await using var driver = new ModbusRtuDriver(harness.Lease(), WritableMap("BUS-W2", unitId: 2));

        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest(SpeedPoint, 123.0), CancellationToken.None);

        Assert.Equal(SpeedPoint, result.Point);
        Assert.Equal(WriteOutcome.Applied, result.Outcome);
        Assert.Null(result.RejectionReason);

        // Off each device's OWN storage, independent of anything this driver reports.
        Assert.Equal((ushort)123, harness.Slaves[2].DataStore.HoldingRegisters.ReadPoints(SpeedRegister, 1)[0]);
        Assert.Equal((ushort)11, harness.Slaves[1].DataStore.HoldingRegisters.ReadPoints(SpeedRegister, 1)[0]);
        Assert.Equal((ushort)33, harness.Slaves[3].DataStore.HoldingRegisters.ReadPoints(SpeedRegister, 1)[0]);

        // 🔴 And at the bus boundary: exactly one FC06 frame, naming unit 2, register 5, value 123. No frame
        // addressed to any other unit ever left this master.
        var writes = FramesWithFunction(harness.Links.Master, RtuFrames.FunctionWriteSingleRegister);
        var frame = Assert.Single(writes);
        Assert.Equal(2, frame[0]);
        Assert.Equal(SpeedRegister, RtuFrames.Word(frame, 2));
        Assert.Equal(123, RtuFrames.Word(frame, 4));

        // 🔴 Review m-5 — an `Assert.All(WrittenFrames, f => f[0] == 2)` used to sit here. This driver only
        // writes in this test, so that collection can hold exactly the one frame `Assert.Single` above already
        // returned: the loop could not range over anything the line above had not already checked. Removed
        // rather than reworded — the "no other device saw it" claim is carried by the three data-store
        // assertions above, which read each slave's own storage and would catch a write that landed on a
        // machine nobody addressed.
    }

    /// <summary>
    /// 🔴 <b>A command pulses only its own device's coil, TRUE then FALSE, and the proof is the frames.</b>
    /// A pulse ends with the coil back at FALSE, which is indistinguishable from "never touched" in the slave's
    /// data store — so the data store cannot answer "did it fire", and the wire has to. Asserted on both halves,
    /// on both values, on the coil address and on the unit id.
    /// </summary>
    [Fact]
    public async Task InvokeCommandAsync_PulsesOnlyItsOwnDevicesCoil_TrueThenFalse_OnAMultidropBus()
    {
        await using var harness = ModbusRtuLoopbackHarness.Start(
            ((byte)1, new ushort[] { 111 }),
            ((byte)2, new ushort[] { 222 }),
            ((byte)3, new ushort[] { 333 }));

        await using var driver = new ModbusRtuDriver(harness.Lease(), WritableMap("BUS-C2", unitId: 2));

        var result = await driver.InvokeCommandAsync(new CommandRequest(StartCycleCommand), CancellationToken.None);

        Assert.Equal(StartCycleCommand, result.Command);
        Assert.Equal(WriteOutcome.Applied, result.Outcome);
        Assert.Null(result.RejectionReason);

        var pulses = FramesWithFunction(harness.Links.Master, RtuFrames.FunctionWriteSingleCoil);
        Assert.Equal(2, pulses.Count);
        Assert.All(pulses, f => Assert.Equal((byte)2, f[0]));
        Assert.All(pulses, f => Assert.Equal(StartCycleCoil, RtuFrames.Word(f, 2)));
        // 0xFF00 asserts a coil, 0x0000 releases it — the spec's own two legal values.
        Assert.Equal(0xFF00, RtuFrames.Word(pulses[0], 4));
        Assert.Equal(0x0000, RtuFrames.Word(pulses[1], 4));

        // The coil is back at rest on its own device, and no other device's coil was ever addressed.
        Assert.False(harness.Slaves[2].DataStore.CoilDiscretes.ReadPoints(StartCycleCoil, 1)[0]);
        Assert.False(harness.Slaves[1].DataStore.CoilDiscretes.ReadPoints(StartCycleCoil, 1)[0]);
        Assert.False(harness.Slaves[3].DataStore.CoilDiscretes.ReadPoints(StartCycleCoil, 1)[0]);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 2. No implicit retry — one request FRAME on the wire, and the test does not supply the number.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>Exactly one FC06 request frame reaches the wire against a device that never answers.</b>
    ///
    /// <para><b>Why this one is not vacuous, stated as the mechanism rather than as a claim.</b> D-2's
    /// equivalent read test passed while the driver hardcoded a different retry count, because the test PASSED
    /// IN the retry count it then checked. Here the test passes in <c>retries: 5</c> — the map's own maximum,
    /// i.e. the number that must NOT be used — and asserts two things it did not supply: the count of frames
    /// that reached the bus boundary, and <see cref="ModbusBus.LastTransactionRetries"/>, the value the BUS
    /// actually applied to the shared transport. Measured against NModbus 3.0.83: a write at <c>Retries = 5</c>
    /// puts SIX identical FC06 frames on the wire, at 1 it puts two, at 0 it puts one. Both assertions fail
    /// under a driver that inherits the read path's count, and the second additionally fails under a driver that
    /// passes 0 while something downstream ignores it.</para>
    /// </summary>
    [Fact]
    public async Task WriteSetpointAsync_AgainstASilentDevice_PutsExactlyOneRequestFrameOnTheWire_NeverARetry()
    {
        await using var harness = ModbusRtuLoopbackHarness.Start(((byte)7, new ushort[] { 1, 0, 0, 0, 0, 2 }));
        harness.Links.Device.SilentUnitId = 7;

        var lease = harness.Lease();
        await using var driver = new ModbusRtuDriver(lease, WritableMap("NORETRY-W", unitId: 7, readTimeoutMs: 250, retries: 5));

        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest(SpeedPoint, 42.0), CancellationToken.None);
        Assert.Equal(WriteOutcome.Indeterminate, result.Outcome);

        // Generous extra time for a would-be retry to show up before this asserts against it.
        await Task.Delay(400);

        var writes = FramesWithFunction(harness.Links.Master, RtuFrames.FunctionWriteSingleRegister);
        Assert.Single(writes);

        // 🔴 The "who chose the value" half: 0 reached the shared transport, not the 5 this test declared.
        Assert.Equal(0, lease.Bus.LastTransactionRetries);
        Assert.Equal(250, lease.Bus.LastTransactionReadTimeoutMs);

        // The device really did receive the request and really was silenced — otherwise "one frame" could mean
        // the request never got out at all.
        Assert.True(harness.Links.Device.FramesSilenced > 0, "the silenced slave should have replied and been dropped");
    }

    /// <summary>The command path's own no-retry proof. Written separately rather than assumed identical:
    /// <see cref="ModbusRtuDriver.InvokeCommandAsync"/> opens its own transaction in its own method, and B-1 is
    /// explicit that a retried COMMAND is the higher-risk of the two — a coil pulsing twice is a machine
    /// started twice.</summary>
    [Fact]
    public async Task InvokeCommandAsync_AgainstASilentDevice_PutsExactlyOneRequestFrameOnTheWire_NeverARetry()
    {
        await using var harness = ModbusRtuLoopbackHarness.Start(((byte)7, new ushort[] { 1 }));
        harness.Links.Device.SilentUnitId = 7;

        var lease = harness.Lease();
        await using var driver = new ModbusRtuDriver(lease, WritableMap("NORETRY-C", unitId: 7, readTimeoutMs: 250, retries: 5));

        var result = await driver.InvokeCommandAsync(new CommandRequest(StartCycleCommand), CancellationToken.None);
        Assert.Equal(WriteOutcome.Indeterminate, result.Outcome);

        await Task.Delay(400);

        var pulses = FramesWithFunction(harness.Links.Master, RtuFrames.FunctionWriteSingleCoil);
        Assert.Single(pulses);
        // The ASSERT half, and only it — a command whose assert never got an answer must not go on to send a
        // reset it cannot attribute either.
        Assert.Equal(0xFF00, RtuFrames.Word(pulses[0], 4));

        Assert.Equal(0, lease.Bus.LastTransactionRetries);
    }

    /// <summary>
    /// 🔴 <b>A write does not leave the READ path at zero retries.</b> The TCP driver has to save and restore
    /// <c>Transport.Retries</c> around each write because it owns one connection whose transport survives the
    /// call. This driver does not, and the reason is structural rather than an omission:
    /// <see cref="ModbusBus.BeginTransactionAsync"/> sets BOTH the timeout and the retry count on the shared
    /// transport at the start of EVERY transaction, so no transaction can inherit the previous one's. Asserted
    /// as a fact about the bus rather than as an argument: 0 after the write, the map's own value after the poll
    /// that follows it.
    /// </summary>
    [Fact]
    public async Task AWriteDoesNotLeaveTheSharedTransportAtZeroRetries_BecauseTheBusSetsBothPerTransaction()
    {
        await using var harness = ModbusRtuLoopbackHarness.Start(((byte)1, new ushort[] { 111, 0, 0, 0, 0, 5 }));

        var map = WritableMap("RESTORE-M1", unitId: 1, readTimeoutMs: 1_000, pollIntervalMs: 30, retries: 3);
        var lease = harness.Lease();
        await using var driver = new ModbusRtuDriver(lease, map);

        var write = await driver.WriteSetpointAsync(new SetpointWriteRequest(SpeedPoint, 77.0), CancellationToken.None);
        Assert.Equal(WriteOutcome.Applied, write.Outcome);
        Assert.Equal(0, lease.Bus.LastTransactionRetries);

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        DeviceReading? reading = null;
        var pump = DriveAsync(driver, r => Volatile.Write(ref reading, r), cts.Token);
        try
        {
            await WaitUntilAsync(() => Volatile.Read(ref reading) is not null, "the read path to poll once after the write");
        }
        finally
        {
            await cts.CancelAsync();
            try { await pump; } catch (OperationCanceledException) { }
        }

        // 🔴 The read path got its own tolerance back — 3, the map's declared value, not the write's 0.
        Assert.Equal(map.EffectiveRetries, lease.Bus.LastTransactionRetries);
        Assert.Equal(map.EffectiveReadTimeoutMs, lease.Bus.LastTransactionReadTimeoutMs);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 3. Indeterminate, produced by a genuine timeout, with the Detail's CONTENT asserted.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task WriteSetpointAsync_AgainstASilentDevice_GenuinelyTimesOut_AndTheDetailNamesWhatIsUnknown()
    {
        const int boundMs = 400;

        await using var harness = ModbusRtuLoopbackHarness.Start(((byte)4, new ushort[] { 1, 0, 0, 0, 0, 2 }));
        harness.Links.Device.SilentUnitId = 4;

        await using var driver = new ModbusRtuDriver(harness.Lease(), WritableMap("TIMEOUT-W", unitId: 4, readTimeoutMs: boundMs));

        var stopwatch = Stopwatch.StartNew();
        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest(SpeedPoint, 42.0), CancellationToken.None);
        stopwatch.Stop();

        Assert.Equal(WriteOutcome.Indeterminate, result.Outcome);
        Assert.Null(result.RejectionReason);

        // 🔴 CONTENT, not merely non-empty. Đợt B shipped two defects in which a NullReferenceException in a
        // `finally` silently replaced a correctly-authored Indeterminate message with a generic one, and a
        // "Detail is not null" assertion could not see either. Four claims, each of which an operator acts on:
        // what happened, that the answer is genuinely unknown, WHICH device, and that nothing was resent.
        Assert.Contains("write did not complete", result.Detail, StringComparison.Ordinal);
        Assert.Contains("unknown", result.Detail, StringComparison.Ordinal);
        Assert.Contains("unit 4", result.Detail, StringComparison.Ordinal);
        Assert.Contains("NOT retried", result.Detail, StringComparison.Ordinal);
        Assert.DoesNotContain("unexpected failure", result.Detail, StringComparison.Ordinal);

        // It GENUINELY waited out the bound rather than short-circuiting it — with retries forced to 0 the wait
        // is about one timeout, never a multiple of it.
        Assert.True(stopwatch.ElapsedMilliseconds >= boundMs - 60,
            $"the write returned after only {stopwatch.ElapsedMilliseconds} ms — too fast to have waited out a {boundMs} ms bound.");
        Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(5),
            $"the write took {stopwatch.Elapsed} — unexpectedly slow for a single {boundMs} ms attempt with no retry.");
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 4. No stale frame can be mistaken for a write acknowledgement.
    // ─────────────────────────────────────────────────────────────────────

    private sealed record ResponderRig(
        InMemoryBusLinkPair Links,
        ModbusBusRegistry Registry,
        ModbusBusLease Lease,
        RawRtuResponder Responder) : IAsyncDisposable
    {
        public async ValueTask DisposeAsync()
        {
            try { await Responder.DisposeAsync(); } catch { /* teardown */ }
            try { await Lease.DisposeAsync(); } catch { /* teardown */ }
            try { await Registry.DisposeAsync(); } catch { /* teardown */ }
            try { Links.Master.Dispose(); } catch { /* teardown */ }
        }
    }

    private static ResponderRig StartResponder(Func<byte[], int, byte[]?> replyFor, string busKey)
    {
        var links = InMemoryBusLinkPair.Create();
        var registry = new ModbusBusRegistry();
        var lease = registry.Acquire(busKey, _ => Task.FromResult<IModbusBusLink>(links.Master));
        return new ResponderRig(links, registry, lease, new RawRtuResponder(links.Device, replyFor));
    }

    /// <summary>
    /// 🔴 <b>Three frames that are NOT this write's acknowledgement, none of which is accepted as one.</b>
    ///
    /// <para>A Modbus write response is an ECHO of the request, and this is where that is turned from a claim
    /// into a check. Each row hands the driver a complete, well-formed frame that differs from the true echo in
    /// exactly one field, and asserts the outcome is <see cref="WriteOutcome.Indeterminate"/> — never
    /// <see cref="WriteOutcome.Applied"/>. The device is asserted to have RECEIVED the request in every row, so
    /// "not applied" cannot be passing for the trivial reason that nothing was ever sent.</para>
    ///
    /// <para>Separate rows rather than one combined case, deliberately: a defect that stopped validating the
    /// start address would survive a test that only fed it a wrong VALUE, and vice versa. The correct-echo
    /// control lives in its own test below and is what makes all three of these non-vacuous — without it, a
    /// driver that never reported <see cref="WriteOutcome.Applied"/> at all would pass every row here.</para>
    /// </summary>
    [Theory]
    [InlineData("wrong-address", "an echo naming register 9 instead of the register 5 that was written")]
    [InlineData("wrong-value", "an echo carrying value 99 instead of the 42 that was written")]
    [InlineData("stale-read", "a stale FC03 read response left over from an earlier transaction")]
    public async Task AFrameThatIsNotThisWritesEcho_IsNeverAcceptedAsTheAcknowledgement(string shape, string because)
    {
        byte[] Reply(byte[] request, int index) => shape switch
        {
            "wrong-address" => RtuFrames.WithCrc(request[0], RtuFrames.FunctionWriteSingleRegister, 0x00, 0x09, 0x00, 0x2A),
            "wrong-value" => RtuFrames.WithCrc(request[0], RtuFrames.FunctionWriteSingleRegister, 0x00, 0x05, 0x00, 0x63),
            "stale-read" => RtuFrames.WithCrc(request[0], RtuFrames.FunctionReadHoldingRegisters, 0x02, 0x01, 0x02),
            _ => throw new ArgumentOutOfRangeException(nameof(shape), shape, "unknown response shape"),
        };

        await using var rig = StartResponder(Reply, $"stale-echo-bus-{shape}");
        await using var driver = new ModbusRtuDriver(rig.Lease, WritableMap("ECHO-M1", unitId: 1, readTimeoutMs: 500));

        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest(SpeedPoint, 42.0), CancellationToken.None);

        Assert.Equal(WriteOutcome.Indeterminate, result.Outcome);
        Assert.Contains("write did not complete", result.Detail, StringComparison.Ordinal);

        // The request really did go out and really was answered — so this is "the answer was rejected", not
        // "nothing happened", which is the distinction that makes the assertion above mean anything. See
        // `because` for which field this row varied.
        Assert.True(rig.Responder.RequestsSeen >= 1, $"the device should have received the write request ({because})");

        // And the whole point of the acknowledgement being validated: the bus is left QUARANTINED, so the next
        // machine's transaction must observe silence before it writes.
        Assert.True(rig.Lease.Bus.IsDesynchronised);
    }

    /// <summary>🔴 The control for the three rows above, and it is what makes them non-vacuous: the SAME rig,
    /// the SAME driver, answering with the true echo, reports <see cref="WriteOutcome.Applied"/> and leaves the
    /// bus clean. Without it, "Indeterminate" in every row would also be satisfied by a write path that can
    /// never succeed at all.</summary>
    [Fact]
    public async Task AWriteEchoThatMatchesTheRequestExactly_IsAccepted_AndLeavesTheBusClean()
    {
        static byte[] Reply(byte[] request, int index) =>
            RtuFrames.WithCrc(request[0], request[1], request[2], request[3], request[4], request[5]);

        await using var rig = StartResponder(Reply, "true-echo-bus");
        await using var driver = new ModbusRtuDriver(rig.Lease, WritableMap("ECHO-OK", unitId: 1, readTimeoutMs: 500));

        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest(SpeedPoint, 42.0), CancellationToken.None);

        Assert.Equal(WriteOutcome.Applied, result.Outcome);
        Assert.False(rig.Lease.Bus.IsDesynchronised);
        Assert.Equal(0, rig.Lease.Bus.ResynchronisationCount);

        var frame = Assert.Single(rig.Responder.Requests);
        Assert.Equal(RtuFrames.FunctionWriteSingleRegister, frame[1]);
        Assert.Equal(SpeedRegister, RtuFrames.Word(frame, 2));
        Assert.Equal(42, RtuFrames.Word(frame, 4));
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 5. What a failed write costs the OTHER machines on the line.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>A write times out on machine A; machine B's next read still returns B's own value.</b> This is the
    /// multidrop, write-path form of D-2's second-device test, and it is the failure this whole batch exists to
    /// prevent: the timed-out write's echo arrives LATE, sits on the shared line, and would otherwise be read by
    /// whoever reads next — who is a different machine.
    ///
    /// <para>The late frame is REAL, not simulated by a sleep: the slave receives the write, applies it and
    /// answers, and its answer is captured on the wire (<see cref="InMemoryBusLink.HoldWrites"/>) and released
    /// after the write has already given up. <see cref="InMemoryBusLink.BufferedInputCount"/> is asserted
    /// non-zero before machine B reads, so "B read correctly" cannot pass because nothing was ever stale.</para>
    ///
    /// <para>The three mechanism assertions afterwards are what distinguish the recovery from luck: the
    /// quarantine was entered and cleared exactly once, it discarded real bytes, and
    /// <see cref="ModbusBus.LinkGeneration"/> never moved — the line was not rebuilt, which is the thing D-2's
    /// cancellation design gives up dispose-on-cancel in order to guarantee.</para>
    /// </summary>
    [Fact]
    public async Task AfterAWriteTimesOut_AnotherMachineOnTheBusStillReadsItsOwnValue_AndTheBusIsQuarantinedOnce()
    {
        await using var harness = ModbusRtuLoopbackHarness.Start(
            ((byte)1, new ushort[] { 111, 0, 0, 0, 0, 11 }),
            ((byte)2, new ushort[] { 222 }));

        var writerLease = harness.Lease();
        await using var writer = new ModbusRtuDriver(writerLease, WritableMap("LATE-W1", unitId: 1, readTimeoutMs: 300));

        // The device receives the write, applies it, and answers — the answer is captured on the wire. That is
        // exactly what a timed-out RTU write is, and it leaves a late frame in flight.
        harness.Links.Device.HoldWrites = true;

        var result = await writer.WriteSetpointAsync(new SetpointWriteRequest(SpeedPoint, 321.0), CancellationToken.None);
        Assert.Equal(WriteOutcome.Indeterminate, result.Outcome);

        // The bus knows it cannot vouch for the line — asserted directly, not inferred from a later read.
        Assert.True(writerLease.Bus.IsDesynchronised);
        Assert.Equal(0, writerLease.Bus.ResynchronisationCount);

        // The device really did answer, so what follows is a LATE frame rather than an absent one.
        Assert.True(harness.Links.Device.BytesWritten > 0);
        harness.Links.Device.ReleaseHeldWrites();
        await WaitUntilAsync(() => harness.Links.Master.BufferedInputCount > 0, "the late write echo to land on the line");

        // 🔴 A DIFFERENT MACHINE reads next.
        await using var reader = new ModbusRtuDriver(
            harness.Lease(), ReadOnlySingleRegisterMap("LATE-M2", unitId: 2, pollIntervalMs: 60_000, readTimeoutMs: 1_000));

        DeviceReading? fromTwo = null;
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        var pump = DriveAsync(reader, r => Volatile.Write(ref fromTwo, r), cts.Token);
        try
        {
            await WaitUntilAsync(() => Volatile.Read(ref fromTwo) is not null, "machine 2 to read after the quarantine");
        }
        finally
        {
            await cts.CancelAsync();
            try { await pump; } catch (OperationCanceledException) { }
        }

        Assert.Equal("LATE-M2", Volatile.Read(ref fromTwo)!.MachineCode);
        Assert.Equal(222.0, (double)Volatile.Read(ref fromTwo)!.Telemetry.Single().Value!, precision: 10);

        Assert.Equal(1, writerLease.Bus.ResynchronisationCount);
        Assert.True(writerLease.Bus.LastResynchronisationBytesDiscarded > 0,
            "the resynchronisation should have discarded the write's late echo, not merely waited out a window");
        Assert.Equal(1, writerLease.Bus.LinkGeneration);
    }

    /// <summary>
    /// 🔴 <b>A bus that will not go quiet REFUSES the write, and the outcome is
    /// <see cref="WriteOutcome.Failed"/> rather than <see cref="WriteOutcome.Indeterminate"/>.</b>
    ///
    /// <para>That choice is the one place this driver reports a definite "no" for something other than a device
    /// rejection, and the contract's own words are what decide it:
    /// <see cref="WriteOutcome.Failed"/> is "the device <b>(or the transport talking to it)</b> was reached and
    /// explicitly reported failure — the write did NOT apply", while
    /// <see cref="WriteOutcome.Indeterminate"/> is "the caller does NOT know whether the device applied the
    /// write". <see cref="ModbusBus"/> refuses the transaction BEFORE it configures the transport, so no request
    /// frame of this write can exist — the assertion below is that ZERO frames reached the line, which is what
    /// makes "did not apply" a fact rather than an inference.</para>
    /// </summary>
    [Fact]
    public async Task AWriteOntoABusThatWillNotGoQuiet_IsRefusedBeforeAnyByteReachesTheLine_AndReportsFailed()
    {
        var links = InMemoryBusLinkPair.Create();
        await using var registry = new ModbusBusRegistry();

        var babbling = new BabblingLink(links.Master);
        var lease = registry.Acquire(
            "babbling-write-bus",
            _ => Task.FromResult<IModbusBusLink>(babbling),
            new ModbusBusSettings(QuietWindowMs: 30, PollSliceMs: 2));

        await using var driver = new ModbusRtuDriver(lease, WritableMap("BABBLE-M1", unitId: 1, readTimeoutMs: 150));

        // Quarantine the bus with a genuine timeout: nothing on the far end answers.
        var first = await driver.WriteSetpointAsync(new SetpointWriteRequest(SpeedPoint, 10.0), CancellationToken.None);
        Assert.Equal(WriteOutcome.Indeterminate, first.Outcome);
        Assert.True(lease.Bus.IsDesynchronised);

        var framesBefore = babbling.WriteCalls;

        var refused = await driver.WriteSetpointAsync(new SetpointWriteRequest(SpeedPoint, 20.0), CancellationToken.None);

        Assert.Equal(WriteOutcome.Failed, refused.Outcome);
        Assert.Null(refused.RejectionReason);
        Assert.Contains("refused before any byte reached the line", refused.Detail, StringComparison.Ordinal);
        Assert.Contains("untouched", refused.Detail, StringComparison.Ordinal);
        // 🔴 Review I-1 — the CAUSE now comes from the exception, which words the two refusal paths
        // differently, instead of being a canned "would not go quiet" that was false for a drain failure.
        // ADrainFailureAndANeverQuietBus_... is what proves the two are distinguishable; this asserts the
        // never-quiet arm's own wording reaches the caller at all.
        Assert.Contains("never went quiet", refused.Detail, StringComparison.Ordinal);
        Assert.Contains("retrying is safe", refused.Detail, StringComparison.Ordinal);

        // 🔴 The claim in that Detail, checked: the refused write put NOTHING on the line.
        Assert.Equal(framesBefore, babbling.WriteCalls);

        await lease.DisposeAsync();
        links.Master.Dispose();
    }

    /// <summary>A link that never stops producing bytes, so <c>ModbusBus.ResynchroniseAsync</c> can never
    /// observe a quiet window. Counts writes so the test above can assert that the refused write reached the
    /// line with zero frames — the counter is on the LINK rather than on the pair's own recorder because this
    /// decorator is what the bus actually holds.</summary>
    private sealed class BabblingLink(InMemoryBusLink inner, Func<int>? drain = null) : IModbusBusLink
    {
        private int _writeCalls;

        public int WriteCalls => Volatile.Read(ref _writeCalls);

        public int InfiniteTimeout => inner.InfiniteTimeout;
        public int ReadTimeout { get => inner.ReadTimeout; set => inner.ReadTimeout = value; }
        public int WriteTimeout { get => inner.WriteTimeout; set => inner.WriteTimeout = value; }
        public bool IsOpen => inner.IsOpen;

        public void DiscardInBuffer() => inner.DiscardInBuffer();

        // Default: always claims to have drained something, so the quiet window restarts forever. 🔴 Review I-1
        // — a caller can instead supply a drain that THROWS, which is the second, live way
        // ModbusBus.ResynchroniseAsync raises ModbusBusResynchronisationException (GatewayTcpBusLink
        // deliberately lets an IOException escape its own drain). Parameterised rather than duplicated so the
        // two refusal causes are driven through one decorator and cannot drift apart.
        public int DrainBufferedInput() => drain is null ? 4 : drain();

        public void AbortPendingRead() => inner.AbortPendingRead();

        public void ResetAbort() => inner.ResetAbort();

        public int Read(byte[] buffer, int offset, int count) => inner.Read(buffer, offset, count);

        public void Write(byte[] buffer, int offset, int count)
        {
            Interlocked.Increment(ref _writeCalls);
            inner.Write(buffer, offset, count);
        }

        public void Dispose() => inner.Dispose();
    }

    /// <summary>
    /// 🔴 <b>Review I-1 — the two causes that refuse a transaction must produce DISTINGUISHABLE
    /// <c>Detail</c>.</b>
    ///
    /// <para><c>ModbusBusResynchronisationException</c> is raised from exactly two places: the link would not go
    /// quiet, and <b>the drain itself threw</b> — the second being live and intentional, because
    /// <c>GatewayTcpBusLink.DrainBufferedInput</c> deliberately lets an <c>IOException</c>/<c>SocketException</c>
    /// escape on the strength of the bus's catch "tearing it down AND SAYING SO". The driver used to hard-code
    /// "would not go quiet" for both, so a dead link told an operator to go hunting a babbling device.</para>
    ///
    /// <para>Both arms in ONE test, deliberately: "distinguishable" is a claim about a pair, and a mutation that
    /// collapses the two back onto one string has to fail something that compares them. The
    /// <c>Assert.NotEqual</c> is the discriminating assertion; the two <c>Contains</c> are what stop it passing
    /// on two strings that merely differ. 🔴 Re-review N-2: both arms use ONE bus key, because with two keys
    /// the two Details differed by the key alone and <c>NotEqual</c> would have held even if both causes had
    /// collapsed onto one canned string.</para>
    /// </summary>
    [Fact]
    public async Task ADrainFailureAndANeverQuietBus_RefuseTheWriteWithDifferentReasons_NotOneCannedString()
    {
        async Task<string> RefusalDetailAsync(string busKey, Func<int>? drain)
        {
            var links = InMemoryBusLinkPair.Create();
            var registry = new ModbusBusRegistry();
            var link = new BabblingLink(links.Master, drain);
            var lease = registry.Acquire(busKey, _ => Task.FromResult<IModbusBusLink>(link),
                new ModbusBusSettings(QuietWindowMs: 30, PollSliceMs: 2));

            await using (var driver = new ModbusRtuDriver(lease, WritableMap("REFUSE-M1", unitId: 1, readTimeoutMs: 150)))
            {
                // Quarantine the bus with a genuine timeout — nothing on the far end answers.
                var first = await driver.WriteSetpointAsync(new SetpointWriteRequest(SpeedPoint, 10.0), CancellationToken.None);
                Assert.Equal(WriteOutcome.Indeterminate, first.Outcome);
                Assert.True(lease.Bus.IsDesynchronised);

                var framesBefore = link.WriteCalls;
                var refused = await driver.WriteSetpointAsync(new SetpointWriteRequest(SpeedPoint, 20.0), CancellationToken.None);

                Assert.Equal(WriteOutcome.Failed, refused.Outcome);
                Assert.Null(refused.RejectionReason);
                // The claim both causes share, and the only one that is true on both paths.
                Assert.Contains("refused before any byte reached the line", refused.Detail, StringComparison.Ordinal);
                Assert.Contains("untouched", refused.Detail, StringComparison.Ordinal);
                Assert.Contains("retrying is safe", refused.Detail, StringComparison.Ordinal);
                Assert.Equal(framesBefore, link.WriteCalls);

                await lease.DisposeAsync();
                await registry.DisposeAsync();
                links.Master.Dispose();
                return refused.Detail!;
            }
        }

        // 🔴 Re-review N-2 — ONE key for both arms, and that is what makes the Assert.NotEqual below mean
        // anything. With two different keys the two Details differed by the key alone, so NotEqual would have
        // passed even if both causes had collapsed back onto one canned string — the assertion this test calls
        // its discriminating one could not discriminate. The two registries are independent objects, so the
        // same key names a different bus in each.
        const string oneKey = "refusal-cause-bus";
        var neverQuiet = await RefusalDetailAsync(oneKey, drain: null);
        var drainFailed = await RefusalDetailAsync(
            oneKey, drain: () => throw new IOException("the link went away underneath the drain"));

        _output.WriteLine($"never went quiet -> {neverQuiet}");
        _output.WriteLine($"drain threw     -> {drainFailed}");

        // 🔴 The discriminating assertion: one canned string for two causes fails here.
        Assert.NotEqual(neverQuiet, drainFailed);

        Assert.Contains("never went quiet", neverQuiet, StringComparison.Ordinal);
        Assert.DoesNotContain("failed while draining", neverQuiet, StringComparison.Ordinal);

        Assert.Contains("failed while draining", drainFailed, StringComparison.Ordinal);
        Assert.DoesNotContain("never went quiet", drainFailed, StringComparison.Ordinal);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 5b. THE CRITICAL — every in-flight failure branch of InvokeCommandAsync, which is the member that
    //        answers "did a machine cycle start?". The review applied five mutations to this path
    //        SIMULTANEOUSLY and the whole suite stayed green: the outcome was asserted, the Detail never was.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>An assert half that gets no answer says THE CYCLE MAY HAVE STARTED — in those words.</b>
    ///
    /// <para>This is the command-path counterpart of the setpoint's timeout test, and it is the branch the
    /// review found completely unguarded: <c>InvokeCommandAsync_AgainstASilentDevice_...</c> asserted the
    /// outcome and nothing else, so mutating this <c>Detail</c> to the generic backstop string survived a full
    /// green suite. That is the exact defect Đợt B shipped twice — a <c>NullReferenceException</c> in a
    /// <c>finally</c> replacing an authored message with "unexpected failure" — reachable here on the one
    /// message whose reader may be standing next to something that is now moving.</para>
    ///
    /// <para>Every clause is asserted separately because each answers a different operator question, and a
    /// mutation that drops one survives a test that checks another: what happened, that a cycle may have
    /// started, which unit and machine, which coil and that it may be latched, the bound that elapsed, that
    /// nothing was resent, and that the bus is quarantined. Plus the <c>DoesNotContain</c> that catches the
    /// generic-backstop regression directly.</para>
    /// </summary>
    [Fact]
    public async Task ACommandWhoseAssertHalfTimesOut_SaysTheCycleMayHaveStarted_NotJustThatACoilFailed()
    {
        const int boundMs = 400;

        await using var harness = ModbusRtuLoopbackHarness.Start(((byte)4, new ushort[] { 1 }));
        harness.Links.Device.SilentUnitId = 4;

        await using var driver = new ModbusRtuDriver(harness.Lease(), WritableMap("CYCLE-C4", unitId: 4, readTimeoutMs: boundMs));

        var stopwatch = Stopwatch.StartNew();
        var result = await driver.InvokeCommandAsync(new CommandRequest(StartCycleCommand), CancellationToken.None);
        stopwatch.Stop();

        Assert.Equal(WriteOutcome.Indeterminate, result.Outcome);
        Assert.Null(result.RejectionReason);

        Assert.Contains("command did not complete", result.Detail, StringComparison.Ordinal);
        Assert.Contains("THE CYCLE MAY HAVE STARTED", result.Detail, StringComparison.Ordinal);
        Assert.Contains("unit 4", result.Detail, StringComparison.Ordinal);
        Assert.Contains("CYCLE-C4", result.Detail, StringComparison.Ordinal);
        Assert.Contains($"coil {StartCycleCoil}", result.Detail, StringComparison.Ordinal);
        Assert.Contains("latched", result.Detail, StringComparison.Ordinal);
        Assert.Contains($"{boundMs} ms", result.Detail, StringComparison.Ordinal);
        Assert.Contains("NOT retried", result.Detail, StringComparison.Ordinal);
        Assert.Contains("quarantined", result.Detail, StringComparison.Ordinal);
        Assert.DoesNotContain("unexpected failure", result.Detail, StringComparison.Ordinal);

        // It genuinely waited out the bound rather than short-circuiting it, with no retry.
        Assert.True(stopwatch.ElapsedMilliseconds >= boundMs - 60,
            $"the command returned after only {stopwatch.ElapsedMilliseconds} ms against a {boundMs} ms bound.");
        Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(5),
            $"the command took {stopwatch.Elapsed} — unexpectedly slow for one bounded attempt with no retry.");
    }

    /// <summary>🔴 The command path's in-flight cancellation, which the review mutated to the generic backstop
    /// string and watched survive. Same content discipline as the setpoint's, plus the two claims only this
    /// member can make; and the same two mechanism assertions that are the real load-bearing ones — the shared
    /// line was NOT rebuilt, and a second machine on it still reads its own value afterwards.</summary>
    [Fact]
    public async Task ACancelledInFlightCommand_ReportsIndeterminate_NamingTheCycle_AndDoesNotTearDownTheBus()
    {
        await using var harness = ModbusRtuLoopbackHarness.Start(
            ((byte)1, new ushort[] { 111 }),
            ((byte)2, new ushort[] { 222 }));
        harness.Links.Device.SilentUnitId = 1;

        var lease = harness.Lease();
        await using var driver = new ModbusRtuDriver(lease, WritableMap("CANCEL-C1", unitId: 1, readTimeoutMs: 30_000));

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));
        var stopwatch = Stopwatch.StartNew();
        var result = await driver.InvokeCommandAsync(new CommandRequest(StartCycleCommand), cts.Token);
        stopwatch.Stop();

        Assert.Equal(WriteOutcome.Indeterminate, result.Outcome);
        Assert.Contains("cancelled before a definitive response arrived", result.Detail, StringComparison.Ordinal);
        Assert.Contains("THE CYCLE MAY HAVE STARTED", result.Detail, StringComparison.Ordinal);
        Assert.Contains("already been written", result.Detail, StringComparison.Ordinal);
        Assert.Contains("latched", result.Detail, StringComparison.Ordinal);
        Assert.DoesNotContain("unexpected failure", result.Detail, StringComparison.Ordinal);

        _output.WriteLine(
            $"MEASURED cancellation of an in-flight RTU command: {stopwatch.Elapsed.TotalMilliseconds:F2} ms against a " +
            "30 000 ms bound.");
        Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(2),
            $"cancellation took {stopwatch.Elapsed} to unblock a command bounded at 30 s.");

        Assert.Equal(1, lease.Bus.LinkGeneration);

        harness.Links.Device.SilentUnitId = null;
        await using var reader = new ModbusRtuDriver(
            harness.Lease(), ReadOnlySingleRegisterMap("CANCEL-C2", unitId: 2, pollIntervalMs: 60_000, readTimeoutMs: 1_000));

        DeviceReading? fromTwo = null;
        using var readCts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        var pump = DriveAsync(reader, r => Volatile.Write(ref fromTwo, r), readCts.Token);
        try
        {
            await WaitUntilAsync(() => Volatile.Read(ref fromTwo) is not null, "machine 2 to read after the cancelled command");
        }
        finally
        {
            await readCts.CancelAsync();
            try { await pump; } catch (OperationCanceledException) { }
        }

        Assert.Equal(222.0, (double)Volatile.Read(ref fromTwo)!.Telemetry.Single().Value!, precision: 10);
        Assert.Equal(1, lease.Bus.LinkGeneration);
    }

    /// <summary>🔴 A command cancelled while QUEUED reports <see cref="WriteOutcome.Indeterminate"/>, never
    /// <see cref="WriteOutcome.Failed"/>. The review mutated exactly this to <c>Failed</c> and it survived —
    /// which violates B-1 directly and silently, and would put "the machine definitely did not start" into
    /// D-7's audit row for a command nobody can say that about. The claim is checked at the bus boundary: not
    /// one FC05 frame, on a line busy with the dead device's reads throughout.</summary>
    [Fact]
    public async Task ACommandCancelledWhileQueuedBehindADeadDevice_ReportsIndeterminate_AndProvablyNeverFired()
    {
        const int deadHoldMs = 3_000;

        await using var harness = ModbusRtuLoopbackHarness.Start(
            ((byte)1, new ushort[] { 111 }),
            ((byte)9, new ushort[] { 999 }));
        harness.Links.Device.SilentUnitId = 9;

        await using var keepAlive = harness.Lease();

        using var deadCts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        await using var dead = new ModbusRtuDriver(
            harness.Lease(), ReadOnlySingleRegisterMap("QUEUE-C-DEAD", unitId: 9, pollIntervalMs: 1, readTimeoutMs: deadHoldMs));
        var deadPump = DriveAsync(dead, _ => { }, deadCts.Token);

        try
        {
            await WaitUntilAsync(() => harness.Links.Device.FramesSilenced > 0, "the dead device to take the bus");

            await using var commander = new ModbusRtuDriver(harness.Lease(), WritableMap("QUEUE-C1", unitId: 1, readTimeoutMs: 2_000));

            using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(150));
            var stopwatch = Stopwatch.StartNew();
            var result = await commander.InvokeCommandAsync(new CommandRequest(StartCycleCommand), cts.Token);
            stopwatch.Stop();

            Assert.Equal(WriteOutcome.Indeterminate, result.Outcome);
            Assert.Contains("queued for the shared RTU bus", result.Detail, StringComparison.Ordinal);
            Assert.Contains("untouched", result.Detail, StringComparison.Ordinal);
            Assert.Contains("Retrying is safe", result.Detail, StringComparison.Ordinal);

            Assert.True(stopwatch.ElapsedMilliseconds < deadHoldMs / 3,
                $"the cancelled command took {stopwatch.ElapsedMilliseconds} ms against a {deadHoldMs} ms hold.");

            // 🔴 Provably never fired: no FC05 frame at all, on a line that was carrying FC03 frames throughout.
            Assert.Empty(FramesWithFunction(harness.Links.Master, RtuFrames.FunctionWriteSingleCoil));
            Assert.False(harness.Slaves[1].DataStore.CoilDiscretes.ReadPoints(StartCycleCoil, 1)[0]);
            Assert.True(harness.Links.Master.WrittenFrames.Count > 0, "the bus should have been busy with the dead device's reads");
        }
        finally
        {
            await deadCts.CancelAsync();
            try { await deadPump; } catch (OperationCanceledException) { }
        }
    }

    /// <summary>🔴 A command refused by a bus that cannot be made trustworthy reports
    /// <see cref="WriteOutcome.Failed"/> — the review mutated this to <see cref="WriteOutcome.Indeterminate"/>
    /// and it survived, so §4.3's "pinned in both directions" was true of the setpoint member only. It is now
    /// true of both, which is what that section claimed about the driver.</summary>
    [Fact]
    public async Task ACommandOntoABusThatWillNotGoQuiet_IsRefusedBeforeAnyByteReachesTheLine_AndReportsFailed()
    {
        var links = InMemoryBusLinkPair.Create();
        await using var registry = new ModbusBusRegistry();

        var babbling = new BabblingLink(links.Master);
        var lease = registry.Acquire(
            "babbling-command-bus",
            _ => Task.FromResult<IModbusBusLink>(babbling),
            new ModbusBusSettings(QuietWindowMs: 30, PollSliceMs: 2));

        await using var driver = new ModbusRtuDriver(lease, WritableMap("BABBLE-C1", unitId: 1, readTimeoutMs: 150));

        var first = await driver.InvokeCommandAsync(new CommandRequest(StartCycleCommand), CancellationToken.None);
        Assert.Equal(WriteOutcome.Indeterminate, first.Outcome);
        Assert.True(lease.Bus.IsDesynchronised);

        var framesBefore = babbling.WriteCalls;
        var refused = await driver.InvokeCommandAsync(new CommandRequest(StartCycleCommand), CancellationToken.None);

        Assert.Equal(WriteOutcome.Failed, refused.Outcome);
        Assert.Null(refused.RejectionReason);
        Assert.Contains("refused before any byte reached the line", refused.Detail, StringComparison.Ordinal);
        Assert.Contains("untouched", refused.Detail, StringComparison.Ordinal);
        Assert.Contains("never went quiet", refused.Detail, StringComparison.Ordinal);
        Assert.Contains("retrying is safe", refused.Detail, StringComparison.Ordinal);

        // The Detail's claim, checked: the refused command put NOTHING on the line.
        Assert.Equal(framesBefore, babbling.WriteCalls);

        await lease.DisposeAsync();
        links.Master.Dispose();
    }

    /// <summary>
    /// 🔴 <b>A bus disposed out from under a driver reports <see cref="WriteOutcome.Indeterminate"/> on BOTH
    /// members.</b> The review mutated the command path's <c>ObjectDisposedException</c> catch to
    /// <see cref="WriteOutcome.Failed"/> and it survived; checking my own suite afterwards, the setpoint path's
    /// equivalent was unguarded too — nothing exercised either. This is a different branch from
    /// <c>AWriteOrCommandAfterDisposal_...</c>, which covers the DRIVER's own <c>_disposed</c> flag; here the
    /// driver is alive and the bus underneath it is gone, which is what a registry teardown racing a live
    /// connector produces.
    ///
    /// <para><see cref="WriteOutcome.Failed"/> would be wrong for the same reason it is right for a refusal:
    /// a refusal is the transport explicitly reporting failure, whereas this is the transport no longer being
    /// there to report anything. Both members asserted in one test because both must hold and either
    /// regressing fails it.</para>
    /// </summary>
    [Fact]
    public async Task AWriteOrCommandOnADisposedBus_ReportsIndeterminate_NotFailed()
    {
        var links = InMemoryBusLinkPair.Create();
        var registry = new ModbusBusRegistry();
        var lease = registry.Acquire("disposed-bus", _ => Task.FromResult<IModbusBusLink>(links.Master));

        await using var driver = new ModbusRtuDriver(lease, WritableMap("DISPOSEDBUS-M1", unitId: 1, readTimeoutMs: 500));

        // The registry goes away while this driver still holds its lease — the driver itself is untouched.
        await registry.DisposeAsync();

        var write = await driver.WriteSetpointAsync(new SetpointWriteRequest(SpeedPoint, 42.0), CancellationToken.None);
        Assert.Equal(WriteOutcome.Indeterminate, write.Outcome);
        Assert.Contains("was disposed before this write could start", write.Detail, StringComparison.Ordinal);
        Assert.Contains("untouched", write.Detail, StringComparison.Ordinal);

        var command = await driver.InvokeCommandAsync(new CommandRequest(StartCycleCommand), CancellationToken.None);
        Assert.Equal(WriteOutcome.Indeterminate, command.Outcome);
        Assert.Contains("was disposed before this write could start", command.Detail, StringComparison.Ordinal);

        Assert.Empty(links.Master.WrittenFrames);

        links.Master.Dispose();
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 6. Cancellation — measured, and it must not tear the shared line down.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>Cancelling an in-flight write unblocks it in milliseconds against a 30 s bound, reports
    /// <see cref="WriteOutcome.Indeterminate"/>, and leaves the shared line OPEN.</b>
    ///
    /// <para>The bound is deliberately enormous: if cancellation did not actually unblock the write, this test
    /// would take ~30 s rather than fail, and the elapsed assertion is what tells those apart. But the elapsed
    /// time is not the load-bearing claim — <see cref="ModbusBus.LinkGeneration"/> not moving, and a SECOND
    /// MACHINE reading its own correct value afterwards, are. Đợt B's cancellation mechanism (dispose the
    /// transport) would satisfy a latency assertion and fail both of those, and on a real bus it would take
    /// every other machine down with it.</para>
    /// </summary>
    [Fact]
    public async Task ACancelledInFlightWrite_UnblocksPromptly_ReportsIndeterminate_AndDoesNotTearDownTheBus()
    {
        await using var harness = ModbusRtuLoopbackHarness.Start(
            ((byte)1, new ushort[] { 111, 0, 0, 0, 0, 11 }),
            ((byte)2, new ushort[] { 222 }));
        harness.Links.Device.SilentUnitId = 1;

        var lease = harness.Lease();
        await using var driver = new ModbusRtuDriver(lease, WritableMap("CANCEL-W1", unitId: 1, readTimeoutMs: 30_000));

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));
        var stopwatch = Stopwatch.StartNew();
        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest(SpeedPoint, 42.0), cts.Token);
        stopwatch.Stop();

        Assert.Equal(WriteOutcome.Indeterminate, result.Outcome);
        Assert.Contains("cancelled before a definitive response arrived", result.Detail, StringComparison.Ordinal);
        Assert.Contains("already been written", result.Detail, StringComparison.Ordinal);
        Assert.Contains("unknown", result.Detail, StringComparison.Ordinal);
        Assert.DoesNotContain("unexpected failure", result.Detail, StringComparison.Ordinal);

        _output.WriteLine(
            $"MEASURED cancellation of an in-flight RTU write: {stopwatch.Elapsed.TotalMilliseconds:F2} ms against a " +
            "30 000 ms write bound.");

        Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(2),
            $"cancellation took {stopwatch.Elapsed} to unblock a write bounded at 30 s — AbortPendingRead should unblock " +
            "it almost immediately (D-2 measured 1.72 ms on this link), not wait out anything close to the bound.");

        // 🔴 The line was never rebuilt...
        Assert.Equal(1, lease.Bus.LinkGeneration);

        // ...and a different machine on it still works, which is the consequence that distinguishes "the link
        // survived" from "the link was rebuilt fast enough that nobody noticed".
        harness.Links.Device.SilentUnitId = null;
        await using var reader = new ModbusRtuDriver(
            harness.Lease(), ReadOnlySingleRegisterMap("CANCEL-M2", unitId: 2, pollIntervalMs: 60_000, readTimeoutMs: 1_000));

        DeviceReading? fromTwo = null;
        using var readCts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        var pump = DriveAsync(reader, r => Volatile.Write(ref fromTwo, r), readCts.Token);
        try
        {
            await WaitUntilAsync(() => Volatile.Read(ref fromTwo) is not null, "machine 2 to read after the cancellation");
        }
        finally
        {
            await readCts.CancelAsync();
            try { await pump; } catch (OperationCanceledException) { }
        }

        Assert.Equal(222.0, (double)Volatile.Read(ref fromTwo)!.Telemetry.Single().Value!, precision: 10);
        Assert.Equal(1, lease.Bus.LinkGeneration);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 7. What an operator waits when a dead device is holding the shared line.
    //      These two are the evidence behind the per-device backoff decision — see task-5-report.md §7.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>A write queued behind a dead device's hold is SERVED after it, and the wait is measured rather
    /// than argued.</b> The dead device holds the shared arbitration lock for its entire read timeout on every
    /// poll; a write arriving mid-hold waits it out and then applies. This is the number an operator
    /// experiences, and the reason task-5-report.md §7 argues the write path's exposure is bounded by the
    /// LENGTH of one hold — which a per-device backoff cannot shorten, because a backoff changes how OFTEN a
    /// device takes the line, never how long it keeps it once taken.
    /// </summary>
    [Fact]
    public async Task AWriteQueuedBehindADeadDevicesHold_IsServedAfterIt_AndTheWaitIsMeasured()
    {
        const int deadHoldMs = 700;

        await using var harness = ModbusRtuLoopbackHarness.Start(
            ((byte)1, new ushort[] { 111, 0, 0, 0, 0, 11 }),
            ((byte)9, new ushort[] { 999 }));
        harness.Links.Device.SilentUnitId = 9;

        // Holds the bus alive across the whole test — D-4 §7.8's trap: the last lease release disposes the bus
        // AND the shared link, and a phase measured against a dead pipe passes for the wrong reason.
        await using var keepAlive = harness.Lease();

        using var deadCts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        await using var dead = new ModbusRtuDriver(
            harness.Lease(), ReadOnlySingleRegisterMap("HOLD-DEAD", unitId: 9, pollIntervalMs: 1, readTimeoutMs: deadHoldMs));
        var deadPump = DriveAsync(dead, _ => { }, deadCts.Token);

        try
        {
            // Let the dead device actually take the line before the write queues behind it.
            await WaitUntilAsync(() => harness.Links.Device.FramesSilenced > 0, "the dead device to take the bus");

            await using var writer = new ModbusRtuDriver(harness.Lease(), WritableMap("HOLD-W1", unitId: 1, readTimeoutMs: 2_000));

            var stopwatch = Stopwatch.StartNew();
            var result = await writer.WriteSetpointAsync(new SetpointWriteRequest(SpeedPoint, 250.0), CancellationToken.None);
            stopwatch.Stop();

            _output.WriteLine(
                $"MEASURED operator wait: a setpoint write queued behind ONE dead device holding the shared bus for " +
                $"{deadHoldMs} ms per poll was served after {stopwatch.ElapsedMilliseconds} ms and reported {result.Outcome}.");
            _output.WriteLine(
                "DERIVED (from the map, not measured here): at map DEFAULTS a 2-register device on a 1 s cadence holds " +
                "the line for 2 x (1+1) x max(1000, 1000x4) = 16 000 ms per poll — see ModbusRegisterMap.WorstCaseBusHoldMs.");

            Assert.Equal(WriteOutcome.Applied, result.Outcome);
            Assert.Equal((ushort)250, harness.Slaves[1].DataStore.HoldingRegisters.ReadPoints(SpeedRegister, 1)[0]);

            // The write really did have to wait — otherwise the measurement above is of an idle bus. The bound
            // is a fraction of one hold, so it states "it queued", not a machine's speed.
            Assert.True(stopwatch.ElapsedMilliseconds > deadHoldMs / 4,
                $"the write completed in {stopwatch.ElapsedMilliseconds} ms against a {deadHoldMs} ms hold — it does not " +
                "appear to have queued behind the dead device at all, so this test is not measuring what it claims.");
        }
        finally
        {
            await deadCts.CancelAsync();
            try { await deadPump; } catch (OperationCanceledException) { }
        }
    }

    /// <summary>
    /// 🔴 <b>The bound that actually protects an operator: the write's own token, honoured while queued — and
    /// when it fires, the device is PROVABLY untouched.</b>
    ///
    /// <para>This is the answer to "what does an operator see, and how long do they wait" when a dead device is
    /// holding the line. They wait as long as they chose to, and then they are told the request never reached
    /// the wire and retrying is safe — which is a different and much better message than "indeterminate". The
    /// assertion that makes it a fact rather than a wording is the last one: NOT ONE FC06 frame reached the bus
    /// boundary, on a line that was busy throughout with the dead device's own reads.</para>
    /// </summary>
    [Fact]
    public async Task AWriteCancelledWhileQueuedBehindADeadDevice_UnblocksPromptly_AndLeavesTheDeviceProvablyUntouched()
    {
        const int deadHoldMs = 3_000;

        await using var harness = ModbusRtuLoopbackHarness.Start(
            ((byte)1, new ushort[] { 111, 0, 0, 0, 0, 11 }),
            ((byte)9, new ushort[] { 999 }));
        harness.Links.Device.SilentUnitId = 9;

        await using var keepAlive = harness.Lease();

        using var deadCts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        await using var dead = new ModbusRtuDriver(
            harness.Lease(), ReadOnlySingleRegisterMap("QUEUE-DEAD", unitId: 9, pollIntervalMs: 1, readTimeoutMs: deadHoldMs));
        var deadPump = DriveAsync(dead, _ => { }, deadCts.Token);

        try
        {
            await WaitUntilAsync(() => harness.Links.Device.FramesSilenced > 0, "the dead device to take the bus");

            await using var writer = new ModbusRtuDriver(harness.Lease(), WritableMap("QUEUE-W1", unitId: 1, readTimeoutMs: 2_000));

            using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(150));
            var stopwatch = Stopwatch.StartNew();
            var result = await writer.WriteSetpointAsync(new SetpointWriteRequest(SpeedPoint, 250.0), cts.Token);
            stopwatch.Stop();

            _output.WriteLine(
                $"MEASURED operator escape hatch: a write queued behind a {deadHoldMs} ms hold, cancelled after 150 ms, " +
                $"returned after {stopwatch.ElapsedMilliseconds} ms as {result.Outcome}.");

            Assert.Equal(WriteOutcome.Indeterminate, result.Outcome);
            Assert.Contains("queued for the shared RTU bus", result.Detail, StringComparison.Ordinal);
            Assert.Contains("untouched", result.Detail, StringComparison.Ordinal);
            Assert.Contains("Retrying is safe", result.Detail, StringComparison.Ordinal);

            // Far below one hold, so this cannot pass by the hold merely having ended.
            Assert.True(stopwatch.ElapsedMilliseconds < deadHoldMs / 3,
                $"the cancelled write took {stopwatch.ElapsedMilliseconds} ms against a {deadHoldMs} ms hold — the " +
                "arbitration wait is supposed to be cancellable, not something a caller has to wait out.");

            // 🔴 The Detail's claim, checked at the bus boundary: NOT ONE write frame went out, on a line that
            // was carrying the dead device's read frames the whole time.
            Assert.Empty(FramesWithFunction(harness.Links.Master, RtuFrames.FunctionWriteSingleRegister));
            Assert.Equal((ushort)11, harness.Slaves[1].DataStore.HoldingRegisters.ReadPoints(SpeedRegister, 1)[0]);
            Assert.True(harness.Links.Master.WrittenFrames.Count > 0, "the bus should have been busy with the dead device's reads");
        }
        finally
        {
            await deadCts.CancelAsync();
            try { await deadPump; } catch (OperationCanceledException) { }
        }
    }

    /// <summary>
    /// 🔴 <b>A cancellation observed AFTER the bus was taken but BEFORE the request was written also leaves the
    /// device provably untouched — and this test exists because that branch is otherwise only reachable in a
    /// race.</b>
    ///
    /// <para>The window is real: <c>SemaphoreSlim.WaitAsync(ct)</c> throws for a token cancelled while queued,
    /// so the only way to land between "the lock is mine" and "the first byte goes out" is for the token to fire
    /// in exactly that interval. A defect there is invisible to a mutation — nothing would ever run the branch,
    /// which is the reachability gap D-1's review found by READING rather than by mutating. It is made
    /// deterministic here by cancelling from inside the bus's own <c>openLink</c> delegate, which
    /// <c>ModbusBus.EnsureLinkAsync</c> invokes after the arbitration lock is held and before any transport
    /// configuration happens.</para>
    ///
    /// <para>What it buys, and why it is worth a branch: without it this case reports "the request had already
    /// been written… whether the device applied it is unknown", which is FALSE — nothing was written. On a bus
    /// where a caller giving up is the ordinary way a write ends, telling an operator to go and inspect a
    /// machine nothing was sent to is a real cost.</para>
    /// </summary>
    [Fact]
    public async Task AWriteCancelledAfterTakingTheBusButBeforeTheRequestIsWritten_ReportsTheDeviceUntouched()
    {
        var links = InMemoryBusLinkPair.Create();
        await using var registry = new ModbusBusRegistry();
        using var cts = new CancellationTokenSource();

        // Invoked by ModbusBus.EnsureLinkAsync while the arbitration lock is already held and before the
        // transport is configured — i.e. exactly the interval this branch defends.
        var lease = registry.Acquire("cancel-after-taking-bus", _ =>
        {
            cts.Cancel();
            return Task.FromResult<IModbusBusLink>(links.Master);
        });

        await using var responder = new RawRtuResponder(links.Device, (request, _) =>
            RtuFrames.WithCrc(request[0], request[1], request[2], request[3], request[4], request[5]));

        await using var driver = new ModbusRtuDriver(lease, WritableMap("PREWRITE-M1", unitId: 1, readTimeoutMs: 500));

        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest(SpeedPoint, 42.0), cts.Token);

        Assert.Equal(WriteOutcome.Indeterminate, result.Outcome);
        Assert.Contains("after taking the shared RTU bus", result.Detail, StringComparison.Ordinal);
        Assert.Contains("untouched", result.Detail, StringComparison.Ordinal);
        Assert.Contains("Retrying is safe", result.Detail, StringComparison.Ordinal);
        // The claim, checked: the responder never saw a request, so nothing was written.
        Assert.Equal(0, responder.RequestsSeen);
        Assert.Empty(FramesWithFunction(links.Master, RtuFrames.FunctionWriteSingleRegister));

        await lease.DisposeAsync();
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 8. B-3's limits, enforced through THIS entry point — device untouched in every rejection.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>Every rejection this entry point can produce, each asserted to have reached the shared bus with
    /// ZERO bytes.</b> "The register still holds its old value" is the weaker check — it also passes for a
    /// driver that wrote and was refused by the device. "No frame ever left the master" is the one B-1 actually
    /// requires ("MUST return Rejected WITHOUT touching the device at all"), and on a shared line it is also
    /// what stops a caller's typo from taxing every other machine.
    ///
    /// <para>One row per rejection, because a mutation deleting one guard survives a test that exercises
    /// another. The NaN row is B-3's Critical #2 reproduced through the new entry point:
    /// <see cref="double.NaN"/> fails every <c>&lt;</c>/<c>&gt;</c> comparison, so before that fix it passed
    /// both range checks and then <c>(ushort)double.NaN</c> wrote a raw 0 — a setpoint whose safe band starts
    /// at 100 silently writing zero.</para>
    /// </summary>
    [Theory]
    [InlineData("does-not-exist", 1.0, SetpointRejectionReason.UnknownPoint)]
    [InlineData(ReadOnlyPoint, 1.0, SetpointRejectionReason.NotWritable)]
    [InlineData(SpeedPoint, 600.0, SetpointRejectionReason.OutOfRange)]
    [InlineData(SpeedPoint, -1.0, SetpointRejectionReason.OutOfRange)]
    [InlineData(SpeedPoint, double.NaN, SetpointRejectionReason.OutOfRange)]
    [InlineData(SpeedPoint, double.PositiveInfinity, SetpointRejectionReason.OutOfRange)]
    [InlineData(SpeedPoint, true, SetpointRejectionReason.OutOfRange)]
    [InlineData(SpeedPoint, "fast", SetpointRejectionReason.OutOfRange)]
    [InlineData(SpeedPoint, null, SetpointRejectionReason.OutOfRange)]
    public async Task ARejectedWrite_NeverPutsAByteOnTheSharedBus(string point, object? value, SetpointRejectionReason expected)
    {
        await using var harness = ModbusRtuLoopbackHarness.Start(((byte)1, new ushort[] { 111, 0, 0, 0, 0, 11 }));
        await using var driver = new ModbusRtuDriver(harness.Lease(), WritableMap("REJECT-M1", unitId: 1));

        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest(point, value), CancellationToken.None);

        Assert.Equal(WriteOutcome.Rejected, result.Outcome);
        Assert.Equal(expected, result.RejectionReason);
        Assert.False(string.IsNullOrWhiteSpace(result.Detail));

        Assert.Empty(harness.Links.Master.WrittenFrames);
        Assert.Equal((ushort)11, harness.Slaves[1].DataStore.HoldingRegisters.ReadPoints(SpeedRegister, 1)[0]);
        Assert.Equal(0, harness.Links.Master.BytesWritten);
    }

    /// <summary>The command path's own pre-flight rejections, same discipline: refused with nothing on the
    /// line. Separate rows for the same reason as the setpoint theory above.</summary>
    [Theory]
    [InlineData("no-such-command", false, CommandRejectionReason.UnknownCommand)]
    [InlineData(StartCycleCommand, true, CommandRejectionReason.InvalidArgument)]
    public async Task ARejectedCommand_NeverPutsAByteOnTheSharedBus(string command, bool withArguments, CommandRejectionReason expected)
    {
        await using var harness = ModbusRtuLoopbackHarness.Start(((byte)1, new ushort[] { 111 }));
        await using var driver = new ModbusRtuDriver(harness.Lease(), WritableMap("REJECT-C1", unitId: 1));

        var request = withArguments
            ? new CommandRequest(command, new Dictionary<string, object> { ["speed"] = 1 })
            : new CommandRequest(command);

        var result = await driver.InvokeCommandAsync(request, CancellationToken.None);

        Assert.Equal(WriteOutcome.Rejected, result.Outcome);
        Assert.Equal(expected, result.RejectionReason);
        Assert.Empty(harness.Links.Master.WrittenFrames);
    }

    /// <summary>A command declaration with no coil address is refused rather than arming coil 0. Unreachable
    /// through <c>ModbusRegisterMap.FromJson</c>, which rejects it at parse time; reachable by direct
    /// construction, which is what this test does — the same reason <see cref="ModbusTcpDriver"/> keeps its own
    /// equivalent check. B-3's Critical #3: an omitted <c>coilAddress</c> used to bind to
    /// <c>default(ushort)</c> = 0, a real and valid coil, and commands trigger motion.</summary>
    [Fact]
    public async Task ACommandWithNoDeclaredCoilAddress_IsRefused_RatherThanArmingCoilZero()
    {
        await using var harness = ModbusRtuLoopbackHarness.Start(((byte)1, new ushort[] { 111 }));

        var map = WritableMap("NOCOIL-M1", unitId: 1);
        var broken = new ModbusRegisterMap
        {
            MachineCode = map.MachineCode,
            UnitId = map.UnitId,
            PollIntervalMs = map.PollIntervalMs,
            Registers = map.Registers,
            Commands = new List<ModbusCommand> { new("armed-by-omission", CoilAddress: null) },
        };

        await using var driver = new ModbusRtuDriver(harness.Lease(), broken);

        var result = await driver.InvokeCommandAsync(new CommandRequest("armed-by-omission"), CancellationToken.None);

        Assert.Equal(WriteOutcome.Rejected, result.Outcome);
        Assert.Equal(CommandRejectionReason.InvalidArgument, result.RejectionReason);
        Assert.Contains("no declared coil address", result.Detail, StringComparison.Ordinal);
        Assert.Empty(harness.Links.Master.WrittenFrames);
        Assert.False(harness.Slaves[1].DataStore.CoilDiscretes.ReadPoints(0, 1)[0]);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 9. The rest of the capability surface.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// <see cref="IWritableDeviceDriver.WritablePoints"/>/<see cref="IWritableDeviceDriver.Commands"/> mirror
    /// the map and are genuinely immutable — B-1 requires "a stable, effectively-immutable list, never a live
    /// view a caller could observe changing". An interface-typed reference over a <see cref="List{T}"/> does not
    /// satisfy that: a caller can cast it back and mutate it. The cast assertion is the discriminating one.
    /// </summary>
    [Fact]
    public async Task WritablePointsAndCommands_MirrorTheMap_AndAreNotAMutableListInDisguise()
    {
        await using var harness = ModbusRtuLoopbackHarness.Start(((byte)1, new ushort[] { 111 }));
        await using var driver = new ModbusRtuDriver(harness.Lease(), WritableMap("SURFACE-M1", unitId: 1));

        Assert.Equal(new[] { SpeedPoint }, driver.WritablePoints);
        Assert.Equal(new[] { StartCycleCommand }, driver.Commands);
        Assert.DoesNotContain(ReadOnlyPoint, driver.WritablePoints);

        Assert.Null(driver.WritablePoints as List<string>);
        Assert.Null(driver.Commands as List<string>);
        Assert.Throws<NotSupportedException>(() => ((IList<string>)driver.WritablePoints).Add("smuggled"));
    }

    /// <summary>A write issued after disposal reports <see cref="WriteOutcome.Indeterminate"/> without touching
    /// the bus — the driver's lease is already released, so reaching for it would be reaching at a bus other
    /// drivers may still be using. Both members asserted in one test because both must hold; either regressing
    /// fails it.</summary>
    [Fact]
    public async Task AWriteOrCommandAfterDisposal_ReportsIndeterminate_WithoutTouchingTheBus()
    {
        await using var harness = ModbusRtuLoopbackHarness.Start(((byte)1, new ushort[] { 111, 0, 0, 0, 0, 11 }));
        await using var keepAlive = harness.Lease();

        var driver = new ModbusRtuDriver(harness.Lease(), WritableMap("DISPOSED-M1", unitId: 1));
        await driver.DisposeAsync();

        var write = await driver.WriteSetpointAsync(new SetpointWriteRequest(SpeedPoint, 42.0), CancellationToken.None);
        Assert.Equal(WriteOutcome.Indeterminate, write.Outcome);
        Assert.Contains("already been disposed", write.Detail, StringComparison.Ordinal);

        var command = await driver.InvokeCommandAsync(new CommandRequest(StartCycleCommand), CancellationToken.None);
        Assert.Equal(WriteOutcome.Indeterminate, command.Outcome);
        Assert.Contains("already been disposed", command.Detail, StringComparison.Ordinal);

        Assert.Empty(harness.Links.Master.WrittenFrames);
        Assert.Equal((ushort)11, harness.Slaves[1].DataStore.HoldingRegisters.ReadPoints(SpeedRegister, 1)[0]);
    }

    /// <summary>
    /// A write issued while this driver's OWN poll loop is running is serialised by the bus's arbitration lock
    /// rather than interleaving bytes with it — the RTU analogue of B-4's write/poll interleaving decision, with
    /// the difference that the lock here is the whole line's rather than one driver's. Both succeed, and every
    /// reading the poll produced is still this machine's own correct value.
    /// </summary>
    [Fact]
    public async Task AWriteIssuedWhileThisDriversOwnPollIsRunning_IsSerialisedByTheBus_AndBothSucceed()
    {
        await using var harness = ModbusRtuLoopbackHarness.Start(((byte)1, new ushort[] { 111, 0, 0, 0, 0, 11 }));

        await using var driver = new ModbusRtuDriver(
            harness.Lease(), WritableMap("SERIAL-M1", unitId: 1, readTimeoutMs: 2_000, pollIntervalMs: 1));

        var gate = new object();
        var readings = new List<DeviceReading>();
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(25));
        var pump = DriveAsync(driver, r => { lock (gate) readings.Add(r); }, cts.Token);

        SetpointWriteResult result;
        try
        {
            await WaitUntilAsync(() => { lock (gate) return readings.Count >= 3; }, "the poll loop to get going");

            result = await driver.WriteSetpointAsync(new SetpointWriteRequest(SpeedPoint, 400.0), CancellationToken.None);

            await WaitUntilAsync(
                () => { lock (gate) return readings.Any(r => (double)r.Telemetry.Single(t => t.Metric == SpeedPoint).Value! == 400.0); },
                "the poll loop to read back the value the write applied");
        }
        finally
        {
            await cts.CancelAsync();
            try { await pump; } catch (OperationCanceledException) { }
        }

        Assert.Equal(WriteOutcome.Applied, result.Outcome);
        Assert.Equal((ushort)400, harness.Slaves[1].DataStore.HoldingRegisters.ReadPoints(SpeedRegister, 1)[0]);

        List<DeviceReading> observed;
        lock (gate) observed = readings.ToList();

        // Nothing interleaved: every reading is this machine's, and every temperature is the one constant this
        // slave holds. A corrupted frame on a line two operations shared would show up as a wrong number here.
        Assert.All(observed, r => Assert.Equal("SERIAL-M1", r.MachineCode));
        Assert.All(observed, r => Assert.Equal(111.0, (double)r.Telemetry.Single(t => t.Metric == ReadOnlyPoint).Value!, precision: 10));

        // 🔴 Review m-1 — a `Count(f => f.Length != RequestFrameLength) == 0` assertion used to sit here as the
        // "nothing interleaved" check. It could not discriminate: RtuFrames' own doc records that FC03/04/05/06
        // master requests are ALL 8 bytes, and InMemoryBusLink records one frame per Write call, so that count
        // is structurally always 0 whatever the driver does. D-4 found this exact shape twice in one task.
        // The two Assert.All above are what carry the claim — a poll that had its bytes interleaved with the
        // write's would decode a wrong temperature, and that is a number, not a length.
    }

    /// <summary>
    /// 🔴 <b>A device that explicitly refuses the write reports <see cref="WriteOutcome.Failed"/> — a KNOWN
    /// "no" — and the operator-visible detail is the device's own protocol code, not a redacted type name.</b>
    /// Driven through <see cref="RawRtuResponder"/> because a well-behaved NModbus slave answers every legal
    /// request: to see a Modbus exception response the frame has to be written by hand. The un-redacted string
    /// is deliberate and is the single most useful message on a commissioning bench.
    /// </summary>
    [Fact]
    public async Task ADeviceThatRejectsTheWrite_ReportsFailed_NamingTheModbusExceptionCode()
    {
        // A Modbus exception response: function code | 0x80, then the exception code. 0x02 = Illegal Data Address.
        static byte[] Reply(byte[] request, int index) =>
            RtuFrames.WithCrc(request[0], (byte)(request[1] | 0x80), 0x02);

        await using var rig = StartResponder(Reply, "slave-exception-bus");
        await using var driver = new ModbusRtuDriver(rig.Lease, WritableMap("REJECTED-M1", unitId: 1, readTimeoutMs: 500));

        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest(SpeedPoint, 42.0), CancellationToken.None);

        Assert.Equal(WriteOutcome.Failed, result.Outcome);
        Assert.Null(result.RejectionReason);
        Assert.Contains("device rejected the write", result.Detail, StringComparison.Ordinal);
        Assert.Contains("Illegal Data Address", result.Detail, StringComparison.Ordinal);
    }

    /// <summary>
    /// The command mirror of the test above, and it carries the outcome rule that matters most: a device that
    /// explicitly refuses the ASSERT half means the command never fired at all, which is the ONE case in the
    /// whole pulse where <see cref="WriteOutcome.Failed"/> is honest. Asserted together with the frame count,
    /// because "never fired" is a claim about the wire: a refused assert must not be followed by a reset write.
    /// </summary>
    [Fact]
    public async Task ADeviceThatRejectsTheAssertHalfOfAPulse_ReportsFailed_AndNoResetIsSent()
    {
        static byte[] Reply(byte[] request, int index) =>
            RtuFrames.WithCrc(request[0], (byte)(request[1] | 0x80), 0x01);

        await using var rig = StartResponder(Reply, "slave-exception-coil-bus");
        await using var driver = new ModbusRtuDriver(rig.Lease, WritableMap("REJECTED-C1", unitId: 1, readTimeoutMs: 500));

        var result = await driver.InvokeCommandAsync(new CommandRequest(StartCycleCommand), CancellationToken.None);

        Assert.Equal(WriteOutcome.Failed, result.Outcome);
        Assert.Contains("device rejected the command", result.Detail, StringComparison.Ordinal);
        Assert.Contains("Illegal Function", result.Detail, StringComparison.Ordinal);

        // Exactly one frame: the assert. A reset for a pulse that provably never fired would be an unattributable
        // extra write on a shared line.
        var request = Assert.Single(rig.Responder.Requests);
        Assert.Equal(RtuFrames.FunctionWriteSingleCoil, request[1]);
        Assert.Equal(0xFF00, RtuFrames.Word(request, 4));
    }

    /// <summary>
    /// 🔴 <b>A pulse whose ASSERT succeeded and whose RESET did not is <see cref="WriteOutcome.Indeterminate"/>,
    /// names the coil, and says it may be latched.</b> Never <see cref="WriteOutcome.Failed"/> (the command DID
    /// fire) and never <see cref="WriteOutcome.Applied"/> (the rest state is unconfirmed). A coil left latched
    /// high makes a level-triggered rung re-fire every scan, so this is the one message an operator has to be
    /// given rather than left to infer — and it is exactly the message Đợt B lost twice to a generic backstop.
    /// </summary>
    [Fact]
    public async Task APulseWhoseResetNeverCompletes_ReportsIndeterminate_NamingTheCoilAndThatItMayBeLatched()
    {
        // Answer the assert correctly; go silent for the reset.
        static byte[]? Reply(byte[] request, int index) => index == 0
            ? RtuFrames.WithCrc(request[0], request[1], request[2], request[3], request[4], request[5])
            : null;

        await using var rig = StartResponder(Reply, "latched-coil-bus");
        await using var driver = new ModbusRtuDriver(rig.Lease, WritableMap("LATCH-C1", unitId: 1, readTimeoutMs: 300));

        var result = await driver.InvokeCommandAsync(new CommandRequest(StartCycleCommand), CancellationToken.None);

        Assert.Equal(WriteOutcome.Indeterminate, result.Outcome);
        Assert.Contains($"coil {StartCycleCoil} was asserted", result.Detail, StringComparison.Ordinal);
        Assert.Contains("latched", result.Detail, StringComparison.Ordinal);
        Assert.DoesNotContain("unexpected failure", result.Detail, StringComparison.Ordinal);

        // Both halves really were attempted, and the reset really was the one that got no answer.
        Assert.Equal(2, rig.Responder.Requests.Count);
        Assert.Equal(0xFF00, RtuFrames.Word(rig.Responder.Requests[0], 4));
        Assert.Equal(0x0000, RtuFrames.Word(rig.Responder.Requests[1], 4));

        // And the bus is quarantined, because the reset write never consumed a validated response.
        Assert.True(rig.Lease.Bus.IsDesynchronised);
    }

    /// <summary>
    /// 🔴 <b>Both halves of a pulse run inside ONE bus transaction.</b> Releasing the arbitration lock between
    /// the assert and the reset would let another machine's transaction run while a coil sat latched HIGH — on a
    /// bus with a slow device that is not microseconds, it is up to that device's whole read timeout. Asserted
    /// mechanically rather than by timing: a second device parked on the arbitration lock cannot get in between
    /// the two halves, so the responder sees BOTH pulse frames before the other machine's read frame.
    /// </summary>
    [Fact]
    public async Task BothHalvesOfAPulse_ShareOneTransaction_SoNoOtherMachineCanRunBetweenThem()
    {
        var seen = new List<byte>();
        var gate = new object();

        byte[] Reply(byte[] request, int index)
        {
            lock (gate) seen.Add(request[1]);

            // Slow the ASSERT's answer down, so any other transaction that COULD start between the halves has
            // ample opportunity to. It cannot, because the arbitration lock is held for the whole pulse.
            if (index == 0) Thread.Sleep(250);

            return request[1] == RtuFrames.FunctionReadHoldingRegisters
                ? RtuFrames.WithCrc(request[0], request[1], 0x02, 0x00, 0x63)
                : RtuFrames.WithCrc(request[0], request[1], request[2], request[3], request[4], request[5]);
        }

        var links = InMemoryBusLinkPair.Create();
        await using var registry = new ModbusBusRegistry();
        var busKey = "atomic-pulse-bus";
        var pulseLease = registry.Acquire(busKey, _ => Task.FromResult<IModbusBusLink>(links.Master));
        var readerLease = registry.Acquire(busKey, _ => Task.FromResult<IModbusBusLink>(links.Master));
        await using var responder = new RawRtuResponder(links.Device, Reply);

        await using var pulser = new ModbusRtuDriver(pulseLease, WritableMap("ATOMIC-C1", unitId: 1, readTimeoutMs: 5_000));
        await using var reader = new ModbusRtuDriver(
            readerLease, ReadOnlySingleRegisterMap("ATOMIC-M1", unitId: 1, pollIntervalMs: 1, readTimeoutMs: 5_000));

        using var readCts = new CancellationTokenSource(TimeSpan.FromSeconds(25));
        var pulse = pulser.InvokeCommandAsync(new CommandRequest(StartCycleCommand), CancellationToken.None);
        Task? readPump = null;

        // 🔴 Everything from the launch of `pulse` onwards is inside the try, and both tasks are joined in the
        // finally — including on the path where the FIRST WaitUntilAsync fails. "A cancel that only runs on the
        // success path is an abandon in every case that matters" is this suite's own rule, and an assertion
        // failure that also strands a live driver on a shared link poisons the next build (verify-suites trap 1).
        CommandResult result;
        try
        {
            // Wait until the pulse has genuinely taken the line, THEN start the competitor.
            await WaitUntilAsync(() => responder.RequestsSeen >= 1, "the pulse to take the bus");
            readPump = DriveAsync(reader, _ => { }, readCts.Token);

            result = await pulse;
            await WaitUntilAsync(() => responder.RequestsSeen >= 3, "the other machine's read to be served after the pulse");
        }
        finally
        {
            await readCts.CancelAsync();
            if (readPump is not null)
            {
                try { await readPump; } catch (OperationCanceledException) { }
            }

            // The pulse is bounded by its own 5 s read timeout, so this always settles; joined so a failed
            // assertion cannot leave it holding the arbitration lock while the responder is being torn down.
            try { await pulse; } catch { /* teardown */ }
        }

        Assert.Equal(WriteOutcome.Applied, result.Outcome);

        List<byte> order;
        lock (gate) order = seen.ToList();

        // 🔴 The two FC05 halves are adjacent — no FC03 between them.
        Assert.Equal(RtuFrames.FunctionWriteSingleCoil, order[0]);
        Assert.Equal(RtuFrames.FunctionWriteSingleCoil, order[1]);
        Assert.Contains(RtuFrames.FunctionReadHoldingRegisters, order);

        await pulseLease.DisposeAsync();
        await readerLease.DisposeAsync();
        links.Master.Dispose();
    }
}
