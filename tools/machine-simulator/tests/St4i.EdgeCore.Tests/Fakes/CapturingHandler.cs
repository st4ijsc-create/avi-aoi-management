using System.Net;
using System.Net.Http;
namespace St4i.EdgeCore.Tests.Fakes;
public sealed class CapturingHandler : HttpMessageHandler
{
    public HttpRequestMessage? LastRequest; public string? LastBody;
    public Func<HttpRequestMessage,string,(HttpStatusCode,string)> Responder =
        (_, _) => (HttpStatusCode.Created, "{\"ok\":true,\"data\":{\"success\":true,\"inspectionId\":501}}");
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage req, CancellationToken ct)
    {
        LastRequest = req; LastBody = req.Content is null ? null : await req.Content.ReadAsStringAsync(ct);
        var (code, body) = Responder(req, LastBody ?? "");
        return new HttpResponseMessage(code){ Content = new StringContent(body) };
    }
}
