using St4i.DeviceClient;
using St4i.EdgeCore.Models;

namespace St4i.EdgeCore.Transport;

/// <summary>
/// Keeps the exhibition app looking good when the real server is unreachable: tries <c>live</c>
/// first for every call, and transparently re-routes to <c>demo</c> the
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

    /// <summary>Composes the two transports this one arbitrates between. Both are required and neither is
    /// owned — this class has no <c>Dispose</c>, and the live instance it is handed is the same one
    /// <see cref="TransportCoordinator"/> holds and disposes on a rebuild, which is why a rebuild
    /// constructs a NEW <see cref="AutoTransport"/> rather than mutating this one. The parameters are
    /// typed as <see cref="ITransport"/>, not as the two concrete classes, so nothing enforces that
    /// <c>live</c> is live or that <c>demo</c> is offline: the names describe the ROLE each argument
    /// plays in the fallback, and a caller that swapped them would get a working object with inverted
    /// behaviour.</summary>
    public AutoTransport(ITransport live, ITransport demo)
    {
        _live = live ?? throw new ArgumentNullException(nameof(live));
        _demo = demo ?? throw new ArgumentNullException(nameof(demo));
    }

    /// <summary>Always <see cref="TransportMode.Auto"/> — it does not switch to
    /// <see cref="TransportMode.Demo"/> while falling back. So the API-trace row for a call this class
    /// served from demo is stamped <c>Auto</c>, and the row carries nothing else that distinguishes it
    /// either — the fabricated ack's status code is the same 201/202 a real one would carry. What says so
    /// is <see cref="IsFallingBack"/> and the event that announces it, neither of which reaches that
    /// row.</summary>
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

    /// <summary>Raised only on a TRANSITION of <see cref="IsFallingBack"/>, never once per degraded call,
    /// so a subscriber sees one notification per outage and one per recovery rather than a stream. It is
    /// invoked OUTSIDE this class's lock and therefore on whichever thread caused the transition — a
    /// pipeline send or a background heartbeat — which is why the WPF subscriber marshals to the UI
    /// thread itself. Delivery is not guaranteed across a <c>TransportCoordinator.RebuildLive</c>: that
    /// rebuild unsubscribes from this instance and subscribes to a fresh one, and a call already in
    /// flight can deliver one stray notification after the unsubscribe or lose one, which that method
    /// records as an accepted race.</summary>
    public event Action<bool>? FallbackChanged;

    /// <summary>Tries live first and answers from demo when live signals a network failure. "Signals" has
    /// an exact meaning, and it is narrower than "did not succeed": a thrown network exception, or an ack
    /// that is unsuccessful AND queued AND carries a message. A permanent 4xx or 5xx from the server is
    /// therefore NOT a fallback trigger — it is returned to the caller unchanged, because the server was
    /// reached and it said no.
    ///
    /// <para>The fallback is not per-call. Once tripped, live is only re-probed on every fifth call, and
    /// that counter is shared with the heartbeat and config-sync methods — so a failing background
    /// heartbeat is what usually decides whether a perfectly healthy send goes to the server at
    /// all.</para></summary>
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

    /// <summary>Same probe-then-fall-back shape as <see cref="SendAsync"/>, but with a much blunter
    /// failure test: ANY unsuccessful heartbeat trips the fallback, because
    /// <see cref="HeartbeatResult.Success"/> already collapses network failure, server rejection and an
    /// unconfigured key into one value. That makes this the method most likely to trip the shared flag,
    /// and — since the flag is shared — the one that decides where sends go. A booth whose heartbeat
    /// timer is failing serves demo data from a live-configured host, and
    /// <see cref="FallbackChanged"/> is the only thing that says so.</summary>
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

    /// <summary>Same shape again, with a third and different failure test: the live result counts as a
    /// failure when its drift state is the literal string <c>error</c>. That is a string comparison
    /// against a value the live implementation produces on its own catch paths — not a status code and
    /// not an enum — so this fallback is coupled to a spelling rather than to a type, and a live backend
    /// that reported failure any other way would never trip it. Falling back here also SUBSTITUTES the
    /// answer: the demo implementation reports one fixed version for every config kind, so a fallback
    /// makes drift disappear rather than making it unknown.</summary>
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
        catch (St4iConfigException)
        {
            // Defense-in-depth — see HeartbeatAsync/SyncConfigAsync's matching catches. In practice
            // LiveTransport itself never lets St4iConfigException escape SendAsync any more (it
            // converts "unconfigured live" to a Queued:true ack and "configured but the SDK rejected
            // the local payload" to a Queued:false/HttpStatus:400 ack — see LiveTransport.SendAsync's
            // own remarks), so this only guards some OTHER ITransport implementation throwing directly.
            // Unlike LiveTransport's own catch, a bare thrown exception here carries no Queued/HttpStatus
            // signal to discriminate "unconfigured" from "malformed payload" — this is the SAME broad
            // treatment already given to a thrown St4iNetworkException just above.
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
