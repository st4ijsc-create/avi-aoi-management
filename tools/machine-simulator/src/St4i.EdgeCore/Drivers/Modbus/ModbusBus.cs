using NModbus;

namespace St4i.EdgeCore.Drivers.Modbus;

/// <summary>Task D-2 — thrown when a <see cref="ModbusBus"/> cannot make itself trustworthy again: the link
/// would not go quiet within the resynchronisation budget after a timed-out/aborted transaction (a babbling
/// device, or a gateway replaying a backlog), or the drain itself failed. It is deliberately a THROW and not
/// a silent "carry on": the whole point of the resynchronisation step is that RTU cannot tell a stale frame
/// from the next request's answer, so proceeding on a bus that never went quiet would hand a caller a number
/// that looks exactly like a good one. The bus faults its link when this is raised, so the next transaction
/// starts from a fresh one.</summary>
public sealed class ModbusBusResynchronisationException : Exception
{
    public ModbusBusResynchronisationException(string message, Exception? inner = null) : base(message, inner) { }
}

/// <summary>
/// Task D-2 — the knobs of <see cref="ModbusBus"/>'s post-timeout recovery. Defaults are the ones every
/// call site in this task uses; they exist as settings only because D-3's serial link and D-4's multidrop
/// cadence have a legitimate reason to want different ones.
/// </summary>
/// <param name="QuietWindowMs">
/// <b>The answer to "how long must the bus be silent before the next transaction is safe".</b> After a
/// transaction that did not consume a complete, validated response, <see cref="ModbusBus"/> refuses to write
/// anything until it has OBSERVED this many consecutive milliseconds with no byte arriving. Observed, not
/// merely elapsed: any byte that lands restarts the window, so a late frame is drained AND paid for rather
/// than slept through. 50 ms is comfortably longer than RTU's own t3.5 inter-frame silence at every
/// practical baud rate (3.5 characters is ~4 ms at 9600 baud, ~0.4 ms at 115200) and long enough to absorb
/// the store-and-forward latency of a serial→Ethernet gateway on a LAN, without making a timeout on one
/// device an expensive event for the rest of the bus.
/// </param>
/// <param name="PollSliceMs">How often the quiet window is sampled. Bounds how much longer than
/// <paramref name="QuietWindowMs"/> a resynchronisation can take, and nothing else.</param>
/// <remarks>
/// 🔴 <b>A record CLASS, not a <c>readonly record struct</c>, and the difference is not stylistic.</b> This
/// shipped as a struct first and every test that used the defaults failed on the first run — because for a
/// struct, <c>new ModbusBusSettings()</c> and <c>default</c> both produce the ZERO value and <b>silently
/// ignore the declared parameter defaults</b>. Verified in isolation: <c>readonly record struct
/// S(int Q = 50)</c> gives <c>new S().Q == 0</c>, while the same declaration as a record class gives 50.
/// A zero <see cref="QuietWindowMs"/> would have meant "observe silence without ever looking" — i.e. the
/// resynchronisation step present, running, and doing nothing, on a bus whose reads would then be
/// occasionally and plausibly wrong. That is the same defect class as an enum whose default value means
/// success, which this codebase has already been bitten by once
/// (<see cref="St4i.Connector.Abstractions.Models.WriteOutcome"/>). It was caught only because
/// <see cref="ModbusBus"/>'s constructor validates the value instead of trusting it — an argument check
/// written on the "assert the failure, don't assume it can't happen" rule, which earned its keep before this
/// file was ever committed.
/// </remarks>
public sealed record ModbusBusSettings(int QuietWindowMs = 50, int PollSliceMs = 5)
{
    public static ModbusBusSettings Default { get; } = new();
}

