using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.Connector.Conformance;
using St4i.EdgeCore.Drivers.Modbus;
using Xunit;
using Xunit.Abstractions;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// 🔴 Task D-6 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-6-brief.md) — <b>the wiring of the
/// shared <see cref="DeviceDriverConformanceSuite"/> onto the real <see cref="ModbusRtuDriver"/>, for BOTH
/// shapes RTU can take.</b> D-1…D-5 were each proved by tests they wrote for themselves; this is the first
/// contract someone else wrote. Two concrete subclasses run every check on this base:
/// <see cref="ModbusRtuDriverConformanceTests"/> (one device, one bus) and
/// <see cref="ModbusRtuMultidropConformanceTests"/> (the device under test sharing a live line with another
/// machine — the shape D-4 shipped and no conformance check had ever run against).
///
/// <para><b>Abstract on purpose:</b> xunit does not discover abstract classes, so the wirings below exist once
/// and run twice rather than being copy-pasted into two files that could drift.
/// <see cref="DeviceDriverConformanceSuite.EveryCheckIsWiredOrAcknowledged"/> reflects over
/// <c>GetType()</c>'s public instance methods, which includes inherited ones, so each concrete subclass is
/// still individually censused.</para>
///
/// <para>
/// 🔴 <b>THE CONFLICT THIS CLASS HAD TO RESOLVE FIRST: <see cref="DeviceDriverConformanceSuite.CreateDriver"/>
/// is documented as "MUST NOT block or perform I/O", and an RTU driver acquires a lease on a REFCOUNTED SHARED
/// BUS whose first acquire opens the transport.</b> Answered against the code rather than against intent:
/// </para>
///
/// <list type="number">
/// <item><description><b>Acquiring a lease performs no I/O, and that is a stated contract rather than an
/// accident.</b> <see cref="ModbusBusRegistry.Acquire"/>'s own doc comment says so in these words — <i>"Performs
/// no I/O — the link is opened lazily, inside the first transaction — so this is safe to call from a driver
/// constructor, which IDeviceDriver's own contract requires be non-blocking"</i> — and the code matches: it
/// takes a lock, constructs a <see cref="ModbusBus"/> (which only validates its settings) and increments a
/// counter. <see cref="ModbusBus.EnsureLinkAsync"/>, the only caller of the <c>openLink</c> delegate, runs from
/// inside <see cref="ModbusBus.BeginTransactionAsync"/>, i.e. from the first POLL, never from
/// construction.</description></item>
/// <item><description><b>A leaked lease is the real hazard, and this class closes it at the call site rather
/// than hoping.</b> A lease that is never released keeps the reference count off zero forever, so the bus — and
/// under D-3 an EXCLUSIVELY-opened COM port — lives for the process lifetime and presents as an unrelated
/// connector failing to start. The suite constructs many instances per check and disposes them, which is
/// precisely the shape that finds it. <see cref="CreateDriver"/> below therefore validates the map BEFORE it
/// acquires (the order <see cref="ModbusRtuDriver.ValidateRtuUnitId"/> exists to make possible) and releases
/// the lease if construction throws anyway. <b>Note what that does NOT fix:</b> the driver's own constructor
/// still cannot release a lease it was handed when it throws, so any OTHER caller must do what this one does.
/// That is on record as a D-7 prerequisite and is unchanged by this task.</description></item>
/// <item><description><b>"A fresh instance that has not yet been used" is an ISOLATION assumption, and N RTU
/// drivers on one bus are deliberately not isolated — so the cost is priced instead of denied.</b> On the
/// single-device subclass the assumption holds outright (each rig owns its own registry, its own bus and its
/// own link; xunit builds a fresh test-class instance per test, so nothing crosses even between checks). On the
/// multidrop subclass it does NOT hold, and that is the point of running it: every instance
/// <see cref="CreateDriver"/> returns shares an arbitration lock and a quarantine with a live bus-mate. What it
/// costs each check is written on <see cref="ModbusRtuMultidropConformanceTests"/> itself.</description></item>
/// </list>
///
/// <para>🔴 <b>Blueprint §10 obligation 3 — <c>Applied</c> on a COMMAND is an acknowledgement, not an
/// observation — costs this wiring ZERO checks, and that was checked rather than assumed.</b> Every
/// <c>Check_Write_*</c> method on the shared suite asserts <see cref="WriteOutcome.Rejected"/> or
/// <see cref="WriteOutcome.Indeterminate"/>; not one of them asserts <see cref="WriteOutcome.Applied"/>, and not
/// one reads a device's state back. So there is no check to acknowledge on that ground and nothing here asserts
/// a physical effect from an acknowledgement. Neither does anything this task added: the rigs' peers never
/// answer at all, so no <see cref="WriteOutcome.Applied"/> is reachable through them.</para>
///
/// <para><b>Acknowledged gaps: none.</b> <see cref="DeviceDriverConformanceSuite.AcknowledgedGaps"/> is left at
/// its empty default and <see cref="DeviceDriverConformanceSuite.ModelsExternalDeviceConnection"/> at its
/// <see langword="true"/> default — the latter deliberately, because flipping it guts TWO checks (the Health
/// invariant AND the "did not already connect" half of the construction check) and an RTU driver plainly models
/// an external device.</para>
/// </summary>
public abstract class ModbusRtuConformanceTestsBase : DeviceDriverConformanceSuite, IAsyncLifetime
{
    protected ModbusRtuConformanceTestsBase(ITestOutputHelper output) => Output = output;

