using System.Net;
using System.Net.Http;
using System.Text.Json;
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
/// envelopes to the on-disk queue file — <b>whatever kinds the real roster actually produced</b>, which is
/// NOT a fixed set: <see cref="St4i.EdgeCore.Drivers.SimulatedDriver"/> seeds every machine's
/// <c>_nextDueAt</c> to the SAME instant, so the fleet's very first pass emits all ten default machines
/// back-to-back in roster order regardless of their <see cref="MachineDescriptor.CycleSeconds"/>, and the
/// last three of those (IOT-01, AOI-01, AOI-02) are <see cref="ReadingKind.Telemetry"/>/
/// <see cref="ReadingKind.Inspection"/>, not <see cref="ReadingKind.ProcessResult"/>. How far into that
/// first pass compose #1 gets before it is torn down is pure scheduling — see the closeout-round comment
/// at the replay assertions below for the flake this produced and how it is closed. The WS-C-T4 ack-label
/// fix is proven live
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

    /// <summary>
    /// 🔴🔴 Đợt C closeout round, THIRD PASS — <b>the WAL file must never be read with
    /// <see cref="File.ReadAllLines(string)"/>, and this is the only reader this test may use.</b>
    ///
    /// <para><b>The defect.</b> Captured live under load, as an <see cref="IOException"/> — "The process
    /// cannot access the file '…SF-RESTART-….jsonl' because it is being used by another process" — thrown
    /// out of <c>File.ReadAllLines</c>, NOT out of any assertion. <c>File.ReadAllLines</c> opens with
    /// <see cref="FileShare.Read"/>, which permits other READERS but refuses to open at all while any
    /// WRITE handle is live. The vendored SDK holds one regularly: <c>St4iDeviceClient.DrainQueue</c>
    /// (examples/device-client/csharp/St4iDeviceClient.cs) ends with an UNCONDITIONAL
    /// <c>File.WriteAllText(_queuePath, "")</c> — <c>FileMode.Create</c>/<see cref="FileAccess.Write"/>/
    /// <see cref="FileShare.Read"/> — which runs on EVERY <c>FlushQueueAsync</c> call even when the queue
    /// is empty and there is nothing to drain. So a running <see cref="WalFlushPump"/> opens this file for
    /// writing once per tick, forever, and compose #1's own send path calls the same drain before every
    /// reading it sends. Any test-side <c>File.ReadAllLines</c> that lands in one of those windows throws.
    /// Nothing about the property under test is involved — the read simply cannot be performed that way.</para>
    ///
    /// <para><b>Why these share flags.</b> Verified with a standalone probe against a handle opened exactly
    /// as <c>File.WriteAllText</c> opens one, not assumed from documentation: <c>File.ReadAllLines</c>
    /// throws, and this <see cref="FileShare.ReadWrite"/><c>|</c><see cref="FileShare.Delete"/> open
    /// succeeds. The two directions of the Win32 sharing check are what matter — our REQUESTED access
    /// (<see cref="FileAccess.Read"/>) must be allowed by the SDK handle's share mode
    /// (<see cref="FileShare.Read"/> — it is), and our share mode must allow the SDK handle's access
    /// (<see cref="FileAccess.Write"/> — which <see cref="FileShare.Read"/> did not and
    /// <see cref="FileShare.ReadWrite"/> does). <see cref="FileShare.Delete"/> additionally tolerates
    /// <c>WalMaintenance.WriteAllLinesAtomic</c>'s rename-over-the-file, so a trim can never be blocked by
    /// this test's reader either. Against every handle the SDK and WalMaintenance open, this cannot
    /// produce a sharing violation in EITHER direction — so there is no retry here, and no bound to tune.</para>
    ///
    /// <para>A torn read (a line half-appended) is harmless at all three call sites: two of them only ask
    /// whether any line is non-blank, and the third (<c>bufferedLines</c>, the only one whose content is
    /// parsed) runs after compose #1 is stopped and before any pump exists, with no writer alive at all.</para>
    /// </summary>
    private static string[] ReadWalLines(string walFile)
    {
        if (!File.Exists(walFile)) return [];

        try
        {
            using var stream = new FileStream(
                walFile, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var reader = new StreamReader(stream);

            var lines = new List<string>();
            while (reader.ReadLine() is { } line) lines.Add(line);
            return lines.ToArray();
        }
        catch (FileNotFoundException)
        {
            // Raced a delete between File.Exists and the open — an empty backlog, same as not existing.
            return [];
        }
    }

    /// <summary>The ST4I ingest path ONE buffered WAL line will be replayed to, read out of the vendored
    /// SDK's own queue-line shape — <c>{"kind":…,"path":…,"payload":…,"queuedAt":…}</c>, written by
    /// <c>St4iDeviceClient.Enqueue</c> and read back by its <c>FlushQueueAsync</c>
    /// (examples/device-client/csharp/St4iDeviceClient.cs). This is what lets the replay assertions below
    /// derive their expectation from the backlog that actually exists rather than from an assumption about
    /// which machines happened to cycle — see the closeout-round comment at those assertions.</summary>
    private static string QueuedPath(string walLine)
    {
        using var doc = JsonDocument.Parse(walLine);
        return doc.RootElement.GetProperty("path").GetString()
            ?? throw new InvalidOperationException("a buffered WAL line carried no 'path'");
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
                // ReadWalLines, never File.ReadAllLines — compose #1 is deliberately RUNNING here, so the
                // SDK is appending to and truncating this exact file while this predicate polls it. That
                // concurrent writer is the point of this leg of the test and cannot be removed; the read
                // is what has to tolerate it. See ReadWalLines' own doc comment.
                () => ReadWalLines(walFile).Any(l => l.Trim().Length > 0),
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

        // The only read in this test whose CONTENT is parsed (QueuedPath below), and the only one with no
        // writer alive at all: compose #1 is stopped and disposed above, and compose #2's pump does not
        // exist yet — so this is a settled file, never a torn one.
        var bufferedLines = ReadWalLines(walFile).Where(l => l.Trim().Length > 0).ToArray();
        Assert.True(bufferedLines.Length > 0, "compose #1 should have buffered at least one record to the on-disk WAL before the simulated restart");

        // The backlog that ACTUALLY survived the restart, as the SDK itself will replay it: one ingest path
        // per buffered line, in the file's own FIFO order (which is the order `FlushQueueAsync` resends in).
        // Captured here, once, from the same settled file `bufferedLines` came from — every replay assertion
        // at the end of this test compares against THIS, never against a guess about what the fleet emitted.
        var bufferedPaths = bufferedLines.Select(QueuedPath).ToArray();

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
            //
            // 🔴🔴 Đợt C closeout round — SUBSCRIBE-AFTER-START, a real race that made this test flake red
            // under full-suite load. NOT one of the eight reviewed items; found while chasing a red
            // `scripts/verify-suites.sh` run and reported as a new finding.
            //
            // `WalFlushPump`'s CONSTRUCTOR starts the loop (`_loop = Task.Run(...)`, WalFlushPump.cs:61),
            // and `BacklogDrained` was subscribed AFTER the constructor returned. The interval is 30 ms,
            // so on a loaded machine a tick could fire, drain part or all of the backlog, and raise the
            // event into NO SUBSCRIBER — after which `WaitUntilAsync` sees an empty WAL and passes, and
            // `Assert.Equal(bufferedLines.Length, drainedTotal)` fails with a count that is short by
            // exactly the uncounted drain. Observed live: this test failed ~3.4 s into the suite while
            // passing in isolation every time.
            //
            // 🔴 Fixed by ARMING rather than by widening a timeout: the pump cannot see a live transport
            // until `armed` is set, which happens only after the handler is attached. The pump's own timer
            // is still the only thing that triggers the drain — the property this test exists to prove is
            // untouched — but no drain can now precede the subscription. Widening a bound would have made
            // this rarer and left the mechanism intact, which is the same mistake the mTLS test's own doc
            // comment in `DeviceIdentityStoreTests` records having made once already.
            var armed = false;
            await using var pump = new WalFlushPump(
                getLive: () => Volatile.Read(ref armed) && coordinator2.Mode == TransportMode.Live
                    ? coordinator2.Live
                    : null,
                interval: TimeSpan.FromMilliseconds(30),
                walOptions: wal);

            var drainedTotal = 0;
            pump.BacklogDrained += n => Interlocked.Add(ref drainedTotal, n);
            Volatile.Write(ref armed, true); // only NOW can a tick drain anything

            // 🔴🔴 Đợt C closeout round, SECOND PASS — the arming fix above was real but it was not the whole
            // story: this test still went red roughly 2 runs in 3 under load. Reproduced deliberately (48
            // CPU burners, the test alone in a loop: 10/15 red, then 16/20 red with detailed output) rather
            // than inferred, and the captured failures name TWO further mechanisms, neither of them a
            // too-tight bound. Both are fixed below at the mechanism; NOTHING here widens PollTimeout, and
            // the pump's own timer is still the only thing that triggers the drain.
            //
            // ── MECHANISM 1: THE WAIT WAS SATISFIED BY THE MIDDLE OF THE THING IT WAS WAITING FOR. ────────
            // Captured live, three times: `Assert.Equal() Failure — Expected: 9, Actual: 0` at the
            // drainedTotal assertion, i.e. the WAL file was already empty while the pump had reported
            // draining NOTHING. The vendored SDK's `DrainQueue`
            // (examples/device-client/csharp/St4iDeviceClient.cs) TRUNCATES FIRST:
            //
            //     var lines = File.ReadAllLines(_queuePath)…;  File.WriteAllText(_queuePath, "");  return lines;
            //
            // `FlushQueueAsync` calls that BEFORE its first HTTP send, and only re-`Enqueue`s whatever it
            // could not deliver AFTER the last one. So "the WAL file is empty" is TRUE FOR THE WHOLE
            // DURATION OF A DRAIN — it is the drain's opening move, not its completion — and the old
            // predicate here polled exactly that. The alignment is unforgiving: the pump's first tick lands
            // at ~30 ms and this loop's first poll after it at ~50 ms, so the entire N-record replay had to
            // finish inside ~20 ms or the test raced past it and asserted counts that were still zero. In
            // isolation N small sends through a synchronous handler beat that easily; on a loaded box a
            // single deschedule of the pump's thread does not.
            //
            // 🔴 Fixed by waiting on the pump's OWN terminal signal — `BacklogDrained`, which the pump raises
            // strictly AFTER `FlushQueueAsync` has returned, i.e. after every send completed and every
            // undeliverable record was re-enqueued. There is no longer any intermediate state that can
            // satisfy this wait. The "drains to zero" property the file check carried is not lost: it is
            // asserted immediately below, where it is now a settled fact instead of a mid-flight one, and it
            // is STRONGER there — a non-empty file after a full drain report means records were re-enqueued,
            // which the old ordering could never distinguish from the drain simply not having happened yet.
            // (This is the same shape `WalFlushPumpTests` already waits in, for the same reason.)
            await WaitUntilAsync(
                () => Volatile.Read(ref drainedTotal) >= bufferedLines.Length,
                $"the pump's own idle timer to drain AND REPORT all {bufferedLines.Length} restart-surviving " +
                "record(s) — an empty WAL file alone cannot say this, it is also true mid-drain (see above)");

            // 🔴 THIRD PASS — STOP THE WRITER BEFORE READING WHAT IT WROTE. The drain is reported complete,
            // so the pump has no work left; but `await using` would not dispose it until AFTER every
            // assertion below, and an idle pump is NOT a quiet one — each 30 ms tick still calls
            // FlushQueueAsync, whose DrainQueue opens this file for WRITING unconditionally (see
            // ReadWalLines). That live write handle is what threw the IOException this pass fixes, out of
            // the very next line. DisposeAsync cancels the loop AND awaits it, so once it returns no
            // further tick can begin and every read below is against a file with no writer at all.
            //
            // This costs the test nothing: the drain already happened and was already counted — disposing
            // the pump afterwards cannot un-prove it. `await using` still runs a second dispose at scope
            // exit, which WalFlushPump.DisposeAsync makes idempotent by design (`if (_disposed) return`).
            await pump.DisposeAsync();

            Assert.True(
                ReadWalLines(walFile).All(l => l.Trim().Length == 0),
                "the WAL file must be empty once the pump has reported the full drain — anything left here is " +
                "a record FlushQueueAsync re-enqueued because it could not deliver it");
            Assert.Equal(bufferedLines.Length, Volatile.Read(ref drainedTotal));

            // ── MECHANISM 2: AN ASSERTION ABOUT BACKLOG COMPOSITION THAT PRODUCTION NEVER GUARANTEED. ─────
            // The dominant failure, 13 of 16 captured reds: `Assert.All() Failure: 4 out of 11 items …
            // Item: "http://unit-test.invalid/api/v1/ingest/telemetry" … Not found:
            // "/api/v1/ingest/process-result"`, always at indices 7/8/9/10. This was never a timing bound —
            // it was a WRONG ASSERTION that a fast machine happened to satisfy.
            //
            // `SimulatedDriver`'s ctor seeds EVERY machine's `_nextDueAt` to the same instant, so the fleet's
            // first pass emits all ten default-roster machines back-to-back — CycleSeconds only starts
            // pacing from the SECOND cycle on. Roster indices 0-6 are the ProcessResult machines; index 7 is
            // IOT-01 (Telemetry -> /api/v1/ingest/telemetry) and 8/9 are AOI-01/AOI-02 (Inspection ->
            // /api/v1/ingest/inspection). Compose #1 is torn down whenever the ack:buffered wait above
            // happens to observe a tile, so HOW FAR into that first pass the backlog gets is pure
            // scheduling: reach record 8 and the backlog is legitimately heterogeneous. Observed backlogs
            // ranged 4 to 11 records. `Assert.All(…, "process-result")` was therefore asserting "compose #1
            // was torn down within its first seven readings", which is not a property of this system.
            //
            // 🔴 Fixed by asserting against the backlog that ACTUALLY survived (`bufferedPaths`, read out of
            // the WAL file itself) instead of against an assumed composition. This is strictly STRONGER than
            // what it replaces, not a relaxation: the old version checked only that each replayed URL
            // contained one path substring; this pins the replay to the exact ingest paths of the exact
            // records that survived the restart, in the exact FIFO order the SDK resends them — it would now
            // catch a replay that dropped a record, duplicated one, reordered them, or sent one to the wrong
            // endpoint, none of which the old assertion could see. The "it really is the ST4I ingest API"
            // guard the old assertion also provided is kept explicitly, and kind-agnostically, just below.
            //
            // 🔴 NOT VACUOUS — verified by mutation (trap 5 in scripts/verify-suites.sh: every vacuous test
            // this project has caught was caught by mutation and none by reading), each mutant reverted:
            //   • `BacklogDrained?.Invoke(sent)` removed from WalFlushPump  -> times out at the wait above.
            //   • LiveTransport.FlushBacklogAsync returns `sent + 1`        -> Expected 2 / Actual 3 below.
            //   • RecordingHandler records each URL twice                   -> the sequence Assert.Equal fails.
            // The one property below that CANNOT be mutation-tested from this repo is the SDK's own replay
            // fidelity: the ingest routes come from St4iDeviceClient's hardcoded constants, not from
            // Normalizer's (LiveTransport dispatches by ReadingKind to a typed SDK call and never passes
            // `env.Path` through), so mutating Normalizer.ProcessResultPath leaves this test green — it is
            // the vendored SDK, which this repo does not modify, that these two assertions pin.
            Assert.All(bufferedPaths, p => Assert.StartsWith("/api/v1/ingest/", p, StringComparison.Ordinal));
            Assert.Equal(
                bufferedPaths.Select(p => "http://unit-test.invalid" + p),
                recordingHandler.RequestUrls);
        }
        finally
        {
            host2.Stop();
            live2.Dispose();
        }
    }
}
