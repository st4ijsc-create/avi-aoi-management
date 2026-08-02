using System.Net;
using System.Net.Http;
using St4i.DeviceClient;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Tests.Fakes;
using St4i.EdgeCore.Transport;
using Xunit;

namespace St4i.EdgeCore.Tests.Transport;

/// <summary>
/// WS-C-T4 — <see cref="WalFlushPump"/>: the idle-backlog drain the SDK's own opportunistic replay
/// can't provide (<see cref="LiveTransport.SendAsync"/> only flushes a buffered backlog as a SIDE
/// EFFECT of sending something NEW — see the SDK's own SendWithRetryAsync — so a machine that goes
/// quiet right after an outage never drains what's on disk until it happens to send again, which may be
/// never). Every "drains" test here proves the pump does this on ITS OWN TIMER with the test never
/// calling SendAsync/FlushBacklogAsync on the recovered transport directly.
///
/// Fast/deterministic by construction, same techniques as
/// <c>LiveTransportWalRestartSurvivalTests</c>/<c>TransportCoordinatorWalTests</c>: backlogs are built via
/// an "offline" <see cref="St4iDeviceClient"/> (maxRetries:0, handler throws synchronously — no real
/// socket, no backoff) and drained via a "recovered" <see cref="LiveTransport"/> wired to a
/// <see cref="CapturingHandler"/> that responds instantly — so a pump interval of tens of milliseconds
/// is safe to poll for without ever hitting the SDK's real ~7.5s exponential-backoff window.
/// </summary>
public sealed class WalFlushPumpTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(25);

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

    private static string TempQueueFile() =>
        Path.Combine(Directory.CreateTempSubdirectory("st4i-wal-pump-tests-").FullName, "M1.jsonl");

    private static CanonicalEnvelope ProcessResultEnvelope(string machineCode, string serialNumber, string idempotencyKey) => new(
        ReadingKind.ProcessResult, machineCode, "/api/v1/ingest/process-result",
        new()
        {
            ["serialNumber"] = serialNumber,
            ["stepType"] = "screw_tightening",
            ["result"] = "pass",
            ["idempotencyKey"] = idempotencyKey,
        }, idempotencyKey);

    /// <summary>Buffers <paramref name="keys"/>.Length envelopes to <paramref name="queuePath"/> via an
    /// offline (always-throws) SDK client — mirrors Phase 1 of LiveTransportWalRestartSurvivalTests.</summary>
    private static async Task SeedBacklogAsync(string queuePath, string machineCode, string[] keys)
    {
        var offlineHandler = new CapturingHandler
        {
            Responder = (_, __) => throw new HttpRequestException(
                "simulated offline server (WalFlushPumpTests) — forces the SDK's real disk-Enqueue path, no real socket"),
        };
        using var offlineClient = new St4iDeviceClient(
            serverUrl: "http://unit-test.invalid",
            mkKey: "mk_test",
            machineCode: machineCode,
            queuePath: queuePath,
            maxRetries: 0,
            handler: offlineHandler);
        using var offlineLive = new LiveTransport(offlineClient);

        foreach (var key in keys)
        {
            var ack = await offlineLive.SendAsync(ProcessResultEnvelope(machineCode, $"SN-{key}", key), default);
            Assert.False(ack.Success);
            Assert.True(ack.Queued);
        }
    }

    [Fact]
    public async Task Pump_DrainsAnIdleBacklogOnItsOwnTimer_WithNoExplicitSendByTheTest()
    {
        var queuePath = TempQueueFile();
        var keys = new[] { "M1:RC1:000001", "M1:RC1:000002", "M1:RC1:000003" };
        await SeedBacklogAsync(queuePath, "M1", keys);

        Assert.Equal(keys.Length, File.ReadAllLines(queuePath).Count(l => l.Trim().Length > 0));

        // "Process restart" — server is back up. This LiveTransport is handed to the pump; the test
        // itself never calls SendAsync/FlushBacklogAsync on it — only the pump's own timer does.
        var recordingHandler = new CapturingHandler
        {
            Responder = (_, __) => (HttpStatusCode.Created, "{\"ok\":true,\"data\":{\"success\":true,\"processResultId\":1}}"),
        };
        using var live = LiveTransport.ForMachine("http://unit-test.invalid", "mk_test", "M1", queuePath, true, recordingHandler);

        var drainedCounts = new List<int>();

        // 🔴🔴 Đợt C closeout round — SUBSCRIBE-AFTER-START. Same defect, same fix, as the one applied to
        // `StoreAndForwardRestartSurvivalTests` in this diff; this is the SECOND independent instance and
        // it is the one that actually went red, aborting a whole-suite run.
        //
        // `WalFlushPump`'s CONSTRUCTOR starts the drain loop (`_loop = Task.Run(...)`, WalFlushPump.cs:61)
        // and `getLive` already returns a live transport, so the pump can drain on its very first 30 ms
        // tick — which may land BEFORE the next statement attaches `BacklogDrained`. That drain is then
        // raised into no subscriber, `drainedCounts.Sum()` is short by exactly it, `WaitUntilAsync` times
        // out and the Assert.Equal below fails. Nothing is wrong with the pump: the test simply was not
        // listening yet.
        //
        // 🔴 Fixed by ARMING, not by widening a bound — the pump's own timer is still the only thing that
        // triggers the drain, which is the property this test exists to prove ("with no explicit send by
        // the test"). It just cannot now drain before anyone is counting.
        var armed = false;
        await using var pump = new WalFlushPump(
            getLive: () => Volatile.Read(ref armed) ? live : null,
            interval: TimeSpan.FromMilliseconds(30));
        pump.BacklogDrained += n => { lock (drainedCounts) drainedCounts.Add(n); };
        Volatile.Write(ref armed, true); // only NOW can a tick drain anything

        await WaitUntilAsync(
            () => { lock (drainedCounts) return drainedCounts.Sum() >= keys.Length; },
            "the pump to drain the idle backlog on its own timer, with no explicit send");

        Assert.Equal(keys.Length, drainedCounts.Sum());

        // 🔴🔴 Đợt D, D-1 re-review — STOP THE WRITER BEFORE READING THE FILE. This is the THIRD independent
        // instance of the defect Đợt C closed in `StoreAndForwardRestartSurvivalTests`, and it was caught by
        // a reviewer's own gate run failing here: EdgeCore 740/741, `IOException: the process cannot access
        // the file 'M1.jsonl' because it is being used by another process`, thrown out of
        // `File.ReadAllLines` — NOT out of any assertion. Reproduced 1 run in 4.
        //
        // `File.ReadAllLines` opens with FileShare.Read, which refuses to open at all while any WRITE handle
        // is live. The pump above is `await using`, so it is disposed only at SCOPE EXIT — it is still
        // ticking on this line, and every tick that finds a live transport calls FlushBacklogAsync, whose
        // vendored-SDK drain ends in an UNCONDITIONAL `File.WriteAllText(_queuePath, "")` (FileMode.Create /
        // FileAccess.Write / FileShare.Read). A read landing in one of those windows throws, and nothing
        // about the property under test is involved.
        //
        // 🔴 Fixed by REMOVING THE WRITER, not by tolerating it and not by adding a retry or a bound.
        // `DisposeAsync` cancels the loop AND awaits it (WalFlushPump.cs:135-152), so once it returns no
        // tick can be in flight and no handle can be open — the read below is then unconditionally safe
        // rather than probably safe. Everything this test asserts has already happened by here: the drain
        // was observed through `BacklogDrained` above, so stopping the pump cannot mask it. The explicit
        // dispose is safe alongside `await using` because `DisposeAsync` is idempotent by design
        // (`if (_disposed) return`, same line range).
        //
        // The alternative Đợt C used there — a FileShare.ReadWrite|Delete reader — is the right tool when
        // the concurrent writer IS the point of the test. Here it is not: this test's subject is the pump's
        // own timer, and by this line that subject is fully proven.
        await pump.DisposeAsync();

        Assert.DoesNotContain(File.ReadAllLines(queuePath), l => l.Trim().Length > 0);
        Assert.Equal(keys.Length, recordingHandler.Requests.Count);
    }

    [Fact]
    public async Task Pump_WhenGetLiveReturnsNull_NeverDrains_AndLeavesTheBacklogUntouched()
    {
        var queuePath = TempQueueFile();
        var keys = new[] { "M1:RC1:000001" };
        await SeedBacklogAsync(queuePath, "M1", keys);

        var getLiveCalls = 0;
        var drained = false;
        await using var pump = new WalFlushPump(
            getLive: () => { Interlocked.Increment(ref getLiveCalls); return null; }, // e.g. Mode != Live (Demo)
            interval: TimeSpan.FromMilliseconds(20));
        pump.BacklogDrained += _ => drained = true;

        await WaitUntilAsync(() => Volatile.Read(ref getLiveCalls) >= 3, "getLive to be polled multiple times");

        // Same stop-the-writer-first discipline as the test above. This pump's `getLive` always returns
        // null, so it never reaches FlushBacklogAsync and — today — never opens a write handle at all; the
        // dispose is applied anyway so the rule holds uniformly for every read in this file rather than
        // depending on a per-test analysis of which pump can currently write. It also makes `drained`
        // final: no further tick can flip it after this line.
        await pump.DisposeAsync();

        Assert.False(drained);
        Assert.Equal(keys.Length, File.ReadAllLines(queuePath).Count(l => l.Trim().Length > 0));
    }

    [Fact]
    public async Task Pump_SurvivesAThrowingGetLive_AndALaterTickStillDrains()
    {
        var queuePath = TempQueueFile();
        var keys = new[] { "M1:RC1:000001" };
        await SeedBacklogAsync(queuePath, "M1", keys);

        var recordingHandler = new CapturingHandler
        {
            Responder = (_, __) => (HttpStatusCode.Created, "{\"ok\":true,\"data\":{\"success\":true,\"processResultId\":1}}"),
        };
        using var live = LiveTransport.ForMachine("http://unit-test.invalid", "mk_test", "M1", queuePath, true, recordingHandler);

        var callCount = 0;
        LiveTransport? GetLive()
        {
            var n = Interlocked.Increment(ref callCount);
            // First two ticks blow up — proves the loop survives a throwing tick instead of dying.
            if (n <= 2)
                throw new InvalidOperationException("WalFlushPumpTests: induced getLive failure for the current test.");
            return live;
        }

        var loggedErrors = new List<string>();
        var drainedCounts = new List<int>();
        await using var pump = new WalFlushPump(
            getLive: GetLive,
            interval: TimeSpan.FromMilliseconds(20),
            logError: (ex, msg) => { lock (loggedErrors) loggedErrors.Add(msg); });
        pump.BacklogDrained += n => { lock (drainedCounts) drainedCounts.Add(n); };

        await WaitUntilAsync(
            () => { lock (drainedCounts) return drainedCounts.Count > 0; },
            "a later tick to still drain after earlier ticks' getLive threw");

        Assert.True(loggedErrors.Count >= 2, $"expected at least 2 logged tick failures, got {loggedErrors.Count}");
        Assert.Equal(keys.Length, drainedCounts.Sum());

        // Same stop-the-writer-first discipline as the two tests above — and this pump DOES drain (it is
        // handed a live transport from its third tick onward), so this read had exactly the same live-writer
        // hazard as the one that actually went red.
        await pump.DisposeAsync();

        Assert.DoesNotContain(File.ReadAllLines(queuePath), l => l.Trim().Length > 0);
    }

    [Fact]
    public async Task DisposeAsync_ReturnsWithoutHanging()
    {
        var pump = new WalFlushPump(getLive: () => null, interval: TimeSpan.FromMilliseconds(20));

        var disposeTask = pump.DisposeAsync().AsTask();

        // 🔴 backlog-test-deadlines — DELIBERATELY LEFT as a bounded abandon, noted so the next sweep does not
        // "fix" it into a hang. `DisposeAsync` is the thing under test and accepts no cancellation token, and
        // this pump was built with `getLive: () => null` — it opens no socket and no file, so a lost WhenAny
        // leaves only an unobserved in-memory Task. There is nothing to cancel, and an unconditional join in a
        // `finally` would turn the one failure this test exists to report into a wedged test host.
        var winner = await Task.WhenAny(disposeTask, Task.Delay(TimeSpan.FromSeconds(5)));

        Assert.Same(disposeTask, winner);
        await disposeTask; // must not throw
    }
}
