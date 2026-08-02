using System.IO.Ports;

namespace St4i.EdgeCore.Drivers.Modbus;

/// <summary>
/// Task D-3 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-3-brief.md) — <b>Modbus RTU over a
/// real COM port.</b> The second <see cref="IModbusBusLink"/> implementation, sitting on exactly the seam D-2
/// built and consumed the same way by <see cref="ModbusBus"/>: nothing in the bus, the arbitration, the
/// quarantine or <see cref="ModbusRtuDriver"/> is forked, overridden or special-cased for serial.
///
/// <para>NModbus ships <b>no</b> serial adapter — all three of its <c>IStreamResource</c> implementations are
/// TCP/UDP — so this class is the whole of it. It lives in its own assembly
/// (<c>St4i.EdgeCore.Serial</c>) because it is the only thing in the product that may depend on
/// <c>System.IO.Ports</c>; see that project file for the argument and
/// <c>SerialDependencyScopingTests</c> for the structural proof that a gateway deployment carries no
/// serial dependency.</para>
///
/// <para><b>🔴 What a serial port does that a socket does not, and what was decided for each.</b></para>
///
/// <list type="number">
/// <item><description><b>The open is EXCLUSIVE.</b> Measured on this machine: <c>COM1</c> opens once, and a
/// second <see cref="SerialPort"/> on the same name throws
/// <c>UnauthorizedAccessException: Access to the path 'COM1' is denied</c>. That is the fact D-1's review
/// used to argue the shared, reference-counted seam is mandatory rather than tidy, and it is now measured
/// rather than cited. Nothing here relaxes it: N drivers on one RS-485 segment take N leases on ONE
/// <see cref="ModbusBus"/> (see <see cref="ModbusBusRegistry"/>), which opens ONE port. Two connectors that
/// disagree about the line parameters get two keys and therefore two ports — see
/// <see cref="CreateBusKey"/>.</description></item>
///
/// <item><description><b>Line parameters exist at all.</b> They live on <see cref="SerialLineSettings"/> —
/// per-bus, not per-device — and every one of them is in the bus key. See that type for the defaults and why
/// they are the Modbus specification's rather than <see cref="SerialPort"/>'s.</description></item>
///
/// <item><description><b>🔴 RS-485 needs the transceiver turned around between transmit and receive, and this
/// product supports ONLY adapters that do it in hardware.</b> Stated plainly because a silent failure on a
/// manual-DE adapter is worse than a documented limit. Two-wire RS-485 is half duplex: something must assert
/// the driver-enable line for exactly as long as the frame is going out and release it before the slave
/// answers. Most modern USB and PCIe RS-485 adapters do this automatically from the TX data itself (auto-DE /
/// TXDEN), and for those there is nothing to do — which is why this class does nothing. The alternative,
/// toggling RTS around each <see cref="Write"/>, <b>cannot be implemented correctly on
/// <see cref="SerialPort"/></b>, and that is an API fact rather than an omission: releasing DE too early
/// truncates the last character and too late collides with the slave's reply, so it must happen at the moment
/// the final stop bit leaves the UART's shift register — and the BCL exposes no such signal. Enumerated on
/// this runtime: <see cref="SerialPort"/> has events <c>ErrorReceived</c>, <c>DataReceived</c>,
/// <c>PinChanged</c> and <c>Disposed</c> — <b>no transmit-complete</b>; <see cref="SerialPort.BytesToWrite"/>
/// reaching 0 means the DRIVER's queue is empty, not that the wire is (measured: an 8-byte write returned in
/// 2.45 ms with <c>BytesToWrite</c> already 0, well before ~4.6 ms of wire time at 19200 baud had elapsed);
/// and <see cref="Handshake"/> offers only
/// <see cref="Handshake.None"/>/<see cref="Handshake.XOnXOff"/>/<see cref="Handshake.RequestToSend"/>/
/// <see cref="Handshake.RequestToSendXOnXOff"/> — i.e. RTS as FLOW CONTROL, never Win32's
/// <c>RTS_CONTROL_TOGGLE</c>, which is the DCB setting that would make the driver do this correctly.
/// Reaching <c>RTS_CONTROL_TOGGLE</c> would require P/Invoking <c>GetCommState</c>/<c>SetCommState</c> on a
/// handle <see cref="SerialPort"/> does not expose.
///
/// <para>🔴 <b>Review correction (I-4) — an earlier version of this paragraph said <see cref="SerialPort"/>
/// "has no <c>Flush</c>/<c>Drain</c>/<c>Wait</c>-shaped method at all". That was FALSE and it was the load-bearing
/// premise of a limitation shipped to operators.</b> <see cref="SerialPort.BaseStream"/> is public, and the
/// <c>SerialStream</c> behind it has a <c>Flush()</c> (32 IL bytes) that P/Invokes
/// <c>Kernel32.FlushFileBuffers</c>. The conclusion is unchanged — <c>FlushFileBuffers</c> pushes the
/// DRIVER's buffered bytes at the device and returns; it says nothing about the UART's shift register, so it
/// is still not a transmit-complete signal and DE would still be released mid-character — but the reason
/// must be "the flush that exists is the wrong one", not "no flush exists", because the first person to check
/// falsifies the second. Recorded rather than quietly reworded: a limitation is only as good as its
/// premise.</para>
///
/// <para>So: <b>this transport requires an adapter with automatic direction control.</b> What it does instead
/// of pretending is leave the line in the safe state — see <see cref="CreatePort"/>.</para></description></item>
///
/// <item><description><b>🔴 A blocking read cannot be interrupted without destroying the port — so this class
/// never issues one.</b> This is the task's central empirical question and the measurement is the whole
/// answer. With <c>ReadTimeout = InfiniteTimeout</c>, <c>SerialPort.Read</c> blocks and <b>nothing</b> short
/// of disposing the port releases it: measured, <c>Dispose()</c> from another thread unblocked it after
/// 16.63 ms with an <see cref="OperationCanceledException"/>. Dispose is precisely Đợt B's
/// <c>ct.Register(DisposeConnection)</c> mechanism, which blueprint §2.1 forbids here because it tears the
/// line down for every other device on a shared bus. So <see cref="Read"/> is built the way
/// <see cref="GatewayTcpBusLink"/>'s is: it waits in <see cref="ReadSliceMs"/>-long slices <i>inside the
/// serial driver</i> and checks the abort flag between them. Measured through that exact shape on a real
/// COM port: an abort was honoured after <b>0.17 / 0.18 / 15.96 ms</b> against a 30 000 ms bound, the port
/// reported open throughout, and the same port read again afterwards. <b>D-2's cancellation design therefore
/// holds on serial — but only because this class is built never to make the call that would break
/// it</b>, which is why a mutation that replaces the slice loop with one long blocking read is one of the
/// mutations recorded for this task.</description></item>
///
/// <item><description><b>A port that vanishes.</b> USB adapters get unplugged. This class does not attempt to
/// distinguish that from any other I/O failure, and deliberately: every failing member throws, the bus faults
/// and tears the link down (<c>ModbusBus.FaultLink</c>), the NEXT transaction calls the opener again, and a
/// port that is still gone fails that open with <see cref="SerialPortUnavailableException"/>. So a reopen IS
/// attempted, on the driver's own poll cadence, forever, and the driver reports <c>Degraded</c> meanwhile —
/// the same shape <see cref="ModbusTcpDriver"/> already has for a dropped socket. The quarantine is NOT
/// cleared by the fresh port: <see cref="ModbusBus"/> already refuses to clear it on a link rebuild, and its
/// comment names this transport as the reason — re-opening a COM port purges the local UART buffer and tells
/// the device on the far end nothing.</description></item>
/// </list>
///
/// <para><b>What has NOT been exercised, stated rather than implied.</b> There is no portable virtual COM port
/// and this machine has no loopback adapter (measured: <c>COM1</c> exists and opens, and eight bytes written
/// to it produce zero bytes back). <b>No Modbus frame has ever traversed this transport.</b> Everything above
/// that says "measured" was measured against a real COM port by a standalone probe; the read/write/drain path
/// carrying an actual RTU frame is untested, and task-3-report.md §"what is untested" says so in full.</para>
/// </summary>
public sealed class SerialPortBusLink : IModbusBusLink
{
    /// <summary>
    /// How long a read waits inside the serial driver before coming up for air to check the abort flag —
    /// the direct analogue of <see cref="GatewayTcpBusLink"/>'s <c>AbortSliceMicroseconds</c>, and it bounds
    /// in-flight cancellation latency the same way.
    ///
    /// <para><b>20 ms — measured, and then CHOSEN. 🔴 Review M-9: the measurement does not force this number
    /// and an earlier version of this comment presented it as though it did.</b> Windows quantises serial read
    /// timeouts to the scheduler tick, so a configured slice costs more wall clock than it asks for. Measured
    /// on a real port (and reproduced by the reviewer to within noise):</para>
    ///
    /// <list type="table">
    /// <item><description>configured  5 ms → actual ~15 ms</description></item>
    /// <item><description>configured 10 ms → actual ~15 ms</description></item>
    /// <item><description>configured 20 ms → actual <b>~31 ms</b></description></item>
    /// <item><description>configured 50 ms → actual ~62 ms</description></item>
    /// </list>
    ///
    /// <para><b>What the measurement actually says</b> is that the tick (~15.6 ms) is the floor, so anything
    /// below it buys nothing — which points at a slice of 10–15 ms costing ~15 ms of abort granularity.
    /// <b>What ships costs ~31 ms — roughly double — and buys half the wakeups on an idle read.</b> That is a
    /// trade, not a conclusion: a bus of N devices idles far more than it reads, and one syscall per 31 ms per
    /// bus is cheaper than one per 15 ms for a cancellation latency nobody measures at that resolution
    /// (<c>FleetHost</c>'s teardown budget is seconds). It also lands on the same order as the 30.78 ms D-2
    /// measured for the gateway link's abort, which keeps the two links on this seam comparable — §8.6's
    /// concern. <b>If a future task wants sharper cancellation, 10 is the measured floor and this constant is
    /// the one place to change.</b></para>
    ///
    /// <para>This is NOT the response latency. The slice is how long an IDLE read blocks before rechecking;
    /// a byte that arrives returns from <see cref="SerialPort.Read"/> immediately, so nothing here is added to
    /// a healthy transaction.</para>
    /// </summary>
    internal const int ReadSliceMs = 20;

