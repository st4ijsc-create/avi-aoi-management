using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using St4i.EngineApi.Alarms;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Endpoints;
using Xunit;

namespace St4i.EngineApi.Tests.Alarms;

/// <summary>
/// 🔴 Task C-7 — <see cref="NotificationEndpoints"/>: the configuration surface for the four alarm channels.
///
/// <para>What these tests exist to hold down, in order of how badly each would matter:
/// <list type="number">
/// <item><description><b>No credential leaves through an endpoint</b> — not in a response body, not in an
/// audit row, and not on an error path either.</description></item>
/// <item><description><b>The rate limit is a real bound</b>, asserted against a
/// <see cref="Stopwatch"/> rather than against a counter — C-6's report records two channels in this batch
/// that shipped budget tests which passed with the guard deleted, because only wall-clock
/// differed.</description></item>
/// <item><description><b>The send test is honest</b>: it posts a TEST body rather than a fabricated alarm,
/// and its success wording states what it cannot prove.</description></item>
/// <item><description><b>The three wordings four reviews in this batch had to correct</b> —
/// <c>Unheard</c>, <c>Energised</c> and <c>PartiallyDelivered</c> — say what they mean.</description></item>
/// </list></para>
///
/// <para>Every test drives a REAL <see cref="NotificationConfigStore"/> (DPAPI round trip included) and, for
/// the send tests, a REAL in-process receiver — <see cref="WebhookLoopbackServer"/> and
/// <see cref="SmtpLoopbackServer"/> — for the reason C-3 and C-4 both state: a fake would define away the
/// exact bytes and the encryption that are the things under test. The RBAC gate itself is proved end to end
/// through the real pipeline in <c>RbacPolicyTests</c>, which is the only place that can see endpoint
/// metadata.</para>
/// </summary>
public sealed class NotificationEndpointsTests : IDisposable
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
        var dir = Directory.CreateTempSubdirectory("st4i-notification-endpoints-").FullName;
        _tempDirs.Add(dir);
        return dir;
    }

    private NotificationConfigStore NewStore() => new(NewTempDir());

    /// <summary>Distinctive enough that finding any of them anywhere is proof of a leak.</summary>
    private const string UrlPathSentinel = "URLPATH-must-not-leak-c7a1";
    private const string SigningSentinel = "SIGNKEY-must-not-leak-c7b2";
    private const string TokenSentinel = "AUTHTOK-must-not-leak-c7c3";
    private const string PasswordSentinel = "MAILPWD-must-not-leak-c7d4";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    // ─────────────────────────────────────────────────────────────────────
    // Harness
    // ─────────────────────────────────────────────────────────────────────

    private sealed record Harness(
        HttpContext Context,
        AuditRecorder Recorder,
        RecordingAuditStore Audit,
        NotificationTestRateLimiter Limiter,
        NotificationConfigStore? Store);

    private Harness NewHarness(
        NotificationConfigStore? store = null,
        WebhookNotificationChannel? webhook = null,
        SmtpNotificationChannel? smtp = null,
        LocalAnnunciationChannel? local = null,
        AlarmAnnunciationHub? hub = null,
        TimeSpan? rateLimit = null,
        string role = Roles.Admin)
    {
        var audit = new RecordingAuditStore();
        var recorder = new AuditRecorder(audit, NullLogger<AuditRecorder>.Instance);
        var limiter = new NotificationTestRateLimiter(rateLimit ?? TimeSpan.Zero);

        var services = new ServiceCollection();
        if (store is not null) services.AddSingleton(store);
        if (webhook is not null) services.AddSingleton(webhook);
        if (smtp is not null) services.AddSingleton(smtp);
        if (local is not null) services.AddSingleton(local);
        if (hub is not null) services.AddSingleton(hub);
        services.AddSingleton(recorder);
        services.AddSingleton(limiter);

        var context = new DefaultHttpContext
        {
            RequestServices = services.BuildServiceProvider(),
        };
        context.User = new System.Security.Claims.ClaimsPrincipal(
            new System.Security.Claims.ClaimsIdentity(
                new[]
                {
                    new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.Name, "c7-tester"),
                    new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.Role, role),
                },
                "test"));

        return new Harness(context, recorder, audit, limiter, store);
    }

    /// <summary>Serialises whatever an endpoint returned, so a test can search the WHOLE response for a
    /// sentinel rather than the one field it thought to look at.</summary>
    private static async Task<(int Status, string Body)> ReadAsync(IResult result)
    {
        var context = new DefaultHttpContext();
        var stream = new MemoryStream();
        context.Response.Body = stream;
        context.RequestServices = new ServiceCollection()
            .AddLogging()
            .BuildServiceProvider();

        await result.ExecuteAsync(context);
        stream.Position = 0;
        using var reader = new StreamReader(stream);
        return (context.Response.StatusCode, await reader.ReadToEndAsync());
    }

    private static WebhookConfigRequest WebhookRequest(
        string url, string? signingSecret = null, string? authHeaderName = null, string? authToken = null,
        bool enabled = true, string? label = null, string? instance = null) =>
        new(enabled, nameof(AlarmPriority.High), url, label, authHeaderName, signingSecret, authToken, instance);

    // ─────────────────────────────────────────────────────────────────────
    // 1) 🔴 No credential leaves through an endpoint — success paths.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task NoCredentialReachesAnyResponseBodyOrAuditRow_AcrossEveryReadAndEveryWrite()
    {
        var store = NewStore();
        var h = NewHarness(store);

        var url = $"https://hooks.example.test/services/{UrlPathSentinel}";
        var save = await NotificationEndpoints.SaveWebhookAsync(
            WebhookRequest(url, SigningSentinel, "X-Api-Key", TokenSentinel), h.Context, h.Recorder, default);
        var (saveStatus, saveBody) = await ReadAsync(save);
        Assert.Equal(200, saveStatus);

        var smtpSave = await NotificationEndpoints.SaveSmtpAsync(
            new SmtpConfigRequest(true, nameof(AlarmPriority.High), "mail.example.test", 587,
                nameof(SmtpTlsMode.StartTls), "alarms@example.test", new[] { "ops@example.test" },
                "alarm-bot", PasswordSentinel),
            h.Context, h.Recorder, default);
        var (smtpStatus, smtpBody) = await ReadAsync(smtpSave);
        Assert.Equal(200, smtpStatus);

        var (_, listBody) = await ReadAsync(
            await NotificationEndpoints.ListChannelsAsync(h.Context, default));
        var (_, statusBody) = await ReadAsync(NotificationEndpoints.GetStatusAsync(h.Context));

        var auditJson = string.Join("\n", h.Audit.Rows.Select(r => $"{r.OldValueJson}|{r.NewValueJson}"));

        foreach (var (what, text) in new[]
                 {
                     ("the webhook save response", saveBody),
                     ("the SMTP save response", smtpBody),
                     ("the channel list", listBody),
                     ("the status page", statusBody),
                     ("the audit rows", auditJson),
                 })
        {
            foreach (var sentinel in new[] { UrlPathSentinel, SigningSentinel, TokenSentinel, PasswordSentinel })
            {
                Assert.DoesNotContain(sentinel, text, StringComparison.Ordinal);
            }
        }

        // Non-vacuity: the reads really did carry the configuration, so "no sentinel found" is not "nothing
        // was found". The NON-secret facts an operator needs are all there.
        Assert.Contains("hooks.example.test", listBody, StringComparison.Ordinal);
        Assert.Contains("X-Api-Key", listBody, StringComparison.Ordinal);
        Assert.Contains("hasSigningSecret", listBody, StringComparison.Ordinal);
        Assert.Contains("alarm-bot", listBody, StringComparison.Ordinal);
        Assert.Contains("ops@example.test", listBody, StringComparison.Ordinal);

        // And the audit rows exist and name what changed — a credential CHANGE is recorded as a boolean.
        Assert.Contains(h.Audit.Rows, r => r.Action == "notification.webhook.save");
        Assert.Contains(h.Audit.Rows, r => r.Action == "notification.smtp.save");
        // Review round 1 (I-1) — recorded by OUTCOME NAME rather than as a boolean, so "the store refused
        // this credential" is distinguishable in the log from "the request carried none".
        Assert.Contains("\"signingSecret\":\"Changed\"", auditJson, StringComparison.Ordinal);
        Assert.Contains("\"password\":\"Changed\"", auditJson, StringComparison.Ordinal);
    }

    [Fact]
    public async Task NoCredentialReachesAResponse_OnTheErrorPathsEither()
    {
        var store = NewStore();
        var h = NewHarness(store);

        // A malformed URL still carries the capability-bearing path: a 400 body is as long-lived as a log
        // line, and this one may be a working Slack URL with a typo'd scheme.
        var badScheme = await NotificationEndpoints.SaveWebhookAsync(
            WebhookRequest($"ftp://hooks.example.test/{UrlPathSentinel}", SigningSentinel),
            h.Context, h.Recorder, default);
        var (badSchemeStatus, badSchemeBody) = await ReadAsync(badScheme);
        Assert.Equal(400, badSchemeStatus);
        Assert.DoesNotContain(UrlPathSentinel, badSchemeBody, StringComparison.Ordinal);

        // A reserved auth header name is rejected AFTER the token has been bound off the request.
        var reserved = await NotificationEndpoints.SaveWebhookAsync(
            WebhookRequest($"https://hooks.example.test/{UrlPathSentinel}", SigningSentinel,
                "X-ST4I-Signature", TokenSentinel),
            h.Context, h.Recorder, default);
        var (reservedStatus, reservedBody) = await ReadAsync(reserved);
        Assert.Equal(400, reservedStatus);
        Assert.DoesNotContain(TokenSentinel, reservedBody, StringComparison.Ordinal);
        Assert.DoesNotContain(UrlPathSentinel, reservedBody, StringComparison.Ordinal);

        // A bad SMTP address is rejected with the password already bound.
        var badAddress = await NotificationEndpoints.SaveSmtpAsync(
            new SmtpConfigRequest(true, nameof(AlarmPriority.High), "mail.example.test", 587,
                nameof(SmtpTlsMode.StartTls), "not-an-address", new[] { "ops@example.test" },
                "alarm-bot", PasswordSentinel),
            h.Context, h.Recorder, default);
        var (badAddressStatus, badAddressBody) = await ReadAsync(badAddress);
        Assert.Equal(400, badAddressStatus);
        Assert.DoesNotContain(PasswordSentinel, badAddressBody, StringComparison.Ordinal);

        // 🔴 And nothing was written to the audit chain for a request that never got past validation —
        // otherwise a rejected save would still be a place a secret could be recorded.
        Assert.Empty(h.Audit.Rows);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2) 🔴 The carried item: a CLEARED form field must not fail the whole save.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task AnEmptyAuthHeaderName_ClearsIt_RatherThanFailingTheWholeSave()
    {
        var store = NewStore();
        var h = NewHarness(store);
        var url = "https://hooks.example.test/services/abc";

        var first = await NotificationEndpoints.SaveWebhookAsync(
            WebhookRequest(url, SigningSentinel, "X-Api-Key", TokenSentinel), h.Context, h.Recorder, default);
        Assert.Equal(200, (await ReadAsync(first)).Status);

        var configured = await store.ListAsync();
        Assert.Equal("X-Api-Key", configured.Single().Webhook!.AuthHeaderName);
        Assert.True(configured.Single().Webhook!.HasAuthToken);

        // 🔴 "" is exactly what an emptied form field sends, and NotificationConfigStore refuses a BLANK
        // header name outright (null clears; "" is invalid). Before this endpoint normalised it, an operator
        // clearing the field failed the WHOLE save with a complaint about the field they had just emptied.
        var cleared = await NotificationEndpoints.SaveWebhookAsync(
            WebhookRequest(url, authHeaderName: "", instance: null), h.Context, h.Recorder, default);
        var (clearedStatus, _) = await ReadAsync(cleared);
        Assert.Equal(200, clearedStatus);

        var after = (await store.ListAsync()).Single().Webhook!;
        Assert.Null(after.AuthHeaderName);
        // Clearing the header takes the token with it: a token naming no header can never be sent, and a
        // credential kept for a purpose that no longer exists is one nobody is auditing.
        Assert.False(after.HasAuthToken);
        // The signing secret was NOT touched — the request omitted it, which means "leave it alone".
        Assert.True(after.HasSigningSecret);
    }

    [Fact]
    public async Task ASecretFieldIsTriState_AbsentKeeps_EmptyClears_AndAValueReplaces()
    {
        var store = NewStore();
        var h = NewHarness(store);
        var url = "https://hooks.example.test/services/abc";

        await ReadAsync(await NotificationEndpoints.SaveWebhookAsync(
            WebhookRequest(url, SigningSentinel), h.Context, h.Recorder, default));
        Assert.True((await store.ListAsync()).Single().Webhook!.HasSigningSecret);

        // Absent → unchanged.
        await ReadAsync(await NotificationEndpoints.SaveWebhookAsync(
            WebhookRequest(url, signingSecret: null), h.Context, h.Recorder, default));
        Assert.True((await store.ListAsync()).Single().Webhook!.HasSigningSecret);
        Assert.Equal(SigningSentinel, await store.GetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret));

        // A value → replaced. Read back through the ENGINE-INTERNAL path (which the endpoint never uses)
        // so the assertion is about what was stored, not about what an endpoint reported.
        await ReadAsync(await NotificationEndpoints.SaveWebhookAsync(
            WebhookRequest(url, signingSecret: "second-key"), h.Context, h.Recorder, default));
        Assert.Equal("second-key", await store.GetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret));

        // "" → deleted.
        await ReadAsync(await NotificationEndpoints.SaveWebhookAsync(
            WebhookRequest(url, signingSecret: ""), h.Context, h.Recorder, default));
        Assert.False((await store.ListAsync()).Single().Webhook!.HasSigningSecret);
    }

    /// <summary>
    /// 🔴🔴 Review round 1 (I-1) — <b>a credential that did not commit must never answer 200.</b>
    ///
    /// <para>The chain the review traced: <c>SetSecretAsync</c> is never-throws and returns
    /// <see langword="false"/> only on failure; that <see langword="false"/> was folded into a flag whose
    /// other meaning was "the request carried no secret"; the channel row committed and the secret did not;
    /// the API answered 200 and the audit row said the secret had not changed; and because
    /// <c>HasSigningSecret</c> stayed false, <see cref="WebhookNotificationChannel"/> took its "no signing
    /// secret is configured" branch and <b>posted UNSIGNED</b>. A machine that had silently stopped proving
    /// its identity, after a green save.</para>
    ///
    /// <para>🔴 <b>Review round 2 (I-A) — the first version of this test did not hold the webhook branches
    /// down, and the webhook is the channel the finding was ABOUT.</b> Deleting both
    /// <c>if (… == SecretOutcome.Failed) return SecretFailed("webhook", …)</c> lines left all 30 tests
    /// passing: the broken-database case below asserts only <c>NotEqual(200)</c>, and it takes the ORDINARY
    /// rollback path (see the narrow test's own note on why a broken store cannot reach the webhook branch),
    /// while the narrow test exercised the shared plumbing through SMTP. So the branches were real, reachable
    /// code — <c>SetSecretAsync</c> opens its OWN connection, so a <c>SQLITE_BUSY</c> from a concurrent
    /// writer or a disk-full arriving between the two commits fails only the second write — and nothing
    /// would have noticed their removal.</para>
    ///
    /// <para><b>The lever that reaches them</b> is a trigger that aborts writes of ONE secret name. The
    /// webhook's channel save writes <c>webhook.url</c> inside its transaction and that still succeeds, so
    /// the channel row commits exactly as it does in production; the separate <c>SetSecretAsync</c> call for
    /// the signing secret is the only thing that fails. That is the defect's own shape, reproduced without
    /// simulating a disk.</para>
    /// </summary>
    [Fact]
    public async Task ACredentialThatFailedToStore_FailsTheRequest_RatherThanReturning200AndPostingUnsigned()
    {
        var store = NewStore();
        var h = NewHarness(store);
        var url = "https://hooks.example.test/services/abc";

        // A healthy save first, so the controls below are real comparisons.
        Assert.Equal(200, (await ReadAsync(await NotificationEndpoints.SaveWebhookAsync(
            WebhookRequest(url, SigningSentinel), h.Context, h.Recorder, default))).Status);

        // ── 🔴 The SIGNING SECRET branch — the one whose absence makes the channel post UNSIGNED.
        BlockSecretWrites(store, NotificationSecretNames.WebhookSigningSecret);

        var h2 = NewHarness(store);
        var (signingStatus, signingBody) = await ReadAsync(await NotificationEndpoints.SaveWebhookAsync(
            WebhookRequest(url, signingSecret: "a-new-key-that-cannot-be-stored", instance: "blocked-sign"),
            h2.Context, h2.Recorder, default));

        Assert.Equal(500, signingStatus);
        Assert.Contains("signing secret", signingBody, StringComparison.Ordinal);
        Assert.Contains("UNSIGNED", signingBody, StringComparison.Ordinal);
        Assert.DoesNotContain("a-new-key-that-cannot-be-stored", signingBody, StringComparison.Ordinal);

        // The channel row committed — that is what made the old 200 dangerous rather than merely wrong.
        var blockedSign = Assert.Single(
            await store.ListAsync(), c => c.Instance == "blocked-sign");
        Assert.False(blockedSign.Webhook!.HasSigningSecret);
        Assert.Contains(
            "\"signingSecret\":\"Failed\"",
            Assert.Single(h2.Audit.Rows, r => r.TargetId == "Webhook/blocked-sign").NewValueJson,
            StringComparison.Ordinal);

        // ── 🔴 The AUTH TOKEN branch, which is a separate `if` and would otherwise survive on its own.
        BlockSecretWrites(store, NotificationSecretNames.WebhookAuthToken);

        var h3 = NewHarness(store);
        var (tokenStatus, tokenBody) = await ReadAsync(await NotificationEndpoints.SaveWebhookAsync(
            WebhookRequest(url, authHeaderName: "X-Api-Key", authToken: "a-token-that-cannot-be-stored",
                instance: "blocked-token"),
            h3.Context, h3.Recorder, default));

        Assert.Equal(500, tokenStatus);
        Assert.Contains("authentication token", tokenBody, StringComparison.Ordinal);
        Assert.DoesNotContain("a-token-that-cannot-be-stored", tokenBody, StringComparison.Ordinal);
        Assert.False(
            Assert.Single(await store.ListAsync(), c => c.Instance == "blocked-token")
                .Webhook!.HasAuthToken);

        // ── The control: a save carrying NO blocked credential still succeeds, so the 500s above are about
        // the credential that failed rather than about the store being generally broken.
        var h4 = NewHarness(store);
        Assert.Equal(200, (await ReadAsync(await NotificationEndpoints.SaveWebhookAsync(
            WebhookRequest(url, instance: "unblocked"), h4.Context, h4.Recorder, default))).Status);
    }

    /// <summary>
    /// 🔴🔴 Review round 1 (I-1), the NARROW case and the dangerous one: <b>the channel row commits and only
    /// the CREDENTIAL fails.</b> That is precisely the state the old code answered <c>200</c> for.
    ///
    /// <para><b>Reached deterministically, and the mechanism is the point.</b> It has to be SMTP: the
    /// webhook's channel save writes its URL secret in the SAME transaction, so breaking the secrets table
    /// rolls the channel row back too and the request never reaches this branch.
    /// <c>SaveSmtpAsync</c> writes no secret at all — the password is a separate
    /// <c>SetSecretAsync</c> call — so dropping <c>notification_secrets</c> after the channel exists fails
    /// exactly one of the two writes, which is the real-world shape (a DPAPI failure, a disk error, a
    /// permissions change) without having to simulate any of them.</para>
    /// </summary>
    [Fact]
    public async Task AFailedSecretWrite_IsReportedAsAFailure_AndNamesWhichCredential()
    {
        var store = NewStore();
        var h = NewHarness(store);

        SmtpConfigRequest Request(string? password) => new(
            true, nameof(AlarmPriority.High), "mail.example.test", 587, nameof(SmtpTlsMode.StartTls),
            "alarms@example.test", new[] { "ops@example.test" }, "alarm-bot", password);

        // A healthy save first, so the control at the end is a real comparison and the channel row exists.
        Assert.Equal(200, (await ReadAsync(await NotificationEndpoints.SaveSmtpAsync(
            Request(PasswordSentinel), h.Context, h.Recorder, default))).Status);
        Assert.True((await store.ListAsync()).Single().Smtp!.HasPassword);

        DropSecretsTable(store);

        var h2 = NewHarness(store);
        var (status, body) = await ReadAsync(await NotificationEndpoints.SaveSmtpAsync(
            Request("a-new-password-that-cannot-be-stored"), h2.Context, h2.Recorder, default));

        // 🔴 NOT a 200. The old code returned one here.
        Assert.Equal(500, status);
        Assert.Contains("password", body, StringComparison.Ordinal);
        // The consequence is named, because a bare 500 does not tell an operator that the channel is now
        // live and credential-less.
        Assert.Contains("behave as though no", body, StringComparison.Ordinal);
        Assert.DoesNotContain("a-new-password-that-cannot-be-stored", body, StringComparison.Ordinal);

        // 🔴 The channel row really did commit — that is what made the old 200 dangerous rather than merely
        // wrong: the configuration is LIVE and the credential is gone. Counted straight out of the channels
        // table, because ListAsync joins the secrets table this test just removed and now reports nothing at
        // all — which is itself the "a failed read looks like nothing configured" property §7 surfaces.
        Assert.Equal(1, CountChannelRows(store));

        // And the audit row distinguishes "failed to store" from "the request carried none". The boolean it
        // replaced could not: both were false.
        Assert.Contains(
            "\"password\":\"Failed\"",
            Assert.Single(h2.Audit.Rows, r => r.Action == "notification.smtp.save").NewValueJson,
            StringComparison.Ordinal);

        // The control: on a healthy store the same request records Changed and answers 200, so "Failed" is
        // not simply what this field always says.
        var healthy = NewStore();
        var h3 = NewHarness(healthy);
        Assert.Equal(200, (await ReadAsync(await NotificationEndpoints.SaveSmtpAsync(
            Request(PasswordSentinel), h3.Context, h3.Recorder, default))).Status);
        Assert.Contains(
            "\"password\":\"Changed\"",
            Assert.Single(h3.Audit.Rows, r => r.Action == "notification.smtp.save").NewValueJson,
            StringComparison.Ordinal);

        // And a request carrying NO password records Unchanged — the third state the boolean collapsed.
        var h4 = NewHarness(healthy);
        Assert.Equal(200, (await ReadAsync(await NotificationEndpoints.SaveSmtpAsync(
            Request(null), h4.Context, h4.Recorder, default))).Status);
        Assert.Contains(
            "\"password\":\"Unchanged\"",
            Assert.Single(h4.Audit.Rows, r => r.Action == "notification.smtp.save").NewValueJson,
            StringComparison.Ordinal);
        Assert.True((await healthy.ListAsync()).Single().Smtp!.HasPassword);
    }

    /// <summary>
    /// 🔴 Review round 1 (I-2) — instance keys are caller-supplied and were unbounded in COUNT, and the
    /// webhook channel delivers to every configured instance on every qualifying edge. So an authenticated
    /// Engineer could turn one alarm into N outbound messages through the config route, which carries no
    /// rate limiter — defeating the send-test limiter's stated goal through the door it left open.
    /// </summary>
    [Fact]
    public async Task TheNumberOfInstancesPerChannelIsCapped_BecauseEachOneMultipliesEveryAlarmEdge()
    {
        var store = NewStore();
        var h = NewHarness(store);

        for (var i = 0; i < NotificationEndpoints.MaxInstancesPerChannel; i++)
        {
            Assert.Equal(200, (await ReadAsync(await NotificationEndpoints.SaveWebhookAsync(
                WebhookRequest($"https://hooks.example.test/services/{i}", instance: $"hook-{i}"),
                h.Context, h.Recorder, default))).Status);
        }

        var (status, body) = await ReadAsync(await NotificationEndpoints.SaveWebhookAsync(
            WebhookRequest("https://hooks.example.test/services/overflow", instance: "one-too-many"),
            h.Context, h.Recorder, default));

        Assert.Equal(409, status);
        Assert.Contains("multiplier", body, StringComparison.Ordinal);
        Assert.Equal(NotificationEndpoints.MaxInstancesPerChannel, (await store.ListAsync()).Count);

        // 🔴 A full channel must stay FIXABLE: re-saving an instance that already exists is the idempotent
        // case and is never refused, or an operator could not correct a bad URL on a full channel.
        Assert.Equal(200, (await ReadAsync(await NotificationEndpoints.SaveWebhookAsync(
            WebhookRequest("https://hooks.example.test/services/corrected", instance: "hook-0"),
            h.Context, h.Recorder, default))).Status);

        // And the cap is PER CHANNEL, not global: a full webhook channel does not block SMTP.
        Assert.Equal(200, (await ReadAsync(await NotificationEndpoints.SaveSmtpAsync(
            new SmtpConfigRequest(true, nameof(AlarmPriority.High), "mail.example.test", 587,
                nameof(SmtpTlsMode.StartTls), "alarms@example.test", new[] { "ops@example.test" }, null),
            h.Context, h.Recorder, default))).Status);
    }

    [Fact]
    public async Task AWebhookSaveWithoutAUrl_IsA400ThatSaysWhyRatherThanA500()
    {
        var h = NewHarness(NewStore());

        var (status, body) = await ReadAsync(await NotificationEndpoints.SaveWebhookAsync(
            WebhookRequest(url: ""), h.Context, h.Recorder, default));

        Assert.Equal(400, status);
        // The reason matters as much as the status: this endpoint CANNOT re-use a stored URL, because
        // reading an encrypted capability back inside a request handler is the path by which one reaches a
        // response body.
        Assert.Contains("urlFingerprint", body, StringComparison.Ordinal);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3) 🔴 The relay's own validation (its RBAC gate is proved in RbacPolicyTests).
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ACommandRelayWithLatchValues_AndAPointRelayWithout_AreBothRefused()
    {
        var store = NewStore();
        var h = NewHarness(store);

        var commandWithValues = await NotificationEndpoints.SaveRelayAsync(
            new RelayConfigRequest(true, nameof(AlarmPriority.Critical), "AOI-01",
                nameof(RelayTargetKind.Command), "pulse_beacon", "true", "false"),
            h.Context, h.Recorder, default);
        var (commandStatus, commandBody) = await ReadAsync(commandWithValues);
        Assert.Equal(400, commandStatus);
        Assert.Contains("argument-less pulse", commandBody, StringComparison.Ordinal);

        var pointWithout = await NotificationEndpoints.SaveRelayAsync(
            new RelayConfigRequest(true, nameof(AlarmPriority.Critical), "AOI-01",
                nameof(RelayTargetKind.Point), "beacon"),
            h.Context, h.Recorder, default);
        Assert.Equal(400, (await ReadAsync(pointWithout)).Status);

        // Nothing was stored by either refusal.
        Assert.Empty(await store.ListAsync());

        // Non-vacuity: a well-formed relay of each kind IS accepted, so the two 400s above are about the
        // asymmetry and not about the route refusing everything.
        Assert.Equal(200, (await ReadAsync(await NotificationEndpoints.SaveRelayAsync(
            new RelayConfigRequest(true, nameof(AlarmPriority.Critical), "AOI-01",
                nameof(RelayTargetKind.Point), "beacon", "1", "0"),
            h.Context, h.Recorder, default))).Status);
        Assert.Equal(200, (await ReadAsync(await NotificationEndpoints.SaveRelayAsync(
            new RelayConfigRequest(true, nameof(AlarmPriority.Critical), "AOI-01",
                nameof(RelayTargetKind.Command), "pulse_beacon", Instance: "horn"),
            h.Context, h.Recorder, default))).Status);
    }

    [Fact]
    public async Task ARelaySaveIsAudited_AndTheAuditRowSaysWhetherItGrantsCommandAuthority()
    {
        var store = NewStore();
        var h = NewHarness(store);

        await ReadAsync(await NotificationEndpoints.SaveRelayAsync(
            new RelayConfigRequest(true, nameof(AlarmPriority.Critical), "AOI-01",
                nameof(RelayTargetKind.Command), "pulse_beacon"),
            h.Context, h.Recorder, default));

        var row = Assert.Single(h.Audit.Rows, r => r.Action == "notification.relay.save");
        Assert.Equal("Relay/default", row.TargetId);
        // 🔴 The one fact about this row that is not an ordinary settings change: with TargetKind = Command
        // it makes this engine perform an Admin-tier machine command automatically, for as long as it exists.
        Assert.Contains("\"grantsCommandAuthority\":true", row.NewValueJson, StringComparison.Ordinal);

        // A Point relay is the control: the same audit field, the other value.
        await ReadAsync(await NotificationEndpoints.SaveRelayAsync(
            new RelayConfigRequest(true, nameof(AlarmPriority.Critical), "AOI-01",
                nameof(RelayTargetKind.Point), "beacon", "1", "0", Instance: "lamp"),
            h.Context, h.Recorder, default));
        var pointRow = Assert.Single(h.Audit.Rows, r => r.TargetId == "Relay/lamp");
        Assert.Contains("\"grantsCommandAuthority\":false", pointRow.NewValueJson, StringComparison.Ordinal);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 4) 🔴 THE RATE LIMIT — proven in ELAPSED TIME, never in counters.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 The bound this task owes Đợt B, asserted against a <see cref="Stopwatch"/>.
    ///
    /// <para>Two channels in this batch shipped budget tests that passed with the guard DELETED, because
    /// only wall-clock differed between the two worlds. So the assertion here is an inequality about elapsed
    /// time and accepted sends — with the limiter removed, all twelve requests are accepted in a few
    /// milliseconds and <c>elapsed >= (accepted - 1) * interval</c> fails immediately. The receiver's own
    /// request count is asserted too, because the point of the limiter is what the THIRD PARTY receives, not
    /// what a status code says.</para>
    /// </summary>
    [Fact]
    public async Task TheSendTestRateLimit_BoundsWhatReachesAThirdParty_MeasuredInElapsedTime()
    {
        await using var server = WebhookLoopbackServer.Start(_ => new ScriptedResponse(200, "OK"));
        var store = NewStore();
        await store.SaveWebhookAsync(true, AlarmPriority.High, server.Url());

        var interval = TimeSpan.FromMilliseconds(300);
        using var channel = NewWebhookChannel(store);
        var h = NewHarness(store, webhook: channel, rateLimit: interval);

        // 🔴 Review round 1 (I-4) — the loop is SPACED, and the spacing is the whole difference between a
        // test of a bound and a test of a wall. The first version fired twelve requests back to back; the
        // reviewer instrumented the passing run and got accepted=1, refused=11, elapsed=88 ms. Every
        // inequality below was then satisfied trivially (88 >= 0, 1 <= 1) and `accepted > 0` — whose stated
        // job was to rule out a wall — was satisfied by the single acceptance that ANY limiter, including a
        // permanent one, would have granted. Proved by mutation: making TryAcquire accept once per process
        // and refuse forever left all 24 tests green. In production that mutant is a send-test button that
        // works once per engine restart and then 429s forever with a Retry-After that never comes true.
        //
        // Spacing at 40% of the interval over ~24 attempts spans roughly three intervals, so several
        // acceptances are separated by real waiting and (accepted - 1) * interval is a number with teeth.
        const int attempts = 24;
        var spacing = TimeSpan.FromMilliseconds(interval.TotalMilliseconds * 0.4);
        var accepted = 0;
        var refused = 0;

        var elapsed = Stopwatch.StartNew();
        for (var i = 0; i < attempts; i++)
        {
            var (status, _) = await ReadAsync(await NotificationEndpoints.SendTestAsync(
                new NotificationTestRequest(nameof(NotificationChannel.Webhook)),
                h.Context, h.Limiter, h.Recorder, default));

            if (status == 200) accepted++;
            else if (status == 429) refused++;
            else Assert.Fail($"Unexpected status {status} from a send test.");

            await Task.Delay(spacing);
        }
        elapsed.Stop();

        // 🔴 The limiter must have RECOVERED repeatedly, not once. Without this the two inequalities below
        // are satisfiable by a permanent wall, which is what the review found.
        Assert.True(
            accepted >= 3,
            $"Only {accepted} send test(s) were ever accepted across {elapsed.ElapsedMilliseconds} ms and " +
            $"{attempts} attempts at a {interval.TotalMilliseconds} ms interval. A limiter that accepts once " +
            "and then refuses forever is a WALL, not a bound, and would pass the inequalities below.");

        // The bound itself. Every accepted send after the first had to wait a whole interval.
        Assert.True(
            elapsed.Elapsed >= TimeSpan.FromMilliseconds((accepted - 1) * interval.TotalMilliseconds),
            $"{accepted} send tests were accepted in {elapsed.ElapsedMilliseconds} ms, which is faster than " +
            $"the {interval.TotalMilliseconds} ms minimum interval allows. The limiter did not bind.");

        // The bound was never exceeded at any point, not merely on average.
        Assert.True(
            accepted <= (int)(elapsed.Elapsed.TotalMilliseconds / interval.TotalMilliseconds) + 1,
            $"{accepted} accepted in {elapsed.ElapsedMilliseconds} ms exceeds the interval bound.");

        // Non-vacuity in the other direction: it really did refuse.
        Assert.True(refused > 0, "No request was refused, so this test proves nothing about a limiter.");

        // 🔴 What the third party actually received. A limiter that returned 429 while still sending would
        // pass every assertion above.
        Assert.Equal(accepted, server.Requests.Count);
    }

    /// <summary>
    /// 🔴 Review round 1 (I-4) — recovery, on its own, stated as the property rather than inferred from a
    /// count. A refused caller that waits the interval it was told to wait must get through; a
    /// <c>Retry-After</c> that never comes true is worse than no limiter, because the caller believes it.
    /// </summary>
    [Fact]
    public async Task ARefusedSendTest_IsAcceptedAgainOnceItsRetryAfterHasElapsed()
    {
        await using var server = WebhookLoopbackServer.Start(_ => new ScriptedResponse(200, "OK"));
        var store = NewStore();
        await store.SaveWebhookAsync(true, AlarmPriority.High, server.Url());

        var interval = TimeSpan.FromMilliseconds(400);
        using var channel = NewWebhookChannel(store);
        var h = NewHarness(store, webhook: channel, rateLimit: interval);

        async Task<int> SendAsync() => (await ReadAsync(await NotificationEndpoints.SendTestAsync(
            new NotificationTestRequest(nameof(NotificationChannel.Webhook)),
            h.Context, h.Limiter, h.Recorder, default))).Status;

        Assert.Equal(200, await SendAsync());
        Assert.Equal(429, await SendAsync());

        // Wait out the interval the 429 promised, and the limiter must let the caller through.
        await Task.Delay(interval + TimeSpan.FromMilliseconds(150));
        Assert.Equal(200, await SendAsync());

        // 🔴 And it is still a limiter afterwards, not one that has given up: the very next attempt is
        // refused again. Without this, "recovered" would also be satisfied by a limiter that switched
        // itself off.
        Assert.Equal(429, await SendAsync());

        Assert.Equal(2, server.Requests.Count);
    }

    [Fact]
    public async Task ARefusedSendTest_Is429WithARetryAfter_AndWritesNoAuditRow()
    {
        await using var server = WebhookLoopbackServer.Start(_ => new ScriptedResponse(200, "OK"));
        var store = NewStore();
        await store.SaveWebhookAsync(true, AlarmPriority.High, server.Url());

        using var channel = NewWebhookChannel(store);
        var h = NewHarness(store, webhook: channel, rateLimit: TimeSpan.FromSeconds(30));

        var first = await NotificationEndpoints.SendTestAsync(
            new NotificationTestRequest(nameof(NotificationChannel.Webhook)),
            h.Context, h.Limiter, h.Recorder, default);
        Assert.Equal(200, (await ReadAsync(first)).Status);

        var second = await NotificationEndpoints.SendTestAsync(
            new NotificationTestRequest(nameof(NotificationChannel.Webhook)),
            h.Context, h.Limiter, h.Recorder, default);
        var (status, body) = await ReadAsync(second);

        Assert.Equal(429, status);
        Assert.Contains("rate limited", body, StringComparison.Ordinal);
        Assert.False(string.IsNullOrEmpty(h.Context.Response.Headers.RetryAfter.ToString()));

        // Nothing was sent for the refused one.
        Assert.Single(server.Requests);
        // 🔴 And exactly ONE audit row: a refusal deliberately writes none, or the refused path would cost
        // more than the accepted one — the wrong shape for a limiter.
        var row = Assert.Single(h.Audit.Rows, r => r.Action == "notification.test");

        // 🔴 Review round 1 (M-2) — the row records the OUTCOME, never `outcome.Detail`. Detail can carry an
        // HttpRequestException message, which is provider-controlled text: exactly what
        // NotificationConfigStoreHealth refuses to store for being destined for a response, and the audit
        // chain is the longest-lived store in this product.
        Assert.Contains("\"ok\":true", row.NewValueJson, StringComparison.Ordinal);
        Assert.DoesNotContain("detail", row.NewValueJson, StringComparison.OrdinalIgnoreCase);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 5) 🔴 The send test: what it sends, and what it refuses to claim.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task TheWebhookSendTestPostsATestBody_NotAFabricatedAlarm_AndSignsItLikeOne()
    {
        await using var server = WebhookLoopbackServer.Start(_ => new ScriptedResponse(200, "OK"));
        var store = NewStore();
        await store.SaveWebhookAsync(true, AlarmPriority.High, server.Url());
        await store.SetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret, SigningSentinel);

        using var channel = NewWebhookChannel(store);
        var h = NewHarness(store, webhook: channel);

        var (status, body) = await ReadAsync(await NotificationEndpoints.SendTestAsync(
            new NotificationTestRequest(nameof(NotificationChannel.Webhook)),
            h.Context, h.Limiter, h.Recorder, default));
        Assert.Equal(200, status);

        var outcome = JsonSerializer.Deserialize<NotificationTestOutcome>(body, Json)!;
        Assert.True(outcome.Ok, outcome.Detail);

        var request = Assert.Single(server.Requests);

        // 🔴 The body is a TEST, by its own discriminator. A receiver routing on `type` — which the contract
        // tells receivers to do — must not page for a configuration test.
        Assert.Contains($"\"type\":\"{WebhookContract.TestEventType}\"", request.BodyText, StringComparison.Ordinal);
        Assert.DoesNotContain("\"alarm\":", request.BodyText, StringComparison.Ordinal);
        Assert.DoesNotContain("\"edge\":", request.BodyText, StringComparison.Ordinal);
        Assert.DoesNotContain(WebhookContract.EventType, request.BodyText, StringComparison.Ordinal);

        // The Slack/Teams display line — the ENTIRE message a human sees there — says it is a test.
        Assert.Contains("[TEST]", request.BodyText, StringComparison.Ordinal);

        // 🔴 The header a router filters on says Test too, not an AlarmEdgeKind member. Sending "Raised"
        // here would be the same lie the separate body type exists to prevent.
        Assert.Equal(WebhookContract.TestEventHeaderValue, request.Header(WebhookContract.EventHeader));
        foreach (var edge in Enum.GetNames<AlarmEdgeKind>())
        {
            Assert.NotEqual(edge, request.Header(WebhookContract.EventHeader));
        }

        // 🔴 It is signed EXACTLY as an alarm POST is — which is what makes a green test evidence about the
        // credentials an alarm would actually use, rather than proof that a TCP connection can be made.
        var signature = request.Header(WebhookContract.SignatureHeader);
        Assert.NotNull(signature);
        var timestamp = long.Parse(request.Header(WebhookContract.TimestampHeader)!);
        Assert.Equal(WebhookSigner.Sign(request.Body, timestamp, SigningSentinel), signature);

        // And the signing key never appears on the wire or in the answer.
        Assert.DoesNotContain(SigningSentinel, request.BodyText, StringComparison.Ordinal);
        Assert.DoesNotContain(SigningSentinel, body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AGreenWebhookTest_StatesWhatItDoesNotProve_IncludingThatTheChannelIsDisabled()
    {
        await using var server = WebhookLoopbackServer.Start(_ => new ScriptedResponse(200, "OK"));
        var store = NewStore();
        // Deliberately DISABLED: configuring, testing, and only then switching on is the sane order, so the
        // test must run — and must say that nothing will be delivered until it is enabled.
        await store.SaveWebhookAsync(enabled: false, AlarmPriority.High, server.Url());

        using var channel = NewWebhookChannel(store);
        var h = NewHarness(store, webhook: channel);

        var (_, body) = await ReadAsync(await NotificationEndpoints.SendTestAsync(
            new NotificationTestRequest(nameof(NotificationChannel.Webhook)),
            h.Context, h.Limiter, h.Recorder, default));
        var outcome = JsonSerializer.Deserialize<NotificationTestOutcome>(body, Json)!;

        Assert.True(outcome.Ok, outcome.Detail);
        Assert.NotNull(outcome.Proves);
        Assert.NotNull(outcome.DoesNotProve);
        Assert.Contains("DISABLED", outcome.DoesNotProve!, StringComparison.Ordinal);

        // The control: an ENABLED channel must NOT carry that sentence, or "DISABLED" would just be
        // boilerplate that always appears and therefore says nothing.
        await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, server.Url());
        var h2 = NewHarness(store, webhook: channel);
        var (_, enabledBody) = await ReadAsync(await NotificationEndpoints.SendTestAsync(
            new NotificationTestRequest(nameof(NotificationChannel.Webhook)),
            h2.Context, h2.Limiter, h2.Recorder, default));
        var enabledOutcome = JsonSerializer.Deserialize<NotificationTestOutcome>(enabledBody, Json)!;
        Assert.DoesNotContain("DISABLED", enabledOutcome.DoesNotProve!, StringComparison.Ordinal);
    }

    /// <summary>
    /// 🔴🔴 The one lie this task was told not to tell. C-4 MEASURED that a send test built on
    /// <see cref="System.Net.Mail.SmtpClient"/> reports SUCCESS in every shape where the stored password is
    /// never used — including the reachable one: a relay that advertises <c>AUTH</c> only after
    /// <c>STARTTLS</c>, against a channel configured for <see cref="SmtpTlsMode.None"/>.
    ///
    /// <para>This test reproduces exactly that: a relay whose <c>EHLO</c> response advertises NO <c>AUTH</c>
    /// capability, a stored password, and a green result. It then asserts the outcome SAYS SO.</para>
    /// </summary>
    [Fact]
    public async Task AGreenEmailTest_NeverClaimsTheStoredPasswordWorks_AgainstARelayThatNeverAsksForIt()
    {
        // No AUTH in the EHLO response — so SmtpClient never offers the credential and carries straight on.
        await using var server = SmtpLoopbackServer.Start(new SmtpScript(EhloReply: "250 st4i-test"));
        var store = NewStore();
        await store.SaveSmtpAsync(
            true, AlarmPriority.High, SmtpLoopbackServer.Host, server.Port, SmtpTlsMode.None,
            "alarms@example.test", new[] { "ops@example.test" }, "alarm-bot");
        await store.SetSecretAsync(
            NotificationChannel.Smtp, NotificationSecretNames.SmtpPassword, PasswordSentinel);

        var channel = NewSmtpChannel(store);
        var h = NewHarness(store, smtp: channel);

        var (status, body) = await ReadAsync(await NotificationEndpoints.SendTestAsync(
            new NotificationTestRequest(nameof(NotificationChannel.Smtp)),
            h.Context, h.Limiter, h.Recorder, default));
        Assert.Equal(200, status);

        var outcome = JsonSerializer.Deserialize<NotificationTestOutcome>(body, Json)!;

        // The measured premise: it IS green, and the password was NEVER transmitted.
        Assert.True(outcome.Ok, outcome.Detail);
        var received = Assert.Single(server.Messages);
        Assert.Empty(received.AuthExchange);

        // 🔴 And the answer says so, in the field that exists for it.
        Assert.NotNull(outcome.DoesNotProve);
        Assert.Contains("does NOT prove the stored password was used", outcome.DoesNotProve!, StringComparison.Ordinal);
        Assert.Contains("UNAUTHENTICATED", outcome.DoesNotProve!, StringComparison.Ordinal);

        // The message a human receives repeats it, because the person reading the mailbox is often not the
        // person who pressed the button — and they are the one who would conclude "e-mail is working".
        Assert.Contains("WHAT IT DOES NOT PROVE", received.Body, StringComparison.Ordinal);
        Assert.Contains("UNAUTHENTICATED", received.Body, StringComparison.Ordinal);

        // The password is nowhere: not on the wire, not in the answer, not in the audit row.
        Assert.DoesNotContain(PasswordSentinel, received.Body, StringComparison.Ordinal);
        Assert.DoesNotContain(PasswordSentinel, body, StringComparison.Ordinal);
        Assert.DoesNotContain(
            PasswordSentinel,
            string.Join("\n", h.Audit.Rows.Select(r => r.NewValueJson)), StringComparison.Ordinal);
    }

    [Fact]
    public async Task AnEmailTestMessage_CarriesNoneOfTheHeadersAnAlarmEscalationFiltersOn()
    {
        await using var server = SmtpLoopbackServer.Start();
        var store = NewStore();
        await store.SaveSmtpAsync(
            true, AlarmPriority.High, SmtpLoopbackServer.Host, server.Port, SmtpTlsMode.None,
            "alarms@example.test", new[] { "ops@example.test" }, null);

        var channel = NewSmtpChannel(store);
        var h = NewHarness(store, smtp: channel);

        await ReadAsync(await NotificationEndpoints.SendTestAsync(
            new NotificationTestRequest(nameof(NotificationChannel.Smtp)),
            h.Context, h.Limiter, h.Recorder, default));

        var received = Assert.Single(server.Messages);

        // 🔴 A Sieve rule or an on-call escalation keyed on any of these cannot match a test message at all.
        Assert.Null(received.Header(SmtpContract.AlarmKeyHeader));
        Assert.Null(received.Header(SmtpContract.PriorityHeader));
        Assert.Null(received.Header(SmtpContract.EdgeHeader));
        Assert.Null(received.Header(SmtpContract.SourceHeader));

        // But the two that must never be dropped ARE there — without them an out-of-office responder
        // answers the test, which is how a mail loop starts.
        Assert.Equal(SmtpContract.AutoSubmittedValue, received.Header(SmtpContract.AutoSubmittedHeader));
        Assert.Equal(
            SmtpContract.AutoResponseSuppressValue, received.Header(SmtpContract.AutoResponseSuppressHeader));

        // And a human sees what it is before opening it, while the one filter that catches everything this
        // product sends still catches it.
        Assert.StartsWith($"{SmtpContract.SubjectTag} TEST", received.Header("Subject"));
    }

    [Fact]
    public async Task TheSendTestRefusesLocalAnnunciationAndRelay_WithTheReasonRatherThanSilently()
    {
        var h = NewHarness(NewStore());

        var (localStatus, localBody) = await ReadAsync(await NotificationEndpoints.SendTestAsync(
            new NotificationTestRequest(nameof(NotificationChannel.LocalAnnunciation)),
            h.Context, h.Limiter, h.Recorder, default));
        Assert.Equal(400, localStatus);
        Assert.Contains("fabricated alarm card", localBody, StringComparison.Ordinal);
        Assert.Contains("listeners", localBody, StringComparison.Ordinal);

        var (relayStatus, relayBody) = await ReadAsync(await NotificationEndpoints.SendTestAsync(
            new NotificationTestRequest(nameof(NotificationChannel.Relay)),
            h.Context, h.Limiter, h.Recorder, default));
        Assert.Equal(400, relayStatus);
        Assert.Contains("HALT latch", relayBody, StringComparison.Ordinal);
        Assert.Contains("annunciatorState", relayBody, StringComparison.Ordinal);
    }

    /// <summary>
    /// 🔴 "Bounded, and never blocks" — asserted against a <see cref="Stopwatch"/> and against a receiver
    /// that ACCEPTS the connection and then says nothing, which is the only shape in which the bound is
    /// observable at all. A refused connection fails on its own; a black hole does not.
    ///
    /// <para>The upper bound is what makes this a test of the timeout rather than of the network: with the
    /// attempt timeout removed the request never returns, and with retries added (which a send test
    /// deliberately does not have) it would take a multiple of the budget.</para>
    ///
    /// <para>🔴 <b>What this test deliberately does NOT assert, because the first version did and it was
    /// load-fragile.</b> It used to end with <c>Assert.Single(server.Requests)</c>. That is unsynchronised by
    /// construction: <see cref="WebhookLoopbackServer"/> enqueues a captured request from a
    /// <c>Task.Run</c> continuation, only after it has fully READ it — and this test's whole premise is that
    /// the client gives up after one second without waiting for the receiver to do anything. Under the full
    /// suite's startup contention (several <c>WebApplicationFactory</c> hosts booting at once saturate the
    /// thread pool) that continuation can land after the client has already abandoned the attempt, so the
    /// queue is empty and the assertion fails while the property under test — the bound — held perfectly.
    /// It failed exactly that way in a full run and passed in isolation and under a 368-test parallel load.
    /// Asserting on a receiver's bookkeeping for a request you deliberately did not wait for is not a
    /// weaker version of this test; it is a different, unsound one. The bound is the claim, and
    /// <c>outcome.Detail</c> is what proves the request was issued and timed out rather than never
    /// attempted.</para>
    /// </summary>
    [Fact]
    public async Task TheSendTestIsBounded_ANonAnsweringReceiverCannotHoldTheRequest_MeasuredInElapsedTime()
    {
        // null from the responder means "accept the request, capture it, and then never answer".
        await using var server = WebhookLoopbackServer.Start(_ => null);
        var store = NewStore();
        await store.SaveWebhookAsync(true, AlarmPriority.High, server.Url());

        var attemptTimeout = TimeSpan.FromSeconds(1);
        using var channel = new WebhookNotificationChannel(
            store, sourceHost: "TEST-ENGINE",
            attemptTimeout: attemptTimeout, totalBudget: TimeSpan.FromSeconds(30),
            baseBackoff: TimeSpan.FromMilliseconds(10), maxAttempts: 3);
        var h = NewHarness(store, webhook: channel);

        var elapsed = Stopwatch.StartNew();
        var (status, body) = await ReadAsync(await NotificationEndpoints.SendTestAsync(
            new NotificationTestRequest(nameof(NotificationChannel.Webhook)),
            h.Context, h.Limiter, h.Recorder, default));
        elapsed.Stop();

        Assert.Equal(200, status);
        var outcome = JsonSerializer.Deserialize<NotificationTestOutcome>(body, Json)!;
        Assert.False(outcome.Ok);
        Assert.Contains("did not answer within", outcome.Detail, StringComparison.Ordinal);

        // 🔴 The bound. 15 s against a 1 s attempt timeout is deliberately loose: the thing that must not
        // happen is the request being held indefinitely, and a tight window would be measuring this
        // machine's scheduler rather than the timeout. It is still decisive — widening the bound in
        // production to the 30 s total budget takes this to ~30 s and the assertion fails (mutation 17).
        Assert.True(
            elapsed.Elapsed < TimeSpan.FromSeconds(15),
            $"The send test took {elapsed.ElapsedMilliseconds} ms against a receiver that never answers — " +
            $"the {attemptTimeout.TotalSeconds:0.#}s attempt bound did not hold.");

        // Non-vacuity: it really did WAIT for the timeout rather than failing instantly for some other
        // reason, so the assertion above is about the bound and not about a connection that never happened.
        // A Stopwatch measures real time, so a timeout can only ever be LATE here, never early.
        Assert.True(
            elapsed.Elapsed >= attemptTimeout,
            $"The send test returned in {elapsed.ElapsedMilliseconds} ms, before the attempt timeout could " +
            "have elapsed — it failed for a reason other than the receiver's silence.");
    }

    /// <summary>
    /// 🔴 Review round 1 (M-5) — the SMTP send test's "bounded, never blocks" claim, MEASURED. It was
    /// previously asserted only for the webhook, and inherited for e-mail through the newly-extracted
    /// <c>SendMessageAsync</c> — but that extraction is new in this task, and C-4's measurement is what the
    /// claim actually rests on: <c>SmtpClient</c> honours its token in every phase EXCEPT a pending TCP
    /// connect, where a cancelled token did not return for <b>21 seconds</b> until C-4 backed it with a
    /// registration that DISPOSES the client. A refactor that dropped that registration would be invisible
    /// to every other test here and would hang a request for 21 s per configured instance.
    ///
    /// <para>The relay accepts the connection and then never sends its <c>220</c> banner — the shape that
    /// makes the bound observable, since a refused connection fails on its own.</para>
    /// </summary>
    [Fact]
    public async Task TheEmailSendTestIsBounded_ARelayThatNeverGreets_CannotHoldTheRequest_InElapsedTime()
    {
        await using var server = SmtpLoopbackServer.Start(new SmtpScript(Greeting: null));
        var store = NewStore();
        await store.SaveSmtpAsync(
            true, AlarmPriority.High, SmtpLoopbackServer.Host, server.Port, SmtpTlsMode.None,
            "alarms@example.test", new[] { "ops@example.test" }, null);

        var attemptTimeout = TimeSpan.FromSeconds(2);
        var channel = new SmtpNotificationChannel(
            store, sourceHost: "TEST-ENGINE",
            attemptTimeout: attemptTimeout, totalBudget: TimeSpan.FromSeconds(60),
            baseBackoff: TimeSpan.FromMilliseconds(10), maxAttempts: 1);
        var h = NewHarness(store, smtp: channel);

        var elapsed = Stopwatch.StartNew();
        var (status, body) = await ReadAsync(await NotificationEndpoints.SendTestAsync(
            new NotificationTestRequest(nameof(NotificationChannel.Smtp)),
            h.Context, h.Limiter, h.Recorder, default));
        elapsed.Stop();

        Assert.Equal(200, status);
        Assert.False(JsonSerializer.Deserialize<NotificationTestOutcome>(body, Json)!.Ok);

        // 🔴 The bound. Loose enough not to measure the scheduler, and far below both the 60 s budget and
        // the 21 s OS connect timeout that C-4's disposal mechanism exists to pre-empt.
        Assert.True(
            elapsed.Elapsed < TimeSpan.FromSeconds(15),
            $"The e-mail send test took {elapsed.ElapsedMilliseconds} ms against a relay that never greets " +
            $"— the {attemptTimeout.TotalSeconds:0.#}s attempt bound did not hold.");

        // Non-vacuity: it waited for the silence rather than failing instantly for another reason.
        Assert.True(
            elapsed.Elapsed >= attemptTimeout,
            $"The e-mail send test returned in {elapsed.ElapsedMilliseconds} ms, before its attempt timeout " +
            "could have elapsed — it failed for a reason other than the relay's silence.");
    }

    [Fact]
    public async Task AnUnreachableWebhookTest_IsAn200WithOkFalse_NotAnErrorStatus()
    {
        var store = NewStore();
        // A port nothing is listening on. The shape POST /v1/connectors/test established: a request that
        // parses fine but cannot reach anything is a 200 with an inline failure, never a 5xx.
        await store.SaveWebhookAsync(true, AlarmPriority.High, $"http://127.0.0.1:{ClosedPort()}/hook");

        using var channel = NewWebhookChannel(store);
        var h = NewHarness(store, webhook: channel);

        var (status, body) = await ReadAsync(await NotificationEndpoints.SendTestAsync(
            new NotificationTestRequest(nameof(NotificationChannel.Webhook)),
            h.Context, h.Limiter, h.Recorder, default));

        Assert.Equal(200, status);
        var outcome = JsonSerializer.Deserialize<NotificationTestOutcome>(body, Json)!;
        Assert.False(outcome.Ok);
        Assert.Null(outcome.Proves);
        Assert.Null(outcome.DoesNotProve);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 6) 🔴 The three wordings a review in this batch had to correct.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task UnheardIsWordedAsWhatItMeans_NotAsAlarmsNobodyWasToldAbout()
    {
        var store = NewStore();
        var hub = new AlarmAnnunciationHub();
        var local = new LocalAnnunciationChannel(store, hub);
        var h = NewHarness(store, local: local, hub: hub);

        var (_, body) = await ReadAsync(NotificationEndpoints.GetStatusAsync(h.Context));
        var status = JsonSerializer.Deserialize<NotificationStatusDto>(body, Json)!;

        var meaning = status.LocalAnnunciation!.UnheardMeaning;
        // 🔴 C-5 review round 2 (M-9): the counter NARROWED when the connect-time replay landed. Every
        // Restored at host start is counted Unheard AND THEN REPLAYED to the next page that connects.
        Assert.Contains("no browser session was attached", meaning, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("replayed to the next page that connects", meaning, StringComparison.Ordinal);
        Assert.Contains("NOT \"alarms nobody was told about\"", meaning, StringComparison.Ordinal);
        // What genuinely remains untold is named, so the correction is not merely a denial.
        Assert.Contains("cleared before anyone connected", meaning, StringComparison.Ordinal);
    }

    /// <summary>
    /// 🔴 C-6's carried constraint: <c>Energised</c> must never render as "off". Three states, three
    /// different facts, and the two that are not "off" are the ones that matter.
    /// </summary>
    [Fact]
    public void EnergisedNeverRendersAsOff_ExceptWhenItIsActuallyOff()
    {
        var now = DateTimeOffset.UtcNow;

        // 🔴 The state an operator must be able to see: the product asked for the beacon to go OUT and the
        // write did not succeed. The beacon is still lit.
        var refusedRelease = NotificationEndpoints.DescribeAnnunciator(
            new RelayInstanceState("default", LatchedAlarms: 0, Commanded: true, Energised: true, now));
        Assert.Contains("still lit", refusedRelease, StringComparison.Ordinal);
        Assert.DoesNotContain("OFF", refusedRelease, StringComparison.Ordinal);

        // 🔴 UNKNOWN is not off — a write came back Indeterminate and nobody knows whether the coil moved.
        var indeterminate = NotificationEndpoints.DescribeAnnunciator(
            new RelayInstanceState("default", 1, Commanded: true, Energised: null, now));
        Assert.Contains("UNKNOWN", indeterminate, StringComparison.Ordinal);
        Assert.Contains("INDETERMINATE", indeterminate, StringComparison.Ordinal);
        Assert.Contains("NOT the same as off", indeterminate, StringComparison.Ordinal);

        // A fresh process that has commanded nothing is also not "off".
        var fresh = NotificationEndpoints.DescribeAnnunciator(
            new RelayInstanceState("default", 0, Commanded: null, Energised: null, LastAttemptUtc: null));
        Assert.Contains("UNKNOWN", fresh, StringComparison.Ordinal);
        Assert.Contains("NOT the same as off", fresh, StringComparison.Ordinal);

        // And the control: genuinely off says off, or "never renders as off" would be trivially true.
        var off = NotificationEndpoints.DescribeAnnunciator(
            new RelayInstanceState("default", 0, Commanded: false, Energised: false, now));
        Assert.Contains("OFF", off, StringComparison.Ordinal);

        var on = NotificationEndpoints.DescribeAnnunciator(
            new RelayInstanceState("default", 3, Commanded: true, Energised: true, now));
        Assert.Contains("ON", on, StringComparison.Ordinal);
        Assert.DoesNotContain("still lit", on, StringComparison.Ordinal);
    }

    /// <summary>🔴 C-6 carried: C-7 must render <c>Energised</c>, never <c>Commanded</c>. Leaving
    /// <c>Commanded</c> out of the wire shape makes that mistake unavailable rather than discouraged.</summary>
    [Fact]
    public void TheRelayWireShapeDoesNotCarryCommanded_SoNoScreenCanRenderTheWrongOne()
    {
        var dto = new RelayInstanceStateDto(
            "default", LatchedAlarms: 0, Energised: true, LastAttemptUtc: DateTimeOffset.UtcNow,
            AnnunciatorState: "irrelevant");

        var json = JsonSerializer.Serialize(dto, Json);
        Assert.DoesNotContain("commanded", json, StringComparison.OrdinalIgnoreCase);
        // Non-vacuity: the fields that SHOULD be there are.
        Assert.Contains("energised", json, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("annunciatorState", json, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task PartialDeliveryIsHoistedIntoAttention_RatherThanBuriedAmongEightNumbers()
    {
        // A relay that accepts one recipient and rejects the other: the one failure mode that means a
        // person has silently stopped receiving alarms.
        await using var server = SmtpLoopbackServer.Start(new SmtpScript(
            RcptToReply: rcpt => rcpt.Contains("gone@", StringComparison.Ordinal)
                ? "550 5.1.1 No such mailbox"
                : "250 OK"));

        var store = NewStore();
        await store.SaveSmtpAsync(
            true, AlarmPriority.High, SmtpLoopbackServer.Host, server.Port, SmtpTlsMode.None,
            "alarms@example.test", new[] { "ops@example.test", "gone@example.test" }, null);

        var channel = NewSmtpChannel(store);
        await channel.DispatchAsync(Job(), default);
        Assert.Equal(1, channel.Stats.PartiallyDelivered);

        var h = NewHarness(store, smtp: channel);
        var (_, body) = await ReadAsync(NotificationEndpoints.GetStatusAsync(h.Context));
        var status = JsonSerializer.Deserialize<NotificationStatusDto>(body, Json)!;

        Assert.NotNull(status.Smtp!.PartialDelivery);
        Assert.Contains("silently", status.Smtp.PartialDelivery!, StringComparison.OrdinalIgnoreCase);
        // 🔴 Hoisted: an operator must not have to know which of eight numbers to read.
        Assert.Contains(status.Attention, a => a.Contains("rejected for others", StringComparison.Ordinal));
    }

    // ─────────────────────────────────────────────────────────────────────
    // 7) 🔴 The loss family no channel can count.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 "Nothing is configured" and "the configuration could not be READ" are the same observation from
    /// every counter in this batch, because <see cref="NotificationConfigStore.ListAsync"/> is never-throws
    /// and returns an empty list for both. This is the surface that separates them.
    /// </summary>
    [Fact]
    public async Task AConfigStoreReadFailure_IsDistinguishableFromNothingBeingConfigured()
    {
        var store = NewStore();
        var h = NewHarness(store);

        // Healthy and genuinely empty.
        var (_, healthyBody) = await ReadAsync(
            await NotificationEndpoints.ListChannelsAsync(h.Context, default));
        var healthy = JsonSerializer.Deserialize<NotificationChannelsDto>(healthyBody, Json)!;
        Assert.Empty(healthy.Channels);
        Assert.True(healthy.ConfigStore.Available);
        Assert.Equal(0, healthy.ConfigStore.ReadFailures);
        Assert.Contains("really does mean nothing is configured", healthy.ConfigStore.Detail, StringComparison.Ordinal);

        // Now make the read genuinely FAIL, by replacing the database file with something that is not one.
        CorruptDatabase(store);

        var (_, brokenBody) = await ReadAsync(
            await NotificationEndpoints.ListChannelsAsync(h.Context, default));
        var broken = JsonSerializer.Deserialize<NotificationChannelsDto>(brokenBody, Json)!;

        // The list is empty — exactly as it was when the store was healthy. That is the whole problem.
        Assert.Empty(broken.Channels);
        // And this is what makes the two distinguishable.
        Assert.True(broken.ConfigStore.ReadFailures > 0);
        Assert.NotNull(broken.ConfigStore.LastFailureType);
        Assert.Equal("list", broken.ConfigStore.LastFailureOperation);
        Assert.Contains("may be one that could not be read", broken.ConfigStore.Detail, StringComparison.Ordinal);

        // 🔴 The failure record carries the exception TYPE, never its message: a message is
        // provider-controlled text and this record goes into an HTTP response.
        Assert.DoesNotContain(" ", broken.ConfigStore.LastFailureType!);

        // And the status page hoists it, because a reader looking at four sets of zeroes needs to be told.
        var (_, statusBody) = await ReadAsync(NotificationEndpoints.GetStatusAsync(h.Context));
        var status = JsonSerializer.Deserialize<NotificationStatusDto>(statusBody, Json)!;
        Assert.Contains(status.Attention, a => a.Contains("could not be read", StringComparison.Ordinal));
    }

    /// <summary>
    /// 🔴 Review round 1 (M-3) — the degraded host, which §8 says is exactly when somebody looks at this
    /// page. <c>Program.cs</c> registers the annunciation hub UNCONDITIONALLY and maps
    /// <c>GET /v1/alarms/annunciations</c> unconditionally, while the local-annunciation CHANNEL exists only
    /// when the configuration store opened. Keying the block off both meant the listener gauges and the
    /// refused-stream warning vanished on precisely the host where the 503 subscriber cap is live and
    /// turning browsers away — the reader would have seen nothing about a stream actively refusing pages.
    /// </summary>
    [Fact]
    public async Task WithTheHubButNoChannel_TheListenerGaugesAndTheRefusedStreamWarningAreStillReported()
    {
        // A hub at capacity with a listener attached and one refused — the state a degraded host can be in.
        var hub = new AlarmAnnunciationHub(maxListeners: 1);
        using var attached = hub.TrySubscribe();
        Assert.NotNull(attached);
        Assert.False(hub.TryAdmitListener());

        // No store, therefore no channel — but the hub is real, as in production.
        var h = NewHarness(store: null, local: null, hub: hub);

        var (status, body) = await ReadAsync(NotificationEndpoints.GetStatusAsync(h.Context));
        Assert.Equal(200, status);

        var dto = JsonSerializer.Deserialize<NotificationStatusDto>(body, Json)!;
        Assert.NotNull(dto.LocalAnnunciation);
        Assert.Equal(1, dto.LocalAnnunciation!.Listeners);
        Assert.Equal(1, dto.LocalAnnunciation.MaxListeners);
        Assert.Equal(1, dto.LocalAnnunciation.RejectedListeners);
        // The channel's own counters are genuinely absent, and that is honest — there is no channel.
        Assert.Null(dto.LocalAnnunciation.Stats);
        // 🔴 And the refusal is hoisted, so a reader is told a page was turned away.
        Assert.Contains(dto.Attention, a => a.Contains("REFUSED an alarm-annunciation stream", StringComparison.Ordinal));
    }

    [Fact]
    public async Task WithNoConfigurationStoreAtAll_EveryRouteAnswersHonestlyRatherThanFailingToBind()
    {
        // Program.cs registers the store ONLY when it could be opened, so this is a real production state.
        var h = NewHarness(store: null);

        var (listStatus, listBody) = await ReadAsync(
            await NotificationEndpoints.ListChannelsAsync(h.Context, default));
        Assert.Equal(200, listStatus);
        var list = JsonSerializer.Deserialize<NotificationChannelsDto>(listBody, Json)!;
        Assert.False(list.ConfigStore.Available);
        Assert.Contains("no alarm notification channel is running", list.ConfigStore.Detail,
            StringComparison.OrdinalIgnoreCase);

        // A save is a 503 rather than a 500 or a binding failure: the dependency is down, and saying so is
        // more useful than a stack trace.
        var (saveStatus, _) = await ReadAsync(await NotificationEndpoints.SaveWebhookAsync(
            WebhookRequest("https://hooks.example.test/x"), h.Context, h.Recorder, default));
        Assert.Equal(503, saveStatus);

        // And the status page still answers, because a degraded host is exactly when somebody looks at it.
        var (statusStatus, statusBody) = await ReadAsync(NotificationEndpoints.GetStatusAsync(h.Context));
        Assert.Equal(200, statusStatus);
        var status = JsonSerializer.Deserialize<NotificationStatusDto>(statusBody, Json)!;
        Assert.False(status.ConfigStore.Available);
        Assert.NotEmpty(status.Attention);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 8) Delete, and instance validation.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task DeletingAChannelTakesItsStoredCredentialsWithIt_AndIsAudited()
    {
        var store = NewStore();
        var h = NewHarness(store);

        await ReadAsync(await NotificationEndpoints.SaveWebhookAsync(
            WebhookRequest("https://hooks.example.test/x", SigningSentinel), h.Context, h.Recorder, default));
        Assert.NotNull(await store.GetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret));

        var (status, _) = await ReadAsync(await NotificationEndpoints.DeleteWebhookAsync(
            null, h.Context, h.Recorder, default));
        Assert.Equal(200, status);

        Assert.Empty(await store.ListAsync());
        // ON DELETE CASCADE: "remove this channel" cannot strand a credential.
        Assert.Null(await store.GetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret));
        Assert.Contains(h.Audit.Rows, r => r.Action == "notification.webhook.delete");

        // Deleting what is not there is a 404 and writes no audit row.
        var before = h.Audit.Rows.Count;
        var (missing, _) = await ReadAsync(await NotificationEndpoints.DeleteWebhookAsync(
            null, h.Context, h.Recorder, default));
        Assert.Equal(404, missing);
        Assert.Equal(before, h.Audit.Rows.Count);
    }

    [Fact]
    public async Task AnUnusableInstanceKeyIsRefused_BecauseItBecomesAPrimaryKey()
    {
        var store = NewStore();
        var h = NewHarness(store);

        foreach (var bad in new[] { "../escape", "with space", new string('x', 65), "-leading" })
        {
            var (status, _) = await ReadAsync(await NotificationEndpoints.SaveLocalAnnunciationAsync(
                new LocalAnnunciationConfigRequest(true, nameof(AlarmPriority.High), bad),
                h.Context, h.Recorder, default));
            Assert.Equal(400, status);
        }

        Assert.Empty(await store.ListAsync());

        // Non-vacuity: a legitimate second instance IS accepted, and an omitted one becomes "default".
        Assert.Equal(200, (await ReadAsync(await NotificationEndpoints.SaveLocalAnnunciationAsync(
            new LocalAnnunciationConfigRequest(true, nameof(AlarmPriority.High), "shift-2"),
            h.Context, h.Recorder, default))).Status);
        Assert.Equal(200, (await ReadAsync(await NotificationEndpoints.SaveLocalAnnunciationAsync(
            new LocalAnnunciationConfigRequest(true, nameof(AlarmPriority.High)),
            h.Context, h.Recorder, default))).Status);

        var saved = (await store.ListAsync()).Select(c => c.Instance).OrderBy(i => i, StringComparer.Ordinal);
        Assert.Equal(new[] { "default", "shift-2" }, saved);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────

    private static WebhookNotificationChannel NewWebhookChannel(NotificationConfigStore store) =>
        new(store, sourceHost: "TEST-ENGINE",
            attemptTimeout: TimeSpan.FromSeconds(2), totalBudget: TimeSpan.FromSeconds(4),
            baseBackoff: TimeSpan.FromMilliseconds(10), maxAttempts: 3);

    private static SmtpNotificationChannel NewSmtpChannel(NotificationConfigStore store) =>
        new(store, sourceHost: "TEST-ENGINE",
            attemptTimeout: TimeSpan.FromSeconds(4), totalBudget: TimeSpan.FromSeconds(8),
            baseBackoff: TimeSpan.FromMilliseconds(10), maxAttempts: 1);

    private static NotificationJob Job() => new(
        1, AlarmEdgeKind.Raised,
        new Alarm(1, "DriverHealth|DOWN|AOI-01", AlarmSource.DriverHealth, "DOWN", AlarmPriority.High,
            AlarmState.Active, "Driver AOI-01 is unreachable", null, "AOI-01", false, 1,
            DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, null, null),
        DateTimeOffset.UtcNow, null, null);

    /// <summary>Replaces <c>notifications.db</c> with something that is not a database, so a read genuinely
    /// FAILS rather than merely returning nothing. The WAL sidecars go too — SQLite would otherwise recover
    /// the real file from them.</summary>
    /// <summary>
    /// 🔴 Review round 2 (I-A) — fails the write of ONE named secret and nothing else.
    ///
    /// <para>This is what reaches the webhook's credential branches, which <see cref="DropSecretsTable"/>
    /// structurally cannot: the webhook's channel save writes <c>webhook.url</c> in the SAME transaction, so
    /// breaking the whole table rolls the channel row back and the request takes the ordinary save-failure
    /// path instead. A trigger scoped to one <c>name</c> lets the in-transaction URL write commit exactly as
    /// it does in production and fails only the separate <c>SetSecretAsync</c> call — which is the real
    /// defect's shape (that call opens its own connection, so a concurrent-writer lock or a full disk hits
    /// precisely one of the two commits).</para>
    /// </summary>
    private static void BlockSecretWrites(NotificationConfigStore store, string secretName)
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        using var connection = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={store.DbPath}");
        connection.Open();
        using var cmd = connection.CreateCommand();
        // Both INSERT and UPDATE: UpsertSecretAsync is an ON CONFLICT DO UPDATE, so which one fires depends
        // on whether that secret already exists, and the test must not depend on that.
        cmd.CommandText = $"""
            CREATE TRIGGER block_insert_{secretName.Replace('.', '_')}
            AFTER INSERT ON notification_secrets WHEN NEW.name = '{secretName}'
            BEGIN SELECT RAISE(ABORT, 'blocked by test'); END;

            CREATE TRIGGER block_update_{secretName.Replace('.', '_')}
            AFTER UPDATE ON notification_secrets WHEN NEW.name = '{secretName}'
            BEGIN SELECT RAISE(ABORT, 'blocked by test'); END;
            """;
        cmd.ExecuteNonQuery();
    }

    /// <summary>🔴 Review round 1 (I-1) — breaks ONLY the credential store, leaving the channel tables
    /// writable, so a save can commit its row and fail its secret. See the test for why that asymmetry
    /// cannot be produced through the webhook.</summary>
    private static void DropSecretsTable(NotificationConfigStore store)
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        using var connection = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={store.DbPath}");
        connection.Open();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = "DROP TABLE notification_secrets;";
        cmd.ExecuteNonQuery();
    }

    /// <summary>Rows in <c>notification_channels</c>, read directly — the only way to see that a channel
    /// committed once <see cref="DropSecretsTable"/> has made <c>ListAsync</c> unable to answer.</summary>
    private static long CountChannelRows(NotificationConfigStore store)
    {
        using var connection = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={store.DbPath}");
        connection.Open();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM notification_channels;";
        return Convert.ToInt64(cmd.ExecuteScalar(), System.Globalization.CultureInfo.InvariantCulture);
    }

    private static void CorruptDatabase(NotificationConfigStore store)
    {
        // ClearAllPools first: Microsoft.Data.Sqlite POOLS connections, so the file stays locked after a
        // read until the pool is drained — the same precedent LocalAnnunciationChannelTests established.
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        File.WriteAllText(store.DbPath, "this is not a SQLite database, it is a text file");
    }

    private static int ClosedPort()
    {
        var listener = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    private sealed class RecordingAuditStore : IAuditStore
    {
        private readonly ConcurrentQueue<AuditEntry> _rows = new();

        public IReadOnlyList<AuditEntry> Rows => _rows.ToList();

        public Task<AuditEntry> AppendAsync(AuditAppend e, CancellationToken ct)
        {
            var entry = new AuditEntry(
                _rows.Count + 1, e.AtUtc, e.ActorUsername, e.ActorRole, e.Action, e.TargetType, e.TargetId,
                e.OldValueJson, e.NewValueJson, e.CorrelationId, e.ClientIp,
                new string('0', 64), new string('0', 64));
            _rows.Enqueue(entry);
            return Task.FromResult(entry);
        }

        public Task<AuditPage> QueryAsync(
            DateTimeOffset? from, DateTimeOffset? to, string? actor, string? action, string? target,
            int limit, int offset, CancellationToken ct) =>
            Task.FromResult(new AuditPage(Rows, _rows.Count, limit, offset));

        public Task<AuditVerifyResult> VerifyChainAsync(CancellationToken ct) =>
            Task.FromResult(new AuditVerifyResult(true, null, "in-memory test double"));
    }
}
