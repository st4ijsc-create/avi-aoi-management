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
/// <see cref="SpooledItem.Seq"/> this bridge has ever successfully forwarded and acked.</para>
///
/// <para>🔴 <b><see cref="DroppedTotal"/> IS NOT A TOTAL OF DROPS. Task AP-1, 2026-08-21, owner decision
/// 15.</b> It is, and has only ever been, the SPOOL's own <c>dropped_total</c> — rows
/// <see cref="BridgeSpool.TrimAsync"/> deleted to honour the age/byte caps. It does NOT count, and by
/// construction cannot count, the messages the bridge's forward CHANNEL evicts UPSTREAM of the spool: those
/// are thrown away before <see cref="IBridgeSpool.EnqueueAsync"/> is ever called. Those live in
/// <see cref="BridgeForwardQueueStats.Evicted"/>, on <see cref="UnsBridge.ForwardQueueStats"/>. The name was
/// left alone deliberately: this field is READ by <c>GET /v1/site</c>, by the <c>/site</c> page in the web
/// UI, and — the one that decides it — by the RETAINED resync record this bridge publishes to the Site
/// broker, which is a wire contract a third party consumes. Quietly widening what a running number means is
/// the failure this project keeps paying for; the number was documented instead, and the other loss got its
/// own name.</para></summary>
public sealed record BridgeStatusSnapshot(
    BridgeState State,
    string? LastError,
    string? SiteFingerprint,
    string DeviceFingerprint,
    long SpoolDepth = 0,
    long LastAckedSeq = 0,
    long DroppedTotal = 0);

/// <summary>
/// 🔴 Task AP-1 (owner decision 15, 2026-08-21) — the loss that happens BEFORE the spool, which
/// <see cref="BridgeStatusSnapshot.DroppedTotal"/> does not and cannot see. Same record shape and same split
/// as <see cref="St4i.EdgeCore.Historian.HistorianWriterStats"/> and
/// <see cref="St4i.EdgeCore.Uns.UnsPublisherStats"/>, ported from
/// <c>St4i.EngineApi.Alarms.AlarmNotifierStats</c>, which had already solved this.
/// <para>Deliberately a SEPARATE record rather than three more fields on
/// <see cref="BridgeStatusSnapshot"/>: that record is mapped straight onto <c>GET /v1/site</c>, and adding a
/// field there changes a published payload. That was outside what this item was delegated to do, so it is
/// named as a gap rather than taken — see this class' entry in <c>docs/owner-decisions.md</c> Part III.</para>
/// </summary>
/// <param name="Evicted">Messages the forward CHANNEL threw away because it was FULL when a locally-received
/// message arrived — the <see cref="System.Threading.Channels.BoundedChannelFullMode.DropOldest"/> eviction
/// that <c>TryWrite</c> performs while still returning <see langword="true"/>. Non-zero means northbound
/// production data was lost UPSTREAM of the spool and no durable record of it exists anywhere else.</param>
/// <param name="DroppedAfterShutdown">Messages refused because the forward channel's writer had already been
/// completed by <see cref="UnsBridge.DisposeAsync"/>. Expected during a clean shutdown.</param>
/// <param name="Queued">How deep the forward channel is RIGHT NOW — a gauge, not a cumulative counter. This
/// is NOT <see cref="BridgeStatusSnapshot.SpoolDepth"/>: it counts what has not reached the spool yet.</param>
public sealed record BridgeForwardQueueStats(long Evicted, long DroppedAfterShutdown, int Queued);