    private const int DrainScratchSize = 512;

    private readonly ISerialPortHandle _port;
    private readonly SerialLineSettings _settings;
    private volatile bool _abortRequested;
    private int _disposed;

    /// <summary>
    /// 🔴 <b>Review fix (I-2) — the slice pin lives HERE, in the constructor, and not in
    /// <see cref="CreatePort"/>, because it is an invariant of the type rather than of one factory.</b>
    ///
    /// <para>It was in <see cref="CreatePort"/>, which <see cref="OpenAsync"/> uses — so
    /// <see cref="Adopt"/> produced a link whose port kept <see cref="SerialPort"/>'s own default
    /// <c>ReadTimeout</c> of <b>-1, i.e. <see cref="SerialPort.InfiniteTimeout"/></b> (measured). That is
    /// precisely the unbounded blocking read this whole class exists to avoid: the one measured as releasable
    /// by nothing but <c>Dispose()</c>, i.e. Đợt B's mechanism on a shared bus. There was no production
    /// consequence — <see cref="Adopt"/> is internal and nothing in <c>src/</c> calls it — but the mutation
    /// evidence had a hole the same shape as the code: <b>all three mutations defending the pin targeted
    /// <see cref="CreatePort"/></b>, so none of them could see the path that skipped it. Pinning it on every
    /// construction closes the code and the evidence together.</para>
    /// </summary>
    private SerialPortBusLink(ISerialPortHandle port, SerialLineSettings settings)
    {
        _port = port;
        _settings = settings;
        _port.ReadTimeout = ReadSliceMs;
    }

