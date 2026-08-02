using System.Diagnostics;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers.Modbus;
using Xunit;
using Xunit.Abstractions;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// 🔴 Task D-4 — <b>several machines actually running on one bus.</b> D-2 built the shared, reference-counted
/// bus and proved it with TWO drivers; D-3 added the serial link. This class is where N devices at N slave
/// addresses are driven together against a REAL in-process NModbus RTU slave network (real CRC, real t3.5
/// framing, real dispatch by unit id) and the costs of sharing one wire are MEASURED rather than asserted.
///
/// <para><b>What each test is actually about:</b></para>
/// <list type="bullet">
/// <item><description>attribution — no device's reading is ever reported under another device's machine
/// code, which is the thing a shared bus can get wrong and a per-device connection cannot;</description></item>
/// <item><description>one physical open for N leases, and the last release disposing;</description></item>
/// <item><description>the quarantine's real cost at N devices — <b>ONE quiet window per timeout EVENT, not
/// one per device</b>, which is narrower than D-2's own §5.5 wording and is the number an operator
/// experiences;</description></item>
/// <item><description>the cost that DOES scale with N and is far larger: a device that never answers holds
/// the shared arbitration lock for its whole read timeout on every poll, taxing every other device on the
/// line;</description></item>
/// <item><description>fairness — a device polling at a slow cadence is not starved by devices polling flat
/// out.</description></item>
/// </list>
///
/// <para><b>On the timing assertions.</b> The two measurement tests compare a RATE against a rate measured on
/// the same machine in the same test, never against an absolute wall-clock constant, and the asserted margin
/// is an order of magnitude looser than the measured effect. That is deliberate: the load-bearing claim is
/// mechanistic (a dead device holds the lock; a slow poller still gets served), and a number that only holds
/// on an idle machine would be a threshold waiting to be widened.</para>
/// </summary>
public class ModbusMultidropBusTests
{
    /// <summary>🔴 Every number quoted in task-4-report.md §8 is PRINTED by the test that produced it, so
    /// anyone can re-derive it with
    /// <c>dotnet test --filter FullyQualifiedName~Multidrop --logger "console;verbosity=detailed"</c> instead of
    /// taking a report's word for it. D-3 had to have its whole hardware probe rewritten by its reviewer to
    /// check its figures; a measurement that is not reproducible from the committed tree is not a
    /// measurement.</summary>
    private readonly ITestOutputHelper _output;

    public ModbusMultidropBusTests(ITestOutputHelper output) => _output = output;

    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(20);

    private static async Task WaitUntilAsync(Func<bool> predicate, string because, Func<string>? diagnose = null)
    {
        var deadline = DateTime.UtcNow + PollTimeout;
        while (DateTime.UtcNow < deadline)
        {
            if (predicate()) return;
            await Task.Delay(PollInterval);
        }

        Assert.True(predicate(), $"timed out after {PollTimeout} waiting for: {because} {diagnose?.Invoke()}");
    }

    /// <summary>Runs one driver's poll loop until <paramref name="ct"/> is cancelled, handing every reading to
    /// <paramref name="onReading"/>. <see cref="IDeviceDriver.ReadAsync"/> ends its enumeration on
    /// cancellation rather than throwing, so there is nothing to swallow here beyond the token's own race.</summary>
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

