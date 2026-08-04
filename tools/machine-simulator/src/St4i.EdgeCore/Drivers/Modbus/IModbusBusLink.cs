using NModbus.IO;

namespace St4i.EdgeCore.Drivers.Modbus;

/// <summary>
/// Task D-2 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-2-brief.md) — the physical link a
/// <see cref="ModbusBus"/> arbitrates over: NModbus's own six-member <see cref="IStreamResource"/> plus the
/// three capabilities an RS-485 bus needs and that contract does not have. RTU-over-TCP
/// (<see cref="GatewayTcpBusLink"/>) implements this today; D-3's native serial adapter and D-6's paired
/// in-memory test link implement the SAME interface, so nothing above this line knows which transport it is
/// talking to.
///
/// <para><b>Why this interface exists at all, rather than plain <see cref="IStreamResource"/> — measured, not
/// assumed.</b> Two facts about NModbus 3.0.83 were established by probe (a standalone console app driving a
/// recording <see cref="IStreamResource"/> and a real loopback socket), not by reading:</para>
///
/// <list type="number">
/// <item><description><b><c>NModbus.IO.TcpClientAdapter.DiscardInBuffer()</c> IS A NO-OP.</b> Probed
/// directly: 8 stale bytes pushed at a connected <c>TcpClient</c>, <c>client.Available</c> == 8 before the
/// call and <b>8 after</b>, and the very next <c>Read(1)</c> returned the first STALE byte rather than the
/// fresh one written afterwards. This matters because <c>ModbusSerialTransport</c> calls
/// <c>DiscardInBuffer()</c> exactly once before writing every request (probed: 1 discard per attempt, 2 for
/// <c>Retries=1</c>) and that call is RTU's <i>entire</i> built-in stale-frame purge — RTU has no
/// transaction id to correlate with. Shipping NModbus's adapter on a gateway transport would therefore
/// silently ship an RTU stack with its one recovery step disabled. See <see cref="DrainBufferedInput"/>.</description></item>
/// <item><description><b><see cref="IStreamResource"/> extends <see cref="IDisposable"/>, and
/// <c>IModbusMaster.Dispose()</c> disposes it</b> (probed: disposing a master built over a recording stream
/// invoked that stream's <c>Dispose</c>). On a 1:1 transport that is harmless and is exactly what Đợt B's
/// <c>ct.Register(DisposeConnection)</c> cancellation relies on. On a SHARED bus it is the hazard this whole
/// task exists to avoid — which is why <see cref="ModbusBus"/> owns one master for the whole bus and
/// disposes it only when the last lease is released, and why cancellation uses
/// <see cref="AbortPendingRead"/> instead.</description></item>
/// </list>
///
/// <para><b>Threading.</b> Every member is called by <see cref="ModbusBus"/> under its arbitration lock and
/// therefore from at most one thread at a time — with ONE deliberate exception:
/// <see cref="AbortPendingRead"/> is called from a <see cref="CancellationToken"/> callback, i.e. from
/// another thread, concurrently with a <see cref="IStreamResource.Read"/> that is in flight. That one member
/// must be thread-safe; the rest need not be.</para>
/// </summary>
public interface IModbusBusLink : IStreamResource
{
    /// <summary>Whether this link still believes it is usable. A <see langword="false"/> answer makes
    /// <see cref="ModbusBus"/> tear the link down and rebuild it before the next transaction, rather than
    /// keep writing requests into a socket whose peer has gone. Best-effort by nature (a TCP peer that
    /// vanished without a FIN cannot be detected until a read/write actually fails) — this is a cheap check
    /// that catches the common case, never a guarantee, and <see cref="ModbusBus"/> does not rely on it for
    /// correctness: a link that lies here still fails at the next I/O and is faulted then.</summary>
    bool IsOpen { get; }

