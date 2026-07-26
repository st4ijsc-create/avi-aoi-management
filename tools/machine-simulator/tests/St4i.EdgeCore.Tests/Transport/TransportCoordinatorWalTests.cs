using System.Net.Http;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Tests.Fakes;
using St4i.EdgeCore.Transport;
using Xunit;

namespace St4i.EdgeCore.Tests.Transport;

/// <summary>
/// WS-C-T2 — proves <see cref="TransportCoordinator"/> actually THREADS a <see cref="WalOptions"/> into
/// every <see cref="LiveTransport"/> it builds via <see cref="TransportCoordinator.RebuildLive"/>: a
/// rebuild for the SAME machineCode (e.g. an operator fixes ServerUrl after an outage) must resolve to
/// the SAME on-disk queue file — <see cref="WalOptions.ResolveQueueFile"/> is a PURE function of
/// machineCode (see its own doc comment) and <see cref="TransportCoordinator.RebuildLive"/> does no file
/// I/O itself, so the backlog a real offline send appended survives untouched. A rebuild for a
/// DIFFERENT machineCode must isolate to a DIFFERENT file and leave the first one alone — same
/// multi-identity model <see cref="St4i.EdgeCore.Infrastructure.CredentialStore"/> already uses for mk_
/// keys.
///
/// Fix round 1 (C2 review) — "force buffering" no longer means a REAL St4iDeviceClient
/// retry-exhaustion against an unreachable loopback port: that was slow (observed 15-57s/test) AND
/// OS/firewall-timing-dependent (a real socket connect-refused's timing varies by machine/CI runner).
/// TransportCoordinator now accepts an optional trailing <see cref="HttpMessageHandler"/> (forwarded
/// into every <see cref="TransportCoordinator.RebuildLive"/>-built <c>LiveTransport.ForMachine(...)</c>
/// call), so these tests inject the repo's existing <see cref="CapturingHandler"/> fake (same pattern
/// as <c>LiveTransportTests.cs</c>/<c>AutoTransportTests.cs</c>) configured to throw
/// <see cref="HttpRequestException"/> — the SAME exception type a real dead socket produces, which
/// <c>St4iDeviceClient.HttpSendAsync</c> catches and rethrows as <c>St4iNetworkException</c>, driving
/// the SDK's own retry-exhaustion-then-<c>Enqueue</c>-to-disk path exactly like a real network failure
/// would, but with NO real socket/connect-timeout variance — deterministic and portable. (A NON-empty
/// mkKey is still required: an EMPTY one makes the SDK throw <c>St4iConfigException</c> SYNCHRONOUSLY,
/// before ever touching the handler or the queue file at all — see <see cref="LiveTransport.SendAsync"/>'s
/// own remarks distinguishing "unconfigured" from a genuine network failure.) The SDK's own fixed
/// maxRetries(4)/backoff(0.5s..30s exponential) still elapses in real time between attempts regardless
/// of handler speed (~7.5s), so these are not literally instant — but they are now bounded and
/// deterministic instead of subject to OS-level socket timing.
/// </summary>
public sealed class TransportCoordinatorWalTests
{
    private static string TempDir() => Directory.CreateTempSubdirectory("st4i-wal-coordinator-tests-").FullName;

    private static CapturingHandler NetworkDownHandler() => new()
    {
        Responder = (_, __) => throw new HttpRequestException(
            "simulated offline server (WS-C-T2 fix round 1) — forces the SDK's own retry-exhaustion " +
            "and disk Enqueue deterministically, no real socket involved"),
    };

    private static TransportCoordinator NewCoordinator(WalOptions wal, HttpMessageHandler handler)
    {
        var demo = new DemoTransport(latencyMs: 0);
        // Any dummy initial LiveTransport satisfies the ctor — every test below immediately calls
        // RebuildLive, which replaces (and disposes) this one; it is never itself under test.
        var initialLive = LiveTransport.ForMachine("http://localhost:1", "", "INITIAL", null, true);
        var auto = new AutoTransport(initialLive, demo);
        var switchable = new SwitchableTransport(demo);
        return new TransportCoordinator(switchable, demo, initialLive, auto, TransportMode.Demo, wal, handler);
    }

    private static CanonicalEnvelope ProcessResultEnvelope(string machineCode, string idempotencyKey) => new(
        ReadingKind.ProcessResult, machineCode, "/api/v1/ingest/process-result",
        new()
        {
            ["serialNumber"] = "SN1",
            ["stepType"] = "screw_tightening",
            ["result"] = "pass",
            ["idempotencyKey"] = idempotencyKey,
        }, idempotencyKey);

    [Fact]
    public async Task RebuildLive_for_the_same_machineCode_preserves_the_buffered_file_across_a_rebuild()
    {
        var wal = new WalOptions { Directory = TempDir() };
        var coordinator = NewCoordinator(wal, NetworkDownHandler());

        // Non-empty mkKey + a fake handler that always throws HttpRequestException -> a REAL
        // retry-exhaustion -> the SDK's own Enqueue() appends to disk (see class doc for why an empty
        // mkKey would prove nothing here).
        coordinator.RebuildLive("http://x", "M1", "mk_test", true);

        var ack = await coordinator.Live.SendAsync(ProcessResultEnvelope("M1", "M1:RC1:000001"), default);
        Assert.True(ack.Queued);

        var m1File = wal.ResolveQueueFile("M1");
        Assert.True(File.Exists(m1File));
        var linesAfterFirstSend = File.ReadAllLines(m1File).Where(l => l.Trim().Length > 0).ToArray();
        Assert.Single(linesAfterFirstSend);

        // Operator "fixes" the ServerUrl for the SAME machineCode (still simulated-offline here —
        // irrelevant: RebuildLive itself never touches the queue file). The backlog must survive
        // untouched.
        coordinator.RebuildLive("http://y", "M1", "mk_test", true);

        Assert.True(File.Exists(m1File));
        var linesAfterRebuild = File.ReadAllLines(m1File).Where(l => l.Trim().Length > 0).ToArray();
        Assert.Equal(linesAfterFirstSend, linesAfterRebuild);
    }

