using System.IO.Ports;
using System.Reflection;
using NModbus;
using St4i.EdgeCore.Drivers.Modbus;
using Xunit;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// Task D-3 — <see cref="SerialPortBusLink"/>, to the exact extent a machine with no RS-485 hardware can drive
/// it, and no further.
///
/// <para>🔴 <b>What is and is not proven here, stated up front so a green run is not over-read.</b> There is
/// no portable virtual COM port and this machine has none installed (checked: no <c>com0com</c>-family service
/// is registered). The one real port present, <c>COM1</c>, opens but has nothing on the other end — eight
/// bytes written to it produce zero bytes back.</para>
///
/// <para>Since the review's I-3, the link's read loop, its deadline, its abort recheck and its drain ARE
/// driven — over an <see cref="ISerialPortHandle"/> whose every behaviour was measured against a real COM
/// port (see <see cref="FakeSerialPortHandle"/> for the list and for what it deliberately does not model), and
/// a real RTU frame round-trips through this transport's own <c>Read</c>/<c>Write</c>. What remains untested
/// against hardware is narrower than it was: <c>SystemSerialPortHandle</c>'s seven one-line delegations, and
/// everything about copper — baud, parity, half duplex, direction control. <c>tools/serial-bench</c> exercises
/// the first of those against a real port; the rest is a bench acceptance step.</para>
///
/// <para>Nothing in this class is hardware-conditional. A soft <c>return;</c> skip reporting Passed would be
/// worse than a documented gap, and <c>scripts/verify-suites.sh</c> treats a dynamic xUnit skip as a failure
/// anyway — correctly: xUnit counts a skipped test in <c>Total</c>, so a hardware-conditional suite would make
/// <c>Skipped</c> environment-dependent and any fixed expectation would fail on the BETTER-equipped machine.
/// <c>skipped == 0</c> is what makes a total mean the same thing everywhere.</para>
/// </summary>
public sealed class SerialPortBusLinkTests
{
    /// <summary>🔴 Task D-7c — the same derivation, shared with
    /// <see cref="ModbusRtuSerialBusSettingsTests"/>, which needs the identical "a port that is genuinely not
    /// here" fact to assert that absence is a START-UP issue rather than a parse-time refusal. Exposed rather
    /// than copied: two independent probes of the same machine fact would drift, and the reason this one is
    /// derived rather than hardcoded is the whole point of it.</summary>
    internal static string AbsentPortNameForTests() => AbsentPortName();

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
    /// <para><b>What it does NOT establish:</b> IL reachability proves the call is emitted, never that it
    /// runs.</para>
    ///
    /// <para>🔴 <b>Review M-8 — THE TWO HALVES OF THIS TEST ARE NOT WORTH THE SAME, and whoever sees it go red
    /// needs to know which half fired before deciding anything.</b></para>
    ///
    /// <list type="bullet">
    /// <item><description><b>The NModbus half is LOAD-BEARING.</b> That two of its three adapters purge
    /// nothing is the entire reason <see cref="IModbusBusLink.DrainBufferedInput"/> exists as a member at all
    /// — D-2 added it because NModbus's own hook could not be trusted. If those two ever stop being 1-byte
    /// bodies, the divergence this seam was built for is over and someone should re-derive whether the seam is
    /// still needed.</description></item>
    /// <item><description><b>The <see cref="SerialPort"/> half is INFORMATIONAL.</b>
    /// <see cref="SerialPortBusLink.DrainBufferedInput"/> deliberately does not call
    /// <see cref="SerialPort.DiscardInBuffer"/> — it drains by reading, because a purge cannot report how many
    /// bytes it destroyed. So this half pins a third-party method <b>the product never invokes</b>, and it can
    /// go red on a rename of the internal <c>System.IO.Ports.SerialStream</c> with <b>zero product
    /// consequence</b>. It is kept because verifying it rather than trusting its name is what the D-3 brief
    /// asked for, and because a future BCL that gutted it would be worth knowing about. <b>If it fails, update
    /// this test — do not "fix" the transport, which is not using the method.</b></description></item>
    /// </list>
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

