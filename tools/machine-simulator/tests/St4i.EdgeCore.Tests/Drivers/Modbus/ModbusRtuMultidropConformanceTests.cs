using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.Connector.Conformance;
using St4i.EdgeCore.Drivers.Modbus;
using Xunit;
using Xunit.Abstractions;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// 🔴 Task D-6 — <b>the shared <see cref="DeviceDriverConformanceSuite"/> against a
/// <see cref="ModbusRtuDriver"/> that does NOT own its line.</b> D-4 shipped N devices on one bus and no
/// conformance check had ever run against that shape; this class is the answer to the brief's "run it, or state
/// precisely why it is unsound". It is sound, and what makes it sound is stated here rather than assumed.
///
/// <para><b>What is actually different.</b> Every instance <see cref="ModbusRtuConformanceTestsBase.CreateDriver"/>
/// hands the suite rides a bus that also carries a live, continuously polling BUS-MATE against a real NModbus
/// slave, and the device under test is a real slave whose replies are dropped on the wire
/// (<see cref="InMemoryBusLink.SilentUnitId"/> — D-4's own mechanism, which keeps both ends perfectly framed
/// and isolates the one variable "a device that does not answer"). So the driver under test shares an
/// arbitration lock, a quarantine and a physical link with a machine it knows nothing about.</para>
///
/// <para>
/// 🔴 <b>The isolation assumption the suite makes, and exactly what it costs here.</b>
/// <see cref="DeviceDriverConformanceSuite.CreateDriver"/> promises "a fresh instance that has not yet been
/// used". On this bus that is true of the INSTANCE and false of its SITUATION, and the difference is priced
/// per check rather than waved at:
/// </para>
///
/// <list type="bullet">
/// <item><description><b>The fast-failure hook cannot be honoured the way TCP honours it, and the reason is
/// structural rather than a harness limitation.</b> The single-device rig's fast failure is a LINK that will
/// not open — but the link is SHARED, so refusing to open it would make every device on the segment
/// unreachable, not one. <b>On a multidrop bus the only per-device UNREACHABILITY that exists is a
/// TIMEOUT</b>, which is the narrow and true form of this claim: <i>absence is slow; wrongness is fast.</i> A
/// device that is present and answers WRONGLY still fails fast and per-device — a Modbus exception frame, a
/// CRC-broken frame, or a mismatched slave address (D-5 measured <c>Response slave address does not match
/// request</c>). What the shared line takes away is only the CHEAP form of absence, which makes
/// <see cref="DeviceDriverConformanceSuite.CreateDriver"/>'s "cheap and FAST to fail" a <b>1:1-transport
/// assumption</b>. <see cref="BuildNoDeviceMap"/> therefore declares <c>readTimeoutMs: 250</c> and
/// <c>retries: 0</c>, so absence costs 250 ms per register instead of the map's 1 000 ms floor — bounded and
/// small, which is the best available. Every check that drives this target does so inside a 200 ms–3 s window,
/// all of which absorb it.</description></item>
/// <item><description><b>The quarantine is per-BUS, so the unresponsive device taxes its neighbour.</b> Every
/// poll of the silenced device ends without a validated response, which marks the bus desynchronised, which
/// makes the bus-mate's very next transaction observe a full <see cref="ModbusBusSettings.QuietWindowMs"/> of
/// real silence before it may write a byte. That is inherent (a desynchronised line is desynchronised for
/// everyone) and it is why the bus-mate polls a HEALTHY slave: a bus-mate that also timed out would make every
/// timing here a measurement of the rig.</description></item>
/// <item><description><b><see cref="DeviceDriverConformanceSuite.Check_ReadAsync_HonoursCancellation_WhenNoDeviceIsReachable"/>
/// and <see cref="Check_Write_Cancellation_HonouredPromptly_EvenAgainstAnUnresponsiveDevice"/> BOTH run
/// against a device holding the SHARED lock for up to 8 s.</b> That is deliberate — it is the only
/// arrangement in which passing either check proves
/// <see cref="IModbusBusLink.AbortPendingRead"/> did the work rather than a timeout expiring inside the
/// budget — and it means a FAILURE of either starves the bus-mate for those 8 s. Bounded, per test, and
/// preferable to a check that cannot discriminate.
///
/// <para>🔴 The write half of that sentence is new as of the D-6 fix round, and its absence here was the
/// review's N-1. Worth naming rather than quietly amending: this bullet enumerated the checks that pay the
/// 8 s cost, a second check joined them, and the enumeration was not revisited — the same "a list was
/// worked instead of the rule behind it" shape that produced the Critical this file now documents at
/// <see cref="ModbusRtuDriverConformanceTests"/>. On a PASSING run the write check costs 211 ms, not 8 s;
/// the bound is what a failure costs.</para></description></item>
/// <item><description><b>A shared bus cannot be force-unstuck the way a TCP peer can.</b> The TCP class's
/// <c>ForceUnstickAsync</c> closes the listener; the RTU equivalent would tear down the line every other
/// machine is using, which is precisely the cancellation design D-2 rejected (blueprint §2.1). So the unstick
/// here is <see cref="IModbusBusLink.AbortPendingRead"/>, which unblocks one read and leaves the link
/// open.</description></item>
/// </list>
///
/// <para>🔴 <b>The keep-alive lease, stated accurately — an earlier version of this paragraph claimed a
/// hazard this rig's own shape already covers, and that claim was untested.</b> It said that without the
/// lease the first check disposing its last driver would take the reference count to zero and destroy the
/// rig. Removing the line leaves all 21 tests green, and the reason is one line above it: <c>_busMate</c>
/// holds its OWN lease for the whole fixture, so the count never reaches zero however many
/// <see cref="DeviceDriverConformanceSuite.CreateDriver"/> instances come and go.</para>
///
/// <para>The mechanism is real — <see cref="ModbusBusRegistry.ReleaseAsync"/> genuinely disposes the bus AND
/// its link at zero, which is the RTU spelling of the <c>ClosedLoopbackPort</c> defect D-2's review found
/// (release the resource, keep the identifier that names it) — and it is pinned, as a paired control on real
/// product behaviour, by <c>ModbusRtuConformanceRigTests.ReleasingTheLastLease_...</c>. What was wrong was
/// attaching it to a scenario this class does not have. <b>The lease is kept</b>, and the honest reason is
/// narrower and still worth having: it makes this rig's correctness independent of <c>_busMate</c>
/// EXISTING. A later edit that stops polling a bus-mate, or moves it out of the fixture, would otherwise
/// silently reintroduce the hazard with nothing to catch it.</para>
///
/// <para><b>What this class does NOT do:</b> it never constructs a <c>ConnectorRegistry</c> or a
/// <c>FleetHost</c>, so it cannot disturb the per-instance identity D-1 landed or the routing that makes
/// <c>MachineDriverAvailability.AmbiguousDriver</c> unreachable. 🔴 <b>E-5 census — "those live in
/// St4i.EngineApi" was already false and is now false twice over:</b> <c>ConnectorRegistry</c> moved to
/// <c>St4i.EdgeCore</c> in E-2, <c>FleetHost</c> became a thin shell over the <c>internal</c>
/// <c>FleetCore</c> there, and E-5 moved the fan-out itself (<c>ModbusMultidropRegistration</c>) into
/// <c>St4i.EdgeCore.Config</c>. What is accurate is where the PROOFS are, and that has not moved:
/// <c>ModbusMultidropRegistrationTests</c> in <c>St4i.EngineApi.Tests</c> (which is where a real
/// <c>FleetHost</c> can be stood up) and, for the edge agent, <c>ModbusMultidropAgentTests</c> in this
/// assembly. What it DOES check, from the driver side and for
/// the first time from an external harness, is the invariant that guard depends on: two drivers on one bus have
/// distinct <see cref="IDeviceDriver.Id"/>s and each speaks for exactly one machine code — see
/// <see cref="TwoDriversOnOneBusHaveDistinctIds_AndAReadingCarriesExactlyItsOwnMachineCode"/>.</para>
/// </summary>
public sealed class ModbusRtuMultidropConformanceTests(ITestOutputHelper output) : ModbusRtuConformanceTestsBase(output)
{
    /// <summary>The slave whose replies are dropped — the device under conformance test.</summary>
    private const byte UnitUnderTest = 7;

