using System.Diagnostics;
using System.Reflection;
using System.Text.Json;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Json;
using St4i.Connector.Abstractions.Models;
using Xunit;

namespace St4i.Connector.Conformance;

/// <summary>
/// GP-6 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-6-brief.md) — the shared,
/// reusable suite every <see cref="IDeviceDriver"/> implementation — first- or third-party — must pass to be
/// considered a conforming connector. Every check here enforces a line from <see cref="IDeviceDriver"/>'s OWN
/// doc comments (or, where noted on the individual check, an invariant this task's author judged the doc
/// comment implies without stating outright — see task-6-report.md for the full list and rationale).
///
/// <para><b>How a driver author uses this.</b> Subclass this type, implement the abstract hooks below to
/// describe how to build (and, for the two readings-dependent checks, how to actually DRIVE) your own
/// driver, then add one <c>[Fact]</c>-attributed delegating method per check you want xunit to run
/// automatically — e.g. <c>[Fact] public Task Construction_IsNonBlocking() =>
/// Check_Construction_IsNonBlocking_AndPerformsNoIO();</c>. The check methods are deliberately NOT
/// <c>[Fact]</c>-attributed themselves: that keeps a subclass wired to a KNOWN-non-conforming driver (this
/// project's own negative-control fakes; see <c>tests/St4i.Connector.Conformance.Tests</c>) from being
/// auto-discovered and auto-run by xunit as if it were an ordinary passing test class — a negative control
/// instead calls the specific check method it means to prove has teeth and asserts that IT throws.</para>
///
/// <para><b>The two traps this suite exists to avoid</b> (both of which this project has been bitten by
/// before — see task-6-report.md): (1) a check that would still pass if the mechanism it claims to verify
/// were deleted is worse than no check at all, because it manufactures false confidence — every check below
/// is proven to have teeth against a deliberately non-conforming fake driver, not just exercised against
/// conforming ones. (2) a check that silently examines zero real readings is a silent no-op, not a passing
/// check — <see cref="CollectReadingsAsync"/>'s own contract requires it to throw rather than return fewer
/// than the requested count.</para>
///
/// <para><b>A third trap, found by review (task-6-report.md "Fix round 1", IMPORTANT 3): silent
/// omission.</b> Because wiring is hand-written per concrete subclass (one <c>[Fact]</c> delegating method
/// per check), nothing stopped a subclass from simply never wiring a check at all — indistinguishable from
/// that check having been proven unnecessary. <see cref="EveryCheckIsWiredOrAcknowledged"/> closes this: every
/// <c>Check_*</c> method declared here must be either wired (a <c>[Fact]</c> method on the concrete subclass
/// named identically, minus the "Check_" prefix — the convention every wiring already follows) or listed in
/// <see cref="AcknowledgedGaps"/> with a reason (e.g. a <c>KnownGap_*</c> test pinning real, currently-broken
/// behaviour). Anything neither is now a red test instead of a silent absence.</para>
/// </summary>
public abstract class DeviceDriverConformanceSuite
{
    // ---- budgets -----------------------------------------------------------------------------------
    // Every budget below is deliberately generous relative to what a genuinely conforming driver needs
    // (so CI jitter never produces a false failure) while staying decisively tighter than the multi-second
    // failure this task's own real-driver findings measured (see task-6-report.md) — a check that can't
    // tell "fine" from "broken" within its budget isn't earning its keep.

    /// <summary>How long <see cref="CreateDriver"/> itself is allowed to take. IDeviceDriver's contract
    /// documents construction as non-blocking with no I/O — 500ms is generous for pure in-memory work
    /// (field assignment, config parsing) and decisively tighter than any real socket/session attempt.</summary>
    protected virtual TimeSpan ConstructionBudget => TimeSpan.FromMilliseconds(500);

    /// <summary>How long a call to <see cref="IAsyncDisposable.DisposeAsync"/> itself is allowed to take.
    /// Not literally spelled out in <see cref="IDeviceDriver"/>'s own doc comments, but implied by
    /// <c>FleetHost</c>'s own dependence on a bounded dispose (its <c>RestartTeardownTimeout</c> is 3
    /// seconds) — see task-6-report.md for why this suite adds it as an extra check beyond the literal doc
    /// wording.</summary>
    protected virtual TimeSpan DisposeBudget => TimeSpan.FromSeconds(3);

    /// <summary>How long <see cref="Check_ReadAsync_HonoursCancellation_WhenNoDeviceIsReachable"/> waits,
    /// after cancelling, before concluding cancellation was NOT honoured. Comfortably above
    /// <c>FleetHost.RestartTeardownTimeout</c> (3s, the real budget a live host actually gives a driver to
    /// stop) to absorb CI/test-harness overhead, while staying far tighter than the multi-second-to-unbounded
    /// stalls this task's own findings measured against a real (but unresponsive) protocol driver.</summary>
    protected virtual TimeSpan CancellationBudget => TimeSpan.FromSeconds(5);

    /// <summary>Bound for <see cref="CollectReadingsAsync"/> — generous enough for a protocol driver's own
    /// session/handshake setup (OPC-UA's app-instance certificate check in particular), still bounded.</summary>
    protected virtual TimeSpan ReadingsCollectionTimeout => TimeSpan.FromSeconds(20);

    /// <summary>How many real readings <see cref="Check_ReadAsync_NeverReusesOrMutatesAYieldedReading"/>
    /// collects — enough to prove no cross-cycle interference without making the check slow.</summary>
    protected virtual int ReadingsRequiredForReuseCheck => 3;

    /// <summary>How many real readings <see cref="Check_Telemetry_RoundTripsLosslesslyThroughConnectorJson"/>
    /// collects.</summary>
    protected virtual int ReadingsRequiredForRoundTripCheck => 3;

    /// <summary>Task B-7 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-7-brief.md) — bound
    /// for a single <c>WriteSetpointAsync</c>/<c>InvokeCommandAsync</c> call issued against
    /// <see cref="CreateUnresponsiveWritableDeviceAsync"/>'s own target. Generous relative to what a driver
    /// author is expected to configure that target's OWN internal timeout to (a few hundred ms to a couple of
    /// seconds — see that hook's own doc comment), so CI jitter never produces a false failure, while still
    /// catching a driver that hangs indefinitely instead of resolving to <see cref="Models.WriteOutcome.Indeterminate"/>.</summary>
    protected virtual TimeSpan WriteBudget => TimeSpan.FromSeconds(8);

    // ---- hooks a driver author implements ----------------------------------------------------------

    /// <summary>
    /// Builds and returns a brand-new, independent driver instance configured so that no device is
    /// reachable — for a driver that dials out to something external (Modbus/OPC-UA/a third party's own
    /// network link), point it at a target that will never succeed (e.g. a closed TCP port) but is cheap
    /// and FAST to fail against, so every check that uses this hook (everything except
    /// <see cref="Check_ReadAsync_HonoursCancellation_WhenNoDeviceIsReachable"/>, which uses
    /// <see cref="CreateUnresponsiveDeviceAsync"/> instead) stays quick. For a driver with no external
    /// device at all (e.g. a pure in-process simulator), return a normal, fully-usable instance — such a
    /// driver is vacuously always in the "no device" state.
    ///
    /// <para>Called potentially many times per check (each call must return a fresh instance that has not
    /// yet been used) and MUST NOT itself block or perform I/O — that is exactly what
    /// <see cref="Check_Construction_IsNonBlocking_AndPerformsNoIO"/> verifies, so any setup work the
    /// override needs (e.g. pre-computing a definitely-closed port number) belongs OUTSIDE this method, done
    /// once and cached, not inside the timed call itself.</para>
    /// </summary>
    protected abstract IDeviceDriver CreateDriver();

    /// <summary>
    /// <see langword="false"/> ONLY for a driver with no external device/connection concept at all (e.g. a
    /// pure in-process simulator) — such a driver's own doc comment is expected to document why its
    /// <see cref="IDeviceDriver.Health"/> is exempt from "must not report Connected with no device reachable"
    /// (see <see cref="Check_Health_OnlyTakesDocumentedValues_AndIsSaneWithNoDevice"/>). Defaults to
    /// <see langword="true"/> — every driver that models a connection to something outside the process.
    ///
    /// <para><b>This is an escape hatch, not a free parameter — flipping it to <see langword="false"/> guts
    /// the Health check</b> (task-6-report.md "Fix round 1", IMPORTANT 2): the strong invariant ("never
    /// transiently reports Connected while unreachable", checked throughout an active enumeration) is
    /// replaced by the much weaker "Health equals <see cref="ExpectedConstantHealthWhenDeviceLess"/> at two
    /// sample points". A subclass overriding this to <see langword="false"/> MUST have a genuine reason tied
    /// to the driver's own documented behaviour (per <see cref="IDeviceDriver.Health"/>'s own doc comment:
    /// claiming this exemption without documenting it is itself a conformance violation) — never merely to
    /// make an inconvenient assertion go away. A harness with no real "device" concept at all (a
    /// negative-control fake whose <see cref="IDeviceDriver.Health"/> is irrelevant to what it exists to
    /// prove) should simply leave this at its default rather than override it to <see langword="false"/> for
    /// no stated reason.</para>
    ///
    /// <para><b>Batch review finding — this flag guts a SECOND check too, not just Health.</b>
    /// <see cref="Check_Construction_IsNonBlocking_AndPerformsNoIO"/>'s second, independent assertion (the
    /// "Health is not already Connected the instant construction returns" proxy for "the constructor
    /// performed no I/O") is ALSO gated behind this same flag — flipping it to <see langword="false"/>
    /// reduces that check to its first assertion alone (a bare stopwatch), for exactly the same reason the
    /// Health check is gutted: a device-less driver's <see cref="IDeviceDriver.Health"/> reading proves
    /// nothing either way, so there is nothing left for the proxy to check. A subclass overriding this MUST
    /// weigh BOTH checks' loss, not just Health's — <c>HotFolderAoiDriverConformanceTests</c> is the one
    /// example in this repo today: its override lets <c>HotFolderAoiDriver</c>'s constructor (which calls
    /// <c>Directory.CreateDirectory</c> three times and constructs a <see cref="System.IO.FileSystemWatcher"/>
    /// — real I/O, a direct violation of this interface's own class-level "construction is non-blocking and
    /// performs no I/O" rule) pass silently instead of being caught by the timing assertion it would
    /// otherwise still have to clear on every run. See that test class's own doc comment for the full
    /// writeup of this known, un-acknowledged gap (deliberately not fixed here — the driver itself is a
    /// separate decision, and it is only ever constructed off <c>FleetHost</c>'s <c>_gate</c> today).</para>
    /// </summary>
    protected virtual bool ModelsExternalDeviceConnection => true;

