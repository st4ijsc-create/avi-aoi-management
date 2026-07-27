using St4i.EdgeCore.Models;
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

    private static DriverHealthSnapshot Slot(string label, DriverHealthState health, DriverKind kind = DriverKind.Modbus) =>
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
    // Never-throws — even when the store itself violates IAlarmStore's contract.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task EvaluateAsync_NeverThrows_EvenWhenTheAlarmStoreThrows()
    {
        var evaluator = new AlarmEvaluator(new ThrowingAlarmStore(), DefaultThresholds());

        // Must complete without throwing — both a Degraded slot (DriverHealth source) and a
        // threshold-busting delta (NG-rate source) attempt a RaiseAsync against a store whose
        // RaiseAsync/ClearAsync always throw.
        await evaluator.EvaluateAsync(new[] { Slot("AOI-01", DriverHealthState.Degraded) }, (0, 0), CancellationToken.None);
        await evaluator.EvaluateAsync(new[] { Slot("AOI-01", DriverHealthState.Degraded) }, (5, 10), CancellationToken.None);
    }

    /// <summary>Test double — deliberately VIOLATES <see cref="IAlarmStore"/>'s own never-throw contract,
    /// to prove <see cref="AlarmEvaluator"/>'s own guard (not a well-behaved store) is what keeps
    /// <see cref="AlarmEvaluator.EvaluateAsync"/> from throwing.</summary>
    private sealed class ThrowingAlarmStore : IAlarmStore
    {
        public Task RaiseAsync(AlarmRaise raise, CancellationToken ct = default) =>
            throw new InvalidOperationException("ThrowingAlarmStore: simulated RaiseAsync failure (test double).");

        public Task ClearAsync(string key, CancellationToken ct = default) =>
            throw new InvalidOperationException("ThrowingAlarmStore: simulated ClearAsync failure (test double).");

        public Task<Alarm?> AckAsync(long id, string by, CancellationToken ct = default) =>
            throw new NotImplementedException();

        public Task<IReadOnlyList<Alarm>> ListActiveAsync(CancellationToken ct = default) =>
            throw new NotImplementedException();

        public Task<AlarmHistoryPage> QueryHistoryAsync(AlarmHistoryFilter filter, CancellationToken ct = default) =>
            throw new NotImplementedException();
    }
}
