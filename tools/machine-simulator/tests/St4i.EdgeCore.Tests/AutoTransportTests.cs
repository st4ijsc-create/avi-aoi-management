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
}
