using System.Net;
using System.Net.Http;
using St4i.DeviceClient;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// WS-C-T5 (capstone) — the literal WS-C acceptance criterion proven end-to-end through the REAL,
/// full DI-path composition (<see cref="FleetHost"/> + <see cref="TransportCoordinator"/> +
/// <see cref="WalFlushPump"/> + <see cref="WalMaintenance"/>, all wired together exactly as
/// <c>St4i.EngineApi/Program.cs</c> wires them), not just at the <see cref="LiveTransport"/> level
/// <c>St4i.EdgeCore.Tests.Transport.LiveTransportWalRestartSurvivalTests</c> (WS-C-T3) already covers:
/// <list type="number">
/// <item>Compose #1 — "before the restart": a real, RUNNING <see cref="FleetHost"/> (the same 10-machine
/// default roster <c>BuildDefaultFleet</c> ships) driven by a <see cref="TransportCoordinator"/> in
/// <see cref="TransportMode.Live"/> whose <see cref="LiveTransport"/> is wired to an OFFLINE (always-throws)
/// <see cref="HttpMessageHandler"/> over a fresh temp WAL directory. A few real cycles buffer real
/// <c>ProcessResult</c> envelopes to the on-disk queue file, and the WS-C-T4 ack-label fix is proven live
/// (not just <c>MachineStateAckLabelTests</c>' synthetic ack): a machine's real
/// <see cref="FleetHost.Snapshot"/> tile (<see cref="FleetTileDto.LastCycleSummary"/> — the same field
/// <c>GET /v1/fleet</c> serves) shows <c>ack:buffered</c>, not the old (pre-fix) "ERR".</item>
/// <item>Compose #2 — "process restart": a BRAND NEW <see cref="FleetHost"/>/<see cref="TransportCoordinator"/>
/// pointed at the SAME temp directory and the SAME gateway machineCode (mirrors
/// <see cref="St4i.EngineApi.Tests.HistorianRestartSurvivalTests"/>'s "just news up a fresh store on the
/// same directory" restart model), this time with a SUCCEEDING handler (server back up). Compose #1's
/// objects are never referenced again — nothing in-memory survives, only the file on disk. A
/// <see cref="WalFlushPump"/> on a short interval — the SAME idle-backlog drain WS-C-T4 built — drains the
/// restart-surviving backlog to zero with no new traffic ever sent through it, and WS-C-T5's own
/// <see cref="WalMaintenance"/> integration rides along on every one of that pump's ticks too (a no-op
/// here: the buffered backlog is nowhere near <see cref="WalOptions.MaxBytes"/>'s default 64 MiB).</item>
/// </list>
///
/// Fast/deterministic by construction, same techniques as <c>LiveTransportWalRestartSurvivalTests</c>/
/// <c>TransportCoordinatorWalTests</c>' fix round 1: both composes build their <see cref="LiveTransport"/>
/// via the RAW <c>new St4iDeviceClient(..., maxRetries: 0, handler: ...)</c> -&gt; <c>new
/// LiveTransport(client)</c> path (never <see cref="TransportCoordinator.RebuildLive"/>'s
/// <see cref="LiveTransport.ForMachine"/>, which has no maxRetries seam and would otherwise spend the
/// SDK's real ~7.5s exponential backoff PER failed send before enqueueing) and an injected
/// <see cref="HttpMessageHandler"/> that throws/succeeds synchronously — no real socket, no OS-timing
/// dependence, whole test runs in well under the bounded 10s poll budget below.
/// </summary>
public sealed class StoreAndForwardRestartSurvivalTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(50);

    private static async Task WaitUntilAsync(Func<bool> predicate, string because)
    {
        var deadline = DateTime.UtcNow + PollTimeout;
        while (DateTime.UtcNow < deadline)
        {
            if (predicate()) return;
            await Task.Delay(PollInterval);
        }

        Assert.True(predicate(), $"timed out after {PollTimeout} waiting for: {because}");
    }

    /// <summary>Always throws <see cref="HttpRequestException"/> — the same exception type a real dead
    /// socket produces, which <c>St4iDeviceClient.HttpSendAsync</c> catches and rethrows as
    /// <c>St4iNetworkException</c>, driving the SDK's real on-disk Enqueue path. No real socket involved.</summary>
    private sealed class OfflineHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            throw new HttpRequestException("simulated offline server (WS-C-T5 capstone) — forces the SDK's real Enqueue-to-disk path, no real socket");
    }

    /// <summary>Always answers 201 with a success envelope — the "server is back up" side of the restart.</summary>
    private sealed class RecordingHandler : HttpMessageHandler
    {
        public List<string> RequestUrls { get; } = new();

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            RequestUrls.Add(request.RequestUri?.ToString() ?? "");
            return new HttpResponseMessage(HttpStatusCode.Created)
            {
                Content = new StringContent("{\"ok\":true,\"data\":{\"success\":true,\"processResultId\":1}}"),
            };
        }
    }

    /// <summary>Builds a real <see cref="FleetHost"/> over the full production composition (mirrors
    /// <c>St4i.EngineApi/Program.cs</c>'s own DI wiring), except the initial <see cref="LiveTransport"/> is
    /// built via the RAW <see cref="St4iDeviceClient"/> ctor with <c>maxRetries: 0</c> (see class doc) so
    /// tests never pay the SDK's real exponential-backoff cost. <see cref="TransportCoordinator.RebuildLive"/>
    /// is never called — the coordinator's initial Live/Auto instances (built here, not by the coordinator
    /// itself) are what actually serve traffic for the whole test.</summary>
    private static (FleetHost Host, TransportCoordinator Coordinator, LiveTransport Live) ComposeFleetHost(
        WalOptions wal, string machineCode, HttpMessageHandler handler)
    {
        var client = new St4iDeviceClient(
            serverUrl: "http://unit-test.invalid",
            mkKey: "mk_test",
            machineCode: machineCode,
            queuePath: wal.ResolveQueueFile(machineCode),
            maxRetries: 0,
            handler: handler);
        var live = new LiveTransport(client);
        var demo = new DemoTransport(latencyMs: 0);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Live, wal);
        var host = new FleetHost(switchable, coordinator, new EventBus());
        return (host, coordinator, live);
    }

    [Fact]
    public async Task OfflineBacklogBufferedByARealFleetHost_SurvivesASimulatedRestart_AndDrainsToZero_WithCorrectAckLabeling()
    {
        var walDir = Directory.CreateTempSubdirectory("st4i-store-forward-restart-tests-").FullName;
        var wal = new WalOptions { Directory = walDir };
        // Throwaway, GUID-suffixed gateway identity (mirrors SettingsWalPreservationTests' precaution) so
        // CredentialStore.Save below can never collide with a real stored credential.
        var machineCode = "SF-RESTART-" + Guid.NewGuid().ToString("N")[..8];
        CredentialStore.Save(machineCode, "mk_test");

        var walFile = wal.ResolveQueueFile(machineCode);

        // ── Compose #1 — "before the restart": a real, RUNNING FleetHost over an OFFLINE handler. ──────
        var (host1, _, live1) = ComposeFleetHost(wal, machineCode, new OfflineHandler());
        try
        {
            host1.Start();

            // A few real cycles buffer real ProcessResult envelopes to the on-disk WAL file.
            await WaitUntilAsync(
                () => File.Exists(walFile) && File.ReadAllLines(walFile).Any(l => l.Trim().Length > 0),
                "the offline FleetHost to buffer at least one ProcessResult envelope to the on-disk WAL file");

            // WS-C-T4's ack-label fix, proven LIVE through the real pipeline (not just a synthetic ack):
            // a machine that just buffered a write reports "ack:buffered", never the old (pre-fix) "ERR".
            // FleetTileDto.LastCycleSummary is the SAME field GET /v1/fleet serves (MachineDetailDto has
            // no summary string of its own — only the fleet-tile snapshot carries it).
            await WaitUntilAsync(
                () => host1.Snapshot().Machines.Any(t => t.LastCycleSummary.Contains("ack:buffered", StringComparison.Ordinal)),
                "at least one machine's fleet-tile LastCycleSummary to show the offline leg's ack:buffered label");

            host1.Stop();
        }
        finally
        {
            host1.Stop();
            live1.Dispose();
        }

        var bufferedLines = File.ReadAllLines(walFile).Where(l => l.Trim().Length > 0).ToArray();
        Assert.True(bufferedLines.Length > 0, "compose #1 should have buffered at least one record to the on-disk WAL before the simulated restart");

        // ── Compose #2 — "process restart": a BRAND NEW FleetHost/TransportCoordinator on the SAME temp
        // directory + machineCode, with a SUCCEEDING handler (server back up). Nothing from compose #1 is
        // referenced again — only the file on disk carries the backlog across. ────────────────────────
        var recordingHandler = new RecordingHandler();
        var (host2, coordinator2, live2) = ComposeFleetHost(wal, machineCode, recordingHandler);
        try
        {
            Assert.False(host2.IsRunning); // restart-survival is about the ON-DISK backlog, not new traffic —
                                            // this test never starts compose #2's pipeline, so any drain
                                            // below can only be the pump/backlog replay, never a fresh cycle.

            // Trigger the drain purely via WalFlushPump's own idle-backlog timer (WS-C-T4) — the test
            // itself never calls FlushBacklogAsync directly, exactly like WalFlushPumpTests proves for the
            // pump alone. WS-C-T5's own MaxBytes trim rides along every tick too (walOptions: wal) — a
            // no-op here (the backlog is nowhere near 64 MiB) but exercises the real end-to-end wiring.
            await using var pump = new WalFlushPump(
                getLive: () => coordinator2.Mode == TransportMode.Live ? coordinator2.Live : null,
                interval: TimeSpan.FromMilliseconds(30),
                walOptions: wal);

            var drainedTotal = 0;
            pump.BacklogDrained += n => Interlocked.Add(ref drainedTotal, n);

            await WaitUntilAsync(
                () => File.ReadAllLines(walFile).All(l => l.Trim().Length == 0),
                "the restart-surviving backlog to drain to zero via the pump's own idle timer");

            Assert.Equal(bufferedLines.Length, Volatile.Read(ref drainedTotal));
            Assert.Equal(bufferedLines.Length, recordingHandler.RequestUrls.Count);
            Assert.All(recordingHandler.RequestUrls, url => Assert.Contains("/api/v1/ingest/process-result", url));
        }
        finally
        {
            host2.Stop();
            live2.Dispose();
        }
    }
}
