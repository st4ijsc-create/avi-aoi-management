namespace St4i.EdgeCore.Transport;

/// <summary>
/// WS-C-T4 — the idle-backlog drain the SDK's own opportunistic replay can't provide:
/// <see cref="LiveTransport.SendAsync"/> only replays a buffered backlog as a SIDE EFFECT of sending
/// something NEW (see the SDK's own <c>SendWithRetryAsync</c>), so a machine that goes quiet right after
/// an outage — nothing left to send, or the operator switched it off — never drains what is sitting on
/// disk until it happens to send again, which may be never. <see cref="WalFlushPump"/> is a background
/// timer that calls <see cref="LiveTransport.FlushBacklogAsync"/> on its own schedule, with no new
/// traffic required to trigger it.
///
/// Modeled directly on <see cref="St4i.EdgeCore.Historian.HistorianWriter"/>: <see cref="IAsyncDisposable"/>,
/// its own <see cref="CancellationTokenSource"/>, a <see cref="Task.Run(Func{Task})"/> loop started from
/// the constructor, and dependency-lean delegate log hooks (<c>Action&lt;string&gt;?</c> /
/// <c>Action&lt;Exception, string&gt;?</c>, NOT <c>Microsoft.Extensions.Logging.ILogger</c> — this
/// project is intentionally logging-framework-free; a host wires these to its own <c>ILogger</c> when it
/// constructs the pump, exactly like <see cref="St4i.EdgeCore.Historian.HistorianWriter"/> already does).
///
/// <c>getLive</c>'s delegate indirection (rather than a captured <see cref="LiveTransport"/>
/// instance) is deliberate: <c>TransportCoordinator.RebuildLive</c> can swap in a fresh
/// <see cref="LiveTransport"/> at any time (a Settings edit), and <c>TransportCoordinator.Mode</c> can
/// flip away from Live at any time too. Re-fetching both fresh on every tick — rather than resolving
/// once in the constructor — means a rebuild or a mode switch is transparent to this pump with no event
/// wiring of its own. Returning <c>null</c> (Mode is Demo/Auto, or no live transport is available) makes
/// the tick a clean, silent no-op: durability (and, with it, this pump's job) only applies while
/// Mode==Live — see the WS-C blueprint's own "Auto-mode caveat" remarks.
/// </summary>
public sealed class WalFlushPump : IAsyncDisposable
{
    private static readonly TimeSpan DefaultInterval = TimeSpan.FromSeconds(15);

    private readonly Func<LiveTransport?> _getLive;
    private readonly TimeSpan _interval;
    private readonly WalOptions? _walOptions;
    private readonly Action<string>? _logInfo;
    private readonly Action<Exception, string>? _logError;
    private readonly CancellationTokenSource _cts = new();
    private readonly Task _loop;
    private volatile bool _disposed;

    /// <param name="getLive">Asked afresh on every tick for the transport to drain, and required. Its
    /// <see langword="null"/> answer is not an error but the NORMAL way this pump stands down: both
    /// composition roots pass a delegate that returns null unless the coordinator's mode is exactly Live,
    /// so a host in Demo or Auto ticks forever and drains nothing. That has a consequence worth stating
    /// in the unfavourable direction: a backlog written while Live stops being drained the moment an
    /// operator switches away, and stays on disk until the mode comes back. A delegate that THROWS is
    /// tolerated — the tick is logged as failed and the loop survives — which is deliberate, because this
    /// delegate reads state another thread may be rebuilding.</param>
    /// <param name="interval">How long the loop waits between ticks; defaults to 15 seconds. The wait
    /// comes FIRST, so nothing is drained until one interval after construction — a restart with a full
    /// queue stays full for that long unless something else replays it. It is a delay between ticks and
    /// not a period: a tick that takes longer than this does not shorten the next wait, so the real
    /// cadence is this plus however long a flush takes.</param>
    /// <param name="logInfo">Optional (defaults to no-op) — invoked ONLY on a tick that actually drained
    /// something, and once more when a size trim actually dropped something. A quiet log is therefore
    /// evidence of nothing at all: it reads identically for a pump that is draining nothing because there
    /// is nothing queued, and for a pump that is standing down every tick because the mode is not Live.
    /// A plain delegate rather than a logging framework, matching this project's convention.</param>
    /// <param name="logError">Optional (defaults to no-op) — the only channel by which a failing tick is
    /// reported anywhere. Nothing else observes the loop: the task it runs on is never awaited except at
    /// disposal, and disposal swallows what it catches, so a caller that passes nothing here gets a pump
    /// that can fail silently every tick forever.</param>
    /// <param name="walOptions">WS-C-T5 — optional (defaults to <see langword="null"/> so every
    /// pre-existing call site/test that constructs a <see cref="WalFlushPump"/> without one keeps
    /// compiling and behaving byte-for-byte unchanged) size guardrail: when provided AND
    /// <see cref="WalOptions.Enabled"/>, every tick also runs <see cref="WalMaintenance.TrimDirectory"/>
    /// against it — see <see cref="RunLoopAsync"/>'s remarks for why this runs regardless of whether
    /// <paramref name="getLive"/> returned a live transport this tick (the size cap applies to whatever
    /// is sitting on disk, independent of the CURRENT transport mode).</param>
    public WalFlushPump(
        Func<LiveTransport?> getLive,
        TimeSpan? interval = null,
        WalOptions? walOptions = null,
        Action<string>? logInfo = null,
        Action<Exception, string>? logError = null)
    {
        _getLive = getLive ?? throw new ArgumentNullException(nameof(getLive));
        _interval = interval ?? DefaultInterval;
        _walOptions = walOptions;
        _logInfo = logInfo;
        _logError = logError;

        _loop = Task.Run(() => RunLoopAsync(_cts.Token));
    }

