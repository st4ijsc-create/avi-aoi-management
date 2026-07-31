using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Text;

namespace St4i.EngineApi.Tests.Alarms;

/// <summary>
/// How the scripted relay should behave. Every field is a REPLY the server sends at a specific point in
/// the SMTP conversation, so a test can reproduce a real relay's failure exactly rather than approximating
/// it with a mock.
/// </summary>
/// <param name="Greeting">The <c>220</c> banner, or <see langword="null"/> to accept the connection and
/// then say NOTHING — the black-holing relay the timeout, budget and cancellation tests need.</param>
/// <param name="EhloReply">The reply to <c>EHLO</c>. Multi-line replies use <c>\r\n</c>.</param>
/// <param name="AuthReply">The final reply to an <c>AUTH</c> exchange (after the base64 rounds).</param>
/// <param name="AuthCommandReply">🔴 A reply to the <c>AUTH</c> COMMAND ITSELF, refusing it outright with
/// no <c>334</c> prompt at all — which is what a relay does when it will not accept the offered mechanism.
/// Distinct from <paramref name="AuthReply"/> (which rejects the credential AFTER collecting it), because
/// the two are different failure shapes and C-4's review found the channel behaves identically in both:
/// <see cref="System.Net.Mail.SmtpClient"/> carries on unauthenticated either way. <see langword="null"/>
/// means "prompt normally".</param>
/// <param name="MailFromReply">The reply to <c>MAIL FROM</c>.</param>
/// <param name="RcptToReply">Given the recipient as the server saw it (e.g. <c>&lt;ops@plant.local&gt;</c>),
/// the reply. <see langword="null"/> means <c>250 OK</c>.</param>
/// <param name="DataReply">The final reply after the message body's terminating dot.</param>
internal sealed record SmtpScript(
    string? Greeting = "220 st4i-test ESMTP",
    string EhloReply = "250-st4i-test\r\n250 8BITMIME",
    string AuthReply = "235 2.7.0 Authentication succeeded",
    string? AuthCommandReply = null,
    string MailFromReply = "250 OK",
    Func<string, string>? RcptToReply = null,
    string DataReply = "250 2.0.0 OK queued");

/// <summary>
/// 🔴 Task C-4 — a REAL in-process SMTP relay for the e-mail tests, on a raw <see cref="TcpListener"/>.
///
/// <para>The brief requires a successful send to be proved against an in-process SMTP server with the
/// ENVELOPE and the MESSAGE CONTENT asserted, not merely "no exception was thrown". This follows the
/// precedent already in this repository — <c>ModbusLoopbackHarness</c>, <c>OpcUaLoopbackHarness</c> and
/// C-3's <c>WebhookLoopbackServer</c>: port 0 so the OS assigns, an <see cref="IAsyncDisposable"/> with
/// ordered best-effort teardown, and a relay a test can make misbehave on purpose.</para>
///
/// <para><b>Why a raw socket.</b> Two things this suite must prove need what no SMTP abstraction gives up:
/// <b>the exact conversation</b> — the envelope (<c>MAIL FROM</c>/<c>RCPT TO</c>) is a different thing from
/// the message headers (<c>From:</c>/<c>To:</c>) and a test that could not see both would be asserting the
/// weaker one — and <b>accepting a connection and then never answering</b>, which is what makes the attempt
/// timeout, the retry budget and prompt cancellation observable at all.</para>
/// </summary>
internal sealed class SmtpLoopbackServer : IAsyncDisposable
{
    /// <summary>One complete message as the relay received it.</summary>
    /// <param name="MailFrom">The envelope sender, unwrapped from its angle brackets.</param>
    /// <param name="RcptTo">The envelope recipients, in the order the client offered them, unwrapped.</param>
    /// <param name="AcceptedRcptTo">The subset the scripted relay answered 2xx to.</param>
    /// <param name="Headers">The message's own headers, unfolded, in arrival order.</param>
    /// <param name="Body">The decoded message body.</param>
    /// <param name="AuthExchange">Every line the client sent inside an <c>AUTH</c> exchange, base64 as it
    /// appeared on the wire — so a test can prove what was and was not transmitted.</param>
    internal sealed record Received(
        string MailFrom,
        IReadOnlyList<string> RcptTo,
        IReadOnlyList<string> AcceptedRcptTo,
        IReadOnlyList<(string Name, string Value)> Headers,
        string Body,
        IReadOnlyList<string> AuthExchange)
    {
        public string? Header(string name) => Headers
            .Where(h => string.Equals(h.Name, name, StringComparison.OrdinalIgnoreCase))
            .Select(h => h.Value)
            .FirstOrDefault();

        public IReadOnlyList<string> AllHeaders(string name) => Headers
            .Where(h => string.Equals(h.Name, name, StringComparison.OrdinalIgnoreCase))
            .Select(h => h.Value)
            .ToArray();
    }

