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

        _outstanding = true;
        var result = await operation(Master).ConfigureAwait(false);
        _outstanding = false;
        return result;
    }

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
