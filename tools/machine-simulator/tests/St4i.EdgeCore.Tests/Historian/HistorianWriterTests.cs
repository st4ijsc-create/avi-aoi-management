using System.Diagnostics;
using St4i.EdgeCore.Historian;
using Xunit;

namespace St4i.EdgeCore.Tests.Historian;

/// <summary>
/// WS-A-T6 — <see cref="HistorianWriter"/>: the bounded-channel write-behind that decouples the
/// EdgePipeline's hot commit thread from the (possibly slow) <see cref="IHistorianStore"/>. Every test here
/// runs against <see cref="FakeHistorianStore"/> (never real SQLite) and proves the three correctness
/// properties the design exists for: (1) <c>Enqueue</c> never blocks the caller even while the store append
/// is stuck; (2) a store that throws never kills the background flush loop — later records still get
/// through; (3) <c>DisposeAsync</c> completes cleanly (drains, doesn't hang, doesn't throw).
///
/// Deliberately no <c>Task.Delay</c>-based sleeps for synchronization: every wait is either a
/// <see cref="TaskCompletionSource"/> gate (to force a specific interleaving) or a bounded poll (same
/// <c>WaitUntilAsync</c> shape as <c>FleetHostHealthAndRegistrationTests.cs:51-61</c>), so these tests are
/// fast on the happy path and fail with a clear timeout message instead of flaking under CI load.
/// </summary>
public sealed class HistorianWriterTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(25);

    private static async Task WaitUntilAsync(Func<bool> predicate, string because)
    {
        var deadline = DateTime.UtcNow + PollTimeout;
        while (DateTime.UtcNow < deadline)
        {
            if (predicate()) return;
            await Task.Delay(PollInterval);
        }

        Assert.True(predicate(), $"timed out after {PollTimeout} waiting for: {because}");
    }

    private static HistorianResultRecord NewRecord(string machineCode, long cycleCounter = 1) => new(
        MachineCode: machineCode,
        DeviceClass: "Automation",
        MachineType: "SCREWDRIVE",
        ReadingKind: "Cycle",
        CycleCounter: cycleCounter,
        SerialNumber: $"SN-{machineCode}-{cycleCounter}",
        Verdict: "OK",
        RecipeCode: null,
        RecipeVersion: null,
        KeyMetricName: null,
        KeyMetricValue: null,
        KeyMetricUnit: null,
        NgCount: 0,
        PointCount: 0,
        AckSuccess: true,
        AckDuplicate: false,
        AckQueued: false,
        GenealogyJson: null,
        MeasurementsJson: null,
        EventTimeUtc: DateTimeOffset.UtcNow,
        IngestedAtUtc: DateTimeOffset.UtcNow,
        TelemetrySamples: Array.Empty<TelemetrySampleRecord>());

    [Fact]
    public async Task Enqueue_DoesNotBlock_EvenWhileStoreAppendIsGatedAndPending()
    {
        var store = new FakeHistorianStore();
        store.Gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        await using var writer = new HistorianWriter(store);

        var record = NewRecord("GATED");
        var sw = Stopwatch.StartNew();
        writer.Enqueue(record);
        sw.Stop();

        Assert.True(sw.ElapsedMilliseconds < 250, $"Enqueue must return immediately; took {sw.ElapsedMilliseconds}ms");
        // The append genuinely hasn't happened yet (gate not released) — proves the fast return above isn't
        // simply because the store already finished before we measured.
        Assert.DoesNotContain(store.AppendedResultsSnapshot(), r => r.MachineCode == "GATED");

        store.Gate.SetResult();

        await WaitUntilAsync(
            () => store.AppendedResultsSnapshot().Any(r => r.MachineCode == "GATED"),
            "gated record flushed after the store's gate was released");
    }

    [Fact]
    public async Task Enqueue_SeveralRecords_EventuallyAllFlushToTheStore()
    {
        var store = new FakeHistorianStore();
        await using var writer = new HistorianWriter(store);

        for (var i = 1; i <= 5; i++)
        {
            writer.Enqueue(NewRecord("BATCH", cycleCounter: i));
        }

        await WaitUntilAsync(
            () => store.AppendedResultsSnapshot().Count(r => r.MachineCode == "BATCH") == 5,
            "all 5 enqueued records to be flushed to the store");
    }

    [Fact]
    public async Task FlushLoop_SurvivesAThrowingStore_AndStillProcessesLaterRecords()
    {
        var store = new FakeHistorianStore();
        store.ThrowNTimesThenSucceed(1);
        await using var writer = new HistorianWriter(store);

        writer.Enqueue(NewRecord("FAILS"));

        // Wait for the loop to have actually picked up (and thrown on) the first batch before enqueueing the
        // second record — otherwise both records could land in the SAME batch and the assertion below would
        // no longer prove the loop survived an exception between two separate flush attempts.
        await WaitUntilAsync(() => store.AppendAttempts >= 1, "the first (throwing) flush attempt to occur");

        writer.Enqueue(NewRecord("SUCCEEDS"));

        await WaitUntilAsync(
            () => store.AppendedResultsSnapshot().Any(r => r.MachineCode == "SUCCEEDS"),
            "the later record to be recorded, proving the loop survived the first batch's exception");

        Assert.DoesNotContain(store.AppendedResultsSnapshot(), r => r.MachineCode == "FAILS");
    }

    [Fact]
    public async Task RecordRunEventFireAndForget_RecordsTheEventOnTheStore()
    {
        var store = new FakeHistorianStore();
        await using var writer = new HistorianWriter(store);

        _ = writer.RecordRunEventFireAndForget("Start", note: "operator pressed run");

        await WaitUntilAsync(
            () => store.AppendedRunEventsSnapshot().Any(e => e.EventType == "Start" && e.Note == "operator pressed run"),
            "the fire-and-forget run event to be recorded on the store");
    }

    [Fact]
    public async Task RecordRunEventFireAndForget_WhenStoreThrows_SwallowsAndReturnsCompletedTask()
    {
        var store = new FakeHistorianStore();
        store.ThrowOnAppendRunEvent = true;
        await using var writer = new HistorianWriter(store);

        var task = writer.RecordRunEventFireAndForget("Estop");

        var winner = await Task.WhenAny(task, Task.Delay(PollTimeout));
        Assert.Same(task, winner);
        await task; // must complete WITHOUT throwing even though the store threw internally
    }

    [Fact]
    public async Task DisposeAsync_DrainsQueuedRecords_AndCompletesWithoutHangingOrThrowing()
    {
        var store = new FakeHistorianStore();
        var writer = new HistorianWriter(store);

        writer.Enqueue(NewRecord("D1"));
        writer.Enqueue(NewRecord("D2"));

        // Let the (ungated) flush loop actually drain these before we tear down, so the dispose-time
        // assertion below isn't racing the loop's very first channel read against cts.Cancel() — a race
        // the brief explicitly calls out as acceptable to sidestep ("if timing makes strict drain-guarantee
        // flaky, assert DisposeAsync completes without hanging and does not throw").
        await WaitUntilAsync(
            () => store.AppendedResultsSnapshot().Count(r => r.MachineCode is "D1" or "D2") == 2,
            "both records flushed before shutdown");

        var disposeTask = writer.DisposeAsync().AsTask();
        var winner = await Task.WhenAny(disposeTask, Task.Delay(PollTimeout));
        Assert.Same(disposeTask, winner);
        await disposeTask; // must not throw

        var recorded = store.AppendedResultsSnapshot();
        Assert.Contains(recorded, r => r.MachineCode == "D1");
        Assert.Contains(recorded, r => r.MachineCode == "D2");
    }

    /// <summary>
    /// Minimal fake of the frozen <see cref="IHistorianStore"/> contract. Only the two members
    /// <see cref="HistorianWriter"/> actually calls (<see cref="AppendResultsAsync"/>,
    /// <see cref="AppendRunEventAsync"/>) are implemented for real; everything else throws
    /// <see cref="NotSupportedException"/> because it is unused by the writer under test.
    /// </summary>
    private sealed class FakeHistorianStore : IHistorianStore
    {
        private readonly object _lock = new();
        private readonly List<HistorianResultRecord> _appendedResults = new();
        private readonly List<HistorianRunEvent> _appendedRunEvents = new();
        private int _throwRemaining;

        /// <summary>When set, <see cref="AppendResultsAsync"/> awaits this before doing anything else —
        /// lets a test hold the flush loop's store call open indefinitely to prove Enqueue never waits on it.</summary>
        public TaskCompletionSource? Gate { get; set; }

        /// <summary>Incremented synchronously at the START of every <see cref="AppendResultsAsync"/> call
        /// (before the gate/throw logic) — lets a test deterministically wait for "the loop has picked up a
        /// batch" without caring whether that attempt goes on to throw or succeed.</summary>
        public int AppendAttempts;

        public bool ThrowOnAppendRunEvent { get; set; }

        public void ThrowNTimesThenSucceed(int n) => _throwRemaining = n;

        public IReadOnlyList<HistorianResultRecord> AppendedResultsSnapshot()
        {
            lock (_lock) return _appendedResults.ToList();
        }

        public IReadOnlyList<HistorianRunEvent> AppendedRunEventsSnapshot()
        {
            lock (_lock) return _appendedRunEvents.ToList();
        }

        public async Task AppendResultsAsync(IReadOnlyList<HistorianResultRecord> records, CancellationToken ct)
        {
            Interlocked.Increment(ref AppendAttempts);

            if (Gate is { } gate)
            {
                await gate.Task;
            }

            var shouldThrow = false;
            lock (_lock)
            {
                if (_throwRemaining > 0)
                {
                    _throwRemaining--;
                    shouldThrow = true;
                }
            }

            if (shouldThrow)
            {
                throw new InvalidOperationException("FakeHistorianStore: induced failure for the current test.");
            }

            lock (_lock)
            {
                _appendedResults.AddRange(records);
            }
        }

        public Task AppendRunEventAsync(HistorianRunEvent runEvent, CancellationToken ct)
        {
            if (ThrowOnAppendRunEvent)
            {
                throw new InvalidOperationException("FakeHistorianStore: induced run-event failure for the current test.");
            }

            lock (_lock)
            {
                _appendedRunEvents.Add(runEvent);
            }

            return Task.CompletedTask;
        }

        public Task<HistorianResultsPage> QueryResultsAsync(HistorianResultQuery query, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<HistorianResultRow>> QueryBySerialAsync(string serialNumber, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<TelemetrySamplePoint>> QueryTelemetryAsync(string machineCode, string metric, DateTimeOffset from, DateTimeOffset to, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<OeeInputAggregate> AggregateForOeeAsync(string machineCode, DateTimeOffset from, DateTimeOffset to, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<HistorianRunEvent>> QueryRunEventsAsync(DateTimeOffset from, DateTimeOffset to, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<int> PruneOlderThanAsync(DateTimeOffset cutoffUtc, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<HistorianStats> GetStatsAsync(CancellationToken ct) =>
            throw new NotSupportedException();
    }
}