    /// <summary>Fires with the number of records a tick actually drained (<c>sent</c>) — only when that
    /// count is greater than 0. A tick that finds nothing queued, or is skipped because
    /// <see cref="_getLive"/> returned null (or threw), never raises this.</summary>
    public event Action<int>? BacklogDrained;

    private async Task RunLoopAsync(CancellationToken ct)
    {
        while (true)
        {
            try
            {
                await Task.Delay(_interval, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // DisposeAsync canceled the token while this tick was waiting for its next turn —
                // shutting down, nothing to report, nothing left to drain that the next process's own
                // pump/opportunistic replay won't pick up from disk.
                return;
            }

            try
            {
                var live = _getLive();
                if (live is not null)
                {
                    var (sent, kept) = await live.FlushBacklogAsync(ct).ConfigureAwait(false);
                    if (sent > 0)
                    {
                        _logInfo?.Invoke($"WAL drained {sent} buffered record(s), {kept} remaining");
                        BacklogDrained?.Invoke(sent);
                    }
                }
                // else: Mode != Live this tick (or no LiveTransport yet) — nothing to drain, but the
                // size guardrail below still runs regardless (see its own remarks just below).

                // WS-C-T5 — the size guardrail, invoked AFTER the drain attempt above (never before):
                // draining first shrinks the file on its own, minimizing how much (if anything) is left
                // for the trim to drop, and narrows WalMaintenance's own documented best-effort
                // concurrent-access window (see its class doc) to the smallest slice of this tick.
                // Deliberately NOT gated on `live is not null` — the on-disk size cap must hold regardless
                // of THIS tick's transport mode (e.g. a backlog left over from a Live outage before a
                // switch to Demo must still get trimmed, not grow forever just because Mode moved on).
                if (_walOptions is { Enabled: true })
                {
                    var dropped = WalMaintenance.TrimDirectory(_walOptions);
                    if (dropped > 0)
                    {
                        _logInfo?.Invoke($"WAL trimmed {dropped} oldest record(s) over MaxBytes");
                    }
                }
            }
            catch (OperationCanceledException)
            {
                // Shutdown mid-flush (DisposeAsync canceled while FlushBacklogAsync was in flight) —
                // nothing to report; the loop exits cleanly on its next iteration's Task.Delay above.
            }
            catch (Exception ex)
            {
                // A single tick's failure — getLive() threw, or the flush itself threw — must never
                // kill the loop: the whole point of this pump is that the NEXT tick still gets a chance
                // to drain, e.g. after a transient RebuildLive race or a still-flaky connection.
                _logError?.Invoke(ex, "WAL flush pump tick failed");
            }
        }
    }

    /// <summary>Cancels the loop and awaits it. No drain-first semantics to preserve here (unlike
    /// <see cref="St4i.EdgeCore.Historian.HistorianWriter"/>'s channel of not-yet-persisted writes): a
    /// timer tick has nothing of its own queued that cancelling immediately would lose — whatever
    /// backlog is still on disk stays on disk, untouched, for the next process's own pump (or
    /// opportunistic replay) to pick up.</summary>
    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;

        _cts.Cancel();
        try
        {
            await _loop.ConfigureAwait(false);
        }
        catch
        {
            // Best-effort shutdown — the loop already reports its own tick failures via logError.
        }

        _cts.Dispose();
    }
}
