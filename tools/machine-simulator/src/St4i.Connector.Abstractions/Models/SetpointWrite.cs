namespace St4i.Connector.Abstractions.Models;

/// <summary>
/// Task B-1 — one attempt to set a single, pre-declared point to a value. <see cref="Point"/> is a NAME
/// from the target driver's own <see cref="IWritableDeviceDriver.WritablePoints"/> list, never a raw device
/// address — resolving a name to a real address is entirely the driver's own job. See
/// <see cref="IWritableDeviceDriver"/>'s doc comment for why: a contract that accepted a raw address would
/// make "typo an address and overwrite a PLC config register" a supported operation.
///
/// <para><see cref="Value"/> deliberately uses the SAME <see langword="object"/>? domain as
/// <see cref="TelemetrySample.Value"/> (double|bool|string|null — see
/// <see cref="Json.ConnectorObjectConverter"/>'s own doc comment for the exact accepted CLR types and why),
/// rather than inventing a second value domain for this contract to define: it serializes through
/// <see cref="Json.ConnectorJson"/> the same already-hardened way every <see cref="DeviceReading"/> does,
/// including across the future out-of-process sidecar boundary this type will eventually cross too.</para>
/// </summary>
/// <param name="Point">The point's declared name — see <see cref="IWritableDeviceDriver.WritablePoints"/>.</param>
/// <param name="Value">The value to write, in the same domain as <see cref="TelemetrySample.Value"/>.</param>
public sealed record SetpointWriteRequest(string Point, object? Value);

/// <summary>
/// Task B-1 — why a <see cref="SetpointWriteResult"/> was <see cref="WriteOutcome.Rejected"/> WITHOUT the
/// device ever being touched. Kept as its OWN enum, separate from <see cref="CommandRejectionReason"/>, so
/// neither type can represent a reason that could never apply to it (a setpoint result can never
/// legitimately carry <see cref="CommandRejectionReason.UnknownCommand"/>, and vice versa) — the same
/// "don't conflate setpoint and command" discipline <see cref="IWritableDeviceDriver"/>'s doc comment applies
/// to the two write operations themselves, carried down into their rejection vocabularies too.
/// </summary>
public enum SetpointRejectionReason
{
    /// <summary><see cref="SetpointWriteRequest.Point"/> does not name a point this driver knows about at
    /// all.</summary>
    UnknownPoint,

    /// <summary>The point exists but the map declares it read-only.</summary>
    NotWritable,

    /// <summary><see cref="SetpointWriteRequest.Value"/> falls outside the point's declared min/max range —
    /// caught and refused before it ever reaches the device.</summary>
    OutOfRange,
}

