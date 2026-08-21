using System.Diagnostics;
using System.Globalization;
using St4i.EdgeCore.Historian;
using Xunit;

namespace St4i.EdgeCore.Tests.Historian;

/// <summary>
/// 🔴 Task AT-1 — owner item 16, the OWNER'S RULING of 2026-08-22. Witnesses for the ONE deferred
/// transaction that <see cref="SqliteHistorianStore.AggregateForOeeAsync"/> now wraps its four reads in.
/// <para>These are WITNESSES, not guards: each one was measured RED against the code as it stood before
/// the fix, and the counterfactual that reddens it is named on the test itself. The distinction matters
/// in this repository because a test that is green on both sides of a change measures nothing.</para>
/// <para>The fault being witnessed is a RACE, so neither test can be red by construction on a machine
/// that never interleaves. Both therefore assert a floor on how much work they actually did — a run that
/// never opened the race window fails as inconclusive rather than passing vacuously.</para>
/// </summary>
// Joins this collection for the PROCESS-WIDE SQLITE CONNECTION POOL, the same reason
// SqliteHistorianStoreQueryTests does — see SiteTestCollection for the membership rule.
[Collection("St4i.EdgeCore.Tests.Site")]
public sealed class OeeAggregateSnapshotUnderConcurrentWriterTests : IDisposable
{
    private readonly List<string> _tempDirs = new();

    public void Dispose()
    {
        foreach (var dir in _tempDirs)
        {
            try { Directory.Delete(dir, recursive: true); } catch { /* best-effort cleanup */ }
        }
    }

    private SqliteHistorianStore NewStore()
    {
        var dir = Directory.CreateTempSubdirectory("st4i-oee-race-").FullName;
        _tempDirs.Add(dir);
        return new SqliteHistorianStore(dir);
    }

    private static readonly DateTimeOffset From = new(2026, 8, 22, 0, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset To = new(2026, 8, 22, 23, 0, 0, TimeSpan.Zero);

    // Every row is a Pass ProcessResult inside the window, so good == total AT REST. Any observation of
    // good > total is therefore the interleaving and nothing else — there is no verdict mix to explain it.
    private static HistorianResultRecord PassRow(long i) => new(
        MachineCode: "RACE-01", DeviceClass: "AoiAvi", MachineType: "AOI", ReadingKind: "ProcessResult",
        CycleCounter: i, SerialNumber: "SN-" + i.ToString(CultureInfo.InvariantCulture), Verdict: "Pass",
        RecipeCode: null, RecipeVersion: null, KeyMetricName: null, KeyMetricValue: null, KeyMetricUnit: null,
        NgCount: 0, PointCount: 0, AckSuccess: true, AckDuplicate: false, AckQueued: false,
        GenealogyJson: null, MeasurementsJson: null,
        EventTimeUtc: From.AddSeconds(1 + (i % 60000)),
        IngestedAtUtc: From.AddSeconds(1 + (i % 60000)),
        TelemetrySamples: Array.Empty<TelemetrySampleRecord>(),
        IsFabricated: false);

    /// <summary>🔴 THE WITNESS FOR THE SNAPSHOT. Reddens if the transaction in
    /// <see cref="SqliteHistorianStore.AggregateForOeeAsync"/> is removed: without it SQLite in WAL gives
    /// each of the four statements its own snapshot, a concurrent commit lands between the total and the
    /// good count, and the aggregate reports more good units than total ones — which
    /// <c>OeeCalculator.Calculate</c> turns into a Quality above 1 and an OEE above 100 %.</summary>
    [Fact]
    public async Task AggregateForOee_never_reports_more_good_than_total_while_a_writer_commits_concurrently()
    {
        var store = NewStore();
        await store.AppendResultsAsync(new[] { PassRow(0) }, CancellationToken.None);

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(6));
        long written = 0;

        var writer = Task.Run(async () =>
        {
            long i = 1;
            while (!cts.IsCancellationRequested)
            {
                try
                {
                    await store.AppendResultsAsync(new[] { PassRow(i++) }, cts.Token);
                    Interlocked.Increment(ref written);
                }
                catch (OperationCanceledException) { break; }
                catch (Exception) { /* the reader is the instrument; a contended write is not the finding */ }
            }
        });

        long reads = 0;
        var violations = new List<string>();
        while (!cts.IsCancellationRequested)
        {
            OeeInputAggregate agg;
            try { agg = await store.AggregateForOeeAsync("RACE-01", From, To, cts.Token); }
            catch (OperationCanceledException) { break; }
            reads++;
            if (agg.GoodCount > agg.TotalCount)
            {
                violations.Add($"good={agg.GoodCount} total={agg.TotalCount} quality={(double)agg.GoodCount / agg.TotalCount:F6}");
                if (violations.Count >= 5) break;
            }
        }

        try { await writer; } catch { /* ignore */ }

        // 🔴 ORDER MATTERS, and getting it wrong once is why it is spelled out. A violation is CONCLUSIVE:
        // it is reported first, before any floor on how much work the run did. The floors below only decide
        // whether a run with NO violation is evidence of anything — put them first and a run that reddens on
        // its very first read fails with "the race window never opened", which is the opposite of what
        // happened.
        Assert.True(violations.Count == 0,
            $"AggregateForOeeAsync returned GoodCount > TotalCount on {violations.Count} of {reads} reads — " +
            $"the four reads are not sharing one snapshot. Samples: {string.Join(" | ", violations)}");

        // Inconclusive-rather-than-vacuous: a clean run only counts if the window was actually open.
        Assert.True(reads >= 25, $"race window never opened: only {reads} aggregate reads completed");
        Assert.True(Interlocked.Read(ref written) > 0, "the concurrent writer never committed a row");
    }