    /// <summary>
    /// The one supported way to build a bus key for this transport. Two callers passing the same key share one
    /// link and the second one's opener is never invoked (see <see cref="ModbusBusRegistry.Acquire"/>), so the
    /// key must uniquely determine the link's physical parameters — D-2's task-2-report.md §6.1 states that
    /// obligation and states this discharge of it by name: <b>"D-3's serial key must include baud rate,
    /// parity, data bits and stop bits, not merely the port name, because two connectors that disagree about
    /// baud rate are not two views of one bus."</b> Every field of <see cref="SerialLineSettings"/> is
    /// therefore in the key.
    ///
    /// <para>The consequences, both of which are intended: two connectors naming <c>COM3</c> with identical
    /// framing ARE two devices on one RS-485 segment and share one port and one arbitration lock — which is
    /// the multidrop shape D-4 builds on, and the only shape that can work at all given the port opens
    /// exclusively. Two connectors naming <c>COM3</c> with DIFFERENT framing get two keys, two buses and two
    /// attempts to open one port, the second of which fails loudly with
    /// <see cref="SerialPortUnavailableException"/> — a refusal, not a silent adoption of whichever
    /// configuration happened to construct the bus first.</para>
    /// </summary>
    public static string CreateBusKey(SerialLineSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        return $"modbus-rtu-serial:{settings.PortName}:{settings.BaudRate}:{settings.DataBits}:" +
               $"{settings.ParityLetter}:{settings.StopBitsLabel}";
    }

