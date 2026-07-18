using St4i.EdgeCore.Models;

namespace St4i.EdgeCore.Transport;

/// <summary>
/// The single seam between edge-core reading capture/normalization and "how it actually leaves the
/// building" (live HTTP to the real ingest endpoints, or the offline <see cref="DemoTransport"/>
/// fabricator used at exhibitions with no server / no network).
/// </summary>
public interface ITransport
{
    TransportMode Mode { get; }

    Task<TransportAck> SendAsync(CanonicalEnvelope env, CancellationToken ct);

    Task<HeartbeatResult> HeartbeatAsync(string machineCode, CancellationToken ct);

    Task<ConfigSyncResult> SyncConfigAsync(string machineCode, string configKind, string? cachedVersion, CancellationToken ct);
}