/// <summary>
/// Task D-2 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-2-brief.md) — <b>one RS-485 bus.</b>
/// Owns the physical link (<see cref="IModbusBusLink"/>), the ONE NModbus RTU master that speaks over it,
/// the arbitration lock that makes exactly one transaction be in flight at a time, and the
/// post-timeout quarantine that decides when the next transaction is allowed to start.
///
/// <para><b>Why one master for the whole bus, and not one per device.</b> A Modbus RTU master addresses the
/// slave by a byte on the wire — every <c>IModbusMaster</c> read/write overload already takes
/// <c>slaveAddress</c> as its first argument — so ONE master serves N slaves natively. That is not merely
/// convenient: probing NModbus 3.0.83 showed <c>IStreamResource</c> extends <see cref="IDisposable"/> and
/// <c>IModbusMaster.Dispose()</c> disposes it, so N masters over one shared link would give N independent
/// objects each able to destroy the shared line by being disposed. The N-masters shape is not a heavier
/// version of this one; it is an unsafe one.</para>
///
/// <para><b>🔴 The cancellation design, and what it replaces.</b> Đợt B honours a
/// <see cref="CancellationToken"/> through NModbus (whose read/write overloads take none) by DESTROYING the
/// transport — <c>ct.Register(DisposeConnection)</c>, measured there at ~2 ms. That is correct for a 1:1 TCP
/// driver and catastrophic here: cancelling one device's read would tear the line down for every other
/// device on the bus. This class uses two mechanisms instead, in this order:</para>
///
/// <list type="number">
/// <item><description><b>Cancel while awaiting arbitration</b> — <see cref="SemaphoreSlim.WaitAsync(CancellationToken)"/>
/// in <see cref="BeginTransactionAsync"/>. Exact and free: the cancelled caller's request never reached the
/// wire, so there is nothing to recover from and the bus is not disturbed at all. On a busy multidrop bus
/// this is where a cancellation lands the great majority of the time, because a device spends far longer
/// queued for the bus than holding it.</description></item>
/// <item><description><b>Cancel while a read is in flight</b> — <see cref="IModbusBusLink.AbortPendingRead"/>,
/// registered on the caller's token for the life of the transaction. It raises a flag the link's own read
/// loop checks; the read throws promptly and <b>the link stays open</b>. No other device's transaction is
/// touched, because no other device's transaction can exist: the arbitration lock is held.</description></item>
/// </list>
///
/// <para><b>Dispose is reserved for the last reference.</b> The link and master are torn down when the last
/// <see cref="ModbusBusLease"/> is released (see <see cref="ModbusBusRegistry"/>), or when the link itself is
/// faulted and must be rebuilt — never as a cancellation mechanism.</para>
///
/// <para><b>🔴 What happens to the bus after a timeout, and how the next transaction knows it is safe.</b>
/// RTU carries no transaction id — TCP's MBAP header does, so a late TCP response can be recognised and
/// discarded, whereas <b>a stale RTU response is indistinguishable from the next request's answer</b>. Three
/// facts, all established by probe against NModbus 3.0.83 rather than by reading:</para>
///
/// <list type="bullet">
/// <item><description><c>ModbusSerialTransport</c> calls <c>DiscardInBuffer()</c> exactly once before writing
/// each request attempt. That is RTU's entire built-in purge, and it only removes bytes that have ALREADY
/// arrived — it does nothing about a frame still in flight.</description></item>
/// <item><description>A stale frame whose slave address differs from the request's IS caught
/// (<c>IOException</c>: "Response slave address does not match request"), and so is one whose function code
/// differs, and so is a bad CRC.</description></item>
/// <item><description><b>A stale frame with the same slave address, the same function code and the same byte
/// count is NOT caught and is returned to the caller as the answer.</b> Probed directly: a request for
/// register 99 returned register 0's stale value, silently, with no exception. This is not an NModbus defect
/// — there is nothing in an RTU response frame left to check.</description></item>
/// </list>
///
/// <para>So this class does not hope. Any transaction that does not consume a complete, validated response —
/// a timeout, an abort, a CRC failure, an address/function mismatch, a dispose out from under it — marks the
/// bus <see cref="IsDesynchronised"/>. The NEXT transaction, holding the arbitration lock and before writing
/// a single byte, runs <see cref="ResynchroniseAsync"/>: drain everything buffered, and keep draining until
/// the link has produced <b>no byte for <see cref="ModbusBusSettings.QuietWindowMs"/> consecutive
/// milliseconds</b>. A late frame that lands during the window is discarded and restarts it. If the link
/// never goes quiet within the budget, the transaction is REFUSED
/// (<see cref="ModbusBusResynchronisationException"/>) and the link is faulted — a bus that will not go quiet
/// is not one to write to.</para>
///
/// <para><b>The residual hole, stated rather than papered over.</b> Silence proves nothing about a frame that
/// has not been emitted yet: a device that answers a timed-out request LATER than
/// <see cref="ModbusBusSettings.QuietWindowMs"/> after the bus went quiet is still able to desynchronise the
/// next transaction, and if that frame happens to match the next request's slave address, function code and
/// length it is undetectable. What the quiet window buys is that this requires a device to answer later than
/// its own read timeout PLUS a full observed-silent window, which is a far narrower failure than "any late
/// answer at all" — and the mitigation is a per-device <c>ReadTimeoutMs</c> sized for the slowest legitimate
/// round trip (<see cref="ModbusRegisterMap.ReadTimeoutMs"/> already exists for exactly this). It is not
/// closable in general on RTU; claiming otherwise would be the hopeful answer the brief forbids.</para>
///
/// <para><b>The cost this design charges, named.</b> A quarantine is per-BUS, not per-device: one device's
/// timeout costs every other device on that bus one quiet window before its next poll. That is inherent —
/// a desynchronised bus is desynchronised for everyone, because the stale frame will be read by whoever reads
/// next, not by whoever caused it. It is still strictly cheaper than Đợt B's mechanism, which would cost
/// every device a full teardown and reconnect.</para>
/// </summary>
public sealed class ModbusBus : IAsyncDisposable
{
    private static readonly ModbusFactory Factory = new();

