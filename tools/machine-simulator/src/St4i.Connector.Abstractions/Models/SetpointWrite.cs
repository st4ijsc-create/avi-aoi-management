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

    /// <summary>The point exists but is declared read-only — writing to it was never authorized.</summary>
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
/// <param name="Outcome">Which of the four outcomes this attempt landed on — see <see cref="WriteOutcome"/>.</param>
/// <param name="RejectionReason">Non-null if and only if <paramref name="Outcome"/> is
/// <see cref="WriteOutcome.Rejected"/> — which specific pre-flight check failed. <see langword="null"/> for
/// every other outcome.</param>
/// <param name="Detail">Optional operator-readable free text — e.g. what a Failed/Indeterminate attempt
/// actually saw (a device error code, "timed out after 3000ms"). Never required, never machine-parsed by
/// any caller — the same role <see cref="IConnectorFactory.TryCreate"/>'s own <c>error</c> parameter already
/// plays for a failed <c>TryCreate</c> call.</param>
public sealed record SetpointWriteResult(
    string Point,
    WriteOutcome Outcome,
    SetpointRejectionReason? RejectionReason = null,
    string? Detail = null);
