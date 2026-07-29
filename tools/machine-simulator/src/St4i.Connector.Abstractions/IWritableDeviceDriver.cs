using St4i.Connector.Abstractions.Models;

namespace St4i.Connector.Abstractions;

/// <summary>
/// Task B-1 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-1-brief.md) — the OPTIONAL
/// capability a driver adds when it can also WRITE to the device it reads from: a setpoint write, or a
/// command/method invocation that can trigger real motion (a Modbus coil pulse, an OPC-UA <c>CallAsync</c>).
/// Deliberately a SEPARATE interface from <see cref="IDeviceDriver"/>, never a new member added onto it —
/// every existing driver, first- or third-party, implements <see cref="IDeviceDriver"/> alone today and MUST
/// keep compiling and working completely untouched by this interface's mere existence. A host asks "can this
/// driver write?" by testing an already-live <see cref="IDeviceDriver"/> reference for this capability —
/// <c>if (driver is IWritableDeviceDriver writable)</c> — never by assuming any particular driver id can or
/// cannot write, and never by requiring it.
///
/// <para><b>Never call <see cref="WriteSetpointAsync"/> or <see cref="InvokeCommandAsync"/> while holding
/// <c>FleetHost._gate</c>.</b> That is the SAME lock <c>FleetHost.Estop()</c> takes; a write call that blocks
/// while holding it blocks the halt path behind it, for as long as the write takes to complete — this
/// project already had a Critical of exactly this shape (disposing a driver under <c>_gate</c> blocked HALT
/// for up to 3 seconds). This is the mirror image of <see cref="IConnectorFactory.TryCreate"/>'s "MUST NOT
/// perform I/O" rule: that rule binds the IMPLEMENTER, because <c>TryCreate</c> is never supposed to touch a
/// network at all. This rule binds the CALLER instead, because a write genuinely DOES need to do I/O — that
/// is the entire point of this interface existing — so the obligation falls on whoever holds a live driver
/// reference: acquire it, release <c>_gate</c>, and only THEN call a member below. This interface has no
/// opinion on how a caller obtains that reference in the first place (that lookup path is a later task's
/// job) — only on what a caller must not still be holding when it uses one.</para>
///
/// <para><b>Setpoint write and command invocation are two distinct operations, each with its own request AND
/// result type, on purpose.</b> A setpoint sets a pre-declared value; a command can start a machine moving —
/// a later task gates the two at different RBAC roles specifically because conflating "set a value" with
/// "start a machine" is exactly the kind of collapse this project has spent several batches removing. Do not
/// add a third member that tries to do both, and do not let one result type serve both operations — see
/// <see cref="Models.SetpointWriteResult"/>/<see cref="Models.CommandResult"/>'s own doc comments for how far
/// this separation is carried (down to two separate rejection-reason enums).</para>
///
/// <para><b>Cancellation must be honoured promptly, same as <see cref="IDeviceDriver.ReadAsync"/> — but
/// getting there may cost a Modbus implementation real work.</b> OPC-UA's <c>WriteAsync</c>/<c>CallAsync</c>
/// both accept a <see cref="CancellationToken"/> natively. NModbus 3.0.83's write methods
/// (<c>WriteSingleCoilAsync</c>/<c>WriteSingleRegisterAsync</c>/<c>WriteMultipleRegistersAsync</c>/
/// <c>WriteMultipleCoilsAsync</c>) do NOT take one at all — the exact same trap <see cref="IDeviceDriver.ReadAsync"/>'s
/// own read path already hit. The proven fix carries over unchanged: bound the call with a transport-level
/// timeout AND register a callback on the token that force-closes the connection, exactly the shape
/// <c>ModbusTcpDriver.PollOnceAsync</c>'s own <c>ct.Register(DisposeConnection)</c> already uses on the read
/// side (measured to unblock an in-flight call in ~2ms). An implementation that just threads
/// <see cref="CancellationToken"/> through to a write call and calls the job done has NOT honoured this
/// contract — NModbus will silently ignore it, and the write can then run to whatever its own transport
/// timeout is, unbounded by anything the caller asked for.</para>
///
/// <para><b>Fix round 1 (task-1-report.md, IMPORTANT) — neither write method may let cancellation propagate
/// as an exception.</b> This is DIFFERENT from <see cref="IDeviceDriver.ReadAsync"/>, which explicitly
/// PERMITS throwing <see cref="OperationCanceledException"/> from its enumerator when <c>ct</c> is
/// cancelled — that is fine there because a cancelled read has nothing left to report. A write is not the
/// same shape: the whole reason <see cref="Models.WriteOutcome.Indeterminate"/> exists is to tell the caller
/// "the device's state is now unknown", and that information can ONLY reach the caller through the returned
/// <see cref="Models.SetpointWriteResult"/>/<see cref="Models.CommandResult"/> — never through a thrown
/// exception, which hands back no result object, no <c>Detail</c>, and no outcome at all. Concretely: when
/// the <c>ct.Register(DisposeConnection)</c>-style force-teardown described above fires (or <c>ct</c> is
/// otherwise cancelled) before a definitive applied/failed answer arrives, this method MUST catch whatever
/// that produces (an <see cref="OperationCanceledException"/>, an <see cref="System.IO.IOException"/> from
/// the torn-down connection, or similar) and RETURN a result with
/// <see cref="Models.WriteOutcome.Indeterminate"/> — never let it propagate. A caller awaiting
/// <c>Task&lt;SetpointWriteResult&gt;</c> that instead receives a thrown exception on cancellation gets
/// exactly the silent-failure-mode this whole contract exists to prevent.</para>
///
/// <para><b>No implicit retries, ever, for any reason, including a timeout.</b> A failed READ can be retried
/// harmlessly — the next poll just tries again. A failed or indeterminate WRITE cannot: retrying a setpoint
/// that may already have applied can leave a device holding the wrong value with no one the wiser, and
/// retrying a command that may already have fired can trigger a second coil pulse or a second
/// <c>CallAsync</c> — a real, physical double-actuation. An implementation of this interface MUST NOT retry
/// a write or command on its own initiative under any circumstance; the decision to try again belongs to a
/// human standing where they can see the machine, never to this driver. This is also precisely why
/// <see cref="Models.WriteOutcome.Indeterminate"/> is its own outcome, distinct from
/// <see cref="Models.WriteOutcome.Failed"/>: a timeout genuinely does not tell you whether the device applied
/// the write, and collapsing that uncertainty into "failed" — which reads as "safe to try again" — would be
/// exactly the silent-retry hazard this paragraph forbids. Most products hide the indeterminate case
/// entirely; this contract exists in part to stop hiding it, because an operator standing next to the
/// machine is the one person who most needs to know.</para>
///
/// <para><b>This capability is not, and does not provide, a safety function.</b> A real emergency stop is a
/// hardwired, safety-rated circuit (ISO 13849 Cat 3/4); software is never permitted to be the safety path,
/// and nothing in this interface changes that. Writing to a machine — including invoking a command that can
/// move it — is an operational capability with real consequences, not a substitute for one.</para>
/// </summary>
public interface IWritableDeviceDriver : IDeviceDriver
{
    /// <summary>
    /// The names of the points a caller may currently pass as <see cref="Models.SetpointWriteRequest.Point"/>
    /// to <see cref="WriteSetpointAsync"/> — capability discovery, so a caller can find out what is writable
    /// WITHOUT attempting a write first. An empty list is valid (e.g. a driver whose map currently declares
    /// no writable points). This is exactly the vocabulary <see cref="WriteSetpointAsync"/> accepts: points
    /// are named, never raw addresses, and resolving a name to a real device address is entirely this
    /// driver's own job — never the caller's, and never something this list itself needs to describe.
    ///
    /// <para>Fix round 1 (task-1-report.md, IMPORTANT) — lifetime, mutability, and thread-safety, spelled out
    /// the way <see cref="IDeviceDriver.Id"/>/<see cref="IDeviceDriver.Kind"/> already spell theirs out:</para>
    /// <list type="bullet">
    /// <item><description><b>Fixed for the lifetime of this instance</b> — same "unchanging for the lifetime
    /// of this instance" contract <see cref="IDeviceDriver.Id"/>/<see cref="IDeviceDriver.Kind"/> already
    /// carry. A driver whose writable configuration changes (an operator edits the map) gets a FRESH instance
    /// via a new <see cref="IConnectorFactory.TryCreate"/> call — exactly how every other reconfiguration in
    /// this codebase already works — never a live mutation of this property on a driver instance that is
    /// already running.</description></item>
    /// <item><description><b>Advisory, not authoritative.</b> A caller must not skip
    /// <see cref="WriteSetpointAsync"/>'s own validation on the strength of this list alone, and an
    /// implementation must not skip its own point-name validation on the assumption a caller already
    /// consulted this list. The write method's own <see cref="Models.WriteOutcome.Rejected"/> +
    /// <see cref="Models.SetpointRejectionReason.UnknownPoint"/> outcome is what is authoritative, never this
    /// property — this is what resolves the TOCTOU window between a caller reading this list and later
    /// calling <see cref="WriteSetpointAsync"/> (the two calls may not even be racing the SAME instance,
    /// since a configuration change replaces it).</description></item>
    /// <item><description><b>Must be safe to read concurrently with every other member of this driver</b>,
    /// including a concurrently-enumerating <see cref="IDeviceDriver.ReadAsync"/> — a future HTTP lookup path
    /// reads this from its own thread while the driver's background poll loop may be running on another.
    /// The returned list itself must never mutate after being handed out (same discipline
    /// <see cref="IDeviceDriver.ReadAsync"/>'s own doc comment already requires of a yielded
    /// <see cref="Models.DeviceReading"/>'s mutable collections) — return a stable, effectively-immutable
    /// list, never a live view over internal state a caller could observe changing mid-read.</description></item>
    /// </list>
    /// </summary>
    IReadOnlyList<string> WritablePoints { get; }

