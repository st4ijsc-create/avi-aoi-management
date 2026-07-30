using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using St4i.EngineApi.Alarms;
using Xunit;

namespace St4i.EngineApi.Tests.Alarms;

/// <summary>
/// 🔴 Task C-3 — <see cref="WebhookNotificationChannel"/>: the wire contract, the signature a customer's
/// receiver has to be able to verify, the retry policy and its bound, prompt cancellation, and the rule
/// that no credential — the signing secret, the auth token, or the destination URL, which for Slack and
/// Teams IS the credential — reaches a log line.
///
/// <para>Every test posts to a REAL in-process HTTP receiver (<see cref="WebhookLoopbackServer"/>) and
/// reads a REAL <see cref="NotificationConfigStore"/>, for the same reason <c>AlarmNotifierTests</c> drives
/// a real <see cref="AlarmStore"/>: a fake would define away exactly the things under test — the raw bytes
/// the signature covers, and the DPAPI round trip the URL and secrets take.</para>
/// </summary>
public sealed class WebhookNotificationChannelTests : IDisposable
{
    private readonly List<string> _tempDirs = new();

    public void Dispose()
    {
        foreach (var dir in _tempDirs)
        {
            try { Directory.Delete(dir, recursive: true); } catch { /* best-effort cleanup */ }
        }
    }

    private string NewTempDir()
    {
        var dir = Directory.CreateTempSubdirectory("st4i-webhook-channel-tests-").FullName;
        _tempDirs.Add(dir);
        return dir;
    }

    private NotificationConfigStore NewStore() => new(NewTempDir());

    /// <summary>Distinctive enough that finding it anywhere is proof of a leak.</summary>
    private const string UrlPathSentinel = "URLPATH-do-not-leak-7f21c4";
    private const string SigningSentinel = "SIGNKEY-do-not-leak-9a34de";
    private const string TokenSentinel = "AUTHTOK-do-not-leak-51bb08";

    private static readonly DateTimeOffset FixedNow =
        new(2026, 7, 30, 9, 15, 22, TimeSpan.Zero);

    private static Alarm MakeAlarm(
        string key = "DriverHealth|DOWN|MODBUS-01",
        AlarmPriority priority = AlarmPriority.High,
        AlarmState state = AlarmState.Active) =>
        new(1, key, AlarmSource.DriverHealth, "DOWN", priority, state,
            "Driver MODBUS-01 is unreachable", "runbook://drivers/down", "MODBUS-01",
            ClearOnAck: false, Count: 7,
            FirstRaisedUtc: new DateTimeOffset(2026, 7, 30, 9, 0, 0, TimeSpan.Zero),
            LastRaisedUtc: new DateTimeOffset(2026, 7, 30, 9, 15, 0, TimeSpan.Zero),
            AckedUtc: null, AckedBy: null);

    private static NotificationJob MakeJob(
        AlarmEdgeKind edge = AlarmEdgeKind.Raised,
        Alarm? alarm = null,
        AlarmPriority? previousPriority = null,
        string? actor = null,
        long sequence = 42) =>
        new(sequence, edge, alarm ?? MakeAlarm(), FixedNow, previousPriority, actor);

    /// <summary>A channel with test-sized budgets. The DEFAULTS are asserted separately
    /// (<see cref="TheDocumentedDefaults_AreWhatTheChannelActuallyUses"/>) so shrinking them here cannot
    /// quietly change what ships.</summary>
    private static WebhookNotificationChannel NewChannel(
        NotificationConfigStore store,
        ICollection<string>? warnings = null,
        ICollection<(Exception Cause, string Message)>? errors = null,
        TimeSpan? attemptTimeout = null,
        TimeSpan? totalBudget = null,
        TimeSpan? baseBackoff = null,
        int maxAttempts = 3,
        Func<DateTimeOffset>? clock = null) =>
        new(store,
            logError: (ex, msg) => { if (errors is not null) lock (errors) errors.Add((ex, msg)); },
            logWarning: msg => { if (warnings is not null) lock (warnings) warnings.Add(msg); },
            sourceHost: "TEST-ENGINE",
            attemptTimeout: attemptTimeout ?? TimeSpan.FromSeconds(2),
            totalBudget: totalBudget ?? TimeSpan.FromSeconds(5),
            baseBackoff: baseBackoff ?? TimeSpan.FromMilliseconds(20),
            maxAttempts: maxAttempts,
            clock: clock ?? (() => FixedNow));

    /// <summary>Runs raw SQL against the store's own database — for reproducing corruption states the
    /// store's API cannot produce, which is the whole point of the tests that use it.</summary>
    private static void ExecuteSql(NotificationConfigStore store, string sql)
    {
        using var connection = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={store.DbPath}");
        connection.Open();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
    }

    /// <summary>Overwrites a stored secret's DPAPI ciphertext with bytes that cannot be unprotected, while
    /// LEAVING THE ROW — exactly what a <c>notifications.db</c> copied from another machine looks like to
    /// this one, and the state review round 1 (I-1) found was being silently tolerated.</summary>
    private static void CorruptStoredSecret(NotificationConfigStore store, string name) =>
        ExecuteSql(store,
            $"UPDATE notification_secrets SET secret = X'DEADBEEFDEADBEEF' WHERE name = '{name}';");

    /// <summary>🔴 The verification recipe from <see cref="WebhookSigner"/>'s doc comment, implemented HERE
    /// from scratch the way a customer's receiver would — raw BCL <see cref="HMACSHA256"/> over the raw
    /// body bytes. It deliberately shares no code with the production signer: a test that re-used
    /// <c>WebhookSigner.Sign</c> would prove only that a function equals itself.</summary>
    private static string ReceiverSideSignature(string timestampHeader, byte[] rawBody, string sharedSecret)
    {
        var timestamp = Encoding.UTF8.GetBytes(timestampHeader);
        var separator = Encoding.UTF8.GetBytes(".");
        var material = timestamp.Concat(separator).Concat(rawBody).ToArray();

        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(sharedSecret));
        var digest = hmac.ComputeHash(material);

