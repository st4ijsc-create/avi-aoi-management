using St4i.Connector.Abstractions.Models;
using St4i.EngineApi.Alarms;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests.Alarms;

/// <summary>
/// GĐ3 sub-4 LC-2 — <see cref="AlarmEvaluator"/>: the pure, directly-testable core of the automatic
/// (condition-based) alarm sources. Every test drives <see cref="AlarmEvaluator.EvaluateAsync"/> directly
/// with synthetic <see cref="DriverHealthSnapshot"/> lists / KPI-counter tuples — NEVER a real timer, NEVER
/// <see cref="AlarmEvaluatorService"/>, and never anything time-based — so every assertion here is
/// deterministic no matter how slow or fast the test runner is.
///
/// Most tests use a REAL <see cref="AlarmStore"/> on its own fresh temp directory (same idiom as
/// <c>AlarmStoreTests</c>) rather than a hand-rolled fake, so a passing test also proves the evaluator's
/// calls actually round-trip through LC-1's real raise/clear/dedup semantics. The one exception is
/// <see cref="EvaluateAsync_NeverThrows_EvenWhenTheAlarmStoreThrows"/>, which needs a store that violates
/// <see cref="IAlarmStore"/>'s own never-throw contract on purpose, to prove the EVALUATOR's guard holds
/// even then.
/// </summary>
public sealed class AlarmEvaluatorTests : IDisposable
{
    private readonly List<string> _tempDirs = new();

    public void Dispose()
    {
        foreach (var dir in _tempDirs)
        {
            try { Directory.Delete(dir, recursive: true); } catch { /* best-effort cleanup */ }
        }
    }

    private AlarmStore NewStore()
    {
        var dir = Directory.CreateTempSubdirectory("st4i-alarm-evaluator-tests-").FullName;
        _tempDirs.Add(dir);
        return new AlarmStore(dir);
    }

    private static AlarmThresholds DefaultThresholds() => new(); // NgRateThreshold=0.20, MinSample=5

    private static DriverHealthSnapshot Slot(string label, DriverHealthState health, string kind = DriverKinds.Modbus) =>
        new(label, kind, health);

    private static async Task<Alarm?> FindActiveAsync(IAlarmStore store, AlarmSource source, string code, string? targetId)
    {
        var active = await store.ListActiveAsync();
        return active.FirstOrDefault(a => a.Source == source && a.Code == code && a.TargetId == targetId);
    }

    // ─────────────────────────────────────────────────────────────────────
    // DriverHealth source
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task DegradedSlot_RaisesHighDegradedAlarm()
    {
        var store = NewStore();
        var evaluator = new AlarmEvaluator(store, DefaultThresholds());

        await evaluator.EvaluateAsync(
            new[] { Slot("AOI-01", DriverHealthState.Degraded) }, (0, 0), CancellationToken.None);

        var alarm = await FindActiveAsync(store, AlarmSource.DriverHealth, "DEGRADED", "AOI-01");
        Assert.NotNull(alarm);
        Assert.Equal(AlarmPriority.High, alarm!.Priority);
        Assert.False(alarm.ClearOnAck);
        Assert.Contains("AOI-01", alarm.Message);
    }

    [Fact]
    public async Task DownSlot_RaisesCriticalDownAlarm()
    {
        var store = NewStore();
        var evaluator = new AlarmEvaluator(store, DefaultThresholds());

        await evaluator.EvaluateAsync(
            new[] { Slot("SCRW-01", DriverHealthState.Down) }, (0, 0), CancellationToken.None);

        var alarm = await FindActiveAsync(store, AlarmSource.DriverHealth, "DOWN", "SCRW-01");
        Assert.NotNull(alarm);
        Assert.Equal(AlarmPriority.Critical, alarm!.Priority);
        Assert.False(alarm.ClearOnAck);
        Assert.Contains("SCRW-01", alarm.Message);
    }

