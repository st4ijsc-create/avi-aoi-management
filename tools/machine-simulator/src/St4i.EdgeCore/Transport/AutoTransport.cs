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

    private long _callCount;

    public AutoTransport(ITransport live, ITransport demo)
    {
        _live = live ?? throw new ArgumentNullException(nameof(live));
        _demo = demo ?? throw new ArgumentNullException(nameof(demo));
    }

    public TransportMode Mode => TransportMode.Auto;

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

    private void SetFallingBack(bool value)
    {
        if (IsFallingBack == value) return;
        IsFallingBack = value;
        FallbackChanged?.Invoke(value);
    }
}
