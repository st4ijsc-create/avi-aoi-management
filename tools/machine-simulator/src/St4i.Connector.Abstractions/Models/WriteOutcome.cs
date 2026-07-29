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
/// </summary>
public enum WriteOutcome
{
    /// <summary>The device confirmed the write took effect.</summary>
    Applied,

    /// <summary>Rejected BEFORE the device was touched — no I/O was attempted at all, so the device's state
    /// is provably unchanged. See the result's own <c>RejectionReason</c> for which specific pre-flight
    /// check failed (an unknown point/command, a point the map declares read-only, an out-of-range value,
    /// or a malformed argument).</summary>
    Rejected,

    /// <summary>The device (or the transport talking to it) was reached and explicitly reported failure —
    /// the write did NOT apply. This is a KNOWN "no", which is what distinguishes it from
    /// <see cref="Indeterminate"/>.</summary>
    Failed,

    /// <summary>The attempt was interrupted — most commonly, it timed out — before a definitive
    /// applied/failed response ever arrived. The caller does NOT know whether the device applied the write.
    /// Most products hide this state entirely; this contract exists partly to stop hiding it. An
    /// implementation MUST NEVER silently retry on seeing this outcome — see
    /// <see cref="IWritableDeviceDriver"/>'s own doc comment.</summary>
    Indeterminate,
}