    protected ITestOutputHelper Output { get; }

    /// <summary>How long the silent-peer read target is allowed to wait for an answer that never comes.
    /// <b>Deliberately longer than <see cref="DeviceDriverConformanceSuite.CancellationBudget"/></b> (5 s): if
    /// the driver's own bound could expire inside the budget, a driver that ignored its token entirely would
    /// still pass <see cref="DeviceDriverConformanceSuite.Check_ReadAsync_HonoursCancellation_WhenNoDeviceIsReachable"/>
    /// by simply timing out — the check would measure the map instead of the mechanism. At 8 s only
    /// <see cref="IModbusBusLink.AbortPendingRead"/> can end the enumeration in time.</summary>
    protected const int SilentPeerReadTimeoutMs = 8_000;

    /// <summary>The bound the unresponsive WRITE target waits before giving up — the "SHORT internal write
    /// timeout" <see cref="DeviceDriverConformanceSuite.CreateUnresponsiveWritableDeviceAsync"/>'s own doc
    /// comment asks for, matched to <c>ModbusTcpDriverConformanceTests</c>' 300 ms so the two transports'
    /// write checks are timed the same.
    ///
    /// <para>🔴 <b>What that shortness costs, found by a mutation that SURVIVED and reported rather than
    /// papered over.</b> Neutering <see cref="ModbusBusTransaction"/>'s
    /// <see cref="IModbusBusLink.AbortPendingRead"/> registration killed
    /// <see cref="DeviceDriverConformanceSuite.Check_ReadAsync_HonoursCancellation_WhenNoDeviceIsReachable"/> in
    /// both subclasses and left
    /// <see cref="DeviceDriverConformanceSuite.Check_Write_Cancellation_HonouredPromptly_EvenAgainstAnUnresponsiveDevice"/>
    /// GREEN — because at 300 ms the driver's own timeout resolves the call long before that check's
    /// <see cref="DeviceDriverConformanceSuite.CancellationBudget"/> (5 s) expires, so the check cannot tell a
    /// honoured cancellation from an ordinary timeout. It is the shared suite's own shape, not this rig's: the
    /// hook REQUIRES a short internal bound so the timeout checks resolve quickly, and the same session serves
    /// the cancellation check. <c>ModbusTcpDriverConformanceTests</c> has it too, at the same 300 ms.</para>
    ///
    /// <para><b>And it cannot be tuned away here, which is why it is recorded instead.</b> Making the bound
    /// discriminating means <c>readTimeoutMs &gt; CancellationBudget</c>, i.e. &gt; 5 000 ms; but then
    /// <c>WorstCaseBusHoldMs = registers × (retries + 1) × readTimeoutMs</c> is at least 10 000 ms for any map
    /// with a single retry, which blows the §10 bound
    /// <see cref="TheWriteChecksAreSizedAgainstTheWholeBusesWorstCaseHold_NotTheWritingDevicesOwn"/> requires to
    /// fit inside an 8 000 ms <see cref="DeviceDriverConformanceSuite.WriteBudget"/>. The two constraints have no
    /// common solution for a shared-bus driver. The property itself is NOT unguarded — D-5 pins it directly, at a
    /// 30 000 ms bound where only cancellation can end the call:
    /// <c>ModbusRtuDriverWriteTests.ACancelledInFlightCommand_ReportsIndeterminate_NamingTheCycle_AndDoesNotTearDownTheBus</c>
    /// and its setpoint sibling.</para></summary>
    protected const int UnresponsiveWriteTimeoutMs = 300;