    private static ModbusRegisterMap Map(string machineCode, byte unitId, int pollIntervalMs, int? readTimeoutMs = null)
        => ModbusRtuLoopbackHarness.BuildSingleRegisterMap(
            machineCode, unitId: unitId, pollIntervalMs: pollIntervalMs, readTimeoutMs: readTimeoutMs);

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 THE NON-NEGOTIABLE: attribution.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 Three machines at three slave addresses on ONE bus, each reading its own value — and, over many
    /// polls, <b>no device's reading is ever attributed to another</b>.
    ///
    /// <para>The load-bearing assertion is the last one: the set of (machine code, value) pairs observed
    /// across every reading from every driver is exactly the three configured pairs. Asserting only "each
    /// driver's first reading was right" would miss an intermittent mis-attribution, which is precisely the
    /// failure a shared bus with a stale frame on it produces — a plausible wrong number, not an exception.</para>
    /// </summary>
    [Fact]
    public async Task ThreeMachinesOnOneBus_EachReadTheirOwnValue_AndNoReadingIsEverAttributedToAnother()
    {
        await using var bus = ModbusRtuLoopbackHarness.Start(
            ((byte)1, new ushort[] { 111 }),
            ((byte)2, new ushort[] { 222 }),
            ((byte)3, new ushort[] { 333 }));

        var expected = new (string Code, byte Unit, double Value)[]
        {
            ("BUS-M1", 1, 111.0),
            ("BUS-M2", 2, 222.0),
            ("BUS-M3", 3, 333.0),
        };

        var gate = new object();
        var readings = new List<DeviceReading>();
        var perDriver = new int[expected.Length];

        var leases = expected.Select(_ => bus.Lease()).ToArray();
        var drivers = expected
            .Select((e, i) => new ModbusRtuDriver(leases[i], Map(e.Code, e.Unit, pollIntervalMs: 5)))
            .ToArray();

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var tasks = drivers
            .Select((d, i) => DriveAsync(d, r =>
            {
                lock (gate)
                {
                    readings.Add(r);
                    perDriver[i]++;
                }
            }, cts.Token))
            .ToArray();

        try
        {
            await WaitUntilAsync(
                () => { lock (gate) { return perDriver.All(c => c >= 5); } },
                "every device on the bus to complete at least five polls");
        }
        finally
        {
            await cts.CancelAsync();
            foreach (var task in tasks)
            {
                try { await task; } catch (OperationCanceledException) { }
            }
            foreach (var driver in drivers)
            {
                await driver.DisposeAsync();
            }
        }

        List<DeviceReading> observed;
        lock (gate) { observed = readings.ToList(); }

        Assert.All(observed, r => Assert.Single(r.Telemetry));

        // 🔴 Every (machine, value) pair that ever crossed the boundary, against the three that exist. A
        // driver that read a sibling's slave, or a bus that handed one device another's frame, adds a pair
        // here that is not in the expected set.
        var pairs = observed
            .Select(r => (r.MachineCode, Value: (double)r.Telemetry.Single().Value!))
            .Distinct()
            .OrderBy(p => p.MachineCode, StringComparer.Ordinal)
            .ToList();

        Assert.Equal(
            expected.Select(e => (e.Code, e.Value)).OrderBy(p => p.Code, StringComparer.Ordinal).ToList(),
            pairs);

        // One physical link served all three, throughout. A rebuild would have papered over an arbitration
        // failure and left the assertion above still passing.
        Assert.Same(leases[0].Bus, leases[2].Bus);
        Assert.Equal(1, leases[0].Bus.LinkGeneration);
    }

