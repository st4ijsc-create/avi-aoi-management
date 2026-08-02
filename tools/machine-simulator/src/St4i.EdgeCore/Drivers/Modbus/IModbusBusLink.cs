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
    /// </summary>
    /// <returns>The number of bytes discarded — 0 when nothing was buffered.</returns>
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