    /// <summary>
    /// Builds the port object with every line parameter applied — <b>and does not open it</b>. Separated from
    /// <see cref="OpenAsync"/> for one reason: opening needs hardware and configuring does not, so this is the
    /// only part of the transport a test can drive on a machine with no RS-485 adapter. Every value it sets is
    /// asserted there.
    ///
    /// <para><b><see cref="SerialPort.Handshake"/> is forced to <see cref="Handshake.None"/>, explicitly.</b>
    /// It is already the BCL's default, and it is set anyway for the same reason
    /// <see cref="ModbusBus.BeginTransactionAsync"/> sets <c>Retries</c> and <c>ReadTimeout</c> on every
    /// transaction instead of inheriting them: a value that matters is stated, never assumed. Here it matters
    /// more than usual — <see cref="Handshake.RequestToSend"/> makes the driver assert and deassert RTS as
    /// FLOW CONTROL, on its own schedule, and on a manual-DE RS-485 adapter RTS is the transmit-enable line.
    /// That would turn a flow-control convention into random half-duplex direction changes.</para>
    ///
    /// <para><b><see cref="SerialPort.RtsEnable"/> and <see cref="SerialPort.DtrEnable"/> are left deasserted</b>
    /// (their default; measured as <see langword="false"/> on a freshly opened port). On an adapter with
    /// automatic direction control they are ignored. On a manual-DE adapter — which this transport does not
    /// support, see this class's doc comment — deasserted RTS holds the transceiver in RECEIVE, which is the
    /// safe failure: such an installation will not transmit at all and will degrade honestly, rather than
    /// latching a driver onto a shared bus and jamming every other device on the segment.</para>
    ///
    /// <para>🔴 <b>It does NOT pin <see cref="SerialPort.ReadTimeout"/> — that moved to the constructor in the
    /// review fix round (I-2).</b> The slice pin is what makes every read interruptible, so it must hold for
    /// every link however it was built, not only for the ones this factory produced. See the constructor.</para>
    /// </summary>
    internal static SerialPort CreatePort(SerialLineSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);

