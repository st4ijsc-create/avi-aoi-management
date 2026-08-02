using System.Diagnostics;
using System.IO.Ports;
using System.Reflection;
using St4i.EdgeCore.Drivers.Modbus;

namespace St4i.SerialBench;

/// <summary>
/// Task D-3 review — <b>the bench acceptance checklist for the native serial transport.</b>
///
/// <para>Every number in task-3-report.md §2 was measured by a probe that was never committed, so nothing in
/// it could be re-run. This is that probe, committed and parameterised. It exists for two moments: the first
/// time this transport meets a real RS-485 device, and any time somebody doubts a figure in the report.</para>
///
/// <para><b>It is not a test project</b> — see the .csproj for why that is load-bearing rather than
/// incidental.</para>
///
/// <code>
///   dotnet run --project tools/serial-bench -- --port COM3
///   dotnet run --project tools/serial-bench -- --port COM3 --baud 9600 --parity None --stopbits 2
///   dotnet run --project tools/serial-bench -- --port COM3 --loopback     # TX tied to RX, or a device echoes
///   dotnet run --project tools/serial-bench -- --port COM3 --unit 1       # a real RTU slave answers at unit 1
///   dotnet run --project tools/serial-bench -- --port COM3 --unplug       # prompts you to yank the adapter
/// </code>
/// </summary>
internal static class Program
{
    private static int _pass;
    private static int _fail;
    private static int _skip;

    private static int Main(string[] args)
    {
        var options = BenchOptions.Parse(args);
        if (options is null) return 2;

        Console.WriteLine($"St4i serial bench — {options.Line.Describe()}");
        Console.WriteLine($"ports visible to this machine: {string.Join(", ", SerialPort.GetPortNames())}");
        Console.WriteLine(new string('-', 78));

        Il();
        AbsentPort();
        if (!PortOpens(options.Line)) { Summary(); return _fail == 0 ? 0 : 1; }

        ExclusiveOpen(options.Line);
        BlockingReadIsReleasableOnlyByDispose(options.Line);
        SliceQuantisation(options.Line);
        AbortLeavesThePortOpen(options.Line);
        BoundedReadHonoursItsDeadline(options.Line);
        OpenCloseCost(options.Line);
        Loopback(options);
        RtuRoundTrip(options);
        Unplug(options);

        Summary();
        return _fail == 0 ? 0 : 1;
    }