    /// <summary>The other machine on the line: a real slave that answers normally, polled continuously for the
    /// whole of every test so the bus under test is genuinely contended rather than nominally shared.</summary>
    private const byte BusMateUnit = 1;

    /// <summary>The value at address 0 on each slave. DELIBERATELY different, and different from each other's,
    /// so a read that reached the wrong slave is caught by its VALUE rather than only by a machine code the
    /// driver stamps on itself — see
    /// <see cref="TwoDriversOnOneBusHaveDistinctIds_AndAReadingCarriesExactlyItsOwnDevicesValues"/>.</summary>
    private const ushort BusMateTemperatureRaw = 235;

    /// <inheritdoc cref="BusMateTemperatureRaw"/>
    private const ushort UnitUnderTestTemperatureRaw = 111;

    private const string BusMateMachineCode = "RTU-CONFORMANCE-MD-BUSMATE";
    private const string ReadingsMachineCode = "RTU-CONFORMANCE-MD-READINGS";
    private const string WriteMachineCode = "RTU-CONFORMANCE-MD-WRITE";

    private ModbusRtuLoopbackHarness.RunningRtuBus? _bus;
    private ModbusBusLease? _keepAlive;
    private ModbusRtuDriver? _busMate;
    private CancellationTokenSource? _busMateCts;
    private Task? _busMatePump;