    [Fact]
    public async Task SlotRecoversToConnected_ClearsBothDegradedAndDownAlarms()
    {
        var store = NewStore();
        var evaluator = new AlarmEvaluator(store, DefaultThresholds());

        // Pass 1: Down (raises DOWN).
        await evaluator.EvaluateAsync(new[] { Slot("AOI-01", DriverHealthState.Down) }, (0, 0), CancellationToken.None);
        Assert.NotNull(await FindActiveAsync(store, AlarmSource.DriverHealth, "DOWN", "AOI-01"));

        // Pass 2: Degraded (raises DEGRADED, clears the stale DOWN from the escalation-recovery path).
        await evaluator.EvaluateAsync(new[] { Slot("AOI-01", DriverHealthState.Degraded) }, (0, 0), CancellationToken.None);
        Assert.NotNull(await FindActiveAsync(store, AlarmSource.DriverHealth, "DEGRADED", "AOI-01"));
        Assert.Null(await FindActiveAsync(store, AlarmSource.DriverHealth, "DOWN", "AOI-01"));

        // Pass 3: Connected — both alarms clear.
        await evaluator.EvaluateAsync(new[] { Slot("AOI-01", DriverHealthState.Connected) }, (0, 0), CancellationToken.None);
        Assert.Null(await FindActiveAsync(store, AlarmSource.DriverHealth, "DEGRADED", "AOI-01"));
        Assert.Null(await FindActiveAsync(store, AlarmSource.DriverHealth, "DOWN", "AOI-01"));
    }

    [Fact]
    public async Task SlotVanishes_ItsHealthAlarmsAreCleared()
    {
        var store = NewStore();
        var evaluator = new AlarmEvaluator(store, DefaultThresholds());

        await evaluator.EvaluateAsync(new[] { Slot("modbus", DriverHealthState.Down) }, (0, 0), CancellationToken.None);
        Assert.NotNull(await FindActiveAsync(store, AlarmSource.DriverHealth, "DOWN", "modbus"));

        // Next pass: the slot is gone entirely (e.g. removed from the fleet) — no Connected report ever
        // comes in for it, but its alarm must still be cleared.
        await evaluator.EvaluateAsync(Array.Empty<DriverHealthSnapshot>(), (0, 0), CancellationToken.None);

        Assert.Null(await FindActiveAsync(store, AlarmSource.DriverHealth, "DOWN", "modbus"));
    }

    [Fact]
    public async Task HealthySlot_NeverRaisesAnything()
    {
        var store = NewStore();
        var evaluator = new AlarmEvaluator(store, DefaultThresholds());

        await evaluator.EvaluateAsync(
            new[] { Slot("SCRW-01", DriverHealthState.Connected), Slot("AOI-01", DriverHealthState.Connected) },
            (0, 0), CancellationToken.None);

        Assert.Empty(await store.ListActiveAsync());
    }

    // ─────────────────────────────────────────────────────────────────────
    // NG-rate source — windowed delta since last pass.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task NgRate_FirstPass_SeedsBaseline_RaisesNothing()
    {
        var store = NewStore();
        var evaluator = new AlarmEvaluator(store, DefaultThresholds());

        // Even a first-pass reading that WOULD blow the threshold if treated as a delta must not raise —
        // there is no prior baseline to diff against yet.
        await evaluator.EvaluateAsync(Array.Empty<DriverHealthSnapshot>(), (0, 100), CancellationToken.None);

        Assert.Empty(await store.ListActiveAsync());
    }

    [Fact]
    public async Task NgRate_DeltaExceedsThreshold_WithEnoughSamples_RaisesHighAlarm()
    {
        var store = NewStore();
        var evaluator = new AlarmEvaluator(store, DefaultThresholds());

        // Seed.
        await evaluator.EvaluateAsync(Array.Empty<DriverHealthSnapshot>(), (0, 0), CancellationToken.None);

        // Delta: 10 judged, 5 passed -> 50% NG, dJudged(10) >= MinSample(5) -> raises.
        await evaluator.EvaluateAsync(Array.Empty<DriverHealthSnapshot>(), (5, 10), CancellationToken.None);

        var alarm = await FindActiveAsync(store, AlarmSource.NgRate, "HIGH", "fleet");
        Assert.NotNull(alarm);
        Assert.Equal(AlarmPriority.High, alarm!.Priority);
        Assert.False(alarm.ClearOnAck);
    }

