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
    private readonly DeviceIdentity _identity;
    private readonly SiteLinkStore _store;
    private readonly Action<string>? _logWarning;
    private readonly Action<Exception, string>? _logError;
    private readonly SemaphoreSlim _gate = new(1, 1);

    private UnsBridge? _bridge;
    private PersistedSiteLink _current = new();
    private volatile bool _disposed;

    public SiteBridgeManager(
        UnsOptions localUns,
        DeviceIdentity identity,
        SiteLinkStore store,
        Action<string>? logWarning = null,
        Action<Exception, string>? logError = null)
    {
        _localUns = localUns ?? throw new ArgumentNullException(nameof(localUns));
        _identity = identity ?? throw new ArgumentNullException(nameof(identity));
        _store = store ?? throw new ArgumentNullException(nameof(store));
        _logWarning = logWarning;
        _logError = logError;
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
                    _bridge = new UnsBridge(_localUns, link, _identity.Certificate, _identity.Fingerprint, _logWarning, _logError);
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
    /// langword="false"/>), else the live bridge's own <see cref="UnsBridge.Snapshot"/>.</summary>
    public BridgeStatusSnapshot Status() =>
        _bridge?.Snapshot() ?? new BridgeStatusSnapshot(BridgeState.Disabled, null, null, _identity.Fingerprint);

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

        _gate.Dispose();
    }
}