    /// <summary>
    /// Only consulted when <see cref="ModelsExternalDeviceConnection"/> is <see langword="false"/> — the
    /// constant <see cref="DriverHealthState"/> value such a driver's own class doc comment documents Health
    /// as always reporting (the default, <see cref="DriverHealthState.Connected"/>, matches every built-in
    /// device-less driver so far). Comparing against an EXTERNALLY DECLARED expectation, rather than merely
    /// comparing the getter to itself before/after some activity, is what makes the device-less branch of
    /// <see cref="Check_Health_OnlyTakesDocumentedValues_AndIsSaneWithNoDevice"/> falsifiable (task-6-report.md
    /// "Fix round 1", IMPORTANT 2) — a before-vs-after comparison is unfalsifiable for an implementation whose
    /// <see cref="IDeviceDriver.Health"/> getter is a literal constant expression, since nothing could ever
    /// make it differ from itself.
    /// </summary>
    protected virtual DriverHealthState ExpectedConstantHealthWhenDeviceLess => DriverHealthState.Connected;

    /// <summary>One driver instance plus a best-effort way to unstick it, for
    /// <see cref="Check_ReadAsync_HonoursCancellation_WhenNoDeviceIsReachable"/> — see
    /// <see cref="CreateUnresponsiveDeviceAsync"/>.</summary>
    protected sealed record UnresponsiveDeviceSession(IDeviceDriver Driver, Func<Task> ForceUnstickAsync);

    /// <summary>
    /// Builds a driver instance pointed at a target that is reachable at the transport level but never
    /// responds (a real, portable, loopback-only "silent" TCP peer — accepts the connection, never writes a
    /// byte back — rather than an external unroutable address, whose hang behaviour depends on ambient
    /// network/firewall routing this suite cannot control or rely on). This is deliberately a DIFFERENT
    /// target than <see cref="CreateDriver"/>'s: task-6-report.md's own findings show a driver's
    /// connect-retry logic can behave very differently against "nothing is listening" (fails fast) versus
    /// "something answered the TCP handshake but the protocol handshake never completes" (can block for a
    /// long time, or indefinitely) — and the realistic "device is unreachable" failure mode this check exists
    /// to catch (per the brief) is squarely the second kind.
    ///
    /// <para>Default implementation wraps <see cref="CreateDriver"/> with a no-op unstick — correct for a
    /// device-less driver (nothing to get stuck connecting to). A driver with an external target overrides
    /// this to stand up its own silent listener and returns a <see cref="ForceUnstickAsync"/> that forcibly
    /// closes it (e.g. from the SERVER side) so a stuck client-side call unblocks — proven in task-6-report.md
    /// to reliably unblock a hung call.</para>
    /// </summary>
    protected virtual Task<UnresponsiveDeviceSession> CreateUnresponsiveDeviceAsync() =>
        Task.FromResult(new UnresponsiveDeviceSession(CreateDriver(), static () => Task.CompletedTask));

    /// <summary>
    /// Collects at least <paramref name="count"/> readings actually yielded by a LIVE, working instance of
    /// this driver (standing up a real loopback server first if the driver needs one to produce anything at
    /// all — see <c>ModbusLoopbackHarness</c>/<c>OpcUaLoopbackHarness</c> in
    /// <c>tests/St4i.EdgeCore.Tests</c> for how the three built-in drivers do this), invoking
    /// <paramref name="onYielded"/> synchronously the INSTANT each one is received — before the next is
    /// requested — so a caller can snapshot it before any later cycle has a chance to mutate it in place.
    ///
    /// <para>MUST throw a clear, descriptive exception (never silently return fewer than <paramref
    /// name="count"/>) if it cannot gather enough within <paramref name="timeout"/> — a driver with no
    /// reachable device produces no readings at all, and a readings-dependent check that silently examined
    /// zero of them would be exactly the "silent no-op" failure mode task-6-brief.md calls out by name.
    /// <see cref="CollectFromAsync"/> below already implements this contract correctly for the common case
    /// (drive <paramref name="driver"/>'s own <see cref="IDeviceDriver.ReadAsync"/> directly) — most
    /// overrides can just stand up whatever the driver needs first, then delegate to it.</para>
    /// </summary>
    protected abstract Task<IReadOnlyList<DeviceReading>> CollectReadingsAsync(
        int count, TimeSpan timeout, Action<DeviceReading>? onYielded = null);

    /// <summary>Reusable implementation of <see cref="CollectReadingsAsync"/>'s contract against an
    /// already-constructed, already-reachable <paramref name="driver"/> — enumerate <see
    /// cref="IDeviceDriver.ReadAsync"/> until <paramref name="count"/> readings are collected or <paramref
    /// name="timeout"/> elapses, throwing <see cref="TimeoutException"/> in the latter case rather than
    /// silently returning short.</summary>
    protected static async Task<IReadOnlyList<DeviceReading>> CollectFromAsync(
        IDeviceDriver driver, int count, TimeSpan timeout, Action<DeviceReading>? onYielded = null)
    {
        var results = new List<DeviceReading>(count);
        using var cts = new CancellationTokenSource(timeout);
        try
        {
            await foreach (var reading in driver.ReadAsync(cts.Token).ConfigureAwait(false))
            {
                results.Add(reading);
                onYielded?.Invoke(reading);
                if (results.Count >= count) break;
            }
        }
        catch (OperationCanceledException) when (results.Count < count)
        {
            throw new TimeoutException(
                $"only collected {results.Count} of {count} required readings within {timeout} — a " +
                "readings-dependent conformance check cannot run against zero/too few real readings (see " +
                "DeviceDriverConformanceSuite's class doc comment's 'silent no-op' rule).");
        }

        return results;
    }

    // ---- write-contract hooks (Task B-7, task-7-brief.md) -------------------------------------------
    //
    // Applicability, not a gap (the brief's own framing): a driver that does not implement
    // IWritableDeviceDriver at all never reaches any Check_Write_* method (see the wiring-enforcement
    // section below — EveryCheckIsWiredOrAcknowledged tests CreateDriver()'s own runtime type for the
    // capability, exactly the way a real host is documented to: `if (driver is IWritableDeviceDriver)`),
    // so a read-only driver author never has to touch these hooks, never has to add anything to
    // AcknowledgedGaps, and never sees a Check_Write_* method at all in the "must wire or acknowledge" set.
    // A driver that DOES implement it must wire (or acknowledge) every one of them, same as every other check.

    /// <summary>One WRITABLE driver instance plus everything <see cref="Check_Write_TimedOutWriteOrCommand_ReturnsIndeterminate_NeverThrows"/>
    /// and its siblings need, pointed at a target that is transport/session-reachable but never completes a
    /// setpoint write or command invocation — the write-contract mirror of <see cref="UnresponsiveDeviceSession"/>,
    /// extended with what a WRITE check needs beyond a READ one: a real point/command name this driver
    /// actually declares (so a call can be attempted at all, never invented by the suite itself), and a way
    /// to observe how many discrete attempts a TRANSPORT LAYER underneath the driver actually made — the
    /// externally-observable fact <see cref="Check_Write_NoImplicitRetry_ExactlyOneCommandAttemptReachesTheDeviceOnTimeout"/>
    /// needs, since task-4-report.md found a silent transport-level resend the DRIVER'S OWN code never saw
    /// (NModbus's <c>Transport.Retries</c> resending an unacknowledged write) — a driver's own claimed
    /// outcome alone cannot prove this; only a count taken from OUTSIDE the driver can.</summary>
    /// <param name="Driver">A fresh, independent, writable driver instance.</param>
    /// <param name="WritablePoint">A name from <paramref name="Driver"/>'s own <c>WritablePoints</c> — a
    /// setpoint write against it must be attemptable (never rejected pre-flight) so the checks below can
    /// actually reach the "no definitive answer arrives" scenario they exist to test.</param>
    /// <param name="ValidPointValue">A value within <paramref name="WritablePoint"/>'s own declared range —
    /// never rejected as <see cref="Models.SetpointRejectionReason.OutOfRange"/>.</param>
    /// <param name="Command">A name from <paramref name="Driver"/>'s own <c>Commands</c> that takes NO
    /// required arguments the checks below would otherwise have to know how to supply, UNLESS <paramref
    /// name="CommandArguments"/> is supplied to cover them.</param>
    /// <param name="CommandArguments">Arguments to pass alongside <paramref name="Command"/> — <see
    /// langword="null"/> for a zero-argument command (the common case for both built-in protocols' own test
    /// commands).</param>
    /// <param name="CommandAttemptsReachingDevice">Cumulative count of discrete attempts that have reached
    /// the "device" (or its stand-in) so far, observed independently of anything <paramref name="Driver"/>
    /// itself reports — e.g. counting raw requests received on the wire, or a test server's own instrumented
    /// invocation counter. Read before AND after one <c>InvokeCommandAsync</c> call to compute a delta.</param>
    /// <param name="AttemptCountSettleDelay">How long to wait, after a call against <paramref name="Driver"/>
    /// has already returned, before trusting <paramref name="CommandAttemptsReachingDevice"/> as settled —
    /// zero for a target that counts synchronously as bytes arrive (Modbus's raw stream); non-zero for a
    /// target whose own handler runs on a delay independent of when the CLIENT gave up waiting (OPC-UA's
    /// instrumented method, held open past the client's own operation timeout).</param>
    /// <param name="ForceUnstickAsync">Best-effort teardown, mirroring <see cref="UnresponsiveDeviceSession.ForceUnstickAsync"/>'s
    /// own role — called before disposing <paramref name="Driver"/> so a still-listening target doesn't
    /// outlive the check.</param>
    protected sealed record UnresponsiveWritableDeviceSession(
        IWritableDeviceDriver Driver,
        string WritablePoint,
        object ValidPointValue,
        string Command,
        Dictionary<string, object>? CommandArguments,
        Func<int> CommandAttemptsReachingDevice,
        TimeSpan AttemptCountSettleDelay,
        Func<Task> ForceUnstickAsync);

