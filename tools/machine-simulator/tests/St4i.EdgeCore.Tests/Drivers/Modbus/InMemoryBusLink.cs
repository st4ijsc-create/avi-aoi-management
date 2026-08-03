using St4i.EdgeCore.Drivers.Modbus;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// Task D-2 — <b>a paired, in-memory <see cref="IModbusBusLink"/>: the RTU equivalent of
/// <c>ModbusLoopbackHarness</c>'s <see cref="System.Net.Sockets.TcpListener"/>.</b> There is no portable
/// virtual COM port, so this is the only way to stand a real NModbus RTU slave up in-process and drive a real
/// master at it. The D-2 brief calls for it explicitly because D-3 (native serial) and D-6 (conformance) both
/// need it.
///
/// <para><b>Why it implements <see cref="IModbusBusLink"/> and not merely <c>IStreamResource</c>.</b> The
/// capabilities this task's design turns on — abort-without-close, and a drain that reports its count — are on
/// that interface. A test double that implemented only the narrower contract would exercise a bus that could
/// not do the things production's bus does, which is how a test ends up proving something nobody ships.</para>
///
/// <para><b>What it deliberately models, beyond a plain pipe.</b> RTU's whole hazard is timing: a device that
/// answers LATE, after its master gave up. <see cref="HoldWrites"/>/<see cref="ReleaseHeldWrites"/> reproduce
/// exactly that, deterministically — the slave's answer is captured instead of delivered, and released at a
/// moment the test chooses. Nothing here sleeps hoping for a race.</para>
///
/// <para><b>What it does NOT model, stated so nobody mistakes a green run for more than it is.</b> There is no
/// half-duplex collision, no line noise, no partial frame torn by a t3.5 gap, and no baud rate — bytes
/// written are bytes delivered, whole. Those are properties of copper, and the layer under test
/// (<see cref="ModbusBus"/>) is deliberately the one that does not depend on them: it reasons about "did a
/// complete validated response arrive" and "has the line been quiet", both of which are faithful here. CRC
/// and framing are NModbus's, and they run for real on both sides of this pipe.</para>
/// </summary>
internal sealed class InMemoryBusLinkPair
{
    private InMemoryBusLinkPair(InMemoryBusLink master, InMemoryBusLink device)
    {
        Master = master;
        Device = device;
    }

    /// <summary>The end a <see cref="ModbusBus"/> drives.</summary>
    public InMemoryBusLink Master { get; }

    /// <summary>The end an NModbus RTU slave network listens on.</summary>
    public InMemoryBusLink Device { get; }

    public static InMemoryBusLinkPair Create()
    {
        var gate = new object();
        var masterInbox = new Queue<byte>();
        var deviceInbox = new Queue<byte>();

        var master = new InMemoryBusLink(gate, masterInbox, deviceInbox, "master");
        var device = new InMemoryBusLink(gate, deviceInbox, masterInbox, "device");
        master.Bind(device);
        device.Bind(master);
        return new InMemoryBusLinkPair(master, device);
    }
}

/// <summary>One end of an <see cref="InMemoryBusLinkPair"/>. See that type's doc comment.</summary>
internal sealed class InMemoryBusLink : IModbusBusLink
{
    private readonly object _gate;
    private readonly Queue<byte> _inbox;
    private readonly Queue<byte> _peerInbox;
    private readonly List<byte> _held = new();
    private readonly string _name;

    private InMemoryBusLink? _peer;
    private bool _abort;
    private bool _disposed;

    internal InMemoryBusLink(object gate, Queue<byte> inbox, Queue<byte> peerInbox, string name)
    {
        _gate = gate;
        _inbox = inbox;
        _peerInbox = peerInbox;
        _name = name;
    }

    internal void Bind(InMemoryBusLink peer) => _peer = peer;

    public int InfiniteTimeout => -1;
    public int ReadTimeout { get; set; } = -1;
    public int WriteTimeout { get; set; } = -1;

    /// <summary>When set, everything this end writes is CAPTURED instead of delivered — the device is on the
    /// bus and computing, but its answer has not reached the master yet. <see cref="ReleaseHeldWrites"/>
    /// delivers it. This is the deterministic stand-in for "a slave that answers late", the failure RTU
    /// cannot correlate its way out of.</summary>
    public bool HoldWrites { get; set; }

