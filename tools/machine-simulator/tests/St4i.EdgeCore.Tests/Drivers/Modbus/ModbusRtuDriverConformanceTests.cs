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
    /// <para>🔴 <b>300 ms is right for the four checks that issue an UNCANCELLED write, and it is wrong for the
    /// one that does not — which is why
    /// <see cref="Check_Write_Cancellation_HonouredPromptly_EvenAgainstAnUnresponsiveDevice"/> is overridden
    /// below to raise it.</b> A mutation neutering <see cref="ModbusBusTransaction"/>'s
    /// <see cref="IModbusBusLink.AbortPendingRead"/> registration killed
    /// <see cref="DeviceDriverConformanceSuite.Check_ReadAsync_HonoursCancellation_WhenNoDeviceIsReachable"/> on
    /// both subclasses and left the write-side cancellation check GREEN: at 300 ms the driver's own timeout
    /// resolves the call long before that check's <see cref="DeviceDriverConformanceSuite.CancellationBudget"/>
    /// (5 s) expires, so it could not tell an honoured cancellation from an ordinary timeout.</para>
    ///
    /// <para>
    /// 🔴 <b>THE RECORD THIS DOC BLOCK USED TO CARRY WAS A FALSE IMPOSSIBILITY PROOF, AND CORRECTING IT MATTERS
    /// MORE THAN THE FIX.</b> It concluded that the blind spot <i>"cannot be tuned away"</i>, arguing: making
    /// the bound discriminating needs <c>readTimeoutMs &gt; CancellationBudget</c> (5 000 ms), but then
    /// <c>WorstCaseBusHoldMs = registers × (retries + 1) × readTimeoutMs</c> exceeds 10 000 ms and blows the
    /// §10 bound <see cref="TheWriteChecksAreSizedAgainstTheWholeBusesWorstCaseHold_NotTheWritingDevicesOwn"/>
    /// must fit inside an 8 000 ms <see cref="DeviceDriverConformanceSuite.WriteBudget"/> — <i>"the two
    /// constraints have no common solution for a shared-bus driver"</i>. <b>That is wrong.</b>
    /// </para>
    ///
    /// <para><b>Why it is wrong, in one line: a §10 bound was applied to the one call §10 does not govern.</b>
    /// <c>WorstCaseBusHoldMs ≥ 10 000</c> binds the checks that issue <see cref="CancellationToken.None"/> —
    /// the ones with no caller-supplied bound, which is exactly the situation blueprint §10 obligation 1 is
    /// about.
    /// <see cref="DeviceDriverConformanceSuite.Check_Write_Cancellation_HonouredPromptly_EvenAgainstAnUnresponsiveDevice"/>
    /// is the ONLY write check that issues no <see cref="CancellationToken.None"/> call at all — it passes
    /// <c>cts.Token</c> — so it is bounded by that token and by
    /// <see cref="DeviceDriverConformanceSuite.CancellationBudget"/>, never by
    /// <see cref="DeviceDriverConformanceSuite.WriteBudget"/> and never by the sizing rule. It is the one check
    /// that already DISCHARGES obligation 1 rather than needing to be bounded by it.</para>
    ///
    /// <para><b>Two premises were held silently and both are false:</b> that
    /// <see cref="DeviceDriverConformanceSuite.CancellationBudget"/>/<see cref="DeviceDriverConformanceSuite.WriteBudget"/>
    /// are constants (both are <see langword="protected virtual"/>), and that one session shape must serve every
    /// write check (<see cref="DeviceDriverConformanceSuite.CreateUnresponsiveWritableDeviceAsync"/> is called
    /// FRESH by each check, and every <c>Check_*</c> is <see langword="public virtual"/>). Neither was stated,
    /// which is why neither was tested.</para>
    ///
    /// <para><b>The tell, recorded because the next author's failure mode is re-deriving the wrong
    /// answer:</b> the identical problem was already solved on the READ side, in this same file, with this same
    /// number — see <see cref="SilentPeerReadTimeoutMs"/> one member above, whose doc says <i>"if the driver's
    /// own bound could expire inside the budget… the check would measure the map instead of the mechanism"</i>.
    /// Blueprint §8.1 principle 1: <i>"cannot happen" and "cannot be tested" are both statements about the
    /// limits of one's own toolkit, wearing the clothes of a statement about the source</i> — written here while
    /// quoting that principle.</para>
    ///
    /// <para><b>What IS true and stays true:</b> the four uncancelled write checks genuinely need a short bound
    /// (the hook's own doc comment requires it) and their 300 ms and their sizing test are unchanged; and the
    /// TCP conformance class has the same 300 ms and the same blind spot on its own cancellation check, which is
    /// a named finding for the whole-branch review rather than this task's to fix.</para></summary>
    protected const int UnresponsiveWriteTimeoutMs = 300;

    /// <summary>Set for the duration of ONE check by
    /// <see cref="Check_Write_Cancellation_HonouredPromptly_EvenAgainstAnUnresponsiveDevice"/> and zero
    /// otherwise. A plain field is safe: xunit constructs a fresh test-class instance per test and runs a
    /// class's tests sequentially, and the override restores it in a <c>finally</c> regardless.</summary>
    private int _unresponsiveWriteTimeoutOverrideMs;

    /// <summary>The bound <see cref="BuildUnresponsiveWriteMap"/> must actually apply — see
    /// <see cref="UnresponsiveWriteTimeoutMs"/> for why exactly one check needs a different one.</summary>
    protected int EffectiveUnresponsiveWriteTimeoutMs =>
        _unresponsiveWriteTimeoutOverrideMs > 0 ? _unresponsiveWriteTimeoutOverrideMs : UnresponsiveWriteTimeoutMs;

    /// <summary>
    /// 🔴 <b>The retry count the unresponsive write map DECLARES — i.e. the number the driver must NOT use.</b>
    /// Blueprint §8.1: <i>a test that supplies the value it checks is blind to who chooses that value</i>, so the
    /// map declares a retry count and
    /// <see cref="DeviceDriverConformanceSuite.Check_Write_NoImplicitRetry_ExactlyOneCommandAttemptReachesTheDeviceOnTimeout"/>
    /// asserts the frame count at the wire.
    ///
    /// <para>🔴 <b>What this constant does NOT do, corrected — the earlier rationale here was arithmetically
    /// wrong.</b> It claimed that with <c>retries: null</c> the no-retry check would still pass for a driver
    /// that inherited the map's value. It would not: <see cref="ModbusRegisterMap.EffectiveRetries"/> is
    /// <c>Retries ?? 1</c>, so an inheriting driver puts <b>two</b> frames on the wire and
    /// <c>Assert.Equal(1, after - before)</c> already fails. <b>Declaring 3 is not what makes the check
    /// discriminate.</b> What it buys is smaller and worth stating accurately: a wider margin (four frames
    /// against one, so the delta is unmistakable rather than off-by-one), and a frame count that is
    /// DIAGNOSTIC — 4 says the driver inherited the map's declared value, 2 says it hard-coded NModbus's
    /// notion of "one retry", 1 is correct. Both defects fail either way; only the declared value tells you
    /// which.</para>
    ///
    /// <para>Three rather than <see cref="ModbusRegisterMap.MaxRetries"/> (5) because this number is a
    /// MULTIPLIER on <see cref="ModbusRegisterMap.WorstCaseBusHoldMs"/>, which
    /// <see cref="TheWriteChecksAreSizedAgainstTheWholeBusesWorstCaseHold_NotTheWritingDevicesOwn"/> requires to
    /// fit inside <see cref="DeviceDriverConformanceSuite.WriteBudget"/> with real headroom.</para>
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
    // 🔴 The ONE check whose target this rig has to strengthen — see UnresponsiveWriteTimeoutMs for the false
    //    impossibility proof this replaces.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>Runs the shared write-side cancellation check against a target whose own bound cannot expire
    /// inside <see cref="DeviceDriverConformanceSuite.CancellationBudget"/> — so that passing it proves
    /// <see cref="IModbusBusLink.AbortPendingRead"/> did the work, not that a timeout got there first.</b>
    /// Exactly the same reasoning, and exactly the same 8 000 ms, as the READ side's
    /// <see cref="SilentPeerReadTimeoutMs"/>.
    ///
    /// <para><b>Legitimate here and nowhere else on the write path:</b> this is the only <c>Check_Write_*</c>
    /// that supplies its own <see cref="CancellationToken"/> rather than
    /// <see cref="CancellationToken.None"/>, so raising its target's bound cannot make any call unbounded —
    /// the token bounds it. The four uncancelled checks keep <see cref="UnresponsiveWriteTimeoutMs"/> and the
    /// §10 sizing rule, which is why
    /// <see cref="TheWriteChecksAreSizedAgainstTheWholeBusesWorstCaseHold_NotTheWritingDevicesOwn"/> is
    /// deliberately NOT extended to cover this variant. A future reader who "helpfully" folds the 8 000 ms map
    /// into that test will turn it red for a call it does not govern.</para>
    ///
    /// <para>
    /// 🔴 <b>THE CAVEAT, because this is a mechanism the census cannot police.</b>
    /// <see cref="DeviceDriverConformanceSuite.EveryCheckIsWiredOrAcknowledged"/> proves every check is WIRED;
    /// nothing proves a driver's own subclass has not overridden a <c>Check_*</c> body and weakened it — an
    /// override is invisible to that census, and would be the quietest possible way to make a conformance suite
    /// lie. <b>So an override of a <c>Check_*</c> in a driver's subclass must be a <c>base</c>-CALLING WRAPPER,
    /// never a re-implementation</b>, and the strengthening is ASSERTED below rather than promised in prose:
    /// the target's own bound must be strictly greater than the budget the check measures against, or this
    /// wrapper fails before it delegates.</para>
    /// </summary>
    public override async Task Check_Write_Cancellation_HonouredPromptly_EvenAgainstAnUnresponsiveDevice()
    {
        _unresponsiveWriteTimeoutOverrideMs = SilentPeerReadTimeoutMs;
        try
        {
            var strengthened = BuildUnresponsiveWriteMap().EffectiveReadTimeoutMs;
            Assert.True(
                strengthened > CancellationBudget.TotalMilliseconds,
                $"this wrapper exists to STRENGTHEN the check, and it has stopped doing so: the unresponsive " +
                $"write target's own bound is {strengthened} ms against a {CancellationBudget.TotalMilliseconds} ms " +
                "CancellationBudget, so an ordinary timeout could satisfy the check and a driver that ignored " +
                "its token entirely would still pass. Raise the bound rather than deleting this assertion.");

            await base.Check_Write_Cancellation_HonouredPromptly_EvenAgainstAnUnresponsiveDevice()
                .ConfigureAwait(false);
        }
        finally
        {
            _unresponsiveWriteTimeoutOverrideMs = 0;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 Blueprint §10 obligations 1 and 2, discharged as an assertion rather than as a sentence.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>The collision the brief names, resolved and pinned — for the write checks that issue an
    /// UNCANCELLED call, which is not all of them.</b> Blueprint §10 obligation 1 says never to call
    /// <c>WriteSetpointAsync</c>/<c>InvokeCommandAsync</c> with an unbounded
    /// <see cref="CancellationToken"/>, and four of the shared suite's write checks do exactly that.
    ///
    /// <para><b>Which ones, precisely — the earlier "every write check" was wrong and the imprecision was
    /// load-bearing.</b> It is what hid the fix now sitting on
    /// <see cref="Check_Write_Cancellation_HonouredPromptly_EvenAgainstAnUnresponsiveDevice"/>.
    /// <see cref="DeviceDriverConformanceSuite.Check_Write_TimedOutWriteOrCommand_ReturnsIndeterminate_NeverThrows"/>,
    /// <see cref="DeviceDriverConformanceSuite.Check_Write_NoImplicitRetry_ExactlyOneCommandAttemptReachesTheDeviceOnTimeout"/>,
    /// <see cref="DeviceDriverConformanceSuite.Check_Write_RoundTripsLosslesslyThroughConnectorJson"/> and
    /// <see cref="DeviceDriverConformanceSuite.Check_Write_Indeterminate_DetailIsNonEmpty_AndDistinguishesDistinctCauses"/>
    /// each issue at least one <see cref="CancellationToken.None"/> call that reaches the bus — those four are
    /// what this test bounds. (The last of the four also issues token-bounded calls, deliberately: two distinct
    /// causes is the property it checks.) Two more checks pass
    /// <see cref="CancellationToken.None"/> for PRE-FLIGHT rejections only, which never reach the line at all.
    /// <see cref="DeviceDriverConformanceSuite.Check_Write_CapabilityLists_AreEffectivelyImmutable"/> issues no
    /// write whatsoever. And
    /// <see cref="DeviceDriverConformanceSuite.Check_Write_Cancellation_HonouredPromptly_EvenAgainstAnUnresponsiveDevice"/>
    /// passes only a token — it is the one check that DISCHARGES obligation 1 instead of needing to be bounded
    /// by it, and it is deliberately outside this test.</para>
    ///
    /// <para><b>The finding, because it outlives this rig.</b> The hook's own doc comment says those calls
    /// "issue a call with NO cancellation at all and wait for the driver's own bound to elapse". That design
    /// silently assumes a 1:1 transport, where a driver's own bound IS the whole wait. On a shared RS-485 line it
    /// is not: a write can queue behind another device's ENTIRE hold, which the map itself will accept up to
    /// about two hours. The suite is shared with four other drivers and cannot be per-driver-fixed, so the honest
    /// move is not to pretend the call is bounded — it is to make the BOUND STRUCTURAL for this rig and to assert
    /// it, which is what this test does.</para>
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

    /// <summary>🔴 The keep-alive lease, and an accurate statement of what it is for — see
    /// <see cref="ModbusRtuConformanceRig"/>'s own doc comment for the mechanism and
    /// <c>ModbusRtuConformanceRigTests.ReleasingTheLastLease_...</c> for the paired control that pins it.
    ///
    /// <para><b>This rig would NOT be destroyed without it, and the earlier claim that it would was
    /// untested.</b> Removing this line leaves all 46 tests green, for the plain reason that this bus's link is
    /// never opened at all: every <see cref="CreateDriver"/> instance's disposal does take the reference count
    /// to zero and does dispose the bus, but the next <see cref="ModbusBusRegistry.Acquire"/> then builds a
    /// fresh bus over a delegate that throws, which is indistinguishable from the previous one. What the lease
    /// buys here is that the rig's correctness does not DEPEND on that — it holds whether or not a link is ever
    /// opened, so pointing this rig at a live transport later cannot quietly turn a passing suite into one
    /// building buses on a disposed link.</para></summary>
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
            readTimeoutMs: EffectiveUnresponsiveWriteTimeoutMs,
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
