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
/// </list>
/// </summary>
public enum BridgeState
{
    Disabled,
    Connecting,
    Connected,
    Degraded,
    Down,
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