    private readonly TcpListener _listener;
    private readonly CancellationTokenSource _cts = new();
    private readonly Task _loop;
    private readonly ConcurrentQueue<Received> _messages = new();
    private readonly Func<int, SmtpScript?> _script;
    private int _connections;

    private SmtpLoopbackServer(TcpListener listener, Func<int, SmtpScript?> script)
    {
        _listener = listener;
        _script = script;
        Port = ((IPEndPoint)listener.LocalEndpoint).Port;
        _loop = Task.Run(() => AcceptLoopAsync(_cts.Token));
    }

    public int Port { get; }

    /// <summary>Every message the relay finished receiving, in arrival order.</summary>
    public IReadOnlyList<Received> Messages => _messages.ToArray();

    /// <summary>How many TCP connections the relay has accepted — i.e. how many ATTEMPTS the channel made,
    /// which is what the retry tests assert on.</summary>
    public int Connections => Volatile.Read(ref _connections);

    /// <param name="script">Given the 1-based ordinal of the connection, how to behave.
    /// <see langword="null"/> means "accept the connection and never speak".</param>
    public static SmtpLoopbackServer Start(Func<int, SmtpScript?> script)
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        return new SmtpLoopbackServer(listener, script);
    }

    /// <summary>Always behaves the same way.</summary>
    public static SmtpLoopbackServer Start(SmtpScript? script = null) =>
        Start(_ => script ?? new SmtpScript());

    /// <summary>A port nothing is listening on — bound then released, the same find-and-release idiom
    /// C-3's harness uses. Drives the refused-connection path.</summary>
    public static int ClosedPort()
    {
        var probe = new TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        var port = ((IPEndPoint)probe.LocalEndpoint).Port;
        probe.Stop();
        return port;
    }

    public const string Host = "127.0.0.1";

    private async Task AcceptLoopAsync(CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                var client = await _listener.AcceptTcpClientAsync(ct).ConfigureAwait(false);
                var ordinal = Interlocked.Increment(ref _connections);
                _ = Task.Run(() => ServeAsync(client, ordinal, ct), CancellationToken.None);
            }
        }
        catch (OperationCanceledException) { /* teardown */ }
        catch (ObjectDisposedException) { /* teardown */ }
        catch (SocketException) { /* teardown */ }
    }

    private async Task ServeAsync(TcpClient client, int ordinal, CancellationToken ct)
    {
        try
        {
            using (client)
            {
                var script = _script(ordinal);
                using var stream = client.GetStream();
                // Latin-1 so every byte round-trips: the client may send 8-bit or base64 content and the
                // test asserts on what actually arrived, not on what a decoder guessed.
                using var reader = new StreamReader(stream, Encoding.Latin1);
                using var writer = new StreamWriter(stream, Encoding.Latin1)
                {
                    AutoFlush = true,
                    NewLine = "\r\n",
                };

                if (script?.Greeting is null)
                {
                    // Accept and go silent. Hold the connection open until teardown so the client's own
                    // timeout / budget / cancellation is what ends it — that is the whole point.
                    try { await Task.Delay(Timeout.Infinite, ct).ConfigureAwait(false); }
                    catch (OperationCanceledException) { }
                    return;
                }

                await writer.WriteLineAsync(script.Greeting).ConfigureAwait(false);
                await ConverseAsync(reader, writer, script, ct).ConfigureAwait(false);
            }
        }
        catch (Exception) { /* a test tore the connection down, or the client abandoned it */ }
    }

    private async Task ConverseAsync(
        StreamReader reader, StreamWriter writer, SmtpScript script, CancellationToken ct)
    {
        var mailFrom = "";
        var offered = new List<string>();
        var accepted = new List<string>();
        var auth = new List<string>();
        var authRounds = 0;

        string? line;
        while ((line = await reader.ReadLineAsync(ct).ConfigureAwait(false)) is not null)
        {
            if (authRounds > 0)
            {
                // Inside an AUTH LOGIN exchange: base64 username, then base64 password.
                auth.Add(line);
                authRounds--;
                await writer.WriteLineAsync(authRounds > 0 ? "334 UGFzc3dvcmQ6" : script.AuthReply)
                    .ConfigureAwait(false);
                continue;
            }

            if (line.StartsWith("EHLO", StringComparison.OrdinalIgnoreCase) ||
                line.StartsWith("HELO", StringComparison.OrdinalIgnoreCase))
            {
                await writer.WriteLineAsync(script.EhloReply).ConfigureAwait(false);
            }
            else if (line.StartsWith("STARTTLS", StringComparison.OrdinalIgnoreCase))
            {
                // Answered 5xx rather than 220: this harness speaks no TLS, and a test that needs to prove
                // the STARTTLS path took a decision needs a definite answer rather than a hang.
                await writer.WriteLineAsync("454 4.7.0 TLS not available in this test relay")
                    .ConfigureAwait(false);
            }
            else if (line.StartsWith("AUTH", StringComparison.OrdinalIgnoreCase))
            {
                auth.Add(line);

                if (script.AuthCommandReply is { } refusal)
                {
                    // The relay refuses the mechanism outright, with no 334 prompt. The client never gets
                    // to offer the password at all — and carries on unauthenticated regardless.
                    authRounds = 0;
                    await writer.WriteLineAsync(refusal).ConfigureAwait(false);
                    continue;
                }

                // 🔴 .NET sends the username INLINE on the AUTH line — "AUTH login <base64username>" —
                // rather than sending a bare "AUTH LOGIN" and waiting to be prompted for it (verified
                // against the BCL on the wire). A relay that prompts for the username anyway desynchronises
                // the exchange: the client answers the username prompt with its PASSWORD, and the
                // conversation never reaches MAIL FROM. Both shapes are handled, because RFC 4954 permits
                // either and a test relay that only understood the one .NET does not use would be testing
                // the wrong protocol.
                var inlineCredential = line.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length >= 3;
                authRounds = inlineCredential ? 1 : 2;
                await writer
                    .WriteLineAsync(inlineCredential ? "334 UGFzc3dvcmQ6" : "334 VXNlcm5hbWU6")
                    .ConfigureAwait(false);
            }
            else if (line.StartsWith("MAIL FROM", StringComparison.OrdinalIgnoreCase))
            {
                mailFrom = Unwrap(Argument(line));
                await writer.WriteLineAsync(script.MailFromReply).ConfigureAwait(false);
            }
            else if (line.StartsWith("RCPT TO", StringComparison.OrdinalIgnoreCase))
            {
                var raw = Argument(line);
                var recipient = Unwrap(raw);
                offered.Add(recipient);
                var reply = script.RcptToReply?.Invoke(raw) ?? "250 OK";
                if (reply.StartsWith('2')) accepted.Add(recipient);
                await writer.WriteLineAsync(reply).ConfigureAwait(false);
            }
            else if (line.StartsWith("DATA", StringComparison.OrdinalIgnoreCase))
            {
                await writer.WriteLineAsync("354 Start mail input").ConfigureAwait(false);
                var (headers, body) = await ReadMessageAsync(reader, ct).ConfigureAwait(false);
                _messages.Enqueue(new Received(
                    mailFrom, offered.ToArray(), accepted.ToArray(), headers, body, auth.ToArray()));
                await writer.WriteLineAsync(script.DataReply).ConfigureAwait(false);
            }
            else if (line.StartsWith("QUIT", StringComparison.OrdinalIgnoreCase))
            {
                await writer.WriteLineAsync("221 2.0.0 Bye").ConfigureAwait(false);
                return;
            }
            else if (line.StartsWith("RSET", StringComparison.OrdinalIgnoreCase))
            {
                mailFrom = "";
                offered.Clear();
                accepted.Clear();
                await writer.WriteLineAsync("250 OK").ConfigureAwait(false);
            }
            else
            {
                await writer.WriteLineAsync("250 OK").ConfigureAwait(false);
            }
        }
    }

    /// <summary>Reads the DATA section: headers (unfolded) then the body, undoing dot-stuffing and the
    /// content-transfer encoding so a test asserts on what a human would read.</summary>
    private static async Task<(IReadOnlyList<(string, string)>, string)> ReadMessageAsync(
        StreamReader reader, CancellationToken ct)
    {
        var headers = new List<(string, string)>();
        var body = new StringBuilder();
        var inHeaders = true;
        string? pendingName = null;
        var pendingValue = new StringBuilder();

        void FlushHeader()
        {
            if (pendingName is null) return;
            headers.Add((pendingName, pendingValue.ToString()));
            pendingName = null;
            pendingValue.Clear();
        }

        string? line;
        while ((line = await reader.ReadLineAsync(ct).ConfigureAwait(false)) is not null)
        {
            if (line == ".") break;
            // Undo dot-stuffing: a body line starting with '.' is transmitted with an extra one.
            if (line.StartsWith("..", StringComparison.Ordinal)) line = line[1..];

            if (inHeaders)
            {
                if (line.Length == 0)
                {
                    FlushHeader();
                    inHeaders = false;
                    continue;
                }

                if (line[0] is ' ' or '\t')
                {
                    // A folded continuation line. Joined without the fold so an encoded-word subject split
                    // across two lines reassembles.
                    pendingValue.Append(line.TrimStart());
                    continue;
                }

                FlushHeader();
                var colon = line.IndexOf(':');
                if (colon <= 0) continue;
                pendingName = line[..colon].Trim();
                pendingValue.Append(line[(colon + 1)..].TrimStart());
                continue;
            }

            body.Append(line).Append("\r\n");
        }

        FlushHeader();
        return (headers, Decode(headers, body.ToString()));
    }

    /// <summary>Undoes <c>base64</c>/<c>quoted-printable</c> transfer encoding, so a test can assert on the
    /// body text the recipient sees rather than on how .NET chose to encode it.</summary>
    private static string Decode(IReadOnlyList<(string Name, string Value)> headers, string body)
    {
        var encoding = headers
            .Where(h => string.Equals(h.Name, "Content-Transfer-Encoding", StringComparison.OrdinalIgnoreCase))
            .Select(h => h.Value.Trim())
            .FirstOrDefault();

        var charset = headers
            .Where(h => string.Equals(h.Name, "Content-Type", StringComparison.OrdinalIgnoreCase))
            .Select(h => h.Value)
            .FirstOrDefault() ?? "";
        var utf8 = charset.Contains("utf-8", StringComparison.OrdinalIgnoreCase);
        var text = utf8 ? (Encoding)new UTF8Encoding(false) : Encoding.Latin1;

        if (string.Equals(encoding, "base64", StringComparison.OrdinalIgnoreCase))
        {
            var packed = new string(body.Where(c => c is not ('\r' or '\n')).ToArray());
            try { return text.GetString(Convert.FromBase64String(packed)); }
            catch (FormatException) { return body; }
        }

        if (string.Equals(encoding, "quoted-printable", StringComparison.OrdinalIgnoreCase))
        {
            return DecodeQuotedPrintable(body, text);
        }

        return body;
    }

    private static string DecodeQuotedPrintable(string body, Encoding text)
    {
        var bytes = new List<byte>(body.Length);
        for (var i = 0; i < body.Length; i++)
        {
            if (body[i] != '=') { bytes.Add((byte)body[i]); continue; }

            // A soft line break: "=\r\n" means "this line continued".
            if (i + 2 < body.Length && body[i + 1] == '\r' && body[i + 2] == '\n') { i += 2; continue; }
            if (i + 1 < body.Length && body[i + 1] == '\n') { i += 1; continue; }

            if (i + 2 < body.Length &&
                byte.TryParse(body.AsSpan(i + 1, 2), System.Globalization.NumberStyles.HexNumber,
                    System.Globalization.CultureInfo.InvariantCulture, out var value))
            {
                bytes.Add(value);
                i += 2;
                continue;
            }

            bytes.Add((byte)'=');
        }

        return text.GetString(bytes.ToArray());
    }

    private static string Argument(string line)
    {
        var colon = line.IndexOf(':');
        return colon < 0 ? "" : line[(colon + 1)..].Trim();
    }

    private static string Unwrap(string address)
    {
        var value = address.Trim();
        // "<a@b> SIZE=123" — keep only the addr-spec.
        var space = value.IndexOf(' ');
        if (space > 0 && value.StartsWith('<')) value = value[..space];
        return value.Trim('<', '>').Trim();
    }

    public async ValueTask DisposeAsync()
    {
        // Ordered, best-effort teardown — the same shape as the driver loopback harnesses.
        try { await _cts.CancelAsync().ConfigureAwait(false); } catch { /* best-effort */ }
        try { _listener.Stop(); } catch { /* best-effort */ }
        try { await _loop.ConfigureAwait(false); } catch { /* best-effort */ }
        _cts.Dispose();
    }
}
