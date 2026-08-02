using System.Net.Sockets;

namespace St4i.EdgeCore.Drivers.Modbus;

/// <summary>
/// Task D-2 — <b>RTU over a serial→Ethernet gateway.</b> Carries raw RTU frames (slave address + PDU + CRC,
/// no MBAP header) over a TCP connection to a device server that puts them on an RS-485 line. This is how a
/// large share of real RS-485 installations are already wired, and it needs <b>no new NuGet</b>:
/// <c>System.IO.Ports</c> is scoped to D-3, and nothing in this file or in <see cref="ModbusBus"/> references
/// it, so a gateway deployment never drags in a serial dependency.
///
/// <para><b>🔴 Why this exists instead of NModbus's own <c>TcpClientAdapter</c>, which the brief invited me to
/// reuse.</b> I probed it rather than read it, and it is not adequate — one specific, decisive defect:</para>
///
/// <para><b><c>TcpClientAdapter.DiscardInBuffer()</c> is a no-op.</b> Measured against a real loopback
/// socket: 8 stale bytes pushed at the client, <c>client.Available</c> was 8 before the call and <b>8
/// after</b>, and the next <c>Read(1)</c> returned the first stale byte rather than the fresh one written
/// afterwards. That method is not decorative — <c>ModbusSerialTransport</c> calls it once before writing
/// every request attempt, and on RTU it is the ONLY built-in defence against a stale frame, because an RTU
/// response carries no transaction id to correlate with. Building the gateway transport on NModbus's adapter
/// would have shipped an RTU stack whose one recovery step silently does nothing, and the symptom would not
/// be an exception — it would be a plausible wrong number (probed: a request for register 99 answered with
/// register 0's stale value, no exception).</para>
///
/// <para>Two further capabilities this type adds, both required by <see cref="IModbusBusLink"/> and neither
/// expressible through <c>IStreamResource</c> alone: <see cref="DrainBufferedInput"/> reports HOW MANY bytes
/// it discarded, which is what lets <see cref="ModbusBus"/> tell "the line is quiet" from "I just caught a
/// late frame"; and <see cref="AbortPendingRead"/> unblocks an in-flight read <b>without closing the
/// socket</b>, which is the whole reason this task exists (blueprint §2.1).</para>
///
/// <para><b>The read loop.</b> <c>IStreamResource.Read</c> is synchronous and takes no
/// <see cref="CancellationToken"/> — that is fixed by NModbus's contract and cannot be changed from here. So
/// the read waits in <see cref="AbortSliceMicroseconds"/>-long slices on <see cref="Socket.Poll(int, SelectMode)"/>,
/// checking the abort flag between slices. <c>Poll</c> blocks efficiently in the kernel for the slice (this is
/// not a spin), so the cost is one extra syscall per slice and the benefit is that cancellation is honoured
/// within about one slice while the socket survives. A 20 ms slice is short enough that cancellation is
/// prompt by any standard the callers care about — <c>FleetHost</c>'s teardown budget is seconds — and long
/// enough that a slow poll cadence does not turn into a syscall storm.</para>
///
/// <para><b><c>NoDelay</c> is set.</b> RTU request frames are 8 bytes. Nagle's algorithm would hold one back
/// waiting for more data to coalesce with, adding up to the peer's delayed-ACK interval to every single
/// transaction — on a protocol whose entire recovery story is built around bounded response times, that is
/// not an optimisation detail.</para>
/// </summary>
public sealed class GatewayTcpBusLink : IModbusBusLink
{
    /// <summary>How long a read waits in the kernel before coming up for air to check the abort flag. Bounds
    /// in-flight cancellation latency; see this class's doc comment for why 20 ms.</summary>
    private const int AbortSliceMicroseconds = 20_000;

    private const int DrainScratchSize = 512;

    private readonly TcpClient _client;
    private volatile bool _abortRequested;
    private int _disposed;

    private GatewayTcpBusLink(TcpClient client) => _client = client;

