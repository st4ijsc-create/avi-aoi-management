using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Text;

namespace St4i.EngineApi.Tests.Alarms;

/// <summary>What a scripted receiver answers with. <see langword="null"/> from the responder means "accept
/// the request, capture it, and then never answer" — the black-holing receiver the timeout, budget and
/// cancellation tests need.</summary>
/// <param name="Status">The HTTP status code to return.</param>
/// <param name="Reason">The reason phrase, which the channel reports in its failure message.</param>
/// <param name="Headers">Extra response headers, e.g. <c>Retry-After</c> or <c>Location</c>.</param>
internal sealed record ScriptedResponse(
    int Status,
    string Reason = "Scripted",
    IReadOnlyList<(string Name, string Value)>? Headers = null);

/// <summary>
/// 🔴 Task C-3 — a REAL in-process HTTP/1.1 receiver for the webhook tests, on a raw
/// <see cref="TcpListener"/>.
///
/// <para>The brief requires the payload and headers to be asserted "against a real in-process HTTP
/// listener, not a mock", following this repository's driver-loopback precedent
/// (<c>ModbusLoopbackHarness</c>, <c>OpcUaLoopbackHarness</c>): port 0 so the OS assigns, an
/// <see cref="IAsyncDisposable"/> with strictly ordered best-effort teardown, and a listener that a test
/// can make behave badly on purpose.</para>
///
/// <para><b>Why a raw socket rather than <c>HttpListener</c> or a Kestrel test server.</b> Two of the
/// things this suite has to prove need behaviour no HTTP abstraction will give up: <b>the exact request
/// BYTES</b> — the signature is computed over them, and a receiver that re-serialises a parsed body cannot
/// verify one, so a test that asserted on a deserialised object would be testing something weaker than the
/// contract — and <b>accepting a connection and then never answering</b>, which is what makes the attempt
/// timeout, the retry budget and prompt cancellation observable at all.</para>
/// </summary>
internal sealed class WebhookLoopbackServer : IAsyncDisposable
{
    /// <summary>One captured request, with its body as the raw bytes that arrived on the wire.</summary>
    internal sealed record Captured(
        string Method,
        string Target,
        IReadOnlyDictionary<string, string> Headers,
        byte[] Body)
    {
        public string BodyText => Encoding.UTF8.GetString(Body);

        public string? Header(string name) => Headers.TryGetValue(name, out var value) ? value : null;
    }

    private readonly TcpListener _listener;
    private readonly CancellationTokenSource _cts = new();
    private readonly Task _loop;
    private readonly ConcurrentQueue<Captured> _requests = new();
    private readonly Func<int, ScriptedResponse?> _responder;
    private int _served;

    /// <param name="responder">Given the 1-based ordinal of the request as the server saw it, what to
    /// answer. <see langword="null"/> means "accept and go silent".</param>
    private WebhookLoopbackServer(TcpListener listener, Func<int, ScriptedResponse?> responder)
    {
        _listener = listener;
        _responder = responder;
        Port = ((IPEndPoint)listener.LocalEndpoint).Port;
        _loop = Task.Run(() => AcceptLoopAsync(_cts.Token));
    }

    public int Port { get; }

    /// <summary>Every request the server has finished reading, in arrival order.</summary>
    public IReadOnlyList<Captured> Requests => _requests.ToArray();

    /// <summary>A URL on this server. The default path is shaped like a real Slack incoming webhook — the
    /// capability lives entirely in the path — so a leak test can put its sentinel there and keep it
    /// distinct from the <c>scheme://host:port</c> endpoint C-2 classifies as non-secret.</summary>
    public string Url(string path = "/services/T000/B000/loopback") => $"http://127.0.0.1:{Port}{path}";

