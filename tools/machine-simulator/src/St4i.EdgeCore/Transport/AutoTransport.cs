using St4i.DeviceClient;
using St4i.EdgeCore.Models;

namespace St4i.EdgeCore.Transport;

/// <summary>
/// Keeps the exhibition app looking good when the real server is unreachable: tries <paramref
/// name="live"/> first for every call, and transparently re-routes to <paramref name="demo"/> the
/// moment live signals a network failure — either via <see cref="TransportAck"/>'s own "queued,
/// couldn't reach the server" shape (the contract <see cref="LiveTransport"/> already uses for
/// <see cref="St4iNetworkException"/>) or via a thrown <see cref="St4iNetworkException"/> straight out
/// of a live implementation that doesn't catch it itself.
///
/// While falling back, live is retried periodically (every <see cref="RetryEveryNCalls"/> calls) so the
/// booth recovers automatically once the server comes back — no restart needed.
/// </summary>
public sealed class AutoTransport : ITransport
{
    /// <summary>How often (in calls) to probe <c>live</c> again while in fallback, looking for recovery.</summary>
    private const int RetryEveryNCalls = 5;

    private readonly ITransport _live;
    private readonly ITransport _demo;

    /// <summary>Guards <see cref="IsFallingBack"/>'s read-then-write transition check — see <see cref="SetFallingBack"/>.</summary>
    private readonly object _gate = new();

    private long _callCount;

    public AutoTransport(ITransport live, ITransport demo)
    {
        _live = live ?? throw new ArgumentNullException(nameof(live));
        _demo = demo ?? throw new ArgumentNullException(nameof(demo));
    }

    public TransportMode Mode => TransportMode.Auto;

    /// <summary>
    /// Deliberately a SINGLE flag shared across <see cref="SendAsync"/>, <see cref="HeartbeatAsync"/> and
    /// <see cref="SyncConfigAsync"/> — a heartbeat or config-sync network failure will route a
    /// perfectly-healthy live <see cref="SendAsync"/> to demo too, rather than tracking three
    /// independent per-method flags. For this exhibition/edge tool erring toward demo (looking good)
    /// over staying on a possibly-flaky live path is the right tradeoff, and it's simpler — YAGNI on
    /// splitting this into per-method state unless a real need shows up.
    /// </summary>
    public bool IsFallingBack { get; private set; }

    public event Action<bool>? FallbackChanged;

    public async Task<TransportAck> SendAsync(CanonicalEnvelope env, CancellationToken ct)
    {
        if (!ShouldTryLiveThisCall())
        {
            return await _demo.SendAsync(env, ct).ConfigureAwait(false);
        }

        var (ack, networkFailed) = await TrySendLiveAsync(env, ct).ConfigureAwait(false);
        if (!networkFailed)
        {
            SetFallingBack(false);
            return ack!;
        }

        SetFallingBack(true);
        return await _demo.SendAsync(env, ct).ConfigureAwait(false);
    }

    public async Task<HeartbeatResult> HeartbeatAsync(string machineCode, CancellationToken ct)
    {
        if (!ShouldTryLiveThisCall())
        {
            return await _demo.HeartbeatAsync(machineCode, ct).ConfigureAwait(false);
        }

        HeartbeatResult result;
        try
        {
            result = await _live.HeartbeatAsync(machineCode, ct).ConfigureAwait(false);
        }
        catch (St4iNetworkException)
        {
            SetFallingBack(true);
            return await _demo.HeartbeatAsync(machineCode, ct).ConfigureAwait(false);
        }
        catch (St4iConfigException)
        {
            // Defense-in-depth for any ITransport implementation that throws St4iConfigException
            // directly rather than converting it to a failure result itself (LiveTransport, the normal
            // case, already does that conversion internally — see its own HeartbeatAsync — so this
            // branch is a belt-and-suspenders guard, not the primary path for the unconfigured-live
            // scenario).
            SetFallingBack(true);
            return await _demo.HeartbeatAsync(machineCode, ct).ConfigureAwait(false);
        }

        if (IsNetworkFailure(result))
        {
            SetFallingBack(true);
            return await _demo.HeartbeatAsync(machineCode, ct).ConfigureAwait(false);
        }

        SetFallingBack(false);
        return result;
    }

