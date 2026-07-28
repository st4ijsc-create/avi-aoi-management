using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Transport;
using St4i.EdgeCore.Mapping;
using Xunit;

public class DemoTransportTests
{
    static CanonicalEnvelope Proc(string key) => new(ReadingKind.ProcessResult, "SCRW-01", "/api/v1/ingest/process-result",
        new() { ["result"] = "pass", ["idempotencyKey"] = key }, key);

    [Fact]
    public async Task First_send_gets_id_replay_is_duplicate()
    {
        var t = new DemoTransport(latencyMs: 0);
        var a = await t.SendAsync(Proc("SCRW-01:RC1:000001"), default);
        var b = await t.SendAsync(Proc("SCRW-01:RC1:000001"), default);
        Assert.True(a.Success); Assert.NotNull(a.Id);
        Assert.Equal(a.Id, b.Id); Assert.True(b.Duplicate);
    }

    [Fact]
    public async Task Telemetry_accepts_all_samples()
    {
        var t = new DemoTransport(latencyMs: 0);
        var env = new CanonicalEnvelope(ReadingKind.Telemetry, "ESP-01", "/api/v1/ingest/telemetry",
            new() { ["samples"] = new List<object> { new { }, new { } } }, "ESP-01:t:1");
        var a = await t.SendAsync(env, default);
        Assert.Equal(2, a.Accepted); Assert.Equal(202, a.HttpStatus);
    }
}
