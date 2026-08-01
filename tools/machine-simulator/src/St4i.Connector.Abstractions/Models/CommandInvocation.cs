namespace St4i.Connector.Abstractions.Models;

/// <summary>
/// Task B-1 — one attempt to invoke a single, pre-declared command/method on a device — OPC-UA's
/// <c>CallAsync</c>, a Modbus coil pulse. Unlike <see cref="SetpointWriteRequest"/>, a command CAN trigger
/// real motion — the product owner's own reason this capability exists at all (see
/// <see cref="IWritableDeviceDriver"/>'s doc comment) — which is exactly why it is never conflated with a
/// setpoint write, at any level of this contract, including this type's own name.
///
/// <para><see cref="Command"/> is a NAME from the target driver's own
/// <see cref="IWritableDeviceDriver.Commands"/> list, never a raw method/function code — same discipline as
/// <see cref="SetpointWriteRequest.Point"/>.</para>
/// </summary>
/// <param name="Command">The command's declared name — see <see cref="IWritableDeviceDriver.Commands"/>.</param>
/// <param name="Arguments">Optional named arguments, in the same value domain
/// <see cref="DeviceReading.Genealogy"/> already uses (string|int|double — see
/// <see cref="Json.ConnectorObjectConverter"/>'s own doc comment). <see langword="null"/> for a command that
/// takes none.
///
/// <para>Fix round 1 (task-1-report.md, Minor) — this contract carries NO argument-type schema (which
/// arguments a command expects, and their declared types, is the map's job — a later task). The shared
/// object? converter's actual accepted write-domain is WIDER than the string|int|double documented above
/// (see <see cref="Json.ConnectorObjectConverter"/>'s own doc comment: every CLR integral primitive widens
/// to <see langword="long"/>, and <see langword="float"/> widens to <see langword="double"/>), and an
/// implementation must expect to RE-NARROW a value against whatever type the map actually declares for that
/// argument — e.g. an OPC-UA argument typed <c>UInt16</c> on the wire arrives here as a boxed
/// <see langword="long"/> (decision (a)'s integral-widening rule) and must be range-checked and narrowed by
/// the implementation before use, not assumed to already be the target type.</para></param>
public sealed record CommandRequest(string Command, Dictionary<string, object>? Arguments = null);

/// <summary>
/// Task B-1 — why a <see cref="CommandResult"/> was <see cref="WriteOutcome.Rejected"/> WITHOUT the device
/// ever being touched. Kept as its OWN enum, separate from <see cref="SetpointRejectionReason"/> — see that
/// enum's own doc comment for why.
/// </summary>
public enum CommandRejectionReason
{
    /// <summary><see cref="CommandRequest.Command"/> does not name a command this driver knows about at
    /// all.</summary>
    UnknownCommand,

    /// <summary>A required argument was missing, or a supplied argument's value/type does not match what the
    /// command declares — caught and refused before it ever reaches the device.</summary>
    InvalidArgument,
}

/// <summary>
/// Task B-1 — the outcome of one <see cref="CommandRequest"/>. Deliberately its OWN result type, never
/// shared with <see cref="SetpointWriteResult"/> — see <see cref="IWritableDeviceDriver"/>'s own doc comment
/// for why setpoint and command are never conflated, including at the result-type level.
/// </summary>
/// <param name="Command">Echoes the request's <see cref="CommandRequest.Command"/>.</param>
/// <param name="Outcome">Which of the four outcomes this attempt landed on — see <see cref="WriteOutcome"/>.
/// Deliberately NOT settable via a <see langword="with"/> expression — see this property's own doc comment
/// below.</param>
/// <param name="RejectionReason">Non-null if and only if <paramref name="Outcome"/> is
/// <see cref="WriteOutcome.Rejected"/>. <see langword="null"/> for every other outcome. Deliberately NOT
/// settable via a <see langword="with"/> expression — see this property's own doc comment below.</param>
/// <param name="Detail">Optional operator-readable free text — see
/// <see cref="SetpointWriteResult.Detail"/>'s own remarks; the same role here.</param>
public sealed record CommandResult(
    string Command,
    WriteOutcome Outcome,
    CommandRejectionReason? RejectionReason = null,
    string? Detail = null)
{
    /// <summary>
    /// Fix round 2 (task-1-report.md, IMPORTANT) — same reasoning, and the same
    /// <see langword="get"/>-only-with-no-<see langword="init"/> shape, as
    /// <see cref="SetpointWriteResult.Outcome"/>'s own doc comment; see there for the full rationale
    /// (a <see langword="with"/> expression bypasses a property's INITIALIZER but still invokes its
    /// <see langword="init"/> ACCESSOR directly, so fix round 1's validating initializer alone was not
    /// enough — removing <see langword="init"/> entirely closes it at compile time instead).
    /// </summary>
    public WriteOutcome Outcome { get; } = Outcome;

    /// <summary>See <see cref="Outcome"/>'s own doc comment for why this has no <see langword="init"/>
    /// accessor. The validating initializer itself is unchanged from fix round 1.</summary>
    public CommandRejectionReason? RejectionReason { get; } =
        (Outcome == WriteOutcome.Rejected) == (RejectionReason is not null)
            ? RejectionReason
            : throw new ArgumentException(
                $"{nameof(RejectionReason)} must be non-null if and only if {nameof(Outcome)} is " +
                $"{nameof(WriteOutcome.Rejected)} (got Outcome={Outcome}, RejectionReason=" +
                $"{(RejectionReason is null ? "null" : RejectionReason.ToString())}).",
                nameof(RejectionReason));
}