    /// <summary>
    /// 🔴 <b>The retry count the unresponsive write map DECLARES — i.e. the number the driver must NOT use.</b>
    /// Blueprint §8.1: <i>a test that supplies the value it checks is blind to who chooses that value</i>.
    /// <see cref="DeviceDriverConformanceSuite.Check_Write_NoImplicitRetry_ExactlyOneCommandAttemptReachesTheDeviceOnTimeout"/>
    /// asserts exactly one attempt reaches the device; against a map declaring <c>retries: null</c> that
    /// assertion would also hold for a driver that inherited the map's value, because the default is 1 and
    /// <c>EffectiveRetries + 1</c> attempts would be... two. Declaring 3 makes the inherited answer FOUR frames,
    /// so the check discriminates. Three rather than <see cref="ModbusRegisterMap.MaxRetries"/> (5) because this
    /// number is a MULTIPLIER on <see cref="ModbusRegisterMap.WorstCaseBusHoldMs"/>, which
    /// <see cref="TheWriteChecksAreSizedAgainstTheWholeBusesWorstCaseHold_NotTheWritingDevicesOwn"/> requires to
    /// fit inside <see cref="DeviceDriverConformanceSuite.WriteBudget"/> with real headroom.
    /// </summary>
    protected const int UnresponsiveWriteDeclaredRetries = 3;

    public virtual Task InitializeAsync() => Task.CompletedTask;

    public virtual Task DisposeAsync() => Task.CompletedTask;

    /// <summary>A fresh lease on the bus every <see cref="CreateDriver"/> instance rides. Pure in-memory —
    /// see this class's own doc comment for why that is a contract and not a hope.</summary>
    protected abstract ModbusBusLease AcquireNoDeviceLease();

    /// <summary>The map every <see cref="CreateDriver"/> instance carries. Writable (a declared point AND a
    /// declared command) because the suite's namespace/immutability/unknown-name checks all run against
    /// <see cref="CreateDriver"/>'s own return value — the same reason B-7 introduced
    /// <c>ModbusLoopbackHarness.BuildWritableMap</c> on the TCP side.</summary>
    protected abstract ModbusRegisterMap BuildNoDeviceMap();

    /// <summary>The map the unresponsive WRITE target carries.</summary>
    protected abstract ModbusRegisterMap BuildUnresponsiveWriteMap();

    /// <summary>Every map that is live on the bus the write checks run against, INCLUDING the writing device's
    /// own read path — see
    /// <see cref="TheWriteChecksAreSizedAgainstTheWholeBusesWorstCaseHold_NotTheWritingDevicesOwn"/>.</summary>
    protected abstract IReadOnlyList<ModbusRegisterMap> MapsSharingTheWriteBus { get; }

