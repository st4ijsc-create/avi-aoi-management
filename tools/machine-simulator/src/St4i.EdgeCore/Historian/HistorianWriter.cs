using System.Threading.Channels;

namespace St4i.EdgeCore.Historian;

/// <summary>
/// 🔴 Task AP-1 (owner decision 15, 2026-08-21) — this writer's own drop accounting, CLASSIFIED, because
/// the two ways a record is lost here mean opposite things to an operator and a single total cannot say
/// which happened. The shape is <c>St4i.EngineApi.Alarms.AlarmNotifierStats</c>'s, ported back (named in
/// text rather than by <c>cref</c> because St4i.EdgeCore does not reference St4i.EngineApi — the reference
/// runs the other way, which is itself why the pattern only ever travelled outward from here): that class
/// had already solved this exact problem and recorded in its own doc comment that it copied its channel
/// shape FROM this one, so the wrong half of the pattern was the half being propagated.
/// </summary>
/// <param name="Evicted">Records the CHANNEL threw away because it was FULL when a new record arrived — the
/// <see cref="BoundedChannelFullMode.DropOldest"/> eviction that <c>TryWrite</c> performs while still
/// returning <see langword="true"/>. Counted from the channel's own <c>itemDropped</c> callback, which is
/// the ONLY place this loss is observable at all. Any non-zero value means the historian store is not
/// keeping up and production history has been lost.</param>
/// <param name="DroppedAfterShutdown">Records refused because this writer was already disposed, or because
/// its channel writer had been completed by <see cref="HistorianWriter.DisposeAsync"/>. Expected during a
/// clean shutdown and NOT a sign that the store is falling behind — which is exactly why it is a separate
/// number rather than folded into <paramref name="Evicted"/>.</param>
/// <param name="Queued">How deep the channel is RIGHT NOW — a gauge, not a cumulative counter. A
/// persistently non-zero depth is a store that is slower than the pipeline's commit rate.</param>
public sealed record HistorianWriterStats(long Evicted, long DroppedAfterShutdown, int Queued);

/// <summary>
/// WS-A-T6 — bounded-channel write-behind that decouples the EdgePipeline's hot commit thread from the
/// (potentially slow) <see cref="IHistorianStore"/> backing it. <see cref="Enqueue"/> is synchronous,
/// non-blocking, and never throws — it is safe to call from the pipeline's commit path on every reading. A
/// background flush loop drains batches of up to 256 queued records at a time and appends them to the
/// store; a store that throws (or a shutdown mid-append) never kills the loop — the failure is reported via
/// <c>logError</c> and the loop keeps going.
///
/// <see cref="St4i.EdgeCore"/> is intentionally dependency-lean and does not reference
/// Microsoft.Extensions.Logging. Rather than take on that dependency for this one type, the two optional
/// logging call sites are exposed as plain delegates — a host with a real logging pipeline (e.g.
/// St4i.EngineApi) wires these to its own <c>ILogger</c> when it constructs the writer.
/// </summary>
public sealed class HistorianWriter : IAsyncDisposable
{
    private const int MaxBatchSize = 256;

    private readonly IHistorianStore _store;
    private readonly Action<string>? _logWarning;
    private readonly Action<Exception, string>? _logError;
    private readonly Channel<HistorianResultRecord> _channel;
    private readonly CancellationTokenSource _cts = new();
    private readonly Task _flushLoop;
    private volatile bool _disposed;

    /// <summary>🔴 Task AP-1 — see <see cref="HistorianWriterStats.Evicted"/>. Incremented ONLY from the
    /// channel's <c>itemDropped</c> callback, which fires synchronously from inside <c>TryWrite</c> on the
    /// calling thread. <see cref="Enqueue"/> has no lock (it runs on the EdgePipeline commit thread and must
    /// never take one), so unlike the notifier this counter is <see cref="Interlocked"/>-managed rather than
    /// gate-guarded, and the "did MY write evict something?" question is therefore not answered by bracketing
    /// it — the warning is raised from inside the callback instead, where it is exact.</summary>
    private long _evicted;