    // Fix round 1 (Minor) — discriminating via an ACTUAL buffered send through EACH machine's own
    // rebuilt LiveTransport, not just comparing ResolveQueueFile(...) path strings (which would pass
    // even if RebuildLive never threaded a queuePath at all, since WalOptions' path arithmetic is
    // already covered on its own in WalOptionsTests.cs).
    [Fact]
    public async Task RebuildLive_for_a_different_machineCode_isolates_to_a_separate_file_and_leaves_the_first_untouched()
    {
        var wal = new WalOptions { Directory = TempDir() };
        var coordinator = NewCoordinator(wal, NetworkDownHandler());

        coordinator.RebuildLive("http://x", "M1", "mk_test", true);
        await coordinator.Live.SendAsync(ProcessResultEnvelope("M1", "M1:RC1:000001"), default);
        var m1File = wal.ResolveQueueFile("M1");
        var m1LinesAfterM1Send = File.ReadAllLines(m1File).Where(l => l.Trim().Length > 0).ToArray();
        Assert.Single(m1LinesAfterM1Send);

        coordinator.RebuildLive("http://x", "M2", "mk_test", true);
        await coordinator.Live.SendAsync(ProcessResultEnvelope("M2", "M2:RC1:000001"), default);
        var m2File = wal.ResolveQueueFile("M2");

        Assert.NotEqual(m1File, m2File);
        Assert.True(File.Exists(m2File));
        var m2Lines = File.ReadAllLines(m2File).Where(l => l.Trim().Length > 0).ToArray();
        Assert.Single(m2Lines);

        // M1's file is untouched by the M2 rebuild + send.
        var m1LinesAfterM2Send = File.ReadAllLines(m1File).Where(l => l.Trim().Length > 0).ToArray();
        Assert.Equal(m1LinesAfterM1Send, m1LinesAfterM2Send);
    }

    [Fact]
    public async Task RebuildLive_with_WalDisabled_never_writes_a_queue_file_to_disk()
    {
        var wal = new WalOptions { Directory = TempDir(), Enabled = false };
        var coordinator = NewCoordinator(wal, NetworkDownHandler());

        coordinator.RebuildLive("http://x", "M1", "mk_test", true);
        var ack = await coordinator.Live.SendAsync(ProcessResultEnvelope("M1", "M1:RC1:000001"), default);

        Assert.True(ack.Queued); // still buffered — just in the SDK's in-memory queue, not on disk
        Assert.False(File.Exists(wal.ResolveQueueFile("M1")));
    }

    // C-1 (Critical, WS-C final-review fix wave) — on a FRESH INSTALL nothing has ever created
    // %ProgramData%\ST4I\sim\wal: WalOptions.ResolveDir/ResolveQueueFile are pure path arithmetic (see
    // their own doc comments) and never touch disk. Without an explicit directory-creation step, the
    // SDK's own St4iDeviceClient.Enqueue calls File.AppendAllText(queuePath, ...) directly — which does
    // NOT create missing parent directories — so the FIRST offline write throws
    // DirectoryNotFoundException. That exception is not one of the three St4i*Exception types
    // LiveTransport.SendAsync's catch clauses handle, so it escapes SendAsync entirely; EdgePipeline's
    // own catch (Exception) then turns it into TransportAck(Success:false, Queued:false) — the record is
    // LOST and the fleet tile shows "ERR" instead of "ack:buffered". This test proves the queue
    // directory actually gets created before the SDK ever tries to write to it, using the SAME
    // RebuildLive-wired path (NewCoordinator/NetworkDownHandler) TransportCoordinatorWalTests already
    // uses above — RebuildLive is the runtime path where a real mk_ first appears after a Settings edit.
    [Fact]
    public async Task RebuildLive_WhenWalDirectoryDoesNotExistYet_CreatesItSoTheFirstOfflineSendIsBufferedNotLost()
    {
        var walRoot = TempDir();
        var freshWalDir = Path.Combine(walRoot, "fresh-install-wal"); // deliberately NEVER created
        Assert.False(Directory.Exists(freshWalDir));

        var wal = new WalOptions { Directory = freshWalDir };
        var coordinator = NewCoordinator(wal, NetworkDownHandler());

        coordinator.RebuildLive("http://x", "M1", "mk_test", true);

        var ack = await coordinator.Live.SendAsync(ProcessResultEnvelope("M1", "M1:RC1:000001"), default);

        // Buffered, not lost: pre-fix, the DirectoryNotFoundException above would escape SendAsync
        // uncaught (it fails this awaited call directly, before any ack is ever produced).
        Assert.True(ack.Queued);

        var m1File = wal.ResolveQueueFile("M1");
        Assert.True(File.Exists(m1File), $"expected the WAL directory + queue file to have been created at {m1File}");
        var lines = File.ReadAllLines(m1File).Where(l => l.Trim().Length > 0).ToArray();
        Assert.Single(lines);
        Assert.Contains("M1:RC1:000001", lines[0]);
    }
}
