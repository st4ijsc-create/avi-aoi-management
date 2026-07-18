using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using Xunit;

public class AutoTransportTests
{
    // Stub "live" transport that always network-fails, exactly the way LiveTransport itself signals a
    // network/timeout failure: Success=false, Queued=true (store-and-forward accepted it locally), and
    // an Error message — see LiveTransport.SendAsync's St4iNetworkException catch clause.
    sealed class DownTransport : ITransport
    {
        public TransportMode Mode => TransportMode.Live;

        public Task<TransportAck> SendAsync(CanonicalEnvelope e, CancellationToken c) =>
            Task.FromResult(new TransportAck(false, Queued: true, Error: "network down"));

        public Task<HeartbeatResult> HeartbeatAsync(string m, CancellationToken c) =>
            Task.FromResult(new HeartbeatResult(false, null, null, null));

        public Task<ConfigSyncResult> SyncConfigAsync(string m, string k, string? v, CancellationToken c) =>
            Task.FromResult(new ConfigSyncResult(false, null, null));
    }

    [Fact]
    public async Task Falls_back_to_demo_when_live_network_fails()
    {
        var auto = new AutoTransport(new DownTransport(), new DemoTransport(latencyMs: 0));
        bool fired = false;
        auto.FallbackChanged += _ => fired = true;

        var env = new CanonicalEnvelope(ReadingKind.ProcessResult, "SCRW-01", "/api/v1/ingest/process-result",
            new() { ["idempotencyKey"] = "SCRW-01:RC1:000001" }, "SCRW-01:RC1:000001");

        var ack = await auto.SendAsync(env, default);

        Assert.True(ack.Success);            // demo succeeded
        Assert.True(auto.IsFallingBack);
        Assert.True(fired);
    }

    // Regression for the transition guard: FallbackChanged must fire exactly ONCE even though
    // SetFallingBack(true) gets CALLED more than once. 7 calls is deliberate, not arbitrary: call #1
    // (i=0) sees IsFallingBack==false, tries live, fails, and is the one real transition. Calls #2-5
    // (i=1..4) are in the N=5 retry-cooldown window (_callCount 1..4, never %5==0) and route straight
    // to demo WITHOUT calling SetFallingBack at all. Call #6 (i=5) is where _callCount hits 5
    // (5%5==0), so AutoTransport retries live again, DownTransport fails again, and SetFallingBack(true)
    // is invoked a SECOND time while IsFallingBack is already true — this is the case the transition
    // guard must suppress. Without the `if (changed)` guard in SetFallingBack this test would observe
    // fireCount==2, not 1 (verified by hand: temporarily removing the guard flips this test to FAIL —
    // see task-7-report.md "Fix pass 2" for the recorded RED/GREEN evidence).
    [Fact]
    public async Task FallbackChanged_fires_exactly_once_across_multiple_failing_calls()
    {
        var auto = new AutoTransport(new DownTransport(), new DemoTransport(latencyMs: 0));
        var fireCount = 0;
        auto.FallbackChanged += _ => Interlocked.Increment(ref fireCount);

        for (var i = 0; i < 7; i++)
        {
            var env = new CanonicalEnvelope(ReadingKind.ProcessResult, "SCRW-01", "/api/v1/ingest/process-result",
                new() { ["idempotencyKey"] = $"SCRW-01:RC1:{i:000000}" }, $"SCRW-01:RC1:{i:000000}");
            var ack = await auto.SendAsync(env, default);
            Assert.True(ack.Success); // every call still succeeds via demo fallback
        }

        Assert.Equal(1, fireCount);
        Assert.True(auto.IsFallingBack);
    }

    // Regression for the ACTUAL race the lock fixes: many callers hitting AutoTransport concurrently
    // (e.g. foreground SendAsync racing a background heartbeat timer, per the real architecture) must
    // still observe exactly one FallbackChanged(true). With SetFallingBack's lock-guarded
    // compare-and-set this is deterministic (never flaky); without the lock, two threads can both read
    // IsFallingBack==false before either writes and both fire the event, so fireCount could exceed 1.
    [Fact]
    public async Task FallbackChanged_fires_exactly_once_under_concurrent_calls()
    {
        var auto = new AutoTransport(new DownTransport(), new DemoTransport(latencyMs: 0));
        var fireCount = 0;
        auto.FallbackChanged += _ => Interlocked.Increment(ref fireCount);

        var env = new CanonicalEnvelope(ReadingKind.ProcessResult, "SCRW-01", "/api/v1/ingest/process-result",
            new() { ["idempotencyKey"] = "SCRW-01:RC1:concurrent" }, "SCRW-01:RC1:concurrent");

        await Task.WhenAll(Enumerable.Range(0, 50).Select(_ => auto.SendAsync(env, default)));

        Assert.Equal(1, fireCount);
        Assert.True(auto.IsFallingBack);
    }
}