    [Fact]
    public async Task NgRate_SubsequentDeltaUnderThreshold_ClearsTheAlarm()
    {
        var store = NewStore();
        var evaluator = new AlarmEvaluator(store, DefaultThresholds());

        await evaluator.EvaluateAsync(Array.Empty<DriverHealthSnapshot>(), (0, 0), CancellationToken.None);
        await evaluator.EvaluateAsync(Array.Empty<DriverHealthSnapshot>(), (5, 10), CancellationToken.None);
        Assert.NotNull(await FindActiveAsync(store, AlarmSource.NgRate, "HIGH", "fleet"));

        // Next window: 10 more judged, all 10 passed -> 0% NG, well over MinSample -> clears.
        await evaluator.EvaluateAsync(Array.Empty<DriverHealthSnapshot>(), (15, 20), CancellationToken.None);

        Assert.Null(await FindActiveAsync(store, AlarmSource.NgRate, "HIGH", "fleet"));
    }

    [Fact]
    public async Task NgRate_DeltaUnderMinSample_DoesNothing_NoFlap()
    {
        var store = NewStore();
        var evaluator = new AlarmEvaluator(store, DefaultThresholds());

        await evaluator.EvaluateAsync(Array.Empty<DriverHealthSnapshot>(), (0, 0), CancellationToken.None);
        await evaluator.EvaluateAsync(Array.Empty<DriverHealthSnapshot>(), (5, 10), CancellationToken.None);
        Assert.NotNull(await FindActiveAsync(store, AlarmSource.NgRate, "HIGH", "fleet"));

        // Next window: only 2 more judged (< MinSample=5), ALL of them NG (100%) — a real high rate, but
        // too few samples to trust. The alarm must stay exactly as it was (raised), neither re-raised
        // with a different message nor cleared.
        await evaluator.EvaluateAsync(Array.Empty<DriverHealthSnapshot>(), (5, 12), CancellationToken.None);

        var stillRaised = await FindActiveAsync(store, AlarmSource.NgRate, "HIGH", "fleet");
        Assert.NotNull(stillRaised);
        Assert.Equal(1, stillRaised!.Count); // never re-raised by the tiny-sample pass

        // Now a proper full window with a good rate actually clears it.
        await evaluator.EvaluateAsync(Array.Empty<DriverHealthSnapshot>(), (15, 22), CancellationToken.None);
        Assert.Null(await FindActiveAsync(store, AlarmSource.NgRate, "HIGH", "fleet"));
    }