    /// <summary>
    /// The one supported way to build a bus key for this transport — see
    /// <see cref="ModbusBusRegistry.Acquire"/> for why keys are built by a method on the link type rather than
    /// interpolated at the call site. Every parameter that determines which physical bus this is appears in
    /// the key; for TCP that is exactly the endpoint, since a gateway's serial-side settings are the gateway's
    /// own configuration and are not visible from here. <b>Consequence D-4 must know:</b> two connectors
    /// naming the same host:port ARE two devices on one bus and will share one link and one arbitration lock,
    /// which is the intended multidrop shape; two connectors naming the same physical RS-485 line through
    /// DIFFERENT gateway endpoints are, from this process's point of view, two independent buses, and nothing
    /// here can serialise them against each other.
    /// </summary>
    public static string CreateBusKey(string host, int port) => $"modbus-rtu-tcp:{host}:{port}";

    /// <summary>Connects to the gateway. The connect itself is cancellable (<c>TcpClient.ConnectAsync</c>
    /// takes a token), which is why <see cref="ModbusBus"/> can honour a cancellation that lands before the
    /// link even exists.</summary>
    public static async Task<IModbusBusLink> ConnectAsync(string host, int port, CancellationToken ct)
    {
        var client = new TcpClient();
        try
        {
            await client.ConnectAsync(host, port, ct).ConfigureAwait(false);
            client.NoDelay = true;
        }
        catch
        {
            client.Dispose();
            throw;
        }

        return new GatewayTcpBusLink(client);
    }

    /// <summary>
    /// Wraps a <see cref="TcpClient"/> the caller has ALREADY connected, taking ownership of it — the
    /// returned link's <see cref="Dispose"/> closes it. <see cref="ConnectAsync"/> is the production path and
    /// is what <see cref="Opener"/> uses; this exists because two callers legitimately hold a connected socket
    /// they did not dial themselves: the tests (which stand a gateway peer up on the SERVER end of a loopback
    /// pair, a socket that by definition cannot be reached by dialling), and any future caller wiring this
    /// link onto a connection produced by something other than a hostname and a port. It does not set
    /// <see cref="TcpClient.NoDelay"/> — a caller that already owns the socket owns its options too, and
    /// silently rewriting them here would be a surprise.
    /// </summary>
    public static IModbusBusLink Adopt(TcpClient connectedClient)
    {
        ArgumentNullException.ThrowIfNull(connectedClient);
        return new GatewayTcpBusLink(connectedClient);
    }

    /// <summary>Builds the <c>openLink</c> delegate <see cref="ModbusBusRegistry.Acquire"/> takes. A fresh
    /// <c>TcpClient</c> per call, deliberately: a faulted socket is never reused, exactly as
    /// <see cref="ModbusTcpDriver.EnsureConnectedAsync"/> already does for the TCP driver.</summary>
    public static Func<CancellationToken, Task<IModbusBusLink>> Opener(string host, int port)
        => ct => ConnectAsync(host, port, ct);

    public int InfiniteTimeout => -1;

    /// <summary>Set by NModbus's transport before each transaction; probing confirmed the transport propagates
    /// it here rather than keeping it to itself.
    ///
    /// <para><b>A non-positive value means NO deadline</b> — see <see cref="Read"/>. This used to say
    /// "<see cref="ModbusBus"/> always gives the transport a bounded value" as though that settled it, which
    /// was an assertion about a caller rather than anything this type enforces. It is now actually true:
    /// <see cref="ModbusBus.BeginTransactionAsync"/> rejects a non-positive <c>readTimeoutMs</c> with
    /// <see cref="ArgumentOutOfRangeException"/> before it takes the arbitration lock. <b>And when it is
    /// unbounded anyway</b> — a caller wiring this link up outside <see cref="ModbusBus"/>, which nothing
    /// prevents — the read blocks until the peer answers or the link is disposed, remaining abortable via
    /// <see cref="AbortPendingRead"/>; it does not spin.</para></summary>
    public int ReadTimeout { get; set; } = -1;

