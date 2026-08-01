using St4i.EdgeCore.Identity;
using St4i.EdgeCore.Uns;

namespace St4i.EdgeCore.Site;

/// <summary>
/// GĐ3 EC-2 — owns the single live <see cref="UnsBridge"/>'s runtime lifecycle. This is the seam EC-3's
/// <c>PUT /v1/site</c> drives: an operator submitting a new/changed Site link calls
/// <see cref="ApplyAsync"/>, which stops whatever bridge is currently running, persists the new link (so it
/// survives a restart), and starts a fresh bridge if the new link is enabled — all under a single
/// serializing gate, so a rapid double-submit can never race two bridges into existence at once.
///
/// <para><b>Startup contract:</b> the caller (<c>Program.cs</c>) constructs a manager, then calls
/// <c>ApplyAsync(store.Load() ?? new PersistedSiteLink())</c> once, synchronously, before the host starts
/// serving traffic — mirroring the exact "eager, wrapped in its own try/catch, never crashes startup"
/// shape <c>Program.cs</c>'s own UNS-broker startup block already uses. A construct/connect failure here
/// is caught and logged (never propagated) — the device comes up with the bridge simply
/// <see cref="BridgeState.Down"/>/absent rather than refusing to start at all, same "additive, never
/// allowed to fail the host it's bolted onto" posture as every other optional subsystem in this
/// codebase.</para>
/// </summary>
public sealed class SiteBridgeManager : IAsyncDisposable
{
    private readonly UnsOptions _localUns;
    private readonly DeviceIdentityProvider _identityProvider;
    private readonly SiteLinkStore _store;
    private readonly Action<string>? _logWarning;
    private readonly Action<Exception, string>? _logError;
    private readonly IBridgeSpool? _spool;
    private readonly SemaphoreSlim _gate = new(1, 1);

    private UnsBridge? _bridge;
    private PersistedSiteLink _current = new();
    private volatile bool _disposed;

    /// <param name="localUns">See <see cref="UnsBridge"/>'s own ctor doc comment.</param>
    /// <param name="identityProvider">GĐ3 closeout WI-4 — this device's identity, read through the
    /// provider (not a captured <see cref="DeviceIdentity"/> snapshot) so a rotation is actually visible:
    /// every <see cref="ApplyAsync"/> call builds its <see cref="UnsBridge"/> off
    /// <see cref="DeviceIdentityProvider.Current"/> AS OF THAT CALL — see <see cref="ReapplyCurrentAsync"/>
    /// for how a rotation that happens AFTER a bridge is already running gets picked up.</param>
    /// <param name="store">Where the applied <see cref="PersistedSiteLink"/> is persisted.</param>
    /// <param name="logWarning">Optional recoverable-condition logger.</param>
    /// <param name="logError">Optional fault logger.</param>
    /// <param name="spool">GĐ3 closeout WI-3 — the durable northbound spool, or <see langword="null"/> to
    /// keep every bridge this manager ever builds on the PRE-WI-3 drop-while-disconnected behavior (see
    /// <see cref="UnsBridge"/>'s own doc comment). This manager never reads <c>ST4I_BRIDGE_SPOOL_*</c>
    /// itself — the composition root (<c>Program.cs</c>) resolves <see cref="BridgeSpoolOptions.FromEnvironment"/>
    /// and passes the (possibly <see langword="null"/>) resulting spool in, exactly once, for this manager's
    /// entire lifetime. One spool instance is shared across every bridge <see cref="ApplyAsync"/> ever
    /// builds (re-applying a link tears down and rebuilds the bridge, NOT the spool) — the durable backlog
    /// must outlive any single bridge/TCP-connection lifecycle, which is the entire point of WI-2/WI-3.</param>
    public SiteBridgeManager(
        UnsOptions localUns,
        DeviceIdentityProvider identityProvider,
        SiteLinkStore store,
        Action<string>? logWarning = null,
        Action<Exception, string>? logError = null,
        IBridgeSpool? spool = null)
    {
        _localUns = localUns ?? throw new ArgumentNullException(nameof(localUns));
        _identityProvider = identityProvider ?? throw new ArgumentNullException(nameof(identityProvider));
        _store = store ?? throw new ArgumentNullException(nameof(store));
        _logWarning = logWarning;
        _logError = logError;
        _spool = spool;
    }

    /// <summary>The last-applied Site link (secrets-free — see <see cref="PersistedSiteLink"/>'s own doc
    /// comment), for a GET-style status/config endpoint. Reflects what was actually applied, not
    /// necessarily what's on disk if <see cref="SiteLinkStore.Save"/> itself failed (see
    /// <see cref="ApplyAsync"/>'s remarks).</summary>
    public PersistedSiteLink Current => _current;

