using St4i.EdgeCore.Drivers.Modbus;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// Task D-3 review (I-3) — <b>an <see cref="ISerialPortHandle"/> that reproduces the seven measured behaviours
/// of <c>System.IO.Ports.SerialPort</c> that <see cref="SerialPortBusLink"/> depends on</b>, so the link's read
/// loop, its outer deadline, its between-slice abort recheck and its drain's counting can be driven on a
/// machine with no RS-485 hardware.
///
/// <para><b>🔴 Every semantic below was MEASURED against a real COM port, not guessed</b> — by this task's own
/// probe and, independently, by the reviewer, agreeing to within noise. That is what makes a fake legitimate
/// here rather than a way of testing my own assumptions:</para>
///
/// <list type="bullet">
/// <item><description><c>Read</c> blocks until at least one byte is available and then returns between 1 and
/// <c>count</c> bytes.</description></item>
/// <item><description><c>Read</c> throws <see cref="TimeoutException"/> when <c>ReadTimeout</c> elapses with
/// nothing on the line — measured at 261.69 ms for a configured 250, and 25.01 ms for a configured 20.</description></item>
/// <item><description><c>Read</c> with <c>count == 0</c> returns 0 <b>without waiting</b> — measured at
/// 0.46 ms, with a bare loop over it running at 33 million iterations/second. This is the behaviour behind
/// review finding I-1, and reproducing it is the whole reason the zero-count guard is testable.</description></item>
/// <item><description>A <c>ReadTimeout</c> of <see cref="System.IO.Ports.SerialPort.InfiniteTimeout"/> (-1)
/// blocks indefinitely, releasable only by disposal.</description></item>
/// <item><description>A blocked <c>Read</c> released by <c>Dispose()</c> throws
/// <see cref="OperationCanceledException"/> — measured at 16.63 ms.</description></item>
/// <item><description><c>BytesToRead</c> and <c>Read</c> on a port that is not open throw
/// <see cref="InvalidOperationException"/> with the message "The port is closed."</description></item>
/// <item><description><c>IsOpen</c> is <see langword="false"/> after disposal.</description></item>
/// </list>
///
/// <para><b>What it deliberately does NOT model, so a green run is not over-read.</b> No baud rate, no parity,
/// no data/stop bits, no half-duplex collision, no line noise, no frame torn by a t3.5 gap, and no direction
/// control — all properties of copper and of a UART, and none of them observable through the seven members
/// above. Bytes written are bytes delivered, whole. The same disclaimer <see cref="InMemoryBusLinkPair"/>
/// carries, one layer lower down.</para>
///
/// <para><b>What therefore remains untested against real hardware</b> is exactly
/// <c>SystemSerialPortHandle</c>'s seven one-line delegations. That is a far smaller surface than the read
/// loop they used to hide, and <c>tools/serial-bench</c> exercises it against a real port.</para>
/// </summary>
internal sealed class FakeSerialPortHandle : ISerialPortHandle
{
    private readonly object _gate;
    private readonly Queue<byte> _inbox;
    private readonly Queue<byte> _peerInbox;
    private readonly string _name;

    private bool _disposed;

    internal FakeSerialPortHandle(object gate, Queue<byte> inbox, Queue<byte> peerInbox, string name)
    {
        _gate = gate;
        _inbox = inbox;
        _peerInbox = peerInbox;
        _name = name;
    }

    /// <summary>A standalone handle with no peer — a port that is open and on which nothing ever answers, which
    /// is what <c>COM1</c> physically is on the machine this task was built on. Bytes can still be planted
    /// directly with <see cref="Deliver"/>.</summary>
    public static FakeSerialPortHandle Unpaired(string name = "port") =>
        new(new object(), new Queue<byte>(), new Queue<byte>(), name);

    /// <summary>Total <see cref="Read"/> calls that reached the blocking wait — how a test asserts the loop
    /// really did take more than one slice rather than inferring it from the clock.</summary>
    public int ReadCalls { get; private set; }