    /// <summary>
    /// One implementation for both subclasses; they vary only in which bus the lease comes from and what the
    /// map says. See this class's doc comment for the argument that this satisfies the hook's
    /// "non-blocking, no I/O" contract, and for what it does about a leaked lease.
    /// </summary>
    protected sealed override IDeviceDriver CreateDriver()
    {
        var map = BuildNoDeviceMap();

        // 🔴 BEFORE Acquire, which is the whole reason ValidateRtuUnitId was extracted out of the driver's
        // constructor in D-4's review (I-5): a constructor throw AFTER a lease has been taken leaks it, and a
        // leaked lease keeps a bus — and under D-3 an exclusively-opened COM port — alive for the process
        // lifetime.
        ModbusRtuDriver.ValidateRtuUnitId(map);

        var lease = AcquireNoDeviceLease();
        try
        {
            return new ModbusRtuDriver(lease, map);
        }
        catch
        {
            // The belt to that braces. Blocking, and that is acceptable precisely here: this path only runs
            // when the constructor has ALREADY thrown, so the non-blocking contract is moot and leaking the
            // lease is the worse of the two outcomes. ModbusBusLease.DisposeAsync is idempotent, so a caller
            // that also releases is harmless.
            lease.DisposeAsync().AsTask().GetAwaiter().GetResult();
            throw;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // The seventeen shared checks, wired.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public Task Construction_IsNonBlocking_AndPerformsNoIO() => Check_Construction_IsNonBlocking_AndPerformsNoIO();

    [Fact]
    public Task Id_And_Kind_AreNonEmpty_AndStableAcrossLifetime() => Check_Id_And_Kind_AreNonEmpty_AndStableAcrossLifetime();

    [Fact]
    public Task Health_OnlyTakesDocumentedValues_AndIsSaneWithNoDevice() => Check_Health_OnlyTakesDocumentedValues_AndIsSaneWithNoDevice();

    [Fact]
    public Task ReadAsync_HonoursCancellation_WhenNoDeviceIsReachable() => Check_ReadAsync_HonoursCancellation_WhenNoDeviceIsReachable();

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
    // 🔴 Blueprint §10 obligations 1 and 2, discharged as an assertion rather than as a sentence.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>The collision the brief names, resolved and pinned: the shared suite issues every write with
    /// <see cref="CancellationToken.None"/>, and blueprint §10 obligation 1 says NEVER to do that.</b>
    ///
    /// <para><b>The finding first, because it outlives this rig.</b>
    /// <see cref="DeviceDriverConformanceSuite.Check_Write_TimedOutWriteOrCommand_ReturnsIndeterminate_NeverThrows"/>
    /// and three of its siblings pass <see cref="CancellationToken.None"/> deliberately — the hook's own doc
    /// comment says they "issue a call with NO cancellation at all and wait for the driver's own bound to
    /// elapse". That design silently assumes a 1:1 transport, where a driver's own bound IS the whole wait. On a
    /// shared RS-485 line it is not: a write can queue behind another device's ENTIRE hold, which the map itself
    /// will accept up to about two hours. The suite is shared with four other drivers and cannot be
    /// per-driver-fixed, so the honest move is not to pretend the call is bounded — it is to make the BOUND
    /// STRUCTURAL for this rig and to assert it, which is what this test does.</para>
    ///
    /// <para><b>How it is sized — obligation 2 taken literally.</b> <c>max_j</c>
    /// <see cref="ModbusRegisterMap.WorstCaseBusHoldMs"/> over every map alive on the bus (not the writing
    /// device's own), plus the writing device's own worst hold, which for a COIL PULSE is TWO round trips
    /// because both halves share one transaction. The writing device's own map is deliberately included in the
    /// <c>max_j</c> term as well: in production a driver polls while it writes, so a write genuinely can queue
    /// behind its OWN read path.</para>
    ///
    /// <para><b>The assertion carries 2× headroom</b>, so this goes red if a later edit raises a timeout or a
    /// retry count in either rig — which is the mechanism by which the sizing stays true rather than a number
    /// that was true once. What it does NOT claim: that <see cref="CancellationToken.None"/> is acceptable in
    /// production. D-7's endpoint must supply a real bound, computed exactly this way.</para>
    /// </summary>
    [Fact]
    public void TheWriteChecksAreSizedAgainstTheWholeBusesWorstCaseHold_NotTheWritingDevicesOwn()
    {
        var maps = MapsSharingTheWriteBus;
        Assert.NotEmpty(maps);

        var writeMap = BuildUnresponsiveWriteMap();

        // Obligation 2: the LARGEST hold on the bus, not the writer's own.
        var queueBehindMs = maps.Max(m => m.WorstCaseBusHoldMs);

        // The writer's own worst case: a coil pulse's assert and reset halves share ONE transaction.
        var ownHoldMs = 2L * writeMap.EffectiveReadTimeoutMs;

        var boundMs = queueBehindMs + ownHoldMs;
        var budgetMs = (long)WriteBudget.TotalMilliseconds;

        Output.WriteLine(
            $"{GetType().Name}: max_j WorstCaseBusHoldMs = {queueBehindMs} ms over {maps.Count} map(s) on the " +
            $"write bus; the writer's own pulse hold = {ownHoldMs} ms; bound = {boundMs} ms against a " +
            $"WriteBudget of {budgetMs} ms.");

        Assert.True(
            boundMs * 2 <= budgetMs,
            $"the write rig's worst-case bound is {boundMs} ms, which leaves less than 2x headroom inside the " +
            $"suite's {budgetMs} ms WriteBudget. The shared suite issues its write checks with " +
            "CancellationToken.None, so nothing but this rig's own numbers bounds them — see blueprint §10 " +
            "obligations 1 and 2. Lower a readTimeoutMs or a retries in the rig rather than raising the budget.");

        // The `max_j over the bus` term is satisfied trivially by a one-device bus, which is why the multidrop
        // subclass exists and why it asserts, separately, that its own max comes from a device OTHER than the
        // writer. Nothing further is asserted here that this method itself supplied.
    }
}

/// <summary>
/// 🔴 Task D-6 — <b>the shared suite against a real <see cref="ModbusRtuDriver"/> that owns its bus alone.</b>
/// The direct counterpart of <c>ModbusTcpDriverConformanceTests</c>, and the baseline the multidrop subclass is
/// read against: anything that fails there and passes here is about SHARING, not about RTU.
///
/// <para><b>The three device shapes.</b></para>
/// <list type="bullet">
/// <item><description><see cref="CreateDriver"/> — a bus whose LINK CANNOT BE OPENED, which is RTU's genuine
/// fast failure; see <see cref="ModbusRtuConformanceRig.UnopenableLine"/> for why a silent line is the wrong
/// answer to that hook and an absent port is the right one.</description></item>
/// <item><description><see cref="CreateUnresponsiveDeviceAsync"/> — a peer that accepts every byte and answers
/// none, over a paired in-memory link. There is no portable virtual COM port; this is the only way to stand one
/// up.</description></item>
/// <item><description><see cref="CollectReadingsAsync"/> — a REAL in-process NModbus RTU slave network, real
/// CRC, real t3.5 framing, real dispatch by unit id. Only the copper is simulated.</description></item>
/// </list>
/// </summary>
public sealed class ModbusRtuDriverConformanceTests(ITestOutputHelper output) : ModbusRtuConformanceTestsBase(output)
{
    private readonly ModbusBusRegistry _registry = new();
    private ModbusBusLease? _keepAlive;

    /// <summary>🔴 The keep-alive lease. See <see cref="ModbusRtuConformanceRig"/>'s own doc comment for the
    /// <c>ClosedLoopbackPort</c> analogy: without it, the last <see cref="CreateDriver"/> instance's disposal
    /// takes the reference count to zero, disposes the bus, and the NEXT call gets a fresh bus over the corpse.
    /// It costs nothing here (no link is ever opened) and it is held anyway, because "this particular rig
    /// happens not to need the rule" is how the rule stops being applied where it does.</summary>
    public override Task InitializeAsync()
    {
        _keepAlive = AcquireNoDeviceLease();
        return Task.CompletedTask;
    }

    public override async Task DisposeAsync()
    {
        if (_keepAlive is not null)
        {
            await _keepAlive.DisposeAsync();
        }

        await _registry.DisposeAsync();
    }

    protected override ModbusBusLease AcquireNoDeviceLease() =>
        _registry.Acquire(ModbusRtuConformanceRig.AbsentLineBusKey, ModbusRtuConformanceRig.UnopenableLine());

    protected override ModbusRegisterMap BuildNoDeviceMap() =>
        ModbusRtuLoopbackHarness.BuildWritableMap(
            "RTU-CONFORMANCE-NODEVICE", unitId: 1, readTimeoutMs: 250, pollIntervalMs: 50, retries: 0);

    protected override ModbusRegisterMap BuildUnresponsiveWriteMap() =>
        ModbusRtuLoopbackHarness.BuildWritableMap(
            "RTU-CONFORMANCE-WRITE-UNRESPONSIVE",
            unitId: 1,
            readTimeoutMs: UnresponsiveWriteTimeoutMs,
            pollIntervalMs: 60_000,
            retries: UnresponsiveWriteDeclaredRetries);

    protected override IReadOnlyList<ModbusRegisterMap> MapsSharingTheWriteBus =>
        new[] { BuildUnresponsiveWriteMap() };

    /// <summary>A peer that accepts every byte and never answers one — see
    /// <see cref="ModbusRtuConformanceRig.SilentPeer"/>. <c>ForceUnstickAsync</c> disposes the rig, which
    /// disposes the registry and therefore the bus's link, unblocking anything still parked on a read the way
    /// the TCP class's own <c>listener.Stop()</c> does.</summary>
    protected override Task<UnresponsiveDeviceSession> CreateUnresponsiveDeviceAsync()
    {
        var peer = ModbusRtuConformanceRig.SilentPeer.Start("silent-read");
        var driver = new ModbusRtuDriver(
            peer.Acquire(),
            ModbusRtuLoopbackHarness.BuildWritableMap(
                "RTU-CONFORMANCE-SILENT",
                unitId: 1,
                readTimeoutMs: SilentPeerReadTimeoutMs,
                pollIntervalMs: 50,
                retries: 0));

        return Task.FromResult(new UnresponsiveDeviceSession(driver, () => peer.DisposeAsync().AsTask()));
    }

    /// <inheritdoc cref="CreateUnresponsiveDeviceAsync"/>
    protected override Task<UnresponsiveWritableDeviceSession> CreateUnresponsiveWritableDeviceAsync()
    {
        var peer = ModbusRtuConformanceRig.SilentPeer.Start("silent-write");
        var map = BuildUnresponsiveWriteMap();
        var driver = new ModbusRtuDriver(peer.Acquire(), map);

        return Task.FromResult(new UnresponsiveWritableDeviceSession(
            driver,
            ModbusRtuLoopbackHarness.WritableSpeedPoint,
            100.0,
            ModbusRtuLoopbackHarness.StartCycleCommand,
            CommandArguments: null,
            // Counted at the BUS BOUNDARY, filtered to this unit's coil writes — never from anything the
            // driver reports. See SilentPeer.RequestFramesAtTheBusBoundary.
            CommandAttemptsReachingDevice: () =>
                peer.RequestFramesAtTheBusBoundary(map.UnitId, RtuFrames.FunctionWriteSingleCoil),
            AttemptCountSettleDelay: TimeSpan.FromMilliseconds(300),
            ForceUnstickAsync: () => peer.DisposeAsync().AsTask()));
    }

    protected override async Task<IReadOnlyList<DeviceReading>> CollectReadingsAsync(
        int count, TimeSpan timeout, Action<DeviceReading>? onYielded = null)
    {
        await using var bus = ModbusRtuLoopbackHarness.Start(((byte)1, new ushort[] { 235, 0xFFFF }));
        // Disposal runs in reverse: the driver's lease first, then this one, so the bus's link is never torn
        // down while a driver still holds a claim on it.
        await using var keepAlive = bus.Lease();
        await using var driver = new ModbusRtuDriver(
            bus.Lease(),
            ModbusRtuLoopbackHarness.BuildMap(
                "RTU-CONFORMANCE-READINGS", unitId: 1, pollIntervalMs: 20, readTimeoutMs: 1_000));

        return await CollectFromAsync(driver, count, timeout, onYielded);
    }
}