    /// <summary>Stops whatever bridge is currently running (awaited — old bridge fully torn down before
    /// anything new starts), persists <paramref name="link"/>, then starts a fresh <see cref="UnsBridge"/>
    /// if <see cref="PersistedSiteLink.Enabled"/>. Never throws: a persistence failure or a bridge
    /// construct/connect failure is caught and logged, leaving <see cref="Status"/> reporting
    /// <see cref="BridgeState.Disabled"/> (no bridge) rather than propagating out to the caller (EC-3's PUT
    /// handler, or this class's own startup caller).</summary>
    public async Task ApplyAsync(PersistedSiteLink link)
    {
        ArgumentNullException.ThrowIfNull(link);

        // Fast path: once disposed, _gate itself is disposed too (see DisposeAsync) — check BEFORE ever
        // touching it, so a late ApplyAsync call after shutdown degrades to a no-op instead of throwing
        // ObjectDisposedException out of what production wiring treats as a never-throwing call.
        if (_disposed) return;

        await _gate.WaitAsync().ConfigureAwait(false);
        try
        {
            if (_disposed) return;

            var old = _bridge;
            _bridge = null;
            if (old is not null)
            {
                try
                {
                    await old.DisposeAsync().ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    _logError?.Invoke(ex, "Error disposing the previous Site bridge");
                }
            }

            try
            {
                _store.Save(link);
            }
            catch (Exception ex)
            {
                _logError?.Invoke(ex, "Failed to persist the Site link — the new link is active for this " +
                                      "run only and will NOT survive a restart");
            }

            _current = link;

            if (link.Enabled)
            {
                try
                {
                    // Read Current AS OF THIS CALL — not a captured field — so a rotation that already
                    // happened (via ReapplyCurrentAsync, below) is honored by the bridge this builds.
                    var identity = _identityProvider.Current;
                    _bridge = new UnsBridge(_localUns, link, identity.Certificate, identity.Fingerprint, _logWarning, _logError, _spool);
                }
                catch (Exception ex)
                {
                    _logError?.Invoke(ex, "Failed to start the Site bridge for the newly-applied link");
                    _bridge = null;
                }
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary><see cref="BridgeState.Disabled"/> if no bridge is currently running (either never
    /// configured, or the last-applied link had <see cref="PersistedSiteLink.Enabled"/> = <see
    /// langword="false"/>), else the live bridge's own <see cref="UnsBridge.Snapshot"/>. Note the disabled
    /// branch's <c>DeviceFingerprint</c> reads <see cref="DeviceIdentityProvider.Current"/> live (not a
    /// stale capture) — a rotation is visible here even with no bridge running at all.</summary>
    public BridgeStatusSnapshot Status() =>
        _bridge?.Snapshot() ?? new BridgeStatusSnapshot(BridgeState.Disabled, null, null, _identityProvider.Current.Fingerprint, 0, 0, 0);

    /// <summary>GĐ3 closeout WI-4 — re-applies whatever Site link is <see cref="Current"/> RIGHT NOW,
    /// unchanged, purely so a freshly-rotated <see cref="DeviceIdentityProvider.Current"/> actually reaches
    /// a LIVE bridge. Swapping the provider's <c>Current</c> pointer alone does nothing to an
    /// already-running <see cref="UnsBridge"/> — it captured the OLD certificate object at its own
    /// construction time (see <see cref="ApplyAsync"/>) — so the only way to re-key it is to tear it down
    /// and rebuild it, exactly like any other <see cref="ApplyAsync"/> call, just with the SAME link
    /// instead of a changed one. The caller (the <c>POST /v1/site/identity/rotate</c> handler) MUST call
    /// this immediately after <see cref="DeviceIdentityProvider.Rotate"/> succeeds — skipping it leaves the
    /// bridge silently presenting the pre-rotation certificate forever, which is exactly the bug this
    /// method exists to prevent. A no-op (bridge stays <see cref="BridgeState.Disabled"/>) if the current
    /// link isn't <see cref="PersistedSiteLink.Enabled"/> — nothing to re-key when there's no bridge.
    /// Same never-throws contract as <see cref="ApplyAsync"/> itself (this literally IS that call).</summary>
    public Task ReapplyCurrentAsync() => ApplyAsync(_current);

    /// <summary>Idempotent. Tears down the currently-running bridge (if any) — DI disposes this manager on
    /// host shutdown since it's registered as an <see cref="IAsyncDisposable"/> singleton.</summary>
    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;

        await _gate.WaitAsync().ConfigureAwait(false);
        try
        {
            if (_disposed) return;
            _disposed = true;

            if (_bridge is not null)
            {
                try
                {
                    await _bridge.DisposeAsync().ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    _logError?.Invoke(ex, "Error disposing the Site bridge during shutdown");
                }

                _bridge = null;
            }
        }
        finally
        {
            _gate.Release();
        }

        // EC-2 review Minor (folded in by EC-3): deliberately NOT calling _gate.Dispose() here. The
        // concurrent PUT /v1/site path EC-3 wires makes the race real: ApplyAsync's own _disposed
        // pre-check (above the WaitAsync call) can pass, then THIS method run to completion (setting
        // _disposed + disposing _gate) before that same ApplyAsync call reaches _gate.WaitAsync(),
        // which would throw ObjectDisposedException out of a call this class documents as never-throwing.
        // SemaphoreSlim.Dispose() only frees a lazily-allocated WaitHandle — never allocated here, since
        // only WaitAsync/Release are ever used (see SemaphoreSlim's own docs) — so skipping it leaks
        // nothing observable and removes the race entirely. The _disposed pre-checks above still make a
        // post-shutdown ApplyAsync a fast no-op in the common (non-racing) case.
    }
}