    public async Task<ConfigSyncResult> SyncConfigAsync(string machineCode, string configKind, string? cachedVersion, CancellationToken ct)
    {
        if (!ShouldTryLiveThisCall())
        {
            return await _demo.SyncConfigAsync(machineCode, configKind, cachedVersion, ct).ConfigureAwait(false);
        }

        ConfigSyncResult result;
        try
        {
            result = await _live.SyncConfigAsync(machineCode, configKind, cachedVersion, ct).ConfigureAwait(false);
        }
        catch (St4iNetworkException)
        {
            SetFallingBack(true);
            return await _demo.SyncConfigAsync(machineCode, configKind, cachedVersion, ct).ConfigureAwait(false);
        }
        catch (St4iConfigException)
        {
            // Defense-in-depth — see HeartbeatAsync's matching catch remarks above.
            SetFallingBack(true);
            return await _demo.SyncConfigAsync(machineCode, configKind, cachedVersion, ct).ConfigureAwait(false);
        }

        if (IsNetworkFailure(result))
        {
            SetFallingBack(true);
            return await _demo.SyncConfigAsync(machineCode, configKind, cachedVersion, ct).ConfigureAwait(false);
        }

        SetFallingBack(false);
        return result;
    }

    // ─────────────────────────────────────────────────────────────────────

    private async Task<(TransportAck? Ack, bool NetworkFailed)> TrySendLiveAsync(CanonicalEnvelope env, CancellationToken ct)
    {
        try
        {
            var ack = await _live.SendAsync(env, ct).ConfigureAwait(false);
            return IsNetworkFailure(ack) ? (null, true) : (ack, false);
        }
        catch (St4iNetworkException)
        {
            return (null, true);
        }
    }

    /// <summary>
    /// While NOT falling back, live is tried every call. While falling back, live is only re-probed
    /// every <see cref="RetryEveryNCalls"/> calls (so recovery is detected automatically without
    /// hammering a known-dead server on every single send) — everything else goes straight to demo.
    /// </summary>
    private bool ShouldTryLiveThisCall()
    {
        if (!IsFallingBack) return true;

        var n = Interlocked.Increment(ref _callCount);
        return n % RetryEveryNCalls == 0;
    }

    /// <summary>
    /// Mirrors <see cref="LiveTransport"/>'s own <see cref="St4iNetworkException"/> mapping: a network/
    /// timeout failure comes back as Success=false + Queued=true (accepted into the local store-and-
    /// forward queue) + a non-null Error — as opposed to a permanent 4xx/5xx (Success=false, Queued=false).
    /// </summary>
    private static bool IsNetworkFailure(TransportAck ack) =>
        ack is { Success: false, Queued: true, Error: not null };

    private static bool IsNetworkFailure(HeartbeatResult result) => !result.Success;

    private static bool IsNetworkFailure(ConfigSyncResult result) => result.DriftState == "error";

    /// <summary>
    /// Atomic compare-and-set: <see cref="SendAsync"/> (foreground) and <see cref="HeartbeatAsync"/>
    /// (typically a background timer, per the intended architecture) can call this concurrently. Without
    /// the lock, two threads can both read <see cref="IsFallingBack"/>==false before either writes,
    /// and both fire <see cref="FallbackChanged"/>(true) for what is really a single transition. The
    /// state check-and-flip happens inside the lock; the event fires outside it (only when this call
    /// actually caused the transition) so we never hold the lock during arbitrary subscriber code.
    /// </summary>
    private void SetFallingBack(bool value)
    {
        bool changed;
        lock (_gate)
        {
            changed = IsFallingBack != value;
            if (changed) IsFallingBack = value;
        }

        if (changed) FallbackChanged?.Invoke(value);
    }
}
