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

    // Regression: an OK measurement point has no defect — the Normalizer leaves defectSeverity/
    // defectCatalogCode null. LiveTransport used to coerce that to "" via `?? ""`, which serialized as
    // `"defectSeverity":""` on the wire. The live server schema is
    // `defectSeverity: z.enum([...]).optional()` — .optional() allows the KEY to be absent, but rejects
    // an empty string, so the whole `measurements` array failed validation and the server rejected the
    // entire inspection with HTTP 400. Since OK points dominate real traffic this broke the common case.
    [Fact]
    public async Task Inspection_send_with_OK_point_omits_empty_defectSeverity()
    {
        var h = new CapturingHandler
        {
            Responder = (_, __) => (System.Net.HttpStatusCode.Created,
                "{\"ok\":true,\"data\":{\"success\":true,\"inspectionId\":501}}"),
        };
        var live = LiveTransport.ForMachine("http://x", "mk_test", "AOI-01", null, true, h);
        var env = new CanonicalEnvelope(ReadingKind.Inspection, "AOI-01", "/api/v1/ingest/inspection",
            new()
            {
                ["serialNumber"] = "SN1",
                ["overallResult"] = "OK",
                ["idempotencyKey"] = "AOI-01:MB-X1-TOP:000001",
                ["measurements"] = new List<object>
                {
                    new Dictionary<string, object> { ["pointCode"] = "R12", ["result"] = "OK" },
                },
            }, "AOI-01:MB-X1-TOP:000001");

        var ack = await live.SendAsync(env, default);

        Assert.True(ack.Success);
        Assert.Equal(501, ack.Id);
        Assert.Contains("/api/v1/ingest/inspection", h.LastRequest!.RequestUri!.ToString());
        Assert.DoesNotContain("\"defectSeverity\":\"\"", h.LastBody);
        Assert.DoesNotContain("\"defectCatalogCode\":\"\"", h.LastBody);
    }
}