    /// <summary>
    /// Builds a writable driver instance (see <see cref="UnresponsiveWritableDeviceSession"/>'s own doc
    /// comment for the full shape) whose underlying target accepts a connection/session but never sends a
    /// definitive response to a write/command — mirroring <see cref="CreateUnresponsiveDeviceAsync"/>'s own
    /// "real, portable, loopback-only silent peer" rationale exactly, for the write side. Only ever called
    /// from a Check_Write_* method, so an override that only implements <see cref="IWritableDeviceDriver"/>
    /// members meaningfully (never <see cref="IDeviceDriver.ReadAsync"/>-dependent behaviour) is completely
    /// fine — none of the write checks read from <paramref name="Driver"/>.
    ///
    /// <para><b>The driver's OWN internal write/command timeout should be configured SHORT</b> (a few hundred
    /// milliseconds to a couple of seconds — well under <see cref="WriteBudget"/>) so
    /// <see cref="Check_Write_TimedOutWriteOrCommand_ReturnsIndeterminate_NeverThrows"/> and its siblings,
    /// which deliberately issue a call with NO cancellation at all and wait for the driver's own bound to
    /// elapse, complete quickly rather than waiting out a multi-second-or-unbounded production default.</para>
    ///
    /// <para><b>Virtual, not abstract — deliberately.</b> A read-only <see cref="IDeviceDriver"/> (the
    /// overwhelming majority of drivers, per <see cref="IWritableDeviceDriver"/>'s own doc comment) has no
    /// writable target to build one of these against at all, and this class's own "applicability, not a gap"
    /// design means such a driver's Check_Write_* obligations disappear entirely (see
    /// <see cref="EveryCheckIsWiredOrAcknowledged"/>) — so this hook is never actually CALLED for one. Making
    /// it <see langword="abstract"/> would force every existing read-only conformance test class, and every
    /// existing read-side negative-control harness, to implement a hook they can never meaningfully satisfy
    /// and will never be asked to use, purely to keep compiling — exactly the boilerplate-for-no-reason the
    /// applicability mechanism exists to avoid. The default throws loudly (never silently returns a
    /// nonsensical session) so a writable driver's author who forgets to override this gets an immediate,
    /// clear failure the first time a Check_Write_* check actually calls it, rather than some confusing
    /// downstream symptom.</para>
    /// </summary>
    protected virtual Task<UnresponsiveWritableDeviceSession> CreateUnresponsiveWritableDeviceAsync() =>
        throw new NotSupportedException(
            $"{GetType().Name} must override {nameof(CreateUnresponsiveWritableDeviceAsync)} — its own " +
            $"{nameof(CreateDriver)} returns an {nameof(IWritableDeviceDriver)}, so at least one Check_Write_* " +
            "check needs a writable target that never completes a write/command.");

    // ---- wiring enforcement (task-6-report.md "Fix round 1", IMPORTANT 3) --------------------------

    private const string CheckMethodPrefix = "Check_";

    /// <summary>Task B-7 — every <c>Check_*</c> name that belongs to the WRITE contract, minus the shared
    /// <see cref="CheckMethodPrefix"/>, starts with this. Used by <see cref="FindUnwiredAndUnacknowledgedChecks"/>
    /// to exempt them entirely for a driver that does not implement <see cref="IWritableDeviceDriver"/> —
    /// see this class's own "Applicability, not a gap" remarks above.</summary>
    private const string WriteCheckInfix = "Write_";

    /// <summary>
    /// <see langword="false"/> only for a harness that exists purely to let a negative-control test manually
    /// invoke ONE specific check method against a known-non-conforming fake (see
    /// <c>tests/St4i.Connector.Conformance.Tests/Fakes/FakeDriverHarnesses.cs</c>) — such a harness is never
    /// meant to wire every check as a <c>[Fact]</c> (most checks would incidentally also reject its fake,
    /// which is not what it exists to prove, and <see cref="EveryCheckIsWiredOrAcknowledged"/> would
    /// otherwise report a pile of "missing" checks that are not real conformance gaps). Every driver ACTUALLY
    /// being conformance-tested (the default, and what every real-driver <c>*ConformanceTests</c> class is)
    /// leaves this <see langword="true"/>, and full coverage is enforced for it.
    /// </summary>
    protected virtual bool IsConformanceTarget => true;

    /// <summary>
    /// Names (matching a <c>Check_*</c> method minus its "Check_" prefix — e.g.
    /// "ReadAsync_HonoursCancellation_WhenNoDeviceIsReachable") of checks this subclass deliberately does
    /// NOT wire as a passing <c>[Fact]</c>. Use this ONLY for a genuine, reported finding (a <c>KnownGap_*</c>
    /// test pinning real, currently-broken driver behaviour — see task-6-report.md §5) — never as a way to
    /// quietly skip a check that is merely inconvenient.
    ///
    /// <para><b>Small doc correction (batch review): a stale/misspelled entry here is NOT itself validated.</b>
    /// <see cref="EveryCheckIsWiredOrAcknowledged"/>/<see cref="FindUnwiredAndUnacknowledgedChecks"/> only
    /// subtract this set from the REAL <c>Check_*</c> names to find what's still missing — a name in here
    /// that doesn't match any real check is simply inert (it matches nothing, so it neither hides a genuine
    /// gap nor is itself flagged as wrong). This fails SAFE — a real unwired check is still reported
    /// regardless — but nothing here actually detects the stale entry itself; that would need a separate,
    /// currently-unwritten check.</para>
    /// </summary>
    protected virtual ISet<string> AcknowledgedGaps { get; } = new HashSet<string>();

    /// <summary>
    /// Pure function backing <see cref="EveryCheckIsWiredOrAcknowledged"/> — exposed separately so a
    /// negative-control test can prove this detection logic has teeth without needing to instantiate a
    /// "live", xunit-auto-discoverable, deliberately-incomplete conformance test class (which would itself
    /// become a permanently-failing test the moment xunit discovered it).
    ///
    /// <para><b>Task B-7 — <paramref name="includeWriteChecks"/>, the applicability mechanism.</b> When
    /// <see langword="false"/> (a driver that does not implement <see cref="IWritableDeviceDriver"/> — see
    /// <see cref="EveryCheckIsWiredOrAcknowledged"/>'s own instance-level test of <c>CreateDriver()</c>'s
    /// runtime type), every <c>Check_Write_*</c> name is dropped from consideration ENTIRELY — not counted as
    /// missing, not requiring an <see cref="AcknowledgedGaps"/> entry either. This is deliberately NOT the
    /// same mechanism as <see cref="AcknowledgedGaps"/>: an acknowledged gap documents a check that DOES apply
    /// but is currently, genuinely broken (a <c>KnownGap_*</c> test pins the real failing behaviour); a
    /// write-capable-only check on a read-only driver does not apply AT ALL — there is no failing behaviour to
    /// pin, because there is no write capability for it to describe. Conflating the two would force every
    /// read-only driver author (the overwhelming majority, per the brief) to recite a boilerplate
    /// "AcknowledgedGaps" entry for a capability their driver was never meant to have — exactly the kind of
    /// false "known-broken" signal <see cref="AcknowledgedGaps"/>'s own doc comment reserves for a genuine
    /// finding, not a correct absence.</para>
    /// </summary>
    public static IReadOnlyList<string> FindUnwiredAndUnacknowledgedChecks(
        Type concreteType, IEnumerable<string> acknowledgedGaps, bool includeWriteChecks = true)
    {
        var checkNames = typeof(DeviceDriverConformanceSuite)
            .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(m => m.Name.StartsWith(CheckMethodPrefix, StringComparison.Ordinal) && m.GetParameters().Length == 0)
            .Select(m => m.Name[CheckMethodPrefix.Length..])
            .Where(n => includeWriteChecks || !n.StartsWith(WriteCheckInfix, StringComparison.Ordinal));

        var wiredFactNames = concreteType
            .GetMethods(BindingFlags.Public | BindingFlags.Instance)
            .Where(m => m.GetCustomAttribute<FactAttribute>() is not null)
            .Select(m => m.Name)
            .ToHashSet(StringComparer.Ordinal);

        var acknowledged = acknowledgedGaps.ToHashSet(StringComparer.Ordinal);

        return checkNames.Where(n => !wiredFactNames.Contains(n) && !acknowledged.Contains(n)).ToArray();
    }

