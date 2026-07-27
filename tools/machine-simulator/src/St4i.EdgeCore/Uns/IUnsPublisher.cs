using St4i.EdgeCore.Models;

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
}