    /// <summary>🔴 Task AP-1 — see <see cref="HistorianWriterStats.DroppedAfterShutdown"/>.</summary>
    private long _droppedAfterShutdown;

    /// <summary>Starts the background flush loop immediately — construction is the point at which this type
    /// becomes live, and there is no separate Start. The loop runs until
    /// <see cref="DisposeAsync"/>, so a writer that is constructed and forgotten keeps a task and a
    /// cancellation source alive for the lifetime of the process.</summary>
    /// <param name="store">The backing store every drained batch is appended to. This writer takes no
    /// ownership of it: it is never disposed here, and a store that throws is reported and retried with the
    /// NEXT batch rather than reconnected — the failed batch is gone.</param>
    /// <param name="logWarning">Where a DROPPED record is reported. Optional, and a null here makes the two
    /// drop paths silent rather than fatal. See the correction on <see cref="Enqueue"/> for which drop this
    /// actually reaches, because it is not the one the message text describes.
    /// <para>🔴 <b>"WHICH DROP THIS ACTUALLY REACHES" IS NOW BOTH OF THEM — task AP-1, 2026-08-21 (owner
    /// decision 15).</b> The sentence above is kept because it was true when written and the correction it
    /// points at is still the record of why. What changed is the code: the SATURATION drop now reports here
    /// too, from the channel's own <c>itemDropped</c> callback, and it is worded as saturation while the
    /// completed-writer path is worded as shutdown. Invocations from the callback are wrapped
    /// (<see cref="SafeLogWarning"/>) because that callback runs INSIDE <c>TryWrite</c>: a throwing delegate
    /// there would escape <see cref="Enqueue"/>, whose contract is never-throws.</para></param>
    /// <param name="logError">Where a failed flush is reported, with the exception and the size of the batch
    /// that was lost. Optional. A cancellation raised by shutdown is deliberately NOT routed here — it is not
    /// a failure — so a quiet log during shutdown is the expected shape.</param>
    /// <param name="capacity">How many RECORDS may sit un-flushed at once, not bytes and not batches. The
    /// channel is bounded at this many, and the batch the loop drains at a time is a separate, fixed
    /// 256 — so this is the depth of the buffer, not the size of a write. Over-running it costs the OLDEST
    /// queued record: the newest reading is always accepted, and what is lost is the oldest history not yet
    /// on disk.</param>
    public HistorianWriter(
        IHistorianStore store,
        Action<string>? logWarning = null,
        Action<Exception, string>? logError = null,
        int capacity = 10_000)
    {
        _store = store ?? throw new ArgumentNullException(nameof(store));
        _logWarning = logWarning;
        _logError = logError;

        _channel = Channel.CreateBounded<HistorianResultRecord>(
            new BoundedChannelOptions(capacity)
            {
                FullMode = BoundedChannelFullMode.DropOldest,
                SingleReader = true,
            },
            // 🔴 Task AP-1 (owner decision 15) — THE ONLY PLACE THE SATURATION LOSS IS OBSERVABLE. Under
            // DropOldest, TryWrite on a FULL channel evicts the oldest record and returns true, so the
            // `if (!TryWrite(...))` branch below is never reached by saturation and, without this callback,
            // up to `capacity` rows of production history disappear with no log, no counter and no line on
            // /v1/health. Fires synchronously from inside TryWrite, on the caller's thread — the record
            // handed in is the one being THROWN AWAY, which is why the message can name it (the old text
            // named the arriving record instead, and called it "oldest").
            itemDropped: dropped =>
            {
                Interlocked.Increment(ref _evicted);
                SafeLogWarning(
                    $"Historian queue saturated — evicted the OLDEST queued record ({dropped.MachineCode}, " +
                    $"cycle {dropped.CycleCounter}) to make room. That history is gone; the historian store " +
                    "is not keeping up. See HistorianWriter.Stats.Evicted.");
            });

        _flushLoop = Task.Run(() => RunFlushLoopAsync(_cts.Token));
    }