    /// <summary>
    /// 🔴 Task D-4 — <b>one device on a multidrop bus that never answers, without breaking the others.</b> Set
    /// on the DEVICE end: any frame this end writes whose first byte is this slave address is swallowed — the
    /// slave still received the request and still built its reply, but the reply never reaches the master, so
    /// the master times out exactly as it does against a physically absent or mis-wired device. The first byte
    /// of an RTU response IS the slave address, and NModbus writes a response as one whole frame, so matching
    /// on it is exact rather than heuristic.
    ///
    /// <para><b>Why not simply address a unit id no slave owns.</b> Measured, because the first version of
    /// D-4's tests did exactly that: after one request for an unowned address, this harness's slave network
    /// stops answering ANY unit until several further request frames have gone by — one healthy driver at a
    /// 1 s timeout with one retry still read nothing in six seconds, while the same driver on an untouched bus
    /// read in 30 ms. That is an artifact of an in-memory pipe with no t3.5 gap (this type's own doc comment
    /// says it models no framing gap), not a property of <see cref="ModbusBus"/> — and a test that measured it
    /// would be measuring the harness. Silencing a REAL slave's reply keeps both ends perfectly framed and
    /// isolates the one variable the test is about: a device that does not answer.</para>
    ///
    /// <para><see cref="HoldWrites"/> is the sibling for the other question — a device that answers LATE — and
    /// is deliberately bus-wide, because a late frame is a hazard for whoever reads next rather than for its
    /// own device.</para>
    /// </summary>
    public byte? SilentUnitId { get; set; }

    /// <summary>Total bytes this end has written, delivered or held. Lets a test assert the device really did
    /// answer rather than infer it from the master's silence.</summary>
    public int BytesWritten { get; private set; }

    /// <summary>
    /// 🔴 Task D-5 — <b>every frame this end wrote, in order, as its own byte array: the bus boundary, recorded.</b>
    ///
    /// <para><see cref="BytesWritten"/> answers "how much" and D-2's no-retry test used it because one FC03
    /// request is exactly 8 bytes. A WRITE needs more than a count. "Exactly one request reached the wire"
    /// and "the request that reached the wire named unit 2, function code 6, address 5 and value 123, and no
    /// frame naming any other unit ever went out" are different claims, and the second is the one a multidrop
    /// write has to make. Recording the frames lets a test assert the second WITHOUT supplying any of it — which
    /// is the difference between a test that checks the plumbing and a test that checks who chose the values,
    /// the distinction D-2's own surviving retry mutation was about.</para>
    ///
    /// <para><b>One <see cref="Write"/> call per request frame is MEASURED, not assumed.</b> Probed against
    /// NModbus 3.0.83 with a recording <c>IStreamResource</c>: one FC06 write attempt produces exactly one
    /// <c>Write</c> call carrying the whole 8-byte frame, two calls at <c>Retries = 1</c>, four at
    /// <c>Retries = 3</c> — and D-2 independently measured the same for FC03 by byte count. If a future NModbus
    /// ever split a frame across two calls, the length assertions in the tests that read this would go RED
    /// rather than quietly mean something else, which is the correct direction for a measurement-based
    /// assertion to fail in.</para>
    /// </summary>
    public IReadOnlyList<byte[]> WrittenFrames
    {
        get { lock (_gate) { return _writtenFrames.ToArray(); } }
    }

    private readonly List<byte[]> _writtenFrames = new();

    /// <summary>How many frames <see cref="SilentUnitId"/> has swallowed. Observable so a test asserts the
    /// slave really did reply and the reply really was dropped, rather than inferring it from the master's
    /// timeout — which is also what a slave that never saw the request would look like.</summary>
    public int FramesSilenced { get; private set; }

    /// <summary>How many bytes this end's own abort flag is currently raised for — exposed as a bool.</summary>
    public bool AbortRequested { get { lock (_gate) { return _abort; } } }