    public override Task InitializeAsync()
    {
        _bus = ModbusRtuLoopbackHarness.Start(
            (BusMateUnit, new ushort[] { BusMateTemperatureRaw, 0xFFFF, 0, 0, 0, 7 }),
            (UnitUnderTest, new ushort[] { UnitUnderTestTemperatureRaw, 0, 0, 0, 0, 22 }));

        // D-4's mechanism: the slave under test still RECEIVES every request and still builds its reply; the
        // reply is dropped on the wire, so the master times out exactly as it does against an absent device
        // while the other slave stays perfectly framed.
        _bus.Links.Device.SilentUnitId = UnitUnderTest;

        // 🔴 See this class's doc comment. Taken before any driver exists and released last.
        _keepAlive = _bus.Lease();

        _busMate = new ModbusRtuDriver(_bus.Lease(), BuildBusMateMap());
        _busMateCts = new CancellationTokenSource();
        _busMatePump = DriveAsync(_busMate, _busMateCts.Token);
        return Task.CompletedTask;
    }

    public override async Task DisposeAsync()
    {
        if (_busMateCts is not null)
        {
            try { await _busMateCts.CancelAsync(); } catch { /* best-effort teardown */ }
        }

        if (_busMatePump is not null)
        {
            try { await _busMatePump.WaitAsync(TimeSpan.FromSeconds(10)); } catch { /* best-effort teardown */ }
        }

        if (_busMate is not null)
        {
            try { await _busMate.DisposeAsync(); } catch { /* best-effort teardown */ }
        }

        if (_keepAlive is not null)
        {
            try { await _keepAlive.DisposeAsync(); } catch { /* best-effort teardown */ }
        }

        if (_bus is not null)
        {
            try { await _bus.DisposeAsync(); } catch { /* best-effort teardown */ }
        }

        _busMateCts?.Dispose();
    }

    /// <summary>The bus-mate's own map. <c>readTimeoutMs: 1 500</c> is not idle generosity — it makes the
    /// bus-mate the LARGEST <see cref="ModbusRegisterMap.WorstCaseBusHoldMs"/> on this line (3 000 ms against
    /// the writer's 2 400 ms), which is what stops
    /// <see cref="ModbusRtuConformanceTestsBase.TheWriteChecksAreSizedAgainstTheWholeBusesWorstCaseHold_NotTheWritingDevicesOwn"/>
    /// from being satisfied by the writer's own number. It costs nothing at runtime: this slave answers, so the
    /// bound is never reached.</summary>
    private static ModbusRegisterMap BuildBusMateMap() =>
        ModbusRtuLoopbackHarness.BuildSingleRegisterMap(
            BusMateMachineCode, unitId: BusMateUnit, address: 0, pollIntervalMs: 25, readTimeoutMs: 1_500);

    private static ModbusRegisterMap BuildReadingsMap() =>
        ModbusRtuLoopbackHarness.BuildMap(
            ReadingsMachineCode, unitId: BusMateUnit, pollIntervalMs: 20, readTimeoutMs: 500);

    protected override ModbusBusLease AcquireNoDeviceLease() =>
        (_bus ?? throw new InvalidOperationException("InitializeAsync has not run — the multidrop bus does not exist yet.")).Lease();

    protected override ModbusRegisterMap BuildNoDeviceMap() =>
        ModbusRtuLoopbackHarness.BuildWritableMap(
            "RTU-CONFORMANCE-MD-NODEVICE",
            unitId: UnitUnderTest,
            readTimeoutMs: 250,
            pollIntervalMs: 30,
            retries: 0);

    protected override ModbusRegisterMap BuildUnresponsiveWriteMap() =>
        ModbusRtuLoopbackHarness.BuildWritableMap(
            WriteMachineCode,
            unitId: UnitUnderTest,
            readTimeoutMs: EffectiveUnresponsiveWriteTimeoutMs,
            pollIntervalMs: 60_000,
            retries: UnresponsiveWriteDeclaredRetries);