/// <summary>
/// Task B-1 — the outcome of one <see cref="SetpointWriteRequest"/>. Deliberately its OWN result type, never
/// shared with <see cref="CommandResult"/> — see <see cref="IWritableDeviceDriver"/>'s own doc comment for
/// why setpoint and command are never conflated, including at the result-type level.
/// </summary>
/// <param name="Point">Echoes the request's <see cref="SetpointWriteRequest.Point"/>, so a caller can match a
/// result back to its request without holding onto the original request object.</param>
/// <param name="Outcome">Which of the four outcomes this attempt landed on — see <see cref="WriteOutcome"/>.
/// Deliberately NOT settable via a <see langword="with"/> expression — see this property's own doc comment
/// below.</param>
/// <param name="RejectionReason">Non-null if and only if <paramref name="Outcome"/> is
/// <see cref="WriteOutcome.Rejected"/> — which specific pre-flight check failed. <see langword="null"/> for
/// every other outcome. Deliberately NOT settable via a <see langword="with"/> expression — see this
/// property's own doc comment below.</param>
/// <param name="Detail">Optional operator-readable free text — e.g. what a Failed/Indeterminate attempt
/// actually saw (a device error code, "timed out after 3000ms"). Never required, never machine-parsed by
/// any caller — the same role <see cref="IConnectorFactory.TryCreate"/>'s own <c>error</c> parameter already
/// plays for a failed <c>TryCreate</c> call.</param>
public sealed record SetpointWriteResult(
    string Point,
    WriteOutcome Outcome,
    SetpointRejectionReason? RejectionReason = null,
    string? Detail = null)
{
    /// <summary>
    /// Fix round 2 (task-1-report.md, IMPORTANT) — <see langword="get"/>-only, deliberately with NO
    /// <see langword="init"/> accessor. Fix round 1 gave <see cref="RejectionReason"/> a validating
    /// <see langword="init"/> initializer, which correctly rejects an illegal combination through
    /// <c>new SetpointWriteResult(...)</c> and through <see cref="System.Text.Json.JsonSerializer"/>
    /// deserialization — but a <see langword="with"/> expression bypasses BOTH: it calls the
    /// compiler-generated copy constructor (which clones existing field values directly, never re-running an
    /// initializer expression) and then invokes ONLY the explicitly-listed properties' <see langword="init"/>
    /// accessors directly, which for a property whose validation lives in its INITIALIZER (not its accessor)
    /// never runs that check at all. Confirmed empirically (a reviewer, and independently re-confirmed here):
    /// <c>result with { Outcome = WriteOutcome.Applied }</c> silently produced <c>Applied</c> carrying a
    /// stale <see cref="RejectionReason"/> from the original instance. Removing the <see langword="init"/>
    /// accessor from BOTH <see cref="Outcome"/> and <see cref="RejectionReason"/> closes this at COMPILE
    /// TIME, not just at runtime: <c>with { Outcome = ... }</c> or <c>with { RejectionReason = ... }</c> is
    /// now a compiler error (CS0200, "read only") on this type — there is no longer any code path, reasoned
    /// about or not, that can produce an inconsistent instance. <see cref="Point"/>/<see cref="Detail"/> keep
    /// their ordinary <see langword="init"/> accessors and remain freely <see langword="with"/>-able; only
    /// the two properties that participate in the cross-field invariant are locked down. (An
    /// <see langword="init"/>-ACCESSOR-body validation approach was considered instead of removing
    /// <see langword="init"/> entirely, and rejected: <see langword="with"/> assigns properties in the order
    /// WRITTEN in the <c>with { ... }</c> clause, so a single expression that legitimately changes BOTH
    /// <see cref="Outcome"/> and <see cref="RejectionReason"/> together — e.g. <c>Rejected+A with { Outcome =
    /// Applied, RejectionReason = null }</c> — would pass through a TRANSIENTLY inconsistent intermediate
    /// state between the two assignments and could throw depending on write order alone, for a transition
    /// that is valid start-to-end. Removing <see langword="init"/> avoids that order-dependence entirely by
    /// making the properties immutable after construction, which is what this result type's own semantics
    /// already call for — a result is a terminal, point-in-time fact about one write attempt, never something
    /// meant to be incrementally edited.)
    /// </summary>
    public WriteOutcome Outcome { get; } = Outcome;

    /// <summary>See <see cref="Outcome"/>'s own doc comment for why this has no <see langword="init"/>
    /// accessor. The validating initializer itself is unchanged from fix round 1: enforces
    /// "<see cref="RejectionReason"/> is non-null if and only if <see cref="Outcome"/> is
    /// <see cref="WriteOutcome.Rejected"/>" for every remaining construction path (direct construction and
    /// <see cref="System.Text.Json.JsonSerializer"/> deserialization — <see langword="with"/> is no longer a
    /// construction path for this property at all).</summary>
    public SetpointRejectionReason? RejectionReason { get; } =
        (Outcome == WriteOutcome.Rejected) == (RejectionReason is not null)
            ? RejectionReason
            : throw new ArgumentException(
                $"{nameof(RejectionReason)} must be non-null if and only if {nameof(Outcome)} is " +
                $"{nameof(WriteOutcome.Rejected)} (got Outcome={Outcome}, RejectionReason=" +
                $"{(RejectionReason is null ? "null" : RejectionReason.ToString())}).",
                nameof(RejectionReason));
}
