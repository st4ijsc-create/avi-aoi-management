using NModbus;

namespace St4i.EdgeCore.Drivers.Modbus;

/// <summary>
/// Task D-2 — exclusive use of one <see cref="ModbusBus"/> for the duration of one device's poll. Created by
/// <see cref="ModbusBus.BeginTransactionAsync"/>, which holds the arbitration lock on this scope's behalf;
/// disposing it releases that lock and settles whether the bus is now trustworthy.
///
/// <para><b>Every operation goes through <see cref="ExecuteAsync{T}"/>, and that is the point.</b> The bus's
/// quarantine decision hinges on one fact — did this transaction consume a complete, validated response? —
/// and that fact is only knowable at the exact instant an NModbus call returns normally. Making the caller
/// remember to report it would put the safety of the whole bus in a call the caller can forget; instead this
/// wrapper marks the bus dirty BEFORE the request goes out and clean only after the call returns, so every
/// failure shape there is — a timeout, an abort, a CRC mismatch, a slave-address mismatch, a dispose out from
/// under it, or something nobody anticipated — leaves it dirty by default. <see cref="Master"/> is exposed
/// for the D-5 write path and for diagnostics; using it directly bypasses that accounting, which is why it
/// says so on the property.</para>
/// </summary>
public sealed class ModbusBusTransaction : IAsyncDisposable
{
    private readonly ModbusBus _bus;
    private readonly IModbusBusLink _link;
    private readonly CancellationTokenRegistration _abortRegistration;

    /// <summary>False until an operation has started; true from the moment a request is about to be written
    /// until the moment that operation returns normally. Read once, at disposal.</summary>
    private bool _outstanding;
    private bool _disposed;

    /// <summary>0/1 — guards <see cref="ExecuteAsync{T}"/> against a second concurrent operation. See that
    /// method for why this is enforced rather than documented.</summary>
    private int _inFlight;

    internal ModbusBusTransaction(ModbusBus bus, IModbusMaster master, IModbusBusLink link, CancellationToken ct)
    {
        _bus = bus;
        _link = link;
        Master = master;

        // Cancellation mechanism #2 — see ModbusBus's own doc comment. This callback runs SYNCHRONOUSLY on the
        // cancelling thread, possibly while FleetHost holds its state lock (IDeviceDriver.ReadAsync spells out
        // that contract), so it must be prompt and must not throw: AbortPendingRead only raises a flag.
        // Contrast Đợt B's ct.Register(DisposeConnection), which performs real teardown from that same
        // position — tolerable at 1:1, unacceptable on a shared bus.
        //
        // If ct is ALREADY cancelled the callback runs inline right here, so the first read fails immediately
        // rather than issuing a request whose caller has already given up.
        _abortRegistration = ct.Register(link.AbortPendingRead);
    }

    /// <summary>The one master this bus owns. Exposed for D-5's write path; note that calling it directly
    /// bypasses <see cref="ExecuteAsync{T}"/>'s bus-state accounting, so a direct caller becomes responsible
    /// for the bus's trustworthiness — prefer <see cref="ExecuteAsync{T}"/>.</summary>
    public IModbusMaster Master { get; }

    /// <summary>Runs one NModbus operation and keeps the bus's own idea of whether it is synchronised
    /// correct. See this class's doc comment for why every operation must go through here.</summary>
    public async Task<T> ExecuteAsync<T>(Func<IModbusMaster, Task<T>> operation)
    {
        ArgumentNullException.ThrowIfNull(operation);
        ObjectDisposedException.ThrowIf(_disposed, this);

        // D-2 review (m-5) — one operation at a time, enforced rather than assumed. Unreachable through
        // ModbusRtuDriver, whose poll awaits each read before starting the next; reachable the moment
        // anything holds a transaction and issues two operations without awaiting the first, which is an
        // ordinary mistake for D-4's multidrop loop or D-5's write path to make. WHEN IT HAPPENS ANYWAY the
        // consequence is not a race on this flag, it is two requests interleaving their bytes on one shared
        // RS-485 line — the exact corruption the arbitration lock exists to prevent, arriving from inside
        // the lock rather than around it. Refused loudly here instead.
        if (Interlocked.Exchange(ref _inFlight, 1) != 0)
        {
            throw new InvalidOperationException(
                "ModbusBusTransaction: an operation is already in flight on this transaction. A Modbus RTU bus " +
                "carries one transaction at a time; issuing a second without awaiting the first would interleave " +
                "two requests' bytes on the shared line.");
        }

        try
        {
            _outstanding = true;
            var result = await operation(Master).ConfigureAwait(false);
            _outstanding = false;
            return result;
        }
        finally
        {
            Volatile.Write(ref _inFlight, 0);
        }
    }

    /// <summary>
    /// Releases the bus. <b>Deliberately does not wait for an in-flight operation</b> — the same rule
    /// <see cref="ModbusBus.DisposeAsync"/> and <see cref="ModbusTcpDriver.DisposeAsync"/> both follow, for
    /// the same reason (a driver's disposal can run while <c>FleetHost</c> holds its own gate, so waiting here
    /// even boundedly recreates the hazard that design closes).
    ///
    /// <para>D-2 review (m-5) — <b>what happens when it is disposed with an operation still in flight,</b>
    /// which <c>await using</c> makes hard to reach but which nothing prevents: the arbitration lock is
    /// released while that operation is still on the wire, so the NEXT device can begin a transaction and
    /// interleave with it. There is no way to make that safe from here without the bounded wait this rule
    /// forbids, so it is made LOUD rather than silent — the bus is quarantined unconditionally
    /// (<see cref="_outstanding"/> is still true, so <c>consumedAValidatedResponse</c> is false), which forces
    /// the next transaction to resynchronise before it writes. That converts a silent byte-interleaving into
    /// one quiet window, which is the best answer available at this seam.</para>
    /// </summary>
    public ValueTask DisposeAsync()
    {
        if (_disposed) return ValueTask.CompletedTask;
        _disposed = true;

        // Unregister first: after this returns, the callback is guaranteed not to be running and not to run
        // again, so clearing the flag below cannot race a late abort into the NEXT transaction.
        _abortRegistration.Dispose();
        try { _link.ResetAbort(); } catch { /* best-effort — a faulted link is torn down by the bus anyway */ }

        _bus.EndTransaction(consumedAValidatedResponse: !_outstanding);
        return ValueTask.CompletedTask;
    }
}