    /// <summary>🔴 Task AP-1 (owner decision 15) — classified drop accounting: how much history this writer
    /// has thrown away, split by WHY. See <see cref="HistorianWriterStats"/> for what each number means and
    /// why the split is the point. Cheap: three reads, no lock.</summary>
    public HistorianWriterStats Stats => new(
        Interlocked.Read(ref _evicted),
        Interlocked.Read(ref _droppedAfterShutdown),
        _channel.Reader.Count);

    /// <summary>🔴 Task AP-1 — a caller-supplied logging delegate that throws must never escape
    /// <see cref="Enqueue"/> (documented never-throws) nor the channel's <c>itemDropped</c> callback, which
    /// runs inside <c>TryWrite</c>. Same guard <c>UnsBridge.SafeLogWarning</c> already uses.</summary>
    private void SafeLogWarning(string message)
    {
        try { _logWarning?.Invoke(message); } catch { /* logging must never take the commit thread down */ }
    }

    /// <summary>Non-blocking, safe on the EdgePipeline commit thread: TryWrite only, never an await, never a
    /// throw. If the bounded channel is full/completed the record is dropped (oldest queued record, per the
    /// channel's <see cref="BoundedChannelFullMode.DropOldest"/> policy) and <c>logWarning</c> is called. A
    /// call arriving after <see cref="DisposeAsync"/> is likewise dropped (with its own message) rather than
    /// touching the completed channel/disposed token.
    ///
    /// <para>🔴 <b>"...IS FULL ... AND <c>logWarning</c> IS CALLED" IS WITHDRAWN, 2026-08-20, task AL-1
    /// (owner item 12, stage 6)</b> — quoted and retired in place. Both halves are true separately and the
    /// sentence joins them wrongly. Under
    /// <see cref="BoundedChannelFullMode.DropOldest"/> a write to a FULL channel SUCCEEDS: the oldest queued
    /// record is evicted and <c>TryWrite</c> returns <see langword="true"/>, so the branch below is not
    /// taken and nothing is logged. The saturation drop this product actually suffers — the one the message
    /// text names — is therefore SILENT, and the message is reachable only on a channel that has been
    /// COMPLETED, i.e. a call that raced past the <c>_disposed</c> check during shutdown. Nothing in this
    /// repository asserts either path. Retired rather than corrected: making the message match the sentence
    /// is a code change and this task writes prose only.</para>
    ///
    /// <para>🔴 <b>THE CODE CHANGE THE BLOCK ABOVE DEFERRED HAS NOW BEEN MADE — task AP-1, 2026-08-21, owner
    /// decision 15.</b> The withdrawal stands exactly as written and is not edited; what follows is what the
    /// branch does now. The saturation drop is no longer silent: it is counted
    /// (<see cref="HistorianWriterStats.Evicted"/>) and reported from the channel's own <c>itemDropped</c>
    /// callback, which is where it is actually observable. The branch below is left in place, because it IS
    /// reachable — on a channel whose writer <see cref="DisposeAsync"/> has completed while a call raced past
    /// the <c>_disposed</c> check — and its message now says THAT, instead of describing a saturation it can
    /// never see. Both drops are counted; they are counted SEPARATELY, because "the store is not keeping up"
    /// and "the process is exiting" are opposite operational messages and telling an operator the first one
    /// during a clean shutdown sends them after a problem that does not exist.</para></summary>
    public void Enqueue(HistorianResultRecord record)
    {
        if (_disposed)
        {
            Interlocked.Increment(ref _droppedAfterShutdown);
            SafeLogWarning(
                $"Historian writer already disposed — dropped record for {record.MachineCode}. Expected " +
                "during shutdown; this does NOT mean the historian store is falling behind.");
            return;
        }

        if (!_channel.Writer.TryWrite(record))
        {
            // Reachable ONLY on a completed writer, i.e. a call that raced past the _disposed check while
            // DisposeAsync was running. Saturation does not come here — see the itemDropped callback.
            Interlocked.Increment(ref _droppedAfterShutdown);
            SafeLogWarning(
                $"Historian writer is shutting down (queue closed) — dropped record for {record.MachineCode}. " +
                "Expected during shutdown; this does NOT mean the historian store is falling behind.");
        }
    }