        return new SerialPort(settings.PortName)
        {
            BaudRate = settings.BaudRate,
            Parity = settings.Parity,
            DataBits = settings.DataBits,
            StopBits = settings.StopBits,
            Handshake = Handshake.None,
        };
    }

    /// <summary>
    /// Opens the port. <b>Not cancellable while it runs, unlike <see cref="GatewayTcpBusLink.ConnectAsync"/>,
    /// and that is a BCL limit rather than a choice:</b> <see cref="SerialPort.Open"/> takes no
    /// <see cref="CancellationToken"/> and there is no asynchronous form of it. The token is honoured before
    /// the call. That is defensible because the call is local and short — measured, five open+close cycles on
    /// a real port took 83.72 ms in total, i.e. ~17 ms each — whereas <c>TcpClient.ConnectAsync</c>'s
    /// cancellability matters because a TCP connect can hang for a SYN timeout.
    /// </summary>
    /// <exception cref="SerialPortUnavailableException">The port is absent, already held by another process,
    /// or not a serial port at all.</exception>
    public static Task<IModbusBusLink> OpenAsync(SerialLineSettings settings, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(settings);
        ct.ThrowIfCancellationRequested();

        var port = CreatePort(settings);
        try
        {
            port.Open();
        }
        catch (Exception ex) when (ex is FileNotFoundException or UnauthorizedAccessException
                                      or ArgumentException or IOException)
        {
            port.Dispose();
            throw new SerialPortUnavailableException(
                $"Could not open the Modbus RTU serial line {settings.Describe()}: {ex.Message} " +
                "The port may not be present (an unplugged USB RS-485 adapter), may be held by another " +
                "application, or the name may not be a serial port on this machine.",
                ex);
        }
        catch
        {
            port.Dispose();
            throw;
        }

        return Task.FromResult<IModbusBusLink>(new SerialPortBusLink(new SystemSerialPortHandle(port), settings));
    }

    /// <summary>
    /// Wraps a <see cref="SerialPort"/> the caller already owns, taking ownership of it — the returned link's
    /// <see cref="Dispose"/> closes it. <b>Internal, and narrower than
    /// <see cref="GatewayTcpBusLink.Adopt"/>, which is public because two production callers legitimately hold
    /// a connected socket they did not dial.</b> There is no equivalent production caller for a COM port:
    /// <see cref="OpenAsync"/> is the only way this transport is built in the product.
    ///
    /// <para>It exists because of a measurement. Four mutations to this class's port-touching members survived
    /// every test, because a <see cref="SerialPort"/> cannot be constructed without a real port and this
    /// machine has no loopback. Adopting an <b>unopened</b> port makes the pre-I/O half of those members
    /// reachable — the abort check runs before any port call, and the write timeout reaches the port object
    /// before the write fails — which killed two of the four. <see cref="AdoptHandle"/> is what killed the
    /// rest; see <see cref="ISerialPortHandle"/> for why a partial instrument was not enough.</para>
    ///
    /// <para>This is deliberately not a configuration surface: it is one internal factory behind
    /// <c>InternalsVisibleTo("St4i.EdgeCore.Tests")</c>, and nothing in <c>src/</c> calls it.</para>
    /// </summary>
    internal static SerialPortBusLink Adopt(SerialPort port, SerialLineSettings settings)
    {
        ArgumentNullException.ThrowIfNull(port);
        ArgumentNullException.ThrowIfNull(settings);
        return new SerialPortBusLink(new SystemSerialPortHandle(port), settings);
    }

    /// <summary>
    /// Task D-3 review (I-3) — builds a link over any <see cref="ISerialPortHandle"/>, so the read loop, the
    /// deadline and the drain's counting can be driven in CI. See <see cref="ISerialPortHandle"/> for the full
    /// argument, including what a test using it does and does not prove.
    /// </summary>
    internal static SerialPortBusLink AdoptHandle(ISerialPortHandle handle, SerialLineSettings settings)
    {
        ArgumentNullException.ThrowIfNull(handle);
        ArgumentNullException.ThrowIfNull(settings);
        return new SerialPortBusLink(handle, settings);
    }

    /// <summary>Builds the <c>openLink</c> delegate <see cref="ModbusBusRegistry.Acquire"/> takes. A fresh
    /// <see cref="SerialPort"/> per call, deliberately: a faulted port is never reused, exactly as
    /// <see cref="GatewayTcpBusLink.Opener"/> never reuses a faulted socket.</summary>
    public static Func<CancellationToken, Task<IModbusBusLink>> Opener(SerialLineSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        return ct => OpenAsync(settings, ct);
    }

    /// <summary>The line this link is driving. Read by nothing in the hot path; exists so a diagnostic or a
    /// future endpoint can say WHICH line, rather than only that a Modbus bus is unhappy.</summary>
    public SerialLineSettings Line => _settings;

    public int InfiniteTimeout => -1;

    /// <summary>Set by NModbus's RTU transport before each transaction (probed by D-2: the transport
    /// propagates it onto the <c>IStreamResource</c>). This is the REAL deadline for one read;
    /// <see cref="ReadSliceMs"/> is only how long one wait inside the driver lasts. A non-positive value means
    /// no deadline — <see cref="ModbusBus.BeginTransactionAsync"/> rejects that before it takes the
    /// arbitration lock, and when it happens anyway (a caller wiring this link up outside
    /// <see cref="ModbusBus"/>, which nothing prevents) the read waits for the device indefinitely while
    /// staying abortable via <see cref="AbortPendingRead"/>.
    ///
    /// <para>🔴 <b>Review correction (I-1): this used to end "It never spins: every iteration blocks a full
    /// slice inside the serial driver" — and that was FALSE for a zero-length read.</b>
    /// <c>SerialPort.Read(buffer, offset, 0)</c> returns 0 without waiting (measured: 0.46 ms on the first
    /// call, and a bare loop over it ran at <b>33 million iterations per second</b>), so a zero count fell
    /// straight through the <c>read &gt; 0</c> check and span the loop — holding this bus's arbitration lock
    /// and a core, and with no deadline, forever. <see cref="GatewayTcpBusLink"/> never had this because
    /// <c>Socket.Poll</c> consumes its slice whatever the count is: a divergence between two links on one
    /// seam, which is exactly what §8.6 of the task report was written to catch and did not.
    /// <see cref="Read"/> now refuses a non-positive count up front, and a zero-byte return for a positive
    /// count — which <see cref="SerialPort"/>'s contract says cannot happen — throws instead of looping.</para>
    /// </summary>
    public int ReadTimeout { get; set; } = -1;

    public int WriteTimeout { get; set; } = -1;

    public bool IsOpen => Volatile.Read(ref _disposed) == 0 && _port.IsOpen;

    /// <inheritdoc/>
    public void AbortPendingRead() => _abortRequested = true;

    /// <inheritdoc/>
    public void ResetAbort() => _abortRequested = false;

    /// <summary>NModbus's own purge hook — called once before every request attempt, and on RTU it is the
    /// entire built-in defence against a stale frame. Delegates to <see cref="DrainBufferedInput"/> and
    /// discards the count, which only <see cref="ModbusBus"/> needs.</summary>
    public void DiscardInBuffer() => DrainBufferedInput();

    /// <summary>
    /// Drains what has already arrived and reports how many bytes went.
    ///
    /// <para><b>🔴 It drains by READING, not by calling <see cref="SerialPort.DiscardInBuffer"/>, and the
    /// reason is the count.</b> The brief asked me to verify that <see cref="SerialPort.DiscardInBuffer"/> is
    /// real rather than trust its name — the way NModbus's own adapters could not be trusted — and it is:
    /// walking the shipped IL, <c>SerialPort.DiscardInBuffer</c> (<b>47</b> bytes) calls
    /// <c>SerialStream.DiscardInBuffer</c> (27 bytes) which calls <c>Interop.Kernel32.PurgeComm</c>, whereas
    /// <c>NModbus.IO.SocketAdapter.DiscardInBuffer</c> and <c>UdpClientAdapter.DiscardInBuffer</c> are 1 IL
    /// byte each — a bare <c>ret</c>. That head-to-head is pinned as a test. (Review M-1: this said 47 was 27,
    /// which is the INNER method's length. A wrong number in the one paragraph whose whole subject is "verify
    /// rather than trust the name" is the worst place to put one.)
    ///
    /// <b>It is nonetheless the wrong primitive for this seam</b>, because it purges without counting. Reading
    /// <see cref="SerialPort.BytesToRead"/> and then purging would leave a window — at 19200 baud a character
    /// is ~570 µs wide, comfortably wider than the two calls — in which a byte arrives, is destroyed, and is
    /// never counted. Reading instead makes the count exact by construction: bytes that arrive after the last
    /// <see cref="SerialPort.BytesToRead"/> check are simply still there, and the next call counts them and
    /// restarts the window.
    ///
    /// <para><b>🔴 Review M-2 — the decision is right and free, but the harm it avoids is smaller than I first
    /// wrote, and overstating it is its own defect.</b> I claimed the purge-without-counting race would make
    /// the bus "declare the line silent while a slave was still transmitting". It would not, in general:
    /// <c>ModbusBus.ResynchroniseAsync</c> re-drains every <c>PollSliceMs</c> (5 ms by default), so a byte
    /// destroyed uncounted is almost always followed by more bytes that ARE counted, and the window restarts
    /// anyway. The real error is narrower — <c>lastByteAt</c> stale by up to one poll slice, and materially
    /// only when the destroyed byte was <b>the last of a transmission</b>, in which case the quiet window ends
    /// up to one slice early. Still worth avoiding, and it costs nothing to avoid, which is why the decision
    /// stands. But an argument sized larger than its evidence invites a reader to discount the parts that
    /// carry weight.</para>
    ///
    /// <para><b>What is deliberately NOT swallowed.</b> Only the two shapes that mean "the port went away
    /// underneath me" — <see cref="ObjectDisposedException"/> and the
    /// <see cref="InvalidOperationException"/> the BCL throws as "The port is closed." (measured). A genuine
    /// <see cref="IOException"/> from an unplugged adapter propagates, because
    /// <c>ModbusBus.ResynchroniseAsync</c>'s own catch faults the link and says so; swallowing it would leave
    /// a dead port looking like a quiet bus, which is the same defect
    /// <see cref="GatewayTcpBusLink.DrainBufferedInput"/> refuses for its socket.</para>
    /// </summary>
    public int DrainBufferedInput()
    {
        if (Volatile.Read(ref _disposed) != 0) return 0;

        var total = 0;
        var scratch = new byte[DrainScratchSize];

        while (true)
        {
            int available;
            try
            {
                available = _port.BytesToRead;
            }
            catch (ObjectDisposedException)
            {
                // Torn down concurrently — bus disposal does not wait for an in-flight transaction. Nothing
                // is buffered on a port that no longer exists.
                return total;
            }
            catch (InvalidOperationException)
            {
                // "The port is closed." — same reasoning.
                return total;
            }

            if (available <= 0) return total;

            int read;
            try
            {
                read = _port.Read(scratch, 0, Math.Min(scratch.Length, available));
            }
            catch (ObjectDisposedException)
            {
                // 🔴 Review M-10. The BytesToRead call above swallowed exactly these two and this one did not,
                // so a disposal landing BETWEEN them threw out of the drain — and
                // ModbusBus.ResynchroniseAsync turns any throw from here into
                // ModbusBusResynchronisationException + FaultLink(). Noisier teardown rather than a wrong
                // number (the link is being torn down anyway), but the half-guarded shape was the defect: the
                // method decided the teardown race mattered and then handled it in one of the two places it
                // can happen. GatewayTcpBusLink had the identical asymmetry and is fixed in the same commit —
                // a shared nit, and fixing only this one would be the §8.6 divergence again.
                return total;
            }
            catch (InvalidOperationException)
            {
                // "The port is closed." — same reasoning. An IOException from a genuinely failing adapter
                // still propagates, exactly as above.
                return total;
            }

            if (read <= 0) return total;
            total += read;
        }
    }

    /// <inheritdoc/>
    public int Read(byte[] buffer, int offset, int count)
    {
        ArgumentNullException.ThrowIfNull(buffer);
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);

        // 🔴 Review I-1. A zero-length read is answered without touching the port, exactly as Stream.Read's own
        // contract does. It is not defensive tidiness: SerialPort.Read(buffer, offset, 0) returns 0 WITHOUT
        // WAITING (measured: 0.46 ms, and a bare loop over it ran at 33 million iterations/second), so without
        // this the loop below spins at full tilt — holding this bus's arbitration lock and a core — until the
        // outer deadline, and with a non-positive ReadTimeout there is no outer deadline at all. GatewayTcpBusLink
        // is immune only because Socket.Poll consumes its slice whatever the count is.
        if (count <= 0) return 0;

        var deadline = ReadTimeout > 0 ? Environment.TickCount64 + ReadTimeout : (long?)null;

        while (true)
        {
            if (_abortRequested)
            {
                throw new OperationCanceledException(
                    $"The Modbus RTU read on {_settings.Describe()} was aborted by its caller's cancellation. " +
                    "The port itself is still open — on a shared RS-485 bus, cancelling one device's read must " +
                    "not tear the line down for the others.");
            }

            try
            {
                // Blocks inside the serial driver for at most one slice (the port's own ReadTimeout, pinned by
                // this type's constructor) and returns the instant a byte arrives. This is the ONLY read this
                // class ever issues: an unbounded SerialPort.Read cannot be interrupted by anything but
                // disposing the port, which is the mechanism blueprint §2.1 forbids on a shared bus.
                var read = _port.Read(buffer, offset, count);
                if (read > 0) return read;

                // SerialPort.Read's contract says this cannot happen for a positive count — it blocks until at
                // least one byte is available or throws. Blueprint §8.1: the sentence after "cannot happen" has
                // to say what the code does when it happens anyway. It throws, because the alternative is the
                // I-1 spin by another route: a zero-byte return costs no time, so looping on it burns a core
                // while holding the arbitration lock. Naming it is also strictly more useful than hanging.
                throw new IOException(
                    $"The serial port {_settings.Describe()} returned 0 bytes for a {count}-byte read without " +
                    "timing out, which SerialPort.Read is not documented to do. Treating it as a link fault " +
                    "rather than retrying, because a zero-cost retry loop would spin holding the bus.");
            }
            catch (TimeoutException)
            {
                // One slice with no byte. Fall through to the abort and deadline checks and wait another.
            }

            if (deadline is { } d && Environment.TickCount64 >= d)
            {
                // TimeoutException, not IOException: NModbus's transport treats it as the retry-eligible "no
                // answer" signal, and every retry is a fresh request bounded by this same deadline.
                throw new TimeoutException(
                    $"No Modbus RTU response on {_settings.Describe()} within {ReadTimeout} ms.");
            }
        }
    }

    /// <summary>
    /// Writes one RTU request.
    ///
    /// <para><b>Nothing is done here about RS-485 direction control, and that is the decision this class's own
    /// doc comment argues at length:</b> this is exactly where a manual-DE adapter would need RTS raised
    /// before the first bit and dropped after the last one has physically left the shift register, and
    /// <see cref="SerialPort"/> exposes no signal for the second half. An adapter with automatic direction
    /// control needs nothing here at all.</para>
    /// </summary>
    public void Write(byte[] buffer, int offset, int count)
    {
        ArgumentNullException.ThrowIfNull(buffer);
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);

        _port.WriteTimeout = WriteTimeout > 0 ? WriteTimeout : SerialPort.InfiniteTimeout;
        _port.Write(buffer, offset, count);
    }

    /// <summary>Closes the port. <b>Reserved for the last lease</b> (or a link the bus has faulted) — never a
    /// cancellation mechanism. Measured: disposing a port with a read blocked on it releases that read in
    /// ~16.6 ms with an <see cref="OperationCanceledException"/>, which is precisely why it is the wrong tool
    /// for cancelling one device's transaction on a shared bus and the right one for tearing the bus
    /// down.</summary>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        try { _port.Dispose(); } catch { /* best-effort — a faulted port must not block teardown */ }
    }
}
