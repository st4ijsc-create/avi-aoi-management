using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using NModbus;
using NModbus.IO;
using St4i.EdgeCore.Drivers.Modbus;
using Xunit;
using Xunit.Abstractions;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// Task D-2 — the RTU-over-TCP transport: a real socket, a real gateway peer, and the two capabilities
/// NModbus's own <c>TcpClientAdapter</c> does not provide.
/// </summary>
public class GatewayTcpBusLinkTests(ITestOutputHelper output) : IAsyncLifetime
{
    private TcpListener? _listener;
    private readonly List<IDisposable> _disposables = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public Task DisposeAsync()
    {
        foreach (var d in _disposables) { try { d.Dispose(); } catch { /* best-effort teardown */ } }
        try { _listener?.Stop(); } catch { /* best-effort teardown */ }
        return Task.CompletedTask;
    }

    /// <summary>Connects a client to a fresh loopback listener on a DYNAMIC port (never a fixed one — this
    /// repo has known fixed-port flakiness) and returns both ends.</summary>
    private async Task<(TcpClient Client, TcpClient Server, int Port)> ConnectPairAsync()
    {
        _listener ??= NewListener();
        var port = ((IPEndPoint)_listener.LocalEndpoint).Port;
        var client = new TcpClient();
        await client.ConnectAsync(IPAddress.Loopback, port);
        var server = await _listener.AcceptTcpClientAsync();
        _disposables.Add(client);
        _disposables.Add(server);
        return (client, server, port);
    }

