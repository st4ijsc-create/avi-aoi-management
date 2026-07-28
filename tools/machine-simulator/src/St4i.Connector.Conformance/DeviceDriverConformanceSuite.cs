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

    // ---- wiring enforcement (task-6-report.md "Fix round 1", IMPORTANT 3) --------------------------

    private const string CheckMethodPrefix = "Check_";

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
    /// quietly skip a check that is merely inconvenient. <see cref="EveryCheckIsWiredOrAcknowledged"/> still
    /// requires every name here to correspond to a REAL <c>Check_*</c> method (a stale/misspelled entry is
    /// itself a defect this could otherwise hide).
    /// </summary>
    protected virtual ISet<string> AcknowledgedGaps { get; } = new HashSet<string>();

    /// <summary>
    /// Pure function backing <see cref="EveryCheckIsWiredOrAcknowledged"/> — exposed separately so a
    /// negative-control test can prove this detection logic has teeth without needing to instantiate a
    /// "live", xunit-auto-discoverable, deliberately-incomplete conformance test class (which would itself
    /// become a permanently-failing test the moment xunit discovered it).
    /// </summary>
    public static IReadOnlyList<string> FindUnwiredAndUnacknowledgedChecks(Type concreteType, IEnumerable<string> acknowledgedGaps)
    {
        var checkNames = typeof(DeviceDriverConformanceSuite)
            .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(m => m.Name.StartsWith(CheckMethodPrefix, StringComparison.Ordinal) && m.GetParameters().Length == 0)
            .Select(m => m.Name[CheckMethodPrefix.Length..]);

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
    /// exists to invoke individual checks manually, not to demonstrate full coverage.</summary>
    [Fact]
    public void EveryCheckIsWiredOrAcknowledged()
    {
        if (!IsConformanceTarget) return;

        var missing = FindUnwiredAndUnacknowledgedChecks(GetType(), AcknowledgedGaps);

        Assert.True(
            missing.Count == 0,
            $"{GetType().Name} silently omits conformance coverage for: {string.Join(", ", missing)}. Every " +
            $"Check_* method on {nameof(DeviceDriverConformanceSuite)} must be wired as a [Fact] method named " +
            "identically (minus the \"Check_\" prefix) or listed in AcknowledgedGaps with a reason (e.g. a " +
            "KnownGap_* test pinning real, currently-broken behaviour).");
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
                "constructor blocks emergency-stop for as long as it takes.");

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
    /// catches a driver that is simply, persistently wrong. Proven independently load-bearing in
    /// task-6-report.md's negative controls (<c>ReusesReadingInstanceHarness</c>/
    /// <c>MutatesSharedTelemetryListHarness</c>, both device-backed fakes that DO yield readings while
    /// reporting Connected).</para>
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