        // 🔴 The slice pin is NOT asserted here any more — review I-2 moved it out of this factory and into
        // the constructor, so it holds for every link however it was built. See
        // EveryLink_PinsThePortsReadTimeoutToOneSlice_HoweverItWasConstructed, which asserts the BCL default
        // survives THIS call as its discriminator.
        //
        // 🔴 The InRange stays here and is not decoration — it is M25's sibling, found by sweeping for the same
        // shape rather than by care. Asserting only `readTimeout == ReadSliceMs` anywhere compares the constant
        // with itself, so changing ReadSliceMs to SerialPort.InfiniteTimeout would keep every such assertion
        // green while making each read an unbounded blocking call — the exact thing that cannot be interrupted
        // without destroying the port, i.e. Đợt B's mechanism reintroduced on a shared bus. The bound rather
        // than the literal 20 so tuning the slice stays a one-line change; the range's ends are what carry
        // meaning (positive, or the read never comes up for air; small, or cancellation latency is no longer
        // measured in tens of ms).
        Assert.InRange(SerialPortBusLink.ReadSliceMs, 1, 50);
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
    /// <para>Only the absent-port arm is exercised END TO END here; the "already held" arm needs a real port
    /// plus a second holder and was measured by probe (see task-3-report.md). 🔴 Task D-7c makes all three
    /// arms' MESSAGES assertable regardless — see
    /// <see cref="TheOpenFailureMessage_SaysWhichOfTheThreeCausesItWas_NeverAllThreeAtOnce"/>.</para>
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

        // 🔴 Task D-7c — and it is the ABSENT arm's wording, not a shotgun listing all three causes. This is
        // the one assertion that ties DescribeOpenFailure's decision to the real I/O path: every other arm is
        // driven from a synthesised exception, so without this the discrimination could be perfect and simply
        // not wired to OpenAsync at all.
        Assert.Contains("NOT PRESENT", ex.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("already held", ex.Message, StringComparison.Ordinal);

        // An IOException subclass deliberately: ModbusRtuDriver's poll catch and ModbusBus's link handling
        // already treat that as "degrade and rebuild", and a type outside that hierarchy would have escaped
        // handling that already exists.
        Assert.IsAssignableFrom<IOException>(ex);
    }

    /// <summary>
    /// 🔴 <b>Task D-7c — what an operator reads when a COM port will not open, and the defect D-3 recorded
    /// rather than fixed.</b>
    ///
    /// <para>D-3's message appended ONE sentence naming all three causes at once: "The port may not be present
    /// …, may be held by another application, or the name may not be a serial port on this machine." It is
    /// true of exactly one producing path at a time, and the three remedies send a person to three different
    /// places — the cabinet, the task manager, the configuration file. That is D-5's I-1 class, which this
    /// batch has now graded three times.</para>
    ///
    /// <para><b>Why the assertions are a MATRIX and not three independent "contains" checks.</b> Three
    /// positive checks would all pass on the old shotgun message, because it contained every phrase. What
    /// discriminates is the NEGATIVE half: each arm must carry its own diagnosis and must NOT carry the other
    /// two. Only the pair of directions can tell "it says which one" from "it says all of them".</para>
    ///
    /// <para><b>Why it is driven from synthesised exceptions.</b> Reaching the HELD arm needs a real port and a
    /// second holder; reaching the NOT-A-PORT arm needs a name this machine's driver stack rejects. Neither can
    /// be a test inside the five suites without making a green number mean different things on different
    /// machines — blueprint §8.1's own correction from D-3. Extracting the decision into a pure function of
    /// (settings, exception) is what makes all three deterministic here, and the absent-port test above is what
    /// proves the function is the one <c>OpenAsync</c> actually calls. The three BCL exception types are
    /// D-3's own measurements, not guesses.</para>
    /// </summary>
    [Fact]
    public void TheOpenFailureMessage_SaysWhichOfTheThreeCausesItWas_NeverAllThreeAtOnce()
    {
        var line = new SerialLineSettings("COM3", 19_200, Parity.Even, 8, StopBits.One);

        var absent = SerialPortBusLink.DescribeOpenFailure(
            line, new FileNotFoundException("Could not find file 'COM3'."));
        var held = SerialPortBusLink.DescribeOpenFailure(
            line, new UnauthorizedAccessException("Access to the path 'COM3' is denied."));
        var notAPort = SerialPortBusLink.DescribeOpenFailure(
            line, new ArgumentException("The given port name (COM3) does not resolve to a valid serial port."));

        // Every arm still answers the question D-3's wrapper exists for: WHICH LINE was I driving.
        foreach (var message in new[] { absent, held, notAPort })
        {
            Assert.Contains("COM3 19200-8-E-1", message, StringComparison.Ordinal);
        }

        // ── ABSENT: the adapter is not there. Says so, says the machine's actual ports, and says explicitly
        // that this is NOT a refusal — because "plug it back in" only works if nothing has to be restarted.
        Assert.Contains("NOT PRESENT", absent, StringComparison.Ordinal);
        Assert.Contains("Serial ports present right now:", absent, StringComparison.Ordinal);
        Assert.Contains("plugging the adapter", absent, StringComparison.Ordinal);
        Assert.DoesNotContain("already held", absent, StringComparison.Ordinal);
        Assert.DoesNotContain("does NOT resolve", absent, StringComparison.Ordinal);

        // ── HELD: the port exists and someone has it. 🔴 It names BOTH holders, and the second one is the one
        // this product can create itself: two connector entries naming one port with DIFFERENT line parameters
        // are two bus keys by design (CreateBusKey folds every parameter in), so the second open lands here.
        // Telling that operator to hunt "another application" would send them after a process that does not
        // exist while their own configuration file holds the answer.
        Assert.Contains("already held", held, StringComparison.Ordinal);
        Assert.Contains("EXCLUSIVELY", held, StringComparison.Ordinal);
        Assert.Contains("another application", held, StringComparison.Ordinal);
        Assert.Contains("DIFFERENT line parameters", held, StringComparison.Ordinal);
        Assert.DoesNotContain("NOT PRESENT", held, StringComparison.Ordinal);
        Assert.DoesNotContain("does NOT resolve", held, StringComparison.Ordinal);

        // ── NOT A PORT: a naming problem, and it says so in those words so nobody goes looking at hardware.
        Assert.Contains("does NOT resolve", notAPort, StringComparison.Ordinal);
        Assert.Contains("naming problem, not a hardware one", notAPort, StringComparison.Ordinal);
        Assert.DoesNotContain("NOT PRESENT", notAPort, StringComparison.Ordinal);
        Assert.DoesNotContain("already held", notAPort, StringComparison.Ordinal);

        // 🔴 The one phrase that must be gone from ALL of them: D-3's shotgun. Asserted by content rather than
        // by trusting the rewrite, because a message that keeps the old sentence AND adds a diagnosis is worse
        // than either — it says "here is the cause" and then lists two more.
        foreach (var message in new[] { absent, held, notAPort })
        {
            Assert.DoesNotContain("may be held by another", message, StringComparison.Ordinal);
        }
    }