    /// <summary>
    /// The names of the commands a caller may currently pass as <see cref="Models.CommandRequest.Command"/>
    /// to <see cref="InvokeCommandAsync"/> — capability discovery, mirroring
    /// <see cref="WritablePoints"/>'s own contract EXACTLY (including its lifetime/advisory/thread-safety
    /// rules — see that property's own doc comment), for commands instead of setpoints. An empty list is
    /// valid.
    /// </summary>
    IReadOnlyList<string> Commands { get; }

    /// <summary>
    /// Attempts to set <see cref="Models.SetpointWriteRequest.Point"/> (a name from
    /// <see cref="WritablePoints"/> — never a raw address) to <see cref="Models.SetpointWriteRequest.Value"/>.
    ///
    /// <para>MUST return <see cref="Models.WriteOutcome.Rejected"/> WITHOUT touching the device at all for an
    /// unknown point, a point the map declares read-only, or a value outside that point's declared range —
    /// see <see cref="Models.SetpointRejectionReason"/>. Those are the caller's mistakes, not the device's,
    /// and a rejection this cheap belongs before any I/O, never after.</para>
    ///
    /// <para>See this interface's own doc comment for the <c>_gate</c>, cancellation, and no-retry rules
    /// that govern every call to this method — they are not repeated here. In particular: if <paramref
    /// name="ct"/> is cancelled before a definitive answer arrives, RETURN
    /// <see cref="Models.WriteOutcome.Indeterminate"/> — do not let the cancellation propagate as an
    /// exception (see the interface doc comment's "Fix round 1" paragraph).</para>
    /// </summary>
    /// <param name="request">Which point to write, and what value.</param>
    /// <param name="ct">Honoured promptly — see this interface's own doc comment for what that requires of a
    /// NModbus-backed implementation specifically.</param>
    Task<SetpointWriteResult> WriteSetpointAsync(SetpointWriteRequest request, CancellationToken ct);

