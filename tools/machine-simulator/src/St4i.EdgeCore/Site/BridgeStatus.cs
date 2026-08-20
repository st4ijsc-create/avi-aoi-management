namespace St4i.EdgeCore.Site;

/// <summary>
/// GĐ3 EC-2 — the northbound bridge's own runtime state, as <see cref="UnsBridge.Snapshot"/>/
/// <see cref="SiteBridgeManager.Status"/> report it (EC-3's status endpoint reads this).
/// <list type="bullet">
/// <item><see cref="Disabled"/> — no <see cref="PersistedSiteLink"/> is enabled; there is no bridge at all
/// (<see cref="SiteBridgeManager"/> never constructed one).</item>
/// <item><see cref="Connecting"/> — enabled, the local client is up, but the remote (Site) client has
/// never yet completed its first connection.</item>
/// <item><see cref="Connected"/> — both the local and the remote client are currently connected; readings
/// are actively forwarding.</item>
/// <item><see cref="Degraded"/> — the remote (Site) client WAS connected at least once but is currently
/// disconnected (a Site-side outage/network partition); the local UNS spine and the rest of the pipeline
/// are completely unaffected (see <see cref="UnsBridge"/>'s own doc comment) — only northbound forwarding
/// is paused, with the bounded channel dropping the oldest buffered item as new ones arrive.</item>
/// <item><see cref="Down"/> — the bridge can't even reach its OWN local UNS spine (the loopback broker the
/// local client subscribes to) — a bridge/local-broker misconfiguration, not a Site-side problem.</item>
/// <item><see cref="Faulted"/> — GĐ3 closeout WI-3 review fix round 1: the spool writer and/or forward
/// background loop (see <see cref="UnsBridge"/>'s own doc comment) terminated unexpectedly — an exception
/// that was NOT this bridge's own shutdown cancellation. Takes priority over
/// <see cref="Connected"/>/<see cref="Degraded"/>/<see cref="Connecting"/>: the MQTT clients can look
/// perfectly healthy while messages are silently no longer being persisted (writer loop dead) or replayed
/// (forward loop dead), which is a worse, more surprising failure than a known Site outage — this state
/// exists so an operator never sees a lying "Connected" while forwarding has actually stopped.</item>
/// </list>
/// </summary>
public enum BridgeState
{
    /// <summary>No enabled <see cref="PersistedSiteLink"/>, so <see cref="SiteBridgeManager"/> never
    /// constructed a bridge at all. Distinct from every other member in that there is no object whose
    /// health is being reported — the three spool counters on
    /// <see cref="BridgeStatusSnapshot"/> are <c>0</c> here because there is no spool, not because it is
    /// empty. This is the default value of the enum, which is what an uninitialised snapshot reports.</summary>
    Disabled,

    /// <summary>Enabled, the LOCAL client is up, and the REMOTE (Site) client has not yet completed a
    /// first connection. Nothing has been forwarded northbound yet in this bridge's lifetime.</summary>
    Connecting,

    /// <summary>Both clients are connected and readings are actively forwarding. 🔴 Not a guarantee that
    /// forwarding is happening — see <see cref="Faulted"/>, which exists precisely because the clients can
    /// be healthy while the loops that move messages between them are dead.</summary>
    Connected,

    /// <summary>The remote (Site) client connected at least once and is currently disconnected — a
    /// Site-side outage or a network partition. Strictly a NORTHBOUND state: the local UNS spine and the
    /// rest of the pipeline are unaffected, and readings keep flowing to every other consumer.</summary>
    Degraded,

    /// <summary>The bridge cannot reach its OWN local UNS spine — the loopback broker its local client
    /// subscribes to. A local misconfiguration, not a Site-side problem, and the one member that points the
    /// operator at this box rather than at the far end.</summary>
    Down,

    /// <summary>The spool writer and/or the forward loop terminated on an exception that was NOT this
    /// bridge's own shutdown cancellation. Takes PRIORITY over
    /// <see cref="Connected"/>/<see cref="Degraded"/>/<see cref="Connecting"/> — that precedence is the
    /// whole point of the member, because the MQTT clients can look perfectly healthy while messages are
    /// silently no longer being persisted or replayed, which is a worse failure than a known outage
    /// precisely because nothing else would show it.</summary>
    Faulted,
}

/// <summary>An immutable point-in-time read of <see cref="UnsBridge"/>'s health, for status
/// reporting/observability. <see cref="SiteFingerprint"/> is the SHA-256 fingerprint of the Site broker's
/// TLS certificate as validated by <see cref="SiteTrustPin.IsTrusted"/> on the most recent successful
/// handshake (null until the first successful connect); <see cref="DeviceFingerprint"/> is this device's OWN
/// identity fingerprint (<see cref="Identity.DeviceIdentity.Fingerprint"/>) — always present, even
/// <see cref="BridgeState.Disabled"/>, since a device has an identity whether or not it is federated
/// anywhere.
///
/// <para>GĐ3 closeout WI-3 — <see cref="SpoolDepth"/>/<see cref="LastAckedSeq"/>/<see cref="DroppedTotal"/>
/// surface the durable northbound spool's own state (see <see cref="BridgeSpool"/>) so an operator can see,
/// e.g. via <c>/v1/site</c>, whether a Site outage is currently backing data up and how much (if anything)
/// has ever been dropped by the spool's own age/byte caps. All three are <c>0</c> when there is no spool at
/// all — either <see cref="BridgeState.Disabled"/>, or a bridge running with
/// <c>ST4I_BRIDGE_SPOOL_ENABLED=0</c> (see <see cref="UnsBridge"/>'s own doc comment) — never garbage.
/// <see cref="LastAckedSeq"/> is the bridge's OWN bookkeeping (not derivable from <see cref="BridgeSpoolStats"/>
/// alone, since an acked item is deleted from the spool, not merely marked) — the highest
/// <see cref="SpooledItem.Seq"/> this bridge has ever successfully forwarded and acked.</para></summary>
public sealed record BridgeStatusSnapshot(
    BridgeState State,
    string? LastError,
    string? SiteFingerprint,
    string DeviceFingerprint,
    long SpoolDepth = 0,
    long LastAckedSeq = 0,
    long DroppedTotal = 0);
