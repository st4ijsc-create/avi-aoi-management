using St4i.DeviceClient;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EdgeCore.Tests.Fakes;
using Xunit;

public class LiveTransportTests
{
    [Fact]
    public async Task Process_send_hits_process_result_and_maps_id()
    {
        var h = new CapturingHandler
        {
            Responder = (_, __) => (System.Net.HttpStatusCode.Created,
                "{\"ok\":true,\"data\":{\"success\":true,\"processResultId\":27817}}"),
        };
        var live = LiveTransport.ForMachine("http://x", "mk_test", "SCRW-01", null, true, h);
        var env = new CanonicalEnvelope(ReadingKind.ProcessResult, "SCRW-01", "/api/v1/ingest/process-result",
            new()
            {
                ["serialNumber"] = "SN1",
                ["stepType"] = "screw_tightening",
                ["result"] = "pass",
                ["idempotencyKey"] = "SCRW-01:RC1:000001",
                ["metrics"] = new List<object> { new Dictionary<string, object> { ["name"] = "torque", ["value"] = 12.1 } },
            }, "SCRW-01:RC1:000001");

        var ack = await live.SendAsync(env, default);

        Assert.True(ack.Success);
        Assert.Equal(27817, ack.Id);
        Assert.Contains("/api/v1/ingest/process-result", h.LastRequest!.RequestUri!.ToString());
    }
}
