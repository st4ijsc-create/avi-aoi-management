using System.IO.Ports;
using System.Reflection;
using St4i.EdgeCore.Drivers.Modbus;
using Xunit;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// Task D-3 — <see cref="SerialPortBusLink"/>, to the exact extent a machine with no RS-485 hardware can drive
/// it, and no further.
///
/// <para>🔴 <b>What is NOT here, stated up front so a green run is not over-read.</b> There is no portable
/// virtual COM port and this machine has none installed (checked: no <c>com0com</c>-family service is
/// registered). The one real port present, <c>COM1</c>, opens but has nothing on the other end — eight bytes
/// written to it produce zero bytes back — so <b>no Modbus RTU frame has ever traversed this transport</b>,
/// and <see cref="SerialPortBusLink.Read"/>, <see cref="SerialPortBusLink.Write"/> and
/// <see cref="SerialPortBusLink.DrainBufferedInput"/> carrying real data are UNTESTED. The behaviours that
/// could be measured against a real port — the exclusive open, the abort latency with the port left open, the
/// read timeout, the cost of opening — were measured by a standalone probe and are recorded in
/// task-3-report.md with their numbers. A soft <c>return;</c> skip that reported Passed for any of that would
/// be worse than the documented gap, and <c>scripts/verify-suites.sh</c> treats a dynamic xUnit skip as a
/// failure anyway (it expects 0 skipped), so nothing in this class is hardware-conditional.</para>
/// </summary>
public sealed class SerialPortBusLinkTests
{
    /// <summary>A COM name that is genuinely absent from this machine — DERIVED rather than hardcoded, the
    /// same reflex as <c>Drivers/ClosedLoopbackPort</c>: a hardcoded "COM99" is a guess about someone else's
    /// machine, and if the guess is wrong the test opens a stranger's device. Starts at 90 because a machine
    /// with ninety serial ports does not exist, and still excludes everything the OS reports.</summary>
    private static string AbsentPortName()
    {
        var present = new HashSet<string>(SerialPort.GetPortNames(), StringComparer.OrdinalIgnoreCase);
        for (var i = 90; i <= 250; i++)
        {
            var candidate = $"COM{i}";
            if (!present.Contains(candidate)) return candidate;
        }

        throw new InvalidOperationException(
            "COM90..COM250 are all present on this machine, which cannot be right — refusing to guess.");
    }

    /// <summary>Every method called by <paramref name="method"/>'s IL, resolved through its own module. Used
    /// only by the <c>DiscardInBuffer</c> verification below; an unresolvable token is skipped, so this can
    /// under-report and never over-report.</summary>
    private static IReadOnlyList<MethodBase> Callees(MethodBase method)
    {
        var found = new List<MethodBase>();
        var il = method.GetMethodBody()?.GetILAsByteArray();
        if (il is null) return found;

        for (var i = 0; i < il.Length; i++)
        {
            // 0x28 call, 0x6F callvirt, 0x73 newobj — each followed by a 4-byte metadata token.
            if (il[i] is not (0x28 or 0x6F or 0x73)) continue;
            if (i + 4 >= il.Length) break;

            try
            {
                var callee = method.Module.ResolveMethod(
                    BitConverter.ToInt32(il, i + 1),
                    method.DeclaringType?.GetGenericArguments(),
                    method.GetGenericArguments());
                if (callee is not null) found.Add(callee);
            }
            catch
            {
                // A token this scan mis-framed, or one in another module. Skipped deliberately: the assertion
                // this feeds looks for a method that IS there, so a miss fails loudly rather than passing.
            }

            i += 4;
        }

        return found;
    }

    private static int IlLength(MethodBase? method) => method?.GetMethodBody()?.GetILAsByteArray()?.Length ?? -1;

