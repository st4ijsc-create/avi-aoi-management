using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
using St4i.EngineApi.Alarms;
using Xunit;

namespace St4i.EngineApi.Tests.Alarms;

/// <summary>
/// 🔴 Task C-4 — <see cref="SmtpNotificationChannel"/>: the message an operator actually reads, the
/// envelope it travels in, the RFC 5321 retry policy and its measured bound, the cancellation behaviour
/// <see cref="System.Net.Mail.SmtpClient"/> does and does not give for free, and the rule that the stored
/// password never reaches a log line.
///
/// <para>Every test sends to a REAL in-process SMTP relay (<see cref="SmtpLoopbackServer"/>) and reads a
/// REAL <see cref="NotificationConfigStore"/>, for the same reason C-3's suite does: a fake would define
/// away exactly the things under test — the SMTP conversation itself, and the DPAPI round trip the password
/// takes.</para>
/// </summary>
public sealed class SmtpNotificationChannelTests : IDisposable
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
        var dir = Directory.CreateTempSubdirectory("st4i-smtp-channel-tests-").FullName;
        _tempDirs.Add(dir);
        return dir;
    }

    private NotificationConfigStore NewStore() => new(NewTempDir());

    /// <summary>Distinctive enough that finding it anywhere is proof of a leak.</summary>
    private const string PasswordSentinel = "SMTPPASS-do-not-leak-3e91cc";

    /// <summary>The instance name the leak test configures under. Distinctive on purpose (review, m-2): its
    /// non-vacuity guard asserts the identity DID reach the reported message, and a common word like
    /// "default" could match unrelated prose and prove nothing.</summary>
    private const string LeakProbeInstance = "leakprobe-8c4f12";

    private const string From = "alarms@plant.local";
    private const string Recipient = "ops@plant.local";

    private static readonly DateTimeOffset FixedNow = new(2026, 7, 30, 9, 15, 22, TimeSpan.Zero);

    private static Alarm MakeAlarm(
        string key = "DriverHealth|DOWN|MODBUS-01",
        AlarmPriority priority = AlarmPriority.High,
        AlarmState state = AlarmState.Active,
        string? runbook = "runbook://drivers/down",
        bool clearOnAck = false) =>
        new(1, key, AlarmSource.DriverHealth, "DOWN", priority, state,
            "Driver MODBUS-01 is unreachable", runbook, "MODBUS-01",
            ClearOnAck: clearOnAck, Count: 7,
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
    private static SmtpNotificationChannel NewChannel(
        NotificationConfigStore store,
        ICollection<string>? warnings = null,
        ICollection<(Exception Cause, string Message)>? errors = null,
        TimeSpan? attemptTimeout = null,
        TimeSpan? totalBudget = null,
        TimeSpan? baseBackoff = null,
        int maxAttempts = 3) =>
        new(store,
            logError: (ex, msg) => { if (errors is not null) lock (errors) errors.Add((ex, msg)); },
            logWarning: msg => { if (warnings is not null) lock (warnings) warnings.Add(msg); },
            sourceHost: "TEST-ENGINE",
            attemptTimeout: attemptTimeout ?? TimeSpan.FromSeconds(2),
            totalBudget: totalBudget ?? TimeSpan.FromSeconds(5),
            baseBackoff: baseBackoff ?? TimeSpan.FromMilliseconds(20),
            maxAttempts: maxAttempts,
            clock: () => FixedNow);

    private static Task<bool> SaveSmtpAsync(
        NotificationConfigStore store, int port,
        bool enabled = true,
        AlarmPriority minPriority = AlarmPriority.High,
        SmtpTlsMode tls = SmtpTlsMode.None,
        string? username = null,
        IReadOnlyList<string>? recipients = null,
        string host = SmtpLoopbackServer.Host,
        string from = From,
        string instance = NotificationConfigStore.DefaultInstance) =>
        store.SaveSmtpAsync(
            enabled, minPriority, host, port, tls, from,
            recipients ?? new[] { Recipient }, username, instance);

    private static void ExecuteSql(NotificationConfigStore store, string sql)
    {
        using var connection = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={store.DbPath}");
        connection.Open();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
    }

    /// <summary>Overwrites the stored password's DPAPI ciphertext with bytes that cannot be unprotected
    /// while LEAVING THE ROW — exactly what a <c>notifications.db</c> copied from another machine looks
    /// like to this one.</summary>
    private static void CorruptStoredPassword(NotificationConfigStore store) =>
        ExecuteSql(store,
            $"UPDATE notification_secrets SET secret = X'DEADBEEFDEADBEEF' " +
            $"WHERE name = '{NotificationSecretNames.SmtpPassword}';");

    // ─────────────────────────────────────────────────────────────────────
    // The happy path: a real conversation, asserted on the envelope AND the content.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 The brief's first requirement: a successful send against an in-process SMTP server, asserting the
    /// ENVELOPE and the MESSAGE CONTENT rather than merely that nothing threw.
    ///
    /// <para>Envelope and headers are deliberately asserted SEPARATELY. <c>MAIL FROM</c>/<c>RCPT TO</c> are
    /// what the relay routes on; <c>From:</c>/<c>To:</c> are what the recipient's client displays. They are
    /// different things that happen to agree here, and a test that checked only one would pass while the
    /// other was wrong.</para>
    /// </summary>
    [Fact]
    public async Task AConfiguredChannel_SendsARealMessage_WithTheRightEnvelopeAndContent()
    {
        await using var relay = SmtpLoopbackServer.Start();
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, relay.Port, recipients: new[] { Recipient, "line3@plant.local" }));

        var channel = NewChannel(store);
        await channel.DispatchAsync(MakeJob());

        var received = Assert.Single(relay.Messages);

        // The envelope the relay routes on.
        Assert.Equal(From, received.MailFrom);
        Assert.Equal(new[] { Recipient, "line3@plant.local" }, received.RcptTo);

        // The headers the recipient's client displays.
        Assert.Equal(From, received.Header("From"));
        Assert.Equal($"{Recipient}, line3@plant.local", received.Header("To"));

        // The subject: filterable prefix, then how bad, then what changed, then what it is about.
        Assert.Equal(
            "[ST4I] HIGH RAISED - DriverHealth/DOWN on MODBUS-01 (TEST-ENGINE)",
            received.Header("Subject"));

        // The body an operator actually reads.
        Assert.Contains("A HIGH alarm has been RAISED on TEST-ENGINE.", received.Body, StringComparison.Ordinal);
        Assert.Contains("Driver MODBUS-01 is unreachable", received.Body, StringComparison.Ordinal);
        Assert.Contains("runbook://drivers/down", received.Body, StringComparison.Ordinal);
        Assert.Contains("DriverHealth|DOWN|MODBUS-01", received.Body, StringComparison.Ordinal);
        Assert.Contains("7 time(s) since", received.Body, StringComparison.Ordinal);
        Assert.Contains("there is no delivery queue", received.Body, StringComparison.OrdinalIgnoreCase);

        // Plain text, never HTML — see SmtpMessageBuilder for why.
        Assert.Contains("text/plain", received.Header("Content-Type")!, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("text/html", received.Header("Content-Type")!, StringComparison.OrdinalIgnoreCase);

        var stats = channel.Stats;
        Assert.Equal(1, stats.Considered);
        Assert.Equal(1, stats.Delivered);
        Assert.Equal(1, stats.Attempts);
        Assert.Equal(0, stats.Lost);
        Assert.Equal(0, stats.Retries);
        Assert.Equal(0, stats.PartiallyDelivered);
    }

    /// <summary>🔴 The machine-facing headers, which is how a server-side rule routes an alarm without
    /// parsing anything. <c>Auto-Submitted</c> is the load-bearing one: without it a recipient's
    /// out-of-office replies to every alarm, and a shared mailbox with an auto-responder can start a mail
    /// loop.</summary>
    [Fact]
    public async Task TheMessageCarriesTheFilteringHeaders_AndTellsAutoRespondersNotToReply()
    {
        await using var relay = SmtpLoopbackServer.Start();
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, relay.Port));

        var channel = NewChannel(store);
        await channel.DispatchAsync(MakeJob(AlarmEdgeKind.Escalated, previousPriority: AlarmPriority.High));

        var received = Assert.Single(relay.Messages);
        Assert.Equal("DriverHealth|DOWN|MODBUS-01", received.Header(SmtpContract.AlarmKeyHeader));
        Assert.Equal("High", received.Header(SmtpContract.PriorityHeader));
        Assert.Equal("Escalated", received.Header(SmtpContract.EdgeHeader));
        Assert.Equal("DriverHealth", received.Header(SmtpContract.SourceHeader));
        Assert.Equal("default", received.Header(SmtpContract.InstanceHeader));
        Assert.Equal("TEST-ENGINE", received.Header(SmtpContract.HostHeader));

        Assert.Equal(SmtpContract.AutoSubmittedValue, received.Header(SmtpContract.AutoSubmittedHeader));
        Assert.Equal(
            SmtpContract.AutoResponseSuppressValue,
            received.Header(SmtpContract.AutoResponseSuppressHeader));
    }

    /// <summary>
    /// 🔴 Threading, which is the difference between an inbox of unrelated alerts and a conversation per
    /// alarm. The subject CHANGES per edge (so RAISED and CLEARED are distinguishable at a glance) while
    /// <c>References</c> stays constant per alarm key (so they group). Both facts at once is the whole
    /// design; either alone is a worse inbox.
    /// </summary>
    [Fact]
    public async Task EveryEdgeForOneAlarm_SharesAThreadRoot_WhileItsSubjectStillSaysWhatChanged()
    {
        await using var relay = SmtpLoopbackServer.Start();
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, relay.Port));

        var channel = NewChannel(store);
        var alarm = MakeAlarm();
        await channel.DispatchAsync(MakeJob(AlarmEdgeKind.Raised, alarm, sequence: 1));
        await channel.DispatchAsync(MakeJob(AlarmEdgeKind.Acked, alarm, actor: "thanh", sequence: 2));
        await channel.DispatchAsync(MakeJob(AlarmEdgeKind.Cleared, alarm, sequence: 3));

        Assert.Equal(3, relay.Messages.Count);
        var roots = relay.Messages.Select(m => m.Header("References")).Distinct().ToArray();
        var root = Assert.Single(roots);
        Assert.StartsWith("<st4i.alarm.", root!, StringComparison.Ordinal);
        Assert.EndsWith("@plant.local>", root, StringComparison.Ordinal);
        Assert.All(relay.Messages, m => Assert.Equal(root, m.Header("In-Reply-To")));

        // ...and the subjects still differ, so the message list is readable.
        var subjects = relay.Messages.Select(m => m.Header("Subject")).ToArray();
        Assert.Equal(3, subjects.Distinct().Count());
        Assert.Contains("RAISED", subjects[0]!, StringComparison.Ordinal);
        Assert.Contains("ACKED", subjects[1]!, StringComparison.Ordinal);
        Assert.Contains("CLEARED", subjects[2]!, StringComparison.Ordinal);

        // Message-IDs are per message, and carry the sequence so two are never confusable.
        var ids = relay.Messages.Select(m => m.Header("Message-ID")).ToArray();
        Assert.Equal(3, ids.Distinct().Count());
        Assert.All(ids, id => Assert.EndsWith("@plant.local>", id!, StringComparison.Ordinal));

        // A DIFFERENT alarm key must NOT join the thread — otherwise "one conversation per alarm" is
        // really "one conversation for everything", which is the same as no threading at all.
        await channel.DispatchAsync(MakeJob(alarm: MakeAlarm(key: "NgRate|HIGH|fleet"), sequence: 4));
        Assert.NotEqual(root, relay.Messages[3].Header("References"));
    }

    /// <summary>
    /// 🔴 Four of the five edge kinds are NOT "an alarm is happening", and the headline says which — the
    /// single most important sentence for somebody reading this on a phone at 02:00. <c>Restored</c> in
    /// particular must never read as a new alarm: it fires once per engine restart for a condition that may
    /// have started hours ago, and a crash-looping process would otherwise page somebody repeatedly.
    /// </summary>
    [Theory]
    [InlineData(AlarmEdgeKind.Raised, "has been RAISED")]
    [InlineData(AlarmEdgeKind.Escalated, "has ESCALATED")]
    [InlineData(AlarmEdgeKind.Acked, "was ACKNOWLEDGED")]
    [InlineData(AlarmEdgeKind.Cleared, "has CLEARED")]
    [InlineData(AlarmEdgeKind.Restored, "ALREADY STANDING")]
    public async Task EachEdgeKind_SaysWhatItActuallyMeans_NotJustThatSomethingHappened(
        AlarmEdgeKind edge, string expected)
    {
        await using var relay = SmtpLoopbackServer.Start();
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, relay.Port));

        var channel = NewChannel(store);
        await channel.DispatchAsync(MakeJob(
            edge,
            previousPriority: edge == AlarmEdgeKind.Escalated ? AlarmPriority.Low : null,
            actor: edge == AlarmEdgeKind.Acked ? "thanh" : null));

        var received = Assert.Single(relay.Messages);
        Assert.Contains(expected, received.Body, StringComparison.Ordinal);

        // Non-vacuity: the restart notice must not be describable as a fresh raise.
        if (edge == AlarmEdgeKind.Restored)
        {
            Assert.DoesNotContain("has been RAISED", received.Body, StringComparison.Ordinal);
            Assert.Contains("not a new condition", received.Body, StringComparison.OrdinalIgnoreCase);
        }
    }

    /// <summary>An alarm with no runbook must not produce a message whose action section is blank — being
    /// told there is a problem and nothing else is the worst version of this message.</summary>
    [Fact]
    public async Task AnAlarmWithNoRunbook_StillTellsTheOperatorWhereToGo()
    {
        await using var relay = SmtpLoopbackServer.Start();
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, relay.Port));

        var channel = NewChannel(store);
        await channel.DispatchAsync(MakeJob(alarm: MakeAlarm(runbook: null)));

        var received = Assert.Single(relay.Messages);
        Assert.Contains("WHAT TO DO", received.Body, StringComparison.Ordinal);
        Assert.Contains("No runbook is recorded", received.Body, StringComparison.Ordinal);
        Assert.Contains("alarms page on TEST-ENGINE", received.Body, StringComparison.Ordinal);
        // A CONDITION alarm must not be described as one an ack will clear.
        Assert.Contains("clears only when the", received.Body, StringComparison.Ordinal);
    }

    /// <summary>Only Critical is marked urgent. Marking everything urgent is how a client's urgent flag
    /// stops meaning anything.</summary>
    [Fact]
    public async Task OnlyACriticalAlarm_IsMarkedUrgent()
    {
        await using var relay = SmtpLoopbackServer.Start();
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, relay.Port, minPriority: AlarmPriority.Low));

        var channel = NewChannel(store);
        await channel.DispatchAsync(MakeJob(alarm: MakeAlarm(priority: AlarmPriority.Critical)));
        await channel.DispatchAsync(MakeJob(alarm: MakeAlarm(priority: AlarmPriority.High)));

        Assert.Equal("1", relay.Messages[0].Header("X-Priority"));
        Assert.Equal("high", relay.Messages[0].Header("Importance"));
        Assert.NotEqual("1", relay.Messages[1].Header("X-Priority"));
    }

    /// <summary>
    /// 🔴 An alarm message containing a CR/LF is not hypothetical hardening: <c>MailMessage.Subject</c>
    /// REJECTS one by throwing (which in a never-throws channel is a counted loss for a message that could
    /// have been sent), while <c>Headers.Add</c> accepts one VERBATIM (which is header injection). Both
    /// behaviours were verified against the BCL. The builder collapses newlines before either can happen,
    /// so the same input is neither a loss nor an injection.
    /// </summary>
    [Fact]
    public async Task AnAlarmCarryingNewlines_NeitherFailsTheSend_NorInjectsAHeader()
    {
        await using var relay = SmtpLoopbackServer.Start();
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, relay.Port));

        var nasty = MakeAlarm(key: "Policy|DENY|write\r\nBcc: attacker@evil.test") with
        {
            Code = "DENY\r\nX-Injected: yes",
            TargetId = "conveyor\r\nX-Also-Injected: yes",
        };

        var channel = NewChannel(store);
        await channel.DispatchAsync(MakeJob(alarm: nasty));

        var received = Assert.Single(relay.Messages);
        Assert.Equal(1, channel.Stats.Delivered);
        Assert.Equal(0, channel.Stats.Lost);

        // Nothing the alarm carried became a header of its own.
        Assert.Null(received.Header("Bcc"));
        Assert.Null(received.Header("X-Injected"));
        Assert.Null(received.Header("X-Also-Injected"));
        Assert.DoesNotContain("attacker@evil.test", received.RcptTo);

        // The text survived, collapsed onto one line, in the header it belongs in.
        Assert.Contains("Bcc: attacker@evil.test", received.Header(SmtpContract.AlarmKeyHeader)!, StringComparison.Ordinal);
        Assert.DoesNotContain('\r', received.Header(SmtpContract.AlarmKeyHeader)!);
        Assert.DoesNotContain('\n', received.Header(SmtpContract.AlarmKeyHeader)!);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Credentials — the case that must not silently downgrade.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 The brief's second requirement, and C-3's I-1 finding one channel over: a stored password that
    /// will not DECRYPT must not become an anonymous send.
    ///
    /// <para><see cref="NotificationConfigStore.GetSecretAsync"/> returns <see langword="null"/> for both
    /// "nothing stored" and "the DPAPI blob would not decrypt" — a <c>notifications.db</c> copied from
    /// another machine. Handing null credentials to <see cref="System.Net.Mail.SmtpClient"/> means "send
    /// anonymously", so without the <c>HasPassword</c> check this machine would either produce 5xx
    /// rejections that read as a WRONG password, or — against a relay that also accepts anonymous mail —
    /// quietly keep working while the configuration API still reported <c>HasPassword = true</c>.</para>
    /// </summary>
    [Fact]
    public async Task APasswordThatCannotBeDecrypted_IsNotSilentlyDowngradedToAnAnonymousSend()
    {
        await using var relay = SmtpLoopbackServer.Start();
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, relay.Port, username: "alerts@plant.local"));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Smtp, NotificationSecretNames.SmtpPassword, PasswordSentinel));

        // The password really is there and really is readable, before it is corrupted.
        Assert.Equal(PasswordSentinel, await store.GetSecretAsync(
            NotificationChannel.Smtp, NotificationSecretNames.SmtpPassword));
        CorruptStoredPassword(store);

        var warnings = new List<string>();
        var channel = NewChannel(store, warnings);
        await channel.DispatchAsync(MakeJob());

        // Nothing was sent at all — not even a connection attempt.
        Assert.Empty(relay.Messages);
        Assert.Equal(0, relay.Connections);

        var stats = channel.Stats;
        Assert.Equal(1, stats.Lost);
        Assert.Equal(0, stats.Delivered);
        Assert.Equal(0, stats.Attempts);

        var warning = Assert.Single(warnings);
        Assert.Contains("could not be read", warning, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Re-save the password", warning, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(PasswordSentinel, warning, StringComparison.Ordinal);

        // 🔴 And the configuration API still says a password is stored, which is exactly why the row's
        // PRESENCE is the only thing that can distinguish the two cases.
        var summary = Assert.Single(await store.ListAsync());
        Assert.True(summary.Smtp!.HasPassword);
    }

    /// <summary>
    /// 🔴 The other half of the same fix, and the reason "always fail when there is no password" would have
    /// been the WRONG fix: a relay on an isolated plant network that accepts mail with no credentials at
    /// all is the Đợt A target deployment, and refusing it would make the most common configuration
    /// impossible. This is the SMTP analogue of C-3's unsigned-POST case.
    /// </summary>
    [Fact]
    public async Task NoUsernameAndNoPassword_SendsAnonymously_TheFixDoesNotBreakAnInPlantRelay()
    {
        await using var relay = SmtpLoopbackServer.Start();
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, relay.Port, username: null));

        var warnings = new List<string>();
        var channel = NewChannel(store, warnings);
        await channel.DispatchAsync(MakeJob());

        var received = Assert.Single(relay.Messages);
        Assert.Empty(received.AuthExchange); // no AUTH was attempted at all
        Assert.Equal(1, channel.Stats.Delivered);
        Assert.Equal(0, channel.Stats.Lost);
        Assert.Empty(warnings);
    }

    /// <summary>A configured username with no stored password cannot authenticate. Sending anyway produces
    /// a rejection that reads to an operator as a WRONG password when in fact none is stored.</summary>
    [Fact]
    public async Task AUsernameWithNoStoredPassword_IsALoss_NotAnUnauthenticatedAttempt()
    {
        await using var relay = SmtpLoopbackServer.Start();
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, relay.Port, username: "alerts@plant.local"));

        var warnings = new List<string>();
        var channel = NewChannel(store, warnings);
        await channel.DispatchAsync(MakeJob());

        Assert.Equal(0, relay.Connections);
        Assert.Equal(1, channel.Stats.Lost);
        Assert.Equal(0, channel.Stats.Delivered);

        var warning = Assert.Single(warnings);
        Assert.Contains("no password is stored", warning, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(NotificationSecretNames.SmtpPassword, warning, StringComparison.Ordinal);
    }

    /// <summary>A stored password with no username cannot be used — there is nothing to authenticate AS.
    /// Ignoring it and sending anonymously is the same silent downgrade in a different shape.</summary>
    [Fact]
    public async Task APasswordWithNoUsername_IsALoss_RatherThanASilentlyAnonymousSend()
    {
        await using var relay = SmtpLoopbackServer.Start();
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, relay.Port, username: null));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Smtp, NotificationSecretNames.SmtpPassword, PasswordSentinel));

        var warnings = new List<string>();
        var channel = NewChannel(store, warnings);
        await channel.DispatchAsync(MakeJob());

        Assert.Equal(0, relay.Connections);
        Assert.Equal(1, channel.Stats.Lost);

        var warning = Assert.Single(warnings);
        Assert.Contains("NO username", warning, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(PasswordSentinel, warning, StringComparison.Ordinal);
    }

    /// <summary>With both halves stored, the channel really does authenticate — and the password really is
    /// the one that was saved, proving the DPAPI round trip rather than assuming it.</summary>
    [Fact]
    public async Task WithAUsernameAndPassword_TheChannelAuthenticates_WithTheStoredCredential()
    {
        await using var relay = SmtpLoopbackServer.Start(new SmtpScript(
            EhloReply: "250-st4i-test\r\n250-AUTH LOGIN\r\n250 8BITMIME"));
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, relay.Port, username: "alerts@plant.local"));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Smtp, NotificationSecretNames.SmtpPassword, PasswordSentinel));

        var channel = NewChannel(store);
        await channel.DispatchAsync(MakeJob());

        var received = Assert.Single(relay.Messages);
        Assert.Equal(1, channel.Stats.Delivered);

        // AUTH LOGIN sends base64(username) then base64(password).
        Assert.Contains(received.AuthExchange, line =>
            line.Contains(Convert.ToBase64String(Encoding.UTF8.GetBytes("alerts@plant.local")), StringComparison.Ordinal));
        Assert.Contains(received.AuthExchange, line =>
            line.Contains(Convert.ToBase64String(Encoding.UTF8.GetBytes(PasswordSentinel)), StringComparison.Ordinal));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Retry policy — RFC 5321's own 4xx/5xx split.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 The brief's third requirement: a permanent rejection is NOT retried. SMTP states the distinction
    /// itself — 5xx is permanent — and these are the three cases the brief names by hand: no such mailbox
    /// (550), relay access denied (554), and message refused outright (552). Exactly ONE connection is made.
    ///
    /// <para><b>Proved non-vacuous by mutation:</b> changing <c>ClassifyStatus</c>'s
    /// <c>code is >= 400 and &lt; 500</c> to always report <c>Retryable</c> makes every case here fail with
    /// 3 connections observed against 1 expected, while every case of
    /// <see cref="ATransientRejection_IsRetried_BecauseRfc5321SaysItIsWorthRetrying"/> still passes — so
    /// the distinction really is what this test carries, rather than "some rejection happened".</para>
    /// </summary>
    [Theory]
    [InlineData("550 5.1.1 No such user here")]
    [InlineData("554 5.7.1 Relay access denied")]
    [InlineData("552 5.3.4 Message too big")]
    [InlineData("530 5.7.0 Authentication required")]
    [InlineData("535 5.7.8 Bad credentials")]
    [InlineData("501 5.5.4 Syntax error")]
    public async Task APermanentRejection_IsNeverRetried(string reply)
    {
        await using var relay = SmtpLoopbackServer.Start(new SmtpScript(MailFromReply: reply));
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, relay.Port));

        var warnings = new List<string>();
        var channel = NewChannel(store, warnings);
        await channel.DispatchAsync(MakeJob());

        Assert.Equal(1, relay.Connections);
        Assert.Empty(relay.Messages);

        var stats = channel.Stats;
        Assert.Equal(1, stats.Attempts);
        Assert.Equal(0, stats.Retries);
        Assert.Equal(1, stats.Lost);
        Assert.Equal(0, stats.Delivered);

        var warning = Assert.Single(warnings);
        Assert.Contains("permanent", warning, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("not retried", warning, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>The counterpart, and the reason the test above is about a DISTINCTION rather than about
    /// failure: RFC 5321 says a 4xx is transient and the specified remedy is to try again. Greylisting
    /// (450) is the everyday case — a relay that answers 450 to the first message from an unknown sender
    /// and accepts the retry.</summary>
    [Theory]
    [InlineData("421 4.7.0 Service not available")]
    [InlineData("450 4.2.0 Greylisted, try again later")]
    [InlineData("451 4.3.0 Local error in processing")]
    [InlineData("452 4.3.1 Insufficient system storage")]
    public async Task ATransientRejection_IsRetried_BecauseRfc5321SaysItIsWorthRetrying(string reply)
    {
        await using var relay = SmtpLoopbackServer.Start(new SmtpScript(MailFromReply: reply));
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, relay.Port));

        var warnings = new List<string>();
        var channel = NewChannel(store, warnings);
        await channel.DispatchAsync(MakeJob());

        Assert.Equal(3, relay.Connections);

        var stats = channel.Stats;
        Assert.Equal(3, stats.Attempts);
        Assert.Equal(2, stats.Retries);
        Assert.Equal(1, stats.Lost);
    }

    /// <summary>Greylisting end to end: the relay refuses the first message and accepts the second. This is
    /// the case the whole retry policy exists for, and it is the proof that a retry actually re-sends
    /// rather than merely re-connecting.</summary>
    [Fact]
    public async Task AGreylistingRelay_AcceptsTheRetry_AndTheMessageArrivesOnce()
    {
        await using var relay = SmtpLoopbackServer.Start(connection => connection == 1
            ? new SmtpScript(MailFromReply: "450 4.2.0 Greylisted")
            : new SmtpScript());
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, relay.Port));

        var channel = NewChannel(store);
        await channel.DispatchAsync(MakeJob());

        Assert.Equal(2, relay.Connections);
        var received = Assert.Single(relay.Messages);
        Assert.Equal(Recipient, Assert.Single(received.RcptTo));

        var stats = channel.Stats;
        Assert.Equal(1, stats.Delivered);
        Assert.Equal(0, stats.Lost);
        Assert.Equal(2, stats.Attempts);
        Assert.Equal(1, stats.Retries);
    }

    /// <summary>
    /// 🔴 A REJECTED PASSWORD IS NOT RETRIED — the brief's "bad credentials must not be retried", against a
    /// relay that behaves the way a real authenticating relay does.
    ///
    /// <para><b>Measured, and it is not where it looks like it should be.</b>
    /// <see cref="System.Net.Mail.SmtpClient"/> does NOT abort when the relay rejects <c>AUTH</c>: it
    /// swallows the <c>535</c> and carries on to <c>MAIL FROM</c> unauthenticated. So the scripted relay
    /// here does what Postfix, Exchange and every hosted relay do — reject the credentials, then refuse the
    /// transaction with <c>530 Authentication required</c>. That 5xx is what the channel actually sees, and
    /// the ordinary RFC 5321 rule classifies it permanent with no special case.</para>
    ///
    /// <para>An earlier version of this test scripted a relay that rejected AUTH and then accepted
    /// everything, and it FAILED — the message went through, because the client had carried on. That is
    /// recorded as a residual on <see cref="SmtpNotificationChannel"/>: against a relay that rejects
    /// credentials but still accepts mail from this host, the message is delivered anonymously and nothing
    /// reports that the stored password is wrong. Pinned below so the finding is not lost.</para>
    /// </summary>
    [Fact]
    public async Task ARejectedPassword_IsNotRetried_AndOnlyOneAuthenticationIsAttempted()
    {
        await using var relay = SmtpLoopbackServer.Start(new SmtpScript(
            EhloReply: "250-st4i-test\r\n250-AUTH LOGIN\r\n250 8BITMIME",
            AuthReply: "535 5.7.8 Authentication credentials invalid",
            MailFromReply: "530 5.7.0 Authentication required"));
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, relay.Port, username: "alerts@plant.local"));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Smtp, NotificationSecretNames.SmtpPassword, PasswordSentinel));

        var warnings = new List<string>();
        var errors = new List<(Exception Cause, string Message)>();
        var channel = NewChannel(store, warnings, errors);
        await channel.DispatchAsync(MakeJob());

        // 🔴 ONE connection, i.e. ONE authentication attempt against the account. Retrying a wrong password
        // three times per alarm, forever, is how a service account gets locked out.
        Assert.Equal(1, relay.Connections);
        Assert.Empty(relay.Messages);

        var stats = channel.Stats;
        Assert.Equal(1, stats.Attempts);
        Assert.Equal(0, stats.Retries);
        Assert.Equal(1, stats.Lost);
        Assert.Equal(0, stats.Delivered);

        var reported = string.Join("\n", warnings.Concat(errors.Select(e => e.Message)));
        Assert.Contains("permanent", reported, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("not retried", reported, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(PasswordSentinel, reported, StringComparison.Ordinal);
        Assert.DoesNotContain(PasswordSentinel,
            string.Join("\n", errors.Select(e => e.Cause.ToString())), StringComparison.Ordinal);
    }

    /// <summary>
    /// 🔴 The residual, pinned as a CHARACTERISATION test rather than left in prose: whenever the configured
    /// credential is <b>not successfully used</b>, and the relay accepts the mail anyway, the message is
    /// delivered ANONYMOUSLY and nothing anywhere reports that the stored credential is not working.
    ///
    /// <para><b>C-4 review (I-3) widened this from one shape to three</b>, because my first version pinned
    /// only "rejected after prompting" and the residual is not that narrow:</para>
    /// <list type="number">
    /// <item><description>the relay prompts, collects the password, and rejects it (<c>535</c>);</description></item>
    /// <item><description>the relay refuses the <c>AUTH</c> COMMAND outright, so the password is never even
    /// offered;</description></item>
    /// <item><description>🔴 <b>the relay advertises no <c>AUTH</c> capability at all</b> — so no
    /// authentication is attempted. <b>This is the reachable one:</b> relays commonly offer AUTH only after
    /// STARTTLS, so <see cref="SmtpTlsMode.None"/> with a stored username and password is an everyday
    /// configuration that lands here. C-2's clear-text notice does fire for it, but it warns about a
    /// different thing (the password crossing the wire), not about the password being ignored.</description></item>
    /// </list>
    ///
    /// <para>This documents a limitation of <see cref="System.Net.Mail.SmtpClient"/>, which exposes no
    /// <c>AUTH</c> result at all, not a decision this channel made. Asserted so that a future .NET change or
    /// a library swap turns it red and the residual is revisited deliberately rather than surviving as a
    /// paragraph nobody rechecks. No notification is lost in any of these cases, which is why the counters
    /// still read as a clean delivery — what is lost is the operator's knowledge.</para>
    /// </summary>
    [Theory]
    // (1) prompted, collected, rejected — the password does reach the wire.
    [InlineData("250-st4i-test\r\n250-AUTH LOGIN\r\n250 8BITMIME", "535 5.7.8 Bad credentials", null, true)]
    // (2) the AUTH command refused outright — the password is never offered.
    [InlineData("250-st4i-test\r\n250-AUTH LOGIN\r\n250 8BITMIME", null, "504 5.5.4 Unrecognized mechanism", false)]
    // (3) no AUTH advertised at all — no authentication attempted. The reachable case.
    [InlineData("250-st4i-test\r\n250 8BITMIME", null, null, false)]
    public async Task AConfiguredCredentialThatIsNeverSuccessfullyUsed_StillDeliversAnonymously_AndNothingSaysSo(
        string ehloReply, string? authReply, string? authCommandReply, bool passwordReachesTheWire)
    {
        await using var relay = SmtpLoopbackServer.Start(new SmtpScript(
            EhloReply: ehloReply,
            AuthReply: authReply ?? "235 2.7.0 Authentication succeeded",
            AuthCommandReply: authCommandReply));
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, relay.Port, username: "alerts@plant.local"));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Smtp, NotificationSecretNames.SmtpPassword, PasswordSentinel));

        var warnings = new List<string>();
        var errors = new List<(Exception Cause, string Message)>();
        var channel = NewChannel(store, warnings, errors);
        await channel.DispatchAsync(MakeJob());

        // The alarm DID reach its recipients, so the counters read as an honest delivery...
        var received = Assert.Single(relay.Messages);
        Assert.Equal(Recipient, Assert.Single(received.RcptTo));
        Assert.Equal(1, channel.Stats.Delivered);
        Assert.Equal(0, channel.Stats.Lost);

        // ...the credential was configured, and in case (1) it genuinely reached the wire and was refused,
        // while in (2) and (3) it was never used at all — three different routes to the same silence.
        var offeredPassword = received.AuthExchange.Any(line =>
            line.Contains(Convert.ToBase64String(Encoding.UTF8.GetBytes(PasswordSentinel)), StringComparison.Ordinal));
        Assert.Equal(passwordReachesTheWire, offeredPassword);

        // ...and NOTHING told the operator their stored credential is not being used. That is the residual.
        Assert.Empty(warnings);
        Assert.Empty(errors);
    }

    /// <summary>A refused TCP connection IS retried — it is a transport failure with a socket cause, and
    /// the relay may simply be restarting. The companion to the test above: same
    /// <c>StatusCode = GeneralFailure</c>, opposite decision, decided by the cause.</summary>
    [Fact]
    public async Task ARefusedConnection_IsRetried_AndIsCountedRatherThanThrown()
    {
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, SmtpLoopbackServer.ClosedPort()));

        var errors = new List<(Exception Cause, string Message)>();
        var warnings = new List<string>();
        // A refused connect costs ~2s (measured), so this needs a budget that admits three of them.
        var channel = NewChannel(
            store, warnings, errors,
            attemptTimeout: TimeSpan.FromSeconds(5), totalBudget: TimeSpan.FromSeconds(30));

        await channel.DispatchAsync(MakeJob()); // never throws

        var stats = channel.Stats;
        Assert.Equal(3, stats.Attempts);
        Assert.Equal(2, stats.Retries);
        Assert.Equal(1, stats.Lost);
        Assert.Equal(0, stats.Delivered);
        Assert.NotEmpty(errors.Concat(warnings.Select(w => (Cause: (Exception)new Exception(), Message: w))));
    }

    /// <summary>
    /// 🔴 A partial recipient rejection is a partial SUCCESS, and calling it a loss would tell an operator
    /// nobody was told when somebody was.
    ///
    /// <para>Measured: when one of several recipients is rejected at <c>RCPT TO</c>, the relay still runs
    /// <c>DATA</c> and the message really is delivered to the survivors. So this is <c>Delivered</c>, it is
    /// NOT retried (a retry would deliver it to the survivors a second time), and it moves a separate
    /// counter so a recipient who is silently never receiving alarms is visible rather than hidden inside
    /// <c>Delivered</c>.</para>
    /// </summary>
    [Fact]
    public async Task SomeRecipientsRejected_IsDeliveredAndCountedSeparately_AndIsNeverRetried()
    {
        await using var relay = SmtpLoopbackServer.Start(new SmtpScript(
            RcptToReply: rcpt => rcpt.Contains("gone@", StringComparison.Ordinal)
                ? "550 5.1.1 No such user here"
                : "250 OK"));
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, relay.Port,
            recipients: new[] { Recipient, "gone@plant.local", "line3@plant.local" }));

        var warnings = new List<string>();
        var channel = NewChannel(store, warnings);
        await channel.DispatchAsync(MakeJob());

        Assert.Equal(1, relay.Connections); // not retried
        var received = Assert.Single(relay.Messages);
        Assert.Equal(new[] { Recipient, "line3@plant.local" }, received.AcceptedRcptTo);

        var stats = channel.Stats;
        Assert.Equal(1, stats.Delivered);
        Assert.Equal(1, stats.PartiallyDelivered);
        Assert.Equal(0, stats.Lost);

        var warning = Assert.Single(warnings);
        // The rejected address IS named: "one of your 3 recipients was rejected" is unactionable.
        Assert.Contains("gone@plant.local", warning, StringComparison.Ordinal);
        Assert.Contains("not retried", warning, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>When EVERY recipient is rejected the message reached nobody, so it is a loss rather than a
    /// partial delivery — the boundary the counter above depends on.</summary>
    [Fact]
    public async Task EveryRecipientRejected_IsALoss_NotAPartialDelivery()
    {
        await using var relay = SmtpLoopbackServer.Start(new SmtpScript(
            RcptToReply: _ => "550 5.1.1 No such user here"));
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, relay.Port,
            recipients: new[] { "gone@plant.local", "also-gone@plant.local" }));

        var warnings = new List<string>();
        var channel = NewChannel(store, warnings);
        await channel.DispatchAsync(MakeJob());

        Assert.Equal(1, relay.Connections); // 5xx, so not retried
        Assert.Empty(relay.Messages);

        var stats = channel.Stats;
        Assert.Equal(1, stats.Lost);
        Assert.Equal(0, stats.Delivered);
        Assert.Equal(0, stats.PartiallyDelivered);
        Assert.Contains(warnings, w => w.Contains("rejected all", StringComparison.OrdinalIgnoreCase));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Bounds — the budget, and cancellation.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 The retry budget is honoured against a BLACK-HOLE relay — one that accepts the TCP connection and
    /// then never speaks, where the per-attempt timeout dominates. The bound is proved by MEASUREMENT, not
    /// by counting attempts: a 30s attempt timeout against a 1s budget can only finish in about a second if
    /// the budget cancels an attempt IN FLIGHT.
    ///
    /// <para>This shape is C-3's, adopted deliberately: its first budget test was VACUOUS — it used
    /// parameters where the "refuse to start another attempt" half alone produced the same observable
    /// outcome, so deleting the in-flight cancellation changed nothing. Only in-flight cancellation bounds
    /// head-of-line delay, so that is what this measures.</para>
    /// </summary>
    [Fact]
    public async Task TheTotalBudget_CancelsAnInFlightAttempt_NotJustTheNextOne_AndIsMeasured()
    {
        await using var relay = SmtpLoopbackServer.Start(_ => null); // accept, never speak
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, relay.Port));

        var warnings = new List<string>();
        var channel = NewChannel(
            store, warnings,
            attemptTimeout: TimeSpan.FromSeconds(30),
            totalBudget: TimeSpan.FromSeconds(1));

        var elapsed = Stopwatch.StartNew();
        await channel.DispatchAsync(MakeJob());
        elapsed.Stop();

        // Only in-flight cancellation can finish inside the attempt timeout.
        Assert.True(elapsed.Elapsed < TimeSpan.FromSeconds(10),
            $"the 1s budget did not cancel the in-flight attempt: took {elapsed.Elapsed}");
        Assert.True(elapsed.Elapsed >= TimeSpan.FromMilliseconds(800),
            $"finished implausibly fast ({elapsed.Elapsed}); the relay may not have accepted at all");

        Assert.Equal(1, relay.Connections);
        Assert.Equal(1, channel.Stats.Lost);
        Assert.Contains(warnings, w => w.Contains("budget elapsed", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// The other half of the budget: it also refuses to START an attempt it cannot afford.
    ///
    /// <para>🔴 <b>The arithmetic is stated here rather than observed from a run, and one half of it is
    /// MACHINE-INDEPENDENT.</b> This test is C-3's shape deliberately, because C-3's review found its first
    /// version timing-fragile in exactly the way mine was: my own first attempt used a 1200 ms budget with a
    /// 350 ms base backoff, where backoff₂ = 700 ms still fits in the ~840 ms remaining — so a third attempt
    /// ran and the assertion was simply wrong about the machine, not about the code.</para>
    ///
    /// <para>With a 2000 ms budget and a 700 ms base backoff:</para>
    /// <list type="bullet">
    /// <item><description><b>backoff₁ = 700 ms fits</b> as long as attempt 1 finishes within 1300 ms. It is
    /// a loopback rejection that takes single-digit milliseconds, so the margin is ~100×.</description></item>
    /// <item><description><b>backoff₂ = 1400 ms can NEVER fit</b>, whatever the machine costs: by the time
    /// it is evaluated at least 700 ms has already been slept out of 2000 ms, so at most 1300 ms remains,
    /// and <c>1400 &gt; 1300</c> unconditionally. Attempt 3 is impossible by arithmetic rather than by being
    /// too slow to happen.</description></item>
    /// </list>
    ///
    /// <para>🔴 <b>ELAPSED TIME IS THE ASSERTION THAT CARRIES THIS TEST, and without it the test was
    /// vacuous for the branch it is named after.</b> Review found that mutating <see cref="NextDelay"/> to
    /// <c>return delay;</c> — deleting the "cannot afford it" guard entirely — left every SMTP test passing:
    /// <c>Task.Delay(1400, budget.Token)</c> is cancelled by the same budget and lands in the
    /// <c>OperationCanceledException</c> handler, producing IDENTICAL counters and an identical connection
    /// count. The only observable difference is when the drain thread is released: <b>~0.7 s with the guard,
    /// ~2.0 s without</b>. Since head-of-line delay is the entire reason the guard exists, time is the only
    /// thing that can pin it. The 1.5 s bound sits clear of both — roughly 2× the expected 0.7 s and
    /// comfortably below the 2.0 s the mutation produces.</para>
    /// </summary>
    [Fact]
    public async Task TheTotalBudget_AlsoRefusesToStartAnAttemptItCannotAfford()
    {
        await using var relay = SmtpLoopbackServer.Start(new SmtpScript(MailFromReply: "451 4.3.0 Try later"));
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, relay.Port));

        var channel = NewChannel(
            store,
            attemptTimeout: TimeSpan.FromSeconds(5),
            totalBudget: TimeSpan.FromSeconds(2),
            baseBackoff: TimeSpan.FromMilliseconds(700),
            maxAttempts: 3);

        var elapsed = Stopwatch.StartNew();
        await channel.DispatchAsync(MakeJob());
        elapsed.Stop();

        Assert.Equal(2, relay.Connections);
        Assert.Equal(2, channel.Stats.Attempts);
        Assert.Equal(1, channel.Stats.Retries);
        Assert.Equal(1, channel.Stats.Lost);

        // 🔴 The head-of-line property: the drain thread is released as soon as the budget cannot afford
        // another attempt, NOT when the budget finally expires. Deleting the guard makes this ~2.0s.
        Assert.True(elapsed.Elapsed < TimeSpan.FromMilliseconds(1500),
            $"the drain thread was held for {elapsed.Elapsed} — the budget guard did not refuse the " +
            "unaffordable attempt, it merely waited out the whole budget.");

        // And the lower bound proves backoff 1 really was slept, so the fast path is not passing for the
        // wrong reason (e.g. the whole delivery giving up before any backoff at all).
        Assert.True(elapsed.Elapsed >= TimeSpan.FromMilliseconds(600),
            $"finished in {elapsed.Elapsed}, which is too fast for backoff 1 (700ms) to have been slept.");
    }

    /// <summary>
    /// 🔴 <b>Cancellation, measured — and the case that needed a mechanism of its own.</b>
    ///
    /// <para><see cref="System.Net.Mail.SmtpClient.SendMailAsync(System.Net.Mail.MailMessage,
    /// CancellationToken)"/> honours its token in every phase EXCEPT while the TCP connect is pending;
    /// measured against an unroutable address, a token cancelled at 500ms did not return for <b>21.0
    /// seconds</b>. The channel therefore backs the token with a registration that DISPOSES the client,
    /// which tears the pending socket down — measured at 503/508/517ms for the same 500ms token.</para>
    ///
    /// <para>This test drives the phase that IS natively cancellable (a relay that accepts and never
    /// speaks) with an attempt timeout and budget far longer than the cancellation deadline, so a pass
    /// cannot come from the budget doing the work. It asserts the propagation too: without it, C-1's drain
    /// loop counts a shutdown-abandoned job as successfully dispatched.</para>
    /// </summary>
    [Fact]
    public async Task Cancellation_UnblocksAnInFlightSendPromptly_AndPropagatesSoTheDrainLoopCountsIt()
    {
        await using var relay = SmtpLoopbackServer.Start(_ => null); // accept, never speak
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, relay.Port));

        var warnings = new List<string>();
        var errors = new List<(Exception Cause, string Message)>();
        var channel = NewChannel(
            store, warnings, errors,
            attemptTimeout: TimeSpan.FromSeconds(30),
            totalBudget: TimeSpan.FromSeconds(60));

        using var cts = new CancellationTokenSource();
        var elapsed = Stopwatch.StartNew();
        var dispatch = channel.DispatchAsync(MakeJob(), cts.Token);

        // Let the conversation genuinely start before cancelling, so this measures interrupting work in
        // flight rather than the cheap already-cancelled path.
        var deadline = DateTimeOffset.UtcNow.AddSeconds(10);
        while (relay.Connections == 0 && DateTimeOffset.UtcNow < deadline) await Task.Delay(10);
        Assert.Equal(1, relay.Connections);

        await cts.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => dispatch);
        elapsed.Stop();

        Assert.True(elapsed.Elapsed < TimeSpan.FromSeconds(10),
            $"cancellation did not unblock the send promptly: took {elapsed.Elapsed}");

        var stats = channel.Stats;
        Assert.Equal(1, stats.Cancelled);
        Assert.Equal(0, stats.Lost);
        Assert.Equal(0, stats.Delivered);
        // A shutdown is not a failure; nothing should be reported as one.
        Assert.Empty(errors);
        Assert.Empty(warnings);
    }

    /// <summary>
    /// 🔴 The phase <see cref="System.Net.Mail.SmtpClient"/> cannot cancel by itself: a PENDING TCP
    /// CONNECT. Measured at 21.0s unbounded against an unroutable address; with the dispose-on-cancel
    /// registration it returns in about the cancellation deadline.
    ///
    /// <para>This is the test that justifies the mechanism existing at all, and it is load-bearing rather
    /// than decorative: C-1's <c>DisposeAsync</c> awaits the drain loop UNBOUNDED after its own 5s timeout,
    /// so a send that cannot be interrupted hangs host shutdown for as long as it takes.</para>
    ///
    /// <para><b>10.255.255.1</b> is an address in a private range that is not routed here, so SYN packets
    /// are dropped rather than refused — which is what makes the connect PEND rather than fail fast. If a
    /// future test machine does route it, this test fails loudly (fast, unexpected success) rather than
    /// passing for the wrong reason.</para>
    /// </summary>
    [Fact]
    public async Task Cancellation_InterruptsAPendingTcpConnect_WhichSmtpClientAloneCannotDo()
    {
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, 25, host: "10.255.255.1"));

        var channel = NewChannel(
            store,
            attemptTimeout: TimeSpan.FromSeconds(60),
            totalBudget: TimeSpan.FromSeconds(120));

        using var cts = new CancellationTokenSource();
        var elapsed = Stopwatch.StartNew();
        var dispatch = channel.DispatchAsync(MakeJob(), cts.Token);

        await Task.Delay(500);
        await cts.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => dispatch);
        elapsed.Stop();

        // Unbounded this is ~21s (the OS connect timeout). Anything under 10s proves the socket was torn
        // down rather than waited out; the lower bound proves the connect really was pending.
        Assert.True(elapsed.Elapsed < TimeSpan.FromSeconds(10),
            $"the pending connect was not interrupted: took {elapsed.Elapsed}");
        Assert.True(elapsed.Elapsed >= TimeSpan.FromMilliseconds(400),
            $"the connect did not pend at all ({elapsed.Elapsed}) — is 10.255.255.1 routable here?");

        Assert.Equal(1, channel.Stats.Cancelled);
        Assert.Equal(0, channel.Stats.Lost);
    }

    /// <summary>The cheapest path must not be the silent one: an already-cancelled token abandons before
    /// any connection and is still counted.</summary>
    [Fact]
    public async Task AnAlreadyCancelledToken_AbandonsBeforeAnySend_AndIsStillCounted()
    {
        await using var relay = SmtpLoopbackServer.Start();
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, relay.Port));

        var channel = NewChannel(store);
        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => channel.DispatchAsync(MakeJob(), cts.Token));

        Assert.Equal(0, relay.Connections);
        Assert.Equal(1, channel.Stats.Cancelled);
        Assert.Equal(0, channel.Stats.Lost);
        Assert.Equal(0, channel.Stats.Delivered);
    }

    /// <summary>
    /// 🔴 The brief's port-465 requirement: the send path must not HANG in the configuration C-2's startup
    /// notice warns about.
    ///
    /// <para>Port 465 is implicit TLS (SMTPS): the server expects a TLS handshake the instant the socket
    /// opens. <see cref="System.Net.Mail.SmtpClient"/> implements only RFC 3207 STARTTLS, so with
    /// <c>EnableSsl</c> it sends EHLO in the clear to a server waiting for a ClientHello and the
    /// conversation goes nowhere. That is simulated exactly by a relay that accepts and never speaks.
    /// The point of this test is that the outcome is BOUNDED and COUNTED rather than hung — it is the same
    /// bound any unresponsive relay gets, which is why the limitation is a documentation matter and not an
    /// availability one.</para>
    /// </summary>
    [Theory]
    [InlineData(SmtpTlsMode.StartTls)]
    [InlineData(SmtpTlsMode.None)]
    public async Task Port465WithStartTls_DoesNotHang_ItIsBoundedAndCounted(SmtpTlsMode tls)
    {
        await using var relay = SmtpLoopbackServer.Start(_ => null); // an implicit-TLS server, from our side
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, relay.Port, tls: tls));

        var warnings = new List<string>();
        var channel = NewChannel(
            store, warnings,
            attemptTimeout: TimeSpan.FromMilliseconds(700),
            totalBudget: TimeSpan.FromSeconds(3));

        var elapsed = Stopwatch.StartNew();
        await channel.DispatchAsync(MakeJob()); // never throws
        elapsed.Stop();

        Assert.True(elapsed.Elapsed < TimeSpan.FromSeconds(10),
            $"the send hung rather than being bounded: took {elapsed.Elapsed}");
        Assert.Equal(1, channel.Stats.Lost);
        Assert.Equal(0, channel.Stats.Delivered);
        Assert.NotEmpty(warnings);
    }

    /// <summary>
    /// 🔴 C-2's port-465 startup notice still fires, and — since C-4 review (I-2) — says what this channel
    /// MEASURABLY does rather than what C-2 predicted it would do.
    ///
    /// <para>C-2 wrote "the attempt will hang rather than fail quickly" before any SMTP channel existed.
    /// C-4 built it and measured the opposite: bounded by the budget and counted as a loss, which
    /// <see cref="Port465WithStartTls_DoesNotHang_ItIsBoundedAndCounted"/> asserts directly. The previous
    /// version of THIS test checked only for "465", "STARTTLS" and "587", so the false sentence survived the
    /// very assertion meant to cover it — and C-8 publishes these words. The negative assertion below is
    /// therefore the point of the test, not decoration.</para>
    /// </summary>
    [Theory]
    [InlineData(SmtpTlsMode.StartTls)]
    [InlineData(SmtpTlsMode.None)]
    public async Task TheImplicitTlsStartupNotice_StillFires_AndDoesNotClaimAHangItCannotProduce(SmtpTlsMode tls)
    {
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, 465, tls: tls, host: "smtp.example.com"));

        var notices = NotificationStartupNotices.Describe(
            await store.ListAsync(),
            new HashSet<NotificationChannel> { NotificationChannel.Smtp });

        var notice = Assert.Single(notices, n =>
            n.Message.Contains("465", StringComparison.Ordinal));
        Assert.Equal(NotificationNoticeSeverity.Warning, notice.Severity);
        Assert.Contains("STARTTLS", notice.Message, StringComparison.Ordinal);
        Assert.Contains("587", notice.Message, StringComparison.Ordinal);

        // 🔴 It must say what actually happens: nothing is delivered, and each attempt is counted lost.
        Assert.Contains("lost notification", notice.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("budget", notice.Message, StringComparison.OrdinalIgnoreCase);

        // 🔴 And it must NOT predict a symptom this channel cannot produce. C-8 publishes this text; an
        // operator told to expect a hang would go looking for a stuck process that does not exist.
        //
        // Word-boundary matched rather than a bare substring (review round 2, m-1): "change", "exchange"
        // and "unchanged" all CONTAIN "hang", and this guards prose that C-8 is explicitly going to
        // rewrite. A spurious failure on the word "change" during an editorial pass would be baffling to
        // diagnose, and a trip-wire nobody can explain is a trip-wire that gets deleted.
        Assert.False(
            Regex.IsMatch(notice.Message, @"\bhang(s|ing|ed)?\b", RegexOptions.IgnoreCase),
            $"the 465 notice claims the attempt hangs, which C-4 measured it does not: {notice.Message}");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Filtering, accounting, and leaks.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>A disabled channel sends nothing at all — and does not decrypt its password to find that
    /// out.</summary>
    [Fact]
    public async Task ADisabledChannel_SendsNothing()
    {
        await using var relay = SmtpLoopbackServer.Start();
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, relay.Port, enabled: false));

        var warnings = new List<string>();
        var channel = NewChannel(store, warnings);
        await channel.DispatchAsync(MakeJob());

        Assert.Equal(0, relay.Connections);
        var stats = channel.Stats;
        Assert.Equal(1, stats.Considered);
        Assert.Equal(1, stats.Suppressed);
        Assert.Equal(0, stats.Delivered);
        Assert.Equal(0, stats.Lost);
        Assert.Empty(warnings);
    }

    /// <summary>Minimum-priority filtering, in both directions. <see cref="AlarmPriority"/> is declared
    /// most-severe-FIRST, so this is the inversion C-2 put in one shared helper precisely because four
    /// channels would otherwise each risk getting it backwards — a channel that delivered everything EXCEPT
    /// the alarms that matter.</summary>
    [Theory]
    [InlineData(AlarmPriority.Critical, AlarmPriority.Critical, true)]
    [InlineData(AlarmPriority.High, AlarmPriority.Critical, false)]
    [InlineData(AlarmPriority.High, AlarmPriority.High, true)]
    [InlineData(AlarmPriority.Critical, AlarmPriority.High, true)]
    [InlineData(AlarmPriority.Low, AlarmPriority.High, false)]
    public async Task TheMinimumPriorityThreshold_DecidesDelivery_InTheRightDirection(
        AlarmPriority alarmPriority, AlarmPriority minPriority, bool expectSend)
    {
        await using var relay = SmtpLoopbackServer.Start();
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, relay.Port, minPriority: minPriority));

        var channel = NewChannel(store);
        await channel.DispatchAsync(MakeJob(alarm: MakeAlarm(priority: alarmPriority)));

        Assert.Equal(expectSend ? 1 : 0, relay.Messages.Count);
        Assert.Equal(expectSend ? 1 : 0, channel.Stats.Delivered);
        Assert.Equal(expectSend ? 0 : 1, channel.Stats.Suppressed);
    }

    /// <summary>
    /// 🔴 The accounting invariant, held by construction rather than by discipline: for every
    /// (notification, configured instance) pair exactly one of Suppressed / Delivered / Lost / Cancelled
    /// moves. Three instances, one of each of the first three outcomes, in one dispatch.
    /// </summary>
    [Fact]
    public async Task EveryNotificationInstancePair_MovesExactlyOneCounter()
    {
        await using var good = SmtpLoopbackServer.Start();
        await using var bad = SmtpLoopbackServer.Start(new SmtpScript(MailFromReply: "550 5.1.1 Nope"));
        var store = NewStore();

        Assert.True(await SaveSmtpAsync(store, good.Port, instance: "good"));
        Assert.True(await SaveSmtpAsync(store, bad.Port, instance: "rejects"));
        Assert.True(await SaveSmtpAsync(store, good.Port, instance: "off", enabled: false));

        var channel = NewChannel(store, new List<string>());
        await channel.DispatchAsync(MakeJob());

        var stats = channel.Stats;
        Assert.Equal(1, stats.Considered);
        Assert.Equal(1, stats.Delivered);
        Assert.Equal(1, stats.Lost);
        Assert.Equal(1, stats.Suppressed);
        Assert.Equal(0, stats.Cancelled);
        Assert.Equal(3, stats.Suppressed + stats.Delivered + stats.Lost + stats.Cancelled);
    }

    /// <summary>Several configured instances each get their own message — C-2 put <c>instance</c> in the
    /// primary key to leave this open, and an on-call gateway beside an internal relay is the obvious
    /// case.</summary>
    [Fact]
    public async Task TwoConfiguredInstances_BothReceiveTheirOwnMessage()
    {
        await using var internalRelay = SmtpLoopbackServer.Start();
        await using var oncallRelay = SmtpLoopbackServer.Start();
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, internalRelay.Port, instance: "plant"));
        Assert.True(await SaveSmtpAsync(store, oncallRelay.Port, instance: "oncall",
            recipients: new[] { "oncall@pager.example" }));

        var channel = NewChannel(store);
        await channel.DispatchAsync(MakeJob());

        Assert.Equal("plant", Assert.Single(internalRelay.Messages).Header(SmtpContract.InstanceHeader));
        var paged = Assert.Single(oncallRelay.Messages);
        Assert.Equal("oncall", paged.Header(SmtpContract.InstanceHeader));
        Assert.Equal("oncall@pager.example", Assert.Single(paged.RcptTo));

        Assert.Equal(2, channel.Stats.Delivered);
    }

    /// <summary>
    /// 🔴 The brief's leak requirement, asserted rather than asserted-about: the stored password must not
    /// appear in a log line, an error string, an exception message, or any read.
    ///
    /// <para>Drives four reporting paths — an undecryptable password, a permanent rejection, a rejected
    /// authentication, and a refused connection — then searches every accumulated warning, every error
    /// message, and every full <c>exception.ToString()</c>. Non-vacuity: it asserts something WAS reported
    /// and that the non-secret identity (host, port, instance) IS present, so a channel that simply logged
    /// nothing could not pass.</para>
    /// </summary>
    [Fact]
    public async Task ThePassword_NeverReachesALogLine_AnErrorMessage_OrAnException()
    {
        var warnings = new List<string>();
        var errors = new List<(Exception Cause, string Message)>();

        // (a) a password that will not decrypt
        {
            var store = NewStore();
            Assert.True(await SaveSmtpAsync(
                store, SmtpLoopbackServer.ClosedPort(), username: "u", instance: LeakProbeInstance));
            Assert.True(await store.SetSecretAsync(
                NotificationChannel.Smtp, NotificationSecretNames.SmtpPassword, PasswordSentinel,
                instance: LeakProbeInstance));
            CorruptStoredPassword(store);
            await NewChannel(store, warnings, errors).DispatchAsync(MakeJob());
        }

        // (b) a permanent rejection, and (c) a rejected authentication — the latter scripted the way a real
        // authenticating relay behaves (535, then refusing the transaction), because SmtpClient carries on
        // past a rejected AUTH and a relay that then accepted the mail would exercise no reporting path.
        foreach (var script in new[]
        {
            new SmtpScript(MailFromReply: "550 5.1.1 No such user"),
            new SmtpScript(
                EhloReply: "250-st4i-test\r\n250-AUTH LOGIN\r\n250 8BITMIME",
                AuthReply: "535 5.7.8 Bad credentials",
                MailFromReply: "530 5.7.0 Authentication required"),
        })
        {
            await using var relay = SmtpLoopbackServer.Start(script);
            var store = NewStore();
            Assert.True(await SaveSmtpAsync(
                store, relay.Port, username: "alerts@plant.local", instance: LeakProbeInstance));
            Assert.True(await store.SetSecretAsync(
                NotificationChannel.Smtp, NotificationSecretNames.SmtpPassword, PasswordSentinel,
                instance: LeakProbeInstance));
            await NewChannel(store, warnings, errors).DispatchAsync(MakeJob());
        }

        // (d) a refused connection, with credentials attached
        {
            var store = NewStore();
            var port = SmtpLoopbackServer.ClosedPort();
            Assert.True(await SaveSmtpAsync(
                store, port, username: "alerts@plant.local", instance: LeakProbeInstance));
            Assert.True(await store.SetSecretAsync(
                NotificationChannel.Smtp, NotificationSecretNames.SmtpPassword, PasswordSentinel,
                instance: LeakProbeInstance));
            await NewChannel(store, warnings, errors,
                attemptTimeout: TimeSpan.FromSeconds(5), totalBudget: TimeSpan.FromSeconds(30))
                .DispatchAsync(MakeJob());
        }

        var everything = new StringBuilder();
        foreach (var warning in warnings) everything.AppendLine(warning);
        foreach (var (cause, message) in errors)
        {
            everything.AppendLine(message);
            everything.AppendLine(cause.ToString());
        }
        var reported = everything.ToString();

        // 🔴 Non-vacuity FIRST: something really was reported, and it really does name the destination.
        // The instance name is a distinctive token rather than "default" (review, m-2): a common word can
        // appear in unrelated prose, so it would not have proved the identity reached the message.
        Assert.NotEmpty(warnings.Concat(errors.Select(e => e.Message)));
        Assert.Contains(SmtpLoopbackServer.Host, reported, StringComparison.Ordinal);
        Assert.Contains(LeakProbeInstance, reported, StringComparison.Ordinal);

        Assert.DoesNotContain(PasswordSentinel, reported, StringComparison.Ordinal);
    }

    /// <summary>
    /// 🔴 Recipients and the From address are personal data. No ORDINARY failure line names them — the
    /// identity carries a recipient COUNT instead. The single exception is a per-recipient rejection, where
    /// naming the address is the entire actionable content, and that exception is asserted too so the rule
    /// is pinned in both directions rather than as a blanket ban nothing enforces.
    /// </summary>
    [Fact]
    public async Task OrdinaryFailureLines_CountRecipientsRatherThanNamingThem()
    {
        const string Private1 = "night.shift.lead@plant.local";
        const string Private2 = "duty.manager@plant.local";

        var warnings = new List<string>();
        var errors = new List<(Exception Cause, string Message)>();

        await using (var relay = SmtpLoopbackServer.Start(new SmtpScript(MailFromReply: "550 5.1.1 Nope")))
        {
            var store = NewStore();
            Assert.True(await SaveSmtpAsync(store, relay.Port, recipients: new[] { Private1, Private2 }));
            await NewChannel(store, warnings, errors).DispatchAsync(MakeJob());
        }

        var reported = string.Join("\n", warnings.Concat(errors.Select(e => e.Message)));
        Assert.NotEmpty(reported);
        Assert.DoesNotContain(Private1, reported, StringComparison.Ordinal);
        Assert.DoesNotContain(Private2, reported, StringComparison.Ordinal);
        Assert.DoesNotContain(From, reported, StringComparison.Ordinal);
        // What IS there instead: the count, which is what an operator needs to sanity-check a config.
        Assert.Contains("2 recipient(s)", reported, StringComparison.Ordinal);

        // The deliberate exception, so this is a rule rather than a ban.
        warnings.Clear();
        await using (var relay = SmtpLoopbackServer.Start(new SmtpScript(
            RcptToReply: rcpt => rcpt.Contains(Private2, StringComparison.Ordinal) ? "550 5.1.1 Nope" : "250 OK")))
        {
            var store = NewStore();
            Assert.True(await SaveSmtpAsync(store, relay.Port, recipients: new[] { Private1, Private2 }));
            await NewChannel(store, warnings).DispatchAsync(MakeJob());
        }

        Assert.Contains(Private2, Assert.Single(warnings), StringComparison.Ordinal);
    }

    /// <summary>A configuration listed but not readable back is a LOSS, not a suppression — C-3's review
    /// round 1 (M-1) established that <c>Suppressed</c> is documented as "the operator's configuration
    /// working" and that a failed read is not that. Reproduced deterministically by deleting the side row
    /// while leaving the channel row: a state <c>ListAsync</c>'s LEFT JOIN still reports as configured and
    /// <c>GetSmtpAsync</c>'s INNER JOIN cannot resolve.</summary>
    [Fact]
    public async Task AChannelListedButNotReadableBack_IsALoss_NotASuppression()
    {
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, SmtpLoopbackServer.ClosedPort()));
        ExecuteSql(store, "DELETE FROM smtp_config;");

        var warnings = new List<string>();
        var channel = NewChannel(store, warnings);
        await channel.DispatchAsync(MakeJob());

        Assert.Equal(1, channel.Stats.Lost);
        Assert.Equal(0, channel.Stats.Suppressed);
        Assert.Contains("could not be read back", Assert.Single(warnings), StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>An unusable stored address is a counted loss with a diagnosable message, never an exception
    /// out of a never-throws channel. <c>MailAddress</c> throws <see cref="FormatException"/> for these,
    /// and the store accepts them because address syntax is not something a configuration store
    /// validates.</summary>
    [Fact]
    public async Task AnUnusableFromOrRecipientAddress_IsCounted_AndNeverThrows()
    {
        foreach (var (from, recipients) in new (string, string[])[]
        {
            ("not-an-address", new[] { Recipient }),
            (From, new[] { "also not an address @@" }),
        })
        {
            await using var relay = SmtpLoopbackServer.Start();
            var store = NewStore();
            Assert.True(await SaveSmtpAsync(store, relay.Port, from: from, recipients: recipients));

            var warnings = new List<string>();
            var errors = new List<(Exception Cause, string Message)>();
            var channel = NewChannel(store, warnings, errors);

            await channel.DispatchAsync(MakeJob()); // never throws

            Assert.Empty(relay.Messages);
            Assert.Equal(1, channel.Stats.Lost);
            Assert.Equal(0, channel.Stats.Delivered);

            // 🔴 Review (m-1) — NO attempt is counted, and this assertion used to say the opposite and so
            // pinned the inaccuracy in place. `Attempts` is documented as "SMTP conversations actually
            // started"; a message that could not be built never opened a socket, and the relay confirms it
            // saw no connection at all.
            Assert.Equal(0, channel.Stats.Attempts);
            Assert.Equal(0, relay.Connections);
            Assert.NotEmpty(warnings.Concat(errors.Select(e => e.Message)));
        }
    }

    /// <summary>Nothing configured at all: the channel does nothing and says nothing. The startup notices
    /// own telling an operator that no channel exists — a per-notification warning would be one line per
    /// alarm forever.</summary>
    [Fact]
    public async Task NoSmtpChannelConfigured_DoesNothingAndSaysNothing()
    {
        var store = NewStore();
        var warnings = new List<string>();
        var errors = new List<(Exception Cause, string Message)>();
        var channel = NewChannel(store, warnings, errors);

        await channel.DispatchAsync(MakeJob());

        var stats = channel.Stats;
        Assert.Equal(1, stats.Considered);
        Assert.Equal(0, stats.Suppressed + stats.Delivered + stats.Lost + stats.Cancelled);
        Assert.Empty(warnings);
        Assert.Empty(errors);
    }

    /// <summary>A webhook-only configuration must not make the e-mail channel do anything — the two read
    /// the same list and each must take only its own rows.</summary>
    [Fact]
    public async Task AWebhookConfiguration_IsIgnoredByTheEmailChannel()
    {
        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, "https://mes.plant/hook"));

        var channel = NewChannel(store);
        await channel.DispatchAsync(MakeJob());

        var stats = channel.Stats;
        Assert.Equal(1, stats.Considered);
        Assert.Equal(0, stats.Suppressed + stats.Delivered + stats.Lost);
    }

    /// <summary>🔴 The documented defaults are what the channel actually uses. The tests above all run with
    /// shrunken budgets, so without this nothing pins what SHIPS — and the 10s budget in particular is a
    /// measured number (a refused connect costs ~2s, so three attempts plus backoff is ~6.8s: inside 10s
    /// and outside 5s) that a later edit must not quietly halve.</summary>
    [Fact]
    public void TheDocumentedDefaults_AreWhatTheChannelActuallyUses()
    {
        Assert.Equal(TimeSpan.FromSeconds(5), SmtpNotificationChannel.DefaultAttemptTimeout);
        Assert.Equal(TimeSpan.FromSeconds(10), SmtpNotificationChannel.DefaultTotalBudget);
        Assert.Equal(3, SmtpNotificationChannel.DefaultMaxAttempts);
        Assert.Equal(TimeSpan.FromMilliseconds(250), SmtpNotificationChannel.DefaultBaseBackoff);
    }

    /// <summary>
    /// 🔴 <b>The head-of-line invariant, measured — this is what "the cost is one budget, not N" means.</b>
    ///
    /// <para>C-4 review (I-4) found this property had NO test. What stood in its place was an assertion that
    /// the webhook's and this channel's default budgets are equal, which is neither necessary nor sufficient
    /// for it — and which would have read to C-5/C-6 as a rule that a local-annunciation channel must also
    /// carry a 10 s budget. The reviewer proved the gap: replacing the <c>Task.WhenAll</c> fan-out in
    /// <see cref="SmtpNotificationChannel.DispatchAsync"/> with a sequential <c>foreach</c> left all 62
    /// tests passing.</para>
    ///
    /// <para>Two black-holing relays against a 2 s budget: fanned out, the whole dispatch costs ~2 s;
    /// sequentially it costs ~4 s. The 3 s bound sits between them and does not depend on the two budgets
    /// being equal to each other, so it survives C-5/C-6 choosing different ones.</para>
    /// </summary>
    [Fact]
    public async Task TwoDeadDestinations_CostTheDrainLoopOneBudget_NotTwo()
    {
        await using var first = SmtpLoopbackServer.Start(_ => null);  // accept, never speak
        await using var second = SmtpLoopbackServer.Start(_ => null);
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, first.Port, instance: "plant"));
        Assert.True(await SaveSmtpAsync(store, second.Port, instance: "oncall"));

        var channel = NewChannel(
            store, new List<string>(),
            attemptTimeout: TimeSpan.FromSeconds(30),
            totalBudget: TimeSpan.FromSeconds(2));

        var elapsed = Stopwatch.StartNew();
        await channel.DispatchAsync(MakeJob());
        elapsed.Stop();

        // Both really were attempted — otherwise "one budget" would be trivially true.
        Assert.Equal(1, first.Connections);
        Assert.Equal(1, second.Connections);
        Assert.Equal(2, channel.Stats.Lost);

        Assert.True(elapsed.Elapsed < TimeSpan.FromSeconds(3),
            $"two dead SMTP destinations held the drain loop for {elapsed.Elapsed} — that is the SUM of " +
            "their budgets, not the max, so the fan-out has been sequentialised.");
        Assert.True(elapsed.Elapsed >= TimeSpan.FromMilliseconds(1500),
            $"finished in {elapsed.Elapsed}, too fast for either budget to have elapsed at all.");
    }

    /// <summary>
    /// 🔴 End to end through C-1's REAL edge detector and a REAL alarm store: 240 raises of one unchanged
    /// alarm produce exactly ONE e-mail, and the clear produces one more. This is the premise the whole
    /// batch rests on — the 5s evaluator restates an alarm 720 times an hour, and without the edge detector
    /// that is 720 e-mails.
    /// </summary>
    [Fact]
    public async Task ThroughTheRealNotifier_240RaisesProduceExactlyOneEmail()
    {
        await using var relay = SmtpLoopbackServer.Start();
        var store = NewStore();
        Assert.True(await SaveSmtpAsync(store, relay.Port, minPriority: AlarmPriority.Low));

        var channel = NewChannel(store);
        await using var notifier = new AlarmNotifier(dispatch: channel.DispatchAsync);
        var alarms = new AlarmStore(NewTempDir(), notifier: notifier);

        var raise = new AlarmRaise(
            AlarmSource.DriverHealth, "DOWN", AlarmPriority.Critical, "unreachable", TargetId: "MODBUS-01");
        for (var i = 0; i < 240; i++) await alarms.RaiseAsync(raise);
        await alarms.ClearAsync(raise.Key);

        var deadline = DateTimeOffset.UtcNow.AddSeconds(30);
        while (relay.Messages.Count < 2 && DateTimeOffset.UtcNow < deadline) await Task.Delay(25);

        Assert.Equal(2, relay.Messages.Count);
        Assert.Contains("RAISED", relay.Messages[0].Header("Subject")!, StringComparison.Ordinal);
        Assert.Contains("CLEARED", relay.Messages[1].Header("Subject")!, StringComparison.Ordinal);

        // 🔴 The non-vacuity guard: the 239 restatements really were seen and really were suppressed by the
        // edge detector, rather than the alarm store simply not having called the notifier.
        Assert.Equal(239, notifier.Stats.Suppressed);
        Assert.Equal(2, channel.Stats.Considered);
        Assert.Equal(2, channel.Stats.Delivered);
    }
}
