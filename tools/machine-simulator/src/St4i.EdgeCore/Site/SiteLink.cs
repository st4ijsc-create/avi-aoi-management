namespace St4i.EdgeCore.Site;

/// <summary>
/// GĐ3 EC-2 — the persisted "Site link": where this device federates its local Unified Namespace spine to
/// (a SYNAPSE Site's MQTT broker) plus the trust anchor to pin that broker's presented TLS certificate
/// against (see <see cref="SiteTrustPin"/>). NO secrets live here — the device's own certificate/private
/// key stay exactly where <see cref="Identity.DeviceIdentityStore"/> already keeps them (DPAPI-sealed,
/// ACL-locked); <see cref="SiteTrustPem"/> is only ever a PUBLIC certificate (the Site's CA, or the Site's
/// own self-signed leaf pinned directly) — safe to persist in plain JSON, same "no secrets in the file"
/// invariant <see cref="Config.FleetSettingsStore"/>'s own <see cref="Config.PersistedFleetSettings"/>
/// upholds for the FleetHost connection identity.
///
/// <para><b>Default: disabled.</b> <see cref="Enabled"/> defaults to <see langword="false"/> — a device
/// with no Site link on file (or one that was never enabled) is a standalone edge node, byte-identical to
/// every build before EC-2 landed. Turning this on is the ONLY thing that ever causes
/// <see cref="UnsBridge"/>/<see cref="SiteBridgeManager"/> to reach off-box at all — the local UNS spine
/// (<see cref="Uns.UnsBroker"/>) itself stays loopback-only regardless; only the bridge's own REMOTE client
/// ever dials out, and only when this flag is true.</para>
/// </summary>
public sealed record PersistedSiteLink
{
    /// <summary>Whether the bridge should be running at all. Default <see langword="false"/> —
    /// additive/default-off, see this record's own doc comment.</summary>
    public bool Enabled { get; init; }

    /// <summary>The Site broker's hostname/IP. Blank/ignored while <see cref="Enabled"/> is
    /// <see langword="false"/>.</summary>
    public string Host { get; init; } = "";

    /// <summary>The Site broker's MQTTS port. 8883 is the IANA-registered "secure MQTT" port — the
    /// natural default for an mTLS northbound link (never the loopback-only <see cref="Uns.UnsOptions.BrokerPort"/>,
    /// which is a completely separate, purely local, listener).</summary>
    public int Port { get; init; } = 8883;

    /// <summary>The Site broker's trust anchor, PEM-encoded: either a CA certificate the Site's presented
    /// leaf chains to, or the Site's own self-signed leaf certificate pinned directly (both are valid
    /// pinning shapes — see <see cref="SiteTrustPin.IsTrusted"/>). A public certificate, never a secret.</summary>
    public string SiteTrustPem { get; init; } = "";
}
