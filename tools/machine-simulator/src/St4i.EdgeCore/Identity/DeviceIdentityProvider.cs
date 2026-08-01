namespace St4i.EdgeCore.Identity;

/// <summary>
/// GĐ3 closeout WI-4 — the DI seam that makes rotation actually observable to the rest of the process.
///
/// <para><b>The problem this solves:</b> <see cref="DeviceIdentity"/> is an immutable record, and before
/// this class existed it was registered as a plain DI singleton — every consumer (<see
/// cref="St4i.EdgeCore.Site.SiteBridgeManager"/>, <c>SiteEndpoints</c>) captured that ONE
/// <see cref="DeviceIdentity"/> instance at construction time and kept it forever. After
/// <see cref="DeviceIdentityStore.Rotate"/> mints a new identity there would be no way to tell an
/// already-constructed consumer about it — it would keep presenting/reporting the stale, pre-rotation
/// certificate for the rest of the process's life. This class is the single, thread-safe source of truth
/// for "the CURRENT identity" that every consumer reads through instead of capturing a copy.</para>
///
/// <para><b>Thread-safety (GĐ3 closeout WI-4 fix round 1 — Important #3/concurrency Minor):</b>
/// <see cref="Rotate"/> holds the SAME private lock across its ENTIRE body — the <see cref="DeviceIdentityStore.Rotate"/>
/// disk write (mint + DPAPI-protect + atomic file replace) included, not just the final in-memory swap.
/// Fix round 1 review caught the earlier (lock-only-around-the-swap) version as genuinely unsafe: two
/// concurrent <see cref="Rotate"/> calls (a double-submit of <c>POST /v1/site/identity/rotate</c>) could
/// both read the SAME pre-rotation <see cref="DeviceIdentity.NodeId"/>, then race
/// <see cref="DeviceIdentityStore.Rotate"/>'s own file replace against each other — whichever caller's
/// mint finished LAST would win on disk, but the OTHER caller's already-returned response (the fingerprint
/// an operator would go paste into the Site) could disagree with what's actually persisted, permanently
/// breaking the uplink after a restart. Fully serializing <see cref="Rotate"/> removes that race by
/// construction: only one rotation can ever be in flight at a time, and every caller's returned
/// <see cref="DeviceIdentity"/> is guaranteed to be exactly what's on disk when it returns. A rotation is
/// an explicit, infrequent operator action, not a latency-sensitive hot path — holding the lock for the
/// full mint+persist duration (also blocking concurrent <see cref="Current"/> reads for that same brief
/// window) has no meaningful downside.</para>
///
/// <para><b>Rotation keeps the current NodeId</b> — <see cref="Rotate"/> re-mints under
/// <see cref="DeviceIdentity.NodeId"/> as it stands at the moment of the call (not whatever nodeId the
/// device originally booted with), so the certificate's subject/SAN stay stable across a rotation; only
/// the key pair, certificate, validity window, and fingerprint actually change.</para>
///
/// <para><b>Re-keying a live consumer is NOT this class's job</b> — swapping <see cref="Current"/> is a
/// pure in-memory pointer update; it does nothing by itself to an already-running
/// <see cref="St4i.EdgeCore.Site.UnsBridge"/>, which captured the OLD certificate object at its own
/// construction time. The caller that rotates (the <c>POST /v1/site/identity/rotate</c> handler) is
/// responsible for ALSO re-applying the Site link afterward (see
/// <see cref="St4i.EdgeCore.Site.SiteBridgeManager.ReapplyCurrentAsync"/>) — otherwise the bridge silently
/// keeps presenting the pre-rotation certificate forever, defeating the entire feature.</para>
/// </summary>
public sealed class DeviceIdentityProvider
{
    private readonly DeviceIdentityStore _store;
    private readonly object _gate = new();
    private DeviceIdentity _current;

    /// <param name="store">The SAME <see cref="DeviceIdentityStore"/> instance (same resolved directory)
    /// that produced <paramref name="initial"/> — <see cref="Rotate"/> re-mints through this store, so a
    /// different instance pointed at a different directory would rotate the wrong identity entirely.</param>
    /// <param name="initial">The identity already loaded/created (typically via
    /// <see cref="DeviceIdentityStore.LoadOrCreate"/>) at startup.</param>
    public DeviceIdentityProvider(DeviceIdentityStore store, DeviceIdentity initial)
    {
        _store = store ?? throw new ArgumentNullException(nameof(store));
        _current = initial ?? throw new ArgumentNullException(nameof(initial));
    }

    /// <summary>The identity as of the most recent <see cref="Rotate"/> (or the one this provider was
    /// constructed with, if <see cref="Rotate"/> was never called). Read this on every use — never cache
    /// the returned <see cref="DeviceIdentity"/> across an await/for the process lifetime, or a rotation
    /// becomes invisible to whatever cached it (exactly the bug this class exists to prevent).</summary>
    public DeviceIdentity Current
    {
        get { lock (_gate) return _current; }
    }

    /// <summary>Mints+persists a brand-new identity (<see cref="DeviceIdentityStore.Rotate"/>, under the
    /// CURRENT <see cref="DeviceIdentity.NodeId"/>) and swaps <see cref="Current"/> to it — the READ of the
    /// current NodeId, the disk mint/persist, and the swap are all under ONE lock acquisition (see this
    /// class' own doc comment for why). Does NOT catch — a minting/persistence failure propagates to the
    /// caller unchanged (same "explicit operator action, must not swallow a failure" contract
    /// <see cref="DeviceIdentityStore.Rotate"/> itself documents); on failure, <see cref="Current"/> is left
    /// completely unchanged (the store never got as far as replacing anything on disk — see that method's
    /// own doc comment), and the lock is released (a normal exception unwind, not a held/abandoned lock).</summary>
    public DeviceIdentity Rotate()
    {
        lock (_gate)
        {
            var rotated = _store.Rotate(_current.NodeId);
            _current = rotated;
            return rotated;
        }
    }
}