    /// <summary>
    /// 🔴 <b>Task D-7c fix round 1, review I-3 — "one open for N leases, last release closes the port", OBSERVED
    /// rather than derived, and the finding is that I said this could not be done.</b>
    ///
    /// <para>D-7c shipped this property as arithmetic: three leases on one key, and D-2's proof that
    /// <see cref="ModbusBusRegistry.Acquire"/> invokes <c>openLink</c> only for the caller that CREATES the bus.
    /// The report then claimed no observation was available without hardware. <b>That was a claim about the
    /// tools I had picked up, not about the code</b> — §8.1 principle 1, the fourth time in this batch — and the
    /// reviewer refuted it by building this test. Everything it needs already existed and was built for exactly
    /// this purpose: <see cref="SerialPortBusLink.AdoptHandle"/> is <c>internal</c> behind D-3's own
    /// <c>InternalsVisibleTo</c>, and its doc comment says in as many words that it exists because "a
    /// <c>SerialPort</c> cannot be constructed without a real port".</para>
    ///
    /// <para><b>What is OBSERVED here, and why each observation is not the one I shipped.</b> The shipped
    /// EngineApi test asserts <c>LeaseCount</c>, correctly rejects it for the final check because it answers 0
    /// for a key that never existed, and substitutes <c>HasBus</c> — <b>which is the same witness one field
    /// over</b>. Both are <see cref="ModbusBusRegistry"/>'s own bookkeeping, and §8.1 principle 5's rule is to
    /// measure the consequence <i>on the thing the mechanism protects</i>. The thing protected is <b>a COM port
    /// not held open to process exit</b>, and that is readable off the port:</para>
    /// <list type="number">
    /// <item><description><b>How many ports were opened at all</b> — the opener mints a new handle per call, so
    /// <c>handles.Count</c> is the open count. One, for three leases.</description></item>
    /// <item><description><b><see cref="ModbusBus.LinkGeneration"/></b> — the bus's own count of physical links
    /// built, which D-2 added precisely so "the link survived" is distinguishable from "the link was rebuilt
    /// fast enough that nobody noticed".</description></item>
    /// <item><description><b>The port's own <c>IsOpen</c></b>, after each release. Still open after two,
    /// <b>closed after the third</b>. That is the consequence, not a proxy for it.</description></item>
    /// </list>
    ///
    /// <para><b>What it still does not prove, unchanged:</b> no <c>System.IO.Ports.SerialPort</c> is opened
    /// anywhere in these suites, and nothing here touches baud, parity, half duplex or direction control.
    /// <see cref="FakeSerialPortHandle"/>'s own doc comment lists what it models and what it refuses to model,
    /// and <c>tools/serial-bench</c> is where the hardware-dependent half lives — it already contains
    /// <c>PortOpens</c> and <c>ExclusiveOpen</c> against a real port, and is the right home for a
    /// two-adapter multidrop measurement whenever one exists.</para>
    /// </summary>
    [Fact]
    public async Task OneOpenForNLeases_ObservedThroughTheSerialLink_AndTheLastReleaseClosesThePort()
    {
        var line = new SerialLineSettings("COM7");
        var key = SerialPortBusLink.CreateBusKey(line);
        var handles = new List<FakeSerialPortHandle>();

        Task<IModbusBusLink> Open(CancellationToken _)
        {
            var handle = FakeSerialPortHandle.Unpaired("COM7");
            handles.Add(handle);
            return Task.FromResult<IModbusBusLink>(SerialPortBusLink.AdoptHandle(handle, line));
        }

        await using var buses = new ModbusBusRegistry();

        var first = buses.Acquire(key, Open);
        var second = buses.Acquire(key, Open);
        var third = buses.Acquire(key, Open);

        // Three leases, ONE bus — the precondition. Asserted by reference so it cannot be satisfied by two
        // buses that merely compare equal.
        Assert.Same(first.Bus, second.Bus);
        Assert.Same(first.Bus, third.Bus);

        // Nothing is opened until a transaction runs — the deferred-open contract that keeps
        // IConnectorFactory.TryCreate's "no I/O" promise true all the way down.
        Assert.Empty(handles);

        foreach (var lease in new[] { first, second, third })
        {
            // No ConfigureAwait(false): xUnit1030 — inside a test method it can bypass the runner's
            // parallelization limits. The first draft carried it out of src/ habit and drifted the gate's
            // warning count 115 -> 116, which is exactly the size of signal the brief says gets waved through.
            await using var transaction = await lease.Bus
                .BeginTransactionAsync(readTimeoutMs: 250, retries: 0, CancellationToken.None);
        }

        // 🔴 ONE open for three leases, counted rather than inferred.
        var port = Assert.Single(handles);
        Assert.Equal(1, first.Bus.LinkGeneration);
        Assert.True(port.IsOpen, "the shared port must be open while any lease is held");

        await first.DisposeAsync();
        Assert.True(port.IsOpen, "releasing one of three leases must NOT close a port two devices are still on");

        await second.DisposeAsync();
        Assert.True(port.IsOpen, "one device is still on this line — the port must stay open");

        await third.DisposeAsync();

        // 🔴 The consequence, read off the PORT rather than off the registry: a COM port that outlived its last
        // device would be unopenable until the process restarted (the open is exclusive — D-3 measured it), and
        // would present as an unrelated connector failing to start.
        Assert.False(port.IsOpen,
            "the LAST release must close the port; a serial port opens exclusively, so one left open is one no " +
            "other process — or this one, after a reconfiguration — can ever have again before a restart");
        Assert.Single(handles);
    }

