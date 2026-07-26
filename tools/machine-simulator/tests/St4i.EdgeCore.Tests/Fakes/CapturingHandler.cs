using System.Net;
using System.Net.Http;
namespace St4i.EdgeCore.Tests.Fakes;
public sealed class CapturingHandler : HttpMessageHandler
{
    public HttpRequestMessage? LastRequest; public string? LastBody;

    /// <summary>
    /// WS-C-T3 — every request this handler has ever seen, in send order, as (url, body). Purely additive
    /// alongside <see cref="LastRequest"/>/<see cref="LastBody"/> (still updated exactly as before, so
    /// every existing consumer that only reads those two keeps compiling/passing unchanged) — added so the
    /// WAL restart-survival/replay test can assert on the FULL ordered sequence a
    /// <c>FlushBacklogAsync</c> drain sends, not just the most recent request.
    /// </summary>
    public List<(string Url, string Body)> Requests { get; } = new();

    public Func<HttpRequestMessage,string,(HttpStatusCode,string)> Responder =
        (_, _) => (HttpStatusCode.Created, "{\"ok\":true,\"data\":{\"success\":true,\"inspectionId\":501}}");
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage req, CancellationToken ct)
    {
        LastRequest = req; LastBody = req.Content is null ? null : await req.Content.ReadAsStringAsync(ct);
        Requests.Add((req.RequestUri?.ToString() ?? "", LastBody ?? ""));
        var (code, body) = Responder(req, LastBody ?? "");
        return new HttpResponseMessage(code){ Content = new StringContent(body) };
    }
}
