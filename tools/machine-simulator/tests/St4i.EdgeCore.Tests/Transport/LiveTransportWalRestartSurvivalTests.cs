using System.Net;
using System.Net.Http;
using System.Text.Json;
using St4i.DeviceClient;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Tests.Fakes;
using St4i.EdgeCore.Transport;
using Xunit;

namespace St4i.EdgeCore.Tests.Transport;

/// <summary>
/// WS-C-T3 — the headline restart-survival + ordered idempotent replay test, proven at the
/// <see cref="LiveTransport"/> level: an outage buffers N envelopes to disk, a SECOND, INDEPENDENT
/// <see cref="LiveTransport"/> built on the SAME queue file (simulating a process restart — the sim
/// process died and came back up, nothing shares in-memory state) drains that backlog in the ORIGINAL
/// send order with the SAME idempotencyKeys, and the file ends up empty.
///
/// Fast/deterministic by construction: the offline-side <see cref="St4iDeviceClient"/> below is built
/// directly via its public ctor (not <see cref="LiveTransport.ForMachine"/>) with <c>maxRetries: 0</c> —
/// <see cref="LiveTransport"/>'s own doc comment says the public <see cref="LiveTransport(St4iDeviceClient)"/>
/// ctor exists exactly so tests can hand in a pre-built client like this one. With maxRetries=0, the SDK's
/// SendWithRetryAsync's `attempt &lt; _maxRetries` guard is never true, so it enqueues-to-disk and throws
/// on the FIRST failed attempt — no exponential backoff (the SDK's default maxRetries=4 would otherwise
/// spend ~7.5s of Task.Delay backoff PER send before enqueueing, as documented in
/// <c>TransportCoordinatorWalTests</c>). The injected <see cref="CapturingHandler"/> throws
/// <see cref="HttpRequestException"/> synchronously (same exception type a real dead socket produces,
/// no real network) — <see cref="St4iDeviceClient.HttpSendAsync"/> catches it and rethrows as
/// <c>St4iNetworkException</c>, driving the real on-disk Enqueue path. The replay side's
/// <see cref="LiveTransport.FlushBacklogAsync"/> passthrough calls the SDK's own
/// <c>FlushQueueAsync</c> directly, which never backs off either (one attempt per queued item, per its own
/// doc comment) — so this whole test runs in well under a second.
/// </summary>
public sealed class LiveTransportWalRestartSurvivalTests
{
    private static string TempQueueFile() =>
        Path.Combine(Directory.CreateTempSubdirectory("st4i-wal-restart-tests-").FullName, "M1.jsonl");

    private static CanonicalEnvelope ProcessResultEnvelope(string machineCode, string serialNumber, string idempotencyKey) => new(
        ReadingKind.ProcessResult, machineCode, "/api/v1/ingest/process-result",
        new()
        {
            ["serialNumber"] = serialNumber,
            ["stepType"] = "screw_tightening",
            ["result"] = "pass",
            ["idempotencyKey"] = idempotencyKey,
        }, idempotencyKey);

    [Fact]
    public async Task Buffered_backlog_survives_a_restart_and_replays_in_order_idempotently()
    {
        var queuePath = TempQueueFile();
        var keys = new[] { "M1:RC1:000001", "M1:RC1:000002", "M1:RC1:000003" };

        // ── Phase 1: outage — buffer N=3 envelopes to disk via a LiveTransport whose wrapped SDK client
        // fails SYNCHRONOUSLY (no real network, no backoff — see class doc). ──────────────────────────
        var offlineHandler = new CapturingHandler
        {
            Responder = (_, __) => throw new HttpRequestException(
                "simulated offline server (WS-C-T3) — forces the SDK's real Enqueue-to-disk path, no real socket"),
        };
        using (var offlineClient = new St4iDeviceClient(
            serverUrl: "http://unit-test.invalid",
            mkKey: "mk_test",
            machineCode: "M1",
            queuePath: queuePath,
            maxRetries: 0,
            handler: offlineHandler))
        using (var lt1 = new LiveTransport(offlineClient))
        {
            for (var i = 0; i < keys.Length; i++)
            {
                var ack = await lt1.SendAsync(ProcessResultEnvelope("M1", $"SN{i + 1}", keys[i]), default);
                Assert.False(ack.Success);
                Assert.True(ack.Queued);
            }
        }

        var bufferedLines = File.ReadAllLines(queuePath).Where(l => l.Trim().Length > 0).ToArray();
        Assert.Equal(keys.Length, bufferedLines.Length);
        for (var i = 0; i < keys.Length; i++)
        {
            using var entry = JsonDocument.Parse(bufferedLines[i]);
            var bufferedKey = entry.RootElement.GetProperty("payload").GetProperty("idempotencyKey").GetString();
            Assert.Equal(keys[i], bufferedKey);
        }

        // ── Phase 2: "process restart" — a SECOND, INDEPENDENT LiveTransport built on the SAME queue
        // file, with a handler that now succeeds (server is back up). Nothing in-memory is shared with
        // lt1/offlineClient above — they were already disposed. ──────────────────────────────────────
        var recordingHandler = new CapturingHandler
        {
            Responder = (_, __) => (HttpStatusCode.Created,
                "{\"ok\":true,\"data\":{\"success\":true,\"processResultId\":1}}"),
        };
        using var lt2 = LiveTransport.ForMachine("http://unit-test.invalid", "mk_test", "M1", queuePath, true, recordingHandler);

        var (sent, kept) = await lt2.FlushBacklogAsync();

        Assert.Equal(keys.Length, sent);
        Assert.Equal(0, kept);
        Assert.Equal(keys.Length, recordingHandler.Requests.Count);
        for (var i = 0; i < keys.Length; i++)
        {
            var (url, body) = recordingHandler.Requests[i];
            Assert.Contains("/api/v1/ingest/process-result", url);
            using var sent1 = JsonDocument.Parse(body);
            Assert.Equal(keys[i], sent1.RootElement.GetProperty("idempotencyKey").GetString());
        }

        Assert.DoesNotContain(File.ReadAllLines(queuePath), l => l.Trim().Length > 0);

        // ── Idempotency spot-check: a second drain on the now-empty backlog sends nothing. ──────────
        var (sentAgain, keptAgain) = await lt2.FlushBacklogAsync();
        Assert.Equal(0, sentAgain);
        Assert.Equal(0, keptAgain);
        Assert.Equal(keys.Length, recordingHandler.Requests.Count); // unchanged — no new requests fired
    }
}