    [Fact]
    public async Task NgRate_CounterReset_NeverThrows_ResetsBaseline()
    {
        var store = NewStore();
        var evaluator = new AlarmEvaluator(store, DefaultThresholds());

        await evaluator.EvaluateAsync(Array.Empty<DriverHealthSnapshot>(), (100, 200), CancellationToken.None);

        // Counters went BACKWARDS (e.g. a process restart) — must not throw, and must not compute a
        // nonsense negative-delta rate.
        await evaluator.EvaluateAsync(Array.Empty<DriverHealthSnapshot>(), (0, 0), CancellationToken.None);
        Assert.Empty(await store.ListActiveAsync());

        // The baseline is now (0, 0) — a subsequent normal delta from there evaluates as usual.
        await evaluator.EvaluateAsync(Array.Empty<DriverHealthSnapshot>(), (5, 10), CancellationToken.None);
        Assert.NotNull(await FindActiveAsync(store, AlarmSource.NgRate, "HIGH", "fleet"));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Identity-expiry source (GĐ3 closeout WI-4) — DateTimeOffset in, no real X.509 cert/DeviceIdentity
    // needed: the evaluator only ever needs the NotAfter timestamp, passed exactly like the DriverHealth
    // snapshot / KPI counters above — never the live identity object itself.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task IdentityExpiry_WithinWarnWindow_RaisesHighAlarm_NeverCritical()
    {
        var store = NewStore();
        var evaluator = new AlarmEvaluator(store, DefaultThresholds()); // IdentityExpiryWarnDays=30

        await evaluator.EvaluateAsync(
            Array.Empty<DriverHealthSnapshot>(), (0, 0), CancellationToken.None,
            identityNotAfterUtc: DateTimeOffset.UtcNow.AddDays(10));

        var alarm = await FindActiveAsync(store, AlarmSource.Identity, "EXPIRING", "device");
        Assert.NotNull(alarm);
        Assert.Equal(AlarmPriority.High, alarm!.Priority);
        // The regression guard for the deliberate "never Critical" product decision (GĐ3 closeout WI-4
        // brief) — a Critical alarm feeds LineController's alarm→hold gate and would block line.start/
        // line.unhold; an expiring certificate must never stop production.
        Assert.NotEqual(AlarmPriority.Critical, alarm.Priority);
        Assert.False(alarm.ClearOnAck);
    }

    [Fact]
    public async Task IdentityExpiry_ExactlyAtTheWarnBoundary_Raises()
    {
        var store = NewStore();
        var evaluator = new AlarmEvaluator(store, DefaultThresholds());

        // Boundary: NotAfter exactly IdentityExpiryWarnDays away — "<=" in the evaluator means this DOES raise.
        await evaluator.EvaluateAsync(
            Array.Empty<DriverHealthSnapshot>(), (0, 0), CancellationToken.None,
            identityNotAfterUtc: DateTimeOffset.UtcNow.AddDays(30));

        Assert.NotNull(await FindActiveAsync(store, AlarmSource.Identity, "EXPIRING", "device"));
    }

    [Fact]
    public async Task IdentityExpiry_AlreadyExpiredCertificate_StillRaises_NegativeDaysToExpiry()
    {
        var store = NewStore();
        var evaluator = new AlarmEvaluator(store, DefaultThresholds());

        // An already-expired cert (NotAfter in the past) is well inside the warn window too — must raise,
        // not be skipped just because the delta is negative.
        await evaluator.EvaluateAsync(
            Array.Empty<DriverHealthSnapshot>(), (0, 0), CancellationToken.None,
            identityNotAfterUtc: DateTimeOffset.UtcNow.AddDays(-5));

        var alarm = await FindActiveAsync(store, AlarmSource.Identity, "EXPIRING", "device");
        Assert.NotNull(alarm);
        Assert.Equal(AlarmPriority.High, alarm!.Priority);
    }

    [Fact]
    public async Task IdentityExpiry_OutsideWarnWindow_RaisesNothing()
    {
        var store = NewStore();
        var evaluator = new AlarmEvaluator(store, DefaultThresholds());

        await evaluator.EvaluateAsync(
            Array.Empty<DriverHealthSnapshot>(), (0, 0), CancellationToken.None,
            identityNotAfterUtc: DateTimeOffset.UtcNow.AddDays(400));

        Assert.Null(await FindActiveAsync(store, AlarmSource.Identity, "EXPIRING", "device"));
    }

    [Fact]
    public async Task IdentityExpiry_NullNotAfter_NeverRaisesOrThrows()
    {
        var store = NewStore();
        var evaluator = new AlarmEvaluator(store, DefaultThresholds());

        var exception = await Record.ExceptionAsync(() =>
            evaluator.EvaluateAsync(Array.Empty<DriverHealthSnapshot>(), (0, 0), CancellationToken.None));

        Assert.Null(exception);
        Assert.Null(await FindActiveAsync(store, AlarmSource.Identity, "EXPIRING", "device"));
    }

    [Fact]
    public async Task IdentityExpiry_AfterRotationPushesExpiryOut_TheAlarmClears()
    {
        var store = NewStore();
        var evaluator = new AlarmEvaluator(store, DefaultThresholds());

        await evaluator.EvaluateAsync(
            Array.Empty<DriverHealthSnapshot>(), (0, 0), CancellationToken.None,
            identityNotAfterUtc: DateTimeOffset.UtcNow.AddDays(10));
        Assert.NotNull(await FindActiveAsync(store, AlarmSource.Identity, "EXPIRING", "device"));

        // Simulates a rotation: the freshly-minted cert's NotAfter is a full ~10-year validity window away
        // again — the evaluator (not an operator Ack) is what clears a condition alarm once it ends.
        await evaluator.EvaluateAsync(
            Array.Empty<DriverHealthSnapshot>(), (0, 0), CancellationToken.None,
            identityNotAfterUtc: DateTimeOffset.UtcNow.AddYears(10));

        Assert.Null(await FindActiveAsync(store, AlarmSource.Identity, "EXPIRING", "device"));
    }

    [Fact]
    public async Task IdentityExpiry_CustomWarnDaysThreshold_IsHonored()
    {
        var store = NewStore();
        var evaluator = new AlarmEvaluator(store, new AlarmThresholds { IdentityExpiryWarnDays = 5 });

        // 10 days out is OUTSIDE a 5-day warn window — must not raise under the tighter threshold.
        await evaluator.EvaluateAsync(
            Array.Empty<DriverHealthSnapshot>(), (0, 0), CancellationToken.None,
            identityNotAfterUtc: DateTimeOffset.UtcNow.AddDays(10));
        Assert.Null(await FindActiveAsync(store, AlarmSource.Identity, "EXPIRING", "device"));

        // 3 days out IS inside a 5-day warn window.
        await evaluator.EvaluateAsync(
            Array.Empty<DriverHealthSnapshot>(), (0, 0), CancellationToken.None,
            identityNotAfterUtc: DateTimeOffset.UtcNow.AddDays(3));
        Assert.NotNull(await FindActiveAsync(store, AlarmSource.Identity, "EXPIRING", "device"));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 1, Important #1 — the Identity source must NOT re-raise (and so must NOT append a fresh
    // alarm_history row) on every tick while the whole-day remaining-value hasn't changed. Without this,
    // the 5s-default eval interval would produce ~518k history rows over one 30-day warn window (and
    // unboundedly more if an operator never rotates) — alarm_history has no pruning anywhere in this
    // codebase. Alarm.Count is the observable proxy: RaiseAsync's own UPSERT increments it on every ACTUAL
    // call (see AlarmStore.RaiseAsync), so Count staying at 1 across repeated ticks proves no redundant
    // RaiseAsync call — and therefore no redundant history row — was made.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task IdentityExpiry_RepeatedTicksAtTheSameDayGranularity_DoesNotReRaise_CountStaysOne()
    {
        var store = NewStore();
        var evaluator = new AlarmEvaluator(store, DefaultThresholds());
        var notAfter = DateTimeOffset.UtcNow.AddDays(10);

        // Same target instant across three "ticks" — simulates the evaluator polling every 5s while the
        // remaining-days value (a whole-day count) hasn't crossed a day boundary yet.
        await evaluator.EvaluateAsync(Array.Empty<DriverHealthSnapshot>(), (0, 0), CancellationToken.None, identityNotAfterUtc: notAfter);
        await evaluator.EvaluateAsync(Array.Empty<DriverHealthSnapshot>(), (0, 0), CancellationToken.None, identityNotAfterUtc: notAfter);
        await evaluator.EvaluateAsync(Array.Empty<DriverHealthSnapshot>(), (0, 0), CancellationToken.None, identityNotAfterUtc: notAfter);

        var alarm = await FindActiveAsync(store, AlarmSource.Identity, "EXPIRING", "device");
        Assert.NotNull(alarm);
        Assert.Equal(1, alarm!.Count); // never re-raised across the repeated same-day-value ticks.
    }

    [Fact]
    public async Task IdentityExpiry_DaysToExpiryValueChanges_DoesReRaise_CountIncrements()
    {
        var store = NewStore();
        var evaluator = new AlarmEvaluator(store, DefaultThresholds());

        await evaluator.EvaluateAsync(
            Array.Empty<DriverHealthSnapshot>(), (0, 0), CancellationToken.None,
            identityNotAfterUtc: DateTimeOffset.UtcNow.AddDays(10));
        var first = await FindActiveAsync(store, AlarmSource.Identity, "EXPIRING", "device");
        Assert.NotNull(first);
        Assert.Equal(1, first!.Count);

        // A day boundary crossed (the evaluator has no timer/wall-clock dependency of its own — see this
        // class's own doc comment — so a "day later" pass is simulated directly): the remaining-days value
        // actually changed, so THIS re-raise must go through (bumping Count), unlike the same-value case
        // in IdentityExpiry_RepeatedTicksAtTheSameDayGranularity_DoesNotReRaise_CountStaysOne above.
        await evaluator.EvaluateAsync(
            Array.Empty<DriverHealthSnapshot>(), (0, 0), CancellationToken.None,
            identityNotAfterUtc: DateTimeOffset.UtcNow.AddDays(9));
        var second = await FindActiveAsync(store, AlarmSource.Identity, "EXPIRING", "device");
        Assert.NotNull(second);
        Assert.Equal(2, second!.Count);
    }

    [Fact]
    public async Task IdentityExpiry_ClearedThenReEntersWindow_RaisesAgain_NotSuppressedForever()
    {
        var store = NewStore();
        var evaluator = new AlarmEvaluator(store, DefaultThresholds());

        // Raise (enters the window)...
        await evaluator.EvaluateAsync(
            Array.Empty<DriverHealthSnapshot>(), (0, 0), CancellationToken.None,
            identityNotAfterUtc: DateTimeOffset.UtcNow.AddDays(10));
        Assert.NotNull(await FindActiveAsync(store, AlarmSource.Identity, "EXPIRING", "device"));

        // ...clears (a rotation pushes the expiry back out)...
        await evaluator.EvaluateAsync(
            Array.Empty<DriverHealthSnapshot>(), (0, 0), CancellationToken.None,
            identityNotAfterUtc: DateTimeOffset.UtcNow.AddYears(10));
        Assert.Null(await FindActiveAsync(store, AlarmSource.Identity, "EXPIRING", "device"));

        // ...and if it later re-enters the SAME warn window again (e.g. years pass with no further
        // rotation), the dedup state must not have permanently latched "already raised" — this must raise
        // again, a fresh Count of 1, not stay silently suppressed forever.
        await evaluator.EvaluateAsync(
            Array.Empty<DriverHealthSnapshot>(), (0, 0), CancellationToken.None,
            identityNotAfterUtc: DateTimeOffset.UtcNow.AddDays(10));
        var reRaised = await FindActiveAsync(store, AlarmSource.Identity, "EXPIRING", "device");
        Assert.NotNull(reRaised);
        Assert.Equal(1, reRaised!.Count);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Never-throws — even when the store itself violates IAlarmStore's contract.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task EvaluateAsync_NeverThrows_EvenWhenTheAlarmStoreThrows()
    {
        var evaluator = new AlarmEvaluator(new ThrowingAlarmStore(), DefaultThresholds());

        // Must complete without throwing — a Degraded slot (DriverHealth source), a threshold-busting
        // delta (NG-rate source), AND an inside-the-window expiry (Identity source) each attempt a
        // RaiseAsync against a store whose RaiseAsync/ClearAsync always throw.
        await evaluator.EvaluateAsync(new[] { Slot("AOI-01", DriverHealthState.Degraded) }, (0, 0), CancellationToken.None);
        await evaluator.EvaluateAsync(
            new[] { Slot("AOI-01", DriverHealthState.Degraded) }, (5, 10), CancellationToken.None,
            identityNotAfterUtc: DateTimeOffset.UtcNow.AddDays(10));
    }

    /// <summary>Test double — deliberately VIOLATES <see cref="IAlarmStore"/>'s own never-throw contract,
    /// to prove <see cref="AlarmEvaluator"/>'s own guard (not a well-behaved store) is what keeps
    /// <see cref="AlarmEvaluator.EvaluateAsync"/> from throwing.</summary>
    private sealed class ThrowingAlarmStore : IAlarmStore
    {
        public Task<AlarmTransition> RaiseAsync(AlarmRaise raise, CancellationToken ct = default) =>
            throw new InvalidOperationException("ThrowingAlarmStore: simulated RaiseAsync failure (test double).");

        public Task<AlarmTransition> ClearAsync(string key, CancellationToken ct = default) =>
            throw new InvalidOperationException("ThrowingAlarmStore: simulated ClearAsync failure (test double).");

        public Task<Alarm?> AckAsync(long id, string by, CancellationToken ct = default) =>
            throw new NotImplementedException();

        public Task<IReadOnlyList<Alarm>> ListActiveAsync(CancellationToken ct = default) =>
            throw new NotImplementedException();

        public Task<AlarmHistoryPage> QueryHistoryAsync(AlarmHistoryFilter filter, CancellationToken ct = default) =>
            throw new NotImplementedException();
    }
}