    /// <summary>
    /// 🔴 <b>The brief's "verify <c>SerialPort.DiscardInBuffer()</c> rather than trust the name" obligation,
    /// discharged with the only instrument available on a machine with no loopback.</b> D-2 could measure
    /// NModbus's adapter behaviourally (push stale bytes, call the method, read the buffer back). Without a
    /// peer feeding the line there is no way to put a byte into a COM port's receive buffer, so this reads the
    /// shipped IL instead.
    ///
    /// <para>What it establishes: <c>NModbus.IO.SocketAdapter.DiscardInBuffer</c> and
    /// <c>NModbus.IO.UdpClientAdapter.DiscardInBuffer</c> are <b>1 IL byte</b> each — a bare <c>ret</c>,
    /// which is D-2's "two are literally empty method bodies" corroborated by a second, independent
    /// instrument. <c>SerialPort.DiscardInBuffer</c> is not: it reaches
    /// <c>Interop+Kernel32.PurgeComm</c> through <c>SerialStream.DiscardInBuffer</c>. So the BCL's method is
    /// real where NModbus's are not.</para>
    ///
    /// <para><b>What it does NOT establish, and why this class does not depend on it anyway:</b> IL
    /// reachability proves the call is emitted, never that it runs. And
    /// <see cref="SerialPortBusLink.DrainBufferedInput"/> deliberately does not use
    /// <see cref="SerialPort.DiscardInBuffer"/> at all — it drains by reading, because a purge cannot report
    /// how many bytes it destroyed and an uncounted byte does not restart <see cref="ModbusBus"/>'s quiet
    /// window. See that method's own doc comment. This test is therefore a fact about the BCL and NModbus,
    /// kept because it is the fact the brief asked for and because it goes red if either changes.</para>
    /// </summary>
    [Fact]
    public void SerialPortsDiscardInBuffer_ReachesPurgeComm_WhileTwoOfNModbusThreeAdaptersAreEmptyBodies()
    {
        var nmodbus = typeof(NModbus.IModbusFactory).Assembly;
        var emptyBodied = nmodbus.GetTypes()
            .Where(t => typeof(NModbus.IO.IStreamResource).IsAssignableFrom(t) && t is { IsInterface: false, IsAbstract: false })
            .Select(t => (t.Name, Il: IlLength(t.GetMethod("DiscardInBuffer",
                BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance))))
            .Where(x => x.Il == 1)
            .Select(x => x.Name)
            .ToList();

        Assert.Contains("SocketAdapter", emptyBodied);
        Assert.Contains("UdpClientAdapter", emptyBodied);

        var serialPortDiscard = typeof(SerialPort).GetMethod(nameof(SerialPort.DiscardInBuffer));
        Assert.NotNull(serialPortDiscard);
        Assert.True(IlLength(serialPortDiscard) > 1,
            "SerialPort.DiscardInBuffer has an empty method body on this runtime — i.e. the BCL now behaves " +
            "the way NModbus's own adapters do. Re-verify by hand before trusting anything that calls it.");

        var serialStreamDiscard = typeof(SerialPort).Assembly
            .GetType("System.IO.Ports.SerialStream")
            ?.GetMethod("DiscardInBuffer", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
        Assert.NotNull(serialStreamDiscard);

        Assert.Contains(Callees(serialStreamDiscard!), m => m.Name == "PurgeComm");
    }

    /// <summary>
    /// The line parameters reach the port object. Both arms matter and they are different questions: this one
    /// is "does an EXPLICIT line get applied", and
    /// <see cref="CreatePort_WithTheDefaultLine_ProducesTheSpecsFraming_NotSerialPortsOwn"/> is "does the line
    /// nobody specified get applied" — D-2's I-2 lesson exactly, where a test that supplies the value it
    /// checks is blind to what a caller supplies by default.
    /// </summary>
    [Fact]
    public void CreatePort_AppliesEveryLineParameter_ForcesTheHandshakeOff_AndLeavesRtsDeasserted()
    {
        var line = new SerialLineSettings("COM7", 115_200, Parity.Odd, 8, StopBits.Two);

        using var port = SerialPortBusLink.CreatePort(line);

        Assert.Equal("COM7", port.PortName);
        Assert.Equal(115_200, port.BaudRate);
        Assert.Equal(Parity.Odd, port.Parity);
        Assert.Equal(8, port.DataBits);
        Assert.Equal(StopBits.Two, port.StopBits);

        // RS-485 half duplex has no RTS/CTS flow control, and on a manual-DE adapter RTS IS the transmit
        // enable — Handshake.RequestToSend would turn a flow-control convention into random direction flips.
        Assert.Equal(Handshake.None, port.Handshake);

        // Deasserted holds a manual-DE transceiver in RECEIVE, which is the safe failure: such an adapter
        // will not transmit rather than latching a driver onto the shared segment.
        Assert.False(port.RtsEnable);
        Assert.False(port.DtrEnable);

        // The port's own timeout is ONE SLICE, never the transaction's deadline: that is what makes an
        // in-flight read abortable without closing the port.
        //
        // 🔴 The InRange is not decoration — it is M25's sibling, found by sweeping for the same shape rather
        // than by care. Asserting only `port.ReadTimeout == ReadSliceMs` compares the constant with itself, so
        // changing ReadSliceMs to SerialPort.InfiniteTimeout would keep this green while making every read an
        // unbounded blocking call — the exact thing that cannot be interrupted without destroying the port,
        // i.e. Đợt B's mechanism reintroduced on a shared bus. The bound rather than the literal 20 so tuning
        // the slice stays a one-line change; the range's ends are what carry meaning (positive, or the read
        // never comes up for air; small, or cancellation latency is no longer measured in tens of ms).
        Assert.InRange(SerialPortBusLink.ReadSliceMs, 1, 50);
        Assert.Equal(SerialPortBusLink.ReadSliceMs, port.ReadTimeout);
        Assert.False(port.IsOpen);
    }

    /// <summary>The default arm. The control is a <see cref="SerialPort"/> built the BCL's own way, so the
    /// assertion is about a decision rather than about the numbers written in the type.</summary>
    [Fact]
    public void CreatePort_WithTheDefaultLine_ProducesTheSpecsFraming_NotSerialPortsOwn()
    {
        using var port = SerialPortBusLink.CreatePort(new SerialLineSettings("COM7"));
        using var bclDefaults = new SerialPort("COM7");

        Assert.Equal(19_200, port.BaudRate);
        Assert.Equal(Parity.Even, port.Parity);
        Assert.NotEqual(bclDefaults.BaudRate, port.BaudRate);
        Assert.NotEqual(bclDefaults.Parity, port.Parity);
    }

    /// <summary>
    /// D-2's task-2-report.md §6.1 states the obligation this discharges: "D-3's serial key must include baud
    /// rate, parity, data bits and stop bits, not merely the port name, because two connectors that disagree
    /// about baud rate are not two views of one bus."
    ///
    /// <para>Data bits is deliberately NOT a row here and cannot be: <see cref="SerialLineSettings"/> refuses
    /// anything but 8, so no two valid settings can differ in it. It is still in the key, because the key is
    /// built from the settings type and a future task that relaxes that constraint (ASCII framing) must not
    /// have to remember to widen the key too. That row is therefore untestable by construction rather than
    /// omitted, and task-3-report.md records the corresponding mutation as one that cannot be killed.</para>
    /// </summary>
    [Theory]
    [InlineData("COM3", 9_600, Parity.Even, StopBits.One)]      // baud rate
    [InlineData("COM3", 19_200, Parity.Odd, StopBits.One)]      // parity — the silent-failure parameter
    [InlineData("COM3", 19_200, Parity.Even, StopBits.Two)]     // stop bits
    [InlineData("COM4", 19_200, Parity.Even, StopBits.One)]     // the port itself
    public void CreateBusKey_DistinguishesEveryLineParameter_NotOnlyThePortName(
        string portName, int baudRate, Parity parity, StopBits stopBits)
    {
        var baseline = SerialPortBusLink.CreateBusKey(new SerialLineSettings("COM3"));
        var variant = SerialPortBusLink.CreateBusKey(new SerialLineSettings(portName, baudRate, parity, 8, stopBits));

        Assert.NotEqual(baseline, variant);
    }

    [Fact]
    public void CreateBusKey_TreatsThePortNameCaseInsensitively()
        => Assert.Equal(
            SerialPortBusLink.CreateBusKey(new SerialLineSettings("COM3")),
            SerialPortBusLink.CreateBusKey(new SerialLineSettings("com3")));

    /// <summary>
    /// The open-failure path, which IS reachable without hardware. Measured on this machine, the BCL's own
    /// exceptions are <c>FileNotFoundException: Could not find file 'COM99'</c> (absent),
    /// <c>UnauthorizedAccessException: Access to the path 'COM1' is denied</c> (held by another process) and
    /// <c>ArgumentException: … does not resolve to a valid serial port</c> (not a port). None of the three
    /// names the LINE PARAMETERS, which on RS-485 are the first thing to suspect — so the wrapper does, and
    /// this asserts that rather than only the exception type.
    ///
    /// <para>Only the absent-port arm is exercised here; the "already held" arm needs a real port and was
    /// measured by probe (see task-3-report.md).</para>
    /// </summary>
    [Fact]
    public async Task OpenAsync_AgainstAnAbsentPort_ThrowsSerialPortUnavailable_NamingThePortAndItsFraming()
    {
        var line = new SerialLineSettings(AbsentPortName(), 9_600, Parity.Odd, 8, StopBits.Two);

        var ex = await Assert.ThrowsAsync<SerialPortUnavailableException>(
            async () => await SerialPortBusLink.OpenAsync(line, CancellationToken.None));

        Assert.Contains(line.PortName, ex.Message, StringComparison.Ordinal);
        Assert.Contains("9600-8-O-2", ex.Message, StringComparison.Ordinal);
        Assert.NotNull(ex.InnerException);

        // An IOException subclass deliberately: ModbusRtuDriver's poll catch and ModbusBus's link handling
        // already treat that as "degrade and rebuild", and a type outside that hierarchy would have escaped
        // handling that already exists.
        Assert.IsAssignableFrom<IOException>(ex);
    }

    /// <summary>
    /// 🔴 <b>The abort check runs BEFORE the port is touched — the one half of D-2's cancellation design that
    /// is reachable on a machine with no RS-485 hardware, and it only became reachable because a mutation
    /// survived.</b>
    ///
    /// <para>The discriminator is the second half. Asserting only that an aborted read throws
    /// <see cref="OperationCanceledException"/> would not distinguish "the abort check fired" from "the port
    /// refused the call" — so the same link, with the abort cleared, is driven again and must fail
    /// DIFFERENTLY: <see cref="InvalidOperationException"/> "The port is closed", i.e. the call reached the
    /// port. Without that arm the mutation that deletes the abort branch entirely would still pass.</para>
    ///
    /// <para>What this does NOT prove, because it cannot without a port: that the read LOOP rechecks the flag
    /// between slices. That is the mutation task-3-report.md records as surviving, and the probe measurement
    /// against a real COM1 (abort honoured after 0.17 / 0.18 / 15.96 ms with the port still open) is the only
    /// evidence for it.</para>
    /// </summary>
    [Fact]
    public void Read_WithAnAbortPending_ThrowsBeforeItTouchesThePort_AndClearingItLetsTheCallThrough()
    {
        var line = new SerialLineSettings("COM7");
        using var port = SerialPortBusLink.CreatePort(line);
        using var link = SerialPortBusLink.Adopt(port, line);

        link.AbortPendingRead();
        var aborted = Assert.Throws<OperationCanceledException>(() => link.Read(new byte[8], 0, 8));
        Assert.Contains(line.Describe(), aborted.Message, StringComparison.Ordinal);
        Assert.Contains("still open", aborted.Message, StringComparison.Ordinal);

        link.ResetAbort();
        Assert.Throws<InvalidOperationException>(() => link.Read(new byte[8], 0, 8));
    }

    /// <summary>
    /// The transport's own <see cref="IModbusBusLink.WriteTimeout"/> reaches the PORT — asserted on the port
    /// object rather than on the value handed in, which is D-2's I-2 shape ("a test that supplies the value it
    /// checks is blind to who chooses that value"). The write itself fails, because the port was never opened;
    /// what matters is that the timeout got there first.
    /// </summary>
    [Fact]
    public void Write_HandsThePortItsOwnWriteTimeout_RatherThanLeavingWhateverWasThere()
    {
        var line = new SerialLineSettings("COM7");
        using var port = SerialPortBusLink.CreatePort(line);
        using var link = SerialPortBusLink.Adopt(port, line);

        link.WriteTimeout = 750;
        Assert.Throws<InvalidOperationException>(() => link.Write(new byte[8], 0, 8));
        Assert.Equal(750, port.WriteTimeout);

        // A non-positive value means "no deadline", the same convention GatewayTcpBusLink uses.
        //
        // 🔴 Mutation-found (M25). This arm originally used -1, and -1 IS SerialPort.InfiniteTimeout — so the
        // mutation that deletes the `> 0 ?` mapping entirely and assigns the raw value passed the assertion,
        // because both sides were the same number. The arm is 0 now: an unmapped 0 is a zero-length write
        // deadline, which is a different thing from no deadline, and the assertion can finally tell them
        // apart. A test whose expected value coincides with its input is blind by construction.
        link.WriteTimeout = 0;
        Assert.Throws<InvalidOperationException>(() => link.Write(new byte[8], 0, 8));
        Assert.Equal(SerialPort.InfiniteTimeout, port.WriteTimeout);
    }

    /// <summary>
    /// Teardown, and the two "the port went away underneath me" swallows. A drain must never throw for a port
    /// that is merely closed — <c>ModbusBus.ResynchroniseAsync</c> treats a throwing drain as a faulted link
    /// and tears it down, so an ordinary teardown race would look like a hardware failure. A drain of a port
    /// that has genuinely FAILED still throws; that arm needs hardware and is untested.
    /// </summary>
    [Fact]
    public void AClosedPortDrainsToNothingWithoutThrowing_AndDisposeIsIdempotent()
    {
        var line = new SerialLineSettings("COM7");
        var port = SerialPortBusLink.CreatePort(line);
        var link = SerialPortBusLink.Adopt(port, line);

        Assert.False(link.IsOpen);
        Assert.Equal(0, link.DrainBufferedInput());
        link.DiscardInBuffer();

        link.Dispose();
        link.Dispose();

        Assert.False(link.IsOpen);
        Assert.Equal(0, link.DrainBufferedInput());
        Assert.Throws<ObjectDisposedException>(() => link.Read(new byte[8], 0, 8));
        Assert.Throws<ObjectDisposedException>(() => link.Write(new byte[8], 0, 8));
    }

    /// <summary>
    /// 🔴 <b>The exclusive-open consequence, driven through the real registry rather than asserted about a
    /// string.</b> Measured on this machine: <c>COM1</c> opens once and a second
    /// <see cref="SerialPort"/> on the same name throws
    /// <c>UnauthorizedAccessException: Access to the path 'COM1' is denied</c>. So "two connectors on one
    /// RS-485 segment" is only physically possible if they share ONE open — which is what D-1's review argued
    /// and what D-2 built the reference-counted seam for. This drives two leases whose keys were built from
    /// two differently-spelled but identical lines, executes a transaction on each, and asserts the opener ran
    /// ONCE and the bus opened ONE physical link.
    ///
    /// <para>The opener hands back an in-memory link, not a real port — that is the point: what is under test
    /// is that the serial KEY makes the two callers share, not that a COM port can be opened.</para>
    /// </summary>
    [Fact]
    public async Task TwoConnectorsOnOneSerialLine_ShareOneBus_AndOpenThePortOnce()
    {
        await using var registry = new ModbusBusRegistry();

        var opens = 0;
        Task<IModbusBusLink> Open(CancellationToken _)
        {
            Interlocked.Increment(ref opens);
            return Task.FromResult<IModbusBusLink>(InMemoryBusLinkPair.Create().Master);
        }

        var keyA = SerialPortBusLink.CreateBusKey(new SerialLineSettings("COM3"));
        var keyB = SerialPortBusLink.CreateBusKey(new SerialLineSettings(" com3 "));

        await using var leaseA = registry.Acquire(keyA, Open);
        await using var leaseB = registry.Acquire(keyB, Open);

        Assert.Same(leaseA.Bus, leaseB.Bus);
        Assert.Equal(2, registry.LeaseCount(keyA));

        await using (await leaseA.Bus.BeginTransactionAsync(1_000, 0, CancellationToken.None)) { }
        await using (await leaseB.Bus.BeginTransactionAsync(1_000, 0, CancellationToken.None)) { }

        Assert.Equal(1, opens);
        Assert.Equal(1, leaseA.Bus.LinkGeneration);
    }

    /// <summary>
    /// The other half of the key rule, and the one that would be a silent misconfiguration without it: two
    /// connectors naming the same port with DIFFERENT framing are not two views of one bus. They get two keys,
    /// two buses and two opens — the second of which fails loudly against a real port
    /// (<see cref="SerialPortUnavailableException"/>), which is a refusal rather than a silent adoption of
    /// whichever line happened to construct the bus first. Asserted on what reached the seam (two buses, two
    /// opener invocations, each bus's own link generation) rather than on the two key strings being unequal.
    /// </summary>
    [Fact]
    public async Task TwoConnectorsThatDisagreeAboutTheLine_GetTwoBuses_NeverOneSilentlySharedPort()
    {
        await using var registry = new ModbusBusRegistry();

        var opens = 0;
        Task<IModbusBusLink> Open(CancellationToken _)
        {
            Interlocked.Increment(ref opens);
            return Task.FromResult<IModbusBusLink>(InMemoryBusLinkPair.Create().Master);
        }

        var fast = SerialPortBusLink.CreateBusKey(new SerialLineSettings("COM3", 19_200));
        var slow = SerialPortBusLink.CreateBusKey(new SerialLineSettings("COM3", 9_600));

        await using var leaseFast = registry.Acquire(fast, Open);
        await using var leaseSlow = registry.Acquire(slow, Open);

        Assert.NotSame(leaseFast.Bus, leaseSlow.Bus);
        Assert.Equal(1, registry.LeaseCount(fast));
        Assert.Equal(1, registry.LeaseCount(slow));

        await using (await leaseFast.Bus.BeginTransactionAsync(1_000, 0, CancellationToken.None)) { }
        await using (await leaseSlow.Bus.BeginTransactionAsync(1_000, 0, CancellationToken.None)) { }

        Assert.Equal(2, opens);
        Assert.Equal(1, leaseFast.Bus.LinkGeneration);
        Assert.Equal(1, leaseSlow.Bus.LinkGeneration);
    }
}
