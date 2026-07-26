using St4i.EdgeCore.Models;
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
/// "Force buffering" here means a REAL <c>St4iDeviceClient</c> retry-exhaustion, not a shortcut: an
/// EMPTY mkKey would make the SDK throw <c>St4iConfigException</c> SYNCHRONOUSLY, before ever touching
/// the queue file at all — see <see cref="LiveTransport.SendAsync"/>'s own remarks distinguishing
/// "unconfigured" (empty mkKey, no network touched) from a genuine network failure (SDK's own
/// store-and-forward `Enqueue`, which is what actually writes the WAL file). So the buffering test below
/// uses a NON-EMPTY mkKey against an unreachable loopback port: St4iDeviceClient's own
/// maxRetries(4)/exponential-backoff(0.5s..30s) defaults run their full course (~7.5s total) before it
/// gives up and appends to disk — slow by unit-test standards, but the only way to exercise the actual
/// disk write through the SAME <c>LiveTransport.ForMachine(...)</c> call
/// <see cref="TransportCoordinator.RebuildLive"/> makes in production; nothing here fakes the SDK.
/// </summary>
public sealed class TransportCoordinatorWalTests
{
    private static string TempDir() => Directory.CreateTempSubdirectory("st4i-wal-coordinator-tests-").FullName;

    private static TransportCoordinator NewCoordinator(WalOptions wal)
    {
        var demo = new DemoTransport(latencyMs: 0);
        // Any dummy initial LiveTransport satisfies the ctor — every test below immediately calls
        // RebuildLive, which replaces (and disposes) this one; it is never itself under test.
        var initialLive = LiveTransport.ForMachine("http://localhost:1", "", "INITIAL", null, true);
        var auto = new AutoTransport(initialLive, demo);
        var switchable = new SwitchableTransport(demo);
        return new TransportCoordinator(switchable, demo, initialLive, auto, TransportMode.Demo, wal);
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
        var coordinator = NewCoordinator(wal);

        // Non-empty mkKey + unreachable loopback port -> a REAL retry-exhaustion -> the SDK's own
        // Enqueue() appends to disk (see class doc for why an empty mkKey would prove nothing here).
        coordinator.RebuildLive("http://127.0.0.1:1", "M1", "mk_test", true);

        var ack = await coordinator.Live.SendAsync(ProcessResultEnvelope("M1", "M1:RC1:000001"), default);
        Assert.True(ack.Queued);

        var m1File = wal.ResolveQueueFile("M1");
        Assert.True(File.Exists(m1File));
        var linesAfterFirstSend = File.ReadAllLines(m1File).Where(l => l.Trim().Length > 0).ToArray();
        Assert.Single(linesAfterFirstSend);

        // Operator "fixes" the ServerUrl for the SAME machineCode (still unreachable here — irrelevant:
        // RebuildLive itself never touches the queue file). The backlog must survive untouched.
        coordinator.RebuildLive("http://127.0.0.1:2", "M1", "mk_test", true);

        Assert.True(File.Exists(m1File));
        var linesAfterRebuild = File.ReadAllLines(m1File).Where(l => l.Trim().Length > 0).ToArray();
        Assert.Equal(linesAfterFirstSend, linesAfterRebuild);
    }

    [Fact]
    public void RebuildLive_for_a_different_machineCode_isolates_to_a_separate_file_and_leaves_the_first_untouched()
    {
        var wal = new WalOptions { Directory = TempDir() };
        var coordinator = NewCoordinator(wal);

        coordinator.RebuildLive("http://127.0.0.1:1", "M1", "mk_test", true);
        var m1File = wal.ResolveQueueFile("M1");
        Directory.CreateDirectory(Path.GetDirectoryName(m1File)!);
        File.WriteAllText(m1File, "{\"kind\":\"process\"}\n"); // pre-seeded backlog, no need to pay the real backoff cost again

        coordinator.RebuildLive("http://127.0.0.1:1", "M2", "mk_test", true);
        var m2File = wal.ResolveQueueFile("M2");

        Assert.NotEqual(m1File, m2File);
        Assert.Equal("{\"kind\":\"process\"}\n", File.ReadAllText(m1File));
        Assert.False(File.Exists(m2File)); // nothing was ever sent through M2's LiveTransport
    }

    [Fact]
    public async Task RebuildLive_with_WalDisabled_never_writes_a_queue_file_to_disk()
    {
        var wal = new WalOptions { Directory = TempDir(), Enabled = false };
        var coordinator = NewCoordinator(wal);

        coordinator.RebuildLive("http://127.0.0.1:1", "M1", "mk_test", true);
        var ack = await coordinator.Live.SendAsync(ProcessResultEnvelope("M1", "M1:RC1:000001"), default);

        Assert.True(ack.Queued); // still buffered — just in the SDK's in-memory queue, not on disk
        Assert.False(File.Exists(wal.ResolveQueueFile("M1")));
    }
}