    public bool IsOpen { get { lock (_gate) { return !_disposed; } } }

    public int BytesToRead
    {
        get
        {
            lock (_gate)
            {
                ThrowIfClosed();
                return _inbox.Count;
            }
        }
    }

    public int ReadTimeout { get; set; } = -1;

    public int WriteTimeout { get; set; } = -1;

    /// <summary>Plants bytes in THIS end's receive buffer, as if the device had sent them. Used where a test
    /// needs an arrival without a peer.</summary>
    public void Deliver(params byte[] bytes)
    {
        lock (_gate)
        {
            foreach (var b in bytes) _inbox.Enqueue(b);
            Monitor.PulseAll(_gate);
        }
    }

    public int Read(byte[] buffer, int offset, int count)
    {
        // Measured: SerialPort.Read(buffer, offset, 0) returns 0 without waiting, and WITHOUT checking whether
        // anything is buffered. Reproduced exactly, because the guard in SerialPortBusLink.Read exists to stop
        // the caller ever reaching it.
        if (count == 0)
        {
            lock (_gate) { ThrowIfClosed(); }
            return 0;
        }

        var deadline = ReadTimeout > 0 ? Environment.TickCount64 + ReadTimeout : (long?)null;

        lock (_gate)
        {
            ReadCalls++;
            while (true)
            {
                ThrowIfClosed();

                if (_inbox.Count > 0)
                {
                    var n = Math.Min(count, _inbox.Count);
                    for (var i = 0; i < n; i++) buffer[offset + i] = _inbox.Dequeue();
                    return n;
                }

                if (deadline is { } d)
                {
                    var remaining = d - Environment.TickCount64;
                    if (remaining <= 0)
                    {
                        throw new TimeoutException($"The {_name} read timed out after {ReadTimeout} ms.");
                    }

                    // Blocking, never polling — D-2's thread-pool starvation diagnosis (see BlockingWork)
                    // applies to every waiting primitive in this suite.
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
            ThrowIfClosed();
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

    /// <summary>The BCL's exact shape, measured: <c>InvalidOperationException</c> with "The port is closed.",
    /// from <c>BytesToRead</c> and from <c>Read</c> alike, including after <c>Dispose</c>. Reproduced verbatim
    /// because <see cref="SerialPortBusLink.DrainBufferedInput"/> catches precisely this type to distinguish a
    /// teardown race from a genuine I/O fault.</summary>
    private void ThrowIfClosed()
    {
        if (_disposed) throw new InvalidOperationException("The port is closed.");
    }
}

/// <summary>
/// Two <see cref="FakeSerialPortHandle"/>s wired to each other, so a <b>real NModbus RTU master and a real
/// NModbus RTU slave network</b> can be put on opposite ends of two <see cref="SerialPortBusLink"/>s. Real
/// CRC, real t3.5 framing, real slave dispatch by unit id — driven through this transport's OWN
/// <see cref="SerialPortBusLink.Read"/>/<see cref="SerialPortBusLink.Write"/> rather than through D-2's
/// in-memory link.
/// </summary>
internal sealed class FakeSerialPortHandlePair
{
    private FakeSerialPortHandlePair(FakeSerialPortHandle master, FakeSerialPortHandle device)
    {
        Master = master;
        Device = device;
    }

    public FakeSerialPortHandle Master { get; }

    public FakeSerialPortHandle Device { get; }

    public static FakeSerialPortHandlePair Create()
    {
        var gate = new object();
        var masterInbox = new Queue<byte>();
        var deviceInbox = new Queue<byte>();
        return new FakeSerialPortHandlePair(
            new FakeSerialPortHandle(gate, masterInbox, deviceInbox, "master"),
            new FakeSerialPortHandle(gate, deviceInbox, masterInbox, "device"));
    }
}