    /// <summary>Every map this rig ever puts on the shared line, including the ones alive only during a single
    /// check. Conservative on purpose: the sizing rule is about the worst case a write can queue behind, and a
    /// map that is "not usually running" is a scheduling accident rather than a bound.</summary>
    protected override IReadOnlyList<ModbusRegisterMap> MapsSharingTheWriteBus =>
        new[] { BuildBusMateMap(), BuildNoDeviceMap(), BuildReadingsMap(), BuildUnresponsiveWriteMap() };

    /// <summary>The device under test, silenced, on the shared line — see this class's doc comment for why the
    /// unstick is an abort rather than a teardown.</summary>
    protected override Task<UnresponsiveDeviceSession> CreateUnresponsiveDeviceAsync()
    {
        var bus = RequireBus();
        var driver = new ModbusRtuDriver(
            bus.Lease(),
            ModbusRtuLoopbackHarness.BuildWritableMap(
                "RTU-CONFORMANCE-MD-SILENT",
                unitId: UnitUnderTest,
                readTimeoutMs: SilentPeerReadTimeoutMs,
                pollIntervalMs: 50,
                retries: 0));

        return Task.FromResult(new UnresponsiveDeviceSession(driver, () =>
        {
            // Not a teardown: closing this link would take the bus-mate down with it, which is the exact
            // mechanism blueprint §2.1 rejected. The flag is cleared by the next BeginTransactionAsync's own
            // ResetAbort, so nothing is left raised for the bus-mate to trip over.
            bus.Links.Master.AbortPendingRead();
            return Task.CompletedTask;
        }));
    }

    /// <inheritdoc cref="CreateUnresponsiveDeviceAsync"/>
    protected override Task<UnresponsiveWritableDeviceSession> CreateUnresponsiveWritableDeviceAsync()
    {
        var bus = RequireBus();
        var map = BuildUnresponsiveWriteMap();
        var driver = new ModbusRtuDriver(bus.Lease(), map);

        return Task.FromResult(new UnresponsiveWritableDeviceSession(
            driver,
            ModbusRtuLoopbackHarness.WritableSpeedPoint,
            100.0,
            ModbusRtuLoopbackHarness.StartCycleCommand,
            CommandArguments: null,
            // 🔴 Filtered by unit id AND function code, which is what makes this count mean anything on a
            // shared line: the bus-mate's FC03 polls are on the same wire throughout, so a bare frame total
            // would answer a different question than the one the check asks.
            CommandAttemptsReachingDevice: () => bus.Links.Master.WrittenFrames.Count(f =>
                f.Length == RtuFrames.RequestFrameLength
                && f[0] == map.UnitId
                && f[1] == RtuFrames.FunctionWriteSingleCoil),
            AttemptCountSettleDelay: TimeSpan.FromMilliseconds(300),
            ForceUnstickAsync: () =>
            {
                bus.Links.Master.AbortPendingRead();
                return Task.CompletedTask;
            }));
    }