    // ─────────────────────────────────────────────────────────────────────
    // One physical resource, N logical devices.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>Three leases, one open, and the LAST release disposes the bus.</b> D-3 measured that
    /// <c>System.IO.Ports.SerialPort</c> opens a COM port exclusively, so N opens would leave N−1 devices
    /// unable to start at all — this is the property that makes multidrop physically possible, asserted at N=3
    /// rather than inferred from D-2's N=2.
    ///
    /// <para>Every lease passes its OWN opener, and the count proves only the creating one was ever invoked —
    /// which is also the hazard <see cref="ModbusBusRegistry"/>'s doc comment names (a second caller's link
    /// parameters are silently discarded). Disposal is asserted by its CONSEQUENCE — the bus refuses a new
    /// transaction — not by a flag, because "the registry forgot the key" and "the bus was actually torn
    /// down" are different claims.</para>
    /// </summary>
    [Fact]
    public async Task ThreeLeasesOnOneBus_OpenTheLinkExactlyOnce_AndTheLastReleaseDisposesTheBus()
    {
        await using var bus = ModbusRtuLoopbackHarness.Start(
            ((byte)1, new ushort[] { 11 }),
            ((byte)2, new ushort[] { 22 }),
            ((byte)3, new ushort[] { 33 }));

        var opens = 0;
        var leases = Enumerable.Range(0, 3)
            .Select(_ => bus.Registry.Acquire(bus.BusKey, _ =>
            {
                Interlocked.Increment(ref opens);
                return Task.FromResult<IModbusBusLink>(bus.Links.Master);
            }))
            .ToArray();

        Assert.Equal(3, bus.Registry.LeaseCount(bus.BusKey));
        Assert.All(leases, l => Assert.Same(leases[0].Bus, l.Bus));

        // No I/O yet — Acquire opens nothing, which is what makes it safe in a driver constructor.
        Assert.Equal(0, opens);
        Assert.Equal(0, leases[0].Bus.LinkGeneration);

        var drivers = new[]
        {
            new ModbusRtuDriver(leases[0], Map("OPEN-M1", 1, pollIntervalMs: 5)),
            new ModbusRtuDriver(leases[1], Map("OPEN-M2", 2, pollIntervalMs: 5)),
            new ModbusRtuDriver(leases[2], Map("OPEN-M3", 3, pollIntervalMs: 5)),
        };

        var done = new int[3];
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var tasks = drivers.Select((d, i) => DriveAsync(d, _ => Interlocked.Exchange(ref done[i], 1), cts.Token)).ToArray();

        try
        {
            await WaitUntilAsync(
                () => Volatile.Read(ref done[0]) == 1 && Volatile.Read(ref done[1]) == 1 && Volatile.Read(ref done[2]) == 1,
                "all three devices to read off the one shared link");
        }
        finally
        {
            await cts.CancelAsync();
            foreach (var task in tasks)
            {
                try { await task; } catch (OperationCanceledException) { }
            }
        }

        // 🔴 One open for three leases.
        Assert.Equal(1, opens);
        Assert.Equal(1, leases[0].Bus.LinkGeneration);

        var sharedBus = leases[0].Bus;

        await drivers[0].DisposeAsync();
        Assert.Equal(2, bus.Registry.LeaseCount(bus.BusKey));
        Assert.True(bus.Registry.HasBus(bus.BusKey));

        await drivers[1].DisposeAsync();
        Assert.Equal(1, bus.Registry.LeaseCount(bus.BusKey));
        Assert.True(bus.Registry.HasBus(bus.BusKey));

        await drivers[2].DisposeAsync();
        Assert.Equal(0, bus.Registry.LeaseCount(bus.BusKey));
        Assert.False(bus.Registry.HasBus(bus.BusKey));

        // The consequence of disposal, not a flag: the bus itself refuses to start a transaction.
        await Assert.ThrowsAsync<ObjectDisposedException>(
            () => sharedBus.BeginTransactionAsync(1_000, 0, CancellationToken.None));
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 What one device's timeout costs the rest of the bus.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>A timeout quarantines the bus ONCE — not once per device — and the others recover.</b>
    ///
    /// <para>This narrows D-2's own §5.5 wording, which reads as though every device pays a quiet window
    /// ("one device's timeout costs every other device on that bus one quiet window before its next poll").
    /// The mechanism says otherwise and this test pins it: <c>ModbusBus.ResynchroniseAsync</c> runs inside the
    /// FIRST transaction taken after the fault and CLEARS <c>_desynchronised</c> on success, so the quiet
    /// window is paid once, by whichever device polls next. Every other device pays only whatever queueing
    /// that one window causes — bounded by the window, once, not per device. The assertion is
    /// <c>ResynchronisationCount == 1</c> after two healthy devices have each read, which is exactly the
    /// difference between the two readings of the cost.</para>
    ///
    /// <para><b>The dead device is a REAL slave whose reply is dropped on the wire</b>
    /// (<c>InMemoryBusLink.HoldWrites</c>), not a unit id nobody owns — see that member's sibling
    /// <c>SilentUnitId</c> for the measured reason. Holding the reply also makes this test strictly stronger:
    /// the held frames are released BEFORE the healthy devices poll, so the resynchronisation has real stale
    /// bytes to discard and <c>LastResynchronisationBytesDiscarded</c> is evidence rather than decoration.</para>
    /// </summary>
    [Fact]
    public async Task OneDevicesTimeout_QuarantinesTheBusExactlyOnce_NotOncePerDevice_AndTheOthersRecover()
    {
        await using var bus = ModbusRtuLoopbackHarness.Start(
            ((byte)1, new ushort[] { 111 }),
            ((byte)2, new ushort[] { 222 }),
            ((byte)3, new ushort[] { 333 }));

        // The device is on the bus and answering; its answer just never reaches the master. That is what a
        // timed-out RTU transaction actually is, and it leaves a late frame in flight — the hazard the quiet
        // window exists for.
        bus.Links.Device.HoldWrites = true;

        // Polls once, times out, then sleeps well past the end of this test — so the quarantine below has
        // exactly one cause and the count cannot be inflated by a second timeout mid-assertion.
        var deadLease = bus.Lease();
        await using var dead = new ModbusRtuDriver(
            deadLease, Map("BUS-DEAD", unitId: 3, pollIntervalMs: 60_000, readTimeoutMs: 300));

        using var deadCts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var deadTask = DriveAsync(dead, _ => { }, deadCts.Token);

        await WaitUntilAsync(() => dead.Health == DriverHealthState.Degraded, "the unanswered device to time out");

        // The quarantine was ENTERED — asserted directly rather than inferred from a later read succeeding.
        Assert.True(deadLease.Bus.IsDesynchronised);
        Assert.Equal(0, deadLease.Bus.ResynchronisationCount);

        // The slave really did answer — so what follows is a LATE frame, not an absent one.
        Assert.True(bus.Links.Device.BytesWritten > 0);
        bus.Links.Device.ReleaseHeldWrites();
        Assert.True(bus.Links.Master.BufferedInputCount > 0, "the late frame should now be sitting on the line");

        var sw = Stopwatch.StartNew();
        DeviceReading? fromOne = null;
        DeviceReading? fromTwo = null;

        // Both healthy devices poll exactly ONCE and then sleep past the end of this test, so no later poll can
        // move the counters underneath the assertions. The read timeout is set EXPLICITLY: the derived default
        // for a 60 s poll interval is Math.Max(1000, 60_000*4) = 240 s, which is not a bound any test should
        // depend on.
        await using var one = new ModbusRtuDriver(bus.Lease(), Map("BUS-M1", 1, pollIntervalMs: 60_000, readTimeoutMs: 1_000));
        await using var two = new ModbusRtuDriver(bus.Lease(), Map("BUS-M2", 2, pollIntervalMs: 60_000, readTimeoutMs: 1_000));

        using var healthyCts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var taskOne = DriveAsync(one, r => Volatile.Write(ref fromOne, r), healthyCts.Token);
        var taskTwo = DriveAsync(two, r => Volatile.Write(ref fromTwo, r), healthyCts.Token);

        try
        {
            await WaitUntilAsync(
                () => Volatile.Read(ref fromOne) is not null && Volatile.Read(ref fromTwo) is not null,
                "both healthy devices to recover after the quarantine",
                () => $"[resync={deadLease.Bus.ResynchronisationCount} desync={deadLease.Bus.IsDesynchronised} " +
                      $"gen={deadLease.Bus.LinkGeneration} one={one.Health} two={two.Health} dead={dead.Health}]");
            sw.Stop();
        }
        finally
        {
            await healthyCts.CancelAsync();
            await deadCts.CancelAsync();
            try { await taskOne; } catch (OperationCanceledException) { }
            try { await taskTwo; } catch (OperationCanceledException) { }
            try { await deadTask; } catch (OperationCanceledException) { }
        }

        // 🔴 ONE quiet window paid for the whole bus. Two devices recovered; the counter moved once. Note that
        // the counter only advances when a resynchronisation SUCCEEDS and clears the quarantine, so this one
        // assertion says both "it was entered" and "it was cleared, once".
        Assert.Equal(1, deadLease.Bus.ResynchronisationCount);

        // And it really discarded the late frame rather than merely waiting out a window.
        Assert.True(deadLease.Bus.LastResynchronisationBytesDiscarded > 0,
            "the resynchronisation should have discarded the late frame released above");

        Assert.Equal(111.0, (double)Volatile.Read(ref fromOne)!.Telemetry.Single().Value!, precision: 10);
        Assert.Equal(222.0, (double)Volatile.Read(ref fromTwo)!.Telemetry.Single().Value!, precision: 10);

        // The link was never rebuilt — the recovery is the quiet window, not a reconnect.
        Assert.Equal(1, deadLease.Bus.LinkGeneration);

        _output.WriteLine(
            $"MEASURED quarantine cost at N=3: one timeout -> {deadLease.Bus.ResynchronisationCount} " +
            $"resynchronisation(s) for the WHOLE bus, {deadLease.Bus.LastResynchronisationBytesDiscarded} stale " +
            $"byte(s) discarded, both healthy devices reading again after {sw.ElapsedMilliseconds} ms " +
            "(quiet window = 50 ms).");

        // 🔴 Review m4 — THE ONE ABSOLUTE WALL-CLOCK BOUND IN THIS SUITE, and the note is here rather than only
        // in the report because that is where whoever sees it go red will be standing.
        //
        // Every other timing assertion in this file compares a rate against a rate measured on the same machine
        // in the same test. This one cannot: "the recovery was CHEAP" is a different claim from "the recovery
        // HAPPENED", the assertions above already cover the second, and the first has no in-test baseline to
        // compare against. 2 000 ms against a 50 ms quiet window is 40x headroom, and the measured value on an
        // idle machine is ~92 ms — a factor of ~21 below the bound.
        //
        // IF THIS EVER GOES RED, DIAGNOSE IT; DO NOT WIDEN IT. At 40x headroom a failure is not a slow machine,
        // it is one of: the quiet window no longer being observed (a resynchronisation looping on a link that
        // will not go quiet), the budget being computed from a derived read timeout that is now enormous (see
        // ModbusRegisterMap.EffectiveReadTimeoutMs — max(1000, PollIntervalMs x 4) makes this 240 s for a 60 s
        // poll interval, which is why this test sets readTimeoutMs EXPLICITLY), or a machine carrying stray
        // testhost/build-server processes from an interrupted run. Widening the threshold makes each of those
        // rarer and none of them less real — the batch rule that applies here is D-2 §9.10's, and it applied to
        // the gate rather than to the tree that time too.
        Assert.True(sw.ElapsedMilliseconds < 2_000,
            $"recovery of two devices after one timeout took {sw.ElapsedMilliseconds} ms against a 50 ms quiet " +
            "window (40x headroom, ~92 ms observed on an idle machine) — diagnose this, do not widen it; see the " +
            "comment at this assertion for the three causes worth checking first");
    }

    /// <summary>
    /// 🔴 <b>The cost that DOES scale with N, and it dwarfs the quarantine.</b> A device that never answers
    /// holds the shared arbitration lock for its ENTIRE read timeout — once per attempt, so
    /// <c>registers × (retries+1) × readTimeout</c> — on EVERY poll, and every other device on the line waits
    /// behind it. The quiet window is 50 ms and is paid once; this is seconds and is paid forever.
    ///
    /// <para>Measured as a ratio against the same two devices on the same bus in the same test, never against
    /// an absolute constant. The margin asserted (4×) is an order of magnitude below the effect this mechanism
    /// produces, so the test states the mechanism rather than the machine's speed.</para>
    ///
    /// <para><b>This is the finding D-7 has to act on</b>, and it is why a per-device backoff — not a
    /// per-device quarantine, which is impossible — is the remedy worth building. See task-4-report.md §7.</para>
    /// </summary>
    [Fact]
    public async Task ADeadDeviceOnTheBus_HoldsTheSharedLock_TaxingEveryOtherDevice()
    {
        await using var bus = ModbusRtuLoopbackHarness.Start(
            ((byte)1, new ushort[] { 111 }),
            ((byte)2, new ushort[] { 222 }),
            ((byte)3, new ushort[] { 333 }));

        // Unit 3 is a real slave that receives every request and answers it — the answer is dropped on the
        // wire. See InMemoryBusLink.SilentUnitId for why this rather than an unowned address.
        bus.Links.Device.SilentUnitId = 3;

        // 🔴 Holds the bus alive across BOTH measurement phases. Without it the first phase's last lease
        // release disposes the bus AND the shared link, and the second phase measures a dead pipe — which is
        // a real trap this test walked into once and which produces a comfortable-looking pass.
        await using var keepAlive = bus.Lease();

        var healthy = 0;

        async Task<int> CountHealthyReadsAsync(TimeSpan window, bool withDeadDevice)
        {
            Volatile.Write(ref healthy, 0);

            using var cts = new CancellationTokenSource();
            await using var one = new ModbusRtuDriver(bus.Lease(), Map("TAX-M1", 1, pollIntervalMs: 1));
            await using var two = new ModbusRtuDriver(bus.Lease(), Map("TAX-M2", 2, pollIntervalMs: 1));

            var tasks = new List<Task>
            {
                DriveAsync(one, _ => Interlocked.Increment(ref healthy), cts.Token),
                DriveAsync(two, _ => Interlocked.Increment(ref healthy), cts.Token),
            };

            ModbusRtuDriver? dead = null;
            if (withDeadDevice)
            {
                dead = new ModbusRtuDriver(bus.Lease(), Map("TAX-DEAD", unitId: 3, pollIntervalMs: 1, readTimeoutMs: 500));
                tasks.Add(DriveAsync(dead, _ => { }, cts.Token));
            }

            await Task.Delay(window);
            var counted = Volatile.Read(ref healthy);

            await cts.CancelAsync();
            foreach (var task in tasks)
            {
                try { await task; } catch (OperationCanceledException) { }
            }

            if (dead is not null) await dead.DisposeAsync();
            return counted;
        }

        var withoutDead = await CountHealthyReadsAsync(TimeSpan.FromSeconds(1), withDeadDevice: false);
        var withDead = await CountHealthyReadsAsync(TimeSpan.FromSeconds(2), withDeadDevice: true);

        // Rates, so the two windows do not have to be the same length.
        var rateWithout = withoutDead / 1.0;
        var rateWith = withDead / 2.0;

        // The dead device really was on the bus and really did go unanswered — otherwise a drop caused by
        // anything else would read as the tax.
        Assert.True(bus.Links.Device.FramesSilenced > 0, "the silenced slave should have replied and been dropped");

        // 🔴 Review m7 — MEASURED and DERIVED are separate lines. This test measures RATES; it never measures
        // the hold, and a derivation printed inside a line labelled MEASURED reads as though it did.
        //
        // And m2 — the baseline rate is set by this harness, not by a bus: pollIntervalMs 1 becomes ~15.6 ms
        // under Windows' timer quantization, so ~135 reads/s is a floor imposed by Task.Delay and NOT the
        // in-memory link's capacity (ASlowPollerIsNotStarved_… measures the same harness at ~40 000
        // transactions/s with pollIntervalMs 0). The error is conservative — a faster baseline would make the
        // ratio LARGER — but the number is quoted in the report, so the caveat travels with it.
        _output.WriteLine(
            $"MEASURED dead-device tax: two healthy devices on an idle bus {rateWithout:F1} reads/s; the same two " +
            $"with ONE unanswered device {rateWith:F1} reads/s — a " +
            $"{(rateWith > 0 ? rateWithout / rateWith : double.PositiveInfinity):F1}x collapse. " +
            $"{bus.Links.Device.FramesSilenced} replies silenced.");
        _output.WriteLine(
            "DERIVED (from the map, not measured here): the dead device's WorstCaseBusHoldMs is 1 register x " +
            "2 attempts x 500 ms = 1000 ms of arbitration lock per poll.");
        _output.WriteLine(
            "CAVEAT: the baseline is bounded by Task.Delay(1) ~= 15.6 ms on Windows, not by the link — see this " +
            "assertion's own comment.");

        Assert.True(withoutDead > 0, "the two healthy devices produced no reading at all on an idle bus");
        Assert.True(
            rateWith * 4 < rateWithout,
            $"one unanswered device on the bus must visibly tax the healthy ones: {rateWithout:F1} reads/s alone " +
            $"vs {rateWith:F1} reads/s with it — expected at least a 4x drop (the mechanism predicts far more: " +
            "the dead device holds the arbitration lock for 2 x 500 ms per poll).");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fairness.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>Can a fast poller starve a slow one?</b> No — and the reason is mechanical rather than lucky.
    /// <see cref="ModbusRtuDriver.ReadAsync"/> delays for its own <c>PollIntervalMs</c> AFTER each poll
    /// completes, so a device that has just been served goes to the back of the queue and then sleeps before it
    /// even re-queues; and <c>SemaphoreSlim</c> releases waiters in approximately FIFO order, so a device
    /// already queued is served ahead of one that re-queues after it. The worst case for a device is therefore
    /// bounded by the other devices' transaction times, once each — not by their poll RATES.
    ///
    /// <para>Asserted as a count, not a clock: with three devices polling flat out, a fourth polling at 200 ms
    /// must still complete a substantial fraction of its nominal cadence over the window. A starved device
    /// would produce nearly none. The bound is deliberately half of nominal, because the claim under test is
    /// "not starved", not "hits its cadence exactly" — an oversubscribed bus legitimately stretches every
    /// device's cadence, which is the degradation task-4-report.md §6 argues for.</para>
    ///
    /// <para><b>The one honest caveat, recorded rather than hidden:</b> <c>SemaphoreSlim</c>'s ordering is
    /// documented as approximate, not guaranteed FIFO, so the bound above rests on an implementation
    /// behaviour rather than a contract. What IS contractual is that no waiter is skipped indefinitely, which
    /// is the property this test drives.</para>
    /// </summary>
    [Fact]
    public async Task ASlowPollerIsNotStarved_ByThreeDevicesPollingFlatOut()
    {
        await using var bus = ModbusRtuLoopbackHarness.Start(
            ((byte)1, new ushort[] { 1 }),
            ((byte)2, new ushort[] { 2 }),
            ((byte)3, new ushort[] { 3 }),
            ((byte)4, new ushort[] { 4 }));

        const int slowIntervalMs = 200;
        var windowMs = 3_000;

        var slowReads = 0;
        var fastReads = 0;

        using var cts = new CancellationTokenSource();
        await using var slow = new ModbusRtuDriver(bus.Lease(), Map("FAIR-SLOW", 4, pollIntervalMs: slowIntervalMs));
        var fast = new[]
        {
            new ModbusRtuDriver(bus.Lease(), Map("FAIR-F1", 1, pollIntervalMs: 0)),
            new ModbusRtuDriver(bus.Lease(), Map("FAIR-F2", 2, pollIntervalMs: 0)),
            new ModbusRtuDriver(bus.Lease(), Map("FAIR-F3", 3, pollIntervalMs: 0)),
        };

        var tasks = fast.Select(f => DriveAsync(f, _ => Interlocked.Increment(ref fastReads), cts.Token)).ToList();
        tasks.Add(DriveAsync(slow, _ => Interlocked.Increment(ref slowReads), cts.Token));

        try
        {
            await Task.Delay(windowMs);
        }
        finally
        {
            await cts.CancelAsync();
            foreach (var task in tasks)
            {
                try { await task; } catch (OperationCanceledException) { }
            }
            foreach (var f in fast) await f.DisposeAsync();
        }

        var observedSlow = Volatile.Read(ref slowReads);
        var observedFast = Volatile.Read(ref fastReads);
        var nominalSlow = windowMs / slowIntervalMs;

        _output.WriteLine(
            $"MEASURED fairness over {windowMs} ms: three devices polling flat out completed {observedFast} polls; " +
            $"one device at a {slowIntervalMs} ms cadence completed {observedSlow} against a nominal " +
            $"{nominalSlow} — it is queued behind the others, never skipped by them.");

        // The fast devices really did saturate the bus — otherwise "the slow one was fine" proves nothing.
        Assert.True(observedFast > observedSlow * 4,
            $"the three flat-out devices were expected to dominate the bus: {observedFast} reads vs the slow " +
            $"device's {observedSlow}");

        // 🔴 And the slow device was still served, close to its own cadence.
        Assert.True(observedSlow >= nominalSlow / 2,
            $"the slow poller completed {observedSlow} polls in {windowMs} ms against a nominal {nominalSlow} " +
            $"at {slowIntervalMs} ms — fewer than half would mean the flat-out devices are starving it.");
    }
}