    /// <summary>
    /// Attempts to invoke <see cref="Models.CommandRequest.Command"/> (a name from <see cref="Commands"/> —
    /// never a raw method/function code) with <see cref="Models.CommandRequest.Arguments"/>. This is the
    /// highest-risk member of this whole interface: unlike <see cref="WriteSetpointAsync"/>, a command CAN
    /// trigger real, physical motion.
    ///
    /// <para>MUST return <see cref="Models.WriteOutcome.Rejected"/> WITHOUT touching the device at all for an
    /// unknown command or a missing/malformed argument — see <see cref="Models.CommandRejectionReason"/>. Same
    /// "cheap rejection before any I/O" discipline as <see cref="WriteSetpointAsync"/>.</para>
    ///
    /// <para>See this interface's own doc comment for the <c>_gate</c>, cancellation, and no-retry rules —
    /// the no-retry rule matters MOST here: a retried command can physically re-fire whatever it just
    /// triggered. Same cancellation obligation as <see cref="WriteSetpointAsync"/>: if <paramref name="ct"/>
    /// is cancelled before a definitive answer arrives, RETURN
    /// <see cref="Models.WriteOutcome.Indeterminate"/> — never let it propagate as an exception.</para>
    /// </summary>
    /// <param name="request">Which command to invoke, and its arguments.</param>
    /// <param name="ct">Honoured promptly — see this interface's own doc comment.</param>
    Task<CommandResult> InvokeCommandAsync(CommandRequest request, CancellationToken ct);
}