        var hex = new StringBuilder(digest.Length * 2);
        foreach (var b in digest) hex.Append(b.ToString("x2"));
        return "v1=" + hex;
    }

    // ─────────────────────────────────────────────────────────────────────
    // 1. The wire contract.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 The public interface, asserted field by field against a real receiver. Everything here is
    /// something a customer's code will depend on and that this product may not change quietly.
    /// </summary>
    [Fact]
    public async Task ASuccessfulPost_CarriesEveryDocumentedHeaderAndPayloadField()
    {
        await using var server = WebhookLoopbackServer.Start(new ScriptedResponse(200, "OK"));
        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(
            enabled: true, AlarmPriority.High, server.Url(), label: "Ops Slack"));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret, SigningSentinel));

        using var channel = NewChannel(store);
        await channel.DispatchAsync(MakeJob(
            edge: AlarmEdgeKind.Escalated, previousPriority: AlarmPriority.High, actor: "operator1"));

        var request = Assert.Single(server.Requests);

        // ── The request line and headers ──────────────────────────────────
        Assert.Equal("POST", request.Method);
        Assert.Equal("/services/T000/B000/loopback", request.Target);
        Assert.Equal("application/json; charset=utf-8", request.Header("Content-Type"));
        Assert.Equal(WebhookContract.UserAgent, request.Header("User-Agent"));
        Assert.Equal("Escalated", request.Header(WebhookContract.EventHeader));
        Assert.Equal(
            FixedNow.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture),
            request.Header(WebhookContract.TimestampHeader));

        var deliveryHeader = request.Header(WebhookContract.DeliveryHeader);
        Assert.False(string.IsNullOrWhiteSpace(deliveryHeader));

        // ── The body ──────────────────────────────────────────────────────
        using var body = JsonDocument.Parse(request.Body);
        var root = body.RootElement;

        Assert.Equal(1, root.GetProperty("specVersion").GetInt32());
        Assert.Equal("st4i.alarm.edge", root.GetProperty("type").GetString());
        Assert.Equal(deliveryHeader, root.GetProperty("deliveryId").GetString());
        Assert.Equal("2026-07-30T09:15:22.0000000Z", root.GetProperty("sentAtUtc").GetString());

        // 🔴 The Slack/Teams compatibility field — without a top-level `text` a Slack incoming webhook
        // rejects the whole body as invalid_payload, which is the difference between "one payload reaches
        // all four targets" and "the blueprint's premise is wrong".
        var text = root.GetProperty("text").GetString()!;
        Assert.Contains("[HIGH]", text, StringComparison.Ordinal);
        Assert.Contains("ESCALATED", text, StringComparison.Ordinal);
        Assert.Contains("DriverHealth/DOWN", text, StringComparison.Ordinal);
        Assert.Contains("MODBUS-01", text, StringComparison.Ordinal);
        Assert.Contains("Driver MODBUS-01 is unreachable", text, StringComparison.Ordinal);
        Assert.Contains("TEST-ENGINE", text, StringComparison.Ordinal);
        Assert.Contains("operator1", text, StringComparison.Ordinal);

        var source = root.GetProperty("source");
        Assert.Equal("st4i-machine-simulator", source.GetProperty("product").GetString());
        Assert.Equal("TEST-ENGINE", source.GetProperty("host").GetString());
        Assert.Equal("default", source.GetProperty("channelInstance").GetString());

        var edge = root.GetProperty("edge");
        Assert.Equal("Escalated", edge.GetProperty("kind").GetString());
        Assert.Equal(42, edge.GetProperty("sequence").GetInt64());
        Assert.Equal("2026-07-30T09:15:22.0000000Z", edge.GetProperty("atUtc").GetString());
        Assert.Equal("High", edge.GetProperty("previousPriority").GetString());
        Assert.Equal("operator1", edge.GetProperty("actor").GetString());

        var alarm = root.GetProperty("alarm");
        Assert.Equal("DriverHealth|DOWN|MODBUS-01", alarm.GetProperty("key").GetString());
        Assert.Equal("DriverHealth", alarm.GetProperty("source").GetString());
        Assert.Equal("DOWN", alarm.GetProperty("code").GetString());
        Assert.Equal("High", alarm.GetProperty("priority").GetString());
        Assert.Equal("Active", alarm.GetProperty("state").GetString());
        Assert.Equal("Driver MODBUS-01 is unreachable", alarm.GetProperty("message").GetString());
        Assert.Equal("runbook://drivers/down", alarm.GetProperty("runbook").GetString());
        Assert.Equal("MODBUS-01", alarm.GetProperty("targetId").GetString());
        Assert.False(alarm.GetProperty("clearOnAck").GetBoolean());
        Assert.Equal(7, alarm.GetProperty("count").GetInt32());
        Assert.Equal("2026-07-30T09:00:00.0000000Z", alarm.GetProperty("firstRaisedUtc").GetString());
        Assert.Equal("2026-07-30T09:15:00.0000000Z", alarm.GetProperty("lastRaisedUtc").GetString());

        // 🔴 Nulls are PRESENT, not omitted: a receiver's schema must not watch fields come and go with the
        // edge kind.
        Assert.Equal(JsonValueKind.Null, alarm.GetProperty("ackedUtc").ValueKind);
        Assert.Equal(JsonValueKind.Null, alarm.GetProperty("ackedBy").ValueKind);

        // 🔴 Alarm.Id is the SQLite rowid, which SQLite REUSES after a delete — a receiver keying on it
        // would silently merge two unrelated alarms, so it is deliberately absent.
        Assert.False(alarm.TryGetProperty("id", out _));

        var stats = channel.Stats;
        Assert.Equal(1, stats.Considered);
        Assert.Equal(1, stats.Delivered);
        Assert.Equal(0, stats.Lost);
        Assert.Equal(0, stats.Unsigned);
        Assert.Equal(1, stats.Attempts);
        Assert.Equal(0, stats.Retries);
    }

    /// <summary>
    /// 🔴 THE signature test: the recipe in <see cref="WebhookSigner"/>'s documentation, implemented
    /// independently, produces exactly the header that was sent. If this passes, somebody can write a
    /// receiver from the docs alone; if it fails, the signature is decoration.
    /// </summary>
    [Fact]
    public async Task TheSignature_VerifiesWhenRecomputedIndependentlyFromTheDocumentedRecipe()
    {
        await using var server = WebhookLoopbackServer.Start(new ScriptedResponse(204, "No Content"));
        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, server.Url()));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret, SigningSentinel));

        using var channel = NewChannel(store);
        await channel.DispatchAsync(MakeJob());

        var request = Assert.Single(server.Requests);
        var timestamp = request.Header(WebhookContract.TimestampHeader)!;
        var signature = request.Header(WebhookContract.SignatureHeader)!;

        // Step 1 of the recipe: the scheme tag must be there and must be v1.
        Assert.StartsWith("v1=", signature, StringComparison.Ordinal);
        Assert.Equal(3 + 64, signature.Length); // "v1=" + 32 bytes of SHA-256 as lowercase hex

        // Steps 3-5, computed the way a customer's receiver would, over the RAW bytes.
        Assert.Equal(ReceiverSideSignature(timestamp, request.Body, SigningSentinel), signature);

        // Non-vacuity: the wrong key does not verify, so the assertion above is about the KEY and not just
        // about two strings that happen to be equal.
        Assert.NotEqual(ReceiverSideSignature(timestamp, request.Body, "a-different-key"), signature);

        // And the body really was signed: flip one byte and the signature no longer matches.
        var tampered = request.Body.ToArray();
        tampered[^2] ^= 0x01;
        Assert.NotEqual(ReceiverSideSignature(timestamp, tampered, SigningSentinel), signature);
    }

    /// <summary>
    /// 🔴 Replay protection, proved rather than asserted: the timestamp is INSIDE the signed material, so a
    /// captured request cannot be re-stamped with a fresh time to slip past a receiver's tolerance check.
    /// A scheme that merely SENT a timestamp alongside the body would pass a "the signature verifies" test
    /// and fail this one.
    /// </summary>
    [Fact]
    public async Task TheTimestampIsBoundIntoTheSignature_SoARestampedReplayCannotVerify()
    {
        await using var server = WebhookLoopbackServer.Start(new ScriptedResponse(200));
        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, server.Url()));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret, SigningSentinel));

        using var channel = NewChannel(store);
        await channel.DispatchAsync(MakeJob());

        var request = Assert.Single(server.Requests);
        var timestamp = long.Parse(request.Header(WebhookContract.TimestampHeader)!);
        var signature = request.Header(WebhookContract.SignatureHeader)!;

        // The genuine pair verifies...
        Assert.Equal(ReceiverSideSignature(timestamp.ToString(), request.Body, SigningSentinel), signature);

        // ...and an attacker who replays the identical body an hour later, with a timestamp inside the
        // receiver's tolerance, cannot produce a matching signature without the key.
        var replayed = timestamp + WebhookSigner.ReplayToleranceSeconds + 60;
        Assert.NotEqual(ReceiverSideSignature(replayed.ToString(), request.Body, SigningSentinel), signature);
    }

    /// <summary>With no signing secret the POST is UNSIGNED — and sends neither header rather than a blank
    /// one, so a receiver checking "is the signature header present" cannot be fooled. Legitimate for
    /// Slack/Teams (the URL is the credential there), and counted so it is visible.</summary>
    [Fact]
    public async Task WithNoSigningSecret_NeitherSignatureNorTimestampIsSent_AndItIsCounted()
    {
        await using var server = WebhookLoopbackServer.Start(new ScriptedResponse(200));
        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, server.Url()));

        using var channel = NewChannel(store);
        await channel.DispatchAsync(MakeJob());

        var request = Assert.Single(server.Requests);
        Assert.Null(request.Header(WebhookContract.SignatureHeader));
        Assert.Null(request.Header(WebhookContract.TimestampHeader));
        // The delivery id is not part of the signature scheme and is still there, so "no headers at all"
        // is not what this is proving.
        Assert.NotNull(request.Header(WebhookContract.DeliveryHeader));

        var stats = channel.Stats;
        Assert.Equal(1, stats.Delivered);
        Assert.Equal(1, stats.Unsigned);
    }

    /// <summary>🔴 The idempotency key is what makes retrying safe for a receiver: a retry after a timeout
    /// can genuinely duplicate a POST that was already processed, so the retry must be recognisable as
    /// one.</summary>
    [Fact]
    public async Task TheDeliveryId_IsStableAcrossRetries_SoAReceiverCanDedupThem()
    {
        await using var server = WebhookLoopbackServer.Start(
            attempt => attempt == 1 ? new ScriptedResponse(503, "Service Unavailable") : new ScriptedResponse(200));

        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, server.Url()));

        using var channel = NewChannel(store);
        await channel.DispatchAsync(MakeJob());

        Assert.Equal(2, server.Requests.Count);
        var first = server.Requests[0];
        var second = server.Requests[1];

        Assert.Equal(
            first.Header(WebhookContract.DeliveryHeader),
            second.Header(WebhookContract.DeliveryHeader));

        using var firstBody = JsonDocument.Parse(first.Body);
        using var secondBody = JsonDocument.Parse(second.Body);
        Assert.Equal(
            firstBody.RootElement.GetProperty("deliveryId").GetString(),
            secondBody.RootElement.GetProperty("deliveryId").GetString());

        var stats = channel.Stats;
        Assert.Equal(1, stats.Delivered);
        Assert.Equal(2, stats.Attempts);
        Assert.Equal(1, stats.Retries);
    }

    /// <summary>Two destinations must not share an idempotency key, or a receiver behind both would dedup
    /// away a notification it had not actually seen.</summary>
    [Fact]
    public async Task TwoInstances_GetDistinctDeliveryIds()
    {
        await using var server = WebhookLoopbackServer.Start(new ScriptedResponse(200));
        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(
            enabled: true, AlarmPriority.High, server.Url("/slack/" + UrlPathSentinel), label: "Slack"));
        Assert.True(await store.SaveWebhookAsync(
            enabled: true, AlarmPriority.High, server.Url("/mes"), label: "MES", instance: "mes"));

        using var channel = NewChannel(store);
        await channel.DispatchAsync(MakeJob());

        Assert.Equal(2, server.Requests.Count);
        Assert.Equal(2, channel.Stats.Delivered);

        var ids = server.Requests.Select(r => r.Header(WebhookContract.DeliveryHeader)).ToList();
        Assert.Equal(2, ids.Distinct().Count());

        // Each body names the instance it was produced for.
        var instances = server.Requests
            .Select(r => JsonDocument.Parse(r.Body).RootElement
                .GetProperty("source").GetProperty("channelInstance").GetString())
            .OrderBy(s => s, StringComparer.Ordinal)
            .ToList();
        Assert.Equal(new[] { "default", "mes" }, instances);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2. Retry policy.
    // ─────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(408)]
    [InlineData(429)]
    [InlineData(500)]
    [InlineData(502)]
    [InlineData(503)]
    [InlineData(504)]
    public async Task ARetryableStatus_IsRetriedToTheAttemptBound_ThenCountedAsLost(int status)
    {
        await using var server = WebhookLoopbackServer.Start(new ScriptedResponse(status, "Nope"));
        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, server.Url()));

        var warnings = new List<string>();
        using var channel = NewChannel(store, warnings);

        await channel.DispatchAsync(MakeJob()); // does not throw

        Assert.Equal(3, server.Requests.Count);
        var stats = channel.Stats;
        Assert.Equal(0, stats.Delivered);
        Assert.Equal(1, stats.Lost);
        Assert.Equal(3, stats.Attempts);
        Assert.Equal(2, stats.Retries);

        var warning = Assert.Single(warnings);
        Assert.Contains("FAILED after 3 attempt(s)", warning, StringComparison.Ordinal);
        Assert.Contains(status.ToString(), warning, StringComparison.Ordinal);
        Assert.Contains("is LOST", warning, StringComparison.Ordinal);
    }

    /// <summary>
    /// 🔴 "Stop, you are wrong" — the statuses that must NOT be retried, and the reason each one matters.
    ///
    /// <para><b>Non-vacuity was verified by mutation</b>, per the brief: with
    /// <c>RetryableStatuses.Contains(status)</c> in <c>SendWithRetriesAsync</c> replaced by <c>true</c>
    /// (i.e. the retry decision deleted), every one of these cases fails on
    /// <c>Assert.Single(server.Requests)</c> with 3 requests instead of 1, and
    /// <see cref="ARetryableStatus_IsRetriedToTheAttemptBound_ThenCountedAsLost"/> keeps passing — so this
    /// test is what carries the distinction, and a "1 request" assertion that could also be satisfied by
    /// "no request at all" is excluded by asserting exactly one.</para>
    /// </summary>
    [Theory]
    [InlineData(400, "Bad Request")]        // the same bytes would be rejected the same way
    [InlineData(401, "Unauthorized")]       // hammering this is how a service account gets locked out
    [InlineData(403, "Forbidden")]
    [InlineData(404, "Not Found")]          // Slack's answer for a REVOKED incoming webhook
    [InlineData(410, "Gone")]
    [InlineData(413, "Payload Too Large")]
    [InlineData(422, "Unprocessable Content")]
    [InlineData(501, "Not Implemented")]
    public async Task ANonRetryableStatus_IsNeverRetried_AndIsCountedAsLost(int status, string reason)
    {
        await using var server = WebhookLoopbackServer.Start(new ScriptedResponse(status, reason));
        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, server.Url()));

        var warnings = new List<string>();
        using var channel = NewChannel(store, warnings);

        await channel.DispatchAsync(MakeJob());

        // Exactly one — not zero (which "no request" would also satisfy) and not three.
        Assert.Single(server.Requests);

        var stats = channel.Stats;
        Assert.Equal(1, stats.Attempts);
        Assert.Equal(0, stats.Retries);
        Assert.Equal(1, stats.Lost);
        Assert.Equal(0, stats.Delivered);

        var warning = Assert.Single(warnings);
        Assert.Contains($"HTTP {status}", warning, StringComparison.Ordinal);
        Assert.Contains("permanent rejection, so it was not retried", warning, StringComparison.Ordinal);
    }

    /// <summary>🔴 A redirect is a permanent failure, not a re-target: following it would hand the
    /// signature and any auth token to a host the operator never configured.</summary>
    [Fact]
    public async Task ARedirect_IsNotFollowed_AndIsAPermanentFailure()
    {
        await using var elsewhere = WebhookLoopbackServer.Start(new ScriptedResponse(200));
        await using var server = WebhookLoopbackServer.Start(new ScriptedResponse(
            302, "Found", new[] { ("Location", elsewhere.Url()) }));

        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, server.Url()));

        var warnings = new List<string>();
        using var channel = NewChannel(store, warnings);

        await channel.DispatchAsync(MakeJob());

        Assert.Single(server.Requests);
        Assert.Empty(elsewhere.Requests); // the credential never went to the redirect target
        Assert.Equal(1, channel.Stats.Lost);
        Assert.Contains("Redirects are deliberately not followed", Assert.Single(warnings),
            StringComparison.Ordinal);
    }

    [Fact]
    public async Task ARetryableStatusThatThenSucceeds_IsDelivered()
    {
        await using var server = WebhookLoopbackServer.Start(
            attempt => attempt < 3 ? new ScriptedResponse(500) : new ScriptedResponse(200));

        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, server.Url()));

        var warnings = new List<string>();
        using var channel = NewChannel(store, warnings);
        await channel.DispatchAsync(MakeJob());

        Assert.Equal(3, server.Requests.Count);
        Assert.Equal(1, channel.Stats.Delivered);
        Assert.Equal(0, channel.Stats.Lost);
        Assert.Empty(warnings); // a recovered delivery is not an operator's problem
    }

    /// <summary>
    /// A connect failure to a port nothing is listening on: retried as a transport failure, counted,
    /// reported with its cause, and never thrown out of the channel.
    ///
    /// <para>🔴 The generous per-attempt timeout here is not padding. Measured on this platform, .NET's
    /// connect path takes about <b>two seconds</b> to surface <see cref="HttpRequestException"/> for a
    /// plainly refused TCP connection — so a 2 s attempt timeout races the refusal and the test would
    /// intermittently observe an attempt TIMEOUT instead of a connect FAILURE, which report differently
    /// (warning versus error-with-cause) and are different facts. The same measurement is what sets the
    /// shipped 10 s budget; see <see cref="WebhookNotificationChannel.DefaultTotalBudget"/>.</para>
    /// </summary>
    [Fact]
    public async Task AConnectFailureToADeadEndpoint_IsRetriedThenCounted_AndNeverThrows()
    {
        var deadPort = WebhookLoopbackServer.FindClosedPort();
        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(
            enabled: true, AlarmPriority.High, $"http://127.0.0.1:{deadPort}/{UrlPathSentinel}"));

        var warnings = new List<string>();
        var errors = new List<(Exception Cause, string Message)>();
        using var channel = NewChannel(
            store, warnings, errors,
            attemptTimeout: TimeSpan.FromSeconds(10),
            totalBudget: TimeSpan.FromSeconds(60));

        await channel.DispatchAsync(MakeJob()); // must not throw

        var stats = channel.Stats;
        Assert.Equal(1, stats.Lost);
        Assert.Equal(0, stats.Delivered);
        Assert.Equal(3, stats.Attempts);

        // Reported with the real cause attached, so an operator gets the underlying socket error.
        var (cause, message) = Assert.Single(errors);
        Assert.IsAssignableFrom<HttpRequestException>(cause);
        Assert.Contains("the connection failed", message, StringComparison.Ordinal);
        Assert.Contains("FAILED after 3 attempt(s)", message, StringComparison.Ordinal);
    }

    /// <summary>
    /// 🔴 The retry budget BOUNDS a permanently unresponsive endpoint — proved by measurement, because that
    /// is the only thing that distinguishes it from an implementation that merely counts attempts.
    ///
    /// <para><b>The parameters here were chosen after a mutation showed the first version of this test was
    /// VACUOUS.</b> Two independent mechanisms enforce the budget: the linked
    /// <see cref="CancellationTokenSource"/> that cancels an attempt IN FLIGHT, and the remaining-budget
    /// check that refuses to START another. With a 2s attempt timeout and a 1s budget the second mechanism
    /// alone produced the same observable outcome, so deleting <c>budget.CancelAfter</c> changed
    /// nothing and the whole suite stayed green.</para>
    ///
    /// <para>The 30s attempt timeout against a 1s budget separates them: only the in-flight cancellation
    /// can stop this in about a second. Without it the call takes the full 30s attempt timeout before the
    /// second mechanism gets a say — thirty seconds during which C-1's single-reader drain loop delivers
    /// nothing else at all.</para>
    /// </summary>
    [Fact]
    public async Task TheTotalBudget_CancelsAnInFlightAttempt_NotJustTheNextOne_AndIsMeasured()
    {
        await using var server = WebhookLoopbackServer.Start(_ => null); // accept, then silence
        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, server.Url()));

        var warnings = new List<string>();
        using var channel = NewChannel(
            store, warnings,
            attemptTimeout: TimeSpan.FromSeconds(30),
            totalBudget: TimeSpan.FromSeconds(1),
            maxAttempts: 10);

        var stopwatch = Stopwatch.StartNew();
        await channel.DispatchAsync(MakeJob());
        stopwatch.Stop();

        // The measurement IS the proof: a budget that could only stop the NEXT attempt would take the full
        // 30s attempt timeout to get here, and an implementation bounded only by the attempt count would
        // take 10 x 30s.
        Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(5),
            $"the 1s delivery budget took {stopwatch.Elapsed} to give up against a black-holing receiver — " +
            "the alarm notification drain loop is single-reader and delivers nothing else meanwhile.");

        // ...and it really did try: the request reached the server before the budget cut it off.
        Assert.Single(server.Requests);
        var stats = channel.Stats;
        Assert.Equal(1, stats.Attempts);
        Assert.Equal(1, stats.Lost);
        Assert.Equal(0, stats.Cancelled); // the BUDGET stopped it, not a shutdown
        Assert.Contains("delivery budget elapsed", Assert.Single(warnings), StringComparison.Ordinal);
    }

    /// <summary>
    /// The budget's other half: it also refuses to START an attempt there is no room for, so a receiver
    /// that fails FAST cannot burn the whole attempt allowance and then some.
    ///
    /// <para>🔴 Review round 1 (M-4) — <b>the parameters are chosen so the arithmetic holds regardless of
    /// how slow the machine is</b>, rather than on the premise that the first attempt returns in a few
    /// milliseconds. The first version used a 400 ms budget with a 250 ms backoff: on a loaded box a first
    /// attempt taking &gt;150 ms leaves no room for the backoff and the test sees ONE request instead of
    /// two. That is a false failure, and this batch has already burned a round on CPU contention being
    /// mistaken for a test defect.</para>
    /// </summary>
    [Fact]
    public async Task TheTotalBudget_AlsoRefusesToStartAnAttemptItCannotAfford()
    {
        await using var server = WebhookLoopbackServer.Start(new ScriptedResponse(503));
        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, server.Url()));

        var warnings = new List<string>();
        using var channel = NewChannel(
            store, warnings,
            attemptTimeout: TimeSpan.FromSeconds(5),
            totalBudget: TimeSpan.FromSeconds(2),
            baseBackoff: TimeSpan.FromMilliseconds(700),
            maxAttempts: 10);

        var stopwatch = Stopwatch.StartNew();
        await channel.DispatchAsync(MakeJob());
        stopwatch.Stop();

        // The arithmetic, stated so this is a claim rather than an observation — and with both sides having
        // slack that does not depend on how fast this machine is:
        //   * backoff 1 (700ms) fits as long as attempt 1 finishes within 1300ms of a 2000ms budget.
        //   * backoff 2 is 1400ms, and by then AT LEAST 700ms has already been slept, so at most 1300ms of
        //     budget can remain — 1400 > 1300 ALWAYS, whatever the attempts cost. Attempt 3 can never
        //     start.
        // Ten attempts were permitted; the budget, not the attempt count, is what stopped it at two.
        Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(5),
            $"a 2s budget took {stopwatch.Elapsed} against a fast-failing receiver that permitted 10 attempts.");
        Assert.Equal(2, server.Requests.Count);
        Assert.Equal(2, channel.Stats.Attempts);
        Assert.Equal(1, channel.Stats.Lost);
        Assert.Contains("delivery budget elapsed", Assert.Single(warnings), StringComparison.Ordinal);
    }

    /// <summary>
    /// 🔴 A <c>Retry-After</c> longer than the remaining budget is ABANDONED rather than honoured. Slack
    /// answers a rate-limited incoming webhook with <c>429 Retry-After: 30</c> or more; sleeping on that
    /// inside C-1's single-reader drain loop would stall every other alarm notification in the process for
    /// as long as the receiver felt like.
    /// </summary>
    [Fact]
    public async Task ARetryAfterLongerThanTheBudget_IsAbandonedImmediately_NotSleptOn()
    {
        await using var server = WebhookLoopbackServer.Start(new ScriptedResponse(
            429, "Too Many Requests", new[] { ("Retry-After", "120") }));

        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, server.Url()));

        var warnings = new List<string>();
        using var channel = NewChannel(
            store, warnings, totalBudget: TimeSpan.FromSeconds(5), maxAttempts: 3);

        var stopwatch = Stopwatch.StartNew();
        await channel.DispatchAsync(MakeJob());
        stopwatch.Stop();

        // An implementation that slept on Retry-After would be stopped only by the 5s budget; one that
        // honoured it literally would take two minutes.
        Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(2),
            $"a Retry-After of 120s took {stopwatch.Elapsed} to abandon — the drain loop must not be " +
            "parked by a receiver's back-off request.");

        Assert.Single(server.Requests);
        Assert.Equal(1, channel.Stats.Attempts);
        Assert.Equal(1, channel.Stats.Lost);

        var warning = Assert.Single(warnings);
        Assert.Contains("asked to be retried after longer than", warning, StringComparison.Ordinal);
        Assert.Contains("delivery budget", warning, StringComparison.Ordinal);
    }

    /// <summary>A <c>Retry-After</c> that FITS is honoured — the abandonment above is about the budget, not
    /// about ignoring the receiver.</summary>
    [Fact]
    public async Task ARetryAfterThatFitsTheBudget_IsHonoured()
    {
        await using var server = WebhookLoopbackServer.Start(
            attempt => attempt == 1
                ? new ScriptedResponse(429, "Too Many Requests", new[] { ("Retry-After", "1") })
                : new ScriptedResponse(200));

        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, server.Url()));

        using var channel = NewChannel(store, totalBudget: TimeSpan.FromSeconds(10), maxAttempts: 3);

        var stopwatch = Stopwatch.StartNew();
        await channel.DispatchAsync(MakeJob());
        stopwatch.Stop();

        Assert.Equal(2, server.Requests.Count);
        Assert.Equal(1, channel.Stats.Delivered);

        // It waited the second the receiver asked for, rather than its own 20ms backoff.
        Assert.True(stopwatch.Elapsed >= TimeSpan.FromMilliseconds(900),
            $"the 1s Retry-After was ignored — the retry came after only {stopwatch.Elapsed}.");
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3. Cancellation.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 Cancellation unblocks an in-flight send PROMPTLY, and propagates.
    ///
    /// <para>Both halves matter. C-1's <c>AlarmNotifier.DisposeAsync</c> awaits its drain loop UNBOUNDED
    /// after its 5s timeout expires, so a channel that ignored its token would hang host shutdown forever —
    /// hence the measurement. And C-1's drain loop counts a shutdown-abandoned job as a drop only if the
    /// <see cref="OperationCanceledException"/> actually reaches it — hence the re-throw. The budgets here
    /// are deliberately far LONGER than the cancellation deadline, so a passing result cannot come from the
    /// budget doing the work.</para>
    /// </summary>
    [Fact]
    public async Task Cancellation_UnblocksAnInFlightSendPromptly_AndPropagatesSoTheDrainLoopCountsIt()
    {
        await using var server = WebhookLoopbackServer.Start(_ => null); // accept, then silence
        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, server.Url()));

        var warnings = new List<string>();
        using var channel = NewChannel(
            store, warnings,
            attemptTimeout: TimeSpan.FromSeconds(30),
            totalBudget: TimeSpan.FromSeconds(60),
            maxAttempts: 10);

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(250));
        var stopwatch = Stopwatch.StartNew();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => channel.DispatchAsync(MakeJob(), cts.Token));
        stopwatch.Stop();

        Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(3),
            $"cancellation took {stopwatch.Elapsed} to unblock a send bounded by a 60s budget — a channel " +
            "that ignores its token hangs host shutdown, because AlarmNotifier.DisposeAsync awaits the " +
            "drain loop unbounded after its own timeout.");

        // It was genuinely in flight, not stopped before it started.
        Assert.Single(server.Requests);

        var stats = channel.Stats;
        Assert.Equal(1, stats.Cancelled);
        Assert.Equal(0, stats.Lost);      // a shutdown is not a delivery failure...
        Assert.Equal(0, stats.Delivered); // ...and it is certainly not a success
        Assert.Empty(warnings);           // and it is not reported as one
    }

    /// <summary>A token already cancelled when the notification arrives is abandoned before any HTTP
    /// happens, and still counted — the cheapest path must not be the silent one.</summary>
    [Fact]
    public async Task AnAlreadyCancelledToken_AbandonsBeforeAnyRequest_AndIsStillCounted()
    {
        await using var server = WebhookLoopbackServer.Start(new ScriptedResponse(200));
        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, server.Url()));

        using var channel = NewChannel(store);
        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => channel.DispatchAsync(MakeJob(), cts.Token));

        Assert.Empty(server.Requests);
        Assert.Equal(1, channel.Stats.Cancelled);
        Assert.Equal(1, channel.Stats.Considered);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 4. Configuration decides everything.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task AnAlarmBelowTheInstancesMinimumPriority_IsSuppressed_NotSent()
    {
        await using var server = WebhookLoopbackServer.Start(new ScriptedResponse(200));
        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.Critical, server.Url()));

        using var channel = NewChannel(store);

        // High is everything Identity/NgRate/DriverHealth can ever be; a Critical-only webhook must not see
        // it. (AlarmPriority is declared most-severe-FIRST, so getting this backwards would deliver
        // everything EXCEPT the alarms that matter.)
        await channel.DispatchAsync(MakeJob(alarm: MakeAlarm(priority: AlarmPriority.High)));
        Assert.Empty(server.Requests);
        Assert.Equal(1, channel.Stats.Suppressed);
        Assert.Equal(0, channel.Stats.Lost);

        // ...and a Critical one does.
        await channel.DispatchAsync(MakeJob(alarm: MakeAlarm(priority: AlarmPriority.Critical)));
        Assert.Single(server.Requests);
        Assert.Equal(1, channel.Stats.Delivered);
    }

    [Fact]
    public async Task ADisabledChannel_SendsNothing()
    {
        await using var server = WebhookLoopbackServer.Start(new ScriptedResponse(200));
        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(enabled: false, AlarmPriority.High, server.Url()));

        using var channel = NewChannel(store);
        await channel.DispatchAsync(MakeJob());

        Assert.Empty(server.Requests);
        Assert.Equal(1, channel.Stats.Suppressed);
        Assert.Equal(0, channel.Stats.Delivered);
        Assert.Equal(0, channel.Stats.Lost);

        // Re-enabling takes effect on the very next notification — the configuration is read per
        // notification, so C-7 can toggle it at runtime with no restart and no cache to invalidate.
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, server.Url()));
        await channel.DispatchAsync(MakeJob());
        Assert.Single(server.Requests);
        Assert.Equal(1, channel.Stats.Delivered);
    }

    [Fact]
    public async Task NoWebhookConfiguredAtAll_SendsNothing_AndOnlyTheConsideredCounterMoves()
    {
        var store = NewStore();
        Assert.True(await store.SaveSmtpAsync(
            enabled: true, AlarmPriority.High, "mail.local", 587, SmtpTlsMode.StartTls,
            "sim@plant", new[] { "ops@plant" }, "svc"));

        using var channel = NewChannel(store);
        await channel.DispatchAsync(MakeJob());

        var stats = channel.Stats;
        Assert.Equal(1, stats.Considered);
        Assert.Equal(0, stats.Suppressed); // an SMTP row is not a webhook instance to suppress
        Assert.Equal(0, stats.Delivered);
        Assert.Equal(0, stats.Lost);
        Assert.Equal(0, stats.Attempts);
    }

    [Fact]
    public async Task TwoWebhookInstances_BothReceive_WithTheirOwnSigningSecrets()
    {
        await using var server = WebhookLoopbackServer.Start(new ScriptedResponse(200));
        var store = NewStore();

        Assert.True(await store.SaveWebhookAsync(
            enabled: true, AlarmPriority.High, server.Url("/slack"), label: "Slack"));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret, "slack-key"));

        Assert.True(await store.SaveWebhookAsync(
            enabled: true, AlarmPriority.High, server.Url("/mes"), label: "MES", instance: "mes"));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret, "mes-key",
            instance: "mes"));

        using var channel = NewChannel(store);
        await channel.DispatchAsync(MakeJob());

        Assert.Equal(2, server.Requests.Count);
        Assert.Equal(2, channel.Stats.Delivered);

        foreach (var request in server.Requests)
        {
            var expectedKey = request.Target == "/slack" ? "slack-key" : "mes-key";
            var timestamp = request.Header(WebhookContract.TimestampHeader)!;
            Assert.Equal(
                ReceiverSideSignature(timestamp, request.Body, expectedKey),
                request.Header(WebhookContract.SignatureHeader));
        }
    }

    /// <summary>An enabled webhook whose encrypted URL cannot be read is a channel that cannot post. That
    /// IS a loss and must read as one, rather than looking like "nothing configured".</summary>
    [Fact]
    public async Task AWebhookWhoseStoredUrlCannotBeRead_IsCountedAsLost_NotSilentlySkipped()
    {
        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High,
            $"https://mes.plant/{UrlPathSentinel}"));
        // Exactly what a database copied from another machine looks like: the derived columns survive, the
        // DPAPI blob does not decrypt. Deleting the row reproduces GetWebhookAsync's Url == null.
        Assert.True(await store.DeleteSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookUrl));

        var warnings = new List<string>();
        using var channel = NewChannel(store, warnings);
        await channel.DispatchAsync(MakeJob());

        Assert.Equal(1, channel.Stats.Lost);
        Assert.Equal(0, channel.Stats.Attempts);

        var warning = Assert.Single(warnings);
        Assert.Contains("stored destination could not be read", warning, StringComparison.Ordinal);
        Assert.Contains("NOT sent", warning, StringComparison.Ordinal);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 5. 🔴 Static-token authentication — the gap C-2 named and left to this task.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>The stored secret is the COMPLETE header value, sent verbatim — no scheme is prepended and
    /// none is inferred, so one rule covers both <c>Authorization: Bearer …</c> and a bare
    /// <c>X-Api-Key</c>.</summary>
    [Theory]
    [InlineData("Authorization", "Bearer eyJhbGciOi.not-a-real-token")]
    [InlineData("X-Api-Key", "b7f21c4d9a34de51bb08")]
    public async Task TheConfiguredAuthHeader_IsSentVerbatim(string headerName, string token)
    {
        await using var server = WebhookLoopbackServer.Start(new ScriptedResponse(200));
        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(
            enabled: true, AlarmPriority.High, server.Url(), authHeaderName: headerName));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookAuthToken, token));

        using var channel = NewChannel(store);
        await channel.DispatchAsync(MakeJob());

        var request = Assert.Single(server.Requests);
        Assert.Equal(token, request.Header(headerName));
        Assert.Equal(1, channel.Stats.Delivered);
    }

    [Fact]
    public async Task WithNoAuthHeaderConfigured_NoAuthenticationHeaderIsInvented()
    {
        await using var server = WebhookLoopbackServer.Start(new ScriptedResponse(200));
        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, server.Url()));

        using var channel = NewChannel(store);
        await channel.DispatchAsync(MakeJob());

        var request = Assert.Single(server.Requests);
        Assert.Null(request.Header("Authorization"));
        Assert.Null(request.Header("X-Api-Key"));
    }

    /// <summary>Posting unauthenticated would produce a 401 that looks like the operator's token is WRONG
    /// when in fact it is MISSING. Fail before the request, name the header, count the loss.</summary>
    [Fact]
    public async Task AnAuthHeaderWithNoStoredToken_IsCountedAsLost_RatherThanPostingUnauthenticated()
    {
        await using var server = WebhookLoopbackServer.Start(new ScriptedResponse(200));
        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(
            enabled: true, AlarmPriority.High, server.Url(), authHeaderName: "X-Api-Key"));
        // No SetSecretAsync for WebhookAuthToken.

        var warnings = new List<string>();
        using var channel = NewChannel(store, warnings);
        await channel.DispatchAsync(MakeJob());

        Assert.Empty(server.Requests);
        Assert.Equal(1, channel.Stats.Lost);
        Assert.Equal(0, channel.Stats.Attempts);

        var warning = Assert.Single(warnings);
        Assert.Contains("X-Api-Key", warning, StringComparison.Ordinal);
        Assert.Contains("no usable token is stored", warning, StringComparison.Ordinal);
        Assert.Contains(NotificationSecretNames.WebhookAuthToken, warning, StringComparison.Ordinal);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 6. 🔴 Accounting, and the credential rule.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 The accounting invariant: for every (notification, configured webhook instance) pair, exactly one
    /// counter moves. One dispatch, three instances, one of each outcome — so the sum is checkable and a
    /// lost notification cannot be invisible.
    /// </summary>
    [Fact]
    public async Task EveryNotificationInstancePair_MovesExactlyOneCounter()
    {
        await using var server = WebhookLoopbackServer.Start(new ScriptedResponse(200));
        await using var rejecting = WebhookLoopbackServer.Start(new ScriptedResponse(400, "Bad Request"));
        var store = NewStore();

        // Suppressed: enabled, but Critical-only, and the alarm is High.
        Assert.True(await store.SaveWebhookAsync(
            enabled: true, AlarmPriority.Critical, server.Url("/critical-only"), instance: "quiet"));
        // Delivered.
        Assert.True(await store.SaveWebhookAsync(
            enabled: true, AlarmPriority.High, server.Url("/live"), instance: "live"));
        // Lost: a permanent rejection.
        Assert.True(await store.SaveWebhookAsync(
            enabled: true, AlarmPriority.High, rejecting.Url("/rejected"), instance: "rejected"));

        using var channel = NewChannel(store, new List<string>(), new List<(Exception, string)>());
        await channel.DispatchAsync(MakeJob(alarm: MakeAlarm(priority: AlarmPriority.High)));

        var stats = channel.Stats;
        Assert.Equal(1, stats.Considered);
        Assert.Equal(1, stats.Suppressed);
        Assert.Equal(1, stats.Delivered);
        Assert.Equal(1, stats.Lost);
        Assert.Equal(0, stats.Cancelled);

        // The sum is the number of configured instances — nothing fell between the cases.
        Assert.Equal(3, stats.Suppressed + stats.Delivered + stats.Lost + stats.Cancelled);

        // And exactly one destination really was reached.
        Assert.Equal("/live", Assert.Single(server.Requests).Target);
    }

    /// <summary>
    /// 🔴 No credential reaches a log line or an error, on ANY reachable failure path.
    ///
    /// <para>Three sentinels are planted: the capability-bearing PATH of the destination URL (which for
    /// Slack and Teams is the whole credential), the HMAC signing secret, and the static auth token. Every
    /// failure path the channel has is then driven, and the accumulated warnings, error messages and full
    /// <c>exception.ToString()</c> — message, inner exceptions and stack — are searched.</para>
    ///
    /// <para>The complement is asserted too: the non-secret identity C-2 built for exactly this purpose
    /// (endpoint, truncated URL fingerprint, operator label) IS present, so "no sentinel" is not "nothing
    /// was logged".</para>
    /// </summary>
    [Fact]
    public async Task NoSigningSecret_NoAuthToken_AndNoUrlPath_EverReachesALogOrAnError()
    {
        var warnings = new List<string>();
        var errors = new List<(Exception Cause, string Message)>();

        // (a) a permanent rejection, (b) a connect failure, (c) an unreadable destination, (d) a missing
        // auth token — every path that reports.
        await using var rejecting = WebhookLoopbackServer.Start(new ScriptedResponse(403, "Forbidden"));
        var deadPort = WebhookLoopbackServer.FindClosedPort();

        var store = NewStore();
        // One attempt each: this test is about what a failure MESSAGE contains, not about retrying, and a
        // refused connect costs ~2s per attempt on this platform (see
        // AConnectFailureToADeadEndpoint_...). The attempt timeout is generous for the same reason.
        using var channel = NewChannel(
            store, warnings, errors,
            attemptTimeout: TimeSpan.FromSeconds(10),
            totalBudget: TimeSpan.FromSeconds(60),
            maxAttempts: 1);

        // (a)
        Assert.True(await store.SaveWebhookAsync(
            enabled: true, AlarmPriority.High, rejecting.Url("/hooks/" + UrlPathSentinel),
            label: "Ops Slack", authHeaderName: "X-Api-Key"));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret, SigningSentinel));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookAuthToken, TokenSentinel));
        await channel.DispatchAsync(MakeJob());

        // (b)
        Assert.True(await store.SaveWebhookAsync(
            enabled: true, AlarmPriority.High, $"http://127.0.0.1:{deadPort}/hooks/{UrlPathSentinel}",
            label: "Ops Slack", authHeaderName: "X-Api-Key"));
        await channel.DispatchAsync(MakeJob());

        // (c)
        Assert.True(await store.DeleteSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookUrl));
        await channel.DispatchAsync(MakeJob());

        // (d)
        Assert.True(await store.SaveWebhookAsync(
            enabled: true, AlarmPriority.High, $"https://mes.plant/hooks/{UrlPathSentinel}",
            label: "Ops Slack", authHeaderName: "X-Api-Key"));
        Assert.True(await store.DeleteSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookAuthToken));
        await channel.DispatchAsync(MakeJob());

        var everythingLogged = string.Join("\n", warnings.Concat(
            errors.Select(e => e.Message + "\n" + e.Cause)));

        // Non-vacuity: something really was logged, and it really does identify the webhook.
        Assert.False(string.IsNullOrWhiteSpace(everythingLogged));
        Assert.Equal(4, channel.Stats.Lost);
        Assert.Contains("Ops Slack", everythingLogged, StringComparison.Ordinal);
        Assert.Contains("url ", everythingLogged, StringComparison.Ordinal); // the fingerprint

        // 🔴 The rule.
        Assert.DoesNotContain(UrlPathSentinel, everythingLogged, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(SigningSentinel, everythingLogged, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(TokenSentinel, everythingLogged, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// 🔴 Review round 1 (I-1) — a configured signing secret that cannot be DECRYPTED must not silently
    /// downgrade to an unsigned POST.
    ///
    /// <para><see cref="NotificationConfigStore.GetSecretAsync"/> is never-throws and returns
    /// <see langword="null"/> for both "no secret stored" and "the DPAPI blob will not decrypt" — which is
    /// exactly what a <c>notifications.db</c> copied from another machine looks like. Signing with a null
    /// key means "send unsigned", so before the fix this machine quietly stopped proving its identity,
    /// delivered anyway, counted a success, warned nobody, and the config API went on reporting
    /// <c>HasSigningSecret = true</c>. Against a signature-enforcing receiver every alarm then 401s;
    /// against a permissive one it ships unauthenticated alarm traffic indefinitely.</para>
    ///
    /// <para>The corruption here is the real thing, not a stand-in: the ciphertext BLOB is overwritten in
    /// <c>notifications.db</c> while the row — and therefore <c>HasSigningSecret</c> — stays.</para>
    /// </summary>
    [Fact]
    public async Task ASigningSecretThatCannotBeDecrypted_IsNotSilentlyDowngradedToUnsigned()
    {
        await using var server = WebhookLoopbackServer.Start(new ScriptedResponse(200));
        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, server.Url()));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret, SigningSentinel));

        CorruptStoredSecret(store, NotificationSecretNames.WebhookSigningSecret);

        // The state under test, pinned: the row still EXISTS (so every public read says the webhook is
        // healthy) but the value cannot be recovered.
        Assert.True(Assert.Single(await store.ListAsync()).Webhook!.HasSigningSecret);
        Assert.Null(await store.GetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret));

        var warnings = new List<string>();
        using var channel = NewChannel(store, warnings);
        await channel.DispatchAsync(MakeJob());

        // Nothing was sent — an unsigned delivery would have been worse than none.
        Assert.Empty(server.Requests);

        var stats = channel.Stats;
        Assert.Equal(1, stats.Lost);
        Assert.Equal(0, stats.Delivered);
        Assert.Equal(0, stats.Attempts);
        Assert.Equal(0, stats.Unsigned); // NOT "unsigned by configuration" — that counter must stay clean

        var warning = Assert.Single(warnings);
        Assert.Contains("signing secret", warning, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("UNSIGNED", warning, StringComparison.Ordinal);
        Assert.Contains("NOT", warning, StringComparison.Ordinal);
        Assert.DoesNotContain(SigningSentinel, warning, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>The other side of I-1, so the fix cannot have been "always fail when unsigned": a webhook
    /// with NO signing secret row still delivers, unsigned, and counts it. That is the Slack/Teams case and
    /// it must stay working.</summary>
    [Fact]
    public async Task NoSigningSecretRowAtAll_StillDeliversUnsigned_TheFixDoesNotBreakSlack()
    {
        await using var server = WebhookLoopbackServer.Start(new ScriptedResponse(200));
        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, server.Url()));

        var warnings = new List<string>();
        using var channel = NewChannel(store, warnings);
        await channel.DispatchAsync(MakeJob());

        Assert.Single(server.Requests);
        Assert.Equal(1, channel.Stats.Delivered);
        Assert.Equal(1, channel.Stats.Unsigned);
        Assert.Equal(0, channel.Stats.Lost);
        Assert.Empty(warnings);
    }

    /// <summary>
    /// 🔴 Review round 1 (M-1) — a webhook that is listed as configured but cannot be read back is a LOSS,
    /// not a suppression.
    ///
    /// <para><c>GetWebhookAsync</c> returns null both when the instance was deleted in the instant between
    /// the two reads and when the read itself failed (the store is never-throws, so a fault reads as
    /// "unconfigured"). Only the first is "the operator's configuration working", which is what
    /// <c>Suppressed</c> is documented to mean.</para>
    ///
    /// <para>Reproduced deterministically by deleting the <c>webhook_config</c> side row while leaving the
    /// <c>notification_channels</c> row — a state the LEFT JOIN in <c>ListAsync</c> still reports as a
    /// configured Webhook channel while the INNER JOIN in <c>GetWebhookAsync</c> cannot resolve.</para>
    /// </summary>
    [Fact]
    public async Task AWebhookListedButNotReadableBack_IsCountedAsLost_NotSuppressed()
    {
        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, "https://mes.plant/hook"));

        ExecuteSql(store, "DELETE FROM webhook_config;");
        Assert.Null(await store.GetWebhookAsync());

        var warnings = new List<string>();
        using var channel = NewChannel(store, warnings);
        await channel.DispatchAsync(MakeJob());

        var stats = channel.Stats;
        Assert.Equal(1, stats.Lost);
        Assert.Equal(0, stats.Suppressed);
        Assert.Equal(0, stats.Attempts);

        var warning = Assert.Single(warnings);
        Assert.Contains("could not be read back", warning, StringComparison.Ordinal);
        Assert.Contains("NOT", warning, StringComparison.Ordinal);
    }

    /// <summary>
    /// 🔴 Review round 1 (M-6) — the class claims it never reads the receiver's response body, because an
    /// echoing or misconfigured endpoint would reflect our own auth header back into a log file that
    /// outlives the socket. Nothing pinned it: the loopback server always answered with an empty body.
    ///
    /// <para>The control is what makes this sharp rather than a tautology. Sentinel A goes in the REASON
    /// PHRASE, which the channel does read and does log; sentinel B goes in the BODY. A appearing proves the
    /// response really arrived and was parsed; B being absent is then about the body specifically, and not
    /// about the response having been ignored wholesale.</para>
    /// </summary>
    [Fact]
    public async Task TheReceiversResponseBody_IsNeverReadIntoALog_WhileItsReasonPhraseIs()
    {
        const string reasonSentinel = "REASON-2b91";
        const string bodySentinel = "BODYECHO-do-not-leak-3c77";

        await using var server = WebhookLoopbackServer.Start(new ScriptedResponse(
            400, reasonSentinel, Body: $"{{\"echoed\":\"{bodySentinel}\"}}"));

        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, server.Url()));

        var warnings = new List<string>();
        var errors = new List<(Exception Cause, string Message)>();
        using var channel = NewChannel(store, warnings, errors);
        await channel.DispatchAsync(MakeJob());

        var logged = string.Join("\n", warnings.Concat(errors.Select(e => e.Message + "\n" + e.Cause)));

        Assert.Single(server.Requests);
        Assert.Equal(1, channel.Stats.Lost);
        Assert.Contains(reasonSentinel, logged, StringComparison.Ordinal);      // the control
        Assert.DoesNotContain(bodySentinel, logged, StringComparison.Ordinal);  // the rule
    }

    /// <summary>🔴 Review round 1 (M-2) — the reason phrase is the one piece of receiver-controlled text
    /// that reaches a log line, so it is bounded. An untrusted party does not get to choose how much of an
    /// operator's log file it occupies.</summary>
    [Fact]
    public async Task AnAbsurdlyLongReasonPhrase_IsTruncatedBeforeItReachesALog()
    {
        var absurd = new string('R', 4000);
        await using var server = WebhookLoopbackServer.Start(new ScriptedResponse(400, absurd));

        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, server.Url()));

        var warnings = new List<string>();
        using var channel = NewChannel(store, warnings);
        await channel.DispatchAsync(MakeJob());

        var warning = Assert.Single(warnings);
        Assert.DoesNotContain(absurd, warning, StringComparison.Ordinal);
        // Non-vacuity: it really did come back with that phrase, and a bounded prefix of it IS reported —
        // so this is truncation, not the phrase having been dropped altogether.
        Assert.Contains(new string('R', 80), warning, StringComparison.Ordinal);
        Assert.DoesNotContain(new string('R', 81), warning, StringComparison.Ordinal);
        Assert.True(warning.Length < 700, $"the warning grew to {warning.Length} characters.");
    }

    /// <summary>
    /// 🔴 Review round 1 (I-2) — the PREMISE the channel's post-read cancellation guards rest on, pinned
    /// so it cannot quietly stop being true.
    ///
    /// <para><see cref="NotificationConfigStore"/> is never-throws, which means a read cancelled by shutdown
    /// comes back as <see langword="null"/> — <b>indistinguishable from "no secret is stored"</b>. The
    /// channel acts on that null by reporting a MISSING CREDENTIAL and counting a loss, so without a
    /// <c>ThrowIfCancellationRequested()</c> immediately after every read, a shutdown in that window tells
    /// an operator their token is missing when it is not, moves the wrong counter, and — because the
    /// <see cref="OperationCanceledException"/> never propagates — is recorded by C-1's drain loop as a
    /// successful dispatch.</para>
    ///
    /// <para>The channel's fix is a choke point (<c>ReadSecretAsync</c>), not a rule at two call sites. The
    /// exact interleaving cannot be forced from outside without adding a production seam that exists only
    /// for a test, so this test pins the store behaviour that makes the guard necessary: if C-2's store ever
    /// started propagating cancellation, this turns red and the guard's justification can be revisited
    /// deliberately rather than being carried as folklore.</para>
    /// </summary>
    [Fact]
    public async Task ACancelledSecretRead_ComesBackAsNull_NotAsAnException_WhichIsWhyTheChannelGuards()
    {
        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, "https://mes.plant/hook"));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret, SigningSentinel));

        // The secret really is there and really is readable...
        Assert.Equal(SigningSentinel, await store.GetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret));

        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        // ...and yet a cancelled read is reported as "there is no such secret", with no exception at all.
        // That is the whole trap.
        var underCancellation = await store.GetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret, ct: cts.Token);
        Assert.Null(underCancellation);

        // Same for the configuration read the channel guards on the line after it.
        Assert.Null(await store.GetWebhookAsync(ct: cts.Token));
    }

    /// <summary>The shipped budgets are what the report and the docs claim. Every other test in this file
    /// shrinks them, so without this nothing would notice a default drifting.</summary>
    [Fact]
    public void TheDocumentedDefaults_AreWhatTheChannelActuallyUses()
    {
        Assert.Equal(TimeSpan.FromSeconds(5), WebhookNotificationChannel.DefaultAttemptTimeout);
        Assert.Equal(TimeSpan.FromSeconds(10), WebhookNotificationChannel.DefaultTotalBudget);
        Assert.Equal(3, WebhookNotificationChannel.DefaultMaxAttempts);
        Assert.Equal(TimeSpan.FromMilliseconds(250), WebhookNotificationChannel.DefaultBaseBackoff);
        Assert.Equal(300, WebhookSigner.ReplayToleranceSeconds);
        Assert.Equal(1, WebhookContract.SpecVersion);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 7. Through the real seam.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 End to end through C-1's real edge detector and a real <see cref="AlarmStore"/>: twenty minutes
    /// of 5s ticks restating one unchanged alarm produce exactly ONE webhook POST, and the eventual clear
    /// produces exactly one more.
    ///
    /// <para>This is the whole batch's premise, verified at the point it finally leaves the machine — the
    /// naive hook this architecture exists to avoid would have posted 241 times. Guarded against vacuity:
    /// the store really recorded all 240 raises, and the detector really suppressed 239 of them, both of
    /// which read zero in every degenerate world where nothing was wired up.</para>
    /// </summary>
    [Fact]
    public async Task ThroughTheRealNotifier_AStormOfRaisesProducesExactlyOnePost_AndTheClearProducesOneMore()
    {
        await using var server = WebhookLoopbackServer.Start(new ScriptedResponse(200));
        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, server.Url()));

        using var channel = NewChannel(store);
        await using var notifier = new AlarmNotifier(dispatch: channel.DispatchAsync);
        var alarmStore = new AlarmStore(NewTempDir(), notifier: notifier);

        var raise = new AlarmRaise(
            AlarmSource.DriverHealth, "DOWN", AlarmPriority.High, "Driver MODBUS-01 is unreachable",
            TargetId: "MODBUS-01");

        for (var tick = 0; tick < 240; tick++) await alarmStore.RaiseAsync(raise);
        await alarmStore.ClearAsync(raise.Key);

        var notifierStats = notifier.Stats;
        await notifier.DisposeAsync(); // drains to completion — the deterministic observation point

        Assert.Equal(2, server.Requests.Count);
        var kinds = server.Requests.Select(r => r.Header(WebhookContract.EventHeader)).ToList();
        Assert.Equal(new[] { "Raised", "Cleared" }, kinds);

        // Non-vacuity: the storm really happened, and the detector really absorbed it.
        Assert.Equal(239, notifierStats.Suppressed);
        Assert.Equal(2, channel.Stats.Delivered);
        Assert.Equal(0, channel.Stats.Lost);
    }
}
