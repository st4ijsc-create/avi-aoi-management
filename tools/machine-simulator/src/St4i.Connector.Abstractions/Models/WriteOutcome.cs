namespace St4i.Connector.Abstractions.Models;

/// <summary>
/// Task B-1 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-1-brief.md) — the outcome of
/// ONE write attempt, shared by both <see cref="SetpointWriteResult"/> and <see cref="CommandResult"/> so an
/// operator reads the SAME four-way vocabulary regardless of which kind of write just ran. A plain
/// success/failure boolean is not enough here: a write, unlike a read, cannot be retried for free (a retried
/// read just tries again; a retried write on a value/command that may already have applied can leave a
/// device at the wrong setpoint, or fire a command — a coil pulse, an OPC-UA <c>CallAsync</c> — a second
/// time). See <see cref="IWritableDeviceDriver"/>'s own doc comment for the no-implicit-retry rule this
/// outcome exists to support, and for why <see cref="Indeterminate"/> in particular is its own outcome
/// rather than being folded into <see cref="Failed"/>.
///
/// <para><b>Fix round 1 (task-1-report.md, CRITICAL) — <see cref="Indeterminate"/> is deliberately ordinal
/// 0, i.e. <c>default(WriteOutcome)</c>.</b> The first version of this enum declared <c>Applied</c> first,
/// making it the zero/default value — which meant a missing <c>outcome</c> field in a JSON payload (a
/// truncated sidecar response, a producer in another language omitting an optional-looking field, a
/// <c>default(WriteOutcome)</c> anywhere in a future audit/aggregation code path) silently deserialized to
/// "the device took it": the single most dangerous possible misreading on a contract whose entire reason for
/// existing is that a write must never silently claim success. <see cref="Indeterminate"/> is the ONE outcome
/// that already means "we do not know" — reusing it as the safe default costs nothing (it needs no new
/// member) and turns "absence of information" into "correctly reported as unknown" instead of "reported as
/// success". <see cref="Applied"/> is now ordinal 3, the LAST value, specifically so it can never again be
/// what a missing/default value resolves to.</para>
/// </summary>
public enum WriteOutcome
{
    /// <summary>The attempt was interrupted — most commonly, it timed out — before a definitive
    /// applied/failed response ever arrived. The caller does NOT know whether the device applied the write.
    /// Most products hide this state entirely; this contract exists partly to stop hiding it. An
    /// implementation MUST NEVER silently retry on seeing this outcome — see
    /// <see cref="IWritableDeviceDriver"/>'s own doc comment.
    ///
    /// <para>Deliberately ordinal 0 (<c>default(WriteOutcome)</c>) — see this enum's own class doc comment,
    /// "Fix round 1", for why the safe default and the "we don't know" outcome are the same value on
    /// purpose.</para></summary>
    Indeterminate = 0,

    /// <summary>Rejected BEFORE the device was touched — no I/O was attempted at all, so the device's state
    /// is provably unchanged. See the result's own <c>RejectionReason</c> for which specific pre-flight
    /// check failed (an unknown point/command, a point the map declares read-only, an out-of-range value,
    /// or a malformed argument).</summary>
    Rejected = 1,

    /// <summary>The device (or the transport talking to it) was reached and explicitly reported failure —
    /// the write did NOT apply. This is a KNOWN "no", which is what distinguishes it from
    /// <see cref="Indeterminate"/>.</summary>
    Failed = 2,

    /// <summary>The device confirmed the write took effect. Deliberately NOT ordinal 0 — see this enum's own
    /// class doc comment, "Fix round 1" — so a missing/default outcome can never be misread as this
    /// value.</summary>
    Applied = 3,
}