    private TcpListener NewListener()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        return listener;
    }

    /// <summary>
    /// 🔴 The reason this transport does not reuse NModbus's own adapter, pinned as a test rather than left
    /// in a report. Both adapters are given the SAME socket state — stale bytes buffered — and asked to purge
    /// it. This is a HEAD-TO-HEAD assertion on purpose: if a future NModbus fixes <c>TcpClientAdapter</c>,
    /// this test fails and tells us the divergence is over, instead of silently justifying a class we no
    /// longer need.
    ///
    /// <para>Why it matters: <c>ModbusSerialTransport</c> calls <c>DiscardInBuffer()</c> once before every
    /// request attempt, and on RTU that is the only built-in defence against a stale frame — an RTU response
    /// carries no transaction id, so a stale one that matches on slave address, function code and length is
    /// returned to the caller as the answer (see
    /// <see cref="ModbusBusResynchronisationTests.RawNModbus_WhenAFrameLandsJustAfterTheRequest_ReturnsItAsThatRequestsAnswer"/>).</para>
    /// </summary>
    [Fact]
    public async Task DiscardInBuffer_ActuallyDiscards_UnlikeNModbusOwnTcpClientAdapter()
    {
        var stale = new byte[] { 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08 };
        const byte fresh = 0xAA;

        // ── NModbus's own adapter ────────────────────────────────────────────
        var (nmClient, nmServer, _) = await ConnectPairAsync();
        var nmodbusAdapter = new TcpClientAdapter(nmClient) { ReadTimeout = 2_000, WriteTimeout = 2_000 };
        await nmServer.GetStream().WriteAsync(stale);
        await nmServer.GetStream().FlushAsync();
        await WaitUntilAsync(() => nmClient.Available >= stale.Length, "the stale bytes to reach NModbus's adapter");

        nmodbusAdapter.DiscardInBuffer();

        await nmServer.GetStream().WriteAsync(new[] { fresh });
        await nmServer.GetStream().FlushAsync();
        await WaitUntilAsync(() => nmClient.Available > 0, "a readable byte for NModbus's adapter");
        var nmBuffer = new byte[16];
        var nmRead = nmodbusAdapter.Read(nmBuffer, 0, 1);

        output.WriteLine($"NModbus TcpClientAdapter: read {nmRead} byte(s), first = 0x{nmBuffer[0]:X2}");
        Assert.Equal(stale[0], nmBuffer[0]);   // the STALE byte survived — DiscardInBuffer did nothing

        // ── ours, same scenario ──────────────────────────────────────────────
        var (ourClient, ourServer, _) = await ConnectPairAsync();
        var ours = MakeLink(ourClient);
        ours.ReadTimeout = 2_000;
        ours.WriteTimeout = 2_000;
        await ourServer.GetStream().WriteAsync(stale);
        await ourServer.GetStream().FlushAsync();
        await WaitUntilAsync(() => ourClient.Available >= stale.Length, "the stale bytes to reach our link");

        // 🔴 Through DiscardInBuffer — the SAME member NModbus's transport calls, and the same one invoked on
        // its adapter above. Found by mutation: this used to call DrainBufferedInput() directly, so a mutant
        // that emptied `DiscardInBuffer()` into a no-op — i.e. made this class behave EXACTLY like NModbus's
        // adapter, the one defect the whole class exists to fix — survived with every test green. The test
        // proved the drain worked and never proved NModbus's hook was wired to it.
        ours.DiscardInBuffer();
        Assert.Equal(0, ourClient.Available);

        // And the count, which is the second thing IModbusBusLink adds and which ModbusBus's quiet window
        // depends on. Re-primed, because DiscardInBuffer above already cleared the buffer.
        await ourServer.GetStream().WriteAsync(stale);
        await ourServer.GetStream().FlushAsync();
        await WaitUntilAsync(() => ourClient.Available >= stale.Length, "the stale bytes to reach our link again");
        var discarded = ours.DrainBufferedInput();
        Assert.Equal(stale.Length, discarded);
        Assert.Equal(0, ourClient.Available);

        await ourServer.GetStream().WriteAsync(new[] { fresh });
        await ourServer.GetStream().FlushAsync();
        var ourBuffer = new byte[16];
        var ourRead = ours.Read(ourBuffer, 0, 1);

        output.WriteLine($"GatewayTcpBusLink: read {ourRead} byte(s), first = 0x{ourBuffer[0]:X2}, discarded {discarded}");
        Assert.Equal(fresh, ourBuffer[0]);
    }

    /// <summary>
    /// 🔴 An in-flight read is aborted promptly and <b>the socket survives</b> — the whole point of the task.
    /// The load-bearing assertion is the second read succeeding on the SAME link object afterwards; a
    /// mechanism that closed the socket to unblock the first read could not do that.
    /// </summary>
    [Fact]
    public async Task AbortPendingRead_UnblocksAnInFlightRead_WithoutClosingTheSocket()
    {
        var (client, server, _) = await ConnectPairAsync();
        var link = MakeLink(client);
        link.ReadTimeout = 30_000;   // if abort fell back to the timeout, this test would take 30 s

        var buffer = new byte[16];
        var blocked = BlockingWork.Run(() => link.Read(buffer, 0, 1), "blocked-gateway-read");

        // Give the read time to genuinely enter its wait rather than aborting before it starts.
        await Task.Delay(150);
        Assert.False(blocked.IsCompleted, "the read must actually be blocked before this test aborts it");

        var sw = Stopwatch.StartNew();
        link.AbortPendingRead();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => blocked);
        sw.Stop();
        output.WriteLine($"GatewayTcpBusLink.AbortPendingRead unblocked a read in {sw.Elapsed.TotalMilliseconds:F2} ms " +
                         $"(the read's own bound was 30000 ms)");

        Assert.True(link.IsOpen, "the socket must survive an abort");
        Assert.True(sw.ElapsedMilliseconds < 2_000, $"expected a prompt abort, took {sw.ElapsedMilliseconds} ms");

        // The proof the link is genuinely still usable, not merely reporting that it is.
        link.ResetAbort();
        await server.GetStream().WriteAsync(new byte[] { 0x5A });
        await server.GetStream().FlushAsync();
        link.ReadTimeout = 5_000;
        var read = link.Read(buffer, 0, 1);
        Assert.Equal(1, read);
        Assert.Equal(0x5A, buffer[0]);
    }

    /// <summary>A silent gateway produces a bounded <see cref="TimeoutException"/> — the type NModbus's
    /// transport treats as the retry-eligible "no answer" signal, not an <see cref="IOException"/>. Both the
    /// bound and the exception type matter: the bound is what stops a hung gateway pinning a thread forever
    /// (the defect GP-6b closed for the TCP driver), the type is what keeps <c>Transport.Retries</c>
    /// behaving as configured.</summary>
    [Fact]
    public async Task Read_AgainstASilentGateway_TimesOutWithinItsBound()
    {
        var (client, _, _) = await ConnectPairAsync();
        var link = MakeLink(client);
        link.ReadTimeout = 300;

        var buffer = new byte[16];
        var sw = Stopwatch.StartNew();

        // On its own thread and bounded, so a link that ignores its deadline FAILS this test rather than
        // hanging it. Found by mutation: `&& false` on the deadline check produced no verdict at all, because
        // the read never returned and the run was killed — a hang names nothing, a failure names the defect.
        var read = BlockingWork.Run(() => link.Read(buffer, 0, 1), "silent-gateway-read");
        var settled = await Task.WhenAny(read, Task.Delay(TimeSpan.FromSeconds(15)));
        Assert.Same(read, settled);
        await Assert.ThrowsAsync<TimeoutException>(() => read);
        sw.Stop();
        output.WriteLine($"silent-gateway read timed out after {sw.Elapsed.TotalMilliseconds:F2} ms (bound 300 ms)");

        Assert.True(sw.ElapsedMilliseconds >= 250, $"timed out too early ({sw.ElapsedMilliseconds} ms) — the bound was not honoured");
        Assert.True(sw.ElapsedMilliseconds < 5_000, $"timed out far too late ({sw.ElapsedMilliseconds} ms)");
        Assert.True(link.IsOpen, "a timeout must not close the link — that decision belongs to ModbusBus");
    }

    /// <summary>A gateway that hangs up mid-transaction is an <see cref="IOException"/>, not a silent
    /// zero-length read that NModbus would try to frame.</summary>
    [Fact]
    public async Task Read_WhenTheGatewayHangsUp_ThrowsIoException()
    {
        var (client, server, _) = await ConnectPairAsync();
        var link = MakeLink(client);
        link.ReadTimeout = 5_000;

        server.Close();

        var buffer = new byte[16];
        Assert.Throws<IOException>(() => link.Read(buffer, 0, 1));
    }

    [Fact]
    public async Task Dispose_ClosesTheSocket_AndIsIdempotent()
    {
        var (client, _, _) = await ConnectPairAsync();
        var link = MakeLink(client);

        link.Dispose();
        link.Dispose();

        Assert.False(link.IsOpen);
        Assert.Equal(0, link.DrainBufferedInput());
    }

    /// <summary>
    /// 🔴 End-to-end over a REAL socket: an NModbus RTU slave network listening on the server side of a TCP
    /// connection (exactly what a serial→Ethernet gateway presents), a real <see cref="ModbusBus"/> and a real
    /// <see cref="ModbusRtuDriver"/> on the client side. Everything in between — CRC, t3.5 framing, slave
    /// dispatch — is NModbus's, running for real.
    /// </summary>
    [Fact]
    public async Task RtuOverARealGatewaySocket_ReadsFromAnInProcessRtuSlave()
    {
        var (client, server, port) = await ConnectPairAsync();

        // The "gateway": an RTU slave network speaking raw RTU frames over the server end of the socket.
        var deviceSide = MakeLink(server);
        deviceSide.ReadTimeout = -1;
        var factory = new ModbusFactory();
        var network = factory.CreateRtuSlaveNetwork(deviceSide);
        var slave = factory.CreateSlave(unitId: 3);
        slave.DataStore.HoldingRegisters.WritePoints(0, new ushort[] { 1234, 0xFFFF });
        network.AddSlave(slave);
        using var listenCts = new CancellationTokenSource();
        // ListenAsync blocks its caller synchronously — see ModbusRtuLoopbackHarness's own remarks.
        var listen = BlockingWork.RunAsync(() => network.ListenAsync(listenCts.Token), "gateway-slave-listen");

        try
        {
            // Built here, not inside the opener lambda: the lambda runs on whichever thread reaches the first
            // transaction, and MakeLink's own bookkeeping list is not thread-safe.
            var clientSide = MakeLink(client);

            await using var registry = new ModbusBusRegistry();
            var lease = registry.Acquire(
                GatewayTcpBusLink.CreateBusKey("127.0.0.1", port),
                _ => Task.FromResult(clientSide));

            await using var driver = new ModbusRtuDriver(
                lease,
                ModbusRtuLoopbackHarness.BuildMap("PLC-GATEWAY", unitId: 3, readTimeoutMs: 5_000));

            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
            St4i.Connector.Abstractions.Models.DeviceReading? first = null;
            var readTask = Task.Run(async () =>
            {
                await foreach (var reading in driver.ReadAsync(cts.Token)) { first = reading; return; }
            });

            await WaitUntilAsync(() => first is not null, "an RTU reading over a real gateway socket");

            Assert.Equal("PLC-GATEWAY", first!.MachineCode);
            Assert.Equal(1234.0, (double)first.Telemetry.Single(t => t.Metric == "temperature").Value!, precision: 10);
            Assert.Equal(-0.1, (double)first.Telemetry.Single(t => t.Metric == "pressure").Value!, precision: 10);

            await cts.CancelAsync();
            try { await readTask; } catch (OperationCanceledException) { }
        }
        finally
        {
            await listenCts.CancelAsync();
            try { deviceSide.Dispose(); } catch { /* unblocks the listen loop */ }
            try { await listen.WaitAsync(TimeSpan.FromSeconds(5)); } catch { /* best-effort teardown */ }
            try { network.Dispose(); } catch { /* best-effort teardown */ }
        }
    }

    /// <summary>The bus key is built from the endpoint and nothing else — the rule
    /// <see cref="ModbusBusRegistry"/> depends on for sharing to be correct, and the reason keys are built by
    /// a method rather than interpolated at each call site.</summary>
    [Fact]
    public void CreateBusKey_IsEndpointScoped()
    {
        Assert.Equal(GatewayTcpBusLink.CreateBusKey("10.0.0.5", 502), GatewayTcpBusLink.CreateBusKey("10.0.0.5", 502));
        Assert.NotEqual(GatewayTcpBusLink.CreateBusKey("10.0.0.5", 502), GatewayTcpBusLink.CreateBusKey("10.0.0.5", 503));
        Assert.NotEqual(GatewayTcpBusLink.CreateBusKey("10.0.0.5", 502), GatewayTcpBusLink.CreateBusKey("10.0.0.6", 502));
    }

    /// <summary>
    /// A connect to a port nobody is listening on fails rather than handing back a half-built link.
    ///
    /// <para>🔴 <b>The port is held BOUND but never listening, rather than obtained by starting a listener and
    /// stopping it.</b> The obvious version — grab an ephemeral port, release it, dial it — hands that port
    /// back to the OS, which is free to reassign it to another test's <c>TcpListener</c> before this connect
    /// lands. This connect would then succeed against a stranger's listener and immediately drop, and the
    /// stranger would see a connection reset out of nowhere. That is not hypothetical: a gate run failed
    /// <c>DeviceIdentityStoreTests.Certificate_LoadedFromStore_CanCompleteARealMutualTlsHandshake</c> with
    /// "An existing connection was forcibly closed by the remote host" on its server-side handshake, in a
    /// suite where this test is the only one that ever releases a port it has named. Binding without
    /// listening gives a port that is genuinely unconnectable (the stack answers RST) AND that no other test
    /// can be assigned, which removes the interference instead of making it rarer.</para>
    /// </summary>
    [Fact]
    public async Task ConnectAsync_ToADeadEndpoint_Throws()
    {
        using var held = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
        held.Bind(new IPEndPoint(IPAddress.Loopback, 0));
        var deadPort = ((IPEndPoint)held.LocalEndPoint!).Port;
        // Deliberately no Listen() — bound, so nobody else can take this port, and refusing, so a connect
        // gets a reset rather than a hang.

        await Assert.ThrowsAnyAsync<Exception>(() => GatewayTcpBusLink.ConnectAsync("127.0.0.1", deadPort, CancellationToken.None));
    }

    private IModbusBusLink MakeLink(TcpClient client)
    {
        // GatewayTcpBusLink's constructor is private by design (a link is always built by ConnectAsync, so it
        // can never exist unconnected). These tests need to wrap an ALREADY-connected client — including the
        // server end, which is how the gateway peer is stood up — so they go through the same factory the
        // production opener uses, against a client this test connected itself.
        var link = GatewayTcpBusLink.Adopt(client);
        _disposables.Add(link);
        return link;
    }

    private static async Task WaitUntilAsync(Func<bool> predicate, string because)
    {
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(15);
        while (DateTime.UtcNow < deadline)
        {
            if (predicate()) return;
            await Task.Delay(20);
        }

        Assert.True(predicate(), $"timed out waiting for: {because}");
    }
}