    private readonly Func<CancellationToken, Task<IModbusBusLink>> _openLink;
    private readonly ModbusBusSettings _settings;

    /// <summary>The arbitration lock — capacity 1. Held for the whole of one transaction (resynchronisation,
    /// every register of a poll, teardown of the transaction scope), so exactly one request is ever on the
    /// wire. Cancellable while queued, which is cancellation mechanism #1 in this class's own doc comment.
    /// Mirrors <see cref="ModbusTcpDriver"/>'s <c>_ioLock</c> discipline exactly; the difference is only that
    /// there it serialises one driver's poll against its own write, and here it serialises N devices against
    /// each other.</summary>
    private readonly SemaphoreSlim _arbitration = new(1, 1);

    private IModbusBusLink? _link;
    private IModbusSerialTransport? _transport;
    private IModbusMaster? _master;
    private bool _desynchronised;
    private volatile bool _disposed;

    // Backing fields for the observable counters. See ResynchronisationCount's own remarks for why all five
    // go through Volatile rather than only the one that already did.
    private int _resynchronisationCount;
    private int _lastResynchronisationBytesDiscarded;
    private int _lastTransactionReadTimeoutMs;
    private int _lastTransactionRetries = -1;
    private int _linkGeneration;

    public ModbusBus(string key, Func<CancellationToken, Task<IModbusBusLink>> openLink, ModbusBusSettings settings)
    {
        Key = key ?? throw new ArgumentNullException(nameof(key));
        _openLink = openLink ?? throw new ArgumentNullException(nameof(openLink));

        if (settings.QuietWindowMs <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(settings), settings.QuietWindowMs,
                "ModbusBusSettings.QuietWindowMs must be > 0 — a zero-length quiet window would 'observe' silence " +
                "without ever looking, which is the hopeful answer this whole mechanism exists to avoid.");
        }