    public static WebhookLoopbackServer Start(Func<int, ScriptedResponse?> responder)
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        return new WebhookLoopbackServer(listener, responder);
    }

    /// <summary>Always answers the same thing.</summary>
    public static WebhookLoopbackServer Start(ScriptedResponse? response) => Start(_ => response);

    /// <summary>A port nothing is listening on — bound then released, the same find-and-release idiom the
    /// OPC-UA and Modbus conformance suites use for their "unreachable device" cases.</summary>
    public static int FindClosedPort()
    {
        var probe = new TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        var port = ((IPEndPoint)probe.LocalEndpoint).Port;
        probe.Stop();
        return port;
    }

    private async Task AcceptLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            TcpClient client;
            try
            {
                client = await _listener.AcceptTcpClientAsync(ct).ConfigureAwait(false);
            }
            catch
            {
                return; // stopped, or torn down
            }

            _ = Task.Run(() => HandleAsync(client, ct), CancellationToken.None);
        }
    }

    private async Task HandleAsync(TcpClient client, CancellationToken ct)
    {
        using (client)
        {
            try
            {
                using var stream = client.GetStream();

                var request = await ReadRequestAsync(stream, ct).ConfigureAwait(false);
                if (request is null) return;

                _requests.Enqueue(request);
                var ordinal = Interlocked.Increment(ref _served);

                var response = _responder(ordinal);
                if (response is null)
                {
                    // Accept and go silent — hold the connection open until teardown, so the CLIENT is the
                    // one that has to decide when to give up. That decision is what these tests measure.
                    await Task.Delay(Timeout.Infinite, ct).ConfigureAwait(false);
                    return;
                }

                await WriteResponseAsync(stream, response, ct).ConfigureAwait(false);
            }
            catch
            {
                // Client hung up, or the server is being torn down. Both are ordinary here.
            }
        }
    }

    private static async Task<Captured?> ReadRequestAsync(NetworkStream stream, CancellationToken ct)
    {
        var head = new List<byte>(1024);
        var one = new byte[1];

        while (true)
        {
            var read = await stream.ReadAsync(one, ct).ConfigureAwait(false);
            if (read == 0) return null;
            head.Add(one[0]);

            if (head.Count >= 4 &&
                head[^4] == (byte)'\r' && head[^3] == (byte)'\n' &&
                head[^2] == (byte)'\r' && head[^1] == (byte)'\n')
            {
                break;
            }

            if (head.Count > 64 * 1024) return null;
        }

        var lines = Encoding.ASCII.GetString(head.ToArray())
            .Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
        if (lines.Length == 0) return null;

        var requestLine = lines[0].Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (requestLine.Length < 2) return null;

        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in lines.Skip(1))
        {
            var colon = line.IndexOf(':', StringComparison.Ordinal);
            if (colon <= 0) continue;
            headers[line[..colon].Trim()] = line[(colon + 1)..].Trim();
        }

        var length = headers.TryGetValue("Content-Length", out var raw) && int.TryParse(raw, out var parsed)
            ? parsed
            : 0;

        var body = new byte[length];
        var got = 0;
        while (got < length)
        {
            var read = await stream.ReadAsync(body.AsMemory(got), ct).ConfigureAwait(false);
            if (read == 0) break;
            got += read;
        }

        return new Captured(requestLine[0], requestLine[1], headers, body);
    }

    private static async Task WriteResponseAsync(
        NetworkStream stream, ScriptedResponse response, CancellationToken ct)
    {
        var head = new StringBuilder();
        head.Append($"HTTP/1.1 {response.Status} {response.Reason}\r\n");
        foreach (var (name, value) in response.Headers ?? Array.Empty<(string, string)>())
        {
            head.Append($"{name}: {value}\r\n");
        }
        // Content-Length: 0 plus Connection: close keeps framing unambiguous without keep-alive
        // bookkeeping; the channel deliberately never reads a response body anyway.
        head.Append("Content-Length: 0\r\nConnection: close\r\n\r\n");

        await stream.WriteAsync(Encoding.ASCII.GetBytes(head.ToString()), ct).ConfigureAwait(false);
        await stream.FlushAsync(ct).ConfigureAwait(false);
    }

    public async ValueTask DisposeAsync()
    {
        try { await _cts.CancelAsync().ConfigureAwait(false); } catch { /* best-effort teardown */ }
        try { _listener.Stop(); } catch { /* best-effort teardown */ }
        try { await _loop.ConfigureAwait(false); } catch { /* best-effort teardown */ }
        _cts.Dispose();
    }
}