    public int WriteTimeout { get; set; } = -1;

    public bool IsOpen => Volatile.Read(ref _disposed) == 0 && _client.Connected;

    /// <inheritdoc/>
    public void AbortPendingRead() => _abortRequested = true;

    /// <inheritdoc/>
    public void ResetAbort() => _abortRequested = false;

    /// <summary>NModbus's own purge hook. Delegates to <see cref="DrainBufferedInput"/> and throws its count
    /// away — the count is only for <see cref="ModbusBus"/>. This is the method NModbus's own
    /// <c>TcpClientAdapter</c> leaves empty; see this class's doc comment.</summary>
    public void DiscardInBuffer() => DrainBufferedInput();

    /// <inheritdoc/>
    public int DrainBufferedInput()
    {
        if (Volatile.Read(ref _disposed) != 0) return 0;

        var total = 0;
        NetworkStream stream;
        try
        {
            stream = _client.GetStream();
        }
        catch (ObjectDisposedException)
        {
            // The link was torn down concurrently (bus disposal does not wait for an in-flight transaction —
            // see ModbusBus.DisposeAsync). There is nothing buffered on a socket that no longer exists.
            return 0;
        }
        catch (InvalidOperationException)
        {
            // Not connected. Same reasoning.
            return 0;
        }

        var scratch = new byte[DrainScratchSize];
        while (stream.DataAvailable)
        {
            // Deliberately NOT swallowing IOException/SocketException here: a link that fails while being
            // drained is genuinely faulted, and ModbusBus.ResynchroniseAsync's own catch tears it down and
            // says so. Swallowing it would leave a dead socket looking like a quiet bus — which is the exact
            // shape of wrong answer this whole file exists to prevent.
            var read = stream.Read(scratch, 0, scratch.Length);
            if (read <= 0) break;
            total += read;
        }

        return total;
    }

    /// <inheritdoc/>
    public int Read(byte[] buffer, int offset, int count)
    {
        ArgumentNullException.ThrowIfNull(buffer);
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);

        var socket = _client.Client;
        var stream = _client.GetStream();
        var deadline = ReadTimeout > 0 ? Environment.TickCount64 + ReadTimeout : (long?)null;

        while (true)
        {
            if (_abortRequested)
            {
                throw new OperationCanceledException(
                    "The Modbus RTU read was aborted by its caller's cancellation. The link itself is still open — " +
                    "on a shared bus, cancelling one device's read must not tear the line down for the others.");
            }

            // Blocks in the kernel for at most one slice. Returns true when the socket is readable OR has been
            // closed by the peer; Read below distinguishes the two (0 bytes == closed).
            if (socket.Poll(AbortSliceMicroseconds, SelectMode.SelectRead))
            {
                var read = stream.Read(buffer, offset, count);
                if (read <= 0)
                {
                    throw new IOException("The Modbus gateway closed the connection.");
                }

                return read;
            }

            if (deadline is { } d && Environment.TickCount64 >= d)
            {
                // TimeoutException, not IOException: NModbus's transport treats it as the retry-eligible
                // "no answer" signal (probed — with Retries=1 a starved read produced two full request
                // writes). Every one of those attempts is bounded by this same deadline, restarted per
                // attempt, which is the behaviour ModbusRegisterMap.ReadTimeoutMs already documents.
                throw new TimeoutException(
                    $"No Modbus RTU response within {ReadTimeout} ms.");
            }
        }
    }

    /// <inheritdoc/>
    public void Write(byte[] buffer, int offset, int count)
    {
        ArgumentNullException.ThrowIfNull(buffer);
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);

        var stream = _client.GetStream();
        stream.WriteTimeout = WriteTimeout > 0 ? WriteTimeout : Timeout.Infinite;
        stream.Write(buffer, offset, count);
        stream.Flush();
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        try { _client.Dispose(); } catch { /* best-effort — a faulted socket must not block teardown */ }
    }
}