    /// <summary>Rare human-triggered run events (Start/Stop/Estop/EstopReset). Fire-and-forget: wraps
    /// <see cref="IHistorianStore.AppendRunEventAsync"/> in an exception-swallowing <see cref="Task"/>.
    /// Returns the <see cref="Task"/> so callers may <c>_ = writer.RecordRunEventFireAndForget("Start");</c>
    /// without awaiting, while still allowing a test (or a caller that cares) to observe completion. A call
    /// arriving after <see cref="DisposeAsync"/> is dropped up front instead of touching the disposed
    /// <see cref="CancellationTokenSource"/>.</summary>
    public Task RecordRunEventFireAndForget(string eventType, string? note = null)
    {
        if (_disposed)
        {
            _logWarning?.Invoke($"Historian writer already disposed — dropped run-event '{eventType}'");
            return Task.CompletedTask;
        }

        return Task.Run(async () =>
        {
            try
            {
                await _store.AppendRunEventAsync(new HistorianRunEvent(eventType, DateTimeOffset.UtcNow, note), _cts.Token);
            }
            catch (Exception ex)
            {
                _logError?.Invoke(ex, $"Historian run-event '{eventType}' failed");
            }
        });
    }

    private async Task RunFlushLoopAsync(CancellationToken ct)
    {
        var reader = _channel.Reader;
        var batch = new List<HistorianResultRecord>(MaxBatchSize);

        try
        {
            while (await reader.WaitToReadAsync(ct))
            {
                batch.Clear();
                while (batch.Count < MaxBatchSize && reader.TryRead(out var record))
                {
                    batch.Add(record);
                }

                if (batch.Count == 0) continue;

                try
                {
                    await _store.AppendResultsAsync(batch, ct);
                }
                catch (OperationCanceledException)
                {
                    // Shutdown in progress (DisposeAsync canceled while this append was in flight) — nothing
                    // to report, just move on (the outer while-condition will end the loop shortly).
                }
                catch (Exception ex)
                {
                    _logError?.Invoke(ex, $"Historian flush failed for {batch.Count} record(s)");
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Expected on shutdown: DisposeAsync cancels the token while WaitToReadAsync may be pending.
        }
    }

    /// <summary>Completes the channel writer (no more enqueues accepted) and awaits the flush loop
    /// DRAINING — deliberately does NOT cancel first: <c>WaitToReadAsync(ct)</c> prioritizes an
    /// already-cancelled token over any buffered items, so cancelling before the loop finishes would abandon
    /// still-queued records with no log, silently violating the "drains what it can" requirement. Because the
    /// token stays live during a clean shutdown, a completed-but-still-populated channel yields every
    /// remaining item to the loop (then <c>WaitToReadAsync</c> returns false and the loop exits normally),
    /// and the final <c>AppendResultsAsync</c> batch is written in full. Cancellation is only used as a
    /// bounded (5s) hard-stop if the store itself hangs — never throws, never hangs past that bound.</summary>
    public async ValueTask DisposeAsync()
    {
        _disposed = true;
        _channel.Writer.TryComplete();

        try
        {
            await _flushLoop.WaitAsync(TimeSpan.FromSeconds(5));
        }
        catch (TimeoutException)
        {
            // The store is hung (or otherwise never returning) — fall back to cancelling so the loop's
            // in-flight AppendResultsAsync/WaitToReadAsync call can unwind instead of blocking forever.
            _cts.Cancel();
            try
            {
                await _flushLoop;
            }
            catch
            {
                // Best-effort shutdown — the flush loop already reports its own failures via logError.
            }
        }

        _cts.Dispose();
    }
}