    /// <summary>🔴 THE WITNESS FOR THE LOCK PRICE, and it is a SEPARATE fault from the one above. Reddens
    /// if that transaction is opened with <c>connection.BeginTransaction()</c> instead of
    /// <c>BeginTransaction(deferred: true)</c>: the parameterless overload issues <c>BEGIN IMMEDIATE</c>,
    /// which takes SQLite's write lock for a method that only reads, and this aggregate sits on three
    /// synchronous request paths. Measured against that overload a concurrent writer does not merely slow
    /// down — it fails outright with <c>SQLite Error 5: database is locked</c>.
    /// <para>Both counts are asserted the same way round: the deferred form must let the writer through
    /// while aggregates are running back to back.</para></summary>
    [Fact]
    public async Task AggregateForOee_does_not_take_the_write_lock_a_concurrent_writer_needs()
    {
        var store = NewStore();

        // Enough rows that one aggregate is milliseconds rather than microseconds, so a back-to-back read
        // loop holds whatever it holds for most of the wall clock. The count is a DETECTION-RATE knob, not
        // a correctness one: each iteration also opens a connection and replays four pragmas OUTSIDE the
        // transaction, and a write slipping through that gap is a miss. More rows per read = a larger
        // locked fraction = a witness that reddens more often.
        var seed = new List<HistorianResultRecord>();
        for (var i = 0; i < 30000; i++) seed.Add(PassRow(i));
        await store.AppendResultsAsync(seed, CancellationToken.None);

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        long aggregates = 0;
        Exception? readerFault = null;

        // FOUR concurrent read loops, not one. Each aggregate leaves the lock free while it opens a
        // connection and replays four pragmas, and a single loop misses often enough that the witness only
        // reddened on about half its runs. Four loops keep a write lock — if one is being taken at all —
        // held essentially continuously. Under the deferred form they are all pure readers and neither
        // block each other nor anyone else, which is the whole point.
        var readers = Enumerable.Range(0, 4).Select(_ => Task.Run(async () =>
        {
            while (!cts.IsCancellationRequested)
            {
                try { await store.AggregateForOeeAsync("RACE-01", From, To, cts.Token); Interlocked.Increment(ref aggregates); }
                catch (OperationCanceledException) { break; }
                catch (Exception ex) { Interlocked.CompareExchange(ref readerFault, ex, null); break; }
            }
        })).ToArray();

        // Let the read loop actually get going before anything is timed against it — otherwise this test
        // races its own instrument and can report a lock price it never measured.
        var warmup = Stopwatch.StartNew();
        while (Interlocked.Read(ref aggregates) < 5 && warmup.Elapsed < TimeSpan.FromSeconds(5) && readerFault is null)
        {
            await Task.Delay(10);
        }
        var warmedUpAt = Interlocked.Read(ref aggregates);

        var failures = new List<string>();
        var slowest = TimeSpan.Zero;
        for (var w = 0; w < 50; w++)
        {
            var sw = Stopwatch.StartNew();
            try { await store.AppendResultsAsync(new[] { PassRow(900000 + w) }, CancellationToken.None); }
            catch (Exception ex) { failures.Add(ex.GetType().Name + ": " + ex.Message); }
            sw.Stop();
            if (sw.Elapsed > slowest) slowest = sw.Elapsed;
        }

        cts.Cancel();
        try { await Task.WhenAll(readers); } catch { /* ignore */ }

        // A read that refuses another read is the same fault seen from the other side: only a write lock
        // can do that, and this method must not be taking one.
        Assert.True(readerFault is null,
            $"AggregateForOeeAsync refused a CONCURRENT AggregateForOeeAsync — it is holding a write lock: " +
            $"{readerFault?.GetType().Name}: {readerFault?.Message}");
        Assert.True(failures.Count == 0,
            $"a concurrent writer was refused while AggregateForOeeAsync was reading: {string.Join(" | ", failures)}");
        Assert.True(slowest < TimeSpan.FromSeconds(2),
            $"a concurrent write waited {slowest.TotalMilliseconds:F0} ms behind the aggregate's transaction");

        // Inconclusive-rather-than-vacuous, and last for the same reason as in the witness above. Overlap
        // needs no counter of its own: a read loop leaves only on cancellation — which happens AFTER the
        // timed writes — or on a fault already asserted above, so a warmed-up, unfaulted loop was by
        // construction running for the whole write window. Counting COMPLETIONS during that window instead
        // measured the scheduler and reddened this test on a correct build roughly one run in three.
        Assert.True(warmedUpAt >= 5,
            $"the read loops never got going: only {warmedUpAt} aggregates ran");
    }
}