    public bool IsOpen
    {
        get { lock (_gate) { return !_disposed && _peer is { _disposed: false }; } }
    }

    /// <summary>Delivers everything <see cref="HoldWrites"/> captured, in order, and clears the hold. The
    /// bytes arrive at the peer exactly as if the device had answered at this instant.</summary>
    public void ReleaseHeldWrites()
    {
        lock (_gate)
        {
            HoldWrites = false;
            foreach (var b in _held) _peerInbox.Enqueue(b);
            _held.Clear();
            Monitor.PulseAll(_gate);
        }
    }

    /// <summary>Bytes currently sitting unread in this end's inbox. A test asserts against this to show a
    /// stale frame really was on the line before the resynchronisation ran — otherwise "the next read was
    /// correct" could just mean nothing was ever stale.</summary>
    public int BufferedInputCount { get { lock (_gate) { return _inbox.Count; } } }

    public void DiscardInBuffer() => DrainBufferedInput();

    public int DrainBufferedInput()
    {
        lock (_gate)
        {
            var n = _inbox.Count;
            _inbox.Clear();
            return n;
        }
    }

    public void AbortPendingRead()
    {
        lock (_gate)
        {
            _abort = true;
            Monitor.PulseAll(_gate);
        }
    }

    public void ResetAbort()
    {
        lock (_gate)
        {
            _abort = false;
        }
    }

    public int Read(byte[] buffer, int offset, int count)
    {
        var deadline = ReadTimeout > 0 ? Environment.TickCount64 + ReadTimeout : (long?)null;

        lock (_gate)
        {
            while (true)
            {
                if (_disposed) throw new ObjectDisposedException(nameof(InMemoryBusLink), $"the {_name} end was disposed");
                if (_abort) throw new OperationCanceledException($"the {_name} end's read was aborted by its caller");

                if (_inbox.Count > 0)
                {
                    var n = Math.Min(count, _inbox.Count);
                    for (var i = 0; i < n; i++) buffer[offset + i] = _inbox.Dequeue();
                    return n;
                }

                // Genuinely blocking, never a poll: every state change this loop cares about — a peer Write,
                // an AbortPendingRead, a Dispose — pulses this monitor, so there is nothing to wake up and
                // check for. An earlier version waited in 5 ms slices and spun at 200 Hz per link for the
                // whole lifetime of every RTU test, which cost CPU the rest of the suite's timing-sensitive
                // tests needed. See BlockingWork for the sibling half of that diagnosis.
                if (deadline is { } d)
                {
                    var remaining = d - Environment.TickCount64;
                    if (remaining <= 0) throw new TimeoutException($"no data on the {_name} end within {ReadTimeout} ms");
                    Monitor.Wait(_gate, (int)Math.Min(int.MaxValue, remaining));
                }
                else
                {
                    Monitor.Wait(_gate);
                }
            }
        }
    }

    public void Write(byte[] buffer, int offset, int count)
    {
        lock (_gate)
        {
            if (_disposed) throw new ObjectDisposedException(nameof(InMemoryBusLink), $"the {_name} end was disposed");
            BytesWritten += count;

            // Recorded BEFORE the SilentUnitId/HoldWrites branches below, deliberately: this is what THIS END
            // put on the wire, and a frame the peer never receives still left this end. A test asking "did a
            // retry happen" must see the retried frame even when the far end swallows every one of them.
            var frame = new byte[count];
            Array.Copy(buffer, offset, frame, 0, count);
            _writtenFrames.Add(frame);

            // See SilentUnitId. Checked before HoldWrites because a silenced frame is never delivered at all,
            // whereas a held one is delivered later — the two model different failures and must not compose.
            if (SilentUnitId is { } silent && count > 0 && buffer[offset] == silent)
            {
                FramesSilenced++;
                return;
            }

            if (HoldWrites)
            {
                for (var i = 0; i < count; i++) _held.Add(buffer[offset + i]);
                return;
            }

            for (var i = 0; i < count; i++) _peerInbox.Enqueue(buffer[offset + i]);
            Monitor.PulseAll(_gate);
        }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            _disposed = true;
            Monitor.PulseAll(_gate);
        }
    }
}