    /// <summary>Enforces that THIS concrete subclass gives every check declared on the base class an
    /// explicit fate (wired or acknowledged) — see this class's own doc comment's "third trap" remarks. A
    /// negative-control harness (<see cref="IsConformanceTarget"/> = <see langword="false"/>) is exempt: it
    /// exists to invoke individual checks manually, not to demonstrate full coverage.
    ///
    /// <para><b>Task B-7 — applicability, determined the SAME way a real host is documented to.</b>
    /// <see cref="IWritableDeviceDriver"/>'s own doc comment says a host asks "can this driver write?" by
    /// testing an already-live <see cref="IDeviceDriver"/> reference — <c>if (driver is
    /// IWritableDeviceDriver)</c> — never by assuming or requiring it of any particular driver. This test does
    /// EXACTLY that against <see cref="CreateDriver"/>'s own return value, so a read-only driver's
    /// <c>Check_Write_*</c> obligations disappear entirely (see <see cref="FindUnwiredAndUnacknowledgedChecks"/>'s
    /// own doc comment) while a writable one's do not — without this class needing a second, parallel
    /// "declare whether you write" flag that could drift out of sync with what <see cref="CreateDriver"/>
    /// actually returns.</para>
    /// </summary>
    [Fact]
    public async Task EveryCheckIsWiredOrAcknowledged()
    {
        if (!IsConformanceTarget) return;

        var isWritable = await IsWriteCapableAsync();
        var missing = FindUnwiredAndUnacknowledgedChecks(GetType(), AcknowledgedGaps, isWritable);

        Assert.True(
            missing.Count == 0,
            $"{GetType().Name} silently omits conformance coverage for: {string.Join(", ", missing)}. Every " +
            $"Check_* method on {nameof(DeviceDriverConformanceSuite)} must be wired as a [Fact] method named " +
            "identically (minus the \"Check_\" prefix) or listed in AcknowledgedGaps with a reason (e.g. a " +
            "KnownGap_* test pinning real, currently-broken behaviour). Check_Write_* methods only apply at " +
            "all when CreateDriver() returns an IWritableDeviceDriver — see this method's own doc comment.");
    }

    /// <summary>Task B-7 — builds ONE driver via <see cref="CreateDriver"/> purely to test it for
    /// <see cref="IWritableDeviceDriver"/>, then disposes it immediately. <see cref="CreateDriver"/>'s own
    /// contract (non-blocking, no I/O) makes this cheap enough to pay on every run of this wiring check.</summary>
    private async Task<bool> IsWriteCapableAsync()
    {
        var driver = CreateDriver();
        try
        {
            return driver is IWritableDeviceDriver;
        }
        finally
        {
            await driver.DisposeAsync().ConfigureAwait(false);
        }
    }

    // ---- checks -------------------------------------------------------------------------------------

    /// <summary>Enforces: "Construction is non-blocking and does not connect" — every real driver's own
    /// class doc comment documents this (e.g. <c>ModbusTcpDriver</c>/<c>OpcUaDriver</c>: "ctor never
    /// connects — non-blocking, like every other driver's ctor"). A slow constructor would stall
    /// <c>FleetHost.StartLocked</c>, which runs under the SAME lock <c>Estop()</c> takes.
    ///
    /// <para>Two INDEPENDENT assertions, not one — task-6-report.md "Fix round 1" (the reviewer's own cheap
    /// fold): elapsed-time alone only proves the constructor is FAST, not that it performed no I/O — a
    /// constructor that dials a fast LOCAL device would pass a timing-only check. For a device-backed driver
    /// (<see cref="ModelsExternalDeviceConnection"/>), a cheap-but-real proxy for "didn't already connect" is
    /// that <see cref="IDeviceDriver.Health"/> is not yet <see cref="DriverHealthState.Connected"/> the
    /// instant construction returns — a driver whose constructor already established a connection would fail
    /// this even if it happened to do so quickly.</para>
    /// </summary>
    public virtual async Task Check_Construction_IsNonBlocking_AndPerformsNoIO()
    {
        // Warm-up call, NOT measured — absorbs one-time JIT/static-initializer/cert-store cost so it can
        // never be mistaken for genuine per-instance I/O.
        await using (var warm = CreateDriver())
        {
            _ = warm;
        }

        var sw = Stopwatch.StartNew();
        var driver = CreateDriver();
        sw.Stop();

        try
        {
            Assert.True(
                sw.Elapsed < ConstructionBudget,
                $"constructing the driver took {sw.Elapsed}, exceeding the {ConstructionBudget} non-blocking " +
                "budget. IDeviceDriver's contract documents construction as non-blocking with no I/O — " +
                "FleetHost.StartLocked constructs drivers under the same _gate lock Estop() takes, so a slow " +
                "constructor blocks Estop() itself from returning for as long as it takes. (Estop() is a " +
                "supervisory software halt of this codebase's own read pipeline, not a machine safety " +
                "function — see FleetHost.Estop's own doc comment — so this rule protects THAT call's " +
                "latency, nothing more.)");

            if (ModelsExternalDeviceConnection)
            {
                Assert.True(
                    driver.Health != DriverHealthState.Connected,
                    $"Health was already {driver.Health} the instant construction returned — a device-backed " +
                    "driver's constructor must not establish a connection at all (see " +
                    "ModelsExternalDeviceConnection), so Health must not already be Connected here, no matter " +
                    "how fast that connection was made.");
            }
        }
        finally
        {
            await driver.DisposeAsync().ConfigureAwait(false);
        }
    }

    /// <summary>Enforces: "Id and Kind are non-empty and stable across the driver's lifetime (they key slot
    /// labels and, through those, alarms)".</summary>
    public virtual async Task Check_Id_And_Kind_AreNonEmpty_AndStableAcrossLifetime()
    {
        await using var driver = CreateDriver();

        var id = driver.Id;
        var kind = driver.Kind;
        Assert.False(string.IsNullOrWhiteSpace(id), "Id must be a non-empty, non-whitespace string.");
        Assert.False(string.IsNullOrWhiteSpace(kind), "Kind must be a non-empty, non-whitespace string.");

        // Exercise some lifecycle (a Health read, a brief cancelled enumeration) and confirm neither moved.
        _ = driver.Health;
        using (var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(200)))
        {
            try
            {
                await foreach (var _ in driver.ReadAsync(cts.Token).ConfigureAwait(false)) { }
            }
            catch (OperationCanceledException) { /* documented-acceptable outcome of cancellation */ }
        }

        Assert.Equal(id, driver.Id);
        Assert.Equal(kind, driver.Kind);

        await driver.DisposeAsync().ConfigureAwait(false);