    // ── the checklist ────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The one check that needs no port at all: the claim the brief asked to verify rather than
    /// trust. Reported here too so a single bench run reproduces the whole of report §0.2.</summary>
    private static void Il()
    {
        var nmodbus = typeof(NModbus.IModbusFactory).Assembly;
        foreach (var t in nmodbus.GetTypes().Where(t =>
                     typeof(NModbus.IO.IStreamResource).IsAssignableFrom(t) && t is { IsInterface: false, IsAbstract: false }))
        {
            var m = t.GetMethod("DiscardInBuffer", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
            Console.WriteLine($"      NModbus.{t.Name}.DiscardInBuffer IL = {IlLength(m)}");
        }

        var spDiscard = typeof(SerialPort).GetMethod(nameof(SerialPort.DiscardInBuffer));
        var streamType = typeof(SerialPort).Assembly.GetType("System.IO.Ports.SerialStream");
        var ssDiscard = streamType?.GetMethod("DiscardInBuffer", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
        var ssFlush = streamType?.GetMethod("Flush", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance, Type.EmptyTypes);

        Console.WriteLine($"      SerialPort.DiscardInBuffer   IL = {IlLength(spDiscard)}");
        Console.WriteLine($"      SerialStream.DiscardInBuffer IL = {IlLength(ssDiscard)} -> {string.Join(", ", Callees(ssDiscard).Select(c => c.Name))}");
        Console.WriteLine($"      SerialStream.Flush           IL = {IlLength(ssFlush)} -> {string.Join(", ", Callees(ssFlush).Select(c => c.Name))}");

        Check("SerialPort.DiscardInBuffer is a real purge, not an empty body",
            Callees(ssDiscard).Any(c => c.Name == "PurgeComm"));

        // Review I-4: the flush that DOES exist is the wrong one — it pushes the driver's buffer at the device
        // and says nothing about the UART shift register, so it is still not a transmit-complete signal. The
        // limitation stands; its premise had to be corrected.
        Check("the only flush reachable from SerialPort is FlushFileBuffers (driver buffer, not the wire) — " +
              "so manual RS-485 direction control remains unimplementable",
            Callees(ssFlush).Any(c => c.Name == "FlushFileBuffers"));
    }

    private static void AbsentPort()
    {
        var present = new HashSet<string>(SerialPort.GetPortNames(), StringComparer.OrdinalIgnoreCase);
        var absent = Enumerable.Range(90, 160).Select(i => $"COM{i}").FirstOrDefault(n => !present.Contains(n));
        if (absent is null) { Skip("an absent port name could not be derived"); return; }

        try
        {
            SerialPortBusLink.OpenAsync(new SerialLineSettings(absent), CancellationToken.None).GetAwaiter().GetResult();
            Check($"opening the absent {absent} fails", false);
        }
        catch (SerialPortUnavailableException ex)
        {
            Console.WriteLine($"      {ex.InnerException?.GetType().Name}: {ex.InnerException?.Message}");
            Check($"opening the absent {absent} throws SerialPortUnavailableException naming the line",
                ex.Message.Contains(absent, StringComparison.Ordinal));
        }
        catch (Exception ex)
        {
            Check($"opening the absent {absent} throws SerialPortUnavailableException (got {ex.GetType().Name})", false);
        }
    }

    private static bool PortOpens(SerialLineSettings line)
    {
        try
        {
            using var link = SerialPortBusLink.OpenAsync(line, CancellationToken.None).GetAwaiter().GetResult();
            Check($"{line.PortName} opens and reports IsOpen", link.IsOpen);
            return true;
        }
        catch (Exception ex)
        {
            Check($"{line.PortName} opens ({ex.GetType().Name}: {ex.Message})", false);
            return false;
        }
    }

    /// <summary>D-1's premise, and the reason the reference-counted seam is mandatory rather than tidy.</summary>
    private static void ExclusiveOpen(SerialLineSettings line)
    {
        using var first = SerialPortBusLink.OpenAsync(line, CancellationToken.None).GetAwaiter().GetResult();
        try
        {
            using var second = SerialPortBusLink.OpenAsync(line, CancellationToken.None).GetAwaiter().GetResult();
            Check("a second open of the same port is refused", false);
        }
        catch (SerialPortUnavailableException ex)
        {
            Console.WriteLine($"      {ex.InnerException?.GetType().Name}: {ex.InnerException?.Message}");
            Check("a second open of the same port is refused — so N drivers on one segment MUST share one link", true);
        }
    }

    /// <summary>🔴 The negative control for this whole transport's design. If this ever stops being true, the
    /// slice loop is unnecessary; while it is true, the slice loop is the only way to honour a cancellation
    /// without destroying a shared bus.</summary>
    private static void BlockingReadIsReleasableOnlyByDispose(SerialLineSettings line)
    {
        var port = new SerialPort(line.PortName, line.BaudRate, line.Parity, line.DataBits, line.StopBits)
        {
            ReadTimeout = SerialPort.InfiniteTimeout,
        };
        port.Open();

        var done = new ManualResetEventSlim(false);
        var outcome = "still blocked";
        var thread = new Thread(() =>
        {
            try { port.Read(new byte[8], 0, 8); outcome = "returned"; }
            catch (Exception ex) { outcome = ex.GetType().Name; }
            finally { done.Set(); }
        })
        { IsBackground = true };
        thread.Start();

        var stillBlocked = !done.Wait(500);
        var sw = Stopwatch.StartNew();
        port.Dispose();
        var released = done.Wait(5000);
        sw.Stop();

        Console.WriteLine($"      after 500 ms: {(stillBlocked ? "STILL BLOCKED" : outcome)}; Dispose released it in {sw.Elapsed.TotalMilliseconds:F2} ms as {outcome}");
        Check("an unbounded SerialPort.Read is released by NOTHING but Dispose() — i.e. Đợt B's mechanism, " +
              "which blueprint §2.1 forbids on a shared bus", stillBlocked && released);
    }

    /// <summary>Why the slice is 20 ms and not 5. Windows quantises serial read timeouts to the scheduler
    /// tick, so anything below ~15 ms buys nothing.</summary>
    private static void SliceQuantisation(SerialLineSettings line)
    {
        foreach (var slice in new[] { 5, 10, 20, 50 })
        {
            using var port = new SerialPort(line.PortName, line.BaudRate, line.Parity, line.DataBits, line.StopBits)
            {
                ReadTimeout = slice,
            };
            port.Open();

            var samples = new List<double>();
            for (var i = 0; i < 5; i++)
            {
                var sw = Stopwatch.StartNew();
                try { port.Read(new byte[8], 0, 8); } catch (TimeoutException) { }
                samples.Add(sw.Elapsed.TotalMilliseconds);
            }

            Console.WriteLine($"      configured {slice,2} ms -> actual {string.Join(", ", samples.Select(s => s.ToString("F2")))}");
        }

        Check("the slice quantisation table was produced", true);
    }

    /// <summary>🔴 The task's central claim: cancelling one device's in-flight read must not tear the line
    /// down for the rest of the bus.</summary>
    private static void AbortLeavesThePortOpen(SerialLineSettings line)
    {
        using var link = SerialPortBusLink.OpenAsync(line, CancellationToken.None).GetAwaiter().GetResult();
        link.ReadTimeout = 30_000;

        var latencies = new List<double>();
        var stayedOpen = true;

        for (var round = 0; round < 3; round++)
        {
            link.ResetAbort();
            Exception? thrown = null;
            var done = new ManualResetEventSlim(false);
            var thread = new Thread(() =>
            {
                try { link.Read(new byte[8], 0, 8); }
                catch (Exception ex) { thrown = ex; }
                finally { done.Set(); }
            })
            { IsBackground = true };
            thread.Start();

            Thread.Sleep(300);
            var sw = Stopwatch.StartNew();
            link.AbortPendingRead();
            done.Wait(5000);
            sw.Stop();

            latencies.Add(sw.Elapsed.TotalMilliseconds);
            stayedOpen &= link.IsOpen && thrown is OperationCanceledException;
            Console.WriteLine($"      round {round}: {thrown?.GetType().Name} after {sw.Elapsed.TotalMilliseconds:F2} ms; IsOpen = {link.IsOpen}");
        }

        link.ResetAbort();
        link.ReadTimeout = 200;
        var reusable = false;
        try { link.Read(new byte[8], 0, 8); } catch (TimeoutException) { reusable = true; } catch { /* anything else is a failure */ }

        Check($"an in-flight read aborts in {latencies.Min():F2}–{latencies.Max():F2} ms against a 30000 ms bound, " +
              "the port stays OPEN, and the same link reads again afterwards", stayedOpen && reusable);
    }

    /// <summary>
    /// 🔴 <b>The first version of this check asserted <c>elapsed &gt;= 250</c> and FAILED on its first run at
    /// 244.86 ms. The assertion was wrong, not the code, and the mechanism is worth writing down because it is
    /// a property of the shipped product rather than of this bench.</b>
    ///
    /// <para>Both <see cref="SerialPortBusLink"/> and D-2's <c>GatewayTcpBusLink</c> build their read deadline
    /// from <see cref="Environment.TickCount64"/>, which on this machine advances in <b>15/16 ms steps</b>
    /// (measured: 26 advances in 400 ms, mean 15.62 ms). Start and comparison both read that coarse clock, so
    /// a nominal <c>N</c> ms bound expires anywhere in <c>(N − 15.6, N + 15.6)</c> — the observed 5.1 ms early
    /// exit is comfortably inside one tick.</para>
    ///
    /// <para>Not "fixed" in the transport: a <see cref="Stopwatch"/>-based deadline would be exact, and would
    /// make this link differ from its sibling on the same seam for a 6% effect on the smallest bound the map
    /// permits (1000 ms) — the divergence would cost more than the precision buys. <b>What it does mean is
    /// that a configured <c>ReadTimeoutMs</c> is accurate to ±1 system tick and can expire slightly early</b>,
    /// which is worth knowing when sizing one for a slow gateway. The assertion below therefore allows one
    /// tick, and the check that carries the weight is the other one: it did not give up at the 20 ms
    /// slice.</para>
    /// </summary>
    private static void BoundedReadHonoursItsDeadline(SerialLineSettings line)
    {
        const int Bound = 250;
        const int OneTickMs = 16;

        using var link = SerialPortBusLink.OpenAsync(line, CancellationToken.None).GetAwaiter().GetResult();
        link.ReadTimeout = Bound;

        var sw = Stopwatch.StartNew();
        var threw = false;
        try { link.Read(new byte[8], 0, 8); } catch (TimeoutException) { threw = true; }
        sw.Stop();

        Console.WriteLine($"      TimeoutException after {sw.Elapsed.TotalMilliseconds:F2} ms " +
                          $"(configured {Bound}; Environment.TickCount64 granularity is ~15.6 ms, so ±1 tick is expected)");
        Check("a read against a silent line gives up at ITS deadline (±1 system tick), not at the slice boundary",
            threw && sw.Elapsed.TotalMilliseconds >= Bound - OneTickMs);
    }

    private static void OpenCloseCost(SerialLineSettings line)
    {
        var sw = Stopwatch.StartNew();
        for (var i = 0; i < 5; i++)
        {
            using var link = SerialPortBusLink.OpenAsync(line, CancellationToken.None).GetAwaiter().GetResult();
        }
        sw.Stop();

        Console.WriteLine($"      5 open+close cycles in {sw.Elapsed.TotalMilliseconds:F2} ms " +
                          $"({sw.Elapsed.TotalMilliseconds / 5:F2} ms each) — the cost of a link rebuild");
        Check("the open+close cost was measured", true);
    }

    /// <summary>🔴 Needs TX tied to RX (a loopback plug) or a device that echoes. This is the check CI cannot
    /// have: that <see cref="SerialPortBusLink.DrainBufferedInput"/> counts REAL bytes off a REAL UART.</summary>
    private static void Loopback(BenchOptions options)
    {
        if (!options.Loopback) { Skip("--loopback not given: the drain's count against real bytes is UNVERIFIED"); return; }

        using var link = SerialPortBusLink.OpenAsync(options.Line, CancellationToken.None).GetAwaiter().GetResult();
        link.WriteTimeout = 1_000;

        Console.WriteLine($"      drained {link.DrainBufferedInput()} stale byte(s) before starting");
        var payload = new byte[] { 1, 3, 0, 0, 0, 1, 0x84, 0x0A };
        link.Write(payload, 0, payload.Length);
        Thread.Sleep(300);

        var drained = link.DrainBufferedInput();
        Console.WriteLine($"      wrote {payload.Length} bytes, drained {drained} back");
        Check($"DrainBufferedInput reports the true count off a real UART ({drained} of {payload.Length})",
            drained == payload.Length);
        Check("a second drain of a quiet line reports 0", link.DrainBufferedInput() == 0);
    }

    /// <summary>🔴 The moment this transport actually becomes a product: a real RTU frame, over real copper,
    /// to a real slave. Everything else in this task is inference until this prints PASS.</summary>
    private static void RtuRoundTrip(BenchOptions options)
    {
        if (options.UnitId is not { } unitId) { Skip("--unit not given: NO RTU FRAME HAS CROSSED REAL COPPER"); return; }

        using var link = SerialPortBusLink.OpenAsync(options.Line, CancellationToken.None).GetAwaiter().GetResult();
        var factory = new NModbus.ModbusFactory();

        // NModbus 3.0.83: CreateRtuTransport is an extension method (NModbus.ModbusFactoryExtensions), not an
        // IModbusFactory member — the same fact blueprint §2 records for CreateRtuMaster.
        var transport = factory.CreateRtuTransport(link);
        transport.ReadTimeout = options.ReadTimeoutMs;
        transport.WriteTimeout = options.ReadTimeoutMs;

        // Đợt B's no-implicit-retry rule is a WRITE-path rule; this is a read, so it uses the read path's
        // default of 1 exactly as ModbusRtuDriver does. D-5 must pass 0 per write call.
        transport.Retries = 1;

        using var master = factory.CreateMaster(transport);
        try
        {
            var sw = Stopwatch.StartNew();
            var registers = master.ReadHoldingRegistersAsync(unitId, options.Address, 1).GetAwaiter().GetResult();
            sw.Stop();
            Console.WriteLine($"      unit {unitId} register {options.Address} = {registers[0]} in {sw.Elapsed.TotalMilliseconds:F2} ms");
            Check($"a Modbus RTU frame round-trips over real copper to unit {unitId}", registers.Length == 1);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"      {ex.GetType().Name}: {ex.Message}");
            Check($"a Modbus RTU frame round-trips over real copper to unit {unitId}", false);
        }
    }

    /// <summary>🔴 The only way to close the surviving M28 mutation: it diverges from the shipped code only
    /// when <c>Dispose()</c> itself throws, which a virtual COM pair cannot produce and a yanked USB adapter
    /// can. Interactive by necessity.</summary>
    private static void Unplug(BenchOptions options)
    {
        if (!options.Unplug) { Skip("--unplug not given: the vanished-adapter path is UNVERIFIED (mutation M28)"); return; }

        using var link = SerialPortBusLink.OpenAsync(options.Line, CancellationToken.None).GetAwaiter().GetResult();
        Console.WriteLine($"      {options.Line.PortName} is open. UNPLUG THE ADAPTER NOW, then press Enter.");
        Console.ReadLine();

        Console.WriteLine($"      IsOpen after the unplug = {link.IsOpen}");
        try
        {
            var drained = link.DrainBufferedInput();
            Console.WriteLine($"      DrainBufferedInput returned {drained}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"      DrainBufferedInput threw {ex.GetType().Name}: {ex.Message}");
        }

        link.ReadTimeout = 500;
        try
        {
            link.Read(new byte[8], 0, 8);
            Console.WriteLine("      Read returned");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"      Read threw {ex.GetType().Name}: {ex.Message}");
        }

        Check("the vanished-adapter path was exercised — record which exception surfaced and whether IsOpen " +
              "went false, then update task-3-report.md §2.5", true);
    }

    // ── plumbing ─────────────────────────────────────────────────────────────────────────────────────────

    private static void Check(string what, bool ok)
    {
        if (ok) { _pass++; Console.WriteLine($"PASS  {what}"); }
        else { _fail++; Console.WriteLine($"FAIL  {what}"); }
    }

    private static void Skip(string what)
    {
        _skip++;
        Console.WriteLine($"SKIP  {what}");
    }

    private static void Summary()
    {
        Console.WriteLine(new string('-', 78));
        Console.WriteLine($"{_pass} passed, {_fail} failed, {_skip} skipped.");
        if (_skip > 0)
        {
            Console.WriteLine("A SKIP is not a pass. Anything skipped above is still untested against hardware,");
            Console.WriteLine("and task-3-report.md's untested list should keep saying so until it is not.");
        }
    }

    private static int IlLength(MethodBase? m) => m?.GetMethodBody()?.GetILAsByteArray()?.Length ?? -1;

    private static List<MethodBase> Callees(MethodBase? method)
    {
        var found = new List<MethodBase>();
        var il = method?.GetMethodBody()?.GetILAsByteArray();
        if (il is null || method is null) return found;

        for (var i = 0; i < il.Length; i++)
        {
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
            catch { /* a token this scan mis-framed, or one in another module */ }

            i += 4;
        }

        return found;
    }
}

internal sealed record BenchOptions(
    SerialLineSettings Line, bool Loopback, byte? UnitId, ushort Address, int ReadTimeoutMs, bool Unplug)
{
    public static BenchOptions? Parse(string[] args)
    {
        string? port = null;
        var baud = SerialLineSettings.DefaultBaudRate;
        var parity = SerialLineSettings.DefaultParity;
        var stopBits = SerialLineSettings.DefaultStopBits;
        var loopback = false;
        var unplug = false;
        byte? unit = null;
        ushort address = 0;
        var readTimeoutMs = 1_000;

        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--port": port = Next(args, ref i); break;
                case "--baud": baud = int.Parse(Next(args, ref i)!); break;
                case "--parity": parity = Enum.Parse<Parity>(Next(args, ref i)!, ignoreCase: true); break;
                case "--stopbits": stopBits = Enum.Parse<StopBits>(StopBitsName(Next(args, ref i)!), ignoreCase: true); break;
                case "--unit": unit = byte.Parse(Next(args, ref i)!); break;
                case "--address": address = ushort.Parse(Next(args, ref i)!); break;
                case "--timeout": readTimeoutMs = int.Parse(Next(args, ref i)!); break;
                case "--loopback": loopback = true; break;
                case "--unplug": unplug = true; break;
                case "--help" or "-h": Usage(); return null;
                default:
                    Console.Error.WriteLine($"unknown argument: {args[i]}");
                    Usage();
                    return null;
            }
        }