        if (settings.PollSliceMs <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(settings), settings.PollSliceMs,
                "ModbusBusSettings.PollSliceMs must be > 0.");
        }

        _settings = settings;
    }

    /// <summary>The identity this bus is shared under — see <see cref="ModbusBusRegistry.Acquire"/> for the
    /// rule the key must satisfy.</summary>
    public string Key { get; }

    /// <summary>Whether the next transaction must resynchronise before it may write. Observable so a test can
    /// assert the quarantine was ENTERED, not merely that a later read happened to be correct.</summary>
    public bool IsDesynchronised => Volatile.Read(ref _desynchronised);

    /// <summary>
    /// 🔴 <b>Every observable counter on this type is read and written through <see cref="Volatile"/>, and
    /// that uniformity is the point.</b> All of them are written while the arbitration lock is held and read
    /// from other threads (a test thread; in production, anything sampling the bus for diagnostics). It is
    /// true that every reader today crosses an <see langword="await"/> first, which is a full barrier — so
    /// plain fields would work. But <see cref="IsDesynchronised"/> was already
    /// <see cref="Volatile"/>-guarded while the four counters beside it were not, and a type where some
    /// cross-thread state is guarded and some is not forces the next reader to re-derive which is which,
    /// per field, from an argument about await points that no longer holds the moment someone samples one of
    /// these from a timer callback. Made uniform rather than individually justified.
    ///
    /// <para>How many times this bus has resynchronised. Observable so a test can assert the quarantine was
    /// ENTERED, not merely that a later read happened to be correct.</para>
    /// </summary>
    public int ResynchronisationCount => Volatile.Read(ref _resynchronisationCount);

    /// <summary>Bytes discarded by the most recent resynchronisation — the evidence that a late frame really
    /// was on the line, rather than the window merely elapsing. See
    /// <see cref="ResynchronisationCount"/> for why this is <see cref="Volatile"/>.</summary>
    public int LastResynchronisationBytesDiscarded => Volatile.Read(ref _lastResynchronisationBytesDiscarded);

    /// <summary>
    /// 🔴 The <c>readTimeoutMs</c> and <c>retries</c> the most recent <see cref="BeginTransactionAsync"/>
    /// applied to the shared transport. Observable for one reason: <b>a test that passes these values in
    /// itself proves only that the plumbing honours them, and says nothing about what a DRIVER passes.</b>
    /// A mutation hardcoding <c>Retries = 3</c> inside <see cref="ModbusRtuDriver"/> left all 153 Modbus
    /// tests green, because every test that cared supplied its own arguments. These let a test assert the
    /// driver's OWN map reached the wire — which is the property D-5's no-implicit-retry rule actually needs,
    /// since the retry count is a physical double-actuation hazard for a write.
    /// </summary>
    public int LastTransactionReadTimeoutMs => Volatile.Read(ref _lastTransactionReadTimeoutMs);

    /// <inheritdoc cref="LastTransactionReadTimeoutMs"/>
    public int LastTransactionRetries => Volatile.Read(ref _lastTransactionRetries);

    /// <summary>
    /// Incremented every time a NEW physical link is opened. <b>This is the number that proves a cancellation
    /// did not destroy the transport:</b> a test cancels a device's in-flight read, then drives a second
    /// device on the same bus, and asserts this value never moved. Asserting "the second read succeeded"
    /// alone would not distinguish "the link survived" from "the link was rebuilt fast enough that nobody
    /// noticed" — which is precisely the behaviour this task exists to eliminate.
    /// </summary>
    public int LinkGeneration => Volatile.Read(ref _linkGeneration);

    /// <summary>
    /// Takes the bus and returns a scope in which <see cref="ModbusBusTransaction.ExecuteAsync{T}"/> may be
    /// called. Cancellable while queued (mechanism #1); the returned scope registers
    /// <see cref="IModbusBusLink.AbortPendingRead"/> on <paramref name="ct"/> (mechanism #2). The caller MUST
    /// dispose the scope — the arbitration lock is released there, and so is the decision about whether the
    /// bus is now desynchronised.
    /// </summary>
    /// <param name="readTimeoutMs">Applied to <c>Transport.ReadTimeout</c>/<c>WriteTimeout</c> for the
    /// duration of this transaction only. Per-transaction rather than per-bus because N devices on one bus
    /// legitimately answer at different speeds; the transport is shared but the bound is not. Probed: setting
    /// it on the transport propagates it onto the <c>IStreamResource</c>, which is what actually bounds the
    /// read.</param>
    /// <param name="retries">Applied to <c>Transport.Retries</c> for the duration of this transaction only.
    /// <b>Probed: NModbus's RTU transport defaults to <c>Retries = 3</c> and <c>ReadTimeout = -1</c>
    /// (infinite)</b> — neither default is acceptable here, so both are always set explicitly and never left
    /// to whatever the previous transaction happened to want. Đợt B's finding carries over unchanged: a retry
    /// re-sends the WHOLE request (probed: 2 writes for <c>Retries = 1</c>), which is a harmless extra read
    /// and a physical double-actuation hazard for the write path D-5 will build.</param>
    /// <exception cref="ArgumentOutOfRangeException">
    /// 🔴 <paramref name="readTimeoutMs"/> is not positive, or <paramref name="retries"/> is negative.
    /// <b>Validated BEFORE the arbitration lock is taken, and the reason is that the failure mode is not
    /// "one slow device".</b> A non-positive timeout reaches
    /// <see cref="GatewayTcpBusLink.Read"/>'s <c>ReadTimeout &gt; 0 ? … : (long?)null</c> and produces no
    /// deadline at all — and that read happens while this bus's arbitration lock is HELD, so every other
    /// device on the bus blocks behind it indefinitely, with no exception and nothing logged, until
    /// <c>FleetHost</c> tears the driver down. That is exactly the "a test which hangs under a defect is
    /// strictly worse than one that fails under it" rule this task's own report argues, applied to
    /// production. It is also the standard this very file already sets: <see cref="ModbusBusSettings"/> is
    /// validated in the constructor rather than trusted, and that check is what caught the
    /// <c>readonly record struct</c> zero-initialisation trap before it ever shipped. Checked here rather
    /// than assumed from <see cref="ModbusRegisterMap.EffectiveReadTimeoutMs"/>'s own floor, because the bus
    /// is a public seam D-4 and D-5 will call from code that does not exist yet.
    /// </exception>
    public async Task<ModbusBusTransaction> BeginTransactionAsync(int readTimeoutMs, int retries, CancellationToken ct)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);

        if (readTimeoutMs <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(readTimeoutMs), readTimeoutMs,
                "ModbusBus: readTimeoutMs must be > 0. A non-positive bound leaves the read unbounded, and it is " +
                "taken while this bus's arbitration lock is held — so it stalls every device on the bus, silently.");
        }

        if (retries < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(retries), retries,
                "ModbusBus: retries must be >= 0 (0 means the one attempt this product's no-implicit-retry rule " +
                "requires for a write).");
        }

        // Cancellation mechanism #1 — exact, and the transaction has not started.
        await _arbitration.WaitAsync(ct).ConfigureAwait(false);

        var handedOff = false;
        try
        {
            ObjectDisposedException.ThrowIf(_disposed, this);

            var link = await EnsureLinkAsync(ct).ConfigureAwait(false);

            // A stale abort flag from a PREVIOUS transaction would make this one fail for a cancellation that
            // is already over. The transaction scope clears it on the way out too; this is the belt to that
            // braces, and it is cheap.
            link.ResetAbort();

            if (_desynchronised)
            {
                await ResynchroniseAsync(link, readTimeoutMs, ct).ConfigureAwait(false);
            }

            var transport = _transport ?? throw new InvalidOperationException(
                "ModbusBus: the link is open but no transport was built. EnsureLinkAsync always builds both or " +
                "neither, so reaching this means that invariant was broken by a later edit — the transaction is " +
                "refused rather than run against a half-built bus.");

            transport.ReadTimeout = readTimeoutMs;
            transport.WriteTimeout = readTimeoutMs;
            transport.Retries = retries;

            Volatile.Write(ref _lastTransactionReadTimeoutMs, readTimeoutMs);
            Volatile.Write(ref _lastTransactionRetries, retries);

            var transaction = new ModbusBusTransaction(this, _master!, link, ct);
            handedOff = true;
            return transaction;
        }
        finally
        {
            // Released here ONLY when no transaction was handed out; otherwise the transaction's own disposal
            // owns the release. Two different owners for one release is exactly how a lock gets leaked or
            // double-released, so which one owns it is decided by this single flag.
            if (!handedOff)
            {
                _arbitration.Release();
            }
        }
    }

    /// <summary>Opens the link (and its transport/master) if there is not already a usable one. Never called
    /// outside the arbitration lock.</summary>
    private async Task<IModbusBusLink> EnsureLinkAsync(CancellationToken ct)
    {
        if (_link is { IsOpen: true } live && _master is not null && _transport is not null)
        {
            return live;
        }

        TearDownLink();

        var link = await _openLink(ct).ConfigureAwait(false);

        IModbusSerialTransport transport;
        IModbusMaster master;
        try
        {
            // NModbus 3.0.83: CreateRtuMaster is a static extension (NModbus.FactoryExtensions), not an
            // IModbusFactory member — these two calls are its documented equivalent. Every read/write call
            // this codebase makes lives on IModbusMaster and is byte-identical to the TCP driver's;
            // IModbusSerialMaster adds only Transport and one diagnostic, neither of which is needed here.
            transport = Factory.CreateRtuTransport(link);
            master = Factory.CreateMaster(transport);
        }
        catch
        {
            try { link.Dispose(); } catch { /* best-effort — see TearDownLink's own reasoning */ }
            throw;
        }

        if (_disposed)
        {
            // Same hazard ModbusTcpDriver.EnsureConnectedAsync documents: disposal can complete WHILE the
            // connect above is in flight, landing a live link on an already-disposed bus that nothing would
            // ever close again. Disposing the master disposes the link with it (probed).
            try { master.Dispose(); } catch { /* best-effort */ }
            throw new ObjectDisposedException(nameof(ModbusBus), "ModbusBus was disposed while opening its link.");
        }

        _link = link;
        _transport = transport;
        _master = master;
        Volatile.Write(ref _linkGeneration, _linkGeneration + 1);

        // Deliberately NOT clearing _desynchronised here. A fresh TCP socket genuinely cannot carry the
        // previous link's stale bytes — but D-3's serial link can: re-opening a COM port purges the local
        // UART buffer and tells the DEVICE on the far end nothing, so a slave mid-transmission is still
        // mid-transmission. Clearing the flag would be correct for one transport and wrong for the other, and
        // the version that is wrong is the one that returns a plausible wrong number. The cost of being
        // conservative is one quiet window on a link that was going to be idle anyway.
        return link;
    }

    /// <summary>
    /// 🔴 The post-timeout recovery. Drains until the link has produced no byte for
    /// <see cref="ModbusBusSettings.QuietWindowMs"/> consecutive milliseconds — see this class's own doc
    /// comment for the full argument, including what it does and does not buy. Never called outside the
    /// arbitration lock, and always BEFORE any byte of the new request is written.
    /// </summary>
    private async Task ResynchroniseAsync(IModbusBusLink link, int readTimeoutMs, CancellationToken ct)
    {
        var quietWindowMs = _settings.QuietWindowMs;

        // The budget must be able to contain at least one full quiet window or this could never succeed; four
        // of them, or the transaction's own read timeout if that is longer, gives a genuinely late frame room
        // to land and be paid for without letting a babbling device stall the bus indefinitely.
        var budgetMs = Math.Max(quietWindowMs * 4, readTimeoutMs);
        var deadline = Environment.TickCount64 + budgetMs;
        var lastByteAt = Environment.TickCount64;
        var discarded = 0;

        while (true)
        {
            ct.ThrowIfCancellationRequested();

            int drained;
            try
            {
                drained = link.DrainBufferedInput();
            }
            catch (Exception ex)
            {
                FaultLink();
                throw new ModbusBusResynchronisationException(
                    $"Modbus bus '{Key}': the link failed while draining after a timed-out or aborted transaction " +
                    $"({ex.GetType().Name}) — the link has been torn down and will be rebuilt before the next transaction.",
                    ex);
            }

            var now = Environment.TickCount64;

            if (drained > 0)
            {
                // A late frame really was on the line. Pay for it: the window restarts.
                discarded += drained;
                lastByteAt = now;
            }
            else if (now - lastByteAt >= quietWindowMs)
            {
                Volatile.Write(ref _desynchronised, false);
                // Not Interlocked.Increment: every write here happens under the arbitration lock, so there is
                // exactly one writer. Volatile is for the cross-thread READ, which is the only concurrency
                // this counter actually has.
                Volatile.Write(ref _resynchronisationCount, _resynchronisationCount + 1);
                Volatile.Write(ref _lastResynchronisationBytesDiscarded, discarded);
                return;
            }

            if (now >= deadline)
            {
                FaultLink();
                throw new ModbusBusResynchronisationException(
                    $"Modbus bus '{Key}': the link never went quiet for {quietWindowMs} ms within {budgetMs} ms after a " +
                    $"timed-out or aborted transaction ({discarded} byte(s) discarded and still arriving). A bus that " +
                    "will not go quiet cannot be written to safely — an RTU response carries nothing to correlate it " +
                    "with a request, so the next answer could be any of them. The link has been torn down.");
            }

            await Task.Delay(_settings.PollSliceMs, ct).ConfigureAwait(false);
        }
    }

    /// <summary>Called by <see cref="ModbusBusTransaction.DisposeAsync"/>, and only from there — this is where
    /// the arbitration lock is released and where the quarantine decision is made.</summary>
    /// <param name="consumedAValidatedResponse"><see langword="false"/> when the transaction did not finish an
    /// operation cleanly, for ANY reason. The default direction is deliberately the pessimistic one: a
    /// transaction that throws somewhere nobody anticipated quarantines the bus rather than leaving it looking
    /// clean.</param>
    internal void EndTransaction(bool consumedAValidatedResponse)
    {
        if (!consumedAValidatedResponse)
        {
            Volatile.Write(ref _desynchronised, true);
        }

        try
        {
            _arbitration.Release();
        }
        catch (ObjectDisposedException)
        {
            // The bus was disposed while this transaction was in flight — DisposeAsync deliberately does not
            // wait for it (see that method). There is no lock left to release and nothing to repair.
        }
    }

    /// <summary>Tears the link down so the next transaction rebuilds it, and marks the bus desynchronised —
    /// a link that is being replaced was, by definition, in a state nobody could vouch for.</summary>
    private void FaultLink()
    {
        Volatile.Write(ref _desynchronised, true);
        TearDownLink();
    }

    /// <summary>Best-effort, idempotent teardown. Disposing the master disposes the transport and, through it,
    /// the link (probed against NModbus 3.0.83) — the link is disposed explicitly as well because "the master
    /// does it for me" is a property of a third-party package's current implementation, not a contract, and
    /// <see cref="IDisposable.Dispose"/> is required to be idempotent anyway.</summary>
    private void TearDownLink()
    {
        try { _master?.Dispose(); } catch { /* best-effort — a master whose link already faulted must not block teardown */ }
        try { _link?.Dispose(); } catch { /* best-effort — same reasoning */ }

        _master = null;
        _transport = null;
        _link = null;
    }

    /// <summary>
    /// <b>Deliberately does NOT acquire the arbitration lock</b>, for the same reason
    /// <see cref="ModbusTcpDriver.DisposeAsync"/> does not acquire its <c>_ioLock</c>: a driver's disposal can
    /// run while <c>FleetHost</c> holds its own gate, and waiting here — even boundedly — recreates the hazard
    /// that design closes. The link is torn down out from under whichever transaction currently owns it; that
    /// transaction's read fails with an <see cref="ObjectDisposedException"/>/<see cref="System.IO.IOException"/>,
    /// which <see cref="ModbusRtuDriver"/>'s poll catch already treats as an ordinary degrade, and its scope's
    /// own disposal marks the (now dead) bus desynchronised harmlessly.
    ///
    /// <para>The arbitration semaphore itself is NOT disposed. A <see cref="SemaphoreSlim"/> with no
    /// <c>AvailableWaitHandle</c> ever taken holds nothing that needs releasing, and disposing it would turn
    /// an in-flight transaction's ordinary <c>Release</c> into a thrown
    /// <see cref="ObjectDisposedException"/> — handled in <see cref="EndTransaction"/>, but relying on a
    /// handled throw for a routine path is how a real failure gets swallowed later.</para>
    /// </summary>
    public ValueTask DisposeAsync()
    {
        if (_disposed) return ValueTask.CompletedTask;
        _disposed = true;
        TearDownLink();
        return ValueTask.CompletedTask;
    }
}
