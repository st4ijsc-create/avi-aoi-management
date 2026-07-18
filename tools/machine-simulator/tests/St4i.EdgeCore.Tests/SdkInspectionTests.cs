using St4i.DeviceClient; using St4i.EdgeCore.Tests.Fakes; using Xunit;
public class SdkInspectionTests
{
    [Fact] public async Task SubmitInspection_posts_to_ingest_inspection_and_parses_id()
    {
        var h = new CapturingHandler();
        using var c = new St4iDeviceClient("http://x", mkKey:"mk_test", machineCode:"AOI-01", handler:h);
        var ack = await c.SubmitInspectionAsync("SN-1","NG",
            new[]{ new MeasurementPoint{ PointCode="R12", Result="NG", DefectCatalogCode="INSUFFICIENT_SOLDER" } },
            productModel:"MB-X1-TOP", idempotencyKey:"AOI-01:MB-X1-TOP:000001");
        Assert.True(ack.Success); Assert.Equal(501, ack.InspectionId);
        Assert.EndsWith("/api/v1/ingest/inspection", h.LastRequest!.RequestUri!.ToString());
        Assert.Contains("\"overallResult\":\"NG\"", h.LastBody);
        Assert.Contains("\"pointCode\":\"R12\"", h.LastBody);
    }
}