    /// <summary>
    /// The fallback arm. A plain <see cref="IOException"/> out of <c>SerialPort.Open</c> is not one of D-3's
    /// three measured shapes, and the message must NOT invent a diagnosis for it — the one thing worse than
    /// "we do not know" is a confident wrong answer, which is the whole subject of the test above.
    /// </summary>
    [Fact]
    public void AnUnattributedIoFailure_IsReportedAsUnattributed_RatherThanGuessingOneOfTheThree()
    {
        var message = SerialPortBusLink.DescribeOpenFailure(
            new SerialLineSettings("COM3"), new IOException("The device is not ready."));

        Assert.Contains("The device is not ready.", message, StringComparison.Ordinal);
        Assert.Contains("did not attribute further", message, StringComparison.Ordinal);
        Assert.DoesNotContain("NOT PRESENT", message, StringComparison.Ordinal);
        Assert.DoesNotContain("already held", message, StringComparison.Ordinal);
        Assert.DoesNotContain("does NOT resolve", message, StringComparison.Ordinal);
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

    // ── Review I-3: the four members that used to be unreachable ──────────────────────────────────────────
    //
    // Every test below drives the REAL SerialPortBusLink.Read / Write / DrainBufferedInput over an
    // ISerialPortHandle whose seven behaviours were measured against a real COM port (see
    // FakeSerialPortHandle for the list, and for what it deliberately does not model). Before this seam
    // existed, four mutations to these members survived the entire suite — not because the code was untested
    // by oversight, but because the instrument I had picked up could not reach them.

    /// <summary>
    /// 🔴 <b>Kills M19b, which my own report called the most consequential of the five survivors.</b> The
    /// count is what restarts <see cref="ModbusBus"/>'s quiet window: a drain that removes bytes and reports 0
    /// lets the window expire while a device is still emitting. Asserts BOTH halves — the number returned and
    /// that the port really is empty afterwards — because a drain that reports the right number and removes
    /// nothing would be just as wrong.
    /// </summary>
    [Fact]
    public void DrainBufferedInput_ReportsExactlyWhatItRemoved_AndLeavesThePortEmpty()
    {
        var handle = FakeSerialPortHandle.Unpaired();
        using var link = SerialPortBusLink.AdoptHandle(handle, new SerialLineSettings("COM7"));

        Assert.Equal(0, link.DrainBufferedInput());

        handle.Deliver(1, 3, 2, 0, 235, 0xB9, 0xE5);
        Assert.Equal(7, handle.BytesToRead);

        Assert.Equal(7, link.DrainBufferedInput());
        Assert.Equal(0, handle.BytesToRead);
        Assert.Equal(0, link.DrainBufferedInput());
    }

    /// <summary>
    /// 🔴 <b>Review M-10 — a teardown landing BETWEEN <c>BytesToRead</c> and <c>Read</c> inside the drain's
    /// loop.</b> The <c>BytesToRead</c> call swallowed the two "the port went away underneath me" shapes and
    /// the <c>Read</c> call did not, so a disposal in that two-call window threw out of the drain — and
    /// <c>ModbusBus.ResynchroniseAsync</c> turns any throw from there into
    /// <c>ModbusBusResynchronisationException</c> + <c>FaultLink()</c>. A noisier teardown rather than a wrong
    /// number, but the half-guarded shape was the defect: the method decided the race mattered and then
    /// handled it in one of the two places it happens.
    ///
    /// <para>The count so far must still come back rather than 0 — bytes genuinely were drained, and reporting
    /// 0 would tell <see cref="ModbusBus"/>'s quiet window the line had been silent when it had not. That is
    /// the second assertion, and it is the one that distinguishes this fix from a bare <c>catch { return 0; }</c>.</para>
    ///
    /// <para><b>The identical asymmetry in <c>GatewayTcpBusLink</c> is fixed in the same commit and is NOT
    /// covered by a test</b>: that class holds a concrete <see cref="System.Net.Sockets.TcpClient"/>, so its
    /// drain has exactly the non-injectable problem review I-3 solved here — reported in task-3-report.md
    /// rather than solved by refactoring D-2's measured link inside a fix round.</para>
    /// </summary>
    [Fact]
    public void DrainBufferedInput_WhenThePortIsTornDownMidDrain_ReturnsWhatItAlreadyRemoved_RatherThanThrowing()
    {
        var handle = FakeSerialPortHandle.Unpaired();
        using var link = SerialPortBusLink.AdoptHandle(handle, new SerialLineSettings("COM7"));

        // More than one scratch buffer's worth, so the drain loops: the first read removes a full buffer and
        // the SECOND one meets a port that has closed underneath it. That ordering is what makes the two
        // failure modes distinguishable — see CloseBeforeReadNumber.
        handle.Deliver(new byte[600]);
        handle.CloseBeforeReadNumber = 2;

        // Without the catch around _port.Read this throws InvalidOperationException, and
        // ModbusBus.ResynchroniseAsync escalates that into a faulted link and a refused transaction.
        var drained = link.DrainBufferedInput();

        Assert.False(handle.IsOpen);
        Assert.Equal(2, handle.ReadCalls);

        // 🔴 The assertion that carries the fix: what was ALREADY removed is reported. A `catch { return 0; }`
        // would compile, pass a "doesn't throw" test, and tell ModbusBus's quiet window the line had been
        // silent when 512 bytes had just come off it — the plausible-wrong-number shape again. Asserted as a
        // range rather than the exact buffer size so the test does not pin a private constant.
        Assert.InRange(drained, 1, 599);

        // 🔴 THE SECOND SITE, and it is here because a mutation found it rather than because I remembered.
        // The drain touches the port TWICE per iteration — BytesToRead and Read — so the teardown race has
        // two landing places, and a mutation aimed at the Read catch matched the BytesToRead one instead and
        // SURVIVED. Fixing one instance of a defect class buys no immunity to the class (D-2 §11b rule 1);
        // the countermeasure is to cover the sites, not to be careful about them.
        var second = FakeSerialPortHandle.Unpaired();
        using var secondLink = SerialPortBusLink.AdoptHandle(second, new SerialLineSettings("COM7"));

        second.Deliver(new byte[600]);
        second.CloseBeforeBytesToReadNumber = 2;   // iteration 1 drains a full buffer; iteration 2's probe fails

        var partial = secondLink.DrainBufferedInput();

        Assert.False(second.IsOpen);
        Assert.Equal(1, second.ReadCalls);
        Assert.InRange(partial, 1, 599);
    }

    /// <summary>
    /// 🔴 <b>Kills M21b — the outer deadline.</b> The port's own timeout is one 20 ms slice; the transaction's
    /// deadline is <see cref="IModbusBusLink.ReadTimeout"/> and is enforced by the link's loop, so a read
    /// against a silent line must give up at ITS bound and not at the slice's. Asserts the elapsed time is at
    /// least the bound (it did not give up at the first slice) and that the message names the line, which is
    /// the whole point of carrying the framing through every exception.
    /// </summary>
    [Fact]
    public async Task Read_AgainstASilentLine_GivesUpAtItsOwnDeadline_NotAtTheSliceBoundary()
    {
        var handle = FakeSerialPortHandle.Unpaired();
        var line = new SerialLineSettings("COM7", 9_600, Parity.Odd, 8, StopBits.Two);
        using var link = SerialPortBusLink.AdoptHandle(handle, line);

        link.ReadTimeout = 200;

        // 🔴 Bounded on its own thread rather than called inline, and that is D-2's §8.4(2) rule applied
        // before the fact instead of after it: the mutation this test exists to kill DELETES the deadline
        // check, and an inline call would then loop forever — a test that hangs under a defect is strictly
        // worse than one that fails under it, because a failure names the defect and a hang names nothing.
        var started = Environment.TickCount64;
        var reading = BlockingWork.Run(() =>
        {
            try { link.Read(new byte[8], 0, 8); return (Exception?)null; }
            catch (Exception ex) { return ex; }
        }, "serial-deadline-read");

        var thrown = await reading.WaitAsync(TimeSpan.FromSeconds(10));
        var elapsed = Environment.TickCount64 - started;

        var ex = Assert.IsType<TimeoutException>(thrown);

        // One tick of slack: both this link and GatewayTcpBusLink build their deadline from
        // Environment.TickCount64, which advances in ~15.6 ms steps (measured), so a nominal bound expires
        // within ±1 tick. Asserting an exact >= 200 would be asserting a precision the clock does not have —
        // tools/serial-bench documents the same correction, which it found by failing at 244.86 ms of 250.
        Assert.True(elapsed >= 200 - 16,
            $"gave up after {elapsed} ms against a 200 ms bound — it used the slice, not the deadline");
        Assert.Contains(line.Describe(), ex.Message, StringComparison.Ordinal);
        Assert.Contains("200", ex.Message, StringComparison.Ordinal);

        // ...and it really did come up for air repeatedly rather than issuing one long blocking read, which is
        // the property the whole cancellation design rests on. 200 ms / 20 ms slices = ~10.
        Assert.True(handle.ReadCalls > 1, $"only {handle.ReadCalls} read call(s) — the loop issued one long blocking read");
        Assert.Equal(SerialPortBusLink.ReadSliceMs, handle.ReadTimeout);
    }

    /// <summary>
    /// 🔴 <b>The between-slice abort recheck — the last untested half of this batch's central safety
    /// property.</b> <c>Read_WithAnAbortPending_…</c> covers only the check before the FIRST slice; this one
    /// starts a read that is already blocking, raises the abort from another thread, and asserts the read
    /// throws promptly <b>with the port still open</b>. That is D-2's design in full: cancel one device's read
    /// without tearing the line down for the rest of the bus.
    /// </summary>
    [Fact]
    public async Task Read_AbortedWhileAlreadyBlocking_ThrowsPromptly_WithoutClosingThePort()
    {
        var handle = FakeSerialPortHandle.Unpaired();
        using var link = SerialPortBusLink.AdoptHandle(handle, new SerialLineSettings("COM7"));

        link.ReadTimeout = 30_000;
        var reading = BlockingWork.Run(() =>
        {
            try { link.Read(new byte[8], 0, 8); return (Exception?)null; }
            catch (Exception ex) { return ex; }
        }, "serial-abort-read");

        // Let it get past the first slice, so the abort lands on a read that is genuinely already blocking.
        await Task.Delay(80);
        Assert.False(reading.IsCompleted);

        var started = Environment.TickCount64;
        link.AbortPendingRead();
        var thrown = await reading.WaitAsync(TimeSpan.FromSeconds(5));
        var elapsed = Environment.TickCount64 - started;

        Assert.IsType<OperationCanceledException>(thrown);
        Assert.True(elapsed < 5_000, $"abort took {elapsed} ms against a 30000 ms read bound");

        // The mechanism, not the clock — the same distinction D-2 drew: a fast failure that closed the port
        // would be indistinguishable from this one by latency alone, and it is the thing this design forbids.
        Assert.True(handle.IsOpen);
        Assert.True(link.IsOpen);

        // And the link is reusable afterwards, which is what "the bus survived" actually means.
        link.ResetAbort();
        link.ReadTimeout = 60;
        Assert.Throws<TimeoutException>(() => link.Read(new byte[8], 0, 8));
    }

    /// <summary>
    /// 🔴 <b>Review I-1.</b> A zero-length read must be answered without touching the port. Measured,
    /// <c>SerialPort.Read(buffer, offset, 0)</c> returns 0 <i>without waiting</i> (0.46 ms; a bare loop over it
    /// ran at 33 million iterations/second), so before the guard the link's loop span at full tilt holding the
    /// bus's arbitration lock — and with a non-positive <see cref="IModbusBusLink.ReadTimeout"/>, forever.
    ///
    /// <para>The discriminator is the second assertion: the port is CLOSED, so any implementation that reached
    /// the handle at all would throw <see cref="InvalidOperationException"/>. Returning 0 therefore proves the
    /// guard answered before the port was consulted, rather than merely that the call was fast.</para>
    /// </summary>
    [Fact]
    public void Read_WithAZeroLengthCount_ReturnsImmediately_WithoutTouchingThePort()
    {
        var handle = FakeSerialPortHandle.Unpaired();
        handle.Dispose();   // a port that would throw on any access
        using var link = SerialPortBusLink.AdoptHandle(handle, new SerialLineSettings("COM7"));

        link.ReadTimeout = -1;   // no outer deadline: an unguarded loop here never terminates
        Assert.Equal(0, link.Read(new byte[8], 0, 0));
        Assert.Equal(0, handle.ReadCalls);

        // The control: a positive count on the same closed port does reach it and does fail.
        Assert.Throws<InvalidOperationException>(() => link.Read(new byte[8], 0, 8));
    }

    /// <summary>A byte that arrives returns from the read immediately — the slice is what an IDLE read waits,
    /// never a tax on a healthy transaction. Stated in the class's doc comment; asserted here.</summary>
    [Fact]
    public async Task Read_ReturnsAsSoonAsAByteArrives_RatherThanWaitingOutTheSlice()
    {
        var handle = FakeSerialPortHandle.Unpaired();
        using var link = SerialPortBusLink.AdoptHandle(handle, new SerialLineSettings("COM7"));
        link.ReadTimeout = 5_000;

        var buffer = new byte[8];
        var reading = BlockingWork.Run(() => link.Read(buffer, 0, 8), "serial-arrival-read");
        await Task.Delay(50);

        handle.Deliver(0x01, 0x03);
        var n = await reading.WaitAsync(TimeSpan.FromSeconds(5));

        Assert.Equal(2, n);
        Assert.Equal(0x01, buffer[0]);
        Assert.Equal(0x03, buffer[1]);
    }

    /// <summary>
    /// 🔴 <b>A real Modbus RTU frame — real CRC, real t3.5 framing, real slave dispatch by unit id — driven
    /// through THIS transport's own <see cref="SerialPortBusLink.Read"/> and
    /// <see cref="SerialPortBusLink.Write"/>, on both ends.</b>
    ///
    /// <para>D-2's equivalent test drives D-2's in-memory link, so it proves the bus and NModbus, not this
    /// file. This one puts a <see cref="SerialPortBusLink"/> on each end of a paired handle, so every byte of
    /// the request and the response passes through the slice loop, the deadline arithmetic and the drain that
    /// <c>ModbusSerialTransport</c> calls before each request.</para>
    ///
    /// <para><b>What it still does not prove</b> is that a real UART carries those bytes — no baud rate, no
    /// parity, no half duplex. It narrows "no Modbus frame has ever traversed this transport" to "no Modbus
    /// frame has ever traversed a real SerialPort", which is a materially smaller claim and the honest one.</para>
    /// </summary>
    [Fact]
    public async Task AnRtuFrameRoundTripsThroughThisLinksOwnReadAndWrite()
    {
        var handles = FakeSerialPortHandlePair.Create();
        var line = new SerialLineSettings("COM7");
        using var masterLink = SerialPortBusLink.AdoptHandle(handles.Master, line);
        using var deviceLink = SerialPortBusLink.AdoptHandle(handles.Device, line);

        var factory = new NModbus.ModbusFactory();
        var network = factory.CreateRtuSlaveNetwork(deviceLink);
        var slave = factory.CreateSlave(unitId: 7);
        slave.DataStore.HoldingRegisters.WritePoints(0, new ushort[] { 235, 0xFFFF });
        network.AddSlave(slave);

        using var listenCts = new CancellationTokenSource();
        // ListenAsync blocks its caller synchronously and must not come off the pool — see BlockingWork.
        var listening = BlockingWork.RunAsync(() => network.ListenAsync(listenCts.Token), "serial-rtu-slave");

        try
        {
            var transport = factory.CreateRtuTransport(masterLink);
            transport.ReadTimeout = 5_000;
            transport.WriteTimeout = 5_000;
            transport.Retries = 0;
            using var master = factory.CreateMaster(transport);

            var registers = await master.ReadHoldingRegistersAsync(slaveAddress: 7, startAddress: 0, numberOfPoints: 2);

            Assert.Equal(2, registers.Length);
            Assert.Equal(235, registers[0]);
            Assert.Equal(0xFFFF, registers[1]);
        }
        finally
        {
            await listenCts.CancelAsync();
            handles.Device.Dispose();
            try { await listening.WaitAsync(TimeSpan.FromSeconds(5)); } catch { /* best-effort teardown */ }
            network.Dispose();
        }
    }

    /// <summary>
    /// 🔴 <b>Review I-2 — the slice pin is a property of the TYPE, not of one factory.</b> It used to live in
    /// <see cref="SerialPortBusLink.CreatePort"/>, so a link built any other way kept
    /// <see cref="SerialPort"/>'s own default of -1 (<see cref="SerialPort.InfiniteTimeout"/>) — the unbounded
    /// blocking read measured as releasable by nothing but <c>Dispose()</c>, i.e. Đợt B's forbidden mechanism
    /// on a shared bus. All three mutations defending the pin targeted the factory, so the evidence had a hole
    /// the same shape as the code.
    ///
    /// <para>The first assertion is the discriminating one: the factory deliberately leaves the BCL default in
    /// place, so the pin observed afterwards can only have come from the constructor.</para>
    /// </summary>
    [Fact]
    public void EveryLink_PinsThePortsReadTimeoutToOneSlice_HoweverItWasConstructed()
    {
        var line = new SerialLineSettings("COM7");

        using var port = SerialPortBusLink.CreatePort(line);
        Assert.Equal(SerialPort.InfiniteTimeout, port.ReadTimeout);

        using (SerialPortBusLink.Adopt(port, line))
        {
            Assert.Equal(SerialPortBusLink.ReadSliceMs, port.ReadTimeout);
        }

        var handle = FakeSerialPortHandle.Unpaired();
        Assert.Equal(SerialPort.InfiniteTimeout, handle.ReadTimeout);
        using (SerialPortBusLink.AdoptHandle(handle, line))
        {
            Assert.Equal(SerialPortBusLink.ReadSliceMs, handle.ReadTimeout);
        }
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
    public async Task TwoConnectorsOnOneSerialLine_ShareOneBus_AndInvokeTheOpenerOnce()
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
    public async Task TwoConnectorsThatDisagreeAboutTheLine_GetTwoBuses_AndInvokeTheOpenerTwice()
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