        port ??= SerialPort.GetPortNames().FirstOrDefault();
        if (port is null)
        {
            Console.Error.WriteLine("no serial port given and none present on this machine — pass --port COMn.");
            return null;
        }

        try
        {
            return new BenchOptions(new SerialLineSettings(port, baud, parity, 8, stopBits),
                loopback, unit, address, readTimeoutMs, unplug);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"{ex.GetType().Name}: {ex.Message}");
            return null;
        }
    }

    private static string StopBitsName(string raw) => raw switch
    {
        "1" => nameof(StopBits.One),
        "2" => nameof(StopBits.Two),
        "1.5" => nameof(StopBits.OnePointFive),
        _ => raw,
    };

    private static string? Next(string[] args, ref int i) =>
        ++i < args.Length ? args[i] : throw new ArgumentException($"{args[i - 1]} needs a value");

    private static void Usage()
    {
        Console.WriteLine("""
            St4i serial bench — the hardware half of task D-3's evidence.

              --port COMn        the port to drive (default: the first one this machine reports)
              --baud N           default 19200 (MODBUS over Serial Line V1.02 §2.5.1)
              --parity N|O|E     default Even (the specification's default parity mode)
              --stopbits 1|2     default 1
              --unit N           a real RTU slave address to read from — WITHOUT THIS, NO FRAME
                                 CROSSES REAL COPPER and the run says so
              --address N        holding register to read (default 0)
              --timeout MS       per-read bound for the RTU round trip (default 1000)
              --loopback         TX is tied to RX, or a device echoes: enables the drain-count check
              --unplug           interactive — prompts you to yank the adapter mid-run

            Exit code 0 when nothing FAILED. A SKIP is not a pass.
            """);
    }
}
