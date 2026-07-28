using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Uns;

/// <summary>
/// G2-2 — the seam <see cref="St4i.EdgeCore.Engine.EdgePipeline"/> publishes every committed reading
/// through, additively, onto the local Unified Namespace spine (see <see cref="UnsPublisher"/> for the
/// real implementation). Every method here is non-blocking and MUST NEVER throw into the caller — a
/// broker hiccup can never slow or fail the pipeline's hot commit path (same contract
/// <see cref="St4i.EdgeCore.Historian.HistorianWriter.Enqueue"/> already gives the historian write-behind;
/// see <see cref="UnsPublisher"/>'s own doc comment for why the shape is copied from there).
/// </summary>
public interface IUnsPublisher
{
    /// <summary>Enqueues the dual-topic publish (Sparkplug DDATA + retained semantic mirror) for one
    /// already-committed reading. <paramref name="envelope"/> is the SAME <see cref="CanonicalEnvelope"/>
    /// <see cref="St4i.EdgeCore.Mapping.Normalizer.Normalize"/> just produced for the HTTP path — reused
    /// as-is (never re-derived) so the semantic mirror's JSON is always byte-for-byte the canonical
    /// envelope, not a second, potentially-drifting normalization.</summary>
    void PublishReading(DeviceReading reading, CanonicalEnvelope envelope);

    /// <summary>G2-3 hook: publishes a Sparkplug (D)BIRTH-shaped payload for <paramref name="equipmentCode"/>
    /// and resets its seq/alias state. Not called anywhere in G2-2's own wiring — NBIRTH/NDEATH
    /// sequencing itself is out of scope for this task; this only lands the seam G2-3 calls into.</summary>
    void PublishBirth(string equipmentCode);

    /// <summary>G2-3 hook — the (D)DEATH counterpart to <see cref="PublishBirth"/>.</summary>
    void PublishDeath(string equipmentCode);

    /// <summary>G2-3 — publishes a node-level Sparkplug B <b>NBIRTH</b> for this edge node (the process's single
    /// <see cref="UnsOptions.Cell"/>): resets the node sequence to 0 (per spec, NBIRTH is the ONLY message that
    /// does) and carries a monotonic <c>bdSeq</c> metric a host uses to pair this birth with its eventual
    /// <see cref="PublishNodeDeath"/>. Non-blocking; never throws (see the interface's own contract).</summary>
    void PublishNodeBirth();

    /// <summary>G2-3 — publishes the node-level <b>NDEATH</b> that terminates the most recent
    /// <see cref="PublishNodeBirth"/>, carrying the SAME <c>bdSeq</c>. A no-op if the node is not currently
    /// "born" (no matching NBIRTH is outstanding) — so an E-STOP on an idle fleet, or a duplicate stop, never
    /// emits a spurious or unpaired NDEATH.</summary>
    void PublishNodeDeath();

    /// <summary>GĐ3 sub-4 LC-3 — publishes the current PackML/ISA-88 line state (see
    /// <see cref="St4i.EngineApi.Line.LineController"/>) as a RETAINED semantic-mirror message on
    /// <c>syn/{site}/{area}/{line}/{cell}/_line/state</c> (see <see cref="UnsTopicBuilder.BuildLineStateTopic"/>),
    /// so a Site (or any other UNS subscriber) can read the fleet's standard operational state without
    /// polling the HTTP API. <paramref name="state"/> is the plain <see cref="St4i.EngineApi.Line.PackMlState"/>
    /// name (e.g. <c>"Execute"</c>) — this method takes a bare string (not the enum itself) so
    /// <c>St4i.EdgeCore</c> never has to reference <c>St4i.EngineApi.Line</c>. Same contract as every other
    /// method on this interface: non-blocking, MUST NEVER throw into the caller.</summary>
    void PublishLineState(string state);
}
