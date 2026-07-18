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

    // Regression for the transition guard: FallbackChanged must fire exactly ONCE across many calls
    // that all observe the same false->true transition, not once per call. A naive unsynchronized
    // read-then-write of IsFallingBack (or, in a concurrent caller, two threads racing on it) would
    // fire the event on every single fallback call instead of only the first.
    [Fact]
    public async Task FallbackChanged_fires_exactly_once_across_multiple_failing_calls()
    {
        var auto = new AutoTransport(new DownTransport(), new DemoTransport(latencyMs: 0));
        var fireCount = 0;
        auto.FallbackChanged += _ => Interlocked.Increment(ref fireCount);

        for (var i = 0; i < 5; i++)
        {
            var env = new CanonicalEnvelope(ReadingKind.ProcessResult, "SCRW-01", "/api/v1/ingest/process-result",
                new() { ["idempotencyKey"] = $"SCRW-01:RC1:{i:000000}" }, $"SCRW-01:RC1:{i:000000}");
            var ack = await auto.SendAsync(env, default);
            Assert.True(ack.Success); // every call still succeeds via demo fallback
        }

        Assert.Equal(1, fireCount);
        Assert.True(auto.IsFallingBack);
    }
}
