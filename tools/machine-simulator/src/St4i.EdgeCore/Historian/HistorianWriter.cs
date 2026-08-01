using System.Threading.Channels;

namespace St4i.EdgeCore.Historian;

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

    public HistorianWriter(
        IHistorianStore store,
        Action<string>? logWarning = null,
        Action<Exception, string>? logError = null,
        int capacity = 10_000)
    {
        _store = store ?? throw new ArgumentNullException(nameof(store));
        _logWarning = logWarning;
        _logError = logError;

        _channel = Channel.CreateBounded<HistorianResultRecord>(new BoundedChannelOptions(capacity)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
        });

        _flushLoop = Task.Run(() => RunFlushLoopAsync(_cts.Token));
    }

    /// <summary>Non-blocking, safe on the EdgePipeline commit thread: TryWrite only, never an await, never a
    /// throw. If the bounded channel is full/completed the record is dropped (oldest queued record, per the
    /// channel's <see cref="BoundedChannelFullMode.DropOldest"/> policy) and <c>logWarning</c> is called. A
    /// call arriving after <see cref="DisposeAsync"/> is likewise dropped (with its own message) rather than
    /// touching the completed channel/disposed token.</summary>
    public void Enqueue(HistorianResultRecord record)
    {
        if (_disposed)
        {
            _logWarning?.Invoke($"Historian writer already disposed — dropped record for {record.MachineCode}");
            return;
        }

        if (!_channel.Writer.TryWrite(record))
        {
            _logWarning?.Invoke($"Historian queue saturated — dropped oldest for {record.MachineCode}");
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