        // Stable even post-dispose — a slot label/alarm referencing this driver's Id must remain
        // meaningful even after the slot has been torn down.
        Assert.Equal(id, driver.Id);
        Assert.Equal(kind, driver.Kind);
    }

    /// <summary>Enforces: "Health only takes documented values and its transitions are sane for the driver's
    /// actual situation (a driver with no reachable device must not report Connected)." For a driver with NO
    /// external device concept at all (<see cref="ModelsExternalDeviceConnection"/> = <see
    /// langword="false"/>), that specific example doesn't apply — such a driver's own doc comment is expected
    /// to document its actual (constant) Health contract instead, checked against
    /// <see cref="ExpectedConstantHealthWhenDeviceLess"/> (falsifiably — see that property's own doc comment
    /// for why a plain before/after comparison is NOT, per task-6-report.md "Fix round 1" IMPORTANT 2).
    ///
    /// <para><b>Device-backed branch, two independent mechanisms</b> (IMPORTANT 1 of the same review round —
    /// this check previously drove <see cref="CreateDriver"/>'s FAST-failing target here, against which
    /// neither real protocol driver ever yields a single reading, leaving the loop below dead code no
    /// currently-wired test ever exercised): (1) <c>sawConnected</c>, checked on every yielded reading
    /// throughout the whole drive — catches a driver that reports <see cref="DriverHealthState.Connected"/>
    /// TRANSIENTLY and something else by the time enumeration ends; (2) the final single-sample assertion —
    /// catches a driver that is simply, persistently wrong.</para>
    ///
    /// <para><b>Small doc correction (batch review):</b> <c>ReusesReadingInstanceHarness</c>/
    /// <c>MutatesSharedTelemetryListHarness</c> (both device-backed fakes that DO yield readings while
    /// reporting Connected) prove only that this loop body ISN'T dead code — their own Health is a CONSTANT
    /// Connected, so <c>NegativeControlTests</c>' own "Honesty note" on those two controls explicitly
    /// retracts any claim that they isolate <c>sawConnected</c> specifically (the final single-sample
    /// assertion alone would already catch a driver that is Connected the WHOLE time). <c>sawConnected</c>'s
    /// OWN independent load-bearing-ness is proven by <c>TransientlyConnectedThenDownFakeDriver</c> alone
    /// (Connected only for a short window, then Down for the rest of the drive — the final single-sample
    /// assertion would miss that transient violation entirely; only <c>sawConnected</c> catches it).</para>
    /// </summary>
    public virtual async Task Check_Health_OnlyTakesDocumentedValues_AndIsSaneWithNoDevice()
    {
        await using var driver = CreateDriver();

        Assert.True(
            Enum.IsDefined(driver.Health),
            $"Health returned {driver.Health}, which is not one of DriverHealthState's documented members.");

        if (!ModelsExternalDeviceConnection)
        {
            Assert.True(
                driver.Health == ExpectedConstantHealthWhenDeviceLess,
                $"a device-less driver's Health was {driver.Health}, not the {ExpectedConstantHealthWhenDeviceLess} " +
                "its own class doc comment is expected to document as the constant value it always reports.");

            using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));
            try
            {
                await foreach (var _ in driver.ReadAsync(cts.Token).ConfigureAwait(false)) { }
            }
            catch (OperationCanceledException) { }

            Assert.True(
                driver.Health == ExpectedConstantHealthWhenDeviceLess,
                $"a device-less driver's Health drifted to {driver.Health} after some activity — its own " +
                $"class doc comment is expected to document Health as the CONSTANT {ExpectedConstantHealthWhenDeviceLess}, " +
                "with no external link to lose at all.");
            return;
        }

        using var driveCts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        var sawConnected = false;
        try
        {
            await foreach (var _ in driver.ReadAsync(driveCts.Token).ConfigureAwait(false))
            {
                if (driver.Health == DriverHealthState.Connected) sawConnected = true;
            }
        }
        catch (OperationCanceledException) { }

        Assert.False(sawConnected, "Health reported Connected at some point even though no device was ever reachable.");
        Assert.NotEqual(DriverHealthState.Connected, driver.Health);
    }

    /// <summary>
    /// Enforces: "<c>ReadAsync</c> honours cancellation — cancelling the token must end the enumeration
    /// promptly ... This must hold when no device is reachable" — the single most important check in this
    /// suite (see task-6-brief.md/task-6-report.md): a driver stuck in a connect-retry loop that ignores its
    /// token cannot be stopped, and <c>FleetHost</c>'s teardown waits on it with only a bounded budget
    /// (<see cref="CancellationBudget"/> mirrors that real budget with margin) before giving up and moving on
    /// with the task orphaned.
    /// </summary>
    public virtual async Task Check_ReadAsync_HonoursCancellation_WhenNoDeviceIsReachable()
    {
        var session = await CreateUnresponsiveDeviceAsync().ConfigureAwait(false);
        Task runTask;
        try
        {
            using var cts = new CancellationTokenSource();
            runTask = RunUntilStoppedAsync(session.Driver, cts.Token);

            // Let a connect/request attempt actually get in flight before cancelling — cancelling before
            // anything has started would prove nothing about interrupting an IN-PROGRESS attempt.
            await Task.Delay(TimeSpan.FromMilliseconds(500)).ConfigureAwait(false);
            cts.Cancel();

            var finishedInTime = await Task.WhenAny(runTask, Task.Delay(CancellationBudget)).ConfigureAwait(false) == runTask;

            Assert.True(
                finishedInTime,
                $"ReadAsync did not end within {CancellationBudget} of the token being cancelled while no " +
                "device was reachable. IDeviceDriver.ReadAsync's contract documents cancellation as ending " +
                "the enumeration promptly (either completing or throwing OperationCanceledException); " +
                "FleetHost's own teardown only waits a few seconds for this before giving up and moving on, " +
                "orphaning the background task.");
        }
        finally
        {
            await session.ForceUnstickAsync().ConfigureAwait(false);
            await session.Driver.DisposeAsync().ConfigureAwait(false);
        }
    }

    /// <summary>Enforces: "<c>DisposeAsync</c> is idempotent and safe to call ... without ever having
    /// enumerated at all. It must not throw."</summary>
    public virtual async Task Check_DisposeAsync_IsIdempotent_WithoutEverEnumerating()
    {
        var driver = CreateDriver();
        await AssertDisposeIsFastAndDoesNotThrowAsync(driver).ConfigureAwait(false);
        await AssertDisposeIsFastAndDoesNotThrowAsync(driver).ConfigureAwait(false);
    }

    /// <summary>Enforces: "<c>DisposeAsync</c> is idempotent and safe to call after cancellation ... It must
    /// not throw." Deliberately does NOT wait for the background enumeration task to confirm completion
    /// before disposing — <c>FleetHost</c>'s real teardown disposes on a bounded budget regardless of
    /// whether the run task has confirmed completion yet, so this is the racing-with-in-flight-teardown
    /// scenario a live host can actually produce.</summary>
    public virtual async Task Check_DisposeAsync_IsIdempotent_AfterCancellation()
    {
        var driver = CreateDriver();
        using var cts = new CancellationTokenSource();
        var runTask = RunUntilStoppedAsync(driver, cts.Token);

        await Task.Delay(TimeSpan.FromMilliseconds(150)).ConfigureAwait(false);
        cts.Cancel();

        await AssertDisposeIsFastAndDoesNotThrowAsync(driver).ConfigureAwait(false);
        await AssertDisposeIsFastAndDoesNotThrowAsync(driver).ConfigureAwait(false);

        await SwallowAsync(runTask).ConfigureAwait(false);
    }

    /// <summary>Enforces: "<c>DisposeAsync</c> is idempotent and safe to call ... after a completed
    /// enumeration. It must not throw." Distinct from <see cref="Check_DisposeAsync_IsIdempotent_AfterCancellation"/>:
    /// this one REQUIRES the enumeration to have actually concluded (against <see cref="CreateDriver"/>'s
    /// fast-failing target) before disposing, rather than racing it.</summary>
    public virtual async Task Check_DisposeAsync_IsIdempotent_AfterCompletedEnumeration()
    {
        var driver = CreateDriver();
        using var cts = new CancellationTokenSource();
        var runTask = RunUntilStoppedAsync(driver, cts.Token);

        await Task.Delay(TimeSpan.FromMilliseconds(150)).ConfigureAwait(false);
        cts.Cancel();

        var completed = await Task.WhenAny(runTask, Task.Delay(CancellationBudget)).ConfigureAwait(false) == runTask;
        Assert.True(
            completed,
            $"the enumeration did not conclude within {CancellationBudget} of cancellation against " +
            "CreateDriver()'s fast-failing target, so this check cannot exercise 'dispose after a COMPLETED " +
            "enumeration' — see Check_ReadAsync_HonoursCancellation_WhenNoDeviceIsReachable for this driver's " +
            "own cancellation-responsiveness result.");

        await AssertDisposeIsFastAndDoesNotThrowAsync(driver).ConfigureAwait(false);
        await AssertDisposeIsFastAndDoesNotThrowAsync(driver).ConfigureAwait(false);
    }

    /// <summary>Enforces: "No <c>DeviceReading</c> instance reuse across yields ... A driver that pools or
    /// mutates a previously-yielded reading would corrupt data in a way that is extremely hard to trace" —
    /// checked two ways: (1) no two yielded top-level instances are reference-equal, and (2) the LOAD-BEARING
    /// assertion — every reading's own content, snapshotted the instant it was received, still matches its
    /// live state after later cycles have run (catches sub-object reuse/mutation that (1) alone would
    /// miss — e.g. a shared, later-mutated <c>List&lt;TelemetrySample&gt;</c> wrapped in a fresh
    /// <c>DeviceReading</c> each cycle).</summary>
    public virtual async Task Check_ReadAsync_NeverReusesOrMutatesAYieldedReading()
    {
        var seen = new List<(DeviceReading Live, DeviceReading Snapshot)>();
        var readings = await CollectReadingsAsync(
            ReadingsRequiredForReuseCheck,
            ReadingsCollectionTimeout,
            onYielded: r => seen.Add((r, DeviceReadingClone.Clone(r)))).ConfigureAwait(false);

        Assert.True(
            readings.Count >= ReadingsRequiredForReuseCheck,
            $"only collected {readings.Count} readings (need >= {ReadingsRequiredForReuseCheck}) to make this " +
            "check meaningful.");
        Assert.Equal(readings.Count, seen.Count);

        for (var i = 0; i < seen.Count; i++)
        {
            for (var j = i + 1; j < seen.Count; j++)
            {
                Assert.False(
                    ReferenceEquals(seen[i].Live, seen[j].Live),
                    $"reading #{i} and reading #{j} are the exact SAME DeviceReading instance — the driver is " +
                    "pooling/reusing a single instance across yields.");
            }
        }

        for (var i = 0; i < seen.Count; i++)
        {
            var diff = DeviceReadingEquality.Compare(seen[i].Snapshot, seen[i].Live, allowNumericWidening: false);
            Assert.True(
                diff is null,
                $"reading #{i} changed after being yielded ({diff}) — a consumer (e.g. EdgePipeline hands the " +
                "same reference to the UNS publisher, read later on a background thread, and to every " +
                "Committed subscriber) holds onto the exact reference it was handed; a driver that mutates or " +
                "pools a previously-yielded reading corrupts data that has already been delivered.");
        }
    }

    /// <summary>Enforces: "Telemetry survives a JSON round trip through <c>ConnectorJson</c> ... every value
    /// a driver emits must round-trip losslessly through the contract's canonical options" — the
    /// sidecar-readiness gate (GP-2). Compares by VALUE (see <see cref="DeviceReadingEquality"/>'s own doc
    /// comment on why), not by CLR type, and allows the documented numeric widening (int→long,
    /// float→double) rather than treating it as a failure.
    ///
    /// <para>Guards CONTENT, not just count (task-6-report.md "Fix round 1" cheap fold): a driver emitting
    /// readings with every value-bearing collection empty would satisfy "N readings round-tripped" having
    /// compared nothing meaningful — so this also requires at least one collected reading to actually carry
    /// SOME value in <see cref="Models.DeviceReading.Telemetry"/>/<see cref="Models.DeviceReading.Metrics"/>/
    /// <see cref="Models.DeviceReading.Measurements"/>/<see cref="Models.DeviceReading.Waveforms"/>/
    /// <see cref="Models.DeviceReading.Genealogy"/>.</para>
    /// </summary>
    public virtual async Task Check_Telemetry_RoundTripsLosslesslyThroughConnectorJson()
    {
        var readings = await CollectReadingsAsync(ReadingsRequiredForRoundTripCheck, ReadingsCollectionTimeout)
            .ConfigureAwait(false);

        Assert.True(
            readings.Count >= ReadingsRequiredForRoundTripCheck,
            $"only collected {readings.Count} readings (need >= {ReadingsRequiredForRoundTripCheck}) to make " +
            "this check meaningful.");

        Assert.True(
            readings.Any(HasAnyValueBearingContent),
            "every collected reading's Telemetry/Metrics/Measurements/Waveforms/Genealogy was empty — " +
            "round-tripping N readings with nothing in them would have compared no actual values, making " +
            "this check a silent no-op despite \"passing\".");

        for (var i = 0; i < readings.Count; i++)
        {
            var reading = readings[i];
            string? json = null;
            try
            {
                json = JsonSerializer.Serialize(reading, ConnectorJson.Options);
            }
            catch (JsonException ex)
            {
                Assert.Fail(
                    $"reading #{i} emitted a value outside the connector wire contract's documented domain " +
                    $"(GP-2) and could not be serialized: {ex.Message}");
            }

            DeviceReading? roundTripped = null;
            try
            {
                roundTripped = JsonSerializer.Deserialize<DeviceReading>(json!, ConnectorJson.Options);
            }
            catch (JsonException ex)
            {
                Assert.Fail(
                    $"reading #{i}'s own serialized JSON failed to deserialize back through ConnectorJson: " +
                    $"{ex.Message}\nJSON: {json}");
            }

            Assert.NotNull(roundTripped);
            var diff = DeviceReadingEquality.Compare(reading, roundTripped!, allowNumericWidening: true);
            Assert.True(diff is null, $"reading #{i} did not round-trip losslessly through ConnectorJson: {diff}\nJSON: {json}");
        }
    }

    // ---- write-contract checks (Task B-7, task-7-brief.md) -------------------------------------------
    //
    // Every check below is derived from IWritableDeviceDriver's own doc comments (see that interface's doc
    // comment for the full narrative these checks enforce piecemeal) — the read-side checks' own contract:
    // each one is proven, in tests/St4i.Connector.Conformance.Tests, to genuinely reject a deliberately
    // non-conforming fake driver, not merely to pass against conforming ones.

    /// <summary>Enforces: "MUST return Rejected WITHOUT touching the device at all for an unknown point" /
    /// "MUST return Rejected WITHOUT touching the device at all for an unknown command" (WriteSetpointAsync's
    /// and InvokeCommandAsync's own doc comments) — points and commands are NAMED, never raw addresses/codes,
    /// and an unrecognised name is the caller's mistake, never attempted against the device.</summary>
    public virtual async Task Check_Write_UnknownPointOrCommand_RejectedWithoutTouchingDevice()
    {
        await using var driver = CreateDriver();
        var writable = (IWritableDeviceDriver)driver;

        var unknownPoint = $"__conformance-unknown-point-{Guid.NewGuid():N}";
        var (pointResult, pointThrown) = await TryWriteSetpointAsync(
            writable, new SetpointWriteRequest(unknownPoint, 0.0), CancellationToken.None).ConfigureAwait(false);
        Assert.True(pointThrown is null, $"WriteSetpointAsync threw for an unknown point instead of rejecting it: {pointThrown}");
        Assert.NotNull(pointResult);
        Assert.Equal(WriteOutcome.Rejected, pointResult!.Outcome);
        Assert.Equal(SetpointRejectionReason.UnknownPoint, pointResult.RejectionReason);

        var unknownCommand = $"__conformance-unknown-command-{Guid.NewGuid():N}";
        var (commandResult, commandThrown) = await TryInvokeCommandAsync(
            writable, new CommandRequest(unknownCommand), CancellationToken.None).ConfigureAwait(false);
        Assert.True(commandThrown is null, $"InvokeCommandAsync threw for an unknown command instead of rejecting it: {commandThrown}");
        Assert.NotNull(commandResult);
        Assert.Equal(WriteOutcome.Rejected, commandResult!.Outcome);
        Assert.Equal(CommandRejectionReason.UnknownCommand, commandResult.RejectionReason);
    }

    /// <summary>Enforces: "Setpoint write and command invocation are two distinct operations... Do not add a
    /// third member that tries to do both" (IWritableDeviceDriver's own class doc comment) — carried down to
    /// the NAME level this check actually exercises: a command's own declared name must not be acceptable as
    /// a <c>WriteSetpointAsync</c> point, and a point's own declared name must not be acceptable as an
    /// <c>InvokeCommandAsync</c> command. The two vocabularies are separate namespaces, not one shared
    /// pool.</summary>
    public virtual async Task Check_Write_SetpointAndCommandNamespaces_AreDistinct()
    {
        await using var driver = CreateDriver();
        var writable = (IWritableDeviceDriver)driver;

        Assert.True(writable.WritablePoints.Count > 0,
            "this check needs at least one declared writable point to cross-check against Commands — override CreateDriver() to declare one.");
        Assert.True(writable.Commands.Count > 0,
            "this check needs at least one declared command to cross-check against WritablePoints — override CreateDriver() to declare one.");

        var commandName = writable.Commands[0];
        var pointName = writable.WritablePoints[0];
        Assert.NotEqual(commandName, pointName);

        var (crossPointResult, crossPointThrown) = await TryWriteSetpointAsync(
            writable, new SetpointWriteRequest(commandName, 0.0), CancellationToken.None).ConfigureAwait(false);
        Assert.True(crossPointThrown is null, $"WriteSetpointAsync threw when given a COMMAND's own name as a point: {crossPointThrown}");
        Assert.NotNull(crossPointResult);
        Assert.Equal(WriteOutcome.Rejected, crossPointResult!.Outcome);
        Assert.Equal(SetpointRejectionReason.UnknownPoint, crossPointResult.RejectionReason);

        var (crossCommandResult, crossCommandThrown) = await TryInvokeCommandAsync(
            writable, new CommandRequest(pointName), CancellationToken.None).ConfigureAwait(false);
        Assert.True(crossCommandThrown is null, $"InvokeCommandAsync threw when given a POINT's own name as a command: {crossCommandThrown}");
        Assert.NotNull(crossCommandResult);
        Assert.Equal(WriteOutcome.Rejected, crossCommandResult!.Outcome);
        Assert.Equal(CommandRejectionReason.UnknownCommand, crossCommandResult.RejectionReason);
    }

    /// <summary>Enforces <see cref="Models.IWritableDeviceDriver.WritablePoints"/>/<see cref="Models.IWritableDeviceDriver.Commands"/>'s
    /// own doc comment: "fixed for the lifetime of this instance"/"effectively immutable... never a live view
    /// a caller could observe changing". Task B-4 shipped these as the underlying <c>List&lt;string&gt;</c>
    /// cast to <c>IReadOnlyList&lt;string&gt;</c> — downcastable and mutable — and a reviewer caught it; this
    /// check reproduces exactly that downcast-and-mutate attempt against BOTH the <c>Add</c> and the indexer-
    /// set paths, so it catches a raw mutable list AND any other still-mutable collection shape, not only the
    /// one specific type that shipped.</summary>
    public virtual async Task Check_Write_CapabilityLists_AreEffectivelyImmutable()
    {
        await using var driver = CreateDriver();
        var writable = (IWritableDeviceDriver)driver;

        AssertCapabilityListIsImmutable(writable.WritablePoints, nameof(IWritableDeviceDriver.WritablePoints));
        AssertCapabilityListIsImmutable(writable.Commands, nameof(IWritableDeviceDriver.Commands));
    }

    /// <summary>Enforces: "A timed-out write returns Indeterminate; it does not throw" — the single most
    /// consequential invariant in the write contract (task-7-brief.md): after a timeout the driver genuinely
    /// does not know whether the device applied the write, and that uncertainty can ONLY reach the caller
    /// through the returned result, never through a thrown exception. Exercised against BOTH operations —
    /// <c>InvokeCommandAsync</c> is the higher-risk one (IWritableDeviceDriver's own doc comment: "a command
    /// CAN trigger real, physical motion"), but the "never throws" rule binds both equally.</summary>
    public virtual async Task Check_Write_TimedOutWriteOrCommand_ReturnsIndeterminate_NeverThrows()
    {
        var session = await CreateUnresponsiveWritableDeviceAsync().ConfigureAwait(false);
        try
        {
            var writeCall = session.Driver.WriteSetpointAsync(
                new SetpointWriteRequest(session.WritablePoint, session.ValidPointValue), CancellationToken.None);
            var (writeResult, writeThrown, writeInTime) = await AwaitWithBudgetAsync(writeCall, WriteBudget).ConfigureAwait(false);
            Assert.True(writeInTime,
                $"WriteSetpointAsync against a target that never responds did not return within {WriteBudget} — " +
                "configure CreateUnresponsiveWritableDeviceAsync()'s own driver with a SHORT internal write " +
                "timeout so a genuine (uncancelled) timeout resolves well within this budget.");
            Assert.True(writeThrown is null,
                $"WriteSetpointAsync threw {writeThrown} for a timed-out write instead of returning Indeterminate " +
                "— IWritableDeviceDriver's contract forbids letting any exception propagate from a write.");
            Assert.Equal(WriteOutcome.Indeterminate, writeResult!.Outcome);

            var commandCall = session.Driver.InvokeCommandAsync(
                new CommandRequest(session.Command, session.CommandArguments), CancellationToken.None);
            var (commandResult, commandThrown, commandInTime) = await AwaitWithBudgetAsync(commandCall, WriteBudget).ConfigureAwait(false);
            Assert.True(commandInTime, $"InvokeCommandAsync against a target that never responds did not return within {WriteBudget}.");
            Assert.True(commandThrown is null,
                $"InvokeCommandAsync threw {commandThrown} for a timed-out command instead of returning " +
                "Indeterminate — the higher-risk of the two operations, per the interface's own doc comment.");
            Assert.Equal(WriteOutcome.Indeterminate, commandResult!.Outcome);
        }
        finally
        {
            await session.ForceUnstickAsync().ConfigureAwait(false);
            await session.Driver.DisposeAsync().ConfigureAwait(false);
        }
    }

    /// <summary>Enforces: "Indeterminate's Detail tells an operator what to check" (task-7-brief.md) — a
    /// requirement the brief itself says a bare non-empty check misses: B-4 shipped a path where a generic
    /// exception string replaced the one message saying a COIL had been left latched ON (a cancellation
    /// racing <c>InvokeCommandAsync</c>'s own reset half), and B-5 shipped one where a malformed NodeId
    /// produced "unexpected failure: Cannot parse node id text..." for a call that provably never left the
    /// process (affecting BOTH <c>WriteSetpointAsync</c> and <c>InvokeCommandAsync</c>) — both are the SAME
    /// failure shape, a genuinely-authored, situational message getting silently replaced by generic/canned
    /// text. Exercised against BOTH operations, not just the setpoint one, specifically because the FIRST of
    /// those two regressions lived in the COMMAND path. Without over-fitting to any one driver's wording (the
    /// brief's own instruction), the closest falsifiable proxy that does not hard-code any vocabulary is:
    /// Detail must be non-empty for EVERY Indeterminate cause, AND two genuinely different causes (an
    /// uncancelled internal timeout vs. a caller-initiated cancellation) must not produce the IDENTICAL Detail
    /// text FOR THE SAME OPERATION — a driver that funnels every Indeterminate through one fixed, generic
    /// message (this check's own negative control: <c>AlwaysSameDetailWritableFakeDriver</c>) fails this,
    /// while either real driver's own genuinely situational wording passes it.</summary>
    public virtual async Task Check_Write_Indeterminate_DetailIsNonEmpty_AndDistinguishesDistinctCauses()
    {
        var session = await CreateUnresponsiveWritableDeviceAsync().ConfigureAwait(false);
        try
        {
            // Setpoint write — Cause 1 (a genuine, UNCANCELLED timeout) vs. Cause 2 (genuine CALLER-initiated
            // cancellation, well before the driver's own internal timeout).
            var setpointTimeout = await RunIndeterminateSetpointWriteAsync(session, CancellationToken.None).ConfigureAwait(false);
            AssertDetailIsNonEmpty(setpointTimeout.Detail, "a genuine (uncancelled) setpoint write timeout");

            using var setpointCts = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));
            var setpointCancel = await RunIndeterminateSetpointWriteAsync(session, setpointCts.Token).ConfigureAwait(false);
            AssertDetailIsNonEmpty(setpointCancel.Detail, "a genuine setpoint write cancellation");

            Assert.NotEqual(setpointTimeout.Detail, setpointCancel.Detail);

            // InvokeCommandAsync — the SAME two-cause comparison, on the operation where the actual B-4
            // regression this check targets lived (a coil pulse's reset half, cancelled mid-flight).
            var commandTimeout = await RunIndeterminateCommandAsync(session, CancellationToken.None).ConfigureAwait(false);
            AssertDetailIsNonEmpty(commandTimeout.Detail, "a genuine (uncancelled) command timeout");

            using var commandCts = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));
            var commandCancel = await RunIndeterminateCommandAsync(session, commandCts.Token).ConfigureAwait(false);
            AssertDetailIsNonEmpty(commandCancel.Detail, "a genuine command cancellation");

            Assert.NotEqual(commandTimeout.Detail, commandCancel.Detail);
        }
        finally
        {
            await session.ForceUnstickAsync().ConfigureAwait(false);
            await session.Driver.DisposeAsync().ConfigureAwait(false);
        }
    }

    private async Task<SetpointWriteResult> RunIndeterminateSetpointWriteAsync(UnresponsiveWritableDeviceSession session, CancellationToken ct)
    {
        var call = session.Driver.WriteSetpointAsync(new SetpointWriteRequest(session.WritablePoint, session.ValidPointValue), ct);
        var (result, thrown, inTime) = await AwaitWithBudgetAsync(call, WriteBudget).ConfigureAwait(false);
        Assert.True(inTime, $"WriteSetpointAsync against an unresponsive target did not return within {WriteBudget}.");
        Assert.True(thrown is null, $"WriteSetpointAsync threw {thrown} instead of returning Indeterminate.");
        Assert.Equal(WriteOutcome.Indeterminate, result!.Outcome);
        return result;
    }

    private async Task<CommandResult> RunIndeterminateCommandAsync(UnresponsiveWritableDeviceSession session, CancellationToken ct)
    {
        var call = session.Driver.InvokeCommandAsync(new CommandRequest(session.Command, session.CommandArguments), ct);
        var (result, thrown, inTime) = await AwaitWithBudgetAsync(call, WriteBudget).ConfigureAwait(false);
        Assert.True(inTime, $"InvokeCommandAsync against an unresponsive target did not return within {WriteBudget}.");
        Assert.True(thrown is null, $"InvokeCommandAsync threw {thrown} instead of returning Indeterminate.");
        Assert.Equal(WriteOutcome.Indeterminate, result!.Outcome);
        return result;
    }

    private static void AssertDetailIsNonEmpty(string? detail, string scenario) =>
        Assert.False(
            string.IsNullOrWhiteSpace(detail),
            $"an Indeterminate result's Detail was null/blank for {scenario} — an operator standing next to " +
            "the machine is told nothing at all to check.");

    /// <summary>Enforces: "No implicit retries, ever, for any reason, including a timeout" (IWritableDeviceDriver's
    /// own doc comment), checked against the highest-risk operation the SAME doc comment names explicitly:
    /// "the no-retry rule matters MOST here [InvokeCommandAsync]: a retried command can physically re-fire
    /// whatever it just triggered." Task B-4 found this could be violated entirely BENEATH the driver's own
    /// code (NModbus's transport-level <c>Retries</c> silently resending an unacknowledged write) — the
    /// driver's own return value cannot prove this either way, so this check counts attempts observed from
    /// OUTSIDE the driver (<see cref="UnresponsiveWritableDeviceSession.CommandAttemptsReachingDevice"/>),
    /// exactly the class of bug the brief calls out.</summary>
    public virtual async Task Check_Write_NoImplicitRetry_ExactlyOneCommandAttemptReachesTheDeviceOnTimeout()
    {
        var session = await CreateUnresponsiveWritableDeviceAsync().ConfigureAwait(false);
        try
        {
            var before = session.CommandAttemptsReachingDevice();

            var call = session.Driver.InvokeCommandAsync(
                new CommandRequest(session.Command, session.CommandArguments), CancellationToken.None);
            var (result, thrown, inTime) = await AwaitWithBudgetAsync(call, WriteBudget).ConfigureAwait(false);
            Assert.True(inTime, $"InvokeCommandAsync against a target that never responds did not return within {WriteBudget}.");
            Assert.True(thrown is null, $"InvokeCommandAsync threw {thrown} for a timed-out command instead of returning Indeterminate.");
            Assert.Equal(WriteOutcome.Indeterminate, result!.Outcome);

            // Generous extra wait so a delayed server-side handler settles AND a would-be retried second
            // attempt has every opportunity to show up before the count is trusted — mirrors
            // ModbusTcpDriverWriteTests' own "generous extra wait" no-retry proof technique.
            if (session.AttemptCountSettleDelay > TimeSpan.Zero)
            {
                await Task.Delay(session.AttemptCountSettleDelay).ConfigureAwait(false);
            }

            var after = session.CommandAttemptsReachingDevice();
            Assert.Equal(1, after - before);
        }
        finally
        {
            await session.ForceUnstickAsync().ConfigureAwait(false);
            await session.Driver.DisposeAsync().ConfigureAwait(false);
        }
    }

    /// <summary>Enforces: "Cancellation must be honoured promptly, same as IDeviceDriver.ReadAsync" (IWritableDeviceDriver's
    /// own doc comment) — the write-contract mirror of <see cref="Check_ReadAsync_HonoursCancellation_WhenNoDeviceIsReachable"/>,
    /// against the SAME kind of realistic target (transport-reachable, never responds) rather than a
    /// fast-failing one.</summary>
    public virtual async Task Check_Write_Cancellation_HonouredPromptly_EvenAgainstAnUnresponsiveDevice()
    {
        var session = await CreateUnresponsiveWritableDeviceAsync().ConfigureAwait(false);
        try
        {
            using var cts = new CancellationTokenSource();
            var call = session.Driver.WriteSetpointAsync(
                new SetpointWriteRequest(session.WritablePoint, session.ValidPointValue), cts.Token);

            // Let the attempt actually get in flight before cancelling — same reasoning as the read-side check.
            await Task.Delay(TimeSpan.FromMilliseconds(200)).ConfigureAwait(false);
            cts.Cancel();

            var (result, thrown, inTime) = await AwaitWithBudgetAsync(call, CancellationBudget).ConfigureAwait(false);
            Assert.True(
                inTime,
                $"WriteSetpointAsync did not end within {CancellationBudget} of the token being cancelled while " +
                "writing to an unresponsive device.");
            Assert.True(thrown is null, $"WriteSetpointAsync threw {thrown} on cancellation instead of returning Indeterminate.");
            Assert.Equal(WriteOutcome.Indeterminate, result!.Outcome);
        }
        finally
        {
            await session.ForceUnstickAsync().ConfigureAwait(false);
            await session.Driver.DisposeAsync().ConfigureAwait(false);
        }
    }

    /// <summary>Enforces: "Every result round-trips losslessly through ConnectorJson — including Indeterminate
    /// and every rejection reason" (task-7-brief.md), the write-contract mirror of
    /// <see cref="Check_Telemetry_RoundTripsLosslesslyThroughConnectorJson"/> — B-1's zero-value defect
    /// (absence of information deserialising to "the machine took it") is exactly what this catches. Drives
    /// the REAL driver (never a hand-built record — that schema-level exhaustive proof already lives in
    /// <c>WriteRoundTripTests</c>) through a Rejected result (needs no reachable device — proves this for both
    /// operations cheaply) and an Indeterminate one (needs <see cref="CreateUnresponsiveWritableDeviceAsync"/>),
    /// and round-trips each by VALUE, not merely "did not throw".</summary>
    public virtual async Task Check_Write_RoundTripsLosslesslyThroughConnectorJson()
    {
        await using var driver = CreateDriver();
        var writable = (IWritableDeviceDriver)driver;

        var (rejectedPoint, pointThrown) = await TryWriteSetpointAsync(
            writable, new SetpointWriteRequest($"__conformance-rt-{Guid.NewGuid():N}", 0.0), CancellationToken.None).ConfigureAwait(false);
        Assert.True(pointThrown is null, $"WriteSetpointAsync threw instead of rejecting: {pointThrown}");
        AssertRoundTrips(rejectedPoint!);

        var (rejectedCommand, commandThrown) = await TryInvokeCommandAsync(
            writable, new CommandRequest($"__conformance-rt-{Guid.NewGuid():N}"), CancellationToken.None).ConfigureAwait(false);
        Assert.True(commandThrown is null, $"InvokeCommandAsync threw instead of rejecting: {commandThrown}");
        AssertRoundTrips(rejectedCommand!);

        var session = await CreateUnresponsiveWritableDeviceAsync().ConfigureAwait(false);
        try
        {
            var call = session.Driver.WriteSetpointAsync(
                new SetpointWriteRequest(session.WritablePoint, session.ValidPointValue), CancellationToken.None);
            var (indeterminate, thrown, inTime) = await AwaitWithBudgetAsync(call, WriteBudget).ConfigureAwait(false);
            Assert.True(inTime, $"WriteSetpointAsync against an unresponsive target did not return within {WriteBudget}.");
            Assert.True(thrown is null, $"WriteSetpointAsync threw {thrown} instead of returning Indeterminate.");
            Assert.Equal(WriteOutcome.Indeterminate, indeterminate!.Outcome);
            AssertRoundTrips(indeterminate);
        }
        finally
        {
            await session.ForceUnstickAsync().ConfigureAwait(false);
            await session.Driver.DisposeAsync().ConfigureAwait(false);
        }
    }

    // ---- write-contract helpers ------------------------------------------------------------------------

    /// <summary>Calls <see cref="Models.IWritableDeviceDriver.WriteSetpointAsync"/>, catching ANY exception
    /// rather than letting it propagate — every write-contract "must not throw" check needs to turn a
    /// driver's own thrown exception into an ordinary, reportable assertion failure rather than an
    /// unhandled fault the test runner treats completely differently (see the individual checks' own
    /// assertions on <c>Thrown</c>).</summary>
    private static async Task<(SetpointWriteResult? Result, Exception? Thrown)> TryWriteSetpointAsync(
        IWritableDeviceDriver driver, SetpointWriteRequest request, CancellationToken ct)
    {
        try
        {
            return (await driver.WriteSetpointAsync(request, ct).ConfigureAwait(false), null);
        }
        catch (Exception ex)
        {
            return (null, ex);
        }
    }

    /// <summary>The <see cref="Models.IWritableDeviceDriver.InvokeCommandAsync"/> mirror of
    /// <see cref="TryWriteSetpointAsync"/> — see that method's own remarks.</summary>
    private static async Task<(CommandResult? Result, Exception? Thrown)> TryInvokeCommandAsync(
        IWritableDeviceDriver driver, CommandRequest request, CancellationToken ct)
    {
        try
        {
            return (await driver.InvokeCommandAsync(request, ct).ConfigureAwait(false), null);
        }
        catch (Exception ex)
        {
            return (null, ex);
        }
    }

    /// <summary>Awaits <paramref name="task"/> up to <paramref name="budget"/>, catching any exception it
    /// throws rather than letting it propagate, and reporting definitively whether it completed in time —
    /// shared by every write-contract check that must PROVE a driver call returns promptly without throwing,
    /// rather than merely hoping xunit's own test-runner timeout eventually notices a hang.</summary>
    private static async Task<(TResult? Result, Exception? Thrown, bool CompletedInTime)> AwaitWithBudgetAsync<TResult>(
        Task<TResult> task, TimeSpan budget)
    {
        var winner = await Task.WhenAny(task, Task.Delay(budget)).ConfigureAwait(false);
        if (!ReferenceEquals(winner, task))
        {
            return (default, null, false);
        }

        try
        {
            return (await task.ConfigureAwait(false), null, true);
        }
        catch (Exception ex)
        {
            return (default, ex, true);
        }
    }

    /// <summary>Mechanism behind <see cref="Check_Write_CapabilityLists_AreEffectivelyImmutable"/> — see that
    /// check's own doc comment. Two independent probes, neither hard-coded to the specific
    /// <c>List&lt;string&gt;</c> shape B-4 actually shipped: (1) a direct downcast attempt (the EXACT B-4
    /// shape); (2) for ANY collection type that also implements <see cref="IList{T}"/>, an attempted
    /// <c>Add</c> AND an attempted indexer overwrite, each expected to either throw or leave the list
    /// unchanged.</summary>
    private static void AssertCapabilityListIsImmutable(IReadOnlyList<string> list, string propertyName)
    {
        Assert.False(
            list is List<string>,
            $"{propertyName} is backed by a raw List<string> exposed through an IReadOnlyList<string>-typed " +
            "reference — a caller can downcast straight back to List<string> and mutate it directly (Task " +
            "B-4's exact shipped shape). Wrap it in something a caller genuinely cannot mutate (e.g. " +
            ".AsReadOnly()), not merely a differently-typed reference over the same mutable instance.");

        if (list is not IList<string> asIList)
        {
            return;
        }

        var originalCount = list.Count;
        var addEx = Record.Exception(() => asIList.Add("__conformance_mutation_probe__"));
        Assert.True(
            addEx is not null || list.Count == originalCount,
            $"{propertyName} accepted Add() without throwing and its own Count changed afterward — it is a " +
            "mutable collection a caller can corrupt, not an effectively-immutable snapshot.");

        if (originalCount == 0)
        {
            return;
        }

        var originalFirst = list[0];
        var setEx = Record.Exception(() => asIList[0] = "__conformance_mutation_probe__");
        Assert.True(
            setEx is not null || Equals(list[0], originalFirst),
            $"{propertyName}[0] was overwritten via IList<string>'s own indexer without throwing — a caller " +
            "can silently corrupt an entry in what is supposed to be an effectively-immutable list.");
    }

    private static void AssertRoundTrips(SetpointWriteResult result)
    {
        string? json = null;
        try
        {
            json = JsonSerializer.Serialize(result, ConnectorJson.Options);
        }
        catch (JsonException ex)
        {
            Assert.Fail($"a real driver's own SetpointWriteResult (Point={result.Point}, Outcome={result.Outcome}) could not be serialized: {ex.Message}");
        }

        SetpointWriteResult? roundTripped = null;
        try
        {
            roundTripped = JsonSerializer.Deserialize<SetpointWriteResult>(json!, ConnectorJson.Options);
        }
        catch (Exception ex)
        {
            Assert.Fail($"a real driver's own SetpointWriteResult failed to deserialize back through ConnectorJson: {ex.Message}\nJSON: {json}");
        }

        Assert.NotNull(roundTripped);
        Assert.Equal(result, roundTripped);
    }

    private static void AssertRoundTrips(CommandResult result)
    {
        string? json = null;
        try
        {
            json = JsonSerializer.Serialize(result, ConnectorJson.Options);
        }
        catch (JsonException ex)
        {
            Assert.Fail($"a real driver's own CommandResult (Command={result.Command}, Outcome={result.Outcome}) could not be serialized: {ex.Message}");
        }

        CommandResult? roundTripped = null;
        try
        {
            roundTripped = JsonSerializer.Deserialize<CommandResult>(json!, ConnectorJson.Options);
        }
        catch (Exception ex)
        {
            Assert.Fail($"a real driver's own CommandResult failed to deserialize back through ConnectorJson: {ex.Message}\nJSON: {json}");
        }

        Assert.NotNull(roundTripped);
        Assert.Equal(result, roundTripped);
    }

    // ---- shared helpers -------------------------------------------------------------------------------

    /// <summary>Enumerates <paramref name="driver"/> until <paramref name="ct"/> is cancelled, treating
    /// <see cref="OperationCanceledException"/> as the documented-acceptable outcome of cancellation (the
    /// SAME "may throw OR complete" contract <see cref="IDeviceDriver.ReadAsync"/> itself documents) so the
    /// returned task always completes (never faults on cancellation) once the driver actually stops.</summary>
    private static async Task RunUntilStoppedAsync(IDeviceDriver driver, CancellationToken ct)
    {
        try
        {
            await foreach (var _ in driver.ReadAsync(ct).ConfigureAwait(false)) { }
        }
        catch (OperationCanceledException) { }
    }

    private async Task AssertDisposeIsFastAndDoesNotThrowAsync(IDeviceDriver driver)
    {
        var sw = Stopwatch.StartNew();
        var ex = await Record.ExceptionAsync(() => driver.DisposeAsync().AsTask()).ConfigureAwait(false);
        sw.Stop();

        Assert.True(ex is null, $"DisposeAsync threw: {ex}");
        Assert.True(
            sw.Elapsed < DisposeBudget,
            $"DisposeAsync took {sw.Elapsed}, exceeding the {DisposeBudget} budget — FleetHost's own teardown " +
            "only waits a bounded budget for a driver's DisposeAsync before giving up.");
    }

    /// <summary>True if <paramref name="reading"/> carries at least one actual value in any of the
    /// collections the round-trip check is meant to exercise — see
    /// <see cref="Check_Telemetry_RoundTripsLosslesslyThroughConnectorJson"/>'s own doc comment.</summary>
    private static bool HasAnyValueBearingContent(DeviceReading reading) =>
        reading.Telemetry.Count > 0
        || reading.Metrics.Count > 0
        || reading.Measurements.Count > 0
        || reading.Waveforms.Count > 0
        || reading.Genealogy is { Count: > 0 };

    private static async Task SwallowAsync(Task task)
    {
        try
        {
            await task.ConfigureAwait(false);
        }
        catch
        {
            // best-effort cleanup only — this check's assertions have already run by the time this is called.
        }
    }
}