    /// <summary>Readings come from a THIRD driver on the same contended line, not from a private bus — so the
    /// two readings-dependent checks run against a device that has to arbitrate for every register it
    /// reads.</summary>
    protected override async Task<IReadOnlyList<DeviceReading>> CollectReadingsAsync(
        int count, TimeSpan timeout, Action<DeviceReading>? onYielded = null)
    {
        await using var driver = new ModbusRtuDriver(RequireBus().Lease(), BuildReadingsMap());
        return await CollectFromAsync(driver, count, timeout, onYielded);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Two claims only the multidrop shape can make.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>Blueprint §10 obligation 2, made discriminating: the number the write checks are sized against
    /// belongs to a DIFFERENT device on the line.</b>
    ///
    /// <para>The base class asserts the bound fits inside
    /// <see cref="DeviceDriverConformanceSuite.WriteBudget"/>; on a one-device bus that is satisfied by the
    /// writer's own hold, which is precisely the mistake §10 names ("not the writing device's own"). Here the
    /// largest hold is the bus-mate's, so a sizing rule that quietly used the writer's own would produce a
    /// SMALLER number and this test goes red.</para>
    /// </summary>
    [Fact]
    public void TheWorstCaseHoldTheWriteChecksAreSizedAgainstBelongsToAnotherDeviceOnTheLine()
    {
        var maps = MapsSharingTheWriteBus;
        var writer = BuildUnresponsiveWriteMap();

        var largest = maps.OrderByDescending(m => m.WorstCaseBusHoldMs).First();

        Output.WriteLine(string.Join(
            "; ", maps.Select(m => $"{m.MachineCode}={m.WorstCaseBusHoldMs} ms")));

        Assert.NotEqual(writer.MachineCode, largest.MachineCode);
        Assert.True(
            largest.WorstCaseBusHoldMs > writer.WorstCaseBusHoldMs,
            $"the largest worst-case hold on this bus ({largest.MachineCode} at {largest.WorstCaseBusHoldMs} ms) " +
            $"is not larger than the writing device's own ({writer.WorstCaseBusHoldMs} ms), so this rig cannot " +
            "tell a bound sized per blueprint §10 obligation 2 from one sized against the writer alone.");
    }

    /// <summary>
    /// 🔴 <b>The invariant <c>MachineDriverAvailability.AmbiguousDriver</c> depends on, checked from the driver
    /// side by an external harness for the first time.</b> D-1 made connector identity per-instance and proved
    /// that guard structurally unreachable by enumeration in <c>St4i.EngineApi</c>; what that proof rests on down
    /// here is that N drivers on ONE bus are N distinguishable drivers, each speaking for exactly one machine.
    ///
    /// <para>Both halves are asserted because they fail to different defects: an <see cref="IDeviceDriver.Id"/>
    /// built from the bus alone (the TCP driver's shape — endpoint only) would collide for every device on a
    /// multidrop line and is caught by the first half; a read that landed on the WRONG SLAVE is caught by the
    /// second. Neither is visible from a single-device rig.</para>
    ///
    /// <para>🔴 <b>The second half asserts the register VALUES, not the machine code, and the correction
    /// matters.</b> <see cref="DeviceReading.MachineCode"/> is stamped from the driver's own map, so asserting
    /// it is near-tautological — it would hold for a driver that read the wrong slave entirely, which is the
    /// only defect this half exists to catch. The two slaves are loaded with DISTINGUISHABLE values for exactly
    /// this reason: unit <see cref="BusMateUnit"/> holds <c>235</c> and <c>0xFFFF</c> at addresses 0 and 1,
    /// unit <see cref="UnitUnderTest"/> holds <c>111</c> at address 0. A read that reached the wrong slave
    /// returns 111 (or, since that slave is silenced, nothing at all); only a read that reached unit
    /// <see cref="BusMateUnit"/> returns 235 and −0.1.</para>
    /// </summary>
    [Fact]
    public async Task TwoDriversOnOneBusHaveDistinctIds_AndAReadingCarriesExactlyItsOwnDevicesValues()
    {
        var bus = RequireBus();
        await using var underTest = CreateDriver();
        var busMate = _busMate ?? throw new InvalidOperationException("the bus-mate driver does not exist.");

        Assert.NotEqual(busMate.Id, underTest.Id);
        Assert.Contains(bus.BusKey, underTest.Id, StringComparison.Ordinal);
        Assert.Contains(bus.BusKey, busMate.Id, StringComparison.Ordinal);
        Assert.Contains($"unit{UnitUnderTest}", underTest.Id, StringComparison.Ordinal);
        Assert.Contains($"unit{BusMateUnit}", busMate.Id, StringComparison.Ordinal);

        var readings = await CollectReadingsAsync(2, TimeSpan.FromSeconds(20));
        Assert.True(readings.Count >= 2, $"only collected {readings.Count} readings on the shared line.");

        foreach (var reading in readings)
        {
            Assert.Equal(ReadingsMachineCode, reading.MachineCode);

            // 🔴 The load-bearing half: the values came off unit 1's own data store, not unit 7's.
            var temperature = reading.Telemetry.Single(t => t.Metric == "temperature");
            var pressure = reading.Telemetry.Single(t => t.Metric == "pressure");
            Assert.Equal(BusMateTemperatureRaw, (double)temperature.Value!, precision: 10);
            Assert.NotEqual((double)UnitUnderTestTemperatureRaw, (double)temperature.Value!);
            Assert.Equal(-0.1, (double)pressure.Value!, precision: 10);
        }
    }

    private ModbusRtuLoopbackHarness.RunningRtuBus RequireBus() =>
        _bus ?? throw new InvalidOperationException("InitializeAsync has not run — the multidrop bus does not exist yet.");

    private static Task DriveAsync(IDeviceDriver driver, CancellationToken ct) =>
        Task.Run(
            async () =>
            {
                try
                {
                    await foreach (var _ in driver.ReadAsync(ct)) { }
                }
                catch (OperationCanceledException) { }
            },
            CancellationToken.None);
}