    /// <summary>
    /// Discards everything currently buffered on the receive side and reports HOW MANY bytes went. The count
    /// is the point: <see cref="IStreamResource.DiscardInBuffer"/> returns <see langword="void"/>, so a
    /// caller cannot tell "the line was already quiet" from "I just threw away a late frame" — and
    /// <see cref="ModbusBus"/>'s post-timeout resynchronisation needs exactly that distinction to decide
    /// whether the bus has actually gone quiet or is still emitting.
    ///
    /// <para>Must be non-blocking: it drains what has ALREADY arrived and returns, never waits for more.</para>
    ///
    /// <para>
    /// 🔴 <b>Task D-6 — blueprint §10 item 4 is ANSWERED HERE, and the answer is NO: this seam still cannot
    /// attribute a discarded byte to a unit id, so the <see cref="St4i.Connector.Abstractions.Models.WriteOutcome.Applied"/>-downgrade
    /// discriminator §10 item 4 describes remains unbuildable, and D-5's decision to decline it stands.</b>
    /// </para>
    ///
    /// <para>§10 item 4 assigns D-6 one precondition — <i>"một drain có quy trách nhiệm theo unit id"</i>, a
    /// drain that knows which slave address the bytes it just threw away carried. Checked, not assumed, and the
    /// three facts are unchanged from when §10 was written: this method returns a bare <see cref="int"/>; and
    /// <b>neither shipping implementation parses a frame</b> — <see cref="GatewayTcpBusLink.DrainBufferedInput"/>
    /// and <c>SerialPortBusLink.DrainBufferedInput</c> both read into a scratch buffer and accumulate a count.
    /// Nothing anywhere on this seam sees a slave address.</para>
    ///
    /// <para><b>Why that is fatal to the discriminator rather than merely inconvenient.</b> On a shared line the
    /// debris a resynchronisation discards usually belongs to a DIFFERENT device — which NModbus's own
    /// slave-address validation has already ruled out as an acknowledgement (D-5 measured <c>Response slave
    /// address does not match request</c>). An unattributed byte count therefore fires loudest exactly where the
    /// quiet window has already done its job, which is the argument D-5 recorded and this task re-checked rather
    /// than re-derived. <b>Building it would mean widening this member</b> (a per-unit-id count, or a drain that
    /// hands back the frames it dropped) <b>and teaching both links to frame</b> — a change to the shared
    /// transport contract, not to a driver. D-6 does not make it: nothing in this task needs it, and widening a
    /// safety seam for an unbuilt consumer is how a seam gets bent to fit.</para>
    ///
    /// <para><b>For whoever picks this up:</b> if the attribution is ever added, the discriminator should block
    /// on the SAME unit id and the SAME function code, per §10 item 4's own wording; and
    /// <see cref="ModbusRtuDriver.InvokeCommandAsync"/> is the member whose outcome it would change. Recorded on
    /// the seam rather than only in a report, because §10 exists precisely because an obligation living only in
    /// a report is an obligation the next author never reads.</para>
    ///
    /// <para>
    /// 🔴 <b>Task D-7a — §10 item 4 was handed forward again, and D-7a is NOT building it either. The reason is
    /// different from D-6's, and both are recorded because item 4's whole history is of being dropped between
    /// artefacts.</b>
    /// </para>
    ///
    /// <para>D-6 declined it because its <b>precondition</b> was unmet. D-7a re-checked that and it is still
    /// unmet, unchanged in every particular: this member still returns a bare <see cref="int"/>, and both
    /// shipping links still count bytes without framing. But D-7a also has a reason of its own, which is about
    /// the WORK rather than the seam. Building the attribution means teaching a link to parse Modbus RTU frames
    /// <i>inside the drain</i> — i.e. to frame a byte stream at the one moment the bus has already declared
    /// itself desynchronised, which is precisely when the stream is NOT a sequence of well-formed frames. A
    /// framer fed garbage does not report "garbage"; it reports whatever slave address the first plausible byte
    /// happens to be. That is a second Modbus framer, in the product, whose job is to attribute rubbish — and
    /// its failure mode is to attribute rubbish CONFIDENTLY, to a unit id, which is strictly worse than the
    /// unattributed count it replaces because a downgrade decision would then be taken on it.</para>
    ///
    /// <para><b>What would make it worth building, stated so the next task can test the claim rather than
    /// inherit the conclusion:</b> a link whose receive path frames CONTINUOUSLY (so the drain reports frames it
    /// had already parsed, rather than parsing at drain time), or a transport that carries a transaction
    /// identifier — which Modbus TCP has and RTU does not. Neither exists here, and neither is a change to a
    /// driver: both are changes to this contract and to every implementation of it. <b>D-7a's disposition:
    /// explicitly NOT BUILT, precondition still unmet, and the mitigation remains the one D-5 shipped — the
    /// residual is documented on <see cref="ModbusRtuDriver.InvokeCommandAsync"/>, and from D-7a a successful
    /// pulse's own <c>Detail</c> says in the API response and the audit row that an
    /// <see cref="St4i.Connector.Abstractions.Models.WriteOutcome.Applied"/> is an acknowledgement and not an
    /// observation.</b></para>
    /// </summary>
    /// <returns>The number of bytes discarded — 0 when nothing was buffered. <b>Not attributable to any unit
    /// id</b> — see the remarks above, which is a load-bearing limitation and not an omission.</returns>
    int DrainBufferedInput();

    /// <summary>
    /// Makes an in-flight <see cref="IStreamResource.Read"/> throw <see cref="OperationCanceledException"/>
    /// promptly, <b>without closing the link</b>. This is the member that replaces Đợt B's
    /// <c>ct.Register(DisposeConnection)</c>: on a shared bus, destroying the transport to unblock one
    /// device's read tears the line down for every other device on it (blueprint §2.1).
    ///
    /// <para><b>Called from another thread, concurrently with a read in flight — implementations must be
    /// thread-safe.</b> The flag it raises stays raised until <see cref="ResetAbort"/> clears it, so a read
    /// that had not started yet when the abort landed still fails rather than proceeding on a bus whose
    /// caller has already given up.</para>
    ///
    /// <para><b>What the caller must do afterwards:</b> an aborted read leaves the bus in EXACTLY the state a
    /// timeout leaves it in — a request went out and no complete, validated response was consumed, so the
    /// device may still answer. <see cref="ModbusBus"/> treats both identically: the bus is marked
    /// desynchronised and the next transaction resynchronises before it writes anything. There is deliberately
    /// no cheaper path for the abort case; assuming an aborted read is somehow cleaner than a timed-out one
    /// is precisely the kind of hopeful reasoning RTU punishes, because a stale RTU frame is
    /// indistinguishable from the next request's answer.</para>
    /// </summary>
    void AbortPendingRead();

    /// <summary>Clears the flag <see cref="AbortPendingRead"/> raised, so this link can be used again.
    /// <see cref="ModbusBus"/> calls this when the aborted transaction's scope ends — never the driver.
    /// Idempotent: clearing a flag that was never raised is a no-op.</summary>
    void ResetAbort();
}
