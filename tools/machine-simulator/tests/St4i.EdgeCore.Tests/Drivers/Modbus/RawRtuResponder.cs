using St4i.EdgeCore.Drivers.Modbus;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// 🔴 Task D-5 — RTU frame arithmetic, in one place. Extracted out of
/// <c>ModbusBusResynchronisationTests</c>'s own private <c>AppendCrc</c> so the D-2 suite and the D-5 write
/// suite compute the same CRC-16/MODBUS rather than each holding a copy. Behaviour-preserving: a wrong CRC
/// makes NModbus reject every frame built with it, so a drift here could not be subtle.
/// </summary>
internal static class RtuFrames
{
    /// <summary>Appends the CRC-16/MODBUS trailer (low byte first, per the specification) to a PDU.</summary>
    public static byte[] WithCrc(params byte[] pdu)
    {
        ushort crc = 0xFFFF;
        foreach (var b in pdu)
        {
            crc ^= b;
            for (var i = 0; i < 8; i++)
                crc = (crc & 1) != 0 ? (ushort)((crc >> 1) ^ 0xA001) : (ushort)(crc >> 1);
        }

        var framed = new byte[pdu.Length + 2];
        Array.Copy(pdu, framed, pdu.Length);
        framed[pdu.Length] = (byte)(crc & 0xFF);
        framed[pdu.Length + 1] = (byte)(crc >> 8);
        return framed;
    }

    /// <summary>The length of an RTU MASTER request frame for the four function codes this product issues —
    /// FC03/FC04 (read) and FC05/FC06 (write) all take <c>unit + fc + address(2) + value-or-count(2) + crc(2)</c>.
    /// A constant rather than a literal at each call site so a test that asserts "exactly one request frame"
    /// names the same 8 the protocol does.</summary>
    public const int RequestFrameLength = 8;

    /// <summary>Write Single Coil.</summary>
    public const byte FunctionWriteSingleCoil = 0x05;

    /// <summary>Write Single Register.</summary>
    public const byte FunctionWriteSingleRegister = 0x06;

    /// <summary>Read Holding Registers.</summary>
    public const byte FunctionReadHoldingRegisters = 0x03;

    /// <summary>The big-endian 16-bit field at <paramref name="offset"/> of an RTU frame.</summary>
    public static ushort Word(byte[] frame, int offset) => (ushort)((frame[offset] << 8) | frame[offset + 1]);
}

/// <summary>
/// 🔴 Task D-5 — <b>a device on the bus whose EXACT response bytes the test writes.</b>
///
/// <para><c>ModbusRtuLoopbackHarness</c> stands up a real NModbus slave network, which is the right tool for
/// "did the value reach the device" — it answers correctly, always. It is the wrong tool for the question this
/// task exists to answer: <b>can a frame that is not this write's acknowledgement be mistaken for one?</b> To
/// ask that, the answer has to be wrong on purpose. This is the RTU counterpart of
/// <c>ModbusTcpDriverWriteTests</c>' own hand-rolled raw responder, which exists for exactly the same reason
/// ("wherever the test needs to observe or control the EXACT bytes on the wire").</para>
///
/// <para><b>What it establishes that nothing else can.</b> Probed against NModbus 3.0.83, a Modbus write
/// response is an ECHO validated on four independent fields — slave address, function code, start address and
/// value. That is a stronger guarantee than a READ has (D-2 measured a stale read frame matching slave address,
/// function code and length being returned as the answer, silently). A claim that strong about a third-party
/// package must be pinned by a test that FAILS if the package changes, not by a sentence in a report — so the
/// three tests driven through this responder are, in effect, a contract test on NModbus's echo validation, with
/// a correct-echo control that makes the other two non-vacuous.</para>
///
/// <para>Runs its read loop on a DEDICATED thread via <see cref="BlockingWork"/>, not on the pool:
/// <see cref="InMemoryBusLink.Read"/> blocks genuinely, and D-2 measured what parking pool threads on blocking
/// RTU work does to the rest of the suite.</para>
/// </summary>
internal sealed class RawRtuResponder : IAsyncDisposable
{
    private readonly InMemoryBusLink _device;
    private readonly Func<byte[], int, byte[]?> _replyFor;
    private readonly Task _loop;
    private int _requestsSeen;

    /// <param name="device">The DEVICE end of an <see cref="InMemoryBusLinkPair"/> — the end a slave would
    /// listen on.</param>
    /// <param name="replyFor">Given the request frame and its 0-based index, the bytes to answer with;
    /// <see langword="null"/> to stay silent (which is what makes the master time out). The reply is written
    /// verbatim, so a test can hand back a frame with a deliberately wrong address, value, unit or CRC.</param>
    public RawRtuResponder(InMemoryBusLink device, Func<byte[], int, byte[]?> replyFor)
    {
        _device = device;
        _replyFor = replyFor;
        _loop = BlockingWork.Run(Pump, "raw-rtu-responder");
    }

    /// <summary>How many complete request frames this responder has read off the line. Lets a test assert the
    /// device really did RECEIVE the request before asserting anything about the answer — "the master timed
    /// out" and "the master never transmitted" look identical from the master's side.</summary>
    public int RequestsSeen => Volatile.Read(ref _requestsSeen);

    /// <summary>Every request frame this responder read, in order. A test asserts on these rather than on
    /// anything it supplied.
    ///
    /// <para>🔴 D-5 review m-3 — returns a SNAPSHOT taken under the same lock the pump writes under. It used to
    /// hand out the live <see cref="List{T}"/> that <see cref="Pump"/> mutates from its own dedicated thread,
    /// so a test enumerating it while a request landed could observe a torn count or throw. Benign in practice
    /// because every reader waits on <see cref="RequestsSeen"/> first — and that "in practice" is exactly the
    /// per-member reasoning the sibling members on <see cref="InMemoryBusLink"/> were made uniform to
    /// remove.</para></summary>
    public IReadOnlyList<byte[]> Requests
    {
        get { lock (_requests) { return _requests.ToArray(); } }
    }

    private readonly List<byte[]> _requests = new();

    private void Pump()
    {
        var frame = new byte[RtuFrames.RequestFrameLength];
        while (true)
        {
            var filled = 0;
            try
            {
                while (filled < frame.Length)
                {
                    var n = _device.Read(frame, filled, frame.Length - filled);
                    if (n <= 0) return;
                    filled += n;
                }
            }
            catch
            {
                // The pair was disposed, or the read was aborted — either way this responder is done. Swallowed
                // because it is teardown, and because a throw here would surface as an unobserved task exception
                // in whichever test happened to be running next.
                return;
            }

            var request = (byte[])frame.Clone();
            int index;
            lock (_requests)
            {
                _requests.Add(request);
                index = _requests.Count - 1;
            }

            Volatile.Write(ref _requestsSeen, index + 1);

            byte[]? reply;
            try { reply = _replyFor(request, index); }
            catch { return; }

            if (reply is null || reply.Length == 0)
            {
                continue;
            }

            try { _device.Write(reply, 0, reply.Length); }
            catch { return; }
        }
    }

    public async ValueTask DisposeAsync()
    {
        try { _device.Dispose(); } catch { /* best-effort — unblocks the pump's blocking read */ }
        try { await _loop.WaitAsync(TimeSpan.FromSeconds(5)); } catch { /* best-effort teardown */ }
    }
}
