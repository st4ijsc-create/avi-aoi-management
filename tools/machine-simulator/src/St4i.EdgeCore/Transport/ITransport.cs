using St4i.EdgeCore.Models;

namespace St4i.EdgeCore.Transport;

/// <summary>
/// 🔴 <b>This summary read, VERBATIM, until 2026-08-20, and its first six words are WITHDRAWN by task
/// AM-1 (owner item 12, stage 7) — quoted and retired in place, not deleted, and no code was
/// changed:</b> <i>"The single seam between edge-core reading capture/normalization and 'how it actually
/// leaves the building' (live HTTP to the real ingest endpoints, or the offline
/// <see cref="DemoTransport"/> fabricator used at exhibitions with no server / no network)."</i> It was
/// true when it was written and stopped being true when G2-2 added the UNS spine: <c>EdgePipeline</c>
/// hands the SAME <see cref="CanonicalEnvelope"/> to
/// <see cref="St4i.EdgeCore.Uns.IUnsPublisher.PublishReading"/> in the statement before the one that
/// calls <see cref="SendAsync"/>, and <c>Site.UnsBridge</c> republishes that spine to a SYNAPSE Site's
/// MQTT broker off-box. The parenthesis is the part that survives and it is what this interface is:
/// <b>the ST4I ingest seam</b> — live HTTP to the real ingest endpoints, or the offline
/// <see cref="DemoTransport"/> fabricator used at exhibitions with no server and no network. It is one of
/// the TWO paths a reading takes out of this process, not the only one.
///
/// <para>Nothing here is a delivery guarantee. All three methods answer with a RESULT record, and in
/// every implementation that ships here none of them throws for a server that is down, so a failure
/// arrives as a value rather than as an exception — see
/// <see cref="TransportAck"/>, <see cref="HeartbeatResult"/> and <see cref="ConfigSyncResult"/>, each of
/// which spells out which of its members mean what on which path. Four implementations ship:
/// <see cref="LiveTransport"/>, <see cref="DemoTransport"/>, <see cref="AutoTransport"/> (which composes
/// two of them) and <see cref="SwitchableTransport"/> (which forwards to any of them).</para>
/// </summary>
public interface ITransport
{
    /// <summary>Which implementation this is. It is a constant of the class, never a report about a
    /// connection: a <see cref="LiveTransport"/> pointed at an unreachable server still answers
    /// <see cref="TransportMode.Live"/>. It is read for display — <c>EdgePipeline</c> stamps it on every
    /// API-trace event — so what the operator's trace pane shows is which transport served the call, not
    /// which mode the operator selected. The two differ while the network-outage scenario is
    /// active.</summary>
    TransportMode Mode { get; }

    /// <summary>Offers one normalized reading to the ecosystem. Returns what happened rather than
    /// throwing: a network failure, a permanent rejection and an unconfigured machine key all come back
    /// as a <see cref="TransportAck"/> whose members say which. The one exception is an envelope whose
    /// <see cref="CanonicalEnvelope.Kind"/> is not one of the three ingest shapes — both shipping
    /// implementations throw <see cref="ArgumentOutOfRangeException"/> for that, because it is a
    /// programming error in this process rather than an outcome of a send.</summary>
    Task<TransportAck> SendAsync(CanonicalEnvelope env, CancellationToken ct);

    /// <summary>Pings the ecosystem for this machine's liveness and key status, independently of whether
    /// any reading is flowing. The <c>machineCode</c> argument is not uniformly load-bearing: the live
    /// implementation ignores it (its wrapped SDK client is already bound to one machine) while the demo
    /// implementation derives its fabricated machine id from it, so passing the wrong code changes the
    /// demo answer and cannot change the live one.</summary>
    Task<HeartbeatResult> HeartbeatAsync(string machineCode, CancellationToken ct);

    /// <summary>Compares one config version string with the one the caller says it already holds. It
    /// deliberately does not download or apply anything — there is no apply callback in this signature —
    /// so a <see cref="ConfigSyncResult"/> reporting a change is a statement about two strings and never
    /// about configuration in force. The full check→get→apply→ack loop lives elsewhere; this exists so a
    /// host can cheaply notice drift.</summary>
    Task<ConfigSyncResult> SyncConfigAsync(string machineCode, string configKind, string? cachedVersion, CancellationToken ct);
}
